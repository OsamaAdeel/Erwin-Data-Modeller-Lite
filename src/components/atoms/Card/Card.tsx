import { HTMLAttributes, ReactNode, useState } from "react";
import styles from "./Card.module.scss";

export type StepState = "upcoming" | "active" | "complete";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  step?: number | string;
  /** Visual state for the step badge — "active" (default), "complete"
   *  (renders a checkmark in the green tone), or "upcoming" (muted). */
  stepState?: StepState;
  /** When true, render a chevron toggle on the header that hides the body.
   *  Useful for "completed" cards where the user is past the work but
   *  may still want to peek. State is local to the Card. */
  collapsible?: boolean;
  /** Initial collapsed state when collapsible. Defaults to false. */
  defaultCollapsed?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

const stepStateClass: Record<StepState, string> = {
  active: "",
  complete: "stepComplete",
  upcoming: "stepUpcoming",
};

export default function Card({
  title,
  subtitle,
  step,
  stepState = "active",
  collapsible = false,
  defaultCollapsed = false,
  actions,
  className,
  children,
  ...rest
}: CardProps) {
  const stateCls = stepStateClass[stepState];
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const showBody = !collapsible || !collapsed;

  return (
    <section className={`${styles.card} ${className ?? ""}`} {...rest}>
      {(title || step) && (
        <header className={styles.head}>
          {step != null && (
            <div
              className={`${styles.step} ${stateCls ? styles[stateCls] : ""}`}
              aria-label={
                stepState === "complete"
                  ? `Step ${step} complete`
                  : `Step ${step}`
              }
            >
              {stepState === "complete" ? <CheckGlyph /> : step}
            </div>
          )}
          <div className={styles.titleWrap}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
          {collapsible && (
            <button
              type="button"
              className={`${styles.collapseToggle} ${collapsed ? styles.collapseToggleCollapsed : ""}`}
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand section" : "Collapse section"}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <ChevronGlyph />
            </button>
          )}
        </header>
      )}
      {showBody && <div className={styles.body}>{children}</div>}
    </section>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronGlyph() {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
