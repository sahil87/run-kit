import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { gotoServerReady, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

const TEST_SESSION = `e2e-tiles-${Date.now()}`;

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Session tiles density view", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
    try {
      // Print a recognizable line so the pane preview has content to capture.
      execSync(
        `tmux -L ${TMUX_SERVER} send-keys -t ${TEST_SESSION} 'echo TILE_PREVIEW_MARKER' Enter`,
        { stdio: "ignore" },
      );
    } catch {
      // Best effort — matches the prior copied pattern.
    }
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("landing on /$server shows session tiles that expand into window tiles with previews, and clicking a window tile opens the live terminal", async ({
    page,
  }) => {
    await gotoServerReady(page, TMUX_SERVER);

    // 1. The session tile for our seeded session renders on the index route.
    const tile = page.getByTestId(`session-tile-${TEST_SESSION}`);
    await expect(tile).toBeVisible({ timeout: 10_000 });

    const { windowId, index } = await resolveWindow(page, TMUX_SERVER, TEST_SESSION);

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

    // 5. Clicking the window tile navigates to the live terminal route. The URL
    //    segment is the window id's numeric part (@N sans @).
    await windowTile.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(windowId.slice(1))}(?:$|[/?#])`,
      ),
      { timeout: 10_000 },
    );
  });
});
