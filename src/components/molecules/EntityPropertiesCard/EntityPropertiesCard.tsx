import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/atoms/Badge";
import Input from "@/components/atoms/Input";
import type { ModelColumn, ModelEntity } from "@/services/xml/model";
import styles from "./EntityPropertiesCard.module.scss";

// Below this column count the search input is hidden — eyeballing the
// list is faster than typing for short tables.
const SEARCH_THRESHOLD = 8;

export interface EntityPropertiesCardProps {
  entity: ModelEntity;
  onClose?: () => void;
}

export default function EntityPropertiesCard({
  entity,
  onClose,
}: EntityPropertiesCardProps) {
  const colCount = entity.columns.length;
  const [search, setSearch] = useState("");

  // Reset the column filter when the user switches entities so the new
  // table isn't hidden behind a stale query.
  useEffect(() => {
    setSearch("");
  }, [entity.id]);

  const visibleColumns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entity.columns;
    return entity.columns.filter((c) => matchesQuery(c, q));
  }, [entity.columns, search]);

  const showSearch = colCount > SEARCH_THRESHOLD;

  return (
    <section
      className={styles.card}
      role="region"
      aria-label={`Properties of ${entity.name}`}
    >
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span className={styles.eyebrow}>Table</span>
          <span className={styles.title}>{entity.name}</span>
          <span className={styles.count}>
            {colCount} column{colCount === 1 ? "" : "s"}
            {entity.pkNames.length > 0 && (
              <>
                {" · PK: "}
                <code className={styles.mono}>{entity.pkNames.join(", ")}</code>
              </>
            )}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close properties"
            title="Close"
          >
            ×
          </button>
        )}
      </header>

      {showSearch && (
        <div className={styles.searchRow}>
          <Input
            type="search"
            placeholder="Filter columns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                e.preventDefault();
                setSearch("");
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Filter columns"
          />
          {search && (
            <span className={styles.searchCount} aria-live="polite">
              {visibleColumns.length} of {colCount}
            </span>
          )}
        </div>
      )}

      {colCount === 0 ? (
        <p className={styles.empty}>This table has no columns.</p>
      ) : visibleColumns.length === 0 ? (
        <p className={styles.empty}>No columns match &ldquo;{search}&rdquo;.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Data type</th>
                <th scope="col">Nullable</th>
                <th scope="col">PK</th>
                <th scope="col">FK</th>
              </tr>
            </thead>
            <tbody>
              {visibleColumns.map((c) => {
                const dataType = c.physicalDataType ?? c.domainName ?? "—";
                const nullableLabel = formatNullable(c.nullable);
                return (
                  <tr key={c.id} className={c.isPk ? styles.pkRow : undefined}>
                    <th scope="row" className={styles.colName}>
                      {c.name}
                    </th>
                    <td>
                      <code className={styles.mono}>{dataType}</code>
                    </td>
                    <td>{nullableLabel}</td>
                    <td>
                      {c.isPk ? <Badge tone="primary">Yes</Badge> : "No"}
                    </td>
                    {/* FK info isn't surfaced by the model parser used here
                        (it lives in relationships, only loaded by ERD). */}
                    <td className={styles.muted}>—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Match against the column's name, physical data type, or domain name —
// whichever the user types about. Case-insensitive substring match.
function matchesQuery(c: ModelColumn, q: string): boolean {
  if (c.name.toLowerCase().includes(q)) return true;
  if (c.physicalDataType?.toLowerCase().includes(q)) return true;
  if (c.domainName?.toLowerCase().includes(q)) return true;
  return false;
}

// "false" → No; "true" or any other non-null value → Yes; null → unknown.
// Mirrors the convention used by the ERD inspector so behavior stays
// consistent across the app.
function formatNullable(raw: string | null): string {
  if (raw == null) return "—";
  return raw.toLowerCase() === "false" ? "No" : "Yes";
}
