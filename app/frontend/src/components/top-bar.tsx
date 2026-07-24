import { useCallback, useState, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { LogoSpinner } from "@/components/logo-spinner";
import { useChromeState, useChromeDispatch, TERMINAL_FONT_BOUNDS } from "@/contexts/chrome-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useUpdateClick } from "@/hooks/use-update-click";
import { useUpdateNotification } from "@/contexts/session-context";
import { updateChipToolSummary } from "@/lib/palette-update";
import { splitWindow, closePane } from "@/api/client";
import { useWindowRename } from "@/hooks/use-window-rename";
import { finalizeSafeName, toSafeWindowName } from "@/lib/names";
import { prefersReducedMotion } from "@/lib/motion";
import { WaitingBadge } from "@/components/waiting-badge";
import { Tip, TipGroup } from "@/components/tip";
import { ViewSwitcher, ViewSwitcherMenuRows } from "@/components/view-switcher";
import { OpenButton, OpenMenuRows } from "@/components/open-button";
import { useOpenTargets } from "@/hooks/use-open-targets";
import { activePaneCwd, buildOpenTargets } from "@/lib/open-in-app";
import {
  TopBarOverflowMenu,
  type OverflowMenuRow,
  MENU_ROW_CLASS,
} from "@/components/top-bar-overflow-menu";
import { computeVisibleCount } from "@/lib/top-bar-overflow";
import type { ViewName } from "@/lib/window-view";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

export type TopBarMode = "terminal" | "board" | "server" | "host";

/**
 * A right-cluster control's registry entry (260715-h1ck). Order in the registry
 * array encodes drop priority (L1 → L2 → L3, leftmost-first within a tier). The
 * registry drives BOTH the bar (first N candidates → `barRender`) and the
 * overflow menu (the rest → `menuRender`) from one ordered source.
 *
 *  - `id`        — stable key + overflow identity.
 *  - `modes`     — the entry renders only when the current mode is listed.
 *  - `hidden`    — optional per-item opt-out: when true the entry renders
 *                  NOWHERE (not bar, not menu, not probe) — e.g. push
 *                  unsupported, no current window, no qualifying update.
 *  - `menuOnly`  — optional placement demotion (260722-n2n4): the entry NEVER
 *                  renders in-bar (not in the visible row, not in the
 *                  measurement probe, not in the fit computation — zero fit
 *                  pixels) while its `menuRender()` rows ALWAYS render in the
 *                  overflow menu, in registry order. `hidden` keeps its
 *                  "renders nowhere" priority over `menuOnly`.
 *  - `barRender` — the in-bar icon-button form (may return null).
 *  - `menuRender`— the labeled menu-row form (may return null; the update chip
 *                  returns null because its function merges into the version row).
 */
type RegistryEntry = {
  id: string;
  modes: TopBarMode[];
  hidden?: boolean;
  /** When true the entry NEVER renders in-bar (not in the visible row, not in
   *  the measurement probe, not in the fit computation) — its menuRender()
   *  rows ALWAYS render in the overflow menu (subject to `hidden`). */
  menuOnly?: boolean;
  barRender: () => ReactNode;
  menuRender: () => ReactNode;
};

type TopBarProps = {
  /**
   * Mode controls the breadcrumb / informational region and the center page
   * heading. The center cell carries a universal `PageType: name` heading in
   * EVERY mode (260704-pr0p); the left breadcrumb always ends at the PARENT
   * (move-don't-copy — the leaf is the centered heading, never duplicated):
   * - `terminal` (default, `/$server/$window`) — left: brand + hamburger +
   *   server link + session dropdown (ends at session). Center: `Terminal:
   *   <window>` editable heading + ▾ window switcher.
   * - `server` (`/$server` with no window, the tmux Server) — left: brand +
   *   hamburger (ends at the parent = home). Center: `tmux Server: <server>`
   *   display heading (the server leaf moved here from the left breadcrumb).
   * - `board` (`/board/$name`) — left: brand + hamburger + pane/server counts +
   *   cycle hint (the `Board ▸` home button is gone). Center: `Board: <board>`
   *   display heading + ▾ board switcher (moved from the left breadcrumb).
   * - `host` (`/`, the Server List home) — brand crumb ONLY (left). Center:
   *   the solo `Host` word. No hamburger
   *   (the Host page has no sidebar), no terminal-font control, no split/close
   *   buttons, no fixed-width button (terminal-only since 260704-9o7k). The L3
   *   always-block (Notification · Theme · Refresh · Help) still renders, plus
   *   the connection dot — which on the Host page reflects host-metrics stream health
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
  sidebarOpen: boolean;
  server: string;
  onNavigate: (windowId: string) => void;
  onToggleSidebar: () => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
  /** Open the spawn-agent dialog for a session (260713-sbk1). When present, the
   *  terminal-mode window-switcher dropdown shows a `+ New Agent` item beside
   *  `+ New Window`. Absent → no `+ New Agent` (e.g. before AppShell registers). */
  onSpawnAgent?: (session: string) => void;
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
  /** Board-mode split/kill target (260715-6jwn): the focused tile's window.
   *  Feeds the two top-bar SplitButtons AND the ✕ (a consequence-gated Kill in
   *  board mode — co9z). `null` when the board is empty → splits absent, ✕
   *  disabled. `cwd` seeds the split's working directory. */
  focusedPane?: { server: string; windowId: string; cwd?: string } | null;
  /** Board-mode kill request (co9z): when present, the board ✕ calls this to
   *  open `BoardPage`'s consequence-gated kill dialog instead of firing
   *  `closePane` directly, and the ✕ reads "Kill". The confirmed kill's
   *  self-heal refetch is owned by `BoardPage` (`executeKillWindow`'s
   *  `onSettled`). Absent → terminal-mode close-pane behavior. */
  onRequestKill?: () => void;
  /** Board-mode autofit state (738w) — reflected by the L2 toggle's
   *  `aria-pressed`. Wired from `board-page.tsx` via the slot context. */
  autofit?: boolean;
  /** Board-mode autofit setter (738w) — flips the same state the palette's
   *  `Board: Toggle Autofit` action flips. Absent → no toggle rendered. */
  onToggleAutofit?: () => void;
  /** Terminal-mode window-view lens machinery (spec R4; chat folded in from
   *  260714-r7rq). The capability set of the current window; the switcher chip
   *  renders only when it exceeds `{tty}`. Absent/`["tty"]` → no chip. */
  availableViews?: ViewName[];
  /** The current window's active lens — drives the L1 ViewSwitcher's active
   *  segment AND the center heading's page-type prefix (`Terminal:`/`Web:`/
   *  `Chat:`). Absent → treated as `tty` (the pre-lens default). */
  activeView?: ViewName;
  /** Handler that switches the current window's lens (URL param + localStorage);
   *  wired from AppShell's `switchView`. Absent → no switcher rendered. */
  onSelectView?: (view: ViewName) => void;
};

function HamburgerIcon({ isOpen }: { isOpen: boolean }) {
  // Notion-style sidebar pictogram: rounded-rect with an internal vertical
  // divider ~30% from the left. The left column fills when the sidebar is
  // open and empties when collapsed — same shape both states, only the fill
  // flips, so the icon's identity ("this is a sidebar toggle") never changes.
  return (
    <svg
      width="20"
      height="20"
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

/**
 * Browser-history Back/Forward arrows (260714-uco1). Fixed-width ◀ ▶ buttons
 * left of the heading prefix, inside the anchored center box (§ HistoryNav
 * placement) — being fixed-width they never shift the heading's text anchor.
 * Rendered on ALL four page modes (history is global). Semantics are BROWSER
 * HISTORY via TanStack Router's `router.history.back()` / `.forward()` —
 * explicitly NOT previous/next sibling-window cycling.
 *
 * Forward is always-active (browser-chrome style): `canGoForward` is not
 * reliably exposed by browsers, so a dim/disabled forward state is best-effort
 * only and deliberately omitted — clicking forward with no forward entry is a
 * harmless no-op. The same two actions are reachable from the command palette
 * (`Go: Back` / `Go: Forward`, Constitution V; see lib/palette-nav.ts).
 *
 * Styling matches the top-bar icon-button convention (`rk-glint`, `coarse:`
 * touch sizing, bordered chip). The pair sits in its own `shrink-0` group so
 * the arrows keep a stable width regardless of heading length.
 */
function HistoryNav() {
  const router = useRouter();
  const arrowClass =
    "rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center shrink-0";
  return (
    // mr-2.5 (10px) separates the arrows from the page heading — the arrows are
    // global chrome, not part of the heading, so their gap must read WIDER than
    // the heading's own internal prefix↔name spacing (~4px, see HeadingPrefix's
    // -mr-1). Exactly +4px so the pair is width-neutral with -mr-1's −4px: the
    // heading's fixed furniture inside the `sm:min-w-[28ch]` anchor box must
    // not grow, or names near the band edge start drifting the anchor (see the
    // stable-anchor e2e in window-heading.spec.ts).
    <span className="flex items-center gap-1 mr-2.5 shrink-0">
      <Tip label="Back">
        <button
          type="button"
          onClick={() => router.history.back()}
          aria-label="Go back"
          className={arrowClass}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* chevron-left */}
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </Tip>
      <Tip label="Forward">
        <button
          type="button"
          onClick={() => router.history.forward()}
          aria-label="Go forward"
          className={arrowClass}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* chevron-right */}
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </Tip>
    </span>
  );
}

/**
 * Hierarchy dropdown (260714-uco1) — a bare-▾ `BreadcrumbDropdown` bound to the
 * heading prefix, listing exactly the CURRENT PAGE'S ANCESTOR CHAIN (no lateral
 * jumps, to stay predictable). Reuses `BreadcrumbDropdown` (which already owns
 * the menu a11y: `role="menu"`/`menuitem`, Escape, ArrowUp/Down, outside-click)
 * so this is a thin item-builder, not a new dropdown.
 *
 * Ancestor chains by mode:
 *   - `terminal` (`/{server}/{window}`): `tmux Server: {server}` (→ `/{server}`)
 *     then `Host` (→ `/`).
 *   - `board` / `server`: `Host` (→ `/`) — their only ancestor.
 *   - solo `host`: NONE — the caller does not render this component there.
 *
 * It is a SIBLING of the rename button (not inside it), so clicking it never
 * enters inline edit. It is `hidden sm:inline-flex` — below `sm` it rides with
 * the hidden prefix span (the hamburger/sidebar covers mobile navigation). It
 * is passed as the prefix `caret`, so `HeadingPrefix` renders it BETWEEN the
 * prefix word and its trailing colon (reads `Window ▾: name`, intake §3 —
 * "the hierarchy ▾ binds to the prefix, before the colon"). The single
 * boot-sweep cursor pass is preserved: the caret splits only the prefix's DOM
 * at render time, never the swept cell array.
 */
function HierarchyDropdown({
  mode,
  server,
}: {
  mode: "terminal" | "board" | "server";
  server: string;
}) {
  const navigate = useNavigate();

  // Ancestor items, nearest-first (tmux Server above Host on a window
  // route). `current: false` throughout — an ancestor is never the current page.
  const items: BreadcrumbDropdownItem[] = [];
  if (mode === "terminal" && server) {
    items.push({
      label: `${TMUX_SERVER_PREFIX} ${server}`,
      href: `/${encodeURIComponent(server)}`,
      current: false,
    });
  }
  items.push({ label: HOST_SOLO, href: "/", current: false });

  const handleNavigate = useCallback(
    (href: string) => {
      // `/` → Host (index route); `/{server}` → tmux Server. Route via the
      // typed navigator so params are validated (mirrors BoardSwitcher).
      if (href === "/") {
        navigate({ to: "/" });
        return;
      }
      const match = href.match(/^\/([^/]+)$/);
      if (match) {
        navigate({ to: "/$server", params: { server: decodeURIComponent(match[1]) } });
      }
    },
    [navigate],
  );

  return (
    <span className="hidden sm:inline-flex items-center shrink-0 ml-0.5">
      <BreadcrumbDropdown
        items={items}
        label="hierarchy"
        title="Navigate up"
        onNavigate={handleNavigate}
        triggerClassName="text-text-secondary hover:text-text-primary transition-colors shrink-0"
      />
    </span>
  );
}

export function TopBar({
  mode = "terminal",
  sessions,
  currentSession,
  currentWindow,
  sessionName,
  windowName,
  sidebarOpen,
  server,
  onNavigate,
  onToggleSidebar,
  onCreateSession,
  onCreateWindow,
  onSpawnAgent,
  boardName,
  paneCount,
  serverCount,
  waitingPaneCount,
  boards,
  focusedPane,
  onRequestKill,
  autofit,
  onToggleAutofit,
  availableViews,
  activeView,
  onSelectView,
}: TopBarProps) {
  // `showChip` tells us whether the UpdateChip WOULD render in the bar (a
  // qualifying, undismissed, non-dev update). When it does but the chip's
  // registry entry is overflowed into the menu, the version row becomes the
  // update surface and the chevron shows an attention badge (change areas 2–3).
  const { showChip, key: updateKey } = useUpdateNotification();

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

  // The Host page (`/`) has no sidebar, so it renders no hamburger. Every other mode
  // (terminal / server / board) has a Shell sidebar and shows the toggle.
  const hasSidebar = mode !== "host";

  // Move-don't-copy (260704-pr0p): the left breadcrumb always ends at the
  // PARENT; the current-page leaf is the centered heading. So the server crumb
  // renders in the left nav ONLY as a link back to the tmux Server on the
  // terminal route (parent = the tmux Server) — on the server route the server name is
  // the leaf and moves to the center heading, leaving the left breadcrumb at
  // brand + hamburger. The Host page and board have no left server crumb.
  const showServerCrumb = mode === "terminal" && !!server;
  const serverHref = `/${encodeURIComponent(server)}`;

  // Open-in-App data (260722-6d0f): sshHost/sshUser + host-app registry,
  // fetched once per page load via the module-cached hook (enabled only where
  // the control can render — the Terminal route). The target list composes
  // the local/remote branch + deeplink-host resolution chain (RK_SSH_HOST
  // verbatim, else derived `user@location.hostname` when remote — 260722-fc3b)
  // + section-visibility rules in `lib/open-in-app.ts`; the folder is the
  // current window's active-pane cwd. Zero targets (local + empty registry,
  // or a pathless window) hides the entry entirely.
  const openCtx = useOpenTargets(mode === "terminal");
  const openPath = mode === "terminal" ? activePaneCwd(currentWindow) : "";
  const openTargets =
    mode === "terminal"
      ? buildOpenTargets({
          hostname: window.location.hostname,
          sshHost: openCtx.sshHost,
          sshUser: openCtx.sshUser,
          hostApps: openCtx.hostApps,
          path: openPath,
        })
      : [];

  // ── Right-cluster overflow registry (260715-h1ck) ──────────────────────────
  //
  // The ordered registry replaces the hardcoded right-cluster JSX. It is the
  // SINGLE source that drives both the bar (first N candidates render as icon
  // buttons) and the overflow menu (the rest render as rows) — so bar↔menu can
  // never drift. Order encodes drop priority: L1 first, then L2, then L3, and
  // within a tier leftmost drops first (overflow consumes FROM THE FRONT). Only
  // the trailing chevron is EXEMPT (never overflows) and renders outside this
  // candidate list; the ViewSwitcher is the first REGISTRY entry
  // but is `menuOnly` (260722-n2n4) — it never renders in-bar and its menu rows
  // lead the chevron menu. Each entry gates on `modes` (the current mode
  // must be listed) and an optional `hidden` predicate (renders nowhere).
  // Board-mode split/close target (260715-6jwn, merged into the registry): the
  // two SplitButtons AND the ✕ act on the focused tile's window (`focusedPane`,
  // wired from board-page.tsx). The ✕ is a real close-pane in BOTH modes now (a
  // deliberate reversal of the prior board-✕-unpin decision) — unpin moved to
  // the tile header + the `Board: Unpin Focused Pane` palette action. Splits are
  // absent when the board is empty (no `focusedPane`); the ✕ is disabled then.
  const rightItems: RegistryEntry[] = [
    // View-switcher — the window-view lens control. MENU-ONLY as of 260722-n2n4:
    // the chat lens isn't fully functional yet, so the `[tty|chat]` (and, by the
    // one-switcher contract, `[tty|web]`) segmented pill must not advertise
    // itself inline in the navbar. The entry keeps its FIRST registry position —
    // its per-view `View: …` rows (ViewSwitcherMenuRows, carrying the
    // lens-indicator role) lead the chevron-menu rows at every width — but
    // `menuOnly` excludes it from the bar, the measurement probe, and the fit
    // budget entirely. The pill (`barRender`/ViewSwitcher) stays intact but
    // unreachable, so reverting when chat ships is deleting the one flag.
    // `hidden` mirrors the full render gate so a single-view (tty-only) window,
    // a non-terminal mode, or an unwired callback contributes no menu row.
    {
      id: "view-switcher",
      modes: ["terminal"],
      menuOnly: true,
      hidden: !(
        mode === "terminal" &&
        currentWindow &&
        onSelectView &&
        availableViews &&
        availableViews.length > 1
      ),
      barRender: () => (
        <ViewSwitcher
          views={availableViews ?? []}
          active={activeView ?? "tty"}
          onSelect={onSelectView ?? (() => {})}
        />
      ),
      menuRender: () => (
        <ViewSwitcherMenuRows
          views={availableViews ?? []}
          active={activeView ?? "tty"}
          onSelect={onSelectView ?? (() => {})}
        />
      ),
    },
    // Open-in-App split-button (260722-6d0f) — terminal-only, second candidate
    // so it yields to overflow right after the ViewSwitcher and BEFORE any L1
    // split (keeping the documented L1→L2→L3 pyramid sweep intact). Hidden
    // when the window is absent or zero targets are available (no sshHost +
    // empty host registry — the common default deployment). When overflowed it
    // renders per-target `Open: …` rows (OpenMenuRows).
    {
      id: "open",
      modes: ["terminal"],
      hidden: !(mode === "terminal" && currentWindow && openTargets.length > 0),
      barRender: () => <OpenButton targets={openTargets} server={server} path={openPath} />,
      menuRender: () => <OpenMenuRows targets={openTargets} server={server} path={openPath} />,
    },
    // L1 — split vertical · split horizontal (terminal+board) · fixed-width (terminal-only).
    {
      id: "split-vertical",
      modes: ["terminal", "board"],
      hidden: mode === "board" ? !focusedPane : !currentWindow,
      barRender: () =>
        mode === "board" ? (
          focusedPane ? (
            <SplitButton server={focusedPane.server} windowId={focusedPane.windowId} cwd={focusedPane.cwd} />
          ) : null
        ) : currentWindow ? (
          <SplitButton server={server} windowId={currentWindow.windowId} cwd={currentWindow.worktreePath} />
        ) : null,
      menuRender: () =>
        mode === "board" ? (
          focusedPane ? (
            <SplitMenuRow server={focusedPane.server} windowId={focusedPane.windowId} cwd={focusedPane.cwd} />
          ) : null
        ) : currentWindow ? (
          <SplitMenuRow server={server} windowId={currentWindow.windowId} cwd={currentWindow.worktreePath} />
        ) : null,
    },
    {
      id: "split-horizontal",
      modes: ["terminal", "board"],
      hidden: mode === "board" ? !focusedPane : !currentWindow,
      barRender: () =>
        mode === "board" ? (
          focusedPane ? (
            <SplitButton horizontal server={focusedPane.server} windowId={focusedPane.windowId} cwd={focusedPane.cwd} />
          ) : null
        ) : currentWindow ? (
          <SplitButton horizontal server={server} windowId={currentWindow.windowId} cwd={currentWindow.worktreePath} />
        ) : null,
      menuRender: () =>
        mode === "board" ? (
          focusedPane ? (
            <SplitMenuRow horizontal server={focusedPane.server} windowId={focusedPane.windowId} cwd={focusedPane.cwd} />
          ) : null
        ) : currentWindow ? (
          <SplitMenuRow horizontal server={server} windowId={currentWindow.windowId} cwd={currentWindow.worktreePath} />
        ) : null,
    },
    {
      id: "fixed-width",
      modes: ["terminal"],
      hidden: !currentWindow,
      barRender: () => <FixedWidthToggle />,
      menuRender: () => <FixedWidthMenuRow />,
    },
    // L2 — terminal + board: terminal-font (Aa) · autofit (board-only) · close-pane (✕).
    {
      id: "terminal-font",
      modes: ["terminal", "board"],
      barRender: () => <TerminalFontControl />,
      menuRender: () => <TerminalFontMenuRow />,
    },
    {
      id: "autofit",
      modes: ["board"],
      hidden: !(mode === "board" && !!onToggleAutofit),
      barRender: () => <BoardAutofitToggle autofit={autofit ?? false} onToggle={onToggleAutofit ?? (() => {})} />,
      menuRender: () => <AutofitMenuRow autofit={autofit ?? false} onToggle={onToggleAutofit ?? (() => {})} />,
    },
    {
      // Close-pane / Kill ✕. Terminal mode kills the current window's active pane
      // (immediate close-pane). Board mode (co9z) is a consequence-gated KILL:
      // the ✕ reads "Kill" and, via `onRequestKill`, opens BoardPage's confirm
      // dialog (with an `Unpin instead` escape) instead of firing immediately —
      // a board Kill destroys the window everywhere, not just the board pane. The
      // confirmed kill's self-heal refetch is owned by BoardPage
      // (`executeKillWindow`'s `onSettled`), not signalled back through the ✕.
      // Disabled on board when there is no focused tile.
      id: "close-pane",
      modes: ["terminal", "board"],
      hidden: mode === "terminal" && !currentWindow,
      barRender: () =>
        mode === "board" ? (
          <ClosePaneButton
            server={focusedPane?.server ?? ""}
            windowId={focusedPane?.windowId ?? ""}
            disabled={!focusedPane}
            onRequestKill={onRequestKill}
            label="Kill"
          />
        ) : currentWindow ? (
          <ClosePaneButton server={server} windowId={currentWindow.windowId} />
        ) : null,
      menuRender: () =>
        mode === "board" ? (
          <ClosePaneMenuRow
            server={focusedPane?.server ?? ""}
            windowId={focusedPane?.windowId ?? ""}
            disabled={!focusedPane}
            onRequestKill={onRequestKill}
            label="Kill"
          />
        ) : currentWindow ? (
          <ClosePaneMenuRow server={server} windowId={currentWindow.windowId} label="Close pane" />
        ) : null,
    },
    // L3 — always (all four modes): update chip · refresh. Theme, help, and the
    // notification bell LEFT the bar in 260724-6j1v — theme/help live in the
    // sidebar footer, notifications in the settings dialog.
    // The UpdateChip has NO menu row: when overflowed, its function merges into
    // the version row (the menu component owns that — including the dismissed-
    // pending update surface and the resting version + ⟳ check affordance,
    // 260720-ml7k). `hidden` keeps it out of the candidate set entirely when it
    // wouldn't render (not qualifying / dev / dismissed) so it never reserves
    // width or an empty slot. The chip IS the unified update button's promoted
    // form; promotion/demotion is pure derivation from `showChip` + fit — never
    // imperative movement.
    {
      id: "update-chip",
      modes: ["terminal", "board", "server", "host"],
      hidden: !showChip,
      barRender: () => <UpdateChip />,
      menuRender: () => null,
    },
    {
      id: "refresh",
      modes: ["terminal", "board", "server", "host"],
      barRender: () => <RefreshButton />,
      menuRender: () => <RefreshMenuRow />,
    },
  ];

  // Candidate (non-exempt) entries for the current mode, minus any `hidden` ones.
  const candidates = rightItems.filter((e) => e.modes.includes(mode) && !e.hidden);
  // Fit candidates — the entries eligible for IN-BAR placement. `menuOnly`
  // entries (260722-n2n4: the view-switcher) never render in-bar: they are
  // excluded from the visible row, the measurement probe, and the fit budget
  // (zero pixels). The probe's children must stay index-aligned with the widths
  // array the fit reads, so the probe renders exactly this list.
  const fitCandidates = candidates.filter((e) => !e.menuOnly);

  // Measurement: one ResizeObserver on the right cell + a hidden probe row that
  // renders every FIT candidate's BAR form so we always know each real width
  // (buttons vary — UpdateChip label, coarse sizing — so nothing is hardcoded).
  // `computeVisibleCount` decides how many leading fit candidates fit after
  // reserving the trailing exempt block (chevron + dot + gap). `menuOnly`
  // entries are not probed or fitted (260722-n2n4) — they live in the menu.
  // Collapse-first: `visibleCount` starts at 0 and is set in a layout effect
  // before paint, so no flash of overflowing buttons is shown.
  const rightCellRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  // Exempt-block ref whose measured width is RESERVED before fitting candidates:
  // the trailing chevron block (always present; the connection dot moved to the
  // sidebar footer, 260724-6j1v). Nothing is hardcoded — every reserved pixel
  // is measured.
  const trailingRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  // Serialize the FIT-candidate ids into a dependency key so the measure effect
  // re-runs when the probed SET changes (mode switch, a control appearing/
  // disappearing) — not on every render. `menuOnly` entries never affect the
  // fit, so they are deliberately absent from this key.
  const candidateKey = fitCandidates.map((c) => c.id).join(",");

  useLayoutEffect(() => {
    const cell = rightCellRef.current;
    const probe = probeRef.current;
    if (!cell || !probe) return;

    const RIGHT_GAP_PX = 12; // the cluster's `gap-3` (0.75rem)

    const measure = () => {
      const available = cell.clientWidth;
      // Reserve the exempt width (measured): the trailing chevron block,
      // joined to the candidate run by one gap.
      const trailing = trailingRef.current?.offsetWidth ?? 0;
      const reserved =
        trailing +
        RIGHT_GAP_PX; // gap between the last candidate and the chevron block
      // Overflow consumes the pyramid FROM THE LEFT (L1 drops first, L3 last —
      // the documented invariant). In the bar L1 is leftmost and L3 is pinned
      // rightmost, so the SURVIVING in-bar set is a SUFFIX of the registry
      // order. Reverse the widths (L3-end first) so `computeVisibleCount` greedily
      // fits from the tail; the returned N is how many trailing candidates fit.
      const widths = Array.from(probe.children).map((c) => (c as HTMLElement).offsetWidth);
      const reversed = [...widths].reverse();
      const n = computeVisibleCount(available, reversed, reserved, RIGHT_GAP_PX);
      setVisibleCount(n);
    };

    measure();
    // Observe the cell AND the probe/trailing nodes (review S2): a candidate's
    // own width can change (e.g. the UpdateChip's label width when the matched
    // set — hence the composite `updateKey` — changes) without resizing the
    // OUTER cell (its width is grid-determined). Observing the probe (which
    // renders every fit candidate's bar form) + the trailing chevron/dot block
    // re-fits on any of those. The `updateKey`/`showChip` deps additionally
    // re-run the whole effect when the candidate set or membership changes.
    // (The former `availableViews`/`activeView` deps are gone with 260722-n2n4:
    // the menuOnly ViewSwitcher is no longer probed, so its segment/active
    // changes can't affect the fit.) The trailing block (chevron) is observed
    // too so a chevron size change re-fits.
    const ro = new ResizeObserver(measure);
    ro.observe(cell);
    ro.observe(probe);
    if (trailingRef.current) ro.observe(trailingRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey, mode, updateKey, showChip]);

  // Keep the LAST `visibleCount` fit candidates in-bar (the L3-end suffix); the
  // rest (L1-end prefix) overflow. Surviving buttons keep their screen positions
  // — dropping L1 leftward never shifts the L2/L3 tail. Menu rows list the
  // menuOnly entries (260722-n2n4) plus the overflowed controls in pyramid order
  // (registry order = L1 → L2 → L3): deriving the overflow list by filtering the
  // FULL candidate list against the visible set keeps registry order for free,
  // so the view-switcher's `View:` rows stay the first menu rows.
  const splitAt = fitCandidates.length - visibleCount;
  const visibleItems = fitCandidates.slice(splitAt);
  const visibleIds = new Set(visibleItems.map((e) => e.id));
  const overflowItems = candidates.filter((e) => !visibleIds.has(e.id));
  const overflowRows: OverflowMenuRow[] = overflowItems
    .map((e) => ({ id: e.id, node: e.menuRender() }))
    .filter((r) => r.node != null);
  // True when the undismissed chip's entry is currently overflowed into the
  // menu — drives the chevron attention badge, and is one of the menu's two
  // update-surface derivations (the other, dismissed-pending, is computed
  // inside TopBarOverflowMenu from context — 260720-ml7k).
  const updateOverflowed = showChip && overflowItems.some((e) => e.id === "update-chip");

  return (
    <header className="px-3 border-b-[3px] border-border">
      {/* 3-column grid `1fr auto 1fr`: the center cell is truly centered
          regardless of asymmetric left/right widths. Left = left cluster
          (hamburger + breadcrumb nav, 260720-ap63), center = the universal
          `PageType: name` page heading (all four modes, 260704-pr0p),
          right = controls. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
        {/* Left cluster (260720-ap63): a flex wrapper so the hamburger — a
            drawer toggle, NOT a breadcrumb item — sits FIRST, outside the
            breadcrumb nav landmark, with the nav beside it inside the `1fr`
            left cell (the center heading's true centering is untouched).
            `min-w-0` lets the nav shrink below its content inside `1fr`. */}
        {/* One warm-tip cluster per chrome region (260722-73al): the left
            breadcrumb cluster shares a TipGroup so sweeping across crumbs
            opens sibling tips instantly (macOS-menu behavior). */}
        <TipGroup>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Hamburger icon — toggles sidebarOpen (one boolean covers both
              desktop grid column and mobile overlay). First element of the left
              cluster (standard drawer-toggle position). Not rendered on the
              Host page, which has no sidebar — the brand shifts left there (no
              ghost slot reserved). rk-glint: borderless at rest, so hover =
              green icon + sweep only (the glint border flip is a no-op without
              a border). Coarse pointers get the top-bar button-control 30px
              target (24px fine). */}
          {hasSidebar && (
            <button
              onClick={onToggleSidebar}
              aria-label="Toggle navigation"
              className="rk-glint text-text-primary transition-colors min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] flex items-center justify-center shrink-0"
            >
              <HamburgerIcon isOpen={hamburgerOpen} />
            </button>
          )}

          {/* Breadcrumb nav (260715-q8ey overlap fixes): `overflow-hidden`
              is the clip backstop — any crumb content past the floor clips at
              the nav edge instead of painting over the center heading. The
              explicit `min-w-[46px] sm:min-w-[150px]` floor guarantees the bare
              brand icon below `sm` (the hamburger sibling carries its own
              `shrink-0` + min sizes outside the nav — 260720-ap63 subtracted
              its 30px from the old 76/180 floor), plus a usable session crumb
              sliver at `sm+`. The two crumb wrapper spans carry `min-w-0`
              (below) so their inner `truncate max-w-[16ch]` engages under
              pressure — degradation ladder: crumbs truncate → server crumb
              hides below `md` → nav clips at its floor. */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-sm overflow-hidden min-w-[46px] sm:min-w-[150px]"
          >
            {/* Brand root crumb — logo + wordmark, links to `/`. The nav's
                first child (the breadcrumb's root — the `›` separator starts
                after it); IS the home affordance (no separate "Host" crumb).
                Wordmark collapses to the bare icon below `sm` so long crumbs
                still fit the single-line 375px topbar. */}
            <Tip label="Host">
            <a
              href="/"
              aria-label="RunKit home"
              className={`flex items-center gap-2 shrink-0 rk-brand-glitch ${LINK_CRUMB_CLASS}`}
            >
              {/* Inline SVG (LogoSpinner at rest), not the /icon.svg img — the
                  hover spin rotates the border ring (.rk-logo-ring) while the
                  cube faces stay pinned, which CSS can't reach inside an img. */}
              <LogoSpinner size={20} loading={false} />
              {/* [text-decoration:inherit] — the anchor is a flex container and
                  text-decoration does not propagate into flex items, so an
                  underline-based LINK_CRUMB_CLASS would silently skip the
                  wordmark without it. No-op for non-underline variants. */}
              <span className="hidden sm:inline text-xs [text-decoration:inherit]">RunKit</span>
            </a>
            </Tip>

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
                {/* Server LINK crumb — terminal route only (parent = the tmux
                    Server). On the server route the server name is the leaf and lives
                    in the center heading, so no left server crumb there. Hidden
                    below `md` (260715-q8ey — demoted from `sm`): it is the
                    redundant first-to-give crumb since the hierarchy ▾ in the
                    center heading (`Window ▾:`) already navigates to the tmux
                    Server → Host, so it gives way before the session crumb in
                    the cramped `sm`..`md` band. `min-w-0` unblocks the inner
                    `truncate max-w-[16ch]`. */}
                {showServerCrumb && (
                  <span className="hidden md:flex items-center gap-1.5 min-w-0">
                    <BreadcrumbSeparator />
                    <Tip label="tmux Server">
                      <a
                        href={serverHref}
                        className={`rk-glint truncate max-w-[16ch] ${LINK_CRUMB_CLASS}`}
                      >
                        {server}
                      </a>
                    </Tip>
                  </span>
                )}

                {sessionName && (
                  // The breadcrumb ends at the SESSION crumb — window identity
                  // moved to the centered heading (below), so the window name is
                  // never duplicated. Session crumb hidden below `sm`.
                  <span className="hidden sm:flex items-center gap-1.5 min-w-0">
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
        </div>
        </TipGroup>

        {/* Center cell — the universal `PageType: name` page heading, filled on
            EVERY mode (260704-pr0p): terminal = editable window heading + ▾
            window switcher; board = display board heading + ▾ board switcher
            (both moved here from the left breadcrumb); root = display server
            heading; host = solo `Host`. It stays centered under the
            `auto` middle grid column regardless of left/right widths, and on
            mobile it is the visible leaf (intermediate crumbs hide below `sm`). */}
        {/* No flex `gap` here: the single separator between the page-type prefix
            and the instance name is the boot sweep's own `sp` space cell (the
            cursor visibly crosses it) — a `gap-1` on top of it double-spaced
            them (260704-pr0p rework N4). The ▾ switchers carry their own `ml-1`
            so only the switcher gets separated from the name. */}
        {/* The OUTER cell stays centered in the `auto` grid column; the INNER
            container (260714-uco1) carries a `sm:`-gated min-width with
            left-aligned content so the heading's LEFT EDGE stops drifting as the
            instance name length changes. Below `sm` the min-width is absent
            (space is scarce at 375px) so current behavior is unchanged. The
            history arrows + hierarchy ▾ live inside this anchored box.
            260715-q8ey: the OUTER cell deliberately has NO `min-w-0` — that let
            the `auto` column compress below the heading's content floor and
            produced center-side overlap. The floor is already bounded (name
            spans `max-w-[16ch] sm:max-w-[28ch] truncate` + fixed-width
            `shrink-0` controls + the inner `sm:min-w-[28ch]` anchor), so
            dropping `min-w-0` protects the center without a magic pixel min. Do
            NOT re-add `min-w-0` here. */}
        <div className="flex items-center justify-center">
          {/* Center heading cluster's warm-tip group (260722-73al): history
              arrows + hierarchy ▾ + rename heading + window switcher sweep
              as one cluster. */}
          <TipGroup>
          <div className="flex items-center justify-start min-w-0 sm:min-w-[28ch]">
            {/* Browser-history ◀ ▶ arrows (260714-uco1) — fixed-width so they
                never shift the heading's text anchor, rendered on ALL four modes
                (history is global; also keeps the center box uniform, e.g.
                `◀ ▶  Host`). Left of the prefix, inside the anchored box. */}
            <HistoryNav />

            {mode === "terminal" && currentWindow && (
              <>
                {/* No `key` on the route identity: the instance persists across
                    window switches so the boot sweep replays on navigation and
                    an in-progress edit survives long enough to be intentionally
                    cancelled (see WindowHeading's identity-change guard) rather
                    than silently destroyed by a remount. The prefix is now a
                    STATIC `Window:` in every lens (260714-uco1) — the lens is
                    shown by the L1 ViewSwitcher, not the heading.

                    Hierarchy ▾ (260714-uco1) — the current page's ANCESTOR chain
                    (tmux Server → Host on a window route). Passed as the
                    prefix `caret` so it renders BEFORE the colon (`Window ▾:
                    name`, intake §3), bound to the prefix and hidden with it
                    below `sm`. It is a sibling of the rename button (not inside
                    it), so clicking it never enters inline edit. */}
                <WindowHeading
                  server={server}
                  windowId={currentWindow.windowId}
                  sessionName={sessionName}
                  name={windowName}
                  prefix={WINDOW_PREFIX}
                  caret={<HierarchyDropdown mode="terminal" server={server} />}
                />
                <BreadcrumbDropdown
                  items={windowItems}
                  label="window"
                  title="Window"
                  onNavigate={handleDropdownNavigate}
                  action={{ label: "+ New Window", onAction: () => onCreateWindow(sessionName) }}
                  // + New Agent — the second window-switcher entry point for the
                  // web-UI spawn flow (260713-sbk1). Rendered only when AppShell
                  // published an onSpawnAgent handler (terminal route with a session).
                  secondaryAction={
                    onSpawnAgent
                      ? { label: "+ New Agent", onAction: () => onSpawnAgent(sessionName) }
                      : undefined
                  }
                  triggerClassName="ml-1 text-text-secondary hover:text-text-primary transition-colors shrink-0"
                />
              </>
            )}

            {mode === "board" && boardName && (
              <>
                {/* Board name is display-only (boards have no rename API); the ▾
                    board switcher moved here from the left breadcrumb. The
                    hierarchy ▾ lists this board's ancestor (Host) and is
                    passed as the prefix `caret` so it renders BEFORE the colon
                    (`Board ▾: name`, matching the window heading's placement). */}
                <PageHeadingDisplay
                  prefix={BOARD_PREFIX}
                  name={boardName}
                  ariaLabel={`Board ${boardName}`}
                  caret={<HierarchyDropdown mode="board" server={server} />}
                />
                <BoardSwitcher boardName={boardName} boards={boards ?? []} />
              </>
            )}

            {mode === "server" && server && (
              <>
                {/* Hierarchy ▾ passed as the prefix `caret` so it renders BEFORE
                    the colon (`tmux Server ▾: name`), matching the window
                    heading's `Window ▾: name` placement (260714-uco1). */}
                <PageHeadingDisplay
                  prefix={TMUX_SERVER_PREFIX}
                  name={server}
                  ariaLabel={`tmux Server ${server}`}
                  caret={<HierarchyDropdown mode="server" server={server} />}
                />
              </>
            )}

            {mode === "host" && (
              // Solo `Host` — the root of the hierarchy, so NO hierarchy ▾
              // (it has no ancestors). The history arrows still render (above).
              <PageHeadingDisplay
                prefix=""
                name={HOST_SOLO}
                solo
                ariaLabel="Host"
              />
            )}
          </div>
          </TipGroup>
        </div>

        {/* Right cluster — registry-driven overflow (260715-h1ck). The ordered
            registry (built above) is the single source: the first N candidates
            that fit render as icon buttons; the rest overflow into the chevron
            menu. `min-w-0` makes this `1fr` grid track squeezable (q8ey's
            left/center floors bound the other tracks, so there is no feedback
            loop). The pyramid invariant holds — overflow consumes L1→L2→L3 from
            the left and surviving buttons keep their positions.

            Only the trailing chevron is EXEMPT (never overflows; the
            connection dot moved to the sidebar footer, 260724-6j1v); the
            ViewSwitcher is `menuOnly` (260722-n2n4) — never in-bar, its
            `View:` rows always in the menu. The `hidden sm:flex` breakpoint
            cliff is GONE: below `sm`, controls overflow into the menu instead
            of vanishing. */}
        {/* The cell must FILL its `1fr` grid track (NOT `justify-self-end`,
            which would size the box to its own content and both (a) deadlock
            `computeVisibleCount` — a content-sized box measures only the exempt
            block, so budget < 0 forever at collapse-first — and (b) never fire
            the ResizeObserver on window resize, since a content-sized box's
            width doesn't track the viewport). Default grid stretch fills the
            track; `justify-end` right-aligns the content inside it. */}
        {/* `min-w-0` keeps the `1fr` track squeezable (M1: the cell fills the
            track — no `justify-self-end`, which would content-size it and
            deadlock the fit). NO `overflow-hidden` here: the candidate buttons
            that don't fit are moved to the menu (never rendered in-bar), so the
            only content that can exceed a very-narrow track is the ALWAYS-present
            exempt block (the chevron). Clipping it would make the chevron
            un-clickable at tight widths with a long center heading
            (violating R6/(e) "exempt items always visible"). Letting the exempt
            block paint (unclipped) keeps it usable; `.app-shell`/`header` still
            clip any horizontal PAGE overflow, so no scrollbar appears. */}
        {/* Right control cluster's warm-tip group (260722-73al) — includes the
            overflow menu and every registry control's popover rows, so the
            whole cluster sweeps as one warm group. */}
        <TipGroup>
        <div
          ref={rightCellRef}
          data-testid="top-bar-right"
          className="flex items-center justify-end gap-3 text-xs text-text-secondary min-w-0"
        >
          {/* The window-view lens switcher never renders here (260722-n2n4):
              its registry entry is `menuOnly`, so its ONLY rendering is the
              per-view `View: …` rows inside the chevron menu — the pill is
              excluded from the visible row, the probe, and the fit budget. */}

          {/* Visible fit candidates — the leading N that fit, as icon buttons. */}
          {visibleItems.map((e) => (
            <span key={e.id} className="flex items-center shrink-0">
              {e.barRender()}
            </span>
          ))}

          {/* Hidden measurement probe — renders every FIT candidate's bar form
              (menuOnly entries are excluded, 260722-n2n4 — the probe's children
              must stay index-aligned with the widths array the fit reads) so we
              always know each real width (never hardcoded), regardless of how
              many are currently visible. It is `inert` (React 19) + `aria-hidden`
              + off-screen (`absolute`, off the left edge): invisible, untabbable,
              and non-interactive, so the duplicated controls can never receive
              focus/clicks or open a popover — they exist purely to be measured
              and never affect the visible row's layout. The duplication is a
              deliberate trade-off for measuring true widths without a magic
              constant; the controls are cheap and read-only on mount. */}
          <div
            ref={probeRef}
            aria-hidden="true"
            inert
            className="absolute -left-[9999px] top-0 flex items-center gap-3 pointer-events-none"
          >
            {fitCandidates.map((e) => (
              <span key={e.id} className="flex items-center shrink-0">
                {e.barRender()}
              </span>
            ))}
          </div>

          {/* Trailing exempt block — the always-present overflow chevron/menu,
              the right-most element in every mode (the connection dot moved to
              the sidebar footer, 260724-6j1v). Its measured width is reserved
              before fitting. */}
          <div ref={trailingRef} className="flex items-center gap-3 shrink-0">
            <TopBarOverflowMenu rows={overflowRows} updateOverflowed={updateOverflowed} />
          </div>
        </div>
        </TipGroup>
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
 * Build the resting cell list for a heading. Terminal/board/server headings pass
 * a `prefix` (e.g. `Terminal`) + `name`; host passes `solo` alone (no
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
 * semibold primary. The Host page's solo word runs the typed sweep alone.
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
//
// The terminal-route prefix is a STATIC `Window:` in every lens (change
// 260714-uco1 — a deliberate reversal of window-views spec R4's "the center
// page heading follows the lens"). The heading identifies the WINDOW (the
// substrate); which lens you look through is shown by the L1 `ViewSwitcher`, not
// the heading (per docs/specs/window-views.md "rows are substrates, views are
// lenses"). This also fixes the anchor jumping on lens switches — the prefix
// width no longer changes with the lens. The retired lens-following
// `terminalHeadingPrefix()` + `WEB_PREFIX`/`CHAT_PREFIX` were removed with it.
const WINDOW_PREFIX = "Window:";
const BOARD_PREFIX = "Board:";
const TMUX_SERVER_PREFIX = "tmux Server:";
const HOST_SOLO = "Host";

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
  caret,
}: {
  cells: SweepCell[];
  scrambling: boolean;
  // Optional element rendered BEFORE the trailing `:` of the prefix word
  // (260714-uco1 — the hierarchy ▾ binds to the prefix "before the colon" per
  // intake §3, rendering `Window ▾: name`). When present, the prefix cells are
  // split at their final `:` cell so the caret sits between the word run and the
  // colon run WITHOUT breaking the single boot-sweep cursor pass — the cell
  // array (and its ordering) is untouched; only the DOM is split at render time.
  caret?: React.ReactNode;
}) {
  // -mr-1 on both return branches: the sweep's `sp` separator cell is a full
  // monospace space (1ch ≈ 8px at text-sm) — noticeably wider than a natural
  // `label: value` gap next to the semibold name. Pulling the following name
  // element back 4px tightens the separator to ~half a space while the cursor
  // still visibly crosses the real space cell (N4: the cell, not a flex gap,
  // owns the separation — do not swap it for a margin/gap on the name).

  // No caret: emit the prefix as one swept run (the original single-span path;
  // keeps `Window:` contiguous for headings with no hierarchy ▾).
  if (!caret) {
    return (
      <span className="hidden sm:inline text-sm text-text-secondary whitespace-pre shrink-0 -mr-1">
        <SweepCells cells={cells} scrambling={scrambling} />
      </span>
    );
  }

  // Caret present: split the prefix cells at the LAST `:` so the caret renders
  // between the word (`Window`) and the colon (`:`). The `sp` separating space
  // cell rides in the tail with the colon so the cursor still visibly crosses
  // it before the name (splitSweepCells keeps `sp` in the prefix portion).
  const colonIdx = cells.map((c) => c.ch).lastIndexOf(":");
  const wordCells = colonIdx >= 0 ? cells.slice(0, colonIdx) : cells;
  const tailCells = colonIdx >= 0 ? cells.slice(colonIdx) : [];
  return (
    <span className="hidden sm:inline-flex items-center text-sm text-text-secondary whitespace-pre shrink-0 -mr-1">
      <span className="whitespace-pre">
        <SweepCells cells={wordCells} scrambling={scrambling} />
      </span>
      {caret}
      <span className="whitespace-pre">
        <SweepCells cells={tailCells} scrambling={scrambling} />
      </span>
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
  prefix,
  caret,
}: {
  server: string;
  windowId: string;
  sessionName: string;
  name: string;
  /** Page-type prefix — the static `Window:` constant (`WINDOW_PREFIX`) in every
   *  lens; the lens-following `Terminal:`/`Web:`/`Chat:` prefix was retired by
   *  260714-uco1. The boot sweep renders over `prefix + " " + name`. */
  prefix: string;
  /** Optional element rendered inside the prefix, BEFORE its trailing `:`
   *  (260714-uco1 — the hierarchy ▾ binds to the prefix "before the colon",
   *  rendering `Window ▾: name`). Passed through to `HeadingPrefix`. */
  caret?: React.ReactNode;
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
  const sweep = useBootSweep(prefix, name, false);
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
    // The edit input applies the live window transform; commit trims the
    // trailing separator the live transform keeps visible while typing.
    const trimmed = finalizeSafeName(draft.trim());
    setEditing(false);
    // Empty-after-conversion commit = cancel (matches the dialog's trim guard).
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
        <HeadingPrefix cells={prefixCells} scrambling={false} caret={caret} />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          // Live safe-name conversion (window kind — hyphens kept): a typed
          // space appears as "_" so the committed name is the displayed name.
          onChange={(e) => setDraft(toSafeWindowName(e.target.value))}
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
          // Identically-styled to the display heading: monospace, LEFT-aligned
          // (260714-uco1 — dropped `text-center` so the name doesn't jump
          // horizontally when entering edit mode, now that the heading is
          // left-anchored), weight-600 primary color, sized in ch and growing
          // with content.
          style={{ width: `${Math.max(draft.length + 1, 3)}ch` }}
          className="bg-transparent text-left text-sm font-semibold text-text-primary outline-none border-b border-accent min-w-0"
        />
      </>
    );
  }

  return (
    // ONE hover owner for the whole heading: enter/leave live on this wrapper
    // (mirroring PageHeadingDisplay's outer span), NEVER on the prefix and the
    // button individually — per-sibling handlers fire resolve() + playDeferred()
    // when the pointer crosses the prefix↔name boundary, restarting the sweep
    // mid-flight. Enter/leave don't refire while the pointer moves between
    // children, so the sweep plays once per whole-heading hover.
    <span
      className="inline-flex items-center min-w-0"
      onMouseEnter={sweep.playDeferred}
      onMouseLeave={sweep.resolve}
    >
      {/* Static `Window:` prefix — a sibling OUTSIDE the button so clicking
          it never starts an edit; hidden below `sm` (mobile keeps just the
          name). Its content rides the same sweep so the one cursor crosses it,
          but it is NOT a click target — only the button below enters edit. */}
      <HeadingPrefix cells={prefixCells} scrambling={sweep.scrambling} caret={caret} />
      <Tip label="Click to rename">
      <button
        type="button"
        onClick={startEdit}
        aria-label={`Rename window ${name}`}
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
      </Tip>
    </span>
  );
}

/**
 * Display-only universal center heading for board / server / host (change
 * 260704-pr0p). Renders the same boot sweep as `WindowHeading` but with NO
 * rename affordance (board has no rename API; the server/board name is
 * display-only). Two shapes:
 *  - prefixed: a static `PageType:` sibling span + the boot-swept name
 *    (`Board: <board>`, `tmux Server: <server>`).
 *  - solo: just the type word swept alone (`Host`) — no prefix, no name; it
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
  caret,
}: {
  prefix: string;
  name: string;
  solo?: boolean;
  ariaLabel: string;
  /** Optional element rendered inside the prefix, BEFORE its trailing `:`
   *  (260714-uco1 — the hierarchy ▾ binds to the prefix "before the colon",
   *  rendering `Board ▾: name` / `tmux Server ▾: name`, matching the window
   *  heading's `Window ▾: name`). Not applicable to the solo shape (no prefix).
   *  Passed through to `HeadingPrefix`. */
  caret?: React.ReactNode;
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
      <HeadingPrefix cells={prefixCells} scrambling={sweep.scrambling} caret={caret} />
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

// ThemeToggle, HelpLink, and NotificationControl LEFT this file in 260724-6j1v:
// theme + help chrome moved to the sidebar footer (`sidebar/index.tsx`
// SidebarFooter) and notifications folded into the settings dialog. The shared
// definitions (HELP_URL, NOTIFICATIONS_HELP_URL, cycleTheme, the theme/help
// SVGs) live in `components/global-chrome.tsx`.

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
    <Tip label={label}>
    <button
      type="button"
      onClick={() => execute()}
      disabled={isPending}
      aria-label={label}
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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
    </Tip>
  );
}

/**
 * The L2 ✕ chip. Terminal mode: a real close-pane — `closePane(server,
 * windowId)` kills the current window's active pane via the optimistic path
 * (spinner while pending, toast on error). Board mode (co9z): a consequence-gated
 * KILL — when `onRequestKill` is present the click opens BoardPage's confirm
 * dialog (with an `Unpin instead` escape) instead of firing `closePane`, and the
 * ✕ reads "Kill". The confirmed board kill's self-heal refetch is owned by
 * BoardPage (`executeKillWindow`'s `onSettled`), so this component carries no
 * self-heal callback of its own.
 */
function ClosePaneButton({
  server,
  windowId,
  disabled,
  onRequestKill,
  label = "Close pane",
}: {
  server?: string;
  windowId?: string;
  disabled?: boolean;
  /** Board mode (co9z): when present, the click opens BoardPage's confirm dialog
   *  instead of firing closePane directly — a board Kill is consequence-gated. */
  onRequestKill?: () => void;
  label?: string;
}) {
  const { addToast } = useToast();

  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => closePane(server ?? "", windowId ?? ""),
    onError: (err) => {
      addToast(err.message || "Failed to close pane");
    },
  });

  const isDisabled = disabled || isPending;
  // Keep the accessible label coupled to the actual click behavior: a "Kill"
  // label only holds when `onRequestKill` routes the click to the confirm
  // dialog. If the handler is absent the click falls through to `closePane`, so
  // the label must reflect that (co9z) — never advertise "Kill" for a plain
  // close-pane.
  const effectiveLabel = onRequestKill ? label : "Close pane";

  return (
    <Tip label={effectiveLabel}>
    <button
      type="button"
      onClick={() => (onRequestKill ? onRequestKill() : execute())}
      disabled={isDisabled}
      aria-label={effectiveLabel}
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
    </button>
    </Tip>
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
 * (board-page.tsx `refreshEntry`); the Host `/` mounts no palette — a
 * pre-existing, out-of-scope limitation (mounting one to add this entry would
 * grow UI surface against constitution IV, Minimal Surface Area).
 */
function RefreshButton() {
  return (
    // The old "(Shift+click: force reload)" parenthetical becomes the tip's
    // dim modifier note (the intake's canonical label + note example).
    <Tip label="Refresh page" note="⇧click: force">
    <button
      type="button"
      onClick={(e) => (e.shiftKey ? forceReload() : window.location.reload())}
      aria-label="Refresh page"
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
    </Tip>
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
      {/* Tip suppressed while the popover is open so it never paints over the
          stepper (the BreadcrumbDropdown trigger convention). */}
      <Tip label={open ? undefined : "Terminal font size"}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Terminal font size"
        className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center text-xs font-semibold leading-none ${
          open
            ? "border-accent text-accent bg-accent/10"
            : "border-border text-text-secondary hover:border-text-secondary"
        }`}
      >
        {/* "Aa" reads as "text size" without a separate label */}
        <span aria-hidden="true">Aa</span>
      </button>
      </Tip>
      {open && (
        <div
          role="group"
          aria-label="Terminal font size"
          className="absolute top-full right-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl p-2 z-50 flex flex-col gap-2"
        >
          <div className="flex items-center gap-1">
            <Tip label="Decrease terminal font">
              <button
                type="button"
                onClick={decreaseTerminalFont}
                disabled={atMin}
                aria-label="Decrease terminal font"
                className={stepButtonClass}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="3" y1="7" x2="11" y2="7" />
                </svg>
              </button>
            </Tip>
            <span
              className="min-w-[4ch] text-center text-xs text-text-primary tabular-nums select-none"
              aria-label={`Terminal font size ${terminalFontSize} pixels`}
            >
              {terminalFontSize}px
            </span>
            <Tip label="Increase terminal font">
              <button
                type="button"
                onClick={increaseTerminalFont}
                disabled={atMax}
                aria-label="Increase terminal font"
                className={stepButtonClass}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="3" y1="7" x2="11" y2="7" />
                  <line x1="7" y1="3" x2="7" y2="11" />
                </svg>
              </button>
            </Tip>
          </div>
          <Tip label="Reset terminal font (device default)">
            <button
              type="button"
              onClick={resetTerminalFont}
              aria-label="Reset terminal font"
              className="w-full text-xs text-text-secondary hover:text-text-primary transition-colors py-1 rounded hover:bg-bg-card flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {/* circular-arrow reset glyph */}
                <path d="M11.5 7a4.5 4.5 0 1 1-1.32-3.18" />
                <polyline points="11.5,1.5 11.5,4 9,4" />
              </svg>
              Reset
            </button>
          </Tip>
        </div>
      )}
    </div>
  );
}

/**
 * Top-bar update chip (L3 right cluster). Self-contained — reads the
 * update-notification state from SessionContext via `useUpdateNotification`
 * (no props threaded through TopBar), mirroring TerminalFontControl. In-app
 * only: NO Web Push (update notices must not buzz phones).
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
  const { showChip, tools, singleRunKit, latest, current, dismissUpdate } = useUpdateNotification();
  // Shared one-click-update behavior (updating state + catch/toast) with the
  // overflow menu's version-row update surface — see useUpdateClick (review M5).
  const { updating, triggerUpdate } = useUpdateClick();

  if (!showChip || tools.length === 0) return null;

  // Presentation (R15): a single run-kit match keeps today's `⬆ v{latest}`
  // with the `v{current} → v{latest}` transition in the title/aria. Any other
  // single tool or multiple tools use a count form `⬆ updates (N)`, and the
  // title/aria names every per-tool transition — the button runs a SCOPED
  // update of exactly these tools, so it must say which tools move.
  const visibleLabel = singleRunKit ? `⬆ v${latest}` : `⬆ updates (${tools.length})`;
  const restLabel =
    singleRunKit && current
      ? `Update run-kit: v${current} → v${latest}`
      : `Update: ${updateChipToolSummary(tools)}`;

  // No `hidden sm:flex` (review M2 / R14): responsive gating is 100%
  // registry-driven now — below `sm` the chip's registry entry overflows into
  // the chevron menu (its function merges into the version row) rather than
  // vanishing via `display:none`. A CSS-hidden chip would leave a 0-width probe
  // copy corrupting the fit input and render in NEITHER bar nor menu.
  return (
    <span className="flex items-center">
      <Tip label={updating ? "Updating\u2026" : restLabel}>
      <button
        type="button"
        onClick={triggerUpdate}
        disabled={updating}
        aria-label={updating ? "Updating run-kit" : restLabel}
        className="rk-glint flex items-center gap-1 h-[24px] coarse:h-[30px] px-1.5 rounded border border-accent-green text-accent-green hover:border-accent-green transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {updating ? (
          <>
            <LogoSpinner size={12} />
            <span>{"updating\u2026"}</span>
          </>
        ) : (
          <span>{visibleLabel}</span>
        )}
      </button>
      </Tip>
      {!updating && (
        <Tip label="Dismiss update notice">
          <button
            type="button"
            onClick={dismissUpdate}
            aria-label="Dismiss update notice"
            className="ml-0.5 h-[24px] coarse:h-[30px] w-[16px] coarse:w-[20px] flex items-center justify-center rounded text-text-secondary hover:text-text-primary transition-colors text-xs"
          >
            {"\u2715"}
          </button>
        </Tip>
      )}
    </span>
  );
}

function FixedWidthToggle() {
  const { fixedWidth } = useChromeState();
  const { toggleFixedWidth } = useChromeDispatch();

  return (
    <Tip label={fixedWidth ? "Full width" : "Fixed width (900px)"}>
    <button
      onClick={toggleFixedWidth}
      aria-label="Toggle fixed terminal width"
      aria-pressed={fixedWidth}
      className={`rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center ${
        fixedWidth
          ? "border-accent text-accent bg-accent/10"
          : "border-border text-text-secondary hover:border-text-secondary"
      }`}
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
    </Tip>
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
    <Tip label={autofit ? "Autofit on (panes fill the row)" : "Autofit off (fixed pane widths)"}>
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
    </Tip>
  );
}

// ── Overflow-menu row representations (260715-h1ck) ────────────────────────────
//
// Each right-cluster control that can overflow into the chevron menu renders as
// a labeled `role="menuitem"` row here (change area 4). The rows reuse the same
// underlying actions as their in-bar button forms — clicking a row does exactly
// what clicking the icon button does — so bar↔menu behavior can never drift.

// `MENU_ROW_CLASS` (and its decomposed `MENU_ROW_BASE`/`_REST`/`_DISABLED`/
// `_ACTIVE` variants) are hosted in `top-bar-overflow-menu.tsx` and imported at
// the top of this file — shared with `view-switcher.tsx`'s `ViewSwitcherMenuRows`
// so the row styling can never drift between the two files (mirrors
// BreadcrumbDropdown's item classes).

/** Split vertical / horizontal menu row — same optimistic split action as the
 *  in-bar SplitButton. */
function SplitMenuRow({
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
  const label = horizontal ? "Split horizontal" : "Split vertical";
  const { addToast } = useToast();
  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => splitWindow(server, windowId, !!horizontal, cwd),
    onError: (err) => addToast(err.message || "Failed to split pane"),
  });
  return (
    <button type="button" role="menuitem" tabIndex={-1} disabled={isPending} onClick={() => execute()} className={MENU_ROW_CLASS}>
      {label}
    </button>
  );
}

/** Fixed-width checkbox row — reflects/toggles the same ChromeContext state as
 *  the in-bar FixedWidthToggle (`role="menuitemcheckbox"`). */
function FixedWidthMenuRow() {
  const { fixedWidth } = useChromeState();
  const { toggleFixedWidth } = useChromeDispatch();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={fixedWidth}
      tabIndex={-1}
      onClick={toggleFixedWidth}
      className={MENU_ROW_CLASS}
    >
      <span className="flex-1">Fixed width</span>
      {fixedWidth && <span aria-hidden="true">✓</span>}
    </button>
  );
}

/** Terminal-font stepper row — inline `−` / value / `+` operating on the same
 *  ChromeContext terminalFontSize as the Aa popover (same TERMINAL_FONT_BOUNDS),
 *  WITHOUT opening the popover (assumption #11). The `−` button is the row's
 *  first focusable element, so keyboard nav lands there. */
function TerminalFontMenuRow() {
  const { terminalFontSize } = useChromeState();
  const { increaseTerminalFont, decreaseTerminalFont } = useChromeDispatch();
  const atMin = terminalFontSize <= TERMINAL_FONT_BOUNDS.min;
  const atMax = terminalFontSize >= TERMINAL_FONT_BOUNDS.max;
  const stepClass =
    "min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border";
  return (
    <div role="group" aria-label="Terminal font size" className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary">
      <span className="flex-1">Terminal font</span>
      <button type="button" tabIndex={-1} onClick={decreaseTerminalFont} disabled={atMin} aria-label="Decrease terminal font" className={stepClass}>
        −
      </button>
      <span className="min-w-[4ch] text-center tabular-nums text-text-primary select-none" aria-label={`Terminal font size ${terminalFontSize} pixels`}>
        {terminalFontSize}px
      </span>
      <button type="button" tabIndex={-1} onClick={increaseTerminalFont} disabled={atMax} aria-label="Increase terminal font" className={stepClass}>
        +
      </button>
    </div>
  );
}

/** Autofit-panes checkbox row (board mode) — mirrors the in-bar BoardAutofitToggle. */
function AutofitMenuRow({ autofit, onToggle }: { autofit: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={autofit}
      tabIndex={-1}
      onClick={onToggle}
      className={MENU_ROW_CLASS}
    >
      <span className="flex-1">Autofit panes</span>
      {autofit && <span aria-hidden="true">✓</span>}
    </button>
  );
}

/** Close-pane row — the menu mirror of the in-bar ClosePaneButton. Terminal
 *  mode: a real close-pane on the current window's active pane. Board mode
 *  (co9z): `onRequestKill` opens BoardPage's consequence-gated kill dialog
 *  instead, and the row reads "Kill"; `disabled` when the board is empty. */
function ClosePaneMenuRow({
  server,
  windowId,
  disabled,
  onRequestKill,
  label = "Close pane",
}: {
  server?: string;
  windowId?: string;
  disabled?: boolean;
  /** Board mode (co9z): when present, open BoardPage's confirm dialog instead of
   *  firing closePane directly. */
  onRequestKill?: () => void;
  label?: string;
}) {
  const { addToast } = useToast();
  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => closePane(server ?? "", windowId ?? ""),
    onError: (err) => addToast(err.message || "Failed to close pane"),
  });
  // Keep the row label coupled to the actual click behavior: "Kill" only holds
  // when `onRequestKill` routes to the confirm dialog; without it the click is a
  // plain close-pane, so the label must say so (co9z).
  const effectiveLabel = onRequestKill ? label : "Close pane";
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled || isPending}
      onClick={() => (onRequestKill ? onRequestKill() : execute())}
      className={MENU_ROW_CLASS}
    >
      {effectiveLabel}
    </button>
  );
}

/** Refresh-page row — plain click reloads, Shift+click force-reloads (same as
 *  the in-bar RefreshButton). Labeled "Refresh page" to disambiguate from the
 *  `Status: Refresh` palette action (260715-jykd), assumption #12. */
function RefreshMenuRow() {
  return (
    <Tip label="Refresh page" note="⇧click: force">
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={(e) => (e.shiftKey ? forceReload() : window.location.reload())}
        className={MENU_ROW_CLASS}
      >
        Refresh page
      </button>
    </Tip>
  );
}
