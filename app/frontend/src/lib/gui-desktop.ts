/**
 * Pure helpers for the desktop picker (spec docs/specs/gui.md § Switching
 * desktops) — the shared half of the two doors (the Settings `gui.wm` select
 * and the palette's `GUI: Desktop…` sub-list). Both read the one-shot status
 * document's `wm_candidates` (PATH-derived server-side, never stored); the
 * pick flow itself (write → enabled-check → restart confirm) lives in
 * hooks/use-desktop-pick.ts.
 */

import type { GuiStatus, GuiWMCandidate } from "@/api/client";
import type { PaletteAction } from "@/components/command-palette";

/** The unset pin — the supervisor's WM ladder decides. */
export const AUTO_WM = "";

/** The Settings select's `Other…` option value. Not a PATH binary name — a
 *  stored pin equal to it would be a hand-edited config, and guards (never
 *  casts) keep it out of every write path. */
export const OTHER_WM = "__other__";

/** The info toast when the pin is written while the GUI is off. */
export const DESKTOP_SET_OFF_TOAST = "Desktop set — takes effect when the GUI turns on";

export type WMOption = { value: string; label: string };

function candidatesOf(status: GuiStatus): GuiWMCandidate[] {
  return status.wm_candidates ?? [];
}

/** The Settings select's options: Auto, one per installed candidate, Other…. */
export function buildWMOptions(status: GuiStatus): WMOption[] {
  const options: WMOption[] = [{ value: AUTO_WM, label: "Auto (ladder)" }];
  for (const c of candidatesOf(status)) options.push({ value: c.name, label: c.label });
  options.push({ value: OTHER_WM, label: "Other…" });
  return options;
}

/** True when the stored pin names no installed candidate (a typed binary). */
export function isOtherWM(value: string, candidates: GuiWMCandidate[]): boolean {
  return value !== AUTO_WM && !candidates.some((c) => c.name === value);
}

/**
 * The palette sub-list's rows: Auto first, one per candidate (the stored pin's
 * row marked `current`), and the install hint as a trailing disabled row. No
 * `Other…` — a typed binary needs the Settings row's text field.
 */
export function buildDesktopPaletteRows(
  status: GuiStatus,
  currentWM: string,
  onPick: (name: string) => void,
): PaletteAction[] {
  const rows: PaletteAction[] = [
    {
      id: "desktop-auto",
      label: "Auto (ladder)",
      ...(currentWM === AUTO_WM ? { description: "current" } : {}),
      onSelect: () => onPick(AUTO_WM),
    },
  ];
  for (const c of candidatesOf(status)) {
    rows.push({
      id: `desktop-${c.name}`,
      label: c.label,
      ...(c.name === currentWM ? { description: "current" } : {}),
      onSelect: () => onPick(c.name),
    });
  }
  if (typeof status.wm_candidates_hint === "string" && status.wm_candidates_hint !== "") {
    rows.push({
      id: "desktop-install-hint",
      label: `Install more: ${status.wm_candidates_hint}`,
      disabled: true,
      onSelect: () => {},
    });
  }
  return rows;
}

/**
 * The restart confirm's body copy (the off-confirm's apps grammar). `null` is
 * the failed status GET — the confirm still renders, with the generic line.
 */
export function guiRestartBody(status: GuiStatus | null): string {
  if (status === null) {
    return "Couldn't read the desktop status — restarting it closes any running apps.";
  }
  if (!status.reachable || status.display === "") {
    return "The desktop is not running — the new desktop starts on the next restart.";
  }
  if (status.apps.length === 0) {
    return `No apps are running on display ${status.display}.`;
  }
  return `Running apps will close: ${status.apps.map((a) => `${a.name} ×${a.count}`).join(", ")}`;
}
