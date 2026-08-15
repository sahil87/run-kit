import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { Shell } from "./shell";
import { ChromeProvider } from "@/contexts/chrome-context";
import { stubMatchMedia } from "@/test-utils/match-media";

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
  stubMatchMedia((q) =>
    mobile
      ? q.includes("max-width") // mobile width matches
      : false,
  );
  return render(
    <ChromeProvider>
      <Shell
        sidebarChildren={sidebarChildren}
        bottomBarChildren={<div data-testid="bottombar">BOTTOM</div>}
        statusBarChildren={<div data-testid="statusbar">STATUS</div>}
      >
        {/* The topbar is no longer part of the Shell grid (260707-4vq2) — it
            mounts in the persistent root layout. On desktop the `content` child
            renders inside the nested STAGE grid (one level below the outer
            grid); on mobile it is a direct outer-grid child. */}
        <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
      </Shell>
    </ChromeProvider>,
  );
}

/** The nested stage grid = the content child's parent (desktop only); the
 *  outer grid is one level above it. */
function stage() {
  return screen.getByTestId("content").parentElement!;
}
function outerGrid() {
  return stage().parentElement!;
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

  it("renders the universal desktop stage (sidebar + content + bottombar on the inset ground) with the statusbar as a full-width outer row", () => {
    renderShell({ open: true, mobile: false });
    // The outer grid is one column of two rows: stage (1fr) over the
    // full-width statusbar (auto) — the status bar stays OUTSIDE the stage so
    // the stage's padding/gap never insets the attached frame chrome.
    expect(outerGrid().style.display).toBe("grid");
    expect(outerGrid().style.gridTemplateRows).toBe("1fr auto");
    expect(outerGrid().style.gridTemplateAreas).toContain('"stage"');
    expect(outerGrid().style.gridTemplateAreas).toContain('"statusbar"');
    expect(outerGrid().style.gridTemplateAreas).not.toContain("topbar");
    // The stage: inset ground, 6px padding/gap, sidebar + content columns with
    // the bottombar scoped to the content column.
    expect(stage().style.gridArea).toBe("stage");
    expect(stage().style.gridTemplateAreas).toContain('"sidebar content"');
    expect(stage().style.gridTemplateAreas).toContain('"sidebar bottombar"');
    expect(stage().style.padding).toBe("6px");
    expect(stage().style.rowGap).toBe("6px");
    expect(stage().className).toContain("bg-bg-inset");
    // The Shell-owned placements: bottom bar in its footer (inside the stage),
    // status bar in the outer row — desktop only.
    const footer = screen.getByTestId("bottombar").parentElement!;
    expect(footer.tagName).toBe("FOOTER");
    expect(footer.style.gridArea).toBe("bottombar");
    expect(footer.parentElement).toBe(stage());
    const statusbar = screen.getByTestId("statusbar").parentElement!;
    expect(statusbar.style.gridArea).toBe("statusbar");
    expect(statusbar.parentElement).toBe(outerGrid());
  });

  it("never renders the statusbar row content on mobile", () => {
    renderShell({ open: true, mobile: true });
    expect(screen.queryByTestId("statusbar")).not.toBeInTheDocument();
    const root = screen.getByTestId("content").parentElement!;
    expect(root.style.gridTemplateAreas).not.toContain("statusbar");
  });

  it("collapses the stage to '0 1fr' columns with no column gap when sidebarOpen is false", () => {
    renderShell({ open: false, mobile: false });
    expect(stage().style.gridTemplateColumns).toBe("0 1fr");
    // A zero-width track would otherwise keep its 6px column-gap as a stray seam.
    expect(stage().style.columnGap).toBe("0px");
  });

  it("uses '${sidebarWidth}px 1fr' stage columns with the 6px gap when sidebarOpen is true", () => {
    renderShell({ open: true, mobile: false });
    // Default sidebar width is 220px (from chrome-context).
    expect(stage().style.gridTemplateColumns).toBe("220px 1fr");
    expect(stage().style.columnGap).toBe("6px");
  });

  describe("desktop sidebar aside (Shell-owned, 260719-rwqf)", () => {
    it("renders an <aside aria-label='Sidebar'> card containing sidebarChildren when desktop + open", () => {
      renderShell({ open: true, mobile: false });
      const aside = screen.getByRole("complementary", { name: "Sidebar" });
      expect(aside).toBeInTheDocument();
      // The sidebar content lives inside the aside.
      expect(aside).toContainElement(screen.getByTestId("sidebar"));
      // It is placed in the stage's `sidebar` grid area.
      expect(aside.style.gridArea).toBe("sidebar");
      // Card family: rounded, dimmed card border, primary ground — no attached
      // border-r seam.
      expect(aside.className).toContain("rounded-md");
      expect(aside.className).toContain("rk-card-border");
      expect(aside.className).toContain("bg-bg-primary");
      expect(aside.className).not.toContain("border-r");
    });

    it("does not render the desktop aside when sidebarOpen is false", () => {
      renderShell({ open: false, mobile: false });
      expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
      // Fully unmounted — the children are absent, not merely hidden.
      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    });

    it("renders a passed sidebarResizeHandle beside the aside, straddling the stage gap", () => {
      localStorage.setItem("runkit-sidebar-open", "true");
      stubMatchMedia(() => false); // desktop
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
      // The handle is NOT inside the aside (the card clips at its rounded
      // border); it lives in a zero-width stage item pinned to the sidebar
      // track's right edge so it can straddle the 6px gap.
      expect(aside).not.toContainElement(screen.getByTestId("resize-handle"));
      const handleSlot = screen.getByTestId("resize-handle").parentElement!;
      expect(handleSlot.style.gridArea).toBe("sidebar");
      expect(handleSlot.style.justifySelf).toBe("end");
      expect(handleSlot.parentElement).toBe(stage());
    });

    it("does not render sidebarResizeHandle in the mobile overlay", () => {
      // ChromeProvider reads the stored preference; pin open, mock mobile viewport.
      localStorage.setItem("runkit-sidebar-open", "true");
      stubMatchMedia((q) => q.includes("max-width"));
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
    // row (the TopBar is in the persistent root layout, 260707-4vq2) and no
    // stage/statusbar rows — the mobile template is unchanged.
    expect(root.style.gridTemplateAreas).not.toContain("topbar");
    expect(root.style.gridTemplateAreas).not.toContain("stage");
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
