import { test, expect, type Page, type Locator } from "@playwright/test";
import { READY_TIMEOUT } from "./_ready";
import { GUI_ON_1080P, mockGuiBackend, toggleButton } from "./_gui-mock";

// GUI header fold e2e (spec docs/specs/gui.md § The tile; design authority
// docs/wiki/gui-toolbar-header-studies.html). The gui tile's session controls
// live in the tile header as a MEASURED priority fold (lib/gui-toolbar-fold.ts
// owns the decision; the component owns the DOM measurement) — jsdom has no
// layout engine, so the ladder is driven here at REAL viewport widths. The
// ResizeObserver re-fit is NOT atomic with the resize (the same caveat
// top-bar-overflow.spec.ts / crumb-collapse.spec.ts document), so every
// post-resize assertion is a retrying Playwright expect.
//
// Shared setup: the fully-mocked gui rig from `_gui-mock.ts` (state-socket
// mock, reachable 1080p icewm entry; the mocked /ws/gui/ socket never
// completes an RFB handshake, so the tile stays DISCONNECTED — the ladder's
// input rung (⎘ ⌥) is absent and ↻ Reconnect is present). Every test opens
// @1 and toggles the gui tile on, giving a 50/50 split-h whose header spring
// sits in the few-hundred-px band where the ladder engages; `resizeToSpring`
// iterates viewport resizes until the spring hits a computed target (the
// header's shrinkable meta chip makes the viewport↔spring overhead
// non-constant), and `measureFold` reads the hidden probe row's REAL widths,
// so fold targets are computed from measurement, never hardcoded.

/** The probe's measured widths (data-fold keyed), the spring's clientWidth,
 *  and the viewport width — the fold's three real inputs. */
async function measureFold(page: Page) {
  const m = await page.evaluate(() => {
    const probe = document.querySelector('[data-testid="gui-toolbar-probe"]');
    const spring = document.querySelector('[data-testid="gui-toolbar"]');
    if (!probe || !spring) return null;
    const widths: Record<string, number> = {};
    probe.querySelectorAll("[data-fold]").forEach((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      widths[el.getAttribute("data-fold") ?? ""] =
        (el as HTMLElement).offsetWidth +
        parseFloat(cs.marginLeft || "0") +
        parseFloat(cs.marginRight || "0");
    });
    return { widths, spring: (spring as HTMLElement).clientWidth, viewport: window.innerWidth };
  });
  expect(m).not.toBeNull();
  return m!;
}

/** The ladder's rendered width with `count` leading items, labels degraded
 *  from `degradeFrom`, dividers at group boundaries — the module's own
 *  arithmetic, recomputed against the measured probe widths so the spec can
 *  aim the viewport at an exact fold boundary. */
const LADDER = [
  { id: "size", group: "size" },
  { id: "zoom-out", group: "zoom" },
  { id: "zoom-fit", group: "zoom" },
  { id: "zoom-in", group: "zoom" },
  { id: "quality", group: "quality" },
  // The disconnected fixture: no ⎘/⌥, ↻ present.
  { id: "terminal", group: "actions" },
  { id: "browser", group: "actions" },
  { id: "stats", group: "actions" },
  { id: "reconnect", group: "actions" },
];

function ladderWidth(
  widths: Record<string, number>,
  count: number,
  degradeFrom: number,
): number {
  let used = 0;
  let lastGroup: string | null = null;
  for (let i = 0; i < count; i++) {
    const item = LADDER[i];
    const shortable = item.id === "size" || item.id === "quality";
    used += widths[i >= degradeFrom && shortable ? `${item.id}:short` : item.id];
    if (lastGroup !== null && item.group !== lastGroup) used += widths.divider;
    lastGroup = item.group;
  }
  return used;
}

/** Open @1 and toggle the gui tile on (a 50/50 split-h, so the gui tile's
 *  header spring sits in the few-hundred-px band where the fold's ladder
 *  actually engages — a zoomed tile is too wide, and shrinking the viewport
 *  far enough to fold it would cross the mobile breakpoint, where the tile
 *  header does not exist). Returns the header fold cluster locator. */
async function openGuiTileSplit(page: Page): Promise<Locator> {
  await page.goto("/default/%401");
  await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
  await toggleButton(page, "GUI tile").click();
  await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });
  const cluster = page.getByTestId("surface-tile-gui").getByTestId("gui-toolbar");
  await expect(cluster.getByTestId("gui-toolbar-resolution")).toBeVisible();
  return cluster;
}

/** Resize the viewport until the header spring lands within 1px of
 *  `springTarget`. Iterates because the header's shrinkable meta chip makes
 *  the viewport↔spring overhead non-constant. */
