/**
 * Pure builder for the command-palette `GUI:` action family (spec
 * docs/specs/gui.md § The switch; Constitution V — every GUI verb is
 * palette-reachable). Extracted from app.tsx so the per-state gating is
 * unit-testable without mounting the shell — mirroring `lib/palette/view.ts`
 * (`buildViewActions`). The action bodies are thin callbacks supplied by the
 * caller (app.tsx owns the settings POST, the off-confirm dialog, the RFB
 * seam, and navigation).
 *
 * Entries, per current state (the caller assembles these on the terminal
 * route only):
 *  - `GUI: Turn on`             — switch OFF only; POSTs `gui.enabled: true`.
 *  - `GUI: Turn off`            — switch ON only; opens the off-confirm dialog
 *                                 (the dialog owns the settings POST).
 *  - `GUI: Fullscreen`          — gui tile open; the fullscreen verb (zen
 *                                 fallback where requestFullscreen is absent).
 *  - `GUI: Paste clipboard`     — gui tile open AND connected (readText needs a
 *                                 user gesture — palette selection is one).
 *  - `GUI: Fit` / `GUI: 1:1`    — gui tile open; destination-only pair — the
 *                                 entry shows the mode it switches TO, never
 *                                 the current one (the `buildViewActions`
 *                                 pattern).
 *  - `GUI: Lock resolution` / `GUI: Unlock resolution` — gui tile open, fine
 *                                 pointer only (coarse viewers never drive
 *                                 resize, so there is nothing to lock);
 *                                 destination-only pair toggling the
 *                                 viewer-local `rk-gui-lock` posture.
 *  - `GUI: Open supervisor logs` — switch ON; navigates to the rk-gui
 *                                 session's host window. When the supervisor
 *                                 session is absent the row renders DISABLED
 *                                 with the reason as its description.
 *  - `GUI: Reconnect`           — gui tile open AND disconnected.
 *
 * The `gui-toggle` chord (⌘4/⇧Ctrl+4) is NOT built here — its palette parity
 * comes from the registry-inherited `Tile: Show/Hide/Focus GUI` rows plus
 * `withShortcutHints` on the actionId.
 */

import type { GuiViewMode } from "../gui-posture";

export type GuiPaletteAction = {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type GuiPaletteInput = {
  /** The host signal's `enabled` (the gui.enabled switch state). */
  enabled: boolean;
  /** A gui tile is open in the current layout. */
  tileOpen: boolean;
  /** The tile's RFB connection state (the R11 dot seam). */
  connected: boolean;
  /** Coarse pointer — the resize lock is a fine-pointer-only verb. */
  coarsePointer: boolean;
  viewMode: GuiViewMode;
  resizeLocked: boolean;
  /** The rk-gui supervisor session's host window was found for navigation. */
  supervisorAvailable: boolean;
  onTurnOn: () => void;
  /** Opens the off-confirm dialog (the dialog owns the settings POST). */
  onTurnOff: () => void;
  onFullscreen: () => void;
  onPaste: () => void;
  onViewMode: (mode: GuiViewMode) => void;
  onLockChange: (locked: boolean) => void;
  onOpenLogs: () => void;
  onReconnect: () => void;
};

export function buildGuiActions(input: GuiPaletteInput): GuiPaletteAction[] {
  const actions: GuiPaletteAction[] = [];

  if (!input.enabled) {
    actions.push({ id: "gui-turn-on", label: "GUI: Turn on", onSelect: input.onTurnOn });
    return actions;
  }

  actions.push({ id: "gui-turn-off", label: "GUI: Turn off", onSelect: input.onTurnOff });

  if (input.tileOpen) {
    actions.push(
      { id: "gui-fullscreen", label: "GUI: Fullscreen", onSelect: input.onFullscreen },
    );
    if (input.connected) {
      actions.push({
        id: "gui-paste",
        label: "GUI: Paste clipboard",
        onSelect: input.onPaste,
      });
    }
    // Destination-only pairs — the entry shows the posture it switches to.
    actions.push(
      input.viewMode === "fit"
        ? { id: "gui-view-1to1", label: "GUI: 1:1", onSelect: () => input.onViewMode("1:1") }
        : { id: "gui-view-fit", label: "GUI: Fit", onSelect: () => input.onViewMode("fit") },
    );
    if (!input.coarsePointer) {
      actions.push(
        input.resizeLocked
          ? { id: "gui-unlock", label: "GUI: Unlock resolution", onSelect: () => input.onLockChange(false) }
          : { id: "gui-lock", label: "GUI: Lock resolution", onSelect: () => input.onLockChange(true) },
      );
    }
    if (!input.connected) {
      actions.push({
        id: "gui-reconnect",
        label: "GUI: Reconnect",
        onSelect: input.onReconnect,
      });
    }
  }

  actions.push({
    id: "gui-logs",
    label: "GUI: Open supervisor logs",
    ...(input.supervisorAvailable
      ? {}
      : { disabled: true, description: "supervisor not running" }),
    onSelect: input.onOpenLogs,
  });

  return actions;
}
