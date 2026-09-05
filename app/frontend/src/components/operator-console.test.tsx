import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { OperatorConsole, OperatorConsoleTongue } from "./operator-console";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import {
  dismissOperatorChatChip,
  getConsoleMachineState,
  getOperatorChatTarget,
  requestOperatorConsole,
  setConsoleMachineState,
  setOperatorChatSubject,
  setOperatorComposeText,
  writeConsoleOpacity,
} from "@/lib/operator-console";
import { getComposeDraft, hydrateComposeDrafts } from "@/lib/compose-draft-store";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params and search the console's server-context walk and `?from=`
// validation read; navigations the mobile arm issues are recorded.
let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];
let mockSearch: Record<string, unknown> = {};
const mockNavigate = vi.hoisted(() => vi.fn());
const mockHistoryBack = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
  useSearch: () => mockSearch,
  useNavigate: () => mockNavigate,
  useRouter: () => ({ history: { back: mockHistoryBack } }),
}));

// The embedded terminal is TerminalClient's own tested surface; here we only
// record the (server, windowId, sessionName) it was pointed at.
const terminalMounts = vi.hoisted(() => [] as { server: string; windowId: string; sessionName: string }[]);
vi.mock("@/components/terminal-client", () => ({
  TerminalClient: (props: { server: string; windowId: string; sessionName: string }) => {
    terminalMounts.push({ server: props.server, windowId: props.windowId, sessionName: props.sessionName });
    return <div data-testid="embedded-terminal" />;
  },
}));

const mockSend = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
const mockOperatorRequest = vi.hoisted(() => vi.fn());
vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  sendToWindow: mockSend,
  uploadFile: mockUpload,
  sendOperatorRequest: mockOperatorRequest,
}));

