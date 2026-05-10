import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { LogoSpinner } from "@/components/logo-spinner";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { splitWindow, closePane } from "@/api/client";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

export type TopBarMode = "terminal" | "board" | "root";

type TopBarProps = {
  /**
   * Mode controls the breadcrumb / informational region. `terminal` renders
   * session/window breadcrumbs (default — covers `/$server/$session/$window`).
   * `root` renders the dashboard label (covers `/$server` with no session).
   * `board` renders the board breadcrumb dropdown plus pane/server counts and
   * the cycle hint (covers `/board/$name`).
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
  onNavigate: (session: string, windowIndex: number) => void;
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
  const sessionItems: BreadcrumbDropdownItem[] = sessions.map((s) => ({
    label: s.name,
    href: `/${encodeURIComponent(server)}/${encodeURIComponent(s.name)}/${s.windows[0]?.index ?? 0}`,
    current: s.name === sessionName,
  }));

  const windowItems: BreadcrumbDropdownItem[] = (currentSession?.windows ?? []).map(
    (w) => ({
      label: w.name,
      href: `/${encodeURIComponent(server)}/${encodeURIComponent(sessionName)}/${w.index}`,
      current: currentWindow ? w.index === currentWindow.index : false,
    }),
  );

  const handleDropdownNavigate = useCallback(
    (href: string) => {
      // Parse href like "/server/sessionName/windowIndex"
      const parts = href.replace(/^\//, "").split("/");
      if (parts.length >= 3) {
        const session = decodeURIComponent(parts[1]);
        const windowIdx = Number(parts[2]);
        if (!isNaN(windowIdx)) {
          onNavigate(session, windowIdx);
        }
      }
    },
    [onNavigate],
  );

  // Hamburger animation is driven by `sidebarOpen` alone — both desktop
  // (grid column) and mobile (overlay) collapse to the same boolean state.
  const hamburgerOpen = sidebarOpen;

  return (
    <header className="px-3 border-b-2 border-border">
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          {/* Hamburger icon — toggles sidebarOpen (one boolean covers both
              desktop grid column and mobile overlay). */}
          <button
            onClick={onToggleSidebar}
            aria-label="Toggle navigation"
            className="text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center"
          >
            <HamburgerIcon isOpen={hamburgerOpen} />
          </button>

          {mode === "board" && boardName ? (
            <BoardModeBreadcrumb
              boardName={boardName}
              paneCount={paneCount ?? 0}
              serverCount={serverCount ?? 0}
              boards={boards ?? []}
            />
          ) : sessionName ? (
            <>
              <BreadcrumbDropdown
                items={sessionItems}
                label="session"
                icon={sessionName}
                onNavigate={handleDropdownNavigate}
                action={{ label: "+ New Session", onAction: onCreateSession }}
                triggerClassName="max-w-[7ch] truncate text-text-secondary hover:text-text-primary transition-colors text-sm"
              />

              {windowName && (
                <span className="text-text-secondary select-none" aria-hidden="true">/</span>
              )}

              {windowName && (
                <BreadcrumbDropdown
                  items={windowItems}
                  label="window"
                  icon={windowName}
                  onNavigate={handleDropdownNavigate}
                  action={{ label: "+ New Window", onAction: () => onCreateWindow(sessionName) }}
                  triggerClassName="text-text-primary font-medium hover:text-text-primary transition-colors text-sm"
                />
              )}
            </>
          ) : (
            <span className="text-text-primary font-medium ml-1.5">Dashboard</span>
          )}
        </nav>

        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span className="hidden sm:flex">
            <ThemeToggle />
          </span>

          {currentWindow && (
            <>
              <span className="hidden sm:flex">
                <SplitButton
                  server={server}
                  session={sessionName}
                  windowIndex={currentWindow.index}
                  cwd={currentWindow.worktreePath}
                />
              </span>
              <span className="hidden sm:flex">
                <SplitButton
                  horizontal
                  server={server}
                  session={sessionName}
                  windowIndex={currentWindow.index}
                  cwd={currentWindow.worktreePath}
                />
              </span>
              <span className="hidden sm:flex">
                <ClosePaneButton
                  server={server}
                  session={sessionName}
                  windowIndex={currentWindow.index}
                />
              </span>
            </>
          )}

          {/* FixedWidthToggle is route-agnostic — fixed-width applies to any
              terminal-bearing surface, including board panes. Lift it out of
              the `currentWindow` block so board mode (where `currentWindow`
              is always `null`) still exposes the toggle. */}
          <span className="hidden sm:flex">
            <FixedWidthToggle />
          </span>

          {/* Connection dot — terminal/root modes only (board mode hides it
              because connection state is per-server and a board may span
              servers). */}
          {mode !== "board" && (
            <span role="status" aria-live="polite" className="hidden sm:inline">
              <span
                className={`block w-2 h-2 rounded-full ${
                  isConnected ? "bg-accent-green" : "bg-text-secondary"
                }`}
                aria-label={isConnected ? "Connected" : "Disconnected"}
              />
            </span>
          )}

          {/* "Run Kit" + Logo — links to dashboard */}
          <a href="/" className="flex items-center gap-3 text-text-secondary hover:text-text-primary transition-colors">
            <span className="hidden sm:inline text-xs">Run Kit</span>
            <img
              src="/icon.svg"
              alt="Run Kit"
              width={20}
              height={20}
              className="hidden sm:block"
            />
            <img
              src="/icon.svg"
              alt="Run Kit"
              width={30}
              height={30}
              className="sm:hidden"
            />
          </a>
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
      className="min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
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
  session,
  windowIndex,
  cwd,
}: {
  horizontal?: boolean;
  server: string;
  session: string;
  windowIndex: number;
  cwd?: string;
}) {
  const label = horizontal ? "Split horizontally" : "Split vertically";
  const { addToast } = useToast();

  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => splitWindow(server, session, windowIndex, !!horizontal, cwd),
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
      className="min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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
  session,
  windowIndex,
}: {
  server: string;
  session: string;
  windowIndex: number;
}) {
  const { addToast } = useToast();

  const { execute, isPending } = useOptimisticAction<[]>({
    action: () => closePane(server, session, windowIndex),
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
      className="min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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

function FixedWidthToggle() {
  const { fixedWidth } = useChromeState();
  const { toggleFixedWidth } = useChromeDispatch();

  return (
    <button
      onClick={toggleFixedWidth}
      aria-label="Toggle fixed terminal width"
      aria-pressed={fixedWidth}
      className={`min-w-[24px] min-h-[24px] rounded border transition-colors flex items-center justify-center ${
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
