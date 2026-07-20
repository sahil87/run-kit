# Plan: GitHub-Source Backend for the incl.-Patches Update Check

**Change**: 260720-wb3n-github-source-patches-check
**Intake**: `intake.md`

## Requirements

### Backend: source-parameterized check seam

#### R1: `source` plumbed through 4 seams with literal argv mapping
The `source` parameter SHALL flow through exactly 4 seams: `client.ts checkForUpdates(source?)` → POST body `{"source":"github"}` → `handleUpdatesCheck` → `Checker.CheckNow(ctx, source)` → `defaultCheck` argv. `defaultCheck` MUST append the literal argv pair `"--source", "github"` only when the source equals the validated `github` enum value — the request string itself is never spliced into the command (Constitution I). The released path MUST keep today's exact argv (`check-updates --json`, no source flag), and the ambient loop (`Start` → `checkOnce`) and `RecheckAfter` MUST keep calling the flag-free released path.

- **GIVEN** a validated github-source check request
- **WHEN** the check exec runs
- **THEN** the argv is `check-updates --json --source github` (literal pair)
- **AND** a released check's argv stays `check-updates --json`

#### R2: Github checks are side-channel queries (no cache write, no OnQualify)
A github-sourced check SHALL run exec + verdict computation and return the Result, but MUST NOT write the shared cached verdict (Snapshot unchanged) and MUST NOT fire OnQualify (no SSE broadcast). The released path (ambient + default manual) MUST stay exactly as-is, including cache write + OnQualify-on-key-change.

- **GIVEN** a checker seeded with a released verdict (non-empty Key)
- **WHEN** a github-sourced `CheckNow` runs
- **THEN** the returned Result carries the github verdicts (all `Notable=false` under the no-notify github contract)
- **AND** `Snapshot()` still returns the seeded released verdict and OnQualify never fired
- **AND** a subsequent released check still caches and fires normally

