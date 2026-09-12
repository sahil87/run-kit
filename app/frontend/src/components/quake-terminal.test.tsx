import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor, within } from "@testing-library/react";
import { QuakeTerminal, QuakeTerminalTongue } from "./quake-terminal";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import {
  dismissOperatorChatChip,
  getQuakeMachineState,
  getOperatorChatTarget,
  requestQuakeTerminal,
  setQuakeMachineState,
  setOperatorChatSubject,
  setOperatorComposeText,
  writeQuakeOpacity,
} from "@/lib/quake-terminal";
import { getComposeDraft, hydrateComposeDrafts } from "@/lib/compose-draft-store";
import { stubMatchMedia } from "@/test-utils/match-media";
import type { ProjectSession, WindowInfo } from "@/types";

// Route params and search the quake terminal's server-context walk and `?from=`
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

// The cron segments mount the real CronList/CronLog; their cron fetch is
// mocked out here (controllable shape) so no request fires from these tests.
const mockCronData = vi.hoisted(() => ({
  current: {
    entries: [] as import("@/api/client").CronEntry[],
    deliveries: [] as import("@/api/client").CronDelivery[],
  },
}));
vi.mock("@/hooks/use-cron", () => ({
  useCronData: () => mockCronData.current,
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

function renderQuake(opts: {
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
      <QuakeTerminal />
    </StandaloneSessionContextProvider>
  );
  return render(opts.withToasts ? <ToastProvider>{tree}</ToastProvider> : tree);
}

/** Tests that need the drawer open unconditionally dispatch the palette
 *  action's `open` (the chord toggles). */
function openDrawer() {
  act(() => {
    requestQuakeTerminal({ action: "open" });
  });
}

function stepMachine() {
  act(() => {
    requestQuakeTerminal({ action: "toggle" });
  });
}

describe("QuakeTerminal", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setQuakeMachineState("rest");
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

  it("the chord toggles the desktop machine rest → open → rest", async () => {
    renderQuake();
    expect(screen.queryByTestId("quake-terminal")).toBeNull();

    // Step 1: open — focus and drawer are linked, nothing sent.
    stepMachine();
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();

    // Step 2: rest — the exit slide holds the mount until transitionend (or
    // the fallback timeout — jsdom fires no transition events).
    stepMachine();
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());
    expect(getQuakeMachineState()).toBe("rest");
  });

  it.each(["toggle", "open"] as const)(
    "keeps the desktop machine at rest and shows a hint for %s on the operator route",
    (action) => {
      mockMatches = [{ params: { server: "srv1", window: "@9" } }];
      renderQuake({ withToasts: true });

      act(() => requestQuakeTerminal({ action }));

      expect(getQuakeMachineState()).toBe("rest");
      expect(screen.queryByTestId("quake-terminal")).toBeNull();
      expect(screen.getByText("already viewing the operator — nothing to open")).toBeVisible();
    },
  );

  it("throttles repeated already-on-operator hints to one toast per lifetime", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    renderQuake({ withToasts: true });

    for (const action of ["toggle", "open"] as const) {
      act(() => requestQuakeTerminal({ action }));
    }

    expect(screen.getAllByText("already viewing the operator — nothing to open")).toHaveLength(1);
    expect(getQuakeMachineState()).toBe("rest");
  });

  it("gates explicit server and send details before they mutate quake terminal state", async () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    renderQuake({
      servers: ["srv1", "srv2"],
      sessionsByServer: new Map([
        ["srv1", operatorSessions()],
        [
          "srv2",
          [
            { name: "main", windows: [win({ windowId: "@1" })] },
            {
              name: "_rk-operator",
              hidden: true,
              windows: [win({ windowId: "@7", name: "operator-b", role: "operator" })],
            },
          ],
        ],
      ]),
    });

    act(() => {
      requestQuakeTerminal({ action: "open", server: "srv2", send: "must stay pending nowhere" });
    });
    act(() => setQuakeMachineState("open"));

    await screen.findByTestId("quake-terminal");
    expect(terminalMounts.at(-1)).toMatchObject({ server: "srv1", windowId: "@9" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockOperatorRequest).not.toHaveBeenCalled();
  });

  it.each(["toggle", "open"] as const)(
    "preserves the desktop %s behavior away from the operator route",
    (action) => {
      mockMatches = [{ params: { server: "srv1", window: "@1" } }];
      renderQuake();

      act(() => requestQuakeTerminal({ action }));

      expect(getQuakeMachineState()).toBe("open");
      expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    },
  );

  it("one Esc releases the machine: open → rest", async () => {
    renderQuake();
    openDrawer();
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(getQuakeMachineState()).toBe("rest");
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());
  });

  it("stays mounted with the raised class through the exit slide", async () => {
    renderQuake();
    openDrawer();
    await screen.findByTestId("quake-terminal");

    fireEvent.keyDown(document, { key: "Escape" });
    const el = screen.getByTestId("quake-terminal");
    expect(el.className).toContain("rk-quake-slide");
    expect(el.className).toContain("rk-quake-closed");

    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());
  });

  it("reduced motion closes instantly — no mounted-through-exit delay", () => {
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    renderQuake();
    openDrawer();
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
  });

  it("a click outside the quake terminal's DOM collapses the open drawer to rest", async () => {
    renderQuake();
    openDrawer();
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();

    fireEvent.click(document.body);
    // The collapse is deferred past a settle timeout — not synchronous.
    await waitFor(() => expect(getQuakeMachineState()).toBe("rest"));
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());
  });

  it("a click inside the drawer does not collapse it", async () => {
    renderQuake();
    openDrawer();
    const drawer = screen.getByTestId("quake-terminal");

    fireEvent.click(drawer);
    await new Promise((r) => setTimeout(r, 10));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
  });

  it("a real DOM click on an outside trigger that re-opens/retargets the quake terminal wins over the outside-click collapse", async () => {
    renderQuake();
    openDrawer();

    function RetargetButton() {
      return (
        <button
          type="button"
          onClick={() => requestQuakeTerminal({ action: "open", server: "srv1" })}
        >
          retarget
        </button>
      );
    }
    render(<RetargetButton />);
    fireEvent.click(screen.getByRole("button", { name: "retarget" }));

    // The trigger's own click handler re-asserts "open" (bumping machine
    // activity even though the value is unchanged) during the SAME click's
    // bubble phase, which the outside-collapse's capture-phase snapshot ran
    // ahead of — the deferred settle check sees activity moved and backs off.
    await new Promise((r) => setTimeout(r, 10));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
  });

  it("a click that opens an unrelated dialog does not collapse the quake terminal", async () => {
    renderQuake();
    openDrawer();

    function DialogTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          {open && (
            <div role="dialog" data-testid="fake-settings-dialog">
              settings
            </div>
          )}
        </>
      );
    }
    render(<DialogTrigger />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    // The dialog mounts (React commits) before the settle timeout fires;
    // the settle check finds it and skips the collapse.
    await screen.findByTestId("fake-settings-dialog");
    await new Promise((r) => setTimeout(r, 10));
    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
  });

  it("the desktop drawer is output-only — no compose strip, status line at its top edge", async () => {
    renderQuake();
    openDrawer();
    const el = await screen.findByTestId("quake-terminal");

    expect(screen.queryByLabelText("Message the operator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(el.querySelector("textarea")).toBeNull();
  });

  it("targets the route's server on a terminal route (no picker)", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    openDrawer();

    expect(screen.queryByRole("combobox", { name: "Operator server" })).toBeNull();
    expect(terminalMounts[0]).toMatchObject({ server: "srv1", windowId: "@9", sessionName: "_rk-operator" });
  });

  it("preselects the sole server on the Host route without a picker", () => {
    renderQuake();
    openDrawer();

    expect(screen.queryByRole("combobox", { name: "Operator server" })).toBeNull();
    expect(terminalMounts[0]?.server).toBe("srv1");
  });

  it("offers a server picker on the Host route with multiple servers and retargets on change", () => {
    renderQuake({
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
    renderQuake({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    openDrawer();

    expect(screen.getByTestId("quake-terminal-empty")).toHaveTextContent(
      "no operator on this server — run rk operator",
    );
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
    expect(screen.queryByLabelText("Message the operator")).toBeNull();
  });

  it("opens without crashing on an empty (still-loading) server list", () => {
    renderQuake({ servers: [], sessionsByServer: new Map() });
    openDrawer();

    expect(screen.getByTestId("quake-terminal-empty")).toBeInTheDocument();
    expect(terminalMounts).toHaveLength(0);
  });

  it("renders the operator window's live agent state in the title strip", () => {
    renderQuake({
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

    expect(screen.getByTestId("quake-terminal-state")).toHaveTextContent("waiting 2m");
  });

  it("the palette fallback request opens the quake terminal and sends the query immediately", async () => {
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", send: "find the stuck deploy" });
    });

    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "find the stuck deploy", "submit", "agent");
  });

  it("a fallback send against an operator-less server is dropped (the hint is the answer)", async () => {
    renderQuake({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    act(() => {
      requestQuakeTerminal({ action: "open", send: "anything at all" });
    });

    expect(screen.getByTestId("quake-terminal-empty")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a failed fallback send renders the error at the drawer's top edge", async () => {
    mockSend.mockRejectedValue(new Error("probe failed: no novelty echo"));
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", send: "retry me" });
    });

    await waitFor(() =>
      expect(screen.getByTestId("quake-terminal-error")).toHaveTextContent("probe failed: no novelty echo"),
    );
  });

  it("a fallback send fired in the same commit as a re-open reads the post-reset chip state", async () => {
    // Reduced motion so the close is instant — the send below must not wait
    // out an exit slide.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    openDrawer();

    // Dismiss, then close — the dismissal is still live store state here.
    act(() => dismissOperatorChatChip());
    act(() => setQuakeMachineState("rest"));
    expect(screen.queryByTestId("quake-terminal")).toBeNull();

    // Re-open via the Ask-operator fallback: the reset effect and the
    // pendingSend delivery land in the same commit — the send must read the
    // post-reset store, riding the templated lane.
    act(() => {
      requestQuakeTerminal({ action: "open", send: "still broken" });
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
    renderQuake();
    openDrawer();
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();

    act(() => {
      mql.matches = true;
      for (const fn of [...listeners]) fn();
    });

    expect(getQuakeMachineState()).toBe("rest");
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
  });

  it("applies the glass background at the stored opacity and drops the blur at α=1", async () => {
    renderQuake();
    openDrawer();
    const el = await screen.findByTestId("quake-terminal");

    expect(el.style.backgroundColor).toContain("color-mix(in srgb, var(--color-bg-primary) 90%");
    expect(el.style.backdropFilter).toBe("blur(6px)");

    act(() => writeQuakeOpacity(1));
    expect(el.style.backdropFilter).toBe("");
    expect(el.style.backgroundColor).toContain("100%");
  });

  it("dragging the height grip resizes the drawer and persists the geometry on release", async () => {
    renderQuake();
    openDrawer();
    const el = await screen.findByTestId("quake-terminal");
    expect(el.style.height).toBe("55vh");

    const grip = screen.getByTestId("quake-terminal-grip-height");
    // A full-viewport drag overshoots the clamp: the height pins at 85vh.
    fireEvent.pointerDown(grip, { button: 0, clientX: 100, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 100, clientY: 300 + window.innerHeight, pointerId: 1 });
    expect(el.style.height).toBe("85vh");
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(JSON.parse(localStorage.getItem("runkit-quake-terminal-geometry")!)).toMatchObject({
      heightVh: 85,
    });
  });

  it("dragging a side grip resizes symmetrically and persists the width", async () => {
    renderQuake();
    openDrawer();
    const el = await screen.findByTestId("quake-terminal");

    const grip = screen.getByTestId("quake-terminal-grip-right");
    fireEvent.pointerDown(grip, { button: 0, clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 550, clientY: 100, pointerId: 1 });
    // +50px on the right edge = +100px total (the drawer stays centered).
    expect(el.style.width).toBe("860px");
    fireEvent.pointerUp(grip, { pointerId: 1 });

    expect(JSON.parse(localStorage.getItem("runkit-quake-terminal-geometry")!)).toMatchObject({
      widthPx: 860,
    });
  });

  it("file paste inside the drawer uploads to the operator session and insert-delivers the path", async () => {
    renderQuake();
    openDrawer();
    const root = await screen.findByTestId("quake-terminal");

    const file = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(root, { clipboardData: { files: [file] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", file, "@9");
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "/tmp/op/.uploads/shot.png ", "raw", "agent"),
    );
  });

  it("file paste on an operator-less server is a no-op", async () => {
    renderQuake({ sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]) });
    openDrawer();
    const root = await screen.findByTestId("quake-terminal");

    fireEvent.paste(root, { clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("an upload failure surfaces on the inline error line and delivers nothing", async () => {
    mockUpload.mockRejectedValue(new Error("upload exploded"));
    renderQuake();
    openDrawer();
    const root = await screen.findByTestId("quake-terminal");

    fireEvent.paste(root, { clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });

    await waitFor(() =>
      expect(screen.getByTestId("quake-terminal-error")).toHaveTextContent("upload exploded"),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a file drop inside the drawer uploads to the operator session", async () => {
    renderQuake();
    openDrawer();
    const root = await screen.findByTestId("quake-terminal");

    const file = new File(["png"], "shot.png", { type: "image/png" });
    const proceeded = fireEvent.drop(root, { dataTransfer: { files: [file], types: ["Files"] } });

    expect(proceeded).toBe(false);
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", file, "@9");
  });

  it("a non-file drop inside the drawer is canceled (no browser navigation) and uploads nothing", async () => {
    renderQuake();
    openDrawer();
    const root = await screen.findByTestId("quake-terminal");

    const proceeded = fireEvent.drop(root, { dataTransfer: { files: [], types: ["text/uri-list"] } });

    expect(proceeded).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe("QuakeTerminal (cron segments)", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setQuakeMachineState("rest");
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
    mockCronData.current = { entries: [], deliveries: [] };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function listTab() {
    return within(screen.getByTestId("terminal-activity-tabs")).getByRole("tab", { name: "Cron List" });
  }
  function logTab() {
    return within(screen.getByTestId("terminal-activity-tabs")).getByRole("tab", { name: "Cron Log" });
  }
  function terminalTab() {
    return within(screen.getByTestId("terminal-activity-tabs")).getByRole("tab", { name: "Operator Terminal" });
  }

  it("the desktop drawer renders the four segments in order with Operator Terminal selected", () => {
    renderQuake();
    openDrawer();

    const strip = screen.getByTestId("terminal-activity-tabs");
    expect(strip).toHaveAttribute("role", "tablist");
    expect(within(strip).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Operator Terminal",
      "Operator Tasks",
      "Cron List",
      "Cron Log",
    ]);
    expect(terminalTab()).toHaveAttribute("aria-selected", "true");
    expect(listTab()).toHaveAttribute("aria-selected", "false");
    expect(logTab()).toHaveAttribute("aria-selected", "false");
  });

  it("selecting a cron tab mounts its body and unmounts the terminal; Operator Terminal reverses it", () => {
    renderQuake();
    openDrawer();
    expect(screen.getByTestId("embedded-terminal")).toBeInTheDocument();

    fireEvent.click(listTab());
    expect(screen.getByTestId("cron-list")).toBeInTheDocument();
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();

    fireEvent.click(logTab());
    expect(screen.getByTestId("cron-log")).toBeInTheDocument();
    expect(screen.queryByTestId("cron-list")).toBeNull();

    fireEvent.click(terminalTab());
    expect(screen.getByTestId("embedded-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("cron-log")).toBeNull();
  });

  it("an open request carrying segment: log opens the drawer on the Cron Log segment", () => {
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "log" });
    });

    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(logTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("cron-log")).toBeInTheDocument();
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
  });

  it("an open request carrying segment: list opens the drawer on the Cron List segment", () => {
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "list" });
    });

    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(listTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("cron-list")).toBeInTheDocument();
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
  });

  it("segment: log on the operator route bypasses the already-viewing toast and opens the drawer", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    renderQuake({ withToasts: true });

    act(() => {
      requestQuakeTerminal({ action: "open", segment: "log" });
    });

    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(logTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("already viewing the operator — nothing to open")).toBeNull();
  });

  it("Escape inside the inline entry sheet returns to the list without collapsing the drawer", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockCronData.current = {
      entries: [
        {
          id: "a3f9",
          name: "operator tick",
          schedule: { kind: "backoff", min: "60s", max: "30m" },
          target: { kind: "role", role: "operator" },
          payload: "tick",
          lastFired: 0,
          muted: false,
          pinned: false,
          nextFire: nowSec + 300,
        },
      ],
      deliveries: [],
    };
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "list" });
    });

    fireEvent.click(screen.getByTestId("cron-list-row-a3f9"));
    expect(screen.getByTestId("cron-entry-sheet")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("cron-entry-sheet")).toBeNull();
    expect(screen.getByTestId("cron-list")).toBeInTheDocument();
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(getQuakeMachineState()).toBe("open");
  });

  it("closing the drawer and re-opening with a plain request resets to the Operator Terminal segment", async () => {
    // Reduced motion so the close is instant — no exit-slide wait.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "log" });
    });
    expect(logTab()).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());

    openDrawer();
    expect(terminalTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("cron-log")).toBeNull();
  });

  it("the title strip carries the tick-age stamp from the first session with operatorLastTickAt > 0", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    renderQuake({
      sessionsByServer: new Map([
        [
          "srv1",
          [
            { name: "main", windows: [win({})], operatorLastTickAt: nowSec - 90 },
            { name: "_rk-operator", windows: [OPERATOR_WINDOW], hidden: true },
          ],
        ],
      ]),
    });
    openDrawer();

    const tick = screen.getByTestId("quake-terminal-tick");
    expect(tick).toHaveTextContent("· tick 1m ago");
    expect(tick.className).toContain("text-text-secondary");
  });

  it("a stale operator loop renders the tick stamp yellow with the ⚠ prefix", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    renderQuake({
      sessionsByServer: new Map([
        [
          "srv1",
          [
            { name: "main", windows: [win({})], operatorLastTickAt: nowSec - 120, operatorStale: true },
            { name: "_rk-operator", windows: [OPERATOR_WINDOW], hidden: true },
          ],
        ],
      ]),
    });
    openDrawer();

    const tick = screen.getByTestId("quake-terminal-tick");
    expect(tick).toHaveTextContent("⚠ · tick 2m ago");
    expect(tick.className).toContain("text-signal-yellow");
  });

  it("no tick stamp renders when no session carries operatorLastTickAt > 0", () => {
    renderQuake({
      sessionsByServer: new Map([
        [
          "srv1",
          [
            { name: "main", windows: [win({})], operatorLastTickAt: 0 },
            { name: "_rk-operator", windows: [OPERATOR_WINDOW], hidden: true },
          ],
        ],
      ]),
    });
    openDrawer();

    expect(screen.queryByTestId("quake-terminal-tick")).toBeNull();
  });
});

