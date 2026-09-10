import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act, screen } from "@testing-library/react";
import type { GuiSignal } from "@/contexts/session-context";
import type { GuiSurfaceCommands } from "./gui-surface";
import GuiSurface from "./gui-surface";
import RFB from "@novnc/novnc";
import { fetchGuiStatus } from "@/api/client";
import { copyToClipboard } from "@/lib/clipboard";

// Fake RFB: settable plain props, an event registry tests can fire, and vi.fn
// seams for the verbs. `emit` delivers to every registered listener with a
// `{detail}` event envelope, mirroring noVNC's CustomEvent payloads. The class
// lives INSIDE the factory (vi.mock hoists); tests reach it via the default
// export below.
vi.mock("@novnc/novnc", () => {
  class FakeRFB {
    static instances: FakeRFB[] = [];
    scaleViewport = false;
    clipViewport = false;
    dragViewport = false;
    resizeSession = false;
    qualityLevel = 6;
    compressionLevel = 2;
    showDotCursor = false;
    viewOnly = false;
    focusOnClick = false;
    background = "white";
    disconnect = vi.fn();
    sendCredentials = vi.fn();
    clipboardPasteFrom = vi.fn();
    focus = vi.fn();
    private listeners = new Map<string, Set<(e: { detail?: unknown }) => void>>();
    constructor(
      public target: HTMLElement,
      public url: string,
      public options?: unknown,
    ) {
      FakeRFB.instances.push(this);
    }
    addEventListener(type: string, fn: (e: { detail?: unknown }) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (e: { detail?: unknown }) => void) {
      this.listeners.get(type)?.delete(fn);
    }
    emit(type: string, detail?: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn({ detail });
    }
  }
  return { default: FakeRFB };
});

vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  fetchGuiStatus: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

type FakeRFBInstance = {
  url: string;
  scaleViewport: boolean;
  clipViewport: boolean;
  dragViewport: boolean;
  resizeSession: boolean;
  qualityLevel: number;
  compressionLevel: number;
  showDotCursor: boolean;
  viewOnly: boolean;
  focusOnClick: boolean;
  background: string;
  disconnect: ReturnType<typeof vi.fn>;
  sendCredentials: ReturnType<typeof vi.fn>;
  clipboardPasteFrom: ReturnType<typeof vi.fn>;
  emit(type: string, detail?: unknown): void;
};

const FakeRFBClass = RFB as unknown as {
  instances: FakeRFBInstance[];
  new (...args: unknown[]): FakeRFBInstance;
};

const GUI_ON: GuiSignal = {
  id: "host",
  enabled: true,
  backend: "Xtigervnc",
  reachable: true,
  display: ":10",
  width: 1920,
  height: 1080,
  viewers: 1,
  wm: "icewm-session",
};

const GUI_OFF: GuiSignal = { ...GUI_ON, enabled: false, reachable: false };
const GUI_UNREACHABLE: GuiSignal = { ...GUI_ON, reachable: false };
const GUI_BARE: GuiSignal = { ...GUI_ON, wm: "" };
const WM_HINT = "sudo apt install --no-install-recommends icewm";

function mockBareStatus(hint: string | undefined = WM_HINT) {
  vi.mocked(fetchGuiStatus).mockResolvedValue({
    wm: "",
    ...(hint === undefined ? {} : { wm_hint: hint }),
  } as Awaited<ReturnType<typeof fetchGuiStatus>>);
}

function renderGui(overrides: Partial<Parameters<typeof GuiSurface>[0]> = {}) {
  const props = {
    gui: GUI_ON,
    visible: true,
    focused: true,
    coarsePointer: false,
    viewMode: "fit" as const,
    resizeLocked: false,
    onConnectionChange: vi.fn(),
    onRestart: vi.fn().mockResolvedValue({ ok: true }),
    onOpenLogs: vi.fn(),
    ...overrides,
  };
  return { ...render(<GuiSurface {...props} />), props };
}

const latestRfb = () => FakeRFBClass.instances[FakeRFBClass.instances.length - 1];

