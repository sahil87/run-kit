import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { OperatorConsole, OperatorConsoleTongue } from "./operator-console";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import {
  getConsoleMachineState,
  requestOperatorConsole,
  setConsoleMachineState,
  setOperatorComposeText,
  writeConsoleOpacity,
} from "@/lib/operator-console";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params the console's server-context walk reads.
let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
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
vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  sendToWindow: mockSend,
  uploadFile: mockUpload,
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
} = {}) {
  const servers = (opts.servers ?? ["srv1"]).map((name) => ({ name, sessionCount: 1 }));
  return render(
    <StandaloneSessionContextProvider
      value={{
        servers,
        serversLoaded: true,
        sessionsByServer: opts.sessionsByServer ?? new Map([["srv1", operatorSessions()]]),
      }}
    >
      <OperatorConsole />
    </StandaloneSessionContextProvider>,
  );
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
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "/tmp/op/.uploads/shot.png" });
    localStorage.clear();
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
      "no operator on this server — run `rk operator`",
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

  it("renders as a full-height sheet under the top bar on mobile", () => {
    stubMatchMedia(() => true);
    renderConsole();
    openDrawer();

    const el = screen.getByTestId("operator-console");
    expect(el.className).toContain("inset-0");
    expect(el.className).not.toContain("-translate-x-1/2");
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

describe("OperatorConsole (mobile sheet compose)", () => {
  beforeEach(() => {
    stubMatchMedia(() => true);
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "/tmp/op/.uploads/shot.png" });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the compose strip in the sheet (the one-input rule is per form factor)", () => {
    renderConsole();
    openDrawer();

    const el = screen.getByTestId("operator-console");
    expect(el.querySelector("textarea")).toBe(screen.getByLabelText("Message the operator"));
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("Enter delivers via sendToWindow with the agent target and clears the input", async () => {
    renderConsole();
    openDrawer();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "restart the worker" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "restart the worker", "submit", "agent");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("Shift+Enter inserts a newline instead of sending", () => {
    renderConsole();
    openDrawer();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mockSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one");
  });

  it("a failed send surfaces the message inline and preserves the composed text", async () => {
    mockSend.mockRejectedValue(new Error("probe failed: no novelty echo"));
    renderConsole();
    openDrawer();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "retry me" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("operator-console-error")).toHaveTextContent("probe failed: no novelty echo"),
    );
    expect(input).toHaveValue("retry me");

    // The next edit dismisses the error line.
    fireEvent.change(input, { target: { value: "retry me, edited" } });
    expect(screen.queryByTestId("operator-console-error")).toBeNull();
  });

  it("the in-flight guard blocks a second send until the first resolves", async () => {
    let release!: () => void;
    mockSend.mockImplementation(() => new Promise<{ ok: boolean }>((resolve) => { release = () => resolve({ ok: true }); }));
    renderConsole();
    openDrawer();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("focuses the compose input on open and restores focus on close", async () => {
    renderConsole();
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();
    openDrawer();

    await waitFor(() => expect(screen.getByLabelText("Message the operator")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(prior).toHaveFocus());
    prior.remove();
  });
});

describe("OperatorConsoleTongue", () => {
  beforeEach(() => {
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    localStorage.clear();
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

  it("is the standing affordance on mobile: visible while closed, tap opens the sheet, hidden while open", async () => {
    stubMatchMedia(() => true);
    renderTongue();

    const tongue = screen.getByTestId("operator-console-tongue");
    expect(screen.queryByTestId("operator-console")).toBeNull();

    fireEvent.click(tongue);
    await screen.findByTestId("operator-console");
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
