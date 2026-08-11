/**
 * Shared tmux fixture helpers for e2e specs.
 *
 * Every spec that seeds real tmux state uses the same lifecycle: create a
 * detached 80x24 session on the isolated e2e server in `beforeAll`, tear it
 * down in `afterAll`. These helpers centralize that lifecycle (plus the named
 * window / per-window idle-command / second-server variants) so a teardown or
 * targeting fix lands in one place instead of ~35 copies.
 *
 * TARGETING: window-scoped tmux commands (`new-window`, `list-windows`) treat
 * a bare `-t <name>` as a WINDOW target — a window named like the session
 * hijacks it (creation lands in the wrong session, index-joins show wrong
 * panes). All targets here use the `=name` exact-match session form
 * (`=name:` where the command takes a target-window) — never bare `-t name`.
 *
 * All subprocess calls use `execFileSync` with argument arrays — no shell
 * string construction, so window names and idle commands need no quoting.
 * A window `command` is passed through as a single tmux argument; tmux runs
 * it via `sh -c`, exactly as the previous shell-string copies did.
 */
import { execFileSync } from "node:child_process";

/** The isolated tmux server socket the e2e suite runs against. */
export const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

export interface TmuxOptions {
  /** tmux server socket name (`tmux -L`); defaults to {@link TMUX_SERVER}. */
  server?: string;
}

/** A named window to create, optionally running `command` in its pane
 *  (e.g. an idle `sh -c 'sleep 300'` keeping the pane stable). */
export interface WindowSpec {
  name: string;
  command?: string;
}

/** Run a tmux command against the given server and return its stdout.
 *  Throws on non-zero exit (with tmux's stderr appended to the message) —
 *  lifecycle helpers wrap this in best-effort try/catch; mid-test callers
 *  usually want the error. Module-private: specs use the named helpers. */
function tmux(args: string[], opts: TmuxOptions = {}): string {
  try {
    return execFileSync("tmux", ["-L", opts.server ?? TMUX_SERVER, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    if (err instanceof Error && stderr) err.message += `\ntmux: ${stderr}`;
    throw err;
  }
}

export interface CreateSessionOptions extends TmuxOptions {
  /** Named windows to create: the first via `new-session -n`, the rest via
   *  `new-window`, in order. Strings are shorthand for `{ name }`. Omit for
   *  a single default-named window (plain `new-session`). */
  windows?: Array<string | WindowSpec>;
}

/**
 * Create a detached 80x24 session, pre-killing any leftover session with the
 * same name. Best-effort (failures are swallowed), matching the try/catch
 * pattern the per-spec copies used — a genuinely broken tmux surfaces in the
 * test body instead.
 */
export function createSession(
  session: string,
  opts: CreateSessionOptions = {},
): void {
  killSession(session, opts);
  const windows = (opts.windows ?? []).map((w) =>
    typeof w === "string" ? { name: w } : w,
  );
  try {
    const [first, ...rest] = windows;
    const args = ["new-session", "-d", "-s", session, "-x", "80", "-y", "24"];
    if (first) {
      args.push("-n", first.name);
      if (first.command) args.push(first.command);
    }
    tmux(args, opts);
    for (const w of rest) {
      newWindow(session, w.name, { server: opts.server, command: w.command });
    }
  } catch {
    // Best-effort — matches the copied per-file pattern.
  }
}

/** Best-effort `kill-session` — an already-gone session does not throw. */
export function killSession(session: string, opts: TmuxOptions = {}): void {
  try {
    tmux(["kill-session", "-t", `=${session}`], opts);
  } catch {
    // Best-effort.
  }
}

/** Best-effort `kill-server` — teardown for scratch second servers (A/B
 *  specs). Only ever aim this at a spec-created scratch socket. */
export function killServer(server: string): void {
  try {
    tmux(["kill-server"], { server });
  } catch {
    // Best-effort — server may already be gone.
  }
}

export interface NewWindowOptions extends TmuxOptions {
  /** Shell command for the new window's pane (tmux runs it via `sh -c`). */
  command?: string;
  /** Start directory for the new window's pane (tmux `-c`) — e.g. `/tmp` for
   *  a NON-repo cwd (the code-surface spec's availability-negative case). */
  cwd?: string;
}

/** Create a named window in `session` (exact-match target). Throws on
 *  failure — mid-test callers should see the error. */
export function newWindow(
  session: string,
  name: string,
  opts: NewWindowOptions = {},
): void {
  const args = ["new-window", "-t", `=${session}:`, "-n", name];
  if (opts.cwd) args.push("-c", opts.cwd);
  if (opts.command) args.push(opts.command);
  tmux(args, opts);
}

/** Synchronously list a session's windows (tmux-side truth, index order).
 *  Replaces the per-spec `list-windows -F` parse copies. */
export function listWindows(
  session: string,
  opts: TmuxOptions = {},
): Array<{ windowId: string; name: string }> {
  const out = tmux(
    ["list-windows", "-t", `=${session}`, "-F", "#{window_id}\t#{window_name}"],
    opts,
  ).trim();
  if (!out) return [];
  return out.split("\n").map((line) => {
    const tab = line.indexOf("\t");
    return { windowId: line.slice(0, tab), name: line.slice(tab + 1) };
  });
}
