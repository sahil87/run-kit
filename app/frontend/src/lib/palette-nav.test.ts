import { describe, it, expect, vi } from "vitest";
import { buildNavActions } from "./palette-nav";

const noop = {
  onBack: () => {},
  onForward: () => {},
  onServerCabin: () => {},
  onCockpit: () => {},
};

describe("buildNavActions (Go: palette parity)", () => {
  it("always offers Back and Forward first (history is global)", () => {
    const actions = buildNavActions("cockpit", "", noop);
    expect(actions.slice(0, 2).map((a) => a.id)).toEqual(["go-back", "go-forward"]);
    expect(actions[0].label).toBe("Go: Back");
    expect(actions[1].label).toBe("Go: Forward");
  });

  it("on the cockpit (root of the hierarchy) offers ONLY the two history actions", () => {
    const ids = buildNavActions("cockpit", "", noop).map((a) => a.id);
    expect(ids).toEqual(["go-back", "go-forward"]);
  });

  it("on a terminal route offers Server Cabin then Cockpit (nearest-first)", () => {
    const ids = buildNavActions("terminal", "prod", noop).map((a) => a.id);
    expect(ids).toEqual(["go-back", "go-forward", "go-server-cabin", "go-cockpit"]);
  });

  it("on a board route offers only Cockpit as the ancestor (no Server Cabin)", () => {
    const ids = buildNavActions("board", "prod", noop).map((a) => a.id);
    expect(ids).toEqual(["go-back", "go-forward", "go-cockpit"]);
  });

  it("on a root (Server Cabin) route offers only Cockpit (its lone ancestor)", () => {
    const ids = buildNavActions("root", "prod", noop).map((a) => a.id);
    expect(ids).toEqual(["go-back", "go-forward", "go-cockpit"]);
  });

  it("omits Server Cabin on a terminal route when the server is not yet resolved", () => {
    const ids = buildNavActions("terminal", "", noop).map((a) => a.id);
    // No blank-server Server Cabin entry; Cockpit still present.
    expect(ids).toEqual(["go-back", "go-forward", "go-cockpit"]);
  });

  it("wires each action's onSelect to its own handler", () => {
    const handlers = {
      onBack: vi.fn(),
      onForward: vi.fn(),
      onServerCabin: vi.fn(),
      onCockpit: vi.fn(),
    };
    const actions = buildNavActions("terminal", "prod", handlers);
    const byId = (id: string) => actions.find((a) => a.id === id)!;
    byId("go-back").onSelect();
    byId("go-forward").onSelect();
    byId("go-server-cabin").onSelect();
    byId("go-cockpit").onSelect();
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onForward).toHaveBeenCalledTimes(1);
    expect(handlers.onServerCabin).toHaveBeenCalledTimes(1);
    expect(handlers.onCockpit).toHaveBeenCalledTimes(1);
  });
});
