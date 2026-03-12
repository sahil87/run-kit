---
name: fab-operator2
description: "Multi-agent coordination with proactive monitoring — observe agents via pane-map, interact via send-keys, monitor progress after every action."
---

# /fab-operator2

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Multi-agent coordination layer with proactive monitoring. Runs in a dedicated tmux pane, observes all running fab agents via `fab pane-map`, and interacts with them via `fab send-keys`. Translates natural-language user instructions into cross-agent actions: broadcasting commands, sequencing rebases, spawning new worktrees, and merging PRs.

**Key difference from operator1**: After every action that dispatches work to another agent, operator2 automatically enrolls the target in a monitoring loop. Instead of fire-and-forget (send and go idle), operator2 uses `/loop` to periodically check agent progress, detect stage advances, completions, failures, pane deaths, and stuck agents — then reports transitions to the user.

Not a lifecycle enforcer — individual agents already know their pipeline. The operator handles coordination that requires cross-agent awareness.

---

## Arguments

None.

---

## Context Loading

Load the **always-load layer** from `_preamble.md` section 1 — the same 7 files every skill loads:

1. `fab/project/config.yaml` — **required**
2. `fab/project/constitution.md` — **required**
3. `fab/project/context.md` — *optional* (skip gracefully if missing)
4. `fab/project/code-quality.md` — *optional* (skip gracefully if missing)
5. `fab/project/code-review.md` — *optional* (skip gracefully if missing)
6. `docs/memory/index.md` — **required**
7. `docs/specs/index.md` — **required**

Do **not** run preflight. Do **not** load change-specific artifacts (intakes, specs, tasks). The operator's context window is reserved for coordination state, not change content.

---

## Command Logging

After context loading, log the command invocation:

```bash
fab/.kit/bin/fab log command "fab-operator2" 2>/dev/null || true
```

This is best-effort — the logger resolves the active change via the `.fab-status.yaml` symlink if one exists. Failures are silently ignored.

---

## Orientation on Start

On invocation, display the current coordination landscape:

1. **Pane map**: Run `fab/.kit/bin/fab pane-map` and display the output (shows Pane, Tab, Worktree, Change, Stage, Agent)
2. **Ready signal**: Output `Ready for coordination commands. Monitoring is active after every send.`

**Launcher**: Start the operator via `fab/.kit/scripts/fab-operator2.sh` — creates a singleton tmux tab named `operator` and invokes `/fab-operator2` in a new Claude session.

### Outside tmux

If `$TMUX` is unset, display:

```
Warning: not inside a tmux session. Pane map and send-keys unavailable. Status-only mode.
```

Then run `fab/.kit/bin/fab status show --all` for status queries only. `fab send-keys` and `fab pane-map` are unavailable. Monitoring is disabled.

---

## State Re-derivation

Before **every** action, re-query live state:

- `fab/.kit/bin/fab pane-map` — current pane-to-change mapping with stage and agent state

Never rely on stale values from conversation memory. If a pane died or a change advanced since the last check, the operator must know.

---

## Monitoring State

The operator maintains a **monitored set** in conversation context (not a persistent file). Each entry tracks:

| Field | Description |
|-------|-------------|
| Change ID | The 4-char change identifier |
| Pane | The tmux pane ID (e.g., `%3`) |
| Last-known stage | Stage at time of last observation |
| Last-known agent state | Agent column value at last observation |
| Enrolled-at | Timestamp when monitoring began |
| Last-transition-at | Timestamp of last observed state change |

### Enrollment

A change is enrolled in the monitored set when:

1. The operator sends a command to it via `fab send-keys` (UC1 broadcast, UC6 nudge, any direct send)
2. The user explicitly requests monitoring ("tell me when r3m7 finishes")
3. The operator triggers an automatic action toward it (UC2 sequenced rebase)

Read-only actions (status check, pane map refresh) do NOT enroll changes.

### Removal

A change is removed from the monitored set when:

1. It reaches a terminal stage: `hydrate`, `ship`, or `review-pr`
2. Its pane dies (no longer appears in `fab pane-map`)
3. The user explicitly says to stop monitoring it

