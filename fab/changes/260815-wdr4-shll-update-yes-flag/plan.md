# Plan: Dashboard update job — append `--yes` to the shll update argv

**Change**: 260815-wdr4-shll-update-yes-flag
**Intake**: `intake.md`

## Requirements

### Update API: unattended-consent argv

#### R1: The spawned `shll update` argv MUST carry `--yes` on both paths
`handleShllUpdate` (app/backend/api/update.go) MUST place `--yes` in the initial args slice immediately after the `update` subcommand — `args := []string{shllPath, "update", "--yes"}` — so both the scoped (non-force) and full-roster (force) spawns carry it. The flag is handler-added and MUST NOT pass through `validate.ValidateToolName` (which continues to guard only remote-manifest tool names).

- **GIVEN** shll is on PATH, the daemon is running, and the checker matches ≥1 tool
- **WHEN** a client POSTs `/api/update` with `{}` (non-force)
- **THEN** the job argv is `[<shll path> update --yes <matched tools in roster order…>]`

- **GIVEN** shll is on PATH and the daemon is running
- **WHEN** a client POSTs `/api/update` with `{"force":true}`
- **THEN** the job argv is `[<shll path> update --yes]` (full-roster sweep)

#### R2: The unattended-consent rationale MUST be documented at the spawn site
The `handleShllUpdate` doc comment MUST state why `--yes` is mandatory (the rk-jobs job window has a TTY but no operator, so shll's terminal `agent-setup` consent prompt would hang forever) and the release-sequencing dependency (shll gains `-y/--yes` via shll backlog `[3ovi]`; an older shll hard-errors on the unknown flag — accepted as visible-failure-over-silent-hang).

- **GIVEN** a reader at `handleShllUpdate`
- **WHEN** they read the doc comment
- **THEN** it explains the unattended-consent constraint and the shll `[3ovi]` sequencing dependency

#### R3: The exact-argv test assertions MUST cover `--yes` on both paths
The four exact-argv assertions in app/backend/api/update_test.go MUST expect the `--yes` flag: `TestHandleUpdateShllScopedSpawnsMatched` (`… update --yes fab-kit run-kit`), `TestHandleUpdateShllDropsFlagLikeToolName` (`… update --yes fab-kit`, hostile `--force` name still dropped), `TestHandleUpdateShllForceFullRoster` (`… update --yes`), `TestHandleUpdateShllPresentIgnoresBrew409` (`… update --yes fab-kit`). Shll-absent fallback tests (`rk update` self path) stay byte-identical.

- **GIVEN** the updated handler
- **WHEN** `go test ./api/` runs
- **THEN** all four updated assertions pass and every shll-absent-path test passes unchanged

### Non-Goals

- No shll-side change (`shll update`/`shll agent-setup` accepting `-y/--yes`) — filed as shll backlog `[3ovi]`, implemented in ~/code/sahil87/shll
- No change to `handleSelfUpdate` — code-read verified: `rk update` (cmd/rk/upgrade.go) runs brew/desktop/code-server legs only, no consent prompt anywhere
- No version probe or capability gating on the appended flag — unconditional append was the explicitly chosen design

### Design Decisions

#### Unconditional `--yes` append, no version gate
**Decision**: Append `--yes` to the spawned `shll update` argv unconditionally, with no probe of the installed shll's flag support.
**Why**: The button-driven flow is unattended by definition; an older shll without the flag hard-errors visibly in the job window (cobra unknown-flag), which is strictly better than the current silent indefinite hang at the consent prompt.
**Rejected**: Version/capability gating via the checker snapshot or `--help` sniffing — offered and rejected for complexity; the mismatch window closes once shll `[3ovi]` ships.
*Introduced by*: 260815-wdr4-shll-update-yes-flag

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/backend/api/update.go` `handleShllUpdate`: change the initial args slice to `[]string{shllPath, "update", "--yes"}` and extend the doc comment with the unattended-consent rationale + shll `[3ovi]` sequencing note <!-- R1, R2 -->
- [x] T002 In `app/backend/api/update_test.go`: update the four exact-argv `want` slices (ScopedSpawnsMatched, DropsFlagLikeToolName, ForceFullRoster, PresentIgnoresBrew409) to include `--yes` after `update` <!-- R3 -->

### Phase 2: Verification

- [x] T003 Run the backend API tests (`cd app/backend && go test ./api/`) and confirm all pass, including the untouched shll-absent fallback tests <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The scoped (non-force) spawn argv is `[<shll> update --yes <matched…>]` — verified by TestHandleUpdateShllScopedSpawnsMatched
- [x] A-002 R1: The force spawn argv is `[<shll> update --yes]` — verified by TestHandleUpdateShllForceFullRoster
- [x] A-003 R2: `handleShllUpdate`'s doc comment states the unattended-consent rationale and the shll sequencing dependency

### Behavioral Correctness

- [x] A-004 R1: The handler-added `--yes` does not ride through tool-name validation — hostile flag-like manifest names are still dropped (TestHandleUpdateShllDropsFlagLikeToolName passes with `--yes` present and `--force` absent)

### Scenario Coverage

- [x] A-005 R3: All four updated exact-argv assertions pass under `go test ./api/`
- [x] A-006 R3: The shll-absent fallback tests (`TestHandleUpdateAcceptedSpawns`, `TestHandleUpdateForceSkipsQualifyKeepsBrew`, etc.) pass byte-unchanged — `handleSelfUpdate`'s argv stays `[<selfPath> update]`

### Code Quality

- [x] A-007 Pattern consistency: The change follows the file's existing comment style (constraints, not narration) and argv-slice construction pattern
- [x] A-008 No unnecessary duplication: No new helpers or utilities introduced for a one-line argv change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (a flag on the spawned argv plus its rationale comment) without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Doc-comment update rides T001 rather than a separate polish task | One file, one seam — splitting would be ceremony | S:85 R:95 A:95 D:90 |
| 2 | Certain | Verification scope is `go test ./api/` (touched package), not the full suite | code-quality.md verification ladder starts at Go tests; scope-down per user's global test guidance; review re-runs affected tests anyway | S:80 R:95 A:90 D:85 |

2 assumptions (2 certain, 0 confident, 0 tentative).
