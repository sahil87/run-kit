# Plan: Canonical Route Page Names

**Change**: 260702-nuup-route-page-names
**Intake**: `intake.md`

## Requirements

<!-- Documentation / naming-convention change. No runtime behavior. Requirements
     cover the three durable recording sites: memory, the router glossary comment,
     and the constitution's Principle IV route list. -->

### Naming Vocabulary: Canonical route→name set

#### R1: Canonical page-name vocabulary recorded in `ui-patterns` memory
The `docs/memory/run-kit/ui-patterns.md` memory file SHALL record the canonical spoken name for each run-kit route, colocated with the existing URL Structure content. The mapping SHALL be: `/` → **Cockpit** (`ServerListPage`), `/$server` → **Server Cabin** (`ServerShell`), `/$server/$window` → **Terminal** (inherited layout, no dedicated component), `/board/$name` → **Board** (`BoardPage`), and the not-found fallback → **Not Found** (`NotFoundPage`). The `$server`/`$window`/`$name` segments SHALL be noted as route params, not literal path segments.

- **GIVEN** a contributor reading `ui-patterns.md` to understand run-kit's routes
- **WHEN** they reach the URL Structure content
- **THEN** they find a compact glossary mapping each route path to its canonical name
- **AND** the glossary sits within the existing URL Structure content, not as a disconnected new top-level section

#### R2: Glossary comment adjacent to the route tree in `router.tsx`
`app/frontend/src/router.tsx` SHALL carry a brief glossary comment block next to the `routeTree` definition listing each route → canonical name. This SHALL be a comment only — no code, route, or component-name changes anywhere in the file.

- **GIVEN** a developer reading `router.tsx` to understand the route definitions
- **WHEN** they view the `routeTree` (the `rootRoute.addChildren([...])` call)
- **THEN** an adjacent comment names each route with its canonical spoken name
- **AND** the file's executable code (routes, components, params, exports) is byte-for-byte unchanged apart from the added comment

#### R3: Principle IV route list corrected in the constitution
`fab/project/constitution.md` Principle IV (Minimal Surface Area) SHALL replace the stale illustrative route parenthetical (`two routes (`/` redirect, `/$session/$window`)`) with the live route set expressed using the canonical names — Cockpit `/`, Server Cabin `/$server`, Terminal `/$server/$window`, Board `/board/$name`. The rest of Principle IV (the "New pages SHOULD only be added…" guidance and "Resist feature creep") and the principle's normative minimal-surface intent SHALL remain unchanged. The Governance `Last Amended` date SHALL be bumped to 2026-07-02.

- **GIVEN** the constitution's Principle IV, whose route list currently reads "two routes (`/` redirect, `/$session/$window`)"
- **WHEN** a reader consults it against the live route tree
- **THEN** the parenthetical names the real five-route set (four registered routes plus the not-found fallback) using the canonical names
- **AND** the count ("two routes") and the never-existed `/$session/$window` terminal path are both corrected
- **AND** the Governance `Last Amended` date reads 2026-07-02
- **AND** the principle's normative intent (minimal surface area, resist feature creep) is untouched

### Non-Goals

- Renaming any component (e.g. `ServerShell` → `ServerCabin`) — the vocabulary is spoken/documentation only; component identifiers are unchanged.
- Any route, path, param, or runtime behavior change — this change adds no route and alters no rendering.
- Changing Principle IV's normative rule or forcing a major/minor constitution version bump — the edit is a factual correction to an illustrative list.

### Design Decisions

1. **Glossary placement in memory**: a compact table immediately after the URL Structure route table — *Why*: colocates the names with the route table they name, avoids restructuring the large file — *Rejected*: a new top-level `## Page Names` section (disconnects the names from the URL-structure docs that describe the same routes).
2. **Constitution version bump**: bump `Last Amended` date only; leave `Version 1.3.0` unchanged — *Why*: the constitution's own governance block distinguishes `Version` (semantic policy revisions) from `Last Amended` (any edit); this is a factual correction to an illustrative example, not a policy change, so it maps to a `Last Amended` bump with no version increment — *Rejected*: a patch bump to 1.3.1 (the change carries no normative delta, and the block has no established patch-level convention — see Assumptions #4).

## Tasks

### Phase 1: Documentation

