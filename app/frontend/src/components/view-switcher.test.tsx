import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ViewSwitcher } from "./view-switcher";

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

  it("renders segments tty-first regardless of the incoming list order", () => {
    // The caller passes HINT_ORDER (web-first, from `availableViews`); the
    // switcher renders the fixed DISPLAY order `[tty|web]` (spec R4 / plan R7).
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
