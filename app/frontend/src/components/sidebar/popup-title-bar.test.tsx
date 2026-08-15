import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PopupTitleBar, PopupTitleBarSecondary } from "./popup-title-bar";

afterEach(cleanup);

describe("PopupTitleBar", () => {
  it("renders the title content and the inset-bar chrome classes", () => {
    render(
      <PopupTitleBar>
        <PopupTitleBarSecondary>Server </PopupTitleBarSecondary>default
      </PopupTitleBar>,
    );
    const bar = screen.getByTestId("popup-title-bar");
    expect(bar).toHaveTextContent("Server default");
    // Inset-bar chrome: full-bleed (negative margins), bottom border, rounded
    // top, inset fill.
    expect(bar.className).toContain("bg-bg-inset");
    expect(bar.className).toContain("border-b");
    expect(bar.className).toContain("-mx-2");
    expect(bar.className).toContain("rounded-t-[5px]");
    // The secondary/primary split: literal secondary, identity primary.
    expect(bar.querySelector("span span")?.className).toContain("text-text-secondary");
  });

  it("renders no right-edge cluster by default", () => {
    render(<PopupTitleBar>Session foo</PopupTitleBar>);
    expect(screen.getByTestId("popup-title-bar").children).toHaveLength(1);
  });

  it("renders the right-edge cluster when supplied", () => {
    render(
      <PopupTitleBar right={<button aria-label="docs">i</button>}>
        Window @31
      </PopupTitleBar>,
    );
    const bar = screen.getByTestId("popup-title-bar");
    expect(bar).toHaveTextContent("Window @31");
    expect(screen.getByRole("button", { name: "docs" })).toBeTruthy();
    expect(bar.querySelector(".ml-auto")).not.toBeNull();
  });
});
