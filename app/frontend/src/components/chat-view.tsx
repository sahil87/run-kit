import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { Tip, TipGroup } from "@/components/tip";
import { classifyComposeEnter } from "@/lib/compose-keys";
import {
  groupEventsByTurn,
  pairToolEvents,
  derivePendingBubble,
  type ChatEvent,
  type ChatPending,
  type ChatTurn,
  type ToolCard as ToolCardData,
} from "@/lib/chat-stream";

/**
 * HTML chat view over an agent pane (260714-r7rq — Change 3, read; extended by
 * 260714-jdyg-chat-send — Change 4, send). A SECOND view over the same tmux
 * pane, never a substrate: the pane stays the agent's parent (Constitution VI).
 * The transcript is RENDERED read-only from the streamed events; the footer
 * SENDS a message into the pane via tmux injection (paste + probed Enter) —
 * still no SDK hosting, no session ownership (Constitution II/VI).
 *
 * Consumes the chat stream (a `kind:"chat"` subscription on the shared state
 * socket, via `use-chat-subscription`) purely as passed props; nothing is cached
 * beyond component state that dies with the view (Constitution II analog).
 *
 * House aesthetic throughout: monospace, three-mode theme tokens, animation
 * behind `prefers-reduced-motion` (the stick-to-bottom scroll uses `auto`
 * behavior — no smooth-scroll animation to gate — and there is no decorative
 * motion here).
 *
 * Pure component over passed props: `AppShell` owns the single
 * `use-chat-subscription` call (so one chat subscription feeds BOTH this renderer
 * and the connection dot's health) AND supplies `onSend` (wrapping the chat-send
 * POST) + the `busy`
 * signal (`agentState === "active"`). This component opens no stream and calls
 * no API itself.
 */
export function ChatView({
  events,
  pending,
  connected,
  error,
  onSend,
  busy,
}: {
  events: ChatEvent[];
  pending: ChatPending | null;
  connected: boolean;
  error: string | null;
  /**
   * Send a message into the agent pane. `submit: false` is the insert-without-
   * submit mode (260719-mxvw) — the text is pasted into the pane's input box but
   * the final gated Enter is skipped. Resolves on a successful send (200) and
   * REJECTS with an Error whose message is the server's structured error (e.g.
   * the 409 probe failure) so the footer can surface it inline.
   */
  onSend: (text: string, submit: boolean) => Promise<void>;
  /** True while the window's agent is `active` — drives the non-blocking hint. */
  busy: boolean;
}) {
  const turns = groupEventsByTurn(events);
  const pendingBubble = derivePendingBubble(pending);

  // Stick-to-bottom: auto-follow the tail unless the user has scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Within ~40px of the bottom counts as "at bottom" (tolerates sub-pixel and
    // fractional scroll heights).
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 40;
  };

  // After each content change, if we were stuck to the bottom, follow the tail.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, pendingBubble]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg-primary">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 font-mono text-sm flex flex-col gap-3"
        data-testid="chat-view"
      >
        {error ? (
          <div
            role="alert"
            className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-red-400"
            data-testid="chat-error"
          >
            {error}
          </div>
        ) : turns.length === 0 && !pendingBubble ? (
          <div className="text-text-secondary select-none" data-testid="chat-empty">
            {connected ? "No messages yet." : "Connecting…"}
          </div>
        ) : (
          turns.map((turn) => <TurnBlock key={turn.turn} turn={turn} />)
        )}

        {pendingBubble && (
          <div
            className="self-stretch rounded border border-yellow-400/50 bg-yellow-400/10 px-3 py-2 text-yellow-300"
            data-testid="chat-pending"
            role="status"
          >
            <div className="text-xs uppercase tracking-wide text-yellow-400/80 mb-1">
              Waiting for input
              {pendingBubble.toolName ? ` · ${pendingBubble.toolName}` : ""}
            </div>
            <MarkdownText text={pendingBubble.label} />
          </div>
        )}
      </div>

      {/* Send footer (260714-jdyg-chat-send) — a `shrink-0` footer of this
          `flex-1 min-h-0` column, so the existing useVisualViewport pin keeps it
          above the on-screen keyboard and the transcript keeps its auto-follow. */}
      <ChatSendForm onSend={onSend} busy={busy} />
    </div>
  );
}

