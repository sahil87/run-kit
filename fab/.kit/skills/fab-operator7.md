---
name: fab-operator7
description: "Use when coordinating multiple fab agents across tmux panes — multi-agent monitoring, auto-answering prompts, routing commands, driving autopilot queues, and dependency-aware agent spawning."
---

# /fab-operator7

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

Multi-agent coordination layer. Runs in a dedicated tmux pane, observes agents via `fab pane-map`, routes commands via `tmux send-keys`, monitors progress via `/loop`. The loop is the heart of the operator.

Start via `fab/.kit/scripts/fab-operator7.sh` (singleton tmux tab named `operator`).

---

## 1. Principles

**Coordinate, don't execute.** The operator routes instructions to the right agent — it never implements work directly. If ambiguous, ask. Exception: operational maintenance (merge PR, archive, delete worktree) is executed directly by the operator since these are coordination-level actions, not pipeline work.

**Automate the routine.** The operator exists to take work off the user's hands. Auto-answer prompts, nudge stuck agents, rebase stale PRs, spawn agents from backlog — act on the user's behalf for routine operational decisions. The PR review stage is the safety net.

**Not a lifecycle enforcer.** Individual agents self-govern via their own pipeline skills. The operator does not validate stage transitions or enforce pipeline rules. If an agent is at an unexpected stage, report it factually.

**Context discipline.** The operator never reads change artifacts (intakes, specs, tasks). Its context window is reserved for coordination state — pane maps, stage snapshots, `.fab-operator.yaml`. This keeps long-running sessions lean.

**State re-derivation.** Before every action, re-query live state via `fab pane-map`. Panes die, stages advance, agents finish — stale state leads to wrong actions. Never rely on conversation memory for pane or stage values.

**Self-manage context.** The operator is long-lived. When context approaches capacity, run `/clear` and restart the loop. Continuity is maintained via `.fab-operator.yaml` — the monitored set and autopilot queue survive a clear. After clearing, re-read context files, re-read `.fab-operator.yaml`, and resume.

**Pipeline-first routing.** The operator MUST route all new work through `/fab-new` (to generate intake) then a pipeline command (`/fab-fff`, `/fab-ff`, or `/fab-continue`). The operator MUST NOT dispatch raw inline implementation instructions (e.g., "fix the login bug by changing line 42 in auth.ts") directly to agent panes. The operator MUST NOT send `/fab-continue` to skip intake for new work — `/fab-new` is always the entry point. Exception: operational maintenance commands (see "Coordinate, don't execute" above) are coordination-level actions and remain direct.

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
fab/.kit/bin/fab log command "fab-operator7" 2>/dev/null || true
```

### Tmux Gate

If `$TMUX` is unset, STOP:

```
Error: operator requires tmux. Start a tmux session first.
```

### Init

1. Read `.fab-operator.yaml` from the repo root. If missing, create with empty `monitored: {}`, `autopilot: null`, and `branch_map: {}`
2. Restore monitored set, autopilot queue, and branch_map from the file (supports `/clear` recovery)
3. Run `fab pane-map` and display the output
4. If any tracked items exist (monitored changes, active autopilot, or watches), start the loop: `/loop 3m "operator tick"`
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
| Cherry-pick conflict | 0 | Abort, log, escalate. Do not spawn. |

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
    depends_on: []         # change IDs to cherry-pick before spawning
    branch: 260324-r3m7-add-retry-logic  # this change's branch name
    enrolled_at: "2026-03-23T17:30:00Z"
    last_transition: "2026-03-23T17:32:00Z"
autopilot:
  queue: [ab12, cd34, ef56]
  current: cd34
  completed: [ab12]
  state: running           # running | paused | null
branch_map:                # persists branch names after changes leave monitored set
  ab12: 260324-ab12-fix-auth
  cd34: 260324-cd34-add-oauth
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

Each entry tracks: change ID, pane, last-known stage, last-known agent state, stop_stage, spawned_by (watch name or null), depends_on (change IDs to cherry-pick), branch (this change's branch name), enrolled-at, last-transition-at.

**Enrollment**: operator sends a command to a change, user requests monitoring, or operator triggers an automatic action. Read-only actions do not enroll. On enrollment, the change's branch name is also recorded in the top-level `branch_map`.

**Removal**: change reaches its stop stage (or a terminal stage if `stop_stage` is null), pane dies, user explicitly stops. The `branch_map` entry is **not** removed — it persists for downstream dependency resolution.

**Stop stage**: when `stop_stage` is set on a monitored entry, the operator treats that stage as the terminal stage for that change. On reaching it, the operator reports completion and removes the change — it does not push the agent further. Default is `null` (full pipeline: hydrate/ship/review-pr are terminal).

### Branch Map

The top-level `branch_map` persists change ID → branch name mappings. Entries are added when changes are enrolled in the monitored set. Entries persist after changes leave the monitored set (merged, archived, pane died) — this is necessary so downstream changes can still look up dependency branches for cherry-picking. Entries persist until the operator session ends or the user explicitly clears them.

### Tick Behavior

On each tick:

1. **Snapshot** — increment `tick_count`, run `fab pane-map`, read `.fab-operator.yaml`. Compute status for all tracked items: stage advances, completions, review failures, pane deaths, and watch statuses from the last persisted check (`last_checked` / `last_error` / last counts). Output the status frame:

```
── Operator ── 17:32 ── tick #47 ── 7 tracked ──

  [change]  r3m7         ▶ 🟢 apply → review
  [change]  k8ds         ▶ 🟡 review · idle 18m ⚠
  [change]  ab12           🟢 hydrate ✓
  [change]  ef56           🔴 spec · idle 32m ⚠
  [watch]   gmail-deploys  🟡 1 new · 2m ago
  [watch]   linear-bugs    🟢 2 known · 1 completed · 3m ago
  [watch]   slack-alerts   🟢 0 new · 1m ago

