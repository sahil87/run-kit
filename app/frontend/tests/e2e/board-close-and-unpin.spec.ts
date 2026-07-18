import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session per file to avoid cross-test interference.
const TEST_SESSION = `e2e-board-close-${Date.now()}`;

// Read a window id by name from the shared test session.
function windowId(name: string): string {
  const id = execSync(
    `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
  )
    .toString()
    .trim()
    .split("\n")
    .find((line) => line.endsWith(`:${name}`))
    ?.split(":")[0];
  expect(id).toBeTruthy();
  return id as string;
}

test.describe("Boards: tile-header unpin + top-bar consequence-gated Kill (co9z)", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a`,
        { stdio: "ignore" },
      );
      execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b`, {
        stdio: "ignore",
      });
      execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-c`, {
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

  test("the per-tile header pin glyph unpins the focused pane (POST /unpin), emptying the board", async ({ page }) => {
    test.setTimeout(30_000);
    // Fresh board name per test so reruns don't collide on the persistent server.
    const board = `unpin${Date.now().toString().slice(-6)}`;

    const winId = windowId("win-a");
    const pinRes = await page.request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });

    // The tile-header unpin button carries the per-window unpin label (distinct
    // from the top-bar `Kill` ✕). Clicking it drives the click-triggered
    // POST /api/boards/{name}/unpin directly — the tile-header unpin stays
    // UNCONFIRMED (unpin is reversible; a broken click would time out here).
    const headerUnpin = page.getByRole("button", { name: "Unpin win-a from board" });
    await expect(headerUnpin).toBeVisible({ timeout: 5_000 });

    const unpinReq = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url().includes(`/api/boards/${board}/unpin`),
      { timeout: 5_000 },
    );
    await headerUnpin.click();
    await unpinReq;

    // Empty boards are not kept — poll the listing until the board disappears.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/boards`);
          const arr = (await r.json()) as Array<{ name: string }>;
          return arr.some((b) => b.name === board);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });

  test("a pinned window stays a member of its home session (dual presence)", async ({ page }) => {
    test.setTimeout(30_000);
    const board = `dual${Date.now().toString().slice(-6)}`;

    // Pin win-c to the board (link-based → the window stays in its home session).
    const winId = windowId("win-c");
    const pinRes = await page.request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    // Dual presence: because Pin now LINKS (not moves) the window, it remains a
    // member of its home session — so the user-facing GET /api/sessions (the
    // same derive-from-tmux source the SESSIONS sidebar renders from) still lists
    // the window under a NON-pin session. Under the old move model the window was
    // pulled out of home and would be ABSENT here. This is deterministic backend
    // truth (no sidebar-expand timing), the honest signal for the sidebar render.
    const listed = async () => {
      const r = await page.request.get(`/api/sessions?server=${TMUX_SERVER}`);
      const sessions = (await r.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string }>;
      }>;
      return sessions.some(
        (s) =>
          !s.name.startsWith("_rk-pin-") &&
          s.windows.some((w) => w.windowId === winId),
      );
    };
    await expect.poll(listed, { timeout: 10_000 }).toBe(true);

    // The board still renders the pinned tile (board membership unaffected).
    await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("win-c").first()).toBeVisible({ timeout: 10_000 });

    // Clean up so the board vanishes.
    await page.request.post(`/api/boards/${board}/unpin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
  });

  test("the top-bar ✕ opens the consequence-gated Kill dialog; confirming Kill destroys the window (POST /kill) and the tile self-heals away", async ({ page }) => {
    test.setTimeout(30_000);
    const board = `krm${Date.now().toString().slice(-6)}`;

    // Pin win-b. A single-window pin: a real window-kill collapses the
    // pin-session (the self-heal path).
    const winId = windowId("win-b");
    const pinRes = await page.request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("win-b").first()).toBeVisible({ timeout: 10_000 });

    // Verb discipline (co9z): the board ✕ reads `Kill`, never `Close pane` /
    // `Unpin pane from board`. It is consequence-gated — clicking it opens a
    // confirm dialog, it does NOT fire an immediate kill. Scope to the top-bar
    // right cluster so the match is unambiguous (sidebar/board-list buttons may
    // share substrings).
    const topBar = page.getByTestId("top-bar-right");
    await expect(topBar.getByRole("button", { name: "Close pane" })).toHaveCount(0);
    await expect(topBar.getByRole("button", { name: "Unpin pane from board" })).toHaveCount(0);
    const topbarKill = topBar.getByRole("button", { name: "Kill" });
    await expect(topbarKill).toBeVisible({ timeout: 5_000 });
    await topbarKill.click();

    // The confirm dialog appears. `Unpin instead` is default-focused (the safe
    // action) and the dialog is keyboard-operable.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole("button", { name: "Unpin instead" })).toBeFocused();

    // Confirm Kill → a WINDOW-kill ("closes it everywhere"), NOT a close-pane.
    const killReq = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url().includes(`/api/windows/`) &&
        req.url().includes(`/kill`),
      { timeout: 5_000 },
    );
    await dialog.getByRole("button", { name: "Kill", exact: true }).click();
    await killReq;

    // Self-heal FRONTEND assertion: the killed tile disappears from the DOM.
    // Killing the window collapses the single-window pin-session with NO
    // board-changed event — so ONLY the board page's own refetch (driven by
    // `executeKillWindow`'s `onSettled` in board-page.tsx) can drop the tile.
    await expect(page.getByText("win-b")).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByText("No panes pinned to this board yet."),
    ).toBeVisible({ timeout: 10_000 });

    // ...and the emptied board is dropped from GET /api/boards.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/boards`);
          const arr = (await r.json()) as Array<{ name: string }>;
          return arr.some((b) => b.name === board);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });

  test("the Kill dialog's `Unpin instead` unpins (POST /unpin) without killing the window", async ({ page }) => {
    test.setTimeout(30_000);
    const board = `esc${Date.now().toString().slice(-6)}`;

    // win-a is reused here (a fresh board name isolates it from the first test).
    const winId = windowId("win-a");
    const pinRes = await page.request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });

    // Open the Kill dialog via the top-bar ✕ (scoped to the top-bar cluster).
    await page.getByTestId("top-bar-right").getByRole("button", { name: "Kill" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // `Unpin instead` is the SAFE escape — it drives POST /unpin, NOT /kill.
    const unpinReq = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url().includes(`/api/boards/${board}/unpin`),
      { timeout: 5_000 },
    );
    await dialog.getByRole("button", { name: "Unpin instead" }).click();
    await unpinReq;

    // The window survives — it is unpinned, not killed. The board empties.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/boards`);
          const arr = (await r.json()) as Array<{ name: string }>;
          return arr.some((b) => b.name === board);
        },
        { timeout: 10_000 },
      )
      .toBe(false);

    // The window still exists on the tmux server (unpin does not destroy it).
    const stillAlive = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n")
      .includes(winId);
    expect(stillAlive).toBe(true);
  });
});
