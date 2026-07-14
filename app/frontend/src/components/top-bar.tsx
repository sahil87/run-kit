import { useCallback, useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { LogoSpinner } from "@/components/logo-spinner";
import { useChromeState, useChromeDispatch, TERMINAL_FONT_BOUNDS } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useUpdateNotification } from "@/contexts/session-context";
import { splitWindow, closePane } from "@/api/client";
import { useWindowRename } from "@/hooks/use-window-rename";
import { prefersReducedMotion } from "@/lib/motion";
import { WaitingBadge } from "@/components/waiting-badge";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

export type TopBarMode = "terminal" | "board" | "root" | "cockpit";

type TopBarProps = {
  /**
   * Mode controls the breadcrumb / informational region and the center page
   * heading. The center cell carries a universal `PageType: name` heading in
   * EVERY mode (260704-pr0p); the left breadcrumb always ends at the PARENT
   * (move-don't-copy — the leaf is the centered heading, never duplicated):
   * - `terminal` (default, `/$server/$window`) — left: brand + hamburger +
   *   server link + session dropdown (ends at session). Center: `Terminal:
   *   <window>` editable heading + ▾ window switcher.
   * - `root` (`/$server` with no window, the Server Cabin) — left: brand +
   *   hamburger (ends at the parent = home). Center: `Server Cabin: <server>`
   *   display heading (the server leaf moved here from the left breadcrumb).
   * - `board` (`/board/$name`) — left: brand + hamburger + pane/server counts +
   *   cycle hint (the `Board ▸` home button is gone). Center: `Board: <board>`
   *   display heading + ▾ board switcher (moved from the left breadcrumb).
   * - `cockpit` (`/`, the Server List home) — brand crumb ONLY (left). Center:
   *   the solo `Cockpit` word. No hamburger
   *   (the Cockpit has no sidebar), no terminal-font control, no split/close
   *   buttons, no fixed-width button (terminal-only since 260704-9o7k). The L3
   *   always-block (Notification · Theme · Refresh · Help) still renders, plus
   *   the connection dot — which on Cockpit reflects host-metrics stream health
   *   (260704-9o7k; formerly hidden). Session/server-dependent props are passed
   *   empty (`sessions=[]`, `currentSession=null`, `currentWindow=null`,
   *   `sessionName=""`, `server=""`, no-op callbacks) — the same tolerant-empty
   *   shape board mode already uses.
   */
  mode?: TopBarMode;
  sessions: ProjectSession[];
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sessionName: string;
  windowName: string;
  isConnected: boolean;
  sidebarOpen: boolean;
  server: string;
  onNavigate: (windowId: string) => void;
  onToggleSidebar: () => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
  /** Board-mode metadata. Required when `mode === "board"`. */
  boardName?: string;
  paneCount?: number;
  serverCount?: number;
  /** Board-mode attention rollup (260706-y1ar): count of board panes whose
   *  joined window is `waiting`. Rendered as a yellow badge in the board-mode
   *  left info. Absent/0 → no badge. */
  waitingPaneCount?: number;
  /** Board-mode list of all boards (for the board switcher dropdown). */
  boards?: { name: string }[];
  /** Board-mode ✕ handler — unpins the board's focused pane (non-destructive).
   *  Wired from `board-page.tsx`; the terminal ✕ keeps its own kill path. */
  onCloseFocused?: () => void;
  /** Disable the board-mode ✕ (e.g. the board has zero panes). */
  closeDisabled?: boolean;
  /** Board-mode autofit state (738w) — reflected by the L2 toggle's
   *  `aria-pressed`. Wired from `board-page.tsx` via the slot context. */
  autofit?: boolean;
  /** Board-mode autofit setter (738w) — flips the same state the palette's
   *  `Board: Toggle Autofit` action flips. Absent → no toggle rendered. */
  onToggleAutofit?: () => void;
};

function HamburgerIcon({ isOpen }: { isOpen: boolean }) {
  // Notion-style sidebar pictogram: rounded-rect with an internal vertical
  // divider ~30% from the left. The left column fills when the sidebar is
  // open and empties when collapsed — same shape both states, only the fill
  // flips, so the icon's identity ("this is a sidebar toggle") never changes.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer panel — rounded rectangle */}
      <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
      {/* Sidebar slot fill — left column, filled when sidebar is open.
          Uses fillOpacity to tone the fill down to a subtle wash rather
          than matching the stroke at full intensity. */}
      <rect
        x="2.5"
        y="3.5"
        width="4"
        height="11"
        rx="2"
        fill="currentColor"
        fillOpacity={isOpen ? 0.5 : 0}
        stroke="none"
        style={{ transition: "fill-opacity 150ms ease" }}
      />
      {/* Internal divider — separates sidebar slot from content area */}
      <line x1="6.5" y1="3.5" x2="6.5" y2="14.5" />
    </svg>
  );
}

/**
 * Breadcrumb separator `›` (U+203A) — the established palette-label convention
 * (`<session> › <name>`), replacing the old `/` separator. Decorative, so it is
 * `aria-hidden`; the crumb hierarchy is conveyed by position and each crumb's
 * own role/`aria-current`.
 */
function BreadcrumbSeparator() {
  return (
    <span className="text-text-secondary select-none shrink-0" aria-hidden="true">
      {"›"}
    </span>
  );
}

/**
 * Link-crumb affordance — the always-visible "this navigates" cue on the two
 * link crumbs (brand, server): a bordered chip, reusing the right-cluster's
 * "bordered = clickable" visual language. Dropdown crumbs signal differently
 * (persistent ▾ caret inside BreadcrumbDropdown); non-interactive leaf crumbs
 * carry neither — the absence of affordance marks the current page.
 */
const LINK_CRUMB_CLASS =
  "rounded border border-border hover:border-text-secondary px-1.5 py-0.5 text-text-secondary hover:text-text-primary transition-colors";

