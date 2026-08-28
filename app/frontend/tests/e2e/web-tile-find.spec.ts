/**
 * Web tile keyboard reclaim + find-in-page e2e: registry chords are reclaimed
 * from inside a same-origin web-tile frame, ⌘F opens a find bar that searches
 * the framed page parent-side (CSS Custom Highlight API against the frame
 * window — no script injection), and a cross-origin tile degrades to a
 * disabled bar with an inline hint.
 *
 * Shared setup: `beforeAll` creates a dedicated session `e2e-webfind-<ts>`
 * (80×24) so this file never collides with other specs; a nested `beforeAll`
 * starts the stub HTTP server, and `afterAll` kills the session and closes
 * the stub. `startStub()` binds an ephemeral port on `0.0.0.0` serving a fixed
 * page — a focusable `#inner` button (the click-into-frame target) and exactly
 * three case-varied occurrences of `version`. The dual binding serves both
 * origin cases: `http://localhost:<port>/` converts to the same-origin
 * `/proxy/<port>/` path via `toProxySrc`, while `http://0.0.0.0:<port>/`
 * bypasses it and stays a cross-origin absolute URL. `beforeEach` sets a
 * 1440×800 desktop viewport. `makeWindow(name, url)` runs `tmux new-window`
 * plus a slot-1 web tab stamp (`stampWebTab`) and returns the `@N` id;
 * `gotoWebWindow` deep-links `?view=web` (inbound translation resolves
 * `single:web` — ONE
 * tile, inside the connection-pool budget) and waits for the iframe;
 * `focusFrame` clicks `#inner` inside the frame so keydowns go to the framed
 * document; `frameEvaluate` evaluates in the framed document via the iframe
 * element's `contentFrame()` (same-origin only) for the highlight-registry /
 * style-element probes.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow, stampWebTab } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webfind-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The stub framed page: a focusable button (the click-into-frame target) plus
// exactly THREE case-varied occurrences of "version" for the find flow. Served
// on an ephemeral port bound to 0.0.0.0 so BOTH the same-origin case
// (`http://localhost:<port>/` → toProxySrc → `/proxy/<port>/`) and the
// cross-origin case (`http://0.0.0.0:<port>/` — bypasses toProxySrc, a
// different origin than the app) reach it.
const STUB_PAGE =
  "<!doctype html><html><body>" +
  '<button id="inner">focus target</button>' +
  "<p>Parse the version floor</p><p>the VERSION guard</p><p>version again</p>" +
  "</body></html>";

function startStub(): Promise<{ srv: http.Server; port: number }> {
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(STUB_PAGE);
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "0.0.0.0", () => {
      const address = srv.address();
      if (!address || typeof address === "string") {
        reject(new Error("stub server has no port"));
        return;
      }
      resolve({ srv, port: address.port });
    });
  });
}

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and stamp its slot-1 web tab via tmux — the same
 *  window-option seam web-view-lens.spec.ts uses. Returns the @N id. */
async function makeWindow(page: Page, name: string, url: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  stampWebTab(id, url);
  return id;
}

/** Navigate straight into the web lens (?view=web → single:web — ONE tile,
 *  inside the h1 connection-pool budget) and wait for the iframe. */
