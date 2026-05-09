import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Shell } from "./shell";
import { ChromeProvider } from "@/contexts/chrome-context";

function mockMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function renderShell(opts: { open?: boolean; mobile?: boolean } = {}) {
  const { open = true, mobile = false } = opts;
  // ChromeProvider initialises sidebarOpen from localStorage; seed it so
  // the desktop-collapsed scenario can be exercised without a click.
  if (open === false) {
    localStorage.setItem("runkit-sidebar-open", "false");
  } else {
    localStorage.removeItem("runkit-sidebar-open");
  }
  mockMatchMedia((q) =>
    mobile
      ? q.includes("max-width") // mobile width matches
      : false,
  );
  return render(
    <ChromeProvider>
      <Shell sidebarChildren={<div data-testid="sidebar">SIDEBAR</div>}>
        <header style={{ gridArea: "topbar" }} data-testid="topbar">TOP</header>
        <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
        <footer style={{ gridArea: "bottombar" }} data-testid="bottombar">BOTTOM</footer>
      </Shell>
    </ChromeProvider>,
  );
}

describe("Shell", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders desktop grid with sidebar/topbar/content/bottombar areas when sidebarOpen", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("topbar").parentElement!;
    // Inline style assertions — ensure the topology matches spec § Grid template areas (desktop)
    expect(root.style.display).toBe("grid");
    expect(root.style.gridTemplateRows).toBe("auto 1fr auto");
    // grid-template-areas comes back with each row quoted; assert each row appears
    expect(root.style.gridTemplateAreas).toContain('"sidebar topbar"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar content"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar bottombar"');
  });

  it("collapses to '0 1fr' columns when sidebarOpen is false", () => {
    renderShell({ open: false, mobile: false });
    const root = screen.getByTestId("topbar").parentElement!;
    expect(root.style.gridTemplateColumns).toBe("0 1fr");
  });

  it("uses '${sidebarWidth}px 1fr' columns when sidebarOpen is true", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("topbar").parentElement!;
    // Default sidebar width is 220px (from chrome-context).
    expect(root.style.gridTemplateColumns).toBe("220px 1fr");
  });

  it("switches to single-column grid on mobile and renders sidebar overlay when open", () => {
    renderShell({ open: true, mobile: true });
    const root = screen.getByTestId("topbar").parentElement!;
    expect(root.style.gridTemplateColumns).toBe("1fr");
    expect(root.style.gridTemplateAreas).toContain('"topbar"');
    expect(root.style.gridTemplateAreas).toContain('"content"');
    expect(root.style.gridTemplateAreas).toContain('"bottombar"');
    // The sidebar renders as a fixed overlay with role="dialog"
    const overlay = screen.getByRole("dialog");
    expect(overlay).toBeInTheDocument();
    expect(overlay.getAttribute("aria-modal")).toBe("true");
  });

  it("does not render the mobile overlay when sidebarOpen is false", () => {
    renderShell({ open: false, mobile: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