───────────────────────────────────────────────────────────
```

All tracked items render in a single flat list. Every row follows a consistent column layout:

| Column | Content |
|--------|---------|
| Type | `[change]` or `[watch]` — bracketed type prefix |
| ID | Change ID (4-char) or watch name |
| Autopilot | `▶` if autopilot-driven, blank otherwise |
| Health | Status emoji — universal position across all types |
| Detail | Type-specific status text |

**Header**: `N tracked` is the total count of all entries (changes + watches). No per-type counts.

**Ordering**: Changes first (sorted by enrollment time), then watches (sorted alphabetically by name).

**Change health**: 🟢 active, 🟡 idle, 🔴 stuck (>15m idle at non-terminal), ✓ complete.

**Watch health**: 🟢 healthy (last query succeeded, no new items), 🟡 has new unprocessed items, 🔴 errored (`last_error` set), ⏸ paused (`enabled: false`).

**Autopilot marker**: `▶` marks changes driven by the autopilot queue. Non-autopilot changes (manually enrolled or watch-spawned) show blank. Queue state is readable from the list — which entries have `▶`, which are complete.

**Watch timestamps**: Relative format (`{N}m ago`) matching the idle duration format: `{N}s ago` (< 60s), `{N}m ago` (60s–59m), `{N}h ago` (>= 60m). Floor division.

2. **Auto-nudge** — for each idle agent, run question detection (§5). If a newly-spawned agent advances past intake, send `/git-branch` to align the branch.
3. **Watches** — for each watch, query the source, compare against `known`, spawn on new matches (§7).
4. **Autopilot dispatch** — if an autopilot queue is active, run the next autopilot action (§6). Autopilot-driven changes are visible in the frame via `▶`.
5. **Removals** — remove completed changes (reached stop stage or terminal stage) and dead panes from the monitored set.
6. **Persist** — write updated state to `.fab-operator.yaml`
7. **Loop lifecycle** — if monitored set is empty, no autopilot, and no watches, stop the loop.

Actions (nudges, removals, autopilot progress) print as plain lines below the frame as they happen:

```
k8ds: auto-answered 'Allow Bash: npm test?' → y
Removed ab12 (complete), ef56 (pane gone)
Autopilot: cd34 in progress · next: ef56
```

### Idle Message

Between ticks, the operator displays an idle message with the current time and next-tick time:

```
Waiting for next tick. Time: 08:26 · next tick: 08:29
```

The time is HH:MM in the operator's local timezone. The next-tick time is computed by adding the current loop interval (default 3m) to the current time. This lets the user gauge staleness at a glance without scrolling to the last tick frame.

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

Read `agent.spawn_command` from `config.yaml` (loaded at startup). Default: `claude --dangerously-skip-permissions`. Use this as the command prefix when opening agent tabs.

The spawn sequence is:

1. **Create worktree** — `wt create --non-interactive --worktree-name <name> [<branch>]`
2. **Resolve dependencies** — if the change has a non-empty `depends_on` list, cherry-pick dependency content into the worktree (see below)
3. **Open agent tab** — `tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '<command>'"`
4. **Enroll in monitored set** — record pane, stage, branch, depends_on in `.fab-operator.yaml`; add branch to `branch_map`

