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
import type { StagedTable } from "@/features/addTable/useAddTable";
import { collectFullModel } from "@/services/xml/model";
import { generateNextFileName } from "@/services/xml/serialize";
import { parseOracleDdl } from "@/services/ddl/ddlParser";
import { getParsedDoc } from "@/store/refs";
import ColumnRow from "./ColumnRow";
import styles from "./AddTablePanel.module.scss";

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
  // Step 2 entity browser — name of the entity whose property card is open,
  // or null when nothing is selected. Cleared on file change (parseId effect
  // below).
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);
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
    success,
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
    finalize,
    unfinalize,
    generate,
    previewXml,
    validateModel,
    validationResult,
    validating,
    replaceColumns,
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

  // Auto-collapse Step 1 the first time a file lands. Re-fires on every
  // new parseId so loading a different file collapses again.
  useEffect(() => {
    if (parsed?.parseId) setShowUploaders(false);
  }, [parsed?.parseId]);

  // Drop the Step-2 selection when a different file is loaded — names from
  // the prior model would no longer resolve.
  useEffect(() => {
    setSelectedEntityName(null);
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

  const formLocked = isFinalized;

  const nextFileName = useMemo(
    () => (parsed ? generateNextFileName(parsed.fileName) : ""),
    [parsed]
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
  const step5State = success
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
            <Button variant="ghost" size="sm" onClick={() => setShowUploaders(true)}>
              Change file
            </Button>
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
        <Card step={2} stepState={step2State} title={t.sections.info.heading}>
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
              <ul className={styles.entityNames}>
                {filteredEntities.length === 0 && (
                  <li className={styles.entityEmpty}>
                    {parsed.entityDict.size === 0
                      ? "No tables in this model."
                      : "No tables found."}
                  </li>
                )}
                {filteredEntities.map((n) => {
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

            <div className={`${styles.colsBlock} ${!validation.tableNameValid ? styles.colsLocked : ""}`}>
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
                    const result = parseOracleDdl(ddlText);
                    if (result.columns.length === 0) {
                      setDdlWarnings([
                        "No columns parsed from this DDL.",
                        ...result.warnings,
                      ]);
                      return;
                    }
                    if (result.tableName && !tableName.trim()) {
                      setTableName(result.tableName);
                    }
                    replaceColumns(result.columns);
                    setDdlMode(false);
                    setDdlText("");
                    setDdlWarnings(result.warnings);
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
              {editingId && (
                <Button variant="ghost" onClick={cancelEdit}>
                  {COMMON.buttons.cancel}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {parsed && (
        <Card step={4} stepState={step4State} title={t.sections.staged.heading}>
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
              {t.sections.finalize.nextFilePreview}{" "}
              <code className={styles.mono}>{nextFileName}</code>
            </div>
          )}

          {!canFinalize && !isFinalized && stagedTables.length === 0 && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needStagedHint}</div>
          )}
          {!canGenerate && stagedTables.length > 0 && !isFinalized && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needFinalizeHint}</div>
          )}

          {success && (
            <GeneratedToast
              key={success.filename}
              filename={success.filename}
              tablesAdded={success.tablesAdded}
            />
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
    </div>
  );
}

interface GeneratedToastProps {
  filename: string;
  tablesAdded: number;
}

function GeneratedToast({ filename, tablesAdded }: GeneratedToastProps) {
  // Capture the wall-clock time the user actually clicked Generate so the
  // toast says "generated at 4:42 PM" rather than recomputing on rerender.
  // The parent remounts this component (via key=filename) on each new
  // generate, so this initializer runs exactly when we want it to.
  const [generatedAt] = useState(() => new Date());
  const [dismissed, setDismissed] = useState(false);
  const timeLabel = generatedAt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (dismissed) return null;
  return (
    <div className={styles.success} role="status" aria-live="polite">
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
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
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
        Paste a <code>CREATE TABLE</code> statement (or just the column
        list). Common Oracle types are recognised; lines we can't parse
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
