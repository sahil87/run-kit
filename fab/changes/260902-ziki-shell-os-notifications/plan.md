# Plan: Shell OS Notifications

**Change**: 260902-ziki-shell-os-notifications
**Intake**: `intake.md`

## Requirements

### Backend: `notify` global event on the state hub

#### R1: broadcastNotify hub helper
The SSE hub SHALL gain a `broadcastNotify(title, body, url string)` method that marshals a `{id, title, body, url}` payload (`id` a per-event random token, e.g. 16 hex chars from `crypto/rand`; `url` carried with `omitempty`) and broadcasts it as a host-global event `kind: global`, `type: "notify"` to every connected state client via `broadcastGlobalLocked` — following the `broadcastUpdateAvailable` shape (`app/backend/api/sse.go:1041`). It MUST NOT cache the payload in any global slot: `replayGlobalSlots` never replays notify events (notifications are moment-in-time; a replay would duplicate OS alerts on every reconnect).

- **GIVEN** two connected state-socket clients and one client that connects later
- **WHEN** `broadcastNotify("RunKit", "agent waiting", "/utils2/@5?view=chat")` is called
- **THEN** both connected clients receive one `{kind: "global", type: "notify"}` event with the payload
- **AND** the late-connecting client receives no notify event on connect

#### R2: handleNotify broadcasts alongside Web Push
`handleNotify` (`app/backend/api/push.go:54`) SHALL, in addition to the existing `push.Notify` fan-out, broadcast the same title/body on the state hub via `s.initSSEHub().broadcastNotify(title, body, "")`. The HTTP response contract (`{"sent": N, "pruned": M}`) and the Web Push path are unchanged.

- **GIVEN** a running server with one connected state client and zero push subscriptions
- **WHEN** `POST /api/notify {"body": "hi"}` is received
- **THEN** the state client receives a `notify` event with title `"RunKit"` (the default) and body `"hi"`
- **AND** the response remains `{"sent": 0, "pruned": 0}`

#### R3: waiting-push watcher broadcasts with its deep link
The waiting-push tracker's notify seam SHALL be injected at hub construction with a closure that broadcasts on the hub using the same title, body, and deep-link `url` it hands to `push.Notify`. The tracker is built inside `newSSEHub`, so the closure can close over the hub while the `notify` func field stays test-injectable.

- **GIVEN** a window sustained `waiting` past the 15s threshold and a connected state client
- **WHEN** the tracker fires its one push for the episode
- **THEN** the state client receives a `notify` event carrying the same title/body and the episode's deep-link `url` (e.g. `/{server}/{N}?view=chat`)

### Frontend: shell-gated OS-notification consumer

#### R4: shell-notifications module
A new module `app/frontend/src/lib/shell-notifications.ts` SHALL own the pure/shell-side logic:
- `sameOriginPath(value: unknown): string | null` — mirrors `public/sw.js`'s rule by value (must be a string starting with `/` but not `//`; belt-and-braces `new URL(value, origin).origin === origin` check), returning the safe path or `null`.
- `isShellNotificationsEnabled()` / `setShellNotificationsEnabled(on: boolean)` — the per-viewer opt-in over localStorage key `runkit-shell-notifications` (value `"on"`; absent = off; reads/writes wrapped in try/catch per the localStorage discipline).
- `claimNotification(id: string, store: Pick<Storage, "getItem" | "setItem">): boolean` — cross-view dedupe: returns false when `runkit-notify-claim-<id>` is already set, else sets it and returns true. Old claim keys (a bounded prefix scan) are pruned opportunistically on each claim so the store cannot grow unbounded.
- `showShellNotification(payload: unknown, navigate: (path: string) => void): boolean` — tolerant-parses `{id?, title?, body?, url?}` (default title `"RunKit"`, missing/duff `id` degrades to showing without a claim), gates on `isShell()` AND the enabled pref AND the claim, then fires `new Notification(title, { body, icon: "/generated-icons/icon-192.png" })`; `onclick` focuses (`window.focus()`) and navigates to the validated `sameOriginPath(url)` (no navigation when `null`). Throw-free: every failure returns false.