async function resizeToSpring(page: Page, springTarget: number) {
  // The meta chip re-expands into freed width, so each step gains only part
  // of the delta — iterate to a 2px tolerance.
  for (let i = 0; i < 15; i++) {
    const m = await measureFold(page);
    const delta = springTarget - m.spring;
    if (Math.abs(delta) <= 2) return;
    await page.setViewportSize({ width: Math.max(320, Math.round(m.viewport + delta)), height: 800 });
  }
  throw new Error(`spring did not converge to ${springTarget}`);
}

test.describe("gui header fold — real widths", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /**
   * Proves: the fold consumes the ladder from the TAIL — health (∿/↻) folds
   * first, the size chip never does at these widths — the `⚙` pinned block
   * appears exactly when something folds and disappears when everything fits
   * again, and the panel carries the folded rungs' palette rows.
   *
   * Steps:
   * 1. Mock the reachable 1080p entry; open the gui tile in the split;
   *    measure the probe; widen the viewport until the spring fits the full
   *    ladder; assert the full cluster inline and no `⚙`.
   * 2. Resize so the spring lands just below the fully-degraded width; assert
   *    (retrying) that Toggle stats and Reconnect fold, ⚙ appears, and the
   *    size chip stays inline.
   * 3. Widen back to the full-fit width; assert the cluster is restored and
   *    ⚙ is gone.
   * 4. Narrow again, open ⚙; assert the panel lists the folded rungs' rows.
   */
  test("the ladder folds tail-first, ⚙ appears and disappears with it, and the panel carries the folded rows", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_1080P);
    const cluster = await openGuiTileSplit(page);

    const { widths } = await measureFold(page);
    const full = ladderWidth(widths, LADDER.length, LADDER.length);
    const degradedAll = ladderWidth(widths, LADDER.length, 0);
    // Widen until everything fits (the header's meta chip eats spring width,
    // so the default 1280 split already folds the tail).
    await resizeToSpring(page, full + 40);
    await expect(cluster.getByRole("button", { name: "Toggle stats" })).toBeVisible();
    await expect(cluster.getByRole("button", { name: "Reconnect" })).toBeVisible();
    await expect(cluster.getByTestId("gui-toolbar-overflow")).toHaveCount(0);
    // Just below the fully-degraded width: pass 1 folds reconnect, the
    // reserve (pass 2) folds stats with it.
    await resizeToSpring(page, degradedAll - 10);
    await expect(cluster.getByTestId("gui-toolbar-overflow")).toBeVisible();
    await expect(cluster.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expect(cluster.getByRole("button", { name: "Toggle stats" })).toHaveCount(0);
    await expect(cluster.getByTestId("gui-toolbar-resolution")).toBeVisible();
    await expect(cluster.getByRole("button", { name: "Open terminal" })).toBeVisible();

    // Widening back well past the threshold (hysteresis margin is 24px) —
    // everything returns inline and ⚙ disappears.
    await resizeToSpring(page, full + 40);
    await expect(cluster.getByTestId("gui-toolbar-overflow")).toHaveCount(0);
    await expect(cluster.getByRole("button", { name: "Toggle stats" })).toBeVisible();

    // Narrow again and open the panel: the folded rungs read as palette rows.
    await resizeToSpring(page, degradedAll - 10);
    const gear = cluster.getByTestId("gui-toolbar-overflow");
    await expect(gear).toBeVisible();
    await gear.click();
    const menu = page.getByTestId("gui-toolbar-menu");
    await expect(menu).toHaveAttribute("data-menu", "overflow");
    await expect(menu.getByRole("menuitem")).toHaveText(["Show stats", "Reconnect"]);
  });

  /**
   * Proves: degradation is spent before any fold — the quality label drops
   * to `◐` first, then the size label shortens to `1920 ▾`, while EVERY rung
   * stays inline and no `⚙` renders (D5, the two-pass reserve: nothing
   * folded ⇒ nothing reserved).
   *
   * Steps:
   * 1. Mock the reachable 1080p entry; open the gui tile in the split;
   *    measure the probe.
   * 2. Resize into the band where only quality degrades; assert `◐`, the
   *    full size label, and no ⚙ (retrying).
   * 3. Resize into the band where both labels are degraded; assert `1920 ▾`
   *    and still no fold.
   */
  test("labels degrade one step before any item folds", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_1080P);
    const cluster = await openGuiTileSplit(page);
    const { widths } = await measureFold(page);
    const full = ladderWidth(widths, LADDER.length, LADDER.length);
    const degradedQuality = ladderWidth(widths, LADDER.length, 4);
    const degradedBoth = ladderWidth(widths, LADDER.length, 0);

    // [degradedQuality, full): only the quality label pays.
    await resizeToSpring(page, (degradedQuality + full) / 2);
    await expect(cluster.getByRole("button", { name: "Quality" })).toHaveText("◐");
    await expect(cluster.getByTestId("gui-toolbar-resolution")).toHaveText("1920×1080 ▾");
    await expect(cluster.getByRole("button", { name: "Toggle stats" })).toBeVisible();
    await expect(cluster.getByTestId("gui-toolbar-overflow")).toHaveCount(0);

    // [degradedBoth, degradedQuality): the size label shortens too.
    await resizeToSpring(page, (degradedBoth + degradedQuality) / 2);
    await expect(cluster.getByTestId("gui-toolbar-resolution")).toHaveText("1920 ▾");
    await expect(cluster.getByRole("button", { name: "Quality" })).toHaveText("◐");
    await expect(cluster.getByRole("button", { name: "Toggle stats" })).toBeVisible();
    await expect(cluster.getByTestId("gui-toolbar-overflow")).toHaveCount(0);
  });

  /**
   * Proves: the ⚙ panel's open state persists per viewer as `rk-gui-toolbar`
   * — a reload with the key set reopens the panel without a click — and the
   * persisted-open panel does NOT steal focus into the menu on load.
   *
   * Steps:
   * 1. Mock the reachable 1080p entry; open the gui tile in the split; narrow
   *    into a folded width; click ⚙; assert `rk-gui-toolbar` reads "1".
   * 2. Reload; reopen the gui tile; narrow again.
   * 3. Assert the panel renders open on its own (aria-expanded on ⚙, the
   *    menu visible) and document.activeElement is not inside the menu.
   */
  test("the panel open state persists across a reload (rk-gui-toolbar)", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_1080P);
    const cluster = await openGuiTileSplit(page);
    const { widths } = await measureFold(page);
    const foldedSpring = ladderWidth(widths, LADDER.length, 0) - 10;

    await resizeToSpring(page, foldedSpring);
    const gear = cluster.getByTestId("gui-toolbar-overflow");
    await expect(gear).toBeVisible();
    await gear.click();
    await expect(page.getByTestId("gui-toolbar-menu")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("rk-gui-toolbar")))
      .toBe("1");

    await page.reload();
    const cluster2 = await openGuiTileSplit(page);
    await resizeToSpring(page, foldedSpring);
    const gear2 = cluster2.getByTestId("gui-toolbar-overflow");
    await expect(gear2).toBeVisible();
    await expect(gear2).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByTestId("gui-toolbar-menu");
    await expect(menu).toBeVisible();
    // The persisted-open mount must not steal focus into the popover.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const menu = document.querySelector('[data-testid="gui-toolbar-menu"]');
          return menu?.contains(document.activeElement) ?? null;
        }),
      )
      .toBe(false);
  });

  /**
   * Proves: the fullscreen verb targets the TILE element (D6 reversed) — the
   * header travels into fullscreen and serves it: the fold cluster stays
   * visible, ⤢ latches green as the exit, and the layout verbs (Expand /
   * Close) are suppressed; the latched ⤢ exits and restores the windowed
   * chrome. (Escape is NOT the exit under test: the fullscreen verb chains
   * the keyboard lock, which reserves Escape for the guest.)
   *
   * Steps:
   * 1. Mock the reachable 1080p entry; open the gui tile (NOT zoomed — the
   *    split keeps the layout verbs in the header).
   * 2. Click the header's ⤢; assert `document.fullscreenElement` is the
   *    `surface-tile-gui` element, the cluster is visible, ⤢ reads "Exit
   *    fullscreen" latched, and the layout verbs are gone.
   * 3. Click the latched ⤢; assert the exit restores "Enter fullscreen" and
   *    the layout verbs.
   */
  test("fullscreen targets the tile and the header serves it", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_1080P);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await toggleButton(page, "GUI tile").click();
    const tile = page.getByTestId("surface-tile-gui");
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(tile.getByLabel("Expand GUI")).toBeVisible();

    await tile.getByLabel("Enter fullscreen").click();
    await expect
      .poll(() =>
        page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid") ?? null),
      )
      .toBe("surface-tile-gui");
    await expect(tile.getByTestId("gui-toolbar")).toBeVisible();
    const exit = tile.getByLabel("Exit fullscreen");
    await expect(exit).toBeVisible();
    await expect(exit).toHaveAttribute("aria-pressed", "true");
    await expect(tile.getByLabel("Expand GUI")).toHaveCount(0);
    await expect(tile.getByLabel("Close GUI")).toHaveCount(0);

    await tile.getByLabel("Exit fullscreen").click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expect(tile.getByLabel("Enter fullscreen")).toBeVisible();
    await expect(tile.getByLabel("Expand GUI")).toBeVisible();
  });
});
