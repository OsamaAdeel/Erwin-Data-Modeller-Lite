import { useEffect, useMemo, useState } from "react";
import { ADD_TABLE, COMMON } from "@/CONSTANTS";
import Button from "@/components/atoms/Button";
import Card from "@/components/atoms/Card";
import Input from "@/components/atoms/Input";
import Badge from "@/components/atoms/Badge";
import Textarea from "@/components/atoms/Textarea";
import Field from "@/components/molecules/Field";
import ConfirmModal from "@/components/molecules/ConfirmModal";
import EntityPropertiesCard from "@/components/molecules/EntityPropertiesCard";
import FileDrop from "@/components/molecules/FileDrop";
import FolderPicker from "@/components/molecules/FolderPicker";
import StatTile from "@/components/molecules/StatTile";
import ValidationPanel from "@/components/molecules/ValidationPanel";
import XmlPreviewModal from "@/components/molecules/XmlPreviewModal";
import { WARNING_MESSAGES } from "@/features/addTable/validation";
import { useAddTable } from "@/features/addTable/useAddTable";
import type {
  BulkImportResult,
  StagedTable,
} from "@/features/addTable/useAddTable";
import { collectFullModel } from "@/services/xml/model";
import { generateNextFileName } from "@/services/xml/serialize";
import { parseOracleDdl, parseOracleDdlMulti } from "@/services/ddl/ddlParser";
import { getParsedDoc } from "@/store/refs";
import ColumnRow from "./ColumnRow";
import styles from "./AddTablePanel.module.scss";

// Step 2's entity browser caps the initial pill count to keep large models
// (500+ tables) snappy on first paint. The user can opt to render the rest
// via "Show all", or just start typing a search.
const ENTITY_LIST_INITIAL_LIMIT = 50;

