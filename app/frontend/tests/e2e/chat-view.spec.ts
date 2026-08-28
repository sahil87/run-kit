import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the `sessions` payload over the state-socket
// mock + the server list + the chat backfill (a plain GET) via page.route, then
// drive the chat view. Chat rides the state socket: the backfill is a plain
// GET /api/windows/{id}/chat and incremental events ride the `kind:"chat"`
// subscription — there is NO chat SSE stub. The terminals mux WebSocket
// (/ws/terminals) is stubbed; there is NO /relay/ or SSE stub (memory
// `relay-mux-stale-ws-stub-class`).
//
// Chat read frontend: a read-only HTML chat view over the same agent pane,
// reachable via the `?view=chat` deep link (translated inbound to the shared
// `@rk_win_layout` option as `single:chat`, the params dropped)
// or the command palette's `View: Chat` action on the existing terminal route.
// The ViewSwitcher is RETIRED: the palette is the ONLY lens-switch surface,
// the top-bar `surface-toggles` group (the right rail is REMOVED —
// composed-frame unification) shows NO chat toggle (SURFACE_RAIL_HIDDEN —
// chat is palette-only), and the
// `` Ctrl+` `` chat-toggle chord is gone (fully unbound — the chord belongs to
// code-server). Palette selections set `single:<view>` through the shared
// layout mutation path.
//
// Fixtures: `backfillWithPending()` is an offset-bearing Conversation with a
// user message, an assistant markdown message, a tool_use/tool_result pair,
// and a tail pending question; `backfillCleared()` has two plain messages and
// no pending. `mockBackend(page, conv, chatOpts?, winName?)` wires the routes
// (`conv` is the GET backfill body; `chatOpts` drives the socket's post-ack
// chat frames — the mock answers a `kind:"chat"` subscribe with an ack
// carrying `{offset}`, no snapshot). `mockChatSend(page, { status, error })`
// routes the chat-send POST (`**/api/windows/*/chat/send*`), records each
// request's body, and fulfils either `200 {"ok":true}` or a non-200
// `writeError` JSON `{ error }` so the client's throwOnError surfaces the
// structured message.

const SERVER = "default";
const MOBILE = { width: 375, height: 812 };

/** Open the command palette, fill the query, and return the input. */
async function openPalette(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill(query);
  return paletteInput;
}

/** Switch the lens via the palette's `View: {label}` action — the only
 *  lens-switch surface since the ViewSwitcher's retirement (260812-0c6o). */
async function switchLens(page: Page, label: "Terminal" | "Chat"): Promise<void> {
  await openPalette(page, `View: ${label}`);
  const option = page.getByRole("option", { name: `View: ${label}` });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
}

/** Assert the route is bare — layout state lives in the shared
 *  `@rk_win_layout` option, never the URL; the retired `?layout=`/`?view=`
 *  params are inbound-only (translated once, then dropped). Retrying: the
 *  drop lands a beat after the arrival/switch that triggered it. */
async function expectBareUrl(page: Page): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).search, { timeout: 10_000 })
    .toBe("");
}

// Two windows: @1 is a chat-capable claude window; @2 is a plain (no
// chatProvider) window used to prove the palette entry is gated. `winName`
// overrides @1's window name — the 375px test passes a long worktree-style
// name to prove the center heading keeps its room (the switcher is retired —
// 260812-0c6o — so the long name exercises heading space, not a pill drop
// threshold).
function sessionsPayload(winName = "agent-win"): string {
  return JSON.stringify([
    {
      name: "dev",
      windows: [
        {
          windowId: "@1",
          index: 0,
          name: winName,
          worktreePath: "/tmp/a",
          activity: "active",
          isActiveWindow: true,
          activityTimestamp: 0,
          agentState: "active",
          chatProvider: "claude",
          chatSessionRef: "11111111-1111-1111-1111-111111111111",
        },
        {
          windowId: "@2",
          index: 1,
          name: "plain-win",
          worktreePath: "/tmp/b",
          activity: "idle",
          isActiveWindow: false,
          activityTimestamp: 0,
          agentState: "idle",
        },
      ],
    },
  ]);
}

// A `Conversation` (the GET /api/windows/{id}/chat backfill body, 260717-vhvz).
// `offset` is the transcript byte position the tail subscribes `from`.
type Conv = {
  provider: string;
  sessionRef: string;
  events: unknown[];
  pending: unknown;
  offset: number;
};

