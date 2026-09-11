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
 *  - `GUI: Quality → Sharp / Balanced / Smooth` — the launch rows' gate,
 *                                 right after the Resolution rows; fixed
 *                                 descriptions with ` · current` on the
 *                                 active preset; each selects the
 *                                 viewer-local `rk-gui-quality` posture via
 *                                 onQuality.
 *  - `GUI: Show stats` / `GUI: Hide stats` — gui tile open; destination-only
 *                                 pair toggling the viewer-local
 *                                 `rk-gui-stats-visible` posture via
 *                                 onStatsVisible.
 *  - `GUI: Fullscreen`          — gui tile open; the fullscreen verb (zen
 *                                 fallback where requestFullscreen is absent).
 *  - `GUI: Paste clipboard`     — gui tile open AND connected (readText needs a
 *                                 user gesture — palette selection is one).
 *  - `GUI: Send key…`           — gui tile open AND connected (the paste gate);
 *                                 opens the caller's Send key prompt.
 *  - `GUI: HiDPI on` / `GUI: HiDPI off` — gui tile open; destination-only pair
 *                                 toggling the viewer-local `rk-gui-hidpi`
 *                                 posture (client-side rendering only).
 *  - `GUI: Hide key bar` / `GUI: Show key bar` — gui tile open AND coarse
 *                                 pointer (the bar itself is coarse-only);
 *                                 destination-only pair toggling the
 *                                 viewer-local `rk-gui-keybar` posture.
 *  - `GUI: Zoom in` / `GUI: Zoom out` / `GUI: Zoom to fit` / `GUI: 1:1` —
 *                                 gui tile open; destination-only zoom rows
 *                                 (Zoom in hides at 200, Zoom out and Zoom to
 *                                 fit hide at fit, 1:1 hides at 100 — it is
 *                                 the 100% alias of the ladder). The three
 *                                 zoom ids ARE the registry actionIds, so
 *                                 `withShortcutHints` decorates the Ctrl
 *                                 chords for free.
 *  - `GUI: Pointer → Trackpad` / `GUI: Pointer → Touch` — gui tile open AND
 *                                 coarse pointer only (a fine pointer has no
 *                                 translation layer to toggle);
 *                                 destination-only pair toggling the
 *                                 viewer-local `rk-gui-pointer` posture.
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
import { GUI_GEOMETRY_PRESETS, presetLabel } from "../gui-geometry";
import { stepGuiZoom, type GuiPointerMode, type GuiQuality, type GuiZoom } from "../gui-posture";

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
  /** Coarse pointer — the resize lock is fine-pointer-only, the pointer-mode
   *  pair coarse-only. */
  coarsePointer: boolean;
  /** The viewer's zoom posture (`rk-gui-zoom`). */
  zoom: GuiZoom;
  /** The viewer's pointer mode (`rk-gui-pointer`). */
  pointerMode: GuiPointerMode;
  resizeLocked: boolean;
  /** The viewer's quality preset (`rk-gui-quality`). */
  quality: GuiQuality;
  /** The viewer's stats overlay visibility (`rk-gui-stats-visible`). */
  statsVisible: boolean;
  /** The viewer's HiDPI posture (`rk-gui-hidpi`). */
  hidpi: boolean;
  /** The viewer's key-bar visibility (`rk-gui-keybar`). */
  keyBarVisible: boolean;
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
  onZoom: (z: GuiZoom) => void;
  onPointerMode: (m: GuiPointerMode) => void;
  onLockChange: (locked: boolean) => void;
  onQuality: (q: GuiQuality) => void;
  onStatsVisible: (visible: boolean) => void;
  onHidpiChange: (on: boolean) => void;
  onKeyBarVisibleChange: (visible: boolean) => void;
  /** Opens the Send key prompt (the caller owns the dialog). */
  onSendKey: () => void;
  onOpenLogs: () => void;
  onReconnect: () => void;
};