### Dependency Resolution

Before opening the agent tab, given this change's `depends_on` list:

1. **Resolve all dependency branches** — For each change ID in `depends_on`, look up its branch:
   - First from the monitored entry's `branch` field (if the dep is still active).
   - Otherwise from `branch_map` (if the dep has left the monitored set).

   Build a mapping `dep_change_id -> dep_branch` for the entire `depends_on` set. If any dependency branch is not found in either location: log `"{change}: dependency {dep} branch not found. Escalating."`, escalate to the user, and do **not** spawn the agent.

2. **Prune redundant deps across the full set** — Using the resolved `dep_change_id -> dep_branch` mapping, remove dependencies whose branches are ancestors of other dependency branches in the same set:
   - If dep A's branch is an ancestor of dep B's branch (both listed in `depends_on`), drop A from the effective dependency set.
   - Check via: `git merge-base --is-ancestor <A-branch> <B-branch>`.

   This pruning is done *across the full set* of dependency branches before any cherry-picks, to prevent duplicate cherry-picks in chains where B's branch already carries A's content transitively.

3. **For each remaining (pruned) dependency** in the effective set, in the target worktree:

   a. **Check if already present** — run:
      ```bash
      git merge-base --is-ancestor <dep-branch> HEAD
      ```
      If the dep branch is already an ancestor of `HEAD`, skip this dependency's cherry-pick.

   b. **Cherry-pick** — if not already present, in the worktree directory:
      ```bash
      git cherry-pick --no-commit origin/main..<dep-branch> && \
      git commit -m "operator: cherry-pick <dep-change> dependency"
      ```
      This cherry-picks all commits unique to the dependency branch since it diverged from `origin/main`, stages them without individual commits, and squashes into a single operator commit.

   c. **On conflict** — abort immediately, do not spawn:
      ```bash
      git cherry-pick --abort
      ```
      Log: `"{change}: cherry-pick conflict with dependency {dep-change}. Escalating."`
      Escalate to user. Do not proceed without the dependency content. Bounded retry: 0 (§3).

**Why `origin/main` as base**: Each dependency branch carries its full transitive dependency content. When the operator spawned dep B, it cherry-picked dep A into B's worktree first. B's branch therefore contains A's commits. So `origin/main..<B-branch>` gives the complete transitive closure — no need to chase transitive deps manually. This is why only direct/leaf dependencies need cherry-picking.

### Dependency Declaration

Dependencies are declared through three conversational paths, all of which coexist:

1. **Explicit**: "cd34 depends on ab12" — operator sets `depends_on: [ab12]` on the monitored entry
2. **Autopilot queue**: "run ab12 then cd34, cd34 depends on ab12" — operator populates `depends_on` during queue setup
3. **`--base` flag**: autopilot `--base <prev-change>` implies `depends_on: [<prev-change-id>]` for the subsequent change

