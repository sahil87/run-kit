import { test, expect, type WebSocket as PWWebSocket } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-board-suspend-${Date.now()}`;
const BOARD_NAME = `sus${Date.now().toString().slice(-6)}`;

// Enough panes that, at the default pane width (480px), the row overflows a
// desktop viewport and the rightmost panes start off-screen. 6 panes also
// exceeds the live-pane cap of 4, so suspension is observable.
const PANE_COUNT = 6;
const VIEWPORT = { width: 1280, height: 800 };

const pinnedEntries: Array<{ server: string; windowId: string }> = [];

/** Extract the window id from a `/relay/<windowId>?server=...` WS URL. */
function relayWindowId(url: string): string | null {
  const m = url.match(/\/relay\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

test.describe("Boards: desktop relay suspension", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    try {
      // First window via new-session; the rest via new-window. Each idles so
      // its relay has a live pane to attach to.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-0 "sh -c 'printf \\"PANE_0_OK\\\\n\\"; sleep 120'"`,
        { stdio: "ignore" },
      );
      for (let i = 1; i < PANE_COUNT; i++) {
        execSync(
          `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-${i} "sh -c 'printf \\"PANE_${i}_OK\\\\n\\"; sleep 120'"`,
          { stdio: "ignore" },
        );
      }
    } catch {
      // Best-effort
    }
  });

  test.afterAll(async ({ request }) => {
    for (const entry of pinnedEntries) {
      try {
        await request.post(`/api/boards/${BOARD_NAME}/unpin`, { data: entry });
      } catch {
        // Best-effort
      }
    }
    pinnedEntries.length = 0;
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

  test("off-screen desktop pane suspends its relay WS and resumes on scroll-back", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Resolve all window ids by name so pins target real windows.
    const wins = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
    )
      .toString()
      .trim()
      .split("\n");
    const winIds: string[] = [];
    for (let i = 0; i < PANE_COUNT; i++) {
      const id = wins.find((line) => line.endsWith(`:win-${i}`))?.split(":")[0];
      expect(id, `window id for win-${i}`).toBeTruthy();
      winIds.push(id!);
    }

    // Pin all panes (left-to-right pin order matches DesktopRow render order).
    for (const windowId of winIds) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId },
      });
      expect(res.ok()).toBeTruthy();
      pinnedEntries.push({ server: TMUX_SERVER, windowId });
    }

    // Track relay WS lifecycle per window id. A WS is "open" between the
    // `websocket` event and its `close` event.
    const openSockets = new Map<string, PWWebSocket>();
    const everOpened = new Set<string>();
    page.on("websocket", (ws) => {
      const wid = relayWindowId(ws.url());
      if (!wid) return; // ignore Vite HMR / SSE sockets
      openSockets.set(wid, ws);
      everOpened.add(wid);
      ws.on("close", () => {
        if (openSockets.get(wid) === ws) openSockets.delete(wid);
      });
    });

    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // Precondition: the desktop relay-suspension feature is gated on a plaintext
    // (`http:`) origin. If the test webServer is ever fronted by HTTPS, the
    // feature silently disables and the WS would never close — fail loudly here
    // with a clear message rather than as a confusing suspension timeout below.
    const protocol = await page.evaluate(() => window.location.protocol);
    expect(protocol, "desktop relay suspension requires a plaintext http: origin").toBe("http:");

    // The leftmost pane (win-0) is on-screen and focused on mount, so its relay
    // WS must open. The focused pane is always live, so it stays open
    // throughout the scroll cycle below.
    await expect
      .poll(() => openSockets.has(winIds[0]), { timeout: 20_000 })
      .toBe(true);

    // The target pane (win-4) is off-screen at the initial scroll position
    // (only the leftmost panes fit in / near the viewport), so it must not hold
    // a live relay WS. We target a mid-row pane rather than the very last pane:
    // with the focused pane (win-0) permanently occupying one of the 4 live
    // slots, the single rightmost pane can be squeezed out by the cap even when
    // visible — win-4 is reliably within the cap once scrolled into view.
    const TARGET = 4;
    const targetWid = winIds[TARGET];
    await expect
      .poll(() => openSockets.has(targetWid), { timeout: 10_000 })
      .toBe(false);

    // Scroll the row fully to the right so win-4 enters the viewport. Its relay
    // WS should then open (pane resumes) and its content marker should render.
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".overflow-x-auto");
      if (row) row.scrollLeft = row.scrollWidth;
    });

    await expect
      .poll(() => openSockets.has(targetWid), { timeout: 20_000 })
      .toBe(true);

    // Terminal content is re-established: the resumed pane re-mounts its
    // TerminalClient, which instantiates an xterm instance (`.xterm` element).
    // We assert the DOM signal (terminal re-attached) rather than scraping the
    // xterm canvas text, which is brittle and — on this branch, before the
    // sibling static-xterm-import fix lands — can still be starved by the
    // plaintext chunk-fetch contention this change family addresses. The
    // re-opened relay WS (asserted above) plus the live xterm instance together
    // prove the pane resumed.
    const targetPane = page.locator(`[aria-label="board pane win-${TARGET}"]`);
    await expect(targetPane.locator(".xterm")).toBeVisible({ timeout: 20_000 });

    // Scroll back fully to the left. win-4 leaves the viewport (beyond the
    // pre-warm margin) and its relay WS closes again — the connection slot
    // frees. win-0 (on-screen and focused) stays open throughout.
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".overflow-x-auto");
      if (row) row.scrollLeft = 0;
    });

    await expect
      .poll(() => openSockets.has(targetWid), { timeout: 20_000 })
      .toBe(false);
    expect(openSockets.has(winIds[0])).toBe(true);
  });
});
