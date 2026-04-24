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
  loading?: boolean;
  loadingHint?: string;
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
  loading,
  loadingHint = "Parsing XML…",
  onFile,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const blocked = disabled || loading;

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (blocked) return;
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
          blocked ? styles.disabled : ""
        } ${loading ? styles.loading : ""}`}
        tabIndex={0}
        role="button"
        aria-label={hint}
        aria-busy={loading || undefined}
        onClick={() => !blocked && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !blocked) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {loading ? (
          <>
            <div className={styles.spinner} aria-hidden />
            <div className={styles.hint}>{loadingHint}</div>
            <div className={styles.subhint}>Please wait</div>
          </>
        ) : (
          <>
            <div className={styles.icon} aria-hidden>↓</div>
            <div className={styles.hint}>{hint}</div>
            {subhint && <div className={styles.subhint}>{subhint}</div>}
          </>
        )}
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
