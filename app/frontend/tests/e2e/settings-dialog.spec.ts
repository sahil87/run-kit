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
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command...");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
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
