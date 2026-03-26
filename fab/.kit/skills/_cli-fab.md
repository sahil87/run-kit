---
name: _scripts
description: "Kit script invocation guide — calling conventions for the fab dispatcher and Go backend."
user-invocable: false
disable-model-invocation: true
metadata:
  internal: true
---
# Kit Script Invocation Guide

> Loaded by every skill via `_preamble.md`. Defines calling conventions for all kit operations.

---

## Calling Convention

`fab/.kit/bin/fab` is a shell dispatcher that serves as the sole entry point for all fab CLI operations. It delegates to the Go backend (`fab-go`). All commands are implemented in the Go binary via Cobra.

```
fab/.kit/bin/fab <command> <subcommand> [args...]
```

### Backend

1. `fab/.kit/bin/fab-go` — if present and executable, all commands delegate here
2. Error — exits 1 with message directing user to install the backend

### Help

`fab -h`, `fab --help`, and `fab <subcommand> --help` work via Cobra's built-in help system.

### Command Reference

| Command | Purpose |
|---------|---------|
| `fab resolve` | Change reference resolution |
| `fab status` | Stage state machine + metadata |
| `fab log` | Append-only history logging |
| `fab preflight` | Validation + structured YAML output |
| `fab change` | Change lifecycle (new, rename, switch, list, archive, restore, archive-list) |
| `fab score` | Confidence scoring |
| `fab runtime` | Runtime state management (.fab-runtime.yaml) |
| `fab hook` | Claude Code hook subcommands (session-start, stop, user-prompt, artifact-write, sync) |
| `fab pane-map` | Tmux pane-to-worktree mapping with pipeline state (all panes) |

---

## `<change>` Argument Convention

All commands accept a unified `<change>` argument:

| Form | Example |
|------|---------|
| 4-char change ID | `yobi` |
| Folder name substring | `fix-kit` |
| Full folder name | `260227-yobi-fix-kit-scripts` |

**Not accepted**: bare directory paths or `.status.yaml` paths — use the folder name or change ID instead.

---

# Change Lifecycle

## fab change

Change Manager — manages change folders, naming, and the `.fab-status.yaml` symlink.

```
fab/.kit/bin/fab change <subcommand> [flags...]
```

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `new` | `new --slug <slug> [--change-id <4char>] [--log-args <desc>]` | Create new change |
| `rename` | `rename --folder <current-folder> --slug <new-slug>` | Rename change slug |
| `resolve` | `resolve [<override>]` | Passthrough to resolve --folder |
| `switch` | `switch <name> \| --none` | Switch active change |
| `list` | `list [--archive]` | List changes with stage info |
| `archive` | `archive <change> --description "..."` | Clean .pr-done, move to archive/, update index, clear pointer |
| `restore` | `restore <change> [--switch]` | Move from archive/, remove index entry, optionally activate |
| `archive-list` | `archive-list` | List archived folder names (one per line) |

**Resolution**: archive resolves `<change>` via standard resolution (active changes). `restore` uses internal archive-folder resolution. Both support 4-char ID, substring, and full folder name.

**Output**: Both archive and restore output structured YAML to stdout. Skills parse this YAML to construct user-facing reports.

---

# Pipeline & Status

## fab status

Status Manager — manages workflow stages, states, and `.status.yaml`.

```
fab/.kit/bin/fab status <subcommand> <change> [args...]
```

