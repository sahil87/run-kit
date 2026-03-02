---
name: fab-clarify
description: "Refine the current stage artifact — resolve gaps, ambiguities, or [NEEDS CLARIFICATION] markers without advancing."
---

# /fab-clarify [<change-name>] [<target-artifact>]

> Read and follow the instructions in `./fab/.kit/skills/_preamble.md` before proceeding.

---

## Purpose

Deepen and refine the current stage artifact without advancing. Two modes:

- **Suggest mode** (user invocation) — interactive question flow with recommendations
- **Auto mode** (internal `fab-ff` call) — autonomous resolution, returns machine-readable result

Mode determined by `[AUTO-MODE]` prefix (see `_preamble.md` > Skill Invocation Protocol). Safe to call multiple times.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change (see `_preamble.md` > Change-name override). `fab/current` unchanged.
- **`<target-artifact>`** *(optional)* — `intake`, `spec`, or `tasks`. **Required** at post-planning stages. Defaults to current stage's artifact at planning stages.

Disambiguation: matches `intake`/`spec`/`tasks` → target artifact; anything else → change name. Both can be provided.

---

## Pre-flight & Stage Guard

Run preflight per `_preamble.md` §2.

- **Planning stages** (`intake`, `spec`, `tasks`) with state `active` or `ready` — defaults to current stage's artifact if it exists; if the current stage is `pending` (no artifact yet), fall back to the previous `done` stage's artifact. `<target-artifact>` overrides either default. At the `intake` stage, the taxonomy scan covers intake artifact refinement (scope boundaries, affected areas, blocking questions, impact, memory coverage). When state is `ready`, the artifact exists — scanning proceeds normally and the stage stays `ready` throughout.
- **Post-planning** (`apply`, `review`, `hydrate`) — requires `<target-artifact>`. If missing, prompt: "Which planning artifact to clarify? (1) spec, (2) tasks, (3) intake"

---

## Suggest Mode (User Invocation)

### Step 1: Read Target Artifact

Resolve file (`intake.md`, `spec.md`, or `tasks.md`). If the resolved artifact is missing and the target was defaulted (not user-specified), fall back to the previous `done` stage's artifact. If still missing or the target was explicitly specified: STOP with "No {artifact} found. Run /fab-continue to generate it first."

### Step 1.5: Bulk Confirm (Confident Assumptions)

After reading the target artifact, parse the `## Assumptions` table and count assumptions by grade. Trigger bulk confirm when BOTH:

1. `confident >= 3`
2. `confident > tentative + unresolved`

If NOT triggered, skip to Step 2.

#### Display

Present all Confident assumptions as a numbered list using the original `#` column from the Assumptions table:

```
## Confident Assumptions ({N} items — primary confidence drag)

Review each and respond with: ✓ (confirm), a new value, or ? (explain).

{original_#}. {Decision} — {Rationale}
...
```

Do NOT use `AskUserQuestion`. Display as plain text and read the user's next conversational message as the response.

#### Response Parsing

Recognize these formats (case-insensitive for keywords):

| Format | Meaning |
|--------|---------|
| `{#}. ✓` or `{#}. ok` or `{#}. yes` | Confirm |
| `{#}.` (bare number with period) | Confirm |
| `{#}. {free text}` | Change value |
| `{#}. ?` or `{#}. explain` | Request explanation |
| `{start}-{end}. ✓` or `{start}-{end}. ok` | Confirm range |
| `all ✓` or `all ok` or `all yes` | Confirm all |

Items not mentioned remain Confident (unchanged).

#### Explanation Re-prompt

For items marked `?` or `explain`:

1. Provide a brief inline explanation of the assumption's reasoning and implications
2. Re-prompt for ONLY the unexplained items: `Still pending: #{#}. {Decision} — respond with ✓ or a new value`
3. Accept the same response formats

At most one round of re-prompting. After the re-prompt response, unresolved items remain Confident.

#### Artifact Update

For each resolved item, update the `## Assumptions` table in place:

