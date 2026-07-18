import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { FocusedTerminalProvider } from "@/contexts/focused-terminal-context";
import { ChromeProvider, useChrome } from "@/contexts/chrome-context";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { TerminalClient } from "./terminal-client";
import type { OpenStreamOpts, RelayStream } from "@/lib/relay-mux";

// ---------------------------------------------------------------------------
// RelayMux mock — the terminals-mux transport (change 260717-803u-relay-mux).
// TerminalClient no longer opens a raw WebSocket; it calls relayMux.openStream()
// and drives the terminal through the returned stream handle
// ({send,resize,close,onData,onOpened,onClosed}). This mock captures every
// opened stream so tests can drive inbound data / opened / closed by hand and
// assert the outbound send/resize/close ops.
//
// Inbound data is now BINARY (a Uint8Array): the relay's byte stream, demuxed by
// the mux. String test payloads are encoded to bytes by emitData(). Socket-level
// reconnect is owned by RelayMux — a transient drop re-opens the stream
// transparently, surfaced to the client as a fresh onOpened() (NOT an onClosed);
// only a STREAM-level close (4004/4001/1000) fires onClosed.
// ---------------------------------------------------------------------------

class MockStream implements RelayStream {
  static instances: MockStream[] = [];
  opts: OpenStreamOpts;
  dataCb: ((d: Uint8Array) => void) | null = null;
  openedCb: (() => void) | null = null;
  closedCb: ((code: number, reason: string) => void) | null = null;
  send = vi.fn();
  resize = vi.fn();
  setWindowIdSpy = vi.fn();
  closeSpy = vi.fn();
  closed = false;

  constructor(opts: OpenStreamOpts) {
    this.opts = opts;
    MockStream.instances.push(this);
  }
  setWindowId = (windowId: string) => {
    this.opts = { ...this.opts, windowId };
    this.setWindowIdSpy(windowId);
  };
  close = () => {
    this.closed = true;
    this.closeSpy();
  };
  onData = (cb: (d: Uint8Array) => void) => {
    this.dataCb = cb;
  };
  onOpened = (cb: () => void) => {
    this.openedCb = cb;
  };
  onClosed = (cb: (code: number, reason: string) => void) => {
    this.closedCb = cb;
  };

  // --- test drivers ---
  /** Fire the stream-opened callback (initial open or a transparent re-open). */
  emitOpened() {
    this.openedCb?.();
  }
  /** Fire an inbound data frame. Strings are UTF-8 encoded to bytes. */
  emitData(data: string | Uint8Array) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.dataCb?.(bytes);
  }
  /** Fire a stream-level close (window-not-found / attach-failed / normal). */
  emitClosed(code: number, reason = "closed") {
    this.closedCb?.(code, reason);
  }
}

let muxIsOpen = true;
const mockRelayMux = {
  openStream: vi.fn((opts: OpenStreamOpts) => new MockStream(opts)),
  isOpen: () => muxIsOpen,
  close: vi.fn(),
};

vi.mock("@/lib/relay-mux", () => ({
  get relayMux() {
    return mockRelayMux;
  },
}));

// Mock all xterm-related modules to avoid actual terminal initialization
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      reset: vi.fn(),
      write: vi.fn(),
      scrollToBottom: vi.fn(),
      cols: 80,
      rows: 24,
      options: { fontSize: 13 },
      unicode: { activeVersion: "6" },
      hasSelection: vi.fn().mockReturnValue(false),
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ uploadFiles: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: { palette: {} },
    preference: "dark",
    resolved: "dark",
  }),
  useThemeActions: () => ({ setTheme: vi.fn() }),
}));

vi.mock("@/themes", () => ({
  deriveXtermTheme: () => ({}),
}));

function createWsRef(): React.MutableRefObject<WebSocket | null> {
  return { current: null };
}

function renderTerminalClient(scrollLocked = false) {
  return render(
    <ChromeProvider>
      <FocusedTerminalProvider>
        <TerminalClient
          sessionName="test-session"
          windowId="@0"
          server="default"
          wsRef={createWsRef()}
          scrollLocked={scrollLocked}
        />
      </FocusedTerminalProvider>
    </ChromeProvider>,
  );
}

