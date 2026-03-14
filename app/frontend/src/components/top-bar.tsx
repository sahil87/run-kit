import { useCallback } from "react";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import type { ProjectSession, WindowInfo } from "@/types";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

type TopBarProps = {
  sessions: ProjectSession[];
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sessionName: string;
  windowName: string;
  isConnected: boolean;
  onNavigate: (session: string, windowIndex: number) => void;
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
};

export function TopBar({
  sessions,
  currentSession,
  currentWindow,
  sessionName,
  windowName,
  isConnected,
  onNavigate,
  onToggleSidebar,
  onToggleDrawer,
  onCreateSession,
  onCreateWindow,
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

  return (
    <header className="px-3 sm:px-6 border-b border-border">
      {/* Line 1: Hamburger + Logo + Breadcrumbs + Connection + Cmd+K */}
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          {/* Logo doubles as sidebar/drawer toggle */}
          <button
            onClick={() => {
              if (window.innerWidth >= 768) {
                onToggleSidebar();
              } else {
                onToggleDrawer();
              }
            }}
            aria-label="Toggle navigation"
            className="hover:opacity-80 transition-opacity min-w-[24px] min-h-[24px] coarse:min-w-[36px] coarse:min-h-[36px] flex items-center justify-center"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>

          {sessionName && (
            <span className="flex items-center gap-1.5">
              <BreadcrumbDropdown
                items={sessionItems}
                label="session"
                icon={"\u276F"}
                onNavigate={handleDropdownNavigate}
                action={{ label: "+ New Session", onAction: onCreateSession }}
              />
              <span className="text-text-secondary hover:text-text-primary">
                {sessionName}
              </span>
            </span>
          )}

          {windowName && (
            <span className="flex items-center gap-1.5">
              <BreadcrumbDropdown
                items={windowItems}
                label="window"
                icon={"\u276F"}
                onNavigate={handleDropdownNavigate}
                action={{ label: "+ New Window", onAction: () => onCreateWindow(sessionName) }}
              />
              <span className="text-text-primary font-medium" aria-current="page">
                {windowName}
              </span>
            </span>
          )}
        </nav>

        <div
          className="flex items-center gap-3 text-xs text-text-secondary"
          role="status"
          aria-live="polite"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-accent-green" : "bg-text-secondary"
            }`}
            aria-hidden="true"
          />
          <span>{isConnected ? "live" : "disconnected"}</span>
          <FixedWidthToggle />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-border text-text-secondary">
            {"\u2318K"}
          </kbd>
          <button
            type="button"
            onClick={() =>
              document.dispatchEvent(new CustomEvent("palette:open"))
            }
            aria-label="Open command palette"
            className="sm:hidden text-text-secondary hover:text-text-primary transition-colors min-w-[36px] min-h-[36px] coarse:min-h-[36px] coarse:min-w-[36px] flex items-center justify-center border border-border rounded"
          >
            {"\u22EF"}
          </button>
        </div>
      </div>

    </header>
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
      className={`px-1.5 py-0.5 rounded border transition-colors coarse:min-h-[36px] coarse:min-w-[28px] flex items-center justify-center ${
        fixedWidth
          ? "border-accent text-accent bg-accent/10"
          : "border-border text-text-secondary hover:border-text-secondary"
      }`}
      title={fixedWidth ? "Full width" : "Fixed width (965px)"}
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