- **GIVEN** the pref is on, `isShell()` is true, and a fresh event id
- **WHEN** `showShellNotification({id, title, body, url: "//evil.example"}, navigate)` runs
- **THEN** a Notification is shown and clicking it does NOT navigate (hostile URL rejected)
- **AND** a second call with the same id in another view returns false (claimed)

#### R5: session-context notify listener
`contexts/session-context.tsx`'s global-event switch (the `case "update-available"` seam, ~line 918) SHALL gain a `case "notify"` that forwards the raw payload to a registered consumer callback (a context-exposed `onNotify` registration or an `applyNotify` callback prop-drilled to a layout-level hook — matching the file's existing callback conventions). A layout-level hook (mounted once, where `useNavigate` is available — the `use-update-click` precedent) SHALL register the consumer and call `showShellNotification(payload, navigate)`. The navigation adapter MUST preserve the deep link's query string: TanStack Router treats `to` as route-path input and does not parse `?view=chat` into `search`, so the adapter SHALL pass the validated path as `navigate({ href: path })` (or split pathname/search explicitly), covered by a regression test navigating a query-bearing chat deep link (`/utils2/5?view=chat` reaches pathname `/utils2/5` with `search.view === "chat"`). Plain browsers are inert: the `isShell()` gate inside `showShellNotification` makes the listener a no-op outside the shell.

- **GIVEN** the SPA running in a plain browser (no `window.runkitShell`)
- **WHEN** a `notify` global event arrives
- **THEN** no Notification is constructed (Web Push remains the browser path)

### Frontend: opt-in state and Enable/Test surfaces in shell mode

#### R6: usePushSubscription shell fork
`hooks/use-push-subscription.ts` SHALL fork on `isShell()`, reusing the `PushState` vocabulary so both surfaces (settings row, palette) render unchanged:
- state: `"subscribed"` when the pref is on, else `"default"` (never `"unsupported"`/`"denied"` in shell — no permission dance exists);
- `enable()`: `setShellNotificationsEnabled(true)`, set state, toast `"Notifications enabled"` (info);
- `sendTest()`: fire a direct `new Notification("RunKit", {body: …})` (no service worker), toast the existing success copy; when the pref is off keep the existing `"Enable notifications first"` error toast.
The browser (non-shell) flow is byte-for-byte untouched.

- **GIVEN** the SPA inside the desktop shell with the pref off
- **WHEN** the user clicks the settings row's "Enable notifications"
- **THEN** the pref is set, the row flips to the subscribed state, and an info toast confirms — no PushManager call is attempted (the silent dead-end is structurally unreachable)

#### R7: shell-aware settings-row copy
`NotificationsControl` (`components/settings-dialog.tsx:289`) SHALL say what is true in the shell: sublabel `"OS notifications from this app"` (browser keeps `"Web Push to this browser"`), status line `"Enabled on this device"` / `"Not enabled"` (browser copy unchanged), and the browser-specific footer link/denied note suppressed in shell. Presentation only — the row keeps its structure and the same `usePushSubscription` wiring.

- **GIVEN** the settings dialog open inside the shell
- **WHEN** the Notifications row renders
- **THEN** the sublabel reads "OS notifications from this app" and no Web-Push-specific guidance shows

### Non-Goals

- No delivery while the desktop app is fully quit — nothing can deliver then.
- No change to the Web Push path (SW, VAPID, subscription store) for browsers.
- No main-process Electron `Notification` and no new IPC unless `window.focus()` proves insufficient (tracked as an accepted follow-up, not in this change — see Assumptions).
- No socket-driven notifications in plain browsers (double-notify hazard).
- No notification history/center UI.

### Design Decisions

#### Notify events are broadcast-only, never cached
**Decision**: `broadcastNotify` writes no cached slot; `replayGlobalSlots` is untouched.
**Why**: a notification is a moment-in-time signal — replaying the last one to every late/reconnecting client would duplicate OS alerts on each reconnect (the state socket reconnects after every daemon restart and sleep/wake).
**Rejected**: a cached last-notify slot (replay duplicates); a ring buffer with client-side seen-tracking (complexity with no consumer).
*Introduced by*: 260902-ziki-shell-os-notifications

