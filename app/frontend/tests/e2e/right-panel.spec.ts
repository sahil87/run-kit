import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// The right RAIL e2e (260811-2r1w-right-panel-shell-web-surface, retargeted to
// the surface-layout model in 260812-ab5v-surface-layout-core; spec
// docs/specs/surface-layout.md § Verbs — "Rail semantics change"). The panel
// SLOT (surface mount + width drag) is GONE — subsumed by layout tiles; what
// remains of this spec's subject is the rail: always-on on desktop, buttons
// are availability-gated OPEN-TILE TOGGLES (lit per open tile; unlit click
// appends a tile, lit click closes it), with the retired `?panel=` param still
// resolving through the permanent translation shim. Divider-ratio drag
// coverage moved to surface-layout.spec.ts (the divider lives in the tile
// grid now). See right-panel.spec.md for intent + steps.

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-rightpanel-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// The rail is DESKTOP-ONLY (right-panel P5 carried into surface-layout R13) —
// the suite defaults to a wide desktop width; the mobile test overrides to
// 375px.
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
 *  argument arrays — no shell string construction). Returns the @N id. */
async function makeWindow(page: Page, name: string, opts: { url?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_url", opts.url]);
  }
  return id;
}

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("nav [aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

/** Assert the mirrored `?layout=` param (decoded — the router may
 *  percent-encode `:`/`,`). Retrying: the replaceState mirror lands a beat
 *  after the mutation that triggered it. */
async function expectLayoutParam(page: Page, expected: string | null): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("layout"), { timeout: 10_000 })
    .toBe(expected);
}

const rail = (page: Page) => page.getByTestId("right-panel-rail");
// Rail buttons are icon glyphs now (R10) — the accessible names carry the
// retired text labels' meaning as "<Surface> tile".
const railWebButton = (page: Page) =>
  rail(page).getByRole("button", { name: "Web tile" });
const railTtyButton = (page: Page) =>
  rail(page).getByRole("button", { name: "Terminal tile" });
