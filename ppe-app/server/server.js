require("dotenv").config();

const REQUIRED_ENV = ["MONGO_URI", "CLOUDINARY_NAME", "CLOUDINARY_KEY", "CLOUDINARY_SECRET"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n[ERROR] Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy server/.env.example to server/.env and fill in the values.\n");
  process.exit(1);
}

const express   = require("express");
const mongoose  = require("mongoose");
const cloudinary = require("cloudinary").v2;
const multer    = require("multer");
const axios     = require("axios");
const cors      = require("cors");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());

// ─── MongoDB ────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err.message));

// ─── Cloudinary ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key:    process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// ─── Schema ─────────────────────────────────────────────────────────────────
const inferenceTimeSchema = new mongoose.Schema({
  preprocess_ms:  Number,
  inference_ms:   Number,
  postprocess_ms: Number,
  total_ms:       Number,
}, { _id: false });

const trainMetricsSchema = new mongoose.Schema({
  precision: Number,
  recall:    Number,
  mAP50:     Number,
  mAP50_95:  Number,
  f1:        Number,
}, { _id: false });

const detectionSchema = new mongoose.Schema({
  // ── Identity ──────────────────────────────────────────────────────────────
  inferenceId: { type: String, default: () => randomUUID() },
  timestamp:   { type: Date,   default: Date.now },

  // ── Source ────────────────────────────────────────────────────────────────
  sourceType:    { type: String, enum: ["image", "video", "webcam"], default: "image" },
  mediaUrl:      String,
  mediaPublicId: String,

  // ── Video frame info (only set for sourceType="video") ────────────────────
  videoId: String,     // shared UUID for all frames from the same video upload
  frameInfo: {
    frameNumber:  Number,   // 0-indexed frame position
    timestamp_s:  Number,   // seconds into the video
    totalFrames:  Number,   // total frames extracted from this video
    _id: false,
  },

  // ── Detection results ─────────────────────────────────────────────────────
  detections:      Array,
  violations:      Array,
  compliant:       Array,
  classCounts:     Object,
  violationCount:  Number,
  compliantCount:  Number,
  totalDetections: Number,

  // ── Performance ───────────────────────────────────────────────────────────
  inferenceTime: inferenceTimeSchema,

  // ── Model metadata ────────────────────────────────────────────────────────
  modelMeta: {
    modelPath:    String,
    framework:    String,
    numClasses:   Number,
    classes:      Object,
    trainMetrics: trainMetricsSchema,
  },
}, { timestamps: false });

const Detection = mongoose.model("Detection", detectionSchema);

// ─── Helpers ────────────────────────────────────────────────────────────────
const YOLO_URL = process.env.YOLO_SERVICE_URL || "http://localhost:5001";

async function uploadToCloudinary(buffer, mimetype) {
  const b64     = buffer.toString("base64");
  const dataUri = `data:${mimetype};base64,${b64}`;
  return cloudinary.uploader.upload(dataUri, {
    resource_type: "auto",
    folder: "ppe-detections",
  });
}

async function runDetection(buffer) {
  const b64 = buffer.toString("base64");
  const response = await axios.post(
    `${YOLO_URL}/detect`,
    { image: b64 },
    { timeout: 30000 }
  );
  return response.data;
}

// ─── Routes ─────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
});

/**
 * POST /api/detect
 * Form fields:
 *   file       — the image or video file (required)
 *   frame      — a JPEG frame extracted from the video (optional, sent by client for videos)
 *   sourceType — "image" | "video" | "webcam" (optional)
 *
 * For videos: client extracts a mid-point frame and sends it as `frame`.
 * YOLO runs on `frame`; the original video is stored on Cloudinary.
 */
