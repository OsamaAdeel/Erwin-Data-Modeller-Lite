import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { MAX_COLUMNS_PER_TABLE } from "@/services/ddl/oracleParser";
import { XmlParseError, parseFile } from "@/services/xml/parser";
import {
  EmitterError,
  addEntityClassic,
  addEntityDMv9,
} from "@/services/xml/emitter";
import { outputFilename, serializeDoc } from "@/services/xml/serialize";
import { downloadBlob } from "@/utils/download";
import type { NewColumnSpec, Variant } from "@/services/xml/types";
import {
  deleteParsedDoc,
  getParsedDoc,
  makeParseId,
  setParsedDoc,
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
  subject_area: string;
  columns: NewColumnSpec[];
}

export interface AddTableState {
  parsed: ParsedMeta | null;
  loadError?: string;
  loading: boolean;
  // Form (the table currently being drafted).
  tableName: string;
  subjectArea: string;
  columns: NewColumnSpec[];
  // List of tables the user has queued up for emission.
  stagedTables: StagedTable[];
  // When set, the form is editing an existing staged table (in place).
  editingId: string | null;
  // Finalization gate — Generate XML is only possible when true.
  isFinalized: boolean;
  success?: SuccessInfo;
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

const initialState: AddTableState = {
  parsed: null,
  loadError: undefined,
  loading: false,
  tableName: "",
  subjectArea: "",
  columns: [makeColumn()],
  stagedTables: [],
  editingId: null,
  isFinalized: false,
  success: undefined,
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

    const nextName = outputFilename(parsed.fileName);
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
    setSubjectArea(state, action: PayloadAction<string>) {
      state.subjectArea = action.payload;
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
      state.subjectArea = "";
      state.columns = [makeColumn()];
      state.editingId = null;
    },
    // Stage the current form as a new table, or replace the one being edited.
    commitTable(state) {
      if (state.isFinalized) return;
      const snapshot: StagedTable = {
        id: state.editingId ?? crypto.randomUUID(),
        table_name: state.tableName.trim(),
        subject_area: state.subjectArea.trim(),
        columns: state.columns.map((c) => ({ ...c, name: c.name.trim() })),
      };
      if (state.editingId) {
        const idx = state.stagedTables.findIndex((t) => t.id === state.editingId);
        if (idx >= 0) state.stagedTables[idx] = snapshot;
      } else {
        state.stagedTables.push(snapshot);
      }
      state.tableName = "";
      state.subjectArea = "";
      state.columns = [makeColumn()];
      state.editingId = null;
      state.success = undefined;
    },
    deleteStagedTable(state, action: PayloadAction<string>) {
      state.stagedTables = state.stagedTables.filter((t) => t.id !== action.payload);
      // Cancel edit if the table being edited was removed.
      if (state.editingId === action.payload) {
        state.editingId = null;
        state.tableName = "";
        state.subjectArea = "";
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
      state.subjectArea = t.subject_area;
      // Deep-clone columns so editing the form doesn't mutate the staged copy.
      state.columns = t.columns.map((c) => ({ ...c }));
      state.success = undefined;
    },
    cancelEdit(state) {
      state.editingId = null;
      state.tableName = "";
      state.subjectArea = "";
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
        state.subjectArea = "";
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
      });
  },
});

export const {
  setTableName,
  setSubjectArea,
  addColumn,
  removeColumn,
  updateColumn,
  resetForm,
  commitTable,
  deleteStagedTable,
  editStagedTable,
  cancelEdit,
  finalize,
  unfinalize,
  clearSuccess,
} = slice.actions;

export default slice.reducer;
