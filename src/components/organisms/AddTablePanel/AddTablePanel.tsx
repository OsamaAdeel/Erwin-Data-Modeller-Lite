import { useMemo, useState } from "react";
import { ADD_TABLE, COMMON } from "@/CONSTANTS";
import Button from "@/components/atoms/Button";
import Card from "@/components/atoms/Card";
import Input from "@/components/atoms/Input";
import Badge from "@/components/atoms/Badge";
import Field from "@/components/molecules/Field";
import FileDrop from "@/components/molecules/FileDrop";
import StatTile from "@/components/molecules/StatTile";
import { WARNING_MESSAGES } from "@/features/addTable/validation";
import { useAddTable } from "@/features/addTable/useAddTable";
import type { StagedTable } from "@/features/addTable/useAddTable";
import ColumnRow from "./ColumnRow";
import styles from "./AddTablePanel.module.scss";

export default function AddTablePanel() {
  const t = ADD_TABLE;
  const [search, setSearch] = useState("");
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
    setTableName,
    setDescription,
    addColumn,
    removeColumn,
    updateColumn,
    commitTable,
    deleteStagedTable,
    editStagedTable,
    cancelEdit,
    finalize,
    unfinalize,
    generate,
  } = useAddTable();

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

  function handleFinalize() {
    if (!canFinalize) return;
    const confirmed = window.confirm(t.sections.finalize.confirmFinalize);
    if (confirmed) finalize();
  }

  return (
    <div className={styles.wrap}>
      <Card step={1} title={t.sections.upload.heading}>
        <FileDrop
          hint={t.sections.upload.dropHint}
          subhint={t.sections.upload.dropSubhint}
          loadedName={parsed ? `${t.sections.upload.loadedPrefix} ${parsed.fileName}` : undefined}
          loadedMeta={parsed ? `${parsed.entityDict.size} entities · ${parsed.variant}` : undefined}
          error={loadError}
          loading={loading}
          onFile={(f) => void loadFile(f)}
        />
      </Card>

      {parsed && (
        <Card step={2} title={t.sections.info.heading}>
          <div className={styles.tileGrid}>
            <StatTile label={t.sections.info.entitiesLabel} value={parsed.entityDict.size} />
            <StatTile label={t.sections.info.domainsLabel} value={parsed.domainMap.size} />
            <StatTile
              label={t.sections.info.variantLabel}
              value={<span className={styles.variantValue}>{parsed.variant}</span>}
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
                  <li className={styles.entityEmpty}>No matches</li>
                )}
                {filteredEntities.map((n) => (
                  <li key={n} title={n}>{n}</li>
                ))}
              </ul>
            </div>
          </details>
        </Card>
      )}

      {parsed && (
        <Card step={3} title={t.sections.addForm.heading}>
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
              <div className={styles.colsHeader}>
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
                    onChange={(patch) => updateColumn(c.id, patch)}
                    onRemove={() => removeColumn(c.id)}
                  />
                ))}
              </div>
              <div className={styles.colsActions}>
                <Button variant="outline" size="sm" onClick={addColumn} disabled={formLocked}>
                  + Add column
                </Button>
              </div>
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
        <Card step={4} title={t.sections.staged.heading}>
          {stagedTables.length === 0 ? (
            <div className={styles.stagedEmpty}>{t.sections.staged.empty}</div>
          ) : (
            <>
              <div className={styles.stagedCount}>
                {t.sections.staged.countLabel.replace("{n}", String(stagedTables.length))}
              </div>
              <ul className={styles.stagedList}>
                {stagedTables.map((tbl) => (
                  <StagedTableItem
                    key={tbl.id}
                    table={tbl}
                    disabled={isFinalized}
                    isEditing={editingId === tbl.id}
                    columnCountSuffix={t.sections.staged.columnCountSuffix}
                    editLabel={t.sections.staged.editBtn}
                    deleteLabel={t.sections.staged.deleteBtn}
                    onEdit={() => editStagedTable(tbl.id)}
                    onDelete={() => deleteStagedTable(tbl.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {parsed && (
        <Card step={5} title={t.sections.finalize.heading}>
          <div className={styles.finalizeHead}>
            <Badge tone={isFinalized ? "success" : "warning"}>
              {isFinalized ? t.sections.finalize.finalizedLabel : t.sections.finalize.draftLabel}
            </Badge>
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
            <Button onClick={generate} disabled={!canGenerate}>
              {t.sections.finalize.generateBtn}
            </Button>
          </div>

          {!canFinalize && !isFinalized && stagedTables.length === 0 && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needStagedHint}</div>
          )}
          {!canGenerate && stagedTables.length > 0 && !isFinalized && (
            <div className={styles.finalizeHint}>{t.sections.finalize.needFinalizeHint}</div>
          )}

          {success && (
            <div className={styles.success}>
              <Badge tone="success">✓</Badge>
              <span>
                {t.messages.addSuccess}{" "}
                <code className={styles.mono}>{success.filename}</code>
                {" · "}
                {success.tablesAdded} table(s) added
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
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
