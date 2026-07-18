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
 *  broadcast). `process`/`pid` are best-effort process attribution (lsof on
 *  both darwin and Linux) and absent when attribution is unavailable — e.g. a
 *  root-owned listener invisible to a non-root lsof still appears, bare. */
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
  /** Color value from the `@color` window option — a legacy numeric/blend
   *  descriptor ("4" / "1+3"); the backend only validates/stores this vocabulary
   *  (ValidateColorValue). Family names ("orange") are frontend read aliases that
   *  resolve 1:1 to a family (resolveFamily) — the picker maps them back to the
   *  legacy descriptor at the write seam (familyToLegacy). Drives the row's hue
   *  (label axis). */
  color?: string;
  /** Left-gutter marker state, from the `@rk_marker` window option:
   *  ""/absent (no marker) | "dotted" | "solid" | "double". An INDEPENDENT
   *  label axis from `color` — see docs/specs/themes.md. */
  marker?: string;
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
  /** ISO timestamp (RFC3339) of when the joined PR status was last fetched by
   *  the viewer-wide collector. Collector-join-owned (set on a URL hit, absent
   *  on a miss); surfaced as the StatusDotTip's "checked Xs ago" freshness line. */
  prFetchedAt?: string;
  rkType?: string;
  rkUrl?: string;
  /** Window-level rollup of the panes' `@rk_chat` pane option (active-pane-first,
   *  else first pane). `chatProvider` is the routing key (e.g. `claude`) and the
   *  SOLE gate for every chat affordance in the UI; `chatSessionRef` is the
   *  provider session id. Both are emitted by the backend on every
   *  `/api/sessions` response and SSE `sessions` event (rollupChat,
   *  internal/sessions/sessions.go). Empty/absent = no chat for this window. */
  chatProvider?: string;
  chatSessionRef?: string;
  panes?: PaneInfo[];
};
