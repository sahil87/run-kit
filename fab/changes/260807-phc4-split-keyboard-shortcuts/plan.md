# Plan: Split-Action Keyboard Shortcuts

**Change**: 260807-phc4-split-keyboard-shortcuts
**Intake**: `intake.md`

## Requirements

### Keybindings: Registry Entries

#### R1: Terminal-scope split bindings
The registry (`app/frontend/src/lib/keybindings.ts`) SHALL ship two new `DEFAULT_BINDINGS` rows on the `terminal` scope: `split-horizontal` on `code: "Backslash"` and `split-vertical` on `code: "Minus"`, both `tier: "shifted"`, `kind: "builtin"`, with NO `macTier`, NO `macShellOnly`, and NO `ignoreInputs`.

- **GIVEN** the shipped `DEFAULT_BINDINGS` array
- **WHEN** it is resolved for any of the four hosts (mac/other × shell/browser)
- **THEN** `split-horizontal` resolves `{ code: "Backslash", tier: "shifted", scope: "terminal", enabled: true }`
- **AND** `split-vertical` resolves `{ code: "Minus", tier: "shifted", scope: "terminal", enabled: true }`
- **AND** neither definition carries a `macTier` field (no mac demotion on any host)

#### R2: Board-scope split bindings
The registry SHALL ship two further rows on the `board` scope reusing the SAME two combos: `board-split-horizontal` on `Backslash` and `board-split-vertical` on `Minus`, both `tier: "shifted"`, `kind: "builtin"`, no `macTier`/`ignoreInputs`.

- **GIVEN** the shipped `DEFAULT_BINDINGS` array
- **WHEN** it is resolved for any host
- **THEN** `board-split-horizontal` resolves `{ code: "Backslash", tier: "shifted", scope: "board", enabled: true }`
- **AND** `board-split-vertical` resolves `{ code: "Minus", tier: "shifted", scope: "board", enabled: true }`

#### R3: Defaults stay conflict-free and unclaimed
The four additions MUST NOT introduce a `findConflicts` conflict in any host, and shifted-tier `Backslash`/`Minus` MUST remain unclaimed by `claimedKeys()` on every host — `findConflicts` requires EQUAL scopes (`terminal` ≠ `board`), and `tiersCollide("shifted","cmd")` is false, so the existing `cmd`-tier `sidebar-toggle` (⌘\) and the mac-shell `cmd`-tier ⌘− zoom claim do not collide.

- **GIVEN** the extended `DEFAULT_BINDINGS`
- **WHEN** `findConflicts(resolveBindings(DEFAULT_BINDINGS, {}, host))` runs for each of the four hosts
- **THEN** the result is `[]` in every host
- **AND** `claimedKeys(platform, shell)` contains no entry whose `code` is `Backslash`/`Minus` with a tier colliding with `shifted`

#### R4: Existing shifted-tier integrity assertion stays exhaustive and truthful
The `carries the shifted-tier actions on their canonical keys` test in `app/frontend/src/lib/keybindings.test.ts` asserts an EXHAUSTIVE `toEqual` map of every shifted-tier actionId → code. It MUST be extended with the four new actionIds so it keeps passing and keeps its exhaustive character (the test is the guard against an accidental shifted-tier addition, so widening it to `toMatchObject` is prohibited).

- **GIVEN** the four new shifted-tier rows exist
- **WHEN** `just test-frontend` runs the `DEFAULT_BINDINGS integrity` suite
- **THEN** the exhaustive shifted map assertion passes with all four new ids present
- **AND** the assertion remains a `toEqual` on the full shifted set

### Keybindings: Route Handlers

#### R5: Terminal-route handler wiring
`app/frontend/src/app.tsx`'s `keybindingHandlers` memo SHALL register `split-horizontal` and `split-vertical` via the existing `fromPalette(id)` lookup, reusing the palette action bodies (the established `create-session`/`kill-window` pattern). No new dependency may be added to the memo's dep array beyond what `fromPalette` already covers (`paletteActions`), and `hooks/use-keybinding-dispatch.ts` MUST NOT change.

