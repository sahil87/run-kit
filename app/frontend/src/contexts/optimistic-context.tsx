import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ProjectSession, WindowInfo } from "@/types";
import { useWindowStore } from "@/store/window-store";
import type { MergedWindow } from "@/store/window-store";

type GhostType = "session" | "server";

type GhostEntry = {
  optimisticId: string;
  type: GhostType;
  name: string;
};

type KilledEntry = {
  type: "session" | "server";
  identifier: string;
};

type RenamedEntry = {
  type: "session";
  identifier: string;
  newName: string;
};

type OptimisticContextType = {
  addGhostSession: (name: string) => string;
  addGhostServer: (name: string) => string;
  removeGhost: (id: string) => void;
  markKilled: (type: "session" | "server", identifier: string) => void;
  unmarkKilled: (identifier: string) => void;
  markRenamed: (type: "session", identifier: string, newName: string) => void;
  unmarkRenamed: (identifier: string) => void;
  ghosts: GhostEntry[];
  killed: KilledEntry[];
  renamed: RenamedEntry[];
};

const OptimisticContext = createContext<OptimisticContextType | null>(null);

let ghostIdCounter = 0;

export function OptimisticProvider({ children }: { children: React.ReactNode }) {
  const [ghosts, setGhosts] = useState<GhostEntry[]>([]);
  const [killed, setKilled] = useState<KilledEntry[]>([]);
  const [renamed, setRenamed] = useState<RenamedEntry[]>([]);

  const addGhostSession = useCallback((name: string) => {
    const optimisticId = `ghost-${++ghostIdCounter}`;
    setGhosts((prev) => [...prev, { optimisticId, type: "session", name }]);
    return optimisticId;
  }, []);

  const addGhostServer = useCallback((name: string) => {
    const optimisticId = `ghost-${++ghostIdCounter}`;
    setGhosts((prev) => [...prev, { optimisticId, type: "server", name }]);
    return optimisticId;
  }, []);

  const removeGhost = useCallback((id: string) => {
    setGhosts((prev) => prev.filter((g) => g.optimisticId !== id));
  }, []);

  const markKilled = useCallback((type: "session" | "server", identifier: string) => {
    setKilled((prev) => [...prev, { type, identifier }]);
  }, []);

  const unmarkKilled = useCallback((identifier: string) => {
    setKilled((prev) => prev.filter((k) => k.identifier !== identifier));
  }, []);

  const markRenamed = useCallback((type: "session", identifier: string, newName: string) => {
    setRenamed((prev) => [...prev, { type, identifier, newName }]);
  }, []);

  const unmarkRenamed = useCallback((identifier: string) => {
    setRenamed((prev) => prev.filter((r) => r.identifier !== identifier));
  }, []);

  const value = useMemo(
    () => ({
      addGhostSession,
      addGhostServer,
      removeGhost,
      markKilled,
      unmarkKilled,
      markRenamed,
      unmarkRenamed,
      ghosts,
      killed,
      renamed,
    }),
    [addGhostSession, addGhostServer, removeGhost, markKilled, unmarkKilled, markRenamed, unmarkRenamed, ghosts, killed, renamed],
  );

  return (
    <OptimisticContext.Provider value={value}>
      {children}
    </OptimisticContext.Provider>
  );
}

export function useOptimisticContext(): OptimisticContextType {
  const ctx = useContext(OptimisticContext);
  if (!ctx) throw new Error("useOptimisticContext must be used within OptimisticProvider");
  return ctx;
}

/** Merged session type that includes optimistic flag. */
export type MergedSession = ProjectSession & {
  optimistic?: boolean;
  optimisticId?: string;
};

export type { MergedWindow } from "@/store/window-store";

/** Type guard for ghost windows. */
export function isGhostWindow(win: WindowInfo | MergedWindow): win is MergedWindow & { optimistic: true } {
  return "optimistic" in win && win.optimistic === true;
}

/**
 * Merge real SSE sessions with ghost entries and apply killed/renamed overlays.
 * Ghost sessions matching a real session by name are auto-cleared (SSE reconciliation).
 * Window state (kill, rename, ghosts) is managed by the Zustand window store.
 * Returns merged sessions with ghost entries appended and killed entries filtered out.
 */
export function useMergedSessions(realSessions: ProjectSession[]): MergedSession[] {
  const ctx = useContext(OptimisticContext);
  const windowEntries = useWindowStore((s) => s.entries);
  const windowGhosts = useWindowStore((s) => s.ghosts);

  if (!ctx) return realSessions;

  const { ghosts, killed, renamed, removeGhost } = ctx;

  return useMemo(() => {
    const realSessionNames = new Set(realSessions.map((s) => s.name));

    // SSE reconciliation: clear ghost sessions that now exist in real data
    const reconciledSessionGhosts: GhostEntry[] = [];
    for (const ghost of ghosts) {
      if (ghost.type === "session" && realSessionNames.has(ghost.name)) {
        // Schedule removal — real data arrived, ghost is no longer needed
        // Use queueMicrotask to avoid setState-during-render
        queueMicrotask(() => removeGhost(ghost.optimisticId));
      } else if (ghost.type === "session") {
        reconciledSessionGhosts.push(ghost);
      }
    }

    // Build killed set for fast lookup (sessions only)
    const killedSessions = new Set(killed.filter((k) => k.type === "session").map((k) => k.identifier));

    // Build rename map (sessions only)
    const renamedSessions = new Map(renamed.filter((r) => r.type === "session").map((r) => [r.identifier, r.newName]));

    // Process real sessions: filter killed, apply renames, merge window state from store
    const mergedSessions: MergedSession[] = realSessions
      .filter((s) => !killedSessions.has(s.name))
      .map((s) => {
        const sessionNewName = renamedSessions.get(s.name);
        const displayName = sessionNewName ?? s.name;

        // Build merged windows from window store entries for this session
        const sessionEntries: MergedWindow[] = [];
        for (const [, entry] of windowEntries) {
          if (entry.session !== s.name || entry.killed) continue;
          // Find the matching real window to get full WindowInfo fields
          const realWin = s.windows.find((w) => w.windowId === entry.windowId);
          if (!realWin) continue;
          const name = entry.pendingName ?? entry.name;
          sessionEntries.push({ ...realWin, name });
        }
        // Sort by index ascending
        sessionEntries.sort((a, b) => a.index - b.index);

        // Append ghost windows for this session
        const sessionWindowGhosts = windowGhosts
          .filter((g) => g.session === s.name)
          .sort((a, b) => a.createdAt - b.createdAt);

        for (const ghost of sessionWindowGhosts) {
          const ghostWindow: MergedWindow = {
            index: -1,
            windowId: "",
            name: ghost.name,
            worktreePath: "",
            activity: "idle",
            isActiveWindow: false,
            activityTimestamp: 0,
            optimistic: true,
            optimisticId: ghost.optimisticId,
          };
          sessionEntries.push(ghostWindow);
        }

        return {
          ...s,
          name: displayName,
          windows: sessionEntries,
        };
      });

    // Append ghost sessions
    for (const ghost of reconciledSessionGhosts) {
      const ghostSession: MergedSession = {
        name: ghost.name,
        windows: [],
        optimistic: true,
        optimisticId: ghost.optimisticId,
      };
      mergedSessions.push(ghostSession);
    }

    return mergedSessions;
  }, [realSessions, ghosts, killed, renamed, removeGhost, windowEntries, windowGhosts]);
}
