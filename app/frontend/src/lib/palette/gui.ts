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
 *  - `GUI: Desktop…`            — switch ON only (NOT gated on reachable); a
 *                                 lazy sub-list of the installed WM/desktop
 *                                 candidates (the loader fetches the status
 *                                 document + settings entries on entry).
 *  - `GUI: Open terminal` / `GUI: Open browser` — switch ON AND reachable AND
 *                                 not the screen-sharing mirror (the mirror
 *                                 has no display to launch into); POSTs
 *                                 `/api/gui/host/launch` via the caller's
 *                                 onLaunch. Independent of `tileOpen` — a
 *                                 phone user may launch, then open the tile.
 *  - `GUI: Resolution → …`      — the launch rows' gate: one row per preset
 *                                 (`current` marks the row matching the
 *                                 host's geometry), `Match this tile` (only
 *                                 with a tile open — it measures the tile),
 *                                 `Custom…` (the caller's prompt), and `Auto
 *                                 (follow this tile)` (hidden while the
 *                                 setting already reads `auto` — the
 *                                 destination-only rule).
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
 *                                 viewer-local `rk-gui-lock` posture. Under a
 *                                 fixed geometry the pins are inert: the row
 *                                 renders DISABLED with the fixed-size
 *                                 description rather than disappearing.
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

import type { GuiLaunchApp } from "../../api/client";
import type { PaletteAction } from "../../components/command-palette";
import type { GuiViewMode } from "../gui-posture";
import { GUI_GEOMETRY_PRESETS, presetLabel } from "../gui-geometry";

export type GuiPaletteAction = {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  /** The `GUI: Desktop…` sub-list — the palette's generic single-select
   *  sub-step (see PaletteAction.subList); rows load lazily on entry. */
  subList?: PaletteAction["subList"];
  disabled?: boolean;
  onSelect: () => void;
};

export type GuiPaletteInput = {
  /** The host signal's `enabled` (the gui.enabled switch state). */
  enabled: boolean;
  /** The host signal's `reachable` (the launch rows exist only on a live display). */
  reachable: boolean;
  /** The host signal's `backend` — the view-only mirror has no display to launch into. */
  backend: string;
  /** A gui tile is open in the current layout. */
  tileOpen: boolean;
  /** The tile's RFB connection state (the R11 dot seam). */
  connected: boolean;
  /** Coarse pointer — the resize lock is a fine-pointer-only verb. */
  coarsePointer: boolean;
  viewMode: GuiViewMode;
  resizeLocked: boolean;
  /** The host signal's `geometry` — the `gui.geometry` setting: a fixed `WxH`,
   *  or `auto` (the desktop follows the focused fine-pointer viewer). */
  geometry: string;
  /** The rk-gui supervisor session's host window was found for navigation. */
  supervisorAvailable: boolean;
  onTurnOn: () => void;
  /** Opens the off-confirm dialog (the dialog owns the settings POST). */
  onTurnOff: () => void;
  /** The `GUI: Desktop…` sub-list's lazy row loader — fetches the status
   *  document + settings entries once on sub-step entry (never polled). */
  loadDesktopRows: () => Promise<PaletteAction[]>;
  /** POST /api/gui/host/launch for the role; the caller owns the toast. */
  onLaunch: (app: GuiLaunchApp) => void;
  /** POST /api/gui/host/resize for a preset or `auto`; the caller owns the toast. */
  onResize: (geometry: string) => void;
  /** Opens the Custom… geometry prompt (the caller owns the dialog). */
  onResizeCustom: () => void;
  /** Measures the open gui tile and posts the closest-aspect preset. */
  onMatchTile: () => void;
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

  actions.push({
    id: "gui-desktop",
    label: "GUI: Desktop…",
    subList: {
      placeholder: "Pick a desktop — Enter select · Esc cancel",
      rows: input.loadDesktopRows,
    },
    onSelect: () => {},
  });

  if (input.reachable && input.backend !== "screen-sharing") {
    actions.push(
      { id: "gui-open-terminal", label: "GUI: Open terminal", onSelect: () => input.onLaunch("terminal") },
      { id: "gui-open-browser", label: "GUI: Open browser", onSelect: () => input.onLaunch("browser") },
    );
    for (const preset of GUI_GEOMETRY_PRESETS) {
      actions.push({
        id: `gui-res-${preset}`,
        label: `GUI: Resolution → ${presetLabel(preset)}`,
        ...(preset === input.geometry ? { description: "current" } : {}),
        onSelect: () => input.onResize(preset),
      });
    }
    // Match measures the open tile — without one there is nothing to measure.
    if (input.tileOpen) {
      actions.push({
        id: "gui-res-match",
        label: "GUI: Resolution → Match this tile",
        onSelect: input.onMatchTile,
      });
    }
    actions.push({
      id: "gui-res-custom",
      label: "GUI: Resolution → Custom…",
      onSelect: input.onResizeCustom,
    });
    // Destination-only: Auto hides while the setting already reads `auto`.
    if (input.geometry !== "auto") {
      actions.push({
        id: "gui-res-auto",
        label: "GUI: Resolution → Auto (follow this tile)",
        description: "today's behavior — the desktop follows the focused fine-pointer viewer",
        onSelect: () => input.onResize("auto"),
      });
    }
  }

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
      // Under a fixed geometry the pins are inert (no viewer can drive
      // SetDesktopSize) — the row stays, disabled, saying why. Only a real
      // WxH counts as fixed: an empty geometry (a stream entry that omitted
      // the field) leaves the pins as they were.
      const fixedPin =
        input.geometry !== "" && input.geometry !== "auto"
          ? {
              disabled: true,
              description: `resolution is fixed (${presetLabel(input.geometry)}) — pick Auto to follow the tile`,
            }
          : {};
      actions.push(
        input.resizeLocked
          ? { id: "gui-unlock", label: "GUI: Unlock resolution", ...fixedPin, onSelect: () => input.onLockChange(false) }
          : { id: "gui-lock", label: "GUI: Lock resolution", ...fixedPin, onSelect: () => input.onLockChange(true) },
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
