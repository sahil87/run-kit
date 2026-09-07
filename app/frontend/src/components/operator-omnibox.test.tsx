import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { OperatorConsole } from "./operator-console";
import { OperatorOmnibox } from "./operator-omnibox";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import {
  dismissOperatorChatChip,
  getConsoleMachineState,
  requestOperatorConsole,
  setConsoleMachineState,
  setOperatorChatSubject,
  setOperatorComposeText,
} from "@/lib/operator-console";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params the console/omnibox server-context walk reads; the console's
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

function operatorSessions(): ProjectSession[] {
  return [
    { name: "main", windows: [win({ windowId: "@1" })] },
    { name: "_rk-operator", windows: [win({ windowId: "@9", name: "operator", role: "operator" })], hidden: true },
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
      <OperatorConsole />
      <OperatorOmnibox routeServer={null} />
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

describe("OperatorOmnibox", () => {
  beforeEach(() => {
    setConsoleMachineState("rest");
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
    expect(screen.queryByTestId("operator-omnibox")).toBeNull();
    expect(screen.queryByTestId("operator-omnibox-ghost")).toBeNull();
  });

  it("md–lg rung: the ghost renders at rest, the box hidden until engaged", () => {
    stubNarrowDesktop();
    renderPair();

    expect(screen.getByTestId("operator-omnibox-ghost")).toBeInTheDocument();
    expect(screen.getByTestId("operator-omnibox").className).toContain("hidden lg:flex");
  });

  it("≥ lg rung: the box stands at rest beside the heading, the ghost is CSS-hidden", () => {
    stubWideDesktop();
    renderPair();

    // The ghost stays mounted (the morph rung shares the component) but is
    // display:none at ≥ lg.
    expect(screen.getByTestId("operator-omnibox-ghost").className).toContain("lg:hidden");
    const box = screen.getByTestId("operator-omnibox");
    expect(box.className).toContain("hidden lg:flex");
    // Slim at rest below 2xl — the standing box never eats the crumbs'
    // min-useful-width at lg/xl.
    expect(box.className).toContain("w-[12ch]");
    expect(screen.getByTestId("operator-omnibox-input")).toHaveAttribute("placeholder", "Ask ◉…");
  });

  it("≥ 2xl rung: the box takes its full rest width and long placeholder", () => {
    stubExtraWideDesktop();
    renderPair();

    expect(screen.getByTestId("operator-omnibox").className).toContain("2xl:w-[20ch]");
    expect(screen.getByTestId("operator-omnibox-input")).toHaveAttribute("placeholder", "Ask the operator…");
  });

  it("the ghost click morphs the box in place, focuses it, and opens the drawer", () => {
    stubNarrowDesktop();
    renderPair();

    fireEvent.click(screen.getByTestId("operator-omnibox-ghost"));
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.queryByTestId("operator-omnibox-ghost")).toBeNull();
    const box = screen.getByTestId("operator-omnibox");
    expect(box.className).not.toContain("hidden");
    expect(screen.getByTestId("operator-omnibox-input")).toHaveFocus();
  });

  it("the chord engages from rest — box focused with any draft selected, drawer open", () => {
    stubWideDesktop();
    renderPair();
    act(() => setOperatorComposeText("half-written draft"));

    act(() => requestOperatorConsole({ action: "toggle" }));
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
    const input = screen.getByTestId("operator-omnibox-input") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveValue("half-written draft");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("half-written draft".length);
  });

  it("Enter sends through the agent lane and auto-opens the drawer with focus retained", async () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.change(input, { target: { value: "restart the worker" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "restart the worker", "submit", "agent");
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
    expect(input).toHaveFocus();
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("Enter on an empty draft is a no-op (no send, no state change)", () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(getConsoleMachineState()).toBe("rest");
  });

  it("Esc releases to rest: the box blurs and prior focus is restored", () => {
    stubWideDesktop();
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();
    renderPair();

    act(() => requestOperatorConsole({ action: "toggle" }));
    expect(screen.getByTestId("operator-omnibox-input")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getConsoleMachineState()).toBe("rest");
    expect(prior).toHaveFocus();
    prior.remove();
  });

  it("a blur alone never steps the machine — the open drawer outlives the box's focus", () => {
    stubNarrowDesktop();
    const { unmount } = renderPair();

    fireEvent.click(screen.getByTestId("operator-omnibox-ghost"));
    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.blur(input);
    expect(getConsoleMachineState()).toBe("open");
    unmount();

    setConsoleMachineState("rest");
    stubWideDesktop();
    renderPair();
    const wideInput = screen.getByTestId("operator-omnibox-input");
    fireEvent.focus(wideInput);
    expect(getConsoleMachineState()).toBe("open");
    fireEvent.blur(wideInput);
    expect(getConsoleMachineState()).toBe("open");
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

    // Real click-entry: focus lands on the input BEFORE onFocus engages the
    // machine, which is what used to poison the restore origin with the box.
    const input = screen.getByTestId("operator-omnibox-input") as HTMLInputElement;
    act(() => input.focus());
    expect(getConsoleMachineState()).toBe("open");

    act(() => outside.focus());
    expect(getConsoleMachineState()).toBe("open");
    expect(outside).toHaveFocus();
    expect(input).not.toHaveFocus();
    outside.remove();
  });

  it("Esc releases a mouse-entered box instead of re-focusing it", () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input") as HTMLInputElement;
    act(() => input.focus());
    expect(getConsoleMachineState()).toBe("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getConsoleMachineState()).toBe("rest");
    expect(input).not.toHaveFocus();
  });

  it("at open, an outside focus stands the box chrome down but leaves the drawer open", () => {
    stubWideDesktop();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    renderPair();

    act(() => requestOperatorConsole({ action: "open" }));
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-omnibox").className).toContain("w-[34ch]");

    act(() => outside.focus());
    // The peek outlives the box's focus: the machine and the drawer are
    // untouched, only the chrome stands down.
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-console")).toBeInTheDocument();
    const box = screen.getByTestId("operator-omnibox");
    expect(box.className).toContain("w-[12ch]");
    expect(box.className).toContain("border-border");
    expect(screen.queryByTestId("operator-console-context")).toBeNull();
    outside.remove();
  });

  it("an image paste uploads to the operator session and insert-stages the path", async () => {
    stubWideDesktop();
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
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

  it("the wrapper carries the console-root attribute (the strip-forward guard skips it)", () => {
    stubWideDesktop();
    renderPair();
    expect(screen.getByTestId("operator-omnibox")).toHaveAttribute("data-operator-console");
  });
});

describe("OperatorOmnibox (templated chat lane)", () => {
  beforeEach(() => {
    stubMatchMedia((query) => query === "(min-width: 1024px)");
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    setOperatorChatSubject(null);
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockOperatorRequest.mockReset();
    mockOperatorRequest.mockResolvedValue({ outcome: "delivered" });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the chip's ✕ still lands — a within-box focus move never stands the chrome down", () => {
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input") as HTMLInputElement;
    act(() => input.focus());
    const dismiss = screen.getByRole("button", { name: "Detach window context" });

    // The real dismissal sequence: focus leaves the input FOR the ✕, then the
    // click lands. If that blur stood the chrome down, the chip would unmount
    // in between and the click would never reach it.
    act(() => dismiss.focus());
    expect(screen.getByTestId("operator-console-context")).toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(screen.queryByTestId("operator-console-context")).toBeNull();
  });

  it("on a terminal route the engaged box shows the chip and Enter rides the templated lane", async () => {
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.focus(input);
    expect(screen.getByTestId("operator-console-context")).toHaveTextContent('from: @1 "win"');

    fireEvent.change(input, { target: { value: "can you check the failing test?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockOperatorRequest).toHaveBeenCalledTimes(1));
    expect(mockOperatorRequest).toHaveBeenCalledWith("srv1", "@1", "user-message", "can you check the failing test?");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("dismissing the chip drops the envelope — the next send rides the direct lane", async () => {
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("button", { name: "Detach window context" }));
    expect(screen.queryByTestId("operator-console-context")).toBeNull();

    fireEvent.change(input, { target: { value: "plain message" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "plain message", "submit", "agent");
    expect(mockOperatorRequest).not.toHaveBeenCalled();
  });

  it("the chip resets to attached when the console re-engages", async () => {
    renderPair();

    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("button", { name: "Detach window context" }));
    expect(screen.queryByTestId("operator-console-context")).toBeNull();

    // Esc releases to rest (the console's document listener); the engagement
    // ends only once the exit slide finishes (the drawer unmounts — mid-slide
    // the console still counts as engaged). The next chord re-engages the
    // machine and re-attaches the chip.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(getConsoleMachineState()).toBe("rest");
    await waitFor(() => expect(screen.queryByTestId("operator-console")).toBeNull());
    act(() => requestOperatorConsole({ action: "toggle" }));
    expect(getConsoleMachineState()).toBe("open");
    expect(screen.getByTestId("operator-console-context")).toBeInTheDocument();
  });
});
