---
name: fab-operator6
description: "Use when coordinating multiple fab agents across tmux panes — multi-agent monitoring, auto-answering prompts, routing commands, and driving autopilot queues."
---

# /fab-operator6

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

Multi-agent coordination layer. Runs in a dedicated tmux pane, observes agents via `fab pane-map`, routes commands via `tmux send-keys`, monitors progress via `/loop`. The loop is the heart of the operator.

Start via `fab/.kit/scripts/fab-operator6.sh` (singleton tmux tab named `operator`).

---

## 1. Principles

**Coordinate, don't execute.** The operator routes instructions to the right agent — it never implements work directly. If ambiguous, ask. Exception: operational maintenance (merge PR, archive, delete worktree) is executed directly by the operator since these are coordination-level actions, not pipeline work.

**Automate the routine.** The operator exists to take work off the user's hands. Auto-answer prompts, nudge stuck agents, rebase stale PRs, spawn agents from backlog — act on the user's behalf for routine operational decisions. The PR review stage is the safety net.

**Not a lifecycle enforcer.** Individual agents self-govern via their own pipeline skills. The operator does not validate stage transitions or enforce pipeline rules. If an agent is at an unexpected stage, report it factually.

**Context discipline.** The operator never reads change artifacts (intakes, specs, tasks). Its context window is reserved for coordination state — pane maps, stage snapshots, `.fab-operator.yaml`. This keeps long-running sessions lean.

**State re-derivation.** Before every action, re-query live state via `fab pane-map`. Panes die, stages advance, agents finish — stale state leads to wrong actions. Never rely on conversation memory for pane or stage values.

**Self-manage context.** The operator is long-lived. When context approaches capacity, run `/clear` and restart the loop. Continuity is maintained via `.fab-operator.yaml` — the monitored set and autopilot queue survive a clear. After clearing, re-read context files, re-read `.fab-operator.yaml`, and resume.

---

## 2. Startup

### Context Loading

Load the **always-load layer** from `_preamble.md` §1 (config, constitution, context, code-quality, code-review, memory index, specs index). Do not run preflight. Do not load change artifacts.

Also read:
- `fab/.kit/skills/_cli-fab.md` — fab command reference
- `fab/.kit/skills/_cli-external.md` — wt, idea, tmux, /loop reference
- `fab/.kit/skills/_naming.md` — naming conventions

The operator needs full command vocabulary to make routing decisions (e.g., knowing a change needs `/fab-new` → `/fab-switch` → `/git-branch` → `/fab-fff`).

After context loading, log the command invocation:

```bash
fab/.kit/bin/fab log command "fab-operator6" 2>/dev/null || true
```

### Tmux Gate

If `$TMUX` is unset, STOP:

```
Error: operator requires tmux. Start a tmux session first.
```

### Init

1. Read `.fab-operator.yaml` from the repo root. If missing, create with empty `monitored: {}` and `autopilot: null`
2. Restore monitored set and autopilot queue from the file (supports `/clear` recovery)
3. Run `fab pane-map` and display the output
4. If monitored set is non-empty, autopilot is active, or watches exist, start the loop: `/loop 3m "operator tick"`
5. Output: `Operator ready.` (+ `Loop active (3m).` if loop started)

---

## 3. Safety

### Confirmation Tiers

| Tier | Examples | Behavior |
|------|----------|----------|
| Read-only | Status check, pane map | No confirmation |
| Recoverable | Send `/fab-continue`, rebase | Announce before sending |
| Destructive | Merge PR, archive, delete worktree | Confirm before executing |

### Pre-Send Validation

Before sending keys to any pane:

1. **Verify pane exists** — refresh pane map. If gone: "Pane for {change} is gone." Do not send.
2. **Check agent is idle** — if busy: "{change} is active. Sending may corrupt its work. Send anyway?" Only on explicit confirmation.
3. **Check change is active** — if the target change isn't the active change in that tab, send `/fab-switch <change>` first.
4. **Check branch alignment** — if the tab's git branch doesn't match the change folder name, send `/git-branch` to align it.

### Branch Fallback

When `fab resolve` fails during a **user-initiated** action (not monitoring ticks):

1. Scan branches: `git for-each-ref --format='%(refname:short)' refs/heads/ refs/remotes/ | grep -iF "<query>"`
2. **Single match, read-only**: read `.status.yaml` via `git show <branch>:fab/changes/<folder>/.status.yaml`
3. **Single match, action**: create a worktree and proceed (`wt create --non-interactive --worktree-name <name> <branch>`)
4. **Multiple matches**: disambiguate. **No match**: report not found.

### Bounded Retries

