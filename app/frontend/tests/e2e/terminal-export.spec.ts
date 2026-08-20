import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-texp-${Date.now()}`;
const WINDOW_NAME = "export";
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

const exportButton = (page: Page) =>
  page.getByRole("button", { name: "Export terminal output" });

/** Open the command palette, retrying the chord — right after first paint the
 *  keybinding registry may still be loading, so a lone Meta+k can be missed. */
async function openPalette(page: Page) {
  const input = page.getByPlaceholder("Type a command");
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press("Meta+k");
    const visible = await input
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) return input;
  }
  await expect(input).toBeVisible({ timeout: READY_TIMEOUT });
  return input;
}

test.beforeAll(() => {
  // An idle pane with one printed line, so the client buffer is non-empty.
  createSession(TEST_SESSION, {
    windows: [{ name: WINDOW_NAME, command: "echo export-e2e-marker; sleep 300" }],
  });
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
});

test("⇩ button opens the two-section menu; Download snapshot downloads a convention-named .html", async ({
  page,
}) => {
  // The SSE + terminal mount chain exceeds the 10s default on a contended dev box.
  test.setTimeout(30_000);
  const win = await resolveWindow(page, TMUX_SERVER, TEST_SESSION, WINDOW_NAME);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(win.windowId)}`);
  await expect(
    page.getByTestId("status-bar").locator("[aria-label='Connected']"),
  ).toBeVisible({ timeout: READY_TIMEOUT });
  const ttyTile = page.getByTestId("surface-tile-tty");
  await expect(ttyTile).toBeVisible({ timeout: READY_TIMEOUT });
  // The filename tokens derive from the SSE snapshot (sessionName +
  // statusWindow) — the sidebar session row renders from the same payload, so
  // it is the gate for "the snapshot landed".
  await expect(
    page
      .locator("nav[aria-label='Sessions']")
      .locator(`button[aria-label='Navigate to ${TEST_SESSION}']`),
  ).toBeVisible({ timeout: READY_TIMEOUT });

  // The ⇩ export button sits on the tty tile header, left of the pane segment.
  await expect(exportButton(page)).toBeVisible();
  await exportButton(page).click();

  const menu = page.getByTestId("export-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("This view — client buffer")).toBeVisible();
  await expect(menu.getByText("Full history — server capture")).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(4);

  // Picking the snapshot row fires one download named per
  // {session}-{window}-{YYMMDD-HHmmss}.html and closes the menu.
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: /Download snapshot/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${TEST_SESSION}-${WINDOW_NAME}-\\d{6}-\\d{6}\\.html$`),
  );
  await expect(menu).not.toBeVisible();
});

test("the palette carries the four Terminal: export entries on the terminal route", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const win = await resolveWindow(page, TMUX_SERVER, TEST_SESSION, WINDOW_NAME);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(win.windowId)}`);
  await expect(page.getByTestId("surface-tile-tty")).toBeVisible({
    timeout: READY_TIMEOUT,
  });

  const paletteInput = await openPalette(page);
  await paletteInput.fill("Terminal:");

  await expect(
    page.getByRole("option", { name: "Terminal: Download snapshot (HTML)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Terminal: Download transcript" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Terminal: Copy visible screen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Terminal: Download full history" }),
  ).toBeVisible();
});
