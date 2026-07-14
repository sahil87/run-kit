import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
 * Read-only HTML chat view over an agent pane (260714-r7rq — Change 3 of the
 * agent-chat-view plan). A SECOND view over the same tmux pane, never a
 * substrate: the pane stays the agent's parent (Constitution VI) and this only
 * ever RENDERS the streamed transcript. Consumes the dedicated per-view chat
 * `EventSource` via `use-chat-stream`; nothing is cached beyond component state
 * that dies with the view (Constitution II analog).
 *
 * House aesthetic throughout: monospace, three-mode theme tokens, animation
 * behind `prefers-reduced-motion` (the stick-to-bottom scroll uses `auto`
 * behavior — no smooth-scroll animation to gate — and there is no decorative
 * motion here).
 *
 * Read-only: NO input box. A visibly disabled footer affordance points at the
 * terminal view (send arrives in Change 4, chat-send).
 *
 * The chat stream is owned by the parent (`AppShell` calls `use-chat-stream`
 * once) so a single `EventSource` feeds BOTH this renderer and the connection
 * dot's health (R9) — this component is a pure renderer over the passed stream
 * state.
 */
export function ChatView({
  events,
  pending,
  connected,
  error,
}: {
  events: ChatEvent[];
  pending: ChatPending | null;
  connected: boolean;
  error: string | null;
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

      {/* Read-only footer — visibly disabled, points at the terminal view.
          Send arrives in Change 4 (chat-send). */}
      <div className="shrink-0 border-t border-border px-3 py-2 bg-bg-primary">
        <div
          className="w-full rounded border border-border bg-bg-inset px-3 py-2 text-text-secondary select-none cursor-not-allowed"
          aria-disabled="true"
          data-testid="chat-send-disabled"
          title="Send from the terminal view — coming in chat-send"
        >
          Send from the terminal view — coming in chat-send
        </div>
      </div>
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
