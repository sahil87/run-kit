/**
 * Pure builder for the command-palette window-view lens actions (`View: Web` /
 * `View: Terminal` / `View: Chat`). Extracted from app.tsx so the visibility
 * gating (available AND not-current) and label/shortcut composition are
 * unit-testable without mounting the whole shell — mirroring lib/palette-move.ts
 * / lib/palette-update.ts. The action bodies are thin `onSelect` wrappers passed
 * in by the caller (they call `switchView(v)`).
 *
 * Constitution V palette parity (the palette is the ONLY lens-switch surface
 * since the ViewSwitcher's retirement, 260812-0c6o): each lens is offered
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
  code: "View: Code",
};

/** Default hint string — the registry default for `view-cycle`. Callers wired
 *  to the keybinding registry (260730-g40a) pass the EFFECTIVE formatted combo
 *  instead, so hints track overrides; an empty string means "no working chord"
 *  and renders no hint. */
const CYCLE_SHORTCUT = "⌘.";

/** The per-entry hint for the lens cycle — the one chord that reaches a view
 *  switch (the `chat-toggle` chord is retired, 260812-0c6o, so `View: Chat`
 *  renders NO hint). */
export type ViewShortcutHints = { cycle: string };

/**
 * The keyboard hint shown on a view-switch entry. Every lens except `chat`
 * is reachable via the lens cycle; `View: Chat` gets no hint — the dedicated
 * chat chord is gone (260812-0c6o) and chat is palette-only by design (the
 * demotion deliberately leaves it unadvertised).
 */
function shortcutFor(target: ViewName, hints: ViewShortcutHints): string {
  if (target === "chat") return "";
  return hints.cycle;
}

/**
 * Build the view-switch palette actions. Returns one action per view that is
 * available AND is not the current (`resolved`) view. A single-view window
 * (only `tty` available) yields an empty array — there is nothing to switch to.
 * Each entry carries the shortcut hint for the binding that reaches it,
 * sourced from `hints` (the caller's effective keybinding combo; the default
 * matches the registry default for legacy callers/tests).
 */
export function buildViewActions(
  available: ViewName[],
  resolved: ViewName,
  onSwitch: (view: ViewName) => void,
  hints: ViewShortcutHints = { cycle: CYCLE_SHORTCUT },
): ViewPaletteAction[] {
  return available
    .filter((v) => v !== resolved)
    .map((v) => ({
      id: `view-${v}`,
      label: VIEW_ACTION_LABEL[v],
      shortcut: shortcutFor(v, hints),
      onSelect: () => onSwitch(v),
    }));
}
