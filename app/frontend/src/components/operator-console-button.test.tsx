import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OperatorConsoleButton } from "./top-bar-overflow-menu";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { OPERATOR_CONSOLE_EVENT, isOperatorConsoleRequest } from "@/lib/operator-console";
import type { OperatorConsoleRequest } from "@/lib/operator-console";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

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

function renderButton(sessions: ProjectSession[]) {
  return render(
    <StandaloneSessionContextProvider
      value={{
        servers: [{ name: "srv1", sessionCount: 1 }],
        serversLoaded: true,
        sessionsByServer: new Map([["srv1", sessions]]),
      }}
    >
      <OperatorConsoleButton routeServer="srv1" />
    </StandaloneSessionContextProvider>,
  );
}

function operatorSessions(agentState?: string): ProjectSession[] {
  return [
    { name: "main", windows: [win({})] },
    {
      name: "_rk-operator",
      hidden: true,
      windows: [win({ windowId: "@9", name: "operator", role: "operator", agentState })],
    },
  ];
}

describe("OperatorConsoleButton", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("dispatches the console toggle event on click", () => {
    const seen: OperatorConsoleRequest[] = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (isOperatorConsoleRequest(detail)) seen.push(detail);
    };
    document.addEventListener(OPERATOR_CONSOLE_EVENT, listener);
    renderButton(operatorSessions("idle"));

    fireEvent.click(screen.getByTestId("operator-console-button"));
    expect(seen).toEqual([{ action: "toggle" }]);
    document.removeEventListener(OPERATOR_CONSOLE_EVENT, listener);
  });

  it("names itself with the chord in the aria label", () => {
    renderButton(operatorSessions("idle"));
    // The registry default for operator-console is a ⌘J/⇧Ctrl+J-tier binding —
    // the exact glyph is host-dependent, so assert the stable prefix.
    expect(screen.getByRole("button", { name: /^Operator console/ })).toBeInTheDocument();
  });

  it("shows the live agent-state dot (grey idle / green active / amber waiting)", () => {
    const { unmount } = renderButton(operatorSessions("waiting"));
    expect(screen.getByTestId("operator-console-button-state").className).toContain("bg-signal-yellow");
    unmount();

    const second = renderButton(operatorSessions("active"));
    expect(screen.getByTestId("operator-console-button-state").className).toContain("bg-accent-green");
    second.unmount();

    renderButton(operatorSessions("idle"));
    expect(screen.getByTestId("operator-console-button-state").className).toContain("bg-text-secondary");
  });

  it("renders with no dot when the resolved server has no operator", () => {
    renderButton([{ name: "main", windows: [win({})] }]);
    expect(screen.getByTestId("operator-console-button")).toBeInTheDocument();
    expect(screen.queryByTestId("operator-console-button-state")).toBeNull();
  });
});
