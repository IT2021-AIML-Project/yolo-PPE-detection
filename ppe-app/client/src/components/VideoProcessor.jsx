import { useState, useRef, useCallback } from "react";
import axios from "axios";
import DetectionCanvas from "./DetectionCanvas";
import styles from "./VideoProcessor.module.css";

const API     = "/api";
const FPS     = 2;
const MAX_SEC = Infinity; // no limit — process the full video

const SPEED_OPTIONS = [
  { label: "Slow  (1.5s per frame)", value: 1500 },
  { label: "Normal (800ms per frame) — default", value: 800 },
  { label: "Fast  (300ms per frame)", value: 300 },
  { label: "Max speed (no delay)",    value: 0   },
];

// ─── Frame extraction ────────────────────────────────────────────────────────
async function extractFrames(file, onProgress) {
  const url   = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src     = url;
  video.muted   = true;
  video.preload = "metadata";

  await new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("Could not load video metadata")), { once: true });
  });

  const duration    = Math.min(video.duration, MAX_SEC);
  const interval    = 1 / FPS;
  const totalFrames = Math.ceil(duration / interval);
  const frames      = [];

  for (let i = 0; i < totalFrames; i++) {
    const t = parseFloat((i * interval).toFixed(3));
    video.currentTime = t;
    await new Promise((res) => video.addEventListener("seeked", res, { once: true }));

    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
    frames.push({ blob, frameNumber: i, timestamp_s: t, totalFrames });

    if (onProgress) onProgress(i + 1, totalFrames, "extract");
  }

  URL.revokeObjectURL(url);
  return frames;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function VideoProcessor({ file, previewUrl }) {
  const [phase, setPhase]           = useState("idle");
  const [progress, setProgress]     = useState({ current: 0, total: 0 });
  const [currentFrame, setCurrentFrame] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const [videoUrl, setVideoUrl]     = useState(null);
  const [error, setError]           = useState(null);
  const [minDisplayMs, setMinDisplayMs] = useState(800);
  const cancelRef                   = useRef(false);

  // Aggregate stats across all processed frames
  const stats = allResults.reduce(
    (acc, r) => ({
      totalDetections: acc.totalDetections + (r.totalDetections || 0),
      totalViolations: acc.totalViolations + (r.violationCount  || 0),
      totalCompliant:  acc.totalCompliant  + (r.compliantCount  || 0),
      avgInferenceMs:  acc.avgInferenceMs  + (r.inferenceTime?.total_ms || 0),
    }),
    { totalDetections: 0, totalViolations: 0, totalCompliant: 0, avgInferenceMs: 0 }
  );
  if (allResults.length) stats.avgInferenceMs = Math.round(stats.avgInferenceMs / allResults.length);

  const run = useCallback(async () => {
    cancelRef.current = false;
    setError(null);
    setAllResults([]);
    setCurrentFrame(null);

    // ── 1. Upload video to Cloudinary ────────────────────────────────────────
    setPhase("uploading");
    let videoId, cloudUrl;
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await axios.post(`${API}/upload-video`, form, {
        onUploadProgress: (e) => {
          if (e.total) setProgress({ current: Math.round((e.loaded / e.total) * 100), total: 100 });
        },
      });
      videoId  = data.videoId;
      cloudUrl = data.mediaUrl;
      setVideoUrl(cloudUrl);
    } catch (err) {
      setError("Upload failed: " + (err.response?.data?.error || err.message));
      setPhase("error");
      return;
    }

    // ── 2. Extract frames at 2 FPS ───────────────────────────────────────────
    setPhase("extracting");
    let frames;
    try {
      frames = await extractFrames(file, (cur, tot) => setProgress({ current: cur, total: tot }));
    } catch (err) {
      setError("Frame extraction failed: " + err.message);
      setPhase("error");
      return;
    }

    // ── 3. Run YOLO on each frame sequentially ───────────────────────────────
    setPhase("detecting");
    const results = [];

    for (const frame of frames) {
      if (cancelRef.current) break;

      setProgress({ current: frame.frameNumber + 1, total: frame.totalFrames });

      const frameUrl  = URL.createObjectURL(frame.blob);
      const frameStart = performance.now();

      // Show frame immediately with no boxes while detection runs
      setCurrentFrame({ url: frameUrl, detections: [], frameNumber: frame.frameNumber, timestamp_s: frame.timestamp_s });

      try {
        const form = new FormData();
        form.append("frame",            frame.blob, "frame.jpg");
        form.append("videoId",          videoId);
        form.append("frameNumber",      String(frame.frameNumber));
        form.append("frameTimestamp_s", String(frame.timestamp_s));
        form.append("totalFrames",      String(frame.totalFrames));
        form.append("mediaUrl",         cloudUrl);

        const { data } = await axios.post(`${API}/detect-frame`, form);
        const record   = data.record;

        setCurrentFrame({
          url:           frameUrl,
          detections:    record.detections    || [],
          frameNumber:   frame.frameNumber,
          timestamp_s:   frame.timestamp_s,
          inferenceTime: record.inferenceTime,
          violationCount: record.violationCount,
        });

        results.push(record);
        setAllResults([...results]);
      } catch (err) {
        console.warn(`Frame ${frame.frameNumber} failed:`, err.message);
        results.push({ frameNumber: frame.frameNumber, error: err.message });
        setAllResults([...results]);
      }

      // Hold the frame on screen for at least minDisplayMs so it's visible
      const elapsed   = performance.now() - frameStart;
      const remaining = minDisplayMs - elapsed;
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    }

    setPhase("done");
  }, [file]);

  const cancel = () => { cancelRef.current = true; };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>

      {/* Video player */}
      <div className={styles.videoRow}>
        <div className={styles.panel}>
          <p className={styles.panelLabel}>Original video</p>
          <video src={previewUrl} controls className={styles.video} />
        </div>

        {currentFrame && (
          <div className={styles.panel}>
            <p className={styles.panelLabel}>
              Frame {currentFrame.frameNumber + 1} &mdash; {currentFrame.timestamp_s}s
              {currentFrame.inferenceTime && (
                <span className={styles.timing}> &bull; {currentFrame.inferenceTime.total_ms} ms</span>
              )}
            </p>
            <DetectionCanvas
              src={currentFrame.url}
              detections={currentFrame.detections}
              mediaType="image"
            />
            {currentFrame.violationCount > 0 && (
              <div className={styles.violationBanner}>
                ⚠ {currentFrame.violationCount} violation{currentFrame.violationCount !== 1 ? "s" : ""} detected
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {(phase === "idle" || phase === "done" || phase === "error") && (
          <>
            <button className={styles.btnRun} onClick={run}>
              {phase === "idle" ? `Process Video (${FPS} fps · full length)` : "Process Again"}
            </button>
            <div className={styles.speedRow}>
              <label className={styles.speedLabel}>Display speed</label>
              <select
                className={styles.speedSelect}
                value={minDisplayMs}
                onChange={(e) => setMinDisplayMs(Number(e.target.value))}
              >
                {SPEED_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
        {(phase === "uploading" || phase === "extracting" || phase === "detecting") && (
          <>
            <button className={styles.btnCancel} onClick={cancel}>Cancel</button>
            <ProgressBar phase={phase} progress={progress} />
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Live stats */}
      {allResults.length > 0 && (
        <div className={styles.statsRow}>
          <Stat label="Frames processed"  value={allResults.length} />
          <Stat label="Total detections"  value={stats.totalDetections} />
          <Stat label="Total violations"  value={stats.totalViolations} color="danger" />
          <Stat label="Total compliant"   value={stats.totalCompliant}  color="success" />
          <Stat label="Avg inference"     value={`${stats.avgInferenceMs} ms`} />
        </div>
      )}

      {/* Per-frame timeline */}
      {allResults.length > 0 && (
        <div className={styles.timeline}>
          <p className={styles.timelineTitle}>Frame timeline</p>
          <div className={styles.timelineRow}>
            {allResults.map((r, i) => (
              <FrameTick key={i} record={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ProgressBar({ phase, progress }) {
  const label =
    phase === "uploading"  ? `Uploading video… ${progress.current}%`
    : phase === "extracting" ? `Extracting frames… ${progress.current} / ${progress.total}`
    : `Detecting… frame ${progress.current} / ${progress.total}`;

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className={styles.progressBox}>
      <span className={styles.progressLabel}>{label}</span>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  const colorMap = { danger: "var(--danger)", success: "var(--success)" };
  return (
    <div className={styles.stat}>
      <span className={styles.statValue} style={color ? { color: colorMap[color] } : {}}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function FrameTick({ record }) {
  if (record.error) return <div className={styles.tick} style={{ background: "var(--border)" }} title={`Frame ${record.frameNumber}: error`} />;
  const hasViolation = (record.violationCount || 0) > 0;
  return (
    <div
      className={styles.tick}
      style={{ background: hasViolation ? "var(--danger)" : "var(--success)" }}
      title={`Frame ${(record.frameInfo?.frameNumber ?? 0) + 1} @ ${record.frameInfo?.timestamp_s}s — ${record.violationCount || 0} violation(s) — ${record.inferenceTime?.total_ms || "?"}ms`}
    />
  );
}
