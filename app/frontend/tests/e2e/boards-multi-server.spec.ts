import { test, expect } from "@playwright/test";
import { pinWindow, trackPin, unpinAll } from "./_boards";
import { TMUX_SERVER, TMUX_FAMILY, createSession, killServer, killSession, listWindows } from "./_tmux";

// The board view aggregates pinned windows sharing a board name across
// multiple tmux servers. In the move-based model each pinned window's
// pin-session (`_rk-pin-<id>`) lives on a single tmux server (boards are
// server-scoped), but GET /api/boards/<name> and the board page UNION every
// pin-session carrying that pin-board name across all reachable servers.
//
// Shared setup: beforeAll creates a session with one named window on the
// primary e2e tmux server (srv-a-win) plus a second tmux server (named inside
// this worktree's socket family via the TMUX_FAMILY anchor, with the
// Playwright process.pid embedded so the automatic post-sweep can parse it)
// with its own session (srv-b-win). Every pin is registered with the shared
// `_boards.ts` cleanup registry (trackPin); afterAll runs unpinAll
// (best-effort unpin of every tracked entry, so the persistent primary e2e
// server carries no stale `_rk-pin-*` pin-sessions into later runs), then
// kills the primary session and the secondary tmux server entirely.

const TMUX_SERVER_A = TMUX_SERVER;
// Second tmux server, set up explicitly so the cross-server union has a real
// counterpart. Named inside this worktree's socket family (TMUX_FAMILY anchor)
// with the Playwright process.pid as the second-to-last hyphen field, so the
// automatic post-sweep can parse it like any Go test socket. The trailing
// suffix is a single hyphen-free token (epoch tail) to keep the PID position
// unambiguous.
const TMUX_SERVER_B = `${TMUX_FAMILY}multi-${process.pid}-${Date.now().toString().slice(-6)}`;
const TEST_SESSION_A = `e2e-board-multi-a-${Date.now()}`;
const TEST_SESSION_B = `e2e-board-multi-b-${Date.now()}`;
const BOARD_NAME = `multi${Date.now().toString().slice(-6)}`;

test.describe("Boards: multi-server union", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION_A, { server: TMUX_SERVER_A, windows: ["srv-a-win"] });
    createSession(TEST_SESSION_B, { server: TMUX_SERVER_B, windows: ["srv-b-win"] });
  });

  test.afterAll(async ({ request }) => {
    // Unpin while servers are still alive — each pin lives in a `_rk-pin-*`
    // session that PERSISTS across restarts (and survives killing the SOURCE
    // session), so without this the persistent primary e2e server would carry
    // stale pin-sessions into later runs.
    await unpinAll(request);

    killSession(TEST_SESSION_A, { server: TMUX_SERVER_A });
    killServer(TMUX_SERVER_B);
  });

  /**
   * Proves: pinning windows from two different tmux servers to the same board
   * name makes both windows appear on the board page — the cross-server
   * board-name aggregation contract holds end-to-end through the HTTP API and
   * the UI render path, even though each pin-session is server-local.
   *
   * Steps:
   * 1. Read each server's window id via tmux list-windows so pin POSTs target
   *    real windows.
   * 2. POST /api/boards/<name>/pin for server A's window via page.request and
   *    record the entry for cleanup.
   * 3. POST /api/boards/<name>/pin for server B's window via page.request and
   *    record the entry for cleanup.
   * 4. GET /api/boards/<name> and assert the returned entries include both
   *    server names — the API-level union holds.
   * 5. Navigate to /board/<name> (domcontentloaded — no waiting on every xterm
   *    WebSocket) and assert both `srv-a-win` and `srv-b-win` are visible —
   *    the UI render path also holds.
   */
  test("a board with windows from two servers shows the union on /board/<name>", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const winIdA = listWindows(TEST_SESSION_A, { server: TMUX_SERVER_A })[0]?.windowId;
    const winIdB = listWindows(TEST_SESSION_B, { server: TMUX_SERVER_B })[0]?.windowId;

    // Pin both windows via the HTTP API. Server is in the body per the spec.
    await pinWindow(page.request, BOARD_NAME, TMUX_SERVER_A, winIdA!);
    trackPin({ board: BOARD_NAME, server: TMUX_SERVER_A, windowId: winIdA! });
    await pinWindow(page.request, BOARD_NAME, TMUX_SERVER_B, winIdB!);
    trackPin({ board: BOARD_NAME, server: TMUX_SERVER_B, windowId: winIdB! });

    // Verify GET /api/boards/<name> returns entries from both servers.
    const get = await page.request.get(`/api/boards/${BOARD_NAME}`);
    expect(get.ok()).toBeTruthy();
    const entries = (await get.json()) as Array<{ server: string }>;
    const servers = new Set(entries.map((e) => e.server));
    expect(servers.has(TMUX_SERVER_A)).toBeTruthy();
    expect(servers.has(TMUX_SERVER_B)).toBeTruthy();

    // Navigate to the board view. Use `domcontentloaded` to avoid waiting
    // for every xterm WebSocket to settle.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("srv-a-win").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("srv-b-win").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
