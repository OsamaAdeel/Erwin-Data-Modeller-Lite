import type { ModelColumn } from "@/services/xml/model";

export interface MissingTablePlan {
  name: string;
  columnCount: number;
  pk: string[];
  columns: Array<Pick<ModelColumn, "name" | "physicalDataType" | "nullable" | "domainName" | "isPk">>;
}

export interface MissingColumnPlan {
  table: string;        // target's casing
  column: ModelColumn;  // from source
}

export type ConflictKind = "column_diff" | "table_case_mismatch" | "missing_domain";

export interface ColumnDiffConflict {
  kind: "column_diff";
  table: string;
  column: string;
  diffs: Record<string, { source: string | null; target: string | null }>;
}

export interface TableCaseMismatchConflict {
  kind: "table_case_mismatch";
  sourceName: string;
  targetName: string;
}

export interface MissingDomainConflict {
  kind: "missing_domain";
  table: string;
  column: string;
  domainName: string;
}

export type Conflict =
  | ColumnDiffConflict
  | TableCaseMismatchConflict
  | MissingDomainConflict;

export interface MergePlan {
  tablesMissing: MissingTablePlan[];
  columnsMissing: MissingColumnPlan[];
  conflicts: Conflict[];
}

export interface MergeReport {
  outputFilename: string;
  xml: string;
  actions: string[];
  warnings: string[];
}
