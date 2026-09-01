import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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

// Surface-layout core e2e (spec docs/specs/surface-layout.md + ui-state.md §
// Layout in tmux). The (shape, order) half of a window's layout is SHARED tab
// state — the `@rk_win_layout` tmux window option: tile verbs + the top-bar
// surface-toggle group POST it through /options, and every assertion here
// reads tmux (`windowOption`), never the URL or localStorage. The retired
// `?layout=`/`?view=`/`?panel=` params are inbound-only (one release of
// route-entry translation into the option); history entries are bare routes.
// Per-viewer state stays local: divider ratios (`rk-layout-ratios:*`,
// persisted across reload) and zoom (`rk-layout-zoom:*`, the surface KIND —
// desktop zoom AND the mobile single-tile choice). Also covered: the mobile
// slot-A + top-bar switch-group branch, the focused-tile accent border, the
// tty-scoped split-chord gate, the tty pane segment (Split H · Split V ·
// Close Pane — any arity, zoom-visible, tty-only) + the terminal bar's split
// demotion (menuOnly; the chevron menu keeps the three rows), the gap-seam
// chrome (rest grip dots, hover/drag sash pill, main-* intersection zone),
// and the two-viewer convergence/isolation contract (a toggle in one browser
// context repaints a second; zoom stays per-viewer).
//
// Perf budget (binding): the plaintext e2e origin is HTTP/1.1 with a 6-slot
// connection pool — only ONE test mounts 3 tiles (the verbs test); every
// other flow stays at ≤2 tiles.
//
// Shared setup: `beforeAll` creates one dedicated session
// `e2e-surflayout-<ts>` (80×24) so this file never collides with other specs
// (`fullyParallel` off), then warms the dev server with a throwaway
// terminal-route page load (Vite's cold transform of the app + xterm graph
// would otherwise eat the first test's budget); `afterAll` kills the session
// (best-effort). `beforeEach` stubs `/proxy/8080/**` with a static 200 page
// (stubProxyPorts from _web-tile.ts — the dead-port error state hides the
// iframe when nothing listens on the stamped URL, and these tests assert
// tile chrome, never frame content) and sets a wide desktop viewport
// (1440×800) — multi-tile is desktop-only; the mobile test overrides to
// 375×812 with `hasTouch`. `makeWindow(name, {url?})` creates a window via
// tmux and stamps the slot-1 web tab (`stampWebTab` — `@rk_win_web_1` +
// `@rk_win_web_active 1`); windows inherit the tmux server's repo-root cwd,
// so every window is code-capable. `paneCount(id)` reads the live tmux pane
// count (the split-chord gate's ground truth, not a DOM read).
// `expectWindowLayout` is a retrying read of the window's `@rk_win_layout`
// option (the POST + option tick land asynchronously); `expectBareUrl`
// asserts the route carries no search params. Focus clicks target the tile
// header at {x: 6, y: 15} — the focus seam is pointerdown-capture anywhere
// in the tile, and the 30px header's padding is never a verb button.

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-surflayout-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/layout/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and (optionally) stamp its slot-1 web tab via tmux
 *  (`stampWebTab` — `@rk_win_web_1` + `@rk_win_web_active 1`). Windows
 *  inherit the tmux server's repo-root cwd, so every window here is
 *  code-capable (gitRoot derived). Returns the @N id. */
async function makeWindow(page: Page, name: string, opts: { url?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    stampWebTab(id, opts.url);
  }
  return id;
}

/** The window's live tmux pane count (the split-chord gate's ground truth). */
function paneCount(windowId: string): number {
  return Number(
    execFileSync("tmux", ["-L", TMUX_SERVER, "display-message", "-t", windowId, "-p", "#{window_panes}"])
      .toString()
      .trim(),
  );
}

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the SSE connection. Desktop-only gate (the `Connected` dot lives in
 *  the full-width bottom STATUS BAR since the composed-frame unification — the
 *  desktop sidebar renders no footer; the mobile test gates on the terminal
 *  instead). Unscoped query: the status-bar dot is now the ONLY `Connected`
 *  element on a desktop route. */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

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

// The surface toggles live in the top bar's `surface-toggles` group (the right
// rail is REMOVED — composed-frame unification). Locate by ACCESSIBLE NAME
// scoped to the banner: the top bar always renders an aria-hidden off-screen
// measurement probe duplicating every in-bar control, so testid / `:visible`
// queries are ambiguous (two copies) — getByRole excludes the probe.
const surfaceToggle = (page: Page, label: "Terminal" | "Web" | "Code") =>
  page.getByRole("banner").getByRole("button", { name: `${label} tile` });
const tile = (page: Page, kind: "tty" | "web" | "code", occ = 1) =>
  page.getByTestId(`surface-tile-${kind}${occ > 1 ? `-${occ}` : ""}`);
const divider = (page: Page, index = 0) => page.getByTestId(`surface-divider-${index}`);
const terminal = (page: Page) => page.locator(".xterm").first();
const webIframe = (page: Page) => page.getByTitle("Proxied content");