- **GIVEN** a terminal route with an active session and window
- **WHEN** the user presses ⇧⌘\ (mac) / Shift+Ctrl+\ (win/linux)
- **THEN** the `Window: Split Horizontal` palette body runs — `executeSplit(server, currentWindow.windowId, true, currentWindow.worktreePath)`
- **AND** pressing ⇧⌘− runs the `Window: Split Vertical` body with `horizontal: false`
- **GIVEN** no active session (the split palette entries are not registered)
- **WHEN** either chord is pressed
- **THEN** `fromPalette` yields `undefined`, no handler fires, and the chord falls through untouched

#### R6: Board-route handler wiring
`app/frontend/src/components/board/board-page.tsx`'s `boardKeyHandlers` memo SHALL register `board-split-horizontal` and `board-split-vertical`, gated on the shared `focusedPane` memo and calling `executeSplit(focusedPane.server, focusedPane.windowId, horizontal, focusedPane.cwd)` — one derivation of the active-pane cwd, matching the parsimony note at the board palette call site. `focusedPane` and `executeSplit` join the memo's dep array.

- **GIVEN** a board route with at least one pinned pane focused
- **WHEN** the user presses ⇧⌘\
- **THEN** the focused tile's window is split with `horizontal: true`
- **AND** ⇧⌘− splits it with `horizontal: false`
- **GIVEN** an empty board (`focusedPane` is `null`)
- **WHEN** either chord is pressed
- **THEN** the handler entry is `undefined` and the chord falls through untouched

#### R7: Declaration ordering constraint in `board-page.tsx`
`boardKeyHandlers` is declared at ~line 356 but `focusedPane` and `executeSplit` are declared at ~lines 486/506 — later in the component body. Because `const` bindings are in the temporal dead zone until initialized, the split handler entries MUST NOT read those identifiers from their current position; either the handler memo moves below both declarations, or the two declarations move above the memo. The chosen resolution MUST preserve every existing behavior and dep-array correctness.

- **GIVEN** the board component renders
- **WHEN** `boardKeyHandlers` is evaluated
- **THEN** `focusedPane` and `executeSplit` are already initialized (no `ReferenceError`)
- **AND** `useKeybindingDispatch(boardKeyHandlers)` still mounts exactly once per route shell

### Keybindings: Free Riders

#### R8: Palette hints and overlay rows appear without new code
Because `actionId` doubles as the palette action id, `withShortcutHints` SHALL decorate all four existing split palette entries with the new combos, and the shortcuts overlay SHALL render the new rows from registry data — with no changes to `withShortcutHints`, the overlay components, or `palette-*.ts` builders.

