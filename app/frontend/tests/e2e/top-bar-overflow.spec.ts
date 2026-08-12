import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolveWindow as resolveWindowRaw, gotoWindow as gotoWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Regression proof for the top-bar overflow chevron menu (260715-h1ck) AND for
// the review M1 fix (the measured right cell must FILL its `1fr` grid track, not
// be content-sized). On the pre-M1 code the right cell measured only the exempt
// block → budget < 0 → `visibleCount` deadlocks at 0 → NOTHING renders in-bar at
// ANY width, so assertion (b)/(e) below (in-bar controls at wide widths) fail.

const TEST_SESSION = `e2e-overflow-${Date.now().toString().slice(-6)}`;
const WINDOW_NAME = `overflow-win-${Date.now().toString().slice(-6)}`;

// The width sweep from the intake (§8): fits-everything → mobile leaf.
const WIDTHS = [1280, 1024, 800, 700, 640, 500, 375];

const resolveWindow = async (page: Page, windowName: string) =>
  (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
const gotoWindow = (page: Page, windowId: string) =>
  gotoWindowRaw(page, TMUX_SERVER, windowId);

/** True when two DOM rects overlap (share any area). */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Right-cluster controls in pyramid order (L1 → L2 → L3), by accessible name.
// Terminal route as of 260731-oiho: L1 is the ONE merged split control (its
// primary segment's accessible name), L2 is empty (fixed-width, Aa, and ✕ are
// `menuOnly` now — see MENU_ONLY below), L3 is refresh (the update chip is
// context-gated and omitted from the ordering assertion; theme/help/bell/dot
// left the bar in 260724-6j1v — theme+help live in the sidebar footer,
// notifications in the settings dialog).
// The IN-BAR detection uses accessible-name ROLE queries (getByRole/getByLabel):
// the always-present measurement probe is `aria-hidden`, so its duplicate
// controls are OUTSIDE the accessibility tree and never matched — this is what
// distinguishes "in-bar" from "overflowed/probe" (a `:visible` CSS filter does
// NOT work: the probe sits off-screen at -9999px but Playwright still considers
// a sized off-screen element "visible").
type NameMatcher = string | RegExp;
const L1: NameMatcher[] = ["Split horizontally"];
const L2: NameMatcher[] = [];
const L3: NameMatcher[] = ["Refresh page"];
// The three demoted controls (260731-oiho, the n2n4 menuOnly mechanism): their
// bar forms render NOWHERE at ANY width; their rows are ALWAYS in the menu.
const MENU_ONLY: NameMatcher[] = [
  "Toggle fixed terminal width",
  "Terminal font size",
  "Close pane",
];

/** Locate a control by accessible name across button OR link roles. `getByRole`
 *  excludes the aria-hidden measurement probe subtree, so a match means the
 *  control is rendered IN-BAR (Help is a link; the rest are buttons). */
function byRoleName(page: Page, name: NameMatcher) {
  return page
    .getByRole("button", { name })
    .or(page.getByRole("link", { name }));
}

/** How many of the given controls are currently rendered IN-BAR (found in the
 *  accessibility tree; the aria-hidden probe copies are excluded). */
async function inBarCount(page: Page, names: NameMatcher[]): Promise<number> {
  let n = 0;
  for (const name of names) {
    if ((await byRoleName(page, name).count()) > 0) n += 1;
  }
  return n;
}

/** Read the (L1, L2, L3) in-bar counts, SETTLED. The three tier reads are not
 *  atomic — the ResizeObserver-driven overflow recompute can re-render between
 *  them, producing an inconsistent split (seen flaky: L3 already overflowed
 *  while L2 still read as in-bar mid-cascade after a resize). Re-read until two
 *  consecutive snapshots agree (bounded), so invariants are asserted on a
 *  stable layout, not a transient frame. */
async function settledTierCounts(page: Page): Promise<[number, number, number]> {
  const read = async (): Promise<[number, number, number]> => [
    await inBarCount(page, L1),
    await inBarCount(page, L2),
    await inBarCount(page, L3),
  ];
  let prev = await read();
  for (let i = 0; i < 20; i++) {
    const next = await read();
    if (next[0] === prev[0] && next[1] === prev[1] && next[2] === prev[2]) return next;
    prev = next;
  }
  return prev;
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
  try {
    newWindow(TEST_SESSION, WINDOW_NAME);
  } catch {
    // Best effort — matches the prior copied pattern.
  }
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Top-bar overflow chevron menu (260715-h1ck)", () => {
  test("the chevron is always visible (no bar dot) and the top bar never overlaps across the width sweep", async ({
    page,
  }) => {
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);

    const cluster = page.getByTestId("top-bar-right");
    const chevron = page.getByRole("button", { name: "More controls" });
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });

      // (e) The exempt chevron is always visible at every width; the
      // connection dot is GONE from the bar (260724-6j1v — it lives in the
      // sidebar footer now).
      await expect(chevron, `chevron visible at ${width}px`).toBeVisible();
      await expect(cluster.locator('[role="status"]'), `no bar dot at ${width}px`).toHaveCount(0);

      // (g) The demoted menuOnly controls (260731-oiho) render in-bar NOWHERE —
      // not even at the widest width where the cluster has room.
      expect(
        await inBarCount(page, MENU_ONLY),
        `no in-bar fixed-width/Aa/✕ at ${width}px`,
      ).toBe(0);

      // (a) No overlap: the right cell must not intersect the center heading nor
      // the breadcrumb nav (the overflow is what keeps the cluster within its
      // squeezable track — the M1 deadlock would have collapsed it, but a
      // content-sized cell could also paint over the center).
      const clusterBox = (await cluster.boundingBox())!;
      const headingBox = (await heading.boundingBox())!;
      expect(clusterBox, `cluster has a box at ${width}px`).toBeTruthy();
      expect(
        intersects(clusterBox, headingBox),
        `right cluster overlaps heading at ${width}px`,
      ).toBe(false);
      const navBox = await nav.boundingBox();
      if (navBox) {
        expect(
          intersects(clusterBox, navBox),
          `right cluster overlaps nav at ${width}px`,
        ).toBe(false);
      }
      // No horizontal page overflow.
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(width);

      // (e) The exempt chevron + dot must be genuinely HIT-TESTABLE (not merely
      // painted) at every width — at tight widths with a long center heading the
      // narrow `1fr` track could otherwise clip them. `elementFromPoint` at the
      // chevron center must resolve inside the chevron.
      const chevronHittable = await chevron.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit != null && el.contains(hit);
      });
      expect(chevronHittable, `chevron hit-testable at ${width}px`).toBe(true);
    }
  });

  test("controls overflow in pyramid order (L1 before L2 before L3) as width shrinks", async ({
    page,
  }) => {
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });

    // At the WIDEST width some in-bar controls must be present — this is the
    // direct M1 regression assertion (pre-fix: 0 in-bar at every width).
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    const wideL3 = await inBarCount(page, L3);
    expect(wideL3, "at 1280px at least some L3 controls render in-bar (M1)").toBeGreaterThan(0);

    // Sweep narrower and record how many of each tier remain in-bar. The
    // invariant: an L2 control never survives while an L1 control is still
    // in-bar dropped after it, etc. Concretely — L1 must reach 0 before L2
    // starts dropping, and L2 must reach 0 before L3 starts dropping (overflow
    // consumes from the FRONT of the pyramid).
    let prevL1 = L1.length;
    let prevL2 = L2.length;
    let prevWasDesktop = true;
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      const [l1, l2, l3] = await settledTierCounts(page);

      // The trailing exempt block shrinks at the mobile boundary: the
      // desktop-only rail toggle (260812-nm4p) unmounts below 640px
      // (MOBILE_BREAKPOINT_PX), freeing reserved width that can legitimately
      // re-admit an already-dropped candidate. Monotonicity therefore holds
      // WITHIN each viewport regime (desktop ≥640 / mobile <640) — re-baseline
      // once at the crossing. The per-width pyramid-order assertions below are
      // regime-independent and still run at every width.
      const isDesktopWidth = width >= 640;
      if (prevWasDesktop && !isDesktopWidth) {
        prevL1 = L1.length;
        prevL2 = L2.length;
      }
      prevWasDesktop = isDesktopWidth;

      // Monotonic non-increasing as width shrinks (each tier only loses members).
      expect(l1, `L1 in-bar non-increasing at ${width}px`).toBeLessThanOrEqual(prevL1);
      expect(l2, `L2 in-bar non-increasing at ${width}px`).toBeLessThanOrEqual(prevL2);

      // Pyramid consumed from the LEFT: L2 stays full until L1 is fully gone;
      // L3 stays full until L2 is fully gone.
      if (l1 > 0) {
        expect(l2, `L2 intact while L1 present at ${width}px`).toBe(L2.length);
        expect(l3, `L3 intact while L1 present at ${width}px`).toBe(L3.length);
      }
      if (l2 > 0) {
        expect(l3, `L3 intact while L2 present at ${width}px`).toBe(L3.length);
      }
      prevL1 = l1;
      prevL2 = l2;
    }
    // At the narrowest width the pyramid's FRONT has been consumed: the L1
    // split control has overflowed. The 260731-oiho consolidation lightened
    // the cluster enough that the L3 tail (Refresh) deliberately survives at
    // the mobile leaf — the pyramid ORDER, not an all-gone cliff, is the
    // contract.
    expect(await inBarCount(page, L1), "L1 (split) overflowed at 375px").toBe(0);
  });

  test("the chevron menu contains the overflowed + menuOnly rows plus the version row, grouped under section labels", async ({
    page,
  }) => {
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });

    // At 375px everything overflows — the menu should carry every mapped row.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();

    // The dropped controls appear as menu rows (mapped labels; the merged split
    // entry contributes BOTH one-action-per-row directions, horizontal first —
    // the 260806-2x2h default), the menuOnly rows
    // are present (fixed-width / terminal-font stepper / close-pane), and the
    // version row is present (last). The L3 Refresh deliberately SURVIVES
    // in-bar at 375px on the lightened cluster (260731-oiho), so no Refresh row
    // is asserted here — an in-bar entry contributes no menu row.
    await expect(menu.getByRole("menuitem", { name: "Split horizontal" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Split vertical" })).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeVisible();
    await expect(menu.getByRole("group", { name: "Terminal font size" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Close pane" })).toBeVisible();
    // Density + grouping (260731-oiho): thin uppercase section labels group the
    // rows in the fixed View → Window → App order.
    await expect(menu.getByText("View", { exact: true })).toBeVisible();
    await expect(menu.getByText("Window", { exact: true })).toBeVisible();
    await expect(menu.getByText("App", { exact: true })).toBeVisible();
    // Theme / Help / Notifications rows are GONE (260724-6j1v): theme + help
    // moved to the sidebar footer, the bell folded into the settings dialog.
    await expect(menu.getByRole("menuitem", { name: /Theme:/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Help / Documentation" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /notification/i })).toHaveCount(0);
    // The fixed version row is always present (plain `RunKit` or `RunKit v…`).
    await expect(menu.getByRole("menuitem", { name: /RunKit/ })).toBeVisible();
  });

  test("the menuOnly rows (fixed-width / Aa / close-pane) are in the menu even at a WIDE width", async ({
    page,
  }) => {
    // The distinguishing 260731-oiho case: the bar has room at 1280px — the
    // in-bar end state is Open · Split(▾) · Refresh · chevron — yet the three
    // demoted controls still live ONLY in the menu (menu-only, not
    // space-driven overflow).
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    // The bar carries the split control (in-bar at this width)…
    await expect(byRoleName(page, "Split horizontally")).toBeVisible({ timeout: 10_000 });
    // …but never the demoted three.
    expect(await inBarCount(page, MENU_ONLY)).toBe(0);

    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeVisible();
    await expect(menu.getByRole("group", { name: "Terminal font size" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Close pane" })).toBeVisible();
    // The in-bar split control's rows also appear in the menu? NO — the split
    // is in-bar at this width, so its rows are NOT duplicated into the menu
    // (menu rows = menuOnly entries + genuinely overflowed entries only).
    await expect(menu.getByRole("menuitem", { name: "Split horizontal" })).toHaveCount(0);
  });

  test("the version row copies the version to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    const versionRow = menu.getByRole("menuitem", { name: /RunKit/ });
    await expect(versionRow).toBeVisible();
    const rowText = (await versionRow.textContent())?.trim() ?? "";
    await versionRow.click();

    // If the daemon reported a version (`RunKit v…`), the clipboard holds the
    // displayed `v…` form. If it is the plain `RunKit` (no version yet), the row
    // is a no-op copy — skip the clipboard assertion in that case.
    if (/^RunKit v/.test(rowText)) {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/^v?\d/);
    }
  });

  test("a menu action (fixed-width toggle) works from the menu", async ({ page }) => {
    // The theme row left the menu (260724-6j1v — the footer owns theme now);
    // the fixed-width checkbox row is the representative stateful menu action.
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    const row = menu.getByRole("menuitemcheckbox", { name: /Fixed width/ });
    const before = await row.getAttribute("aria-checked");
    await row.click();

    // The checkbox toggle closes the menu (role-keyed close); reopen and
    // confirm the checked state flipped.
    await page.getByRole("button", { name: "More controls" }).click();
    const menu2 = page.getByRole("menu", { name: "More controls" });
    const row2 = menu2.getByRole("menuitemcheckbox", { name: /Fixed width/ });
    const after = await row2.getAttribute("aria-checked");
    expect(after, `fixed-width toggled from "${before}"`).not.toBe(before);
    // Restore the preference so later specs see the default full-width state.
    await row2.click();
  });
});

// The ViewSwitcher lens control is terminal-only and gated on a multi-view
// window, so it never contributes rows on the tty-only WINDOW_NAME window above.
// This block uses a web-capable window (a non-empty `@rk_url` ⇒ `[tty|web]`)
// with a long name to prove the 260722-n2n4 MENU-ONLY contract: the registry
// entry carries `menuOnly: true`, so the pill NEVER renders in-bar (no bar slot,
// no measurement-probe copy — the `view-toggle` testid is absent from the DOM at
// ANY width), the per-view `View:` menuitemradio rows are ALWAYS in the chevron
// menu, a row activation switches the lens even at a wide width, and the fit
// pyramid over the remaining candidates is intact with the merged `split`
// control (primary segment `Split horizontally`) as the new first-to-yield
// candidate.
const VIEW_WINDOW_NAME = `overflow-view-long-worktree-${Date.now().toString().slice(-6)}`;
const VIEW_URL = "http://localhost:8080/";

test.describe("Top-bar overflow: ViewSwitcher is menu-only (260722-n2n4)", () => {
  test.beforeAll(() => {
    try {
      newWindow(TEST_SESSION, VIEW_WINDOW_NAME);
    } catch {
      // Session/window may already exist.
    }
  });

  // The in-bar switcher group in the accessibility tree. Under the menuOnly
  // flag this must NEVER match; the stricter DOM-wide check below is
  // `getByTestId("view-toggle")`, which as of 260722-n2n4 must also be empty
  // (the probe no longer carries a pill copy either).
  const inBarSwitcher = (page: Page) => page.getByRole("group", { name: "Window view" });

  async function gotoViewWindow(page: Page): Promise<void> {
    const id = await resolveWindow(page, VIEW_WINDOW_NAME);
    // Stamp `@rk_url` so the window offers the `web` lens (`[tty|web]` → the
    // multi-view gate passes and the `View:` menu rows render). Set before
    // navigating so the first snapshot carries it.
    execSync(
      `tmux -L ${TMUX_SERVER} set-option -w -t ${id} @rk_url "${VIEW_URL}"`,
      { stdio: "ignore" },
    );
    await gotoWindow(page, id);
  }

  test("the pill never renders in-bar at any width; the `View:` rows are always in the menu", async ({
    page,
  }) => {
    await gotoViewWindow(page);
    const heading = page.getByRole("button", { name: `Rename window ${VIEW_WINDOW_NAME}` });

    // Sweep wide → narrow. The menuOnly entry contributes no bar slot AND no
    // probe copy, so both the accessible in-bar group and the raw `view-toggle`
    // testid (which would match the aria-hidden probe copy on pre-n2n4 code at
    // wide widths) must be absent at EVERY width — including 1440px, where the
    // whole cluster has room (the pre-n2n4 pill rendered in-bar there).
    for (const width of [1440, ...WIDTHS]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await expect(inBarSwitcher(page), `no in-bar pill at ${width}px`).toHaveCount(0);
      await expect(
        page.getByTestId("view-toggle"),
        `no view-toggle in the DOM (bar or probe) at ${width}px`,
      ).toHaveCount(0);
    }

    // The `View:` rows are present in the chevron menu at BOTH extremes of the
    // sweep — the menu is the switcher's only rendering, independent of width.
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "More controls" }).click();
      const menu = page.getByRole("menu", { name: "More controls" });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitemradio", { name: "View: Terminal" }),
        `View: Terminal row at ${width}px`,
      ).toBeVisible();
      await expect(
        menu.getByRole("menuitemradio", { name: "View: Web" }),
        `View: Web row at ${width}px`,
      ).toBeVisible();
      // Close before the next resize so the fixed-position panel never straddles it.
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
  });

  test("the split control is the first fit candidate to yield — the menuOnly pill costs zero fit pixels", async ({
    page,
  }) => {
    await gotoViewWindow(page);
    const heading = page.getByRole("button", { name: `Rename window ${VIEW_WINDOW_NAME}` });

    // With the view-switcher out of the fit entirely, the FIRST fit candidate is
    // the leftmost L1 split (primary segment `Split horizontally` since
    // 260806-2x2h). The invariant across the sweep: whenever `Split
    // horizontally` is still in-bar nothing has dropped yet, so every L1/L2/L3
    // control must also be in-bar (the surviving set is a suffix of the fit
    // order). This retargets the former first-to-drop coverage (the pre-n2n4
    // pill) onto the new first candidate.
    const splitControl = () => byRoleName(page, "Split horizontally");
    let sawInBar = false;
    for (const width of [1440, ...WIDTHS]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      // At the widest width the whole cluster MUST fit — gate on a RETRYING
      // visibility expect so the post-resize re-fit (ResizeObserver → layout
      // effect) has settled before the plain `count()` reads below.
      if (width === 1440) {
        await expect(splitControl()).toBeVisible({ timeout: 10_000 });
      }
      const inBar = (await splitControl().count()) > 0;
      if (inBar) {
        sawInBar = true;
        expect(
          await inBarCount(page, [...L1, ...L2, ...L3]),
          `every fit candidate in-bar while the split control survives at ${width}px`,
        ).toBe(L1.length + L2.length + L3.length);
      }
    }
    // The sweep genuinely exercised both sides of the drop threshold: in-bar at
    // some wide width (gated above), and definitely dropped at the mobile leaf —
    // a RETRYING count so a still-settling re-fit can't flake the dropped side.
    expect(sawInBar, "the split control was in-bar at some (wide) width").toBe(true);
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(splitControl()).toHaveCount(0, { timeout: 10_000 });
  });

  test("a `View:` row activation switches the lens and closes the menu — even at a wide width", async ({
    page,
  }) => {
    await gotoViewWindow(page);
    const heading = page.getByRole("button", { name: `Rename window ${VIEW_WINDOW_NAME}` });
    // A wide width is the distinguishing case: the bar has room, yet the
    // switcher still lives ONLY in the menu (menu-only, not space-driven).
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    const ttyRow = menu.getByRole("menuitemradio", { name: "View: Terminal" });
    const webRow = menu.getByRole("menuitemradio", { name: "View: Web" });
    await expect(ttyRow).toBeVisible();
    await expect(webRow).toBeVisible();
    // Default lens is tty → the tty row is the active (marked) one.
    await expect(ttyRow).toHaveAttribute("aria-checked", "true");
    await expect(webRow).toHaveAttribute("aria-checked", "false");

    // Activating the Web row switches the lens: the URL gains `?view=web` and the
    // proxied iframe renders.
    await webRow.click();
    await expect(page).toHaveURL(/\?view=web/, { timeout: 10_000 });
    await expect(page.getByTitle("Proxied content")).toBeVisible({ timeout: 10_000 });
    // The `View:` row is a `role="menuitemradio"` activation, so the chevron menu
    // closes (single-shot menu action). No in-bar pill appears after the switch.
    await expect(menu).toBeHidden();
    await expect(inBarSwitcher(page)).toHaveCount(0);
  });
});
