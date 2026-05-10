import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER_A = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
// Second tmux server, set up explicitly so the cross-server union has a real
// counterpart. Using a long suffix to avoid collisions across runs.
const TMUX_SERVER_B = `rk-e2e-multi-${Date.now().toString().slice(-6)}`;
const TEST_SESSION_A = `e2e-board-multi-a-${Date.now()}`;
const TEST_SESSION_B = `e2e-board-multi-b-${Date.now()}`;
const BOARD_NAME = `multi${Date.now().toString().slice(-6)}`;

const pinnedEntries: Array<{ server: string; windowId: string }> = [];

test.describe("Boards: multi-server union", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER_A} new-session -d -s ${TEST_SESSION_A} -x 80 -y 24 -n srv-a-win`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER_B} new-session -d -s ${TEST_SESSION_B} -x 80 -y 24 -n srv-b-win`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(async ({ request }) => {
    // Unpin while servers are still alive — `@rk_board` lives on the tmux
    // server and survives `kill-session`, so without this the persistent
    // `rk-e2e` server would carry stale entries into later runs.
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

    try {
      execSync(`tmux -L ${TMUX_SERVER_A} kill-session -t ${TEST_SESSION_A}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
    try {
      execSync(`tmux -L ${TMUX_SERVER_B} kill-server`, { stdio: "ignore" });
    } catch {
      // Best-effort
    }
  });

  test("a board with windows from two servers shows the union on /board/<name>", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const winIdA = execSync(
      `tmux -L ${TMUX_SERVER_A} list-windows -t ${TEST_SESSION_A} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n")[0];
    const winIdB = execSync(
      `tmux -L ${TMUX_SERVER_B} list-windows -t ${TEST_SESSION_B} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n")[0];

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
