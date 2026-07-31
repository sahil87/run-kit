import { test, expect } from "@playwright/test";
import { TMUX_SERVER, createSession, killServer, killSession, listWindows } from "./_tmux";

const TMUX_SERVER_A = TMUX_SERVER;
// Second tmux server, set up explicitly so the cross-server union has a real
// counterpart. Named under the unified rk-test-e2e-* umbrella with the
// Playwright process.pid as the second-to-last hyphen field, so the automatic
// post-sweep can parse it like any Go test socket. The trailing suffix is a
// single hyphen-free token (epoch tail) to keep the PID position unambiguous.
const TMUX_SERVER_B = `rk-test-e2e-multi-${process.pid}-${Date.now().toString().slice(-6)}`;
const TEST_SESSION_A = `e2e-board-multi-a-${Date.now()}`;
const TEST_SESSION_B = `e2e-board-multi-b-${Date.now()}`;
const BOARD_NAME = `multi${Date.now().toString().slice(-6)}`;

const pinnedEntries: Array<{ server: string; windowId: string }> = [];

test.describe("Boards: multi-server union", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION_A, { server: TMUX_SERVER_A, windows: ["srv-a-win"] });
    createSession(TEST_SESSION_B, { server: TMUX_SERVER_B, windows: ["srv-b-win"] });
  });

  test.afterAll(async ({ request }) => {
    // Unpin while servers are still alive — each pin lives in a `_rk-pin-*`
    // session that PERSISTS across restarts (and survives killing the SOURCE
    // session), so without this the persistent `rk-test-e2e` server would carry
    // stale pin-sessions into later runs.
    for (const entry of pinnedEntries) {
      try {
        await request.post(`/api/boards/${BOARD_NAME}/unpin`, {
          data: entry,
        });
      } catch {
        // Best-effort
      }
    }
    pinnedEntries.length = 0;

    killSession(TEST_SESSION_A, { server: TMUX_SERVER_A });
    killServer(TMUX_SERVER_B);
  });

  test("a board with windows from two servers shows the union on /board/<name>", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const winIdA = listWindows(TEST_SESSION_A, { server: TMUX_SERVER_A })[0]?.windowId;
    const winIdB = listWindows(TEST_SESSION_B, { server: TMUX_SERVER_B })[0]?.windowId;

    // Pin both windows via the HTTP API. Server is in the body per the spec.
    const pinA = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
      data: { server: TMUX_SERVER_A, windowId: winIdA },
    });
    expect(pinA.ok()).toBeTruthy();
    pinnedEntries.push({ server: TMUX_SERVER_A, windowId: winIdA });
    const pinB = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
      data: { server: TMUX_SERVER_B, windowId: winIdB },
    });
    expect(pinB.ok()).toBeTruthy();
    pinnedEntries.push({ server: TMUX_SERVER_B, windowId: winIdB });

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
