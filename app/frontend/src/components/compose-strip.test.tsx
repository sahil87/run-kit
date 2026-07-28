import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ComposeStrip } from "./compose-strip";
import {
  FocusedTerminalProvider,
  useFocusedTerminal,
  type FocusedTerminal,
} from "@/contexts/focused-terminal-context";
import { ChromeProvider, useChromeState } from "@/contexts/chrome-context";
import { useWindowStore, entryKey } from "@/store/window-store";
import type { UploadedFile } from "@/hooks/use-file-upload";
import { clearComposeDraft } from "@/lib/compose-draft-store";
import { focusComposeStrip } from "@/lib/compose-strip-events";

// Mock useFileUpload so tests never hit the network. The mock records calls and
// returns deterministic paths so the re-home path-rewrite can be asserted.
const uploadFilesMock = vi.fn<(files: FileList | File[]) => Promise<UploadedFile[]>>();
vi.mock("@/hooks/use-file-upload", async (orig) => {
  const actual = await orig<typeof import("@/hooks/use-file-upload")>();
  return {
    ...actual,
    useFileUpload: () => ({ uploadFiles: uploadFilesMock, uploading: false }),
  };
});

/** Fake WebSocket-shaped adapter that records sends. */
function makeWs(open = true) {
  const sent: string[] = [];
  const ws = {
    readyState: open ? WebSocket.OPEN : WebSocket.CLOSED,
    send: (data: string) => sent.push(data),
    close: vi.fn(),
  } as unknown as WebSocket;
  return { ref: { current: ws } as React.RefObject<WebSocket | null>, sent };
}

/** Test harness: renders ComposeStrip plus a button that sets the focused
 * terminal to a supplied value, so tests can drive focus changes. */
function Harness({ focus }: { focus: FocusedTerminal }) {
  return (
    <ChromeProvider>
      <FocusedTerminalProvider>
        <FocusSetter focus={focus} />
        <ComposeStrip />
      </FocusedTerminalProvider>
    </ChromeProvider>
  );
}

function FocusSetter({ focus }: { focus: FocusedTerminal }) {
  const { setFocused } = useFocusedTerminal();
  return (
    <button data-testid="set-focus" onClick={() => setFocused(focus)}>
      set-focus
    </button>
  );
}

function seedWindow(server: string, windowId: string, name: string) {
  useWindowStore.setState((s) => {
    const entries = new Map(s.entries);
    entries.set(entryKey(server, windowId), {
      server,
      session: "sess",
      windowId,
      index: 0,
      name,
      killed: false,
      createdAt: 0,
      panes: [],
    });
    return { entries };
  });
}

const input = () => screen.getByTestId("compose-strip-input") as HTMLTextAreaElement;
const sendBtn = () => screen.getByTestId("compose-strip-send") as HTMLButtonElement;
const insertBtn = () => screen.getByTestId("compose-strip-insert") as HTMLButtonElement;

/** Re-stub matchMedia so `(pointer: coarse)` matches (or not) — drives the
 * pointer-aware Enter policy + `enterkeyhint` (260719-mxvw). Must run BEFORE
 * render (the hook reads the initial value at mount). */
