import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/tip";
import { TerminalClient } from "@/components/terminal-client";
import { CodeSurface } from "@/components/code-surface";
import { IframeWindow } from "@/components/iframe-window";
import { ChatView } from "@/components/chat-view";
import {
  SHAPE_ARITY,
  SURFACE_LABEL,
  readStoredRatios,
  writeStoredRatios,
  type Layout,
  type LayoutRatios,
  type LayoutShape,
  type SurfaceKind,
} from "@/lib/surface-layout";
import { clampRatio, MIN_PANEL_WIDTH_PX } from "@/lib/right-panel";
import type { ViewWindow } from "@/lib/window-view";
import type { ChatEvent, ChatPending } from "@/lib/chat-stream";

/**
 * SurfaceLayout — the tile grid renderer for the terminal route's center
 * (change 260812-ab5v-surface-layout-core; spec docs/specs/surface-layout.md
 * § Shape presets, § Verbs). Replaces the legacy exclusive-lens render branch
 * AND the right-panel surface slot: the resolved `(shape, order)` layout
 * renders as 1–3 TILES, each mounting an EXISTING renderer unchanged —
 * `TerminalClient` (tty), `IframeWindow` (web), `ChatView` (chat),
 * `CodeSurface` (code).
 *
 * - **Tile chrome (R7)**: each tile carries a slim header — surface name +
 *   small meta (git-root basename for code, `@rk_url` host for web) — with
 *   hover-revealed verb buttons following the sidebar's hover-cluster pattern
 *   (`opacity-0 group-hover:opacity-100`): ⏶ zoom, ◧ promote, ⇄
 *   swap-with-next, ✕ close. `single` layouts render NO verbs (promote/swap
 *   are meaningless and closing the last tile is disallowed).
 * - **Zoom (R6)**: transient component state ONLY — one tile full-center, the
 *   others hidden at display level. No URL/localStorage write; the toggle
 *   renders only when arity > 1.
 * - **Hide-never-unmount (P3)**: a surface opened earlier this route visit
 *   stays mounted (`hidden` class) when closed or zoomed away, so iframe /
 *   terminal / chat state survives. The "ever opened" bookkeeping is keyed by
 *   surface kind and resets per window — `app.tsx` keys this component by
 *   `${server}:${windowId}` (the RightPanel precedent).
 * - **Dividers (R5)**: drag mutates RATIOS only (never shape/order), clamped
 *   via the `clampPanelWidth` approach generalized in `clampRatio` (280px
 *   floor both sides), persisted per (window, shape) ON RELEASE ONLY. Tiles
 *   stay live mid-drag — no suspension/unmount (the board pane-resize bug
 *   class); tile content gets `pointer-events: none` so iframes cannot
 *   swallow pointermove (the RightPanel drag-handle pattern).
 * - **Duplicate tty**: the muxed relay supports N clients per pane, so two
 *   tty tiles are legal. Only the FIRST tty tile receives the shared
 *   `wsRef`/`focusRef` (and registers as the shell's focused terminal);
 *   duplicates mount extra TerminalClients without those refs.
 *
 * Presentational by contract (the view-switcher/right-panel precedent):
 * (shape, order) state lives in `app.tsx` and arrives as the `layout` prop;
 * verbs call the parent's callbacks (`onPromote`/`onSwap`/`onClose`), which
 * run the pure mutations + persistence/URL mirroring. The component owns only
 * transient interaction state: zoom, the in-flight ratio drag, and the
 * mount-once bookkeeping.
 */

/** Human labels for the tile header + verb aria-labels live in
 *  `lib/surface-layout.ts` (`SURFACE_LABEL` — shared with the rail, palette,
 *  and mobile sheet so none drift). */

/** Everything a chat tile needs — the AppShell-owned `kind:"chat"`
 *  subscription (`chatStream`) plus the send wrapper, bundled so the tile
 *  mount reads like the legacy lens branch. */