#### The shell consumes the socket; browsers keep Web Push exclusively
**Decision**: `showShellNotification` gates on `isShell()`; plain browsers never render socket notifications.
**Why**: an open browser tab already receives Web Push through its service worker — a socket-driven duplicate would double-notify. The shell has no push service, so the socket is its only leg; the two legs partition cleanly by environment.
**Rejected**: visibility-based suppression in browsers (fragile, and the SW already dedupes nothing); disabling Web Push when a tab is open (changes the browser contract for no gain).
*Introduced by*: 260902-ziki-shell-os-notifications

#### Shell opt-in is a localStorage pref reusing the PushState vocabulary
**Decision**: per-viewer `runkit-shell-notifications` key, default off; the hook maps it onto `"subscribed"`/`"default"` so existing surfaces render unchanged.
**Why**: Constitution IV places per-viewer state in localStorage; default-off mirrors the web's explicit-opt-in posture; vocabulary reuse means zero churn in the settings row and palette action composition.
**Rejected**: a new settings-registry key (this is per-viewer, not per-instance); auto-enable in shell (surprising OS prompts on macOS first use).
*Introduced by*: 260902-ziki-shell-os-notifications

## Tasks

### Phase 1: Backend

- [x] T001 Add `broadcastNotify(title, body, url string)` + `notifyPayload` struct (random id via `crypto/rand`) to `app/backend/api/sse.go`, modeled on `broadcastUpdateAvailable` minus the cache slot; unit test in `sse_test.go` covering fan-out to connected clients and no replay on a fresh connection <!-- R1 -->
- [x] T002 Call the hub broadcast from `handleNotify` in `app/backend/api/push.go` (via `s.initSSEHub()`); extend `push_test.go` to assert a connected state client receives the event and the response body is unchanged <!-- R2 -->
- [x] T003 <!-- rework: newSSEHub duplicates the push.Notify call the tracker default already installs; wire the combined notifier once --> Inject the waiting-push tracker's single notify closure at hub construction so it calls both `push.Notify` and `broadcastNotify` with the same title/body/url (`app/backend/api/sse.go` / `waiting_push.go`); extend the waiting-push tests to assert the broadcast rides the seam <!-- R3 -->

### Phase 2: Frontend core

- [x] T004 <!-- rework cycle 2: stringField runs `in`/Reflect.get on the untrusted payload outside try/catch — a throwing getter/Proxy escapes the throw-free contract; guard the tolerant reads + throwing-accessor regression test --> Create `app/frontend/src/lib/shell-notifications.ts` (`sameOriginPath`, pref get/set, `claimNotification` with opportunistic prune, `showShellNotification`) + `shell-notifications.test.ts` covering hostile-URL rejection, claim dedupe, pref gating, isShell gating, tolerant parse <!-- R4 -->
- [x] T005 <!-- rework cycle 3 (revise plan): navigation must use navigate({ href }) or an explicit pathname/search split so query-bearing deep links parse; add the /utils2/5?view=chat regression test --> Add the `case "notify"` global-event seam in `contexts/session-context.tsx` and a layout-level consumer hook (with `useNavigate`) that feeds `showShellNotification`, passing the validated path as `navigate({ href: path })` so the query string parses into search; unit-test the seam per the file's existing listener tests plus a query-bearing deep-link navigation regression test <!-- R5 -->

### Phase 3: Opt-in surfaces

- [x] T006 Fork `hooks/use-push-subscription.ts` on `isShell()` (pref-derived state, pref-flipping `enable`, direct-Notification `sendTest`); extend `use-push-subscription` tests (or add them beside `push.test.ts`) with a mocked shell bridge for both modes <!-- R6 -->
- [x] T007 Shell-aware copy in `NotificationsControl` (`components/settings-dialog.tsx`): sublabel, status line, suppressed browser-only notes; update `settings-dialog.test.tsx` <!-- R7 -->

### Phase 4: Verification

- [x] T008 Run the gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted vitest suites, then `just test-frontend` and `just test-backend` <!-- R1 -->

## Execution Order

