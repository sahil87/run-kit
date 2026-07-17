# Intake: Bind Constitution to sahil87 Toolkit Standards

**Change**: 260717-zn03-constitution-toolkit-standards
**Created**: 2026-07-18

## Origin

One-shot `/fab-new` invocation with a fully-specified task (no prior conversation). Raw input:

> Task: Amend this repo's fab constitution to bind it to the sahil87 toolkit standards.
>
> This repo is part of the sahil87 toolkit. The toolkit publishes binding, producer-facing standards — CLI design principles plus mechanical contracts (machine-readable help output, README/docs-site structure, and others over time). They are canonically authored in the sahil87/shll repository's docs/site/standards/ tree, rendered on https://shll.ai, and readable offline via the `shll standards` command. This change adds a constitution article so every future pipeline run in this repo loads and enforces the obligation.
>
> Make this change:
>
> 1. In fab/project/constitution.md, add a new article under Additional Constraints (create the section if this constitution lacks it, matching the file's existing structure):
>
>    ### Toolkit Standards
>
>    This tool is part of the sahil87 toolkit and MUST conform to the toolkit's published standards. The standards are enumerated by running `shll standards` — each entry names what it governs; read one with `shll standards <name>`. Before changing the CLI surface, help output, README.md, or docs/site/, the change MUST be checked against the standards governing that surface. If shll is unavailable, the canonical sources are the sahil87/shll repository's docs/site/standards/ tree (rendered on https://shll.ai). Standards added or revised there bind this repo without further amendment to this constitution.
>
> 2. Bump the constitution's Last Amended date (and version, per this file's own governance line).
> 3. Deliberate constraint: do NOT copy standard names, counts, or per-standard URLs into the constitution — `shll standards` is the enumeration, and the article must stay correct as standards evolve.
>
> Ship per this repo's normal flow (docs-type fab change → PR). Nothing else is in scope — no conformance fixes in this change.

## Why

1. **Problem**: run-kit is part of the sahil87 toolkit (the README already links https://shll.ai and installs via the shll meta-CLI), and the toolkit publishes binding, producer-facing standards — CLI design principles plus mechanical contracts (machine-readable help output, README/docs-site structure, more over time). Nothing in this repo's fab governance layer obligates pipeline runs to check those standards. An agent changing the CLI surface, help output, README.md, or docs site has no loaded instruction to consult them.
2. **Consequence if unfixed**: silent drift — each CLI/docs change is made against local conventions only, and the repo diverges from the toolkit's published contracts until someone notices by hand.
3. **Why this approach**: `fab/project/constitution.md` is the always-load layer for every pipeline stage (every skill and every dispatched subagent reads it before acting), so a constitution article is the one place where the obligation is guaranteed to be in context for every future run. Weaker alternatives were implicitly rejected by the task framing: a README note or `context.md` paragraph is descriptive, not binding — the constitution is the MUST/SHALL governance surface. The article deliberately references `shll standards` as the enumeration rather than listing standards, so it stays correct as the toolkit adds or revises standards without re-amending this file.

## What Changes

### `fab/project/constitution.md`: new "Toolkit Standards" article

The `## Additional Constraints` section **already exists** in this constitution (articles: Test Integrity, Test Companion Docs, Process Execution, Self-Improvement Safety) — no section creation is needed. Append the new article as the **last article** of that section, immediately after `### Self-Improvement Safety` and before `## Governance`, matching the file's existing structure (`###` heading, prose body with RFC-2119 keywords, em-dash typography):

```markdown
### Toolkit Standards
This tool is part of the sahil87 toolkit and MUST conform to the toolkit's published standards. The standards are enumerated by running `shll standards` — each entry names what it governs; read one with `shll standards <name>`. Before changing the CLI surface, help output, README.md, or docs/site/, the change MUST be checked against the standards governing that surface. If shll is unavailable, the canonical sources are the sahil87/shll repository's docs/site/standards/ tree (rendered on https://shll.ai). Standards added or revised there bind this repo without further amendment to this constitution.
```

The text is the user's provided article verbatim, with the input's shell-flattened `--` rendered as em-dashes (`—`) to match the file's existing typography. Note the body starts directly under the heading with no blank-line-separated lead-in, matching sibling articles.

### `fab/project/constitution.md`: governance line bump

Current governance line:

```markdown
**Version**: 1.5.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-15
```

New governance line:

```markdown
**Version**: 1.6.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-18
```

Version bumps MINOR (1.5.0 → 1.6.0) because a new article is added and no existing principle is changed or removed. Ratified date is untouched.

### Deliberate non-goals

- **No enumeration in the constitution**: do NOT copy standard names, counts, or per-standard URLs into the article — `shll standards` is the enumeration; the article must stay correct as standards evolve. Reviewers should treat any hardcoded standard list in the diff as a defect.
- **No conformance fixes**: this change does not audit or fix the CLI surface, help output, README.md, or docs against the standards. Binding only.
- No other file changes — constitution.md is the entire diff.

## Affected Memory

None — this is a governance amendment to `fab/project/constitution.md`, not a spec-level system-behavior change. The constitution is itself part of the always-load layer, so its content needs no memory duplication.

## Impact

- **Files**: `fab/project/constitution.md` only (one new article + governance-line bump). No source code, no tests, no README/docs changes.
- **Process**: every future pipeline run in this repo loads the obligation; changes touching the CLI surface, help output, README.md, or docs/site/ must be checked against the standards enumerated by `shll standards` (canonical fallback: the sahil87/shll repo's docs/site/standards/ tree, rendered on https://shll.ai).
- **Change type**: docs (explicitly pinned — governance/documentation change, no runtime behavior).

## Open Questions

None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Insert the article text verbatim as provided in the task | Exact wording supplied by the user; no rephrasing | S:95 R:90 A:100 D:95 |
| 2 | Certain | Render the input's shell-flattened `--` as em-dashes (`—`) | Constitution uses em-dashes throughout; the `--` is a command-line artifact, not intended typography | S:70 R:95 A:90 D:85 |
| 3 | Certain | Append as the last article under the existing `## Additional Constraints` (after Self-Improvement Safety) | Section already exists; articles accrete at the end; no semantic ordering rule in the file | S:80 R:90 A:90 D:80 |
| 4 | Confident | Version bump 1.5.0 → 1.6.0 (MINOR) | Governance line records semver but states no bump policy; constitution-semver convention (new article/section = MINOR, wording fix = PATCH) is the clear front-runner and the user delegated to "per this file's own governance line" | S:75 R:90 A:70 D:70 |
| 5 | Certain | Pin `change_type: docs` explicitly via `fab status set-change-type` | User stated "docs-type fab change"; explicit source survives `fab status refresh` re-inference (inference had defaulted to feat) | S:90 R:85 A:95 D:90 |
| 6 | Certain | Affected memory: none | Governance amendment, not spec-level system behavior; constitution is already always-loaded | S:80 R:85 A:90 D:85 |
| 7 | Certain | Scope excludes conformance fixes and any standard names/counts/per-standard URLs in the article | Explicit deliberate constraints in the task | S:95 R:90 A:100 D:95 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
