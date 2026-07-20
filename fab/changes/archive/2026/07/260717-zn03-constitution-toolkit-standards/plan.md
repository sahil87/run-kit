# Plan: Bind Constitution to sahil87 Toolkit Standards

**Change**: 260717-zn03-constitution-toolkit-standards
**Intake**: `intake.md`

## Requirements

<!-- Docs-type change: the sole edited file is fab/project/constitution.md — a
     governance document, not source code. Requirements below describe the exact
     documentary state the amendment must produce. No runtime behavior, no code,
     no tests. -->

### Constitution: Toolkit Standards Binding

#### R1: Toolkit Standards article present under Additional Constraints
The constitution MUST carry a `### Toolkit Standards` article as the **last** article of the `## Additional Constraints` section — placed immediately after `### Self-Improvement Safety` and immediately before `## Governance`. The article body MUST be the intake's verbatim text with the shell-flattened `--` rendered as em-dashes (`—`) to match the file's typography, and MUST start directly under the heading with no blank-line-separated lead-in (matching sibling articles). It MUST enumerate standards via `shll standards` (not a hardcoded list), name `shll standards <name>` for reading one, require checking the CLI surface / help output / README.md / docs/site/ against the governing standards before changing them, and name the canonical fallback source (the sahil87/shll repo's `docs/site/standards/` tree, rendered on https://shll.ai) with the "bind without further amendment" clause.

- **GIVEN** the current constitution whose `## Additional Constraints` section ends with `### Self-Improvement Safety`
- **WHEN** the amendment is applied
- **THEN** a `### Toolkit Standards` article appears as the final article of `## Additional Constraints`, before `## Governance`
- **AND** its body matches the intake's What-Changes text verbatim with `—` typography and no blank-line lead-in

#### R2: Governance line bumped to 1.6.0 / Last Amended 2026-07-18
The governance line MUST read `**Version**: 1.6.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-18`. The version bumps MINOR (1.5.0 → 1.6.0) because a new article is added and no existing principle changes or is removed; the Ratified date is untouched.

- **GIVEN** the current governance line `**Version**: 1.5.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-15`
- **WHEN** the amendment is applied
- **THEN** the line reads `**Version**: 1.6.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-18`
- **AND** the Ratified date is unchanged

### Non-Goals

- No enumeration in the constitution — no standard names, counts, or per-standard URLs in the article (`shll standards` is the enumeration; the article must stay correct as standards evolve). A hardcoded standard list in the diff is a defect.
- No conformance fixes — this change does not audit or fix the CLI surface, help output, README.md, or docs against the standards. Binding only.
- No other file changes — `fab/project/constitution.md` is the only substantive file in the diff (no code, no tests, no README/docs, no memory). The PR also carries the standard fab change artifacts (`intake.md`, `plan.md`, `.status.yaml`, `.history.jsonl`), which are co-committed pipeline bookkeeping present in every fab change and excluded from impact per config `true_impact_exclude`.

## Tasks

<!-- Docs-only amendment: two discrete edits to one file. No code/test phases. -->

### Phase 1: Constitution Amendment

- [x] T001 Append the `### Toolkit Standards` article as the last article of `## Additional Constraints` in `fab/project/constitution.md` — immediately after the `### Self-Improvement Safety` article body and before `## Governance` — using the intake's verbatim text with `—` em-dash typography and no blank-line lead-in under the heading <!-- R1 -->
- [x] T002 Bump the governance line in `fab/project/constitution.md` to `**Version**: 1.6.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-18` (Ratified untouched) <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `### Toolkit Standards` article exists as the final article of `## Additional Constraints`, positioned after `### Self-Improvement Safety` and before `## Governance`, with the verbatim intake body, `—` typography, and no blank-line lead-in under the heading
- [x] A-002 R2: The governance line reads `**Version**: 1.6.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-18` with the Ratified date unchanged

### Behavioral Correctness

- [x] A-003 R1: The article enumerates standards via `shll standards` / `shll standards <name>` and names the sahil87/shll `docs/site/standards/` (https://shll.ai) fallback with the "bind without further amendment" clause — no standard names, counts, or per-standard URLs are hardcoded

### Code Quality

- [x] A-004 Pattern consistency: The new article matches the file's existing article structure (`###` heading, prose body with RFC-2119 keywords, em-dash typography, body starting directly under the heading)
- [x] A-005 Scope containment: `fab/project/constitution.md` is the only file changed — no code, tests, README/docs, or memory touched

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

<!-- Apply-agent record of graded decisions made while co-generating ## Requirements
     from the docs-type intake. The intake resolved all substantive decisions
     (verbatim text, em-dash typography, placement, MINOR bump) as Certain/Confident;
     no new under-specified points arose during plan generation. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plan carries no code/test tasks — docs-only amendment to constitution.md | constitution.md is not in config `source_paths`/`test_paths`; the intake pins change_type docs and scopes the diff to one governance file; the amendment IS the change | S:95 R:90 A:100 D:95 |

1 assumptions (1 certain, 0 confident, 0 tentative).
