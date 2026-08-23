# Plan: Single-Chord Shortcut Model + Palette-Registry Constitution Amendment + Session Descriptor Copy

**Change**: 260823-c5yq-single-chord-palette-registry-session-copy
**Intake**: `intake.md`

## Requirements

### Keybindings: One canonical chord per action

#### R1: Remove the per-surface browser remap layer (`macShellOnly`)
The `macShellOnly` field SHALL be removed from the `KeyBinding` schema, from the `defaultComboFor` host gate (`!def.macShellOnly || host.shell`), and from all six `DEFAULT_BINDINGS` occurrences (`create-session`, `create-window`, `kill-window`, `settings-open`, `new-app-window`, `close-app-window`) in `app/frontend/src/lib/keybindings.ts`, so each action's mac refinement (`macTier`/`macCode`) becomes its canonical mac default on ALL mac hosts. Comments referencing `macShellOnly` MUST be updated. No other binding's resolution may change; Win/Linux resolution stays byte-identical.

- **GIVEN** a mac browser host (`platform: "mac", shell: false`)
- **WHEN** `defaultComboFor` resolves `create-session` / `create-window` / `kill-window` / `settings-open` / `new-app-window` / `close-app-window`
- **THEN** it returns the same combos as the mac shell today (⇧⌘T / ⌘T / ⌘W / ⌘, / ⌘N / ⇧⌘W)
- **AND** every other binding and every Win/Linux resolution is unchanged

#### R2: Browser-reserved canonical chords resolve disabled — no replacement chord
On a mac browser host, the canonical combos from R1 MUST resolve `enabled: false, disabledReason: "reserved"` through the EXISTING browser-owner claims (`MAC_BROWSER_CMD_CLAIMS` ⌘N/⌘T/⌘W/⌘, ; the shifted ⇧⌘T/⇧⌘W claims). No new browser-disabling machinery and no replacement browser chord SHALL be added for any of these actions; each stays palette-reachable, and `withShortcutHints` continues to omit hints for disabled bindings.

- **GIVEN** a mac browser host
- **WHEN** `resolveBindings` runs over the shipped defaults
- **THEN** the six R1 actions resolve `disabledReason: "reserved"` with no advertised hint, and inside the mac shell all six resolve enabled

#### R3: `settings-open` canonical chord is ⌘, (keep `macTier`, drop only the shell gate)
`settings-open` SHALL keep `macTier: "cmd"` so ⌘, is the canonical mac chord on both hosts. In a mac browser ⌘, is the Preferences claim, so settings becomes palette-only there (the previously live ⇧⌘, browser default is deliberately retired — the accepted consequence recorded in the intake). Win/Linux keeps ⇧Ctrl+,.

- **GIVEN** a mac browser host
- **WHEN** `resolveBindings` resolves `settings-open`
- **THEN** its combo is ⌘, with `disabledReason: "reserved"`, and the `Settings: Open` palette entry remains reachable

### Shortcuts panel: desktop tag instead of a second mapping

#### R4: Delete the host-divergence machinery
The `hostDivergent` block in `app/frontend/src/components/settings-shortcuts-panel.tsx` (~line 606: `baseDef`/`otherHostCombo`/`hostDivergent` and the `in browser:` / `in desktop app:` secondary text) SHALL be deleted. No row may render a second per-host mapping.

- **GIVEN** the Shortcuts tab on any host
- **WHEN** any row renders
- **THEN** no "in browser:" / "in desktop app:" secondary chord text appears anywhere in the panel

#### R5: Per-chord `desktop` tag on browser-reserved rows, rows stay visible
In a browser host, a row whose EFFECTIVE combo resolves `disabledReason: "reserved"` SHALL render its canonical keycaps plus a `desktop` pill (replacing the amber `browser` reserved pill there — one pill per row, same underlying reserved state), with title copy along the lines of "reserved by the browser — works in the desktop app; use the command palette here". Rows MUST stay visible in the browser panel. In the desktop shell these rows render plain (no tag). The keyless-base app-window pair, having gained canonical mac combos in browser resolution (R1), renders ⌘N/⇧⌘W keycaps + the desktop tag in a mac browser instead of the "unbound" button; their palette entries stay `can*ShellWindow()`-gated (palette completeness is per-surface — a shell-only action needs no browser palette entry).

- **GIVEN** a mac browser host
- **WHEN** the `kill-window` row renders
- **THEN** it shows ⌘W keycaps + a `desktop` pill and no amber `browser` pill
- **GIVEN** the mac desktop shell
- **WHEN** the same row renders
- **THEN** keycaps only — no pill

