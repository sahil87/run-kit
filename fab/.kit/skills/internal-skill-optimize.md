---
name: internal-skill-optimize
description: "Condense a skill to its core — remove verbosity and redundancy without losing critical functionality."
---

# Internal Skill Optimize

Condense a skill (or all skills) to their core — remove verbosity, redundant examples, and re-explained concepts without losing any critical functionality.

---

## Arguments

- **`<skill-name>`** *(optional)* — name of a single skill to optimize (e.g., `fab-new`, `fab-continue`). Resolves to `fab/.kit/skills/{skill-name}.md`.
- If omitted, process **all** `.md` files in `fab/.kit/skills/` except `_preamble.md` and `_generation.md` (shared preambles, not skills).

---

## Pre-flight

1. Read `fab/.kit/skills/_preamble.md` — this is the shared context all skills reference. Anything fully defined here does NOT need re-explaining inside individual skills.
2. Read `fab/.kit/skills/_generation.md` — shared generation procedures. Same rule.
3. If a specific skill was requested, verify the file exists. If not, STOP with: `Skill not found: fab/.kit/skills/{skill-name}.md`

---

## Analysis (per skill)

For each skill file, read it fully and evaluate against these bloat signals:

| Signal | What to look for |
|--------|-----------------|
| **Redundant re-explanation** | Concepts already defined in `_preamble.md` or `_generation.md` being re-stated (SRAD rules, confidence formula, context loading layers, preflight behavior). Replace with a brief reference. |
| **Excessive output examples** | Multiple full output blocks showing minor variations. Consolidate to 1 compact example + brief notes on how it varies. |
| **Obvious instructions** | Telling an LLM things it already knows (what articles are, how to generate slugs, "continue to Step N" transitions). Remove. |
| **Redundant argument docs** | Same information appearing in both the Arguments section and a Behavior step. Keep one, reference the other. |
| **Over-specified error tables** | Error cases that are already handled by preflight scripts or shared conventions. Keep only skill-specific errors. |
| **Verbose step narration** | Steps that could be a single sentence but are expanded into paragraphs with sub-bullets. Compress. |
| **Duplicate examples** | Multiple examples illustrating the same point. Keep the most illustrative one. |

---

## Optimization Rules

1. **Never remove functionality** — every behavioral step, error case, and decision point must survive. The goal is fewer words for the same logic.
2. **Preserve frontmatter exactly** — `name`, `description` fields are untouched.
3. **Preserve the H1 heading and context reference** — `# /skill-name` and the `_preamble.md` blockquote stay.
4. **Reference shared docs instead of re-explaining** — e.g., replace a 10-line SRAD re-explanation with "Apply the SRAD framework (see `_preamble.md`)."
5. **Merge small sequential steps** — if Step N and Step N+1 are always done together and total <5 lines, combine them.
6. **One output example max** — show the canonical happy-path format. Use inline notes like `(if --switch: include branch line)` for variations.
7. **Keep error tables** — but remove rows already covered by preflight or `_preamble.md`.
8. **Preserve tone** — imperative, technical, precise. Don't soften.

---

## Execution

### Single skill mode

1. Read the skill file
2. Produce a **before/after line count** and a **summary of changes** (what was cut and why, 1 line per change)
3. Present the summary to the user with `AskUserQuestion`: "Apply these optimizations to {skill-name}?"
4. On approval, write the optimized file

### Batch mode (no argument)

1. Read all skill files, sorted by line count descending (biggest bloat first)
2. Skip files under 80 lines — they're already lean
3. For each skill over the threshold, produce the before/after line count and change summary
4. Present a single consolidated summary table to the user:

```
| Skill | Before | After | Reduction | Key changes |
|-------|--------|-------|-----------|-------------|
```

5. Ask: "Apply all optimizations, or select specific skills?"
6. On approval, write all approved files

---

## Constraints

- DO NOT change the logical behavior of any skill
- DO NOT remove error handling or edge case coverage
- DO NOT merge skills or move content between skills (beyond referencing `_preamble.md`)
- DO NOT touch `_preamble.md` or `_generation.md` themselves — they're the reference, not the target
- If a skill is already under 80 lines, report it as "Already lean — skipped" and move on
