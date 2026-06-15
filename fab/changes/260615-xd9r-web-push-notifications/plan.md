# Plan: Web Push Notifications for the run-kit Web UI

**Change**: 260615-xd9r-web-push-notifications
**Intake**: `intake.md`

## Requirements

### Backend: VAPID Keypair & Persistence

#### R1: VAPID keypair generated once and persisted under `~/.rk/`
The server SHALL own a VAPID keypair persisted as JSON at `~/.rk/vapid.json` (`{"public": "...", "private": "..."}`). The keypair MUST be generated lazily on first need if the file is absent, written atomically, with the file mode `0600` (the private key never leaves the server). On subsequent loads the persisted keypair MUST be reused, not regenerated. No database is used (Constitution §II).

- **GIVEN** no `~/.rk/vapid.json` exists
- **WHEN** the VAPID public key is first requested
- **THEN** a keypair is generated via `webpush.GenerateVAPIDKeys()`, persisted to `~/.rk/vapid.json` with mode `0600`, and the public key returned
- **AND** a second request reuses the persisted keypair without regenerating

#### R2: Subscription store persisted under `~/.rk/`
Push subscriptions SHALL persist as a JSON array at `~/.rk/push-subscriptions.json`. Subscriptions MUST be de-duplicated by `endpoint` (a re-subscribe with the same endpoint replaces, not appends). The store MUST tolerate a missing/empty/corrupt file by treating it as an empty list (no error surfaced to the read path).

- **GIVEN** the subscription store is empty
- **WHEN** a `PushSubscription` is added
- **THEN** it is written to `~/.rk/push-subscriptions.json` as a one-element array
- **AND** adding a subscription whose `endpoint` already exists replaces the existing entry rather than appending a duplicate

### Backend: HTTP Endpoints

#### R3: `GET /api/push/vapid-public-key` returns the public key
A `GET` endpoint SHALL return the VAPID public key (base64url) as JSON `{"key": "..."}` for the frontend to use as `applicationServerKey`. It MUST lazily generate-and-persist the keypair if absent (R1). Reads use `GET` per Constitution §IX.

- **GIVEN** the server is running
- **WHEN** the client `GET`s `/api/push/vapid-public-key`
- **THEN** the response is `200` with JSON `{"key": "<base64url public key>"}`

#### R4: `POST /api/push/subscribe` stores a subscription
A `POST` endpoint SHALL accept a `PushSubscription` JSON body (`{endpoint, keys:{p256dh, auth}}`), validate its shape (non-empty `endpoint` and keys), and store it de-duplicated by endpoint (R2). It MUST bound the request body size and reject malformed JSON with `400`. Mutations use `POST` per Constitution §IX.

- **GIVEN** a valid `PushSubscription` body
- **WHEN** the client `POST`s `/api/push/subscribe`
- **THEN** the subscription is stored (de-duped by endpoint) and the response is `200` `{"status":"ok"}`
- **AND** a body with an empty `endpoint` or missing keys returns `400`

#### R5: `POST /api/notify` fans out a push to all subscriptions
A `POST` endpoint SHALL accept `{title?, body}`, build a JSON push payload `{title, body, icon}` (icon defaulting to `/generated-icons/icon-192.png`), and send it to ALL stored subscriptions via `webpush.SendNotificationWithContext` signed with the server's VAPID private key, under a bounded context timeout. On a `404`/`410` response from a push service for a subscription, that dead subscription MUST be pruned from the store. It returns a small summary `{sent, pruned}` JSON (the CLI ignores the body). `body` MUST be non-empty; an empty body returns `400`. Mutations use `POST` per Constitution §IX.

- **GIVEN** two stored subscriptions, one of which the push service answers `410`
- **WHEN** the client `POST`s `/api/notify` with `{"body":"hello"}`
- **THEN** a push is attempted for both, the `410` subscription is pruned from the store, and the response summarizes `{sent:1, pruned:1}`
- **AND** an empty `body` returns `400` without sending

### Backend: Router Wiring

#### R6: Push routes registered with correct verbs; CORS unchanged
The three routes SHALL be registered in `app/backend/api/router.go` alongside existing `/api/*` routes — `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/notify`. The CORS `AllowedMethods` allowlist MUST remain `[GET, POST, OPTIONS]` (Constitution §IX).

- **GIVEN** the router is built
- **WHEN** routes are inspected
- **THEN** the three push routes are present with the verbs above and CORS `AllowedMethods` is unchanged `[GET, POST, OPTIONS]`

