/**
 * Chat-stream schema + pure derivation helpers (260714-r7rq). Mirrors the
 * rk-owned, provider-neutral event schema shipped by Change 2
 * (`docs/memory/run-kit/chat.md` § "rk-owned neutral event schema"). Extracted
 * from the `use-chat-stream` hook and the `ChatView` renderer so the pure parts
 * (dedup, turn grouping, tool pairing, pending derivation) are unit-testable
 * without an `EventSource` or a mounted component — mirroring the
 * `palette-move.ts` / `palette-agent-nav.ts` extraction pattern.
 */

/** Event type discriminator (matches the backend `Type` field). */
export type ChatEventType = "message" | "tool_use" | "tool_result";

/** Message role (the backend filters `system`; kept in the union for tolerance). */
export type ChatRole = "user" | "assistant" | "system";

/**
 * A single normalized conversation event. Flat discriminated shape — matches the
 * backend `Event` JSON one-to-one (all optional fields carry `omitempty`
 * server-side, so any of them may be absent). `id` is the provider line uuid —
 * the stable dedup key. `turn` is the monotonic per-conversation counter the
 * adapter assigns (renderers group by it; no synthetic boundary events exist).
 */
export type ChatEvent = {
  type: ChatEventType;
  id?: string;
  turn: number;
  role?: ChatRole;
  text?: string;
  toolUseId?: string;
  toolName?: string;
  /** Verbatim provider JSON (backend `json.RawMessage`). Rendered pretty-printed. */
  toolInput?: unknown;
  toolOutput?: string;
  isError?: boolean;
  ts?: string;
};

/**
 * The retractable "agent is waiting on the user" state — NOT an append-only
 * event. Derived server-side from an unpaired tail tool_use. `text` is populated
 * when derivable (e.g. an AskUserQuestion prompt), else empty (the marker still
 * carries `toolUseId`/`toolName`).
 */
export type ChatPending = {
  toolUseId?: string;
  toolName?: string;
  text?: string;
};

/** The full conversation shape delivered by a `chat-backfill` event. */
export type Conversation = {
  provider: string;
  sessionRef: string;
  events: ChatEvent[];
  pending: ChatPending | null;
};

/**
 * Replace the client's event list on a `chat-backfill` (never append). Backfill
 * is delivered on connect AND on any reset/session-rotation, so the contract is
 * always "replace the whole view" (`chat.md` § "Reset-on-reconnect stream
 * contract"). Returns the conversation's events verbatim.
 */
export function applyChatBackfill(conv: Conversation): ChatEvent[] {
  return conv.events;
}

/**
 * Append newly-delivered `chat` events, deduped by `id` (the provider line
 * uuid). An event with no `id` cannot be deduped, so it is always appended
 * (defensive — the backend always stamps one, but the field is optional in the
 * schema). Preserves order: existing events first, then the new ones not already
 * present.
 */
export function appendChatEvents(
  existing: ChatEvent[],
  incoming: ChatEvent[],
): ChatEvent[] {
  const seen = new Set<string>();
  for (const e of existing) {
    if (e.id) seen.add(e.id);
  }
  const additions: ChatEvent[] = [];
  for (const e of incoming) {
    if (e.id && seen.has(e.id)) continue;
    if (e.id) seen.add(e.id);
    additions.push(e);
  }
  return additions.length === 0 ? existing : [...existing, ...additions];
}

/** A grouped turn: the turn counter + its events in arrival order. */
export type ChatTurn = { turn: number; events: ChatEvent[] };

/**
 * Group events by their `turn` counter into ordered turn blocks. Turns appear
 * in ascending counter order; within a turn, events keep arrival order. Renderers
 * consume this to draw per-turn bubble groups (no synthetic boundary events
 * exist — the counter IS the boundary).
 */
export function groupEventsByTurn(events: ChatEvent[]): ChatTurn[] {
  const order: number[] = [];
  const byTurn = new Map<number, ChatEvent[]>();
  for (const e of events) {
    let bucket = byTurn.get(e.turn);
    if (!bucket) {
      bucket = [];
      byTurn.set(e.turn, bucket);
      order.push(e.turn);
    }
    bucket.push(e);
  }
  order.sort((a, b) => a - b);
  return order.map((turn) => ({ turn, events: byTurn.get(turn)! }));
}

/**
 * A tool-call card: a `tool_use` optionally joined to its matching `tool_result`
 * by `toolUseId`. The result may be absent (still running / never persisted).
 */
export type ToolCard = { use: ChatEvent; result: ChatEvent | null };

/**
 * Pair `tool_use` events with their `tool_result` by `toolUseId`. Returns one
 * card per `tool_use` in arrival order, each joined to the FIRST matching
 * `tool_result` (a tool_use with no result yields `result: null`). Events that
 * are neither type are ignored (callers render messages separately). A
 * tool_result whose `toolUseId` matches no tool_use is dropped (defensive — the
 * backend pairs them, but a partial stream mid-append may briefly not).
 */
export function pairToolEvents(events: ChatEvent[]): ToolCard[] {
  const resultByUseId = new Map<string, ChatEvent>();
  for (const e of events) {
    if (e.type === "tool_result" && e.toolUseId && !resultByUseId.has(e.toolUseId)) {
      resultByUseId.set(e.toolUseId, e);
    }
  }
  const cards: ToolCard[] = [];
  for (const e of events) {
    if (e.type !== "tool_use") continue;
    const result = e.toolUseId ? resultByUseId.get(e.toolUseId) ?? null : null;
    cards.push({ use: e, result });
  }
  return cards;
}

/** The display shape for a pending-question bubble (null = nothing pending). */
export type PendingBubble = { label: string; toolName?: string } | null;

/**
 * Derive the pending-question bubble's display text from the `Pending` state.
 * Prefers `pending.text`; falls back to `toolName` when text is empty (per the
 * intake — "carrying `pending.text` (or `toolName` when text is empty)"). Returns
 * null when there is nothing pending, so the renderer clears the marker on a
 * `chat-state` `pending: null`.
 */
export function derivePendingBubble(pending: ChatPending | null): PendingBubble {
  if (!pending) return null;
  const label = (pending.text ?? "").trim() || (pending.toolName ?? "").trim();
  if (!label) return null;
  return { label, toolName: pending.toolName };
}