export interface ChatTileStream {
  events: ChatEvent[];
  pending: ChatPending | null;
  connected: boolean;
  error: string | null;
  onSend: (text: string, submit: boolean) => Promise<void>;
  busy: boolean;
}

interface SurfaceLayoutProps {
  /** The RESOLVED layout (app.tsx ran the ladder + degradation). */
  layout: Layout;
  server: string;
  /** The route window id (`@N`). */
  windowId: string;
  sessionName: string;
  /** The SSE-derived window record — tile meta + renderer props (rkUrl,
   *  gitRoot) narrow from it; an unavailable kind renders an empty tile body
   *  (the ladder's degradation should already have dropped it). */
  window: ViewWindow | null;
  /** Below `isMobileViewport()` only ONE slot renders (R13) — no dividers, no
   *  verb chrome. `mobileActiveSlot` (T014) picks WHICH slot: the mobile sheet
   *  tabs swap the slot-A surface via transient app-level state WITHOUT
   *  mutating the shared layout (the layout stays desktop's arrangement).
   *  Absent/out-of-range → slot 0. */
  isMobile: boolean;
  mobileActiveSlot?: number;
  /** Shared terminal plumbing — handed to the FIRST tty tile only. */
  wsRef: React.MutableRefObject<WebSocket | null>;
  focusRef: React.MutableRefObject<(() => void) | null>;
  scrollLocked: boolean;
  onSessionNotFound: () => void;
  chat: ChatTileStream;
  /** Host code-server reachability — selects the code tile's CONTENT (live
   *  iframe vs not-running empty state), never availability. */
  codeReachable: boolean;
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** The web tile's `>_` affordance — "switch to terminal" (single:tty). */
  onSwitchToTty: () => void;
  /** Verb callbacks — the parent applies the pure mutation + persistence +
   *  URL mirroring (R3 write discipline). */
  onPromote: (surface: SurfaceKind) => void;
  onSwap: (surface: SurfaceKind) => void;
  onClose: (surface: SurfaceKind) => void;
  /** Optional ratio observers — fired during a drag (per move) and on release
   *  (commit). The component owns ratio state + persistence itself; these let
   *  a parent/e2e observe without owning anything. */
  onRatioChange?: (index: number, pct: number) => void;
  onRatioCommit?: () => void;
  /** ⏶ Zoom palette seam (T012/R11): zoom stays INTERNAL transient state (R6),
   *  but the palette's `Layout: Zoom`/`Unzoom` entries must observe and
   *  trigger it. The component registers a slot-A zoom toggle into this ref
   *  (cleared on unmount) and reports zoom flips via `onZoomChange` so the
   *  palette list rebuilds. */
  zoomToggleRef?: React.MutableRefObject<(() => void) | null>;
  onZoomChange?: (zoomed: boolean) => void;
}

/** Equal-split default ratios (cumulative boundary percentages): arity 2 →
 *  [50]; arity 3 → [33.3…, 66.6…]. */
function defaultRatios(arity: 1 | 2 | 3): LayoutRatios {
  if (arity === 1) return [];
  if (arity === 2) return [50];
  return [100 / 3, 200 / 3];
}

/** The ratios a (window, shape) render starts from: the persisted value when
 *  it is well-formed for the shape's arity (right length, finite, strictly
 *  increasing, inside (0, 100)), else equal splits. Garbage never reaches the
 *  grid (the `readStoredPanelWidth` discipline). */
function initialRatios(
  server: string,
  windowId: string,
  shape: LayoutShape,
): LayoutRatios {
  const arity = SHAPE_ARITY[shape];
  const stored = readStoredRatios(server, windowId, shape);
  if (
    stored &&
    stored.length === arity - 1 &&
    stored.every((n, i) => n > 0 && n < 100 && (i === 0 || n > stored[i - 1]))
  ) {
    return stored;
  }
  return defaultRatios(arity);
}

