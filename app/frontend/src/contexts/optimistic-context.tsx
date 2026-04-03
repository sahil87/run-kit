import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ProjectSession, WindowInfo } from "@/types";

type GhostType = "session" | "window" | "server";

type GhostEntry = {
  optimisticId: string;
  type: GhostType;
  name: string;
  /** For window ghosts, the session they belong to. */
  parentSession?: string;
};

type KilledEntry = {
  type: "session" | "window" | "server";
  identifier: string;
};

type RenamedEntry = {
  type: "session" | "window";
  identifier: string;
  newName: string;
};

type OptimisticContextType = {
  addGhostSession: (name: string) => string;
  addGhostWindow: (session: string, name: string) => string;
  addGhostServer: (name: string) => string;
  removeGhost: (id: string) => void;
  markKilled: (type: "session" | "window" | "server", identifier: string) => void;
  unmarkKilled: (identifier: string) => void;
  markRenamed: (type: "session" | "window", identifier: string, newName: string) => void;
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

  const addGhostWindow = useCallback((session: string, name: string) => {
    const optimisticId = `ghost-${++ghostIdCounter}`;
    setGhosts((prev) => [...prev, { optimisticId, type: "window", name, parentSession: session }]);
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

  const markKilled = useCallback((type: "session" | "window" | "server", identifier: string) => {
    setKilled((prev) => [...prev, { type, identifier }]);
  }, []);

  const unmarkKilled = useCallback((identifier: string) => {
    setKilled((prev) => prev.filter((k) => k.identifier !== identifier));
  }, []);

  const markRenamed = useCallback((type: "session" | "window", identifier: string, newName: string) => {
    setRenamed((prev) => [...prev, { type, identifier, newName }]);
  }, []);

  const unmarkRenamed = useCallback((identifier: string) => {
    setRenamed((prev) => prev.filter((r) => r.identifier !== identifier));
  }, []);

  const value = useMemo(
    () => ({
      addGhostSession,
      addGhostWindow,
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
    [addGhostSession, addGhostWindow, addGhostServer, removeGhost, markKilled, unmarkKilled, markRenamed, unmarkRenamed, ghosts, killed, renamed],
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

/** Merged window type that includes optimistic flag. */
export type MergedWindow = WindowInfo & {
  optimistic?: boolean;
  optimisticId?: string;
};

/** Type guard for ghost windows. */
export function isGhostWindow(win: WindowInfo | MergedWindow): win is MergedWindow & { optimistic: true } {
  return "optimistic" in win && win.optimistic === true;
}

/**
 * Merge real SSE sessions with ghost entries and apply killed/renamed overlays.
 * Ghost sessions matching a real session by name are auto-cleared (SSE reconciliation).
 * Returns merged sessions with ghost entries appended and killed entries filtered out.
 */
export function useMergedSessions(realSessions: ProjectSession[]): MergedSession[] {
  const ctx = useContext(OptimisticContext);
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

    // SSE reconciliation for window ghosts
    const reconciledWindowGhosts: GhostEntry[] = [];
    for (const ghost of ghosts) {
      if (ghost.type !== "window") continue;
      const parentReal = realSessions.find((s) => s.name === ghost.parentSession);
      if (parentReal && parentReal.windows.some((w) => w.name === ghost.name)) {
        queueMicrotask(() => removeGhost(ghost.optimisticId));
      } else {
        reconciledWindowGhosts.push(ghost);
      }
    }

    // Build killed set for fast lookup
    const killedSessions = new Set(killed.filter((k) => k.type === "session").map((k) => k.identifier));
    const killedWindows = new Set(killed.filter((k) => k.type === "window").map((k) => k.identifier));

    // Build rename map
    const renamedSessions = new Map(renamed.filter((r) => r.type === "session").map((r) => [r.identifier, r.newName]));
    const renamedWindows = new Map(renamed.filter((r) => r.type === "window").map((r) => [r.identifier, r.newName]));

    // Process real sessions: filter killed, apply renames, merge window ghosts
    const mergedSessions: MergedSession[] = realSessions
      .filter((s) => !killedSessions.has(s.name))
      .map((s) => {
        const sessionNewName = renamedSessions.get(s.name);
        const displayName = sessionNewName ?? s.name;

        // Filter killed windows and apply window renames
        const mergedWindows: MergedWindow[] = s.windows
          .filter((w) => !killedWindows.has(`${s.name}:${w.index}`))
          .map((w) => {
            const windowNewName = renamedWindows.get(`${s.name}:${w.index}`);
            return windowNewName ? { ...w, name: windowNewName } : w;
          });

        // Add ghost windows for this session
        const sessionWindowGhosts = reconciledWindowGhosts.filter(
          (g) => g.parentSession === s.name,
        );
        for (const ghost of sessionWindowGhosts) {
          const ghostWindow: MergedWindow = {
            index: -1,
            name: ghost.name,
            worktreePath: "",
            activity: "idle",
            isActiveWindow: false,
            activityTimestamp: 0,
            optimistic: true,
            optimisticId: ghost.optimisticId,
          };
          mergedWindows.push(ghostWindow);
        }

        return {
          ...s,
          name: displayName,
          windows: mergedWindows,
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
  }, [realSessions, ghosts, killed, renamed, removeGhost]);
}