function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("ComposeStrip", () => {
  beforeEach(() => {
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
    // The draft lives in a module store shared across the whole test module —
    // reset it so a leftover draft from a prior test never bleeds in.
    clearComposeDraft();
    uploadFilesMock.mockReset();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders a disabled 'no target' state when nothing is focused", () => {
    render(<Harness focus={null} />);
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("no target");
    expect(input().disabled).toBe(true);
    expect(sendBtn().disabled).toBe(true);
  });

  // Two-row stack (260724-2bmy): the textarea gets the whole first row at a
  // 2-line default (desktop too, explicit user direction), with 📎/Insert/Send
  // on their own row below — previously all four shared one flex row and the
  // input got ~half the width at 375px.
  it("stacks a 2-line default textarea above a separate button row", () => {
    render(<Harness focus={null} />);
    expect(input()).toHaveAttribute("rows", "2");
    // The buttons no longer share the textarea's flex row…
    expect(sendBtn().parentElement).not.toBe(input().parentElement);
    // …but Insert and Send still sit together (right-aligned cluster).
    expect(insertBtn().parentElement).toBe(sendBtn().parentElement);
  });

  it("shows the focused window name as the target label", () => {
    seedWindow("srv", "@1", "my-window");
    render(<Harness focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("my-window");
  });

  it("falls back to the windowId as the label when the store has no name", () => {
    // No seedWindow — the store has no entry for this target, so the label uses
    // the raw windowId.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@7" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("@7");
  });

  it("falls back to the registered windowName when the store has no entry", () => {
    // No seedWindow — board panes from servers the sidebar hasn't delivered
    // sessions for have no store entry; the registration-time name covers them.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter
            focus={{
              wsRef: makeWs().ref,
              server: "srv",
              session: "sess",
              windowId: "@7",
              windowName: "board-win",
            }}
          />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("board-win");
  });

  it("prefers the live store name over the registered windowName", () => {
    // The store tracks renames; a registration-time name may be stale.
    seedWindow("srv", "@1", "renamed-win");
    render(
      <Harness
        focus={{
          wsRef: makeWs().ref,
          server: "srv",
          session: "sess",
          windowId: "@1",
          windowName: "stale-name",
        }}
      />,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("renamed-win");
  });

  it("Enter sends text + trailing carriage return to the focused wsRef", () => {
    const { ref, sent } = makeWs();
    seedWindow("srv", "@1", "win");
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "hello" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual(["hello\r"]);
    // Textarea clears after send; strip stays.
    expect(input().value).toBe("");
    expect(screen.getByTestId("compose-strip")).toBeInTheDocument();
  });

  it("Shift+Enter does NOT send (inserts a newline via default behavior)", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "line1" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", shiftKey: true }));
    expect(sent).toEqual([]);
  });

  it("empty / whitespace-only Enter is a no-op", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "   " } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual([]);
  });

  it("Enter during IME composition does not send", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "hi" } }));
    // isComposing rides the native event; fireEvent.keyDown forwards it.
    act(() => fireEvent.keyDown(input(), { key: "Enter", isComposing: true }));
    expect(sent).toEqual([]);
  });

  // ── Pointer-aware Enter + insert-without-submit (260719-mxvw) ──────────────

  it("coarse pointer: plain Enter does NOT send (textarea default newline)", () => {
    stubPointer(true);
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "touch draft" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual([]);
    // The draft stays (Enter was not intercepted — no send, no clear).
    expect(input().value).toBe("touch draft");
    // The Send button still submits.
    act(() => fireEvent.click(sendBtn()));
    expect(sent).toEqual(["touch draft\r"]);
  });

  it("Cmd/Ctrl+Enter submits on BOTH pointer types (universal escape hatch)", () => {
    for (const coarse of [false, true]) {
      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        stubPointer(coarse);
        const { ref, sent } = makeWs();
        const view = render(
          <ChromeProvider>
            <FocusedTerminalProvider>
              <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
              <ComposeStrip />
            </FocusedTerminalProvider>
          </ChromeProvider>,
        );
        act(() => fireEvent.click(screen.getByTestId("set-focus")));
        act(() => fireEvent.change(input(), { target: { value: "chord" } }));
        act(() => fireEvent.keyDown(input(), { key: "Enter", ...mod }));
        expect(sent).toEqual(["chord\r"]);
        expect(input().value).toBe("");
        view.unmount();
      }
    }
  });

  it("Alt+Enter inserts WITHOUT the trailing carriage return and clears the draft", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "stage me" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", altKey: true }));
    expect(sent).toEqual(["stage me"]); // raw bytes, no \r
    expect(input().value).toBe(""); // same clear-on-delivery as submit
  });

  it("the Insert button sends without \\r, mirrors Send's disabled state", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // Empty draft: Insert is disabled exactly like Send.
    expect(insertBtn().disabled).toBe(true);
    expect(sendBtn().disabled).toBe(true);
    act(() => fireEvent.change(input(), { target: { value: "via button" } }));
    expect(insertBtn().disabled).toBe(false);
    act(() => fireEvent.click(insertBtn()));
    expect(sent).toEqual(["via button"]); // no trailing \r
    expect(input().value).toBe("");
  });

  it("a guard-blocked insert (stream not OPEN) preserves the draft", () => {
    const { ref, sent } = makeWs(false); // CLOSED
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "keep insert" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", altKey: true }));
    expect(sent).toEqual([]);
    expect(input().value).toBe("keep insert");
  });

  it("enterkeyhint states the truth: 'send' on fine pointers, 'enter' on coarse", () => {
    // Fine (default stub): Enter submits → hint is "send".
    const fine = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    expect(input().getAttribute("enterkeyhint")).toBe("send");
    fine.unmount();

    // Coarse: Enter inserts a newline → hint is the default "enter" action.
    stubPointer(true);
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    expect(input().getAttribute("enterkeyhint")).toBe("enter");
  });

  it("does not steal focus on mount", () => {
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    // The strip textarea must not be the active element on mount.
    expect(document.activeElement).not.toBe(input());
  });

  it("Escape blurs the textarea (does not remove the strip)", () => {
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => input().focus());
    expect(document.activeElement).toBe(input());
    act(() => fireEvent.keyDown(input(), { key: "Escape" }));
    expect(document.activeElement).not.toBe(input());
    expect(screen.getByTestId("compose-strip")).toBeInTheDocument();
  });

  it("re-homes a pending attachment and rewrites its textarea path line on focus change", async () => {
    // First upload (attach) lands at /wt-a/.uploads/x.png; the re-home upload
    // (after focus change) returns /wt-b/.uploads/x.png.
    uploadFilesMock
      .mockResolvedValueOnce([{ path: "/wt-a/.uploads/x.png", file: new File(["x"], "x.png", { type: "image/png" }) }])
      .mockResolvedValueOnce([{ path: "/wt-b/.uploads/x.png", file: new File(["x"], "x.png", { type: "image/png" }) }]);

    function TwoTargets() {
      const { setFocused } = useFocusedTerminal();
      return (
        <>
          <button data-testid="focus-a" onClick={() => setFocused({ wsRef: makeWs().ref, server: "srv", session: "sa", windowId: "@a" })}>a</button>
          <button data-testid="focus-b" onClick={() => setFocused({ wsRef: makeWs().ref, server: "srv", session: "sb", windowId: "@b" })}>b</button>
          <ComposeStrip />
        </>
      );
    }
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <TwoTargets />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    // Focus A, then attach a file via the hidden input.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    const file = new File(["x"], "x.png", { type: "image/png" });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(hiddenInput, { target: { files: [file] } });
    });
    expect(input().value).toContain("/wt-a/.uploads/x.png");

    // Focus B — the strip re-uploads the held file to B's worktree and rewrites
    // the path line.
    await act(async () => {
      fireEvent.click(screen.getByTestId("focus-b"));
    });
    expect(uploadFilesMock).toHaveBeenCalledTimes(2);
    expect(input().value).toContain("/wt-b/.uploads/x.png");
    expect(input().value).not.toContain("/wt-a/.uploads/x.png");
  });

  // ── Rework coverage (260718-dhdj): module-store draft persistence ──────────

  it("preserves the unsent draft across a toggle-off/on (unmount → remount)", () => {
    // Simulates the compose preference toggling off (strip unmounts) then back
    // on (strip remounts). The draft lives in the module store, so an unmount
    // must NOT destroy it.
    const { unmount } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "half-typed" } }));

    // Toggle off: the strip unmounts.
    unmount();
    expect(screen.queryByTestId("compose-strip")).toBeNull();

    // Toggle on: a FRESH strip mounts (new component instance / different footer)
    // and must show the retained draft.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    expect(input().value).toBe("half-typed");
  });

  it("preserves the draft across a route change (two separate strip mounts)", () => {
    // The terminal route and the board route mount the strip in SEPARATE
    // footers — a route change unmounts one and mounts the other. Modeled here
    // as two independent renders sharing the module store.
    const { unmount } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "route-draft" } }));
    unmount();

    // The "board route" mounts its own strip instance.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    expect(input().value).toBe("route-draft");
  });

  it("a guard-blocked send (stream not OPEN) preserves the draft", () => {
    // wsRef is CLOSED → the readyState guard blocks the send. The draft must be
    // preserved (early-return before clearing), not silently discarded.
    const { ref, sent } = makeWs(false); // CLOSED
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "keep-me" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual([]); // nothing delivered
    expect(input().value).toBe("keep-me"); // draft preserved
  });

  it("clears the draft only after a delivered send", () => {
    const { ref, sent } = makeWs(true); // OPEN
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "deliver" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual(["deliver\r"]);
    expect(input().value).toBe(""); // cleared after delivery
  });

  it("clears the focused terminal on board-pane unmount (stale-target guard)", () => {
    // Models BoardPane's unmount cleanup: a component that registers itself as
    // the focused terminal on mount and clears it on unmount iff still the
    // registered one (mirrors BoardPane / terminal-client.tsx:139). After
    // unmount the strip must fall back to the disabled "no target" state.
    const wsRef = { current: null } as React.RefObject<WebSocket | null>;
    function FakeBoardPane() {
      const { focused, setFocused } = useFocusedTerminal();
      const focusedRef = useRef(focused);
      focusedRef.current = focused;
      useEffect(() => {
        setFocused({ wsRef, server: "srv", session: "sess", windowId: "@board" });
        return () => {
          if (focusedRef.current?.wsRef === wsRef) setFocused(null);
        };
      }, [setFocused]);
      return null;
    }

    seedWindow("srv", "@board", "board-win");
    // The pane's presence is toggled WITHOUT remounting the provider or the
    // strip — exactly the "leave the board, stay on the same provider" case the
    // cleanup guards. If the pane did not clear on unmount, the strip would keep
    // the stale "board-win" target.
    function Tree({ paneMounted }: { paneMounted: boolean }) {
      return (
        <ChromeProvider>
          <FocusedTerminalProvider>
            {paneMounted && <FakeBoardPane />}
            <ComposeStrip />
          </FocusedTerminalProvider>
        </ChromeProvider>
      );
    }
    const { rerender } = render(<Tree paneMounted />);
    // While the pane is mounted the strip is targeted (enabled).
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("board-win");
    expect(input().disabled).toBe(false);

    // Unmount only the pane (leave the board) — the provider + strip stay. The
    // strip must revert to the disabled "no target" state.
    rerender(<Tree paneMounted={false} />);
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("no target");
    expect(input().disabled).toBe(true);
  });

  // ── On-strip × close button (260722-d5q7) ──────────────────────────────────

  /** Mirrors the production gating (`{composeStripEnabled && <ComposeStrip />}`
   * in app.tsx / board-page.tsx): the strip mounts only while the chrome
   * preference is on, so clicking the header-row × (which fires the real
   * `toggleComposeStrip` from the real ChromeProvider) unmounts it. */
  function GatedStrip() {
    const { composeStripEnabled } = useChromeState();
    return composeStripEnabled ? <ComposeStrip /> : null;
  }

  function GatedHarness({ focus }: { focus: FocusedTerminal }) {
    return (
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={focus} />
          <GatedStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>
    );
  }

  it("the header-row × closes the strip via toggleComposeStrip; the draft survives close→reopen", () => {
    // Seed the preference ON so the gated strip mounts (readComposeStrip reads
    // localStorage at provider mount).
    localStorage.setItem("runkit-compose-strip", "true");
    render(<GatedHarness focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));

    // The × renders in the strip with its accessible name.
    const close = screen.getByTestId("compose-strip-close");
    expect(close).toBe(screen.getByRole("button", { name: "Close compose strip" }));

    // Type a draft, then close via the ×: the strip unmounts (preference off)…
    act(() => fireEvent.change(input(), { target: { value: "before-close" } }));
    act(() => fireEvent.click(close));
    expect(screen.queryByTestId("compose-strip")).toBeNull();
    expect(localStorage.getItem("runkit-compose-strip")).toBe("false");

    // …and reopening (same toggle, e.g. the `>_` chip) restores the strip with
    // the draft intact — closing is lossless, no confirmation needed.
    localStorage.setItem("runkit-compose-strip", "true");
    render(<GatedHarness focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />);
    expect(input().value).toBe("before-close");
  });

  it("the × does not steal focus (mousedown is default-prevented)", () => {
    render(<Harness focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // fireEvent returns false when preventDefault() was called — the strip's
    // no-focus-steal invariant (same contract as 📎 / Insert / Send).
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.mouseDown(screen.getByTestId("compose-strip-close"));
    });
    expect(notPrevented).toBe(false);
  });

  it("focusComposeStrip focuses the mounted textarea and declines when no target", () => {
    // The touch ⌨ button focuses the strip via the module focus registry, not a
    // DOM test-id query. A mounted-with-target strip focuses and returns true.
    const { unmount } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    let took = false;
    act(() => {
      took = focusComposeStrip();
    });
    expect(took).toBe(true);
    expect(document.activeElement).toBe(input());

    unmount();
    // No strip mounted → the registry declines so the caller falls back to the
    // terminal.
    expect(focusComposeStrip()).toBe(false);
  });
});
