# Plan: Extract Per-Row Channel Seams

**Change**: 260814-gxh9-extract-per-row-channel-seams
**Intake**: `intake.md`

## Requirements

### Backend: Session string-option endpoint

#### R1: Shared session string-option handler
`app/backend/api/sessions.go` MUST provide one shared helper for session-scoped string-option endpoints, parameterized per channel by: JSON body field name, value validator, tmux set/unset operations (via the existing `tmuxOps` interface methods), and per-channel empty-string semantics. `handleSessionColor` and `handleSessionFlair` SHALL delegate to it. Routes, handler wiring in `router.go`, response shapes, and the SSE-wake step (`initSSEHub` + `sseHub.wake(server)`, which moves into the shared helper) MUST behave identically to today.

Per-channel empty-string semantics MUST be preserved exactly:

- **color**: `null` clears; `""` fails `ValidateColorValue` → 400, zero tmux calls
- **flair**: `null` **or** `""` clears (`""` is a valid member of the flair closed set)

- **GIVEN** `POST /api/sessions/{s}/color` with `{"color": "1+3"}` **WHEN** the value validates **THEN** `@session_color` is set, the SSE hub wakes, and the response is `200 {"ok": true}`
- **GIVEN** `{"color": null}` **WHEN** posted **THEN** the option is unset (same wake + response)
- **GIVEN** `{"color": ""}` **WHEN** posted **THEN** 400 with the color validation message and zero tmux calls
- **GIVEN** `{"flair": ""}` or `{"flair": null}` **WHEN** posted **THEN** `@rk_session_flair` is unset
- **GIVEN** an invalid session name or malformed JSON **WHEN** posted **THEN** 400 exactly as today

### Backend: settings.yaml nested sections

#### R2: Section-registry parse/serialize
`app/backend/internal/settings/settings.go` `parse` and `serialize` SHALL drive their nested-section handling from a small data-driven section registry covering the two existing shapes — nested string **map** (`server_colors`, per-value normalization via `validate.NormalizeColorValue`) and nested string **list** (`board_order`) — instead of per-section booleans and inline branches. Serialization MUST stay byte-identical: same section order (`server_colors` before `board_order`, after scalars), sorted map keys, always-quoted values, sections omitted when empty. NO `server_flairs` section is added (it does not exist; adding one would be a behavior change).

- **GIVEN** any settings value set (themes, scalars, server colors, board order) **WHEN** serialized **THEN** the output is byte-identical to today's serializer
- **GIVEN** a settings file with legacy bare-integer colors, quoted values, comments, and unknown keys **WHEN** parsed **THEN** the resulting `Settings` struct equals today's parse result
- **GIVEN** the existing `settings_test.go` suite **WHEN** run unmodified **THEN** it passes

### Backend: tmux session-option helpers

#### R3: Generic session-option set/unset pair
The `internal/tmux` package MUST provide an unexported generic pair — `setSessionOption(ctx, server, session, option, value)` / `unsetSessionOption(ctx, server, session, option)` — wrapping the `set-option -t =session` / `set-option -u -t =session` invocations. The set half **already existed** in `board.go` (used by board pin-session vars); it is reused rather than duplicated, and the unset sibling is added next to it. The exported wrappers supply the standard timeout context. `SetSessionColor`, `UnsetSessionColor`, `SetSessionFlair`, and `UnsetSessionFlair` SHALL become thin wrappers naming their option constant, keeping exported names and signatures unchanged (the `tmuxOps` interface in `router.go` and all call sites stay untouched). The scope-split naming doc comment (`@rk_session_flair` not `@rk_flair`; `@session_color` not `@color`) MUST be preserved.

- **GIVEN** `SetSessionFlair("work", "nyan", "srv")` **WHEN** called **THEN** the identical tmux invocation fires as today (`set-option -t =work: @rk_session_flair nyan` via discrete args)
- **GIVEN** the `tmuxOps` interface and its prod/mock implementations **WHEN** the change lands **THEN** they compile without modification

### Backend: closed-set token validators

#### R4: Generic closed-set validator
`app/backend/internal/validate/validate.go` MUST define each closed set once as an ordered token slice and derive from it both the exported membership map (`MarkerValues`/`RoleValues`/`FlairValues` — consumed externally by `tmux.go` read paths, e.g. `validate.FlairValues[f]`, so the exported `map[string]bool` shape stays) and the validator error message. `ValidateMarkerValue`, `ValidateRoleValue`, and `ValidateFlairValue` SHALL delegate to one generic closed-set validator. Error message strings MUST be byte-identical to today's. The constitution §I rationale comment (closed set bounds the injection surface) lives once on the generic helper.

- **GIVEN** `ValidateFlairValue("bad")` **WHEN** called **THEN** the message is exactly `Flair must be one of: nyan, naruto, onepiece (or empty to clear)`
- **GIVEN** `validate.FlairValues[""]` and each named token **WHEN** checked **THEN** membership is identical to today
- **GIVEN** the existing validate tests **WHEN** run unmodified **THEN** they pass

### Non-Goals

- No `server_flairs` settings section — the seam makes a future section data-only; adding one now would change behavior
- No changes to `handleWindowOptions` / the window `/options` endpoint — it already is the generic seam at window scope; it merely keeps consuming the shared validators
- No changes to the `@rk_role` radio-clear machinery (`ClearWindowRoleExceptOnServer`) — channel-specific by design
- No frontend, route, wire-format, or CLI changes
- The scalar settings getter/setter pairs (`GetInstanceColor`/`SetSSHHost`/…) stay as-is — a consistent existing idiom, not one of the four proven seams

### Design Decisions

