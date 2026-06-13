import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current epoch seconds on first render", () => {
    vi.setSystemTime(new Date(1_700_000_000_000));
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(1_700_000_000);
  });

  it("increments once per second as the interval ticks", () => {
    vi.setSystemTime(new Date(1_700_000_000_000));
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(1_700_000_000);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1_700_000_001);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(1_700_000_003);
  });

  it("clears the interval on unmount (no leak)", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useNow());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
