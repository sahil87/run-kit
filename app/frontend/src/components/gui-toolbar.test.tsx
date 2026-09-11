import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { GuiToolbar, TOOLBAR_HIDE_MS } from "./gui-toolbar";
import { buildGuiActions, type GuiPaletteInput } from "@/lib/palette/gui";
import type { GuiPointerMode, GuiZoom } from "@/lib/gui-posture";

afterEach(cleanup);

interface ToolbarProps {
  zoom?: GuiZoom;
  pointerMode?: GuiPointerMode;
  coarsePointer?: boolean;
  fullscreen?: boolean;
  keyBarVisible?: boolean;
  revealSignal?: number;
  onZoom?: (z: GuiZoom) => void;
  onPointerMode?: (m: GuiPointerMode) => void;
  onKeyBarVisibleChange?: (visible: boolean) => void;
  onFullscreen?: () => void;
  quality?: { label: string; onCycle: () => void };
  stats?: { onToggle: () => void };
}

function renderToolbar(props: ToolbarProps = {}) {
  return render(
    <GuiToolbar
      zoom={props.zoom ?? "fit"}
      pointerMode={props.pointerMode ?? "trackpad"}
      coarsePointer={props.coarsePointer ?? true}
      fullscreen={props.fullscreen ?? false}
      keyBarVisible={props.keyBarVisible ?? true}
      revealSignal={props.revealSignal ?? 0}
      onZoom={props.onZoom ?? (() => {})}
      onPointerMode={props.onPointerMode ?? (() => {})}
      onKeyBarVisibleChange={props.onKeyBarVisibleChange ?? (() => {})}
      onFullscreen={props.onFullscreen ?? (() => {})}
      quality={props.quality}
      stats={props.stats}
    />,
  );
}

describe("GuiToolbar — show/hide machine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows on mount, hides TOOLBAR_HIDE_MS later", () => {
    renderToolbar();
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("a revealSignal bump re-shows the pill and restarts the timer", () => {
    const { rerender } = render(
      <GuiToolbar
        zoom="fit"
        pointerMode="trackpad"
        coarsePointer
        fullscreen={false}
        keyBarVisible
        revealSignal={0}
        onZoom={() => {}}
        onPointerMode={() => {}}
        onKeyBarVisibleChange={() => {}}
        onFullscreen={() => {}}
      />,
    );
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
    rerender(
      <GuiToolbar
        zoom="fit"
        pointerMode="trackpad"
        coarsePointer
        fullscreen={false}
        keyBarVisible
        revealSignal={1}
        onZoom={() => {}}
        onPointerMode={() => {}}
        onKeyBarVisibleChange={() => {}}
        onFullscreen={() => {}}
      />,
    );
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
  });

  it("a chip interaction restarts the hide timer", () => {
    const onZoom = vi.fn();
    renderToolbar({ zoom: 100, onZoom });
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 100));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    act(() => vi.advanceTimersByTime(TOOLBAR_HIDE_MS - 1));
    expect(screen.getByTestId("gui-toolbar")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("gui-toolbar")).toBeNull();
    expect(onZoom).toHaveBeenCalledWith(125);
  });
});

