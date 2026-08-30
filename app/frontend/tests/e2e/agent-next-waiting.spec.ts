import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked — no tmux, no gh, no real backend. page.route stubs:
//   **/api/servers → a single server `default`.
//   **/api/windows/*/select* → 200 (the trailing `*` is required so the
//   client's appended `?server=` query is still intercepted).
//   /ws/terminals → stubbed.
// mockStateSocket injects the `sessions` event: session `dev` with two
// windows — @1 "active-win" (agentState active, the active window) and @2
// "waiting-win" (agentState waiting or idle, per test).
//
// Agent: Next waiting (docs/specs/status-pyramid.md § Attention Propagation) —
// the keyboard-first attention nav (Constitution V): cycles to the next
// window whose rolled-up agentState is `waiting`; no-ops with a
// "No agents waiting" toast when none. runNextWaiting() opens the palette
// via `openPalette`, fills "Agent: Next waiting", and presses Enter.

const SERVER = "default";

function sessionsPayload(withWaiting: boolean) {
  return JSON.stringify([
    {
      name: "dev",
      windows: [
        {
          windowId: "@1",
          index: 0,
          name: "active-win",
          worktreePath: "/tmp/a",
          activity: "active",
          isActiveWindow: true,
          activityTimestamp: 0,
          agentState: "active",
        },
        {
          windowId: "@2",
          index: 1,
          name: "waiting-win",
          worktreePath: "/tmp/b",
          activity: "idle",
          isActiveWindow: false,
          activityTimestamp: 0,
          agentState: withWaiting ? "waiting" : "idle",
          agentIdleDuration: "3m",
        },
      ],
    },
  ]);
}

async function mockBackend(page: Page, withWaiting: boolean) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsPayload(withWaiting) });
}

async function runNextWaiting(page: Page) {
  const paletteInput = await openPalette(page);
  await paletteInput.fill("Agent: Next waiting");
  await page.keyboard.press("Enter");
}

test.describe("Agent: Next waiting palette action", () => {
  /**
   * Proves: invoking `Agent: Next waiting` from a non-waiting window navigates
   * to the window whose agentState is `waiting`.
   *
   * Steps:
   * 1. Mock the backend with @2 waiting; navigate to /default/1 (the active
   *    window) and assert "active-win" is visible.
   * 2. Run the `Agent: Next waiting` palette action.
   * 3. Assert the URL navigated to /default/2 (the waiting window @2).
   */
  test("navigates to the waiting window when one exists", async ({ page }) => {
    await mockBackend(page, true);
    // Start on the active (non-waiting) window.
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("active-win").first()).toBeVisible();

    await runNextWaiting(page);

    // Navigates to the waiting window (@2 → URL segment `2`).
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });

  /**
   * Proves: with no waiting windows the action does not navigate and surfaces
   * the "No agents waiting" info toast.
   *
   * Steps:
   * 1. Mock the backend with @2 idle (no window waiting); navigate to
   *    /default/1 and assert "active-win" is visible.
   * 2. Run the `Agent: Next waiting` palette action.
   * 3. Assert the URL is still /default/1 (no navigation) and the
   *    "No agents waiting" toast is visible.
   */
  test("no-op with a 'No agents waiting' toast when none are waiting", async ({ page }) => {
    await mockBackend(page, false);
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("active-win").first()).toBeVisible();

    await runNextWaiting(page);

    // No navigation away from @1, and the info toast appears.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
    await expect(page.getByText("No agents waiting")).toBeVisible({ timeout: 5_000 });
  });

  /**
   * Proves: under `prefers-reduced-motion: reduce` the waiting halo renders as
   * a STATIC yellow ring — the globals.css reduced-motion block zeroes the
   * pulse animation, but a visible box-shadow ring remains (attention is never
   * encoded in motion alone). Only real-browser CSS evaluates media queries +
   * globals.css (jsdom does not), so this lives in e2e.
   *
   * Steps:
   * 1. Emulate reduced motion; mock the backend with @2 waiting; navigate to
   *    /default/1.
   * 2. Locate the waiting window's status dot by its composed aria-label
   *    (`agent — active — agent waiting 3m`) and assert it carries the
   *    `rk-waiting-halo` class.
   * 3. Assert its computed `animation-name` is `none` (no pulse).
   * 4. Assert its computed `box-shadow` is non-empty (the static ring still
   *    paints).
   */
  test("waiting halo is a static ring under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockBackend(page, true);
    await page.goto(`/${SERVER}/1`);

    // The waiting window's dot (agentState "waiting" → solid agent shape + the
    // additive halo). Located by its composed aria-label.
    const halo = page.getByRole("img", { name: "agent — active — agent waiting 3m" });
    await expect(halo).toBeVisible({ timeout: 5_000 });
    await expect(halo).toHaveClass(/rk-waiting-halo/);

    const anim = await halo.evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe("none");
    // The static form is still a visible ring, not nothing (a non-empty
    // box-shadow proves the reduced-motion fallback painted the yellow outline).
    const shadow = await halo.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
    expect(shadow.length).toBeGreaterThan(0);
  });
});
