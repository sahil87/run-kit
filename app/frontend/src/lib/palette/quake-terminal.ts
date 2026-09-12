import { requestQuakeTerminal } from "@/lib/quake-terminal";

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
