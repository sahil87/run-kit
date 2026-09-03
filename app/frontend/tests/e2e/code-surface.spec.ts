import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { plainCodeStubHtml, reserveDeadPort, startCodeStub, type CodeStub, type DeadPort } from "./_ports";
import { openPalette, READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import {
  TMUX_SERVER,
  createSession,
  killSession,
  newWindow,
  stampWebTab,
  windowOption,
} from "./_tmux";
import { stubProxyPorts } from "./_web-tile";

/**
 * The code surface end to end (`docs/specs/right-panel.md` § The code lens +
 * § Surface Registry; `docs/specs/surface-layout.md`): the `code` lens joins
 * the view registry through the palette's `View: Code` action and the
 * tileable code surface (`Code tile` top-bar toggle —
 * the right rail is REMOVED, its toggles moved into the top bar's
 * `surface-toggles` group; `?panel=code` → `split-h:tty,code` via the same
 * translation), with availability =
 * gitRoot derived (the port resolves by convention — `RK_CODE_SERVER_PORT`
 * preset, else `RK_PORT+2` — and no longer gates), and code-server
 * reachability governing only the surface CONTENT (live iframe vs the
 * not-running empty state). The iframe src is the STABLE
 * `/code/?folder=<git root>` route — the port never appears in a URL. Also
 * covers the `/code` → `/code/` redirect.
 *
 * Shared setup:
 * - `beforeEach`: `stubProxyPorts(page, <derived>)` (`_web-tile.ts`)
 *   route-stubs the derived dead port's `/proxy/<port>/**` with a static 200
 *   page (port from `reserveDeadPort`, `_ports.ts`) — the dead-port error
 *   state hides the iframe when nothing listens on the stamped dead URL, and
 *   these tests assert tile chrome, never frame content. Each
 *   describe's `beforeEach` also sets a wide desktop viewport (1440×800) — the
 *   top-bar surface-toggle group is desktop terminal-route only.
 * - tmux server: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`); never
 *   run Playwright directly — `just test-e2e code-surface`.
 * - code-server stub: code-server is not installable in the test env, so the
 *   first describe binds a stub HTTP server (`startCodeStub`, `_ports.ts`) on
 *   `RK_CODE_SERVER_PORT` — the same env the test-e2e script seeds the
 *   backend with; an ephemeral port when unset, so bare runs never collide —
 *   serving a minimal page with a focusable `#inner` button; the second
 *   describe runs with the stub DOWN. The backend's reachability probe is
 *   TTL-cached (~5s), so down-state assertions use a 30s budget. The helper
 *   validates the env against the backend's own 1-65535 range before binding,
 *   so an out-of-range value fails with a named error instead of surfacing as
 *   unrelated missing-affordance assertions. The backend resolves the same
 *   port server-side (the preset wins) and forwards `/code/*` to it.
 * - `beforeAll`: create one dedicated session `e2e-codesurface-<ts>` (80×24) so
 *   this file never collides with other specs (`fullyParallel` off), then warm
 *   the dev server with a throwaway TERMINAL-route page load (Vite's cold
 *   transform of the app + xterm graph would otherwise eat the first test's
 *   10s budget). `afterAll` kills the session (best-effort); the
 *   stub-listening describe also closes the stub.
 * - `makeWindow(name, {cwd?})`: create a window via `tmux new-window`
 *   (optionally with `-c /tmp` for a NON-repo cwd — the availability-negative
 *   case). Returns the stable `@N` id.
 * - `GIT_ROOT`: `git rev-parse --show-toplevel` from the spec process — the
 *   toplevel every in-repo test window derives (windows inherit the tmux
 *   server's repo-root cwd).
 * - `expectWindowLayout(id, expected)`: retrying read of the window's
 *   `@rk_win_layout` tmux option — the SHARED layout the translation / verbs
 *   write (never the URL; the URL stays bare after translation drops the
 *   inbound params).
 * - Locators: the `Code tile` / `Web tile` top-bar toggles (role + accessible
 *   name SCOPED to the `banner` — the top bar's aria-hidden measurement probe
 *   duplicates every in-bar control, so accessible-name queries are the only
 *   unambiguous ones), the `surface-tile-code` tile testid, the `Code editor`
 *   iframe title, the `code-surface-empty` testid, the `.xterm` terminal
 *   surface, and the command palette (the only lens-switch surface).
 */

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-codesurface-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The git root every in-repo window derives (windows inherit the tmux server's
// start cwd — the repo root). FindGitRoot walks to the toplevel, so the
// expected `?folder=` value is the worktree root.
const GIT_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName))
    .windowId;
}

