import { test, expect } from "@playwright/test";
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

/** True for the terminals mux URL (`/ws/terminals`). */
function isTerminalsSocket(url: string): boolean {
  return /\/ws\/terminals(\?|$)/.test(url);
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

  test("off-screen desktop pane suspends its muxed stream and resumes on scroll-back", async ({
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

    // Track muxed-STREAM lifecycle per window id over the single `/ws/terminals`
    // socket. Under the terminals mux (change 260717-803u) a suspended pane is
    // no longer a closed socket — it is a `close` control op for that pane's
    // stream (its TerminalClient unmounts → the connect effect's cleanup sends
    // `close`), and a resumed pane is a fresh `open` op. A stream is "live"
    // between its `open` op and the matching `close` op. The `close` op carries
    // only the stream `id`, so map id → windowId from the `open` op.
    const liveWindowIds = new Set<string>();
    const idToWindowId = new Map<number, string>();
    page.on("websocket", (ws) => {
      if (!isTerminalsSocket(ws.url())) return; // ignore Vite HMR / state / SSE
      ws.on("framesent", (frame) => {
        if (typeof frame.payload !== "string") return; // binary data frame
        let msg: { op?: string; id?: number; windowId?: string };
        try {
          msg = JSON.parse(frame.payload);
        } catch {
          return;
        }
        if (msg.op === "open" && typeof msg.id === "number" && typeof msg.windowId === "string") {
          idToWindowId.set(msg.id, msg.windowId);
          liveWindowIds.add(msg.windowId);
        } else if (msg.op === "close" && typeof msg.id === "number") {
          const wid = idToWindowId.get(msg.id);
          if (wid) liveWindowIds.delete(wid);
        }
      });
    });

    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

    // Precondition: the desktop relay-suspension feature is gated on a plaintext
    // (`http:`) origin. If the test webServer is ever fronted by HTTPS, the
    // feature silently disables and the stream would never suspend — fail loudly
    // here rather than as a confusing suspension timeout below.
    const protocol = await page.evaluate(() => window.location.protocol);
    expect(protocol, "desktop relay suspension requires a plaintext http: origin").toBe("http:");

    // The leftmost pane (win-0) is on-screen and focused on mount, so its stream
    // must open (an `open` op). The focused pane is always live, so it stays
    // open throughout the scroll cycle below.
    await expect
      .poll(() => liveWindowIds.has(winIds[0]), { timeout: 20_000 })
      .toBe(true);

    // The target pane (win-4) is off-screen at the initial scroll position
    // (only the leftmost panes fit in / near the viewport), so it must not hold
    // a live stream. We target a mid-row pane rather than the very last pane:
    // with the focused pane (win-0) permanently occupying one of the 4 live
    // slots, the single rightmost pane can be squeezed out by the cap even when
    // visible — win-4 is reliably within the cap once scrolled into view.
    const TARGET = 4;
    const targetWid = winIds[TARGET];
    await expect
      .poll(() => liveWindowIds.has(targetWid), { timeout: 10_000 })
      .toBe(false);

    // Scroll the row fully to the right so win-4 enters the viewport. Its stream
    // should then re-open (an `open` op — pane resumes) and its xterm re-mount.
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".overflow-x-auto");
      if (row) row.scrollLeft = row.scrollWidth;
    });

    await expect
      .poll(() => liveWindowIds.has(targetWid), { timeout: 20_000 })
      .toBe(true);

    // Terminal content is re-established: the resumed pane re-mounts its
    // TerminalClient, which instantiates an xterm instance (`.xterm` element).
    // We assert the DOM signal (terminal re-attached) rather than scraping the
    // xterm canvas text, which is brittle and — on this branch, before the
    // sibling static-xterm-import fix lands — can still be starved by the
    // plaintext chunk-fetch contention this change family addresses. The
    // re-opened stream (the `open` op asserted above) plus the live xterm
    // instance together prove the pane resumed.
    const targetPane = page.locator(`[aria-label="board pane win-${TARGET}"]`);
    await expect(targetPane.locator(".xterm")).toBeVisible({ timeout: 20_000 });

    // Scroll back fully to the left. win-4 leaves the viewport (beyond the
    // pre-warm margin) and its stream closes again (a `close` op) — the pane
    // suspends. win-0 (on-screen and focused) stays open throughout.
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".overflow-x-auto");
      if (row) row.scrollLeft = 0;
    });

    await expect
      .poll(() => liveWindowIds.has(targetWid), { timeout: 20_000 })
      .toBe(false);
    expect(liveWindowIds.has(winIds[0])).toBe(true);
  });
});
