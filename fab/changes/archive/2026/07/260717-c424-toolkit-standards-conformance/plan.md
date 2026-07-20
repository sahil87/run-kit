# Plan: Toolkit Standards Conformance

**Change**: 260717-c424-toolkit-standards-conformance
**Intake**: `intake.md`

## Requirements

<!-- Requirements are derived from the intake's audit-and-proportionate-fix
     mandate. The audit itself (enumerate standards, assess each) is the entry
     work; the requirements below capture the FIXES the audit justified plus the
     deferral bookkeeping and the report deliverable. Standards enumerated at
     apply time (shll v0.0.23): principles, help-dump, readme-extraction, skill. -->

### help-dump: JSON envelope contract

#### R1: The help-dump envelope MUST NOT emit `captured_at`
The `run-kit help-dump` JSON envelope MUST be exactly `{tool, version, schema_version, root}`. The `captured_at` field is owned by the shll.ai puller (a tool cannot know its own capture time) and MUST NOT appear in the tool's output — the help-dump standard states this as a rule "with teeth".

- **GIVEN** a HEAD build `bin/rk`
- **WHEN** `bin/rk help-dump` runs
- **THEN** the stdout JSON has keys exactly `{tool, version, schema_version, root}`
- **AND** the `captured_at` key is absent
- **AND** exit is 0, stderr empty, stdout valid JSON, and `completion`/`help`/hidden nodes are absent from the tree (the rest of the help-dump checklist, already conformant, stays conformant)

### readme-extraction: link discipline

#### R2: Links leaving the published set MUST be absolute
Every link in the published set (`README.md` AND `docs/site/**`) that targets a path outside it — e.g. `docs/specs/`, source files, the repo README from inside `docs/site/` — MUST be written as an absolute `https://…` URL, because a relative link escaping the published tree 404s on the rendered shll.ai page (readme-extraction rule 1 "Closure" / rule 5 "absolute-by-author"). README→`docs/site/` links and between-`docs/site/` links (the two auto-rewritten forms) stay relative.