### Working a Change

> **Pipeline-first routing (§1):** All three work paths below MUST go through the fab pipeline. For *new* work, this means `/fab-new` followed by a pipeline command; for already-intaked changes, start from the appropriate pipeline command stage instead of repeating `/fab-new`. The operator MUST NOT send raw implementation instructions directly to agent panes. See the "Pipeline-first routing" principle in §1.

The operator accepts work in three forms:

**From existing change** (already has intake or further):
1. Create worktree (`wt create --non-interactive --worktree-name <name>`)
2. Resolve dependencies (cherry-pick `depends_on` entries — see above)
3. Spawn agent: `tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '/fab-switch <change> && /fab-proceed'"`
4. Enroll in monitored set
5. On completion: merge PR, optionally archive

`/fab-switch` activates the target change so `/fab-proceed` knows which one to run. `/fab-proceed` then handles `/git-branch` → `/fab-fff` automatically.

**From raw text** (e.g., "fix login after password reset"):
1. Create worktree (`wt create --non-interactive`)
2. Resolve dependencies (cherry-pick `depends_on` entries — see above)
3. Spawn agent: `tmux new-window -n "fab-<wt>" -c <worktree-path> "<spawn_cmd> '/fab-new <shell_escaped_description>'"` — where `<shell_escaped_description>` is the raw description text safely shell-escaped for inclusion in a single-quoted shell argument (do not insert unescaped raw text directly)
4. Enroll in monitored set
5. On completion: merge PR, optionally archive

**From backlog ID or Linear issue** (structured):
1. Look up the idea (`idea show <id>`) or resolve the Linear issue
2. Create worktree (`wt create --non-interactive --worktree-name <name>`)
3. Resolve dependencies (cherry-pick `depends_on` entries — see above)
4. Spawn agent: `tmux new-window -n "fab-<id>" -c <worktree-path> "<spawn_cmd> '/fab-new <id>'"`
5. Enroll in monitored set
6. On completion: merge PR, optionally archive

Both raw text and backlog paths use `/fab-new` to generate a proper intake with traceability. `/fab-new` captures the raw input in the intake's Origin section — the user just says "fix [description]" and the operator does the rest.

### Autopilot

User provides a queue of changes. Confirm upfront (merges PRs). Queue ordering:

| Strategy | Description |
|----------|-------------|
| User-provided | Run in the exact order given. Use `--base <prev-change-folder-name>` for sequential chaining (implies `depends_on`) |
| Confidence-based | Sort by confidence score descending. Highest-confidence first (independent changes) |
| Hybrid | User provides constraints (partial order); operator sorts unconstrained by confidence |

The operator works each change through the pipeline, applying pre-send validation (§3) before dispatching:

1. **Spawn** — create worktree (`--reuse` for respawns)
2. **Resolve dependencies** — cherry-pick `depends_on` entries into the worktree, then open agent tab and enroll
3. **Gate** — check confidence score. If below threshold, flag and wait
4. **Dispatch** — send `/fab-fff` (or appropriate command based on current stage)
5. **Monitor** — normal tick detection handles progress
6. **Merge** — on completion, merge PR from operator's shell
7. **Rebase next** — rebase next queued change onto latest `origin/main`. On conflict: flag, skip
8. **Cleanup** — optionally delete worktree after merge
9. **Report** — `"ab12: merged. 1 of 3 complete. Starting cd34."`

Autopilot-driven changes display `▶` in the status frame (§4). Queue progress is visible from the list — entries with `▶` that show ✓ are complete, the one showing 🟢/🟡 is current.

Autopilot state (queue, current, completed) persists in `.fab-operator.yaml`.

**Failures**: review exhausted → skip. Rebase conflict → skip. Cherry-pick conflict → escalate (do not skip). Pane dies → 1 respawn (`--reuse`), then skip. Stage timeout (>30m) → flag. Total timeout (>2h) → flag.

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
| Uses `.fab-operator.yaml`? | Yes — monitored set + autopilot queue + branch map persistence |
