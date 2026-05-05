import Badge from "@/components/atoms/Badge";
import type { ModelEntity } from "@/services/xml/model";
import styles from "./EntityPropertiesCard.module.scss";

export interface EntityPropertiesCardProps {
  entity: ModelEntity;
  onClose?: () => void;
}

export default function EntityPropertiesCard({
  entity,
  onClose,
}: EntityPropertiesCardProps) {
  const colCount = entity.columns.length;

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

      {colCount === 0 ? (
        <p className={styles.empty}>This table has no columns.</p>
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
              {entity.columns.map((c) => {
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

// "false" → No; "true" or any other non-null value → Yes; null → unknown.
// Mirrors the convention used by the ERD inspector so behavior stays
// consistent across the app.
function formatNullable(raw: string | null): string {
  if (raw == null) return "—";
  return raw.toLowerCase() === "false" ? "No" : "Yes";
}
