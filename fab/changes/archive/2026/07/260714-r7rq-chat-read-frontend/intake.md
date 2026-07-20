# Intake: Chat Read Frontend (read-only HTML chat view over the agent pane)

**Change**: 260714-r7rq-chat-read-frontend
**Created**: 2026-07-14

## Origin

> chat-read-frontend — see fab/plans/sahil/agent-chat-view.md Change 3: chat-read-frontend. Depends on Change 2 (chat-read-backend, merged to main as of this spawn). Reference the plan explicitly in the intake.

One-shot `/fab-new` invocation executing **Change 3 of the HTML-agent-chat-view plan**
(`fab/plans/sahil/agent-chat-view.md`). The plan was authored 2026-07-13 in a `/fab-discuss`
session; its **Decision log is binding** (pickup protocol: treat those entries as Certain).
Dependency verified at spawn: Change 2 (`260714-pmfh-chat-read-backend`) is **merged to
origin/main** as commit `9bd110a` (PR #345); Change 1 (`260713-nh86-chat-session-identity`,
PR #339) is also merged. This worktree's branch was fast-forwarded to `origin/main` so the
landed backend contract is present in-tree. The backend surface was read from
`docs/memory/run-kit/chat.md` (Change 2's shipped memory) and the frontend seams were mapped
against current source — all file:line references below are verified against this tree.

## Why

1. **The pain point**: run-kit's worst mobile ergonomic is the 80-column tmux minimum
   overflowing every phone screen — reading an agent conversation on mobile means panning a
   raw terminal. There is now a fully-landed backend (Change 2) that can serve any agent
   pane's conversation as normalized JSON + live SSE, but **no frontend consumes it** (zero
   references to the chat endpoints or `chatProvider` under `app/frontend/src/`).
2. **If we don't build it**: Changes 1–2 stay dead weight — the `@rk_chat` convention and the
   read/stream API have no user-facing value until a view renders them. The
   push-notification → pending-question flow keeps dumping users at `/` instead of the
   question that needs answering.
3. **Why this shape**: per the plan's strategic framing (`docs/wiki/competitive-landscape.md`),
   chat is a **second view over the same tmux pane** — never a substrate. The pane remains the
   agent's parent (Constitution VI); the view is `?view=chat` on the existing
   `/$server/$window` route (Constitution IV: no new routes). Read-only ships first; send is
   Change 4. Nobody in the competitive matrix has "flip between raw terminal and HTML chat of
   the *same live session*."

## What Changes

### 1. `?view=chat` search param on the terminal route

- `terminalRoute` (`src/router.tsx:95-113`) gains the codebase's **first `validateSearch`**:
  `view` is either `"chat"` or absent (any other value normalizes to absent). URL shape:
  `/{server}/{N}?view=chat` (window segment already maps `@N` ↔ `N` via
  `windowIdToUrlSegment`/`urlSegmentToWindowId`, `router.tsx:23-35`).
- **Precedence**: explicit URL param > per-window localStorage pref > terminal default.
  Toggling the view updates both the URL (via `navigate({ search })`) and the stored pref.
- `?view=chat` on a window with **no** `chatProvider` renders the terminal (param inert, pref
  untouched) — deep links degrade gracefully instead of showing an empty chat shell.
- Inline `navigate({ to: "/$server/$window" })` call sites (`app.tsx:679-683` inside
  `navigateToWindow`, plus `app.tsx:573, 650, 1213, 1236`) must not drop the param
  unintentionally; window-to-window navigation resolves the target window's own pref.

### 2. Type the gate field the backend already sends

- `WindowInfo` (`src/types.ts:63-101`) gains `chatProvider?: string` and
  `chatSessionRef?: string`. The backend already emits these on every `/api/sessions`
  response and SSE `sessions` event (window-level rollup of the panes' `@rk_chat`,
  `internal/sessions/sessions.go:508-524` `rollupChat`; JSON keys `chatProvider`/
  `chatSessionRef`). No client/SSE parsing change — the JSON passes through today, it just
  becomes typed on `currentWindow`. **Non-empty `chatProvider` is the sole gate** for every
  chat affordance below (mirrors the backend's own `resolveWindowChat` gating).

### 3. `[tty|chat]` segmented toggle in the top-bar L1 tier

- A compact two-state segmented chip, active side inverse-video, inside the L1
  terminal-only block (`components/top-bar.tsx:400-421`, the `{currentWindow && …}` wrapper
  where SplitButton ×2 + FixedWidthToggle live), additionally gated on
  `currentWindow.chatProvider`.
- Unlike its L1 siblings (each wrapped in `hidden sm:flex`), the chip is **visible at all
  breakpoints** — mobile is a primary chat use case. The 375px single-row top-bar budget must
  be re-verified in e2e (house rule: no wrapping, no horizontal scroll).
- CRT-glint hover treatment per the button vocabulary; `coarse:` touch-target sizing per the
  existing top-bar button conventions (24px fine / 30px coarse).
- Plumbing: `view` + `chatAvailable` + `onSetView` travel the existing channels — route-derived
  values in `RootTopBar` (`app.tsx:186-261`, where `mode` is computed) and/or the
  `TopBarSlot` registration (`contexts/top-bar-slot-context.tsx:27-52`), whichever the
  plan finds cleaner; `TopBarProps` extends accordingly (`top-bar.tsx:20-80`).

### 4. Center heading `Chat: <window>`

- New `CHAT_PREFIX = "Chat:"` beside `TERMINAL_PREFIX` (`top-bar.tsx:713-716`). In chat view
  the center heading renders `Chat: <window>` — parametrize `WindowHeading`'s hardcoded
  prefix (`top-bar.tsx:824` feeds `useBootSweep(TERMINAL_PREFIX, …)`) rather than forking the
  component, so the boot-sweep hover treatment and the inline-rename affordance (the heading
  IS the rename surface, especially on mobile) both carry over unchanged.

### 5. The chat view component (new)

New read-only renderer swapped in at the existing iframe-vs-terminal branch in `AppShell`
(`app.tsx:1853-1898`, inside the `windowParam` arm): `view === "chat" && chatProvider` →
`<ChatView>`, else the current `IframeWindow`/`TerminalClient` logic. The window-switch slide
transition's iframe gating (`app.tsx:820-834` `switchTransitionRef.iframeIds`) needs the
analogous treatment for chat panes (no xterm first-write gate to wait on).

**Data layer** — a component-scoped hook (e.g. `use-chat-stream.ts`) owning one dedicated
`EventSource` per open chat view (NOT the per-server pool):
`/api/windows/{windowId}/chat/stream?server={server}`. Contract (landed, per
`docs/memory/run-kit/chat.md` + `api/chat.go`):

- `chat-backfill` — full `Conversation` `{provider, sessionRef, events, pending}` on connect
  AND on any reset/session-rotation (`/clear` re-stamp is delivered on the same connection;
  the client must **replace** its event list on every backfill, never append).
- `chat` — array of newly-appended `Event`s; dedup by `id` (provider line uuid).
- `chat-state` — `{pending: Pending | null}`; always emitted after appends, including `null`,
  so the view clears a resolved question marker.
- `chat-error` — fatal; render an inline error state.
- `Event` shape: `{type: "message"|"tool_use"|"tool_result", id?, turn, role?, text?,
  toolUseId?, toolName?, toolInput?, toolOutput?, isError?, ts?}`. Group bubbles by the
  `turn` counter; no synthetic boundary events exist.
- Health: mirror the established 3s disconnect debounce (`session-context.tsx:702-706`);
  `EventSource` auto-reconnect handles retry; reconnect ⇒ fresh backfill (no cursor).
- One-shot `GET /api/windows/{windowId}/chat` exists for backfill but the stream's first
  `chat-backfill` makes a separate fetch unnecessary — the view consumes the stream alone.

**Rendering**:

- Message bubbles: user vs assistant visually distinct; markdown + fenced code blocks via
  **react-markdown + remark-gfm** (net-new deps — the frontend currently has no markdown
  renderer); code blocks as plain monospace `<pre>` (no syntax-highlighting dependency in
  v1 — terminal aesthetic).
- Tool-call cards: one collapsible card per `tool_use`/`tool_result` pair (joined by
  `toolUseId`), **collapsed by default** — header shows `toolName`, body shows pretty-printed
  `toolInput` JSON + `toolOutput` text, `isError: true` styled as error. `anser` (already a
  dependency) may render ANSI in tool output if trivially applicable; not required.
- Pending question: when `pending` is non-null, render a visually distinct attention-styled
  bubble at the **conversation tail** (the newest position) carrying `pending.text` (or
  `toolName` when text is empty); clears on `chat-state` `pending: null`.
- Streaming: auto-follow the tail (stick-to-bottom) unless the user has scrolled up.
- House aesthetic throughout: monospace, three-mode theme tokens, hover-animation vocabulary,
  all animation behind `prefers-reduced-motion`.
- **No input box** — a visibly disabled footer affordance pointing at the terminal view
  ("send from the terminal view — coming in chat-send"). Send is Change 4.

### 6. Connection dot = chat stream health in chat mode

Plan decision: "dot-everywhere = per-page live-data health." In chat view, `AppShell`'s
registered `isConnected` (`app.tsx:337`, via `TopBarSlot`) reflects the **chat stream's**
health instead of the per-server sessions-SSE slice; in terminal view behavior is unchanged.

### 7. Per-window last-view persistence

`localStorage` key-presence pattern cloned from `useBoardAutofit`
(`hooks/use-board-autofit.ts`: sentinel `"on"`, `removeItem` on off): key
`runkit:chat-view:{server}:{windowId}`, present ⇒ chat is that window's default view,
absent ⇒ terminal. Written on every user toggle; read only when the URL carries no `view`
param. (Accepted: tmux recycles window IDs, so stale keys can mis-default a future window —
same accepted property as board-autofit's per-name keys; keys are tiny and self-correcting
on next toggle.)

### 8. Palette parity + keyboard shortcut (Constitution V — mandatory)

- `View: Chat` / `View: Terminal` actions join `viewActions` (`app.tsx:1432-1462`), gated on
  `currentWindow.chatProvider` (gate-then-build per the `lib/palette-update.ts` pattern);
  only the inactive side's action shows (or both with the active one marked — match the
  Fixed/Full Width pair's existing toggle idiom).
- Keyboard shortcut: **Ctrl+`** toggles tty↔chat on the terminal route (VS Code
  "toggle terminal" association; plain Ctrl on both platforms — Cmd+` is macOS window
  cycling and must not be bound). Constraint: it must fire **while xterm owns focus** —
  document-level capture per the `useSidebarKeyboardToggle` pattern (`shell.tsx:15-42`),
  minus its xterm-focus suppression (this shortcut's whole job is escaping the terminal), or
  xterm's `attachCustomKeyEventHandler` if capture proves insufficient.

### 9. Waiting integration: deep links into `?view=chat`

- **Web Push** (small backend + service-worker touch, in scope per the plan's Change-3
  waiting integration): the push payload (`internal/push/send.go:21-25` — today only
  `{Title, Body, Icon}`) gains a URL field threaded through `Notify`; the waiting-push
  producer (`api/waiting_push.go:122-123`) constructs `/{server}/{N}?view=chat` for the
  waiting window (`?view=chat` only when the window has a `chatProvider`, else the plain
  window URL). `public/sw.js` stores it via `showNotification(…, {data})` and
  `notificationclick` (`sw.js:36-49`, today hardcoded to `openWindow("/")`) focuses an
  existing tab and navigates it, else opens the URL. Go tests extend
  `api/waiting_push_test.go`.
- **WaitingBadge** (`components/waiting-badge.tsx` — display-only today, no onClick): gains
  an optional click affordance where a navigable context exists (sidebar session row, Cockpit
  server tile), navigating to the next waiting window within its scope — reusing the
  `nextWaitingTarget` semantics (`lib/palette-agent-nav.ts`) — with `?view=chat` appended
  when that window has a chat. The existing `Agent: Next waiting` palette action gets the
  same `?view=chat` append rule.

### 10. Tests

- **Playwright e2e + sibling `.spec.md` companions** (constitutional requirement), run via
  `just test-e2e` / `just pw` only (port-3020 isolation): toggle appears only on
  `chatProvider` windows; flipping views preserves the window; deep link `?view=chat`
  cold-loads into chat; heading reads `Chat: <window>`; pending-question bubble renders and
  clears; 375px AND desktop viewports; reduced-motion honored. Chat endpoints mocked via
  `page.route` — globs need a trailing `*` because `withServer` appends `?server=`
  (established project gotcha); the SSE stream mock fulfills with a `text/event-stream` body.
- Vitest units for the pure parts: view-precedence resolution (param vs pref), event dedup +
  turn grouping, tool-card pairing by `toolUseId`, pending derivation → display, push URL
  construction (Go side: `waiting_push_test.go`).

### 11. Plan tracking table

Fill Change 3's row in `fab/plans/sahil/agent-chat-view.md` with this change folder
(`260714-r7rq-chat-read-frontend`) in the same PR; mark Done when the PR merges (pickup
protocol step 5).

## Affected Memory

- `run-kit/ui-patterns`: (modify) chat view over the terminal route — `?view=chat` search param, `[tty|chat]` L1 toggle, `Chat:` heading prefix, per-window view persistence, palette/shortcut parity, chat-health connection dot
- `run-kit/chat`: (modify) add the frontend-consumer half — dedicated per-view EventSource lifecycle, four-event contract consumption, renderer structure (bubbles/tool cards/pending), read-only stance
- `run-kit/architecture`: (modify) push payload gains a URL/data field + service-worker deep-link handling (the notify path's first navigation target)

## Impact

- **Frontend** (`app/frontend/src/`): `router.tsx` (first `validateSearch`), `app.tsx`
  (renderer branch, slot registration, viewActions, navigate call sites), `types.ts`
  (`WindowInfo`), `components/top-bar.tsx` (L1 chip, heading prefix),
  `contexts/top-bar-slot-context.tsx`, new `components/chat-view.tsx` (+ subcomponents), new
  `hooks/use-chat-stream.ts` + per-window view-pref hook, `components/waiting-badge.tsx`,
  `lib/palette-agent-nav.ts`, `public/sw.js`.
- **Frontend deps** (`package.json`): + `react-markdown`, + `remark-gfm` (first markdown
  renderer; currently only 8 top-level deps — reviewed choice, see Assumptions #6).
- **Backend** (small): `internal/push/send.go` (payload URL field), `api/waiting_push.go`
  (target URL construction) + tests.
- **Tests**: new e2e spec(s) + `.spec.md` companions under `app/frontend/tests/e2e/`; Vitest
  units colocated; Go tests for the push payload.
- **No new routes** (Constitution IV), **no client-side conversation caching** beyond
  component state that dies with the view (Constitution II analog), backend contract
  consumed as landed — no API changes to the chat endpoints themselves.
- **Depends on**: Change 2 (`260714-pmfh-chat-read-backend`, merged `9bd110a`); Change 1
  (`@rk_chat` reconciliation, merged). Enables Change 4 (`chat-send`) and the optional
  provider adapters (5/6) with zero additional frontend work (provider-neutral schema).
- **Out of scope** (plan-wide): board-pane chat toggle, mobile auto-default to chat, any send
  path, any conversation storage in rk.

## Open Questions

- None — the plan's binding decision log plus the landed Change-2 contract resolve the
  scope; remaining choices are graded below (no Unresolved rows).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | View state lives in the URL: `?view=chat` search param on the existing `/$server/$window` route; no new routes | Plan Decision log (binding per pickup protocol); Constitution IV | S:95 R:85 A:95 D:95 |
| 2 | Certain | Switcher = compact two-state tty/chat segmented chip (active side inverse-video) in the top-bar L1 tier, gated on `@rk_chat` presence; palette parity + keyboard shortcut mandatory; heading `Chat: <window>` | Plan Decision log; Constitution V | S:95 R:80 A:95 D:90 |
| 3 | Certain | Read-only view: no send path; visibly disabled input affordance pointing at the terminal view; send is Change 4 | Plan Decision log ("read-first") + change stack ordering | S:100 R:90 A:95 D:100 |
| 4 | Certain | Connection dot reports chat event-stream health in chat mode (dot-everywhere = per-page live-data health) | Plan Decision log, verbatim | S:90 R:85 A:90 D:90 |
| 5 | Certain | Last view per window persisted in localStorage, `board-autofit`-style key-presence (key present = chat, absent = terminal default) | Plan Decision log names the pattern; template exists at `use-board-autofit.ts` | S:90 R:90 A:95 D:90 |
| 6 | Certain | Consume the landed backend contract as-is: dedicated per-view EventSource on `/api/windows/{windowId}/chat/stream`, four named events, replace-on-backfill, dedup by event `id`, group by `turn` | Contract shipped + documented in `docs/memory/run-kit/chat.md`; verified in-tree | S:85 R:80 A:90 D:85 |
| 7 | Confident | Markdown via `react-markdown` + `remark-gfm`; code blocks plain monospace, no syntax-highlighting dependency in v1 | Plan requires markdown+code blocks but names no lib; react-markdown is the React-idiomatic default (no dangerouslySetInnerHTML); swappable behind one renderer component; minimal-deps ethos says start lean | S:55 R:70 A:60 D:50 |
| 8 | Confident | Keyboard shortcut = Ctrl+` (both platforms) toggling tty↔chat, reachable while xterm owns focus | Plan mandates "a keyboard shortcut" without naming one; VS Code toggle-terminal association; Cmd+` is macOS window cycling (unbindable); trivially rebindable later | S:30 R:90 A:55 D:45 |
| 9 | Confident | Precedence: URL param > localStorage pref > terminal default; toggle writes both; `?view=chat` on a chat-less window renders the terminal (param inert) | Plan commits URL-state + persistence separately; merge rule is the one consistent composition; graceful deep-link degradation | S:60 R:85 A:70 D:65 |
| 10 | Confident | Toggle chip visible at ALL breakpoints (unlike `hidden sm:flex` L1 siblings); 375px single-row budget re-verified in e2e | Mobile is a primary use case for chat (the 80-col pain); plan is silent on breakpoint visibility; budget risk is real and test-gated | S:40 R:80 A:55 D:55 |
| 11 | Confident | Pending question renders as a distinct attention-styled bubble at the conversation tail (newest position), cleared on `chat-state` `pending: null` | Plan's "top bubble" read as top-of-stack = newest; tail position matches chat conventions and the stick-to-bottom scroll | S:50 R:85 A:65 D:55 |
| 12 | Confident | Push deep-linking requires a small backend touch (payload URL field in `internal/push/send.go` + URL construction in `api/waiting_push.go`) and `sw.js` `notificationclick` handling — in scope for this change | Plan lists Web Push deep-link under Change 3; no URL plumbing exists today (verified); contained, test-covered extension | S:65 R:70 A:75 D:70 |
| 13 | Confident | WaitingBadge gains an optional click affordance navigating to the next waiting window (nextWaitingTarget semantics) with `?view=chat` appended when that window has a chat; `Agent: Next waiting` palette action gets the same append | Plan says "WaitingBadge … deep-link to ?view=chat" but badge is display-only today over multi-window scopes; reusing the existing next-waiting navigation is the smallest coherent semantics | S:45 R:80 A:60 D:50 |
| 14 | Confident | Tool-call cards collapsed by default: header `toolName`, body pretty-printed `toolInput` + `toolOutput` text, `isError` styled as error, paired by `toolUseId` | Plan says "collapsible tool-call cards"; defaults follow schema shape; purely presentational and reversible | S:60 R:85 A:75 D:70 |

14 assumptions (6 certain, 8 confident, 0 tentative, 0 unresolved).
