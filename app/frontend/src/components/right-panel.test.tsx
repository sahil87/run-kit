import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { RightPanel } from "./right-panel";
import { TIP_OPEN_DELAY_MS } from "@/components/tip";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { SurfaceName } from "@/lib/right-panel";

// jsdom does not implement matchMedia — Tip's coarse-pointer check needs it.
// Default to the fine-pointer branch (tooltips enabled).
stubMatchMedia(() => false);

/**
 * Rail-only RightPanel (260812-ab5v T011, spec surface-layout.md R10): the
 * panel slot is subsumed by layout tiles — what remains is the rail of
 * OPEN-TILE TOGGLES. `open` is the resolved layout's `order`.
 */
function renderRail(overrides: {
  available?: SurfaceName[];
  open?: SurfaceName[];
  onToggle?: (surface: SurfaceName) => void;
} = {}) {
  return render(
    <RightPanel
      available={overrides.available ?? []}
      open={overrides.open ?? ["tty"]}
      onToggle={overrides.onToggle ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("RightPanel rail — open-tile toggles (R10)", () => {
  it("always renders the rail, with a button per available surface only", () => {
    renderRail();
    expect(screen.getByTestId("right-panel-rail")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders icon glyphs with the surface names as aria-labels (`<Label> tile`)", () => {
    renderRail({ available: ["tty", "web", "chat", "code"] });
    // Icon glyphs (R10's user-requested fold-in): `>_` tty, `◫` web, `⌸` chat,
    // `{}` code — the text labels moved to the accessible names + tooltips.
    expect(screen.getByRole("button", { name: "Terminal tile" }).textContent).toContain(">_");
    expect(screen.getByRole("button", { name: "Web tile" }).textContent).toContain("◫");
    expect(screen.getByRole("button", { name: "Chat tile" }).textContent).toContain("⌸");
    expect(screen.getByRole("button", { name: "Code tile" }).textContent).toContain("{}");
    // Availability dot (P4) still rides every button.
    expect(
      screen.getByRole("button", { name: "Web tile" }).querySelector("[aria-hidden='true']"),
    ).not.toBeNull();
  });

  it("lights a button per OPEN tile (aria-pressed), not just one active surface", () => {
    renderRail({ available: ["tty", "web", "code"], open: ["tty", "code"] });
    expect(screen.getByRole("button", { name: "Terminal tile" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Code tile" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Web tile" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking an unlit button ADDS the surface, clicking a lit one CLOSES it (same callback)", () => {
    const onToggle = vi.fn();
    renderRail({ available: ["tty", "web"], open: ["tty"], onToggle });
    fireEvent.click(screen.getByRole("button", { name: "Web tile" }));
    expect(onToggle).toHaveBeenCalledWith("web");
    fireEvent.click(screen.getByRole("button", { name: "Terminal tile" }));
    expect(onToggle).toHaveBeenCalledWith("tty");
  });

  it("at 3 open tiles the remaining unlit buttons render DISABLED with a 'Close a tile first' tooltip", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    renderRail({ available: ["tty", "web", "chat", "code"], open: ["tty", "web", "chat"], onToggle });
    const code = screen.getByRole("button", { name: "Code tile" });
    expect(code).toHaveProperty("disabled", true);
    // A lit button stays enabled at 3 tiles (closing is always allowed).
    expect(screen.getByRole("button", { name: "Web tile" })).toHaveProperty("disabled", false);
    // The tooltip explains the constraint instead of silently no-oping (plan
    // assumption 5). The Tip wraps a span so it survives the disabled button —
    // hover the WRAPPER (Tip's handlers live on its direct child; mouseenter
    // does not bubble from the button).
    fireEvent.mouseEnter(code.parentElement!);
    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Close a tile first");
    // A disabled button never fires the toggle.
    fireEvent.click(code);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("the tooltip carries the surface's text label (the icon's name moved here)", () => {
    vi.useFakeTimers();
    renderRail({ available: ["tty", "web"], open: ["tty"] });
    const web = screen.getByRole("button", { name: "Web tile" });
    fireEvent.mouseEnter(web.parentElement!);
    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Web");
  });
});
