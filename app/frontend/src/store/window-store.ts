import { create } from "zustand";
import type { PaneInfo, WindowInfo } from "@/types";

/** A single window entry in the store. */
export type WindowEntry = {
  server: string;
  session: string;
  windowId: string;
  index: number;
  name: string;
  pendingName?: string;
  killed: boolean;
  createdAt: number;
  panes: PaneInfo[];
};

/** Merged window type that includes optimistic flag. */
export type MergedWindow = WindowInfo & {
  optimistic?: boolean;
  optimisticId?: string;
};

/** Ghost window state for tracking optimistic adds. */
type GhostWindow = {
  optimisticId: string;
  server: string;
  session: string;
  name: string;
  /** Snapshot of known windowIds at the time the ghost was created. */
  snapshotWindowIds: Set<string>;
  createdAt: number;
};

type WindowStoreState = {
  /** Read-only view of `${server}:${windowId}` -> WindowEntry for all known
   *  windows. tmux windowIds are unique only per server, so the composite
   *  key is required to keep entries from different servers from clobbering
   *  each other. */
  entries: ReadonlyMap<string, WindowEntry>;
  /** List of ghost (optimistic) windows. */
  ghosts: GhostWindow[];
};

type WindowStoreActions = {
  /**
   * Sync real windows for a (server, session) from SSE data.
   * Reconciles ghosts: if any ghost's snapshotWindowIds doesn't intersect
   * with the newly arrived windowIds, that ghost is "claimed" (removed).
   */
  setWindowsForSession: (server: string, session: string, windows: WindowInfo[]) => void;

  /**
   * Add a ghost (optimistic) window for a (server, session).
   * If currentWindowIds is provided, uses that as the snapshot (authoritative, from caller).
   * Otherwise captures current windowIds from the store (fallback).
   * Returns the optimisticId.
   */
  addGhostWindow: (
    server: string,
    session: string,
    name: string,
    currentWindowIds?: Iterable<string>,
  ) => string;

  /** Optimistically mark a window as killed. */
  killWindow: (server: string, session: string, windowId: string) => void;

  /** Restore a window (undo kill). */
  restoreWindow: (server: string, session: string, windowId: string) => void;

  /** Apply a pending rename to a window. */
  renameWindow: (server: string, session: string, windowId: string, pendingName: string) => void;

  /** Clear a pending rename from a window. */
  clearRename: (server: string, session: string, windowId: string) => void;

  /** Remove a specific ghost window by its optimisticId. */
  removeGhost: (optimisticId: string) => void;

  /**
   * Move a window within the same (server, session) by taking the window at
   * srcIndex and inserting it before dstIndex. If dstIndex is past the last
   * window, the window is moved to the end. No-op if the source entry is
   * missing.
   */
  moveWindowOrder: (server: string, session: string, srcIndex: number, dstIndex: number) => void;

  /** Clear all window entries and ghosts for a (server, session). */
  clearSession: (server: string, session: string) => void;
};

/** Compose the entries-map key. tmux windowIds are unique per server only. */
export function entryKey(server: string, windowId: string): string {
  return `${server}:${windowId}`;
}

/**
 * How long an unclaimed ghost window survives before being dropped.
 *
 * A ghost is claimed only when a NEW windowId arrives for its (server,
 * session) via SSE (setWindowsForSession). If the create request fails, the
 * caller's rollback removes the ghost — but if the create *succeeds somewhere
 * else* (e.g. a tmux target ambiguity routes the window into a different
 * session, the 2026-07-17 "ext" misroute), no rollback fires and no claim ever
 * arrives, and the row would pulse grey forever. The TTL bounds that failure
 * mode: an ordinary create confirms within one SSE tick (~1-2s), so 15s is
 * comfortably past any legitimate claim while still self-healing a stranded
 * row. Removing an already-claimed/rolled-back ghost is a no-op.
 */
export const GHOST_WINDOW_TTL_MS = 15_000;

let ghostIdCounter = 0;

