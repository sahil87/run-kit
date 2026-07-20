# Plan: Host / tmux Server Vocabulary Rename

**Change**: 260715-zs1y-host-tmux-server-rename
**Intake**: `intake.md`

## Requirements

<!-- Vocabulary rename: "Cockpit" → "Host", "Server Cabin" → "tmux Server", across
     UI copy, internal identifiers, comments, tests, and docs. Two new in-page
     headings are the only behavior change. Requirements grouped by surface. -->

### UI: Display Copy

#### R1: Top-bar page-type constants and headings
The top-bar page-type prefix constants SHALL be renamed in both identifier and value: `CABIN_PREFIX = "Server Cabin:"` → `TMUX_SERVER_PREFIX = "tmux Server:"` and `COCKPIT_SOLO = "Cockpit"` → `HOST_SOLO = "Host"`. These constants drive both the center heading and the hierarchy dropdown, so both surfaces MUST render the new copy from the single source. `WINDOW_PREFIX`/`BOARD_PREFIX` are unchanged.

- **GIVEN** the terminal route (`/$server/$window`)
- **WHEN** the hierarchy dropdown (`▾`) is opened
- **THEN** its ancestor items read `tmux Server: <server>` and `Host`
- **AND** the `/$server` center heading reads `tmux Server: <server>` and the `/` center heading reads solo `Host`

#### R2: Command-palette navigation labels, ids, and handlers
The palette ancestor-navigation entries SHALL read `Go: tmux Server` (was `Go: Server Cabin`) and `Go: Host` (was `Go: Cockpit`). Because the intake's §5 internal-vocabulary rename and the R8 zero-hits gate leave no `cockpit`/`cabin` token anywhere in `app/frontend/src`, the entry ids (`go-server-cabin` → `go-tmux-server`, `go-cockpit` → `go-host`) and the handler keys (`onServerCabin` → `onTmuxServer`, `onCockpit` → `onHost`) SHALL also be renamed. Navigation targets (the `navigate({...})` calls) are unchanged.

- **GIVEN** the command palette on a terminal route
- **WHEN** the navigation entries are built
- **THEN** the labels read `Go: tmux Server` and `Go: Host`, the ids are `go-tmux-server`/`go-host`, the handler keys are `onTmuxServer`/`onHost`, and the navigation targets are unchanged

