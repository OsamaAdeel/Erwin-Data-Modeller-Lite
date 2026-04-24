import { MERGE } from "@/CONSTANTS";
import Card from "@/components/atoms/Card";
import EmptyState from "@/components/molecules/EmptyState";

export default function MergePanel() {
  return (
    <Card title={MERGE.title} subtitle={MERGE.subtitle}>
      <EmptyState title="Merge Models" description={MERGE.comingSoon} />
    </Card>
  );
}
