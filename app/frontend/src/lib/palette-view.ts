/**
 * Pure builder for the command-palette window-view lens actions (`View: Web` /
 * `View: Terminal`). Extracted from app.tsx so the visibility gating (available
 * AND not-current) and label composition are unit-testable without mounting the
 * whole shell — mirroring lib/palette-move.ts / lib/palette-update.ts. The
 * action bodies are thin `onSelect` wrappers passed in by the caller (they call
 * `switchView(v)`).
 *
 * Constitution V palette parity for the L1 ViewSwitcher: each lens is offered
 * only when it is AVAILABLE for the current window AND is not the current view,
 * so the palette shows the destination, never the current lens. These REPLACE
 * the retired `toggle-iframe-terminal` action, which mutated `@rk_type`.
 */
import type { ViewName } from "./window-view";

export type ViewPaletteAction = {
  id: string;
  label: string;
  shortcut: string;
  onSelect: () => void;
};

/** Human label for a view's palette entry. */
const VIEW_ACTION_LABEL: Record<ViewName, string> = {
  tty: "View: Terminal",
  web: "View: Web",
};

/**
 * Build the view-switch palette actions. Returns one action per view that is
 * available AND is not the current (`resolved`) view. A single-view window
 * (only `tty` available) yields an empty array — there is nothing to switch to.
 * The `⌘.` cycle shortcut is surfaced as the hint on each entry.
 */
export function buildViewActions(
  available: ViewName[],
  resolved: ViewName,
  onSwitch: (view: ViewName) => void,
): ViewPaletteAction[] {
  return available
    .filter((v) => v !== resolved)
    .map((v) => ({
      id: `view-${v}`,
      label: VIEW_ACTION_LABEL[v],
      shortcut: "⌘.",
      onSelect: () => onSwitch(v),
    }));
}
