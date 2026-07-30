/**
 * Local-daemon pure logic — rk binary candidate resolution, `rk --version`
 * output parsing, session-count parsing, and already-running error
 * classification. (The per-platform "This Mac"/"This Machine" heading lives
 * inline in welcome.ts, which is deliberately import-free.)
 *
 * Deliberately electron-free (the `servers.ts` / `window-open.ts` precedent):
 * filesystem access is injected (`exists` predicate) so the module is fully
 * covered by the sibling `local-daemon.test.ts` under plain `node --test`.
 *
 * The impure glue — execFile invocations, health pings, IPC — lives in
 * `main.ts`. The posture is a standing constraint: the shell runs `rk` ONLY
 * for explicit user-initiated daemon actions and read-only detection; it
 * never auto-starts the daemon (Constitution VI — viewer shell).
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
 * Fixed rk binary candidates per platform, checked BEFORE any PATH lookup:
 * GUI-launched Electron does not inherit the login-shell PATH on macOS (it
 * gets `/usr/bin:/bin:…`), so a Homebrew-installed `rk` never resolves via
 * PATH there. Linux GUI sessions have the same trap for linuxbrew's prefix.
 * Windows has no rk daemon/tmux concept — no candidates, section suppressed.
 */
export function rkCandidatePaths(platform: string): string[] {
  switch (platform) {
    case "darwin":
      return ["/opt/homebrew/bin/rk", "/usr/local/bin/rk"];
    case "linux":
      return ["/home/linuxbrew/.linuxbrew/bin/rk", "/usr/local/bin/rk"];
    default:
      return [];
  }
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
