import { describe, it, expect, vi } from "vitest";
import { buildUpdateActions } from "./palette-update";

describe("buildUpdateActions", () => {
  it("returns no actions when no update qualifies", () => {
    expect(buildUpdateActions(false, "0.6.0", vi.fn(), vi.fn())).toEqual([]);
  });

  it("returns no actions when latest is null", () => {
    expect(buildUpdateActions(true, null, vi.fn(), vi.fn())).toEqual([]);
  });

  it("builds the Update + Dismiss actions with the latest version in the label", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const actions = buildUpdateActions(true, "0.6.0", onUpdate, onDismiss);

    expect(actions.map((a) => a.label)).toEqual([
      "run-kit: Update to v0.6.0",
      "run-kit: Dismiss Update Notice",
    ]);
    expect(actions.map((a) => a.id)).toEqual(["run-kit-update", "run-kit-dismiss-update"]);
  });

  it("wires the update action to onUpdate and dismiss to onDismiss", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const [update, dismiss] = buildUpdateActions(true, "0.6.0", onUpdate, onDismiss);

    update.onSelect();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    dismiss.onSelect();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("qualifies independently of chip dismissal (palette ignores dismissal)", () => {
    // The builder gates on `qualifies` only — there is no dismissal parameter,
    // so a dismissed chip still yields palette actions when qualifies is true.
    const actions = buildUpdateActions(true, "0.7.0", vi.fn(), vi.fn());
    expect(actions).toHaveLength(2);
    expect(actions[0].label).toBe("run-kit: Update to v0.7.0");
  });
});
