---
name: _scripts
description: "Kit script invocation guide — calling conventions for the fab dispatcher and Go binary."
user-invocable: false
disable-model-invocation: true
metadata:
  internal: true
---
# Kit Script Invocation Guide

> Loaded by every skill via `_preamble.md`. Defines calling conventions for all kit operations.

---

## Calling Convention

`fab/.kit/bin/fab` is a shell dispatcher that serves as the sole entry point for all fab CLI operations. It checks for compiled backends in priority order (`fab-rust` → `fab-go`) and delegates accordingly. All commands are implemented in the Go binary via Cobra.

```
fab/.kit/bin/fab <command> <subcommand> [args...]
```

### Backend Priority

1. `fab/.kit/bin/fab-rust` — if present and executable, all commands delegate here
2. `fab/.kit/bin/fab-go` — if present and executable, all commands delegate here
3. Error — exits 1 with message directing user to install a backend

### Help

`fab -h`, `fab --help`, and `fab <subcommand> --help` work via Cobra's built-in help system.

### Command Reference

| Command | Purpose |
|---------|---------|
| `fab resolve` | Change reference resolution |
| `fab status` | Stage state machine + metadata |
| `fab status show` | Worktree fab pipeline status |
| `fab log` | Append-only history logging |
| `fab preflight` | Validation + structured YAML output |
| `fab change` | Change lifecycle (new, rename, switch, list, archive, restore, archive-list) |
| `fab score` | Confidence scoring |
| `fab runtime` | Runtime state management (.fab-runtime.yaml) |
| `fab pane-map` | Tmux pane-to-worktree mapping with fab pipeline state |
| `fab send-keys` | Send text to a change's tmux pane |

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
| `switch` | `switch <name> \| --blank` | Switch active change |
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
| `show` | `show [--all] [--json] [<name>]` | Worktree fab pipeline status |
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
fab/.kit/bin/fab resolve [--id|--folder|--dir|--status] [<change>]
```

| Flag | Output |
|------|--------|
| `--id` (default) | 4-char change ID (e.g., `9fg2`) |
| `--folder` | Full folder name (e.g., `260228-9fg2-refactor-kit-scripts`) |
| `--dir` | Directory path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/`) |
| `--status` | `.status.yaml` path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/.status.yaml`) |

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

## fab pane-map

Pane Map — shows all tmux panes mapped to their fab worktrees with pipeline state. Requires an active tmux session.

```
fab/.kit/bin/fab pane-map
```

No arguments or flags. Discovers panes in the current tmux session only (`-s` session scope). Produces an aligned table with columns:

| Column | Content |
|--------|---------|
| Pane | Tmux pane ID (e.g., `%3`) |
| Tab | Tmux window (tab) name |
| Worktree | Relative path from main repo parent, or `(main)` for the main worktree |
| Change | Active change folder name, or `(no change)` if none |
| Stage | Current pipeline stage from `.status.yaml`, or `—` if no change |
| Agent | Agent state: `active`, `idle ({duration})`, `?` (runtime file missing), or `—` (no change) |

Idle duration format: `{N}s` (< 60s), `{N}m` (60s–59m), `{N}h` (>= 60m). Floor division.

**Error behavior**: If `$TMUX` is unset, prints `Error: not inside a tmux session` to stderr and exits 1. Panes not inside a git repo or without a `fab/` directory are silently excluded. If no fab worktrees are found, prints `No fab worktrees found in tmux panes.` and exits 0.

**Example output**:

```
Pane   Tab        Worktree                       Change                              Stage     Agent
%3     alpha      myrepo.worktrees/alpha/        260306-r3m7-add-retry-logic         apply     active
%7     bravo      myrepo.worktrees/bravo/        260306-k8ds-ship-wt-binary          review    idle (2m)
%12    main       (main)                         260306-ab12-refactor-auth           hydrate   idle (8m)
```

---

## fab send-keys

Send Keys — sends text to a change's tmux pane. Used by the operator skill for cross-agent coordination.

```
fab/.kit/bin/fab send-keys <change> "<text>"
```

| Argument | Description |
|----------|-------------|
| `<change>` | Standard change reference (4-char ID, substring, or full folder name) |
| `<text>` | Text to send to the target pane (typically a skill command like `/fab-continue`) |

**Pane resolution**: Resolves the change argument to a folder name via standard change resolution, then discovers tmux panes in the current session (`tmux list-panes -s`), resolves each pane's git worktree root and `fab/current`, and matches the change folder. Sends to the first matching pane.

**Safety**: Does NOT enforce idle checks — policy (check idle before sending) lives in the operator skill, mechanism (send text to pane) lives in the CLI.

**Error behavior**:

| Condition | Message | Exit code |
|-----------|---------|-----------|
| `$TMUX` unset | `Error: not inside a tmux session` | 1 |
| Change not found | `No change matches "<arg>".` | 1 |
| No pane for change | `No tmux pane found for change "<folder>".` | 1 |
| Pane disappeared after resolution | `Error: pane %N no longer exists.` | 1 |
| Multiple panes for same change | Sends to first match, prints `Warning: multiple panes found for <id>, using %N` to stderr | 0 |

**Example**:

```
fab/.kit/bin/fab send-keys r3m7 "/fab-continue"
fab/.kit/bin/fab send-keys 260306-k8ds-ship-wt-binary "git fetch origin main && git rebase origin/main"
```

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "Status file not found: {path}" | Passed a path that doesn't exist as a file | Use a change ID or folder name instead |
| "Cannot resolve change '{arg}'" | Change ID/name doesn't match any folder in `fab/changes/` | Check `fab/.kit/bin/fab change list` for available changes |
| "Multiple changes match" | Ambiguous substring matched multiple folders | Use a more specific identifier |
| "No active changes found" | `.fab-status.yaml` symlink is absent and no changes exist | Run `/fab-new` first |