### Constitution: Principle V amendment

#### R6: Palette = complete action registry
`fab/project/constitution.md` § V. Keyboard-First SHALL be extended: the command palette is the primary discovery mechanism AND the complete action registry — every user-facing action reachable via a keyboard shortcut or a UI control MUST also be registered in the command palette, guaranteeing the fallback for surface-reserved chords is always palette → action. The Governance line bumps `1.8.0` → `1.9.0` and `Last Amended` → `2026-08-23`. Wording may be polished without weakening the normative content (intake carries the drafted text).

- **GIVEN** the amended constitution
- **WHEN** Principle V is read
- **THEN** it mandates palette registration for every shortcut/UI-control action and the Governance line reads version 1.9.0, Last Amended 2026-08-23

#### R7: Registration audit holds
The existing "palette parity invariant" unit test in `keybindings.test.ts` (every `DEFAULT_BINDINGS` actionId resolves to a palette entry or a documented exemption) SHALL be verified to still cover the full binding set after R1; any gap found is fixed by registering the missing action, not by exempting it.

- **GIVEN** the post-R1 `DEFAULT_BINDINGS`
- **WHEN** the parity invariant test runs
- **THEN** it passes with no new exemptions

### Palette & copy: session-as-group descriptors

#### R8: `PaletteAction` gains an optional description rendered as secondary row text
`PaletteAction` (`app/frontend/src/components/command-palette.tsx`) SHALL gain `description?: string`, rendered as secondary text on palette rows (the panel's `label — description` idiom), and the description SHALL join the filter haystack so "group" finds the session actions. Actions without a description render exactly as today.

- **GIVEN** the palette open with a query matching only an action's description (e.g. "group")
- **WHEN** the list filters
- **THEN** the described action appears; actions without descriptions are unaffected

#### R9: Session concept-formation copy carries the grouping model
Descriptor copy SHALL carry "sessions are grouping utilities" at concept-formation moments, scoped to SESSION descriptors only: (a) `create-session`'s registry `description` in `keybindings.ts` ("create a tmux session" → the user's example shape, e.g. "a new group of tabs"); (b) palette descriptions on `Session: Create` and `Session: Create at Folder` in `app.tsx`; (c) the sidebar no-sessions empty state (`components/sidebar/index.tsx` ~2864) folds the grouping model into its terse parenthesized style, e.g. `(no sessions — a session groups tabs; + new, or {chord})`, keeping the chord-clause omission rules (unbound/disabled, coarse pointer). `create-window`'s "in the current session" stays verbatim; window/tab descriptor strings are out of scope (lfla owns them). No noun renames, no parentheticals on the noun itself.

- **GIVEN** the shortcuts panel, the palette, and an empty server group
- **WHEN** their session-creation copy renders
- **THEN** each carries the grouping-model descriptor and "session" remains the noun everywhere

### Tests

