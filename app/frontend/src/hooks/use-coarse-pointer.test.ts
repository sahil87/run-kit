import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useCoarsePointer } from "./use-coarse-pointer";

/** Controllable fake MediaQueryList: tests flip `matches` and fire the
 * registered change listeners to simulate a live pointer-capability change. */
function makeFakeMql(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialMatches,
    media: "(pointer: coarse)",
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

describe("useCoarsePointer", () => {
  it("returns the initial match state (fine pointer → false)", () => {
    const { mql } = makeFakeMql(false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it("returns true on a coarse pointer", () => {
    const { mql } = makeFakeMql(true);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it("updates live when the media query changes (both directions)", () => {
    const { mql, setMatches } = makeFakeMql(false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);

    act(() => setMatches(true));
    expect(result.current).toBe(true);

    act(() => setMatches(false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes its change listener on unmount", () => {
    const { mql, listeners } = makeFakeMql(false);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { unmount } = renderHook(() => useCoarsePointer());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
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
    const { result, unmount } = renderHook(() => useCoarsePointer());
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
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });
});
