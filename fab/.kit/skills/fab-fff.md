---
name: fab-fff
description: "Full pipeline — planning, implementation, sub-agent review, hydrate, and PR — with frontloaded questions, auto-clarify, and autonomous rework with bounded retry."
---

# /fab-fff [<change-name>]

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Run the entire Fab pipeline from the current stage through PR review in a single invocation. No confidence gates — forces through all stages regardless of scores. Frontloads questions, interleaves auto-clarify between planning stages, and autonomously reworks on review failure with bounded retry (3 cycles max, escalation after 2 consecutive fix-code failures). Resumable — re-running picks up from the first incomplete stage. Compare with `/fab-ff`, which has the same pipeline but with safety gates (intake score >= 3.0, spec confidence >= threshold, review 3-cycle stop). Both pipelines extend through ship and review-pr.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change instead of `fab/current`. Resolution per `_preamble.md` (Change-name override).

---

## Pre-flight

1. Run preflight per `_preamble.md` Section 2. Pass `<change-name>` if provided.
2. Verify `intake.md` exists. If not, STOP: `Intake not found. Run /fab-new to create the intake first, then run /fab-fff.`

---

## Context Loading

Load per `_preamble.md` Sections 1-3 (config, constitution, intake, memory index, affected memory files, all completed artifacts).

---

## Behavior

> **Note**: All `.status.yaml` mutations in this skill use `fab/.kit/bin/fab status` event commands (`start`, `advance`, `finish`, `reset`, `fail`, `set-checklist`) rather than direct file edits. Driver is optional in the CLI but this skill always passes `fab-fff`.
>
> **Dispatch**: All sub-skill invocations use the Agent tool (`general-purpose` subagent) per `_preamble.md` § Subagent Dispatch. Each subagent reads the target skill file, follows the specified behavior, and returns a structured result to the pipeline.

### Resumability

Check `progress` from preflight. Skip stages already `done`. If `review-pr: done`, pipeline is already complete.

### Step 1: Frontload All Questions

Apply SRAD across the intake for all planning stages. Collect **Unresolved** decisions into a single batch. All four grades (Certain, Confident, Tentative, Unresolved) are tracked in the cumulative Assumptions summary.

- **Unresolved exist**: Present as numbered list, wait for answers, then proceed.
- **None**: Skip to Step 2.

At most one Q&A round.

### Step 2: Generate `spec.md`

*(Skip if `progress.spec` is `done`.)*

Follow **Spec Generation Procedure** (`_generation.md`). Incorporate answers from Step 1 — no `[NEEDS CLARIFICATION]` markers. Update `.status.yaml` via `fab/.kit/bin/fab status finish <change> spec fab-fff`.

**Auto-Clarify**: Dispatch `/fab-clarify` as subagent — `[AUTO-MODE]`, target: `spec.md`, change: `{id}`. Returns `{resolved, blocking, non_blocking}`. If `blocking: 0` → continue. If `blocking > 0` → **BAIL**: report blocking issues, suggest `/fab-clarify` then `/fab-fff`.

### Step 3: Generate `tasks.md`

*(Skip if `progress.tasks` is `done`.)*

Follow **Tasks Generation Procedure** (`_generation.md`).

**Auto-Clarify**: Dispatch `/fab-clarify` as subagent — `[AUTO-MODE]`, target: `tasks.md`, change: `{id}`. Same bail logic as Step 2.

### Step 4: Generate Quality Checklist

Follow **Checklist Generation Procedure** (`_generation.md`).

### Step 5: Update `.status.yaml` (Planning Complete)

Run `fab/.kit/bin/fab status finish <change> tasks fab-fff`. Then set checklist fields via `fab/.kit/bin/fab status set-checklist <change> generated true`, `fab/.kit/bin/fab status set-checklist <change> total <count>`, `fab/.kit/bin/fab status set-checklist <change> completed 0`.

### Step 6: Implementation

*(Skip if `progress.apply` is `done`.)*

Dispatch `/fab-continue` as subagent — Apply Behavior, change: `{id}`. The subagent parses unchecked tasks, executes in dependency order, runs tests, and marks `[x]` on completion. Returns completion status or failure with task ID and reason.

**If task fails**: STOP with `Task {ID} failed: {reason}. Investigate and re-run /fab-fff.`

On success: run `fab/.kit/bin/fab status finish <change> apply fab-fff`.

### Step 7: Review

*(Skip if `progress.review` is `done`.)*

Dispatch `/fab-continue` as subagent — Review Behavior, change: `{id}`. The subagent dispatches validation to a review sub-agent, performs all checks, and returns structured findings (must-fix / should-fix / nice-to-have) with pass/fail status.

