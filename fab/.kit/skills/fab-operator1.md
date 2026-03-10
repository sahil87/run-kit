---
name: fab-operator1
description: "Multi-agent coordination in tmux — observe agents via pane-map and status, interact via send-keys, coordinate cross-agent actions."
---

# /fab-operator1

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Multi-agent coordination layer that runs in a dedicated tmux pane. Observes all running fab agents via `fab pane-map` and `fab runtime`, and interacts with them via `fab send-keys`. Translates natural-language user instructions into cross-agent actions: broadcasting commands, sequencing rebases, spawning new worktrees, and merging PRs.

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
fab/.kit/bin/fab log command "fab-operator1" 2>/dev/null || true
```

This is best-effort — the logger resolves the active change via the `.fab-status.yaml` symlink if one exists. Failures are silently ignored.

---

## Orientation on Start

On invocation, display the current coordination landscape:

1. **Pane map**: Run `fab/.kit/bin/fab pane-map` and display the output (shows Pane, Tab, Worktree, Change, Stage, Agent)
2. **Ready signal**: Output `Ready for coordination commands.`

### Outside tmux

If `$TMUX` is unset, display:

```
Warning: not inside a tmux session. Pane map and send-keys unavailable. Status-only mode.
```

Then run `fab/.kit/bin/fab status show --all` for status queries only. `fab send-keys` and `fab pane-map` are unavailable.

---

## State Re-derivation

Before **every** action, re-query live state:

- `fab/.kit/bin/fab pane-map` — current pane-to-change mapping with stage and agent state
- `fab/.kit/bin/fab runtime is-idle <change>` — check specific agent's idle state (for pre-send validation)

Never rely on stale values from conversation memory. If a pane died or a change advanced since the last check, the operator must know.

---

## Seven Use Cases

Each use case follows the pattern: **interpret user intent** then **refresh state** then **validate preconditions** then **execute** then **report**.

### UC1: Broadcast command to all idle agents

1. Refresh pane map
2. Filter for idle agents (via `fab runtime` state in the pane map)
3. Announce: "Sending {command} to {change1} (%N), {change2} (%M)"
4. For each idle agent: `fab/.kit/bin/fab send-keys <change> "<command>"`
5. Report: "Done. {N} agents received {command}."

### UC2: Sequenced rebase after completion

1. Hold the instruction in conversation context (e.g., "when r3m7 finishes, rebase k8ds on main")
2. On the next user interaction (or when explicitly asked to check), query the trigger change's status
3. When the trigger change reaches hydrate or later, send the rebase command to the target change via `fab/.kit/bin/fab send-keys`

### UC3: Merge completed PRs

1. Identify changes with PRs via `fab/.kit/bin/fab status get-prs`
2. **Confirm before executing** (destructive action): "Will merge PRs for {change1}, {change2}. Proceed?"
3. On confirmation, run `gh pr merge` from the operator's own shell

### UC4: Spawn new worktree + agent from idea

1. Look up the idea via `idea show "<description>"`
2. Create a worktree via `wt-create --non-interactive`
3. Open a new tmux tab in that worktree
4. Send `/fab-new <description>` to the new agent via `fab/.kit/bin/fab send-keys`

### UC5: Status dashboard

1. Refresh pane map via `fab/.kit/bin/fab pane-map`
2. Present a concise human-readable summary with change name, tab, stage, and agent state

### UC6: Unstick a stuck agent

1. Confirm the target agent is idle via `fab/.kit/bin/fab runtime`
2. Announce: "Sending /fab-continue to {change} (%N)"
3. Send `/fab-continue` via `fab/.kit/bin/fab send-keys <change> "/fab-continue"`
4. Report the send
5. If a **second nudge** is requested for the same agent, warn: "Already nudged {change} once. Manual investigation recommended." Send only if the user explicitly insists.

### UC7: Notification surface

1. When user says "tell me when {change} finishes," hold the instruction in conversation context
2. On the next user interaction (or when asked "any updates?"), check the change's status
3. If the change has reached hydrate or later: "{change} finished — now at {stage}."
4. If not finished: "{change} still at {stage}."

---

## Confirmation Model

Actions are categorized into three risk tiers:

| Risk | Examples | Behavior |
|------|----------|----------|
| Read-only | Status check, pane map | No confirmation |
| Recoverable | Send `/fab-continue`, rebase | Announce before sending |
| Destructive | Merge PR, archive, delete worktree | Confirm before executing |

---

## Pre-Send Validation

Before sending keys to any pane via `fab send-keys`, the operator MUST:

1. **Verify pane exists**: Refresh the pane map. If the target pane is gone, report: "Pane for {change} is gone (agent exited or tab closed)." Do NOT attempt to send.
2. **Check agent is idle**: Run `fab/.kit/bin/fab runtime is-idle <change>` or read the Agent column from the pane map. If the agent is not idle, warn: "{change} is currently active. Sending may corrupt its work. Send anyway?" Only send if the user confirms.

---

## Bounded Retries and Escalation

Every automatic action has a bounded retry count. When the budget is exhausted, escalate to the user.

| Situation | Max retries | Escalation |
|-----------|-------------|------------|
| Stuck agent nudge | 1 | "{change} appears stuck at {stage}. Manual investigation recommended." |
| Rebase conflict | 0 (never auto-resolve) | Immediately flag to user |

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
| Requires tmux? | Yes for pane-map and send-keys; status-only mode without |
