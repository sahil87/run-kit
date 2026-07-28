import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-webview-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
// Since 260722-n2n4 the ViewSwitcher registry entry is MENU-ONLY: the segmented
// pill never renders in-bar at ANY width, and the per-view `View:` menuitemradio
// rows in the "More controls" chevron menu are the switcher's only rendering.
// Lens switching in this suite therefore routes through the menu rows (or
// `?view=` deep links where the lens itself is under test). The generous 1440px
// desktop width predates the flag (it cleared the pre-n2n4 pill's drop
// threshold) and remains a valid "everything fits" width.
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/heading/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; name: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        id = win.windowId;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return id!;
}

/** Create a window and (optionally) stamp @rk_url / @rk_type directly via tmux —
 *  the same window-option seam the backend tmux test uses. Returns the @N id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { url?: string; iframeType?: boolean } = {},
): Promise<string> {
  execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
    stdio: "ignore",
  });
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
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: 10_000,
  });
}

const iframe = (page: Page) => page.getByTitle("Proxied content");
const terminal = (page: Page) => page.locator(".xterm").first();

// The switcher's menu-only surface (260722-n2n4): the chevron menu's per-view
// `View:` rows. There is no in-bar pill — `inBarSwitcher` must always be empty.
const menuButton = (page: Page) =>
  page.getByRole("button", { name: "More controls" });
const controlsMenu = (page: Page) =>
  page.getByRole("menu", { name: "More controls" });
const viewRow = (page: Page, label: "Terminal" | "Web") =>
  controlsMenu(page).getByRole("menuitemradio", { name: `View: ${label}` });
const inBarSwitcher = (page: Page) =>
  page.getByRole("group", { name: "Window view" });

/** Open the chevron menu, click the `View: {label}` row, and wait for the menu
 *  to close (a `menuitemradio` activation is a single-shot menu action). */
async function switchLens(page: Page, label: "Terminal" | "Web"): Promise<void> {
  await menuButton(page).click();
  const row = viewRow(page, label);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(controlsMenu(page)).toBeHidden();
}

/** Open the chevron menu and assert the `View: {label}` row's checked state —
 *  the menu row is the lens indicator now — then Escape-close the menu. */
async function expectLensMarked(
  page: Page,
  label: "Terminal" | "Web",
  checked: boolean,
): Promise<void> {
  await menuButton(page).click();
  const row = viewRow(page, label);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute("aria-checked", String(checked));
  await page.keyboard.press("Escape");
  await expect(controlsMenu(page)).toBeHidden();
}

test.beforeAll(() => {
  try {
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
      { stdio: "ignore" },
    );
  } catch {
    // Session may already exist.
  }
});

test.afterAll(() => {
  try {
    execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
      stdio: "ignore",
    });
  } catch {
    // Best effort.
  }
});