| Action | Grade | Rationale | Scores |
|--------|-------|-----------|--------|
| Confirmed | → Certain | `Clarified — user confirmed` | S → 95 |
| Changed | → Certain | `Clarified — user changed to {value}` | S → 95 |
| Explained then confirmed | → Certain | `Clarified — user confirmed after explanation` | S → 95 |

For changed items, also update the Decision column with the user's new value. Only the S dimension changes to 95; R, A, D remain unchanged.

#### Audit Trail

Append to `## Clarifications` (create before `## Assumptions` if it doesn't exist):

```markdown
### Session {YYYY-MM-DD} (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| {#} | Confirmed | — |
| {#} | Changed | "{new value}" |
| {#} | Confirmed | After explanation |
```

After bulk confirm completes (including any re-prompts), proceed to Step 2.

### Step 2: Taxonomy Scan

> **Note**: If Step 1.5 (Bulk Confirm) triggered, this scan runs on the already-updated artifact. Some gaps may have been resolved by bulk confirm.

Scan for gaps, `[NEEDS CLARIFICATION]`, and `<!-- assumed: ... -->` markers. Categories by target:

- **Intake**: scope boundaries, affected areas, blocking questions, impact, memory coverage
- **Spec**: requirement precision (RFC 2119), scenario coverage (GIVEN/WHEN/THEN), edge cases, deprecated requirements, memory cross-references
- **Tasks**: completeness vs spec, granularity, dependencies, file paths, `[P]` markers

For `<!-- assumed: ... -->` markers, frame current assumption as recommended option with alternatives.

Build **prioritized question queue** (max 5). If zero gaps: "No gaps found — artifact looks solid." with Next line, stop.

### Step 3: Ask Questions One at a Time

For each question, present:
- The question text with its position in the queue (e.g., 1 of 3)
- A recommended option with brief reasoning
- Alternatives (if applicable)

Allow the user to accept the recommendation, pick an alternative, provide a free-text answer, or stop early. Use whatever interaction method is natural for your environment.

### Step 4: Process Answer and Update

1. Update artifact in place: replace markers with resolved content, add `<!-- clarified: ... -->` for significant changes
2. Reclassify resolved entry to `Certain` in `## Assumptions` table
3. Present next question or proceed to Step 5 after queue exhaustion / 5th answer / early termination

### Step 5: Audit Trail

Append `## Clarifications > ### Session {YYYY-MM-DD}` with Q&A pairs. Append to existing section if present; create if not; skip if 0 answers.

### Step 6: Coverage Summary

```
Clarification complete.

| Category | Count |
|----------|-------|
| Resolved | {N} |
| Clear | {N} |
| Deferred | {N} |
| Outstanding | {N} |

Next: {per state table — current state, since clarify is non-advancing}
```

### Step 7: Recompute Confidence

Run `fab/.kit/scripts/lib/calc-score.sh <change>` if `spec.md` exists in the change directory. Skip this step if at intake stage (no spec yet). Auto mode does not invoke this script.

### Step 8: Do NOT Advance Stage

Only update `confidence` and `last_updated` in `.status.yaml`.

---

## Auto Mode (Internal fab-ff Call)

> **Note**: Bulk confirm (Step 1.5) is Suggest Mode only. Auto Mode skips it — there is no user to confirm with.

1. **Read target artifact** (same as Suggest Step 1)
2. **Autonomous gap resolution**: Same taxonomy scan. Resolvable from context → resolve + `<!-- clarified: ... -->`. Needs user input → `<!-- blocking: ... -->`. Minor → leave as-is.
3. **Return result**: `{resolved: N, blocking: N, non_blocking: N}`. If `blocking > 0`, include `blocking_issues: [...]`.
4. **Non-advancing**: Only update `last_updated`.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Post-planning stage, no `<target-artifact>` | Prompt for artifact selection |
| Artifact file missing | "No {artifact} found. Run /fab-continue to generate it first." |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No |
| Idempotent? | Yes |
| Modifies artifact? | Yes — edits in place |
| `.status.yaml` updates | `confidence` + `last_updated` only |