describe("GuiToolbar — gating", () => {
  it("disables Zoom in at 200 and Zoom out / Zoom to fit at fit", () => {
    renderToolbar({ zoom: 200 });
    expect(screen.getByLabelText("Zoom in")).toHaveProperty("disabled", true);
    cleanup();
    renderToolbar({ zoom: "fit" });
    expect(screen.getByLabelText("Zoom out")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Zoom to fit")).toHaveProperty("disabled", true);
  });

  it("omits the pointer-mode and key-bar chips on a fine pointer", () => {
    renderToolbar({ coarsePointer: false });
    expect(screen.queryByLabelText("Pointer mode")).toBeNull();
    expect(screen.queryByLabelText("Toggle key bar")).toBeNull();
    expect(screen.getByLabelText("Zoom in")).toBeTruthy();
  });

  it("omits the fullscreen chip when not fullscreen", () => {
    renderToolbar({ fullscreen: false });
    expect(screen.queryByLabelText("Exit fullscreen")).toBeNull();
    cleanup();
    renderToolbar({ fullscreen: true });
    expect(screen.getByLabelText("Exit fullscreen")).toBeTruthy();
  });

  it("omits the quality and stats chips without their slots and never throws", () => {
    expect(() => renderToolbar()).not.toThrow();
    expect(screen.queryByLabelText("Quality")).toBeNull();
    expect(screen.queryByLabelText("Toggle stats")).toBeNull();
    cleanup();
    const onCycle = vi.fn();
    const onToggle = vi.fn();
    renderToolbar({ quality: { label: "Balanced", onCycle }, stats: { onToggle } });
    fireEvent.click(screen.getByLabelText("Quality"));
    fireEvent.click(screen.getByLabelText("Toggle stats"));
    expect(onCycle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("GuiToolbar — shared callbacks with the palette rows", () => {
  function paletteInput(shared: {
    onZoom: (z: GuiZoom) => void;
    onPointerMode: (m: GuiPointerMode) => void;
    onKeyBarVisibleChange: (v: boolean) => void;
    onFullscreen: () => void;
  }): GuiPaletteInput {
    return {
      enabled: true,
      reachable: true,
      backend: "Xtigervnc",
      tileOpen: true,
      connected: true,
      coarsePointer: true,
      zoom: "fit",
      pointerMode: "trackpad",
      resizeLocked: false,
      geometry: "auto",
      supervisorAvailable: true,
      keyBarVisible: true,
      quality: "balanced",
      statsVisible: false,
      onQuality: vi.fn(),
      onStatsVisible: vi.fn(),
      onTurnOn: vi.fn(),
      onTurnOff: vi.fn(),
      loadDesktopRows: vi.fn().mockResolvedValue([]),
      onLaunch: vi.fn(),
      onResize: vi.fn(),
      onResizeCustom: vi.fn(),
      onMatchTile: vi.fn(),
      onPaste: vi.fn(),
      onLockChange: vi.fn(),
      onOpenLogs: vi.fn(),
      onReconnect: vi.fn(),
      onHidpiChange: vi.fn(),
      onSendKey: vi.fn(),
      hidpi: false,
      ...shared,
    };
  }

  const row = (input: GuiPaletteInput, id: string) => {
    const action = buildGuiActions(input).find((a) => a.id === id);
    if (!action) throw new Error(`palette row ${id} missing`);
    return action;
  };

  it("the + chip and GUI: Zoom in call the identical onZoom with identical arguments", () => {
    const onZoom = vi.fn();
    renderToolbar({ zoom: "fit", onZoom });
    fireEvent.click(screen.getByLabelText("Zoom in"));
    row(paletteInput({ onZoom, onPointerMode: vi.fn(), onKeyBarVisibleChange: vi.fn(), onFullscreen: vi.fn() }), "gui-zoom-in").onSelect();
    expect(onZoom.mock.calls).toEqual([[100], [100]]);
  });

  it("the − chip and GUI: Zoom out share the callback", () => {
    const onZoom = vi.fn();
    renderToolbar({ zoom: 150, onZoom });
    fireEvent.click(screen.getByLabelText("Zoom out"));
    const input = paletteInput({ onZoom, onPointerMode: vi.fn(), onKeyBarVisibleChange: vi.fn(), onFullscreen: vi.fn() });
    input.zoom = 150;
    row(input, "gui-zoom-out").onSelect();
    expect(onZoom.mock.calls).toEqual([[125], [125]]);
  });

  it("the fit chip and GUI: Zoom to fit share the callback", () => {
    const onZoom = vi.fn();
    renderToolbar({ zoom: 150, onZoom });
    fireEvent.click(screen.getByLabelText("Zoom to fit"));
    const input = paletteInput({ onZoom, onPointerMode: vi.fn(), onKeyBarVisibleChange: vi.fn(), onFullscreen: vi.fn() });
    input.zoom = 150;
    row(input, "gui-zoom-fit").onSelect();
    expect(onZoom.mock.calls).toEqual([["fit"], ["fit"]]);
  });

  it("the ⌖ chip and the pointer-mode row share the callback and destination", () => {
    const onPointerMode = vi.fn();
    renderToolbar({ pointerMode: "trackpad", onPointerMode });
    fireEvent.click(screen.getByLabelText("Pointer mode"));
    row(paletteInput({ onZoom: vi.fn(), onPointerMode, onKeyBarVisibleChange: vi.fn(), onFullscreen: vi.fn() }), "gui-pointer-touch").onSelect();
    expect(onPointerMode.mock.calls).toEqual([["touch"], ["touch"]]);
  });

  it("the ⌨ chip and GUI: Hide key bar share the callback", () => {
    const onKeyBarVisibleChange = vi.fn();
    renderToolbar({ keyBarVisible: true, onKeyBarVisibleChange });
    fireEvent.click(screen.getByLabelText("Toggle key bar"));
    row(paletteInput({ onZoom: vi.fn(), onPointerMode: vi.fn(), onKeyBarVisibleChange, onFullscreen: vi.fn() }), "gui-keybar-hide").onSelect();
    expect(onKeyBarVisibleChange.mock.calls).toEqual([[false], [false]]);
  });

  it("the ⤢ chip and GUI: Fullscreen share the toggle verb", () => {
    const onFullscreen = vi.fn();
    renderToolbar({ fullscreen: true, onFullscreen });
    fireEvent.click(screen.getByLabelText("Exit fullscreen"));
    row(paletteInput({ onZoom: vi.fn(), onPointerMode: vi.fn(), onKeyBarVisibleChange: vi.fn(), onFullscreen }), "gui-fullscreen").onSelect();
    expect(onFullscreen).toHaveBeenCalledTimes(2);
  });
});
