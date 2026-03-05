---
name: _scripts
description: "Kit script invocation guide — calling conventions for the fab dispatcher and shell scripts."
user-invocable: false
disable-model-invocation: true
metadata:
  internal: true
---
# Kit Script Invocation Guide

> Loaded by every skill via `_preamble.md`. Defines calling conventions for all kit operations.

---

## Calling Convention

`fab/.kit/bin/fab` is a shell dispatcher that serves as the sole entry point for all fab CLI operations. It checks for compiled backends in priority order (`fab-rust` → `fab-go` → shell scripts) and delegates accordingly. Shell scripts in `fab/.kit/scripts/lib/` are pure implementations — no shims, no delegation logic.

```
fab/.kit/bin/fab <command> <subcommand> [args...]
```

### Backend Priority

1. `fab/.kit/bin/fab-rust` — if present and executable, all commands delegate here
2. `fab/.kit/bin/fab-go` — if present and executable, all commands delegate here
3. Shell scripts — dispatcher routes to `fab/.kit/scripts/lib/` via `case` statement

When falling back to shell scripts, the dispatcher prints `[fab] using shell backend` to stderr.

### Command Mapping

| Command | Shell script | Purpose |
|---------|-------------|---------|
| `fab resolve` | `resolve.sh` | Change reference resolution |
| `fab status` | `statusman.sh` | Stage state machine + metadata |
| `fab log` | `logman.sh` | Append-only history logging |
| `fab preflight` | `preflight.sh` | Validation + structured YAML output |
| `fab change` | `changeman.sh` | Change lifecycle (new, rename, switch, list) |
| `fab score` | `calc-score.sh` | Confidence scoring |
| `fab archive` | `archiveman.sh` | Archive/restore operations |

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

Skills do NOT need to call `fab log review` or `fab log transition` manually — it's handled by statusman.

---

## fab change

Change Manager — manages change folders, naming, and the `fab/current` pointer.

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

---

## fab log

History Logger — append-only JSON logging to `.history.jsonl`. Skills call `fab log command` directly for command invocation logging.

```
fab/.kit/bin/fab log command <cmd> [change] [args]
fab/.kit/bin/fab log confidence <change> <score> <delta> <trigger>
fab/.kit/bin/fab log review <change> <result> [rework]
fab/.kit/bin/fab log transition <change> <stage> <action> [from] [reason] [driver]
```

The `command` subcommand accepts `<cmd>` (skill name) as the first argument. `[change]` is optional — when omitted, it resolves the active change via `fab/current`. If resolution fails (no `fab/current`, empty file, stale pointer), exits 0 silently. When `[change]` IS provided and doesn't resolve, exits 1 with an error.

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

## fab archive

Archive Manager — handles archive/restore lifecycle operations.

```
fab/.kit/bin/fab archive <change> --description "..."
fab/.kit/bin/fab archive restore <change> [--switch]
fab/.kit/bin/fab archive list
```

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| *(default)* | `<change> --description "..."` | Clean .pr-done, move to archive/, update index, clear pointer |
| `restore` | `restore <change> [--switch]` | Move from archive/, remove index entry, optionally activate |
| `list` | `list` | List archived folder names (one per line) |

**Resolution**: archive resolves `<change>` via standard resolution (active changes). `restore` uses internal archive-folder resolution. Both support 4-char ID, substring, and full folder name.

**Output**: Both archive and restore output structured YAML to stdout. Skills parse this YAML to construct user-facing reports.

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "Status file not found: {path}" | Passed a path that doesn't exist as a file | Use a change ID or folder name instead |
| "Cannot resolve change '{arg}'" | Change ID/name doesn't match any folder in `fab/changes/` | Check `fab/.kit/bin/fab change list` for available changes |
| "Multiple changes match" | Ambiguous substring matched multiple folders | Use a more specific identifier |
| "No active changes found" | `fab/current` is empty/missing and no changes exist | Run `/fab-new` first |
