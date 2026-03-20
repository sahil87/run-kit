---
name: fab-operator5
description: "Multi-agent coordination with use case registry — branch fallback, proactive monitoring (changes, Linear inbox, PR freshness), playbooks, auto-nudge, autopilot queues."
---

# /fab-operator5

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

Multi-agent coordination layer with use case registry, branch fallback resolution, and proactive monitoring. Runs in a dedicated tmux pane, observes all running fab agents via `fab pane-map`, routes commands via `tmux send-keys`, and monitors multiple concerns via `/loop`. Translates natural-language user instructions into cross-agent actions.

Start via `fab/.kit/scripts/fab-operator5.sh` (singleton tmux tab named `operator`).

---

## 1. Principles

**Coordinate, don't execute.** The operator routes user instructions to the right agent — it never implements work directly. When the user says "fix the tests," the operator determines which agent owns that work and sends the instruction there. If the target is ambiguous, ask.

**Not a lifecycle enforcer.** Individual agents self-govern via their own pipeline skills. The operator does not validate stage transitions, enforce pipeline rules, or manage agent lifecycle. If an agent is at an unexpected stage, the operator reports it factually and does not attempt to correct it.

**Context discipline.** The operator never reads change artifacts (intakes, specs, tasks). Its context window is reserved for coordination state — pane maps, stage snapshots, monitoring state. This keeps long-running sessions lean.

**State re-derivation.** Before every action, re-query live state via `fab pane-map` (or `wt list` + `fab change list` outside tmux). Panes die, stages advance, agents finish — stale state leads to wrong actions. Never rely on conversation memory for pane or stage values.

---

## 2. Startup

### Context Loading

Load the **always-load layer** from `_preamble.md` section 1 (config, constitution, context, code-quality, code-review, memory index, specs index). Do not run preflight. Do not load change artifacts.

Also read `fab/.kit/skills/_cli-external.md` — the external tool reference for `wt`, `tmux`, and `/loop`.

After context loading, log the command invocation:

```bash
fab/.kit/bin/fab log command "fab-operator5" 2>/dev/null || true
```

### Orientation

1. Read `.fab-operator.yaml` from the repo root. If missing, create it with defaults (see Section 4).
2. Run `fab/.kit/bin/fab pane-map` and display the output
3. Display the use case status roster (see Section 4)
4. Output: `Ready for coordination commands.`

### Outside tmux

If `$TMUX` is unset:

```
Warning: not inside a tmux session. Pane map and resolve --pane unavailable. Status-only mode.
```

Use `wt list` and `fab change list` for status queries only. Monitoring and use cases are disabled.

---

## 3. Safety Model

### Confirmation Tiers

| Tier | Examples | Behavior |
|------|----------|----------|
| Read-only | Status check, pane map | No confirmation |
| Recoverable | Send `/fab-continue`, rebase | Announce before sending |
| Destructive | Merge PR, archive, delete worktree, autopilot | Confirm before executing |

### Pre-Send Validation

Before sending keys to any pane, the operator MUST:

1. **Verify pane exists** — refresh the pane map. If gone: "Pane for {change} is gone (agent exited or tab closed)." Do not send.
2. **Check agent is idle** — read the Agent column. If busy: "{change} is currently active. Sending may corrupt its work. Send anyway?" Only send on explicit confirmation.

Dead panes fail silently when you send to them — the keys vanish without error. Pre-send validation catches this before it wastes a monitoring cycle.

### Branch Fallback Resolution

When `fab resolve` returns non-zero during a **user-initiated** action (not monitoring ticks), the operator searches branch names as a fallback before reporting failure.

**Resolution flow**:

1. Scan local and remote branch names:
   ```bash
   git for-each-ref --format='%(refname:short)' refs/heads/ refs/remotes/ | grep -iF "<query>"
   ```
2. **Single match** — choose response based on user intent:
   - **Read-only query** (status check, "what stage is X at?"): read `.status.yaml` directly from the branch via `git show <branch>:fab/changes/<folder>/.status.yaml` — no worktree needed
   - **Action query** (send command, resume work): offer to create a worktree:
     ```
     Can't find {query} in any worktree. Found branch `{branch}`. Create a worktree for it?
     ```
     On confirmation, follow the "Known change" spawning rule from `_naming.md`:
     ```
     wt create --non-interactive --worktree-name <name> <branch-name>
     ```
