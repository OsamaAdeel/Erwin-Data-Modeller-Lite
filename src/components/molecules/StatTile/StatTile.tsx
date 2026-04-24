import { ReactNode } from "react";
import styles from "./StatTile.module.scss";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "warning";
}

export default function StatTile({ label, value, tone = "neutral" }: StatTileProps) {
  return (
    <div className={`${styles.tile} ${tone === "warning" ? styles.warn : ""}`}>
      <div className={styles.value}>{value}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}
