import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
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

function renderShell(opts: { open?: boolean; mobile?: boolean; sidebarChildren?: ReactNode } = {}) {
  const {
    open = true,
    mobile = false,
    sidebarChildren = <div data-testid="sidebar">SIDEBAR</div>,
  } = opts;
  // ChromeProvider initialises sidebarOpen from localStorage. Seed an EXPLICIT
  // preference for both states: with no stored value the default is
  // viewport-dependent (collapsed on mobile), so relying on "absent ⇒ open"
  // would make the mobile-open scenario unreachable. An explicit value pins the
  // state regardless of the mocked viewport.
  localStorage.setItem("runkit-sidebar-open", open ? "true" : "false");
  mockMatchMedia((q) =>
    mobile
      ? q.includes("max-width") // mobile width matches
      : false,
  );
  return render(
    <ChromeProvider>
      <Shell sidebarChildren={sidebarChildren}>
        <header style={{ gridArea: "topbar" }} data-testid="topbar">TOP</header>
        <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
        <footer style={{ gridArea: "bottombar" }} data-testid="bottombar">BOTTOM</footer>
      </Shell>
    </ChromeProvider>,
  );
}

/** Sidebar children with ≥2 focusable buttons so the Tab wrap is observable. */
function trapChildren() {
  return (
    <div data-testid="sidebar">
      <button type="button" data-testid="first">first</button>
      <button type="button" data-testid="middle">middle</button>
      <button type="button" data-testid="last">last</button>
    </div>
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

  it("renders desktop grid with a full-width topbar spanning both columns above the sidebar", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("topbar").parentElement!;
    // Inline style assertions — ensure the topology matches spec § Grid template areas (desktop).
    // The topbar spans BOTH columns (full-width chrome); the sidebar occupies rows 2–3 only.
    expect(root.style.display).toBe("grid");
    expect(root.style.gridTemplateRows).toBe("auto 1fr auto");
    // grid-template-areas comes back with each row quoted; assert each row appears
    expect(root.style.gridTemplateAreas).toContain('"topbar topbar"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar content"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar bottombar"');
    // The pre-change "sidebar topbar" row (sidebar full-height beside the topbar) is gone.
    expect(root.style.gridTemplateAreas).not.toContain('"sidebar topbar"');
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

  describe("mobile drawer focus trap", () => {
    it("focuses inside the <aside> on mount when mobile + open", () => {
      renderShell({ open: true, mobile: true, sidebarChildren: trapChildren() });
      const overlay = screen.getByRole("dialog");
      // The trap focuses the first focusable inside the drawer on activation.
      expect(overlay.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(screen.getByTestId("first"));
    });

    it("closes the drawer on Escape", () => {
      renderShell({ open: true, mobile: true, sidebarChildren: trapChildren() });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      // setSidebarOpen(false) unmounts the overlay.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("wraps Tab from the last focusable to the first", () => {
      renderShell({ open: true, mobile: true, sidebarChildren: trapChildren() });
      const last = screen.getByTestId("last");
      last.focus();
      expect(document.activeElement).toBe(last);
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(screen.getByTestId("first"));
    });

    it("wraps Shift+Tab from the first focusable to the last", () => {
      renderShell({ open: true, mobile: true, sidebarChildren: trapChildren() });
      const first = screen.getByTestId("first");
      first.focus();
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(screen.getByTestId("last"));
    });

    it("does not steal focus or attach the trap on desktop", () => {
      renderShell({ open: true, mobile: false, sidebarChildren: trapChildren() });
      // Desktop sidebar is not a modal: Shell renders the overlay (and thus the
      // sidebarChildren) only on mobile, so there is no role="dialog" and the
      // trap never activates — focus stays on <body>, nothing is focused.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByTestId("first")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
    });

    it("does not steal focus when mobile but closed", () => {
      renderShell({ open: false, mobile: true, sidebarChildren: trapChildren() });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      // Children are not rendered while closed, so nothing is focused by the trap.
      expect(screen.queryByTestId("first")).not.toBeInTheDocument();
    });
  });
});