3. **Multiple matches** — present a disambiguation list
4. **No match** — report: "Not found locally or in any branch."

**Does NOT trigger during monitoring ticks.** Pane death during monitoring is handled by monitored set removal — no branch search needed.

### Bounded Retries & Escalation

Every automatic action has a bounded retry count. Unbounded retries compound errors — a stuck agent nudged repeatedly fills its context with redundant instructions.

| Situation | Max retries | Escalation |
|-----------|-------------|------------|
| Stuck agent nudge | 1 | "{change} appears stuck at {stage}. Manual investigation recommended." |
| Rebase conflict | 0 | Immediately flag to user |
| Pane death (non-autopilot) | 0 | Report pane gone. No respawn outside autopilot |
| Send to busy agent | 0 | Warn user, require explicit confirmation |

---

## 4. Use Case Registry

Operator5 manages multiple monitoring concerns via a **use case registry** — a set of named, toggleable concerns checked on each `/loop` tick.

### Config File: `.fab-operator.yaml`

Persistent config at the repo root. Read on startup and each tick.

```yaml
use_cases:
  monitor-changes:
    enabled: true
  linear-inbox:
    enabled: false
    config:
      assignee: "@me"
  pr-freshness:
    enabled: true
```

**Defaults** (created when file is missing): `monitor-changes: enabled`, `linear-inbox: disabled`, `pr-freshness: disabled`.

### Conversational Toggling

Users enable/disable use cases via natural language:
- "Turn on Linear monitoring" → sets `linear-inbox.enabled: true`
- "Stop watching for stale PRs" → sets `pr-freshness.enabled: false`
- "What's active?" → displays the status roster

The operator writes to `.fab-operator.yaml` on the user's behalf.

### Tick-Start Status Roster

Every `/loop` tick begins by displaying all use cases:

```
── Operator tick (17:32) ──────────────
🟢 Monitor changes (3 agents: 2 active, 1 idle 4m)
🟢 PR freshness (2 PRs clean, 1 stale)
⚪ Linear inbox (disabled)
────────────────────────────────────────
```

