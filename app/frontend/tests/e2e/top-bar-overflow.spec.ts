import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolveWindow as resolveWindowRaw, gotoWindow as gotoWindowRaw } from "./_ready";

// Regression proof for the top-bar overflow chevron menu (260715-h1ck) AND for
// the review M1 fix (the measured right cell must FILL its `1fr` grid track, not
// be content-sized). On the pre-M1 code the right cell measured only the exempt
// block → budget < 0 → `visibleCount` deadlocks at 0 → NOTHING renders in-bar at
// ANY width, so assertion (b)/(e) below (in-bar controls at wide widths) fail.

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-overflow-${Date.now().toString().slice(-6)}`;
const WINDOW_NAME = `overflow-win-${Date.now().toString().slice(-6)}`;

// The width sweep from the intake (§8): fits-everything → mobile leaf.
const WIDTHS = [1280, 1024, 800, 700, 640, 500, 375];

const resolveWindow = (page: Page, windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);
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
// Terminal route: L1 splits + fixed-width, L2 Aa (+ close), L3 theme/refresh/help
// (update/notification are context-gated and omitted from the ordering assertion).
// The IN-BAR detection uses accessible-name ROLE queries (getByRole/getByLabel):
// the always-present measurement probe is `aria-hidden`, so its duplicate
// controls are OUTSIDE the accessibility tree and never matched — this is what
// distinguishes "in-bar" from "overflowed/probe" (a `:visible` CSS filter does
// NOT work: the probe sits off-screen at -9999px but Playwright still considers
// a sized off-screen element "visible").
type NameMatcher = string | RegExp;
const L1: NameMatcher[] = ["Split vertically", "Split horizontally", "Toggle fixed terminal width"];
const L2: NameMatcher[] = ["Terminal font size", "Close pane"];
const L3: NameMatcher[] = [/ theme$/, "Refresh page", "Help — run-kit docs"];

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

test.beforeAll(() => {
  try {
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
      { stdio: "ignore" },
    );
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${WINDOW_NAME}"`,
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

test.describe("Top-bar overflow chevron menu (260715-h1ck)", () => {
  test("the chevron + dot are always visible and the top bar never overlaps across the width sweep", async ({
    page,
  }) => {
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);

    const cluster = page.getByTestId("top-bar-right");
    const chevron = page.getByRole("button", { name: "More controls" });
    const dot = cluster.locator('[role="status"]');
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });

      // (e) Exempt items always visible: chevron + dot at every width.
      await expect(chevron, `chevron visible at ${width}px`).toBeVisible();
      await expect(dot, `dot visible at ${width}px`).toBeVisible();

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
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      const l1 = await inBarCount(page, L1);
      const l2 = await inBarCount(page, L2);
      const l3 = await inBarCount(page, L3);

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
    // At the narrowest width everything has overflowed (mobile leaf).
    expect(await inBarCount(page, [...L1, ...L2, ...L3]), "all overflow at 375px").toBe(0);
  });

  test("the chevron menu contains exactly the overflowed controls plus the version row", async ({
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

    // The dropped controls appear as menu rows (mapped labels), and the version
    // row is present (last). No in-bar duplication check needed — everything is
    // overflowed at 375px.
    await expect(menu.getByRole("menuitem", { name: "Split vertical" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Split horizontal" })).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Close pane" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Theme:/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Refresh page" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Help / Documentation" })).toBeVisible();
    // The fixed version row is always present (plain `Run Kit` or `Run Kit v…`).
    await expect(menu.getByRole("menuitem", { name: /Run Kit/ })).toBeVisible();
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
    const versionRow = menu.getByRole("menuitem", { name: /Run Kit/ });
    await expect(versionRow).toBeVisible();
    const rowText = (await versionRow.textContent())?.trim() ?? "";
    await versionRow.click();

    // If the daemon reported a version (`Run Kit v…`), the clipboard holds the
    // displayed `v…` form. If it is the plain `Run Kit` (no version yet), the row
    // is a no-op copy — skip the clipboard assertion in that case.
    if (/^Run Kit v/.test(rowText)) {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/^v?\d/);
    }
  });

  test("a menu action (theme cycle) works from the menu", async ({ page }) => {
    const id = await resolveWindow(page, WINDOW_NAME);
    await gotoWindow(page, id);
    const heading = page.getByRole("button", { name: `Rename window ${WINDOW_NAME}` });
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "More controls" }).click();
    const menu = page.getByRole("menu", { name: "More controls" });
    const themeRow = menu.getByRole("menuitem", { name: /Theme:/ });
    const before = (await themeRow.textContent())?.trim() ?? "";
    await themeRow.click();

    // Reopen and confirm the theme label cycled (System → Light → Dark → …).
    await page.getByRole("button", { name: "More controls" }).click();
    const menu2 = page.getByRole("menu", { name: "More controls" });
    const themeRow2 = menu2.getByRole("menuitem", { name: /Theme:/ });
    const after = (await themeRow2.textContent())?.trim() ?? "";
    expect(after, `theme cycled from "${before}"`).not.toBe(before);
  });
});
