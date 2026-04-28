import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import DetectionResults from "./DetectionResults";
import styles from "./WebcamTab.module.css";

function drawBoxes(canvas, video, detections) {
  if (!canvas || !video) return;
  const W = video.offsetWidth;
  const H = video.offsetHeight;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (!detections?.length) return;

  const scaleX = W / video.videoWidth;
  const scaleY = H / video.videoHeight;

  detections.forEach(({ label, confidence, box }) => {
    const [x1, y1, x2, y2] = box;
    const isViolation = label.toLowerCase().startsWith("no_");
    const color = isViolation ? "#f75f5f" : "#4ecb71";

    const sx = x1 * scaleX;
    const sy = y1 * scaleY;
    const sw = (x2 - x1) * scaleX;
    const sh = (y2 - y1) * scaleY;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    const text = `${label}  ${(confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(text).width;
    const pad = 5;
    const pillH = 20;
    const pillY = sy > pillH ? sy - pillH : sy + sh;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(sx, pillY, textW + pad * 2, pillH, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, sx + pad, pillY + pillH - 5);
  });
}

const API = "/api";

// Available auto-detect intervals. Lower = faster but more server load.
const FPS_OPTIONS = [
  { label: "0.5 fps  (every 2s) — recommended", value: 2000 },
  { label: "1 fps    (every 1s)",                value: 1000 },
  { label: "2 fps    (every 500ms)",             value: 500  },
  { label: "5 fps    (every 200ms) — GPU only",  value: 200  },
];

export default function WebcamTab() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const canvasRef = useRef(null);       // hidden canvas for frame capture
  const overlayRef = useRef(null);      // visible canvas for bounding boxes
  const captureFrameRef = useRef(null);
  const loadingRef = useRef(false);

  const [active, setActive] = useState(false);
  const [autoDetect, setAutoDetect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [intervalMs, setIntervalMs] = useState(2000);

  const stopWebcam = useCallback(() => {
    clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext("2d");
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
    setActive(false);
    setAutoDetect(false);
  }, []);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      const cams = devs.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      if (cams.length > 0) setSelectedDevice(cams[0].deviceId);
    });
    return () => stopWebcam();
  }, [stopWebcam]);

  const startWebcam = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedDevice ? { exact: selectedDevice } : undefined },
      });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      setActive(true);
    } catch (err) {
      setError("Camera access denied: " + err.message);
    }
  };

  const captureFrame = useCallback(async () => {
    // Use ref to check loading so stale closures inside setInterval don't
    // fire concurrent requests.
    if (!videoRef.current || loadingRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
          const form = new FormData();
          form.append("file", blob, "webcam-frame.jpg");
          form.append("sourceType", "webcam");
          const { data } = await axios.post(`${API}/detect`, form);
          setRecord(data.record);
          drawBoxes(overlayRef.current, videoRef.current, data.record?.detections);
        } catch (err) {
          setError(err.response?.data?.error || err.message);
        } finally {
          loadingRef.current = false;
          setLoading(false);
          resolve();
        }
      }, "image/jpeg", 0.9);
    });
  }, []);

  // Keep the ref in sync so the interval always calls the latest version.
  captureFrameRef.current = captureFrame;

  const toggleAutoDetect = useCallback(() => {
    if (autoDetect) {
      clearInterval(intervalRef.current);
      setAutoDetect(false);
    } else {
      captureFrameRef.current();
      intervalRef.current = setInterval(() => captureFrameRef.current(), intervalMs);
      setAutoDetect(true);
    }
  }, [autoDetect, intervalMs]);

  return (
    <div>
      <h2 className={styles.heading}>Live Webcam Detection</h2>
      <p className={styles.sub}>
        Stream your webcam and capture frames for real-time PPE detection.
      </p>

      <div className={styles.deviceRow}>
        {devices.length > 1 && (
          <>
            <label className={styles.label}>Camera</label>
            <select
              className={styles.select}
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              disabled={active}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </>
        )}
        <label className={styles.label}>Auto-detect rate</label>
        <select
          className={styles.select}
          value={intervalMs}
          onChange={(e) => setIntervalMs(Number(e.target.value))}
          disabled={autoDetect}
        >
          {FPS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.camBox}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`${styles.video} ${!active ? styles.videoHidden : ""}`}
        />
        {/* Bounding box overlay — sits on top of the video */}
        <canvas ref={overlayRef} className={styles.boxOverlay} />
        {!active && (
          <div className={styles.camPlaceholder}>
            <div className={styles.camIcon}>&#9654;</div>
            <p>Camera not started</p>
          </div>
        )}
        {loading && (
          <div className={styles.camOverlay}>
            <div className={styles.spinner} />
            <span>Detecting&hellip;</span>
          </div>
        )}
        {/* Hidden canvas used for frame capture */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>

      <div className={styles.controls}>
        {!active ? (
          <button className={styles.btnPrimary} onClick={startWebcam}>
            Start Camera
          </button>
        ) : (
          <>
            <button
              className={styles.btnPrimary}
              onClick={captureFrame}
              disabled={loading}
            >
              {loading ? "Detecting…" : "Capture & Detect"}
            </button>
            <button
              className={autoDetect ? styles.btnWarning : styles.btnSecondary}
              onClick={toggleAutoDetect}
              disabled={loading && !autoDetect}
            >
              {autoDetect ? "Stop Auto-Detect" : `Auto-Detect (${intervalMs / 1000}s)`}
            </button>
            <button className={styles.btnDanger} onClick={stopWebcam}>
              Stop Camera
            </button>
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <DetectionResults record={record} />
    </div>
  );
}
