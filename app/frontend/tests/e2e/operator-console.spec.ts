import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// Operator chat console — the pull-down overlay: the ⌘J three-state cycle
// (rest → omnibox-focused → drawer-open → rest), the desktop omnibox in the
// top-bar center cell (standing at ≥ lg beside the compact heading, ghost +
// in-place morph at md–lg) as the console's relocated compose, the one-input
// rule (the desktop drawer is output-only with the status/error line at its
// top edge), the palette action + Ask-operator fallback row, operator-absent
// degradation, and inline send-error surfacing. Quake-console v2 carries: the
// true slide (mounted-through-exit), mouse resize with per-viewer geometry
// persistence, the glass background + settings-dialog opacity row, the
// top-bar ◉ standing affordance with the live state dot, and console/omnibox
// image paste (upload to the operator window's session + insert-delivery)
// with the route terminals' strip-forward guard. On MOBILE there is no
// sheet: every console entry point navigates to the operator window's
// ordinary terminal route (the tongue is the standing affordance, an
// operator-less server toasts the hint instead), the palette fallback's
// query lands as the route's compose-strip draft unsent, and the origin
// window rides `?from=` so the operator route's compose strip keeps the
// templated chat lane behind its dismissable context chip — with a subject
// attached, sends POST
// /api/windows/{subjectId}/operator-request {template:"user-message", text}
// instead of the direct /send lane (chip dismissed, or a subject-less route,
// keeps the direct lane).
//
// Shared setup: fully mocked (no tmux). The sessions payload rides the
// state-socket mock — a work window `@1` plus, when the test wants one, an
// operator window `@9` with `role: "operator"` in `_rk-operator` — and BOTH
// send endpoints (window send + window operator-request) are stubbed via
// page.route with recorded call lists.
// The route mocks carry a trailing `*` — the client appends `?server=`
// (withServer), so a bare glob would silently miss. `/ws/terminals`
// is a no-op socket mock: the console's embedded terminal mounts its xterm
// frame without needing stream data. Each spec lands on the `@1` terminal
// route (server "default") before driving the console, except the mobile
// specs, which run at 375px and gate arrivals on the terminal's
// `__rkTerminals` registration (not the desktop visible-text gate), the
// no-subject chip spec (the tmux Server route), and the morph-rung spec,
// which runs at 900px (between the mobile rule and lg).
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

