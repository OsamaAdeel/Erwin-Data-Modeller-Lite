import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { MAX_COLUMNS_PER_TABLE } from "@/services/ddl/oracleParser";
import { XmlParseError, parseFile } from "@/services/xml/parser";
import {
  EmitterError,
  addEntityClassic,
  addEntityDMv9,
} from "@/services/xml/emitter";
import { generateNextFileName, serializeDoc } from "@/services/xml/serialize";
import { validateOfsaaXml, type OfsaaValidationResult } from "@/services/xml/validator";
import { downloadBlob } from "@/utils/download";
import type { NewColumnSpec, Variant } from "@/services/xml/types";
import {
  FolderPickError,
  filterXml,
  pickDirectory,
  rescanHandle,
  sortLatest,
} from "@/services/folder/folderScan";
import {
  clearFolderFiles,
  clearPreferredFolderHandle,
  deleteParsedDoc,
  getFolderFile,
  getParsedDoc,
  getPreferredFolderHandle,
  makeParseId,
  setFolderFile,
  setParsedDoc,
  setPreferredFolderHandle,
} from "@/store/refs";

export interface SuccessInfo {
  tableName: string;       // last added; kept for single-table back-compat
  filename: string;
  tablesAdded: number;     // total staged tables written on generate
}

export interface ParsedMeta {
  parseId: string;
  fileName: string;
  variant: Variant;
  entityDict: Map<string, string>;
  domainMap: Map<string, string>;
}

export interface StagedTable {
  id: string;
  table_name: string;
  description: string;
  columns: NewColumnSpec[];
}

export interface FolderFileMeta {
  id: string;
  name: string;
  lastModified: number;
  size: number;
}

export interface PreferredFolderState {
  name: string | null;
  files: FolderFileMeta[];
  // Currently selected file id (auto-picked or user-overridden). null when
  // the folder has no .xml files.
  selectedFileId: string | null;
  // True iff the folder was opened via showDirectoryPicker (we hold a handle
  // and can refresh without re-prompting).
  refreshable: boolean;
  loading: boolean;
  error?: string;
}

export interface AddTableState {
  parsed: ParsedMeta | null;
  loadError?: string;
  loading: boolean;
  // Form (the table currently being drafted).
  tableName: string;
  description: string;
  columns: NewColumnSpec[];
  // List of tables the user has queued up for emission.
  stagedTables: StagedTable[];
  // When set, the form is editing an existing staged table (in place).
  editingId: string | null;
  // Finalization gate — Generate XML is only possible when true.
  isFinalized: boolean;
  success?: SuccessInfo;
  // OFSAA validator dry-run result (Step 5 "Validate model" button).
  // null = no run yet; populated after a successful validateModel
  // dispatch and cleared when the staged set or parsed doc changes.
  validationResult: OfsaaValidationResult | null;
  validating: boolean;
  // Preferred-folder state. Lives alongside the rest of Step-1 state so the
  // folder, the auto-selected file, and the parsed doc stay in sync.
  folder: PreferredFolderState;
}

function makeColumn(): NewColumnSpec {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "VARCHAR2",
    size: "",
    scale: "",
    nullable: true,
    pk: false,
  };
}

const initialFolderState: PreferredFolderState = {
  name: null,
  files: [],
  selectedFileId: null,
  refreshable: false,
  loading: false,
  error: undefined,
};

const initialState: AddTableState = {
  parsed: null,
  loadError: undefined,
  loading: false,
  tableName: "",
  description: "",
  columns: [makeColumn()],
  stagedTables: [],
  editingId: null,
  isFinalized: false,
  success: undefined,
  validationResult: null,
  validating: false,
  folder: initialFolderState,
};

type ThunkConfig = { state: { addTable: AddTableState }; rejectValue: string };