export default function AddTablePanel() {
  const t = ADD_TABLE;
  const [search, setSearch] = useState("");
  // Step 1 collapses to a summary row once a file has been loaded so the
  // dropzone + folder picker don't dominate the page on subsequent edits.
  // The "Change" button below the summary expands it back.
  const [showUploaders, setShowUploaders] = useState(true);
  // Confirm modal for the finalize action (replaces window.confirm).
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  // Confirm dialog for destructive staged-table deletion. Holds the id
  // of the row we'd remove on confirm; null when the dialog is closed.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // "Paste DDL" mode swaps the column grid for a textarea + Parse button.
  const [ddlMode, setDdlMode] = useState(false);
  const [ddlText, setDdlText] = useState("");
  const [ddlWarnings, setDdlWarnings] = useState<string[]>([]);
  // Filter for the staged-tables grid. Pure UI state.
  const [stagedSearch, setStagedSearch] = useState("");
  // Confirm dialog for the Reset button. Only used when the user has
  // unsaved work (staged tables or a finalized model) — empty sessions
  // reset immediately.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // Step 2 entity browser — name of the entity whose property card is open,
  // or null when nothing is selected. Cleared on file change (parseId effect
  // below).
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);
  // When true, render every entity pill at once. When false, cap the list
  // at ENTITY_LIST_INITIAL_LIMIT to keep large models (500+ tables) snappy.
  const [showAllEntities, setShowAllEntities] = useState(false);
  // Output-XML preview modal state. `pending` while the clone+emit
  // round-trip runs so the button can show a busy label.
  const [previewState, setPreviewState] = useState<
    | { kind: "closed" }
    | { kind: "pending" }
    | { kind: "open"; xml: string; filename: string; tablesAdded: number }
    | { kind: "error"; message: string }
  >({ kind: "closed" });
  const {
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
    successes,
    dismissSuccess,
    validation,
    canFinalize,
    canGenerate,
    loadFile,
    loadSample,
    setTableName,
    setDescription,
    addColumn,
    removeColumn,
    reorderColumns,
    updateColumn,
    commitTable,
    deleteStagedTable,
    editStagedTable,
    cancelEdit,
    resetForm,
    finalize,
    unfinalize,
    generate,
    previewXml,
    validateModel,
    validationResult,
    validating,
    replaceColumns,
    resetSession,
    bulkImport,
    bulkStageTables,
    clearBulkImport,
    filenamePattern,
    setFilenamePattern,
    folder,
    pickFolder,
    refreshFolder,
    selectFolderFile,
    clearFolder,
    hydrateRecentFolders,
    useRecentFolder,
    forgetRecentFolder,
  } = useAddTable();

  // Pull the IDB recent-folders list on mount so the empty-state can
  // render it. Cheap — at most one IDB read; safe to fire on every
  // mount.
  useEffect(() => {
    hydrateRecentFolders();
  }, [hydrateRecentFolders]);

  // Warn the user before navigating away if they have staged tables that
  // haven't been generated. The previous session's work is not persisted,
  // so accidentally closing the tab loses it. Modern browsers ignore the
  // custom message and show a generic prompt — we just need to set
  // returnValue (or call preventDefault) to opt in.
  const hasUnsavedWork = stagedTables.length > 0;
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);

  // Auto-collapse Step 1 the first time a file lands. Re-fires on every
  // new parseId so loading a different file collapses again.
  useEffect(() => {
    if (parsed?.parseId) setShowUploaders(false);
  }, [parsed?.parseId]);

  // Drop the Step-2 selection when a different file is loaded — names from
  // the prior model would no longer resolve.
  useEffect(() => {
    setSelectedEntityName(null);
    setShowAllEntities(false);
  }, [parsed?.parseId]);

  // Lazily build the full structured model (with columns + PKs) for Step 2's
  // property card. Memoized on parseId — collectFullModel walks the doc, so
  // we don't want to redo it on every keystroke.
  const fullModel = useMemo(() => {
    if (!parsed) return null;
    const doc = getParsedDoc(parsed.parseId);
    return doc ? collectFullModel(doc) : null;
  }, [parsed?.parseId]);

  const selectedEntity = useMemo(
    () =>
      fullModel && selectedEntityName
        ? fullModel.entitiesByUpper.get(selectedEntityName.toUpperCase()) ?? null
        : null,
    [fullModel, selectedEntityName]
  );

  const filteredEntities = useMemo(() => {
    if (!parsed) return [];
    const list = Array.from(parsed.entityDict.values()).sort((a, b) => a.localeCompare(b));
    if (!search) return list;
    const q = search.toUpperCase();
    return list.filter((n) => n.toUpperCase().includes(q));
  }, [parsed, search]);

  const errorByColId = useMemo(() => {
    const m = new Map<string, { message: string; isNameError: boolean }>();
    for (const e of validation.columnErrors) {
      m.set(e.colId, { message: e.message, isNameError: e.isNameError });
    }
    return m;
  }, [validation]);

  // Stable id-list passed to ColumnRow so its keyboard-reorder handler can
  // resolve the previous / next sibling. Recomputed only when the order or
  // membership changes — id strings are stable per row.
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);

  // True when the in-progress form has anything worth resetting: a table
  // name, a description, more than one column row, or a column with any
  // typed content. The default scaffold (one empty VARCHAR2 row) reads as
  // "clean" so the Reset button stays disabled until the user starts
  // typing.
  const isFormDirty = useMemo(() => {
    if (tableName.trim() || description.trim()) return true;
    if (columns.length > 1) return true;
    const c = columns[0];
    return !!c && (
      !!c.name.trim() ||
      !!c.size ||
      !!c.scale ||
      c.type !== "VARCHAR2" ||
      c.pk
    );
  }, [tableName, description, columns]);

  const formLocked = isFinalized;

  const nextFileName = useMemo(
    () => (parsed ? generateNextFileName(parsed.fileName, filenamePattern) : ""),
    [parsed, filenamePattern]
  );

  function handleFinalize() {
    if (!canFinalize) return;
    setFinalizeConfirmOpen(true);
  }

  function confirmFinalize() {
    setFinalizeConfirmOpen(false);
    finalize();
  }

  async function handlePreview() {
    if (stagedTables.length === 0) return;
    setPreviewState({ kind: "pending" });
    try {
      const info = await previewXml();
      setPreviewState({ kind: "open", ...info });
    } catch (err) {
      setPreviewState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handlePreviewDownload() {
    setPreviewState({ kind: "closed" });
    generate();
  }

  // Reset wipes the loaded file, staged tables, form, finalization, and
  // success/validation state — but keeps the preferred-folder pick. We
  // confirm only when there's actual work at risk; an empty session
  // resets in one click.
  const hasResetableWork = stagedTables.length > 0 || isFinalized;
  function handleReset() {
    if (hasResetableWork) {
      setResetConfirmOpen(true);
    } else {
      doReset();
    }
  }
  function doReset() {
    setResetConfirmOpen(false);
    resetSession();
    // Step 1 was collapsed to the loaded-summary row; expand it back to
    // the upload UI so the user lands on a familiar empty state.
    setShowUploaders(true);
  }

  // ⌘/Ctrl+Enter from inside the panel commits the staged table. The
  // handler is on the panel root, so the bubble path naturally enforces
  // the "panel form has focus" requirement: a key event only reaches us
  // if focus was somewhere inside the wrap to begin with.
  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key !== "Enter") return;
    if (!validation.canSubmit) return;
    e.preventDefault();
    commitTable();
  }

  // Visual state of each step's badge. Computed from the same data the cards
  // gate their content on, so the green ✓ flips at the same moment the user's
  // prerequisite is satisfied.
  const step1State = parsed ? "complete" : "active";
  const step2State = parsed ? "complete" : "upcoming";
  const step3State = stagedTables.length > 0 ? "complete" : "active";
  const step4State = isFinalized
    ? "complete"
    : stagedTables.length > 0
      ? "active"
      : "upcoming";
  const step5State = successes.length > 0
    ? "complete"
    : isFinalized || canFinalize
      ? "active"
      : "upcoming";

  return (
    <div className={styles.wrap} onKeyDown={handlePanelKeyDown}>
      <Card step={1} stepState={step1State} title={t.sections.upload.heading}>
        {parsed && !showUploaders ? (
          <div className={styles.loadedSummary}>
            <div className={styles.loadedSummaryBody}>
              <FileGlyph className={styles.loadedIcon} />
              <div className={styles.loadedSummaryText}>
                <div className={styles.loadedSummaryName} title={parsed.fileName}>
                  {parsed.fileName}
                </div>
                <div className={styles.loadedSummaryMeta}>
                  {parsed.entityDict.size} entities · {parsed.variant}
                </div>
              </div>
            </div>
            <div className={styles.loadedSummaryActions}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                title="Clear the loaded file, staged tables, and form"
              >
                Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowUploaders(true)}>
                Change file
              </Button>
            </div>
          </div>
        ) : (
          <>
            <FolderPicker
              state={folder}
              onPick={pickFolder}
              onRefresh={refreshFolder}
              onSelectFile={selectFolderFile}
              onClear={clearFolder}
              onUseRecent={useRecentFolder}
              onForgetRecent={forgetRecentFolder}
            />
            <div className={styles.uploadSeparator} aria-hidden>or upload a single file</div>
            <FileDrop
              hint={t.sections.upload.dropHint}
              subhint={t.sections.upload.dropSubhint}
              loadedName={parsed ? `${t.sections.upload.loadedPrefix} ${parsed.fileName}` : undefined}
              loadedMeta={parsed ? `${parsed.entityDict.size} entities · ${parsed.variant}` : undefined}
              error={loadError}
              loading={loading}
              onFile={(f) => void loadFile(f)}
            />
            {!parsed && (
              <p className={styles.sampleHint}>
                Don't have a model handy?{" "}
                <button type="button" className={styles.sampleLink} onClick={loadSample}>
                  Try with a sample model
                </button>
                .
              </p>
            )}
          </>
        )}
      </Card>

      {parsed && (
        <Card step={2} stepState={step2State} title={t.sections.info.heading} collapsible>
          <div className={styles.tileGrid}>
            <StatTile
              label={t.sections.info.entitiesLabel}
              value={parsed.entityDict.size}
              hint="An entity is one logical table in the model — for example CUSTOMER or ORDER."
            />
            <StatTile
              label={t.sections.info.domainsLabel}
              value={parsed.domainMap.size}
              hint="A domain is a reusable column type definition (e.g. an AMOUNT domain shared across all amount columns) defined once in the model and referenced by attributes."
            />
            <StatTile
              label={t.sections.info.variantLabel}
              value={<span className={styles.variantValue}>{parsed.variant}</span>}
              hint="erwin-dm-v9 = the modern erwin Data Modeler 9.x XML schema (uses the EMX namespace). erwin-classic = the older flat XML format. Merge and ERD require dm-v9."
            />
          </div>

          <details className={styles.entityList}>
            <summary>Browse {parsed.entityDict.size} existing entities</summary>
            <div className={styles.entityListBody}>
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {(() => {
                // Cap the visible pill count on first paint so a 500-entity
                // model doesn't render 500 DOM nodes the user mostly won't
                // look at. The cap drops as soon as the user types in the
                // search (filtered list is already smaller) or clicks
                // "Show all".
                const isSearching = search.trim().length > 0;
                const showAll = showAllEntities || isSearching;
                const visible = showAll
                  ? filteredEntities
                  : filteredEntities.slice(0, ENTITY_LIST_INITIAL_LIMIT);
                const hiddenCount = filteredEntities.length - visible.length;
                return (
                  <>
                    <ul className={styles.entityNames}>
                      {filteredEntities.length === 0 && (
                        <li className={styles.entityEmpty}>
                          {parsed.entityDict.size === 0
                            ? "No tables in this model."
                            : "No tables found."}
                        </li>
                      )}
                      {visible.map((n) => {
                        const isSelected =
                          selectedEntityName != null &&
                          n.toUpperCase() === selectedEntityName.toUpperCase();
                        return (
                          <li key={n}>
                            <button
                              type="button"
                              className={`${styles.entityPill} ${isSelected ? styles.entityPillActive : ""}`}
                              title={n}
                              aria-pressed={isSelected}
                              onClick={() =>
                                setSelectedEntityName((cur) => (cur === n ? null : n))
                              }
                            >
                              {n}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        className={styles.entityShowAll}
                        onClick={() => setShowAllEntities(true)}
                      >
                        Show all ({filteredEntities.length})
                      </button>
                    )}
                  </>
                );
              })()}
              {selectedEntity && (
                <EntityPropertiesCard
                  entity={selectedEntity}
                  onClose={() => setSelectedEntityName(null)}
                />
              )}
            </div>
          </details>
        </Card>
      )}

      {parsed && (
        <Card step={3} stepState={step3State} title={t.sections.addForm.heading}>
          <div className={`${styles.formBlock} ${formLocked ? styles.locked : ""}`}>
            <div className={styles.formGrid}>
              <Field
                label={t.sections.addForm.nameLabel}
                error={validation.tableNameError}
              >
                <Input
                  kind="code"
                  placeholder={t.sections.addForm.namePlaceholder}
                  value={tableName}
                  maxLength={128}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={formLocked}
                  invalid={!!validation.tableNameError}
                  onChange={(e) => setTableName(e.target.value)}
                />
              </Field>

              <Field label={t.sections.addForm.descriptionLabel}>
                <Input
                  placeholder={t.sections.addForm.descriptionPlaceholder}
                  value={description}
                  maxLength={256}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={formLocked}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>

            <div className={styles.colsBlock}>
              {!validation.tableNameValid && (
                <p className={styles.colsHint} role="status">
                  Enter a valid table name above to save this table.
                </p>
              )}
              {ddlMode ? (
                <DdlPasteArea
                  value={ddlText}
                  warnings={ddlWarnings}
                  disabled={formLocked}
                  onChange={setDdlText}
                  onCancel={() => {
                    setDdlMode(false);
                    setDdlText("");
                    setDdlWarnings([]);
                  }}
                  onParse={() => {
                    // Multi-statement first: a single paste can hold many
                    // CREATE TABLE blocks. We branch by count:
                    //   0 tables → error feedback in the paste area
                    //   1 table  → keep the existing "fill form" UX
                    //   2+ tables → bulk-stage all valid tables and show
                    //              the result panel below the form
                    const multi = parseOracleDdlMulti(ddlText);
                    if (multi.tables.length === 0) {
                      const messages = multi.parseErrors.length
                        ? multi.parseErrors.map(
                            (e) => `Couldn't parse: ${e.snippet} — ${e.message}`
                          )
                        : ["No CREATE TABLE statements found in the input."];
                      setDdlWarnings(messages);
                      return;
                    }
                    if (multi.tables.length === 1 && multi.parseErrors.length === 0) {
                      const result = parseOracleDdl(ddlText);
                      if (result.tableName && !tableName.trim()) {
                        setTableName(result.tableName);
                      }
                      replaceColumns(result.columns);
                      setDdlMode(false);
                      setDdlText("");
                      setDdlWarnings(result.warnings);
                      return;
                    }
                    bulkStageTables({
                      parsed: multi.tables,
                      parseErrors: multi.parseErrors,
                    });
                    setDdlMode(false);
                    setDdlText("");
                    setDdlWarnings([]);
                  }}
                />
              ) : (
                <>
                  <div className={styles.colsToolbar}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDdlMode(true)}
                      disabled={formLocked}
                      title="Paste a CREATE TABLE statement; we'll fill the column rows for you"
                    >
                      Paste DDL…
                    </Button>
                  </div>
                  <div className={styles.colsHeader}>
                    <span title="Drag to reorder">⋮⋮</span>
                    <span>Name</span>
                    <span>Type</span>
                    <span>Size / scale</span>
                    <span title="Nullable">Null</span>
                    <span title="Primary key">PK</span>
                    <span />
                  </div>
                  <div className={styles.colsList}>
                    {columns.map((c) => (
                      <ColumnRow
                        key={c.id}
                        column={c}
                        error={errorByColId.get(c.id)}
                        isOnly={columns.length === 1}
                        locked={formLocked}
                        siblingIds={columnIds}
                        onChange={(patch) => updateColumn(c.id, patch)}
                        onRemove={() => removeColumn(c.id)}
                        onReorder={reorderColumns}
                      />
                    ))}
                  </div>
                  <div className={styles.colsActions}>
                    <Button variant="outline" size="sm" onClick={addColumn} disabled={formLocked}>
                      + Add column
                    </Button>
                  </div>
                  {ddlWarnings.length > 0 && (
                    <div className={styles.ddlWarnings}>
                      <strong>Imported with warnings:</strong>
                      <ul>
                        {ddlWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

            {validation.warnings.length > 0 && (
              <div className={styles.warnings}>
                {validation.warnings.map((w) => (
                  <div key={w} className={styles.warning}>
                    <Badge tone="warning">!</Badge>
                    <span>{WARNING_MESSAGES[w]}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.formActions}>
              <Button onClick={commitTable} disabled={!validation.canSubmit}>
                {editingId ? t.sections.addForm.submitEdit : t.sections.addForm.submit}
              </Button>
              {editingId ? (
                <Button variant="ghost" onClick={cancelEdit}>
                  {COMMON.buttons.cancel}
                </Button>
              ) : (
                // When not editing, "Reset" clears the in-progress form
                // (table name, description, columns) without touching
                // anything already staged. Disabled when there's nothing
                // to reset so the button doesn't read as actionable on a
                // fresh form.
                <Button
                  variant="ghost"
                  onClick={resetForm}
                  disabled={!isFormDirty || formLocked}
                  title="Clear the table name, description, and columns"
                >
                  Reset
                </Button>
              )}
            </div>

            {bulkImport && (
              <BulkImportResultPanel
                key={bulkImport.ranAt}
                result={bulkImport}
                onDismiss={clearBulkImport}
              />
            )}
          </div>
        </Card>
      )}

      {parsed && (
        <Card
          step={4}
          stepState={step4State}
          title={t.sections.staged.heading}
          collapsible={stagedTables.length > 0}
        >
          {stagedTables.length === 0 ? (
            <div className={styles.stagedEmpty}>{t.sections.staged.empty}</div>
          ) : (
            <>
              <div className={styles.stagedHead}>
                <div className={styles.stagedCount}>
                  {t.sections.staged.countLabel.replace("{n}", String(stagedTables.length))}
                </div>
                {stagedTables.length > 3 && (
                  <Input
                    className={styles.stagedSearch}
                    type="search"
                    placeholder="Filter staged tables…"
                    value={stagedSearch}
                    onChange={(e) => setStagedSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && stagedSearch) {
                        e.preventDefault();
                        setStagedSearch("");
                      }
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Filter staged tables"
                  />
                )}
              </div>
              {(() => {
                const q = stagedSearch.trim().toLowerCase();
                const visible = q
                  ? stagedTables.filter(
                      (t) =>
                        t.table_name.toLowerCase().includes(q) ||
                        t.description.toLowerCase().includes(q)
                    )
                  : stagedTables;
                if (q && visible.length === 0) {
                  return (
                    <div className={styles.stagedEmpty}>
                      No staged tables match &ldquo;{stagedSearch}&rdquo;.
                    </div>
                  );
                }
                return (
                  <ul className={styles.stagedList}>
                    {visible.map((tbl) => (
                      <StagedTableItem
                        key={tbl.id}
                        table={tbl}
                        disabled={isFinalized}
                        isEditing={editingId === tbl.id}
                        columnCountSuffix={t.sections.staged.columnCountSuffix}
                        editLabel={t.sections.staged.editBtn}
                        deleteLabel={t.sections.staged.deleteBtn}
                        onEdit={() => editStagedTable(tbl.id)}
                        onDelete={() => setPendingDeleteId(tbl.id)}
                      />
                    ))}
                  </ul>
                );
              })()}
            </>
          )}
        </Card>
      )}

      {parsed && (
        <Card step={5} stepState={step5State} title={t.sections.finalize.heading}>
          <div className={styles.finalizeHead}>
            {/* key={String(isFinalized)} forces a remount on every flip
                so the wrapper's one-shot CSS animation re-fires. */}
            <span
              key={String(isFinalized)}
              className={`${styles.finalizeBadgeWrap} ${isFinalized ? styles.finalizeBadgeFlash : ""}`}
            >
              <Badge tone={isFinalized ? "success" : "warning"}>
                {isFinalized ? t.sections.finalize.finalizedLabel : t.sections.finalize.draftLabel}
              </Badge>
            </span>
            <div className={styles.finalizeSummary}>
              <span>{t.sections.finalize.summaryTables.replace("{n}", String(stagedTables.length))}</span>
              <span className={styles.finalizeSummaryDot}>·</span>
              <span>{t.sections.finalize.summaryColumns.replace("{n}", String(totalStagedColumns))}</span>
            </div>
          </div>

          <div className={styles.formActions}>
            {!isFinalized ? (
              <Button onClick={handleFinalize} disabled={!canFinalize}>
                {t.sections.finalize.finalizeBtn}
              </Button>
            ) : (
              <Button variant="outline" onClick={unfinalize}>
                {t.sections.finalize.unfinalizeBtn}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={validateModel}
              disabled={validating || stagedTables.length === 0}
              title="Run the OFSAA validator against the model with the staged tables applied — no download"
            >
              {validating ? "Validating…" : "Validate model"}
            </Button>
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={previewState.kind === "pending" || stagedTables.length === 0}
              title="See the would-be output XML before downloading — no file is written"
            >
              {previewState.kind === "pending" ? "Building…" : "Preview XML"}
            </Button>
            <Button
              size="lg"
              onClick={generate}
              disabled={!canGenerate}
              className={canGenerate ? styles.generateReady : ""}
            >
              <DownloadIcon />
              {t.sections.finalize.generateBtn}
            </Button>
          </div>

          {validationResult && (
            <ValidationPanel result={validationResult} className={styles.validationWrap} />
          )}

          {canGenerate && nextFileName && (
            <div className={styles.nextFilePreview}>
              <span>
                {t.sections.finalize.nextFilePreview}{" "}
                <code className={styles.mono}>{nextFileName}</code>
              </span>
              {/* Pattern picker — segmented control. Persists to localStorage
                  via the slice. The preview above re-renders as the pattern
                  flips so users see the result before they click Generate. */}
              <div
                className={styles.filenamePatternRow}
                role="radiogroup"
                aria-label="Filename pattern"
              >
                <PatternButton
                  active={filenamePattern === "v"}
                  label="v1"
                  title="Sequential — model_v1.xml"
                  onClick={() => setFilenamePattern("v")}
                />
                <PatternButton
                  active={filenamePattern === "v-padded"}
                  label="v01"
                  title="Zero-padded — model_v01.xml"
                  onClick={() => setFilenamePattern("v-padded")}
                />
                <PatternButton
                  active={filenamePattern === "timestamp"}
                  label="date"
                  title="ISO date — model_2026-05-05.xml"
                  onClick={() => setFilenamePattern("timestamp")}
                />
              </div>
            </div>
          )}

          {!canFinalize && !isFinalized && stagedTables.length === 0 && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needStagedHint}</div>
          )}
          {!canGenerate && stagedTables.length > 0 && !isFinalized && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needFinalizeHint}</div>
          )}

          {successes.length > 0 && (
            <div className={styles.successStack}>
              {successes.map((s) => (
                <GeneratedToast
                  key={s.id}
                  filename={s.filename}
                  tablesAdded={s.tablesAdded}
                  generatedAt={s.generatedAt}
                  onDismiss={() => dismissSuccess(s.id)}
                />
              ))}
            </div>
          )}
        </Card>
      )}
      <ConfirmModal
        open={finalizeConfirmOpen}
        title="Finalize the model?"
        message={t.sections.finalize.confirmFinalize}
        confirmLabel="Finalize"
        cancelLabel="Cancel"
        onConfirm={confirmFinalize}
        onCancel={() => setFinalizeConfirmOpen(false)}
      />
      <ConfirmModal
        open={pendingDeleteId !== null}
        title="Remove this table from the queue?"
        message={(() => {
          const t = stagedTables.find((x) => x.id === pendingDeleteId);
          return t
            ? `"${t.table_name}" will be removed from the staged list. This can't be undone.`
            : "";
        })()}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          if (pendingDeleteId) deleteStagedTable(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
      <XmlPreviewModal
        open={previewState.kind === "open"}
        xml={previewState.kind === "open" ? previewState.xml : ""}
        filename={previewState.kind === "open" ? previewState.filename : ""}
        tablesAdded={previewState.kind === "open" ? previewState.tablesAdded : 0}
        onDownload={handlePreviewDownload}
        onClose={() => setPreviewState({ kind: "closed" })}
      />
      <ConfirmModal
        open={previewState.kind === "error"}
        title="Couldn't build preview"
        message={previewState.kind === "error" ? previewState.message : ""}
        confirmLabel="OK"
        cancelLabel="Close"
        onConfirm={() => setPreviewState({ kind: "closed" })}
        onCancel={() => setPreviewState({ kind: "closed" })}
      />
      <ConfirmModal
        open={resetConfirmOpen}
        title="Reset the session?"
        message={(() => {
          const parts: string[] = [];
          if (stagedTables.length > 0) {
            parts.push(
              `${stagedTables.length} staged table${stagedTables.length === 1 ? "" : "s"}`
            );
          }
          if (isFinalized) parts.push("the finalized model");
          const what = parts.length ? parts.join(" and ") : "the loaded file";
          return `${what} will be cleared. Your preferred-folder pick is kept. This can't be undone.`;
        })()}
        confirmLabel="Reset"
        cancelLabel="Cancel"
        destructive
        onConfirm={doReset}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}

interface GeneratedToastProps {
  filename: string;
  tablesAdded: number;
  generatedAt: number;
  onDismiss: () => void;
}

// Auto-dismiss window. Long enough that a user who looks away briefly
// still catches the confirmation, short enough that the toast doesn't
// clutter the page across subsequent generates.
const TOAST_AUTO_DISMISS_MS = 6000;

function GeneratedToast({
  filename,
  tablesAdded,
  generatedAt,
  onDismiss,
}: GeneratedToastProps) {
  // generatedAt is the wall-clock timestamp captured by the slice when
  // the generate fulfilled. We just format it; no local Date() needed.
  const [paused, setPaused] = useState(false);
  const timeLabel = new Date(generatedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Auto-dismiss after TOAST_AUTO_DISMISS_MS, paused while hovered so the
  // user has time to read or click the link/code copy. The effect re-arms
  // when paused flips off.
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [paused, onDismiss]);

  return (
    <div
      className={styles.success}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Badge tone="success">✓</Badge>
      <span className={styles.successText}>
        Generated{" "}
        <code className={styles.mono}>{filename}</code>
        {" — "}
        {tablesAdded} table{tablesAdded === 1 ? "" : "s"} added at {timeLabel}
      </span>
      <button
        type="button"
        className={styles.successDismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// Inline summary of the most recent bulk-DDL import. Mounted with
// key={ranAt} so each new run gets a fresh aria-live announcement.
const BULK_RESULT_AUTO_DISMISS_MS = 6000;
function BulkImportResultPanel({
  result,
  onDismiss,
}: {
  result: BulkImportResult;
  onDismiss: () => void;
}) {
  const addedCount = result.added.length;
  const errorCount = result.errors.length;
  const parseErrorCount = result.parseErrors.length;
  const allBad = addedCount === 0 && (errorCount > 0 || parseErrorCount > 0);
  const hasIssues = errorCount > 0 || parseErrorCount > 0;
  // Pure success — no errors, no parse failures, at least one table
  // imported — auto-fades after a beat. Anything with issues stays put
  // until the user explicitly dismisses; those need attention.
  const isPureSuccess = addedCount > 0 && !hasIssues;
  // Hover/focus pause — same convention as GeneratedToast.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!isPureSuccess || paused) return;
    const id = window.setTimeout(onDismiss, BULK_RESULT_AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [isPureSuccess, paused, onDismiss]);

  return (
    <div
      className={`${styles.bulkResult} ${allBad ? styles.bulkResultFail : styles.bulkResultOk}`}
      role={allBad ? "alert" : "status"}
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={styles.bulkResultHead}>
        <Badge tone={allBad ? "danger" : "success"}>{allBad ? "!" : "✓"}</Badge>
        <span>
          {addedCount > 0 && (
            <>
              Imported <strong>{addedCount}</strong> table
              {addedCount === 1 ? "" : "s"}
              {hasIssues ? ". " : "."}
            </>
          )}
          {errorCount > 0 && (
            <>
              <strong>{errorCount}</strong> skipped
              {parseErrorCount > 0 ? ", " : "."}
            </>
          )}
          {parseErrorCount > 0 && (
            <>
              <strong>{parseErrorCount}</strong> couldn't parse.
            </>
          )}
        </span>
        <button
          type="button"
          className={styles.bulkResultDismiss}
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {addedCount > 0 && (
        <details
          className={styles.bulkResultDetails}
          // Auto-open when at least one imported table has parser warnings
          // so silently-dropped columns aren't hidden behind a click.
          open={result.added.some((a) => a.warnings.length > 0)}
        >
          <summary>Show imported tables ({addedCount})</summary>
          <ul className={styles.bulkResultList}>
            {result.added.map((a) => (
              <li key={a.name}>
                <code className={styles.mono}>{a.name}</code>
                <span className={styles.bulkResultMeta}>
                  {" — "}
                  {a.columnCount} column{a.columnCount === 1 ? "" : "s"}
                  {a.pkCount > 0 ? `, ${a.pkCount} PK` : ""}
                </span>
                {a.warnings.length > 0 && (
                  <ul className={styles.bulkResultAddedWarnings}>
                    {a.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasIssues && (
        <details className={styles.bulkResultDetails} open>
          <summary>Show issues ({errorCount + parseErrorCount})</summary>
          <ul className={styles.bulkResultList}>
            {result.errors.map((e, i) => (
              <li key={`err-${i}`} className={styles.bulkResultIssue}>
                <code className={styles.mono}>{e.name}</code>
                <ul>
                  {e.reasons.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
            {result.parseErrors.map((p, i) => (
              <li key={`parse-${i}`} className={styles.bulkResultIssue}>
                <code className={styles.mono}>{p.snippet || "(unnamed statement)"}</code>
                <ul>
                  <li>{p.message}</li>
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Tiny segmented-control button used in the filename-pattern picker.
function PatternButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={`${styles.patternBtn} ${active ? styles.patternBtnActive : ""}`}
    >
      {label}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// Paste DDL textarea + actions. Lives where the column grid normally
// renders, parented by the same .colsBlock so visual constraints carry.
function DdlPasteArea({
  value,
  warnings,
  disabled,
  onChange,
  onParse,
  onCancel,
}: {
  value: string;
  warnings: string[];
  disabled: boolean;
  onChange: (v: string) => void;
  onParse: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.ddlPaste}>
      <div className={styles.ddlIntro}>
        Paste a single <code>CREATE TABLE</code> statement to fill the form,
        or paste two or more semicolon-separated statements to bulk-import
        them. Common Oracle types are recognised; lines we can't parse
        become warnings.
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        disabled={disabled}
        placeholder={`CREATE TABLE CUSTOMERS (
  CUSTOMER_ID NUMBER NOT NULL,
  CUSTOMER_NAME VARCHAR2(100) NOT NULL,
  EMAIL VARCHAR2(120),
  CREATED_AT DATE NOT NULL,
  PRIMARY KEY (CUSTOMER_ID)
);`}
        spellCheck={false}
        autoComplete="off"
      />
      {warnings.length > 0 && (
        <div className={styles.ddlWarnings}>
          <strong>Couldn't parse:</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.ddlActions}>
        <Button onClick={onParse} disabled={disabled || !value.trim()}>
          Parse DDL
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// (ValidationPanel was lifted to molecules/ValidationPanel for reuse
// by MergePanel's "Validate" button.)

function FileGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

interface StagedTableItemProps {
  table: StagedTable;
  disabled: boolean;
  isEditing: boolean;
  columnCountSuffix: string;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}

function StagedTableItem({
  table,
  disabled,
  isEditing,
  columnCountSuffix,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: StagedTableItemProps) {
  return (
    <li className={`${styles.stagedCard} ${isEditing ? styles.stagedCardEditing : ""}`}>
      <div className={styles.stagedBody}>
        <div className={styles.stagedName} title={table.table_name}>
          {table.table_name}
        </div>
        <div className={styles.stagedMeta}>
          <span>{table.columns.length} {columnCountSuffix}</span>
        </div>
        {table.description && (
          <div className={styles.stagedDescription} title={table.description}>
            {table.description}
          </div>
        )}
      </div>
      <div className={styles.stagedActions}>
        <Button variant="outline" size="sm" onClick={onEdit} disabled={disabled}>
          {editLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={disabled}>
          {deleteLabel}
        </Button>
      </div>
    </li>
  );
}
