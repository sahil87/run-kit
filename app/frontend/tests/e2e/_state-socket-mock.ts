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
//                     {op:"unsubscribe"|"preview-scope"}     → ignored (no-op)
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

    ws.onMessage((message) => {
      let msg: { op?: string; kind?: string; key?: string; req?: number };
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
          }
          break;
        default:
          // unsubscribe / preview-scope — no-op for the mock.
          break;
      }
    });
  });
}