function win(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    windowId: "@1",
    index: 0,
    name: "win",
    worktreePath: "/tmp",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

const OPERATOR_WINDOW = win({ windowId: "@9", name: "operator", role: "operator" });

function operatorSessions(extraWindows: WindowInfo[] = []): ProjectSession[] {
  return [
    { name: "main", windows: [win({ windowId: "@1" }), ...extraWindows] },
    { name: "_rk-operator", windows: [OPERATOR_WINDOW], hidden: true },
  ];
}

function renderConsole(opts: {
  servers?: string[];
  sessionsByServer?: Map<string, ProjectSession[]>;
  withToasts?: boolean;
} = {}) {
  const servers = (opts.servers ?? ["srv1"]).map((name) => ({ name, sessionCount: 1 }));
  const tree = (
    <StandaloneSessionContextProvider
      value={{
        servers,
        serversLoaded: true,
        sessionsByServer: opts.sessionsByServer ?? new Map([["srv1", operatorSessions()]]),
      }}
    >
      <OperatorConsole />
    </StandaloneSessionContextProvider>
  );
  return render(opts.withToasts ? <ToastProvider>{tree}</ToastProvider> : tree);
}

/** The chord's first desktop step is focused-only (no drawer); tests that
 *  need the drawer open dispatch the palette action's `open` instead. */
function openDrawer() {
  act(() => {
    requestOperatorConsole({ action: "open" });
  });
}

function stepMachine() {
  act(() => {
    requestOperatorConsole({ action: "toggle" });
  });
}

describe("OperatorConsole", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    mockSearch = {};
    mockNavigate.mockReset();
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "/tmp/op/.uploads/shot.png" });
    mockOperatorRequest.mockReset();
    mockOperatorRequest.mockResolvedValue({ outcome: "delivered" });
    setOperatorChatSubject(null);
    localStorage.clear();
    hydrateComposeDrafts();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the chord steps the desktop machine rest → focused → open → rest", async () => {
    renderConsole();
    expect(screen.queryByTestId("operator-console")).toBeNull();

    // Step 1: focused — the omnibox engages, the drawer stays closed.
    stepMachine();
    expect(getConsoleMachineState()).toBe("focused");
    expect(screen.queryByTestId("operator-console")).toBeNull();

    // Step 2: open — the peek, nothing sent.
    stepMachine();
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();

    // Step 3: rest — the exit slide holds the mount until transitionend (or
    // the fallback timeout — jsdom fires no transition events).
    stepMachine();
    await waitFor(() => expect(screen.queryByTestId("operator-console")).toBeNull());
    expect(getConsoleMachineState()).toBe("rest");
  });

  it("Esc steps back one level: open → focused → rest", async () => {
    renderConsole();
    openDrawer();
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    // The drawer closes (mounted through the exit slide) but the machine only
    // stepped back to focused — the omnibox keeps focus.
    expect(getConsoleMachineState()).toBe("focused");
    await waitFor(() => expect(screen.queryByTestId("operator-console")).toBeNull());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getConsoleMachineState()).toBe("rest");
  });

  it("stays mounted with the raised class through the exit slide", async () => {
    renderConsole();
    openDrawer();
    await screen.findByTestId("operator-console");

    fireEvent.keyDown(document, { key: "Escape" });
    const el = screen.getByTestId("operator-console");
    expect(el.className).toContain("rk-console-slide");
    expect(el.className).toContain("rk-console-closed");

    await waitFor(() => expect(screen.queryByTestId("operator-console")).toBeNull());
  });

  it("reduced motion closes instantly — no mounted-through-exit delay", () => {
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    renderConsole();
    openDrawer();
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("operator-console")).toBeNull();
  });

  it("the ◉ button action maps open ⇄ rest", async () => {
    renderConsole();
    act(() => requestOperatorConsole({ action: "button" }));
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();

    act(() => requestOperatorConsole({ action: "button" }));
    expect(getConsoleMachineState()).toBe("rest");
    await waitFor(() => expect(screen.queryByTestId("operator-console")).toBeNull());
  });

  it("the desktop drawer is output-only — no compose strip, status line at its top edge", async () => {
    renderConsole();
    openDrawer();
    const el = await screen.findByTestId("operator-console");

    expect(screen.queryByLabelText("Message the operator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(el.querySelector("textarea")).toBeNull();
  });

  it("targets the route's server on a terminal route (no picker)", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();
    openDrawer();

    expect(screen.queryByRole("combobox", { name: "Operator server" })).toBeNull();
    expect(terminalMounts[0]).toMatchObject({ server: "srv1", windowId: "@9", sessionName: "_rk-operator" });
  });

  it("preselects the sole server on the Host route without a picker", () => {
    renderConsole();
    openDrawer();

    expect(screen.queryByRole("combobox", { name: "Operator server" })).toBeNull();
    expect(terminalMounts[0]?.server).toBe("srv1");
  });

  it("offers a server picker on the Host route with multiple servers and retargets on change", () => {
    renderConsole({
      servers: ["a", "b", "c"],
      sessionsByServer: new Map([
        ["a", operatorSessions()],
        ["b", operatorSessions([win({ windowId: "@7", name: "operator-b", role: "operator" })])],
        ["c", []],
      ]),
    });
    openDrawer();

    const picker = screen.getByRole("combobox", { name: "Operator server" });
    expect(picker).toHaveValue("a");

    fireEvent.change(picker, { target: { value: "b" } });
    const last = terminalMounts[terminalMounts.length - 1];
    expect(last).toMatchObject({ server: "b", windowId: "@7" });
  });

  it("renders the hint line (no stream, no compose) when the resolved server has no operator", () => {
    renderConsole({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    openDrawer();

    expect(screen.getByTestId("operator-console-empty")).toHaveTextContent(
      "no operator on this server — run rk operator",
    );
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
    expect(screen.queryByLabelText("Message the operator")).toBeNull();
  });

  it("opens without crashing on an empty (still-loading) server list", () => {
    renderConsole({ servers: [], sessionsByServer: new Map() });
    openDrawer();

    expect(screen.getByTestId("operator-console-empty")).toBeInTheDocument();
    expect(terminalMounts).toHaveLength(0);
  });

  it("renders the operator window's live agent state in the title strip", () => {
    renderConsole({
      sessionsByServer: new Map([
        [
          "srv1",
          [
            { name: "main", windows: [] },
            {
              name: "_rk-operator",
              hidden: true,
              windows: [win({ windowId: "@9", name: "operator", role: "operator", agentState: "waiting", agentIdleDuration: "2m" })],
            },
          ],
        ],
      ]),
    });
    openDrawer();

    expect(screen.getByTestId("operator-console-state")).toHaveTextContent("waiting 2m");
  });

  it("the palette fallback request opens the console and sends the query immediately", async () => {
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "open", send: "find the stuck deploy" });
    });

    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "find the stuck deploy", "submit", "agent");
  });

  it("a fallback send against an operator-less server is dropped (the hint is the answer)", async () => {
    renderConsole({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    act(() => {
      requestOperatorConsole({ action: "open", send: "anything at all" });
    });

    expect(screen.getByTestId("operator-console-empty")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a failed fallback send renders the error at the drawer's top edge", async () => {
    mockSend.mockRejectedValue(new Error("probe failed: no novelty echo"));
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "open", send: "retry me" });
    });

    await waitFor(() =>
      expect(screen.getByTestId("operator-console-error")).toHaveTextContent("probe failed: no novelty echo"),
    );
  });

  it("a fallback send fired in the same commit as a re-open reads the post-reset chip state", async () => {
    // Reduced motion so the close is instant — the send below must not wait
    // out an exit slide.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();
    openDrawer();

    // Dismiss, then close — the dismissal is still live store state here.
    act(() => dismissOperatorChatChip());
    act(() => setConsoleMachineState("rest"));
    expect(screen.queryByTestId("operator-console")).toBeNull();

    // Re-open via the Ask-operator fallback: the reset effect and the
    // pendingSend delivery land in the same commit — the send must read the
    // post-reset store, riding the templated lane.
    act(() => {
      requestOperatorConsole({ action: "open", send: "still broken" });
    });

    await waitFor(() => expect(mockOperatorRequest).toHaveBeenCalledTimes(1));
    expect(mockOperatorRequest).toHaveBeenCalledWith("srv1", "@1", "user-message", "still broken");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a desktop→mobile viewport flip resets the machine to rest and unmounts the drawer", async () => {
    // A controllable MQL (the shared stub's listeners are fire-and-forget):
    // flip `matches` and fire the change listeners to simulate the resize.
    const listeners = new Set<() => void>();
    const mql = {
      matches: false,
      media: "",
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: (fn: () => void) => listeners.add(fn),
      removeListener: (fn: () => void) => listeners.delete(fn),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => mql));
    renderConsole();
    openDrawer();
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();

    act(() => {
      mql.matches = true;
      for (const fn of [...listeners]) fn();
    });

    expect(getConsoleMachineState()).toBe("rest");
    expect(screen.queryByTestId("operator-console")).toBeNull();
  });

  it("applies the glass background at the stored opacity and drops the blur at α=1", async () => {
    renderConsole();
    openDrawer();
    const el = await screen.findByTestId("operator-console");

    expect(el.style.backgroundColor).toContain("color-mix(in srgb, var(--color-bg-primary) 90%");
    expect(el.style.backdropFilter).toBe("blur(6px)");

    act(() => writeConsoleOpacity(1));
    expect(el.style.backdropFilter).toBe("");
    expect(el.style.backgroundColor).toContain("100%");
  });

  it("dragging the height grip resizes the drawer and persists the geometry on release", async () => {
    renderConsole();
    openDrawer();
    const el = await screen.findByTestId("operator-console");
    expect(el.style.height).toBe("55vh");

    const grip = screen.getByTestId("operator-console-grip-height");
    // A full-viewport drag overshoots the clamp: the height pins at 85vh.
    fireEvent.pointerDown(grip, { button: 0, clientX: 100, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 100, clientY: 300 + window.innerHeight, pointerId: 1 });
    expect(el.style.height).toBe("85vh");
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(JSON.parse(localStorage.getItem("runkit-operator-console-geometry")!)).toMatchObject({
      heightVh: 85,
    });
  });

  it("dragging a side grip resizes symmetrically and persists the width", async () => {
    renderConsole();
    openDrawer();
    const el = await screen.findByTestId("operator-console");

    const grip = screen.getByTestId("operator-console-grip-right");
    fireEvent.pointerDown(grip, { button: 0, clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 550, clientY: 100, pointerId: 1 });
    // +50px on the right edge = +100px total (the drawer stays centered).
    expect(el.style.width).toBe("860px");
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(JSON.parse(localStorage.getItem("runkit-operator-console-geometry")!)).toMatchObject({
      widthPx: 860,
    });
  });

  it("file paste inside the drawer uploads to the operator session and insert-delivers the path", async () => {
    renderConsole();
    openDrawer();
    const root = await screen.findByTestId("operator-console");

    const file = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(root, { clipboardData: { files: [file] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", file, "@9");
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "/tmp/op/.uploads/shot.png ", "raw", "agent"),
    );
  });

  it("file paste on an operator-less server is a no-op", async () => {
    renderConsole({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    openDrawer();
    const root = await screen.findByTestId("operator-console");

    fireEvent.paste(root, { clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("an upload failure surfaces on the inline error line and delivers nothing", async () => {
    mockUpload.mockRejectedValue(new Error("upload exploded"));
    renderConsole();
    openDrawer();
    const root = await screen.findByTestId("operator-console");

    fireEvent.paste(root, { clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });

    await waitFor(() =>
      expect(screen.getByTestId("operator-console-error")).toHaveTextContent("upload exploded"),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a file drop inside the drawer uploads to the operator session", async () => {
    renderConsole();
    openDrawer();
    const root = await screen.findByTestId("operator-console");

    const file = new File(["png"], "shot.png", { type: "image/png" });
    const proceeded = fireEvent.drop(root, { dataTransfer: { files: [file], types: ["Files"] } });

    expect(proceeded).toBe(false);
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", file, "@9");
  });

  it("a non-file drop inside the drawer is canceled (no browser navigation) and uploads nothing", async () => {
    renderConsole();
    openDrawer();
    const root = await screen.findByTestId("operator-console");

    const proceeded = fireEvent.drop(root, { dataTransfer: { files: [], types: ["text/uri-list"] } });

    expect(proceeded).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe("OperatorConsole (mobile navigation)", () => {
  beforeEach(() => {
    stubMatchMedia(() => true);
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    mockSearch = {};
    mockNavigate.mockReset();
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockOperatorRequest.mockReset();
    mockOperatorRequest.mockResolvedValue({ outcome: "delivered" });
    setOperatorChatSubject(null);
    localStorage.clear();
    hydrateComposeDrafts();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("a console request navigates to the operator window's terminal route — no sheet mounts", () => {
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "open" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: {},
    });
    expect(screen.queryByTestId("operator-console")).toBeNull();
    expect(getConsoleMachineState()).toBe("rest");
  });

  it("all three actions collapse to the same navigation", () => {
    renderConsole();
    for (const action of ["toggle", "open", "button"] as const) {
      act(() => {
        requestOperatorConsole({ action });
      });
    }

    expect(mockNavigate).toHaveBeenCalledTimes(3);
    for (const call of mockNavigate.mock.calls) {
      expect(call[0]).toMatchObject({ params: { server: "srv1", window: "@9" }, search: {} });
    }
  });

  it("navigating from a terminal route carries the origin window as ?from=", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "toggle" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: { from: "@1" },
    });
  });

  it("already on the operator route, re-activation is a true no-op — the existing ?from= survives", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "toggle" });
    });

    // No navigate: a replace would have dropped the route's `?from=` (and
    // with it the context chip).
    expect(mockNavigate).not.toHaveBeenCalled();

    // A fallback query still seeds the draft without navigating.
    act(() => {
      requestOperatorConsole({ action: "open", send: "still broken" });
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getComposeDraft("srv1:@9").text).toBe("still broken");
  });

  it("the pinned sidebar row navigates to its own server's operator route", () => {
    renderConsole({
      servers: ["srv1", "srv2"],
      sessionsByServer: new Map([
        ["srv1", operatorSessions()],
        [
          "srv2",
          [
            { name: "main", windows: [win({ windowId: "@1" })] },
            { name: "_rk-operator", hidden: true, windows: [win({ windowId: "@7", name: "operator-b", role: "operator" })] },
          ],
        ],
      ]),
    });
    act(() => {
      requestOperatorConsole({ action: "open", server: "srv2" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv2", window: "@7" },
      search: {},
    });
  });

  it("the palette fallback query seeds the operator route's compose draft instead of auto-sending", async () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();
    act(() => {
      requestOperatorConsole({ action: "open", send: "find the stuck deploy" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: { from: "@1" },
    });
    expect(getComposeDraft("srv1:@9").text).toBe("find the stuck deploy");
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockOperatorRequest).not.toHaveBeenCalled();
  });

  it("an operator-less server toasts the hint once and never navigates", () => {
    renderConsole({
      withToasts: true,
      sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]),
    });
    act(() => {
      requestOperatorConsole({ action: "toggle" });
    });
    act(() => {
      requestOperatorConsole({ action: "open" });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    // Repeated activations within one toast lifetime do not stack.
    expect(screen.getAllByText("no operator on this server — run rk operator")).toHaveLength(1);
  });
});

describe("OperatorConsoleTongue", () => {
  beforeEach(() => {
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    mockSearch = {};
    mockNavigate.mockReset();
    mockHistoryBack.mockReset();
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    setOperatorChatSubject(null);
    localStorage.clear();
    hydrateComposeDrafts();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderTongue(sessions: ProjectSession[] = operatorSessions()) {
    return render(
      <StandaloneSessionContextProvider
        value={{
          servers: [{ name: "srv1", sessionCount: 1 }],
          serversLoaded: true,
          sessionsByServer: new Map([["srv1", sessions]]),
        }}
      >
        <OperatorConsole />
        <OperatorConsoleTongue />
      </StandaloneSessionContextProvider>,
    );
  }

  it("is the standing affordance on mobile: a tap navigates to the operator route", () => {
    stubMatchMedia(() => true);
    renderTongue();

    fireEvent.click(screen.getByTestId("operator-console-tongue"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: {},
    });
    expect(screen.queryByTestId("operator-console")).toBeNull();
  });

  it("renders the return state on the operator window's route, waiting dot suppressed", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    renderTongue([
      { name: "main", windows: [win({})] },
      {
        name: "_rk-operator",
        hidden: true,
        windows: [win({ windowId: "@9", name: "operator", role: "operator", agentState: "waiting" })],
      },
    ]);

    const tongue = screen.getByTestId("operator-console-tongue");
    expect(tongue).toHaveAttribute("data-tongue-state", "return");
    expect(screen.queryByTestId("operator-console-tongue-waiting")).toBeNull();
  });

  it("return tap navigates to the validated ?from= origin window", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderTongue();

    fireEvent.click(screen.getByTestId("operator-console-tongue"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@1" },
      search: {},
    });
    expect(mockHistoryBack).not.toHaveBeenCalled();
  });

  it("return tap with an unknown ?from= falls through to history back", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@404" };
    vi.stubGlobal("history", { length: 2 });
    renderTongue();

    fireEvent.click(screen.getByTestId("operator-console-tongue"));

    expect(mockHistoryBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("return tap with no ?from= and no back entry lands on the server route", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    vi.stubGlobal("history", { length: 1 });
    renderTongue();

    fireEvent.click(screen.getByTestId("operator-console-tongue"));

    expect(mockHistoryBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "srv1" } });
  });

  it("hides when no operator window resolves on the server", () => {
    stubMatchMedia(() => true);
    renderTongue([{ name: "main", windows: [win({})] }]);

    expect(screen.queryByTestId("operator-console-tongue")).toBeNull();
  });

  it("carries the amber waiting dot when the resolved operator is waiting", () => {
    stubMatchMedia(() => true);
    renderTongue([
      { name: "main", windows: [win({})] },
      {
        name: "_rk-operator",
        hidden: true,
        windows: [win({ windowId: "@9", name: "operator", role: "operator", agentState: "waiting" })],
      },
    ]);
    expect(screen.getByTestId("operator-console-tongue-waiting")).toBeInTheDocument();
  });

  it("renders nothing on desktop", () => {
    stubMatchMedia(() => false);
    renderTongue();
    expect(screen.queryByTestId("operator-console-tongue")).toBeNull();
  });
});

describe("OperatorConsole (chat subject stamping)", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    mockSearch = {};
    mockNavigate.mockReset();
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockOperatorRequest.mockReset();
    mockOperatorRequest.mockResolvedValue({ outcome: "delivered" });
    setOperatorChatSubject(null);
    localStorage.clear();
    hydrateComposeDrafts();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("on a terminal route the route window is stamped as the chat subject", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1", name: "win" });
  });

  it("on the operator window's own route the validated ?from= origin is stamped instead", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderConsole();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1" });
  });

  it("the numeric segment form of ?from= resolves like the path parse", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "1" };
    renderConsole();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1" });
  });

  it("an absent, unknown, or self ?from= on the operator route stamps no subject", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    for (const from of [undefined, "@42", "@9"]) {
      setOperatorChatSubject(null);
      mockSearch = from === undefined ? {} : { from };
      const { unmount } = renderConsole();
      expect(getOperatorChatTarget("srv1")).toBeNull();
      unmount();
    }
  });

  it("a stamped subject does not cross servers", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();

    expect(getOperatorChatTarget("srv2")).toBeNull();
  });

  it("a pinned cross-server retarget does not attach the route's window", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole({
      servers: ["srv1", "srv2"],
      sessionsByServer: new Map([
        ["srv1", operatorSessions()],
        ["srv2", operatorSessions()],
      ]),
    });
    act(() => {
      requestOperatorConsole({ action: "open", server: "srv2" });
    });

    expect(getOperatorChatTarget("srv1")).toBeNull();
    expect(getOperatorChatTarget("srv2")).toBeNull();
  });

  it("a subject change re-attaches a dismissed chip; re-engaging the console does too", () => {
    // Reduced motion so the desktop exit is instant — `engaged` only leaves
    // true once the drawer has actually unmounted (the exit slide otherwise
    // holds it), and re-engagement is the edge this test exercises.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    const view = renderConsole();
    openDrawer();
    act(() => dismissOperatorChatChip());
    expect(getOperatorChatTarget("srv1")).toBeNull();

    // Close and re-open: the machine leaving rest re-attaches.
    act(() => setConsoleMachineState("rest"));
    openDrawer();
    expect(getOperatorChatTarget("srv1")?.windowId).toBe("@1");

    // Dismiss again; a route-window change resets the dismissal in the store.
    act(() => dismissOperatorChatChip());
    expect(getOperatorChatTarget("srv1")).toBeNull();
    mockMatches = [{ params: { server: "srv1", window: "@2" } }];
    view.rerender(
      <StandaloneSessionContextProvider
        value={{
          servers: [{ name: "srv1", sessionCount: 1 }],
          serversLoaded: true,
          sessionsByServer: new Map([["srv1", operatorSessions()]]),
        }}
      >
        <OperatorConsole />
      </StandaloneSessionContextProvider>,
    );
    expect(getOperatorChatTarget("srv1")?.windowId).toBe("@2");
  });

  it("no subject is stamped on a route without a window", () => {
    renderConsole();

    expect(getOperatorChatTarget("srv1")).toBeNull();
  });
});
