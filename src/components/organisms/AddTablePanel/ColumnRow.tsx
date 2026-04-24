import { ChangeEvent } from "react";
import { DATA_TYPES, MAX_IDENTIFIER_LEN, TYPE_LIMITS } from "@/services/ddl/oracleParser";
import type { DataType, NewColumnSpec } from "@/services/xml/types";
import Input from "@/components/atoms/Input";
import styles from "./ColumnRow.module.scss";

export interface ColumnRowProps {
  column: NewColumnSpec;
  error?: { message: string; isNameError: boolean };
  isOnly: boolean;
  onChange: (patch: Partial<NewColumnSpec>) => void;
  onRemove: () => void;
}

export default function ColumnRow({ column, error, isOnly, onChange, onRemove }: ColumnRowProps) {
  const limits = TYPE_LIMITS[column.type] ?? {};

  const handleType = (e: ChangeEvent<HTMLSelectElement>) =>
    onChange({ type: e.target.value as DataType });

  return (
    <>
      <div className={styles.row}>
        <Input
          placeholder="COLUMN_NAME"
          spellCheck={false}
          autoComplete="off"
          maxLength={MAX_IDENTIFIER_LEN}
          value={column.name}
          invalid={error?.isNameError ?? false}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <select className={styles.select} value={column.type} onChange={handleType}>
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className={styles.sizeCell}>
          {(column.type === "VARCHAR2" || column.type === "CHAR") && (
            <Input
              type="number"
              placeholder="length"
              min={1}
              max={limits.maxLen}
              value={column.size}
              onChange={(e) => onChange({ size: e.target.value })}
            />
          )}
          {column.type === "NUMBER" && (
            <div className={styles.numberPair}>
              <Input
                type="number"
                placeholder="prec"
                min={1}
                max={38}
                value={column.size}
                onChange={(e) => onChange({ size: e.target.value })}
              />
              <Input
                type="number"
                placeholder="scale"
                min={-84}
                max={127}
                value={column.scale}
                onChange={(e) => onChange({ scale: e.target.value })}
              />
            </div>
          )}
        </div>
        <label className={styles.checkCell} title="Nullable">
          <input
            type="checkbox"
            checked={column.nullable}
            disabled={column.pk}
            onChange={(e) => onChange({ nullable: e.target.checked })}
          />
        </label>
        <label className={styles.checkCell} title="Primary key">
          <input
            type="checkbox"
            checked={column.pk}
            onChange={(e) => onChange({ pk: e.target.checked })}
          />
        </label>
        <button
          type="button"
          className={styles.removeBtn}
          disabled={isOnly}
          title="Remove column"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {error && <div className={styles.error}>{error.message}</div>}
    </>
  );
}
