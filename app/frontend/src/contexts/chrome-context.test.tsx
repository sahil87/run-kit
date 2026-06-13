import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import {
  ChromeProvider,
  useChromeState,
  useChromeDispatch,
  TERMINAL_FONT_BOUNDS,
} from "./chrome-context";

const FONT_KEY = "runkit-terminal-font-size";

function FontConsumer() {
  const { terminalFontSize } = useChromeState();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
  return (
    <div>
      <span data-testid="size">{terminalFontSize}</span>
      <button onClick={increaseTerminalFont}>inc</button>
      <button onClick={decreaseTerminalFont}>dec</button>
      <button onClick={resetTerminalFont}>reset</button>
    </div>
  );
}

function renderConsumer() {
  return render(
    <ChromeProvider>
      <FontConsumer />
    </ChromeProvider>,
  );
}

const size = () => Number(screen.getByTestId("size").textContent);
const click = (name: string) => act(() => { fireEvent.click(screen.getByText(name)); });

/** Stub matchMedia so isMobileViewport() resolves deterministically. The
 * provider treats narrow width OR coarse pointer as mobile. */
function mockViewport(mobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: mobile,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

describe("ChromeProvider terminal font size", () => {
  beforeEach(() => {
    localStorage.clear();
    mockViewport(false); // default to desktop
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // restoreAllMocks does not undo stubGlobal — unstub matchMedia explicitly
    // so the viewport stub cannot leak into other suites.
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("exports bounds 8-24 step 1", () => {
    expect(TERMINAL_FONT_BOUNDS).toEqual({ min: 8, max: 24, step: 1 });
  });

  it("defaults to the desktop device default (13) when unset", () => {
    renderConsumer();
    expect(size()).toBe(13);
    expect(localStorage.getItem(FONT_KEY)).toBeNull();
  });

  it("defaults to the mobile device default (11) when unset on a mobile viewport", () => {
    mockViewport(true);
    renderConsumer();
    expect(size()).toBe(11);
  });

  it("reads and clamps a stored preference on init", () => {
    localStorage.setItem(FONT_KEY, "18");
    renderConsumer();
    expect(size()).toBe(18);
  });

  it("clamps an out-of-range stored value on read (above max)", () => {
    localStorage.setItem(FONT_KEY, "999");
    renderConsumer();
    expect(size()).toBe(24);
  });

  it("clamps an out-of-range stored value on read (below min)", () => {
    localStorage.setItem(FONT_KEY, "3");
    renderConsumer();
    expect(size()).toBe(8);
  });

  it("first increase from the unset state steps off the device default and persists (desktop 13 -> 14)", () => {
    renderConsumer();
    expect(size()).toBe(13);
    expect(localStorage.getItem(FONT_KEY)).toBeNull();
    click("inc");
    expect(size()).toBe(14);
    expect(localStorage.getItem(FONT_KEY)).toBe("14");
  });

  it("first decrease from the unset state steps off the device default and persists (desktop 13 -> 12)", () => {
    renderConsumer();
    click("dec");
    expect(size()).toBe(12);
    expect(localStorage.getItem(FONT_KEY)).toBe("12");
  });

  it("increase clamps at the max (24)", () => {
    localStorage.setItem(FONT_KEY, "23");
    renderConsumer();
    click("inc");
    expect(size()).toBe(24);
    click("inc");
    expect(size()).toBe(24);
    expect(localStorage.getItem(FONT_KEY)).toBe("24");
  });

  it("decrease clamps at the min (8)", () => {
    localStorage.setItem(FONT_KEY, "9");
    renderConsumer();
    click("dec");
    expect(size()).toBe(8);
    click("dec");
    expect(size()).toBe(8);
    expect(localStorage.getItem(FONT_KEY)).toBe("8");
  });

  it("reset forgets the preference (removes the key) and reverts to the device default", () => {
    localStorage.setItem(FONT_KEY, "20");
    renderConsumer();
    expect(size()).toBe(20);
    click("reset");
    expect(localStorage.getItem(FONT_KEY)).toBeNull();
    expect(size()).toBe(13); // desktop default
  });

  it("reset reverts to the mobile default on a mobile viewport", () => {
    mockViewport(true);
    localStorage.setItem(FONT_KEY, "20");
    renderConsumer();
    click("reset");
    expect(size()).toBe(11);
  });

  it("survives a localStorage write throw without breaking (try/catch noop)", () => {
    renderConsumer();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    // Should not throw; state still updates even though persistence failed.
    expect(() => click("inc")).not.toThrow();
    expect(size()).toBe(14);
    setItem.mockRestore();
  });
});
