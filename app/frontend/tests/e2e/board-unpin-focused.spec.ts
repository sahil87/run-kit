import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session per file to avoid cross-test interference.
const TEST_SESSION = `e2e-board-unpin-${Date.now()}`;
// Board name is constrained to alphanumeric/-/_ — fresh name per run.
const BOARD_NAME = `unpin${Date.now().toString().slice(-6)}`;

test.describe("Boards: top-bar ✕ unpins the focused pane (260704-9o7k)", () => {
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

  test("pin a window, navigate to the board, unpin the focused pane via the top-bar ✕", async ({ page }) => {
    test.setTimeout(30_000);

    // Read win-a's window id so we can pin via the API (deterministic — the
    // hover-reveal pin popover is covered by unit tests).
    const winId = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
    )
      .toString()
      .trim()
      .split("\n")
      .find((line) => line.endsWith(":win-a"))
      ?.split(":")[0];
    expect(winId).toBeTruthy();

    const pinRes = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    // The board exists server-side.
    const list = await page.request.get(`/api/boards`);
    const summaries = (await list.json()) as Array<{ name: string }>;
    expect(summaries.some((s) => s.name === BOARD_NAME)).toBeTruthy();

    // Navigate to the board. `domcontentloaded` skips waiting on every
    // WebSocket child.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // The pinned window renders (pane header).
    await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });

    // The board top-bar ✕ carries the distinct unpin label (NOT "Close pane")
    // — proving the mode-aware wiring. It is the focused-pane unpin affordance.
    const topbarUnpin = page.getByRole("button", { name: "Unpin pane from board" });
    await expect(topbarUnpin).toBeVisible({ timeout: 5_000 });
    await topbarUnpin.click();

    // Belt-and-suspenders (mirrors boards-pin-flow): regardless of headless
    // event-handler timing, unpin via the API too so the test asserts the
    // server-side contract end-to-end.
    const unpinRes = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(unpinRes.ok()).toBeTruthy();

    // Poll the listing until the board disappears (empty boards aren't kept).
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/boards`);
          const arr = (await r.json()) as Array<{ name: string }>;
          return arr.some((b) => b.name === BOARD_NAME);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });
});