export const loadFile = createAsyncThunk<ParsedMeta, File, ThunkConfig>(
  "addTable/loadFile",
  async (file, { rejectWithValue, getState }) => {
    try {
      const next = await parseFile(file);
      const parseId = makeParseId();
      setParsedDoc(parseId, next.doc);

      const prior = getState().addTable.parsed?.parseId;
      if (prior && prior !== parseId) deleteParsedDoc(prior);

      return {
        parseId,
        fileName: next.fileName,
        variant: next.variant,
        entityDict: next.entityDict,
        domainMap: next.domainMap,
      };
    } catch (err) {
      if (err instanceof XmlParseError) return rejectWithValue(err.message);
      return rejectWithValue(err instanceof Error ? err.message : String(err));
    }
  }
);

// --- Preferred-folder thunks --------------------------------------------

export interface PickFolderResult {
  name: string;
  files: FolderFileMeta[];
  refreshable: boolean;
  // Auto-selected file id (latest .xml). Null if the folder has no .xml files.
  autoSelectedId: string | null;
}

/**
 * Open the OS picker, scan the folder, filter to .xml, sort newest-first,
 * and stash File handles in the ref store. Returns metadata + the
 * auto-selected (latest) file id.
 *
 * Subsequent dispatches of selectFolderFile / loadFolderSelection use the
 * ref store to retrieve the actual File payload.
 */
export const pickFolder = createAsyncThunk<
  PickFolderResult | null,
  void,
  ThunkConfig
>("addTable/pickFolder", async (_, { dispatch, rejectWithValue }) => {
  try {
    const result = await pickDirectory();
    if (!result) return null; // user cancelled
    // Reset prior session — File refs from a previous folder are now stale.
    clearFolderFiles();
    clearPreferredFolderHandle();
    if (result.handle) setPreferredFolderHandle(result.handle);

    const xmlEntries = sortLatest(filterXml(result.files));
    for (const e of xmlEntries) setFolderFile(e.id, e.file);

    const meta: FolderFileMeta[] = xmlEntries.map((e) => ({
      id: e.id,
      name: e.name,
      lastModified: e.lastModified,
      size: e.size,
    }));

    const autoSelectedId = meta[0]?.id ?? null;
    // Auto-load the latest .xml so Step 1 fully resolves on a single click.
    // Fire-and-forget; loadFile maintains its own pending/loading state.
    if (autoSelectedId) {
      const file = getFolderFile(autoSelectedId);
      if (file) void dispatch(loadFile(file));
    }

    return {
      name: result.folderName,
      files: meta,
      refreshable: !!result.handle,
      autoSelectedId,
    };
  } catch (err) {
    if (err instanceof FolderPickError) return rejectWithValue(err.message);
    return rejectWithValue(err instanceof Error ? err.message : String(err));
  }
});

/**
 * Re-iterate the persisted directory handle and rebuild the file list.
 * Re-applies auto-selection of the latest .xml file. Throws if the folder
 * was opened via the input-fallback path (no handle to refresh from).
 */
export const refreshFolder = createAsyncThunk<
  PickFolderResult,
  void,
  ThunkConfig
>("addTable/refreshFolder", async (_, { dispatch, rejectWithValue }) => {
  const handle = getPreferredFolderHandle();
  if (!handle) {
    return rejectWithValue(
      "This folder was loaded via file input — pick the folder again to refresh."
    );
  }
  try {
    const entries = await rescanHandle(handle);
    clearFolderFiles();
    const xmlEntries = sortLatest(filterXml(entries));
    for (const e of xmlEntries) setFolderFile(e.id, e.file);

    const meta: FolderFileMeta[] = xmlEntries.map((e) => ({
      id: e.id,
      name: e.name,
      lastModified: e.lastModified,
      size: e.size,
    }));

    const autoSelectedId = meta[0]?.id ?? null;
    // Refresh implies "give me the newest file again" — so re-load.
    if (autoSelectedId) {
      const file = getFolderFile(autoSelectedId);
      if (file) void dispatch(loadFile(file));
    }

    return {
      name: handle.name,
      files: meta,
      refreshable: true,
      autoSelectedId,
    };
  } catch (err) {
    if (err instanceof FolderPickError) return rejectWithValue(err.message);
    return rejectWithValue(err instanceof Error ? err.message : String(err));
  }
});

