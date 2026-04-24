import type { EdgeRoute } from "@/features/erd/layout";

export interface ErdEdgeProps {
  edge: EdgeRoute;
  highlighted?: boolean;
}

export default function ErdEdge({ edge, highlighted }: ErdEdgeProps) {
  if (edge.points.length < 2) return null;

  const d = pointsToPath(edge.points);
  const stroke = highlighted ? "#2D6BFF" : "#9098A8";
  const strokeWidth = highlighted ? 2 : 1.25;
  const last = edge.points[edge.points.length - 1];
  const prev = edge.points[edge.points.length - 2];

  return (
    <g style={{ pointerEvents: "none" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      {/* arrowhead at the child (target) end */}
      <polygon
        points={arrowheadPoints(prev.x, prev.y, last.x, last.y, 8)}
        fill={stroke}
      />
    </g>
  );
}

function pointsToPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  return pts
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
}

function arrowheadPoints(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular
  const px = -uy;
  const py = ux;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  const leftX = baseX + px * (size / 2);
  const leftY = baseY + py * (size / 2);
  const rightX = baseX - px * (size / 2);
  const rightY = baseY - py * (size / 2);
  return `${x2},${y2} ${leftX},${leftY} ${rightX},${rightY}`;
}
