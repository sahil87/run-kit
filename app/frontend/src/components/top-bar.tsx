import { useCallback } from "react";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { splitWindow } from "@/api/client";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

type TopBarProps = {
  sessions: ProjectSession[];
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sessionName: string;
  windowName: string;
  isConnected: boolean;
  sidebarOpen: boolean;
  drawerOpen: boolean;
  onNavigate: (session: string, windowIndex: number) => void;
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
  onOpenCompose: () => void;
};

function HamburgerIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* Top line → upper arm of chevron (<) */}
      <line
        x1="3"
        y1="4.5"
        x2="15"
        y2="4.5"
        style={{
          transition: "transform 200ms ease",
          transformOrigin: "9px 4.5px",
          transform: isOpen
            ? "translate(-1px, 2px) rotate(-40deg) scaleX(0.65)"
            : "none",
        }}
      />
      {/* Middle line: fades/scales out when open */}
      <line
        x1="3"
        y1="9"
        x2="15"
        y2="9"
        style={{
          transition: "opacity 150ms ease, transform 150ms ease",
          transformOrigin: "9px 9px",
          opacity: isOpen ? 0 : 1,
          transform: isOpen ? "scaleX(0)" : "scaleX(1)",
        }}
      />
      {/* Bottom line → lower arm of chevron (<) */}
      <line
        x1="3"
        y1="13.5"
        x2="15"
        y2="13.5"
        style={{
          transition: "transform 200ms ease",
          transformOrigin: "9px 13.5px",
          transform: isOpen
            ? "translate(-1px, -2px) rotate(40deg) scaleX(0.65)"
            : "none",
        }}
      />
    </svg>
  );
}

export function TopBar({
  sessions,
  currentSession,
  currentWindow,
  sessionName,
  windowName,
  isConnected,
  sidebarOpen,
  drawerOpen,
  onNavigate,
  onToggleSidebar,
  onToggleDrawer,
  onCreateSession,
  onCreateWindow,
  onOpenCompose,
}: TopBarProps) {
  const sessionItems: BreadcrumbDropdownItem[] = sessions.map((s) => ({
    label: s.name,
    href: `/${encodeURIComponent(s.name)}/${s.windows[0]?.index ?? 0}`,
    current: s.name === sessionName,
  }));

  const windowItems: BreadcrumbDropdownItem[] = (currentSession?.windows ?? []).map(
    (w) => ({
      label: w.name,
      href: `/${encodeURIComponent(sessionName)}/${w.index}`,
      current: currentWindow ? w.index === currentWindow.index : false,
    }),
  );

  const handleDropdownNavigate = useCallback(
    (href: string) => {
      // Parse href like "/sessionName/windowIndex"
      const parts = href.replace(/^\//, "").split("/");
      if (parts.length >= 2) {
        const session = decodeURIComponent(parts[0]);
        const windowIdx = Number(parts[1]);
        if (!isNaN(windowIdx)) {
          onNavigate(session, windowIdx);
        }
      }
    },
    [onNavigate],
  );

  // Match the click handler's breakpoint: desktop (>=768px) uses sidebar, mobile uses drawer.
  // Using both ensures correctness even when the other state is stale after a viewport switch.
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
  const hamburgerOpen = isDesktop ? sidebarOpen : drawerOpen;

  return (
    <header className="px-3 border-b-2 border-border">
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          {/* Hamburger icon — toggles sidebar (desktop) / drawer (mobile) */}
          <button
            onClick={() => {
              if (window.innerWidth >= 768) {
                onToggleSidebar();
              } else {
                onToggleDrawer();
              }
            }}
            aria-label="Toggle navigation"
            className="text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center"
          >
            <HamburgerIcon isOpen={hamburgerOpen} />
          </button>

          {sessionName ? (
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
                  session={sessionName}
                  windowIndex={currentWindow.index}
                />
              </span>
              <span className="hidden sm:flex">
                <SplitButton
                  horizontal
                  session={sessionName}
                  windowIndex={currentWindow.index}
                />
              </span>
              <span className="hidden sm:flex">
                <FixedWidthToggle />
              </span>
            </>
          )}

          {/* Connection dot */}
          <span role="status" aria-live="polite" className="hidden sm:inline">
            <span
              className={`block w-2 h-2 rounded-full ${
                isConnected ? "bg-accent-green" : "bg-text-secondary"
              }`}
              aria-label={isConnected ? "Connected" : "Disconnected"}
            />
          </span>

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
      {resolved === "light" ? (
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
  session,
  windowIndex,
}: {
  horizontal?: boolean;
  session: string;
  windowIndex: number;
}) {
  const label = horizontal ? "Split horizontally" : "Split vertically";

  const handleClick = () => {
    splitWindow(session, windowIndex, !!horizontal).catch(() => {
      // best-effort — tmux may reject if pane is too small
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
      title={label}
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
    </button>
  );
}

function FixedWidthToggle() {
  const { fixedWidth } = useChrome();
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
