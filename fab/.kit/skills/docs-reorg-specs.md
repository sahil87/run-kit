---
name: docs-reorg-specs
description: "Analyze spec files for themes and suggest reorganization. Read-only unless user approves changes."
---

# /docs-reorg-specs

---

## Purpose

Read all spec files in `docs/specs/`, identify themes (up to 10), and propose a reorganization plan. Read-only by default — files only moved/rewritten with explicit user approval.

---

## Pre-flight

1. `docs/specs/index.md` must exist and be readable
2. `docs/specs/` must contain at least one `.md` file besides `index.md`

If either fails, STOP with appropriate message.

---

## Context Loading

Loads `docs/specs/index.md` and every `.md` file in `docs/specs/`. Does NOT require `.fab-status.yaml`, config, or constitution.

---

## Behavior

### Step 1: Read All Spec Files

Read `docs/specs/index.md` and every `.md` file. For each: extract `##`/`###` headings, brief section summaries, and approximate line count.

### Step 2: Identify Themes (up to 10)

Analyze content for recurring topics, conceptual clusters, cross-cutting concerns. For each theme: name (2-4 words), description, source locations, cohesion (concentrated / scattered).

```
## Themes Found

| # | Theme | Description | Current Location(s) | Cohesion |
|---|-------|-------------|---------------------|----------|
```

### Step 3: Diagnose Current Structure

Brief assessment (5-7 bullets max): what works well, pain points (too large, too broad, duplicated), missing connections.

### Step 4: Propose Reorganization

```
## Proposed Structure

| File | Description | Change |
|------|-------------|--------|

## Migration Map

| # | Section | From | To | Rationale |
|---|---------|------|----|-----------|

## Updated index.md Preview
(markdown preview)
```

Constraints: prefer fewer files, preserve existing names, keep files under ~300 lines, say so if current structure is fine.

### Step 5: User Confirmation

Options: **Apply all**, **Cherry-pick** (select specific migrations), **Skip** (keep analysis only).

On approval: execute migrations, rewrite `docs/specs/index.md`, verify no headings lost, present change summary.

---

## Output

```
Scanned {N} spec files ({L} total lines).

{Themes table}
{Diagnosis}
{Proposal}

Apply this reorganization? (apply all / cherry-pick / skip)
```

After apply: `Reorganization complete: {M} sections moved, {S} files modified, {C} files created.`

If no changes needed: `Current structure is well-organized — no reorganization needed.`

---

## Error Handling

| Condition | Action |
|-----------|--------|
| `docs/specs/index.md` missing | Abort: "Run /fab-setup first." |
| No spec files besides index | Abort: "Nothing to reorganize." |
| File write fails during apply | Report error, roll back that migration, continue |
| Content verification fails | Warn, show missing heading, ask to proceed |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No |
| Requires active change? | No |
| Idempotent? | Yes |
| Modifies spec files? | Yes — only with explicit confirmation |
| Requires config/constitution? | No |
