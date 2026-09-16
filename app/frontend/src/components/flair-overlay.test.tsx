import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FlairOverlay } from "./flair-overlay";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The single mount for row flair overlays: the overlay span carries
// `rk-flair-{value}`; EVERY flair renders one child span per moving layer
// (the compositor-only rule — no animated pseudo-elements), DOM order = paint
// order, and the drag-source guard hides the whole overlay for every flair
// (transforms on child spans would corrupt the drag ghost).

// The per-flair layer contract: the overlay's direct children in paint order
// (ambient layers first, the character last). cube/warp/nemo keep their
// bespoke nested markup and are asserted separately below.
const LAYER_CONTRACTS: Record<string, { layers: string[]; sheets: Record<string, string> }> = {
  rain: { layers: ["rk-rain-lane-a", "rk-rain-lane-b"], sheets: {} },
  scan: { layers: ["rk-scan-crawl", "rk-scan-band"], sheets: {} },
  nyan: {
    layers: ["rk-nyan-stars", "rk-nyan-cat", "rk-nyan-trail"],
    sheets: {
      "rk-nyan-stars": "rk-nyan-stars-sheet",
      "rk-nyan-cat": "rk-nyan-cat-sheet",
      "rk-nyan-trail": "rk-nyan-trail-sheet",
    },
  },
  naruto: {
    layers: ["rk-naruto-streaks", "rk-naruto-runner", "rk-naruto-trail"],
    sheets: {
      "rk-naruto-runner": "rk-naruto-runner-sheet",
      "rk-naruto-trail": "rk-naruto-trail-sheet",
    },
  },
  onepiece: {
    layers: ["rk-onepiece-wave-a", "rk-onepiece-wave-b", "rk-onepiece-ship"],
    sheets: { "rk-onepiece-ship": "rk-onepiece-ship-sheet" },
  },
  pacman: {
    layers: ["rk-pacman-ghost", "rk-pacman-dots", "rk-pacman-chomp"],
    sheets: {
      "rk-pacman-ghost": "rk-pacman-ghost-sheet",
      "rk-pacman-chomp": "rk-pacman-chomp-sheet",
    },
  },
  matrix: { layers: ["rk-matrix-fall-a", "rk-matrix-fall-b", "rk-matrix-fall-c"], sheets: {} },
  aquarium: {
    layers: ["rk-aquarium-bubbles", "rk-aquarium-weed", "rk-aquarium-blue", "rk-aquarium-orange"],
    sheets: {
      "rk-aquarium-weed": "rk-aquarium-weed-sheet",
      "rk-aquarium-blue": "rk-aquarium-blue-sheet",
      "rk-aquarium-orange": "rk-aquarium-orange-sheet",
    },
  },
  roadrunner: {
    layers: ["rk-roadrunner-streaks", "rk-roadrunner-bird"],
    sheets: { "rk-roadrunner-bird": "rk-roadrunner-bird-sheet" },
  },
  invaders: {
    layers: ["rk-invaders-trio"],
    sheets: { "rk-invaders-trio": "rk-invaders-trio-sheet" },
  },
  spidey: {
    layers: ["rk-spidey-city", "rk-spidey-figure"],
    sheets: { "rk-spidey-figure": "rk-spidey-figure-sheet" },
  },
  ironman: {
    layers: ["rk-ironman-city-far", "rk-ironman-city-near", "rk-ironman-figure"],
    sheets: { "rk-ironman-figure": "rk-ironman-figure-sheet" },
  },
  noon: {
    layers: ["rk-noon-dust", "rk-noon-wordmark"],
    sheets: { "rk-noon-wordmark": "rk-noon-wordmark-sheet" },
  },
};

