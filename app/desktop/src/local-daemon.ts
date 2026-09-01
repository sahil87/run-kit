/**
 * Local-daemon pure logic — rk binary candidate resolution, GUI-PATH
 * augmentation, daemon-status/menu decisions, `rk --version` output parsing,
 * session-count parsing, and rk-invocation error classification. (The
 * per-platform "This Mac"/"This Machine" heading lives inline in welcome.ts,
 * which is deliberately import-free.)
 *
 * Deliberately electron-free (the `hosts.ts` / `window-open.ts` precedent):
 * filesystem access is injected (`exists` predicate) so the module is fully
 * covered by the sibling `local-daemon.test.ts` under plain `node --test`.
 *
 * The impure glue — execFile invocations, health pings, IPC — lives in
 * `main.ts`. The posture is a standing constraint: the shell runs `rk` ONLY
 * for explicit user-initiated actions (`rk daemon` start/stop/restart, the
 * Restart-to-Update menu click's `rk desktop update`) and read-only detection
 * (`rk url`, `rk --version`, `rk daemon status --json`, `rk desktop status`);
 * it never auto-starts the daemon and never auto-updates itself
 * (Constitution VI — viewer shell).
 */

/** Detection result shape returned over the `daemon:status` channel. */
export type DaemonStatus =
  | { installed: false }
  | {
      installed: true;
      state: "stopped" | "wedged";
      /** From `rk --version`, without the leading "v"; null when unparseable. */
      version: string | null;
      /** Config-derived local origin from `rk url` (never hardcoded). */
      origin: string;
    }
  | {
      installed: true;
      state: "running";
      version: string | null;
      origin: string;
      /** Hostname the health ping returned (names the auto-registered entry). */
      hostname: string;
      /** From `GET {origin}/api/sessions`; null when the fetch/parse failed. */
      sessions: number | null;
    };

export type DaemonAction = "start" | "restart" | "stop";

/** Menu-relevant projection of the detected daemon state. */
export interface DaemonMenuInfo {
  state: "running" | "stopped" | "wedged";
  /** Bare version from `rk --version`; null when unparseable. */
  version: string | null;
  /** Explicit lifecycle action currently running, if any. */
  action: DaemonAction | null;
}

export interface DaemonMenuItemModel {
  label: string;
  enabled: boolean;
}

export interface DaemonMenuModel {
  statusLabel: string;
  start: DaemonMenuItemModel;
  restart: DaemonMenuItemModel;
  stop: DaemonMenuItemModel;
}

/**
 * Pure Local Daemon submenu decision. An action in flight overlays the
 * detected state: its item gets progress copy and every lifecycle verb is
 * disabled until the action settles.
 */
export function daemonMenuModel(info: DaemonMenuInfo): DaemonMenuModel {
  const status =
    info.state === "running"
      ? "● running"
      : info.state === "wedged"
        ? "◐ not responding"
        : "○ stopped";
  const versionSuffix = info.version !== null ? ` · v${info.version}` : "";
  const start = { label: info.action === "start" ? "Starting…" : "Start", enabled: false };
  const restart = {
    label: info.action === "restart" ? "Restarting…" : "Restart",
    enabled: false,
  };
  const stop = { label: info.action === "stop" ? "Stopping…" : "Stop", enabled: false };
  if (info.action === null) {
    start.enabled = info.state === "stopped";
    restart.enabled = true;
    stop.enabled = info.state !== "stopped";
  }
  return { statusLabel: `${status}${versionSuffix}`, start, restart, stop };
}

/**
 * Per-platform brew bin directories — the single source behind both the rk
 * binary candidates and the PATH augmentation. Windows has no rk daemon/tmux
 * concept — no dirs, local section suppressed.
 */
function brewBinDirs(platform: string): string[] {
  switch (platform) {
    case "darwin":
      return ["/opt/homebrew/bin", "/usr/local/bin"];
    case "linux":
      return ["/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin"];
    default:
      return [];
  }
}

/**
 * Fixed rk binary candidates per platform, checked BEFORE any PATH lookup:
 * GUI-launched Electron does not inherit the login-shell PATH on macOS (it
 * gets `/usr/bin:/bin:…`), so a Homebrew-installed `rk` never resolves via
 * PATH there. Linux GUI sessions have the same trap for linuxbrew's prefix.
 */
export function rkCandidatePaths(platform: string): string[] {
  return brewBinDirs(platform).map((dir) => `${dir}/rk`);
}

/**
 * Append the platform's brew bin dirs to a PATH when missing — the spawn-site
 * half of the GUI PATH trap: resolving the rk BINARY via `rkCandidatePaths`
 * is not enough, because the spawned rk inherits Electron's GUI PATH
 * (`/usr/bin:/bin:…` on macOS) and its own `exec.LookPath("tmux")` then
 * fails. `main.ts` `runRk` passes the augmented PATH as an env override, and
 * the tmux server tree started by `rk daemon start` inherits it wholesale.
 * Dirs already present are not duplicated; win32/unknown platforms (and a
 * PATH that already carries every dir) pass through unchanged.
 */
