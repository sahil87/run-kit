import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  arrow,
  FloatingArrow,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
  safePolygon,
  autoUpdate,
} from "@floating-ui/react";
import { statusDotState } from "@/components/pr-status-model";
import { dotLabel } from "@/components/status-dot-label";
import { PinIcon } from "@/components/pin-icon";
import { CloseIcon, PaletteIcon } from "./icons";
import { getOutputLine, getAgentLine, getFabLine, getPrSegments } from "./registers";
import { PopupTitleBar, PopupTitleBarSecondary, notchFill } from "./popup-title-bar";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import type { WindowInfo } from "@/types";

/**
 * Row-hover register flyout card (93dy) — the sidebar's tier-2 hover-card and
 * the app's one status-detail hover surface. ONE shared card shell serves all
 * three rail-bearing row tiers (260817-ve5m): the WINDOW card opens on
 * fine-pointer WHOLE-ROW hover, keyboard row focus (the roving-tabindex
 * treeitem — Constitution V), and the coarse rail/dot tap; the SESSION and
 * SERVER cards are coarse-only surfaces (desktop keeps the identity tips +
 * hover clusters) whose sole trigger is the rail tap/scrub (`openNow`).
 *
 * Placement is pointer-conditional inside the one hook: on FINE pointers the
 * window card anchors to the ROW element with `placement: "right"` +
 * `FloatingPortal`, so its x-position is FIXED at the sidebar's right edge
 * and only its y tracks the hovered row — no mouse-following jitter; on
 * COARSE pointers (and always for the coarse-only tiers) it anchors BELOW the
 * row (`bottom-start`, `top-start` fallback) with its width capped short of
 * the row's 56px status rail, so the finger's column stays visible mid-scrub.
 * The window card's content is the
 * full four-register view (`out`/`agt`/`fab`/`pr`) promoted from the PANE
 * panel, resolved by the SHARED helpers in ./registers.ts (one source, no
 * drift), plus the identity title bar (`Window @N · pane %N · N panes` — the
 * shared `PopupTitleBar` chrome, carrying only the ⓘ docs affordance on its
 * right edge), the demoted dot-label body line, the "checked Xs ago" freshness
 * line, the "Open PR #N ↗" link, and the sectioned action rows (change color /
 * fork / pin / kill with sub-hints — one home per action, both pointer
 * worlds). Session/server cards carry the same chrome with their own title,
 * one facts line, and their own action rows. Registers are read-only text;
 * the PR/docs links and the action rows are the card's only interactive
 * elements.
 *
 * PERF (ui-patterns § Render Performance — hard constraints): everything here
 * is row-local. The open state lives inside the consuming `WindowRow` via
 * `useRowFlyout` (never lifted to `Sidebar`), the card body mounts ONLY while
 * open, and both live clocks (`useNow` for the `out` register + the freshness
 * line) are leaf-scoped inside that open card — the row itself never ticks.
 * The title bar is STATIC text derived from the already-passed `win` — it
 * adds no clock, subscription, or lifted state.
 */

/** Hover open delay outside a warm window (mirrors Tip's 300ms, tuned +50ms —
 *  the card is heavier than a tier-1 tip, so it should not flash on drive-by
 *  pointer sweeps). */
export const FLYOUT_OPEN_DELAY_MS = 350;

/** Width of the coarse-pointer status rail (rendered by every rail-bearing
 *  row tier — window-row.tsx, session-row.tsx, index.tsx ServerGroup). The
 *  coarse card's max-width is capped at row-width minus this (plus a gap) so
 *  the card never covers the rail — the finger's column stays visible and
 *  touchable mid-scrub. The window row's `coarse:pr-[56px]` padding reserve
 *  (and the session/server equivalents) is the SAME value as a literal class
 *  (Tailwind scans literals only). */
export const STATUS_RAIL_WIDTH_PX = 56;
/** How long the flyout cluster stays "warm" (instant retarget) after the last
 *  card closes — the same 500ms window `TipGroup` uses. */
export const FLYOUT_WARM_WINDOW_MS = 500;

/**
 * Status-dot docs page (rendered by GitHub). Opens in a new tab from the
 * card's docs icon — the canonical "what does this dot mean" reference.
 * docs/site is NOT served by the backend, so we link the GitHub blob (no
 * anchor → lands at the top of the doc), matching the convention the only
 * other in-app docs link uses (global-chrome.tsx NOTIFICATIONS_HELP_URL).
 * (Migrated verbatim from the retired status-dot-tip.tsx.)
 */
export const STATUS_DOT_DOCS_URL =
  "https://github.com/sahil87/run-kit/blob/main/docs/site/status-dot.md";

// ── Shared warm-window / single-open coordination ──────────────────────────
//
// The flyout's own delay-group scope — a SIBLING mechanism to `TipGroup`, kept
// deliberately OUT of React context: `useDelayGroup` binds to the nearest
// `FloatingDelayGroup`, and the sessions tree renders tier-1 `Tip`s (session
// rows) inside the same subtree, so a nested provider would capture those tips
// and mix tier-1/tier-2 warmth. Module state spans every window row (they all
// import this module) and floating-ui's function-form `delay` option is
// evaluated at EVENT time, so warmth is always current without re-renders.

