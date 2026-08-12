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
) {
  // Tests default to NO focused terminal; the existing
  // `wsRef.current?.readyState !== OPEN` guard ensures input handlers no-op.
  // Pass `focus` for surfaces gated on a live compose target.
  // ChromeProvider supplies `composeStripEnabled` (the `>_` chip's pressed
  // state) read via `useChromeState`.
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

describe("BottomBar chip tips (260723-fm08)", () => {
  // Tier-1 Tip wiring on the symbol-glyph chips (⇥ ^ ⌥ F▴ >_ ⌘K + the
  // ArrowPad trigger). Deep tooltip behavior is pinned once in tip.test.tsx;
  // here we assert the per-site label wiring, the registry-resolved keycap
  // slots (260801-mqim — jsdom detects platform "other", so chords render in
  // the Ctrl spelling), the migration contract (no native title), and that
  // the latch behavior survives the clone-child wrap. jsdom has no
  // matchMedia → fine pointer.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("hovering the ⌘K chip shows 'Command palette' with the platform-effective keycap chip", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const chip = screen.getByLabelText("Open command palette");
    act(() => {
      fireEvent.mouseEnter(chip);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Command palette");
    // The kbd slot renders the REGISTRY-resolved chord as a real <kbd> keycap
    // chip — "Ctrl+K" on jsdom's non-mac platform, no longer a static ⌘K
    // (260801-mqim). The button FACE keeps the ⌘K brand glyph.
    const kbd = tooltip.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent("Ctrl+K");
    expect(chip.querySelector("kbd")).toHaveTextContent("⌘K");
  });

  it("hovering the compose chip shows its registry-resolved chord chip (260801-mqim)", () => {
    renderBottomBar({ onOpenCompose: vi.fn() });
    const chip = screen.getByLabelText("Compose text");
    act(() => {
      fireEvent.mouseEnter(chip);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Compose text");
    expect(tooltip.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+E");
  });

  it("omits the keycap chip when the binding is disabled — a dead chord would lie (260801-mqim)", () => {
    localStorage.setItem("runkit-keybindings", JSON.stringify({ "compose-toggle": null }));
    renderBottomBar({ onOpenCompose: vi.fn() });
    const chip = screen.getByLabelText("Compose text");
    act(() => {
      fireEvent.mouseEnter(chip);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Compose text");
    expect(tooltip.querySelector("kbd")).toBeNull();
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

describe("BottomBar chip order + compose hint (260811-0f3d)", () => {
  // The fine-pointer chip run renders ⌘K (palette) FIRST and >_ (compose)
  // LAST — compose is the higher-touch control and takes the end-of-run
  // position. The dead space right of the pair carries a dimmed compose
  // education line, gated on: compose target present, strip OFF, fine
  // pointer, ≥lg viewport (the lg gate is the CSS `hidden lg:flex` pair —
  // jsdom asserts the classes; the 375px budget is untouched). jsdom
  // platform is "other", so the chord renders in the Ctrl spelling.
  const HINT_TEXT = /compose — type here, send to the pane/;

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

  it("shows the compose hint with the registry-resolved chord keycap while the strip is off", () => {
    renderBottomBar({ onOpenCompose: vi.fn() }, COMPOSE_TARGET);
    const hint = screen.getByText(HINT_TEXT);
    const line = hint.parentElement!;
    // Non-interactive education copy: aria-hidden (the adjacent chip carries
    // the accessible name), CSS-gated to wide viewports.
    expect(line).toHaveAttribute("aria-hidden", "true");
    expect(line.className).toContain("hidden");
    expect(line.className).toContain("lg:flex");
    expect(line.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+E");
  });

  it("hides the hint once the compose strip is on — the feature has been found", () => {
    localStorage.setItem("runkit-compose-strip", "true");
    renderBottomBar({ onOpenCompose: vi.fn() }, COMPOSE_TARGET);
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it("hides the hint on coarse pointers — chords are noise on touch", () => {
    stubMatchMedia((query) => query === "(pointer: coarse)");
    renderBottomBar({ onOpenCompose: vi.fn() }, COMPOSE_TARGET);
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it("omits the hint when there is no compose target", () => {
    // `onOpenCompose` is wired unconditionally in app.tsx, so the absence of a
    // focused terminal — not the prop — is what must suppress the hint.
    renderBottomBar({ onOpenCompose: vi.fn() });
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });

  it("keeps the hint text but drops the keycap when compose-toggle is disabled", () => {
    localStorage.setItem("runkit-keybindings", JSON.stringify({ "compose-toggle": null }));
    renderBottomBar({ onOpenCompose: vi.fn() }, COMPOSE_TARGET);
    const hint = screen.getByText(HINT_TEXT);
    expect(hint.parentElement!.querySelector("kbd")).toBeNull();
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
