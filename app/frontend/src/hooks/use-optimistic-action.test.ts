import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptimisticAction } from "./use-optimistic-action";

describe("useOptimisticAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with isPending false", () => {
    const { result } = renderHook(() =>
      useOptimisticAction({ action: () => Promise.resolve() }),
    );
    expect(result.current.isPending).toBe(false);
  });

  it("calls onOptimistic synchronously before the API call", () => {
    const order: string[] = [];
    const action = vi.fn(() => {
      order.push("action");
      return Promise.resolve();
    });
    const onOptimistic = vi.fn(() => order.push("optimistic"));

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onOptimistic }),
    );

    act(() => {
      result.current.execute();
    });

    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("optimistic");
    expect(order[1]).toBe("action");
  });

  it("sets isPending true during action and false after success", async () => {
    let resolve: () => void;
    const action = () => new Promise<void>((r) => { resolve = r; });

    const { result } = renderHook(() =>
      useOptimisticAction({ action }),
    );

    act(() => {
      result.current.execute();
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolve!();
    });

    expect(result.current.isPending).toBe(false);
  });

  it("calls onSettled on success", async () => {
    const onSettled = vi.fn();
    const action = () => Promise.resolve();

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onSettled }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("calls onRollback and onError on failure", async () => {
    const onRollback = vi.fn();
    const onError = vi.fn();
    const error = new Error("network failure");
    const action = () => Promise.reject(error);

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onRollback, onError }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(result.current.isPending).toBe(false);
  });

  it("wraps non-Error rejections in an Error", async () => {
    const onError = vi.fn();
    const action = () => Promise.reject("string error");

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onError }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const received = onError.mock.calls[0][0];
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe("string error");
  });

  it("does not call onSettled on failure", async () => {
    const onSettled = vi.fn();
    const action = () => Promise.reject(new Error("fail"));

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onSettled, onError: () => {} }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it("does not call onRollback on success", async () => {
    const onRollback = vi.fn();
    const action = () => Promise.resolve();

    const { result } = renderHook(() =>
      useOptimisticAction({ action, onRollback }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(onRollback).not.toHaveBeenCalled();
  });

  it("passes execute args to onOptimistic", async () => {
    const onOptimistic = vi.fn();
    const action = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useOptimisticAction<[string, number]>({ action, onOptimistic }),
    );

    await act(async () => {
      result.current.execute("my-session", 42);
    });

    expect(onOptimistic).toHaveBeenCalledWith("my-session", 42);
    expect(action).toHaveBeenCalledWith("my-session", 42);
  });

  it("works with only action provided (minimal usage)", async () => {
    const action = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() =>
      useOptimisticAction({ action }),
    );

    await act(async () => {
      result.current.execute();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });

  it("skips state updates after unmount", async () => {
    let resolve: () => void;
    const action = () => new Promise<void>((r) => { resolve = r; });
    const onSettled = vi.fn();

    const { result, unmount } = renderHook(() =>
      useOptimisticAction({ action, onSettled }),
    );

    act(() => {
      result.current.execute();
    });

    expect(result.current.isPending).toBe(true);

    unmount();

    // Resolve after unmount — should not throw or update state
    await act(async () => {
      resolve!();
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it("skips rollback/error callbacks after unmount", async () => {
    let reject: (err: Error) => void;
    const action = () => new Promise<void>((_, r) => { reject = r; });
    const onRollback = vi.fn();
    const onError = vi.fn();

    const { result, unmount } = renderHook(() =>
      useOptimisticAction({ action, onRollback, onError }),
    );

    act(() => {
      result.current.execute();
    });

    unmount();

    await act(async () => {
      reject!(new Error("fail"));
    });

    expect(onRollback).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("full lifecycle: optimistic → API success → settled", async () => {
    const lifecycle: string[] = [];
    let resolve: () => void;
    const action = () => new Promise<void>((r) => { resolve = r; });

    const { result } = renderHook(() =>
      useOptimisticAction({
        action,
        onOptimistic: () => lifecycle.push("optimistic"),
        onSettled: () => lifecycle.push("settled"),
        onRollback: () => lifecycle.push("rollback"),
        onError: () => lifecycle.push("error"),
      }),
    );

    act(() => {
      result.current.execute();
    });

    expect(lifecycle).toEqual(["optimistic"]);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolve!();
    });

    expect(lifecycle).toEqual(["optimistic", "settled"]);
    expect(result.current.isPending).toBe(false);
  });

  it("full lifecycle: optimistic → API failure → rollback + error", async () => {
    const lifecycle: string[] = [];
    let reject: (err: Error) => void;
    const action = () => new Promise<void>((_, r) => { reject = r; });

    const { result } = renderHook(() =>
      useOptimisticAction({
        action,
        onOptimistic: () => lifecycle.push("optimistic"),
        onSettled: () => lifecycle.push("settled"),
        onRollback: () => lifecycle.push("rollback"),
        onError: () => lifecycle.push("error"),
      }),
    );

    act(() => {
      result.current.execute();
    });

    expect(lifecycle).toEqual(["optimistic"]);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      reject!(new Error("API down"));
    });

    expect(lifecycle).toEqual(["optimistic", "rollback", "error"]);
    expect(result.current.isPending).toBe(false);
  });
});
