import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { ScreenBreak, ScreenBreakController } from "./screen-break";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { SessionContextType } from "@/contexts/session-context";
import type { SettingsEntry } from "@/api/client";
import {
  _resetForTests,
  easterEggsEnabled,
  fire,
  finish,
  getState,
  PEEK_KEY,
  registerGlass,
} from "@/lib/screen-break-store";

const getSettingsEntries = vi.fn();
vi.mock("@/api/client", () => ({
  getSettingsEntries: (...a: unknown[]) => getSettingsEntries(...a),
}));

vi.mock("@tanstack/react-router", () => ({
  useMatches: () => [{ params: {} }],
}));

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
    stepTo(startedAt + 12100);
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
    stepTo(startedAt + 6000);
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
    stepTo(startedAt + 6000);
    const inside = document.querySelector<HTMLElement>('[data-part="creature-inside"]')!;
    const above = document.querySelector<HTMLElement>('[data-part="creature-above"]')!;
    expect(inside.style.clipPath).toBe("url(\"#rk-sb-hole\")");
    expect(inside.style.opacity).toBe("1");
    expect(above.style.opacity).toBe("0");
    act(() => finish());
  });

  it("mounts the LCD svg with a glow+core line pair per dead-pixel line", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const lines = document.querySelectorAll(".rk-sb-lcd .rk-sb-lines line");
    // 5–8 dead-pixel lines × (glow + core).
    expect(lines.length % 2).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.length).toBeLessThanOrEqual(16);
    act(() => finish());
  });

  it("renders the frost circle first in the cracks svg, with its gradient in defs", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const cracks = document.querySelector(".rk-sb-cracks")!;
    const frost = cracks.firstElementChild;
    expect(frost?.tagName).toBe("circle");
    expect(frost?.classList.contains("rk-sb-frost")).toBe(true);
    const gradient = document.getElementById("rk-sb-frost");
    expect(gradient?.tagName).toBe("radialGradient");
    expect(frost?.getAttribute("fill")).toBe("url(#rk-sb-frost)");
    act(() => finish());
  });

  it("carries a stroke-width attribute on every crack path", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const paths = document.querySelectorAll(".rk-sb-cracks path");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(Number(p.getAttribute("stroke-width"))).toBeGreaterThan(0);
    }
    act(() => finish());
  });

  it("clicking the released fist dismisses: the flight heals fast and the glass is cleaned", () => {
    render(<ScreenBreak />);
    act(() => {
      fire("smash", { force: true });
    });
    const startedAt = getState().flight!.startedAt;
    stepTo(startedAt + 6000);
    const inside = document.querySelector<HTMLElement>('[data-part="creature-inside"]')!;
    const above = document.querySelector<HTMLElement>('[data-part="creature-above"]')!;
    // Only the visible slot may catch clicks — the hidden one is visibility:hidden.
    expect(inside.style.visibility).toBe("hidden");
    expect(above.style.visibility).toBe("visible");

    // jsdom's selector engine does not resolve `svg *` across the namespace boundary.
    const shape = above.querySelector("svg")!.firstElementChild!;
    vi.spyOn(performance, "now").mockReturnValue(startedAt + 6000);
    act(() => {
      fireEvent.click(shape);
    });
    expect(getState().flight!.dismissedAt).toBe(startedAt + 6000);

    // 1.5 s after the click the compressed heal has run past t = 1:
    // resume at 0.64 (the retreat) + 0.125 × 3 = 1.015 → finish.
    stepTo(startedAt + 6100);
    expect(screen.queryByTestId("screen-break")).not.toBeNull();
    stepTo(startedAt + 7500);
    expect(screen.queryByTestId("screen-break")).toBeNull();
    expect(getState().flight).toBeNull();
    expect(glass.style.clipPath).toBe("");
    expect(glass.style.transform).toBe("");
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

describe("ScreenBreakController — the easter_eggs mount fetch", () => {
  beforeEach(() => {
    _resetForTests();
    localStorage.clear();
    stubMotion(false);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    getSettingsEntries.mockReset();
  });
  afterEach(() => {
    cleanup();
    _resetForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function renderController() {
    // The triggers hook's contexts ride the standalone provider; the mocked
    // useMatches is a route with no window param, so no trigger fires.
    return render(
      <StandaloneSessionContextProvider value={{}}>
        <ScreenBreakController />
      </StandaloneSessionContextProvider>,
    );
  }

  function updateAvailable(key: string): SessionContextType["updateAvailable"] {
    return { tools: [{ tool: "run-kit", current: "3.8.0", latest: "3.9.0" }], key, current: "3.8.0", latest: "3.9.0" };
  }

  function renderControllerWithUpdate() {
    // The update chip is lit from the first render — the peek trigger's
    // arrival case is the one that can outrun the seed read.
    return render(
      <StandaloneSessionContextProvider
        value={{ daemonVersion: "3.8.0", updateAvailable: updateAvailable("run-kit@3.9.0") }}
      >
        <ScreenBreakController />
      </StandaloneSessionContextProvider>,
    );
  }

  function eggEntry(value: unknown): SettingsEntry {
    return {
      key: "easter_eggs",
      kind: "bool",
      default: "true",
      description: "",
      category: "behavior",
      ui: true,
      live: true,
      value,
    };
  }

  it("an easter_eggs: false entry disables the automatic occasions", async () => {
    getSettingsEntries.mockResolvedValue([
      {
        key: "easter_eggs",
        kind: "bool",
        default: "true",
        description: "",
        category: "behavior",
        ui: true,
        live: true,
        value: false,
      },
    ]);
    renderController();
    await waitFor(() => expect(easterEggsEnabled()).toBe(false));
  });

  it("a missing key keeps the store enabled (default on)", async () => {
    getSettingsEntries.mockResolvedValue([]);
    renderController();
    await waitFor(() => expect(getSettingsEntries).toHaveBeenCalled());
    await act(async () => {});
    expect(easterEggsEnabled()).toBe(true);
  });

  it("a rejected fetch keeps the store enabled", async () => {
    getSettingsEntries.mockRejectedValue(new Error("no API"));
    renderController();
    await act(async () => {});
    expect(easterEggsEnabled()).toBe(true);
  });

  it("the triggers stay unmounted until the seed read settles — a lit update chip cannot outrun a persisted off value", async () => {
    let resolveFetch: (entries: SettingsEntry[]) => void = () => {};
    getSettingsEntries.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );
    renderControllerWithUpdate();
    await act(async () => {});
    // Fetch still pending: no trigger has mounted, so the lit chip fired nothing.
    expect(getState().flight).toBeNull();
    expect(localStorage.getItem(PEEK_KEY)).toBeNull();

    await act(async () => {
      resolveFetch([eggEntry(false)]);
    });
    await waitFor(() => expect(easterEggsEnabled()).toBe(false));
    await act(async () => {});
    // The trigger's arrival observation now runs against the seeded off value.
    expect(getState().flight).toBeNull();
    expect(localStorage.getItem(PEEK_KEY)).toBeNull();
  });

  it("a lit update chip fires on arrival once the seed read settles with the store on", async () => {
    getSettingsEntries.mockResolvedValue([]);
    renderControllerWithUpdate();
    await waitFor(() => expect(getState().flight?.egg).toBe("peek"));
    expect(localStorage.getItem(PEEK_KEY)).toBe("run-kit@3.9.0");
    act(() => finish());
  });
});
