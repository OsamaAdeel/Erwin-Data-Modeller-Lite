import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { XmlParseError, parseFile } from "@/services/xml/parser";
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
  kind: "table" | "column";
  tableUpper: string;
  columnUpper?: string;
}

export interface PickerRow extends RowKey {
  id: string;
  side: "pending" | "staged";
}

export interface MergeResult {
  report: MergeReport;
  reportText: string;
  counts: { tablesAdded: number; columnsAdded: number; unresolved: number };
}

export interface MergeState {
  source: SlotState | null;
  target: SlotState | null;
  errors: { source?: string; target?: string; general?: string };
  loading: { source: boolean; target: boolean };
  plan: MergePlan | null;
  rows: PickerRow[];
  result: MergeResult | null;
}

const initialState: MergeState = {
  source: null,
  target: null,
  errors: {},
  loading: { source: false, target: false },
  plan: null,
  rows: [],
  result: null,
};

function rowId(row: RowKey): string {
  return row.kind === "table"
    ? `t:${row.tableUpper}`
    : `c:${row.tableUpper}:${row.columnUpper}`;
}

export const loadSlot = createAsyncThunk<
  { slot: Slot; state: SlotState },
  { slot: Slot; file: File },
  { rejectValue: { slot: Slot; message: string } }
>("merge/loadSlot", async ({ slot, file }, { rejectWithValue }) => {
  try {
    const text = await file.text();
    const parsed = await parseFile(file);
    if (parsed.variant !== "erwin-dm-v9") {
      return rejectWithValue({
        slot,
        message: "This file is not erwin-dm-v9. Merge supports erwin-dm-v9 only.",
      });
    }
    const model = collectFullModel(parsed.doc);
    return {
      slot,
      state: {
        filename: file.name,
        rawText: text,
        variant: parsed.variant,
        model,
      },
    };
  } catch (err) {
    const message =
      err instanceof XmlParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return rejectWithValue({ slot, message });
  }
});

const slice = createSlice({
  name: "merge",
  initialState,
  reducers: {
    reset: () => initialState,
    compute(state) {
      if (!state.source || !state.target) return;
      const p = computePlan(state.source.model, state.target.model);
      state.plan = p;
      state.result = null;
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
      state.rows = next;
    },
    moveRow(
      state,
      action: PayloadAction<{ id: string; to: "pending" | "staged" }>
    ) {
      const { id, to } = action.payload;
      const row = state.rows.find((r) => r.id === id);
      if (row) row.side = to;
    },
    moveAll(
      state,
      action: PayloadAction<{
        from: "pending" | "staged";
        to: "pending" | "staged";
      }>
    ) {
      const { from, to } = action.payload;
      for (const r of state.rows) if (r.side === from) r.side = to;
    },
    execute(state) {
      const { source, target, plan, rows } = state;
      if (!source || !target || !plan) return;
      state.errors.general = undefined;
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
        const reportText = buildReportText(
          source.filename,
          target.filename,
          report,
          unresolved
        );
        state.result = {
          report,
          reportText,
          counts: {
            tablesAdded: stagedTables.length,
            columnsAdded: stagedColumns.length,
            unresolved,
          },
        };
      } catch (err) {
        let message: string;
        if (err instanceof DuplicateTableError) message = err.message;
        else if (err instanceof MergeExecuteError) message = err.message;
        else message = err instanceof Error ? err.message : String(err);
        state.errors.general = message;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSlot.pending, (state, action) => {
        const { slot } = action.meta.arg;
        state.loading[slot] = true;
        state.errors[slot] = undefined;
        state.plan = null;
        state.rows = [];
        state.result = null;
      })
      .addCase(loadSlot.fulfilled, (state, action) => {
        const { slot, state: slotState } = action.payload;
        state.loading[slot] = false;
        if (slot === "source") state.source = slotState;
        else state.target = slotState;
      })
      .addCase(loadSlot.rejected, (state, action) => {
        const slot = action.payload?.slot ?? action.meta.arg.slot;
        state.loading[slot] = false;
        const message =
          action.payload?.message ?? action.error.message ?? "Failed to load";
        state.errors[slot] = message;
        if (slot === "source") state.source = null;
        else state.target = null;
      });
  },
});

export const { reset, compute, moveRow, moveAll, execute } = slice.actions;

// Side-effect helpers used by the hook — they read a current snapshot from
// the caller rather than hanging off the store.
export function downloadMergeXml(result: MergeResult): void {
  downloadBlob(result.report.xml, result.report.outputFilename, "application/xml");
}

export function downloadMergeReport(result: MergeResult): void {
  downloadBlob(result.reportText, "MERGE_REPORT.txt", "text/plain");
}

export default slice.reducer;
