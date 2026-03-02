---
name: docs-reorg-memory
description: "Analyze memory files for themes and suggest reorganization. Read-only unless user approves changes."
---

# /docs-reorg-memory

---

## Purpose

Read all memory files across all domains in `docs/memory/`, identify themes (up to 10), and propose a reorganization plan. Read-only by default — files only moved/rewritten with explicit user approval.

---

## Pre-flight

1. `docs/memory/index.md` must exist and be readable
2. `docs/memory/` must contain at least one domain directory with `.md` files besides `index.md`

If either fails, STOP with appropriate message.

---

## Context Loading

Loads `docs/memory/index.md`, all domain `index.md` files, and every `.md` file in each domain. Does NOT require `fab/current`, config, or constitution.

---

## Behavior

### Step 1: Read All Memory Files

Read `docs/memory/index.md` and every domain directory. For each memory file: extract `##`/`###` headings, brief section summaries, and approximate line count.

### Step 2: Identify Themes (up to 10)

Analyze content for recurring topics, conceptual clusters, cross-cutting concerns. For each theme: name (2-4 words), description, source locations, cohesion (concentrated / scattered).

```
## Themes Found

| # | Theme | Description | Current Location(s) | Cohesion |
|---|-------|-------------|---------------------|----------|
```

### Step 3: Diagnose Current Structure

Brief assessment (5-7 bullets max): what works well, pain points (files too large, topics split across files, domain boundaries unclear, duplicated content), missing connections.

### Step 4: Propose Reorganization

```
## Proposed Structure

| Domain | File | Description | Change |
|--------|------|-------------|--------|

## Migration Map

| # | Section | From | To | Rationale |
|---|---------|------|----|-----------|

## Updated Indexes Preview
(markdown preview of affected index files)
```

Constraints: prefer fewer files per domain, preserve existing domain names where possible, keep files under ~300 lines, say so if current structure is fine.

### Step 5: User Confirmation

Options: **Apply all**, **Cherry-pick** (select specific migrations), **Skip** (keep analysis only).

On approval: execute migrations, update all affected `index.md` files (domain-level and top-level), verify no headings lost, present change summary.

---

## Output

```
Scanned {D} domains, {N} memory files ({L} total lines).

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
| `docs/memory/index.md` missing | Abort: "Run /fab-setup first." |
| No memory domains or files besides indexes | Abort: "Nothing to reorganize." |
| File write fails during apply | Report error, roll back that migration, continue |
| Content verification fails | Warn, show missing heading, ask to proceed |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No |
| Requires active change? | No |
| Idempotent? | Yes |
| Modifies memory files? | Yes — only with explicit confirmation |
| Requires config/constitution? | No |
