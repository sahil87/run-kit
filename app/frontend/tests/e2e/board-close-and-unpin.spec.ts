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

test.describe("Boards: tile-header unpin + top-bar ✕ close-pane (260715-6jwn)", () => {
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
    // from the top-bar `Close pane` ✕). Clicking it drives the click-triggered
    // POST /api/boards/{name}/unpin — a true end-to-end assertion of the header
    // pin-glyph button (a broken click would time out here).
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

  test("the top-bar ✕ closes the focused tile's pane (POST /close-pane); the single-pane tile self-heals away and the board vanishes", async ({ page }) => {
    test.setTimeout(30_000);
    const board = `close${Date.now().toString().slice(-6)}`;

    // Pin win-b (win-a's id was consumed by the unpin test's board; either works
    // — each test uses a fresh board name). A single-window pin: killing its one
    // pane kills the window, collapsing the pin-session (the self-heal path).
    const winId = windowId("win-b");
    const pinRes = await page.request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("win-b").first()).toBeVisible({ timeout: 10_000 });

    // The board top-bar ✕ now carries the terminal `Close pane` label (uniform
    // with terminal mode — NOT the old `Unpin pane from board`). Asserting the
    // label proves the mode-aware wiring reversal.
    await expect(page.getByRole("button", { name: "Unpin pane from board" })).toHaveCount(0);
    const topbarClose = page.getByRole("button", { name: "Close pane" });
    await expect(topbarClose).toBeVisible({ timeout: 5_000 });

    // Clicking the ✕ drives the click-triggered POST /api/windows/{id}/close-pane
    // against the focused tile's window — a true end-to-end assertion of the kill.
    const closeReq = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url().includes(`/api/windows/`) &&
        req.url().includes(`/close-pane`),
      { timeout: 5_000 },
    );
    await topbarClose.click();
    await closeReq;

    // Self-heal FRONTEND assertion: the killed tile must actually disappear from
    // the DOM. Killing the last pane kills the window, collapsing the
    // single-window pin-session with NO board-changed event — so ONLY the board
    // page's own `onPaneClosed`→`refetch` re-render can drop the tile. Asserting
    // the tile vanishes (and the empty-state appears) exercises that self-heal
    // wiring directly: were the refetch seam deleted, `win-b` would linger here
    // even though the server-side board is already empty. (The `/api/boards`
    // poll below is server-derived truth and would pass regardless — it does not
    // cover the frontend refetch, which is why this UI check is the load-bearing
    // one for T014/A-008.)
    await expect(page.getByText("win-b")).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByText("No panes pinned to this board yet."),
    ).toBeVisible({ timeout: 10_000 });

    // ...and the emptied board is dropped from GET /api/boards (server-side
    // truth: `getBoard` skips the vanished pin-session, empty boards are not
    // kept).
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
});
