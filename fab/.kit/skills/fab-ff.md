---
name: fab-ff
description: "Full pipeline with safety gates — confidence-gated pipeline from intake through hydrate, with sub-agent review, auto-rework loop, and stop on exhaustion."
---

# /fab-ff [<change-name>]

> Read and follow the instructions in `./fab/.kit/skills/_preamble.md` before proceeding.

---

## Purpose

Full pipeline with safety gates: intake → spec → tasks → apply → review → hydrate. Three gates where execution can stop: (1) intake gate — indicative confidence >= 3.0, (2) spec gate — confidence >= per-type threshold via `fab/.kit/scripts/lib/calc-score.sh --check-gate`, (3) review gate — stops after 3 autonomous rework cycles. On any gate stop, the user can intervene then re-run. Resumable — re-running picks up from the first incomplete stage.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change instead of `fab/current`. Resolution per `_preamble.md` (Change-name override).

---

## Pre-flight

1. Run preflight per `_preamble.md` Section 2. Pass `<change-name>` if provided.
2. **Intake prerequisite**: Verify `intake.md` exists. If not, STOP: `Intake not found. Run /fab-new to create the intake first.`
3. **Intake gate**: Run `fab/.kit/scripts/lib/calc-score.sh --check-gate --stage intake <change>`. If the gate fails → STOP: `Indicative confidence is {score} of 5.0 (need >= 3.0). Run /fab-clarify to resolve, then retry.`

---

## Context Loading

Load per `_preamble.md` Sections 1-3 (config, constitution, intake, memory index, affected memory files, all completed artifacts).

---

## Behavior

> **Note**: All `.status.yaml` mutations in this skill use `fab/.kit/scripts/lib/statusman.sh` event commands (`start`, `advance`, `finish`, `reset`, `fail`, `set-checklist`) rather than direct file edits. The driver argument is optional, but this skill always passes `fab-ff`.

### Resumability

Check `progress` from preflight. Skip stages already `done`. If `hydrate: done`, pipeline is already complete.

### Step 1: Generate `spec.md`

*(Skip if `progress.spec` is `done`.)*

Follow **Spec Generation Procedure** (`_generation.md`). No frontloaded questions. Update `.status.yaml` via `fab/.kit/scripts/lib/statusman.sh finish <change> intake fab-ff`.

**Spec gate**: After spec generation, run `fab/.kit/scripts/lib/calc-score.sh --check-gate <change>`. If the gate fails → **STOP**: `Confidence is {score} of 5.0 (need > {threshold} for {change_type}). Run /fab-clarify to resolve, then retry /fab-ff.`

**Auto-Clarify**: Invoke `/fab-clarify` with `[AUTO-MODE]` prefix on the generated spec. If `blocking: 0` → continue. If `blocking > 0` → **BAIL**: report issues, suggest `/fab-clarify` then `/fab-ff`.

### Step 2: Generate `tasks.md`

*(Skip if `progress.tasks` is `done`.)*

Follow **Tasks Generation Procedure** (`_generation.md`).

**Auto-Clarify**: Invoke `/fab-clarify` with `[AUTO-MODE]` prefix on the generated tasks. If `blocking: 0` → continue. If `blocking > 0` → **BAIL**: report issues, suggest `/fab-clarify` then `/fab-ff`.

### Step 3: Generate Quality Checklist

*(Skip if checklist already generated.)*

Follow **Checklist Generation Procedure** (`_generation.md`).

### Step 4: Update `.status.yaml` (Planning Complete)

Run `fab/.kit/scripts/lib/statusman.sh finish <change> tasks fab-ff`. Then set checklist fields via `fab/.kit/scripts/lib/statusman.sh set-checklist <change> generated true`, `fab/.kit/scripts/lib/statusman.sh set-checklist <change> total <count>`, `fab/.kit/scripts/lib/statusman.sh set-checklist <change> completed 0`.

### Step 5: Implementation

*(Skip if `progress.apply` is `done`.)*

Execute apply behavior per `/fab-continue` — parse unchecked tasks, execute in dependency order, run tests, mark `[x]` on completion.

