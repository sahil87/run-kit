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
