# Plan: Quake Terminal Rename

**Change**: 260912-nynf-quake-terminal-rename
**Intake**: `intake.md`

## Requirements

### Frontend: Identifier and file rename

#### R1: The naming map is applied to every surface identifier
Every identifier that names the drawer or the top-bar box SHALL take its new form per the intake's naming map: `OperatorConsole` → `QuakeTerminal`, `OperatorConsoleTongue` → `QuakeTerminalTongue`, `OperatorOmnibox` → `QuakeLauncher`, `requestOperatorConsole` / `OperatorConsoleRequest` / `isOperatorConsoleRequest` → `requestQuakeTerminal` / `QuakeTerminalRequest` / `isQuakeTerminalRequest`, `OPERATOR_CONSOLE_EVENT` (`"rk:operator-console"`) → `QUAKE_TERMINAL_EVENT` (`"rk:quake-terminal"`), `ConsoleMachineState` / `ConsoleSegment` / `ConsoleGeometry` / `ConsoleComposeState` → `QuakeMachineState` / `QuakeSegment` / `QuakeGeometry` / `QuakeComposeState`, and every remaining `Console`/`CONSOLE`/`console`-bearing helper for this surface → the `Quake`/`QUAKE`/`quake` form (`QUAKE_GEOMETRY_KEY`, `clampQuakeGeometry`, `readQuakeGeometry`, `useQuakeGeometry`, `useQuakeOpacity`, `cycleQuakeMachine`, `getQuakeMachineState`, `setQuakeMachineState`, `useQuakeMachineState`, `getQuakeMachineActivity`, `resolveQuakeServer`, `clearPendingQuakeRequest`, `drainPendingQuakeRequest`, `QUAKE_TERMINAL_ROOT_ATTR` = `"data-quake-terminal"`, `isQuakeTerminalTarget`, `resolveQuakeTerminalTarget`, `useQuakeTerminalContext`, `QuakeOpacityControl`, `launcherMorphed`, `quakeTerminalTabs`, `quakeTab`). Identifiers that name the operator as addressee (`OperatorContextChip`, `OperatorChatSubject`, `useOperatorCompose`, `setOperatorComposeText`, `sendOperatorMessage`, `attachOperatorFiles`, `findOperatorWindow`, `OperatorWindowTarget`, `ASK_OPERATOR_MIN_QUERY`, `OPERATOR_STATE_DOT`, `shouldShowAskOperatorRow`, `resolveFromOrigin`, `TerminalActivityTabs`) MUST NOT change. CSS classes `.rk-console-slide` / `.rk-console-closed` / `.rk-console-dragging` → `.rk-quake-slide` / `.rk-quake-closed` / `.rk-quake-dragging`.

- **GIVEN** the renamed tree
- **WHEN** `grep -rnE 'OperatorConsole|OperatorOmnibox|OPERATOR_CONSOLE|operatorConsole|omnibox|Omnibox|rk-console-|data-operator-console|rk:operator-console' app/frontend/src app/frontend/tests` runs
- **THEN** it returns zero matches
- **AND** `grep -rn 'OperatorContextChip\|useOperatorCompose\|findOperatorWindow' app/frontend/src` still matches at its current call sites

#### R2: Files are renamed with history preserved and imports follow
The nine source/test files SHALL be renamed with `git mv` to: `components/quake-terminal.tsx`, `components/quake-terminal.test.tsx`, `components/quake-launcher.tsx`, `components/quake-launcher.test.tsx`, `lib/quake-terminal.ts`, `lib/quake-terminal.test.ts`, `lib/palette/quake-terminal.ts`, `lib/palette/quake-terminal.test.ts`, `tests/e2e/quake-terminal.spec.ts`. Every import specifier (`@/components/operator-console`, `@/components/operator-omnibox`, `@/lib/operator-console`, `@/lib/palette/operator-console`, and relative forms) SHALL point at the new paths, including the two lazy imports in `app.tsx`. `components/operator-context-chip.tsx` and `operator-compose-dialog.tsx` keep their names.

- **GIVEN** the renamed tree
- **WHEN** `git log --follow --oneline -- app/frontend/src/lib/quake-terminal.ts` runs
- **THEN** it lists the pre-rename history of `lib/operator-console.ts`
- **AND** `just test-frontend` type-checks and passes with no unresolved module

