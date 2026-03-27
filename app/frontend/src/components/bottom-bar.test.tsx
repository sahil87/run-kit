import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { BottomBar } from "./bottom-bar";

function createWsRef(): React.RefObject<WebSocket | null> {
  return { current: null };
}

function renderBottomBar(overrides: Partial<React.ComponentProps<typeof BottomBar>> = {}) {
  return render(
    <BottomBar
      wsRef={createWsRef()}
      onFocusTerminal={vi.fn()}
      onScrollLockChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("BottomBar scroll-lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders keyboard toggle with 'Show keyboard' label by default", () => {
    renderBottomBar();
    expect(screen.getByLabelText("Show keyboard")).toBeInTheDocument();
  });

  it("long-press toggles scroll-lock on", () => {
    const onScrollLockChange = vi.fn();
    renderBottomBar({ onScrollLockChange });

    const btn = screen.getByLabelText("Show keyboard");

    // Simulate touchstart
    fireEvent.touchStart(btn, {
      touches: [{ clientX: 100, clientY: 100 }],
    });

    // Advance past 500ms threshold
    act(() => { vi.advanceTimersByTime(500); });

    expect(onScrollLockChange).toHaveBeenCalledWith(true);
  });

  it("long-press when locked toggles scroll-lock off", () => {
    const onScrollLockChange = vi.fn();
    renderBottomBar({ onScrollLockChange });

    const btn = screen.getByLabelText("Show keyboard");

    // First long-press to lock
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(onScrollLockChange).toHaveBeenCalledWith(true);

    // Now button shows locked state
    const lockedBtn = screen.getByLabelText(/Scroll lock on/);

    // Second long-press to unlock
    fireEvent.touchStart(lockedBtn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(onScrollLockChange).toHaveBeenCalledWith(false);
  });

  it("tap (short touch) preserves existing keyboard toggle behavior", () => {
    const onFocusTerminal = vi.fn();
    renderBottomBar({ onFocusTerminal });

    const btn = screen.getByLabelText("Show keyboard");

    // Short tap: touchstart then touchend before 500ms, then click
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.touchEnd(btn);
    fireEvent.click(btn);

    expect(onFocusTerminal).toHaveBeenCalledTimes(1);
  });

  it("tap in locked mode unlocks and summons keyboard", () => {
    const onFocusTerminal = vi.fn();
    const onScrollLockChange = vi.fn();
    renderBottomBar({ onFocusTerminal, onScrollLockChange });

    const btn = screen.getByLabelText("Show keyboard");

    // Long-press to lock
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(onScrollLockChange).toHaveBeenCalledWith(true);
    onFocusTerminal.mockClear();
    onScrollLockChange.mockClear();

    // Tap the now-locked button (short touch + click)
    const lockedBtn = screen.getByLabelText(/Scroll lock on/);
    fireEvent.touchStart(lockedBtn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.touchEnd(lockedBtn);
    fireEvent.click(lockedBtn);

    expect(onScrollLockChange).toHaveBeenCalledWith(false);
    expect(onFocusTerminal).toHaveBeenCalledTimes(1);
  });

  it("touch move > 10px cancels long-press", () => {
    const onScrollLockChange = vi.fn();
    renderBottomBar({ onScrollLockChange });

    const btn = screen.getByLabelText("Show keyboard");

    // Start touch
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });

    // Move finger 15px (exceeds 10px threshold)
    fireEvent.touchMove(btn, { touches: [{ clientX: 115, clientY: 100 }] });

    // Wait past 500ms — should NOT trigger
    act(() => { vi.advanceTimersByTime(600); });

    expect(onScrollLockChange).not.toHaveBeenCalled();
  });

  it("shows lock icon and accent styling when scroll-locked", () => {
    renderBottomBar();

    const btn = screen.getByLabelText("Show keyboard");

    // Long-press to lock
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    // Button should now show locked state
    const lockedBtn = screen.getByLabelText(/Scroll lock on/);
    expect(lockedBtn).toBeInTheDocument();
    expect(lockedBtn.className).toContain("bg-accent/20");
    expect(lockedBtn.className).toContain("border-accent");
    expect(lockedBtn.className).toContain("text-accent");

    // Icon should be lock symbol
    const kbd = lockedBtn.querySelector("kbd");
    expect(kbd?.textContent).toBe("\uD83D\uDD12");
  });

  it("shows keyboard icon and default styling when unlocked", () => {
    renderBottomBar();

    const btn = screen.getByLabelText("Show keyboard");
    expect(btn.className).toContain("text-text-secondary");
    expect(btn.className).not.toContain("bg-accent/20");

    const kbd = btn.querySelector("kbd");
    expect(kbd?.textContent).toBe("\u2328");
  });

  it("aria-label updates correctly for locked state", () => {
    renderBottomBar();

    const btn = screen.getByLabelText("Show keyboard");

    // Long-press to lock
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(screen.getByLabelText("Scroll lock on \u2014 tap to unlock")).toBeInTheDocument();
  });

  it("click after long-press is suppressed (no double action)", () => {
    const onFocusTerminal = vi.fn();
    const onScrollLockChange = vi.fn();
    renderBottomBar({ onFocusTerminal, onScrollLockChange });

    const btn = screen.getByLabelText("Show keyboard");

    // Long-press
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    // Long-press triggered lock
    expect(onScrollLockChange).toHaveBeenCalledWith(true);
    onScrollLockChange.mockClear();

    // Subsequent click after long-press should be suppressed
    fireEvent.touchEnd(btn);
    fireEvent.click(btn);

    // Should NOT have called onFocusTerminal or toggled scroll lock again
    expect(onFocusTerminal).not.toHaveBeenCalled();
    expect(onScrollLockChange).not.toHaveBeenCalled();
  });

  it("calls navigator.vibrate on long-press toggle", () => {
    const vibrateMock = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate: vibrateMock });

    renderBottomBar();

    const btn = screen.getByLabelText("Show keyboard");
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(vibrateMock).toHaveBeenCalledWith(50);
  });
});
