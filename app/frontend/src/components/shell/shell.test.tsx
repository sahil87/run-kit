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
        {/* The topbar is no longer part of the Shell grid (260707-4vq2) — it
            mounts in the persistent root layout. The `content` child doubles as
            the `parentElement` handle to reach the grid root. */}
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

  it("renders desktop grid with sidebar beside content+bottombar; no topbar row (260707-4vq2)", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("content").parentElement!;
    // The TopBar mount moved to the persistent root layout (260707-4vq2), so
    // Shell's grid no longer carries a `topbar` row. Two rows now: content
    // (1fr) over bottombar (auto), sidebar spanning both.
    expect(root.style.display).toBe("grid");
    expect(root.style.gridTemplateRows).toBe("1fr auto");
    // grid-template-areas comes back with each row quoted; assert each row appears
    expect(root.style.gridTemplateAreas).toContain('"sidebar content"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar bottombar"');
    // The topbar area is gone from the Shell grid entirely.
    expect(root.style.gridTemplateAreas).not.toContain("topbar");
  });

  it("collapses to '0 1fr' columns when sidebarOpen is false", () => {
    renderShell({ open: false, mobile: false });
    const root = screen.getByTestId("content").parentElement!;
    expect(root.style.gridTemplateColumns).toBe("0 1fr");
  });

  it("uses '${sidebarWidth}px 1fr' columns when sidebarOpen is true", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("content").parentElement!;
    // Default sidebar width is 220px (from chrome-context).
    expect(root.style.gridTemplateColumns).toBe("220px 1fr");
  });

  describe("desktop sidebar aside (Shell-owned, 260719-rwqf)", () => {
    it("renders an <aside aria-label='Sidebar'> containing sidebarChildren when desktop + open", () => {
      renderShell({ open: true, mobile: false });
      const aside = screen.getByRole("complementary", { name: "Sidebar" });
      expect(aside).toBeInTheDocument();
      // The sidebar content lives inside the aside.
      expect(aside).toContainElement(screen.getByTestId("sidebar"));
      // It is placed in the `sidebar` grid area.
      expect(aside.style.gridArea).toBe("sidebar");
    });

    it("does not render the desktop aside when sidebarOpen is false", () => {
      renderShell({ open: false, mobile: false });
      expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
      // Fully unmounted — the children are absent, not merely hidden.
      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    });

    it("renders a passed sidebarResizeHandle inside the aside and drops border-r", () => {
      render(
        <ChromeProvider>
          <Shell
            sidebarChildren={<div data-testid="sidebar">SIDEBAR</div>}
            sidebarResizeHandle={<div data-testid="resize-handle">HANDLE</div>}
          >
            <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
            <footer style={{ gridArea: "bottombar" }} data-testid="bottombar">BOTTOM</footer>
          </Shell>
        </ChromeProvider>,
      );
      const aside = screen.getByRole("complementary", { name: "Sidebar" });
      // The handle renders inside the aside (right edge).
      expect(aside).toContainElement(screen.getByTestId("resize-handle"));
      // With a handle, the handle bar is the visual seam — no border-r.
      expect(aside.className).not.toContain("border-r");
    });

    it("applies border-r border-border on the aside when no resize handle is passed", () => {
      renderShell({ open: true, mobile: false });
      const aside = screen.getByRole("complementary", { name: "Sidebar" });
      expect(aside.className).toContain("border-r");
      expect(aside.className).toContain("border-border");
    });

    it("does not render sidebarResizeHandle in the mobile overlay", () => {
      // ChromeProvider reads the stored preference; pin open, mock mobile viewport.
      localStorage.setItem("runkit-sidebar-open", "true");
      mockMatchMedia((q) => q.includes("max-width"));
      render(
        <ChromeProvider>
          <Shell
            sidebarChildren={<div data-testid="sidebar">SIDEBAR</div>}
            sidebarResizeHandle={<div data-testid="resize-handle">HANDLE</div>}
          >
            <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
            <footer style={{ gridArea: "bottombar" }} data-testid="bottombar">BOTTOM</footer>
          </Shell>
        </ChromeProvider>,
      );
      // The mobile overlay (role="dialog") renders the children but NOT the handle.
      const overlay = screen.getByRole("dialog");
      expect(overlay).toContainElement(screen.getByTestId("sidebar"));
      expect(screen.queryByTestId("resize-handle")).not.toBeInTheDocument();
      // And there is no desktop complementary aside on mobile.
      expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    });
  });

  it("switches to single-column grid on mobile and renders sidebar overlay when open", () => {
    renderShell({ open: true, mobile: true });
    const root = screen.getByTestId("content").parentElement!;
    expect(root.style.gridTemplateColumns).toBe("1fr");
    // Single-column, two-row mobile grid (content over bottombar); no topbar
    // row (the TopBar is in the persistent root layout, 260707-4vq2).
    expect(root.style.gridTemplateAreas).not.toContain("topbar");
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
      // Desktop sidebar is not a modal: Shell renders it as a grid <aside>
      // (aria-label="Sidebar"), not the role="dialog" overlay, so the focus trap
      // never activates — focus stays on <body>, nothing is focused. The
      // sidebarChildren DO render now (Shell owns the desktop aside, 260719-rwqf),
      // but the trap is scoped to the mobile overlay only.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      // The desktop aside renders the children (Shell-owned), but focus is untouched.
      expect(screen.getByTestId("first")).toBeInTheDocument();
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
