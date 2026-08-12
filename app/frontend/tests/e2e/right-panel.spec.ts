import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-rightpanel-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// The rail/panel are DESKTOP-ONLY in phase 1 (spec right-panel.md P5, Open
// Question 3) — the suite defaults to a wide desktop width; the mobile test
// overrides to 375px.
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
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const rail = (page: Page) => page.getByTestId("right-panel-rail");
const railWebButton = (page: Page) => page.getByRole("button", { name: "Web panel" });
const railToggle = (page: Page) => page.getByRole("button", { name: "Toggle panel" });
const panel = (page: Page) => page.getByTestId("right-panel");
const panelIframe = (page: Page) => panel(page).getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();
const resizeHandle = (page: Page) => page.getByTestId("right-panel-resize-handle");

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Right panel — rail, shell & web surface (phase 1)", () => {
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

  test("the rail renders on every desktop terminal route; the web button only when @rk_url is set", async ({ page }) => {
    // A plain window (no @rk_url) still gets the always-on rail, but with no
    // surface buttons.
    const plain = await makeWindow(page, `rp-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toBeVisible();
    await expect(railWebButton(page)).toHaveCount(0);

    // A window with @rk_url gains the web rail button (availability derives
    // from the SSE window payload — no client-side declaration).
    const web = await makeWindow(page, `rp-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Availability rides the SSE window payload — the same readiness class the
    // shared CI-aware budget exists for.
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });
  });

  test("clicking the rail button opens the panel beside a live terminal; clicking again closes it", async ({ page }) => {
    const id = await makeWindow(page, `rp-toggle-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Open: the panel renders the proxied iframe; the terminal stays mounted
    // and visible BESIDE it (P2 — the panel is additive).
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible();
    await expect(page).toHaveURL(/\?panel=web/);
    // The panel-context iframe has NO `>_` switch-to-terminal affordance (the
    // tty is already beside it) but keeps its URL bar.
    await expect(panel(page).getByRole("button", { name: "Switch to terminal" })).toHaveCount(0);
    await expect(panel(page).getByRole("textbox", { name: "URL" })).toBeVisible();

    // Close via the same rail button: the panel hides and the param drops
    // (closed is the clean-URL default).
    await railWebButton(page).click();
    await expect(panel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]panel=/);
    await expect(terminal(page)).toBeVisible();
  });

  test("collapse hides but never unmounts the iframe (P3)", async ({ page }) => {
    const id = await makeWindow(page, `rp-hide-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });

    // Collapse: the panel subtree stays in the DOM at display-level hidden —
    // the iframe element is NOT removed (in-memory state survives).
    await railWebButton(page).click();
    await expect(panel(page)).toBeHidden();
    await expect(panelIframe(page)).toHaveCount(1);

    // Re-open: the SAME iframe element becomes visible again (no remount).
    const handleBefore = await panelIframe(page).elementHandle();
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    const handleAfter = await panelIframe(page).elementHandle();
    expect(handleBefore).not.toBeNull();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
  });

  test("?panel=web deep link opens the panel on load; unavailable/unknown values resolve closed", async ({ page }) => {
    // Three full page loads + two tmux window creations — wider budget for a
    // loaded box (the sidebar-panels precedent); the per-assertion waits stay
    // at their own timeouts.
    test.setTimeout(30_000);
    // Deep link on a web-capable window → panel opens cold.
    const web = await makeWindow(page, `rp-deep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web, "?panel=web");
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // ?panel=web on a window with NO @rk_url → unavailable → falls through to
    // closed (never a broken iframe).
    const plain = await makeWindow(page, `rp-nourl-${Date.now()}`);
    await gotoWindow(page, plain, "?panel=web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toBeVisible();
    await expect(railWebButton(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);

    // ?panel=bogus is dropped by the route's search validation → closed.
    await gotoWindow(page, web, "?panel=bogus");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(panel(page)).toHaveCount(0);
  });

  test("an open panel persists across reload", async ({ page }) => {
    const id = await makeWindow(page, `rp-persist-open-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);

    // Open → reload → still open (the value-bearing per-window key resolves).
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\?panel=web/);
  });

  test("a closed panel stays closed across reload", async ({ page }) => {
    const id = await makeWindow(page, `rp-persist-close-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);

    // Open then close (closing REMOVES the key; absent = closed) → reload →
    // still closed: no panel subtree mounts and the terminal renders.
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await railWebButton(page).click();
    await expect(panel(page)).toBeHidden();
    await page.reload();
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(panel(page)).toHaveCount(0);
  });

  test("?view=web and ?panel=web render two independent iframe slots simultaneously (P2)", async ({ page }) => {
    const id = await makeWindow(page, `rp-both-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "?view=web&panel=web");
    // The main slot renders the web lens (with its `>_` switch affordance) and
    // the panel renders its own IframeWindow beside it — two instances.
    await expect(page.getByTitle("Proxied content")).toHaveCount(2, { timeout: 10_000 });
    await expect(panelIframe(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Switch to terminal" }),
    ).toHaveCount(1); // only the MAIN slot's iframe carries the >_ button
  });

  test("drag-resize changes the panel width and the terminal survives (refit, no unmount)", async ({ page }) => {
    const id = await makeWindow(page, `rp-drag-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    const panelBox = await panel(page).boundingBox();
    const handleBox = await resizeHandle(page).boundingBox();
    expect(panelBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const xtermBefore = await terminal(page).elementHandle();

    // Drag the handle 120px LEFT — the panel widens by ~120px.
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 120, startY, { steps: 6 });
    await page.mouse.up();

    const panelBoxAfter = await panel(page).boundingBox();
    expect(panelBoxAfter).not.toBeNull();
    expect(panelBoxAfter!.width).toBeGreaterThan(panelBox!.width + 60);

    // The terminal pane stayed MOUNTED (same xterm element handle) and visible
    // — the refit rides TerminalClient's ResizeObserver; nothing suspended.
    const xtermAfter = await terminal(page).elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [xtermBefore, xtermAfter])).toBe(true);
    await expect(terminal(page)).toBeVisible();
  });

  test("⇧⌘. / Shift+Ctrl+. toggles the web panel (P7)", async ({ page }) => {
    const id = await makeWindow(page, `rp-chord-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Wait for the rail button — the chord's handler is gated on the web
    // surface's availability, which arrives via the SSE `@rk_url` push; firing
    // before it lands would hit a handler-less chord (a no-op by design).
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // xterm owns focus after the terminal renders — the shifted-tier chord must
    // fire from there (the dispatcher's `.xterm` carve-out).
    await page.keyboard.press("Shift+Control+Period");
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Shift+Control+Period");
    await expect(panel(page)).toBeHidden();
  });

  test("375px mobile: neither rail nor panel renders and ?panel= is ignored", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await makeWindow(page, `rp-mobile-${Date.now()}`, { url: IFRAME_URL });
    // Do NOT gate on the `Connected` dot here: it lives in the sidebar footer,
    // and at 375px the sidebar is an unmounted drawer (the web-view-lens mobile
    // test's documented reason). Gate on the terminal instead.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?panel=web`);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(rail(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe("Top-bar rail toggle & full-height column (260812-nm4p)", () => {
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

  test("collapse with an open panel hides BOTH and drops ?panel=; restore brings back only the rail", async ({ page }) => {
    const id = await makeWindow(page, `rp-railpanel-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\?panel=web/);

    // Collapse: rail AND panel hide, the param drops, and the per-window
    // panel key is removed (a hidden-but-open panel would contradict its URL).
    const iframeBefore = await panelIframe(page).elementHandle();
    await railToggle(page).click();
    await expect(rail(page)).toBeHidden();
    await expect(panel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]panel=/);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `runkit-window-panel:${TMUX_SERVER}:${id}`,
        ),
      )
      .toBeNull();

    // The iframe element was NOT unmounted by the collapse (display-level
    // hide all the way up — in-memory state survives).
    await expect(panelIframe(page)).toHaveCount(1);
    const iframeAfter = await panelIframe(page).elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [iframeBefore, iframeAfter])).toBe(true);

    // Restore: the rail returns; the panel stays closed (a panel closed by a
    // collapse stays closed).
    await railToggle(page).click();
    await expect(rail(page)).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]panel=/);
  });

  test("⇧⌘. after a collapse re-shows the rail WITH the panel (derived visibility)", async ({ page }) => {
    const id = await makeWindow(page, `rp-railchord-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(railWebButton(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // Collapse the rail, then fire the panel chord: opening a panel forces
    // the right area visible (rightAreaVisible = railOpen || panel != null)
    // without flipping the persisted railOpen preference.
    await railToggle(page).click();
    await expect(rail(page)).toBeHidden();
    await page.keyboard.press("Shift+Control+Period");
    await expect(rail(page)).toBeVisible();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\?panel=web/);
    // railOpen stayed false — the visibility is derived, not synchronized.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("runkit-rail-open")))
      .toBe("false");
  });

  test("full-height layout: the rail+panel column reaches the shell bottom; the bottom bar spans only the terminal column", async ({ page }) => {
    const id = await makeWindow(page, `rp-fullheight-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await railWebButton(page).click();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });

    const shellBox = await page.locator(".app-shell").boundingBox();
    const railBox = await rail(page).boundingBox();
    const panelBox = await panel(page).boundingBox();
    const footerBox = await page.locator("footer").boundingBox();
    const mainBox = await page.locator("main").boundingBox();
    expect(shellBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(mainBox).not.toBeNull();

    // The right column is full-height: the rail and the panel both reach the
    // shell's bottom edge (below the bottom bar's top edge).
    const shellBottom = shellBox!.y + shellBox!.height;
    expect(railBox!.y + railBox!.height).toBeCloseTo(shellBottom, 0);
    expect(panelBox!.y + panelBox!.height).toBeCloseTo(shellBottom, 0);
    expect(railBox!.y + railBox!.height).toBeGreaterThan(footerBox!.y);

    // The bottom bar is scoped to the content column: its width equals the
    // terminal column's — NOT the full viewport.
    expect(footerBox!.width).toBeCloseTo(mainBox!.width, 0);
    expect(footerBox!.width).toBeLessThan(DESKTOP_VIEWPORT.width);
  });

  test("a ?panel= deep link on a collapsed rail renders rail+panel (never a dead link)", async ({ page }) => {
    // Seed the COLLAPSED preference so the deep link lands on a collapsed rail
    // (registered after the suite's reset script, so it wins on every load;
    // top-frame only — init scripts run for every frame, including the panel's
    // same-origin /proxy/ iframe). Derived visibility (`railOpen || panel
    // open`) must then force the right area open — the deep link is never dead.
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
    await expect(rail(page)).toBeVisible();
    await expect(panelIframe(page)).toBeVisible({ timeout: 10_000 });
  });
});
