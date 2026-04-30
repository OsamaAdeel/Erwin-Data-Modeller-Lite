import { COMMON } from "@/CONSTANTS";
import ErwinLogo from "@/components/atoms/ErwinLogo";
import ThemeToggle from "@/components/atoms/ThemeToggle";
import { useTheme } from "@/features/theme/useTheme";
import styles from "./TopBar.module.scss";

export default function TopBar() {
  const { theme, toggle } = useTheme();
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <ErwinLogo width={120} className={styles.logo} title={COMMON.appName} />
        <div className={styles.divider} aria-hidden />
        <div>
          <div className={styles.title}>{COMMON.appName}</div>
          <div className={styles.tagline}>{COMMON.tagline}</div>
        </div>
      </div>
      <div className={styles.actions}>
        <ThemeToggle theme={theme} onToggle={toggle} />
      </div>
    </header>
  );
}
