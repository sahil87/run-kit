import { test, expect } from "@playwright/test";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

function apiBase(baseURL: string | undefined): string {
  return baseURL ?? `http://localhost:${process.env.RK_PORT ?? 3020}`;
}

test.describe("Server reorder — order endpoint + server-global SSE", () => {
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

  test("an invalid server name in the order is rejected with 400", async ({ request, baseURL }) => {
    const base = apiBase(baseURL);
    const resp = await request.post(`${base}/api/servers/order`, {
      headers: { "Content-Type": "application/json" },
      data: { order: ["bad name!"] },
    });
    expect(resp.status()).toBe(400);
  });

  test("a successful order POST broadcasts a server-global event: server-order", async ({
    page,
    baseURL,
  }) => {
    // Open a browser page and hook the SPA's state socket by listening for the
    // server-order envelope the backend fans out to every connection. We
    // navigate to the server route so the socket connects, then read raw frames
    // via a small in-page bridge on the state socket.
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 15_000 });

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
