import { listSessions, listWindows } from "./tmux";
import { getStatus, getCurrentChange } from "./fab";
import { getConfig, getProjectNames } from "./config";
import type { ProjectSession, WindowInfo } from "./types";

const OTHER_GROUP = "Other";

/** Fetch all sessions, map to projects, enrich with fab state. */
export async function fetchSessions(): Promise<ProjectSession[]> {
  const config = getConfig();
  const projectNames = getProjectNames();
  const sessions = await listSessions();

  const grouped: Record<string, WindowInfo[]> = {};
  for (const name of projectNames) {
    grouped[name] = [];
  }

  for (const sessionName of sessions) {
    const windows = await listWindows(sessionName);
    const projectConfig = config.projects[sessionName];

    // Enrich with fab state if project has fab_kit enabled
    if (projectConfig?.fab_kit) {
      const resolvedPath = projectConfig.path.replace(
        /^~/,
        process.env.HOME ?? "",
      );
      for (const win of windows) {
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
    }

    if (projectNames.includes(sessionName)) {
      grouped[sessionName] = windows;
    } else {
      if (!grouped[OTHER_GROUP]) {
        grouped[OTHER_GROUP] = [];
      }
      // For "Other" sessions, prefix window names with session name for clarity
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
