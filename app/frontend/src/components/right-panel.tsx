import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/tip";
import {
  clampPanelWidth,
  readStoredPanelWidth,
  writeStoredPanelWidth,
  type SurfaceName,
} from "@/lib/right-panel";

/**
 * RightPanel — the rail + panel shell for the terminal route's second render
 * slot (change 260811-2r1w-right-panel-shell-web-surface; spec
 * docs/specs/right-panel.md, phase 1: rail + panel shell + `web` surface).
 *
 * The component renders a fragment — [panel, rail] — as direct children of the
 * terminal-route content row in `app.tsx` (`[ main lens slot | panel | rail ]`).
 *
 * - **Rail**: a fixed ~38px vertical strip on the right edge, always rendered
 *   by the caller on desktop terminal routes (spec § The Model). One focusable
 *   button per AVAILABLE surface (phase 1: `web` only), each carrying the
 *   availability dot (P4 — the amber attention semantics arrive in phase 3).
 *   The active surface renders inverse-video, matching the view-switcher's
 *   active-segment treatment. Click toggles the surface open/closed.
 * - **Panel**: opens between the main lens slot and the rail. Width is the
 *   per-viewer `runkit-panel-width` percentage (default 38%, clamped to
 *   min 280px / max 65% of the row — `clampPanelWidth`). A drag handle on the
 *   panel's LEFT edge resizes it; during the drag the panel content gets
 *   `pointer-events: none` so the iframe cannot swallow pointermove, and the
 *   terminal stays mounted — its refit rides TerminalClient's existing
 *   container ResizeObserver (no IntersectionObserver suspension — the
 *   board-page pane-resize bug class).
 * - **Hide, never unmount (P3)**: the surface subtree mounts lazily on first
 *   open, then hides at `display` level (`hidden` class) when closed — iframe
 *   in-memory state survives a collapse.
 *
 * Presentational by contract (the view-switcher precedent): surface open state
 * (URL + per-window localStorage) lives in `app.tsx`; this component owns only
 * the width/drag interaction and the mount-once wrapper. Surface CONTENT
 * arrives as `children` (app.tsx composes the `IframeWindow`), so the shell
 * stays free of the renderer's import graph and later surfaces (`code`,
 * `agents`) slot in as different children.
 */

/** Human label for a surface's rail button + tooltip (the accessible name). */
const SURFACE_LABEL: Record<SurfaceName, string> = {
  web: "Web",
};

/** Short rail glyph — the lowercase surface name (the view-switcher's
 *  `[tty|web]` short-segment style). */
const SURFACE_GLYPH: Record<SurfaceName, string> = {
  web: "web",
};

interface RightPanelProps {
  /** Surfaces available for the current window (`availableSurfaces`). */
  available: SurfaceName[];
  /** The resolved open surface, or `null` when the panel is collapsed. */
  active: SurfaceName | null;
  /** Toggle a surface open/closed (caller writes URL + localStorage). */
  onToggle: (surface: SurfaceName) => void;
  /** The surface content (mounted lazily on first open, then hidden — never
   *  unmounted — while the route lives). */
  children?: React.ReactNode;
}

export function RightPanel({ available, active, onToggle, children }: RightPanelProps) {
  // The rail is always rendered, so its parent (the content row) is the
  // measurement basis for the width floor/cap math.
  const railRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [widthPct, setWidthPct] = useState(() => readStoredPanelWidth());
  const widthRef = useRef(widthPct);
  widthRef.current = widthPct;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startPct: number; rowWidth: number } | null>(null);

  // Hide-never-unmount (P3): mount the surface subtree lazily on first open,
  // then keep it mounted (display-level hide) for the route's lifetime.
  const [everOpened, setEverOpened] = useState(active !== null);
  useEffect(() => {
    if (active !== null) setEverOpened(true);
  }, [active]);

  // Track the content row's width so the 280px floor / 65% cap resolve to
  // pixels at render and drag time (restores included).
  useEffect(() => {
    const row = railRef.current?.parentElement;
    if (!row) return;
    const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startPct: widthRef.current,
      rowWidth: railRef.current?.parentElement?.clientWidth ?? 0,
    };
    setDragging(true);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.rowWidth <= 0) return;
    // The handle sits on the panel's LEFT edge: dragging left widens.
    const deltaPct = ((drag.startX - e.clientX) / drag.rowWidth) * 100;
    setWidthPct(clampPanelWidth(drag.startPct + deltaPct, drag.rowWidth));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // `pointercancel` has already released the capture implicitly — releasing
    // again throws NotFoundError and would strand the panel in `dragging`
    // (pointer-events: none) with the width unpersisted.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    writeStoredPanelWidth(widthRef.current);
  };

  const clampedPct = clampPanelWidth(widthPct, rowWidth);

  return (
    <>
      {everOpened && (
        <div
          data-testid="right-panel"
          // P3: closed = display-level hide, never unmount (the iframe keeps
          // its in-memory state across a collapse).
          className={`h-full min-h-0 shrink-0 border-l border-border ${active !== null ? "flex flex-row" : "hidden"}`}
          style={{ width: `${clampedPct}%` }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            data-testid="right-panel-resize-handle"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`w-1 shrink-0 cursor-col-resize hover:bg-accent-green ${dragging ? "bg-accent-green" : ""}`}
          />
          <div
            // Mid-drag the iframe must not swallow pointermove (the drag would
            // stall at the iframe boundary).
            className={`flex-1 min-w-0 h-full flex flex-col ${dragging ? "pointer-events-none" : ""}`}
          >
            {children}
          </div>
        </div>
      )}
      <div
        ref={railRef}
        data-testid="right-panel-rail"
        className="w-[38px] shrink-0 border-l border-border flex flex-col items-center py-1 gap-1"
      >
        {available.map((surface) => {
          const isActive = surface === active;
          return (
            <Tip key={surface} label={`${SURFACE_LABEL[surface]} panel`} placement="left">
              <button
                type="button"
                onClick={() => onToggle(surface)}
                aria-pressed={isActive}
                aria-label={`${SURFACE_LABEL[surface]} panel`}
                className={`rk-glint relative w-7 h-7 flex items-center justify-center rounded text-[10px] font-mono transition-colors focus-visible:outline-2 focus-visible:outline-accent-green ${
                  isActive
                    ? "bg-accent-green text-bg-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {SURFACE_GLYPH[surface]}
                {/* Availability dot (P4) — the button renders only when the
                    surface is available, so phase 1 ships the dot in its
                    availability state; the amber attention state is phase 3. */}
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 right-0.5 w-1 h-1 rounded-full ${isActive ? "bg-bg-primary" : "bg-accent-green"}`}
                />
              </button>
            </Tip>
          );
        })}
      </div>
    </>
  );
}
