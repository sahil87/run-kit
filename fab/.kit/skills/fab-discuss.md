---
name: fab-discuss
description: "Prime the agent with project context for a discussion session — loads the always-load layer and orients to the repo landscape."
---

# /fab-discuss

> Read `fab/.kit/skills/_preamble.md` first (path is relative to repo root). Then follow its instructions before proceeding.

---

## Purpose

Prime the agent with project context for an exploratory discussion session. Loads the standard always-load layer (`_preamble.md` §1), presents an orientation summary of the project landscape, and signals readiness for open-ended conversation. No artifact generation, no stage advancement — purely read-only.

---

## Arguments

None.

---

## Context Loading

Load the **always-load layer** from `_preamble.md` §1 — the same 7 files every skill loads:

1. `fab/project/config.yaml` — **required**
2. `fab/project/constitution.md` — **required**
3. `fab/project/context.md` — *optional* (skip gracefully if missing)
4. `fab/project/code-quality.md` — *optional* (skip gracefully if missing)
5. `fab/project/code-review.md` — *optional* (skip gracefully if missing)
6. `docs/memory/index.md` — **required**
7. `docs/specs/index.md` — **required**

Do **not** run preflight. Do **not** load change-specific artifacts.

After loading the always-load layer, check for an active change:

1. Run `fab/.kit/bin/fab resolve --folder 2>/dev/null` — if it exits non-zero, note "No active change"
2. If resolution succeeds, use the returned folder name to read `fab/changes/{name}/.status.yaml` for the current stage
3. Do **not** load change artifacts (intake, spec, tasks)

---

## Command Logging

After context loading, log the command invocation:

```bash
fab/.kit/bin/fab log command "fab-discuss" 2>/dev/null || true
```

This is best-effort — logman resolves the active change via `fab/current` if one exists. Failures are silently ignored.

---

## Behavior

1. Read all 7 always-load files (skip optional files gracefully)
2. Resolve active change via `fab resolve`
3. Output the **Orientation Summary** (see format below)

---

## Orientation Summary

```
Project: {name} — {description}

Memory domains:
  {domain} ({N} files)
  ...

Specs:
  {spec-name} — {description}
  ...

{Optional files loaded / not found}

Active change: {name} (stage: {stage})  — or "No active change"

Ready to discuss. What would you like to explore?
```

The summary:
- Lists memory domains and file counts from `docs/memory/index.md`
- Lists specs and descriptions from `docs/specs/index.md`
- Notes which optional project files were loaded or not found
- Shows the active change name and stage if one exists (light touch — no deep loading)
- Ends with the ready signal, not a `Next:` pipeline command

---

## Key Properties

| Property | Value |
|----------|-------|
| Requires active change? | No |
| Runs preflight? | No |
| Read-only? | Yes — modifies no files |
| Idempotent? | Yes |
| Advances stage? | No |
| Outputs `Next:` line? | No — ends with discussion-mode ready signal |
