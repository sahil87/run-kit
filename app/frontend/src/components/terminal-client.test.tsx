import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { FocusedTerminalProvider } from "@/contexts/focused-terminal-context";
import { Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { TerminalClient } from "./terminal-client";

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

vi.mock("@/components/compose-buffer", () => ({
  ComposeBuffer: () => null,
}));

function createWsRef(): React.MutableRefObject<WebSocket | null> {
  return { current: null };
}

function renderTerminalClient(scrollLocked = false) {
  return render(
    <FocusedTerminalProvider>
      <TerminalClient
        sessionName="test-session"
        windowId="@0"
        server="default"
        wsRef={createWsRef()}
        composeOpen={false}
        setComposeOpen={vi.fn()}
        scrollLocked={scrollLocked}
      />
    </FocusedTerminalProvider>,
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

    // Dispatch a touchend event — it should be preventDefault'd
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

// Controllable WebSocket mock for the reset-ordering tests: instances are
// captured so tests can fire onopen/onmessage/onclose by hand, and the static
// readyState constants exist because the component compares against
// `WebSocket.OPEN`.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers for the WS-connection describe blocks (deferred reset +
// connection identity). Module-scoped like createWsRef above; the mutable
// state (rAF queue, MockWebSocket.instances, Terminal mock) is reset per test
// by stubConnectionEnv() in each block's beforeEach.
// ---------------------------------------------------------------------------

// requestAnimationFrame is stubbed with a manual queue so tests can drive
// the rAF-coalesced flush path deterministically.
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

/** Call order of the write(...) call whose payload matches `data`. */
function writeOrderOf(term: TerminalSpies, data: unknown): number {
  const idx = term.write.mock.calls.findIndex((c) => {
    if (data instanceof Uint8Array && c[0] instanceof Uint8Array) {
      return c[0].length === data.length && c[0].every((b: number, i: number) => b === data[i]);
    }
    return c[0] === data;
  });
  expect(idx).toBeGreaterThanOrEqual(0);
  return term.write.mock.invocationCallOrder[idx];
}

/** Per-test environment stubs shared by the WS-connection describe blocks. */
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
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
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
  async function mountAndGetSocket(): Promise<MockWebSocket> {
    renderTerminalClient(false);
    // Init is async (font-load await + state update + WS effect). Flush
    // microtasks until the WS effect has opened a connection.
    await act(async () => {});
    await act(async () => {});
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  beforeEach(stubConnectionEnv);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not reset at receipt time for a coalesced first chunk; resets inside the flush, before the write", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();
    const bigChunk = "x".repeat(200); // > IMMEDIATE_WRITE_MAX_BYTES → rAF path

    act(() => {
      ws.onmessage?.({ data: bigChunk });
    });

    // Receipt time: no reset, no write — the old code reset here, guaranteeing
    // a fully-cleared frame until the next rAF painted the buffer.
    expect(term.reset).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalled();

    act(() => {
      runRafCallbacks();
    });

    // Flush time: reset exactly once, ordered before the buffered write —
    // clear + repaint in the same rAF callback.
    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.write).toHaveBeenCalledWith(bigChunk);
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, bigChunk),
    );
  });

  it("resets synchronously before the write for a small string first chunk (immediate path)", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();

    act(() => {
      ws.onmessage?.({ data: "ok" }); // ≤ 64 bytes, idle → immediate path
    });

    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.write).toHaveBeenCalledWith("ok");
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, "ok"),
    );
  });

  it("resets before the write for a binary first chunk", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();
    const bytes = new Uint8Array([104, 105]); // "hi", ≤ 64 bytes → immediate path

    act(() => {
      ws.onmessage?.({ data: bytes.buffer });
    });

    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      writeOrderOf(term, bytes),
    );
  });

  it("resets before the flush for a large binary first chunk (coalesced path)", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();
    const bytes = new Uint8Array(128).fill(120); // > 64 bytes → rAF path

    act(() => {
      ws.onmessage?.({ data: bytes.buffer });
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

  it("resets exactly once per connection — subsequent chunks and flushes do not reset again", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();

    act(() => {
      ws.onmessage?.({ data: "a" }); // immediate → consumes the reset
      ws.onmessage?.({ data: "b" }); // same frame → buffers
      ws.onmessage?.({ data: "x".repeat(200) }); // buffers
    });
    act(() => {
      runRafCallbacks(); // drain the buffered chunks
    });
    act(() => {
      ws.onmessage?.({ data: "c" }); // fresh frame → immediate again
    });

    expect(term.write).toHaveBeenCalledWith("a");
    expect(term.write).toHaveBeenCalledWith("b" + "x".repeat(200));
    expect(term.write).toHaveBeenCalledWith("c");
    expect(term.reset).toHaveBeenCalledTimes(1);
  });

  it("re-arms the reset on reconnect — the new connection's first write resets again", async () => {
    const ws1 = await mountAndGetSocket();
    const term = terminalSpies();

    act(() => {
      ws1.onmessage?.({ data: "old" });
    });
    expect(term.reset).toHaveBeenCalledTimes(1);

    // Drop the connection. onclose drains (empty) buffers, prints the
    // reconnect notice, and arms the 1s reconnect timer.
    vi.useFakeTimers();
    act(() => {
      ws1.onclose?.({ code: 1006 });
    });
    expect(term.reset).toHaveBeenCalledTimes(1); // close-time drain did not reset

    act(() => {
      vi.advanceTimersByTime(1000); // reconnect timer → connect() re-arms
    });
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws2).not.toBe(ws1);

    act(() => {
      ws2.onmessage?.({ data: "new" });
    });
    expect(term.reset).toHaveBeenCalledTimes(2);
    // The second reset is ordered before the new connection's first write.
    expect(term.reset.mock.invocationCallOrder[1]).toBeLessThan(
      writeOrderOf(term, "new"),
    );
  });

  it("does not reset on a zero-message connection's close-time (empty) flush", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();

    act(() => {
      ws.onclose?.({ code: 1006 }); // no messages ever arrived
    });

    // The empty close-time flush must neither consume nor execute the pending
    // reset — resetting with nothing to repaint would recreate the flicker.
    expect(term.reset).not.toHaveBeenCalled();
  });

  it("drains buffered tail data on close without resetting when the reset was already consumed", async () => {
    const ws = await mountAndGetSocket();
    const term = terminalSpies();
    const tail = "t".repeat(100);

    act(() => {
      ws.onmessage?.({ data: "a" }); // immediate → consumes the reset
      ws.onmessage?.({ data: tail }); // buffers; flush rAF pending
    });
    expect(term.reset).toHaveBeenCalledTimes(1);

    act(() => {
      ws.onclose?.({ code: 1006 }); // cancels the rAF, drains the tail directly
    });

    expect(term.write).toHaveBeenCalledWith(tail);
    expect(term.reset).toHaveBeenCalledTimes(1); // no second reset on the tail drain
  });

  it("neutralizes pending write state at effect teardown — a dead connection's late onclose drain neither resets nor writes", async () => {
    // Cross-session switch while the first chunk is still buffered: the WS
    // effect (keyed on the resolved owning session — a same-session windowId
    // switch no longer tears down) tears down with the rAF pending and the
    // reset unconsumed. The old socket's onclose is delivered asynchronously
    // AFTER cleanup, and its drain runs before the `cancelled` check —
    // without the cleanup neutralization it would reset the shared terminal
    // and paint stale old-session content over the successor connection's
    // output.
    const wsRef = createWsRef();
    const renderAt = (sessionName: string, windowId: string) => (
      <FocusedTerminalProvider>
        <TerminalClient
          sessionName={sessionName}
          windowId={windowId}
          server="default"
          wsRef={wsRef}
          composeOpen={false}
          setComposeOpen={vi.fn()}
          scrollLocked={false}
        />
      </FocusedTerminalProvider>
    );

    const view = render(renderAt("session-a", "@0"));
    await act(async () => {});
    await act(async () => {});
    const ws1 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    const term = terminalSpies();
    const stale = "s".repeat(100); // > IMMEDIATE_WRITE_MAX_BYTES → buffered, rAF pending

    act(() => {
      ws1.onmessage?.({ data: stale });
    });
    expect(term.reset).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalled();

    // Cross-session navigation — the session-identity watcher bumps the
    // connection epoch, the old effect's cleanup runs (cancels the rAF, must
    // also neutralize the buffered chunk + pending reset), then the successor
    // effect opens a new connection.
    view.rerender(renderAt("session-b", "@1"));
    await act(async () => {});
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws2).not.toBe(ws1);

    // The dead connection's close arrives late; its drain must be a no-op.
    act(() => {
      ws1.onclose?.({ code: 1006 });
    });

    expect(term.reset).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalledWith(stale);
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
      <FocusedTerminalProvider>
        <TerminalClient
          sessionName={p.sessionName}
          windowId={p.windowId}
          server={p.server ?? "default"}
          wsRef={wsRef}
          composeOpen={false}
          setComposeOpen={vi.fn()}
          onSessionNotFound={p.onSessionNotFound}
          scrollLocked={false}
        />
      </FocusedTerminalProvider>
    );
    const view = render(renderAt(initial));
    return { view, renderAt };
  }

  function lastSocket(): MockWebSocket {
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  /** Init is async (font-load await + state update + WS effect). */
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

  it("keeps the live socket across a same-session windowId switch — no close, no new socket, no reset", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const ws1 = lastSocket();
    const term = terminalSpies();

    act(() => {
      ws1.onmessage?.({ data: "ok" }); // consume the deferred reset
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockWebSocket.instances.length;

    // Same-session window switch: tmux select-window (REST / status-bar
    // click) moves the attached PTY in place — the socket must survive.
    view.rerender(renderAt({ sessionName: "sess", windowId: "@1" }));
    await act(async () => {});

    expect(ws1.close).not.toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount);
    expect(term.reset).toHaveBeenCalledTimes(1); // no new reset — scrollback survives

    // The surviving socket still serves writes (buffered: a second chunk in
    // the same frame coalesces; drain the rAF queue to flush it).
    act(() => {
      ws1.onmessage?.({ data: "more" });
    });
    act(() => {
      runRafCallbacks();
    });
    expect(term.write).toHaveBeenCalledWith("more");
  });

  it("closes the old socket and opens exactly one new one on a cross-session switch, with the deferred reset before the new connection's first write", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess-a", windowId: "@0" });
    await flushInit();
    const ws1 = lastSocket();
    const term = terminalSpies();

    act(() => {
      ws1.onmessage?.({ data: "old" });
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockWebSocket.instances.length;

    // Cross-session navigation: the owning session genuinely changed —
    // teardown + reconnect, targeting the LATEST windowId.
    view.rerender(renderAt({ sessionName: "sess-b", windowId: "@3" }));
    await act(async () => {});

    expect(ws1.close).toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1); // exactly one
    const ws2 = lastSocket();
    expect(ws2).not.toBe(ws1);
    expect(ws2.url).toContain(`/relay/${encodeURIComponent("@3")}`);

    // Part-1 invariant on genuine reconnects: the reset is re-armed and
    // fires before the new connection's first write (no black frame).
    expect(term.reset).toHaveBeenCalledTimes(1); // armed, not yet fired
    act(() => {
      ws2.onmessage?.({ data: "new" });
    });
    expect(term.reset).toHaveBeenCalledTimes(2);
    expect(term.reset.mock.invocationCallOrder[1]).toBeLessThan(
      writeOrderOf(term, "new"),
    );
  });

  it('does not reconnect when sessionName resolves from "" — and a later genuine session change does', async () => {
    // Cold deep-link: the SSE-derived sessionName prop is "" until the first
    // snapshot resolves it; the relay already resolved the owning session
    // server-side, so the resolution must be absorbed without a reconnect.
    const { view, renderAt } = createHarness({ sessionName: "", windowId: "@0" });
    await flushInit();
    const ws1 = lastSocket();
    const term = terminalSpies();

    act(() => {
      ws1.onmessage?.({ data: "ok" });
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    const instanceCount = MockWebSocket.instances.length;

    view.rerender(renderAt({ sessionName: "resolved-sess", windowId: "@0" }));
    await act(async () => {});

    expect(ws1.close).not.toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount);
    expect(term.reset).toHaveBeenCalledTimes(1);

    // The resolution was RECORDED as the connection's identity: a later
    // genuine session change must reconnect.
    view.rerender(renderAt({ sessionName: "other-sess", windowId: "@2" }));
    await act(async () => {});

    expect(ws1.close).toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1);
  });

  it("reconnects after a transient drop with the LATEST windowId in the relay URL", async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const ws1 = lastSocket();
    expect(ws1.url).toContain(`/relay/${encodeURIComponent("@0")}`);

    // Same-session switch first — rides the existing socket (no reconnect)…
    view.rerender(renderAt({ sessionName: "sess", windowId: "@5" }));
    await act(async () => {});
    const instanceCount = MockWebSocket.instances.length;
    expect(lastSocket()).toBe(ws1);

    // …then the socket drops. The reconnect timer's connect() reads
    // windowIdRef.current, so the new URL must target @5, not @0.
    vi.useFakeTimers();
    act(() => {
      ws1.onclose?.({ code: 1006 });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances.length).toBe(instanceCount + 1);
    const ws2 = lastSocket();
    expect(ws2).not.toBe(ws1);
    expect(ws2.url).toContain(`/relay/${encodeURIComponent("@5")}`);
  });

  it("reconnects exactly once when server and session change together (the watcher does not double-trigger)", async () => {
    const { view, renderAt } = createHarness({
      sessionName: "sess",
      windowId: "@0",
      server: "alpha",
    });
    await flushInit();
    const ws1 = lastSocket();
    expect(ws1.url).toContain("server=alpha");
    const instanceCount = MockWebSocket.instances.length;

    // Cross-server navigation changes server AND sessionName in one commit.
    // The connect effect re-runs via its `server` dep; the session-identity
    // watcher must skip its epoch bump (connectedServerRef mismatch) or the
    // connection would be torn down and rebuilt twice.
    view.rerender(renderAt({ sessionName: "sess-2", windowId: "@1", server: "beta" }));
    await act(async () => {});
    await act(async () => {});

    expect(ws1.close).toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1); // exactly one
    expect(lastSocket().url).toContain("server=beta");
  });

  it('bumps the epoch on resolved → "" — loss of identity triggers a probe reconnect', async () => {
    const { view, renderAt } = createHarness({ sessionName: "sess", windowId: "@0" });
    await flushInit();
    const ws1 = lastSocket();
    const instanceCount = MockWebSocket.instances.length;

    // The viewed window left the SSE snapshot (killed externally, pinned to
    // a filtered _rk-pin-* session, or a dead deep link): sessionName goes
    // resolved → "" and stays there. The watcher must probe-reconnect — the
    // pre-change sessionName dep did this implicitly, and every other
    // recovery path (kill redirect, URL writeback) is gated on a non-empty
    // sessionName.
    view.rerender(renderAt({ sessionName: "", windowId: "@0" }));
    await act(async () => {});

    expect(ws1.close).toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1);
    expect(lastSocket()).not.toBe(ws1);
  });

  it('restores the 4004 redirect after an external kill — resolved → "" probe closes 4004 and onSessionNotFound fires', async () => {
    const onSessionNotFound = vi.fn();
    const { view, renderAt } = createHarness({
      sessionName: "sess",
      windowId: "@0",
      onSessionNotFound,
    });
    await flushInit();
    const instanceCount = MockWebSocket.instances.length;

    // Kill-while-viewing: the window vanishes from the snapshot…
    view.rerender(renderAt({ sessionName: "", windowId: "@0", onSessionNotFound }));
    await act(async () => {});
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1);
    const probe = lastSocket();

    // …the probe finds it gone: the relay closes 4004, and the redirect
    // path must fire (no reconnect loop, no wedged route).
    act(() => {
      probe.onclose?.({ code: 4004 });
    });
    expect(onSessionNotFound).toHaveBeenCalledTimes(1);
    // 4004 must not schedule a reconnect — the probe stays the last socket.
    expect(MockWebSocket.instances.length).toBe(instanceCount + 1);
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
    // The component opens a real WebSocket in a separate effect; stub it so
    // the test environment doesn't try to connect to a relay endpoint.
    vi.stubGlobal("WebSocket", vi.fn().mockImplementation(function () {
      return {
        readyState: 0,
        binaryType: "",
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
    }));
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

    // Init is async (font loads + dynamic addon imports). Wait for the
    // addon constructors to fire — guards against regressions in load order
    // or accidental removal of the Unicode width setup.
    await waitFor(() => {
      expect(vi.mocked(UnicodeGraphemesAddon)).toHaveBeenCalled();
      expect(vi.mocked(WebglAddon)).toHaveBeenCalled();
    });

    // Terminal must be constructed with allowProposedApi so the proposed
    // unicode-graphemes API is available to the addon.
    const ctorArgs = vi.mocked(Terminal).mock.calls[0]?.[0];
    expect(ctorArgs?.allowProposedApi).toBe(true);

    // Unicode addon must be instantiated before the WebGL addon so the
    // renderer measures cells against the Unicode 15 width table on first
    // paint (see terminal-client.tsx comment above the addon load).
    const unicodeOrder = vi.mocked(UnicodeGraphemesAddon).mock.invocationCallOrder[0];
    const webglOrder = vi.mocked(WebglAddon).mock.invocationCallOrder[0];
    expect(unicodeOrder).toBeLessThan(webglOrder);

    // The terminal instance's activeVersion must be flipped to the
    // grapheme-aware Unicode 15 table after the addon registers it.
    const terminalInstance = vi.mocked(Terminal).mock.results[0]?.value as
      | { unicode: { activeVersion: string } }
      | undefined;
    expect(terminalInstance?.unicode.activeVersion).toBe("15-graphemes");
  });
});
