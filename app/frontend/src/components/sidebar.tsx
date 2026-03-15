import { useState, useCallback, useEffect } from "react";
import { killSession as killSessionApi } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { parseFabChange, getWindowDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";

type SidebarProps = {
  sessions: ProjectSession[];
  currentSession: string | null;
  currentWindowIndex: string | null;
  onSelectWindow: (session: string, windowIndex: number) => void;
  onCreateWindow: (session: string) => void;
  onCreateSession: () => void;
};

export function Sidebar({
  sessions,
  currentSession,
  currentWindowIndex,
  onSelectWindow,
  onCreateWindow,
  onCreateSession,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    name: string;
    windowCount: number;
  } | null>(null);
  const [popoverKey, setPopoverKey] = useState<string | null>(null);

  const toggleSession = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // Dismiss popover on outside click and Escape
  useEffect(() => {
    if (!popoverKey) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-info-popover]") && !target.closest("[data-info-btn]")) {
        setPopoverKey(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPopoverKey(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [popoverKey]);

  async function handleKillSession() {
    if (!killTarget) return;
    try {
      await killSessionApi(killTarget.name);
    } catch {
      // SSE will reflect
    }
    setKillTarget(null);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <nav aria-label="Sessions" className="flex flex-col h-full py-2">
      <div className="flex-1 overflow-y-auto px-3 sm:px-4">
        {sessions.length === 0 ? (
          <div className="text-text-secondary text-xs py-4 text-center flex flex-col items-center gap-2">
            <span>No sessions</span>
            <button
              onClick={onCreateSession}
              className="text-sm px-3 py-1.5 border border-border rounded hover:border-text-secondary text-text-primary"
            >
              + New Session
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isCollapsed = collapsed[session.name] ?? false;
            return (
              <div key={session.name} className="mb-2">
                {/* Session row */}
                <div className="flex items-center justify-between group">
                  <div className="flex items-center gap-0.5 min-w-0">
                    <button
                      onClick={() => toggleSession(session.name)}
                      className="text-xs text-text-secondary hover:text-text-primary transition-colors w-5 shrink-0 min-h-[32px] coarse:min-h-[44px] flex items-center justify-center"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${session.name}`}
                    >
                      {isCollapsed ? "\u25B6" : "\u25BC"}
                    </button>
                    <button
                      onClick={() => onSelectWindow(session.name, session.windows[0]?.index ?? 0)}
                      className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[32px] coarse:min-h-[44px] min-w-0"
                      aria-label={`Navigate to ${session.name}`}
                    >
                      <span className="font-medium truncate">{session.name}</span>
                      {session.byobu && (
                        <span className="text-[10px] text-accent-green/70 shrink-0" aria-label="byobu session">b</span>
                      )}
                    </button>
                  </div>
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
                      const winKey = `${session.name}:${win.index}`;
                      const duration = getWindowDuration(win, nowSeconds);
                      const fabInfo = parseFabChange(win.fabChange ?? "");
                      const isPopoverOpen = popoverKey === winKey;


                      return (
                        <div key={win.index} className="relative group">
                          <button
                            onClick={() => onSelectWindow(session.name, win.index)}
                            className={`w-full text-left flex items-center justify-between gap-2 py-1 pl-2 pr-6 text-sm transition-colors min-h-[28px] coarse:min-h-[44px] border-l-2 ${
                              isSelected
                                ? "bg-accent/10 border-accent text-text-primary font-medium rounded-r"
                                : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50 border-transparent rounded"
                            }`}
                            aria-current={isSelected ? "page" : undefined}
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
                            <span className="flex items-center gap-1.5 shrink-0">
                              {win.fabStage && (
                                <span className="text-xs text-text-secondary">
                                  {win.fabStage}
                                </span>
                              )}
                              {duration && (
                                <span className="text-xs text-text-secondary">
                                  {duration}
                                </span>
                              )}
                            </span>
                          </button>
                          {/* Info button: hover-reveal on desktop, always visible on mobile — sibling to avoid nested interactive elements */}
                          <button
                            type="button"
                            data-info-btn
                            aria-label={`Info for ${win.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPopoverKey(isPopoverOpen ? null : winKey);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 min-w-[16px] min-h-[28px] coarse:min-h-[44px] flex items-center justify-center z-10"
                          >
                            {"\u24D8"}
                          </button>

                          {/* Info popover */}
                          {isPopoverOpen && (
                            <div
                              data-info-popover
                              className="absolute right-0 top-full mt-1 bg-bg-primary border border-border shadow-2xl rounded py-1 px-2 text-xs z-50 w-[200px]"
                            >
                              {fabInfo && (
                                <div className="flex justify-between py-1">
                                  <span className="text-text-secondary">Change</span>
                                  <span className="text-text-primary">{fabInfo.id} &middot; {fabInfo.slug}</span>
                                </div>
                              )}
                              {win.paneCommand && (
                                <div className="flex justify-between py-1">
                                  <span className="text-text-secondary">Process</span>
                                  <span className="text-text-primary">{win.paneCommand}</span>
                                </div>
                              )}
                              <div className="flex justify-between py-1">
                                <span className="text-text-secondary">Path</span>
                                <span className="text-text-primary truncate ml-2 max-w-[180px]">{win.worktreePath}</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-text-secondary">State</span>
                                <span className="text-text-primary">
                                  {win.activity}
                                  {win.agentState && win.agentState !== "unknown" && ` \u00B7 ${win.agentState}`}
                                  {duration && ` \u00B7 ${duration}`}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
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
