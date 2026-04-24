import { COMMON } from "@/CONSTANTS";
import styles from "./TopBar.module.scss";

export default function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <div className={styles.mark} aria-hidden>E</div>
        <div>
          <div className={styles.title}>{COMMON.appName}</div>
          <div className={styles.tagline}>{COMMON.tagline}</div>
        </div>
      </div>
    </header>
  );
}
