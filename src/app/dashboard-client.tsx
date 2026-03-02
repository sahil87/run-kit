"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { SessionCard } from "@/components/session-card";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
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
  const [showFilter, setShowFilter] = useState(false);

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
        router.push(`/p/${item.projectName}/${item.window.index}`);
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
      "/": () => setShowFilter(true),
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
        label: "Filter windows",
        shortcut: "/",
        onSelect: () => setShowFilter(true),
      },
      ...sessions
        .filter((s) => s.name !== "Other")
        .map((s) => ({
          id: `project-${s.name}`,
          label: `Go to ${s.name}`,
          onSelect: () => navigateToProject(s.name),
        })),
      ...flatWindows.map((fw) => ({
        id: `window-${fw.projectName}-${fw.window.index}`,
        label: `Terminal: ${fw.projectName}/${fw.window.name}`,
        onSelect: () =>
          router.push(`/p/${fw.projectName}/${fw.window.index}`),
      })),
    ],
    [sessions, flatWindows, navigateToProject, router],
  );

  // Build a set for quick lookup of which global indices are in filtered results
  const filteredGlobalIndices = useMemo(
    () => new Set(filteredWindows.map((fw) => fw.globalIndex)),
    [filteredWindows],
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-lg font-medium">run-kit</h1>
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-accent-green" : "bg-text-secondary"
            }`}
          />
          <span>{isConnected ? "live" : "disconnected"}</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border text-text-secondary">
            ⌘K
          </kbd>
        </div>
      </header>

      {/* Filter bar */}
      {showFilter && (
        <div className="mb-4">
          <input
            autoFocus
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowFilter(false);
                setFilterQuery("");
              }
            }}
            placeholder="Filter windows..."
            className="w-full bg-bg-card text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
        </div>
      )}

      {filteredWindows.length === 0 && flatWindows.length === 0 ? (
        <div className="text-center text-text-secondary py-16">
          <p className="text-sm">No active sessions</p>
          <p className="text-xs mt-2">
            Press <kbd className="px-1 border border-border rounded">c</kbd> to
            create one, or start a tmux session matching a project key in
            run-kit.yaml
          </p>
        </div>
      ) : (
        sessions.map((session) => {
          // Filter windows for this session
          const sessionWindows = filteredWindows.filter(
            (fw) => fw.projectName === session.name,
          );

          if (sessionWindows.length === 0 && filterQuery) return null;
          if (session.windows.length === 0 && session.name === "Other")
            return null;

          return (
            <section key={session.name} className="mb-6">
              <button
                onClick={() => navigateToProject(session.name)}
                className="text-sm text-text-secondary hover:text-text-primary mb-3 flex items-center gap-2"
              >
                <span className="font-medium">{session.name}</span>
                <span className="text-xs">
                  {session.windows.length} window
                  {session.windows.length !== 1 ? "s" : ""}
                </span>
              </button>
              <div className="grid gap-2">
                {(filterQuery ? sessionWindows : session.windows.map((w, i) => {
                  // Find the flatWindow for this window to get globalIndex
                  const fw = flatWindows.find(
                    (f) => f.projectName === session.name && f.window.index === w.index,
                  );
                  return fw ?? { projectName: session.name, window: w, globalIndex: i };
                })).map((fw) => {
                  const filteredIdx = filteredWindows.findIndex(
                    (f) => f.globalIndex === fw.globalIndex,
                  );
                  return (
                    <SessionCard
                      key={`${fw.projectName}-${fw.window.index}`}
                      window={fw.window}
                      projectName={fw.projectName}
                      focused={filteredIdx === focusedIndex}
                      onClick={() => {
                        if (filteredIdx >= 0) navigateToWindow(filteredIdx);
                      }}
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
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          onClick={() => setShowCreateDialog(false)}
        >
          <div className="fixed inset-0 bg-black/50" />
          <div
            className="relative bg-bg-primary border border-border rounded-lg p-4 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-medium mb-3">Create session</h2>
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
          </div>
        </div>
      )}

      <CommandPalette actions={paletteActions} />
    </div>
  );
}
