import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webview-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/heading/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; name: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        id = win.windowId;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return id!;
}

/** Create a window and (optionally) stamp @rk_url / @rk_type directly via tmux —
 *  the same window-option seam the backend tmux test uses. Returns the @N id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { url?: string; iframeType?: boolean } = {},
): Promise<string> {
  execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
    stdio: "ignore",
  });
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execSync(
      `tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_url "${opts.url}"`,
      { stdio: "ignore" },
    );
  }
  if (opts.iframeType) {
    execSync(`tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_type iframe`, {
      stdio: "ignore",
    });
  }
  return id;
}

/** Navigate to a window's terminal route (optionally with a view param) and wait
 *  for the SSE connection. */
async function gotoWindow(
  page: Page,
  windowId: string,
  // Only `web` is a supported deep-link value; `tty` is the ABSENCE of the
  // param (the router drops any non-`web` value), so it is never passed here.
  view?: "web",
): Promise<void> {
  const q = view ? `?view=${view}` : "";
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${q}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: 10_000,
  });
}

const webChip = (page: Page) => page.getByRole("button", { name: "Web view" });
const ttyChip = (page: Page) =>
  page.getByRole("button", { name: "Terminal view" });
const iframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

test.beforeAll(() => {
  try {
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
      { stdio: "ignore" },
    );
  } catch {
    // Session may already exist.
  }
});

test.afterAll(() => {
  try {
    execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
      stdio: "ignore",
    });
  } catch {
    // Best effort.
  }
});

test.describe("Web view lens — iframe as a per-viewer lens", () => {
  test("switcher chip appears only on a web-capable window", async ({ page }) => {
    // A plain terminal window (no @rk_url) offers only tty → no chip.
    const plain = await makeWindow(page, `wv-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(webChip(page)).toHaveCount(0);
    await expect(ttyChip(page)).toHaveCount(0);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // A window with @rk_url offers tty + web → the two-segment chip renders.
    const web = await makeWindow(page, `wv-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(webChip(page)).toBeVisible({ timeout: 10_000 });
    await expect(ttyChip(page)).toBeVisible();
  });

  test("flipping web↔tty preserves the window and never POSTs an option mutation", async ({
    page,
  }) => {
    const name = `wv-flip-${Date.now()}`;
    const id = await makeWindow(page, name, { url: IFRAME_URL });

    // Record any window-option mutation (the retired @rk_type flip). A view
    // switch must NEVER hit /options.
    const optionPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/windows\/.*\/options/.test(req.url())) {
        optionPosts.push(req.url());
      }
    });

    // Default view for an untyped (non-iframe) window with a url is tty.
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Flip to web via the chip → iframe renders, URL carries ?view=web.
    await webChip(page).click();
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\?view=web/);

    // Flip back to tty via the chip → terminal renders, ?view param dropped.
    await ttyChip(page).click();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\?view=/);

    // The window still exists in the snapshot (never destroyed) and its id is
    // unchanged — a view switch mutates neither identity nor options.
    const stillId = await resolveWindow(page, name);
    expect(stillId).toBe(id);
    expect(
      optionPosts,
      `no /options POST on a view switch; got ${optionPosts.join(", ")}`,
    ).toHaveLength(0);
  });

  test("deep link ?view=web cold-loads the iframe", async ({ page }) => {
    const id = await makeWindow(page, `wv-deep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "web");
    // Cold load resolves straight to the web lens.
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(webChip(page)).toHaveAttribute("aria-pressed", "true");
    // The center heading follows the lens.
    await expect(page.getByText(/Web:/)).toBeVisible();
  });

  test("?view=web on a window with no @rk_url falls back to the terminal", async ({
    page,
  }) => {
    // No url → web is unavailable → the unavailable deep link degrades to tty.
    const id = await makeWindow(page, `wv-nourl-${Date.now()}`);
    await gotoWindow(page, id, "web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(iframe(page)).toHaveCount(0);
    // No chip (single available view).
    await expect(webChip(page)).toHaveCount(0);
  });

  test("legacy @rk_type=iframe window defaults to web with the chip present", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wv-legacy-${Date.now()}`, {
      url: IFRAME_URL,
      iframeType: true,
    });
    // No ?view param, no localStorage → the iframe-typed default hint wins → web.
    await gotoWindow(page, id);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(webChip(page)).toBeVisible();
    await expect(ttyChip(page)).toBeVisible();
    await expect(webChip(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("last-view persists across a window switch away and back", async ({
    page,
  }) => {
    const a = await makeWindow(page, `wv-persist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `wv-persist-b-${Date.now()}`);

    // On A, switch to web (writes localStorage + ?view=web).
    await gotoWindow(page, a);
    await webChip(page).click();
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click), not a
    // page.goto — this exercises the R6 search-param drop through the router
    // seam (`navigateToWindow`), guarding against a future retainSearchParams /
    // router-upgrade regression that would silently carry `?view=web` onto B.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar
      .locator(`[data-window-id="${b}"]`)
      .getByRole("button")
      .first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();

    // Selection settles on B — the client-side switch was accepted.
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    // B resolves independently to tty, and the outgoing `?view=web` was dropped
    // by the router seam (R6) — not carried onto B.
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\?view=/);

    // Back to A WITHOUT a ?view param — the persisted last-view (web) resolves.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(a)}`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(webChip(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("375px mobile: chip is hidden but the web lens still renders via deep link", async ({
    page,
  }) => {
    // The L1 switcher is `hidden sm:*` (mobile hides the top-bar control
    // cluster), but the lens itself must still resolve + render on mobile.
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await makeWindow(page, `wv-mobile-${Date.now()}`, { url: IFRAME_URL });
    // Do NOT gate on the `Connected` dot here: it is `hidden sm:inline`, so at
    // 375px it is `display:none` and never becomes visible (same reason
    // window-heading.spec.ts's mobile test gates on the heading, not the dot).
    // Gate directly on the iframe — the thing under test.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?view=web`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    // Chip is hidden below `sm`.
    await expect(webChip(page)).toBeHidden();
    // No horizontal page overflow at 375px.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Desktop viewport: the chip is visible again.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(webChip(page)).toBeVisible({ timeout: 10_000 });
  });
});
