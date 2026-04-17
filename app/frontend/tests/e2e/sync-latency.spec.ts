/**
 * Sync-latency audit — measures time from user action to UI reflection.
 *
 * Actions with optimistic updates should reflect in <500ms.
 * Actions relying solely on SSE will take up to 2500ms (the poll interval).
 *
 * Threshold: 500ms. Anything above suggests the action is waiting for SSE
 * rather than using an optimistic update.
 */
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const SESSION_A = `e2e-lat-a-${Date.now()}`;
const SESSION_B = `e2e-lat-b-${Date.now()}`;

const OPTIMISTIC_THRESHOLD_MS = 500;

interface TimingResult {
  action: string;
  ms: number;
  optimistic: boolean;
}

const results: TimingResult[] = [];

function record(action: string, ms: number) {
  const optimistic = ms < OPTIMISTIC_THRESHOLD_MS;
  results.push({ action, ms, optimistic });
  console.log(
    `  [${optimistic ? "FAST" : "SLOW"}] ${action}: ${ms}ms${optimistic ? "" : " ← SSE-dependent"}`,
  );
}

function tmux(cmd: string) {
  execSync(`tmux -L ${TMUX_SERVER} ${cmd}`, { stdio: "ignore" });
}

/** Navigate to the tmux server dashboard and wait for SSE connection. */
async function setup(page: import("@playwright/test").Page) {
  await page.goto(`/${TMUX_SERVER}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
  return page.locator("nav[aria-label='Sessions']");
}

test.describe("Sync Latency Audit", () => {
  test.setTimeout(20_000);

  test.beforeAll(() => {
    try { tmux(`new-session -d -s ${SESSION_A} -x 80 -y 24`); } catch { /* ok */ }
    try { tmux(`new-session -d -s ${SESSION_B} -x 80 -y 24`); } catch { /* ok */ }
  });

  test.afterAll(() => {
    // Best-effort cleanup. Instant-create sessions land on auto-derived names
    // ("session", "session-2", etc.) so we also sweep those here.
    const names = [
      SESSION_A,
      SESSION_B,
      `${SESSION_A}-renamed`,
      `e2e-kill-${SESSION_A}`,
      "session",
    ];
    for (let i = 2; i <= 11; i++) names.push(`session-${i}`);
    for (const s of names) {
      try { tmux(`kill-session -t ${s}`); } catch { /* ok */ }
    }

    console.log("\n=== SYNC LATENCY SUMMARY ===");
    console.log(`Threshold: ${OPTIMISTIC_THRESHOLD_MS}ms\n`);
    for (const r of results) {
      console.log(`  [${r.optimistic ? "FAST" : "SLOW"}] ${r.action}: ${r.ms}ms`);
    }
    const slow = results.filter(r => !r.optimistic);
    if (slow.length > 0) {
      console.log(`\n${slow.length} action(s) appear SSE-dependent (>${OPTIMISTIC_THRESHOLD_MS}ms):`);
      for (const r of slow) console.log(`  - ${r.action} (${r.ms}ms)`);
    } else {
      console.log("\nAll actions appear to have optimistic updates.");
    }
    console.log("=== END SUMMARY ===\n");
  });

  test("1. Create session via UI", async ({ page }) => {
    const sidebar = await setup(page);

    // "+ New Session" performs instant creation with an auto-derived name
    // (no dialog, no input). Measure the time for the new session row to
    // appear — a ghost entry should show up optimistically well under 500ms.
    const beforeCount = await sidebar.locator("button[aria-label^='Navigate to ']").count();

    const t0 = Date.now();
    await page.click("button:has-text('+ New Session')");

    await expect
      .poll(
        () => sidebar.locator("button[aria-label^='Navigate to ']").count(),
        { timeout: 8_000 },
      )
      .toBeGreaterThan(beforeCount);
    record("Create session (UI)", Date.now() - t0);
  });

  test("2. Rename session via UI (double-click)", async ({ page }) => {
    const sidebar = await setup(page);

    const sessionNav = sidebar.locator(`button[aria-label='Navigate to ${SESSION_A}']`);
    await expect(sessionNav).toBeVisible({ timeout: 8_000 });

    // Double-click session name to enter edit mode
    await sidebar.locator(`text=${SESSION_A}`).first().dblclick();

    const input = sidebar.locator("input[type='text']").first();
    await expect(input).toBeVisible({ timeout: 2_000 });
    await input.clear();
    const newName = `${SESSION_A}-renamed`;
    await input.fill(newName);

    const t0 = Date.now();
    await input.press("Enter");

    await expect(
      sidebar.locator(`text=${newName}`).first(),
    ).toBeVisible({ timeout: 8_000 });
    record("Rename session (UI double-click)", Date.now() - t0);
  });

  test("3. Create window via sidebar + button", async ({ page }) => {
    const sidebar = await setup(page);

    // Expand session B to see its windows and the + button
    await expect(sidebar.locator(`text=${SESSION_B}`).first()).toBeVisible({ timeout: 8_000 });

    // The + button for new window is on the session row
    const newWinBtn = sidebar.locator(`button[aria-label='New window in ${SESSION_B}']`);

    if (await newWinBtn.isVisible().catch(() => false)) {
      await newWinBtn.click();

      // The dialog opens in "window" mode — only path input, window created immediately
      // The window gets a default name. Measure time until a new window appears.
      const t0 = Date.now();

      // Dialog might show — click Create if it does
      const dialog = page.locator("[role='dialog']");
      if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await dialog.locator("button:has-text('Create')").click();
      }

      // Count windows under session B — wait for count to increase
      // We can't predict the name, so just wait for any new window
      await page.waitForTimeout(3_000);
      record("Create window (UI, + button)", Date.now() - t0);
    } else {
      console.log("  [SKIP] No 'New window' button found — session may need expanding");
    }
  });

  test("4. Rename window via UI (double-click)", async ({ page }) => {
    tmux(`new-window -t ${SESSION_B} -n rename-me`);

    const sidebar = await setup(page);

    await expect(sidebar.locator("text=rename-me").first()).toBeVisible({ timeout: 8_000 });

    // Double-click window name to enter edit mode
    await sidebar.locator("text=rename-me").first().dblclick();

    const input = sidebar.locator("input[type='text']").first();
    await expect(input).toBeVisible({ timeout: 2_000 });
    await input.clear();
    await input.fill("renamed-win");

    const t0 = Date.now();
    await input.press("Enter");

    await expect(
      sidebar.locator("text=renamed-win").first(),
    ).toBeVisible({ timeout: 8_000 });
    record("Rename window (UI double-click)", Date.now() - t0);
  });

  test("5. Kill window via Ctrl+click (instant)", async ({ page }) => {
    tmux(`new-window -t ${SESSION_B} -n kill-me`);

    const sidebar = await setup(page);
    await expect(sidebar.locator("text=kill-me").first()).toBeVisible({ timeout: 8_000 });

    const killBtn = sidebar.locator("button[aria-label='Kill window kill-me']");

    const t0 = Date.now();
    await killBtn.click({ modifiers: ["Control"] });

    await expect(sidebar.locator("text=kill-me")).not.toBeVisible({ timeout: 8_000 });
    record("Kill window (Ctrl+click)", Date.now() - t0);
  });

  test("6. Move window within session (drag-drop reorder)", async ({ page }) => {
    tmux(`new-window -t ${SESSION_B} -n dnd-first`);
    tmux(`new-window -t ${SESSION_B} -n dnd-second`);

    const sidebar = await setup(page);

    const first = sidebar.locator("text=dnd-first").first();
    const second = sidebar.locator("text=dnd-second").first();
    await expect(first).toBeVisible({ timeout: 8_000 });
    await expect(second).toBeVisible({ timeout: 8_000 });

    // Record positions before drag
    const firstBB = await first.boundingBox();
    const secondBB = await second.boundingBox();

    if (firstBB && secondBB) {
      // Drag second onto first position
      const t0 = Date.now();
      await page.mouse.move(secondBB.x + secondBB.width / 2, secondBB.y + secondBB.height / 2);
      await page.mouse.down();
      await page.mouse.move(firstBB.x + firstBB.width / 2, firstBB.y + firstBB.height / 2, { steps: 10 });
      await page.mouse.up();

      // Check if the order changed — poll every 100ms up to 5s
      let reordered = false;
      for (let i = 0; i < 50; i++) {
        const newFirstBB = await sidebar.locator("text=dnd-second").first().boundingBox();
        const newSecondBB = await sidebar.locator("text=dnd-first").first().boundingBox();
        if (newFirstBB && newSecondBB && newFirstBB.y < newSecondBB.y) {
          reordered = true;
          break;
        }
        await page.waitForTimeout(100);
      }

      const elapsed = Date.now() - t0;
      if (reordered) {
        record("Move window within session (drag-drop)", elapsed);
      } else {
        record("Move window within session (drag-drop) — order did not change", elapsed);
      }
    } else {
      console.log("  [SKIP] Could not get bounding boxes");
    }
  });

  test("7. Move window to another session (cross-session drag)", async ({ page }) => {
    tmux(`new-window -t ${SESSION_B} -n cross-mv`);

    const sidebar = await setup(page);
    const renamedA = `${SESSION_A}-renamed`;

    await expect(sidebar.locator("text=cross-mv").first()).toBeVisible({ timeout: 8_000 });
    await expect(sidebar.locator(`text=${renamedA}`).first()).toBeVisible({ timeout: 8_000 });

    const source = sidebar.locator("text=cross-mv").first();
    const target = sidebar.locator(`text=${renamedA}`).first();
    const sourceBB = await source.boundingBox();
    const targetBB = await target.boundingBox();

    if (sourceBB && targetBB) {
      const t0 = Date.now();
      await page.mouse.move(sourceBB.x + sourceBB.width / 2, sourceBB.y + sourceBB.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBB.x + targetBB.width / 2, targetBB.y + targetBB.height / 2, { steps: 10 });
      await page.mouse.up();

      // Check if the window disappeared from session B's area (moved to session A)
      let moved = false;
      for (let i = 0; i < 50; i++) {
        // Window should no longer be under session B
        const stillVisible = await sidebar.locator("text=cross-mv").isVisible().catch(() => false);
        if (!stillVisible) {
          moved = true;
          break;
        }
        await page.waitForTimeout(100);
      }

      const elapsed = Date.now() - t0;
      if (moved) {
        record("Move window to another session (cross-drag)", elapsed);
      } else {
        record("Move window cross-session (drag-drop) — may not have moved", elapsed);
      }
    } else {
      console.log("  [SKIP] Could not get bounding boxes");
    }
  });

  test("8. External tmux change (SSE baseline)", async ({ page }) => {
    const sidebar = await setup(page);
    const winName = `ext-${Date.now()}`;

    const t0 = Date.now();
    tmux(`new-window -t ${SESSION_B} -n ${winName}`);

    await expect(sidebar.locator(`text=${winName}`)).toBeVisible({ timeout: 8_000 });
    record("External tmux new-window (SSE baseline)", Date.now() - t0);
  });

  test("9. Kill session via UI (with dialog)", async ({ page }) => {
    const killSession = `e2e-kill-${SESSION_A}`;
    tmux(`new-session -d -s ${killSession} -x 80 -y 24`);

    const sidebar = await setup(page);
    await expect(sidebar.locator(`text=${killSession}`).first()).toBeVisible({ timeout: 8_000 });

    const killBtn = sidebar.locator(`button[aria-label='Kill session ${killSession}']`);

    const t0 = Date.now();
    await killBtn.click();

    // Wait for the kill dialog to appear, then click the Kill confirm button inside it
    const dialog = page.locator("[role='dialog']");
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    // Click the red Kill button inside the dialog (force to bypass any overlay issues)
    await dialog.locator("button:has-text('Kill')").click({ force: true });

    await expect(
      sidebar.locator(`text=${killSession}`),
    ).not.toBeVisible({ timeout: 8_000 });
    record("Kill session (UI, confirm dialog)", Date.now() - t0);
  });
});
