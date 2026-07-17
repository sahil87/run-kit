import { describe, it, expect } from "vitest";
import {
  applyChatBackfill,
  appendChatEvents,
  groupEventsByTurn,
  pairToolEvents,
  derivePendingBubble,
  type ChatEvent,
  type Conversation,
} from "./chat-stream";

function ev(partial: Partial<ChatEvent> & { type: ChatEvent["type"]; turn: number }): ChatEvent {
  return partial as ChatEvent;
}

describe("applyChatBackfill", () => {
  it("returns the conversation's events verbatim (replace semantics)", () => {
    const conv: Conversation = {
      provider: "claude",
      sessionRef: "uuid",
      events: [ev({ type: "message", turn: 1, id: "a" })],
      pending: null,
      offset: 0,
    };
    expect(applyChatBackfill(conv)).toEqual(conv.events);
  });
});

describe("appendChatEvents", () => {
  it("appends new events not already present by id", () => {
    const existing = [ev({ type: "message", turn: 1, id: "a" })];
    const incoming = [ev({ type: "message", turn: 1, id: "b" })];
    const out = appendChatEvents(existing, incoming);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("dedups an event whose id is already present", () => {
    const existing = [ev({ type: "message", turn: 1, id: "a" })];
    const incoming = [
      ev({ type: "message", turn: 1, id: "a" }),
      ev({ type: "message", turn: 1, id: "b" }),
    ];
    const out = appendChatEvents(existing, incoming);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("dedups within the incoming batch too", () => {
    const out = appendChatEvents([], [
      ev({ type: "message", turn: 1, id: "a" }),
      ev({ type: "message", turn: 1, id: "a" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("returns the same array reference when nothing is added (no churn)", () => {
    const existing = [ev({ type: "message", turn: 1, id: "a" })];
    const out = appendChatEvents(existing, [ev({ type: "message", turn: 1, id: "a" })]);
    expect(out).toBe(existing);
  });

  it("always appends an event with no id (cannot dedup)", () => {
    const out = appendChatEvents([], [
      ev({ type: "message", turn: 1 }),
      ev({ type: "message", turn: 1 }),
    ]);
    expect(out.length).toBe(2);
  });
});

describe("groupEventsByTurn", () => {
  it("groups by turn counter in ascending order, preserving arrival order within a turn", () => {
    const events = [
      ev({ type: "message", turn: 2, id: "b1" }),
      ev({ type: "message", turn: 1, id: "a1" }),
      ev({ type: "tool_use", turn: 2, id: "b2" }),
    ];
    const turns = groupEventsByTurn(events);
    expect(turns.map((t) => t.turn)).toEqual([1, 2]);
    expect(turns[1].events.map((e) => e.id)).toEqual(["b1", "b2"]);
  });
});

describe("pairToolEvents", () => {
  it("joins a tool_use to its tool_result by toolUseId", () => {
    const events = [
      ev({ type: "tool_use", turn: 1, id: "u1", toolUseId: "T1", toolName: "Read" }),
      ev({ type: "tool_result", turn: 1, id: "r1", toolUseId: "T1", toolOutput: "ok" }),
    ];
    const cards = pairToolEvents(events);
    expect(cards.length).toBe(1);
    expect(cards[0].use.id).toBe("u1");
    expect(cards[0].result?.id).toBe("r1");
  });

  it("leaves result null for an unpaired tool_use", () => {
    const cards = pairToolEvents([
      ev({ type: "tool_use", turn: 1, id: "u1", toolUseId: "T1" }),
    ]);
    expect(cards[0].result).toBeNull();
  });

  it("ignores message events", () => {
    const cards = pairToolEvents([ev({ type: "message", turn: 1, id: "m" })]);
    expect(cards).toEqual([]);
  });
});

describe("derivePendingBubble", () => {
  it("returns null when nothing is pending", () => {
    expect(derivePendingBubble(null)).toBeNull();
  });

  it("prefers pending.text", () => {
    expect(derivePendingBubble({ text: "Approve?", toolName: "AskUserQuestion" })).toEqual({
      label: "Approve?",
      toolName: "AskUserQuestion",
    });
  });

  it("falls back to toolName when text is empty", () => {
    expect(derivePendingBubble({ text: "", toolName: "Bash" })).toEqual({
      label: "Bash",
      toolName: "Bash",
    });
  });

  it("returns null when neither text nor toolName is usable", () => {
    expect(derivePendingBubble({ text: "   " })).toBeNull();
  });
});
