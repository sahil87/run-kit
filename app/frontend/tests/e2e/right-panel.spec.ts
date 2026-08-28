import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";
import { stubProxyPorts } from "./_web-tile";

// The surface-toggle e2e — formerly the right RAIL spec, retargeted to the
// surface-layout model when the rail (right-panel.tsx + the `right-panel-rail`
// testid) was deleted: its availability-gated open-tile toggles relocated
// into the top bar's right cluster as ONE bordered sub-group
// (SurfaceToggleGroup in top-bar.tsx, `data-testid="surface-toggles"`),
// terminal route only, on desktop leftmost in the cluster and the FIRST
// overflow fit candidate. On MOBILE the same entry forks to SWITCH mode:
// radio semantics (pressed = the visible tile, tap runs the switch-to-tile
// verb), pinned in-bar (never overflows, no Tiles menu rows), gated on ≥2
// shown surfaces; the bottom-bar ▦ Surfaces chip and mobile-surface-sheet it
// replaces are gone. The button grammar is the rail's, unchanged: one
// Tip-wrapped button per available surface not in SURFACE_RAIL_HIDDEN (chat
// never gets a toggle), tty first, "<Label> tile" aria names, SURFACE_GLYPH
// glyphs (`>_`/`://`/`{}`), aria-pressed = tile open (toggle mode) / tile
// visible (switch mode), a corner availability dot on every button,
// disabled-at-3 with the "Close a tile first" tip (toggle mode only). The
// rail-collapse chrome (the "Toggle panel" top-bar chip, the
// `runkit-rail-open` preference, the `Panel: Toggle rail` palette action) is
// gone — its tests are deleted with it, not migrated.
//
// LOCATOR RULE (the top-bar-overflow.spec.ts pattern): the top bar ALWAYS
// renders an aria-hidden off-screen (-left-[9999px]) measurement PROBE
// duplicating every in-bar control. Playwright treats the probe as visible, so
// testid/CSS queries (`getByTestId("surface-toggles")`, `:visible` filters)
// match BOTH copies. Locate toggle buttons by ACCESSIBLE NAME scoped to the
// banner landmark — getByRole excludes the aria-hidden probe subtree.
//
// Shared setup: runs against the isolated rk-test-e2e socket
// (E2E_TMUX_SERVER). beforeAll creates one dedicated session
// `e2e-rightpanel-<ts>` (80×24) so this file never collides with other specs
// (fullyParallel off); afterAll kills it best-effort. beforeEach route-stubs
// /proxy/8080/** (stubProxyPorts, _web-tile.ts) with a static 200 page — the
// dead-port error state hides the iframe when nothing listens on the stamped
// URL, and these tests assert tile chrome, never frame content. The
// describe's beforeEach sets a wide desktop viewport (1440×800) — the toggle
// group is desktop-only and the first overflow fit candidate, so a wide
// viewport keeps it in-bar; the mobile test overrides to 375×812.
// makeWindow(name, {url?}) creates a window via tmux new-window, then stamps
// @rk_win_url with tmux set-option -w (execFileSync argument arrays — no
// shell strings); the option surfaces as rkUrl in the SSE snapshot, so no
// live HTTP server behind the iframe is needed. Default-cwd windows inherit
// the tmux server's repo-root cwd, so they are code-capable (gitRoot
// derived). gotoWindow waits for the STATUS BAR's `Connected` dot (the
// desktop sidebar renders no footer; the footer dot is mobile-drawer-only).
// expectLayoutParam is a retrying read of the DECODED `?layout=` param
// (URL.searchParams — the router may percent-encode `:`/`,`); the
// replaceState mirror lands a beat after the mutation. Also used: the
// `surface-tile-web` / `surface-tile-code` tiles, the `Proxied content`
// iframe, and the `.xterm` terminal surface. Divider-ratio drag coverage
// lives in surface-layout.spec.ts; the overflow menu's Tiles section (when
// the group drops out of the bar) is the top-bar-overflow spec's beat.

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-rightpanel-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// The toggle group's TOGGLE mode is desktop-only; mobile registers the SWITCH
// mode (radio semantics, pinned in-bar, ≥2 shown surfaces). The suite runs at
// a wide desktop width (the group is the first overflow fit candidate there,
// so a wide viewport keeps it in-bar); the mobile test overrides to 375px.
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/layout/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and (optionally) stamp @rk_win_url via tmux (execFileSync with
 *  argument arrays — no shell string construction). Windows inherit the tmux
 *  server's repo-root cwd, so every default-cwd window here is code-capable
 *  (gitRoot derived — the surface-layout.spec.ts pattern). Returns the @N id. */
