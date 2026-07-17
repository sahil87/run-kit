import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ViewSwitcher, ViewSwitcherMenuRows } from "./view-switcher";
import type { ViewName } from "@/lib/window-view";

afterEach(cleanup);

describe("ViewSwitcher", () => {
  it("renders one segment per view and marks the active one", () => {
    render(<ViewSwitcher views={["web", "tty"]} active="tty" onSelect={() => {}} />);

    const terminal = screen.getByRole("button", { name: "Terminal view" });
    const web = screen.getByRole("button", { name: "Web view" });
    expect(terminal).toBeTruthy();
    expect(web).toBeTruthy();
    // Active segment is aria-pressed; the other is not.
    expect(terminal.getAttribute("aria-pressed")).toBe("true");
    expect(web.getAttribute("aria-pressed")).toBe("false");
    // Active segment carries the inverse-video (accent-green fill) class.
    expect(terminal.className).toContain("bg-accent-green");
    expect(web.className).not.toContain("bg-accent-green");
  });

  it("labels segments with the lowercase view name (spec R4 `[tty|web]` style)", () => {
    render(<ViewSwitcher views={["web", "tty"]} active="tty" onSelect={() => {}} />);
    // Visible glyph is the lowercase view name; the accessible name is the
    // title-case `<Label> view`.
    expect(screen.getByRole("button", { name: "Terminal view" }).textContent).toBe("tty");
    expect(screen.getByRole("button", { name: "Web view" }).textContent).toBe("web");
  });

  it("renders segments tty-first regardless of the incoming list order", () => {
    // The caller passes HINT_ORDER (chat/web-first, from `availableViews`); the
    // switcher renders the fixed DISPLAY order `[tty|web|chat]` (spec R4).
    render(<ViewSwitcher views={["web", "tty"]} active="tty" onSelect={() => {}} />);
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Terminal view", "Web view"]);
  });

  it("calls onSelect with the clicked view", () => {
    const onSelect = vi.fn();
    render(<ViewSwitcher views={["web", "tty"]} active="tty" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Web view" }));
    expect(onSelect).toHaveBeenCalledWith("web");

    fireEvent.click(screen.getByRole("button", { name: "Terminal view" }));
    expect(onSelect).toHaveBeenCalledWith("tty");
  });

  it("renders three segments for a stacked window (tty|web|chat) in DISPLAY_ORDER", () => {
    const onSelect = vi.fn();
    render(
      <ViewSwitcher views={["chat", "web", "tty"]} active="chat" onSelect={onSelect} />,
    );
    // All three lenses render, tty-first per DISPLAY_ORDER (independent of the
    // incoming HINT_ORDER, which is chat-first).
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Terminal view", "Web view", "Chat view"]);
    // Chat is the active (inverse-video) segment.
    const chat = screen.getByRole("button", { name: "Chat view" });
    expect(chat.getAttribute("aria-pressed")).toBe("true");
    expect(chat.className).toContain("bg-accent-green");
    expect(chat.textContent).toBe("chat");
    fireEvent.click(screen.getByRole("button", { name: "Web view" }));
    expect(onSelect).toHaveBeenCalledWith("web");
  });

  it("renders a view not in DISPLAY_ORDER at the END (future lens, not dropped)", () => {
    // Simulate a future lens (e.g. `desktop`) that ships before DISPLAY_ORDER is
    // updated in lockstep. It must still render a segment (appended last),
    // matching the component's "sorts to the end" contract — never silently
    // dropped. Cast because `ViewName` has no such member today.
    const future = "desktop" as ViewName;
    const { container } = render(
      <ViewSwitcher views={["web", "tty", future]} active="tty" onSelect={() => {}} />,
    );
    // Three segments render (not two) — the unlisted lens was NOT dropped.
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(3);
    // Listed views come first in DISPLAY_ORDER; the unlisted lens is appended
    // last (its key is the raw view name).
    const keys = buttons.map((b) => b.getAttribute("aria-label"));
    expect(keys[0]).toBe("Terminal view");
    expect(keys[1]).toBe("Web view");
  });

  it("is visible at all breakpoints (no `hidden sm:*` gate — chat is a mobile use case)", () => {
    render(<ViewSwitcher views={["web", "tty"]} active="tty" onSelect={() => {}} />);
    const group = screen.getByRole("group", { name: "Window view" });
    // The chip container carries no responsive-hide utility; it stays
    // inline-flex at every width. Check the class TOKENS (not a substring — the
    // unrelated `overflow-hidden` clipping class contains "hidden").
    const classes = group.className.split(/\s+/);
    expect(classes).not.toContain("hidden");
    expect(classes).toContain("inline-flex");
    // The unified chip keeps the `view-toggle` e2e handle.
    expect(group.getAttribute("data-testid")).toBe("view-toggle");
  });

  it("renders nothing for a single-view (tty-only) window", () => {
    const { container } = render(
      <ViewSwitcher views={["tty"]} active="tty" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("group", { name: "Window view" })).toBeNull();
  });

  it("exposes an accessible group label", () => {
    render(<ViewSwitcher views={["web", "tty"]} active="web" onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: "Window view" })).toBeTruthy();
  });
});

