import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

// Mock visualViewport as an EventTarget with height and offsetTop properties
function createMockViewport(height = 800, offsetTop = 0) {
  const target = new EventTarget();
  let _height = height;
  let _offsetTop = offsetTop;
  Object.defineProperty(target, "height", {
    get: () => _height,
    set: (v: number) => { _height = v; },
  });
  Object.defineProperty(target, "offsetTop", {
    get: () => _offsetTop,
    set: (v: number) => { _offsetTop = v; },
  });
  return target as EventTarget & { height: number; offsetTop: number };
}

describe("useVisualViewport", () => {
  let mockVV: ReturnType<typeof createMockViewport>;
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafIdCounter: number;

  beforeEach(() => {
    mockVV = createMockViewport(800);
    Object.defineProperty(window, "visualViewport", {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    // Mock rAF to capture callbacks for manual flushing
    rafCallbacks = [];
    rafIdCounter = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafIdCounter;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--app-height");
    document.documentElement.style.removeProperty("--app-offset-top");
    vi.restoreAllMocks();
  });

  function flushRaf() {
    const cbs = [...rafCallbacks];
    rafCallbacks.length = 0;
    cbs.forEach((cb) => cb(performance.now()));
  }

  it("sets --app-height and --app-offset-top on mount", () => {
    renderHook(() => useVisualViewport());

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("800px");
    expect(
      document.documentElement.style.getPropertyValue("--app-offset-top"),
    ).toBe("0px");
  });

  it("updates --app-height on resize event", () => {
    renderHook(() => useVisualViewport());

    mockVV.height = 500;
    mockVV.dispatchEvent(new Event("resize"));
    flushRaf();

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("500px");
  });

  it("updates --app-height on scroll event", () => {
    renderHook(() => useVisualViewport());

    mockVV.height = 600;
    mockVV.dispatchEvent(new Event("scroll"));
    flushRaf();

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("600px");
  });

  it("updates --app-offset-top when viewport scrolls", () => {
    renderHook(() => useVisualViewport());

    mockVV.offsetTop = 42;
    mockVV.dispatchEvent(new Event("scroll"));
    flushRaf();

    expect(
      document.documentElement.style.getPropertyValue("--app-offset-top"),
    ).toBe("42px");
  });

  it("skips update when neither height nor offsetTop changed", () => {
    renderHook(() => useVisualViewport());

    const spy = vi.spyOn(document.documentElement.style, "setProperty");
    spy.mockClear();

    // Nothing changed — dispatch scroll
    mockVV.dispatchEvent(new Event("scroll"));
    flushRaf();

    expect(spy).not.toHaveBeenCalled();
  });

  it("updates when only offsetTop changes (height unchanged)", () => {
    renderHook(() => useVisualViewport());

    mockVV.offsetTop = 10;
    mockVV.dispatchEvent(new Event("scroll"));
    flushRaf();

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("800px");
    expect(
      document.documentElement.style.getPropertyValue("--app-offset-top"),
    ).toBe("10px");
  });

  it("coalesces rapid events into one rAF callback", () => {
    renderHook(() => useVisualViewport());

    mockVV.height = 700;
    mockVV.dispatchEvent(new Event("resize"));
    mockVV.dispatchEvent(new Event("scroll"));
    mockVV.dispatchEvent(new Event("resize"));

    // Only one rAF should have been queued
    expect(rafCallbacks).toHaveLength(1);

    flushRaf();
    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("700px");
  });

  it("removes --app-height, --app-offset-top and listeners on unmount", () => {
    const removeSpy = vi.spyOn(mockVV, "removeEventListener");
    const { unmount } = renderHook(() => useVisualViewport());

    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--app-offset-top"),
    ).toBe("");
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("cancels pending rAF on unmount", () => {
    const { unmount } = renderHook(() => useVisualViewport());

    mockVV.height = 400;
    mockVV.dispatchEvent(new Event("resize"));
    // rAF queued but not flushed

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("no-ops when visualViewport is not available", () => {
    Object.defineProperty(window, "visualViewport", {
      value: null,
      writable: true,
      configurable: true,
    });

    // Should not throw
    const { unmount } = renderHook(() => useVisualViewport());
    unmount();

    expect(
      document.documentElement.style.getPropertyValue("--app-height"),
    ).toBe("");
  });
});
