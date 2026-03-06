---
name: fab-archive
description: "Archive a completed change or restore an archived change — move to/from archive folder, update index, mark backlog items, clear pointer."
---

# /fab-archive [<change-name>] | restore <change-name> [--switch]

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Archive a completed change after hydrate, or restore an archived change back to active. Archive mode delegates mechanical operations (clean, move, index, pointer) to `fab change archive` and handles only backlog matching in the skill. Restore mode delegates entirely to `fab change restore`. Both modes are safe to re-run after interruption.

---

## Arguments

### Archive Mode (default)

- **`<change-name>`** *(optional)* — target a specific change. Resolution per `_preamble.md` (Change-name override).

### Restore Mode

- **`restore`** — switches to restore mode.
- **`<change-name>`** *(required)* — name or substring of the archived change to restore.
- **`--switch`** *(optional)* — activate the restored change by writing its name to `fab/current`.

**Mode detection**: If the first positional argument is `restore`, use restore mode. Otherwise, use archive mode.

---

## Pre-flight

1. Run `fab/.kit/bin/fab preflight [change-name]` per `_preamble.md`
2. **Hydrate Guard**: If `progress.hydrate` is not `done`, STOP: `Hydrate has not completed. Run /fab-continue to hydrate memory first.`

---

## Context Loading

Minimal: `intake.md` (for backlog ID + keywords and description extraction), `.status.yaml`, `fab/backlog.md` (if exists).

---

## Behavior

### Step 1: Extract Description

Read the intake's **Why** section and extract a 1-2 sentence description summarizing the change. This becomes the `--description` argument for the script.

### Step 2: Run Archive Script

Call `fab change archive` in a single invocation:

```bash
fab/.kit/bin/fab change archive <change> --description "<extracted description>"
```

Where `<change>` is the change ID or name from preflight. Parse the structured YAML output for the report.

The command handles:
- **Clean**: Delete `.pr-done` if present
- **Move**: `fab/changes/{name}/` → `fab/changes/archive/yyyy/mm/{name}/` (date-bucketed)
- **Index**: Create/update `fab/changes/archive/index.md` with entry + backfill
- **Pointer**: Clear `fab/current` if this was the active change

### Step 3: Mark Backlog Items Done

Skip silently if `fab/backlog.md` doesn't exist.

**3a — Exact-ID**: If intake has backlog ID, find and mark done (`- [ ]` → `- [x]`), move to Done section.

**3b — Keyword Scan**: Extract keywords from intake title/Why (filter stop words). Match against unchecked items — candidate when ≥2 significant keywords overlap (exclude 3a matches). No candidates → proceed silently.

**3c — Interactive Confirmation** (if 3b found candidates):

```
Backlog matches found:
  1. [ID] {description (~80 chars)}
  2. [ID] {description (~80 chars)}

Mark as done? (comma-separated numbers, or "none")
```

### Step 4: Format Report

Construct the user-facing report from the script's YAML output fields:

| YAML field | Report line |
|------------|-------------|
| `clean: removed` | `Cleaned:  ✓ .pr-done removed` |
| `clean: not_present` | `Cleaned:  — not present` |
| `move: moved` | `Moved:    ✓ fab/changes/archive/yyyy/mm/{name}/` |
| `index: created` | `Index:    ✓ fab/changes/archive/index.md created` |
| `index: updated` | `Index:    ✓ fab/changes/archive/index.md updated` |
| `pointer: cleared` | `Pointer:  ✓ fab/current cleared` |
| `pointer: skipped` | `Pointer:  — skipped, not active` |

Backlog and Scan lines come from Step 3 (agent-driven), not from the script.

---

## Output

```
Archive: {change name}

Cleaned:  ✓ .pr-done removed                    (or: — not present)
Moved:    ✓ fab/changes/archive/yyyy/mm/{name}/
Index:    ✓ fab/changes/archive/index.md updated (or: created)
Backlog:  ✓ [ID] marked done                   (or: — no backlog file)
Scan:     ✓ {N} candidates, {M} marked done    (or: ✓ no matches)
Pointer:  ✓ fab/current cleared                 (or: — skipped, not active)

Archive complete.

Next: {per state table — initialized}
```

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No — post-pipeline housekeeping |
| Idempotent? | Yes — script detects state, backlog matching is idempotent |
| Modifies `.status.yaml`? | No (may update `last_updated`) |
| Modifies `fab/current`? | Yes — conditionally clears (via script) |
| Modifies `docs/memory/`? | No |
| Requires hydrate done? | Yes |

---

# /fab-archive restore <change-name> [--switch]

## Purpose

Restore an archived change back to the active changes folder. Inverse of the archive operation. Delegates entirely to `fab change restore`. Preserves all artifacts and status as-is — no status reset, no artifact regeneration.

---

## Arguments

- **`<change-name>`** *(required)* — name or substring of the archived change to restore. Resolved by `fab change restore` via case-insensitive substring matching against `fab/changes/archive/`.
- **`--switch`** *(optional)* — activate the restored change by writing its name to `fab/current`.

---

## Pre-flight

1. No standard preflight needed (no active change required).
2. The script handles archive folder validation internally.

---

## Context Loading

None required — the script handles all file operations.

---

## Behavior

### Step 1: Resolve and Restore

Call `fab change restore` in a single invocation:

```bash
fab/.kit/bin/fab change restore <change-name> [--switch]
```

Parse the structured YAML output for the report. If the command exits non-zero:
- **"Multiple archives match"** → list the matches from stderr, ask user to pick, re-run with the selected name
- **"No archive matches"** → call `fab/.kit/bin/fab change archive-list`, display available archives, inform user

### Step 2: Format Report

Construct the user-facing report from the script's YAML output fields:

| YAML field | Report line |
|------------|-------------|
| `move: restored` | `Moved:    ✓ fab/changes/{name}/` |
| `move: already_in_changes` | `Moved:    ✓ already in changes` |
| `index: removed` | `Index:    ✓ entry removed from archive/index.md` |
| `index: not_found` | `Index:    — entry not found` |
| `pointer: switched` | `Pointer:  ✓ fab/current updated` |
| `pointer: skipped` | `Pointer:  — not requested` |

---

## Output

```
Restore: {change name}

Moved:    ✓ fab/changes/{name}/                  (or: ✓ already in changes)
Index:    ✓ entry removed from archive/index.md  (or: — entry not found)
Pointer:  ✓ fab/current updated                  (or: — not requested)

Restore complete.

Next: {per state table — if --switch: restored change's state; otherwise: activation preamble + restored change's state}
```

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Script exits 1: "No archive folder found" | Display error |
| Script exits 1: "No archived changes found" | Display error |
| Script exits 1: "No archive matches" | List available archives via `fab/.kit/bin/fab change archive-list` |
| Script exits 1: "Multiple archives match" | Parse matches from stderr, ask user to pick |
| Folder already in `fab/changes/` | Script handles — reports `already_in_changes` |
| Index entry not found | Script handles — reports `not_found` |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No — post-archive housekeeping |
| Idempotent? | Yes — script detects already-restored folders |
| Modifies `.status.yaml`? | No |
| Modifies `fab/current`? | Only with `--switch` flag (via script) |
| Modifies `docs/memory/`? | No |
| Requires hydrate done? | No — restores any archived change regardless of state |
