import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the `sessions` payload over the state-socket
// mock + the server list + the chat backfill (a plain GET) via page.route, then
// drive the chat view. Chat moved onto the state socket (260717-vhvz): the
// backfill demoted to GET /api/windows/{id}/chat and incremental events ride the
// `kind:"chat"` subscription — there is NO chat SSE stub. See chat-view.spec.md
// for intent + steps.
//
// Chat read frontend (260714-r7rq — Change 3 of the agent-chat-view plan): a
// read-only HTML chat view over the same agent pane, toggled via `?view=chat`
// on the existing terminal route. The view toggle is the UNIFIED window-view
// lens switcher (spec R4, `web-view-lens`) — MENU-ONLY as of 260722-n2n4: the
// segmented pill never renders in-bar (the registry entry is `menuOnly`), and
// a chat-capable window with no `@rk_url` offers `View: Terminal` /
// `View: Chat` menuitemradio rows in the "More controls" chevron menu, which
// are the switcher's only rendering at every width.

const SERVER = "default";
const MOBILE = { width: 375, height: 812 };

// The menu-only switcher surface (260722-n2n4) — mirrors web-view-lens.spec.ts.
const menuButton = (page: Page) =>
  page.getByRole("button", { name: "More controls" });
const controlsMenu = (page: Page) =>
  page.getByRole("menu", { name: "More controls" });
const viewRow = (page: Page, label: "Terminal" | "Chat") =>
  controlsMenu(page).getByRole("menuitemradio", { name: `View: ${label}` });

/** Open the chevron menu, click the `View: {label}` row, and wait for the menu
 *  to close (a `menuitemradio` activation is a single-shot menu action). */
async function switchLens(page: Page, label: "Terminal" | "Chat"): Promise<void> {
  await menuButton(page).click();
  const row = viewRow(page, label);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(controlsMenu(page)).toBeHidden();
}