export function TopBar({
  mode = "terminal",
  sessions,
  currentSession,
  currentWindow,
  sessionName,
  windowName,
  isConnected,
  sidebarOpen,
  server,
  onNavigate,
  onToggleSidebar,
  onCreateSession,
  onCreateWindow,
  boardName,
  paneCount,
  serverCount,
  waitingPaneCount,
  boards,
  onCloseFocused,
  closeDisabled,
  autofit,
  onToggleAutofit,
}: TopBarProps) {
  // Breadcrumb hrefs use the 2-segment route shape /$server/$window — the
  // window id (@N) is the only identity in the URL. Selecting a session jumps
  // to its first window; the owning session is derived from the snapshot.
  const sessionItems: BreadcrumbDropdownItem[] = sessions.map((s) => ({
    label: s.name,
    href: `/${encodeURIComponent(server)}/${encodeURIComponent(s.windows[0]?.windowId ?? "")}`,
    current: s.name === sessionName,
  }));

  const windowItems: BreadcrumbDropdownItem[] = (currentSession?.windows ?? []).map(
    (w) => ({
      label: w.name,
      href: `/${encodeURIComponent(server)}/${encodeURIComponent(w.windowId)}`,
      current: currentWindow ? w.windowId === currentWindow.windowId : false,
    }),
  );

  const handleDropdownNavigate = useCallback(
    (href: string) => {
      // Parse href "/server/windowId" — the window segment is the tmux window
      // ID (@N), a string (no numeric coercion). Identity is window-id only.
      const parts = href.replace(/^\//, "").split("/");
      if (parts.length >= 2) {
        const windowId = decodeURIComponent(parts[1]);
        if (windowId) {
          onNavigate(windowId);
        }
      }
    },
    [onNavigate],
  );

  // Hamburger animation is driven by `sidebarOpen` alone — both desktop
  // (grid column) and mobile (overlay) collapse to the same boolean state.
  const hamburgerOpen = sidebarOpen;

  // Cockpit (`/`) has no sidebar, so it renders no hamburger. Every other mode
  // (terminal / root / board) has a Shell sidebar and shows the toggle.
  const hasSidebar = mode !== "cockpit";

  // Move-don't-copy (260704-pr0p): the left breadcrumb always ends at the
  // PARENT; the current-page leaf is the centered heading. So the server crumb
  // renders in the left nav ONLY as a link back to the Server Cabin on the
  // terminal route (parent = the cabin) — on the root route the server name is
  // the leaf and moves to the center heading, leaving the left breadcrumb at
  // brand + hamburger. Cockpit and board have no left server crumb.
  const showServerCrumb = mode === "terminal" && !!server;
  const serverHref = `/${encodeURIComponent(server)}`;

  return (
    <header className="px-3 border-b-[3px] border-border">
      {/* 3-column grid `1fr auto 1fr`: the center cell is truly centered
          regardless of asymmetric left/right widths. Left = breadcrumb nav,
          center = the universal `PageType: name` page heading (all four modes,
          260704-pr0p), right = controls. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
          {/* Brand root crumb — logo + wordmark, links to `/`. Left-most on
              every route; IS the home affordance (no separate "Cockpit" crumb).
              Wordmark collapses to the bare icon below `sm` so long crumbs still
              fit the single-line 375px topbar. */}
          <a
            href="/"
            aria-label="Run Kit home"
            title="Cockpit"
            className={`flex items-center gap-2 shrink-0 rk-brand-glitch ${LINK_CRUMB_CLASS}`}
          >
            <img src="/icon.svg" alt="Run Kit" width={20} height={20} />
            {/* [text-decoration:inherit] — the anchor is a flex container and
                text-decoration does not propagate into flex items, so an
                underline-based LINK_CRUMB_CLASS would silently skip the
                wordmark without it. No-op for non-underline variants. */}
            <span className="hidden sm:inline text-xs [text-decoration:inherit]">Run Kit</span>
          </a>

          {/* Hamburger icon — toggles sidebarOpen (one boolean covers both
              desktop grid column and mobile overlay). Sits between the brand and
              the crumbs. Not rendered on the Cockpit, which has no sidebar.
              rk-glint: borderless at rest, so hover = green icon + sweep only
              (the glint border flip is a no-op without a border). */}
          {hasSidebar && (
            <button
              onClick={onToggleSidebar}
              aria-label="Toggle navigation"
              className="rk-glint text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center shrink-0"
            >
              <HamburgerIcon isOpen={hamburgerOpen} />
            </button>
          )}

          {mode === "board" ? (
            // Board mode keeps ONLY the counts/hint on the left (move-don't-copy,
            // 260704-pr0p): the board name + ▾ switcher moved to the center
            // heading, and the left `Board ▸` home button is gone (the brand
            // crumb is already the home affordance). No leading separator — the
            // hint is not a crumb.
            <BoardModeInfo
              paneCount={paneCount ?? 0}
              serverCount={serverCount ?? 0}
              waitingPaneCount={waitingPaneCount ?? 0}
            />
          ) : (
            <>
              {/* Server LINK crumb — terminal route only (parent = the Server
                  Cabin). On the root route the server name is the leaf and lives
                  in the center heading, so no left server crumb there. Hidden
                  below `sm` so mobile shows only brand icon + centered leaf. */}
              {showServerCrumb && (
                <span className="hidden sm:flex items-center gap-1.5">
                  <BreadcrumbSeparator />
                  <a
                    href={serverHref}
                    title="Server Cabin"
                    className={`rk-glint truncate max-w-[16ch] ${LINK_CRUMB_CLASS}`}
                  >
                    {server}
                  </a>
                </span>
              )}

              {sessionName && (
                // The breadcrumb ends at the SESSION crumb — window identity
                // moved to the centered heading (below), so the window name is
                // never duplicated. Session crumb hidden below `sm`.
                <span className="hidden sm:flex items-center gap-1.5">
                  <BreadcrumbSeparator />
                  <BreadcrumbDropdown
                    items={sessionItems}
                    label="session"
                    icon={sessionName}
                    title="Session"
                    onNavigate={handleDropdownNavigate}
                    action={{ label: "+ New Session", onAction: onCreateSession }}
                    triggerClassName="max-w-[16ch] truncate text-text-secondary hover:text-text-primary transition-colors text-sm"
                  />
                </span>
              )}
            </>
          )}
        </nav>

        {/* Center cell — the universal `PageType: name` page heading, filled on
            EVERY mode (260704-pr0p): terminal = editable window heading + ▾
            window switcher; board = display board heading + ▾ board switcher
            (both moved here from the left breadcrumb); root = display server
            heading; cockpit = solo `Cockpit`. It stays centered under the
            `auto` middle grid column regardless of left/right widths, and on
            mobile it is the visible leaf (intermediate crumbs hide below `sm`). */}
        {/* No flex `gap` here: the single separator between the page-type prefix
            and the instance name is the boot sweep's own `sp` space cell (the
            cursor visibly crosses it) — a `gap-1` on top of it double-spaced
            them (260704-pr0p rework N4). The ▾ switchers carry their own `ml-1`
            so only the switcher gets separated from the name. */}
        <div className="flex items-center justify-center min-w-0">
          {mode === "terminal" && currentWindow && (
            <>
              {/* No `key` on the route identity: the instance persists across
                  window switches so the boot sweep replays on navigation and an
                  in-progress edit survives long enough to be intentionally
                  cancelled (see WindowHeading's identity-change guard) rather
                  than silently destroyed by a remount. */}
              <WindowHeading
                server={server}
                windowId={currentWindow.windowId}
                sessionName={sessionName}
                name={windowName}
              />
              <BreadcrumbDropdown
                items={windowItems}
                label="window"
                title="Window"
                onNavigate={handleDropdownNavigate}
                action={{ label: "+ New Window", onAction: () => onCreateWindow(sessionName) }}
                triggerClassName="ml-1 text-text-secondary hover:text-text-primary transition-colors shrink-0"
              />
            </>
          )}

          {mode === "board" && boardName && (
            <>
              {/* Board name is display-only (boards have no rename API); the ▾
                  board switcher moved here from the left breadcrumb. */}
              <PageHeadingDisplay
                prefix={BOARD_PREFIX}
                name={boardName}
                ariaLabel={`Board ${boardName}`}
              />
              <BoardSwitcher boardName={boardName} boards={boards ?? []} />
            </>
          )}

          {mode === "root" && server && (
            <PageHeadingDisplay
              prefix={CABIN_PREFIX}
              name={server}
              ariaLabel={`Server Cabin ${server}`}
            />
          )}

          {mode === "cockpit" && (
            <PageHeadingDisplay
              prefix=""
              name={COCKPIT_SOLO}
              solo
              ariaLabel="Cockpit"
            />
          )}
        </div>

        <div className="flex items-center justify-self-end gap-3 text-xs text-text-secondary shrink-0">
          {/* Right-cluster button pyramid (260704-9o7k). A strict cumulative
              pyramid, growing LEFTWARD from a stable always-block pinned right,
              so no shared button ever changes screen position between pages:

                L1 — terminal only  : SplitButton ×2 · FixedWidthToggle
                L2 — terminal+board : TerminalFontControl (Aa) · ClosePaneButton (✕)
                L3 — all four modes : Notification · Theme · Refresh · Help
                                      + connection dot (right-most status terminator)

              L1's absence on non-terminal pages just widens the gap to the
              breadcrumb; the L3 always-block keeps its fixed right edge (the
              brand anchor moved to the left nav as the root crumb). The dot is
              the right-most element in every mode. */}

          {/* L1 — terminal-only: split vertical · split horizontal · fixed-width.
              FixedWidthToggle is terminal-only (260704-9o7k): the 900px maxWidth
              wrapper lives in AppShell (app.tsx), which renders both `terminal`
              and `root`, so Server Cabin keeps the constraint AND the palette
              access (`View: Fixed Width`); only the button is terminal-scoped.
              It was already a no-op on Board/Cockpit (their pages never read
              `fixedWidth`). */}
          {currentWindow && (
            <>
              <span className="hidden sm:flex">
                <SplitButton
                  server={server}
                  windowId={currentWindow.windowId}
                  cwd={currentWindow.worktreePath}
                />
              </span>
              <span className="hidden sm:flex">
                <SplitButton
                  horizontal
                  server={server}
                  windowId={currentWindow.windowId}
                  cwd={currentWindow.worktreePath}
                />
              </span>
              <span className="hidden sm:flex">
                <FixedWidthToggle />
              </span>
            </>
          )}

          {/* L2 — terminal + board: terminal-font (Aa) + close/unpin (✕). Both
              gate on the L2 predicate (`terminal` || `board`). Aa sizes a
              terminal surface (the single window or a board pane); it is gated
              out of `root`/`cockpit`, which have no terminal to size. The ✕ is
              close-pane on Terminal (kills the active pane) and unpin-focused on
              Board (removes the focused pane from the board, non-destructive —
              see board-page.tsx). */}
          {(mode === "terminal" || mode === "board") && (
            <>
              <span className="hidden sm:flex">
                <TerminalFontControl />
              </span>
              {/* Board-only autofit toggle (738w): sits between Aa and ✕ in the
                  L2 cluster. Board mode only (unlike Aa/✕ which are
                  terminal||board) — terminal panes have their own fixed-width
                  toggle. Rendered only when the board published a setter. */}
              {mode === "board" && onToggleAutofit && (
                <span className="hidden sm:flex">
                  <BoardAutofitToggle
                    autofit={autofit ?? false}
                    onToggle={onToggleAutofit}
                  />
                </span>
              )}
              <span className="hidden sm:flex">
                {mode === "board" ? (
                  <ClosePaneButton
                    onUnpin={onCloseFocused}
                    // Board mode has no terminal to close: without an `onUnpin`
                    // handler the ✕ would fall through to `closePane("", "")`
                    // (empty server/window). Disable it when the handler is
                    // absent so the button can never trigger that no-op path.
                    disabled={closeDisabled || !onCloseFocused}
                    label="Unpin pane from board"
                  />
                ) : (
                  currentWindow && (
                    <ClosePaneButton
                      server={server}
                      windowId={currentWindow.windowId}
                    />
                  )
                )}
              </span>
            </>
          )}

          {/* L3 — always (all four modes): Update chip → Notification → Theme →
              Refresh → Help, then the connection dot as the right-most element. */}

          {/* Update chip — leads the L3 cluster. Self-contained (reads the
              update-notification state from SessionContext); renders nothing when
              no qualifying update is pending, when dismissed for the current
              latest, or when the daemon reports the `dev` version. Carries its
              own `hidden sm:flex` gating: a call-site wrapper span would remain
              in this gap-3 flex row as an empty item while the chip renders
              null, doubling the gap between its neighbors. */}
          <UpdateChip />

          {/* Notification control — bell button + dropdown (enable / send test).
              Hides itself when push is unsupported (insecure context / no SW
              support), and carries its own responsive gating for the same
              empty-flex-item reason as UpdateChip. */}
          <NotificationControl />

          {/* Theme toggle. */}
          <span className="hidden sm:flex">
            <ThemeToggle />
          </span>

          {/* Refresh — full-page reload recovery affordance. Promoted from the
              terminal-only group into the always-block (260704-9o7k): a reload
              is meaningful on every page. Behavior unchanged (plain click
              reloads, Shift+click force-reloads). */}
          <span className="hidden sm:flex">
            <RefreshButton />
          </span>

          {/* Help — external docs link. */}
          <span className="hidden sm:flex">
            <HelpLink />
          </span>

          {/* Connection dot — the right-most element, in ALL four modes
              (260704-9o7k dropped the board/cockpit gate). Its meaning is
              per-page "this page's live data is flowing": Terminal/Server Cabin
              = the current server's SSE stream; Cockpit = host-metrics stream
              health; Board = AND over the attached servers' streams (derived by
              each caller and passed as `isConnected`). */}
          <span role="status" aria-live="polite" className="hidden sm:inline">
            <span
              className={`block w-2 h-2 rounded-full ${
                isConnected ? "bg-accent-green" : "bg-text-secondary"
              }`}
              aria-label={isConnected ? "Connected" : "Disconnected"}
            />
          </span>
        </div>
      </div>
    </header>
  );
}

// Boot-sweep tuning (change 260704-pr0p, extending the 260703-5ilm decode).
// One inverse-video cursor sweeps the whole heading string (prefix + space +
// name) at ~28ms/cell, with a ~140ms hover-intent delay so cursor transit
// across the bar toward the right-side buttons doesn't replay it.
const DECODE_FRAME_MS = 28;
const DECODE_HOVER_INTENT_MS = 140;
const DECODE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/";

function randomGlyph(): string {
  return DECODE_GLYPHS[Math.floor(Math.random() * DECODE_GLYPHS.length)];
}

// A boot-sweep cell: `kind` fixes its resting styling (prefix vs name vs the
// separating space vs a solo type word); `phase` is its live sweep state.
type SweepKind = "pfx" | "sp" | "nm" | "solo";
type SweepPhase = "rest" | "resolved" | "cursor" | "ahead";
type SweepCell = { ch: string; kind: SweepKind; phase: SweepPhase };

/**
 * Build the resting cell list for a heading. Terminal/board/root headings pass
 * a `prefix` (e.g. `Terminal`) + `name`; cockpit passes `solo` alone (no
 * prefix, no instance name — just the type word).
 *
 * The separating space is its own `sp` cell so the cursor visibly crosses it
 * between the prefix and the name (matching the reviewed demo).
 */
function buildCells(
  prefix: string,
  name: string,
  solo: boolean,
): SweepCell[] {
  if (solo) {
    return Array.from(name).map((ch) => ({ ch, kind: "solo", phase: "rest" }));
  }
  const cells: SweepCell[] = [];
  for (const ch of prefix) cells.push({ ch, kind: "pfx", phase: "rest" });
  cells.push({ ch: " ", kind: "sp", phase: "rest" });
  for (const ch of name) cells.push({ ch, kind: "nm", phase: "rest" });
  return cells;
}

/**
 * The one continuous "boot sweep": a single inverse-video accent-green block
 * cursor sweeps prefix + space + name left-to-right at `DECODE_FRAME_MS`/cell
 * (change 260704-pr0p). Over PREFIX cells it behaves like TypedLabel — cells
 * ahead of the cursor are dim (`rk-typed-off`), the cursor cell shows the real
 * char in inverse video (`rk-typed-cursor`), resolved cells settle to
 * secondary. Once the cursor crosses into the NAME, unresolved name cells churn
 * random `DECODE_GLYPHS` in accent-green each frame (spaces preserved) until
 * the cursor locks each to its true char; resolved name cells settle to
 * semibold primary. Cockpit's solo word runs the typed sweep alone.
 *
 * Returns the live cell array (for per-cell rendering), a `scrambling` flag,
 * and imperative controls. Reduced motion is JS-gated (`prefersReducedMotion`):
 * the sweep never starts and the rest state IS the reduced state.
 */
function useBootSweep(prefix: string, name: string, solo: boolean) {
  const rest = () => buildCells(prefix, name, solo);
  const [cells, setCells] = useState<SweepCell[]>(rest);
  const [scrambling, setScrambling] = useState(false);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setScrambling(false);
  }, []);

  // Snap every cell back to its true char + resting styling.
  const resolve = useCallback(() => {
    stop();
    setCells(rest());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, name, solo, stop]);

  const play = useCallback(() => {
    stop();
    const base = rest();
    if (prefersReducedMotion() || base.length === 0) {
      setCells(base);
      return;
    }
    setScrambling(true);
    let cur = 0;
    const n = base.length;
    const tick = () => {
      if (cur > n) {
        setCells(base);
        stop();
        return;
      }
      const next = base.map((c, i): SweepCell => {
        if (i < cur) return { ...c, phase: "resolved" };
        if (i === cur) return { ...c, phase: "cursor" };
        // Ahead of the cursor: name cells churn a glyph (space preserved);
        // prefix/solo/space cells just dim.
        if (c.kind === "nm") {
          return { ...c, ch: c.ch === " " ? " " : randomGlyph(), phase: "ahead" };
        }
        return { ...c, phase: "ahead" };
      });
      setCells(next);
      cur += 1;
    };
    tick();
    frameTimerRef.current = setInterval(tick, DECODE_FRAME_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, name, solo, stop]);

  // Deferred (hover-intent) start: `DECODE_HOVER_INTENT_MS` before the sweep,
  // so cursor transit toward the right-side buttons doesn't replay it.
  const playDeferred = useCallback(() => {
    if (prefersReducedMotion()) return;
    stop();
    hoverTimerRef.current = setTimeout(play, DECODE_HOVER_INTENT_MS);
  }, [play, stop]);

  useEffect(() => () => stop(), [stop]);

  return { cells, scrambling, play, playDeferred, resolve, stop };
}

