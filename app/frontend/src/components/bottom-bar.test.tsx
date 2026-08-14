import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import { BottomBar } from "./bottom-bar";
import { TIP_OPEN_DELAY_MS } from "@/components/tip";
import {
  FocusedTerminalProvider,
  useFocusedTerminal,
  type FocusedTerminal,
} from "@/contexts/focused-terminal-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { stubMatchMedia } from "@/test-utils/match-media";
import { setComposeStripFocused } from "@/lib/compose-strip-events";

/** A compose target, as TerminalClient/BoardPane would register one. */
const COMPOSE_TARGET: FocusedTerminal = {
  wsRef: { current: null },
  containerRef: { current: null },
  server: "srv",
  session: "sess",
  windowId: "@1",
};

/** Stands in for the real producers (TerminalClient, BoardPane) so
 *  target-gated surfaces render. */
function FocusSeeder({ focus }: { focus: FocusedTerminal }) {
  const { setFocused } = useFocusedTerminal();
  useEffect(() => {
    setFocused(focus);
  }, [focus, setFocused]);
  return null;
}

function renderBottomBar(
  overrides: Partial<React.ComponentProps<typeof BottomBar>> = {},
  focus: FocusedTerminal = null,
  pointer: "coarse" | "fine" = "coarse",
) {
  // Tests default to NO focused terminal; the existing
  // `wsRef.current?.readyState !== OPEN` guard ensures input handlers no-op.
  // Pass `focus` for surfaces gated on a live compose target.
  // ChromeProvider supplies `composeStripEnabled` (the `a▏` chip's pressed
  // state) read via `useChromeState`.
  // Pointer gate (260814-ldbs): the bar renders ONLY on coarse pointers now —
  // the default stub installs `(pointer: coarse)` so the existing suites
  // exercise the bar at all; pass `pointer: "fine"` for the gate tests.
  stubMatchMedia((q) => pointer === "coarse" && q === "(pointer: coarse)");
  return render(
    <ChromeProvider>
      <FocusedTerminalProvider>
        {focus && <FocusSeeder focus={focus} />}
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

describe("BottomBar chips on the coarse-only bar (260723-fm08; gate 260814-ldbs)", () => {
  // The bar renders ONLY on coarse pointers now (260814-ldbs R3), and tier-1
  // Tips self-suppress under `pointer: coarse` — so the chips' accessible
  // names ride their aria-labels (hover tooltips never fire on the bar's
  // pointer class). Deep tooltip behavior is pinned in tip.test.tsx; here we
  // assert the label contract, the migration contract (no native title), and
  // that the latch behavior is intact. (The helper stubs a coarse pointer.)
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("chips keep their aria-labels and faces; hover shows no tooltip on coarse (Tip suppression)", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const chip = screen.getByLabelText("Open command palette");
    // The button FACE keeps the ⌘K brand glyph on every platform.
    expect(chip.querySelector("kbd")).toHaveTextContent("⌘K");
    act(() => {
      fireEvent.mouseEnter(chip);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("modifier chips toggle aria-pressed", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const ctrl = screen.getByLabelText("Control");
    // The one-shot latch behavior: clicking arms it.
    expect(ctrl).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ctrl);
    expect(ctrl).toHaveAttribute("aria-pressed", "true");
  });

  it("chips carry no native title and keep their aria-labels", () => {
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

describe("BottomBar pointer gate (260814-ldbs R3)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing on a fine pointer — no toolbar, and no reserved frame (the PR #598 property)", () => {
    const { container } = renderBottomBar({ onOpenCompose: vi.fn() }, null, "fine");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    // The 3px-seam + 48px frame lives INSIDE the component, so the gate
    // removes the reserved height too — nothing is left behind.
    expect(container.querySelector(".border-t-\\[3px\\]")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("attaches no document listeners on a fine pointer — the gate covers the effects, not just the render", () => {
    // The render-time `return null` leaves the component (and every effect)
    // mounted, so each always-on effect carries the coarse gate too. The
    // focusin/focusout pair feeds `termFocused`, which drives only the
    // coarse-gated ⌨/🔒 chip — on a desktop it would re-render this component
    // on every terminal focus change to feed a chip that never renders.
    const addSpy = vi.spyOn(document, "addEventListener");
    renderBottomBar({ onOpenCompose: vi.fn() }, null, "fine");
    const events = addSpy.mock.calls.map(([type]) => type);
    expect(events).not.toContain("focusin");
    expect(events).not.toContain("focusout");
    expect(events).not.toContain("keydown");
    addSpy.mockRestore();
  });

  it("attaches the focus-tracking listeners on a coarse pointer", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    renderBottomBar({ onOpenCompose: vi.fn() }, null, "coarse");
    const events = addSpy.mock.calls.map(([type]) => type);
    expect(events).toContain("focusin");
    expect(events).toContain("focusout");
    addSpy.mockRestore();
  });

  it("renders today's bar verbatim on a coarse pointer", () => {
    renderBottomBar({ onOpenCompose: vi.fn() }, null, "coarse");
    const toolbar = screen.getByRole("toolbar", { name: "Terminal keys" });
    expect(toolbar).toBeInTheDocument();
    // Attached frame chrome: the 3px structural seam + 48px row (TipGroup
    // renders no DOM wrapper, so the toolbar's parent IS the frame).
    const frame = toolbar.parentElement!;
    expect(frame.className).toContain("border-t-[3px]");
    expect(frame.className).toContain("h-[48px]");
  });
});

describe("BottomBar chip order + compose chip (260811-0f3d)", () => {
  // The chip run renders ⌘K (palette) FIRST and a▏ (compose) LAST — compose is
  // the higher-touch control and takes the end-of-run position. (The
  // fine-pointer education hint this describe used to cover was removed in
  // 260814-ldbs: it was `!coarse`-gated, and the bar itself is coarse-only
  // now, so it could never render — the status bar's `a` segment carries the
  // compose education role.)
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders the palette chip before the compose chip in DOM order", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const palette = screen.getByLabelText("Open command palette");
    const compose = screen.getByLabelText("Compose text");
    expect(
      palette.compareDocumentPosition(compose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("compose chip bar is static while the strip is off — no blink class", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const compose = screen.getByLabelText("Compose text");
    expect(compose.textContent).toBe("a▏");
    expect(compose.querySelector(".rk-compose-caret")).toBeNull();
  });

  it("compose chip bar blinks while the strip is on — rk-compose-caret on the ▏ span", () => {
    localStorage.setItem("runkit-compose-strip", "true");
    renderBottomBar({ onOpenCompose: vi.fn() });
    const compose = screen.getByLabelText("Compose text");
    const bar = compose.querySelector(".rk-compose-caret");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toBe("▏");
  });
});

/**
 * Compose-focus hide (260814-ink6): on a coarse pointer the whole bar
 * unmounts while the compose strip's textarea owns focus (its keys send to
 * the terminal — dead weight mid-compose), and returns on blur. The signal
 * is the module store in `compose-strip-events.ts`, driven here directly.
 */
describe("BottomBar compose-focus hide (260814-ink6)", () => {
  afterEach(() => {
    cleanup();
    // Module-global flag — never leak a stuck `true` into another suite.
    setComposeStripFocused(false);
    vi.unstubAllGlobals();
  });

  it("hides while the compose textarea is focused on a coarse pointer, and returns on blur", () => {
    stubMatchMedia((query) => query === "(pointer: coarse)");
    renderBottomBar({ onOpenCompose: vi.fn() });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();

    act(() => setComposeStripFocused(true));
    expect(screen.queryByRole("toolbar")).toBeNull();

    act(() => setComposeStripFocused(false));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("never renders on a fine pointer at all — the compose-focus hide is moot there (260814-ldbs)", () => {
    // The pointer gate supersedes ink6's "fine pointers never hide" rule:
    // fine-pointer desktops have no bar to hide. The compose-focus flag must
    // not matter either way.
    renderBottomBar({ onOpenCompose: vi.fn() }, null, "fine");
    act(() => setComposeStripFocused(true));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => setComposeStripFocused(false));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("detaches the armed-modifier keydown interceptor while hidden — rendering null does not unmount the effects", () => {
    // Rendering null keeps the component (and its document-level capture
    // listener) mounted, so the effect self-gates on coarse && composeFocused.
    // A modifier armed BEFORE focus moves to the compose textarea must not
    // intercept compose keystrokes; it re-arms the interception on blur.
    stubMatchMedia((query) => query === "(pointer: coarse)");
    const send = vi.fn();
    const ws = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    renderBottomBar({ onOpenCompose: vi.fn() }, { ...COMPOSE_TARGET, wsRef: { current: ws } });

    fireEvent.click(screen.getByLabelText("Control")); // arm Ctrl
    act(() => setComposeStripFocused(true));
    fireEvent.keyDown(document, { key: "c" });
    expect(send).not.toHaveBeenCalled();

    // On blur the bar returns, the still-armed modifier intercepts again.
    act(() => setComposeStripFocused(false));
    fireEvent.keyDown(document, { key: "c" });
    expect(send).toHaveBeenCalledWith("\x03");
  });
});

/**
 * Mobile surface sheet (260812-ab5v T014/R13): the ▦ chip renders only when
 * `surfaceSheet` carries a MULTI-surface list (app.tsx gates it to the mobile
 * terminal route with a multi-tile layout); it opens the full-height sheet of
 * surface tabs that swap the mobile slot-A surface (transient — never a layout
 * mutation).
 */
describe("BottomBar mobile surface sheet (T014/R13)", () => {
  const threeSurfaces = {
    surfaces: ["tty", "code", "web"] as ("tty" | "code" | "web")[],
    active: "tty" as const,
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the ▦ chip only when the sheet carries more than one surface", () => {
    renderBottomBar({ surfaceSheet: { ...threeSurfaces, onSelect: vi.fn() } });
    expect(screen.getByTestId("mobile-surfaces-chip")).toBeInTheDocument();

    cleanup();
    renderBottomBar({
      surfaceSheet: { surfaces: ["tty"], active: "tty", onSelect: vi.fn() },
    });
    expect(screen.queryByTestId("mobile-surfaces-chip")).not.toBeInTheDocument();

    cleanup();
    renderBottomBar();
    expect(screen.queryByTestId("mobile-surfaces-chip")).not.toBeInTheDocument();
  });

  it("the chip opens the sheet listing every open surface as a tab, active marked", () => {
    const onSelect = vi.fn();
    renderBottomBar({ surfaceSheet: { ...threeSurfaces, onSelect } });
    fireEvent.click(screen.getByTestId("mobile-surfaces-chip"));
    const sheet = screen.getByTestId("mobile-surface-sheet");
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveAttribute("role", "dialog");
    // One tab per open surface (slot A included — the way BACK after a tab
    // switch), tty first, the shown surface pressed.
    expect(screen.getByTestId("mobile-surface-tab-tty")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mobile-surface-tab-code")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("mobile-surface-tab-web")).toBeInTheDocument();
  });

  it("selecting a tab fires onSelect with the surface and closes the sheet", () => {
    const onSelect = vi.fn();
    renderBottomBar({ surfaceSheet: { ...threeSurfaces, onSelect } });
    fireEvent.click(screen.getByTestId("mobile-surfaces-chip"));
    fireEvent.click(screen.getByTestId("mobile-surface-tab-code"));
    expect(onSelect).toHaveBeenCalledWith("code");
    expect(screen.queryByTestId("mobile-surface-sheet")).not.toBeInTheDocument();
  });

  it("Escape closes the sheet (the dialog contract)", () => {
    renderBottomBar({ surfaceSheet: { ...threeSurfaces, onSelect: vi.fn() } });
    fireEvent.click(screen.getByTestId("mobile-surfaces-chip"));
    expect(screen.getByTestId("mobile-surface-sheet")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("mobile-surface-sheet")).not.toBeInTheDocument();
  });
});
