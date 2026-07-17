import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// Connection-budget guard (state socket 260716-qf3j + terminals mux 260717-803u).
//
// The socket-unification effort collapsed BOTH stream families onto ONE muxed
// WebSocket each: session-state + host-metrics ride `/ws/state` (change 1), and
// ALL terminal pane relays ride `/ws/terminals` (change 2 — this change,
// retiring the per-pane `/relay/{windowId}` sockets). This spec asserts the
// user-facing budget invariant across the four route types: a tab holds AT MOST
// two rk WebSockets total — exactly one `/ws/state` plus (only on routes with
// live panes) exactly one `/ws/terminals` — and ZERO `text/event-stream`
// responses from rk endpoints (the Vite HMR WS is excluded by URL). An
// established WebSocket holds no HTTP/1.1 connection-pool slot, so this is what
// clears the pool starvation that blocked terminal-relay handshakes on
// Firefox/WebKit for plaintext origins.

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-connbudget-${Date.now()}`;

/** True for the state socket URL (`/ws/state`), excluding Vite HMR. */
function isStateSocket(url: string): boolean {
  return /\/ws\/state(\?|$)/.test(url);
}

/** True for the terminals mux URL (`/ws/terminals`) — one per tab carrying all
 *  pane streams (replaces the retired per-pane `/relay/{windowId}`). */
function isTerminalsSocket(url: string): boolean {
  return /\/ws\/terminals(\?|$)/.test(url);
}

/** Install WS + response counters on a page. Returns live accessors.
 *
 *  Sockets are counted as (opened − closed), NOT via a URL-keyed Set: neither
 *  `/ws/state` nor `/ws/terminals` carries a distinguishing query param, so a
 *  Set would dedupe two concurrent same-URL sockets to 1 and silently pass the
 *  budget guard — exactly the failure a StrictMode double-mount leak or a
 *  reconnect-without-close bug would produce. Counting live sockets makes a
 *  duplicate detectable. */
function installCounters(page: Page) {
  let stateOpened = 0;
  let stateClosed = 0;
  let terminalsOpened = 0;
  let terminalsClosed = 0;
  const eventStreamResponses: string[] = [];
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (isStateSocket(url)) {
      stateOpened++;
      ws.on("close", () => stateClosed++);
    } else if (isTerminalsSocket(url)) {
      terminalsOpened++;
      ws.on("close", () => terminalsClosed++);
    }
  });
  page.on("response", (res) => {
    const ct = res.headers()["content-type"] ?? "";
    if (ct.includes("text/event-stream")) eventStreamResponses.push(res.url());
  });
  return {
    // Live (currently-open) sockets: opened minus closed.
    stateSocketCount: () => stateOpened - stateClosed,
    terminalsSocketCount: () => terminalsOpened - terminalsClosed,
    eventStreamUrls: () => eventStreamResponses,
  };
}

test.describe("Connection budget — 2 muxed WS (state + terminals), zero SSE", () => {
  test.beforeAll(() => {
    try {
      // A multi-window session so the board/terminal routes have real content.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n cb-win`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, { stdio: "ignore" });
    } catch {
      // Best-effort
    }
  });

  test("the Host home (/) holds one /ws/state WS, no terminals WS, and zero SSE", async ({ page }) => {
    test.setTimeout(30_000);
    const c = installCounters(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Host health region is the readiness signal (metrics subscription acked).
    await expect(page.getByRole("region", { name: "Host health" })).toBeVisible({ timeout: 15_000 });
    // Give any stray SSE / extra socket a chance to appear before asserting.
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    // The Host home has no live panes — no terminals socket.
    expect(c.terminalsSocketCount(), "no terminals WS on the Host home").toBe(0);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a tmux Server route (/$server) holds one /ws/state WS, no terminals WS, and zero SSE", async ({ page }) => {
    test.setTimeout(30_000);
    const c = installCounters(page);
    await page.goto(`/${TMUX_SERVER}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    // The server overview renders session tiles (static capture-pane previews),
    // not live terminals — no terminals socket.
    expect(c.terminalsSocketCount(), "no terminals WS on the server overview").toBe(0);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a Terminal route (/$server/$window) holds exactly 2 WS (state + terminals) and zero SSE", async ({ page }) => {
    test.setTimeout(30_000);
    const c = installCounters(page);
    // Resolve the first window id of the test session.
    const wins = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n");
    const windowId = wins[0]?.replace(/^@/, "");
    expect(windowId, "first window id").toBeTruthy();

    await page.goto(`/${TMUX_SERVER}/${windowId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 15_000 });
    // The terminal route opens the ONE terminals mux socket in addition to the
    // one state socket — exactly two rk WebSockets total.
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    await expect.poll(() => c.terminalsSocketCount(), { timeout: 5_000 }).toBe(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a Board route (/board/$name) holds exactly 2 WS (state + terminals) and zero SSE", async ({ page, request }) => {
    test.setTimeout(40_000);
    const board = `cb-board-${Date.now().toString().slice(-6)}`;
    // Pin the session's first window to a board so the board route has content.
    const wins = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n");
    const windowId = wins[0];
    const pin = await request.post(`/api/boards/${board}/pin`, {
      data: { server: TMUX_SERVER, windowId },
    });
    expect(pin.ok()).toBeTruthy();

    try {
      const c = installCounters(page);
      await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("[aria-label='Connected']").first()).toBeVisible({ timeout: 15_000 });
      // The board attaches every contributing server's STATE over the SINGLE
      // state socket AND every live pane's terminal I/O over the SINGLE
      // terminals mux (this is the exact pool-starvation case the effort fixes)
      // — still exactly two rk WebSockets total, regardless of pane count.
      await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
      await expect.poll(() => c.terminalsSocketCount(), { timeout: 5_000 }).toBe(1);
      expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
    } finally {
      await request.post(`/api/boards/${board}/unpin`, {
        data: { server: TMUX_SERVER, windowId },
      });
    }
  });
});
