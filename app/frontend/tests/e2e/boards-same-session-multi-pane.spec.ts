import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-board-same-${Date.now()}`;
const BOARD_NAME = `mp${Date.now().toString().slice(-6)}`;

// Two distinct shell payloads kept only so each window has real PTY output to
// stream (the relay attaches to a live session). We do NOT scrape this text:
// xterm renders glyphs to a WebGL canvas with NO DOM text layer (verified —
// `.xterm-rows` is absent and `body.innerText()` never contains terminal
// content), so the previous `innerText` assertion could never pass. Per-pane
// isolation is instead proven at the relay layer: in the move-based model each
// pinned window is MOVED into its own single-window pin-session (`_rk-pin-<id>`)
// and a board pane attaches DIRECTLY to it, opening its OWN `/relay/<windowId>`
// WebSocket and mounting its own live `.xterm`. Two windows from ONE source
// session therefore become two independent pin-sessions, each with its own
// relay socket — distinct sockets for the two window ids is the connection-level
// proof that the panes are isolated (matching boards-desktop-suspend.spec.ts).
const WIN_A_MARKER = "PANE_ALPHA_OK";
const WIN_B_MARKER = "PANE_BRAVO_OK";

/** Extract the percent-decoded window id from a `/relay/<id>?...` WS url. */
function relayWindowId(url: string): string | null {
  const m = url.match(/\/relay\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

test.describe("Boards: same-session multi-pane", () => {
  test.beforeAll(() => {
    try {
      // Window 0: prints the alpha marker then idles so the marker stays
      // available for the relay to capture from the pane scrollback.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a "sh -c 'printf \\"${WIN_A_MARKER}\\\\n\\"; sleep 60'"`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b "sh -c 'printf \\"${WIN_B_MARKER}\\\\n\\"; sleep 60'"`,
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

  test("two windows from one session each open their own relay pane", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    // Resolve the window IDs by name so we can pin via the API.
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

    // Track which window ids opened a relay WebSocket. A distinct relay per
    // window id is the isolation proof: two windows from ONE source session are
    // each MOVED into their own pin-session and get their own direct relay.
    const relayWindowIds = new Set<string>();
    page.on("websocket", (ws) => {
      const wid = relayWindowId(ws.url());
      if (wid) relayWindowIds.add(wid); // ignore Vite HMR / SSE sockets
    });

    // Pin both windows from the same session to a fresh board.
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }

    // Navigate to the board page. domcontentloaded skips waiting on every WS
    // child to settle.
    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // Both pane headers render: win-a and win-b.
    await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("win-b").first()).toBeVisible({ timeout: 10_000 });

    // Both panes mount a live xterm instance (terminal attached). `.xterm` is
    // the DOM signal that TerminalClient finished init; with the WebGL renderer
    // the glyphs live on a canvas, so this is the robust "terminal is live"
    // signal (vs. scraping canvas text, which has no DOM representation).
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 15_000 });

    // Isolation proof: each distinct window id opened its OWN relay WebSocket.
    await expect
      .poll(() => relayWindowIds.has(winA!) && relayWindowIds.has(winB!), {
        timeout: 15_000,
      })
      .toBe(true);
    // Two windows → two distinct relay sockets (not one shared/aliased socket).
    expect(relayWindowIds.size).toBeGreaterThanOrEqual(2);

    // Cleanup: unpin both so the board disappears (empty boards are removed).
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }
  });
});