#### R3: Test ids move with their selectors; flows are unchanged
The 12 `data-testid="operator-console…"` ids SHALL become `quake-terminal…` and the 4 `data-testid="operator-omnibox…"` ids (`operator-omnibox`, `-ghost`, `-input`, `-state`) SHALL become `quake-launcher…`. Every Vitest and Playwright selector that names them SHALL follow. Test steps, assertions, and intent comments describe the same behavior in the new vocabulary; no `test()` is added, removed, or re-sequenced. Per the Test Intent Comments constraint, each e2e `test()` JSDoc that mentions the old names is updated in the same commit, without change-ID citations.

- **GIVEN** the e2e specs `quake-terminal`, `window-heading`, `web-view-lens`, `status-bar`, `operator-pinned-row`, `operator-session-promotion`, `operator-compose`
- **WHEN** each runs via `just test-e2e <name>`
- **THEN** each passes with the same `test()` count as before the rename

### Frontend: Persisted per-viewer state stays continuous

#### R4: localStorage geometry/opacity keys rename with a legacy fallback
`lib/quake-terminal.ts` SHALL export `QUAKE_GEOMETRY_KEY = "runkit-quake-terminal-geometry"`, `QUAKE_OPACITY_KEY = "runkit-quake-terminal-opacity"`, `LEGACY_QUAKE_GEOMETRY_KEY = "runkit-operator-console-geometry"`, `LEGACY_QUAKE_OPACITY_KEY = "runkit-operator-console-opacity"`. `readQuakeGeometry()` / `readQuakeOpacity()` SHALL read the new key and, only when it is absent (`getItem` returns `null`), read the legacy key through the same parse-and-clamp path; a corrupt value under either key degrades to the default. `writeQuakeGeometry()` / `writeQuakeOpacity()` SHALL write the new key and `removeItem` the legacy key (the `gui-posture.ts` `GUI_LEGACY_VIEW_KEY` precedent). The stored geometry shape `{heightVh, widthPx}` is unchanged.

- **GIVEN** `localStorage["runkit-operator-console-geometry"] = '{"heightVh":40,"widthPx":900}'` and no new key
- **WHEN** `readQuakeGeometry()` runs
- **THEN** it returns `{heightVh: 40, widthPx: 900}`
- **AND WHEN** `writeQuakeGeometry({heightVh: 41, widthPx: 900})` runs, **THEN** the new key holds the value and the legacy key is gone
- **AND GIVEN** both keys present, **THEN** the new key wins

#### R5: The ⌘J action id renames with a read-side override migration
The builtin at `keybindings.ts:318` SHALL become `actionId: "quake-terminal"`, `label: "Quake terminal"`, `description: "toggle the quake terminal (open+focus ⇄ closed)"`, `mapLabel: "quake"` (combo, tiers, scope, `ignoreInputs` unchanged). `parseOverrides()` SHALL map a stored `"operator-console"` entry onto `"quake-terminal"` when the parsed blob has no `"quake-terminal"` entry (a new-id entry always wins); the legacy id never appears in the returned `BindingOverrides`, so `writeStoredOverrides()` drops it on the next write. This is a read-side migration inside `parseOverrides`, not an `aliasOf` entry. The `app.tsx` handler map key and the `keybindings.test.ts` palette-id ↔ action-id agreement table use the new id.

- **GIVEN** `localStorage["runkit-keybindings"] = '{"operator-console":null}'`
- **WHEN** `readStoredOverrides()` runs
- **THEN** it returns `{"quake-terminal": null}` (⌘J stays disabled for that viewer)
- **AND GIVEN** `'{"operator-console":{"code":"KeyJ","tier":"cmd"},"quake-terminal":null}'`, **THEN** it returns `{"quake-terminal": null}`

### Frontend: User-facing labels

