import { test, expect } from "@playwright/test";
import { apiBase, pinWindow } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// Behavioural contract for the board pane reorder backend surface as consumed
// by the frontend wiring: the fractional-index POST /api/boards/{name}/reorder
// endpoint (moves a pinned pane by minting an orderKey strictly between its
// new before/after neighbours), the reordered GET /api/boards/{name} result
// (entries sorted by orderKey), and the per-server `board-changed`
// state-socket event (change: "reorder") that useBoardEntries refetches on
// with a 50ms debounce to reconcile the optimistic drag override.
//
// The frontend reorder is wired two ways — header drag-and-drop and the
// palette Move Focused Pane Left/Right — but both converge on ONE reorderPin
// POST carrying the moved pane's new neighbour windowIds. Native HTML5 drag is
// unreliable to simulate in Playwright and page.reload() does not commit under
// the SPA's long-lived state socket, so a "drag then reload and assert order"
// e2e cannot be made deterministic; this spec exercises the endpoint, the
// reordered GET, and the socket echo against the live backend, which IS
// deterministic. The neighbour arithmetic (computeReorderNeighbors /
// computeMoveNeighbors), the custom-MIME guard, the insert-before splice, and
// the derive-over-store reconcile are covered by Vitest unit tests
// (board-reorder.test.ts, use-board-pane-reorder.test.ts).
//
// Shared setup: beforeAll creates `e2e-board-reorder-<ts>` on E2E_TMUX_SERVER
// (default `rk-test-e2e`) with windows win-a/win-b; afterAll kills the home
// session (pin-sessions are reaped per test via unpin, or by the
// isolated-server global teardown on failure). Each test pins both windows to
// a fresh board `reo<ts>` (pin order = win-a, win-b), reorders, asserts, then
// unpins both so the board disappears (empty boards are not kept). winIds()
// reads the two windows' tmux ids in index order; apiBase() resolves the
// backend origin.

const TEST_SESSION = `e2e-board-reorder-${Date.now()}`;
const BOARD_NAME = `reo${Date.now().toString().slice(-6)}`;

/** Read the two test windows' ids in their tmux index order (win-a, win-b). */
function winIds(): { a: string; b: string } {
  const wins = listWindows(TEST_SESSION);
  const a = wins.find((w) => w.name === "win-a")?.windowId;
  const b = wins.find((w) => w.name === "win-b")?.windowId;
  if (!a || !b) {
    throw new Error(
      `could not resolve win ids from: ${wins.map((w) => `${w.windowId}:${w.name}`).join(", ")}`,
    );
  }
  return { a, b };
}

test.describe("Board pane reorder — reorder endpoint + board-changed SSE", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION, { windows: ["win-a", "win-b"] });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
    // Killing the home session does NOT reap the windows' pin-sessions: pinning
    // MOVES each window into its own `_rk-pin-<id>` session, so a pinned window
    // no longer lives in TEST_SESSION. Each test unpins both windows in its own
    // cleanup (the normal reaping path); any `_rk-pin-*` left by a mid-test
    // failure is reaped by the isolated-server global teardown
    // (global-teardown.ts kills the whole `rk-test-e2e*` server socket).
  });

  /**
   * Proves: pinning win-a then win-b yields board order [win-a, win-b]; a
   * single POST …/reorder moving win-b before win-a (before: null, after:
   * win-a) returns {ok: true, newOrderKey} and GET …/{board} then returns
   * [win-b, win-a] — the orderKey is authoritative and one POST per move is
   * sufficient (fractional indexing).
   *
   * Steps:
   * 1. Resolve win-a / win-b ids; POST …/pin each (assert ok).
   * 2. GET …/{board}; assert windowId order is [win-a, win-b].
   * 3. POST …/reorder {server, windowId: win-b, before: null, after: win-a};
   *    assert ok + non-empty newOrderKey.
   * 4. Poll GET …/{board} until the windowId order equals [win-b, win-a]
   *    (absorbs the tmux user-option write settling).
   * 5. Unpin both windows (cleanup).
   */
  test("reorder POST reorders entries by orderKey and GET reflects the new order", async ({
    request,
    baseURL,
  }) => {
    const base = apiBase(baseURL);
    const { a, b } = winIds();

    // Pin both windows. Initial board order follows pin order (win-a, win-b).
    for (const windowId of [a, b]) {
      await pinWindow(request, BOARD_NAME, TMUX_SERVER, windowId);
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

  /**
   * Proves: a successful reorder POST fans out a `board-changed` per-server
   * event (with change: "reorder", the board name, and the moved windowId) to
   * a state-socket connection subscribed to that server — the echo
   * useBoardEntries refetches on to reconcile the optimistic override.
   *
   * Steps:
   * 1. Pin both windows via page.request.
   * 2. Navigate to /board/<board> so the SPA's state socket connects.
   * 3. In the page context, open a WebSocket to /ws/state, send `hello` +
   *    `subscribe {kind:"server",key:<TMUX_SERVER>}`, and resolve on the first
   *    {op:"event",kind:"server",type:"board-changed"} frame's data.
   * 4. On the socket's onopen (deterministic — no fixed delay),
   *    POST …/reorder {windowId: win-b, before: null, after: win-a} from the
   *    page origin.
   * 5. Await the resolved frame; parse it and assert change === "reorder",
   *    board === <board>, and windowId === win-b (rejects if no frame arrives
   *    within the timeout).
   * 6. Unpin both windows (cleanup).
   */
  test("a successful reorder POST broadcasts a board-changed SSE event", async ({
    page,
    baseURL,
  }) => {
    const base = apiBase(baseURL);
    const { a, b } = winIds();

    // Pin both windows so the reorder has a valid neighbour.
    for (const windowId of [a, b]) {
      await pinWindow(page.request, BOARD_NAME, TMUX_SERVER, windowId);
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
