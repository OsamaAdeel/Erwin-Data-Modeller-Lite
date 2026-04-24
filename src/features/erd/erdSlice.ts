import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { XmlParseError, parseFile } from "@/services/xml/parser";
import { collectFullModel, type FullModel } from "@/services/xml/model";
import {
  collectRelationships,
  type Relationship,
} from "@/services/xml/relationships";
import { computeLayout, type LayoutResult } from "./layout";

export interface ErdData {
  filename: string;
  variant: string;
  model: FullModel;
  relationships: Relationship[];
  layout: LayoutResult;
}

export interface ErdState {
  data: ErdData | null;
  error?: string;
  loading: boolean;
}

const initialState: ErdState = {
  data: null,
  error: undefined,
  loading: false,
};

export const loadFile = createAsyncThunk<
  ErdData,
  File,
  { rejectValue: string }
>("erd/loadFile", async (file, { rejectWithValue }) => {
  try {
    const parsed = await parseFile(file);
    if (parsed.variant !== "erwin-dm-v9") {
      return rejectWithValue("ERD view requires an erwin-dm-v9 file.");
    }
    const model = collectFullModel(parsed.doc);
    const relationships = collectRelationships(parsed.doc);
    const layout = computeLayout(model.entities, relationships);
    return {
      filename: file.name,
      variant: parsed.variant,
      model,
      relationships,
      layout,
    };
  } catch (err) {
    if (err instanceof XmlParseError) return rejectWithValue(err.message);
    return rejectWithValue(err instanceof Error ? err.message : String(err));
  }
});

const slice = createSlice({
  name: "erd",
  initialState,
  reducers: {
    reset: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadFile.pending, (state) => {
        state.loading = true;
        state.error = undefined;
      })
      .addCase(loadFile.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(loadFile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? action.error.message;
        state.data = null;
      });
  },
});

export const { reset } = slice.actions;
export default slice.reducer;
