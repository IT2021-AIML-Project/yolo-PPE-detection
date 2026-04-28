import { useEffect, useRef, useCallback } from "react";
import styles from "./DetectionCanvas.module.css";

/**
 * Renders an image with YOLO bounding boxes drawn on a canvas overlay.
 * Handles scaling automatically — boxes are in original-image pixel coords.
 */
export default function DetectionCanvas({ src, detections = [], mediaType }) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const displayW = img.offsetWidth;
    const displayH = img.offsetHeight;
    if (!displayW || !displayH) return;

    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, displayW, displayH);

    if (!detections.length) return;

    const scaleX = displayW / img.naturalWidth;
    const scaleY = displayH / img.naturalHeight;

    detections.forEach(({ label, confidence, box }) => {
      const [x1, y1, x2, y2] = box;
      const isViolation = label.toLowerCase().startsWith("no_");
      const color = isViolation ? "#f75f5f" : "#4ecb71";

      const sx = x1 * scaleX;
      const sy = y1 * scaleY;
      const sw = (x2 - x1) * scaleX;
      const sh = (y2 - y1) * scaleY;

      // Bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      // Label pill
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
  }, [detections]);

  // Redraw whenever detections or src changes
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth) {
      draw();
    } else {
      img.addEventListener("load", draw);
      return () => img.removeEventListener("load", draw);
    }
  }, [draw, src]);

  // Redraw on window resize so boxes stay aligned
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  if (mediaType === "video") {
    return <video src={src} controls className={styles.media} />;
  }

  return (
    <div className={styles.wrapper}>
      <img
        ref={imgRef}
        src={src}
        alt="Detection preview"
        className={styles.media}
        onLoad={draw}
      />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
