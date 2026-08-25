import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FlairOverlay } from "./flair-overlay";

afterEach(() => {
  cleanup();
});

// The single mount for row flair overlays (R9): the overlay span carries
// `rk-flair-{value}`; only the transform-driven treatments (cube/warp) get
// CHILD markup, and the drag-source guard hides the whole overlay for every
// flair (transforms on child spans would corrupt the drag ghost).
describe("FlairOverlay", () => {
  it("renders the bare overlay span for sheet flairs (no children)", () => {
    for (const flair of ["nyan", "spidey", "duel"]) {
      const { container } = render(<FlairOverlay flair={flair} />);
      const overlay = container.querySelector(`.rk-flair-${flair}`);
      expect(overlay).not.toBeNull();
      expect(overlay!.getAttribute("aria-hidden")).toBe("true");
      expect(overlay!.className).toContain("pointer-events-none");
      expect(overlay!.children).toHaveLength(0);
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

  it("renders nothing without a flair value", () => {
    const { container } = render(<FlairOverlay flair={undefined} />);
    expect(container.querySelector("[class*='rk-flair-']")).toBeNull();
    const { container: empty } = render(<FlairOverlay flair="" />);
    expect(empty.querySelector("[class*='rk-flair-']")).toBeNull();
  });

  it("hidden (drag source) suppresses the overlay for every flair", () => {
    for (const flair of ["nyan", "cube", "warp"]) {
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

  it("renders the tinted flairs (rain/scan) as bare spans — no child markup", () => {
    for (const flair of ["rain", "scan"]) {
      const { container } = render(<FlairOverlay flair={flair} />);
      const overlay = container.querySelector(`.rk-flair-${flair}`);
      expect(overlay).not.toBeNull();
      expect(overlay!.children).toHaveLength(0);
    }
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
});
