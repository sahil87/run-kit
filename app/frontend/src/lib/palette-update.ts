/**
 * Pure builder for the command-palette update actions (a scoped
 * `run-kit: Update …` action + `run-kit: Dismiss Update Notice`). Extracted from
 * app.tsx so the qualification gating and label composition are unit-testable
 * without mounting the whole shell — mirroring lib/palette-move.ts. The action
 * bodies are thin wrappers passed in by the caller (they invoke updateNow /
 * dismissUpdate; dismiss writes the composite key).
 *
 * Note: the palette deliberately IGNORES chip dismissal (dismissal silences only
 * the ambient chip; the palette is deliberate discovery), so the gate here is
 * `qualifies` alone — NOT the chip's `showChip`.
 */

/** One matched tool for label composition (structurally the context's
 *  `UpdateTool`; declared locally to keep this module context-free). */
export type UpdateActionTool = { tool: string; current: string; latest: string };

/**
 * Compose the per-tool transition summary for a matched set — e.g.
 * `run-kit v3.8.0 → v3.9.0, fab-kit v2.16.0 → v2.17.0`. A tool with no known
 * current version degrades to `tool → v{latest}`. The SINGLE source consumed by
 * both the top-bar `UpdateChip` (title/aria) and the overflow-menu version-row
 * update surface (aria) so the two can never drift (R15 / A-024). Context-free
 * (takes the tool list directly), so it stays unit-testable without the context.
 */
export function updateChipToolSummary(tools: UpdateActionTool[]): string {
  return tools
    .map((t) => (t.current ? `${t.tool} v${t.current} → v${t.latest}` : `${t.tool} → v${t.latest}`))
    .join(", ");
}

export type UpdatePaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/** The run-kit tool name — a single run-kit match keeps the historical
 *  `run-kit: Update to v{latest}` label. */
const RUN_KIT_TOOL = "run-kit";

/**
 * Compose the update-action label from the matched tools. A single run-kit match
 * keeps today's `run-kit: Update to v{latest}`; a single non-run-kit tool reads
 * `run-kit: Update {tool} to v{latest}`; multiple tools read
 * `run-kit: Update N tools`. The action always runs a SCOPED update of exactly
 * the matched tools, so the label communicates which tools move.
 */
function updateActionLabel(tools: UpdateActionTool[]): string {
  if (tools.length === 1) {
    const t = tools[0];
    return t.tool === RUN_KIT_TOOL
      ? `run-kit: Update to v${t.latest}`
      : `run-kit: Update ${t.tool} to v${t.latest}`;
  }
  return `run-kit: Update ${tools.length} tools`;
}

/**
 * Build the update palette actions. Returns an empty array when no qualifying
 * update is pending (`qualifies` false, or `tools` empty — e.g. the `dev`
 * version or no update-available event yet).
 */
export function buildUpdateActions(
  qualifies: boolean,
  tools: UpdateActionTool[],
  onUpdate: () => void,
  onDismiss: () => void,
): UpdatePaletteAction[] {
  if (!qualifies || tools.length === 0) return [];
  return [
    {
      id: "run-kit-update",
      label: updateActionLabel(tools),
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
