# chat-view.spec.ts

Verifies the **HTML chat view**: the read side (260714-r7rq — Change 3) plus the
**send** side (260714-jdyg-chat-send — Change 4). Read: the `?view=chat`
deep-link lens over the existing terminal route (since
`260812-ab5v-surface-layout-core` the lens IS a single-tile surface layout —
`?view=chat` resolves through the permanent shim to `single:chat` and the URL
mirrors `?layout=`), the `Chat: <window>` heading, the message-bubble /
collapsible-tool-card / pending-question renderer, mobile single-row budget,
and reduced-motion honoring. Send: the input footer (replacing the old
read-only disabled footer) POSTs to the chat-send endpoint, clears on success,
surfaces a 409 probe failure inline while keeping the text, and shows a
non-blocking busy hint while the window agent is active. The chat lens is
reached through the command palette's `View: Chat` action (or the `?view=chat`
deep link): the ViewSwitcher is RETIRED (`260812-0c6o`), so the palette is the
ONLY lens-switch surface, the right rail shows NO chat button
(`SURFACE_RAIL_HIDDEN` — chat is palette-only), and the former `Ctrl+\``
chat-toggle chord is gone (fully unbound since `260813-j3jb` — the chord
belongs to code-server).

## Shared setup

- Fully mocked — no tmux, no `gh`, no real backend. Chat moved onto the state
  socket (260717-vhvz): the backfill demoted to a plain `GET`, and incremental
  events ride the `kind:"chat"` subscription — there is **no** chat SSE stub.
  Injected via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack +
    `sessions` event carry the mocked payload, session `dev` with two windows:
    `@1` "agent-win" (`chatProvider: claude`, the active window) and `@2`
    "plain-win" (no `chatProvider`). The mock ALSO answers a `kind:"chat"`
    subscribe with an ack carrying `{offset}` (no snapshot, D5), then emits any
    configured `chat` / `chat-state` / `chat-reset` frames.
  - `**/api/windows/*/chat*` → the chat backfill: a plain JSON `Conversation`
    with an additive byte `offset` (the trailing `*` is required because the
    client appends `?server=`; the `/chat/send` POST is left to `mockChatSend`).
  - The terminals mux WebSocket (`/ws/terminals`) is stubbed. No `/relay/` or SSE
    stubs (memory `relay-mux-stale-ws-stub-class`).
- `backfillWithPending()` — a `Conversation` (offset-bearing) with a user
  message, an assistant markdown message, a `tool_use`/`tool_result` pair, and a
  tail pending question.
- `backfillCleared()` — a `Conversation` with two plain messages and no pending.
- `mockBackend(page, conv, chatOpts?, winName?)` — wires the routes above; `conv`
  is the GET backfill body and `chatOpts` drives the socket's post-ack chat frames
  (e.g. `{ state: { pending: null } }` to clear a backfilled pending).
- `mockChatSend(page, { status, error })` — routes the chat-send POST
  (`**/api/windows/*/chat/send*`, trailing `*` for the appended `?server=`),
  records each request's `text` body, and fulfils either `200 {"ok":true}` or a
  non-200 `writeError` JSON `{ error }` (so the client's `throwOnError` surfaces
  the structured message). Used only by the send tests.

## Tests

### `the `View: Chat` palette action appears only on a chatProvider window; the rail shows no chat button (260812-0c6o)`

**What it proves:** the palette's `View: Chat` action is gated on the current
window carrying a non-empty `chatProvider` — present on `@1` (claude), absent
on `@2` (plain, which offers only `tty`) — and the retirement contract
(`260812-0c6o`): even on the capable window there is no in-bar pill, no
`view-toggle` testid anywhere in the DOM, no `View:` rows in the chevron menu,
and NO chat button in the right rail (`SURFACE_RAIL_HIDDEN` — chat is
palette-only) while the tty rail button remains. A `?view=chat` deep link on a
chat-less window degrades gracefully to the terminal (the shim's `single:chat`
translation degrades tile-by-tile to `single:tty` — chat is unavailable there).

**Steps:**
1. Mock the backend; navigate to `/default/1`; gate on the `Window:` heading.
   Assert the `Window view` group has count 0 AND `view-toggle` has count 0.
   Assert the rail shows the `Terminal tile` button but NO `Chat tile` button.
   Open the palette with `View: Chat` and assert the option is visible;
   Escape. Open the "More controls" menu and assert it carries NO `View:` rows;
   Escape-close.
2. Navigate to `/default/2`; assert "plain-win" is visible; open the palette
   and assert it offers NO `View: Chat` option; Escape-close.
3. Navigate to `/default/2?view=chat`; assert no `chat-view` renders, no
   `Window view` group renders, and the static `Window:` heading prefix shows (the
   terminal branch mounted despite the param; 260714-uco1 — the heading is
   `Window:` in every lens).

### `flipping to chat preserves the window and updates the URL (heading stays Window:)`

