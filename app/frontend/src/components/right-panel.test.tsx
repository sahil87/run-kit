import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RightPanel } from "./right-panel";
import { Shell } from "./shell/shell";
import { ChromeProvider } from "@/contexts/chrome-context";
import { stubMatchMedia } from "@/test-utils/match-media";
import { PANEL_WIDTH_STORAGE_KEY, MIN_PANEL_WIDTH_PX, MAX_PANEL_WIDTH_PCT, type SurfaceName } from "@/lib/right-panel";

// jsdom does not implement matchMedia — Tip's coarse-pointer check needs it.
// Default to the fine-pointer branch (tooltips enabled).
stubMatchMedia(() => false);

function renderPanel(overrides: {
  available?: SurfaceName[];
  active?: SurfaceName | null;
  onToggle?: (surface: SurfaceName) => void;
  children?: React.ReactNode;
} = {}) {
  return render(
    <ChromeProvider>
      <RightPanel
        available={overrides.available ?? []}
        active={overrides.active ?? null}
        onToggle={overrides.onToggle ?? vi.fn()}
      >
        {overrides.children}
      </RightPanel>
    </ChromeProvider>,
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
      <ChromeProvider>
        <RightPanel available={["web"]} active="web" onToggle={vi.fn()}>
          <div>web content</div>
        </RightPanel>
      </ChromeProvider>,
    );
    expect(screen.getByText("web content")).toBeTruthy();

    rerender(
      <ChromeProvider>
        <RightPanel available={["web"]} active={null} onToggle={vi.fn()}>
          <div>web content</div>
        </RightPanel>
      </ChromeProvider>,
    );
    const panel = screen.getByTestId("right-panel");
    expect(panel.classList.contains("hidden")).toBe(true);
    // Still mounted — the iframe's in-memory state survives the collapse.
    expect(screen.getByText("web content")).toBeTruthy();
  });
});

describe("RightPanel width (pixel-sized grid column, 260812-nm4p)", () => {
  // The panel's width basis is the Shell grid width minus the sidebar column,
  // measured via the Shell-provided grid ref (never the panel's own parent).
  // Pin the sidebar closed (0px column) and mock clientWidth so the basis is a
  // deterministic 1000px; the test-setup ResizeObserver stub never fires, so
  // the synchronous layout-effect read is the measurement under test.
  function renderPanelInShell(widthPct?: string) {
    localStorage.setItem("runkit-sidebar-open", "false");
    if (widthPct !== undefined) localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, widthPct);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(1000);
    render(
      <ChromeProvider>
        <Shell
          rightPanelChildren={
            <RightPanel available={["web"]} active="web" onToggle={vi.fn()}>
              <div />
            </RightPanel>
          }
          rightPanelVisible={true}
        >
          <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
          <footer style={{ gridArea: "bottombar" }}>BOTTOM</footer>
        </Shell>
      </ChromeProvider>,
    );
    return clientWidth;
  }

  it("resolves the default 38% against the content+panel basis in pixels", () => {
    const spy = renderPanelInShell();
    // 38% of the 1000px basis (sidebar collapsed → no column subtracted).
    expect(screen.getByTestId("right-panel").style.width).toBe("380px");
    spy.mockRestore();
  });

  it("restores a persisted per-viewer width against the basis", () => {
    const spy = renderPanelInShell("50");
    expect(screen.getByTestId("right-panel").style.width).toBe("500px");
    spy.mockRestore();
  });

  it("enforces the 280px floor at restore time", () => {
    const spy = renderPanelInShell("10");
    expect(screen.getByTestId("right-panel").style.width).toBe(`${MIN_PANEL_WIDTH_PX}px`);
    spy.mockRestore();
  });

  it("enforces the 65% cap at restore time", () => {
    const spy = renderPanelInShell("90");
    expect(screen.getByTestId("right-panel").style.width).toBe(`${(MAX_PANEL_WIDTH_PCT / 100) * 1000}px`);
    spy.mockRestore();
  });

  it("subtracts the sidebar column from the basis when the sidebar is open", () => {
    localStorage.setItem("runkit-sidebar-open", "true"); // 220px default column
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    render(
      <ChromeProvider>
        <Shell
          sidebarChildren={<div>SIDEBAR</div>}
          rightPanelChildren={
            <RightPanel available={["web"]} active="web" onToggle={vi.fn()}>
              <div />
            </RightPanel>
          }
          rightPanelVisible={true}
        >
          <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
          <footer style={{ gridArea: "bottombar" }}>BOTTOM</footer>
        </Shell>
      </ChromeProvider>,
    );
    // Basis = 1000 - 220 = 780; 38% → 296.4 → 296px.
    expect(screen.getByTestId("right-panel").style.width).toBe("296px");
    spy.mockRestore();
  });
});