**If task fails**: STOP with `Task {ID} failed: {reason}. Investigate and re-run /fab-ff.`

On success: run `fab/.kit/scripts/lib/statusman.sh finish <change> apply fab-ff`.

### Step 6: Review

*(Skip if `progress.review` is `done`.)*

Dispatch review to a **sub-agent** per `/fab-continue` Review Behavior — the sub-agent runs in a separate execution context, performs all validation checks, and returns structured findings with three-tier priority (must-fix / should-fix / nice-to-have).

**Pass**: run `fab/.kit/scripts/lib/statusman.sh finish <change> review fab-ff`. Proceed to Step 7.

**Fail**: Auto-rework loop with bounded retry, then interactive fallback. Run `fab/.kit/scripts/lib/statusman.sh fail <change> review` then `fab/.kit/scripts/lib/statusman.sh start <change> apply fab-ff`.

#### Auto-Rework Loop (up to 3 cycles)

The agent triages the sub-agent's prioritized findings and autonomously selects the rework path — no user interaction. Must-fix items are always addressed; should-fix items when clear and low-effort; nice-to-have items may be skipped.

**Decision heuristics** (applied to prioritized findings):
- **Must-fix: test failures, spec mismatches, checklist violations** → "Fix code" — uncheck affected tasks with `<!-- rework: reason -->`, re-run apply, then spawn a **fresh sub-agent** for re-review
- **Must-fix: missing functionality, incomplete coverage, wrong task breakdown** → "Revise tasks" — add/modify tasks in `tasks.md`, re-run apply, then spawn a fresh sub-agent for re-review
- **Must-fix: spec drift, requirements mismatch, fundamental approach issues** → "Revise spec" — reset to spec stage, regenerate downstream, re-run apply, then spawn a fresh sub-agent for re-review

**Escalation rule**: If the agent chooses "Fix code" and the subsequent sub-agent review fails again on the same or similar issues, the agent MUST escalate to "Revise tasks" or "Revise spec" after **2 consecutive "fix code" attempts**. This is a hard rule — the agent SHALL NOT choose "Fix code" a third time in a row, even if it believes another code fix would work. Non-fix-code actions (revise tasks, revise spec) reset the consecutive counter.

#### Stop (after 3 failed cycles)

After 3 auto-rework cycles fail, **STOP** with a per-cycle summary:

```
Review failed after 3 rework attempts. Summary:
  Cycle 1: {action} — {what was done}
  Cycle 2: {action} — {what was done}
  Cycle 3: {action} — {what was done}
Run /fab-continue for manual rework options.
```

The user can run `/fab-continue` for interactive rework, or `/fab-clarify` to deepen the spec/tasks before re-running `/fab-ff`.

### Step 7: Hydrate

*(Skip if `progress.hydrate` is `done`.)*

Execute hydrate behavior per `/fab-continue` — validate review passed, hydrate into `docs/memory/`, run `fab/.kit/scripts/lib/statusman.sh finish <change> hydrate fab-ff`.

---

## Output

```
/fab-ff — confidence {score} of 5.0, gate passed.

--- Planning ---
{tasks + checklist output}

--- Implementation ---
{apply output}

--- Review ---
{review output}

--- Hydrate ---
{hydrate output}

Pipeline complete. Change hydrated.

Next: {per state table}
```

Resuming shows `(resuming)...` header and `Skipping {stage} — already done.` for completed stages. Bail/failure stops at the relevant stage with `Next:` derived from the state reached per state table in `_preamble.md`.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Preflight fails | Abort with stderr message |
| `intake.md` missing | Abort: "Intake not found. Run /fab-new first." |
| Intake gate fails (indicative < 3.0) | Stop with score and guidance |
| Spec gate fails (confidence < threshold) | Stop with score, threshold, and guidance |
| Auto-clarify bails | Stop, report blocking issues, suggest `/fab-clarify` then `/fab-ff` |
| Task fails | Stop: "Task {ID} failed: {reason}. Investigate and re-run /fab-ff." |
| Review fails | Auto-rework loop: 3 cycles (each re-review by fresh sub-agent), escalation after 2 consecutive fix-code. Stops after 3 cycles with summary. |