/**
 * Look up the File for the given folder-file id and dispatch the existing
 * loadFile pipeline. Updates folder.selectedFileId on success.
 */
export const selectFolderFile = createAsyncThunk<
  string,                 // id
  string,                 // file id
  ThunkConfig
>("addTable/selectFolderFile", async (id, { dispatch, rejectWithValue }) => {
  const file = getFolderFile(id);
  if (!file) return rejectWithValue("Selected file is no longer available — refresh the folder.");
  await dispatch(loadFile(file));
  return id;
});

/**
 * Onboarding shortcut: fetches the bundled empty starter from /public,
 * seeds it with three demo entities (CUSTOMERS, SALES_ORDERS, PRODUCTS),
 * then dispatches loadFile so the rest of the app sees a normal "user
 * just loaded a file" event. Avoids hand-crafting a populated sample
 * XML by reusing the OFSAA-compliant emitter we already trust.
 */
export const loadSample = createAsyncThunk<void, void, ThunkConfig>(
  "addTable/loadSample",
  async (_, { dispatch, rejectWithValue }) => {
    try {
      const res = await fetch("/sample-erwin.xml");
      if (!res.ok) throw new Error(`Could not load sample model (${res.status})`);
      const text = await res.text();

      const tmpDoc = new DOMParser().parseFromString(text, "application/xml");
      // Pull domains so the emitter's pickDomain has something to land on.
      const tmpDomainMap = new Map<string, string>();
      const domains = tmpDoc.getElementsByTagName("Domain");
      for (const d of Array.from(domains)) {
        const name = d.getAttribute("name");
        const id = d.getAttribute("id");
        if (name && id) tmpDomainMap.set(name, id);
      }

      const newCol = (
        name: string,
        type: NewColumnSpec["type"],
        size: string,
        nullable: boolean,
        pk: boolean
      ): NewColumnSpec => ({
        id: crypto.randomUUID(),
        name,
        type,
        size,
        scale: "",
        nullable,
        pk,
      });

      addEntityDMv9(tmpDoc, "CUSTOMERS", [
        newCol("CUSTOMER_ID", "NUMBER", "", false, true),
        newCol("CUSTOMER_NAME", "VARCHAR2", "100", false, false),
        newCol("EMAIL", "VARCHAR2", "120", true, false),
        newCol("CREATED_AT", "DATE", "", false, false),
      ], tmpDomainMap);
      addEntityDMv9(tmpDoc, "SALES_ORDERS", [
        newCol("ORDER_ID", "NUMBER", "", false, true),
        newCol("CUSTOMER_ID", "NUMBER", "", false, false),
        newCol("ORDER_DATE", "DATE", "", false, false),
        newCol("AMOUNT", "NUMBER", "12", false, false),
      ], tmpDomainMap);
      addEntityDMv9(tmpDoc, "PRODUCTS", [
        newCol("PRODUCT_ID", "NUMBER", "", false, true),
        newCol("PRODUCT_NAME", "VARCHAR2", "120", false, false),
        newCol("UNIT_PRICE", "NUMBER", "10", false, false),
        newCol("IN_STOCK", "CHAR", "1", false, false),
      ], tmpDomainMap);

      const populated = serializeDoc(tmpDoc);
      const file = new File([populated], "sample-erwin.xml", {
        type: "application/xml",
      });
      // Reuse the regular load pipeline so all the downstream UI updates
      // (collapse Step 1, populate stat tiles, browse-entities list) just
      // work — no special-case state path.
      await dispatch(loadFile(file)).unwrap();
    } catch (err) {
      return rejectWithValue(
        err instanceof Error ? err.message : String(err)
      );
    }
  }
);

