import { describe, it, expect, vi } from "vitest";
import {
  mergedWindowKeys,
  buildSelectAllMergedAction,
  buildSelectionMoveActions,
  SELECT_ALL_MERGED_ACTION_ID,
  SELECTION_MOVE_ACTION_PREFIX,
  SELECTION_GESTURE_HINT,
  type SelectableSession,
} from "./palette-selection";

// The builders back the command-palette selection entries wired in app.tsx.
// Covering the merged derivation, hidden-when-ineligible cases, per-session
// entry composition, and label counts proves the behavior without mounting the
// shell — the lib/palette-pin.test.ts precedent.

const SRV = "srv";

function win(
  windowId: string,
  prState?: "open" | "merged" | "closed",
): { windowId: string; prState?: "open" | "merged" | "closed" } {
  return { windowId, prState };
}

const sessions: SelectableSession[] = [
  { name: "work", windows: [win("@1", "merged"), win("@2", "open"), win("@3")] },
  { name: "completed", windows: [win("@4", "merged")] },
];

describe("mergedWindowKeys", () => {
  it("collects composite keys for merged-PR windows across sessions", () => {
    expect(mergedWindowKeys(SRV, sessions)).toEqual(["srv:@1", "srv:@4"]);
  });

  it("ignores open, closed, and PR-less windows", () => {
    const only = [
      { name: "s", windows: [win("@1", "open"), win("@2", "closed"), win("@3")] },
    ];
    expect(mergedWindowKeys(SRV, only)).toEqual([]);
  });

  it("skips a ghost row with an empty windowId", () => {
    const withGhost = [{ name: "s", windows: [win("", "merged"), win("@2", "merged")] }];
    expect(mergedWindowKeys(SRV, withGhost)).toEqual(["srv:@2"]);
  });
});

describe("buildSelectAllMergedAction", () => {
  it("emits a single action whose label carries the live merged count", () => {
    const action = buildSelectAllMergedAction(SRV, sessions, vi.fn());
    expect(action).not.toBeNull();
    expect(action!.id).toBe(SELECT_ALL_MERGED_ACTION_ID);
    expect(action!.label).toBe("Selection: Select all merged (2)");
  });

  it("passes exactly the merged keys to the callback", () => {
    const onSelectAll = vi.fn();
    buildSelectAllMergedAction(SRV, sessions, onSelectAll)!.onSelect();
    expect(onSelectAll).toHaveBeenCalledWith(["srv:@1", "srv:@4"]);
  });

  it("is omitted (null) when there is no current-server context", () => {
    expect(buildSelectAllMergedAction(null, sessions, vi.fn())).toBeNull();
  });

  it("is omitted (null) when the server has no merged windows", () => {
    const none = [{ name: "s", windows: [win("@1", "open")] }];
    expect(buildSelectAllMergedAction(SRV, none, vi.fn())).toBeNull();
  });
});

