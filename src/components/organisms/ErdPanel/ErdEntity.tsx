import type { ModelEntity } from "@/services/xml/model";
import type { NodePosition } from "@/features/erd/layout";

const HEADER_H = 32;
const ROW_H = 18;
const PADDING_Y = 8;
const MAX_VISIBLE_COLS = 14;

export interface ErdEntityProps {
  entity: ModelEntity;
  position: NodePosition;
  highlighted?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function ErdEntity({
  entity,
  position,
  highlighted,
  onMouseEnter,
  onMouseLeave,
}: ErdEntityProps) {
  const { x, y, width, height } = position;
  const visibleCols = entity.columns.slice(0, MAX_VISIBLE_COLS);
  const overflow = entity.columns.length - visibleCols.length;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
        fill="#FFFFFF"
        stroke={highlighted ? "#2D6BFF" : "#CFD6E2"}
        strokeWidth={highlighted ? 2 : 1}
      />
      {/* header */}
      <rect
        x={0}
        y={0}
        width={width}
        height={HEADER_H}
        fill="#0A0E27"
      />
      <rect x={0} y={0} width={width} height={HEADER_H} rx={8} ry={8} fill="#0A0E27" />
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
              fill="#1B2133"
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
                fill="#6B7487"
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
          fill="#6B7487"
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
