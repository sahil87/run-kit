# Plan: Delegate Update Check to `shll check-updates` + Rework the Update Command Surface

**Change**: 260720-n2ai-shll-check-updates-delegation-palette-checks
**Intake**: `intake.md`

## Requirements

### Backend: updatecheck delegation

#### R1: One-exec delegation to `shll check-updates`
The checker core (`app/backend/internal/updatecheck/updatecheck.go`) MUST replace the manifest HTTP fetch, the `brew list --versions` join, and the sibling-wide threshold evaluation with ONE exec of `shll check-updates --json` per check pass, via `exec.CommandContext` with an argument slice and a named 30s timeout constant (`checkTimeout`). The manifest-fetch and brew-join code paths MUST be deleted with no fallback direct fetch. The JSON contract (`schema: 1`, per-tool `{name, formula, installed, latest, notify, update_available, notable}`) MUST be vendored as a test fixture; unknown fields are tolerated; a `schema != 1` report is a failed check.

- **GIVEN** a non-suppressed checker whose check seam returns the vendored-contract report
- **WHEN** a check pass runs
- **THEN** exactly one `shll check-updates --json` exec occurs (no HTTP fetch, no brew exec) and per-tool verdicts are consumed from its JSON

#### R2: run-kit row local comparison; siblings verbatim
The run-kit row MUST be compared locally against the running ldflags version using shll's `latest` + `notify` for that row, producing BOTH verdicts: `update_available` (installed < latest, any increase) and `notable` (bump crosses the notify threshold). The row keeps its `selfBrew` gate (a non-brew daemon's own row is omitted entirely). Sibling-tool verdicts MUST be trusted verbatim (no re-evaluation). The minimal semver helpers (`normalizeTag`, `parseMajorMinor`, `parsePatch`, `crossesThreshold`, `minorOrMajorIncrease`, `anyIncrease`) are retained solely as the machinery for this one local comparison (and `New`'s suppression parse).

- **GIVEN** a running version `3.8.1` (selfBrew) and a report row `run-kit {installed: 3.8.0, latest: 3.8.2, notify: minor}`
- **WHEN** a check pass runs
- **THEN** the run-kit verdict is `{installed: 3.8.1, latest: 3.8.2, update_available: true, notable: false}` (local comparison against 3.8.1, not shll's 3.8.0)
- **AND** a sibling row's `update_available`/`notable` booleans pass through unchanged

#### R3: Preserved cadence and verdict semantics
The 6h `checkInterval`, 30s `initialCheckDelay`, in-memory mutex-guarded `Result`, changed-set `OnQualify` callback (fire on any Key change including to empty), `RecheckAfter`, and dev-build suppression MUST remain unchanged. The dismissal `Key` and `Matched` set MUST stay computed from the NOTABLE set only.

- **GIVEN** a seeded notable verdict
- **WHEN** a later pass produces the same notable Key
- **THEN** `OnQualify` does not re-fire; a Key change (including to empty) fires exactly once

#### R4: Fail-silent-retain ambient posture; fail-loud manual seam
When `shll` is not on PATH, exits non-zero, or emits unparseable/wrong-schema JSON, the ambient check MUST skip silently that pass and retain the previous verdict (warn log only). The checker MUST expose an exported `CheckNow(ctx)` that runs one inline pass (same code path as the loop) and returns `(Result, error)` so the manual endpoint can surface the failure, plus a `Suppressed()` accessor.

- **GIVEN** a seeded verdict and a check seam returning an error
- **WHEN** an ambient pass runs
- **THEN** the previous verdict is retained and `OnQualify` does not fire
- **AND** `CheckNow` returns that error to its caller

#### R5: Result carries the full pending-update verdict list
`Result` MUST gain `Tools []ToolVerdict` — every tool with a pending update (`update_available` true, including sub-threshold `notable:false` rows), in deterministic sorted-name order; up-to-date tools are omitted. `Matched []ToolUpdate` (the notable subset), `Key`, and the transitional `Current`/`Latest` compat fields are retained unchanged in meaning.

- **GIVEN** verdicts run-kit (notable) and tu (update_available, not notable)
- **WHEN** a check pass completes
- **THEN** `Tools` lists both, `Matched`/`Key` carry only run-kit

### Backend: API surface

#### R6: POST /api/updates/check on-demand endpoint
A new `POST /api/updates/check` MUST be registered in `router.go` alongside `POST /api/update`. It runs one immediate inline checker pass via `CheckNow` (updating the cache and firing the SSE broadcast through the existing OnQualify seam), and returns the fresh verdict synchronously as 200 JSON in the same shape as the SSE payload. Failure mapping: check failure → 502 `{"error":"update check unavailable — ..."}`; suppressed or nil checker → 409. No extra in-flight lock.

- **GIVEN** a wired non-suppressed checker whose pass finds verdicts
- **WHEN** the endpoint is POSTed
- **THEN** it responds 200 with `{tools, key, current, latest}` reflecting the fresh pass
- **AND** with a failing check seam it responds 502 with an error body; on a dev-suppressed checker 409

#### R7: Extended SSE update-available payload
The SSE `update-available` payload MUST carry the full per-tool verdict list: each `tools[]` entry gains camelCase `updateAvailable` and `notable` booleans, built from `Result.Tools`; `key`/`current`/`latest` semantics are unchanged (notable-derived). A single shared payload builder MUST serve both `broadcastUpdateAvailable` and the endpoint response so the two shapes can never drift.

- **GIVEN** a verdict with one notable and one sub-threshold tool
- **WHEN** the broadcast fires
- **THEN** the payload lists both tools with their flags and a key derived from the notable set only

### Frontend: verdict shape and chip

#### R8: Context verdict shape + notable filtering
`UpdateTool` (`session-context.tsx`) MUST gain optional `updateAvailable?: boolean` / `notable?: boolean` fields, parsed from the extended SSE payload; a missing flag is treated as `true` (an old-daemon payload listed only matched tools). `useUpdateNotification` MUST filter its returned `tools` (and everything derived: `qualifies`, `showChip`, `singleRunKit`, `latest`, `current`) to the notable set with stable referential identity, so the chip, overflow menu, and dismissal semantics ride unchanged (chip stays policy-driven: patch-only findings never light it).

- **GIVEN** an update-available payload whose only tools have `notable:false`
- **WHEN** the chip renders
- **THEN** it stays hidden (`qualifies` false); a notable tool in the payload lights it as today

### Frontend: palette + toast surface

#### R9: Palette command surface rework
`palette-update.ts` MUST delete `updateActionLabel` and the qualifying-gated update entry — `buildUpdateActions` keeps only `run-kit: Dismiss Update Notice` (same gate: `qualifies` + non-empty tools). A new `buildCheckActions(version, onCheck, onCheckAll)` MUST add `run-kit: Check for Updates` and `run-kit: Check for Updates (incl. patches)`, hidden on the `dev` sentinel (same pattern as `buildMaintenanceActions`; null version = non-dev). `run-kit: Update Now` (force POST `/api/update`) and `run-kit: Restart Daemon` stay unchanged as the single update action. Both palette mounts (AppShell `app.tsx` and the board route `board-page.tsx`) MUST carry the new surface.

- **GIVEN** a non-dev daemon
- **WHEN** the palette opens
- **THEN** it offers the two check entries, Update Now (brew-gated), Restart, and (when a notable update is pending) Dismiss — and never a `run-kit: Update to v{X}` entry
- **AND** on the `dev` sentinel the check entries are hidden

#### R10: Check-result toast reporting
A new client helper `checkForUpdates()` MUST POST `/api/updates/check` and return the parsed verdict (rejecting with the server error message on non-2xx). A pure `composeCheckToast(tools, includePatches)` in `palette-update.ts` MUST compose the report: default view filters `notable`, incl.-patches view filters `update_available` with sub-threshold rows annotated `(patch — below notify threshold)`; empty → `All tools up to date`. A shared `useUpdateCheck` hook MUST wire both palette mounts: info toast with the summary; when something updatable is reported AND the daemon can update (brew, non-dev), the toast's action slot carries **Update Now** triggering the same force-update flow; on request failure an error toast surfaces the message (e.g. shll missing). No intermediate "checking…" toast.

- **GIVEN** a check response with `tu {0.9.1→0.9.2, notable:false}` only
- **WHEN** the default check runs
- **THEN** the toast reads "All tools up to date"; the incl.-patches check reads `tu v0.9.1 → v0.9.2 (patch — below notify threshold)` with an Update Now action (brew, non-dev)
- **AND** when the POST rejects, an error toast shows the server's message

### Docs

#### R11: API spec documentation
`docs/specs/api.md` MUST document the new `POST /api/updates/check` endpoint (request/response/status codes) and the extended `update-available` payload shape.

- **GIVEN** the spec file
- **WHEN** a reader looks up the update surface
- **THEN** the endpoint and payload fields are documented and listed in the route summary

### Non-Goals

- The unified toolbar update button (promote/demote placement) — explicitly deferred; the existing chip only needs to keep working on the new verdict shape.
- Plumbing the `github` backend through the daemon — both check commands ride shll's default `released` backend (run-kit passes no backend flag: plain `shll check-updates --json` stays valid across shll's `--released`→`--source` flag consolidation); the minor/patch distinction is client-side filtering.
- Removing the transitional `Current`/`Latest` compat fields — retained through this change.

### Design Decisions

#### Notable-set Key preserved as the single convergence key
**Decision**: The composite dismissal `Key` and `Matched` stay derived from the notable set only; sub-threshold verdicts ride the payload but never affect Key/OnQualify.
**Why**: Keeps chip, dismissal, `/api/update` argv, and `use-update-click` completion-signal semantics byte-compatible; patch-only findings are toast-only by design (intake B.5, assumption 15).
**Rejected**: Keying on the full update_available set — would light/redirty the chip on patch bumps and churn dismissals.
*Introduced by*: 260720-n2ai-shll-check-updates-delegation-palette-checks

#### Shared check-flow hook instead of per-mount duplication
**Decision**: The check-command POST→toast flow lives in one `useUpdateCheck` hook consumed by both palette mounts.
**Why**: Mirrors `use-update-click.ts`'s anti-drift extraction for the exact bar↔board duplication the registry pattern warns about.
**Rejected**: Duplicating the flow inline in `app.tsx` and `board-page.tsx` — two copies of toast composition/error mapping would drift.
*Introduced by*: 260720-n2ai-shll-check-updates-delegation-palette-checks

### Deprecated Requirements

#### `run-kit: Update to v{X}` qualifying-gated palette entry
**Reason**: Multi-tool ambiguous (the update is toolkit-scoped) and stale between check passes.
**Migration**: `run-kit: Update Now` is the single update action; version detail lives in check-result toasts and the chip summary.

#### Direct manifest fetch + brew join + sibling threshold evaluation
**Reason**: Parallel implementation of shll's canonical check logic; drift risk (Constitution III).
**Migration**: One `shll check-updates --json` exec; verdicts consumed verbatim (run-kit row locally recompared).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rework `app/backend/internal/updatecheck/updatecheck.go`: delete manifest fetch/brew join/sibling threshold eval; add `CheckReport`/`CheckTool` contract types, `checkFn` seam + `defaultCheck` (LookPath + `exec.CommandContext`, 30s `checkTimeout`, schema gate), `ToolVerdict` + `Result.Tools`, run-kit local comparison with selfBrew gate, `CheckNow(ctx) (Result, error)`, `Suppressed()`; keep cadence/OnQualify/RecheckAfter/suppression unchanged <!-- R1 R2 R3 R4 R5 -->
- [x] T002 Rework `app/backend/internal/updatecheck/updatecheck_test.go` to the check-exec seam (`SetCheckForTest`), vendor the JSON contract as `testdata/check-updates.json` with a parse-tolerance test, and cover: run-kit local comparison (both verdicts, selfBrew gate), sibling verbatim trust, notable-only Key/Matched, OnQualify fire/clear/no-refire, failure-retain posture, CheckNow error surfacing, RecheckAfter, suppression <!-- R1 R2 R3 R4 R5 -->
- [x] T003 Extend the SSE payload in `app/backend/api/sse.go`: `updateAvailableTool` gains `updateAvailable`/`notable`; extract a shared payload builder used by `broadcastUpdateAvailable`; adapt `sse_test.go` / `state_ws_test.go` fixtures and expectations <!-- R7 -->
- [x] T004 Add `handleUpdatesCheck` in `app/backend/api/update.go` + register `POST /api/updates/check` in `router.go`; rework `update_test.go` checker construction to the new seam and add handler tests (200 fresh verdict, 502 check-failure, 409 suppressed/nil) <!-- R6 -->

### Phase 3: Integration & Edge Cases (frontend)

- [x] T005 Extend `app/frontend/src/contexts/session-context.tsx`: `UpdateTool` optional `updateAvailable`/`notable`, SSE parse of the flags, notable filtering (missing-flag=true, stable identity) inside `useUpdateNotification`; add chip-filter coverage in `update-chip.test.tsx` (sub-threshold-only payload hides the chip) <!-- R8 -->
- [x] T006 [P] Add `checkForUpdates()` client helper in `app/frontend/src/api/client.ts` (POST `/api/updates/check`, tolerant parse, throwOnError) <!-- R10 -->
- [x] T007 Rework `app/frontend/src/lib/palette-update.ts` + `palette-update.test.ts`: delete `updateActionLabel` + the update entry (Dismiss-only `buildUpdateActions`), add `buildCheckActions` (dev-gated) and `composeCheckToast` (notable/incl.-patches filtering, sub-threshold annotation, up-to-date message) with unit tests <!-- R9 R10 -->
- [x] T008 Add `app/frontend/src/hooks/use-update-check.ts` (shared POST→toast flow with gated Update Now action slot + error toast) and wire the new surface into `app/frontend/src/app.tsx` (check actions, reworked buildUpdateActions call) <!-- R9 R10 -->
- [x] T009 Wire the same surface into `app/frontend/src/components/board/board-page.tsx` (check entries via the shared hook; reworked buildUpdateActions call) <!-- R9 -->

### Phase 4: Polish

- [x] T010 Document `POST /api/updates/check` + the extended `update-available` payload in `docs/specs/api.md` (endpoint section + route summary) <!-- R11 -->

## Execution Order

- T001 blocks T002, T003, T004
- T005–T007 are independent of each other after T004; T008 depends on T006 + T007; T009 depends on T008

## Acceptance

### Functional Completeness

- [x] A-001 R1: The checker performs exactly one `shll check-updates --json` exec per pass; manifest-fetch and brew-join code paths are gone with no fallback fetch
- [x] A-002 R2: run-kit's row is compared locally against the running ldflags version producing both verdicts; sibling verdicts pass through verbatim; the selfBrew gate holds
- [x] A-003 R5: `Result.Tools` lists every pending-update tool (incl. sub-threshold) sorted by name; `Matched`/`Key` remain notable-only
- [x] A-004 R6: `POST /api/updates/check` runs an inline pass, updates the cache, broadcasts via the existing OnQualify seam, and returns the fresh verdict synchronously
- [x] A-005 R7: The SSE payload carries per-tool `updateAvailable` + `notable`, produced by one shared builder also used for the endpoint response
- [x] A-006 R8: `UpdateTool` carries the optional flags and `useUpdateNotification` filters to the notable set with a missing flag treated as true
- [x] A-007 R9: The palette offers the two check entries (dev-hidden), Dismiss-only `buildUpdateActions`, unchanged Update Now/Restart, and no `Update to v{X}` entry — on both palette mounts
- [x] A-008 R10: Check results report via info toast (per-tool summary, sub-threshold annotation, "All tools up to date") with a gated Update Now action slot; manual failure raises an error toast
- [x] A-009 R11: `docs/specs/api.md` documents the new endpoint and extended payload

### Behavioral Correctness

- [x] A-010 R3: 6h cadence, 30s initial delay, stale-while-revalidate retention, OnQualify changed-set semantics (incl. clear-to-empty), RecheckAfter, and dev suppression are byte-compatible with today
- [x] A-011 R4: Ambient failure (shll missing / non-zero / unparseable / wrong schema) skips the pass silently retaining the previous verdict; `CheckNow` surfaces the same failure as an error
- [x] A-012 R8: A patch-only verdict never lights the chip; a manual check finding a notable update lights it immediately via the shared cached verdict

### Removal Verification

- [x] A-013 R9: `updateActionLabel` and the qualifying-gated update entry are deleted from `palette-update.ts` (no dead label-composition code); `defaultFetch`/`defaultBrewList`/`parseBrewVersions`/`computeMatched` are deleted from `updatecheck.go`

### Scenario Coverage

- [x] A-014 R1: Go tests exercise the vendored `testdata/check-updates.json` fixture (schema gate, unknown-field tolerance)
- [x] A-015 R10: Unit tests cover `composeCheckToast` (both views, annotation, empty) and `buildCheckActions` (dev gating)

### Edge Cases & Error Handling

- [x] A-016 R6: 502 with an `{"error": ...}` body on check failure; 409 on a suppressed or nil checker
- [x] A-017 R8: An old-daemon payload without flags keeps today's behavior (all listed tools treated as notable)

### Code Quality

- [x] A-018 Pattern consistency: New code follows naming and structural patterns of surrounding code (seam-style test hooks, pure palette builders, shared hooks)
- [x] A-019 No unnecessary duplication: shared payload builder (backend), shared check-flow hook (frontend), reuse of `updateChipToolSummary`-style composition
- [x] A-020 Subprocess discipline: the new exec uses `exec.CommandContext` with an argument slice and a named timeout constant; no shell strings

### Security

- [x] A-021 R1: shll output is remote-influenced input — tool names from the report still pass `validate.ValidateToolName` before reaching `shll update` argv (existing gate preserved)

## Notes

- Rollout: the shll change (260720-puxw) has not shipped — the PR body must note the feature goes live only once a shll release carries `check-updates`; until then the not-on-PATH path keeps the checker silent.

## Deletion Candidates

- `app/backend/internal/updatecheck/updatecheck.go` (`Current`/`Latest` on `Result`, `runKitFields`) — transitional run-kit-row compat fields; retained THIS change by design (plan Non-Goals) for not-yet-reloaded clients keying off a non-empty `latest`. Follow-up removal once all clients consume the per-tool `tools[]` list.
- `app/frontend/src/contexts/session-context.tsx` (`UpdateAvailable.current`/`.latest`, `useUpdateNotification`'s `current`/`latest`) — the frontend twin of the above transitional compat; remove together with the backend fields in the same follow-up.
- None missed by apply — every symbol the change made redundant (`updateActionLabel`, the `Update to v{X}` entry, `defaultFetch`/`defaultBrewList`/`parseBrewVersions`/`computeMatched`, `Manifest`/`ManifestTool`, `SetFetchForTest`/`SetBrewListForTest`/`SetLookShllForTest`) was already deleted during apply (verified absent). `updateNow` is NOT redundant — the top-bar chip / overflow-menu click flow (`use-update-click.ts`) still uses it for the scoped `POST /api/update`; only the palette dropped it in favor of the force path.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Retain the minimal semver helpers (`normalizeTag`/`parseMajorMinor`/`parsePatch`/`crossesThreshold`/`minorOrMajorIncrease`/`anyIncrease`) — the intake's deletion list names the threshold-eval path, but its own run-kit-row requirement ("local comparison must produce BOTH verdicts") needs exactly this machinery; what is deleted is the sibling-wide evaluation | Intake internally requires it; `parseMajorMinor` also backs `New`'s suppression parse | S:85 R:85 A:90 D:90 |
| 2 | Confident | run-kit local `update_available` = any strict version increase (a downgrade/equal manifest never matches — today's posture) | "installed < latest" semantics; matches existing `anyIncrease` | S:70 R:90 A:90 D:85 |
| 3 | Confident | `Result.Tools` (and the SSE/endpoint payload) carries only pending-update tools (`update_available` true, incl. sub-threshold); up-to-date tools omitted — both check views and "All tools up to date" derive from it | Lean payload; no consumer needs up-to-date rows; empty list = up to date | S:60 R:85 A:85 D:80 |
| 4 | Confident | When `!selfBrew`, the run-kit row is omitted from `Tools` entirely (not just `Matched`) — surfacing it in check results would advertise an un-actionable update | Extends intake assumption 14 to the new verdict list | S:55 R:90 A:85 D:80 |
| 5 | Confident | `schema != 1` is a failed check (ambient skip-retain; manual 502) — fail-closed on contract drift | Intake says "expect schema: 1"; drift means the caller no longer understands the contract | S:60 R:90 A:85 D:80 |
| 6 | Confident | Exit 0 with an empty `tools` list is a valid report (verdict clears) — shll signals check failure via exit 1, so exit 0 + empty is a genuine nothing-resolvable state | "Trust shll's verdicts verbatim"; exit-code contract is explicit | S:55 R:85 A:80 D:75 |
| 7 | Confident | The existing SSE `tools` array is extended in place with camelCase `updateAvailable`/`notable` (rk payload convention), key stays notable-derived; the frontend treats a missing flag as true so old-daemon payloads keep today's meaning; a not-yet-reloaded old client may transiently show sub-threshold rows in its chip until its tab reloads — accepted | Matches intake "payload extended to the full list"; camelCase matches sibling rk payload fields | S:65 R:80 A:85 D:80 |
| 8 | Confident | Nil checker on `POST /api/updates/check` → 409 (grouped with the suppressed posture; intake assumption 18) | Unwired checker ≈ suppressed from the client's view; low blast radius | S:45 R:90 A:80 D:70 |
| 9 | Confident | The check POST→toast flow is one shared `useUpdateCheck` hook consumed by both palette mounts | Mirrors `use-update-click.ts`'s anti-drift extraction precedent | S:55 R:90 A:90 D:85 |
| 10 | Confident | No new Playwright spec: the e2e dev server runs the `dev` sentinel, which hides the new check entries by design; coverage is unit-level (builders, toast composition, chip filter) — consistent with the existing update surface (no update e2e exists today) | Dev-gating makes a real-backdrop e2e impossible without full socket+route mocking; marginal value low | S:50 R:85 A:80 D:75 |
| 11 | Confident | `buildUpdateActions` keeps its name and the `run-kit-dismiss-update` id with only the Dismiss entry remaining (signature drops `onUpdate`) | Minimal churn; intake deletes the entry, not the builder | S:55 R:95 A:90 D:85 |

11 assumptions (1 certain, 10 confident, 0 tentative).
