import { describe, it, expect, vi } from "vitest";
import { buildStatusRefreshAction } from "./palette-status-refresh";

describe("buildStatusRefreshAction", () => {
  it("builds the single PR: Refresh Status action", () => {
    const actions = buildStatusRefreshAction(vi.fn());
    expect(actions.map((a) => a.label)).toEqual(["PR: Refresh Status"]);
    expect(actions.map((a) => a.id)).toEqual(["status-refresh"]);
  });

  it("wires onSelect to the supplied refresh callback", () => {
    const onRefresh = vi.fn();
    const [action] = buildStatusRefreshAction(onRefresh);
    action.onSelect();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