describe("QuakeTerminal (tasks segment)", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setQuakeMachineState("rest");
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

  function tasksTab() {
    return within(screen.getByTestId("terminal-activity-tabs")).getByRole("tab", { name: "Operator Tasks" });
  }
  function terminalTab() {
    return within(screen.getByTestId("terminal-activity-tabs")).getByRole("tab", { name: "Operator Terminal" });
  }

  const WATCHED_SESSIONS: ProjectSession[] = [
    {
      name: "main",
      windows: [
        win({ windowId: "@1" }),
        win({
          windowId: "@2",
          name: "worker",
          monitored: true,
          monitoredChange: "wuiu",
          monitoredStage: "review",
          monitoredRepo: "/home/user/code/run-kit",
          agentState: "waiting",
          agentIdleDuration: "6m",
        }),
      ],
    },
    { name: "_rk-operator", windows: [OPERATOR_WINDOW], hidden: true },
  ];

  it("selecting Operator Tasks mounts the watchlist and unmounts the terminal; Operator Terminal reverses it", () => {
    renderQuake({ sessionsByServer: new Map([["srv1", WATCHED_SESSIONS]]) });
    openDrawer();
    expect(screen.getByTestId("embedded-terminal")).toBeInTheDocument();

    fireEvent.click(tasksTab());
    expect(screen.getByTestId("watched-tasks")).toBeInTheDocument();
    expect(screen.getAllByTestId("watched-row")).toHaveLength(1);
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();

    fireEvent.click(terminalTab());
    expect(screen.getByTestId("embedded-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("watched-tasks")).toBeNull();
  });

  it("an open request carrying segment: tasks opens the drawer on the Operator Tasks segment", () => {
    renderQuake({ sessionsByServer: new Map([["srv1", WATCHED_SESSIONS]]) });
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });

    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(tasksTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("watched-tasks")).toBeInTheDocument();
    expect(screen.queryByTestId("embedded-terminal")).toBeNull();
  });

  it("segment: tasks on the operator route bypasses the already-viewing toast and opens the drawer", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    renderQuake({ withToasts: true });

    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });

    expect(getQuakeMachineState()).toBe("open");
    expect(screen.getByTestId("quake-terminal")).toBeInTheDocument();
    expect(tasksTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("already viewing the operator — nothing to open")).toBeNull();
  });

  it("closing the drawer and re-opening with a plain request resets to the Operator Terminal segment", async () => {
    // Reduced motion so the close is instant — no exit-slide wait.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });
    expect(tasksTab()).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());

    openDrawer();
    expect(terminalTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("watched-tasks")).toBeNull();
  });

  it("a watched-row click navigates to the window's terminal route and collapses the drawer", async () => {
    renderQuake({ sessionsByServer: new Map([["srv1", WATCHED_SESSIONS]]) });
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });
    expect(screen.getByTestId("watched-tasks")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("watched-row-navigate"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@2" },
      search: {},
    });
    expect(getQuakeMachineState()).toBe("rest");
    await waitFor(() => expect(screen.queryByTestId("quake-terminal")).toBeNull());
  });
});

