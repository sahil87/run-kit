/** A tmux session mapped to a configured project (or "Other"). */
export type ProjectSession = {
  name: string;
  windows: WindowInfo[];
};

/** A single tmux window within a session. */
export type WindowInfo = {
  index: number;
  name: string;
  worktreePath: string;
  activity: "active" | "idle";
  fabStage?: string;
  fabProgress?: string;
};

/** A single project entry from run-kit.yaml. */
export type ProjectConfig = {
  path: string;
  fab_kit?: boolean;
};

/** Top-level run-kit.yaml config. */
export type Config = {
  projects: Record<string, ProjectConfig>;
};

/** Options for execFile-based tmux calls. */
export type TmuxExecOptions = {
  /** Timeout in milliseconds (default: 10_000 for tmux ops). */
  timeout?: number;
};

/** Tmux exec timeout defaults (milliseconds). */
export const TMUX_TIMEOUT = 10_000;
export const BUILD_TIMEOUT = 30_000;

/** Activity threshold: window active if last activity within this many seconds. */
export const ACTIVITY_THRESHOLD_SECONDS = 10;

/** Ports. */
export const NEXTJS_PORT = 3000;
export const RELAY_PORT = 3001;

/** SSE polling interval (milliseconds). */
export const SSE_POLL_INTERVAL = 2500;
