---
name: fab-continue
description: "Advance to the next pipeline stage — planning, implementation, review, or hydrate — or reset to a given stage."
---

# /fab-continue [<change-name>] [<stage>]

> Read and follow the instructions in `./fab/.kit/skills/_preamble.md` before proceeding.

---

## Purpose

Advance through the 6-stage Fab pipeline one step at a time. Each invocation handles the current stage's work and transitions to the next. When called with a stage argument, resets to that stage and re-runs from there.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change instead of `fab/current`. Passed to preflight as `$1` (see `_preamble.md` §2).
- **`<stage>`** *(optional)* — reset target: `intake`, `spec`, `tasks`, `apply`, `review`, `hydrate`.

Both may be provided in any order. Stage names are treated as reset targets; all others as change-name overrides.

---

## Pre-flight

1. Classify arguments: stage name vs. change-name override (stage names take priority)
2. Run preflight per `_preamble.md` §2
3. Use preflight's `stage` and `progress` fields for all subsequent logic

---

## Normal Flow

### Step 1: Determine Current Stage

Dispatch on preflight's derived `stage` and `display_state`. If progress is `pending`, run `fab/.kit/scripts/lib/statusman.sh start <change> <stage> fab-continue` before dispatching.

**State-based dispatch**: For planning stages, `/fab-continue` consolidates work into a single invocation:
- **`ready`** (planning) → Finish the current stage, start the next, generate its artifact, and advance it to `ready`
- **`active`** (planning) → Generate the stage's artifact and advance to `ready` (backward compat for interrupted generations)
- **`active`/`ready`** (execution) → Execute the stage's behavior and finish it

| Derived stage | State | Action |
|---------------|-------|--------|
| `intake` | `ready` | finish intake → start spec → generate `spec.md` → advance spec to `ready` |
| `intake` | `active` | generate intake if missing → advance to `ready` |
| `spec` | `ready` | finish spec → start tasks → generate `tasks.md` + checklist → advance tasks to `ready` |
| `spec` | `active` | generate `spec.md` → advance to `ready` |
| `tasks` | `ready` | finish tasks → start apply → execute tasks → finish apply |
| `tasks` | `active` | generate `tasks.md` + checklist → advance to `ready` |
| `apply` | `active`/`ready` | Execute apply → on completion run `finish <change> apply fab-continue` (auto-activates review) |
| `review` | `active`/`ready` | Execute review → pass: run `finish <change> review fab-continue` (auto-activates hydrate). Fail: run `fail <change> review` then `start <change> apply fab-continue` |
| `hydrate` | `active`/`ready` | Execute hydrate → run `finish <change> hydrate fab-continue` |
| all `done` | — | Block: "Change is complete." |

### Step 2: Load Context

Load per `_preamble.md` layers. Stage-specific additions: planning stages load intake + memory files; apply loads spec + tasks + source code; review adds checklist + memory; hydrate loads memory index + target files.

### Step 3: SRAD + Generation

**Planning stages only**: Apply SRAD (`_preamble.md`) before generating. Budget: 1-2 unresolved questions per stage. Tentative decisions get `<!-- assumed: ... -->` markers.

