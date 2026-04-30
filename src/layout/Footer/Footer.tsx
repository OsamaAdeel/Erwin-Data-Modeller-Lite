import { COMMON } from "@/CONSTANTS";
import pkg from "../../../package.json";
import styles from "./Footer.module.scss";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.left}>
        <span>{COMMON.footer.copyright}</span>
        <span className={styles.dot} aria-hidden>·</span>
        <span>{COMMON.footer.openSource}</span>
        <span className={styles.dot} aria-hidden>·</span>
        <span className={styles.version} title={`Version ${pkg.version}`}>
          v{pkg.version}
        </span>
      </div>
      <a
        className={styles.link}
        href="https://github.com/OsamaAdeel/Erwin-Data-Modeller-Lite"
        target="_blank"
        rel="noreferrer noopener"
      >
        <GitHubIcon className={styles.linkIcon} />
        {COMMON.footer.github}
      </a>
    </footer>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.97-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.35.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18A11.05 11.05 0 0 1 12 6.84c.99 0 1.99.13 2.92.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56 4.57-1.52 7.86-5.83 7.86-10.91C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
