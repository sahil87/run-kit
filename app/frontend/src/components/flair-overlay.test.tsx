import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FlairOverlay } from "./flair-overlay";

// FlairOverlay unit tests: the component is TOTAL (any non-empty string
// renders the overlay span — CSS decides what paints), so these pin the two
// fixed contracts: the rest-state null and the multi-span child markup the
// globals.css treatments key on (dvd logo, 6 cube faces, 3 warp planes).
describe("FlairOverlay", () => {
  afterEach(cleanup);

  it("renders nothing for the rest states (undefined and empty string)", () => {
    const { container: a } = render(<FlairOverlay />);
    expect(a.firstChild).toBeNull();
    const { container: b } = render(<FlairOverlay flair="" />);
    expect(b.firstChild).toBeNull();
  });

  it("a universal state renders the bare overlay span (no children) with the row discipline classes", () => {
    const { container } = render(<FlairOverlay flair="nyan" />);
    const overlay = container.querySelector(".rk-flair-nyan");
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("aria-hidden")).toBe("true");
    expect(overlay!.className).toContain("absolute inset-0 z-[5] overflow-hidden pointer-events-none");
    // Sheet treatments paint from the overlay's own backgrounds — no child spans.
    expect(overlay!.children).toHaveLength(0);
  });

  it("tetris and invaders (tile-only sheet treatments) also render the bare span", () => {
    for (const state of ["tetris", "invaders"]) {
      const { container } = render(<FlairOverlay flair={state} />);
      const overlay = container.querySelector(`.rk-flair-${state}`);
      expect(overlay).not.toBeNull();
      expect(overlay!.children).toHaveLength(0);
    }
  });

  it("dvd renders the nested .rk-dvd > .rk-dvd-logo markup", () => {
    const { container } = render(<FlairOverlay flair="dvd" />);
    const overlay = container.querySelector(".rk-flair-dvd");
    expect(overlay).not.toBeNull();
    const dvd = overlay!.querySelector(".rk-dvd");
    expect(dvd).not.toBeNull();
    expect(dvd!.children).toHaveLength(1);
    expect(dvd!.querySelector(".rk-dvd-logo")).not.toBeNull();
  });

  it("cube renders .rk-cube with exactly SIX .rk-cube-face children", () => {
    const { container } = render(<FlairOverlay flair="cube" />);
    const overlay = container.querySelector(".rk-flair-cube");
    expect(overlay).not.toBeNull();
    const cube = overlay!.querySelector(".rk-cube");
    expect(cube).not.toBeNull();
    expect(cube!.querySelectorAll(":scope > .rk-cube-face")).toHaveLength(6);
  });

  it("warp renders exactly THREE .rk-warp-plane children", () => {
    const { container } = render(<FlairOverlay flair="warp" />);
    const overlay = container.querySelector(".rk-flair-warp");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelectorAll(":scope > .rk-warp-plane")).toHaveLength(3);
  });

  it("is total: an unknown value still mounts the span (CSS decides what paints — gating lives at call sites)", () => {
    const { container } = render(<FlairOverlay flair="bogus" />);
    expect(container.querySelector(".rk-flair-bogus")).not.toBeNull();
  });
});
