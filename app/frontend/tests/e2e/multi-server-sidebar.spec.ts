// The unified sidebar renders one collapsible group per tmux server
// discovered via /api/servers, and cross-server navigation works end-to-end
// through the URL.
// beforeAll creates a session on the primary tmux server (the worktree's
// derived e2e primary) and a second tmux server (named inside this worktree's
// socket family — the TMUX_FAMILY anchor — with the Playwright process.pid as
// the second-to-last hyphen field, so the automatic post-sweep can parse it
// and the family-anchored teardown glob reaps it) with its own session, each
// containing one named window (`msb-a-win`, `msb-b-win`). The second-server
// pattern matches boards-multi-server.spec.ts. afterAll kills the primary
// session and the secondary tmux server entirely.
import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, TMUX_FAMILY, createSession, killServer, killSession } from "./_tmux";

const TMUX_SERVER_A = TMUX_SERVER;
// Second tmux server, set up explicitly so the multi-server sidebar has a real
// counterpart to render. Named inside this worktree's socket family
// (TMUX_FAMILY anchor) with the Playwright process.pid as the second-to-last
// hyphen field, so the automatic post-sweep can parse it and the family-anchored
// teardown glob reaps it. The trailing suffix is a single hyphen-free token,
// keeping the PID second-to-last.
const TMUX_SERVER_B = `${TMUX_FAMILY}msb-${process.pid}-${Date.now().toString().slice(-6)}`;
const TEST_SESSION_A = `e2e-msb-a-${Date.now()}`;
const TEST_SESSION_B = `e2e-msb-b-${Date.now()}`;

test.describe("Multi-server sidebar", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION_A, { server: TMUX_SERVER_A, windows: ["msb-a-win"] });
    createSession(TEST_SESSION_B, { server: TMUX_SERVER_B, windows: ["msb-b-win"] });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION_A, { server: TMUX_SERVER_A });
    killServer(TMUX_SERVER_B);
  });

  /**
   * Proves: the unified sidebar enumerates every server returned by
   * `/api/servers` and renders a per-server collapsible group, with the
   * current server visually marked.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER_A}` and wait for `Connected` (warms SSE).
   * 2. Assert a header with `data-server='${TMUX_SERVER_A}'` is visible.
   * 3. Assert a header with `data-server='${TMUX_SERVER_B}'` is visible.
   * 4. Assert `data-current-server='true'` is present on the
   *    `${TMUX_SERVER_A}` header (the matched route's server param).
   */
  test("renders one collapsible group per server in the Sessions area", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await gotoServerReady(page, TMUX_SERVER_A);

    // Each server group has a `data-server` attribute on its header. Locate
    // both to assert both render.
    await expect(
      page.locator(`[data-server='${TMUX_SERVER_A}']`).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(`[data-server='${TMUX_SERVER_B}']`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The current server's header carries `data-current-server="true"`.
    const currentMarker = page.locator(
      `[data-server='${TMUX_SERVER_A}'][data-current-server='true']`,
    );
    await expect(currentMarker.first()).toBeVisible();
  });

  /**
   * Proves: cross-server navigation works — a click on a session in a
   * non-current server's tree routes to `/{otherServer}/{N}` on the 2-segment
   * route (the window id's numeric part `N`; `@N` sans `@` in the address
   * bar, restored to `@N` by parse; the session is derived from the SSE
   * snapshot, not the URL), flipping the URL and (via the route-driven
   * dispatch) `currentServer`.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER_A}` and wait for `Connected`.
   * 2. Click the "Expand …" button inside the second server's group header
   *    (default-collapsed for non-current servers).
   * 3. Locate the session row by its accessible name
   *    `Navigate to ${TEST_SESSION_B}` and click it.
   * 4. Assert the URL matches `/${TMUX_SERVER_B}/<N>` — server B plus the
   *    session's first window id's numeric part (`@N` rendered as `N`; no
   *    session segment), via Playwright `toHaveURL` regex.
   */
  test("clicking a session in the second server's group navigates to /$secondServer/...", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await gotoServerReady(page, TMUX_SERVER_A);

    // Expand the second server's group (default-collapsed for non-current).
    const groupBHeader = page.locator(
      `[data-server='${TMUX_SERVER_B}'] button[aria-label*='Expand']`,
    );
    await groupBHeader.click();

    // The session row inside the second server's group should be navigable.
    // The session-row's accessible name is "Navigate to <session>".
    const sessionLink = page.getByLabel(`Navigate to ${TEST_SESSION_B}`);
    await expect(sessionLink.first()).toBeVisible({ timeout: 10_000 });
    await sessionLink.first().click();

    // 2-segment route /$server/$window: the URL carries server B and the
    // session's first window id's numeric part (@N rendered as N) — no session
    // segment (the session is derived from the SSE snapshot).
    await expect(page).toHaveURL(new RegExp(`/${TMUX_SERVER_B}/\\d+(?:$|[/?#])`));
  });
});