describe("FlairOverlay", () => {
  it("renders the layer contract for every sheet/ambience flair: children in paint order, frame box + inner sheet per stepped sprite", () => {
    for (const [flair, contract] of Object.entries(LAYER_CONTRACTS)) {
      const { container } = render(<FlairOverlay flair={flair} />);
      const overlay = container.querySelector(`.rk-flair-${flair}`);
      expect(overlay, flair).not.toBeNull();
      expect(overlay!.getAttribute("aria-hidden")).toBe("true");
      expect(overlay!.className).toContain("pointer-events-none");
      expect(
        Array.from(overlay!.children).map((el) => el.className),
        flair,
      ).toEqual(contract.layers);
      for (const [box, sheet] of Object.entries(contract.sheets)) {
        const frameBox = overlay!.querySelector(`:scope > .${box}`);
        expect(frameBox, `${flair} ${box}`).not.toBeNull();
        expect(
          Array.from(frameBox!.children).map((el) => el.className),
          `${flair} ${box}`,
        ).toEqual([sheet]);
      }
      cleanup();
    }
  });

  it("renders the cube markup contract: nested wrappers + 6 faces", () => {
    const { container } = render(<FlairOverlay flair="cube" />);
    const cube = container.querySelector(".rk-flair-cube .rk-cube-x .rk-cube-y .rk-cube");
    expect(cube).not.toBeNull();
    expect(cube!.querySelectorAll(":scope > .rk-cube-face")).toHaveLength(6);
  });

  it("renders the warp markup contract: three starfield planes", () => {
    const { container } = render(<FlairOverlay flair="warp" />);
    expect(container.querySelectorAll(".rk-flair-warp .rk-warp-plane")).toHaveLength(3);
  });

  it("renders the nemo markup contract: bubbles + 2 fish (orange + blue, each tail + fin + body) + 1 weed of 3 blades", () => {
    const { container } = render(<FlairOverlay flair="nemo" />);
    const overlay = container.querySelector(".rk-flair-nemo");
    expect(overlay).not.toBeNull();
    // Bubbles first (the former ::before ambience), then the two fish and the
    // weed clump in paint order.
    expect(Array.from(overlay!.children).map((el) => el.className)).toEqual([
      "rk-nemo-bubbles",
      "rk-nemo-fish rk-nemo-orange",
      "rk-nemo-fish rk-nemo-blue",
      "rk-nemo-weed",
    ]);
    // Each fish splits into tail + fin + body in paint order (tail and fin
    // behind, body on top covering their roots) so the parts can articulate
    // on their own hinges.
    for (const fish of ["rk-nemo-orange", "rk-nemo-blue"]) {
      const parts = Array.from(overlay!.querySelector(`.${fish}`)!.children).map(
        (el) => el.className,
      );
      expect(parts).toEqual(["rk-nemo-tail", "rk-nemo-fin", "rk-nemo-body"]);
    }
    const weed = overlay!.querySelectorAll(":scope > .rk-nemo-weed");
    expect(weed).toHaveLength(1);
    expect(weed[0].querySelectorAll(":scope > .rk-nemo-blade")).toHaveLength(3);
    // The manta and the enriched scene were both rejected: no manta
    // wrappers, no layers, shafts or floor may exist.
    expect(
      overlay!.querySelectorAll(
        "[class*='rk-nemo-manta'], .rk-nemo-layer, .rk-nemo-shafts, .rk-nemo-floor",
      ),
    ).toHaveLength(0);
  });

  it("renders nothing without a flair value", () => {
    const { container } = render(<FlairOverlay flair={undefined} />);
    expect(container.querySelector("[class*='rk-flair-']")).toBeNull();
    const { container: empty } = render(<FlairOverlay flair="" />);
    expect(empty.querySelector("[class*='rk-flair-']")).toBeNull();
  });

  it("hidden (drag source) suppresses the overlay for every flair", () => {
    for (const flair of ["nyan", "cube", "warp", "nemo"]) {
      const { container } = render(<FlairOverlay flair={flair} hidden />);
      expect(container.querySelector("[class*='rk-flair-']")).toBeNull();
    }
  });

  it("rest state restores the overlay after a drag (hidden toggles off)", () => {
    const { container, rerender } = render(<FlairOverlay flair="cube" hidden />);
    expect(container.querySelector(".rk-flair-cube")).toBeNull();
    rerender(<FlairOverlay flair="cube" hidden={false} />);
    expect(container.querySelector(".rk-flair-cube .rk-cube")).not.toBeNull();
  });

  it("the color prop sets --rk-flair-color inline (the rain/scan tint source)", () => {
    const { container } = render(<FlairOverlay flair="rain" color="#123456" />);
    const overlay = container.querySelector(".rk-flair-rain") as HTMLElement;
    expect(overlay.style.getPropertyValue("--rk-flair-color")).toBe("#123456");
    // Omitted: no inline property — the CSS falls back to --color-border.
    const { container: bare } = render(<FlairOverlay flair="scan" />);
    expect(
      (bare.querySelector(".rk-flair-scan") as HTMLElement).style.getPropertyValue("--rk-flair-color"),
    ).toBe("");
  });

  it("writes the rounded integer width to --rk-flair-w via a ResizeObserver, disconnecting on unmount", async () => {
    let callback: ResizeObserverCallback | null = null;
    const observed: Element[] = [];
    const unobserved: Element[] = [];
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve(el: Element) {
        unobserved.push(el);
      }
      disconnect() {}
    }
    // The module-level shared observer is created on first use, so the mock
    // must be installed before the component module is (re-)loaded.
    vi.resetModules();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { FlairOverlay: FreshOverlay } = await import("./flair-overlay");
    const { container, unmount } = render(<FreshOverlay flair="pacman" />);
    const overlay = container.querySelector(".rk-flair-pacman") as HTMLElement;
    expect(observed).toContain(overlay);
    expect(callback).not.toBeNull();
    // Quantized steps() counts need the rounded integer CSS width.
    callback!(
      [{ target: overlay, contentRect: { width: 219.6 } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    expect(overlay.style.getPropertyValue("--rk-flair-w")).toBe("220");
    unmount();
    expect(unobserved).toContain(overlay);
  });

  it("mounts without a ResizeObserver implementation (CSS falls back to 240)", async () => {
    vi.resetModules();
    vi.stubGlobal("ResizeObserver", undefined);
    const { FlairOverlay: FreshOverlay } = await import("./flair-overlay");
    const { container } = render(<FreshOverlay flair="nyan" />);
    expect(container.querySelector(".rk-flair-nyan")).not.toBeNull();
  });
});
