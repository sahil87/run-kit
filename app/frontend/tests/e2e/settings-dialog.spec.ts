import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

/**
 * Settings dialog (260723-o7q8; TABBED in 260818-bncw — General / Appearance
 * / Shortcuts, one tablist: left rail ≥480px, horizontal strip below): the
 * VS Code-style dialog mounted once at AppLayout. These tests prove the
 * intake-level behaviors:
 *   1. palette-open on a server route — General by default (name/SSH/
 *      notifications), Appearance carrying theme/accent/font,
 *   2. palette-open on /board/$name (the AppLayout mount's whole point —
 *      the board route renders no AppShell),
 *   3. top-bar gear open (the gear relocated from the sidebar footer to the
 *      top-bar right cluster in 260812-d1at),
 *   4. a host-scoped edit (instance name) persists through the API.
 *   5. 375px: the horizontal tab strip fits, and the tall Shortcuts panel
 *      scrolls INSIDE the fixed-height xl dialog.
 *
 * scripts/test-e2e.sh isolates the tmux server/port but NOT $HOME, so the
 * instance-name write lands in the developer's REAL
 * ~/.config/run-kit/config.yaml — snapshot its raw bytes before the suite
 * and restore them after
 * (byte-identical round-trip; the board-list-reorder.spec.ts pattern).
 */

const SETTINGS_PATH = join(homedir(), ".config", "run-kit", "config.yaml");
let settingsSnapshot: Buffer | undefined;
let settingsExisted = false;

const TEST_SESSION = `e2e-settings-${Date.now()}`;
// Board names are constrained to alphanumeric/-/_ — fresh per run.
const BOARD_NAME = `set${Date.now().toString().slice(-6)}`;
const TEST_INSTANCE_NAME = `e2e-name-${Date.now().toString().slice(-6)}`;

async function openPaletteSettings(page: Page) {
  const paletteInput = page.getByPlaceholder("Type a command");
  // Retry the hotkey: a Meta+K pressed before the global keydown listener
  // attaches (cold dev-server first navigation) is dropped forever — a single
  // long wait on the input can never recover from that.
  await expect(async () => {
    await page.keyboard.press("Meta+k");
    await expect(paletteInput).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await paletteInput.fill("Settings: Open");
  await page.keyboard.press("Enter");
}

function expectDialogOpen(page: Page) {
  return expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
    timeout: 10_000,
  });
}

// Read the stored instance_name from the registry-driven GET /api/settings
// (null when unset).
async function pollInstanceName(page: Page): Promise<string | null> {
  const res = await page.request.get("/api/settings");
  const body = (await res.json()) as { settings: Array<{ key: string; value: unknown }> };
  const entry = body.settings.find((e) => e.key === "instance_name");
  return typeof entry?.value === "string" ? entry.value : null;
}