async function makeWindow(page: Page, name: string, opts: { url?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_win_url", opts.url]);
  }
  return id;
}

/** The status bar's connection dot — the desktop readiness signal. The
 *  sidebar footer's own dot is MOBILE-ONLY since 260815-19me, so the old
 *  `nav [aria-label='Connected']` gate no longer resolves on desktop. */
const statusDot = (page: Page) =>
  page.getByTestId("status-bar").locator("[aria-label='Connected']");

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the connection. Desktop-only gate (mobile gates on the terminal). */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(statusDot(page)).toBeVisible({ timeout: READY_TIMEOUT });
}

/** Assert the mirrored `?layout=` param (decoded — the router may
 *  percent-encode `:`/`,`). Retrying: the replaceState mirror lands a beat
 *  after the mutation that triggered it. */
async function expectLayoutParam(page: Page, expected: string | null): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("layout"), { timeout: 10_000 })
    .toBe(expected);
}

// Toggle buttons: accessible-name role queries scoped to the banner landmark —
// the ONLY probe-safe locator form (see the LOCATOR RULE above). Exact names:
// a substring "Terminal" would also hit the demoted "Terminal font size" menu
// row when the chevron menu is open.
const toggleButton = (page: Page, label: "Terminal" | "Web" | "Code") =>
  page.getByRole("banner").getByRole("button", { name: `${label} tile`, exact: true });
const webTile = (page: Page) => page.getByTestId("surface-tile-web");
const codeTile = (page: Page) => page.getByTestId("surface-tile-code");
const webIframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

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