async function gotoWebWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}?view=web`);
  await expect(iframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
}

const iframe = (page: Page) => page.getByTitle("Proxied content");
const frameBody = (page: Page) =>
  page.frameLocator('iframe[title="Proxied content"]').locator("body");
const findBar = (page: Page) => page.getByTestId("web-find-bar");
const findInput = (page: Page) => page.getByLabel("Find query");
const findCounter = (page: Page) => page.getByLabel("Match count");

/** Click into the framed page so FOCUS lives inside the iframe — keydowns
 *  then go to the framed document, never reaching the parent unless the
 *  reclaim seam intercepts them. */
async function focusFrame(page: Page): Promise<void> {
  await frameBody(page).locator("#inner").click();
}

/** The framed document (same-origin only) for highlight assertions. */
async function frameEvaluate<T>(page: Page, fn: () => T): Promise<T> {
  const handle = await iframe(page).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("no contentFrame");
  return frame.evaluate(fn);
}

let stub: { srv: http.Server; port: number };

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Web tile — keyboard reclaim + find-in-page (260819-ie2i)", () => {
  test.beforeAll(async () => {
    stub = await startStub();
  });

  test.afterAll(async () => {
    stub.srv.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: the web tile's attach seam reclaims registry chords from in-frame
   * keydowns — the command palette opens while focus is inside the frame —
   * and non-claimed keys pass through to the framed page untouched.
   *
   * Steps:
   * 1. Create a window with web tab `http://localhost:<port>/`; open
   *    `?view=web`; wait for the iframe and the frame's `#inner` button.
   * 2. Click `#inner` (focus enters the frame); press `Meta+k`; assert the
   *    palette input is visible; close it with Escape.
   * 3. Click `#inner` again; press `a`; assert the palette never appeared
   *    (the frame swallowed the plain key, nothing in the parent reacted).
   */
  test("(a) a registry chord pressed INSIDE the same-origin frame is reclaimed — ⌘K opens the palette", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wf-reclaim-${Date.now()}`, `http://localhost:${stub.port}/`);
    await gotoWebWindow(page, id);
    await expect(frameBody(page).locator("#inner")).toBeVisible({ timeout: 10_000 });

    // Focus INSIDE the frame: without reclaim the framed document would
    // swallow ⌘K and the palette would never open.
    await focusFrame(page);
    await page.keyboard.press("Meta+k");
    await expect(page.getByPlaceholder("Type a command")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");

    // A non-registry key still passes through to the framed page untouched —
    // the frame keeps focus and nothing in the parent reacts.
    await focusFrame(page);
    await page.keyboard.press("a");
    await expect(page.getByPlaceholder("Type a command")).toHaveCount(0);
  });

  /**
   * Proves: the full find flow on same-origin content — the chord reclaims
   * from inside the frame, the counter tracks TreeWalker matches, navigation
   * wraps, the highlight styling lands as one inert `<style>` element plus the
   * frame window's Highlight registry (never a `<script>`), and Escape closes
   * + clears.
   *
   * Steps:
   * 1. Create a window on the same-origin stub URL; open `?view=web`; wait
   *    for the frame.
   * 2. Click into the frame; press `Meta+f`; assert the find bar is visible
   *    and its input focused.
   * 3. Fill `version`; assert the counter reads `1/3`.
   * 4. Poll the framed document: `#rk-find-highlight-style` exists AND
   *    `CSS.highlights` holds `rk-find`/`rk-find-active`; assert the frame
   *    contains no `<script>`.
   * 5. Press Enter three times: counter reads `2/3`, `3/3`, then wraps to
   *    `1/3`; press `Shift+Enter`: reads `3/3`.
   * 6. Press Escape: the bar is gone and the frame's highlight style element
   *    is removed.
   */
  test("(b) ⌘F opens the find bar; a query highlights + counts; Enter advances n/N with wrap; Escape closes", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wf-find-${Date.now()}`, `http://localhost:${stub.port}/`);
    await gotoWebWindow(page, id);
    await expect(frameBody(page).locator("#inner")).toBeVisible({ timeout: 10_000 });

    // The chord rides the reclaim seam: pressed with focus INSIDE the frame.
    await focusFrame(page);
    await page.keyboard.press("Meta+f");
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
    await expect(findInput(page)).toBeFocused();

    // Three case-varied occurrences in the stub page.
    await findInput(page).fill("version");
    await expect(findCounter(page)).toHaveText("1/3");

    // The match styling is parent-driven: one inert <style> with the
    // ::highlight() rules in the frame's head, the Highlight registry entries
    // on the FRAME window — and no <script> added to the framed page.
    await expect
      .poll(
        () =>
          frameEvaluate(
            page,
            () =>
              document.getElementById("rk-find-highlight-style") != null &&
              CSS.highlights.has("rk-find") &&
              CSS.highlights.has("rk-find-active"),
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect
      .poll(() => frameEvaluate(page, () => document.getElementsByTagName("script").length))
      .toBe(0);

    // Enter advances with wrap; Shift+Enter retreats.
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("2/3");
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("3/3");
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("1/3");
    await findInput(page).press("Shift+Enter");
    await expect(findCounter(page)).toHaveText("3/3");

    // Escape closes the bar and clears the highlights.
    await findInput(page).press("Escape");
    await expect(findBar(page)).toHaveCount(0);
    await expect
      .poll(() =>
        frameEvaluate(page, () => document.getElementById("rk-find-highlight-style") == null),
      )
      .toBe(true);
  });

  /**
   * Proves: the palette discovery surface — the `Web: Find in page` action
   * exists when the layout includes an open web tile and opens the bar through
   * the same `web-find:open` seam as the chord.
   *
   * Steps:
   * 1. Create a window on the same-origin stub URL; open `?view=web`.
   * 2. Press `Meta+k`; fill `Web: Find`; assert the `Web: Find in page`
   *    option is visible; click it.
   * 3. Assert the find bar is visible.
   */
  test("(b′) the `Web: Find in page` palette entry opens the bar (registry id-join hint)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wf-palette-${Date.now()}`, `http://localhost:${stub.port}/`);
    await gotoWebWindow(page, id);
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Web: Find");
    const option = page.getByRole("option", { name: /Web: Find in page/ });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
  });

  /**
   * Proves: the cross-origin degradation — no search is attempted, the input
   * and navigation buttons are disabled, and the inline hint renders; the ⌕
   * button is the reachable entry point.
   *
   * Steps:
   * 1. Create a window with web tab `http://0.0.0.0:<port>/` (bypasses
   *    `toProxySrc` → cross-origin); open `?view=web`; wait for the iframe.
   * 2. Click the ⌕ `Find in page` button.
   * 3. Assert the bar is visible with the text `page is cross-origin — find
   *    unavailable`, the find input and Next button are disabled, and no
   *    match counter renders.
   */
  test("(c) a cross-origin tile renders the find bar disabled with the hint", async ({ page }) => {
    // 0.0.0.0 bypasses toProxySrc (only localhost/127.0.0.1 convert), so the
    // iframe src stays ABSOLUTE — a different origin than the app's dev server.
    const id = await makeWindow(page, `wf-xorigin-${Date.now()}`, `http://0.0.0.0:${stub.port}/`);
    await gotoWebWindow(page, id);

    // The ⌕ button is the pointer entry point (⌘F inside a cross-origin frame
    // can never reach the parent).
    await page.getByLabel("Find in page", { exact: true }).click();
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("page is cross-origin — find unavailable")).toBeVisible();
    await expect(findInput(page)).toBeDisabled();
    await expect(page.getByLabel("Next match")).toBeDisabled();
    await expect(findCounter(page)).toHaveCount(0);
  });
});