#### R6: Palette, aria, and settings labels rename; addressee copy stays
The palette builder SHALL emit `id: "quake-terminal"`, `label: "Operator: Open quake terminal"`; the segment rows SHALL emit ids `quake-terminal-list` / `quake-terminal-log` / `quake-terminal-tasks` with labels `Operator: Show cron list` / `Operator: Show cron log` / `Operator: Show tasks` unchanged. The drawer root and the mobile tongue SHALL carry `aria-label="Quake terminal"`; the header collapse button `aria-label="Collapse quake terminal"`. The settings row SHALL read `label="Quake terminal opacity"`, `sublabel="Desktop quake terminal background; 100% turns off the blur"`. The e2e `describe` title becomes `"Quake terminal"`. The following copy MUST NOT change: launcher placeholders `Ask the operator…` / `Ask…`; segment labels `Operator Terminal` · `Operator Tasks` · `Cron List` · `Cron Log`; the toast `already viewing the operator — nothing to open`; the `?tab=` / `?from=` search params and their values.

- **GIVEN** the desktop palette
- **WHEN** filtered by `Open quake terminal`
- **THEN** exactly one row `Operator: Open quake terminal` matches and selecting it lands the drawer open with the launcher focused
- **AND** no other palette label contains `quake`

#### R7: Every event-seam dispatcher moves to the renamed seam
All dispatchers of the document event — `app.tsx` (the ⌘J handler map, the palette Ask-operator fallback, the `?tab=` deep-link handoff), `lib/palette/quake-terminal.ts` (4 rows), `status-bar.tsx` (◷ chip), `top-bar-overflow-menu.tsx`, and the mobile tongue — SHALL call `requestQuakeTerminal` and the listener in `components/quake-terminal.tsx` SHALL subscribe to `QUAKE_TERMINAL_EVENT`. No dispatcher of the old event name remains anywhere in the repo.

- **GIVEN** the renamed tree
- **WHEN** `grep -rn 'rk:operator-console\|requestOperatorConsole' app/ docs/site docs/specs` runs
- **THEN** it returns zero matches

### Docs: Memory, specs, and tutorial

#### R8: The memory file moves and every reference follows
`docs/memory/run-kit/ui/operator-console.md` SHALL be moved with `git mv` to `docs/memory/run-kit/ui/quake-terminal.md`, titled `# run-kit UI — Quake Terminal`, with its frontmatter `description:` rewritten in the new vocabulary (≤500 chars, change-id-free). Its body SHALL substitute the vocabulary throughout (requirement headings, scenarios, Design Decision titles such as `The quake launcher is the quake terminal's compose relocated…`, `Desktop standing affordance is the quake launcher`) while `*Introduced by*` lines and `(02jx)`-style citations stay verbatim. All 21 inbound links (`](/run-kit/ui/operator-console.md)` ×20 and the same-directory `](operator-console.md)` ×1) across `operator-actuation`, `agent-send`, `cron`, `ui/index`, `ui/cron-console-tabs`, `ui/compose-and-bottom-bar`, `ui/routes-and-shell`, `ui/dialogs-and-state`, `ui/top-bar`, `ui/status-signals`, `ui/keyboard-and-palette`, `ui/focus-ownership` SHALL retarget to `quake-terminal.md`. Prose in those files and in `ui/visual-design`, `ui/terminal`, `ui/sidebar`, `ui/lenses-and-layout` SHALL substitute the vocabulary, including the section headings `## The Operator Console's Own Focus Return` → `## The Quake Terminal's Own Focus Return`, `### The operator console keeps a guarded origin ref…` → `### The quake terminal keeps a guarded origin ref…`, `## Operator Console Overlay` → `## Quake Terminal Overlay`, `### The operator console chord reclaims KeyJ…` → `### The quake terminal chord reclaims KeyJ…`. `ui/cron-console-tabs.md` keeps its filename. `fab docs-index docs/memory` regenerates `ui/index.md` and `run-kit/index.md`.

- **GIVEN** the renamed memory tree
- **WHEN** `grep -rnE 'operator-console\.md' docs/memory` and `grep -rniE 'operator[ -]?console|omnibox' docs/memory` run
- **THEN** the first returns zero matches and the second returns only `*Introduced by*` lines and change-name citations (e.g. `260906-f4s6-omnibox-focus-release`)
- **AND** `fab docs-index docs/memory --check` exits 0

