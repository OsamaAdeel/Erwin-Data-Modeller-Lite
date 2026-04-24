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
  tableName: string;
  filename: string;
}

export interface ParsedMeta {
  parseId: string;
  fileName: string;
  variant: Variant;
  entityDict: Map<string, string>;
  domainMap: Map<string, string>;
}

export interface AddTableState {
  parsed: ParsedMeta | null;
  loadError?: string;
  loading: boolean;
  tableName: string;
  columns: NewColumnSpec[];
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
  columns: [makeColumn()],
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
    const { parsed, tableName, columns } = getState().addTable;
    if (!parsed) return rejectWithValue("No XML loaded");

    const doc = getParsedDoc(parsed.parseId);
    if (!doc) return rejectWithValue("Parsed document is no longer available");

    const trimmedName = tableName.trim();
    const trimmedCols = columns.map((c) => ({ ...c, name: c.name.trim() }));

    try {
      if (parsed.variant === "erwin-dm-v9") {
        addEntityDMv9(doc, trimmedName, trimmedCols, parsed.domainMap);
      } else {
        addEntityClassic(doc, trimmedName, trimmedCols);
      }
    } catch (err) {
      if (err instanceof EmitterError) return rejectWithValue(err.message);
      throw err;
    }

    const nextName = outputFilename(parsed.fileName);
    const xml = serializeDoc(doc);
    downloadBlob(xml, nextName, "application/xml");
    return { tableName: trimmedName, filename: nextName };
  }
);

const slice = createSlice({
  name: "addTable",
  initialState,
  reducers: {
    setTableName(state, action: PayloadAction<string>) {
      state.tableName = action.payload;
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
      state.columns = [makeColumn()];
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
        state.tableName = "";
        state.columns = [makeColumn()];
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
          state.parsed.entityDict.set(
            action.payload.tableName.toUpperCase(),
            action.payload.tableName
          );
        }
      })
      .addCase(generate.rejected, (state, action) => {
        state.loadError = action.payload ?? action.error.message;
      });
  },
});

export const {
  setTableName,
  addColumn,
  removeColumn,
  updateColumn,
  resetForm,
} = slice.actions;

export default slice.reducer;
