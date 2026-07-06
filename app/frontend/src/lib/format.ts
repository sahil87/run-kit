/** Format elapsed seconds as Ns (<60), Nm (60-3599), or Nh (>=3600) using floor division. */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0s";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/** Parse fabChange folder name into 4-char ID and slug. */
export function parseFabChange(fabChange: string): { id: string; slug: string } | null {
  if (!fabChange) return null;
  // Format: "260313-txna-rich-sidebar-window-status"
  // id = substring(7, 11) → "txna"
  // slug = everything after second dash
  const secondDash = fabChange.indexOf("-", fabChange.indexOf("-") + 1);
  if (secondDash < 0 || fabChange.length < 11) return null;
  return {
    id: fabChange.substring(7, 11),
    slug: fabChange.substring(secondDash + 1),
  };
}

// `getWindowDuration` was removed with Row Minimalism (260706-y1ar): the window
// row no longer renders a duration, and it was its only caller. The PANE panel
// composes its own `output`/`agent` register durations directly from
// `activityTimestamp` / `agentIdleDuration` (see status-panel.tsx). `formatDuration`
// remains — still used there and by the backend-parity duration formatting.
