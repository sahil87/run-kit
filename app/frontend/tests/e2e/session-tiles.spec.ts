import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-tiles-${Date.now()}`;

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve the seeded session's first window (`@N`) from the backend snapshot.
 *  Polls because the CLI-created session surfaces in the snapshot asynchronously. */
async function resolveFirstWindow(
  page: Page,
): Promise<{ windowId: string; index: number }> {
  const deadline = Date.now() + 5_000;
  let last: { windowId: string; index: number } | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; index: number }>;
      }>;
      const win = sessions.find((s) => s.name === TEST_SESSION)?.windows[0];
      if (win) {
        last = { windowId: win.windowId, index: win.index };
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(last, `window for "${TEST_SESSION}" not found in snapshot`).not.toBeNull();
  return last!;
}

test.describe("Session tiles density view", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
      // Print a recognizable line so the pane preview has content to capture.
      execSync(
        `tmux -L ${TMUX_SERVER} send-keys -t ${TEST_SESSION} 'echo TILE_PREVIEW_MARKER' Enter`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist — ignore.
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
  });

  test("landing on /$server shows session tiles that expand into window tiles with previews, and clicking a window tile opens the live terminal", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // 1. The session tile for our seeded session renders on the index route.
    const tile = page.getByTestId(`session-tile-${TEST_SESSION}`);
    await expect(tile).toBeVisible({ timeout: 10_000 });

    const { windowId, index } = await resolveFirstWindow(page);

    // 2. Window tiles are hidden until the session is expanded.
    const windowTile = page.getByTestId(
      `window-tile-${TEST_SESSION}-${index}`,
    );
    await expect(windowTile).toHaveCount(0);

    // 3. Expand the session → its window tile appears.
    await tile.getByRole("button", { name: `Expand ${TEST_SESSION}` }).click();
    await expect(windowTile).toBeVisible({ timeout: 10_000 });

    // 4. The window tile shows a static text preview (a <pre>), not an xterm.
    const preview = page.getByTestId(`window-tile-preview-${windowId}`);
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("TILE_PREVIEW_MARKER", {
      timeout: 10_000,
    });
    // No live terminal (xterm canvas) is mounted in the tiles view.
    await expect(page.locator(".xterm")).toHaveCount(0);

    // 5. Clicking the window tile navigates to the live terminal route.
    await windowTile.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(encodeURIComponent(windowId))}(?:$|[/?#])`,
      ),
      { timeout: 10_000 },
    );
  });
});