/** Create a window (optionally in a NON-repo cwd) and return its @N id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { cwd?: string } = {},
): Promise<string> {
  newWindow(TEST_SESSION, name, opts);
  return resolveWindow(page, name);
}

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the SSE connection. The `Connected` dot lives in the full-width
 *  bottom status bar since the composed-frame unification (the desktop sidebar
 *  renders no footer), so the query is unscoped — it is the only `Connected`
 *  element on a desktop route. */
async function gotoWindow(
  page: Page,
  windowId: string,
  search = "",
): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

// The surface toggles live in the top bar's `surface-toggles` group (the right
// rail is REMOVED — composed-frame unification). Banner-scoped accessible-name
// queries: the top bar always renders an aria-hidden off-screen measurement
// probe duplicating every in-bar control, so testid / `:visible` queries are
// ambiguous — getByRole excludes the probe.
const codeToggle = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Code tile" });
const webToggle = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Web tile" });
// The panel slot is gone (260812-ab5v) — surfaces render as layout TILES.
const codeTile = (page: Page) => page.getByTestId("surface-tile-code");
const codeIframe = (page: Page) => page.getByTitle("Code editor");
const notRunning = (page: Page) => page.getByTestId("code-surface-empty");
const terminal = (page: Page) => page.locator(".xterm").first();

/** Assert the shared layout a window carries — its `@rk_win_layout` tmux
 *  option (retrying: a verb's POST and the option tick land asynchronously). */
async function expectWindowLayout(windowId: string, expected: string): Promise<void> {
  await expect
    .poll(() => windowOption(windowId, "@rk_win_layout"), { timeout: 10_000 })
    .toBe(expected);
}

/** Assert the route is bare — layout state lives in tmux, never the URL. */
function expectBareUrl(page: Page): void {
  expect(new URL(page.url()).search).toBe("");
}

// The dead-port error state (260819-v6y4 R8) hides the iframe when nothing
// listens on the stamped port — these tests assert tile chrome, never frame
// content, so the proxy path is route-stubbed live (see _web-tile.ts). The
// port is a reserved-then-released ephemeral (dead by construction).
let DEAD: DeadPort;

test.beforeAll(async () => {
  DEAD = await reserveDeadPort();
});

