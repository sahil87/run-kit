import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { BUILD_TIMEOUT } from "./types";

const execFile = promisify(execFileCb);

/** Create a new worktree via wt-create. */
export async function create(name: string, branch?: string): Promise<string> {
  const args = ["--non-interactive", "--worktree-name", name];
  if (branch) args.push(branch);

  const { stdout } = await execFile("wt-create", args, {
    timeout: BUILD_TIMEOUT,
  });
  return stdout.trim();
}

/** List all worktrees via wt-list. */
export async function list(): Promise<string> {
  const { stdout } = await execFile("wt-list", [], { timeout: BUILD_TIMEOUT });
  return stdout.trim();
}

/** Delete a worktree via wt-delete. */
export async function remove(name: string): Promise<string> {
  const { stdout } = await execFile("wt-delete", [name], {
    timeout: BUILD_TIMEOUT,
  });
  return stdout.trim();
}

/** Open a worktree via wt-open. */
export async function open(name: string): Promise<string> {
  const { stdout } = await execFile("wt-open", [name], {
    timeout: BUILD_TIMEOUT,
  });
  return stdout.trim();
}
