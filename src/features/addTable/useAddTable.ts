import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import type { DataType, NewColumnSpec } from "@/services/xml/types";
import { validate, type ValidationResult } from "./validation";
import {
  addColumn as addColumnAction,
  generate as generateThunk,
  loadFile as loadFileThunk,
  removeColumn as removeColumnAction,
  resetForm as resetFormAction,
  setTableName as setTableNameAction,
  updateColumn as updateColumnAction,
} from "./addTableSlice";
export type { SuccessInfo } from "./addTableSlice";

export function useAddTable() {
  const dispatch = useAppDispatch();
  const parsed = useAppSelector((s) => s.addTable.parsed);
  const loadError = useAppSelector((s) => s.addTable.loadError);
  const loading = useAppSelector((s) => s.addTable.loading);
  const tableName = useAppSelector((s) => s.addTable.tableName);
  const columns = useAppSelector((s) => s.addTable.columns);
  const success = useAppSelector((s) => s.addTable.success);

  const validation: ValidationResult = useMemo(
    () =>
      validate({
        tableName,
        columns,
        entityDict: parsed?.entityDict ?? new Map(),
      }),
    [tableName, columns, parsed]
  );

  const loadFile = useCallback(
    (file: File) => {
      void dispatch(loadFileThunk(file));
    },
    [dispatch]
  );

  const setTableName = useCallback(
    (name: string) => {
      dispatch(setTableNameAction(name));
    },
    [dispatch]
  );

  const addColumn = useCallback(() => {
    dispatch(addColumnAction());
  }, [dispatch]);

  const removeColumn = useCallback(
    (id: string) => {
      dispatch(removeColumnAction(id));
    },
    [dispatch]
  );

  const updateColumn = useCallback(
    (id: string, patch: Partial<NewColumnSpec>) => {
      dispatch(updateColumnAction({ id, patch }));
    },
    [dispatch]
  );

  const setColumnType = useCallback(
    (id: string, type: DataType) =>
      dispatch(updateColumnAction({ id, patch: { type } })),
    [dispatch]
  );

  const generate = useCallback(() => {
    if (!validation.canSubmit) return;
    void dispatch(generateThunk());
  }, [dispatch, validation.canSubmit]);

  const resetForm = useCallback(() => {
    dispatch(resetFormAction());
  }, [dispatch]);

  return {
    parsed,
    loadError,
    loading,
    tableName,
    columns,
    success,
    validation,
    loadFile,
    setTableName,
    addColumn,
    removeColumn,
    updateColumn,
    setColumnType,
    generate,
    resetForm,
  };
}
