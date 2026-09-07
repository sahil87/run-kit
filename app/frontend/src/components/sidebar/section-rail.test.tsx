import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SectionRail } from "./section-rail";
import { stubMatchMedia } from "@/test-utils/match-media";

// Fine pointer — the tier-1 `Tip` machinery is active (hover labels exist
// only here); coarse suppression is covered by `tip.test.tsx`.
stubMatchMedia();

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function railButtons(): HTMLElement[] {
  return screen.getAllByRole("button");
}

describe("SectionRail", () => {
  it("renders exactly five toggles in the fixed order Boards · Server · Pane · Host · Clock (no Sessions)", () => {
    render(<SectionRail />);
    expect(railButtons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Toggle Boards section",
      "Toggle Server section",
      "Toggle Pane section",
      "Toggle Host section",
      "Toggle Clock section",
    ]);
    expect(screen.queryByRole("button", { name: /Sessions section/ })).not.toBeInTheDocument();
  });

  it("aria-pressed reflects the defaults (Boards/Server on, Pane/Host/Clock off)", () => {
    render(<SectionRail />);
    expect(railButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("the Clock toggle is desktop-only: absent on mobile, the other four unaffected", () => {
    // Narrow viewport + coarse pointer (the useIsMobile rule).
    stubMatchMedia((query) => query.includes("max-width") || query.includes("pointer: coarse"));
    render(<SectionRail />);
    expect(railButtons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Toggle Boards section",
      "Toggle Server section",
      "Toggle Pane section",
      "Toggle Host section",
    ]);
    expect(screen.queryByRole("button", { name: "Toggle Clock section" })).not.toBeInTheDocument();
    // Restore the desktop stub for any later test in the file.
    stubMatchMedia();
  });

  it("the Clock toggle flips its persisted boolean on desktop", () => {
    render(<SectionRail />);
    const clock = screen.getByRole("button", { name: "Toggle Clock section" });
    fireEvent.click(clock);
    expect(clock.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("runkit-sidebar-section-clock")).toBe("true");
  });

  it("click flips the persisted boolean and aria-pressed", () => {
    render(<SectionRail />);
    const pane = screen.getByRole("button", { name: "Toggle Pane section" });

    fireEvent.click(pane);
    expect(pane.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("runkit-sidebar-section-pane")).toBe("true");

    fireEvent.click(pane);
    expect(pane.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("runkit-sidebar-section-pane")).toBe("false");
  });

  it("reads persisted values", () => {
    localStorage.setItem("runkit-sidebar-section-boards", "false");
    render(<SectionRail />);
    expect(screen.getByRole("button", { name: "Toggle Boards section" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("carries no native title attribute (the tier-1 Tip is the label)", () => {
    render(<SectionRail />);
    for (const button of railButtons()) {
      expect(button).not.toHaveAttribute("title");
    }
  });
});
