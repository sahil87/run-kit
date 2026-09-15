import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ScreenBreak } from "./screen-break";
import {
  _resetForTests,
  fire,
  finish,
  getState,
  registerGlass,
} from "@/lib/screen-break-store";

/**
 * The ScreenBreak layer against a registered glass div: idle renders null;
 * a force fire mounts the layer and mutates the glass inline; reaching t = 1
 * (or unmounting mid-flight) clears every glass mutation and unmounts the
 * layer. jsdom has no SVG geometry — stroke lengths fall back to 1 — and no
 * rAF without pretendToBeVisual, so requestAnimationFrame is stubbed with a
 * steppable queue.
 */

let rafQueue: FrameRequestCallback[] = [];

function stubRaf() {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

function stepTo(now: number) {
  const cbs = rafQueue;
  rafQueue = [];
  for (const cb of cbs) act(() => cb(now));
}

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

describe("ScreenBreak", () => {
  let glass: HTMLDivElement;

  beforeEach(() => {
    _resetForTests();
    localStorage.clear();
    stubMotion(false);
    stubRaf();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    glass = document.createElement("div");
    document.body.appendChild(glass);
    registerGlass(glass);
  });
  afterEach(() => {
    cleanup();
    glass.remove();
    _resetForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders null while idle — no layer, no glass mutations", () => {
    render(<ScreenBreak />);
    expect(screen.queryByTestId("screen-break")).toBeNull();
    expect(glass.style.clipPath).toBe("");
    expect(glass.style.transform).toBe("");
  });

  it("mounts on fire with both clip paths and clips the glass inline", () => {
    render(<ScreenBreak />);
    act(() => {
      expect(fire("smash", { force: true })).toBe(true);
    });
    expect(screen.getByTestId("screen-break")).toBeInTheDocument();
    expect(document.getElementById("rk-sb-appclip")).not.toBeNull();
    expect(document.getElementById("rk-sb-hole")).not.toBeNull();
    expect(glass.style.clipPath).toBe("url(\"#rk-sb-appclip\")");
    expect(glass.style.zIndex).toBe("1");
    // jsdom computes the plain div as static → the layer positions it.
    expect(glass.style.position).toBe("relative");
  });

  it("clears every glass mutation and unmounts when the flight reaches t = 1", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const startedAt = getState().flight!.startedAt;
    stepTo(startedAt + 100);
    expect(screen.getByTestId("screen-break")).toBeInTheDocument();
    stepTo(startedAt + 4300);
    expect(screen.queryByTestId("screen-break")).toBeNull();
    expect(getState().flight).toBeNull();
    expect(glass.style.clipPath).toBe("");
    expect(glass.style.transform).toBe("");
    expect(glass.style.position).toBe("");
    expect(glass.style.zIndex).toBe("");
  });

  it("clears the glass on a mid-flight unmount", () => {
    const { unmount } = render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const startedAt = getState().flight!.startedAt;
    stepTo(startedAt + 100);
    expect(glass.style.clipPath).toBe("url(\"#rk-sb-appclip\")");
    unmount();
    expect(glass.style.clipPath).toBe("");
    expect(glass.style.transform).toBe("");
    expect(glass.style.position).toBe("");
    expect(glass.style.zIndex).toBe("");
  });

  it("at t = 0.5 the fist has released to the unclipped above-glass slot", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const startedAt = getState().flight!.startedAt;
    stepTo(startedAt + 2100);
    const inside = document.querySelector<HTMLElement>('[data-part="creature-inside"]')!;
    const above = document.querySelector<HTMLElement>('[data-part="creature-above"]')!;
    expect(inside.style.opacity).toBe("0");
    expect(above.style.opacity).toBe("1");
    expect(above.style.clipPath).toBe("");
    act(() => finish());
  });

  it("at t = 0.5 the eye stays clipped to the hole in the below-glass slot", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("peek", { force: true });
    });
    const startedAt = getState().flight!.startedAt;
    stepTo(startedAt + 2100);
    const inside = document.querySelector<HTMLElement>('[data-part="creature-inside"]')!;
    const above = document.querySelector<HTMLElement>('[data-part="creature-above"]')!;
    expect(inside.style.clipPath).toBe("url(\"#rk-sb-hole\")");
    expect(inside.style.opacity).toBe("1");
    expect(above.style.opacity).toBe("0");
    act(() => finish());
  });

  it("reduced motion: fire is a no-op and nothing mounts", () => {
    stubMotion(true);
    render(<ScreenBreak />);
    act(() => {
      expect(fire("smash", { force: true })).toBe(false);
    });
    expect(screen.queryByTestId("screen-break")).toBeNull();
    expect(glass.style.clipPath).toBe("");
  });
});
