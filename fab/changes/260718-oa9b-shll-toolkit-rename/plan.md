# Plan: Conform Repo to the "shll toolkit" Name

**Change**: 260718-oa9b-shll-toolkit-rename
**Intake**: `intake.md`

## Requirements

<!-- Derived from the intake's exhaustive, pre-verified occurrence map (8 hits;
     1 deferred to hydrate). Requirements are stated as MUST/MUST NOT rules with
     GIVEN/WHEN/THEN scenarios. This is a docs-type conformance change: replace
     the retired name "sahil87 toolkit" / "sahil87 tool(s)" with "shll toolkit" /
     "shll tool(s)" wherever it appears as prose, byte-exact on the mechanical
     README-blockquote contract, while leaving all identifiers untouched. -->

### README: Toolkit-Name Conformance

#### R1: README blockquote is the byte-exact standard contract line
`README.md` line 3 SHALL be replaced, byte-identical, with the canonical readme-extraction blockquote:
`> Part of the [shll toolkit](https://shll.ai) — see all projects there.` The mandated head order (line 1 H1 → line 3 blockquote → line 5 badges) MUST NOT be reordered — only the one line changes.

- **GIVEN** README.md line 3 currently reads `> Part of [@sahil87's open source toolkit](https://shll.ai) — see all projects there.`
- **WHEN** the blockquote is replaced with the standard's canonical line
- **THEN** `sed -n 3p README.md` byte-equals `> Part of the [shll toolkit](https://shll.ai) — see all projects there.`
- **AND** lines 1, 5 (H1, badges) are unchanged and the head order is preserved

#### R2: README prose replaces the retired toolkit name, identifiers untouched
The two README prose mentions of the retired name SHALL be updated: line 17 `the entire sahil87 toolkit` → `the entire shll toolkit`; line 243 `Have other sahil87 tools?` → `Have other shll tools?`. The `sahil87/tap/run-kit` brew formula and the `github.com/sahil87/shll#…` link URL on those lines MUST NOT change.

- **GIVEN** README line 17 contains `To install the entire sahil87 toolkit instead:` and line 243 contains `Have other sahil87 tools?`
- **WHEN** the prose is swept
- **THEN** line 17 reads `the entire shll toolkit` and line 243 reads `Have other shll tools?`
- **AND** `brew install sahil87/tap/run-kit` and the `github.com/sahil87/shll#…` URL are byte-unchanged

### Go Source Comments: Toolkit-Name Conformance

#### R3: Three Go doc comments use the new toolkit name (comments only)
The three Go doc-comment mentions SHALL be updated with no behavior change, no string-literal change, and no help-dump/golden change: `app/backend/cmd/rk/exit_code.go:8` `(sahil87 toolkit Principle 4, …)` → `(shll toolkit Principle 4, …)`; `app/backend/cmd/rk/root.go:13-14` line-wrapped `…to match the sahil87` / `// toolkit standard…` → `shll` (re-wrapped naturally); `app/backend/internal/riff/riff.go:62` `…the sahil87 toolkit exit-code convention` → `…the shll toolkit exit-code convention`. All URLs in these comments MUST NOT change.

- **GIVEN** the three doc comments reference `sahil87 toolkit`
- **WHEN** the comment prose is edited
- **THEN** each comment references `shll toolkit`, the `https://shll.ai/shll/standards/principles` URL is unchanged, and the code recompiles identically (no token/AST change outside the comment text)
- **AND** `cd app/backend && go test ./...` passes (compile + drift guards)

### Constitution: Toolkit-Name Conformance

#### R4: Constitution § Toolkit Standards opening clause updated, nothing else
`fab/project/constitution.md` line 50 SHALL change only the opening clause `This tool is part of the sahil87 toolkit` → `This tool is part of the shll toolkit`. The `sahil87/shll repository's docs/site/standards/` canonical-source reference (an identifier) MUST NOT change, and the governance line `Version: 1.6.0 | Ratified: 2026-03-02 | Last Amended: 2026-07-18` MUST stay byte-identical (Last Amended already equals today; Version stays 1.6.0).

- **GIVEN** constitution line 50 opens with `This tool is part of the sahil87 toolkit and MUST conform…`
- **WHEN** the opening clause is edited
- **THEN** it reads `This tool is part of the shll toolkit and MUST conform…`
- **AND** the `sahil87/shll repository's docs/site/standards/` reference and the governance line are byte-unchanged

### Whole-Repo Conformance & No Regressions

#### R5: No retired-name occurrences remain (except deferred memory + archives), types green
After the apply edits, the intake's multiline-aware perl sweep MUST return zero matches outside `fab/changes/` and `docs/memory/` (the single `docs/memory/run-kit/toolkit-standards.md:11` occurrence is deferred to the hydrate stage per pipeline convention). `docs/site/**`, the embedded skill bundle, test goldens, and help-dump JSON MUST NOT be touched (pre-verified zero occurrences). Typecheck MUST stay green.

- **GIVEN** the apply edits are complete
- **WHEN** the sweep is re-run excluding `fab/changes/` and `docs/memory/`
- **THEN** it returns zero matches
- **AND** `cd app/backend && go test ./...` and `cd app/frontend && npx tsc --noEmit` both pass
- **AND** the only file with a remaining occurrence is `docs/memory/run-kit/toolkit-standards.md` (deferred to hydrate)

### Non-Goals