- **GIVEN** the repo `README.md` and every file under `docs/site/`
- **WHEN** their relative link targets are enumerated (the standard's closure sweep)
- **THEN** no relative link points outside the published set (the README's `docs/specs/agent-state.md` reference is rewritten to its absolute `https://github.com/sahil87/run-kit/blob/main/docs/specs/agent-state.md` form)
- **AND** `docs/site/install.md`'s `../../README.md#agent-state--run-kit-agent-setup` link is rewritten to its absolute `https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup` form <!-- rework (cycle 1): closure violation found by review, missed by the audit sweep -->
- **AND** README→`docs/site/*.md` links and between-`docs/site/` links remain relative (correct per the standard's two auto-rewrite forms)

### principles: additive scriptability fixes

#### R3: `run-kit status` MUST offer a machine-readable format
`status` output is data the caller asked for (Principle 2: "Commands whose output is meant to be consumed programmatically MUST offer a machine-readable format (`--json`)"). `run-kit status` MUST accept `--json` and, when set, emit a stable JSON document to stdout (stderr empty on success).

- **GIVEN** a HEAD build
- **WHEN** `bin/rk status --json` runs against a reachable tmux server
- **THEN** it writes a JSON array/object of sessions (each with name + window count) to stdout
- **AND** the human (non-`--json`) output is unchanged
- **AND** `--json` on errorful unreachability (stale socket, permission) surfaces the error on stderr with a non-zero exit (no partial JSON); a cleanly-absent server ("no server running") is empty-success — `[]` + exit 0 — by deliberate `internal/tmux.ListSessions` semantics, matching the human path <!-- reworded in review cycle 1 to match verified semantics -->

#### R4: `run-kit doctor` MUST offer a machine-readable format
`doctor` is the toolkit's named `--json` reference (Principle 2, enforced-by: "`shll list`, `shll doctor` … carry `--json`"). `run-kit doctor` MUST accept `--json` and emit a structured result to **stdout** (checks + overall status), keeping the worst-check-wins exit rule (any FAIL → exit 1, Principle 4). The existing human diagnostic output is unchanged.

- **GIVEN** a HEAD build
- **WHEN** `bin/rk doctor --json` runs
- **THEN** stdout carries a JSON object with per-check results and an overall pass/fail, and exit is 0 when all pass / 1 when any fails
- **AND** the default (non-`--json`) human output and its exit codes are unchanged

#### R5: `run-kit agent-setup` MUST be completable non-interactively
`agent-setup` mutates `~/.claude/settings.json` but today its confirmation is satisfiable only by an interactive `[y/N]` prompt — an agent cannot consent (Principle 1: a warranted confirmation "MUST be satisfiable by a flag (`--yes`/`-y`)"; Principle 5: destructive writes "MUST support `--dry-run`"). `agent-setup` MUST accept `--yes`/`-y` (skip the prompt and write) and `--dry-run` (show the diff, write nothing, require no consent). With neither flag passed: the interactive TTY prompt path is unchanged, but when a write is pending and stdin is NOT a TTY, the command MUST refuse with an error naming `--yes` (stderr, non-zero exit) rather than silently declining with exit 0 — Principle 1's non-TTY clause (reference impl: `shll uninstall`); a success-looking silent no-op is the agent trap the principle targets. <!-- rework (cycle 1): refusal clause added — review found the P1 disposition overclaimed without it -->

- **GIVEN** a HEAD build and a settings file that would change
- **WHEN** `bin/rk agent-setup --yes` runs with no TTY
- **THEN** the merge is written without prompting (exit 0)
- **AND** `bin/rk agent-setup --dry-run` shows the diff, writes nothing, and needs no consent
- **AND** `--yes` and `--dry-run` together is rejected as a usage error (contradictory intent), or `--dry-run` wins and writes nothing <!-- decided in T-level: dry-run wins, never writes -->
- **AND** with neither flag on a TTY, behavior is exactly as today (interactive `[y/N]` prompt)
- **AND** with neither flag, a pending write, and non-TTY stdin, it refuses: error on stderr naming `--yes`, non-zero exit, nothing written

### Deferred gaps + report

#### R6: Restructural principle gaps MUST be recorded, not fixed here
Gaps whose fix would restructure the tool (global output model, cross-cutting error-code convention) MUST be recorded as `fab/backlog.md` entries in the existing entry format and referenced from the conformance report as `deferred to [<id>]`, per the intake's proportionality rule.

- **GIVEN** the audit found the global usage-error exit-code convention gap (cobra defaults usage/arg/unknown-command errors to exit 1; toolkit convention is exit 2) and the Principle 9 output-control gap (no `--quiet`; `reaper` match list uncapped)
- **WHEN** the fixes are dispositioned
- **THEN** each deferred gap is a new `- [ ] [<id>] <date>: …` line in `fab/backlog.md` matching the file's existing format
- **AND** the conformance report references each by its backlog id

#### R7: The conformance report MUST be produced, pinned to the audited shll version
A per-standard conformance report MUST be written to `fab/changes/260717-c424-toolkit-standards-conformance/conformance-report.md` (for the ship stage to lift into the PR body), with one section per enumerated standard (PASS or gaps), each gap dispositioned `fixed here` or `deferred to [<id>]`, and the audited shll version row (`shll v0.0.23`) pinned.

- **GIVEN** the audit is complete and fixes applied
- **WHEN** the report is written
- **THEN** it has a section for each of `principles`, `help-dump`, `readme-extraction`, `skill`
- **AND** every gap carries exactly one disposition
- **AND** the shll version row (`shll v0.0.23`) is stated as the revision the claim is made against

#### R8: The help-dump contract MUST be re-verified if the command tree changed
Because R3/R4/R5 add flags to `status`/`doctor`/`agent-setup` (the command tree changes), the help-dump standard's verification checklist MUST be re-executed against the rebuilt `bin/rk` as the final apply step (intake § Verification).

- **GIVEN** the flag-adding fixes have landed and `bin/rk` is rebuilt
- **WHEN** the help-dump checklist is re-run
- **THEN** `bin/rk help-dump` still exits 0 with valid stdout-only JSON, envelope `{tool, version, schema_version, root}` (no `captured_at`), and no `completion`/`help`/hidden nodes
- **AND** the new flags appear in the affected commands' captured `text`

### Non-Goals

- Auditing sibling toolkit repos (shll, wt, fab-kit, …) — out of scope; this repo's `rk`/`run-kit` CLI only (Assumption 2).
- The `skill` standard's "deferred, not yet adopted" contingency — moot; `rk skill` + `docs/site/skill.md` exist at HEAD and are audited in full (Assumption 5).
- Global `--quiet` support and a global usage-error→exit-2 mapping — deferred to backlog per R6 (restructural, cross-cutting).
- Stripping the `v` prefix from the help-dump `version` field — the standard does not mandate bare semver; `shll version` itself renders `v`-prefixed rows, so the current `displayVersion()` form is left as-is (noted in report, not a fix).

### Design Decisions

1. **Audit against a HEAD build, never the installed brew binary**: build `bin/rk` from `app/backend/cmd/rk/` with an ldflags version — *Why*: the installed `rk` is v3.7.2 and rejects `rk skill`, which exists at HEAD; auditing it false-negatives (Assumption 1) — *Rejected*: auditing the installed binary.
2. **Global exit-code convention deferred, additive flags fixed**: `--json`/`--yes`/`--dry-run` are per-command additive flags (the intake's in-scope "missing flag"); the usage-error→exit-2 mapping spans every command's error classification through the shared `execute()` and cobra error plumbing — *Why*: honors "fix root causes, not symptoms" (a half-covered exit-code mapping is worse than a clean deferral) and the proportionality boundary (Assumption 7) — *Rejected*: forcing the exit-code overhaul into this change.
3. **doctor `--json` goes to stdout; human output stays on stderr**: `doctor`'s human check output currently goes to stderr (cobra `cmd.Println` → stderr) and stays there (it is diagnostics); `--json` is the data path and goes to stdout — *Why*: cleanest additive reconciliation of Principle 2 without re-routing the existing human stream (which would be a behavior change for every current caller) — *Rejected*: moving the human output to stdout.

## Tasks

### Phase 1: Audit (entry — evidence gathering)

- [x] T001 Re-run the precondition + runtime enumeration: `shll standards` (exit 0), `shll standards <name>` for each of principles/help-dump/readme-extraction/skill, and `shll version` (pin the shll row = v0.0.23). Build the HEAD binary `bin/rk` from `app/backend/cmd/rk/`. <!-- R7 -->
- [x] T002 Execute the help-dump, readme-extraction, and skill verification checklists verbatim against `bin/rk`/`README.md`/`docs/site/`, and assess each of the ten principles against `bin/rk` behavior + `app/backend/cmd/rk/` source. Record PASS/gap per standard. <!-- R1 R2 R3 R4 R5 R6 -->

### Phase 2: Mechanical-contract fixes

- [x] T003 [P] Remove `captured_at` from the help-dump envelope: drop the `CapturedAt` field from the `dump` struct, the `now`/`nowUTC` timestamp plumbing from `buildDump`/`runHelpDump`, and the `time` import in `app/backend/cmd/rk/help_dump.go`; update `app/backend/cmd/rk/help_dump_test.go` to assert `captured_at` is absent and drop the captured-at/clock tests. <!-- R1 -->
- [x] T004 [P] Rewrite the relative `docs/specs/agent-state.md` link in `README.md` (the "cross-repo convention is documented in …" line) to its absolute `https://github.com/sahil87/run-kit/blob/main/docs/specs/agent-state.md` form. <!-- R2 -->

### Phase 3: Additive principle fixes (command tree changes)

- [x] T005 Add `--json` to `run-kit status` in `app/backend/cmd/rk/status.go`: emit a stable JSON document (sessions with name + window count) to stdout when set, human output unchanged otherwise, error on stderr + non-zero exit when the server is unreachable. Add a test in `app/backend/cmd/rk/status_test.go` (new). <!-- R3 -->
- [x] T006 Add `--json` to `run-kit doctor` in `app/backend/cmd/rk/doctor.go`: emit a structured result (per-check + overall) to stdout when set, keep worst-check-wins (any FAIL → exit 1), human output + exit codes unchanged otherwise. Add a test in `app/backend/cmd/rk/doctor_test.go`. <!-- R4 -->
- [x] T007 Add `--yes`/`-y` and `--dry-run` to `run-kit agent-setup` in `app/backend/cmd/rk/agent_setup.go`: `--yes` bypasses the `confirm()` prompt and writes; `--dry-run` renders the diff and writes nothing (needs no consent); `--dry-run` wins if both are passed (never writes); neither flag preserves today's interactive/EOF-decline behavior exactly. Thread the flags through `runAgentSetup`/`applyAgentConfig`/`applyAgentHooks`/`removeLegacySkill`. Add/extend tests in `app/backend/cmd/rk/agent_setup_test.go`. <!-- R5 -->

### Phase 4: Deferral + report + re-verify

- [x] T008 Record the two deferred gaps in `fab/backlog.md` using the existing `- [ ] [<id>] <date>: …` format: (a) global usage-error → exit-2 convention mapping, (b) Principle 9 output control (`--quiet` + reaper match-list cap). <!-- R6 -->
- [x] T009 Write the conformance report to `fab/changes/260717-c424-toolkit-standards-conformance/conformance-report.md`: one section per standard (principles/help-dump/readme-extraction/skill), every gap dispositioned `fixed here` or `deferred to [<id>]`, shll version row `shll v0.0.23` pinned. <!-- R7 --> <!-- rework (cycle 1): report accuracy — § readme-extraction falsely PASSed docs/site closure (install.md:26 escapes the tree); § principles P1 overclaimed "fixed here" while the non-TTY refusal clause was unmet; also note the status --json empty-vs-error semantic (cleanly-absent server → [] + exit 0, deliberate) --> <!-- rework (cycle 2): § principles P1 paragraph misstates the TTY mechanism — claims `os.ModeCharDevice`, but the code deliberately uses `term.IsTerminal` (agent_setup.go isTerminal) BECAUSE ModeCharDevice false-classifies /dev/null as a TTY; fix the one line; also add a note that shll moved v0.0.23 → v0.1.0 post-audit (cited rules spot-checked unchanged, claims stay pinned at v0.0.23) -->
- [x] T010 Rebuild `bin/rk` and re-execute the help-dump verification checklist (exit 0, stdout-only valid JSON, envelope `{tool, version, schema_version, root}` with no `captured_at`, no `completion`/`help`/hidden nodes; new flags present in the affected commands' `text`). Run `just test-backend` and confirm green. <!-- R8 --> <!-- rework (cycle 1): re-verify after the cycle-1 fixes (T011–T013) land — runs LAST -->

### Phase 5: Review Rework (cycle 1)

<!-- Execution order: T011 → T012 → T013 → T009 (report rewrite) → T010 (re-verify, last). -->

- [x] T011 Implement the non-TTY refusal in `app/backend/cmd/rk/agent_setup.go` (the `confirm()`/write-authorization seam): when a write is pending and neither `--yes` nor `--dry-run` is set and stdin is not a TTY, refuse with an error on stderr naming `--yes` and exit non-zero (nothing written) — reference behavior: `shll uninstall`. Suppress the `Write these changes? [y/N]` / `Remove … directory? [y/N]` prompt suffixes on the auto-answered `--yes`/`--dry-run` paths (they are printed but never read — reads as a hang in transcripts). Tests in `app/backend/cmd/rk/agent_setup_test.go`: non-TTY no-flag refusal (error names `--yes`, non-zero exit, settings byte-unchanged), and the two missing `removeLegacySkill` consent variants — `--yes` authorizes the `os.RemoveAll` of the legacy `rk-display` directory, `--dry-run` leaves it in place. <!-- R5 -->
- [x] T012 [P] Fix the docs/site closure violation: rewrite `docs/site/install.md:26`'s `](../../README.md#agent-state--run-kit-agent-setup)` to the absolute `https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup` form, then re-run the readme-extraction standard's closure sweep over `README.md` + `docs/site/**` and confirm zero remaining escapes. <!-- R2 -->
- [x] T013 [P] Pattern-consistency polish from review: rename the `err := cmd.ErrOrStderr()` io.Writer binding in `app/backend/cmd/rk/doctor.go:72` to `stderr` (collides with the Go error-variable convention); reorder `writeSessionStatusJSON(cmd, ctx, …)` in `app/backend/cmd/rk/status.go:64` to context-first per Go convention. <!-- R3 R4 -->

## Execution Order

- T001 → T002 (audit evidence precedes every fix decision)
- T003, T004 are independent `[P]` (Go vs README)
- T005, T006, T007 each touch a distinct command file (parallelizable in principle, but each adds tree surface T010 re-verifies) — do before T010
- T008, T009 depend on T002's findings and T003–T007's dispositions
- T010 is the final step (re-verifies the tree after T005–T007 changed it) and runs the test gate

## Acceptance

### Functional Completeness

- [x] A-001 R1: `bin/rk help-dump` envelope keys are exactly `{tool, version, schema_version, root}` — `captured_at` absent — and the rest of the help-dump checklist still passes (exit 0, stdout-only JSON, no completion/help/hidden nodes).
- [x] A-002 R2: No relative link in `README.md` OR `docs/site/**` points outside the published set; the README's `docs/specs/agent-state.md` reference and `docs/site/install.md`'s README reference are absolute; README→`docs/site/` and between-`docs/site/` links stay relative. <!-- rework (cycle 1): widened to docs/site/** closure — install.md:26 violation; verified 2026-07-18: closure sweep over README.md + docs/site/** shows zero relative escapes (README's only relative links are the 5 auto-rewritten docs/site/*.md hub links), no relative images, no reference-style/badge escapes -->
- [x] A-003 R3: `bin/rk status --json` emits a stable JSON document of sessions to stdout; human output unchanged.
- [x] A-004 R4: `bin/rk doctor --json` emits a structured result to stdout with worst-check-wins exit (0 all-pass / 1 any-fail); human output + exit codes unchanged.
- [x] A-005 R5: `bin/rk agent-setup --yes` writes without prompting (exit 0, non-TTY); `--dry-run` writes nothing and needs no consent; with neither flag, TTY behavior is unchanged and a pending write on non-TTY stdin refuses with an error naming `--yes` (stderr, non-zero exit, nothing written). <!-- rework (cycle 1): non-TTY refusal clause added; verified 2026-07-18 against bin/rk: `</dev/null` and pipe both refuse (exit 1, stderr names --yes, nothing written), --yes writes (exit 0), --dry-run shows diff + writes nothing (exit 0), no stray [y/N] on auto-answered paths. TTY-detection uses term.IsTerminal (not bare os.ModeCharDevice, which false-classifies /dev/null as a TTY). -->
- [x] A-006 R6: `fab/backlog.md` has two new entries (usage-error exit-2 mapping; Principle 9 output control) in the file's existing format.
- [x] A-007 R7: `conformance-report.md` exists with a section per standard, every gap dispositioned once, and the `shll v0.0.23` row pinned. <!-- rework (cycle 2): report accuracy fails again on ONE line — § principles P1 claims TTY detection via os.ModeCharDevice; implementation uses term.IsTerminal precisely to avoid ModeCharDevice's /dev/null false-TTY. Correct the mechanism claim (and add the shll v0.0.23→v0.1.0 drift note). Cycle-1 fixes (closure line, P1 disposition, status semantic note) verified held. -->
- [x] A-008 R8: After rebuild, the help-dump checklist re-passes and the new `--json`/`--yes`/`--dry-run` flags appear in the affected commands' captured `text`.

### Behavioral Correctness

- [x] A-009 R5: `agent-setup` with `--dry-run` (or `--dry-run --yes`) never writes `settings.json`; the diff is shown and the file bytes are unchanged.
- [x] A-010 R4: `doctor --json` exit code is driven by the worst check (any FAIL → 1), matching the human path's exit semantics.

### Scenario Coverage

- [x] A-011 R3: `status --json` on errorful unreachability (stale socket, permission) surfaces the error on stderr and exits non-zero (no partial/invalid JSON on stdout); a cleanly-absent server ("no server running") is empty-success (`[]` + exit 0) by deliberate `internal/tmux.ListSessions` semantics, matching the human path. <!-- reworded in review cycle 1 to the verified semantics; both paths verified empirically -->

### Code Quality

- [x] A-012 Pattern consistency: new flag wiring follows the surrounding cobra patterns (flag vars + `init()` registration, `cmd.OutOrStdout()`/`ErrOrStderr()` streams, testable-core split as in `shell_init.go`/`agent_setup.go`).
- [x] A-013 No unnecessary duplication: JSON marshalling reuses `encoding/json`; no new tmux/subprocess construction (status reuses `internal/tmux`), no shell strings.
- [x] A-014 Constitution — Security First: no new `exec.Command`/shell-string paths introduced; any subprocess use stays `exec.CommandContext` with argv slices and timeouts (only status touches tmux, via the existing `internal/tmux` wrappers).
- [x] A-015 Constitution — No Database / derive-at-request-time: `status --json` and `doctor --json` derive from tmux/`exec.LookPath` at request time, no new state store.
- [x] A-016 Tests: new/changed behavior (help-dump envelope, status/doctor/agent-setup flags) is covered by `*_test.go` alongside the code; `just test-backend` is green.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Audit against a HEAD build `bin/rk` (ldflags version), never the installed brew v3.7.2 | Intake Assumption 1, verified: installed binary rejects `rk skill` which exists at HEAD | S:90 R:90 A:95 D:90 |
| 2 | Certain | `captured_at` in the help-dump envelope is a mechanical violation → fix here | Standard states "Do not emit `captured_at`" as a rule with teeth; unambiguous mechanical contract | S:95 R:85 A:95 D:95 |
| 3 | Confident | `--json` on `status` and `doctor`, and `--yes`/`--dry-run` on `agent-setup`, are the intake's in-scope "missing flag" additive fixes, not restructuring | Each is a per-command flag gating existing behavior; Principle 2/1/5 name these exact affordances; blast radius bounded to one command file + its test | S:75 R:75 A:75 D:70 |
| 4 | Confident | doctor `--json` emits to stdout while the existing human check output stays on stderr | Human output is diagnostics (stays); `--json` is the data path (stdout); re-routing the human stream would change behavior for every current caller — out of proportion | S:70 R:80 A:75 D:70 |
| 5 | Confident | The global usage-error→exit-2 convention and Principle 9 output control (`--quiet`, reaper cap) are deferred to backlog, not fixed here | Exit-2 mapping spans every command's error classification through shared `execute()`+cobra plumbing (cross-cutting); `--quiet` is a global output-model change — both are the intake's "restructure" class | S:70 R:70 A:70 D:65 |
| 6 | Confident | agent-setup `--dry-run` wins over `--yes` when both are passed (dry-run never writes) | Safer default under contradictory intent; a dry-run that could still write would violate Principle 5's "accurate preview" promise | S:65 R:85 A:70 D:65 |
| 7 | Confident | The `v` prefix on the help-dump `version` field is left as-is (not a violation) | Standard's example shows bare semver but its text mandates only "from the built binary", not stripping `v`; `shll version` itself renders `v`-prefixed rows | S:60 R:85 A:65 D:65 |
| 8 | Certain | Deferred gaps recorded in `fab/backlog.md` (not GitHub issues/draft changes); report written to `conformance-report.md` for the ship stage | Intake Assumptions 6 + 8 + task-specific guidance; backlog is the repo's freshly-committed convention | S:85 R:90 A:90 D:85 |

8 assumptions (3 certain, 5 confident, 0 tentative).
