# Intake: Desktop-Shell Native Notifications

**Change**: 260828-3b7p-desktop-shell-native-notifications
**Created**: 2026-08-28

## Origin

Promptless dispatch from a live conversation (verified-live motivating scenario, design settled in-conversation before dispatch). Synthesized request:

> Feature: desktop-shell native notifications — `rk notify` reaches the Electron viewer shell, with click-to-navigate to the originating window. `rk notify` delivers via Web Push, which structurally CANNOT reach the shell — push lands in the *browser's* service worker, a separate Chromium instance that cannot see or focus Electron windows — so tapping a notification spawns a browser PWA window while the shell window sits unmoved. The shell holds one persistent `WebContentsView` per visited host with live `/ws/state` sockets, so it can hear notifications in real time; only the delivery-broadcast and click-routing legs are missing. Broadcast a `notify` event over the existing state socket, forward it to the shell over a new `runkitShell` bridge channel `notify:show` (the `badge:set` pattern), show an Electron `Notification`, and on click focus the window, switch to the originating host, and navigate its view to the deep-link path.

Interaction mode: promptless-defer (no questions asked; would-be questions recorded as deferred Unresolved rows — none scored below the Unresolved threshold). All major design legs (transport, producers, gating, bridge channel, click semantics, non-goals, test strategy) were settled in the conversation and are encoded in `## Assumptions`.

