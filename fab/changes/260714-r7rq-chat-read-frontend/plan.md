# Plan: Chat Read Frontend (read-only HTML chat view over the agent pane)

**Change**: 260714-r7rq-chat-read-frontend
**Intake**: `intake.md`

## Requirements

Implements Change 3 of `fab/plans/sahil/agent-chat-view.md` — the user-facing,
read-only chat view over the existing agent pane. The landed Change-2 backend
(`docs/memory/run-kit/chat.md`, `9bd110a`) is consumed as-is. All file:line seams
below are from the intake (verified against this tree at spawn).

### Frontend: Chat view state (`?view=chat`)

#### R1: `?view=chat` search param on the terminal route
The terminal route (`src/router.tsx`, `terminalRoute`) SHALL gain a
`validateSearch` normalizing the `view` search param to `"chat" | undefined`
(any other value → `undefined`). The active view SHALL resolve with precedence
**explicit URL `view` param > per-window localStorage pref > terminal default**.
A pure resolver (`resolveChatView`) SHALL express this composition and be
unit-tested.

- **GIVEN** a URL `/{server}/{N}?view=chat` on a window whose `chatProvider` is non-empty
- **WHEN** the terminal route renders
- **THEN** the chat view is active.
- **AND GIVEN** no `view` param and a stored chat pref for the window, **THEN** chat is active.
- **AND GIVEN** no `view` param and no stored pref, **THEN** the terminal is active.

#### R2: Chat gating on `chatProvider`
`WindowInfo` (`src/types.ts`) SHALL type the fields the backend already emits:
`chatProvider?: string` and `chatSessionRef?: string`. A **non-empty
`chatProvider`** SHALL be the sole gate for every chat affordance (toggle chip,
palette actions, keyboard shortcut, `Chat:` heading, chat renderer, deep-link
append). `?view=chat` on a window with no `chatProvider` SHALL render the
terminal (param inert, pref untouched).

- **GIVEN** a window with empty/absent `chatProvider`
- **WHEN** `?view=chat` is present in the URL
- **THEN** the terminal renders and no chat affordance appears.

#### R3: View toggle preserves the window, updates URL + pref
Toggling the view SHALL update both the URL (`navigate({ search })`) and the
per-window stored pref, and SHALL keep the current window (same `windowId`).
Window-to-window navigation SHALL resolve the target window's own pref (the
inline `navigate({ to: "/$server/$window" })` call sites in `app.tsx` must not
unintentionally drop or force the `view` param).

- **GIVEN** the chat view active on window `@N`
- **WHEN** the user toggles to terminal
- **THEN** the URL loses `?view=chat`, the stored pref for `@N` is cleared, and the window stays `@N`.

### Frontend: Top-bar chat affordances

#### R4: `[tty|chat]` segmented toggle in the L1 tier
A compact two-state segmented chip (`[tty|chat]`, active side inverse-video)
SHALL render inside the top-bar L1 terminal-only block
(`components/top-bar.tsx`, the `{currentWindow && …}` wrapper), additionally
gated on `currentWindow.chatProvider`. Unlike its `hidden sm:flex` L1 siblings,
the chip SHALL be **visible at all breakpoints**. It SHALL carry the CRT-glint
hover treatment and `coarse:` touch-target sizing (24px fine / 30px coarse) per
the existing top-bar button conventions. `view` + `chatAvailable` + `onSetView`
SHALL travel the `TopBarSlot` registration channel (`app.tsx` `topBarSlot`
+ `contexts/top-bar-slot-context.tsx` `TopBarSlot` type + `RootTopBar`
plumbing) and `TopBarProps`.

- **GIVEN** a terminal-route window with a non-empty `chatProvider`
- **WHEN** the top bar renders at 375px OR desktop width
- **THEN** the `[tty|chat]` chip is visible, the active side is inverse-video, and the top bar stays a single row (no wrap, no horizontal scroll).
- **AND GIVEN** a window with no `chatProvider`, **THEN** the chip does not render.

#### R5: Center heading `Chat: <window>` in chat view
`components/top-bar.tsx` SHALL define `CHAT_PREFIX = "Chat:"` beside
`TERMINAL_PREFIX`. `WindowHeading`'s hardcoded `useBootSweep(TERMINAL_PREFIX, …)`
prefix SHALL be **parametrized** (not forked) so chat view renders `Chat:
<window>` with the boot-sweep hover treatment and inline-rename affordance
carried over unchanged; terminal view still renders `Terminal: <window>`.

