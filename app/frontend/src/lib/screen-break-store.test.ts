import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _resetForTests,
  easterEggsEnabled,
  fire,
  finish,
  getState,
  PEEK_KEY,
  seedEasterEggsEnabled,
  setEasterEggsEnabled,
  SMASH_KEY,
  subscribe,
} from "./screen-break-store";

function stubMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function stubWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("screen-break store", () => {
  beforeEach(() => {
    _resetForTests();
    localStorage.clear();
    stubMotion(false);
    stubWidth(1280);
  });
  afterEach(() => {
    _resetForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("fire starts a flight with impact/radius/viewport and notifies subscribers", () => {
    const seen: (string | null)[] = [];
    subscribe(() => seen.push(getState().flight?.egg ?? null));
    expect(fire("smash", { force: true })).toBe(true);
    const flight = getState().flight;
    expect(flight?.egg).toBe("smash");
    expect(flight?.R).toBeCloseTo(134.4);
    expect(flight?.W).toBe(1280);
    expect(flight?.P.x).toBeGreaterThanOrEqual(320);
    expect(flight?.P.x).toBeLessThanOrEqual(960);
    expect(seen).toEqual(["smash"]);
  });

  it("reduced motion: fire returns false, no flight, nothing stored", () => {
    stubMotion(true);
    expect(fire("smash", { identity: "984" })).toBe(false);
    expect(getState().flight).toBeNull();
    expect(localStorage.getItem(SMASH_KEY)).toBeNull();
  });

  it("viewport below 640 px: fire returns false", () => {
    stubWidth(500);
    expect(fire("peek", { force: true })).toBe(false);
    expect(getState().flight).toBeNull();
  });

  it("a second fire while in flight is dropped, not queued", () => {
    expect(fire("smash", { force: true })).toBe(true);
    expect(fire("peek", { force: true })).toBe(false);
    expect(getState().flight?.egg).toBe("smash");
  });

  it("once per identity: the stored value never fires again", () => {
    expect(fire("smash", { identity: "984" })).toBe(true);
    expect(localStorage.getItem(SMASH_KEY)).toBe("984");
    finish();
    expect(fire("smash", { identity: "984" })).toBe(false);
    expect(getState().flight).toBeNull();
    // A different identity still fires.
    expect(fire("smash", { identity: "985" })).toBe(true);
    expect(localStorage.getItem(SMASH_KEY)).toBe("985");
  });

  it("identity is written before the flight starts (observable mid-fire)", () => {
    let observedDuringFire: string | null = null;
    subscribe(() => {
      observedDuringFire = localStorage.getItem(PEEK_KEY);
    });
    expect(fire("peek", { identity: "run-kit@3.9.0" })).toBe(true);
    expect(observedDuringFire).toBe("run-kit@3.9.0");
  });

  it("force bypasses the identity check and writes nothing", () => {
    localStorage.setItem(SMASH_KEY, "984");
    expect(fire("smash", { force: true, identity: "984" })).toBe(true);
    expect(localStorage.getItem(SMASH_KEY)).toBe("984");
  });

  it("disabled: a non-force fire returns false and writes no identity", () => {
    setEasterEggsEnabled(false);
    expect(fire("smash", { identity: "1" })).toBe(false);
    expect(getState().flight).toBeNull();
    expect(localStorage.getItem(SMASH_KEY)).toBeNull();
  });

  it("disabled: a force fire still starts and writes nothing", () => {
    setEasterEggsEnabled(false);
    expect(fire("smash", { force: true })).toBe(true);
    expect(getState().flight?.egg).toBe("smash");
    expect(localStorage.getItem(SMASH_KEY)).toBeNull();
  });

  it("re-enabling lets the same identity fire — a gated fire consumed nothing", () => {
    setEasterEggsEnabled(false);
    expect(fire("smash", { identity: "1" })).toBe(false);
    setEasterEggsEnabled(true);
    expect(fire("smash", { identity: "1" })).toBe(true);
    expect(localStorage.getItem(SMASH_KEY)).toBe("1");
  });

  it("_resetForTests restores the enabled default", () => {
    setEasterEggsEnabled(false);
    expect(easterEggsEnabled()).toBe(false);
    _resetForTests();
    expect(easterEggsEnabled()).toBe(true);
  });

  it("the mount-fetch seed applies when no flip was committed", () => {
    seedEasterEggsEnabled(false);
    expect(easterEggsEnabled()).toBe(false);
  });

  it("a committed flip wins over a mount-fetch seed resolving later", () => {
    setEasterEggsEnabled(false);
    seedEasterEggsEnabled(true);
    expect(easterEggsEnabled()).toBe(false);
  });

  it("_resetForTests clears the committed flag — a seed applies again", () => {
    setEasterEggsEnabled(false);
    _resetForTests();
    seedEasterEggsEnabled(false);
    expect(easterEggsEnabled()).toBe(false);
  });

  it("a throwing localStorage neither blocks nor breaks the fire", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(fire("peek", { identity: "run-kit@3.9.0" })).toBe(true);
    expect(getState().flight?.egg).toBe("peek");
    get.mockRestore();
    set.mockRestore();
  });

  it("finish clears the flight and notifies subscribers", () => {
    const seen: number[] = [];
    subscribe(() => seen.push(1));
    fire("smash", { force: true });
    finish();
    expect(getState().flight).toBeNull();
    expect(seen).toHaveLength(2);
    // finish with no flight is a no-op.
    finish();
    expect(seen).toHaveLength(2);
  });
});
