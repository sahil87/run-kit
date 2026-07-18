/**
 * Pure builder for the command-palette pin actions (`Pin: Current Window to
 * <board>` per existing board + `Pin: Current Window to new board…`). Follows
 * the lib/palette-move.ts / lib/palette-version.ts pattern (pure,
 * dependency-free, unit-testable) so the label composition, already-pinned
 * exclusion, and last-used-first ordering are verifiable without mounting the
 * shell. The action bodies are thin `onPin(board)` / `onOpenNewBoardPopover()`
 * callbacks passed in by the caller (app.tsx wires them to the pin mutation and
 * the `pin-popover:open` CustomEvent respectively).
 *
 * This supersedes the inline ad-hoc `board-pin-current` action: the new-board
 * variant absorbs its popover-opening role, and the per-board entries add the
 * direct keyboard pin path that closes the Constitution V gap.
 */
import type { PaletteAction } from "@/components/command-palette";
import type { BoardSummary } from "@/api/boards";
import { orderBoardsLastUsedFirst } from "@/lib/last-pinned-board";

/** New-board variant id — stable so callers/tests can reference it. */
export const PIN_NEW_BOARD_ACTION_ID = "pin-current-new-board";

/**
 * Build the pin palette actions for the current window.
 *
 * @param boards        all known boards
 * @param alreadyPinned board names the current window is already pinned to
 *                      (excluded from the direct-pin entries)
 * @param lastUsed      last board pinned to (orders the direct-pin entries
 *                      last-used-first; a stale/absent value is ignored)
 * @param onPin         invoked with a board name for a direct pin
 * @param onOpenNewBoardPopover invoked to open the free-text new-board popover
 */
export function buildPinActions(
  boards: BoardSummary[],
  alreadyPinned: string[],
  lastUsed: string | null,
  onPin: (board: string) => void,
  onOpenNewBoardPopover: () => void,
): PaletteAction[] {
  const pinnedSet = new Set(alreadyPinned);
  const candidates = orderBoardsLastUsedFirst(
    boards.filter((b) => !pinnedSet.has(b.name)),
    lastUsed,
  );

  const directPins: PaletteAction[] = candidates.map((b) => ({
    id: `pin-current-${b.name}`,
    label: `Pin: Current Window to ${b.name}`,
    onSelect: () => onPin(b.name),
  }));

  const newBoard: PaletteAction = {
    id: PIN_NEW_BOARD_ACTION_ID,
    label: "Pin: Current Window to new board…",
    onSelect: onOpenNewBoardPopover,
  };

  return [...directPins, newBoard];
}
