import styles from "./DetectionResults.module.css";

export default function DetectionResults({ record }) {
  if (!record) return null;

  const { violations = [], compliant = [], violationCount, compliantCount, totalDetections, mediaUrl } = record;

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Detection Results</h3>

      <div className={styles.summary}>
        <Stat label="Total Detections" value={totalDetections ?? violations.length + compliant.length} />
        <Stat label="Violations" value={violationCount ?? violations.length} color="danger" />
        <Stat label="Compliant" value={compliantCount ?? compliant.length} color="success" />
      </div>

      {violations.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle} style={{ color: "var(--danger)" }}>
            Violations
          </h4>
          {violations.map((v, i) => (
            <DetectionRow key={i} item={v} type="violation" />
          ))}
        </div>
      )}

      {compliant.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle} style={{ color: "var(--success)" }}>
            Compliant
          </h4>
          {compliant.map((c, i) => (
            <DetectionRow key={i} item={c} type="compliant" />
          ))}
        </div>
      )}

      {violations.length === 0 && compliant.length === 0 && (
        <p className={styles.empty}>No PPE items detected in this image.</p>
      )}

      {mediaUrl && (
        <a className={styles.mediaLink} href={mediaUrl} target="_blank" rel="noreferrer">
          View uploaded media on Cloudinary
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  const colorMap = { danger: "var(--danger)", success: "var(--success)" };
  return (
    <div className={styles.stat}>
      <span className={styles.statValue} style={color ? { color: colorMap[color] } : {}}>
        {value ?? "—"}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function DetectionRow({ item, type }) {
  const pct = (item.confidence * 100).toFixed(1);
  const isViolation = type === "violation";
  return (
    <div className={`${styles.row} ${isViolation ? styles.rowDanger : styles.rowSuccess}`}>
      <span className={styles.rowLabel}>
        {isViolation ? "⚠" : "✓"} {item.label}
      </span>
      <span className={styles.rowConf}>{pct}%</span>
      <div className={styles.confBar}>
        <div
          className={`${styles.confFill} ${isViolation ? styles.confDanger : styles.confSuccess}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
