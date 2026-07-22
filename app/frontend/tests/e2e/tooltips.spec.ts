import { test, expect, type Page } from "@playwright/test";

/**
 * Tier-1 tooltip system (260722-73al): the styled `Tip` replaces native
 * `title=` attributes on interactive chrome controls. These tests prove the
 * three approved behaviors that native titles could not deliver:
 *   1. keyboard focus opens the tip (Constitution V — keyboard-first),
 *   2. hover opens the styled tip (no OS bubble, no native title attribute),
 *   3. coarse pointers get NO tooltip layer at all.
 *
 * The tmux Server route is used as the stage — its top bar renders the L3
 * always-block (theme / refresh / help) with tipped controls at desktop width
 * without needing any session/window fixtures.
 */

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

/** Mock `(pointer: coarse)` as matching so `Tip` self-suppresses in desktop
 *  Chromium (the mobile-touch-scroll.spec.ts precedent — Playwright's desktop
 *  Chromium cannot flip the real pointer media feature). */
function mockCoarsePointer(page: Page) {
  return page.addInitScript(() => {
    const orig = window.matchMedia;
    window.matchMedia = function (q: string) {
      if (q === "(pointer: coarse)") {
        return {
          matches: true,
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => true,
        } as MediaQueryList;
      }
      return orig.call(window, q);
    };
  });
}

test.describe("Tier-1 tooltips (Tip)", () => {
  test("keyboard focus opens the styled tip immediately", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    const refresh = page.getByRole("button", { name: "Refresh page" });
    await expect(refresh).toBeVisible({ timeout: 10_000 });

    // Tab from a fresh page (keyboard modality) until the brand crumb has
    // focus — its Tip names the crumb's level ("Host"). Bounded loop: the
    // brand link is among the first few tab stops on every route.
    const brand = page.getByRole("link", { name: "RunKit home" });
    let focused = false;
    for (let i = 0; i < 12 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await brand.evaluate((el) => el === document.activeElement);
    }
    expect(focused, "brand crumb never received keyboard focus").toBe(true);

    // Focus-visible opens with NO delay and wires the tooltip ARIA pattern.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(/Host/);
    await expect(brand).toHaveAttribute("aria-describedby", /.+/);
  });

  test("hover opens the styled tip (label + dim note), no native title bubble", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);
    const refresh = page.getByRole("button", { name: "Refresh page" });
    await expect(refresh).toBeVisible({ timeout: 10_000 });

    // Migration rule: the native `title` is REMOVED wherever Tip lands —
    // never both, or the OS bubble doubles the styled tip.
    await expect(refresh).not.toHaveAttribute("title", /.*/);

    // Hover past the 300ms open delay: the quiet-card tip shows the label and
    // the dim "⇧click: force" modifier note (the old parenthesized title).
    await refresh.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Refresh page");
    await expect(tooltip).toContainText("⇧click: force");

    // Escape dismisses (useDismiss) without activating the control.
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  });

  test("coarse pointers get no tooltip layer at all", async ({ page }) => {
    await mockCoarsePointer(page);
    await page.goto(`/${TMUX_SERVER}`);
    const refresh = page.getByRole("button", { name: "Refresh page" });
    await expect(refresh).toBeVisible({ timeout: 10_000 });

    // Hover AND focus — neither may open a tip under pointer: coarse (the
    // control's aria-label carries the name; there is no long-press layer).
    await refresh.hover();
    await refresh.focus();
    // Wait past the 300ms open delay before asserting absence.
    await page.waitForTimeout(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // Suppressed means UNWIRED: no aria-describedby is attached either.
    await expect(refresh).not.toHaveAttribute("aria-describedby", /.*/);
  });
});
