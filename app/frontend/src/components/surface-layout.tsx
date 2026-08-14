import { useCallback, useEffect, useRef, useState } from "react";
import { Tip } from "@/components/tip";
import { TerminalClient } from "@/components/terminal-client";
import { CodeSurface } from "@/components/code-surface";
import { IframeWindow } from "@/components/iframe-window";
import { ChatView } from "@/components/chat-view";
import { StatusDot } from "@/components/status-dot";
import {
  SHAPE_ARITY,
  SURFACE_GLYPH,
  SURFACE_LABEL,
  readStoredRatios,
  writeStoredRatios,
  type Layout,
  type LayoutRatios,
  type LayoutShape,
  type SurfaceKind,
} from "@/lib/surface-layout";
import { clampRatio, MIN_PANEL_WIDTH_PX } from "@/lib/right-panel";
import {
  ClosePaneBoxedGlyph,
  SplitHorizontalGlyph,
  SplitVerticalGlyph,
} from "@/components/top-bar-icons";
import type { ViewWindow } from "@/lib/window-view";
import type { ChatEvent, ChatPending } from "@/lib/chat-stream";
import type { WindowInfo } from "@/types";

/**
 * SurfaceLayout — the tile grid renderer for the terminal route's center
 * (change 260812-ab5v-surface-layout-core; spec docs/specs/surface-layout.md
 * § Shape presets, § Verbs). Replaces the legacy exclusive-lens render branch
 * AND the right-panel surface slot: the resolved `(shape, order)` layout
 * renders as 1–3 TILES, each mounting an EXISTING renderer unchanged —
 * `TerminalClient` (tty), `IframeWindow` (web), `ChatView` (chat),
 * `CodeSurface` (code).
 *
 * - **Tile chrome (R7, redesigned in 260812-wfic; gap-seam 260814-011r)**: the
 *   desktop grid floats tiles on the `bg-bg-inset` ground — 6px gutters plus a
 *   6px ground inset (`gap-[6px] p-[6px]`) — each tile a 6px-radius card
 *   (`rounded-md`) whose REST border is the dimmed `rk-card-border` (a 55%
 *   color-mix: the gap does the separating, the border only defines the card
 *   edge). Each tile carries a 30px `bg-bg-card` header —
 *   kind glyph (`SURFACE_GLYPH`) + surface name + the small meta as an inset
 *   chip (git-root basename for code, `@rk_url` host for web) — with
 *   rest-visible boxed verb buttons (22×22, 26×26 coarse): ⛶ zoom, ◧
 *   promote, ⇄ swap-with-next, ✕ close (a hairline rule separates ✕ from the
 *   safe verbs; its hover turns `text-signal-red`). While a tile is zoomed
 *   its ⛶ stays `accent-green` and its ◧/⇄ verbs hide (no-ops there).
 *   `single` layouts render NO layout verbs (promote/swap are meaningless and
 *   closing the last tile is disallowed). The tty header also mounts the
 *   shared `StatusDot` (agent state) when the parent passes `statusWindow`.
 *   Tty headers additionally carry a bordered PANE SEGMENT (260813-w1lf
 *   content verbs — Split H · Split V · Close Pane) at ANY arity, including
 *   `single:tty`, and visible while zoomed; a hairline separates it from the
 *   layout-verb cluster when that renders. Its verbs call the parent's
 *   `onSplitPane`/`onClosePane` callbacks.
 * - **Focused tile (260812-wfic R2)**: transient component state — the slot
 *   that last received pointer/keyboard interaction (pointerdown-capture +
 *   focusin seams on the tile wrapper; the code tile's `CodeSurface` reports
 *   contentDocument interaction via `onInteract`). The focused tile's border
 *   and kind glyph turn `accent-green` (the tmux active-pane metaphor);
 *   suppressed at arity 1. Default = slot A; falls back to slot A when the
 *   focused slot leaves the layout. The focused KIND is reported upward via
 *   `onFocusedKindChange` (app.tsx mirrors it for the `ttyOnly` shortcut
 *   gate) and settable by kind through the `focusTileRef` seam (the
 *   `zoomToggleRef` pattern — the palette's `Layout: Focus <Surface>`).
 * - **Zoom (R6)**: transient component state ONLY — one tile full-center, the
 *   others hidden at display level. No URL/localStorage write; the toggle
 *   renders only when arity > 1.
 * - **Hide-never-unmount (P3)**: a surface opened earlier this route visit
 *   stays mounted (`hidden` class) when closed or zoomed away, so iframe /
 *   terminal / chat state survives. The "ever opened" bookkeeping is keyed by
 *   surface kind and resets per window — `app.tsx` keys this component by
 *   `${server}:${windowId}` (the RightPanel precedent).
 * - **Dividers (R5; gap-seam sash 260814-011r)**: drag mutates RATIOS only
 *   (never shape/order), clamped via the `clampPanelWidth` approach
 *   generalized in `clampRatio` (280px floor both sides), persisted per
 *   (window, shape) ON RELEASE ONLY. Tiles stay live mid-drag — no
 *   suspension/unmount (the board pane-resize bug class); tile content gets
 *   `pointer-events: none` so iframes cannot swallow pointermove (the
 *   RightPanel drag-handle pattern). The chrome is the gap-seam three-state
 *   treatment (`rk-divider`/`rk-sash`/`rk-grips` in globals.css): 3 rest grip
 *   dots, a rounded accent-green sash pill on hover (~150ms anti-flicker
 *   delay) and drag (immediate), on a 14px hit zone. In `main-*` shapes a
 *   `surface-divider-intersection` zone at the T-junction lights BOTH sashes
 *   on hover and drags BOTH ratios at once (pointer x/y → the shape's two
 *   ratio indices, each clamped independently).
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
  /** Follow-the-editor passthrough (260813-if5d R3): handed straight to the code
   *  tile's `CodeSurface`, which reports the folder the EDITOR navigated itself
   *  to. The parent latches it — this component only carries the prop. */
  onCodeFolderNavigated?: (folder: string) => void;
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** The web tile's `>_` affordance — "switch to terminal" (single:tty). */
  onSwitchToTty: () => void;
  /** Verb callbacks — the parent applies the pure mutation + persistence +
   *  URL mirroring (R3 write discipline). */
  onPromote: (surface: SurfaceKind) => void;
  onSwap: (surface: SurfaceKind) => void;
  onClose: (surface: SurfaceKind) => void;
  /** Pane-segment callbacks (260813-w1lf content verbs — tty tiles only):
   *  the parent routes these through its `executeSplit`/`executeClosePane`
   *  optimistic actions (the palette split/close path). Both required for
   *  the segment to render. */
  onSplitPane?: (horizontal: boolean) => void;
  onClosePane?: () => void;
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
  /** Focused-tile reporting (260812-wfic R2): fired with the focused slot's
   *  KIND whenever it changes (default slot A). Arity-1 still reports — the
   *  shell's `ttyOnly` shortcut gate treats `single:tty` as tty-focused. */
  onFocusedKindChange?: (kind: SurfaceKind) => void;
  /** `Layout: Focus <Surface>` palette seam (260812-wfic R10): the component
   *  registers a focus-by-kind setter here (the FIRST slot of that kind),
   *  cleared on unmount — the `zoomToggleRef` pattern. */
  focusTileRef?: React.MutableRefObject<((kind: SurfaceKind) => void) | null>;
  /** The SSE `WindowInfo` for the tty header's status dot (260812-wfic R6).
   *  The FULL record because `StatusDot` consumes `WindowInfo` — the `window`
   *  prop stays the pure-lib narrow `ViewWindow`. Null/non-tty → no dot. */
  statusWindow?: WindowInfo | null;
  /** In-tile compose-strip dock (260813-j3jb): an opaque node the parent
   *  (app.tsx) hands over when the strip belongs INSIDE the tile — the
   *  desktop terminal route's single-send mode. Rendered as the last child of
   *  the FIRST tty tile's flex column (below the terminal body, inside the
   *  frame), so the target is self-evident and zoom/hide/close carries the
   *  strip for free; the flex column shrinks the terminal body, and the
   *  existing ResizeObserver fit refits — no new resize plumbing. The parent
   *  owns the whole dock decision (broadcast/board/mobile/no-tty → the shell
   *  footer instead); this component stays presentational and knows nothing
   *  about the strip. */
  ttyDockContent?: React.ReactNode;
}

