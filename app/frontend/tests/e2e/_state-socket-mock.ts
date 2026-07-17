import type { Page } from "@playwright/test";

// Shared Playwright mock for the state socket (`/ws/state`, change 260716-qf3j).
//
// Before this change, e2e specs mocked `GET /api/sessions/stream` by fulfilling
// a `text/event-stream` frame. The frontend now speaks the state-socket
// WebSocket protocol, so those SSE mocks are dead — the session/metrics payloads
// must be delivered over `/ws/state` instead. This helper answers the protocol:
//
//   client → server: {op:"hello"}                    → replay cached global slots
//                     {op:"subscribe",kind:"server",key,req} → ack{snapshot: sessions}
//                                                       then live sessions event
//                     {op:"subscribe",kind:"metrics",req}    → ack{snapshot: metrics}
//                                                       then metrics + services events
//                     {op:"subscribe",kind:"chat",key,from,req} → ack{offset: from}
//                                                       (NO snapshot, D5) then any
//                                                       configured chat events
//                     {op:"unsubscribe"|"preview-scope"}     → ignored (no-op)
//
// The chat BACKFILL is NOT on the socket (D5) — it demoted to GET
// /api/windows/{id}/chat, which specs mock as a plain `page.route`. This mock only
// answers the incremental `kind:"chat"` subscription (the retired chat SSE's live
// half). Terminal stubs stay on `/ws/terminals`; do NOT add `/relay/` or SSE-based
// stubs (memory `relay-mux-stale-ws-stub-class`).
//
// Payloads are delivered VERBATIM inside the envelope's `data`, matching the
// backend's contract-preservation rule, so specs assert on the same rendered UI
// they did under SSE.

export type StateSocketMockOptions = {
  /** The sessions JSON string delivered as the per-server subscribe ack snapshot
   *  and as a live `sessions` event. This is exactly the payload specs used to
   *  put in the SSE `event: sessions\ndata: <sessions>` frame. */
  sessions?: string;
  /** Optional host-metrics snapshot object (delivered as a `metrics` global). */
  metrics?: unknown;
  /** Optional services snapshot ({services:[...]}) delivered as a `services` global. */
  services?: unknown;
  /** Optional version slot ({version,boot,brew}) delivered on hello. */
  version?: unknown;
  /** Optional update-available slot ({current,latest}) delivered on hello. */
  updateAvailable?: unknown;
  /** Optional server-order slot ({order:[...]}) delivered on hello. */
  serverOrder?: unknown;
  /** Optional board-order slot ({order:[...]}) delivered on hello. */
  boardOrder?: unknown;
  /** Chat subscription support (260717-vhvz). When set, a `kind:"chat"` subscribe
   *  is acked with `{offset}` (no snapshot — D5; the transcript came from the GET
   *  backfill, which specs mock as a plain `page.route` on
   *  `**\/api/windows/*\/chat*`). The `offset` echoes the subscribe's `from` (so
   *  the composition stays consistent). After the ack, any `events` are emitted as
   *  a `kind:"chat"` `chat` event and `state` (if present) as a `chat-state` event
   *  — so a spec can drive incremental appends / a pending transition without SSE.
   *  A `reset:true` also emits a `chat-reset` after the ack. */
  chat?: {
    /** Incremental chat events emitted after the ack (a `kind:"chat"` `chat`
     *  event carrying this ChatEvent[]). */
    events?: unknown[];
    /** A `chat-state` `{pending}` payload emitted after the ack. */
    state?: { pending: unknown } | null;
    /** Emit a `chat-reset` after the ack (rotation drill). */
    reset?: boolean;
  };
};

/** Install a `/ws/state` mock speaking the state-socket protocol. Call before
 *  `page.goto`. Returns nothing — specs drive the UI via the delivered payloads.
 *  (Live-event specs — server-reorder, board-reorder, board-list-reorder — run
 *  against the real backend instead of this mock.) */
export async function mockStateSocket(page: Page, opts: StateSocketMockOptions = {}): Promise<void> {
  await page.routeWebSocket(/\/ws\/state/, (ws) => {
    // Do NOT connectToServer — this is a full mock (no real backend).
    const emitGlobal = (type: string, data: unknown) =>
      ws.send(JSON.stringify({ op: "event", kind: "global", type, data }));

    const emitChat = (key: string, type: string, data: unknown) =>
      ws.send(JSON.stringify({ op: "event", kind: "chat", key, type, data }));

    ws.onMessage((message) => {
      let msg: { op?: string; kind?: string; key?: string; req?: number; from?: number };
      try {
        msg = JSON.parse(typeof message === "string" ? message : message.toString());
      } catch {
        return;
      }
      switch (msg.op) {
        case "hello":
          // Replay cached global slots (mirrors the backend's hello behavior).
          if (opts.metrics !== undefined) emitGlobal("metrics", opts.metrics);
          if (opts.services !== undefined) emitGlobal("services", opts.services);
          if (opts.serverOrder !== undefined) emitGlobal("server-order", opts.serverOrder);
          if (opts.boardOrder !== undefined) emitGlobal("board-order", opts.boardOrder);
          if (opts.version !== undefined) emitGlobal("version", opts.version);
          if (opts.updateAvailable !== undefined) emitGlobal("update-available", opts.updateAvailable);
          break;
        case "subscribe":
          if (msg.kind === "server" && typeof msg.key === "string") {
            // Ack with the sessions snapshot (verbatim), then a live event so
            // the frontend's slice update fires either way.
            const snapshot = opts.sessions !== undefined ? JSON.parse(opts.sessions) : null;
            ws.send(JSON.stringify({ op: "ack", req: msg.req, snapshot }));
            if (opts.sessions !== undefined) {
              ws.send(
                JSON.stringify({
                  op: "event",
                  kind: "server",
                  key: msg.key,
                  type: "sessions",
                  data: JSON.parse(opts.sessions),
                }),
              );
            }
          } else if (msg.kind === "metrics") {
            const snapshot = opts.metrics !== undefined ? opts.metrics : null;
            ws.send(JSON.stringify({ op: "ack", req: msg.req, snapshot }));
            if (opts.metrics !== undefined) emitGlobal("metrics", opts.metrics);
            if (opts.services !== undefined) emitGlobal("services", opts.services);
          } else if (msg.kind === "chat" && typeof msg.key === "string") {
            // Chat ack carries the tail-start offset (echo `from`), NO snapshot
            // (D5 — the transcript came from the GET backfill). Then emit any
            // configured incremental events / pending state / reset.
            ws.send(JSON.stringify({ op: "ack", req: msg.req, offset: msg.from ?? 0 }));
            const chat = opts.chat;
            if (chat) {
              if (chat.events && chat.events.length > 0) emitChat(msg.key, "chat", chat.events);
              if (chat.state !== undefined) emitChat(msg.key, "chat-state", chat.state);
              if (chat.reset) emitChat(msg.key, "chat-reset", {});
            }
          }
          break;
        default:
          // unsubscribe / preview-scope — no-op for the mock.
          break;
      }
    });
  });
}
