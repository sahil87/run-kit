import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// Client seam: fetchCodeWorkspace is the hook's only I/O; the spy controls
// the resolve shape per test.
const fetchCodeWorkspace = vi.hoisted(() => vi.fn());
vi.mock("@/api/client", () => ({
  fetchCodeWorkspace: (...args: unknown[]) => fetchCodeWorkspace(...args),
}));

import { useCodeWorkspace } from "./use-code-workspace";
import { codeServerSrc, codeServerWorkspaceSrc } from "@/components/code-surface";

const WS_PATH = "/state/run-kit/code/default/@7-3fa1c9.code-workspace";
const WIN = { gitRoot: "/repo", codeRoot: "/repo" };

beforeEach(() => {
  fetchCodeWorkspace.mockReset();
});
afterEach(cleanup);

describe("useCodeWorkspace — mount gating", () => {
  it("stays pending until the GET resolves, then exposes the ?workspace= src", async () => {
    let resolve!: (v: unknown) => void;
    fetchCodeWorkspace.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useCodeWorkspace("default", "@7", WIN, true, false));
    // Pending: the fetch is in flight, no src yet.
    expect(result.current.codeSrc).toBeNull();
    expect(fetchCodeWorkspace).toHaveBeenCalledWith("default", "@7");

    resolve({ status: "ok", path: WS_PATH, root: "/repo" });
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );
  });

  it("does not fetch while the substrate codeRoot is empty (never the gitRoot fallback)", () => {
    const { result } = renderHook(() =>
      useCodeWorkspace("default", "@7", { gitRoot: "/repo", codeRoot: "" }, true, false),
    );
    expect(fetchCodeWorkspace).not.toHaveBeenCalled();
    // Pre-seed renders are pending, not folder-mounted.
    expect(result.current.codeSrc).toBeNull();
  });

  it("does not fetch while the code tile is closed", () => {
    renderHook(() => useCodeWorkspace("default", "@7", WIN, false, false));
    expect(fetchCodeWorkspace).not.toHaveBeenCalled();
  });

  it("happy path unchanged: seed in flight ⇒ pending; the confirmed root arms the workspace mount", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    const { result, rerender } = renderHook(
      ({ win }) => useCodeWorkspace("default", "@7", win, true, false),
      { initialProps: { win: { gitRoot: "/repo", codeRoot: "" } } },
    );
    // Seed POST in flight (or not yet fired): pending, and no derivation GET.
    expect(result.current.codeSrc).toBeNull();
    expect(fetchCodeWorkspace).not.toHaveBeenCalled();
    // The option tick confirms the seed: the payload carries the root.
    rerender({ win: { gitRoot: "/repo", codeRoot: "/repo" } });
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );
  });

  it("a 409 keeps the pending state and re-fetches on the next payload change", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "no-root" });
    const { result, rerender } = renderHook(
      ({ win }) => useCodeWorkspace("default", "@7", win, true, false),
      { initialProps: { win: WIN } },
    );
    await waitFor(() => expect(fetchCodeWorkspace).toHaveBeenCalledTimes(1));
    expect(result.current.codeSrc).toBeNull();

    // The next payload change (a fresh window record) re-drives the effect;
    // the option has landed server-side by then, so the retry resolves.
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    rerender({ win: { ...WIN } });
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );
    expect(fetchCodeWorkspace).toHaveBeenCalledTimes(2);
  });

  it("a 500 degrades to the ?folder= src with exactly one console warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchCodeWorkspace.mockRejectedValue(new Error("ensure failed"));
    const { result, rerender } = renderHook(
      ({ win }) => useCodeWorkspace("default", "@7", win, true, false),
      { initialProps: { win: WIN } },
    );
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerSrc("/repo")),
    );
    expect(warn).toHaveBeenCalledTimes(1);

    // A degraded resolution is final for its (server, window, root): payload
    // ticks do not refetch — and never warn again.
    rerender({ win: { ...WIN } });
    await waitFor(() => expect(fetchCodeWorkspace).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a root change re-derives for future mounts (the live frame ignores it)", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    const { result, rerender } = renderHook(
      ({ win }) => useCodeWorkspace("default", "@7", win, true, false),
      { initialProps: { win: WIN } },
    );
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );

    const otherPath = "/state/run-kit/code/default/@7-bbbbbb.code-workspace";
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: otherPath, root: "/other" });
    rerender({ win: { gitRoot: "/other", codeRoot: "/other" } });
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(otherPath)),
    );
  });
});

