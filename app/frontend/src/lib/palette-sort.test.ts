import { describe, it, expect, vi } from "vitest";
import { buildSessionSortActions } from "./palette-sort";

// Backs the `Session: Sort windows by status/created` palette entries. app.tsx
// folds the builder output into the session group, so covering the gating and
// the pinned ids/labels here proves the entries' shape without mounting the
// shell.

describe("buildSessionSortActions", () => {
  it("returns [] without a current session (entries omitted, not disabled)", () => {
    expect(buildSessionSortActions(null, vi.fn())).toEqual([]);
    expect(buildSessionSortActions("", vi.fn())).toEqual([]);
  });

  it("pins the two ids and labels with a current session", () => {
    const actions = buildSessionSortActions("work", vi.fn());
    expect(actions.map((a) => [a.id, a.label])).toEqual([
      ["session-sort-windows-status", "Session: Sort windows by status"],
      ["session-sort-windows-created", "Session: Sort windows by created"],
    ]);
  });

  it("routes onSelect to onSort with the entry's key", () => {
    const onSort = vi.fn();
    const [status, created] = buildSessionSortActions("work", onSort);
    status.onSelect();
    created.onSelect();
    expect(onSort.mock.calls).toEqual([["status"], ["created"]]);
  });
});