### Loop Lifecycle

- **Start**: When the first change is enrolled and no loop is running, start `/loop 5m "check monitored agents"` (interval configurable via user instruction, e.g., "check every 2m")
- **Extend**: When a new change is enrolled and a loop is already running, no action needed — the existing loop covers all monitored changes
- **Stop**: When the monitored set becomes empty, stop the loop
- **Only one loop**: There SHALL be at most one active `/loop` at any time

---

## Monitoring Tick Behavior

On each `/loop` tick (and optionally when the user asks "any updates?"):

1. **Re-query state**: Run `fab/.kit/bin/fab pane-map`
2. **For each change in the monitored set**, compare current state to last-known state:

| Detection | Condition | Report | Action |
|-----------|-----------|--------|--------|
| Stage advance | Stage changed from last-known | "{change}: {old_stage} -> {new_stage}" | Update baseline |
| Pipeline completion | Stage is `hydrate`, `ship`, or `review-pr` | "{change}: reached {stage} -- pipeline complete" | Remove from monitored set |
| Review failure | Stage went from `review` back to `apply` | "{change}: review failed, reworking (back at apply)" | Update baseline |
| Pane death | Change no longer appears in pane map | "{change}: pane {pane} is gone -- agent exited" | Remove from monitored set |
| Stuck detection | Agent idle at non-terminal stage for > stuck threshold (default 15m) | "{change}: idle at {stage} for {duration} -- may be stuck" | Advisory only — do NOT auto-nudge |

3. **After processing all changes**: If the monitored set is now empty, stop the loop and report: "All monitored changes complete."

### Stuck Detection

The stuck threshold defaults to 15 minutes and MAY be overridden by user instruction (e.g., "flag agents stuck for more than 10 minutes"). Stuck detection is **advisory only** — the operator reports to the user but does NOT automatically send `/fab-continue` or any other command. Nudging requires explicit UC6 invocation or user instruction.

---

## Use Cases

Each use case follows the pattern: **interpret user intent** then **refresh state** then **validate preconditions** then **execute** then **report** then **enroll in monitoring** (if work was dispatched).

### UC1: Broadcast command to all idle agents

1. Refresh pane map
2. Filter for idle agents (via the Agent column in the pane map)
3. Announce: "Sending {command} to {change1} (%N), {change2} (%M)"
4. For each idle agent: `fab/.kit/bin/fab send-keys <change> "<command>"`
5. Report: "Done. {N} agents received {command}."
6. **Enroll all recipients in monitoring**

### UC2: Sequenced rebase after completion

1. Enroll the trigger change in monitoring (if not already monitored)
2. The monitoring loop detects when the trigger change reaches the target stage (e.g., hydrate)
3. When detected: send the rebase command to the target change via `fab/.kit/bin/fab send-keys`
4. Report: "{trigger} finished. Sending rebase to {target}."
5. Enroll the target change in monitoring

### UC3: Merge completed PRs

1. Refresh pane map, filter for changes at `ship` or `review-pr` stage
2. For each candidate: `fab/.kit/bin/fab status get-prs <change>` to retrieve PR URLs
3. **Confirm before executing** (destructive action): "Will merge PRs for {change1}, {change2}. Proceed?"
4. On confirmation, run `gh pr merge <url>` from the operator's own shell for each PR

### UC4: Spawn new worktree + agent from idea

1. Look up the idea via `fab/.kit/bin/fab idea show "<description>"`
2. Create a worktree: `wt create --non-interactive --worktree-name <name>`
3. Open a new tmux tab with a Claude session:
   `tmux new-window -n "fab-<id>" -c <worktree> "claude --dangerously-skip-permissions '/fab-new <description>'"`

### UC5: Status dashboard

1. Refresh pane map via `fab/.kit/bin/fab pane-map`
2. Present a concise human-readable summary with change name, tab, stage, and agent state
3. If monitoring is active, include the monitored set with enrolled-at timestamps and last-known state

### UC6: Unstick a stuck agent