/** Equal-split default ratios (cumulative boundary percentages): arity 2 →
 *  [50]; arity 3 → [33.3…, 66.6…]. */
function defaultRatios(arity: 1 | 2 | 3): LayoutRatios {
  if (arity === 1) return [];
  if (arity === 2) return [50];
  return [100 / 3, 200 / 3];
}

/** Verb button chrome (260812-wfic R4): fixed-size boxed buttons — 22×22,
 *  26×26 on coarse pointers (the `TOP_BAR_BUTTON*` fixed-size precedent:
 *  rendered size must not drift with content) — VISIBLE AT REST at ~65%
 *  opacity (the retired hover-cluster pattern had zero discoverability),
 *  hover giving an inset background + full opacity. Touch pointers keep the
 *  always-full-opacity rule (no hover to reveal them). */
const VERB_BUTTON_CLASS =
  "inline-flex items-center justify-center h-[22px] w-[22px] coarse:h-[26px] coarse:w-[26px] rounded opacity-65 coarse:opacity-100 hover:opacity-100 focus-visible:opacity-100 hover:bg-bg-inset transition-opacity";

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

/** Clamp one boundary's raw drag percentage: the 280px floor both sides
 *  (`clampRatio`) AND the neighboring boundaries — a divider adjusts only its
 *  own boundary and may never cross (or strand) its siblings. Shared by the
 *  single-axis divider drag and the intersection's two-axis drag (each axis
 *  clamps independently against the PRE-move ratios). */
