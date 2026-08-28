# Plan: rk notify Deep Links

**Change**: 260828-njqa-notify-deep-links
**Intake**: `intake.md`

## Requirements

### Backend API: optional `url` in POST /api/notify

#### R1: handleNotify accepts and soft-validates an optional deep-link url
`POST /api/notify` SHALL accept an optional `url` string field alongside `{title?, body}`. A value that starts with `/` and does NOT start with `//` SHALL pass through as the 4th argument to `push.Notify`; any other value (absent, empty, `//…` protocol-relative, absolute URL, non-path garbage) SHALL soft-drop to `""` — the push is still sent, the response stays `{sent, pruned}` with HTTP 200, and the endpoint MUST NOT return 400 for an invalid `url` (`body` remains the only required field). The stale comment stating the generic path carries no deep-link URL SHALL be removed.

- **GIVEN** a subscribed device and a request body `{"body":"hi","url":"/noon/57"}`
- **WHEN** the handler runs
- **THEN** `push.Notify` receives `url == "/noon/57"` and the response is 200 `{sent, pruned}`

- **GIVEN** a request body `{"body":"hi","url":"//evil.example"}` (or `https://evil.example`, `no-leading-slash`, `""`)
- **WHEN** the handler runs
- **THEN** `push.Notify` receives `url == ""`, the push is still sent, and the response is 200

### CLI: rk notify --url and pane-derived deep links

