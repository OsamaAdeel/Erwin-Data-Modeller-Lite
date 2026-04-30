// In-viewport minimap. Renders a scaled silhouette of every entity and the
// current viewport rectangle; click to centre the main view on a point,
// drag the viewport rectangle to pan in real time.
//
// All maths happens in three coordinate spaces:
//   - world: the dagre-laid-out entity coordinates (0..contentWidth × 0..contentHeight)
//   - viewport: the pixel space of the visible diagram (0..viewportWidth × 0..viewportHeight)
//   - minimap: the local SVG of this component (0..MM_WIDTH × 0..MM_HEIGHT)
//
// The main viewport's transform is `translate(tx, ty) scale(zoom)` so:
//   visibleWorldTopLeft = (-tx / zoom, -ty / zoom)
//   visibleWorldSize    = (viewportWidth / zoom, viewportHeight / zoom)

import { PointerEvent as ReactPointerEvent, useRef } from "react";
import type { NodePosition } from "@/features/erd/layout";
import styles from "./MiniMap.module.scss";

export interface MiniMapProps {
  entities: NodePosition[];
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  tx: number;
  ty: number;
  zoom: number;
  /** Set the main viewport's pan to (tx, ty). */
  onPan: (tx: number, ty: number) => void;
  className?: string;
}

const MM_WIDTH = 200;
const MM_HEIGHT = 120;
const MM_PAD = 6;

export default function MiniMap({
  entities,
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  tx,
  ty,
  zoom,
  onPan,
  className,
}: MiniMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Drag bookkeeping for the viewport rectangle. Captured pointer means
  // every move comes back to us until pointerup, regardless of where the
  // cursor is.
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

  // World → minimap scale, with letterboxing so the whole content fits.
  const innerW = MM_WIDTH - MM_PAD * 2;
  const innerH = MM_HEIGHT - MM_PAD * 2;
  const scaleX = innerW / Math.max(1, contentWidth);
  const scaleY = innerH / Math.max(1, contentHeight);
  const scale = Math.min(scaleX, scaleY);
  const drawnW = contentWidth * scale;
  const drawnH = contentHeight * scale;
  const offsetX = MM_PAD + (innerW - drawnW) / 2;
  const offsetY = MM_PAD + (innerH - drawnH) / 2;

  // Visible-area rectangle in minimap coordinates.
  const vRect = {
    x: offsetX + (-tx / zoom) * scale,
    y: offsetY + (-ty / zoom) * scale,
    width: Math.max(2, (viewportWidth / zoom) * scale),
    height: Math.max(2, (viewportHeight / zoom) * scale),
  };

  function panToMinimapPoint(mx: number, my: number) {
    // Convert minimap pixel → world point, then place the main viewport so
    // that world point is at its centre.
    const wx = (mx - offsetX) / scale;
    const wy = (my - offsetY) / scale;
    onPan(viewportWidth / 2 - wx * zoom, viewportHeight / 2 - wy * zoom);
  }

  function handleSvgPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    // Background click = pan-to-centre. Clicks on the viewport rect call
    // stopPropagation so this never fires for them.
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    panToMinimapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }

  function onRectPointerDown(e: ReactPointerEvent<SVGRectElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, sx: tx, sy: ty };
  }

  function onRectPointerMove(e: ReactPointerEvent<SVGRectElement>) {
    if (!drag.current) return;
    // Pointer delta in minimap-pixel space.
    const dmx = e.clientX - drag.current.x;
    const dmy = e.clientY - drag.current.y;
    // Convert to world-space delta, then to viewport translate adjustment.
    // Moving the rectangle right means showing world content to the right
    // of where we are — i.e. translating the world to the LEFT, which is
    // a smaller (more negative) tx.
    const wdx = dmx / scale;
    const wdy = dmy / scale;
    onPan(drag.current.sx - wdx * zoom, drag.current.sy - wdy * zoom);
  }

  function onRectPointerUp(e: ReactPointerEvent<SVGRectElement>) {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  }

  return (
    <div className={`${styles.wrap} ${className ?? ""}`} aria-hidden>
      <svg
        ref={svgRef}
        className={styles.svg}
        width={MM_WIDTH}
        height={MM_HEIGHT}
        onPointerDown={handleSvgPointerDown}
      >
        <rect x={0} y={0} width={MM_WIDTH} height={MM_HEIGHT} className={styles.bg} />
        {entities.map((ent) => (
          <rect
            key={ent.id}
            x={offsetX + ent.x * scale}
            y={offsetY + ent.y * scale}
            width={Math.max(1, ent.width * scale)}
            height={Math.max(1, ent.height * scale)}
            className={styles.entity}
          />
        ))}
        <rect
          x={vRect.x}
          y={vRect.y}
          width={vRect.width}
          height={vRect.height}
          className={styles.viewport}
          onPointerDown={onRectPointerDown}
          onPointerMove={onRectPointerMove}
          onPointerUp={onRectPointerUp}
          onPointerCancel={onRectPointerUp}
        />
      </svg>
    </div>
  );
}
