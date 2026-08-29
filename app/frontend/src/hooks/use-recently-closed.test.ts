import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ClosedWindow } from "@/api/client";

// API seam: the mirror's only fetch is the mount-time seed.
const listClosedWindowsMock = vi.fn<(server: string) => Promise<ClosedWindow[]>>();
vi.mock("@/api/client", () => ({
  listClosedWindows: (server: string) => listClosedWindowsMock(server),
}));

import {
  useRecentlyClosed,
  pushRecentlyClosed,
  popRecentlyClosed,
  buildReopenWindowAction,
} from "./use-recently-closed";

function rec(id: string, name = `win-${id}`, session = "main"): ClosedWindow {
  return {
    id,
    closedAt: "2026-08-29T00:00:00Z",
    server: "srv",
    session,
    window: { index: 0, id: "@1", name, panes: [] },
  };
}

beforeEach(() => {
  listClosedWindowsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("useRecentlyClosed", () => {
  // The module-level mirror persists across tests; every case uses its own
  // server name, which doubles as the per-server isolation proof.

  it("seeds the stack from the ring listing on mount, newest-first", async () => {
    listClosedWindowsMock.mockResolvedValue([rec("b"), rec("a")]);
    const { result } = renderHook(() => useRecentlyClosed("srv-seed"));

    // The seed fetch has not resolved yet: the gate stays hidden, not wrong.
    expect(result.current.stack).toEqual([]);

    await act(async () => {});
    expect(listClosedWindowsMock).toHaveBeenCalledWith("srv-seed");
    expect(result.current.stack.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("re-seeds when the server changes", async () => {
    listClosedWindowsMock.mockImplementation((server) =>
      Promise.resolve(server === "srv-two" ? [rec("x")] : []),
    );
    const { result, rerender } = renderHook(
      ({ server }) => useRecentlyClosed(server),
      { initialProps: { server: "srv-one" } },
    );
    await act(async () => {});
    expect(result.current.stack).toEqual([]);

    rerender({ server: "srv-two" });
    await act(async () => {});
    expect(result.current.stack.map((r) => r.id)).toEqual(["x"]);
  });

  it("push unshifts newest-first and dedupes by record id", async () => {
    const { result } = renderHook(() => useRecentlyClosed("srv-push"));
    await act(async () => {});

    act(() => result.current.push(rec("1")));
    act(() => result.current.push(rec("2")));
    expect(result.current.stack.map((r) => r.id)).toEqual(["2", "1"]);

    // A re-push of an existing id moves it to the top, never duplicates it.
    act(() => result.current.push(rec("1")));
    expect(result.current.stack.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("pop removes the record and ignores unknown ids", async () => {
    const { result } = renderHook(() => useRecentlyClosed("srv-pop"));
    await act(async () => {});
    act(() => {
      result.current.push(rec("1"));
      result.current.push(rec("2"));
    });

    act(() => result.current.pop("2"));
    expect(result.current.stack.map((r) => r.id)).toEqual(["1"]);

    act(() => result.current.pop("nope"));
    expect(result.current.stack.map((r) => r.id)).toEqual(["1"]);
  });

  it("keeps stacks isolated per server across call sites", async () => {
    const a = renderHook(() => useRecentlyClosed("srv-iso-a"));
    const b = renderHook(() => useRecentlyClosed("srv-iso-b"));
    await act(async () => {});

    // The standalone push is what the kill flows use; both hooks see only
    // their own server's ring.
    act(() => pushRecentlyClosed("srv-iso-a", rec("1")));
    expect(a.result.current.stack.map((r) => r.id)).toEqual(["1"]);
    expect(b.result.current.stack).toEqual([]);

    act(() => popRecentlyClosed("srv-iso-b", "1"));
    expect(a.result.current.stack.map((r) => r.id)).toEqual(["1"]);
  });

  it("stays hidden (empty stack) when the seed fetch fails", async () => {
    listClosedWindowsMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useRecentlyClosed("srv-fail"));
    await act(async () => {});
    expect(result.current.stack).toEqual([]);
  });
});

describe("buildReopenWindowAction", () => {
  it("yields no entry on an empty stack (the chord falls through untouched)", () => {
    expect(buildReopenWindowAction([], () => {})).toEqual([]);
  });

  it("describes the top record and wires the reopen callback", () => {
    const onReopen = vi.fn();
    const entries = buildReopenWindowAction(
      [rec("1", "deploys", "web"), rec("2")],
      onReopen,
    );
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.id).toBe("reopen-window");
    expect(entry?.label).toBe("Tab: Reopen closed");
    expect(entry?.description).toBe("deploys — fresh shell in web");
    entry?.onSelect();
    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
