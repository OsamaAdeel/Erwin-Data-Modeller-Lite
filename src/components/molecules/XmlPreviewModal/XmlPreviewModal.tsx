// Read-only modal that displays the would-be output XML before the user
// commits to a download. Same focus-trap + scroll-lock + dismiss
// patterns as ConfirmModal — could be lifted to a shared Dialog
// primitive once a third caller appears.

import { KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import Button from "@/components/atoms/Button";
import styles from "./XmlPreviewModal.module.scss";

export interface XmlPreviewModalProps {
  open: boolean;
  xml: string;
  filename: string;
  tablesAdded: number;
  /** Triggered when the user confirms — caller should dispatch the real generate. */
  onDownload: () => void;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function XmlPreviewModal({
  open,
  xml,
  filename,
  tablesAdded,
  onDownload,
  onClose,
}: XmlPreviewModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    if (dialog) {
      const closeBtn = dialog.querySelector<HTMLElement>('[data-role="close"]');
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (closeBtn ?? focusables[0])?.focus();
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Reset the "Copied!" hint whenever a new preview is opened.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open, xml]);

  if (!open) return null;

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const ae = document.activeElement;
    if (e.shiftKey && ae === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && ae === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(xml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const sizeKb = (xml.length / 1024).toFixed(1);
  const lineCount = xml.split("\n").length;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 id={titleId} className={styles.title}>Preview output XML</h2>
            <p className={styles.subtitle}>
              <code className={styles.filename}>{filename}</code>
              <span className={styles.dot}>·</span>
              <span>{tablesAdded} new entit{tablesAdded === 1 ? "y" : "ies"}</span>
              <span className={styles.dot}>·</span>
              <span>{sizeKb} KB</span>
              <span className={styles.dot}>·</span>
              <span>{lineCount.toLocaleString()} lines</span>
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close preview"
            data-role="close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <pre className={styles.code} tabIndex={0} aria-label="Generated XML preview">
          {xml}
        </pre>

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy XML"}
          </Button>
          <span className={styles.actionsSpacer} />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={onDownload}>
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
