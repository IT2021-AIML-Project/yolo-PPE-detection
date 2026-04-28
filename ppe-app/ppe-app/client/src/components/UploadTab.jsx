import { useState, useRef, useEffect } from "react";
import axios from "axios";
import DetectionResults from "./DetectionResults";
import DetectionCanvas from "./DetectionCanvas";
import VideoProcessor from "./VideoProcessor";
import styles from "./UploadTab.module.css";

const API = "/api";
const MAX_FILE_MB = 200;

export default function UploadTab() {
  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState(null);
  const [previewType, setPreviewType] = useState("image");
  const [loading, setLoading]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError]           = useState(null);
  const [record, setRecord]         = useState(null);
  const [dragging, setDragging]     = useState(false);
  const inputRef                    = useRef(null);
  const prevPreviewRef              = useRef(null);

  useEffect(() => {
    if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    prevPreviewRef.current = preview;
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  const handleFile = (f) => {
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large. Max ${MAX_FILE_MB} MB.`);
      return;
    }
    setError(null);
    setRecord(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setPreviewType(f.type.startsWith("video") ? "video" : "image");
  };

  const handleFileChange = (e) => handleFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const runImageDetection = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setRecord(null);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sourceType", "image");
      const { data } = await axios.post(`${API}/detect`, form, {
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      setRecord(data.record);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  // Auto-run detection when an image is selected
  useEffect(() => {
    if (file && previewType === "image") runImageDetection();
  }, [file]);             // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className={styles.heading}>Upload Image or Video</h2>
      <p className={styles.sub}>
        Images are detected instantly. Videos are processed frame-by-frame at 2 fps (full length).
      </p>

      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
        onClick={() => inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input ref={inputRef} type="file" accept="image/*,video/*" onChange={handleFileChange} />
        <div className={styles.dropIcon}>&#8679;</div>
        <p className={styles.dropText}>
          {dragging ? "Drop your file here" : "Click or drag & drop an image or video"}
        </p>
        <p className={styles.dropHint}>JPG, PNG, MP4, MOV · max {MAX_FILE_MB} MB</p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Image flow ─────────────────────────────────────────────────────── */}
      {previewType === "image" && preview && (
        <>
          {loading && (
            <div className={styles.loadingBox}>
              <div className={styles.spinner} />
              <span>
                {uploadProgress > 0 && uploadProgress < 100
                  ? `Uploading… ${uploadProgress}%`
                  : "Running detection…"}
              </span>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          )}
          {!loading && (
            <div className={styles.previewBox}>
              <DetectionCanvas
                src={preview}
                detections={record?.detections ?? []}
                mediaType="image"
              />
            </div>
          )}
          <DetectionResults record={record} />
        </>
      )}

      {/* ── Video flow — handed off to VideoProcessor ───────────────────────── */}
      {previewType === "video" && file && preview && (
        <VideoProcessor file={file} previewUrl={preview} />
      )}
    </div>
  );
}
