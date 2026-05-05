// In-house modal — no react-modal, no Radix. Sized for a single-purpose
// cheat-sheet so we don't pull in a generic dialog primitive yet.
//
// Behaviour:
//   - Esc closes (handled on the dialog's keydown so the listener tears
//     down with the dialog instead of leaking onto window).
//   - Click outside (on the backdrop) closes.
//   - Tab and Shift+Tab cycle focus within the dialog (focus trap).
//   - Body scroll is locked while the modal is open; restored on close.
//   - On open, the close button is focused; on close, focus returns to
//     the element that was focused at open time (the trigger button).

import { KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from "react";
import styles from "./HotkeysModal.module.scss";

export interface HotkeyEntry {
  /** Displayed inside <kbd> chips. "+" splits into separate chips. */
  keys: string;
  label: string;
}

export interface HotkeySection {
  heading: string;
  entries: HotkeyEntry[];
}

export interface HotkeysModalProps {
  open: boolean;
  onClose: () => void;
  /** Override the default Global + Add Tables sections if needed. */
  sections?: HotkeySection[];
}

const DEFAULT_SECTIONS: HotkeySection[] = [
  {
    heading: "Global",
    entries: [
      { keys: "?", label: "Open this dialog" },
      { keys: "Esc", label: "Close dialogs / cancel edits" },
    ],
  },
  {
    heading: "Add Tables",
    entries: [
      { keys: "⌘/Ctrl+Enter", label: "Add the current table to the queue" },
      { keys: "Esc", label: "Cancel staged-table edit" },
    ],
  },
  {
    heading: "ERD Diagram",
    entries: [
      { keys: "Tab", label: "Move keyboard focus into the canvas / through entities" },
      { keys: "Esc", label: "Clear the entity search" },
      { keys: "+", label: "Zoom in (canvas focused)" },
      { keys: "-", label: "Zoom out (canvas focused)" },
      { keys: "0", label: "Fit diagram to the viewport" },
      { keys: "← ↑ ↓ →", label: "Pan the canvas (Shift for larger steps)" },
    ],
  },
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function HotkeysModal({
  open,
  onClose,
  sections = DEFAULT_SECTIONS,
}: HotkeysModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + focus management. Re-runs whenever `open` flips.
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first focusable inside the dialog (the close button).
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusables[0]?.focus();
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      // Return focus to the element that opened us. Optional-chained
      // because the previous element may have been removed from the DOM.
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function handleDialogKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
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

  return (
    <div
      className={styles.backdrop}
      // mousedown beats focus to keep dismissal feeling instant.
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
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          {sections.map((sec) => (
            <section key={sec.heading} className={styles.section}>
              <h3 className={styles.sectionHeading}>{sec.heading}</h3>
              <dl className={styles.list}>
                {sec.entries.map((entry, i) => (
                  <Row key={i} keys={entry.keys} label={entry.label} />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ keys, label }: HotkeyEntry) {
  // Split on "+" so each modifier becomes its own <kbd> chip with a
  // small "+" between. "⌘/Ctrl" stays as a single chip — we never split
  // on "/" because that's our shorthand for "either of these".
  // Special case: a lone "+" splits to ["", ""], which would render two
  // empty chips. Treat it as a single literal "+" chip instead.
  const parts = keys === "+" ? ["+"] : keys.split("+");
  return (
    <>
      <dt className={styles.keys}>
        {parts.map((part, i) => (
          <span key={i} className={styles.keyGroup}>
            <kbd className={styles.kbd}>{part}</kbd>
            {i < parts.length - 1 && <span className={styles.plus}>+</span>}
          </span>
        ))}
      </dt>
      <dd className={styles.label}>{label}</dd>
    </>
  );
}
