export interface WindowInfo {
  index: number;
  name: string;
  worktreePath: string;
  activity: "active" | "idle";
  isActiveWindow: boolean;
  fabChange?: string;
  fabStage?: string;
}

export interface ProjectSession {
  name: string;
  windows: WindowInfo[];
}
