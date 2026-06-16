# Intake: Web Push Notifications for the run-kit Web UI

**Change**: 260615-xd9r-web-push-notifications
**Created**: 2026-06-15

## Origin

Backlog item `[xd9r]` (2026-06-15), invoked via `/fab-new xd9r`. One-shot creation — the design was pre-negotiated in the backlog entry, which was authored jointly with the owner of fab-kit change `[mmmt]` (`260615-mmmt-non-blocking-operator-escalation`).

> [xd9r] Web Push notifications for the run-kit web UI (feat). Goal: let any process on the box (primarily the fab-kit operator agent) send a real background mobile/desktop push that reaches the user even when the RunKit PWA tab is CLOSED. Consumer/origin: fab-kit change [mmmt] abstracts its operator notifications behind a single shell `notify` command, defaulting to ntfy.sh today; `rk notify` (this change) is the intended eventual channel so notifications flow through infra the user already runs instead of a third-party service.

**Cross-repo relationship**: This change UNBLOCKS the eventual "notify via rk" channel in fab-kit `[mmmt]`. `[mmmt]` is NOT blocked on this — `ntfy.sh` is its working default today. So this change has no hard external deadline; it makes `rk notify` available as the preferred channel once shipped.

**Current state verified 2026-06-15 against rk 2.3.1 / this worktree** — the foundation exists but ZERO push is implemented:

- **Present**: PWA manifest `app/frontend/public/manifest.json` (`display: standalone`, 192/512/maskable icons under `/generated-icons/`) linked from `app/frontend/index.html:10` (`<link rel="manifest" href="/manifest.json" />`). SSE server→frontend channel in `app/backend/api/sse.go` (route `GET /api/sessions/stream`, registered `app/backend/api/router.go:369`, chi router; consumed frontend-side in `app/frontend/src/contexts/session-context.tsx` and `hooks/use-boards.ts`). Go/chi backend with ~30 `/api/*` routes in `router.go`. Cobra CLI tree in `app/backend/cmd/rk/` (commands registered in `root.go` via `rootCmd.AddCommand(...)`).
- **Missing (all net-new, confirmed by grep)**: no service worker (no `sw.js`, no `navigator.serviceWorker.register` anywhere in `app/frontend/src`), no Web Push / VAPID / `PushManager` code on either side, no `rk notify` subcommand, no `Notification` API usage.

## Why

1. **Problem**: The fab-kit operator agent (and any process on the box) needs to escalate to the user — but today, escalation only reaches the user if they happen to be looking at the RunKit tab, or it goes through a third-party service (`ntfy.sh`). There is no way to push a real OS-level notification that arrives when the PWA tab is **closed**.
2. **Consequence if not fixed**: Operator escalations get missed (user not watching the tab) or stay coupled to `ntfy.sh` — an external service the user must keep running, that sees the notification content, and that is outside the infra the user already operates. The "one feed across all operators on the box" property the operator loop wants is harder to guarantee through a third party.
3. **Why this approach (Web Push) over alternatives**:
   - **Web Push + service worker** (chosen): a closed PWA tab can still receive a push because the *browser's* push service wakes the registered service worker. This is the only browser-native mechanism that delivers when the tab is closed. The PWA foundation (manifest, standalone display) already exists, so the marginal cost is the service worker + subscription plumbing.
   - **In-page Notification API only** (rejected): requires the tab to be open — fails the core "tab CLOSED" requirement.
   - **Keep ntfy.sh** (rejected as the long-term channel): third-party dependency, content leaves the box, extra service to run. `[mmmt]` keeps it only as a fallback default.
   - **Native OS daemon / email / SMS** (rejected): heavier, out of scope, and don't reuse the existing PWA.
   - **Aggregator property**: a single user's push subscriptions = one feed across all operators on the box, matching `[mmmt]`'s one-shared-feed goal.

## What Changes

Four coordinated deliverables. The end-to-end flow: a shell process runs `rk notify "msg"` → POSTs to the local server `/api/notify` → server iterates stored `PushSubscription`s and sends each a Web Push via `webpush-go` signed with the server's VAPID private key → the browser push service wakes the registered service worker → `sw.js` `push` handler calls `showNotification(title, { body, icon })` → the user sees an OS notification even with the tab closed.

