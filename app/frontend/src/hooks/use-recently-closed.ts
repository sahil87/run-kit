import { useCallback, useEffect, useSyncExternalStore } from "react";
import { listClosedWindows, type ClosedWindow } from "@/api/client";
import type { PaletteAction } from "@/components/command-palette";

// The per-server mirror of the backend's recently-closed ring. The SERVER
// record is authoritative — the mirror exists only to gate the
// `Tab: Reopen closed` palette entry and render its description — so it is a
// plain module-level map (shared across the palette and the kill-dialog call
// sites), seeded from the API on server mount and reconciled by pushes from
// the kill responses.
const stacks = new Map<string, ClosedWindow[]>();
const listeners = new Set<() => void>();
const EMPTY_STACK: readonly ClosedWindow[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Push a kill-seam record onto the server's mirror (newest first), deduped
 *  by record id. Exported standalone so kill flows can push with the exact
 *  server the response came from, outside any hook's server binding. */
export function pushRecentlyClosed(server: string, rec: ClosedWindow): void {
  const current = stacks.get(server) ?? [];
  stacks.set(server, [rec, ...current.filter((r) => r.id !== rec.id)]);
  emit();
}

/** Drop a record from the server's mirror (reopen consumed it, or a 409 told
 *  us the backend already dropped it). */
export function popRecentlyClosed(server: string, id: string): void {
  const current = stacks.get(server);
  if (!current) return;
  const next = current.filter((r) => r.id !== id);
  if (next.length === current.length) return;
  if (next.length === 0) stacks.delete(server);
  else stacks.set(server, next);
  emit();
}

/** Replace the server's mirror with the authoritative ring listing. */
function seedRecentlyClosed(server: string, records: ClosedWindow[]): void {
  if (records.length === 0) stacks.delete(server);
  else stacks.set(server, records);
  emit();
}

export type RecentlyClosedMirror = {
  /** The server's mirror stack, newest-first. */
  stack: readonly ClosedWindow[];
  push: (rec: ClosedWindow) => void;
  pop: (id: string) => void;
};

export function useRecentlyClosed(server: string): RecentlyClosedMirror {
  const stack = useSyncExternalStore(
    subscribe,
    () => stacks.get(server) ?? EMPTY_STACK,
  );

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    listClosedWindows(server)
      .then((records) => {
        if (!cancelled) seedRecentlyClosed(server, records);
      })
      // Fail-silent: an unreachable ring only means the palette entry stays
      // hidden until the next mount — the entry is a convenience gate, never
      // the record itself.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [server]);

  const push = useCallback((rec: ClosedWindow) => pushRecentlyClosed(server, rec), [server]);
  const pop = useCallback((id: string) => popRecentlyClosed(server, id), [server]);
  return { stack, push, pop };
}

/** The stack-gated `Tab: Reopen closed` palette entry. Absent on an empty
 *  stack so the dispatcher's fromPalette lookup yields no handler and the
 *  reopen chord falls through untouched (no toast, no preventDefault). The id
 *  doubles as the keybinding actionId, so withShortcutHints renders the
 *  effective combo on the row. */
export function buildReopenWindowAction(
  stack: readonly ClosedWindow[],
  onReopen: () => void,
): PaletteAction[] {
  const top = stack[0];
  if (!top) return [];
  return [
    {
      id: "reopen-window",
      label: "Tab: Reopen closed",
      description: `${top.window.name} — fresh shell in ${top.session}`,
      onSelect: onReopen,
    },
  ];
}