/** The three `GUI: Quality →` rows in palette order; the active preset's
 *  description gains the ` · current` suffix (the Resolution rows' marker
 *  grammar). */
const GUI_QUALITY_ROWS: { quality: GuiQuality; name: string; description: string }[] = [
  { quality: "sharp", name: "Sharp", description: "more detail, more bytes" },
  { quality: "balanced", name: "Balanced", description: "default" },
  { quality: "smooth", name: "Smooth", description: "fewer bytes, smoother motion on slow links" },
];

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
    for (const row of GUI_QUALITY_ROWS) {
      actions.push({
        id: `gui-quality-${row.quality}`,
        label: `GUI: Quality → ${row.name}`,
        description:
          row.quality === input.quality ? `${row.description} · current` : row.description,
        onSelect: () => input.onQuality(row.quality),
      });
    }
  }

  if (input.tileOpen) {
    actions.push(
      { id: "gui-fullscreen", label: "GUI: Fullscreen", onSelect: input.onFullscreen },
    );
    if (input.connected) {
      actions.push(
        {
          id: "gui-paste",
          label: "GUI: Paste clipboard",
          onSelect: input.onPaste,
        },
        { id: "gui-send-key", label: "GUI: Send key…", onSelect: input.onSendKey },
      );
    }
    // Destination-only HiDPI pair — the entry shows the state it switches TO.
    actions.push(
      input.hidpi
        ? { id: "gui-hidpi-off", label: "GUI: HiDPI off", onSelect: () => input.onHidpiChange(false) }
        : {
            id: "gui-hidpi-on",
            label: "GUI: HiDPI on",
            description: "render at device pixels — 1:1 is crisp on a Retina display",
            onSelect: () => input.onHidpiChange(true),
          },
    );
    // Destination-only zoom rows — each shows the rung it switches TO. The
    // zoom ids ARE the registry actionIds (the chord-hint contract).
    if (input.zoom !== 200) {
      actions.push({
        id: "gui-zoom-in",
        label: "GUI: Zoom in",
        onSelect: () => input.onZoom(stepGuiZoom(input.zoom, 1)),
      });
    }
    if (input.zoom !== "fit") {
      actions.push(
        {
          id: "gui-zoom-out",
          label: "GUI: Zoom out",
          onSelect: () => input.onZoom(stepGuiZoom(input.zoom, -1)),
        },
        { id: "gui-zoom-fit", label: "GUI: Zoom to fit", onSelect: () => input.onZoom("fit") },
      );
    }
    if (input.zoom !== 100) {
      actions.push({
        id: "gui-view-1to1",
        label: "GUI: 1:1",
        description: "100% — same as zoom",
        onSelect: () => input.onZoom(100),
      });
    }
    if (input.coarsePointer) {
      // Destination-only pair — the entry shows the mode it switches to.
      actions.push(
        input.pointerMode === "touch"
          ? {
              id: "gui-pointer-trackpad",
              label: "GUI: Pointer → Trackpad",
              description: "one finger moves, tap clicks, two-finger tap right-clicks, two-finger drag scrolls",
              onSelect: () => input.onPointerMode("trackpad"),
            }
          : {
              id: "gui-pointer-touch",
              label: "GUI: Pointer → Touch",
              description: "tap where you touch",
              onSelect: () => input.onPointerMode("touch"),
            },
        input.keyBarVisible
          ? { id: "gui-keybar-hide", label: "GUI: Hide key bar", onSelect: () => input.onKeyBarVisibleChange(false) }
          : { id: "gui-keybar-show", label: "GUI: Show key bar", onSelect: () => input.onKeyBarVisibleChange(true) },
      );
    }
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
    // Destination-only pair — the entry shows the state it switches to.
    actions.push(
      input.statsVisible
        ? { id: "gui-stats-hide", label: "GUI: Hide stats", onSelect: () => input.onStatsVisible(false) }
        : { id: "gui-stats-show", label: "GUI: Show stats", onSelect: () => input.onStatsVisible(true) },
    );
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
