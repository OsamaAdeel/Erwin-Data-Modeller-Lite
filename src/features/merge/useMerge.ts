import { useCallback, useMemo, useState } from "react";
import { parseFile, XmlParseError } from "@/services/xml/parser";
import { collectFullModel, type FullModel } from "@/services/xml/model";
import { computePlan } from "@/services/xml/merge/diff";
import {
  DuplicateTableError,
  buildReportText,
  executeMerge,
  MergeExecuteError,
} from "@/services/xml/merge/execute";
import type { MergePlan, MergeReport } from "@/services/xml/merge/types";
import { downloadBlob } from "@/utils/download";

export type Slot = "source" | "target";

export interface SlotState {
  filename: string;
  rawText: string;
  variant: string;
  model: FullModel;
}

export interface RowKey {
  // Stable identity for picker rows. Tables key by table name; columns by both.
  kind: "table" | "column";
  tableUpper: string;
  columnUpper?: string;
}

export interface PickerRow extends RowKey {
  id: string;        // unique string for React keys
  side: "pending" | "staged";
}

function rowId(row: RowKey): string {
  return row.kind === "table" ? `t:${row.tableUpper}` : `c:${row.tableUpper}:${row.columnUpper}`;
}

export function useMerge() {
  const [source, setSource] = useState<SlotState | null>(null);
  const [target, setTarget] = useState<SlotState | null>(null);
  const [errors, setErrors] = useState<{ source?: string; target?: string; general?: string }>({});
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [result, setResult] = useState<{
    report: MergeReport;
    reportText: string;
    counts: { tablesAdded: number; columnsAdded: number; unresolved: number };
  } | null>(null);

  const reset = useCallback(() => {
    setSource(null);
    setTarget(null);
    setErrors({});
    setPlan(null);
    setRows([]);
    setResult(null);
  }, []);

  const loadSlot = useCallback(async (slot: Slot, file: File) => {
    setErrors((prev) => ({ ...prev, [slot]: undefined }));
    setPlan(null);
    setRows([]);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = await parseFile(file);
      if (parsed.variant !== "erwin-dm-v9") {
        setErrors((prev) => ({
          ...prev,
          [slot]: "This file is not erwin-dm-v9. Merge supports erwin-dm-v9 only.",
        }));
        if (slot === "source") setSource(null);
        else setTarget(null);
        return;
      }
      const model = collectFullModel(parsed.doc);
      const slotState: SlotState = {
        filename: file.name,
        rawText: text,
        variant: parsed.variant,
        model,
      };
      if (slot === "source") setSource(slotState);
      else setTarget(slotState);
    } catch (err) {
      const msg = err instanceof XmlParseError ? err.message : err instanceof Error ? err.message : String(err);
      setErrors((prev) => ({ ...prev, [slot]: msg }));
    }
  }, []);

  const compute = useCallback(() => {
    if (!source || !target) return;
    const p = computePlan(source.model, target.model);
    setPlan(p);
    setResult(null);
    const next: PickerRow[] = [];
    for (const t of p.tablesMissing) {
      const k: RowKey = { kind: "table", tableUpper: t.name.toUpperCase() };
      next.push({ ...k, id: rowId(k), side: "pending" });
    }
    for (const c of p.columnsMissing) {
      const k: RowKey = {
        kind: "column",
        tableUpper: c.table.toUpperCase(),
        columnUpper: c.column.name.toUpperCase(),
      };
      next.push({ ...k, id: rowId(k), side: "pending" });
    }
    setRows(next);
  }, [source, target]);

  const moveRow = useCallback((id: string, to: "pending" | "staged") => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, side: to } : r)));
  }, []);

  const moveAll = useCallback((from: "pending" | "staged", to: "pending" | "staged") => {
    setRows((prev) => prev.map((r) => (r.side === from ? { ...r, side: to } : r)));
  }, []);

  // Convenience selectors for the UI.
  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.side === "pending");
    const staged = rows.filter((r) => r.side === "staged");
    return {
      pendingTables: pending.filter((r) => r.kind === "table").length,
      pendingColumns: pending.filter((r) => r.kind === "column").length,
      stagedTables: staged.filter((r) => r.kind === "table").length,
      stagedColumns: staged.filter((r) => r.kind === "column").length,
    };
  }, [rows]);

  const execute = useCallback(() => {
    if (!source || !target || !plan) return;
    setErrors((prev) => ({ ...prev, general: undefined }));
    const stagedTables = rows
      .filter((r) => r.side === "staged" && r.kind === "table")
      .map((r) => r.tableUpper);
    const stagedColumns = rows
      .filter((r) => r.side === "staged" && r.kind === "column")
      .map((r) => ({ tableUpper: r.tableUpper, columnUpper: r.columnUpper! }));

    try {
      const report = executeMerge({
        source: source.model,
        targetXml: target.rawText,
        targetFilename: target.filename,
        stagedTablesUpper: stagedTables,
        stagedColumns,
      });
      const unresolved = plan.conflicts.length;
      const reportText = buildReportText(source.filename, target.filename, report, unresolved);
      setResult({
        report,
        reportText,
        counts: {
          tablesAdded: stagedTables.length,
          columnsAdded: stagedColumns.length,
          unresolved,
        },
      });
    } catch (err) {
      let msg: string;
      if (err instanceof DuplicateTableError) msg = err.message;
      else if (err instanceof MergeExecuteError) msg = err.message;
      else msg = err instanceof Error ? err.message : String(err);
      setErrors((prev) => ({ ...prev, general: msg }));
    }
  }, [source, target, plan, rows]);

  const downloadXml = useCallback(() => {
    if (!result) return;
    downloadBlob(result.report.xml, result.report.outputFilename, "application/xml");
  }, [result]);

  const downloadReport = useCallback(() => {
    if (!result) return;
    downloadBlob(result.reportText, "MERGE_REPORT.txt", "text/plain");
  }, [result]);

  return {
    source, target, errors, plan, rows, counts, result,
    loadSlot, compute, moveRow, moveAll, execute, reset,
    downloadXml, downloadReport,
    canCompute: !!source && !!target,
    canExecute: !!plan && rows.some((r) => r.side === "staged"),
  };
}
