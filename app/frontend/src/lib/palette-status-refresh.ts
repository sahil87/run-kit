/**
 * Pure builder for the command-palette `PR: Refresh Status` action
 * (260715-jykd-manual-status-refresh). Extracted from app.tsx so the label and
 * id are unit-testable without mounting the shell — mirroring lib/palette-view.ts
 * / lib/palette-update.ts. The action body is a thin `onSelect` wrapper passed in
 * by the caller (it calls the best-effort `refreshStatus()` client fn).
 *
 * Constitution §V (keyboard-first) makes palette reachability mandatory for any
 * new user-facing action — this is the palette parity for the PANE-header refresh
 * button. Labeled around PR/status freshness (scope honesty): the other PANE
 * registers (out/agt/fab) are already fresh within ~7.5s and are not this
 * affordance's promise.
 */

export type StatusRefreshPaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/** Build the single `PR: Refresh Status` palette action. */
export function buildStatusRefreshAction(
  onRefresh: () => void,
): StatusRefreshPaletteAction[] {
  return [
    {
      id: "status-refresh",
      label: "PR: Refresh Status",
      onSelect: onRefresh,
    },
  ];
}
