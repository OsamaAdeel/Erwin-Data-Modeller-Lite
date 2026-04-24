import { ReactNode } from "react";
import TopBar from "@/layout/TopBar";
import Footer from "@/layout/Footer";
import styles from "./AppShell.module.scss";

export interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <>
      <TopBar />
      <main className={styles.main}>
        <div className={styles.wrap}>{children}</div>
      </main>
      <Footer />
    </>
  );
}