describe("TerminalClient scroll-lock focus prevention", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prevents focus via touchend preventDefault when scrollLocked is true", async () => {
    const { container } = renderTerminalClient(true);

    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(touchEnd, "preventDefault");

    act(() => {
      terminalDiv!.dispatchEvent(touchEnd);
    });

    expect(preventSpy).toHaveBeenCalled();
  });

  it("does not prevent touchend when scrollLocked is false", async () => {
    const { container } = renderTerminalClient(false);

    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(touchEnd, "preventDefault");

    act(() => {
      terminalDiv!.dispatchEvent(touchEnd);
    });

    expect(preventSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for the stream-connection describe blocks (deferred reset +
// connection identity). The mutable state (rAF queue, MockStream.instances,
// Terminal mock) is reset per test by stubConnectionEnv() in each beforeEach.
// ---------------------------------------------------------------------------

let rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;

function runRafCallbacks() {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
}

type TerminalSpies = {
  reset: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

/** The Terminal instance created by this test's render. */
function terminalSpies(): TerminalSpies {
  const instance = vi.mocked(Terminal).mock.results[0]?.value as
    | TerminalSpies
    | undefined;
  expect(instance).toBeTruthy();
  return instance!;
}

/** Call order of the write(...) call whose payload matches `data` (a string is
 *  matched against a Uint8Array by comparing decoded bytes). */
function writeOrderOf(term: TerminalSpies, data: string | Uint8Array): number {
  const wantBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const idx = term.write.mock.calls.findIndex((c) => {
    const got = c[0];
    // Duck-type rather than `instanceof Uint8Array`: jsdom's TextEncoder can
    // yield a cross-realm Uint8Array whose prototype differs from the test
    // realm's, so `instanceof` is unreliable. ArrayBuffer.isView is realm-safe.
    if (!ArrayBuffer.isView(got)) return false;
    const bytes = new Uint8Array(got.buffer, got.byteOffset, got.byteLength);
    return (
      bytes.length === wantBytes.length &&
      bytes.every((b: number, i: number) => b === wantBytes[i])
    );
  });
  expect(idx).toBeGreaterThanOrEqual(0);
  return term.write.mock.invocationCallOrder[idx];
}

/** Realm-safe assertion that `term.write` received `data` (see writeOrderOf). */
function expectWritten(term: TerminalSpies, data: string | Uint8Array) {
  const wantBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const found = term.write.mock.calls.some((c) => {
    const got = c[0];
    if (!ArrayBuffer.isView(got)) return false;
    const bytes = new Uint8Array(got.buffer, got.byteOffset, got.byteLength);
    return (
      bytes.length === wantBytes.length &&
      bytes.every((b: number, i: number) => b === wantBytes[i])
    );
  });
  expect(found, `expected term.write to have received ${JSON.stringify(data)}`).toBe(true);
}

/** Per-test environment stubs shared by the stream-connection describe blocks. */
function stubConnectionEnv() {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  MockStream.instances = [];
  mockRelayMux.openStream.mockClear();
  muxIsOpen = true;
  rafCallbacks = new Map();
  nextRafId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.mocked(Terminal).mockClear();
}

describe("TerminalClient deferred reset (reset at first write, not receipt)", () => {
  async function mountAndGetStream(): Promise<MockStream> {
    renderTerminalClient(false);
    // Init is async (font-load await + state update + connect effect). Flush
    // microtasks until the stream has been opened.
    await act(async () => {});
    await act(async () => {});
    expect(MockStream.instances.length).toBeGreaterThan(0);
    const st = MockStream.instances[MockStream.instances.length - 1];
    // The stream opens → the mux acks `opened`, which arms the deferred reset.
    act(() => {
      st.emitOpened();
    });
    return st;
  }

  beforeEach(stubConnectionEnv);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not reset at receipt time for a coalesced first chunk; resets inside the flush, before the write", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();
    const bigChunk = "x".repeat(200); // > IMMEDIATE_WRITE_MAX_BYTES → rAF path

    act(() => {
      st.emitData(bigChunk);
    });

    // Receipt time: no reset, no write.
    expect(term.reset).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalled();

    act(() => {
      runRafCallbacks();
    });

    // Flush time: reset exactly once, ordered before the buffered write.
    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, bigChunk),
    );
  });

  it("resets synchronously before the write for a small first chunk (immediate path)", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();

    act(() => {
      st.emitData("ok"); // ≤ 64 bytes, idle → immediate path
    });

    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, "ok"),
    );
  });

  it("resets before the flush for a large first chunk (coalesced path)", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();
    const bytes = new Uint8Array(128).fill(120); // > 64 bytes → rAF path

    act(() => {
      st.emitData(bytes);
    });
    expect(term.reset).not.toHaveBeenCalled();

    act(() => {
      runRafCallbacks();
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, bytes),
    );
  });

  it("resets exactly once per open — subsequent chunks and flushes do not reset again", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();

    act(() => {
      st.emitData("a"); // immediate → consumes the reset
      st.emitData("b"); // same frame → buffers
      st.emitData("x".repeat(200)); // buffers
    });
    act(() => {
      runRafCallbacks(); // drain the buffered chunks
    });
    act(() => {
      st.emitData("c"); // fresh frame → immediate again
    });

    expect(term.reset).toHaveBeenCalledTimes(1);
  });

  it("re-arms the reset on a transparent re-open — the re-opened stream's first write resets again", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();

    act(() => {
      st.emitData("old"); // immediate write → sets wroteImmediatelyThisFrame
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    // Cross a frame boundary so the immediate-write flood guard resets (the next
    // small chunk can take the immediate path again).
    act(() => {
      runRafCallbacks();
    });

    // A socket-level drop is handled by RelayMux: it re-opens the SAME stream
    // transparently, surfaced as a fresh onOpened() (NOT a new MockStream, NOT
    // an onClosed). The re-open must re-arm the deferred reset.
    act(() => {
      st.emitOpened();
    });
    expect(MockStream.instances).toHaveLength(1); // no new stream — same handle
    expect(term.reset).toHaveBeenCalledTimes(1); // armed, not yet fired

    act(() => {
      st.emitData("new");
    });
    expect(term.reset).toHaveBeenCalledTimes(2);
    expect(term.reset.mock.invocationCallOrder[1]).toBeLessThan(
      writeOrderOf(term, "new"),
    );
  });

  it("does not reset on a stream close with no buffered data", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();
    term.reset.mockClear(); // ignore the arm from emitOpened (not yet fired anyway)

    act(() => {
      st.emitClosed(1000); // graceful close, no data ever arrived
    });

    expect(term.reset).not.toHaveBeenCalled();
  });

  it("drains buffered tail data on close without resetting when the reset was already consumed", async () => {
    const st = await mountAndGetStream();
    const term = terminalSpies();
    const tail = "t".repeat(100);

    act(() => {
      st.emitData("a"); // immediate → consumes the reset
      st.emitData(tail); // buffers; flush rAF pending
    });
    expect(term.reset).toHaveBeenCalledTimes(1);

    act(() => {
      st.emitClosed(1000); // cancels the rAF, drains the tail directly
    });

    expectWritten(term, tail);
    expect(term.reset).toHaveBeenCalledTimes(1); // no second reset on the tail drain
  });
});

