# chat-view.spec.ts

Verifies the **read-only HTML chat view** (260714-r7rq — Change 3 of the
agent-chat-view plan): the `?view=chat` search-param view over the existing
terminal route, the `Chat: <window>` heading, the message-bubble /
collapsible-tool-card / pending-question renderer, mobile single-row budget, and
reduced-motion honoring. The chat lens is reached through the UNIFIED window-view
`ViewSwitcher` (spec R4, `web-view-lens`): a chat-capable window with no `@rk_url`
offers `[tty|chat]` segments in the L1 chip (`data-testid="view-toggle"`, gated on
a non-empty `chatProvider`), the `Chat view` segment flips into chat, and the
shipped `Ctrl+\`` binding toggles tty↔chat.

## Shared setup

- Fully mocked — no tmux, no `gh`, no real backend. Injected via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `**/api/sessions/stream*` → one `event: sessions` frame, session `dev` with
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
   `view-toggle` renders, and the `Terminal:` heading prefix shows (the
   terminal branch mounted despite the param).

### `flipping to chat preserves the window, updates the URL, and reads Chat: <window>`

**What it proves:** clicking the switcher's chat segment flips the view without
changing the window — the URL gains `?view=chat` on the same `@1`, the center
heading changes from `Terminal:` to `Chat:`, and the chat renderer mounts. The
window rename affordance carries over.

**Steps:**
1. Navigate to `/default/1`; assert the toggle and the `Terminal:` prefix.
2. Click the `Chat view` segment (by its accessible role/name).
3. Assert the URL is `/default/1?view=chat`, the `Chat:` prefix shows, the
   `chat-view` renderer is visible, and the `Rename window agent-win` heading
   button is present.

### `Ctrl+\` toggles tty↔chat (the shipped keyboard binding)`

**What it proves:** the `Ctrl+\`` binding (plain Ctrl on both platforms — the
VS-Code "toggle terminal" association) flips the chat lens on and off, keeping
the URL `?view=` param in sync, exactly like the switcher segment.

**Steps:**
1. Navigate to `/default/1`; assert the switcher and the `Terminal:` prefix.
2. Press `Control+\``; assert the URL is `/default/1?view=chat` and `chat-view`
   is visible.
3. Press `Control+\`` again; assert the `?view` param is dropped and the
   `Terminal:` prefix returns.

### `deep link ?view=chat cold-loads into the chat view`

**What it proves:** a cold navigation straight to `?view=chat` renders the chat
view (URL precedence over the terminal default), including the disabled
read-only footer and a markdown-rendered assistant message.

**Steps:**
1. Navigate directly to `/default/1?view=chat`.
2. Assert the `chat-view`, the `Chat:` prefix, the disabled `chat-send-disabled`
   footer, and the assistant text ("done") are all visible.

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