export function augmentPath(platform: string, currentPath: string | undefined): string {
  const dirs = brewBinDirs(platform);
  if (dirs.length === 0) return currentPath ?? "";
  const present = new Set((currentPath ?? "").split(":").filter((p) => p !== ""));
  const missing = dirs.filter((dir) => !present.has(dir));
  if (currentPath === undefined || currentPath === "") return missing.join(":");
  if (missing.length === 0) return currentPath;
  // Reuse an existing trailing separator rather than doubling it — "::" is an
  // empty PATH segment, which POSIX resolves as the current directory.
  const separator = currentPath.endsWith(":") ? "" : ":";
  return `${currentPath}${separator}${missing.join(":")}`;
}

/**
 * Resolve the rk binary: first existing fixed candidate, else the bare "rk"
 * PATH fallback (whose absence surfaces as ENOENT at invocation time — the
 * not-installed signal).
 */
export function resolveRkBinary(
  candidates: string[],
  exists: (path: string) => boolean,
): string {
  return candidates.find((candidate) => exists(candidate)) ?? "rk";
}

/**
 * Parse `rk --version` output ("run-kit version v3.12.7") to the bare version
 * ("3.12.7"). Returns null on anything unrecognizable — callers omit the
 * version fragment rather than erroring (it is cosmetic).
 */
export function parseRkVersion(output: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+[^\s]*)/.exec(output);
  return match ? match[1] : null;
}

/**
 * Parse the `GET /api/sessions` response body to a session count. The
 * endpoint returns a JSON array of sessions; anything else is null (the
 * detail line degrades to the origin alone — never an error state).
 */
export function parseSessionCount(body: unknown): number | null {
  return Array.isArray(body) ? body.length : null;
}

/** Parse the read-only `rk daemon status --json` running bit. */
export function parseDaemonStatusRunning(output: string): boolean | null {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("daemon" in value)) return null;
  const daemon = value.daemon;
  if (typeof daemon !== "object" || daemon === null || !("running" in daemon)) return null;
  return typeof daemon.running === "boolean" ? daemon.running : null;
}

/**
 * Classify an `rk daemon start` failure as "daemon already running"
 * (internal/daemon.Start() errors on a live daemon). User intent behind
 * starting is to get in, so this failure mode is already-started SUCCESS —
 * the flow proceeds to the health poll.
 */
export function isDaemonAlreadyRunning(message: string): boolean {
  return /daemon already running/i.test(message);
}

/**
 * Classify an `execFile` rejection as the timeout kill: node enforces the
 * `timeout` option by SIGTERM-killing the child, which surfaces as
 * `signal: "SIGTERM"` with `code: null` (a normal failure carries an exit
 * code and no signal; ENOENT carries the string code "ENOENT"). The
 * raw-callback `execFile` form attaches no `stderr` to the error — unlike
 * the promisified one — so without an explicit branch a timeout surfaces as
 * node's generic "Command failed: /abs/path/rk …" message: a leaked binary
 * path saying nothing about time.
 */
export function isExecTimeout(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const signal = "signal" in err ? err.signal : undefined;
  const code = "code" in err ? err.code : undefined;
  return signal === "SIGTERM" && code === null;
}

function userFacingRkCommand(args: string[]): string {
  const visibleArgs = args.filter((arg) => arg !== "--full");
  return visibleArgs.length === 0 ? "rk" : `rk ${visibleArgs.join(" ")}`;
}

function sanitizeRkFailureText(message: string, binary: string): string {
  let safe = message.trim();
  if (binary !== "rk") safe = safe.split(binary).join("rk");
  safe = safe.replaceAll("--full", "");
  return safe
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+`/g, "`").trimEnd())
    .join("\n")
    .trim();
}

/** The user-facing timeout message — public command label, never private flags or paths. */
export function rkTimeoutMessage(args: string[], timeoutMs: number): string {
  return `\`${userFacingRkCommand(args)}\` timed out after ${Math.round(timeoutMs / 1000)}s`;
}

/** Convert an execFile failure into text that is safe for dialogs and renderer error rows. */
export function rkInvocationErrorMessage(
  err: unknown,
  args: string[],
  timeoutMs: number,
  binary: string,
  callbackStderr?: string,
): string {
  if (isExecTimeout(err)) return rkTimeoutMessage(args, timeoutMs);
  let stderr = callbackStderr?.trim() ?? "";
  if (
    stderr === "" &&
    typeof err === "object" &&
    err !== null &&
    "stderr" in err &&
    typeof err.stderr === "string"
  ) {
    stderr = err.stderr.trim();
  }
  if (stderr !== "") {
    const sanitized = sanitizeRkFailureText(stderr, binary);
    if (sanitized !== "") return sanitized;
  }
  return `\`${userFacingRkCommand(args)}\` failed`;
}
