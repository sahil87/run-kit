import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-present-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// Proxy-rewritten URLs — the iframe `src` is deterministic regardless of
// whether a real server listens there (assertions are on render, never on
// iframe content). A and B differ so the dismissal latch's value-exact
// matching is exercised by a genuine re-present.
const URL_A = "http://localhost:8080/";
const URL_B = "http://localhost:8081/";

// The `tmux set-option -w @rk_url` write is invisible to the control-mode
// parser, so on a quiet server the guaranteed pickup is the 12s safety
// ticker — the auto-open assertions budget well past it.
const PRESENT_TIMEOUT = 30_000;

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Stamp (or clear, `null`) `@rk_url` on a window — exactly the write path
 *  `rk present`'s default arm takes. */
function setWindowUrl(windowId: string, url: string | null): void {
  const args = url === null
    ? ["-L", TMUX_SERVER, "set-option", "-w", "-u", "-t", windowId, "@rk_url"]
    : ["-L", TMUX_SERVER, "set-option", "-w", "-t", windowId, "@rk_url", url];
  execFileSync("tmux", args, { stdio: "ignore" });
}

/** Create a window and return its @N id. `cwd: "/tmp"` keeps the window
 *  NON-repo so the code surface stays unavailable and the layout starts at a
 *  deterministic `single:tty`. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name, { cwd: "/tmp" });
  return resolveWindow(page, name);
}

/** Navigate to a window's terminal route and wait for the SSE connection.
 *  Desktop gate: the status bar's dot — the sidebar footer's own dot is
 *  mobile-only since 260815-19me (the right-panel.spec.ts pattern). */
async function gotoWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(
    page.getByTestId("status-bar").locator("[aria-label='Connected']"),
  ).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const iframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();
// The top-bar SurfaceToggleGroup's web open-tile toggle — its PRESENCE tracks
// `rkUrl` availability (the client's proof the SSE snapshot carrying the value
// has landed), its `aria-pressed` tracks the open tile.
const webTileToggle = (page: Page) => page.getByRole("button", { name: "Web tile" });

/** Wait until the CLIENT has applied a snapshot that resolves this window on
 *  the TERMINAL ROUTE: the tty tile's `role="application"` aria-label embeds
 *  the SSE-derived session name, so its full form proves `currentWindow`
 *  resolved — the auto-expand effect initializes from that same snapshot, and
 *  a `set-option` issued after this gate is always an OBSERVED transition,
 *  never a cold first read. (The sidebar row is NOT sufficient — it renders
 *  from an earlier, shallower payload.) */
async function awaitSnapshotReady(page: Page, windowId: string): Promise<void> {
  await expect(
    page.getByRole("application", { name: `Terminal: ${TEST_SESSION}/${windowId}` }),
  ).toBeVisible({ timeout: PRESENT_TIMEOUT });
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Present auto-expand — rk present transiently opens the web tile", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("rkUrl set while viewing auto-opens the web tile with no URL/localStorage write", async ({
    page,
  }) => {
    // The set-option write rides the 12s safety ticker worst-case; the suite's
    // 10s per-test cap can't absorb that (the surface-layout.spec.ts
    // setTimeout precedent).
    test.setTimeout(90_000);
    const id = await makeWindow(page, `pa-open-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // Cold entry resolved `single:tty` (the default) — mirrored as a clean URL.
    expect(new URL(page.url()).searchParams.get("layout")).toBeNull();
    // The client's first snapshot has landed (sidebar row renders from it), so
    // the auto-expand effect has initialized with rkUrl empty.
    await awaitSnapshotReady(page, id);

    // The present-default-arm write, observed via the SSE snapshot.
    setWindowUrl(id, URL_A);
    await expect(webTileToggle(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
    await expect(iframe(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
    await expect(terminal(page)).toBeVisible();

    // Transient, never a mutation: the URL stays clean and no `rk-layout:`
    // key is written — only the top-bar web toggle reflects the (rendered)
    // open tile.
    expect(new URL(page.url()).searchParams.get("layout")).toBeNull();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("rk-layout:")),
      ),
    ).toEqual([]);
    await expect(webTileToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("closing the auto-opened tile latches the value; a different value re-triggers", async ({
    page,
  }) => {
    // Three present-arm writes, each potentially riding the 12s safety ticker.
    test.setTimeout(120_000);
    const id = await makeWindow(page, `pa-latch-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await awaitSnapshotReady(page, id);

    setWindowUrl(id, URL_A);
    await expect(iframe(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });

    // Dismiss via the tile's ✕ — a user mutation (persists `single:tty`) that
    // latches URL_A against re-opening. The tile stays MOUNTED but hidden
    // (SurfaceLayout's everOpened set), so the assertion is visibility.
    await page.getByRole("button", { name: "Close Web" }).click();
    await expect(iframe(page)).toBeHidden();

    // Unset, then re-set the SAME value — the empty→URL_A transition matches
    // the latch, so no re-open. The web toggle's disappearance/reappearance
    // proves the client observed both writes before the assertion.
    setWindowUrl(id, null);
    await expect(webTileToggle(page)).toHaveCount(0, { timeout: PRESENT_TIMEOUT });
    setWindowUrl(id, URL_A);
    await expect(webTileToggle(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
    await expect(webTileToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(iframe(page)).toBeHidden();

    // A DIFFERENT value (a re-present carries a fresh timestamp) passes the
    // latch and re-opens.
    setWindowUrl(id, URL_B);
    await expect(iframe(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
  });

  test("cold arrival with rkUrl already set never auto-opens", async ({ page }) => {
    test.setTimeout(60_000);
    const id = await makeWindow(page, `pa-cold-${Date.now()}`);
    setWindowUrl(id, URL_A);

    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    // The web toggle proves the snapshot carrying rkUrl has landed — and the
    // ladder alone resolved `single:tty`: no iframe, a clean URL, an unlit
    // (available-but-closed) toggle.
    await expect(webTileToggle(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
    await expect(iframe(page)).toHaveCount(0);
    await expect(webTileToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(new URL(page.url()).searchParams.get("layout")).toBeNull();
  });
});
