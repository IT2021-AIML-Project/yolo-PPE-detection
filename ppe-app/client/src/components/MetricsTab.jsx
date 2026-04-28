import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import styles from "./MetricsTab.module.css";

const API       = "/api";
const PAGE_SIZE = 200;

const fmt = (v) => (v != null ? (v * 100).toFixed(1) + "%" : "—");

// ─── Group video frame records by videoId ────────────────────────────────────
function groupVideoFrames(records) {
  const groups = {};
  const nonVideo = [];

  records.forEach((r) => {
    if (r.sourceType === "video" && r.videoId) {
      if (!groups[r.videoId]) {
        groups[r.videoId] = {
          _type:           "videoGroup",
          videoId:         r.videoId,
          mediaUrl:        r.mediaUrl,
          timestamp:       r.timestamp,
          frames:          [],
          totalViolations: 0,
          totalCompliant:  0,
          totalDetections: 0,
        };
      }
      const g = groups[r.videoId];
      g.frames.push(r);
      g.totalViolations += r.violationCount  || 0;
      g.totalCompliant  += r.compliantCount  || 0;
      g.totalDetections += r.totalDetections || 0;
      // keep earliest timestamp as the group timestamp
      if (new Date(r.timestamp) < new Date(g.timestamp)) g.timestamp = r.timestamp;
    } else {
      nonVideo.push({ ...r, _type: "single" });
    }
  });

  const videoGroupList = Object.values(groups).map((g) => ({
    ...g,
    frames: g.frames.sort((a, b) => (a.frameInfo?.frameNumber ?? 0) - (b.frameInfo?.frameNumber ?? 0)),
  }));

  return [...nonVideo, ...videoGroupList].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MetricsTab() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [filter, setFilter]     = useState("all");
  const [page, setPage]         = useState(1);

  const load = async (sourceType = filter, pg = page) => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await axios.get(`${API}/metrics`, {
        params: { sourceType, page: pg, pageSize: PAGE_SIZE },
      });
      setData(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilter = (f) => {
    setFilter(f);
    setPage(1);
    load(f, 1);
  };

  const goPage = (pg) => {
    setPage(pg);
    load(filter, pg);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    setDeleting(id);
    try {
      await axios.delete(`${API}/records/${id}`);
      setData((prev) => ({
        ...prev,
        records: prev.records.filter((r) => r._id !== id),
      }));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setDeleting(null);
    }
  };

  const { records = [], stats = {}, modelMeta, pagination = {} } = data || {};

  const displayItems = useMemo(() => groupVideoFrames(records), [records]);

  const FILTERS = [
    { id: "all",    label: "All" },
    { id: "image",  label: "Images" },
    { id: "video",  label: "Videos" },
    { id: "webcam", label: "Webcam" },
  ];

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className={styles.topRow}>
        <div>
          <h2 className={styles.heading}>History &amp; Metrics</h2>
          <p className={styles.sub}>
            {pagination.totalCount != null
              ? `${pagination.totalCount.toLocaleString()} total records`
              : "Full database"}
          </p>
        </div>
        <button className={styles.refreshBtn} onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Source filter tabs ──────────────────────────────────────────────── */}
      <div className={styles.filterRow}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`${styles.filterBtn} ${filter === f.id ? styles.filterActive : ""}`}
            onClick={() => applyFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Aggregate stats ─────────────────────────────────────────────────── */}
      {stats && (
        <div className={styles.statsRow}>
          <StatCard label="Total Records"    value={pagination.totalCount ?? stats.totalScans ?? "—"} />
          <StatCard label="Total Violations" value={stats.totalViolations ?? "—"} color="danger" />
          <StatCard label="Total Compliant"  value={stats.totalCompliant  ?? "—"} color="success" />
          <StatCard
            label="Compliance Rate"
            value={stats.complianceRate != null ? `${stats.complianceRate}%` : "—"}
            color={stats.complianceRate >= 80 ? "success" : stats.complianceRate >= 50 ? "warning" : "danger"}
          />
          <StatCard label="Avg Inference" value={stats.avgInferenceMs != null ? `${stats.avgInferenceMs} ms` : "—"} />
        </div>
      )}

      {/* ── Class frequency ─────────────────────────────────────────────────── */}
      {stats?.classFrequency && Object.keys(stats.classFrequency).length > 0 && (
        <div className={styles.classFreqBox}>
          <p className={styles.classFreqTitle}>Detection frequency (all records)</p>
          <div className={styles.classFreqRow}>
            {Object.entries(stats.classFrequency).map(([cls, count]) => (
              <div key={cls} className={styles.classFreqItem}>
                <span className={`${styles.classChip} ${cls.toLowerCase().startsWith("no_") ? styles.chipViolation : styles.chipOk}`}>
                  {cls}
                </span>
                <span className={styles.classCount}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Model info ──────────────────────────────────────────────────────── */}
      {modelMeta && (
        <div className={styles.modelCard}>
          <h4 className={styles.modelTitle}>Model Info</h4>
          <div className={styles.modelGrid}>
            <ModelStat label="Framework" value={modelMeta.framework} />
            <ModelStat label="Classes"   value={modelMeta.numClasses} />
            <ModelStat label="Precision" value={fmt(modelMeta.trainMetrics?.precision)} />
            <ModelStat label="Recall"    value={fmt(modelMeta.trainMetrics?.recall)} />
            <ModelStat label="mAP@50"    value={fmt(modelMeta.trainMetrics?.mAP50)} />
            <ModelStat label="mAP@50-95" value={fmt(modelMeta.trainMetrics?.mAP50_95)} />
            <ModelStat label="F1"        value={fmt(modelMeta.trainMetrics?.f1)} />
          </div>
          {modelMeta.classes && (
            <div className={styles.classTagRow}>
              {Object.values(modelMeta.classes).map((c) => (
                <span key={c} className={`${styles.classTag} ${String(c).toLowerCase().startsWith("no_") ? styles.classTagViolation : styles.classTagOk}`}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Loading / empty ─────────────────────────────────────────────────── */}
      {loading && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span>Loading records…</span>
        </div>
      )}

      {!loading && displayItems.length === 0 && (
        <div className={styles.empty}>No records found.</div>
      )}

      {/* ── Record list ─────────────────────────────────────────────────────── */}
      <div className={styles.list}>
        {displayItems.map((item) =>
          item._type === "videoGroup" ? (
            <VideoGroupCard key={item.videoId} group={item} onDelete={handleDelete} isDeleting={deleting} />
          ) : (
            <RecordCard key={item._id} record={item} onDelete={handleDelete} isDeleting={deleting === item._id} />
          )
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {pagination.totalPages > 1 && (
        <div className={styles.paginationRow}>
          <button className={styles.pageBtn} onClick={() => goPage(page - 1)} disabled={page <= 1 || loading}>
            ← Prev
          </button>
          <span className={styles.pageInfo}>
            Page {pagination.page} of {pagination.totalPages}
            &nbsp;·&nbsp;{pagination.totalCount?.toLocaleString()} total
          </span>
          <button className={styles.pageBtn} onClick={() => goPage(page + 1)} disabled={page >= pagination.totalPages || loading}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Video group card ─────────────────────────────────────────────────────────
function VideoGroupCard({ group, onDelete, isDeleting }) {
  const [expanded, setExpanded] = useState(false);
  const { videoId, timestamp, totalViolations, totalCompliant, totalDetections, mediaUrl, frames } = group;
  const hasViolations = totalViolations > 0;

  return (
    <div className={`${styles.card} ${hasViolations ? styles.cardViolation : styles.cardOk}`}>
      <div className={styles.cardLeft}>
        <div className={styles.badge} style={{ background: hasViolations ? "rgba(247,95,95,0.15)" : "rgba(78,203,113,0.15)", color: hasViolations ? "var(--danger)" : "var(--success)" }}>
          {hasViolations ? `${totalViolations} violation${totalViolations !== 1 ? "s" : ""}` : "All compliant"}
        </div>
        <span className={styles.sourceChip}>video</span>
        <p className={styles.cardTime}>{new Date(timestamp).toLocaleString()}</p>
        <p className={styles.cardDetail}>
          {frames.length} frames &middot; {totalDetections} detections &middot; {totalCompliant} compliant
        </p>
        <p className={styles.cardId}>Video ID: {videoId}</p>

        {/* Frame timeline */}
        <div className={styles.miniTimeline}>
          {frames.map((f, i) => (
            <div
              key={i}
              className={styles.miniTick}
              style={{ background: (f.violationCount || 0) > 0 ? "var(--danger)" : "var(--success)" }}
              title={`Frame ${i + 1} @ ${f.frameInfo?.timestamp_s}s — ${f.violationCount || 0} violation(s)`}
            />
          ))}
        </div>

        {/* Expandable frame list */}
        <button className={styles.expandBtn} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide frames" : `Show ${frames.length} frames`}
        </button>
        {expanded && (
          <div className={styles.frameList}>
            {frames.map((f) => (
              <div key={f._id} className={`${styles.frameRow} ${(f.violationCount || 0) > 0 ? styles.frameRowViolation : ""}`}>
                <span className={styles.frameNum}>#{(f.frameInfo?.frameNumber ?? 0) + 1}</span>
                <span className={styles.frameTs}>{f.frameInfo?.timestamp_s}s</span>
                <span className={styles.frameDets}>{f.totalDetections ?? 0} det</span>
                {(f.violationCount || 0) > 0 && (
                  <span className={styles.frameViol}>⚠ {f.violationCount} violation{f.violationCount !== 1 ? "s" : ""}</span>
                )}
                {f.inferenceTime?.total_ms > 0 && (
                  <span className={styles.frameMs}>{f.inferenceTime.total_ms} ms</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.cardRight}>
        {mediaUrl && (
          <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.viewLink}>View</a>
        )}
      </div>
    </div>
  );
}

// ─── Single record card ───────────────────────────────────────────────────────
function RecordCard({ record, onDelete, isDeleting }) {
  const { _id, inferenceId, timestamp, violationCount, compliantCount, totalDetections, mediaUrl, sourceType, violations = [], inferenceTime } = record;
  const hasViolations = (violationCount ?? 0) > 0;

  return (
    <div className={`${styles.card} ${hasViolations ? styles.cardViolation : styles.cardOk}`}>
      <div className={styles.cardLeft}>
        <div className={styles.badge} style={{ background: hasViolations ? "rgba(247,95,95,0.15)" : "rgba(78,203,113,0.15)", color: hasViolations ? "var(--danger)" : "var(--success)" }}>
          {hasViolations ? `${violationCount} violation${violationCount !== 1 ? "s" : ""}` : "All compliant"}
        </div>
        <span className={styles.sourceChip}>{sourceType}</span>
        <p className={styles.cardTime}>{new Date(timestamp).toLocaleString()}</p>
        <p className={styles.cardDetail}>
          {totalDetections ?? (violationCount + compliantCount)} detections
          {inferenceTime?.total_ms > 0 && <>&nbsp;&middot;&nbsp;{inferenceTime.total_ms} ms</>}
        </p>
        <p className={styles.cardId}>{inferenceId}</p>
        {violations.slice(0, 3).map((v, i) => (
          <span key={i} className={styles.violationTag}>{v.label}</span>
        ))}
        {violations.length > 3 && <span className={styles.violationTag}>+{violations.length - 3} more</span>}
      </div>
      <div className={styles.cardRight}>
        {mediaUrl && (
          <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.viewLink}>View</a>
        )}
        <button className={styles.deleteBtn} onClick={() => onDelete(_id)} disabled={isDeleting}>
          {isDeleting ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
  const colorMap = { danger: "var(--danger)", success: "var(--success)", warning: "var(--warning)" };
  return (
    <div className={styles.statCard}>
      <span className={styles.statValue} style={color ? { color: colorMap[color] } : {}}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function ModelStat({ label, value }) {
  return (
    <div className={styles.modelStat}>
      <span className={styles.modelStatLabel}>{label}</span>
      <span className={styles.modelStatValue}>{value ?? "—"}</span>
    </div>
  );
}
