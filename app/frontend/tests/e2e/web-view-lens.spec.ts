import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webview-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// The ViewSwitcher is RETIRED (260812-0c6o): on desktop the palette's
// `View: …` actions are the ONLY lens-switch surface (plus the top-bar
// open-tile toggles for non-hidden surfaces); on MOBILE the `View:` entries
// are superseded by the top-bar switch group and its `Tile: Switch to
// <Surface>` palette twin — the chevron menu carries no `View:` rows and the
// `view-toggle` testid exists nowhere. Lens switching in this suite therefore
// routes through the palette (or `?view=` deep links where the lens itself is
// under test). The generous 1440px desktop width remains a valid
// "everything fits" width.
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/heading/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and (optionally) stamp @rk_url / @rk_type directly via tmux —
 *  the same window-option seam the backend tmux test uses. `cwd: "/tmp"` makes
 *  the window NON-repo (no gitRoot → code unavailable) — the deterministic
 *  single-view (tty-only) case; a repo-cwd window is code-capable since k3vp,
 *  so "plain" assertions must not rely on the gitRoot probe's timing.
 *  Returns the @N id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { url?: string; iframeType?: boolean; cwd?: string } = {},
): Promise<string> {
  newWindow(TEST_SESSION, name, { cwd: opts.cwd });
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execSync(
      `tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_url "${opts.url}"`,
      { stdio: "ignore" },
    );
  }
  if (opts.iframeType) {
    execSync(`tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_type iframe`, {
      stdio: "ignore",
    });
  }
  return id;
}

/** Navigate to a window's terminal route (optionally with a view param) and wait
 *  for the SSE connection. */
