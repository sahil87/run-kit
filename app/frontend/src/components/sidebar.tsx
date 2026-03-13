import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { killSession as killSessionApi } from "@/api/client";
import { Dialog } from "@/components/dialog";
import type { ProjectSession } from "@/types";

type SidebarProps = {
  sessions: ProjectSession[];
  currentSession: string | null;
  currentWindowIndex: string | null;
  focusedIndex?: number;
  onSelectWindow: (session: string, windowIndex: number) => void;
  onCreateWindow: (session: string) => void;
};

export function Sidebar({
  sessions,
  currentSession,
  currentWindowIndex,
  focusedIndex,
  onSelectWindow,
  onCreateWindow,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    name: string;
    windowCount: number;
  } | null>(null);
  const focusedRef = useRef<HTMLButtonElement | null>(null);

  const toggleSession = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // Build a flat index map for keyboard navigation highlight
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const session of sessions) {
      for (const win of session.windows) {
        map.set(`${session.name}:${win.index}`, idx++);
      }
    }
    return map;
  }, [sessions]);

  // Scroll the focused item into view
  useEffect(() => {
    if (focusedIndex != null && focusedRef.current) {
      focusedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  async function handleKillSession() {
    if (!killTarget) return;
    try {
      await killSessionApi(killTarget.name);
    } catch {
      // SSE will reflect
    }
    setKillTarget(null);
  }

  return (
    <nav aria-label="Sessions" className="flex flex-col h-full py-2">
      <div className="flex-1 overflow-y-auto px-3 sm:px-6">
        {sessions.length === 0 ? (
          <div className="text-text-secondary text-xs py-4 text-center">
            No sessions
          </div>
        ) : (
          sessions.map((session) => {
            const isCollapsed = collapsed[session.name] ?? false;
            return (
              <div key={session.name} className="mb-2">
                {/* Session row */}
                <div className="flex items-center justify-between group">
                  <button
                    onClick={() => toggleSession(session.name)}
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[32px] coarse:min-h-[44px]"
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${session.name}`}
                  >
                    <span className="text-xs w-3" aria-hidden="true">
                      {isCollapsed ? "\u25B6" : "\u25BC"}
                    </span>
                    <span className="font-medium truncate">{session.name}</span>
                    {session.byobu && (
                      <span className="text-[10px] text-accent-green/70 shrink-0" aria-label="byobu session">b</span>
                    )}
                  </button>
                  <div className="flex items-center">
                    <button
                      onClick={() => onCreateWindow(session.name)}
                      aria-label={`New window in ${session.name}`}
                      className="text-text-secondary hover:text-text-primary transition-colors text-xs px-1 min-h-[32px] coarse:min-h-[44px] flex items-center justify-center"
                    >
                      +
                    </button>
                    <button
                      onClick={() =>
                        setKillTarget({
                          name: session.name,
                          windowCount: session.windows.length,
                        })
                      }
                      aria-label={`Kill session ${session.name}`}
                      className="text-text-secondary hover:text-red-400 transition-colors text-xs px-1 min-h-[32px] coarse:min-h-[44px] flex items-center justify-center"
                    >
                      {"\u2715"}
                    </button>
                  </div>
                </div>

                {/* Window rows */}
                {!isCollapsed && (
                  <div className="ml-1">
                    {session.windows.map((win) => {
                      const isSelected =
                        currentSession === session.name &&
                        currentWindowIndex === String(win.index);
                      const winFlatIndex = flatIndexMap.get(`${session.name}:${win.index}`);
                      const isFocused = focusedIndex != null && winFlatIndex === focusedIndex;
                      return (
                        <button
                          key={win.index}
                          ref={isFocused ? focusedRef : undefined}
                          onClick={() => onSelectWindow(session.name, win.index)}
                          className={`w-full text-left flex items-center justify-between gap-2 py-1 px-2 text-sm rounded transition-colors min-h-[28px] coarse:min-h-[44px] ${
                            isSelected
                              ? "bg-card border-l-2 border-accent text-text-primary"
                              : isFocused
                                ? "bg-bg-card/70 text-text-primary ring-1 ring-accent/50"
                                : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
                          }`}
                          aria-current={isSelected ? "page" : undefined}
                          data-focused={isFocused || undefined}
                        >
                          <span className="flex items-center gap-1.5 truncate min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                win.activity === "active"
                                  ? "bg-accent-green"
                                  : "bg-text-secondary/40"
                              }`}
                              aria-label={win.activity}
                            />
                            <span className="truncate">{win.name}</span>
                          </span>
                          {win.fabStage && (
                            <span className="text-xs text-text-secondary shrink-0">
                              {win.fabStage}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Kill session confirmation */}
      {killTarget && (
        <Dialog title="Kill session?" onClose={() => setKillTarget(null)}>
          <p className="text-sm text-text-secondary mb-3">
            Kill session <strong>{killTarget.name}</strong> and all{" "}
            {killTarget.windowCount} window
            {killTarget.windowCount !== 1 ? "s" : ""}?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setKillTarget(null)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillSession}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}
    </nav>
  );
}
