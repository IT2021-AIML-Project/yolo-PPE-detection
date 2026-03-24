import { useState } from "react";
import UploadTab from "./components/UploadTab";
import WebcamTab from "./components/WebcamTab";
import MetricsTab from "./components/MetricsTab";
import styles from "./App.module.css";

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "webcam", label: "Webcam" },
  { id: "metrics", label: "History & Metrics" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("upload");

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>&#9741;</span>
          <span>PPE Detection</span>
        </div>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.main}>
        {activeTab === "upload" && <UploadTab />}
        {activeTab === "webcam" && <WebcamTab />}
        {activeTab === "metrics" && <MetricsTab />}
      </main>
    </div>
  );
}