// Per-cell REST styling by kind. Resolved cells (and cells rendered at rest)
// settle to THESE classes as the cursor passes — NOT to a container-wide color.
// This is the fix for the "resolved cells stay accent-green" defect (change
// 260704-pr0p rework): the heading containers no longer flip `text-accent-green`
// for the whole scramble, so each resolved cell must name its own rest color —
// prefix/space → `text-text-secondary`, name/solo → semibold `text-text-primary`.
// Only the churn (`ahead` name) glyphs and the single cursor cell are green.
function restCellClass(kind: SweepKind): string {
  return kind === "nm" || kind === "solo"
    ? "font-semibold text-text-primary"
    : "text-text-secondary";
}

/**
 * Renders a boot-sweep cell list. At REST (no active sweep) it emits plain text
 * inside a single `whitespace-pre` span so the accessible name stays clean and
 * stable; while sweeping it emits per-cell spans carrying the frame-state
 * classes. Decorative during animation — the spans are `aria-hidden` so churn
 * glyphs never reach a screen reader.
 *
 * Cell-state → styling: the single `cursor` cell is inverse video
 * (`rk-typed-cursor`); an `ahead` cell is a dim prefix glyph (`rk-typed-off`) or
 * an accent-green name churn glyph; a `resolved` (already-swept) cell settles to
 * its per-kind REST class (`restCellClass`), so the left-to-right two-tone
 * reveal is visible instead of a uniform green flash.
 */