### Key subcommands

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `finish` | `finish <change> <stage> [driver]` | Mark stage done, auto-activate next. Review stage auto-logs "passed" |
| `start` | `start <change> <stage> [driver] [from] [reason]` | pending/failed → active |
| `advance` | `advance <change> <stage> [driver]` | active → ready |
| `reset` | `reset <change> <stage> [driver] [from] [reason]` | done/ready/skipped → active (cascades downstream to pending) |
| `skip` | `skip <change> <stage> [driver]` | {pending,active} → skipped (cascades downstream pending to skipped) |
| `fail` | `fail <change> <stage> [driver] [rework]` | active → failed (review only). Review stage auto-logs "failed" |
| `set-change-type` | `set-change-type <change> <type>` | Set change type |
| `set-checklist` | `set-checklist <change> <field> <value>` | Update checklist field |
| `set-confidence` | `set-confidence <change> <counts...> <score> [--indicative]` | Set confidence block (with optional indicative flag) |
| `set-confidence-fuzzy` | `set-confidence-fuzzy <change> <counts...> <score> <dims...> [--indicative]` | Set confidence with dimensions (with optional indicative flag) |
| `add-issue` | `add-issue <change> <id>` | Append issue ID to issues array (idempotent) |
| `get-issues` | `get-issues <change>` | List issue IDs (one per line) |
| `add-pr` | `add-pr <change> <url>` | Append PR URL to prs array (idempotent) |
| `get-prs` | `get-prs <change>` | List PR URLs (one per line) |
| `progress-line` | `progress-line <change>` | Single-line visual progress |
| `current-stage` | `current-stage <change>` | Detect active stage |

### Stage transition side effects

Each `finish` auto-activates the next pending stage. No separate `start` call needed:

```
finish intake  → spec becomes active
finish spec    → tasks becomes active
finish tasks   → apply becomes active
finish apply   → review becomes active
finish review  → hydrate becomes active (+ auto-logs review "passed")
finish hydrate → pipeline complete
```

**Common mistake**: calling `start <stage>` after `finish <previous-stage>` — this is redundant because `finish` already activated it.

### Auto-logging

- `finish <change> review [driver]` → auto-logs review "passed"
- `fail <change> review [driver] [rework]` → auto-logs review "failed"
- Any event that sets a stage to `active` → auto-logs transition (best-effort)

Skills do NOT need to call `fab log review` or `fab log transition` manually — it's handled by `fab status` internally.

---

## fab score

Confidence scorer — computes SRAD confidence score from Assumptions tables.

```
fab/.kit/bin/fab score [--check-gate] [--stage <stage>] <change>
```

| Mode | Usage | Behavior |
|------|-------|----------|
| Normal | `fab/.kit/bin/fab score <change>` | Parse spec.md, compute score, write to .status.yaml |
| Intake scoring | `fab/.kit/bin/fab score --stage intake <change>` | Parse intake.md, compute score, write to .status.yaml |
| Gate check | `fab/.kit/bin/fab score --check-gate <change>` | Parse artifact, compute score, compare threshold. Read-only |
| Intake gate | `fab/.kit/bin/fab score --check-gate --stage intake <change>` | Intake gate with fixed threshold 3.0 |

---

## fab preflight

Pre-flight validator — validates project state and outputs structured YAML. Purely validation + structured output — no logging side-effects.

```
fab/.kit/bin/fab preflight [<change-name>]
```

- `<change-name>`: Optional change override (resolved via change resolution).

Validates: config.yaml exists, constitution.md exists, active change resolved, `.status.yaml` exists. Outputs YAML with `name`, `change_dir`, `stage`, `progress`, `checklist`, `confidence` fields. Non-zero exit on failure with error message on stderr.

---

# Plumbing

## fab resolve

Change Resolver — pure query, no side effects. Converts any change reference to a canonical output.

```
fab/.kit/bin/fab resolve [--id|--folder|--dir|--status|--pane] [<change>]
```

| Flag | Output |
|------|--------|
| `--id` (default) | 4-char change ID (e.g., `9fg2`) |
| `--folder` | Full folder name (e.g., `260228-9fg2-refactor-kit-scripts`) |
| `--dir` | Directory path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/`) |
| `--status` | `.status.yaml` path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/.status.yaml`) |
| `--pane` | Tmux pane ID (e.g., `%5`). Requires `$TMUX`. Errors if no pane matches the change |

---