#### R9: Specs and the tutorial topic substitute the vocabulary
`docs/specs/cron.md` (lines 27–28, 359, 404) and `docs/specs/agent-messaging.md` (line 60) SHALL substitute the vocabulary with no design-content change. The canonical tutorial `docs/site/skill/tutorial.md:61` SHALL read `drops the quake terminal under the top bar; type into the quake launcher ("Ask…"), Enter sends, the reply streams in the drawer; ⌘J or Esc tucks it away. Everything can start from that launcher.`; `scripts/sync-skill.sh` SHALL be re-run so `app/backend/cmd/rk/skill/tutorial.md` is byte-identical (the Go drift-guard `TestSkillEmbedMatchesCanonical`); the file stays ≤150 lines. `app/frontend/public/tutorial/tutorial.html:257` SHALL read `the quake terminal drops down`.

- **GIVEN** the edited tutorial
- **WHEN** `just test-backend` runs
- **THEN** the skill drift-guard tests pass
- **AND** `grep -rniE 'operator[ -]?console|omnibox' docs/specs docs/site app/backend/cmd/rk/skill app/frontend/public` returns zero matches

### Cross-cutting

#### R10: Zero behavior change
No layout, focus, geometry, opacity, Esc-ladder, mobile-navigation, send-fork, URL, or tmux behavior changes. The only new code paths are the two read-side fallbacks (R4, R5), each covered by a unit test. The verification lanes in R3 and R9 pass, `just test-frontend` passes, and a final `grep -rniE 'operator[ -]?console|omnibox' app/ docs/memory docs/specs docs/site` returns only history (provenance citations); `fab/`, `docs/wiki/`, and `fab/plans/` are untouched.

- **GIVEN** the complete rename
- **WHEN** `git diff --stat main...HEAD -- fab/plans fab/backlog.md docs/wiki 'fab/changes/2609*' 'fab/changes/archive'` runs
- **THEN** it is empty
- **AND** the only files under `fab/changes/` in the diff are this change's own artifacts

### Non-Goals

- Any layout, focus, geometry, resize, or compose-location change (changes 1 and 2 of the plan)
- Renaming the `operator` window role, `_rk-operator`, `rk operator …`, or `app/backend/api/operator.go`
- Rewriting history: `fab/changes/**` intakes/plans, `fab/backlog.md`, `fab/plans/**`, `docs/wiki/*.html`, *Introduced by* lines, change-ID citations
- Deleting orphaned legacy localStorage keys for viewers who never open the drawer again (the legacy key is removed only on the next write)

### Design Decisions

#### Keybinding override migration is a read-side id map, not an alias
**Decision**: `parseOverrides()` translates a persisted `operator-console` override onto `quake-terminal` when no new-id entry exists; the registry carries one action with the new id.
**Why**: overrides are persisted by `actionId` in `runkit-keybindings`; without the map a viewer's rebound or disabled ⌘J silently reverts, which is a behavior change. A read-side map keeps the migration in the one tolerant parser that already degrades malformed entries.
**Rejected**: an `aliasOf` registry entry under the old id — an alias registers a second visible binding row and would need its own handler wiring; the registry's own comment calls a free-standing second id a phantom action.
*Introduced by*: 260912-nynf-quake-terminal-rename

#### Legacy storage keys are read as fallback and removed on write
**Decision**: `readQuake*` reads the legacy `runkit-operator-console-*` key only when the new key is absent; `writeQuake*` writes the new key and removes the legacy one.
**Why**: viewers keep their drawer size and glass across the rename with no observable change; removing on write follows the `gui-posture.ts` `GUI_LEGACY_VIEW_KEY` precedent so the fallback is one-shot.
**Rejected**: leaving the legacy key orphaned — harmless but unprecedented in this codebase; migrating eagerly at module load — a write at import time, against the per-viewer-preference posture of writing only on user action.
*Introduced by*: 260912-nynf-quake-terminal-rename

## Tasks

### Phase 1: Setup

- [x] T001 `git mv` the nine source/test files to their new paths (`components/quake-terminal.tsx` + `.test.tsx`, `components/quake-launcher.tsx` + `.test.tsx`, `lib/quake-terminal.ts` + `.test.ts`, `lib/palette/quake-terminal.ts` + `.test.ts`, `tests/e2e/quake-terminal.spec.ts`); leave `operator-context-chip.tsx` and `operator-compose-dialog.tsx` in place <!-- R2 -->

### Phase 2: Core Implementation

