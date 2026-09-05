import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// Operator chat console — the pull-down overlay: chord/palette open + Esc
// close, the embedded operator terminal, compose delivery through
// POST /api/windows/{id}/send with target:"agent", the palette's
// Ask-operator fallback row, operator-absent degradation, the 375px
// full-height sheet, and inline send-error surfacing. Quake-console v2 adds:
// the true slide (mounted-through-exit), mouse resize with per-viewer
// geometry persistence, the glass background + settings-dialog opacity row,
// the top-bar ◉ standing affordance with the live state dot, the mobile
// tongue, and console-local image paste (upload to the operator window's
// session + insert-delivery) with the route terminals' strip-forward guard.
//
// Shared setup: fully mocked (no tmux). The sessions payload rides the
// state-socket mock — a work window `@1` plus, when the test wants one, an
// operator window `@9` with `role: "operator"` in `_rk-operator` — and the
// window send endpoint is stubbed via page.route with a recorded body list.
// The send AND upload route mocks carry a trailing `*` — the client appends
// `?server=` (withServer), so a bare glob would silently miss. `/ws/terminals`
// is a no-op socket mock: the console's embedded terminal mounts its xterm
// frame without needing stream data. Each spec lands on the `@1` terminal
// route (server "default") before driving the console, except the
// mobile-sheet/tongue specs, which start from the same route at 375px.
// Synthetic file pastes dispatch a real ClipboardEvent carrying a
// DataTransfer file (Chromium populates clipboardData from the init).

const SERVER = "default";
const MOBILE_VIEWPORT = { width: 375, height: 812 };

function sessionsPayload(withOperator: boolean, operatorState = "idle") {
  const work = {
    windowId: "@1",
    index: 0,
    name: "feature-work",
    worktreePath: "/tmp/wt",
    activity: "active",
    isActiveWindow: true,
    activityTimestamp: 0,
    agentState: "idle",
    panes: [
      { paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "zsh", isActive: true },
    ],
  };
  return JSON.stringify([
    { name: "dev", windows: [work] },
    ...(withOperator
      ? [
          {
            name: "_rk-operator",
            windows: [
              {
                windowId: "@9",
                index: 0,
                name: "operator",
                worktreePath: "/tmp/op",
                activity: "idle",
                isActiveWindow: false,
                activityTimestamp: 0,
                role: "operator",
                agentState: operatorState,
                panes: [
                  { paneId: "%9", paneIndex: 0, cwd: "/tmp/op", command: "claude", isActive: true },
                ],
              },
            ],
          },
        ]
      : []),
  ]);
}

type SendBehavior = { status: number; body: Record<string, unknown> };

const SEND_OK: SendBehavior = { status: 200, body: { ok: true } };

/** Install the fully-mocked backend; returns the recorded send bodies. */
async function mockBackend(
  page: Page,
  withOperator: boolean,
  behavior: SendBehavior = SEND_OK,
  operatorState = "idle",
) {
  const sendBodies: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  // The window send seam — trailing `*` required (withServer appends
  // `?server=`).
  await page.route("**/api/windows/*/send*", (route) => {
    sendBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: behavior.status,
      contentType: "application/json",
      body: JSON.stringify(behavior.body),
    });
  });
  await mockStateSocket(page, { sessions: sessionsPayload(withOperator, operatorState) });
  return sendBodies;
}

/** Stub the file-upload endpoint (multipart body — only the URL/session is
 *  asserted). Trailing `*` like the send mock. Returns the hit list. */
async function mockUploads(page: Page) {
  const uploads: { session: string; url: string }[] = [];
  await page.route("**/api/sessions/*/upload*", (route) => {
    const url = route.request().url();
    const session = decodeURIComponent(/\/api\/sessions\/([^/]+)\/upload/.exec(url)?.[1] ?? "");
    uploads.push({ session, url });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, path: "/tmp/op/.uploads/shot.png" }),
    });
  });
  return uploads;
}

/** Dispatch a real file-carrying paste event at the element matching
 *  `selector` (Chromium fills clipboardData from the event init). */
async function pasteImage(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) throw new Error(`paste target not found: ${sel}`);
    const dt = new DataTransfer();
    dt.items.add(new File(["fake-png"], "shot.png", { type: "image/png" }));
    target.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, selector);
}

const WINDOW_URL = `/${SERVER}/%401`;

async function gotoWindow(page: Page) {
  await page.goto(WINDOW_URL);
  await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });
}

const console_ = (page: Page) => page.getByTestId("operator-console");
const composeInput = (page: Page) => page.getByRole("textbox", { name: "Message the operator" });

