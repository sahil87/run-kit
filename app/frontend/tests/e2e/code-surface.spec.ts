import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
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
 * the view registry (`?view=code` → `single:code` via the inbound one-shot
 * translation + the palette's `View: Code` action — the switcher menu rows
 * are retired) AND the tileable code surface (`Code tile` top-bar toggle —
 * the right rail is REMOVED, its toggles moved into the top bar's
 * `surface-toggles` group; `?panel=code` → `split-h:tty,code` via the same
 * translation), with availability =
 * gitRoot derived (the port resolves by convention — `RK_CODE_SERVER_PORT`
 * preset, else `RK_PORT+2` — and no longer gates), and code-server
 * reachability governing only the surface CONTENT (live iframe vs the
 * not-running empty state). The iframe src is the STABLE
 * `/code/?folder=<git root>` route — the port never appears in a URL. Also
 * covers the `/code` → `/code/` redirect and the keyboard-capture spike: a
 * run-kit registry chord pressed inside the same-origin iframe is reclaimed by
 * the parent.
 *
 * Shared setup:
 * - `beforeEach`: `stubProxyPorts(page, 8080)` (`_web-tile.ts`) route-stubs
 *   `/proxy/8080/**` with a static 200 page — the dead-port error state hides
 *   the iframe when nothing listens on the stamped `http://localhost:8080/`
 *   URL, and these tests assert tile chrome, never frame content. Each
 *   describe's `beforeEach` also sets a wide desktop viewport (1440×800) — the
 *   top-bar surface-toggle group is desktop terminal-route only.
 * - tmux server: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`); never
 *   run Playwright directly — `just test-e2e code-surface`.
 * - code-server stub: code-server is not installable in the test env, so the
 *   first describe binds a stub HTTP server (node `http`) on
 *   `RK_CODE_SERVER_PORT` (default 3939 — the same env the test-e2e script
 *   seeds the backend with) serving a minimal page with a focusable `#inner`
 *   button; the second describe runs with the stub DOWN. The backend's
 *   reachability probe is TTL-cached (~5s), so down-state assertions use a 30s
 *   budget. The port is validated against the backend's own 1-65535 range
 *   before the stub binds, so an out-of-range env value fails with a named
 *   error instead of surfacing as unrelated missing-affordance assertions. The
 *   backend resolves the same port server-side (the preset wins) and forwards
 *   `/code/*` to it.
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

/** The code-server port the e2e backend is configured with (scripts/test-e2e.sh
 *  seeds RK_CODE_SERVER_PORT for both the backend and this playwright run; the
 *  default mirrors the script's). code-server itself is NOT installable here —
 *  the spec binds a STUB HTTP server on this port to drive the reachable /
 *  not-running states (intake k3vp §6). Since 260811-a2bo the iframe src is the
 *  STABLE /code/ route — the backend resolves this port server-side and the
 *  spec asserts the port never appears in the URL.
 *
 *  An out-of-range value is rejected here rather than at `srv.listen()`: the
 *  backend's validPort silently leaves the preset unset (convention fallback),
 *  so a bad value would surface as unrelated missing-content failures. */
function resolveCodePort(): number {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return 3939; // unset — same as the backend
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e code-surface\`, which seeds a valid port.`,
    );
  }
  return port;
}

const CODE_PORT = resolveCodePort();

// The git root every in-repo window derives (windows inherit the tmux server's
// start cwd — the repo root). FindGitRoot walks to the toplevel, so the
// expected `?folder=` value is the worktree root.
const GIT_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();

/** The stub "code-server": a minimal same-origin page with a focusable button
 *  (the keyboard-spike test clicks into it). Reached via the stable /code/
 *  route — the backend forwards it to this port. */
