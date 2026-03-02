/** A tmux session with its windows and optional fab enrichment. */
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
