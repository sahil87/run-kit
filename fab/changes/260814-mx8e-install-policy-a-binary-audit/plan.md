# Plan: Install-Composition Policy A Binary-Half Audit

**Change**: 260814-mx8e-install-policy-a-binary-audit
**Intake**: `intake.md`

## Requirements

### Audit: Procedure Discipline

#### R1: Audit against HEAD build with runtime-enumerated standard text
The audit MUST be measured against a HEAD build (`just build` → `bin/rk`, source `app/backend/cmd/rk/`), never the installed brew `rk`, and MUST re-enumerate the standard at audit time (`shll standards`, `shll standards install-composition`), pinning the `shll version` the audit was measured at. If `shll standards` fails, run `shll update` once; if it still fails, STOP and report.

- **GIVEN** the audit is starting
- **WHEN** conformance evidence is gathered
- **THEN** binary-behavior evidence comes from `bin/rk` built at HEAD, and the report records the pinned shll version and the standard text as enumerated at audit time

### Audit: Policy A Checklist

#### R2: Formula check — no sibling `depends_on`
The audit MUST verify (read-only) that the `sahil87/tap/run-kit` formula declares no `depends_on` on a sibling toolkit formula (roster: shll, wt, idea, hop, tu, fab-kit, run-kit). Any violation is recorded as a finding + follow-up backlog item targeting the tap repo — never fixed here.

- **GIVEN** the sahil87/tap run-kit formula (via `brew info --json=v2 run-kit` or the tap repo source)
- **WHEN** its dependency declarations are inspected
- **THEN** the report records a PASS (no sibling edge) or a finding naming the offending edge

#### R3: Probe coverage — every runtime sibling invocation is probed or provably degrades
The audit MUST enumerate every call site where run-kit's shipped code invokes a sibling toolkit binary (`wt`, `fab`, `shll`) — Go (`exec.CommandContext`/`exec.Command` targets) across `app/backend/`, and `command -v` coverage in shipped shell/skill code (`scripts/`, `docs/site/skill*.md`) — and classify each as: (a) probed (`exec.LookPath`/`command -v` before invoke), (b) unprobed but degrading gracefully (exec error handled, no crash), or (c) unprobed and crash-capable. The sweep commands used MUST be recorded in the report so the enumeration is reproducible and refutable.

- **GIVEN** the full sweep over `app/backend/`, `scripts/`, and shipped skill pages
- **WHEN** each sibling call site is classified
- **THEN** the report lists every site with file:line, its classification, and the evidence (probe location or the handled-error path)
- **AND** class (c) sites are findings with follow-up backlog items

