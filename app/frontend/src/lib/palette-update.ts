/**
 * Pure builder for the command-palette update actions (`run-kit: Update to
 * v{latest}` + `run-kit: Dismiss Update Notice`). Extracted from app.tsx so the
 * qualification gating and label composition are unit-testable without mounting
 * the whole shell — mirroring lib/palette-move.ts. The action bodies are thin
 * wrappers passed in by the caller (they invoke updateNow / dismissUpdate).
 *
 * Note: the palette deliberately IGNORES chip dismissal (dismissal silences only
 * the ambient chip; the palette is deliberate discovery), so the gate here is
 * `qualifies` alone — NOT the chip's `showChip`.
 */

export type UpdatePaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/**
 * Build the update palette actions. Returns an empty array when no qualifying
 * update is pending (`qualifies` false, or `latest` null — e.g. the `dev`
 * version or no update-available event yet).
 */
export function buildUpdateActions(
  qualifies: boolean,
  latest: string | null,
  onUpdate: () => void,
  onDismiss: () => void,
): UpdatePaletteAction[] {
  if (!qualifies || !latest) return [];
  return [
    {
      id: "run-kit-update",
      label: `run-kit: Update to v${latest}`,
      onSelect: onUpdate,
    },
    {
      id: "run-kit-dismiss-update",
      label: "run-kit: Dismiss Update Notice",
      onSelect: onDismiss,
    },
  ];
}

// Sentinel running version for local (non-ldflags) builds — the maintenance
// entries are suppressed for it (a dev serve process is air-managed, so a
// force-update / restart would bounce the REAL daemon out from under `just dev`).
// Kept local to this pure builder (which takes `version` directly) so the module
// stays dependency-free and unit-testable without the context.
const DEV_VERSION = "dev";

/**
 * Build the always-available maintenance palette actions, independent of the
 * qualifying-update gate (unlike buildUpdateActions):
 *   - `run-kit: Update Now` — force update. Included ONLY when the daemon is a
 *     Homebrew install (`brew`) AND the version is not the `dev` sentinel. NOT
 *     gated on a qualifying update, so it reaches patch releases and works before
 *     any check has run.
 *   - `run-kit: Restart Daemon` — bounce the daemon. Included whenever the
 *     version is not `dev` (no brew requirement).
 * Both fire immediately on select (no confirmation dialog). The existing
 * qualifying-gated `run-kit: Update to v{latest}` entry (buildUpdateActions) is
 * unaffected — a slight label overlap when an update qualifies is accepted.
 */
export function buildMaintenanceActions(
  brew: boolean,
  version: string | null,
  onForceUpdate: () => void,
  onRestart: () => void,
): UpdatePaletteAction[] {
  const isDev = version === DEV_VERSION;
  const actions: UpdatePaletteAction[] = [];
  if (brew && !isDev) {
    actions.push({
      id: "run-kit-force-update",
      label: "run-kit: Update Now",
      onSelect: onForceUpdate,
    });
  }
  if (!isDev) {
    actions.push({
      id: "run-kit-restart",
      label: "run-kit: Restart Daemon",
      onSelect: onRestart,
    });
  }
  return actions;
}
