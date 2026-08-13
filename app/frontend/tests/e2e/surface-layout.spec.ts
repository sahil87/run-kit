import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Surface-layout core e2e (260812-ab5v-surface-layout-core; spec
// docs/specs/surface-layout.md, plan tasks T016). Covers the resolution ladder
// (URL `?layout=` > localStorage `rk-layout:` > hint > `single:tty`), the
// permanent `?view=`/`?panel=` translation shim, tile verbs + rail toggles
// (the ONLY 3-tile test in the file — the plaintext origin's h1 connection
// pool is 6 slots, so every other flow stays at ≤2 tiles, per the spec's
// Performance note), refresh/window-switch/history semantics (L2–L4), divider
// ratio persistence (R5), the mobile slot-A + sheet-tabs branch (R13), and —
// from 260812-wfic — the focused-tile accent border (R2) and the tty-scoped
// split-chord gate (R8). See surface-layout.spec.md for intent + steps.

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-surflayout-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

// A URL that the proxy converts to a same-origin `/proxy/<port>/…` path — the
// iframe `src` is deterministic regardless of whether a real server listens
// there (we assert on chrome/layout/render, never on iframe content).
const IFRAME_URL = "http://localhost:8080/";

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window and (optionally) stamp @rk_url via tmux (execFileSync with
 *  argument arrays — no shell string construction). Windows inherit the tmux
 *  server's repo-root cwd, so every window here is code-capable (gitRoot
 *  derived). Returns the @N id. */
async function makeWindow(page: Page, name: string, opts: { url?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name);
  const id = await resolveWindow(page, name);
  if (opts.url !== undefined) {
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_url", opts.url]);
  }
  return id;
}

/** The window's live tmux pane count (the split-chord gate's ground truth). */
function paneCount(windowId: string): number {
  return Number(
    execFileSync("tmux", ["-L", TMUX_SERVER, "display-message", "-t", windowId, "-p", "#{window_panes}"])
      .toString()
      .trim(),
  );
}

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the SSE connection. Desktop-only gate (the `Connected` dot lives
 *  in the sidebar footer — the mobile test gates on the terminal instead). */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

/** Assert the mirrored `?layout=` param (decoded — the router may
 *  percent-encode `:`/`,`). Retrying: the replaceState mirror lands a beat
 *  after the mutation/arrival that triggered it. */
async function expectLayoutParam(page: Page, expected: string | null): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("layout"), { timeout: 10_000 })
    .toBe(expected);
}

const rail = (page: Page) => page.getByTestId("right-panel-rail");
const railButton = (page: Page, label: "Terminal" | "Web" | "Code") =>
  rail(page).getByRole("button", { name: `${label} tile` });
const tile = (page: Page, kind: "tty" | "web" | "code", occ = 1) =>
  page.getByTestId(`surface-tile-${kind}${occ > 1 ? `-${occ}` : ""}`);
