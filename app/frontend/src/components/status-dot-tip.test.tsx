import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { StatusDotTip } from "./status-dot-tip";
import type { StatusDotState } from "./pr-status-model";
import type { WindowInfo } from "@/types";

// The freshness line ("checked Xs ago") renders inside the floating hover-card,
// which opens on hover after a short delay (@floating-ui `useHover` delay:150).
// These tests drive fake timers to open the card and to control the useNow()
// display clock so the relative time is deterministic.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "win",
    worktreePath: "/p",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

const FLOOR_STATE: StatusDotState = { phase: "none", shape: "solid", waiting: false };

// Render the tip and open the hover-card. The dot is rendered via renderDot; we
// spread the reference props onto a real element and fire a pointer enter, then
// advance past the open delay.
function renderOpen(win: WindowInfo) {
  render(
    <StatusDotTip
      win={win}
      state={FLOOR_STATE}
      renderDot={(setRef, refProps) => (
        <button type="button" ref={setRef} {...refProps} data-testid="dot">
          dot
        </button>
      )}
    />,
  );
  const dot = screen.getByTestId("dot");
  act(() => {
    fireEvent.pointerEnter(dot, { pointerType: "mouse" });
    fireEvent.mouseEnter(dot);
    vi.advanceTimersByTime(200); // past the useHover open delay
  });
}

describe("StatusDotTip freshness line (260715-nwla)", () => {
  it("renders 'checked Xs ago' when prFetchedAt is present", () => {
    // now = 2026-07-15T10:00:30Z; fetched 30s earlier → "checked 30s ago".
    vi.setSystemTime(new Date("2026-07-15T10:00:30Z"));
    renderOpen(makeWindow({ prFetchedAt: "2026-07-15T10:00:00Z" }));

    const line = screen.getByTestId("dot-tip-checked");
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent("checked 30s ago");
  });

  it("omits the freshness line when prFetchedAt is absent", () => {
    vi.setSystemTime(new Date("2026-07-15T10:00:30Z"));
    renderOpen(makeWindow({}));

    // The card is open (label shows) but there is no freshness line.
    expect(screen.getByTestId("status-dot-tip")).toBeInTheDocument();
    expect(screen.queryByTestId("dot-tip-checked")).toBeNull();
  });

  it("omits the freshness line when prFetchedAt is unparseable", () => {
    vi.setSystemTime(new Date("2026-07-15T10:00:30Z"));
    renderOpen(makeWindow({ prFetchedAt: "garbage" }));

    expect(screen.getByTestId("status-dot-tip")).toBeInTheDocument();
    expect(screen.queryByTestId("dot-tip-checked")).toBeNull();
  });
});
