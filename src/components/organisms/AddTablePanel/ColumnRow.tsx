import { DragEvent, KeyboardEvent as ReactKeyboardEvent, useMemo, useRef, useState } from "react";
import { DATA_TYPES, MAX_IDENTIFIER_LEN, TYPE_LIMITS } from "@/services/ddl/oracleParser";
import type { DataType, NewColumnSpec } from "@/services/xml/types";
import Input from "@/components/atoms/Input";
import Select, { type SelectOption } from "@/components/atoms/Select";
import styles from "./ColumnRow.module.scss";

const DRAG_MIME = "application/x-erwin-column-id";

export interface ColumnRowProps {
  column: NewColumnSpec;
  error?: { message: string; isNameError: boolean };
  isOnly: boolean;
  /** Disable all interactions (e.g. when the model is finalized). */
  locked?: boolean;
  /** Sibling ids in render order. Used by the keyboard reorder handler on
   *  the drag handle so Up/Down can move this row even without a mouse. */
  siblingIds?: string[];
  onChange: (patch: Partial<NewColumnSpec>) => void;
  onRemove: () => void;
  onReorder?: (fromId: string, toId: string, before: boolean) => void;
}

export default function ColumnRow({
  column,
  error,
  isOnly,
  locked = false,
  siblingIds,
  onChange,
  onRemove,
  onReorder,
}: ColumnRowProps) {
  const limits = TYPE_LIMITS[column.type] ?? {};
  const typeOptions = useMemo<SelectOption[]>(
    () => DATA_TYPES.map((t) => ({ value: t, label: t })),
    []
  );
  const rowRef = useRef<HTMLDivElement>(null);
  // "above" / "below" indicates which half of THIS row is currently
  // being hovered during a drag — drives the drop-indicator border.
  const [dragOver, setDragOver] = useState<"above" | "below" | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleType = (next: string) => onChange({ type: next as DataType });

  function handleDragStart(e: DragEvent<HTMLElement>) {
    if (locked || !onReorder) return;
    e.dataTransfer.setData(DRAG_MIME, column.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  function handleDragEnd() {
    setDragging(false);
    setDragOver(null);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (locked || !onReorder) return;
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const half: "above" | "below" =
      e.clientY - rect.top < rect.height / 2 ? "above" : "below";
    setDragOver((prev) => (prev === half ? prev : half));
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (locked || !onReorder) return;
    e.preventDefault();
    const fromId = e.dataTransfer.getData(DRAG_MIME);
    setDragOver(null);
    if (!fromId || fromId === column.id) return;
    onReorder(fromId, column.id, dragOver === "above");
  }

  // Up/Down on the drag handle reorders by one slot. Without this, keyboard
  // users (no pointer device) couldn't reorder columns at all — the rest of
  // the row only handles native drag events.
  function handleHandleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (locked || !onReorder || !siblingIds || siblingIds.length < 2) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const idx = siblingIds.indexOf(column.id);
    if (idx < 0) return;
    const targetIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblingIds.length) return;
    e.preventDefault();
    const targetId = siblingIds[targetIdx];
    onReorder(column.id, targetId, e.key === "ArrowUp");
  }

  return (
    <>
      <div
        ref={rowRef}
        className={`${styles.row} ${dragging ? styles.dragging : ""} ${
          dragOver === "above" ? styles.dropAbove : ""
        } ${dragOver === "below" ? styles.dropBelow : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Reorder column (drag, or Up/Down arrow)"
          title="Drag, or Up/Down arrow, to reorder"
          draggable={!locked && !!onReorder}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onKeyDown={handleHandleKeyDown}
          disabled={locked}
        >
          <DragGlyph />
        </button>
        <Input
          kind="code"
          placeholder="COLUMN_NAME"
          spellCheck={false}
          autoComplete="off"
          maxLength={MAX_IDENTIFIER_LEN}
          value={column.name}
          invalid={error?.isNameError ?? false}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Select
          options={typeOptions}
          value={column.type}
          onChange={handleType}
          disabled={locked}
          aria-label="Column type"
        />
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
            aria-label="Nullable"
            onChange={(e) => onChange({ nullable: e.target.checked })}
          />
        </label>
        <label className={styles.checkCell} title="Primary key">
          <input
            type="checkbox"
            checked={column.pk}
            aria-label="Primary key"
            onChange={(e) => onChange({ pk: e.target.checked })}
          />
        </label>
        <button
          type="button"
          className={styles.removeBtn}
          disabled={isOnly}
          aria-label="Remove column"
          title="Remove column"
          onClick={onRemove}
        >
          <RemoveGlyph />
        </button>
      </div>
      {error && <div className={styles.error}>{error.message}</div>}
    </>
  );
}

function DragGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <circle cx="5" cy="3" r="1.2" />
      <circle cx="5" cy="7" r="1.2" />
      <circle cx="5" cy="11" r="1.2" />
      <circle cx="9" cy="3" r="1.2" />
      <circle cx="9" cy="7" r="1.2" />
      <circle cx="9" cy="11" r="1.2" />
    </svg>
  );
}

function RemoveGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
