import { useState, useCallback, useMemo } from "react";
import { getWindowDuration, parseFabChange } from "@/lib/format";
import type { ProjectSession } from "@/types";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { MergedSession } from "@/contexts/optimistic-context";

type DashboardProps = {
  sessions: (ProjectSession | MergedSession)[];
  onNavigate: (session: string, windowIndex: number) => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
};

export function Dashboard({
  sessions,
  onNavigate,
  onCreateSession,
  onCreateWindow,
}: DashboardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const totalWindows = useMemo(
    () => sessions.reduce((sum, s) => sum + s.windows.length, 0),
    [sessions],
  );

  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Stats line — pinned at top */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="text-sm text-text-secondary mb-4">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""},{" "}
          {totalWindows} window{totalWindows !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Scrollable card area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sessions.map((session) => {
          const isExpanded = expanded[session.name] ?? false;
          const activeCount = session.windows.filter(
            (w) => w.activity === "active",
          ).length;
          const idleCount = session.windows.length - activeCount;
          const isGhostSession = "optimistic" in session && session.optimistic;

          return (
            <div
              key={session.name}
              className={`bg-bg-card border border-border rounded${isGhostSession ? " opacity-50 animate-pulse" : ""}`}
            >
              {/* Session card header */}
              <button
                onClick={() => toggleExpand(session.name)}
                className="w-full text-left p-3 min-h-[36px] flex items-center justify-between"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${session.name}`}
              >
                <div className="min-w-0">
                  <div className="text-text-primary font-medium text-sm truncate">
                    {session.name}
                  </div>
                  <div className="text-text-secondary text-xs mt-0.5">
                    {session.windows.length} window
                    {session.windows.length !== 1 ? "s" : ""}
                    {session.windows.length > 0 && (
                      <span className="ml-1.5">
                        &middot; {activeCount} active, {idleCount} idle
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="text-xs text-text-secondary shrink-0 ml-2"
                  aria-hidden="true"
                >
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
              </button>

              {/* Window cards */}
              {isExpanded && (
                <div className="border-t border-border px-3 pb-3 pt-2 flex flex-col gap-2">
                  {session.windows.map((win) => {
                    const duration = getWindowDuration(win, nowSeconds);
                    const fabInfo = parseFabChange(win.fabChange ?? "");
                    const ghost = isGhostWindow(win);

                    return (
                      <button
                        key={ghost ? `ghost-${win.optimisticId}` : win.index}
                        onClick={() => onNavigate(session.name, win.index)}
                        className={`w-full text-left p-2 rounded bg-bg-primary border border-border hover:border-text-secondary transition-colors min-h-[36px]${ghost ? " opacity-50 animate-pulse" : ""}`}
                        data-testid={`window-card-${session.name}-${win.index}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary text-sm font-medium truncate">
                            {win.name}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {win.fabStage && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                                {win.fabStage}
                              </span>
                            )}
                            {win.worktreePath && (
                              <span className="text-xs text-text-secondary">
                                {win.worktreePath.split("/").pop()}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-text-secondary">
                          {win.paneCommand && (
                            <span className="truncate">{win.paneCommand}</span>
                          )}
                          <span className="flex items-center gap-1 shrink-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                win.activity === "active"
                                  ? "bg-accent-green"
                                  : "bg-text-secondary/40"
                              }`}
                              aria-hidden="true"
                            />
                            <span>
                              {win.activity}
                              {duration && ` \u00B7 ${duration}`}
                            </span>
                          </span>
                        </div>
                        {fabInfo && (
                          <div className="text-xs text-text-secondary mt-1">
                            {fabInfo.id} &middot; {fabInfo.slug}
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {/* New Window button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateWindow(session.name);
                    }}
                    className="text-sm text-text-secondary hover:text-text-primary transition-colors py-1.5 border border-dashed border-border rounded hover:border-text-secondary min-h-[36px] flex items-center justify-center"
                  >
                    + New Window
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* New Session button card */}
        <button
          onClick={onCreateSession}
          className="border border-dashed border-border rounded p-3 text-sm text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors min-h-[36px] flex items-center justify-center"
        >
          + New Session
        </button>
        </div>
      </div>
    </div>
  );
}
