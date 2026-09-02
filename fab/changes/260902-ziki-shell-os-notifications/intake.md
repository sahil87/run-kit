# Intake: Shell OS Notifications

**Change**: 260902-ziki-shell-os-notifications
**Created**: 2026-09-02

## Origin

Conversational (`/fab-discuss` session, 2026-09-02). The user reported:

> Nothing happens clicking on "Enable Notifications" on the desktop app (it works when using run-kit from chrome).

Root cause established in the discussion: the settings dialog's Notifications row calls `enablePushSubscription()` (`app/frontend/src/lib/push.ts:145`). In the Electron shell the flow passes every guard — secure context (`http://127.0.0.1`), `PushManager` present, `Notification.requestPermission()` resolves `"granted"` (the shell's `setPermissionRequestHandler` allowlists `notifications`, `app/desktop/src/main.ts:171`), the service worker registers — and then **`reg.pushManager.subscribe(...)` rejects**, because Electron ships Chromium without a push-service backend (no FCM wiring). The `catch` at `push.ts:180` returns `"default"`, which the hook's quiet branch (`use-push-subscription.ts:52`, reserved for "user dismissed the prompt") renders as literally nothing. Web Push is structurally impossible in the shell; no run-kit change can make `PushManager` work there.

Two directions were presented; the user chose **direction 2**: give the shell its own delivery path instead of merely surfacing the dead-end. Key decisions from the discussion:

- The shell doesn't need Web Push's core trick (waking a closed tab): host views are **persistent renderers with live state sockets** (the Slack multi-workspace model — views stay alive across host switches).
- Delivery rides the existing server-side notify fan-out, surfaced as a new event on the existing `/ws/state` socket.
- The SPA shows OS notifications directly via `new Notification()` (works in Electron renderers; the permission is already allowlisted shell-side), gated on `isShell()`.
- The shell stays a pure viewer — prefer zero new IPC.
- The gap that remains (no delivery while the desktop app is fully quit) is acceptable: nothing can deliver then anyway.

## Why

1. **Pain point**: the desktop shell — the product's flagship keyboard-first surface — cannot receive notifications at all, and its "Enable" button is a silent dead-end. `rk notify` and the sustained-waiting watcher (the most notification-worthy signal: an agent blocked on a human) reach Chrome users but not shell users.
2. **Consequence of not fixing**: shell users miss agent-waiting pushes entirely and lose trust in the Enable control ("nothing happens" is the worst failure mode — it looks broken because it is). The shell is meant to be the primary surface; notification parity is table stakes.
3. **Why this approach**: Web Push in Electron is a dead end (no push service; third-party FCM receivers would add a Google dependency and heavyweight machinery). The shell's persistent views mean an ordinary socket event + renderer-side `new Notification()` covers every case Web Push covers except "app fully quit" — where no mechanism could deliver anyway. It reuses the existing notify fan-out and state-socket infrastructure end to end: one new broadcast on the backend, one gated consumer on the frontend, zero new IPC in the shell.

## What Changes

### Backend: `notify` global event on the state hub

A new host-global event on the `/ws/state` stream (the retired-SSE envelope, `app/backend/api/sse.go`), following the `broadcastUpdateAvailable` pattern (`sse.go:1025`):

- **Event shape**: kind `global`, type `notify`, payload `{"id": "<random>", "title": "...", "body": "...", "url": "..."}` (`url` empty/omitted when none — same contract as the Web Push payload). `id` is a per-event random token (e.g. 8+ hex chars) so multiple views of the same host can dedupe.
- **Broadcast helper**: `broadcastNotify(title, body, url string)` on the hub — marshal once, `broadcastGlobalLocked` to all state connections. **No cache slot, no replay**: unlike `version`/`update-available`, a notification is a moment-in-time signal; `replayGlobalSlots` must NOT deliver stale notifications to late-connecting clients.
- **Call sites** (both existing notify producers):
  - `handleNotify` (`api/push.go:54`) — after (or alongside) `push.Notify`, also broadcast on the hub. The `{"sent": N}` response contract stays Web-Push-only (rk notify's fail-silent posture is unchanged).
  - The sustained-waiting watcher (`api/waiting_push.go:86`) — broadcast with the same title/body and its deep-link `url` (`/{server}/{N}?view=chat` for chat-capable windows).
- Both call sites and the hub live in `api`, so wiring is direct (the handler and watcher already hold the server/hub references — confirm exact plumbing at apply).

### Frontend: shell-gated OS-notification consumer

A new `isShell()`-gated consumer of the global `notify` event (the state-socket demux already delivers global events to the session-context seam; wire the consumer where other global events like `update-available` are handled):

- **Gate**: `isShell()` (`src/lib/shell.ts:76`) AND the per-viewer opt-in pref (below). Plain browsers ignore the event entirely — Web Push already covers them, and a socket-driven notification would double-notify an open Chrome tab.
- **Display**: `new Notification(title, { body, icon })` directly from the renderer — no service worker involved. Electron renders it as a real OS notification; the shell's permission handler already grants it. (macOS may still show its own per-app notification prompt on first use — that is OS-level and expected.)
- **Click**: focus the app and deep-link. Navigate via the SPA router to the payload's `url` (same-origin-path validation mirroring `sw.js`'s `sameOriginPath`: must start with `/`, not `//`). Focusing the Electron window from a renderer `Notification.onclick` may need a tiny bridge channel (`shell:focus-window`) if `window.focus()` doesn't raise the BrowserWindow — decide at apply after testing; prefer zero new IPC.
- **Dedupe**: the same host shown in N windows means N live renderers each receiving the event. Views share the origin's localStorage (one Electron session), so claim-by-id: on receipt, check/set a `runkit-notify-claim-<id>` key; the loser(s) skip. Claims are tiny and self-expiring (prune old claim keys opportunistically).

