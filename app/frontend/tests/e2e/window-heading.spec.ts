import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-heading-${Date.now()}`;
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * Resolve a window's stable tmux id (`@N`) from the backend snapshot by its
 * display name. Polls because a CLI-created window surfaces asynchronously.
 */
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

/** Navigate to a specific window's terminal route and wait for connection. */
async function gotoWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Window heading (centered, editable) + hover vocabulary", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
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

  test("renders the current window name as the centered click-to-rename heading", async ({
    page,
  }) => {
    const name = `head-render-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    const heading = page.getByRole("button", { name: `Rename window ${name}` });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toHaveText(name);
    // The window name is NOT duplicated as a breadcrumb crumb.
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav).not.toContainText(name);
  });

  test("click name → inline input → type + Enter commits the rename", async ({
    page,
  }) => {
    const name = `head-edit-${Date.now()}`;
    const renamed = `head-renamed-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    await page.getByRole("button", { name: `Rename window ${name}` }).click();
    const input = page.getByRole("textbox", { name: "Window name" });
    await expect(input).toBeVisible();
    await input.fill(renamed);
    await input.press("Enter");

    // Sidebar reflects the committed name (via the rename API + SSE). The name
    // can appear in more than one place (window row + pane-panel echo), so
    // assert the first match rather than the whole set.
    const sidebar = page.locator("nav[aria-label='Sessions']");
    await expect(sidebar.locator(`text=${renamed}`).first()).toBeVisible({
      timeout: 10_000,
    });
    // Heading shows the new name (decode may briefly scramble, so poll).
    await expect(
      page.getByRole("button", { name: `Rename window ${renamed}` }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Escape cancels the edit and restores the original name", async ({
    page,
  }) => {
    const name = `head-escape-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    await page.getByRole("button", { name: `Rename window ${name}` }).click();
    const input = page.getByRole("textbox", { name: "Window name" });
    await input.fill("discard-me");
    await input.press("Escape");

    await expect(input).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: `Rename window ${name}` }),
    ).toBeVisible();
    // No rename happened — the window keeps its name in the snapshot.
    const stillNamed = await resolveWindow(page, name);
    expect(stillNamed).toBe(id);
  });

  test("command-palette rename path enters inline edit (CustomEvent wiring)", async ({
    page,
  }) => {
    const name = `head-palette-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);
    await expect(
      page.getByRole("button", { name: `Rename window ${name}` }),
    ).toBeVisible({ timeout: 10_000 });

    // The palette action dispatches this exact event (app.tsx); asserting the
    // event wiring is the stable seam (palette-item selection is covered by
    // command-palette unit tests).
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("window-heading:rename")),
    );
    await expect(page.getByRole("textbox", { name: "Window name" })).toBeVisible();
  });

  test("375px top bar stays single-line with the heading (no horizontal overflow)", async ({
    page,
  }) => {
    const name = `head-verylongwindownamethatwouldwrap-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await page.setViewportSize(MOBILE_VIEWPORT);
    // Gate readiness on the heading itself: the connection dot is `hidden
    // sm:inline`, so it is invisible at 375px and can't be the readiness signal.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);

    const heading = page.getByRole("button", { name: `Rename window ${name}` });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // No horizontal page overflow.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

    // The header row is a single line: its rendered height stays close to one
    // line of chrome (~39px: py-2 + one text line + 3px bottom border). A wrap
    // would roughly double it, so a sub-56px height proves no wrap.
    const header = page.locator("header").first();
    const box = await header.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThan(56);
  });

  test("hover treatments carry their classes; a reduced-motion context still renders them (gate is CSS-only)", async ({
    page,
    browser,
  }) => {
    const name = `head-motion-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);
    await expect(
      page.getByRole("button", { name: `Rename window ${name}` }),
    ).toBeVisible({ timeout: 10_000 });

    // Vocabulary classes are present in the DOM (class-presence is the stable
    // seam for CSS animations — no pixel assertions).
    await expect(page.locator(".rk-brand-glitch").first()).toBeAttached();
    await expect(page.locator(".rk-glint").first()).toBeAttached();

    // Under prefers-reduced-motion the classes stay (the gate is a CSS
    // @media rule that zeroes the animation — the elements are unchanged).
    const reducedCtx = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reducedCtx.newPage();
    await reducedPage.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(
      reducedPage.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(reducedPage.locator(".rk-glint").first()).toBeAttached();
    // The heading input never leaks scrambled text: opening edit shows the
    // real name even in reduced-motion (decode is skipped in JS).
    await reducedPage
      .getByRole("button", { name: `Rename window ${name}` })
      .click();
    await expect(
      reducedPage.getByRole("textbox", { name: "Window name" }),
    ).toHaveValue(name);
    await reducedCtx.close();
  });

  test("section-label caret (rk-label-caret) actually appears on hover", async ({
    page,
  }) => {
    const name = `head-caret-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    // The sidebar "SESSIONS" heading carries the shared caret-only treatment.
    // This regression guard would have caught the shipped no-op where
    // `.rk-label-caret::after` had `width: 0; overflow: hidden`, clipping the
    // ▊ glyph entirely so it never became visible on hover.
    const label = page
      .locator("nav[aria-label='Sessions'] .rk-label-caret")
      .first();
    await expect(label).toBeVisible({ timeout: 10_000 });

    const afterStyle = (el: Element) => {
      const s = getComputedStyle(el, "::after");
      return { opacity: s.opacity, content: s.content };
    };

    // At rest the caret is transparent.
    const rest = await label.evaluate(afterStyle);
    expect(rest.opacity).toBe("0");
    // The ▊ glyph is present (not `none` / removed).
    expect(rest.content).toContain("▊");

    // On hover the caret turns opaque AND actually PAINTS. Opacity alone does
    // NOT catch the original bug (opacity was `1` there too — the glyph was
    // just clipped). The caret cell is 0-width and unclipped, so the glyph
    // overflows to the RIGHT of the label box; assert that a strip immediately
    // right of the label changes rest→hover. Under the shipped no-op
    // (`width: 0; overflow: hidden`) the glyph is clipped inside the 0-width
    // box and never reaches this strip, so it would NOT change — this is the
    // discriminator (verified: buggy CSS → identical strip; fixed CSS → differs).
    const box = await label.boundingBox();
    expect(box).toBeTruthy();
    const clip = {
      x: Math.round(box!.x + box!.width),
      y: Math.round(box!.y),
      width: 12,
      height: Math.round(box!.height),
    };
    const before = await page.screenshot({ clip });
    await label.hover();
    // Land inside the caret's visible half of the 1.06s steps(1) blink.
    await page.waitForTimeout(60);
    const hoverStyle = await label.evaluate(afterStyle);
    expect(hoverStyle.opacity).toBe("1");
    const after = await page.screenshot({ clip });
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
