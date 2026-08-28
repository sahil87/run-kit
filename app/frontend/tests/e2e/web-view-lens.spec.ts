/**
 * Web view lens e2e: the iframe feature is a per-viewer lens over the window —
 * view choice is client-side (URL param + localStorage), the tty is always
 * reachable, and switching lenses NEVER mutates `@rk_win_lens` (no
 * window-option POST). The web lens is always tileable (availability does not
 * derive from `@rk_win_url`): an empty/whitespace `@rk_win_url` selects the
 * tile's onboarding content state (reduced live URL bar + the three fill-path
 * instructions) in place of the iframe, and the rkUrl sync seam flips
 * onboarding ↔ live with no user action. The lens IS a single-tile surface
 * layout: `?view=X` deep links resolve through the translation shim
 * (`single:X`), the palette's `View: …` actions set `single:<view>` through
 * the shared mutation path, and the URL mirror rewrites everything to
 * `?layout=` — so URL assertions key off the decoded `layout` param, never
 * `view`.
 *
 * Shared setup: `beforeEach` route-stubs `/proxy/8080/**` with a static 200
 * page (`stubProxyPorts` from `_web-tile.ts`) — the dead-port error state
 * hides the iframe when nothing listens on the stamped
 * `http://localhost:8080/` URL, and these tests assert tile chrome, never
 * frame content. `beforeAll` creates a dedicated session `e2e-webview-<ts>`
 * (80×24) so this file never collides with other specs; `afterAll` kills it.
 * `beforeEach` also sets a wide desktop viewport (1440×800); the mobile test
 * overrides to 375px. `makeWindow(name, {url?, iframeType?, cwd?})` creates a
 * window via `tmux new-window` and stamps `@rk_win_url` / `@rk_win_lens`
 * directly with `tmux set-option -w`; `cwd: "/tmp"` makes the window NON-repo
 * (no gitRoot → code unavailable), the deterministic single-view case. The
 * stamped options surface as `rkUrl`/`rkType` in the SSE snapshot, so no live
 * HTTP server behind the iframe is needed. `gotoWindow(id, view?)` navigates
 * to `/<server>/<@N>[?view=…]` and waits for the status bar's `Connected`
 * dot. `expectLayoutParam` is a retrying read of the DECODED `?layout=`
 * search param (the router may percent-encode `:`/`,`); the `replaceState`
 * mirror lands a beat after the arrival/switch. Palette helpers:
 * `openPalette(query)` presses `Meta+k` and fills the search input;
 * `switchLens(label)` runs the palette's `View: {label}` option and waits for
 * the palette to close.
 */
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";
import { stubProxyPorts } from "./_web-tile";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webview-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// The ViewSwitcher is RETIRED (260812-0c6o): on desktop the palette's
// `View: …` actions are the ONLY lens-switch surface (plus the top-bar
// open-tile toggles for non-hidden surfaces); on MOBILE the `View:` entries
// are superseded by the top-bar switch group and its `Tile: Switch to
// <Surface>` palette twin — the chevron menu carries no `View:` rows and the
// `view-toggle` testid exists nowhere. Lens switching in this suite therefore
// routes through the palette (or `?view=` deep links where the lens itself is
// under test). The generous 1440px desktop width remains a valid
// "everything fits" width.
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/heading/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and (optionally) stamp @rk_win_url / @rk_win_lens directly via tmux —
 *  the same window-option seam the backend tmux test uses. `cwd: "/tmp"` makes
 *  the window NON-repo (no gitRoot → code unavailable) — the deterministic
 *  single-view (tty-only) case; a repo-cwd window is code-capable since k3vp,
 *  so "plain" assertions must not rely on the gitRoot probe's timing.
 *  Returns the @N id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { url?: string; iframeType?: boolean; cwd?: string } = {},
): Promise<string> {
  newWindow(TEST_SESSION, name, { cwd: opts.cwd });
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execSync(
      `tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_win_url "${opts.url}"`,
      { stdio: "ignore" },
    );
  }
  if (opts.iframeType) {
    execSync(`tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_win_lens iframe`, {
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
  await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const iframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

/** Assert the mirrored `?layout=` param (decoded — the router may
 *  percent-encode `:`/`,`). The surface-layout shim (260812-ab5v) translates
 *  `?view=X` → `single:X` at route entry and REWRITES the URL via
 *  replaceState, so URL assertions key off `layout`, never `view`. Retrying:
 *  the mirror lands a beat after the arrival/switch that triggered it. */
async function expectLayoutParam(page: Page, expected: string | null): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("layout"), { timeout: 10_000 })
    .toBe(expected);
}

// The retired switcher leaves no surface in the top bar — lens switching is
// palette-only (260812-0c6o). `inBarSwitcher`/`view-toggle` must always be
// empty; the chevron menu never carries `View:` lens rows.
const controlsMenu = (page: Page) =>
  page.getByRole("menu", { name: "More controls" });
const inBarSwitcher = (page: Page) =>
  page.getByRole("group", { name: "Window view" });

/** Open the command palette, fill the query, and return the input. */
async function openPalette(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill(query);
  return paletteInput;
}

/** Switch the lens via the palette's `View: {label}` action. */
async function switchLens(page: Page, label: "Terminal" | "Web"): Promise<void> {
  await openPalette(page, `View: ${label}`);
  const option = page.getByRole("option", { name: `View: ${label}` });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
}

// The dead-port error state (260819-v6y4 R8) hides the iframe when nothing
// listens on 8080 — these tests assert tile chrome, never frame content, so
// the proxy path is route-stubbed live (see _web-tile.ts).
test.beforeEach(async ({ page }) => {
  await stubProxyPorts(page, 8080);
});

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Web view lens — iframe as a per-viewer lens", () => {
  // Default every test in this describe to a wide desktop width — the
  // distinguishing menu-only case (260722-n2n4): the bar has room, yet the
  // switcher lives only in the chevron menu. The mobile test overrides this to
  // 375px at its own start.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: web availability is unconditional (the palette's `View: Web`
   * action renders even on a window with NO `@rk_win_url`; it opens the
   * onboarding tile) — and the retired-switcher contract: there is no in-bar
   * pill, no `view-toggle` testid anywhere in the DOM (bar or probe), and no
   * `View:` rows in the chevron menu. The plain window uses a NON-repo cwd
   * (`/tmp`) so `code` is unavailable too — a repo-cwd window is
   * code-capable, and relying on the gitRoot probe's timing would be a race.
   *
   * Steps:
   * 1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to it;
   *    assert the terminal.
   * 2. Open the palette with `View: Web`; assert the `View: Web` option IS
   *    visible (web is always offered); Escape.
   * 3. Create a window WITH `@rk_win_url`; navigate to it.
   * 4. Assert no in-bar "Window view" group and no `view-toggle` testid; open
   *    the palette and assert the `View: Web` option is visible; Escape.
   * 5. Open the "More controls" menu; assert it carries NO `View:` rows;
   *    Escape.
   */
  test("lens switching is palette-only — web is always offered, the menu carries no `View:` rows (260812-0c6o, 260821-zqlq)", async ({ page }) => {
    // A plain window (no @rk_win_url, NON-repo cwd so code is unavailable) offers
    // tty + web: web availability is unconditional (260821-zqlq), so the
    // palette's `View: Web` action renders even before the window has a URL
    // (it opens the onboarding tile — the discovery path the gating used to
    // block).
    const plain = await makeWindow(page, `wv-plain-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A window with @rk_win_url offers tty + web → the palette's `View: Web` action
    // renders — and there is STILL no in-bar pill and no `view-toggle` testid
    // anywhere; the chevron menu carries no `View:` lens rows (the retired
    // switcher's removal).
    const web = await makeWindow(page, `wv-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(
      controlsMenu(page).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  /**
   * Proves: view state is client-side — a flip changes the layout (`View:
   * Web` ⇒ `single:web` via the shim) and rendered lens but issues no
   * `@rk_win_lens` mutation and does not destroy the window.
   *
   * Steps:
   * 1. Create a window with `@rk_win_url`; register a `page.on("request")`
   *    recorder for any `POST /api/windows/…/options`.
   * 2. Navigate (default view = tty for an untyped window); assert the
   *    terminal.
   * 3. `switchLens("Web")` — run the palette's `View: Web` action; assert
   *    the iframe renders and the mirrored URL carries `?layout=single:web`.
   * 4. `switchLens("Terminal")`; assert the terminal renders and the URL
   *    mirrors a clean URL — the default `single:tty` mirrors with the param
   *    dropped.
   * 5. Re-resolve the window by name; assert the id is unchanged AND zero
   *    `/options` POSTs were recorded across both flips.
   */
  test("flipping web↔tty preserves the window and never POSTs an option mutation", async ({
    page,
  }) => {
    const name = `wv-flip-${Date.now()}`;
    const id = await makeWindow(page, name, { url: IFRAME_URL });

    // Record any window-option mutation (the retired @rk_win_lens flip). A view
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

    // Flip to web via the palette's `View: Web` action → iframe renders; R12's
    // shim turns the selection into `single:web` and the URL mirrors `?layout=`.
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");

    // Flip back to tty via `View: Terminal` → terminal renders as `single:tty`.
    await switchLens(page, "Terminal");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // The window still exists in the snapshot (never destroyed) and its id is
    // unchanged — a view switch mutates neither identity nor options.
    const stillId = await resolveWindow(page, name);
    expect(stillId).toBe(id);
    expect(
      optionPosts,
      `no /options POST on a view switch; got ${optionPosts.join(", ")}`,
    ).toHaveLength(0);
  });

  /**
   * Proves: a `?view=web` URL is a first-class deep link — the shim maps it
   * to `single:web` and the `replaceState` mirror rewrites the URL.
   *
   * Steps:
   * 1. Create a window with `@rk_win_url`.
   * 2. Navigate to `…?view=web`.
   * 3. Assert the iframe renders, the mirrored URL reads
   *    `?layout=single:web`, and the center heading shows the static `Tab:`
   *    prefix (the heading does not follow the lens).
   */
  test("deep link ?view=web cold-loads the iframe", async ({ page }) => {
    const id = await makeWindow(page, `wv-deep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "web");
    // Cold load resolves straight to the web lens (the shim maps ?view=web →
    // single:web and the URL mirror rewrites it).
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");
    // The center heading is a STATIC `Window:` in every lens (260714-uco1 — the
    // heading no longer follows the lens). The prefix run is contiguous
    // (260813-kvk7 removed the hierarchy ▾ that used to split it), so assert
    // the whole `Window:` run.
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
  });

  /**
   * Proves: web is always tileable — the deep link keeps its tile instead of
   * degrading to tty, and with no `@rk_win_url` the tile renders the
   * ONBOARDING content state in place of the iframe (the
   * availability-vs-content split; the window uses a NON-repo cwd so `code`
   * stays out of the layout).
   *
   * Steps:
   * 1. Create a plain window (no `@rk_win_url`, `/tmp` cwd).
   * 2. Navigate to `…?view=web`.
   * 3. Assert the `web-tile-onboarding` panel renders, there is no iframe
   *    and no terminal tile, and the URL mirrors `?layout=single:web` (the
   *    deep link keeps its tile).
   * 4. Open the palette with `View: Terminal`; assert the option is visible
   *    (web is current, so the palette offers the way back); Escape.
   */
  test("?view=web on a window with no @rk_win_url resolves to the onboarding web tile (260821-zqlq)", async ({
    page,
  }) => {
    // Web is always tileable, so the deep link keeps its tile instead of
    // degrading to tty; with no @rk_win_url the tile renders the ONBOARDING
    // content state in place of the iframe.
    const id = await makeWindow(page, `wv-nourl-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id, "web");
    await expect(page.getByTestId("web-tile-onboarding")).toBeVisible({ timeout: 10_000 });
    await expect(iframe(page)).toHaveCount(0);
    await expect(terminal(page)).toHaveCount(0);
    await expectLayoutParam(page, "single:web");
    // The palette still offers the way back (web is current).
    await openPalette(page, "View: Terminal");
    await expect(page.getByRole("option", { name: "View: Terminal" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  /**
   * Proves: the web-toggle chord is availability-driven, so it mounts on every
   * desktop window route — on a URL-less window ⇧Ctrl+3 (the non-mac default;
   * mac is ⌘3) opens the web tile beside the terminal, and the tile renders
   * onboarding with the REDUCED URL bar (refresh + the fully-live address
   * input; back/forward, find ⌕, and ↗ hidden until content exists).
   *
   * Steps:
   * 1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate; assert
   *    the terminal.
   * 2. Press `Shift+Control+Digit3`.
   * 3. Assert `web-tile-onboarding` renders with the "Nothing to show yet"
   *    heading and the `rk present ./report.html` instruction row; no iframe.
   * 4. Assert the address input is visible with the
   *    `localhost:3000 · /present/… · https://…` placeholder, Refresh
   *    renders, and Back/Forward/Find in page/Open in browser render nowhere.
   * 5. Assert the URL mirrors `?layout=split-h:tty,web` (the chord added the
   *    tile — 1→2 growth).
   */
  test("⌘3 on a URL-less window opens the web tile's onboarding state (260821-zqlq)", async ({
    page,
  }) => {
    // The web-toggle chord is availability-driven, so it now mounts on every
    // desktop window route — on a URL-less window it opens the web tile, and
    // the tile renders onboarding with the REDUCED URL bar (refresh + the
    // live address input only: no back/forward, no find ⌕, no ↗).
    const id = await makeWindow(page, `wv-onboard-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // ⇧Ctrl+3 (the non-mac web-toggle default; mac is ⌘3).
    await page.keyboard.press("Shift+Control+Digit3");
    const onboarding = page.getByTestId("web-tile-onboarding");
    await expect(onboarding).toBeVisible({ timeout: 10_000 });
    await expect(onboarding).toContainText("Nothing to show yet");
    await expect(onboarding).toContainText("rk present ./report.html");
    await expect(iframe(page)).toHaveCount(0);
    // Tile-scoped: the top bar carries its own "Refresh page" button.
    const webTile = page.getByTestId("surface-tile-web");
    const address = webTile.getByLabel("URL");
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute(
      "placeholder",
      "localhost:3000 · /present/… · https://…",
    );
    await expect(webTile.getByLabel("Refresh")).toBeVisible();
    await expect(webTile.getByLabel("Back")).toHaveCount(0);
    await expect(webTile.getByLabel("Forward")).toHaveCount(0);
    await expect(webTile.getByLabel("Find in page")).toHaveCount(0);
    await expect(webTile.getByLabel("Open in browser")).toHaveCount(0);
    // The chord ADDED the web tile beside the terminal (1→2 split-h).
    await expectLayoutParam(page, "split-h:tty,web");
  });

  /**
   * Proves: the onboarding address input is fully live — Enter runs the
   * existing submit pipeline (`normalizeAddressInput` → `isAllowedUrl` →
   * `updateWindowUrl` → `POST /options` on `@rk_win_url`), SSE delivers the
   * new value, and the tile flips onboarding → live iframe with no further
   * action.
   *
   * Steps:
   * 1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to
   *    `…?view=web`; assert `web-tile-onboarding`.
   * 2. Fill the `URL` input with `localhost:8080`; press Enter.
   * 3. Assert the iframe renders (the stubbed `/proxy/8080/` page), the
   *    onboarding panel is gone, and the URL still mirrors
   *    `?layout=single:web`.
   */
  test("the onboarding address bar boots the tile for real (Enter → @rk_win_url POST)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wv-boot-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id, "web");
    const onboarding = page.getByTestId("web-tile-onboarding");
    await expect(onboarding).toBeVisible({ timeout: 10_000 });
    // Typing a bare loopback address and pressing Enter runs the existing
    // pipeline: normalize → /proxy/8080/ → POST /options (@rk_win_url) — SSE
    // delivers the new value and the tile flips live with no further action.
    const address = page.getByTestId("surface-tile-web").getByLabel("URL");
    await address.fill("localhost:8080");
    await address.press("Enter");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(onboarding).toHaveCount(0);
    await expectLayoutParam(page, "single:web");
  });

  /**
   * Proves: the live flip rides the existing rkUrl sync seam — an agent-side
   * `rk present` (here: an external `tmux set-option -w @rk_win_url`)
   * transitions the open tile onboarding → iframe in place, and clearing the
   * option returns it to onboarding.
   *
   * Steps:
   * 1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to
   *    `…?view=web`; assert `web-tile-onboarding`.
   * 2. `tmux set-option -w -t <id> @rk_win_url "http://localhost:8080/"`;
   *    assert the iframe renders and onboarding is gone.
   * 3. `tmux set-option -w -u -t <id> @rk_win_url`; assert onboarding returns
   *    and the iframe is gone.
   */
  test("tmux set-option @rk_win_url flips the open onboarding tile live; unsetting returns to onboarding", async ({
    page,
  }) => {
    // The live flip rides the existing rkUrl sync seam — an agent-side
    // `rk present` (or any external set-option) transitions the tile
    // onboarding → iframe in place, and clearing the option returns it.
    const id = await makeWindow(page, `wv-setopt-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id, "web");
    const onboarding = page.getByTestId("web-tile-onboarding");
    await expect(onboarding).toBeVisible({ timeout: 10_000 });
    execSync(`tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_win_url "${IFRAME_URL}"`, {
      stdio: "ignore",
    });
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(onboarding).toHaveCount(0);
    execSync(`tmux -L ${TMUX_SERVER} set-option -w -u -t ${id} @rk_win_url`, { stdio: "ignore" });
    await expect(onboarding).toBeVisible({ timeout: 10_000 });
    await expect(iframe(page)).toHaveCount(0);
  });

  /**
   * Proves: `@rk_win_lens=iframe` is demoted to a default-view HINT (ladder
   * rung 3) — no data migration, existing iframe windows keep opening in web
   * (`single:web`) with the tty one palette action away.
   *
   * Steps:
   * 1. Create a window with `@rk_win_url` AND `@rk_win_lens=iframe`.
   * 2. Navigate with no `?view` param and no localStorage.
   * 3. Assert the iframe renders with a CLEAN URL — `single:web` is this
   *    window's default (the hint), and the default mirrors with the param
   *    dropped, matching the retired `@rk_win_lens` bare-URL behavior.
   * 4. Open the palette with `View: Terminal`; assert the option is visible
   *    (web is current, so the palette offers the way back); Escape.
   */
  test("legacy @rk_win_lens=iframe window defaults to web (ladder hint rung)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wv-legacy-${Date.now()}`, {
      url: IFRAME_URL,
      iframeType: true,
    });
    // No ?view param, no localStorage → the iframe-typed default hint wins →
    // single:web (ladder rung 3 in the layout model). It is this window's
    // DEFAULT, so the mirror leaves the URL clean (param dropped) — exactly
    // the retired @rk_win_lens behavior (bare URL rendered the iframe).
    await gotoWindow(page, id);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null);
    // The palette is the way back: `View: Terminal` is offered (web is current).
    await openPalette(page, "View: Terminal");
    await expect(page.getByRole("option", { name: "View: Terminal" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  /**
   * Proves: per-window value-bearing localStorage persistence (the
   * `rk-layout:{server}:{@N}` key in the layout model) — switching windows
   * drops the layout param (internal nav targets the bare route) but the
   * last-chosen layout sticks. The A→B switch is a REAL client-side
   * navigation (sidebar row click), so the param-drop is exercised through
   * the router seam (`navigateToWindow`), not a `page.goto` — guarding
   * against a future `retainSearchParams`/router-upgrade regression that
   * would silently carry A's layout onto B.
   *
   * Steps:
   * 1. Create window A (with `@rk_win_url`) and window B (plain).
   * 2. On A, `switchLens("Web")` (the palette's `View: Web` action); assert
   *    the iframe.
   * 3. Switch to B by clicking B's row button in the `Sessions` sidebar
   *    (`[data-window-id=<idB>]` → first `button`); assert selection settles
   *    on B (`aria-current="page"`), the terminal renders, and the URL
   *    mirrors a clean URL (the router dropped the outgoing param — B
   *    resolves independently).
   * 4. Navigate back to A WITHOUT a layout param; assert the iframe renders
   *    and the URL mirrors `?layout=single:web` — the persisted last-layout
   *    resolved (localStorage rung).
   */
  test("last-view persists across a window switch away and back", async ({
    page,
  }) => {
    const a = await makeWindow(page, `wv-persist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `wv-persist-b-${Date.now()}`);

    // On A, switch to web via the palette (writes the rk-layout localStorage
    // key + mirrors ?layout=single:web — R12's shim: a view selection is a
    // single-tile layout mutation).
    await gotoWindow(page, a);
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click), not a
    // page.goto — this exercises the R6 search-param drop through the router
    // seam (`navigateToWindow`), guarding against a future retainSearchParams /
    // router-upgrade regression that would silently carry A's layout onto B.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar
      .locator(`[data-window-id="${b}"]`)
      .getByRole("button")
      .first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();

    // Selection settles on B — the client-side switch was accepted.
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    // B resolves independently to single:tty, and the outgoing layout param was
    // dropped by the router seam (R6) — not carried onto B.
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // Back to A WITHOUT a layout param — the persisted per-window layout
    // (single:web, localStorage rung) resolves.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(a)}`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");
  });

  /**
   * Proves: at 375px with a realistically long window name the center heading
   * keeps its room WITH the pinned switch group present (the retained
   * single-line / no-horizontal-overflow contract), the mobile palette
   * supersedes the `View:` lens entries with `Tile: Switch to <Surface>`, the
   * top-bar Web button performs the one-tap tty→web switch through the
   * PERSISTING arm (`single:web` mirrored into the URL), and no switcher
   * chrome (`view-toggle` testid, "Window view" group) exists anywhere. The
   * lens itself still resolves and renders on mobile.
   *
   * Steps:
   * 1. Set the 375×812 viewport; create a window with `@rk_win_url` and a
   *    long worktree-style name.
   * 2. Navigate to `…?view=web` and gate on the IFRAME, not the `Connected`
   *    dot — the dot lives in the desktop status bar (the sidebar footer is
   *    mobile-only), and at 375px the status bar never renders, so it never
   *    becomes visible. Assert the iframe renders.
   * 3. Assert no in-bar switcher group ("Window view") AND no `view-toggle`
   *    testid anywhere in the DOM.
   * 4. Assert the banner's `Web tile` button reads `aria-pressed=true` and
   *    `Terminal tile` reads `false` (radio semantics — the visible tile
   *    pressed).
   * 5. Open the palette with `View: Web`; assert NO `View: Web` option
   *    (mobile supersession). Refill with `Switch`; click `Tile: Switch to
   *    Terminal`; assert the terminal renders and the URL mirrors a clean
   *    URL (the default drops the param — the persisting arm, tty not
   *    previously open).
   * 6. Click the banner's `Web tile` button; assert the iframe renders and
   *    the URL mirrors `?layout=single:web` — the one-tap tty→web phone flow
   *    persists.
   * 7. Assert no horizontal page overflow (`body.scrollWidth <= 375`).
   * 8. Resize to the desktop viewport (1440×800); assert there is STILL no
   *    in-bar pill and no `view-toggle` testid; open the palette with `View:
   *    Terminal`, assert the option renders; refill with `Switch` and assert
   *    NO `Tile: Switch to …` options (desktop keeps `View:`).
   */
  test("375px mobile: the switch group + `Tile: Switch` palette entries are the lens switchers; no switcher chrome at any width", async ({
    page,
  }) => {
    // At 375px with a realistically long window name the heading keeps its
    // room WITH the switch group present (the retained single-line /
    // no-overflow contract), `View:` palette entries are superseded by
    // `Tile: Switch to <Surface>` on mobile only, and the pill never renders
    // anywhere. The lens itself still resolves + renders on mobile without
    // horizontal overflow.
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await makeWindow(page, `wv-mobile-long-worktree-name-${Date.now()}`, {
      url: IFRAME_URL,
    });
    // Do NOT gate on the `Connected` dot here: it lives in the sidebar footer
    // (260724-6j1v), and at 375px the sidebar is an unmounted drawer, so the
    // dot never becomes visible (same reason window-heading.spec.ts's mobile
    // test gates on the heading, not the dot).
    // Gate directly on the iframe — the thing under test.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?view=web`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // No in-bar pill, no probe copy — the testid exists nowhere.
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);

    // The top-bar switch group renders with the VISIBLE surface (web)
    // pressed; its palette twin lists `Tile: Switch to Terminal` and the
    // mobile palette carries NO `View:` LENS entries (superseded — other
    // `View:` entries like Fixed Width remain).
    const banner = page.getByRole("banner");
    const ttyToggle = banner.getByRole("button", { name: "Terminal tile", exact: true });
    const webToggle = banner.getByRole("button", { name: "Web tile", exact: true });
    await expect(webToggle).toHaveAttribute("aria-pressed", "true", {
      timeout: READY_TIMEOUT,
    });
    await expect(ttyToggle).toHaveAttribute("aria-pressed", "false");
    const paletteInput = await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web", exact: true })).toHaveCount(0);
    await paletteInput.fill("Switch");
    const switchToTty = page.getByRole("option", { name: "Tile: Switch to Terminal" });
    await expect(switchToTty).toBeVisible({ timeout: 10_000 });
    // Switch back to tty via the palette twin — tty is NOT open in
    // `single:web`, so the verb runs the persisting arm.
    await switchToTty.click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // The one-tap phone flow: from `single:tty` the top-bar Web button
    // switches to the available-but-not-open web surface through the
    // PERSISTING arm — `single:web` lands in the URL mirror.
    await webToggle.click();
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");

    // No horizontal page overflow at 375px (with the group present and the
    // long window name).
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Still no switcher chrome at desktop width either — and the desktop
    // palette keeps its `View:` entries with NO `Tile: Switch` ones.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    const desktopPaletteInput = await openPalette(page, "View: Terminal");
    await expect(
      page.getByRole("option", { name: "View: Terminal" }),
    ).toBeVisible({ timeout: 10_000 });
    await desktopPaletteInput.fill("Switch");
    await expect(
      page.getByRole("option", { name: /^Tile: Switch to / }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
