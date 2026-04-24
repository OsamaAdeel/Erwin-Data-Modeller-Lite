import { ChangeEvent, DragEvent, useRef, useState } from "react";
import styles from "./FileDrop.module.scss";

export interface FileDropProps {
  accept?: string;
  hint: string;
  subhint?: string;
  loadedName?: string;
  loadedMeta?: string;
  error?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}

export default function FileDrop({
  accept = ".xml,application/xml,text/xml",
  hint,
  subhint,
  loadedName,
  loadedMeta,
  error,
  disabled,
  onFile,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.zone} ${dragOver ? styles.over : ""} ${
          disabled ? styles.disabled : ""
        }`}
        tabIndex={0}
        role="button"
        aria-label={hint}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className={styles.icon} aria-hidden>↓</div>
        <div className={styles.hint}>{hint}</div>
        {subhint && <div className={styles.subhint}>{subhint}</div>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={handleChange}
        />
      </div>

      {loadedName && (
        <div className={styles.loaded}>
          <div className={styles.loadedName}>{loadedName}</div>
          {loadedMeta && <div className={styles.loadedMeta}>{loadedMeta}</div>}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