function SweepCells({
  cells,
  scrambling,
}: {
  cells: SweepCell[];
  scrambling: boolean;
}) {
  if (!scrambling) {
    return <>{cells.map((c) => c.ch).join("")}</>;
  }
  return (
    <span aria-hidden="true" className="whitespace-pre">
      {cells.map((c, k) => {
        let cls: string;
        if (c.phase === "cursor") cls = "rk-typed-cursor";
        else if (c.phase === "ahead")
          cls = c.kind === "nm" ? "text-accent-green" : "rk-typed-off";
        // resolved (already swept) — settle to the cell's own rest color so it
        // does NOT inherit any transient container color.
        else cls = restCellClass(c.kind);
        return (
          <span key={k} className={cls}>
            {c.ch}
          </span>
        );
      })}
    </span>
  );
}

// Page-type prefix words for the universal center heading (change 260704-pr0p,
// title-case per the reviewed demo — supersedes PageHeading's lowercase idiom).
const TERMINAL_PREFIX = "Terminal:";
const BOARD_PREFIX = "Board:";
const CABIN_PREFIX = "Server Cabin:";
const COCKPIT_SOLO = "Cockpit";

/**
 * Split a boot-sweep cell list into its prefix portion (the `pfx`/`sp` cells)
 * and its name portion (the `nm` cells), so a heading can render the static
 * prefix span and the name in separate DOM containers while ONE cursor sweeps
 * across both. The `sp` separating space rides with the prefix portion so the
 * cursor visibly crosses it before entering the name.
 */
function splitSweepCells(cells: SweepCell[]): {
  prefix: SweepCell[];
  name: SweepCell[];
} {
  const prefix = cells.filter((c) => c.kind === "pfx" || c.kind === "sp");
  const name = cells.filter((c) => c.kind === "nm");
  return { prefix, name };
}

/**
 * The static page-type prefix span — a sibling OUTSIDE the rename button/input
 * so clicking it never starts an edit and it can hide independently below `sm`.
 * Its CONTENT is driven by the shared boot sweep (the one cursor crosses it into
 * the name), but structurally it is decorative: the accessible heading name is
 * carried by the name element's own label, so the prefix carries no role.
 */
function HeadingPrefix({
  cells,
  scrambling,
  onMouseEnter,
  onMouseLeave,
}: {
  cells: SweepCell[];
  scrambling: boolean;
  // Optional hover handlers so the terminal prefix replays the sweep too
  // (260704-pr0p rework N5 — unifies with board/root/cockpit, which hover the
  // whole heading; the demo replayed from the whole bar). Display-only headings
  // pass none: their outer wrapper already owns the hover.
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <span
      className="hidden sm:inline text-sm text-text-secondary whitespace-pre shrink-0"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SweepCells cells={cells} scrambling={scrambling} />
    </span>
  );
}

/**
 * Centered, highlighted, editable window heading (change 260703-5ilm; boot
 * sweep 260704-pr0p) — the single most important identity on the terminal
 * route (the tmux window name), now prefixed `Terminal:`.
 *
 * Three states:
 *  - display: a static `Terminal:` prefix sibling + weight-600 primary-color
 *    name; hover runs the "boot sweep" (typed cursor over the prefix flowing
 *    into a decode scramble over the name).
 *  - decode/sweep: one inverse-video cursor sweeps prefix → name at 28ms/cell
 *    (JS timer — CSS can't randomize glyphs or key on the name state).
 *  - edit: an identically-styled inline input (ch-sized, grows as you type).
 *    Enter/blur commit, Escape/empty-trim cancel, wired to renameWindow() via
 *    the optimistic window-store pattern (same as the sidebar inline rename).
 *
 * Guards (intake A5): (a) 140ms hover-intent delay before the sweep; (b) edit
 * start cancels the sweep and the input binds to the real name state, never
 * scrambled DOM text; (c) the sweep replays once whenever the DISPLAYED name
 * changes — which covers a committed rename (confirmation animation), an
 * SSE-delivered external rename, and navigating to a different window, all with
 * one name-change-keyed mechanism. All animation is skipped under
 * prefers-reduced-motion.
 *
 * The component is deliberately NOT remounted per window (no `key` on the route
 * identity) so this instance persists across window switches: that is what lets
 * guard (c)'s name-change effect actually fire on navigation (a fresh mount
 * would re-seed `prevNameRef` and never replay), and it keeps an in-progress
 * inline edit from being destroyed by an external window switch. Instead, an
 * external identity change (windowId/server) while editing CANCELS the stale
 * edit — the edit belonged to the previous window, so committing the typed name
 * onto the newly-navigated window would be wrong (the modal this replaced was
 * likewise pinned to the window it opened on).
 */