describe("TerminalClient connection identity — (server, owning session), not windowId", () => {
  type Props = {
    sessionName: string;
    windowId: string;
    server?: string;
    onSessionNotFound?: () => void;
  };

  /** Rerenderable harness so tests can change session/window/server props. */
  function createHarness(initial: Props) {
    const wsRef = createWsRef();
    const renderAt = (p: Props) => (
      <ChromeProvider>
        <FocusedTerminalProvider>
          <TerminalClient
            sessionName={p.sessionName}
            windowId={p.windowId}
            server={p.server ?? "default"}
            wsRef={wsRef}
            onSessionNotFound={p.onSessionNotFound}
            scrollLocked={false}
          />
        </FocusedTerminalProvider>
      </ChromeProvider>
    );
    const view = render(renderAt(initial));
    return { view, renderAt };
  }

  function lastStream(): MockStream {
    expect(MockStream.instances.length).toBeGreaterThan(0);
    return MockStream.instances[MockStream.instances.length - 1];
  }

  /** Init is async (font-load await + state update + connect effect). */
  async function flushInit() {
    await act(async () => {});
    await act(async () => {});
  }

  beforeEach(stubConnectionEnv);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the live stream across a same-session windowId switch — no close, no new stream, no reset", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    const term = terminalSpies();

    act(() => {
      st1.emitOpened();
      st1.emitData("ok"); // consume the deferred reset
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockStream.instances.length;

    // Same-session window switch: tmux select-window moves the attached PTY in
    // place — the stream must survive.
    view.rerender(renderAt({ sessionName: "sess", windowId: "@1" }));
    await act(async () => {});

    expect(st1.closeSpy).not.toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount);
    expect(term.reset).toHaveBeenCalledTimes(1); // no new reset — scrollback survives

    // M1: the ride must push the NEW windowId into the live stream so a later
    // socket-level reconnect re-opens @1, not the stale @0 (which the server
    // would SelectWindowInSession, yanking the pane back). This is the
    // client-side half of M1; relay-mux.test.ts covers the mux re-issuing open
    // with the updated windowId.
    expect(st1.setWindowIdSpy).toHaveBeenCalledWith("@1");
    expect(st1.opts.windowId).toBe("@1");

    act(() => {
      st1.emitData("more");
    });
    act(() => {
      runRafCallbacks();
    });
    expectWritten(term, "more");
  });

  it("closes the old stream and opens exactly one new one on a cross-session switch, with the deferred reset before the new stream's first write", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess-a", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    const term = terminalSpies();

    act(() => {
      st1.emitOpened();
      st1.emitData("old");
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockStream.instances.length;

    // Cross-session navigation: the owning session genuinely changed — teardown
    // + reopen, targeting the LATEST windowId.
    view.rerender(renderAt({ sessionName: "sess-b", windowId: "@3" }));
    await act(async () => {});

    expect(st1.closeSpy).toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1); // exactly one
    const st2 = lastStream();
    expect(st2).not.toBe(st1);
    expect(st2.opts.windowId).toBe("@3");

    // Part-1 invariant on genuine reconnects: the reset is re-armed (on the new
    // stream's opened) and fires before its first write (no black frame).
    act(() => {
      st2.emitOpened();
    });
    expect(term.reset).toHaveBeenCalledTimes(1); // armed, not yet fired
    act(() => {
      st2.emitData("new");
    });
    expect(term.reset).toHaveBeenCalledTimes(2);
    expect(term.reset.mock.invocationCallOrder[1]).toBeLessThan(
      writeOrderOf(term, "new"),
    );
  });

  it('reopens when windowId changes while sessionName is still "" — unresolved identity falls back to windowId', async () => {
    const { view, renderAt } = createHarness({ sessionName: "", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    expect(st1.opts.windowId).toBe("@0");
    const instanceCount = MockStream.instances.length;

    view.rerender(renderAt({ sessionName: "", windowId: "@1" }));
    await act(async () => {});

    expect(st1.closeSpy).toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1);
    const st2 = lastStream();
    expect(st2.opts.windowId).toBe("@1");

    // The eventual resolution is absorbed as usual — no further reopen.
    view.rerender(renderAt({ sessionName: "resolved-sess", windowId: "@1" }));
    await act(async () => {});
    expect(st2.closeSpy).not.toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1);
  });

  it('does not reopen when sessionName resolves from "" — and a later genuine session change does', async () => {
    const { view, renderAt } = createHarness({ sessionName: "", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    const term = terminalSpies();

    act(() => {
      st1.emitOpened();
      st1.emitData("ok");
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockStream.instances.length;

    view.rerender(renderAt({ sessionName: "resolved-sess", windowId: "@0" }));
    await act(async () => {});

    expect(st1.closeSpy).not.toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount);
    expect(term.reset).toHaveBeenCalledTimes(1);

    // A later genuine session change must reopen.
    view.rerender(renderAt({ sessionName: "other-sess", windowId: "@2" }));
    await act(async () => {});

    expect(st1.closeSpy).toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1);
  });

  it("a transient socket drop after a same-session ride re-opens the LATEST (ridden-to) windowId, not the stale open-time one (M1)", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    expect(st1.opts.windowId).toBe("@0");

    // Same-session switch rides the existing stream (no reopen)…
    view.rerender(renderAt({ sessionName: "sess", windowId: "@5" }));
    await act(async () => {});
    expect(lastStream()).toBe(st1); // rode the stream, no new one

    // …and pushed @5 into the live stream. A transient SOCKET drop is handled
    // inside RelayMux (it re-issues `open` for every live stream from its stored
    // opts — see relay-mux.test.ts's M1 test), so the client-observable
    // guarantee here is that the stream's re-open target is @5, not the stale
    // open-time @0. Before M1, only cols/rows were refreshed, so the reconnect
    // re-opened @0 and the server SelectWindowInSession-ed the pane back.
    expect(st1.setWindowIdSpy).toHaveBeenCalledWith("@5");
    expect(st1.opts.windowId).toBe("@5");
    const instanceCount = MockStream.instances.length;

    // A genuine cross-session change still reopens a fresh stream, targeting @5.
    view.rerender(renderAt({ sessionName: "sess-2", windowId: "@5" }));
    await act(async () => {});

    expect(MockStream.instances.length).toBe(instanceCount + 1);
    const st2 = lastStream();
    expect(st2).not.toBe(st1);
    expect(st2.opts.windowId).toBe("@5");
  });

  it("reopens exactly once when server and session change together (the watcher does not double-trigger)", async () => {
    const { view, renderAt } = createHarness({
      sessionName: "sess",
      windowId: "@0",
      server: "alpha",
    });
    await flushInit();
    const st1 = lastStream();
    expect(st1.opts.server).toBe("alpha");
    const instanceCount = MockStream.instances.length;

    view.rerender(renderAt({ sessionName: "sess-2", windowId: "@1", server: "beta" }));
    await act(async () => {});
    await act(async () => {});

    expect(st1.closeSpy).toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1); // exactly one
    expect(lastStream().opts.server).toBe("beta");
  });

  it('reopens on resolved → "" — loss of identity triggers a probe reopen', async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const st1 = lastStream();
    const instanceCount = MockStream.instances.length;

    view.rerender(renderAt({ sessionName: "", windowId: "@0" }));
    await act(async () => {});

    expect(st1.closeSpy).toHaveBeenCalled();
    expect(MockStream.instances.length).toBe(instanceCount + 1);
    expect(lastStream()).not.toBe(st1);
  });

  it('restores the 4004 redirect after an external kill — resolved → "" probe stream closes 4004 and onSessionNotFound fires', async () => {
    const onSessionNotFound = vi.fn();
    const { view, renderAt } = createHarness({
      sessionName: "sess",
      windowId: "@0",
      onSessionNotFound,
    });
    await flushInit();
    const instanceCount = MockStream.instances.length;

    view.rerender(renderAt({ sessionName: "", windowId: "@0", onSessionNotFound }));
    await act(async () => {});
    expect(MockStream.instances.length).toBe(instanceCount + 1);
    const probe = lastStream();

    // The probe finds the window gone: the mux delivers a per-stream `closed`
    // 4004, and the redirect path must fire (no reconnect loop, no wedged route).
    act(() => {
      probe.emitClosed(4004, "Window not found");
    });
    expect(onSessionNotFound).toHaveBeenCalledTimes(1);
    // 4004 is a terminal stream close — no new stream opens.
    expect(MockStream.instances.length).toBe(instanceCount + 1);
  });

  it("probes ONE re-open on a non-4004 stream close (S1) — a still-live window re-attaches", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    void view;
    await flushInit();
    const st1 = lastStream();
    const instanceCount = MockStream.instances.length;

    // A non-4004 stream close (1000 graceful / PTY-EOF, or 4001 attach-failed):
    // the mux does NOT re-open a stream-level close, so the client probes ONE
    // fresh re-open (the old per-pane relay printed "[reconnecting…]" and
    // self-healed).
    act(() => {
      st1.emitClosed(1000, "closed");
    });
    expect(MockStream.instances.length).toBe(instanceCount + 1); // one probe re-open
    const probe = lastStream();
    expect(probe).not.toBe(st1);
    expect(probe.opts.windowId).toBe("@0"); // probes the current window

    // The probe re-attaches (still-live window): its data flows into the same
    // terminal, and NO further stream opens.
    act(() => {
      probe.emitOpened();
      probe.emitData("back");
    });
    const term = terminalSpies();
    expectWritten(term, "back");
    expect(MockStream.instances.length).toBe(instanceCount + 1); // still just the one probe
  });

  it("bounds the non-4004 probe to ONE — a second non-4004 close does not loop (S1)", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    void view;
    await flushInit();
    const st1 = lastStream();
    const instanceCount = MockStream.instances.length;

    act(() => {
      st1.emitClosed(1000, "closed"); // first close → one probe
    });
    expect(MockStream.instances.length).toBe(instanceCount + 1);
    const probe = lastStream();

    act(() => {
      probe.emitClosed(1000, "closed"); // second non-4004 close → NO further probe
    });
    // Bounded: the probe was already consumed, so no third stream opens (a
    // hard-failing window can't spin a re-open loop).
    expect(MockStream.instances.length).toBe(instanceCount + 1);
  });

  it("a non-4004 probe that finds the window gone 4004s → onSessionNotFound (S1)", async () => {
    const onSessionNotFound = vi.fn();
    const { view, renderAt } = createHarness({
      sessionName: "sess",
      windowId: "@0",
      onSessionNotFound,
    });
    void view;
    await flushInit();
    const st1 = lastStream();
    const instanceCount = MockStream.instances.length;

    act(() => {
      st1.emitClosed(1000, "closed"); // non-4004 → probe re-open
    });
    expect(MockStream.instances.length).toBe(instanceCount + 1);
    const probe = lastStream();

    // The probe finds the window genuinely gone: the mux 4004s it, and the
    // redirect fires (no wedged route).
    act(() => {
      probe.emitClosed(4004, "Window not found");
    });
    expect(onSessionNotFound).toHaveBeenCalledTimes(1);
    expect(MockStream.instances.length).toBe(instanceCount + 1); // no further re-open
  });
});

