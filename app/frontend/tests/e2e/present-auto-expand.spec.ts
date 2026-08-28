import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";
import { stubProxyPorts } from "./_web-tile";

// Present auto-expand (docs/specs/surface-layout.md R7/L3 carve-out): a
// viewer MOUNTED on a window's terminal route that observes the window's
// rkUrl TRANSITION (the `rk present` default-arm write) sees the `web` tile
// open TRANSIENTLY — no `?layout=` mirror, no `rk-layout:` localStorage
// write — while cold route entry never auto-opens and a dismissed value
// stays dismissed until the value changes.
//
// Shared setup: beforeEach route-stubs /proxy/8080/** and /proxy/8081/**
// (stubProxyPorts, _web-tile.ts) with a static 200 page — the dead-port error
// state hides the iframe when nothing listens on the stamped URL, and these
// tests assert tile chrome, never frame content. Runs against the isolated
// rk-test-e2e socket (E2E_TMUX_SERVER). beforeAll creates one dedicated
// session `e2e-present-<ts>` (80×24) so this file never collides with other
// specs (fullyParallel off); afterAll kills it best-effort. The describe's
// beforeEach sets a wide desktop viewport (1440×800) — the `Connected`
// readiness dot is read from the status bar (getByTestId("status-bar")); the
// sidebar footer's own dot is mobile-only. setWindowUrl(id, url | null)
// stamps or clears @rk_win_url via tmux set-option -w — exactly the write
// path `rk present`'s default arm takes; the write is invisible to the
// control-mode parser, so every post-write assertion budgets PRESENT_TIMEOUT
// (30s) to clear the 12s SSE safety ticker on a quiet server.
// makeWindow(name) creates a window with cwd: "/tmp" (NON-repo → code
// unavailable → a deterministic single:tty start) and returns the @N id.
// awaitSnapshotReady(page, id) waits for the tty tile's role="application"
// aria-label to carry the SSE-derived session name — proof the route's
// currentWindow resolved, so the auto-expand effect has initialized before
// the test writes @rk_win_url (the write is always an OBSERVED transition,
// never a cold first read; the sidebar row renders from an earlier, shallower
// payload and is NOT sufficient). Locators: the `Proxied content` iframe, the
// `.xterm` terminal surface, and the top-bar SurfaceToggleGroup's `Web tile`
// toggle — its PRESENCE tracks rkUrl availability (proof the SSE snapshot
// carrying the value landed on the client), its aria-pressed tracks the open
// tile. Every flow peaks at 2 tiles (tty + web).
const TEST_SESSION = `e2e-present-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// Proxy-rewritten URLs — the iframe `src` is deterministic regardless of
// whether a real server listens there (assertions are on render, never on
// iframe content). A and B differ so the dismissal latch's value-exact
// matching is exercised by a genuine re-present.
const URL_A = "http://localhost:8080/";
const URL_B = "http://localhost:8081/";

// The `tmux set-option -w @rk_win_url` write is invisible to the control-mode
// parser, so on a quiet server the guaranteed pickup is the 12s safety
// ticker — the auto-open assertions budget well past it.
const PRESENT_TIMEOUT = 30_000;

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Stamp (or clear, `null`) `@rk_win_url` on a window — exactly the write path
 *  `rk present`'s default arm takes. */
function setWindowUrl(windowId: string, url: string | null): void {
  const args = url === null
    ? ["-L", TMUX_SERVER, "set-option", "-w", "-u", "-t", windowId, "@rk_win_url"]
    : ["-L", TMUX_SERVER, "set-option", "-w", "-t", windowId, "@rk_win_url", url];
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

// The dead-port error state (260819-v6y4 R8) hides the iframe when nothing
// listens on 8080/8081 — these tests assert tile chrome, never frame content, so
// the proxy path is route-stubbed live (see _web-tile.ts).
test.beforeEach(async ({ page }) => {
  await stubProxyPorts(page, 8080, 8081);
});

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

  /**
   * Proves: the transition-observed trigger and the transient render-time
   * composition — the web tile appears beside the terminal while the resolved
   * layout, the URL, and localStorage all stay `single:tty`-clean.
   *
   * Steps:
   * 1. Create a window, navigate to its route, assert the terminal renders
   *    and the URL carries no `?layout=`; wait for the snapshot-readiness
   *    gate.
   * 2. tmux set-option -w @rk_win_url <URL_A> (the present-default-arm
   *    write).
   * 3. Assert the web iframe becomes visible beside the still-visible
   *    terminal.
   * 4. Assert the URL still carries no `?layout=` and localStorage has no
   *    `rk-layout:` key; assert the top-bar `Web tile` toggle is pressed.
   */
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

  /**
   * Proves: the dismissal latch — closing the auto-opened tile suppresses
   * re-opening for THAT EXACT rkUrl value (unset + re-set), while a different
   * value (a re-present's fresh timestamp) re-triggers.
   *
   * Steps:
   * 1. Create a window, navigate, wait for the snapshot-readiness gate, set
   *    @rk_win_url to URL_A; assert the iframe opens.
   * 2. Close the web tile via its ✕ (`Close Web`); assert the iframe is
   *    HIDDEN (the tile stays mounted-but-hidden via SurfaceLayout's
   *    everOpened set).
   * 3. Unset @rk_win_url; assert the top-bar `Web tile` toggle's corner dot
   *    drops (web is always available, so the toggle stays RENDERED — its dot
   *    is the content signal, proving the client observed the clear).
   * 4. Re-set the SAME URL_A; assert the dot returns with the toggle
   *    UNPRESSED and the iframe stays HIDDEN (the empty→URL_A transition
   *    matched the latch).
   * 5. Set a DIFFERENT URL_B; assert the iframe re-opens (latch
   *    pass-through).
   */
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
    // the latch, so no re-open. The web toggle stays RENDERED throughout
    // (web is always available, 260821-zqlq) — its corner dot is the content
    // signal: it drops with the unset and returns with the re-set, proving
    // the client observed both writes before the assertion.
    setWindowUrl(id, null);
    await expect(webTileToggle(page).locator("span.rounded-full")).toHaveCount(0, {
      timeout: PRESENT_TIMEOUT,
    });
    setWindowUrl(id, URL_A);
    await expect(webTileToggle(page).locator("span.rounded-full")).toHaveCount(1, {
      timeout: PRESENT_TIMEOUT,
    });
    await expect(webTileToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(iframe(page)).toBeHidden();

    // A DIFFERENT value (a re-present carries a fresh timestamp) passes the
    // latch and re-opens.
    setWindowUrl(id, URL_B);
    await expect(iframe(page)).toBeVisible({ timeout: PRESENT_TIMEOUT });
  });

  /**
   * Proves: cold route entry is ladder-only — a reload/deep link onto a
   * window whose @rk_win_url is already set renders `single:tty`, not the web
   * tile.
   *
   * Steps:
   * 1. Create a window and stamp @rk_win_url BEFORE navigating.
   * 2. Navigate to its route; assert the terminal renders.
   * 3. Assert the top-bar `Web tile` toggle is visible (the snapshot carrying
   *    rkUrl landed) but UNPRESSED, the iframe is absent, and the URL carries
   *    no `?layout=`.
   */
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