/** The currently open flyout's closer (also the "something is open" signal). */
let activeFlyout: { close: () => void } | null = null;
/** Epoch ms of the last flyout close — drives the warm window. */
let lastClosedAt = 0;
/** True while a rail scrub gesture is in flight. Pointer capture retargets
 *  (and refires) boundary events onto the captured row's ancestor chain, so a
 *  mid-scrub `mouseenter` on the SOURCE row would otherwise hover-open its
 *  card back over the scrub's retarget — hover/focus opens are blocked while
 *  this holds (the scrub's own `openNow` calls carry no reason and pass). */
let scrubActive = false;

/** Warm = another card is open right now, or one closed <500ms ago. */
function flyoutIsWarm(): boolean {
  return activeFlyout !== null || Date.now() - lastClosedAt < FLYOUT_WARM_WINDOW_MS;
}

/** Event-time delay resolver handed to `useHover` (function form — evaluated
 *  per interaction, so a warm state set by ANOTHER row is seen immediately). */
export function flyoutOpenDelay(): { open: number; close: number } {
  return { open: flyoutIsWarm() ? 0 : FLYOUT_OPEN_DELAY_MS, close: 0 };
}

/** Test seam: reset the module-scoped warm/single-open state between tests. */
export function resetFlyoutWarmState(): void {
  activeFlyout = null;
  lastClosedAt = 0;
  scrubActive = false;
  flyoutScrubTargets.clear();
}

// ── Scrub registry ─────────────────────────────────────────────────────────
// Slide-to-scrub (coarse pointers): the row's tap-zone gesture hit-tests the
// finger position and retargets the single-open card across rows — ACROSS
// TIERS (window, session, server-group rows all register here). Element-
// keyed module state beside the warm/single-open coordinator — no context, no
// lifted state, no re-renders (the § Render Performance constraints).

/** Row root element → that row's imperative open, for scrub retargeting. */
const flyoutScrubTargets = new Map<HTMLElement, () => void>();

/** The ONE hit-test selector for rail-bearing row roots. The three tiers have
 *  three DOM shapes (window rows are `treeitem` + `data-window-id`, session
 *  rows `treeitem` + `data-session-row`, server-group headers not treeitems at
 *  all), so a shared data attribute is the only shape covering all three — and
 *  BOTH gesture ends (each tier's scrub start-handler `closest` inside
 *  `useRailScrub`, and `scrubTargetAt` below) select on it IDENTICALLY by
 *  construction. */
export const RAIL_ROW_SELECTOR = "[data-rail-row]";

/** Hit-test a scrub position: the registered rail row under the point plus
 *  its imperative open, or null over non-row elements (gaps, the open card
 *  itself) and rows without a registered flyout — the caller leaves the
 *  current card open on null (no flicker-close). */
export function scrubTargetAt(
  clientX: number,
  clientY: number,
): { row: HTMLElement; open: () => void } | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const row = hit?.closest<HTMLElement>(RAIL_ROW_SELECTOR) ?? null;
  if (!row) return null;
  const open = flyoutScrubTargets.get(row);
  return open ? { row, open } : null;
}

/**
 * The slide-to-scrub gesture (coarse pointers), shared by every rail-bearing
 * row tier so the trio lives in exactly one place: the target's pointerdown
 * stops propagation, opens this row's card via `openNow`, and captures the
 * pointer; while captured, pointermove hit-tests the finger position via
 * `scrubTargetAt` and retargets the single-open card across rows AND tiers;
 * pointerup/pointercancel releases the capture and the last card STAYS open
 * (dismissal is the existing `useDismiss` outside-press). The scrub NEVER
 * selects, navigates, or toggles a row. Spread `handlers` onto a tier's rail
 * element (and the window row's secondary dot tap zone); `touch-action: none`
 * on the target keeps a press-and-slide from scrolling the drawer.
 */