#### Thin exported wrappers over surface churn
**Decision**: Keep every exported name/signature (`SetSessionColor` et al., `ValidateMarkerValue` et al., the `Values` maps) and delegate to unexported generics.
**Why**: Zero interface churn — `router.go`'s `tmuxOps`, tmux.go's map consumers, and all tests compile and pass unchanged, which is the change's stated safety net.
**Rejected**: Collapsing call sites onto the generic functions directly — touches the interface, mocks, and tests, violating the "existing tests pass unchanged" constraint for no added value.
*Introduced by*: 260814-gxh9-extract-per-row-channel-seams

#### Ordered token slice as the single source of truth
**Decision**: Define each closed set as an ordered `[]string`; derive the exported membership map and the error message from it.
**Why**: Removes the set/message drift risk — today adding a token requires editing the map and the hand-written message in sync.
**Rejected**: Keeping map + separate message constant per channel — preserves exactly the duplication this seam exists to remove.
*Introduced by*: 260814-gxh9-extract-per-row-channel-seams

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] `app/backend/internal/validate/validate.go`: define ordered token slices for marker/role/flair; add generic closed-set validator deriving message from the slice; derive exported `Values` maps; delegate the three `Validate*Value` funcs — error strings byte-identical <!-- R4 -->
- [x] T002 [P] `app/backend/internal/tmux/`: reuse the pre-existing `setSessionOption` in `board.go` (discovered during apply — duplicating it in tmux.go was the anti-pattern this change removes), add the `unsetSessionOption` sibling next to it; rewrite `SetSessionColor`/`UnsetSessionColor`/`SetSessionFlair`/`UnsetSessionFlair` in tmux.go as thin wrappers supplying the timeout context, preserving scope-split doc comments <!-- R3 -->
- [x] T003 [P] `app/backend/api/sessions.go`: extract shared session string-option handler helper (field name, validator, set/unset ops, empty-string semantics per channel, SSE wake inside); `handleSessionColor`/`handleSessionFlair` delegate <!-- R1 -->
- [x] T004 [P] `app/backend/internal/settings/settings.go`: replace per-section booleans/branches in `parse` and per-section emit blocks in `serialize` with a section registry over map-shape (`server_colors`) and list-shape (`board_order`) sections; byte-identical output <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Verify: `cd app/backend && go test ./...` green with **zero edits to any `*_test.go`**; `git diff --name-only` contains no test files (verified: all 27 packages ok; 5 changed files, 0 test files) <!-- R1, R2, R3, R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: One shared session string-option helper exists in sessions.go; both channel handlers delegate to it; the SSE-wake block exists once
- [x] A-002 R2: `parse`/`serialize` walk a section registry covering `server_colors` (map) and `board_order` (list); no per-section booleans remain
- [x] A-003 R3: The four exported session-option funcs are thin wrappers over an unexported generic pair; `tmuxOps` interface unchanged
- [x] A-004 R4: The three `Validate*Value` funcs delegate to one generic closed-set validator; sets defined once as ordered slices; exported maps derived and still exported

### Behavioral Correctness

- [x] A-005 R1: Per-channel empty-string semantics preserved — color `""` → 400 with zero tmux calls; flair `""`/`null` → unset
- [x] A-006 R2: Settings serialization is byte-identical (section order, sorted keys, quoting, omit-when-empty)
- [x] A-007 R4: Validator error message strings byte-identical to current

### Scenario Coverage

- [x] A-008 R1, R2, R3, R4: Full backend suite (`go test ./...`) passes with zero test-file edits — the tests are the zero-behavior-change oracle

### Code Quality

- [x] A-009 Pattern consistency: New helpers follow surrounding naming, comment, and error-handling style
- [x] A-010 No unnecessary duplication: The four mirrored copies are actually collapsed (no near-identical handler/helper/validator pairs remain in the touched files)
- [x] A-011 No shell strings: All tmux invocations remain `exec.CommandContext` discrete-arg via `tmuxExecServer` (constitution §I)

## Notes

- Post-review should-fix addressed (review verdict was pass): the shared handler's map[string]json.RawMessage decode dropped encoding/json's case-insensitive key fold; replaced with a per-channel `decode` closure doing the original struct decode, preserving JSON field-matching semantics by construction. `go vet` + `go test ./api/` re-run green.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change collapses the four mirrored copies (handlers, tmux set/unset pairs, closed-set validators, settings section branches) into shared seams in place; the removed code was deleted in the same diff, and no other existing symbol, file, or config became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shared session-option handler is a plain unexported helper taking a per-channel config struct (not a handler factory registered in router.go) | Smallest diff; router wiring unchanged; either shape is behavior-identical and reversible | S:70 R:85 A:85 D:70 |
| 2 | Confident | Exported `Values` maps stay exported and are derived from the ordered slices at package init | tmux.go read paths index them directly (`validate.FlairValues[f]`); removing them would break compilation outside the seam's scope | S:75 R:80 A:90 D:80 |
| 3 | Confident | `SetWindowColor`/`UnsetWindowColor` are left untouched | Only ≥2 mirrored *session* pairs prove the seam; the window pair already notes it survives "for interface symmetry" and window options batch through `SetWindowOptions` | S:65 R:85 A:80 D:70 |
| 4 | Confident | Generic session-option pair lives in `board.go` (reusing the pre-existing `setSessionOption` over `tmuxExecRawServer`), not new code in tmux.go; wrappers pass their `withTimeout` ctx | Discovered during apply — a second `setSessionOption` would itself be the duplicated-utility anti-pattern; both exec helpers run identical `RunOutput` calls, and set-option's stdout is unused, so behavior is identical | S:70 R:85 A:90 D:80 |

4 assumptions (0 certain, 4 confident, 0 tentative).