#### R4: Hint audit — missing-sibling paths emit actionable install hints, never crash
For each missing-sibling code path, the audit MUST record the user-facing behavior: the emitted message text and whether it is an actionable install hint (the standard's example shape: `wt is not installed. Install it: brew install sahil87/tap/wt` — equivalent actionable wording conforms; the standard labels its message an example). A missing hint or a crash is a finding. The backlog's illustrative case (`cmd/rk/upgrade.go:240-242`, the non-brew self-install hint `brew install sahil87/tap/run-kit`) is assessed as the mandated actionable-hint pattern in binary output.

- **GIVEN** a sibling-absent path (e.g. `wt` missing when `rk riff` runs)
- **WHEN** the path executes (verified live against `bin/rk` where safely simulable, else by code reading with the message text quoted)
- **THEN** the report records the exact message and a conforms / finding verdict per path

### Audit: Deliverables

#### R5: Report, backlog bookkeeping, and deferral of gaps
The audit report MUST be written to the change folder (`conformance-report.md`, lifted into the PR body at ship — no committed copy under `docs/`). `fab/backlog.md` MUST get the `[x]` tick on `[mx8e]` plus a recorded finding note, and every nonconformance finding MUST become a new backlog item referenced from the report by id. No production code is changed in this change.

- **GIVEN** the audit concludes
- **WHEN** deliverables are written
- **THEN** `fab/changes/260814-mx8e-install-policy-a-binary-audit/conformance-report.md` exists with per-checklist-item verdicts and evidence, `[mx8e]` is ticked with the finding note, and each gap (if any) has a backlog item

### Non-Goals

- No probe additions, hint rewording, or any production code change — gaps become backlog items
- No re-audit of Policy B (docs half) or the other seven standards
- No tap-repo changes (formula findings are deferred cross-repo)

## Tasks

### Phase 1: Setup

- [x] T001 Build HEAD (`just build` → `bin/rk`); pin `shll version`; re-run `shll standards` + `shll standards install-composition` and capture the authoritative text for the report <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 [P] Formula check: inspect the `sahil87/tap/run-kit` formula for sibling `depends_on` (via `brew info --json=v2 run-kit` and/or the tap source); record verdict + evidence <!-- R2 -->
- [x] T003 Sibling-invocation sweep and classification: enumerate every `wt`/`fab`/`shll` call site in `app/backend/` (Go) and `command -v` coverage in `scripts/` + `docs/site/skill*.md`; classify each site (probed / graceful / crash-capable) and record the missing-sibling message text per path, verifying live against `bin/rk` where safely simulable <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Write `conformance-report.md` in the change folder: pinned shll version, standard text reference, per-checklist verdicts (formula / probes / hints), the full call-site table with evidence, the reproducible sweep commands, and the overall Policy A verdict <!-- R5 -->
- [x] T005 Backlog bookkeeping in `fab/backlog.md`: tick `[x]` on `[mx8e]` and append the finding note; add one new backlog item per nonconformance finding (if any), referenced from the report <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The report pins the shll version, quotes the runtime-enumerated standard, and all binary-behavior evidence cites `bin/rk` built at HEAD (never the installed brew rk)
- [x] A-002 R2: The formula verdict is recorded with the inspected dependency evidence
- [x] A-003 R3: Every sibling call site found by the recorded sweep commands appears in the report's table with file:line, classification, and evidence — none omitted
- [x] A-004 R4: Every missing-sibling path has its observed/quoted message recorded and an explicit conforms-or-finding verdict, including the upgrade.go illustrative case

### Scenario Coverage

- [x] A-005 R4: At least one sibling-absent path is exercised live against `bin/rk` (safely, without mutating the operator environment) or the report states why live simulation was unsafe and relies on quoted code paths

### Edge Cases & Error Handling

- [x] A-006 R5: Each nonconformance finding (if any) has a new `fab/backlog.md` item referenced from the report by id; a clean PASS records no forced code change

### Code Quality

- [x] A-007 Audit-only integrity: no production code (`app/backend/`, `app/frontend/`, `scripts/`) is modified by this change
- [x] A-008 R5: `[mx8e]` in `fab/backlog.md` is ticked `[x]` with the audit finding recorded in the item note

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Live missing-sibling simulation must never uninstall or shadow tools for the real environment — use a scratch `PATH` with curated symlinks in a subshell only

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Where a missing sibling cannot be safely simulated live, static code-reading evidence (quoted message construction + handled-error path) suffices for the verdict | Audit is read-only on a live operator box; a scratch-PATH subshell covers most cases, and the standard's checklist verifies code posture, not only runtime traces | S:65 R:85 A:80 D:75 |
| 2 | Confident | "Actionable install hint" is judged by substance (names the missing tool + a working install command), not byte-equality with the standard's example string | The standard labels its message "Example message, verbatim" — an example of shape, and sibling tools' conformant hints vary in wording | S:60 R:85 A:75 D:70 |
| 3 | Confident | Formula evidence via `brew info --json=v2 run-kit` on this machine is acceptable when it reflects the current tap; cross-check the tap source remotely only if brew's answer is stale or ambiguous | Read-only, fastest evidence; the tap repo remains the authority if they disagree | S:60 R:80 A:80 D:70 |

3 assumptions (0 certain, 3 confident, 0 tentative).