async function gotoWindow(
  page: Page,
  windowId: string,
  // Only `web` is a supported deep-link value; `tty` is the ABSENCE of the
  // param (the router drops any non-`web` value), so it is never passed here.
  view?: "web",
): Promise<void> {
  const q = view ? `?view=${view}` : "";
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${q}`);
  await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const iframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

/** Assert the mirrored `?layout=` param (decoded — the router may
 *  percent-encode `:`/`,`). The surface-layout shim (260812-ab5v) translates
 *  `?view=X` → `single:X` at route entry and REWRITES the URL via
 *  replaceState, so URL assertions key off `layout`, never `view`. Retrying:
 *  the mirror lands a beat after the arrival/switch that triggered it. */
async function expectLayoutParam(page: Page, expected: string | null): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("layout"), { timeout: 10_000 })
    .toBe(expected);
}

// The retired switcher leaves no surface in the top bar — lens switching is
// palette-only (260812-0c6o). `inBarSwitcher`/`view-toggle` must always be
// empty; the chevron menu never carries `View:` lens rows.
const controlsMenu = (page: Page) =>
  page.getByRole("menu", { name: "More controls" });
const inBarSwitcher = (page: Page) =>
  page.getByRole("group", { name: "Window view" });

/** Open the command palette, fill the query, and return the input. */
async function openPalette(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill(query);
  return paletteInput;
}

/** Switch the lens via the palette's `View: {label}` action. */
async function switchLens(page: Page, label: "Terminal" | "Web"): Promise<void> {
  await openPalette(page, `View: ${label}`);
  const option = page.getByRole("option", { name: `View: ${label}` });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Web view lens — iframe as a per-viewer lens", () => {
  // Default every test in this describe to a wide desktop width — the
  // distinguishing menu-only case (260722-n2n4): the bar has room, yet the
  // switcher lives only in the chevron menu. The mobile test overrides this to
  // 375px at its own start.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("lens switching is palette-only — the palette gates on capability, the menu carries no `View:` rows (260812-0c6o)", async ({ page }) => {
    // A plain window (no @rk_url, NON-repo cwd so code is unavailable too)
    // offers only tty → the palette has no `View: Web` action.
    const plain = await makeWindow(page, `wv-plain-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A window with @rk_url offers tty + web → the palette's `View: Web` action
    // renders — and there is STILL no in-bar pill and no `view-toggle` testid
    // anywhere; the chevron menu carries no `View:` lens rows (the retired
    // switcher's removal).
    const web = await makeWindow(page, `wv-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(
      controlsMenu(page).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("flipping web↔tty preserves the window and never POSTs an option mutation", async ({
    page,
  }) => {
    const name = `wv-flip-${Date.now()}`;
    const id = await makeWindow(page, name, { url: IFRAME_URL });

    // Record any window-option mutation (the retired @rk_type flip). A view
    // switch must NEVER hit /options.
    const optionPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/windows\/.*\/options/.test(req.url())) {
        optionPosts.push(req.url());
      }
    });

    // Default view for an untyped (non-iframe) window with a url is tty.
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Flip to web via the palette's `View: Web` action → iframe renders; R12's
    // shim turns the selection into `single:web` and the URL mirrors `?layout=`.
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");

    // Flip back to tty via `View: Terminal` → terminal renders as `single:tty`.
    await switchLens(page, "Terminal");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // The window still exists in the snapshot (never destroyed) and its id is
    // unchanged — a view switch mutates neither identity nor options.
    const stillId = await resolveWindow(page, name);
    expect(stillId).toBe(id);
    expect(
      optionPosts,
      `no /options POST on a view switch; got ${optionPosts.join(", ")}`,
    ).toHaveLength(0);
  });

  test("deep link ?view=web cold-loads the iframe", async ({ page }) => {
    const id = await makeWindow(page, `wv-deep-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "web");
    // Cold load resolves straight to the web lens (the shim maps ?view=web →
    // single:web and the URL mirror rewrites it).
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");
    // The center heading is a STATIC `Window:` in every lens (260714-uco1 — the
    // heading no longer follows the lens). The prefix run is contiguous
    // (260813-kvk7 removed the hierarchy ▾ that used to split it), so assert
    // the whole `Window:` run.
    await expect(page.getByText("Window:", { exact: true })).toBeVisible();
  });

  test("?view=web on a window with no @rk_url falls back to the terminal", async ({
    page,
  }) => {
    // No url AND a non-repo cwd → neither web nor code is available → the
    // unavailable deep link degrades to tty and the window is single-view.
    const id = await makeWindow(page, `wv-nourl-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id, "web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(iframe(page)).toHaveCount(0);
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)
    // Single available view → the palette offers no `View: Web` action.
    await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("legacy @rk_type=iframe window defaults to web (ladder hint rung)", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wv-legacy-${Date.now()}`, {
      url: IFRAME_URL,
      iframeType: true,
    });
    // No ?view param, no localStorage → the iframe-typed default hint wins →
    // single:web (ladder rung 3 in the layout model). It is this window's
    // DEFAULT, so the mirror leaves the URL clean (param dropped) — exactly
    // the retired @rk_type behavior (bare URL rendered the iframe).
    await gotoWindow(page, id);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null);
    // The palette is the way back: `View: Terminal` is offered (web is current).
    await openPalette(page, "View: Terminal");
    await expect(page.getByRole("option", { name: "View: Terminal" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("last-view persists across a window switch away and back", async ({
    page,
  }) => {
    const a = await makeWindow(page, `wv-persist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `wv-persist-b-${Date.now()}`);

    // On A, switch to web via the palette (writes the rk-layout localStorage
    // key + mirrors ?layout=single:web — R12's shim: a view selection is a
    // single-tile layout mutation).
    await gotoWindow(page, a);
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click), not a
    // page.goto — this exercises the R6 search-param drop through the router
    // seam (`navigateToWindow`), guarding against a future retainSearchParams /
    // router-upgrade regression that would silently carry A's layout onto B.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar
      .locator(`[data-window-id="${b}"]`)
      .getByRole("button")
      .first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();

    // Selection settles on B — the client-side switch was accepted.
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    // B resolves independently to single:tty, and the outgoing layout param was
    // dropped by the router seam (R6) — not carried onto B.
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // Back to A WITHOUT a layout param — the persisted per-window layout
    // (single:web, localStorage rung) resolves.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(a)}`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");
  });

  test("375px mobile: the switch group + `Tile: Switch` palette entries are the lens switchers; no switcher chrome at any width", async ({
    page,
  }) => {
    // At 375px with a realistically long window name the heading keeps its
    // room WITH the switch group present (the retained single-line /
    // no-overflow contract), `View:` palette entries are superseded by
    // `Tile: Switch to <Surface>` on mobile only, and the pill never renders
    // anywhere. The lens itself still resolves + renders on mobile without
    // horizontal overflow.
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await makeWindow(page, `wv-mobile-long-worktree-name-${Date.now()}`, {
      url: IFRAME_URL,
    });
    // Do NOT gate on the `Connected` dot here: it lives in the sidebar footer
    // (260724-6j1v), and at 375px the sidebar is an unmounted drawer, so the
    // dot never becomes visible (same reason window-heading.spec.ts's mobile
    // test gates on the heading, not the dot).
    // Gate directly on the iframe — the thing under test.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?view=web`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // No in-bar pill, no probe copy — the testid exists nowhere.
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);

    // The top-bar switch group renders with the VISIBLE surface (web)
    // pressed; its palette twin lists `Tile: Switch to Terminal` and the
    // mobile palette carries NO `View:` LENS entries (superseded — other
    // `View:` entries like Fixed Width remain).
    const banner = page.getByRole("banner");
    const ttyToggle = banner.getByRole("button", { name: "Terminal tile", exact: true });
    const webToggle = banner.getByRole("button", { name: "Web tile", exact: true });
    await expect(webToggle).toHaveAttribute("aria-pressed", "true", {
      timeout: READY_TIMEOUT,
    });
    await expect(ttyToggle).toHaveAttribute("aria-pressed", "false");
    const paletteInput = await openPalette(page, "View: Web");
    await expect(page.getByRole("option", { name: "View: Web", exact: true })).toHaveCount(0);
    await paletteInput.fill("Switch");
    const switchToTty = page.getByRole("option", { name: "Tile: Switch to Terminal" });
    await expect(switchToTty).toBeVisible({ timeout: 10_000 });
    // Switch back to tty via the palette twin — tty is NOT open in
    // `single:web`, so the verb runs the persisting arm.
    await switchToTty.click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // The one-tap phone flow: from `single:tty` the top-bar Web button
    // switches to the available-but-not-open web surface through the
    // PERSISTING arm — `single:web` lands in the URL mirror.
    await webToggle.click();
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "single:web");

    // No horizontal page overflow at 375px (with the group present and the
    // long window name).
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Still no switcher chrome at desktop width either — and the desktop
    // palette keeps its `View:` entries with NO `Tile: Switch` ones.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(page.getByText("Window:", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    const desktopPaletteInput = await openPalette(page, "View: Terminal");
    await expect(
      page.getByRole("option", { name: "View: Terminal" }),
    ).toBeVisible({ timeout: 10_000 });
    await desktopPaletteInput.fill("Switch");
    await expect(
      page.getByRole("option", { name: /^Tile: Switch to / }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