describe("TerminalClient Unicode width init", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    MockStream.instances = [];
    mockRelayMux.openStream.mockClear();
    vi.mocked(Terminal).mockClear();
    vi.mocked(UnicodeGraphemesAddon).mockClear();
    vi.mocked(WebglAddon).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads UnicodeGraphemesAddon and activates 15-graphemes before WebGL", async () => {
    renderTerminalClient(false);

    await waitFor(() => {
      expect(vi.mocked(UnicodeGraphemesAddon)).toHaveBeenCalled();
      expect(vi.mocked(WebglAddon)).toHaveBeenCalled();
    });

    const ctorArgs = vi.mocked(Terminal).mock.calls[0]?.[0];
    expect(ctorArgs?.allowProposedApi).toBe(true);

    const unicodeOrder = vi.mocked(UnicodeGraphemesAddon).mock.invocationCallOrder[0];
    const webglOrder = vi.mocked(WebglAddon).mock.invocationCallOrder[0];
    expect(unicodeOrder).toBeLessThan(webglOrder);

    const terminalInstance = vi.mocked(Terminal).mock.results[0]?.value as
      | { unicode: { activeVersion: string } }
      | undefined;
    expect(terminalInstance?.unicode.activeVersion).toBe("15-graphemes");
  });
});

