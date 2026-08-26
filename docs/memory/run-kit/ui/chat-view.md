---
type: memory
description: "The ?view=chat lens frontend: TS mirror of the rk-owned chat schema, pure derivation helpers (dedup/turn-group/tool-pair/pending), the useChatSubscription hook (one guarded compose for mount + reconnect), the read-only ChatView renderer (react-markdown + remark-gfm), the ChatSendForm input wired by AppShell, lens-machinery view state, center heading, connection dot = stream health, WaitingBadge deep-link, and the shared Enter-policy classifier."
---
# Chat View (lens frontend)

**Domain**: run-kit

## Chat View Frontend

The read-only frontend consumer of the backend contract above. The pure schema
+ derivation helpers live in `app/frontend/src/lib/chat-stream.ts`; the
subscription lifecycle in `app/frontend/src/hooks/use-chat-subscription.ts`
(GET-backfill→state-socket-subscribe); the
renderer in `app/frontend/src/components/chat-view.tsx`. The view-state
plumbing (the `?view=` param, ViewSwitcher chip, heading, value-bearing
persistence, palette, `Ctrl+`` shortcut, connection dot) is the UNIFIED lens
machinery documented in [ui/lenses-and-layout](/run-kit/ui/lenses-and-layout.md) § Window Views
(Lens Model) / § Chat View — this section owns the DATA-layer consumer half only.

### Requirement: Frontend mirrors the rk-owned schema as TS types
`chat-stream.ts` SHALL define TypeScript types mirroring the backend schema
one-to-one: `ChatEvent` (`type`/`id?`/`turn`/`role?`/`text?`/`toolUseId?`/
`toolName?`/`toolInput?: unknown`/`toolOutput?`/`isError?`/`ts?` — every field
except `type`/`turn` optional, matching the backend `omitempty`), `ChatPending`
(`toolUseId?`/`toolName?`/`text?`), and `Conversation` (`{provider, sessionRef,
events, pending, offset}`, `pending` nullable; `offset: number` is the backfill
byte offset the subscription tails `from`). `toolInput` is typed `unknown`
(verbatim provider JSON, rendered pretty-printed) — type narrowing over `as` casts
(code-quality Frontend rule). The `WindowInfo` gate fields `chatProvider`/
`chatSessionRef` are typed on `WindowInfo` (`types.ts`); the backend emits them on
every `/api/sessions` response + SSE `sessions` event, needing no client parsing.

#### Scenario: An event with no `id` is still rendered
- **GIVEN** a `ChatEvent` whose optional `id` is absent
- **WHEN** the append/render pipeline runs
- **THEN** it is not deduped away (dedup keys on `id`; a missing `id` always
  appends) and it renders like any other event.

### Requirement: Pure derivation helpers (dedup / turn-group / tool-pair / pending)
`chat-stream.ts` SHALL export the pure helpers the hook + renderer compose, each
unit-tested without an `EventSource` or a mounted component (mirroring the
`palette/move.ts` / `palette/agent-nav.ts` extraction pattern):
- `applyChatBackfill(conv)` — returns `conv.events` verbatim (backfill REPLACES,
  never appends).
- `appendChatEvents(existing, incoming)` — appends `incoming` deduped by `id`
  (an event with no `id` is always appended); preserves order; returns the same
  array reference when nothing is added (render-stability).
- `groupEventsByTurn(events)` — groups into ascending-`turn` blocks, events in
  arrival order within a turn (the counter IS the boundary — no synthetic events).
- `pairToolEvents(events)` — one `ToolCard` (`{use, result}`) per `tool_use` in
  arrival order, joined to the FIRST matching `tool_result` by `toolUseId`
  (`result: null` when unpaired); a `tool_result` matching no `tool_use` is
  dropped (defensive against a mid-append partial stream).
- `derivePendingBubble(pending)` — returns `{label, toolName?}` preferring
  `pending.text`, falling back to `toolName` when text is empty, else `null` so
  the renderer clears a resolved marker.

#### Scenario: A tool_use/tool_result pair collapses into one card
- **GIVEN** a turn with a `tool_use` and its matching `tool_result` (same
  `toolUseId`)
- **WHEN** `pairToolEvents` runs
- **THEN** it returns exactly one `ToolCard` joining them, and the renderer
  draws one collapsible card (the paired `tool_result` is not drawn separately).

### Requirement: `useChatSubscription` hook (`use-chat-subscription.ts`)
`useChatSubscription(server, windowId)` SHALL return the shape
`{events, pending, connected, error}` consumed by `app.tsx`/`ChatView`.
It drives its lifecycle through the `session-context` chat seam
(`subscribeChat`/`unsubscribeChat`/`registerChatHandlers`/`socketConnected`) — it
holds NO socket handle (R11). On chat-lens enter it **composes fetch→subscribe**
(gap-free/duplicate-free, D5): reset view state → `getWindowChat(server, windowId)`
(`applyChatBackfill` REPLACE + set pending; the response carries the transcript
byte `offset`) → `subscribeChat({server, windowId, from: conv.offset})`. Live
frames via the context handler seam: `chat` → `appendChatEvents` (id-dedup
retained as a defensive layer), `chat-state` → set pending **always incl. `null`**,
`chat-reset` → **re-run the composition** (rotation / shrink / dropped-frame
recovery — no transcript rode the socket), `chat-error` → set the inline `error`.
`getWindowChat` throws `HttpError`; a **404 is treated as wait-and-retry** on a
`NOT_YET_RETRY_MS = 500` backoff (a lazy transcript not yet written, e.g. right
after `/clear`) rather than wedging on an error — so `/clear` converges (a later
`chat-reset` re-triggers compose too, doubly assuring convergence).

**ONE guarded `compose`** (behind a `composeRef` carrying the current generation,
`cancelled`/`gen` guards) is shared by BOTH the mount effect AND the reconnect
effect (rework cycle 1 MUST-FIX): a reconnect GET still in flight when the user
switches windows / leaves the lens must NOT REPLACE the new window's state with the
old conversation, and must NOT re-subscribe the torn-down `(server,windowId)` after
its cleanup already unsubscribed (which would leak an ownerless server-side
producer). Stale completions are discarded; no subscribe fires for a torn-down
identity; cleanup resets the ref to a no-op. On socket reconnect it re-runs the
composition (no cursor — the no-cursor reset contract). Cleanup unsubscribes on
lens leave / window switch / unmount — no subscription outlives the view
(Constitution II). **Health** = `(socketConnected) AND (this window's chat
subscription acked)`, keeping the established 3s disconnect debounce.

#### Scenario: Compose gap-free; reconnect-across-switch discards the stale identity
- **GIVEN** the chat lens activates for `(server, windowId)`
- **WHEN** the hook runs
- **THEN** it GETs the offset-bearing backfill, REPLACES the event list, subscribes
  `from:<offset>`, and appends subsequent `chat` events without gaps/duplicates.
- **AND GIVEN** a `chat-reset` (rotation) arrives, **THEN** the hook re-runs the
  fetch→subscribe composition on the same lens.
- **AND GIVEN** a reconnect GET is in flight and the window then switches, **THEN**
  the stale conversation is NOT applied and the old `(server,windowId)` is NOT
  re-subscribed after cleanup (unsubscribe parity — no leaked subscription).

### Requirement: Read-only renderer (`chat-view.tsx`)
`ChatView` SHALL be a **pure renderer over passed stream state** (`{events,
pending, connected, error}`) — `AppShell` owns the single owner-hook call
(`useChatSubscription`) so ONE chat subscription feeds both the renderer and the
connection dot (§ Web Push / ui/lenses-and-layout.md § Chat View). It renders in the house
aesthetic (monospace,
three-mode theme tokens, animation behind `prefers-reduced-motion`):
- **Message bubbles** grouped by `turn` (`groupEventsByTurn`), user vs assistant
  visually distinct (right/left, distinct backgrounds); markdown + fenced code
  via `react-markdown` + `remark-gfm` scoped to a `.chat-markdown` wrapper (whose
  typography rules live in `globals.css` — code blocks render as plain monospace
  `<pre>`, no syntax highlighting in v1; links open `target="_blank"
  rel="noopener noreferrer"`).
- **Tool-call cards** — one collapsible card per `tool_use`/`tool_result` pair
  (`pairToolEvents`), **collapsed by default** (`aria-expanded`); header shows
  `toolName`, body shows pretty-printed `toolInput` JSON + `toolOutput` text; an
  `isError` result styled as an error. A rare orphan `tool_result` (no matching
  `tool_use` in its turn) renders bare.
- **Pending question** — an attention-styled (`role="status"`) bubble at the
  conversation **tail** carrying `derivePendingBubble`'s label; cleared when
  `chat-state` sets `pending: null`.
- **Streaming** — stick-to-bottom auto-follow (a `stickRef` gated on ~40px
  from-bottom + a `useLayoutEffect` on `[events, pendingBubble]`) unless the user
  has scrolled up.
- **Send form footer** — a `shrink-0` `ChatSendForm` (§ Send-form input box).
- **`chat-error`** — an inline `role="alert"` error state.

#### Scenario: Markdown bubble, collapsed tool card, tail pending
- **GIVEN** a conversation with markdown messages, a tool_use/tool_result pair,
  and a tail pending
- **WHEN** `ChatView` renders
- **THEN** bubbles render markdown, the tool card is collapsed by default and
  expands on click, and the pending bubble shows at the tail and clears when
  `pending` becomes null.

### Requirement: Send-form input box — pure `ChatSendForm`, AppShell-wired
`ChatView` SHALL stay a **pure component over passed props**. A `ChatSendForm`
child is the footer; `AppShell` supplies an
`onSend(text, submit): Promise<void>` callback (wrapping the `sendChatMessage(server,
windowId, text, submit)` client — `client.ts`, POSTs `{text}` (plus `submit:false`
only when false) via the shipped `withServer` + `throwOnError` shape so the server's
structured error, including the 409 probe message, surfaces as the thrown Error's
message) plus a `busy` boolean derived from `currentWindow.agentState === "active"`.
`ChatView` calls the client directly for nothing — it delegates to `onSend`. The
lens/switcher machinery (`window-view.ts`, `ViewSwitcher`, search-param validation —
[ui/lenses-and-layout](/run-kit/ui/lenses-and-layout.md) § Window Views) is NOT touched. The input UX:
- An auto-growing monospace `<textarea>` (`.rk-chat-input`, placeholder
  `Message the agent — Enter for newline · {submitKeycap} sends` on fine pointers
  and the short `Message the agent…` on coarse — `{submitKeycap}` is
  `composeSubmitKeycap()`; chat's plain Enter is a local newline, diverging from
  the strip, and the placeholder is where the divergence stops surprising —
  [ui/keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § Education micro-copy), bounded
  max-height then internal scroll, plus house-chip
  (`rk-glint`) **Insert** and **Send** buttons for touch/mouse (Insert left of Send,
  `data-testid="chat-send-insert"`, same enable/disable as Send, `title` documenting
  the Alt+Enter chord). Insert routes through the shared in-flight-locked submission
  with `submit:false` (`onSend(text, false)`); Send with `submit:true`.
- **Enter composes, Cmd/Ctrl+Enter sends — chat is the deliberately diverging surface**:
  the keydown routes through the shared pure `classifyComposeEnter(key, surface)`
  (`lib/compose-keys.ts`) — the SAME classifier both surfaces use, called here with
  `surface: "chat"`. One classifier stays the single authority for both surfaces' Enter
  policy, but plain Enter deliberately differs: chat keeps **Enter = newline** while the
  compose strip transmits the line (`text + "\n"`). The reason is **visibility** — the
  strip overlays the visible terminal, so a transmitted line lands in the pane's own
  composer where the user watches it appear; the chat lens cannot show the pane's input
  box, so Enter-as-insert here would make typed text visibly vanish into an invisible
  target. The divergence is declared INSIDE the classifier, per surface (`surface` is a
  required parameter with no default), never branched at this call site. **Enter and
  Shift+Enter = newline** on every pointer type (NOT intercepted — the textarea default;
  Enter accumulates lines locally so a reflexive Enter cannot fire a half-written prompt
  at a live agent). **Shift-less Cmd/Ctrl+Enter = submit** — the ONLY submit chord, on
  every device; the match is exact on Shift, so a **Shift+Cmd/Ctrl+Enter keydown is left
  un-consumed** and bubbles to the global zen-toggle chord (260820-ecl4).
  **Alt+Enter = insert-without-submit** (`submit:false`, the chord peer of the Insert
  button). Precedence: non-Enter/IME-composing → default; meta/ctrl without shift →
  submit; meta/ctrl with shift → default (un-consumed, alt or not); alt → insert;
  shift → default; plain Enter → default in chat (insert-line on the strip).
  Enter policy is pointer-independent, so the classifier reads no pointer hook. Empty /
  whitespace-only never sends in ANY chat mode — chat has no counterpart to the strip's
  empty Cmd/Ctrl+Enter bare-`"\r"`, because pressing Enter blind into a pane the lens
  cannot show is the same visibility hazard, and this path is probe-gated server-side.
  `keydown` **stops propagation** so a
  `Ctrl+`` toggle or other global chord never hijacks a keystroke while typing — and
  the textarea is explicitly EXEMPTED from the `Ctrl+`` view-toggle suppression via its
  `.rk-chat-input` class (see [ui/lenses-and-layout](/run-kit/ui/lenses-and-layout.md) § Window Views;
  the toggle must still fire from inside the chat input or the user is trapped).
- **Readline editing chords, shared with the compose strip**: the same keydown routes
  through `handleReadlineKey` (`lib/readline-keys.ts`) **before** Enter classification —
  Ctrl+U (kill to line start), Ctrl+W (delete word back), Alt+B/Alt+F (word motion),
  Alt+D (delete word forward), matched on `KeyboardEvent.code` with exact modifiers so
  the natively-bound macOS chords pass through untouched. Full contract (undo-preserving
  deletions, the empty-range guard, the Ctrl+W win/linux-browser caveat) in
  [ui/compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md) § Docked Compose Strip → Readline editing chords.
- **Truthful `enterKeyHint`**: `enterKeyHint="enter"` unconditionally — in chat Enter
  always inserts a newline, so the hint says so on every pointer type. (The strip's hint
  reads `"send"` for the same truthfulness rule under its own Enter policy — the hint
  follows the surface's behavior, not a shared constant.) The Send tip's keycap is the
  platform-formatted submit chord from the shared `composeSubmitKeycap()` (`⌘Enter` on
  mac, `Ctrl+Enter` elsewhere) — the one keycap both surfaces render identically, since
  the submit chord is the half that does NOT diverge; chat's Insert tip stays
  `Alt+Enter`.
- **In-flight lock**: while a send POST is pending, the submit path is locked
  (double-Enter / double-click cannot double-send). It guards insert-mode sends
  identically — insert reuses the one lock/clear/error state machine, not a parallel
  one. The textarea KEEPS its text until the POST succeeds — cleared on success, kept
  on failure (identically for submit and insert modes).
- **Inline error**: a failed send renders an inline `role="alert"`
  (`chat-send-error`) above the input carrying the server's structured error
  (e.g. the 409 message). Never silent.
- **Busy hint**: while `busy` (agent `active`), a non-blocking
  "will be queued" hint (`chat-send-busy-hint`) renders and the input STAYS ENABLED
  (Allow + probe policy — Claude Code queues typed input natively).
- **Desktop-only autofocus**: the textarea auto-focuses on mount (the chat lens
  just activated) UNLESS `(pointer: coarse)` matches — coarse pointers skip
  autofocus so the on-screen keyboard does not pop unbidden.
- **Per-(server,windowId) remount**: `AppShell` keys `<ChatView>` by the composite
  `` `${server}:${windowParam}` `` so switching chat-lens windows — including the
  same window id across DIFFERENT servers (`@1`↔`@1`) — remounts the form, dropping
  any draft/stale-error carryover and re-firing autofocus.

#### Scenario: Cmd/Ctrl+Enter submits and clears; a 409 keeps the text and shows the error
- **GIVEN** the send form with typed text
- **WHEN** the user presses Cmd/Ctrl+Enter and the POST resolves ok
- **THEN** exactly one POST fires with the typed body (no `submit` field), the
  textarea clears, and any prior error clears; **AND GIVEN** a second Cmd/Ctrl+Enter
  while in flight, **THEN** no second POST fires; **AND GIVEN** the POST rejects `409`,
  **THEN** the text is retained and the server's message renders in a `role="alert"`
  element.
- **AND GIVEN** the agent is `active`, **THEN** the queued-message hint is visible
  and the input stays enabled.
- **AND GIVEN** any pointer type, **WHEN** the user presses plain Enter, **THEN** no
  POST fires and the textarea gains a newline (only Cmd/Ctrl+Enter and the Send button
  submit).
- **AND GIVEN** the user clicks Insert (or presses Alt+Enter), **THEN** exactly one
  POST fires with `{text, submit:false}` and clears on success / keeps the text with
  the inline error on failure — identical to the submit path.


## Chat View

A **read-only HTML chat view over the SAME agent pane** — a second view over the tmux pane, never a substrate (the pane stays the agent's parent, Constitution VI; the view only renders the streamed transcript). It is the **`chat` lens** of the window-view model (§ Window Views (Lens Model)) — a `chat` TILE in the surface layout on the existing `/$server/$window` terminal route (Constitution IV, no new route; a legacy `?view=chat` deep link still works — the shim translates it to `single:chat`, § Surface Layout). **All view-state plumbing — the `?layout=` param + shim, availability gate, `rk-layout:` localStorage persistence, palette parity, and the switch-transition classification — is the UNIFIED machinery** described in § Window Views (Lens Model) and § Surface Layout; this section owns only what is chat-SPECIFIC: the `chatProvider` gate, the connection-dot semantics, the renderer/stream, and the WaitingBadge deep-link. (The heading is a static `Tab:` in every lens, § Heading is a static `Tab:`.) The renderer + data layer live in `architecture.md`/[chat](/run-kit/chat.md) § Chat View Frontend. The chat stream is a `kind:"chat"` subscription on the shared state socket (NOT an `EventSource`) — the owner hook is `use-chat-subscription.ts`, and the connection dot below derives from socket-connected AND chat-acked, not `EventSource` health. (`260714-uco1`, `260717-vhvz`)

**The `chatProvider` gate.** `WindowInfo` carries `chatProvider?: string` + `chatSessionRef?: string` (`types.ts`) — the window-level `@rk_chat` rollup the backend emits (typed, not newly parsed). **A non-empty `chatProvider` is the SOLE availability gate** for the chat lens (`hasChat(win)` in `window-view.ts`) — mirroring the backend's own `resolveWindowChat` gating — so it transitively gates every chat affordance: the `View: Chat` palette action, the `Tile: Show Chat` / `Tile: Hide Chat` palette entries (chat's entry points — the surface-toggles group renders no chat button in either mode and no `Tile: Switch to Chat` entry is ever emitted, `SURFACE_RAIL_HIDDEN`, § Surface Layout), the chat tile's `<ChatView>` renderer, and the deep-link append. (The heading is NOT among them — it is a static `Tab:` in every lens, § Heading is a static `Tab:`.) There is NO separate `chatAvailable` variable — `resolveLayout`/`availableViews` fold the gate in (an unavailable `chat` in a layout degrades tile-by-tile, § Surface Layout).

### View state = the unified lens machinery (NOT a chat-specific mechanism)

The chat lens runs entirely on the unified lens + layout machinery (§ Window Views (Lens Model), § Surface Layout), with no chat-specific view-state module:
- Resolution is `resolveLayout` (URL `?layout=` → `rk-layout:` localStorage → default hint → `single:tty`); `lib/router-url.ts`'s single `validateTerminalSearch` still accepts `?view=chat`, which the shim translates to `single:chat`. There is no `lib/chat-view-resolve.ts`.
- Persistence is the value-bearing `rk-layout:{server}:{windowId}` key (the legacy `runkit-window-view:` key is only a shim seeding source). There is no `runkit:chat-view:` key-presence pref hook.
- Lens switching is palette-only: the `View: Chat` / `View: Terminal` palette actions call `switchView("chat")`/`switchView("tty")` — i.e. applying `single:chat`/`single:tty` (desktop; on mobile the `View:` entries are superseded, so chat's entry points there are its `Tile: Show/Hide Chat` entries — chat is `SURFACE_RAIL_HIDDEN`, so the switch group renders no chat button and no `Tile: Switch to Chat` exists). There is no switcher component and no dedicated chat chord.
- `chatViewActive = layout.order.includes("chat")` is the render + stream gate (`resolveLayout` already gated on `chatProvider`) — true whenever a chat TILE is open, slot A or not.

### Center heading `Tab: <name>` (static in the chat lens too)

The `chat` lens does NOT change the heading prefix — the top-bar heading is a static `Tab: <name>` in every lens (§ Heading is a static `Tab:`; § Window Heading for the boot-sweep/rename mechanics). The `<ChatView>` renderer preserves the inline-rename affordance (the heading IS the rename surface, especially on mobile) — the same parametrized `WindowHeading`, no fork. (`260714-uco1`, `260820-lfla`)

### Renderer swap + chat stream (`app.tsx`)

In the `windowParam` render arm, `<ChatView>` mounts as the chat TILE inside `<SurfaceLayout>` (fed the AppShell-owned subscription bundle — the tile mount reads like the legacy lens branch, § Surface Layout → tile renderer). `AppShell` owns the single owner-hook call — **`useChatSubscription(server, windowId)`**, opened only when `chatViewActive` (else passed empty strings so the hook idles) — and passes `{events, pending, connected, error}` into the tile. ONE chat subscription on the shared state socket feeds both the renderer and the connection dot (below). The chat pane joins the switch-transition **ungated capture** through the unified `ungatedIds` classification (any non-`tty`-led resolved layout; § Window Views → Window-switch transition classification) — `<ChatView>` has NO xterm first-write seam, so a first-write gate would never release. (`260717-vhvz`)

### Connection dot = chat stream health in chat mode (R9)

"Dot = per-page live-data health" (§ Chrome (Top Bar) → connection dot). In chat view, the `isConnected` `AppShell` passes to `<Sidebar>` reflects the **chat subscription's** health instead of the per-server sessions slice: `dotConnected = chatViewActive ? chatStream.connected : isConnected`. `chatStream.connected` = (state socket connected) AND (this window's `kind:"chat"` subscription acked), with the established 3s disconnect debounce (from `use-chat-subscription`). (`260717-vhvz`) In every other lens the dot keeps its per-server sessions-slice value.

### WaitingBadge click + `Agent: Next waiting` deep-link into `?view=chat`

`WaitingBadge` (`components/waiting-badge.tsx`) takes an **optional** `onClick` prop: when passed, the badge renders as a `<button>` (rk-glint hover, `stopPropagation` so it doesn't bubble to the parent row) that navigates to the next waiting window in its scope; when absent, it renders a **display-only** `<span>` (the board-header / Host-page-tile / server-panel mount sites pass no onClick). It is currently wired ONLY at the **sidebar session row** (`session-row.tsx` → `sidebar/index.tsx` → `AppShell`'s `handleWaitingBadgeClick`) — the one surface with a navigable per-session scope.

`handleWaitingBadgeClick(srv, sess)` (`app.tsx`) builds the clicked session's ordered waiting windows and calls **`nextWaitingTarget(ordered, server, windowParam)`** (`lib/palette/agent-nav.ts` — REUSED, not re-implemented; § Design Decisions → The waiting-badge click advances, never restarts). It appends `?view=chat` via the pure `chatSearchForTarget(hasChat)` helper (`lib/palette/agent-nav.ts`, unit-tested) — `{ view: "chat" }` iff the target window has a `chatProvider`, else empty search (the target resolves its own pref; the shim translates the param to `single:chat`, § Surface Layout). This is the ONE intentional `?view=` carry across a window switch (§ Window Views → Internal navigation targets the bare route). The existing `Agent: Next waiting` palette action gets the **same** `chatSearchForTarget` append rule for any target it navigates to.


## Design Decisions

### `react-markdown` + `remark-gfm` — the frontend's markdown renderer
**Decision**: Render message-bubble markdown via `react-markdown` + `remark-gfm`,
scoped to a `.chat-markdown` wrapper whose typography rules live in `globals.css`;
code blocks render as plain monospace `<pre>` with no syntax-highlighting
dependency in v1.
**Why**: React-idiomatic, no `dangerouslySetInnerHTML` (no XSS surface),
swappable behind the one `MarkdownText` component. Under Tailwind v4 preflight
the raw markdown elements render flat (zero margins, no list bullets, uniform
heading size), so the `.chat-markdown` globals.css rules are load-bearing — they
restore document flow (paragraph/list/heading/blockquote/table spacing, disc/
decimal list markers) in the house monospace aesthetic (headings sized by weight
+ color, not scale jumps), all riding the theme custom properties so both light
and dark are covered.
**Rejected**: A raw-HTML markdown lib (XSS); a syntax-highlighter dependency
(v1 minimal-deps ethos — the terminal aesthetic is plain monospace).
*Introduced by*: `260714-r7rq-chat-read-frontend`

### `ChatView` is a pure renderer; `AppShell` owns the single owner-hook
**Decision**: `AppShell` calls the owner hook (`useChatSubscription`) once (only
when the chat view is actually active for a chat-capable window) and passes
`{events, pending, connected, error}` into `ChatView` as props; `ChatView` opens
no stream itself.
**Why**: ONE owner-hook feeds BOTH the renderer AND the connection-dot health
(ui/lenses-and-layout.md § Chat View → the dot reports chat health in chat mode) — a
second hook would desync the two health readings.
**Rejected**: `ChatView` owning its own hook (two subscriptions, desynced dot).
*Introduced by*: `260714-r7rq-chat-read-frontend`

### One guarded `compose` shared by mount + reconnect
**Decision**: `useChatSubscription` hoists ONE guarded `compose` (behind a
`composeRef` carrying the current generation, with `gen`/`cancelled` guards) reused
by both the mount effect and the socket-reconnect effect.
**Why**: the first cut duplicated `compose()` inline in the reconnect effect WITHOUT
the mount effect's guards — a reconnect GET still in flight when the user switched
windows / left the lens REPLACEd the new window's state with the OLD conversation
and re-subscribed the OLD `(server,windowId)` after cleanup had already
unsubscribed, leaking an ownerless server-side producer until socket teardown
(violating R12: no subscription outlives the view, Constitution II). The shared
guarded compose discards stale completions and fires no subscribe for a torn-down
identity.
**Rejected**: an inline unguarded reconnect compose (the leak above).
*Introduced by*: `260717-vhvz-chat-on-state-socket`

### One shared classifier owns the Enter policy for both surfaces, chat as the diverging half
**Decision**: Both text-input surfaces (chat send form, docked compose strip) route
Enter through ONE pure `classifyComposeEnter(key, surface)` (`lib/compose-keys.ts`),
which drives both the keydown policy and the `enterKeyHint`. `surface` is REQUIRED (no
default) and is the ONE axis on which the surfaces differ: chat passes `"chat"` and gets
Enter = newline with `enterKeyHint="enter"`; the strip passes `"strip"` and gets Enter =
insert-line with `enterKeyHint="send"`. Every other rule is shared and identical —
Cmd/Ctrl+Enter = the only submit, Alt+Enter = insert, Shift+Enter and IME-composing
Enter = default — as are the readline editing layer (`handleReadlineKey`) and the Send
keycap (`composeSubmitKeycap()`). The classifier reads no pointer input. Chat's empty
send stays a no-op in every mode: it gains no counterpart to the strip's empty-submit
bare `"\r"`.
**Why**: the surfaces genuinely differ in what the user can SEE, so one plain-Enter
policy could only be right for one of them. The strip overlays the visible terminal, so
a transmitted line lands in the pane's own composer in full view; the chat lens cannot
render the pane's input box at all, so the same Enter would make typed text vanish into
an invisible target — and the premature-send hazard (a reflexive Enter firing a
half-written prompt at a live agent) applies here undiluted. Declaring that divergence
INSIDE the classifier, as a required parameter, preserves the single shared decision path
(pure + unit-testable without a mount, the `palette/move.ts` extraction pattern): a call
site may choose which policy it gets but cannot invent a third, and a new surface must
state its choice rather than silently inherit one — the two handlers had already drifted
once, before the classifier existed. Pointer-independence still holds because the
divergence axis is surface visibility, not input hardware. Chat's empty-Enter abstention
follows the same visibility rule, and this path is probe-gated server-side besides. The
strip's half of the rationale is [ui/compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md) § Design
Decisions → Enter transmits a line in the strip, composes in chat.
**Rejected**: per-surface inline branching at the call sites (the same drift the
classifier exists to prevent, one layer down); a default value for `surface` (silent
inheritance is that drift again); one shared plain-Enter policy across both surfaces
(sacrifices either the strip's terminal-faithfulness or chat's visibility safety); keying
the policy on pointer type or viewport width (the difference is what the surface shows,
not what hardware types into it, and width would cost a narrowed desktop window its
policy). The focused-textarea chords are NOT registered in the command palette (the
palette steals focus from the textarea it would act on, and these are editing chords like
the already-unregistered Shift+Enter); each surface's Insert affordance documents its
chord in its tip and the Send tip carries the platform-formatted submit keycap,
satisfying Constitution V.
*Introduced by*: 260802-lj98-compose-enter-insert-line

