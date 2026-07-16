import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-board-reorder-${Date.now()}`;
const BOARD_NAME = `reo${Date.now().toString().slice(-6)}`;

function apiBase(baseURL: string | undefined): string {
  return baseURL ?? `http://localhost:${process.env.RK_PORT ?? 3020}`;
}

/** Read the two test windows' ids in their tmux index order (win-a, win-b). */
function winIds(): { a: string; b: string } {
  const lines = execSync(
    `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
  )
    .toString()
    .trim()
    .split("\n");
  const a = lines.find((l) => l.endsWith(":win-a"))?.split(":")[0];
  const b = lines.find((l) => l.endsWith(":win-b"))?.split(":")[0];
  if (!a || !b) throw new Error(`could not resolve win ids from: ${lines.join(", ")}`);
  return { a, b };
}

test.describe("Board pane reorder — reorder endpoint + board-changed SSE", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a`,
        { stdio: "ignore" },
      );
      execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b`, {
        stdio: "ignore",
      });
    } catch {
      // best effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // best effort
    }
    // Killing the home session does NOT reap the windows' pin-sessions: pinning
    // MOVES each window into its own `_rk-pin-<id>` session, so a pinned window
    // no longer lives in TEST_SESSION. Each test unpins both windows in its own
    // cleanup (the normal reaping path); any `_rk-pin-*` left by a mid-test
    // failure is reaped by the isolated-server global teardown
    // (global-teardown.ts kills the whole `rk-test-e2e*` server socket).
  });

  test("reorder POST reorders entries by orderKey and GET reflects the new order", async ({
    request,
    baseURL,
  }) => {
    const base = apiBase(baseURL);
    const { a, b } = winIds();

    // Pin both windows. Initial board order follows pin order (win-a, win-b).
    for (const windowId of [a, b]) {
      const pin = await request.post(`${base}/api/boards/${BOARD_NAME}/pin`, {
        headers: { "Content-Type": "application/json" },
        data: { server: TMUX_SERVER, windowId },
      });
      expect(pin.ok(), `pin ${windowId} → ${pin.status()}`).toBeTruthy();
    }

    // Sanity: GET returns both, win-a before win-b.
    const before = await request.get(`${base}/api/boards/${BOARD_NAME}`);
    expect(before.ok()).toBeTruthy();
    const beforeEntries = (await before.json()) as Array<{ windowId: string }>;
    expect(beforeEntries.map((e) => e.windowId)).toEqual([a, b]);

    // Move win-b BEFORE win-a: the moved pane's new neighbours are
    // before=null (lands first), after=win-a. Single POST (fractional index).
    const reorder = await request.post(`${base}/api/boards/${BOARD_NAME}/reorder`, {
      headers: { "Content-Type": "application/json" },
      data: { server: TMUX_SERVER, windowId: b, before: null, after: a },
    });
    expect(reorder.ok(), `reorder → ${reorder.status()}`).toBeTruthy();
    const rbody = (await reorder.json()) as { ok: boolean; newOrderKey: string };
    expect(rbody.ok).toBe(true);
    expect(rbody.newOrderKey).toBeTruthy();

    // GET now returns win-b before win-a (orderKey authoritative). Poll to
    // absorb the tmux user-option write settling.
    await expect
      .poll(
        async () => {
          const r = await request.get(`${base}/api/boards/${BOARD_NAME}`);
          const entries = (await r.json()) as Array<{ windowId: string }>;
          return entries.map((e) => e.windowId);
        },
        { timeout: 10_000 },
      )
      .toEqual([b, a]);

    // Cleanup: unpin both so the board disappears (empty boards aren't kept).
    for (const windowId of [a, b]) {
      await request.post(`${base}/api/boards/${BOARD_NAME}/unpin`, {
        headers: { "Content-Type": "application/json" },
        data: { server: TMUX_SERVER, windowId },
      });
    }
  });

  test("a successful reorder POST broadcasts a board-changed SSE event", async ({
    page,
    baseURL,
  }) => {
    const base = apiBase(baseURL);
    const { a, b } = winIds();

    // Pin both windows so the reorder has a valid neighbour.
    for (const windowId of [a, b]) {
      const pin = await page.request.post(`${base}/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId },
      });
      expect(pin.ok()).toBeTruthy();
    }

    // Navigate so the state socket connects, then read raw frames via an in-page
    // state-socket client subscribed to the server (board-changed is a per-server
    // event fanned to that server's subscribers).
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    const eventPromise = page.evaluate(
      ({ server, board, windowId, after }) => {
        return new Promise<string>((resolve, reject) => {
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const ws = new WebSocket(`${proto}//${location.host}/ws/state`);
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error("no board-changed frame within timeout"));
          }, 15_000);
          ws.onopen = () => {
            ws.send(JSON.stringify({ op: "hello", conn: "e2e-board-reorder" }));
            ws.send(JSON.stringify({ op: "subscribe", kind: "server", key: server, req: 1 }));
            void fetch(`/api/boards/${encodeURIComponent(board)}/reorder`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ server, windowId, before: null, after }),
            });
          };
          ws.onmessage = (e: MessageEvent) => {
            try {
              const m = JSON.parse(e.data as string);
              if (m.op === "event" && m.kind === "server" && m.type === "board-changed") {
                clearTimeout(timer);
                ws.close();
                resolve(JSON.stringify(m.data));
              }
            } catch {
              /* ignore malformed frame */
            }
          };
        });
      },
      { server: TMUX_SERVER, board: BOARD_NAME, windowId: b, after: a },
    );

    const data = await eventPromise;
    const parsed = JSON.parse(data) as { board: string; change: string; windowId: string };
    expect(parsed.change).toBe("reorder");
    expect(parsed.board).toBe(BOARD_NAME);
    expect(parsed.windowId).toBe(b);

    // Cleanup.
    for (const windowId of [a, b]) {
      await page.request.post(`${base}/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId },
      });
    }
  });
});
