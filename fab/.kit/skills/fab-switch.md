---
name: fab-switch
description: "Switch the active change to a different one. Lists available changes when called with no argument."
---

# /fab-switch [change-name] [--blank]

> Read `fab/.kit/skills/_preamble.md` first. Only after that Read completes, proceed with any Bash calls.

---

## Arguments

- **`<change-name>`** *(optional)* — full or partial name of the change to switch to. Supports full folder names, partial slug matches, or any substring. Case-insensitive.
- **`--blank`** — deactivate the current change by deleting `fab/current`. Mutually exclusive with `<change-name>` (if both given, prefer `--blank`).

If no argument (and no `--blank`): list all active changes and ask user to pick.

---

## Context Loading

Loads matched change's `.status.yaml`. Name resolution and switch logic are delegated to `fab/.kit/scripts/lib/changeman.sh`. Does NOT load constitution, memory, or specs.

---

## Behavior

### No Argument Flow

1. Scan `fab/changes/` (exclude `archive/`)
2. If no folders: `No active changes found. Run /fab-new <description> to start one.`
3. If folders exist: list with stages as numbered options, wait for selection

### Argument Flow

Delegate to `changeman.sh switch` via a single Bash call:

```bash
bash fab/.kit/scripts/lib/changeman.sh switch "<change-name>"
```

If changeman exits 0: display the stdout output (contains name, stage, next command).

If changeman exits 1 and stderr contains "Multiple changes match": parse the comma-separated folder names from stderr, list them with stages as numbered options, ask user to pick. After selection, run `bash fab/.kit/scripts/lib/changeman.sh switch "<selected>"`.

If changeman exits 1 and stderr contains "No change matches": list all available changes, inform user.

### Deactivation Flow (`--blank`)

Run `bash fab/.kit/scripts/lib/changeman.sh switch --blank`. Display changeman's stdout output.

### Switch Flow

`changeman.sh switch` handles the full flow internally:
1. Resolves the change name
2. Writes `fab/current`
3. Outputs structured summary with stage and next command

The skill displays changeman's stdout directly.

### Command Logging

After a successful switch (not `--blank`), log the command invocation:

```bash
bash fab/.kit/scripts/lib/logman.sh command "fab-switch" 2>/dev/null || true
```

This is best-effort — logman resolves the active change via `fab/current` (just written by changeman). Failures are silently ignored.

### Hint Line

After displaying changeman's output, append (unless the operation was `--blank`):

```
Tip: run /git-branch to create or switch to the matching branch
```

---

## Output

Canonical format (from `changeman.sh switch` + skill hint):

```
fab/current → {name}

Stage:  {display_stage} ({N}/6) — {state}
Next:   {routing_stage} (via {default_command})
Tip: run /git-branch to create or switch to the matching branch
```

Where `{display_stage}` is "where you are" (last active or last done stage) and `{routing_stage}` is "what's next" (what `/fab-continue` will produce). The `{state}` qualifier is `done`, `active`, or `pending`. When all stages are done, `Next:` shows only `/fab-archive`.

Tip line omitted for `--blank`. Deactivation shows `No active change.`. Already-blank shows `No active change (already blank).`

---

## Error Handling

| Condition | Action |
|-----------|--------|
| No changes exist | "No active changes found. Run /fab-new." |
| Matched folder missing `.status.yaml` | Switch anyway, warn: "Warning: .status.yaml not found — change may be corrupted." |
| `fab/changes/` doesn't exist | "fab/changes/ not found. Run /fab-setup." |
| `fab/project/config.yaml` not found | No impact (config not required) |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No — changes only the active pointer |
| Idempotent? | Yes |
| Modifies `fab/current`? | Yes (writes name, or deletes with `--blank`) |
| Modifies `.status.yaml`? | No |
| Modifies git state? | No |
| Requires config/constitution? | No |
