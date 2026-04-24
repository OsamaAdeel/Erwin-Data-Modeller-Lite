import { useMemo } from "react";
import { COMMON, MERGE } from "@/CONSTANTS";
import Button from "@/components/atoms/Button";
import Card from "@/components/atoms/Card";
import Badge from "@/components/atoms/Badge";
import FileDrop from "@/components/molecules/FileDrop";
import StatTile from "@/components/molecules/StatTile";
import { useMerge } from "@/features/merge/useMerge";
import type { Conflict } from "@/services/xml/merge/types";
import styles from "./MergePanel.module.scss";

export default function MergePanel() {
  const t = MERGE.sections;
  const m = useMerge();

  const noop =
    !!m.plan &&
    m.plan.tablesMissing.length === 0 &&
    m.plan.columnsMissing.length === 0 &&
    m.plan.conflicts.length === 0;

  // Group rows for display
  const pending = m.rows.filter((r) => r.side === "pending");
  const staged = m.rows.filter((r) => r.side === "staged");

  const tablesByName = useMemo(() => {
    const out = new Map<string, ReturnType<typeof useMerge>["plan"] extends infer P
      ? P extends { tablesMissing: infer T }
        ? T extends Array<infer U>
          ? U
          : never
        : never
      : never>();
    if (m.plan) {
      for (const t of m.plan.tablesMissing) out.set(t.name.toUpperCase(), t);
    }
    return out;
  }, [m.plan]);

  const colsByKey = useMemo(() => {
    const out = new Map<string, (typeof m.plan extends infer P
      ? P extends { columnsMissing: infer C }
        ? C extends Array<infer U>
          ? U
          : never
        : never
      : never)>();
    if (m.plan) {
      for (const c of m.plan.columnsMissing) {
        out.set(`${c.table.toUpperCase()}::${c.column.name.toUpperCase()}`, c);
      }
    }
    return out;
  }, [m.plan]);

  return (
    <div className={styles.wrap}>
      {/* ---------- Step 1: Load ---------- */}
      <Card step={1} title={t.load.heading}>
        <div className={styles.dropGrid}>
          <SlotDrop
            role="source"
            label={t.load.sourceRole}
            sub={t.load.sourceSub}
            slot={m.source}
            error={m.errors.source}
            loading={m.loading.source}
            onFile={(f) => void m.loadSlot("source", f)}
          />
          <SlotDrop
            role="target"
            label={t.load.targetRole}
            sub={t.load.targetSub}
            slot={m.target}
            error={m.errors.target}
            loading={m.loading.target}
            onFile={(f) => void m.loadSlot("target", f)}
          />
        </div>
        <div className={styles.actionsRow}>
          <Button onClick={m.compute} disabled={!m.canCompute}>
            {t.load.computeBtn}
          </Button>
          <span className="muted">
            {m.canCompute
              ? `${m.source!.filename} → ${m.target!.filename}`
              : t.load.computeHint}
          </span>
          {(m.source || m.target) && (
            <Button variant="ghost" size="sm" onClick={m.reset}>
              {COMMON.buttons.reset}
            </Button>
          )}
        </div>
      </Card>

      {/* ---------- Step 2: Pick ---------- */}
      {m.plan && (
        <Card step={2} title={t.plan.heading}>
          {noop && <div className={styles.noop}>{t.plan.noopBanner}</div>}

          {!noop && (
            <>
              <div className={styles.tileGrid}>
                <StatTile label={t.plan.tilesMissingTables} value={m.plan.tablesMissing.length} />
                <StatTile label={t.plan.tilesMissingCols} value={m.plan.columnsMissing.length} />
                <StatTile
                  label={t.plan.tilesConflicts}
                  value={m.plan.conflicts.length}
                  tone="warning"
                />
              </div>

              <div className={styles.pickerGrid}>
                {/* Pending pane */}
                <div className={styles.pane}>
                  <div className={styles.paneHead}>
                    <h3>{t.plan.pendingHeading}</h3>
                    <span className={styles.paneCounts}>
                      {`${m.counts.pendingTables} table${m.counts.pendingTables === 1 ? "" : "s"}, ${m.counts.pendingColumns} column${m.counts.pendingColumns === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className={styles.paneBody}>
                    {pending.length === 0 ? (
                      <div className={styles.empty}>{t.plan.pendingEmpty}</div>
                    ) : (
                      pending.map((r) => {
                        if (r.kind === "table") {
                          const data = tablesByName.get(r.tableUpper);
                          return data ? (
                            <TableRow
                              key={r.id}
                              name={data.name}
                              columnCount={data.columnCount}
                              pk={data.pk}
                              columns={data.columns}
                              direction="right"
                              onMove={() => m.moveRow(r.id, "staged")}
                            />
                          ) : null;
                        }
                        const c = colsByKey.get(`${r.tableUpper}::${r.columnUpper}`);
                        return c ? (
                          <ColumnRow
                            key={r.id}
                            table={c.table}
                            column={c.column.name}
                            type={c.column.physicalDataType}
                            domain={c.column.domainName}
                            isPk={c.column.isPk}
                            direction="right"
                            onMove={() => m.moveRow(r.id, "staged")}
                          />
                        ) : null;
                      })
                    )}
                  </div>
                  <div className={styles.paneActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => m.moveAll("pending", "staged")}
                      disabled={pending.length === 0}
                    >
                      {t.plan.moveAllRight}
                    </Button>
                  </div>
                </div>

                {/* Staged pane */}
                <div className={styles.pane}>
                  <div className={styles.paneHead}>
                    <h3>{t.plan.stagedHeading}</h3>
                    <span className={styles.paneCounts}>
                      {`${m.counts.stagedTables} table${m.counts.stagedTables === 1 ? "" : "s"}, ${m.counts.stagedColumns} column${m.counts.stagedColumns === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className={styles.paneBody}>
                    {staged.length === 0 ? (
                      <div className={styles.empty}>{t.plan.stagedEmpty}</div>
                    ) : (
                      staged.map((r) => {
                        if (r.kind === "table") {
                          const data = tablesByName.get(r.tableUpper);
                          return data ? (
                            <TableRow
                              key={r.id}
                              name={data.name}
                              columnCount={data.columnCount}
                              pk={data.pk}
                              columns={data.columns}
                              direction="left"
                              onMove={() => m.moveRow(r.id, "pending")}
                            />
                          ) : null;
                        }
                        const c = colsByKey.get(`${r.tableUpper}::${r.columnUpper}`);
                        return c ? (
                          <ColumnRow
                            key={r.id}
                            table={c.table}
                            column={c.column.name}
                            type={c.column.physicalDataType}
                            domain={c.column.domainName}
                            isPk={c.column.isPk}
                            direction="left"
                            onMove={() => m.moveRow(r.id, "pending")}
                          />
                        ) : null;
                      })
                    )}
                  </div>
                  <div className={styles.paneActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => m.moveAll("staged", "pending")}
                      disabled={staged.length === 0}
                    >
                      {t.plan.moveAllLeft}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Conflicts */}
              {m.plan.conflicts.length > 0 && (
                <details className={styles.conflicts}>
                  <summary>{t.plan.showConflicts} · {m.plan.conflicts.length}</summary>
                  <div className={styles.conflictsBody}>
                    {m.plan.conflicts.map((c, i) => (
                      <ConflictView key={i} conflict={c} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          <div className={styles.actionsRow}>
            <Button onClick={m.execute} disabled={!m.canExecute}>
              {t.plan.execute}
            </Button>
            {m.errors.general && <span className={styles.error}>{m.errors.general}</span>}
          </div>
        </Card>
      )}

      {/* ---------- Step 3: Result ---------- */}
      {m.result && (
        <Card step={3} title={t.result.heading}>
          <div className={styles.success}>
            <Badge tone="success">✓</Badge>
            <span>{t.result.addedTables.replace("{n}", String(m.result.counts.tablesAdded))}</span>
          </div>
          <div className={styles.success}>
            <Badge tone="success">✓</Badge>
            <span>{t.result.addedColumns.replace("{n}", String(m.result.counts.columnsAdded))}</span>
          </div>
          {m.result.counts.unresolved > 0 && (
            <div className={styles.warn}>
              <Badge tone="warning">!</Badge>
              <span>{t.result.unresolved.replace("{n}", String(m.result.counts.unresolved))}</span>
            </div>
          )}
          <div className={styles.actionsRow}>
            <Button onClick={m.downloadXml}>{t.result.downloadXml}</Button>
            <Button variant="outline" onClick={m.downloadReport}>{t.result.downloadReport}</Button>
            <Button variant="ghost" onClick={m.reset}>{t.result.another}</Button>
          </div>
          <details className={styles.log}>
            <summary>Actions &amp; warnings</summary>
            <pre>{m.result.reportText}</pre>
          </details>
        </Card>
      )}
    </div>
  );
}

/* ---------- inline subcomponents ---------- */

interface SlotDropProps {
  role: "source" | "target";
  label: string;
  sub: string;
  slot: { filename: string; model: { entities: unknown[]; domainIdToName: Map<string, string> } } | null;
  error?: string;
  loading?: boolean;
  onFile: (file: File) => void;
}
function SlotDrop({ role, label, sub, slot, error, loading, onFile }: SlotDropProps) {
  return (
    <div className={styles.slot}>
      <div className={styles.slotRole}>{label}</div>
      <div className={styles.slotSub}>{sub}</div>
      <FileDrop
        hint={`Drop ${role} XML or click to browse`}
        loadedName={slot?.filename}
        loadedMeta={slot ? `${slot.model.entities.length} entities · ${slot.model.domainIdToName.size} domains` : undefined}
        error={error}
        loading={loading}
        onFile={onFile}
      />
    </div>
  );
}

interface TableRowProps {
  name: string;
  columnCount: number;
  pk: string[];
  columns: Array<{ name: string; physicalDataType: string | null; isPk: boolean }>;
  direction: "left" | "right";
  onMove: () => void;
}
function TableRow({ name, columnCount, pk, columns, direction, onMove }: TableRowProps) {
  return (
    <div className={`${styles.row} ${styles.rowTable}`}>
      <div className={styles.rowHead}>
        <span className={styles.rowIcon}>▸</span>
        <span className={styles.rowTitle}>{name}</span>
        <button
          type="button"
          className={styles.moveBtn}
          onClick={onMove}
          title={direction === "right" ? "Move to target" : "Move back"}
          aria-label={direction === "right" ? "Move to target" : "Move back"}
        >
          {direction === "right" ? "→" : "←"}
        </button>
      </div>
      <div className={styles.rowSub}>
        {columnCount} col{columnCount === 1 ? "" : "s"}
        {pk.length ? `, PK: ${pk.join(", ")}` : ""}
      </div>
      <div className={styles.rowNested}>
        {columns.map((c) => (
          <div key={c.name} className={styles.rowNestedCol} title="Carried with parent table">
            ├ {c.name}{c.physicalDataType ? ` — ${c.physicalDataType}` : ""}{c.isPk ? " (PK)" : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ColumnRowProps {
  table: string;
  column: string;
  type: string | null;
  domain: string | null;
  isPk: boolean;
  direction: "left" | "right";
  onMove: () => void;
}
function ColumnRow({ table, column, type, domain, isPk, direction, onMove }: ColumnRowProps) {
  return (
    <div className={`${styles.row} ${styles.rowColumn}`}>
      <div className={styles.rowHead}>
        <span className={`${styles.rowIcon} ${styles.rowIconCol}`}>+</span>
        <span className={styles.rowTitle}>
          {column} {isPk && <Badge tone="primary">PK</Badge>}
        </span>
        <button
          type="button"
          className={styles.moveBtn}
          onClick={onMove}
          title={direction === "right" ? "Move to target" : "Move back"}
        >
          {direction === "right" ? "→" : "←"}
        </button>
      </div>
      <div className={styles.rowSub}>
        on <code>{table}</code>
        {type ? ` · ${type}` : ""}
        {domain ? ` · domain: ${domain}` : ""}
      </div>
    </div>
  );
}

function ConflictView({ conflict }: { conflict: Conflict }) {
  let label = "";
  if (conflict.kind === "column_diff") label = `${conflict.table}.${conflict.column} — column differs`;
  else if (conflict.kind === "table_case_mismatch")
    label = `Table name case differs: source "${conflict.sourceName}" vs target "${conflict.targetName}"`;
  else label = `${conflict.table}.${conflict.column} — domain "${conflict.domainName}" missing in target`;

  return (
    <div className={styles.conflictRow}>
      <div className={styles.conflictLabel}>{label}</div>
      {conflict.kind === "column_diff" && (
        <pre className={styles.conflictDiffs}>{JSON.stringify(conflict.diffs, null, 2)}</pre>
      )}
    </div>
  );
}
