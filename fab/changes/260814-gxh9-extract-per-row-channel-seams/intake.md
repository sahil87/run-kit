# Intake: Extract Per-Row Channel Seams

**Change**: 260814-gxh9-extract-per-row-channel-seams
**Created**: 2026-08-14

## Origin

Backlog item `[gxh9]` (fab/backlog.md), invoked one-shot via `/fab-new gxh9`:

> Per-row channel abstraction: 4th hand-threaded per-row channel (color/marker/role/flair) proved the pattern tax — extract generic seams where >=2 channels mirror each other: session string-option endpoint (handleSessionColor/handleSessionFlair share one handler parameterized by option key + validator), generic nested string-map sections in settings.go parse/serialize (server_colors/server_flairs/board_order), tmux session-option set/unset helpers, closed-set token parse idiom. Pure refactor, zero behavior change, existing tests pass unchanged. Land AFTER PR 605 merges; gate any new channel on this.

The landing gate is satisfied: PR #605 (Sidebar Character Row Animations — the flair channel, the 4th per-row channel) is merged as commit `75318140` on main.

## Why

Each per-row visual/behavioral channel (window+session **color**, window **marker**, window **role**, window+session **flair**) has been hand-threaded through the same four layers: an API handler, a closed-set validator, a tmux user-option set/unset pair, and (for server-scoped values) a settings.yaml section. The 4th channel (flair, PR #605) was implemented by copying the color stack nearly verbatim — `handleSessionFlair` mirrors `handleSessionColor` line-for-line, `SetSessionFlair`/`UnsetSessionFlair` mirror `SetSessionColor`/`UnsetSessionColor`, and `ValidateFlairValue` mirrors `ValidateMarkerValue` including a hand-maintained error message that re-lists the token set.

If left as-is, every future channel pays the same copy tax and multiplies drift risk (four near-identical copies of the SSE-wake comment block already exist). The backlog entry explicitly gates any 5th channel on this extraction.

This is a **pure refactor**: zero behavior change, identical API surface, identical wire formats, existing tests pass unchanged. The approach is to extract a generic seam only where ≥2 channels already mirror each other — no speculative abstraction beyond what the existing copies prove.

## What Changes

### 1. Session string-option endpoint (`app/backend/api/sessions.go`)

`handleSessionColor` (sessions.go:91) and `handleSessionFlair` (sessions.go:144) are structurally identical: validate session name → decode a single-pointer-field JSON body → validate the value via a shared validator → call a tmux set-or-unset pair → wake the SSE hub → `{"ok": true}`. Extract one shared helper parameterized per channel by:

- JSON body field name (`color` / `flair`)
- validator func (`validate.ValidateColorValue` / `validate.ValidateFlairValue`)
- tmux set/unset funcs (via the existing `tmuxOps` interface methods)
- **empty-string semantics, which differ per channel and MUST be preserved**:
  - color: `null` clears; `""` is rejected by `ValidateColorValue` → 400
  - flair: `null` **or** `""` clears (`""` is a valid member of `FlairValues`)

The two route registrations (`router.go:661-662`) and the exported handler names may stay as thin wrappers over the shared helper, or the helper can be a handler factory — either way the `tmuxOps` interface and routes are unchanged. The SSE-wake step (`initSSEHub` + `sseHub.wake(server)`) moves into the shared helper so the duplicated comment block exists once.

### 2. Generic nested sections in `settings.go` parse/serialize (`app/backend/internal/settings/settings.go`)

`parse()` hand-threads per-section booleans (`inServerColors`, `inBoardOrder`) and per-section inline bodies; `serialize()` hand-emits each section. Two section *shapes* exist:

- **nested string map** — `server_colors:` (`  name: "value"` lines, per-value normalization via `validate.NormalizeColorValue`)
- **nested string list** — `board_order:` (`  - "value"` lines)

Extract the section plumbing so a section is described as data (section key, shape map|list, optional per-value normalize func) and `parse`/`serialize` walk a small section registry instead of growing a new boolean + branch per section. Serialization stays byte-identical: sorted map keys, always-quoted values, sections omitted when empty, same ordering (`server_colors` before `board_order`, scalars first).

**Note a deliberate divergence from the backlog text**: the entry names `server_flairs`, but no such section exists — session flair lives only in the tmux `@rk_session_flair` option; settings.yaml has exactly `server_colors` and `board_order` as nested sections. Adding a `server_flairs` section would be a behavior change and is out of scope. The seam's purpose is that a future section (e.g. `server_flairs`) becomes a registry entry, not new parse/serialize code.

The scalar getter/setter pairs (`GetServerColor`/`SetServerColor`, `GetInstanceColor`/…, load-then-save) are an existing consistent idiom and are NOT in scope — only the nested-section parse/serialize plumbing is.

### 3. tmux session-option set/unset helpers (`app/backend/internal/tmux/tmux.go`)

`SetSessionColor`/`UnsetSessionColor` (tmux.go:1910/1919) and `SetSessionFlair`/`UnsetSessionFlair` (tmux.go:1939/1949) differ only in the option name (`@session_color` vs `@rk_session_flair`). Extract an unexported generic pair, e.g.:

```go
func setSessionOption(session, option, value, server string) error   // set-option -t =session option value
func unsetSessionOption(session, option, server string) error        // set-option -u -t =session option
```

The four exported functions become one-line wrappers naming their option constant. Exported names and signatures are unchanged so the `tmuxOps` interface in `router.go` and all call sites stay untouched. The scope-split naming doc comment (`@rk_session_flair` NOT `@rk_flair` — hierarchical option-lookup leak) is preserved on the wrappers/constants. Window-scoped `SetWindowColor`/`UnsetWindowColor` may join the same pattern via a window variant only if it falls out naturally; window options already batch through `SetWindowOptions`.

### 4. Closed-set token parse idiom (`app/backend/internal/validate/validate.go`)

`MarkerValues`/`ValidateMarkerValue` (validate.go:202/211), `RoleValues`/`ValidateRoleValue` (validate.go:224/232), and `FlairValues`/`ValidateFlairValue` (validate.go:244/253) each pair a `map[string]bool` closed set with a validator whose error message hand-lists the tokens (drift risk: adding a token requires editing the message string in sync with the set). Extract a generic closed-set validator that derives the error message from an ordered token list, e.g.:

```go
func validateClosedSet(value string, tokens []string, label string) string
// "Flair must be one of: nyan, naruto, onepiece (or empty to clear)"
```

Exported names (`ValidateMarkerValue`, `ValidateRoleValue`, `ValidateFlairValue`) and the exported set maps (if referenced elsewhere — `FlairValues` et al.) keep their signatures; internals delegate. Error message strings stay byte-identical to today's (existing tests assert them). The constitution §I rationale comment (closed set bounds the injection surface) lives once on the generic helper.

### Explicitly out of scope

- `handleWindowOptions` (`windows.go:413`) — the window-scope endpoint is already the generic seam at window scope (allowlist + per-key validation + batched `SetWindowOptions` + role radio). It is untouched except that it continues to consume the shared validators.
- Any new channel, any new settings section, any frontend change (`client.ts` `setSessionColor`/`setSessionFlair` are unaffected — API surface is identical).
- The `@rk_role` radio-clear machinery (`ClearWindowRoleExceptOnServer`) — channel-specific by design.

## Affected Memory

- (none) — pure implementation-only refactor; no spec-level behavior changes. Hydrate should verify `run-kit/architecture` still describes the backend accurately (it describes libraries at a level above these internals, so no edit is expected).

## Impact

- `app/backend/api/sessions.go` — extract shared session string-option handler helper
- `app/backend/internal/settings/settings.go` — section-registry parse/serialize
- `app/backend/internal/tmux/tmux.go` — generic session-option set/unset pair
- `app/backend/internal/validate/validate.go` — generic closed-set validator
- Tests: `sessions_test.go`, `settings_test.go`, `validate_test.go`, `tmux_test.go` pass **unchanged** — they are the zero-behavior-change safety net. No test edits expected; no new behavior to cover.
- No frontend, route, wire-format, or CLI changes. Gate: `cd app/backend && go test ./...` green, then `just test`.

## Open Questions

- (none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the four seams the backlog enumerates; no new channels, no API/wire changes | Backlog entry names all four seams explicitly and fixes the constraint "pure refactor, zero behavior change" | S:90 R:85 A:90 D:90 |
| 2 | Certain | Landing gate satisfied — PR #605 merged (commit 75318140 on main) | Verified in git log; the "land AFTER PR 605" condition is met | S:90 R:90 A:95 D:95 |
| 3 | Confident | settings.go seam covers only the two existing sections (server_colors map, board_order list); NO server_flairs section is added despite the backlog naming it | server_flairs does not exist in settings.go today; adding it would violate the entry's own zero-behavior-change constraint — the seam makes a future section data-only | S:70 R:75 A:85 D:75 |
| 4 | Confident | Exported surfaces keep names/signatures (tmux Set/Unset* wrappers over an unexported generic pair; Validate*Value delegating to a generic closed-set helper) | Keeps router.go tmuxOps interface, CLI callers, and existing tests untouched — the cheapest path to "tests pass unchanged" | S:65 R:80 A:85 D:80 |
| 5 | Certain | Per-channel empty-string semantics preserved via per-channel config in the shared handler (color: null clears, "" → 400; flair: null or "" clears) | Read directly from handleSessionColor/handleSessionFlair — unifying them would be a behavior change | S:75 R:80 A:90 D:85 |
| 6 | Confident | Existing tests are the safety net; no test edits and no new test files | Backlog states "existing tests pass unchanged"; a pure refactor adds no behavior to cover (code-quality's new-tests rule targets features/fixes) | S:70 R:85 A:80 D:70 |
| 7 | Confident | handleWindowOptions and the role radio-clear are out of scope | The window /options endpoint already is the generic seam at window scope; role radio is channel-specific by design | S:65 R:80 A:85 D:75 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
