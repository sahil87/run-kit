# chat-view.spec.ts

Verifies the **HTML chat view**: the read side (260714-r7rq — Change 3) plus the
**send** side (260714-jdyg-chat-send — Change 4). Read: the `?view=chat`
search-param view over the existing terminal route, the `Chat: <window>` heading,
the message-bubble / collapsible-tool-card / pending-question renderer, mobile
single-row budget, and reduced-motion honoring. Send: the input footer (replacing
the old read-only disabled footer) POSTs to the chat-send endpoint, clears on
success, surfaces a 409 probe failure inline while keeping the text, and shows a
non-blocking busy hint while the window agent is active. The chat lens is reached
through the UNIFIED window-view `ViewSwitcher` (spec R4, `web-view-lens`): a
chat-capable window with no `@rk_url` offers `[tty|chat]` segments in the L1 chip
(`data-testid="view-toggle"`, gated on a non-empty `chatProvider`), the `Chat view`
segment flips into chat, and the shipped `Ctrl+\`` binding toggles tty↔chat.

## Shared setup

- Fully mocked — no tmux, no `gh`, no real backend. Injected via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack + `sessions` event carry the mocked payload, session `dev` with
    two windows: `@1` "agent-win" (`chatProvider: claude`, the active window) and
    `@2` "plain-win" (no `chatProvider`).
  - `**/api/windows/*/chat/stream*` → a `text/event-stream` body carrying a
    `chat-backfill` (and, per test, a `chat-state`). The trailing `*` is required
    because the client appends `?server=`.
  - The relay WebSocket is stubbed.
- `backfillWithPending()` — a backfill with a user message, an assistant
  markdown message, a `tool_use`/`tool_result` pair, and a tail pending question.
- `backfillCleared()` — a backfill with two plain messages and a `chat-state`
  `pending: null`.
- `mockChatSend(page, { status, error })` — routes the chat-send POST
  (`**/api/windows/*/chat/send*`, trailing `*` for the appended `?server=`),
  records each request's `text` body, and fulfils either `200 {"ok":true}` or a
  non-200 `writeError` JSON `{ error }` (so the client's `throwOnError` surfaces
  the structured message). Used only by the send tests.

## Tests

### `the tty|chat switcher appears only on a chatProvider window`

