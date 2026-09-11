import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act, within } from "@testing-library/react";
import {
  GuiToolbar,
  TOOLBAR_HIDE_MS,
  TOOLBAR_OVERFLOW_MIN_PX,
  TOOLBAR_SHORT_LABEL_MAX_PX,
} from "./gui-toolbar";
import { buildGuiActions, type GuiPaletteAction, type GuiPaletteInput } from "@/lib/palette/gui";
import type { GuiPointerMode, GuiQuality, GuiZoom } from "@/lib/gui-posture";

afterEach(cleanup);

function paletteInput(overrides: Partial<GuiPaletteInput> = {}): GuiPaletteInput {
  return {
    enabled: true,
    reachable: true,
    backend: "Xtigervnc",
    tileOpen: true,
    connected: true,
    coarsePointer: true,
    zoom: 100,
    pointerMode: "trackpad",
    resizeLocked: false,
    locked: false,
    quality: "balanced",
    statsVisible: false,
    hidpi: false,
    keyBarVisible: true,
    geometry: "auto",
    supervisorAvailable: true,
    onTurnOn: vi.fn(),
    onTurnOff: vi.fn(),
    loadDesktopRows: vi.fn().mockResolvedValue([]),
    onLaunch: vi.fn(),
    onResize: vi.fn(),
    onResizeCustom: vi.fn(),
    onMatchTile: vi.fn(),
    onFullscreen: vi.fn(),
    onPaste: vi.fn(),
    onZoom: vi.fn(),
    onPointerMode: vi.fn(),
    onLockChange: vi.fn(),
    onQuality: vi.fn(),
    onStatsVisible: vi.fn(),
    onHidpiChange: vi.fn(),
    onKeyBarVisibleChange: vi.fn(),
    onSendKey: vi.fn(),
    onOpenLogs: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
}

interface RenderProps {
  input?: Partial<GuiPaletteInput>;
  zoom?: GuiZoom;
  pointerMode?: GuiPointerMode;
  coarsePointer?: boolean;
  fullscreen?: boolean;
  keyBarVisible?: boolean;
  quality?: GuiQuality;
  statsVisible?: boolean;
  connected?: boolean;
  geometry?: string;
  width?: number;
  height?: number;
  locked?: boolean;
  wrapperWidth?: number;
  revealSignal?: number;
}

function el(p: RenderProps, actions: GuiPaletteAction[]) {
  return (
    <GuiToolbar
      actions={actions}
      zoom={p.zoom ?? 100}
      pointerMode={p.pointerMode ?? "trackpad"}
      coarsePointer={p.coarsePointer ?? true}
      fullscreen={p.fullscreen ?? false}
      keyBarVisible={p.keyBarVisible ?? true}
      quality={p.quality ?? "balanced"}
      statsVisible={p.statsVisible ?? false}
      connected={p.connected ?? true}
      geometry={p.geometry ?? "auto"}
      width={p.width ?? 0}
      height={p.height ?? 0}
      locked={p.locked ?? false}
      wrapperWidth={p.wrapperWidth ?? 1280}
      revealSignal={p.revealSignal ?? 0}
    />
  );
}

/** Render the pill against ONE built `buildGuiActions` list (the same array
 *  the palette would get). `rerenderWith` keeps that array identical. */
function setup(props: RenderProps = {}) {
  const input = paletteInput({
    coarsePointer: props.coarsePointer ?? true,
    pointerMode: props.pointerMode ?? "trackpad",
    keyBarVisible: props.keyBarVisible ?? true,
    quality: props.quality ?? "balanced",
    statsVisible: props.statsVisible ?? false,
    connected: props.connected ?? true,
    geometry: props.geometry ?? "auto",
    zoom: props.zoom ?? 100,
    locked: props.locked ?? false,
    ...props.input,
  });
  const actions = buildGuiActions(input);
  const utils = render(el(props, actions));
  return {
    ...utils,
    input,
    actions,
    rerenderWith: (patch: RenderProps) => utils.rerender(el({ ...props, ...patch }, actions)),
  };
}

/** Replace a row's onSelect with a recording wrapper — a chip firing ANY
 *  other function object fails the assertion. */
function spyRow(actions: GuiPaletteAction[], id: string) {
  const row = actions.find((a) => a.id === id);
  if (!row) throw new Error(`palette row ${id} missing`);
  const spy = vi.fn(row.onSelect);
  row.onSelect = spy;
  return spy;
}

const chipLabels = () =>
  within(screen.getByTestId("gui-toolbar"))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

describe("GuiToolbar — show/hide machine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a fine-pointer non-fullscreen viewer starts hidden", () => {
    setup({ coarsePointer: false });
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("a coarse viewer shows on mount and hides TOOLBAR_HIDE_MS later", () => {
    setup();
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("a fullscreen viewer shows on mount", () => {
    setup({ coarsePointer: false, fullscreen: true });
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
  });

  it("a revealSignal bump re-shows the hidden pill and restarts the timer", () => {
    const { rerenderWith } = setup({ coarsePointer: false, revealSignal: 0 });
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
    rerenderWith({ revealSignal: 1 });
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("a chip interaction restarts the hide timer", () => {
    setup();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 100));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("an open menu suspends the hide timer; Escape closes, refocuses the chip, and the timer restarts", () => {
    setup();
    const chipEl = screen.getByTestId("gui-toolbar-resolution");
    fireEvent.click(chipEl);
    expect(chipEl.getAttribute("aria-expanded")).toBe("true");
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    expect(screen.getByTestId("gui-toolbar-menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "Escape" });
    expect(screen.queryByTestId("gui-toolbar-menu")).toBeNull();
    expect(document.activeElement).toBe(chipEl);
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });
});

describe("GuiToolbar — presence table", () => {
  it("fine + connected + non-mirror: the full wide inventory in group order, no ⌖/⌨/↻/⋯", () => {
    setup({ coarsePointer: false, fullscreen: true, geometry: "1920x1080", width: 1920, height: 1080 });
    expect(chipLabels()).toEqual([
      "Resolution 1920×1080, menu",
      "Exit fullscreen",
      "Zoom out",
      "Zoom to fit",
      "Zoom in",
      "Quality",
      "Paste clipboard",
      "Send key…",
      "Open terminal",
      "Open browser",
      "Toggle stats",
    ]);
    // Five non-empty groups ⇒ four dividers.
    expect(screen.getByTestId("gui-toolbar").querySelectorAll(".w-px")).toHaveLength(4);
  });

  it("coarse + connected: the ⌖/⌨ pair joins the Input group", () => {
    setup({ geometry: "1920x1080", width: 1920, height: 1080 });
    expect(chipLabels()).toEqual([
      "Resolution 1920×1080, menu",
      "Enter fullscreen",
      "Zoom out",
      "Zoom to fit",
      "Zoom in",
      "Quality",
      "Pointer mode",
      "Toggle key bar",
      "Paste clipboard",
      "Send key…",
      "Open terminal",
      "Open browser",
      "Toggle stats",
    ]);
  });

  it("disconnected: ⎘/⌥ are absent and ↻ is present", () => {
    setup({ connected: false });
    expect(screen.queryByLabelText("Paste clipboard")).toBeNull();
    expect(screen.queryByLabelText("Send key…")).toBeNull();
    expect(screen.getByLabelText("Reconnect")).toBeTruthy();
  });

  it("mirror backend: the resolution and launch chips are absent with their rows; the quality chip disables", () => {
    setup({ coarsePointer: false, fullscreen: true, input: { backend: "screen-sharing" } });
    expect(screen.queryByTestId("gui-toolbar-resolution")).toBeNull();
    expect(screen.queryByLabelText("Open terminal")).toBeNull();
    expect(screen.queryByLabelText("Open browser")).toBeNull();
    expect(screen.getByLabelText("Quality")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Toggle stats")).toBeTruthy();
  });

  it("the palette-only rows never appear on the pill or in its menus", () => {
    setup({ wrapperWidth: TOOLBAR_OVERFLOW_MIN_PX - 1 });
    fireEvent.click(screen.getByTestId("gui-toolbar-overflow"));
    const pill = screen.getByTestId("gui-toolbar");
    for (const text of ["Turn off", "Desktop…", "logs", "HiDPI", "1:1"]) {
      expect(pill.textContent).not.toContain(text);
    }
  });
});

describe("GuiToolbar — gating", () => {
  it("the zoom chips render disabled (not absent) at fit and at 200", () => {
    setup({ zoom: "fit" });
    expect(screen.getByLabelText("Zoom out")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Zoom to fit")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Zoom in")).toHaveProperty("disabled", false);
    cleanup();
    setup({ zoom: 200 });
    expect(screen.getByLabelText("Zoom in")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Zoom out")).toHaveProperty("disabled", false);
  });

  it("the ⌖ and ⌨ chips are coarse-only", () => {
    setup({ coarsePointer: false, fullscreen: true });
    expect(screen.queryByLabelText("Pointer mode")).toBeNull();
    expect(screen.queryByLabelText("Toggle key bar")).toBeNull();
  });

  it("⤢ toggles its aria-label between Enter and Exit fullscreen", () => {
    const { actions, rerenderWith } = setup({ fullscreen: false });
    const spy = spyRow(actions, "gui-fullscreen");
    fireEvent.click(screen.getByLabelText("Enter fullscreen"));
    expect(spy).toHaveBeenCalledOnce();
    rerenderWith({ fullscreen: true });
    expect(screen.getByLabelText("Exit fullscreen")).toBeTruthy();
  });

  it("∿ reflects the stats posture and fires the destination row", () => {
    const { actions, rerenderWith } = setup({ statsVisible: false });
    const show = spyRow(actions, "gui-stats-show");
    expect(screen.getByLabelText("Toggle stats")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByLabelText("Toggle stats"));
    expect(show).toHaveBeenCalledOnce();
    rerenderWith({ statsVisible: true });
    // The built list still holds gui-stats-show (actions are one build); the
    // pressed state rides the prop.
    expect(screen.getByLabelText("Toggle stats")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("GuiToolbar — the resolution chip", () => {
  it("auto geometry reads `auto ▾`", () => {
    setup();
    const chip = screen.getByTestId("gui-toolbar-resolution");
    expect(chip).toHaveTextContent("auto ▾");
    expect(chip.getAttribute("aria-label")).toBe("Resolution auto, menu");
  });

  it("a fixed geometry reads the live W×H", () => {
    setup({ geometry: "1920x1080", width: 1920, height: 1080 });
    const chip = screen.getByTestId("gui-toolbar-resolution");
    expect(chip).toHaveTextContent("1920×1080 ▾");
    expect(chip.getAttribute("aria-label")).toBe("Resolution 1920×1080, menu");
  });

  it("the locked prefix is 🔒 and the aria-label says locked", () => {
    setup({ geometry: "1920x1080", width: 1920, height: 1080, locked: true });
    const chip = screen.getByTestId("gui-toolbar-resolution");
    expect(chip).toHaveTextContent("🔒 1920×1080 ▾");
    expect(chip.getAttribute("aria-label")).toBe("Resolution 1920×1080, locked, menu");
  });

  it("a zeroed size falls back to presetLabel(geometry) without the (portrait) suffix", () => {
    setup({ geometry: "1080x1920", width: 0, height: 0 });
    expect(screen.getByTestId("gui-toolbar-resolution")).toHaveTextContent("1080×1920 ▾");
  });

  it("an empty geometry with zero sizes still renders the chip", () => {
    setup({ geometry: "", width: 0, height: 0 });
    expect(screen.getByTestId("gui-toolbar-resolution")).toBeTruthy();
  });

  it("below TOOLBAR_SHORT_LABEL_MAX_PX the label drops the ×H half; the aria-label keeps it", () => {
    setup({ geometry: "1920x1080", width: 1920, height: 1080, wrapperWidth: TOOLBAR_SHORT_LABEL_MAX_PX - 1 });
    const chip = screen.getByTestId("gui-toolbar-resolution");
    expect(chip).toHaveTextContent("1920 ▾");
    expect(chip.getAttribute("aria-label")).toBe("Resolution 1920×1080, menu");
    cleanup();
    setup({ geometry: "1920x1080", width: 1920, height: 1080, wrapperWidth: TOOLBAR_SHORT_LABEL_MAX_PX });
    expect(screen.getByTestId("gui-toolbar-resolution")).toHaveTextContent("1920×1080 ▾");
  });

  it("the chip is absent when no gui-res-* row exists", () => {
    setup({ input: { reachable: false } });
    expect(screen.queryByTestId("gui-toolbar-resolution")).toBeNull();
  });
});

describe("GuiToolbar — the resolution menu", () => {
  it("lists the palette's Resolution and Lock rows in order with stripped labels and verbatim descriptions", () => {
    setup({ coarsePointer: false, fullscreen: true, geometry: "1920x1080", width: 1920, height: 1080 });
    fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
    const menu = screen.getByTestId("gui-toolbar-menu");
    expect(menu.getAttribute("data-menu")).toBe("resolution");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "1280×720",
      "1600×900",
      "1920×1080✓",
      "2560×1440",
      "1080×1920 (portrait)",
      "Match this tile",
      "Auto (follow this tile) — today's behavior — the desktop follows the focused fine-pointer viewer",
      "Custom…",
      "Lock resolution — resolution is fixed (1920×1080) — pick Auto to follow the tile",
    ]);
    expect(items[8]).toHaveProperty("disabled", true);
  });

  it("under geometry=auto the Auto row is absent", () => {
    setup({ geometry: "auto" });
    fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
    expect(screen.getByTestId("gui-toolbar-menu").textContent).not.toContain(
      "Auto (follow this tile)",
    );
  });

  it("a coarse pointer has no lock row", () => {
    setup({ coarsePointer: true, geometry: "1920x1080", width: 1920, height: 1080 });
    fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
    expect(screen.getByTestId("gui-toolbar-menu").textContent).not.toContain("Lock resolution");
    expect(screen.getByTestId("gui-toolbar-menu").textContent).not.toContain("Unlock resolution");
  });

  it("a locked host renders every size row disabled with the `locked` description", () => {
    const { input } = setup({
      coarsePointer: false,
      fullscreen: true,
      geometry: "1920x1080",
      width: 1920,
      height: 1080,
      locked: true,
    });
    fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
    const items = within(screen.getByTestId("gui-toolbar-menu")).getAllByRole("menuitem");
    const sizeRows = items.filter((el) => (el.textContent ?? "").endsWith("— locked"));
    expect(sizeRows).toHaveLength(8);
    for (const row of sizeRows) expect(row).toHaveProperty("disabled", true);
    fireEvent.click(items[0]);
    expect(input.onResize).not.toHaveBeenCalled();
  });

  it("picking a size fires the row immediately and closes the menu", () => {
    const { input } = setup({ geometry: "1920x1080", width: 1920, height: 1080 });
    fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
    fireEvent.click(
      within(screen.getByTestId("gui-toolbar-menu"))
        .getAllByRole("menuitem")
        .find((el) => el.textContent === "1280×720")!,
    );
    expect(input.onResize).toHaveBeenCalledWith("1280x720");
    expect(screen.queryByTestId("gui-toolbar-menu")).toBeNull();
  });
});

describe("GuiToolbar — overflow by wrapper width", () => {
  const primaryLabels = [
    "Resolution auto, menu",
    "Enter fullscreen",
    "Zoom out",
    "Zoom to fit",
    "Zoom in",
    "Pointer mode",
    "Toggle key bar",
    "More actions",
  ];

  it("at 375 and 559 only the primary set plus ⋯ render; ⌖ is glyph-only", () => {
    for (const width of [375, TOOLBAR_OVERFLOW_MIN_PX - 1]) {
      setup({ wrapperWidth: width });
      expect(chipLabels()).toEqual(primaryLabels);
      expect(screen.getByLabelText("Pointer mode")).toHaveTextContent("⌖");
      cleanup();
    }
  });

  it("at 560 and 1280 everything is inline and ⋯ is absent", () => {
    for (const width of [TOOLBAR_OVERFLOW_MIN_PX, 1280]) {
      setup({ wrapperWidth: width });
      expect(screen.queryByTestId("gui-toolbar-overflow")).toBeNull();
      expect(screen.getByLabelText("Quality")).toBeTruthy();
      expect(screen.getByLabelText("Toggle stats")).toBeTruthy();
      expect(screen.getByLabelText("Pointer mode")).toHaveTextContent("⌖ Trackpad");
      cleanup();
    }
  });

  it("the ⋯ menu carries the folded rows in order", () => {
    setup({ wrapperWidth: 375 });
    fireEvent.click(screen.getByTestId("gui-toolbar-overflow"));
    const menu = screen.getByTestId("gui-toolbar-menu");
    expect(menu.getAttribute("data-menu")).toBe("overflow");
    expect(within(menu).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Quality → Balanced",
      "Paste clipboard",
      "Send key…",
      "Open terminal",
      "Open browser",
      "Show stats",
    ]);
  });

  it("the ⋯ menu folds Reconnect in while disconnected", () => {
    setup({ wrapperWidth: 375, connected: false });
    fireEvent.click(screen.getByTestId("gui-toolbar-overflow"));
    expect(within(screen.getByTestId("gui-toolbar-menu")).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Quality → Balanced",
      "Open terminal",
      "Open browser",
      "Show stats",
      "Reconnect",
    ]);
  });
});

describe("GuiToolbar — the by-id mirror (identity)", () => {
  it("every chip fires the SAME onSelect function object as its palette row", () => {
    const { actions } = setup({ geometry: "1920x1080", width: 1920, height: 1080 });
    const cases: [string, string][] = [
      ["gui-zoom-out", "Zoom out"],
      ["gui-zoom-fit", "Zoom to fit"],
      ["gui-zoom-in", "Zoom in"],
      ["gui-quality-smooth", "Quality"],
      ["gui-pointer-touch", "Pointer mode"],
      ["gui-keybar-hide", "Toggle key bar"],
      ["gui-paste", "Paste clipboard"],
      ["gui-send-key", "Send key…"],
      ["gui-open-terminal", "Open terminal"],
      ["gui-open-browser", "Open browser"],
      ["gui-stats-show", "Toggle stats"],
      ["gui-fullscreen", "Enter fullscreen"],
    ];
    for (const [id, label] of cases) {
      const spy = spyRow(actions, id);
      fireEvent.click(screen.getByLabelText(label));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith();
    }
  });

  it("the reconnect chip fires gui-reconnect", () => {
    const { actions } = setup({ connected: false });
    const spy = spyRow(actions, "gui-reconnect");
    fireEvent.click(screen.getByLabelText("Reconnect"));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("every resolution menu row fires its own palette row's onSelect object", () => {
    const { actions } = setup({ geometry: "1920x1080", width: 1920, height: 1080 });
    const expected: [string, string][] = [
      ["gui-res-1280x720", "1280×720"],
      ["gui-res-1600x900", "1600×900"],
      ["gui-res-1920x1080", "1920×1080✓"],
      ["gui-res-2560x1440", "2560×1440"],
      ["gui-res-1080x1920", "1080×1920 (portrait)"],
      ["gui-res-match", "Match this tile"],
      [
        "gui-res-auto",
        "Auto (follow this tile) — today's behavior — the desktop follows the focused fine-pointer viewer",
      ],
      ["gui-res-custom", "Custom…"],
    ];
    for (const [id, text] of expected) {
      // Spy before opening: the menu rows capture the row's onSelect at render.
      const spy = spyRow(actions, id);
      fireEvent.click(screen.getByTestId("gui-toolbar-resolution"));
      const item = within(screen.getByTestId("gui-toolbar-menu"))
        .getAllByRole("menuitem")
        .find((el) => el.textContent === text);
      if (!item) throw new Error(`menu row "${text}" missing`);
      fireEvent.click(item);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith();
      expect(screen.queryByTestId("gui-toolbar-menu")).toBeNull();
    }
  });

  it("every ⋯ menu row fires its own palette row's onSelect object", () => {
    const { actions } = setup({ wrapperWidth: TOOLBAR_OVERFLOW_MIN_PX - 1 });
    const expected: [string, string][] = [
      ["gui-quality-smooth", "Quality → Balanced"],
      ["gui-paste", "Paste clipboard"],
      ["gui-send-key", "Send key…"],
      ["gui-open-terminal", "Open terminal"],
      ["gui-open-browser", "Open browser"],
      ["gui-stats-show", "Show stats"],
    ];
    for (const [id, text] of expected) {
      // Spy before opening: the menu rows capture the row's onSelect at render.
      const spy = spyRow(actions, id);
      fireEvent.click(screen.getByTestId("gui-toolbar-overflow"));
      const item = within(screen.getByTestId("gui-toolbar-menu"))
        .getAllByRole("menuitem")
        .find((el) => el.textContent === text);
      if (!item) throw new Error(`menu row "${text}" missing`);
      fireEvent.click(item);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith();
      expect(screen.queryByTestId("gui-toolbar-menu")).toBeNull();
    }
  });
});
