import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  MAX_COLUMNS_PER_TABLE,
  validateColumnSize,
  validateIdentifier,
} from "@/services/ddl/oracleParser";
import type { DdlParseError, ParsedDdl } from "@/services/ddl/ddlParser";
import { XmlParseError, parseFile } from "@/services/xml/parser";
import {
  EmitterError,
  addEntityClassic,
  addEntityDMv9,
} from "@/services/xml/emitter";
import {
  generateNextFileName,
  serializeDoc,
  type FilenamePattern,
} from "@/services/xml/serialize";
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
  getRecentFolder,
  listRecentFolders,
  removeRecentFolder,
  saveRecentFolder,
} from "@/services/folder/recentFolders";
import {
  getRecentFile,
  listRecentFiles,
  removeRecentFile,
  removeRecentFilesByFolder,
  saveRecentFile,
} from "@/services/folder/recentFiles";
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
import { NS } from "@/services/xml/namespaces";

// --- Sample-model relationship helper ---------------------------------
//
// The emitter only knows about entities. To make the demo model render
// with edges in the ERD tab, we synthesise minimal EMX:Relationship
// nodes here. Looks up entity ids by `name` attribute (the emitter sets
// it when adding) so we don't need addEntityDMv9 to return ids.

function findEntityIdByName(doc: Document, name: string): string | null {
  const entities = doc.getElementsByTagNameNS(NS.emx, "Entity");
  for (const e of Array.from(entities)) {
    if (e.getAttribute("name") === name) return e.getAttribute("id");
  }
  return null;
}

function addSampleRelationship(
  doc: Document,
  parentName: string,
  childName: string,
  relName: string
): void {
  const parentId = findEntityIdByName(doc, parentName);
  const childId = findEntityIdByName(doc, childName);
  if (!parentId || !childId) return;

  const relId = `{${crypto.randomUUID().toUpperCase()}}+00000000`;
  const rel = doc.createElementNS(NS.emx, "EMX:Relationship");
  rel.setAttribute("id", relId);
  rel.setAttribute("name", relName);

  const props = doc.createElementNS(NS.emx, "EMX:RelationshipProps");
  const txt = (tag: string, text: string) => {
    const el = doc.createElementNS(NS.emx, "EMX:" + tag);
    el.textContent = text;
    return el;
  };
  props.appendChild(txt("Long_Id", relId));
  props.appendChild(txt("Name", relName));
  props.appendChild(txt("Parent_Entity_Ref", parentId));
  props.appendChild(txt("Child_Entity_Ref", childId));
  rel.appendChild(props);

  doc.documentElement.appendChild(rel);
}

export interface SuccessInfo {
  /** Stable id used by the toast list to key + dismiss individually. */
  id: string;
  tableName: string;       // last added; kept for single-table back-compat
  filename: string;
  tablesAdded: number;     // total staged tables written on generate
  /** Wall-clock timestamp when the generate finished. The toast renders
   *  it as "Generated at 4:42 PM". */
  generatedAt: number;
}

// Cap on the toast queue. Older entries fall off when a new generate
// arrives — three is enough that a quick burst of generates doesn't all
// vanish, but few enough that the page doesn't fill with stale toasts.
const MAX_SUCCESS_QUEUE = 3;

// localStorage key for the user's preferred filename pattern. Persisted
// across reloads so the user doesn't re-pick on every visit.
const FILENAME_PATTERN_STORAGE_KEY = "erwin.filenamePattern";

function readFilenamePattern(): FilenamePattern {
  if (typeof window === "undefined") return "v";
  try {
    const stored = window.localStorage.getItem(FILENAME_PATTERN_STORAGE_KEY);
    if (stored === "v" || stored === "v-padded" || stored === "timestamp") {
      return stored;
    }
  } catch {
    /* localStorage may be disabled */
  }
  return "v";
}

