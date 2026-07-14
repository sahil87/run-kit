import { describe, it, expect, vi } from "vitest";
import { buildViewActions } from "./palette-view";

describe("buildViewActions (View: palette parity)", () => {
  it("offers the OTHER view when both are available (tty current → View: Web)", () => {
    const actions = buildViewActions(["web", "tty"], "tty", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-web");
    expect(actions[0].label).toBe("View: Web");
    // Web is reachable only via the cycle chord.
    expect(actions[0].shortcut).toBe("⌘.");
  });

  it("offers the OTHER view when web is current (web current → View: Terminal)", () => {
    const actions = buildViewActions(["web", "tty"], "web", () => {});
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("view-tty");
    expect(actions[0].label).toBe("View: Terminal");
    // Leaving web (not chat) → the cycle chord, not the chat toggle.
    expect(actions[0].shortcut).toBe("⌘.");
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

  // Chat lens (folded in from 260714-r7rq).
  describe("chat lens", () => {
    it("offers View: Chat with the Ctrl+` toggle hint when on tty", () => {
      const actions = buildViewActions(["chat", "tty"], "tty", () => {});
      const chat = actions.find((a) => a.id === "view-chat");
      expect(chat).toBeTruthy();
      expect(chat!.label).toBe("View: Chat");
      expect(chat!.shortcut).toBe("Ctrl+`");
    });

    it("offers View: Terminal with the Ctrl+` toggle hint when leaving chat", () => {
      const actions = buildViewActions(["chat", "tty"], "chat", () => {});
      const tty = actions.find((a) => a.id === "view-tty");
      expect(tty).toBeTruthy();
      expect(tty!.label).toBe("View: Terminal");
      // Leaving chat, tty is reached via the chat toggle, not the cycle.
      expect(tty!.shortcut).toBe("Ctrl+`");
    });

    it("offers Chat AND Web on a stacked window (all three lenses)", () => {
      const actions = buildViewActions(["chat", "web", "tty"], "tty", () => {});
      const ids = actions.map((a) => a.id);
      expect(ids).toEqual(["view-chat", "view-web"]);
      // Chat rides the toggle; web rides the cycle.
      expect(actions.find((a) => a.id === "view-chat")!.shortcut).toBe("Ctrl+`");
      expect(actions.find((a) => a.id === "view-web")!.shortcut).toBe("⌘.");
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
