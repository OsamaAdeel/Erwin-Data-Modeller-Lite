import { COMMON } from "@/CONSTANTS";
import ErwinLogo from "@/components/atoms/ErwinLogo";
import styles from "./TopBar.module.scss";

export default function TopBar() {
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
    </header>
  );
}
