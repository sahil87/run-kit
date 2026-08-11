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
