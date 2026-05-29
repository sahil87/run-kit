import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { FocusedTerminalProvider, useFocusedTerminal } from "./focused-terminal-context";

function FocusedView() {
  const { focused } = useFocusedTerminal();
  return (
    <span data-testid="focused">
      {focused ? `${focused.server}/${focused.session}/${focused.windowId}` : "null"}
    </span>
  );
}

function Producer({
  server,
  session,
  windowId,
}: {
  server: string;
  session: string;
  windowId: string;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const { setFocused } = useFocusedTerminal();
  useEffect(() => {
    setFocused({ wsRef, server, session, windowId });
    return () => setFocused(null);
  }, [setFocused, server, session, windowId]);
  return null;
}

describe("FocusedTerminalContext", () => {
  afterEach(cleanup);

  it("defaults to null", () => {
    render(
      <FocusedTerminalProvider>
        <FocusedView />
      </FocusedTerminalProvider>,
    );
    expect(screen.getByTestId("focused").textContent).toBe("null");
  });

  it("setFocused updates the consumed value", () => {
    render(
      <FocusedTerminalProvider>
        <Producer server="rk" session="dev" windowId="0" />
        <FocusedView />
      </FocusedTerminalProvider>,
    );
    expect(screen.getByTestId("focused").textContent).toBe("rk/dev/0");
  });

  it("useFocusedTerminal throws outside the provider", () => {
    // Render without provider — the hook should throw on read.
    const Bad = () => {
      useFocusedTerminal();
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/FocusedTerminalProvider/);
  });

  it("unmount of producer clears the focused state via setFocused(null)", () => {
    const { rerender } = render(
      <FocusedTerminalProvider>
        <Producer server="rk" session="dev" windowId="0" />
        <FocusedView />
      </FocusedTerminalProvider>,
    );
    expect(screen.getByTestId("focused").textContent).toBe("rk/dev/0");
    act(() => {
      rerender(
        <FocusedTerminalProvider>
          <FocusedView />
        </FocusedTerminalProvider>,
      );
    });
    expect(screen.getByTestId("focused").textContent).toBe("null");
  });
});