- **GIVEN** the chat view active on the terminal route
- **WHEN** the center heading renders
- **THEN** it reads `Chat: <window>`, the name remains inline-editable (rename), and the boot-sweep hover replays on name change.

### Frontend: Chat data + rendering

#### R6: Dedicated per-view chat EventSource hook
A component-scoped hook (`hooks/use-chat-stream.ts`) SHALL own **one dedicated
`EventSource`** per open chat view (NOT the per-server pool) on
`/api/windows/{windowId}/chat/stream?server={server}` (built with the
`withServer` convention). It SHALL consume the landed four-event contract:
`chat-backfill` (full `Conversation` — **replace** the event list every time,
including on reset/rotation, never append), `chat` (array of newly-appended
`Event`s — dedup by `id`), `chat-state` (`{pending}` — always applied incl.
`null`), `chat-error` (fatal → inline error state). It SHALL track stream
health with the established 3s disconnect debounce
(`session-context.tsx:702-706` pattern) and rely on `EventSource`
auto-reconnect (reconnect ⇒ fresh backfill, no cursor). The hook SHALL close
its `EventSource` on unmount and on `windowId`/`server` change. Pure helpers
(`applyChatBackfill`, `appendChatEvents` with `id` dedup, `groupEventsByTurn`,
`pairToolEvents` by `toolUseId`, `derivePendingBubble`) SHALL be extracted and
unit-tested.

- **GIVEN** an open chat view
- **WHEN** a `chat-backfill` then a `chat` append then a `chat-state` arrive
- **THEN** the view replaces on backfill, appends deduped-by-`id` on `chat`, and reflects/clears pending on `chat-state`.
- **AND GIVEN** the view unmounts, **THEN** the `EventSource` is closed (no leaked connection).

#### R7: Chat renderer (`components/chat-view.tsx`)
A new read-only `ChatView` component SHALL render the conversation in the house
aesthetic (monospace, three-mode theme tokens, hover-animation vocabulary, all
animation behind `prefers-reduced-motion`):
- **Message bubbles** — user vs assistant visually distinct; markdown + fenced
  code blocks via **react-markdown + remark-gfm**; code blocks as plain
  monospace `<pre>` (no syntax highlighting in v1). Grouped by `turn`.
- **Tool-call cards** — one collapsible card per `tool_use`/`tool_result` pair
  (joined by `toolUseId`), **collapsed by default**; header shows `toolName`,
  body shows pretty-printed `toolInput` JSON + `toolOutput` text, `isError`
  styled as an error.
- **Pending question** — when `pending` is non-null, an attention-styled bubble
  at the conversation **tail** carrying `pending.text` (or `toolName` when text
  is empty); cleared on `chat-state` `pending: null`.
- **Streaming** — auto-follow the tail (stick-to-bottom) unless the user has
  scrolled up.
- **No input box** — a visibly **disabled** footer affordance pointing at the
  terminal view ("send from the terminal view — coming in chat-send").
- **`chat-error`** — an inline error state.

- **GIVEN** a conversation with messages, a tool_use/tool_result pair, and a tail pending
- **WHEN** `ChatView` renders
- **THEN** bubbles render markdown, the tool card is collapsed by default and expands on click, and the pending bubble shows at the tail and clears when pending becomes null.

#### R8: Renderer swapped in at the AppShell render branch
`app.tsx` (the `windowParam` arm, currently iframe-vs-terminal at
`~1853-1898`) SHALL render `<ChatView>` when `view === "chat" && chatProvider`,
else the existing `IframeWindow`/`TerminalClient` logic. The window-switch
slide transition's iframe gating (`app.tsx` `switchTransitionRef.iframeIds`,
`~820-834`) SHALL treat chat panes analogously to iframes (ungated capture — no
xterm first-write seam to wait on).

- **GIVEN** the chat view active for a `chatProvider` window
- **WHEN** AppShell renders the content region
- **THEN** `ChatView` renders instead of the terminal, and a window switch into/out of a chat pane uses the ungated slide capture.

#### R9: Connection dot = chat stream health in chat mode
In chat view, the `isConnected` value AppShell registers into `TopBarSlot`
(`app.tsx:337`) SHALL reflect the **chat stream's** health (from R6's hook)
instead of the per-server sessions-SSE slice. In terminal view the value is
unchanged.

- **GIVEN** the chat view active
- **WHEN** the chat stream is connected vs disconnected
- **THEN** the top-bar connection dot reflects the chat stream health, not the sessions slice.

