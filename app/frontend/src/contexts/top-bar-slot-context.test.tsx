import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useMemo } from "react";
import {
  TopBarSlotProvider,
  useTopBarSlot,
  useTopBarNotFound,
  useRegisterTopBarSlot,
  useSignalTopBarNotFound,
  type TopBarSlot,
} from "./top-bar-slot-context";

/** Read-side probe — renders the registered slot's identifying fields. */
function SlotView() {
  const slot = useTopBarSlot();
  return (
    <span data-testid="slot">
      {slot ? `${slot.server}:${slot.sessionName}:${slot.isConnected}` : "null"}
    </span>
  );
}

/** A minimal registering page. Publishes a memoized slot on mount, clears on
 *  unmount (via the hook's effect cleanup). */
function Registrant({ server, isConnected }: { server: string; isConnected: boolean }) {
  const slot = useMemo<NonNullable<TopBarSlot>>(
    () => ({
      sessions: [],
      currentSession: null,
      currentWindow: null,
      sessionName: "",
      windowName: "",
      isConnected,
      sidebarOpen: false,
      server,
      onNavigate: () => {},
      onToggleSidebar: () => {},
      onCreateSession: () => {},
      onCreateWindow: () => {},
    }),
    [server, isConnected],
  );
  useRegisterTopBarSlot(slot);
  return null;
}

describe("TopBarSlotContext", () => {
  afterEach(cleanup);

  it("defaults to null when no page has registered", () => {
    render(
      <TopBarSlotProvider>
        <SlotView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("slot").textContent).toBe("null");
  });

  it("useRegisterTopBarSlot publishes the page's props into the read hook", () => {
    render(
      <TopBarSlotProvider>
        <Registrant server="rk" isConnected={true} />
        <SlotView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("slot").textContent).toBe("rk::true");
  });

  it("clears the slot back to null when the registering page unmounts", () => {
    const { rerender } = render(
      <TopBarSlotProvider>
        <Registrant server="rk" isConnected={false} />
        <SlotView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("slot").textContent).toBe("rk::false");
    act(() => {
      rerender(
        <TopBarSlotProvider>
          <SlotView />
        </TopBarSlotProvider>,
      );
    });
    expect(screen.getByTestId("slot").textContent).toBe("null");
  });

  it("is last-writer-wins — a re-registered slot overwrites the prior value", () => {
    const { rerender } = render(
      <TopBarSlotProvider>
        <Registrant server="alpha" isConnected={true} />
        <SlotView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("slot").textContent).toBe("alpha::true");
    act(() => {
      rerender(
        <TopBarSlotProvider>
          <Registrant server="beta" isConnected={false} />
          <SlotView />
        </TopBarSlotProvider>,
      );
    });
    expect(screen.getByTestId("slot").textContent).toBe("beta::false");
  });

  it("useTopBarSlot throws outside the provider", () => {
    const Bad = () => {
      useTopBarSlot();
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/TopBarSlotProvider/);
  });

  it("useSignalTopBarNotFound flips the notFound flag on mount and clears on unmount", () => {
    const NotFoundView = () => {
      const notFound = useTopBarNotFound();
      return <span data-testid="nf">{notFound ? "true" : "false"}</span>;
    };
    const NotFoundSignaller = () => {
      useSignalTopBarNotFound();
      return null;
    };
    const { rerender } = render(
      <TopBarSlotProvider>
        <NotFoundSignaller />
        <NotFoundView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("nf").textContent).toBe("true");
    act(() => {
      rerender(
        <TopBarSlotProvider>
          <NotFoundView />
        </TopBarSlotProvider>,
      );
    });
    expect(screen.getByTestId("nf").textContent).toBe("false");
  });

  it("notFound defaults to false when nothing has signalled", () => {
    const NotFoundView = () => {
      const notFound = useTopBarNotFound();
      return <span data-testid="nf">{notFound ? "true" : "false"}</span>;
    };
    render(
      <TopBarSlotProvider>
        <NotFoundView />
      </TopBarSlotProvider>,
    );
    expect(screen.getByTestId("nf").textContent).toBe("false");
  });

  it("useSignalTopBarNotFound / useTopBarNotFound throw outside the provider", () => {
    const BadSignal = () => {
      useSignalTopBarNotFound();
      return null;
    };
    const BadRead = () => {
      useTopBarNotFound();
      return null;
    };
    expect(() => render(<BadSignal />)).toThrow(/TopBarSlotProvider/);
    expect(() => render(<BadRead />)).toThrow(/TopBarSlotProvider/);
  });

  it("useRegisterTopBarSlot throws outside the provider", () => {
    const Bad = () => {
      useRegisterTopBarSlot({
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        isConnected: false,
        sidebarOpen: false,
        server: "",
        onNavigate: () => {},
        onToggleSidebar: () => {},
        onCreateSession: () => {},
        onCreateWindow: () => {},
      });
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/TopBarSlotProvider/);
  });
});