/** The grid template for a shape at the given ratios (spec § Shape presets
 *  ASCII). Ratios are cumulative boundary percentages of the container along
 *  the split axis; tracks are `fr` factors proportional to each slot's share
 *  so rounding never opens gaps. A zoomed render collapses to one cell. */
function gridStyle(
  shape: LayoutShape,
  ratios: LayoutRatios,
  zoomed: boolean,
): React.CSSProperties {
  if (zoomed || shape === "single") {
    return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
  }
  const [r0, r1] = ratios;
  switch (shape) {
    case "split-h":
      return { gridTemplateColumns: `${r0}fr ${100 - r0}fr`, gridTemplateRows: "1fr" };
    case "split-v":
      return { gridTemplateColumns: "1fr", gridTemplateRows: `${r0}fr ${100 - r0}fr` };
    case "row":
      return {
        gridTemplateColumns: `${r0}fr ${r1 - r0}fr ${100 - r1}fr`,
        gridTemplateRows: "1fr",
      };
    case "col":
      return {
        gridTemplateColumns: "1fr",
        gridTemplateRows: `${r0}fr ${r1 - r0}fr ${100 - r1}fr`,
      };
    // main-left / main-right share the template (slot placement mirrors);
    // ratio 0 is the A|(B,C) column boundary, ratio 1 the B/C row boundary.
    case "main-left":
    case "main-right":
      return {
        gridTemplateColumns: `${r0}fr ${100 - r0}fr`,
        gridTemplateRows: `${r1}fr ${100 - r1}fr`,
      };
    // main-top: ratio 0 is the A|(B,C) row boundary, ratio 1 the B/C column
    // boundary.
    case "main-top":
      return {
        gridTemplateColumns: `${r1}fr ${100 - r1}fr`,
        gridTemplateRows: `${r0}fr ${100 - r0}fr`,
      };
  }
}

/** A slot's grid placement (spec § Shape presets — slot A = order[0], the
 *  main slot in `main-*` shapes). Zoom overrides every tile to the single
 *  cell. */
function slotStyle(
  shape: LayoutShape,
  slot: number,
  zoomed: boolean,
): React.CSSProperties {
  if (zoomed || shape === "single") return { gridColumn: "1", gridRow: "1" };
  switch (shape) {
    case "split-h":
    case "row":
      return { gridColumn: String(slot + 1), gridRow: "1" };
    case "split-v":
    case "col":
      return { gridColumn: "1", gridRow: String(slot + 1) };
    case "main-left":
      return slot === 0
        ? { gridColumn: "1", gridRow: "1 / span 2" }
        : { gridColumn: "2", gridRow: String(slot) };
    case "main-right":
      return slot === 0
        ? { gridColumn: "2", gridRow: "1 / span 2" }
        : { gridColumn: "1", gridRow: String(slot) };
    case "main-top":
      return slot === 0
        ? { gridRow: "1", gridColumn: "1 / span 2" }
        : { gridRow: "2", gridColumn: String(slot) };
  }
}

interface DividerSpec {
  /** The ratio index this divider governs (boundary BEFORE the slot group
   *  after it — index 0 is the first boundary). */
  index: number;
  /** The split axis: "x" = vertical divider (drag changes columns). */
  axis: "x" | "y";
  style: React.CSSProperties;
}

/** Divider placement per shape (R5/R6): one divider per ratio, absolutely
 *  positioned ON its boundary inside the relatively-positioned grid. In
 *  `main-*` shapes the B/C divider is confined to its side of the A boundary
 *  (main-left: the B/C split lives in the right column, …). */