// The top-bar rail toggle (260812-nm4p) — collapses the RAIL COLUMN only
// under the layout model; tiles are content-column state and survive it.
const railToggle = (page: Page) => page.getByRole("button", { name: "Toggle panel" });
const webTile = (page: Page) => page.getByTestId("surface-tile-web");
const webIframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Right rail — open-tile toggles over the surface layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    // The `runkit-rail-open` preference persists across tests (localStorage) —
    // reset it per test so a collapsing test cannot leak a hidden rail into
    // the next one. The TOP-FRAME guard is load-bearing: init scripts run for
    // EVERY frame, and the panel's same-origin iframe (/proxy/…) shares this
    // origin's localStorage — without the guard, a panel opening (an iframe
    // navigation) would wipe the pref mid-test.
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try {
        localStorage.removeItem("runkit-rail-open");
      } catch {
        /* noop */
      }
    });
  });

  test("the rail renders on every desktop terminal route with the always-available tty toggle; the web toggle only when @rk_url is set", async ({ page }) => {
    test.setTimeout(30_000);
    // A plain window (no @rk_url) still gets the always-on rail — with the
    // `tty` toggle (always available, R8) lit for the default single:tty
    // layout, but NO web toggle.
    const plain = await makeWindow(page, `rp-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toBeVisible();
    await expect(railTtyButton(page)).toBeVisible();
    await expect(railTtyButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(railWebButton(page)).toHaveCount(0);

    // A window with @rk_url gains the web rail toggle (availability derives
    // from the SSE window payload — no client-side declaration).
    const web = await makeWindow(page, `rp-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Availability rides the SSE window payload — the same readiness class the
    // shared CI-aware budget exists for.
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // Not lit yet — only the tty tile is open.
    await expect(railWebButton(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking the rail toggle opens a web tile beside a live terminal; clicking again closes it", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-toggle-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Open: 1→2 growth appends a `split-h:tty,web` tile (R10) — the proxied
    // iframe renders BESIDE the terminal, which stays mounted and visible (the
    // layout is additive, like the panel was). The URL mirrors the layout and
    // the toggle lights.
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(railWebButton(page)).toHaveAttribute("aria-pressed", "true");
    // The tile-context iframe keeps its URL bar.
    await expect(webTile(page).getByRole("textbox", { name: "URL" })).toBeVisible();

    // Close via the same rail toggle: the web tile hides (R7 close semantics —
    // the layout collapses 2→1) and the URL goes clean (default drops the param).
    await railWebButton(page).click();
    await expect(webTile(page)).toBeHidden();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
    await expect(railWebButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(terminal(page)).toBeVisible();
  });

  test("closing a tile hides but never unmounts the iframe (P3 carried into tiles)", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-hide-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });

    // Close: the tile subtree stays in the DOM at display-level hidden — the
    // iframe element is NOT removed (in-memory state survives).
    await railWebButton(page).click();
    await expect(webTile(page)).toBeHidden();
    await expect(webIframe(page)).toHaveCount(1);

    // Re-open: the SAME iframe element becomes visible again (no remount).
    const handleBefore = await webIframe(page).elementHandle();
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    const handleAfter = await webIframe(page).elementHandle();
    expect(handleBefore).not.toBeNull();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
  });

  test("?panel=web and ?layout=split-h:tty,web deep links open the web tile on load; unavailable/invalid values degrade", async ({ page }) => {
    // Three full page loads + two tmux window creations — wider budget for a
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
    // tile-by-tile degradation drops it (R4) → single:tty, never a broken iframe.
    const plain = await makeWindow(page, `rp-nourl-${Date.now()}`);
    await gotoWindow(page, plain, "?panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toBeVisible();
    await expect(railWebButton(page)).toHaveCount(0);
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

    // Open → reload → still open (the value-bearing rk-layout per-window key
    // resolves on the bare re-arrival).
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("nav [aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");
  });

  test("a closed tile stays closed across reload", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-persist-close-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);

    // Open then close (closing writes single:tty as the window's layout) →
    // reload → still closed: no web tile mounts and the terminal renders.
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await railWebButton(page).click();
    await expect(webTile(page)).toBeHidden();
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("nav [aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
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

  test("⇧⌘. / Shift+Ctrl+. toggles the first non-tty tile (P7, retargeted)", async ({ page }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `rp-chord-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Wait for the rail button — the chord's handler is gated on a non-tty
    // surface's availability, which arrives via the SSE `@rk_url` push; firing
    // before it lands would hit a handler-less chord (a no-op by design).
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // xterm owns focus after the terminal renders — the shifted-tier chord must
    // fire from there (the dispatcher's `.xterm` carve-out).
    await page.keyboard.press("Shift+Control+Period");
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");

    await page.keyboard.press("Shift+Control+Period");
    await expect(webTile(page)).toBeHidden();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
  });

  test.describe("mobile (375px, coarse pointer)", () => {
    // hasTouch flips Chromium's `(pointer: coarse)` media query — a real phone
    // is coarse AND narrow (the bottom-bar-chip-size seam). 260814-ldbs made
    // the bottom bar pointer-gated, and the ▦ Surfaces chip lives in that
    // bar, so a viewport-only "mobile" emulation (fine pointer, narrow width)
    // would get NO chip bar by design — the iPad/phone seam is pointer-decided.
    test.use({ hasTouch: true });

    test("375px mobile: no rail; a 2-tile deep link renders slot A with the surfaces chip", async ({ page }) => {
      test.setTimeout(30_000);
      await page.setViewportSize(MOBILE_VIEWPORT);
      const id = await makeWindow(page, `rp-mobile-${Date.now()}`, { url: IFRAME_URL });
      // Do NOT gate on the `Connected` dot here: it lives in the sidebar footer,
      // and at 375px the sidebar is an unmounted drawer (the web-view-lens mobile
      // test's documented reason). Gate on the terminal instead.
      await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=split-h:tty,web`);
      await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
      // The rail does not render on mobile (desktop-only, P5 → R13). The center
      // renders ONLY slot A (tty) full-width; the web tile stays mounted-hidden
      // and reachable via the ▦ Surfaces chip's sheet.
      await expect(rail(page)).toHaveCount(0);
      await expect(webTile(page)).toBeHidden();
      // READY_TIMEOUT: on a cold deep link the second surface (and so the chip)
      // resolves only once the window payload lands with rkUrl.
      await expect(page.getByTestId("mobile-surfaces-chip")).toBeVisible({
        timeout: READY_TIMEOUT,
      });
    });
  });
});

