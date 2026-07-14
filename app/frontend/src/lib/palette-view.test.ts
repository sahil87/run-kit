import { describe, it, expect, vi } from "vitest";
import { buildViewActions } from "./palette-view";

describe("buildViewActions", () => {
  it("returns nothing when chat is unavailable", () => {
    expect(buildViewActions(false, "terminal", () => {})).toEqual([]);
    expect(buildViewActions(false, "chat", () => {})).toEqual([]);
  });

  it("in terminal view offers only 'View: Chat'", () => {
    const actions = buildViewActions(true, "terminal", () => {});
    expect(actions.map((a) => a.id)).toEqual(["view-chat"]);
    expect(actions[0].label).toBe("View: Chat");
  });

  it("in chat view offers only 'View: Terminal'", () => {
    const actions = buildViewActions(true, "chat", () => {});
    expect(actions.map((a) => a.id)).toEqual(["view-terminal"]);
    expect(actions[0].label).toBe("View: Terminal");
  });

  it("the action flips to the opposite view", () => {
    const onSetView = vi.fn();
    buildViewActions(true, "terminal", onSetView)[0].onSelect();
    expect(onSetView).toHaveBeenCalledWith("chat");
    buildViewActions(true, "chat", onSetView)[0].onSelect();
    expect(onSetView).toHaveBeenCalledWith("terminal");
  });
});
