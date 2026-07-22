/**
 * Pure builder for the command-palette Open-in-App actions (`Open: VS Code` /
 * `Open: iTerm (on host)` …) — Constitution V palette parity for the top-bar
 * Open split-button (260722-6d0f), extracted so the label composition and
 * suffix rule are unit-testable without mounting the shell (the
 * lib/palette-view.ts / lib/palette-pin.ts pattern). The action bodies are
 * thin `onSelect` wrappers passed in by the caller (they run the target via
 * the shared run-a-target behavior, persisting the last-used preference).
 *
 * No keyboard chord is registered for these actions: the palette itself is
 * the constitution's primary keyboard discovery mechanism, and Open targets
 * are data-driven (the set varies per deployment), so a static chord cannot
 * name one. This registration comment documents that per the code-review
 * rule ("new keyboard shortcuts must be documented in the command palette
 * registration").
 *
 * Label rule: `Open: <label>`, with host targets suffixed ` (on host)` ONLY
 * when the target list also carries deeplink entries (a remote client) —
 * that is when a deeplink and a host app for the same editor could collide;
 * a local client's single-mechanism list stays unsuffixed. Mirrors
 * OpenMenuRows' collapsed-row labels exactly so palette↔menu never drift.
 */
import type { OpenTarget } from "./open-in-app";

export type OpenPaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/** Compose a target's display label per the shared suffix rule. */
export function openActionLabel(target: OpenTarget, hasBothKinds: boolean): string {
  return target.kind === "host" && hasBothKinds
    ? `Open: ${target.label} (on host)`
    : `Open: ${target.label}`;
}

/**
 * Build one palette action per available open target. An empty target list
 * (no sshHost + empty registry, or no folder) yields no actions — the
 * palette mirrors the hidden button.
 */
export function buildOpenActions(
  targets: OpenTarget[],
  onRun: (target: OpenTarget) => void,
): OpenPaletteAction[] {
  const hasBothKinds =
    targets.some((t) => t.kind === "deeplink") && targets.some((t) => t.kind === "host");
  return targets.map((t) => ({
    id: `open-${t.id}`,
    label: openActionLabel(t, hasBothKinds),
    onSelect: () => onRun(t),
  }));
}
