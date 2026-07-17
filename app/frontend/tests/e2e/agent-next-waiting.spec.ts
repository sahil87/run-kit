import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the SSE `sessions` payload + server list
// via page.route, then drive the command palette. See agent-next-waiting.spec.md
// for intent + steps.
//
// Agent: Next waiting (260706-y1ar; status-pyramid.md § Attention Propagation).
// The keyboard-first attention nav (Constitution V): cycles focus through
// windows whose rolled-up agentState is `waiting`, navigating to them; no-op
// with a "No agents waiting" toast when none.

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
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command...");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill("Agent: Next waiting");
  await page.keyboard.press("Enter");
}

test.describe("Agent: Next waiting palette action", () => {
  test("navigates to the waiting window when one exists", async ({ page }) => {
    await mockBackend(page, true);
    // Start on the active (non-waiting) window.
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("active-win").first()).toBeVisible();

    await runNextWaiting(page);

    // Navigates to the waiting window (@2 → URL segment `2`).
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });

  test("no-op with a 'No agents waiting' toast when none are waiting", async ({ page }) => {
    await mockBackend(page, false);
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("active-win").first()).toBeVisible();

    await runNextWaiting(page);

    // No navigation away from @1, and the info toast appears.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
    await expect(page.getByText("No agents waiting")).toBeVisible({ timeout: 5_000 });
  });

  // A-019: the waiting halo's STATIC (reduced-motion) form. Under
  // prefers-reduced-motion the constant-yellow halo must not pulse — the
  // globals.css @media block zeroes the animation and paints a static ring.
  // Only real-browser CSS evaluates media queries + globals.css (jsdom does
  // not), so this lives in e2e. The waiting-win's sidebar StatusDot carries the
  // rk-waiting-halo class; we assert its computed animation is `none` and a
  // static box-shadow ring remains.
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
