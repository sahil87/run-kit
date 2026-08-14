# Intake: Reduce Code Comment Density

**Change**: 260814-z4x1-reduce-code-comment-density
**Created**: 2026-08-15

## Origin

Backlog item `[z4x1]` (2026-08-14), invoked via `/fab-new z4x1` (one-shot, no prior conversation):

> Reduce code comment density: comments should state constraints the code can't show — not narrate the next line, mirror sibling code, or cite change IDs. Two parts: (1) add the rule to fab/project/code-quality.md anti-patterns so apply/review stop generating mirror-prose; (2) one-time distillation sweep of the heaviest files (flair CSS block in globals.css, api/sessions.go+settings.go channel handlers, swatch-popover.tsx) — ~22% of PR 605's impl lines were comments.

## Why

1. **The pain point**: Pipeline-generated code carries heavy mirror-prose commenting — comments that restate what the next line does, describe sibling code, or cite the change/PR that introduced them. Measured in this repo today: `swatch-popover.tsx` is 147 comment lines out of 546 (~27%), `api/sessions.go` 43/262 (~16%), `api/settings.go` 32/249 (~13%), and the flair block in `globals.css` opens with a ~60-line rationale banner. The backlog cites ~22% of PR #605's implementation lines being comments.
2. **The consequence if unfixed**: Every future apply stage keeps generating the same density (nothing in `code-quality.md` discourages it), review never flags it, and readers must wade through narration to find the few comments that carry real constraints. Provenance citations (change IDs, PR numbers) also rot — git history already records provenance.
3. **Why this approach**: A rule in `fab/project/code-quality.md § Anti-Patterns` is the systemic fix — plan generation lifts anti-patterns into review acceptance items automatically, so both apply (generation-time) and review (enforcement-time) inherit it with one edit. The sweep is a one-time cleanup of the worst existing offenders so the new rule isn't contradicted by the codebase it points at. A repo-wide sweep is deliberately out of scope — the named files are the measured heavy hitters; the rule prevents new accumulation elsewhere.

## What Changes

### Part 1: Anti-pattern rule in `fab/project/code-quality.md`

Add one bullet to the `## Anti-Patterns` section (which currently ends at "Adding routes without explicit spec justification"):

```markdown
- Comment narration — comments must state constraints the code can't show (invariants, cross-file contracts, non-obvious "why"); never narrate the next line, mirror sibling code, restate what the diff/reviewer needs ("this preserves X"), or cite change IDs / PR numbers (git history owns provenance)
```

Exact wording may be lightly edited for fit, but all four prohibited forms (narrate next line, mirror sibling code, reviewer-directed prose, change-ID citations) and the positive criterion (constraints the code can't show) MUST survive. No change to `code-review.md` — anti-patterns already flow into review acceptance via plan generation (`_generation.md` step 6: one acceptance item per relevant anti-pattern).

### Part 2: One-time distillation sweep (comment-only edits, four targets)

For each target, walk every comment and apply the keeper criterion: **keep (possibly condensed) any comment stating a constraint the code can't show** — validation asymmetries, ordering/stacking tradeoffs, cross-file contracts, sentinel semantics; **delete or condense** narration, sibling-mirroring, and provenance citations. Zero executable-code changes.

- **`app/frontend/src/globals.css` — the flair overlays block (~lines 542–600 banner + per-keyframe comments)**: the banner's keeper content is the real design constraint (why source-order/stacking-context wins over the alternative, the ~8–16 stacking contexts cost argument, motion-only decoration hides under reduced-motion); the value-enumeration and section-mirroring prose condenses. Section navigation banners (`── Flair overlays ──` style rules) stay — they are navigational structure, not narration.
- **`app/backend/api/sessions.go` — channel handlers**: keepers include the permissive-vs-tightened validation asymmetry (rename SOURCE stays permissive so pre-existing spacey sessions can be renamed; new/renamed-TO names use the tightened rule) — condense, don't delete. The `sessionStringOption` descriptor doc comment keeps its contract ("adding a channel is a descriptor + route registration"); per-field narration ("decode extracts the value pointer…encoding/json semantics preserved exactly") condenses to the one non-obvious fact (unknown-key/case-fold behavior is deliberately preserved).
- **`app/backend/api/settings.go` — channel handlers**: same treatment as sessions.go (the two files share the per-row channel seam from PR #608).
- **`app/frontend/src/components/swatch-popover.tsx`** (~27% comment lines, the densest target): keepers include the legacy-value normalization contract ("1+3" highlights its family; dark-stored highlights the DARK swatch) and the `undefined` vs `null` sentinel semantics; the render-gating narration ("section renders only when callback present") deletes — the conditional JSX shows it.
- **Functional comment markers are preserved everywhere**: `review-ignore` suppressions, lint/ts directives, the deliberate NUL-join note in `session-tiles.tsx` (not a sweep target, listed as the class of thing that must survive if encountered), and Go doc comments on exported identifiers (condense but keep — `go vet`/doc conventions expect them).

### Verification

Comment-only sweep still runs the standard gates: `go test ./...` (backend), `npx tsc --noEmit` (frontend), and the existing colocated unit tests (`swatch-popover.test.tsx`) — proving no executable line moved. No new tests: there is no behavior to test; the rule addition is config prose.

## Affected Memory

None — comment-only code edits plus a project-config (`fab/project/code-quality.md`) rule addition. No spec-level behavior changes, so no memory files are created, modified, or removed.

## Impact

- `fab/project/code-quality.md` — one anti-pattern bullet (systemic; affects every future apply/review)
- `app/frontend/src/globals.css` — flair block comments only
- `app/backend/api/sessions.go`, `app/backend/api/settings.go` — channel-handler comments only
- `app/frontend/src/components/swatch-popover.tsx` — comments only
- No API, route, dependency, or behavior changes; no test-file changes expected

## Open Questions

None — the backlog item names the rule, the target file for it, and the sweep targets explicitly.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Anti-pattern wording lifts the backlog's own criterion (constraints the code can't show; no next-line narration, sibling mirroring, reviewer-directed prose, or change-ID citations) | Backlog text states the rule near-verbatim; trivially editable later | S:90 R:95 A:90 D:90 |
| 2 | Certain | Rule lands in `code-quality.md § Anti-Patterns` only; `code-review.md` untouched | Backlog names the file+section explicitly; plan generation already lifts anti-patterns into review acceptance | S:90 R:90 A:85 D:85 |
| 3 | Certain | Sweep is comment-only — zero executable-code changes, verified by existing gates (go test, tsc, unit tests) | "Distillation sweep" of comments by definition; behavior preservation is the obvious safety contract | S:85 R:90 A:95 D:90 |
| 4 | Confident | Sweep scope is exactly the four named files; no repo-wide sweep | Backlog names "the heaviest files" and lists them; the rule handles future accumulation elsewhere | S:80 R:70 A:75 D:70 |
| 5 | Confident | Keeper criterion is qualitative (per-comment constraint test), no numeric density target | ~22% is cited as evidence, not a target; a numeric quota would incentivize deleting keeper comments | S:70 R:85 A:75 D:65 |
| 6 | Confident | Functional/navigational comments survive: review-ignore markers, lint directives, Go exported-identifier doc comments (condensed), CSS section banners | These carry tooling or navigation function, not narration; standard convention | S:65 R:85 A:80 D:70 |
| 7 | Confident | No memory updates (Affected Memory: none) | Template rule: implementation-only changes don't need memory updates; nothing spec-level changes | S:70 R:80 A:85 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
