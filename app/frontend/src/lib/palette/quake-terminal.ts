import {
  QUAKE_GEOMETRY_DEFAULT,
  requestQuakeTerminal,
  setQuakeMachineState,
  setQuakePinned,
  writeQuakeGeometry,
} from "@/lib/quake-terminal";

/**
 * Pure builder for the palette's `Operator: Open quake terminal` entry —
 * extracted so the shape is unit-testable without mounting the shell,
 * mirroring `lib/palette/zen.ts`. The entry id IS the `quake-terminal`
 * registry actionId, so `withShortcutHints` attaches the effective chord. The
 * action lands on open+focused on the desktop machine (an explicit "Open quake
 * terminal" pick always opens, where the chord toggles); on mobile it
 * navigates to the operator window's terminal route.
 */
export type QuakeTerminalPaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

export function buildQuakeTerminalAction(): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal",
    label: "Operator: Open quake terminal",
    onSelect: () => requestQuakeTerminal({ action: "open" }),
  };
}

/**
 * The cron-segment twins — the quake terminal opened straight onto its Cron
 * List / Cron Log segment. No registry chord: the segment is a view inside the
 * quake terminal, one Tab-reachable click past ⌘J; the palette entries are its
 * keyboard-parity path (Constitution V). On mobile the seam maps them to the
 * operator route's `?tab=` param. List registers before log everywhere.
 */
export function buildQuakeTerminalListAction(): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal-list",
    label: "Operator: Show cron list",
    onSelect: () => requestQuakeTerminal({ action: "open", segment: "list" }),
  };
}

export function buildQuakeTerminalLogAction(): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal-log",
    label: "Operator: Show cron log",
    onSelect: () => requestQuakeTerminal({ action: "open", segment: "log" }),
  };
}

/**
 * The `Operator: Show tasks` entry — the quake terminal opened straight onto
 * its Operator Tasks segment (the operator watchlist). No registry chord: the
 * segment is a view inside the quake terminal, one Tab-reachable click past
 * ⌘J; the palette entry is its keyboard-parity path (Constitution V). On
 * mobile the seam maps it to the operator route's `?tab=tasks`.
 */
export function buildQuakeTerminalTasksAction(): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal-tasks",
    label: "Operator: Show tasks",
    onSelect: () => requestQuakeTerminal({ action: "open", segment: "tasks" }),
  };
}

/**
 * The `Operator: Reset quake terminal size` entry — the palette twin of the
 * grips' double-click reset (Constitution V: every UI-control action is
 * registered here). It writes the default geometry straight to the per-viewer
 * store, which applies live to an open drawer through the store's same-tab
 * notify and to the next open otherwise; it never opens the drawer itself.
 * Always listed like its siblings — where no drawer renders (mobile) the
 * write is inert.
 */
export function buildQuakeTerminalResetSizeAction(): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal-reset-size",
    label: "Operator: Reset quake terminal size",
    onSelect: () => writeQuakeGeometry(QUAKE_GEOMETRY_DEFAULT),
  };
}

/**
 * The `Operator: Pin quake terminal` / `Operator: Unpin quake terminal` entry
 * — the palette twin of the header row's ⌖ button (Constitution V): while
 * pinned, the outside-click collapse is suspended (the chord, Esc, and ▼
 * still collapse). No chord. The label toggles on the ephemeral pin slot.
 * Listed only while the desktop machine is `open` — pinning a closed drawer
 * has no meaning, so the registration site gates the listing; the builder
 * itself is open-agnostic.
 */
export function buildQuakeTerminalPinAction(pinned: boolean): QuakeTerminalPaletteAction {
  return {
    id: "quake-terminal-pin",
    label: pinned ? "Operator: Unpin quake terminal" : "Operator: Pin quake terminal",
    onSelect: () => {
      setQuakePinned(!pinned);
      // A MOUSE pick races the drawer's outside-click capture listener: the
      // palette closes around the same click, and the pending settle would
      // see no open dialog and collapse the drawer (taking the fresh pin with
      // it). Re-asserting the open state bumps the machine's activity counter
      // even as a same-value no-op — exactly the signal the settle backs off
      // on. The entry is listed only while the machine is open, so the
      // re-assert can never open a closed drawer.
      setQuakeMachineState("open");
    },
  };
}
