---
name: fab-status
description: "Show current change state at a glance — name, branch, stage, checklist status, and suggested next command."
---

# /fab-status [<change-name>]

> Read and follow the instructions in `./fab/.kit/skills/_preamble.md` before proceeding.

---

## Purpose

Show the current change state at a glance — change name, branch, stage progress, checklist status, kit version, and suggested next command. Provides a quick orientation for where you are in the workflow without modifying anything.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change instead of the active one in `fab/current`. Supports full folder names, partial slug matches, or 4-char IDs (e.g., `r3m7`). When provided, passed to the status script as `$1` for transient resolution — `fab/current` is **not** modified.

If no argument is provided, the skill displays status for the active change in `fab/current`.

---

## Context Loading

This skill uses **minimal context** — it does not need to load `fab/project/config.yaml` or `fab/project/constitution.md` (as noted in `_preamble.md`, status is exempt from the "Always Load" requirement).

---

## Behavior

Run the preflight script to resolve the change, then render the status display:

```bash
bash fab/.kit/scripts/lib/preflight.sh [change-name]
```

Use `fab/.kit/scripts/lib/preflight.sh` and `fab/.kit/scripts/lib/statusman.sh` for validation and data retrieval. The skill handles formatting and presentation:

- Reads `fab/.kit/VERSION`, `fab/.kit-migration-version` (if exists), `fab/current`, and `fab/changes/{name}/.status.yaml`
- Queries live branch via `git branch --show-current` (instead of reading a static `branch:` field from `.status.yaml`)
- **Version drift check**: if `fab/.kit-migration-version` exists and its value is less than `fab/.kit/VERSION`, display a warning: `⚠ Version drift: local {local}, engine {engine} — run /fab-setup migrations`. If versions match, no warning. If `fab/.kit-migration-version` doesn't exist, no warning (handled by `/fab-setup`)
- Uses `display_stage` and `display_state` from preflight output for the primary "Stage:" line, showing the stage with a state qualifier (e.g., `Stage: intake (1/6) — done`). The "Next:" line shows the routing stage with the default command (e.g., `Next: spec (via /fab-continue)`). When all stages are done, shows `Next: /fab-archive`
- Renders the full status block: version header, change name, branch, stage with state qualifier, next action, progress table with symbols (`✓` done, `●` active, `◷` ready, `○` pending, `✗` failed), checklist counts, confidence score, version drift warning (if applicable)
- Handles all error cases (no active change, missing `.status.yaml`, missing fields)
- Defaults missing progress fields to `○` (pending), missing checklist to "not yet generated", and missing confidence to "not yet scored"
- **Confidence display** — varies by stage:
  - **Intake stage** (indicative, not persisted): Run `bash fab/.kit/scripts/lib/calc-score.sh --check-gate --stage intake <change>` and display from its output: `Indicative confidence: {score} (fab-ff gate: {threshold}) — {total} assumptions ({N} certain, {N} confident, {N} tentative)` — appends `, {N} unresolved` only when unresolved > 0. This is a read-only computation; the script does not write to `.status.yaml` in `--check-gate` mode.
  - **Spec stage or later** (persisted): Read the confidence block from `.status.yaml` and display: `Confidence: {score} of 5.0 ({N} certain, {N} confident, {N} tentative)` — appends `, {N} unresolved` only when unresolved > 0.
  - **No confidence data**: Shows `Confidence: not yet scored` when the confidence block is absent and the stage is not intake.

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | **No** — purely informational, read-only |
| Idempotent? | **Yes** — no side effects, safe to call any number of times |
| Modifies `fab/current`? | **No** |
| Modifies `.status.yaml`? | **No** |
| Modifies source code? | **No** |
| Requires config/constitution? | **No** |
