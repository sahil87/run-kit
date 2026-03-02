import { execFile as execFileCb } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { TMUX_TIMEOUT } from "./types";

const execFile = promisify(execFileCb);

/** Get fab progress line for a worktree. Returns null if no active change. */
export async function getStatus(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      "bash",
      [
        join(worktreePath, "fab/.kit/scripts/lib/statusman.sh"),
        "progress-line",
        // statusman reads fab/current internally
      ],
      { timeout: TMUX_TIMEOUT, cwd: worktreePath },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Get the current active change name for a worktree. Returns null if none. */
export async function getCurrentChange(
  worktreePath: string,
): Promise<string | null> {
  try {
    const content = await readFile(
      join(worktreePath, "fab/current"),
      "utf-8",
    );
    return content.trim() || null;
  } catch {
    return null;
  }
}

/** List all changes in a worktree. Returns raw changeman output. */
export async function listChanges(
  worktreePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      "bash",
      [join(worktreePath, "fab/.kit/scripts/lib/changeman.sh"), "list"],
      { timeout: TMUX_TIMEOUT, cwd: worktreePath },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
