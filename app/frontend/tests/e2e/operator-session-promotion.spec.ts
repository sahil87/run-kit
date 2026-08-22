import { test, expect } from "@playwright/test";
import { gotoServerReady, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session per file to avoid cross-test interference (fullyParallel: false).
const TEST_SESSION = `e2e-oppromote-${Date.now()}`;
const OPERATOR_SESSION = "_rk-operator";

/** POST the partial-merge window-options body the palette client uses. */
async function setRole(
  page: Parameters<typeof gotoServerReady>[0],
  windowId: string,
  role: string | null,
) {
  return page.request.post(
    `/api/windows/${encodeURIComponent(windowId)}/options?server=${encodeURIComponent(TMUX_SERVER)}`,
    { data: { options: { "@rk_role": role } } },
  );
}

test.describe("Operator session physical promotion (skcr)", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
    killSession(OPERATOR_SESSION);
  });

  test("promote hides the operator session + moves the window out of its work group; pinned row navigates; demote reappears under a visible group", async ({
    page,
  }) => {
    const ts = Date.now();
    const opName = `operator-${ts}`;
    // A sibling keeps the work session alive after the operator window moves out.
    newWindow(TEST_SESSION, `worker-${ts}`);
    newWindow(TEST_SESSION, opName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, TMUX_SERVER, TEST_SESSION, opName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const workGroupRow = page.locator(
      `[data-session-group="${TEST_SESSION}"] [data-window-id="${target.windowId}"]`,
    );

    // Fresh window: an ordinary row inside its work group; no operator session.
    await expect(row).toHaveCount(1, { timeout: 5_000 });
    await expect(workGroupRow).toHaveCount(1);
    await expect(page.locator(`[data-session-group="${OPERATOR_SESSION}"]`)).toHaveCount(0);

    // Promote via the same options POST route the palette commands use.
    const setRes = await setRole(page, target.windowId, "operator");
    expect(setRes.ok(), "setting @rk_role=operator via the options API").toBeTruthy();

    // The work group no longer lists the operator window (membership MOVED,
    // so tmux window-cycling traverses only the remaining windows — the
    // traversal-order fix is exactly this membership change).
    await expect(workGroupRow).toHaveCount(0, { timeout: 6_000 });
    // The content-hidden operator session renders no session group …
    await expect(page.locator(`[data-session-group="${OPERATOR_SESSION}"]`)).toHaveCount(0);
    // … but the pinned operator row still renders exactly once, above the work group.
    await expect(row).toHaveCount(1);
    const rowBox = await row.boundingBox();
    const workBox = await page.locator(`[data-session-group="${TEST_SESSION}"]`).boundingBox();
    expect(rowBox, "pinned row box").toBeTruthy();
    expect(workBox, "work group box").toBeTruthy();
    expect(rowBox!.y).toBeLessThan(workBox!.y);

    // The pinned row navigates to the operator window on activation.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/${target.windowId.slice(1)}$`), { timeout: 5_000 });

    // Demote (null per the partial-merge contract): the window moves OUT to a
    // visible conventional session group and the pinned slot disappears.
    const clearRes = await setRole(page, target.windowId, null);
    expect(clearRes.ok(), "clearing @rk_role via the options API").toBeTruthy();
    await expect(page.locator(`[data-session-group="${OPERATOR_SESSION}"]`)).toHaveCount(0, {
      timeout: 6_000,
    });
    // The window reappears under a visible session group (its cwd-basename
    // session) — exactly once, no longer pinned.
    await expect(row).toHaveCount(1, { timeout: 6_000 });
    const reappearedGroup = page.locator(
      `[data-session-group] [data-window-id="${target.windowId}"]`,
    );
    await expect(reappearedGroup).toHaveCount(1);
  });
});
