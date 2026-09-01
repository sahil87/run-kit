import { describe, it, expect, vi } from "vitest";
import { buildWebTabActions } from "./web-tabs";
import { WEB_TAB_DRAFT_EVENT } from "../web-url";

/**
 * `buildWebTabActions` — the palette's `Web: … tab` strip actions.
 * Enablement is the availability idiom (absent, not disabled): next/prev/
 * close/move need ≥2 tabs, boundary move entries are omitted (the `Tab:
 * Move up/down` precedent), and `Web: New tab` is offered at ≥1 (the only
 * UI path to a second tab from a 1-tab window). The caller gates the set on
 * the layout including a `web` tile. Pure-builder tests in the
 * `palette/zen.test.ts` pattern.
 */

const TABS2 = ["/proxy/3001/", "/proxy/3002/"];
const TABS3 = ["/proxy/3001/", "/proxy/3002/", "/proxy/3003/"];

function handlers() {
  return {
    onSelectTab: vi.fn<(n: number) => void>(),
    onCloseTab: vi.fn<(n: number) => void>(),
    onMoveTab: vi.fn<(n: number, to: number) => void>(),
  };
}

function byId(actions: ReturnType<typeof buildWebTabActions>, id: string) {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new Error(`action ${id} absent`);
  return action;
}

describe("buildWebTabActions — enablement", () => {
  it("offers nothing for an empty family (the onboarding tile)", () => {
    expect(buildWebTabActions([], undefined, handlers())).toEqual([]);
  });

  it("offers only `Web: New tab` at 1 tab", () => {
    const actions = buildWebTabActions(["/proxy/3001/"], 1, handlers());
    expect(actions.map((a) => a.id)).toEqual(["web-tab-new"]);
  });

  it("offers the verb entries + new at 2+ tabs", () => {
    const actions = buildWebTabActions(TABS2, 1, handlers());
    expect(actions.map((a) => a.id)).toEqual([
      "web-tab-next",
      "web-tab-prev",
      "web-tab-close",
      "web-tab-move-right",
      "web-tab-new",
    ]);
    expect(actions.map((a) => a.label)).toEqual([
      "Web: Next tab",
      "Web: Previous tab",
      "Web: Close tab",
      "Web: Move tab right",
      "Web: New tab",
    ]);
  });

  it("omits both move entries at 1 tab", () => {
    const actions = buildWebTabActions(["/proxy/3001/"], 1, handlers());
    expect(actions.map((a) => a.id)).not.toContain("web-tab-move-left");
    expect(actions.map((a) => a.id)).not.toContain("web-tab-move-right");
  });

  it("omits the move-left entry when the active tab is first", () => {
    const actions = buildWebTabActions(TABS3, 1, handlers());
    expect(actions.map((a) => a.id)).not.toContain("web-tab-move-left");
    expect(actions.map((a) => a.id)).toContain("web-tab-move-right");
  });

  it("omits the move-right entry when the active tab is last", () => {
    const actions = buildWebTabActions(TABS3, 3, handlers());
    expect(actions.map((a) => a.id)).toContain("web-tab-move-left");
    expect(actions.map((a) => a.id)).not.toContain("web-tab-move-right");
  });

  it("offers both move entries mid-family", () => {
    const actions = buildWebTabActions(TABS3, 2, handlers());
    expect(actions.map((a) => a.id)).toContain("web-tab-move-left");
    expect(actions.map((a) => a.id)).toContain("web-tab-move-right");
  });
});

describe("buildWebTabActions — wrap semantics", () => {
  it("next wraps from the last tab to slot 1", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS2, 2, h), "web-tab-next").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(1);
  });

  it("next steps to the following slot mid-family", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 1, h), "web-tab-next").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(2);
  });

  it("prev wraps from the first tab to the last slot", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 1, h), "web-tab-prev").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(3);
  });

  it("prev steps to the preceding slot mid-family", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 3, h), "web-tab-prev").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(2);
  });

  it("reads slot 1 for a 0/absent active pointer (the mount clamp)", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 0, h), "web-tab-prev").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(3);
    byId(buildWebTabActions(TABS3, undefined, h), "web-tab-next").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(2);
  });

  it("clamps an out-of-range active pointer to the family before wrapping", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS2, 9, h), "web-tab-next").onSelect();
    expect(h.onSelectTab).toHaveBeenCalledWith(1);
  });
});

describe("buildWebTabActions — move borders", () => {
  it("move-left carries the boundary slot minus one", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 2, h), "web-tab-move-left").onSelect();
    expect(h.onMoveTab).toHaveBeenCalledWith(2, 1);
  });

  it("move-right carries the boundary slot plus one", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 2, h), "web-tab-move-right").onSelect();
    expect(h.onMoveTab).toHaveBeenCalledWith(2, 3);
  });

  it("omitted boundary entry means the handler would never see a no-op", () => {
    const h = handlers();
    const actions = buildWebTabActions(TABS3, 1, h);
    expect(actions.map((a) => a.id)).not.toContain("web-tab-move-left");
    expect(h.onMoveTab).not.toHaveBeenCalled();
  });
});

describe("buildWebTabActions — close + new-tab seams", () => {
  it("close targets the active slot", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 2, h), "web-tab-close").onSelect();
    expect(h.onCloseTab).toHaveBeenCalledWith(2);
    expect(h.onSelectTab).not.toHaveBeenCalled();
  });

  it("new tab dispatches `web-tab:open-draft`", () => {
    const listener = vi.fn();
    document.addEventListener(WEB_TAB_DRAFT_EVENT, listener);
    try {
      byId(buildWebTabActions(["/proxy/3001/"], 1, handlers()), "web-tab-new").onSelect();
    } finally {
      document.removeEventListener(WEB_TAB_DRAFT_EVENT, listener);
    }

    expect(listener).toHaveBeenCalledOnce();
  });
});