function WindowHeading({
  server,
  windowId,
  sessionName,
  name,
}: {
  server: string;
  windowId: string;
  sessionName: string;
  name: string;
}) {
  // Shared with the sidebar inline rename (change 5ilm) so both surfaces rename
  // identically (optimistic store rename, rollback + toast, clear on settle).
  const { execute: executeRename } = useWindowRename();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // The boot sweep drives the animated name display; `sweep.cells` carries the
  // whole `Terminal: name` string so ONE cursor crosses the prefix into the
  // name. `scrambling` is passed to `SweepCells`, which turns ONLY the per-cell
  // churn glyphs and the single cursor cell accent-green (the vocabulary-wide
  // "animated element turns green" cue) — resolved cells settle to their REST
  // color as the cursor passes, so the container itself never flips green
  // (260704-pr0p rework M2).
  const sweep = useBootSweep(TERMINAL_PREFIX, name, false);
  const { prefix: prefixCells, name: nameCells } = splitSweepCells(sweep.cells);

  const inputRef = useRef<HTMLInputElement>(null);
  // Seeded with `null` (never a real name) so the name-effect below fires ONCE
  // on mount — that is the mount/navigation replay leg (change 260704-pr0p
  // rework M1). A fresh mount plays once, then `prevNameRef` holds the real
  // name so only a GENUINE later name change replays. Seeding it with `name`
  // (as before) suppressed the initial/route-transition play entirely, since
  // WindowHeading mounts only after `currentWindow` resolves and the headings
  // remount across page types. Using the existing name-effect as the single
  // play path (rather than a separate mount effect) is what keeps mount from
  // double-playing over a name change.
  const prevNameRef = useRef<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Set true by a key-driven commit/cancel (Enter/Escape) so the onBlur that
  // fires as the focused <input> tears down is ignored — otherwise Escape could
  // be followed by a stray blur COMMIT (renaming despite the cancel), or Enter
  // by a redundant second commit. Mirrors the sidebar inline editor's
  // `cancelledRef` blur guard (sidebar/index.tsx). Consumed (reset) by the blur
  // handler; re-cleared on each fresh edit entry.
  const keyHandledRef = useRef(false);
  // Track the window identity so an EXTERNAL switch (another client / tmux
  // changing the route) mid-edit can cancel the stale edit rather than retarget
  // it onto the newly-navigated window.
  const prevIdentityRef = useRef(`${server}:${windowId}`);

  // External window switch (another client / tmux changing the route) while
  // an inline edit is in progress: CANCEL the stale edit. The edit targeted
  // the previous window, so committing the typed name onto the newly-navigated
  // window would rename the wrong window. The retired rename modal was pinned
  // to the window it opened on for the same reason; this is its equivalent now
  // that the heading persists across window switches (no remount `key`).
  useEffect(() => {
    const identity = `${server}:${windowId}`;
    if (identity !== prevIdentityRef.current) {
      prevIdentityRef.current = identity;
      if (editingRef.current) {
        sweep.resolve();
        setEditing(false);
        setDraft(name);
      }
    }
  }, [server, windowId, name, sweep]);

  // Plays the boot sweep once on MOUNT and once on every later DISPLAYED-name
  // change (rename confirmation / external rename / route to a different
  // window — one name-keyed mechanism, plus the mount leg via the `null` seed
  // above). Because the instance is NOT remounted per window, the name change
  // also fires on navigation, so the sweep genuinely replays when routing to a
  // different window (guard c). The mount fire and a name change can never
  // double-play: mount sets `prevNameRef` to the real name, so the effect only
  // re-runs `play()` for a name that is actually different. While editing, do
  // not animate (bind to the real name).
  useEffect(() => {
    if (name !== prevNameRef.current) {
      prevNameRef.current = name;
      setDraft(name);
      if (!editingRef.current) sweep.play();
      else sweep.resolve();
    }
  }, [name, sweep]);

  const startEdit = useCallback(() => {
    sweep.resolve();
    setDraft(name);
    keyHandledRef.current = false;
    setEditing(true);
  }, [name, sweep]);

  // Command-palette "Window: Rename" enters inline edit via a CustomEvent,
  // mirroring the `theme-selector:open` pattern (Constitution V keyboard path).
  useEffect(() => {
    function onRename() {
      startEdit();
    }
    document.addEventListener("window-heading:rename", onRename);
    return () => document.removeEventListener("window-heading:rename", onRename);
  }, [startEdit]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    setEditing(false);
    // Empty/whitespace-only commit = cancel (matches the dialog's trim guard).
    if (!trimmed || trimmed === name) {
      sweep.resolve();
      setDraft(name);
      return;
    }
    executeRename(server, sessionName, windowId, trimmed);
    // The name-change effect replays the boot sweep when the store-driven
    // `name` prop settles to the committed value.
  }, [draft, name, server, sessionName, windowId, executeRename, sweep]);

  const cancel = useCallback(() => {
    setEditing(false);
    sweep.resolve();
    setDraft(name);
  }, [name, sweep]);

  if (editing) {
    return (
      <>
        <HeadingPrefix cells={prefixCells} scrambling={false} />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // A key (Enter/Escape) already committed/cancelled and is tearing
            // the input down — swallow the trailing blur so it doesn't re-commit
            // (Enter) or override a cancel (Escape). Genuine focus-loss (no
            // preceding key) still commits.
            if (keyHandledRef.current) {
              keyHandledRef.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              keyHandledRef.current = true;
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              keyHandledRef.current = true;
              cancel();
            }
          }}
          aria-label="Window name"
          // Identically-styled to the display heading: monospace, centered,
          // weight-600 primary color, sized in ch and growing with content.
          style={{ width: `${Math.max(draft.length + 1, 3)}ch` }}
          className="bg-transparent text-center text-sm font-semibold text-text-primary outline-none border-b border-accent min-w-0"
        />
      </>
    );
  }

  return (
    <>
      {/* Static `Terminal:` prefix — a sibling OUTSIDE the button so clicking
          it never starts an edit; hidden below `sm` (mobile keeps just the
          name). Its content rides the same sweep so the one cursor crosses it.
          Hovering the prefix replays the sweep too (matches the whole-heading
          hover on board/root/cockpit), but it is NOT a click target — clicking
          it never enters edit (only the button below does). */}
      <HeadingPrefix
        cells={prefixCells}
        scrambling={sweep.scrambling}
        onMouseEnter={sweep.playDeferred}
        onMouseLeave={sweep.resolve}
      />
      <button
        type="button"
        onClick={startEdit}
        onMouseEnter={sweep.playDeferred}
        onMouseLeave={sweep.resolve}
        aria-label={`Rename window ${name}`}
        title="Click to rename"
        // The heading is the mobile leaf and the primary rename affordance
        // there, so give it a touch-sized tap target on coarse pointers
        // (matches the top-bar control convention `coarse:min-h-[30px]`);
        // inline-flex centers the truncated name vertically within the taller
        // target. The container keeps its REST color throughout the sweep — the
        // green lives ONLY on the per-cell churn/cursor spans (SweepCells), so
        // resolved cells settle to `text-text-primary` as the cursor passes
        // rather than the whole name flashing accent-green (260704-pr0p rework).
        className="max-w-[16ch] sm:max-w-[28ch] text-sm font-semibold text-text-primary inline-flex items-center coarse:min-h-[30px]"
      >
        {/* Truncation lives on an inner span, NOT the button: text-overflow is
            inert on a flex container, and the flex centering clipped long names
            on BOTH ends (riff-blustery-whale → "iff-blustery-whal", no
            ellipsis). The span is left-anchored, so a long name keeps its head
            and cuts at the tail with an ellipsis; the button (and heading)
            itself stays centered in the bar's grid cell. */}
        <span className="min-w-0 truncate">
          <SweepCells cells={nameCells} scrambling={sweep.scrambling} />
        </span>
      </button>
    </>
  );
}

/**
 * Display-only universal center heading for board / root / cockpit (change
 * 260704-pr0p). Renders the same boot sweep as `WindowHeading` but with NO
 * rename affordance (board has no rename API; the server/board name is
 * display-only). Two shapes:
 *  - prefixed: a static `PageType:` sibling span + the boot-swept name
 *    (`Board: <board>`, `Server Cabin: <server>`).
 *  - solo: just the type word swept alone (`Cockpit`) — no prefix, no name; it
 *    is the leaf/name-equivalent, so it stays visible at all breakpoints and
 *    renders primary-medium (PageHeading's solo rule).
 *
 * Hover replays the sweep behind the 140ms intent delay; mouseleave resolves to
 * rest; the sweep plays once on MOUNT and once on every later name change;
 * reduced motion skips the sweep entirely. Not remounted per route so a name
 * change replays instead of a fresh mount re-seeding the prev-name ref.
 *
 * A11y: the identity carries a STABLE `aria-label` (the churn glyphs are
 * `aria-hidden` inside SweepCells). The label sits on a `role="group"` wrapper
 * — `aria-label` is prohibited on the implicit `role="generic"` of a bare
 * `<span>`/`<div>` (ARIA 1.2), and `group` names the prefix+name as one
 * identity atom WITHOUT introducing a document-outline heading (intake
 * assumption #18: no `<h1>`/heading is added to the top bar).
 */
