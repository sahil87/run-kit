import type { ProjectSession, WindowInfo } from "@/types";

/** Shared vitest fixture factories (tests-only — imported per-test, never
 *  registered in `vitest.config.ts` `setupFiles`). One canonical default set;
 *  callers spread-override any field they assert on. */

/** Build a `WindowInfo` with canonical defaults. */
export function makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "zsh",
    worktreePath: "/home/user",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

/** Build a `ProjectSession` with one canonical window. */
export function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    name: "alpha",
    windows: overrides.windows ?? [makeWindow()],
    ...overrides,
  };
}

/** Build a `WindowInfo` carrying one active pane (cwd/git-branch surface). */
export function makeWindowWithPanes(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return makeWindow({
    worktreePath: "/home/user/code/run-kit",
    panes: [
      {
        paneId: "%5",
        paneIndex: 0,
        cwd: "/home/user/code/run-kit",
        command: "zsh",
        isActive: true,
        gitBranch: "main",
      },
    ],
    ...overrides,
  });
}
