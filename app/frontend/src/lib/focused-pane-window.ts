import type { ProjectSession, WindowInfo } from "@/types";
import type { FocusedPane } from "@/contexts/focused-pane-context";

/**
 * Pure helpers backing the sidebar PANE panel's board-route fallback
 * (260720-zx4i): resolve the board's focused tile to a live, fully-enriched
 * `WindowInfo` from the streamed sessions — or synthesize a thin one from the
 * board entry's own pane data when the window is absent from the stream
 * (pin-only: the home session died while the window stayed pinned).
 */

/**
 * Find a window by its stable tmux window ID across every session of one
 * server's streamed snapshot. Board pins are LINK-based with dual home+pin
 * membership, so a pinned window's HOME-session copy flows through the normal
 * sessions stream fully enriched (fab/PR/agent registers) — `windowId` is the
 * stable join key. Returns `null` on a miss (pin-only window, or the snapshot
 * has not arrived yet).
 */
export function resolveFocusedWindow(
  sessions: ProjectSession[],
  windowId: string,
): WindowInfo | null {
  for (const session of sessions) {
    for (const win of session.windows) {
      if (win.windowId === windowId) return win;
    }
  }
  return null;
}

/**
 * Synthesize a thin `WindowInfo` from the focused board entry's own data
 * (`windowName` + `panes` — paneId/paneIndex/cwd/command/isActive/gitBranch),
 * for a pin-only window the sessions stream cannot resolve. The identity rows
 * (tmx/cwd/git) and the L0 `out` register render from the pane data; the
 * enrichment-only registers (agt/fab/PR) are honestly absent — they may
 * genuinely be unknown in this state.
 *
 * `activityTimestamp: 0` is deliberate: `getOutputLine` guards on a truthy
 * timestamp, so the `out` register shows the pane command without fabricating
 * an idle-since-epoch duration.
 */
export function thinWindowFromFocusedPane(
  focused: NonNullable<FocusedPane>,
): WindowInfo {
  const active = focused.panes.find((p) => p.isActive) ?? focused.panes[0];
  return {
    windowId: focused.windowId,
    index: 0,
    name: focused.windowName || focused.windowId,
    worktreePath: active?.cwd ?? "",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    panes: focused.panes,
  };
}
