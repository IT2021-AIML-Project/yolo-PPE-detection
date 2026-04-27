import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import DetectionResults from "./DetectionResults";
import styles from "./WebcamTab.module.css";

const API = "/api";

// ─── Draw bounding boxes on overlay canvas ───────────────────────────────────
function drawBoxes(canvas, video, detections) {
  if (!canvas || !video) return;
  const W = video.offsetWidth;
  const H = video.offsetHeight;
  if (!W || !H) return;
  canvas.width  = W;
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

    const sx = x1 * scaleX, sy = y1 * scaleY;
    const sw = (x2 - x1) * scaleX, sh = (y2 - y1) * scaleY;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    const text = `${label}  ${(confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(text).width;
    const pad = 5, pillH = 20;
    const pillY = sy > pillH ? sy - pillH : sy + sh;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(sx, pillY, textW + pad * 2, pillH, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, sx + pad, pillY + pillH - 5);
  });
}

export default function WebcamTab() {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const canvasRef  = useRef(null);   // hidden — frame capture
  const overlayRef = useRef(null);   // visible — bounding boxes

  // Loop control
  const runningRef    = useRef(false);
  const lastFrameRef  = useRef(0);   // timestamp of last completed detection

  const [active, setActive]     = useState(false);
  const [live, setLive]         = useState(false);   // real-time loop running
  const [record, setRecord]     = useState(null);    // latest detection record
  const [error, setError]       = useState(null);
  const [devices, setDevices]   = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [saving, setSaving]     = useState(false);   // manual snapshot save

  // Live stats
  const [fps, setFps]           = useState(0);
  const [latency, setLatency]   = useState(0);
  const fpsCountRef             = useRef({ frames: 0, lastTick: Date.now() });

  // ── Device enumeration ───────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      const cams = devs.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      if (cams.length > 0) setSelectedDevice(cams[0].deviceId);
    });
    return () => stopCamera();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera start / stop ──────────────────────────────────────────────────
  const startCamera = async () => {
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

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext("2d");
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
    setActive(false);
    setLive(false);
    setFps(0);
    setLatency(0);
  }, []);

  // ── Capture one frame as a JPEG blob ────────────────────────────────────
  const captureBlob = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.75));
  }, []);

  // ── Real-time detection loop ─────────────────────────────────────────────
  // Runs as fast as the server can respond — no fixed interval.
  const detectionLoop = useCallback(async () => {
    while (runningRef.current) {
      const blob = await captureBlob();
      if (!blob || !runningRef.current) break;

      const t0 = performance.now();
      try {
        const form = new FormData();
        form.append("file", blob, "frame.jpg");
        form.append("sourceType", "webcam");
        const { data } = await axios.post(`${API}/detect`, form);

        if (!runningRef.current) break;

        const ms = Math.round(performance.now() - t0);
        setLatency(ms);
        setRecord(data.record);
        drawBoxes(overlayRef.current, videoRef.current, data.record?.detections);

        // Update FPS counter
        const fc = fpsCountRef.current;
        fc.frames++;
        const elapsed = Date.now() - fc.lastTick;
        if (elapsed >= 1000) {
          setFps(Math.round((fc.frames * 1000) / elapsed));
          fc.frames  = 0;
          fc.lastTick = Date.now();
        }
      } catch (err) {
        if (!runningRef.current) break;
        setError(err.response?.data?.error || err.message);
        await new Promise((r) => setTimeout(r, 500)); // back off on error
      }
    }
  }, [captureBlob]);

  const startLive = useCallback(() => {
    if (!active) return;
    runningRef.current = true;
    fpsCountRef.current = { frames: 0, lastTick: Date.now() };
    setLive(true);
    setError(null);
    detectionLoop();
  }, [active, detectionLoop]);

  const stopLive = useCallback(() => {
    runningRef.current = false;
    setLive(false);
    setFps(0);
    setLatency(0);
  }, []);

  // ── Manual single capture ────────────────────────────────────────────────
  const captureOnce = useCallback(async () => {
    const blob = await captureBlob();
    if (!blob) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("file", blob, "frame.jpg");
      form.append("sourceType", "webcam");
      const { data } = await axios.post(`${API}/detect`, form);
      setRecord(data.record);
      drawBoxes(overlayRef.current, videoRef.current, data.record?.detections);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, [captureBlob]);

  // ── Save current frame to MongoDB ────────────────────────────────────────
  // During live mode the loop sends to /detect which already saves to DB.
  // This button is only needed when NOT in live mode.
  const saveSnapshot = useCallback(async () => {
    const blob = await captureBlob();
    if (!blob) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", blob, "snapshot.jpg");
      form.append("sourceType", "webcam");
      const { data } = await axios.post(`${API}/detect`, form);
      setRecord(data.record);
      drawBoxes(overlayRef.current, videoRef.current, data.record?.detections);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }, [captureBlob]);

  const violations = record?.violations ?? [];
  const hasViolation = violations.length > 0;

  return (
    <div>
      <h2 className={styles.heading}>Live Webcam Detection</h2>
      <p className={styles.sub}>
        Real-time mode sends frames as fast as the server can process them.
      </p>

      {/* Camera selector */}
      {devices.length > 1 && (
        <div className={styles.deviceRow}>
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
        </div>
      )}

      {/* Video feed */}
      <div className={styles.camBox}>
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className={`${styles.video} ${!active ? styles.videoHidden : ""}`}
        />
        <canvas ref={overlayRef} className={styles.boxOverlay} />

        {!active && (
          <div className={styles.camPlaceholder}>
            <div className={styles.camIcon}>&#9654;</div>
            <p>Camera not started</p>
          </div>
        )}

        {/* Live stats HUD */}
        {live && (
          <div className={styles.hud}>
            <span className={styles.hudDot} />
            <span className={styles.hudFps}>{fps} fps</span>
            <span className={styles.hudLatency}>{latency} ms</span>
            {hasViolation && (
              <span className={styles.hudViolation}>
                ⚠ {violations.length} violation{violations.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {!active ? (
          <button className={styles.btnPrimary} onClick={startCamera}>
            Start Camera
          </button>
        ) : (
          <>
            {!live ? (
              <>
                <button className={styles.btnLive} onClick={startLive}>
                  &#9679; Go Live
                </button>
                <button className={styles.btnSecondary} onClick={captureOnce}>
                  Capture Once
                </button>
                <button className={styles.btnSave} onClick={saveSnapshot} disabled={saving}>
                  {saving ? "Saving…" : "Save Snapshot"}
                </button>
              </>
            ) : (
              <button className={styles.btnWarning} onClick={stopLive}>
                &#9632; Stop Live
              </button>
            )}
            <button className={styles.btnDanger} onClick={stopCamera}>
              Stop Camera
            </button>
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Live detections list */}
      {record && (
        <div className={styles.liveResults}>
          <div className={styles.liveResultsRow}>
            <div className={styles.liveCount}>
              <span className={styles.liveCountNum} style={{ color: "var(--text)" }}>
                {record.totalDetections ?? 0}
              </span>
              <span className={styles.liveCountLabel}>detected</span>
            </div>
            <div className={styles.liveCount}>
              <span className={styles.liveCountNum} style={{ color: "var(--danger)" }}>
                {record.violationCount ?? 0}
              </span>
              <span className={styles.liveCountLabel}>violations</span>
            </div>
            <div className={styles.liveCount}>
              <span className={styles.liveCountNum} style={{ color: "var(--success)" }}>
                {record.compliantCount ?? 0}
              </span>
              <span className={styles.liveCountLabel}>compliant</span>
            </div>
          </div>
          <div className={styles.liveTagRow}>
            {(record.violations ?? []).map((v, i) => (
              <span key={i} className={styles.tagViolation}>⚠ {v.label} {(v.confidence * 100).toFixed(0)}%</span>
            ))}
            {(record.compliant ?? []).map((c, i) => (
              <span key={i} className={styles.tagOk}>✓ {c.label} {(c.confidence * 100).toFixed(0)}%</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
