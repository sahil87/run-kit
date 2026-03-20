import { useState, useCallback, useRef, useEffect } from "react";
import { killSession as killSessionApi, killWindow as killWindowApi, renameWindow } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { getWindowDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";

type SidebarProps = {
  sessions: ProjectSession[];
  currentSession: string | null;
  currentWindowIndex: string | null;
  onSelectWindow: (session: string, windowIndex: number) => void;
  onCreateWindow: (session: string) => void;
  onCreateSession: () => void;
  server: string;
  servers: string[];
  onSwitchServer: (name: string) => void;
};

export function Sidebar({
  sessions,
  currentSession,
  currentWindowIndex,
  onSelectWindow,
  onCreateWindow,
  onCreateSession,
  server,
  servers,
  onSwitchServer,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    type: "session" | "window";
    session: string;
    windowIndex?: number;
    windowCount: number;
  } | null>(null);

  const [editingWindow, setEditingWindow] = useState<{ session: string; index: number } | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const originalNameRef = useRef("");

  const [serverDropdownOpen, setServerDropdownOpen] = useState(false);
  const serverDropdownRef = useRef<HTMLDivElement>(null);

  // Close server dropdown on outside click
  useEffect(() => {
    if (!serverDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (serverDropdownRef.current && !serverDropdownRef.current.contains(e.target as Node)) {
        setServerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [serverDropdownOpen]);

  useEffect(() => {
    if (editingWindow && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingWindow]);

  function handleStartEditing(session: string, index: number, currentName: string) {
    cancelledRef.current = true; // cancel any in-progress edit before switching
    setEditingWindow({ session, index });
    setEditingName(currentName);
    originalNameRef.current = currentName;
    cancelledRef.current = false;
  }

  async function handleRenameCommit() {
    if (!editingWindow) return;
    const trimmed = editingName.trim();
    const originalName = originalNameRef.current;
    setEditingWindow(null);
    if (trimmed && trimmed !== originalName) {
      try {
        await renameWindow(editingWindow.session, editingWindow.index, trimmed);
      } catch {
        // SSE will reflect actual state
      }
    }
  }

  function handleRenameCancel() {
    cancelledRef.current = true;
    setEditingWindow(null);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRenameCancel();
    }
  }

  function handleRenameBlur() {
    if (cancelledRef.current) return;
    handleRenameCommit();
  }

  const toggleSession = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  async function handleKill() {
    if (!killTarget) return;
    try {
      if (killTarget.type === "window" && killTarget.windowIndex != null) {
        await killWindowApi(killTarget.session, killTarget.windowIndex);
      } else {
        await killSessionApi(killTarget.session);
      }
    } catch {
      // SSE will reflect
    }
    setKillTarget(null);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <nav aria-label="Sessions" className="flex flex-col h-full py-2">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4">
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
                    </button>
                  </div>
                  <div className="flex items-center">
                    <button
                      onClick={() => onCreateWindow(session.name)}
                      aria-label={`New window in ${session.name}`}
                      className="text-text-secondary hover:text-text-primary transition-colors text-[16px] px-1 min-h-[32px] coarse:min-h-[44px] flex items-center justify-center"
                    >
                      +
                    </button>
                    <button
                      onClick={() =>
                        setKillTarget({
                          type: "session",
                          session: session.name,
                          windowCount: session.windows.length,
                        })
                      }
                      aria-label={`Kill session ${session.name}`}
                      className="text-text-secondary hover:text-red-400 transition-colors text-[16px] px-1 min-h-[32px] coarse:min-h-[44px] flex items-center justify-center"
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
                      const duration = getWindowDuration(win, nowSeconds);


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
                              {editingWindow?.session === session.name && editingWindow.index === win.index ? (
                                <input
                                  ref={inputRef}
                                  type="text"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={handleRenameKeyDown}
                                  onBlur={handleRenameBlur}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className="text-sm bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
                                  aria-label="Rename window"
                                />
                              ) : (
                                <span
                                  className="truncate"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEditing(session.name, win.index, win.name);
                                  }}
                                >{win.name}</span>
                              )}
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
                          {/* Kill window button: hover-reveal on desktop, always visible on mobile */}
                          <button
                            type="button"
                            aria-label={`Kill window ${win.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setKillTarget({
                                type: "window",
                                session: session.name,
                                windowIndex: win.index,
                                windowCount: 1,
                              });
                            }}
                            className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[14px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 px-1 min-h-[28px] coarse:min-h-[44px] flex items-center justify-center z-10"
                          >
                            {"\u2715"}
                          </button>
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

      {/* Server selector — pinned at bottom */}
      <div className="shrink-0 border-t border-border px-3 sm:px-4 py-2" ref={serverDropdownRef}>
        <div className="flex items-center gap-1.5 relative">
          <span className="text-xs text-text-secondary">Server:</span>
          <button
            onClick={() => setServerDropdownOpen((v) => !v)}
            className="text-xs text-text-primary font-medium hover:text-accent transition-colors coarse:min-h-[44px] flex items-center"
            aria-haspopup="listbox"
            aria-expanded={serverDropdownOpen}
          >
            {server}
            <span className="ml-0.5 text-text-secondary text-[10px]">{serverDropdownOpen ? "\u25B4" : "\u25BE"}</span>
          </button>
          {serverDropdownOpen && (
            <div className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded shadow-2xl z-50 min-w-[140px] py-1">
              {servers.length === 0 ? (
                <div className="text-xs text-text-secondary px-3 py-1.5">No servers</div>
              ) : (
                servers.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      onSwitchServer(s);
                      setServerDropdownOpen(false);
                    }}
                    className={`w-full text-left text-xs px-3 py-1.5 hover:bg-bg-card transition-colors ${
                      s === server ? "text-accent font-medium" : "text-text-primary"
                    }`}
                    role="option"
                    aria-selected={s === server}
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Kill confirmation */}
      {killTarget && (
        <Dialog
          title={killTarget.type === "window" ? "Kill window?" : "Kill session?"}
          onClose={() => setKillTarget(null)}
        >
          <p className="text-sm text-text-secondary mb-3">
            {killTarget.type === "window" ? (
              <>Kill this window in <strong>{killTarget.session}</strong>?</>
            ) : (
              <>Kill session <strong>{killTarget.session}</strong> and all{" "}
              {killTarget.windowCount} window
              {killTarget.windowCount !== 1 ? "s" : ""}?</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setKillTarget(null)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKill}
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
