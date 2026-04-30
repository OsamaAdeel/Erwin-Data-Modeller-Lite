// In-house combobox/listbox dropdown.
//
// We intentionally avoid Radix / Headless UI: the project ships zero new
// runtime deps and the surface we need is small. Behaviour matches the
// native <select> for the keyboard set we care about (Arrow keys, Enter,
// Space, Esc, Tab, Home/End, type-to-select) plus modern ARIA so the
// dark-theme styling can actually take hold.

import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./Select.module.scss";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  /** Optional ARIA label for the trigger when there is no visible <label>. */
  "aria-label"?: string;
}

/** Multi-char type-to-select buffer window. */
const TYPE_AHEAD_MS = 600;
/** Popover max-height + breathing room used by the flip-up calculation. */
const POPOVER_MAX_HEIGHT = 248;

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  invalid,
  className,
  id,
  "aria-label": ariaLabel,
}: SelectProps) {
  const reactId = useId();
  const componentId = id ?? `select-${reactId}`;
  const listboxId = `${componentId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [flipUp, setFlipUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeBuffer = useRef<{ value: string; until: number }>({ value: "", until: 0 });

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  // Decide whether the popover sits below or above the trigger based on
  // available room. Recomputed on open and on scroll/resize while open.
  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    setFlipUp(spaceBelow < POPOVER_MAX_HEIGHT && spaceAbove > spaceBelow);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    positionPopover();
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
  }, [disabled, positionPopover, selectedIdx]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIdx(-1);
  }, []);

  const selectAt = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt) return;
      onChange(opt.value);
      closeMenu();
      // Return focus to the trigger so subsequent Tab moves outwards naturally.
      triggerRef.current?.focus();
    },
    [options, onChange, closeMenu]
  );

  // Keep the active option in view as the highlight moves.
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const item = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    // jsdom doesn't implement scrollIntoView; guard so unit tests pass.
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIdx]);

  // Click-outside closes. Uses pointerdown so menus close before any click
  // handler on the rest of the page fires.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, closeMenu]);

  // Re-position on layout shifts while open.
  useEffect(() => {
    if (!open) return;
    const onAny = () => positionPopover();
    window.addEventListener("scroll", onAny, true);
    window.addEventListener("resize", onAny);
    return () => {
      window.removeEventListener("scroll", onAny, true);
      window.removeEventListener("resize", onAny);
    };
  }, [open, positionPopover]);

  function moveActive(delta: number) {
    if (options.length === 0) return;
    setActiveIdx((cur) => {
      const start = cur < 0 ? (delta > 0 ? -1 : 0) : cur;
      const next = (start + delta + options.length) % options.length;
      return next;
    });
  }

  // Type-to-select. A 600 ms window lets the user type "VAR" and land on
  // VARCHAR2 even though "V" alone would jump elsewhere first.
  function typeJump(char: string) {
    const now = Date.now();
    const fresh = now > typeBuffer.current.until;
    typeBuffer.current = {
      value: (fresh ? "" : typeBuffer.current.value) + char.toLowerCase(),
      until: now + TYPE_AHEAD_MS,
    };
    const prefix = typeBuffer.current.value;
    const start = activeIdx >= 0 ? activeIdx : -1;
    for (let i = 1; i <= options.length; i++) {
      const idx = (start + i) % options.length;
      if (options[idx].label.toLowerCase().startsWith(prefix)) {
        setActiveIdx(idx);
        return;
      }
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    // Modifier-keyed combos are reserved for the surrounding form
    // (e.g. ⌘/Ctrl+Enter to submit). Let them bubble unmodified.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        positionPopover();
        setActiveIdx(selectedIdx >= 0 ? selectedIdx : options.length - 1);
        setOpen(true);
        return;
      }
      // Single printable key while closed → open and jump.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        positionPopover();
        setOpen(true);
        typeJump(e.key);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIdx >= 0) selectAt(activeIdx);
        break;
      case "Escape":
        e.preventDefault();
        closeMenu();
        break;
      case "Tab":
        // Close but don't preventDefault — let focus move naturally.
        closeMenu();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          typeJump(e.key);
        }
    }
  }

  const triggerLabel = selected?.label ?? placeholder;

  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        id={componentId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        className={`${styles.trigger} ${invalid ? styles.invalid : ""} ${
          !selected ? styles.placeholder : ""
        }`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        <span className={styles.chevron} aria-hidden>
          <ChevronGlyph />
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          className={`${styles.listbox} ${flipUp ? styles.listboxFlip : ""}`}
        >
          {options.length === 0 ? (
            <li className={styles.empty} aria-disabled>
              No options
            </li>
          ) : (
            options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIdx;
              return (
                <li
                  key={opt.value}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.option} ${
                    isActive ? styles.optionActive : ""
                  } ${isSelected ? styles.optionSelected : ""}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  // mousedown beats click on focus, so we don't lose focus
                  // before selectAt runs and re-focuses the trigger.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectAt(i);
                  }}
                >
                  <span className={styles.optionLabel}>{opt.label}</span>
                  {opt.hint && <span className={styles.optionHint}>{opt.hint}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function ChevronGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
