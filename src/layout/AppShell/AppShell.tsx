import { ReactNode } from "react";
import TopBar from "@/layout/TopBar";
import Footer from "@/layout/Footer";
import styles from "./AppShell.module.scss";

export interface AppShellProps {
  children: ReactNode;
  /** Click handler for the TopBar's "?" help button. Optional so tests
   *  and Storybook-style usage can render without it. */
  onHelp?: () => void;
}

export default function AppShell({ children, onHelp }: AppShellProps) {
  return (
    <>
      {/* Visually-hidden link revealed on focus so keyboard users can
          jump past the TopBar straight to the content. Standard a11y
          pattern (WCAG 2.4.1). */}
      <a href="#root-content" className={styles.skipLink}>
        Skip to main content
      </a>
      <TopBar onHelp={onHelp} />
      <main id="root-content" className={styles.main}>
        <div className={styles.wrap}>{children}</div>
      </main>
      <Footer />
    </>
  );
}
