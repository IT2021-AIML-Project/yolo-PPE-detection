from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO
import base64
import io
import os
import time
from PIL import Image

app = Flask(__name__)
CORS(app)

MODEL_PATH = os.environ.get("MODEL_PATH", "best.pt")

print(f"Loading YOLOv8 model from: {MODEL_PATH}")
model = YOLO(MODEL_PATH)
print("Model loaded successfully.")


# ─── Extract training metrics from checkpoint (saved once at startup) ────────
def _get_model_meta() -> dict:
    ckpt = getattr(model, "ckpt", {}) or {}

    # Class names: {0: "helmet", 1: "no_helmet", ...}
    names = model.names if hasattr(model, "names") else {}

    # Training metrics written by YOLOv8 trainer into the checkpoint
    train_metrics = ckpt.get("train_metrics", {})
    train_args    = ckpt.get("train_args", {})

    precision = train_metrics.get("metrics/precision(B)")
    recall    = train_metrics.get("metrics/recall(B)")
    mAP50     = train_metrics.get("metrics/mAP50(B)")
    mAP50_95  = train_metrics.get("metrics/mAP50-95(B)")
    f1 = (
        round(2 * precision * recall / (precision + recall), 4)
        if precision and recall and (precision + recall) > 0
        else None
    )

    return {
        "modelPath":   MODEL_PATH,
        "framework":   "YOLOv8 (ultralytics)",
        "classes":     names,
        "numClasses":  len(names),
        "trainMetrics": {
            "precision":  round(precision, 4) if precision is not None else None,
            "recall":     round(recall, 4)    if recall    is not None else None,
            "mAP50":      round(mAP50, 4)     if mAP50     is not None else None,
            "mAP50_95":   round(mAP50_95, 4)  if mAP50_95  is not None else None,
            "f1":         f1,
        },
        "trainArgs": {
            "epochs":    train_args.get("epochs"),
            "imgsz":     train_args.get("imgsz"),
            "batch":     train_args.get("batch"),
            "optimizer": train_args.get("optimizer"),
        },
    }

MODEL_META = _get_model_meta()


# ─── Helpers ──────────────────────────────────────────────────────────────────
def decode_image(b64_string: str) -> Image.Image:
    img_bytes = base64.b64decode(b64_string)
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_PATH})


@app.route("/model-info", methods=["GET"])
def model_info():
    """Return static model metadata: classes, training metrics, architecture."""
    return jsonify(MODEL_META)


@app.route("/detect", methods=["POST"])
def detect():
    data = request.get_json(force=True)
    if not data or "image" not in data:
        return jsonify({"error": "Missing 'image' field (base64 encoded)"}), 400

    try:
        image = decode_image(data["image"])
    except Exception as exc:
        return jsonify({"error": f"Invalid image data: {exc}"}), 400

    # Wall-clock time around the full call (preprocess + inference + postprocess)
    t_start = time.perf_counter()
    results = model(image)[0]
    t_end   = time.perf_counter()

    # YOLOv8 also reports its own internal breakdown (ms)
    speed = results.speed  # {"preprocess": x, "inference": x, "postprocess": x}

    detections = []
    class_counts = {}
    for box in results.boxes:
        label = results.names[int(box.cls)]
        conf  = round(float(box.conf), 4)
        detections.append({
            "label":      label,
            "confidence": conf,
            "box":        [round(v, 2) for v in box.xyxy[0].tolist()],
        })
        class_counts[label] = class_counts.get(label, 0) + 1

    violations = [d for d in detections if d["label"].lower().startswith("no_")]
    compliant  = [d for d in detections if not d["label"].lower().startswith("no_")]

    return jsonify({
        "detections": detections,
        "violations": violations,
        "compliant":  compliant,
        "summary": {
            "total":      len(detections),
            "violations": len(violations),
            "compliant":  len(compliant),
            "classCounts": class_counts,
        },
        "inferenceTime": {
            "preprocess_ms":  round(speed.get("preprocess", 0), 2),
            "inference_ms":   round(speed.get("inference",  0), 2),
            "postprocess_ms": round(speed.get("postprocess", 0), 2),
            "total_ms":       round((t_end - t_start) * 1000, 2),
        },
        "modelMeta": MODEL_META,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