export function useRailScrub(openNow: () => void) {
  const activeRef = useRef(false);
  const rowRef = useRef<HTMLElement | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.stopPropagation();
      activeRef.current = true;
      // Blocks hover/focus opens mid-scrub: pointer capture refires boundary
      // events on the captured row's chain, and a stray `mouseenter` there
      // must not steal the card back from the scrub's retarget.
      scrubActive = true;
      rowRef.current = e.currentTarget.closest(RAIL_ROW_SELECTOR);
      openNow();
      // jsdom lacks the pointer-capture APIs — optional-call so unit tests can
      // drive the gesture without stubbing them.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [openNow],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!activeRef.current) return;
    const target = scrubTargetAt(e.clientX, e.clientY);
    // Non-row elements under the finger leave the current card open — no
    // flicker-close.
    if (!target || target.row === rowRef.current) return;
    rowRef.current = target.row;
    target.open();
  }, []);
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    rowRef.current = null;
    scrubActive = false;
    // hasPointerCapture guard (as in surface-layout.tsx): release throws
    // NotFoundError when the capture was never taken or was already released
    // implicitly (pointercancel). Optional-call keeps jsdom unit tests working.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // An unmount mid-scrub (SSE churn) must not leak the in-flight flag.
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        activeRef.current = false;
        rowRef.current = null;
        scrubActive = false;
      }
    };
  }, []);

  return {
    /** True while a scrub gesture is in flight — a draggable row's drag-start
     *  handler reads it so an active touch scrub never escalates into an
     *  HTML5 row drag. */
    scrubActiveRef: activeRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

// ── Rail band tints (held highlight + per-tier bands) ──────────────────────
// One shade-derivation idiom for every tier's rail: the inset base mixed with
// the tier's own tint via `color-mix` (the window rail's shipped selected
// variant). No new color tokens.

/** Rest-state rail band for a tinted tier: the inset base mixed with the
 *  tier's rest tint (session `tint.base`, server header base/selected, the
 *  selected window row's selected shade). Untinted tiers keep the plain
 *  `bg-bg-inset` class and call this never. */
export function railRestBand(restTint: string): string {
  return `color-mix(in srgb, var(--color-bg-inset) 55%, ${restTint})`;
}

/** Held-rail band: while the row's card is open (tap-held or mid-scrub) the
 *  band steps up one shade — a deeper tint share of the tier's step-up shade
 *  (the hover tint, or the selected tint on an already-selected row). Keyed on
 *  the row-local flyout open state, so it travels row-to-row with the
 *  single-open card during a scrub. */
export function railHeldBand(stepUpTint: string): string {
  return `color-mix(in srgb, var(--color-bg-inset) 40%, ${stepUpTint})`;
}

/** The held rail's brightened seam — an existing token, brighter than
 *  `--color-border` (no new tokens). */
export const RAIL_HELD_SEAM = "var(--color-text-secondary)";

/**
 * Fork-conversation glyph — a git-fork shape (one trunk splitting into a branch
 * that rises to its own node). Same inline-SVG idiom and 12px box as `InfoIcon`
 * below, so the two header affordances read as one cluster.
 */
function ForkIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      className="shrink-0"
    >
      {/* Trunk (bottom node up to the split) + the branch curving to its own
          node at the top right. Node circles are stroked, matching InfoIcon. */}
      <circle cx="5" cy="13" r="1.6" />
      <circle cx="5" cy="3" r="1.6" />
      <circle cx="12" cy="3" r="1.6" />
      <line x1="5" y1="4.6" x2="5" y2="11.4" />
      <path d="M10.4 3H8.5A3.5 3.5 0 0 0 5 6.5V8" />
    </svg>
  );
}

/**
 * Circled-"i" info glyph for the docs affordance — an inline SVG (matching the
 * codebase's hand-built SVG icons) rather than a Nerd Font glyph, so it renders
 * crisply at any size, themes via `currentColor`, and doesn't depend on the
 * user's terminal font being patched. (Migrated from status-dot-tip.tsx.)
 */
function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7.25" x2="8" y2="11" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Parse `prFetchedAt` to epoch SECONDS; null when absent or unparseable
 *  (`Date.parse` → NaN) so the card omits the freshness line rather than
 *  rendering "checked NaNs ago". (Migrated from dotTipContent.) */