/**
 * Run the OFSAA validator against a clone of the loaded doc with every
 * staged table applied. Doesn't touch the live doc — clones via
 * serialize → re-parse so the XMLDocument the emitter actually
 * mutates stays untouched (we don't want a Validate click to advance
 * the in-memory model).
 *
 * Returns the structured violation list. Treated like a "preview"
 * call — surfaced as a panel on Step 5, never triggers a download.
 */
export const validateModel = createAsyncThunk<OfsaaValidationResult, void, ThunkConfig>(
  "addTable/validateModel",
  async (_, { getState, rejectWithValue }) => {
    const { parsed, stagedTables } = getState().addTable;
    if (!parsed) return rejectWithValue("No XML loaded");
    const liveDoc = getParsedDoc(parsed.parseId);
    if (!liveDoc) return rejectWithValue("Parsed document is no longer available");

    // Round-trip through XMLSerializer + DOMParser to get a fresh,
    // mutable copy that mirrors what the live doc would look like
    // after the staged tables are emitted.
    const cloneXml = serializeDoc(liveDoc);
    const cloneDoc = new DOMParser().parseFromString(cloneXml, "application/xml");

    try {
      for (const t of stagedTables) {
        const trimmedCols = t.columns.map((c) => ({ ...c, name: c.name.trim() }));
        const trimmedName = t.table_name.trim();
        if (parsed.variant === "erwin-dm-v9") {
          addEntityDMv9(cloneDoc, trimmedName, trimmedCols, parsed.domainMap);
        } else {
          addEntityClassic(cloneDoc, trimmedName, trimmedCols);
        }
      }
    } catch (err) {
      if (err instanceof EmitterError) return rejectWithValue(err.message);
      throw err;
    }

    return validateOfsaaXml(serializeDoc(cloneDoc));
  }
);

export const generate = createAsyncThunk<SuccessInfo, void, ThunkConfig>(
  "addTable/generate",
  async (_, { getState, rejectWithValue }) => {
    const { parsed, stagedTables, isFinalized } = getState().addTable;
    if (!parsed) return rejectWithValue("No XML loaded");
    if (!isFinalized) return rejectWithValue("Model is not finalized");
    if (stagedTables.length === 0) return rejectWithValue("No tables to add");

    const doc = getParsedDoc(parsed.parseId);
    if (!doc) return rejectWithValue("Parsed document is no longer available");

    let lastName = "";
    try {
      for (const t of stagedTables) {
        const trimmedName = t.table_name.trim();
        const trimmedCols = t.columns.map((c) => ({ ...c, name: c.name.trim() }));
        if (parsed.variant === "erwin-dm-v9") {
          addEntityDMv9(doc, trimmedName, trimmedCols, parsed.domainMap);
        } else {
          addEntityClassic(doc, trimmedName, trimmedCols);
        }
        lastName = trimmedName;
      }
    } catch (err) {
      if (err instanceof EmitterError) return rejectWithValue(err.message);
      throw err;
    }

    const nextName = generateNextFileName(parsed.fileName);
    const xml = serializeDoc(doc);
    downloadBlob(xml, nextName, "application/xml");
    return {
      tableName: lastName,
      filename: nextName,
      tablesAdded: stagedTables.length,
    };
  }
);

