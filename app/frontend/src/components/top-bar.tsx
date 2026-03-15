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
      {/* Top line: slides down + rotates +45deg when open */}
      <line
        x1="3"
        y1="4.5"
        x2="15"
        y2="4.5"
        style={{
          transition: "transform 200ms ease",
          transformOrigin: "9px 9px",
          transform: isOpen ? "translateY(4.5px) rotate(45deg)" : "none",
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
      {/* Bottom line: slides up + rotates -45deg when open */}
      <line
        x1="3"
        y1="13.5"
        x2="15"
        y2="13.5"
        style={{
          transition: "transform 200ms ease",
          transformOrigin: "9px 9px",
          transform: isOpen ? "translateY(-4.5px) rotate(-45deg)" : "none",
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
    <header className="px-3 sm:px-6 border-b border-border">
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
            className="text-text-secondary hover:text-text-primary transition-colors min-w-[24px] min-h-[24px] coarse:min-w-[36px] coarse:min-h-[36px] flex items-center justify-center"
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
          {/* Logo (decorative branding) — desktop only */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden="true"
            width={16}
            height={16}
            className="hidden sm:block"
          />
          {/* "Run Kit" text — desktop only */}
          <span className="hidden sm:inline text-xs text-text-secondary">Run Kit</span>

          {/* Connection dot — live region scoped to non-interactive status indicator */}
          <span role="status" aria-live="polite">
            <span
              className={`hidden sm:block w-2 h-2 rounded-full ${
                isConnected ? "bg-accent-green" : "bg-text-secondary"
              }`}
              aria-label={isConnected ? "Connected" : "Disconnected"}
            />
          </span>

          <span className="hidden sm:flex">
            <FixedWidthToggle />
          </span>

          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-border text-text-secondary">
            {"\u2318K"}
          </kbd>

          {/* Command palette trigger — mobile */}
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

          {/* Compose button — always visible */}
          <button
            type="button"
            onClick={onOpenCompose}
            aria-label="Compose text"
            className="text-text-secondary hover:text-text-primary transition-colors min-w-[24px] min-h-[24px] coarse:min-w-[36px] coarse:min-h-[36px] flex items-center justify-center border border-border rounded text-xs px-1.5 py-0.5"
          >
            &gt;_
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