const divider = (page: Page, index = 0) => page.getByTestId(`surface-divider-${index}`);
const terminal = (page: Page) => page.locator(".xterm").first();
const webIframe = (page: Page) => page.getByTitle("Proxied content");

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  // Cold-boot warm-up (the code-surface precedent): when this file runs
  // standalone, the first test would otherwise pay Vite's cold transform of
  // the app + xterm graph INSIDE its budget. A throwaway terminal-route load
  // in beforeAll (outside the per-test budget) absorbs it.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Surface layout — ladder, verbs, history, ratios, mobile", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("legacy ?view=code&panel=web deep link resolves to split-h:code,web (shim, A-016)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-shim-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id, "?view=code&panel=web");

    // The translation shim maps the retired params to split-h:code,web (view in
    // slot A) and the URL is REWRITTEN via replaceState to the mirrored
    // ?layout= form (R2) — the legacy params are gone.
    await expectLayoutParam(page, "split-h:code,web");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBeNull();
    // Both tiles render: the code tile (a repo-cwd window is code-capable) and
    // the web tile with its proxied iframe.
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible();
    await expect(webIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
  });

  test("build a 3-tile layout via rail toggles; promote/swap/close verbs mutate (shape, order) in the URL (A-017)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // The ONE bounded 3-tile test in this file (h1 6-slot pool discipline).
    const id = await makeWindow(page, `sl-verbs-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Rail toggles grow the layout: 1→2 split-h, 2→3 main-left (R10).
    const webRail = railButton(page, "Web");
    const codeRail = railButton(page, "Code");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeRail).toBeVisible({ timeout: READY_TIMEOUT });

    await webRail.click();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(webRail).toHaveAttribute("aria-pressed", "true");

    await codeRail.click();
    await expectLayoutParam(page, "main-left:tty,web,code");
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(codeRail).toHaveAttribute("aria-pressed", "true");

    // ◧ Promote on the code tile: slot A becomes code, the rest permute
    // unchanged (shape untouched) — hover first (the verbs are visible at
    // rest since 260812-wfic; the hover still exercises the hover affordance).
    await tile(page, "code").hover();
    await tile(page, "code").getByRole("button", { name: "Promote Code" }).click();
    await expectLayoutParam(page, "main-left:code,tty,web");

    // ⇄ Swap on the tty tile: exchanges with the NEXT neighbor (web).
    await tile(page, "tty").hover();
    await tile(page, "tty").getByRole("button", { name: "Swap Terminal" }).click();
    await expectLayoutParam(page, "main-left:code,web,tty");

    // ✕ Close on the web tile: the layout collapses 3→2 (split-h), order kept.
    await tile(page, "web").hover();
    await tile(page, "web").getByRole("button", { name: "Close Web" }).click();
    await expectLayoutParam(page, "split-h:code,tty");
    await expect(tile(page, "web")).toBeHidden();
    await expect(tile(page, "code")).toBeVisible();
    await expect(terminal(page)).toBeVisible();
    // The rail toggle reflects the close (web unlit again).
    await expect(webRail).toHaveAttribute("aria-pressed", "false");
  });

  test("a user-built layout restores from localStorage on a bare re-arrival (ladder rung 2)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-persist-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);

    // A user mutation (rail toggle) writes rk-layout:{server}:{@N} AND mirrors
    // the URL.
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // Re-arrive via a FULL load of the BARE route (no ?layout= carried) — the
    // URL rung is empty, so the localStorage rung must supply the layout.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(terminal(page)).toBeVisible();
    // …and the resolved layout is mirrored back into the URL.
    await expectLayoutParam(page, "split-h:tty,web");
  });

  test("window switch A→B→A restores each window's own layout (A-012)", async ({ page }) => {
    test.setTimeout(40_000);
    const a = await makeWindow(page, `sl-switch-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `sl-switch-b-${Date.now()}`);

    // On A, build split-h:tty,web (a user mutation → localStorage write).
    await gotoWindow(page, a);
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expectLayoutParam(page, "split-h:tty,web");
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // Switch to B via a REAL client-side navigation (sidebar row click) —
    // internal nav targets the BARE route; B resolves independently (never
    // customized → hint/default rung → single:tty).
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar.locator(`[data-window-id="${b}"]`).getByRole("button").first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(0);
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // Back to A via the sidebar (bare route again) — A's stored layout
    // resolves and is mirrored into the URL.
    const rowA = sidebar.locator(`[data-window-id="${a}"]`).getByRole("button").first();
    await rowA.click();
    await expect(rowA).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");
  });

  test("back/forward restore historical layouts; layout tweaks add NO history entries (L4)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const a = await makeWindow(page, `sl-hist-a-${Date.now()}`, { url: IFRAME_URL });
    const b = await makeWindow(page, `sl-hist-b-${Date.now()}`);

    // History: [E0 server route] → [E1 window A] → (rail toggle: replaceState,
    // E1 updated in place) → [E2 window B via sidebar push].
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await gotoWindow(page, a);
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expectLayoutParam(page, "split-h:tty,web");

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const rowB = sidebar.locator(`[data-window-id="${b}"]`).getByRole("button").first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();
    await expect(rowB).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // Back → the A entry carries the layout it had when the viewer LEFT (rung 1
    // honors it) — split-h:tty,web renders again.
    await page.goBack();
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");

    // Forward → B's entry restores its own (single:tty).
    await page.goForward();
    await expectLayoutParam(page, null); // default layout mirrors as a CLEAN URL (param dropped)

    // Back twice more: past A, straight to the E0 server route. If the rail
    // toggle had PUSHED an entry, the second back would land on a stale
    // pre-mutation A URL instead — the replaceState discipline (L4) is what
    // makes the window route disappear from history here.
    await page.goBack();
    await expectLayoutParam(page, "split-h:tty,web");
    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe(`/${TMUX_SERVER}`);
  });

  test("a divider drag persists the ratio across reload and never touches the URL (R5)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-ratio-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // The split-h divider starts at the equal split (50).
    const div = divider(page, 0);
    await expect(div).toHaveAttribute("aria-valuenow", "50");
    const box = await div.boundingBox();
    expect(box).not.toBeNull();

    // Drag 150px RIGHT — ratio 0 (the slot-A share) grows. Tiles stay live
    // mid-drag (no suspension/unmount — the board pane-resize bug class).
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    const xtermBefore = await terminal(page).elementHandle();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 75, startY, { steps: 3 });
    await page.mouse.move(startX + 150, startY, { steps: 3 });
    await page.mouse.up();

    let dragged: number | null = null;
    await expect
      .poll(async () => {
        dragged = Number(await div.getAttribute("aria-valuenow"));
        return dragged;
      })
      .toBeGreaterThan(50);
    // The terminal stayed MOUNTED (same xterm element) through the drag.
    const xtermAfter = await terminal(page).elementHandle();
    expect(await page.evaluate(([x, y]) => x === y, [xtermBefore, xtermAfter])).toBe(true);
    // Ratios never appear in the URL — the layout string is untouched by a drag.
    await expectLayoutParam(page, "split-h:tty,web");

    // The ratio persists per (window, shape): a bare reload resolves the same
    // layout AND the dragged divider position.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(divider(page, 0)).toHaveAttribute("aria-valuenow", String(dragged), {
      timeout: 10_000,
    });
  });

  test("Ctrl+` is inert (binding removed, 260813-j3jb); the ⛶ verb toggles the slot-A zoom", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-zoom-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expectLayoutParam(page, "split-h:tty,web");

    // The Ctrl+` layout-zoom binding is REMOVED (it collides with code-server's
    // own Ctrl+`): the chord must fall through untouched — no zoom, both tiles
    // stay. Focus the terminal first, the spot the old chord interception won.
    await terminal(page).click();
    await page.keyboard.press("Control+`");
    await page.waitForTimeout(500);
    await expect(tile(page, "web")).toBeVisible();
    await expect(divider(page, 0)).toBeVisible();

    // Zoom still works through the tile's ⛶ verb: slot A (tty) goes
    // full-center — the web tile hides (display-level, still mounted) and the
    // divider leaves.
    await page.getByRole("button", { name: "Zoom Terminal", exact: true }).click();
    await expect(tile(page, "web")).toBeHidden({ timeout: 10_000 });
    await expect(tile(page, "web")).toHaveCount(1);
    await expect(divider(page, 0)).toHaveCount(0);
    await expect(terminal(page)).toBeVisible();
    // Zoom is transient (R6): the URL is untouched.
    await expectLayoutParam(page, "split-h:tty,web");

    // Unzoom via the same verb (now labeled Unzoom) — both tiles and the
    // divider return.
    await page.getByRole("button", { name: "Unzoom Terminal", exact: true }).click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });
    await expect(divider(page, 0)).toBeVisible();
  });

  test("375px mobile: a 3-tile ?layout= URL renders slot A + sheet tabs for the rest (R13, A-018)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(MOBILE_VIEWPORT);
    const id = await makeWindow(page, `sl-mobile-${Date.now()}`, { url: IFRAME_URL });
    // Do NOT gate on the `Connected` dot: it lives in the sidebar footer, and
    // at 375px the sidebar is an unmounted drawer. Gate on the terminal.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=main-left:tty,code,web`);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Slot A (tty) renders full-width; the other resolved surfaces stay
    // mounted-hidden (no multi-tile grid, no dividers below the threshold).
    await expect(tile(page, "tty")).toBeVisible();
    await expect(tile(page, "code")).toBeHidden();
    await expect(tile(page, "web")).toBeHidden();
    await expect(divider(page, 0)).toHaveCount(0);
    // No rail on mobile (desktop-only), but the ▦ Surfaces chip appears because
    // MORE THAN ONE surface is open.
    await expect(rail(page)).toHaveCount(0);
    const chip = page.getByTestId("mobile-surfaces-chip");
    // READY_TIMEOUT: on a cold deep link the multi-surface layout (and so the
    // chip) resolves only once the window payload lands with rkUrl/gitRoot.
    await expect(chip).toBeVisible({ timeout: READY_TIMEOUT });

    // The sheet exposes every open surface as a tab, slot A marked pressed.
    await chip.click();
    const sheet = page.getByTestId("mobile-surface-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("mobile-surface-tab-tty")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("mobile-surface-tab-code")).toBeVisible();
    await expect(page.getByTestId("mobile-surface-tab-web")).toBeVisible();

    // Selecting the Code tab swaps the mobile slot-A surface — TRANSIENT: the
    // URL (and the desktop arrangement it encodes) is untouched.
    await page.getByTestId("mobile-surface-tab-code").click();
    await expect(sheet).toBeHidden();
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });
    await expect(tile(page, "tty")).toBeHidden();
    await expectLayoutParam(page, "main-left:tty,code,web");
  });

  test("the focused-tile accent border follows clicks across tiles (260812-wfic R2, A-013)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sl-focus-${Date.now()}`, { url: IFRAME_URL });
    await gotoWindow(page, id);
    const webRail = railButton(page, "Web");
    await expect(webRail).toBeVisible({ timeout: READY_TIMEOUT });
    await webRail.click();
    await expect(tile(page, "web")).toBeVisible({ timeout: 10_000 });

    // Default focus = slot A (tty): its framed border reads accent-green, the
    // web tile's stays the default border color.
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "web")).toHaveClass(/border-border/);

    // Click the web tile (its header — the focus seam is pointerdown-capture
    // anywhere in the tile) → the accent border moves.
    await tile(page, "web").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "web")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "tty")).not.toHaveClass(/border-accent-green/);

    // Click back into the tty tile → the border returns.
    await tile(page, "tty").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await expect(tile(page, "web")).not.toHaveClass(/border-accent-green/);
  });

  test("the split chord is tty-scoped: inert with the code tile focused, splits with tty focused (260812-wfic R8, A-014)", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const id = await makeWindow(page, `sl-ttyonly-${Date.now()}`);
    await gotoWindow(page, id);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });

    // Open the code tile (every window here is code-capable — repo-root cwd).
    const codeRail = railButton(page, "Code");
    await expect(codeRail).toBeVisible({ timeout: READY_TIMEOUT });
    await codeRail.click();
    await expect(tile(page, "code")).toBeVisible({ timeout: 10_000 });

    const before = paneCount(id);
    expect(before).toBe(1);

    // Focus the CODE tile (header click) — the accent border confirms the
    // gate's input. The split chord (⇧Ctrl+\ on this Linux host) must fall
    // through untouched: NO split, pane count unchanged.
    await tile(page, "code").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "code")).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Shift+Control+Backslash");
    // Give a would-be split a beat to land — then assert nothing happened.
    await page.waitForTimeout(750);
    expect(paneCount(id)).toBe(before);

    // Focus the tty tile — the SAME chord splits exactly as today (the
    // tty-focused path is byte-equivalent to the pre-gate behavior).
    await tile(page, "tty").click({ position: { x: 6, y: 15 } });
    await expect(tile(page, "tty")).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Shift+Control+Backslash");
    await expect
      .poll(() => paneCount(id), { timeout: 10_000 })
      .toBe(before + 1);
  });
});