export function prFetchedAtEpoch(win: WindowInfo): number | null {
  const parsed = win.prFetchedAt ? Date.parse(win.prFetchedAt) : NaN;
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * Freshness line ("checked Xs ago"), its OWN component so its live `useNow()`
 * clock is scoped to the leaf that displays it (use-now.ts contract). Mounted
 * only inside the open card, so the 1/s re-render fires only while the card is
 * open. Returns null when there is no fetch timestamp. (Migrated verbatim from
 * status-dot-tip.tsx; only the testid is renamed to the flyout vocabulary.)
 */
export function FreshnessLine({ fetchedAtEpoch }: { fetchedAtEpoch: number | null }) {
  const nowSeconds = useNow();
  if (fetchedAtEpoch === null) return null;
  return (
    <span className="text-text-secondary whitespace-nowrap" data-testid="row-flyout-checked">
      {`checked ${formatDuration(nowSeconds - fetchedAtEpoch)} ago`}
    </span>
  );
}

/** One register line: fixed-width prefix + read-only content. The prefix
 *  column follows the PANE panel's 4-advance vocabulary (3-char key + space;
 *  `pr` is NBSP-padded to the same column). `min-w-0 truncate` matches the
 *  panel rows these registers were promoted from (status-panel.tsx) — long
 *  `fab`/`pr` text must ellipsize inside the `max-w-xs` card, never paint
 *  outside it. */
function RegisterLine({
  prefix,
  testid,
  children,
}: {
  prefix: string;
  testid: string;
  children: ReactNode;
}) {
  return (
    <span className="min-w-0 truncate" data-testid={testid}>
      <span className="text-text-secondary">{prefix}</span>
      {children}
    </span>
  );
}

/**
 * Provider whose conversations can be forked. The fork mechanism is Claude
 * Code's `--resume <id> --fork-session`, so the affordance is gated on the same
 * `chatProvider` field the chat lens gates on — no new data plumbing (the field
 * already rides `/api/sessions` + SSE).
 */
const FORKABLE_CHAT_PROVIDER = "claude";

/** Tooltip/aria copy for the fork affordance. Names the SAME-DIRECTORY semantics
 *  explicitly — that is what distinguishes a fork (branch this conversation
 *  here) from the spawn dialog (a fresh agent, usually in a new worktree). */
export const FORK_TOOLTIP = "Fork conversation — new window, same directory";

/** True when this window's conversation can be forked: it carries a reconciled
 *  claude chat identity. An equality guard, not a cast — a `codex` window and a
 *  plain shell pane both fall through to false. */
export function canForkWindow(win: WindowInfo): boolean {
  return win.chatProvider === FORKABLE_CHAT_PROVIDER;
}

/** Shared geometry for the card's sectioned action rows: full-bleed inside
 *  the action section (which carries the `-mx-2` counter-inset, so the top
 *  border + inter-row hairlines span edge to edge), one line tall — icon +
 *  label left, muted sub-hint right; ≥36px touch height on coarse, ~28px on
 *  fine pointers (the row-cluster touch-target convention). */
const ACTION_ROW_CLASS =
  "flex w-full items-center gap-1.5 min-w-0 px-2 text-left whitespace-nowrap min-h-[28px] coarse:min-h-[36px] text-text-secondary hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";

/** The muted per-action sub-hint riding the row's right edge. It is the row's
 *  FLEXIBLE part (`min-w-0 truncate`): inside the `max-w-xs` fine-pointer card
 *  a long hint ellipsizes instead of painting past the card box; the label
 *  (wrapped in a shrink-0 span at each call site) never truncates. */
const ACTION_ROW_HINT_CLASS = "ml-auto min-w-0 truncate pl-2 text-text-secondary opacity-60";

/** The card's sectioned action list — the `-mx-2` counter-inset (the title
 *  bar's idiom) lets the top border + inter-row hairlines span the card edge
 *  to edge. Shared by all three card tiers. */
export function CardActionList({ children }: { children: ReactNode }) {
  return (
    <div
      className="-mx-2 mt-0.5 border-t border-border divide-y divide-border"
      data-testid="row-flyout-actions"
    >
      {children}
    </div>
  );
}

/** One row in the card's action list — icon + label left, muted sub-hint
 *  right — shared by all three card tiers so the geometry lives in exactly
 *  one place. stopPropagation so an action never selects/toggles the
 *  underlying row (the PR/docs links' idiom). */
export function CardActionRow({
  icon,
  label,
  hint,
  danger = false,
  testid,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  /** Red hover treatment for destructive actions. */
  danger?: boolean;
  testid: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${ACTION_ROW_CLASS} ${danger ? "hover:text-signal-red" : "hover:text-text-primary"}`}
      data-testid={testid}
    >
      {icon}
      <span className="shrink-0">{label}</span>
      {hint && <span className={ACTION_ROW_HINT_CLASS}>{hint}</span>}
    </button>
  );
}

/**
 * The fork action row, with its own IN-FLIGHT state so the busy flag is
 * leaf-scoped (the card's render-performance discipline — only this row
 * re-renders while a fork is in flight).
 *
 * The guard is load-bearing, not cosmetic: `onFork` POSTs a mutating endpoint that
 * CREATES a tmux window, so N clicks would create N forks. Disabling until the
 * promise settles is the spawn dialog's `disabled={busy}` idiom; the busy state
 * clears on settle (success and error alike) so a failed fork stays retryable.
 */
function ForkActionRow({ onFork }: { onFork: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  // The card unmounts when the flyout closes (and a successful fork navigates
  // away), so a settle after unmount is a real possibility — guard the setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <button
      type="button"
      // stopPropagation so forking never also selects the underlying row (the
      // PR/docs links' idiom). The click is a no-op while a fork is in flight —
      // `disabled` already blocks it, this is the belt to that braces.
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        void onFork().finally(() => {
          if (mountedRef.current) setBusy(false);
        });
      }}
      disabled={busy}
      className={`${ACTION_ROW_CLASS} hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary`}
      aria-label={FORK_TOOLTIP}
      title={FORK_TOOLTIP}
      data-testid="row-flyout-fork-action"
    >
      <ForkIcon />
      <span className="shrink-0">Fork conversation</span>
      <span className={ACTION_ROW_HINT_CLASS}>new window, same directory</span>
    </button>
  );
}

/**
 * Identity title for the card's title bar: `Window @N · pane %N · N panes` —
 * the tmux window id, the ACTIVE pane's id, and the pane count (all already on
 * the passed `win`). Static text only (the render-performance contract).
 * Degrades by omission: no `panes` (test fixtures, degraded payloads) renders
 * `Window @N` alone; panes without an active one drop just the pane segment.
 */
function WindowFlyoutTitle({ win }: { win: WindowInfo }) {
  const panes = win.panes ?? [];
  const activePaneId = panes.find((p) => p.isActive)?.paneId;
  return (
    <>
      <PopupTitleBarSecondary>Window </PopupTitleBarSecondary>
      {win.windowId}
      {activePaneId && (
        <>
          <PopupTitleBarSecondary> · pane </PopupTitleBarSecondary>
          {activePaneId}
        </>
      )}
      {panes.length > 0 && (
        <PopupTitleBarSecondary>
          {` · ${panes.length} pane${panes.length === 1 ? "" : "s"}`}
        </PopupTitleBarSecondary>
      )}
    </>
  );
}

/**
 * The window tier's card body — mounted ONLY while the flyout is open, so its
 * `useNow()` clock (feeding the `out` register's elapsed) is leaf-scoped per
 * the render-performance contract. Absent layers render as absent (a plain
 * shell pane shows only `out`). The consuming WindowRow builds this via the
 * hook's `content` render prop.
 */
export function WindowFlyoutContent({
  win,
  onChangeColorAction,
  onFork,
  onPinAction,
  pinned = false,
  pinnedBoard,
  onKillAction,
}: {
  win: WindowInfo;
  /** Open the row's combined Label picker (the card's `Change color…` row —
   *  first on every tier's card). The consumer closes the card BEFORE invoking
   *  it (the Pin-row close-then-open idiom). OPTIONAL: a consumer wiring no
   *  color seam renders no row. */
  onChangeColorAction?: () => void;
  onFork?: () => Promise<void>;
  onPinAction?: () => void;
  pinned?: boolean;
  pinnedBoard?: string;
  onKillAction?: () => void;
}) {
  const nowSeconds = useNow();
  const state = statusDotState(win);
  const label = dotLabel(win, state);
  const outputLine = getOutputLine(win, nowSeconds);
  const agentLine = getAgentLine(win);
  const fabLine = getFabLine(win);
  const prSegments = getPrSegments(win);
  // Single-sourced segment JSX shared by the anchor and plain branches below
  // (the panel's segmentSpans idiom — the two renderings can't drift).
  const segmentSpans = prSegments?.map((seg, i) => (
    <span key={seg.text}>
      {i > 0 && <span className="text-text-secondary">{" · "}</span>}
      <span className={seg.color}>{seg.text}</span>
    </span>
  ));
  const fetchedAtEpoch = prFetchedAtEpoch(win);
  // The fork row keeps the DOUBLE gate: a forkable window AND a wired handler.
  // Derived as a narrowed handler (not a boolean) so the ForkActionRow call
  // site type-checks structurally instead of leaning on aliased-condition
  // narrowing, which a refactor could silently break.
  const forkHandler = canForkWindow(win) ? onFork : undefined;

  return (
    <>
      {/* Identity title bar (the card's first element): the static `Window @N`
          title plus the quiet circled-(i) docs link on the bar's right edge.
          Actions (fork/pin/kill) live in the sectioned action list at the
          card's bottom — one affordance, one home. */}
      <PopupTitleBar
        right={
          <a
            href={STATUS_DOT_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-text-secondary hover:text-text-primary coarse:p-1"
            aria-label="What do status dots mean? (opens docs)"
            title="What do status dots mean?"
            data-testid="row-flyout-docs-link"
          >
            <InfoIcon />
          </a>
        }
      >
        <WindowFlyoutTitle win={win} />
      </PopupTitleBar>
      {/* Status label demoted to the first body line — still single-sourced
          with the status dot's aria-label via the shared dotLabel import. */}
      <span className="text-text-primary whitespace-nowrap">{label}</span>
      {/* The four orthogonal signal registers (status-pyramid.md), promoted
          from the PANE panel via the shared resolvers. Read-only text except
          the `pr` register, which is open-first (the line is a real anchor)
          exactly like the panel's PrLinkRow — the register is open-first
          everywhere it renders. The tip's former standalone `agent:` line is
          subsumed by `agt`. */}
      <RegisterLine prefix="out " testid="row-flyout-out">
        <span className="text-text-secondary">{outputLine}</span>
      </RegisterLine>
      {agentLine && (
        <RegisterLine prefix="agt " testid="row-flyout-agt">
          <span className="text-text-secondary">{agentLine}</span>
        </RegisterLine>
      )}
      {fabLine && (
        <RegisterLine prefix="fab " testid="row-flyout-fab">
          <span className="text-text-primary">{fabLine}</span>
        </RegisterLine>
      )}
      {/* `pr` register — open-first when a URL exists (the panel's PrLinkRow
          idiom): the WHOLE line is a real anchor (native middle/Ctrl+click,
          right-click → copy link) with an always-visible inline `↗` sitting
          shrink-0 after the truncating segment span, so it hugs the text end
          and is never eaten by truncation. stopPropagation so opening the PR
          never selects the underlying row. Without a URL the line stays plain
          read-only text (`prUrl`/`prNumber` are independently optional — a
          URL-less number gets the plain line, a number-less URL a bare
          "open PR" anchor).
          Prefix: "pr" + 2 NBSPs = the same 4-advance column as `out `/`agt `/
          `fab ` (and status-panel.tsx's pr rows). Escape sequences, never
          literal NBSPs - a literal survives careless re-encoding badly (the
          cycle-1 mojibake). Codepoints pinned by a unit test. */}
      {win.prUrl ? (
        <a
          href={win.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={win.prUrl}
          aria-label={win.prNumber ? `Open PR #${win.prNumber} in a new tab` : "Open PR in a new tab"}
          onClick={(e) => e.stopPropagation()}
          className="group/pr flex items-center min-w-0 hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent coarse:py-1"
          data-testid="row-flyout-pr-link"
        >
          <span className="text-text-secondary shrink-0">{"pr\u00a0\u00a0"}</span>
          {segmentSpans ? (
            <span data-testid="row-flyout-pr" className="min-w-0 truncate">
              {segmentSpans}
            </span>
          ) : (
            <span className="min-w-0 truncate text-text-secondary">open PR</span>
          )}
          {/* NBSP inside the span — the anchor is a flex container, so a
              whitespace-only text node between flex items would be dropped. */}
          <span className="shrink-0 text-text-secondary group-hover/pr:text-text-primary">{"\u00a0↗"}</span>
        </a>
      ) : (
        segmentSpans && (
          <RegisterLine prefix={"pr\u00a0\u00a0"} testid="row-flyout-pr">
            {segmentSpans}
          </RegisterLine>
        )
      )}
      {/* Ambient "PR checked Xs ago" trust signal; omitted without a joined
          PR-status timestamp. Leaf-scoped clock inside the open card. */}
      <FreshnessLine fetchedAtEpoch={fetchedAtEpoch} />
      {/* Sectioned action rows — the card's last block, rendered for ALL
          pointer types: the color/pin/kill home on coarse (where the in-row
          cluster is fine-pointer-only), additive + Tab-reachable on desktop
          (the FloatingFocusManager order). One row per action in a fixed
          change-color → fork → pin → kill order (Change color… is the FIRST
          action row of every tier's card). Optional-handler idiom: a consumer
          wiring no handler renders no row. All rows stopPropagation so an
          action never selects the underlying row (the PR-link/docs idiom). */}
      {(onChangeColorAction || forkHandler || onPinAction || onKillAction) && (
        <CardActionList>
          {onChangeColorAction && (
            <CardActionRow
              icon={<PaletteIcon />}
              label="Change color…"
              testid="row-flyout-color-action"
              onClick={onChangeColorAction}
            />
          )}
          {forkHandler && <ForkActionRow onFork={forkHandler} />}
          {onPinAction && (
            <CardActionRow
              icon={<PinIcon filled={pinned} />}
              label="Pin to board…"
              hint={pinned ? (pinnedBoard ?? "pinned") : "not pinned"}
              testid="row-flyout-pin-action"
              onClick={onPinAction}
            />
          )}
          {onKillAction && (
            <CardActionRow
              icon={<CloseIcon />}
              label="Kill window"
              hint="confirms first"
              danger
              testid="row-flyout-kill-action"
              onClick={onKillAction}
            />
          )}
        </CardActionList>
      )}
    </>
  );
}

