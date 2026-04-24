import { COMMON } from "@/CONSTANTS";
import styles from "./Footer.module.scss";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.left}>
        <span>{COMMON.footer.copyright}</span>
        <span className={styles.dot} aria-hidden>·</span>
        <span>{COMMON.footer.openSource}</span>
      </div>
      <a
        className={styles.link}
        href="https://github.com/OsamaAdeel/Erwin-Data-Modeller-Lite"
        target="_blank"
        rel="noreferrer noopener"
      >
        {COMMON.footer.github}
      </a>
    </footer>
  );
}
