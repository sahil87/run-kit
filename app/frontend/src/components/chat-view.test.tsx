import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ChatView } from "./chat-view";
import type { ChatEvent } from "@/lib/chat-stream";
import { stubMatchMedia } from "@/test-utils/match-media";

/** Stub matchMedia so `(pointer: coarse)` matches — used to prove the Enter
 * policy and `enterkeyhint` are pointer-INDEPENDENT (chat keeps Enter=newline
 * on every pointer type — the deliberately-diverging surface since
 * 260802-lj98's strip insert-line flip; only the autofocus skip keys on the
 * pointer). jsdom has no matchMedia, so the unstubbed default is the
 * fine-pointer path. */
function stubCoarsePointer() {
  stubMatchMedia((query) => query === "(pointer: coarse)");
}

// ChatView send footer (260714-jdyg-chat-send). ChatView is a pure component:
// `AppShell` supplies `onSend` (wrapping the chat-send POST) and `busy`. These
// tests drive the footer directly with a fake `onSend`, so no API/EventSource
// is involved — only the submission semantics, in-flight lock, clear/keep, the
// inline error, and the busy-hint gating.

const EVENTS: ChatEvent[] = [
  { type: "message", id: "m1", turn: 1, role: "user", text: "hi" },
];

function renderChat(
  overrides: Partial<React.ComponentProps<typeof ChatView>> = {},
) {
  const onSend = overrides.onSend ?? vi.fn().mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof ChatView> = {
    events: EVENTS,
    pending: null,
    connected: true,
    error: null,
    onSend,
    busy: false,
    ...overrides,
  };
  const utils = render(<ChatView {...props} />);
  return { ...utils, onSend };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatView send footer", () => {
  it("replaces the read-only disabled footer with a live input", () => {
    renderChat();
    expect(screen.queryByTestId("chat-send-disabled")).toBeNull();
    expect(screen.getByTestId("chat-send-input")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send-button")).toBeInTheDocument();
  });

  it("Cmd/Ctrl+Enter submits the typed text and clears on success", async () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "run the tests" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("run the tests", true));
    expect(onSend).toHaveBeenCalledTimes(1);
    // Clear on success.
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("plain Enter does NOT submit (newline accumulates locally, 260801-hsxm)", () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first sentence" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("first sentence"); // no clear — nothing was sent
  });

  it("Shift+Enter inserts a newline and does NOT submit", () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("an empty / whitespace-only textarea does not submit on Cmd/Ctrl+Enter", () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "   \n\t " } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
    // The send button is disabled for whitespace-only content.
    expect(screen.getByTestId("chat-send-button")).toBeDisabled();
  });

  it("the send button submits and is disabled when empty", async () => {
    const { onSend } = renderChat();
    expect(screen.getByTestId("chat-send-button")).toBeDisabled();
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(screen.getByTestId("chat-send-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("chat-send-button"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("hello", true));
  });

  // ── Enter policy flip + insert-without-submit (260801-hsxm) ────────────────

  it("coarse pointer: plain Enter still does NOT submit; Send button still does", async () => {
    stubCoarsePointer();
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "touch draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("touch draft"); // no clear — nothing was sent

    fireEvent.click(screen.getByTestId("chat-send-button"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("touch draft", true));
  });

  it("Cmd/Ctrl+Enter submits on BOTH pointer types (the only submit chord)", async () => {
    // Coarse pointer + hardware keyboard: the modifier chord submits.
    stubCoarsePointer();
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "meta" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("meta", true));
    fireEvent.change(input, { target: { value: "ctrl" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("ctrl", true));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("Alt+Enter sends with submit:false and clears on success", async () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "stage me" } });
    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("stage me", false));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("the Insert button sends with submit:false, mirrors Send's disabled state", async () => {
    const { onSend } = renderChat();
    expect(screen.getByTestId("chat-send-insert")).toBeDisabled();
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "via button" } });
    expect(screen.getByTestId("chat-send-insert")).toBeEnabled();
    fireEvent.click(screen.getByTestId("chat-send-insert"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("via button", false));
  });

  it("an insert-mode failure keeps the text and surfaces the inline error (shared path)", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Enter withheld"));
    renderChat({ onSend });
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "keep insert" } });
    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    await screen.findByTestId("chat-send-error");
    expect(input.value).toBe("keep insert");
  });

  it("enterkeyhint states the truth: 'enter' on every pointer type (Enter inserts a newline)", () => {
    // Fine (jsdom default — no matchMedia): Enter inserts a newline → "enter".
    const fine = renderChat();
    expect(
      (screen.getByTestId("chat-send-input") as HTMLTextAreaElement).getAttribute("enterkeyhint"),
    ).toBe("enter");
    fine.unmount();

    // Coarse: same — the hint no longer keys on the pointer type.
    stubCoarsePointer();
    renderChat();
    expect(
      (screen.getByTestId("chat-send-input") as HTMLTextAreaElement).getAttribute("enterkeyhint"),
    ).toBe("enter");
  });

  // ── Readline editing layer (260801-hsxm) ───────────────────────────────────

  it("Ctrl+W deletes the word before the cursor (shared readline layer)", () => {
    const { onSend } = renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "one two three" } });
    input.setSelectionRange(13, 13);
    fireEvent.keyDown(input, { key: "w", code: "KeyW", ctrlKey: true });
    // The deletion flows through the bubbled input event → onChange, so the
    // controlled value reflects the edit.
    expect(input.value).toBe("one two ");
    expect(onSend).not.toHaveBeenCalled(); // an editing chord never sends
  });

  it("Alt+F moves the caret a word forward without editing (readline motion)", () => {
    renderChat();
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "one two" } });
    input.setSelectionRange(0, 0);
    // macOS composes ƒ into `key` for Alt+F — matching is on `code`.
    fireEvent.keyDown(input, { key: "ƒ", code: "KeyF", altKey: true });
    expect(input.value).toBe("one two");
    expect(input.selectionStart).toBe(3);
  });

  it("in-flight lock: a second Cmd/Ctrl+Enter while pending does not double-send", async () => {
    let resolveSend: () => void = () => {};
    const onSend = vi.fn().mockImplementation(
      () => new Promise<void>((res) => { resolveSend = res; }),
    );
    renderChat({ onSend });
    const input = screen.getByTestId("chat-send-input");
    fireEvent.change(input, { target: { value: "once" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    // Second submit chord while the first is still pending.
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    resolveSend();
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  });

  it("keeps the text and surfaces the server error inline on failure", async () => {
    const onSend = vi.fn().mockRejectedValue(
      new Error("agent input not ready — message pasted but not echoed; Enter withheld"),
    );
    renderChat({ onSend });
    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "ship it" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    // Inline role="alert" carries the server's structured message.
    const alert = await screen.findByTestId("chat-send-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Enter withheld");
    // Text is KEPT on failure.
    expect(input.value).toBe("ship it");
  });

  // AppShell renders <ChatView key={windowParam} …> so switching between two
  // chat-lens windows REMOUNTS the form. This proves the contract that keyed
  // remount relies on: a half-typed draft and a stale inline 409 error are
  // cleared on remount (a same-key rerender, by contrast, keeps them).
  it("a keyed remount (window switch) clears the draft and the stale inline error", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Enter withheld"));
    const chat = (windowKey: string) => (
      <ChatView
        key={windowKey}
        events={EVENTS}
        pending={null}
        connected
        error={null}
        onSend={onSend}
        busy={false}
      />
    );
    const { rerender } = render(chat("@1"));

    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "draft for window one" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    // The failed send leaves both a draft and an inline error on THIS window.
    await screen.findByTestId("chat-send-error");
    expect(input.value).toBe("draft for window one");

    // A same-key rerender keeps the state (baseline — proves the reset below is
    // the key change, not the rerender).
    rerender(chat("@1"));
    expect((screen.getByTestId("chat-send-input") as HTMLTextAreaElement).value).toBe(
      "draft for window one",
    );
    expect(screen.queryByTestId("chat-send-error")).not.toBeNull();

    // Switching windows (new key) remounts → draft + error gone.
    rerender(chat("@2"));
    expect((screen.getByTestId("chat-send-input") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("chat-send-error")).toBeNull();
  });

  // AppShell keys <ChatView> by the COMPOSITE `${server}:${windowParam}`, not the
  // window id alone, because two different servers can share a window id (@1 ↔
  // @1). This proves that a same-windowId / different-server switch still changes
  // the key and therefore still remounts — a window-only key would reuse the
  // instance and carry one server's draft/error into another server's pane.
  it("a same-windowId, different-server switch (composite key) still remounts", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Enter withheld"));
    // Model the AppShell key: `${server}:${windowParam}` with the window id fixed
    // at @1 across both servers.
    const chat = (server: string) => (
      <ChatView
        key={`${server}:@1`}
        events={EVENTS}
        pending={null}
        connected
        error={null}
        onSend={onSend}
        busy={false}
      />
    );
    const { rerender } = render(chat("host-a"));

    const input = screen.getByTestId("chat-send-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "draft for host-a @1" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await screen.findByTestId("chat-send-error");
    expect(input.value).toBe("draft for host-a @1");

    // Same window id (@1) but a DIFFERENT server → composite key changes →
    // remount → draft + error gone.
    rerender(chat("host-b"));
    expect((screen.getByTestId("chat-send-input") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("chat-send-error")).toBeNull();
  });

  it("shows the non-blocking busy hint (input stays enabled) only while busy", () => {
    const { rerender } = renderChat({ busy: true });
    expect(screen.getByTestId("chat-send-busy-hint")).toBeInTheDocument();
    // Allow + probe policy — the input is NOT disabled while busy.
    expect(screen.getByTestId("chat-send-input")).toBeEnabled();

    rerender(
      <ChatView
        events={EVENTS}
        pending={null}
        connected
        error={null}
        onSend={vi.fn().mockResolvedValue(undefined)}
        busy={false}
      />,
    );
    expect(screen.queryByTestId("chat-send-busy-hint")).toBeNull();
  });
});
