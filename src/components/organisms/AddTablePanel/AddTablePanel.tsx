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
import ColumnRow from "./ColumnRow";
import styles from "./AddTablePanel.module.scss";

export default function AddTablePanel() {
  const t = ADD_TABLE;
  const [search, setSearch] = useState("");
  const {
    parsed,
    loadError,
    tableName,
    columns,
    success,
    validation,
    loadFile,
    setTableName,
    addColumn,
    removeColumn,
    updateColumn,
    generate,
    resetForm,
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

  return (
    <div className={styles.wrap}>
      <Card step={1} title={t.sections.upload.heading}>
        <FileDrop
          hint={t.sections.upload.dropHint}
          subhint={t.sections.upload.dropSubhint}
          loadedName={parsed ? `${t.sections.upload.loadedPrefix} ${parsed.fileName}` : undefined}
          loadedMeta={parsed ? `${parsed.entityDict.size} entities · ${parsed.variant}` : undefined}
          error={loadError}
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
              invalid={!!validation.tableNameError}
              onChange={(e) => setTableName(e.target.value)}
            />
          </Field>

          <div className={`${styles.colsBlock} ${!validation.tableNameValid ? styles.locked : ""}`}>
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
              <Button variant="outline" size="sm" onClick={addColumn}>
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
            <Button onClick={generate} disabled={!validation.canSubmit}>
              {t.sections.addForm.submit}
            </Button>
            {success && (
              <Button variant="ghost" onClick={resetForm}>
                {COMMON.buttons.addAnother}
              </Button>
            )}
          </div>

          {success && (
            <div className={styles.success}>
              <Badge tone="success">✓</Badge>
              <span>
                {t.messages.addSuccess}{" "}
                <code className={styles.mono}>{success.filename}</code>
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