function writeFilenamePattern(p: FilenamePattern): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILENAME_PATTERN_STORAGE_KEY, p);
  } catch {
    /* ignore */
  }
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
  // IDB-backed list of recently picked folders. Each entry is a handle the
  // user can re-open with one permission click. The actual handle lives in
  // IDB; only the display tuple is mirrored to the slice.
  recents: RecentFolderMeta[];
  // IDB-backed list of recently loaded files within recent folders. Each
  // entry resolves through its folderId at click-time — file objects
  // can't survive page reload, but the (folder, filename) pair can.
  recentFiles: RecentFileMeta[];
  // Which folder in the recents store the in-memory `name`/`files` came
  // from. Lets selectFolderFile attribute its recent-file save back to
  // the right folderId without re-querying IDB.
  activeRecentFolderId: string | null;
}

export interface RecentFolderMeta {
  id: string;
  name: string;
  lastUsedAt: number;
}

export interface RecentFileMeta {
  id: string;        // composite "folderId::fileName"
  folderId: string;
  /** Folder display name resolved from the recents folder list. May be
   *  null if the parent folder has been removed. */
  folderName: string | null;
  fileName: string;
  lastUsedAt: number;
}

// ---------------------------------------------------------------------------
// Bulk DDL import — multi-CREATE-TABLE result shape
// ---------------------------------------------------------------------------

export interface BulkImportAdded {
  name: string;
  columnCount: number;
  pkCount: number;
  /** Per-table parser warnings (e.g. "Unknown type 'XMLTYPE' for column X").
   *  Surfaced under the "imported tables" details so users learn about
   *  silently-dropped columns even on a successful bulk import. */
  warnings: string[];
}

export interface BulkImportError {
  /** Best-effort name; "(unnamed)" if the parser couldn't extract one. */
  name: string;
  reasons: string[];
}

export interface BulkImportResult {
  added: BulkImportAdded[];
  errors: BulkImportError[];
  /** Statements that didn't reduce to a CREATE TABLE shape at all. */
  parseErrors: DdlParseError[];
  /** Wall-clock timestamp of the run — used as a key so the result panel
   *  re-announces on each new dispatch even if the counts are identical. */
  ranAt: number;
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
  /** Generate-success toast queue. Each generate appends a new entry;
   *  capped to MAX_SUCCESS_QUEUE so a burst doesn't pile up. */
  successes: SuccessInfo[];
  // OFSAA validator dry-run result (Step 5 "Validate model" button).
  // null = no run yet; populated after a successful validateModel
  // dispatch and cleared when the staged set or parsed doc changes.
  validationResult: OfsaaValidationResult | null;
  validating: boolean;
  // Preferred-folder state. Lives alongside the rest of Step-1 state so the
  // folder, the auto-selected file, and the parsed doc stay in sync.
  folder: PreferredFolderState;
  // Result of the most recent bulk DDL import. Populated by
  // bulkStageTables; cleared by clearBulkImport, on resetSession, on a new
  // file load, or when the user types a new paste in the DDL textarea.
  bulkImport: BulkImportResult | null;
  /** User-selected filename pattern for generated/preview output. Mirrored
   *  to localStorage so it persists across reloads. */
  filenamePattern: FilenamePattern;
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
  recents: [],
  recentFiles: [],
  activeRecentFolderId: null,
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
  successes: [],
  validationResult: null,
  validating: false,
  folder: initialFolderState,
  bulkImport: null,
  filenamePattern: readFilenamePattern(),
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
  /** The recents-folder id we saved this directory under. Lets the slice
   *  attribute follow-up recent-FILE saves to the right folder without
   *  re-querying IDB. Null when no handle (input-fallback path). */
  recentFolderId: string | null;
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
    const autoSelectedName = meta[0]?.name ?? null;
    // Auto-load the latest .xml so Step 1 fully resolves on a single click.
    // Fire-and-forget; loadFile maintains its own pending/loading state.
    if (autoSelectedId) {
      const file = getFolderFile(autoSelectedId);
      if (file) void dispatch(loadFile(file));
    }

