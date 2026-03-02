import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { WindowInfo, TmuxExecOptions } from "./types";
import { TMUX_TIMEOUT, ACTIVITY_THRESHOLD_SECONDS } from "./types";

const execFile = promisify(execFileCb);

const TMUX = "tmux";

/** Run a tmux command with execFile + timeout. Returns stdout lines (empty lines filtered). */
async function tmuxExec(
  args: string[],
  opts?: TmuxExecOptions,
): Promise<string[]> {
  const timeout = opts?.timeout ?? TMUX_TIMEOUT;
  const { stdout } = await execFile(TMUX, args, { timeout });
  return stdout.trim().split("\n").filter(Boolean);
}

/** Run a tmux command preserving all output lines (including blank). */
async function tmuxExecRaw(
  args: string[],
  opts?: TmuxExecOptions,
): Promise<string> {
  const timeout = opts?.timeout ?? TMUX_TIMEOUT;
  const { stdout } = await execFile(TMUX, args, { timeout });
  return stdout;
}

/** List all tmux session names. Returns [] if tmux server is not running. */
export async function listSessions(): Promise<string[]> {
  try {
    return await tmuxExec(["list-sessions", "-F", "#{session_name}"]);
  } catch {
    // tmux not running or no sessions — return empty
    return [];
  }
}

/** List windows for a given session. Returns [] if session does not exist. */
export async function listWindows(session: string): Promise<WindowInfo[]> {
  const format =
    "#{window_index}:#{window_name}:#{pane_current_path}:#{window_activity}";
  let lines: string[];
  try {
    lines = await tmuxExec(["list-windows", "-t", session, "-F", format]);
  } catch {
    return [];
  }

  const now = Math.floor(Date.now() / 1000);

  return lines.map((line) => {
    const parts = line.split(":");
    // window_activity is a unix timestamp — the last field
    // pane_current_path may contain colons (e.g., /home/user), so rejoin middle parts
    const index = parseInt(parts[0], 10);
    const activityTs = parseInt(parts[parts.length - 1], 10);
    const name = parts[1];
    // Everything between name and activity timestamp is the path
    const worktreePath = parts.slice(2, -1).join(":");

    const activity: WindowInfo["activity"] =
      now - activityTs <= ACTIVITY_THRESHOLD_SECONDS ? "active" : "idle";

    return { index, name, worktreePath, activity };
  });
}

/** Create a new detached tmux session. */
export async function createSession(name: string): Promise<void> {
  await tmuxExec(["new-session", "-d", "-s", name]);
}

/** Create a new window in an existing session. */
export async function createWindow(
  session: string,
  name: string,
  cwd: string,
): Promise<void> {
  await tmuxExec(["new-window", "-t", session, "-n", name, "-c", cwd]);
}

/** Kill a window by session and index. */
export async function killWindow(
  session: string,
  index: number,
): Promise<void> {
  await tmuxExec(["kill-window", "-t", `${session}:${index}`]);
}

/** Send keystrokes to a tmux window. */
export async function sendKeys(
  session: string,
  window: number,
  keys: string,
): Promise<void> {
  await tmuxExec([
    "send-keys",
    "-t",
    `${session}:${window}`,
    keys,
    "Enter",
  ]);
}

/** Split a window to create an independent pane. Returns the new pane ID. */
export async function splitPane(
  session: string,
  window: number,
): Promise<string> {
  const lines = await tmuxExec([
    "split-window",
    "-t",
    `${session}:${window}`,
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  return lines[0];
}

/** Kill a specific pane by ID. */
export async function killPane(paneId: string): Promise<void> {
  try {
    await tmuxExec(["kill-pane", "-t", paneId]);
  } catch {
    // Pane may already be dead — ignore
  }
}

/** Capture pane content (last N lines). Preserves blank lines. */
export async function capturePane(
  paneId: string,
  lines: number = 50,
): Promise<string> {
  const start = -lines;
  return tmuxExecRaw([
    "capture-pane",
    "-t",
    paneId,
    "-p",
    "-S",
    String(start),
  ]);
}
