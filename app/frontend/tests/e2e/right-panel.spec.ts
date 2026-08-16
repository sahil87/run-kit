import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// The surface-toggle e2e — formerly the right RAIL spec
// (260811-2r1w-right-panel-shell-web-surface, retargeted to the surface-layout
// model in 260812-ab5v-surface-layout-core). 260815-19me-composed-frame-unification
// DELETED the rail (`right-panel.tsx` + the `right-panel-rail` testid): its
// availability-gated open-tile toggles relocated into the top bar's right
// cluster as ONE bordered sub-group (SurfaceToggleGroup in top-bar.tsx,
// `data-testid="surface-toggles"`), terminal route only, on desktop leftmost in
// the cluster and the FIRST overflow fit candidate. On MOBILE the same entry
// forks to SWITCH mode: radio semantics (pressed = the visible tile, tap runs
// the switch-to-tile verb), pinned in-bar (never overflows, no Tiles menu
// rows), gated on ≥2 shown surfaces; the bottom-bar ▦ Surfaces chip and
// mobile-surface-sheet it replaces are DELETED. The button grammar is the
// rail's, unchanged: one Tip-wrapped button per available surface not in
// SURFACE_RAIL_HIDDEN (chat never gets a toggle), tty first, "<Label> tile"
// aria names, SURFACE_GLYPH glyphs (`>_`/`://`/`{}`), aria-pressed = tile open
// (toggle mode) / tile visible (switch mode), a corner availability dot on
// every button, disabled-at-3 with the "Close a tile first" tip (toggle mode
// only). The rail-collapse chrome (the "Toggle panel" top-bar chip,
// the `runkit-rail-open` preference, the `Panel: Toggle rail` palette action)
// is GONE — its tests are deleted with it, not migrated. See
// right-panel.spec.md for intent + steps.
//
// LOCATOR RULE (the top-bar-overflow.spec.ts pattern): the top bar ALWAYS
// renders an aria-hidden off-screen (-left-[9999px]) measurement PROBE
// duplicating every in-bar control. Playwright treats the probe as visible, so
// testid/CSS queries (`getByTestId("surface-toggles")`, `:visible` filters)
// match BOTH copies. Locate toggle buttons by ACCESSIBLE NAME scoped to the
// banner landmark — getByRole excludes the aria-hidden probe subtree.

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

/** Create a window and (optionally) stamp @rk_url via tmux (execFileSync with
 *  argument arrays — no shell string construction). Windows inherit the tmux
 *  server's repo-root cwd, so every default-cwd window here is code-capable
 *  (gitRoot derived — the surface-layout.spec.ts pattern). Returns the @N id. */
async function makeWindow(page: Page, name: string, opts: { url?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_url", opts.url]);
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

  test("the toggle group renders on the desktop terminal route with the always-available tty toggle; the web toggle only when @rk_url is set", async ({ page }) => {
    test.setTimeout(30_000);
    // A plain repo-cwd window (no @rk_url) gets the group with the tty toggle
    // (always available, R8) LIT for the default single:tty layout and the
    // CODE toggle (gitRoot derived from the inherited repo cwd) — but NO web
    // toggle.
    const plain = await makeWindow(page, `rp-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const ttyToggle = toggleButton(page, "Terminal");
    await expect(ttyToggle).toBeVisible();
    await expect(ttyToggle).toHaveAttribute("aria-pressed", "true");
    await expect(ttyToggle).toContainText(">_"); // SURFACE_GLYPH
    // The corner availability dot rides every toggle.
    await expect(ttyToggle.locator("span.rounded-full")).toHaveCount(1);
    // gitRoot rides the SSE window payload — the same readiness class the
    // shared CI-aware budget exists for.
    const codeToggle = toggleButton(page, "Code");
    await expect(codeToggle).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codeToggle).toContainText("{}");
    await expect(toggleButton(page, "Web")).toHaveCount(0);

    // A window with @rk_url gains the web toggle (availability derives from
    // the SSE window payload — no client-side declaration).
    const web = await makeWindow(page, `rp-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    const webToggle = toggleButton(page, "Web");
    await expect(webToggle).toBeVisible({ timeout: READY_TIMEOUT });
    // Not lit yet — only the tty tile is open.
    await expect(webToggle).toHaveAttribute("aria-pressed", "false");
    await expect(webToggle).toContainText("://");
  });

  test("a window with no git root and no @rk_url shows only the tty toggle", async ({ page }) => {
    test.setTimeout(30_000);
    // cwd /tmp keeps the window git-root-less, so NEITHER non-tty toggle
    // renders (web via @rk_url, code via gitRoot) — the group still renders
    // with the always-available tty toggle.
    const name = `rp-nocap-${Date.now()}`;
    newWindow(TEST_SESSION, name, { cwd: "/tmp" });
    const plain = await resolveWindow(page, name);
    await gotoWindow(page, plain);
    // The terminal mounting proves the SSE window payload landed, so the
    // count-0 assertions below are settled (not a pre-payload snapshot).
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(toggleButton(page, "Terminal")).toBeVisible();
    await expect(toggleButton(page, "Web")).toHaveCount(0);
    await expect(toggleButton(page, "Code")).toHaveCount(0);
  });

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

  test("at 3 open tiles the unlit toggle is disabled and tips 'Close a tile first'", async ({ page }) => {
    test.setTimeout(30_000);
    // Disabled-at-3 needs an UNLIT shown toggle while 3 tiles are open — with
    // chat hidden from the group (SURFACE_RAIL_HIDDEN) the only way is an open
    // CHAT tile: a chat-capable window deep-linked to main-left:tty,web,chat
    // leaves the CODE toggle unlit at 3 open tiles. Chat capability: @rk_chat
    // is a PANE option reconciled by the pane's liveness — a plain-shell pane
    // never surfaces chat (tmux.go's reconciler), so the window runs a
    // non-shell command (`exec` guarantees pane_current_command = sleep).
    const name = `rp-full-${Date.now()}`;
    newWindow(TEST_SESSION, name, { command: "exec sleep 600" });
    const id = await resolveWindow(page, name);
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_url", IFRAME_URL]);
    const paneId = execFileSync("tmux", ["-L", TMUX_SERVER, "display-message", "-t", id, "-p", "#{pane_id}"])
      .toString()
      .trim();
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-p", "-t", paneId, "@rk_chat", "claude:e2e-disabled-at-3"]);

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

  test("?panel=web and ?layout=split-h:tty,web deep links open the web tile on load; unavailable/invalid values degrade", async ({ page }) => {
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

    // ?panel=web on a window with NO @rk_url → the web surface is unavailable →
    // tile-by-tile degradation drops it (R4) → single:tty, never a broken
    // iframe; the group renders (tty/code toggles) with NO web toggle.
    const plain = await makeWindow(page, `rp-nourl-${Date.now()}`);
    await gotoWindow(page, plain, "?panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(toggleButton(page, "Terminal")).toBeVisible();
    await expect(toggleButton(page, "Web")).toHaveCount(0);
    await expect(webTile(page)).toHaveCount(0);

    // ?panel=bogus is dropped by the route's search validation → single:tty.
    await gotoWindow(page, web, "?panel=bogus");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(webTile(page)).toHaveCount(0);
  });

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

  test("⇧Ctrl+J / ⌘J toggles the code tile (the code-toggle chord)", async ({ page }) => {
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
    // fire from there (the dispatcher's `.xterm` carve-out).
    await page.keyboard.press("Shift+Control+KeyJ");
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,code");

    await page.keyboard.press("Shift+Control+KeyJ");
    await expect(codeTile(page)).toBeHidden();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
  });

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
