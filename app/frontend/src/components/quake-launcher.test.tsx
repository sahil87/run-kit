import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { QuakeTerminal } from "./quake-terminal";
import { QuakeLauncher } from "./quake-launcher";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import {
  dismissOperatorChatChip,
  getQuakeMachineState,
  isQuakeTerminalTarget,
  requestQuakeTerminal,
  setQuakeMachineState,
  setOperatorChatSubject,
  setOperatorComposeText,
} from "@/lib/quake-terminal";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params the quake terminal/quake launcher server-context walk reads; the quake terminal's
// mobile navigation arm's hooks are inert under the desktop stub but must
// exist on the mock.
let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/terminal-client", () => ({
  TerminalClient: () => <div data-testid="embedded-terminal" />,
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

function operatorSessions(agentState?: string): ProjectSession[] {
  return [
    { name: "main", windows: [win({ windowId: "@1" })] },
    {
      name: "_rk-operator",
      windows: [win({ windowId: "@9", name: "operator", role: "operator", agentState })],
      hidden: true,
    },
  ];
}

function renderPair(sessionsByServer?: Map<string, ProjectSession[]>) {
  return render(
    <StandaloneSessionContextProvider
      value={{
        servers: [{ name: "srv1", sessionCount: 1 }],
        serversLoaded: true,
        sessionsByServer: sessionsByServer ?? new Map([["srv1", operatorSessions()]]),
      }}
    >
      <QuakeTerminal />
      <QuakeLauncher routeServer={null} />
    </StandaloneSessionContextProvider>,
  );
}

/** The narrow-desktop rung: fine pointer, sub-`lg` width (every query false). */
function stubNarrowDesktop() {
  stubMatchMedia(() => false);
}

/** The wide-desktop rung: the `lg` min-width query matches, nothing else. */
function stubWideDesktop() {
  stubMatchMedia((query) => query === "(min-width: 1024px)");
}

/** The extra-wide rung: the `lg` and `2xl` min-width queries both match. */
function stubExtraWideDesktop() {
  stubMatchMedia((query) => query === "(min-width: 1024px)" || query === "(min-width: 1536px)");
}