#### R2: explicit --url passes through and disables derivation; explicit empty opts out
`rk notify` SHALL gain a `--url` string flag. When set, auto-derivation SHALL NOT run. A non-empty value SHALL be sent verbatim as `url` in the POST body; an explicitly EMPTY value (`--url=`) is the deliberate opt-out — no `url` key is sent at all, yielding a root-landing click (the `url` key is included only when non-empty, matching the payload's `url,omitempty` contract). The CLI SHALL NOT validate or reject the value (server soft-drop + SW re-validation are the guards; the fail-silent contract leaves no channel to surface a rejection).

- **GIVEN** `rk notify "msg" --url /custom/7` run inside a tmux pane
- **WHEN** the POST is composed
- **THEN** the body carries `url: "/custom/7"` and no tmux subprocess is invoked

- **GIVEN** `rk notify "msg" --url=` (explicitly empty) run inside a tmux pane
- **WHEN** the POST is composed
- **THEN** the body carries no `url` key and no tmux subprocess is invoked (deep link deliberately suppressed)

#### R3: in-pane auto-derivation of the caller's window route
When `--url` is absent AND the caller is inside a tmux pane, `rk notify` SHALL derive the caller's dashboard route exactly as `rk present` resolves its attach target: socket prefix + server name from the ORIGINAL `$TMUX` via `callerContext()` (present.go), window id via `display-message -pt $TMUX_PANE '#{window_id}'` through the `presentRunOutputFn` seam under `exec.CommandContext` with a bounded sub-timeout, the result validated with `validate.ValidateWindowID`. The URL SHALL be composed exactly as `waitingPushURL` (api/waiting_push.go): `seg := strings.TrimPrefix(windowID, "@")`, then `"/" + url.PathEscape(serverName) + "/" + url.PathEscape(seg)` — the numeric segment, no `?view=` suffix.

- **GIVEN** `rk notify "turn complete"` run in pane `%3` of window `@57` on tmux server `noon`
- **WHEN** derivation runs
- **THEN** the POST body carries `url: "/noon/57"`

#### R4: derivation failure preserves the fail-silent contract byte-identically
Any derivation failure — `$TMUX_PANE` unset, `$TMUX` unset/malformed (`callerContext` not ok), tmux command error or timeout, window-id validation failure — SHALL fall through to today's behavior: the POST body carries no `url` key, the command exits 0, and nothing is printed. The 8s `notifyTimeout` request budget and the whole fail-silent contract (unreachable server, non-2xx, timeout ⇒ exit 0, silent) are unchanged.

- **GIVEN** `rk notify "msg"` run outside tmux
- **WHEN** the command runs
- **THEN** the POST body is exactly `{"title":…,"body":…}` (no `url` key), exit code 0, no output

### Toolkit surface

#### R5: help-dump golden covers the new flag
The `--url` flag changes `rk notify --help`; the help-dump golden data (cmd/rk/help_dump.go / help_dump_test.go) SHALL be regenerated/updated in this change so `go test ./...` passes.

- **GIVEN** the new flag is registered
- **WHEN** the help-dump test runs
- **THEN** it passes with the `--url` line present in the dumped notify help

### Non-Goals

- No frontend/SW work — the click leg shipped in 260714-r7rq and is untouched.
- `rk present --notify` keeps sending url-less pushes (its notify seam passes through unchanged); deep-linking present notifies is a natural follow-up, not this change.
- No `?view=chat` detection on the CLI path — the plain window URL resolves the window's own view preference on load.
- The daemon's waiting-push path (waiting_push.go) is untouched.

### Design Decisions

#### Reuse present.go's callerContext and seams instead of new derivation plumbing
**Decision**: the derivation helper in notify.go calls the existing package-level `callerContext()` and `presentRunOutputFn` seam (both `package main`), plus `validate.ValidateWindowID` — no new seam variables, no shared extraction.
**Why**: the pane→(socket prefix, server) resolution and the injectable-run-output pattern already exist in the same package and are proven testable (present_test/agent_hook_test override the same seams); duplicating them would trip the no-duplication anti-pattern.
**Rejected**: notify-private copies of the seams (duplication); extracting a shared `internal/` helper (over-engineering for two same-package callers).
*Introduced by*: 260828-njqa-notify-deep-links

#### One send core with a url parameter; the legacy signature stays as a thin delegate
**Decision**: the POST logic moves to `sendNotifyURL(ctx, title, body, deepLink)`; `sendNotify(ctx, title, body)` remains as a three-line delegate passing `""`. The payload gains a `url` key only when the value is non-empty. `present.go`'s seam and `mux_await.go`'s field keep consuming `sendNotify` unchanged.
**Why**: one send path keeps the fail-silent contract in one place, while the delegate leaves the three existing consumers (present seam, mux_await field, tests) byte-untouched; omitting the key when empty keeps old-daemon requests byte-compatible.
**Rejected**: changing `sendNotify`'s signature at every call site (touches present.go/mux_await.go/tests for zero behavior change); a parallel full send implementation (two POST paths to keep in sync); always sending `url:""` (pointless payload churn against older daemons).
*Introduced by*: 260828-njqa-notify-deep-links

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/api/push.go`: add optional `URL string \`json:"url"\`` to handleNotify's body struct; add a small `notifyDeepLinkPath(raw string) string` validation helper (accept `/`-prefixed, non-`//` strings; else `""`); pass the result to `push.Notify`; replace the stale no-deep-link comment <!-- R1 -->
- [x] T002 `app/backend/cmd/rk/notify.go`: register `--url` flag; move the POST core to `sendNotifyURL(ctx, title, body, deepLink)` with `sendNotify` as a thin `""` delegate (payload gains `url` key only when non-empty; existing consumers untouched — see Design Decisions); add `deriveNotifyURL(ctx) string` — `$TMUX_PANE` guard, `callerContext()`, `display-message -pt $TMUX_PANE '#{window_id}'` via `presentRunOutputFn` under a 3s sub-context, `validate.ValidateWindowID`, compose `"/"+url.PathEscape(server)+"/"+url.PathEscape(strings.TrimPrefix(windowID,"@"))`; wire RunE: flag set → flag value, else derive <!-- R2 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T003 `app/backend/api/push_test.go`: handleNotify url table — `notifyDeepLinkPath` unit table (valid path passes, `//evil.example` / `https://…` / `no-leading-slash` / empty ⇒ `""`) plus an endpoint-level soft-drop test (every url shape returns 200, never 400); url-less request covered by existing tests unchanged <!-- R1 -->
- [x] T004 `app/backend/cmd/rk/notify_test.go`: derivation success composes the escaped `/{server}/{seg}` body url (seam-injected window id, `$TMUX_PANE` via t.Setenv); each failure mode (no `$TMUX_PANE`, malformed `$TMUX`, tmux error, timeout-shaped context error, invalid window id) drives the RunE POST path and the captured body carries no `url` key; `--url` skips derivation (zero tmux calls), non-empty passes through verbatim, and explicitly empty `--url=` sends no `url` key <!-- R3 --> <!-- rework: cycle 1 — failure modes must flow through RunE, add timeout-shaped mode and explicit-empty opt-out test -->

### Phase 4: Polish

- [x] T005 `app/backend/cmd/rk`: verified there is NO help-dump golden file — `rk help-dump` emits live JSON at runtime, so the flag surfaces automatically; verified `rk notify --help` renders the `--url` line from a fresh build, and `go test ./...` is green (26 packages) <!-- R5 -->

## Execution Order

- T001 and T002 are independent; T003 depends on T001, T004 on T002, T005 on T002.

## Acceptance

### Functional Completeness

- [x] A-001 R1: handleNotify decodes an optional `url`, valid values reach `push.Notify` unchanged, and the response shape stays `{sent, pruned}`
- [x] A-002 R2: `--url` is registered, a non-empty value passes through verbatim, an explicitly empty `--url=` sends no `url` key (the deliberate opt-out), and any set flag suppresses derivation entirely — each contract covered by a test
- [x] A-003 R3: in-pane derivation produces `/{server}/{numeric-seg}` composed with `url.PathEscape`, matching `waitingPushURL`'s format
- [x] A-004 **N/A**: no help-dump golden data exists; the live `rk help-dump` tree includes the `--url` line automatically, and `go test ./...` is green in `app/backend`

### Behavioral Correctness

- [x] A-005 R1: every invalid-url shape (`//…`, absolute, no leading `/`, empty) soft-drops to `""` with HTTP 200 and the push still sent — never 400
- [x] A-006 R4: url-less requests and out-of-tmux CLI invocations behave byte-identically to before this change (no `url` key in payload, exit 0, silent)

### Scenario Coverage

- [x] A-007 R3: a test proves the acceptance scenario shape — derivation on window `@57`, server `noon` yields body url `/noon/57`
- [x] A-008 R4: tests drive EACH derivation failure mode (no `$TMUX_PANE`, malformed `$TMUX`, tmux error, timeout-shaped context error, invalid window id) through the RunE POST path, asserting the captured body carries no `url` key and RunE returns nil

### Edge Cases & Error Handling

- [x] A-009 R3: the derivation tmux call runs under `exec.CommandContext` with a bounded sub-timeout inside the 8s notify budget; a hung tmux cannot stall the notify beyond it
- [x] A-010 R1: server names with reserved characters stay valid same-origin relative URLs (PathEscape on both segments)

### Code Quality

- [x] A-011 Pattern consistency: new code follows the notify.go/present.go idioms (seam reuse, cobra flag registration, fail-silent posture)
- [x] A-012 No unnecessary duplication: derivation reuses `callerContext`/`presentRunOutputFn`/`validate.ValidateWindowID`; URL composition mirrors `waitingPushURL` rather than a new abstraction elsewhere
- [x] A-013 Tests included for added behavior (code-quality principle: new features MUST include tests)
- [x] A-014 No comment narration; comments state contracts only (fail-silent, soft-drop rationale)

### Security

- [x] A-015 R1/R3: no shell strings — the tmux call uses argument slices under CommandContext; derived window id validated via `validate.ValidateWindowID`; server-side url check rejects protocol-relative and absolute escapes (SW re-validates defensively)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Derivation sub-timeout fixed at 3s (inside the 8s notifyTimeout) | Intake assumption 12 left the exact value plan-level; 3s sits in the tmux-op band without eating the request budget | S:60 R:90 A:75 D:70 |
| 2 | Confident | POST core moves to `sendNotifyURL(ctx, title, body, deepLink)`; `sendNotify(ctx, title, body)` stays as a thin `""` delegate so present.go/mux_await.go consumers are untouched | Single send path preserves the fail-silent contract in one place; present deep-linking is an explicit Non-Goal (see Design Decisions) | S:65 R:85 A:80 D:75 |
| 3 | Certain | Payload `url` key included only when non-empty | Mirrors `url,omitempty` on the daemon payload; keeps existing notify tests and old-daemon compat byte-identical | S:80 R:90 A:90 D:85 |
| 4 | Confident | Handler validation as a named helper `notifyDeepLinkPath` in push.go, unit-tested directly | Small, testable, mirrors sw.js `sameOriginPath` naming; avoids inline conditional soup in the handler | S:60 R:90 A:85 D:75 |

4 assumptions (1 certain, 3 confident, 0 tentative).
