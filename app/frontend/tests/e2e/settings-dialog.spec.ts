import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Settings dialog (260723-o7q8): the VS Code-style dialog mounted once at
 * AppLayout. These tests prove the four intake-level behaviors:
 *   1. palette-open on a server route with the This-host/This-device split,
 *   2. palette-open on /board/$name (the AppLayout mount's whole point —
 *      the board route renders no AppShell),
 *   3. sidebar-footer gear open,
 *   4. a host-scoped edit (instance name) persists through the API.
 *
 * scripts/test-e2e.sh isolates the tmux server/port but NOT $HOME, so the
 * instance-name write lands in the developer's REAL ~/.rk/settings.yaml —
 * snapshot its raw bytes before the suite and restore them after
 * (byte-identical round-trip; the board-list-reorder.spec.ts pattern).
 */

const SETTINGS_PATH = join(homedir(), ".rk", "settings.yaml");
let settingsSnapshot: Buffer | undefined;
let settingsExisted = false;

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-settings-${Date.now()}`;
// Board names are constrained to alphanumeric/-/_ — fresh per run.
const BOARD_NAME = `set${Date.now().toString().slice(-6)}`;
const TEST_INSTANCE_NAME = `e2e-name-${Date.now().toString().slice(-6)}`;

async function openPaletteSettings(page: Page) {
  const paletteInput = page.getByPlaceholder("Type a command...");
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

test.describe("Settings dialog", () => {
  test.beforeAll(() => {
    // Snapshot the developer's REAL ~/.rk/settings.yaml before the suite
    // mutates it via /api/settings/instance-name; restored verbatim after.
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

    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
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
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

  test("palette opens the dialog on a server route with the This-host/This-device split", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    await openPaletteSettings(page);
    await expectDialogOpen(page);

    // Scope split — both labeled sections render with their controls. Scope
    // to the dialog: the sidebar HOST panel carries its own accent-picker
    // button with the same accessible name.
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByText("This host")).toBeVisible();
    await expect(dialog.getByText("This device")).toBeVisible();
    await expect(dialog.getByLabel("Instance name")).toBeVisible();
    await expect(dialog.getByLabel("SSH host")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Set instance color" })).toBeVisible();
    await expect(dialog.getByLabel("Dark theme")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Increase terminal font" })).toBeVisible();

    // Escape closes (keyboard-first contract).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).not.toBeVisible();
  });

  test("desktop preference-pane layout with the Notifications row (260724-6j1v)", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    await openPaletteSettings(page);
    await expectDialogOpen(page);
    const dialog = page.getByRole("dialog", { name: "Settings" });

    // Wide lg Dialog variant (~672px) instead of the phone-card max-w-sm.
    await expect(dialog).toHaveClass(/max-w-2xl/);
    await expect(dialog).not.toHaveClass(/max-w-sm/);

    // Preference-row grid: each setting is a `190px 1fr` two-column grid at
    // desktop width (label column left, control column right — one vertical
    // rule). Checked on a representative row (Instance name).
    const rowClass = await dialog
      .locator("#settings-instance-name")
      .evaluate((el) => el.closest(".grid")?.className ?? "");
    expect(rowClass).toContain("min-[480px]:grid-cols-[190px_1fr]");

    // Notifications row (moved from the retired top-bar bell) lives under the
    // This-device scope: label, subscribed-gated test button, and the setup
    // guide link. Status text varies by browser permission state, so only the
    // state-independent contents are asserted.
    await expect(dialog.getByText("Notifications", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send test notification" })).toBeVisible();
    const guide = dialog.getByRole("link", { name: /Setup & troubleshooting guide/ });
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("href", /docs\/site\/notifications\.md/);
    await expect(guide).toHaveAttribute("target", "_blank");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("short viewport (375x667): the dialog fits and its last row is reachable by scroll (260724-6j1v)", async ({ page }) => {
    // The lg settings pane grew taller than a phone-landscape/short viewport;
    // the Dialog panel must cap its height and scroll instead of clipping
    // off-screen with no scroll path (rework finding M1).
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

    // The panel itself is the scroll container (its content overflows) …
    const overflows = await dialog.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflows).toBe(true);

    // … and the LAST row's control (the Notifications setup-guide link) is
    // reachable by scrolling within the panel.
    const guide = dialog.getByRole("link", { name: /Setup & troubleshooting guide/ });
    await guide.scrollIntoViewIfNeeded();
    await expect(guide).toBeVisible();
    const guideBox = await guide.boundingBox();
    expect(guideBox).toBeTruthy();
    expect(guideBox!.y).toBeGreaterThanOrEqual(0);
    expect(guideBox!.y + guideBox!.height).toBeLessThanOrEqual(667);
  });

  test("palette opens the same dialog on /board/$name (no AppShell there)", async ({ page }) => {
    test.setTimeout(30_000);
    // Pin win-a via the API so the board exists (the deterministic path the
    // boards-pin-flow spec established).
    const winId = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
    )
      .toString()
      .trim()
      .split("\n")
      .find((line) => line.endsWith(":win-a"))
      ?.split(":")[0];
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
    } finally {
      // Unpin so the board (and its _rk-pin-* session) does not outlive the run.
      await page.request
        .post(`/api/boards/${BOARD_NAME}/unpin`, {
          data: { server: TMUX_SERVER, windowId: winId },
        })
        .catch(() => {});
    }
  });

  test("sidebar footer gear opens the dialog (Tip-named, no native title)", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    const gear = page.getByRole("button", { name: "Open settings" });
    await expect(gear).toBeVisible({ timeout: 10_000 });
    // Tip system: no native title attribute on the gear.
    await expect(gear).not.toHaveAttribute("title");

    await gear.click();
    await expectDialogOpen(page);
  });

  test("editing the instance name persists a host-scoped value (and clears)", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Open settings" }).click();
    await expectDialogOpen(page);

    const nameInput = page.getByLabel("Instance name");
    await nameInput.fill(TEST_INSTANCE_NAME);
    await nameInput.press("Enter");

    // The commit POSTs to the host — the stored setting is the contract.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/settings/instance-name");
          const body = (await res.json()) as { name: string | null };
          return body.name;
        },
        { timeout: 5_000 },
      )
      .toBe(TEST_INSTANCE_NAME);

    // The HOST panel hostname line prefers the override, live (no reload).
    await expect(
      page.locator("nav[aria-label='Sessions']").getByText(TEST_INSTANCE_NAME),
    ).toBeVisible({ timeout: 5_000 });

    // Clearing the field clears the setting.
    await nameInput.fill("");
    await nameInput.press("Enter");
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/settings/instance-name");
          const body = (await res.json()) as { name: string | null };
          return body.name;
        },
        { timeout: 5_000 },
      )
      .toBeNull();
  });
});