### CLI: `rk notify`

#### R7: `rk notify <message> [--title]` posts to the local server
A new cobra command `rk notify <message>` with an optional `--title` flag SHALL resolve the local server base URL via `config.Load()` (`RK_HOST`/`RK_PORT`, default `127.0.0.1:3000`, exactly as `context.go`) and `POST` `{title, body}` to `{base}/api/notify` under a short context timeout (5–10s). It MUST be registered on `rootCmd`.

- **GIVEN** a reachable local server
- **WHEN** the user runs `rk notify "deploy done" --title "CI"`
- **THEN** the command `POST`s `{"title":"CI","body":"deploy done"}` to `http://127.0.0.1:3000/api/notify`

#### R8: `rk notify` is fail-silent
`rk notify` MUST exit 0 and surface nothing on its stdout/stderr when the server is unreachable, the POST errors, the response is non-2xx, or the request times out. A notify failure MUST NEVER stall the caller (operator loop).

- **GIVEN** no local server is running
- **WHEN** the user runs `rk notify "msg"`
- **THEN** the command exits 0 with no output
- **AND** a non-2xx response also yields exit 0 with no output

### Discoverability

#### R9: `rk notify` surfaced in `rk context`
`writeCapabilities` in `app/backend/cmd/rk/context.go` SHALL emit an `rk notify` line under the CLI Commands listing so agents discover the channel via `rk context`. The existing golden tests (`context_test.go`) MUST be updated to expect it.

- **GIVEN** `rk context` is run
- **WHEN** the Capabilities section is rendered
- **THEN** a line documenting `rk notify` appears in the CLI Commands listing

### Frontend: Service Worker

#### R10: Service worker at origin root handles `push` and `notificationclick`
A service worker SHALL be served at `/sw.js` (origin-root scope) — `app/frontend/public/sw.js`. Its `push` handler MUST parse the JSON payload `{title, body, icon?}` and call `self.registration.showNotification(title, {body, icon})`, defaulting `icon` to `/generated-icons/icon-192.png`, and tolerate a non-JSON / empty payload (fall back to a default title/body). Its `notificationclick` handler MUST focus an existing RunKit client if one is open, else open a new window at `/`.

- **GIVEN** the service worker is registered
- **WHEN** a `push` event arrives with `{"title":"CI","body":"done"}`
- **THEN** an OS notification with that title/body and the default icon is shown
- **AND** clicking the notification focuses an open RunKit tab or opens `/`

#### R11: Service worker registered on app load, guarded
The frontend SHALL register `/sw.js` on app load via `navigator.serviceWorker.register('/sw.js')`, guarded by `'serviceWorker' in navigator`, so environments without service-worker support (or insecure contexts) silently skip registration without error.

- **GIVEN** a browser with service-worker support in a secure context
- **WHEN** the app loads
- **THEN** `/sw.js` is registered
- **AND** in a browser without `serviceWorker` support, registration is skipped silently with no thrown error

### Frontend: Subscription Flow

#### R12: Cmd+K palette entry drives the opt-in gesture
The push opt-in SHALL be a command-palette (`Cmd+K`) entry (e.g. `Notifications: Enable push`). Selecting it MUST call `Notification.requestPermission()`; on `granted`, fetch the VAPID public key from `/api/push/vapid-public-key`, call `registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`, and `POST` the resulting subscription JSON to `/api/push/subscribe`. This satisfies Constitution §V (keyboard-first) and §IV (no new route/settings page). If permission is denied or the context is insecure / unsupported, the flow MUST abort silently (a toast is acceptable) without throwing.

- **GIVEN** the user opens the command palette and selects the enable-push entry
- **WHEN** permission is granted
- **THEN** the browser subscribes via `pushManager.subscribe` with the fetched VAPID key and the subscription is POSTed to `/api/push/subscribe`
- **AND** when permission is denied or push is unsupported, the flow aborts without error and no subscription is sent

