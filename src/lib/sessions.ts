import { listSessions, listWindows } from "./tmux";
import { getStatus, getCurrentChange } from "./fab";
import { getConfig, getProjectNames } from "./config";
import type { ProjectSession, WindowInfo } from "./types";

const OTHER_GROUP = "Other";

/** Enrich a single window with fab state. */
async function enrichWindow(
  win: WindowInfo,
  resolvedPath: string,
): Promise<void> {
  const fabPath = win.worktreePath || resolvedPath;
  const change = await getCurrentChange(fabPath);
  if (change) {
    win.fabStage = change;
    const progress = await getStatus(fabPath);
    if (progress) {
      win.fabProgress = progress;
    }
  }
}

/** Fetch all sessions, map to projects, enrich with fab state. */
export async function fetchSessions(): Promise<ProjectSession[]> {
  const config = getConfig();
  const projectNames = getProjectNames();
  const sessions = await listSessions();

  const grouped: Record<string, WindowInfo[]> = {};
  for (const name of projectNames) {
    grouped[name] = [];
  }

  // Fetch windows for all sessions in parallel
  const sessionWindows = await Promise.all(
    sessions.map(async (sessionName) => ({
      sessionName,
      windows: await listWindows(sessionName),
    })),
  );

  for (const { sessionName, windows } of sessionWindows) {
    const projectConfig = config.projects[sessionName];

    // Enrich with fab state if project has fab_kit enabled (parallel per window)
    if (projectConfig?.fab_kit) {
      const resolvedPath = projectConfig.path.replace(
        /^~/,
        process.env.HOME ?? "",
      );
      await Promise.all(
        windows.map((win) => enrichWindow(win, resolvedPath)),
      );
    }

    if (projectNames.includes(sessionName)) {
      grouped[sessionName] = windows;
    } else {
      if (!grouped[OTHER_GROUP]) {
        grouped[OTHER_GROUP] = [];
      }
      grouped[OTHER_GROUP].push(...windows);
    }
  }

  // Build result: configured projects first (in config order), then "Other" if it has windows
  const result: ProjectSession[] = [];

  for (const name of projectNames) {
    result.push({ name, windows: grouped[name] });
  }

  if (grouped[OTHER_GROUP]?.length) {
    result.push({ name: OTHER_GROUP, windows: grouped[OTHER_GROUP] });
  }

  return result;
}