describe("QuakeTerminal (mobile navigation)", () => {
  beforeEach(() => {
    stubMatchMedia(() => true);
    setQuakeMachineState("rest");
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

  it("a quake terminal request navigates to the operator window's terminal route — no sheet mounts", () => {
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: {},
    });
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
    expect(getQuakeMachineState()).toBe("rest");
  });

  it("both actions collapse to the same navigation", () => {
    renderQuake();
    for (const action of ["toggle", "open"] as const) {
      act(() => {
        requestQuakeTerminal({ action });
      });
    }

    expect(mockNavigate).toHaveBeenCalledTimes(2);
    for (const call of mockNavigate.mock.calls) {
      expect(call[0]).toMatchObject({ params: { server: "srv1", window: "@9" }, search: {} });
    }
  });

  it("navigating from a terminal route carries the origin window as ?from=", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "toggle" });
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
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "toggle" });
    });

    // No navigate: a replace would have dropped the route's `?from=` (and
    // with it the context chip).
    expect(mockNavigate).not.toHaveBeenCalled();

    // A fallback query still seeds the draft without navigating.
    act(() => {
      requestQuakeTerminal({ action: "open", send: "still broken" });
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getComposeDraft("srv1:@9").text).toBe("still broken");
  });

  it("an explicit server request navigates to that server's operator route", () => {
    renderQuake({
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
      requestQuakeTerminal({ action: "open", server: "srv2" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv2", window: "@7" },
      search: {},
    });
  });

  it("the palette fallback query seeds the operator route's compose draft instead of auto-sending", async () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", send: "find the stuck deploy" });
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

  it("a segment: list request navigates with search.tab = list, merged with the ?from= origin", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "list" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: { from: "@1", tab: "list" },
    });
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
  });

  it("already on the operator route, segment: log updates the tab search param in place", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "log" });
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe(".");
    expect(call.replace).toBe(true);
    // The updater merges over the existing search — the ?from= survives.
    expect(call.search({ from: "@1" })).toEqual({ from: "@1", tab: "log" });
  });

  it("a segment: tasks request navigates with search.tab = tasks, merged with the ?from= origin", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: { from: "@1", tab: "tasks" },
    });
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
  });

  it("already on the operator route, segment: tasks updates the tab search param in place", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderQuake();
    act(() => {
      requestQuakeTerminal({ action: "open", segment: "tasks" });
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe(".");
    expect(call.replace).toBe(true);
    // The updater merges over the existing search — the ?from= survives.
    expect(call.search({ from: "@1" })).toEqual({ from: "@1", tab: "tasks" });
  });

  it("an operator-less server toasts the hint once and never navigates", () => {
    renderQuake({
      withToasts: true,
      sessionsByServer: new Map([["srv1", [{ name: "main", windows: [win({})] }]]]),
    });
    act(() => {
      requestQuakeTerminal({ action: "toggle" });
    });
    act(() => {
      requestQuakeTerminal({ action: "open" });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    // Repeated activations within one toast lifetime do not stack.
    expect(screen.getAllByText("no operator on this server — run rk operator")).toHaveLength(1);
  });
});

describe("QuakeTerminalTongue", () => {
  beforeEach(() => {
    setQuakeMachineState("rest");
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
        <QuakeTerminal />
        <QuakeTerminalTongue />
      </StandaloneSessionContextProvider>,
    );
  }

  it("is the standing affordance on mobile: a tap navigates to the operator route", () => {
    stubMatchMedia(() => true);
    renderTongue();

    fireEvent.click(screen.getByTestId("quake-terminal-tongue"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "srv1", window: "@9" },
      search: {},
    });
    expect(screen.queryByTestId("quake-terminal")).toBeNull();
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

    const tongue = screen.getByTestId("quake-terminal-tongue");
    expect(tongue).toHaveAttribute("data-tongue-state", "return");
    expect(screen.queryByTestId("quake-terminal-tongue-waiting")).toBeNull();
  });

  it("return tap navigates to the validated ?from= origin window", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderTongue();

    fireEvent.click(screen.getByTestId("quake-terminal-tongue"));

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

    fireEvent.click(screen.getByTestId("quake-terminal-tongue"));

    expect(mockHistoryBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("return tap with no ?from= and no back entry lands on the server route", () => {
    stubMatchMedia(() => true);
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    vi.stubGlobal("history", { length: 1 });
    renderTongue();

    fireEvent.click(screen.getByTestId("quake-terminal-tongue"));

    expect(mockHistoryBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "srv1" } });
  });

  it("hides when no operator window resolves on the server", () => {
    stubMatchMedia(() => true);
    renderTongue([{ name: "main", windows: [win({})] }]);

    expect(screen.queryByTestId("quake-terminal-tongue")).toBeNull();
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
    expect(screen.getByTestId("quake-terminal-tongue-waiting")).toBeInTheDocument();
  });

  it("renders nothing on desktop", () => {
    stubMatchMedia(() => false);
    renderTongue();
    expect(screen.queryByTestId("quake-terminal-tongue")).toBeNull();
  });
});