/** Install the fully-mocked backend; returns the recorded send/request calls. */
async function mockBackend(
  page: Page,
  withOperator: boolean,
  behavior: SendBehavior = SEND_OK,
  operatorState = "idle",
) {
  const sendBodies: Record<string, unknown>[] = [];
  const requestCalls: { url: string; body: Record<string, unknown> }[] = [];
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
  // The templated chat lane — same trailing-`*` rule.
  await page.route("**/api/windows/*/operator-request*", (route) => {
    requestCalls.push({
      url: route.request().url(),
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    return route.fulfill({
      status: behavior.status,
      contentType: "application/json",
      body: JSON.stringify(behavior.body),
    });
  });
  await mockStateSocket(page, { sessions: sessionsPayload(withOperator, operatorState) });
  return { sendBodies, requestCalls };
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
const omniboxInput = (page: Page) => page.getByTestId("operator-omnibox-input");

/** The operator window's route (what every mobile console entry point
 *  navigates to) — `/default/9` with the origin window carried in `?from=`. */
const OPERATOR_PATH = `/${SERVER}/9`;

function operatorUrl(from?: string) {
  const url = new URL(`http://localhost${OPERATOR_PATH}`);
  if (from) url.searchParams.set("from", from);
  return `${url.pathname}${url.search}`;
}

/** Assert the current URL is the operator route (optionally with `?from=`). */
async function expectOperatorRoute(page: Page, from?: string) {
  await expect(page).toHaveURL(operatorUrl(from), { timeout: 10_000 });
}

/** Mobile-pattern arrival: direct `goto` + a poll on the terminal's
 *  `__rkTerminals` registration (the mobile specs' gate — the desktop specs'
 *  visible-text gate is not the mobile idiom). */
async function gotoWindowMobile(page: Page, windowId = "@1") {
  await page.goto(`/${SERVER}/${encodeURIComponent(windowId)}`);
  await expect
    .poll(
      () =>
        page.evaluate(
          (wid) =>
            Boolean(
              (window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.[wid],
            ),
          windowId,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Open the desktop drawer from rest: the first chord press only focuses the
 *  omnibox (the three-state cycle); the second opens the drawer. */
async function openDrawerViaChord(page: Page) {
  await page.keyboard.press("Shift+Control+j");
  await expect(omniboxInput(page)).toBeFocused();
  await page.keyboard.press("Shift+Control+j");
  await expect(console_(page)).toBeVisible();
}

test.describe("Operator console", () => {
  /**
   * Proves: the console chord (⇧Ctrl+J on this host) drives the three-state
   * cycle — rest → omnibox-focused (drawer closed) → drawer-open (a peek,
   * nothing sent) → rest — and Escape steps back one level at a time (open →
   * focused keeps the omnibox focused; focused → rest blurs it), all without
   * navigation.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the @1 terminal route.
   * 2. Press Shift+Control+j; assert the omnibox is focused and the drawer is
   *    absent.
   * 3. Press it again; assert the drawer is visible with `◉ OPERATOR ·
   *    default` in the title strip, an xterm frame inside, NO compose strip
   *    (output-only drawer), and focus still in the omnibox.
   * 4. Press it a third time; assert the drawer is gone and the omnibox no
   *    longer holds focus.
   * 5. Re-open, then press Escape twice; assert the drawer closes on the
   *    first (omnibox keeps focus) and the second blurs the omnibox, with the
   *    URL unchanged throughout.
   */
  test("the chord cycles rest → focused → open → rest and Esc steps back one level", async ({
    page,
  }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    await page.keyboard.press("Shift+Control+j");
    await expect(omniboxInput(page)).toBeFocused();
    await expect(console_(page)).toHaveCount(0);

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toBeVisible();
    await expect(console_(page).getByText("◉ OPERATOR")).toBeVisible();
    await expect(console_(page).getByText("· default")).toBeVisible();
    await expect(console_(page).locator(".xterm")).toBeAttached({ timeout: 10_000 });
    // Output-only drawer: the compose textbox is gone (the xterm helper
    // textarea inside the embedded terminal is not a compose input).
    await expect(console_(page).getByRole("textbox", { name: "Message the operator" })).toHaveCount(0);
    await expect(console_(page).getByRole("button", { name: "Send" })).toHaveCount(0);
    await expect(omniboxInput(page)).toBeFocused();

    await page.keyboard.press("Shift+Control+j");
    await expect(console_(page)).toHaveCount(0);
    await expect(omniboxInput(page)).not.toBeFocused();

    await openDrawerViaChord(page);
    await page.keyboard.press("Escape");
    await expect(console_(page)).toHaveCount(0);
    await expect(omniboxInput(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(omniboxInput(page)).not.toBeFocused();
    expect(page.url()).toContain(WINDOW_URL);
  });

  /**
   * Proves: at ≥ lg the center cell carries the compact heading (the `Tab:`
   * prefix span hidden, the name click-to-rename and ▾ switcher untouched)
   * beside the STANDING omnibox, and Enter on a typed message fires exactly
   * one send and auto-opens the drawer with focus retained — on this terminal
   * route the context chip is attached, so the send rides the templated chat
   * lane at the subject window (no direct send fires).
   *
   * Steps:
   * 1. Mock the backend with an operator window and 200 stubs; land on the
   *    terminal route.
   * 2. Assert the omnibox is visible, the `Tab:` prefix is hidden, and the
   *    rename button + ▾ switcher still render.
   * 3. Type a message into the omnibox and press Enter.
   * 4. Assert one recorded operator-request `{template: "user-message",
   *    text}` at @1 and no direct send, the drawer open, and the omnibox
   *    still focused with its draft cleared.
   */
  test("≥ lg: the standing omnibox sends on Enter and auto-opens the drawer", async ({ page }) => {
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await gotoWindow(page);

    await expect(omniboxInput(page)).toBeVisible();
    await expect(page.getByText("Tab:", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Rename tab feature-work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch tab" })).toBeVisible();

    await omniboxInput(page).click();
    await omniboxInput(page).fill("restart the worker");
    await omniboxInput(page).press("Enter");

    await expect
      .poll(() => requestCalls.map((c) => ({ path: new URL(c.url).pathname, body: c.body })))
      .toEqual([
        {
          path: "/api/windows/%401/operator-request",
          body: { template: "user-message", text: "restart the worker" },
        },
      ]);
    expect(sendBodies).toEqual([]);
    await expect(console_(page)).toBeVisible();
    await expect(omniboxInput(page)).toBeFocused();
    await expect(omniboxInput(page)).toHaveValue("");
  });

  /**
   * Proves: the omnibox YIELDS focus to a terminal pane. Clicking into the
   * xterm after engaging the box leaves focus on the terminal's helper
   * textarea and typed keys land there, not in the compose draft — the box
   * neither re-acquires focus nor keeps its engaged chrome. jsdom cannot
   * prove this (its synthetic focus events never move `document.activeElement`),
   * which is exactly how the self-restore regression reached users.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the @1 terminal
   *    route and wait for the xterm frame.
   * 2. Click the omnibox and type a partial draft; assert it holds focus and
   *    the box renders engaged (accent border).
   * 3. Click the xterm screen; assert `document.activeElement` is
   *    `.xterm-helper-textarea` and the omnibox is not focused.
   * 4. Type; assert the omnibox draft is unchanged (the keys went to the
   *    pane, not the box).
   * 5. Assert the box has stood down to its resting chrome (no accent border,
   *    no context chip).
   */
  test("clicking into the terminal takes focus from the omnibox and keeps it", async ({ page }) => {
    await mockBackend(page, true);
    await gotoWindow(page);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });

    await omniboxInput(page).click();
    await omniboxInput(page).fill("half-written");
    await expect(omniboxInput(page)).toBeFocused();
    await expect(page.getByTestId("operator-omnibox")).toHaveClass(/border-accent-green/);

    await page.locator(".xterm-screen").click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.classList.contains("xterm-helper-textarea"),
        ),
      )
      .toBe(true);
    await expect(omniboxInput(page)).not.toBeFocused();

    await page.keyboard.type("ls -la");
    await expect(omniboxInput(page)).toHaveValue("half-written");

    await expect(page.getByTestId("operator-omnibox")).not.toHaveClass(/border-accent-green/);
    await expect(page.getByTestId("operator-console-context")).toBeHidden();
  });

  /**
   * Proves: the md–lg rung renders today's full heading (prefix included)
   * plus the dim `· ◉ ask` ghost; clicking the ghost morphs the center into
   * the omnibox in place (heading hidden, box focused) and Escape restores
   * the heading.
   *
   * Steps:
   * 1. Set a 900×720 viewport (between the mobile rule and lg); mock the
   *    backend with an operator window; land on the terminal route.
   * 2. Assert the ghost and the `Tab:` prefix are visible and the omnibox is
   *    hidden.
   * 3. Click the ghost; assert the omnibox is visible and focused and the
   *    heading's rename button is hidden.
   * 4. Press Escape; assert the heading and ghost are back and the box is
   *    hidden.
   */
  test("md–lg: the ghost morphs the center into the omnibox and Esc restores the heading", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await mockBackend(page, true);
    await gotoWindow(page);

    const ghost = page.getByTestId("operator-omnibox-ghost");
    await expect(ghost).toBeVisible();
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
    await expect(omniboxInput(page)).toBeHidden();

    await ghost.click();
    await expect(omniboxInput(page)).toBeVisible();
    await expect(omniboxInput(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Rename tab feature-work" })).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(omniboxInput(page)).toBeHidden();
    await expect(ghost).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename tab feature-work" })).toBeVisible();
  });

  /**
   * Proves: the palette carries the `Operator: Open console` action (the
   * action registry of record), and selecting it goes straight to
   * open+focused — the drawer opens AND the omnibox takes focus, skipping the
   * cycle's focused-only intermediate.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the terminal route.
   * 2. Open the palette, filter to `Open console`, select the row (anchored
   *    name — the Ask-operator fallback row is the substring-collision class,
   *    and the option's accessible name carries the chord keycap).
   * 3. Assert the console is visible and the omnibox is focused.
   */
  test("palette action 'Operator: Open console' lands open+focused", async ({ page }) => {
    await mockBackend(page, true);
    await gotoWindow(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("Open console");
    await page.getByRole("option", { name: /^Operator: Open console/ }).click();

    await expect(console_(page)).toBeVisible();
    await expect(omniboxInput(page)).toBeFocused();
  });

  /**
   * Proves: the palette free-text fallback — a query matching no action on an
   * operator-bearing server renders the `Ask operator: "{query}"` row, and
   * Enter on it closes the palette, opens the console, and fires exactly one
   * send through the SAME lane resolution as a typed message: on this terminal
   * route (chip attached by default) that is one POST to the window-scoped
   * operator-request route at the subject window @1 with
   * `{template: "user-message", text: query}` — no direct `send` POST fires.
   *
   * Steps:
   * 1. Mock the backend with an operator window and 200 stubs; land on the
   *    terminal route.
   * 2. Open the palette and type a query matching no action.
   * 3. Assert the fallback row renders and the "No results" line does not.
   * 4. Press Enter; assert the palette closed, the console opened, and the
   *    recorded operator-request call targets @1 with the user-message
   *    template while the direct-send list stays empty.
   */
  test("palette fallback row opens the console and sends the query on the templated chat lane", async ({
    page,
  }) => {
    const { sendBodies, requestCalls } = await mockBackend(page, true);
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
      .poll(() => requestCalls.map((c) => ({ path: new URL(c.url).pathname, body: c.body })))
      .toEqual([
        {
          path: "/api/windows/%401/operator-request",
          body: { template: "user-message", text: "the fence deploy is wedged" },
        },
      ]);
    expect(sendBodies).toEqual([]);
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
   * compose anywhere) and the palette renders no fallback row.
   *
   * Steps:
   * 1. Mock the backend WITHOUT an operator window; land on the terminal
   *    route.
   * 2. Open the console via the ◉ button; assert the hint line, and no xterm
   *    or textbox inside the console.
   * 3. Close with two Escapes (open → focused → rest), open the palette, type
   *    a floor-length query matching no action; assert no `Ask operator` row.
   */
  test("no operator on the server renders the hint line and omits the fallback row", async ({
    page,
  }) => {
    await mockBackend(page, false);
    await gotoWindow(page);

    await page.getByRole("button", { name: /^Operator console/ }).click();
    await expect(console_(page)).toBeVisible();
    await expect(page.getByTestId("operator-console-empty")).toHaveText(
      "no operator on this server — run rk operator",
    );
    await expect(console_(page).locator(".xterm")).toHaveCount(0);
    await expect(console_(page).getByRole("textbox")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(console_(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    const paletteInput = await openPalette(page);
    await paletteInput.fill("the fence deploy is wedged");
    await expect(page.getByRole("option", { name: /^Ask operator:/ })).toHaveCount(0);
  });

  /**
   * Proves: a structured send failure (409 from the injection engine)
   * 1. Mock the backend with an operator window and a 409 stub (both send
   *    lanes) carrying the probe-failure message; land on the terminal route.
   * 2. Type a message into the omnibox and press Enter (the send auto-opens
   *    the drawer).
   * 3. Assert the templated lane fired once (the chip is attached on this
   *    route), the drawer's top-edge error line carries the server's message,
   *    and the omnibox still holds the text.
   *
   * Steps:
    await expect.poll(() => requestCalls).toHaveLength(1);
    await expect(console_(page)).toBeVisible();
   */
  test("a structured 409 send failure surfaces inline with the composed text preserved", async ({
    page,
  }) => {
    const { requestCalls } = await mockBackend(page, true, {
      status: 409,
      body: { error: "probe failed: no novelty echo" },
    });
    await gotoWindow(page);

    const input = omniboxInput(page);
    await input.click();
    await input.fill("restart the worker");
    await input.press("Enter");

    await expect.poll(() => requestCalls).toHaveLength(1);
    await expect(console_(page)).toBeVisible();
    await expect(page.getByTestId("operator-console-error")).toHaveText("probe failed: no novelty echo");
    await expect(input).toHaveValue("restart the worker");
  });

  /**
   * Proves: on a terminal route the compose strip shows the attached context
   * chip naming the route window (`from: @1 "feature-work"`), and Enter fires
   * exactly one POST to the window-scoped operator-request route at the
   * SUBJECT window @1 with `{template: "user-message", text}` — the direct
   * send lane (at the operator window @9) is not called.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the @1 terminal
   *    route.
   * 2. Click into the omnibox (machine → focused); assert the chip appears
   *    beside the box naming @1 "feature-work".
   * 3. Type a message and press Enter (the send auto-opens the drawer).
   * 4. Assert exactly one operator-request call whose path is
   *    `/api/windows/%401/operator-request` with the user-message body, and
   *    an empty direct-send list.
   */
  test("terminal route: the context chip rides the send onto the templated chat lane", async ({
    page,
  }) => {
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await gotoWindow(page);

    const input = omniboxInput(page);
    await input.click();
    await expect(page.getByTestId("operator-console-context")).toContainText('from: @1 "feature-work"');

    await input.fill("can you check the failing test?");
    await input.press("Enter");
    await expect(console_(page)).toBeVisible();

    await expect
      .poll(() => requestCalls.map((c) => ({ path: new URL(c.url).pathname, body: c.body })))
      .toEqual([
        {
          path: "/api/windows/%401/operator-request",
          body: { template: "user-message", text: "can you check the failing test?" },
        },
      ]);
    expect(sendBodies).toEqual([]);
    await expect(input).toHaveValue("");
  });

  /**
   * Proves: dismissing the context chip (✕) drops the envelope — the next
   * send rides the direct lane byte-identically (POST
   * /api/windows/{operatorId}/send with `{text, mode: "submit",
   * target: "agent"}`), and no operator-request fires.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the @1 terminal
   *    route.
   * 2. Click into the omnibox; dismiss the chip via its ✕ button and assert
   *    it disappears.
   * 3. Type a message and press Enter.
   * 4. Assert exactly one direct-send call at @9 with the agent-target body
   *    and an empty operator-request list.
   */
  test("dismissing the chip returns sends to the direct lane", async ({ page }) => {
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await gotoWindow(page);

    const input = omniboxInput(page);
    await input.click();
    await page.getByRole("button", { name: "Detach window context" }).click();
    await expect(page.getByTestId("operator-console-context")).toHaveCount(0);

    await input.fill("plain message");
    await input.press("Enter");

    await expect.poll(() => sendBodies).toEqual([
      { text: "plain message", mode: "submit", target: "agent" },
    ]);
    expect(requestCalls).toEqual([]);
  });

  /**
   * Proves: on a route with no subject window (the tmux Server route) the
   * chip does not render and sends ride the direct lane unchanged.
   *
   * Steps:
   * 1. Mock the backend with an operator window; land on the server route
   *    (`/default`).
   * 2. Click into the omnibox; assert no chip renders.
   * 3. Type a message and press Enter.
   * 4. Assert exactly one direct-send call at @9 and an empty
   *    operator-request list.
   */
  test("server route: no subject window, no chip, sends ride the direct lane", async ({ page }) => {
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await page.goto(`/${SERVER}`);
    await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });

    const input = omniboxInput(page);
    await input.click();
    await expect(page.getByTestId("operator-console-context")).toHaveCount(0);

    await input.fill("hello from the server page");
    await input.press("Enter");

    await expect.poll(() => sendBodies).toEqual([
      { text: "hello from the server page", mode: "submit", target: "agent" },
    ]);
    expect(requestCalls).toEqual([]);
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
     * 2. Open via the chord cycle (focus, then open); assert the slide class
     *    and wait out the raised (entering) pose.
     * 3. Press Escape; assert the drawer is still attached WITH the raised
     *    class (mid-exit-slide), then detaches.
     */
    test("the desktop drawer slides in and stays mounted through the exit slide", async ({
      page,
    }) => {
      await mockBackend(page, true);
      await gotoWindow(page);

      await openDrawerViaChord(page);
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

    await openDrawerViaChord(page);
    const el = console_(page);
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
    await openDrawerViaChord(page);
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

    await openDrawerViaChord(page);
    const el = console_(page);

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
    // .focus() (not .click()) — a click anywhere on the track jumps the
    // thumb to that position, coupling this test's expected value to the
    // slider's min/max width; focusing preserves the current 0.9 so a single
    // ArrowDown is a deterministic one-step decrement regardless of range.
    await slider.focus();
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
    await openDrawerViaChord(page);
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

  test.describe("mobile navigation", () => {
    // hasTouch flips Chromium's coarse-pointer media queries, so the bottom
    // bar (a touch-only surface) renders as it does on a real phone.
    test.use({ hasTouch: true });

  /**
   * Proves: at 375px there is no sheet — opening the console NAVIGATES to the
   * operator window's ordinary terminal route, carrying the origin window as
   * `?from=`, and the route's own chrome (top bar, bottom-bar key chips)
   * stays visible with no horizontal page overflow. Entry rides the top-bar
   * overflow menu's `Operator console` row (no keyboard on a phone).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with an operator window;
   *    land on the @1 terminal route (direct goto + `__rkTerminals` poll).
   * 2. Open the `More controls` chevron menu and select `Operator console`.
   * 3. Assert the URL becomes the operator route with `?from=@1`, no
   *    `operator-console` element exists, and the chevron + bottom-bar
   *    toolbar are still visible.
   * 4. Assert `document.body.scrollWidth` ≤ 375 (no horizontal overflow).
   */
  test("mobile: opening the console navigates to the operator terminal route (no sheet, no overflow)", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, true);
    await gotoWindowMobile(page);

    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    await chevron.click();
    await page.getByRole("menu", { name: "More controls" })
      .getByRole("menuitem", { name: /Operator console/ })
      .click();

    await expectOperatorRoute(page, "@1");
    await expect(console_(page)).toHaveCount(0);
    await expect(chevron).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  /**
   * Proves: on mobile the tongue under the top bar is a TOGGLE — the standing
   * affordance with the amber waiting dot while off the operator route (the
   * desktop ◉ button absent), a tap navigates to the operator window's
   * terminal route, and ON that route the tongue stays as the return
   * affordance (`data-tongue-state="return"`, waiting dot suppressed) whose
   * tap navigates back to the `?from=` origin window — a full round trip with
   * no horizontal overflow.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with a waiting operator;
   *    land on the @1 terminal route (direct goto + `__rkTerminals` poll).
   * 2. Assert the tongue is visible with the waiting dot and the ◉ button is
   *    absent.
   * 3. Tap the tongue; assert the URL becomes the operator route with
   *    `?from=@1`, the tongue REMAINS in the return state, and the waiting
   *    dot is gone.
   * 4. Tap the tongue again; assert the URL is back at the @1 terminal route
   *    and the tongue is the operator-state affordance again.
   * 5. Assert `document.body.scrollWidth` ≤ 375.
   */
  test("mobile: the tongue is a toggle (navigate in, return state back, no overflow)", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, true, SEND_OK, "waiting");
    await gotoWindowMobile(page);

    const tongue = page.getByTestId("operator-console-tongue");
    await expect(tongue).toBeVisible();
    await expect(page.getByTestId("operator-console-tongue-waiting")).toBeVisible();
    await expect(page.getByTestId("operator-console-button")).toHaveCount(0);

    await tongue.click();
    await expectOperatorRoute(page, "@1");
    await expect(tongue).toHaveAttribute("data-tongue-state", "return");
    await expect(page.getByTestId("operator-console-tongue-waiting")).toHaveCount(0);

    await tongue.click();
    // The router serializes window @1 as the bare segment `1` (router-url.ts).
    await expect(page).toHaveURL(`/${SERVER}/1`, { timeout: 10_000 });
    await expect(tongue).toHaveAttribute("data-tongue-state", "operator");

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  /**
   * Proves: on the operator window's route the compose strip renders the
   * dismissable context chip naming the `?from=` origin window, and a plain
   * text submit rides the templated chat lane — exactly one POST to
   * `/api/windows/@1/operator-request` with `{template: "user-message",
   * text}` — while the direct send lane stays silent.
   *
   * Steps:
   * 1. Set the 375×812 viewport; pre-enable the compose strip
   *    (`runkit-compose-strip`); mock the backend with an operator window;
   *    land on the @1 terminal route.
   * 2. Tap the tongue; assert the operator route with `?from=@1` and the
   *    chip naming @1 "feature-work".
   * 3. Type into the compose strip and click its Send.
   * 4. Assert one recorded operator-request at @1 with the user-message body,
   *    an empty direct-send list, and the cleared draft.
   */
  test("mobile: the operator route's compose strip submits ride the templated chat lane behind the ?from= chip", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem("runkit-compose-strip", "true"));
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await gotoWindowMobile(page);

    await page.getByTestId("operator-console-tongue").click();
    await expectOperatorRoute(page, "@1");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByTestId("operator-console-context")).toContainText('from: @1 "feature-work"');

    const stripInput = page.getByTestId("compose-strip-input");
    await stripInput.fill("can you check the failing test?");
    await page.getByTestId("compose-strip-send").click();

    await expect
      .poll(() => requestCalls.map((c) => ({ path: new URL(c.url).pathname, body: c.body })))
      .toEqual([
        {
          path: "/api/windows/%401/operator-request",
          body: { template: "user-message", text: "can you check the failing test?" },
        },
      ]);
    expect(sendBodies).toEqual([]);
    await expect(stripInput).toHaveValue("");
  });

  /**
   * Proves: the `?from=` chip's LABEL is the secondary return affordance — a
   * tap on `from: @1 "feature-work"` navigates back to the origin window's
   * terminal route (the chip's ✕ stays dismiss-only, exercised by the
   * dismissal test below).
   *
   * Steps:
   * 1. Set the 375×812 viewport; pre-enable the compose strip; mock the
   *    backend with an operator window; land on the @1 terminal route.
   * 2. Tap the tongue; assert the operator route with `?from=@1` and the chip.
   * 3. Tap the chip's label button (`Back to @1 "feature-work"`).
   * 4. Assert the URL is back at the @1 terminal route.
   */
  test("mobile: the ?from= chip label navigates back to the origin window", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem("runkit-compose-strip", "true"));
    await mockBackend(page, true);
    await gotoWindowMobile(page);

    await page.getByTestId("operator-console-tongue").click();
    await expectOperatorRoute(page, "@1");
    await expect(page.getByTestId("operator-console-context")).toContainText('from: @1 "feature-work"');

    await page
      .getByTestId("operator-console-context")
      .getByRole("button", { name: 'Back to @1 "feature-work"' })
      .click();

    // The router serializes window @1 as the bare segment `1` (router-url.ts).
    await expect(page).toHaveURL(`/${SERVER}/1`, { timeout: 10_000 });
  });

  /**
   * Proves: dismissing the `?from=` chip drops the envelope — the compose
   * strip's next plain submit goes through its ordinary direct send at the
   * operator window (no operator-request POST) — and a bottom-bar key chip
   * always drives the pane directly regardless of the chip (no REST call at
   * all).
   *
   * Steps:
   * 1. Set the 375×812 viewport; pre-enable the compose strip; mock the
   *    backend with an operator window; land directly on the operator route
   *    with `?from=@1`.
   * 2. Dismiss the chip via its ✕; assert it disappears.
   * 3. Type and Send; assert one direct `{text, mode: "submit"}` send and an
   *    empty operator-request list.
   * 4. Click the terminal (the bottom bar hides while the strip's textarea
   *    owns focus), then click the bottom bar's Tab key chip; assert no
   *    further REST send or operator-request fired.
   */
  test("mobile: dismissing the chip returns strip submits to the direct lane; bottom-bar keys stay direct", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem("runkit-compose-strip", "true"));
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await page.goto(operatorUrl("@1"));
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await page.getByRole("button", { name: "Detach window context" }).click();
    await expect(page.getByTestId("operator-console-context")).toHaveCount(0);

    const stripInput = page.getByTestId("compose-strip-input");
    await stripInput.fill("plain message");
    await page.getByTestId("compose-strip-send").click();
    await expect.poll(() => sendBodies).toEqual([{ text: "plain message", mode: "submit" }]);
    expect(requestCalls).toEqual([]);

    // The bottom bar hides while the strip's textarea owns focus — move focus
    // to the terminal first so the key chips render again.
    await page.locator(".xterm").first().click();
    const tabChip = page.getByRole("button", { name: "Tab", exact: true });
    await expect(tabChip).toBeVisible();
    await tabChip.click();
    await page.waitForTimeout(300);
    expect(sendBodies).toHaveLength(1);
    expect(requestCalls).toEqual([]);
  });

  /**
   * Proves: an invalid `?from=` (a window id the server does not carry)
   * attaches nothing — no chip renders, and a compose-strip submit is the
   * ordinary direct send at the operator window, without error.
   *
   * Steps:
   * 1. Set the 375×812 viewport; pre-enable the compose strip; mock the
   *    backend with an operator window; land on the operator route with
   *    `?from=@42` (unknown).
   * 2. Assert no chip renders.
   * 3. Type and Send; assert one direct send and no operator-request POST.
   */
  test("mobile: an unknown ?from= window renders no chip and sends direct", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem("runkit-compose-strip", "true"));
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await page.goto(operatorUrl("@42"));
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await expect(page.getByTestId("operator-console-context")).toHaveCount(0);

    await page.getByTestId("compose-strip-input").fill("still direct");
    await page.getByTestId("compose-strip-send").click();
    await expect.poll(() => sendBodies).toEqual([{ text: "still direct", mode: "submit" }]);
    expect(requestCalls).toEqual([]);
  });

  /**
   * Proves: with no operator window on the server, mobile shows no tongue and
   * the remaining openers answer with the hint toast instead of navigating —
   * once per activation burst (repeat activations do not stack toasts).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend WITHOUT an operator
   *    window; land on the @1 terminal route.
   * 2. Assert the tongue is absent.
   * 3. Fire the overflow menu's `Operator console` row twice; assert the
   *    hint toast renders once, the URL is unchanged, and no console element
   *    exists.
   */
  test("mobile: an operator-less server hides the tongue and toasts the hint without navigating", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, false);
    await gotoWindowMobile(page);

    await expect(page.getByTestId("operator-console-tongue")).toHaveCount(0);

    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 2; i++) {
      await chevron.click();
      await page.getByRole("menu", { name: "More controls" })
        .getByRole("menuitem", { name: /Operator console/ })
        .click();
    }

    await expect(page.getByText("no operator on this server — run rk operator")).toHaveCount(1);
    expect(page.url()).toContain(WINDOW_URL);
    await expect(console_(page)).toHaveCount(0);
  });

  /**
   * Proves: the palette's Ask-operator fallback row on mobile navigates to
   * the operator route and seeds the typed query as the compose strip's
   * DRAFT — nothing is sent until the user reviews and sends it.
   *
   * Steps:
   * 1. Set the 375×812 viewport; pre-enable the compose strip; mock the
   *    backend with an operator window; land on the @1 terminal route.
   * 2. Open the palette and type a query matching no action; assert the
   *    fallback row renders.
   * 3. Press Enter; assert the operator route with `?from=@1` and the strip
   *    holding the query as its unsent draft.
   * 4. Assert no send fired on either lane.
   */
  test("mobile: the palette fallback row navigates and seeds the compose draft, unsent", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.addInitScript(() => localStorage.setItem("runkit-compose-strip", "true"));
    const { sendBodies, requestCalls } = await mockBackend(page, true);
    await gotoWindowMobile(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("the fence deploy is wedged");
    await expect(
      page.getByRole("option", { name: 'Ask operator: "the fence deploy is wedged"' }),
    ).toBeVisible();

    await paletteInput.press("Enter");
    await expect(paletteInput).toHaveCount(0);
    await expectOperatorRoute(page, "@1");
    await expect(page.getByTestId("compose-strip-input")).toHaveValue("the fence deploy is wedged");
    expect(requestCalls).toEqual([]);
    expect(sendBodies).toEqual([]);
  });
  });

  /**
   * Proves: an image ⌘V inside the console surface uploads to the OPERATOR
   * window's session (`_rk-operator`) and insert-delivers the returned path
   * to the operator pane (mode "raw", target "agent", never submitted) — and
   * the route terminals' strip-forward guard keeps the paste OFF the tab
   * below (no upload to the route's `dev` session). Both focus targets are
   * covered: the embedded terminal's xterm textarea (the console root's
   * CAPTURE-phase handler — xterm stops bubble propagation) and the omnibox
   * input (the relocated desktop compose; its console-root attribute excludes
   * it from the route terminals' document-level forward).
   *
   * Steps:
   * 1. Mock the backend with an operator window plus the upload endpoint;
   *    land on the terminal route and open the console.
   * 2. Dispatch a file-carrying paste at the console's embedded xterm helper
   *    textarea; assert one upload to `_rk-operator` and one raw/agent send.
   * 3. Dispatch a second paste at the omnibox input; assert a second
   *    upload/send pair.
   * 4. Assert no upload ever hit the route session.
   */
  test("image paste inside the console uploads to the operator session and insert-delivers the path", async ({
    page,
  }) => {
    const { sendBodies } = await mockBackend(page, true);
    const uploads = await mockUploads(page);
    await gotoWindow(page);

    await openDrawerViaChord(page);
    await expect(
      console_(page).locator(".xterm-helper-textarea"),
    ).toBeAttached({ timeout: 10_000 });

    await pasteImage(page, '[data-testid="operator-console"] .xterm-helper-textarea');
    await expect.poll(() => uploads.map((u) => u.session)).toEqual(["_rk-operator"]);
    await expect
      .poll(() => sendBodies)
      .toEqual([{ text: "/tmp/op/.uploads/shot.png ", mode: "raw", target: "agent" }]);

    await pasteImage(page, '[data-testid="operator-omnibox-input"]');
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
