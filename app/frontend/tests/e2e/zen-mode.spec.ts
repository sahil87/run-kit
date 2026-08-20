import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-zen-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The chord under test, as it resolves on the e2e rig's Linux browser host
// (base shifted tier — the mac ⇧⌘⏎ form is unit-tested in keybindings.test.ts).
const CHORD_ZEN = "Shift+Control+Enter";

const SIDEBAR_PREF_KEY = "runkit-sidebar-open";

const sidebarAside = (page: Page) => page.locator('aside[aria-label="Sidebar"]');
const topBar = (page: Page) => page.getByRole("banner");
const statusBar = (page: Page) => page.getByTestId("status-bar");
const exitZenButton = (page: Page) => page.getByTestId("status-bar-exit-zen");
const ttyTile = (page: Page) => page.getByTestId("surface-tile-tty");
const codeTile = (page: Page) => page.getByTestId("surface-tile-code");

/** Create a window and return its stable `@N` id. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  return (await resolveWindow(page, TMUX_SERVER, TEST_SESSION, name)).windowId;
}

/** Navigate to a window's terminal route and wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

/** Read the persisted sidebar preference straight out of localStorage. */
async function sidebarPref(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SIDEBAR_PREF_KEY);
}

/** Open the command palette. The ⌃K chord only fires when focus is OUTSIDE
 *  the xterm pane (the pane's key handling swallows Ctrl+K on Linux — a
 *  pre-existing terminal-routing property, not zen's), so defocus to chrome
 *  first via the status bar. */
async function openPalette(page: Page) {
  await page.getByTestId("status-bar").click({ position: { x: 400, y: 12 } });
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: READY_TIMEOUT });
  return palette;
}

/** A second tile via the top-bar surface-toggle rail (the `Code tile` rail
 *  precedent in surface-layout/code-surface specs — the e2e rig's windows
 *  offer the code surface from their repo cwd). */
async function openCodeTile(page: Page): Promise<void> {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Code tile" })
    .first()
    .click();
  await expect(codeTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  // A known persisted sidebar preference — the round-trip test asserts this
  // exact value survives a zen enter/exit untouched.
  await page.addInitScript(
    (key) => localStorage.setItem(key, "true"),
    SIDEBAR_PREF_KEY,
  );
});

test("enter via ⇧⌘⏎ hides top bar + sidebar at arity 1, keeps the status bar with an exit button; exit via the button restores chrome and never writes the sidebar preference", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const id = await makeWindow(page, `zen-a-${Date.now()}`);
  await gotoWindow(page, id);
  await expect(ttyTile(page)).toBeVisible({ timeout: READY_TIMEOUT });

  // Baseline: full chrome, no exit button, preference as seeded.
  await expect(topBar(page)).toBeVisible();
  await expect(sidebarAside(page)).toBeVisible();
  await expect(statusBar(page)).toBeVisible();
  await expect(exitZenButton(page)).toHaveCount(0);
  expect(await sidebarPref(page)).toBe("true");

  // Enter zen at arity 1 — the chord now mounts here (the 260820-o8cr gap).
  await page.locator(".xterm").first().click();
  await page.keyboard.press(CHORD_ZEN);
  await expect(topBar(page)).toBeHidden({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeHidden();
  // The compose strip surface and the status bar STAY visible — and the
  // status bar carries the always-visible-in-zen exit affordance.
  await expect(statusBar(page)).toBeVisible();
  await expect(exitZenButton(page)).toBeVisible();
  // Zen is transient: the persisted preference is untouched mid-zen.
  expect(await sidebarPref(page)).toBe("true");

  // Exit via the status-bar button — chrome restored to the persisted state.
  await exitZenButton(page).click();
  await expect(topBar(page)).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeVisible();
  await expect(exitZenButton(page)).toHaveCount(0);
  expect(await sidebarPref(page)).toBe("true");
});

test("exit via the chord restores chrome; at arity > 1 entering zen zooms the focused tile and exiting unzooms it", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const id = await makeWindow(page, `zen-b-${Date.now()}`);
  await gotoWindow(page, id);
  await expect(ttyTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
  await openCodeTile(page);

  // Enter at arity 2: chrome hidden AND the non-focused tile display-hidden
  // (the focused-tile zoom riding the existing zoom seam).
  await page.locator(".xterm").first().click();
  await page.keyboard.press(CHORD_ZEN);
  await expect(topBar(page)).toBeHidden({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeHidden();
  await expect(codeTile(page)).toBeHidden();
  await expect(ttyTile(page)).toBeVisible();
  await expect(exitZenButton(page)).toBeVisible();

  // Exit via the chord: chrome back, the zen-initiated zoom undone.
  await page.keyboard.press(CHORD_ZEN);
  await expect(topBar(page)).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeVisible();
  await expect(codeTile(page)).toBeVisible();
  await expect(exitZenButton(page)).toHaveCount(0);
});

test("the palette offers `View: Enter Zen Mode` findable by 'zen' at arity 1, flips to the exit form while zen is active, and drives the same toggle", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const id = await makeWindow(page, `zen-c-${Date.now()}`);
  await gotoWindow(page, id);
  await expect(ttyTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
  // Enter through the palette (arity 1 — the entry is offered at any arity).
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("zen");
  await expect(palette.getByRole("option", { name: /View: Enter Zen Mode/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /View: Exit Zen Mode/ })).toHaveCount(0);
  await palette.getByRole("option", { name: /View: Enter Zen Mode/ }).click();
  await expect(topBar(page)).toBeHidden({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeHidden();

  // One-form flip: while zen is active, only the exit form is offered.
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("zen");
  await expect(palette.getByRole("option", { name: /View: Exit Zen Mode/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /View: Enter Zen Mode/ })).toHaveCount(0);
  await palette.getByRole("option", { name: /View: Exit Zen Mode/ }).click();
  await expect(topBar(page)).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(sidebarAside(page)).toBeVisible();
});