**What it proves:** the unified L1 ViewSwitcher chip (`view-toggle`) is gated on
the current window carrying a non-empty `chatProvider` — present on `@1`
(claude), absent on `@2` (plain, which offers only `tty` so the chip renders
null) — and a `?view=chat` deep link on a chat-less window degrades gracefully to
the terminal (param inert, dropped by `resolveView`'s availability check).

**Steps:**
1. Mock the backend; navigate to `/default/1` and assert the `view-toggle` is
   visible.
2. Navigate to `/default/2`; assert "plain-win" is visible and the `view-toggle`
   has count 0.
3. Navigate to `/default/2?view=chat`; assert no `chat-view` renders, no
   `view-toggle` renders, and the static `Window:` heading prefix shows (the
   terminal branch mounted despite the param; 260714-uco1 — the heading is
   `Window:` in every lens).

### `flipping to chat preserves the window and updates the URL (heading stays Window:)`

**What it proves:** clicking the switcher's chat segment flips the view without
changing the window — the URL gains `?view=chat` on the same `@1` and the chat
renderer mounts. The center heading is a static `Window:` throughout (260714-uco1
— it no longer changes with the lens; the ViewSwitcher chip is the lens
indicator), so the heading anchor does not jump on the switch. The window rename
affordance carries over.

**Steps:**
1. Navigate to `/default/1`; assert the toggle and the `Window:` prefix.
2. Click the `Chat view` segment (by its accessible role/name).
3. Assert the URL is `/default/1?view=chat`, the `chat-view` renderer is visible,
   the heading still shows the `Window:` prefix, and the `Rename window agent-win`
   heading button is present.

### `Ctrl+\` toggles tty↔chat (the shipped keyboard binding)`

**What it proves:** the `Ctrl+\`` binding (plain Ctrl on both platforms — the
VS-Code "toggle terminal" association) flips the chat lens on and off, keeping
the URL `?view=` param in sync, exactly like the switcher segment. The heading
stays the static `Window:` throughout (it does not vary with the lens).

**Steps:**
1. Navigate to `/default/1`; assert the switcher and the `Window:` prefix.
2. Press `Control+\``; assert the URL is `/default/1?view=chat` and `chat-view`
   is visible.
3. Press `Control+\`` again; assert the `?view` param is dropped and the
   `Window:` prefix is still shown.

### `deep link ?view=chat cold-loads into the chat view`

**What it proves:** a cold navigation straight to `?view=chat` renders the chat
view (URL precedence over the terminal default), including the live send input
(the old read-only disabled footer is gone) and a markdown-rendered assistant
message.

**Steps:**
1. Navigate directly to `/default/1?view=chat`.
2. Assert the `chat-view` and static `Window:` prefix are visible, the
   `chat-send-disabled` footer has count 0, the `chat-send-input` is visible, and
   the assistant text ("done") is shown.

### `renders bubbles + a collapsible tool card, and the pending bubble at the tail`

**What it proves:** the renderer draws distinct user/assistant bubbles, a
collapsible tool-call card (collapsed by default, expandable to reveal
`toolInput`/`toolOutput`), and an attention-styled pending bubble at the tail.

**Steps:**
1. Mock a backfill with the pending question; navigate to `/default/1?view=chat`.
2. Assert the user and assistant bubbles contain their text.
3. Assert the tool card is visible, shows `Bash`, and does NOT show the output
   ("all green") while collapsed.
4. Click the card header; assert it now shows the input ("just test") and output.
5. Assert the pending bubble contains "Ship it?".

### `the pending bubble clears on a chat-state pending:null`

**What it proves:** a `chat-state` frame with `pending: null` retracts the
pending bubble (the retractable-state contract — always applied, incl. null).

**Steps:**
1. Mock a backfill carrying a pending, followed by a `chat-state`
   `pending: null` on the same stream; navigate to `/default/1?view=chat`.
2. Assert the `chat-view` is visible, then assert the `chat-pending` bubble has
   count 0.

### `375px top bar stays single-line with the chat toggle (no horizontal overflow)`

**What it proves:** the toggle is visible at 375px (unlike its `hidden sm:flex`
L1 siblings) and the top-bar single-row budget holds — no wrap, no horizontal
page overflow.

**Steps:**
1. Set the viewport to 375×812; navigate to `/default/1?view=chat`.
2. Assert the `view-toggle` is visible.
3. Assert `document.body.scrollWidth <= 375`.
4. Assert the header's bounding-box height is < 56px (a wrap would ~double it).

### `reduced-motion is honored — the chat view carries no running animations`

**What it proves:** under the config's global `reducedMotion: reduce`, no element
inside the chat view reports a running CSS animation (the view has no decorative
motion; attention/pending are color + text, never motion-only).

**Steps:**
1. Navigate to `/default/1?view=chat`; assert the `chat-view` is visible.
2. Evaluate `getComputedStyle(...).animationName` across the view subtree; assert
   none is a running animation (all `none`).

## Tests — Chat send (`Chat send — input, POST, error surfacing, busy hint`)

Shared: each test additionally calls `mockChatSend(page, …)` to route the
chat-send POST (see Shared setup).

### `typing + Enter fires exactly one POST with the typed body and clears on success`

**What it proves:** typing into the send input and pressing Enter fires EXACTLY
one chat-send POST carrying the typed text; on a `200` the input clears and no
inline error shows.

**Steps:**
1. Mock the backend + `mockChatSend` (200); navigate to `/default/1?view=chat`.
2. Fill `chat-send-input` with "run the tests" and press Enter.
3. Assert exactly one recorded POST body equal to "run the tests".
4. Assert the input is now empty and `chat-send-error` has count 0.

### `a 409 probe failure surfaces the inline error and keeps the text`

**What it proves:** a `409` (probe failure) response renders the server's
structured error in an inline `role="alert"` line and RETAINS the typed text (so
the user can retry) — never a silent failure.

**Steps:**
1. Mock `mockChatSend` with `status: 409` and the probe-failure `error`; navigate
   to `/default/1?view=chat`.
2. Fill the input with "ship it" and press Enter.
3. Assert `chat-send-error` is visible and contains "Enter withheld".
4. Assert the input still holds "ship it".

### `the busy hint renders when the window agentState is active (input stays enabled)`

**What it proves:** while the current window's `agentState` is `active` (as in the
shared `@1` payload) the non-blocking busy hint renders and the input stays
ENABLED (Allow + probe policy — no client-side block).

**Steps:**
1. Mock the backend + `mockChatSend`; navigate to `/default/1?view=chat`.
2. Assert the `chat-send-input` and `chat-send-busy-hint` are visible.
3. Assert the input is enabled.

### `375px: the send input sits below the transcript with no horizontal overflow`

**What it proves:** on a 375px viewport the send input renders as a footer below
the transcript with no horizontal page overflow (mobile ergonomics — the input is
inside the pane, not the bars).

**Steps:**
1. Set the viewport to 375×812; mock the backend + `mockChatSend`; navigate to
   `/default/1?view=chat`.
2. Assert the `chat-send-input` is visible.
3. Assert `document.body.scrollWidth <= 375`.
4. Assert the input's bounding-box `y` is at or below the `chat-view`'s `y`
   (footer position).