**Prerequisite / stacking**: this change BUILDS ON branch `260828-njqa-notify-deep-links` (PR #756, open — the current checkout's HEAD). It consumes the `url` field `handleNotify` gained there (`app/backend/api/push.go`, `notifyDeepLinkPath`). The new change's branch stacks on that branch's HEAD.

## Why

1. **The pain point**: a user watching sessions in the run-kit desktop app (`app/desktop`, the Electron viewer shell) never receives `rk notify` notifications *in the shell*. Web Push delivery wakes the **browser's** service worker — a separate Chromium instance with its own process tree — which cannot see, focus, or navigate Electron windows. Clicking such a notification spawns a browser PWA window at the deep-link target while the shell window the user actually works in sits unmoved. Verified live: the shell user's primary surface is structurally unreachable by the only existing notification channel.

2. **The consequence of not fixing it**: shell users either miss notifications entirely (if they never push-subscribed a browser) or get click-routing into the wrong app (a browser window they don't use), defeating the entire point of `rk notify` — "an agent needs you, tap to get there". As the desktop shell becomes the primary viewing surface, the notification system silently stops serving its most engaged users.

3. **Why this approach**: the shell already holds one persistent `WebContentsView` per visited host, each with a live `/ws/state` socket (memory `run-kit/desktop-shell.md` § Host Views) — the delivery infrastructure exists end-to-end except for two missing legs: (a) the backend never broadcasts a notify over the state socket, and (b) the shell has no channel to surface one natively. Adding a `notify` event to the existing hub (the exact fan-out `version`/`update-available` use) plus a `notify:show` bridge channel (the exact "SPA reports, shell surfaces" pattern `badge:set` established) closes both legs with **no new endpoint (Constitution IX), no persistence (II), no subprocess (I), no polling** — the shell stays a viewer riding existing sockets (VI). Alternatives rejected in-conversation: native push subscription from the shell's own renderer (still lands in a service worker per-origin, doesn't cover multiple hosts, and duplicates the subscription store); a shell-side polling loop (violates the no-polling viewer posture); a new dedicated notification endpoint/socket (IX; the state socket already reaches every host view).

## What Changes

### 1. Backend — broadcast `notify` over the state socket (`app/backend/api/`)

When a notify fans out, ALSO broadcast a `notify` event over the existing `/ws/state` hub, as a **host-global event** (`kind:"global"`, the `version`/`update-available`/`server-order` family — memory `run-kit/architecture.md` § State Socket / § Event-Driven SSE Loop). Payload:

```json
{"op":"event","kind":"global","type":"notify","data":{"title":"RunKit","body":"waiting for input","url":"/utils2/3?view=chat"}}
```

- `title`, `body` — exactly what the push fan-out sends (title already defaulted to `"RunKit"` in `handleNotify`).
- `url` — the **already-validated** same-origin relative deep-link path (possibly empty/omitted): `notifyDeepLinkPath(body.URL)` output on the `/api/notify` path, `waitingPushURL(...)` output on the watcher path. The backend broadcasts only values that passed its existing soft-validation; the shell re-validates before navigating (defense in depth, mirroring the sw.js posture).

**Two producers:**

- **`handleNotify`** (`app/backend/api/push.go`): broadcast alongside the `push.Notify` fan-out. A notify with **zero push subscriptions still broadcasts** (the broadcast is not conditional on push success or subscription count — a shell-only user has no browser subscription at all). The handler needs hub access: follow the established handler→hub wiring — `s.initSSEHub()` then use `s.sseHub` (the exact pattern `handleWindowOptions`/`handleSessionColor` use for `wake()`, and `handleStatusRefresh` uses for `broadcastStatusRefresh`).
- **Sustained-waiting watcher** (`app/backend/api/waiting_push.go`): each decided `waitingPush{title, body, url}` also broadcasts. **The detached-send invariant stays**: the broadcast must never stall the SSE poll loop's documented zero-network hot path. The hub broadcast is an in-memory, non-blocking channel enqueue (`sendConnLocked` drops on a full channel), so it is hot-path-safe by construction; whether it runs synchronously in `notifyWaiting` or inside the existing detached goroutine is a plan-level placement decision — the invariant (no stall, no network on the tick) is the requirement. Add a broadcast seam alongside the existing `notify` fn seam so `waiting_push_test.go`'s stubbed-fn pattern covers it.

**Broadcast implementation**: a new `broadcastNotify(title, body, url string)` on `sseHub` (`app/backend/api/sse.go`), mirroring `broadcastStatusRefresh` — compose the event, `preRendered(ev)` once at the broadcast site (the `260811-sqe7` rule: fan-out events are pre-rendered ONCE), fan out via `broadcastGlobalLocked`. Study how `event: version`/`event: update-available` server-global events fan out on **both stream kinds** per memory `run-kit/architecture.md` § SSE Hub / State Socket and mirror that pattern. **No cached replay slot**: unlike `version`/`update-available`, a notify is an ephemeral in-flight fact — `replayGlobalSlots` does NOT replay it to late subscribers (a notification delivered on reconnect hours later would be noise; Constitution X posture). In-memory broadcast only — no persistence (II), no new endpoint (IX), no new subprocess (I).

### 2. Frontend SPA — shell-gated forwarder (`app/frontend/src/`)

Subscribe to the `notify` global event on the state socket — the SessionContext/StateSocket listener pattern used by `version`/`update-available` (`contexts/session-context.tsx`; listeners added on both stream kinds, applied idempotently, malformed events skipped — memory `run-kit/ui/updates-and-notifications.md` § Context state). Parse tolerantly: `{title?, body?, url?}` strings, missing → `""`.

When running inside the desktop shell (`isShell()`, `lib/shell.ts`), forward `{title, body, url}` over a NEW `runkitShell` bridge channel **`notify:show`** — the exact "SPA reports, shell surfaces" pattern `badge:set` established (memory `run-kit/desktop-shell.md` § Dock/Taskbar Waiting Badge). Concretely:

- `lib/shell.ts` gains a `notify` bridge group wrapper, e.g. `showShellNotification(payload: {title: string; body: string; url: string}): Promise<boolean>` — the standard never-throws contract (plain browser / older shell lacking the group / `{ok:false}` denial / rejected invoke all resolve `false`), covered in `shell.test.ts` alongside the existing present/absent/malformed shape cases.
- The forwarder mounts on `isShell()` (the `ShellBadgeReporter` idiom — `components/shell-badge-reporter.tsx`); whether it is a render-nothing component or a context-level effect is a plan decision, but the gate and payload shape are fixed.
- **Outside the shell: NO behavior change in v1.** Browser users already have Web Push; an in-browser toast for the notify event is a possible future, explicitly **out of scope** (Non-Goal).

### 3. Desktop shell — native notification + click-to-navigate (`app/desktop/src/`)

- **Preload** (`preload.ts`): expose the `notify:show` channel as a thin invoker group (the `badge` group shape).
- **Main** (`main.ts`): handle `notify:show` behind the `isHostsSender` gate (same allowlist as `badge:set`/`servers:*`), with structural payload validation (title/body/url strings — anything else `"Invalid request"`). Resolve the **sender view** via `findViewByWebContentsId` (the badge pattern — sender identity keys the host, since several entries can share an origin; a non-view sender — welcome page, destroyed view's late report — acks and shows nothing).
- **Show** an Electron `Notification` with the forwarded title/body (guard `Notification.isSupported()`, fail-silent). Notifications from **background hosts' views show too** — a shell superpower vs per-origin Web Push. When the reporting host is not the active one, prefix the title with the host name (e.g. `[buildbox] fab operator`) so multi-host users can tell notifications apart (see Assumptions — judgment call from the conversation).
- **On click**: focus the main window; `switchToHost(hostId)` (the single shared switch seam — § Security Wiring); and — when `url` is a non-empty same-origin-safe relative path (**starts with `/`, not `//`**; mirror sw.js's `sameOriginPath` guard shell-side before joining) — navigate that host's view to `host.url + url` (`view.webContents.loadURL(...)`). **Navigation happens ONLY on click, never on receipt** (viewer discipline, Constitution VI — a background notification must not touch the live view). An empty/invalid `url` still focuses + switches (parity with sw.js's fall-back-to-root posture, minus the navigation).
- **Pure-logic module** (electron-free, the views.ts/badge.ts discipline — memory `run-kit/desktop-shell.md` § Package Shape): e.g. `src/notify.ts` owning `notifyNavigationTarget(hostUrl, path): string | null` (the `sameOriginPath`-mirroring join/validation: `/`-prefix, `//`-reject, join against the host origin) and the notification-title composition (active vs background host prefix). Covered by `notify.test.ts` under the existing `node --test "dist/**/*.test.js"` runner. The sender-view routing decision (view lookup → hostId) reuses the already-tested `findViewByWebContentsId`.

### 4. Known overlap, accepted (Non-Goal)

A user whose browser on the same machine is also push-subscribed gets BOTH a browser push and a shell notification for the same event. Dedupe is a per-user choice (unsubscribe the browser on that machine), not code. Recorded as Non-Goal/assumption.

### 5. Tests

- **Backend**: hub broadcast unit test covering both producers — `handleNotify` broadcasts (including the zero-subscription case) and the waiting-push seam broadcasts (the `waiting_push_test.go` stubbed-notify-fn pattern extends to the broadcast seam). Assert the `kind:"global"` / `type:"notify"` envelope and payload shape, and that no cached replay slot is written.
- **Frontend**: unit test for the shell-gated forwarder — the `isShell()` gate (no forward outside the shell), the payload shape, tolerant parse of malformed events; `shell.test.ts` cases for the new bridge group (present/absent/malformed/denied).
- **Desktop**: electron-free pure-logic tests via the existing `node --test` pattern (`app/desktop/src/notify.test.ts`) — `notifyNavigationTarget` join/validation matrix (valid path, empty, `//evil.example`, missing leading `/`, query-carrying path) and title composition (active vs background host).
- **Verification gates** (code-quality.md): Go tests → frontend `tsc --noEmit` + Vitest → `just test` → `just build`; the desktop package's `node --test` suite must stay green.

### 6. Electron Notification support caveat

macOS shows Electron notifications for the packaged, ad-hoc-signed app (the shipped path); an unsigned dev-run `electron .` may not display them. This is a test/verification caveat, not a blocker — pure-logic tests carry the correctness burden; the visual leg is a manual-verify item on the packaged app.

## Affected Memory

- `run-kit/architecture`: (modify) State Socket / SSE Hub event registry gains the `notify` global event (no cached replay slot); the `/api/notify` row gains the broadcast side-effect; § Web Push Notifications gains the shell-delivery sibling paragraph.
- `run-kit/desktop-shell`: (modify) `window.runkitShell` bridge gains the `notify:show` channel row (gate table + group list); a new notification + click-routing section beside § Dock/Taskbar Waiting Badge; Package Shape gains the notify pure-logic module.
- `run-kit/ui/updates-and-notifications`: (modify) § Notifications gains the shell-delivery-leg pointer (the notify event forwarder, shell-gated, browser behavior unchanged).

## Impact

- **Backend**: `app/backend/api/push.go` (handleNotify broadcast), `app/backend/api/waiting_push.go` (broadcast seam beside the notify seam), `app/backend/api/sse.go` (`broadcastNotify`), plus `*_test.go` siblings. No API surface change (no new endpoint, no request/response shape change).
- **Frontend**: `app/frontend/src/contexts/session-context.tsx` (notify event listener), `app/frontend/src/lib/shell.ts` + `shell.test.ts` (bridge group), a forwarder mount (component or effect, `ShellBadgeReporter` idiom).
- **Desktop**: `app/desktop/src/preload.ts`, `main.ts` (IPC handler, Notification, click routing), new `notify.ts` + `notify.test.ts` (electron-free).
- **Protocol**: additive `type:"notify"` on `kind:"global"` — old frontends ignore unknown event types (tolerant demux); old shells lack the `notify` bridge group and the SPA wrapper resolves `false` silently. No version gate needed in either direction.
- **Same branch, same PR** (user-directed): this change is implemented directly on `260828-njqa-notify-deep-links` — no new branch, no second PR. Commits land on PR #756, whose title/body are updated at ship to cover both changes. It consumes the branch's `notifyDeepLinkPath`/`url` plumbing directly.
- **Constraints honored**: Constitution I (no subprocess), II (ephemeral in-memory event, no persistence), VI (shell displays; navigation is user-click-initiated only; no daemon supervision), IX (no new endpoints), X (the notify event is an ephemeral in-flight fact — hooks/carry rules unaffected). Desktop shell stays a viewer: no polling, rides the existing sockets.

## Open Questions

- None — the design was settled in-conversation; all decision points are graded in `## Assumptions` (no row scored Unresolved).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Transport is a `notify` event on the existing `/ws/state` hub as `kind:"global"`, mirroring the `version`/`update-available` fan-out on both stream kinds; no new endpoint, no persistence, no polling | Discussed — settled in conversation; Constitution II/IX and the architecture memory's server-global pattern determine it | S:95 R:80 A:95 D:90 |
| 2 | Certain | Two producers: `handleNotify` (broadcasts even with zero push subscriptions, independent of push errors) and the sustained-waiting watcher (detached-send invariant preserved — broadcast never stalls the SSE poll hot path) | Discussed — both producers and the zero-subscription + hot-path invariants were explicit | S:95 R:80 A:90 D:90 |
| 3 | Certain | Payload is `{title, body, url}` where `url` is the already-backend-validated same-origin relative path (possibly empty); shell re-validates before navigating | Discussed — mirrors the existing push payload and sw.js defense-in-depth posture | S:95 R:85 A:90 D:95 |
| 4 | Certain | SPA forwarder is `isShell()`-gated; outside the shell there is NO behavior change in v1 (in-browser toast is an explicit Non-Goal) | Discussed — user explicitly scoped browser behavior out of v1 | S:95 R:90 A:90 D:90 |
| 5 | Certain | New bridge channel `notify:show` follows the `badge:set` pattern end-to-end: `isHostsSender` gate, structural payload validation, sender view resolved via `findViewByWebContentsId` (sender identity keys the host — origins can be shared) | Discussed — the "SPA reports, shell surfaces" pattern was named as the template | S:90 R:80 A:90 D:90 |
| 6 | Certain | Navigation happens ONLY on notification click, never on receipt; click = focus window → `switchToHost(hostId)` → navigate the host's view to `host.url + url` when the path passes the shell-side `sameOriginPath` mirror (`/`-prefix, not `//`) | Discussed — viewer discipline (Constitution VI) and the sw.js guard were explicit requirements | S:95 R:75 A:90 D:90 |
| 7 | Certain | Dual delivery (browser Web Push + shell notification on the same machine, same event) is accepted; dedupe is a per-user choice, not code — Non-Goal | Discussed — user explicitly accepted the overlap | S:90 R:80 A:85 D:90 |
| 8 | Certain | Backend broadcast is a `broadcastNotify` on `sseHub` via `broadcastGlobalLocked` + `preRendered`, with handler access through the established `s.initSSEHub()`/`s.sseHub` wiring (`handleWindowOptions`/`broadcastStatusRefresh` precedent) | Codebase gives one clear answer — the wake/status-refresh handlers already model handler→hub access | S:75 R:85 A:90 D:85 |
| 9 | Confident | No cached replay slot for `notify` — late subscribers/reconnects never receive past notifications (unlike `version`/`update-available`, which replay) | Not explicitly discussed; an ephemeral attention signal replayed on reconnect would be stale noise, and Constitution X's ephemeral-in-flight framing supports it; easily reversed | S:55 R:85 A:80 D:75 |
| 10 | Confident | When the reporting host is not the active one, the notification title is prefixed with the host name (e.g. `[buildbox] …`); active-host notifications carry no prefix | Discussed as a judgment call ("consider prefixing… record as an assumption"); trivially reversible, front-runner option (title over body — titles are the scannable line) | S:55 R:90 A:60 D:55 |
| 11 | Confident | No focus/visibility suppression in v1 — the notification shows even when the shell window is focused on the originating host | Not discussed; mirrors Web Push behavior (OS notifications show regardless of tab focus) and keeps v1 simple; trivially added later | S:40 R:90 A:65 D:60 |
| 12 | Confident | Electron `Notification.isSupported()` guards the show; unsupported/failed show is fail-silent (no error surface), matching the notify chain's end-to-end fail-silent discipline | Codebase discipline (fail-silent notify posture) gives the answer; not user-visible when it works | S:60 R:90 A:85 D:80 |
| 13 | Certain | Test strategy: backend hub-broadcast unit tests (both producers, stubbed-seam pattern), frontend forwarder + bridge-wrapper unit tests, desktop electron-free `node --test` pure-logic tests (`notifyNavigationTarget`, title composition); packaged-app visual check is a manual-verify caveat (unsigned dev-run may not display) | Discussed, and code-quality.md + the desktop package's documented electron-free module discipline determine it | S:90 R:85 A:90 D:90 |
| 14 | Certain | This change is implemented ON branch `260828-njqa-notify-deep-links` itself (user-directed): no new branch, no second PR — commits land on PR #756, whose title/body grow to cover both changes; it consumes the branch's `url`/`notifyDeepLinkPath` plumbing directly | User explicitly directed same-branch/same-PR after the intake dispatch; supersedes the earlier stacked-branch plan | S:95 R:70 A:90 D:90 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
