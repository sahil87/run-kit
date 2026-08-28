import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READY_TIMEOUT } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";
import { resolveWindow as resolveWindowRaw } from "./_ready";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webchrome-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The presented two-page flow (test b) is served from a scratch dir through
// the real `/present/{windowId}/*` route — the window carries the serve root
// in @rk_win_present_root, exactly as `rk present` stamps it.
let presentDir: string;

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Stamp a window option directly via tmux (execFileSync arg arrays — never a
 *  shell string), the same window-option seam web-view-lens.spec.ts uses. */
function setWindowOpt(windowId: string, key: string, value: string): void {
  execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", windowId, key, value], {
    stdio: "ignore",
  });
}

/** Create a window and stamp @rk_win_url (plus @rk_win_present_root when the address
 *  is a /present/ one). Returns the @N id. `url` may be omitted when the
 *  address needs the resolved id (the /present/ path embeds it) — stamp it
 *  via setWindowOpt before navigating. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { url?: string; presentRoot?: string },
): Promise<string> {
  newWindow(TEST_SESSION, name, { cwd: "/tmp" });
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) setWindowOpt(id, "@rk_win_url", opts.url);
  if (opts.presentRoot) setWindowOpt(id, "@rk_win_present_root", opts.presentRoot);
  return id;
}

/** Deep-link a window into the web lens and wait for the iframe. */
async function gotoWebTile(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}?view=web`);
  await expect(page.getByTitle("Proxied content")).toBeAttached({ timeout: READY_TIMEOUT });
}

/** Record every window-option POST for the zero-mutation assertions (R7). */
function trackOptionPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/windows\/.*\/options/.test(req.url())) {
      posts.push(req.url());
    }
  });
  return posts;
}

/** Stub window.open, recording targets on `window.__openedUrls`. */
async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __openedUrls: string[]; open: (url?: unknown) => null };
    w.__openedUrls = [];
    w.open = (url?: unknown) => {
      w.__openedUrls.push(String(url));
      return null;
    };
  });
}

const webTile = (page: Page) => page.getByTestId("surface-tile-web");
const addressInput = (page: Page) => webTile(page).getByLabel("URL");

test.beforeAll(() => {
  createSession(TEST_SESSION);
  presentDir = mkdtempSync(join(tmpdir(), "rk-e2e-present-"));
  // The link carries the `?server=` plumbing param explicitly — the /present/
  // route reads the tmux server from the query (defaulting to "default"), so
  // a bare relative link would 404 on this spec's isolated e2e server.
  writeFileSync(
    join(presentDir, "page-one.html"),
    `<!doctype html><html><head><title>Page One</title></head><body><a href="page-two.html?server=${TMUX_SERVER}" id="go">two</a></body></html>`,
  );
  writeFileSync(
    join(presentDir, "page-two.html"),
    `<!doctype html><html><head><title>Page Two</title></head><body><p>second</p></body></html>`,
  );
});

test.afterAll(() => {
  killSession(TEST_SESSION);
  rmSync(presentDir, { recursive: true, force: true });
});

test.describe("Web tile browser chrome (260819-v6y4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("(a) a frame-refused external URL renders the error state with the Open-in-browser escape hatch", async ({
    page,
  }) => {
    const optionPosts = trackOptionPosts(page);
    await stubWindowOpen(page);
    // Mock the frame-check probe (trailing `*` — the glob must cover the
    // query string) and abort the external navigation so the test is hermetic.
    await page.route("/api/frame-check*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reachable: true,
          embeddable: false,
          status: 200,
          reason: "X-Frame-Options: DENY",
        }),
      }),
    );
    await page.route("https://framed-refusal.example/**", (route) => route.abort());

    const id = await makeWindow(page, `wc-refuse-${Date.now()}`, {
      url: "https://framed-refusal.example/some/page",
    });
    await gotoWebTile(page, id);

    // The refusal state replaces a silent blank iframe (design study state 05).
    const errBox = page.getByTestId("web-tile-error");
    await expect(errBox).toBeVisible({ timeout: 10_000 });
    await expect(errBox).toContainText("framed-refusal.example refuses embedding");
    await expect(errBox).toContainText("X-Frame-Options: DENY");
    await expect(page.getByTitle("Proxied content")).toBeHidden();

    // The escape hatch pops the CURRENT address — @rk_win_url untouched.
    await errBox.getByRole("button", { name: "Open in browser" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls))
      .toEqual(["https://framed-refusal.example/some/page"]);
    expect(optionPosts, `no /options POST; got ${optionPosts.join(", ")}`).toHaveLength(0);
  });

  test("(b) back/forward drive the same-origin frame history per-viewer — zero option POSTs", async ({
    page,
  }) => {
    const optionPosts = trackOptionPosts(page);
    const id = await makeWindow(page, `wc-nav-${Date.now()}`, { presentRoot: presentDir });
    setWindowOpt(id, "@rk_win_url", `/present/${id}/page-one.html?server=${TMUX_SERVER}`);
    await gotoWebTile(page, id);

    const frame = page.frameLocator('iframe[title="Proxied content"]');
    await expect(frame.locator("#go")).toBeVisible({ timeout: 10_000 });
    // Rest display form: the file basename, plumbing params hidden.
    await expect(addressInput(page)).toHaveValue("page-one.html");

    // Navigate in-frame; the address bar's DISPLAY tracks the frame location
    // (view state), never the substrate.
    await frame.locator("#go").click();
    await expect(frame.locator("p", { hasText: "second" })).toBeVisible({ timeout: 10_000 });
    await expect(addressInput(page)).toHaveValue("page-two.html");

    // ◀ returns to page one — contentWindow.history, zero /options POSTs.
    await webTile(page).getByRole("button", { name: "Back" }).click();
    await expect(frame.locator("#go")).toBeVisible({ timeout: 10_000 });
    await expect(addressInput(page)).toHaveValue("page-one.html");

    // ▶ goes forward again.
    await webTile(page).getByRole("button", { name: "Forward" }).click();
    await expect(frame.locator("p", { hasText: "second" })).toBeVisible({ timeout: 10_000 });
    await expect(addressInput(page)).toHaveValue("page-two.html");

    expect(optionPosts, `no /options POST; got ${optionPosts.join(", ")}`).toHaveLength(0);
  });

  test("(c) the address bar shows the display form at rest and the raw value on focus; Escape reverts", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wc-display-${Date.now()}`, { presentRoot: presentDir });
    setWindowOpt(id, "@rk_win_url", `/present/${id}/page-one.html?server=${TMUX_SERVER}`);
    await gotoWebTile(page, id);
    const frame = page.frameLocator('iframe[title="Proxied content"]');
    await expect(frame.locator("#go")).toBeVisible({ timeout: 10_000 });

    const input = addressInput(page);
    await expect(input).toHaveValue("page-one.html");

    // Focus reveals the raw editable value (the tracked frame location),
    // fully selected.
    await input.click();
    await expect(input).toHaveValue(`/present/${id}/page-one.html?server=${TMUX_SERVER}`);
    const selection = await input.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    expect(selection).toEqual([0, `/present/${id}/page-one.html?server=${TMUX_SERVER}`.length]);

    // Escape reverts to the display form with no POST.
    await input.press("Escape");
    await expect(input).toHaveValue("page-one.html");
  });

  test("(d) no switch-to-terminal button renders in the web tile (R13)", async ({ page }) => {
    const id = await makeWindow(page, `wc-noswitch-${Date.now()}`, { presentRoot: presentDir });
    setWindowOpt(id, "@rk_win_url", `/present/${id}/page-one.html?server=${TMUX_SERVER}`);
    await gotoWebTile(page, id);
    await expect(webTile(page).getByLabel("Switch to terminal")).toHaveCount(0);
    // The chrome that replaced it IS present (design-study button order).
    await expect(webTile(page).getByRole("button", { name: "Back" })).toBeVisible();
    await expect(webTile(page).getByRole("button", { name: "Forward" })).toBeVisible();
    await expect(webTile(page).getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(webTile(page).getByRole("button", { name: "Open in browser" })).toBeVisible();
  });
});
