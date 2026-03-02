# Kit Script Invocation Guide

> Loaded by every skill via `_preamble.md`. Defines calling conventions for all kit shell scripts.

---

## `<change>` Argument Convention

All scripts accept a unified `<change>` argument, resolved by `resolve.sh` internally:

| Form | Example |
|------|---------|
| 4-char change ID | `yobi` |
| Folder name substring | `fix-kit` |
| Full folder name | `260227-yobi-fix-kit-scripts` |

**Not accepted**: bare directory paths or `.status.yaml` paths — use the folder name or change ID instead.

---

## Script Architecture

Six scripts with atomic responsibilities (`preflight.sh` serves as the validation entry point):

```
resolve.sh     ← universal resolver (no side effects)
   ↑
changeman.sh   ← change lifecycle (new, rename, switch, list)
statusman.sh   ← stage state machine + .status.yaml metadata
logman.sh      ← append-only .history.jsonl logging
calc-score.sh  ← confidence scoring from Assumptions tables
preflight.sh   ← validation entry point (calls all above)
```

**Call graph**: `resolve.sh` is called by every other script. `logman.sh` is called by `statusman.sh` (review auto-log), `calc-score.sh` (confidence log), `changeman.sh` (new/rename log), and skills (command log directly via `_preamble.md` §2 or per-skill instructions). Skills call `logman.sh command` directly for command invocation logging.

---

## resolve.sh

Change Resolver — pure query, no side effects. Converts any change reference to a canonical output.

```
resolve.sh [--id|--folder|--dir|--status] [<change>]
```

| Flag | Output |
|------|--------|
| `--id` (default) | 4-char change ID (e.g., `9fg2`) |
| `--folder` | Full folder name (e.g., `260228-9fg2-refactor-kit-scripts`) |
| `--dir` | Directory path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/`) |
| `--status` | `.status.yaml` path (e.g., `fab/changes/260228-9fg2-refactor-kit-scripts/.status.yaml`) |

---

## statusman.sh

Status Manager — manages workflow stages, states, and `.status.yaml`.

```
statusman.sh <subcommand> <change> [args...]
```

### Key subcommands

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `finish` | `finish <change> <stage> [driver]` | Mark stage done, auto-activate next. Review stage auto-logs "passed" |
| `start` | `start <change> <stage> [driver]` | pending/failed → active |
| `advance` | `advance <change> <stage> [driver]` | active → ready |
| `reset` | `reset <change> <stage> [driver]` | done/ready/skipped → active (cascades downstream to pending) |
| `skip` | `skip <change> <stage> [driver]` | {pending,active} → skipped (cascades downstream pending to skipped) |
| `fail` | `fail <change> <stage> [driver] [rework]` | active → failed (review only). Review stage auto-logs "failed" |
| `set-change-type` | `set-change-type <change> <type>` | Set change type |
| `set-checklist` | `set-checklist <change> <field> <value>` | Update checklist field |
| `set-confidence` | `set-confidence <change> <counts...> <score>` | Set confidence block |
| `set-confidence-fuzzy` | `set-confidence-fuzzy <change> <counts...> <score> <dims...>` | Set confidence with dimensions |
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

- `finish <change> review [driver]` → auto-calls `logman.sh review <change> "passed"`
- `fail <change> review [driver] [rework]` → auto-calls `logman.sh review <change> "failed" [rework]`

Skills do NOT need to call `log-review` manually — it's handled by statusman.

---

## changeman.sh

Change Manager — manages change folders, naming, and the `fab/current` pointer.

```
changeman.sh <subcommand> [flags...]
```

| Subcommand | Usage | Purpose |
|------------|-------|---------|
| `new` | `new --slug <slug> [--change-id <4char>] [--log-args <desc>]` | Create new change |
| `rename` | `rename --folder <current-folder> --slug <new-slug>` | Rename change slug |
| `resolve` | `resolve [<override>]` | Passthrough to `resolve.sh --folder` |
| `switch` | `switch <name> \| --blank` | Switch active change |
| `list` | `list [--archive]` | List changes with stage info |

---

## logman.sh

History Logger — append-only JSON logging to `.history.jsonl`. Skills call `logman.sh command` directly for command invocation logging.

```
logman.sh command <cmd> [change] [args]
logman.sh confidence <change> <score> <delta> <trigger>
logman.sh review <change> <result> [rework]
```

The `command` subcommand accepts `<cmd>` (skill name) as the first argument. `[change]` is optional — when omitted, logman resolves the active change via `fab/current`. If resolution fails (no `fab/current`, empty file, stale pointer), logman exits 0 silently. When `[change]` IS provided and doesn't resolve, logman exits 1 with an error.

**Callers**:

| Caller | Trigger | Logman call |
|--------|---------|-------------|
| Skills (via `_preamble.md` §2) | Skill invocation (preflight-calling skills) | `logman.sh command "<skill>" "<change>"` |
| Skills (per-skill instructions) | Skill invocation (exempt skills) | `logman.sh command "<skill>"` |
| `statusman.sh finish review` | Review pass | `logman.sh review "passed"` |
| `statusman.sh fail review` | Review fail | `logman.sh review "failed"` |
| `calc-score.sh` | Score computation | `logman.sh confidence` |
| `changeman.sh new` | Change creation | `logman.sh command` |
| `changeman.sh rename` | Change rename | `logman.sh command` |

---

## calc-score.sh

Confidence scorer — computes SRAD confidence score from Assumptions tables.

```
calc-score.sh [--check-gate] [--stage <stage>] <change>
```

| Mode | Usage | Behavior |
|------|-------|----------|
| Normal | `calc-score.sh <change>` | Parse spec.md, compute score, write to .status.yaml |
| Intake scoring | `calc-score.sh --stage intake <change>` | Parse intake.md, compute score, write to .status.yaml |
| Gate check | `calc-score.sh --check-gate <change>` | Parse artifact, compute score, compare threshold. Read-only |
| Intake gate | `calc-score.sh --check-gate --stage intake <change>` | Intake gate with fixed threshold 3.0 |

**Note**: `calc-score.sh` accepts `<change>` (any form supported by resolve.sh), not a directory path.

---

## preflight.sh

Pre-flight validator — validates project state and outputs structured YAML. Purely validation + structured output — no logging side-effects.

```
preflight.sh [<change-name>]
```

- `<change-name>`: Optional change override (resolved via changeman → resolve.sh).

Validates: config.yaml exists, constitution.md exists, active change resolved, `.status.yaml` exists. Outputs YAML with `name`, `change_dir`, `stage`, `progress`, `checklist`, `confidence` fields. Non-zero exit on failure with error message on stderr.

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| "Status file not found: {path}" | Passed a path that doesn't exist as a file | Use a change ID or folder name instead |
| "Cannot resolve change '{arg}'" | Change ID/name doesn't match any folder in `fab/changes/` | Check `changeman.sh list` for available changes |
| "Multiple changes match" | Ambiguous substring matched multiple folders | Use a more specific identifier |
| "No active changes found" | `fab/current` is empty/missing and no changes exist | Run `/fab-new` first |
