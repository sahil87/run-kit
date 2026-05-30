import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-shell-rotation-${Date.now()}`;
const BOARD_NAME = `sr${Date.now().toString().slice(-6)}`;

// Two distinct shell payloads so each window's terminal renders unique content.
// The test asserts the focus-cycling proxy of the central 17m3 invariant: when
// the user presses Cmd+]/Cmd+[ on the board route, the focused pane changes,
// which is the prerequisite for `FocusedTerminalContext` to route BottomBar
// input to a different pane. The visible signal we assert against is the
// `border-accent` class on the focused pane (and its absence on others) —
// driving Compose end-to-end and asserting per-pane STDIN routing is left to
// follow-up e2e coverage.
const WIN_A_MARKER = "PANE_ALPHA_RDY";
const WIN_B_MARKER = "PANE_BRAVO_RDY";

test.describe("Shell rotation: BottomBar focus tracking", () => {
  test.beforeAll(() => {
    try {
      // Both windows print a ready-marker and then run `cat` so STDIN typed by
      // the test (via the BottomBar relay) accumulates in the pane's view.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a "sh -c 'printf \\"${WIN_A_MARKER}\\\\n\\"; cat'"`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b "sh -c 'printf \\"${WIN_B_MARKER}\\\\n\\"; cat'"`,
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

  test("BottomBar follows focused pane on board route", async ({ page }) => {
    test.setTimeout(60_000);

    // Resolve the window IDs by name and pin both to a fresh board.
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

    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }

    // Navigate to the board route — BottomBar is now present on this route.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // Wait for both pane terminals to render their ready-markers.
    await expect
      .poll(
        async () => {
          const text = await page.locator("body").innerText();
          return text.includes(WIN_A_MARKER) && text.includes(WIN_B_MARKER);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // BottomBar is rendered at shell level on the board route — confirm the
    // command-palette and modifier toggle (proxy for "BottomBar present") are
    // reachable by their existing ARIA labels.
    await expect(page.getByLabel("Open command palette")).toBeVisible();

    // Initial focused pane is index 0 (winA per the existing focusedIndex=0
    // initial state). Cycle to pane 1 via Cmd+] and assert the BottomBar's
    // focused target moved (indirectly: the pane border becomes accent).
    await page.keyboard.press("Meta+]");
    // After cycling, BoardPane idx=1 carries `border-accent`; idx=0 does not.
    const panes = page.locator('[role="group"][aria-label^="board pane"]');
    await expect(panes.nth(1)).toHaveClass(/border-accent/);
    await expect(panes.nth(0)).not.toHaveClass(/border-accent/);

    // Cycle back to pane 0 via Cmd+[ and re-assert.
    await page.keyboard.press("Meta+[");
    await expect(panes.nth(0)).toHaveClass(/border-accent/);
    await expect(panes.nth(1)).not.toHaveClass(/border-accent/);

    // Cleanup: unpin both so the board disappears (empty boards are removed).
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }
  });
});
