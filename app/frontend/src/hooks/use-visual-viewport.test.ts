import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useVisualViewport, KEYBOARD_DELTA_PX } from "./use-visual-viewport";

/** Controllable fake visualViewport: tests mutate width/height/offsetTop and
 * fire the registered resize/scroll listeners to simulate viewport changes. */
function makeFakeViewport(width: number, height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const vv = {
    width,
    height,
    offsetTop: 0,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    },
  };
  const fire = (type: "resize" | "scroll") => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  return { vv, fire, listeners };
}

/** rAF stub that queues callbacks for manual flushing — the hook coalesces
 * viewport events through requestAnimationFrame, so a synchronous stub would
 * leave its rafId guard permanently set. */
let rafQueue: FrameRequestCallback[];
function flushRaf() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}

const html = () => document.documentElement;

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  html().classList.remove("fullbleed", "kb-open");
  html().style.removeProperty("--app-height");
  html().style.removeProperty("--app-offset-top");
});

describe("useVisualViewport keyboard-open signal", () => {
  it("is off at baseline and sets --app-height on mount", () => {
    const { vv } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());

    expect(html().classList.contains("kb-open")).toBe(false);
    expect(html().classList.contains("fullbleed")).toBe(true);
    expect(html().style.getPropertyValue("--app-height")).toBe("812px");
  });

  it("turns on when height drops past the threshold and off on restore", () => {
    const { vv, fire } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());

    // Keyboard opens: height shrinks well past the threshold, width unchanged.
    act(() => {
      vv.height = 812 - (KEYBOARD_DELTA_PX + 100);
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(true);
    expect(html().style.getPropertyValue("--app-height")).toBe(`${812 - (KEYBOARD_DELTA_PX + 100)}px`);

    // Keyboard closes: height restores.
    act(() => {
      vv.height = 812;
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(false);
  });

  it("ignores sub-threshold height deltas (URL-bar chrome show/hide)", () => {
    const { vv, fire } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());

    act(() => {
      vv.height = 812 - (KEYBOARD_DELTA_PX - 40); // e.g. 110px chrome delta
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(false);
  });

  it("resets the baseline on a width change (rotation) instead of misfiring", () => {
    const { vv, fire } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());

    // Rotate portrait → landscape: height drops far past the threshold, but
    // width changed too, so this is a new geometry — not a keyboard.
    act(() => {
      vv.width = 812;
      vv.height = 375;
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(false);

    // A keyboard in the new orientation still registers against the new baseline.
    act(() => {
      vv.height = 375 - (KEYBOARD_DELTA_PX + 20);
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(true);
  });

  it("raises the baseline when a larger height is observed (self-heals a keyboarded load)", () => {
    // Page loads with the keyboard already open: baseline starts keyboarded.
    const { vv, fire } = makeFakeViewport(375, 500);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());
    expect(html().classList.contains("kb-open")).toBe(false);

    // Keyboard closes → taller height becomes the new baseline...
    act(() => {
      vv.height = 812;
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(false);

    // ...so the next keyboard open is detected.
    act(() => {
      vv.height = 500;
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(true);
  });

  it("removes kb-open, fullbleed, and CSS properties on unmount", () => {
    const { vv, fire, listeners } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    const { unmount } = renderHook(() => useVisualViewport());

    act(() => {
      vv.height = 500;
      fire("resize");
      flushRaf();
    });
    expect(html().classList.contains("kb-open")).toBe(true);

    unmount();
    expect(html().classList.contains("kb-open")).toBe(false);
    expect(html().classList.contains("fullbleed")).toBe(false);
    expect(html().style.getPropertyValue("--app-height")).toBe("");
    expect(html().style.getPropertyValue("--app-offset-top")).toBe("");
    expect(listeners.get("resize")?.size ?? 0).toBe(0);
    expect(listeners.get("scroll")?.size ?? 0).toBe(0);
  });

  it("registers only the resize and scroll listener pair", () => {
    const { vv, listeners } = makeFakeViewport(375, 812);
    vi.stubGlobal("visualViewport", vv);
    renderHook(() => useVisualViewport());

    expect([...listeners.keys()].sort()).toEqual(["resize", "scroll"]);
    expect(listeners.get("resize")?.size).toBe(1);
    expect(listeners.get("scroll")?.size).toBe(1);
  });

  it("mounts and unmounts safely without visualViewport, never setting kb-open", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { unmount } = renderHook(() => useVisualViewport());

    expect(html().classList.contains("fullbleed")).toBe(true);
    expect(html().classList.contains("kb-open")).toBe(false);

    unmount();
    expect(html().classList.contains("fullbleed")).toBe(false);
    expect(html().classList.contains("kb-open")).toBe(false);
  });
});
