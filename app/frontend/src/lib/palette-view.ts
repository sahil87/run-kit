/**
 * Pure builder for the command-palette window-view lens actions (`View: Web` /
 * `View: Terminal` / `View: Chat`). Extracted from app.tsx so the visibility
 * gating (available AND not-current) and label/shortcut composition are
 * unit-testable without mounting the whole shell — mirroring lib/palette-move.ts
 * / lib/palette-update.ts. The action bodies are thin `onSelect` wrappers passed
 * in by the caller (they call `switchView(v)`).
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
  chat: "View: Chat",
};

/** The chat toggle's binding (VS-Code-style "toggle terminal"). */
const CHAT_SHORTCUT = "Ctrl+`";
/** The `Cmd/Ctrl+.` view cycle. */
const CYCLE_SHORTCUT = "⌘.";

/**
 * The keyboard hint shown on a view-switch entry — the binding that reaches it.
 * `View: Chat` and (when leaving chat) `View: Terminal` are the two ends of the
 * `Ctrl+\`` toggle, so they show `Ctrl+\``; every other switch is only reachable
 * via the `⌘.` cycle. `current` is the view being switched AWAY from.
 */
function shortcutFor(target: ViewName, current: ViewName): string {
  if (target === "chat") return CHAT_SHORTCUT;
  if (target === "tty" && current === "chat") return CHAT_SHORTCUT;
  return CYCLE_SHORTCUT;
}

/**
 * Build the view-switch palette actions. Returns one action per view that is
 * available AND is not the current (`resolved`) view. A single-view window
 * (only `tty` available) yields an empty array — there is nothing to switch to.
 * Each entry carries the shortcut hint for the binding that reaches it.
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
      shortcut: shortcutFor(v, resolved),
      onSelect: () => onSwitch(v),
    }));
}
