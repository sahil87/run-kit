import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef, StrictMode } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ComposeStrip } from "./compose-strip";
import {
  FocusedTerminalProvider,
  useFocusedTerminal,
  type FocusedTerminal,
} from "@/contexts/focused-terminal-context";
import { ChromeProvider, useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useWindowStore, entryKey } from "@/store/window-store";
import type { UploadedFile } from "@/hooks/use-file-upload";
import { stubMatchMedia } from "@/test-utils/match-media";
import {
  getComposeSentHistory,
  hydrateComposeDrafts,
  hydrateComposeSentHistory,
  pushComposeSentHistory,
} from "@/lib/compose-draft-store";
import {
  consumeComposeStripFocusOnOpen,
  focusComposeStrip,
  isComposeStripFocused,
  setComposeStripFocused,
} from "@/lib/compose-strip-events";
import { BottomBar } from "./bottom-bar";

// Mock useFileUpload so tests never hit the network. The mock records calls and
// returns deterministic paths so attachment path lines can be asserted.
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

/** Re-stub matchMedia so `(pointer: coarse)` matches (or not) — used to prove
 * the Enter policy and `enterkeyhint` are pointer-INDEPENDENT (260802-lj98:
 * Enter is insert-line in the strip on every pointer type). Must run BEFORE
 * render (the hook reads the initial value at mount). */
function stubPointer(coarse: boolean) {
  stubMatchMedia((query) => coarse && query === "(pointer: coarse)");
}

/** A frozen cross-server recipient set, and the draft key it derives (sorted
 * keys — the strip's `selectionDraftKey`), for the broadcast-mode tests. */
const SELECTION_KEYS = ["srv:@1", "other:@2"];
const SELECTION_DRAFT_KEY = 'selection:["other:@2","srv:@1"]';

/** Render the strip in selection-broadcast mode with no focused terminal. */
function renderSelection(onSend: (text: string) => Promise<number>) {
  return render(
    <ChromeProvider>
      <FocusedTerminalProvider>
        <ComposeStrip selectionTarget={{ keys: SELECTION_KEYS, onSend }} />
      </FocusedTerminalProvider>
    </ChromeProvider>,
  );
}

