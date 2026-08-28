import { test, expect } from "@playwright/test";
import { apiBase } from "./_boards";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER } from "./_tmux";

/**
 * Behavioural contract for the server-reorder backend surface: the
 * `POST /api/servers/order` endpoint (writes each server's `@rk_srv_rank`),
 * the nullable `rank` field on `GET /api/servers` (array stays alphabetical),
 * and the server-global `server-order` broadcast that fans out to every
 * state-socket connection — including a metrics-only subscription with no
 * attached tmux server.
 *
 * Why this slice (not a drag simulation): server drag-reorder needs ≥2
 * regular (non-infra) servers, but the isolated e2e harness only provides
 * `rk-test-*` sockets (which `isInfraServer` treats as non-draggable infra)
 * and cannot create genuinely-regular servers without leaking sockets outside
 * the `rk-test-e2e*` teardown glob. Native HTML5 drag is also unreliable to
 * simulate in Playwright, and `page.reload()` does not commit under the SPA's
 * long-lived state socket. So this spec exercises the load-bearing surface —
 * the order endpoint and its server-global echo — end-to-end against the live
 * backend, which IS deterministic. The comparator, context re-sort, drag
 * handlers, and palette Move actions are covered by Vitest unit tests.
 *
 * Shared setup: uses `E2E_TMUX_SERVER` (default `rk-test-e2e`) as the live
 * server; no extra sessions are created — the endpoint operates on the server
 * socket itself. `apiBase(baseURL)` resolves the backend origin (default
 * `http://localhost:${RK_PORT ?? 3020}`). Persisted rank is harmless leftover
 * state; no teardown reset is needed (the option has no HTTP "unset" and
 * ranks don't affect the alphabetical `/api/servers` array).
 */
test.describe("Server reorder — order endpoint + server-global SSE", () => {
  /**
   * Proves: posting `{order: [rk-test-e2e]}` returns `{ok: true}`, writes
   * rank 0 to that server, and `GET /api/servers` then reports `rank: 0` on
   * its entry while the array remains alphabetical.
   *
   * Steps:
   * 1. `POST /api/servers/order` with `{order: [TMUX_SERVER]}`; assert `ok` +
   *    `{ok: true}` body.
   * 2. `GET /api/servers`; assert the `name` array equals its own
   *    alphabetical sort (order contract preserved).
   * 3. Find the `TMUX_SERVER` entry; assert `rank === 0`.
   */
  test("POST /api/servers/order persists rank and returns ok", async ({ request, baseURL }) => {
    const base = apiBase(baseURL);

    // POST an order containing the live e2e server. The endpoint writes rank i
    // to the i-th server best-effort; a single-element order writes rank 0.
    const postResp = await request.post(`${base}/api/servers/order`, {
      headers: { "Content-Type": "application/json" },
      data: { order: [TMUX_SERVER] },
    });
    expect(postResp.ok(), `POST /api/servers/order → ${postResp.status()}`).toBeTruthy();
    expect(await postResp.json()).toEqual({ ok: true });

    // GET /api/servers now carries the persisted rank on that server's entry,
    // while the array stays alphabetical (asserted contract).
    const listResp = await request.get(`${base}/api/servers`);
    expect(listResp.ok()).toBeTruthy();
    const servers = (await listResp.json()) as Array<{ name: string; rank: number | null }>;
    const names = servers.map((s) => s.name);
    const sortedNames = [...names].sort();
    expect(names).toEqual(sortedNames); // alphabetical contract preserved

    const entry = servers.find((s) => s.name === TMUX_SERVER);
    expect(entry, `entry for ${TMUX_SERVER}`).toBeTruthy();
    expect(entry!.rank).toBe(0);
  });

  /**
   * Proves: names are validated before any tmux write — an order containing
   * `"bad name!"` (fails `ValidateServerName`) returns HTTP 400.
   *
   * Steps:
   * 1. `POST /api/servers/order` with `{order: ["bad name!"]}`.
   * 2. Assert status is `400`.
   */
  test("an invalid server name in the order is rejected with 400", async ({ request, baseURL }) => {
    const base = apiBase(baseURL);
    const resp = await request.post(`${base}/api/servers/order`, {
      headers: { "Content-Type": "application/json" },
      data: { order: ["bad name!"] },
    });
    expect(resp.status()).toBe(400);
  });

  /**
   * Proves: a successful order POST fans out a `server-order` global event to
   * a state-socket connection subscribed to metrics only (no attached tmux
   * server), proving the broadcast is server-global — the Host with zero
   * attached servers still hears order changes.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
   * 2. In the page context, open a `WebSocket` to `/ws/state`, send `hello` +
   *    `subscribe {kind:"metrics"}`, and resolve on the first
   *    `{op:"event",kind:"global",type:"server-order"}` frame's `data`.
   * 3. On the socket's `onopen` (deterministic — no fixed delay), `fetch(POST
   *    /api/servers/order, {order: [TMUX_SERVER]})` from the page origin.
   * 4. Await the resolved frame; parse it and assert `order` contains
   *    `TMUX_SERVER`. (Rejects if no frame arrives within the timeout.)
   */
  test("a successful order POST broadcasts a server-global event: server-order", async ({
    page,
    baseURL,
  }) => {
    // Open a browser page and hook the SPA's state socket by listening for the
    // server-order envelope the backend fans out to every connection. We
    // navigate to the server route so the socket connects, then read raw frames
    // via a small in-page bridge on the state socket.
    await gotoServerReady(page, TMUX_SERVER);

    // Install an in-page state-socket client subscribed to metrics (the
    // server-neutral subscription), proving the broadcast reaches even a
    // connection with NO server subscription (the server-global contract).
    // Resolve on the first `server-order` global event.
    const orderPromise = page.evaluate((server) => {
      return new Promise<string>((resolve, reject) => {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/ws/state`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("no server-order frame within timeout"));
        }, 15_000);
        ws.onopen = () => {
          ws.send(JSON.stringify({ op: "hello", conn: "e2e-server-reorder" }));
          ws.send(JSON.stringify({ op: "subscribe", kind: "metrics", req: 1 }));
          void fetch("/api/servers/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: [server] }),
          });
        };
        ws.onmessage = (e: MessageEvent) => {
          try {
            const m = JSON.parse(e.data as string);
            if (m.op === "event" && m.kind === "global" && m.type === "server-order") {
              clearTimeout(timer);
              ws.close();
              resolve(JSON.stringify(m.data));
            }
          } catch {
            /* ignore malformed frame */
          }
        };
      });
    }, TMUX_SERVER);

    const data = await orderPromise;
    const parsed = JSON.parse(data) as { order: string[] };
    expect(parsed.order).toContain(TMUX_SERVER);
  });
});
