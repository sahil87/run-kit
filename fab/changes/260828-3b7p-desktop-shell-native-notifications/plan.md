# Plan: Desktop-Shell Native Notifications

**Change**: 260828-3b7p-desktop-shell-native-notifications
**Intake**: `intake.md`

## Requirements

### Backend: `notify` broadcast on the state-socket hub

#### R1: sseHub gains broadcastNotify with no replay slot
`app/backend/api/sse.go` SHALL gain `broadcastNotify(title, body, url string)` on `sseHub`, mirroring `broadcastStatusRefresh` exactly: marshal the `{title, body, url}` payload (omit or empty-string `url` when none — pick one and keep the SPA parse tolerant either way), `preRendered(hubEvent{kind: kindGlobal, typ: "notify", data: ...})` composed ONCE before the lock, then `h.mu.Lock()` + `broadcastGlobalLocked(ev)`. It SHALL NOT write any cached replay slot — `replayGlobalSlots` is untouched, so reconnecting/late subscribers never receive past notifications.

- **GIVEN** two connected state-socket clients and a call `broadcastNotify("RunKit", "hi", "/noon/57")`
- **WHEN** the broadcast runs
- **THEN** both connections receive one `{op:"event", kind:"global", type:"notify", data:{title,body,url}}` event, and a client connecting afterwards receives nothing

#### R2: handleNotify broadcasts alongside the push fan-out
`handleNotify` (`app/backend/api/push.go`) SHALL broadcast via the hub after validation, carrying the same `title` (already defaulted to `"RunKit"`), `body`, and the `notifyDeepLinkPath(body.URL)` output. The broadcast is UNCONDITIONAL on push outcome: zero stored subscriptions and push errors still broadcast. Hub access follows the established handler wiring (`s.initSSEHub()` then `s.sseHub` — the `broadcastStatusRefresh` caller precedent). Response shape `{sent, pruned}` is unchanged.

- **GIVEN** no push subscriptions stored and a `POST /api/notify {"body":"hi","url":"/noon/57"}`
- **WHEN** the handler runs
- **THEN** the response is 200 `{sent:0, pruned:0}` AND one `notify` global event with `url:"/noon/57"` reaches connected state sockets

