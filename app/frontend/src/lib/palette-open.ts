/**
 * Pure builder for the command-palette Open-in-App actions (`Open: VS Code` /
 * `Open: iTerm (on host)` …) — Constitution V palette parity for the top-bar
 * Open split-button (260722-6d0f), extracted so the label composition and
 * suffix rule are unit-testable without mounting the shell (the
 * lib/palette-view.ts / lib/palette-pin.ts pattern). The action bodies are
 * thin `onSelect` wrappers passed in by the caller (they run the target via
 * the shared run-a-target behavior, persisting the last-used preference).
 *
 * No keyboard chord is registered for the per-target actions: the palette
 * itself is the constitution's primary keyboard discovery mechanism, and Open
 * targets are data-driven (the set varies per deployment), so a static chord
 * cannot name one. The exception (260801-sm6g) is `open-last-used` — an
 * action naming the BEHAVIOR ("re-run the last-used target"), not an app —
 * which sidesteps that objection: it carries the ⇧⌘O / Shift+Ctrl+O chord in
 * the keybinding registry (`lib/keybindings.ts`) and the dynamic
 * `Open: Last used (<label>)` palette entry built by `buildOpenLastUsedAction`
 * below (the entry's id doubles as the registry actionId, so the chord hint
 * decorates it automatically). This registration comment documents both per
 * the code-review rule ("new keyboard shortcuts must be documented in the
 * command palette registration").
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

/**
 * Build the `Open: Last used (<label>)` palette action (260801-sm6g) — the
 * palette twin of the ⇧⌘O `open-last-used` chord and the Open split-button's
 * primary segment. The caller passes the RESOLVED last-used target
 * (`resolveLastUsedTarget` over the live target set); no resolved target
 * (nothing stored, or a stale id) yields no entry — the dynamic suffix needs
 * a target to name, and the boundary-hidden convention (Move up/down) applies.
 * The chord itself stays live without a resolved target: its handler shows the
 * "No last-used app yet" toast instead. Id `open-last-used` doubles as the
 * registry actionId so `withShortcutHints` decorates the entry automatically.
 */
export function buildOpenLastUsedAction(
  lastUsed: OpenTarget | null,
  onRun: (target: OpenTarget) => void,
): OpenPaletteAction[] {
  if (!lastUsed) return [];
  return [
    {
      id: "open-last-used",
      label: `Open: Last used (${lastUsed.label})`,
      onSelect: () => onRun(lastUsed),
    },
  ];
}

/**
 * Build the `Open: PR #{n}` palette action for the current terminal window
 * (260727-w2d8). Client-side only: `onSelect` delegates the public PR URL to
 * `onOpen` (the caller does `window.open`, the Help: Documentation pattern) —
 * no host spoke, no server exec. Deliberately NOT an OpenTarget: the
 * palette↔menu mirror above covers Open *targets* only, so the top-bar Open
 * split-button menu is untouched. No PR bound to the window (`prUrl` unset)
 * → no action, mirroring the sidebar PrLinkRow's absence. As with the target
 * actions, no keyboard chord is registered — the palette entry itself is the
 * keyboard path (documented per the code-review shortcut rule).
 */
export function buildOpenPrAction(
  prUrl: string | undefined,
  prNumber: number | undefined,
  onOpen: (url: string) => void,
): OpenPaletteAction[] {
  if (!prUrl) return [];
  return [
    {
      id: "open-pr",
      label: prNumber != null ? `Open: PR #${prNumber}` : "Open: PR",
      onSelect: () => onOpen(prUrl),
    },
  ];
}
