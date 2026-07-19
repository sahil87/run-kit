import { describe, it, expect, vi } from "vitest";
import {
  buildUpdateActions,
  buildMaintenanceActions,
  updateChipToolSummary,
} from "./palette-update";

const runKitOnly = [{ tool: "run-kit", current: "3.8.0", latest: "3.9.0" }];

describe("buildUpdateActions", () => {
  it("returns no actions when no update qualifies", () => {
    expect(buildUpdateActions(false, runKitOnly, vi.fn(), vi.fn())).toEqual([]);
  });

  it("returns no actions when tools is empty", () => {
    expect(buildUpdateActions(true, [], vi.fn(), vi.fn())).toEqual([]);
  });

  it("builds the Update + Dismiss actions with the run-kit latest in the label (single run-kit)", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const actions = buildUpdateActions(true, runKitOnly, onUpdate, onDismiss);

    expect(actions.map((a) => a.label)).toEqual([
      "run-kit: Update to v3.9.0",
      "run-kit: Dismiss Update Notice",
    ]);
    expect(actions.map((a) => a.id)).toEqual(["run-kit-update", "run-kit-dismiss-update"]);
  });

  it("names a single NON-run-kit tool in the label", () => {
    const actions = buildUpdateActions(
      true,
      [{ tool: "fab-kit", current: "2.16.0", latest: "2.17.0" }],
      vi.fn(),
      vi.fn(),
    );
    expect(actions[0].label).toBe("run-kit: Update fab-kit to v2.17.0");
  });

  it("uses a count label for multiple matched tools", () => {
    const actions = buildUpdateActions(
      true,
      [
        { tool: "run-kit", current: "3.8.0", latest: "3.9.0" },
        { tool: "fab-kit", current: "2.16.0", latest: "2.17.0" },
      ],
      vi.fn(),
      vi.fn(),
    );
    expect(actions[0].label).toBe("run-kit: Update 2 tools");
  });

  it("wires the update action to onUpdate and dismiss to onDismiss", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const [update, dismiss] = buildUpdateActions(true, runKitOnly, onUpdate, onDismiss);

    update.onSelect();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    dismiss.onSelect();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("qualifies independently of chip dismissal (palette ignores dismissal)", () => {
    // The builder gates on `qualifies` only — there is no dismissal parameter,
    // so a dismissed chip still yields palette actions when qualifies is true.
    const actions = buildUpdateActions(
      true,
      [{ tool: "run-kit", current: "3.8.0", latest: "3.10.0" }],
      vi.fn(),
      vi.fn(),
    );
    expect(actions).toHaveLength(2);
    expect(actions[0].label).toBe("run-kit: Update to v3.10.0");
  });
});

describe("updateChipToolSummary (single shared source, A-024)", () => {
  it("names each per-tool transition, comma-joined", () => {
    expect(
      updateChipToolSummary([
        { tool: "run-kit", current: "3.8.0", latest: "3.9.0" },
        { tool: "fab-kit", current: "2.16.0", latest: "2.17.0" },
      ]),
    ).toBe("run-kit v3.8.0 → v3.9.0, fab-kit v2.16.0 → v2.17.0");
  });

  it("degrades to `tool → v{latest}` when a tool has no known current version", () => {
    expect(updateChipToolSummary([{ tool: "tu", current: "", latest: "0.9.2" }])).toBe(
      "tu → v0.9.2",
    );
  });

  it("returns an empty string for no tools", () => {
    expect(updateChipToolSummary([])).toBe("");
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
