import { describe, it, expect, vi } from "vitest";
import { buildUpdateActions, buildMaintenanceActions } from "./palette-update";

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

describe("buildMaintenanceActions", () => {
  it("includes both Update Now and Restart Daemon when brew and non-dev", () => {
    const actions = buildMaintenanceActions(true, "0.5.3", vi.fn(), vi.fn());
    expect(actions.map((a) => a.label)).toEqual([
      "run-kit: Update Now",
      "run-kit: Restart Daemon",
    ]);
    expect(actions.map((a) => a.id)).toEqual(["run-kit-force-update", "run-kit-restart"]);
  });

  it("omits Update Now when not a brew install, but keeps Restart Daemon", () => {
    const actions = buildMaintenanceActions(false, "0.5.3", vi.fn(), vi.fn());
    expect(actions.map((a) => a.label)).toEqual(["run-kit: Restart Daemon"]);
  });

  it("omits BOTH entries on the dev version, even when brew is true", () => {
    expect(buildMaintenanceActions(true, "dev", vi.fn(), vi.fn())).toEqual([]);
  });

  it("omits BOTH entries on the dev version when not brew", () => {
    expect(buildMaintenanceActions(false, "dev", vi.fn(), vi.fn())).toEqual([]);
  });

  it("treats a null version (no version event yet) as non-dev: Restart shows, Update Now gated on brew", () => {
    expect(buildMaintenanceActions(false, null, vi.fn(), vi.fn()).map((a) => a.label)).toEqual([
      "run-kit: Restart Daemon",
    ]);
    expect(buildMaintenanceActions(true, null, vi.fn(), vi.fn()).map((a) => a.label)).toEqual([
      "run-kit: Update Now",
      "run-kit: Restart Daemon",
    ]);
  });

  it("wires Update Now to onForceUpdate and Restart Daemon to onRestart", () => {
    const onForceUpdate = vi.fn();
    const onRestart = vi.fn();
    const [update, restart] = buildMaintenanceActions(true, "0.5.3", onForceUpdate, onRestart);

    update.onSelect();
    expect(onForceUpdate).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();

    restart.onSelect();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
