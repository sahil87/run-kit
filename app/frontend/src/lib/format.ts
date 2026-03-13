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

/** Get display duration for an idle window. Returns empty string for active windows. */
export function getWindowDuration(win: { activity: string; agentState?: string; agentIdleDuration?: string; activityTimestamp: number }, nowSeconds: number): string {
  if (win.activity === "active") return "";

  // Fab windows with known agent state
  if (win.agentState === "idle" && win.agentIdleDuration) {
    return win.agentIdleDuration;
  }

  // Unknown agent state or non-fab: fall back to activityTimestamp
  if (win.agentState !== "active" && win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) return formatDuration(elapsed);
  }

  return "";
}
