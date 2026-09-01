/**
 * Web tab strip e2e: a window's web-tab family (`@rk_win_web_<n>` slots +
 * `@rk_win_web_active`) renders as a tab strip above the URL bar when it
 * holds ≥2 tabs, tab clicks and closes go through the server verb routes
 * (`…/web/{n}/select`, `…/web/{n}/remove`, `…/web`) and land in tmux, hidden
 * frames stay mounted (P3), a second viewer converges on the same strip, and
 * the address bar splits add (`+`) from replace (Enter).
 *
 * Shared setup: `beforeAll` creates a dedicated session `e2e-webtabs-<ts>`
 * (80×24) so this file never collides with other specs (fullyParallel off);
 * `afterAll` kills it. `beforeEach` route-stubs `/proxy/3001|3002|3003/**`
 * with a static 200 page (`stubProxyPorts` from `_web-tile.ts` — the
 * dead-port error state hides the iframe when nothing listens on the stamped
 * port, and these tests assert strip chrome and tmux state, never frame
 * content) and sets a wide desktop viewport (1440×800). `makeWindow(name)`
 * creates a window via `tmux new-window`, seeds a three-tab family
 * (`/proxy/3001/`, `/proxy/3002/`, `/proxy/3003/`, active slot 2) through
 * `stampWebTabs`, and stamps `@rk_win_layout=single:web` so the bare route
 * renders the web tile directly. `gotoWindow(id)` navigates to the bare
 * window route and waits for the status bar's `Connected` dot. Tmux-side
 * assertions read the window options via `windowOption` (the verb POSTs write
 * tmux synchronously; polls budget `OPTION_TICK_TIMEOUT` for the
 * request/tick round-trip); UI assertions use the strip testids. Tests run
 * serially (workers: 1), so at most one three-frame tile is mounted at a
 * time — the HTTP/1.1 6-slot pool budget; no test ever mounts a second tile.
 * Test 4's second browser context re-stubs the proxy routes (page.route is
 * per-page) and closes in a `finally`. The closing test stamps the LEGACY
 * slot form for the R4 compat row (new-form rows live in
 * web-tile-chrome.spec.ts), reading its `@rk_win_present_root` from the
 * mkdtemp-managed presentDir scrubbed in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import {
  TMUX_SERVER,
  createSession,
  killSession,
  newWindow,
  setWindowOption,
  stampWebTabs,
  windowOption,
} from "./_tmux";
import { stubProxyPorts } from "./_web-tile";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webtabs-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The seeded family: three proxied-port URLs, slot 2 active. The strip labels
// are webTabTitle of each — `localhost:<port>/` for a `/proxy/<port>/` root.
const TAB_URLS = ["/proxy/3001/", "/proxy/3002/", "/proxy/3003/"];
const TAB_LABELS = ["localhost:3001/", "localhost:3002/", "localhost:3003/"];
const SEED_ACTIVE = 2;

// The legacy-form compat row's present root (created in beforeAll; removed in
// afterAll) — the `@rk_win_present_root` slot-1 dual-read the legacy arm
// needs to register the root in the server's declared set.
let presentDir: string;

// Post-write tmux assertion budget — mirrors present-auto-expand's constant
// (the verb POST writes tmux synchronously, but the request + option
// round-trip still needs headroom on a contended box).
const OPTION_TICK_TIMEOUT = 30_000;

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window, seed the three-tab family (`stampWebTabs`), and stamp the
 *  shared `single:web` layout so the bare route opens the web tile. Returns
 *  the @N id. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  stampWebTabs(id, TAB_URLS, SEED_ACTIVE);
  setWindowOption(id, "@rk_win_layout", "single:web");
  return id;
}

/** Navigate to a window's bare route (layout comes from the stamped option)
 *  and wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const strip = (page: Page) => page.getByTestId("web-tab-strip");
const tab = (page: Page, n: number) =>
  page.locator(`[data-testid="web-tab"][data-index="${n}"]`);
const frames = (page: Page) => page.getByTitle("Proxied content");
const visibleFrames = (page: Page) =>
  page.locator('iframe[title="Proxied content"]:visible');
/** The mounted frame (hidden or not) for a seeded proxy URL. */
const frameFor = (page: Page, url: string) =>
  page.locator(`iframe[title="Proxied content"][src="${url}"]`);

