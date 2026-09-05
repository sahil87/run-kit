import { requestOperatorConsole } from "@/lib/operator-console";

/**
 * Pure builder for the palette's `Operator: Open console` entry — extracted
 * so the shape is unit-testable without mounting the shell, mirroring
 * `lib/palette/zen.ts`. The entry id IS the `operator-console` registry
 * actionId, so `withShortcutHints` attaches the effective chord. The action
 * goes straight to open+focused on the desktop machine (the chord is the
 * stepped cycle; an explicit "Open console" pick skips the focused-only
 * intermediate); on mobile it opens the sheet.
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
