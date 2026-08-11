import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RightPanel } from "./right-panel";
import { stubMatchMedia } from "@/test-utils/match-media";
import { PANEL_WIDTH_STORAGE_KEY, DEFAULT_PANEL_WIDTH_PCT } from "@/lib/right-panel";

// jsdom does not implement matchMedia — Tip's coarse-pointer check needs it.
// Default to the fine-pointer branch (tooltips enabled).
stubMatchMedia(() => false);

function renderPanel(overrides: {
  available?: ("web")[];
  active?: "web" | null;
  onToggle?: (surface: "web") => void;
  children?: React.ReactNode;
} = {}) {
  return render(
    <RightPanel
      available={overrides.available ?? []}
      active={overrides.active ?? null}
      onToggle={overrides.onToggle ?? vi.fn()}
    >
      {overrides.children}
    </RightPanel>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("RightPanel rail", () => {
  it("always renders the rail, with a button per available surface only", () => {
    renderPanel();
    const rail = screen.getByTestId("right-panel-rail");
    expect(rail).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Web panel" })).toBeNull();
  });

  it("renders a focusable web button (with availability dot) when available", () => {
    renderPanel({ available: ["web"] });
    const button = screen.getByRole("button", { name: "Web panel" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    // Availability dot (P4) rides the button.
    expect(button.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("clicking a rail button toggles that surface", () => {
    const onToggle = vi.fn();
    renderPanel({ available: ["web"], onToggle });
    fireEvent.click(screen.getByRole("button", { name: "Web panel" }));
    expect(onToggle).toHaveBeenCalledWith("web");
  });

  it("marks the active surface inverse-video (aria-pressed)", () => {
    renderPanel({ available: ["web"], active: "web", children: <div>content</div> });
    expect(screen.getByRole("button", { name: "Web panel" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("RightPanel hide-never-unmount (P3)", () => {
  it("mounts no surface content before the first open", () => {
    renderPanel({ available: ["web"], children: <div>web content</div> });
    expect(screen.queryByTestId("right-panel")).toBeNull();
    expect(screen.queryByText("web content")).toBeNull();
  });

  it("shows the panel while a surface is active", () => {
    renderPanel({ available: ["web"], active: "web", children: <div>web content</div> });
    const panel = screen.getByTestId("right-panel");
    expect(panel.classList.contains("hidden")).toBe(false);
    expect(screen.getByText("web content")).toBeTruthy();
  });

  it("closing hides the subtree at display level WITHOUT unmounting it", () => {
    const { rerender } = render(
      <RightPanel available={["web"]} active="web" onToggle={vi.fn()}>
        <div>web content</div>
      </RightPanel>,
    );
    expect(screen.getByText("web content")).toBeTruthy();

    rerender(
      <RightPanel available={["web"]} active={null} onToggle={vi.fn()}>
        <div>web content</div>
      </RightPanel>,
    );
    const panel = screen.getByTestId("right-panel");
    expect(panel.classList.contains("hidden")).toBe(true);
    // Still mounted — the iframe's in-memory state survives the collapse.
    expect(screen.getByText("web content")).toBeTruthy();
  });
});

describe("RightPanel width", () => {
  it("defaults to the 38% width", () => {
    renderPanel({ available: ["web"], active: "web", children: <div /> });
    expect(screen.getByTestId("right-panel").style.width).toBe(`${DEFAULT_PANEL_WIDTH_PCT}%`);
  });

  it("restores a persisted per-viewer width", () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, "50");
    renderPanel({ available: ["web"], active: "web", children: <div /> });
    expect(screen.getByTestId("right-panel").style.width).toBe("50%");
  });
});