- `docs/site/**`, `docs/site/skill.md`, `docs/site/skill/display.md` — pre-verified zero prose occurrences (all `sahil87` hits are URLs/formula names).
- Skill-bundle embed re-sync — canonical and embedded copies already in sync; no `scripts/sync-skill.sh` re-run required (drift guards stay green).
- Test goldens / help-dump JSON — no user-visible string changed; nothing to update; no `schema_version` bump.
- `docs/memory/run-kit/toolkit-standards.md:11` — updated at hydrate, not in apply.
- All identifiers: `sahil87/tap` formula names, `github.com/sahil87/…` / `raw.githubusercontent.com/sahil87/…` / `api.github.com/repos/sahil87/…` URLs, GitHub-owner constants, `sahil87/shll` canonical-source reference.
- Everything under `fab/changes/` other than this change's own folder.

## Tasks

### Phase 1: Prose & Comment Sweep

- [x] T001 [P] Replace `README.md` line 3 blockquote byte-identically with `> Part of the [shll toolkit](https://shll.ai) — see all projects there.`; do not reorder the head <!-- R1 -->
- [x] T002 [P] Update `README.md` line 17 (`the entire sahil87 toolkit` → `the entire shll toolkit`) and line 243 (`Have other sahil87 tools?` → `Have other shll tools?`); leave the `sahil87/tap/run-kit` formula and `github.com/sahil87/shll#…` URL untouched <!-- R2 -->
- [x] T003 [P] Update the three Go doc comments to `shll toolkit`: `app/backend/cmd/rk/exit_code.go:8`, `app/backend/cmd/rk/root.go:13-14` (re-wrap naturally), `app/backend/internal/riff/riff.go:62`; URLs unchanged, comments only <!-- R3 -->
- [x] T004 [P] Update `fab/project/constitution.md` line 50 opening clause (`sahil87 toolkit` → `shll toolkit`); leave the `sahil87/shll` canonical-source reference and the governance line byte-identical <!-- R4 -->

### Phase 2: Verification

- [x] T005 Byte-check the blockquote: `sed -n 3p README.md` must equal `> Part of the [shll toolkit](https://shll.ai) — see all projects there.` <!-- R1 -->
- [x] T006 Run the intake's multiline-aware perl sweep; confirm zero matches outside `fab/changes/` and `docs/memory/` (only `docs/memory/run-kit/toolkit-standards.md` may remain, deferred to hydrate) <!-- R5 -->
- [x] T007 Run `cd app/backend && go test ./...` (compile + drift guards) and confirm green <!-- R3, R5 -->
- [x] T008 Run `cd app/frontend && npx tsc --noEmit` and confirm green <!-- R5 -->

## Execution Order

- T001–T004 are independent file edits (`[P]`, may run together).
- T005–T008 run after all Phase 1 edits complete.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `README.md` line 3 byte-equals the canonical blockquote and the head order (H1 → blockquote → badges) is unchanged
- [x] A-002 R2: `README.md` line 17 reads `the entire shll toolkit` and line 243 reads `Have other shll tools?`, with the brew formula and the `github.com/sahil87/shll` URL unchanged
- [x] A-003 R3: the three Go doc comments read `shll toolkit`, their URLs are unchanged, and the change is comment-only
- [x] A-004 R4: constitution line 50 reads `This tool is part of the shll toolkit`, with the `sahil87/shll` canonical-source reference and governance line byte-unchanged
- [x] A-005 R5: the sweep returns zero matches outside `fab/changes/` and `docs/memory/`; the only remaining occurrence is `docs/memory/run-kit/toolkit-standards.md` (deferred to hydrate)

### Behavioral Correctness

- [x] A-006 R3: `cd app/backend && go test ./...` passes — code recompiles identically, drift guards green, no golden/help-dump change
- [x] A-007 R5: `cd app/frontend && npx tsc --noEmit` passes

### Code Quality

- [x] A-008 Pattern consistency: edits preserve surrounding comment/markdown style; the constitution governance line and all identifiers are untouched
- [x] A-009 No unnecessary duplication: no skill-bundle re-sync or golden regeneration performed (verified unnecessary)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The `docs/memory/run-kit/toolkit-standards.md:11` prose fix is intentionally deferred to hydrate (memory-update convention).

## Assumptions

<!-- Three grades only (Certain/Confident/Tentative). Carried forward from the
     intake's fully-verified occurrence map — apply introduced no new
     under-specified decisions. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The three Go doc comments are in-scope for the prose sweep (the brief enumerates "CLI help text and user-visible strings", but "wherever they appear as prose" governs; comments are prose mentions, not identifiers) | Trivially reversible comment-only edits; verified as the only Go hits by the multiline-aware sweep | S:65 R:95 A:75 D:65 |
| 2 | Certain | Constitution: word-swap only; `Version` stays 1.6.0 and `Last Amended` stays 2026-07-18 (already today — mandated bump is a no-op) | Brief says nothing else changes; file history has amendment-without-version-bump precedent; today's date already present | S:85 R:95 A:90 D:80 |
| 3 | Certain | No golden/help-dump/skill-bundle sync work: sweep found zero occurrences in user-visible strings, goldens, `docs/site/**`, or the embedded skill copies | Verified empirically at intake and re-verified at apply via the baseline sweep | S:80 R:90 A:95 D:90 |

3 assumptions (2 certain, 1 confident, 0 tentative).
