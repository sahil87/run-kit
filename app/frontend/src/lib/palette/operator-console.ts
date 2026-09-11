import { requestOperatorConsole } from "@/lib/operator-console";

/**
 * Pure builder for the palette's `Operator: Open console` entry — extracted
 * so the shape is unit-testable without mounting the shell, mirroring
 * `lib/palette/zen.ts`. The entry id IS the `operator-console` registry
 * actionId, so `withShortcutHints` attaches the effective chord. The action
 * lands on open+focused on the desktop machine (an explicit "Open console"
 * pick always opens, where the chord toggles); on mobile it navigates to the
 * operator window's terminal route.
 */
export type OperatorConsolePaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

export function buildOperatorConsoleAction(): OperatorConsolePaletteAction {
  return {
    id: "operator-console",
    label: "Operator: Open console",
    onSelect: () => requestOperatorConsole({ action: "open" }),
  };
}

/**
 * The cron-segment twins — the console opened straight onto its Cron List /
 * Cron Log segment. No registry chord: the segment is a view inside the
 * console, one Tab-reachable click past ⌘J; the palette entries are its
 * keyboard-parity path (Constitution V). On mobile the seam maps them to the
 * operator route's `?tab=` param. List registers before log everywhere.
 */
export function buildOperatorConsoleListAction(): OperatorConsolePaletteAction {
  return {
    id: "operator-console-list",
    label: "Operator: Show cron list",
    onSelect: () => requestOperatorConsole({ action: "open", segment: "list" }),
  };
}

export function buildOperatorConsoleLogAction(): OperatorConsolePaletteAction {
  return {
    id: "operator-console-log",
    label: "Operator: Show cron log",
    onSelect: () => requestOperatorConsole({ action: "open", segment: "log" }),
  };
}

/**
 * The `Operator: Show tasks` entry — the console opened straight onto its
 * Operator Tasks segment (the operator watchlist). No registry chord: the
 * segment is a view inside the console, one Tab-reachable click past ⌘J; the
 * palette entry is its keyboard-parity path (Constitution V). On mobile the
 * seam maps it to the operator route's `?tab=tasks`.
 */
export function buildOperatorConsoleTasksAction(): OperatorConsolePaletteAction {
  return {
    id: "operator-console-tasks",
    label: "Operator: Show tasks",
    onSelect: () => requestOperatorConsole({ action: "open", segment: "tasks" }),
  };
}