app.post(
  "/api/detect",
  upload.fields([
    { name: "file",  maxCount: 1 },
    { name: "frame", maxCount: 1 },
  ]),
  async (req, res) => {
    const fileField  = req.files?.file?.[0];
    const frameField = req.files?.frame?.[0];

    if (!fileField) return res.status(400).json({ error: "No file provided" });

    const rawType    = (req.body?.sourceType || "").toLowerCase();
    const isVideo    = fileField.mimetype.startsWith("video");
    const sourceType = isVideo ? "video" : rawType === "webcam" ? "webcam" : "image";

    // Buffer to run YOLO on:
    //   - video  → use the extracted frame if provided, otherwise skip detection
    //   - image  → use the image itself
    //   - webcam → use the image itself
    const detectionBuffer = isVideo ? (frameField?.buffer ?? null) : fileField.buffer;

    try {
      const cloudPromise = uploadToCloudinary(fileField.buffer, fileField.mimetype);
      const yoloPromise  = detectionBuffer
        ? runDetection(detectionBuffer)
        : Promise.resolve({
            detections: [], violations: [], compliant: [],
            summary: { total: 0, violations: 0, compliant: 0, classCounts: {} },
            inferenceTime: { preprocess_ms: 0, inference_ms: 0, postprocess_ms: 0, total_ms: 0 },
            modelMeta: null,
          });

      const [cloudResult, yoloResult] = await Promise.all([cloudPromise, yoloPromise]);
      const { detections, violations, compliant, summary, inferenceTime, modelMeta } = yoloResult;

      const record = await Detection.create({
        sourceType,
        mediaUrl:        cloudResult.secure_url,
        mediaPublicId:   cloudResult.public_id,
        detections,
        violations,
        compliant,
        classCounts:     summary.classCounts || {},
        violationCount:  summary.violations,
        compliantCount:  summary.compliant,
        totalDetections: summary.total,
        inferenceTime,
        modelMeta: modelMeta ? {
          modelPath:    modelMeta.modelPath,
          framework:    modelMeta.framework,
          numClasses:   modelMeta.numClasses,
          classes:      modelMeta.classes,
          trainMetrics: modelMeta.trainMetrics,
        } : undefined,
      });

      res.json({ success: true, record, mediaUrl: cloudResult.secure_url });
    } catch (err) {
      console.error("Detection error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/upload-video
 * Uploads the original video file to Cloudinary only (no YOLO).
 * Returns { videoId, mediaUrl, mediaPublicId } for the client to use
 * when submitting individual frames via /api/detect-frame.
 */
app.post("/api/upload-video", upload.fields([{ name: "file", maxCount: 1 }]), async (req, res) => {
  const fileField = req.files?.file?.[0];
  if (!fileField) return res.status(400).json({ error: "No file provided" });

  try {
    const cloudResult = await uploadToCloudinary(fileField.buffer, fileField.mimetype);
    res.json({
      videoId:       randomUUID(),
      mediaUrl:      cloudResult.secure_url,
      mediaPublicId: cloudResult.public_id,
    });
  } catch (err) {
    console.error("Video upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/detect-frame
 * Runs YOLO on a single video frame and saves the result to MongoDB.
 * Form fields:
 *   frame            — JPEG image blob
 *   videoId          — shared UUID for this video session
 *   frameNumber      — 0-indexed frame number
 *   frameTimestamp_s — seconds into the video
 *   totalFrames      — total number of frames being processed
 *   mediaUrl         — Cloudinary URL of the original video
 */
app.post("/api/detect-frame", upload.fields([{ name: "frame", maxCount: 1 }]), async (req, res) => {
  const frameField = req.files?.frame?.[0];
  if (!frameField) return res.status(400).json({ error: "No frame provided" });

  const { videoId, frameNumber, frameTimestamp_s, totalFrames, mediaUrl } = req.body;

  try {
    const yoloResult = await runDetection(frameField.buffer);
    const { detections, violations, compliant, summary, inferenceTime, modelMeta } = yoloResult;

    const record = await Detection.create({
      sourceType:      "video",
      mediaUrl:        mediaUrl || "",
      videoId:         videoId  || randomUUID(),
      frameInfo: {
        frameNumber:  parseInt(frameNumber,  10) || 0,
        timestamp_s:  parseFloat(frameTimestamp_s) || 0,
        totalFrames:  parseInt(totalFrames,  10) || 1,
      },
      detections,
      violations,
      compliant,
      classCounts:     summary.classCounts || {},
      violationCount:  summary.violations,
      compliantCount:  summary.compliant,
      totalDetections: summary.total,
      inferenceTime,
      modelMeta: modelMeta ? {
        modelPath:    modelMeta.modelPath,
        framework:    modelMeta.framework,
        numClasses:   modelMeta.numClasses,
        classes:      modelMeta.classes,
        trainMetrics: modelMeta.trainMetrics,
      } : undefined,
    });

    res.json({ success: true, record });
  } catch (err) {
    console.error("Frame detection error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics
 * Query params:
 *   sourceType — "image" | "video" | "webcam" | "all" (default "all")
 *   page       — page number, 1-indexed (default 1)
 *   pageSize   — records per page (default 200, max 1000)
 *
 * Returns all matching records (flat) + aggregate stats + total count.
 * Video frame records share a videoId — group them client-side.
 */
app.get("/api/metrics", async (req, res) => {
  try {
    const { sourceType = "all", page = "1", pageSize = "200" } = req.query;

    const filter = sourceType !== "all" ? { sourceType } : {};
    const limit  = Math.min(parseInt(pageSize, 10) || 200, 1000);
    const skip   = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

    const [records, totalCount] = await Promise.all([
      Detection.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      Detection.countDocuments(filter),
    ]);

    // Aggregate stats across ALL matching records (not just this page)
    const [aggResult] = await Detection.aggregate([
      { $match: filter },
      { $group: {
          _id: null,
          totalViolations: { $sum: "$violationCount" },
          totalCompliant:  { $sum: "$compliantCount" },
          avgInferenceMs:  { $avg: "$inferenceTime.total_ms" },
      }},
    ]);

    const totalViolations = aggResult?.totalViolations ?? 0;
    const totalCompliant  = aggResult?.totalCompliant  ?? 0;
    const avgInferenceMs  = aggResult?.avgInferenceMs != null
      ? Math.round(aggResult.avgInferenceMs)
      : null;

    // Class frequency across all matching records
    const classFreqAgg = await Detection.aggregate([
      { $match: filter },
      { $project: { classCounts: { $objectToArray: { $ifNull: ["$classCounts", {}] } } } },
      { $unwind: "$classCounts" },
      { $group: { _id: "$classCounts.k", total: { $sum: "$classCounts.v" } } },
      { $sort: { total: -1 } },
    ]);
    const classFrequency = Object.fromEntries(classFreqAgg.map((x) => [x._id, x.total]));

    const latestWithMeta = records.find((r) => r.modelMeta);

    res.json({
      records,
      pagination: { page: parseInt(page, 10), pageSize: limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
      stats: {
        totalScans: totalCount,
        totalViolations,
        totalCompliant,
        complianceRate: (totalCompliant + totalViolations) > 0
          ? ((totalCompliant / (totalCompliant + totalViolations)) * 100).toFixed(1)
          : null,
        avgInferenceMs,
        classFrequency,
      },
      modelMeta: latestWithMeta?.modelMeta || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/model-info
 * Proxies the Python service's /model-info endpoint so the React app
 * can fetch it without knowing the Python port.
 */
app.get("/api/model-info", async (_req, res) => {
  try {
    const { data } = await axios.get(`${YOLO_URL}/model-info`, { timeout: 5000 });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "YOLO service unreachable: " + err.message });
  }
});

/**
 * DELETE /api/records/:id
 */
app.delete("/api/records/:id", async (req, res) => {
  try {
    const record = await Detection.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.mediaPublicId) {
      await cloudinary.uploader.destroy(record.mediaPublicId, {
        resource_type: record.sourceType === "video" ? "video" : "image",
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