// The dead-port error state (260819-v6y4 R8) hides the iframe when nothing
// listens on 8080 — these tests assert tile chrome, never frame content, so
// the proxy path is route-stubbed live (see _web-tile.ts).
test.beforeEach(async ({ page }) => {
  await stubProxyPorts(page, 8080);
});

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  // Cold-boot warm-up (the code-surface precedent): when this file runs
  // standalone, the first test would otherwise pay Vite's cold transform of
  // the app + xterm graph INSIDE its budget. A throwaway terminal-route load
  // in beforeAll (outside the per-test budget) absorbs it.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Surface layout — ladder, verbs, history, ratios, mobile", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: one-shot inbound translation — a legacy `?view=code&panel=web`
   * deep link on a window whose `@rk_win_layout` is UNSET lands the mapped
   * `split-h:code,web` (view in slot A) in tmux with exactly one option
   * write, the URL is replaced with the bare route (legacy params gone), and
   * both tiles render (code iframe + proxied web iframe), never a broken
   * tile.
   *
   * Steps:
   * 1. Create a web-capable window (stamped web tab; repo cwd ⇒ code-capable).
   * 2. Navigate with `?view=code&panel=web`.
   * 3. Assert `@rk_win_layout` reads `split-h:code,web` and the URL is bare.
   * 4. Assert the `surface-tile-code` and `surface-tile-web` tiles are
   *    visible and the `Proxied content` iframe renders.
   */
  test("legacy ?view=code&panel=web deep link translates into @rk_win_layout once and drops the params", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-shim-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "?view=code&panel=web");

    // The route-entry translation maps the retired params to
    // split-h:code,web (view in slot A) and POSTs the option; the URL is
    // replaced with the bare route.
    await expectWindowLayout(id, "split-h:code,web");
    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");
    // Both tiles render: the code tile (a repo-cwd window is code-capable) and
    // the web tile with its proxied iframe.
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible();
    await expect(webIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
  });

  /**
   * Proves: the shared layout WINS over a carried param — on a window whose
   * `@rk_win_layout` is already set, a `?view=web` deep link writes nothing
   * (the option keeps its value), the URL is still cleaned to the bare
   * route, and the set layout renders (the code tile, not the web one the
   * param asked for).
   *
   * Steps:
   * 1. Create a web-capable window and stamp `@rk_win_layout single:code`.
   * 2. Navigate with `?view=web`.
   * 3. Assert the option still reads `single:code` and the URL is bare.
   * 4. Assert the code tile is visible and no web tile exists.
   */
  test("a set @rk_win_layout beats a carried ?view= param: no write, params dropped, shared layout renders", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-setwins-${Date.now()}`, { url: IFRAME_URL });
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_win_layout", "single:code"]);
    await gotoWindow(page, id, "?view=web");

    // No write — the option keeps its value; the param only gets dropped.
    // (A beat so a would-be write could land before asserting the value.)
    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");
    expect(windowOption(id, "@rk_win_layout")).toBe("single:code");
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(0);
  });

  /**
   * Proves: the top-bar `surface-toggles` group's open-tile toggles grow the
   * layout (1→2 `split-h`, 2→3 `main-left`) and every tile verb mutates
   * (shape, order) exactly as specified, each outcome POSTed to the shared
   * `@rk_win_layout` option. Also the main-left intersection zone: a mid-seam hover
   * lights only that sash, the junction hover lights BOTH, and a diagonal
   * drag moves BOTH ratios (persisted on release, URL untouched, terminal
   * still the same mounted element). This is the file's ONE bounded 3-tile
   * test (the origin's 6-slot connection-pool budget).
   *
   * Steps:
   * 1. Create a web-capable window; navigate; assert the terminal.
   * 2. Click the `Web tile` top-bar toggle; assert the option reads
   *    `split-h:tty,web`, the web tile visible, and the button lit
   *    (`aria-pressed`).
   * 3. Click the `Code tile` top-bar toggle; assert the option reads
   *    `main-left:tty,web,code` and the code tile visible.
   * 4. Intersection: assert the `surface-divider-intersection` zone is
   *    visible; hover divider 0 mid-seam (`y: 100`, far from the junction)
   *    and assert only its `.rk-sash` lights (opacity 1, after the ~150ms
   *    delay) while divider 1's stays 0; hover the junction and assert BOTH
   *    sashes light.
   * 5. Intersection drag: capture both dividers' `aria-valuenow` and the
   *    xterm element; mouse down on the junction, move diagonally
   *    (+80/−60px), up; assert BOTH `aria-valuenow`s changed, the terminal
   *    is the SAME element, the localStorage `rk-layout-ratios:…:main-left`
   *    entry holds both new ratios (neither the equal-split default), and
   *    the option still reads `main-left:tty,web,code` (a drag mutates
   *    ratios only).
   * 6. Hover the code tile, click `Promote Code`; assert the option reads
   *    `main-left:code,tty,web` (slot A permuted, shape unchanged).
   * 7. Hover the tty tile, click `Swap Terminal`; assert the option reads
   *    `main-left:code,web,tty` (swapped with the next neighbor).
   * 8. Hover the web tile, click `Close Web`; assert the option reads
   *    `split-h:code,tty`, the web tile hidden, the code tile and
   *    terminal still visible, and the web top-bar toggle unlit.
   */
  test("build a 3-tile layout via the top-bar surface toggles; promote/swap/close verbs mutate (shape, order) in the URL (A-017)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // The ONE bounded 3-tile test in this file (h1 6-slot pool discipline).
    const id = await makeWindow(page, `sl-verbs-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // The top-bar surface toggles grow the layout: 1→2 split-h, 2→3 main-left (R10).
    const webToggle = surfaceToggle(page, "Web");
    const codeToggle = surfaceToggle(page, "Code");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });

    await webToggle.click();
    await expectWindowLayout(id, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(webToggle).toHaveAttribute("aria-pressed", "true");

    await codeToggle.click();
    await expectWindowLayout(id, "main-left:tty,web,code");
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(codeToggle).toHaveAttribute("aria-pressed", "true");

    // — Gap-seam intersection (260814-011r R3), folded into THIS 3-tile mount
    // (the h1 6-slot pool budget allows only one): main-left renders the
    // two-axis T-junction zone above both dividers; a mid-seam hover lights
    // only that seam, the junction hover lights BOTH sashes, and a diagonal
    // drag moves BOTH ratios, persisted on release.
    const junction = page.getByTestId("surface-divider-intersection");
    await expect(junction).toBeVisible();
    const sash0 = divider(page, 0).locator(".rk-sash");
    const sash1 = divider(page, 1).locator(".rk-sash");
    // Mid-seam hover (y=100 is far above the junction) lights only that seam —
    // after the ~150ms anti-flicker delay.
    await divider(page, 0).hover({ position: { x: 7, y: 100 } });
    await expect(sash0).toHaveCSS("opacity", "1", { timeout: 2_000 });
    await expect(sash1).toHaveCSS("opacity", "0");
    // The junction hover lights BOTH sashes (the zone sits above the dividers
    // and wins the hit-test at the crossing).
    await junction.hover();
    await expect(sash0).toHaveCSS("opacity", "1", { timeout: 2_000 });
    await expect(sash1).toHaveCSS("opacity", "1", { timeout: 2_000 });
    // Diagonal drag from the junction: x → ratio 0, y → ratio 1, each clamped
    // independently. Exact values are viewport-dependent — assert BOTH moved
    // off the equal-split defaults and BOTH persisted on release.
    const ratio0Before = await divider(page, 0).getAttribute("aria-valuenow");
    const ratio1Before = await divider(page, 1).getAttribute("aria-valuenow");
    const xtermBefore = await terminal(page).elementHandle();
    const jBox = await junction.boundingBox();
    expect(jBox).not.toBeNull();
    const jcx = jBox!.x + jBox!.width / 2;
    const jcy = jBox!.y + jBox!.height / 2;
    await page.mouse.move(jcx, jcy);
    await page.mouse.down();
    await page.mouse.move(jcx + 40, jcy - 30, { steps: 3 });
    await page.mouse.move(jcx + 80, jcy - 60, { steps: 3 });
    await page.mouse.up();
    await expect
      .poll(async () => divider(page, 0).getAttribute("aria-valuenow"))
      .not.toBe(ratio0Before);
    await expect
      .poll(async () => divider(page, 1).getAttribute("aria-valuenow"))
      .not.toBe(ratio1Before);
    // The terminal stayed MOUNTED (same xterm element) through the drag.
    const xtermAfter = await terminal(page).elementHandle();
    expect(await page.evaluate(([x, y]) => x === y, [xtermBefore, xtermAfter])).toBe(true);
    // Both ratios persisted per (window, shape) on release — neither is the
    // equal-split default anymore.
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      `rk-layout-ratios:${TMUX_SERVER}:${id}:main-left`,
    );
    const persisted = JSON.parse(stored ?? "null") as number[];
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).not.toBeCloseTo(100 / 3, 1);
    expect(persisted[1]).not.toBeCloseTo(200 / 3, 1);
    // The shared option is untouched by the drag — ratios are per-viewer.
    expect(windowOption(id, "@rk_win_layout")).toBe("main-left:tty,web,code");
    expectBareUrl(page);

    // ◧ Promote on the code tile: slot A becomes code, the rest permute
    // unchanged (shape untouched) — hover first (the verbs are visible at
    // rest since 260812-wfic; the hover still exercises the hover affordance).
    await tile(page, "code").hover();
    await tile(page, "code").getByRole("button", { name: "Promote Code" }).click();
    await expectWindowLayout(id, "main-left:code,tty,web");

    // ⇄ Swap on the tty tile: exchanges with the NEXT neighbor (web).
    await tile(page, "tty").hover();
    await tile(page, "tty").getByRole("button", { name: "Swap Terminal" }).click();
    await expectWindowLayout(id, "main-left:code,web,tty");

    // ✕ Close on the web tile: the layout collapses 3→2 (split-h), order kept.
    // exact — the strip's per-tab "Close web tab N" button substring-matches
    // "Close Web" now that the strip renders from one tab.
    await tile(page, "web").hover();
    await tile(page, "web").getByRole("button", { name: "Close Web", exact: true }).click();
    await expectWindowLayout(id, "split-h:code,tty");
    await expect(tile(page, "web")).toBeHidden();
    await expect(tile(page, "code")).toBeVisible();
    await expect(terminal(page)).toBeVisible();
    // The top-bar toggle reflects the close (web unlit again).
    await expect(webToggle).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Proves: the two verb families — the tty tile's bordered pane segment
   * (content verbs: Split pane horizontally / Split pane vertically / Close
   * pane, the last carrying the boxed ⊠ `close-pane-boxed` glyph) renders
   * at arity 1 (`single:tty`, where zero LAYOUT verbs render), stays
   * tty-only at arity 2 (the web tile's header has none), and remains
   * visible while the tile is zoomed (◧/⇄ hide; ✕/⛶ stay) — while the
   * terminal-mode top bar carries NO in-bar split chip (the `split`
   * registry entry is `menuOnly`) and the chevron menu always carries the
   * Split horizontal / Split vertical / Close pane rows. Stays within the
   * ≤2-tile perf budget.
   *
   * Steps:
   * 1. Create a web-capable window; navigate (default `single:tty`); assert
   *    the terminal.
   * 2. Assert the tty tile's `pane-segment` testid is visible with the
   *    three content-verb buttons; assert the Close pane button carries the
   *    `close-pane-boxed` glyph and NO `Expand Terminal` layout verb
   *    renders.
   * 3. Assert the top bar (banner) has NO `Split horizontally` button; open
   *    the `More controls` chevron menu and assert the Split horizontal /
   *    Split vertical / Close pane rows are visible; Escape-close it.
   * 4. Open the web tile via the top-bar toggle; assert the option reads
   *    `split-h:tty,web`, the segment still visible on the tty
   *    tile, and NO `pane-segment` on the web tile.
   * 5. Click the tty tile's `Expand Terminal` verb; assert the segment
   *    stays visible while `Promote Terminal` is gone and `Close Terminal`
   *    stays.
   */
  test("the tty header carries the pane segment at any arity (visible while zoomed); the terminal bar dropped its split chip (260813-w1lf)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-paneverbs-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const bar = page.getByRole("banner");

    // Arity 1 (single:tty — a header that renders zero LAYOUT verbs): the
    // bordered pane segment is right there with its three content verbs.
    const segment = tile(page, "tty").getByTestId("pane-segment");
    await expect(segment).toBeVisible();
    await expect(segment.getByRole("button", { name: "Split pane horizontally" })).toBeVisible();
    await expect(segment.getByRole("button", { name: "Split pane vertically" })).toBeVisible();
    const closePane = segment.getByRole("button", { name: "Close pane" });
    await expect(closePane).toBeVisible();
    // The boxed ⊠ glyph — the misclick-trap distinction from the tile-close ✕.
    await expect(closePane.locator('[data-icon="close-pane-boxed"]')).toBeVisible();
    await expect(tile(page, "tty").getByRole("button", { name: "Expand Terminal" })).toHaveCount(0);

    // The terminal-mode bar carries NO in-bar split chip (menuOnly, 260813-w1lf);
    // the chevron menu keeps the Split horizontal / Split vertical / Close pane
    // rows (mobile path + muscle-memory fallback).
    await expect(bar.getByRole("button", { name: "Split horizontally" })).toHaveCount(0);
    await bar.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu.getByRole("menuitem", { name: "Split horizontal" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Split vertical" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Close pane" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // Arity 2 (split-h:tty,web — within the ≤2-tile perf budget): the segment
    // stays tty-only — the web tile's header carries layout verbs, no segment.
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expectWindowLayout(id, "split-h:tty,web");
    await expect(segment).toBeVisible();
    await expect(tile(page, "web").getByTestId("pane-segment")).toHaveCount(0);

    // Zoomed: the pane segment remains visible (pane ops stay valid on a
    // zoomed tile) while the ◧/⇄ layout verbs hide (✕/⛶ stay, as today).
    await page.getByRole("button", { name: "Expand Terminal", exact: true }).click();
    await expect(tile(page, "web")).toBeHidden({ timeout: 10_000 });
    await expect(segment).toBeVisible();
    await expect(
      tile(page, "tty").getByRole("button", { name: "Promote Terminal" }),
    ).toHaveCount(0);
    await expect(
      tile(page, "tty").getByRole("button", { name: "Close Terminal" }),
    ).toBeVisible();
  });

  /**
   * Proves: a top-bar toggle POSTs the shared `@rk_win_layout` option, and a
   * FULL load of the bare route re-renders the same tile set — persistence
   * comes from tmux, not the browser; the URL stays bare throughout.
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    top-bar toggle.
   * 2. Assert the option reads `split-h:tty,web`, the web tile visible, and
   *    the URL bare.
   * 3. `page.goto` the BARE window route (a real reload, no search string).
   * 4. Assert the web tile and terminal render again and the URL is still
   *    bare.
   */
  test("a user-built layout persists in tmux across a bare-route reload", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-persist-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);

    // A user mutation (top-bar toggle) POSTs the shared option.
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expectWindowLayout(id, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    expectBareUrl(page);

    // Re-arrive via a FULL load of the BARE route — the option supplies the
    // layout (no localStorage, no URL state).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible();
    expectBareUrl(page);
  });

  /**
   * Proves: internal navigation (sidebar) targets the bare route, so each
   * window renders its own `@rk_win_layout`: B (never customized) renders
   * `single:tty` (the fallback), while A renders its option's
   * `split-h:tty,web`. The A→B hop is a REAL client-side navigation
   * (sidebar row click), not a `page.goto`, and the URL stays bare
   * throughout.
   *
   * Steps:
   * 1. Create window A (web-capable) and window B (plain).
   * 2. On A, open the web tile via the top-bar toggle; assert the option
   *    reads `split-h:tty,web`.
   * 3. Click B's row in the `Sessions` sidebar; assert selection settles on
   *    B (`aria-current="page"`), no web tile exists, and the URL is bare.
   * 4. Click A's row; assert the web tile renders again and the URL stays
   *    bare.
   */
  test("window switch A→B→A renders each window's own shared layout", async ({ page }) => {
    test.setTimeout(40_000);
    const a = await makeWindow(page, `sl-switch-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `sl-switch-b-${Date.now()}`);

    // On A, build split-h:tty,web (a user mutation → @rk_win_layout write).
    await gotoWindow(page, a);
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expectWindowLayout(a, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click) —
    // internal nav targets the BARE route; B renders its own (unset) layout:
    // the single:tty fallback.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar.locator(`[data-window-id="${b}"]`).getByRole("button").first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(0);
    expectBareUrl(page);

    // Back to A via the sidebar (bare route again) — A's option renders
    // again.
    const rowA = sidebar.locator(`[data-window-id="${a}"]`).getByRole("button").first();
    await rowA.click();
    await expect(rowA).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    expectBareUrl(page);
  });

  /**
   * Proves: every history entry is a BARE route — layout mutations never
   * touch the URL (the shared option changed), and window switches push, so
   * back/forward re-render each window's CURRENT shared layout (A's
   * `split-h:tty,web` — a mutation mid-session is shared state, not a URL
   * snapshot), and backing past the window lands on the pre-window route
   * with no stale entry in between.
   *
   * Steps:
   * 1. Create windows A (web-capable) and B (plain).
   * 2. Navigate to the server route (history entry E0), then to A (E1).
   * 3. Open the web tile on A via the top-bar toggle; assert the option
   *    reads `split-h:tty,web` and the URL stays bare.
   * 4. Sidebar-click B (push E2); assert B renders `single:tty` (its option
   *    is unset) and the URL stays bare.
   * 5. `goBack` → A renders `split-h:tty,web` again (its shared layout).
   * 6. `goForward` → B's fallback renders.
   * 7. `goBack` twice → the SECOND back lands on the bare server route
   *    (`/<server>`, E0) — no per-mutation entries exist to strand.
   */
  test("back/forward re-render the shared layout; layout tweaks add NO history entries", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const a = await makeWindow(page, `sl-hist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `sl-hist-b-${Date.now()}`);

    // History: [E0 server route] → [E1 window A] → (top-bar toggle: an option
    // POST, E1 untouched — the URL never carries layout state) → [E2 window B
    // via sidebar push].
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await gotoWindow(page, a);
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expectWindowLayout(a, "split-h:tty,web");
    expectBareUrl(page);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar.locator(`[data-window-id="${b}"]`).getByRole("button").first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    expectBareUrl(page);

    // Back → A's shared layout renders again.
    await page.goBack();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    expectBareUrl(page);

    // Forward → B's fallback (single:tty) renders.
    await page.goForward();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(0);
    expectBareUrl(page);

    // Back twice more: past A, straight to the E0 server route — a mutation
    // never adds a history entry.
    await page.goBack();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe(`/${TMUX_SERVER}`);
  });

  /**
   * Proves: divider drags mutate RATIOS only — clamped, persisted per
   * (window, shape) on release, and never encoded in the URL; tiles stay
   * mounted and live mid-drag (no suspension/unmount). Also the gap-seam
   * sash states: rest shows 3 grip dots and no fill, hover lights the sash
   * pill after the ~150ms delay, and the sash stays lit through the drag.
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    top-bar toggle.
   * 2. Assert the `surface-divider-0` separator reads `aria-valuenow=50`
   *    (equal split) and capture the xterm element handle.
   * 3. Sash states: assert the divider carries 3 `.rk-grips i` dots and its
   *    `.rk-sash` is at opacity 0; hover the divider and assert the sash
   *    reaches opacity 1 (retrying — the ~150ms anti-flicker delay plus
   *    fade).
   * 4. Drag the divider 150px right (mouse down/move/up in steps), asserting
   *    the sash is still lit mid-drag.
   * 5. Assert `aria-valuenow` grew past 50, the terminal is the SAME element
   *    (still mounted, still visible), and the shared option is unchanged.
   * 6. Re-arrive via a full load of the bare route; assert the web tile
   *    renders and the divider reads exactly the dragged value (ratio
   *    persisted per window+shape).
   */
  test("a divider drag persists the ratio across reload and never touches the URL (R5)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-ratio-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // The split-h divider starts at the equal split (50).
    const div = divider(page, 0);
    await expect(div).toHaveAttribute("aria-valuenow", "50");
    const box = await div.boundingBox();
    expect(box).not.toBeNull();

    // Gap-seam sash states (260814-011r R2): at rest the seam shows 3 grip
    // dots and NO sash fill; hover lights the rounded pill after the ~150ms
    // anti-flicker delay.
    await expect(div.locator(".rk-grips i")).toHaveCount(3);
    const sash = div.locator(".rk-sash");
    await expect(sash).toHaveCSS("opacity", "0");
    await div.hover();
    await expect(sash).toHaveCSS("opacity", "1", { timeout: 2_000 });

    // Drag 150px RIGHT — ratio 0 (the slot-A share) grows. Tiles stay live
    // mid-drag (no suspension/unmount — the board pane-resize bug class). The
    // sash stays lit for the whole drag (immediate, zero delay).
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    const xtermBefore = await terminal(page).elementHandle();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 75, startY, { steps: 3 });
    await expect(sash).toHaveCSS("opacity", "1");
    await page.mouse.move(startX + 150, startY, { steps: 3 });
    await page.mouse.up();

    let dragged: number | null = null;
    await expect
      .poll(async () => {
        dragged = Number(await div.getAttribute("aria-valuenow"));
        return dragged;
      })
      .toBeGreaterThan(50);
    // The terminal stayed MOUNTED (same xterm element) through the drag.
    const xtermAfter = await terminal(page).elementHandle();
    expect(await page.evaluate(([x, y]) => x === y, [xtermBefore, xtermAfter])).toBe(true);
    // Ratios are per-viewer local state — the shared option is untouched by
    // a drag, and the URL never carries layout state.
    expect(windowOption(id, "@rk_win_layout")).toBe("split-h:tty,web");
    expectBareUrl(page);

    // The ratio persists per (window, shape): a bare reload resolves the same
    // layout AND the dragged divider position.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(divider(page, 0)).toHaveAttribute("aria-valuenow", String(dragged), {
      timeout: 10_000,
    });
  });

  /**
   * Proves: the `layout-zoom` default binding is REMOVED (Ctrl+` collides
   * with code-server's own toggle-terminal chord), so the chord falls
   * through untouched even with xterm focused; the zoom action itself
   * survives via the tile's ⛶ verb (the same seam as the palette's
   * `Layout: Expand`/`Restore`) and stays PER-VIEWER (the zoomed KIND under
   * `rk-layout-zoom:{server}:{@N}` — the shared option and the URL are
   * untouched).
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    top-bar toggle; assert the option reads `split-h:tty,web`.
   * 2. Click the terminal (xterm focus), then press `Control+``; after a
   *    500ms grace beat assert BOTH tiles and the divider are still visible
   *    (no zoom).
   * 3. Click the tty tile's `Expand Terminal` verb; assert the web tile
   *    hides at display level (still mounted — count 1), the divider is
   *    gone, the terminal stays visible, the option and URL are untouched,
   *    and the zoom key holds `tty`.
   * 4. Click the now-`Restore Terminal` verb; assert the web tile and the
   *    divider return and the zoom key is cleared.
   */
  test("Ctrl+` is inert (binding removed, 260813-j3jb); the ⛶ verb toggles the slot-A zoom", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-zoom-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expectWindowLayout(id, "split-h:tty,web");

    // The Ctrl+` layout-zoom binding is REMOVED (it collides with code-server's
    // own Ctrl+`): the chord must fall through untouched — no zoom, both tiles
    // stay. Focus the terminal first, the spot the old chord interception won.
    await terminal(page).click();
    await page.keyboard.press("Control+`");
    await page.waitForTimeout(500);
    await expect(tile(page, "web")).toBeVisible();
    await expect(divider(page, 0)).toBeVisible();

    // Zoom still works through the tile's ⛶ verb: slot A (tty) goes
    // full-center — the web tile hides (display-level, still mounted) and the
    // divider leaves.
    await page.getByRole("button", { name: "Expand Terminal", exact: true }).click();
    await expect(tile(page, "web")).toBeHidden({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(1);
    await expect(divider(page, 0)).toHaveCount(0);
    await expect(terminal(page)).toBeVisible();
    // Zoom is per-viewer (spec ui-state.md): the shared option and the URL
    // are untouched; the zoomed KIND lands in the viewer's zoom key.
    expect(windowOption(id, "@rk_win_layout")).toBe("split-h:tty,web");
    expectBareUrl(page);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        `rk-layout-zoom:${TMUX_SERVER}:${id}`,
      ),
    ).toBe("tty");

    // Restore via the same verb (now labeled Restore) — both tiles and the
    // divider return, and the zoom key clears.
    await page.getByRole("button", { name: "Restore Terminal", exact: true }).click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(divider(page, 0)).toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        `rk-layout-zoom:${TMUX_SERVER}:${id}`,
      ),
    ).toBeNull();
  });

  // The ▦ Surfaces chip lives in the bottom bar, which 260814-ldbs
  // pointer-gated to COARSE pointers — a real phone is coarse AND narrow, so
  // this mobile test runs with `hasTouch` (a viewport-only emulation would get
  // no chip bar by design).
  test.describe("mobile (375px, coarse pointer)", () => {
    test.use({ hasTouch: true });

    /**
     * Proves: below `isMobileViewport()` the layout manager renders only
     * the active tile — no grid, no dividers — and the remaining resolved
     * surfaces are reachable via the top-bar switch group (radio semantics:
     * the visible tile pressed), whose tap on an ALREADY-OPEN surface is
     * PER-VIEWER (only the zoom key changes — the shared option, and so the
     * desktop arrangement, never does). The nested describe runs
     * `test.use({ hasTouch: true })` so `(pointer: coarse)` matches — a
     * real phone is coarse AND narrow, and the bottom bar is pointer-gated,
     * so a fine-pointer narrow window would exercise a different bar by
     * design.
     *
     * Steps:
     * 1. Set the 375×812 viewport (context already has `hasTouch`); create
     *    a web-capable window.
     * 2. Navigate to `?layout=main-left:tty,code,web` (inbound translation
     *    writes the option), gating on the terminal (not the `Connected`
     *    dot — it lives in the desktop-only status bar; the sidebar is an
     *    unmounted drawer at 375px anyway).
     * 3. Assert the option reads `main-left:tty,code,web`, the tty tile is
     *    visible, the code/web tiles are mounted-hidden, no divider exists
     *    (and no `surface-divider-intersection` — the gap-seam chrome is
     *    desktop-only), the banner's `Terminal tile` / `Code tile` /
     *    `Web tile` buttons render with Terminal `aria-pressed=true`, and
     *    no `mobile-surfaces-chip` exists in the DOM.
     * 4. Click the `Code tile` button; assert the code tile becomes visible
     *    (tty hidden), the pressed state flips (Code pressed, Terminal
     *    not), the zoom key holds `code`, and the option still reads
     *    `main-left:tty,code,web` — the tap sent NO layout write.
     */
    test("375px mobile: a 3-tile layout renders slot A + the top-bar switch group; switching an open tile writes only the zoom key", async ({
      page,
    }) => {
      test.setTimeout(30_000);
      await page.setViewportSize(MOBILE_VIEWPORT);
      const id = await makeWindow(page, `sl-mobile-${Date.now()}`, { url: IFRAME_URL });
      // Do NOT gate on the `Connected` dot: it lives in the desktop-only status
      // bar now (the sidebar footer is gone; at 375px the sidebar is an
      // unmounted drawer anyway). Gate on the terminal.
      await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=main-left:tty,code,web`);
      await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
      await expectWindowLayout(id, "main-left:tty,code,web");

      // Slot A (tty) renders full-width; the other resolved surfaces stay
      // mounted-hidden (no multi-tile grid, no dividers below the threshold).
      await expect(tile(page, "tty")).toBeVisible();
      await expect(tile(page, "code")).toBeHidden();
      await expect(tile(page, "web")).toBeHidden();
      await expect(divider(page, 0)).toHaveCount(0);
      // Gap-seam chrome is desktop-only (260814-011r R5): no intersection zone.
      await expect(page.getByTestId("surface-divider-intersection")).toHaveCount(0);
      // The top-bar switch group renders with RADIO semantics: one button per
      // shown surface, the VISIBLE one (slot A) pressed. The retired ▦
      // Surfaces chip is gone.
      const banner = page.getByRole("banner");
      const ttyToggle = banner.getByRole("button", { name: "Terminal tile", exact: true });
      const codeToggle = banner.getByRole("button", { name: "Code tile", exact: true });
      const webToggle = banner.getByRole("button", { name: "Web tile", exact: true });
      // READY_TIMEOUT: on a cold deep link the multi-surface layout (and so the
      // group) resolves only once the window payload lands with webTabs/gitRoot.
      await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
      await expect(ttyToggle).toHaveAttribute("aria-pressed", "true");
      await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("mobile-surfaces-chip")).toHaveCount(0);

      // Tapping the Code button swaps the mobile single tile — PER-VIEWER:
      // the shared option (and so every desktop viewer's arrangement) is
      // untouched; only this viewer's zoom key changes.
      await codeToggle.click();
      await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
      await expect(tile(page, "tty")).toBeHidden();
      await expect(codeToggle).toHaveAttribute("aria-pressed", "true");
      await expect(ttyToggle).toHaveAttribute("aria-pressed", "false");
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          `rk-layout-zoom:${TMUX_SERVER}:${id}`,
        ),
      ).toBe("code");
      expect(windowOption(id, "@rk_win_layout")).toBe("main-left:tty,code,web");
      expectBareUrl(page);
    });
  });

  /**
   * Proves: in the resting desktop state (fine pointer, compose strip
   * closed — the bottombar row is empty) the sidebar card and the content
   * column share one bottom edge, exactly 6px (the stage padding) above the
   * status bar. Guards the row-gap regression class: grid gaps charge
   * between tracks even at zero track height, so a stage row-gap would sink
   * the content column 6px below the row-spanning sidebar; the seam is
   * footer-owned and content-gated (`:has(>*)`) instead.
   *
   * Steps:
   * 1. Create a fresh window; navigate to its terminal route; wait for the
   *    Connected gate and the terminal tile.
   * 2. Measure bounding boxes of the sidebar `<aside>`, the `status-bar`
   *    testid, and the tty tile.
   * 3. Assert sidebar bottom == tile bottom (±1px) and status-bar top −
   *    sidebar bottom == 6px (±1px).
   */
  test("stage bottom-edge parity: sidebar card and content column both end 6px above the status bar", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    // Resting desktop state (fine pointer, compose strip closed): the
    // bottombar row is empty, so the content column's bottom edge must land
    // flush with the row-spanning sidebar card's — both exactly 6px (the
    // stage padding) above the status bar. A stage row-gap would charge the
    // content column an extra 6px even at zero row height (grid gaps apply
    // between tracks regardless of track size), which is the regression this
    // guards against.
    const id = await makeWindow(page, `sl-parity-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    const sidebar = await page.locator("aside[aria-label='Sidebar']").boundingBox();
    const statusBar = await page.getByTestId("status-bar").boundingBox();
    const ttyTile = await tile(page, "tty").boundingBox();
    expect(sidebar).not.toBeNull();
    expect(statusBar).not.toBeNull();
    expect(ttyTile).not.toBeNull();

    const sidebarBottom = sidebar!.y + sidebar!.height;
    const tileBottom = ttyTile!.y + ttyTile!.height;
    expect(Math.abs(sidebarBottom - tileBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBar!.y - sidebarBottom - 6)).toBeLessThanOrEqual(1);
  });

  /**
   * Proves: the focused-tile state — the framed tile border turns
   * `border-accent-green` on the tile that last received pointer
   * interaction (the tmux active-pane metaphor), defaults to slot A, and
   * moves with each click. Unfocused tiles carry the dimmed gap-seam
   * `rk-card-border`.
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    top-bar toggle.
   * 2. Assert the tty tile (slot A) carries `border-accent-green` and the
   *    web tile the dimmed `rk-card-border`.
   * 3. Click the web tile's header (`{x: 6, y: 15}`); assert the accent
   *    border moved to the web tile and left the tty tile.
   * 4. Click the tty tile's header; assert the border returned.
   */
  test("the focused-tile accent border follows clicks across tiles (260812-wfic R2, A-013)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-focus-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = surfaceToggle(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // Default focus = slot A (tty): its framed border reads accent-green, the
    // web tile's stays the dimmed gap-seam card border (rk-card-border,
    // 260814-011r R1).
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "web")).toHaveClass(/rk-card-border/);

    // Click the web tile (its header — the focus seam is pointerdown-capture
    // anywhere in the tile) → the accent border moves.
    await tile(page, "web").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "web")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "tty")).not.toHaveClass(/border-accent-green/);

    // Click back into the tty tile → the border returns.
    await tile(page, "tty").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "web")).not.toHaveClass(/border-accent-green/);
  });

  /**
   * Proves: the `ttyOnly` dispatcher gate — a `ttyOnly` binding's handler
   * is absent unless the tty tile owns focus, so the split chord (⇧Ctrl+\
   * on this Linux host) falls through untouched (no `preventDefault`, no
   * split POST) while the code tile is focused, and splits exactly as
   * before while the tty tile is focused. Ground truth is the live tmux
   * pane count, not the DOM.
   *
   * Steps:
   * 1. Create a plain (code-capable) window; navigate; assert the terminal.
   * 2. Open the code tile via the top-bar toggle; assert the tile renders.
   *    Pane count = 1.
   * 3. Click the code tile's header; assert its `border-accent-green` (the
   *    gate's input is visibly engaged).
   * 4. Press `Shift+Control+Backslash`; wait a beat; assert the pane count
   *    is UNCHANGED (the chord fell through — code-server would own it on a
   *    real reachable code-server).
   * 5. Click the tty tile's header; assert its `border-accent-green`.
   * 6. Press `Shift+Control+Backslash` again; assert the pane count grows
   *    to 2 (retrying — the split POST + tmux mutation land asynchronously).
   */
  test("the split chord is tty-scoped: inert with the code tile focused, splits with tty focused (260812-wfic R8, A-014)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-ttyonly-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Open the code tile (every window here is code-capable — repo-root cwd).
    const codeToggle = surfaceToggle(page, "Code");
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await codeToggle.click();
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });

    const before = paneCount(id);
    expect(before).toBe(1);

    // Focus the CODE tile (header click) — the accent border confirms the
    // gate's input. The split chord (⇧Ctrl+\ on this Linux host) must fall
    // through untouched: NO split, pane count unchanged.
    await tile(page, "code").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "code")).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Shift+Control+Backslash");
    // Give a would-be split a beat to land — then assert nothing happened.
    await page.waitForTimeout(750);
    expect(paneCount(id)).toBe(before);

    // Focus the tty tile — the SAME chord splits exactly as today (the
    // tty-focused path is byte-equivalent to the pre-gate behavior).
    await tile(page, "tty").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Shift+Control+Backslash");
    await expect
      .poll(() => paneCount(id), { timeout: 10_000 })
      .toBe(before + 1);
  });

  /**
   * Proves: the layout is SHARED tab state — a tile toggle in one browser
   * context repaints a SECOND, already-mounted context with no interaction
   * on it (the options handler wakes the SSE hub, so the tick lands within
   * the poll bound).
   *
   * Steps:
   * 1. Create a web-capable window; open it in context A (the default page)
   *    and in a second browser context B; assert both render `single:tty`.
   * 2. In A, click the `Web tile` toggle; assert the option reads
   *    `split-h:tty,web` and A's web tile appears.
   * 3. Assert B's web tile appears with NO interaction on B; close B.
   */
  test("two viewers of one window converge: a toggle in context A repaints context B", async ({
    page,
    browser,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-shared-${Date.now()}`, { url: IFRAME_URL });
    const ctxB = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const pageB = await ctxB.newPage();
    await stubProxyPorts(pageB, 8080);
    try {
      await gotoWindow(page, id);
      await gotoWindow(pageB, id);
      await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
      await expect(terminal(pageB)).toBeVisible({ timeout: 10_000 });
      await expect(tile(pageB, "web")).toHaveCount(0);

      // A toggles the web tile on; B never touches anything.
      const webToggle = surfaceToggle(page, "Web");
      await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
      await webToggle.click();
      await expectWindowLayout(id, "split-h:tty,web");
      await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

      // B repaints on the option tick — no interaction, no reload.
      await expect(tile(pageB, "web")).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctxB.close();
    }
  });

  /**
   * Proves: zoom is PER-VIEWER — zooming the tty tile in context A writes
   * only A's `rk-layout-zoom:` key; context B keeps both tiles unzoomed,
   * and B has no zoom key of its own.
   *
   * Steps:
   * 1. Create a web-capable window with `split-h:tty,web` stamped via tmux;
   *    open it in context A and in a second context B; assert both render
   *    both tiles.
   * 2. In A, click the tty tile's `Expand Terminal` verb; assert A's web
   *    tile hides (display-level, still mounted) and A's zoom key holds
   *    `tty`.
   * 3. Assert B's web tile stays VISIBLE (unzoomed) and B's zoom key is
   *    absent; the shared option is unchanged.
   */
  test("zoom in context A does not zoom context B (per-viewer zoom key)", async ({
    page,
    browser,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-zoomiso-${Date.now()}`, { url: IFRAME_URL });
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_win_layout", "split-h:tty,web"]);
    const ctxB = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const pageB = await ctxB.newPage();
    await stubProxyPorts(pageB, 8080);
    try {
      await gotoWindow(page, id);
      await gotoWindow(pageB, id);
      await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
      await expect(tile(pageB, "web")).toBeVisible({ timeout: 10_000 });

      // A zooms the tty tile (the ⛶ verb) — a per-viewer posture.
      await page.getByRole("button", { name: "Expand Terminal", exact: true }).click();
      await expect(tile(page, "web")).toBeHidden({ timeout: 10_000 });
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          `rk-layout-zoom:${TMUX_SERVER}:${id}`,
        ),
      ).toBe("tty");

      // B is untouched: both tiles stay visible and B holds no zoom key.
      // (A settle beat so a would-be repaint could land first.)
      await pageB.waitForTimeout(500);
      await expect(tile(pageB, "web")).toBeVisible();
      expect(
        await pageB.evaluate(
          (key) => localStorage.getItem(key),
          `rk-layout-zoom:${TMUX_SERVER}:${id}`,
        ),
      ).toBeNull();
      expect(windowOption(id, "@rk_win_layout")).toBe("split-h:tty,web");
    } finally {
      await ctxB.close();
    }
  });
});
