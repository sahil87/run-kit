import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { OperatorConsole } from "./operator-console";
import { OperatorOmnibox } from "./operator-omnibox";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import {
  getConsoleMachineState,
  requestOperatorConsole,
  setConsoleMachineState,
  setOperatorComposeText,
} from "@/lib/operator-console";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params the console/omnibox server-context walk reads.
let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
}));

vi.mock("@/components/terminal-client", () => ({
  TerminalClient: () => <div data-testid="embedded-terminal" />,
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

describe("OperatorOmnibox", () => {
  beforeEach(() => {
    setConsoleMachineState("rest");
    setOperatorComposeText("");
    mockMatches = [{ params: {} }];
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
    expect(screen.getByTestId("operator-omnibox-input")).toHaveAttribute("placeholder", "Ask the operator…");
  });

  it("the ghost click morphs the box in place and focuses it", () => {
    stubNarrowDesktop();
    renderPair();

    fireEvent.click(screen.getByTestId("operator-omnibox-ghost"));
    expect(getConsoleMachineState()).toBe("focused");
    expect(screen.queryByTestId("operator-omnibox-ghost")).toBeNull();
    const box = screen.getByTestId("operator-omnibox");
    expect(box.className).not.toContain("hidden");
    expect(screen.getByTestId("operator-omnibox-input")).toHaveFocus();
  });

  it("the chord focuses the box from rest and selects any draft", () => {
    stubWideDesktop();
    renderPair();
    act(() => setOperatorComposeText("half-written draft"));

    act(() => requestOperatorConsole({ action: "toggle" }));
    expect(getConsoleMachineState()).toBe("focused");
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

  it("Esc at focused returns to rest: the box blurs and prior focus is restored", () => {
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

  it("an empty-draft blur at the morph rung restores the heading (rest)", () => {
    stubNarrowDesktop();
    renderPair();

    fireEvent.click(screen.getByTestId("operator-omnibox-ghost"));
    const input = screen.getByTestId("operator-omnibox-input");
    expect(input).toHaveFocus();

    fireEvent.blur(input);
    expect(getConsoleMachineState()).toBe("rest");
    expect(screen.getByTestId("operator-omnibox-ghost")).toBeInTheDocument();
  });

  it("a blur with a live draft HOLDS the morph at the narrow rung but releases the standing box", () => {
    stubNarrowDesktop();
    const { unmount } = renderPair();

    fireEvent.click(screen.getByTestId("operator-omnibox-ghost"));
    const input = screen.getByTestId("operator-omnibox-input");
    fireEvent.change(input, { target: { value: "keep me" } });
    fireEvent.blur(input);
    expect(getConsoleMachineState()).toBe("focused");
    unmount();

    setConsoleMachineState("rest");
    setOperatorComposeText("keep me");
    stubWideDesktop();
    renderPair();
    const wideInput = screen.getByTestId("operator-omnibox-input");
    fireEvent.focus(wideInput);
    expect(getConsoleMachineState()).toBe("focused");
    fireEvent.blur(wideInput);
    expect(getConsoleMachineState()).toBe("rest");
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
