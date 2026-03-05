---
name: _generation
description: "Artifact generation procedures — shared logic for intake, spec, and tasks generation used by fab-continue and fab-ff."
user-invocable: false
disable-model-invocation: true
metadata:
  internal: true
---
# Artifact Generation Procedures

> This file defines the shared artifact generation logic used by both `/fab-continue` and `/fab-ff`.
> Each skill references these procedures instead of inlining them, ensuring generation behavior
> is authoritative in one location.
>
> **Orchestration** (stage guards, question handling, design decisions, auto-clarify, resumability)
> remains in each skill's own file. This partial covers only the mechanics of producing each artifact.

---

## Intake Generation Procedure

> **Generation rule**: The intake is a state transfer document — downstream agents (spec, tasks, checklist)
> have NO shared context beyond this file and the always-loaded config/constitution/memory. Every section
> must contain enough concrete detail (examples, code blocks, specific values, exact behavior descriptions)
> for an agent with no conversation history to generate a complete spec. If a design decision was discussed
> with specific values — include them verbatim. Do not summarize or abstract.

1. Read the template from `fab/.kit/templates/intake.md`
2. Fill in metadata fields:
   - `{CHANGE_NAME}`: Human-readable name from the description
   - `{YYMMDD-XXXX-slug}`: The change folder name
   - `{DATE}`: Today's date
3. For each section (Origin, Why, What Changes, Affected Memory, Impact, Open Questions):
   - Write substantively — no placeholder text, no single-sentence descriptions
   - Include concrete examples: code blocks, YAML snippets, specific file paths, exact behavior
   - The "What Changes" section should be the most detailed — use subsections per change area
   - If a design includes specific values (config structure, template content, validation questions), reproduce them in full
4. Append `## Assumptions` section per `_preamble.md` SRAD framework
5. Write the completed intake to `fab/changes/{name}/intake.md`

---

## Spec Generation Procedure

1. Read the template from `fab/.kit/templates/spec.md`
2. Fill in metadata fields:
   - `{CHANGE_NAME}`: The human-readable name from the intake
   - `{YYMMDD-XXXX-slug}`: The change folder name from `.status.yaml`
   - `{DATE}`: Today's date
   - `{domain}` and `{file-name}`: From the intake's Affected Memory section
2b. **Non-Goals** (optional): If the change has meaningful scope exclusions, include a `## Non-Goals` section after the metadata block and before the first domain section. Each non-goal is a bullet: `- {what is excluded} — {brief reason, if not obvious}`. Derive non-goals from the intake's scope boundaries and any explicit exclusions discussed. Omit this section entirely for straightforward changes with no meaningful exclusions.
3. For each domain/topic affected by this change, create a section with:
   - Requirements using RFC 2119 keywords (MUST, SHALL, SHOULD, MAY)
   - At least one GIVEN/WHEN/THEN scenario per requirement
4. Include a **Deprecated Requirements** section if the change removes existing requirements
5. Mark any unresolved ambiguities with `[NEEDS CLARIFICATION]` inline
5b. **Design Decisions** (optional): If the change involves architectural choices, technology selection, or non-obvious approaches, include a `## Design Decisions` section after the domain requirement sections. Each decision entry SHALL include: decision summary, rationale (why this choice), and rejected alternatives. Omit this section for straightforward changes.
6. Append an `## Assumptions` section. Read `intake.md`'s `## Assumptions` table as the starting point — confirm, upgrade, or override each intake assumption based on spec-level analysis (note the action in Rationale, e.g., "Confirmed from intake #1", "Upgraded from intake Tentative"). Add new assumptions discovered during spec generation. Include all four SRAD grades (Certain, Confident, Tentative, Unresolved) with required Scores column. The spec's Assumptions table is the sole scoring source for `fab/.kit/bin/fab score` (see Assumptions Summary Block in `_preamble.md`)
7. Write the completed spec to `fab/changes/{name}/spec.md`

---

## Tasks Generation Procedure

1. Read the template from `fab/.kit/templates/tasks.md`
2. Fill in metadata fields:
   - `{CHANGE_NAME}`: From the intake
   - `{YYMMDD-XXXX-slug}`: The change folder name
   - Include `intake.md` reference for traceability
3. Break implementation into phased tasks:
   - **Phase 1: Setup** — scaffolding, dependencies, configuration
   - **Phase 2: Core Implementation** — primary functionality, ordered by dependency
   - **Phase 3: Integration & Edge Cases** — wiring, error states, validation
   - **Phase 4: Polish** — documentation, cleanup (only if warranted)
4. Each task follows the format: `- [ ] T{NNN} [{markers}] {description with file paths}`
   - IDs are sequential: T001, T002, ...
   - Mark parallelizable tasks with `[P]`
   - Include exact file paths in descriptions
   - Each task should be completable in one focused session
5. Include an **Execution Order** section for non-obvious dependencies
6. Write the completed tasks to `fab/changes/{name}/tasks.md`

---

## Checklist Generation Procedure

1. Read the template from `fab/.kit/templates/checklist.md`
2. Generate `fab/changes/{name}/checklist.md` with:
   - `{CHANGE_NAME}`: From the intake
   - `{YYMMDD-XXXX-slug}`: The change folder name
   - `{DATE}`: Today's date
4. Populate checklist items derived from:
   - `spec.md` — every requirement should have a corresponding CHK item under **Functional Completeness**
   - Changed requirements → **Behavioral Correctness** items
   - Deprecated requirements → **Removal Verification** items
   - Key scenarios from spec → **Scenario Coverage** items
   - Edge cases identified in spec → **Edge Cases & Error Handling** items
   - `fab/project/code-quality.md` → **Code Quality** items. If `fab/project/code-quality.md` exists: one item per relevant principle from `## Principles`, one per relevant anti-pattern from `## Anti-Patterns` that applies to the change's scope, plus the two baseline items. If no `fab/project/code-quality.md`: include the two baseline items only (pattern consistency, no unnecessary duplication)
   - Security-relevant changes → **Security** items (only if applicable)
   - Additional categories from `fab/project/config.yaml` `checklist.extra_categories` (if any)
5. Use sequential IDs: CHK-001, CHK-002, ...
6. Update `.status.yaml` via CLI:
   - `fab/.kit/bin/fab status set-checklist <change> generated true`
   - `fab/.kit/bin/fab status set-checklist <change> total <count>` (number of checklist items generated)
   - `fab/.kit/bin/fab status set-checklist <change> completed 0`
