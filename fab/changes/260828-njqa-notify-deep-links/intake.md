# Intake: rk notify Deep Links

**Change**: 260828-njqa-notify-deep-links
**Created**: 2026-08-28

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a live conversation with a synthesized change description. The user runs Claude Code agents in run-kit-managed tmux windows on a GCP box, with a Claude `Stop` hook that fires `rk notify "turn complete in <dir>" --title "Claude"`. Notifications deliver end-to-end (verified), but clicking one lands on the app root. The user wants the click to jump to the specific session/window the notify came from.

> Feature: `rk notify` deep-links — clicking a Web Push notification jumps the dashboard to the originating tmux window. Accept an optional `url` in `POST /api/notify` (server-side soft-drop validation mirroring the SW's `sameOriginPath` posture); give `rk notify` a `--url` flag and, when absent and the caller is inside a tmux pane, auto-derive the caller's `/$server/$window` dashboard route the way the waiting-push watcher composes it. Derivation failure sends without a url; the fail-silent contract is inviolable.

Key decisions carried from the conversation: soft-drop invalid urls (never 400 — preserves fail-soft notify semantics); derivation logic lives in the rk binary, not the Claude hook; explicit `--url` overrides derivation; outside tmux, behavior is exactly today's.

## Why

1. **Pain point**: the entire click leg already exists — `app/frontend/public/sw.js` (change `260714-r7rq`) validates an optional `url` from the push payload and, on `notificationclick`, focuses an existing app tab and navigates it there (else `clients.openWindow`). `internal/push.Notify(ctx, title, body, url)` (app/backend/internal/push/send.go:50) carries the url in the payload as `"url,omitempty"`. And the daemon's sustained-waiting pushes already deep-link (api/waiting_push.go:52-59). But the **generic notify path drops the url on the floor at both hops**: `handleNotify` (app/backend/api/push.go:54) decodes only `{title, body}` and passes `""` to `push.Notify`; `rk notify` (app/backend/cmd/rk/notify.go:55) marshals only `{title, body}`. So every hook-driven "turn complete" notification lands the user on the app root instead of the agent's window.

2. **Consequence of not fixing**: on a multi-agent box, a notification tells you *an* agent finished but clicking it strands you at `/` — you then hunt through the sidebar for which window fired it. The notification's core value (jump to the thing that needs you) is realized only for the daemon's waiting pushes, not for the far more common hook-driven notifies.

3. **Why this approach**: the frontend/SW leg needs NO work — this change only threads the url through the two gaps. Deriving the window route inside the rk binary (rather than teaching the Claude hook to compose it) follows the `rk agent hook` "logic lives in the binary" precedent, and `rk present` already owns the exact pane→window/server resolution pattern (`callerContext` + `display-message -pt $TMUX_PANE '#{window_id}'`, app/backend/cmd/rk/present.go:165-204). Composing the path the way `waitingPushURL` does guarantees the CLI-derived link and the daemon-derived link hit the same terminal route.

## What Changes

### 1. `POST /api/notify` accepts an optional `url` (app/backend/api/push.go)

`handleNotify`'s body struct gains a `URL string \`json:"url"\`` field. Server-side validation mirrors the SW's `sameOriginPath` posture, expressed as a relative-path check (the server has no origin to resolve against; the SW re-validates defensively anyway):

- Accept only a string starting with `/` and NOT starting with `//` (a protocol-relative `//evil.example` resolves to an external origin — same rationale as sw.js:14-25).
- Any other value (empty, missing, absolute URL, `//...`, non-path garbage) **soft-drops to `""`** — the push is still sent, url omitted from the payload (`url,omitempty`), and the SW falls back to the app root on click. **Never 400 on an invalid url** — callers of this endpoint are fail-soft by contract, and `body` remains the only required field.
- The existing stale comment at push.go:72-74 ("The generic /api/notify path carries no deep-link URL") is removed/replaced.
- Pass the validated value (or `""`) as the 4th arg to `push.Notify(r.Context(), title, body.Body, url)`.

Response shape (`{sent, pruned}`) and all existing behavior for url-less requests are unchanged.

### 2. `rk notify --url` flag (app/backend/cmd/rk/notify.go)

A new `--url` string flag: an explicit relative path passed through in the POST body as `{title, body, url}`. No client-side validation/rejection — the server soft-drops invalid values and the SW re-validates; the fail-silent contract means there is nothing useful to surface anyway. When `--url` is set (even to something invalid), auto-derivation (below) is skipped entirely.

### 3. Auto-derivation of the caller's window route (app/backend/cmd/rk/notify.go)

When `--url` is absent AND the caller is inside a tmux pane, derive the caller's dashboard route exactly the way `rk present` resolves its attach target (present.go:165-204 `callerContext` + `presentAttach` head):

- **Server name**: from the ORIGINAL `$TMUX` (`tmux.OriginalTMUX` — `internal/tmux`'s `init()` strips `$TMUX` from the process) via `tmuxSocketArgs` for the `-S` socket prefix, socket basename as the server name (matching `ListServers` naming; `default` for the default socket).
- **Window id**: `display-message -pt $TMUX_PANE '#{window_id}'` under the socket prefix, via `exec.CommandContext` with a bounded timeout (Constitution I; Process Execution constraint — tmux ops 5-10s, but keep the derivation bound well inside the 8s `notifyTimeout` budget). Validate the result with `validate.ValidateWindowID` before use (Constitution I: validate derived values).
- **Compose** matching `waitingPushURL` (api/waiting_push.go:52-59): `seg := strings.TrimPrefix(windowID, "@")` then `"/" + url.PathEscape(server) + "/" + url.PathEscape(seg)`. NOTE: the URL segment is the window id's **numeric part** (`@5` → `/myserver/5`) — the `@` is trimmed, not escaped (the conversation's `%40N` phrasing was inaccurate; the code is authoritative, and the frontend route's `windowIdToUrlSegment`/parse expects the numeric form). No `?view=chat` suffix — the plain window URL resolves the window's own view preference on load.
- **Any derivation failure sends WITHOUT a url**: no `$TMUX_PANE`, unset/malformed `$TMUX`, tmux error, timeout, or window-id validation failure all silently fall through to today's `{title, body}` behavior. `rk notify`'s fail-silent contract — always exit 0, no output, never stall the caller — is inviolable and unchanged.

Whether the derivation helper is a small function in notify.go using injectable seams (the `presentOriginalTMUXFn`/`presentRunOutputFn` pattern, present.go:87-91) or a shared extraction with present.go is a plan-level choice; the seam pattern itself is settled (it is what makes the logic testable without tmux).

### 4. Tests

- **Handler** (app/backend/api/push_test.go or equivalent): url validation table — valid `/server/5` passes through to the push seam; `//evil.example`, `https://evil.example`, `no-leading-slash`, empty ⇒ soft-drop to `""` with the push still sent and 200 returned; url-less request unchanged.
- **CLI derivation** (app/backend/cmd/rk/notify_test.go, which exists): via injectable seams per the present.go/agent_hook.go test patterns — derivation success composes the escaped route; each failure mode (no `$TMUX_PANE`, malformed `$TMUX`, tmux error) sends without url and exits 0 silently; explicit `--url` skips derivation and passes through.
- Tests conform to this intake's behavior contract (Test Integrity constraint); run via `just test-backend` / `cd app/backend && go test ./...`.

### 5. Toolkit surface

The new `--url` flag changes `rk notify --help` output — the help-dump golden check (cmd/rk/help_dump.go / help_dump_test.go) must be updated in the same change, checked against `shll standards` for the CLI-surface standards (Constitution: Toolkit Standards).

### Acceptance scenario

The user's existing Claude Stop hook — unchanged — sends `rk notify "turn complete in <dir>" --title "Claude"` from inside an agent's pane; clicking the resulting notification on any subscribed device opens/focuses the dashboard at that agent's `/$server/$window` route. Explicit `--url` overrides derivation; outside tmux (or on any derivation failure), the click lands on the app root exactly as today. The server default for pushes sent without a url stays the app root.

## Affected Memory

- `run-kit/architecture`: (modify) The `/api/notify` API-table row (body gains optional `url`, soft-drop semantics), the `notify` CLI-subcommand row (`--url` flag + auto-derivation + unchanged fail-silent contract), and § Web Push Notifications — the "`Notify` signature carries an optional deep-link URL" paragraph's claim that "the generic `/api/notify` path and `rk notify` pass `""`" becomes stale (the waiting-push watcher is no longer the only URL producer).
- `run-kit/ui/updates-and-notifications`: (modify) Light touch, if any — § Notifications (Web Push opt-in) points at architecture.md for the delivery model; update only if the payload-contract mention there needs the url producer list corrected.

## Impact

- **Backend Go only; zero frontend work** — sw.js already implements the entire click leg (260714-r7rq) and `push.Notify` already carries `url,omitempty`.
- Files: `app/backend/api/push.go` (+ handler test), `app/backend/cmd/rk/notify.go` + `notify_test.go` (possibly a small shared caller-context seam touching `present.go`), cmd/rk help-dump golden data.
- No new endpoints or HTTP verbs (existing POST — Constitution IX). No new dependencies. One new tmux subprocess call on the `rk notify` path, `exec.CommandContext` + timeout + argument slices (Constitution I), fully optional and fail-soft.
- API is additive/backwards-compatible: old clients omitting `url` behave byte-identically; the daemon's waiting-push path is untouched.

## Open Questions

- None — the source conversation pre-resolved the judgment calls (soft-drop vs 400, binary-owned derivation, override semantics); remaining decisions are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Invalid `url` in POST /api/notify soft-drops to `""` (push still sent, root-landing click) — never 400 | Discussed — conversation pre-approved soft-drop as the default, 400 breaks fail-soft callers; SW re-validates defensively | S:90 R:85 A:90 D:85 |
| 2 | Certain | Route derivation lives in the rk binary, not the Claude hook | Discussed — rejected alternative; `rk agent hook` "logic lives in the binary" precedent, `rk present` owns the pane→window/server pattern | S:95 R:80 A:90 D:90 |
| 3 | Certain | URL segment is the window id's numeric part — `strings.TrimPrefix(windowID, "@")` then `url.PathEscape`, matching `waitingPushURL` (waiting_push.go:53-54) — correcting the conversation's `%40N` phrasing | Codebase is authoritative: waiting_push.go trims `@`; the frontend route parse expects the numeric segment | S:85 R:90 A:95 D:90 |
| 4 | Certain | Explicit `--url` overrides auto-derivation; outside tmux (or any derivation failure) behavior is exactly today's — send without url, exit 0, no output | Discussed — stated verbatim in the change description; fail-silent contract inviolable | S:90 R:85 A:90 D:90 |
| 5 | Certain | Server-side validation shape: accept only strings starting with `/` and not `//`; no origin-resolve step server-side | Discussed + mirrors sw.js `sameOriginPath` rationale; the server has no client origin to resolve against, SW does the belt-and-braces check | S:90 R:85 A:85 D:80 |
| 6 | Certain | Derivation uses the `callerContext` pattern (present.go:165-204): `tmux.OriginalTMUX` socket args, socket basename as server, `display-message -pt $TMUX_PANE '#{window_id}'`, `validate.ValidateWindowID` on the result, injectable seams for tests | Discussed + codebase pattern is exact and proven; Constitution I satisfied by CommandContext + validation | S:90 R:85 A:90 D:90 |
| 7 | Certain | Go tests via the existing injectable-seam patterns (notify_test.go, present.go/agent_hook.go style); no frontend/e2e work — sw.js leg shipped and tested in 260714-r7rq | Discussed — tests named in the change description; code-quality.md requires tests for changed behavior | S:85 R:90 A:90 D:85 |
| 8 | Certain | No docs/specs/api.md edit: api.md carries no push-endpoint rows (verified by grep); the authoritative API table is memory `run-kit/architecture` § API Layer, updated at hydrate | Conversation said "may need" — verified against the working tree: the spec never documented /api/notify | S:70 R:90 A:85 D:80 |
| 9 | Certain | Help-dump golden updated for the new `--url` flag; flag surface checked against `shll standards` | Constitution Toolkit Standards + the help-dump check named in the change description; mechanical | S:85 R:95 A:95 D:95 |
| 10 | Confident | Derived URL carries no `?view=chat` (unlike chat-capable waiting pushes) — plain `/{server}/{seg}` resolves the window's own view pref on load | CLI-side chat detection would need an extra `@rk_chat` tmux read for marginal gain; waiting_push.go comment confirms the plain URL resolves view pref | S:70 R:85 A:75 D:70 |
| 11 | Confident | `--url` values pass through the CLI unvalidated; server soft-drop + SW re-validation are the guards | Fail-silent contract leaves no channel to surface a client-side rejection; two downstream validators already exist | S:65 R:85 A:80 D:75 |
| 12 | Confident | The derivation's tmux call gets its own short bounded timeout (seconds-scale, inside the 8s `notifyTimeout` budget) so derivation can never eat the whole notify window | Constitution Process Execution gives the 5-10s tmux band; exact value is a reversible plan-level detail | S:55 R:90 A:70 D:60 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
