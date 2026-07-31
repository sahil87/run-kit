import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useMediaQuery, evaluateMediaQuery } from "./use-media-query";

/** Controllable fake MediaQueryList: tests flip `matches` and fire the
 * registered change listeners to simulate a live media change. */
function makeFakeMql(media: string, initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialMatches,
    media,
    onchange: null,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    dispatchEvent: vi.fn(),
  };
  const setMatches = (m: boolean) => {
    mql.matches = m;
    for (const fn of listeners) fn();
  };
  return { mql, setMatches, listeners };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("returns the initial match state", () => {
    const { mql } = makeFakeMql("(pointer: coarse)", false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(result.current).toBe(false);
  });

  it("returns true when the query initially matches", () => {
    const { mql } = makeFakeMql("(pointer: coarse)", true);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(result.current).toBe(true);
  });

  it("updates live when the media query changes (both directions)", () => {
    const { mql, setMatches } = makeFakeMql("(max-width: 639px)", false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useMediaQuery("(max-width: 639px)"));
    expect(result.current).toBe(false);

    act(() => setMatches(true));
    expect(result.current).toBe(true);

    act(() => setMatches(false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes its change listener on unmount", () => {
    const { mql, listeners } = makeFakeMql("(pointer: coarse)", false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { unmount } = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("resubscribes when the query string changes", () => {
    const a = makeFakeMql("(max-width: 639px)", false);
    const b = makeFakeMql("(pointer: coarse)", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => (query === a.mql.media ? a.mql : b.mql)),
    );
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: "(max-width: 639px)" },
    });
    expect(result.current).toBe(false);
    expect(a.listeners.size).toBe(1);

    rerender({ query: "(pointer: coarse)" });
    // Old subscription torn down, new one live, value re-read from the new list.
    expect(a.listeners.size).toBe(0);
    expect(b.listeners.size).toBe(1);
    expect(result.current).toBe(true);

    act(() => b.setMatches(false));
    expect(result.current).toBe(false);
  });

  it("falls back to the legacy addListener/removeListener API", () => {
    const listeners = new Set<() => void>();
    const mql = {
      matches: false,
      media: "(pointer: coarse)",
      onchange: null,
      // No addEventListener/removeEventListener — legacy WebKit shape.
      addListener: (fn: () => void) => listeners.add(fn),
      removeListener: (fn: () => void) => listeners.delete(fn),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result, unmount } = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(result.current).toBe(false);
    expect(listeners.size).toBe(1);

    act(() => {
      mql.matches = true;
      for (const fn of listeners) fn();
    });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("returns false without throwing when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(result.current).toBe(false);
  });
});

describe("evaluateMediaQuery", () => {
  it("returns the current match state one-shot", () => {
    const { mql } = makeFakeMql("(pointer: coarse)", true);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    expect(evaluateMediaQuery("(pointer: coarse)")).toBe(true);
  });

  it("returns false without throwing when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(evaluateMediaQuery("(pointer: coarse)")).toBe(false);
  });
});
