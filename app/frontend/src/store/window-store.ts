import { create } from "zustand";
import type { PaneInfo, WindowInfo } from "@/types";

/** A single window entry in the store. */
export type WindowEntry = {
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
  session: string;
  name: string;
  /** Snapshot of known windowIds at the time the ghost was created. */
  snapshotWindowIds: Set<string>;
  createdAt: number;
};

type WindowStoreState = {
  /** Read-only view of windowId -> WindowEntry for all known windows. */
  entries: ReadonlyMap<string, WindowEntry>;
  /** List of ghost (optimistic) windows. */
  ghosts: GhostWindow[];
};

type WindowStoreActions = {
  /**
   * Sync real windows for a session from SSE data.
   * Reconciles ghosts: if any ghost's snapshotWindowIds doesn't intersect
   * with the newly arrived windowIds, that ghost is "claimed" (removed).
   */
  setWindowsForSession: (session: string, windows: WindowInfo[]) => void;

  /**
   * Add a ghost (optimistic) window for a session.
   * If currentWindowIds is provided, uses that as the snapshot (authoritative, from caller).
   * Otherwise captures current windowIds from the store (fallback).
   * Returns the optimisticId.
   */
  addGhostWindow: (session: string, name: string, currentWindowIds?: Iterable<string>) => string;

  /**
   * Optimistically mark a window as killed by windowId.
   */
  killWindow: (session: string, windowId: string) => void;

  /**
   * Restore a window (undo kill) by windowId.
   */
  restoreWindow: (session: string, windowId: string) => void;

  /**
   * Apply a pending rename to a window by windowId.
   */
  renameWindow: (session: string, windowId: string, pendingName: string) => void;

  /**
   * Clear a pending rename from a window by windowId.
   */
  clearRename: (session: string, windowId: string) => void;

  /**
   * Remove a specific ghost window by its optimisticId.
   */
  removeGhost: (optimisticId: string) => void;

  /**
   * Swap the index values of two windows within the same session.
   * No-op if either entry is missing.
   */
  swapWindowOrder: (session: string, srcIndex: number, dstIndex: number) => void;

  /**
   * Clear all window entries and ghosts for a session (called after session kill).
   */
  clearSession: (session: string) => void;
};

let ghostIdCounter = 0;