**Pass**: run `fab/.kit/bin/fab status finish <change> review fab-fff`. Proceed to Step 8.

**Fail**: Autonomous rework with bounded retry. Run `fab/.kit/bin/fab status fail <change> review` then `fab/.kit/bin/fab status reset <change> apply fab-fff`. The agent triages the sub-agent's prioritized findings and autonomously selects the rework path — no user interaction. Must-fix items are always addressed; should-fix items when clear and low-effort; nice-to-have items may be skipped.

**Decision heuristics** (applied to prioritized findings):
- **Must-fix: test failures, spec mismatches, checklist violations** → "Fix code" — uncheck affected tasks with `<!-- rework: reason -->`, re-run apply, then spawn a **fresh sub-agent** for re-review
- **Must-fix: missing functionality, incomplete coverage, wrong task breakdown** → "Revise tasks" — add/modify tasks in `tasks.md`, re-run apply, then spawn a fresh sub-agent for re-review
- **Must-fix: spec drift, requirements mismatch, fundamental approach issues** → "Revise spec" — reset to spec stage, regenerate downstream, re-run apply, then spawn a fresh sub-agent for re-review

**Retry cap**: Maximum **3 rework cycles** (each cycle = one rework action + one re-review by a fresh sub-agent). After 3 failed cycles, **BAIL** with:

```
Review failed after 3 rework attempts. Summary:
  Cycle 1: {action} — {what was done}
  Cycle 2: {action} — {what was done}
  Cycle 3: {action} — {what was done}
Run /fab-continue for manual rework options.
```

**Escalation rule**: If the agent chooses "Fix code" and the subsequent sub-agent review fails again on the same or similar issues, the agent MUST escalate to "Revise tasks" or "Revise spec" after **2 consecutive "fix code" attempts**. This is a hard rule — the agent SHALL NOT choose "Fix code" a third time in a row, even if it believes another code fix would work. Non-fix-code actions (revise tasks, revise spec) reset the consecutive counter.

### Step 8: Hydrate

*(Skip if `progress.hydrate` is `done`.)*

Dispatch `/fab-continue` as subagent — Hydrate Behavior, change: `{id}`. The subagent validates review passed, hydrates into `docs/memory/`, and runs `fab/.kit/bin/fab status finish <change> hydrate fab-fff`. Returns completion status.

### Step 9: Ship

*(Skip if `progress.ship` is `done`.)*

Dispatch `/git-pr` as subagent — change: `{id}`. The subagent commits, pushes, and creates a GitHub PR. Handles statusman integration internally (start/finish ship stage). Returns PR URL or error.

**If git-pr fails**: STOP with the error from git-pr. The ship stage remains `active` for user retry.

On success: `progress.ship` becomes `done`, `progress.review-pr` auto-activates.

### Step 10: Review-PR

*(Skip if `progress.review-pr` is `done`.)*

Dispatch `/git-pr-review` as subagent — change: `{id}`. The subagent detects reviews, triages comments, applies fixes, and pushes; requests Copilot as reviewer if no reviews exist, then polls for up to 8 minutes. Handles statusman integration internally (start/finish/fail review-pr stage). Returns completion status.

**If review-pr fails** (no PR found, processing error): STOP with the error.

**If no reviews arrive** (Copilot unavailable or timeout): the stage completes as `done` — this is a successful no-op.

On success: `progress.review-pr` becomes `done`.

---

## Output

```
/fab-fff — full pipeline, no gate.

--- Planning ---
{spec + tasks + checklist output, with auto-clarify results}

## Assumptions (cumulative)
{table with Artifact column}

--- Implementation ---
{apply output}

--- Review ---
{review output}

--- Hydrate ---
{hydrate output}

--- Ship ---
{git-pr output}

--- Review-PR ---
{git-pr-review output}

Pipeline complete.

Next: {per state table}
```

Resuming shows `(resuming)...` header and `Skipping {stage} — already done.` for completed stages. Bail/failure stops at the relevant stage with `Next:` derived from the state reached per state table in `_preamble.md`.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Preflight fails | Abort with stderr message |
| `intake.md` missing | Abort: "Run /fab-new first." |
| Auto-clarify bails | Stop, report blocking issues, suggest `/fab-clarify` then `/fab-fff` |
| Task fails | Stop: "Task {ID} failed: {reason}. Investigate and re-run /fab-fff." |
| Review fails | Autonomous rework: agent triages sub-agent's prioritized findings, selects path, 3-cycle retry cap (each re-review by fresh sub-agent), escalation after 2 consecutive fix-code. Bail after 3 cycles with summary. |
| Ship fails | Stop with git-pr error. User retries /fab-fff or /git-pr. |
| Review-PR fails | Stop with git-pr-review error. User retries /fab-fff or /git-pr-review. |
