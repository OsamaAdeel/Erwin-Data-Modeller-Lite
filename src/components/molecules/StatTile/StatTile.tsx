import { ReactNode } from "react";
import styles from "./StatTile.module.scss";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "warning";
  /** Plain-text tooltip explaining what this metric represents. */
  hint?: string;
}

export default function StatTile({ label, value, tone = "neutral", hint }: StatTileProps) {
  return (
    <div
      className={`${styles.tile} ${tone === "warning" ? styles.warn : ""}`}
      title={hint}
    >
      <div className={styles.value}>{value}</div>
      <div className={styles.label}>
        {label}
        {hint && <span className={styles.hintMark} aria-hidden> ⓘ</span>}
      </div>
    </div>
  );
}