**What it proves:** activating the palette's `View: Chat` action (the only
lens-switch surface, `260812-0c6o`) flips the view without changing the
window — the URL mirrors `?layout=single:chat` on the same `@1` (R12's shim: a
view selection is a single-tile layout mutation through the shared path) and
the chat renderer mounts. The center heading is a static `Window:` throughout
(260714-uco1 — it does not change with the lens), so the heading anchor does
not jump on the switch. The window rename affordance carries over.

**Steps:**
1. Navigate to `/default/1`; gate on the `Window:` prefix.
2. `switchLens("Chat")` — open the palette (`Meta+k`), fill `View: Chat`, click
   the option, and wait for the palette to close.
3. Assert the decoded `layout` param is `single:chat`, the `chat-view` renderer
   is visible, the heading still shows the `Window:` prefix, and the `Rename
   window agent-win` heading button is present.

### `Ctrl+\` no longer flips to the chat lens (the chord is fully unbound, 260813-j3jb)`

**What it proves:** the `Ctrl+\`` chord no longer reaches the chat lens — the
chord is fully unbound (the interim layout-zoom rebind was removed in
`260813-j3jb`; Ctrl+\` belongs to code-server), so it falls through untouched.
No `single:chat` layout, no chat view, no heading change.

**Steps:**
1. Navigate to `/default/1`; gate on the `Window:` prefix (the always-present
   readiness surface).
2. Press `Control+\``; wait a beat for any erroneous handler to fire.
3. Assert the `layout` param is ABSENT (default `single:tty` drops it), the
   `chat-view` testid has count 0, and the `Window:` prefix is still shown.

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
1. Mock the GET backfill with a pending, and a `chat-state` `pending: null`
   emitted over the state socket after the chat subscribe ack; navigate to
   `/default/1?view=chat`.
2. Assert the `chat-view` is visible, then assert the `chat-pending` bubble has
   count 0.

### `375px: the chat lens renders with a long window name and no switcher chrome (no horizontal overflow)`

**What it proves:** at 375px with a realistically long window name, the retired
switcher (`260812-0c6o`) leaves no chrome anywhere — the center heading keeps
its room because there is never an inline pill — the palette is the switch
surface (`View: Terminal` is offered as the way back), and the top-bar
single-row budget still holds (no wrap, no horizontal page overflow).

**Steps:**
1. Mock the backend with a long `@1` window name (`riff-gallant-jackal-worktree-mobile`); set the viewport to 375×812; navigate to `/default/1?view=chat`.
2. Assert the `chat-view` is visible (the lens resolved / window loaded).
3. Assert the in-bar switcher group ("Window view") has count 0 AND the `view-toggle` testid has count 0.
4. Open the palette with `View: Terminal`; assert the option is visible; Escape-close.
5. Assert `document.body.scrollWidth <= 375`.
6. Assert the header's bounding-box height is < 56px (a wrap would ~double it).

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

### `typing + Cmd/Ctrl+Enter fires exactly one POST with the typed body and clears on success`

**What it proves:** plain Enter is NOT a send (260801-hsxm — it inserts a
newline so lines accumulate locally, no POST fires); pressing Cmd/Ctrl+Enter
(the only submit chord) fires EXACTLY one chat-send POST carrying the
accumulated text; on a `200` the input clears and no inline error shows.

**Steps:**
1. Mock the backend + `mockChatSend` (200); navigate to `/default/1?view=chat`.
2. Fill `chat-send-input` with "run the tests" and press Enter; assert the value
   is now `run the tests\n` and NO POST was recorded.
3. Press `ControlOrMeta+Enter`.
4. Assert exactly one recorded POST body equal to `run the tests\n`, and that
   the parsed body carries NO `submit` field (the additive wire contract keeps
   the default shape exactly `{ text }` — 260719-mxvw).
5. Assert the input is now empty and `chat-send-error` has count 0.

### `the Insert button POSTs submit:false and clears (insert-without-submit, 260719-mxvw)`

**What it proves:** the Insert button (the insert-without-submit affordance —
paste into the agent's input box, gated Enter skipped server-side) fires exactly
one chat-send POST with the explicit body `{ text, submit: false }` and clears
the input on success. Also asserts `enterkeyhint="enter"` (the truthful keyboard
hint — Enter inserts a newline on every pointer type; chord/readline behavior is
unit-tested in `chat-view.test.tsx` / `compose-keys.test.ts` /
`readline-keys.test.ts`).

**Steps:**
1. Mock the backend + `mockChatSend` (200); navigate to `/default/1?view=chat`.
2. Assert `chat-send-input` carries `enterkeyhint="enter"`.
3. Fill the input with "stage this prompt" and click `chat-send-insert`.
4. Assert exactly one recorded parsed body equal to
   `{ text: "stage this prompt", submit: false }`.
5. Assert the input is now empty and `chat-send-error` has count 0.

### `a 409 probe failure surfaces the inline error and keeps the text`

**What it proves:** a `409` (probe failure) response renders the server's
structured error in an inline `role="alert"` line and RETAINS the typed text (so
the user can retry) — never a silent failure.

**Steps:**
1. Mock `mockChatSend` with `status: 409` and the probe-failure `error`; navigate
   to `/default/1?view=chat`.
2. Fill the input with "ship it" and press `ControlOrMeta+Enter`.
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
