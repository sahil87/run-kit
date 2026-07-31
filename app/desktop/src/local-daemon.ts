/**
 * Local-daemon pure logic — rk binary candidate resolution, GUI-PATH
 * augmentation, `rk --version` output parsing, session-count parsing, and
 * already-running error classification. (The per-platform "This Mac"/"This
 * Machine" heading lives inline in welcome.ts, which is deliberately
 * import-free.)
 *
 * Deliberately electron-free (the `hosts.ts` / `window-open.ts` precedent):
 * filesystem access is injected (`exists` predicate) so the module is fully
 * covered by the sibling `local-daemon.test.ts` under plain `node --test`.
 *
 * The impure glue — execFile invocations, health pings, IPC — lives in
 * `main.ts`. The posture is a standing constraint: the shell runs `rk` ONLY
 * for explicit user-initiated actions (`rk daemon` start/stop/restart, the
 * Restart-to-Update menu click's `rk desktop update`) and read-only detection
 * (`rk url`, `rk --version`, `rk desktop status`); it never auto-starts the
 * daemon and never auto-updates itself (Constitution VI — viewer shell).
 */

/** Detection result shape returned over the `daemon:status` channel. */
export type DaemonStatus =
  | { installed: false }
  | {
      installed: true;
      running: false;
      /** From `rk --version`, without the leading "v"; null when unparseable. */
      version: string | null;
      /** Config-derived local origin from `rk url` (never hardcoded). */
      origin: string;
    }
  | {
      installed: true;
      running: true;
      version: string | null;
      origin: string;
      /** Hostname the health ping returned (names the auto-registered entry). */
      hostname: string;
      /** From `GET {origin}/api/sessions`; null when the fetch/parse failed. */
      sessions: number | null;
    };

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

/**
 * Classify an `rk daemon start` failure as "daemon already running"
 * (internal/daemon.Start() errors on a live daemon). User intent behind
 * starting is to get in, so this failure mode is already-started SUCCESS —
 * the flow proceeds to the health poll.
 */
export function isDaemonAlreadyRunning(message: string): boolean {
  return /daemon already running/i.test(message);
}