function PageHeadingDisplay({
  prefix,
  name,
  solo = false,
  ariaLabel,
}: {
  prefix: string;
  name: string;
  solo?: boolean;
  ariaLabel: string;
}) {
  const sweep = useBootSweep(prefix, name, solo);
  // Seeded `null` so the name-effect fires ONCE on mount — the mount /
  // route-transition replay leg (260704-pr0p rework M1). Headings remount
  // across page types, so without this leg navigating between page types never
  // animated. Mount sets `prevNameRef` to the real name, so only a genuine
  // later name change replays (no mount double-play).
  const prevNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (name !== prevNameRef.current) {
      prevNameRef.current = name;
      sweep.play();
    }
  }, [name, sweep]);

  if (solo) {
    return (
      <span
        role="group"
        aria-label={ariaLabel}
        onMouseEnter={sweep.playDeferred}
        onMouseLeave={sweep.resolve}
        // Container keeps its REST color throughout the sweep; the green lives
        // only on the per-cell cursor span (SweepCells), so the solo word
        // settles to `text-text-primary` cell-by-cell rather than flashing
        // accent-green as a whole (260704-pr0p rework M2).
        className="text-sm font-medium text-text-primary inline-flex items-center coarse:min-h-[30px] whitespace-pre"
      >
        <SweepCells cells={sweep.cells} scrambling={sweep.scrambling} />
      </span>
    );
  }

  const { prefix: prefixCells, name: nameCells } = splitSweepCells(sweep.cells);
  return (
    // role="group" + aria-label: see the component doc comment (ARIA-valid
    // naming without a heading). No flex `gap`: the single prefix↔name
    // separator is the sweep's own `sp` space cell (N4 — a `gap-1` on top of it
    // double-spaced them).
    <span
      role="group"
      aria-label={ariaLabel}
      onMouseEnter={sweep.playDeferred}
      onMouseLeave={sweep.resolve}
      className="inline-flex items-center min-w-0 coarse:min-h-[30px]"
    >
      <HeadingPrefix cells={prefixCells} scrambling={sweep.scrambling} />
      {/* Name keeps its REST color throughout the sweep (green lives only on
          the per-cell churn/cursor spans) so resolved cells settle to
          `text-text-primary` as the cursor passes (260704-pr0p rework M2). */}
      <span className="max-w-[16ch] sm:max-w-[28ch] text-sm font-semibold text-text-primary truncate">
        <SweepCells cells={nameCells} scrambling={sweep.scrambling} />
      </span>
    </span>
  );
}

/**
 * Board-mode LEFT info (260704-pr0p): `{n} pane(s) · {n} server(s) · ⌘[⌘] cycle`.
 * Hidden on `< 640px` via `hidden sm:inline`, matching the chrome mobile-hide
 * pattern. Move-don't-copy: the board name + ▾ switcher moved OUT to the center
 * heading (§ BoardSwitcher), and the old left `Board ▸` home button is gone —
 * the brand crumb is already the home affordance, and a left "Board" word would
 * duplicate the type word now centered. Only the counts/hint stays left
 * (centering it would crowd the center slot).
 */
function BoardModeInfo({
  paneCount,
  serverCount,
  waitingPaneCount,
}: {
  paneCount: number;
  serverCount: number;
  waitingPaneCount: number;
}) {
  const paneNoun = paneCount === 1 ? "pane" : "panes";
  const serverNoun = serverCount === 1 ? "server" : "servers";
  return (
    <span className="hidden sm:inline ml-2 text-xs text-text-secondary">
      {paneCount} {paneNoun} · {serverCount} {serverNoun}
      {/* Attention rollup (260706-y1ar): count of waiting panes on this board.
          Constant-yellow, hidden at 0 (WaitingBadge renders null). */}
      {waitingPaneCount > 0 && (
        <>
          {" · "}
          <WaitingBadge
            count={waitingPaneCount}
            label={`${waitingPaneCount} pane(s) on this board waiting for input`}
          />
        </>
      )}
      {" · ⌘[⌘] cycle"}
    </span>
  );
}

/**
 * Board switcher — the bare-`▾` `BreadcrumbDropdown` beside the centered board
 * heading (260704-pr0p relocated it from the left breadcrumb, mirroring how the
 * window switcher sits beside the WindowHeading). It inherits the shared
 * dropdown a11y (`role="menu"`/`menuitem`, Escape, ArrowUp/Down, outside-click)
 * and keeps the `← Sessions` shortcut in the `action` slot.
 */
function BoardSwitcher({
  boardName,
  boards,
}: {
  boardName: string;
  boards: { name: string }[];
}) {
  const navigate = useNavigate();

  const boardItems: BreadcrumbDropdownItem[] = boards.map((b) => ({
    label: b.name,
    href: `/board/${encodeURIComponent(b.name)}`,
    current: b.name === boardName,
  }));

  const handleNavigate = useCallback(
    (href: string) => {
      // `href` is `/board/{encoded-name}` — decode and route via the typed
      // navigator so route params are validated.
      const match = href.match(/^\/board\/(.+)$/);
      if (match) {
        navigate({ to: "/board/$name", params: { name: decodeURIComponent(match[1]) } });
      }
    },
    [navigate],
  );

  return (
    <BreadcrumbDropdown
      items={boardItems}
      label="board"
      title="Board"
      onNavigate={handleNavigate}
      action={{ label: "← Sessions", onAction: () => navigate({ to: "/" }) }}
      triggerClassName="ml-1 text-text-secondary hover:text-text-primary transition-colors shrink-0"
    />
  );
}

function ThemeToggle() {
  const { preference, resolved, themeDark, themeLight } = useTheme();
  const { setTheme } = useThemeActions();

  // Derive current mode: system, light, or dark
  const mode = preference === "system" ? "system" : resolved;

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("theme-selector:open"));
      return;
    }

    // Cycle: system → light (themeLight) → dark (themeDark) → system
    if (mode === "system") {
      setTheme(themeLight);
    } else if (mode === "light") {
      setTheme(themeDark);
    } else {
      setTheme("system");
    }
  };

  const label = mode === "system" ? "System theme" : mode === "light" ? "Light theme" : "Dark theme";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
      title={label}
    >
      {mode === "system" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="2" width="14" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="14" x2="11" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="8" y1="11" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : resolved === "light" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="8" y1="1" x2="8" y2="2.5" />
            <line x1="8" y1="13.5" x2="8" y2="15" />
            <line x1="1" y1="8" x2="2.5" y2="8" />
            <line x1="13.5" y1="8" x2="15" y2="8" />
            <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" />
            <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" />
            <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" />
            <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" />
          </g>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6 2a6 6 0 1 0 8 8c-3.3 0-6-2.7-6-6a6 6 0 0 0-2-2z" />
        </svg>
      )}
    </button>
  );
}

// Help — external docs/landing page. Opens in a new tab. Exported so the
// command-palette "Help: Documentation" action (app.tsx) shares the same URL
// and the two can never drift (pattern: NOTIFICATIONS_HELP_URL below).
export const HELP_URL = "https://shll.ai/run-kit";

// Help link chip — route-agnostic, sits after ThemeToggle in the right cluster.
// Anchor (not button): it navigates externally, so target="_blank" +
// rel="noopener noreferrer" keeps the live dashboard (terminals, SSE) mounted.
function HelpLink() {
  return (
    <a
      href={HELP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Help — run-kit docs"
      title="Help — run-kit docs"
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.75 6a2.25 2.25 0 1 1 3.2 2.04c-.62.29-.95.79-.95 1.35v.36"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="8" cy="12.25" r="0.9" fill="currentColor" />
      </svg>
    </a>
  );
}


function SplitButton({
  horizontal,
  server,
  windowId,
  cwd,
}: {
  horizontal?: boolean;
  server: string;
  windowId: string;
  cwd?: string;
}) {
  const label = horizontal ? "Split horizontally" : "Split vertically";
  const { addToast } = useToast();

  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => splitWindow(server, windowId, !!horizontal, cwd),
    onError: (err) => {
      addToast(err.message || "Failed to split pane");
    },
  });

  return (
    <button
      type="button"
      onClick={() => execute()}
      disabled={isPending}
      aria-label={label}
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      title={label}
    >
      {isPending ? (
        <LogoSpinner size={14} />
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {horizontal ? (
            <>
              {/* square-split-horizontal: vertical divider */}
              <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3" />
              <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3" />
              <line x1="12" x2="12" y1="4" y2="20" />
            </>
          ) : (
            <>
              {/* square-split-vertical: horizontal divider */}
              <path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3" />
              <path d="M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3" />
              <line x1="4" x2="20" y1="12" y2="12" />
            </>
          )}
        </svg>
      )}
    </button>
  );
}