function clampBoundary(
  cur: LayoutRatios,
  index: number,
  rawPct: number,
  sizePx: number,
): number {
  const floorPct = (MIN_PANEL_WIDTH_PX / sizePx) * 100;
  const prev = index === 0 ? 0 : cur[index - 1];
  const next = index === cur.length - 1 ? 100 : cur[index + 1];
  return Math.min(
    Math.max(clampRatio(rawPct, sizePx), prev + floorPct),
    Math.max(next - floorPct, prev + floorPct),
  );
}

/** The T-junction point of a `main-*` shape, derived from the divider
 *  geometry (single-sourced — the junction is where the two boundaries
 *  cross): the x-divider's boundary × the y-divider's boundary. Shapes with
 *  fewer than two dividers (single/split-*) or two PARALLEL dividers
 *  (row/col) have no junction. */
function junctionPoint(specs: DividerSpec[]): { left: string; top: string } | null {
  if (specs.length !== 2) return null;
  const xSpec = specs.find((s) => s.axis === "x");
  const ySpec = specs.find((s) => s.axis === "y");
  if (!xSpec || !ySpec) return null;
  const left = xSpec.style.left;
  const top = ySpec.style.top;
  if (typeof left !== "string" || typeof top !== "string") return null;
  return { left, top };
}

/** The intersection zone's two-axis mapping (`main-*` shapes only): which
 *  pointer axis drives which ratio index. main-left/right: x → ratio 0 (the
 *  A|(B,C) column boundary), y → ratio 1 (the B/C row boundary); main-top:
 *  y → ratio 0 (the A|(B,C) row boundary), x → ratio 1. */
function intersectionAxes(shape: LayoutShape): { xIndex: number; yIndex: number } | null {
  switch (shape) {
    case "main-left":
    case "main-right":
      return { xIndex: 0, yIndex: 1 };
    case "main-top":
      return { xIndex: 1, yIndex: 0 };
    default:
      return null;
  }
}

