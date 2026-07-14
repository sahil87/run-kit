import { describe, it, expect, vi } from "vitest";
import { buildViewActions } from "./palette-view";

describe("buildViewActions (View: palette parity)", () => {
  it("offers the OTHER view when both are available (tty current → View: Web)", () => {
    const actions = buildViewActions(["web", "tty"], "tty", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-web");
    expect(actions[0].label).toBe("View: Web");
    expect(actions[0].shortcut).toBe("⌘.");
  });

  it("offers the OTHER view when web is current (web current → View: Terminal)", () => {
    const actions = buildViewActions(["web", "tty"], "web", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-tty");
    expect(actions[0].label).toBe("View: Terminal");
  });

  it("yields no action for a single-view (tty-only) window", () => {
    expect(buildViewActions(["tty"], "tty", () => {})).toEqual([]);
  });

  it("excludes the current view, never offering a switch to where you already are", () => {
    const labels = buildViewActions(["web", "tty"], "tty", () => {}).map(
      (a) => a.label,
    );
    expect(labels).not.toContain("View: Terminal");
  });

  it("onSelect switches to the action's own view", () => {
    const onSwitch = vi.fn();
    const [action] = buildViewActions(["web", "tty"], "tty", onSwitch);
    action.onSelect();
    expect(onSwitch).toHaveBeenCalledWith("web");
  });
});
