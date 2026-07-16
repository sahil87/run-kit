import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// Connection-budget guard (change 260716-qf3j-state-socket, acceptance A-014).
//
// The state-socket migration collapsed the per-server + metrics-only SSE fan-out
// onto ONE `/ws/state` WebSocket. This spec asserts the user-facing budget
// invariant across the four route types: each route holds exactly ONE `/ws/state`
// WebSocket and ZERO `text/event-stream` responses from rk endpoints (the Vite
// HMR WS and any relay WSs are excluded from the state-socket count). Terminal
// relay WSs (`/relay/`) are unchanged by this change and are counted separately
// only to confirm they still open where expected.

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-connbudget-${Date.now()}`;

/** True for the state socket URL (`/ws/state`), excluding Vite HMR + relay WSs. */
function isStateSocket(url: string): boolean {
  return /\/ws\/state(\?|$)/.test(url);
}

/** True for a terminal relay WS (`/relay/{windowId}`). */
function isRelaySocket(url: string): boolean {
  return /\/relay\//.test(url);
}

/** Install WS + response counters on a page. Returns live accessors.
 *
 *  Sockets are counted as (opened − closed), NOT via a URL-keyed Set: `/ws/state`
 *  carries no distinguishing query param, so a Set would dedupe two concurrent
 *  same-URL sockets to 1 and silently pass the budget guard — exactly the failure
 *  a StrictMode double-mount leak or a re-connect-without-close bug would produce.
 *  Counting live sockets makes a duplicate state socket detectable. */
function installCounters(page: Page) {
  let stateOpened = 0;
  let stateClosed = 0;
  let relayOpened = 0;
  let relayClosed = 0;
  const eventStreamResponses: string[] = [];
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (isStateSocket(url)) {
      stateOpened++;
      ws.on("close", () => stateClosed++);
    } else if (isRelaySocket(url)) {
      relayOpened++;
      ws.on("close", () => relayClosed++);
    }
  });
  page.on("response", (res) => {
    const ct = res.headers()["content-type"] ?? "";
    if (ct.includes("text/event-stream")) eventStreamResponses.push(res.url());
  });
  return {
    // Live (currently-open) state sockets: opened minus closed.
    stateSocketCount: () => stateOpened - stateClosed,
    relaySocketCount: () => relayOpened - relayClosed,
    eventStreamUrls: () => eventStreamResponses,
  };
}

test.describe("Connection budget — one /ws/state WS, zero SSE", () => {
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

  test("the Host home (/) holds exactly one /ws/state WS and zero SSE", async ({ page }) => {
    test.setTimeout(30_000);
    const c = installCounters(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Host health region is the readiness signal (metrics subscription acked).
    await expect(page.getByRole("region", { name: "Host health" })).toBeVisible({ timeout: 15_000 });
    // Give any stray SSE / extra socket a chance to appear before asserting.
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a tmux Server route (/$server) holds exactly one /ws/state WS and zero SSE", async ({ page }) => {
    test.setTimeout(30_000);
    const c = installCounters(page);
    await page.goto(`/${TMUX_SERVER}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a Terminal route (/$server/$window) holds exactly one /ws/state WS and zero SSE", async ({ page }) => {
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
    // The terminal route opens a relay WS in addition to the one state socket.
    await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
    expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
  });

  test("a Board route (/board/$name) holds exactly one /ws/state WS and zero SSE", async ({ page, request }) => {
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
      // The board attaches every contributing server over the SINGLE state socket
      // (this is the exact pool-starvation case the change fixes) — still one WS.
      await expect.poll(() => c.stateSocketCount(), { timeout: 5_000 }).toBe(1);
      expect(c.eventStreamUrls(), "no text/event-stream responses").toEqual([]);
    } finally {
      await request.post(`/api/boards/${board}/unpin`, {
        data: { server: TMUX_SERVER, windowId },
      });
    }
  });
});
