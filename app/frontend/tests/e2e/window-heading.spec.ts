import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-heading-${Date.now()}`;
// Board name for the board-mode centered-heading test (alphanumeric only).
const BOARD_NAME = `head${Date.now().toString().slice(-6)}`;
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
    // The universal `Terminal:` page-type prefix (260704-pr0p) renders as a
    // static sibling OUTSIDE the rename button (clicking it must not edit).
    const prefix = page.getByText(/Terminal:/);
    await expect(prefix).toBeVisible();
    const prefixInButton = await heading.evaluate(
      (btn, pfx) => btn.contains(pfx),
      await prefix.elementHandle(),
    );
    expect(prefixInButton).toBe(false);
  });

  test("root route shows the centered `Server Cabin: <server>` heading (not a left leaf crumb)", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);
    // The server name is the CENTERED heading leaf (move-don't-copy) — its
    // accessible name carries the `Server Cabin` type prefix.
    const heading = page.getByLabel(`Server Cabin ${TMUX_SERVER}`);
    await expect(heading).toBeVisible({ timeout: 10_000 });
    // It is display-only — no rename button on the Server Cabin.
    await expect(
      page.getByRole("button", { name: /Rename window/ }),
    ).toHaveCount(0);
    // The name is not duplicated as a left breadcrumb crumb.
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav).not.toContainText(TMUX_SERVER);
  });

  test("cockpit route (/) shows the solo `Cockpit` center heading and bracket section headings", async ({
    page,
  }) => {
    await page.goto("/");
    // Solo type word — no prefix, no instance name.
    await expect(page.getByLabel("Cockpit")).toBeVisible({
      timeout: 10_000,
    });
    // The in-page PageHeading `<h1>` row is gone; page identity is the top bar.
    await expect(page.locator("h1")).toHaveCount(0);
    // The four zone labels render as bracket section headings (<h2>), each with
    // the reserved caret cell and brackets around a TypedLabel.
    const hostHealth = page.getByRole("heading", { level: 2, name: "Host Health" });
    await expect(hostHealth).toBeVisible();
    // The bracket idiom: `[`/`]` + reserved `▊` caret sit around the label.
    const group = page
      .locator(".rk-bracket-group", { has: hostHealth })
      .first();
    await expect(group.locator(".rk-bracket-open")).toHaveText("[");
    await expect(group.locator(".rk-bracket-close")).toHaveText("]");
    await expect(group.locator(".rk-bracket-caret")).toBeAttached();
    await expect(group.locator(".rk-typed-label")).toHaveText("Host Health");
  });

  test("board route shows the centered `Board: <name>` heading + relocated ▾ switcher (name display-only, no left `Board ▸`)", async ({
    page,
  }) => {
    // A board needs a pinned window. Create one, pin it via the API (the same
    // deterministic seam boards-pin-flow.spec.ts uses), then navigate.
    const name = `head-board-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const winId = await resolveWindow(page, name);

    const pinRes = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
      data: { server: TMUX_SERVER, windowId: winId },
    });
    expect(pinRes.ok()).toBeTruthy();

    try {
      await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });

      // The board name is the CENTERED heading leaf (move-don't-copy) — its
      // accessible name carries the `Board` type prefix.
      const heading = page.getByLabel(`Board ${BOARD_NAME}`);
      await expect(heading).toBeVisible({ timeout: 10_000 });
      // The ▾ board switcher relocated from the left breadcrumb to the center,
      // beside the board name.
      await expect(page.getByLabel("Switch board")).toBeVisible();
      // Display-only — boards have no rename API, so no rename button.
      await expect(
        page.getByRole("button", { name: /Rename window/ }),
      ).toHaveCount(0);
      // Move-don't-copy: the board name is not duplicated as a left breadcrumb
      // crumb, and the old left `Board ▸` home button is gone.
      const nav = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(nav).not.toContainText(BOARD_NAME);
      await expect(nav).not.toContainText("Board ▸");
    } finally {
      // Unpin so the (empty) board disappears — keep the shared server clean.
      await page.request.post(`/api/boards/${BOARD_NAME}/unpin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
    }
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

    // Truncation is left-anchored, not center-clipped: the name lives in an
    // inner `truncate` span whose box must fit INSIDE the button. Under the
    // old center-clip bug (truncate on the flex button itself), the text box
    // was wider than the button and overhung BOTH ends — the head of the name
    // was cut and no ellipsis rendered (riff-blustery-whale → "iff-…-whal").
    const nameSpan = heading.locator("span").first();
    const headingBox = (await heading.boundingBox())!;
    const spanBox = (await nameSpan.boundingBox())!;
    expect(spanBox.x).toBeGreaterThanOrEqual(headingBox.x - 1);
    expect(spanBox.x + spanBox.width).toBeLessThanOrEqual(
      headingBox.x + headingBox.width + 1,
    );
    // The full name is still the accessible text (ellipsis is visual only).
    await expect(nameSpan).toHaveText(name);
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

  test("terminal page heading runs the boot sweep on hover: cursor cell attaches, then resolves to rest", async ({
    page,
  }) => {
    const name = `head-sweep-${Date.now()}`;
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`, {
      stdio: "ignore",
    });
    const id = await resolveWindow(page, name);
    await gotoWindow(page, id);

    const heading = page.getByRole("button", { name: `Rename window ${name}` });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    // Let any mount-replay sweep settle before driving a fresh hover pass (the
    // mount leg auto-plays once on navigation; DECODE_HOVER_INTENT_MS + a full
    // ~28ms/cell pass is well under this wait).
    await page.waitForTimeout(1_200);

    // The boot sweep's cursor/churn cells live inside the top-bar header (the
    // prefix sibling + the name button). Scope cursor assertions to the header
    // so the sidebar TypedLabels (not hovered here) can't be mistaken for them.
    const headerCursor = page.locator("header .rk-typed-cursor");
    await expect(headerCursor).toHaveCount(0);

    // Drive the sweep via a dispatched `mouseover` (React derives the button's
    // onMouseEnter from mouseover/mouseout) — the same churn-proof seam the
    // typed-sweep test uses, avoiding real hit-testing flake. playDeferred waits
    // DECODE_HOVER_INTENT_MS (140ms) before the first frame.
    await heading.dispatchEvent("mouseover");
    // An inverse-video cursor cell appears inside the header during the sweep.
    await expect(headerCursor.first()).toBeAttached({ timeout: 2_000 });

    // Pass completes (or mouseout cancels): cells collapse back to plain text,
    // no cursor cell remains, and the accessible name is intact.
    await heading.dispatchEvent("mouseout");
    await expect(page.locator("header .rk-typed-cursor")).toHaveCount(0, {
      timeout: 2_000,
    });
    await expect(heading).toHaveText(name);
  });
});
