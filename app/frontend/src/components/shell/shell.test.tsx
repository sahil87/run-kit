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
            mounts in the persistent root layout. The `content` child doubles as
            the `parentElement` handle to reach the grid root (on the
            no-right-panel branch; the stage branch nests one level deeper). */}
        <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
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

  it("renders desktop grid with sidebar beside content+bottombar and a full-width statusbar row (260814-ldbs)", () => {
    renderShell({ open: true, mobile: false });
    const root = screen.getByTestId("content").parentElement!;
    // The TopBar mount moved to the persistent root layout (260707-4vq2), so
    // Shell's grid no longer carries a `topbar` row. Three rows now: content
    // (1fr) over bottombar (auto) over the full-width statusbar (auto).
    expect(root.style.display).toBe("grid");
    expect(root.style.gridTemplateRows).toBe("1fr auto auto");
    // grid-template-areas comes back with each row quoted; assert each row appears
    expect(root.style.gridTemplateAreas).toContain('"sidebar content"');
    expect(root.style.gridTemplateAreas).toContain('"sidebar bottombar"');
    // The statusbar row spans ALL columns (sidebar included).
    expect(root.style.gridTemplateAreas).toContain('"statusbar statusbar"');
    // The topbar area is gone from the Shell grid entirely.
    expect(root.style.gridTemplateAreas).not.toContain("topbar");
    // The Shell-owned placements: bottom bar in its footer, status bar in the
    // spanned row — desktop only.
    const footer = screen.getByTestId("bottombar").parentElement!;
    expect(footer.tagName).toBe("FOOTER");
    expect(footer.style.gridArea).toBe("bottombar");
    expect(screen.getByTestId("statusbar").parentElement!.style.gridArea).toBe("statusbar");
  });

  it("never renders the statusbar row content on mobile", () => {
    renderShell({ open: true, mobile: true });
    expect(screen.queryByTestId("statusbar")).not.toBeInTheDocument();
    const root = screen.getByTestId("content").parentElement!;
    expect(root.style.gridTemplateAreas).not.toContain("statusbar");
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

  describe("right panel stage (260812-nm4p; nested stage 260814-ldbs)", () => {
    function renderWithRightPanel(opts: { visible?: boolean } = {}) {
      const { visible = true } = opts;
      localStorage.setItem("runkit-sidebar-open", "true");
      stubMatchMedia(() => false); // desktop
      return render(
        <ChromeProvider>
          <Shell
            sidebarChildren={<div data-testid="sidebar">SIDEBAR</div>}
            rightPanelChildren={<div data-testid="rail">RAIL</div>}
            rightPanelVisible={visible}
            bottomBarChildren={<div data-testid="bottombar">BOTTOM</div>}
            statusBarChildren={<div data-testid="statusbar">STATUS</div>}
          >
            <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
          </Shell>
        </ChromeProvider>,
      );
    }

    /** The nested stage grid = the content child's parent; the outer grid is
     *  one level above it. */
    function stage() {
      return screen.getByTestId("content").parentElement!;
    }
    function outerGrid() {
      return stage().parentElement!;
    }

    it("nests content + rail in a single-row stage on the inset ground when the slot is filled", () => {
      renderWithRightPanel();
      // The outer grid is sidebar | stage, with the bottombar + the
      // full-width statusbar rows below — no third column anymore.
      expect(outerGrid().style.gridTemplateColumns).toBe("220px 1fr");
      expect(outerGrid().style.gridTemplateAreas).toContain('"sidebar stage"');
      expect(outerGrid().style.gridTemplateAreas).toContain('"sidebar bottombar"');
      expect(outerGrid().style.gridTemplateAreas).toContain('"statusbar statusbar"');
      // The stage: single row, `1fr auto`, 6px gap + 6px padding, inset ground.
      expect(stage().style.gridArea).toBe("stage");
      expect(stage().style.gridTemplateAreas).toBe('"content rightpanel"');
      expect(stage().style.gridTemplateColumns).toBe("1fr auto");
      expect(stage().style.gridTemplateRows).toBe("1fr");
      expect(stage().style.gap).toBe("6px");
      expect(stage().style.padding).toBe("6px");
      expect(stage().className).toContain("bg-bg-inset");
      // The rail aside lives INSIDE the stage at the rightpanel area.
      const aside = screen.getByRole("complementary", { name: "Right panel" });
      expect(aside.parentElement).toBe(stage());
      expect(aside.style.gridArea).toBe("rightpanel");
      expect(aside).toContainElement(screen.getByTestId("rail"));
    });

    it("hides the rail at display level and drops the auto track when rightPanelVisible is false", () => {
      renderWithRightPanel({ visible: false });
      // The aside element stays in the DOM — children (iframes) keep state —
      // it is only display-hidden, AND the stage template flips to `1fr` so no
      // stray 6px column-gap survives the hidden rail (260814-ldbs R1).
      const rail = screen.getByTestId("rail");
      expect(rail).toBeInTheDocument();
      expect(rail.parentElement!.className).toContain("hidden");
      expect(stage().style.gridTemplateColumns).toBe("1fr");
      expect(stage().style.gridTemplateAreas).toBe('"content"');
    });

    it("keeps the two-column grid byte-identical when the slot is absent", () => {
      renderShell({ open: true, mobile: false });
      const root = screen.getByTestId("content").parentElement!;
      expect(root.style.gridTemplateColumns).toBe("220px 1fr");
      expect(root.style.gridTemplateAreas).not.toContain("rightpanel");
      expect(root.style.gridTemplateAreas).not.toContain("stage");
      expect(screen.queryByRole("complementary", { name: "Right panel" })).not.toBeInTheDocument();
    });

    it("ignores the slot on mobile — single-column grid, no right aside", () => {
      localStorage.setItem("runkit-sidebar-open", "false");
      stubMatchMedia((q) => q.includes("max-width"));
      render(
        <ChromeProvider>
          <Shell
            rightPanelChildren={<div data-testid="rail">RAIL</div>}
            rightPanelVisible={true}
          >
            <main style={{ gridArea: "content" }} data-testid="content">CONTENT</main>
          </Shell>
        </ChromeProvider>,
      );
      const root = screen.getByTestId("content").parentElement!;
      expect(root.style.gridTemplateColumns).toBe("1fr");
      expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
    });
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