- T001 blocks T002 and T003 (both call the new helper)
- T004 blocks T005 and T006 (both consume the module)
- T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `broadcastNotify` exists on the hub, fans out `{kind: global, type: notify}` with `{id, title, body, url}` to all connected state clients, and writes no cached slot (no replay on connect) — covered by a Go test
- [x] A-002 R2: `POST /api/notify` broadcasts on the hub in addition to Web Push; response body contract unchanged — covered by a Go test
- [x] A-003 R3: a sustained-waiting push also emits the hub event with its deep-link URL — covered by a Go test through the tracker seam
- [x] A-004 R4: `lib/shell-notifications.ts` exports the four seams with the specified gating (isShell + pref + claim), hostile-URL rejection, bounded claim cleanup, and guarded tolerant field reads — covered by vitest units including a throwing payload accessor
- [x] A-005 R5: the session-context `notify` case forwards payloads to the registered consumer; the hook preserves query-bearing deep links through `navigate({ href })`; a plain-browser environment constructs no Notification
- [x] A-006 R6: in shell mode, `enable()` flips the pref without touching PushManager and state derives from the pref; browser mode is behaviorally unchanged (existing tests still pass)
- [x] A-007 R7: the settings Notifications row renders shell copy in shell mode and the existing browser copy otherwise

### Behavioral Correctness

- [x] A-008 R6: the shell "Enable notifications" click produces visible feedback (state flip + toast) — the silent no-op path is unreachable in shell mode
- [x] A-009 R1: reconnecting a state socket after a notify broadcast delivers no stale notify event

### Scenario Coverage

- [x] A-010 R4: duplicate suppression — two consumers claiming the same event id yield exactly one shown Notification (unit-level, shared-store simulation)
- [x] A-011 R4: a notify payload with `url: "//host"` or a cross-origin URL never navigates

### Edge Cases & Error Handling

- [x] A-012 R4: localStorage throwing (blocked storage) degrades to showing the notification without a claim, never throwing
- [x] A-013 R2: a notify POST with no connected state clients still returns 200 and completes the Web Push fan-out

### Code Quality

- [x] A-014 Pattern consistency: the broadcast helper mirrors the existing `broadcast*` shape (preRendered event, lock discipline); frontend modules follow the pure-module + colocated-test pattern
- [x] A-015 No unnecessary duplication: `sameOriginPath` is the single SPA-side mirror of the sw.js rule; the hook fork reuses `PushState` rather than a parallel state enum; `newSSEHub` injects the single combined push-and-broadcast notifier into the tracker
- [x] A-016 No comment narration; comments state constraints only (e.g. why notify is never cached)
- [x] A-017 Type narrowing over assertions in the tolerant payload parse (no `as` casts)

### Security

- [x] A-018 R4: deep-link navigation validates same-origin-path (leading `/`, not `//`, origin equality) before navigating — hostile payloads cannot redirect off-origin

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without leaving existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Notify consumer registration follows session-context's existing callback conventions (exact shape — context field vs module registration — decided in place) | The file has established listener/callback patterns; any of the shapes is a small, local choice | S:60 R:85 A:80 D:65 |
| 2 | Confident | Click-focus ships as `window.focus()` only; a `shell:focus-window` bridge channel is deferred to a follow-up if focus proves insufficient in manual testing | Keeps this change zero-IPC; the intake graded the bridge Tentative and deferring is the reversible default | S:55 R:80 A:70 D:60 |
| 3 | Confident | No new e2e spec — coverage is Go tests + vitest units (the shell gate needs a stubbed `window.runkitShell`, which unit tests provide more directly than Playwright) | e2e would stub the same bridge with less precision; code-quality's "where possible" qualifier applies | S:55 R:75 A:70 D:60 |
| 4 | Certain | Claim keys use a `runkit-notify-claim-` prefix with opportunistic pruning and no background TTL timer | Bounded, simple, per-origin storage; any leak is self-limiting via the prune | S:70 R:90 A:85 D:80 |
| 5 | Confident | Notification consumers register through a Set-backed `subscribeNotify` context seam, with one layout-level `useShellNotifications` owner | Matches the existing board/status subscriber conventions while preserving SessionProvider's ownership of the singleton state socket | S:65 R:80 A:85 D:70 |
| 6 | Confident | Claim timestamps expire after 24 hours; each claim walks the storage key index to find every claim and retains at most 32 fresh claim keys | A complete key walk prevents unrelated localStorage entries from starving cleanup, while the retained claim population remains strictly bounded | S:60 R:90 A:80 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative).