describe("buildSelectionMoveActions", () => {
  it("emits one entry per session in display order, with the live count", () => {
    const actions = buildSelectionMoveActions(
      SRV,
      sessions,
      new Set(["srv:@1", "srv:@4"]),
      vi.fn(),
    );
    expect(actions.map((a) => a.label)).toEqual([
      "Selection: Move 2 windows to work",
      "Selection: Move 2 windows to completed",
    ]);
    expect(actions[0].id).toBe(`${SELECTION_MOVE_ACTION_PREFIX}work`);
  });

  it("uses the singular noun for a one-window selection", () => {
    const actions = buildSelectionMoveActions(SRV, sessions, new Set(["srv:@1"]), vi.fn());
    expect(actions.map((a) => a.label)).toEqual([
      "Selection: Move 1 window to completed",
    ]);
  });

  it("excludes the target that would be a complete no-op", () => {
    // @1 and @2 both live in `work`, so moving them to `work` changes nothing.
    const actions = buildSelectionMoveActions(
      SRV,
      sessions,
      new Set(["srv:@1", "srv:@2"]),
      vi.fn(),
    );
    expect(actions.map((a) => a.label)).toEqual([
      "Selection: Move 2 windows to completed",
    ]);
  });

  it("keeps every target when the selection spans multiple sessions", () => {
    const actions = buildSelectionMoveActions(
      SRV,
      sessions,
      new Set(["srv:@1", "srv:@4"]),
      vi.fn(),
    );
    expect(actions).toHaveLength(2);
  });

  it("returns [] for an empty selection", () => {
    expect(buildSelectionMoveActions(SRV, sessions, new Set(), vi.fn())).toEqual([]);
  });

  it("returns [] for a cross-server selection (tmux cannot move across servers)", () => {
    const actions = buildSelectionMoveActions(
      SRV,
      sessions,
      new Set(["srv:@1", "other:@1"]),
      vi.fn(),
    );
    expect(actions).toEqual([]);
  });

  it("passes the chosen target session to the callback", () => {
    const onMove = vi.fn();
    const actions = buildSelectionMoveActions(SRV, sessions, new Set(["srv:@1"]), onMove);
    actions[0].onSelect();
    expect(onMove).toHaveBeenCalledWith("completed");
  });

  // ── cross-server derivation (rework cycle 1, review must-fix 1) ───────────
  // With sessions scope "all" the sidebar paints every server's groups, so a
  // user can select rows on server A while routed to server B. tmux window ids
  // (`@N`) are unique per SERVER only, so the target list and the move must both
  // key off the SELECTION's server. The original wiring passed the ROUTE
  // server's list; `sessionsServer` now names whose sessions the caller passed
  // and a mismatch is refused outright.
  describe("cross-server derivation", () => {
    const otherSessions: SelectableSession[] = [
      { name: "staging", windows: [win("@1"), win("@2")] },
      { name: "archive", windows: [] },
    ];

    it("builds targets from the selection's OWN server when the caller agrees", () => {
      // Selection and sessions are both `other`. Both windows live in `staging`,
      // so `staging` is the complete no-op target and only `archive` is offered.
      const actions = buildSelectionMoveActions(
        "other",
        otherSessions,
        new Set(["other:@1", "other:@2"]),
        vi.fn(),
      );
      expect(actions.map((a) => a.label)).toEqual([
        "Selection: Move 2 windows to archive",
      ]);
    });

    it("returns [] when handed a DIFFERENT server's sessions than the selection", () => {
      // The regression shape: selection on `other`, sessions from `srv`. Rather
      // than re-key `srv`'s windows under `other:` and emit plausible-looking
      // targets, the mismatch guard offers nothing at all.
      const actions = buildSelectionMoveActions(
        SRV,
        sessions,
        new Set(["other:@1", "other:@4"]),
        vi.fn(),
      );
      expect(actions).toEqual([]);
    });

    it("does not treat a same-id window on another server as the selection's own", () => {
      // `srv:@1` lives in `work`. Selecting `other:@1` — the SAME tmux id on a
      // different server — must not inherit that home, nor offer srv's sessions.
      const actions = buildSelectionMoveActions(
        SRV,
        sessions,
        new Set(["other:@1"]),
        vi.fn(),
      );
      expect(actions).toEqual([]);
    });

    it("still offers every target when the selection's own server has no id overlap", () => {
      // Selection on `other`, sessions on `other`, but the selected id lives in
      // neither session (a row that has since left the tree). Nothing resolves,
      // so no target is excluded — the move stays meaningful.
      const actions = buildSelectionMoveActions(
        "other",
        otherSessions,
        new Set(["other:@99"]),
        vi.fn(),
      );
      expect(actions.map((a) => a.label)).toEqual([
        "Selection: Move 1 window to staging",
        "Selection: Move 1 window to archive",
      ]);
    });
  });

  it("documents the selection gestures on the select-all entry's shortcut badge", () => {
    // The project review rule requires new keyboard shortcuts to be documented
    // at the palette registration; `x` is a bare tree key that appears on no
    // chord map (review should-fix 3).
    const action = buildSelectAllMergedAction(SRV, sessions, vi.fn());
    expect(action!.shortcut).toBe(SELECTION_GESTURE_HINT);
    expect(action!.shortcut).toContain("x");
  });
});
