import { ReactNode } from "react";
import styles from "./Field.module.scss";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export default function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={htmlFor}>{label}</label>
      {children}
      {error
        ? <div className={styles.error}>{error}</div>
        : hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