type UseRowFlyoutOptions = {
  /** Close + inhibit the flyout while true — the consuming row passes its
   *  ghost flag and its popover-open states (`PinPopover` / label / color
   *  `SwatchPopover`), so the card never fights the row's other layers. */
  suppressed?: boolean;
  /** Session/server tiers: the card exists ONLY on coarse pointers (its one
   *  trigger is the rail tap/scrub — fine pointers keep the identity tips +
   *  hover clusters), so the hover/focus triggers stay disabled on every
   *  pointer and placement is always the coarse arm (bottom-start + the
   *  rail-aware size() cap). */
  coarseOnly?: boolean;
  /** The tier's card content, built ONLY while the card is open (the
   *  card-mounts-only-while-open perf contract). Receives `close` so action
   *  rows that hand off to a row popover can run the close-then-open idiom
   *  (close the card BEFORE opening the popover — ordering independent of the
   *  consumer's state-update timing; popover-over-card precedence is held by
   *  the `suppressed` gate including the popover-open state). */
  content: (helpers: { close: () => void }) => ReactNode;
};

type RowFlyout = {
  /** Floating reference setter — attach to the ROW ROOT element. */
  setReference: (node: HTMLElement | null) => void;
  /** Reference interaction props (hover/focus/dismiss wiring) — spread onto
   *  the row root. */
  referenceProps: Record<string, unknown>;
  /** The portalled card, or null while closed. Render inside the row. */
  card: ReactNode;
  /** True while the card is open. The row reads this to HOLD its hover tint
   *  while the pointer travels onto the card (the held-row continuity cue) —
   *  the state is row-local, so the open/close re-render never leaves the row. */
  open: boolean;
  /** Imperative open — the coarse-pointer dot-tap trigger. */
  openNow: () => void;
  /** Imperative close — the row calls this on drag start. */
  close: () => void;
};