test.describe("Top-bar rail toggle & stage layout (260812-nm4p + 260814-ldbs)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    // Reset the persisted rail preference per test — it leaks across tests
    // otherwise and would silently collapse the rail for the next one. The
    // TOP-FRAME guard is load-bearing: init scripts run for EVERY frame, and
    // the panel's same-origin iframe (/proxy/…) shares this origin's
    // localStorage — without the guard, a panel opening (an iframe
    // navigation) would wipe the pref mid-test.
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try {
        localStorage.removeItem("runkit-rail-open");
      } catch {
        /* noop */
      }
    });
  });

  test("the toggle renders on a PLAIN window too (zero available surfaces)", async ({ page }) => {
    // cwd /tmp keeps the window git-root-less, so NEITHER surface (web via
    // @rk_url, code via gitRoot) is available — the rail renders with zero
    // buttons and the toggle still renders (the rail is landing-pad chrome,
    // not surface-gated).
    const name = `rp-toggle-plain-${Date.now()}`;
    newWindow(TEST_SESSION, name, { cwd: "/tmp" });
    const plain = await resolveWindow(page, name);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toBeVisible();
    await expect(railWebButton(page)).toHaveCount(0);
    await expect(railToggle(page)).toBeVisible();
  });

  test("collapse hides the rail and the terminal grows; restore brings the rail back", async ({ page }) => {
    const id = await makeWindow(page, `rp-rail-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(railToggle(page)).toBeVisible();
    await expect(rail(page)).toBeVisible();

    const widthBefore = (await terminal(page).boundingBox())!.width;

    // Collapse: the whole right column hides at display level (never
    // unmounts) and the terminal's box GROWS to run edge-to-edge.
    await railToggle(page).click();
    await expect(rail(page)).toBeHidden();
    await expect
      .poll(async () => (await terminal(page).boundingBox())?.width ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(widthBefore);

    // The preference persisted.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("runkit-rail-open")))
      .toBe("false");

    // Restore: only the rail returns (no panel was open — nothing else to
    // restore).
    await railToggle(page).click();
    await expect(rail(page)).toBeVisible();
  });

  test("collapse with an open web TILE hides only the rail; the tile and its ?layout= survive", async ({ page }) => {
    const id = await makeWindow(page, `rp-railpanel-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");

    // Collapse: the RAIL hides — tiles are content-column state (260812-ab5v)
    // and are deliberately untouched: the web tile keeps rendering and the
    // layout param stays (each tile carries its own ✕ verb, so nothing is
    // stranded behind a hidden rail).
    await railToggle(page).click();
    await expect(rail(page)).toBeHidden();
    await expect(webTile(page)).toBeVisible();
    await expect(webIframe(page)).toBeVisible();
    await expectLayoutParam(page, "split-h:tty,web");

    // Restore: the rail returns lit for the still-open tile.
    await railToggle(page).click();
    await expect(rail(page)).toBeVisible();
    await expect(railWebButton(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("⇧⌘. works while the rail is collapsed — the tile opens in the content column, the rail stays hidden", async ({ page }) => {
    const id = await makeWindow(page, `rp-railchord-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // Collapse the rail, then fire the surface chord: the tile opens in the
    // CONTENT column (260812-ab5v — tiles are not rail state), so the chord
    // is never dead behind a collapse; the rail itself stays hidden and the
    // persisted preference is untouched.
    await railToggle(page).click();
    await expect(rail(page)).toBeHidden();
    await page.keyboard.press("Shift+Control+Period");
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(rail(page)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("runkit-rail-open")))
      .toBe("false");
  });

  test("stage layout (260814-ldbs): the rail is a card ending above the status bar; no bottom bar exists on a fine-pointer desktop", async ({ page }) => {
    const id = await makeWindow(page, `rp-fullheight-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });

    const shellBox = await page.locator(".app-shell").boundingBox();
    const railBox = await rail(page).boundingBox();
    const statusBarBox = await page.getByTestId("status-bar").boundingBox();
    expect(shellBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(statusBarBox).not.toBeNull();

    // The rail is a floating CARD in the stage now — it ends 6px above the
    // status bar (the stage's bottom padding), no longer full-height.
    const shellBottom = shellBox!.y + shellBox!.height;
    expect(statusBarBox!.y + statusBarBox!.height).toBeCloseTo(shellBottom, 0);
    expect(statusBarBox!.y - (railBox!.y + railBox!.height)).toBeCloseTo(6, 0);

    // The desktop bottom bar is DELETED on fine pointers (260814-ldbs R3) —
    // no toolbar anywhere in the shell.
    await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toHaveCount(0);
  });

  test("a legacy ?panel= deep link on a collapsed rail still renders its tile (never a dead link); the rail stays hidden", async ({ page }) => {
    // Seed the COLLAPSED preference so the deep link lands on a collapsed
    // rail (registered after the suite's reset script, so it wins on every
    // load; top-frame only — init scripts run for every frame, including the
    // web tile's same-origin /proxy/ iframe). Tiles are content-column state
    // (260812-ab5v), so the deep link renders WITHOUT forcing the rail
    // visible — the old derived-visibility rule is retired with the panel.
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try {
        localStorage.setItem("runkit-rail-open", "false");
      } catch {
        /* noop */
      }
    });
    const id = await makeWindow(page, `rp-raildeep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "?panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(webIframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(rail(page)).toBeHidden();
  });
});
