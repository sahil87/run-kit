/**
 * Pure builder for the command-palette session sort actions
 * (`Session: Sort windows by status` / `Session: Sort windows by created`) —
 * the keyboard entry points for the sort-windows verb (Constitution V).
 * Follows the lib/palette-shell.ts / lib/palette-zen.ts pure-builder
 * convention so gating is unit-testable without mounting the shell.
 *
 * The entries exist only with a current session (the terminal route's
 * sessionName gate — the same gate the other `Session:` verbs use). No
 * success toast on select: the reorder is immediately visible via SSE.
 */
import type { PaletteAction } from "@/components/command-palette";

export type SessionSortBy = "status" | "created";

/** The two sort entries for `sessionName`; `[]` without a current session. */
export function buildSessionSortActions(
  sessionName: string | null,
  onSort: (by: SessionSortBy) => void,
): PaletteAction[] {
  if (!sessionName) return [];
  return [
    {
      id: "session-sort-windows-status",
      label: "Session: Sort windows by status",
      onSelect: () => onSort("status"),
    },
    {
      id: "session-sort-windows-created",
      label: "Session: Sort windows by created",
      onSelect: () => onSort("created"),
    },
  ];
}