    // Persist the handle for the recent-folders dropdown — only meaningful
    // when we actually have a handle (FS Access API path). Best-effort:
    // a failure here doesn't fail the pick. Also record the auto-loaded
    // file as a recent-file entry so the user can re-open it across
    // sessions without re-picking the folder first.
    let recentFolderId: string | null = null;
    if (result.handle) {
      const folderRecord = await saveRecentFolder(result.folderName, result.handle);
      recentFolderId = folderRecord.id;
      if (autoSelectedName) {
        await saveRecentFile(folderRecord.id, autoSelectedName);
      }
      void dispatch(hydrateRecentFolders());
      void dispatch(hydrateRecentFiles());
    }

    return {
      name: result.folderName,
      files: meta,
      refreshable: !!result.handle,
      autoSelectedId,
      recentFolderId,
    };
  } catch (err) {
    if (err instanceof FolderPickError) return rejectWithValue(err.message);
    return rejectWithValue(err instanceof Error ? err.message : String(err));
  }
});

/**
 * Boot-time hydration: read the IDB recent-folders list and mirror the
 * display tuple into Redux. Handles stay in IDB until the user clicks
 * one — at that point we re-permission and rescan.
 */
export const hydrateRecentFolders = createAsyncThunk<
  RecentFolderMeta[],
  void,
  ThunkConfig
>("addTable/hydrateRecentFolders", async () => {
  const records = await listRecentFolders();
  return records.map((r) => ({
    id: r.id,
    name: r.name,
    lastUsedAt: r.lastUsedAt,
  }));
});

/**
 * Re-open a recent folder by id. Requests read permission, rescans, and
 * loads the latest .xml — same downstream flow as pickFolder.fulfilled.
 *
 * If permission is denied or the handle is no longer resolvable, the
 * entry is purged from IDB so the dropdown stops showing a dead row.
 */
export const useRecentFolder = createAsyncThunk<
  PickFolderResult,
  string,
  ThunkConfig
>("addTable/useRecentFolder", async (id, { dispatch, rejectWithValue }) => {
  const record = await getRecentFolder(id);
  if (!record) return rejectWithValue("That folder is no longer in your recent list.");

  try {
    const entries = await rescanHandle(record.handle);

    clearFolderFiles();
    clearPreferredFolderHandle();
    setPreferredFolderHandle(record.handle);

    const xmlEntries = sortLatest(filterXml(entries));
    for (const e of xmlEntries) setFolderFile(e.id, e.file);

    const meta: FolderFileMeta[] = xmlEntries.map((e) => ({
      id: e.id,
      name: e.name,
      lastModified: e.lastModified,
      size: e.size,
    }));

    const autoSelectedId = meta[0]?.id ?? null;
    const autoSelectedName = meta[0]?.name ?? null;
    if (autoSelectedId) {
      const file = getFolderFile(autoSelectedId);
      if (file) void dispatch(loadFile(file));
    }

    // Bump lastUsedAt so the entry surfaces at the top next time. Also
    // record the auto-loaded file as a recent-file entry.
    const folderRecord = await saveRecentFolder(record.name, record.handle);
    if (autoSelectedName) {
      await saveRecentFile(folderRecord.id, autoSelectedName);
    }
    void dispatch(hydrateRecentFolders());
    void dispatch(hydrateRecentFiles());

    return {
      recentFolderId: folderRecord.id,
      name: record.name,
      files: meta,
      refreshable: true,
      autoSelectedId,
    } as PickFolderResult;
  } catch (err) {
    // Permission revoked or handle invalidated — drop the entry and
    // surface a friendly message.
    if (err instanceof FolderPickError) {
      await removeRecentFolder(id);
      // Cascade: orphan recent files for the dropped folder.
      await removeRecentFilesByFolder(id);
      void dispatch(hydrateRecentFolders());
      void dispatch(hydrateRecentFiles());
      return rejectWithValue(err.message);
    }
    return rejectWithValue(err instanceof Error ? err.message : String(err));
  }
});