// Two windows: @1 is a chat-capable claude window; @2 is a plain (no
// chatProvider) window used to prove the toggle is gated. `winName` overrides
// @1's window name — the 375px test passes a long worktree-style name to prove
// the center heading keeps its room (the switcher is menu-only at every width
// as of 260722-n2n4, so the long name exercises heading space, not a pill drop
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
  test("the `View: Chat` menu row appears only on a chatProvider window (no in-bar pill ever)", async ({ page }) => {
    await mockBackend(page, backfillCleared());

    // @1 is chat-capable → the switcher renders as `View:` rows in the chevron
    // menu, and ONLY there (260722-n2n4 menuOnly): no in-bar "Window view"
    // group and no `view-toggle` testid anywhere in the DOM (bar or probe).
    await page.goto(`/${SERVER}/1`);
    await expect(page.getByText("Window", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);
    await menuButton(page).click();
    await expect(viewRow(page, "Terminal")).toBeVisible({ timeout: 10_000 });
    await expect(viewRow(page, "Chat")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(controlsMenu(page)).toBeHidden();

    // @2 has no chatProvider → single-view → the registry entry is hidden
    // everywhere: no in-bar group, no probe copy, and no `View:` menu rows.
    await page.goto(`/${SERVER}/2`);
    await expect(page.getByText("plain-win").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await menuButton(page).click();
    await expect(controlsMenu(page)).toBeVisible();
    await expect(
      controlsMenu(page).getByRole("menuitemradio", { name: /^View:/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Chat-less deep-link degradation: `?view=chat` on @2 is inert — the
    // terminal renders (no chat view, no switcher). The heading is the static
    // `Window:` prefix (260714-uco1 — no longer lens-following).
    await page.goto(`/${SERVER}/2?view=chat`);
    await expect(page.getByText("plain-win").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-view")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByText("Window", { exact: true })).toBeVisible();
  });

  test("flipping to chat preserves the window and updates the URL (heading stays `Window:`)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1`);

    // The heading is a static `Window:` prefix (260714-uco1) — the lens is shown
    // by the switcher's `View:` menu rows, not the heading.
    await expect(page.getByText("Window", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Switch via the chevron menu's `View: Chat` row — the switcher's only
    // rendering (menu-only, 260722-n2n4).
    await switchLens(page, "Chat");

    // Same window (@1 → segment `1`), now with ?view=chat.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1\\?view=chat`));
    // The renderer mounts; the heading stays `Window:` across the lens switch
    // (the anchor no longer jumps). The chat lens is proven by the chat-view.
    await expect(page.getByTestId("chat-view")).toBeVisible();
    await expect(page.getByText("Window", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Rename window agent-win` })).toBeVisible();
  });

  test("Ctrl+` toggles tty↔chat (the shipped keyboard binding)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1`);
    // Gate on the heading — the always-present readiness surface (the switcher
    // has no in-bar pill to gate on since 260722-n2n4).
    await expect(page.getByText("Window", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Ctrl+` (plain Ctrl on both platforms — the VS-Code "toggle terminal"
    // association) flips into the chat lens: URL gains ?view=chat, chat mounts.
    await page.keyboard.press("Control+`");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1\\?view=chat`));
    await expect(page.getByTestId("chat-view")).toBeVisible();

    // A second Ctrl+` flips back to tty and drops the ?view param. The heading
    // is the static `Window:` throughout (does not vary with the lens).
    await page.keyboard.press("Control+`");
    await expect(page).not.toHaveURL(/\?view=/);
    await expect(page.getByText("Window", { exact: true })).toBeVisible();
  });

  test("deep link ?view=chat cold-loads into the chat view", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Window", { exact: true })).toBeVisible();
    // The read-only disabled footer is GONE (260714-jdyg-chat-send) — the live
    // send input replaces it.
    await expect(page.getByTestId("chat-send-disabled")).toHaveCount(0);
    await expect(page.getByTestId("chat-send-input")).toBeVisible();
    // The assistant markdown message rendered (bold via react-markdown).
    await expect(page.getByTestId("chat-view")).toContainText("done");
  });

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

  test("the pending bubble clears on a chat-state pending:null", async ({ page }) => {
    // The GET backfill carries a pending; then a `chat-state` pending:null rides
    // the state socket after the subscribe ack and clears it on the same lens.
    await mockBackend(page, backfillWithPending(), { state: { pending: null } });
    await page.goto(`/${SERVER}/1?view=chat`);

    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });
    // After the chat-state, the pending bubble is gone.
    await expect(page.getByTestId("chat-pending")).toHaveCount(0, { timeout: 5_000 });
  });

  test("375px: the chat toggle lives in the More-controls menu with a long window name (no horizontal overflow)", async ({ page }) => {
    // 260722-n2n4: the switcher is menu-only at every width, so at phone width
    // with a realistically long window name the heading keeps its room and the
    // per-view `View:` rows in the "More controls" menu are the toggle surface.
    await mockBackend(page, backfillCleared(), undefined, "riff-gallant-jackal-worktree-mobile");
    await page.setViewportSize(MOBILE);
    await page.goto(`/${SERVER}/1?view=chat`);

    // The chat view itself renders (lens resolved), proving the window is loaded.
    await expect(page.getByTestId("chat-view")).toBeVisible({ timeout: 10_000 });

    // No in-bar pill and no probe copy (menuOnly): neither the accessible
    // "Window view" group nor the raw `view-toggle` testid exists anywhere.
    await expect(page.getByRole("group", { name: "Window view" })).toHaveCount(0);
    await expect(page.getByTestId("view-toggle")).toHaveCount(0);

    // The switcher is reachable in the chevron menu as per-view rows, and the
    // active (chat) row is marked.
    await menuButton(page).click();
    const menu = controlsMenu(page);
    await expect(menu).toBeVisible();
    await expect(viewRow(page, "Terminal")).toBeVisible();
    const chatRow = viewRow(page, "Chat");
    await expect(chatRow).toBeVisible();
    await expect(chatRow).toHaveAttribute("aria-checked", "true");

    // No horizontal page overflow at 375px even with the long name.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE.width);

    // The header row stays a single line (a wrap would ~double the height).
    const box = await page.locator("header").first().boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThan(56);
  });

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
  test("typing + Enter fires exactly one POST with the typed body and clears on success", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    const send = await mockChatSend(page); // 200
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("run the tests");
    await input.press("Enter");

    // Exactly one POST with the typed body.
    await expect.poll(() => send.bodies.length).toBe(1);
    expect(send.bodies[0]).toBe("run the tests");
    // Default submit ⇒ the body carries NO `submit` field — the additive wire
    // contract keeps the default shape exactly `{ text }` (260719-mxvw).
    expect("submit" in send.raw[0]).toBe(false);
    // Cleared on success.
    await expect(input).toHaveValue("");
    // No inline error.
    await expect(page.getByTestId("chat-send-error")).toHaveCount(0);
  });

  test("the Insert button POSTs submit:false and clears (insert-without-submit, 260719-mxvw)", async ({ page }) => {
    await mockBackend(page, backfillCleared());
    const send = await mockChatSend(page); // 200
    await page.goto(`/${SERVER}/1?view=chat`);

    const input = page.getByTestId("chat-send-input");
    await expect(input).toBeVisible({ timeout: 10_000 });
    // Fine pointer (default e2e environment): Enter submits, so the keyboard
    // hint states "send".
    await expect(input).toHaveAttribute("enterkeyhint", "send");
    await input.fill("stage this prompt");
    await page.getByTestId("chat-send-insert").click();

    // Exactly one POST carrying the explicit insert flag.
    await expect.poll(() => send.raw.length).toBe(1);
    expect(send.raw[0]).toEqual({ text: "stage this prompt", submit: false });
    // Cleared on success (the text now lives in the agent's input box).
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("chat-send-error")).toHaveCount(0);
  });

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
    await input.press("Enter");

    // The inline role="alert" carries the server's structured 409 message.
    const err = page.getByTestId("chat-send-error");
    await expect(err).toBeVisible();
    await expect(err).toHaveText(/Enter withheld/);
    // Text is KEPT on failure.
    await expect(input).toHaveValue("ship it");
  });

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
