/** A tmux session with its windows and optional fab enrichment. */
export type ProjectSession = {
  name: string;
  byobu: boolean;
  windows: WindowInfo[];
};

/** A single tmux window within a session. */
export type WindowInfo = {
  index: number;
  name: string;
  worktreePath: string;
  activity: "active" | "idle";
  isActiveWindow: boolean;
  fabChange?: string;
  fabStage?: string;
};