#### R13: Subscription-state indicator is terminal-themed, never a bell
Any visible indicator of subscription state MUST be terminal-themed (a glyph/prompt-style marker fitting run-kit's aesthetic) and MUST NOT be a bell icon (explicit user decision). The palette label itself SHALL reflect state (e.g. `Notifications: Enable push` vs `Notifications: Enabled`). A bell icon is prohibited.

- **GIVEN** the user has subscribed to push
- **WHEN** the subscription-state indicator renders
- **THEN** it uses a terminal-themed affordance (text/glyph), not a bell icon

### Docs

#### R14: README + docs document `rk notify` and the secure-context constraint
`README.md` and `docs/` SHALL document the `rk notify` command, the opt-in subscription flow, and the secure-context constraint (Web Push requires HTTPS **or** `localhost`).

- **GIVEN** a reader of the docs
- **WHEN** they look up notifications
- **THEN** they find `rk notify` usage and a note that Web Push requires a secure context (HTTPS or localhost)

### Non-Goals

- No `POST /api/push/unsubscribe` endpoint in v1 — dead subscriptions are pruned server-side on 404/410 during send (the optional unsubscribe in the intake is deferred).
- No multi-user/per-user subscription partitioning — single-user box assumed.
- No retry/queue for failed sends — fire synchronously under a bounded timeout, prune on dead, move on.
- No in-page (tab-open) Notification fallback — Web Push is the only delivery path.

### Design Decisions

1. **Synchronous fan-out with bounded timeout in `/api/notify`**: send to all subscriptions in-loop under a per-request context timeout, prune dead ones, return a summary. — *Why*: simplest correct model for a single-user box; matches Process Execution timeout norms. — *Rejected*: fire-and-forget background queue (unneeded complexity, no durability requirement).
2. **New `internal/push` package mirrors `internal/settings`**: package owns both `~/.rk/vapid.json` and `~/.rk/push-subscriptions.json` with `Load`/`Save` helpers. — *Why*: established `~/.rk/` filesystem-state pattern (Constitution §II). — *Rejected*: a DB / external store (Constitution §II prohibits).
3. **Self-contained frontend push module + hook**: a `usePushSubscription` hook plus a `pushActions` PaletteAction builder, threaded into `app.tsx`'s `paletteActions` — avoids entangling with AppShell's heavily-coupled SSE state. — *Why*: minimal blast radius, matches the existing per-family palette-action pattern. — *Rejected*: inlining all logic into `app.tsx` (already 1600 lines, high coupling).

## Tasks

### Phase 1: Setup

- [x] T001 Add `github.com/SherClockHolmes/webpush-go` to `app/backend/go.mod` (run `go get github.com/SherClockHolmes/webpush-go@v1.4.0` and `go mod tidy`) <!-- R5 -->

### Phase 2: Core Implementation (Backend)

- [x] T002 Create `app/backend/internal/push/store.go`: VAPID keypair persistence (`~/.rk/vapid.json`, mode 0600, lazy generate via `webpush.GenerateVAPIDKeys`, reuse on reload) and subscription store (`~/.rk/push-subscriptions.json`, de-dupe by endpoint, tolerant load). Mirror `internal/settings` patterns. <!-- R1 R2 -->
- [x] T003 [P] Create `app/backend/internal/push/store_test.go`: unit tests for keypair generate-once/reuse, subscription add/de-dupe/replace, and tolerant load of missing/corrupt store (use `t.Setenv("HOME", t.TempDir())`). <!-- R1 R2 -->
- [x] T004 Create `app/backend/internal/push/send.go`: `Notify(ctx, store, title, body)` that builds the `{title,body,icon}` JSON payload (icon default `/generated-icons/icon-192.png`), fans out via `webpush.SendNotificationWithContext` under a bounded timeout, prunes subscriptions on 404/410, returns `{sent, pruned}`. <!-- R5 -->
- [x] T005 Create `app/backend/api/push.go`: handlers `handlePushVAPIDPublicKey` (GET), `handlePushSubscribe` (POST, validate shape, bound body), `handleNotify` (POST, validate non-empty body, call push.Notify, return summary). Mirror `api/settings.go` style. <!-- R3 R4 R5 -->
- [x] T006 [P] Create `app/backend/api/push_test.go`: handler tests for vapid-key GET shape, subscribe validation (400 on empty endpoint / bad JSON), notify 400 on empty body. <!-- R3 R4 R5 -->
- [x] T007 Register the three push routes in `app/backend/api/router.go` `buildRouter` (`r.Get("/api/push/vapid-public-key", ...)`, `r.Post("/api/push/subscribe", ...)`, `r.Post("/api/notify", ...)`); confirm CORS `AllowedMethods` stays `[GET, POST, OPTIONS]`. <!-- R6 -->

### Phase 3: Core Implementation (CLI)

- [x] T008 Create `app/backend/cmd/rk/notify.go`: `notifyCmd` (`rk notify <message>`, `--title` flag) resolving base URL via `config.Load()`, POSTing `{title,body}` to `{base}/api/notify` under a 5–10s context timeout, fail-silent (exit 0 on any error / non-2xx / timeout, no output). <!-- R7 R8 -->
- [x] T009 Register `notifyCmd` on `rootCmd` in `app/backend/cmd/rk/root.go`. <!-- R7 -->
- [x] T010 [P] Create `app/backend/cmd/rk/notify_test.go`: tests for command registration, body/title marshaling against an `httptest` server, and fail-silent exit-0 on unreachable server / non-2xx. <!-- R7 R8 -->
- [x] T011 Add an `rk notify` line to `writeCapabilities` in `app/backend/cmd/rk/context.go` (CLI Commands listing), and update `context_test.go` to assert it. <!-- R9 -->

### Phase 4: Core Implementation (Frontend)

- [x] T012 [P] Create `app/frontend/public/sw.js`: `push` handler (parse `{title,body,icon?}`, default icon `/generated-icons/icon-192.png`, tolerate empty/non-JSON) → `showNotification`; `notificationclick` handler (focus existing client or open `/`). <!-- R10 -->
- [x] T013 Create `app/frontend/src/lib/push.ts`: `registerServiceWorker()` (guarded by `'serviceWorker' in navigator`) and `enablePushSubscription()` (requestPermission → fetch VAPID key → pushManager.subscribe → POST to `/api/push/subscribe`), plus `getPushState()` helper; all paths fail silently/throw-free. <!-- R11 R12 -->
- [x] T014 [P] Add API client functions in `app/frontend/src/api/client.ts`: `getVapidPublicKey()` (GET `/api/push/vapid-public-key`) and `subscribePush(sub)` (POST `/api/push/subscribe`). <!-- R12 -->
- [x] T015 Register the service worker on app load: call `registerServiceWorker()` from `app/frontend/src/main.tsx` (guarded, fire-and-forget). <!-- R11 -->
- [x] T016 Create `app/frontend/src/hooks/use-push-subscription.ts`: a hook exposing `{state, enable}` and a `pushActions` PaletteAction builder; thread the actions into `paletteActions` in `app/frontend/src/app.tsx`. Label reflects state (`Notifications: Enable push` / `Notifications: Enabled`) — terminal-themed text, no bell. <!-- R12 R13 -->

### Phase 5: Polish

- [x] T017 [P] Create `app/frontend/src/lib/push.test.ts`: unit tests for the guarded registration no-op (no `serviceWorker`), denied-permission abort, and successful subscribe flow (mock `Notification`, `navigator.serviceWorker`, fetch). <!-- R11 R12 -->
- [x] T018 Update `README.md` and `docs/` to document `rk notify`, the opt-in palette flow, and the HTTPS-or-localhost secure-context constraint. <!-- R14 -->

## Execution Order

- T001 blocks T002, T004 (webpush import)
- T002 blocks T004, T005 (store types/funcs)
- T005 blocks T007 (handlers before routes)
- T008 blocks T009, T010
- T013, T014 block T016; T013 blocks T015
- T012, T014, T017 are `[P]` within their phases

## Acceptance

### Functional Completeness

- [ ] A-001 R1: A VAPID keypair is generated once on first need, persisted to `~/.rk/vapid.json` at mode `0600`, and reused on subsequent loads (unit test proves generate-once/reuse).
- [ ] A-002 R2: Subscriptions persist to `~/.rk/push-subscriptions.json`, de-duped by endpoint, with tolerant load of missing/corrupt files (unit test).
- [ ] A-003 R3: `GET /api/push/vapid-public-key` returns `200` with `{"key": "..."}` (handler test).
- [ ] A-004 R4: `POST /api/push/subscribe` stores a valid subscription and returns `400` on empty endpoint / malformed JSON (handler test).
- [ ] A-005 R5: `POST /api/notify` fans out to all subscriptions, prunes 404/410 dead entries, returns `{sent,pruned}`, and `400`s an empty body.
- [ ] A-006 R6: The three push routes are registered with `GET`/`POST`/`POST` verbs and CORS `AllowedMethods` is unchanged `[GET, POST, OPTIONS]`.
- [ ] A-007 R7: `rk notify <message> [--title]` is registered and POSTs `{title,body}` to `{base}/api/notify` resolved via `RK_HOST`/`RK_PORT` (test against httptest server).
- [ ] A-008 R9: `rk context` output includes an `rk notify` line (golden test updated).
- [ ] A-009 R10: `sw.js` `push` handler shows a notification from `{title,body,icon?}` and `notificationclick` focuses/opens a client.
- [ ] A-010 R11: The service worker is registered on app load, guarded by `'serviceWorker' in navigator`.
- [ ] A-011 R12: A `Cmd+K` palette entry runs the requestPermission → subscribe → POST flow.
- [ ] A-012 R14: README/docs document `rk notify` and the secure-context constraint.

### Behavioral Correctness

- [ ] A-013 R8: `rk notify` exits 0 with no output when the server is unreachable, errors, returns non-2xx, or times out (test).
- [ ] A-014 R12: When permission is denied or push is unsupported/insecure, the subscribe flow aborts without throwing and sends no subscription.

### Edge Cases & Error Handling

- [ ] A-015 R5: A subscription that the push service answers `410`/`404` is pruned from the store; remaining subscriptions are unaffected.
- [ ] A-016 R10: The `sw.js` `push` handler tolerates an empty / non-JSON payload (falls back to default title/body) without throwing.

### Code Quality

- [ ] A-017 Pattern consistency: New Go code follows `internal/settings` persistence and `api/settings.go` handler patterns; new CLI follows existing cobra style; frontend follows existing palette-action / api-client patterns.
- [ ] A-018 No unnecessary duplication: Server URL resolution reuses `config.Load()`; persistence reuses the `~/.rk/` idiom; no reimplementation of existing utilities.

### Security

- [ ] A-019 R1: The VAPID private key file is mode `0600` and the private key is never returned to any client (only the public key is served).
- [ ] A-020 R4: The subscribe and notify endpoints validate JSON shape and bound request body size; no subprocess execution is introduced.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery is browser Web Push (service worker + VAPID + PushManager) via `webpush-go` | Intake assumptions 1–2 pin this; only mechanism delivering when the tab is closed | S:98 R:70 A:95 D:95 |
| 2 | Certain | All mutations `POST` (`/api/push/subscribe`, `/api/notify`), key fetch `GET`; CORS stays `[GET, POST, OPTIONS]` | Constitution §IX is deterministic | S:90 R:75 A:100 D:100 |
| 3 | Certain | VAPID keypair + subscriptions persist as JSON under `~/.rk/` (vapid.json 0600, push-subscriptions.json), no DB | Constitution §II + established `internal/settings` pattern | S:88 R:65 A:100 D:92 |
| 4 | Certain | `rk notify` resolves base URL via `config.Load()` (`RK_HOST`/`RK_PORT`, default `127.0.0.1:3000`) and is fail-silent (exit 0, no output) on any failure | Intake assumptions 5–6; existing `context.go` pattern; operator-loop requirement | S:93 R:80 A:95 D:95 |
| 5 | Confident | `/api/notify` sends synchronously under a bounded timeout and prunes dead subs on 404/410; CLI ignores the response body | Intake assumption 7; simplest correct single-user model | S:70 R:75 A:80 D:75 |
| 6 | Confident | Push payload JSON is `{title, body, icon?}`; SW defaults icon to `/generated-icons/icon-192.png` | Intake assumption 8; manifest already ships that icon | S:72 R:90 A:85 D:80 |
| 7 | Confident | Service worker lives at `app/frontend/public/sw.js`, registered from `main.tsx` on app load guarded by `'serviceWorker' in navigator` | Intake assumption 10; `main.tsx` is the confirmed bootstrap entry (renders RouterProvider) | S:80 R:85 A:88 D:85 |
| 8 | Confident | Opt-in is a `Cmd+K` palette entry (`Notifications: …`); state shown via terminal-themed label, no bell icon | Intake assumption 11 (user-resolved); palette satisfies §IV/§V | S:85 R:60 A:88 D:82 |
| 9 | Confident | webpush-go pinned at v1.4.0 (latest); `SendNotificationWithContext` used for the per-request timeout | Latest stable; context variant is the timeout-aware API verified in the module source | S:75 R:90 A:85 D:80 |
| 10 | Confident | No `/api/push/unsubscribe` in v1; dead subs pruned server-side on send | Intake marks unsubscribe optional; prune-on-send keeps the store clean without a client round-trip | S:70 R:85 A:80 D:78 |
| 11 | Tentative | Frontend push logic lives in a self-contained `lib/push.ts` + `use-push-subscription.ts` hook threaded into `app.tsx`'s `paletteActions`, rather than inlined | `app.tsx` is 1600 lines with tight SSE coupling; a separate module is lower-risk, but the exact wiring seam is an apply-time judgement | S:60 R:75 A:70 D:60 |

11 assumptions (4 certain, 6 confident, 1 tentative).