function startStub(): Promise<http.Server> {
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><body><button id="inner">stub editor</button></body></html>',
    );
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(CODE_PORT, "127.0.0.1", () => resolve(srv));
  });
}

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
// listens on 8080 — these tests assert tile chrome, never frame content, so
// the proxy path is route-stubbed live (see _web-tile.ts).
test.beforeEach(async ({ page }) => {
  await stubProxyPorts(page, 8080);
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
  let stub: http.Server;

  test.beforeAll(async () => {
    stub = await startStub();
  });

  test.afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
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
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
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
    await page.keyboard.press("Meta+k");
    const paletteInput2 = page.getByPlaceholder("Type a command");
    await expect(paletteInput2).toBeVisible({ timeout: 5_000 });
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
   * Proves: `code` is a full view-registry lens — the inbound translation
   * maps `?view=code` to `single:code` (one option write, params dropped),
   * the code tile fills the center, and the top-bar toggle group stays put
   * (tiles are additive).
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?view=code`.
   * 2. Assert the `Code editor` iframe is visible, the option reads
   *    `single:code`, the URL is bare, and the group still renders (the
   *    `Terminal tile` toggle is visible in the banner).
   */
  test("?view=code renders the code lens as the single slot-A tile", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-view-${Date.now()}`);
    await gotoWindow(page, id, "?view=code");
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // The inbound translation maps ?view=code → single:code (one write) and
    // drops the param.
    await expectWindowLayout(id, "single:code");
    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");
    // The top-bar toggle group is still there (tiles are additive — it never
    // leaves): the Terminal toggle renders (unlit) beside the lit Code toggle.
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Terminal tile" }),
    ).toBeVisible();
  });

  /**
   * Proves: the resolve/degrade fall-throughs — `?view=code&panel=code` shims
   * to `split-h:code,code`, which the grammar rejects (a repeated non-tty
   * kind), and `code` is unavailable on a `/tmp` window anyway (no gitRoot);
   * both paths land on `single:tty`, never a broken iframe.
   *
   * Steps:
   * 1. Create a `/tmp`-cwd window; navigate with `?view=code&panel=code`.
   * 2. Assert the terminal is visible, neither the code iframe nor the code
   *    tile exists in the DOM, the option stays UNSET (the grammar-rejected
   *    carried value is never written), and the URL is bare.
   */
  test("unavailable params fall through: ?view=code&panel=code resolves to plain tty on a /tmp window", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-fallthrough-${Date.now()}`, {
      cwd: "/tmp",
    });
    // The inbound shim maps this to split-h:code,code — a repeated non-tty
    // kind, which the grammar rejects — and code is unavailable here anyway
    // (no gitRoot); the invalid carried value is never written, the fallback
    // single:tty renders, never a broken iframe.
    await gotoWindow(page, id, "?view=code&panel=code");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeIframe(page)).toHaveCount(0);
    await expect(codeTile(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");
    expect(windowOption(id, "@rk_win_layout")).toBe("");
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
    stampWebTab(id, "http://localhost:8080/");
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

  /**
   * Proves: a capture-phase `keydown` listener on the same-origin iframe's
   * `contentDocument` intercepts a run-kit registry chord (⌘K/Ctrl+K) before
   * the embedded app sees it and re-dispatches it to the parent, so the command
   * palette opens despite iframe focus.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?panel=code`; assert the code
   *    iframe is visible (stub up).
   * 2. Click the stub page's `#inner` button INSIDE the frame (focus is now in
   *    the iframe).
   * 3. Press `Control+K`; assert the `Command palette` dialog opens.
   */
  test("keyboard spike: a registry chord pressed INSIDE the iframe reaches the parent (chord reclaim)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `cs-chord-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });

    // Focus INSIDE the same-origin stub frame, then press the palette chord —
    // without the capture-phase reclaim listener, the iframe would swallow it.
    await page
      .frameLocator('iframe[title="Code editor"]')
      .locator("#inner")
      .click();
    await page.keyboard.press("Control+K");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Code lens & CODE surface (phase 2) — stub down", () => {
  // No stub here: nothing listens on CODE_PORT (the previous describe's
  // afterAll closed it), so the TTL-cached probe flips to unreachable.
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