/**
 * The L2 ✕ chip — mode-aware (260704-9o7k). Two behaviors, one component:
 *  - Terminal (default): `closePane(server, windowId)` kills the active pane of
 *    the current window (unchanged optimistic path, spinner while pending).
 *  - Board (`onUnpin` provided): calls `onUnpin` to unpin the board's focused
 *    pane — a non-destructive move-out, NOT a kill. Board wiring passes a
 *    board-specific `label` ("Unpin pane from board") and `disabled` (zero
 *    panes). One component keeps the shared chip styling/spinner in one place.
 */
function ClosePaneButton({
  server,
  windowId,
  onUnpin,
  disabled,
  label = "Close pane",
}: {
  server?: string;
  windowId?: string;
  onUnpin?: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const { addToast } = useToast();

  // Terminal kill path — only meaningful when there is no `onUnpin` override.
  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => closePane(server ?? "", windowId ?? ""),
    onError: (err) => {
      addToast(err.message || "Failed to close pane");
    },
  });

  // Board unpin is synchronous (no await/spinner); terminal close shows the
  // optimistic spinner and disables while the kill is in flight.
  const busy = onUnpin ? false : isPending;
  const isDisabled = disabled || busy;

  return (
    <button
      type="button"
      onClick={() => (onUnpin ? onUnpin() : execute())}
      disabled={isDisabled}
      aria-label={label}
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      title={label}
    >
      {busy ? (
        <LogoSpinner size={14} />
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
    </button>
  );
}

/**
 * Best-effort hard reload, Chrome Shift+reload style: a `cache: "reload"`
 * fetch of the current document forces a network round-trip that overwrites
 * the HTTP cache entry, so the follow-up `location.reload()` serves the fresh
 * copy (hashed Vite assets self-bust; the document is the only cacheable
 * stale-able resource). `location.reload(true)` is not an option — the
 * forceGet flag is dead in modern browsers. Reloads regardless of fetch
 * outcome: a force-refresh must never be blocked by a failing network — so the
 * fetch races a short timeout (`fetch` can hang indefinitely on a stalled
 * socket that never resolves *or* rejects, and `.catch` alone would not cover
 * that), and `reload()` fires exactly once whichever settles first.
 */
export function forceReload() {
  const FORCE_RELOAD_TIMEOUT_MS = 3000;
  let timer: ReturnType<typeof setTimeout>;
  Promise.race([
    fetch(window.location.href, { cache: "reload" }).catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(resolve, FORCE_RELOAD_TIMEOUT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    window.location.reload();
  });
}

/**
 * Full-page refresh button — a plain `window.location.reload()` recovery
 * affordance in the top-bar cluster, next to ClosePaneButton. Shift+click
 * force-reloads (bypasses the HTTP cache via `forceReload`), mirroring
 * Chrome's Shift+reload. Unlike Split / Close there is NO async action to
 * await (the page unloads synchronously), so it deliberately carries no
 * `useOptimisticAction`/`isPending`/`LogoSpinner` and no `disabled` state — a
 * spinner would never meaningfully render. The reload is non-destructive by
 * design (constitution II/VI: state re-derives on load; tmux is unaffected),
 * so no confirmation dialog either. The same action is also reachable from
 * the command palette as "View: Refresh Page" — in AppShell's palette
 * (app.tsx `viewActions`) and, duplicated, in the board route's own palette
 * (board-page.tsx `refreshEntry`); the Cockpit `/` mounts no palette — a
 * pre-existing, out-of-scope limitation (mounting one to add this entry would
 * grow UI surface against constitution IV, Minimal Surface Area).
 */
function RefreshButton() {
  return (
    <button
      type="button"
      onClick={(e) => (e.shiftKey ? forceReload() : window.location.reload())}
      aria-label="Refresh page"
      title="Refresh page (Shift+click: force reload)"
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* lucide rotate-cw: circular arrow with a top-right arrowhead */}
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  );
}

/**
 * Terminal font-size combo: `[−] {size} [+]` plus a reset button. Reads the
 * effective `terminalFontSize` from ChromeContext and dispatches the global
 * increase/decrease/reset mutators (the setting applies to every live
 * terminal). The ± buttons disable at the TERMINAL_FONT_BOUNDS edges. Reset
 * "forgets" the preference, reverting to the device default.
 *
 * Cmd +/- is deliberately NOT intercepted — these controls (plus the matching
 * command-palette actions) are the only font levers; browser-native zoom stays
 * available for whole-page scaling.
 */
/**
 * Terminal font size control: a single "Aa" trigger button in the top bar that
 * opens a popover with the −/value/+ stepper and a reset. Collapsing the
 * stepper into a popover keeps the top-bar chrome minimal (one slot instead of
 * four loose buttons) while preserving a visible current value once opened.
 *
 * Dismiss semantics mirror `BreadcrumbDropdown`: outside `mousedown` closes,
 * Escape closes and returns focus to the trigger, and the trigger carries
 * `aria-haspopup`/`aria-expanded`. The three actions are also reachable from
 * the command palette (Constitution V — keyboard-first), so the popover is a
 * convenience surface, not the only path.
 */
function TerminalFontControl() {
  const { terminalFontSize } = useChromeState();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const atMin = terminalFontSize <= TERMINAL_FONT_BOUNDS.min;
  const atMax = terminalFontSize >= TERMINAL_FONT_BOUNDS.max;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, { capture: true });
    };
  }, [open]);

  const stepButtonClass =
    "min-w-[28px] min-h-[28px] coarse:min-w-[36px] coarse:min-h-[36px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border";

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Terminal font size"
        title="Terminal font size"
        className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center text-xs font-semibold leading-none ${
          open
            ? "border-accent text-accent bg-accent/10"
            : "border-border text-text-secondary hover:border-text-secondary"
        }`}
      >
        {/* "Aa" reads as "text size" without a separate label */}
        <span aria-hidden="true">Aa</span>
      </button>
      {open && (
        <div
          role="group"
          aria-label="Terminal font size"
          className="absolute top-full right-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl p-2 z-50 flex flex-col gap-2"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={decreaseTerminalFont}
              disabled={atMin}
              aria-label="Decrease terminal font"
              title="Decrease terminal font"
              className={stepButtonClass}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <line x1="3" y1="7" x2="11" y2="7" />
              </svg>
            </button>
            <span
              className="min-w-[4ch] text-center text-xs text-text-primary tabular-nums select-none"
              aria-label={`Terminal font size ${terminalFontSize} pixels`}
            >
              {terminalFontSize}px
            </span>
            <button
              type="button"
              onClick={increaseTerminalFont}
              disabled={atMax}
              aria-label="Increase terminal font"
              title="Increase terminal font"
              className={stepButtonClass}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <line x1="3" y1="7" x2="11" y2="7" />
                <line x1="7" y1="3" x2="7" y2="11" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            onClick={resetTerminalFont}
            aria-label="Reset terminal font"
            title="Reset terminal font (device default)"
            className="w-full text-xs text-text-secondary hover:text-text-primary transition-colors py-1 rounded hover:bg-bg-card flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* circular-arrow reset glyph */}
              <path d="M11.5 7a4.5 4.5 0 1 1-1.32-3.18" />
              <polyline points="11.5,1.5 11.5,4 9,4" />
            </svg>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Top-bar update chip (L3 right cluster). Self-contained — reads the
 * update-notification state from SessionContext via `useUpdateNotification`
 * (no props threaded through TopBar), mirroring NotificationControl /
 * ThemeToggle. In-app only: NO Web Push (update notices must not buzz phones).
 *
 * Rest: `⬆ v{latest}` with accent styling + CRT-glint hover (`rk-glint`, the
 * button hover vocabulary). Clicking the chip body triggers POST /api/update and
 * enters a disabled `updating…` state; the daemon restart then drops SSE, and
 * the reconnect's differing `version` drives the reload guard (session-context).
 * A small `✕` dismisses per-version (localStorage `runkit-update-dismissed`).
 * Renders nothing unless a qualifying, un-dismissed update is pending and the
 * daemon is not the `dev` version.
 */
function UpdateChip() {
  const { showChip, latest, updateNow, dismissUpdate } = useUpdateNotification();
  const [updating, setUpdating] = useState(false);
  const { addToast } = useToast();

  if (!showChip || !latest) return null;

  const handleUpdate = () => {
    if (updating) return;
    setUpdating(true);
    // On success the daemon restarts and the SSE reconnect's version change
    // reloads the tab, so we never need to clear `updating` on the happy path.
    // On failure (409 not-brew / no-update, network) surface a toast and
    // re-enable so the user can retry or read the message.
    void updateNow().catch((err: unknown) => {
      setUpdating(false);
      addToast(err instanceof Error ? err.message : "Update failed", "error");
    });
  };

  return (
    <span className="hidden sm:flex items-center">
      <button
        type="button"
        onClick={handleUpdate}
        disabled={updating}
        aria-label={updating ? "Updating run-kit" : `Update run-kit to v${latest}`}
        title={updating ? "Updating\u2026" : `Update run-kit to v${latest}`}
        className="rk-glint flex items-center gap-1 h-[24px] coarse:h-[30px] px-1.5 rounded border border-accent-green text-accent-green hover:border-accent-green transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {updating ? (
          <>
            <LogoSpinner size={12} />
            <span>{"updating\u2026"}</span>
          </>
        ) : (
          <span>{`\u2B06 v${latest}`}</span>
        )}
      </button>
      {!updating && (
        <button
          type="button"
          onClick={dismissUpdate}
          aria-label="Dismiss update notice"
          title="Dismiss update notice"
          className="ml-0.5 h-[24px] coarse:h-[30px] w-[16px] coarse:w-[20px] flex items-center justify-center rounded text-text-secondary hover:text-text-primary transition-colors text-xs"
        >
          {"\u2715"}
        </button>
      )}
    </span>
  );
}

// Nerd Font bell glyphs (same icon system as the sidebar status panel):
// U+F0F3 bell (notifications on), U+F1F6 bell-slash (off / available).
const BELL_ON = "\uF0F3";
const BELL_OFF = "\uF1F6";

// Notifications help page (rendered by GitHub). Opens in a new tab from the
// bell dropdown \u2014 the canonical "it says sent but nothing shows" guide.
const NOTIFICATIONS_HELP_URL =
  "https://github.com/sahil87/run-kit/blob/main/docs/site/notifications.md";

/**
 * Top-bar notification control: a bell icon button (filled when subscribed,
 * bell-slash otherwise) opening a small dropdown to enable push and send a
 * local test notification. Self-contained — calls `usePushSubscription`
 * directly (no props threaded through TopBar), mirroring TerminalFontControl /
 * ThemeToggle. Renders nothing when push is unsupported (insecure context or no
 * service-worker support) so the bell never appears where it can't work.
 */
function NotificationControl() {
  const { state, enable, sendTest } = usePushSubscription();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, { capture: true });
    };
  }, [open]);

  // No bell at all where push can't work — keeps the affordance honest.
  if (state === "unsupported") return null;

  const subscribed = state === "subscribed";
  const denied = state === "denied";

  const statusLabel = subscribed
    ? "Notifications: on"
    : denied
      ? "Blocked in browser settings"
      : "Notifications: off";
  const ariaLabel = subscribed
    ? "Notifications on"
    : denied
      ? "Notifications blocked"
      : "Notifications off";

  const menuItemClass =
    "w-full text-left text-xs text-text-secondary hover:text-text-primary transition-colors py-1.5 px-2 rounded hover:bg-bg-card disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";

  return (
    <div ref={containerRef} className="relative hidden sm:inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={statusLabel}
        className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center leading-none ${
          open
            ? "border-accent text-accent bg-accent/10"
            : subscribed
              ? "border-border text-accent-bright hover:border-text-secondary"
              : "border-border text-text-secondary hover:border-text-secondary"
        }`}
      >
        <span aria-hidden="true" className="text-[13px] font-bold">
          {subscribed ? BELL_ON : BELL_OFF}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute top-full right-0 mt-1 min-w-[180px] bg-bg-primary border border-border rounded-lg shadow-2xl p-1.5 z-50 flex flex-col gap-0.5"
        >
          <div className="px-2 py-1 text-[11px] text-text-secondary select-none">
            {statusLabel}
          </div>
          {!subscribed && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void enable();
              }}
              className={menuItemClass}
            >
              Enable notifications
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void sendTest();
            }}
            disabled={!subscribed}
            title={subscribed ? "Send a local test notification" : "Enable notifications first"}
            className={menuItemClass}
          >
            Send test notification
          </button>
          {denied && (
            <div className="px-2 py-1 text-[11px] text-text-secondary select-none">
              Re-allow notifications for this site in your browser/OS settings.
            </div>
          )}
          <a
            href={NOTIFICATIONS_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            title="Open the notifications setup & troubleshooting guide on GitHub"
            className={`${menuItemClass} border-t border-border mt-0.5 pt-1.5`}
          >
            Notifications help…
          </a>
        </div>
      )}
    </div>
  );
}