// A backfill conversation: one user message, one assistant markdown message,
// one tool_use/tool_result pair, and a tail pending question.
function backfillWithPending(): Conv {
  return {
    provider: "claude",
    sessionRef: "11111111-1111-1111-1111-111111111111",
    events: [
      { type: "message", id: "m1", turn: 1, role: "user", text: "run the tests" },
      { type: "message", id: "m2", turn: 1, role: "assistant", text: "Running **tests** now." },
      { type: "tool_use", id: "u1", turn: 1, toolUseId: "T1", toolName: "Bash", toolInput: { command: "just test" } },
      { type: "tool_result", id: "r1", turn: 1, toolUseId: "T1", toolOutput: "all green" },
    ],
    pending: { toolUseId: "T2", toolName: "AskUserQuestion", text: "Ship it?" },
    offset: 1234,
  };
}

// A backfill with no pending.
function backfillCleared(): Conv {
  return {
    provider: "claude",
    sessionRef: "11111111-1111-1111-1111-111111111111",
    events: [
      { type: "message", id: "m1", turn: 1, role: "user", text: "hi" },
      { type: "message", id: "m2", turn: 1, role: "assistant", text: "done" },
    ],
    pending: null,
    offset: 42,
  };
}

// mockBackend wires the fully-mocked chat backend (260717-vhvz — chat moved onto
// the state socket). The BACKFILL is a plain GET `/api/windows/*/chat` (D5), and
// incremental chat events / a pending transition ride the state-socket mock's
// `chat` option. `chatOpts` drives the socket's post-ack chat frames (e.g. a
// `chat-state` pending:null to clear a backfilled pending). The terminals mux is
// stubbed on `/ws/terminals`; there is NO `/relay/` or SSE stub (memory
// `relay-mux-stale-ws-stub-class`).
async function mockBackend(
  page: Page,
  conv: Conv,
  chatOpts?: { state?: { pending: unknown } | null; events?: unknown[]; reset?: boolean },
  winName?: string,
) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  // The `?view=chat` deep link translates into ONE `@rk_win_layout` option
  // write; the mocked payload never reflects it, so the optimistic overlay is
  // what renders the chat lens — the POST just has to succeed (trailing `*`:
  // the client appends `?server=`).
  await page.route("**/api/windows/*/options*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  // The GET chat backfill (the trailing `*` is REQUIRED — the client appends
  // `?server=`; glob-fallthrough trap). Returns the offset-bearing Conversation.
  await page.route("**/api/windows/*/chat*", (route) => {
    // Do NOT intercept the send POST (`/chat/send`) — mockChatSend owns that.
    if (route.request().url().includes("/chat/send")) {
      route.fallback();
      return;
    }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(conv),
    });
  });
  await mockStateSocket(page, { sessions: sessionsPayload(winName), chat: chatOpts });
}

// mockChatSend routes the chat-send POST and records each request's body text
// (`bodies`) plus the full parsed body (`raw`) — the latter asserts the additive
// `submit` field contract (260719-mxvw: absent by default, `false` for
// insert-without-submit). The trailing `*` is REQUIRED — the client appends
// `?server=` (glob-fallthrough trap). `opts.status` (default 200) picks the
// response; a non-200 fulfils the `writeError` JSON shape so the client's
// throwOnError surfaces `error`.
//
// AWAIT the returned promise before navigating: the `page.route` registration
// must be committed before the page issues the send POST (registration-race
// hygiene, matching every mockBackend route which is also awaited).
async function mockChatSend(
  page: Page,
  opts: { status?: number; error?: string } = {},
): Promise<{ bodies: string[]; raw: Array<{ text?: string; submit?: boolean }> }> {
  const bodies: string[] = [];
  const raw: Array<{ text?: string; submit?: boolean }> = [];
  const status = opts.status ?? 200;
  await page.route("**/api/windows/*/chat/send*", async (route) => {
    const rawBody = route.request().postData() ?? "{}";
    const parsed = JSON.parse(rawBody) as { text?: string; submit?: boolean };
    raw.push(parsed);
    bodies.push(parsed.text ?? "");
    if (status === 200) {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    } else {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: opts.error ?? "send failed" }),
      });
    }
  });
  return { bodies, raw };
}

