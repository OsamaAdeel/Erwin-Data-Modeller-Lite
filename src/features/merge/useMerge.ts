import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  compute as computeAction,
  downloadMergeReport,
  downloadMergeXml,
  execute as executeAction,
  loadSlot as loadSlotThunk,
  moveAll as moveAllAction,
  moveRow as moveRowAction,
  reset as resetAction,
  type Slot,
} from "./mergeSlice";
export type { PickerRow, Slot, SlotState, MergeResult } from "./mergeSlice";

export function useMerge() {
  const dispatch = useAppDispatch();
  const source = useAppSelector((s) => s.merge.source);
  const target = useAppSelector((s) => s.merge.target);
  const errors = useAppSelector((s) => s.merge.errors);
  const loading = useAppSelector((s) => s.merge.loading);
  const plan = useAppSelector((s) => s.merge.plan);
  const rows = useAppSelector((s) => s.merge.rows);
  const result = useAppSelector((s) => s.merge.result);

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

  const loadSlot = useCallback(
    (slot: Slot, file: File) => {
      void dispatch(loadSlotThunk({ slot, file }));
    },
    [dispatch]
  );

  const compute = useCallback(() => {
    dispatch(computeAction());
  }, [dispatch]);

  const moveRow = useCallback(
    (id: string, to: "pending" | "staged") => {
      dispatch(moveRowAction({ id, to }));
    },
    [dispatch]
  );

  const moveAll = useCallback(
    (from: "pending" | "staged", to: "pending" | "staged") => {
      dispatch(moveAllAction({ from, to }));
    },
    [dispatch]
  );

  const execute = useCallback(() => {
    dispatch(executeAction());
  }, [dispatch]);

  const reset = useCallback(() => {
    dispatch(resetAction());
  }, [dispatch]);

  const downloadXml = useCallback(() => {
    if (result) downloadMergeXml(result);
  }, [result]);

  const downloadReport = useCallback(() => {
    if (result) downloadMergeReport(result);
  }, [result]);

  return {
    source, target, errors, loading, plan, rows, counts, result,
    loadSlot, compute, moveRow, moveAll, execute, reset,
    downloadXml, downloadReport,
    canCompute: !!source && !!target,
    canExecute: !!plan && rows.some((r) => r.side === "staged"),
  };
}
