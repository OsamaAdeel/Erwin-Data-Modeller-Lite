import type { ModelEntity } from "@/services/xml/model";
import type { NodePosition } from "@/features/erd/layout";
import styles from "./ErdEntity.module.scss";

const HEADER_H = 32;
const ROW_H = 18;
const PADDING_Y = 8;
const MAX_VISIBLE_COLS = 14;

export interface ErdEntityProps {
  entity: ModelEntity;
  position: NodePosition;
  highlighted?: boolean;
  /** Search-search match: outline the card in the primary colour. */
  isMatched?: boolean;
  /** Search non-match: render translucent + desaturated. */
  isDimmed?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function ErdEntity({
  entity,
  position,
  highlighted,
  isMatched,
  isDimmed,
  onMouseEnter,
  onMouseLeave,
}: ErdEntityProps) {
  const { x, y, width, height } = position;
  const visibleCols = entity.columns.slice(0, MAX_VISIBLE_COLS);
  const overflow = entity.columns.length - visibleCols.length;

  // Hover-highlight wins visually over search-match (both use the primary
  // colour but hover gets a thicker stroke to read like a focus state).
  const showOutline = highlighted || isMatched;
  const outlineWidth = highlighted ? 2 : isMatched ? 1.5 : 1;
  const outlineColor = showOutline ? "var(--color-primary)" : "var(--color-border-2)";

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={isDimmed ? styles.dim : ""}
      style={{ cursor: "default" }}
    >
      {/* card body */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={8}
        ry={8}
        fill="var(--color-surface)"
        stroke={outlineColor}
        strokeWidth={outlineWidth}
      />
      {/* header — navy stays navy in both themes (matches the brand mark) */}
      <rect
        x={0}
        y={0}
        width={width}
        height={HEADER_H}
        fill="var(--color-navy)"
      />
      <rect x={0} y={0} width={width} height={HEADER_H} rx={8} ry={8} fill="var(--color-navy)" />
      <text
        x={12}
        y={HEADER_H / 2 + 4}
        fill="#FFFFFF"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={13}
        fontWeight={600}
      >
        {truncate(entity.name, 26)}
      </text>

      {/* column rows */}
      {visibleCols.map((c, i) => {
        const ry = HEADER_H + PADDING_Y + i * ROW_H;
        return (
          <g key={c.id}>
            <text
              x={12}
              y={ry + ROW_H - 5}
              fontFamily="ui-monospace, Menlo, Consolas, monospace"
              fontSize={11}
              fill="var(--color-text)"
            >
              {c.isPk ? "🔑 " : ""}{truncate(c.name, 20)}
            </text>
            {c.physicalDataType && (
              <text
                x={width - 12}
                y={ry + ROW_H - 5}
                textAnchor="end"
                fontFamily="ui-monospace, Menlo, Consolas, monospace"
                fontSize={10}
                fill="var(--color-text-muted)"
              >
                {truncate(c.physicalDataType, 12)}
              </text>
            )}
          </g>
        );
      })}

      {overflow > 0 && (
        <text
          x={width / 2}
          y={height - 6}
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize={10}
          fill="var(--color-text-muted)"
          fontStyle="italic"
        >
          +{overflow} more column{overflow === 1 ? "" : "s"}
        </text>
      )}
    </g>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
