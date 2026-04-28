# PPE Detection System

Real-time Personal Protective Equipment detection using YOLOv8, Flask, Node.js, React, MongoDB and Cloudinary.

```
Browser (React)  →  Node/Express API  →  Python Flask + YOLO  →  MongoDB + Cloudinary
```

**Features**
- Upload images for instant detection with bounding boxes
- Upload videos — processed frame-by-frame at 2 fps with live bounding box display
- Live webcam detection with auto-detect mode
- Full detection history stored in MongoDB (per-frame video metrics, inference times, class counts)
- Model info panel (precision, recall, mAP, F1, class list)

---

## Prerequisites

| Tool | Minimum version | Check |
|---|---|---|
| Python | 3.9+ | `python --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Git | any | `git --version` |

You also need free accounts on:
- **MongoDB Atlas** — [mongodb.com/atlas](https://mongodb.com/atlas) (free M0 cluster, 512 MB)
- **Cloudinary** — [cloudinary.com](https://cloudinary.com) (free tier, 25 GB/month)

---

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/ppe-detection.git
cd ppe-detection
```

### 2. Add your model file

The `best.pt` weights file is **not included in the repo** (too large for git).
Copy your trained YOLOv8 model file into the yolo-service folder:

```bash
# Windows
copy "path\to\your\best.pt" yolo-service\best.pt

# Mac / Linux
cp /path/to/your/best.pt yolo-service/best.pt
```

> Don't have a model yet? See [MODEL_TRAINING_GUIDE.md](./MODEL_TRAINING_GUIDE.md) for how to train one with the correct 8 classes (helmet, no_helmet, vest, no_vest, boot, no_boot, mask, no_mask).

### 3. Set up the Python YOLO service

```bash
cd yolo-service

# Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# Mac / Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Set up the Node server

```bash
cd server
npm install
```

Create the environment file:

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Open `server/.env` and fill in your credentials:

```env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ppe_detection
CLOUDINARY_NAME=your_cloud_name
CLOUDINARY_KEY=your_api_key
CLOUDINARY_SECRET=your_api_secret
YOLO_SERVICE_URL=http://localhost:5001
PORT=5000
```

**Getting your credentials:**

- **MongoDB Atlas** → Clusters → Connect → Connect your application → copy the connection string, replace `<password>` with your actual password and add `/ppe_detection` before the `?`
- **Cloudinary** → Dashboard → copy Cloud Name, API Key, API Secret

### 5. Install the React client

```bash
cd client
npm install
```

---

## Running locally

Open **3 terminals** and run one command in each:

```bash
# Terminal 1 — Python YOLO service (port 5001)
cd yolo-service
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac / Linux
python app.py
```

```bash
# Terminal 2 — Node API server (port 5000)
cd server
node server.js
```

```bash
# Terminal 3 — React frontend (port 3000)
cd client
npm run dev
```

Open **http://localhost:3000** in your browser.

### Expected startup output

**Terminal 1 (Python):**
```
Loading YOLOv8 model from: best.pt
Model loaded successfully.
Running on http://0.0.0.0:5001
```

**Terminal 2 (Node):**
```
MongoDB connected
Server running on http://localhost:5000
```

**Terminal 3 (React):**
```
VITE ready in Xms
Local: http://localhost:3000
```

---

## Project structure

```
ppe-detection/
│
├── yolo-service/           Python Flask — runs best.pt
│   ├── app.py              /health, /detect, /model-info endpoints
│   ├── requirements.txt
│   └── .env.example
│
├── server/                 Node.js Express — API layer
│   ├── server.js           All API routes
│   ├── package.json
│   └── .env.example        ← copy to .env and fill in
│
├── client/                 React (Vite) — frontend
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   │       ├── UploadTab.jsx         Image upload + detection
│   │       ├── VideoProcessor.jsx    Frame-by-frame video detection
│   │       ├── WebcamTab.jsx         Live webcam detection
│   │       ├── MetricsTab.jsx        History, stats, model info
│   │       ├── DetectionCanvas.jsx   Bounding box overlay
│   │       └── DetectionResults.jsx  Results card
│   ├── index.html
│   └── vite.config.js
│
├── .gitignore
├── README.md               This file
├── METRICS.md              Metric definitions, inference speed guide, frame rate guide
└── MODEL_TRAINING_GUIDE.md How to train best.pt for this application
```

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/detect` | Detect PPE in an image or webcam frame |
| `POST` | `/api/upload-video` | Upload video to Cloudinary |
| `POST` | `/api/detect-frame` | Run detection on a single video frame |
| `GET` | `/api/metrics` | Full detection history + aggregate stats |
| `GET` | `/api/model-info` | Model class list and training metrics |
| `DELETE` | `/api/records/:id` | Delete a record |
| `GET` | `/api/health` | Server liveness check |