test.describe("Chat read frontend — view toggle, heading, rendering", () => {
  /**
   * Proves: the palette's `View: Chat` action is gated on the current window
   * carrying a non-empty `chatProvider` — present on @1 (claude), absent on @2
   * (plain, which offers only `tty`) — and the retirement contract: even on the
   * capable window there is no in-bar pill, no `view-toggle` testid anywhere in
   * the DOM, no `View:` rows in the chevron menu, and NO chat toggle in the
   * top-bar `surface-toggles` group (chat is palette-only) while the tty toggle
   * remains — INCLUDING while a chat tile is already open (the tile renders
   * normally and the palette switches back to the terminal, closing it). A
   * `?view=chat` deep link on a chat-less window degrades gracefully to the
   * terminal (the shim's `single:chat` translation degrades tile-by-tile to
   * `single:tty` — chat is unavailable there).
   *
   * Steps:
   * 1. Mock the backend; navigate to `/default/1`; gate on the `Tab:` heading.
   *    Assert the `Window view` group has count 0 AND `view-toggle` has count 0.
   *    Assert the banner (top bar) shows the `Terminal tile` toggle but NO
   *    `Chat tile` toggle. Open the palette with `View: Chat` and assert the
   *    option is visible; Escape. Open the "More controls" menu and assert it
   *    carries NO `View:` rows; Escape-close.
   * 2. `switchLens("Chat")`; assert the `chat-view` renders, the group STILL has
   *    no `Chat tile` toggle, and the `Terminal tile` toggle remains. Then
   *    `switchLens("Terminal")`; assert the `chat-view` is hidden (the tile
   *    stays mounted, display-hidden) and the `layout` param is dropped (the
   *    default `single:tty` mirrors as a clean URL).
   * 3. Navigate to `/default/2`; assert "plain-win" is visible; open the palette
   *    and assert it offers NO `View: Chat` option; Escape-close.
   * 4. Navigate to `/default/2?view=chat`; assert no `chat-view` renders, no
   *    `Window view` group renders, and the static `Tab:` heading prefix shows
   *    (the terminal branch mounted despite the param; the heading is `Tab:` in
   *    every lens).
   */
  test("the `View: Chat` palette action appears only on a chatProvider window; the top-bar toggle group has no chat toggle (260812-0c6o)", async ({ page }) => {
    await mockBackend(page, backfillCleared());

    // @1 is chat-capable → the palette offers `View: Chat` (the ONLY lens-switch
    // surface since the ViewSwitcher's retirement): no in-bar "Window view"
    // group and no `view-toggle` testid anywhere in the DOM, and the chevron
    // menu carries no `View:` rows. The top-bar surface-toggles group
    // (SURFACE_RAIL_HIDDEN) shows the tty toggle but NO chat toggle — chat is
    // palette-only. Banner-scoped accessible-name queries: the top bar's
    // aria-hidden measurement probe duplicates every in-bar control, so
    // testid / `:visible` queries are ambiguous — getByRole excludes it.
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("button", { name: "Terminal tile" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Chat tile" })).toHaveCount(0);
    await openPalette(page, "View: Chat");
    await expect(page.getByRole("option", { name: "View: Chat" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(
      page.getByRole("menu", { name: "More controls" }).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // An already-OPEN chat tile changes nothing: the group still carries no
    // chat toggle (chat never gets one, even while its tile is open), the
    // tile renders normally, and switching back via the palette closes it.
    await switchLens(page, "Chat");
    await expect(page.getByTestId("chat-view")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Chat tile" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Terminal tile" })).toBeVisible();
    await switchLens(page, "Terminal");
    // Hide-never-unmount (P3): the chat tile stays mounted at display level
    // after closing within this window visit — hidden, not gone.
    await expect(page.getByTestId("chat-view")).toBeHidden();
    await expectBareUrl(page);

    // @2 has no chatProvider → the palette offers no `View: Chat` action.
    await page.goto(`/${SERVER}/2`);
    await expect(page.getByText("plain-win").first()).toBeVisible({ timeout: 10_000 });
    await openPalette(page, "View: Chat");
    await expect(page.getByRole("option", { name: "View: Chat" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Chat-less deep-link degradation: `?view=chat` on @2 is inert — the
    // terminal renders (no chat view, no switcher). The heading is the static
    // `Tab:` prefix (260714-uco1 — no longer lens-following).
    await page.goto(`/${SERVER}/2?view=chat`);
    await expect(page.getByText("plain-win").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-view")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
  });

  /**
   * Proves: activating the palette's `View: Chat` action (the only lens-switch
   * surface) flips the view without changing the window — a view selection
   * is a single-tile layout mutation through the shared path (written to
   * `@rk_win_layout`, the URL staying bare) and the chat renderer mounts. The
   * center heading is a static `Tab:` throughout (it does not
   * change with the lens), so the heading anchor does not jump on the switch.
   * The window rename affordance carries over.
   *
   * Steps:
   * 1. Mock the backend; navigate to `/default/1`; gate on the `Tab:` prefix.
   * 2. `switchLens("Chat")` — open the palette (`Meta+k`), fill `View: Chat`,
   *    click the option, and wait for the palette to close.
   * 3. Assert the `chat-view` renderer is visible, the heading still shows
   *    the `Tab:` prefix, and the `Rename tab agent-win` heading button is
   *    present.
   */
  test("flipping to chat preserves the window (heading stays `Tab:`)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1`);

    // The heading is a static `Tab:` prefix (260714-uco1) — the lens is shown
    // by the tile content, not the heading.
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Switch via the palette's `View: Chat` action — the only lens-switch
    // surface (260812-0c6o). The selection is a `single:chat` layout mutation
    // through the shared mutation path (the URL never carries it).
    await switchLens(page, "Chat");


    // The renderer mounts; the heading stays `Tab:` across the lens switch
    // (the anchor no longer jumps). The chat lens is proven by the chat-view.
    await expect(page.getByTestId("chat-view")).toBeVisible();
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Rename tab agent-win` })).toBeVisible();
  });

  /**
   * Proves: the `Ctrl+\`` chord no longer reaches the chat lens — the chord is
   * fully unbound (the interim layout-zoom rebind was removed; `Ctrl+\``
   * belongs to code-server), so it falls through untouched: no `single:chat`
   * layout, no chat view, no heading change.
   *
   * Steps:
   * 1. Mock the backend; navigate to `/default/1`; gate on the `Tab:` prefix
   *    (the always-present readiness surface).
   * 2. Press `Control+\``; wait a beat for any erroneous handler to fire.
   * 3. Assert the URL stays bare, the `chat-view` testid has count 0, and
   *    the `Tab:` prefix is still shown.
   */
  test("Ctrl+` no longer flips to the chat lens (the chord is fully unbound, 260813-j3jb)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1`);
    // Gate on the heading — the always-present readiness surface.
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Ctrl+` is fully unbound (the layout-zoom rebind was removed in
    // 260813-j3jb — the chord belongs to code-server), so it must NOT reach
    // the chat lens: no single:chat, no chat view.
    await page.keyboard.press("Control+`");
    // Give any erroneous handler a beat to fire, then assert nothing changed.
    await page.waitForTimeout(500);
    await expectBareUrl(page);
    await expect(page.getByTestId("chat-view")).toHaveCount(0);
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
  });

  /**
   * Proves: a cold navigation straight to `?view=chat` renders the chat view
   * (URL precedence over the terminal default), including the live send input
   * (the old read-only disabled footer is gone) and a markdown-rendered
   * assistant message.
   *
   * Steps:
   * 1. Mock the backend; navigate directly to `/default/1?view=chat`.
   * 2. Assert the `chat-view` and static `Tab:` prefix are visible, the
   *    `chat-send-disabled` footer has count 0, the `chat-send-input` is
   *    visible, and the assistant text ("done") is shown.
   */
  test("deep link ?view=chat cold-loads into the chat view", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Tab:", { exact: true })).toBeVisible();
    // The read-only disabled footer is GONE (260714-jdyg-chat-send) — the live
    // send input replaces it.
    await expect(page.getByTestId("chat-send-disabled")).toHaveCount(0);
    await expect(page.getByTestId("chat-send-input")).toBeVisible();
    // The assistant markdown message rendered (bold via react-markdown).
    await expect(page.getByTestId("chat-view")).toContainText("done");
  });

  /**
   * Proves: the renderer draws distinct user/assistant bubbles, a collapsible
   * tool-call card (collapsed by default, expandable to reveal
   * `toolInput`/`toolOutput`), and an attention-styled pending bubble at the
   * tail.
   *
   * Steps:
   * 1. Mock a backfill with the pending question; navigate to
   *    `/default/1?view=chat`.
   * 2. Assert the user and assistant bubbles contain their text.
   * 3. Assert the tool card is visible, shows `Bash`, and does NOT show the
   *    output ("all green") while collapsed.
   * 4. Click the card header; assert it now shows the input ("just test") and
   *    the output.
   * 5. Assert the pending bubble contains "Ship it?".
   */
  test("renders bubbles + a collapsible tool card, and the pending bubble at the tail", async ({ page }) => {
    await mockBackend(page, backfillWithPending());
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });
    // User + assistant bubbles.
    await expect(page.getByTestId("chat-bubble-user")).toContainText("run the tests");
    await expect(page.getByTestId("chat-bubble-assistant")).toContainText("Running");
    // Tool card is collapsed by default (header shows toolName, body hidden).
    const card = page.getByTestId("chat-tool-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Bash");
    await expect(card).not.toContainText("all green");
    // Expanding reveals the input + output.
    await card.getByRole("button").click();
    await expect(card).toContainText("just test");
    await expect(card).toContainText("all green");
    // Pending question renders as a distinct bubble at the tail.
    await expect(page.getByTestId("chat-pending")).toContainText("Ship it?");
  });

  /**
   * Proves: a `chat-state` frame with `pending: null` retracts the pending
   * bubble (the retractable-state contract — always applied, including null).
   *
   * Steps:
   * 1. Mock the GET backfill with a pending, and a `chat-state` `pending: null`
   *    emitted over the state socket after the chat subscribe ack; navigate to
   *    `/default/1?view=chat`.
   * 2. Assert the `chat-view` is visible, then assert the `chat-pending` bubble
   *    has count 0.
   */
  test("the pending bubble clears on a chat-state pending:null", async ({ page }) => {
    // The GET backfill carries a pending; then a `chat-state` pending:null rides
    // the state socket after the subscribe ack and clears it on the same lens.
    await mockBackend(page, backfillWithPending(), { state: { pending: null } });
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });
    // After the chat-state, the pending bubble is gone.
    await expect(page.getByTestId("chat-pending")).toHaveCount(0, { timeout: 5_000 });
  });

  /**
   * Proves: at 375px with a realistically long window name, the retired
   * switcher leaves no chrome anywhere — the center heading keeps its room
   * because there is never an inline pill — and chat's rail-hidden status means
   * the top-bar switch group renders no chat button (here only tty survives the
   * hidden filter, so the ≥2 gate renders no group at all); the palette's
   * `Tile: Switch to Terminal` entry is the way back (the `View:` lens entries
   * are superseded on mobile), and the top-bar single-row budget still holds
   * (no wrap, no horizontal page overflow).
   *
   * Steps:
   * 1. Mock the backend with a long @1 window name
   *    (`riff-gallant-jackal-worktree-mobile`); set the viewport to 375×812;
   *    navigate to `/default/1?view=chat`.
   * 2. Assert the `chat-view` is visible (the lens resolved / window loaded).
   * 3. Assert the in-bar switcher group ("Window view") has count 0 AND the
   *    `view-toggle` testid has count 0.
   * 4. Open the palette with `View: Terminal`; assert NO `View: Terminal`
   *    option (mobile supersession); refill with `Switch`; assert the
   *    `Tile: Switch to Terminal` option is visible; Escape-close.
   * 5. Assert `document.body.scrollWidth <= 375`.
   * 6. Assert the header's bounding-box height is < 56px (a wrap would ~double
   *    it).
   */
  test("375px: the chat lens renders with a long window name and no switcher chrome (no horizontal overflow)", async ({ page }) => {
    // 260812-0c6o: the ViewSwitcher is retired — at phone width with a
    // realistically long window name the heading keeps its room and there is
    // no switcher chrome anywhere. Chat is rail-hidden, so the top-bar switch
    // group renders no chat button (and with chat visible only tty survives
    // the hidden filter — under the ≥2 gate the group doesn't render here);
    // the palette's `Tile: Switch to Terminal` entry is the way back (the
    // `View:` lens entries are superseded on mobile).
    await mockBackend(page, backfillCleared(), undefined, "riff-gallant-jackal-worktree-mobile");
    await page.setViewportSize(MOBILE);
    await page.goto(`/${SERVER}/1?view=chat`);

    // The chat view itself renders (lens resolved), proving the window is loaded.
    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });

    // No in-bar pill and no probe copy: neither the accessible
    // "Window view" group nor the raw `view-toggle` testid exists anywhere.
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);

    // The palette offers the way back — `Tile: Switch to Terminal` (chat is
    // current), and NO `View: Terminal` (superseded on mobile).
    const paletteInput = await openPalette(page, "View: Terminal");
    await expect(
      page.getByRole("option", { name: "View: Terminal", exact: true }),
    ).toHaveCount(0);
    await paletteInput.fill("Switch");
    await expect(
      page.getByRole("option", { name: "Tile: Switch to Terminal" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // No horizontal page overflow at 375px even with the long name.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE.width);

    // The header row stays a single line (a wrap would ~double the height).
    const box = await page.locator("header").first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThan(56);
  });

  /**
   * Proves: under the config's global `reducedMotion: reduce`, no element
   * inside the chat view reports a running CSS animation (the view has no
   * decorative motion; attention/pending are color + text, never motion-only).
   *
   * Steps:
   * 1. Mock the backend; navigate to `/default/1?view=chat`; assert the
   *    `chat-view` is visible.
   * 2. Evaluate `getComputedStyle(...).animationName` across the view subtree;
   *    assert none is a running animation (all `none`).
   */
  test("reduced-motion is honored — the chat view carries no running animations", async ({ page }) => {
    // The global config emulates reducedMotion: "reduce"; the chat view has no
    // decorative motion, so nothing inside it should report a running animation.
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1?view=chat`);
    const view = page.getByTestId("chat-view");
    await expect(view).toBeVisible({ timeout: 10_000 });

    const anyAnimating = await view.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      return nodes.some((n) => {
        const a = getComputedStyle(n as Element).animationName;
        return a && a !== "none";
      });
    });
    expect(anyAnimating).toBe(false);
  });
});

test.describe("Chat send — input, POST, error surfacing, busy hint", () => {
  /**
   * Proves: plain Enter is NOT a send — it inserts a newline so lines
   * accumulate locally, no POST fires; pressing Cmd/Ctrl+Enter (the only submit
   * chord) fires EXACTLY one chat-send POST carrying the accumulated text; on a
   * 200 the input clears and no inline error shows. The additive wire contract
   * keeps the default body shape exactly `{ text }` — no `submit` field.
   *
   * Steps:
   * 1. Mock the backend + `mockChatSend` (200); navigate to
   *    `/default/1?view=chat`.
   * 2. Fill `chat-send-input` with "run the tests" and press Enter; assert the
   *    value is now `run the tests\n` and NO POST was recorded.
   * 3. Press `ControlOrMeta+Enter`.
   * 4. Assert exactly one recorded POST body equal to `run the tests\n`, and
   *    that the parsed body carries NO `submit` field.
   * 5. Assert the input is now empty and `chat-send-error` has count 0.
   */
  test("typing + Cmd/Ctrl+Enter fires exactly one POST with the typed body and clears on success", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    const send = await mockChatSend(page); // 200
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("run the tests");
    // Plain Enter is NOT a send (260801-hsxm) — it inserts a newline and no
    // POST fires.
    await input.press("Enter");
    await expect(input).toHaveValue("run the tests\n");
    expect(send.bodies.length).toBe(0);
    // Cmd/Ctrl+Enter — the only submit chord — fires the POST.
    await input.press("ControlOrMeta+Enter");

    // Exactly one POST with the accumulated body.
    await expect.poll(() => send.bodies.length).toBe(1);
    expect(send.bodies[0]).toBe("run the tests\n");
    // Default submit ⇒ the body carries NO `submit` field — the additive wire
    // contract keeps the default shape exactly `{ text }` (260719-mxvw).
    expect("submit" in send.raw[0]).toBe(false);
    // Cleared on success.
    await expect(input).toHaveValue("");
    // No inline error.
    await expect(page.getByTestId("chat-send-error")).toHaveCount(0);
  });

  /**
   * Proves: the Insert button (the insert-without-submit affordance — paste
   * into the agent's input box, gated Enter skipped server-side) fires exactly
   * one chat-send POST with the explicit body `{ text, submit: false }` and
   * clears the input on success. Also asserts `enterkeyhint="enter"` (the
   * truthful keyboard hint — Enter inserts a newline on every pointer type;
   * chord/readline behavior is unit-tested in `chat-view.test.tsx` /
   * `compose-keys.test.ts` / `readline-keys.test.ts`).
   *
   * Steps:
   * 1. Mock the backend + `mockChatSend` (200); navigate to
   *    `/default/1?view=chat`.
   * 2. Assert `chat-send-input` carries `enterkeyhint="enter"`.
   * 3. Fill the input with "stage this prompt" and click `chat-send-insert`.
   * 4. Assert exactly one recorded parsed body equal to
   *    `{ text: "stage this prompt", submit: false }`.
   * 5. Assert the input is now empty and `chat-send-error` has count 0.
   */
  test("the Insert button POSTs submit:false and clears (insert-without-submit, 260719-mxvw)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    const send = await mockChatSend(page); // 200
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    // Enter inserts a newline on every pointer type (Cmd/Ctrl+Enter submits),
    // so the keyboard hint states the default "enter" action.
    await expect(input).toHaveAttribute("enterkeyhint", "enter");
    await input.fill("stage this prompt");
    await page.getByTestId("chat-send-insert").click();

    // Exactly one POST carrying the explicit insert flag.
    await expect.poll(() => send.raw.length).toBe(1);
    expect(send.raw[0]).toEqual({ text: "stage this prompt", submit: false });
    // Cleared on success (the text now lives in the agent's input box).
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("chat-send-error")).toHaveCount(0);
  });

  /**
   * Proves: a 409 (probe failure) response renders the server's structured
   * error in an inline `role="alert"` line and RETAINS the typed text (so the
   * user can retry) — never a silent failure.
   *
   * Steps:
   * 1. Mock `mockChatSend` with `status: 409` and the probe-failure `error`;
   *    navigate to `/default/1?view=chat`.
   * 2. Fill the input with "ship it" and press `ControlOrMeta+Enter`.
   * 3. Assert `chat-send-error` is visible and contains "Enter withheld".
   * 4. Assert the input still holds "ship it".
   */
  test("a 409 probe failure surfaces the inline error and keeps the text", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await mockChatSend(page, {
      status: 409,
      error:
        "agent input not ready — message pasted but not echoed; Enter withheld. " +
        "The text remains in the agent's input — check the terminal view before retrying, as a resend would duplicate it.",
    });
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("ship it");
    await input.press("ControlOrMeta+Enter");

    // The inline role="alert" carries the server's structured 409 message.
    const err = page.getByTestId("chat-send-error");
    await expect(err).toBeVisible();
    await expect(err).toHaveText(/Enter withheld/);
    // Text is KEPT on failure.
    await expect(input).toHaveValue("ship it");
  });

  /**
   * Proves: while the current window's `agentState` is `active` (as in the
   * shared @1 payload) the non-blocking busy hint renders and the input stays
   * ENABLED (Allow + probe policy — no client-side block).
   *
   * Steps:
   * 1. Mock the backend + `mockChatSend`; navigate to `/default/1?view=chat`.
   * 2. Assert the `chat-send-input` and `chat-send-busy-hint` are visible.
   * 3. Assert the input is enabled.
   */
  test("the busy hint renders when the window agentState is active (input stays enabled)", async ({ page }) => {
    // @1's sessions payload carries agentState: "active" → busy hint shows.
    await mockBackend(page, backfillCleared());
    await mockChatSend(page);
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-send-input")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-send-busy-hint")).toBeVisible();
    // Allow + probe policy — the input is not disabled while busy.
    await expect(page.getByTestId("chat-send-input")).toBeEnabled();
  });

  /**
   * Proves: on a 375px viewport the send input renders as a footer below the
   * transcript with no horizontal page overflow (mobile ergonomics — the input
   * is inside the pane, not the bars).
   *
   * Steps:
   * 1. Set the viewport to 375×812; mock the backend + `mockChatSend`; navigate
   *    to `/default/1?view=chat`.
   * 2. Assert the `chat-send-input` is visible.
   * 3. Assert `document.body.scrollWidth <= 375`.
   * 4. Assert the input's bounding-box `y` is at or below the `chat-view`'s `y`
   *    (footer position).
   */
  test("375px: the send input sits below the transcript with no horizontal overflow", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await mockChatSend(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    // No horizontal page overflow at 375px.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE.width);
    // The input sits below the transcript (footer position).
    const viewBox = await page.getByTestId("chat-view").boundingBox();
    const inputBox = await input.boundingBox();
    expect(viewBox).toBeTruthy();
    expect(inputBox).toBeTruthy();
    expect(inputBox!.y).toBeGreaterThanOrEqual(viewBox!.y);
  });
});
