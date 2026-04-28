# PPE Model Training Guide
### What `best.pt` must do to work perfectly with this application

---

## Required Classes (exactly 8)

The model must be trained with these **exact label names** (case-sensitive).
The app automatically treats any label starting with `no_` as a violation.

| Class Index | Label | Type | What it detects |
|---|---|---|---|
| 0 | `helmet` | Compliant | Person wearing a hard hat / safety helmet |
| 1 | `no_helmet` | **VIOLATION** | Person's head visible with no helmet on |
| 2 | `vest` | Compliant | Person wearing a hi-vis / safety vest |
| 3 | `no_vest` | **VIOLATION** | Person's torso visible with no vest on |
| 4 | `boot` | Compliant | Person wearing safety boots / steel-toe boots |
| 5 | `no_boot` | **VIOLATION** | Person's feet visible with no safety boots |
| 6 | `mask` | Compliant | Person wearing a face mask / respirator |
| 7 | `no_mask` | **VIOLATION** | Person's face visible with no mask on |

> **The naming convention is the only rule the app uses.**
> Any label starting with `no_` → red violation box.
> Any other label → green compliant box.
> You can add more classes (e.g. `glove`, `no_glove`) and they will work automatically.

---

## Target Accuracy (minimum to be useful in production)

| Metric | Minimum | Target | Excellent |
|---|---|---|---|
| **mAP@50** | 0.75 | 0.88 | > 0.93 |
| **mAP@50-95** | 0.50 | 0.65 | > 0.75 |
| **Precision** | 0.80 | 0.90 | > 0.95 |
| **Recall** | 0.75 | 0.88 | > 0.93 |
| **F1** | 0.77 | 0.89 | > 0.94 |