## fab log

History Logger — append-only JSON logging to `.history.jsonl`. Skills call `fab log command` directly for command invocation logging.

```
fab/.kit/bin/fab log command <cmd> [change] [args]
fab/.kit/bin/fab log confidence <change> <score> <delta> <trigger>
fab/.kit/bin/fab log review <change> <result> [rework]
fab/.kit/bin/fab log transition <change> <stage> <action> [from] [reason] [driver]
```

The `command` subcommand accepts `<cmd>` (skill name) as the first argument. `[change]` is optional — when omitted, it resolves the active change via `.fab-status.yaml`. If resolution fails (no `.fab-status.yaml` symlink, dangling symlink), exits 0 silently. When `[change]` IS provided and doesn't resolve, exits 1 with an error.

**Callers**:

| Caller | Trigger | Call |
|--------|---------|------|
| Skills (via `_preamble.md` §2) | Skill invocation (preflight-calling skills) | `fab/.kit/bin/fab log command "<skill>" "<change>"` |
| Skills (per-skill instructions) | Skill invocation (exempt skills) | `fab/.kit/bin/fab log command "<skill>"` |
| `fab status finish review` | Review pass | auto-logs review "passed" |
| `fab status fail review` | Review fail | auto-logs review "failed" |
| `fab score` | Score computation | auto-logs confidence |
| `fab change new` | Change creation | auto-logs command |
| `fab change rename` | Change rename | auto-logs command |

---

## fab runtime

Runtime State Manager — manages `.fab-runtime.yaml` at the repo root. Used by hooks to track agent idle state per change.

```
fab/.kit/bin/fab runtime <subcommand> <change>
```

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `set-idle` | `set-idle <change>` | Write `agent.idle_since` Unix timestamp for the resolved change |
| `clear-idle` | `clear-idle <change>` | Delete the `agent` block for the resolved change (no-op if file missing) |
| `is-idle` | `is-idle <change>` | Check agent idle state. Outputs `idle {duration}`, `active`, or `unknown`. Always exits 0 |

All subcommands accept the standard `<change>` argument (4-char ID, substring, or full folder name). The runtime file is `.fab-runtime.yaml` at the repo root, keyed by the change's full folder name.

---

## fab hook

Claude Code Hook Manager — implements hook logic in Go for Claude Code lifecycle events. Each subcommand is invoked by thin shell wrappers in `fab/.kit/hooks/`. All hook subcommands MUST exit 0 always — errors are silently swallowed to never block the agent.

```
fab/.kit/bin/fab hook <subcommand>
```

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `session-start` | `hook session-start` | Clear agent idle state for the active change. Fires on `SessionStart` |
| `stop` | `hook stop` | Write `agent.idle_since` Unix timestamp for the active change. Fires on `Stop` |
| `user-prompt` | `hook user-prompt` | Clear agent idle state for the active change. Fires on `UserPromptSubmit` |
| `artifact-write` | `hook artifact-write` | Read PostToolUse JSON from stdin, perform per-artifact bookkeeping (change type, score, checklist). Fires on `PostToolUse` (Write/Edit) |
| `sync` | `hook sync` | Discover `on-*.sh` scripts in `fab/.kit/hooks/`, map to Claude Code events, merge into `.claude/settings.local.json`. Idempotent |

**Hook subcommands vs `fab runtime`**: Hook subcommands resolve the active change automatically (no `<change>` argument) and swallow all errors. `fab runtime` subcommands require an explicit `<change>` argument and report errors normally. Hook subcommands use `internal/runtime` and other internal packages directly — no subprocesses.

**`artifact-write` stdin**: Expects Claude Code PostToolUse JSON payload on stdin. Extracts `tool_input.file_path`, matches against fab artifact patterns (`fab/changes/*/intake.md`, `spec.md`, `tasks.md`, `checklist.md`), and performs bookkeeping. Outputs `{"additionalContext":"Bookkeeping: ..."}` JSON on success.

