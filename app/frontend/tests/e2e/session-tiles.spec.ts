import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { gotoServerReady, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

/**
 * End-to-end coverage for the session/window tile-grid density view rendered
 * by the `/$server` index route (`serverIndexRoute`). Verifies the full path:
 * session tiles render, expanding a session reveals per-window tiles, each
 * window tile shows a static `tmux capture-pane` TEXT preview delivered over
 * the SSE `event: preview` (never a live xterm relay per tile), and clicking
 * a window tile upgrades to the real live terminal by navigating to
 * `/$server/$window`.
 *
 * Shared setup: spawns one named tmux session on the e2e tmux server
 * (`rk-test-e2e` by default, overridable via `E2E_TMUX_SERVER`):
 * `e2e-tiles-{ts}`. Sends `echo TILE_PREVIEW_MARKER` into the session's pane
 * so the capture-pane preview has recognizable content to assert on.
 * `afterAll` kills the session to leave the server clean for the next run.
 */

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

  /**
   * Proves: the `/$server` index route renders the density view; a session
   * tile expands into window tiles; each window tile shows the pane text
   * snapshot (not an xterm); and clicking a window tile navigates to the live
   * terminal route. Exercises the preview-scope → SSE `event: preview` →
   * static-text-render → click-to-live path end to end.
   *
   * Steps:
   * 1. Navigate to `/{TMUX_SERVER}` and wait for the "Connected" indicator.
   * 2. Assert the session tile `session-tile-{TEST_SESSION}` is visible on
   *    the index route.
   * 3. Resolve the seeded session's first window id (`@N`) and index from the
   *    `/api/sessions` snapshot (polled — the CLI-created session surfaces
   *    asynchronously).
   * 4. Assert the window tile `window-tile-{TEST_SESSION}-{index}` has count
   *    0 while the session is collapsed (window tiles are gated behind
   *    expansion).
   * 5. Click the tile's `Expand {TEST_SESSION}` button; assert the window
   *    tile becomes visible.
   * 6. Assert the preview element `window-tile-preview-{windowId}` is visible
   *    and contains `TILE_PREVIEW_MARKER` (the captured pane text arrives
   *    over the SSE `event: preview` once the expanded scope is declared).
   *    Assert `.xterm` has count 0 — the tiles view mounts no live terminal.
   * 7. Click the window tile; assert the URL becomes `/{TMUX_SERVER}/{N}` —
   *    the URL segment is the window id's numeric part (`@N` sans `@`; parse
   *    restores `@N` for consumers) — the tile upgraded to the live terminal
   *    route.
   */
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