#### R10: Test suites reflect the single-chord model
`keybindings.test.ts` divergence tests SHALL be rewritten to assert one canonical host-invariant mac default per R1 action plus reserved resolution in mac browsers; `settings-shortcuts-panel.test.tsx` SHALL cover R4/R5 (no divergence text, desktop pill in browser hosts, plain rows in shell, app-window keycaps in mac browser); palette tests cover R8; sidebar tests cover R9(c). Any e2e spec asserting the removed "in browser:" hint or the amber `browser` pill on these rows SHALL be updated (sweep `app/frontend/tests/` — `shortcut-registry.spec.ts`'s mac block assertions of N/⇧⌘N inertness remain valid); changed `.spec.ts` files update their `.spec.md` companions in the same commit.

- **GIVEN** the full frontend suite (`just test-frontend`) and the touched e2e specs
- **WHEN** they run
- **THEN** they pass, with no test asserting the removed remap layer

### Non-Goals

- The New-session creation FLOW (inline name prompt) — independent change in worktree `matte-marlin`; this change touches only binding/copy treatment.
- Window/tab descriptor strings (shipped lfla copy sweep owns them); ju2p's arrow-navigation scope.
- Any new second chord for browser-blocked actions; any hiding of desktop-only rows; any session→group rename.
- Backend, API, routes.

### Design Decisions

#### settings-open keeps ⌘, as its canonical chord
**Decision**: Drop only `macShellOnly` from `settings-open`, keeping `macTier: "cmd"` — ⌘, canonical on all mac hosts, palette-only in mac browsers.
**Why**: Matches the family rule the user set for N/T/W (canonical = the OS-conventional desktop chord, palette as the browser path), preserves existing shell muscle memory, and is the minimal mechanical change; per-device rebind covers a browser user who wants a live chord.
**Rejected**: ⇧⌘, (unreserved on every host) — keeps a live browser chord but breaks the macOS Preferences convention in the shell, inverting the user's stated priority; also diverges from the uniform "delete the shell gate" mechanism.
*Introduced by*: 260823-c5yq-single-chord-palette-registry-session-copy

#### The desktop tag replaces the amber browser pill in browser hosts
**Decision**: One pill per row — the `desktop` tag is the browser-host presentation of the reserved state, superseding the amber `browser` pill on those rows.
**Why**: Both pills mark the same underlying `disabledReason: "reserved"` fact; two pills on one row is clutter, and "desktop" answers the user's question ("where does this work?") better than "browser" (which reads as ownership trivia).
**Rejected**: Rendering both pills — redundant; keeping only the amber `browser` pill — names the blocker, not the path forward.
*Introduced by*: 260823-c5yq-single-chord-palette-registry-session-copy

## Tasks

### Phase 2: Core Implementation

- [x] T001 Remove `macShellOnly` from `app/frontend/src/lib/keybindings.ts`: the `KeyBinding` schema field (~:91), the `defaultComboFor` gate, the six `DEFAULT_BINDINGS` occurrences (:191–:203 region + `settings-open`), and stale comments referencing it (:85, :161, :224, :239 region) <!-- R1, R3 -->
- [x] T002 Rewrite `app/frontend/src/lib/keybindings.test.ts` divergence coverage: one canonical mac default per R1 action on both hosts; reserved resolution + no hint in mac browsers (incl. `settings-open` ⌘,); Win/Linux byte-identical; verify the palette parity invariant needs no new exemptions <!-- R1, R2, R3, R7, R10 -->
- [x] T003 In `app/frontend/src/components/settings-shortcuts-panel.tsx`: delete the `hostDivergent`/`baseDef`/`otherHostCombo` block and the "in browser:/in desktop app:" secondary text (~:606–:640); render the `desktop` pill (with the reserved-explainer title) in place of the amber `browser` pill on browser-host reserved rows; shell rows render plain <!-- R4, R5 -->
- [x] T004 Update `app/frontend/src/components/settings-shortcuts-panel.test.tsx`: no divergence text anywhere; desktop pill + keycaps on reserved rows in browser hosts (incl. the app-window pair's ⌘N/⇧⌘W in a mac browser, no "unbound" button); plain rows in shell <!-- R4, R5, R10 -->
- [x] T005 Extend `PaletteAction` in `app/frontend/src/components/command-palette.tsx` with `description?: string`, render as secondary row text, include in the filter haystack; cover in the palette's tests <!-- R8, R10 -->
- [x] T006 [P] Session descriptor copy: `create-session` `description` in `keybindings.ts`; `description` on `Session: Create` / `Session: Create at Folder` in `app/frontend/src/app.tsx` <!-- R9 -->
- [x] T007 [P] Sidebar empty-state copy in `app/frontend/src/components/sidebar/index.tsx` (~:2864): fold the grouping model into the parenthesized style, preserving chord-omission + coarse-pointer rules; update sidebar tests <!-- R9, R10 -->
- [x] T008 [P] Amend `fab/project/constitution.md` § V per the intake's drafted text; Governance line → 1.9.0, Last Amended 2026-08-23 <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Sweep `app/frontend/tests/` for assertions on the removed "in browser:" hint or the amber `browser` pill on the six rows; update touched `.spec.ts` files AND their `.spec.md` companions in the same commit (check `shortcut-registry.spec.ts` + `.spec.md` prose; `web-tile-chrome`/`web-view-lens` matches are the unrelated "Open in browser" verb) <!-- R10 -->
- [x] T010 Run verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and the touched e2e specs via `just test-e2e "<spec>"` (never bare playwright) <!-- R10 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `macShellOnly` no longer exists in the schema, resolver, bindings data, or panel; the six actions resolve their mac-shell combos on all mac hosts
- [x] A-002 R4: No "in browser:" / "in desktop app:" secondary mapping renders anywhere in the shortcuts panel
- [x] A-003 R5: Browser-host reserved rows render canonical keycaps + a `desktop` pill (no amber `browser` pill); rows remain visible; shell rows render plain
- [x] A-004 R6: Constitution Principle V mandates palette registration for every shortcut/UI-control action; version 1.9.0, Last Amended 2026-08-23
- [x] A-005 R8: Palette rows render optional descriptions and the filter matches them
- [x] A-006 R9: Session concept-formation copy (registry description, two palette entries, sidebar empty state) carries the grouping model; "session" stays the noun

### Behavioral Correctness

- [x] A-007 R2: In a mac browser the six actions resolve `disabledReason: "reserved"`, contribute no shortcut hint, and stay palette-reachable; in the mac shell all six are live
- [x] A-008 R3: `settings-open` resolves ⌘, on all mac hosts (reserved in browser); no ⇧⌘, fallback remains
- [x] A-009 R1: Win/Linux resolution is byte-identical to before (⇧Ctrl+N/T/W/, unchanged; app-window pair unbound)

### Removal Verification

- [x] A-010 R1: No dead `macShellOnly` references remain anywhere (`grep -r macShellOnly app/frontend` is empty)

### Scenario Coverage

- [x] A-011 R10: Rewritten unit tests assert canonical-default + reserved-resolution scenarios for all six actions; panel tests assert the pill swap in both host kinds
- [x] A-012 R7: The palette parity invariant passes with no new exemptions
- [x] A-013 R10: Touched `.spec.ts` files have matching `.spec.md` updates in the same commit

### Edge Cases & Error Handling

- [x] A-014 R5: The keyless-base app-window pair renders keycaps + desktop tag in a mac browser (not "unbound"), and an override on any of the six rows still applies verbatim on both hosts (the override layer is untouched)
- [x] A-015 R8: An action with no `description` renders exactly as today (no empty secondary-text artifacts)

### Code Quality

- [x] A-016 Pattern consistency: New code follows the registry's data-over-branches idiom, the panel's pill idioms, and existing copy register
- [x] A-017 No unnecessary duplication: Reserved-state detection reuses `resolveBindings`' `disabledReason` — no parallel reserved lookup added
- [x] A-018 Type narrowing over assertions; no `as` casts introduced in touched frontend code
- [x] A-019 No comment narration: touched comments state constraints only (no change-ID citations in code comments)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change IS the removal: the `macShellOnly` schema field, its `defaultComboFor` gate, and the panel's host-divergence block were the redundancy and are fully deleted in the diff; no surviving code was made unused. (Memory files still describing the old model — `docs/memory/run-kit/ui/keyboard-and-palette.md`, `docs/memory/run-kit/ui/sidebar.md`, `docs/memory/run-kit/desktop-shell.md` — are hydrate-stage updates, not code deletions.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `settings-open` canonical chord is ⌘, (keep `macTier`, drop only the shell gate) — resolves the intake's deferred #14 | Matches the user's family rule (canonical = OS-conventional desktop chord, palette as browser path); minimal mechanism; per-device rebind covers browser users; trivially reversible data row | S:50 R:85 A:70 D:55 |
| 2 | Confident | The `desktop` pill replaces the amber `browser` pill on browser-host reserved rows (one pill per row) | Both mark the same reserved state; carried from intake #8 into the plan's Design Decisions | S:60 R:85 A:70 D:60 |
| 3 | Confident | Palette `description` joins the filter haystack | Carried from intake #9; makes the grouping vocabulary ("group") discoverable; revisit if matches get noisy | S:60 R:80 A:70 D:60 |
| 4 | Confident | Exact copy strings beyond the user's examples follow the examples' register, decided at apply (empty state: `(no sessions — a session groups tabs; + new, or {chord})` shape) | Copy-level, trivially reversible; intake #13 | S:45 R:90 A:65 D:45 |
| 5 | Confident | The desktop pill renders on ANY browser-host reserved row (win/linux browser N/T/W included), not just the six R1 rows — the pill reads `disabledReason === "reserved" && !host.shell`, one affordance for one underlying state; it is suppressed inside the shell (shell rows render plain per R5) | The reserved fact is surface-level, not mac-specific; R5's examples name mac rows but its mechanism is the effective combo's reserved resolution | S:60 R:80 A:70 D:60 |
| 6 | Confident | `Session: Create at Folder` palette descriptor is "a new group of tabs, rooted at a folder" — the Create example extended with the folder delta | Intake #13: descriptors follow the user's example shape; the folder distinction is the entry's only semantic delta | S:45 R:90 A:65 D:45 |
| 7 | Confident | The two app-window palette actions stay shell-gated and gain NO description — the intake scopes descriptors to `Session: Create` / `Session: Create at Folder` | Per-surface palette completeness (intake #11); description scope is enumerated in R9(b) | S:55 R:85 A:70 D:55 |

7 assumptions (0 certain, 7 confident, 0 tentative).