- [x] T002 In `app/frontend/src/lib/quake-terminal.ts`: apply the identifier map (event constant + value, request type/guard/request/drain/clear, machine, segment, geometry, compose, root attr `data-quake-terminal`, target helpers); add `QUAKE_*_KEY` / `LEGACY_QUAKE_*_KEY` constants; implement the legacy fallback read and remove-on-write in `readQuakeGeometry` / `readQuakeOpacity` / `writeQuakeGeometry` / `writeQuakeOpacity`; update the module header comment; keep every operator-addressee export unchanged <!-- R1, R4 -->
- [x] T003 In `app/frontend/src/components/quake-terminal.tsx` and `components/quake-launcher.tsx`: rename the exported components, imports, `data-testid`s (`quake-terminal…`, `quake-launcher…`), `aria-label`s (`Quake terminal`, `Collapse quake terminal`), CSS class references (`.rk-quake-*`), the root attr, the event subscription, and comments; placeholders and segment labels unchanged <!-- R1, R3, R6, R7 -->
- [x] T004 In `app/frontend/src/globals.css`: rename `.rk-console-slide` / `.rk-console-closed` / `.rk-console-dragging` to `.rk-quake-*` and update the three comment blocks (≈lines 498, 1614, 1737) <!-- R1 -->
- [x] T005 In `app/frontend/src/lib/palette/quake-terminal.ts`: ids `quake-terminal`, `quake-terminal-list/-log/-tasks`, label `Operator: Open quake terminal` (other labels unchanged), type `QuakeTerminalPaletteAction`, builders `buildQuakeTerminal*Action`; in `app/frontend/src/lib/keybindings.ts`: the ⌘J builtin row (`quake-terminal` / `Quake terminal` / description / `mapLabel: "quake"`) and the `parseOverrides` legacy-id map with a doc comment stating the invariant (new id wins) <!-- R5, R6 -->
- [x] T006 Update every consumer: `app.tsx` (lazy imports, handler map key `quake-terminal`, the three `requestQuakeTerminal` dispatch sites, `quakeTerminalTabs` / `quakeTab`, mount comments), `top-bar.tsx` (`QuakeLauncher` import/mount, `launcherMorphed`), `top-bar-overflow-menu.tsx`, `status-bar.tsx`, `command-palette.tsx`, `compose-strip.tsx`, `settings-dialog.tsx` (`QuakeOpacityControl`, label/sublabel), `terminal-activity-tabs.tsx`, `terminal-client.tsx`, `cron-list.tsx`, `cron-log.tsx`, `watched-table.tsx`, `server-watched-zone/watched-zone.tsx`, `operator-context-chip.tsx`, `contexts/session-context.tsx`, `hooks/use-global-palette-actions.ts`, `lib/router-url.ts`, `lib/focused-pane-window.ts` — imports, identifiers, comments; then `just test-frontend` type-checks clean (tests may still fail until T007) <!-- R1, R6, R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Update every Vitest suite that names the old ids/labels/keys/paths (`quake-terminal.test.tsx`, `quake-launcher.test.tsx`, `lib/quake-terminal.test.ts`, `lib/palette/quake-terminal.test.ts`, `compose-strip.test.tsx`, `settings-dialog.test.tsx`, `sidebar/index.test.tsx`, `status-bar.test.tsx`, `terminal-activity-tabs.test.tsx`, `terminal-client.test.tsx`, `keybindings.test.ts` incl. the id agreement table at ≈L811, `router-url.test.ts`); add unit tests for the R4 legacy-key fallback (both keys, new wins, remove-on-write) and the R5 `parseOverrides` migration (legacy-only, both present); run `just test-frontend` green <!-- R3, R4, R5 -->
- [x] T008 Update the e2e specs: `tests/e2e/quake-terminal.spec.ts` (describe title, helpers `console_`/`omniboxInput` → `drawer`/`launcherInput`, test ids, palette filter `Open quake terminal` + `/^Operator: Open quake terminal/`, intent comments), `operator-compose.spec.ts:234`, `status-bar.spec.ts:444`, `operator-pinned-row.spec.ts:140,172`, `operator-session-promotion.spec.ts:115`, `web-view-lens.spec.ts:554,636,639`, `window-heading.spec.ts:63,74,113,116,588,645,658,690,693`; run `just test-e2e quake-terminal`, `just test-e2e window-heading`, `just test-e2e web-view-lens`, `just test-e2e status-bar`, `just test-e2e operator-pinned-row`, `just test-e2e operator-session-promotion`, `just test-e2e operator-compose` green <!-- R3, R6, R10 -->

