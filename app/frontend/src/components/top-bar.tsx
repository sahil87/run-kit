import { useCallback, useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { LogoSpinner } from "@/components/logo-spinner";
import { useChromeState, useChromeDispatch, TERMINAL_FONT_BOUNDS } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { splitWindow, closePane } from "@/api/client";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

export type TopBarMode = "terminal" | "board" | "root" | "cockpit";

type TopBarProps = {
  /**
   * Mode controls the breadcrumb / informational region:
   * - `terminal` (default, `/$server/$window`) — brand + hamburger + server
   *   link + session/window breadcrumb dropdowns.
   * - `root` (`/$server` with no window, the Server Cabin) — brand + hamburger +
   *   the server name as the current-page leaf (replaces the old "Dashboard"
   *   label). No session/window crumbs.
   * - `board` (`/board/$name`) — brand + hamburger + the board breadcrumb
   *   dropdown plus pane/server counts and the cycle hint. Connection dot hidden.
   * - `cockpit` (`/`, the Server List home) — brand crumb ONLY. No hamburger
   *   (the Cockpit has no sidebar), no connection dot (no per-server SSE stream),
   *   no terminal-font control, no split/close buttons. The route-agnostic
   *   controls (FixedWidthToggle, NotificationControl, ThemeToggle) still render.
   *   Session/server-dependent props are passed empty (`sessions=[]`,
   *   `currentSession=null`, `currentWindow=null`, `sessionName=""`, `server=""`,
   *   no-op callbacks) — the same tolerant-empty shape board mode already uses.
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
  /** Board-mode list of all boards (for the board switcher dropdown). */
  boards?: { name: string }[];
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
  boards,
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

  // The server crumb renders on the server routes only (terminal + root, the
  // Server Cabin). When a window is present (terminal) it is a plain link back
  // to `/$server`; when it is the current page (root, no window) it is a
  // non-link `aria-current="page"` leaf. Cockpit and board have no server crumb.
  const showServerCrumb = (mode === "terminal" || mode === "root") && !!server;
  const serverIsLeaf = !windowName; // no window selected → server IS the leaf
  const serverHref = `/${encodeURIComponent(server)}`;

  return (
    <header className="px-3 border-b-[3px] border-border">
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
          {/* Brand root crumb — logo + wordmark, links to `/`. Left-most on
              every route; IS the home affordance (no separate "Cockpit" crumb).
              Wordmark collapses to the bare icon below `sm` so long crumbs still
              fit the single-line 375px topbar. */}
          <a
            href="/"
            aria-label="Run Kit home"
            title="Cockpit"
            className={`flex items-center gap-2 shrink-0 ${LINK_CRUMB_CLASS}`}
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
              the crumbs. Not rendered on the Cockpit, which has no sidebar. */}
          {hasSidebar && (
            <button
              onClick={onToggleSidebar}
              aria-label="Toggle navigation"
              className="text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center shrink-0"
            >
              <HamburgerIcon isOpen={hamburgerOpen} />
            </button>
          )}

          {mode === "board" && boardName ? (
            <>
              <BreadcrumbSeparator />
              <BoardModeBreadcrumb
                boardName={boardName}
                paneCount={paneCount ?? 0}
                serverCount={serverCount ?? 0}
                boards={boards ?? []}
              />
            </>
          ) : (
            <>
              {/* Server crumb (terminal + root). Intermediate crumbs (server,
                  session, and their separators) hide below `sm` so mobile shows
                  only brand icon + leaf crumb. When the server is itself the leaf
                  (root, no window) it stays visible on mobile. */}
              {showServerCrumb &&
                (serverIsLeaf ? (
                  <>
                    <BreadcrumbSeparator />
                    <span
                      aria-current="page"
                      title="Server Cabin"
                      className="min-w-0 text-text-primary font-medium truncate"
                    >
                      {server}
                    </span>
                  </>
                ) : (
                  <span className="hidden sm:flex items-center gap-1.5">
                    <BreadcrumbSeparator />
                    <a
                      href={serverHref}
                      title="Server Cabin"
                      className={`truncate max-w-[16ch] ${LINK_CRUMB_CLASS}`}
                    >
                      {server}
                    </a>
                  </span>
                ))}

              {sessionName && (
                <>
                  {/* Session crumb — hidden below `sm` (intermediate). */}
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

                  {windowName && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbDropdown
                        items={windowItems}
                        label="window"
                        icon={windowName}
                        title="Window"
                        onNavigate={handleDropdownNavigate}
                        action={{ label: "+ New Window", onAction: () => onCreateWindow(sessionName) }}
                        triggerClassName="text-text-primary font-medium hover:text-text-primary transition-colors text-sm"
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </nav>

        <div className="flex items-center gap-3 text-xs text-text-secondary shrink-0">
          {/* Icon ordering minimizes movement between pages: the conditional
              terminal-only buttons (splits, close, Aa) sit on the LEFT of the
              cluster, where their absence on non-terminal pages just widens the
              gap to the breadcrumb. The always-present items (theme, fixed
              width) form a stable block, followed by the connection dot as the
              right-most element (the brand anchor moved to the left nav as the
              root crumb, so there is no longer a Run Kit anchor pinning this
              cluster's right edge). */}
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
                <ClosePaneButton
                  server={server}
                  windowId={currentWindow.windowId}
                />
              </span>
            </>
          )}

          {/* Terminal font size applies only to terminal-bearing surfaces:
              the single-window terminal (`terminal`) and board panes (`board`,
              where `currentWindow` is always `null`). It is gated out of `root`
              (the Server Cabin tile view) and `cockpit` (the server list) —
              neither has a terminal to size. Sits outside the `currentWindow`
              block so board mode still shows it. */}
          {mode !== "root" && mode !== "cockpit" && (
            <span className="hidden sm:flex">
              <TerminalFontControl />
            </span>
          )}

          {/* Route-agnostic controls — these render in every mode (including
              cockpit) and keep a stable left-to-right order:
              FixedWidth → Notification → Theme → connection dot. */}

          {/* FixedWidthToggle is route-agnostic — fixed-width constrains the
              max-width of any surface including the server list, so it stays in
              all modes. */}
          <span className="hidden sm:flex">
            <FixedWidthToggle />
          </span>

          {/* Notification control — bell button + dropdown (enable / send test).
              Route-agnostic; hides itself when push is unsupported (insecure
              context / no SW support). */}
          <span className="hidden sm:flex">
            <NotificationControl />
          </span>

          {/* Theme toggle — route-agnostic. */}
          <span className="hidden sm:flex">
            <ThemeToggle />
          </span>

          {/* Connection dot — the right-most element. Rendered in terminal/root
              modes only: board mode spans servers (connection state is
              per-server) and cockpit has no per-server SSE stream, so both hide
              it. */}
          {mode !== "board" && mode !== "cockpit" && (
            <span role="status" aria-live="polite" className="hidden sm:inline">
              <span
                className={`block w-2 h-2 rounded-full ${
                  isConnected ? "bg-accent-green" : "bg-text-secondary"
                }`}
                aria-label={isConnected ? "Connected" : "Disconnected"}
              />
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Board-mode breadcrumb: `Board ▸ {name} ▾   {n} pane(s) · {n} server(s) · ⌘[⌘] cycle`.
 * The inline-info span is hidden on `< 640px` viewports via `hidden sm:inline`,
 * matching the existing chrome mobile-hide pattern documented in
 * `ui-patterns.md` § Chrome (Top Bar).
 *
 * The board switcher uses the shared `<BreadcrumbDropdown>` so it inherits the
 * same a11y semantics as the session/window switchers: `role="menu"`/`menuitem`,
 * Escape to close, ArrowUp/ArrowDown navigation, and outside-click dismiss.
 * The `← Sessions` shortcut is wired through the `action` slot — it lives above
 * the items list and navigates back to the root sessions view.
 */
function BoardModeBreadcrumb({
  boardName,
  paneCount,
  serverCount,
  boards,
}: {
  boardName: string;
  paneCount: number;
  serverCount: number;
  boards: { name: string }[];
}) {
  const navigate = useNavigate();

  const paneNoun = paneCount === 1 ? "pane" : "panes";
  const serverNoun = serverCount === 1 ? "server" : "servers";

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
    <>
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        className="text-sm text-text-secondary hover:text-text-primary"
      >
        Board ▸
      </button>
      <span className="text-sm text-text-primary font-medium">{boardName}</span>
      <BreadcrumbDropdown
        items={boardItems}
        label="board"
        onNavigate={handleNavigate}
        action={{ label: "← Sessions", onAction: () => navigate({ to: "/" }) }}
        triggerClassName="text-sm text-text-secondary hover:text-text-primary px-1"
      />
      <span className="hidden sm:inline ml-2 text-xs text-text-secondary">
        {paneCount} {paneNoun} · {serverCount} {serverNoun} · ⌘[⌘] cycle
      </span>
    </>
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
      className="min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
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
      className="min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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

function ClosePaneButton({
  server,
  windowId,
}: {
  server: string;
  windowId: string;
}) {
  const { addToast } = useToast();

  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => closePane(server, windowId),
    onError: (err) => {
      addToast(err.message || "Failed to close pane");
    },
  });

  return (
    <button
      type="button"
      onClick={() => execute()}
      disabled={isPending}
      aria-label="Close pane"
      className="min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      title="Close pane"
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
        className={`min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center text-xs font-semibold leading-none ${
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
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={statusLabel}
        className={`min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center leading-none ${
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
      className={`min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border transition-colors flex items-center justify-center ${
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
