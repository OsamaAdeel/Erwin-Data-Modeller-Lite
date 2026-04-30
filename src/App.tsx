import { useCallback, useState, type ReactNode } from "react";
import { COMMON } from "@/CONSTANTS";
import AppShell from "@/layout/AppShell";
import TabBar, { type TabItem } from "@/components/molecules/TabBar";
import HotkeysModal, { useGlobalHelpHotkey } from "@/components/molecules/HotkeysModal";
import AddTablePanel from "@/components/organisms/AddTablePanel";
import MergePanel from "@/components/organisms/MergePanel";
import ErdPanel from "@/components/organisms/ErdPanel";

type TabKey = "add" | "merge" | "erd";

function tabLabel(icon: ReactNode, text: string): ReactNode {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden style={{ display: "inline-flex" }}>
        {icon}
      </span>
      {text}
    </span>
  );
}

// Lucide-style line icons inlined to avoid an icon-library dependency.
const tableIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);
const mergeIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M6 21V8a5 5 0 0 0 5 5h4" />
  </svg>
);
const erdIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="12" cy="18" r="3" />
    <path d="M9 6h6M7.5 8.5l3 7M16.5 8.5l-3 7" />
  </svg>
);

const TABS: ReadonlyArray<TabItem<TabKey>> = [
  { key: "add", label: tabLabel(tableIcon, COMMON.tabs.addTable) },
  { key: "merge", label: tabLabel(mergeIcon, COMMON.tabs.merge) },
  { key: "erd", label: tabLabel(erdIcon, COMMON.tabs.erd) },
];

export default function App() {
  const [active, setActive] = useState<TabKey>("add");
  const [helpOpen, setHelpOpen] = useState(false);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  useGlobalHelpHotkey(openHelp);

  return (
    <>
      <AppShell onHelp={openHelp}>
        <TabBar tabs={TABS} active={active} onChange={setActive} />
        {active === "add" && <AddTablePanel />}
        {active === "merge" && <MergePanel />}
        {active === "erd" && <ErdPanel />}
      </AppShell>
      <HotkeysModal open={helpOpen} onClose={closeHelp} />
    </>
  );
}
