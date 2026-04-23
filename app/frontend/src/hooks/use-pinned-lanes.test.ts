import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePinnedLanes } from "./use-pinned-lanes";
import type { LanePin } from "./use-pinned-lanes";

const STORAGE_KEY = "runkit-lanes-pins";

describe("usePinnedLanes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with empty pins when localStorage is empty", () => {
    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([]);
  });

  it("reads existing pins from localStorage on mount", () => {
    const pins: LanePin[] = [
      { server: "default", session: "work", windowIndex: 0 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual(pins);
  });

  it("pins a window and persists to localStorage", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin: LanePin = { server: "default", session: "work", windowIndex: 1 };

    act(() => {
      result.current.pinWindow(pin);
    });

    expect(result.current.pins).toEqual([pin]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([pin]);
  });

  it("unpins a window and persists to localStorage", () => {
    const pin: LanePin = { server: "default", session: "work", windowIndex: 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([pin]));

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([pin]);

    act(() => {
      result.current.unpinWindow(pin);
    });

    expect(result.current.pins).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("prevents duplicate pins (same server+session+windowIndex)", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin: LanePin = { server: "default", session: "work", windowIndex: 2 };

    act(() => {
      result.current.pinWindow(pin);
    });
    act(() => {
      result.current.pinWindow(pin);
    });

    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins).toEqual([pin]);
  });

  it("allows different windows to be pinned", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin1: LanePin = { server: "default", session: "work", windowIndex: 0 };
    const pin2: LanePin = { server: "default", session: "work", windowIndex: 1 };
    const pin3: LanePin = { server: "remote", session: "build", windowIndex: 0 };

    act(() => {
      result.current.pinWindow(pin1);
      result.current.pinWindow(pin2);
      result.current.pinWindow(pin3);
    });

    expect(result.current.pins).toHaveLength(3);
  });

  it("isPinned returns true for pinned windows", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin: LanePin = { server: "default", session: "work", windowIndex: 1 };

    act(() => {
      result.current.pinWindow(pin);
    });

    expect(result.current.isPinned(pin)).toBe(true);
  });

  it("isPinned returns false for unpinned windows", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin: LanePin = { server: "default", session: "work", windowIndex: 1 };

    expect(result.current.isPinned(pin)).toBe(false);
  });

  it("clearPins removes all pins and clears localStorage", () => {
    const pins: LanePin[] = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toHaveLength(2);

    act(() => {
      result.current.clearPins();
    });

    expect(result.current.pins).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("handles corrupt localStorage data gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([]);
  });

  it("filters out malformed pin entries from localStorage", () => {
    const raw = JSON.stringify([
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default" }, // missing session and windowIndex
      "not-an-object",
      null,
      { server: "remote", session: "build", windowIndex: "not-a-number" },
    ]);
    localStorage.setItem(STORAGE_KEY, raw);

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([
      { server: "default", session: "work", windowIndex: 0 },
    ]);
  });

  it("syncs pins across tabs via storage event", () => {
    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([]);

    const pin: LanePin = { server: "default", session: "work", windowIndex: 3 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([pin]));

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify([pin]),
        }),
      );
    });

    expect(result.current.pins).toEqual([pin]);
  });

  it("ignores storage events for other keys", () => {
    const pin: LanePin = { server: "default", session: "work", windowIndex: 0 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([pin]));

    const { result } = renderHook(() => usePinnedLanes());
    expect(result.current.pins).toEqual([pin]);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "some-other-key",
          newValue: "[]",
        }),
      );
    });

    expect(result.current.pins).toEqual([pin]);
  });

  it("handles localStorage.setItem throwing (e.g. quota exceeded)", () => {
    const { result } = renderHook(() => usePinnedLanes());
    const pin: LanePin = { server: "default", session: "work", windowIndex: 0 };

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Should not throw — pin is still added to in-memory state
    act(() => {
      result.current.pinWindow(pin);
    });

    expect(result.current.pins).toEqual([pin]);

    setItemSpy.mockRestore();
  });

  it("cleans up storage event listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => usePinnedLanes());

    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));

    const handler = addSpy.mock.calls.find((c) => c[0] === "storage")?.[1];
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("storage", handler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