| Situation | Max retries | Escalation |
|-----------|-------------|------------|
| Stuck agent nudge | 1 | "{change} appears stuck at {stage}. Manual investigation recommended." |
| Rebase conflict | 0 | Immediately flag to user |
| Pane death | 0 | Report gone. Respawn only in autopilot (1 attempt) |
| Send to busy agent | 0 | Warn, require explicit confirmation |

---

## 4. The Loop

The loop is the operator's heartbeat — a `/loop 3m "operator tick"` that runs as long as the monitored set is non-empty, an autopilot queue is active, or any watch is configured. When all three are empty, stop the loop. The loop starts when the first change is enrolled, an autopilot queue begins, or a watch is created. A user prompt can also restart it.

### `.fab-operator.yaml`

Persistent state at the repo root. Read on startup and every tick. Written after every state change.

```yaml
tick_count: 47
monitored:
  r3m7:
    pane: "%3"
    stage: apply
    agent: active
    stop_stage: null       # null = full pipeline, or a stage name to park at
    spawned_by: null       # watch name if spawned by a watch, null otherwise
    enrolled_at: "2026-03-23T17:30:00Z"
    last_transition: "2026-03-23T17:32:00Z"
autopilot:
  queue: [ab12, cd34, ef56]
  current: cd34
  completed: [ab12]
  state: running           # running | paused | null
watches:
  linear-bugs:
    enabled: true
    source: linear
    query: { project: "DEV", status: [Backlog, Todo], assignee: "@me" }
    stop_stage: intake
    known: [DEV-988, DEV-992]  # capped at 200, oldest pruned first
    completed: [DEV-985]       # items that reached stop_stage
    last_checked: "2026-03-23T17:29:00Z"
    last_error: null
    instructions: >
      Spawn agents for issues older than 1 hour with label 'bug'.
      Max 2 concurrent agents from this watch.
```

### Monitored Set

Each entry tracks: change ID, pane, last-known stage, last-known agent state, stop_stage, spawned_by (watch name or null), enrolled-at, last-transition-at.

**Enrollment**: operator sends a command to a change, user requests monitoring, or operator triggers an automatic action. Read-only actions do not enroll.

**Removal**: change reaches its stop stage (or a terminal stage if `stop_stage` is null), pane dies, user explicitly stops.

**Stop stage**: when `stop_stage` is set on a monitored entry, the operator treats that stage as the terminal stage for that change. On reaching it, the operator reports completion and removes the change — it does not push the agent further. Default is `null` (full pipeline: hydrate/ship/review-pr are terminal).

### Tick Behavior

On each tick:

1. **Snapshot** — increment `tick_count`, run `fab pane-map`, read `.fab-operator.yaml`. Compute status for each monitored change: stage advances, completions, review failures, pane deaths. Output the status frame:

```
── Operator ── 17:32 ── tick #47 ── 3 monitored · autopilot 1/3 · 1 watch ──

  r3m7  🟢 apply → review
  k8ds  🟡 review · idle 18m ⚠
  ab12  🟢 hydrate ✓

  👁 linear-bugs  2 known · 1 completed · last check 17:29

───────────────────────────────────────────────────────────
```

Stage indicators: 🟢 active, 🟡 idle, 🔴 stuck (>15m idle at non-terminal), ✓ complete. Watch indicator: 👁.

2. **Auto-nudge** — for each idle agent, run question detection (§5). If a newly-spawned agent advances past intake, send `/git-branch` to align the branch.
3. **Watches** — for each watch, query the source, compare against `known`, spawn on new matches (§7).
4. **Autopilot step** — if an autopilot queue is active, run the next autopilot action (§6).
5. **Removals** — remove completed changes (reached stop stage or terminal stage) and dead panes from the monitored set.
6. **Persist** — write updated state to `.fab-operator.yaml`
7. **Loop lifecycle** — if monitored set is empty, no autopilot, and no watches, stop the loop.

Actions (nudges, removals, autopilot progress) print as plain lines below the frame as they happen:

```
k8ds: auto-answered 'Allow Bash: npm test?' → y
Removed ab12 (complete), ef56 (pane gone)
Autopilot: cd34 in progress · next: ef56
```

---

## 5. Auto-Nudge

The operator auto-answers routine prompts from monitored agents. Each idle agent is checked every tick.

### Question Detection

