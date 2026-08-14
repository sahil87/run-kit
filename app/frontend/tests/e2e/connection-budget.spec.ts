import { test, expect, type Page } from "@playwright/test";
import { isTerminalsSocket, pinWindow } from "./_boards";
import { READY_TIMEOUT, gotoServerReady, gotoWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// Connection-budget guard — FINAL any-route form (state socket 260716-qf3j +
// terminals mux 260717-803u + chat-on-state-socket 260717-vhvz).
//
// The socket-unification effort collapsed EVERY long-lived stream onto ONE of two
// muxed WebSockets: session-state + host-metrics + CHAT ride `/ws/state` (change
// 1 + change 3), and ALL terminal pane relays ride `/ws/terminals` (change 2).
// The chat lens was the last remaining EventSource; change 3 moved it onto the
// state socket as a `kind:"chat"` subscription, so NO route holds an SSE anymore.
// This spec asserts the user-facing budget invariant across every route type
// (Host, tmux Server, Terminal, Board, and the chat lens): a tab holds AT MOST
// two rk WebSockets total — exactly one `/ws/state` plus (only on routes with
// live panes) exactly one `/ws/terminals` — and ZERO `text/event-stream`
// responses from rk endpoints (the Vite HMR WS is excluded by URL). An
// established WebSocket holds no HTTP/1.1 connection-pool slot, so this is what
// clears the pool starvation that blocked terminal-relay handshakes on
// Firefox/WebKit for plaintext origins.

const TEST_SESSION = `e2e-connbudget-${Date.now()}`;

/** True for the state socket URL (`/ws/state`), excluding Vite HMR. */
function isStateSocket(url: string): boolean {
  return /\/ws\/state(\?|$)/.test(url);
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
    // A session so the board/terminal routes have real content.
    createSession(TEST_SESSION, { windows: ["cb-win"] });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
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
    await gotoServerReady(page, TMUX_SERVER);
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
    const windowId = listWindows(TEST_SESSION)[0]?.windowId.replace(/^@/, "");
    expect(windowId, "first window id").toBeTruthy();

    await gotoWindow(page, TMUX_SERVER, windowId!);
    // The terminal route opens the ONE terminals mux socket in addition to the
    // one state socket — exactly two rk WebSockets total.
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    await expect.poll(() => c.terminalsSocketCount(), { timeout: 5_000 }).toBe(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a ?view=chat route holds AT MOST 2 WS and zero SSE (no extra socket vs the base route)", async ({ page }) => {
    // FINAL any-route form (260717-vhvz): the chat lens was the last EventSource
    // in the app; it moved onto the state socket as a `kind:"chat"` subscription,
    // so requesting `?view=chat` adds NO third WS and NO SSE. This test does NOT
    // exercise the chat subscription path directly: the plain e2e test window
    // carries no `@rk_chat`, so the lens resolution falls back to tty and the terminals
    // socket stays. What it DOES guard is the budget invariant — appending
    // `?view=chat` introduces neither a `text/event-stream` response nor a
    // WebSocket beyond the fixed budget — which holds whether the window is
    // chat-capable (chat rides the already-held state socket) or falls back to tty.
    test.setTimeout(30_000);
    const c = installCounters(page);
    const windowId = listWindows(TEST_SESSION)[0]?.windowId.replace(/^@/, "");
    expect(windowId, "first window id").toBeTruthy();

    await page.goto(`/${TMUX_SERVER}/${windowId}?view=chat`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("nav [aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    // Exactly one state socket; at most one terminals socket (this window falls
    // back to tty, so the terminals mux stays); ZERO SSE — `?view=chat` never
    // contributes a text/event-stream (the whole point of this change).
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    await expect.poll(() => c.terminalsSocketCount(), { timeout: 5_000 }).toBeLessThanOrEqual(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses on a ?view=chat route").toEqual([]);
  });

  test("a Board route (/board/$name) holds exactly 2 WS (state + terminals) and zero SSE", async ({ page, request }) => {
    test.setTimeout(40_000);
    const board = `cb-board-${Date.now().toString().slice(-6)}`;
    // Pin the session's first window to a board so the board route has content.
    const windowId = listWindows(TEST_SESSION)[0]?.windowId;
    await pinWindow(request, board, TMUX_SERVER, windowId!);

    try {
      const c = installCounters(page);
      await page.goto(`/board/${board}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("nav [aria-label='Connected']").first()).toBeVisible({ timeout: READY_TIMEOUT });
      // The board attaches every contributing server's STATE over the SINGLE
      // state socket AND every live pane's terminal I/O over the SINGLE
      // terminals mux (this is the exact pool-starvation case the effort fixes)
      // — still exactly two rk WebSockets total, regardless of pane count.
      await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
      await expect.poll(() => c.terminalsSocketCount(), { timeout: 5_000 }).toBe(1);
      expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
    } finally {
      // Best-effort cleanup — deliberately NOT ok-asserted: a throw from a
      // `finally` block would REPLACE the try-block's in-flight exception,
      // masking the socket-count diagnostic this test exists to surface.
      await request.post(`/api/boards/${board}/unpin`, {
        data: { server: TMUX_SERVER, windowId },
      });
    }
  });
});
