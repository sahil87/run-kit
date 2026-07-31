import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { gotoServerReady, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Each test file uses its own session to avoid cross-test interference.
// Tests within this file share the session and execute in order (fullyParallel: false).
const TEST_SESSION = `e2e-sync-${Date.now()}`;

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared snapshot resolver (hoisted to `_ready.ts`) bound to this file's
// server + session. Returns the full snapshot window (`windowId` is the stable
// `@N` handle for DOM selection; the router carries its numeric part).
const resolveWindow = (page: Page, windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);

test.describe("Sidebar Window Sync", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("external window creation appears without page reload", async ({
    page,
  }) => {
    const ts = Date.now();
    const windowName = `ext-win-${ts}`;

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");

    newWindow(TEST_SESSION, windowName);

    // SSE poll interval is 2500ms; 5000ms covers ≥2 full cycles
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("external window rename reflects without page reload", async ({
    page,
  }) => {
    const ts = Date.now();
    const srcName = `rename-src-${ts}`;
    const dstName = `rename-dst-${ts}`;

    newWindow(TEST_SESSION, srcName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Confirm source window is visible before renaming
    await expect(
      sidebar.locator(`text=${srcName}`),
    ).toBeVisible({ timeout: 5_000 });

    execSync(
      `tmux -L ${TMUX_SERVER} rename-window -t "${TEST_SESSION}:${srcName}" "${dstName}"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator(`text=${dstName}`),
    ).toBeVisible({ timeout: 5_000 });

    // Old name should be gone (SSE will have already updated by the time dstName appeared)
    await expect(
      sidebar.locator(`text=${srcName}`),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("clicking a window from the dashboard selects it and updates the URL", async ({
    page,
  }) => {
    const ts = Date.now();
    const winName = `click-win-${ts}`;

    // A second window so the click target is unambiguous and distinct from
    // the session's initial active window.
    newWindow(TEST_SESSION, winName);

    // Land on the server root (the dashboard) — no session/window in the URL.
    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    // Resolve the window's stable identifiers (tmux @id + index) from the API
    // snapshot rather than matching on the display name, which is neither
    // unique nor stable. We select by data-window-id and assert the URL by the
    // window id's numeric part (`@N` sans `@`, i.e. `windowId.slice(1)` — the
    // segment the router carries; parse restores `@N`), NOT the mutable index.
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const windowButton = row.getByRole("button").first();
    await expect(windowButton).toBeVisible({ timeout: 5_000 });

    // Before the click we are on the dashboard: URL has no window segment.
    // (Regression guard for #198, where clicks were pure tmux mutations and
    // the URL writeback could not introduce a window, leaving the dashboard
    // up forever.) The URL segment is the window id's numeric part (@N sans @).
    expect(page.url()).not.toContain(`/${target.windowId.slice(1)}`);

    await windowButton.click();

    // The URL must now carry the clicked window ID on the 2-segment route
    // /$server/$window — this is the core of the fix: the optimistic navigate
    // introduces the window so the terminal route mounts at all. The session is
    // no longer in the URL (derived from the SSE snapshot). The URL segment is
    // the window id's numeric part (`@2` → `2`); parse restores `@N`.
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(target.windowId.slice(1))}(?:$|[/?#])`,
      ),
      { timeout: 5_000 },
    );
    // And the clicked row becomes the selected one.
    await expect(windowButton).toHaveAttribute("aria-current", "page", {
      timeout: 5_000,
    });
  });

  test("clicking a different window switches selection without bounce-back", async ({
    page,
  }) => {
    const ts = Date.now();
    const winA = `switch-a-${ts}`;
    const winB = `switch-b-${ts}`;

    newWindow(TEST_SESSION, winA);
    newWindow(TEST_SESSION, winB);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const targetA = await resolveWindow(page, winA);
    const targetB = await resolveWindow(page, winB);
    const buttonA = sidebar
      .locator(`[data-window-id="${targetA.windowId}"]`)
      .getByRole("button")
      .first();
    const buttonB = sidebar
      .locator(`[data-window-id="${targetB.windowId}"]`)
      .getByRole("button")
      .first();

    await buttonA.click();
    await expect(buttonA).toHaveAttribute("aria-current", "page", {
      timeout: 5_000,
    });

    // Switch to B. The optimistic navigate selects B immediately; the
    // pending-intent guard must keep B selected and NOT let a stale SSE
    // snapshot bounce the selection back to A.
    await buttonB.click();
    await expect(buttonB).toHaveAttribute("aria-current", "page", {
      timeout: 5_000,
    });

    // Give a stale-snapshot bounce a chance to manifest, then assert B held.
    await page.waitForTimeout(1_500);
    await expect(buttonB).toHaveAttribute("aria-current", "page");
    await expect(buttonA).not.toHaveAttribute("aria-current", "page");
    // The 2-segment URL must carry B's window id numeric part (@N sans @), not
    // the session.
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(targetB.windowId.slice(1))}(?:$|[/?#])`,
      ),
    );
  });

  test("kill-then-create at same index does not suppress new window", async ({
    page,
  }) => {
    const ts = Date.now();
    const windowName = `kill-win-${ts}`;
    const newWindowName = `win-new-${ts}`;

    // Create the window to kill
    newWindow(TEST_SESSION, windowName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Confirm the window is visible before killing
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).toBeVisible({ timeout: 5_000 });

    // Ctrl+click performs an instant optimistic kill (no confirm dialog).
    // We use this path because the dialog path relies on a killTargetRef that
    // is reset to null synchronously on handleKill, making it unreliable to
    // observe the "killed entry persists" edge case via the UI.
    // The icon cluster is pointer-events-none at rest (stray-click hardening);
    // hover the row first so group-hover restores interactivity, mirroring how
    // a real cursor reaches the kill button.
    await sidebar.locator(`text=${windowName}`).first().hover();
    await sidebar
      .locator(`button[aria-label="Kill window ${windowName}"]`)
      .click({ modifiers: ["Control"] });

    // Killed window should disappear from the sidebar (optimistic + confirmed)
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible({ timeout: 5_000 });

    // Immediately create a replacement window externally. Tmux commonly
    // assigns the next available index — which may be the same slot the
    // killed window occupied. The store's reconciliation (syncWindows) must
    // not suppress this new window just because a prior windowId was marked
    // killed.
    newWindow(TEST_SESSION, newWindowName);

    await expect(
      sidebar.locator(`text=${newWindowName}`),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible();
  });
});
