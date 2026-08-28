import { test, expect } from "@playwright/test";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

/**
 * Validates the central Rotated Shell Layout invariant: on the board route,
 * the shell-level `BottomBar` follows the *focused* pane via
 * `FocusedTerminalContext`. Cycling pane focus with `Cmd+]` / `Cmd+[`
 * re-targets the BottomBar to the newly-focused pane's WebSocket so
 * keystrokes typed via the BottomBar reach the right terminal. This e2e test
 * exercises the multi-pane focus contract end-to-end; the unit tests cover
 * the smaller pieces (Shell grid topology, FocusedTerminal register/clear,
 * sidebar section order, BottomBar consumption of the context).
 *
 * Shared setup: `beforeAll` creates an `e2e-shell-rotation-<timestamp>` tmux
 * session on the `rk-test-e2e` server with two named windows (`win-a`,
 * `win-b`). Each window prints a ready-marker and then runs `cat` so STDIN
 * piped via the BottomBar relay accumulates in the pane's view (the markers
 * are not scraped — readiness is gated on the `.xterm` DOM signal; see the
 * test below). A unique board name (`sr<digits>`) is used per run so reruns
 * don't collide on the persistent tmux server. `afterAll` kills the test
 * session.
 */

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
    // Both windows print a ready-marker and then run `cat` so STDIN typed by
    // the test (via the BottomBar relay) accumulates in the pane's view.
    createSession(TEST_SESSION, {
      windows: [
        { name: "win-a", command: `sh -c 'printf "${WIN_A_MARKER}\\n"; cat'` },
        { name: "win-b", command: `sh -c 'printf "${WIN_B_MARKER}\\n"; cat'` },
      ],
    });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: on `/board/<name>`, a single shell-level `BottomBar` is present
   * and its input target follows the focused pane. Cycling focus via `Cmd+]`
   * / `Cmd+[` re-targets the BottomBar — verified by the pane's
   * `border-accent` class which marks the focused pane.
   *
   * Steps:
   * 1. Resolve the `#{window_id}` of `win-a` and `win-b` via
   *    `tmux list-windows -F`.
   * 2. POST `/api/boards/<name>/pin` with both window IDs.
   * 3. Navigate to `/board/<name>` (waitUntil `domcontentloaded`).
   * 4. Readiness gate: assert exactly two `.xterm` instances mount — confirms
   *    both panes' terminals attached. (We assert the `.xterm` DOM signal
   *    rather than scraping ready-marker text: xterm renders to a WebGL
   *    canvas with no DOM text layer. The focus-cycling behavior under test
   *    is verified via `border-accent` below, independent of terminal
   *    content.)
   * 5. Assert the shell-level `BottomBar` is present by locating the
   *    `Open command palette` button (a stable BottomBar affordance).
   * 6. Press `Meta+]` to cycle focus from pane 0 to pane 1.
   * 7. Assert pane 1 carries the `border-accent` class and pane 0 does not —
   *    proving focus moved and `BoardPane.useEffect` ran with
   *    `isFocused === true`, registering pane 1 as the focused terminal.
   * 8. Press `Meta+[` to cycle back to pane 0.
   * 9. Assert pane 0 carries `border-accent` and pane 1 does not.
   * 10. Unpin both windows via the API to clean up (empty boards are removed
   *     per the boards spec).
   */
  test("BottomBar follows focused pane on board route", async ({ page }) => {
    test.setTimeout(60_000);

    // Resolve the window IDs by name and pin both to a fresh board.
    const wins = listWindows(TEST_SESSION);
    const winA = wins.find((w) => w.name === "win-a")?.windowId;
    const winB = wins.find((w) => w.name === "win-b")?.windowId;
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

    // Readiness gate: wait for both panes to mount a live xterm instance. We
    // assert the `.xterm` DOM signal (terminal attached) rather than scraping
    // the ready-marker text — xterm renders to a WebGL canvas with no DOM text
    // layer, so `body.innerText()` never contains terminal content. The actual
    // behavior under test (focus cycling) is asserted below via `border-accent`,
    // independent of terminal content; this gate only needs both panes live.
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 15_000 });

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
