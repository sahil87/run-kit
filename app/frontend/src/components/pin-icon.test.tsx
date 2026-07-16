import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PinIcon } from "./pin-icon";

describe("PinIcon", () => {
  afterEach(cleanup);

  it("renders an outline thumbtack by default (decorative, no slash)", () => {
    const { container } = render(<PinIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // Body path unfilled = outline (not-pinned) state.
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(container.querySelector("line")).toBeNull();
  });

  it("fills the body when `filled` (pinned-to-any-board state)", () => {
    const { container } = render(<PinIcon filled />);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });

  it("adds the diagonal slash when `slashed` (unpin affordance), body stays outline", () => {
    const { container } = render(<PinIcon slashed />);
    expect(container.querySelector("line")).not.toBeNull();
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("none");
  });
});
