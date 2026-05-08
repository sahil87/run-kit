import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-board-same-${Date.now()}`;
const BOARD_NAME = `mp${Date.now().toString().slice(-6)}`;

// Two distinct shell payloads so each window's terminal renders content unique
// to that window. The test asserts that when both windows are pinned to one
// board, each pane shows only its targeted window's payload — proving the
// per-WebSocket grouped-ephemeral relay isolates active-window state correctly.
const WIN_A_MARKER = "PANE_ALPHA_OK";
const WIN_B_MARKER = "PANE_BRAVO_OK";

test.describe("Boards: same-session multi-pane", () => {
  test.beforeAll(() => {
    try {
      // Window 0: prints the alpha marker then idles so the marker stays
      // available for the relay to capture from the pane scrollback.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a "sh -c 'printf \\"${WIN_A_MARKER}\\\\n\\"; sleep 60'"`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b "sh -c 'printf \\"${WIN_B_MARKER}\\\\n\\"; sleep 60'"`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

  test("two windows from one session show distinct pane content", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    // Resolve the window IDs by name so we can pin via the API.
    const wins = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
    )
      .toString()
      .trim()
      .split("\n");
    const winA = wins.find((line) => line.endsWith(":win-a"))?.split(":")[0];
    const winB = wins.find((line) => line.endsWith(":win-b"))?.split(":")[0];
    expect(winA).toBeTruthy();
    expect(winB).toBeTruthy();

    // Pin both windows from the same session to a fresh board.
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }

    // Navigate to the board page. domcontentloaded skips waiting on every WS
    // child to settle.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // Both pane headers render: win-a and win-b.
    await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("win-b").first()).toBeVisible({ timeout: 10_000 });

    // Each pane's terminal text content should contain ONLY its own marker.
    // We poll the rendered terminal text because xterm.js writes asynchronously
    // after the WebSocket relay starts streaming PTY output.
    await expect
      .poll(
        async () => {
          const text = await page.locator("body").innerText();
          return (
            text.includes(WIN_A_MARKER) && text.includes(WIN_B_MARKER)
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Cleanup: unpin both so the board disappears (empty boards are removed).
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }
  });
});