**End-to-end fail-silent discipline** (constitution-aligned, matches rk's documented behavior): every layer fails silently on its own prerequisite being absent. `rk notify` exits 0 (no error surfaced) if the local server is unreachable; the send loop tolerates individual subscription failures; the frontend skips subscription silently if `Notification.requestPermission` is denied or the context is insecure. A notify failure MUST NEVER stall the operator loop.

### (a) Frontend — service worker + subscription flow

- **Add a service worker** `app/frontend/public/sw.js` (served at origin root `/sw.js` so its scope covers the whole app). It handles the `push` event: parse the push payload (`{ title, body, icon? }` JSON) and call `self.registration.showNotification(title, { body, icon })`. Icon defaults to the manifest's `/generated-icons/icon-192.png`. It SHOULD also handle `notificationclick` to focus/open the RunKit tab.
- **Register the service worker on app load**: add `navigator.serviceWorker.register('/sw.js')` (guarded by `'serviceWorker' in navigator`) early in the frontend bootstrap (e.g. `app/frontend/src/main.tsx` or an app-init effect). Confirm exact bootstrap entry during plan/apply.
- **Subscription flow** gated behind an explicit user gesture: call `Notification.requestPermission()`; on `granted`, fetch the server's VAPID **public** key, call `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, and POST the resulting `PushSubscription` (JSON) to the backend `/api/push/subscribe`.
- **Where the permission prompt is triggered** (RESOLVED — user, 2026-06-15): the opt-in gesture is a **command-palette (`Cmd+K`) entry** — e.g. `Enable push notifications` — which calls `Notification.requestPermission()` then the subscribe flow. This satisfies §V Keyboard-First and §IV Minimal Surface Area (no new route/settings page). Any *visible indicator* of subscription state MUST be **terminal-themed** (e.g. a glyph/prompt-style marker fitting run-kit's terminal aesthetic), **NOT a bell icon** — the user explicitly rejected a bell. The exact glyph is an apply-time detail; the constraint (terminal-themed, palette-driven gesture, no bell) is pinned.
- **Manifest**: the manifest is already linked; no `gcm_sender_id` is needed for VAPID-based Web Push. (Backlog note "add the manifest's missing service-worker link" refers to wiring up SW registration, not a manifest field — Web Push does not register the SW via the manifest.)

### (b) Backend — VAPID keypair, subscription store, send endpoint

- **VAPID keypair**: generate once and persist server-side across daemon restarts. Persist under `~/.rk/` to match the existing settings store (`app/backend/internal/settings/settings.go` writes `~/.rk/settings.yaml`). Proposed: a new `app/backend/internal/push/` package owning `~/.rk/vapid.json` (`{ public, private }`, file mode `0600` for the private key) — generated lazily on first need if absent. The **public** key is served to the frontend; the **private** key never leaves the server.
- **Library**: `github.com/SherClockHolmes/webpush-go` (named in the backlog) for VAPID keygen and the Web Push send protocol. Add to `go.mod`.
- **Subscription store**: persist `PushSubscription`s across daemon restarts under `~/.rk/` (proposed `~/.rk/push-subscriptions.json`, an array). De-dupe by endpoint. This is filesystem state — consistent with Constitution §II (No Database): JSON file under `~/.rk/`, not a DB.
- **New endpoints** (all `POST` for mutations per Constitution §IX Uniform HTTP Verb; reads are `GET`), registered in `app/backend/api/router.go` alongside the existing `/api/*` routes:
  - `GET /api/push/vapid-public-key` — returns the VAPID public key (base64url) for the frontend to use as `applicationServerKey`.
  - `POST /api/push/subscribe` — body is a `PushSubscription` JSON; store it (de-dupe by endpoint).
  - `POST /api/notify` — body `{ title?, body }`; send a push to ALL stored subscriptions via `webpush-go`. On a `410 Gone` / `404` response from the push service for a subscription, prune that dead subscription from the store. Returns a small summary (sent/pruned counts) but the CLI ignores the body.
  - (Optional, decide at plan) `POST /api/push/unsubscribe` to remove a subscription by endpoint.

  Example route additions (style mirrors `router.go:344–393`):
  ```go
  r.Get("/api/push/vapid-public-key", s.handlePushVAPIDPublicKey)
  r.Post("/api/push/subscribe", s.handlePushSubscribe)
  r.Post("/api/notify", s.handleNotify)
  ```
- **Process execution / security**: no subprocess execution is introduced here, so Constitution §I (exec.CommandContext) is not triggered by the send path; standard input validation applies to the subscription/notify request bodies (validate JSON shape; bound body size).

### (c) CLI — `rk notify` subcommand

- Add `app/backend/cmd/rk/notify.go` with a `notifyCmd` registered in `root.go` (`rootCmd.AddCommand(notifyCmd)`). Signature: `rk notify <message>` with an optional `--title` flag.
- It resolves the local server base URL the same way `context.go:59–62` does — `RK_HOST`/`RK_PORT` env vars defaulting to `127.0.0.1:3000` (via `internal/config`) — and `POST`s `{ title, body }` to `{base}/api/notify`.
- **Fail-silent**: if the server is unreachable, the POST errors, or it returns non-2xx, `rk notify` MUST exit 0 and surface nothing (matches rk's documented fail-silent discipline and the operator-loop requirement). Use a short context timeout (5–10s per Constitution Process Execution norms) so a hung server never blocks the caller.

### (d) Discoverability — surface `rk notify` in `rk context`

- Add a `rk notify` line to the Capabilities section emitted by `writeCapabilities` in `app/backend/cmd/rk/context.go` (around the existing `b.WriteString("- \`rk ...\`")` lines, ~141–150), so agents discover the channel via `rk context`.

### Docs

- Update `README.md` and `docs/` to document Web Push: the `rk notify` command, the opt-in subscription flow, and the **secure-context constraint** — Web Push (service worker + `PushManager`) requires HTTPS **or** `localhost` (a secure context). The user typically hits run-kit on `localhost:3000` or behind a TLS reverse proxy (both secure contexts), so this is satisfied in practice but MUST be documented.

## Affected Memory

This change is implementation surface area in a domain (web-push / SSE / PWA) that has no existing curated memory file. Per the template rule, memory updates are only listed when spec-level behavior changes warrant them. A new memory file capturing the Web Push architecture and the secure-context constraint is plausibly warranted and will be created during hydrate if the domain index supports it:

- `web-push/architecture`: (new) End-to-end Web Push flow (rk notify → /api/notify → webpush-go → service worker showNotification), VAPID key + subscription persistence under `~/.rk/`, and the HTTPS-or-localhost secure-context constraint. *(Created during hydrate; domain may not exist yet — non-blocking per `_preamble` Memory Lookup step 5.)*

## Impact

- **New dependency**: `github.com/SherClockHolmes/webpush-go` added to `go.mod` (`app/backend/go.mod`).
- **New backend package**: `app/backend/internal/push/` (VAPID keypair + subscription store, persisted under `~/.rk/`).
- **New backend handlers**: in `app/backend/api/` (e.g. `push.go`), wired into `router.go`.
- **New CLI command**: `app/backend/cmd/rk/notify.go`, registered in `root.go`.
- **Frontend**: new `app/frontend/public/sw.js`; SW registration + subscription UI in `app/frontend/src/` (bootstrap entry + a small opt-in control).
- **Persisted state** (new files under `~/.rk/`): `vapid.json` (0600), `push-subscriptions.json`.
- **`rk context` output** changes (new Capabilities line) — touches `context.go` and its golden test (`context_test.go` / `help_dump_test.go` may need updating).
- **Docs**: `README.md`, `docs/`.
- **Constitution touchpoints**: §II No Database (JSON files under `~/.rk/`, not a DB — compliant); §IX Uniform HTTP Verb (all mutations `POST`, reads `GET` — compliant); §IV Minimal Surface Area (NO new route/settings page — opt-in control must fit existing UI); §I/Process Execution (no new subprocess; request-body validation + bounded timeouts).
- **No tmux/session-state impact** — push state is independent of tmux (Constitution §II/§VI unaffected).

## Open Questions

- ~~Where in the existing UI does the push opt-in / `Notification.requestPermission()` gesture live?~~ **RESOLVED (user, 2026-06-15)**: command-palette (`Cmd+K`) entry for the gesture; any visible subscription-state indicator must be **terminal-themed, not a bell**. See "What Changes" (a).
- Should `/api/notify` send synchronously and return per-subscription results, or fire-and-forget? *(Default: send synchronously with a short bounded timeout, prune dead subscriptions on 404/410, return a summary the CLI ignores — Confident.)*
- Subscription store format/location — `~/.rk/push-subscriptions.json` proposed; confirm against any future multi-user concern (single-user box assumed). *(Confident.)*
- Does `rk notify` need a `--title` flag in v1, or is a single message body enough? *(Default: include `--title`, optional, since the backlog says "and/or `--title`" — Confident.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery model is browser **Web Push** (service worker + VAPID + PushManager), not in-page Notification API or a native daemon | Backlog explicitly pins the Web Push model; it is the only mechanism that delivers when the PWA tab is CLOSED (the core requirement) | S:98 R:70 A:95 D:95 |
| 2 | Certain | Backend uses `github.com/SherClockHolmes/webpush-go` for VAPID keygen + Web Push send | Library named verbatim in the backlog; config/constitution give no conflicting constraint | S:95 R:60 A:90 D:90 |
| 3 | Certain | All mutating endpoints (`/api/push/subscribe`, `/api/notify`) are `POST`; key fetch is `GET` | Constitution §IX Uniform HTTP Verb mandates POST for mutations, GET for reads — deterministic | S:90 R:75 A:100 D:100 |
| 4 | Certain | VAPID keypair + subscriptions persist as JSON files under `~/.rk/` (no database) | Constitution §II No Database mandates filesystem/tmux-derived state; `~/.rk/` is the established rk state dir (`internal/settings` writes `~/.rk/settings.yaml`) | S:88 R:65 A:100 D:92 |
| 5 | Certain | `rk notify` resolves the local server via `RK_HOST`/`RK_PORT` (default `127.0.0.1:3000`) exactly as `context.go` does | Existing codebase pattern (`context.go:59–62` via `internal/config`); no new resolution logic needed | S:90 R:80 A:95 D:95 |
| 6 | Certain | `rk notify` is fail-silent: server unreachable / non-2xx / timeout → exit 0, no output | Backlog requirement, matches rk's documented fail-silent discipline, and is required so a notify failure never stalls the operator loop | S:95 R:80 A:95 D:95 |
| 7 | Confident | `/api/notify` sends synchronously with a short bounded timeout and prunes dead subscriptions on 404/410 | Simplest correct model for a single-user box; bounded timeout aligns with Process Execution norms; prune keeps the store clean. CLI ignores the response body | S:70 R:75 A:80 D:75 |
| 8 | Confident | Push payload shape is JSON `{ title, body, icon? }`; SW `showNotification` defaults icon to `/generated-icons/icon-192.png` | Manifest already ships these icons; standard Web Push payload; easily changed later | S:72 R:90 A:85 D:80 |
| 9 | Confident | `rk notify` includes an optional `--title` flag in v1 | Backlog says "and/or `--title`"; trivial, additive, reversible | S:70 R:95 A:85 D:80 |
| 10 | Confident | Service worker lives at `app/frontend/public/sw.js` (origin-root scope) and is registered on app load guarded by `'serviceWorker' in navigator` | Standard SW placement for whole-app scope; guarded registration is the conventional safe pattern; backlog specifies a `sw.js` registered on app load | S:78 R:85 A:85 D:82 |
| 11 | Confident | Push opt-in gesture is a command-palette (`Cmd+K`) entry; any visible subscription-state indicator is terminal-themed (NOT a bell icon) | RESOLVED by user 2026-06-15 — palette satisfies §V Keyboard-First + §IV (no new route); user explicitly rejected a bell and asked for a terminal-themed affordance. Only the exact glyph remains an apply-time detail | S:85 R:60 A:88 D:82 |

<!-- clarified: push opt-in is a Cmd+K palette entry; subscription-state indicator is terminal-themed, not a bell — user decision 2026-06-15 -->

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