### Phase 4: Polish

- [x] T009 Memory: `git mv docs/memory/run-kit/ui/operator-console.md docs/memory/run-kit/ui/quake-terminal.md`; rewrite its title, description, and body vocabulary (headings included, provenance lines verbatim); retarget all 21 inbound links across the 12 files; substitute prose and the four named section headings in `focus-ownership`, `routes-and-shell`, `keyboard-and-palette`, and the other 14 memory files; keep `cron-console-tabs.md` named as is; run `fab docs-index docs/memory --check` then `fab docs-index docs/memory` <!-- R8 -->
- [x] T010 Specs + tutorial: edit `docs/specs/cron.md`, `docs/specs/agent-messaging.md`, `docs/site/skill/tutorial.md:61`, `app/frontend/public/tutorial/tutorial.html:257`; run `scripts/sync-skill.sh`; run `just test-backend` green <!-- R9 -->
- [x] T011 Final sweep: `grep -rniE 'operator[ -]?console|omnibox|rk-console-|data-operator-console|OperatorConsole|OperatorOmnibox' app/ docs/memory docs/specs docs/site` returns only provenance citations; confirm `git status` shows no changes under `fab/plans`, `fab/backlog.md`, `docs/wiki`, or other changes' `fab/changes/` folders <!-- R10 -->

## Execution Order

- T001 blocks T002–T008 (paths must exist before edits and imports)
- T002 blocks T003, T005, T006 (they import the renamed exports)
- T006 blocks T007 (type-check clean before the unit suites); T007 blocks T008 (unit green before the e2e lanes)
- T009 and T010 are independent of each other and of T007–T008; T011 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: No `OperatorConsole`, `OperatorOmnibox`, `OPERATOR_CONSOLE`, `operatorConsole`, `omnibox`/`Omnibox`, `rk-console-`, `data-operator-console`, or `rk:operator-console` token remains under `app/frontend/src` or `app/frontend/tests`, and the operator-addressee identifiers listed in R1 are unchanged
- [x] A-002 R2: The nine files exist at their new paths as git renames (`git diff --stat -M main...HEAD` shows `=>` rows), all imports resolve, and `git log --follow` on `lib/quake-terminal.ts` reaches the old history
- [x] A-003 R3: All 16 test ids carry the new names in components and every selector in Vitest and e2e follows; no `test()` was added, removed, or re-sequenced in any spec
- [x] A-004 R4: `QUAKE_GEOMETRY_KEY`, `QUAKE_OPACITY_KEY`, `LEGACY_QUAKE_GEOMETRY_KEY`, `LEGACY_QUAKE_OPACITY_KEY` are exported with the specified values; read falls back to legacy only when the new key is `null`; write sets new and removes legacy
- [x] A-005 R5: The ⌘J builtin carries `actionId: "quake-terminal"`, `label: "Quake terminal"`, `mapLabel: "quake"`, unchanged combo/tier/scope/`ignoreInputs`; `parseOverrides` maps a legacy `operator-console` entry onto `quake-terminal` with new-id precedence; no `aliasOf` entry was added
- [x] A-006 R6: Palette ids/labels, both aria-labels, the collapse button label, the settings row label/sublabel, and the e2e describe title match R6 verbatim; the unchanged-copy list in R6 is byte-identical to main
- [x] A-007 R7: Every dispatcher enumerated in R7 calls `requestQuakeTerminal`; the drawer subscribes to `QUAKE_TERMINAL_EVENT`; `grep -rn 'rk:operator-console\|requestOperatorConsole' app/ docs/site docs/specs` is empty
- [x] A-008 R8: `docs/memory/run-kit/ui/quake-terminal.md` exists as a git rename of `operator-console.md`; no `operator-console.md` link remains under `docs/memory`; the four named section headings are renamed; `cron-console-tabs.md` keeps its filename; `fab docs-index docs/memory --check` exits 0 and the regenerated indexes list `quake-terminal`
- [x] A-009 R9: `docs/specs/cron.md`, `docs/specs/agent-messaging.md`, `docs/site/skill/tutorial.md`, `app/backend/cmd/rk/skill/tutorial.md`, and `public/tutorial/tutorial.html` carry the new vocabulary; the canonical and embedded tutorial files are byte-identical and ≤150 lines

