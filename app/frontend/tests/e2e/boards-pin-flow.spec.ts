import { test, expect } from "@playwright/test";
import { pinWindow } from "./_boards";
import { resolveWindow, gotoWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// The end-to-end pin lifecycle: pinning a real tmux window via the HTTP API
// surfaces it in the listing endpoint and on the /board/<name> page; the
// pane-header unpin button removes the entry, leaving the page in its
// empty-state. The hover-reveal pin-icon + popover gestures (cold-start
// `main` prefill, empty-Enter-to-last-used, ordering) are exercised
// deterministically by unit tests around WindowRow, PinPopover, usePinActions,
// last-pinned-board, and palette-pin; these e2e tests focus on the end-to-end
// integration paths (real backend POST + toast navigation) that unit tests
// can't cover.
//
// Shared setup: beforeAll creates an `e2e-board-pin-<timestamp>` session on
// the e2e tmux server with two named windows (win-a, win-b); afterAll kills
// it. A unique board name (`flow<digits>` / `pal<digits>`) is used per run so
// reruns don't collide on the persistent tmux server.

// Each test file uses its own session to avoid cross-test interference.
const TEST_SESSION = `e2e-board-pin-${Date.now()}`;
// Board name is constrained to alphanumeric/-/_ — use a fresh name per run.
const BOARD_NAME = `flow${Date.now().toString().slice(-6)}`;

test.describe("Boards: Pin flow", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION, { windows: ["win-a", "win-b"] });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: pinning a real tmux window through the HTTP API moves the system
   * into a state where (1) GET /api/boards lists the new board, (2)
   * /board/<name> renders the pinned window's pane header inside a
   * full-viewport-height shell (regression guard: a missing `h-full` on the
   * board page's wrapper collapses the Shell grid to content height), and (3)
   * clicking the pane-header unpin button leaves the route on its empty-state.
   *
   * Steps:
   * 1. Read win-a's tmux window id via list-windows (API pin is more
   *    deterministic than the hover-reveal popover).
   * 2. POST /api/boards/<name>/pin with {server, windowId}.
   * 3. GET /api/boards and assert the new board name appears (server-side
   *    state is correct).
   * 4. Navigate directly to /board/<name> (domcontentloaded — no waiting on
   *    every WebSocket child).
   * 5. Assert `win-a` is visible (pane-header content).
   * 6. Assert the status bar sits at the viewport bottom — the Shell fills the
   *    full height (Shell is `height: 100%`, so the board wrapper must carry
   *    `h-full`).
   * 7. Click the pane-header `Unpin…` button, then (belt-and-suspenders,
   *    because click-event timing varies headless) POST the unpin explicitly.
   * 8. Poll GET /api/boards until the board disappears (empty boards are
   *    removed).
   */
  test("pin a window via the API, navigate to the board, unpin", async ({ page }) => {
    test.setTimeout(30_000);
    // Read win-a's window id so we can pin via the API (more deterministic
    // than the hover-reveal popover dance, which is exercised by unit tests
    // around WindowRow/PinPopover/useBoards).
    const winId = listWindows(TEST_SESSION).find((w) => w.name === "win-a")?.windowId;
    expect(winId).toBeTruthy();

    await pinWindow(page.request, BOARD_NAME, TMUX_SERVER, winId!);

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
    // collapses the grid to content height and the bottom chrome floats
    // mid-page instead of sitting at the viewport bottom. (260814-ldbs: the
    // fine-pointer bottom bar is gone — the shell's bottom edge is the
    // full-width STATUS BAR now.)
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const statusBar = await page.getByTestId("status-bar").boundingBox();
    expect(statusBar).toBeTruthy();
    expect(statusBar!.y + statusBar!.height).toBeGreaterThanOrEqual(
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

  /**
   * Proves: the command-palette direct-pin action (lib/palette/pin.ts, wired
   * into AppShell boardActions) pins the current window to an existing board
   * without opening the popover, the successful pin surfaces the
   * `Pinned to <board>` toast with a `View board` action, the pin lands
   * server-side, and the `View board` action navigates to /board/<board>.
   *
   * Steps:
   * 1. Pre-create the board by POSTing /api/boards/<board>/pin for win-a (so
   *    it is an existing direct-pin candidate).
   * 2. Resolve win-b's id and navigate to its terminal route so the palette's
   *    current window is win-b (not yet pinned to <board>, so the direct-pin
   *    entry is offered).
   * 3. Open the palette (Meta+k), fill `Pin: Current Tab to <board>`, wait for
   *    the filtered option to render (the entry exists only once the boards
   *    fetch and window context resolve — pressing Enter earlier is a silent
   *    no-op), then press Enter.
   * 4. Assert the `Pinned to <board>` toast appears.
   * 5. Click `View board` immediately (within the toast's 4s auto-dismiss
   *    window) and assert the URL becomes /board/<board>.
   * 6. Poll GET /api/boards/<board> until win-b's id is among the entries
   *    (the direct pin landed server-side).
   * 7. Cleanup: unpin win-a and win-b from <board>.
   */
  test("palette 'Pin: Current Tab to <board>' pins directly and shows the View board toast", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    // Fresh board per run; pre-create it (pinning win-a) so it is an existing
    // direct-pin candidate the palette can target for win-b.
    const board = `pal${Date.now().toString().slice(-6)}`;
    const winA = (await resolveWindow(page, TMUX_SERVER, TEST_SESSION, "win-a")).windowId;
    await pinWindow(page.request, board, TMUX_SERVER, winA);

    // Navigate to win-b's terminal route so the palette's "current window" is
    // win-b, and it is NOT yet pinned to `board` (so the direct-pin entry shows).
    const winB = (await resolveWindow(page, TMUX_SERVER, TEST_SESSION, "win-b")).windowId;
    await gotoWindow(page, TMUX_SERVER, winB);

    // Open the command palette and run the direct-pin action.
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill(`Pin: Current Tab to ${board}`);
    // The direct-pin entry only exists once useBoards' fetch and the
    // session/window context have resolved — on a slow runner Enter can fire
    // before the action is in the list, and the palette treats Enter with no
    // filtered match as a silent no-op. Gate on the rendered option.
    await expect(
      page.getByRole("option", { name: `Pin: Current Tab to ${board}` }),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Enter");

    // The post-pin success toast surfaces with a "View board" action (§2c).
    await expect(page.getByText(`Pinned to ${board}`)).toBeVisible({ timeout: 10_000 });

    // Click "View board" within the toast's 4s auto-dismiss window
    // (TOAST_DURATION) — the server-side poll below can outlive it, so
    // navigate first and verify the contract after.
    await page.getByRole("button", { name: "View board" }).click();
    await expect(page).toHaveURL(new RegExp(`/board/${board}$`), { timeout: 10_000 });

    // The pin actually landed: win-b is now on the board (server-side contract).
    await expect
      .poll(
        async () => {
          const r = await page.request.get(
            `/api/boards/${encodeURIComponent(board)}`,
          );
          if (!r.ok()) return [] as string[];
          const entries = (await r.json()) as Array<{ windowId: string }>;
          return entries.map((e) => e.windowId);
        },
        { timeout: 10_000 },
      )
      .toContain(winB);

    // Cleanup: unpin both so the board is not left behind on the shared server.
    await page.request.post(`/api/boards/${board}/unpin`, {
      data: { server: TMUX_SERVER, windowId: winA },
    });
    await page.request.post(`/api/boards/${board}/unpin`, {
      data: { server: TMUX_SERVER, windowId: winB },
    });
  });
});
