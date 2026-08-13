import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useScrollEdgeFade } from "./use-scroll-edge-fade";

/** Stub the scroll geometry jsdom leaves at 0 so the hook sees a real
 * viewport: scrollHeight = content height, clientHeight = viewport height,
 * scrollTop = current scroll position. */
function stubScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
}

function renderFadeHook(el: HTMLElement) {
  return renderHook(() => {
    const ref = useRef<HTMLElement | null>(el);
    return useScrollEdgeFade(ref);
  });
}

afterEach(() => {
  cleanup();
});

describe("useScrollEdgeFade", () => {
  it("returns false when the element fits its viewport (not scrollable)", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 100, clientHeight: 100, scrollTop: 0 });
    const { result } = renderFadeHook(el);
    expect(result.current).toBe(false);
  });

  it("returns true when scrollable and not scrolled to the end", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 200, clientHeight: 100, scrollTop: 0 });
    const { result } = renderFadeHook(el);
    expect(result.current).toBe(true);
  });

  it("returns false when scrolled to the end", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 200, clientHeight: 100, scrollTop: 100 });
    const { result } = renderFadeHook(el);
    expect(result.current).toBe(false);
  });

  it("absorbs sub-pixel scroll reports within the epsilon", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 200, clientHeight: 100, scrollTop: 99.5 });
    const { result } = renderFadeHook(el);
    expect(result.current).toBe(false);
  });

  it("updates when a scroll event moves the position", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 200, clientHeight: 100, scrollTop: 0 });
    const { result } = renderFadeHook(el);
    expect(result.current).toBe(true);

    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(false);

    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(true);
  });
});
