import { COMMON } from "@/CONSTANTS";
import ErwinLogo from "@/components/atoms/ErwinLogo";
import ThemeToggle from "@/components/atoms/ThemeToggle";
import { useTheme } from "@/features/theme/useTheme";
import styles from "./TopBar.module.scss";

export interface TopBarProps {
  /** When supplied, a "?" icon button is rendered in the actions slot. */
  onHelp?: () => void;
}

export default function TopBar({ onHelp }: TopBarProps) {
  const { theme, toggle } = useTheme();
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <ErwinLogo width={120} className={styles.logo} title={COMMON.appName} />
        <div className={styles.divider} aria-hidden />
        <div>
          <h1 className={styles.title}>{COMMON.appName}</h1>
          <div className={styles.tagline}>{COMMON.tagline}</div>
        </div>
      </div>
      <div className={styles.actions}>
        {onHelp && <HelpButton onClick={onHelp} />}
        <ThemeToggle theme={theme} onToggle={toggle} />
      </div>
    </header>
  );
}

function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={onClick}
      aria-label="Keyboard shortcuts (?)"
      title="Keyboard shortcuts (?)"
    >
      <HelpGlyph />
    </button>
  );
}

function HelpGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