1. **Capture**: `tmux capture-pane -t <pane> -p -l 20`
2. **Claude turn boundary guard**: `^\s*>\s*$` in last 2 lines → skip (normal human-turn boundary)
3. **Blank capture guard**: all blank → skip (treat as "cannot determine")
4. **Scan for indicators** (bottom-most match wins):
   - Lines ending with `?` (last non-empty line only, <120 chars, skip `#`/`//`/`*`/`>`/timestamp lines)
   - `[Y/n]`, `[y/N]`, `(y/n)`, `(yes/no)`
   - `Allow?`, `Approve?`, `Confirm?`, `Proceed?`
   - Claude Code permission/tool approval prompts
   - `Do you want to...`, `Should I...`, `Would you like...`
   - Lines ending with `:` (CLI input prompts)
   - Enumerated options (`[1-9]\)`)
   - `Press.*key`, `press.*enter`, `hit.*enter` (case-insensitive)
5. **No match** → stuck detection applies
6. **Match** → answer model

### Answer Model

Evaluate in order:

1. Binary yes/no or confirmation → `y`
2. `[Y/n]` or `[y/N]` → `y`
3. Claude Code permission prompt → `y`
4. Numbered menu → `1` (first/default)
5. Open-ended, answer determinable from visible context → send that answer
6. Cannot determine keystrokes → escalate to user

### Sending Auto-Answers

Before `tmux send-keys`: verify pane exists and agent is still idle (§3 steps 1-2), then re-capture the terminal. If output changed since detection, abort — agent is no longer waiting.

### Logging

- Auto-answer: `"{change}: auto-answered '{summary}' → {answer}"`
- Escalation: `"{change}: can't determine answer for '{summary}'. Please respond."`

---

## 6. Coordination Patterns

The operator understands the full fab pipeline and command vocabulary. It infers the right action from current state rather than following named playbooks.

### Pipeline Reference

```
intake → spec → tasks → apply → review → hydrate → ship
```

**Setup commands**: `/fab-new` (create change), `/fab-switch` (activate), `/git-branch` (align branch)

**Pipeline commands**: `/fab-proceed` (auto-detect state, run `/fab-new` → `/fab-switch` → `/git-branch` as needed, then `/fab-fff`), `/fab-continue` (one stage), `/fab-fff` (full pipeline), `/fab-ff` (fast-forward to hydrate), `/git-pr` (commit, push, create PR)

**Maintenance**: rebase onto `origin/main`, merge PR (`gh pr merge`), `/fab-archive`

### Spawning an Agent

Read `agent.spawn_command` from `config.yaml` (loaded at startup). Default: `claude --dangerously-skip-permissions`. Use this as the command prefix when opening agent tabs:

```bash
tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '<command>'"
```

### Working a Change

The operator accepts work in three forms:

**From existing change** (already has intake or further):
1. Create worktree (`wt create --non-interactive --worktree-name <name>`)
2. Resolve dependencies (cherry-pick `depends_on` entries — see above)
3. Spawn agent: `tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '/fab-switch <change> && /fab-proceed'"`
4. Enroll in monitored set
5. On completion: merge PR, optionally archive

`/fab-switch` activates the target change so `/fab-proceed` knows which one to run. `/fab-proceed` then handles `/git-branch` → `/fab-fff` automatically.

**From raw text** (e.g., "fix login after password reset"):
1. Create backlog entry: `idea add "<description>"` — captures the ID
2. Proceed with the backlog flow below using the new ID

**From backlog ID or Linear issue** (structured):
1. Look up the idea (`idea show <id>`) or resolve the Linear issue
2. Create worktree (`wt create --non-interactive --worktree-name <name>`)
3. Spawn agent: `tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '/fab-new <id>'"`
4. Agent runs `/fab-new <id>` → `/fab-switch` → `/git-branch` → `/fab-fff`
5. Enroll in monitored set
6. On completion: merge PR, optionally archive

Both raw text and backlog paths use `/fab-new` to generate a proper intake with traceability.

### Autopilot

User provides a queue of changes. Confirm upfront (merges PRs). Queue ordering:

| Strategy | Description |
|----------|-------------|
| User-provided | Run in the exact order given. Use `--base <prev-change-folder-name>` for sequential chaining |
| Confidence-based | Sort by confidence score descending. Highest-confidence first (independent changes) |
| Hybrid | User provides constraints (partial order); operator sorts unconstrained by confidence |

The operator works each change through the pipeline, applying pre-send validation (§3) before dispatching:

1. **Spawn** — create worktree (`--reuse` for respawns), open agent tab
2. **Gate** — check confidence score. If below threshold, flag and wait
3. **Dispatch** — send `/fab-fff` (or appropriate command based on current stage)
4. **Monitor** — normal tick detection handles progress
5. **Merge** — on completion, merge PR from operator's shell
6. **Rebase next** — rebase next queued change onto latest `origin/main`. On conflict: flag, skip
7. **Cleanup** — optionally delete worktree after merge
8. **Report** — `"ab12: merged. 1 of 3 complete. Starting cd34."`

