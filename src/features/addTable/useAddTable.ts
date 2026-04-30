import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import type { DataType, NewColumnSpec } from "@/services/xml/types";
import { validate, type ValidationResult } from "./validation";
import {
  addColumn as addColumnAction,
  cancelEdit as cancelEditAction,
  clearFolder as clearFolderAction,
  commitTable as commitTableAction,
  deleteStagedTable as deleteStagedTableAction,
  editStagedTable as editStagedTableAction,
  finalize as finalizeAction,
  generate as generateThunk,
  loadFile as loadFileThunk,
  pickFolder as pickFolderThunk,
  refreshFolder as refreshFolderThunk,
  removeColumn as removeColumnAction,
  resetForm as resetFormAction,
  selectFolderFile as selectFolderFileThunk,
  setDescription as setDescriptionAction,
  setTableName as setTableNameAction,
  unfinalize as unfinalizeAction,
  updateColumn as updateColumnAction,
} from "./addTableSlice";
export type {
  FolderFileMeta,
  PreferredFolderState,
  StagedTable,
  SuccessInfo,
} from "./addTableSlice";

export function useAddTable() {
  const dispatch = useAppDispatch();
  const parsed = useAppSelector((s) => s.addTable.parsed);
  const loadError = useAppSelector((s) => s.addTable.loadError);
  const loading = useAppSelector((s) => s.addTable.loading);
  const tableName = useAppSelector((s) => s.addTable.tableName);
  const description = useAppSelector((s) => s.addTable.description);
  const columns = useAppSelector((s) => s.addTable.columns);
  const stagedTables = useAppSelector((s) => s.addTable.stagedTables);
  const editingId = useAppSelector((s) => s.addTable.editingId);
  const isFinalized = useAppSelector((s) => s.addTable.isFinalized);
  const success = useAppSelector((s) => s.addTable.success);
  const folder = useAppSelector((s) => s.addTable.folder);

  const validation: ValidationResult = useMemo(
    () =>
      validate({
        tableName,
        columns,
        entityDict: parsed?.entityDict ?? new Map(),
        stagedTables,
        editingId,
        isFinalized,
      }),
    [tableName, columns, parsed, stagedTables, editingId, isFinalized]
  );

  const totalStagedColumns = useMemo(
    () => stagedTables.reduce((sum, t) => sum + t.columns.length, 0),
    [stagedTables]
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

  const setDescription = useCallback(
    (value: string) => {
      dispatch(setDescriptionAction(value));
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

  const commitTable = useCallback(() => {
    if (!validation.canSubmit) return;
    dispatch(commitTableAction());
  }, [dispatch, validation.canSubmit]);

  const deleteStagedTable = useCallback(
    (id: string) => {
      dispatch(deleteStagedTableAction(id));
    },
    [dispatch]
  );

  const editStagedTable = useCallback(
    (id: string) => {
      dispatch(editStagedTableAction(id));
    },
    [dispatch]
  );

  const cancelEdit = useCallback(() => {
    dispatch(cancelEditAction());
  }, [dispatch]);

  const finalize = useCallback(() => {
    dispatch(finalizeAction());
  }, [dispatch]);

  const unfinalize = useCallback(() => {
    dispatch(unfinalizeAction());
  }, [dispatch]);

  const generate = useCallback(() => {
    void dispatch(generateThunk());
  }, [dispatch]);

  const resetForm = useCallback(() => {
    dispatch(resetFormAction());
  }, [dispatch]);

  const pickFolder = useCallback(() => {
    void dispatch(pickFolderThunk());
  }, [dispatch]);

  const refreshFolder = useCallback(() => {
    void dispatch(refreshFolderThunk());
  }, [dispatch]);

  const selectFolderFile = useCallback(
    (id: string) => {
      void dispatch(selectFolderFileThunk(id));
    },
    [dispatch]
  );

  const clearFolder = useCallback(() => {
    dispatch(clearFolderAction());
  }, [dispatch]);

  const canFinalize = !isFinalized && stagedTables.length > 0;
  const canGenerate = isFinalized && stagedTables.length > 0;

  return {
    parsed,
    loadError,
    loading,
    tableName,
    description,
    columns,
    stagedTables,
    editingId,
    isFinalized,
    totalStagedColumns,
    success,
    validation,
    canFinalize,
    canGenerate,
    folder,
    loadFile,
    setTableName,
    setDescription,
    addColumn,
    removeColumn,
    updateColumn,
    setColumnType,
    commitTable,
    deleteStagedTable,
    editStagedTable,
    cancelEdit,
    finalize,
    unfinalize,
    generate,
    resetForm,
    pickFolder,
    refreshFolder,
    selectFolderFile,
    clearFolder,
  };
}
