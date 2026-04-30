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
      <TopBar onHelp={onHelp} />
      <main className={styles.main}>
        <div className={styles.wrap}>{children}</div>
      </main>
      <Footer />
    </>
  );
}
