"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback, useRef } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { SessionCard } from "@/components/session-card";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { TopBar } from "@/components/top-bar";
import { Dialog } from "@/components/dialog";
import type { ProjectSession, WindowInfo } from "@/lib/types";

type Props = {
  initialSessions: ProjectSession[];
};

type FlatWindow = {
  projectName: string;
  window: WindowInfo;
  globalIndex: number;
};

export function DashboardClient({ initialSessions }: Props) {
  const router = useRouter();
  const { sessions, isConnected } = useSessions(initialSessions);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createSessionName, setCreateSessionName] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Kill window state
  const [killWindowTarget, setKillWindowTarget] = useState<{
    projectName: string;
    window: WindowInfo;
  } | null>(null);

  // Kill session state
  const [killSessionTarget, setKillSessionTarget] = useState<{
    name: string;
    windowCount: number;
  } | null>(null);

  // Flatten all windows with precomputed global indices
  const flatWindows: FlatWindow[] = useMemo(() => {
    let idx = 0;
    return sessions.flatMap((s) =>
      s.windows.map((w) => ({ projectName: s.name, window: w, globalIndex: idx++ })),
    );
  }, [sessions]);

  // Apply filter
  const filteredWindows = useMemo(() => {
    if (!filterQuery) return flatWindows;
    const q = filterQuery.toLowerCase();
    return flatWindows.filter(
      (fw) =>
        fw.window.name.toLowerCase().includes(q) ||
        fw.projectName.toLowerCase().includes(q) ||
        fw.window.worktreePath.toLowerCase().includes(q),
    );
  }, [flatWindows, filterQuery]);

  const navigateToWindow = useCallback(
    (index: number) => {
      const item = filteredWindows[index];
      if (item) {
        router.push(`/p/${item.projectName}/${item.window.index}?name=${encodeURIComponent(item.window.name)}`);
      }
    },
    [filteredWindows, router],
  );

  const navigateToProject = useCallback(
    (name: string) => {
      router.push(`/p/${name}`);
    },
    [router],
  );

  const { focusedIndex } = useKeyboardNav({
    itemCount: filteredWindows.length,
    onSelect: navigateToWindow,
    shortcuts: {
      c: () => setShowCreateDialog(true),
      "/": () => searchInputRef.current?.focus(),
    },
  });

  async function handleCreateSession() {
    if (!createSessionName.trim()) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createSession",
          name: createSessionName.trim(),
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setCreateSessionName("");
    setShowCreateDialog(false);
  }

  async function handleKillWindow() {
    if (!killWindowTarget) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "killWindow",
          session: killWindowTarget.projectName,
          index: killWindowTarget.window.index,
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setKillWindowTarget(null);
  }

  async function handleKillSession() {
    if (!killSessionTarget) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "killSession",
          session: killSessionTarget.name,
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setKillSessionTarget(null);
  }

  // Counts for summary
  const totalWindows = useMemo(
    () => sessions.reduce((sum, s) => sum + s.windows.length, 0),
    [sessions],
  );

  // Command palette actions — all shortcuts registered
  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Create new session",
        shortcut: "c",
        onSelect: () => setShowCreateDialog(true),
      },
      {
        id: "filter",
        label: "Focus search",
        shortcut: "/",
        onSelect: () => searchInputRef.current?.focus(),
      },
      ...sessions.map((s) => ({
        id: `project-${s.name}`,
        label: `Go to ${s.name}`,
        onSelect: () => navigateToProject(s.name),
      })),
      ...flatWindows.map((fw) => ({
        id: `window-${fw.projectName}-${fw.window.index}`,
        label: `Terminal: ${fw.projectName}/${fw.window.name}`,
        onSelect: () =>
          router.push(`/p/${fw.projectName}/${fw.window.index}?name=${encodeURIComponent(fw.window.name)}`),
      })),
    ],
    [sessions, flatWindows, navigateToProject, router],
  );

  // Precompute O(1) lookup: globalIndex → filteredIndex for focused state
  const globalToFilteredIndex = useMemo(() => {
    const map = new Map<number, number>();
    filteredWindows.forEach((fw, i) => map.set(fw.globalIndex, i));
    return map;
  }, [filteredWindows]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <TopBar
        breadcrumbs={[{ label: "Dashboard" }]}
        isConnected={isConnected}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
          >
            + New Session
          </button>
          <input
            ref={searchInputRef}
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilterQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search windows..."
            className="bg-bg-card text-text-primary text-sm px-3 py-1 border border-border rounded outline-none placeholder:text-text-secondary w-48 focus:border-text-secondary"
          />
        </div>
        <span className="text-xs text-text-secondary">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}, {totalWindows} window{totalWindows !== 1 ? "s" : ""}
        </span>
      </TopBar>

      {filteredWindows.length === 0 && flatWindows.length === 0 ? (
        <div className="text-center text-text-secondary py-16">
          <p className="text-sm">No active sessions</p>
          <p className="text-xs mt-2">
            Press <kbd className="px-1 border border-border rounded">c</kbd> to
            create one, or start a tmux session to get started
          </p>
        </div>
      ) : (
        sessions.map((session) => {
          // Filter windows for this session
          const sessionWindows = filteredWindows.filter(
            (fw) => fw.projectName === session.name,
          );

          if (sessionWindows.length === 0 && filterQuery) return null;
          return (
            <section key={session.name} className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => navigateToProject(session.name)}
                  className="text-sm text-text-secondary hover:text-text-primary flex items-center gap-2"
                >
                  <span className="font-medium">{session.name}</span>
                  <span className="text-xs">
                    {session.windows.length} window
                    {session.windows.length !== 1 ? "s" : ""}
                  </span>
                </button>
                <button
                  onClick={() =>
                    setKillSessionTarget({
                      name: session.name,
                      windowCount: session.windows.length,
                    })
                  }
                  className="text-text-secondary hover:text-red-400 transition-colors text-sm px-1"
                  title="Kill session"
                >
                  ✕
                </button>
              </div>
              <div className="grid gap-2">
                {(filterQuery ? sessionWindows : flatWindows.filter(
                  (f) => f.projectName === session.name,
                )).map((fw) => {
                  const filteredIdx = globalToFilteredIndex.get(fw.globalIndex) ?? -1;
                  return (
                    <SessionCard
                      key={`${fw.projectName}-${fw.window.index}`}
                      window={fw.window}
                      projectName={fw.projectName}
                      focused={filteredIdx === focusedIndex}
                      onClick={() => {
                        if (filteredIdx >= 0) navigateToWindow(filteredIdx);
                      }}
                      onKill={() =>
                        setKillWindowTarget({
                          projectName: fw.projectName,
                          window: fw.window,
                        })
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* Create session dialog */}
      {showCreateDialog && (
        <Dialog
          title="Create session"
          onClose={() => setShowCreateDialog(false)}
        >
          <input
            autoFocus
            type="text"
            value={createSessionName}
            onChange={(e) => setCreateSessionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
            placeholder="Session name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={handleCreateSession}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Create
          </button>
        </Dialog>
      )}

      {/* Kill window confirmation */}
      {killWindowTarget && (
        <Dialog
          title="Kill window?"
          onClose={() => setKillWindowTarget(null)}
        >
          <p className="text-sm text-text-secondary mb-3">
            Kill window <strong>{killWindowTarget.window.name}</strong>? This
            cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setKillWindowTarget(null)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillWindow}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      {/* Kill session confirmation */}
      {killSessionTarget && (
        <Dialog
          title="Kill session?"
          onClose={() => setKillSessionTarget(null)}
        >
          <p className="text-sm text-text-secondary mb-3">
            Kill session <strong>{killSessionTarget.name}</strong> and all{" "}
            {killSessionTarget.windowCount} window
            {killSessionTarget.windowCount !== 1 ? "s" : ""}? This cannot be
            undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setKillSessionTarget(null)}
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

      <CommandPalette actions={paletteActions} />
    </div>
  );
}
