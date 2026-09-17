import { describe, it, expect, vi, afterEach } from "vitest";
import {
  installTerminalVisibilityShim,
  type TerminalVisibilityEntry,
} from "./terminal-visibility";

class FakeIntersectionObserver {
  constructor(_callback: unknown, _options?: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): unknown[] {
    return [];
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("installTerminalVisibilityShim", () => {
  afterEach(() => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  it("swaps window.IntersectionObserver until restore() puts the original back", () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const shim = installTerminalVisibilityShim(true);
    expect(window.IntersectionObserver).not.toBe(FakeIntersectionObserver);
    shim.restore();
    expect(window.IntersectionObserver).toBe(FakeIntersectionObserver);
  });

  it("delivers the initial visibility asynchronously on observe()", async () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const shim = installTerminalVisibilityShim(true);
    const seen: TerminalVisibilityEntry[] = [];
    const observer = new window.IntersectionObserver(((entries: TerminalVisibilityEntry[]) => {
      seen.push(...entries);
    }) as unknown as IntersectionObserverCallback);
    observer.observe(document.body);
    expect(seen).toEqual([]);
    await flushMicrotasks();
    expect(seen).toEqual([{ isIntersecting: true, intersectionRatio: 1 }]);
    shim.restore();
    shim.dispose();
  });

  it("reports run-kit-driven visibility changes, de-duplicated", async () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const shim = installTerminalVisibilityShim(false);
    const seen: TerminalVisibilityEntry[] = [];
    const observer = new window.IntersectionObserver(((entries: TerminalVisibilityEntry[]) => {
      seen.push(...entries);
    }) as unknown as IntersectionObserverCallback);
    observer.observe(document.body);
    await flushMicrotasks();
    expect(seen).toEqual([{ isIntersecting: false, intersectionRatio: 0 }]);
    shim.setLocallyVisible(true);
    shim.setLocallyVisible(true);
    shim.setLocallyVisible(false);
    expect(seen).toEqual([
      { isIntersecting: false, intersectionRatio: 0 },
      { isIntersecting: true, intersectionRatio: 1 },
      { isIntersecting: false, intersectionRatio: 0 },
    ]);
    shim.restore();
    shim.dispose();
  });

  it("pauses every handle while the document is hidden", async () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      const shim = installTerminalVisibilityShim(true);
      const seen: TerminalVisibilityEntry[] = [];
      const observer = new window.IntersectionObserver(((entries: TerminalVisibilityEntry[]) => {
        seen.push(...entries);
      }) as unknown as IntersectionObserverCallback);
      observer.observe(document.body);
      await flushMicrotasks();
      // A hidden document reports not-intersecting even for a visible tile.
      expect(seen).toEqual([{ isIntersecting: false, intersectionRatio: 0 }]);
      hiddenSpy.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(seen.at(-1)).toEqual({ isIntersecting: true, intersectionRatio: 1 });
      shim.restore();
      shim.dispose();
    } finally {
      hiddenSpy.mockRestore();
    }
  });

  it("stops reporting after disconnect() and after dispose()", async () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const shim = installTerminalVisibilityShim(true);
    const seen: TerminalVisibilityEntry[] = [];
    const observer = new window.IntersectionObserver(((entries: TerminalVisibilityEntry[]) => {
      seen.push(...entries);
    }) as unknown as IntersectionObserverCallback);
    observer.observe(document.body);
    await flushMicrotasks();
    observer.disconnect();
    shim.setLocallyVisible(false);
    expect(seen).toEqual([{ isIntersecting: true, intersectionRatio: 1 }]);
    shim.restore();
    shim.dispose();
  });

  it("restore() never clobbers an observer installed after the shim", () => {
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const shim = installTerminalVisibilityShim(true);
    class NewObserver {}
    window.IntersectionObserver = NewObserver as unknown as typeof IntersectionObserver;
    shim.restore();
    expect(window.IntersectionObserver).toBe(NewObserver);
    shim.dispose();
  });

  it("is a no-op when the platform has no IntersectionObserver", () => {
    const saved = window.IntersectionObserver;
    // @ts-expect-error — simulate an engine without the API
    delete window.IntersectionObserver;
    try {
      const shim = installTerminalVisibilityShim(true);
      expect("IntersectionObserver" in window).toBe(false);
      shim.setLocallyVisible(false);
      shim.restore();
      shim.dispose();
      expect("IntersectionObserver" in window).toBe(false);
    } finally {
      window.IntersectionObserver = saved;
    }
  });
});
