import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// Operator chat console — the pull-down overlay: chord/palette open + Esc
// close, the embedded operator terminal, compose delivery through
// POST /api/windows/{id}/send with target:"agent", the palette's
// Ask-operator fallback row, operator-absent degradation, the 375px
// full-height sheet, and inline send-error surfacing.
//
// Shared setup: fully mocked (no tmux). The sessions payload rides the
// state-socket mock — a work window `@1` plus, when the test wants one, an
// operator window `@9` with `role: "operator"` in `_rk-operator` — and the
// window send endpoint is stubbed via page.route with a recorded body list.
// The send route mock carries a trailing `*` — the client appends `?server=`
// (withServer), so a bare glob would silently miss. `/ws/terminals` is a
// no-op socket mock: the console's embedded terminal mounts its xterm frame
// without needing stream data. Each spec lands on the `@1` terminal route
// (server "default") before driving the console, except the mobile-sheet
// spec, which starts from the same route at 375px.

const SERVER = "default";
const MOBILE_VIEWPORT = { width: 375, height: 812 };

function sessionsPayload(withOperator: boolean) {
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
                agentState: "idle",
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
async function mockBackend(page: Page, withOperator: boolean, behavior: SendBehavior = SEND_OK) {
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
  await mockStateSocket(page, { sessions: sessionsPayload(withOperator) });
  return sendBodies;
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
});
