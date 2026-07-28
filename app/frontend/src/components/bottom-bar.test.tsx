import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { BottomBar } from "./bottom-bar";
import { TIP_OPEN_DELAY_MS } from "@/components/tip";
import { FocusedTerminalProvider } from "@/contexts/focused-terminal-context";
import { ChromeProvider } from "@/contexts/chrome-context";

function renderBottomBar(overrides: Partial<React.ComponentProps<typeof BottomBar>> = {}) {
  // Tests render the BottomBar with no focused terminal; the existing
  // `wsRef.current?.readyState !== OPEN` guard ensures input handlers no-op.
  // ChromeProvider supplies `composeStripEnabled` (the `>_` chip's pressed
  // state) read via `useChromeState`.
  return render(
    <ChromeProvider>
      <FocusedTerminalProvider>
        <BottomBar
          onFocusTerminal={vi.fn()}
          onScrollLockChange={vi.fn()}
          {...overrides}
        />
      </FocusedTerminalProvider>
    </ChromeProvider>,
  );
}

describe("BottomBar scroll-lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    // Spread (`{ ...navigator }`) would drop jsdom's prototype getters
    // (platform/userAgent), which floating-ui reads now that the chips carry
    // Tips (260723-fm08) — carry the string fields over explicitly instead.
    vi.stubGlobal("navigator", {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      maxTouchPoints: navigator.maxTouchPoints,
      vibrate: vibrateMock,
    });

    renderBottomBar();

    const btn = screen.getByLabelText("Show keyboard");
    fireEvent.touchStart(btn, { touches: [{ clientX: 100, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });

    expect(vibrateMock).toHaveBeenCalledWith(50);
  });
});

describe("BottomBar chip tips (260723-fm08)", () => {
  // Tier-1 Tip wiring on the symbol-glyph chips (⇥ ^ ⌥ F▴ >_ ⌘K + the
  // ArrowPad trigger). Deep tooltip behavior is pinned once in tip.test.tsx;
  // here we assert the per-site label wiring, the ⌘K keycap slot, the
  // migration contract (no native title), and that the latch behavior
  // survives the clone-child wrap. jsdom has no matchMedia → fine pointer.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("hovering the ⌘K chip shows 'Command palette' with a ⌘K keycap chip", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const chip = screen.getByLabelText("Open command palette");
    act(() => {
      fireEvent.mouseEnter(chip);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Command palette");
    // The kbd slot renders as a real <kbd> keycap chip inside the tooltip.
    const kbd = tooltip.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent("⌘K");
  });

  it("modifier chips carry plain key-name tips and still toggle aria-pressed", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const ctrl = screen.getByLabelText("Control");
    act(() => {
      fireEvent.mouseEnter(ctrl);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    // Terminal vocabulary ("Ctrl"), not the mac aria-name ("Control") — and no
    // latch prose: the pressed state teaches the one-shot behavior.
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Ctrl$/);

    // The one-shot latch behavior survives the Tip wrap: clicking arms it.
    expect(ctrl).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ctrl);
    expect(ctrl).toHaveAttribute("aria-pressed", "true");
  });

  it("tipped chips carry no native title and keep their aria-labels", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    for (const name of [
      "Tab",
      "Control",
      "Option",
      "Function keys",
      "Arrow keys",
      "Compose text",
      "Open command palette",
    ]) {
      const chip = screen.getByLabelText(name);
      expect(chip).not.toHaveAttribute("title");
    }
  });
});
