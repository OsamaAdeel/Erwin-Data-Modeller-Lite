import { ReactNode } from "react";
import styles from "./Badge.module.scss";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

export default function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[`t-${tone}`]}`}>{children}</span>;
}