describe("ViewSwitcherMenuRows (overflow-menu representation, 260717-6anu)", () => {
  it("renders one `View: {label}` menuitemradio row per view, tty-first (DISPLAY_ORDER)", () => {
    // Caller passes HINT_ORDER (web/chat-first); rows render in DISPLAY_ORDER
    // (tty-first), reusing the pill's ordering.
    render(
      <ViewSwitcherMenuRows views={["chat", "web", "tty"]} active="tty" onSelect={() => {}} />,
    );
    const labels = screen
      .getAllByRole("menuitemradio")
      .map((b) => b.textContent);
    expect(labels).toEqual(["View: Terminal", "View: Web", "View: Chat"]);
  });

  it("marks the active view's row with the accent-green treatment and aria-checked", () => {
    render(
      <ViewSwitcherMenuRows views={["web", "tty"]} active="web" onSelect={() => {}} />,
    );
    const web = screen.getByRole("menuitemradio", { name: "View: Web" });
    const tty = screen.getByRole("menuitemradio", { name: "View: Terminal" });
    // Active row: aria-checked true + inverse-video accent-green class.
    expect(web.getAttribute("aria-checked")).toBe("true");
    expect(web.className).toContain("bg-accent-green");
    // Inactive row: not checked, no accent fill.
    expect(tty.getAttribute("aria-checked")).toBe("false");
    expect(tty.className).not.toContain("bg-accent-green");
  });

  it("calls onSelect with the clicked view", () => {
    const onSelect = vi.fn();
    render(
      <ViewSwitcherMenuRows views={["web", "tty"]} active="tty" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "View: Web" }));
    expect(onSelect).toHaveBeenCalledWith("web");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "View: Terminal" }));
    expect(onSelect).toHaveBeenCalledWith("tty");
  });

  it("rows carry tabIndex=-1 (roving-focus menu model)", () => {
    render(
      <ViewSwitcherMenuRows views={["web", "tty"]} active="tty" onSelect={() => {}} />,
    );
    for (const row of screen.getAllByRole("menuitemradio")) {
      expect(row.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("renders a view not in DISPLAY_ORDER at the END (future lens, not dropped)", () => {
    const future = "desktop" as ViewName;
    render(
      <ViewSwitcherMenuRows
        views={["web", "tty", future]}
        active="tty"
        onSelect={() => {}}
      />,
    );
    const rows = screen.getAllByRole("menuitemradio");
    // Three rows render (unlisted lens appended, not dropped).
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toBe("View: Terminal");
    expect(rows[1].textContent).toBe("View: Web");
  });

  it("renders nothing for a single-view (tty-only) window", () => {
    const { container } = render(
      <ViewSwitcherMenuRows views={["tty"]} active="tty" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });
});
