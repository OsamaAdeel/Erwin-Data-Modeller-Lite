import { ReactNode } from "react";
import styles from "./TabBar.module.scss";

export interface TabItem<TKey extends string> {
  key: TKey;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabBarProps<TKey extends string> {
  tabs: ReadonlyArray<TabItem<TKey>>;
  active: TKey;
  onChange: (key: TKey) => void;
}

export default function TabBar<TKey extends string>({
  tabs,
  active,
  onChange,
}: TabBarProps<TKey>) {
  return (
    <div className={styles.bar} role="tablist">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            onClick={() => !t.disabled && onChange(t.key)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