#### R3: Titles and aria-labels
All `title`/`ariaLabel` attributes in the top bar carrying old vocabulary SHALL be updated: brand home link `title="Cockpit"` → `"Host"`; left server crumb `title="Server Cabin"` → `"tmux Server"`; root-mode heading `ariaLabel={`Server Cabin ${server}`}` → `` `tmux Server ${server}` ``; solo heading `ariaLabel="Cockpit"` → `"Host"`. The apply sweep MUST re-grep `top-bar.tsx` (including any strings PR #368's overflow chevron menu added) rather than trust an enumeration.

- **GIVEN** the top bar in any mode
- **WHEN** its title/aria-label attributes are read
- **THEN** none contains "Cockpit" or "Server Cabin"; the brand title is "Host", the server crumb title is "tmux Server", the root heading aria-label is `tmux Server <server>`, and the solo heading aria-label is "Host"

### UI: New In-Page Headings

#### R4: Host Overview heading on `/`
The Host page (`/`, `host-overview-page.tsx` per R6) SHALL render a page-level heading **"Host Overview"** at the top of the scrollable content, above the HOST HEALTH zone. It MUST reuse the existing heading vocabulary (`SectionHeading` from `components/section-heading.tsx`, which composes the typed-sweep `TypedLabel` and already respects `prefers-reduced-motion`). No new heading style is invented.

- **GIVEN** the `/` route
- **WHEN** the page renders
- **THEN** a heading with accessible name "Host Overview" is present above the "Host Health" zone heading
- **AND** under `prefers-reduced-motion` the heading is static (inherited from SectionHeading/TypedLabel behavior)

#### R5: tmux Server Overview heading on `/$server`
The tmux Server page (`/$server`, the `SessionTiles` view) SHALL render a page-level heading **"tmux Server Overview"** at the top of its main content, above the "Sessions" section heading. It MUST reuse `SectionHeading` (same treatment as R4). The heading renders only in the no-window `/$server` view (SessionTiles), not on the terminal route.

- **GIVEN** the `/$server` route with no window selected
- **WHEN** `SessionTiles` renders
- **THEN** a heading with accessible name "tmux Server Overview" is present above the "Sessions" section heading
- **AND** navigating into a window (`/$server/$window`) does not render this heading (SessionTiles is not mounted there)

### Internal: Identifiers

#### R6: Component and file rename
`ServerListPage` SHALL be renamed to `HostOverviewPage`; its file `server-list-page.tsx` → `host-overview-page.tsx` and test `server-list-page.test.tsx` → `host-overview-page.test.tsx`. All imports/route registrations SHALL be updated. `ServerShell` keeps its name (already correct under the new vocabulary).

- **GIVEN** the codebase after rename
- **WHEN** `ServerListPage` / `server-list-page` is searched
- **THEN** no references remain; the component is `HostOverviewPage` in `host-overview-page.tsx` and the build/typecheck passes

#### R7: Mode-string rename
The page-mode string unions SHALL rename `"cockpit"` → `"host"` and `"root"` → `"server"` everywhere they name a page mode: `TopBarMode` and `NavMode` type unions, the `HierarchyDropdown` `mode` prop type, `app.tsx` mode derivation, `buildNavActions` call-site mode argument, palette-nav mode comparisons, and all `mode === …` / `mode = …` page-mode comparisons. `"terminal"`/`"board"` are unchanged. Non-page-mode `"root"` occurrences (the DOM element id in `main.tsx`, the `"root"` keybinding group in `keyboard-shortcuts.tsx`) MUST NOT be touched.

- **GIVEN** the mode unions and derivations
- **WHEN** a page mode is assigned or compared
- **THEN** `"host"` replaces `"cockpit"` and `"server"` replaces `"root"` consistently across `top-bar.tsx`, `app.tsx`, and `palette-nav.ts`
- **AND** `main.tsx`'s `getElementById("root")` and `keyboard-shortcuts.tsx`'s `groupBindings(bindings, "root")` are unchanged

### Internal: Comments/Prose

#### R8: Frontend comment/prose sweep
All "Cockpit"/"Cabin" occurrences in comments and non-display prose across `app/frontend/src/` SHALL be replaced with the new vocabulary, choosing "Host"/"Host page"/"host overview" for Cockpit and "tmux Server"/"tmux Server page" for Server Cabin per surrounding context. This includes `router.tsx`, `waiting.ts`, `session-context.tsx`, `use-server-reorder.ts`, `use-board-list-reorder.ts`, `palette-version.ts`, `top-bar-slot-context.tsx`, `waiting-badge.tsx`, `sidebar/server-panel.tsx`, `app.tsx`, `server-list-page.tsx` (renamed), and any comment sites the mode/const renames pass through.

- **GIVEN** `app/frontend/src/`
- **WHEN** a case-insensitive grep for `cockpit`/`cabin` is run (excluding fab/docs-memory)
- **THEN** zero hits remain

#### R9: Backend comment sweep (comments only)
All "Cockpit"/"Cabin" occurrences in Go comments SHALL be replaced with the new vocabulary. Files: `api/servers.go`, `api/boards.go`, `api/sse.go`, `api/sse_test.go`, `api/sse_subscriber_test.go`. No behavior, no identifiers, no string literals change — comments only ("Cockpit host-console" → "Host host-console"/"Host page" per context).

- **GIVEN** `app/backend/`
- **WHEN** a grep for `Cockpit`/`Cabin` is run
- **THEN** zero hits remain and no non-comment line changed

### Docs & Governance

#### R10: Constitution Principle IV amendment
Constitution Principle IV route-name list SHALL read "Host Overview `/`, tmux Server `/$server`" (was "Cockpit `/`, Server Cabin `/$server`"). The governance block version SHALL bump 1.4.0 → 1.5.0 and Last Amended SHALL be set to the apply date (2026-07-15).

- **GIVEN** `fab/project/constitution.md`
- **WHEN** Principle IV and the governance block are read
- **THEN** route names use the new vocabulary, version is 1.5.0, and Last Amended is 2026-07-15

#### R11: Project context + spec/wiki sweep
`fab/project/context.md` top-bar/heading descriptions and the spec files `docs/specs/status-pyramid.md`, `docs/specs/window-views.md` SHALL be updated to the new vocabulary for run-kit's own pages. `docs/wiki/competitive-landscape.md` is **out of scope**: every "Cockpit" in it names the Red Hat product (the external competitor), not run-kit's page — renaming would falsify the competitive analysis.

- **GIVEN** the docs sweep
- **WHEN** `context.md`, `status-pyramid.md`, `window-views.md` are read
- **THEN** run-kit page references use "Host"/"tmux Server"; `competitive-landscape.md` is unchanged (its "Cockpit" = Red Hat product)
<!-- assumed: competitive-landscape.md excluded from the doc sweep — all its "Cockpit" mentions are the Red Hat web console (an external product used as a competitor + the "Cockpit for the agent era" tagline), not run-kit's page. The intake listed the wiki as a target but the actual content is entirely about the external product; renaming falsifies it. -->

### Tests

#### R12: Unit-test copy and mode-string updates
The unit tests `top-bar.test.tsx`, `palette-nav.test.ts`, and `host-overview-page.test.tsx` (renamed from `server-list-page.test.tsx`) SHALL be updated: copy assertions (`Server Cabin`/`Cockpit` → `tmux Server`/`Host`), mode-string literals (`"cockpit"`/`"root"` → `"host"`/`"server"`), and aria-label queries. `boards-section.test.tsx` and `session-context.test.tsx` comment mentions SHALL be swept (R8).

- **GIVEN** the frontend unit suite
- **WHEN** `just test-frontend` runs
- **THEN** all updated tests pass and no assertion references old vocabulary

#### R13: E2E spec + companion updates
Every e2e `.spec.ts` under `app/frontend/tests/` that references old vocabulary SHALL be updated (heading-text assertions, prose), AND its sibling `.spec.md` companion SHALL be updated in the same commit (constitution: Test Companion Docs). Affected: `top-bar-persistence`, `window-heading`, `board-list-reorder`, `server-reorder` (`.spec.md`), `top-bar-overlap`, `host-health-home` (`.spec.md`). New assertions for the two in-page headings ("Host Overview", "tmux Server Overview") SHALL be added to the relevant page specs (`window-heading` for the headings; `host-health-home` for Host Overview if it exercises `/`).

- **GIVEN** the affected e2e specs
- **WHEN** `just test-e2e` runs the affected specs
- **THEN** they pass against the renamed copy, each edited `.spec.ts` has a matching `.spec.md` update, and the two new headings are asserted

### Non-Goals

- URLs / route params unchanged (`/`, `/$server`, the `$server` param).
- `fab/changes/` archives, git history, old PR titles — untouched.
- `Window:` / `Board:` prefixes and Board vocabulary — unchanged.
- `TMUX SERVERS` all-caps zone label — stays (style-uppercase; lowercase "tmux" applies to title/sentence-case copy only).
- `RK_HOST` env var — unrelated ("host" = bind address); untouched.
- `docs/memory/` content — owned by the hydrate stage, not apply.
- `main.tsx` DOM `"root"` id and `keyboard-shortcuts.tsx` `"root"` keybinding group — not page-mode strings.
- `docs/wiki/competitive-landscape.md` — its "Cockpit" is the external Red Hat product.

### Design Decisions

1. **Two new headings reuse `SectionHeading`, mounted at the top of each page's scroll container**: "Host Overview" as the first child inside the `overflow-y-auto` container in `host-overview-page.tsx` (above the Host Health `<section>`); "tmux Server Overview" as the first child of the scroll area in `SessionTiles` (above the "Sessions" `SectionHeading`). — *Why*: SectionHeading is the established page/section heading idiom, already bracket+typed-sweep styled and reduced-motion-safe; the intake forbids inventing a new style. — *Rejected*: a distinct `PageHeading`-style `<h1>` (the retired PageHeading row was deliberately removed in 260704-pr0p; reintroducing it fights the current design).

2. **Lowercase "tmux" in title/sentence-case copy; all-caps `TMUX SERVERS` zone label kept**: heading reads "tmux Server Overview", constant value is `"tmux Server:"`. — *Why*: user wrote the lowercase forms; official tmux styling; the zone label is style-uppercased. — *Rejected*: "Tmux"/"TMUX" in sentence copy.

3. **Palette entry ids AND handler keys renamed with the labels (`go-tmux-server`/`go-host`, `onTmuxServer`/`onHost`)**: the shipped implementation renames ids and handlers, not labels alone. — *Why*: intake §5's internal-vocabulary rename plus the R8 zero-hits gate leave no `cockpit`/`cabin` token in `app/frontend/src`; keeping old ids would fail the verification grep (see plan Assumption #1, R2). Navigation targets unchanged. — *Rejected*: labels-only rename (an earlier draft of this decision — contradicted the zero-hits gate and was superseded during apply). <!-- review 260715 c1 should-fix: DD3 text updated to match R2 + shipped code -->

## Tasks

### Phase 1: Core Constants & Mode Strings

- [x] T001 In `app/frontend/src/components/top-bar.tsx`, rename constants `CABIN_PREFIX = "Server Cabin:"` → `TMUX_SERVER_PREFIX = "tmux Server:"` and `COCKPIT_SOLO = "Cockpit"` → `HOST_SOLO = "Host"` (defs ~:1199-1200) and every reference (~:288 `CABIN_PREFIX`, ~:293 `COCKPIT_SOLO`, ~:873 `prefix={CABIN_PREFIX}`, ~:886 `name={COCKPIT_SOLO}`). <!-- R1 -->
- [x] T002 In `app/frontend/src/components/top-bar.tsx`, rename page-mode strings in the `TopBarMode` union (:24), the `HierarchyDropdown` `mode` prop type (:278), the registry `modes:` arrays (~:546-572), the `HierarchyDropdown mode="root"` prop (:876), and the `mode === "root"` (:867) / `mode === "cockpit"` (:881) / `mode !== "cockpit"` (:414) comparisons: `"cockpit"` → `"host"`, `"root"` → `"server"`. Leave `"terminal"`/`"board"`. <!-- R7 -->
- [x] T003 [P] In `app/frontend/src/lib/palette-nav.ts`, update labels `Go: Server Cabin` → `Go: tmux Server` (:60) and `Go: Cockpit` → `Go: Host` (:67) — ids/targets unchanged; rename the `NavMode` union members `"cockpit"` → `"host"`, `"root"` → `"server"` (:31) and the `mode === "root"` comparison (:64). <!-- R2 R7 -->
- [x] T004 In `app/frontend/src/app.tsx`, update the mode derivation `mode = "cockpit"` (:238, :242) → `"host"` and `mode = "root"` (:241) → `"server"`, and the `buildNavActions(windowParam ? "terminal" : "root", …)` call (:1658) → `"server"`. <!-- R7 -->

### Phase 2: Titles, Aria-Labels, Component Rename

- [x] T005 In `app/frontend/src/components/top-bar.tsx`, update attributes: brand `title="Cockpit"` (:689) → `"Host"`; server crumb `title="Server Cabin"` (:745) → `"tmux Server"`; root heading `ariaLabel={`Server Cabin ${server}`}` (:875) → `` `tmux Server ${server}` ``; solo `ariaLabel="Cockpit"` (:888) → `"Host"`. Re-grep the whole file (incl. PR #368 overflow-menu strings) for any remaining old-vocab title/aria/label. <!-- R3 -->
- [x] T006 Rename `app/frontend/src/components/server-list-page.tsx` → `host-overview-page.tsx` and the component `ServerListPage` → `HostOverviewPage`; rename `server-list-page.test.tsx` → `host-overview-page.test.tsx`. Update all imports/route registrations (`router.tsx`, `app.tsx`, any barrel). Use `git mv` to preserve history. <!-- R6 --> <!-- rework: review cycle 1 — A-006 "no references remain" fails: 3 stale prose refs in spec companions — host-health-home.spec.md:4 (ServerListPage), sidebar-server-coupling.spec.md:74 (ServerListPage), board-list-reorder.spec.md:19 (server-list-page.test.tsx) -->

### Phase 3: New In-Page Headings

- [x] T007 In `host-overview-page.tsx` (renamed), add a page-level `SectionHeading label="Host Overview"` as the first child inside the `overflow-y-auto` scroll container (before the Host Health `<section>`, ~:239-244). Reuse the existing `SectionHeading` import; keep the `mb-*` rhythm consistent with the zone headings. <!-- R4 -->
- [x] T008 In `app/frontend/src/components/session-tiles/session-tiles.tsx`, add a page-level `SectionHeading label="tmux Server Overview"` as the first child of the scroll area (before the `SectionHeading label="Sessions"`, ~:88). Reuse the existing `SectionHeading` import. <!-- R5 -->

### Phase 4: Comment / Prose Sweep (source)

- [x] T009 [P] Sweep all remaining "Cockpit"/"Cabin" comment/prose occurrences in `app/frontend/src/` (router.tsx, waiting.ts, session-context.tsx, use-server-reorder.ts, use-board-list-reorder.ts, palette-version.ts, top-bar-slot-context.tsx, waiting-badge.tsx, sidebar/server-panel.tsx, app.tsx, top-bar.tsx, host-overview-page.tsx) → "Host"/"tmux Server" per context. Verify with `grep -rin "cockpit\|cabin" app/frontend/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'` returning zero. <!-- R8 -->
- [x] T010 [P] Sweep "Cockpit" Go comments in `app/backend/api/{servers,boards,sse,sse_test,sse_subscriber_test}.go` → "Host" per context (comments only; no identifier/literal changes). Verify `grep -rin "cockpit\|cabin" app/backend --include='*.go'` returns zero. <!-- R9 -->

### Phase 5: Docs & Governance

- [x] T011 [P] In `fab/project/constitution.md`, update Principle IV route names (:15) "Cockpit `/`, Server Cabin `/$server`" → "Host Overview `/`, tmux Server `/$server`"; bump governance (:51) version 1.4.0 → 1.5.0 and Last Amended → 2026-07-15. <!-- R10 -->
- [x] T012 [P] In `fab/project/context.md` (:93) and `docs/specs/status-pyramid.md` (:269-270), `docs/specs/window-views.md` (:81,:148,:154,:176), replace run-kit page references "Cockpit"/"Server Cabin" → "Host"/"tmux Server". Do NOT touch `docs/wiki/competitive-landscape.md` (external Red Hat product). <!-- R11 -->

### Phase 6: Tests

- [x] T013 Update `app/frontend/src/components/top-bar.test.tsx`: copy assertions (`Server Cabin`/`Cockpit` → `tmux Server`/`Host`), mode-string literals (`"cockpit"`/`"root"` → `"host"`/`"server"`), aria-label queries (`getByLabelText("Cockpit")` → `"Host"`, `"Server Cabin runkit"` → `"tmux Server runkit"`), menuitem names, describe/it titles. ALSO `app/frontend/src/components/update-chip.test.tsx:51` `mode="root"` → `mode="server"` (no cockpit/cabin vocab, but it renders `<TopBar mode>` and the mode-string rename (T002) invalidates the old literal — surfaced by the unit gate). <!-- R12 R7 -->
- [x] T014 [P] Update `app/frontend/src/lib/palette-nav.test.ts`: mode-string args (`"cockpit"`/`"root"`/`"board"` calls) and prose in it()-titles; entry ids `go-server-cabin`/`go-cockpit` are unchanged. <!-- R12 -->
- [x] T015 [P] Update the renamed `host-overview-page.test.tsx`: aria-label / heading assertions (`Cockpit` → `Host`), comment mentions, and add coverage that the "Host Overview" page heading renders. <!-- R12 R4 -->
- [x] T016 [P] Sweep comment mentions in `app/frontend/src/contexts/session-context.test.tsx` and `app/frontend/src/components/sidebar/boards-section.test.tsx` (R8 completeness for test files). <!-- R8 -->
- [x] T017 Update e2e `.spec.ts` + sibling `.spec.md` (same commit) for `window-heading`, `top-bar-persistence`, `board-list-reorder` (.spec.ts + .spec.md), `top-bar-overlap`, and the `.spec.md`-only `server-reorder` / `host-health-home`: rename heading-text assertions and prose to the new vocabulary. Add assertions for "Host Overview" (`/`) and "tmux Server Overview" (`/$server`) in `window-heading.spec.ts` + its `.spec.md`. <!-- R13 R4 R5 -->

### Phase 7: Verification

- [x] T018 Full-sweep verification: `grep -ri "cockpit\|cabin" app docs/specs docs/wiki fab/project --include='*.go' --include='*.ts' --include='*.tsx' --include='*.md'` returns only the intentional `docs/wiki/competitive-landscape.md` Red Hat-product hits (and nothing else). Then run gates: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, affected `just test-e2e`, `just build`. <!-- R6 R7 R8 R9 R12 R13 -->

## Execution Order

- Phase 1 (T001-T004) before Phase 2 (T005 depends on renamed constants being in place; T006 rename before T007's edit of the renamed file).
- T006 (file rename) must precede T007, T009's host-overview-page edits, and T015 (renamed test file).
- Phases 4-6 depend on Phases 1-3 (final identifiers/copy must exist before comments/tests reference them).
- T018 is last (verifies the whole sweep + runs gates).
- `[P]` tasks within a phase touch disjoint files and may run in parallel.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `top-bar.tsx` defines `TMUX_SERVER_PREFIX = "tmux Server:"` and `HOST_SOLO = "Host"`; the center heading and hierarchy dropdown both render from them.
- [x] A-002 R2: palette labels read `Go: tmux Server` / `Go: Host`; ids `go-tmux-server`/`go-host`, handlers `onTmuxServer`/`onHost`; navigation targets unchanged.
- [x] A-003 R3: no `title`/`ariaLabel` in `top-bar.tsx` contains "Cockpit"/"Server Cabin"; brand title "Host", crumb title "tmux Server", root heading aria `tmux Server <server>`, solo heading aria "Host".
- [x] A-004 R4: the `/` page renders a "Host Overview" `SectionHeading` above the Host Health zone.
- [x] A-005 R5: the `/$server` (SessionTiles) view renders a "tmux Server Overview" `SectionHeading` above the "Sessions" heading; the terminal route does not.
- [x] A-006 R6: `ServerListPage`/`server-list-page` no longer exist; the component is `HostOverviewPage` in `host-overview-page.tsx`; imports/routes updated; build passes. <!-- rework cycle 1: 3 stale refs fixed -->
- [x] A-007 R7: page-mode strings are `"host"`/`"server"` across `top-bar.tsx`/`app.tsx`/`palette-nav.ts`; `"terminal"`/`"board"` unchanged.
- [x] A-008 R10: constitution Principle IV uses new route names; version 1.5.0; Last Amended 2026-07-15.
- [x] A-009 R11: `context.md`, `status-pyramid.md`, `window-views.md` use new vocabulary for run-kit pages.

### Behavioral Correctness

- [x] A-010 R4: under `prefers-reduced-motion`, the "Host Overview" heading is static (SectionHeading/TypedLabel reduced-motion behavior inherited, not overridden).
- [x] A-011 R5: "tmux Server Overview" renders only in the no-window `/$server` view, not on `/$server/$window`.
- [x] A-012 R7: `main.tsx` `getElementById("root")` and `keyboard-shortcuts.tsx` `groupBindings(bindings, "root")` are unchanged (non-page-mode `"root"` preserved).

### Removal Verification

- [x] A-013 R8: `grep -rin "cockpit\|cabin" app/frontend/src --include='*.ts' --include='*.tsx'` (incl. tests) returns zero.
- [x] A-014 R9: `grep -rin "cockpit\|cabin" app/backend --include='*.go'` returns zero; no non-comment Go line changed.
- [x] A-015 R11: `grep -ri "cockpit\|cabin" app docs/specs fab/project` returns zero; the only remaining hits are the intentional Red Hat-product references in `docs/wiki/competitive-landscape.md`.

### Scenario Coverage

- [x] A-016 R13: affected e2e specs pass under `just test-e2e` against the renamed copy; each edited `.spec.ts` has a matching `.spec.md` update in the same commit. <!-- window-heading/top-bar-persistence/board-list-reorder/top-bar-overlap + host-health-home/server-reorder all pass; window-heading:435 (history arrows — untouched by this change) is a pre-existing flaky timeout, retry-passes in isolation, distinct from the vocabulary edits -->
- [x] A-017 R12: `just test-frontend` passes with updated copy/mode-string/aria assertions; new "Host Overview" page-heading test present. <!-- 76 files, 1300 tests pass -->


### Edge Cases & Error Handling

- [x] A-018 R7: the `"root"` → `"server"` rename does not break the `notFound` fallback (`mode = "host"`) or the `serverParam !== undefined → "server"` branch in `app.tsx`.

### Code Quality

- [x] A-019 Pattern consistency: the two new headings use the existing `SectionHeading` component and `mb-*` rhythm — no new heading component/style introduced.
- [x] A-020 No unnecessary duplication: constants remain the single source driving both center heading and hierarchy dropdown (no divergent literals reintroduced).
- [x] A-021 No magic strings: renamed mode strings and constants are consistent across all unions/switches (no stray `"cockpit"`/`"root"` page-mode literal left).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change renames and replaces in place; the code it superseded (`server-list-page.tsx`, `server-list-page.test.tsx`, the `go-server-cabin`/`go-cockpit` palette ids and `onServerCabin`/`onCockpit` handler keys) was deleted within the change itself, and no other existing code became redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Palette entry ids + handler keys renamed too (`go-tmux-server`/`go-host`, `onTmuxServer`/`onHost`), not just labels | The R8 zero-hits gate + intake §5 internal-vocab rename leave NO `cockpit`/`cabin` token in `app/frontend/src`; keeping the old ids/handlers would fail the verification grep. Targets unchanged | S:80 R:75 A:85 D:80 |
| 2 | Confident | `competitive-landscape.md` excluded from the doc sweep — every "Cockpit" there is the Red Hat product / tagline, not run-kit's page | Ground-truth read of the file: all mentions are the external competitor; intake's core rule targets the invented metaphor, not a real external product; renaming falsifies the analysis | S:80 R:70 A:80 D:75 |
| 3 | Certain | New headings mount as `SectionHeading` at the top of each page's scroll container (above Host Health / above Sessions) | Intake mandates reusing the SectionHeading/typed-sweep family and forbids inventing a style; SectionHeading is the established page/section idiom and is reduced-motion-safe | S:75 R:85 A:90 D:80 |
| 4 | Certain | Non-page-mode `"root"` (DOM id in main.tsx, keybinding group in keyboard-shortcuts.tsx) NOT renamed | Ground-truth grep shows these are unrelated to the page-mode union; intake scopes the rename to mode unions/switches | S:95 R:90 A:95 D:95 |
| 5 | Certain | Lowercase "tmux" in heading/copy/constant value; all-caps `TMUX SERVERS` zone label kept | Intake assumption #11 (user-written lowercase forms; zone label is style-uppercase) | S:90 R:95 A:90 D:90 |
| 6 | Confident | "Host Overview" test coverage added to `host-overview-page.test.tsx`; "Host Overview"/"tmux Server Overview" e2e assertions to `window-heading` specs | Intake §8 "new coverage" + constitution Test Companion Docs; window-heading already exercises both page headings | S:75 R:85 A:85 D:75 |

6 assumptions (3 certain, 3 confident, 0 tentative).
