---
name: fab-operator2
description: "Multi-agent coordination with proactive monitoring — observe agents via pane-map, interact via resolve --pane + tmux send-keys, monitor progress after every action."
---

# /fab-operator2

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Multi-agent coordination layer with proactive monitoring. Runs in a dedicated tmux pane, observes all running fab agents via `fab pane-map`, and interacts with them via `fab resolve --pane` + raw `tmux send-keys`. Translates natural-language user instructions into cross-agent actions: broadcasting commands, sequencing rebases, spawning new worktrees, and merging PRs.

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

## Available Tools

This is the authoritative mapping of intent to tool. Use the right tool for the job — do not improvise alternatives.

### Observation

| Intent | Tool | Notes |
|--------|------|-------|
| See all agents + stages + panes | `fab/.kit/bin/fab pane-map` | Primary observation tool. Requires tmux. |
| List all worktrees | `fab/.kit/bin/wt list` | Names, branches, paths. Works without tmux. |
| Check if a worktree exists | `fab/.kit/bin/wt list --path <name>` | Exit 0 = exists (prints path), exit 1 = not found. |
| Read an agent's recent terminal output | `tmux capture-pane -t <pane> -p` | For diagnosis. Do NOT deeply analyze — report what you see. |

### Pipeline Queries

| Intent | Tool | Notes |
|--------|------|-------|
| List all open changes | `fab/.kit/bin/fab change list` | Returns name:stage:state:confidence:indicative per line. |
| Get a change's confidence score | `fab/.kit/bin/fab status confidence <change>` | Use for autopilot gate checks. |
| Get a change's PR URLs | `fab/.kit/bin/fab status get-prs <change>` | For merge operations. |
| Look up a backlog idea | `fab/.kit/bin/fab idea show "<description>"` | For spawning new work. |

### Actions

| Intent | Tool | Notes |
|--------|------|-------|
| Send a command to an agent | `tmux send-keys -t "$(fab/.kit/bin/fab resolve <change> --pane)" "<text>" Enter` | Always validate pane exists + agent idle first. |
| Create a worktree | `fab/.kit/bin/wt create --non-interactive --worktree-name <name>` | Add `--reuse` for autopilot respawns. |
| Delete a worktree | `fab/.kit/bin/wt delete <name>` | Post-merge cleanup. Destructive — confirm first. |
| Open a new agent tab | `tmux new-window -n "fab-<id>" -c <worktree> "claude --dangerously-skip-permissions '<command>'"` | Spawns a new Claude session in the worktree. |
| Merge a PR | `gh pr merge <url>` | Run from operator's own shell. Destructive — confirm first. |
| Start periodic monitoring | `/loop 5m "check monitored agents"` | Interval configurable. Only one loop at a time. |

### State Re-derivation

Before **every** action, re-query live state via `fab pane-map` (or `wt list` + `fab change list` if outside tmux). Never rely on stale values from conversation memory. If a pane died or a change advanced since the last check, the operator must know.

---

## Orientation on Start

On invocation, display the current coordination landscape:

1. **Pane map**: Run `fab/.kit/bin/fab pane-map` and display the output
2. **Ready signal**: Output `Ready for coordination commands. Monitoring is active after every send.`

**Launcher**: Start the operator via `fab/.kit/scripts/fab-operator2.sh` — creates a singleton tmux tab named `operator` and invokes `/fab-operator2` in a new Claude session.

### Outside tmux

If `$TMUX` is unset, display:

```
Warning: not inside a tmux session. Pane map and resolve --pane unavailable. Status-only mode.
```

Use `wt list` (worktree overview) and `fab change list` (pipeline state) for status queries only. Monitoring is disabled.

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

1. The operator sends a command to it via `resolve --pane` + `tmux send-keys` (broadcast, nudge, any direct send)
2. The user explicitly requests monitoring ("tell me when r3m7 finishes")
3. The operator triggers an automatic action toward it (sequenced rebase)

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

## Modes of Operation

Every mode follows the same rhythm: **interpret user intent → refresh state → validate preconditions → execute → report → enroll in monitoring** (if work was dispatched). Refer to the [Available Tools](#available-tools) section for which tool satisfies each intent.

### Broadcast

Send a command to all idle agents. Filter the pane map for idle agents, announce the targets, send the command to each, and enroll all recipients in monitoring.

### Sequenced Rebase

"When X finishes, rebase Y on main." Enroll the trigger change in monitoring. When the monitoring loop detects it reaches the target stage, send the rebase to the target change and enroll it in monitoring.

### Merge PRs

Merge completed PRs for changes at `ship` or `review-pr` stage. Retrieve PR URLs, confirm before executing (destructive), then merge from the operator's own shell.

### Spawn Agent

Start a new worktree + agent from a backlog idea. Look up the idea, create a worktree, open a new tmux tab with a Claude session running `/fab-new`.

### Status Dashboard

Present a concise summary of all agents: change name, tab, stage, agent state. If monitoring is active, include the monitored set with enrolled-at timestamps.

### Unstick Agent

Nudge a stuck agent with `/fab-continue`. Verify the agent is idle first. Enroll in monitoring to check recovery. If a second nudge is requested for the same agent, warn: "Already nudged once. Manual investigation recommended." Send only if the user explicitly insists.

### Notification

"Tell me when X finishes." Enroll the change in monitoring immediately. The monitoring loop handles notification automatically — when a terminal stage is detected: "{change} finished — now at {stage}."

### Autopilot

Drive a queue of changes through the full pipeline. Accept a list, resolve ordering, confirm the queue (destructive — merges PRs), then delegate to the [Autopilot Behavior](#autopilot-behavior) section.

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

Before sending keys to any pane via `fab resolve --pane` + `tmux send-keys`, the operator MUST:

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

1. **Spawn** — Create worktree (with `--reuse` for respawns), open a new agent tab with `/fab-switch <change>`. For user-provided ordering, pass `--base <previous-change-folder-name>` to branch from the prior change: `wt create --non-interactive --reuse --worktree-name <name> <branch> --base <prev-change-folder-name>`. For confidence-based ordering (independent changes), omit `--base`.
2. **Gate check** — Query confidence score. If >= gate, send `/fab-ff`. If < gate, flag to user with score and threshold.
3. **Monitor** — Poll pane map on each tick. Detect: stage reaches hydrate/ship (success), review fails after rework budget (flag and skip), agent idle >15 min at non-terminal stage (nudge once, then flag), pane dies (flag and skip).
4. **Merge** — Merge PR from operator's shell (destructive — already confirmed at queue start)
5. **Rebase next** — Send rebase to the next change in queue. On conflict: flag to user, skip to next (never auto-resolve).
6. **Cleanup** — Delete worktree (optional, after merge)
7. **Progress** — Report one-line status

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
| Requires tmux? | Yes for pane-map, resolve --pane, and monitoring; status-only mode without |
| Uses `/loop`? | Yes — for proactive monitoring after every send |
