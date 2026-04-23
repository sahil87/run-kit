import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { usePinnedLanes } from "@/hooks/use-pinned-lanes";
import { Lane } from "@/components/lanes/lane";
import type { ProjectSession } from "@/types";

export function LanesPage() {
  const { pins, unpinWindow } = usePinnedLanes();
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Track lanes with closed windows (detected via SSE)
  const [closedLanes, setClosedLanes] = useState<Set<string>>(new Set());

  // Clamp focused index when pins change
  useEffect(() => {
    if (pins.length === 0) {
      setFocusedIndex(0);
    } else if (focusedIndex >= pins.length) {
      setFocusedIndex(pins.length - 1);
    }
  }, [pins.length, focusedIndex]);

  // Keyboard cycling: Ctrl+] next lane, Ctrl+[ previous lane
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || pins.length === 0) return;

      if (e.key === "]") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % pins.length);
      } else if (e.key === "[") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + pins.length) % pins.length);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pins.length]);

  // SSE multi-server subscription: one EventSource per unique server
  const uniqueServers = useMemo(
    () => [...new Set(pins.map((p) => p.server))],
    [pins],
  );

  // Refs for SSE handler — avoids tearing down EventSource connections on every pin/unpin
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const unpinWindowRef = useRef(unpinWindow);
  unpinWindowRef.current = unpinWindow;

  // Track auto-unpin timers so we can clear them on unmount
  const unpinTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const timer of unpinTimersRef.current.values()) {
        clearTimeout(timer);
      }
      unpinTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (uniqueServers.length === 0) return;

    const eventSources: EventSource[] = [];

    for (const serverName of uniqueServers) {
      const es = new EventSource(
        `/api/sessions/stream?server=${encodeURIComponent(serverName)}`,
      );

      es.addEventListener("sessions", (e) => {
        try {
          const sessions = JSON.parse(e.data) as ProjectSession[];
          const serverPins = pinsRef.current.filter((p) => p.server === serverName);

          for (const pin of serverPins) {
            const pinId = `${pin.server}:${pin.session}:${pin.windowIndex}`;
            const session = sessions.find((s) => s.name === pin.session);
            const windowExists = session?.windows.some(
              (w) => w.index === pin.windowIndex,
            );

            if (!windowExists) {
              setClosedLanes((prev) => {
                if (prev.has(pinId)) return prev;
                const next = new Set(prev);
                next.add(pinId);
                return next;
              });

              if (!unpinTimersRef.current.has(pinId)) {
                const timer = setTimeout(() => {
                  unpinTimersRef.current.delete(pinId);
                  unpinWindowRef.current(pin);
                  setClosedLanes((prev) => {
                    const next = new Set(prev);
                    next.delete(pinId);
                    return next;
                  });
                }, 5000);
                unpinTimersRef.current.set(pinId, timer);
              }
            } else {
              setClosedLanes((prev) => {
                if (!prev.has(pinId)) return prev;
                const next = new Set(prev);
                next.delete(pinId);
                return next;
              });
              const existingTimer = unpinTimersRef.current.get(pinId);
              if (existingTimer) {
                clearTimeout(existingTimer);
                unpinTimersRef.current.delete(pinId);
              }
            }
          }
        } catch {
          // Malformed SSE data — skip
        }
      });

      eventSources.push(es);
    }

    return () => {
      for (const es of eventSources) {
        es.close();
      }
    };
  }, [uniqueServers]);

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  if (pins.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
        <LanesTopBar pinCount={0} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <h2 className="text-lg text-text-primary">No panes pinned</h2>
          <p className="text-sm text-text-secondary max-w-md text-center">
            Pin windows from the sidebar or command palette to monitor them here
          </p>
          <a
            href="/"
            className="text-accent hover:underline text-sm"
          >
            Back to server list
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <LanesTopBar pinCount={pins.length} />
      <div
        className="flex-1 min-h-0 flex flex-row overflow-x-auto"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {pins.map((pin, index) => {
          const pinId = `${pin.server}:${pin.session}:${pin.windowIndex}`;
          return (
            <Lane
              key={pinId}
              pin={pin}
              focused={index === focusedIndex}
              onFocus={() => handleFocus(index)}
              onUnpin={() => unpinWindow(pin)}
              closed={closedLanes.has(pinId)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Minimal top bar for the lanes page — title, pin count, theme toggle, back link. */
function LanesTopBar({ pinCount }: { pinCount: number }) {
  return (
    <header className="px-3 border-b-2 border-border shrink-0">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-primary font-medium">Lanes</span>
          {pinCount > 0 && (
            <span className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded">
              {pinCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span className="text-text-secondary hidden sm:inline" title="Ctrl+] / Ctrl+[ to cycle lanes">
            Ctrl+]/[
          </span>
          <LanesThemeToggle />
          <a
            href="/"
            className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="hidden sm:inline">Run Kit</span>
            <img src="/icon.svg" alt="Run Kit" width={20} height={20} />
          </a>
        </div>
      </div>
    </header>
  );
}

/** Theme toggle for the lanes page — same cycle logic as top-bar's ThemeToggle. */
function LanesThemeToggle() {
  const { preference, resolved, themeDark, themeLight } = useTheme();
  const { setTheme } = useThemeActions();

  const mode = preference === "system" ? "system" : resolved;

  const handleClick = () => {
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