| Stage | Procedure |
|-------|-----------|
| spec | **Spec Generation Procedure** (`_generation.md`) |
| tasks | **Tasks Generation Procedure** + **Checklist Generation Procedure** (`_generation.md`) |
| apply | [Apply Behavior](#apply-behavior) |
| review | [Review Behavior](#review-behavior) |
| hydrate | [Hydrate Behavior](#hydrate-behavior) |

**Spec stage only**: After spec generation, invoke `fab/.kit/scripts/lib/calc-score.sh <change>` to compute the confidence score. No scoring at other stages.

### Step 4: Update `.status.yaml`

Use event commands via CLI to update `.status.yaml`. The `finish` command handles the two-write transition atomically: `fab/.kit/scripts/lib/statusman.sh finish <change> <completed-stage> fab-continue`. This sets `{completed}` → `done`, auto-activates the next pending stage, refreshes `last_updated`, and updates `stage_metrics`.

For other state changes, use the appropriate event command (driver is always optional):
- `fab/.kit/scripts/lib/statusman.sh start <change> <stage> fab-continue` — pending/failed → active
- `fab/.kit/scripts/lib/statusman.sh advance <change> <stage>` — active → ready
- `fab/.kit/scripts/lib/statusman.sh fail <change> <stage>` — active → failed (review only)
- `fab/.kit/scripts/lib/statusman.sh reset <change> <stage> fab-continue` — done/ready → active (cascades downstream to pending)

### Step 5: Output

Display summary. Include Assumptions summary for planning stages. End with `Next:` per state table in `_preamble.md`.

---

## Apply Behavior

### Preconditions

- `tasks.md` MUST exist
- If stage is `tasks`: run `fab/.kit/scripts/lib/statusman.sh finish <change> tasks fab-continue` before starting (auto-activates apply)

### Pattern Extraction

Before executing the first unchecked task, read existing source files in the areas the change will touch and extract:

1. **Naming conventions** — variable/function/class naming style observed in surrounding code
2. **Error handling** — how the codebase handles errors (exceptions, Result types, error codes, etc.)
3. **Structure** — typical function length, module boundaries, import organization
4. **Reusable utilities** — existing helpers or shared modules that new code should use instead of reimplementing

Hold these patterns as context for all subsequent task execution within the same apply run.

If `fab/project/code-quality.md` exists, load its `## Principles` as additional implementation constraints alongside extracted patterns. If a `## Test Strategy` section is defined, it governs test timing (default: `test-alongside`).

**Skip on resume**: When resuming mid-apply (some tasks already `[x]`), pattern extraction is skipped — patterns are re-derived implicitly from reading task-relevant source files.

### Task Execution

1. Parse tasks: `- [ ]` = remaining, `- [x]` = skip
2. If all checked: run `fab/.kit/scripts/lib/statusman.sh finish <change> apply fab-continue` (auto-activates review). Stop.
3. Execute in phase order; within phases, non-`[P]` sequential, `[P]` parallelizable. Respect Execution Order constraints.
4. For each unchecked task:
   1. Read source files relevant to this task
   2. Implement per spec, constitution, and extracted patterns
   3. Prefer reusing existing utilities over creating new ones
   4. Keep functions focused — if implementation exceeds the codebase's typical function size, consider extracting
   5. Write tests per `fab/project/code-quality.md` test strategy (default: `test-alongside`)
   6. Run tests, fix failures
   7. Mark `[x]` immediately
5. On completion: run `fab/.kit/scripts/lib/statusman.sh finish <change> apply fab-continue` (auto-activates review).

### Resumability

Starts from first unchecked item. Checked items assumed complete.

---

## Review Behavior

### Preconditions

- `tasks.md` and `checklist.md` MUST exist
- All tasks MUST be `[x]`. If not: STOP with "{N} of {total} tasks are incomplete."

### Sub-Agent Dispatch

Review validation SHALL be dispatched to a **sub-agent running in a separate execution context**. The sub-agent provides a fresh perspective — it has no shared context with the applying agent beyond the explicitly provided artifacts.

The orchestrating LLM MAY use any review agent available in its environment (e.g., a `code-review` skill, a general-purpose sub-agent with review instructions, or any equivalent). The skill files SHALL NOT hardcode a specific agent name or tool.

The review sub-agent performs capable-tier work: deep reasoning, code analysis, spec comparison, and checklist validation.

**Context provided to the sub-agent**: `spec.md`, `tasks.md`, `checklist.md`, relevant source files (files touched by the change), target memory file(s) from `docs/memory/`, `fab/project/constitution.md`, `fab/project/context.md` (if present), `fab/project/code-quality.md` (if present), and `fab/project/code-review.md` (if present).

### Validation Steps

The sub-agent performs all of these checks:

1. **Tasks complete**: All `[x]` in `tasks.md`
2. **Quality checklist**: Inspect code/tests per CHK item. Mark `[x]` if met, `[x] **N/A**: {reason}` if N/A, leave `[ ]` with reason if not met
3. **Run affected tests**: Scoped to touched modules/files
4. **Spot-check spec**: Verify key requirements and GIVEN/WHEN/THEN scenarios
5. **Memory drift check**: Compare implementation against referenced memory (warning only)
6. **Code quality check**: For each file modified during apply, verify:
   - Naming conventions consistent with surrounding code
   - Functions focused and appropriately sized
   - Error handling consistent with codebase style
   - Existing utilities reused where applicable
   - If `fab/project/code-quality.md` exists, check each applicable principle from `## Principles`
   - If `fab/project/code-quality.md` exists, check for violations listed in `## Anti-Patterns`

### Structured Review Output

The sub-agent SHALL return structured findings with a **three-tier priority scheme**:

- **Must-fix**: Spec mismatches, failing tests, checklist violations — always addressed during rework
- **Should-fix**: Code quality issues, pattern inconsistencies — addressed when clear and low-effort
- **Nice-to-have**: Style suggestions, minor improvements — may be skipped

Each finding includes: severity tier, description, and file:line reference where applicable.

**Pass/fail determination**: If any must-fix findings exist, the review fails. If only should-fix and/or nice-to-have findings remain, the review MAY be considered a pass.

### Verdict

**Pass**: Run `fab/.kit/scripts/lib/statusman.sh finish <change> review fab-continue` (auto-activates hydrate). Update checklist via `fab/.kit/scripts/lib/statusman.sh set-checklist <change> completed <N>`. Output report + `Next: {per state table}`.

**Fail** (manual rework — `/fab-continue` only): Run `fab/.kit/scripts/lib/statusman.sh fail <change> review` then `fab/.kit/scripts/lib/statusman.sh start <change> apply fab-continue`. Update checklist via `fab/.kit/scripts/lib/statusman.sh set-checklist <change> completed <N>`. Present findings with priority annotations, then offer rework options:

| Option | When | Action |
|--------|------|--------|
| Fix code | Implementation bug (must-fix / should-fix items) | Uncheck affected tasks with `<!-- rework: {reason} -->`, run `/fab-continue` |
| Revise tasks | Missing/wrong tasks | Add/modify tasks, run `/fab-continue` |
| Revise spec | Requirements wrong | Run `/fab-continue spec` to reset downstream |

The applying agent triages review comments by priority — not all comments need to be implemented. Must-fix items are always addressed. Should-fix items are addressed when clear and low-effort. Nice-to-have items may be acknowledged but deferred.

---

## Hydrate Behavior

### Preconditions

- `progress.review` MUST be `done`. If not: STOP.
- All tasks and checklist items MUST be `[x]`

### Steps

1. Final validation: all tasks and checklist `[x]`
2. Concurrent change check: warn on overlap with other changes referencing same memory paths
3. Hydrate `docs/memory/`: create new files/domains, update existing (Requirements, Design Decisions, Changelog), update indexes
4. Run `fab/.kit/scripts/lib/statusman.sh finish <change> hydrate fab-continue`
5. **Pattern capture** *(optional)*: If the change introduced non-obvious implementation patterns that future changes should follow (e.g., a new error handling approach, a reusable abstraction), note them in the relevant memory file's Design Decisions section with the change name for traceability. Skip for implementations that follow existing patterns without introducing new ones

---

## Reset Flow (with stage argument)

1. **Validate**: Must be one of the 6 stage names
2. **Load context** for the target stage
3. **Reset `.status.yaml`**: Run `fab/.kit/scripts/lib/statusman.sh reset <change> <stage> fab-continue`. This atomically sets the target stage → `active` and cascades all downstream stages → `pending`. Stages before the target are preserved.
4. **Execute**: Planning stages regenerate artifact. Execution stages re-run (task checkboxes NOT reset).
5. **Invalidate downstream** (planning resets only): intake reset → all downstream pending; spec reset → tasks pending; tasks reset → reset all `[x]` → `[ ]`, regenerate checklist. The `reset` command handles the status cascading automatically.
6. **Post-execution**: For **planning resets**, after regenerating the artifact, use `fab/.kit/scripts/lib/statusman.sh advance <change> <stage>` to move the target stage back to `ready` and stop there — **do not** run `finish`, to avoid auto-activating the next pending stage. For **execution resets**, use the normal `finish` commands, which will auto-activate the next pending stage.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| `tasks.md` missing for apply | "No tasks.md found. Run /fab-continue to generate tasks first." |
| `checklist.md` missing for review | "No checklist found. Run /fab-continue to generate it first." |
| Incomplete tasks for review | "{N} of {total} tasks incomplete." |
| Review not passed for hydrate | "Review has not passed." |
| Unknown reset target | "Unknown stage. Valid: intake, spec, tasks, apply, review, hydrate." |
| Template file missing | "Template not found — kit may be corrupted." |

---

## Key Properties

| Property | Value |
|----------|-------|
| Idempotent? | Yes — planning regenerates, apply resumes, review re-validates |
| Modifies source code? | Yes — during apply |
| Modifies `docs/memory/`? | Yes — during hydrate |
| Moves change folder / clears `fab/current`? | No — use `/fab-archive` |
