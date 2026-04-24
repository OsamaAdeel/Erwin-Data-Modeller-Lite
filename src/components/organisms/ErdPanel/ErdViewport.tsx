import {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  WheelEvent,
} from "react";
import styles from "./ErdViewport.module.scss";

export interface ErdViewportProps {
  contentWidth: number;
  contentHeight: number;
  children: ReactNode;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

/**
 * Pannable + zoomable SVG container. The children are positioned in
 * world coordinates from (0, 0) to (contentWidth, contentHeight); the
 * viewport translates and scales the inner <g> to put them on screen.
 */
export default function ErdViewport({ contentWidth, contentHeight, children }: ErdViewportProps) {
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

  // Fit to viewport whenever the content dimensions change.
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !contentWidth || !contentHeight) return;
    const rect = el.getBoundingClientRect();
    const padding = 24;
    const sx = (rect.width - padding * 2) / contentWidth;
    const sy = (rect.height - padding * 2) / contentHeight;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(sx, sy, 1)));
    setZoom(z);
    setTx((rect.width - contentWidth * z) / 2);
    setTy((rect.height - contentHeight * z) / 2);
  }, [contentWidth, contentHeight]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Project the cursor into world space at the current zoom, change
    // zoom, then re-project so the cursor stays over the same world
    // point.
    const wx = (px - tx) / zoom;
    const wy = (py - ty) / zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    setZoom(next);
    setTx(px - wx * next);
    setTy(py - wy * next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, sx: tx, sy: ty };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setTx(drag.current.sx + (e.clientX - drag.current.x));
    setTy(drag.current.sy + (e.clientY - drag.current.y));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* no-op */ }
  };

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const wx = (cx - tx) / zoom;
    const wy = (cy - ty) / zoom;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    setZoom(next);
    setTx(cx - wx * next);
    setTy(cy - wy * next);
  };

  return (
    <div className={styles.wrap}>
      <div
        ref={containerRef}
        className={styles.canvas}
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width="100%" height="100%">
          <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}>{children}</g>
        </svg>
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} title="Zoom out">−</button>
        <button type="button" onClick={fit} title="Fit to view">⤢</button>
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