### Frontend: Persistence, palette, shortcut

#### R10: Per-window last-view persistence
A hook (`hooks/use-chat-view-pref.ts`) SHALL persist the last view per window in
`localStorage`, key-presence pattern cloned from `useBoardAutofit` (sentinel
present ⇒ chat default, `removeItem` on off). Key:
`runkit:chat-view:{server}:{windowId}`. Written on every user toggle; read only
when the URL carries no `view` param (feeds R1's precedence). Stale-key
mis-default on tmux window-id recycling is accepted (same property as
board-autofit).

- **GIVEN** the user toggles a window to chat and later re-opens `/{server}/{N}` with no `view` param
- **THEN** chat is the default view; toggling back to terminal removes the key.

#### R11: Palette parity + keyboard shortcut (Constitution V)
`View: Chat` / `View: Terminal` actions SHALL join `viewActions`
(`app.tsx:1432-1462`), gated on `currentWindow.chatProvider`, showing only the
inactive side's action (match the Fixed/Full Width toggle idiom). A pure builder
(`lib/palette-view.ts` `buildViewActions`) SHALL express the gate + label and be
unit-tested. The keyboard shortcut **Ctrl+`** (plain Ctrl on both platforms —
NOT Cmd) SHALL toggle tty↔chat on the terminal route and MUST fire **while xterm
owns focus** — document-level capture modeled on `useSidebarKeyboardToggle`
(`shell.tsx:15-42`), minus its xterm-focus suppression.

- **GIVEN** a `chatProvider` window in terminal view
- **WHEN** the user presses Ctrl+` (even with xterm focused) OR runs the `View: Chat` palette action
- **THEN** the view flips to chat; the inverse action shows in the palette and flips it back.
- **AND GIVEN** a window with no `chatProvider`, **THEN** neither `View: Chat`/`View: Terminal` action appears and Ctrl+` is a no-op.

### Frontend: Waiting deep-link integration

#### R12: WaitingBadge + `Agent: Next waiting` append `?view=chat`
`components/waiting-badge.tsx` SHALL gain an **optional** click affordance
(rendered only where a navigable context passes an `onClick`) navigating to the
next waiting window within its scope, reusing `nextWaitingTarget`
(`lib/palette-agent-nav.ts`), appending `?view=chat` when that target window has
a `chatProvider`. The existing `Agent: Next waiting` palette action
(`app.tsx` `agentActions`) SHALL get the same `?view=chat` append rule. A pure
helper SHALL express "append `?view=chat` iff target has chat" and be
unit-tested. Display-only mount sites (those passing no `onClick`) SHALL keep
today's non-interactive behavior.

- **GIVEN** a waiting window that has a `chatProvider`
- **WHEN** `Agent: Next waiting` (or a wired WaitingBadge click) navigates to it
- **THEN** the URL carries `?view=chat`; a waiting window without a chat navigates to the plain window URL.

### Backend: Push deep-link

#### R13: Push payload carries a deep-link URL
`internal/push/send.go` SHALL thread a URL field through `Notify` and the
`payload` JSON (JSON key `url`, omitempty). `api/waiting_push.go` (the
waiting-push producer) SHALL construct `/{server}/{N}?view=chat` for the waiting
window **only when the window has a `chatProvider`**, else the plain window URL
`/{server}/{N}`. Existing `Notify` callers (`api/push.go`, `cmd/rk/notify.go`)
SHALL compile against the new signature (empty URL when none). `public/sw.js`
SHALL store the URL via `showNotification(…, { data })` and its
`notificationclick` handler SHALL focus an existing tab and navigate it (or open
the URL) instead of the hardcoded `openWindow("/")`; absent URL falls back to
`/`. Go tests (`api/waiting_push_test.go`) SHALL cover the chat-vs-plain URL
construction.

- **GIVEN** a sustained-waiting window with a `chatProvider`
- **WHEN** the waiting-push fires
- **THEN** the push payload carries `url: /{server}/{N}?view=chat`; a waiting window without a chat carries `/{server}/{N}`.
- **AND GIVEN** a push arrives at the service worker with a `url`, **THEN** `notificationclick` navigates a focused/opened tab to that URL.

### Deps + plan tracking

#### R14: Markdown deps + plan tracking table
`app/frontend/package.json` SHALL add `react-markdown` and `remark-gfm`
(the frontend's first markdown renderer). Change 3's row in
`fab/plans/sahil/agent-chat-view.md` SHALL be filled with this change folder
(`260714-r7rq-chat-read-frontend`) in the same PR (Status stays until the PR
merges — pickup protocol step 5).

- **GIVEN** the change is applied
- **THEN** `react-markdown` + `remark-gfm` are dependencies, and the plan's Change-3 row names this change folder.

### Non-Goals
- Board-pane chat toggle, mobile auto-default to chat, any send path, any
  conversation storage in rk (plan-wide out-of-scope).
- No new routes (Constitution IV) — chat is a search param on the existing
  terminal route.
- No syntax-highlighting dependency in v1 (plain monospace `<pre>`).
- No client-side conversation caching beyond component state that dies with the
  view (Constitution II analog).

### Design Decisions
1. **View state in the URL search param, not a route**: `?view=chat` on
   `/$server/$window` — *Why*: Constitution IV (no new routes) + makes the
   push→pending deep link addressable — *Rejected*: a new `/chat` route.
2. **Parametrize `WindowHeading`'s prefix rather than fork it**: *Why*: the
   boot-sweep + inline-rename affordance carry over free — *Rejected*: a
   separate `ChatHeading` component (duplicated animation + rename wiring).
3. **Dedicated per-view `EventSource`, not the sessions pool**: *Why*: matches
   the backend's dedicated per-view stream design (chat.md § "Dedicated
   per-view SSE endpoint"), keeps within the 6-per-origin budget (one bounded
   connection per open view) — *Rejected*: a scope on the shared hub.
4. **react-markdown + remark-gfm**: *Why*: React-idiomatic, no
   `dangerouslySetInnerHTML`, swappable behind one renderer — *Rejected*: a
   raw-HTML markdown lib (XSS surface), a syntax-highlighter (v1 minimal-deps).
5. **Ctrl+` for toggle** (both platforms, plain Ctrl): *Why*: VS Code
   toggle-terminal association; Cmd+` is macOS window cycling (unbindable) —
   document-level capture minus xterm-focus suppression so it fires while xterm
   owns focus.
6. **Chat panes treated like iframes in the switch-transition gate**: *Why*: no
   xterm first-write seam exists for a chat pane, so the ungated capture is the
   correct analog (a first-write gate would never release).

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `react-markdown` + `remark-gfm` to `app/frontend/package.json` dependencies and run `cd app/frontend && pnpm install` <!-- R14 -->
- [x] T002 [P] Add `chatProvider?: string` + `chatSessionRef?: string` to `WindowInfo` in `app/frontend/src/types.ts` (documented as the window-level `@rk_chat` rollup) <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Add `validateSearch` to `terminalRoute` in `app/frontend/src/router.tsx` normalizing `view` → `"chat" | undefined`; export a pure `resolveChatView({ urlView, storedPref })` precedence resolver (URL > pref > terminal) <!-- R1 -->
- [x] T004 [P] Create `app/frontend/src/hooks/use-chat-view-pref.ts` (clone of `use-board-autofit.ts` key-presence pattern; key `runkit:chat-view:{server}:{windowId}`, sentinel present = chat) exposing `{ chatPref, setChatPref }` <!-- R10 -->
- [x] T005 [P] Create `app/frontend/src/lib/chat-stream.ts` pure helpers: `applyChatBackfill`, `appendChatEvents` (dedup by `id`), `groupEventsByTurn`, `pairToolEvents` (by `toolUseId`), `derivePendingBubble`; plus rk-schema TS types (`ChatEvent`, `ChatPending`, `Conversation`) mirroring `docs/memory/run-kit/chat.md` <!-- R6 -->
- [x] T006 Create `app/frontend/src/hooks/use-chat-stream.ts` — dedicated `EventSource` on `/api/windows/{windowId}/chat/stream` (withServer-style query), consuming `chat-backfill`/`chat`/`chat-state`/`chat-error`, 3s disconnect debounce, close on unmount + windowId/server change; returns `{ events, pending, connected, error }` <!-- R6 -->
- [x] T007 [P] Create `app/frontend/src/lib/palette-view.ts` pure `buildViewActions({ chatAvailable, view, onSetView })` returning the inactive-side `View: Chat`/`View: Terminal` action (empty when no chat) <!-- R11 -->
- [x] T008 Create `app/frontend/src/components/chat-view.tsx` (+ subcomponents: message bubble w/ react-markdown+remark-gfm, collapsible tool-call card, pending bubble, disabled footer, inline error, stick-to-bottom scroll) consuming `use-chat-stream` <!-- R7 --> <!-- rework: should-fix — `.chat-markdown` class has NO CSS rules anywhere; under Tailwind v4 preflight, paragraphs/lists/headings/blockquotes render flat (zero margins, no bullets, uniform heading size). Add .chat-markdown typography rules in globals.css matching the house monospace aesthetic -->
- [x] T009 Add `CHAT_PREFIX = "Chat:"` in `app/frontend/src/components/top-bar.tsx` and parametrize `WindowHeading`'s `useBootSweep(TERMINAL_PREFIX, …)` prefix via a new `prefix` prop (default `TERMINAL_PREFIX`); pass `CHAT_PREFIX` in chat view <!-- R5 -->
- [x] T010 Add the `[tty|chat]` segmented chip component in `top-bar.tsx` inside the L1 `{currentWindow && …}` block, gated on `currentWindow.chatProvider`, visible at all breakpoints (no `hidden sm:flex`), CRT-glint hover + coarse sizing; extend `TopBarProps` with `view`/`chatAvailable`/`onSetView` <!-- R4 -->
- [x] T011 Extend `TopBarSlot` in `app/frontend/src/contexts/top-bar-slot-context.tsx` with `view?: "chat" | undefined`, `chatAvailable?: boolean`, `onSetView?: (view) => void`; thread them through `RootTopBar` in `app.tsx` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T012 In `app/frontend/src/app.tsx`: derive the active `view` (R1 precedence via `resolveChatView` using URL search + `use-chat-view-pref`), gate on `currentWindow?.chatProvider`; add `onSetView` that navigates `{ search }` + writes the pref + preserves the window <!-- R1 R3 R10 --> <!-- rework: should-fix — use-chat-view-pref reloads via post-paint effect, so the first frame after a window switch resolves the PREVIOUS window's pref (wrong renderer mounts for one frame: WS churn / EventSource open-close). Derive the pref synchronously on (server,windowId) identity change (derive-over-store idiom) instead of the effect reload; fix lands in use-chat-view-pref.ts and/or the app.tsx derivation -->
- [x] T013 In `app.tsx` render branch (`windowParam` arm, ~1853-1898): render `<ChatView>` when `view === "chat" && currentWindow.chatProvider`, else existing iframe/terminal logic <!-- R8 -->
- [x] T014 In `app.tsx` `switchTransitionRef.iframeIds` (~820-834): include chat-active panes in the ungated set (add a `chatIds`/extend predicate so a chat target uses the iframe-style ungated capture) <!-- R8 -->
- [x] T015 In `app.tsx` `topBarSlot` memo + `useRegisterTopBarSlot`: publish `view`, `chatAvailable` (= non-empty `chatProvider`), `onSetView`; set `isConnected` to the chat stream health when in chat view, else the sessions slice <!-- R4 R9 -->
- [x] T016 In `app.tsx` `viewActions`: splice in `buildViewActions(...)` (R11) gated on `chatProvider` <!-- R11 -->
- [x] T017 Add the Ctrl+` document-level toggle in `app.tsx` (or a `use-chat-view-shortcut.ts` hook) modeled on `useSidebarKeyboardToggle` minus xterm-focus suppression; gated on terminal route + `chatProvider`; calls `onSetView` <!-- R11 --> <!-- rework: should-fix — zero tests cover the shortcut (code-quality.md: new behavior MUST include tests); add renderHook units: ctrl+backtick toggles, xterm-target event still fires, INPUT/textarea target bails, no-chat gate no-ops -->
- [x] T018 Audit the inline `navigate({ to: "/$server/$window" })` call sites in `app.tsx` (navigateToWindow ~679-683, and 573/650/1213/1236/move-window/cross-session) — ensure they neither drop nor force `?view=chat`; window-to-window nav resolves the target's own pref <!-- R3 -->
- [x] T019 Add optional click affordance to `components/waiting-badge.tsx` (new optional `onClick?` prop; interactive only when passed) and apply the `?view=chat`-when-chat append rule to `Agent: Next waiting` in `app.tsx` `agentActions`; extract a pure `waitingNavTarget`/append helper (in `lib/palette-agent-nav.ts` or a sibling) and reuse from both <!-- R12 --> <!-- rework: MUST-FIX R12 mismatch — handleWaitingBadgeClick (app.tsx ~1846) picks the session's FIRST waiting window via windows.find(isWaiting) instead of reusing nextWaitingTarget; clicking a session badge while already on its first waiting window is a no-op instead of advancing to the next. Build the session-scoped ordered waiting targets and call nextWaitingTarget(ordered, srv, windowParam); keep the chatSearchForTarget append rule; re-check A-024 -->
- [x] T020 Backend: add a `URL` field to `internal/push/send.go` `payload` (json `url,omitempty`) and thread it through `Notify(ctx, title, body, url)`; update callers `api/push.go` + `cmd/rk/notify.go` (pass "" for now) <!-- R13 -->
- [x] T021 Backend: in `api/waiting_push.go`, extend `pushWindow`/`waitingPush` with the window's chat availability + constructed URL (`/{server}/{N}?view=chat` when chat, else `/{server}/{N}`) and pass it to `notify`; `pushWindowsForServer` reads `w.ChatProvider` from the rolled-up window <!-- R13 -->
- [x] T022 Update `public/sw.js`: parse `data.url`, store via `showNotification(title, { body, icon, data: { url } })`, and rewrite `notificationclick` to focus+navigate an existing tab (or `openWindow(url)`), falling back to `/` when no url <!-- R13 --> <!-- rework: should-fix ×2 — (a) same-origin guard startsWith("/") admits protocol-relative "//evil.example" (resolves to external origin); also reject a "//" prefix or compare the resolved URL's origin. (b) client.navigate() rejects for uncontrolled clients (matchAll uses includeUncontrolled:true) and the rejection propagates into waitUntil — chain .catch(() => client.focus()) fallback -->
- [x] T023 Fill Change 3's row in `fab/plans/sahil/agent-chat-view.md` tracking table with the change folder `260714-r7rq-chat-read-frontend` <!-- R14 -->

### Phase 4: Tests & Polish

- [x] T024 [P] Vitest units: `resolveChatView` precedence (router), `use-chat-view-pref` key-presence, `chat-stream` helpers (dedup, turn grouping, tool pairing, pending derivation), `buildViewActions` gating, the `?view=chat` append helper <!-- R1 R6 R10 R11 R12 -->
- [x] T025 Go units in `api/waiting_push_test.go`: chat window → `?view=chat` URL, non-chat window → plain URL, threaded through the push payload <!-- R13 -->
- [x] T026 Playwright e2e `app/frontend/tests/e2e/chat-view.spec.ts` + sibling `chat-view.spec.md` (constitutional): toggle appears only on `chatProvider` windows; flipping views preserves the window; deep-link `?view=chat` cold-loads into chat; heading reads `Chat: <window>`; pending bubble renders and clears; 375px AND desktop viewports; reduced-motion honored. Mock chat endpoints via `page.route` (globs need trailing `*` — withServer appends `?server=`); SSE stream mock fulfills a `text/event-stream` body. Run via `just test-e2e "chat-view"` <!-- R2 R4 R5 R7 R8 -->
- [x] T027 Verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-backend`, then `just test-e2e "chat-view"` <!-- R1 R6 R7 R13 -->

## Execution Order

- T001, T002 (setup) precede everything.
- T005 (types + helpers) blocks T006 (hook) and T008 (view).
- T003, T004 block T012 (view derivation).
- T009, T010, T011 block T015 (slot publish).
- T012 blocks T013/T014/T015/T016/T017/T018.
- T006 blocks T008, T009 (heading prefix) and T013 (render branch).
- T020 blocks T021 (signature) and T021/T022 pair for the push flow.
- T024/T025 alongside their impl tasks; T026 after T008–T017; T027 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `terminalRoute` has `validateSearch` normalizing `view` to `"chat" | undefined`; `resolveChatView` implements URL > pref > terminal precedence (unit-tested).
- [x] A-002 R2: `WindowInfo` types `chatProvider?`/`chatSessionRef?`; non-empty `chatProvider` gates every chat affordance; `?view=chat` on a chat-less window renders the terminal.
- [x] A-003 R3: Toggling the view updates URL + stored pref and preserves the window id.
- [x] A-004 R4: The `[tty|chat]` L1 chip renders only for `chatProvider` windows, active side inverse-video, visible at 375px and desktop.
- [x] A-005 R5: `CHAT_PREFIX` exists; `WindowHeading` renders `Chat: <window>` in chat view and `Terminal: <window>` otherwise, with the same boot-sweep + inline-rename.
- [x] A-006 R6: `use-chat-stream` owns one dedicated `EventSource`, replaces on backfill, dedups appends by `id`, applies `chat-state` incl. null, tracks 3s-debounced health, and closes on unmount/change.
- [x] A-007 R7: `ChatView` renders markdown bubbles, collapsed-by-default tool cards paired by `toolUseId`, a tail pending bubble, a disabled footer, an inline error state, and stick-to-bottom scroll.
- [x] A-008 R8: AppShell renders `<ChatView>` for `view === "chat" && chatProvider`, else iframe/terminal; chat panes use the ungated switch-transition capture.
- [x] A-009 R9: In chat view the top-bar connection dot reflects chat-stream health; terminal view unchanged.
- [x] A-010 R10: Per-window view pref persists via the board-autofit key-presence pattern under `runkit:chat-view:{server}:{windowId}`.
- [x] A-011 R11: `View: Chat`/`View: Terminal` palette actions (inactive side only) are gated on `chatProvider`; Ctrl+` toggles even while xterm is focused; no-op on chat-less windows.
- [x] A-012 R12: `WaitingBadge` gains an optional click affordance; `Agent: Next waiting` and any wired badge append `?view=chat` iff the target window has a chat.
- [x] A-013 R13: The push payload carries a `url` (`?view=chat` for chat windows, plain otherwise); `sw.js` navigates to it on `notificationclick`; Go tests cover both cases.
- [x] A-014 R14: `react-markdown` + `remark-gfm` are dependencies; the plan's Change-3 row names this change folder.

### Behavioral Correctness

- [x] A-015 R3: Window-to-window navigation resolves the target window's own view pref and does not unintentionally drop/force `?view=chat` at any `navigate({ to: "/$server/$window" })` call site.
- [x] A-016 R6: A `chat-backfill` after a reconnect/rotation replaces (not appends) the event list.

### Scenario Coverage

- [x] A-017 R7: An e2e proves deep-link `?view=chat` cold-loads into chat, the heading reads `Chat: <window>`, and a pending bubble renders then clears.
- [x] A-018 R4: An e2e proves the toggle appears only on `chatProvider` windows, flipping views preserves the window, and the 375px top bar stays a single row (no wrap/scroll).
- [x] A-019 R7: An e2e verifies reduced-motion is honored in the chat view (animations zeroed).

### Edge Cases & Error Handling

- [x] A-020 R2: `?view=chat` on a window with empty `chatProvider` degrades to the terminal with the pref untouched.
- [x] A-021 R6: A `chat-error` event renders an inline error state; the `EventSource` is closed on unmount (no leaked connection).
- [x] A-022 R13: A waiting push for a window WITHOUT a chat carries the plain `/{server}/{N}` URL; `notificationclick` with no `url` falls back to `/`.

### Code Quality

- [x] A-023 Pattern consistency: New code follows surrounding naming/structure — `withServer` URL convention, key-presence localStorage idiom, pure-helper-then-hook extraction, `TopBarSlot` plumbing.
- [x] A-024 No unnecessary duplication: `nextWaitingTarget`, `useBoardAutofit` pattern, `useSidebarKeyboardToggle` pattern, and `WindowHeading` are reused/parametrized — not re-implemented or forked. <!-- not met (review 260714): handleWaitingBadgeClick (app.tsx) picks the session's FIRST waiting window via `windows.find(isWaiting)` instead of reusing `nextWaitingTarget` as R12 prescribes — clicking the badge of the session you're on, while on its first waiting window, is a no-op instead of advancing. The other three reuses (useBoardAutofit clone, useSidebarKeyboardToggle model, WindowHeading prefix param) are conforming. --> <!-- rework cycle 1: fixed — handleWaitingBadgeClick now builds the session-scoped ordered waiting set and calls nextWaitingTarget(ordered, server, windowParam) with the chatSearchForTarget append rule intact -->
- [x] A-025 Type narrowing over assertions: view/event discrimination uses guards/discriminated unions, not `as` casts (code-quality.md Frontend rule).
- [x] A-026 No client polling: chat live data uses the SSE `EventSource`, never `setInterval` + fetch (anti-patterns).
- [x] A-027 R13 Process execution: no new `exec`/shell strings introduced backend-side; `Notify` timeout preserved.
- [x] A-028 Every new/modified `*.spec.ts` ships a sibling `*.spec.md` companion (constitutional).

### Security

- [x] A-029 R13: The push `url` field is a same-origin relative path constructed server-side from the (server, windowId) it already trusts; `sw.js` opens it as a relative URL (no open-redirect/external-navigation surface).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The
`sw.js` hardcoded `openWindow("/")` and the 3-arg `push.Notify` signature were replaced
in place, not left behind; no orphaned symbols, branches, or config remain.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | View state = `?view=chat` search param on the existing terminal route; no new routes | Intake #1 (Plan Decision log, binding); Constitution IV | S:95 R:85 A:95 D:95 |
| 2 | Certain | `[tty|chat]` L1 segmented chip gated on `chatProvider`; palette parity + Ctrl+` shortcut; `Chat: <window>` heading via parametrized `WindowHeading` | Intake #2 + verified `WindowHeading`/`useBootSweep` seam (top-bar.tsx:824) | S:90 R:80 A:95 D:90 |
| 3 | Certain | Read-only: no send path; disabled footer affordance pointing at the terminal | Intake #3; change stack ordering (send is Change 4) | S:100 R:90 A:95 D:100 |
| 4 | Certain | Connection dot = chat stream health in chat mode via AppShell's registered `isConnected` | Intake #4 (verbatim decision); `TopBarSlot.isConnected` is the exact seam | S:90 R:85 A:90 D:90 |
| 5 | Certain | Per-window view pref via board-autofit key-presence pattern; key `runkit:chat-view:{server}:{windowId}` | Intake #5; `use-board-autofit.ts` template read in-tree | S:90 R:90 A:95 D:90 |
| 6 | Certain | Consume the landed backend contract as-is: dedicated per-view `EventSource`, four named events, replace-on-backfill, dedup by `id`, group by `turn` | Intake #6; contract documented in `chat.md`, endpoints verified in `api/chat.go` | S:90 R:80 A:90 D:85 |
| 7 | Confident | Markdown via `react-markdown` + `remark-gfm`; code blocks plain monospace `<pre>`, no syntax highlighting | Intake #7; React-idiomatic, no `dangerouslySetInnerHTML`, swappable, minimal-deps ethos | S:55 R:70 A:60 D:50 |
| 8 | Confident | Keyboard shortcut = Ctrl+` (both platforms), document-level capture minus xterm-focus suppression | Intake #8; VS Code toggle-terminal association; Cmd+` unbindable (macOS window cycle) | S:35 R:90 A:60 D:50 |
| 9 | Confident | Precedence URL param > localStorage pref > terminal default; toggle writes both; chat-less `?view=chat` renders terminal (param inert) | Intake #9; single consistent composition; graceful deep-link degradation | S:60 R:85 A:70 D:65 |
| 10 | Confident | Toggle chip visible at ALL breakpoints (no `hidden sm:flex`); 375px single-row budget e2e-gated | Intake #10; mobile is the primary chat use case; budget risk test-gated | S:45 R:80 A:60 D:60 |
| 11 | Confident | Pending question = attention-styled bubble at the conversation tail, cleared on `chat-state` `pending: null` | Intake #11; tail matches chat conventions + stick-to-bottom scroll | S:50 R:85 A:65 D:55 |
| 12 | Confident | Push deep-link needs a backend touch (`url` field in `send.go` + URL construction in `waiting_push.go`) + `sw.js` `notificationclick` handling | Intake #12; no URL plumbing exists today (verified `send.go`/`sw.js`); contained + test-covered | S:65 R:70 A:75 D:70 |
| 13 | Confident | `WaitingBadge` gains an OPTIONAL click affordance (interactive only where an onClick is wired) navigating via `nextWaitingTarget` with `?view=chat` append; `Agent: Next waiting` gets the same | Intake #13; badge is display-only today across multi-window scopes; reusing next-waiting nav is the smallest coherent semantics; optional keeps display-only sites unchanged | S:45 R:80 A:60 D:50 |
| 14 | Confident | Tool-call cards collapsed by default: header `toolName`, body pretty-printed `toolInput` + `toolOutput`, `isError` styled error, paired by `toolUseId` | Intake #14; defaults follow schema shape; purely presentational/reversible | S:60 R:85 A:75 D:70 |
| 15 | Confident | Chat panes treated like iframes in `switchTransitionRef.iframeIds` (ungated capture) | Intake §5 ("analogous treatment for chat panes — no xterm first-write gate"); a first-write gate would never release for a non-xterm surface | S:60 R:80 A:75 D:70 |
| 16 | Confident | `Notify` gains a 4th `url string` param (not a struct/options refactor); existing callers pass "" | Smallest signature change; two callers only (`push.go`, `notify.go`); reversible | S:50 R:80 A:70 D:60 |

16 assumptions (6 certain, 10 confident, 0 tentative).
