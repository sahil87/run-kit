/** Host-level system metrics snapshot from the backend SSE stream. */
export type MetricsSnapshot = {
  hostname: string;
  cpu: {
    samples: number[]; // ring buffer, 60 entries
    current: number;   // latest percentage 0-100
    cores: number;     // logical CPU count
  };
  memory: {
    used: number;  // bytes
    total: number; // bytes
  };
  load: {
    avg1: number;
    avg5: number;
    avg15: number;
    cpus: number;
  };
  disk: {
    used: number;  // bytes
    total: number; // bytes
  };
  uptime: number; // seconds
};

/** A single tmux pane within a window. */
export type PaneInfo = {
  paneId: string;
  paneIndex: number;
  cwd: string;
  command: string;
  isActive: boolean;
  gitBranch?: string;
};

/** A tmux session with its windows and optional fab enrichment. */
export type ProjectSession = {
  name: string;
  sessionColor?: number;
  windows: WindowInfo[];
};

/** A single tmux window within a session. */
export type WindowInfo = {
  windowId: string;
  index: number;
  name: string;
  worktreePath: string;
  activity: "active" | "idle";
  isActiveWindow: boolean;
  paneCommand?: string;
  activityTimestamp: number;
  color?: number;
  agentState?: string;
  agentIdleDuration?: string;
  fabChange?: string;
  fabStage?: string;
  /** PR URL / number from `fab pane map` (Layer 1 — filesystem, cheap). */
  prUrl?: string;
  prNumber?: number;
  /** Live PR status from the in-memory prstatus collector (Layer 3 — attached
   *  by the SSE hub only for change-bound windows). */
  prState?: "open" | "merged" | "closed";
  prChecks?: "pass" | "fail" | "pending" | "none";
  prReview?: "approved" | "changes_requested" | "review_required" | "none";
  prIsDraft?: boolean;
  rkType?: string;
  rkUrl?: string;
  panes?: PaneInfo[];
};