export const useWindowStore = create<WindowStoreState & WindowStoreActions>((set, get) => ({
  entries: new Map(),
  ghosts: [],

  setWindowsForSession: (server, session, windows) => {
    set((state) => {
      const newEntries = new Map(state.entries);

      // Identify keys already in store for this (server, session)
      const priorKnownKeys = new Set<string>();
      const priorKnownWindowIds = new Set<string>();
      for (const [key, entry] of newEntries) {
        if (entry.server === server && entry.session === session) {
          priorKnownKeys.add(key);
          priorKnownWindowIds.add(entry.windowId);
        }
      }

      // Build incoming windowId set (server-scoped — windowIds are unique per
      // server only, so no need to compose with server here).
      const incomingWindowIds = new Set(windows.map((w) => w.windowId));

      // New windowIds = arrived but not previously known for this (server, session)
      const newWindowIds = new Set<string>();
      for (const id of incomingWindowIds) {
        if (!priorKnownWindowIds.has(id)) {
          newWindowIds.add(id);
        }
      }

      // Remove old entries for this (server, session)
      for (const key of priorKnownKeys) {
        newEntries.delete(key);
      }

      // Add/update entries for incoming windows (preserve killed/pendingName
      // if a prior entry existed under the same composite key).
      for (const w of windows) {
        const key = entryKey(server, w.windowId);
        const existing = state.entries.get(key);
        const existingMatches =
          existing?.server === server && existing?.session === session;
        newEntries.set(key, {
          server,
          session,
          windowId: w.windowId,
          index: w.index,
          name: w.name,
          pendingName: existingMatches ? existing.pendingName : undefined,
          killed: existingMatches ? (existing.killed ?? false) : false,
          createdAt: existingMatches ? existing.createdAt : Date.now(),
          panes: w.panes ?? [],
        });
      }

      // Reconcile ghosts for this (server, session): for each ghost (oldest
      // first), if none of its snapshotWindowIds intersect with newWindowIds,
      // remove the ghost (claim one newWindowId).
      const sessionGhosts = state.ghosts
        .filter((g) => g.server === server && g.session === session)
        .sort((a, b) => a.createdAt - b.createdAt);

      const claimedNewWindowIds = new Set<string>();
      const ghostsToRemove = new Set<string>();

      for (const ghost of sessionGhosts) {
        const snapshotIntersectsNew = [...ghost.snapshotWindowIds].some(
          (id) => newWindowIds.has(id) && !claimedNewWindowIds.has(id),
        );
        if (!snapshotIntersectsNew && newWindowIds.size > claimedNewWindowIds.size) {
          for (const id of newWindowIds) {
            if (!claimedNewWindowIds.has(id)) {
              claimedNewWindowIds.add(id);
              break;
            }
          }
          ghostsToRemove.add(ghost.optimisticId);
        }
      }

      const newGhosts = state.ghosts.filter(
        (g) =>
          !(g.server === server && g.session === session) ||
          !ghostsToRemove.has(g.optimisticId),
      );

      return { entries: newEntries, ghosts: newGhosts };
    });
  },

  addGhostWindow: (server, session, name, currentWindowIds?) => {
    const optimisticId = `ghost-win-${++ghostIdCounter}`;
    const now = Date.now();

    set((state) => {
      // Prefer the authoritative current windowIds passed by the caller.
      // Fall back to the store snapshot, scoped to (server, session).
      const snapshotWindowIds =
        currentWindowIds != null
          ? new Set<string>(currentWindowIds)
          : (() => {
              const ids = new Set<string>();
              for (const [, entry] of state.entries) {
                if (entry.server === server && entry.session === session) {
                  ids.add(entry.windowId);
                }
              }
              return ids;
            })();

      const ghost: GhostWindow = {
        optimisticId,
        server,
        session,
        name,
        snapshotWindowIds,
        createdAt: now,
      };

      return { ghosts: [...state.ghosts, ghost] };
    });

    // TTL backstop — see GHOST_WINDOW_TTL_MS. removeGhost is idempotent, so a
    // timer firing after the ghost was claimed or rolled back is a no-op.
    setTimeout(() => {
      get().removeGhost(optimisticId);
    }, GHOST_WINDOW_TTL_MS);

    return optimisticId;
  },

  killWindow: (server, session, windowId) => {
    set((state) => {
      const key = entryKey(server, windowId);
      const entry = state.entries.get(key);
      if (!entry || entry.server !== server || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(key, { ...entry, killed: true });
      return { entries: newEntries };
    });
  },

  restoreWindow: (server, session, windowId) => {
    set((state) => {
      const key = entryKey(server, windowId);
      const entry = state.entries.get(key);
      if (!entry || entry.server !== server || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(key, { ...entry, killed: false });
      return { entries: newEntries };
    });
  },

  renameWindow: (server, session, windowId, pendingName) => {
    set((state) => {
      const key = entryKey(server, windowId);
      const entry = state.entries.get(key);
      if (!entry || entry.server !== server || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(key, { ...entry, pendingName });
      return { entries: newEntries };
    });
  },

  clearRename: (server, session, windowId) => {
    set((state) => {
      const key = entryKey(server, windowId);
      const entry = state.entries.get(key);
      if (!entry || entry.server !== server || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(key, { ...entry, pendingName: undefined });
      return { entries: newEntries };
    });
  },

  removeGhost: (optimisticId) => {
    set((state) => ({
      ghosts: state.ghosts.filter((g) => g.optimisticId !== optimisticId),
    }));
  },

  moveWindowOrder: (server, session, srcIndex, dstIndex) => {
    set((state) => {
      // Collect (server, session) windows sorted by index
      const sorted: Array<[string, WindowEntry]> = [];
      for (const [key, entry] of state.entries) {
        if (entry.server === server && entry.session === session) sorted.push([key, entry]);
      }
      sorted.sort((a, b) => a[1].index - b[1].index);

      const srcPos = sorted.findIndex(([, e]) => e.index === srcIndex);
      if (srcPos < 0) return state;
      let dstPos = sorted.findIndex(([, e]) => e.index === dstIndex);
      const sentinel = dstPos < 0;
      if (sentinel) dstPos = sorted.length - 1;

      const indices = sorted.map(([, e]) => e.index);

      const [removed] = sorted.splice(srcPos, 1);
      const insertPos = srcPos < dstPos && !sentinel ? dstPos - 1 : dstPos;
      sorted.splice(insertPos, 0, removed);

      const newEntries = new Map(state.entries);
      for (let i = 0; i < sorted.length; i++) {
        const [key] = sorted[i];
        newEntries.set(key, { ...newEntries.get(key)!, index: indices[i] });
      }
      return { entries: newEntries };
    });
  },

  clearSession: (server, session) => {
    set((state) => {
      const newEntries = new Map(state.entries);
      for (const [key, entry] of newEntries) {
        if (entry.server === server && entry.session === session) {
          newEntries.delete(key);
        }
      }
      const newGhosts = state.ghosts.filter(
        (g) => !(g.server === server && g.session === session),
      );
      return { entries: newEntries, ghosts: newGhosts };
    });
  },
}));