/** Retry until a window option reads the expected value. */
async function expectWindowOption(
  windowId: string,
  option: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(() => windowOption(windowId, option), { timeout: OPTION_TICK_TIMEOUT })
    .toBe(expected);
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
  presentDir = mkdtempSync(join(tmpdir(), "rk-e2e-webtabs-present-"));
  writeFileSync(join(presentDir, "legacy-doc.html"), "<!doctype html><html><body><p>legacy</p></body></html>");
});

test.afterAll(() => {
  killSession(TEST_SESSION);
  rmSync(presentDir, { recursive: true, force: true });
});

test.describe("Web tab strip", () => {
  test.beforeEach(async ({ page }) => {
    await stubProxyPorts(page, 3001, 3002, 3003);
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: a window with a three-tab family renders the strip above the URL
   * bar with one `webTabTitle`-labelled tab per slot, the seeded active slot
   * (2) is the only `aria-selected` tab, and exactly one iframe is visible
   * while all three stay mounted.
   *
   * Steps:
   * 1. Create a window with the seeded family and `single:web`; navigate.
   * 2. Assert the strip is visible with three `web-tab` children whose labels
   *    are `localhost:3001/`, `localhost:3002/`, `localhost:3003/`.
   * 3. Assert tab 2 is `aria-selected="true"` and tabs 1/3 are not.
   * 4. Assert three `Proxied content` iframes are attached, exactly one is
   *    visible, and the visible one's `src` is the active slot's
   *    `/proxy/3002/`.
   */
  test("the strip renders one labelled tab per slot with the seeded active tab selected and one visible frame", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `wt-render-${Date.now()}`);
    await gotoWindow(page, id);

    await expect(strip(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(page.getByTestId("web-tab")).toHaveCount(3);
    for (const [i, label] of TAB_LABELS.entries()) {
      await expect(tab(page, i + 1)).toContainText(label);
    }

    await expect(tab(page, 2)).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, 1)).toHaveAttribute("aria-selected", "false");
    await expect(tab(page, 3)).toHaveAttribute("aria-selected", "false");

    // P3: one mounted iframe per tab, only the active slot's visible.
    await expect(frames(page)).toHaveCount(3);
    await expect(visibleFrames(page)).toHaveCount(1);
    await expect(visibleFrames(page)).toHaveAttribute("src", TAB_URLS[SEED_ACTIVE - 1]);
  });

  /**
   * Proves: clicking a tab POSTs the select verb — `@rk_win_web_active`
   * becomes the clicked slot in tmux — and the previously active frame stays
   * mounted with `hidden` (P3: a selection change never unmounts a frame).
   *
   * Steps:
   * 1. Create the seeded window; navigate; assert the strip.
   * 2. Click tab 3.
   * 3. Assert `@rk_win_web_active` reads "3" (polled), tab 3 is selected in
   *    the DOM, and tab 2 is not.
   * 4. Assert all three iframes remain attached; the `/proxy/3002/` frame is
   *    hidden and the `/proxy/3003/` frame is the visible one.
   */
  test("clicking a tab selects it in tmux and keeps the previous frame mounted but hidden", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `wt-select-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(strip(page)).toBeVisible({ timeout: READY_TIMEOUT });

    await tab(page, 3).click();
    await expectWindowOption(id, "@rk_win_web_active", "3");
    await expect(tab(page, 3)).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, 2)).toHaveAttribute("aria-selected", "false");

    // P3: no frame is unmounted by the selection change.
    await expect(frames(page)).toHaveCount(3);
    await expect(frameFor(page, TAB_URLS[1])).toBeHidden();
    await expect(frameFor(page, TAB_URLS[2])).toBeVisible();
    await expect(visibleFrames(page)).toHaveCount(1);
  });

  /**
   * Proves: closing the middle tab POSTs the remove verb — the slots below
   * shift down in tmux (`@rk_win_web_2` takes the former tab-3 URL,
   * `@rk_win_web_3` is unset), the active pointer follows the server's
   * repoint rule (active == removed → min(n, newLen) = 2), the strip
   * re-renders with two renumbered tabs, and the `×` click does not itself
   * select anything (`_active` never churns).
   *
   * Steps:
   * 1. Create the seeded window; navigate; assert the strip and that
   *    `@rk_win_web_active` reads "2".
   * 2. Hover tab 2 (the hover-revealed close glyph) and click its `×`.
   * 3. Assert `@rk_win_web_2` is the former tab-3 URL, `@rk_win_web_3` is
   *    empty, and `@rk_win_web_active` still reads "2" — the repoint, with no
   *    intermediate select from the `×` click.
   * 4. Assert the strip shows two tabs labelled `localhost:3001/` and
   *    `localhost:3003/` (renumbered slots 1–2) with tab 2 selected.
   */
  test("closing the middle tab shifts the tmux slots down, repoints active, and renumbers the strip", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `wt-close-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(strip(page)).toBeVisible({ timeout: READY_TIMEOUT });
    expect(windowOption(id, "@rk_win_web_active")).toBe("2");

    // The glyph is always rendered on the active tab; the hover also covers
    // the hover-revealed posture on inactive tabs.
    await tab(page, 2).hover();
    await tab(page, 2).getByTestId("web-tab-close").click();

    await expectWindowOption(id, "@rk_win_web_2", TAB_URLS[2]);
    expect(windowOption(id, "@rk_win_web_3")).toBe("");
    // active == removed slot → repointActive keeps min(2, 2) = 2; a stray
    // select from the `×` click would have churned the pointer.
    await expectWindowOption(id, "@rk_win_web_active", "2");

    await expect(page.getByTestId("web-tab")).toHaveCount(2);
    await expect(tab(page, 1)).toContainText(TAB_LABELS[0]);
    await expect(tab(page, 2)).toContainText(TAB_LABELS[2]);
    await expect(tab(page, 2)).toHaveAttribute("aria-selected", "true");
  });

  /**
   * Proves: the strip is shared state — a tab selection in one browser
   * context is what a second, independently loaded context on the same
   * window route sees (same tabs, same active tab, same visible frame).
   *
   * Steps:
   * 1. Create the seeded window; navigate context 1's page; click tab 1 and
   *    wait for `@rk_win_web_active` to read "1".
   * 2. Open a second browser context (fresh page, proxy routes re-stubbed,
   *    desktop viewport) on the same bare route.
   * 3. Assert context 2's strip shows the same three tabs with tab 1
   *    `aria-selected="true"` and the visible frame is `/proxy/3001/`.
   * 4. Close the second context.
   */
  test("a second browser context on the same route sees the active tab the first context selected", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    const id = await makeWindow(page, `wt-coherence-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(strip(page)).toBeVisible({ timeout: READY_TIMEOUT });

    await tab(page, 1).click();
    await expectWindowOption(id, "@rk_win_web_active", "1");

    const context2 = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    try {
      const page2 = await context2.newPage();
      await stubProxyPorts(page2, 3001, 3002, 3003);
      await gotoWindow(page2, id);

      await expect(strip(page2)).toBeVisible({ timeout: READY_TIMEOUT });
      await expect(page2.getByTestId("web-tab")).toHaveCount(3);
      for (const [i, label] of TAB_LABELS.entries()) {
        await expect(tab(page2, i + 1)).toContainText(label);
      }
      await expect(tab(page2, 1)).toHaveAttribute("aria-selected", "true");
      await expect(tab(page2, 2)).toHaveAttribute("aria-selected", "false");
      await expect(visibleFrames(page2)).toHaveCount(1);
      await expect(visibleFrames(page2)).toHaveAttribute("src", TAB_URLS[0]);
    } finally {
      await context2.close();
    }
  });

  /**
   * Proves: `+` with a fresh address draft in the bar adds a tab — a new
   * slot appears in tmux and becomes the selected tab — while Enter on the
   * bar afterwards REPLACES the active slot (`@rk_win_web_<active>` is
   * rewritten) and never grows the family (no fifth slot).
   *
   * Steps:
   * 1. Create the seeded window; navigate; assert the strip.
   * 2. Fill the address bar with `localhost:3003/docs` (a fresh URL on the
   *    3003 port — an identical stored URL would dedupe to its existing slot)
   *    and click `+`.
   * 3. Assert `@rk_win_web_4` holds `/proxy/3003/docs`,
   *    `@rk_win_web_active` reads "4", and the strip shows four tabs with
   *    tab 4 selected.
   * 4. Refill the bar with `localhost:3001/alt` and press Enter.
   * 5. Assert `@rk_win_web_4` was rewritten to `/proxy/3001/alt`,
   *    `@rk_win_web_5` stays empty (family length unchanged), slots 1–3 are
   *    untouched, and the active pointer still reads "4".
   */
  test("+ adds a tab from the address draft; Enter on the bar replaces only the active slot", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const id = await makeWindow(page, `wt-add-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(strip(page)).toBeVisible({ timeout: READY_TIMEOUT });

    const address = page.getByTestId("surface-tile-web").getByLabel("URL");
    await address.fill("localhost:3003/docs");
    await page.getByTestId("web-tab-add").click();

    await expectWindowOption(id, "@rk_win_web_4", "/proxy/3003/docs");
    await expectWindowOption(id, "@rk_win_web_active", "4");
    await expect(page.getByTestId("web-tab")).toHaveCount(4);
    await expect(tab(page, 4)).toHaveAttribute("aria-selected", "true");

    // Enter outside the new-tab arm writes the ACTIVE slot — it never adds.
    await address.fill("localhost:3001/alt");
    await address.press("Enter");

    await expectWindowOption(id, "@rk_win_web_4", "/proxy/3001/alt");
    expect(windowOption(id, "@rk_win_web_5")).toBe("");
    expect(windowOption(id, "@rk_win_web_1")).toBe(TAB_URLS[0]);
    expect(windowOption(id, "@rk_win_web_2")).toBe(TAB_URLS[1]);
    expect(windowOption(id, "@rk_win_web_3")).toBe(TAB_URLS[2]);
    await expectWindowOption(id, "@rk_win_web_active", "4");
  });

  /**
   * Proves: a stored LEGACY slot-form present URL
   * (`/present/@N/{n}/{path}?server=`) keeps serving unchanged through the
   * legacy arm for one release (the compat row; the new arm lives in
   * web-tile-chrome.spec.ts).
   *
   * Steps:
   * 1. Create a window; stamp slot 1 with the LEGACY slot-form present URL
   *    embedding the resolved `@N` id, plus a slot-1
   *    `@rk_win_present_root` declaration (the legacy arm's dual-read).
   * 2. Deep-link `?view=web`; assert the tile keeps the legacy address and
   *    the strip label derives the file basename.
   */
  test("a stored LEGACY slot-form present URL serves through the legacy arm (R4)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wt-legacy-${Date.now()}`);
    // Recompose with the LEGACY slot form; the @N id embeds differently than
    // the content-keyed hash. The slot-1 root declaration uses the retired
    // @rk_win_present_root (the legacy arm's dual-read).
    stampWebTabs(id, [`/present/${id}/1/legacy-doc.html?server=${TMUX_SERVER}`], 1);
    setWindowOption(id, "@rk_win_present_root", presentDir);
    await gotoWindow(page, id);
    const tile = page.getByTestId("surface-tile-web");
    await expect(tile.getByLabel("URL")).toHaveValue("legacy-doc.html");
    await expect(page.getByTestId("web-tab").nth(0)).toHaveAttribute("aria-selected", "true");
  });
});