describe("ComposeStrip", () => {
  beforeEach(() => {
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
    // Drafts live in a per-target module store shared across the whole test
    // module and persisted to localStorage — wipe the storage and re-run the
    // real hydration so a leftover draft from a prior test never bleeds in.
    localStorage.clear();
    hydrateComposeDrafts();
    // Same for the sibling sent-history store — a leftover history would make
    // an ↑ recall in a fresh test see a prior test's sends.
    hydrateComposeSentHistory();
    // Drain the module-level focus-on-open flag so a prior test's toggle can
    // never leak focus behavior into the next one.
    consumeComposeStripFocusOnOpen();
    // Same for the module-level compose-focus flag (260814-ink6) — a stuck
    // `true` would hide the bottom bar in a later test.
    setComposeStripFocused(false);
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

  it("renders a text-only selection target with the frozen recipient count", () => {
    renderSelection(vi.fn().mockResolvedValue(2));

    expect(screen.getByTestId("compose-strip-target")).toHaveTextContent(
      "2 selected",
    );
    expect(input()).toBeEnabled();
    expect(input()).toHaveAttribute(
      "aria-label",
      "Compose prompt to send to selection",
    );
    // Broadcast Enter is a local newline, so the mobile action key must not
    // promise a send (the terminal-target strip keeps enterkeyhint="send").
    expect(input()).toHaveAttribute("enterkeyhint", "enter");
    expect(insertBtn()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled();
    expect(sendBtn()).toBeDisabled();
  });

  it("submits a non-empty selection prompt once and ignores insert modes", async () => {
    const onSend = vi.fn().mockResolvedValue(2);
    renderSelection(onSend);

    fireEvent.change(input(), { target: { value: "run tests\nand report" } });
    fireEvent.keyDown(input(), { key: "Enter", code: "Enter", altKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(input()).toHaveValue("run tests\nand report");

    await act(async () => {
      fireEvent.click(sendBtn());
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("run tests\nand report");
    expect(input()).toHaveValue("");
  });

  // The broadcast has no visible pane composer to stage a line into, so it
  // takes the chat surface's Enter policy. Plain Enter must not be swallowed
  // into a dead key (consumed by the strip's insert-line branch, then dropped
  // by the submit-only guard) — it stays a native newline.
  it("plain Enter in broadcast mode is a native newline, never a dead key or a send", async () => {
    const onSend = vi.fn().mockResolvedValue(1);
    renderSelection(onSend);

    fireEvent.change(input(), { target: { value: "first line" } });
    // fireEvent returns false when preventDefault() was called.
    let notPrevented = false;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key: "Enter", code: "Enter" });
    });
    expect(notPrevented).toBe(true); // fell through to the textarea
    expect(onSend).not.toHaveBeenCalled();
    expect(input()).toHaveValue("first line");

    // Cmd/Ctrl+Enter remains the sole submit chord in broadcast mode.
    await act(async () => {
      fireEvent.keyDown(input(), { key: "Enter", code: "Enter", metaKey: true });
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("first line");
  });

  it("keeps the composed prompt when the broadcast reached NO recipient (0 of N)", async () => {
    const onSend = vi.fn().mockResolvedValue(0);
    renderSelection(onSend);

    fireEvent.change(input(), { target: { value: "retry me" } });
    await act(async () => {
      fireEvent.click(sendBtn());
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledOnce();
    // Nothing was delivered, so the text stays composed for the retry — and it
    // is NOT recorded as sent history (nothing was sent).
    expect(input()).toHaveValue("retry me");
    expect(sendBtn()).toBeEnabled();
    expect(getComposeSentHistory(SELECTION_DRAFT_KEY)).toEqual([]);
  });

  it("clears the prompt on a PARTIAL delivery (some recipients got it)", async () => {
    const onSend = vi.fn().mockResolvedValue(1);
    renderSelection(onSend);

    fireEvent.change(input(), { target: { value: "partly through" } });
    await act(async () => {
      fireEvent.click(sendBtn());
      await Promise.resolve();
    });

    expect(input()).toHaveValue("");
    expect(getComposeSentHistory(SELECTION_DRAFT_KEY)).toEqual([
      "partly through",
    ]);
  });

  it("uses a recipient-set draft instead of the focused terminal's draft", () => {
    const ws = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter
            focus={{
              wsRef: ws.ref,
              containerRef: { current: null },
              server: "srv",
              session: "sess",
              windowId: "@1",
            }}
          />
          <ComposeStrip
            selectionTarget={{
              keys: SELECTION_KEYS,
              onSend: vi.fn().mockResolvedValue(2),
            }}
          />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    fireEvent.change(input(), { target: { value: "broadcast draft" } });

    expect(screen.getByTestId("compose-strip-target")).toHaveTextContent(
      "2 selected",
    );
    expect(ws.sent).toEqual([]);
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

  // Placeholder education (260811-ke2s): the placeholder teaches the strip's
  // Enter policy — mode-aware (terminal vs selection broadcast), pointer-aware
  // (chord hints never render on coarse pointers), and the sole surfacing of
  // ↑ sent-history recall. jsdom's platform resolves "other" (no mac UA), so
  // the submit keycap is `Ctrl+Enter` here.
  it("educates via placeholder on a terminal target (fine pointer): Enter inserts · keycap sends · ↑ history", () => {
    stubPointer(false);
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input().placeholder).toBe(
      "Compose text — Enter inserts · Ctrl+Enter sends · ↑ history",
    );
  });

  it("educates via placeholder in selection broadcast (fine pointer): keycap sends to all selected", () => {
    stubPointer(false);
    renderSelection(vi.fn().mockResolvedValue(2));
    expect(input().placeholder).toBe(
      "Compose prompt — Ctrl+Enter sends to all selected",
    );
  });

  it("folds the target into the placeholder on a coarse pointer (260814-ink6 — the header row is folded away)", () => {
    stubPointer(true);
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // No store seed → the label layering falls back to the raw windowId.
    expect(input().placeholder).toBe("→ @1…");
  });

  it("names the recovery action in the no-target placeholder", () => {
    render(<Harness focus={null} />);
    expect(input().placeholder).toBe("No focused terminal — click a pane to target it");
  });

  it("shows the focused window name as the target label", () => {
    seedWindow("srv", "@1", "my-window");
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target").textContent).toBe("my-window");
  });

  it("falls back to the windowId as the label when the store has no name", () => {
    // No seedWindow — the store has no entry for this target, so the label uses
    // the raw windowId.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@7" }} />
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
              containerRef: { current: null },
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
          containerRef: { current: null },
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

  it("plain Enter inserts the line — sends text + \\n and clears the draft — on ANY pointer type (260802-lj98)", () => {
    for (const coarse of [false, true]) {
      stubPointer(coarse);
      const { ref, sent } = makeWs();
      const view = render(
        <ChromeProvider>
          <FocusedTerminalProvider>
            <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
            <ComposeStrip />
          </FocusedTerminalProvider>
        </ChromeProvider>,
      );
      act(() => fireEvent.click(screen.getByTestId("set-focus")));
      act(() => fireEvent.change(input(), { target: { value: "stage this line" } }));
      act(() => fireEvent.keyDown(input(), { key: "Enter" }));
      // Insert-line: the trailing \n stages the line in the agent's composer
      // (a plain shell pane executes it — terminal-conventional, documented).
      expect(sent).toEqual(["stage this line\n"]);
      // Same clear-on-delivery as submit.
      expect(input().value).toBe("");
      view.unmount();
    }
  });

  it("plain Enter on an EMPTY textarea is a FULL no-op: consumed, nothing sent, no local newline", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // fireEvent returns false when preventDefault() was called — the keydown
    // is consumed, so the textarea never inserts a local newline.
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key: "Enter" });
    });
    expect(notPrevented).toBe(false);
    expect(sent).toEqual([]); // nothing transmitted
    expect(input().value).toBe(""); // no draft change

    // Whitespace-only counts as empty for insert-line too: consumed, no send.
    act(() => fireEvent.change(input(), { target: { value: "   " } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual([]);
  });

  it("Shift+Enter does NOT send (inserts a newline via default behavior)", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "line1" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", shiftKey: true }));
    expect(sent).toEqual([]);
  });

  it("empty Cmd/Ctrl+Enter sends a bare \\r — 'press Enter in the pane' (260802-lj98)", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true }));
    expect(sent).toEqual(["\r"]); // completes the stage-then-submit loop
  });

  it("whitespace-only Cmd/Ctrl+Enter counts as empty: bare \\r, whitespace discarded, draft cleared", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "   " } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", metaKey: true }));
    expect(sent).toEqual(["\r"]); // stray spaces are never transmitted
    expect(input().value).toBe(""); // the whitespace draft is discarded
  });

  it("Cmd/Ctrl+Enter during IME composition does not send", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "hi" } }));
    // isComposing rides the native event; fireEvent.keyDown forwards it.
    act(() => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true, isComposing: true }));
    expect(sent).toEqual([]);
  });

  // ── Enter=insert-line matrix (260802-lj98, revising 260801-hsxm) ───────────

  it("Cmd/Ctrl+Enter sends text + trailing carriage return on BOTH pointer types (the only submit chord)", () => {
    for (const coarse of [false, true]) {
      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        stubPointer(coarse);
        const { ref, sent } = makeWs();
        const view = render(
          <ChromeProvider>
            <FocusedTerminalProvider>
              <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
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
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
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

  it("the Insert button follows Enter — sends text + \\n and clears; disabled when empty", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // Empty draft: Insert follows Enter's empty no-op (disabled) — but Send
    // stays enabled: its chord's empty case is the bare-\r "Enter in the pane".
    expect(insertBtn().disabled).toBe(true);
    expect(sendBtn().disabled).toBe(false);
    act(() => fireEvent.change(input(), { target: { value: "via button" } }));
    expect(insertBtn().disabled).toBe(false);
    act(() => fireEvent.click(insertBtn()));
    expect(sent).toEqual(["via button\n"]); // insert-line, same as plain Enter
    expect(input().value).toBe("");
  });

  it("the Send button mirrors its chord's empty case: enabled with a target in the secondary face, an empty click sends bare \\r", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    // Empty draft: Send stays enabled (target exists) but wears the neutral
    // secondary face, not the lit accent fill (260814 revision of kvk7 —
    // touch devices have no Cmd/Ctrl+Enter chord, so the button is the only
    // bare-Enter path there).
    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().className).toContain("border-border");
    expect(sendBtn().className).not.toContain("border-accent");
    // Whitespace-only counts as empty too — enabled, still secondary.
    act(() => fireEvent.change(input(), { target: { value: "   " } }));
    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().className).toContain("border-border");
    expect(insertBtn().disabled).toBe(true);
    // With text the accent fill returns and Send transmits text + trailing \r.
    act(() => fireEvent.change(input(), { target: { value: "via send" } }));
    expect(sendBtn().className).toContain("border-accent");
    expect(insertBtn().disabled).toBe(false);
    act(() => fireEvent.click(sendBtn()));
    expect(sent).toEqual(["via send\r"]);
    expect(input().value).toBe("");
    // The empty click itself sends the bare \r (the chord's empty case).
    act(() => fireEvent.click(sendBtn()));
    expect(sent).toEqual(["via send\r", "\r"]);
  });

  it("a guard-blocked insert (stream not OPEN) preserves the draft", () => {
    const { ref, sent } = makeWs(false); // CLOSED
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
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

  it("enterkeyhint states the truth: 'send' on every pointer type (Enter transmits the line)", () => {
    for (const coarse of [false, true]) {
      stubPointer(coarse);
      const view = render(
        <ChromeProvider>
          <FocusedTerminalProvider>
            <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
            <ComposeStrip />
          </FocusedTerminalProvider>
        </ChromeProvider>,
      );
      expect(input().getAttribute("enterkeyhint")).toBe("send");
      view.unmount();
    }
  });

  // ── Readline editing layer (260801-hsxm) ───────────────────────────────────

  it("Ctrl+U kills to line start through React state (shared readline layer)", () => {
    const { ref, sent } = makeWs();
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "kill this line" } }));
    act(() => input().setSelectionRange(9, 9)); // cursor after "kill this"
    act(() => fireEvent.keyDown(input(), { key: "u", code: "KeyU", ctrlKey: true }));
    // The deletion flows through the bubbled input event → onChange → module
    // store, so the controlled value reflects the kill.
    expect(input().value).toBe(" line");
    expect(sent).toEqual([]); // an editing chord never sends
  });

  it("Alt+B moves the caret a word back without editing (readline motion)", () => {
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "one two" } }));
    act(() => input().setSelectionRange(7, 7));
    // macOS composes ∫ into `key` for Alt+B — matching is on `code`.
    act(() => fireEvent.keyDown(input(), { key: "∫", code: "KeyB", altKey: true }));
    expect(input().value).toBe("one two");
    expect(input().selectionStart).toBe(4);
  });

  it("does not steal focus on a plain (re)mount — no open transition, no flag", () => {
    // A route remount with the strip already enabled never goes through
    // `toggleComposeStrip`, so no focus-on-open flag exists (260801-sm6g keeps
    // the 260718-dhdj no-steal rule for everything but the open transition).
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    // The strip textarea must not be the active element on mount.
    expect(document.activeElement).not.toBe(input());
  });

  // Focus-on-open (260801-sm6g): the off→on toggle marks the module flag;
  // the strip's mount effect consumes it and focuses the textarea. Mirrors the
  // real caller gating ({composeStripEnabled && <ComposeStrip/>} in app.tsx /
  // board-page.tsx) so the toggle actually mounts/unmounts the strip.
  function ToggleHarness({ focus }: { focus: FocusedTerminal }) {
    return (
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={focus} />
          <ToggleGatedStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>
    );
  }
  // NOTE: distinct from the ×-close `GatedStrip` harness below — this one also
  // exposes the toggle itself, to drive the off→on open transition.
  function ToggleGatedStrip() {
    const { composeStripEnabled } = useChromeState();
    const { toggleComposeStrip } = useChromeDispatch();
    return (
      <>
        <button data-testid="toggle-strip" onClick={toggleComposeStrip}>
          toggle
        </button>
        {composeStripEnabled && <ComposeStrip />}
      </>
    );
  }

  it("focuses the textarea on the open transition (toggle off→on)", () => {
    render(<ToggleHarness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.click(screen.getByTestId("toggle-strip")));
    expect(document.activeElement).toBe(input());
  });

  it("open in the no-target state takes no focus and clears the flag (no stale steal later)", () => {
    render(<ToggleHarness focus={null} />);
    // Open with no focused terminal: the textarea is disabled — no focus.
    act(() => fireEvent.click(screen.getByTestId("toggle-strip")));
    expect(document.activeElement).not.toBe(input());
    // The consume cleared the flag even though focus was declined.
    expect(consumeComposeStripFocusOnOpen()).toBe(false);
  });

  it("Escape blurs the textarea (does not remove the strip)", () => {
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
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

  // ── Per-target drafts (260801-cyth) ─────────────────────────────────────────

  /** Two focusable targets sharing one strip — drives target switches. Each
   * target keeps a stable ws so sends can be asserted per target. */
  const wsA = makeWs();
  const wsB = makeWs();
  function TwoTargets() {
    const { setFocused } = useFocusedTerminal();
    return (
      <>
        <button data-testid="focus-a" onClick={() => setFocused({ wsRef: wsA.ref, containerRef: { current: null }, server: "srv", session: "sa", windowId: "@a" })}>a</button>
        <button data-testid="focus-b" onClick={() => setFocused({ wsRef: wsB.ref, containerRef: { current: null }, server: "srv", session: "sb", windowId: "@b" })}>b</button>
        <ComposeStrip />
      </>
    );
  }
  function renderTwoTargets() {
    wsA.sent.length = 0;
    wsB.sent.length = 0;
    return render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <TwoTargets />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
  }

  it("switching the focused target swaps the visible draft (drafts do not travel)", () => {
    renderTwoTargets();
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    act(() => fireEvent.change(input(), { target: { value: "for A" } }));

    // B starts empty — A's draft did not travel with the focus change.
    act(() => fireEvent.click(screen.getByTestId("focus-b")));
    expect(input().value).toBe("");
    act(() => fireEvent.change(input(), { target: { value: "for B" } }));

    // Back on A: its own draft is recalled; B's is intact behind it.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    expect(input().value).toBe("for A");
    act(() => fireEvent.click(screen.getByTestId("focus-b")));
    expect(input().value).toBe("for B");
  });

  it("a delivered send clears only the focused target's draft", () => {
    renderTwoTargets();
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    act(() => fireEvent.change(input(), { target: { value: "keep A" } }));

    act(() => fireEvent.click(screen.getByTestId("focus-b")));
    act(() => fireEvent.change(input(), { target: { value: "send B" } }));
    act(() => fireEvent.click(sendBtn()));
    expect(wsB.sent).toEqual(["send B\r"]);
    expect(input().value).toBe(""); // B's draft cleared after delivery

    // A's draft was NOT collateral damage of B's send.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    expect(input().value).toBe("keep A");
    expect(wsA.sent).toEqual([]);
  });

  it("attachments stay with their target — no re-upload, no path rewrite on focus change", async () => {
    // One upload only (the attach). A focus change must NOT trigger another.
    uploadFilesMock.mockResolvedValueOnce([
      { path: "/wt-a/.uploads/x.png", file: new File(["x"], "x.png", { type: "image/png" }) },
    ]);
    renderTwoTargets();

    // Focus A, then attach a file via the hidden input.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    const file = new File(["x"], "x.png", { type: "image/png" });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(hiddenInput, { target: { files: [file] } });
    });
    expect(input().value).toContain("/wt-a/.uploads/x.png");
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();

    // Focus B: no re-home fires — B simply shows ITS (empty) draft.
    await act(async () => {
      fireEvent.click(screen.getByTestId("focus-b"));
    });
    expect(uploadFilesMock).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("");
    expect(screen.queryByTestId("compose-strip-previews")).toBeNull();

    // Back on A: the attachment (path line + preview) is right where it was.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    expect(input().value).toContain("/wt-a/.uploads/x.png");
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();
  });

  it("reclaims a departed target's preview URLs while the strip stays mounted", async () => {
    // Deterministic blob URLs so create/revoke pairs can be asserted exactly.
    let urlSeq = 0;
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:mock-${++urlSeq}`);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      uploadFilesMock.mockResolvedValueOnce([
        { path: "/wt-a/.uploads/x.png", file: new File(["x"], "x.png", { type: "image/png" }) },
      ]);
      renderTwoTargets();

      // Attach on A: rendering the preview mints one URL.
      act(() => fireEvent.click(screen.getByTestId("focus-a")));
      const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hiddenInput, {
          target: { files: [new File(["x"], "x.png", { type: "image/png" })] },
        });
      });
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).not.toHaveBeenCalled();

      // Abandon A without sending (switch to B): the sweep revokes A's URL —
      // it must not sit in the per-mount map for the life of the strip.
      act(() => fireEvent.click(screen.getByTestId("focus-b")));
      expect(revokeSpy).toHaveBeenCalledWith("blob:mock-1");

      // Back on A: the preview URL is recreated lazily from the retained File.
      act(() => fireEvent.click(screen.getByTestId("focus-a")));
      expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();
      expect(createSpy).toHaveBeenCalledTimes(2);
    } finally {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("hydration restores a persisted draft's text for its target (refresh survival)", () => {
    renderTwoTargets();
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    act(() => fireEvent.change(input(), { target: { value: "survives reload" } }));

    // Simulate a page reload: the module store re-hydrates from localStorage.
    act(() => hydrateComposeDrafts());
    expect(input().value).toBe("survives reload");
  });

  // ── Rework coverage (260718-dhdj): module-store draft persistence ──────────

  it("preserves the unsent draft across a toggle-off/on (unmount → remount)", () => {
    // Simulates the compose preference toggling off (strip unmounts) then back
    // on (strip remounts). The draft lives in the module store, so an unmount
    // must NOT destroy it.
    const { unmount } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "half-typed" } }));

    // Toggle off: the strip unmounts.
    unmount();
    expect(screen.queryByTestId("compose-strip")).toBeNull();

    // Toggle on: a FRESH strip mounts (new component instance / different
    // footer) and — once the SAME target is focused again — must show that
    // target's retained draft (drafts are keyed by target, 260801-cyth).
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input().value).toBe("half-typed");
  });

  it("preserves the draft across a route change (two separate strip mounts)", () => {
    // The terminal route and the board route mount the strip in SEPARATE
    // footers — a route change unmounts one and mounts the other. Modeled here
    // as two independent renders sharing the module store.
    const { unmount } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "route-draft" } }));
    unmount();

    // The "board route" mounts its own strip instance; focusing the SAME
    // window there (same entryKey) recalls the same draft.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input().value).toBe("route-draft");
  });

  it("a per-target draft survives the broadcast dock flip (in-tile ⇄ footer, 260813-j3jb)", () => {
    // The two docks are distinct subtrees (inside the first tty tile vs the
    // shell footer), so a broadcast on/off flip UNMOUNTS the strip from one
    // dock and mounts it at the other. The module store carries both drafts:
    // the broadcast draft keys on the recipient set, so the per-target draft
    // is untouched and returns when the flip restores single-send.
    const focus = {
      wsRef: makeWs().ref,
      containerRef: { current: null },
      server: "srv",
      session: "sess",
      windowId: "@1",
    };
    // In-tile dock (single-send): type a per-target draft.
    const { unmount: unmountTile } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={focus} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "in-tile draft" } }));
    unmountTile();

    // Broadcast ON — the strip remounts at the footer dock in selection mode:
    // the recipient-set draft is a SEPARATE (empty) draft.
    const { unmount: unmountFooter } = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={focus} />
          <ComposeStrip
            selectionTarget={{ keys: SELECTION_KEYS, onSend: vi.fn().mockResolvedValue(2) }}
          />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target")).toHaveTextContent("2 selected");
    expect(input().value).toBe("");
    unmountFooter();

    // Broadcast OFF — back at the in-tile dock, the per-target draft is intact.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={focus} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target")).not.toHaveTextContent("selected");
    expect(input().value).toBe("in-tile draft");
  });

  it("a guard-blocked send (stream not OPEN) preserves the draft", () => {
    // wsRef is CLOSED → the readyState guard blocks the send. The draft must be
    // preserved (early-return before clearing), not silently discarded.
    const { ref, sent } = makeWs(false); // CLOSED
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "keep-me" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true }));
    expect(sent).toEqual([]); // nothing delivered
    expect(input().value).toBe("keep-me"); // draft preserved
  });

  it("clears the draft only after a delivered send", () => {
    const { ref, sent } = makeWs(true); // OPEN
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.change(input(), { target: { value: "deliver" } }));
    act(() => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true }));
    expect(sent).toEqual(["deliver\r"]);
    expect(input().value).toBe(""); // cleared after delivery
  });

  it("clears the focused terminal on board-pane unmount (stale-target guard)", () => {
    // Models BoardPane's unmount cleanup: a component that registers itself as
    // the focused terminal on mount and clears it on unmount iff still the
    // registered one (mirrors BoardPane / terminal-client.tsx:139). After
    // unmount the strip must fall back to the disabled "no target" state.
    const wsRef = { current: null } as React.RefObject<WebSocket | null>;
    const containerRef = { current: null } as React.RefObject<HTMLElement | null>;
    function FakeBoardPane() {
      const { focused, setFocused } = useFocusedTerminal();
      const focusedRef = useRef(focused);
      focusedRef.current = focused;
      useEffect(() => {
        setFocused({ wsRef, containerRef, server: "srv", session: "sess", windowId: "@board" });
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
    const first = render(<GatedHarness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
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
    // the same target's draft intact — closing is lossless, no confirmation
    // needed (drafts are keyed by target, so the same focus recalls it).
    first.unmount();
    localStorage.setItem("runkit-compose-strip", "true");
    render(<GatedHarness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input().value).toBe("before-close");
  });

  it("the × does not steal focus (mousedown is default-prevented)", () => {
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
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
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
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

  // ── Sent history + ↑/↓ recall (260806-kadm) ────────────────────────────────

  /** Single-target strip with an OPEN stream, focused and ready to type. */
  function renderFocused(open = true) {
    const { ref, sent } = makeWs(open);
    const view = render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    return { view, sent };
  }

  const KEY = entryKey("srv", "@1");

  /** Type into the textarea (a real user edit — ends any recall walk). */
  function type(value: string) {
    act(() => fireEvent.change(input(), { target: { value } }));
  }

  /** Press an arrow; returns true when the keydown was NOT prevented (i.e. the
   * strip left it to native cursor movement). */
  function arrow(key: "ArrowUp" | "ArrowDown"): boolean {
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key });
    });
    return notPrevented;
  }

  it.each([
    ["insert-line (plain Enter)", { key: "Enter" }, "sent text\n"],
    ["insert (Alt+Enter)", { key: "Enter", altKey: true }, "sent text"],
    ["submit (Cmd/Ctrl+Enter)", { key: "Enter", ctrlKey: true }, "sent text\r"],
  ])("records history on a delivered %s send, before the clear", (_label, chord, wire) => {
    const { sent } = renderFocused();
    type("sent text");
    act(() => fireEvent.keyDown(input(), chord));
    // Wire bytes unchanged by this change.
    expect(sent).toEqual([wire]);
    // Draft cleared as before — and the text is recoverable.
    expect(input().value).toBe("");
    expect(getComposeSentHistory(KEY)).toEqual(["sent text"]);
  });

  it("an empty submit's bare \\r records nothing", () => {
    const { sent } = renderFocused();
    act(() => fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true }));
    expect(sent).toEqual(["\r"]);
    expect(getComposeSentHistory(KEY)).toEqual([]);
  });

  it("a guard-blocked send (stream not OPEN) records nothing and keeps the draft", () => {
    const { sent } = renderFocused(false);
    type("never delivered");
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual([]);
    expect(input().value).toBe("never delivered"); // draft preserved
    expect(getComposeSentHistory(KEY)).toEqual([]); // nothing to recover — nothing lost
  });

  it("↑ on an empty textarea recalls the newest sent text", () => {
    pushComposeSentHistory(KEY, "older");
    pushComposeSentHistory(KEY, "newest");
    renderFocused();
    expect(arrow("ArrowUp")).toBe(false); // consumed
    expect(input().value).toBe("newest");
  });

  it("repeated ↑ walks older and pins at the oldest entry (no wrap)", () => {
    for (const t of ["a", "b", "c"]) pushComposeSentHistory(KEY, t);
    renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("c");
    arrow("ArrowUp");
    expect(input().value).toBe("b");
    arrow("ArrowUp");
    expect(input().value).toBe("a");
    arrow("ArrowUp"); // past the oldest — pins, never wraps to "c"
    expect(input().value).toBe("a");
  });

  it("↓ walks back toward newer and, past the newest, restores the stash and ends the walk", () => {
    for (const t of ["a", "b", "c"]) pushComposeSentHistory(KEY, t);
    renderFocused();
    arrow("ArrowUp");
    arrow("ArrowUp");
    arrow("ArrowUp");
    expect(input().value).toBe("a");

    expect(arrow("ArrowDown")).toBe(false); // consumed
    expect(input().value).toBe("b");
    arrow("ArrowDown");
    expect(input().value).toBe("c");
    arrow("ArrowDown"); // past the newest → the pre-walk stash (empty)
    expect(input().value).toBe("");
    // Walk over: a further ↓ is native again.
    expect(arrow("ArrowDown")).toBe(true);
  });

  it("↓ outside a walk is never intercepted", () => {
    pushComposeSentHistory(KEY, "available");
    renderFocused();
    expect(arrow("ArrowDown")).toBe(true);
    expect(input().value).toBe("");
  });

  it("↑ on a NON-empty textarea outside a walk keeps native cursor movement", () => {
    pushComposeSentHistory(KEY, "recallable");
    renderFocused();
    type("line one\nline two");
    expect(arrow("ArrowUp")).toBe(true); // not consumed — the caret moves
    expect(input().value).toBe("line one\nline two"); // draft untouched
  });

  it("↑ with no history for the target does nothing and starts no walk", () => {
    renderFocused();
    expect(arrow("ArrowUp")).toBe(true); // nothing to recall — stays native
    expect(input().value).toBe("");
    // No walk started, so ↓ is still native too.
    expect(arrow("ArrowDown")).toBe(true);
  });

  it("editing ends the walk — a later ↑ on the edited text is not intercepted", () => {
    pushComposeSentHistory(KEY, "recalled");
    renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("recalled");
    type("recalled and edited"); // user edit → walk over
    expect(arrow("ArrowUp")).toBe(true); // non-empty, no walk → native
    expect(input().value).toBe("recalled and edited");
  });

  it("sending ends the walk — the next ↑ starts fresh from the newest entry", () => {
    pushComposeSentHistory(KEY, "old one");
    const { sent } = renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("old one");
    // Re-sending the recalled text: adjacent-dedupe means it does not burn a
    // second slot, and the walk ends.
    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual(["old one\n"]);
    expect(getComposeSentHistory(KEY)).toEqual(["old one"]);
    arrow("ArrowUp");
    expect(input().value).toBe("old one"); // fresh walk from the newest
  });

  it("a walk does not survive a target switch — each target walks its own history", () => {
    const keyA = entryKey("srv", "@a");
    const keyB = entryKey("srv", "@b");
    pushComposeSentHistory(keyA, "A older");
    pushComposeSentHistory(keyA, "A newest");
    pushComposeSentHistory(keyB, "B only");
    renderTwoTargets();

    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    arrow("ArrowUp");
    arrow("ArrowUp");
    expect(input().value).toBe("A older"); // mid-walk, two steps back

    // Switch to B: A's walk (and its stash) must not carry over.
    act(() => fireEvent.click(screen.getByTestId("focus-b")));
    expect(input().value).toBe(""); // B's draft, untouched by A's walk
    arrow("ArrowUp");
    expect(input().value).toBe("B only"); // B's own newest, not A's index

    // Back on A: its draft still holds the recalled text (recall persists as a
    // draft — it behaves exactly like typing), and a fresh walk starts over.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    expect(input().value).toBe("A older");
  });

  // The switch must end the walk EAGERLY (on the `draftKey` change), not lazily
  // at the next keydown. The test above cannot see the difference because it
  // presses ↑ on B, which tears a lazily-checked walk down as a side effect —
  // these two round-trip through B WITHOUT any arrow there.
  it("an A→B→A round-trip with no arrow on B starts a fresh walk from A's newest", () => {
    const keyA = entryKey("srv", "@a");
    pushComposeSentHistory(keyA, "A older");
    pushComposeSentHistory(keyA, "A newest");
    renderTwoTargets();

    // Walk A back two steps, then leave and come straight back — no arrow on B.
    act(() => fireEvent.click(screen.getByTestId("focus-a")));
    arrow("ArrowUp");
    arrow("ArrowUp");
    expect(input().value).toBe("A older");
    act(() => fireEvent.click(screen.getByTestId("focus-b")));
    act(() => fireEvent.click(screen.getByTestId("focus-a")));

    // A's draft still shows the recalled text, but the WALK is gone. Because
    // the textarea is non-empty and no walk is in progress, ↑ is now native
    // cursor movement — it must not resume A's stale index (which would step
    // past "A older" and pin, silently continuing a walk the user abandoned).
    expect(input().value).toBe("A older");
    expect(arrow("ArrowUp")).toBe(true); // not consumed
    expect(input().value).toBe("A older");

    // Clearing the draft re-opens recall, and it starts from the NEWEST entry.
    type("");
    arrow("ArrowUp");
    expect(input().value).toBe("A newest");
  });

  it("an upload mid-walk ends the walk — the path line survives the next arrow", async () => {
    uploadFilesMock.mockResolvedValueOnce([
      { path: "/wt/.uploads/a.png", file: new File(["a"], "a.png", { type: "image/png" }) },
    ]);
    pushComposeSentHistory(KEY, "older sent");
    pushComposeSentHistory(KEY, "newest sent");
    renderFocused();

    // Walk to the newest entry, then attach a file mid-walk.
    arrow("ArrowUp");
    expect(input().value).toBe("newest sent");
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, {
        target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
      });
    });
    expect(input().value).toBe("newest sent\n/wt/.uploads/a.png");
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();

    // The upload ended the walk, so ↑ is native on the now-non-empty text. A
    // still-armed walk would overwrite the text with "older sent", dropping the
    // path line while the File and its preview chip stayed mounted — an
    // attachment the agent could never resolve.
    expect(arrow("ArrowUp")).toBe(true); // not consumed
    expect(input().value).toBe("newest sent\n/wt/.uploads/a.png");
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();
  });

  it("removing an attachment mid-walk ends the walk", async () => {
    uploadFilesMock.mockResolvedValueOnce([
      { path: "/wt/.uploads/b.png", file: new File(["b"], "b.png", { type: "image/png" }) },
    ]);
    pushComposeSentHistory(KEY, "older sent");
    pushComposeSentHistory(KEY, "newest sent");
    renderFocused();

    // Attach first (this ends the initial walk), then start a NEW walk — the
    // non-empty text means ↑ is native, so clear it to re-open recall.
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, {
        target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
      });
    });
    type("/wt/.uploads/b.png");
    // Remove the attachment while no walk is running is uninteresting; start
    // one by clearing and recalling, which keeps the preview mounted.
    type("");
    arrow("ArrowUp");
    expect(input().value).toBe("newest sent");
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();

    // Remove the (now text-less) attachment mid-walk: the splice is a text
    // mutation, so it ends the walk.
    act(() => fireEvent.click(screen.getByLabelText("Remove b.png")));
    expect(screen.queryByTestId("compose-strip-previews")).not.toBeInTheDocument();
    expect(arrow("ArrowUp")).toBe(true); // walk over → native
    expect(input().value).toBe("newest sent");
  });

  it("an IME-composing arrow is never intercepted (candidate-list navigation)", () => {
    pushComposeSentHistory(KEY, "recallable");
    renderFocused();
    // ↑/↓ move through the IME candidate list while composing — swallowing them
    // would break the very surface the strip exists to provide (xterm.js has no
    // IME). Both neighbouring layers guard on isComposing the same way.
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key: "ArrowUp", isComposing: true });
    });
    expect(notPrevented).toBe(true);
    expect(input().value).toBe(""); // nothing recalled
  });

  it.each([
    ["Shift (selection extension)", { shiftKey: true }],
    ["Alt (paragraph jump)", { altKey: true }],
    ["Meta (document jump)", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
  ])("a modified ↑ (%s) stays native and recalls nothing", (_label, modifier) => {
    pushComposeSentHistory(KEY, "recallable");
    renderFocused();
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key: "ArrowUp", ...modifier });
    });
    expect(notPrevented).toBe(true);
    expect(input().value).toBe("");
  });

  it("a modified ↓ mid-walk stays native and does not step the walk", () => {
    for (const t of ["a", "b"]) pushComposeSentHistory(KEY, t);
    renderFocused();
    arrow("ArrowUp");
    arrow("ArrowUp");
    expect(input().value).toBe("a");
    // Shift+↓ extends the selection — it must not walk forward to "b".
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.keyDown(input(), { key: "ArrowDown", shiftKey: true });
    });
    expect(notPrevented).toBe(true);
    expect(input().value).toBe("a");
    // The walk itself is untouched: a bare ↓ still steps forward.
    arrow("ArrowDown");
    expect(input().value).toBe("b");
  });

  /** Place a collapsed caret at `pos` without firing onChange (caret motion
   * is not an edit, so it must not end the walk). */
  function caret(pos: number, end = pos) {
    act(() => input().setSelectionRange(pos, end));
  }

  it("arrows inside a multi-line recall move the caret natively — the walk steps only from the boundary rows", () => {
    pushComposeSentHistory(KEY, "old");
    pushComposeSentHistory(KEY, "line1\nline2");
    renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("line1\nline2");

    // Caret inside line2 (not the first line): ↑ is native cursor movement —
    // it must NOT nuke the recalled text by jumping to the older entry.
    caret(8);
    expect(arrow("ArrowUp")).toBe(true);
    expect(input().value).toBe("line1\nline2");
    // Caret on line1 (not the last line): ↓ is native cursor movement.
    caret(2);
    expect(arrow("ArrowDown")).toBe(true);
    expect(input().value).toBe("line1\nline2");

    // The walk survived the native motions (caret motion is not an edit):
    // ↑ from the FIRST line steps to the older entry…
    caret(2);
    expect(arrow("ArrowUp")).toBe(false);
    expect(input().value).toBe("old");
    // …and ↓ (single-line entry — every caret is the last line) steps back.
    caret(3);
    expect(arrow("ArrowDown")).toBe(false);
    expect(input().value).toBe("line1\nline2");
    // ↓ from the LAST line steps past the newest and restores the stash.
    caret(11);
    expect(arrow("ArrowDown")).toBe(false);
    expect(input().value).toBe("");
  });

  it("a selection inside a recalled entry keeps arrows native (bare arrow = collapse motion)", () => {
    for (const t of ["a", "recalled"] as const) pushComposeSentHistory(KEY, t);
    renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("recalled");

    caret(1, 4); // non-collapsed selection
    expect(arrow("ArrowUp")).toBe(true);
    expect(arrow("ArrowDown")).toBe(true);
    expect(input().value).toBe("recalled");

    // Collapsing the selection re-arms the walk.
    caret(0);
    expect(arrow("ArrowUp")).toBe(false);
    expect(input().value).toBe("a");
  });

  it("recall restores text only — no attachment is resurrected", async () => {
    uploadFilesMock.mockResolvedValueOnce([
      { path: "/wt/.uploads/x.png", file: new File(["x"], "x.png", { type: "image/png" }) },
    ]);
    const { sent } = renderFocused();
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, {
        target: { files: [new File(["x"], "x.png", { type: "image/png" })] },
      });
    });
    expect(screen.getByTestId("compose-strip-previews")).toBeInTheDocument();

    act(() => fireEvent.keyDown(input(), { key: "Enter" }));
    expect(sent).toEqual(["/wt/.uploads/x.png\n"]);
    expect(screen.queryByTestId("compose-strip-previews")).not.toBeInTheDocument();

    arrow("ArrowUp");
    // The path LINE comes back (it is part of the text) — the File object,
    // and therefore the preview, does not.
    expect(input().value).toBe("/wt/.uploads/x.png");
    expect(screen.queryByTestId("compose-strip-previews")).not.toBeInTheDocument();
  });

  // ── Coarse-pointer collapse + ⏎ newline chip (260814-ink6) ───────────────

  const newlineBtn = () => screen.getByTestId("compose-strip-newline") as HTMLButtonElement;

  it("coarse normal mode folds the header row away and moves the target into the placeholder", () => {
    stubPointer(true);
    seedWindow("srv", "@1", "grainy-magpie");
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.queryByTestId("compose-strip-target")).toBeNull();
    expect(screen.queryByTestId("compose-strip-close")).toBeNull();
    expect(input().placeholder).toBe("→ grainy-magpie…");
  });

  it("fine pointers keep the header row unconditionally", () => {
    stubPointer(false);
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByTestId("compose-strip-target")).toBeInTheDocument();
    expect(screen.getByTestId("compose-strip-close")).toBeInTheDocument();
  });

  it("the header returns on coarse in selection-broadcast mode — and the ⏎ chip hides there", () => {
    stubPointer(true);
    renderSelection(vi.fn().mockResolvedValue(2));
    // `→ N selected` is real signal, so the header row renders as on fine…
    expect(screen.getByTestId("compose-strip-target")).toHaveTextContent("2 selected");
    // …but broadcast's plain Enter is already a local newline, so the chip
    // would duplicate the return key.
    expect(screen.queryByTestId("compose-strip-newline")).toBeNull();
  });

  it("the header returns on coarse in the disabled no-target state; the ⏎ chip is disabled with the textarea", () => {
    stubPointer(true);
    render(<Harness focus={null} />);
    expect(screen.getByTestId("compose-strip-target")).toHaveTextContent("no target");
    expect(input()).toBeDisabled();
    expect(newlineBtn()).toBeDisabled();
  });

  it("coarse collapses to a single row — 📎, textarea, ⏎, Send — with no Insert and rows={1}", () => {
    stubPointer(true);
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input()).toHaveAttribute("rows", "1");
    // The mobile return key already performs insert-line, so Insert is dropped.
    expect(screen.queryByTestId("compose-strip-insert")).toBeNull();
    // All four controls share the ONE row.
    const row = input().parentElement;
    expect(screen.getByRole("button", { name: "Upload file" }).parentElement).toBe(row);
    expect(newlineBtn().parentElement).toBe(row);
    expect(sendBtn().parentElement).toBe(row);
  });

  it("fine pointers keep the two-row stack: rows={2}, Insert present, no ⏎ chip", () => {
    stubPointer(false);
    render(<Harness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />);
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(input()).toHaveAttribute("rows", "2");
    expect(insertBtn()).toBeInTheDocument();
    expect(screen.queryByTestId("compose-strip-newline")).toBeNull();
    expect(sendBtn().parentElement).not.toBe(input().parentElement);
  });

  it("⏎ inserts a newline at the caret, keeps focus, and persists through the draft store", () => {
    stubPointer(true);
    renderFocused();
    type("abc");
    const el = input();
    act(() => {
      el.focus();
      el.setSelectionRange(2, 2); // caret after "b"
    });
    // mousedown is default-prevented — the on-screen keyboard must not dismiss.
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.mouseDown(newlineBtn());
    });
    expect(notPrevented).toBe(false);
    act(() => fireEvent.click(newlineBtn()));
    expect(input().value).toBe("ab\nc");
    expect(input().selectionStart).toBe(3); // caret after the inserted newline
    expect(document.activeElement).toBe(input());
  });

  it("⏎ with an empty composer inserts a bare newline (a local edit — nothing is sent)", () => {
    stubPointer(true);
    const { sent } = renderFocused();
    act(() => fireEvent.click(newlineBtn()));
    expect(input().value).toBe("\n");
    expect(sent).toEqual([]);
  });

  it("⏎ ends an in-progress recall walk (a text mutation like typing)", () => {
    stubPointer(true);
    pushComposeSentHistory(KEY, "older");
    pushComposeSentHistory(KEY, "newest");
    renderFocused();
    arrow("ArrowUp");
    expect(input().value).toBe("newest");

    act(() => fireEvent.click(newlineBtn()));
    expect(input().value).toBe("newest\n");

    // The walk ended: ↑ on the now non-empty composition is native cursor
    // movement — a still-armed walk would overwrite the text with "older".
    expect(arrow("ArrowUp")).toBe(true);
    expect(input().value).toBe("newest\n");
  });

  it("⏎ prefers the undo-safe execCommand path when the browser offers it", () => {
    stubPointer(true);
    const exec = vi.fn().mockReturnValue(true);
    const original = document.execCommand;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: exec,
    });
    try {
      renderFocused();
      type("abc");
      act(() => input().setSelectionRange(2, 2));
      act(() => fireEvent.click(newlineBtn()));
      expect(exec).toHaveBeenCalledWith("insertText", false, "\n");
    } finally {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("publishes textarea focus to the module store and clears it on blur and unmount", () => {
    const { view } = renderFocused();
    expect(isComposeStripFocused()).toBe(false);
    act(() => {
      input().focus();
    });
    expect(isComposeStripFocused()).toBe(true);
    act(() => {
      input().blur();
    });
    expect(isComposeStripFocused()).toBe(false);
    // A strip toggled off while focused must not stick the bar hidden.
    act(() => {
      input().focus();
    });
    act(() => view.unmount());
    expect(isComposeStripFocused()).toBe(false);
  });

  it("the bottom bar hides while the textarea is focused on a coarse pointer, and returns on blur", () => {
    stubPointer(true);
    // Strip + BottomBar as siblings — the same mount topology as the two
    // shell footers (app.tsx / board-page.tsx), wired only through the
    // module-store focus signal.
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
          <BottomBar onOpenCompose={vi.fn()} />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    act(() => {
      input().focus();
    });
    expect(screen.queryByRole("toolbar")).toBeNull();
    // Blur (Escape's contract) restores the bar.
    act(() => {
      input().blur();
    });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("StrictMode's effect replay cannot strand the focus flag while the textarea holds focus", () => {
    // e2e/dev run under <StrictMode>: the replay runs the mount cleanup after
    // focus-on-open already focused the textarea, and no new focus event fires
    // for the still-focused element — the mount-time sync from
    // document.activeElement is what re-publishes the flag.
    render(
      <StrictMode>
        <ToggleHarness focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
      </StrictMode>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => fireEvent.click(screen.getByTestId("toggle-strip")));
    expect(document.activeElement).toBe(input());
    expect(isComposeStripFocused()).toBe(true);
  });

  it("the bottom bar never hides on a fine pointer, even while composing", () => {
    stubPointer(false);
    render(
      <ChromeProvider>
        <FocusedTerminalProvider>
          <FocusSetter focus={{ wsRef: makeWs().ref, containerRef: { current: null }, server: "srv", session: "sess", windowId: "@1" }} />
          <ComposeStrip />
          <BottomBar onOpenCompose={vi.fn()} />
        </FocusedTerminalProvider>
      </ChromeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-focus")));
    act(() => {
      input().focus();
    });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });
});