export const forgetRecentFolder = createAsyncThunk<void, string, ThunkConfig>(
  "addTable/forgetRecentFolder",
  async (id, { dispatch }) => {
    await removeRecentFolder(id);
    // Don't leave dangling recent-file pointers to a folder the user
    // explicitly forgot.
    await removeRecentFilesByFolder(id);
    void dispatch(hydrateRecentFolders());
    void dispatch(hydrateRecentFiles());
  }
);

// --- Recent files thunks ---------------------------------------------------

export const hydrateRecentFiles = createAsyncThunk<
  RecentFileMeta[],
  void,
  ThunkConfig
>("addTable/hydrateRecentFiles", async () => {
  const [files, folders] = await Promise.all([
    listRecentFiles(),
    listRecentFolders(),
  ]);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  return files.map((f) => ({
    id: f.id,
    folderId: f.folderId,
    folderName: folderName.get(f.folderId) ?? null,
    fileName: f.fileName,
    lastUsedAt: f.lastUsedAt,
  }));
});

/**
 * Re-open a file from the recent-files dropdown. Looks up the parent
 * folder, re-permissions and rescans it, then resolves the file by name
 * and dispatches the normal loadFile pipeline. Drops the recent-file
 * entry if either the folder is gone or the file no longer exists.
 */
export const useRecentFile = createAsyncThunk<void, string, ThunkConfig>(
  "addTable/useRecentFile",
  async (id, { dispatch, rejectWithValue }) => {
    const recent = await getRecentFile(id);
    if (!recent) return rejectWithValue("That file is no longer in your recent list.");
    const folderRecord = await getRecentFolder(recent.folderId);
    if (!folderRecord) {
      await removeRecentFile(id);
      void dispatch(hydrateRecentFiles());
      return rejectWithValue("The parent folder is no longer remembered.");
    }
    try {
      const entries = await rescanHandle(folderRecord.handle);
      clearFolderFiles();
      clearPreferredFolderHandle();
      setPreferredFolderHandle(folderRecord.handle);

      const xmlEntries = sortLatest(filterXml(entries));
      for (const e of xmlEntries) setFolderFile(e.id, e.file);

      const target = xmlEntries.find((e) => e.name === recent.fileName);
      if (!target) {
        await removeRecentFile(id);
        void dispatch(hydrateRecentFiles());
        return rejectWithValue(
          `"${recent.fileName}" is no longer in this folder.`
        );
      }

      await dispatch(loadFile(target.file));
      // Bump folder + file recency so this becomes the most-recent of each.
      await saveRecentFolder(folderRecord.name, folderRecord.handle);
      await saveRecentFile(folderRecord.id, recent.fileName);
      void dispatch(hydrateRecentFolders());
      void dispatch(hydrateRecentFiles());
    } catch (err) {
      if (err instanceof FolderPickError) {
        // Permission revoked — folder gone. Cascade-clean.
        await removeRecentFolder(folderRecord.id);
        await removeRecentFilesByFolder(folderRecord.id);
        void dispatch(hydrateRecentFolders());
        void dispatch(hydrateRecentFiles());
        return rejectWithValue(err.message);
      }
      return rejectWithValue(err instanceof Error ? err.message : String(err));
    }
  }
);

export const forgetRecentFile = createAsyncThunk<void, string, ThunkConfig>(
  "addTable/forgetRecentFile",
  async (id, { dispatch }) => {
    await removeRecentFile(id);
    void dispatch(hydrateRecentFiles());
  }
);

/**
 * Re-iterate the persisted directory handle and rebuild the file list.
 * Re-applies auto-selection of the latest .xml file. Throws if the folder
 * was opened via the input-fallback path (no handle to refresh from).
 */