const slice = createSlice({
  name: "addTable",
  initialState,
  reducers: {
    setTableName(state, action: PayloadAction<string>) {
      state.tableName = action.payload;
    },
    setDescription(state, action: PayloadAction<string>) {
      state.description = action.payload;
    },
    addColumn(state) {
      if (state.columns.length < MAX_COLUMNS_PER_TABLE) {
        state.columns.push(makeColumn());
      }
    },
    removeColumn(state, action: PayloadAction<string>) {
      if (state.columns.length > 1) {
        state.columns = state.columns.filter((c) => c.id !== action.payload);
      }
    },
    /**
     * Replace the entire columns list. Used by the "Paste DDL" mode to
     * swap the user-typed grid for a parsed result in one shot. Empty
     * payloads are a no-op so the form always has at least one row.
     */
    replaceColumns(state, action: PayloadAction<NewColumnSpec[]>) {
      if (action.payload.length === 0) return;
      state.columns = action.payload;
      state.validationResult = null;
    },
    /**
     * Re-position a column relative to another by id.
     * `before` determines whether the moved row lands before or after
     * the target row (set from the cursor's vertical half over the
     * drop target in ColumnRow).
     */
    reorderColumns(
      state,
      action: PayloadAction<{ fromId: string; toId: string; before: boolean }>
    ) {
      const { fromId, toId, before } = action.payload;
      if (fromId === toId) return;
      const fromIdx = state.columns.findIndex((c) => c.id === fromId);
      const toIdx = state.columns.findIndex((c) => c.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = state.columns.splice(fromIdx, 1);
      const newToIdx = state.columns.findIndex((c) => c.id === toId);
      state.columns.splice(before ? newToIdx : newToIdx + 1, 0, moved);
    },
    updateColumn(
      state,
      action: PayloadAction<{ id: string; patch: Partial<NewColumnSpec> }>
    ) {
      const { id, patch } = action.payload;
      const col = state.columns.find((c) => c.id === id);
      if (!col) return;
      const priorType = col.type;
      Object.assign(col, patch);
      if (patch.pk === true) col.nullable = false;
      if (patch.type && patch.type !== priorType) {
        col.size = "";
        col.scale = "";
      }
    },
    resetForm(state) {
      state.tableName = "";
      state.description = "";
      state.columns = [makeColumn()];
      state.editingId = null;
    },
    // Stage the current form as a new table, or replace the one being edited.
    commitTable(state) {
      if (state.isFinalized) return;
      // Any staging change invalidates a previous validation pass.
      state.validationResult = null;
      const snapshot: StagedTable = {
        id: state.editingId ?? crypto.randomUUID(),
        table_name: state.tableName.trim(),
        description: state.description.trim(),
        columns: state.columns.map((c) => ({ ...c, name: c.name.trim() })),
      };
      if (state.editingId) {
        const idx = state.stagedTables.findIndex((t) => t.id === state.editingId);
        if (idx >= 0) state.stagedTables[idx] = snapshot;
      } else {
        state.stagedTables.push(snapshot);
      }
      state.tableName = "";
      state.description = "";
      state.columns = [makeColumn()];
      state.editingId = null;
      state.success = undefined;
    },
    deleteStagedTable(state, action: PayloadAction<string>) {
      state.validationResult = null;
      state.stagedTables = state.stagedTables.filter((t) => t.id !== action.payload);
      // Cancel edit if the table being edited was removed.
      if (state.editingId === action.payload) {
        state.editingId = null;
        state.tableName = "";
        state.description = "";
        state.columns = [makeColumn()];
      }
      // Removing the last table invalidates finalization.
      if (state.stagedTables.length === 0) state.isFinalized = false;
    },
    editStagedTable(state, action: PayloadAction<string>) {
      const t = state.stagedTables.find((x) => x.id === action.payload);
      if (!t) return;
      state.editingId = t.id;
      state.tableName = t.table_name;
      state.description = t.description;
      // Deep-clone columns so editing the form doesn't mutate the staged copy.
      state.columns = t.columns.map((c) => ({ ...c }));
      state.success = undefined;
    },
    cancelEdit(state) {
      state.editingId = null;
      state.tableName = "";
      state.description = "";
      state.columns = [makeColumn()];
    },
    finalize(state) {
      if (state.stagedTables.length === 0) return;
      state.isFinalized = true;
    },
    unfinalize(state) {
      state.isFinalized = false;
      state.success = undefined;
    },
    clearSuccess(state) {
      state.success = undefined;
    },
    clearValidationResult(state) {
      state.validationResult = null;
    },
    clearFolder(state) {
      state.folder = initialFolderState;
      clearFolderFiles();
      clearPreferredFolderHandle();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadFile.pending, (state) => {
        state.loading = true;
        state.loadError = undefined;
        state.success = undefined;
      })
      .addCase(loadFile.fulfilled, (state, action) => {
        state.loading = false;
        state.parsed = action.payload;
        // New file = fresh session: clear form, staging, and finalization.
        state.tableName = "";
        state.description = "";
        state.columns = [makeColumn()];
        state.stagedTables = [];
        state.editingId = null;
        state.isFinalized = false;
        state.success = undefined;
      })
      .addCase(loadFile.rejected, (state, action) => {
        state.loading = false;
        state.loadError = action.payload ?? action.error.message;
      })
      .addCase(generate.fulfilled, (state, action) => {
        state.success = action.payload;
        if (state.parsed) {
          state.parsed.fileName = action.payload.filename;
          for (const t of state.stagedTables) {
            state.parsed.entityDict.set(
              t.table_name.toUpperCase(),
              t.table_name
            );
          }
        }
        // After a successful emit the session is consumed — clear staging and
        // exit finalized mode. The file is re-loaded with the rolled-forward
        // name, so the user can keep adding against the new entity dict.
        state.stagedTables = [];
        state.isFinalized = false;
      })
      .addCase(generate.rejected, (state, action) => {
        state.loadError = action.payload ?? action.error.message;
      })
      // --- Validate model ----------------------------------------------
      .addCase(validateModel.pending, (state) => {
        state.validating = true;
      })
      .addCase(validateModel.fulfilled, (state, action) => {
        state.validating = false;
        state.validationResult = action.payload;
      })
      .addCase(validateModel.rejected, (state, action) => {
        state.validating = false;
        state.loadError = action.payload ?? action.error.message;
      })
      // --- Preferred folder lifecycle ----------------------------------
      .addCase(pickFolder.pending, (state) => {
        state.folder.loading = true;
        state.folder.error = undefined;
      })
      .addCase(pickFolder.fulfilled, (state, action) => {
        state.folder.loading = false;
        if (!action.payload) return; // user cancelled — keep prior state
        const { name, files, refreshable, autoSelectedId } = action.payload;
        state.folder = {
          name,
          files,
          selectedFileId: autoSelectedId,
          refreshable,
          loading: false,
          error: undefined,
        };
      })
      .addCase(pickFolder.rejected, (state, action) => {
        state.folder.loading = false;
        state.folder.error = action.payload ?? action.error.message;
      })
      .addCase(refreshFolder.pending, (state) => {
        state.folder.loading = true;
        state.folder.error = undefined;
      })
      .addCase(refreshFolder.fulfilled, (state, action) => {
        const { name, files, refreshable, autoSelectedId } = action.payload;
        state.folder = {
          name,
          files,
          selectedFileId: autoSelectedId,
          refreshable,
          loading: false,
          error: undefined,
        };
      })
      .addCase(refreshFolder.rejected, (state, action) => {
        state.folder.loading = false;
        state.folder.error = action.payload ?? action.error.message;
      })
      .addCase(selectFolderFile.fulfilled, (state, action) => {
        state.folder.selectedFileId = action.payload;
      })
      .addCase(selectFolderFile.rejected, (state, action) => {
        state.folder.error = action.payload ?? action.error.message;
      });
  },
});

export const {
  setTableName,
  setDescription,
  addColumn,
  removeColumn,
  replaceColumns,
  reorderColumns,
  updateColumn,
  resetForm,
  commitTable,
  deleteStagedTable,
  editStagedTable,
  cancelEdit,
  finalize,
  unfinalize,
  clearSuccess,
  clearValidationResult,
  clearFolder,
} = slice.actions;

export default slice.reducer;
