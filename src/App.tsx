import { useState } from "react";
import { COMMON } from "@/CONSTANTS";
import AppShell from "@/layout/AppShell";
import TabBar, { type TabItem } from "@/components/molecules/TabBar";
import AddTablePanel from "@/components/organisms/AddTablePanel";
import MergePanel from "@/components/organisms/MergePanel";
import ErdPanel from "@/components/organisms/ErdPanel";

type TabKey = "add" | "merge" | "erd";

const TABS: ReadonlyArray<TabItem<TabKey>> = [
  { key: "add", label: COMMON.tabs.addTable },
  { key: "merge", label: COMMON.tabs.merge },
  { key: "erd", label: COMMON.tabs.erd },
];

export default function App() {
  const [active, setActive] = useState<TabKey>("add");
  return (
    <AppShell>
      <TabBar tabs={TABS} active={active} onChange={setActive} />
      {active === "add" && <AddTablePanel />}
      {active === "merge" && <MergePanel />}
      {active === "erd" && <ErdPanel />}
    </AppShell>
  );
}