test.describe("Operator console", () => {
  /**
   * Proves: the console chord (⇧Ctrl+J on this host) opens the pull-down
   * console on the terminal route — title strip naming the route's server,
   * embedded live terminal frame for the operator window, compose input
   * focused — and Escape closes it without navigation.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the @1 terminal route.
   * 2. Press Shift+Control+j; assert the console is visible with
   *    `◉ OPERATOR · default` in the title strip.
   * 3. Assert an xterm frame renders inside the console and the compose input
   *    has focus.
   * 4. Press Escape; assert the console is gone and the URL is unchanged.
   */
  test("chord opens the console with the operator terminal and compose focused; Esc closes", async ({
    page,
  }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toBeVisible();
    await expect(console_(page).getByText("◉ OPERATOR")).toBeVisible();
    await expect(console_(page).getByText("· default")).toBeVisible();
    await expect(console_(page).locator(".xterm")).toBeAttached({ timeout: 10_000 });
    await expect(composeInput(page)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(console_(page)).toHaveCount(0);
    expect(page.url()).toContain(WINDOW_URL);
  });

  /**
   * Proves: the palette carries the `Operator: Open console` action (the
   * action registry of record), and selecting it opens the console.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the terminal route.
   * 2. Open the palette, filter to `Operator: Open console`, select the row.
   * 3. Assert the console is visible.
   */
  test("palette action 'Operator: Open console' opens the console", async ({ page }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("Open console");
    await page.getByRole("option", { name: "Operator: Open console" }).click();

    await expect(console_(page)).toBeVisible();
  });

  /**
   * Proves: the palette free-text fallback — a query matching no action on an
   * operator-bearing server renders the `Ask operator: "{query}"` row, and
   * Enter on it closes the palette, opens the console, and fires exactly one
   * `send` POST with `{text, mode: "submit", target: "agent"}` at the
   * operator window.
   *
   * Steps:
   * 1. Mock the backend with an operator window and a 200 send stub; land on
   *    the terminal route.
   * 2. Open the palette and type a query matching no action.
   * 3. Assert the fallback row renders and the "No results" line does not.
   * 4. Press Enter; assert the palette closed, the console opened, and the
   *    recorded send body matches the query with the agent target.
   */
  test("palette fallback row opens the console and immediately sends the query via target:agent", async ({
    page,
  }) => {
    const sendBodies = await mockBackend(page, true);
    await gotoWindow(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("the fence deploy is wedged");
    await expect(
      page.getByRole("option", { name: 'Ask operator: "the fence deploy is wedged"' }),
    ).toBeVisible();
    await expect(page.getByText(/^No results/)).toHaveCount(0);

    await paletteInput.press("Enter");
    await expect(paletteInput).toHaveCount(0);
    await expect(console_(page)).toBeVisible();
    await expect
      .poll(() => sendBodies)
      .toEqual([{ text: "the fence deploy is wedged", mode: "submit", target: "agent" }]);
  });

  /**
   * Proves: the fallback row's length floor — a 2-character query matching no
   * action renders no `Ask operator` row (typo fragments never fire a send).
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the terminal route.
   * 2. Open the palette and type a 2-character query matching no action.
   * 3. Assert no `Ask operator` row renders.
   */
  test("the fallback row is absent below the 3-character query floor", async ({ page }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("zq");
    await expect(page.getByRole("option", { name: /^Ask operator:/ })).toHaveCount(0);
  });

  /**
   * Proves: degrade-to-absent — with no `role: "operator"` window on the
   * server, the console opens to a single hint line (no terminal stream, no
   * compose strip) and the palette renders no fallback row.
   *
   * Steps:
   * 1. Mock the backend WITHOUT an operator window; land on the terminal
   *    route.
   * 2. Open the console via the chord; assert the hint line, and no xterm or
   *    compose input inside the console.
   * 3. Open the palette, type a floor-length query matching no action; assert
   *    no `Ask operator` row.
   */
  test("no operator on the server renders the hint line and omits the fallback row", async ({
    page,
  }) => {
    await mockBackend(page, false);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toBeVisible();
    await expect(page.getByTestId("operator-console-empty")).toHaveText(
      "no operator on this server — run `rk operator`",
    );
    await expect(console_(page).locator(".xterm")).toHaveCount(0);
    await expect(console_(page).getByRole("textbox")).toHaveCount(0);

    await page.keyboard.press("Escape");
    const paletteInput = await openPalette(page);
    await paletteInput.fill("the fence deploy is wedged");
    await expect(page.getByRole("option", { name: /^Ask operator:/ })).toHaveCount(0);
  });

  /**
   * Proves: a structured send failure (409 from the injection engine)
   * surfaces INLINE in the console — the server's message between terminal
   * and compose, no toast — and the composed text survives for retry.
   *
   * Steps:
   * 1. Mock the backend with an operator window and a 409 send stub carrying
   *    the probe-failure message; land on the terminal route.
   * 2. Open the console via the chord, type a message, press Enter.
   * 3. Assert the send fired, the inline error line carries the server's
   *    message, and the compose input still holds the text.
   */
  test("a structured 409 send failure surfaces inline with the composed text preserved", async ({
    page,
  }) => {
    const sendBodies = await mockBackend(page, true, {
      status: 409,
      body: { error: "probe failed: no novelty echo" },
    });
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toBeVisible();
    const input = composeInput(page);
    await input.fill("restart the worker");
    await input.press("Enter");

    await expect.poll(() => sendBodies).toHaveLength(1);
    await expect(page.getByTestId("operator-console-error")).toHaveText("probe failed: no novelty echo");
    await expect(input).toHaveValue("restart the worker");
  });

  /**
   * Proves: at 375px the console is a full-height sheet UNDER the top bar —
   * the bar stays visible and functional, the sheet covers the main area, and
   * no horizontal page overflow is introduced. Entry rides the top-bar
   * overflow menu's `Operator console` row (no keyboard on a phone).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with an operator window;
   *    land on the terminal route.
   * 2. Open the `More controls` chevron menu and select `Operator console`.
   * 3. Assert the sheet is visible, its top edge sits at/below the top bar's
   *    bottom edge, and the top bar's chevron is still visible.
   * 4. Assert `document.body.scrollWidth` ≤ 375 (no horizontal overflow).
   */
  test("mobile: the console is a full-height sheet under the top bar with no horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, true);
    await gotoWindow(page);

    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    await chevron.click();
    await page.getByRole("menu", { name: "More controls" })
      .getByRole("menuitem", { name: /Operator console/ })
      .click();

    const sheet = console_(page);
    await expect(sheet).toBeVisible();
    await expect(chevron).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    const chevronBox = await chevron.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(chevronBox).not.toBeNull();
    expect(sheetBox!.y).toBeGreaterThanOrEqual(chevronBox!.y + chevronBox!.height - 1);
    // The sheet spans the full main-area width at the viewport edges.
    expect(sheetBox!.x).toBeLessThanOrEqual(1);
    expect(sheetBox!.width).toBeGreaterThanOrEqual(MOBILE_VIEWPORT.width - 1);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  test.describe("slide animation", () => {
    // The rig emulates reducedMotion:"reduce" globally — the slide semantics
    // need real motion (the window-switch-transition.spec.ts opt-out).
    test.use({ contextOptions: { reducedMotion: "no-preference" } });

    /**
     * Proves: the desktop drawer is a true quake slide — it carries the slide
     * class and settles out of the raised pose on open, and on Esc it stays
     * MOUNTED with the raised class while the exit slide runs (the stream
     * tears down after the slide, not mid-animation), then unmounts.
     *
     * Steps:
     * 1. Mock the backend with an operator window; land on the terminal route.
     * 2. Open via the chord; assert the slide class and wait out the raised
     *    (entering) pose.
     * 3. Press Escape; assert the drawer is still attached WITH the raised
     *    class (mid-exit-slide), then detaches.
     */
    test("the desktop drawer slides in and stays mounted through the exit slide", async ({
      page,
    }) => {
      await mockBackend(page, true);
      await gotoWindow(page);

      await page.keyboard.press("Shift+Control+j");
      const el = console_(page);
      await expect(el).toBeVisible();
      await expect(el).toHaveClass(/rk-console-slide/);
      await expect(el).not.toHaveClass(/rk-console-closed/);

      await page.keyboard.press("Escape");
      await expect(el).toHaveClass(/rk-console-closed/);
      await expect(el).toHaveCount(0);
    });
  });
  /**
   * Proves: the hanging tongue grip drags the drawer's height (clamped at
   * 85vh), the new geometry persists to `runkit-operator-console-geometry`,
   * and a reload reopens the drawer at the persisted size.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the terminal route
   *    and open the console.
   * 2. Drag the height grip a full viewport-height down; assert the drawer
   *    grew and the style pins at the 85vh clamp.
   * 3. Assert the localStorage key holds heightVh 85.
   * 4. Reload, reopen via the chord; assert the drawer renders at 85vh.
   */
  test("dragging the height grip resizes the drawer and persists the geometry across reload", async ({
    page,
  }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    const el = console_(page);
    await expect(el).toBeVisible();
    await expect(el).not.toHaveClass(/rk-console-closed/);
    const before = await el.boundingBox();
    expect(before).not.toBeNull();

    const grip = page.getByTestId("operator-console-grip-height");
    const gripBox = await grip.boundingBox();
    expect(gripBox).not.toBeNull();
    const x = gripBox!.x + gripBox!.width / 2;
    await page.mouse.move(x, gripBox!.y + 2);
    await page.mouse.down();
    // A full-viewport drag overshoots the clamp: height pins at 85vh.
    await page.mouse.move(x, gripBox!.y + 720, { steps: 6 });
    await page.mouse.up();

    await expect(el).toHaveAttribute("style", /height: 85vh/);
    const during = await el.boundingBox();
    expect(during!.height).toBeGreaterThan(before!.height);
    const stored = await page.evaluate(() =>
      localStorage.getItem("runkit-operator-console-geometry"),
    );
    expect(stored).toContain('"heightVh":85');

    await page.reload();
    await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toHaveAttribute("style", /height: 85vh/);
  });

  /**
   * Proves: the desktop drawer is glass — bg-primary at the per-viewer α
   * (default 0.90) over a fixed 6px backdrop blur — and the settings dialog's
   * "Operator console opacity" row (a localStorage resident, no settings API)
   * live-applies to the OPEN drawer; α=1 disables the blur, and the value
   * survives reload.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the terminal route
   *    and open the console; assert the 0.90 computed background + blur.
   * 2. Open the settings dialog (top-bar gear), switch to Appearance, and
   *    step the opacity slider down; assert the drawer's computed background
   *    changed live and the localStorage key holds 0.85.
   * 3. Push the slider to the max (End key); assert no backdrop-filter.
   * 4. Reload, reopen; assert the persisted 1.0 background is opaque.
   */
  test("the glass opacity setting live-applies and survives reload; α=1 drops the blur", async ({
    page,
  }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    const el = console_(page);
    await expect(el).toBeVisible();

    // Theme-agnostic α read: Chromium serializes the color-mix result as
    // `color(srgb … / α)` — the alpha is the setting, the RGB rides the theme.
    const readAlpha = () =>
      el.evaluate((n) => {
        const bg = getComputedStyle(n).backgroundColor;
        const m = /\/\s*([\d.]+)\)$/.exec(bg);
        return m ? Number(m[1]) : 1;
      });

    await expect(el).toHaveCSS("backdrop-filter", "blur(6px)");
    await expect.poll(readAlpha).toBe(0.9);

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("tab", { name: "Appearance" }).click();
    const slider = page.getByRole("slider", { name: "Operator console opacity" });
    await expect(slider).toBeVisible();
    await slider.click();
    await slider.press("ArrowDown");
    await expect.poll(readAlpha).toBe(0.85);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("runkit-operator-console-opacity")))
      .toBe("0.85");

    await slider.press("End");
    await expect.poll(readAlpha).toBe(1);
    await expect(el).toHaveCSS("backdrop-filter", "none");

    await page.reload();
    await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toHaveCSS("backdrop-filter", "none");
    await expect
      .poll(() =>
        console_(page).evaluate((n) => {
          const bg = getComputedStyle(n).backgroundColor;
          const m = /\/\s*([\d.]+)\)$/.exec(bg);
          return m ? Number(m[1]) : 1;
        }),
      )
      .toBe(1);
  });

  /**
   * Proves: the desktop top bar carries the ◉ operator button as the standing
   * affordance — a live state dot (amber for a waiting operator) — and a
   * click toggles the console through the shared event seam.
   *
   * Steps:
   * 1. Mock the backend with a WAITING operator; land on the terminal route.
   * 2. Assert the ◉ button renders in the right cluster with the amber dot.
   * 3. Click it; assert the console opens. Click again; assert it closes.
   */
  test("the top-bar ◉ button shows the waiting dot and toggles the console", async ({ page }) => {
    await mockBackend(page, true, SEND_OK, "waiting");
    await gotoWindow(page);

    // The fit probe renders an aria-hidden duplicate — getByRole excludes it.
    const button = page.getByRole("button", { name: /^Operator console/ });
    await expect(button).toBeVisible();
    const dot = page.getByTestId("operator-console-button-state").first();
    await expect(dot).toHaveAttribute("data-state", "waiting");
    await expect(dot).toHaveClass(/bg-signal-yellow/);

    await button.click();
    await expect(console_(page)).toBeVisible();
    await button.click();
    await expect(console_(page)).toHaveCount(0);
  });

  /**
   * Proves: on mobile the tongue under the top bar is the STANDING affordance
   * — always visible while the console is closed (with the amber waiting
   * dot), a tap opens the sheet, it hides while the sheet is open, the
   * desktop ◉ button is absent, and no horizontal overflow is introduced.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with a waiting operator;
   *    land on the terminal route.
   * 2. Assert the tongue is visible with the waiting dot and the ◉ button is
   *    absent.
   * 3. Tap the tongue; assert the sheet opens and the tongue hides.
   * 4. Assert `document.body.scrollWidth` ≤ 375.
   */
  test("mobile: the tongue is the standing affordance (waiting dot, tap opens, no overflow)", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, true, SEND_OK, "waiting");
    await gotoWindow(page);

    const tongue = page.getByTestId("operator-console-tongue");
    await expect(tongue).toBeVisible();
    await expect(page.getByTestId("operator-console-tongue-waiting")).toBeVisible();
    await expect(page.getByTestId("operator-console-button")).toHaveCount(0);

    await tongue.click();
    await expect(console_(page)).toBeVisible();
    await expect(tongue).toHaveCount(0);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  /**
   * Proves: an image ⌘V inside the console uploads to the OPERATOR window's
   * session (`_rk-operator`) and insert-delivers the returned path to the
   * operator pane (mode "raw", target "agent", never submitted) — and the
   * route terminals' strip-forward guard keeps the paste OFF the tab below
   * (no upload to the route's `dev` session). Both focus targets are covered:
   * the embedded terminal's xterm textarea (the console root's CAPTURE-phase
   * handler — xterm stops bubble propagation) and the compose textarea (the
   * bubble path the route terminals' document listeners guard against).
   *
   * Steps:
   * 1. Mock the backend with an operator window plus the upload endpoint;
   *    land on the terminal route and open the console.
   * 2. Dispatch a file-carrying paste at the console's embedded xterm helper
   *    textarea; assert one upload to `_rk-operator` and one raw/agent send.
   * 3. Dispatch a second paste at the console's compose textarea; assert a
   *    second upload/send pair.
   * 4. Assert no upload ever hit the route session.
   */
  test("image paste inside the console uploads to the operator session and insert-delivers the path", async ({
    page,
  }) => {
    const sendBodies = await mockBackend(page, true);
    const uploads = await mockUploads(page);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toBeVisible();
    await expect(
      console_(page).locator(".xterm-helper-textarea"),
    ).toBeAttached({ timeout: 10_000 });

    await pasteImage(page, '[data-testid="operator-console"] .xterm-helper-textarea');
    await expect.poll(() => uploads.map((u) => u.session)).toEqual(["_rk-operator"]);
    await expect
      .poll(() => sendBodies)
      .toEqual([{ text: "/tmp/op/.uploads/shot.png ", mode: "raw", target: "agent" }]);

    await pasteImage(page, '[aria-label="Message the operator"]');
    await expect
      .poll(() => uploads.map((u) => u.session))
      .toEqual(["_rk-operator", "_rk-operator"]);
    await expect.poll(() => sendBodies).toHaveLength(2);
    expect(uploads.some((u) => u.session === "dev")).toBe(false);
  });

  /**
   * Proves: with the console CLOSED, a file paste on the page still forwards
   * to the compose strip exactly as before — the guard only excludes
   * console-origin pastes. (The strip forward rides the route terminal's
   * document-level listener, which only ever sees pastes whose target lies
   * OUTSIDE an xterm — xterm's own textarea handler stops propagation — so
   * the reachable production path is a paste with focus outside the
   * terminal.)
   *
   * Steps:
   * 1. Mock the backend with an operator window plus the upload endpoint;
   *    land on the terminal route (console never opened).
   * 2. Dispatch a file-carrying paste at the page body.
   * 3. Assert one upload to the route's `dev` session (the strip's focused
   *    target) and no console involvement.
   */
  test("file paste outside the terminal still forwards to the compose strip when the console is closed", async ({
    page,
  }) => {
    await mockBackend(page, true);
    const uploads = await mockUploads(page);
    await gotoWindow(page);
    await expect(page.locator(".xterm").first()).toBeAttached({ timeout: 10_000 });

    await pasteImage(page, "body");

    await expect.poll(() => uploads.map((u) => u.session), { timeout: 10_000 }).toEqual(["dev"]);
    await expect(console_(page)).toHaveCount(0);
  });
});
