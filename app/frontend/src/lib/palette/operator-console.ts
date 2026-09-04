import { requestOperatorConsole } from "@/lib/operator-console";

/**
 * Pure builder for the palette's `Operator: Open console` entry — extracted
 * so the shape is unit-testable without mounting the shell, mirroring
 * `lib/palette/zen.ts`. The entry id IS the `operator-console` registry
 * actionId, so `withShortcutHints` attaches the effective chord and the chord
 * resolves through the same toggle seam (the fromPalette convention): both
 * fire the console's document-event request, never the open state directly.
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
    onSelect: () => requestOperatorConsole({ action: "toggle" }),
  };
}