function FixedWidthToggle() {
  const { fixedWidth } = useChromeState();
  const { toggleFixedWidth } = useChromeDispatch();

  return (
    <button
      onClick={toggleFixedWidth}
      aria-label="Toggle fixed terminal width"
      aria-pressed={fixedWidth}
      className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center ${
        fixedWidth
          ? "border-accent text-accent bg-accent/10"
          : "border-border text-text-secondary hover:border-text-secondary"
      }`}
      title={fixedWidth ? "Full width" : "Fixed width (900px)"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {fixedWidth ? (
          <>
            {/* Arrows pointing outward — expand */}
            <line x1="1" y1="7" x2="5" y2="7" />
            <polyline points="1,5 1,7 1,9" />
            <line x1="9" y1="7" x2="13" y2="7" />
            <polyline points="13,5 13,7 13,9" />
          </>
        ) : (
          <>
            {/* Arrows pointing inward — contract */}
            <line x1="1" y1="7" x2="5" y2="7" />
            <polyline points="5,5 5,7 5,9" />
            <line x1="9" y1="7" x2="13" y2="7" />
            <polyline points="9,5 9,7 9,9" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * Board-mode autofit toggle (738w). Mirrors `FixedWidthToggle`'s vocabulary
 * (rk-glint, `coarse:` touch sizing, `aria-pressed`, pressed-state accent
 * styling) but drives the per-board board-autofit preference (owned by
 * `BoardPage` via `useBoardAutofit`, plumbed through the top-bar slot context).
 * When on, board panes stretch to fill the row (≤4 panes) or floor at ~25% and
 * scroll (>4); when off, hand-tuned per-pane widths apply. The same flip is
 * reachable from the palette's `Board: Toggle Autofit` (Constitution V). The
 * icon is a set of columns filling a frame — the "panes fill the row" idea —
 * with the pressed (on) state showing filled columns.
 */
function BoardAutofitToggle({
  autofit,
  onToggle,
}: {
  autofit: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle board autofit"
      aria-pressed={autofit}
      className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center ${
        autofit
          ? "border-accent text-accent bg-accent/10"
          : "border-border text-text-secondary hover:border-text-secondary"
      }`}
      title={autofit ? "Autofit on (panes fill the row)" : "Autofit off (fixed pane widths)"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Outer frame = the board row */}
        <rect x="1" y="2.5" width="12" height="9" rx="1" />
        {/* Two internal dividers = panes sharing the row. When on, the panes are
            filled (they've stretched to fill); when off, just outlines. */}
        <line x1="5" y1="2.5" x2="5" y2="11.5" />
        <line x1="9" y1="2.5" x2="9" y2="11.5" />
        {autofit && (
          <>
            <rect x="1.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
            <rect x="5.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
            <rect x="9.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
          </>
        )}
      </svg>
    </button>
  );
}