- **GIVEN** the four registry rows exist and are enabled
- **WHEN** the command palette is opened on the terminal route
- **THEN** `Window: Split Horizontal` displays the hint `⇧⌘\` (mac) or `Shift+Ctrl+\` (win/linux)
- **AND** on the board route `Board: Split Focused Pane Horizontal` displays the same hint
- **AND** no source file other than `keybindings.ts`, `app.tsx`, and `board-page.tsx` changes for this

### Non-Goals

- No Playwright e2e spec — no keybinding e2e coverage is added for these chords; registry data and handler presence are unit-proven per the convention of prior chord additions (260801-sm6g, 260801-mqim). Consequently no `.spec.ts`/`.spec.md` pair is touched.
- No changes to `hooks/use-keybinding-dispatch.ts`, `hooks/use-keybindings.ts`, the shortcuts-overlay components, or `shouldRefuseTerminalChord` — the terminal seam already refuses every shifted-tier match.
- No backend, API, route, or listener changes.
- The pre-existing board-palette-vs-top-bar-chip `horizontal` semantics are already reconciled (260806-2x2h); this change does not revisit them.

### Design Decisions

#### Keycap-as-divider mnemonic for the split pair
**Decision**: ⇧⌘\ maps to Split Horizontal (side-by-side) and ⇧⌘− to Split Vertical (stacked).
**Why**: Shift+\ types `|` — a vertical divider, which is what a side-by-side split draws — and `-` is the horizontal divider of a stacked split. The mnemonic is the rendered divider, not the action's name, which sidesteps run-kit's horizontal/vertical naming ambiguity and matches the SplitControl's own glyphs (`SplitHorizontalGlyph` draws a vertical divider). Precedents: VS Code splits on ⌘\, Windows Terminal on Alt+Shift+Minus/Plus.
**Rejected**: iTerm2/Warp/Ghostty's ⌘D + ⇧⌘D pair — structurally unrepresentable in this registry, which holds the key code constant cross-platform and varies only the tier, so both splits on `KeyD` would collapse to two identical Shift+Ctrl+D bindings on Windows/Linux (a hard `findConflicts` conflict). ⇧⌘D + ⇧⌘S — ambiguous (split vs. stack) and ⇧⌘S sits on browser Save-As. Letter keys H/V/R — already taken by window-prev, the win/linux Shift+Ctrl+V terminal-paste claim, and reload.
*Introduced by*: 260807-phc4-split-keyboard-shortcuts

#### Shifted tier with no mac demotion
**Decision**: Both combos ship on the `shifted` tier on every host, with no `macTier`.
**Why**: The `cmd` tier is unavailable as a base tier because on Windows/Linux it matches plain Ctrl chords, which belong to the pane — `shouldRefuseTerminalChord` never refuses plain-Ctrl there, so the chord would never reach the window dispatcher under terminal focus. Shifted-tier matches are refused to the dispatcher on every platform (rule 1), so the chords fire even with terminal or board-pane focus. Mac demotion would additionally land ⌘− on the mac-shell zoom accelerator.
**Rejected**: A `macTier: "cmd"` demotion (⌘\ is already `sidebar-toggle`, and ⌘− is the shell's zoom-out accelerator); binding the pair on the `cmd` tier outright (dead under pane focus on Windows/Linux).
*Introduced by*: 260807-phc4-split-keyboard-shortcuts

#### Dual-scope registration rather than one global pair
**Decision**: The same two combos are registered four times — `terminal`-scoped and `board`-scoped — with distinct actionIds matching each route's palette ids.
**Why**: `actionId` doubling as the palette id is what buys palette hints and handler reuse for free, and the two routes have different palette ids for the same conceptual action (`split-horizontal` vs `board-split-horizontal`). Scoping is not a conflict: `findConflicts` requires EQUAL scopes and `scopesOverlap("terminal","board")` is false because the routes never co-mount — the established ⌘[/⌘] board/history shadow-pair shape.
**Rejected**: One `global` pair with per-route handlers — the two routes' palette ids differ, so a single actionId could not join both palettes for hints, and a global row would claim the combos on the server/host routes where no split target exists.
*Introduced by*: 260807-phc4-split-keyboard-shortcuts

## Tasks

### Phase 1: Registry Data

- [x] T001 Add the two terminal-scoped rows (`split-horizontal` → `Backslash`, `split-vertical` → `Minus`, `tier: "shifted"`, `kind: "builtin"`, no `macTier`/`ignoreInputs`) to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts`, with a block comment in the established style documenting the keycap-as-divider mnemonic and the no-demotion rationale <!-- R1 -->
- [x] T002 Add the two board-scoped rows (`board-split-horizontal` → `Backslash`, `board-split-vertical` → `Minus`, same tier/kind) to `DEFAULT_BINDINGS` alongside the existing board pane-cycle rows, noting the terminal/board same-combo shape <!-- R2 -->
- [x] T003 Update the `DEFAULT_BINDINGS` module docblock so its inventory of shifted-tier actions and scopes reflects the four new rows <!-- R1, R2 -->

### Phase 2: Route Handlers

- [x] T004 [P] Add `"split-horizontal": fromPalette("split-horizontal")` and `"split-vertical": fromPalette("split-vertical")` to the `keybindingHandlers` memo in `app/frontend/src/app.tsx` (~line 2654), with a comment matching the surrounding convention <!-- R5 -->
- [x] T005 Resolve the temporal-dead-zone ordering in `app/frontend/src/components/board/board-page.tsx` so `focusedPane` and `executeSplit` are initialized before `boardKeyHandlers` evaluates — moving the handler memo (and its `useKeybindingDispatch` call) below those declarations, preserving all existing handler entries and dep-array correctness <!-- R7 -->
- [x] T006 Add the `focusedPane`-gated `board-split-horizontal` / `board-split-vertical` entries to `boardKeyHandlers` calling `executeSplit(focusedPane.server, focusedPane.windowId, true|false, focusedPane.cwd)`, and extend the memo dep array with `focusedPane` and `executeSplit` <!-- R6 -->

### Phase 3: Tests

