import { useCallback } from "react";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import { parseFabChange, getWindowDuration } from "@/lib/format";
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
  onRename: () => void;
  onKill: () => void;
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
  onCreateSession: () => void;
};

export function TopBar({
  sessions,
  currentSession,
  currentWindow,
  sessionName,
  windowName,
  isConnected,
  onNavigate,
  onRename,
  onKill,
  onToggleSidebar,
  onToggleDrawer,
  onCreateSession,
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
            <img src="/logo.svg" alt="RunKit" width={20} height={20} />
          </button>

          {sessionName && (
            <span className="flex items-center gap-1.5">
              <BreadcrumbDropdown
                items={sessionItems}
                label="session"
                icon={"\u276F"}
                onNavigate={handleDropdownNavigate}
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

      {/* Line 2: Action buttons + status */}
      <div className="flex items-center justify-between py-2 min-h-[36px]">
        <div className="hidden sm:flex items-center gap-3">
          <button
            onClick={onCreateSession}
            className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
          >
            + Session
          </button>
          {currentWindow && (
            <>
              <button
                onClick={onRename}
                className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
              >
                Rename
              </button>
              <button
                onClick={onKill}
                className="text-sm px-3 py-1 border border-border rounded hover:border-red-400 hover:text-red-400 transition-colors"
              >
                Kill
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          {currentWindow && (
            <div className="hidden sm:flex items-center gap-2" data-testid="line2-status">
              <span
                className={`w-2 h-2 rounded-full ${
                  currentWindow.activity === "active"
                    ? "bg-accent-green"
                    : "bg-text-secondary"
                }`}
              />
              <span>{currentWindow.activity}</span>
              {currentWindow.paneCommand && (
                <>
                  <span className="text-text-secondary/50">{"\u00B7"}</span>
                  <span>{currentWindow.paneCommand}</span>
                </>
              )}
              {(() => {
                const dur = getWindowDuration(currentWindow, Math.floor(Date.now() / 1000));
                return dur ? (
                  <>
                    <span className="text-text-secondary/50">{"\u00B7"}</span>
                    <span>{dur}</span>
                  </>
                ) : null;
              })()}
              {currentWindow.fabStage && (
                <>
                  <span className="text-text-secondary/50">{"\u2502"}</span>
                  <span className="text-accent px-1.5 py-0.5 rounded bg-accent/10">
                    {currentWindow.fabStage}
                  </span>
                  {(() => {
                    const fabInfo = parseFabChange(currentWindow.fabChange ?? "");
                    return fabInfo ? (
                      <>
                        <span className="text-text-secondary/50">{"\u00B7"}</span>
                        <span>{fabInfo.id}</span>
                        <span className="text-text-secondary/50">{"\u00B7"}</span>
                        <span>{fabInfo.slug}</span>
                      </>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          )}
          <FixedWidthToggle />
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
      className={`px-1.5 py-0.5 rounded border transition-colors ${
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
