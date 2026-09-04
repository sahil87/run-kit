import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { OperatorConsole } from "./operator-console";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { requestOperatorConsole } from "@/lib/operator-console";
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
vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  sendToWindow: mockSend,
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

function openConsole() {
  act(() => {
    requestOperatorConsole({ action: "toggle" });
  });
}

describe("OperatorConsole", () => {
  beforeEach(() => {
    mockMatches = [{ params: {} }];
    terminalMounts.length = 0;
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it("is closed by default, opens on the toggle event, and Esc closes it", () => {
    renderConsole();
    expect(screen.queryByTestId("operator-console")).toBeNull();

    openConsole();
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("operator-console")).toBeNull();
  });

  it("targets the route's server on a terminal route (no picker)", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderConsole();
    openConsole();

    expect(screen.queryByRole("combobox", { name: "Operator server" })).toBeNull();
    expect(terminalMounts[0]).toMatchObject({ server: "srv1", windowId: "@9", sessionName: "_rk-operator" });
  });

  it("preselects the sole server on the Host route without a picker", () => {
    renderConsole();
    openConsole();

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
    openConsole();

    const picker = screen.getByRole("combobox", { name: "Operator server" });
    expect(picker).toHaveValue("a");

    fireEvent.change(picker, { target: { value: "b" } });
    const last = terminalMounts[terminalMounts.length - 1];
    expect(last).toMatchObject({ server: "b", windowId: "@7" });
  });

  it("renders the hint line (no stream, no compose) when the resolved server has no operator", () => {
    renderConsole({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    openConsole();

    expect(screen.getByTestId("operator-console-empty")).toHaveTextContent(
      "no operator on this server — run `rk operator`",
    );
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
    expect(screen.queryByLabelText("Message the operator")).toBeNull();
  });

  it("opens without crashing on an empty (still-loading) server list", () => {
    renderConsole({ servers: [], sessionsByServer: new Map() });
    openConsole();

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
    openConsole();

    expect(screen.getByTestId("operator-console-state")).toHaveTextContent("waiting 2m");
  });

  it("Enter delivers via sendToWindow with the agent target and clears the input", async () => {
    renderConsole();
    openConsole();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "restart the worker" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "restart the worker", "submit", "agent");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("Shift+Enter inserts a newline instead of sending", () => {
    renderConsole();
    openConsole();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mockSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one");
  });

  it("a failed send surfaces the message inline and preserves the composed text", async () => {
    mockSend.mockRejectedValue(new Error("probe failed: no novelty echo"));
    renderConsole();
    openConsole();

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
    openConsole();

    const input = screen.getByLabelText("Message the operator");
    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => release());
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

  it("focuses the compose input on open and restores focus on close", async () => {
    renderConsole();
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();
    openConsole();

    await waitFor(() => expect(screen.getByLabelText("Message the operator")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(prior).toHaveFocus());
    prior.remove();
  });

  it("renders as a full-height sheet under the top bar on mobile", () => {
    stubMatchMedia(() => true);
    renderConsole();
    openConsole();

    const el = screen.getByTestId("operator-console");
    expect(el.className).toContain("inset-0");
    expect(el.className).not.toContain("-translate-x-1/2");
  });
});