describe("QuakeTerminal (chat subject stamping)", () => {
  beforeEach(() => {
    stubMatchMedia(() => false);
    setQuakeMachineState("rest");
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
    renderQuake();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1", name: "win" });
  });

  it("on the operator window's own route the validated ?from= origin is stamped instead", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "@1" };
    renderQuake();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1" });
  });

  it("the numeric segment form of ?from= resolves like the path parse", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    mockSearch = { from: "1" };
    renderQuake();

    expect(getOperatorChatTarget("srv1")).toMatchObject({ server: "srv1", windowId: "@1" });
  });

  it("an absent, unknown, or self ?from= on the operator route stamps no subject", () => {
    mockMatches = [{ params: { server: "srv1", window: "@9" } }];
    for (const from of [undefined, "@42", "@9"]) {
      setOperatorChatSubject(null);
      mockSearch = from === undefined ? {} : { from };
      const { unmount } = renderQuake();
      expect(getOperatorChatTarget("srv1")).toBeNull();
      unmount();
    }
  });

  it("a stamped subject does not cross servers", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake();

    expect(getOperatorChatTarget("srv2")).toBeNull();
  });

  it("a pinned cross-server retarget does not attach the route's window", () => {
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    renderQuake({
      servers: ["srv1", "srv2"],
      sessionsByServer: new Map([
        ["srv1", operatorSessions()],
        ["srv2", operatorSessions()],
      ]),
    });
    act(() => {
      requestQuakeTerminal({ action: "open", server: "srv2" });
    });

    expect(getOperatorChatTarget("srv1")).toBeNull();
    expect(getOperatorChatTarget("srv2")).toBeNull();
  });

  it("a subject change re-attaches a dismissed chip; re-engaging the quake terminal does too", () => {
    // Reduced motion so the desktop exit is instant — `engaged` only leaves
    // true once the drawer has actually unmounted (the exit slide otherwise
    // holds it), and re-engagement is the edge this test exercises.
    stubMatchMedia((query) => query === "(prefers-reduced-motion: reduce)");
    mockMatches = [{ params: { server: "srv1", window: "@1" } }];
    const view = renderQuake();
    openDrawer();
    act(() => dismissOperatorChatChip());
    expect(getOperatorChatTarget("srv1")).toBeNull();

    // Close and re-open: the machine leaving rest re-attaches.
    act(() => setQuakeMachineState("rest"));
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
        <QuakeTerminal />
      </StandaloneSessionContextProvider>,
    );
    expect(getOperatorChatTarget("srv1")?.windowId).toBe("@2");
  });

  it("no subject is stamped on a route without a window", () => {
    renderQuake();

    expect(getOperatorChatTarget("srv1")).toBeNull();
  });
});
