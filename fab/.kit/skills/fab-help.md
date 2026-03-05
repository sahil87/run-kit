---
name: fab-help
description: "Show the fab workflow overview and a quick summary of all available commands."
---

# /fab-help

---

## Purpose

Orient the user in the fab workflow. Show how the stages fit together and list every `/fab-*` command with a one-line description. Read-only — no files are created or modified.

---

## Behavior

When invoked, log the command and execute the help script:

```bash
fab/.kit/bin/fab log command "fab-help" 2>/dev/null || true
bash fab/.kit/scripts/fab-help.sh
```

The script reads the kit version from `fab/.kit/VERSION` (falling back to "unknown" if missing) and prints the complete help text. The script is the single source of truth for help content.

---

## Context Loading

This skill uses **no context** — it does not load `fab/project/config.yaml`, `fab/project/constitution.md`, or any change artifacts. The only file read is `fab/.kit/VERSION` (by the script).

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | **No** — purely informational |
| Idempotent? | **Yes** — no side effects |
| Modifies any files? | **No** |
| Requires active change? | **No** |
| Requires config/constitution? | **No** |