**`sync` output**: Reports one of three statuses to stdout:
- `Created: .claude/settings.local.json hooks (N hook entries)` — fresh settings
- `Updated: .claude/settings.local.json hooks (added N hook entries)` — merged new entries
- `.claude/settings.local.json hooks: OK` — already up to date

---

## fab pane-map

Pane Map — shows all tmux panes with pipeline state. Includes all panes regardless of whether they are in a git repo or have a `fab/` directory.

```
fab/.kit/bin/fab pane-map [--json] [--session <name>] [--all-sessions]
```

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--json` | bool | Output as JSON array instead of aligned table |
| `--session <name>` | string | Target a specific tmux session by name (skips `$TMUX` check) |
| `--all-sessions` | bool | Query all tmux sessions (skips `$TMUX` check) |

`--session` and `--all-sessions` are mutually exclusive. When neither is set, discovers panes in the current tmux session only (`-s` session scope) and requires `$TMUX` to be set.

### Table Output

Produces an aligned table with columns:

| Column | Content | Conditional |
|--------|---------|-------------|
| Session | Tmux session name | Only with `--all-sessions` |
| Pane | Tmux pane ID (e.g., `%3`) | Always |
| WinIdx | Tmux window index (integer) | Always |
| Tab | Tmux window (tab) name | Always |
| Worktree | Relative path from main repo parent, `(main)` for the main worktree, or `basename/` for non-git panes | Always |
| Change | Active change folder name, `(no change)` if no active change, or `—` if not a fab worktree | Always |
| Stage | Current pipeline stage from `.status.yaml`, or `—` if no change or not a fab worktree | Always |
| Agent | Agent state: `active`, `idle ({duration})`, `?` (runtime file missing), or `—` (no change or not fab) | Always |

Idle duration format: `{N}s` (< 60s), `{N}m` (60s–59m), `{N}h` (>= 60m). Floor division.

**Example table output**:

```
Pane   WinIdx  Tab        Worktree                       Change                              Stage     Agent
%3     0       alpha      myrepo.worktrees/alpha/        260306-r3m7-add-retry-logic         apply     active
%7     1       bravo      myrepo.worktrees/bravo/        260306-k8ds-ship-wt-binary          review    idle (2m)
%12    2       main       (main)                         260306-ab12-refactor-auth           hydrate   idle (8m)
%15    3       scratch    downloads/                     —                                   —         —
```

### JSON Output

When `--json` is set, output is a JSON array. Each element has these fields (snake_case):

| Field | Type | Description |
|-------|------|-------------|
| `session` | string | Tmux session name |
| `window_index` | int | Tmux window index |
| `pane` | string | Tmux pane ID |
| `tab` | string | Tmux window (tab) name |
| `worktree` | string | Display path |
| `change` | string\|null | Active change folder name; `null` for `—` or `(no change)` |
| `stage` | string\|null | Pipeline stage; `null` for `—` |
| `agent_state` | string\|null | `"active"`, `"idle"`, `"unknown"`, or `null` |
| `agent_idle_duration` | string\|null | Duration string (e.g., `"5m"`) when idle; `null` otherwise |

**Error behavior**: If `$TMUX` is unset and neither `--session` nor `--all-sessions` is provided, prints `Error: not inside a tmux session` to stderr and exits 1. If no tmux panes are found, prints `No tmux panes found.` and exits 0.

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "Status file not found: {path}" | Passed a path that doesn't exist as a file | Use a change ID or folder name instead |
| "Cannot resolve change '{arg}'" | Change ID/name doesn't match any folder in `fab/changes/` | Check `fab/.kit/bin/fab change list` for available changes |
| "Multiple changes match" | Ambiguous substring matched multiple folders | Use a more specific identifier |
| "No active changes found" | `.fab-status.yaml` symlink is absent and no changes exist | Run `/fab-new` first |