beforeEach(() => {
  FakeRFBClass.instances = [];
  vi.mocked(fetchGuiStatus).mockReset();
  vi.mocked(copyToClipboard).mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GuiSurface — content states", () => {
  it("enabled+reachable mounts the canvas host with an absolute ws:// URL", () => {
    renderGui();
    expect(screen.getByTestId("gui-surface-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("gui-surface-empty")).toBeNull();
    expect(latestRfb().url).toBe(`ws://${window.location.host}/ws/gui/host`);
    expect(latestRfb().url.startsWith("ws://")).toBe(true);
  });

  it("enabled+unreachable renders the empty state with the fetched reason, and opens no WebSocket", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue({
      reason: "no VNC backend: sudo apt install tigervnc-standalone-server openbox",
    } as Awaited<ReturnType<typeof fetchGuiStatus>>);
    renderGui({ gui: GUI_UNREACHABLE });
    expect(screen.getByTestId("gui-surface-empty")).toHaveTextContent(
      "GUI is on but not running",
    );
    expect(FakeRFBClass.instances).toHaveLength(0);
    expect(
      await screen.findByText(
        "no VNC backend: sudo apt install tigervnc-standalone-server openbox",
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("a failed reason GET leaves the empty state without a reason line", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("boom"));
    renderGui({ gui: GUI_UNREACHABLE });
    expect(screen.getByTestId("gui-surface-empty")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTestId("gui-surface-reason")).toBeNull();
  });

  it("the reason GET fires once per unreachable transition, not per render", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue({ reason: "r" } as Awaited<
      ReturnType<typeof fetchGuiStatus>
    >);
    const { rerender } = renderGui({ gui: GUI_UNREACHABLE });
    await act(async () => {});
    rerender(
      <GuiSurface
        gui={GUI_UNREACHABLE}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("a 409 from Restart supervisor renders 'gui turned off'", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue({ reason: "" } as Awaited<
      ReturnType<typeof fetchGuiStatus>
    >);
    const { props } = renderGui({
      gui: GUI_UNREACHABLE,
      onRestart: vi.fn().mockResolvedValue({ ok: false, disabled: true }),
    });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Restart supervisor" }));
    await act(async () => {});
    expect(props.onRestart).toHaveBeenCalledOnce();
    expect(screen.getByTestId("gui-surface-empty")).toHaveTextContent("gui turned off");
  });

  it("Open supervisor logs routes to the callback", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue({ reason: "" } as Awaited<
      ReturnType<typeof fetchGuiStatus>
    >);
    const { props } = renderGui({ gui: GUI_UNREACHABLE });
    fireEvent.click(screen.getByRole("button", { name: "Open supervisor logs" }));
    expect(props.onOpenLogs).toHaveBeenCalledOnce();
  });

  it("a disabled signal renders nothing (degradation owns that state)", () => {
    renderGui({ gui: GUI_OFF });
    expect(screen.queryByTestId("gui-surface-canvas")).toBeNull();
    expect(screen.queryByTestId("gui-surface-empty")).toBeNull();
  });
});

describe("GuiSurface — the bare-WM strip", () => {
  it("WM present mounts the canvas host and no strip (and no status GET)", async () => {
    renderGui();
    expect(screen.getByTestId("gui-surface-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("gui-wm-strip")).toBeNull();
    await act(async () => {});
    expect(vi.mocked(fetchGuiStatus)).not.toHaveBeenCalled();
  });

  it("bare renders the strip with the exact text and the fetched install line, once per transition", async () => {
    mockBareStatus();
    const { rerender } = renderGui({ gui: GUI_BARE });
    const strip = await screen.findByTestId("gui-wm-strip");
    await act(async () => {});
    expect(strip).toHaveTextContent(
      "No window manager on the GUI host — sudo apt install --no-install-recommends icewm · then Restart supervisor",
    );
    expect(screen.getByRole("button", { name: "Copy install line" })).toHaveTextContent("Copy");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    rerender(
      <GuiSurface
        gui={GUI_BARE}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("the strip is the first child of the canvas wrapper, before the noVNC host div", async () => {
    mockBareStatus();
    renderGui({ gui: GUI_BARE });
    const strip = await screen.findByTestId("gui-wm-strip");
    const canvas = screen.getByTestId("gui-surface-canvas");
    expect(canvas.firstElementChild).toBe(strip);
    expect(strip.nextElementSibling).toHaveClass("flex-1", "min-h-0");
  });

  it("a failed status GET leaves the strip without the install segment and without Copy", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("boom"));
    renderGui({ gui: GUI_BARE });
    const strip = await screen.findByTestId("gui-wm-strip");
    await act(async () => {});
    expect(strip).toHaveTextContent("No window manager on the GUI host · then Restart supervisor");
    expect(strip).not.toHaveTextContent("apt install");
    expect(screen.queryByRole("button", { name: "Copy install line" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("the screen-sharing backend never renders the strip, even bare", async () => {
    mockBareStatus();
    renderGui({ gui: { ...GUI_BARE, backend: "screen-sharing" } });
    expect(screen.getByTestId("gui-surface-canvas")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByTestId("gui-wm-strip")).toBeNull();
    expect(vi.mocked(fetchGuiStatus)).not.toHaveBeenCalled();
  });

  it("Copy copies exactly the install line and reads Copied for 1.5s", async () => {
    vi.useFakeTimers();
    mockBareStatus();
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    renderGui({ gui: GUI_BARE });
    expect(screen.getByTestId("gui-wm-strip")).toBeInTheDocument();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Copy install line" }));
    await act(async () => {});
    expect(copyToClipboard).toHaveBeenCalledOnce();
    expect(copyToClipboard).toHaveBeenCalledWith(WM_HINT);
    expect(screen.getByRole("button", { name: "Copy install line" })).toHaveTextContent("Copied");
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.getByRole("button", { name: "Copy install line" })).toHaveTextContent("Copy");
  });

  it("a failed copy leaves the strip unchanged", async () => {
    mockBareStatus();
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    renderGui({ gui: GUI_BARE });
    await screen.findByTestId("gui-wm-strip");
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Copy install line" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Copy install line" })).toHaveTextContent("Copy");
  });

  it("Restart supervisor in the strip calls onRestart", async () => {
    mockBareStatus();
    const { props } = renderGui({ gui: GUI_BARE });
    await screen.findByTestId("gui-wm-strip");
    fireEvent.click(screen.getByRole("button", { name: "Restart supervisor" }));
    expect(props.onRestart).toHaveBeenCalledOnce();
  });

  it("× hides the strip and persists the dismissal; a remount honors it", async () => {
    mockBareStatus();
    const first = renderGui({ gui: GUI_BARE });
    await screen.findByTestId("gui-wm-strip");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("gui-wm-strip")).toBeNull();
    expect(localStorage.getItem("runkit-gui-wm-strip-dismissed")).toBe("1");
    first.unmount();

    renderGui({ gui: GUI_BARE });
    await act(async () => {});
    expect(screen.getByTestId("gui-surface-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("gui-wm-strip")).toBeNull();
  });

  it("a wm flip to non-empty removes the dismissal key (a later bare state shows the strip again)", async () => {
    localStorage.setItem("runkit-gui-wm-strip-dismissed", "1");
    mockBareStatus();
    const { rerender } = renderGui({ gui: GUI_BARE });
    expect(screen.queryByTestId("gui-wm-strip")).toBeNull();

    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    await act(async () => {});
    expect(localStorage.getItem("runkit-gui-wm-strip-dismissed")).toBeNull();

    rerender(
      <GuiSurface
        gui={GUI_BARE}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("gui-wm-strip")).toBeInTheDocument();
  });
});

describe("GuiSurface — RFB prop mapping", () => {
  it("resizeSession = !coarsePointer && focused && !resizeLocked, recomputed on prop change", () => {
    const { rerender } = renderGui();
    expect(latestRfb().resizeSession).toBe(true);

    const base = {
      gui: GUI_ON,
      visible: true,
      onConnectionChange: vi.fn(),
      onRestart: vi.fn(),
      onOpenLogs: vi.fn(),
    };
    rerender(<GuiSurface {...base} focused={true} coarsePointer={false} resizeLocked={true} viewMode="fit" />);
    expect(latestRfb().resizeSession).toBe(false);
    rerender(<GuiSurface {...base} focused={false} coarsePointer={false} resizeLocked={false} viewMode="fit" />);
    expect(latestRfb().resizeSession).toBe(false);
    rerender(<GuiSurface {...base} focused={true} coarsePointer={true} resizeLocked={false} viewMode="fit" />);
    expect(latestRfb().resizeSession).toBe(false);
  });

  it("view modes map to scaleViewport/clipViewport/dragViewport", () => {
    const { rerender } = renderGui({ viewMode: "fit" });
    expect(latestRfb().scaleViewport).toBe(true);
    expect(latestRfb().clipViewport).toBe(false);
    expect(latestRfb().dragViewport).toBe(false);

    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="1:1"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    expect(latestRfb().scaleViewport).toBe(false);
    expect(latestRfb().clipViewport).toBe(true);
    expect(latestRfb().dragViewport).toBe(true);
  });

  it("quality follows the pointer class; coarse never resizes", () => {
    const { rerender } = renderGui({ coarsePointer: false });
    expect(latestRfb().qualityLevel).toBe(6);
    expect(latestRfb().compressionLevel).toBe(2);

    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={true}
        focused={true}
        coarsePointer={true}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    expect(latestRfb().qualityLevel).toBe(4);
    expect(latestRfb().compressionLevel).toBe(6);
    expect(latestRfb().resizeSession).toBe(false);
  });

  it("sets showDotCursor/focusOnClick/background, and viewOnly on screen-sharing", () => {
    renderGui({ gui: { ...GUI_ON, backend: "screen-sharing" } });
    const rfb = latestRfb();
    expect(rfb.showDotCursor).toBe(true);
    expect(rfb.focusOnClick).toBe(true);
    expect(rfb.background).toBe("");
    expect(rfb.viewOnly).toBe(true);
  });

  it("viewOnly stays false on the Xvnc backend", () => {
    renderGui();
    expect(latestRfb().viewOnly).toBe(false);
  });
});

describe("GuiSurface — connection lifecycle", () => {
  it("reports connect/disconnect through onConnectionChange (the dot seam)", () => {
    const { props } = renderGui();
    expect(props.onConnectionChange).not.toHaveBeenCalled();
    act(() => latestRfb().emit("connect"));
    expect(props.onConnectionChange).toHaveBeenLastCalledWith(true);
    act(() => latestRfb().emit("disconnect"));
    expect(props.onConnectionChange).toHaveBeenLastCalledWith(false);
  });

  it("a disconnect while reachable overlays 'disconnected — reconnecting…' and re-dials with 1s→2s→4s→8s backoff", () => {
    vi.useFakeTimers();
    renderGui();
    const first = latestRfb();
    act(() => first.emit("disconnect"));
    expect(screen.getByTestId("gui-surface-reconnecting")).toHaveTextContent(
      "disconnected — reconnecting…",
    );

    act(() => void vi.advanceTimersByTime(999));
    expect(FakeRFBClass.instances).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeRFBClass.instances).toHaveLength(2);

    const second = latestRfb();
    act(() => second.emit("disconnect"));
    act(() => void vi.advanceTimersByTime(1999));
    expect(FakeRFBClass.instances).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeRFBClass.instances).toHaveLength(3);

    // Connect resets the backoff: the next drop waits 1s again.
    act(() => latestRfb().emit("connect"));
    expect(screen.queryByTestId("gui-surface-reconnecting")).toBeNull();
    act(() => latestRfb().emit("disconnect"));
    act(() => void vi.advanceTimersByTime(1000));
    expect(FakeRFBClass.instances).toHaveLength(4);
  });

  it("caps the backoff at 8s", () => {
    vi.useFakeTimers();
    renderGui();
    const drops = [1000, 2000, 4000, 8000];
    for (const wait of drops) {
      act(() => latestRfb().emit("disconnect"));
      act(() => void vi.advanceTimersByTime(wait));
    }
    const count = FakeRFBClass.instances.length;
    act(() => latestRfb().emit("disconnect"));
    act(() => void vi.advanceTimersByTime(7999));
    expect(FakeRFBClass.instances).toHaveLength(count);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeRFBClass.instances).toHaveLength(count + 1);
  });

  it("reachable flipping false mid-backoff clears the timer and renders the empty state", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchGuiStatus).mockResolvedValue({ reason: "" } as Awaited<
      ReturnType<typeof fetchGuiStatus>
    >);
    const { rerender } = renderGui();
    act(() => latestRfb().emit("disconnect"));
    expect(screen.getByTestId("gui-surface-reconnecting")).toBeInTheDocument();

    rerender(
      <GuiSurface
        gui={GUI_UNREACHABLE}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    expect(screen.getByTestId("gui-surface-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("gui-surface-reconnecting")).toBeNull();
    const count = FakeRFBClass.instances.length;
    act(() => void vi.advanceTimersByTime(30_000));
    expect(FakeRFBClass.instances).toHaveLength(count);
    await act(async () => {});
  });

  it("disconnects after 15s not-visible and reconnects on the next visible true", () => {
    vi.useFakeTimers();
    const { rerender } = renderGui();
    const first = latestRfb();

    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={false}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    act(() => void vi.advanceTimersByTime(14_999));
    expect(first.disconnect).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(first.disconnect).toHaveBeenCalledOnce();

    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={true}
        focused={true}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    expect(FakeRFBClass.instances).toHaveLength(2);
  });

  it("a hidden document counts as not-visible for the 15s rule", () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      renderGui();
      const first = latestRfb();
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => void vi.advanceTimersByTime(15_000));
      expect(first.disconnect).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it("focus loss alone never disconnects (no timer without invisible)", () => {
    vi.useFakeTimers();
    const { rerender } = renderGui();
    rerender(
      <GuiSurface
        gui={GUI_ON}
        visible={true}
        focused={false}
        coarsePointer={false}
        viewMode="fit"
        resizeLocked={false}
        onConnectionChange={vi.fn()}
        onRestart={vi.fn()}
        onOpenLogs={vi.fn()}
      />,
    );
    act(() => void vi.advanceTimersByTime(60_000));
    expect(latestRfb().disconnect).not.toHaveBeenCalled();
    expect(FakeRFBClass.instances).toHaveLength(1);
  });

  it("unmount disconnects and clears every timer", () => {
    vi.useFakeTimers();
    const { unmount } = renderGui();
    const rfb = latestRfb();
    act(() => rfb.emit("disconnect")); // arms a backoff timer
    unmount();
    expect(rfb.disconnect).toHaveBeenCalled();
    const count = FakeRFBClass.instances.length;
    act(() => void vi.advanceTimersByTime(60_000));
    expect(FakeRFBClass.instances).toHaveLength(count);
  });
});

describe("GuiSurface — chord gate and interaction seam", () => {
  function canvasChild(): HTMLElement {
    const host = screen.getByTestId("gui-surface-canvas").firstElementChild;
    if (!(host instanceof HTMLElement)) throw new Error("no canvas host");
    return host;
  }

  it("a reclaim-matching chord never reaches the canvas subtree and is re-dispatched to the document", () => {
    const shouldReclaimChord = vi.fn().mockReturnValue(true);
    const innerSpy = vi.fn();
    const docSpy = vi.fn();
    renderGui({ shouldReclaimChord });
    const inner = canvasChild();
    inner.addEventListener("keydown", innerSpy);
    document.addEventListener("keydown", docSpy);
    try {
      fireEvent.keyDown(inner, { key: "4", code: "Digit4", metaKey: true });
      expect(innerSpy).not.toHaveBeenCalled();
      expect(docSpy).toHaveBeenCalledOnce();
      expect(shouldReclaimChord).toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", docSpy);
    }
  });

  it("a non-matching key reaches the canvas subtree untouched", () => {
    const shouldReclaimChord = vi.fn().mockReturnValue(false);
    const innerSpy = vi.fn();
    renderGui({ shouldReclaimChord });
    const inner = canvasChild();
    inner.addEventListener("keydown", innerSpy);
    fireEvent.keyDown(inner, { key: "a", code: "KeyA" });
    expect(innerSpy).toHaveBeenCalledOnce();
  });

  it("pointerdown and keydown on the canvas wrapper fire onInteract", () => {
    const onInteract = vi.fn();
    renderGui({ onInteract });
    fireEvent.pointerDown(screen.getByTestId("gui-surface-canvas"));
    expect(onInteract).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(canvasChild(), { key: "a", code: "KeyA" });
    expect(onInteract).toHaveBeenCalledTimes(2);
  });

  it("an RFB clipboard event writes to the browser clipboard best-effort", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderGui();
    act(() => latestRfb().emit("clipboard", { text: "from-guest" }));
    expect(writeText).toHaveBeenCalledWith("from-guest");
  });
});

describe("GuiSurface — macOS credentials prompt", () => {
  const GUI_MAC: GuiSignal = { ...GUI_ON, backend: "screen-sharing" };

  it("credentialsrequired renders the password field; Enter submits via sendCredentials and stores nothing", () => {
    renderGui({ gui: GUI_MAC });
    act(() => latestRfb().emit("credentialsrequired"));
    const overlay = screen.getByTestId("gui-surface-credentials");
    expect(overlay).toHaveTextContent("Screen Sharing password");
    const input = screen.getByLabelText("Screen Sharing password");
    fireEvent.change(input, { target: { value: "s3cret" } });
    fireEvent.submit(overlay.querySelector("form")!);
    expect(latestRfb().sendCredentials).toHaveBeenCalledWith({ password: "s3cret" });
    expect(screen.queryByTestId("gui-surface-credentials")).toBeNull();
    expect(Object.keys(localStorage).join(",")).not.toMatch(/password/i);
    expect(Object.keys(sessionStorage).join(",")).not.toMatch(/password/i);
  });

  it("the Connect button submits like Enter", () => {
    renderGui({ gui: GUI_MAC });
    act(() => latestRfb().emit("credentialsrequired"));
    fireEvent.change(screen.getByLabelText("Screen Sharing password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(latestRfb().sendCredentials).toHaveBeenCalledWith({ password: "pw" });
  });

  it("Escape disconnects into the empty state with the password-required reason", () => {
    renderGui({ gui: GUI_MAC });
    const rfb = latestRfb();
    act(() => rfb.emit("credentialsrequired"));
    fireEvent.keyDown(screen.getByLabelText("Screen Sharing password"), { key: "Escape" });
    expect(rfb.disconnect).toHaveBeenCalled();
    expect(screen.getByTestId("gui-surface-empty")).toHaveTextContent(
      "Screen Sharing password required",
    );
  });

  it("a securityfailure after submit re-shows the field with the wrong-password note", () => {
    renderGui({ gui: GUI_MAC });
    act(() => latestRfb().emit("credentialsrequired"));
    fireEvent.change(screen.getByLabelText("Screen Sharing password"), {
      target: { value: "bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    act(() => latestRfb().emit("securityfailure", { status: 1, reason: "auth failed" }));
    expect(screen.getByTestId("gui-surface-credentials")).toHaveTextContent(
      "Wrong password — try again",
    );
  });
});

describe("GuiSurface — palette command seams", () => {
  it("paste forwards to the live RFB; reconnect re-dials immediately", () => {
    vi.useFakeTimers();
    const commandsRef: { current: GuiSurfaceCommands | null } = { current: null };
    renderGui({ commandsRef });
    expect(commandsRef.current).not.toBeNull();

    act(() => commandsRef.current!.paste("clip"));
    expect(latestRfb().clipboardPasteFrom).toHaveBeenCalledWith("clip");

    act(() => latestRfb().emit("disconnect"));
    act(() => commandsRef.current!.reconnect());
    expect(FakeRFBClass.instances).toHaveLength(2);
  });
});