test.describe("Settings dialog", () => {
  test.beforeAll(() => {
    // Snapshot the developer's REAL ~/.config/run-kit/config.yaml before the
    // suite
    // mutates it via POST /api/settings (instance_name key); restored verbatim after.
    try {
      settingsSnapshot = readFileSync(SETTINGS_PATH);
      settingsExisted = true;
    } catch (err) {
      // Only ENOENT means "no file to restore". Any other read error means
      // the file EXISTS but couldn't be snapshotted — rethrow so afterAll
      // never deletes the developer's real settings on a failed snapshot.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      settingsSnapshot = undefined;
      settingsExisted = false;
    }

    createSession(TEST_SESSION, { windows: ["win-a"] });
  });

  test.afterAll(() => {
    // Restore the settings snapshot even if tests failed.
    try {
      if (settingsExisted && settingsSnapshot !== undefined) {
        writeFileSync(SETTINGS_PATH, settingsSnapshot);
      } else {
        rmSync(SETTINGS_PATH, { force: true });
      }
    } catch {
      // Best-effort
    }
    killSession(TEST_SESSION);
  });

  test("palette opens the dialog on the General tab; the Appearance tab carries the rest (260818-bncw)", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);

    await openPaletteSettings(page);
    await expectDialogOpen(page);

    // General (the tab-less default): instance name + SSH host under This
    // host, notifications under This device. Scope to the dialog: the
    // sidebar HOST panel carries its own accent-picker button with the same
    // accessible name.
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByText("This host")).toBeVisible();
    await expect(dialog.getByText("This device")).toBeVisible();
    await expect(dialog.getByLabel("Instance name")).toBeVisible();
    await expect(dialog.getByLabel("SSH host")).toBeVisible();
    await expect(dialog.getByText("Notifications", { exact: true })).toBeVisible();

    // The Appearance tab keeps its own scope split. The theme control is the
    // shared searchable picker (260819-qkow): at rest a trigger names the
    // ACTIVE theme; clicking it opens the search field with the list in a
    // popover, where both preferred slots (dark + light) carry a check.
    await dialog.getByRole("tab", { name: "Appearance" }).click();
    await expect(dialog.getByRole("button", { name: "Set instance color" })).toBeVisible();
    const themeTrigger = dialog.getByTestId("theme-picker-trigger");
    await expect(themeTrigger).toBeVisible();
    await expect(dialog.getByRole("listbox", { name: "Themes" })).not.toBeVisible();
    await themeTrigger.click();
    await expect(dialog.getByRole("combobox", { name: "Search themes" })).toBeVisible();
    await expect(dialog.getByRole("listbox", { name: "Themes" })).toBeVisible();
    await expect(dialog.getByLabel("Current theme")).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: "Increase terminal font" })).toBeVisible();

    // Escape is layered: with the theme popover open it closes the POPOVER
    // and the dialog stays; a second Escape closes the dialog (keyboard-first
    // contract).
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("listbox", { name: "Themes" })).not.toBeVisible();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).not.toBeVisible();
  });

  test("tabbed preference-pane layout with the Notifications row (260724-6j1v, 260818-bncw)", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);

    await openPaletteSettings(page);
    await expectDialogOpen(page);
    const dialog = page.getByRole("dialog", { name: "Settings" });

    // The xl Dialog variant (max-w-4xl + fixed height) — wider than the old
    // lg pane so the left rail + panel fit side by side.
    await expect(dialog).toHaveClass(/max-w-4xl/);
    await expect(dialog).not.toHaveClass(/max-w-sm/);

    // One tablist markup — the desktop left rail (a vertical tablist at this
    // viewport) with roving tabindex (the active tab is the one Tab stop).
    const tablist = dialog.getByRole("tablist", { name: "Settings sections" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "General" })).toHaveAttribute("tabindex", "0");
    await expect(tablist.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "tabindex",
      "-1",
    );

    // Preference-row grid: each setting is a `190px 1fr` two-column grid at
    // desktop width (label column left, control column right — one vertical
    // rule). Checked on a representative row (Instance name).
    const rowClass = await dialog
      .locator("#settings-instance-name")
      .evaluate((el) => el.closest(".grid")?.className ?? "");
    expect(rowClass).toContain("min-[480px]:grid-cols-[190px_1fr]");

    // Notifications row (moved from the retired top-bar bell) lives under the
    // This-device scope on the General tab: label, subscribed-gated test
    // button, and the setup guide link. Status text varies by browser
    // permission state, so only the state-independent contents are asserted.
    await expect(dialog.getByText("Notifications", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send test notification" })).toBeVisible();
    const guide = dialog.getByRole("link", { name: /Setup & troubleshooting guide/ });
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("href", /docs\/site\/notifications\.md/);
    await expect(guide).toHaveAttribute("target", "_blank");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("short viewport (375x667): the tab strip fits and the tall Shortcuts panel scrolls internally (260724-6j1v, 260818-bncw)", async ({ page }) => {
    // The xl dialog pins a fixed height with panel-level `overflow-hidden` —
    // each tab panel owns its own scroll, so a tall tab must scroll inside
    // the dialog instead of clipping off-screen with no scroll path.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/${TMUX_SERVER}`);
    // No [aria-label='Connected'] gate here: the dot lives in the sidebar
    // footer, and at a mobile viewport the drawer (and dot) is unmounted.
    // The top-bar chevron is the readiness signal instead.
    await expect(page.getByRole("button", { name: "More controls" })).toBeVisible({
      timeout: 10_000,
    });

    await openPaletteSettings(page);
    await expectDialogOpen(page);
    const dialog = page.getByRole("dialog", { name: "Settings" });

    // Geometry: the panel's border box fits entirely inside the viewport.
    const box = await dialog.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);

    // The same tablist markup is the horizontal strip under the title at
    // <480px — all three tabs reachable.
    for (const label of ["General", "Appearance", "Shortcuts"]) {
      await expect(dialog.getByRole("tab", { name: label })).toBeVisible();
    }
    // … and the page itself never gains horizontal overflow.
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBe(false);

    // The Shortcuts tab is the tall panel: its TAB PANEL (not the dialog)
    // overflows and scrolls, and its last element (the reset-all footer) is
    // reachable by scrolling within it.
    await dialog.getByRole("tab", { name: "Shortcuts" }).click();
    await expect(page.getByTestId("settings-shortcuts-panel")).toBeVisible();
    const tabpanel = dialog.getByRole("tabpanel");
    const overflows = await tabpanel.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflows).toBe(true);
    const resetAll = dialog.getByRole("button", { name: "reset all" });
    await resetAll.scrollIntoViewIfNeeded();
    await expect(resetAll).toBeVisible();
    const resetBox = await resetAll.boundingBox();
    expect(resetBox).toBeTruthy();
    expect(resetBox!.y).toBeGreaterThanOrEqual(0);
    expect(resetBox!.y + resetBox!.height).toBeLessThanOrEqual(667);
  });

  test("palette opens the same dialog on /board/$name (no AppShell there)", async ({ page }) => {
    test.setTimeout(30_000);
    // Pin win-a via the API so the board exists (the deterministic path the
    // boards-pin-flow spec established).
    const winId = listWindows(TEST_SESSION).find((w) => w.name === "win-a")?.windowId;
    expect(winId).toBeTruthy();
    const pinRes = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    try {
      await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("win-a").first()).toBeVisible({ timeout: 10_000 });

      await openPaletteSettings(page);
      await expectDialogOpen(page);
      const dialog = page.getByRole("dialog", { name: "Settings" });
      await expect(dialog.getByText("This host")).toBeVisible();
      await expect(dialog.getByText("This device")).toBeVisible();

      // The board shell's `shortcuts-overlay` chord handler resolves the same
      // global entry: ⇧Ctrl+/ switches the open dialog to the Shortcuts tab
      // here too, and re-firing closes (260818-bncw three-state toggle).
      await page.keyboard.press("Shift+Control+Slash");
      await expect(dialog.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByTestId("settings-shortcuts-panel")).toBeVisible();
      // Board route: no session context — the add flow stays gated off and
      // the TMUX section renders its empty state, not a crash/spinner.
      await expect(
        page.getByText("+ bind a key to a palette action or riff preset…"),
      ).toHaveCount(0);
      await expect(page.getByTestId("tmux-section").getByText("No tmux server running")).toBeVisible();
      await page.keyboard.press("Shift+Control+Slash");
      await expect(dialog).toHaveCount(0);
    } finally {
      // Unpin so the board (and its _rk-pin-* session) does not outlive the run.
      await page.request
        .post(`/api/boards/${BOARD_NAME}/unpin`, {
          data: { server: TMUX_SERVER, windowId: winId },
        })
        .catch(() => {});
    }
  });

  test("top-bar gear opens the dialog (Tip-named, no native title)", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);

    // The gear is a top-bar right-cluster chip since 260812-d1at (in-bar at
    // the default desktop viewport; the aria-hidden fit probe copy is excluded
    // from role queries, so this resolves the in-bar chip).
    const gear = page.getByRole("button", { name: "Open settings" });
    await expect(gear).toBeVisible({ timeout: 10_000 });
    // Tip system: no native title attribute on the gear.
    await expect(gear).not.toHaveAttribute("title");

    await gear.click();
    await expectDialogOpen(page);
  });

  test("editing the instance name persists a host-scoped value (and clears)", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);

    await page.getByRole("button", { name: "Open settings" }).click();
    await expectDialogOpen(page);

    const nameInput = page.getByLabel("Instance name");
    await nameInput.fill(TEST_INSTANCE_NAME);
    await nameInput.press("Enter");

    // The commit POSTs to the host — the stored setting is the contract.
    await expect
      .poll(
        async () => {
          const name = await pollInstanceName(page);
          return name;
        },
        { timeout: 5_000 },
      )
      .toBe(TEST_INSTANCE_NAME);

    // The status bar's host segment prefers the override, live (no reload) —
    // the desktop home for the hostname since the HOST panel went drawer-only
    // (260814-ldbs; the drawer panel keeps the same live behavior on mobile).
    await expect(
      page.getByTestId("status-bar-host").getByText(TEST_INSTANCE_NAME),
    ).toBeVisible({ timeout: 5_000 });

    // Clearing the field clears the setting.
    await nameInput.fill("");
    await nameInput.press("Enter");
    await expect
      .poll(
        async () => {
          const name = await pollInstanceName(page);
          return name;
        },
        { timeout: 5_000 },
      )
      .toBeNull();
  });
});
