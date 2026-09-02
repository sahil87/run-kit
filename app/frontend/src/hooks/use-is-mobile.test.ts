import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { stubMatchMedia } from "@/test-utils/match-media";
import { evaluateIsMobile, useIsMobile } from "./use-is-mobile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("evaluateIsMobile", () => {
  it("returns true when only `(any-pointer: coarse)` matches — `(pointer: coarse)` and the narrow query do not", () => {
    // A tablet with a paired trackpad: the primary pointer is fine but a
    // coarse pointer is available — the mobile rule keys on ANY pointer.
    stubMatchMedia((query) => query === "(any-pointer: coarse)");
    expect(evaluateIsMobile()).toBe(true);
  });

  it("returns false when neither the narrow query nor `(any-pointer: coarse)` matches — `(pointer: coarse)` alone is not the mobile gate", () => {
    stubMatchMedia((query) => query === "(pointer: coarse)");
    expect(evaluateIsMobile()).toBe(false);
  });
});

describe("useIsMobile", () => {
  it("renders true with an any-pointer-coarse-only stub", () => {
    stubMatchMedia((query) => query === "(any-pointer: coarse)");
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("subscribes to the `(any-pointer: coarse)` query and updates live", () => {
    // Controllable fake MQLs keyed by query string: flip the any-pointer one
    // and fire its change listeners to simulate a docked/undocked touchscreen.
    const listenersByQuery = new Map<string, Set<() => void>>();
    const matchesByQuery = new Map<string, boolean>();
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => {
      if (!listenersByQuery.has(query)) listenersByQuery.set(query, new Set());
      if (!matchesByQuery.has(query)) matchesByQuery.set(query, false);
      return {
        get matches() {
          return matchesByQuery.get(query)!;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, fn: () => void) => listenersByQuery.get(query)!.add(fn),
        removeEventListener: (_type: string, fn: () => void) => listenersByQuery.get(query)!.delete(fn),
        addListener: (fn: () => void) => listenersByQuery.get(query)!.add(fn),
        removeListener: (fn: () => void) => listenersByQuery.get(query)!.delete(fn),
        dispatchEvent: vi.fn(),
      };
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(listenersByQuery.get("(any-pointer: coarse)")?.size).toBe(1);

    // The capability query is not a mobile gate: flipping `(pointer: coarse)`
    // alone must not move the result (the hook never even subscribes to it).
    act(() => {
      matchesByQuery.set("(pointer: coarse)", true);
      for (const fn of listenersByQuery.get("(pointer: coarse)") ?? []) fn();
    });
    expect(result.current).toBe(false);

    act(() => {
      matchesByQuery.set("(any-pointer: coarse)", true);
      for (const fn of listenersByQuery.get("(any-pointer: coarse)")!) fn();
    });
    expect(result.current).toBe(true);
  });
});
