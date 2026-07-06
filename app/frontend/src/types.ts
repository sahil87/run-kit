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

/** A single listening TCP service on the host (from the `event: services` SSE
 *  broadcast). v1 is port-only; `process`/`pid` are best-effort and absent when
 *  attribution is unavailable. */
export type Service = {
  port: number;
  process?: string;
  pid?: number;
};

/** Host listening-services snapshot from the backend SSE stream. */
export type ServicesSnapshot = {
  services: Service[];
};

/** A single tmux pane within a window. */
export type PaneInfo = {
  paneId: string;
  paneIndex: number;
  cwd: string;
  command: string;
  isActive: boolean;
  gitBranch?: string;
  /** True when `cwd` no longer exists on disk (e.g. an archived worktree
   *  deleted out from under a still-live pane). The cwd row renders a
   *  "(deleted)" marker when set. */
  cwdMissing?: boolean;
};

/** A tmux session with its windows and optional fab enrichment. */
export type ProjectSession = {
  name: string;
  /** Color value descriptor: "4" for a single ANSI index, "1+3" for a blend. */
  sessionColor?: string;
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
  /** Color value descriptor: "4" for a single ANSI index, "1+3" for a blend. */
  color?: string;
  /** Generic agent-lifecycle state from the `@rk_agent_state` pane option:
   *  `active` (turn in progress) | `waiting` (blocked on a human — permission
   *  prompt / question dialog) | `idle` (at rest). Empty/absent = unknown.
   *  Window-level rollup with precedence `waiting > active > idle`. See
   *  docs/specs/agent-state.md. */
  agentState?: string;
  /** Idle/waiting duration (e.g. `2m`), computed server-side from the option's
   *  epoch for the `idle` and `waiting` states; empty for `active`/unknown. */
  agentIdleDuration?: string;
  fabChange?: string;
  fabStage?: string;
  /** Pipeline state of the displayed stage from `fab pane map` `display_state`
   *  (`active`/`ready`/`done`/`failed`/`pending`/`skipped`); absent when fab
   *  reports null or omits the field (fab < 2.1.7). */
  fabDisplayState?: string;
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