- [x] T001 [P] Add a canonical page-name glossary table to `docs/memory/run-kit/ui-patterns.md`, colocated within the URL Structure content (immediately after the route table), mapping `/`→Cockpit, `/$server`→Server Cabin, `/$server/$window`→Terminal, `/board/$name`→Board, not-found→Not Found, with a note that `$server`/`$window`/`$name` are route params <!-- R1 -->
- [x] T002 [P] Add a comment-only glossary block next to the `routeTree` definition in `app/frontend/src/router.tsx` listing each route → canonical name; make zero code/route/component changes <!-- R2 -->
- [x] T003 [P] Correct Principle IV's stale route parenthetical in `fab/project/constitution.md` to the live route set using the canonical names, keeping the rest of the principle unchanged <!-- R3 -->
- [x] T004 Bump the Governance `Last Amended` date in `fab/project/constitution.md` to 2026-07-02 (leave `Version` and `Ratified` unchanged) <!-- R3 -->

### Phase 2: Index regeneration

- [x] T005 Run `fab memory-index` to regenerate memory indexes after editing `ui-patterns.md` <!-- R1 -->

## Execution Order

- T003 and T004 both edit `fab/project/constitution.md` (same file — run sequentially, not in parallel despite touching one file each).
- T005 depends on T001 (index regeneration must follow the memory edit).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `docs/memory/run-kit/ui-patterns.md` contains a glossary mapping all five routes to their canonical names (Cockpit / Server Cabin / Terminal / Board / Not Found), colocated with the URL Structure content, with the route-param note present
- [x] A-002 R2: `app/frontend/src/router.tsx` has a glossary comment adjacent to `routeTree` naming each route, and its executable code is unchanged apart from the added comment
- [x] A-003 R3: `fab/project/constitution.md` Principle IV's route parenthetical names the live route set using the canonical names, and the Governance `Last Amended` date is 2026-07-02

### Behavioral Correctness

- [x] A-004 R3: The corrected Principle IV no longer says "two routes" and no longer references the never-existed `/$session/$window` terminal path; the principle's normative minimal-surface intent and its remaining prose are unchanged

### Scenario Coverage

- [x] A-005 R2: `router.tsx` still typechecks / parses — the change is comment-only, introducing no syntax or code change (verified by the comment being the sole diff to executable content)

### Code Quality

- [x] A-006 Pattern consistency: The memory glossary table follows the existing `ui-patterns.md` table idiom; the `router.tsx` comment follows the file's existing comment style; the constitution edit matches its existing formatting
- [x] A-007 No unnecessary duplication: The vocabulary is stated once per site (memory, router comment, constitution) without redundant restatement; no existing documentation is duplicated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Zero test surface: comment + docs + constitution text have no runtime behavior to assert (intake Impact § Tests: none). The `router.tsx` change is comment-only, so no typecheck regression is possible; A-005 verifies this by inspection of the diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Canonical set: `/`=Cockpit, `/$server`=Server Cabin, `/$server/$window`=Terminal, `/board/$name`=Board, not-found=Not Found | Fixed and confirmed by the user live in-session (intake Assumption #1); apply carries it forward verbatim | S:95 R:80 A:95 D:95 |
| 2 | Certain | Comment + memory only; zero code/route/component-name changes, no tests | Intake Assumption #3 and the hard constraint that `router.tsx` is comment-only; renaming components was never requested | S:90 R:80 A:95 D:90 |
| 3 | Confident | Place the memory glossary as a compact table immediately after the URL Structure route table (within existing URL-structure content, not a new top-level section) | Intake Assumption #4 leaves exact placement to apply; colocating with the route table keeps related docs together and avoids restructuring the 1200-line file | S:75 R:85 A:80 D:75 |
| 4 | Confident | Bump `Last Amended` to 2026-07-02 only; leave `Version 1.3.0` unchanged (no patch bump to 1.3.1) | The Governance block separates `Version` (policy revisions) from `Last Amended` (any edit); this is a factual correction to an illustrative example with no normative delta, and the block shows no established patch-level convention, so the minimal correct action is a date bump with no version increment (intake Assumption #6 defers the semantics to apply) | S:70 R:85 A:75 D:75 |

4 assumptions (2 certain, 2 confident, 0 tentative).