#### R3: Handler validates the source enum
`handleUpdatesCheck` SHALL parse a tolerant request body (mirroring `updateRequest`'s posture): absent body / empty body / `{}` / absent or empty `source` key → the released default (existing clients POSTing `{}` unchanged). Only `"github"` is accepted as an override. An unrecognized non-empty `source` value MUST respond 400 `{"error":...}` without invoking the checker.

- **GIVEN** a POST /api/updates/check with body `{"source":"bogus"}`
- **WHEN** the handler parses it
- **THEN** it responds 400 with an error body and the check seam is never invoked
- **AND** absent body, `{}`, and `{"source":""}` all take the released path

#### R4: Response echoes the report's `source`
`updatecheck.Result` SHALL gain a `Source` field populated from the decoded report's `CheckReport.Source`, and the shared `updateAvailablePayload` builder (`sse.go`) SHALL gain a `source` JSON key — one builder serves both the POST response and the SSE slot, so the ambient slot also carries the report source (harmless, no-drift).

- **GIVEN** a github check whose report self-identifies `"source":"github"`
- **WHEN** the POST /api/updates/check response is composed
- **THEN** the payload carries `"source":"github"`

### Frontend: github-backed incl.-patches command

#### R5: Client wiring — `checkForUpdates(source?)` + echoed `source` parse
`checkForUpdates` SHALL accept an optional `source?: "github"` parameter: when `"github"` the POST body is `{"source":"github"}`, otherwise `{}` (unchanged). `UpdateCheckResult` SHALL gain `source: string`, parsed from the response and defensively defaulted to `""` when an old daemon omits it.

- **GIVEN** `checkForUpdates("github")`
- **WHEN** the request is issued
- **THEN** the POST body is `{"source":"github"}` and the parsed result carries the echoed `source`
- **AND** `checkForUpdates()` still POSTs `{}` and a source-less response parses to `source: ""`

#### R6: Hook mapping + annotation suppression
`useUpdateCheck.runUpdateCheck(includePatches)` SHALL map `includePatches === true` → `checkForUpdates("github")` (default check stays `checkForUpdates()`), and pass the echoed `result.source` into `composeCheckToast`. `composeCheckToast` SHALL gain the echoed source input and MUST suppress the `(patch — below notify threshold)` annotation when the source is `"github"` (no notify policy exists in that backend — every github row is `notable=false`). The `updateAvailable` filter and everything else in the toast composition MUST stay unchanged.

- **GIVEN** a github-sourced result with a non-notable pending update
- **WHEN** the incl.-patches toast is composed
- **THEN** the row is listed WITHOUT the `(patch — below notify threshold)` annotation
- **AND** a released-sourced (or source-less) non-notable row keeps the annotation

### Docs

#### R7: API spec updated
`docs/specs/api.md` SHALL document the `POST /api/updates/check` request body (`source` enum: absent/`{}` → released, `"github"` → GitHub backend, unknown → 400) and the `source` field on the response/SSE payload, including the side-channel (no cache write / no broadcast) semantics of a github check.

- **GIVEN** the spec's Updates section
- **WHEN** a reader checks the endpoint contract
- **THEN** the request enum, 400 error, payload `source` field, and side-channel posture are documented

### Non-Goals

- No shll-side change — the github contract (`schema: 1`, omits `notify`/`notable`, self-identifies `"source":"github"`) is already sufficient.
- No new version-skew handling — the manual path is already fail-loud (non-zero exit → 502 → error toast); the ambient loop's flag-free invocation stays untouched.
- No change to the toast's "Update Now" action (`forceUpdateNow` never consults the cached Matched set), palette labels, dev-gating, or the single-flight `checking` state.

### Design Decisions

#### Widen `SetCheckForTest` to carry the source
**Decision**: Change the exported test seam's stub signature to `func(source string) (CheckReport, error)` and mechanically update all existing call sites (which ignore the parameter), instead of adding a second source-aware seam.
**Why**: The intake (Assumption #13) pins "the test seam (`checkFn`/`SetCheckForTest`) carries the source through"; one seam keeps the package surface minimal and lets cross-package handler tests observe the requested source.
**Rejected**: A parallel `SetSourceCheckForTest` — two exported test hooks for one seam is drift-prone clutter.
*Introduced by*: 260720-wb3n-github-source-patches-check

#### `Source` appended last on the wire payload struct
**Decision**: Append `Source` as the last field of `updateAvailablePayload` (after `Latest`).
**Why**: Existing SSE tests assert substring adjacency of `"current":...,"latest":...`; appending last keeps those byte-fragment assertions valid.
**Rejected**: Inserting mid-struct — breaks `strings.Contains` fragment assertions for no benefit.
*Introduced by*: 260720-wb3n-github-source-patches-check

## Tasks

### Phase 1: Setup

- [x] T001 Add the github contract fixture `app/backend/internal/updatecheck/testdata/check-updates-github.json` — vendored-contract twin of `check-updates.json`: `"schema": 1`, `"source": "github"`, NO `notify`/`notable` fields on any row (run-kit minor bump + a sibling bump + an up-to-date row; keep an unknown-field tolerance probe) <!-- R2 -->

### Phase 2: Core Implementation (backend)

- [x] T002 `app/backend/internal/updatecheck/updatecheck.go`: add `SourceReleased`/`SourceGithub` constants; thread `source` through `checkFn`, `checkOnce`, `CheckNow(ctx, source)`, and `defaultCheck` (extract a `checkUpdatesArgs(source)` argv builder appending the literal `"--source", "github"` pair only for `SourceGithub`); add `Result.Source` (from `CheckReport.Source`); make the non-released path a side-channel (return computed Result without cache write or OnQualify); ambient callers (`Start`, `RecheckAfter`, `CheckOnceForTest`) stay released; widen `SetCheckForTest` to `func(source string)`; update the package/`CheckNow` doc comments (no-backend-flag posture now scoped to the released path) <!-- R1 R2 R4 -->
- [x] T003 `app/backend/internal/updatecheck/updatecheck_test.go`: mechanically update existing `SetCheckForTest` stubs; add github fixture contract test (decodes, source github, rows land `notable=false`); side-channel test (github `CheckNow` returns verdicts + `Source:"github"`, Snapshot unchanged, no OnQualify; released check afterwards still caches/fires); `checkUpdatesArgs` unit test (released vs github vs junk); seam pass-through test (stub captures the source `CheckNow`/ambient pass) <!-- R1 R2 R4 -->
- [x] T004 `app/backend/api/update.go`: add tolerant `updatesCheckRequest{Source string}` body parse to `handleUpdatesCheck` (absent/empty/`{}`/empty-source → released; `"github"` → `updatecheck.SourceGithub`; unknown non-empty → 400 `{"error":...}` without invoking the checker); pass the validated source to `CheckNow`; update the handler doc comment <!-- R1 R3 -->
- [x] T005 [P] `app/backend/api/sse.go`: add `Source string \`json:"source"\`` (appended last) to `updateAvailablePayload` and populate it in `buildUpdateAvailablePayload` from `verdict.Source` <!-- R4 -->
- [x] T006 `app/backend/api/update_test.go`: update `postUpdatesCheck` helper to take a body + existing stub signatures; add body-variant test (absent/`{}`/`{"source":""}` → released seam call), github test (`{"source":"github"}` → seam sees github, 200 echoes `"source":"github"`, cached snapshot untouched), unknown-source 400 test (seam never invoked) <!-- R3 R4 -->

### Phase 3: Frontend

- [x] T007 `app/frontend/src/api/client.ts`: `checkForUpdates(source?: "github")` — POST body `{"source":"github"}` when set, else `{}`; parse `source` from the response into `UpdateCheckResult.source` (default `""`) <!-- R5 -->
- [x] T008 `app/frontend/src/api/client.test.ts`: `checkForUpdates` wiring tests — default POSTs `{}` / github POSTs `{"source":"github"}` (captured request body), echoed `source` parsed, absent `source` defaults to `""` <!-- R5 -->
- [x] T009 `app/frontend/src/lib/palette-update.ts` + `palette-update.test.ts`: `composeCheckToast` gains the echoed `source` input (optional, default `""`); suppress the `(patch — below notify threshold)` annotation when source is `"github"`; tests for github-suppressed vs released/absent-annotated <!-- R6 -->
- [x] T010 `app/frontend/src/hooks/use-update-check.ts` + new `use-update-check.test.tsx`: map `includePatches` → `checkForUpdates("github")` (default → no source); pass `result.source` into `composeCheckToast`; hook tests (mock client/context/toast) asserting the mapping and that a github-echoed non-notable row toasts without the annotation <!-- R6 -->

### Phase 4: Polish

- [x] T011 `docs/specs/api.md`: document the `POST /api/updates/check` request body `source` enum (+400 error), the payload/SSE `source` field, and the github side-channel semantics <!-- R7 -->

## Execution Order

- T002 blocks T003, T004, T005 (Go types/signatures first)
- T004 blocks T006
- T007 blocks T008 and T010
- T009 blocks T010 (toast signature first)
- T001 and T011 are independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: `source` flows client → POST body → handler → `CheckNow(ctx, source)` → `defaultCheck`, with the literal `"--source", "github"` argv pair appended only for the validated github value; released argv byte-unchanged; ambient loop + `RecheckAfter` stay flag-free
- [x] A-002 R2: a github `CheckNow` returns the computed Result but leaves `Snapshot()` unchanged and never fires OnQualify; the released path still caches + fires
- [x] A-003 R3: unknown non-empty `source` → 400 without invoking the checker; absent/`{}`/empty-source → released
- [x] A-004 R4: `Result.Source` echoes `CheckReport.Source` and the shared payload builder emits a `source` JSON key on both the POST response and the SSE slot
- [x] A-005 R5: `checkForUpdates("github")` POSTs `{"source":"github"}`, `checkForUpdates()` POSTs `{}`; `UpdateCheckResult.source` parses with `""` default
- [x] A-006 R6: incl.-patches maps to `checkForUpdates("github")` and the echoed source reaches `composeCheckToast`; the `(patch — below notify threshold)` annotation is suppressed exactly when source is `"github"`
- [x] A-007 R7: `docs/specs/api.md` documents the request enum, 400 mapping, payload `source` field, and side-channel posture

### Behavioral Correctness

- [x] A-008 R2: existing released-path behavior (cache write, OnQualify-on-key-change, chip/dismissal-key/scoped-update semantics) is byte-preserved — all pre-existing updatecheck/api/SSE tests still pass
- [x] A-009 R6: the incl.-patches `updateAvailable` filter and the default check's notable-only filter are unchanged; only the annotation keys off the source

### Scenario Coverage

- [x] A-010 R2: github fixture test proves the no-notify contract decodes to `notable=false` rows and the side-channel scenario (seed released → github check → released re-check) is exercised
- [x] A-011 R3: handler tests cover absent body, `{}`, `{"source":""}`, `{"source":"github"}`, and unknown-value 400

### Edge Cases & Error Handling

- [x] A-012 R3: a malformed JSON body degrades to the released default (mirroring `updateRequest`'s tolerant posture), never 500
- [x] A-013 R5: an old daemon's response without `source` parses to `""` and the annotation behavior falls back to today's (annotated)

### Code Quality

- [x] A-014 Pattern consistency: new code follows the surrounding patterns (doc-comment style, seam-based test stubs, msw client tests, context-free pure builders)
- [x] A-015 No unnecessary duplication: one payload builder keeps POST/SSE shapes converged; one argv builder owns the source flag
- [x] A-016 Security: nothing user-controlled reaches argv — closed enum in the handler, literal flag pair in `defaultCheck` (`exec.CommandContext`, argument slices)
- [x] A-017 Tests included for all added/changed behavior (features MUST include tests per code-quality.md)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — this change is purely additive (a new `SourceReleased`/`SourceGithub` enum, a `source` parameter threaded through the existing check seam, and a side-channel early-return branch in `checkOnce`). No existing files, functions, branches, or config were made redundant. The prior flag-free argv is now produced by `checkUpdatesArgs(SourceReleased)` (a refactor into a reused, unit-tested builder — not a redundancy), and the `SetCheckForTest` signature widening replaced all call sites in place rather than deprecating a symbol.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Widen `SetCheckForTest`'s stub signature to `func(source string) (CheckReport, error)` and update all ~12 existing call sites, rather than adding a second exported source-aware seam | Intake #13 says the test seam "carries the source through"; one seam is cleaner and call-site updates are mechanical | S:70 R:90 A:85 D:80 |
| 2 | Confident | `Result.Source` is populated for BOTH paths from `CheckReport.Source` (released passes carry `"released"` from real shll; legacy test stubs without a Source land `""` — harmless) | Follows the intake's "echo the report's source" + shared-builder decision; no per-path special-casing | S:65 R:90 A:85 D:80 |
| 3 | Confident | Malformed JSON body on /api/updates/check degrades to the released default (decode error ≠ unknown enum value), mirroring `handleUpdate`'s tolerant posture at update.go:124 | Intake pins tolerant parse "mirroring updateRequest's posture"; 400 is reserved for a successfully-parsed unknown source | S:60 R:85 A:85 D:75 |
| 4 | Confident | `composeCheckToast`'s source parameter is optional with default `""` (annotation kept), so the module stays context-free and an old-daemon `""` source behaves exactly as today | Intake #14 leaves the exact signature shape open; optional-with-default is the minimal back-compatible shape | S:60 R:90 A:85 D:80 |
| 5 | Confident | Hook coverage is a NEW `use-update-check.test.tsx` (none exists today) mocking `@/api/client`, `@/contexts/session-context`, and `@/components/toast` via `vi.mock` + `renderHook` | Intake's test list names "hook mapping incl.-patches → github" coverage; module-mocking is the established Vitest pattern for context-consuming hooks | S:60 R:90 A:80 D:75 |
| 6 | Certain | `updateAvailablePayload.Source` is appended LAST so existing byte-fragment SSE assertions (`"current":...,"latest":...` adjacency in sse_test.go/state_ws_test.go) keep passing | Verified the fragment assertions; field order follows struct order in encoding/json | S:80 R:95 A:95 D:90 |

6 assumptions (1 certain, 5 confident, 0 tentative).
