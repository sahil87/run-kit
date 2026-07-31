import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killServer, killSession } from "./_tmux";

const TMUX_SERVER_A = TMUX_SERVER;
// Second tmux server, set up explicitly so the multi-server sidebar has a real
// counterpart to render. Named under the unified rk-test-e2e-* umbrella with the
// Playwright process.pid as the second-to-last hyphen field, so the automatic
// post-sweep can parse it and the e2e teardown glob (rk-test-e2e*) reaps it. The
// trailing suffix is a single hyphen-free token, keeping the PID second-to-last.
const TMUX_SERVER_B = `rk-test-e2e-msb-${process.pid}-${Date.now().toString().slice(-6)}`;
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