> **Why recall matters more than precision here:**
> A false negative (missing a real violation) is worse than a false positive
> (flagging something that's fine). Tune your confidence threshold toward
> higher recall — it's better to over-alert than to miss an unsafe worker.

### Per-class recall targets

Violation classes need the highest recall because missing them is dangerous:

| Class | Minimum Recall |
|---|---|
| `no_helmet` | **0.85** |
| `no_vest` | **0.85** |
| `no_boot` | 0.80 |
| `no_mask` | 0.80 |
| `helmet` | 0.80 |
| `vest` | 0.80 |
| `boot` | 0.75 |
| `mask` | 0.75 |

---

## Dataset Requirements

### Volume

| Class | Minimum Images | Recommended |
|---|---|---|
| Per compliant class (helmet, vest...) | 500 | 1,500+ |
| Per violation class (no_helmet, no_vest...) | 800 | 2,000+ |
| **Total dataset** | **5,000** | **15,000+** |

> Violation classes need MORE images because they are harder to detect —
> the model must learn the *absence* of an object, which is less visually
> distinct than a bright yellow vest or orange helmet.

### Scene diversity (critical)

Your dataset must cover all of these or the model will fail on unseen scenes:

**Environments**
- [ ] Construction sites (scaffolding, cranes, dirt)
- [ ] Warehouses and factories (indoor, artificial light)
- [ ] Outdoor worksites (varying weather, natural light)
- [ ] Road works (hi-vis, traffic)
- [ ] Mining / underground (low light)

**Conditions**
- [ ] Bright sunlight and harsh shadows
- [ ] Overcast / diffuse light
- [ ] Night / artificial lighting
- [ ] Partially occluded PPE (arm blocking vest, helmet at angle)
- [ ] Multiple workers in the same frame
- [ ] Workers at distance (small bounding boxes)
- [ ] Workers close-up (large bounding boxes)

**Worker variation**
- [ ] Different body sizes and heights
- [ ] Different skin tones
- [ ] Different PPE colours (yellow, orange, white helmets; yellow, orange, lime vests)
- [ ] Workers facing away from camera (back view)
- [ ] Workers in motion (slight blur)

---

## Annotation Rules

### Bounding box placement

```
helmet / no_helmet  → tight box around the HEAD only
                      (not shoulders, not the whole person)

vest / no_vest      → tight box around the TORSO only
                      (shoulder to waist)

boot / no_boot      → tight box around FEET / ANKLES only
                      (below the knee)

mask / no_mask      → tight box around the FACE only
                      (forehead to chin)
```

**Do not draw a single box around the whole person.**
Each PPE item is its own separate annotation, even on the same person.

### Example: one worker, fully equipped

```
One person → 4 separate annotation boxes:
  [helmet]  around head
  [vest]    around torso
  [boot]    around feet
  [mask]    around face
```

### Example: one worker, missing helmet and mask

```
  [no_helmet]  around head   ← violation
  [vest]       around torso  ← compliant
  [boot]       around feet   ← compliant
  [no_mask]    around face   ← violation
```

### What NOT to annotate

- Do not annotate PPE items that are more than 50% occluded
- Do not annotate if the item is not clearly visible (too dark, too blurry)
- Do not annotate bystanders, vehicles, or background workers
- Do not guess — if you can't tell, skip it

---

## Recommended Training Configuration (YOLOv8)

```python
from ultralytics import YOLO

model = YOLO("yolov8m.pt")   # medium — best balance of speed vs accuracy for PPE

model.train(
    data    = "ppe.yaml",    # your dataset config (see below)
    epochs  = 150,
    imgsz   = 640,
    batch   = 16,            # reduce to 8 if you run out of VRAM
    optimizer = "AdamW",
    lr0     = 0.001,
    patience = 30,           # stop early if no improvement for 30 epochs
    augment = True,
    mosaic  = 1.0,
    flipud  = 0.1,
    fliplr  = 0.5,
    hsv_h   = 0.015,
    hsv_s   = 0.7,
    hsv_v   = 0.4,
    degrees = 5.0,
    save    = True,
    project = "ppe-training",
    name    = "best",
)
```

### Dataset YAML (`ppe.yaml`)

```yaml
path: ./datasets/ppe       # root folder
train: images/train
val:   images/val
test:  images/test

nc: 8
names:
  0: helmet
  1: no_helmet
  2: vest
  3: no_vest
  4: boot
  5: no_boot
  6: mask
  7: no_mask
```

### Dataset folder structure

```
datasets/ppe/
├── images/
│   ├── train/    (70% of images)
│   ├── val/      (20% of images)
│   └── test/     (10% of images)
└── labels/
    ├── train/    (matching .txt annotation files)
    ├── val/
    └── test/
```

Each `.txt` annotation file (YOLO format):
```
<class_id> <x_center> <y_center> <width> <height>
```
All values normalised 0–1 relative to image size.

---

## Which YOLOv8 model size to use

| Model | Size | mAP (COCO) | Inference (GPU) | Inference (CPU) | Recommendation |
|---|---|---|---|---|---|
| yolov8n | Nano | ~37% | ~2 ms | ~80 ms | Too small for PPE |
| yolov8s | Small | ~45% | ~4 ms | ~120 ms | OK for simple scenes |
| **yolov8m** | **Medium** | **~50%** | **~8 ms** | **~250 ms** | **Recommended** |
| yolov8l | Large | ~53% | ~14 ms | ~400 ms | Use if GPU available |
| yolov8x | XLarge | ~54% | ~22 ms | ~650 ms | Overkill for this app |

**Use `yolov8m`** — it hits the accuracy targets above and still runs at
~250 ms on CPU (4 fps) and ~8 ms on GPU (100+ fps potential).

---

## After training — what to check

### 1. Confusion matrix
Open `ppe-training/best/confusion_matrix.png` after training.
Check that `no_helmet` and `no_vest` rows are NOT heavily confused with
`helmet`/`vest` — that's the most common failure mode.

### 2. PR curve
Open `PR_curve.png`. Every class should have its curve in the top-right
corner (high precision AND high recall). If a violation class has a
drooping curve, you need more training images for that class.

### 3. Validation predictions
Open `val_batch0_pred.jpg`. Check that:
- Boxes are tight around the PPE item, not the whole body
- `no_helmet` is being detected on bare heads, not helmeted ones
- Multiple boxes appear on the same person (one per PPE item)

### 4. Run on real site footage
Test on video from your actual deployment location before going live.
mAP on a benchmark dataset does not always transfer to your specific site.

---

## Confidence threshold in the app

The threshold is controlled in `yolo-service/app.py`:

```python
results = model(image)[0]                    # default conf=0.25
results = model(image, conf=0.20)[0]         # lower = catch more violations
results = model(image, conf=0.35)[0]         # higher = fewer false positives
```

**For PPE safety use, set `conf=0.20`.**
It's better to get a false alarm than to miss a worker without a helmet.

---

## Free datasets to build from

| Dataset | Classes | Images | Link |
|---|---|---|---|
| PPE Detection (Roboflow) | helmet, vest, person | 3,000+ | roboflow.com/search?q=ppe |
| Hard Hat Workers | helmet, no_helmet, head | 7,000+ | roboflow.com |
| Safety Gear Detection | helmet, vest, mask, gloves | 5,000+ | roboflow.com |
| COCO (person class) | person | 120,000 | cocodataset.org |

> Use Roboflow to merge multiple datasets, relabel to your exact class names,
> and export in YOLOv8 format. It handles train/val/test splits automatically.

---

## Quick checklist before deploying `best.pt`

- [ ] `model-info` endpoint returns all 8 class names (`helmet`, `no_helmet`, `vest`, `no_vest`, `boot`, `no_boot`, `mask`, `no_mask`)
- [ ] mAP@50 ≥ 0.88 on your validation set
- [ ] Per-class recall for all `no_*` classes ≥ 0.85
- [ ] Tested on images from your actual deployment site
- [ ] Confidence threshold set to 0.20 in `app.py`
- [ ] `best.pt` placed in `yolo-service/` folder
- [ ] Python service restarted after replacing the model file



This is a **model limitation**, not an application bug. Here's exactly what's happening:

---

## The application is working correctly

The app flags violations by checking if a label starts with `"no_"`. It only flags what the model *tells it*. In this case the model returned one detection — `Vest` — and nothing else. The app processed that correctly.

---

## The model is the issue

Your `best.pt` didn't return a `no_helmet` detection for this image. There are three reasons why:

**1. Wrong scene type**
PPE models are trained on **construction site** images — workers in hard hats, hi-vis vests, with industrial backgrounds. This image is a child in a field with a hunting vest. The model has likely never seen this kind of scene during training, so it barely recognised the vest (only 59% confidence) and completely missed evaluating the head area.

**2. Confidence threshold cutoff**
Even if the model internally computed a low-confidence `no_helmet` prediction, YOLOv8's default confidence threshold is **0.25**. Anything below that gets silently dropped before the results reach your app. You can lower it to see what the model was "thinking":

```python
# In yolo-service/app.py, change this line:
results = model(image)[0]

# To:
results = model(image, conf=0.15)[0]   # lower threshold = see weaker detections
```

**3. The model may not have a `no_helmet` class at all**
It depends entirely on what your model was trained on. You can check right now — hit this endpoint while the Python service is running:

```
GET http://localhost:5001/model-info
```

Look at the `classes` field in the response. If `no_helmet` isn't in that list, the model is physically incapable of detecting a missing helmet — that class simply doesn't exist in its output layer.

---

## How to fix it at the model level

| Problem | Fix |
|---|---|
| No `no_helmet` class | Retrain with a dataset that includes `no_helmet` annotations |
| Low recall on heads without helmets | Add more negative examples (people without helmets) to training data |
| Wrong scene type | Add diverse backgrounds (outdoor, non-industrial) to training data |
| Confidence too low | Lower `conf` threshold (trade-off: more false positives) |

The app and its violation logic are sound — once the model returns a `no_helmet` box, it will be flagged red automatically. The gap is purely in `best.pt`'s training data coverage.


Created `MODEL_TRAINING_GUIDE.md` in your project root. Here's the condensed version of the key decisions:

---

## The 8 required classes

```
helmet      → compliant
no_helmet   → VIOLATION  ← most important
vest        → compliant
no_vest     → VIOLATION
boot        → compliant
no_boot     → VIOLATION
mask        → compliant
no_mask     → VIOLATION
```

The app needs **nothing else changed** — it already detects violations by checking if the label starts with `no_`. Add `glove`/`no_glove` tomorrow and it works automatically.

---

## The 3 most important things the README covers

**1. Annotation style** — each PPE item gets its own tight box. One worker = up to 4 separate boxes (head, torso, feet, face). This is the most common mistake that kills accuracy.

**2. Dataset balance** — violation classes (`no_helmet`, `no_vest`) need *more* images than compliant ones — around 2,000 each — because detecting an absent object is harder than detecting a present one.

**3. Confidence threshold** — change line in `app.py` from:
```python
results = model(image)[0]
```
to:
```python
results = model(image, conf=0.20)[0]
```
Lower threshold = catches more violations. For safety this is always the right trade-off.

---

The guide also covers the recommended model size (`yolov8m`), training config, free datasets on Roboflow you can use to bootstrap training, and a pre-deployment checklist.