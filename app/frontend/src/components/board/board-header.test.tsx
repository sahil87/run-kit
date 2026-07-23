import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BoardHeader } from "./board-header";
import type { BoardEntry } from "@/api/boards";

const entry: BoardEntry = {
  server: "rk-dev",
  windowId: "@3",
  session: "sess",
  windowIndex: 2,
  windowName: "win-a",
  orderKey: "a0",
};

describe("BoardHeader unpin glyph (260715-6jwn)", () => {
  afterEach(cleanup);

  it("renders a pin/unpin SVG glyph — NOT a `×` text glyph", () => {
    const { container } = render(<BoardHeader entry={entry} onUnpin={() => {}} />);
    const button = screen.getByRole("button", { name: "Unpin win-a from board" });
    // The unpin affordance is a hand-rolled inline SVG (no icon library), not
    // the old text ✕: the button holds an <svg>, and no `×` text leaks into the
    // accessible tree.
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).not.toContain("×");
    // The glyph is decorative (aria-hidden) so the button's accessible name is
    // the label alone.
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("preserves the tip, no-drag, and click-unpin (stopPropagation) contract", () => {
    const onUnpin = vi.fn();
    render(<BoardHeader entry={entry} onUnpin={onUnpin} />);
    const button = screen.getByRole("button", { name: "Unpin win-a from board" });
    // Hover hint is a styled Tip now (260722-73al) — no native title (never
    // both). The accessible name stays on the aria-label above.
    expect(button.getAttribute("title")).toBeNull();
    // Non-draggable so a grab on the button never starts a header drag.
    expect(button.getAttribute("draggable")).toBe("false");
    // Clicking unpins (no confirmation dialog) and stops propagation so the
    // click does not bubble to the pane (which would refocus).
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stop = vi.spyOn(clickEvent, "stopPropagation");
    fireEvent(button, clickEvent);
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });
});

describe("BoardHeader dual-residence crumb (co9z)", () => {
  afterEach(cleanup);

  it("renders `{session} › {window}` when the home session is derivable", () => {
    render(<BoardHeader entry={entry} onUnpin={() => {}} homeSession="my-home" />);
    // The home session is shown, followed by the `›` separator and the window.
    expect(screen.getByText("my-home")).toBeInTheDocument();
    expect(screen.getByText("›")).toBeInTheDocument();
    expect(screen.getByText("win-a")).toBeInTheDocument();
    // The `· {server}` fallback tag is NOT shown when the crumb is available.
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("falls back to `{window} · {server}` when the home session is not derivable", () => {
    render(<BoardHeader entry={entry} onUnpin={() => {}} />);
    // No home session → window name + server tag, no `›` crumb.
    expect(screen.getByText("win-a")).toBeInTheDocument();
    expect(screen.getByText("·")).toBeInTheDocument();
    expect(screen.getByText("rk-dev")).toBeInTheDocument();
    expect(screen.queryByText("›")).not.toBeInTheDocument();
  });
});
