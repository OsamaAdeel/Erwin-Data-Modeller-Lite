import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import type { DataType, NewColumnSpec } from "@/services/xml/types";
import { validate, type ValidationResult } from "./validation";
import {
  addColumn as addColumnAction,
  cancelEdit as cancelEditAction,
  clearFolder as clearFolderAction,
  clearValidationResult as clearValidationResultAction,
  commitTable as commitTableAction,
  deleteStagedTable as deleteStagedTableAction,
  editStagedTable as editStagedTableAction,
  finalize as finalizeAction,
  forgetRecentFolder as forgetRecentFolderThunk,
  generate as generateThunk,
  hydrateRecentFolders as hydrateRecentFoldersThunk,
  loadFile as loadFileThunk,
  loadSample as loadSampleThunk,
  pickFolder as pickFolderThunk,
  previewXml as previewXmlThunk,
  refreshFolder as refreshFolderThunk,
  removeColumn as removeColumnAction,
  replaceColumns as replaceColumnsAction,
  reorderColumns as reorderColumnsAction,
  resetForm as resetFormAction,
  selectFolderFile as selectFolderFileThunk,
  setDescription as setDescriptionAction,
  setTableName as setTableNameAction,
  unfinalize as unfinalizeAction,
  updateColumn as updateColumnAction,
  useRecentFolder as useRecentFolderThunk,
  validateModel as validateModelThunk,
} from "./addTableSlice";
export type {
  FolderFileMeta,
  PreferredFolderState,
  PreviewInfo,
  RecentFolderMeta,
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
  const validationResult = useAppSelector((s) => s.addTable.validationResult);
  const validating = useAppSelector((s) => s.addTable.validating);
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

  const loadSample = useCallback(() => {
    void dispatch(loadSampleThunk());
  }, [dispatch]);

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

  const reorderColumns = useCallback(
    (fromId: string, toId: string, before: boolean) => {
      dispatch(reorderColumnsAction({ fromId, toId, before }));
    },
    [dispatch]
  );

  const replaceColumns = useCallback(
    (next: NewColumnSpec[]) => {
      dispatch(replaceColumnsAction(next));
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

  // Returns the would-be output XML + filename without triggering a
  // download. Used by the "Preview XML" modal so the user can eyeball
  // the emit before committing to it.
  const previewXml = useCallback(
    () => dispatch(previewXmlThunk()).unwrap(),
    [dispatch]
  );

  const validateModel = useCallback(() => {
    void dispatch(validateModelThunk());
  }, [dispatch]);

  const clearValidationResult = useCallback(() => {
    dispatch(clearValidationResultAction());
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

  const hydrateRecentFolders = useCallback(() => {
    void dispatch(hydrateRecentFoldersThunk());
  }, [dispatch]);

  const useRecentFolder = useCallback(
    (id: string) => {
      void dispatch(useRecentFolderThunk(id));
    },
    [dispatch]
  );

  const forgetRecentFolder = useCallback(
    (id: string) => {
      void dispatch(forgetRecentFolderThunk(id));
    },
    [dispatch]
  );

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
    validationResult,
    validating,
    canFinalize,
    canGenerate,
    folder,
    loadFile,
    loadSample,
    setTableName,
    setDescription,
    addColumn,
    removeColumn,
    replaceColumns,
    reorderColumns,
    updateColumn,
    setColumnType,
    commitTable,
    deleteStagedTable,
    editStagedTable,
    cancelEdit,
    finalize,
    unfinalize,
    generate,
    previewXml,
    validateModel,
    clearValidationResult,
    resetForm,
    pickFolder,
    refreshFolder,
    selectFolderFile,
    clearFolder,
    hydrateRecentFolders,
    useRecentFolder,
    forgetRecentFolder,
  };
}
