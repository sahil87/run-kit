import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolveWindow as resolveWindowRaw, gotoWindow as gotoWindowRaw } from "./_ready";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// A deliberately LONG session name so the session crumb is under real
// truncation pressure in the 640-900px band (the overlap regression band).
const TEST_SESSION = `e2e-overlap-longsessionname-${Date.now().toString().slice(-6)}`;
// A deliberately LONG window name so the centered heading is wide too.
const LONG_WINDOW = `overlap-verylongwindowname-${Date.now().toString().slice(-6)}`;

const MOBILE_VIEWPORT = { width: 375, height: 812 };
// ~700px is the heart of the pre-fix overlap band (between `sm` 640 and ~900).
const MID_VIEWPORT = { width: 700, height: 800 };
const DESKTOP_VIEWPORT = { width: 1024, height: 800 };

// Shared readiness helpers (hoisted to `_ready.ts`) bound to this file's server
// + session so existing call sites keep their two-arg shape.
const resolveWindow = (page: Parameters<typeof resolveWindowRaw>[0], windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);
const gotoWindow = (page: Parameters<typeof gotoWindowRaw>[0], windowId: string) =>
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

test.beforeAll(() => {
  try {
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
      { stdio: "ignore" },
    );
    // Create an ADDITIONAL window with the long name (the session's default
    // first window keeps its auto-name) so the terminal route carries a wide
    // centered heading. The test navigates to this long-named window by id.
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${LONG_WINDOW}"`,
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

test.describe("Top-bar overlap fixes (260715-q8ey)", () => {
  test("at ~700px with long names the breadcrumb nav and center heading do NOT overlap; crumbs clip/ellipsis (no visible overflow)", async ({
    page,
  }) => {
    const id = await resolveWindow(page, LONG_WINDOW);
    await page.setViewportSize(MID_VIEWPORT);
    await gotoWindow(page, id);

    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const heading = page.getByRole("button", {
      name: `Rename window ${LONG_WINDOW}`,
    });
    await expect(nav).toBeVisible();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // The core regression assertion: the nav box and the heading box must not
    // intersect. Before the fix, the un-shrinkable crumbs overflowed the nav
    // box and painted straight over the centered heading (garbled overlap).
    const navBox = (await nav.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;
    expect(navBox, "nav has a box").toBeTruthy();
    expect(headingBox, "heading has a box").toBeTruthy();
    expect(
      intersects(navBox, headingBox),
      `nav box ${JSON.stringify(navBox)} intersects heading box ${JSON.stringify(headingBox)}`,
    ).toBe(false);

    // Overflow is CLIPPED, not painted: the session crumb's NAME text is
    // truncated (ellipsis) yet its rendered box stays INSIDE the nav's box —
    // the `overflow-hidden` + `min-w-0`/`truncate` chain converted pressure
    // into clipping. The session crumb is `sm:flex` so it is present at 700px;
    // its trigger button (BreadcrumbDropdown, aria-label "Switch session")
    // caps at `max-w-[16ch] truncate`, and the name lives in an inner
    // `min-w-0 truncate` span — that inner span is the element that actually
    // ellipsises, so measure `scrollWidth > clientWidth` there (the button
    // sizes exactly to its capped content, so it is NOT itself overflowing).
    const sessionTrigger = page.getByRole("button", { name: "Switch session" });
    await expect(sessionTrigger).toBeVisible();
    const nameSpan = sessionTrigger.locator("span").first();
    const truncated = await nameSpan.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(
      truncated,
      "the long session crumb name is truncated (ellipsis), not shown at full width",
    ).toBe(true);
    // The full session name is still the text content (ellipsis is visual only).
    await expect(nameSpan).toHaveText(TEST_SESSION);

    // The clip backstop is active: the nav carries `overflow: hidden`, so any
    // content whose LAYOUT box extends past the nav's floor is visually
    // clipped at the nav's edge rather than painted over the center heading.
    // (A clipped child legitimately keeps a layout box wider than its clipping
    // parent, so the meaningful proof is the computed style + the no-overlap
    // assertion above, not a layout-box comparison.)
    const navOverflow = await nav.evaluate(
      (el) => getComputedStyle(el).overflowX,
    );
    expect(navOverflow).toBe("hidden");

    // No horizontal PAGE overflow at 700px (the grid does not push the shell).
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MID_VIEWPORT.width);
  });

  test("across the 375/640/700/768/1024 sweep the nav never overlaps the heading and the page never overflows horizontally", async ({
    page,
  }) => {
    // The intake's tunable-floor sweep (assumption #6): the explicit nav floor
    // (`min-w-[76px] sm:min-w-[180px]`) + `overflow-hidden` must hold the
    // no-overlap invariant across the whole band, not just at 700px. This is
    // the harness that would surface a bad floor value (overlap → too small;
    // page overflow at a benign width → too large).
    const id = await resolveWindow(page, LONG_WINDOW);
    await gotoWindow(page, id);

    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const heading = page.getByRole("button", {
      name: `Rename window ${LONG_WINDOW}`,
    });

    for (const width of [375, 640, 700, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      const navBox = await nav.boundingBox();
      const headingBox = (await heading.boundingBox())!;
      // The nav is present (and visible) at sm+; at 375 it may be a bare
      // brand+hamburger sliver, but it must still never overlap the heading.
      if (navBox) {
        expect(
          intersects(navBox, headingBox),
          `overlap at ${width}px: nav ${JSON.stringify(navBox)} vs heading ${JSON.stringify(headingBox)}`,
        ).toBe(false);
      }
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth, `horizontal page overflow at ${width}px`).toBeLessThanOrEqual(
        width,
      );
    }
  });

  test("the server crumb is hidden below `md` and visible at `md+`", async ({
    page,
  }) => {
    const id = await resolveWindow(page, LONG_WINDOW);
    // The server-link crumb is the left-nav <a href="/${server}"> (title
    // "Server Cabin"). Its accessible name is its text (the server name), so
    // target it by href scoped to the breadcrumb nav — that disambiguates it
    // from the brand link (href "/") and the hierarchy ▾ menuitem.
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const serverHref = `/${encodeURIComponent(TMUX_SERVER)}`;
    const serverCrumb = nav.locator(`a[href="${serverHref}"]`);

    // Below `md` (700px, in the `sm`..`md` band): the crumb element is in the
    // DOM but CSS-hidden (`hidden md:flex`), so it is not visible.
    await page.setViewportSize(MID_VIEWPORT);
    await gotoWindow(page, id);
    await expect(nav).toBeVisible();
    await expect(serverCrumb).toBeHidden();

    // At `md+` (1024px): the server crumb becomes visible again.
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(serverCrumb).toBeVisible();
  });

  test("375px mobile leaf layout is unchanged (single line, no horizontal overflow, crumbs hidden)", async ({
    page,
  }) => {
    const id = await resolveWindow(page, LONG_WINDOW);
    await page.setViewportSize(MOBILE_VIEWPORT);
    // Gate readiness on the heading (the connection dot is `hidden sm:inline`).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    const heading = page.getByRole("button", {
      name: `Rename window ${LONG_WINDOW}`,
    });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Both crumbs hide below `sm` (session `sm:flex`, server `md:flex`), so the
    // mobile leaf is just brand + centered heading — the layout the mobile
    // budget already relied on, unchanged by this change.
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const serverHref = `/${encodeURIComponent(TMUX_SERVER)}`;
    await expect(nav.locator(`a[href="${serverHref}"]`)).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Switch session" }),
    ).toBeHidden();

    // No horizontal page overflow, and the header stays a single line (a wrap
    // would roughly double the ~39px chrome height).
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
    const box = await page.locator("header").first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThan(56);
  });

  test("1024px+ has no regression: nav and heading do not overlap and the `sm:min-w-[28ch]` center anchor is intact", async ({
    page,
  }) => {
    const id = await resolveWindow(page, LONG_WINDOW);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoWindow(page, id);

    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const heading = page.getByRole("button", {
      name: `Rename window ${LONG_WINDOW}`,
    });
    await expect(nav).toBeVisible();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // No overlap at desktop either (sanity: the fix does not introduce a
    // desktop regression while solving the mid-width band).
    const navBox = (await nav.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;
    expect(intersects(navBox, headingBox)).toBe(false);

    // The center anchor stays at `sm:` (NOT demoted to `md:`): the inner center
    // box still reserves >= 28ch, so the heading's rendered width clears a
    // conservative 28ch floor (28ch ~ 224px at a 8px/ch monospace baseline; use
    // a slack floor to avoid font-metric brittleness while still proving the
    // anchor was not dropped).
    const anchorWidth = await page
      .locator("header")
      .first()
      .evaluate((headerEl) => {
        // The anchored inner box is the flex container reserving sm:min-w-[28ch].
        const box = headerEl.querySelector<HTMLElement>(
          "div.sm\\:min-w-\\[28ch\\]",
        );
        return box ? box.getBoundingClientRect().width : 0;
      });
    expect(
      anchorWidth,
      "the sm:min-w-[28ch] center anchor is present and reserves width at desktop",
    ).toBeGreaterThan(180);
  });

  // R2a regression guard (rework, review 260715): the nav's `overflow-hidden`
  // backstop (R2) is a further-out ancestor of the session crumb's dropdown
  // menu. Before the fix the menu was `position: absolute` inside the clipped
  // nav, so opening it (a) clipped the menu to the nav's single-line box and
  // (b) the focus-on-open scrollIntoView dragged the whole nav content
  // off-screen (open menu landed at y≈-75, hit-test empty). The fix renders the
  // menu `position: fixed` anchored to the trigger's viewport rect so it
  // escapes the clip. This is exactly the case the closed-trigger tests above
  // missed. Run at BOTH the mid-band width and desktop.
  for (const { label, viewport } of [
    { label: "700px", viewport: MID_VIEWPORT },
    { label: "1024px", viewport: DESKTOP_VIEWPORT },
  ]) {
    test(`the session-switcher dropdown opens fully visible and hit-testable at ${label} (nav clip does not swallow it)`, async ({
      page,
    }) => {
      const id = await resolveWindow(page, LONG_WINDOW);
      await page.setViewportSize(viewport);
      await gotoWindow(page, id);

      // Open the session switcher (the ▾ crumb, accessible name "Switch
      // session"). It is `sm:flex`, so present at both 700px and 1024px.
      const sessionTrigger = page.getByRole("button", { name: "Switch session" });
      await expect(sessionTrigger).toBeVisible();
      await sessionTrigger.click();

      // The open menu is visible and has an on-screen bounding box (NOT clipped
      // to the nav's single-line box and NOT scrolled to a negative-y off-screen
      // position — the two pre-fix failure modes).
      const menu = page.getByRole("menu", { name: "Switch session" });
      await expect(menu).toBeVisible();
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox, "the open menu has a bounding box").toBeTruthy();
      expect(menuBox.width, "menu has real width").toBeGreaterThan(0);
      expect(menuBox.height, "menu has real height").toBeGreaterThan(0);
      // Fully on-screen: top-left within the viewport and not pushed off the top
      // (the exact pre-fix symptom was y≈-75). Bottom/right within the viewport
      // too (the menu caps at max-w-[240px]/max-h-60 and anchors below a top-bar
      // trigger, so it comfortably fits an 800px-tall viewport).
      expect(menuBox.y, "menu top is on-screen (not scrolled off the top)").toBeGreaterThanOrEqual(0);
      expect(menuBox.x, "menu left is on-screen").toBeGreaterThanOrEqual(0);
      expect(
        menuBox.y + menuBox.height,
        "menu bottom is within the viewport",
      ).toBeLessThanOrEqual(viewport.height);
      expect(
        menuBox.x + menuBox.width,
        "menu right is within the viewport",
      ).toBeLessThanOrEqual(viewport.width);

      // Hit-testable: `elementFromPoint` at the menu's center resolves to a node
      // INSIDE the menu (proves nothing clips or covers it — a clipped/displaced
      // menu would resolve to whatever paints at that point instead).
      const centerIsInsideMenu = await menu.evaluate((menuEl) => {
        const r = menuEl.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return hit != null && menuEl.contains(hit);
      });
      expect(
        centerIsInsideMenu,
        "elementFromPoint at the menu center resolves inside the menu (not clipped/covered)",
      ).toBe(true);

      // The `+ New Session` action is actually usable: visible and clickable
      // (Playwright's click does its own actionability/hit-test, so a click that
      // resolves is proof the action is reachable, not just painted).
      const newSession = page.getByRole("menuitem", { name: "+ New Session" });
      await expect(newSession).toBeVisible();
      const actionBox = (await newSession.boundingBox())!;
      const actionHitsItself = await newSession.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return hit != null && el.contains(hit);
      });
      expect(actionBox.width, "+ New Session has a real box").toBeGreaterThan(0);
      expect(
        actionHitsItself,
        "the + New Session action is hit-testable (top-most at its center)",
      ).toBe(true);
    });
  }
});
