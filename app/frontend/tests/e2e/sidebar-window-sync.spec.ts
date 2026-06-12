import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Each test file uses its own session to avoid cross-test interference.
// Tests within this file share the session and execute in order (fullyParallel: false).
const TEST_SESSION = `e2e-sync-${Date.now()}`;

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a window's stable identifiers from the backend snapshot by its
 * (transient) display name. Returns the tmux window id (`@N`, unique for the
 * window's lifetime — both the handle for DOM selection AND the segment the
 * router now carries in `/$server/$window`) and the tmux window index
 * (retained for diagnostics; addressing is by id). Polls because the window is
 * created via the tmux CLI and surfaces in the snapshot asynchronously.
 */
async function resolveWindow(
  page: Page,
  windowName: string,
): Promise<{ windowId: string; index: number }> {
  const deadline = Date.now() + 5_000;
  let last: { windowId: string; index: number } | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; index: number; name: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        last = { windowId: win.windowId, index: win.index };
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(last, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return last!;
}

test.describe("Sidebar Window Sync", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
  });

  test("external window creation appears without page reload", async ({
    page,
  }) => {
    const ts = Date.now();
    const windowName = `ext-win-${ts}`;

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${windowName}"`,
      { stdio: "ignore" },
    );

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

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${srcName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

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
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winName}"`,
      { stdio: "ignore" },
    );

    // Land on the server root (the dashboard) — no session/window in the URL.
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");
    // Resolve the window's stable identifiers (tmux @id + index) from the API
    // snapshot rather than matching on the display name, which is neither
    // unique nor stable. We select by data-window-id and assert the URL by
    // index (the segment the router actually carries).
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const windowButton = row.getByRole("button").first();
    await expect(windowButton).toBeVisible({ timeout: 5_000 });

    // Before the click we are on the dashboard: URL has no window segment.
    // (Regression guard for #198, where clicks were pure tmux mutations and
    // the URL writeback could not introduce a window, leaving the dashboard
    // up forever.)
    expect(page.url()).not.toContain(
      `/${encodeURIComponent(target.windowId)}`,
    );

    await windowButton.click();

    // The URL must now carry the clicked window ID (@N) on the 2-segment route
    // /$server/$window — this is the core of the fix: the optimistic navigate
    // introduces the window so the terminal route mounts at all. The session is
    // no longer in the URL (derived from the SSE snapshot). The router
    // percent-encodes the `@` in the path segment (`@2` → `%402`), so the
    // assertion matches the encoded form that appears in the address bar.
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(encodeURIComponent(target.windowId))}(?:$|[/?#])`,
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

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winA}"`,
      { stdio: "ignore" },
    );
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winB}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);
    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

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
    // The 2-segment URL must carry B's window id (@N), not the session.
    await expect(page).toHaveURL(
      new RegExp(
        `/${TMUX_SERVER}/${escapeRegExp(encodeURIComponent(targetB.windowId))}(?:$|[/?#])`,
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
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${windowName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

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
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${newWindowName}"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator(`text=${newWindowName}`),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible();
  });
});