/** Small header meta (R7): the code folder's basename for code, the `@rk_url`
 *  host for web. Anything unparseable degrades to no meta. `gitRoot` arrives
 *  LATCHED (260813-if5d), so the header names the folder the editor is actually
 *  in — never the pane the terminal happens to sit in. */
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
  onCodeFolderNavigated,
  shouldReclaimChord,
  onSwitchToTty,
  onPromote,
  onSwap,
  onClose,
  onSplitPane,
  onClosePane,
  onRatioChange,
  onRatioCommit,
  zoomToggleRef,
  onZoomChange,
  onFocusedKindChange,
  focusTileRef,
  statusWindow,
  ttyDockContent,
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

  // Focused tile (260812-wfic R2) — transient, like zoom: the slot that last
  // received pointer/keyboard interaction. Default slot A; falls back to slot
  // A when the focused slot leaves the layout (a close collapsed the arity).
  // The per-window reset comes free from the parent's `${server}:${windowId}`
  // key (the zoom precedent).
  const [focusedSlot, setFocusedSlot] = useState(0);
  useEffect(() => {
    setFocusedSlot((s) => (s >= layout.order.length ? 0 : s));
  }, [layout.order.length]);
  // Render-time clamp mirrors the ratio fallback: the clearing effect lands a
  // beat after the render carrying the shrunken order.
  const focusedKind = layout.order[Math.min(focusedSlot, layout.order.length - 1)];
  // Interaction seams report SYNCHRONOUSLY (`focusSlot` below): the shell's
  // `ttyOnly` chord gate consumes the reported kind, and discrete-event
  // flushing guarantees the dispatcher's handler map reflects the click
  // before the next keydown — reporting only via this effect would leave a
  // two-render gap where the accent border shows but the chord still fires.
  // The effect remains for the non-interaction transitions: the slot-A
  // default on mount and the fallback when the focused slot leaves. The ref
  // dedupes the two seams — a sync interaction report and the effect firing
  // after the same state update hand up the kind exactly once.
  const lastReportedKindRef = useRef<SurfaceKind | null>(null);
  const reportFocusedKind = useCallback(
    (kind: SurfaceKind) => {
      if (kind === lastReportedKindRef.current) return;
      lastReportedKindRef.current = kind;
      onFocusedKindChange?.(kind);
    },
    [onFocusedKindChange],
  );
  const focusSlot = (slot: number) => {
    setFocusedSlot(slot);
    const kind = layout.order[slot];
    if (kind) reportFocusedKind(kind);
  };
  useEffect(() => {
    if (focusedKind) reportFocusedKind(focusedKind);
  }, [focusedKind, reportFocusedKind]);

  // Palette focus seam (R10): `Layout: Focus <Surface>` routes through this
  // ref — focus the FIRST slot of the given kind (duplicate tty tiles: slot A
  // wins). No-op for a kind that is not open.
  useEffect(() => {
    if (!focusTileRef) return;
    focusTileRef.current = (kind: SurfaceKind) => {
      const slot = layout.order.indexOf(kind);
      if (slot >= 0) focusSlot(slot);
    };
    return () => {
      focusTileRef.current = null;
    };
  }, [focusTileRef, layout.order]);

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

  // Divider drag (R5) — the RightPanel drag-handle pattern, hardened: pointer
  // capture on the handle starts the drag, but mid-drag move/release/cancel
  // are handled by WINDOW-level listeners (the effects below), not the
  // handle's own events — engines can drop element pointer capture while the
  // pointer crosses iframe content (observed on macOS Safari: the seam stops
  // following an up-drag over the web tile), and a window listener still
  // hears every event the parent document gets. Tile content gets
  // `pointer-events: none` mid-drag so iframes can't become the target and
  // steal events into their own document. Tiles stay MOUNTED AND LIVE the
  // whole time (the board pane-resize bug class — no suspension).
  const gridRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragRef = useRef<{
    index: number;
    axis: "x" | "y";
    el: HTMLElement;
    pointerId: number;
  } | null>(null);

  const onDividerPointerDown =
    (spec: DividerSpec) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        index: spec.index,
        axis: spec.axis,
        el: e.currentTarget,
        pointerId: e.pointerId,
      };
      setDraggingIndex(spec.index);
    };

  const onDividerPointerMove = (e: { clientX: number; clientY: number }) => {
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
    const cur = ratiosRef.current;
    const pct = clampBoundary(cur, drag.index, rawPct, sizePx);
    const nextRatios = [...cur];
    nextRatios[drag.index] = pct;
    setRatios(nextRatios);
    onRatioChange?.(drag.index, pct);
  };

  const endDividerDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    // `pointercancel` has already released the capture implicitly — releasing
    // again throws NotFoundError (the RightPanel endDrag lesson).
    if (drag.el.hasPointerCapture(drag.pointerId)) {
      drag.el.releasePointerCapture(drag.pointerId);
    }
    setDraggingIndex(null);
    writeStoredRatios(server, windowId, layout.shape, ratiosRef.current);
    onRatioCommit?.();
  };

  // Latest-closure refs for the window listeners: the effects key on the
  // dragging FLAG only, so without these they would hold the closures from
  // the render the drag started in (stale ratios are already avoided via
  // ratiosRef, but writeStoredRatios reads server/windowId/shape props).
  const dividerMoveRef = useRef(onDividerPointerMove);
  dividerMoveRef.current = onDividerPointerMove;
  const dividerEndRef = useRef(endDividerDrag);
  dividerEndRef.current = endDividerDrag;

  useEffect(() => {
    if (draggingIndex === null) return;
    // Window listeners hear EVERY pointer — gate on the captured pointerId so
    // a second touch/pen pointer can't move the seam or end the drag.
    const move = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return;
      dividerMoveRef.current(e);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return;
      dividerEndRef.current();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [draggingIndex]);

  // Intersection zone (260814-011r R3) — the main-* T-junction's two-axis
  // handle: a ~20px zone centered where the two dividers cross, z-ordered
  // above them so it wins the junction hit-test. Hover lights BOTH sashes
  // (`intersectionHot` → `rk-sash-lit` on both dividers); drag moves BOTH
  // ratios at once (pointer x/y → the shape's two ratio indices, each
  // clamped independently by the shared per-boundary clamp), persisted on
  // release via the same writeStoredRatios path. Own pointer handlers — the
  // single-axis machinery above stays untouched — but the same window-level
  // mid-drag routing (and for the same reason).
  const [intersectionHot, setIntersectionHot] = useState(false);
  const [draggingIntersection, setDraggingIntersection] = useState(false);
  const intersectionDragRef = useRef<{
    xIndex: number;
    yIndex: number;
    el: HTMLElement;
    pointerId: number;
  } | null>(null);

  const onIntersectionPointerDown =
    (axes: { xIndex: number; yIndex: number }) =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      intersectionDragRef.current = {
        ...axes,
        el: e.currentTarget,
        pointerId: e.pointerId,
      };
      setDraggingIntersection(true);
    };

  const onIntersectionPointerMove = (e: { clientX: number; clientY: number }) => {
    const axes = intersectionDragRef.current;
    const grid = gridRef.current;
    if (!axes || !grid) return;
    const rect = grid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return; // unmeasured (jsdom)
    const cur = ratiosRef.current;
    const nextRatios = [...cur];
    nextRatios[axes.xIndex] = clampBoundary(
      cur,
      axes.xIndex,
      ((e.clientX - rect.left) / rect.width) * 100,
      rect.width,
    );
    nextRatios[axes.yIndex] = clampBoundary(
      cur,
      axes.yIndex,
      ((e.clientY - rect.top) / rect.height) * 100,
      rect.height,
    );
    setRatios(nextRatios);
    onRatioChange?.(axes.xIndex, nextRatios[axes.xIndex]);
    onRatioChange?.(axes.yIndex, nextRatios[axes.yIndex]);
  };

  const endIntersectionDrag = (e: { clientX: number; clientY: number }) => {
    const drag = intersectionDragRef.current;
    if (!drag) return;
    intersectionDragRef.current = null;
    // Same pointercancel double-release guard as endDividerDrag.
    if (drag.el.hasPointerCapture(drag.pointerId)) {
      drag.el.releasePointerCapture(drag.pointerId);
    }
    // Capture suppresses the zone's enter/leave for the whole drag, so
    // `intersectionHot` cannot be trusted at release: a drag that clamped
    // (junction stops following the pointer) ends with the pointer off the
    // junction and would strand BOTH sashes hot. Recompute from the release
    // point — an unmeasured rect (jsdom) has no geometry to test.
    const zone = drag.el.getBoundingClientRect();
    if (zone.width > 0 && zone.height > 0) {
      setIntersectionHot(
        e.clientX >= zone.left &&
          e.clientX <= zone.right &&
          e.clientY >= zone.top &&
          e.clientY <= zone.bottom,
      );
    }
    setDraggingIntersection(false);
    writeStoredRatios(server, windowId, layout.shape, ratiosRef.current);
    onRatioCommit?.();
  };

  // Same latest-closure refs + window routing as the single-axis drag.
  const intersectionMoveRef = useRef(onIntersectionPointerMove);
  intersectionMoveRef.current = onIntersectionPointerMove;
  const intersectionEndRef = useRef(endIntersectionDrag);
  intersectionEndRef.current = endIntersectionDrag;

  useEffect(() => {
    if (!draggingIntersection) return;
    // Same captured-pointerId gate as the single-axis drag effect.
    const move = (e: PointerEvent) => {
      if (e.pointerId !== intersectionDragRef.current?.pointerId) return;
      intersectionMoveRef.current(e);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== intersectionDragRef.current?.pointerId) return;
      intersectionEndRef.current(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [draggingIntersection]);

  /** A tile's renderer, unchanged from the legacy lens/panel mounts. The code
   *  tile also wires the focus seam (260812-wfic R2): `CodeSurface`'s
   *  contentDocument listeners report editor interaction via `onInteract`, so
   *  typing/clicking INSIDE the iframe counts as tile focus (the iframe
   *  element's own focusin covers the click-to-focus case; keydowns never
   *  reach the parent without this). */
  const renderContent = (kind: SurfaceKind, slot: number, primaryTty: boolean) => {
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
        // `win.gitRoot` is the window's LATCHED code folder (260813-if5d — the
        // parent substitutes it), so a pane switch can neither null this tile
        // nor retarget the editor; the live derivation only ever seeded it.
        return win?.gitRoot ? (
          <CodeSurface
            gitRoot={win.gitRoot}
            reachable={codeReachable}
            shouldReclaimChord={shouldReclaimChord}
            onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}
            onFolderNavigated={onCodeFolderNavigated}
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
    // Focused-tile highlight (260812-wfic R2): accent-green border + kind
    // glyph, suppressed at arity 1 (no verbs, no highlight — the tmux
    // active-pane metaphor). Focus assignment: pointerdown (capture) anywhere
    // in the tile + focusin on the tile (clicking into the code iframe
    // focuses the iframe element in the parent document); the code tile's
    // in-document interaction arrives via CodeSurface's `onInteract`.
    const isFocused = !mobile && arity > 1 && slot >= 0 && slot === focusedSlot;
    return (
      <div
        key={`${kind}${suffix}`}
        data-testid={testId}
        // Mobile tiles MUST carry flex-1: the single visible slot fills the
        // column. Without it the tile is content-sized — xterm's own canvas
        // becomes the measure, a stable fixed point (canvas sizes tile sizes
        // fit sizes canvas) that pins the terminal at its 80×24 default and
        // makes it deaf to every viewport change (iOS keyboard collapse).
        // Desktop tiles are sized by the grid via slotStyle instead.
        className={`group min-w-0 min-h-0 flex-col overflow-hidden ${hidden ? "hidden" : "flex"}${
          mobile
            ? " flex-1"
            : // Gap-seam card (260814-011r R1): 6px radius; the REST border is
              // the dimmed 55% `rk-card-border` (the gap separates, the border
              // defines the card edge) — the focused tile keeps the full
              // accent-green frame (260812-wfic R2, suppressed at arity 1).
              ` border rounded-md ${isFocused ? "border-accent-green" : "rk-card-border"}`
        }`}
        style={hidden || mobile ? undefined : slotStyle(layout.shape, slot, zoomed)}
        onPointerDownCapture={slot >= 0 ? () => focusSlot(slot) : undefined}
        onFocus={slot >= 0 ? () => focusSlot(slot) : undefined}
      >
        {/* Header px-1.5: the rail divider is a MINOR seam with ~6px air on
            both sides (the rail's chips hug it at the same distance on their
            side) — only the window edge carries the 12px major-seam inset. */}
        {!mobile && (
          <div className="flex items-center gap-1.5 px-1.5 h-[30px] shrink-0 border-b border-border bg-bg-card font-mono text-[11px] text-text-secondary select-none">
            {kind === "tty" && statusWindow && <StatusDot win={statusWindow} />}
            <span
              aria-hidden="true"
              className={`shrink-0 ${isFocused ? "text-accent-green" : ""}`}
            >
              {SURFACE_GLYPH[kind]}
            </span>
            <span className="shrink-0 text-text-primary">{label}</span>
            {meta && (
              <span className="min-w-0 truncate rounded bg-bg-inset px-1.5 text-[10px] text-text-secondary">
                {meta}
              </span>
            )}
            <span className="flex-1" />
            {/* Pane segment (260813-w1lf content verbs): tty tiles carry a
                bordered group of PANE verbs — Split H · Split V · Close Pane —
                at ANY arity (including `single:tty`, which renders no layout
                verbs), visible while zoomed. A hairline separates it from the
                layout-verb cluster when that renders (arity > 1). */}
            {!mobile && kind === "tty" && slot >= 0 && onSplitPane && onClosePane && (
              <>
                <div
                  data-testid="pane-segment"
                  className="inline-flex items-center h-6 rounded border border-border"
                >
                  <Tip label="Split pane horizontally">
                    <button
                      type="button"
                      aria-label="Split pane horizontally"
                      onClick={() => onSplitPane(true)}
                      className={`${VERB_BUTTON_CLASS} hover:text-text-primary`}
                    >
                      <SplitHorizontalGlyph />
                    </button>
                  </Tip>
                  <Tip label="Split pane vertically">
                    <button
                      type="button"
                      aria-label="Split pane vertically"
                      onClick={() => onSplitPane(false)}
                      className={`${VERB_BUTTON_CLASS} hover:text-text-primary`}
                    >
                      <SplitVerticalGlyph />
                    </button>
                  </Tip>
                  <Tip label="Close pane — kills the tmux pane">
                    <button
                      type="button"
                      aria-label="Close pane"
                      onClick={() => onClosePane()}
                      className={`${VERB_BUTTON_CLASS} hover:text-signal-red`}
                    >
                      <ClosePaneBoxedGlyph />
                    </button>
                  </Tip>
                </div>
                {showVerbs && (
                  <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />
                )}
              </>
            )}
            {showVerbs && (
              <>
                <Tip label={isZoomed ? `Unzoom ${label}` : `Zoom ${label}`}>
                  <button
                    type="button"
                    aria-label={isZoomed ? `Unzoom ${label}` : `Zoom ${label}`}
                    onClick={() => setZoomedIndex(isZoomed ? null : slot)}
                    className={`${VERB_BUTTON_CLASS} hover:text-text-primary${
                      isZoomed ? " text-accent-green opacity-100" : ""
                    }`}
                  >
                    ⛶
                  </button>
                </Tip>
                {/* Promote/swap are no-ops on a zoomed render — hidden while
                    this tile is zoomed (R5 feedback; ✕ stays). */}
                {!isZoomed && (
                  <>
                    <Tip label={`Promote ${label}`}>
                      <button
                        type="button"
                        aria-label={`Promote ${label}`}
                        onClick={() => onPromote(kind)}
                        className={`${VERB_BUTTON_CLASS} hover:text-text-primary`}
                      >
                        ◧
                      </button>
                    </Tip>
                    <Tip label={`Swap ${label}`}>
                      <button
                        type="button"
                        aria-label={`Swap ${label}`}
                        onClick={() => onSwap(kind)}
                        className={`${VERB_BUTTON_CLASS} hover:text-text-primary`}
                      >
                        ⇄
                      </button>
                    </Tip>
                  </>
                )}
                {/* A 1px hairline separates the destructive ✕ from the safe
                    verbs; its hover turns signal-red. */}
                <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />
                <Tip label={`Close ${label}`}>
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    onClick={() => onClose(kind)}
                    className={`${VERB_BUTTON_CLASS} hover:text-signal-red`}
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
          // (the drag would stall at the iframe boundary). Applies to both
          // drag kinds — single-axis divider and the two-axis intersection.
          className={`flex-1 min-h-0 flex flex-col ${draggingIndex !== null || draggingIntersection ? "pointer-events-none" : ""}`}
        >
          {renderContent(kind, slot, slot === firstTtySlot)}
          {/* In-tile compose-strip dock (260813-j3jb): desktop only, first
              tty tile only — the strip sits below the terminal body, inside
              the tile frame. */}
          {!mobile && slot === firstTtySlot ? ttyDockContent : null}
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
  const specs = dividerSpecs(layout.shape, effRatios);
  // The main-* T-junction: geometry single-sourced from the divider specs,
  // the axis mapping from the shape. Null everywhere else (single/split-*/
  // row/col), so the zone renders exactly when a junction exists.
  const junction = junctionPoint(specs);
  const axes = intersectionAxes(layout.shape);
  return (
    <div
      ref={gridRef}
      data-testid="surface-layout"
      // Gap-seam grid (260814-011r R1, was the 260812-wfic 3px framed grid):
      // the 6px gutter + 6px ground inset float the tiles as separate cards on
      // the inset ground — the GAP is the separation, so the tile borders dim
      // (rk-card-border). The absolutely-positioned dividers keep their
      // ratio-boundary placement; their 14px hit zones cover the 6px gutter
      // plus slop, so drag mechanics are unchanged.
      className="relative flex-1 min-h-0 min-w-0 grid gap-[6px] p-[6px] bg-bg-inset"
      style={gridStyle(layout.shape, effRatios, zoomed)}
    >
      {allTiles.map(({ tile, hidden }) => renderTile(tile, hidden, false))}
      {!zoomed &&
        specs.map((spec) => (
          <div
            key={spec.index}
            role="separator"
            aria-orientation={spec.axis === "x" ? "vertical" : "horizontal"}
            aria-label="Resize tiles"
            aria-valuenow={Math.round(effRatios[spec.index])}
            data-testid={`surface-divider-${spec.index}`}
            // Move/up/cancel are window-level while dragging (see the drag
            // effect) — only the drag START binds here.
            onPointerDown={onDividerPointerDown(spec)}
            // rk-divider + the gap-seam children (rk-sash pill, rk-grips dots)
            // carry the rest/hover/drag treatment — see globals.css.
            // `rk-sash-lit` = the zero-delay JS-lit state (this divider
            // mid-drag, or EITHER divider while the intersection zone is
            // dragged); `rk-sash-hot` = the intersection-HOVER state — both
            // sashes light together with the same 150ms anti-flicker delay as
            // a direct seam hover.
            className={`rk-divider absolute z-10 ${
              spec.axis === "x"
                ? "w-3.5 -translate-x-1/2 cursor-col-resize"
                : "h-3.5 -translate-y-1/2 cursor-row-resize"
            } ${
              draggingIndex === spec.index || draggingIntersection
                ? "rk-sash-lit"
                : intersectionHot
                  ? "rk-sash-hot"
                  : ""
            }`}
            style={{ ...spec.style, touchAction: "none" }}
          >
            <span
              aria-hidden="true"
              className={`rk-sash pointer-events-none ${spec.axis === "x" ? "rk-sash-v" : "rk-sash-h"}`}
            />
            <span
              aria-hidden="true"
              className={`rk-grips pointer-events-none ${spec.axis === "x" ? "rk-grips-v" : "rk-grips-h"}`}
            >
              <i />
              <i />
              <i />
            </span>
          </div>
        ))}
      {/* Intersection zone (260814-011r R3): the ~20px two-axis handle at the
          main-* T-junction, z-20 so it wins the hit-test over both dividers.
          Desktop-only by branch, never zoomed, main-* only (junction/axes are
          null elsewhere). */}
      {!zoomed && junction && axes && (
        <div
          data-testid="surface-divider-intersection"
          aria-label="Resize tiles (both directions)"
          onPointerDown={onIntersectionPointerDown(axes)}
          onPointerEnter={() => setIntersectionHot(true)}
          onPointerLeave={() => setIntersectionHot(false)}
          className="absolute z-20 w-5 h-5 -translate-x-1/2 -translate-y-1/2 cursor-move"
          style={{ left: junction.left, top: junction.top, touchAction: "none" }}
        />
      )}
    </div>
  );
}
