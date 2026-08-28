import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gotoServerReady, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session per file to avoid cross-test interference (fullyParallel: false).
const TEST_SESSION = `e2e-operator-${Date.now()}`;

// The operator window gets a unique temp-dir cwd so its demote destination —
// role-clear moves the window out of `_rk-operator` into the session named
// after its active pane's cwd BASENAME (260822-skcr physical promotion), NOT
// back to its original session — is a deterministic, collision-free session.
const OP_CWD = mkdtempSync(join(tmpdir(), "rk-e2e-demote-"));
const DEST_SESSION = basename(OP_CWD);

/** POST the partial-merge window-options body the palette client uses. */
async function setRole(
  page: Parameters<typeof gotoServerReady>[0],
  windowId: string,
  role: string | null,
) {
  return page.request.post(
    `/api/windows/${encodeURIComponent(windowId)}/options?server=${encodeURIComponent(TMUX_SERVER)}`,
    { data: { options: { "@rk_win_role": role } } },
  );
}

test.describe("Operator pinned row (@rk_win_role)", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
    // The demote destination session (cwd-basename) is created by role-clear.
    killSession(DEST_SESSION);
    rmSync(OP_CWD, { recursive: true, force: true });
  });

  test("marking a window operator pins its row above the session groups and removes it from its own group; unmarking restores", async ({
    page,
  }) => {
    const ts = Date.now();
    const opName = `operator-${ts}`;
    newWindow(TEST_SESSION, `worker-${ts}`);
    newWindow(TEST_SESSION, opName, { cwd: OP_CWD });

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, TMUX_SERVER, TEST_SESSION, opName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const groupRow = page.locator(
      `[data-session-group="${TEST_SESSION}"] [data-window-id="${target.windowId}"]`,
    );

    // Fresh window: an ordinary row inside its session group, no pinned row.
    await expect(row).toHaveCount(1, { timeout: 5_000 });
    await expect(groupRow).toHaveCount(1);

    // Mark via the same options POST route the palette commands use.
    const setRes = await setRole(page, target.windowId, "operator");
    expect(setRes.ok(), "setting @rk_win_role=operator via the options API").toBeTruthy();

    // Move-don't-copy: the row leaves its session group and renders exactly
    // once — pinned ABOVE the session group (a smaller y than the group box).
    await expect(groupRow).toHaveCount(0, { timeout: 6_000 });
    await expect(row).toHaveCount(1);
    const rowBox = await row.boundingBox();
    const groupBox = await page.locator(`[data-session-group="${TEST_SESSION}"]`).boundingBox();
    expect(rowBox, "pinned row box").toBeTruthy();
    expect(groupBox, "session group box").toBeTruthy();
    expect(rowBox!.y).toBeLessThan(groupBox!.y);

    // The pinned row does not participate in window drag-reorder.
    await expect(row).toHaveAttribute("draggable", "false");

    // Unmark (null per the partial-merge contract): demotion moves the window
    // out of `_rk-operator` into the session named after its pane cwd's
    // BASENAME (created on demand) — NOT back to its original session
    // (260822-skcr physical promotion). The pinned slot disappears entirely
    // and the row reappears as an ordinary in-group row of the destination.
    const clearRes = await setRole(page, target.windowId, null);
    expect(clearRes.ok(), "clearing @rk_win_role via the options API").toBeTruthy();
    const destRow = page.locator(
      `[data-session-group="${DEST_SESSION}"] [data-window-id="${target.windowId}"]`,
    );
    await expect(destRow).toHaveCount(1, { timeout: 6_000 });
    await expect(groupRow).toHaveCount(0);
    await expect(row).toHaveCount(1);
    const restoredRowBox = await row.boundingBox();
    const restoredGroupBox = await page
      .locator(`[data-session-group="${DEST_SESSION}"]`)
      .boundingBox();
    expect(restoredRowBox!.y).toBeGreaterThan(restoredGroupBox!.y);
  });
});
