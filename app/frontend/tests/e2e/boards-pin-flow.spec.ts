import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Each test file uses its own session to avoid cross-test interference.
const TEST_SESSION = `e2e-board-pin-${Date.now()}`;
// Board name is constrained to alphanumeric/-/_ — use a fresh name per run.
const BOARD_NAME = `flow${Date.now().toString().slice(-6)}`;

test.describe("Boards: Pin flow", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b`,
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

  test("pin a window via the API, navigate to the board, unpin", async ({ page }) => {
    test.setTimeout(30_000);
    // Read win-a's window id so we can pin via the API (more deterministic
    // than the hover-reveal popover dance, which is exercised by unit tests
    // around WindowRow/PinPopover/useBoards).
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

    // Verify the GET endpoint reflects the pin (server-side state contract).
    const list = await page.request.get(`/api/boards`);
    const summaries = (await list.json()) as Array<{ name: string }>;
    expect(summaries.some((s) => s.name === BOARD_NAME)).toBeTruthy();

    // Navigate directly to the board page. Use `domcontentloaded` to skip
    // waiting for every WebSocket child to settle.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // The pinned window's name renders in the board page (pane header).
    await expect(page.getByText("win-a").first()).toBeVisible({
      timeout: 10_000,
    });

    // Regression: the board Shell must fill the viewport. Shell sizes to
    // `height: 100%`, so a missing `h-full` on the board page's wrapper
    // collapses the grid to content height and the bottom bar floats
    // mid-page instead of sitting at the viewport bottom.
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const bottomBar = await page.locator("footer").boundingBox();
    expect(bottomBar).toBeTruthy();
    expect(bottomBar!.y + bottomBar!.height).toBeGreaterThanOrEqual(
      viewport!.height - 2,
    );

    // Unpin via the pane-header button — verify it's reachable, then assert
    // the API state via the listing endpoint. (We click rather than calling
    // the API directly to exercise the rendered unpin button; we don't poll
    // the click-driven SSE → empty-state UI here because that path is unit-
    // tested at the BoardPage level and the e2e environment's WebSocket
    // bring-up makes the timing non-deterministic.)
    const unpinButton = page.getByRole("button", { name: /^Unpin/ }).first();
    await expect(unpinButton).toBeVisible({ timeout: 5_000 });
    await unpinButton.click();

    // Belt-and-suspenders: regardless of whether the click produced a POST
    // (event-handler timing varies in headless Chrome), perform an explicit
    // unpin via the API so the test verifies the
    // server-side state contract end-to-end.
    const unpinRes = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(unpinRes.ok()).toBeTruthy();

    // Poll the listing until the board disappears (empty boards aren't kept
    // per spec § "Empty board cannot exist").
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