function dividerSpecs(shape: LayoutShape, ratios: LayoutRatios): DividerSpec[] {
  const [r0, r1] = ratios;
  switch (shape) {
    case "single":
      return [];
    case "split-h":
      return [{ index: 0, axis: "x", style: { left: `${r0}%`, top: 0, bottom: 0 } }];
    case "split-v":
      return [{ index: 0, axis: "y", style: { top: `${r0}%`, left: 0, right: 0 } }];
    case "row":
      return [
        { index: 0, axis: "x", style: { left: `${r0}%`, top: 0, bottom: 0 } },
        { index: 1, axis: "x", style: { left: `${r1}%`, top: 0, bottom: 0 } },
      ];
    case "col":
      return [
        { index: 0, axis: "y", style: { top: `${r0}%`, left: 0, right: 0 } },
        { index: 1, axis: "y", style: { top: `${r1}%`, left: 0, right: 0 } },
      ];
    case "main-left":
      return [
        { index: 0, axis: "x", style: { left: `${r0}%`, top: 0, bottom: 0 } },
        { index: 1, axis: "y", style: { top: `${r1}%`, left: `${r0}%`, right: 0 } },
      ];
    case "main-right":
      return [
        { index: 0, axis: "x", style: { left: `${r0}%`, top: 0, bottom: 0 } },
        { index: 1, axis: "y", style: { top: `${r1}%`, left: 0, right: `${100 - r0}%` } },
      ];
    case "main-top":
      return [
        { index: 0, axis: "y", style: { top: `${r0}%`, left: 0, right: 0 } },
        { index: 1, axis: "x", style: { left: `${r1}%`, top: `${r0}%`, bottom: 0 } },
      ];
  }
}

/** Small header meta (R7): the git root's basename for code, the `@rk_url`
 *  host for web. Anything unparseable degrades to no meta. */
function tileMeta(kind: SurfaceKind, win: ViewWindow | null): string | null {
  if (kind === "code" && win?.gitRoot) {
    const parts = win.gitRoot.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }
  if (kind === "web" && win?.rkUrl) {
    try {
      return new URL(win.rkUrl).host;
    } catch {
      return null;
    }
  }
  return null;
}

