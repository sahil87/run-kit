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
// isolation is instead proven at the terminals-mux layer: in the move-based
// model each pinned window is MOVED into its own single-window pin-session
// (`_rk-pin-<id>`) and a board pane attaches DIRECTLY to it. Under the terminals
// mux (change 260717-803u) all panes share ONE `/ws/terminals` socket, and each
// pane issues its OWN `open` control op carrying its windowId (a distinct
// client-allocated stream id) and mounts its own live `.xterm`. Two windows from
// ONE source session therefore become two independent pin-sessions, each with
// its own muxed stream — distinct `open` windowIds over the single socket is the
// connection-level proof that the panes are isolated.
const WIN_A_MARKER = "PANE_ALPHA_OK";
const WIN_B_MARKER = "PANE_BRAVO_OK";

/** True for the terminals mux URL (`/ws/terminals`). */
function isTerminalsSocket(url: string): boolean {
  return /\/ws\/terminals(\?|$)/.test(url);
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

    // Track which window ids issued an `open` op on the terminals mux socket. A
    // distinct open per window id is the isolation proof: two windows from ONE
    // source session are each MOVED into their own pin-session and each pane
    // opens its own muxed stream over the single `/ws/terminals` socket.
    const openedWindowIds = new Set<string>();
    page.on("websocket", (ws) => {
      if (!isTerminalsSocket(ws.url())) return; // ignore Vite HMR / state / SSE
      ws.on("framesent", (frame) => {
        // Control ops are JSON text frames; binary data frames are ignored.
        if (typeof frame.payload !== "string") return;
        try {
          const msg = JSON.parse(frame.payload);
          if (msg?.op === "open" && typeof msg.windowId === "string") {
            openedWindowIds.add(msg.windowId);
          }
        } catch {
          // non-JSON frame — ignore
        }
      });
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

    // Isolation proof: each distinct window id issued its OWN `open` op on the
    // single terminals mux socket.
    await expect
      .poll(() => openedWindowIds.has(winA!) && openedWindowIds.has(winB!), {
        timeout: 15_000,
      })
      .toBe(true);
    // Two windows → two distinct muxed streams (not one shared/aliased stream).
    expect(openedWindowIds.size).toBeGreaterThanOrEqual(2);

    // Cleanup: unpin both so the board disappears (empty boards are removed).
    for (const winId of [winA, winB]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }
  });
});