test.beforeEach(async ({ page }) => {
  await stubProxyPorts(page, DEAD.port);
});

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  // Cold-boot warm-up: when this file runs standalone (`just test-e2e
  // code-surface`), the first test would otherwise pay Vite's cold transform
  // of the app + xterm graph INSIDE its 10s budget (observed: `Connected`
  // never landing in time). A throwaway TERMINAL-route load of this session's
  // first window (beforeAll is outside the per-test budget) absorbs it — the
  // xterm chunk is what a server-route warm-up would miss.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Code lens & CODE surface (phase 2) — stub reachable", () => {
  let stub: CodeStub;

  test.beforeAll(async () => {
    stub = await startCodeStub(plainCodeStubHtml());
  });

  test.afterAll(async () => {
    await new Promise((resolve) => stub.server.close(resolve));
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: availability derives from the SSE `gitRoot` field alone
   * (Constitution II/X — no client-side declaration; the port is conventional
   * and does not gate); a non-repo cwd (`/tmp`) derives no gitRoot, so neither
   * affordance renders. The `View: Code` lens switch is palette-only — the
   * chevron menu carries no `View:` rows. The test carries a 30s budget: two
   * window creations plus two full page loads land marginal at the 10s default
   * under suite load.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate; assert the terminal, then the `Code
   *    tile` top-bar toggle (SSE-gated).
   * 2. Open the palette with `View: Code`; assert the option is visible;
   *    Escape. Open the "More controls" menu; assert it carries NO `View:`
   *    rows; Escape.
   * 3. Create a `/tmp`-cwd window; navigate; assert NO `Code tile` button and
   *    no `View: Code` palette option.
   */
  test("the Code tile top-bar toggle appears only on a git-repo window; the palette's `View: Code` action gates the same way", async ({
    page,
  }) => {
    // Two window creations + two full page loads + palette interactions —
    // carries the 30s budget (the sidebar-panels precedent); at the 10s
    // default this lands marginal under suite load.
    test.setTimeout(30_000);
    // A repo-cwd window gains the code affordances once the SSE window payload
    // carries gitRoot (availability = gitRoot derived — since 260811-a2bo the
    // port resolves by convention and no longer gates; never reachability).
    const repo = await makeWindow(page, `cs-repo-${Date.now()}`);
    await gotoWindow(page, repo);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeToggle(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // The ViewSwitcher is retired (260812-0c6o): the palette is the lens-switch
    // surface, and the chevron menu carries no `View:` rows.
    const paletteInput = await openPalette(page);
    await paletteInput.fill("View: Code");
    await expect(page.getByRole("option", { name: "View: Code" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(
      page
        .getByRole("menu", { name: "More controls" })
        .getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A NON-repo cwd (/tmp) derives no gitRoot → neither affordance renders.
    const offRepo = await makeWindow(page, `cs-tmp-${Date.now()}`, {
      cwd: "/tmp",
    });
    await gotoWindow(page, offRepo);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeToggle(page)).toHaveCount(0);
    const paletteInput2 = await openPalette(page);
    await paletteInput2.fill("View: Code");
    await expect(page.getByRole("option", { name: "View: Code" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  /**
   * Proves: the retired `?panel=code` deep link translates inbound (a bare
   * panel value maps against the tty default slot A → `split-h:tty,code`,
   * written to `@rk_win_layout` once, params dropped from the URL), and the
   * tile's renderer iframes the fully derived RELATIVE `/code/` URL (never an
   * absolute origin; the port never appears) with the sandbox set (incl.
   * `allow-downloads`); the terminal stays mounted beside the tile (the
   * layout is additive).
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?panel=code`.
   * 2. Assert the `surface-tile-code` tile and the `Code editor` iframe are
   *    visible, the option reads `split-h:tty,code`, the URL is bare, the
   *    iframe `src` attribute is exactly
   *    `/code/?folder=<url-encoded git root>`, and its sandbox contains
   *    `allow-downloads`.
   * 3. Assert the terminal is still visible.
   */
  test("?panel=code opens the code tile (inbound translation); the iframe src is the stable /code/?folder=<git root>", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-panel-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");

    // The retired ?panel= param translates inbound (bare panel value →
    // split-h:tty,code, one option write). The code TILE renders its iframe
    // (stub reachable) at the fully DERIVED relative src on the STABLE /code/
    // route (260811-a2bo) — never an absolute origin, and the port never
    // appears (it's a server-side implementation detail).
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expectWindowLayout(id, "split-h:tty,code");
    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(iframe).toHaveAttribute(
      "src",
      `/code/?folder=${encodeURIComponent(GIT_ROOT)}`,
    );
    // The sandbox carries the k3vp prerequisite set incl. allow-downloads.
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-downloads");
    // The terminal stays mounted beside the code tile (the layout is additive).
    await expect(terminal(page)).toBeVisible();
  });

  /**
   * Proves: the relative-base rule on the stable route — code-server resolves
   * `./x` against the trailing slash, so the backend 308-redirects the bare
   * `/code` to `/code/` with the query preserved.
   *
   * Steps:
   * 1. `GET /code?folder=/repo` through the dev proxy with `maxRedirects: 0`.
   * 2. Assert status 308 and `Location: /code/?folder=/repo`.
   */
  test("/code 308-redirects to /code/ (query preserved) before proxying", async ({
    page,
  }) => {
    // The relative-base rule (code-server resolves "./x" against the trailing
    // slash) enforced by the backend route — asserted through the Vite dev
    // proxy (maxRedirects: 0 so the redirect itself is observed).
    const res = await page.request.get("/code?folder=/repo", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/code/?folder=/repo");
  });

  /**
   * Proves: hide-never-unmount generalized to tiles — with two surfaces
   * available, opening web then code renders BOTH iframes simultaneously (tiles
   * are additive), and closing the web tile keeps its iframe subtree mounted
   * (display-level hide); the re-opened web iframe is the identical element
   * (in-memory state preserved).
   *
   * Steps:
   * 1. Create a repo-cwd window and stamp the slot-1 web tab (both surfaces
   *    available); navigate; assert both top-bar toggles.
   * 2. Open web; assert the `Proxied content` iframe is visible. Click the code
   *    top-bar toggle; assert the code iframe is visible AND the web iframe
   *    still is.
   * 3. Close web via its lit toggle; assert the web iframe is hidden but still
   *    in the DOM (count 1). Capture its element handle, reopen web, and assert
   *    the visible iframe is the same element.
   */
  test("tiles coexist and a closed tile hides but never unmounts its iframe (P3 across surfaces)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-p3-${Date.now()}`);
    // Stamp the slot-1 web tab so BOTH surfaces are available on this repo-cwd
    // window.
    stampWebTab(id, DEAD.url);
    await gotoWindow(page, id);
    await expect(webToggle(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeToggle(page)).toBeVisible();

    // Open web, then code — tiles are ADDITIVE now (R10 growth): both
    // iframes render simultaneously (main-left:tty,web,code).
    await webToggle(page).click();
    const webIframe = page.getByTitle("Proxied content");
    await expect(webIframe).toBeVisible({ timeout: 10_000 });
    await codeToggle(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(webIframe).toBeVisible();

    // Close web via its lit toggle: hidden but STILL MOUNTED — the same
    // element returns when the tile reopens.
    await webToggle(page).click();
    await expect(webIframe).toBeHidden();
    await expect(webIframe).toHaveCount(1);
    const handleBefore = await webIframe.elementHandle();
    await webToggle(page).click();
    await expect(webIframe).toBeVisible({ timeout: 10_000 });
    const handleAfter = await webIframe.elementHandle();
    expect(
      await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter]),
    ).toBe(true);
  });

});

test.describe("Code lens & CODE surface (phase 2) — stub down", () => {
  // No stub here: nothing listens on the code-server port (the previous
  // describe's afterAll closed its stub), so the TTL-cached probe flips to
  // unreachable.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: reachability governs CONTENT, not availability — with the stub
   * down, the top-bar toggle still renders (capability signals are stable) but
   * the code tile shows the terse portless `code-server not running — check rk
   * doctor` empty state instead of a dead iframe.
   *
   * Steps:
   * 1. (Stub is closed — this describe never binds the port.)
   * 2. Create a repo-cwd window; navigate with `?panel=code`; assert the `Code
   *    tile` top-bar toggle is visible.
   * 3. Assert the `code-surface-empty` state reads `code-server not running —
   *    check rk doctor` (30s budget — the backend's ~5s probe TTL must expire
   *    first) and no `Code editor` iframe exists.
   */
  test("the surface renders the not-running empty state when the port is unreachable", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-down-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");

    // Availability still holds (gitRoot derived — the port is conventional) —
    // the top-bar toggle renders; only the CONTENT is the empty state. Generous
    // timeout: the backend's ~5s probe TTL must expire before the flip lands.
    await expect(codeToggle(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(notRunning(page)).toHaveText(
      "code-server not running — check rk doctor",
      {
        timeout: 30_000,
      },
    );
    await expect(codeIframe(page)).toHaveCount(0);
  });
});