export function SurfaceLayout({
  layout,
  server,
  windowId,
  sessionName,
  window: win,
  isMobile,
  mobileActiveSlot,
  wsRef,
  focusRef,
  scrollLocked,
  onSessionNotFound,
  chat,
  codeReachable,
  shouldReclaimChord,
  onSwitchToTty,
  onPromote,
  onSwap,
  onClose,
  onRatioChange,
  onRatioCommit,
  zoomToggleRef,
  onZoomChange,
}: SurfaceLayoutProps) {
  const arity = SHAPE_ARITY[layout.shape];

  // Dummy ws bucket for DUPLICATE tty tiles — TerminalClient types `wsRef` as
  // required, but only the first tty tile owns the shared refs (the shell's
  // bottom bar / compose strip read them).
  const extraTtyWsRef = useRef<WebSocket | null>(null);

  // Hide-never-unmount (P3): kinds opened earlier this route visit stay
  // mounted at display level. The parent keys this component per window, so
  // the set resets on a window switch (the RightPanel precedent).
  const [everOpened, setEverOpened] = useState<SurfaceKind[]>(() => [
    ...new Set(layout.order),
  ]);
  useEffect(() => {
    setEverOpened((prev) => {
      const missing = layout.order.filter((k) => !prev.includes(k));
      return missing.length > 0 ? [...prev, ...missing] : prev;
    });
  }, [layout.order]);

  // ⏶ Zoom — transient only (R6): NO URL/localStorage write. Tracked as a
  // slot index so duplicate tty tiles zoom independently; cleared when the
  // layout can no longer host the zoomed slot (a close collapsed the arity).
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);
  useEffect(() => {
    setZoomedIndex((z) =>
      z !== null && (layout.order.length <= 1 || z >= layout.order.length) ? null : z,
    );
  }, [layout.order.length]);
  const zoomed = zoomedIndex !== null;

  // Zoom palette seam (T012/R11): register the slot-A toggle for the parent's
  // `Layout: Zoom`/`Unzoom` palette entries and report flips so those entries
  // rebuild. The toggle is a no-op on single layouts (the clearing effect
  // above immediately unsets an index that no longer fits).
  useEffect(() => {
    if (!zoomToggleRef) return;
    zoomToggleRef.current = () =>
      setZoomedIndex((z) => (z === null ? 0 : null));
    return () => {
      zoomToggleRef.current = null;
    };
  }, [zoomToggleRef]);
  useEffect(() => {
    onZoomChange?.(zoomed);
  }, [zoomed, onZoomChange]);

  // Ratios (R5): read per (window, shape), normalized for the shape's arity;
  // persisted ON DRAG RELEASE ONLY.
  const [ratios, setRatios] = useState<LayoutRatios>(() =>
    initialRatios(server, windowId, layout.shape),
  );
  useEffect(() => {
    setRatios(initialRatios(server, windowId, layout.shape));
  }, [server, windowId, layout.shape]);
  // Render-time fallback: the shape-change effect lands a beat after the
  // render that carries the new shape — never index a stale-length array.
  const effRatios =
    ratios.length === arity - 1 ? ratios : defaultRatios(arity);
  const ratiosRef = useRef(effRatios);
  ratiosRef.current = effRatios;

  // Divider drag (R5) — the RightPanel drag-handle pattern: pointer capture
  // on the handle, pointermove tracked there, release/cancel both end the
  // drag, tile content gets `pointer-events: none` mid-drag so iframes don't
  // swallow pointermove. Tiles stay MOUNTED AND LIVE the whole time (the
  // board pane-resize bug class — no suspension).
  const gridRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragRef = useRef<{ index: number; axis: "x" | "y" } | null>(null);

  const onDividerPointerDown =
    (spec: DividerSpec) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { index: spec.index, axis: spec.axis };
      setDraggingIndex(spec.index);
    };

  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!drag || !grid) return;
    const rect = grid.getBoundingClientRect();
    const sizePx = drag.axis === "x" ? rect.width : rect.height;
    if (sizePx <= 0) return; // unmeasured (jsdom) — no math to do
    const rawPct =
      (((drag.axis === "x" ? e.clientX - rect.left : e.clientY - rect.top) /
        sizePx) *
        100);
    // Clamp within the 280px floor both sides (`clampRatio`) AND within the
    // neighboring boundaries — a divider adjusts only its own boundary and
    // may never cross (or strand) its siblings.
    const cur = ratiosRef.current;
    const floorPct = (MIN_PANEL_WIDTH_PX / sizePx) * 100;
    const prev = drag.index === 0 ? 0 : cur[drag.index - 1];
    const next = drag.index === cur.length - 1 ? 100 : cur[drag.index + 1];
    const pct = Math.min(
      Math.max(clampRatio(rawPct, sizePx), prev + floorPct),
      Math.max(next - floorPct, prev + floorPct),
    );
    const nextRatios = [...cur];
    nextRatios[drag.index] = pct;
    setRatios(nextRatios);
    onRatioChange?.(drag.index, pct);
  };

  const endDividerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // `pointercancel` has already released the capture implicitly — releasing
    // again throws NotFoundError (the RightPanel endDrag lesson).
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingIndex(null);
    writeStoredRatios(server, windowId, layout.shape, ratiosRef.current);
    onRatioCommit?.();
  };

  /** A tile's renderer, unchanged from the legacy lens/panel mounts. */
  const renderContent = (kind: SurfaceKind, primaryTty: boolean) => {
    switch (kind) {
      case "tty":
        return (
          <div className="flex-1 min-h-0 py-0.5 px-1 flex flex-col">
            <TerminalClient
              sessionName={sessionName}
              windowId={windowId}
              server={server}
              wsRef={primaryTty ? wsRef : extraTtyWsRef}
              onSessionNotFound={primaryTty ? onSessionNotFound : undefined}
              focusRef={primaryTty ? focusRef : undefined}
              scrollLocked={scrollLocked}
              // Only the primary tty registers as the shell's focused
              // terminal — duplicates must not fight over the slot (the
              // board-pane rule).
              registerFocus={primaryTty}
            />
          </div>
        );
      case "web":
        // An available web tile implies `hasWebUrl` held (degradation); the
        // `win?.rkUrl` guard is the TS narrowing for the prop.
        return win?.rkUrl ? (
          <IframeWindow
            windowId={windowId}
            rkUrl={win.rkUrl}
            onSwitchToTty={onSwitchToTty}
          />
        ) : null;
      case "code":
        return win?.gitRoot ? (
          <CodeSurface
            gitRoot={win.gitRoot}
            reachable={codeReachable}
            shouldReclaimChord={shouldReclaimChord}
          />
        ) : null;
      case "chat":
        return (
          <ChatView
            events={chat.events}
            pending={chat.pending}
            connected={chat.connected}
            error={chat.error}
            onSend={chat.onSend}
            busy={chat.busy}
          />
        );
    }
  };

  // Tile models: every VISIBLE slot plus every ever-opened kind that is
  // currently closed (hidden). The React key is stable per (kind, occurrence)
  // across the visible↔hidden transition — THAT is what makes
  // hide-never-unmount survive React reconciliation.
  let ttySeen = 0;
  const visibleTiles = layout.order.map((kind, slot) => {
    const occ = kind === "tty" ? ttySeen++ : 0;
    return { kind, slot, occ };
  });
  const firstTtySlot = layout.order.indexOf("tty");
  const hiddenTiles = everOpened
    .filter((kind) => !layout.order.includes(kind))
    .map((kind) => ({ kind, slot: -1, occ: 0 }));

  const renderTile = (
    tile: { kind: SurfaceKind; slot: number; occ: number },
    hidden: boolean,
    mobile: boolean,
  ) => {
    const { kind, slot, occ } = tile;
    const suffix = occ > 0 ? `-${occ + 1}` : "";
    const testId = `surface-tile-${kind}${suffix}`;
    const label = SURFACE_LABEL[kind];
    const meta = tileMeta(kind, win);
    const isZoomed = zoomed && slot === zoomedIndex;
    const showVerbs = !mobile && arity > 1 && slot >= 0;
    return (
      <div
        key={`${kind}${suffix}`}
        data-testid={testId}
        className={`group min-w-0 min-h-0 flex-col overflow-hidden ${hidden ? "hidden" : "flex"}`}
        style={hidden || mobile ? undefined : slotStyle(layout.shape, slot, zoomed)}
      >
        {!mobile && (
          <div className="flex items-center gap-1.5 px-1.5 h-6 shrink-0 border-b border-border bg-bg-primary font-mono text-[10px] text-text-secondary select-none">
            <span className="shrink-0 text-text-primary">{label}</span>
            {meta && (
              <span className="min-w-0 truncate text-text-secondary">{meta}</span>
            )}
            <span className="flex-1" />
            {showVerbs && (
              <>
                <Tip label={isZoomed ? `Unzoom ${label}` : `Zoom ${label}`}>
                  <button
                    type="button"
                    aria-label={isZoomed ? `Unzoom ${label}` : `Zoom ${label}`}
                    onClick={() => setZoomedIndex(isZoomed ? null : slot)}
                    className="opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 transition-opacity px-0.5 hover:text-text-primary"
                  >
                    ⏶
                  </button>
                </Tip>
                <Tip label={`Promote ${label}`}>
                  <button
                    type="button"
                    aria-label={`Promote ${label}`}
                    onClick={() => onPromote(kind)}
                    className="opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 transition-opacity px-0.5 hover:text-text-primary"
                  >
                    ◧
                  </button>
                </Tip>
                <Tip label={`Swap ${label}`}>
                  <button
                    type="button"
                    aria-label={`Swap ${label}`}
                    onClick={() => onSwap(kind)}
                    className="opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 transition-opacity px-0.5 hover:text-text-primary"
                  >
                    ⇄
                  </button>
                </Tip>
                <Tip label={`Close ${label}`}>
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    onClick={() => onClose(kind)}
                    className="opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 transition-opacity px-0.5 hover:text-text-primary"
                  >
                    ✕
                  </button>
                </Tip>
              </>
            )}
          </div>
        )}
        <div
          // Mid-drag the iframe/xterm content must not swallow pointermove
          // (the drag would stall at the iframe boundary).
          className={`flex-1 min-h-0 flex flex-col ${draggingIndex !== null ? "pointer-events-none" : ""}`}
        >
          {renderContent(kind, slot === firstTtySlot)}
        </div>
      </div>
    );
  };

  // Mobile (R13): ONE slot only, full-width, no verb chrome, no dividers.
  // Which slot is `mobileActiveSlot` (T014) — the mobile sheet's tabs swap the
  // shown surface via transient app-level state, NEVER mutating the shared
  // layout (it stays desktop's arrangement). All resolved surfaces stay
  // mounted-hidden so switching tabs loses no state.
  //
  // IMPORTANT (both branches): visible + hidden tiles render from ONE flat
  // array. Two separate `{arr1}{arr2}` expression slots reconcile
  // POSITIONALLY, so a keyed tile moving between them would UNMOUNT/remount —
  // silently breaking hide-never-unmount (P3/R6) on close (the e2e
  // element-identity assertion caught exactly this).
  if (isMobile) {
    const mobileSlot =
      mobileActiveSlot !== undefined &&
      mobileActiveSlot >= 0 &&
      mobileActiveSlot < layout.order.length
        ? mobileActiveSlot
        : 0;
    const allTiles = [
      ...visibleTiles.map((tile) => ({ tile, hidden: tile.slot !== mobileSlot })),
      ...hiddenTiles.map((tile) => ({ tile, hidden: true })),
    ];
    return (
      <div
        data-testid="surface-layout"
        className="flex-1 min-h-0 min-w-0 flex flex-col"
      >
        {allTiles.map(({ tile, hidden }) => renderTile(tile, hidden, true))}
      </div>
    );
  }

  const allTiles = [
    ...visibleTiles.map((tile) => ({
      tile,
      hidden: zoomed && tile.slot !== zoomedIndex,
    })),
    ...hiddenTiles.map((tile) => ({ tile, hidden: true })),
  ];
  return (
    <div
      ref={gridRef}
      data-testid="surface-layout"
      className="relative flex-1 min-h-0 min-w-0 grid"
      style={gridStyle(layout.shape, effRatios, zoomed)}
    >
      {allTiles.map(({ tile, hidden }) => renderTile(tile, hidden, false))}
      {!zoomed &&
        dividerSpecs(layout.shape, effRatios).map((spec) => (
          <div
            key={spec.index}
            role="separator"
            aria-orientation={spec.axis === "x" ? "vertical" : "horizontal"}
            aria-label="Resize tiles"
            aria-valuenow={Math.round(effRatios[spec.index])}
            data-testid={`surface-divider-${spec.index}`}
            onPointerDown={onDividerPointerDown(spec)}
            onPointerMove={onDividerPointerMove}
            onPointerUp={endDividerDrag}
            onPointerCancel={endDividerDrag}
            className={`absolute z-10 ${
              spec.axis === "x"
                ? "w-1.5 -translate-x-1/2 cursor-col-resize"
                : "h-1.5 -translate-y-1/2 cursor-row-resize"
            } hover:bg-accent-green ${draggingIndex === spec.index ? "bg-accent-green" : ""}`}
            style={{ ...spec.style, touchAction: "none" }}
          />
        ))}
    </div>
  );
}
