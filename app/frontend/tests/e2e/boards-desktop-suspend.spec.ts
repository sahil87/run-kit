import { test, expect } from "@playwright/test";
import { isTerminalsSocket, pinWindow, trackPin, unpinAll } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// On a plaintext origin, the desktop board row bounds its live terminal
// streams by viewport visibility plus a hard live-pane cap: off-screen panes
// suspend their muxed stream and resume it when scrolled back into view. Under
// the terminals mux all panes share ONE `/ws/terminals` socket — a suspended
// pane sends a `close` control op for its stream (its TerminalClient unmounts
// → the connect effect's cleanup) while a resumed pane sends a fresh `open`
// op. This is the desktop counterpart of the mobile carousel's
// `paused={idx !== carouselIndex}` suspension.
//
// Shared setup: beforeAll creates a session on the e2e tmux server with 6
// named windows (win-0…win-5); each prints a unique marker then idles
// (`sleep 120`) so its stream always has a live pane to attach to. The suite
// runs at a 1280×800 desktop viewport — at the default 480px pane width six
// panes overflow the row (so rightmost panes start off-screen, the
// precondition for observing suspension) and exceed the live-pane cap of 4.
// Every pin is registered with the shared `_boards.ts` cleanup registry
// (trackPin); afterAll runs unpinAll (best-effort unpin of every tracked
// entry, so the persistent e2e server carries no stale `_rk-pin-*`
// pin-sessions into later runs) and kills the test session.

const TEST_SESSION = `e2e-board-suspend-${Date.now()}`;
const BOARD_NAME = `sus${Date.now().toString().slice(-6)}`;

// Enough panes that, at the default pane width (480px), the row overflows a
// desktop viewport and the rightmost panes start off-screen. 6 panes also
// exceeds the live-pane cap of 4, so suspension is observable.
const PANE_COUNT = 6;
const VIEWPORT = { width: 1280, height: 800 };

test.describe("Boards: desktop relay suspension", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    // First window via new-session; the rest via new-window. Each idles so
    // its relay has a live pane to attach to.
    createSession(TEST_SESSION, {
      windows: Array.from({ length: PANE_COUNT }, (_, i) => ({
        name: `win-${i}`,
        command: `sh -c 'printf "PANE_${i}_OK\\n"; sleep 120'`,
      })),
    });
  });

  test.afterAll(async ({ request }) => {
    await unpinAll(request);
    killSession(TEST_SESSION);
  });

  /**
   * Proves: on a plaintext origin, an off-screen desktop board pane does not
   * hold a live muxed terminal stream (its `close` op has been sent), and
   * scrolling that pane back into the viewport re-opens its stream (a fresh
   * `open` op) and restores its terminal content; the focused, on-screen pane
   * stays connected throughout. This is the connection-budget contract: the
   * live stream count stays bounded instead of growing with the pin count, all
   * over the single /ws/terminals socket.
   *
   * Steps:
   * 1. Resolve all six window ids by name so pin POSTs target real windows.
   * 2. POST /api/boards/<name>/pin for each window in left-to-right order (pin
   *    order matches DesktopRow render order); record each entry for cleanup.
   * 3. Register a page.on("websocket") listener that, for the /ws/terminals
   *    socket, watches sent control ops: an `open` op marks that windowId's
   *    stream live (recording stream id → windowId) and a `close` op (carrying
   *    only the stream id) marks it suspended; Vite HMR, state, SSE sockets
   *    and binary frames are ignored.
   * 4. Navigate to /board/<name>.
   * 5. Assert window.location.protocol === "http:" — the suspension feature is
   *    gated on a plaintext origin, so fail loudly here rather than as a
   *    confusing suspension timeout below.
   * 6. Assert the leftmost pane (win-0, on-screen and focused on mount) has a
   *    live stream; the focused pane is always live, so it stays open for the
   *    whole scroll cycle.
   * 7. Assert the target pane (win-4), off-screen initially, has no live
   *    stream. A mid-row pane is targeted because the focused pane permanently
   *    occupies one of the 4 live slots, so the single rightmost pane can be
   *    squeezed out by the cap even when visible — win-4 is reliably within
   *    the cap once scrolled into view.
   * 8. Scroll the row fully right so win-4 enters the viewport; assert its
   *    stream re-opens (an `open` op) and its TerminalClient re-mounts a live
   *    xterm instance (`.xterm` element visible — the DOM signal, not brittle
   *    canvas text scraping).
   * 9. Scroll the row fully back left so win-4 leaves the viewport beyond the
   *    pre-warm margin; assert its stream closes again (a `close` op) while
   *    win-0 stays open throughout.
   */
  test("off-screen desktop pane suspends its muxed stream and resumes on scroll-back", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Resolve all window ids by name so pins target real windows.
    const wins = listWindows(TEST_SESSION);
    const winIds: string[] = [];
    for (let i = 0; i < PANE_COUNT; i++) {
      const id = wins.find((w) => w.name === `win-${i}`)?.windowId;
      expect(id, `window id for win-${i}`).toBeTruthy();
      winIds.push(id!);
    }

    // Pin all panes (left-to-right pin order matches DesktopRow render order).
    for (const windowId of winIds) {
      await pinWindow(page.request, BOARD_NAME, TMUX_SERVER, windowId);
      trackPin({ board: BOARD_NAME, server: TMUX_SERVER, windowId });
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