1. Confirm the target agent is idle via the Agent column in the pane map
2. Announce: "Sending /fab-continue to {change} (%N)"
3. Send `/fab-continue` via `fab/.kit/bin/fab send-keys <change> "/fab-continue"`
4. Report the send
5. **Enroll the nudged agent in monitoring** to check recovery
6. If a **second nudge** is requested for the same agent, warn: "Already nudged {change} once. Manual investigation recommended." Send only if the user explicitly insists.

### UC7: Notification surface

1. When user says "tell me when {change} finishes," **enroll the change in monitoring immediately** (if not already)
2. The monitoring loop handles notification automatically — no "check on next user interaction" caveat
3. When the monitoring tick detects the change at a terminal stage: "{change} finished — now at {stage}."

### UC8: Autopilot

1. Accept a list of changes (IDs, names, or "all idle")
2. Resolve ordering via one of three strategies (user-provided, confidence-based, hybrid)
3. Confirm the full queue at start (destructive — merges PRs)
4. Delegate to the [Autopilot Behavior](#autopilot-behavior) section for execution

---

## Confirmation Model

Actions are categorized into three risk tiers:

| Risk | Examples | Behavior |
|------|----------|----------|
| Read-only | Status check, pane map | No confirmation |
| Recoverable | Send `/fab-continue`, rebase | Announce before sending |
| Destructive | Merge PR, archive, delete worktree, Autopilot (merge after each success) | Confirm before executing |

---

## Pre-Send Validation

Before sending keys to any pane via `fab send-keys`, the operator MUST:

1. **Verify pane exists**: Refresh the pane map. If the target pane is gone, report: "Pane for {change} is gone (agent exited or tab closed)." Do NOT attempt to send.
2. **Check agent is idle**: Read the Agent column from the pane map. If the agent is not idle, warn: "{change} is currently active. Sending may corrupt its work. Send anyway?" Only send if the user confirms.

---

## Bounded Retries and Escalation

Every automatic action has a bounded retry count. When the budget is exhausted, escalate to the user.

| Situation | Max retries | Escalation |
|-----------|-------------|------------|
| Stuck agent nudge | 1 | "{change} appears stuck at {stage}. Manual investigation recommended." |
| Rebase conflict | 0 (never auto-resolve) | Immediately flag to user |
| Pane death (non-autopilot) | 0 | Report: "Pane for {change} is gone." No respawn outside autopilot. |
| Send to busy agent | 0 | Warn user, require explicit confirmation before sending |

---

## Context Discipline

- **Never load change artifacts**: The operator never reads intakes, specs, or tasks. It only reads coordination state.
- **Report concisely**: Status updates should be brief.
- **Delegate diagnosis**: When an agent needs investigation, the operator MAY use `tmux capture-pane -t <pane> -p` to read recent terminal output. It SHALL NOT deeply analyze codebase work. It reports what it sees and lets the user decide.

---

## Not a Lifecycle Enforcer

The operator SHALL NOT:

- Validate stage transitions
- Enforce pipeline rules
- Manage agent lifecycle

Individual agents self-govern via their own pipeline skills. The operator handles only cross-agent coordination. If an agent is at an unexpected stage, the operator reports the stage factually and does not attempt to advance or correct it.

---

## Terminal Output Inspection

When the user asks about an agent's recent output:

```bash
tmux capture-pane -t <pane> -p
```

Present the output to the user. Do NOT attempt to load the agent's spec, tasks, or source files.

---

## Autopilot Behavior

When UC8 delegates here, the operator drives a queue of changes through the full pipeline — spawning agents, monitoring progress, merging PRs, and rebasing downstream changes.

### Monitoring via `/loop`

Autopilot uses its own `/loop` cadence (default 2m, more aggressive than the standard 5m monitoring interval). If a general monitoring loop is already running, it is replaced by the autopilot loop:

1. After confirming the queue and starting the first change, invoke `/loop 2m "check autopilot progress"`
2. Each tick: re-derive state via `fab pane-map` → check current change → advance/flag/skip as needed
3. On queue completion: report final summary and stop the loop
4. On `"pause"`: stop the loop; on `"resume"`: restart it

The user can still interject between ticks — interrupt commands (`"skip"`, `"stop after current"`) are processed immediately on the next prompt.

### Ordering Strategies

The operator resolves queue order via one of three strategies:

| Strategy | Description |
|----------|-------------|
| User-provided | Run in the exact order given by the user |
| Confidence-based | Sort by confidence score descending. Query each change via `fab/.kit/bin/fab status confidence <change>`. Highest-confidence changes merge first. |
| Hybrid | User provides ordering constraints (partial order); operator sorts unconstrained changes by confidence as tiebreaker |

### Per-Change Autopilot Loop

For each change in the resolved queue:

```
1. Spawn        -> wt create --non-interactive --reuse --worktree-name <change> <branch>
2. Open tab     -> tmux new-window -n "fab-<id>" -c <worktree> \
                   "claude --dangerously-skip-permissions '/fab-switch <change>'"
3. Gate check   -> fab/.kit/bin/fab status show <change>
                   - confidence >= gate -> fab/.kit/bin/fab send-keys <change> "/fab-ff"
                   - confidence < gate  -> flag to user with score and threshold
4. Monitor      -> poll fab/.kit/bin/fab pane-map on each tick
                   - stage reaches hydrate/ship -> change succeeded
                   - review fails after rework budget -> flag and skip
                   - agent idle >15 min at non-terminal stage -> nudge once, then flag
                   - pane dies -> flag and skip
5. Merge        -> gh pr merge from operator shell (destructive -- already confirmed)
6. Rebase next  -> fab/.kit/bin/fab send-keys <next-change> "git fetch origin main && git rebase origin/main"
                   - conflict -> flag to user, skip to next (never auto-resolve)
7. Cleanup      -> wt delete <worktree-name> (optional, after merge)
8. Progress     -> report one-line status
```

### Failure Matrix

| Failure | Action | Resume? |
|---------|--------|---------|
| Confidence below gate | Flag to user: run `/fab-fff` or skip | Wait for user input |
| Review fails (rework exhausted) | Flag, skip to next change | Yes |
| Rebase conflict | Flag, skip to next change | Yes |
| Agent pane dies | 1 respawn attempt, then flag and skip | Yes |
| Stage timeout (>30 min same stage) | Flag regardless of retry state | Yes |
| Total timeout (>2 hr per change) | Flag for review | Yes |

### Interruptibility

During autopilot, the user can interrupt at any time with these commands:

| Command | Effect |
|---------|--------|
| `"stop after current"` | Finish the active change (merge if successful), halt the queue |
| `"skip <change>"` | Remove from queue, proceed to next |
| `"pause"` | Stop sending new commands; already-running agents continue |
| `"resume"` | Pick up from where paused |

The operator SHALL acknowledge interrupts immediately, even if an action is in progress.

### Resumability

If the operator session restarts, state is reconstructable from `fab pane-map`. Merged changes appear as archived/shipped; in-progress changes show their current stage. The operator resumes from the first non-completed change in the queue.

### Progress Reporting

After each change completes (success or skip), the operator outputs a one-line status:

```
bh45: merged. 1 of 3 complete. Starting qkov.
```

When the queue is complete, the operator outputs a final summary listing each change with its outcome (merged, skipped, failed).

---

## Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Monitoring interval | 5m | "check every {N}m" or "monitor every {N}m" |
| Stuck threshold | 15m | "flag agents stuck for more than {N} minutes" |
| Autopilot tick interval | 2m | "autopilot check every {N}m" |

All settings are session-scoped — they reset when the operator session restarts.

---

## Key Properties

| Property | Value |
|----------|-------|
| Requires active change? | No |
| Runs preflight? | No |
| Read-only? | No — sends commands to other agents |
| Idempotent? | Yes — state is re-derived before every action |
| Advances stage? | No |
| Outputs `Next:` line? | No — ends with ready signal |
| Loads change artifacts? | No — coordination context only |
| Requires tmux? | Yes for pane-map, send-keys, and monitoring; status-only mode without |
| Uses `/loop`? | Yes — for proactive monitoring after every send |
