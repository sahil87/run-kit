import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useScreenBreakTriggers } from "./use-screen-break-triggers";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { SessionContextType } from "@/contexts/session-context";
import * as store from "@/lib/screen-break-store";
import { PEEK_KEY } from "@/lib/screen-break-store";
import type { ProjectSession, WindowInfo } from "@/types";

/**
 * The automatic triggers: the fist fires only on an observed non-merged →
 * merged flip of the VIEWED window (identity = PR number); the eye fires on
 * the UpdateChip's showChip becoming true or its key changing while lit
 * (identity = key). `fire` is spied on the real store module, so the store's
 * gates (once-per-identity, in-flight drop) stay under test.
 */

let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];

vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
}));

function win(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    windowId: "@1",
    index: 0,
    name: "win",
    worktreePath: "/tmp",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

function sessions(windows: WindowInfo[]): Map<string, ProjectSession[]> {
  return new Map([["srv1", [{ name: "main", windows }]]]);
}

function updateAvailable(key: string): SessionContextType["updateAvailable"] {
  return { tools: [{ tool: "run-kit", current: "3.8.0", latest: "3.9.0" }], key, current: "3.8.0", latest: "3.9.0" };
}

function Probe() {
  useScreenBreakTriggers();
  return null;
}

function renderTriggers(value: Partial<SessionContextType>) {
  return render(
    <StandaloneSessionContextProvider value={value}>
      <Probe />
    </StandaloneSessionContextProvider>,
  );
}

describe("useScreenBreakTriggers — smash (PR merged)", () => {
  beforeEach(() => {
    store._resetForTests();
    localStorage.clear();
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
  });
  afterEach(() => {
    cleanup();
    store._resetForTests();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("an observed open → merged flip on the viewed window fires once with the PR number", () => {
    const fire = vi.spyOn(store, "fire");
    const { rerender } = renderTriggers({
      sessionsByServer: sessions([win({ windowId: "@1", prState: "open", prNumber: 984 })]),
    });
    expect(fire).not.toHaveBeenCalled();

    rerender(
      <StandaloneSessionContextProvider
        value={{ sessionsByServer: sessions([win({ windowId: "@1", prState: "merged", prNumber: 984 })]) }}
      >
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(fire).toHaveBeenCalledExactlyOnceWith("smash", { identity: "984" });
    expect(store.getState().flight?.egg).toBe("smash");
  });

  it("a window first observed as merged never fires", () => {
    const fire = vi.spyOn(store, "fire");
    renderTriggers({
      sessionsByServer: sessions([win({ windowId: "@1", prState: "merged", prNumber: 984 })]),
    });
    expect(fire).not.toHaveBeenCalled();
  });

  it("switching windows resets the observed-previous — the new window's merged state does not fire", () => {
    const fire = vi.spyOn(store, "fire");
    const { rerender } = renderTriggers({
      sessionsByServer: sessions([
        win({ windowId: "@1", prState: "open", prNumber: 984 }),
        win({ windowId: "@2", index: 1, prState: "merged", prNumber: 985 }),
      ]),
    });
    mockMatches = [{ params: { server: "srv1", window: "@2" } }];
    rerender(
      <StandaloneSessionContextProvider
        value={{
          sessionsByServer: sessions([
            win({ windowId: "@1", prState: "open", prNumber: 984 }),
            win({ windowId: "@2", index: 1, prState: "merged", prNumber: 985 }),
          ]),
        }}
      >
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(fire).not.toHaveBeenCalled();
  });

  it("a merged flip without a prNumber does not fire", () => {
    const fire = vi.spyOn(store, "fire");
    const { rerender } = renderTriggers({
      sessionsByServer: sessions([win({ windowId: "@1", prState: "open" })]),
    });
    rerender(
      <StandaloneSessionContextProvider
        value={{ sessionsByServer: sessions([win({ windowId: "@1", prState: "merged" })]) }}
      >
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(fire).not.toHaveBeenCalled();
  });

  it("a route without a window param (board/host/server) never fires", () => {
    const fire = vi.spyOn(store, "fire");
    mockMatches = [{ params: { name: "main" } }];
    renderTriggers({
      sessionsByServer: sessions([win({ windowId: "@1", prState: "merged", prNumber: 984 })]),
    });
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("useScreenBreakTriggers — peek (update available)", () => {
  beforeEach(() => {
    store._resetForTests();
    localStorage.clear();
    mockMatches = [{ params: {} }];
  });
  afterEach(() => {
    cleanup();
    store._resetForTests();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("showChip false → true fires the eye with the update key", () => {
    const fire = vi.spyOn(store, "fire");
    const { rerender } = renderTriggers({ daemonVersion: "3.8.0", updateAvailable: null });
    expect(fire).not.toHaveBeenCalled();

    rerender(
      <StandaloneSessionContextProvider
        value={{ daemonVersion: "3.8.0", updateAvailable: updateAvailable("run-kit@3.9.0") }}
      >
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(fire).toHaveBeenCalledExactlyOnceWith("peek", { identity: "run-kit@3.9.0" });
    expect(store.getState().flight?.egg).toBe("peek");
  });

  it("a first observation with the chip lit fires (arrival counts once per release)", () => {
    const fire = vi.spyOn(store, "fire");
    renderTriggers({ daemonVersion: "3.8.0", updateAvailable: updateAvailable("run-kit@3.9.0") });
    expect(fire).toHaveBeenCalledExactlyOnceWith("peek", { identity: "run-kit@3.9.0" });
  });

  it("a reload with the chip already lit for the stored key does not fire; a new key does", () => {
    localStorage.setItem(PEEK_KEY, "run-kit@3.9.0");
    const fire = vi.spyOn(store, "fire");
    const { rerender } = renderTriggers({
      daemonVersion: "3.8.0",
      updateAvailable: updateAvailable("run-kit@3.9.0"),
    });
    // fire is CALLED (the hook observed the arrival) but the store's
    // once-per-identity gate drops it — no flight starts.
    expect(store.getState().flight).toBeNull();

    rerender(
      <StandaloneSessionContextProvider
        value={{ daemonVersion: "3.9.0", updateAvailable: updateAvailable("run-kit@3.10.0") }}
      >
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(fire).toHaveBeenLastCalledWith("peek", { identity: "run-kit@3.10.0" });
    expect(store.getState().flight?.egg).toBe("peek");
    expect(localStorage.getItem(PEEK_KEY)).toBe("run-kit@3.10.0");
  });
});
