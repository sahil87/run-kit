import { describe, it, expect, vi } from "vitest";
import { buildViewActions } from "./view";

describe("buildViewActions (View: palette parity)", () => {
  it("offers the OTHER view when both are available (tty current → View: Web)", () => {
    const actions = buildViewActions(["web", "tty"], "tty", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-web");
    expect(actions[0].label).toBe("View: Web");
  });

  it("offers the OTHER view when web is current (web current → View: Terminal)", () => {
    const actions = buildViewActions(["web", "tty"], "web", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-tty");
    expect(actions[0].label).toBe("View: Terminal");
  });

  it("offers View: Web without a URL — web availability is unconditional", () => {
    // The URL-less window's availableViews is ["web","tty"], so the entry
    // rides the same builder path as a content-bearing one (the onboarding
    // tile is what it opens).
    const actions = buildViewActions(["web", "tty"], "tty", () => {});
    expect(actions.map((a) => a.id)).toEqual(["view-web"]);
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

  it("carries NO shortcut hint on any entry — no chord reaches a lens switch", () => {
    const actions = buildViewActions(["chat", "web", "code", "tty"], "tty", () => {});
    expect(actions.map((a) => a.id)).toEqual(["view-chat", "view-web", "view-code"]);
    for (const a of actions) expect(a.shortcut).toBe("");
  });

  describe("chat lens", () => {
    it("offers View: Chat (palette-only by design — chat has no chord and no tile toggle)", () => {
      const actions = buildViewActions(["chat", "tty"], "tty", () => {});
      const chat = actions.find((a) => a.id === "view-chat");
      expect(chat).toBeTruthy();
      expect(chat!.label).toBe("View: Chat");
      expect(chat!.shortcut).toBe("");
    });

    it("offers View: Terminal when leaving chat", () => {
      const actions = buildViewActions(["chat", "tty"], "chat", () => {});
      const tty = actions.find((a) => a.id === "view-tty");
      expect(tty).toBeTruthy();
      expect(tty!.label).toBe("View: Terminal");
    });

    it("offers Chat AND Web on a stacked window (all three lenses)", () => {
      const actions = buildViewActions(["chat", "web", "tty"], "tty", () => {});
      expect(actions.map((a) => a.id)).toEqual(["view-chat", "view-web"]);
    });

    it("onSelect switches to chat", () => {
      const onSwitch = vi.fn();
      const chat = buildViewActions(["chat", "tty"], "tty", onSwitch).find(
        (a) => a.id === "view-chat",
      )!;
      chat.onSelect();
      expect(onSwitch).toHaveBeenCalledWith("chat");
    });
  });
});
