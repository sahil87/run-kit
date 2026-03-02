---
name: internal-consistency-check
description: "Scan for inconsistencies between implementation, specs, and memory — flag conflicts and suggest fixes."
---

# Internal Consistency Check

Scan for inconsistencies between the three sources of truth:

- **Implementation** — source code (paths from `source_paths` in `fab/project/config.yaml`)
- **Memory** (`docs/memory/`) — centralized memory (generated/hydrated)
- **Specs** (`docs/specs/`) — human-curated specifications

---

## Pre-flight

1. Read `fab/project/config.yaml`, extract `source_paths`
2. If `source_paths` missing or empty: STOP with `No source_paths defined in fab/project/config.yaml.`

---

## Execution

Spawn **three parallel agents** (Task tool, subagent_type: `Explore`, thoroughness: `very thorough`). Include resolved `source_paths` in each prompt.

### Agent 1: Specs ↔ Implementation

Audit `docs/specs/` against implementation directories. Report: missing implementations, undocumented implementations, naming mismatches, behavioral contradictions, stale references. Cite specific files and lines.

### Agent 2: Memory ↔ Implementation

Audit `docs/memory/` against implementation directories. Report: stale memory, missing memory, wrong paths/names, contradicted behavior, orphaned memory. Cite specific files and lines.

### Agent 3: Specs ↔ Memory

Audit `docs/specs/` against `docs/memory/`. Report: terminology drift, coverage gaps, contradictions, stale cross-references, glossary drift. Cite specific files and lines.

---

## Synthesis

### 1. Summary Table

| Dimension | Findings | Critical | Minor |
|-----------|----------|----------|-------|
| Specs ↔ Implementation | {count} | {count} | {count} |
| Memory ↔ Implementation | {count} | {count} | {count} |
| Specs ↔ Memory | {count} | {count} | {count} |

### 2. Critical Findings

Contradicted behavior, missing/broken key concepts.

### 3. Minor Findings

Naming mismatches, missing coverage, stale references, orphaned content.

### 4. Suggested Actions

Grouped by: **Fix** (actively wrong), **Add** (missing coverage), **Remove** (stale/orphaned), **Rename** (terminology alignment).

---

## Classification

**Critical**: Implementation contradicts spec, memory instructs something that fails, referenced file/command/path doesn't exist.

**Minor**: Naming mismatch without behavioral impact, coverage gap, stale reference without user confusion, orphaned content.