- [x] T007 Extend the exhaustive `carries the shifted-tier actions on their canonical keys` `toEqual` map in `app/frontend/src/lib/keybindings.test.ts` with the four new actionIds, keeping it a `toEqual` <!-- R4 -->
- [x] T008 [P] Add a per-action integrity spec to the `DEFAULT_BINDINGS integrity` suite in the existing style: the split pair on `Backslash`/`Minus`, shifted tier, `terminal` AND `board` scopes, no `macTier`, resolving enabled in all four hosts <!-- R1, R2 -->
- [x] T009 [P] Add a spec asserting shifted-tier `Backslash`/`Minus` are unclaimed by `claimedKeys()` in every host and that the `cmd`-tier ⌘\ / ⌘− claims do not collide (`tiersCollide("shifted","cmd") === false`) — the conflict-freedom argument, made explicit alongside the existing `ships conflict-free defaults in every host` test <!-- R3 -->

### Phase 4: Verification

- [x] T010 Run `cd app/frontend && npx tsc --noEmit` and `just test-frontend`; fix any failures <!-- R1, R2, R3, R4, R5, R6, R7, R8 -->

## Execution Order

- T001–T003 (registry data) block T007–T009 (tests assert the data).
- T005 blocks T006 — the handler entries cannot reference `focusedPane`/`executeSplit` until the declaration ordering is resolved.
- T004 is independent of the board tasks (different file).
- T010 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` contains `split-horizontal` (`Backslash`) and `split-vertical` (`Minus`) on the `shifted` tier, `terminal` scope, `kind: "builtin"`, with no `macTier`, no `macShellOnly`, and no `ignoreInputs`
- [x] A-002 R2: `DEFAULT_BINDINGS` contains `board-split-horizontal` (`Backslash`) and `board-split-vertical` (`Minus`) on the `shifted` tier, `board` scope, with the same field profile
- [x] A-003 R5: `app.tsx`'s `keybindingHandlers` returns `split-horizontal` and `split-vertical` entries sourced from `fromPalette`, and `hooks/use-keybinding-dispatch.ts` is unmodified
- [x] A-004 R6: `board-page.tsx`'s `boardKeyHandlers` returns `focusedPane`-gated `board-split-horizontal` / `board-split-vertical` entries calling `executeSplit` with the focused pane's `{server, windowId, cwd}` and `horizontal: true`/`false` respectively

### Behavioral Correctness

- [x] A-005 R1: On every host, ⇧⌘\ / Shift+Ctrl+\ on the terminal route runs the `Window: Split Horizontal` palette body (`horizontal: true`, tmux `-h`, side-by-side) and ⇧⌘− runs `Window: Split Vertical` (`horizontal: false`)
- [x] A-006 R6: On the board route the same combos act on the FOCUSED tile's window via the shared `focusedPane` memo — the same `{server, windowId, cwd}` the top-bar SplitControl consumes, with no second derivation of the active-pane cwd
- [x] A-007 R7: `boardKeyHandlers` evaluates after `focusedPane` and `executeSplit` are initialized — no temporal-dead-zone `ReferenceError` — and every pre-existing handler entry (`board-cycle-next`/`-prev`, `go-back`, `go-forward`, `shortcuts-overlay`, `compose-toggle`, `settings-open`) is preserved with a correct dep array
- [x] A-008 R8: The four split palette entries render the new combo hints via `withShortcutHints` with no change to `withShortcutHints`, the overlay components, or any `palette-*.ts` builder

### Scenario Coverage

- [x] A-009 R1: A unit spec in `keybindings.test.ts` asserts the terminal split pair's actionId/code/tier/scope and absence of `macTier`, resolving enabled across all four hosts
- [x] A-010 R2: A unit spec asserts the board split pair's actionId/code/tier/scope and absence of `macTier` across all four hosts
- [x] A-011 R3: The pre-existing `ships conflict-free defaults in every host` test still passes, and a new spec asserts shifted `Backslash`/`Minus` are unclaimed by `claimedKeys()` in every host
- [x] A-012 R4: The `carries the shifted-tier actions on their canonical keys` assertion lists all four new actionIds and is still an exhaustive `toEqual`

### Edge Cases & Error Handling

- [x] A-013 R5: With no active session the terminal split palette entries do not exist, `fromPalette` yields `undefined`, and the chords fall through untouched (no handler, no error)
- [x] A-014 R6: With an empty board `focusedPane` is `null`, both board handler entries are `undefined`, and the chords fall through untouched
- [x] A-015 R3: A per-device override moving another action onto shifted `Backslash`/`Minus` still steals-with-warning through the unchanged `applyCapture` path — no new conflict class is introduced

### Code Quality

- [x] A-016 Pattern consistency: New registry rows, comments, handler entries, and test specs follow the naming and structural conventions of the surrounding code (change-id-annotated block comments, `fromPalette` handler convention, `byId(resolved(host), ...)` test style)
- [x] A-017 No unnecessary duplication: Handlers reuse the existing palette bodies (`fromPalette`) and the shared `focusedPane` memo rather than re-deriving the split target or the active-pane cwd
- [x] A-018 Type narrowing over assertions: No new `as` casts are introduced in the changed frontend files
- [x] A-019 No magic strings: Action ids and key codes follow the registry's existing literal conventions; no new numeric or string constant is introduced without the surrounding pattern
- [x] A-020 Test coverage for new behavior: The four new bindings are covered by colocated Vitest specs, per the code-quality rule that new features include tests
- [x] A-021 Verification gates: `cd app/frontend && npx tsc --noEmit` is clean and `just test-frontend` passes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/lib/keybindings.ts:171-172,188-189` — `mapLabel: "split |"` / `"split -"` on all four new rows is **inert**: the overlay's tier-map grid (`KEY_ROWS`, `shortcuts-overlay.tsx:75-79`) has no `Backslash` or `Minus` keycap cell, so `mapLabel` never renders for these codes (the same `Period`/`Backslash`/`Backquote` precedent memory already records for `settings-open`'s carried-but-unrendered `mapLabel: "settings"`). Keeping it for parity is defensible; deleting it removes four dead presentational strings.
- `app/frontend/src/components/board/board-page.tsx:359,362` — stale prose carried through the memo move: the comment still says "split/**close** executors" and "**splitWindow/closePane** with error toasts" / "**Close** schedules a self-heal refetch (`onSettled`)", but only `executeSplit` is declared at that site (the close/kill executor is `executeKillWindow` at ~:596). Pre-existing drift, not introduced here.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The exhaustive `carries the shifted-tier actions on their canonical keys` `toEqual` map must be EXTENDED (not relaxed to `toMatchObject`) — the intake said the existing integrity tests "automatically cover the additions", but this one asserts an exhaustive map and would fail | Read directly in `keybindings.test.ts:56-74`; the exhaustiveness is the test's purpose (it guards against unnoticed shifted-tier additions), so widening it would remove the guard the change should be answering to | S:95 R:90 A:95 D:95 |
| 2 | Certain | `boardKeyHandlers` (~line 356) must be reordered below `focusedPane` (~506) and `executeSplit` (~486), since `const` TDZ would otherwise throw at render | Verified by reading the declaration positions in `board-page.tsx`; the intake's snippet assumed `focusedPane` was already in scope at the memo. Moving the memo is the smaller, lower-risk edit (both declarations have their own ordering comments tying them to `boardRouteActions`) | S:95 R:85 A:95 D:90 |
| 3 | Certain | Presentational strings: `label: "Split horizontal"` / `"Split vertical"` with `description` naming the pane geometry, and `mapLabel: "split \|"` / `"split -"` | Intake assumption 7 delegates exact strings to apply within the decided contract; these match the overlay's sentence-case label + lowercase description + short mapLabel conventions observed across the existing rows | S:80 R:95 A:85 D:85 |
| 4 | Confident | The board rows' `label`/`mapLabel` mirror the terminal rows' but name the focused pane (`"Split focused pane horizontal"`), with no `description` — matching the board pane-cycle rows, which carry a label only | Observed convention: `board-cycle-next`/`-prev` ship `label` with no `description`/`mapLabel`; the split rows keep `mapLabel` because the tier map benefits from the divider glyph | S:70 R:95 A:85 D:75 |
| 5 | Confident | A dedicated claims spec (T009) is worth adding even though `ships conflict-free defaults in every host` already passes | The conflict-freedom argument rests on two separate mechanisms (unclaimed keys + non-colliding tiers) that the aggregate test does not name; an explicit spec is what makes a future ⌘-tier claim addition fail loudly here rather than silently disabling a chord | S:70 R:95 A:85 D:80 |

5 assumptions (3 certain, 2 confident, 0 tentative).