export const useWindowStore = create<WindowStoreState & WindowStoreActions>((set, get) => ({
  entries: new Map(),
  ghosts: [],

  setWindowsForSession: (session, windows) => {
    set((state) => {
      const newEntries = new Map(state.entries);

      // Identify windowIds already in store for this session (prior known IDs)
      const priorKnownIds = new Set<string>();
      for (const [id, entry] of newEntries) {
        if (entry.session === session) {
          priorKnownIds.add(id);
        }
      }

      // Build incoming set
      const incomingIds = new Set(windows.map((w) => w.windowId));

      // New IDs = arrived but not previously known
      const newIds = new Set<string>();
      for (const id of incomingIds) {
        if (!priorKnownIds.has(id)) {
          newIds.add(id);
        }
      }

      // Remove old entries for this session
      for (const id of priorKnownIds) {
        newEntries.delete(id);
      }

      // Add/update entries for incoming windows (preserve killed/pendingName if entry exists)
      for (const w of windows) {
        const existing = state.entries.get(w.windowId);
        newEntries.set(w.windowId, {
          session,
          windowId: w.windowId,
          index: w.index,
          name: w.name,
          pendingName: existing?.pendingName,
          killed: existing?.killed ?? false,
          createdAt: existing?.createdAt ?? Date.now(),
          panes: w.panes ?? [],
        });
      }

      // Reconcile ghosts for this session:
      // For each ghost (oldest first), if none of its snapshotWindowIds intersect with newIds,
      // remove the ghost (claim one newId)
      const sessionGhosts = state.ghosts
        .filter((g) => g.session === session)
        .sort((a, b) => a.createdAt - b.createdAt);

      const claimedNewIds = new Set<string>();
      const ghostsToRemove = new Set<string>();

      for (const ghost of sessionGhosts) {
        // Check if any of snapshot IDs are in newIds (already unclaimed)
        const snapshotIntersectsNew = [...ghost.snapshotWindowIds].some(
          (id) => newIds.has(id) && !claimedNewIds.has(id),
        );
        if (!snapshotIntersectsNew && newIds.size > claimedNewIds.size) {
          // Claim one new ID
          for (const id of newIds) {
            if (!claimedNewIds.has(id)) {
              claimedNewIds.add(id);
              break;
            }
          }
          ghostsToRemove.add(ghost.optimisticId);
        }
      }

      const newGhosts = state.ghosts.filter(
        (g) => g.session !== session || !ghostsToRemove.has(g.optimisticId),
      );

      return { entries: newEntries, ghosts: newGhosts };
    });
  },

  addGhostWindow: (session, name, currentWindowIds?) => {
    const optimisticId = `ghost-win-${++ghostIdCounter}`;
    const now = Date.now();

    set((state) => {
      // Prefer the authoritative current windowIds passed by the caller.
      // Fall back to the store snapshot for backward compatibility.
      const snapshotWindowIds =
        currentWindowIds != null
          ? new Set<string>(currentWindowIds)
          : (() => {
              const ids = new Set<string>();
              for (const [id, entry] of state.entries) {
                if (entry.session === session) {
                  ids.add(id);
                }
              }
              return ids;
            })();

      const ghost: GhostWindow = {
        optimisticId,
        session,
        name,
        snapshotWindowIds,
        createdAt: now,
      };

      return { ghosts: [...state.ghosts, ghost] };
    });

    return optimisticId;
  },

  killWindow: (session, windowId) => {
    set((state) => {
      const entry = state.entries.get(windowId);
      if (!entry || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(windowId, { ...entry, killed: true });
      return { entries: newEntries };
    });
  },

  restoreWindow: (session, windowId) => {
    set((state) => {
      const entry = state.entries.get(windowId);
      if (!entry || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(windowId, { ...entry, killed: false });
      return { entries: newEntries };
    });
  },

  renameWindow: (session, windowId, pendingName) => {
    set((state) => {
      const entry = state.entries.get(windowId);
      if (!entry || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(windowId, { ...entry, pendingName });
      return { entries: newEntries };
    });
  },

  clearRename: (session, windowId) => {
    set((state) => {
      const entry = state.entries.get(windowId);
      if (!entry || entry.session !== session) return state;
      const newEntries = new Map(state.entries);
      newEntries.set(windowId, { ...entry, pendingName: undefined });
      return { entries: newEntries };
    });
  },

  removeGhost: (optimisticId) => {
    set((state) => ({
      ghosts: state.ghosts.filter((g) => g.optimisticId !== optimisticId),
    }));
  },

  swapWindowOrder: (session, srcIndex, dstIndex) => {
    set((state) => {
      let srcId: string | undefined;
      let dstId: string | undefined;
      for (const [id, entry] of state.entries) {
        if (entry.session !== session) continue;
        if (entry.index === srcIndex) srcId = id;
        if (entry.index === dstIndex) dstId = id;
        if (srcId && dstId) break;
      }
      if (!srcId || !dstId) return state;
      const srcEntry = state.entries.get(srcId)!;
      const dstEntry = state.entries.get(dstId)!;
      const newEntries = new Map(state.entries);
      newEntries.set(srcId, { ...srcEntry, index: dstIndex });
      newEntries.set(dstId, { ...dstEntry, index: srcIndex });
      return { entries: newEntries };
    });
  },

  clearSession: (session) => {
    set((state) => {
      const newEntries = new Map(state.entries);
      for (const [id, entry] of newEntries) {
        if (entry.session === session) {
          newEntries.delete(id);
        }
      }
      const newGhosts = state.ghosts.filter((g) => g.session !== session);
      return { entries: newEntries, ghosts: newGhosts };
    });
  },
}));