describe("QuakeLauncher", () => {
  beforeEach(() => {
    setQuakeMachineState("rest");
    setOperatorComposeText("");
    setOperatorChatSubject(null);
    mockMatches = [{ params: {} }];
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "/tmp/op/.uploads/shot.png" });
    mockOperatorRequest.mockReset();
    mockOperatorRequest.mockResolvedValue({ outcome: "delivered" });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing on mobile", () => {
    stubMatchMedia(() => true);
    renderPair();
    expect(screen.queryByTestId("quake-launcher")).toBeNull();
    expect(screen.queryByTestId("quake-launcher-ghost")).toBeNull();
  });

  it("md–lg rung: the ghost renders at rest, the box hidden until engaged", () => {
    stubNarrowDesktop();
    renderPair();

    expect(screen.getByTestId("quake-launcher-ghost")).toBeInTheDocument();
    expect(screen.getByTestId("quake-launcher").className).toContain("hidden lg:flex");
  });

  it("≥ lg rung: the box stands at rest beside the heading, the ghost is CSS-hidden", () => {
    stubWideDesktop();
    renderPair();

    // The ghost stays mounted (the morph rung shares the component) but is
    // display:none at ≥ lg.
    expect(screen.getByTestId("quake-launcher-ghost").className).toContain("lg:hidden");
    const box = screen.getByTestId("quake-launcher");
    expect(box.className).toContain("hidden lg:flex");
    // Slim at rest below 2xl — the standing box never eats the crumbs'
    // min-useful-width at lg/xl.
    expect(box.className).toContain("w-[12ch]");
    // Fixed height (matches --ctl-h-bar) — must hold identically once engaged,
    // so focus/blur never reflows the top bar.
    expect(box.className).toContain("h-[28px]");
    expect(screen.getByTestId("quake-launcher-input")).toHaveAttribute("placeholder", "Ask…");
  });

  it("≥ 2xl rung: the box takes its full rest width and long placeholder", () => {
    stubExtraWideDesktop();
    renderPair();

    expect(screen.getByTestId("quake-launcher").className).toContain("2xl:w-[20ch]");
    expect(screen.getByTestId("quake-launcher-input")).toHaveAttribute("placeholder", "Ask the operator…");
  });

  it.each([
    ["waiting", "bg-signal-yellow"],
    ["active", "bg-accent-green"],
    ["idle", "bg-text-secondary"],
  ])("the standing glyph maps %s to its live-state dot color", (agentState, colorClass) => {
    stubWideDesktop();
    renderPair(new Map([["srv1", operatorSessions(agentState)]]));

    const dot = screen.getByTestId("quake-launcher-state");
    expect(dot).toHaveAttribute("data-state", agentState);
    expect(dot.className).toContain(colorClass);
    expect(screen.getByTestId("quake-launcher")).toContainElement(dot);
  });

  it("the md–lg ghost carries the same dot and hands it to the collapsed control", () => {
    stubNarrowDesktop();
    renderPair(new Map([["srv1", operatorSessions("active")]]));

    const ghost = screen.getByTestId("quake-launcher-ghost");
    expect(ghost).toContainElement(screen.getByTestId("quake-launcher-state"));
    fireEvent.click(ghost);
    expect(screen.getByTestId("quake-launcher-collapsed")).toContainElement(
      screen.getByTestId("quake-launcher-state"),
    );
  });

  it("renders no state dot when no operator resolves", () => {
    stubWideDesktop();
    renderPair(new Map([["srv1", [{ name: "main", windows: [win({})] }]]]));

    expect(screen.queryByTestId("quake-launcher-state")).toBeNull();
  });

  it("renders no state dot without SessionContext", () => {
    stubWideDesktop();
    render(<QuakeLauncher routeServer="srv1" />);

    expect(screen.getByTestId("quake-launcher")).toBeInTheDocument();
    expect(screen.queryByTestId("quake-launcher-state")).toBeNull();
  });

  it("the ghost click opens the drawer, swaps in the collapsed control, and focus lands in the docked compose", () => {
    stubNarrowDesktop();
    renderPair();

    fireEvent.click(screen.getByTestId("quake-launcher-ghost"));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.queryByTestId("quake-launcher-ghost")).toBeNull();
    expect(screen.queryByTestId("quake-launcher")).toBeNull();
    const collapsed = screen.getByTestId("quake-launcher-collapsed");
    expect(collapsed.className).toContain("h-[28px]");
    expect(screen.getByTestId("quake-terminal-compose-input")).toHaveFocus();
  });

  it("the chord engages from rest — the docked textarea focused with any draft, caret at its end", () => {
    stubWideDesktop();
    renderPair();
    act(() => setOperatorComposeText("half-written draft"));

    act(() => requestQuakeTerminal({ action: "toggle" }));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    const input = screen.getByTestId("quake-terminal-compose-input") as HTMLTextAreaElement;
    expect(input).toHaveFocus();
    expect(input).toHaveValue("half-written draft");
    expect(input.selectionStart).toBe("half-written draft".length);
    expect(input.selectionEnd).toBe("half-written draft".length);
  });

  it("Enter from the standing box sends and opens the drawer; focus lands in the docked compose", async () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("quake-launcher-input");
    fireEvent.change(input, { target: { value: "restart the worker" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "restart the worker", "submit", "agent");
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    const docked = screen.getByTestId("quake-terminal-compose-input");
    expect(docked).toHaveFocus();
    await waitFor(() => expect(docked).toHaveValue(""));
  });

  it("Enter on an empty draft is a no-op (no send, no state change)", () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("quake-launcher-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(getQuakeMachineState()).toBe("rest");
  });

  it("Esc releases to rest: the docked compose blurs and prior focus is restored", () => {
    stubWideDesktop();
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();
    renderPair();

    act(() => requestQuakeTerminal({ action: "toggle" }));
    expect(screen.getByTestId("quake-terminal-compose-input")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getQuakeMachineState()).toBe("rest");
    expect(prior).toHaveFocus();
    prior.remove();
  });

  it("a blur alone never steps the machine — the open drawer outlives the compose's focus", () => {
    stubNarrowDesktop();
    const { unmount } = renderPair();

    fireEvent.click(screen.getByTestId("quake-launcher-ghost"));
    const docked = screen.getByTestId("quake-terminal-compose-input");
    expect(docked).toHaveFocus();
    fireEvent.blur(docked);
    expect(getQuakeMachineState()).toBe("open");
    unmount();

    setQuakeMachineState("rest");
    stubWideDesktop();
    renderPair();
    const wideInput = screen.getByTestId("quake-launcher-input");
    fireEvent.focus(wideInput);
    expect(getQuakeMachineState()).toBe("open");
    const wideDocked = screen.getByTestId("quake-terminal-compose-input");
    fireEvent.blur(wideDocked);
    expect(getQuakeMachineState()).toBe("open");
  });

  // The focus-ownership cases below move focus for REAL (`el.focus()`), unlike
  // the machine-transition cases above: `fireEvent.focus`/`blur` dispatch React
  // synthetic events without moving `document.activeElement`, so the origin
  // capture only ever sees `document.body` under them and the self-restore loop
  // these guard against cannot form.

  it("a mouse-entered box holds the machine open on an outside focus — it never steals focus back", () => {
    stubWideDesktop();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    renderPair();

    // Real click-entry: focus lands on the standing input BEFORE onFocus
    // engages the machine, so the origin capture sees a quake-owned element
    // and records nothing.
    const input = screen.getByTestId("quake-launcher-input") as HTMLInputElement;
    act(() => input.focus());
    expect(getQuakeMachineState()).toBe("open");

    act(() => outside.focus());
    expect(getQuakeMachineState()).toBe("open");
    expect(outside).toHaveFocus();
    expect(screen.getByTestId("quake-terminal-compose-input")).not.toHaveFocus();
    outside.remove();
  });

  it("Esc releases a mouse-entered box instead of re-focusing the launcher", () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("quake-launcher-input") as HTMLInputElement;
    act(() => input.focus());
    expect(getQuakeMachineState()).toBe("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getQuakeMachineState()).toBe("rest");
    // The standing box is back at rest — but with no recorded origin, nothing
    // re-focused it.
    expect(screen.getByTestId("quake-launcher-input")).not.toHaveFocus();
  });

  it("at open the collapsed control stands in for the box, its accent following the compose's focus", () => {
    stubWideDesktop();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    renderPair();

    act(() => requestQuakeTerminal({ action: "open" }));
    expect(getQuakeMachineState()).toBe("open");
    // No input element, no engaged-width box, no launcher-mounted chip at open.
    expect(screen.queryByTestId("quake-launcher-input")).toBeNull();
    expect(screen.queryByTestId("quake-launcher")).toBeNull();
    const collapsed = screen.getByTestId("quake-launcher-collapsed");
    // The docked textarea took focus on open — the engaged accent is lit.
    expect(screen.getByTestId("quake-terminal-compose-input")).toHaveFocus();
    expect(collapsed.className).toContain("border-accent-green");

    act(() => outside.focus());
    // The peek outlives the compose's focus: the machine and the drawer are
    // untouched, only the accent stands down.
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(collapsed.className).toContain("border-border");
    expect(collapsed.className).not.toContain("border-accent-green");
    outside.remove();
  });

  it("the collapsed control's click re-focuses the docked textarea and never reads as an outside click", async () => {
    stubWideDesktop();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    renderPair();

    act(() => requestQuakeTerminal({ action: "open" }));
    act(() => outside.focus());
    expect(screen.getByTestId("quake-terminal-compose-input")).not.toHaveFocus();

    const collapsed = screen.getByTestId("quake-launcher-collapsed");
    // Quake-owned DOM: the drawer's outside-click listener stands down on it.
    expect(isQuakeTerminalTarget(collapsed)).toBe(true);

    fireEvent.click(collapsed);
    expect(screen.getByTestId("quake-terminal-compose-input")).toHaveFocus();
    expect(getQuakeMachineState()).toBe("open");

    // Past the outside-click settle window (a macrotask deferral), the drawer
    // is still open and the compose still focused — the click was never
    // treated as click-away.
    await new Promise((r) => setTimeout(r, 10));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("quake-terminal-compose-input")).toHaveFocus();
    outside.remove();
  });

  it("an image paste uploads to the operator session and insert-stages the path", async () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("quake-launcher-input");
    const file = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(input, { clipboardData: { files: [file] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", file, "@9");
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "/tmp/op/.uploads/shot.png ", "raw", "agent"),
    );
    // Staged as an insert, never submitted — and the paste did not reach the draft.
    expect(input).toHaveValue("");
  });

  it("the wrapper carries the quake-terminal-root attribute (the strip-forward guard skips it)", () => {
    stubWideDesktop();
    renderPair();
    expect(screen.getByTestId("quake-launcher")).toHaveAttribute("data-quake-terminal");
  });
});