test.describe("Top-bar surface toggles — open-tile toggles over the surface layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: the group renders on the desktop terminal route with `tty` always
   * available — lit for the default `single:tty` layout — `web` always
   * available with its corner dot driven by @rk_win_url (the dot means "has
   * content", not "exists"), and `code` available via the derived gitRoot (a
   * repo-cwd window). Also pins the shared glyph vocabulary (`>_`, `{}`,
   * `://`) and the per-surface dot semantics.
   *
   * Steps:
   * 1. Create a plain repo-cwd window (no @rk_win_url); navigate; assert the
   *    terminal, the lit `Terminal tile` toggle (with the `>_` glyph and one
   *    corner dot), the unlit `Web tile` toggle (with the `://` glyph and NO
   *    corner dot), and the unlit `Code tile` toggle (with the `{}` glyph).
   * 2. Create a window WITH @rk_win_url; navigate; assert the terminal and
   *    the visible (unlit) `Web tile` toggle now carrying its corner dot.
   */
  test("the toggle group renders on the desktop terminal route with the always-available tty + web toggles; the web dot follows @rk_win_url", async ({ page }) => {
    test.setTimeout(30_000);
    // A plain repo-cwd window (no @rk_win_url) gets the group with the tty toggle
    // (always available, R8) LIT for the default single:tty layout, the web
    // toggle (always available, 260821-zqlq) UNLIT with NO corner dot (the dot
    // signals "has content" — hasWebUrl), and the CODE toggle (gitRoot derived
    // from the inherited repo cwd).
    const plain = await makeWindow(page, `rp-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const ttyToggle = toggleButton(page, "Terminal");
    await expect(ttyToggle).toBeVisible();
    await expect(ttyToggle).toHaveAttribute("aria-pressed", "true");
    await expect(ttyToggle).toContainText(">_"); // SURFACE_GLYPH
    // tty's corner dot stays always-on.
    await expect(ttyToggle.locator("span.rounded-full")).toHaveCount(1);
    const plainWebToggle = toggleButton(page, "Web");
    await expect(plainWebToggle).toBeVisible();
    await expect(plainWebToggle).toHaveAttribute("aria-pressed", "false");
    await expect(plainWebToggle).toContainText("://");
    // No content → no dot.
    await expect(plainWebToggle.locator("span.rounded-full")).toHaveCount(0);
    // gitRoot rides the SSE window payload — the same readiness class the
    // shared CI-aware budget exists for.
    const codeToggle = toggleButton(page, "Code");
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codeToggle).toContainText("{}");

    // A window with @rk_win_url: the web toggle's dot lights (content present).
    const web = await makeWindow(page, `rp-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    // Not lit yet — only the tty tile is open.
    await expect(webToggle).toHaveAttribute("aria-pressed", "false");
    await expect(webToggle).toContainText("://");
    await expect(webToggle.locator("span.rounded-full")).toHaveCount(1);
  });

  /**
   * Proves: the remaining per-surface capability gate — a window offering no
   * code (cwd /tmp, no gitRoot) renders the group with the always-available
   * tty AND web toggles (the web toggle dotless until a URL lands) and no
   * `Code tile` button.
   *
   * Steps:
   * 1. Create a window with cwd /tmp and no @rk_win_url; navigate.
   * 2. Assert the terminal is visible (proving the SSE window payload landed,
   *    so the count-0 assertions are settled), the `Terminal tile` toggle
   *    renders, the `Web tile` toggle renders with NO corner dot, and no
   *    `Code tile` exists.
   */
  test("a window with no git root and no @rk_win_url shows the tty + web toggles only", async ({ page }) => {
    test.setTimeout(30_000);
    // cwd /tmp keeps the window git-root-less, so the code toggle stays out;
    // web is always available (260821-zqlq) — the group renders the tty and
    // web toggles, the latter dotless until a URL lands.
    const name = `rp-nocap-${Date.now()}`;
    newWindow(TEST_SESSION, name, { cwd: "/tmp" });
    const plain = await resolveWindow(page, name);
    await gotoWindow(page, plain);
    // The terminal mounting proves the SSE window payload landed, so the
    // count-0 assertions below are settled (not a pre-payload snapshot).
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(toggleButton(page, "Terminal")).toBeVisible();
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible();
    await expect(webToggle.locator("span.rounded-full")).toHaveCount(0);
    await expect(toggleButton(page, "Code")).toHaveCount(0);
  });

  /**
   * Proves: the toggle semantics — an unlit click APPENDS the tile (1→2
   * growth is `split-h`, the visual continuation of the legacy main+panel
   * split) with the proxied iframe rendering BESIDE the still-mounted
   * terminal; the URL mirrors the layout and the toggle lights; a lit click
   * CLOSES the tile (the layout collapses 2→1 `single:tty`).
   *
   * Steps:
   * 1. Create a web-capable window; navigate; assert the terminal and wait
   *    for the `Web tile` toggle.
   * 2. Click it; assert the web iframe is visible, the terminal is still
   *    visible, the URL carries `?layout=split-h:tty,web`, the toggle is
   *    aria-pressed, and the tile keeps its URL textbox.
   * 3. Click the toggle again; assert the web tile is hidden, the URL is
   *    clean (the default `single:tty` mirrors with the param DROPPED), the
   *    toggle is unlit, and the terminal is still visible.
   */
  test("clicking a surface toggle opens a web tile beside a live terminal; clicking again closes it", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-toggle-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });

    // Open: 1→2 growth appends a `split-h:tty,web` tile (R10) — the proxied
    // iframe renders BESIDE the terminal, which stays mounted and visible (the
    // layout is additive, like the panel was). The URL mirrors the layout and
    // the toggle lights.
    await webToggle.click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(webToggle).toHaveAttribute("aria-pressed", "true");
    // The tile-context iframe keeps its URL bar.
    await expect(webTile(page).getByRole("textbox", { name: "URL" })).toBeVisible();

    // Close via the same toggle: the web tile hides (R7 close semantics — the
    // layout collapses 2→1) and the URL goes clean (default drops the param).
    await webToggle.click();
    await expect(webTile(page)).toBeHidden();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
    await expect(webToggle).toHaveAttribute("aria-pressed", "false");
    await expect(terminal(page)).toBeVisible();
  });

  /**
   * Proves: the add/close arity walk through the top-bar group — 1→2 growth
   * is `split-h`, 2→3 growth is `main-left` (the incumbent slot-A tile stays
   * dominant), and a lit click collapses 3→2 back to `split-h` with order
   * preserved. One of the file's two 3-tile flows (with disabled-at-3); they
   * run serially in fresh browser contexts, so the h1 6-slot pool budget is
   * per-page and never contended.
   *
   * Steps:
   * 1. Create a web-capable (and repo-cwd, so code-capable) window; navigate;
   *    wait for both the `Web tile` and `Code tile` toggles.
   * 2. Click `Web tile`; assert `?layout=split-h:tty,web`, the visible web
   *    tile, and the lit toggle.
   * 3. Click `Code tile`; assert `?layout=main-left:tty,web,code`, the
   *    visible code tile, and the lit toggle.
   * 4. Click `Code tile` again; assert `?layout=split-h:tty,web`, the hidden
   *    code tile, and the unlit toggle.
   */
  test("toggles grow the layout 1→2 split-h then 2→3 main-left; a lit click closes back down (R10/R7)", async ({ page }) => {
    test.setTimeout(30_000);
    // One of the file's two 3-tile flows (with the disabled-at-3 test) — they
    // run serially in fresh browser contexts, so the h1 6-slot pool budget
    // (surface-layout.spec.ts's Performance note) is per-page and never
    // contended.
    const id = await makeWindow(page, `rp-arity-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const webToggle = toggleButton(page, "Web");
    const codeToggle = toggleButton(page, "Code");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });

    // 1→2 is split-h; 2→3 is main-left (the incumbent slot-A tile stays
    // dominant) — the rail's click semantics carried into the top bar.
    await webToggle.click();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(webTile(page)).toBeVisible({ timeout: 10_000 });
    await expect(webToggle).toHaveAttribute("aria-pressed", "true");

    await codeToggle.click();
    await expectLayoutParam(page, "main-left:tty,web,code");
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeToggle).toHaveAttribute("aria-pressed", "true");

    // A lit click closes: 3→2 collapses to split-h, order preserved (R7).
    await codeToggle.click();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(codeTile(page)).toBeHidden();
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Proves: the max-3-tiles gate (Constitution IV) — at 3 open tiles the
   * UNLIT toggles render disabled instead of no-oping silently, and the
   * disabled button still tips "Close a tile first" (the Tip wraps a span so
   * the tooltip survives the disabled control's swallowed pointer events).
   * Since chat is hidden from the group (SURFACE_RAIL_HIDDEN), the only way
   * to hold an unlit shown toggle at 3 open tiles is an open CHAT tile — the
   * window is made chat-capable by stamping the pane @rk_pane_chat option on
   * a NON-shell pane (the backend reconciler zeroes chat on plain-shell
   * panes). Closing one tile re-enables the unlit toggle.
   *
   * Steps:
   * 1. Create a window running `exec sleep 600` (a non-shell pane command);
   *    stamp @rk_win_url (window option) and @rk_pane_chat
   *    claude:e2e-disabled-at-3 (pane option, resolved via #{pane_id}).
   * 2. Navigate with `?layout=main-left:tty,web,chat`; assert the terminal
   *    and that the URL mirrors the 3-tile layout unchanged (nothing
   *    degraded).
   * 3. Assert `Terminal tile` and `Web tile` are lit while `Code tile` is
   *    unlit and disabled.
   * 4. Hover the Code toggle's PARENT SPAN; assert a role="tooltip" element
   *    reads "Close a tile first" (expect's retry absorbs the open delay);
   *    move the mouse away.
   * 5. Click the lit `Web tile` toggle; assert `?layout=split-h:tty,chat` and
   *    the Code toggle enabled again.
   */
  test("at 3 open tiles the unlit toggle is disabled and tips 'Close a tile first'", async ({ page }) => {
    test.setTimeout(30_000);
    // Disabled-at-3 needs an UNLIT shown toggle while 3 tiles are open — with
    // chat hidden from the group (SURFACE_RAIL_HIDDEN) the only way is an open
    // CHAT tile: a chat-capable window deep-linked to main-left:tty,web,chat
    // leaves the CODE toggle unlit at 3 open tiles. Chat capability: @rk_pane_chat
    // is a PANE option reconciled by the pane's liveness — a plain-shell pane
    // never surfaces chat (tmux.go's reconciler), so the window runs a
    // non-shell command (`exec` guarantees pane_current_command = sleep).
    const name = `rp-full-${Date.now()}`;
    newWindow(TEST_SESSION, name, { command: "exec sleep 600" });
    const id = await resolveWindow(page, name);
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_win_url", IFRAME_URL]);
    const paneId = execFileSync("tmux", ["-L", TMUX_SERVER, "display-message", "-t", id, "-p", "#{pane_id}"])
      .toString()
      .trim();
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-p", "-t", paneId, "@rk_pane_chat", "claude:e2e-disabled-at-3"]);

    await gotoWindow(page, id, "?layout=main-left:tty,web,chat");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // All three surfaces available → the deep link survives degradation
    // tile-by-tile intact and mirrors back unchanged.
    await expectLayoutParam(page, "main-left:tty,web,chat");

    const codeToggle = toggleButton(page, "Code");
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(toggleButton(page, "Terminal")).toHaveAttribute("aria-pressed", "true");
    await expect(toggleButton(page, "Web")).toHaveAttribute("aria-pressed", "true");
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codeToggle).toBeDisabled();

    // The Tip wraps a span so the DISABLED button still tips (disabled
    // controls swallow the pointer events Tip listens for) — hover the
    // button's parent span; expect's retry absorbs the open delay.
    await codeToggle.locator("xpath=..").hover();
    await expect(page.getByRole("tooltip")).toContainText("Close a tile first");
    await page.mouse.move(0, 0);

    // Closing a tile (the lit web toggle) re-enables the unlit one.
    await toggleButton(page, "Web").click();
    await expectLayoutParam(page, "split-h:tty,chat");
    await expect(codeToggle).toBeEnabled();
  });

  /**
   * Proves: closing is a display-level hide — the iframe element survives in
   * the DOM and re-opening restores THE SAME element (in-memory iframe state
   * preserved; the hide-never-unmount rule holds per tile).
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    top-bar toggle.
   * 2. Close via the same toggle; assert the tile is hidden but the iframe
   *    still exists in the DOM (count 1).
   * 3. Capture the iframe element handle, re-open, and assert the visible
   *    iframe is the identical element.
   */
  test("closing a tile hides but never unmounts the iframe (P3 carried into tiles)", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-hide-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await webToggle.click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });

    // Close: the tile subtree stays in the DOM at display-level hidden — the
    // iframe element is NOT removed (in-memory state survives).
    await webToggle.click();
    await expect(webTile(page)).toBeHidden();
    await expect(webIframe(page)).toHaveCount(1);

    // Re-open: the SAME iframe element becomes visible again (no remount).
    const handleBefore = await webIframe(page).elementHandle();
    await webToggle.click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    const handleAfter = await webIframe(page).elementHandle();
    expect(handleBefore).not.toBeNull();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
  });

  /**
   * Proves: URL-addressability plus the shim — the retired `?panel=web` maps
   * to `split-h:tty,web` (a bare panel value against the tty default slot A)
   * and opens the tile cold; the native `?layout=` form resolves identically;
   * on a window WITHOUT @rk_win_url the web tile is still always available
   * and renders its ONBOARDING content state in place of the iframe; an
   * unknown value (`bogus`, dropped by validateTerminalSearch) resolves
   * `single:tty`. Never a broken iframe. The test carries a 30s budget
   * (test.setTimeout, the sidebar-panels precedent): three full page loads
   * plus three window creations exceed the 10s default on a loaded box.
   *
   * Steps:
   * 1. Create a web-capable window; navigate with `?panel=web`; assert the
   *    web iframe and the terminal are both visible and the URL mirrors
   *    `split-h:tty,web`.
   * 2. Create a second web-capable window; navigate with
   *    `?layout=split-h:tty,web`; assert the same render.
   * 3. Create a plain window (no @rk_win_url); navigate with `?panel=web`;
   *    assert the terminal, both `Terminal tile` AND `Web tile` toggle
   *    buttons, the `web-tile-onboarding` panel, and no iframe.
   * 4. Navigate the first window with `?panel=bogus`; assert the terminal and
   *    no web tile.
   */
  test("?panel=web and ?layout=split-h:tty,web deep links open the web tile on load; invalid values degrade", async ({ page }) => {
    // Three full page loads + three tmux window creations — wider budget for a
    // loaded box (the sidebar-panels precedent); the per-assertion waits stay
    // at their own timeouts.
    test.setTimeout(30_000);
    // The retired ?panel=web param resolves through the permanent shim (a bare
    // panel value maps against the tty default slot A → split-h:tty,web) — the
    // tile opens cold on a web-capable window.
    const web = await makeWindow(page, `rp-deep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web, "?panel=web");
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");

    // The native ?layout= form resolves identically.
    const web2 = await makeWindow(page, `rp-deep2-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web2, "?layout=split-h:tty,web");
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // ?panel=web on a window with NO @rk_win_url → web is always available
    // (260821-zqlq), so the tile opens and renders the ONBOARDING state in
    // place of the iframe; the group shows the web toggle.
    const plain = await makeWindow(page, `rp-nourl-${Date.now()}`);
    await gotoWindow(page, plain, "?panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(toggleButton(page, "Terminal")).toBeVisible();
    await expect(toggleButton(page, "Web")).toBeVisible();
    await expect(page.getByTestId("web-tile-onboarding")).toBeVisible({ timeout: 10_000 });
    await expect(webIframe(page)).toHaveCount(0);

    // ?panel=bogus is dropped by the route's search validation → single:tty.
    await gotoWindow(page, web, "?panel=bogus");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(webTile(page)).toHaveCount(0);
  });

  /**
   * Proves: persistence (open direction) — a toggle click writes the
   * value-bearing `rk-layout:{server}:{@N}` localStorage key, and a bare
   * re-arrival resolves the open layout from it (ladder rung 2).
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    toggle.
   * 2. Full-load the BARE window route (no carried `?layout=`); wait for the
   *    status-bar `Connected` dot; assert the web iframe is visible again and
   *    the URL mirrors `split-h:tty,web`.
   */
  test("an open tile persists across reload", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-persist-open-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });

    // Open → reload → still open (the value-bearing rk-layout per-window key
    // resolves on the bare re-arrival).
    await webToggle.click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await gotoWindow(page, id);
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");
  });

  /**
   * Proves: persistence (close direction) — closing writes `single:tty` as
   * the window's layout, and a bare re-arrival renders it with no web tile
   * subtree.
   *
   * Steps:
   * 1. Create a web-capable window; navigate; open the web tile via the
   *    toggle, then close it; assert the tile is hidden.
   * 2. Full-load the bare route; wait for the status-bar `Connected` dot;
   *    assert the terminal is visible, no web tile exists in the DOM, and the
   *    URL is clean (the default `single:tty` mirrors with the param
   *    dropped).
   */
  test("a closed tile stays closed across reload", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-persist-close-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });

    // Open then close (closing writes single:tty as the window's layout) →
    // reload → still closed: no web tile mounts and the terminal renders.
    await webToggle.click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await webToggle.click();
    await expect(webTile(page)).toBeHidden();
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(webTile(page)).toHaveCount(0);
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
  });

  /**
   * Proves: the layout grammar's duplicate-kind rejection — the shim maps
   * `?view=web&panel=web` to `split-h:web,web`, which is INVALID (one tile
   * per surface kind, tty excepted); the fully-invalid value falls through
   * the ladder to the hint/default rung and renders a valid single-tile
   * layout. The retired two-independent-web-slots arrangement (main lens +
   * panel) has no layout-model successor — the intent it served (two surfaces
   * at once) is covered by the split-h tests.
   *
   * Steps:
   * 1. Create a web-capable window; navigate with `?view=web&panel=web`.
   * 2. Assert the terminal renders, exactly one `surface-layout` grid exists,
   *    and no web tile mounts.
   */
  test("?view=web&panel=web (a repeated non-tty kind after the shim) never renders a broken tile (R4/A-019)", async ({ page }) => {
    test.setTimeout(30_000);
    // The shim maps ?view=web&panel=web to split-h:web,web — a REPEATED
    // non-tty kind, which the layout grammar rejects (R1: one tile per surface
    // kind). The invalid value falls through the ladder to the hint/default
    // rung; no malformed tile ever mounts.
    const id = await makeWindow(page, `rp-dupe-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "?view=web&panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Exactly ONE layout render with a valid single tile — never two web
    // slots (the retired main+panel arrangement).
    await expect(page.getByTestId("surface-layout")).toHaveCount(1);
    await expect(webTile(page)).toHaveCount(0);
  });

  /**
   * Proves: the keyboard path (Constitution V) — the registry's
   * `code-toggle` chord (⌘2 on mac, ⇧Ctrl+2 on Win/Linux) drives the code
   * surface's TILE via the shared mutation path with stateful semantics
   * (hidden → show+focus; focused → hide), firing even while xterm owns
   * focus. The web tile's keyboard path is the palette (`Tile: Show Web` /
   * `Tile: Hide Web`).
   *
   * Steps:
   * 1. Create a web-capable window (repo-root cwd ⇒ also code-capable);
   *    navigate; assert the terminal, then wait for the `Code tile` toggle
   *    (the chord's handler is gated on the derived gitRoot arriving via the
   *    SSE window payload — firing earlier would hit a handler-less chord).
   * 2. Press Shift+Control+Digit2; assert the code tile appears, the URL
   *    mirrors `split-h:tty,code`, and the code tile carries the
   *    focused-slot accent border (the open lands focus via the landing-flag
   *    seam).
   * 3. Press Shift+Control+Digit2 again; with the code tile focused this
   *    takes the hide arm — assert the tile is hidden and the URL is clean
   *    (the default `single:tty` mirrors with the param dropped).
   */
  test("⇧Ctrl+2 / ⌘2 shows+focuses, then hides the code tile (the stateful code-toggle chord)", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-chord-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Wait for the Code toggle — the chord's handler is gated on the code
    // surface's availability (the derived gitRoot, arriving via the SSE window
    // payload); firing before it lands would hit a handler-less chord (a no-op
    // by design).
    await expect(toggleButton(page, "Code")).toBeVisible({ timeout: READY_TIMEOUT });

    // xterm owns focus after the terminal renders — the shifted-tier chord must
    // fire from there (the dispatcher's `.xterm` carve-out). The chord is
    // STATEFUL: hidden → show+focus, focused → hide.
    await page.keyboard.press("Shift+Control+Digit2");
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,code");
    // The open lands focus on the code tile (the landing-flag seam), so the
    // second press takes the focused → hide arm, not the focus arm.
    await expect(codeTile(page)).toHaveClass(/border-accent-green/, { timeout: READY_TIMEOUT });

    await page.keyboard.press("Shift+Control+Digit2");
    await expect(codeTile(page)).toBeHidden();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
  });

  /**
   * Proves: the route gate — the top-bar registry entry is hidden unless
   * mode === "terminal" && currentWindow && surfaceToggles, so the server
   * route (mode `server`, no current window) renders no group anywhere (bar,
   * probe, or menu).
   *
   * Steps:
   * 1. Navigate to /<server>; wait for the status-bar `Connected` dot.
   * 2. Assert the banner carries no `Terminal tile`, `Web tile`, or
   *    `Code tile` button.
   */
  test("the toggle group does not render off the terminal route (the server route's banner carries no tile toggles)", async ({ page }) => {
    // The top-bar registry entry is hidden unless mode==="terminal" &&
    // currentWindow && surfaceToggles — the server route (mode "server", no
    // current window) renders no group anywhere (bar, probe, or menu).
    await page.goto(`/${TMUX_SERVER}`);
    await expect(statusDot(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(toggleButton(page, "Terminal")).toHaveCount(0);
    await expect(toggleButton(page, "Web")).toHaveCount(0);
    await expect(toggleButton(page, "Code")).toHaveCount(0);
  });

  test.describe("mobile (375px, coarse pointer)", () => {
    // hasTouch flips Chromium's `(pointer: coarse)` media query — a real phone
    // is coarse AND narrow (the bottom-bar-chip-size seam). 260814-ldbs made
    // the bottom bar pointer-gated, so a viewport-only "mobile" emulation
    // (fine pointer, narrow width) exercises a different bar — the iPad/phone
    // seam is pointer-decided.
    test.use({ hasTouch: true });

    /**
     * Proves: the mobile SWITCH fork of the surface-toggles entry — at 375px
     * with ≥2 shown surfaces the banner carries one `<Label> tile` button per
     * shown surface (the visible one pressed), the retired ▦ Surfaces chip is
     * gone, and tapping an unpressed button swaps the visible tile
     * TRANSIENTLY when the target is already open in the deep-linked layout
     * (URL untouched). The nested describe runs test.use({ hasTouch: true })
     * so `(pointer: coarse)` matches — a real phone is coarse AND narrow, and
     * the bottom bar is pointer-gated: a fine-pointer narrow window exercises
     * a different bar by design.
     *
     * Steps:
     * 1. Set a 375×812 viewport (context already has hasTouch); create a
     *    web-capable window.
     * 2. Navigate with `?layout=split-h:tty,web` (gating on the terminal, not
     *    the `Connected` dot — on mobile the dot lives in the drawer's
     *    footer, which is unmounted until the drawer opens).
     * 3. Assert the terminal is visible, the banner's `Web tile` button
     *    renders (READY_TIMEOUT — the second surface resolves with the window
     *    payload), the `Terminal tile` button reads aria-pressed=true and
     *    `Web tile` reads false, the web tile is hidden (mounted), and no
     *    `mobile-surfaces-chip` exists in the DOM.
     * 4. Click `Web tile`; assert the web tile becomes visible, the pressed
     *    state flips (Web pressed, Terminal not), and the `?layout=` param
     *    still reads `split-h:tty,web` — the swap never mutated the shared
     *    arrangement.
     */
    test("375px mobile: the top-bar switch group renders with radio semantics and switches the open web tile transiently", async ({ page }) => {
      test.setTimeout(30_000);
      await page.setViewportSize(MOBILE_VIEWPORT);
      const id = await makeWindow(page, `rp-mobile-${Date.now()}`, { url: IFRAME_URL });
      // Do NOT gate on the `Connected` dot here: it lives in the desktop
      // status bar (and the mobile drawer's footer) — at 375px neither is
      // mounted until the drawer opens. Gate on the terminal instead.
      await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=split-h:tty,web`);
      await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
      // The mobile banner carries the switch group (app.tsx registers switch
      // mode when ≥2 surfaces survive the hidden filter): one button per
      // shown surface, the VISIBLE surface pressed (slot A = tty on arrival).
      // The center renders ONLY slot A (tty) full-width; the web tile stays
      // mounted-hidden until switched to.
      const ttyToggle = toggleButton(page, "Terminal");
      const webToggle = toggleButton(page, "Web");
      // READY_TIMEOUT: on a cold deep link the second surface (and so the
      // group) resolves only once the window payload lands with rkUrl.
      await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
      await expect(ttyToggle).toHaveAttribute("aria-pressed", "true");
      await expect(webToggle).toHaveAttribute("aria-pressed", "false");
      await expect(webTile(page)).toBeHidden();
      // The ▦ Surfaces chip + sheet are retired — the top-bar group subsumes
      // them, so no `mobile-surfaces-chip` testid exists anywhere in the DOM.
      await expect(page.getByTestId("mobile-surfaces-chip")).toHaveCount(0);
      // Tapping the unpressed Web button switches the visible tile. The web
      // tile is OPEN in the deep-linked layout, so the swap is TRANSIENT: the
      // URL (and the desktop arrangement it encodes) stays untouched.
      await webToggle.click();
      await expect(webTile(page)).toBeVisible({ timeout: 10_000 });
      await expect(webToggle).toHaveAttribute("aria-pressed", "true");
      await expect(ttyToggle).toHaveAttribute("aria-pressed", "false");
      await expectLayoutParam(page, "split-h:tty,web");
    });
  });
});