### Frontend: opt-in state and the Enable/Test surfaces in shell mode

Per Constitution IV, per-viewer state lives in localStorage:

- **Pref**: a localStorage key (e.g. `runkit-shell-notifications`, values `"on"`/absent) — default **off**, mirroring the web's explicit-opt-in posture.
- **`use-push-subscription.ts` / `lib/push.ts` fork on `isShell()`**: in shell mode, `getPushState()`-equivalent state derives from the pref (`"subscribed"` ⇔ pref on — reusing the existing `PushState` vocabulary so the settings row and palette actions render unchanged); `enable()` flips the pref on (no permission dance, no PushManager) and toasts success; `sendTest()` fires a direct `new Notification()` (no service worker) and toasts. The existing Web Push flow is untouched for browsers.
- **Settings row & palette**: the same two surfaces (`settings-dialog.tsx` NotificationsControl, the palette actions) now work in the shell via the fork — "Notifications: Enable push" label may become mode-aware (e.g. "Enable notifications" in shell); exact copy at apply. The sublabel "Web Push to this browser" should say what's true in shell (e.g. "OS notifications from this app").
- **The silent dead-end dies structurally**: in shell the Web Push flow is never attempted, so the silent `"default"` branch can no longer be reached there. (Improving the browser-side subscribe-failure toast is out of scope — direction 1 was explicitly not chosen.)

### Non-goals

- No delivery while the desktop app is fully quit (nothing can deliver then).
- No change to the Web Push path for browsers (SW, VAPID, subscription store all untouched).
- No main-process `Notification` (Electron's `new Notification()` from main) — the renderer path keeps the shell a viewer and reuses SPA routing for clicks.
- No browser-side socket notifications (open Chrome tabs keep Web Push only).
- No notification history/center UI.

## Affected Memory

- `run-kit/pwa-and-push.md`: (modify) the notify fan-out gains a second delivery leg (state-hub broadcast); document the shell-vs-browser split and the unchanged Web Push contract
- `run-kit/api-and-sockets.md`: (modify) new host-global `notify` event on `/ws/state` — shape, no-replay semantics, broadcast helper
- `run-kit/ui/updates-and-notifications.md`: (modify) § Notifications — the shell fork of the opt-in flow, localStorage pref, dedupe claim, test-notification path
- `run-kit/desktop-shell.md`: (modify, conditional) only if a `shell:focus-window` bridge channel is added for notification click-focus

## Impact

- **Backend**: `app/backend/api/sse.go` (broadcast helper), `api/push.go` (handleNotify call site), `api/waiting_push.go` (watcher call site) + Go tests alongside.
- **Frontend**: `src/lib/push.ts` or a sibling `lib/shell-notifications.ts` (shell fork + display + dedupe), `src/hooks/use-push-subscription.ts` (mode fork), the global-event consumer seam (wherever `update-available` is consumed), `settings-dialog.tsx` copy. Vitest units for the fork/dedupe/validation; e2e where feasible (the socket event can be exercised in a browser context even though `isShell()` gating needs a stubbed shell marker).
- **Desktop**: possibly `src/preload.ts` + `main.ts` for one `shell:focus-window` channel (conditional).
- **Docs**: memory updates per Affected Memory at hydrate; `docs/specs/api.md` event inventory may warrant a row (hydrate-specs territory).

## Open Questions

- None blocking — click-focus mechanism and dedupe details are graded Tentative below and decided at apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Transport is a new host-global `notify` event on the existing `/ws/state` socket, modeled on `broadcastUpdateAvailable` | Discussed — user chose the SSE/state-socket direction explicitly; exact pattern exists in sse.go | S:90 R:85 A:95 D:90 |
| 2 | Certain | Both notify producers broadcast: `handleNotify` and the sustained-waiting watcher | The waiting watcher is the primary real-world producer; covering only /api/notify would miss the main use case | S:85 R:90 A:90 D:85 |
| 3 | Confident | No cache slot / no replay for `notify` events (late-connecting clients never see old notifications) | Notifications are moment-in-time; replaying them would duplicate OS alerts on every reconnect | S:70 R:85 A:90 D:85 |
| 4 | Confident | Shell opt-in is a per-viewer localStorage pref, default off, surfaced through the existing Enable button/palette via a `isShell()` fork reusing the `PushState` vocabulary | Constitution IV places per-viewer state in localStorage; default-off mirrors the web opt-in posture | S:75 R:80 A:85 D:75 |
| 5 | Confident | Browsers ignore the socket event entirely (Web Push remains their only path) | An open tab would otherwise double-notify (push + socket); gating on isShell() is the clean split | S:75 R:85 A:90 D:85 |
| 6 | Confident | Display via renderer `new Notification()`, no service worker, no main-process Notification | Keeps the shell a pure viewer, zero new IPC for display; permission already allowlisted in main.ts | S:80 R:75 A:85 D:75 |
| 7 | Tentative | Cross-window dedupe via localStorage claim-by-id (`runkit-notify-claim-<id>`), racy-but-benign | Same-host views share origin storage; a rare double notification is acceptable; simpler than any coordination channel | S:55 R:80 A:60 D:45 |
| 8 | Tentative | Notification click focuses the window via `window.focus()`, adding a `shell:focus-window` bridge channel only if that proves insufficient | Electron renderer-focus behavior needs empirical testing; both options are cheap and reversible at apply | S:45 R:75 A:50 D:40 |
| 9 | Confident | Deep-link URLs from the payload are validated with the `sw.js` `sameOriginPath` rule before navigating | Same hostile-payload concern the SW already defends against; reuse the proven rule | S:70 R:85 A:90 D:85 |

9 assumptions (2 certain, 5 confident, 2 tentative, 0 unresolved).
