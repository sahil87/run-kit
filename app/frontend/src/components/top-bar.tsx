import { useCallback, useEffect, useRef, useState } from "react";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import { LogoSpinner } from "@/components/logo-spinner";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { splitWindow, closePane, getNowPlaying, controlMusic } from "@/api/client";
import type { NowPlayingInfo } from "@/api/client";
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
  server: string;
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
  server,
  onNavigate,
  onToggleSidebar,
  onToggleDrawer,
  onCreateSession,
  onCreateWindow,
  onOpenCompose,
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
            <MusicControls />
          </span>
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

// ──────────────────────────────────────────────────────────────
// Music mascot: the Run Kit hexagon that bobs its head to music
// ──────────────────────────────────────────────────────────────
function MusicMascot({ isPlaying, size = 18 }: { isPlaying: boolean; size?: number }) {
  return (
    <svg
      viewBox="7 10 50 44"
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        animation: isPlaying ? "music-bob 0.95s ease-in-out infinite" : "none",
        transformOrigin: "50% 50%",
        transition: "filter 0.2s ease",
        display: "block",
        flexShrink: 0,
      }}
    >
      {/* Border segments */}
      <polygon points="44,11.2 56,32 47.5,32 39.5,17.2" fill={isPlaying ? "#7aa2f7" : "#b4b4b4"} style={{ transition: "fill 0.4s" }} />
      <polygon points="56,32 44,52.8 39.5,46.8 47.5,32"  fill={isPlaying ? "#7aa2f7" : "#b4b4b4"} style={{ transition: "fill 0.4s" }} />
      <polygon points="44,52.8 20,52.8 24.5,46.8 39.5,46.8" fill="#2a2a2a" />
      <polygon points="20,52.8 8,32 16.5,32 24.5,46.8"    fill="#2a2a2a" />
      <polygon points="8,32 20,11.2 24.5,17.2 16.5,32"    fill="#2a2a2a" />
      <polygon points="20,11.2 44,11.2 39.5,17.2 24.5,17.2" fill={isPlaying ? "#9db8fb" : "#b4b4b4"} style={{ transition: "fill 0.4s" }} />
      {/* Inner cube faces */}
      <polygon points="24.5,17.2 39.5,17.2 47.5,32 32,32" fill={isPlaying ? "#5b8af0" : "#888888"} style={{ transition: "fill 0.4s" }} />
      <polygon points="47.5,32 39.5,46.8 24.5,46.8 32,32" fill={isPlaying ? "#4a70cc" : "#737373"} style={{ transition: "fill 0.4s" }} />
      <polygon points="24.5,46.8 16.5,32 24.5,17.2 32,32"  fill={isPlaying ? "#3558a8" : "#545454"} style={{ transition: "fill 0.4s" }} />
    </svg>
  );
}

// Animated equalizer bars — visible when playing
function EqualizerBars() {
  return (
    <div className="flex items-end gap-px h-[12px]" aria-hidden="true">
      {[
        { animation: "music-eq1 0.7s ease-in-out infinite", height: "3px" },
        { animation: "music-eq2 0.9s ease-in-out infinite 0.1s", height: "9px" },
        { animation: "music-eq3 0.75s ease-in-out infinite 0.2s", height: "5px" },
      ].map((bar, i) => (
        <div
          key={i}
          className="w-[2px] rounded-sm bg-accent"
          style={{ animation: bar.animation, height: bar.height }}
        />
      ))}
    </div>
  );
}

