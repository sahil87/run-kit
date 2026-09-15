import { describe, it, expect, vi } from "vitest";
import { buildEasterEggActions } from "./easter-eggs";

describe("buildEasterEggActions", () => {
  it("returns the two entries with the exact ids, labels, and descriptions", () => {
    const actions = buildEasterEggActions(vi.fn());
    expect(actions.map((a) => [a.id, a.label, a.description])).toEqual([
      ["easter-egg-smash", "Easter egg: Smash", "the screen cracks open"],
      ["easter-egg-peek", "Easter egg: Peek", "something in there is watching"],
    ]);
  });

  it("selecting an entry fires its egg with force (never rate limited)", () => {
    const fire = vi.fn();
    const actions = buildEasterEggActions(fire);
    actions[0].onSelect();
    expect(fire).toHaveBeenCalledExactlyOnceWith("smash", { force: true });
    actions[1].onSelect();
    expect(fire).toHaveBeenCalledWith("peek", { force: true });
  });

  it("registers no keyboard chord — the palette is the chord", () => {
    for (const action of buildEasterEggActions(vi.fn())) {
      expect(action.shortcut).toBeUndefined();
    }
  });
});