export const refreshFolder = createAsyncThunk<
  PickFolderResult,
  void,
  ThunkConfig
>("addTable/refreshFolder", async (_, { dispatch, getState, rejectWithValue }) => {
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

    // Refresh keeps the current folder, so reuse the active id from state.
    const recentFolderId = getState().addTable.folder.activeRecentFolderId;
    return {
      name: handle.name,
      files: meta,
      refreshable: true,
      autoSelectedId,
      recentFolderId,
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
>("addTable/selectFolderFile", async (id, { dispatch, getState, rejectWithValue }) => {
  const file = getFolderFile(id);
  if (!file) return rejectWithValue("Selected file is no longer available — refresh the folder.");
  await dispatch(loadFile(file));
  // If we know which recents-folder this came from, record the file too.
  const folder = getState().addTable.folder;
  if (folder.activeRecentFolderId) {
    await saveRecentFile(folder.activeRecentFolderId, file.name);
    void dispatch(hydrateRecentFiles());
  }
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

      // Wire two minimal Relationship elements so the ERD tab demos
      // the dagre layout instead of three disconnected boxes. The
      // relationships parser only reads parent/child entity refs and
      // the OFSAA validator doesn't gate on relationship structure,
      // so a stripped-down RelationshipProps is enough.
      addSampleRelationship(tmpDoc, "CUSTOMERS", "SALES_ORDERS", "FK_ORDER_CUSTOMER");
      addSampleRelationship(tmpDoc, "PRODUCTS", "SALES_ORDERS", "FK_ORDER_PRODUCT");

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

/**
 * Build the would-be output XML against a clone of the live doc. Like
 * validateModel, this never touches the in-memory doc the user is
 * working against — gives the user a chance to eyeball the XML and the
 * proposed filename before the actual download is triggered.
 */
export interface PreviewInfo {
  xml: string;
  filename: string;
  tablesAdded: number;
}

export const previewXml = createAsyncThunk<PreviewInfo, void, ThunkConfig>(
  "addTable/previewXml",
  async (_, { getState, rejectWithValue }) => {
    const { parsed, stagedTables, filenamePattern } = getState().addTable;
    if (!parsed) return rejectWithValue("No XML loaded");
    if (stagedTables.length === 0) return rejectWithValue("No tables to add");
    const liveDoc = getParsedDoc(parsed.parseId);
    if (!liveDoc) return rejectWithValue("Parsed document is no longer available");

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

    return {
      xml: serializeDoc(cloneDoc),
      filename: generateNextFileName(parsed.fileName, filenamePattern),
      tablesAdded: stagedTables.length,
    };
  }
);

export const generate = createAsyncThunk<SuccessInfo, void, ThunkConfig>(
  "addTable/generate",
  async (_, { getState, rejectWithValue }) => {
    const { parsed, stagedTables, isFinalized, filenamePattern } = getState().addTable;
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

    const nextName = generateNextFileName(parsed.fileName, filenamePattern);
    const xml = serializeDoc(doc);
    downloadBlob(xml, nextName, "application/xml");
    return {
      id: crypto.randomUUID(),
      tableName: lastName,
      filename: nextName,
      tablesAdded: stagedTables.length,
      generatedAt: Date.now(),
    };
  }
);

const slice = createSlice({
  name: "addTable",
  initialState,
  reducers: {
    /**
     * Wipe the session back to its empty state — clears the loaded file,
     * staged tables, form, finalization, success toast, and the validator
     * dry-run result. Preserves the user's preferred-folder pick because
     * that's a session-level preference, independent of the file.
     * The associated parsed XMLDocument is removed from the ref store
     * so it can be GC'd.
     */
    resetSession(state) {
      if (state.parsed) {
        deleteParsedDoc(state.parsed.parseId);
      }
      state.parsed = null;
      state.loadError = undefined;
      state.loading = false;
      state.tableName = "";
      state.description = "";
      state.columns = [makeColumn()];
      state.stagedTables = [];
      state.editingId = null;
      state.isFinalized = false;
      state.successes = [];
      state.validationResult = null;
      state.validating = false;
      state.bulkImport = null;
      // state.folder is intentionally preserved.
    },
    /**
     * Bulk-import a list of `parseOracleDdlMulti` results. Each parsed
     * table is validated against the loaded model, the already-staged
     * names, and the rest of this batch (so two CREATE TABLEs for the
     * same name in one paste don't both land). Valid tables are pushed
     * to stagedTables; the per-table outcome plus any pre-validated
     * parse errors are stashed on `state.bulkImport` for the UI.
     */
    bulkStageTables(
      state,
      action: PayloadAction<{
        parsed: ParsedDdl[];
        parseErrors: DdlParseError[];
      }>
    ) {
      if (state.isFinalized) return;
      state.validationResult = null;
      state.successes = [];

      const { parsed, parseErrors } = action.payload;
      const entityDict = state.parsed?.entityDict ?? new Map<string, string>();
      const stagedNames = new Set(
        state.stagedTables.map((t) => t.table_name.toUpperCase())
      );
      // Names claimed by earlier valid entries in THIS batch. Prevents two
      // identical CREATE TABLEs in one paste from both landing.
      const seenInBatch = new Set<string>();

      const added: BulkImportAdded[] = [];
      const errors: BulkImportError[] = [];

      for (const t of parsed) {
        const reasons: string[] = [];
        const trimmed = (t.tableName ?? "").trim();
        const upper = trimmed.toUpperCase();

        if (!trimmed) {
          errors.push({ name: "(unnamed)", reasons: ["No table name parsed."] });
          continue;
        }

        const idCheck = validateIdentifier(trimmed, "table name");
        if (!idCheck.ok && idCheck.error) reasons.push(idCheck.error);
        if (entityDict.has(upper)) {
          reasons.push(`"${trimmed}" already exists in the loaded model.`);
        }
        if (stagedNames.has(upper)) {
          reasons.push(`"${trimmed}" is already queued in this session.`);
        }
        if (seenInBatch.has(upper)) {
          reasons.push(`"${trimmed}" appears more than once in this paste.`);
        }
        if (t.columns.length > MAX_COLUMNS_PER_TABLE) {
          reasons.push(
            `${t.columns.length} columns exceeds the Oracle limit of ${MAX_COLUMNS_PER_TABLE}.`
          );
        }

        const seenCols = new Set<string>();
        const cleanCols: NewColumnSpec[] = [];
        for (const c of t.columns) {
          const cn = c.name.trim();
          if (!cn) {
            reasons.push("A column has no name.");
            continue;
          }
          const cidCheck = validateIdentifier(cn, "column name");
          if (!cidCheck.ok && cidCheck.error) {
            reasons.push(`Column "${cn}": ${cidCheck.error}`);
            continue;
          }
          const key = cn.toUpperCase();
          if (seenCols.has(key)) {
            reasons.push(`Duplicate column "${cn}".`);
            continue;
          }
          seenCols.add(key);
          const sizeErr = validateColumnSize(c);
          if (sizeErr) {
            reasons.push(`Column "${cn}": ${sizeErr}`);
            continue;
          }
          cleanCols.push({ ...c, name: cn });
        }
        if (cleanCols.length === 0 && reasons.length === 0) {
          reasons.push("No valid columns parsed.");
        }

        if (reasons.length > 0) {
          errors.push({ name: trimmed, reasons });
          continue;
        }

        // Claim the name in the batch and push to staged.
        seenInBatch.add(upper);
        const staged: StagedTable = {
          id: crypto.randomUUID(),
          table_name: trimmed,
          description: "",
          columns: cleanCols,
        };
        state.stagedTables.push(staged);
        stagedNames.add(upper);
        added.push({
          name: trimmed,
          columnCount: cleanCols.length,
          pkCount: cleanCols.filter((c) => c.pk).length,
          warnings: t.warnings,
        });
      }

      state.bulkImport = {
        added,
        errors,
        parseErrors,
        ranAt: Date.now(),
      };
    },
    /** Clears the last bulk-import summary panel (Dismiss button). */
    clearBulkImport(state) {
      state.bulkImport = null;
    },
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
      // Reordering changes Physical_Order indices in the emit; previous
      // validation pass no longer reflects what would be generated.
      state.validationResult = null;
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
      // Any column edit invalidates a previous validation pass.
      state.validationResult = null;
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
      state.successes = [];
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
      state.successes = [];
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
      state.successes = [];
    },
    /** Clear every queued success toast. */
    clearSuccess(state) {
      state.successes = [];
    },
    /** Dismiss a single toast by id (the × button on each toast). */
    dismissSuccess(state, action: PayloadAction<string>) {
      state.successes = state.successes.filter((s) => s.id !== action.payload);
    },
    /** Switch the output filename pattern. Mirrored to localStorage. */
    setFilenamePattern(state, action: PayloadAction<FilenamePattern>) {
      state.filenamePattern = action.payload;
      writeFilenamePattern(action.payload);
    },
    clearValidationResult(state) {
      state.validationResult = null;
    },
    clearFolder(state) {
      state.folder = { ...initialFolderState, recents: state.folder.recents };
      clearFolderFiles();
      clearPreferredFolderHandle();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadFile.pending, (state) => {
        state.loading = true;
        state.loadError = undefined;
        state.successes = [];
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
        state.successes = [];
        state.bulkImport = null;
      })
      .addCase(loadFile.rejected, (state, action) => {
        state.loading = false;
        state.loadError = action.payload ?? action.error.message;
      })
      .addCase(generate.fulfilled, (state, action) => {
        // Newest at the front so the most-recent generate appears at the
        // top of the toast stack. Slice cap drops the oldest.
        state.successes = [action.payload, ...state.successes].slice(
          0,
          MAX_SUCCESS_QUEUE
        );
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
        const { name, files, refreshable, autoSelectedId, recentFolderId } = action.payload;
        // Preserve the recents lists across folder swaps — they live in IDB
        // and are hydrated separately, but the in-memory copies must survive.
        state.folder.name = name;
        state.folder.files = files;
        state.folder.selectedFileId = autoSelectedId;
        state.folder.refreshable = refreshable;
        state.folder.activeRecentFolderId = recentFolderId;
        state.folder.loading = false;
        state.folder.error = undefined;
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
        state.folder.name = name;
        state.folder.files = files;
        state.folder.selectedFileId = autoSelectedId;
        state.folder.refreshable = refreshable;
        state.folder.loading = false;
        state.folder.error = undefined;
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
      })
      .addCase(hydrateRecentFolders.fulfilled, (state, action) => {
        state.folder.recents = action.payload;
      })
      .addCase(hydrateRecentFiles.fulfilled, (state, action) => {
        state.folder.recentFiles = action.payload;
      })
      .addCase(useRecentFolder.pending, (state) => {
        state.folder.loading = true;
        state.folder.error = undefined;
      })
      .addCase(useRecentFolder.fulfilled, (state, action) => {
        const { name, files, refreshable, autoSelectedId, recentFolderId } = action.payload;
        state.folder.name = name;
        state.folder.files = files;
        state.folder.selectedFileId = autoSelectedId;
        state.folder.refreshable = refreshable;
        state.folder.activeRecentFolderId = recentFolderId;
        state.folder.loading = false;
        state.folder.error = undefined;
      })
      .addCase(useRecentFolder.rejected, (state, action) => {
        state.folder.loading = false;
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
  resetSession,
  bulkStageTables,
  clearBulkImport,
  dismissSuccess,
  setFilenamePattern,
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
