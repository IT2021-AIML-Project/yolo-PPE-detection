# PPE Detection — Metrics & Model Guide

---

## What gets saved per inference (MongoDB document)

Every detection creates one document in the `detections` collection.

```jsonc
{
  "inferenceId":   "uuid-v4",                  // unique ID for this inference
  "timestamp":     "2026-03-24T10:30:00.000Z", // when it ran
  "sourceType":    "image | video | webcam",   // how the image came in

  // ── Media ──────────────────────────────────────────────────────────────────
  "mediaUrl":      "https://res.cloudinary.com/...",
  "mediaPublicId": "ppe-detections/abc123",

  // ── Detection results ──────────────────────────────────────────────────────
  "totalDetections": 4,
  "violationCount":  1,
  "compliantCount":  3,
  "classCounts": { "helmet": 2, "vest": 1, "no_helmet": 1 },

  "detections": [
    { "label": "helmet",    "confidence": 0.923, "box": [120, 45, 210, 130] },
    { "label": "no_helmet", "confidence": 0.871, "box": [300, 60, 390, 145] }
  ],
  "violations": [ /* subset of detections where label starts with "no_" */ ],
  "compliant":  [ /* subset of detections where label does NOT start with "no_" */ ],

  // ── Performance ────────────────────────────────────────────────────────────
  "inferenceTime": {
    "preprocess_ms":  4.2,   // image resize + normalisation
    "inference_ms":   18.7,  // model forward pass (the actual neural network)
    "postprocess_ms": 1.1,   // NMS (non-maximum suppression) + label lookup
    "total_ms":       24.0   // wall-clock from request received to response sent
  },

  // ── Model snapshot ─────────────────────────────────────────────────────────
  "modelMeta": {
    "framework":  "YOLOv8 (ultralytics)",
    "numClasses": 6,
    "classes":    { "0": "helmet", "1": "no_helmet", "2": "vest", "3": "no_vest", ... },
    "trainMetrics": {
      "precision": 0.923,
      "recall":    0.887,
      "mAP50":     0.911,   // mAP at IoU threshold 0.50
      "mAP50_95":  0.742,   // mAP averaged over IoU 0.50–0.95 (stricter)
      "f1":        0.905    // calculated: 2 * P * R / (P + R)
    }
  }
}
```

---

## What each metric means

### Training metrics (fixed — come from your training run)

| Metric | What it means | Good value |
|---|---|---|
| **Precision** | Of all detections the model made, what fraction were correct? | > 0.90 |
| **Recall** | Of all real PPE items in the images, what fraction did the model find? | > 0.85 |
| **mAP@50** | Mean Average Precision at IoU ≥ 0.50. The standard PPE/object-detection benchmark. | > 0.90 |
| **mAP@50-95** | Same but averaged across tighter overlap thresholds — harder, more realistic. | > 0.70 |
| **F1** | Harmonic mean of Precision and Recall. Single number to compare models. | > 0.90 |

> **Note:** If `trainMetrics` shows `null` values, your checkpoint doesn't contain saved training results. Re-export the model from your training run using `model.export()` or check that `best.pt` was saved with `save_period` enabled.

### Per-inference metrics (live — measured every detection)

| Field | What it measures |
|---|---|
| `preprocess_ms` | Time to resize and normalise the image before feeding it to the network |
| `inference_ms` | Time the neural network itself takes — this is the GPU/CPU compute time |
| `postprocess_ms` | Time for NMS (removing duplicate boxes) and class name lookup |
| `total_ms` | Full wall-clock time including Python overhead and HTTP serialisation |

---

## Inference speed expectations

| Hardware | Expected `inference_ms` |
|---|---|
| CPU only (laptop) | 150–600 ms |
| CPU only (server) | 80–200 ms |
| NVIDIA GPU (CUDA) | 5–30 ms |
| Your setup (CUDA 12.1 / RTX) | ~8–20 ms |

> The venv installed a CPU build of PyTorch. To use your GPU:
> ```powershell
> .\venv\Scripts\Activate.ps1
> pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
> ```

---

## Where frame rate is set

**File:** `client/src/components/WebcamTab.jsx`

```js
const FPS_OPTIONS = [
  { label: "0.5 fps  (every 2s) — recommended", value: 2000 },
  { label: "1 fps    (every 1s)",                value: 1000 },
  { label: "2 fps    (every 500ms)",             value: 500  },
  { label: "5 fps    (every 200ms) — GPU only",  value: 200  },
];
```

The dropdown is visible in the Webcam tab UI. You can also add rows to `FPS_OPTIONS` for custom rates.

### Recommended frame rate by use case

| Scenario | Recommended | Reason |
|---|---|---|
| PPE audit (walk-through) | **0.5 fps** | Workers move slowly; saves DB storage and Cloudinary quota |
| Active monitoring (site entrance) | **1 fps** | Good balance of latency and server load |
| Near real-time (CPU) | **1–2 fps** | Prevents request queue buildup — each frame takes 150–600 ms |
| Near real-time (GPU) | **2–5 fps** | Inference is 8–20 ms; overhead is the HTTP round-trip |
| True real-time 30 fps | Not recommended via this stack | Use a dedicated video pipeline (e.g. OpenCV + socket.io) |

> **Why not 30 fps?** Each webcam frame goes: Browser → Node → Python → MongoDB → Cloudinary. Even at 20 ms inference, the full round-trip is ~200–400 ms over localhost. At 30 fps you'd have 30 simultaneous requests queued. The `loadingRef` guard prevents overlapping requests, so you'd just skip frames — effectively running at 2–3 fps anyway.

---

## API endpoints

### `GET /api/model-info`
Returns the model's class list and training metrics without running inference.

```json
{
  "modelPath": "best.pt",
  "framework": "YOLOv8 (ultralytics)",
  "numClasses": 6,
  "classes": { "0": "helmet", "1": "no_helmet", ... },
  "trainMetrics": { "precision": 0.923, "recall": 0.887, "mAP50": 0.911, ... },
  "trainArgs": { "epochs": 100, "imgsz": 640, "batch": 16, "optimizer": "SGD" }
}
```

### `GET /api/metrics`
Returns last 50 records + aggregate stats including `avgInferenceMs` and `classFrequency`.

### `POST /api/detect`
| Field | Type | Description |
|---|---|---|
| `file` | multipart file | Image (JPG/PNG) or video (MP4/MOV) |
| `sourceType` | string | `"image"`, `"video"`, or `"webcam"` |

---

## MongoDB index recommendation

For fast queries on timestamp and sourceType, add these indexes in MongoDB Atlas:

```js
db.detections.createIndex({ timestamp: -1 })
db.detections.createIndex({ sourceType: 1, timestamp: -1 })
db.detections.createIndex({ inferenceId: 1 }, { unique: true })
```
