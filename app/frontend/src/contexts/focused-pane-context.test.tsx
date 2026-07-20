import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useMemo } from "react";
import {
  FocusedPaneProvider,
  useFocusedPane,
  useRegisterFocusedPane,
  type FocusedPane,
} from "./focused-pane-context";

/** Read-side probe — renders the registered pane's identifying fields. */
function PaneView() {
  const pane = useFocusedPane();
  return (
    <span data-testid="pane">
      {pane ? `${pane.server}:${pane.windowId}:${pane.windowName}:${pane.panes.length}` : "null"}
    </span>
  );
}

/** A minimal registering page. Publishes a memoized pane on mount, clears on
 *  unmount (via the hook's effect cleanup). */
function Registrant({ server, windowId }: { server: string; windowId: string }) {
  const pane = useMemo<FocusedPane>(
    () => ({
      server,
      windowId,
      windowName: "win",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/tmp", command: "zsh", isActive: true },
      ],
    }),
    [server, windowId],
  );
  useRegisterFocusedPane(pane);
  return null;
}

/** A registering page publishing `null` (empty board while mounted). */
function NullRegistrant() {
  useRegisterFocusedPane(null);
  return null;
}

describe("FocusedPaneContext", () => {
  afterEach(cleanup);

  it("defaults to null when no page has registered", () => {
    render(
      <FocusedPaneProvider>
        <PaneView />
      </FocusedPaneProvider>,
    );
    expect(screen.getByTestId("pane").textContent).toBe("null");
  });

  it("useRegisterFocusedPane publishes the page's focused pane into the read hook", () => {
    render(
      <FocusedPaneProvider>
        <Registrant server="rk" windowId="@3" />
        <PaneView />
      </FocusedPaneProvider>,
    );
    expect(screen.getByTestId("pane").textContent).toBe("rk:@3:win:1");
  });

  it("a mounted page may publish null (empty board)", () => {
    render(
      <FocusedPaneProvider>
        <NullRegistrant />
        <PaneView />
      </FocusedPaneProvider>,
    );
    expect(screen.getByTestId("pane").textContent).toBe("null");
  });

  it("clears the pane back to null when the registering page unmounts", () => {
    const { rerender } = render(
      <FocusedPaneProvider>
        <Registrant server="rk" windowId="@3" />
        <PaneView />
      </FocusedPaneProvider>,
    );
    expect(screen.getByTestId("pane").textContent).toBe("rk:@3:win:1");
    act(() => {
      rerender(
        <FocusedPaneProvider>
          <PaneView />
        </FocusedPaneProvider>,
      );
    });
    expect(screen.getByTestId("pane").textContent).toBe("null");
  });

  it("is last-writer-wins — a re-registered pane overwrites the prior value", () => {
    const { rerender } = render(
      <FocusedPaneProvider>
        <Registrant server="alpha" windowId="@1" />
        <PaneView />
      </FocusedPaneProvider>,
    );
    expect(screen.getByTestId("pane").textContent).toBe("alpha:@1:win:1");
    act(() => {
      rerender(
        <FocusedPaneProvider>
          <Registrant server="beta" windowId="@2" />
          <PaneView />
        </FocusedPaneProvider>,
      );
    });
    expect(screen.getByTestId("pane").textContent).toBe("beta:@2:win:1");
  });

  it("useFocusedPane throws outside the provider", () => {
    const Bad = () => {
      useFocusedPane();
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/FocusedPaneProvider/);
  });

  it("useRegisterFocusedPane throws outside the provider", () => {
    const Bad = () => {
      useRegisterFocusedPane(null);
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/FocusedPaneProvider/);
  });
});