/** Max input rows before the textarea scrolls internally (bounded auto-grow). */
const MAX_TEXTAREA_ROWS = 6;

/**
 * The chat send input: an auto-growing monospace textarea + house-chip Insert /
 * Send buttons. Enter policy is the shared pointer-aware `classifyComposeEnter`
 * (260719-mxvw — the SAME classifier the compose strip uses; the two surfaces
 * must not diverge): fine pointer Enter submits / Shift+Enter newline; coarse
 * pointer Enter inserts a newline (Send button submits); Cmd/Ctrl+Enter submits
 * always; Alt+Enter — and the Insert button — send with `submit: false` (paste
 * into the agent's input box, gated Enter skipped). `enterkeyhint` tracks what
 * Enter actually does. In-flight-locked (no double-send, shared by submit and
 * insert); text clears on success and is kept on failure with an inline
 * `role="alert"` error carrying the server's structured message. A non-blocking
 * "will be queued" hint shows while the agent is busy (the input stays enabled —
 * Allow + probe policy). On a fine pointer the input auto-focuses on mount (the
 * chat lens just activated); coarse pointers skip it so the keyboard stays down.
 */
function ChatSendForm({
  onSend,
  busy,
}: {
  onSend: (text: string, submit: boolean) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Live pointer type drives BOTH the Enter policy and `enterkeyhint` — one
  // subscription so hint and behavior can never disagree (260719-mxvw).
  const coarse = useCoarsePointer();

  // Auto-grow to content, bounded to MAX_TEXTAREA_ROWS (then internal scroll).
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * MAX_TEXTAREA_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useLayoutEffect(resize, [text, resize]);

  // Desktop-only autofocus on mount (the chat lens just activated). Skip on
  // coarse pointers so the on-screen keyboard does not pop unbidden. Mount-only
  // by design: a live pointer-capability change must not steal focus, so the
  // hook value is read once here and deliberately not a dependency.
  useEffect(() => {
    if (!coarse) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    async (submitMode: boolean) => {
      if (sending) return; // in-flight lock — double-Enter / double-click no-op
      const trimmed = text.trim();
      if (trimmed === "") return; // empty / whitespace-only never submits
      setSending(true);
      setError(null);
      try {
        await onSend(text, submitMode);
        setText(""); // clear on success (insert-mode: the text now lives in the pane's input box)
      } catch (e) {
        // Keep the text on failure; surface the server's structured error inline.
        setError(e instanceof Error ? e.message : "Failed to send message");
      } finally {
        setSending(false);
      }
    },
    [onSend, sending, text],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Shared pointer-aware Enter policy (classifyComposeEnter — the SAME
    // classifier the compose strip uses). "default" means: do not intercept —
    // the textarea inserts a newline (Shift+Enter anywhere, plain Enter on
    // coarse pointers, IME composition).
    const action = classifyComposeEnter(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isComposing: e.nativeEvent.isComposing,
      },
      coarse,
    );
    if (action === "default") return;
    // Stop propagation so a submitting/inserting Enter never bubbles to global
    // chords.
    e.preventDefault();
    e.stopPropagation();
    void submit(action === "submit");
  };

  const canSend = !sending && text.trim() !== "";

  return (
    <div className="shrink-0 border-t border-border px-3 py-2 bg-bg-primary flex flex-col gap-1.5">
      {error && (
        <div
          role="alert"
          className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-400"
          data-testid="chat-send-error"
        >
          {error}
        </div>
      )}
      {busy && (
        <div
          className="text-xs text-text-secondary select-none"
          data-testid="chat-send-busy-hint"
        >
          agent is working — message will be queued
        </div>
      )}
      {/* One warm-tip cluster for the send row (260722-73al); placement `top`
          — the form sits at the bottom of the chat lens. */}
      <TipGroup>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the agent…"
          aria-label="Message the agent"
          // Truthful hint: "send" only where Enter actually submits (fine
          // pointer); coarse pointers get the default newline action.
          enterKeyHint={coarse ? "enter" : "send"}
          data-testid="chat-send-input"
          className="rk-chat-input flex-1 min-h-0 resize-none rounded border border-border bg-bg-inset px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
        />
        {/* Old parenthesized-shortcut titles become label + keycap chips
            (tier-1 kbd slot). The coarse "Ctrl/⌘+Enter" title branch is gone:
            tips never render on coarse pointers, so only the fine-pointer
            shortcut is ever shown. */}
        <Tip label="Insert without submitting" kbd="Alt+Enter" placement="top">
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={!canSend}
            aria-label="Insert message without submitting"
            data-testid="chat-send-insert"
            className="rk-glint shrink-0 rounded border border-border px-3 py-2 font-mono text-sm text-text-secondary select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-[36px]"
          >
            Insert
          </button>
        </Tip>
        <Tip label="Send" kbd="Enter" placement="top">
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={!canSend}
            aria-label="Send message"
            data-testid="chat-send-button"
            className="rk-glint shrink-0 rounded border border-border px-3 py-2 font-mono text-sm text-text-primary select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-[36px]"
          >
            {sending ? "…" : "Send"}
          </button>
        </Tip>
      </div>
      </TipGroup>
    </div>
  );
}

/** One turn: renders its message bubbles and tool-call cards in arrival order. */
function TurnBlock({ turn }: { turn: ChatTurn }) {
  const cards = pairToolEvents(turn.events);
  // Index tool cards by the tool_use event id so we render each card once,
  // inline where its tool_use appears (skip the paired tool_result — it rides
  // the card). Message events render as bubbles.
  const cardByUseKey = new Map<string, ToolCardData>();
  for (const c of cards) {
    cardByUseKey.set(toolKey(c.use), c);
  }
  const renderedResultIds = new Set<string>();
  for (const c of cards) {
    if (c.result?.id) renderedResultIds.add(c.result.id);
    if (c.result?.toolUseId) renderedResultIds.add(`tuid:${c.result.toolUseId}`);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="chat-turn">
      {turn.events.map((e, i) => {
        if (e.type === "message") {
          return <MessageBubble key={e.id ?? `m-${i}`} event={e} />;
        }
        if (e.type === "tool_use") {
          const card = cardByUseKey.get(toolKey(e));
          return card ? <ToolCard key={e.id ?? `t-${i}`} card={card} /> : null;
        }
        // tool_result: skip when it was consumed by a card (the normal case).
        if (e.type === "tool_result") {
          const consumed =
            (e.id && renderedResultIds.has(e.id)) ||
            (e.toolUseId && renderedResultIds.has(`tuid:${e.toolUseId}`));
          if (consumed) return null;
          // Orphan tool_result (no matching tool_use in this turn) — render bare.
          return <ToolResultOrphan key={e.id ?? `r-${i}`} event={e} />;
        }
        return null;
      })}
    </div>
  );
}

function toolKey(use: ChatEvent): string {
  return use.id ?? use.toolUseId ?? "";
}

/** A user/assistant message bubble, visually distinct by role. */
function MessageBubble({ event }: { event: ChatEvent }) {
  const isUser = event.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={isUser ? "chat-bubble-user" : "chat-bubble-assistant"}
    >
      <div
        className={`max-w-[90%] rounded px-3 py-2 border ${
          isUser
            ? "bg-bg-card border-border text-text-primary"
            : "bg-bg-inset border-border text-text-primary"
        }`}
      >
        <MarkdownText text={event.text ?? ""} />
      </div>
    </div>
  );
}

/**
 * A collapsible tool-call card (collapsed by default). Header shows `toolName`;
 * the body shows pretty-printed `toolInput` JSON + `toolOutput` text; an
 * `isError` result is styled as an error.
 */
function ToolCard({ card }: { card: ToolCardData }) {
  const [open, setOpen] = useState(false);
  const { use, result } = card;
  const isError = result?.isError === true;
  return (
    <div
      className={`rounded border ${isError ? "border-red-500/50" : "border-border"} bg-bg-card`}
      data-testid="chat-tool-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:text-text-primary transition-colors"
      >
        <span aria-hidden="true" className="select-none">
          {open ? "▾" : "▸"}
        </span>
        <span className="font-semibold text-text-primary">
          {use.toolName ?? "tool"}
        </span>
        {isError && (
          <span className="text-xs text-red-400 uppercase tracking-wide">error</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-col gap-2 text-xs">
          {use.toolInput !== undefined && use.toolInput !== null && (
            <div>
              <div className="text-text-secondary mb-0.5">input</div>
              <pre className="whitespace-pre-wrap break-words text-text-primary bg-bg-inset rounded p-2 overflow-x-auto">
                {prettyJson(use.toolInput)}
              </pre>
            </div>
          )}
          {result?.toolOutput != null && result.toolOutput !== "" && (
            <div>
              <div className="text-text-secondary mb-0.5">output</div>
              <pre
                className={`whitespace-pre-wrap break-words rounded p-2 overflow-x-auto ${
                  isError ? "text-red-400 bg-red-500/10" : "text-text-primary bg-bg-inset"
                }`}
              >
                {result.toolOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A tool_result with no matching tool_use in its turn — rendered bare. */
function ToolResultOrphan({ event }: { event: ChatEvent }) {
  if (event.toolOutput == null || event.toolOutput === "") return null;
  return (
    <div className="rounded border border-border bg-bg-card px-3 py-2 text-xs" data-testid="chat-tool-result-orphan">
      <pre
        className={`whitespace-pre-wrap break-words ${
          event.isError ? "text-red-400" : "text-text-primary"
        }`}
      >
        {event.toolOutput}
      </pre>
    </div>
  );
}

/**
 * Markdown text via react-markdown + remark-gfm. Code blocks render as plain
 * monospace `<pre>` (no syntax highlighting in v1 — terminal aesthetic). Inline
 * code and fenced blocks are styled with the theme's inset background.
 */
function MarkdownText({ text }: { text: string }) {
  return (
    <div className="chat-markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Fenced code blocks: the `pre` wrapper owns the block styling; the
          // inner `code` stays unstyled so we don't double-box it.
          pre: ({ children }) => (
            <pre className="whitespace-pre-wrap break-words bg-bg-inset rounded p-2 overflow-x-auto my-1">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            // Distinguish fenced/indented code blocks (rendered inside the styled
            // `<pre>` above) from inline code. react-markdown v10 dropped the
            // `inline` prop, and a fenced block WITHOUT a language has no
            // `language-*` class — so a class check alone would mis-tint it as
            // inline and double-box it inside the already-styled `<pre>`. Block
            // code content always carries a trailing newline; inline never does,
            // so a newline in the text is the reliable block signal.
            const text = childrenToText(children);
            const isBlock = /language-/.test(className ?? "") || text.includes("\n");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            // Inline code (single-line, no language class): tint it.
            return (
              <code className="bg-bg-inset rounded px-1 py-0.5" {...props}>
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Flatten react-markdown `code` children to their text content so a fenced
 * block can be detected by its trailing newline (react-markdown v10 has no
 * `inline` prop, and a language-less fence carries no `language-*` class).
 * Children are typically a single string; guard the array/other cases.
 */
function childrenToText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  return "";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