/**
 * Row-local flyout state + wiring for one rail-bearing row — the ONE shared
 * card shell (placement arms, containment cap, held-state key, portal/focus
 * wiring, notch) consumed by all three tiers, parameterized by tier content.
 * All state lives inside the row (React.memo stays effective; nothing is
 * lifted to `Sidebar`).
 *
 * Triggers (window tier): `useHover` (row hover, `mouseOnly` so touch never
 * hover-opens; `safePolygon` bridges row → card so links are clickable; delay
 * via the module-scoped warm window), `useFocus` (keyboard row focus — the
 * roving treeitem), `useDismiss` (Escape / outside press / blur), plus the
 * exposed `openNow` for the coarse rail/dot tap. The coarse-only tiers
 * (session/server) disable hover/focus entirely — their one trigger is
 * `openNow` from the rail.
 */
export function useRowFlyout({ suppressed = false, coarseOnly = false, content }: UseRowFlyoutOptions) {
  const [open, setOpen] = useState(false);
  // True once keyboard focus has entered the OPEN card (Tab from the row).
  // Gates FloatingFocusManager's `returnFocus`: a close where focus was
  // inside the card (Escape after tabbing in) must return focus to the row so
  // tree nav continues, but a hover-originated close (sweeping to a sibling
  // row) must NOT move focus — the manager's default returns focus even when
  // nothing was focused (activeElement === body), which yanks focus to the
  // just-left row's button mid-sweep and broke the warm retarget.
  const [focusInsideCard, setFocusInsideCard] = useState(false);

  // Stable per-instance handle for the module-scoped single-open coordinator.
  const selfRef = useRef<{ close: () => void } | null>(null);
  if (selfRef.current === null) {
    selfRef.current = { close: () => setOpen(false) };
  }

  // True when this open was COLD (no card open, warm window expired) — gates
  // the slide-out entrance so warm retargets between rows snap instead of
  // re-animating on every sweep. Captured at the closed→open transition, BEFORE
  // the coordinator update makes the module state warm.
  const coldOpenRef = useRef(false);

  const handleOpenChange = useCallback((next: boolean, _event?: Event, reason?: string) => {
    const self = selfRef.current;
    if (!self) return;
    if (next) {
      // Mid-scrub, hover/focus opens are blocked: pointer capture refires
      // boundary events on the captured (source) row's chain, and a stray
      // `mouseenter` there must not steal the card back from the scrub's
      // retarget. The scrub's own `openNow` calls carry no reason and pass.
      if (scrubActive && (reason === "hover" || reason === "focus")) return;
      // `useFocus` re-fires onOpenChange(true) for focusin bubbling from the
      // card, so only a transition where this card was NOT already the active
      // one counts as a fresh open for the entrance animation.
      if (activeFlyout !== self) coldOpenRef.current = !flyoutIsWarm();
      // Single-open: opening this card closes any other open card (the
      // FloatingDelayGroup "currentId" behavior, module-scoped).
      if (activeFlyout && activeFlyout !== self) activeFlyout.close();
      activeFlyout = self;
    } else if (activeFlyout === self) {
      // Stamp the warm window only when THIS flyout was actually open — a
      // no-op close (e.g. a drag-start before the 350ms delay elapsed, or a
      // close racing another row's open) must not falsely arm the 500ms
      // instant-retarget window.
      activeFlyout = null;
      lastClosedAt = Date.now();
    }
    setOpen(next);
  }, []);

  // Reset the focus-entered flag on each FRESH open, keyed to the real open
  // state — NOT inside handleOpenChange: useFocus re-fires onOpenChange(true)
  // for every focusin that bubbles from the portalled card through the React
  // tree (the card is a React child of the row root), and a reset there would
  // land in the same batch as the capture-phase set and negate it.
  useEffect(() => {
    if (open) setFocusInsideCard(false);
  }, [open]);

  // Suppression (popover open / ghost) closes an open card and, via the
  // `enabled` flags below, inhibits re-opening while it holds.
  useEffect(() => {
    if (suppressed && open) handleOpenChange(false);
  }, [suppressed, open, handleOpenChange]);

  // Unmount while open must not leave the coordinator pointing at a dead row.
  useEffect(() => {
    return () => {
      const self = selfRef.current;
      if (self && activeFlyout === self) {
        activeFlyout = null;
        lastClosedAt = Date.now();
      }
    };
  }, []);

  // Row-aligned notch (E1): the arrow middleware pins a pointer on the card's
  // row-side edge at the ROW's vertical center — the geometric "whose card is
  // this" cue. `shift()` may slide the card along the cross axis at viewport
  // edges; the arrow stays locked to the reference either way.
  const arrowRef = useRef<SVGSVGElement | null>(null);

  const coarsePointer = useCoarsePointer();
  // The coarse-only tiers (session/server) always take the coarse placement
  // arm — their card's one trigger is the rail, which exists on coarse only.
  const coarse = coarseOnly || coarsePointer;
  const { refs, floatingStyles, context, middlewareData, placement } = useFloating({
    open,
    onOpenChange: handleOpenChange,
    // Fine pointers: fixed-x anchor — the row is full-bleed to the sidebar
    // width, so "right" of the ROW element is the sidebar's right edge,
    // stable across rows. Coarse pointers: the card anchors BELOW the row
    // (the drawer has no free space at either side for a "right" card), with
    // a top-start fallback near the drawer bottom.
    placement: coarse ? "bottom-start" : "right",
    // `fixed` (not the default `absolute`): the card is portalled to
    // document.body, and an absolutely-positioned card whose right edge lands
    // past the viewport GROWS document.body's scrollWidth — horizontal page
    // overflow at narrow widths (CI: top-bar-overflow/-overlap 375px sweeps,
    // body 462px). A fixed-position box is out of the scroll flow, so an
    // off-viewport edge clips instead of widening the page; flip()/shift()
    // keep positioning against the viewport as before.
    strategy: "fixed",
    // arrow() runs after shift() so the notch is positioned against the final
    // shifted card rect (the floating-ui documented order). The coarse arm
    // adds size() AFTER shift(): the containment cap (below) must win over
    // the `max-w-xs`-free width, and shift() keeps the card inside the
    // viewport padding.
    middleware: coarse
      ? [
          offset(6),
          flip({ fallbackPlacements: ["top-start"] }),
          shift({ padding: 8 }),
          size({
            // Containment invariant: the card's right edge stops BEFORE the
            // row's status rail, so the finger's column stays visible
            // and touchable mid-scrub. bottom-start left-aligns the card to
            // the row, so the cap is row width − rail − an 8px gap.
            apply({ rects, elements }) {
              const cap = rects.reference.width - STATUS_RAIL_WIDTH_PX - 8;
              elements.floating.style.maxWidth = `${Math.max(cap, 120)}px`;
            },
          }),
          arrow({ element: arrowRef }),
        ]
      : [
          offset(6),
          flip(),
          shift({ padding: 8 }),
          size({
            // Symmetric reset of the coarse arm's inline cap: if the pointer
            // flips coarse → fine while the card is mounted, a stale inline
            // maxWidth would otherwise persist and override the fine-pointer
            // `max-w-xs` class (inline style wins over the class).
            apply({ elements }) {
              elements.floating.style.maxWidth = "";
            },
          }),
          arrow({ element: arrowRef }),
        ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    // Coarse-only tiers never hover/focus-open — their one trigger is the
    // rail's `openNow` (fine pointers keep the identity tip + hover cluster).
    enabled: !suppressed && !coarseOnly,
    // Touch never hover-opens (intake #17): the coarse-pointer path is the
    // explicit rail/dot-tap (`openNow`) + PANE-panel-on-selection.
    mouseOnly: true,
    move: false,
    // Function form — evaluated at event time against the module-scoped warm
    // window, so sweeping between rows retargets instantly.
    delay: flyoutOpenDelay,
    handleClose: safePolygon(),
  });
  const focus = useFocus(context, { enabled: !suppressed && !coarseOnly });
  const dismiss = useDismiss(context);
  // Deliberately NO `useRole({ role: "tooltip" })` — the card holds real links
  // (tier-2 hover-card, same rationale as the retired StatusDotTip; see
  // ui-patterns § Design Decisions → No role="tooltip").
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);

  const openNow = useCallback(() => {
    // Honor the same gate the useHover/useFocus triggers honor via `enabled`:
    // a rail/dot-tap while a row popover (PinPopover/SwatchPopover) is open
    // must not flash the card or close another row's card.
    if (suppressed) return;
    handleOpenChange(true);
  }, [handleOpenChange, suppressed]);
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // Capture the reference node as state so the scrub-registry effect keys on
  // it (set once at mount; an identical-node set bails out of the re-render).
  const [referenceEl, setReferenceEl] = useState<HTMLElement | null>(null);
  const setReference = useCallback(
    (node: HTMLElement | null) => {
      refs.setReference(node);
      setReferenceEl(node);
    },
    [refs],
  );

  // Scrub registry: this row's imperative open keyed by its root element.
  // Re-registers when `openNow`'s closure changes (e.g. the suppressed gate
  // flips), so a scrub never invokes a stale gate; unregisters on unmount so
  // a removed row (SSE) can't be retargeted.
  useEffect(() => {
    if (!referenceEl) return;
    flyoutScrubTargets.set(referenceEl, openNow);
    return () => {
      flyoutScrubTargets.delete(referenceEl);
    };
  }, [referenceEl, openNow]);

  const card: ReactNode = open ? (
    <FloatingPortal>
      {/* Non-modal focus management so the card's links (PR + docs) are
          Tab-reachable from the focused row: the manager makes FloatingPortal
          render its tab-order guards (they only render under a focus
          manager), so Tab walks reference → portalled content in tree order.
          `initialFocus={-1}` skips the manager's focus-on-open move and
          `returnFocus` is gated on focus actually having entered the card —
          the card also opens (and closes) on mere hover, and hover must never
          move focus (not steal it from the terminal on open, not yank it to
          the row's button on a sweep-away close). Escape-dismiss (useDismiss)
          and the sidebar tree's arrow-key nav are unaffected: focus stays on
          the row until the user tabs in. */}
      <FloatingFocusManager
        context={context}
        modal={false}
        order={["reference", "content"]}
        initialFocus={-1}
        returnFocus={focusInsideCard}
      >
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          // Don't let clicks inside the card bubble to the underlying row.
          onClick={(e) => e.stopPropagation()}
          // Records that focus entered the card (capture phase — fires for
          // any focusable descendant, i.e. the PR/docs links).
          onFocusCapture={() => setFocusInsideCard(true)}
          data-testid="row-flyout-card"
          // `rk-flyout-in` (cold opens only — warm retargets snap) slides the
          // card out of the row via margin-left + opacity: floating-ui owns
          // this element's `transform` for positioning, so the entrance must
          // never animate transform (it would clobber the translate).
          // The `max-w-xs` cap is FINE-POINTER-ONLY: on coarse the size()
          // middleware owns the width cap (stop before the status rail).
          className={`z-50 flex flex-col gap-1 bg-bg-primary border border-border rounded-md shadow-lg px-2 py-1.5 text-xs font-mono w-max${coarse ? "" : " max-w-xs"}${
            coldOpenRef.current ? " rk-flyout-in" : ""
          }`}
        >
          {/* Row-aligned notch (E1): pinned by the arrow() middleware to the
              hovered row on the card's row-side edge. The resolved coordinate
              is axis-dependent: on a SIDE placement (fine pointers) it is `y`
              measured from the card's top — the notchFill title-band seam. On
              the coarse BOTTOM placement the arrow sits on the card's TOP
              edge, which is always inside the full-width title band (fill 0
              → inset); flipped to TOP the arrow sits on the bottom edge, in
              the action area (null → card surface). */}
          <FloatingArrow
            ref={arrowRef}
            context={context}
            width={10}
            height={5}
            tipRadius={1}
            fill={notchFill(
              placement.startsWith("bottom")
                ? 0
                : placement.startsWith("top")
                  ? null
                  : middlewareData.arrow?.y,
            )}
            stroke="var(--color-border)"
            strokeWidth={1}
            aria-hidden="true"
            data-testid="row-flyout-arrow"
          />
          {/* The tier's content, built only while open (the mount-only-while-
              open perf contract). `close` feeds the close-then-open handoff
              idiom of popover-opening action rows (Change color…, Pin). */}
          {content({ close })}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  ) : null;

  return {
    setReference,
    referenceProps: getReferenceProps(),
    card,
    open,
    openNow,
    close,
  } satisfies RowFlyout;
}
