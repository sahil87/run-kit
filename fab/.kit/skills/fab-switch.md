---
name: fab-switch
description: "Switch the active change to a different one. Lists available changes when called with no argument."
---

# /fab-switch [change-name] [--none]

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Only after that Read completes, proceed with any Bash calls.

---

## Arguments

- **`<change-name>`** *(optional)* — full or partial name of the change to switch to. Supports full folder names, partial slug matches, or any substring. Case-insensitive.
- **`--none`** — deactivate the current change by removing the `.fab-status.yaml` symlink. Mutually exclusive with `<change-name>` (if both given, prefer `--none`).

If no argument (and no `--none`): list all active changes and ask user to pick.

---

## Context Loading

Loads matched change's `.status.yaml`. Name resolution and switch logic are delegated to `fab/.kit/bin/fab change`. Does NOT load constitution, memory, or specs.

---

## Behavior

### No Argument Flow

1. Scan `fab/changes/` (exclude `archive/`)
2. If no folders: `No active changes found. Run /fab-new <description> to start one.`
3. If folders exist: list with stages as numbered options, wait for selection

### Argument Flow

Delegate to `fab change switch` via a single Bash call:

```bash
fab/.kit/bin/fab change switch "<change-name>"
```

If the command exits 0: display the stdout output (contains name, stage, next command).

If the command exits 1 and stderr contains "Multiple changes match": parse the comma-separated folder names from stderr, list them with stages as numbered options, ask user to pick. After selection, run `fab/.kit/bin/fab change switch "<selected>"`.

If the command exits 1 and stderr contains "No change matches": list all available changes, inform user.

### Deactivation Flow (`--none`)

Run `fab/.kit/bin/fab change switch --none`. Display the command's stdout output.

### Switch Flow

`fab change switch` handles the full flow internally:
1. Resolves the change name
2. Creates `.fab-status.yaml` symlink
3. Outputs structured summary with stage and next command

The skill displays the command's stdout directly.

### Command Logging

After a successful switch (not `--none`), log the command invocation:

```bash
fab/.kit/bin/fab log command "fab-switch" 2>/dev/null || true
```

This is best-effort — the logger resolves the active change via `.fab-status.yaml` (just created by the switch command). Failures are silently ignored.

### Hint Line

After displaying the command's output, append (unless the operation was `--none`):

```
Tip: run /git-branch to create or switch to the matching branch
```

---

## Output

Canonical format (from `fab change switch` + skill hint):

```
.fab-status.yaml → {name}

Stage:       {display_stage} ({N}/8) — {state}
Confidence:  {score} of 5.0{indicative_suffix}
Next:        {routing_stage} (via {default_command})
Tip: run /git-branch to create or switch to the matching branch
```

Where `{display_stage}` is "where you are" (last active or last done stage) and `{routing_stage}` is "what's next" (what `/fab-continue` will produce). The `{state}` qualifier is `done`, `active`, or `pending`. When all stages are done, `Next:` shows only `/fab-archive`. The `{indicative_suffix}` is ` (indicative)` when `confidence.indicative` is true, empty otherwise. When score is `0.0` and no assumptions exist, shows `not yet scored`.

For the no-argument flow (listing changes), the skill reads `fab change list` output (format `name:display_stage:display_state:score:indicative`) and displays confidence info alongside stage info in the numbered list.

Tip line omitted for `--none`. Deactivation shows `No active change.`. Already-deactivated shows `No active change (already deactivated).`

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
| Modifies `.fab-status.yaml`? | Yes (creates symlink, or removes with `--none`) |
| Modifies `.status.yaml`? | No |
| Modifies git state? | No |
| Requires config/constitution? | No |