describe("useCodeWorkspace — follow rule", () => {
  it("followFolder re-derives the workspace and exposes a nonce-keyed followSrc", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    const { result } = renderHook(() => useCodeWorkspace("default", "@7", WIN, true, false));
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );

    const newPath = "/state/run-kit/code/default/@7-cccccc.code-workspace";
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: newPath, root: "/other" });
    act(() => result.current.followFolder("/other"));
    await waitFor(() =>
      expect(result.current.followSrc).toEqual({
        src: codeServerWorkspaceSrc(newPath),
        nonce: 1,
      }),
    );
    // A second navigation bumps the nonce — each follow is a fresh license.
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    act(() => result.current.followFolder("/repo"));
    await waitFor(() => expect(result.current.followSrc?.nonce).toBe(2));
  });

  it("a failed follow leaves the editor at its own ?folder= navigation", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    const { result } = renderHook(() => useCodeWorkspace("default", "@7", WIN, true, false));
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );

    fetchCodeWorkspace.mockRejectedValue(new Error("boom"));
    act(() => result.current.followFolder("/other"));
    await waitFor(() => expect(fetchCodeWorkspace).toHaveBeenCalledTimes(2));
    expect(result.current.followSrc).toBeNull();
  });

  it("followSrc is scoped to its window (a window switch drops it)", async () => {
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/repo" });
    const { result, rerender } = renderHook(
      ({ windowId }) =>
        useCodeWorkspace("default", windowId, { gitRoot: "/repo", codeRoot: "/repo" }, true, false),
      { initialProps: { windowId: "@7" } },
    );
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );
    act(() => result.current.followFolder("/other"));
    await waitFor(() => expect(result.current.followSrc?.nonce).toBe(1));

    rerender({ windowId: "@8" });
    expect(result.current.followSrc).toBeNull();
  });
});


describe("useCodeWorkspace — seed-refusal degrade", () => {
  it("a refused seed POST degrades to the ?folder= src instead of pending forever", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const win = { gitRoot: "/opt/repo", codeRoot: "" };
    const { result, rerender } = renderHook(
      ({ seedRejected }) => useCodeWorkspace("default", "@7", win, true, seedRejected),
      { initialProps: { seedRejected: false } },
    );
    // Seed POST in flight / not yet fired: pending remains correct.
    expect(result.current.codeSrc).toBeNull();

    // The backend refused the seed (e.g. /opt is outside $HOME): the
    // substrate root can never arrive, so the tile mounts the folder form.
    rerender({ seedRejected: true });
    await waitFor(() => expect(result.current.codeSrc).toBe(codeServerSrc("/opt/repo")));
    expect(fetchCodeWorkspace).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    // Payload ticks re-run the effect but never re-warn for the same key.
    rerender({ seedRejected: true });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a later successful seed re-arms the workspace path (it wins over the fallback)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ win, seedRejected }) => useCodeWorkspace("default", "@7", win, true, seedRejected),
      {
        initialProps: {
          win: { gitRoot: "/opt/repo", codeRoot: "" },
          seedRejected: true,
        },
      },
    );
    await waitFor(() => expect(result.current.codeSrc).toBe(codeServerSrc("/opt/repo")));

    // The retry landed: the payload now carries the substrate root, and the
    // derivation GET resolves the workspace path as usual.
    fetchCodeWorkspace.mockResolvedValue({ status: "ok", path: WS_PATH, root: "/opt/repo" });
    rerender({ win: { gitRoot: "/opt/repo", codeRoot: "/opt/repo" }, seedRejected: false });
    await waitFor(() =>
      expect(result.current.codeSrc).toBe(codeServerWorkspaceSrc(WS_PATH)),
    );
    warn.mockRestore();
  });
});