#### R3: the waiting-push watcher broadcasts each decided push, hot-path-safe
`app/backend/api/waiting_push.go` SHALL broadcast each decided waiting push (`title`, `body`, `waitingPushURL(...)` output) through a NEW injectable broadcast seam beside the existing `notify` send-fn seam (default: the hub's `broadcastNotify`; stubbed in tests). The detached-send invariant stays: the SSE poll tick performs no network I/O and never blocks on the broadcast — `broadcastGlobalLocked`'s non-blocking channel enqueue makes the hub call hot-path-safe; placement (inside the existing detached goroutine alongside `push.Notify`) SHALL preserve the tick's zero-network property.

- **GIVEN** a window sustained-`waiting` past the threshold
- **WHEN** its one push fires
- **THEN** the stubbed broadcast seam observes exactly one `{title, body, url}` matching the push, and the poll tick completes without waiting on any send

### Frontend SPA: shell-gated forwarder

#### R4: shell bridge wrapper + notify listener forward
`app/frontend/src/lib/shell.ts` SHALL gain a `notify` bridge group wrapper `showShellNotification(payload: {title: string; body: string; url: string}): Promise<boolean>` with the standard never-throws contract (plain browser / older shell without the group / `{ok:false}` / rejected invoke ⇒ `false`), structurally narrowed like `badgeBridge()`. `SessionContext` (`contexts/session-context.tsx`) SHALL add a `notify` listener on BOTH stream kinds (the `version`/`update-available` registration sites), parse tolerantly (`{title?, body?, url?}` strings, missing ⇒ `""`), and — ONLY when `isShell()` — fire `void showShellNotification({title, body, url})`. No React state is introduced (fire-and-forget; no re-render). Outside the shell the event is ignored — zero browser behavior change (Non-Goal: in-browser toast).

- **GIVEN** the SPA running inside the shell and a `notify` global event arriving
- **WHEN** the listener fires
- **THEN** `showShellNotification` is invoked once with the event's `{title, body, url}`; in a plain browser the same event produces no call

### Desktop shell: native notification + click-to-navigate

#### R5: notify.ts pure module owns validation and title composition
A new electron-free `app/desktop/src/notify.ts` SHALL export: `notifyNavigationTarget(hostUrl: string, path: string): string | null` — returns `hostUrl + path` only when `path` starts with `/` and not `//` (the sw.js `sameOriginPath` mirror), else `null` (empty/absolute/protocol-relative/garbage all `null`); and `notificationTitle(rawTitle: string, hostName: string, isActiveHost: boolean): string` — the raw title when the reporting host is active, `[{hostName}] {rawTitle}` otherwise. Covered by `notify.test.ts` under the existing `node --test` runner (validation matrix: valid path, query-carrying path, empty, `//evil.example`, `https://…`, missing leading `/`; title: active vs background).

- **GIVEN** `notifyNavigationTarget("http://127.0.0.1:3100", "//evil.example")`
- **WHEN** evaluated
- **THEN** it returns `null`; `("http://…", "/noon/57?view=chat")` returns the joined URL

#### R6: preload channel + main handler + Notification + click routing
`preload.ts` SHALL expose a `notify` group (`show: (payload) => ipcRenderer.invoke("notify:show", payload)`, the `badge` group shape). `main.ts` SHALL handle `notify:show` gated on `isHostsSender` with structural validation (`title`/`body`/`url` strings, else `{ok:false, error:"Invalid request"}`); resolve the sender view via `findViewByWebContentsId` (a non-view sender acks `{ok:true}` and shows nothing — the badge's late-report posture); guard `Notification.isSupported()` (fail-silent); compose the title via `notificationTitle` (active vs background host, host name from the store entry); show the notification; and on `click`: focus/restore the main window, `switchToHost(hostId)`, then — only when `notifyNavigationTarget(host.url, url)` is non-null — `loadURL` that target on the host's view. Navigation happens ONLY on click, never on receipt; an empty/invalid `url` still focuses + switches.

- **GIVEN** a background host's view reports `notify:show` with `url:"/noon/57"`
- **WHEN** the user clicks the shown notification
- **THEN** the window focuses, the shell switches to that host, and its view navigates to `{host.url}/noon/57`; on receipt alone the view is untouched

### Verification

#### R7: all gates green
Go tests (`app/backend`), frontend `tsc --noEmit` + Vitest, and the desktop package's compile + `node --test` suite SHALL pass. The packaged-app visual notification check is a manual-verify caveat (unsigned dev-run may not display notifications on macOS), carried in the PR body, not a test gate.

- **GIVEN** the completed implementation
- **WHEN** the suites run
- **THEN** all pass with the new tests included

### Non-Goals

- No in-browser toast for the `notify` event (browser users keep Web Push; possible future).
- No browser↔shell dedupe — dual delivery on a machine with a subscribed browser is accepted; the user controls it by unsubscribing that browser.
- No cached replay of notifications to reconnecting clients.
- No focus/visibility suppression in v1 (mirrors Web Push: OS notifications show regardless of focus).

### Design Decisions

#### The forwarder is a context-level listener, not a component
**Decision**: the `notify` listener lives in `SessionContext`'s existing both-stream-kinds registration sites and calls `showShellNotification` directly (gated on `isShell()`); no `ShellNotifyForwarder` component and no context state.
**Why**: the event is fire-and-forget with no derived UI state — routing it through React state would re-render the provider for nothing; the listener sites already exist and are idempotent.
**Rejected**: a render-nothing reporter component (`ShellBadgeReporter` idiom) — right for state-derived reports like the badge count, needless indirection for a pass-through event.
*Introduced by*: 260828-3b7p-desktop-shell-native-notifications

#### No replay slot for notify
**Decision**: `broadcastNotify` writes no cached global slot; `replayGlobalSlots` is untouched.
**Why**: a notification is an ephemeral attention signal — replaying it to a tab reconnecting hours later is stale noise; `version`/`update-available` replay because they are durable state, which a notify is not.
**Rejected**: a last-notify slot with TTL (invents a policy nothing needs yet).
*Introduced by*: 260828-3b7p-desktop-shell-native-notifications

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/api/sse.go`: add `broadcastNotify(title, body, url string)` on `sseHub` — payload marshal, `preRendered` once (kind `kindGlobal`, typ `"notify"`), `broadcastGlobalLocked` under the lock; NO replay-slot write <!-- R1 -->
- [x] T002 `app/backend/api/push.go` + `app/backend/api/waiting_push.go`: `handleNotify` broadcasts unconditionally after validation via `s.initSSEHub()`/`s.sseHub.broadcastNotify(title, body.Body, url)`; waiting-push gains an injectable broadcast seam beside the notify fn seam, defaulting to the hub call, invoked with each decided push's `{title, body, url}` while preserving the detached/zero-network tick invariant <!-- R2 -->
- [x] T003 `app/frontend/src/lib/shell.ts`: `notify` bridge group narrowing + `showShellNotification(payload): Promise<boolean>` (never-throws contract); `app/frontend/src/contexts/session-context.tsx`: `notify` listener on both stream kinds, tolerant parse, `isShell()`-gated forward, no state <!-- R4 -->
- [x] T004 `app/desktop/src/notify.ts` (new, electron-free): `notifyNavigationTarget(hostUrl, path)` and `notificationTitle(rawTitle, hostName, isActiveHost)` <!-- R5 -->
- [x] T005 `app/desktop/src/preload.ts` + `main.ts`: `notify` preload group; `notify:show` handler (isHostsSender gate, structural validation, sender-view resolution, `Notification.isSupported()` guard, title composition, click → focus + `switchToHost` + guarded `loadURL`) <!-- R6 --> <!-- rework: cycle 1 — (a) the dev sentinel view (DEV_HOST_ID, RK_DESKTOP_URL) has no hosts.json entry and must still notify: show with the raw title (single-view shell, no prefix) and on click navigate the dev view against its CURRENT origin; (b) never capture host.url at receipt — the click handler re-resolves the current host entry (or dev view origin) by hostId before composing notifyNavigationTarget; (c) document the notify global event + no-replay semantics in docs/specs/api.md beside update-available -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T006 Backend tests: `sse` hub broadcast test (two conns receive one `notify` event, late subscriber receives none); `push_test.go` handleNotify-broadcasts case incl. zero subscriptions; `waiting_push_test.go` broadcast-seam case (one broadcast per decided push, matching payload) <!-- R1 -->
- [x] T007 Frontend tests: `shell.test.ts` cases for the notify group (present/absent/malformed/denied); forwarder unit test — `isShell()` gate (no forward in plain browser), payload shape, malformed-event tolerance <!-- R4 -->
- [x] T008 Desktop tests: `notify.test.ts` — `notifyNavigationTarget` matrix and `notificationTitle` active/background cases; whole suite via compile + `node --test "dist/**/*.test.js"` <!-- R5 -->

### Phase 4: Polish

- [x] T009 Verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit` + unit tests; `cd app/desktop && pnpm run compile && node --test "dist/**/*.test.js"` — all green <!-- R7 -->

## Execution Order

- T001 blocks T002 and T006. T003 is independent of backend tasks. T004 blocks T005 and T008. Tests (T006–T008) follow their implementation tasks; T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `broadcastNotify` exists on `sseHub`, pre-rendered once, fans out as `kind:"global"` / `type:"notify"`, writes no replay slot
- [x] A-002 R2: `handleNotify` broadcasts on every valid request — including zero subscriptions and push-error paths — with the soft-validated `url`
- [x] A-003 R3: each decided waiting push produces exactly one broadcast through the injectable seam with the matching `{title, body, url}`
- [x] A-004 R4: `showShellNotification` implements the never-throws bridge contract; the SessionContext listener forwards inside the shell only
- [x] A-005 R5: `notify.ts` is electron-free and exports the navigation-target and title helpers
- [x] A-006 R6: `notify:show` is gated, validated, sender-resolved, `isSupported`-guarded; click focuses + switches + navigates only via `notifyNavigationTarget`

### Behavioral Correctness

- [x] A-007 R6: navigation never happens on receipt — only inside the notification click handler
- [x] A-008 R1: a state-socket client connecting after a broadcast receives no `notify` event (no replay)
- [x] A-009 R4: outside the shell, the `notify` event produces zero behavior change (no toast, no error)

### Scenario Coverage

- [x] A-010 R2: test proves POST /api/notify with `url` → connected socket observes the event with that url while the response stays `{sent, pruned}`
- [x] A-011 R3: test proves the SSE poll tick does not block on broadcasting (seam stub, no network in tick)

### Edge Cases & Error Handling

- [x] A-012 R5: `notifyNavigationTarget` rejects `//…`, absolute URLs, non-`/`-prefixed and empty paths with `null`; accepts query-carrying relative paths
- [x] A-013 R6: non-view senders (welcome page, destroyed view's late report) ack without showing; unsupported `Notification` environments fail silent

### Code Quality

- [x] A-014 Pattern consistency: broadcast mirrors `broadcastStatusRefresh`; bridge group mirrors `badge`; pure-module discipline mirrors `views.ts`/`badge.ts`
- [x] A-015 No unnecessary duplication: reuses `findViewByWebContentsId`, `switchToHost`, `isHostsSender`, the existing listener registration sites
- [x] A-016 Tests included for all added behavior (code-quality principle)

### Security

- [x] A-017 R5/R6: the shell navigates only to same-origin-joined targets passing the `sameOriginPath`-mirror check; the IPC handler is sender-gated and structurally validated; no subprocess added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Forwarder is a context-level listener (no component, no state) | Fire-and-forget event; the version/update-available listener sites already exist (see Design Decisions) | S:60 R:90 A:85 D:75 |
| 2 | Confident | Payload marshals `url` via `omitempty`-style omission when empty; SPA parse tolerates both absent and empty | Mirrors the push payload's `url,omitempty`; either shape is safe given tolerant parsing | S:55 R:90 A:80 D:70 |
| 3 | Certain | Host name for the background-title prefix comes from the shell's store entry (`hosts.json` display name), not the SPA payload | The shell already holds the mapping (sender view → hostId → entry); the SPA doesn't know shell-side host names | S:80 R:85 A:90 D:85 |
| 4 | Confident | Click handler uses `loadURL(host.url + path)` on the existing view (not `client.navigate` semantics) — a full navigation is acceptable for a deliberate notification click | The view keeps its identity; SPA boot cost on an explicit user jump is fine, and no lighter in-view routing seam exists shell-side today | S:55 R:80 A:75 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