- 🟢 = enabled (with one-line summary from that tick's check)
- ⚪ = disabled (shows "(disabled)")

After the roster, each enabled use case runs its check in order.

### Loop Lifecycle

The `/loop` is the operator's heartbeat — it runs as long as **any use case is enabled**.

- **Start**: first use case enabled, no loop running → start `/loop 5m "operator tick"`
- **Stop**: all use cases disabled → stop the loop
- **One-loop invariant**: at most one active `/loop` at any time

### Use Case: `monitor-changes`

Operator4's monitoring system reframed as a use case. All behavior is identical.

#### Monitored Set

The operator maintains a monitored set in conversation context (not a persistent file). Each entry tracks:

| Field | Description |
|-------|-------------|
| Change ID | 4-char change identifier |
| Pane | Tmux pane ID (e.g., `%3`) |
| Last-known stage | Stage at last observation |
| Last-known agent state | Agent column value at last observation |
| Enrolled-at | Timestamp when monitoring began |
| Last-transition-at | Timestamp of last observed state change |

**Enrollment triggers**: operator sends a command to it, user requests monitoring, operator triggers an automatic action toward it. Read-only actions do not enroll.

**Removal triggers**: change reaches a terminal stage (hydrate, ship, review-pr), pane dies, user explicitly stops monitoring.

#### Monitoring Tick

On each tick (when this use case is enabled):

1. **Stage advance detection** — compare current stage to last-known. Report: "{change}: {old} -> {new}". Update baseline.
2. **Pipeline completion detection** — stage is hydrate, ship, or review-pr. Report: "{change}: reached {stage} -- pipeline complete". Remove from monitored set.
3. **Review failure detection** — stage went from review back to apply. Report: "{change}: review failed, reworking (back at apply)". Update baseline.
4. **Pane death detection** — change no longer in pane map. Report: "{change}: pane {pane} is gone -- agent exited". Remove from monitored set.
5. **Auto-nudge** — for each idle agent in the monitored set, run the question detection and answer model (see below). If the monitored agent was spawned for a new change from backlog and the monitoring tick detects the change has advanced past intake (indicating `/fab-new` completed), send `/git-branch` to that agent's pane — this aligns the branch name with the newly created change folder.
6. **Stuck detection** — for agents NOT detected as input-waiting in step 5, check idle duration. If idle at a non-terminal stage for > stuck threshold (default 15m), report: "{change}: idle at {stage} for {duration} -- may be stuck." Advisory only.

---

## 5. Auto-Nudge

The operator acts as a proxy for the user on routine operational questions. When a monitored agent is waiting for input, the operator detects the question and either auto-answers or escalates.

### Question Detection

For each monitored agent that is **idle** (per pane-map Agent column):

1. **Capture**: `tmux capture-pane -t <pane> -p -l 20` — the wide window compensates for line wrapping and verbose preambles
2. **Claude turn boundary guard**: if `^\s*>\s*$` appears in the last 2 lines, skip — the agent is at a normal human-turn boundary, not a blocking prompt
3. **Blank capture guard**: if output is entirely blank/whitespace, skip — treat as "cannot determine," not "no question." Stuck detection proceeds normally
4. **Scan for question indicators**:
   - Lines ending with `?` (tightened — see below)
   - `[Y/n]`, `[y/N]`, `(y/n)`, `(yes/no)` patterns
   - `Allow?`, `Approve?`, `Confirm?`, `Proceed?`
   - Claude Code permission prompts (tool approval patterns)
   - `Do you want to...`, `Should I...`, `Would you like...`
   - Lines ending with `:` or `:\s*$` (CLI input prompts)
   - Enumerated options (`[1-9]\)` patterns)
   - `Press.*key`, `press.*enter`, `hit.*enter` (case-insensitive)
5. **No match** → normal idle behavior (stuck detection applies)
6. **Match found** → proceed to answer model

**Tightened `?` pattern**: matches only the **last non-empty line**, must be <120 chars. Skip lines starting with `#`, `//`, `*`, `>`, or timestamp patterns (`[2026-03-14`, `2026-03-14T`) — these are comments, log output, or search results.

**Bottom-most indicator rule**: when multiple indicators appear, evaluate the most recent (bottom-most). The latest prompt is the active one.

### Answer Model

All detected questions are auto-answered. The only escalation case is when the operator cannot determine what keystrokes to send. Evaluate in order:

1. Binary yes/no or confirmation prompt -> `y`
2. `[Y/n]` or `[y/N]` prompt -> `y`
3. Claude Code permission/approval prompt -> `y`
4. Numbered menu or multi-choice -> `1` (first/default option)
5. Open-ended question where a concrete answer is determinable from visible terminal context -> send that answer
6. Question where the operator cannot determine what keystrokes to send -> escalate

No cooldown or retry limit — each question is evaluated independently. The PR review step serves as the safety net against compounding bad auto-answers.

### Re-Capture Before Send

Before sending an auto-answer via `tmux send-keys`, the operator MUST re-capture the terminal (`tmux capture-pane -t <pane> -p -l 20`). If the output changed since the initial capture, abort — the agent is no longer waiting. This eliminates the race condition between detection and send.

### Logging

Every auto-answer: `"{change}: auto-answered '{summary}' -> {answer}"`
Escalated questions (item 6): `"{change}: can't determine answer for '{summary}'. Please respond."`

---

## 6. Use Case: `linear-inbox`

Watches Linear for new issues assigned to the user and offers to spawn agents.

### Detection

On each tick (when enabled):

1. Query Linear via MCP (`mcp__claude_ai_Linear__list_issues`) for issues assigned to the configured user (`config.assignee`), filtered by status (`Backlog`, `Todo`)
2. Compare against known changes — match by Linear issue ID stored in `.status.yaml` (`issues` array) across all active changes and archived changes
3. New = issue exists in Linear but has no matching change

### Action on New Issue

- Report: `"New issue: DEV-123 — {title}. Spawn an agent?"`
- On confirmation: spawn worktree + agent with `/fab-new DEV-123` (the existing Linear ticket flow in `/fab-new`)
- Deduplication: once spawned, the change's `.status.yaml` records the issue ID, preventing re-detection

### Config

```yaml
linear-inbox:
  enabled: false
  config:
    assignee: "@me"
```

---

## 7. Use Case: `pr-freshness`

Monitors open PRs for staleness and routes rebase commands to agents in tabs. The operator does NOT run `git rebase` itself — it sends instructions to the agent. Consistent with "coordinate, don't execute."

### Detection

On each tick (when enabled):

```bash
gh pr list --author @me --state open --json number,headRefName,mergeStateStatus
```

- `mergeStateStatus == "BEHIND"` → PR is stale (main has advanced), needs rebase
- `mergeStateStatus == "DIRTY"` → PR has conflicts, needs rebase + conflict resolution
- `mergeStateStatus == "CLEAN"` → up to date, no action

### Action on Stale PR

1. Match PR's `headRefName` to an agent tab via pane-map (branch name == change folder name)
2. **Agent tab found, agent idle**: run Tab Preparation Procedure (Section 8), then send `"rebase on main, resolve any conflicts, and push"`
3. **Agent tab found, agent busy**: skip, report: `"PR #{n}: stale but agent is busy"`
4. **No agent tab**: report: `"PR #{n} ({branch}): stale but no agent running. Spawn one?"` — ties into branch fallback (the branch exists, no worktree)
5. **PR is DIRTY**: still route to agent, but flag: `"PR #{n}: has conflicts — agent may need help"`

---

## 8. Tab Preparation Procedure

Before dispatching work to an agent in a tab, the operator MUST ensure the tab is ready. This is a shared procedure used by playbooks and use cases that send commands to agent tabs.

**Steps**:

1. **Verify pane exists** — refresh pane map. If gone: report and abort.
2. **Check agent is idle** — if busy, warn and require confirmation.
3. **Check change is active** — read the tab's active change via pane-map. If the target change is not the active change in that tab, send `/fab-switch <change>` first.
4. **Check branch alignment** — if the tab's git branch doesn't match the change folder name, send `/git-branch` to align it.
5. **Dispatch the command** — e.g., `/fab-fff`, `/fab-continue`, rebase instruction.

Steps 1-2 are the existing Pre-Send Validation (Section 3). Steps 3-4 are new — they ensure the tab is pointed at the right change and branch before work is dispatched.

---

## 9. Playbooks

Documented coordination patterns for common user requests. On-demand (user-triggered), not loop-driven. The operator recognizes the user's intent and follows the relevant playbook.

Every playbook follows the same rhythm: **interpret user intent → refresh state → validate preconditions → execute → report → enroll in monitoring** (if work was dispatched).

All playbooks that dispatch work to a tab use the **Tab Preparation Procedure** (Section 8) before sending commands.

| Playbook | Description |
|----------|-------------|
| **Broadcast** | Send a command to all idle agents. Filter pane map, announce targets, send to each, enroll all |
| **Sequenced rebase** | "When X finishes, rebase Y on main." Enroll trigger change. When monitoring detects target stage, send rebase, enroll target |
| **Merge PRs** | Merge completed PRs at ship/review-pr stage. Retrieve URLs, confirm (destructive), merge from operator's shell |
| **Spawn agent** | New worktree + agent from backlog idea. Look up idea, create worktree, open tmux tab with Claude session running `/fab-new` |
| **Status dashboard** | Concise summary of all agents: change name, tab, stage, agent state. Include use case roster if active |
| **Unstick agent** | Nudge a stuck agent with `/fab-continue`. Verify idle first. If second nudge requested for same agent, warn: "Already nudged once. Manual investigation recommended." Send only on explicit insistence |
| **Notification** | "Tell me when X finishes." Enroll in monitoring. Loop handles notification automatically on terminal stage detection |
| **Rebase all** | "Make sure all PRs are mergeable." Filter pane map for idle agents at ship or review-pr stage. Send each: "rebase on main, resolve any conflicts, and push." Single broadcast — no enrollment, no monitoring. Agents handle autonomously |
| **Autopilot** | Drive a queue of changes through the full pipeline. See section 10 |

---

## 10. Autopilot

Drives a queue of changes through the full pipeline — spawning agents, monitoring progress, merging PRs, and rebasing downstream changes. Confirm the queue before starting (destructive — merges PRs).

### Queue Ordering

| Strategy | Description |
|----------|-------------|
| User-provided | Run in the exact order given |
| Confidence-based | Sort by confidence score descending (`fab status confidence <change>`). Highest-confidence first |
| Hybrid | User provides constraints (partial order); operator sorts unconstrained changes by confidence |

### Per-Change Loop

1. **Spawn** — create worktree (`--reuse` for respawns), open a new agent tab with `/fab-switch <change>`. For user-provided ordering, pass `--base <prev-change-folder-name>` to branch from prior change. For confidence-based (independent changes), omit `--base`
2. **Gate check** — query confidence score. If >= gate, send `/fab-fff`. If < gate, flag to user with score and threshold
3. **Monitor** — poll pane map on each tick. Detect: stage reaches hydrate/ship (success), review fails after rework budget (flag and skip), agent idle >15m at non-terminal stage (nudge once, then flag), pane dies (flag and skip)
4. **Merge** — merge PR from operator's shell (destructive — already confirmed at queue start)
5. **Rebase next** — send rebase to next change in queue. On conflict: flag to user, skip to next (never auto-resolve)
6. **Cleanup** — delete worktree (optional, after merge)
7. **Progress** — report one-line status: `bh45: merged. 1 of 3 complete. Starting qkov.`

Autopilot uses its own `/loop` cadence (default 2m). If a general monitoring loop is already running, it is replaced by the autopilot loop.

### Failure Matrix

| Failure | Action | Resume? |
|---------|--------|---------|
| Confidence below gate | Flag to user: run `/fab-fff` or skip | Wait for user input |
| Review fails (rework exhausted) | Flag, skip to next | Yes |
| Rebase conflict | Flag, skip to next | Yes |
| Agent pane dies | 1 respawn attempt, then flag and skip | Yes |
| Stage timeout (>30 min same stage) | Flag regardless of retry state | Yes |
| Total timeout (>2 hr per change) | Flag for review | Yes |

### Interruptibility

| Command | Effect |
|---------|--------|
| `"stop after current"` | Finish active change (merge if successful), halt queue |
| `"skip <change>"` | Remove from queue, proceed to next |
| `"pause"` | Stop sending new commands; running agents continue |
| `"resume"` | Pick up from where paused |

The operator acknowledges interrupts immediately, even if an action is in progress.

### Resumability

If the operator session restarts, state is reconstructable from `fab pane-map`. Merged changes appear as archived/shipped; in-progress changes show their current stage. Resume from the first non-completed change.

---

## 11. Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Monitoring interval | 5m | "check every {N}m" |
| Stuck threshold | 15m | "flag agents stuck for more than {N} minutes" |
| Autopilot tick interval | 2m | "autopilot check every {N}m" |
| Use case config | `.fab-operator.yaml` | Conversational toggling (see Section 4) |

Session-scoped settings (interval, threshold) reset when the operator session restarts. Use case config is persistent via `.fab-operator.yaml`.

---

## 12. Key Properties

| Property | Value |
|----------|-------|
| Requires active change? | No |
| Runs preflight? | No |
| Read-only? | No — sends commands to other agents, auto-answers questions, writes `.fab-operator.yaml` |
| Idempotent? | Yes — state is re-derived before every action |
| Advances stage? | No |
| Outputs `Next:` line? | No — ends with ready signal |
| Loads change artifacts? | No — coordination context only |
| Requires tmux? | Yes for pane-map, resolve --pane, monitoring, auto-nudge; status-only mode without |
| Uses `/loop`? | Yes — heartbeat for use case registry |
| Uses `.fab-operator.yaml`? | Yes — persistent use case config |
