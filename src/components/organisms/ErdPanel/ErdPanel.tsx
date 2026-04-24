import { ERD } from "@/CONSTANTS";
import Card from "@/components/atoms/Card";
import EmptyState from "@/components/molecules/EmptyState";

export default function ErdPanel() {
  return (
    <Card title={ERD.title} subtitle={ERD.subtitle}>
      <EmptyState title="ERD Diagram" description={ERD.comingSoon} />
    </Card>
  );
}
