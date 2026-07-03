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

// File-level session lifecycle: shared by BOTH describe blocks below (the
// reduced-motion default block and the animated-path opt-in block), so the
// teardown must not run between them.
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

test.describe("Window heading (centered, editable) + hover vocabulary", () => {
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

    // The typed-label sweep is JS-gated on the same media query: hovering a
    // section label in the reduced context must never start a sweep (no
    // cursor cell, no bright done state) — the rest state IS the reduced
    // state.
    const reducedLabel = reducedPage
      .locator("nav[aria-label='Sessions'] .rk-typed-label", {
        hasText: /^Sessions$/,
      })
      .first();
    // Dispatched event (not real hover) — same churn-proof seam as the
    // animated-path test; a dispatched enter makes this a TRUE negative
    // (the handler ran and declined) rather than a possibly-missed hover.
    await reducedLabel.dispatchEvent("pointerover");
    await reducedPage.waitForTimeout(450); // longer than one full ~350ms pass
    await expect(reducedLabel.locator(".rk-typed-cursor")).not.toBeAttached();
    await expect(reducedLabel).not.toHaveClass(/rk-typed-done/);

    await reducedCtx.close();
  });
});

/**
 * Animated-path block. `playwright.config.ts` emulates `reducedMotion:
 * "reduce"` globally (window-switch transition stabilization) and the
 * typed-label sweep honors that gate by never starting — so asserting the
 * sweep needs real motion. Opt back in per the convention
 * `window-switch-transition.spec.ts` documents: `contextOptions` is the only
 * seam that reaches the browser context in this Playwright version.
 */
test.describe("Window heading — animated path (motion opted back in)", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("section labels type themselves out on hover (typed sweep)", async ({
    page,
  }) => {
    const name = `head-typed-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    // The sidebar "Sessions" heading carries the shared typed-sweep treatment
    // (TypedLabel). All assertions are DOM-observable (no pixel diffs, per the
    // PR's "NO pixel assertions" e2e constraint): the sweep manifests as real
    // frame-state spans and a terminal `rk-typed-done` class.
    // The sidebar nav holds several TypedLabels (panel titles like "Boards"
    // render before the region heading), so pin the target by its exact text.
    const label = page
      .locator("nav[aria-label='Sessions'] .rk-typed-label", {
        hasText: /^Sessions$/,
      })
      .first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    await expect(label).toHaveText("Sessions");
    await expect(label).not.toHaveClass(/rk-typed-done/);

    // Drive the sweep via dispatched pointer events rather than real mouse
    // hit-testing: the sidebar re-layouts under SSE churn on CI runners, and
    // a label shifting beneath a stationary pointer fires spurious
    // enter/leave events that cancel the sweep mid-pass (or swallow the
    // unhover) — exactly the flake this replaced. React 19 attaches
    // derives onPointerEnter/Leave from delegated pointerover/pointerout
    // pairs (relatedTarget null = from outside), so dispatched over/out
    // exercise the same component handlers the real pointer does.
    await label.dispatchEvent("pointerover");
    // The sweep starts: an inverse-video cursor cell appears synchronously on
    // the first character (the ~350ms pass outlasts the first assertion poll).
    await expect(label.locator(".rk-typed-cursor")).toBeAttached({
      timeout: 2_000,
    });

    // The pass completes: frame spans collapse back to plain text, held
    // bright via rk-typed-done, with the label text fully intact.
    await expect(label).toHaveClass(/rk-typed-done/, { timeout: 2_000 });
    await expect(label.locator(".rk-typed-cursor")).not.toBeAttached();
    await expect(label).toHaveText("Sessions");

    // Pointer leave resets to the rest state.
    await label.dispatchEvent("pointerout");
    await expect(label).not.toHaveClass(/rk-typed-done/);
    await expect(label).toHaveText("Sessions");
  });
});