---

## Pushing to GitHub (first time)

### 1. Create a new repository on GitHub

Go to [github.com/new](https://github.com/new):
- Name: `ppe-detection` (or whatever you like)
- Visibility: Private (recommended — your `.env.example` is public but the actual `.env` is gitignored)
- **Do not** add a README or .gitignore — you already have them

### 2. Initialise git and push

Run these commands from the project root:

```bash
git init
git add .
git commit -m "Initial commit — PPE detection system"
git branch -M main
git remote add origin https://github.com/<your-username>/ppe-detection.git
git push -u origin main
```

Replace `<your-username>` with your GitHub username.

### 3. Verify what was pushed

```bash
git status          # should say "nothing to commit"
git log --oneline   # should show your commit
```

Check on GitHub that these files are **NOT** in the repo (gitignored):
- `server/.env` ← contains your real secrets
- `yolo-service/best.pt` ← model weights
- `node_modules/` anywhere
- `yolo-service/venv/`

---

## Cloning on a new machine (after pushing)

```bash
git clone https://github.com/<your-username>/ppe-detection.git
cd ppe-detection
```

Then follow steps 2–5 in **Getting started** above (add `best.pt`, fill in `.env`, install dependencies).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'models'` | Your `best.pt` is a YOLOv5 model. See [switching to YOLOv5 loader](#) or retrain with YOLOv8 |
| `INTERVAL_MS is not defined` in browser console | Hard-refresh the page (`Ctrl+Shift+R`) |
| `[ERROR] Missing required environment variables` | You haven't created `server/.env` — copy from `.env.example` and fill in |
| `MongoDB error: bad auth` | Wrong password in `MONGO_URI`. Re-check Atlas → Database Access |
| Camera not working | Browser needs `localhost` or `https://` for camera access. Make sure you're on `http://localhost:3000` not an IP address |
| Video upload 500 error | Restart the Node server after code changes |
| `torch.cuda` not found | Install the CUDA build of PyTorch: `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121` |

---

## GPU acceleration (optional but recommended)

If you have an NVIDIA GPU, install the CUDA build of PyTorch inside the venv for much faster inference:

```bash
cd yolo-service
venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

Replace `cu121` with your CUDA version (`cu118`, `cu124`, etc.). Check with `nvidia-smi`.

Expected inference times:

| Hardware | Inference per frame |
|---|---|
| CPU | 150–600 ms |
| NVIDIA GPU (CUDA) | 5–30 ms |

---

## Free deployment (optional)

| What | Where | Notes |
|---|---|---|
| React frontend | [Vercel](https://vercel.com) | `npm run build` → deploy `client/dist` |
| Node server | [Render.com](https://render.com) | Free tier, set env vars in dashboard |
| Python service | [Render.com](https://render.com) | Free tier, `best.pt` must be included |
| Database | [MongoDB Atlas](https://mongodb.com/atlas) | Free M0 512 MB |
| Media storage | [Cloudinary](https://cloudinary.com) | Free 25 GB/month |
