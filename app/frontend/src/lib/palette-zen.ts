/**
 * Pure builder for the command-palette zen-mode entries (`View: Enter Zen
 * Mode` / `View: Exit Zen Mode` — 260820-o8cr R7). Extracted from app.tsx so
 * the one-form gating is unit-testable without mounting the shell — mirroring
 * `lib/palette-view.ts` (`buildViewActions`) and `lib/palette-layout.ts`
 * (`buildLayoutActions`).
 *
 * Exactly one form renders, keyed on the live zen state (the `Layout:
 * Expand`/`Restore` one-form precedent): the palette shows the destination,
 * never the current state. The entry is offered at ANY arity on the desktop
 * terminal route (the caller gates on `windowParam && !isMobile`) — unlike
 * `Layout: Expand`, which stays an arity>1 arrangement verb.
 *
 * The entry ids are NOT the `zen-toggle` actionId, so the ⇧⌘⏎ hint attaches
 * EXPLICITLY through the `shortcut` option (the `toggleShortcut` precedent —
 * no new hint mechanism); the parity invariant's equivalence map documents
 * `zen-toggle` ⇄ `view-zen-enter`/`view-zen-exit`.
 */

export type ZenPaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

export type ZenPaletteOptions = {
  /** Toggle body — the same seam the `zen-toggle` chord and the status-bar
   *  exit button resolve (enter when inactive, exit when active). */
  onToggle: () => void;
  /** The effective ⇧⌘⏎/⇧Ctrl+⏎ combo for the hint (enabled binding), else
   *  undefined — rendered as no hint. */
  shortcut?: string;
};

/** Build the one zen entry for the current state (`active` = zen is on). */
export function buildZenActions(
  active: boolean,
  opts: ZenPaletteOptions,
): ZenPaletteAction[] {
  return [
    active
      ? { id: "view-zen-exit", label: "View: Exit Zen Mode", shortcut: opts.shortcut, onSelect: opts.onToggle }
      : { id: "view-zen-enter", label: "View: Enter Zen Mode", shortcut: opts.shortcut, onSelect: opts.onToggle },
  ];
}
