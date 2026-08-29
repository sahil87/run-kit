import { describe, it, expect, vi } from "vitest";
import { buildWebTabActions } from "./web-tabs";
import { WEB_ADDRESS_FOCUS_EVENT } from "../web-url";

/**
 * `buildWebTabActions` (260828-9kip R11) — the palette's `Web: … tab` strip
 * actions. Enablement is the availability idiom (absent, not disabled):
 * next/prev/close need ≥2 tabs, `Web: New tab from address` is offered at ≥1
 * (the only UI path to a second tab from a 1-tab window); the caller gates the
 * set on the layout including a `web` tile. Pure-builder tests in the
 * `palette/zen.test.ts` pattern.
 */

const TABS2 = ["/proxy/3001/", "/proxy/3002/"];
const TABS3 = ["/proxy/3001/", "/proxy/3002/", "/proxy/3003/"];

function handlers() {
  return {
    onSelectTab: vi.fn<(n: number) => void>(),
    onCloseTab: vi.fn<(n: number) => void>(),
  };
}

function byId(actions: ReturnType<typeof buildWebTabActions>, id: string) {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new Error(`action ${id} absent`);
  return action;
}

describe("buildWebTabActions — enablement (R11)", () => {
  it("offers nothing for an empty family (the onboarding tile)", () => {
    expect(buildWebTabActions([], undefined, handlers())).toEqual([]);
  });

  it("offers only `Web: New tab from address` at 1 tab", () => {
    const actions = buildWebTabActions(["/proxy/3001/"], 1, handlers());
    expect(actions.map((a) => a.id)).toEqual(["web-tab-new"]);
  });

  it("offers all four actions at 2+ tabs", () => {
    const actions = buildWebTabActions(TABS2, 1, handlers());
    expect(actions.map((a) => a.id)).toEqual([
      "web-tab-next",
      "web-tab-prev",
      "web-tab-close",
      "web-tab-new",
    ]);
    expect(actions.map((a) => a.label)).toEqual([
      "Web: Next tab",
      "Web: Previous tab",
      "Web: Close tab",
      "Web: New tab from address",
    ]);
  });
});

describe("buildWebTabActions — wrap semantics (R11)", () => {
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

describe("buildWebTabActions — close + new-tab seams (R11)", () => {
  it("close targets the active slot", () => {
    const h = handlers();
    byId(buildWebTabActions(TABS3, 2, h), "web-tab-close").onSelect();
    expect(h.onCloseTab).toHaveBeenCalledWith(2);
    expect(h.onSelectTab).not.toHaveBeenCalled();
  });

  it("new tab dispatches `web-address:focus` with the newTab arm detail", () => {
    const listener = vi.fn();
    document.addEventListener(WEB_ADDRESS_FOCUS_EVENT, listener);
    try {
      byId(buildWebTabActions(["/proxy/3001/"], 1, handlers()), "web-tab-new").onSelect();
    } finally {
      document.removeEventListener(WEB_ADDRESS_FOCUS_EVENT, listener);
    }

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ newTab: true });
  });
});