test.describe("Web view lens — iframe as a per-viewer lens", () => {
  // Default every test in this describe to a wide desktop width — the
  // distinguishing menu-only case (260722-n2n4): the bar has room, yet the
  // switcher lives only in the chevron menu. The mobile test overrides this to
  // 375px at its own start.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("the `View:` menu rows appear only on a web-capable window (no in-bar pill ever)", async ({ page }) => {
    // A plain terminal window (no @rk_url) offers only tty → the multi-view gate
    // fails, so the chevron menu carries no `View:` rows.
    const plain = await makeWindow(page, `wv-plain-${Date.now()}`);
    await gotoWindow(page, plain);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await menuButton(page).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(
      controlsMenu(page).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A window with @rk_url offers tty + web → the `View: Terminal` and
    // `View: Web` rows render in the menu — and there is STILL no in-bar pill
    // (menuOnly: no bar slot, no probe copy, no `view-toggle` testid anywhere).
    const web = await makeWindow(page, `wv-cap-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, web);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    await menuButton(page).click();
    await expect(viewRow(page, "Terminal")).toBeVisible({ timeout: 10_000 });
    await expect(viewRow(page, "Web")).toBeVisible();
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

    // Flip to web via the menu's `View: Web` row → iframe renders, URL carries
    // ?view=web.
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\?view=web/);

    // Flip back to tty via `View: Terminal` → terminal renders, ?view dropped.
    await switchLens(page, "Terminal");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\?view=/);

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
    // Cold load resolves straight to the web lens; the menu's `View: Web` row is
    // the lens indicator (marked aria-checked).
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLensMarked(page, "Web", true);
    // The center heading is a STATIC `Window:` in every lens (260714-uco1 — the
    // heading no longer follows the lens; the marked `View:` menu row, asserted
    // above, is the lens indicator). The hierarchy ▾ splits the prefix between
    // the word and its colon (`Window ▾:`), so assert the word run ("Window").
    await expect(page.getByText("Window", { exact: true })).toBeVisible();
  });

  test("?view=web on a window with no @rk_url falls back to the terminal", async ({
    page,
  }) => {
    // No url → web is unavailable → the unavailable deep link degrades to tty.
    const id = await makeWindow(page, `wv-nourl-${Date.now()}`);
    await gotoWindow(page, id, "web");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(iframe(page)).toHaveCount(0);
    // Single available view → no `View:` rows in the menu.
    await menuButton(page).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(
      controlsMenu(page).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("legacy @rk_type=iframe window defaults to web with the `View: Web` row marked", async ({
    page,
  }) => {
    const id = await makeWindow(page, `wv-legacy-${Date.now()}`, {
      url: IFRAME_URL,
      iframeType: true,
    });
    // No ?view param, no localStorage → the iframe-typed default hint wins → web.
    await gotoWindow(page, id);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await menuButton(page).click();
    await expect(viewRow(page, "Terminal")).toBeVisible({ timeout: 10_000 });
    const webRow = viewRow(page, "Web");
    await expect(webRow).toBeVisible();
    await expect(webRow).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  test("last-view persists across a window switch away and back", async ({
    page,
  }) => {
    const a = await makeWindow(page, `wv-persist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `wv-persist-b-${Date.now()}`);

    // On A, switch to web via the menu row (writes localStorage + ?view=web).
    await gotoWindow(page, a);
    await switchLens(page, "Web");
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click), not a
    // page.goto — this exercises the R6 search-param drop through the router
    // seam (`navigateToWindow`), guarding against a future retainSearchParams /
    // router-upgrade regression that would silently carry `?view=web` onto B.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar
      .locator(`[data-window-id="${b}"]`)
      .getByRole("button")
      .first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();

    // Selection settles on B — the client-side switch was accepted.
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    // B resolves independently to tty, and the outgoing `?view=web` was dropped
    // by the router seam (R6) — not carried onto B.
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\?view=/);

    // Back to A WITHOUT a ?view param — the persisted last-view (web) resolves.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(a)}`);
    await expect(iframe(page)).toBeVisible({ timeout: 10_000 });
    await expectLensMarked(page, "Web", true);
  });

  test("375px mobile: the switcher is reachable via the menu rows; menu-only at desktop too", async ({
    page,
  }) => {
    // 260722-n2n4: the switcher is menu-only at EVERY width — at 375px with a
    // realistically long window name the `View:` rows in the "More controls"
    // chevron menu are its rendering (the heading keeps its room), and unlike
    // the former space-driven contract (260717-6anu) the pill does NOT return to
    // the bar at desktop width. The lens itself still resolves + renders on
    // mobile without horizontal overflow.
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

    // No in-bar pill (menuOnly — no bar slot, no probe copy).
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    // The switcher is reachable in the chevron menu as per-view rows; the active
    // (web) row is marked.
    await menuButton(page).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(viewRow(page, "Terminal")).toBeVisible();
    const webRow = viewRow(page, "Web");
    await expect(webRow).toBeVisible();
    await expect(webRow).toHaveAttribute("aria-checked", "true");
    // Close the menu before the resize assertion.
    await page.keyboard.press("Escape");

    // No horizontal page overflow at 375px.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // Menu-only, not space-driven: at desktop width the pill does NOT return to
    // the bar — the `View:` rows remain the switching surface.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(page.getByText("Window", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(inBarSwitcher(page)).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    await expectLensMarked(page, "Web", true);
  });
});
