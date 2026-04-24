import { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.scss";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  step?: number | string;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function Card({
  title,
  subtitle,
  step,
  actions,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section className={`${styles.card} ${className ?? ""}`} {...rest}>
      {(title || step) && (
        <header className={styles.head}>
          {step != null && <div className={styles.step}>{step}</div>}
          <div className={styles.titleWrap}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
