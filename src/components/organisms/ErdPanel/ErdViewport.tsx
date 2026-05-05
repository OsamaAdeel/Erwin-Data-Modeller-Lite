import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  WheelEvent,
} from "react";
import MiniMap from "@/components/molecules/MiniMap";
import type { NodePosition } from "@/features/erd/layout";
import styles from "./ErdViewport.module.scss";

export interface ErdViewportProps {
  contentWidth: number;
  contentHeight: number;
  /**
   * Entity rectangles for the optional minimap overlay. When omitted the
   * minimap toggle is not rendered.
   */
  minimapEntities?: NodePosition[];
  /**
   * Pass-through to the minimap so it can dim non-matching entities in
   * sync with the main view's search filter.
   */
  minimapMatchedIds?: Set<string>;
  children: ReactNode;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

// Pan step for arrow keys, in screen pixels at the current zoom. Shift
// quadruples the step so power users can sweep the canvas without having
// to hold the key for several seconds.
const PAN_STEP = 80;
const PAN_STEP_LARGE = PAN_STEP * 3;

const MINIMAP_STORAGE_KEY = "erwin.erd.minimap";

function readMinimapPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(MINIMAP_STORAGE_KEY);
    if (v === "off") return false;
    return true; // missing or "on"
  } catch {
    return true;
  }
}

function writeMinimapPref(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MINIMAP_STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* no-op */
  }
}

/**
 * Pannable + zoomable SVG container. The children are positioned in
 * world coordinates from (0, 0) to (contentWidth, contentHeight); the
 * viewport translates and scales the inner <g> to put them on screen.
 */
export default function ErdViewport({
  contentWidth,
  contentHeight,
  minimapEntities,
  minimapMatchedIds,
  children,
}: ErdViewportProps) {
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

  // Live container size — drives the minimap's viewport rectangle math.
  // Updated by ResizeObserver so resizing the window or expanding a sibling
  // card immediately re-syncs the minimap.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [showMinimap, setShowMinimap] = useState<boolean>(readMinimapPref);

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

  // Track the canvas's actual rendered size so the minimap's viewport
  // rectangle stays accurate across window resizes and layout shifts.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ width: r.width, height: r.height });
    };
    sync();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, []);

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

  // Keyboard navigation. Mirrors the controls cluster (zoom in/out, fit)
  // plus arrow-key panning so users without a pointer device can still
  // explore the diagram. Shift makes each pan step ~3x larger.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Don't hijack keys aimed at a child input — none today, but cheap
    // future-proofing if the controls cluster ever gains one.
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }
    const step = e.shiftKey ? PAN_STEP_LARGE : PAN_STEP;
    switch (e.key) {
      case "+":
      case "=":
        e.preventDefault();
        zoomBy(1.2);
        break;
      case "-":
      case "_":
        e.preventDefault();
        zoomBy(1 / 1.2);
        break;
      case "0":
        e.preventDefault();
        fit();
        break;
      // Arrow direction maps to which world edge moves into view: ArrowLeft
      // wants more world content to the LEFT, which means translating the
      // world to the RIGHT — i.e. tx increases.
      case "ArrowLeft":
        e.preventDefault();
        setTx((t) => t + step);
        break;
      case "ArrowRight":
        e.preventDefault();
        setTx((t) => t - step);
        break;
      case "ArrowUp":
        e.preventDefault();
        setTy((t) => t + step);
        break;
      case "ArrowDown":
        e.preventDefault();
        setTy((t) => t - step);
        break;
    }
  }

  const toggleMinimap = () => {
    setShowMinimap((on) => {
      const next = !on;
      writeMinimapPref(next);
      return next;
    });
  };

  const handleMinimapPan = useCallback((nextTx: number, nextTy: number) => {
    setTx(nextTx);
    setTy(nextTy);
  }, []);

  const minimapAvailable = !!minimapEntities && minimapEntities.length > 0;

  return (
    <div className={styles.wrap}>
      <div
        ref={containerRef}
        className={styles.canvas}
        // tabIndex makes the canvas a keyboard target so +/-/0/arrows work
        // once the user Tabs into it. The role is descriptive; we don't
        // claim "img" because the SVG inside has its own group children
        // with aria-labels.
        tabIndex={0}
        role="application"
        aria-label="ERD diagram canvas. Use plus / minus to zoom, 0 to fit, arrow keys to pan."
        onKeyDown={handleKeyDown}
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
      {minimapAvailable && showMinimap && (
        <div className={styles.minimap}>
          <MiniMap
            entities={minimapEntities!}
            contentWidth={contentWidth}
            contentHeight={contentHeight}
            viewportWidth={containerSize.width}
            viewportHeight={containerSize.height}
            tx={tx}
            ty={ty}
            zoom={zoom}
            onPan={handleMinimapPan}
            matchedIds={minimapMatchedIds}
          />
        </div>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.2)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={fit}
          aria-label="Fit to view"
          title="Fit to view"
        >
          ⤢
        </button>
        {minimapAvailable && (
          <button
            type="button"
            onClick={toggleMinimap}
            aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
            title={showMinimap ? "Hide minimap" : "Show minimap"}
            aria-pressed={showMinimap}
            className={`${styles.minimapToggle} ${showMinimap ? styles.toggleOn : ""}`}
          >
            <MinimapGlyph />
          </button>
        )}
        <span className={styles.zoomLabel} aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}

function MinimapGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
      <rect x="4" y="5" width="4" height="3" />
    </svg>
  );
}
