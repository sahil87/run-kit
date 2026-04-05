/** A tmux session with its windows and optional fab enrichment. */
export type ProjectSession = {
  name: string;
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
  agentState?: string;
  agentIdleDuration?: string;
  fabChange?: string;
  fabStage?: string;
};