// Format seconds → m:ss
function fmtTime(s: number) {
  if (!s || !isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function MusicControls() {
  const [info, setInfo] = useState<NowPlayingInfo>({
    title: "", artist: "", state: "stopped", app: "", duration: 0, elapsedTime: 0,
  });
  const [polledAt, setPolledAt] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doPoll = useCallback(async () => {
    try {
      const data = await getNowPlaying();
      setInfo(data);
      setPolledAt(Date.now());
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    doPoll();
    intervalRef.current = setInterval(doPoll, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [doPoll]);

  const handle = async (action: "play" | "pause" | "next" | "previous") => {
    if (action === "play" || action === "pause") {
      setInfo((prev) => ({ ...prev, state: action === "play" ? "playing" : "paused" }));
    }
    await controlMusic(action);
    setTimeout(doPoll, 700);
  };

  if (info.state === "stopped" || !info.title) return null;

  const isPlaying = info.state === "playing";
  const progressPct = info.duration > 0 ? (info.elapsedTime / info.duration) * 100 : 0;
  const remainingSecs = Math.max(0, info.duration - info.elapsedTime);
  // How long since we last polled — approximate elapsed advance
  const secondsSincePoll = isPlaying ? (Date.now() - polledAt) / 1000 : 0;
  const liveElapsed = Math.min(info.duration, info.elapsedTime + secondsSincePoll);
  const liveProgressPct = info.duration > 0 ? (liveElapsed / info.duration) * 100 : 0;

  const btnBase =
    "min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary " +
    "hover:border-accent hover:text-accent hover:scale-110 " +
    "transition-all duration-150 flex items-center justify-center active:scale-95";

  return (
    <div
      className="group relative flex items-center gap-1.5"
      title={`${info.title} — ${info.artist}`}
    >
      {/* Mascot — always visible, bobs when playing, glows on hover */}
      <div
        className="hover:drop-shadow-[0_0_6px_rgba(91,138,240,0.8)] transition-[filter] duration-200 cursor-default"
        title={isPlaying ? "Now playing" : "Paused"}
      >
        <MusicMascot isPlaying={isPlaying} size={18} />
      </div>

      {/* Equalizer — visible when playing, hidden on hover (controls take over) */}
      {isPlaying && (
        <div className="group-hover:opacity-0 group-hover:w-0 overflow-hidden transition-all duration-200">
          <EqualizerBars />
        </div>
      )}

      {/* Track name — compact always-visible label */}
      <span className="text-xs text-text-secondary max-w-[88px] truncate block group-hover:opacity-0 group-hover:max-w-0 overflow-hidden transition-all duration-200 select-none">
        {info.title}
      </span>

      {/* ── Hover panel ─────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1.5 overflow-hidden max-w-0 opacity-0 group-hover:opacity-100 group-hover:max-w-[320px] transition-all duration-250 ease-in-out"
      >
        {/* Previous */}
        <button type="button" onClick={() => handle("previous")} aria-label="Previous track" className={btnBase} title="Previous">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="19,20 9,12 19,4" />
            <rect x="5" y="4" width="3" height="16" />
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          type="button"
          onClick={() => handle(isPlaying ? "pause" : "play")}
          aria-label={isPlaying ? "Pause" : "Play"}
          className={`${btnBase} ${isPlaying ? "border-accent text-accent bg-accent/10" : ""}`}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Next */}
        <button type="button" onClick={() => handle("next")} aria-label="Next track" className={btnBase} title="Next">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5,4 15,12 5,20" />
            <rect x="16" y="4" width="3" height="16" />
          </svg>
        </button>

        {/* Track info + progress */}
        <div className="flex flex-col justify-center min-w-0 gap-[2px] pl-0.5">
          <span className="text-[11px] text-text-primary font-medium truncate max-w-[110px] leading-tight">{info.title}</span>
          <span className="text-[10px] text-text-secondary truncate max-w-[110px] leading-tight">{info.artist}</span>

          {/* Progress bar */}
          {info.duration > 0 && (
            <div className="flex items-center gap-1 mt-[2px]">
              <span className="text-[9px] text-text-secondary tabular-nums">{fmtTime(liveElapsed)}</span>
              <div className="relative h-[2px] flex-1 min-w-[40px] bg-border rounded-full overflow-hidden">
                <div
                  key={`${info.title}-${info.artist}`}
                  className="absolute inset-y-0 left-0 bg-accent rounded-full"
                  style={isPlaying ? {
                    animation: `music-progress ${remainingSecs}s linear forwards`,
                    "--music-progress-start": `${liveProgressPct}%`,
                  } as React.CSSProperties : { width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[9px] text-text-secondary tabular-nums">{fmtTime(info.duration)}</span>
            </div>
          )}
        </div>
      </div>
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