### Behavioral Correctness

- [x] A-010 R4: With only the legacy geometry key set, the drawer opens at the stored size (unit test), and after one resize the legacy key is gone and the new key holds the value
- [x] A-011 R5: A viewer whose stored overrides disable or rebind `operator-console` sees the same ⌘J behavior after the rename (unit test on `parseOverrides` / `readStoredOverrides`)
- [x] A-012 R10: `just test-frontend` and the seven e2e lanes in R3 pass; `just test-backend` passes (skill drift guard included)

### Scenario Coverage

- [x] A-013 R6: The e2e palette scenario filters `Open quake terminal`, selects `/^Operator: Open quake terminal/`, and lands open+focused; `operator-compose.spec.ts` asserts exactly one `Operator: Open quake terminal` option
- [x] A-014 R2: Unit tests for the R4 fallback and the R5 migration exist in the renamed lib suites and pass

### Edge Cases & Error Handling

- [x] A-015 R4: A corrupt legacy value (non-JSON geometry, non-numeric opacity) degrades to the default without throwing, exactly as a corrupt new-key value does
- [x] A-016 R5: A stored blob containing both `operator-console` and `quake-terminal` entries yields only the `quake-terminal` entry with the new-id value; a malformed blob still degrades to `{}`

### Removal Verification

- [x] A-017 R10: No file under `fab/plans`, `fab/backlog.md`, `docs/wiki`, or another change's `fab/changes/` folder is modified; `*Introduced by*` lines and change-ID citations in memory are byte-identical to main

### Code Quality

- [x] A-018 Pattern consistency: renamed identifiers follow the surrounding naming style (PascalCase components, SCREAMING_SNAKE constants, `useX` hooks, kebab-case files/test ids)
- [x] A-019 No unnecessary duplication: the legacy-key fallback reuses the existing parse-and-clamp path rather than a second parser; the override migration lives inside `parseOverrides`, not a parallel reader
- [x] A-020 Comment discipline: updated comments state constraints (the new-id-wins invariant, the one-shot legacy read), never narrate the rename or cite change IDs / PR numbers
- [x] A-021 Tests cover the added behavior: both fallbacks have unit tests; no other new behavior exists to cover

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The scoped e2e lane for this surface is now `just test-e2e quake-terminal`; a fresh worktree needs `pnpm install --frozen-lockfile` in `app/frontend/` and `just _ensure-tmux-conf` before `just test-backend`

## Deletion Candidates

None — this change is a pure rename whose only retained old-name artifacts (the `LEGACY_QUAKE_*_KEY` constants in `app/frontend/src/lib/quake-terminal.ts:208-209` and the `operator-console` legacy-id map in `app/frontend/src/lib/keybindings.ts:683-686`) are the planned read-side fallbacks of R4/R5, not redundant code; they must survive until their one-shot migration role ends.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The mobile-only gate variables `operatorConsoleTabs` / `consoleTab` in `app.tsx` take the mechanical names `quakeTerminalTabs` / `quakeTab` rather than a re-scoped name like `operatorRouteTabs` | Intake #4 asks for a uniform vocabulary; a re-scoping rename is a judgment call that belongs to change 2, which touches this seam anyway | S:70 R:95 A:85 D:70 |
| 2 | Confident | e2e helper names inside the spec (`console_`, `omniboxInput`) become `drawer` / `launcherInput`; test flows untouched | Local helper naming; keeping `console_` would leave the old vocabulary in the spec's own vocabulary | S:65 R:95 A:90 D:80 |
| 3 | Certain | The legacy-id map lives in `parseOverrides` so both `readStoredOverrides` and any direct parser caller see one behavior | `parseOverrides` is the single tolerant parser the tests already target | S:85 R:90 A:95 D:90 |
| 4 | Confident | The memory rename (T009) runs in apply so review sees the whole diff; hydrate then performs the present-truth self-check, `set-summary`, and index regeneration on the already-moved file | The rename is itself the spec-level change; leaving memory to hydrate would make review's memory-drift check fail on every file | S:70 R:90 A:85 D:75 |

4 assumptions (1 certain, 3 confident, 0 tentative).
