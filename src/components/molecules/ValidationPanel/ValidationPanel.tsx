// Inline panel summarising the OFSAA validator's last run. Renders as a
// banner ("0 violations — looks good") on success or a grouped, expandable
// violations list on failure. Used by both Add Tables (Step 5) and Merge
// Models (Step 3) — wherever a generated XML can be dry-run validated.

import { useMemo } from "react";
import Badge from "@/components/atoms/Badge";
import type { OfsaaValidationResult, Violation } from "@/services/xml/validator";
import styles from "./ValidationPanel.module.scss";

export interface ValidationPanelProps {
  result: OfsaaValidationResult;
  /** Optional override for the success banner copy. */
  successMessage?: string;
  className?: string;
}

export default function ValidationPanel({
  result,
  successMessage = "OFSAA validator: 0 violations — model is ready to generate.",
  className = "",
}: ValidationPanelProps) {
  const grouped = useMemo(() => {
    const out = new Map<string, Violation[]>();
    for (const v of result.violations) {
      const list = out.get(v.rule);
      if (list) list.push(v);
      else out.set(v.rule, [v]);
    }
    return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [result]);

  if (result.ok) {
    return (
      <div className={`${styles.ok} ${className}`} role="status">
        <Badge tone="success">✓</Badge>
        <span>{successMessage}</span>
      </div>
    );
  }

  return (
    // role="alert" on the wrapper triggers an SR announcement when the
    // panel mounts (i.e. right after the user clicks "Validate"). The
    // <details> still works as a normal disclosure widget — role only
    // affects ARIA, not native click behavior.
    <details className={`${styles.fail} ${className}`} open role="alert">
      <summary>
        <Badge tone="danger">!</Badge>
        <span>
          OFSAA validator: {result.violations.length} violation
          {result.violations.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className={styles.body}>
        {grouped.map(([rule, items]) => (
          <section key={rule} className={styles.group}>
            <h4 className={styles.rule}>
              {rule} <span className={styles.count}>· {items.length}</span>
            </h4>
            <ul className={styles.list}>
              {items.map((v, i) => (
                <li key={i} className={styles.item}>
                  {(v.entity || v.column || v.field) && (
                    <span className={styles.context}>
                      {[v.entity, v.column, v.field].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span>{v.message}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