describe("TerminalClient terminal-font change syncs the grid to tmux", () => {
  // A font change resizes the xterm grid but NOT the container, so the
  // ResizeObserver never fires. The font effect must therefore send the resize
  // itself — under the mux, that is a `resize` op on the stream. This regression
  // guards that path.

  function FontStepper() {
    const { increaseTerminalFont } = useChrome();
    return (
      <button data-testid="font-plus" onClick={() => increaseTerminalFont()}>
        +
      </button>
    );
  }

  beforeEach(() => {
    stubConnectionEnv();
    vi.mocked(FitAddon).mockClear();
    try { localStorage.removeItem("runkit-terminal-font-size"); } catch { /* noop */ }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Mount the terminal + a font stepper sharing one ChromeProvider, open the
   *  stream, fire opened (the connect-time grid handshake), and return the
   *  stream. */
  async function mountConnected(): Promise<MockStream> {
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <TerminalClient
            sessionName="session-a"
            windowId="@0"
            server="default"
            wsRef={createWsRef()}
            scrollLocked={false}
          />
          <FontStepper />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    await act(async () => {});
    await act(async () => {});
    const st = MockStream.instances[MockStream.instances.length - 1];
    // Fire opened so the connect-time grid resize is sent.
    act(() => {
      st.emitOpened();
    });
    return st;
  }

  /** The FitAddon instance THIS test's component created (last result). */
  function fitSpy() {
    const results = vi.mocked(FitAddon).mock.results;
    const inst = results[results.length - 1]?.value as
      | { fit: ReturnType<typeof vi.fn> }
      | undefined;
    expect(inst).toBeTruthy();
    return inst!.fit;
  }

  it("does NOT send an extra resize on mount beyond the connection-open handshake", async () => {
    const st = await mountConnected();
    // onOpened sends exactly one resize (the connect-time grid handshake); the
    // font effect must NOT add a second one on mount (it skips its first run).
    expect(st.resize).toHaveBeenCalledTimes(1);
  });

  it("sends a resize op with the terminal's cols/rows when the font changes", async () => {
    const st = await mountConnected();
    const fit = fitSpy();
    const fitCallsBefore = fit.mock.calls.length;
    const resizesBefore = st.resize.mock.calls.length;

    act(() => {
      (document.querySelector('[data-testid="font-plus"]') as HTMLButtonElement)?.click();
    });
    await act(async () => {});

    // It re-fit the terminal AND told the backend the new grid via a resize op.
    expect(fit.mock.calls.length).toBeGreaterThan(fitCallsBefore);
    expect(st.resize.mock.calls.length).toBe(resizesBefore + 1);
    expect(st.resize.mock.calls[st.resize.mock.calls.length - 1]).toEqual([80, 24]);
  });
});