Autopilot state (queue, current, completed) persists in `.fab-operator.yaml`.

**Failures**: review exhausted → skip. Rebase conflict → skip. Pane dies → 1 respawn (`--reuse`), then skip. Stage timeout (>30m) → flag. Total timeout (>2h) → flag.

**Interrupts**: "stop after current", "skip <change>", "pause", "resume" — acknowledged immediately.

---

## 7. Watches

Watches are standing instructions to monitor an external source and take action when new items appear. Users create watches conversationally: "watch Linear project DEV for new issues, spawn agents, stop at intake."

### Schema

Each watch in `.fab-operator.yaml` has:

| Field | Description |
|-------|-------------|
| `enabled` | `true` or `false` — paused watches retain config but skip tick evaluation |
| `source` | `linear` or `slack` — determines which MCP tool to query |
| `query` | Source-specific API filter (project, status, assignee, channel) — passed to MCP |
| `stop_stage` | How far to go: `intake`, `spec`, `hydrate`, or `null` (full pipeline) |
| `known` | Already-handled item IDs — managed automatically, capped at 200 (oldest pruned first) |
| `completed` | Items that reached `stop_stage` — lets users query "what did this watch produce?" |
| `last_checked` | ISO timestamp of last successful query |
| `last_error` | Last error message, or `null`. Shown in status frame when set |
| `instructions` | Free-form natural language — trigger conditions, concurrency limits, label filters, anything else |

Structured fields handle machine-readable concerns; `instructions` handles everything the operator evaluates as an LLM. Concurrency limits in `instructions` are enforced by counting monitored entries where `spawned_by` matches the watch name.

### Tick Behavior

On each tick (step 3), for each enabled watch:

1. **Query source** — Linear via MCP (`mcp__claude_ai_Linear__list_issues`), Slack via MCP (`mcp__claude_ai_Slack__slack_read_channel`), using `query` as the API filter. On failure: set `last_error`, skip this watch for this tick. After 3 consecutive failures: disable the watch, alert user.
2. **Deduplicate** — skip items in `known` list. Update `last_checked`.
3. **Evaluate instructions** — apply trigger conditions, label filters, concurrency limits (count monitored entries with `spawned_by: <watch-name>`), and any other criteria from `instructions`
4. **Act** — for each item that passes:
   - Spawn worktree, open agent tab, send appropriate command (e.g., `/fab-new DEV-123`)
   - Enroll in monitored set with `stop_stage` and `spawned_by` from the watch
   - Add item ID to `known` (only after successful spawn)
   - Prune `known` if over 200 entries (drop oldest)
5. **Report** — `"Watch linear-bugs: DEV-1024 — Fix auth redirect (72m old). Spawning."`

When a watch-spawned agent reaches its `stop_stage`, move the item ID from `known` to `completed` and report: `"Watch linear-bugs: DEV-1024 completed intake."`

### Conversational Management

- "Watch Linear project DEV for bugs older than 1 hour, spawn agents, stop at intake" → creates watch
- "Pause the Linear watch" / "Resume the Linear watch" → toggles `enabled`
- "Stop watching Linear" → removes watch
- "What are you watching?" → lists active watches with instructions and completed items
- "What did linear-bugs produce?" → lists `completed` items
- "Test watch linear-bugs" → dry-run: query, deduplicate, evaluate instructions, report what *would* happen without spawning or updating state
- "Change the Linear watch to go through full pipeline" → updates `stop_stage` to null
- "Also limit to 2 concurrent agents" → appends to `instructions`

---

## 8. Configuration

| Setting | Default | Override via natural language |
|---------|---------|------------------------------|
| Loop interval | 3m | "check every {N}m" |
| Stuck threshold | 15m | "flag agents stuck for more than {N}m" |

Session-scoped — resets on `/clear` or session restart.

---

## 9. Key Properties

| Property | Value |
|----------|-------|
| Requires active change? | No |
| Runs preflight? | No |
| Read-only? | No — sends commands, auto-answers, writes `.fab-operator.yaml` |
| Idempotent? | Yes — state re-derived every tick |
| Advances stage? | No |
| Outputs `Next:` line? | No — ends with ready signal |
| Loads change artifacts? | No — coordination context only |
| Requires tmux? | Yes — hard stop without it |
| Uses `/loop`? | Yes — 3m heartbeat |
| Uses `.fab-operator.yaml`? | Yes — monitored set + autopilot queue persistence |
