import { access } from "node:fs/promises";
import { join } from "node:path";
import { listSessions, listWindows } from "./tmux";
import { getStatus, getCurrentChange } from "./fab";
import type { ProjectSession, WindowInfo } from "./types";

/** Check if a project root contains a fab-kit project (fab/project/config.yaml exists). */
async function hasFabKit(projectRoot: string): Promise<boolean> {
  try {
    await access(join(projectRoot, "fab/project/config.yaml"));
    return true;
  } catch {
    return false;
  }
}

/** Enrich a single window with fab state. */
async function enrichWindow(
  win: WindowInfo,
  projectRoot: string,
): Promise<void> {
  const fabPath = win.worktreePath || projectRoot;
  const change = await getCurrentChange(fabPath);
  if (change) {
    win.fabStage = change;
    const progress = await getStatus(fabPath);
    if (progress) {
      win.fabProgress = progress;
    }
  }
}

/** Fetch all sessions, derive project roots from tmux, enrich with fab state. */
export async function fetchSessions(): Promise<ProjectSession[]> {
  const sessions = await listSessions();

  // Fetch windows for all sessions in parallel
  const sessionWindows = await Promise.all(
    sessions.map(async (sessionName) => ({
      sessionName,
      windows: await listWindows(sessionName),
    })),
  );

  // Enrich all sessions in parallel, preserve tmux ordering via indexed assignment
  const result: ProjectSession[] = new Array(sessionWindows.length);

  await Promise.all(
    sessionWindows.map(async ({ sessionName, windows }, i) => {
      const projectRoot = windows[0]?.worktreePath ?? "";

      if (projectRoot && (await hasFabKit(projectRoot))) {
        await Promise.all(
          windows.map((win) => enrichWindow(win, projectRoot)),
        );
      }

      result[i] = { name: sessionName, windows };
    }),
  );

  return result;
}
