import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER_A = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
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
    try {
      execSync(
        `tmux -L ${TMUX_SERVER_A} new-session -d -s ${TEST_SESSION_A} -x 80 -y 24 -n msb-a-win`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER_B} new-session -d -s ${TEST_SESSION_B} -x 80 -y 24 -n msb-b-win`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER_A} kill-session -t ${TEST_SESSION_A}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
    try {
      execSync(`tmux -L ${TMUX_SERVER_B} kill-server`, { stdio: "ignore" });
    } catch {
      // Best-effort
    }
  });

  test("renders one collapsible group per server in the Sessions area", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

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
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

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
    // session's first window id (@N, percent-encoded as %40N) — no session
    // segment (the session is derived from the SSE snapshot).
    await expect(page).toHaveURL(new RegExp(`/${TMUX_SERVER_B}/%40\\d+(?:$|[/?#])`));
  });
});
