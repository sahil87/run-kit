# Plan: Hidden-Feature Education Micro-Copy

**Change**: 260811-ke2s-hidden-feature-education-microcopy
**Intake**: `intake.md`

## Requirements

### Compose Surfaces: Placeholder Education

#### R1: Compose strip placeholder is mode-, platform-, and pointer-aware
The docked compose strip textarea (`app/frontend/src/components/compose-strip.tsx`, placeholder at ~:765-771) SHALL educate about the Enter policy and ↑ sent-history recall via its placeholder:
- Terminal target, fine pointer: `Compose text — Enter inserts · {submitKeycap} sends · ↑ history` where `{submitKeycap}` is `composeSubmitKeycap()` (`⌘Enter` / `Ctrl+Enter`).
- Selection broadcast, fine pointer: `Compose prompt — {submitKeycap} sends to all selected`.
- Coarse pointer: the pre-existing short strings (`Compose text…` / `Compose prompt…`).
- No-target state (both pointer types, no chord content): `No focused terminal — click a pane to target it`.

- **GIVEN** the compose strip is enabled with a focused terminal target on a fine-pointer device
- **WHEN** the textarea is empty
- **THEN** its placeholder names Enter-inserts, the platform-correct submit keycap, and ↑ history recall
- **AND** on a coarse pointer the placeholder stays the pre-existing short string

#### R2: Chat send box placeholder names the divergent Enter policy
The chat lens send textarea (`app/frontend/src/components/chat-view.tsx:288`) SHALL read `Message the agent — Enter for newline · {submitKeycap} sends` on fine pointers (chat's plain Enter is a local newline, diverging from the strip) and keep `Message the agent…` on coarse pointers.

- **GIVEN** a chat lens on a fine-pointer device
- **WHEN** the send textarea is empty
- **THEN** the placeholder names Enter=newline and the platform-correct submit keycap

### Command Palette: Discovery Copy

#### R3: Palette input placeholder advertises prefix namespaces
The command palette input (`app/frontend/src/components/command-palette.tsx:155`) SHALL read `Type a command — try Board: Pin: View: Window:` in its normal state. The confirming state's `Confirm action...` placeholder SHALL remain untouched. The hint is typed-namespace education (not a chord), so it does not branch on pointer type.

- **GIVEN** the palette is open and not in a confirmation step
- **WHEN** the input is empty
- **THEN** the placeholder names the `Board:`, `Pin:`, `View:`, and `Window:` prefixes

#### R4: Palette no-results row points at the prefix system
The palette's empty-result row (`app/frontend/src/components/command-palette.tsx:173`) SHALL read `No results — try a prefix: Board:, Pin:, View:, Window:` instead of bare `No results`.

- **GIVEN** the palette is open
- **WHEN** the query matches no action
- **THEN** the empty row names the prefix namespaces as the recovery path

### Empty States: Actionable Copy

#### R5: Sidebar no-sessions empty state names the create-session chord
The sidebar's empty session list (`app/frontend/src/components/sidebar/index.tsx` ~:2420) SHALL read `(no sessions — + new, or {chord})` where `{chord}` is the effective `create-session` binding formatted via `formatCombo`; the `, or {chord}` clause SHALL be omitted when the binding is unbound/disabled. The parenthesized terse style of surrounding sidebar copy is preserved.

- **GIVEN** a server group with zero sessions and a bound `create-session` keybinding
- **WHEN** the group is expanded
- **THEN** the empty-state button names both the `+ new` click path and the effective chord
- **AND** with `create-session` unbound the chord clause does not render

#### R6: Board empty state names the concrete pin affordances
The board page empty state (`app/frontend/src/components/board/board-page.tsx:1167`) SHALL read `No panes pinned to this board yet — hover a sidebar window row and click its 📌, or {paletteChord} → Pin:` where `{paletteChord}` is the effective `command-palette` binding via `useKeybindings()` + `formatCombo`; the `, or {paletteChord} → Pin:` clause SHALL be omitted when the binding is unbound/disabled.

- **GIVEN** a board with zero pinned panes
- **WHEN** the board route renders its empty state
- **THEN** the copy names both the sidebar row 📌 pin icon and the palette `Pin:` prefix route

#### R7: Host overview empty zones name their fill mechanism
Each empty zone on `/` (`app/frontend/src/components/host-overview-page.tsx`) SHALL state what fills it:
- BOARDS empty: `No boards yet — hover a sidebar window row and click its 📌, or {paletteChord} → Pin:` (same derivation/omission rule as R6).
- SERVICES empty (:400): `No services — listening TCP ports appear here automatically`.
- HOST HEALTH empty (:255): `No metrics — waiting for the host's first report`.

- **GIVEN** the host overview page with zero boards / zero services / no host metrics
- **WHEN** each zone renders its empty state
- **THEN** the copy names the mechanism that fills the zone instead of a bare label

#### R8: Shortcuts overlay no-match state scopes the filter
The shortcuts overlay's no-match line (`app/frontend/src/components/shortcuts-overlay.tsx:1130`) SHOULD read `no shortcuts match — try a shorter term · the filter spans app, custom & tmux keys` (light touch; the added fact is the filter's span).

- **GIVEN** the shortcuts overlay is open
- **WHEN** the filter matches no row in any section
- **THEN** the no-match line keeps the shorter-term advice and names the filter's span

### Sidebar: Selection Discoverability

#### R9: Selection indicator names ⇧click extension and the Selection: prefix
The sidebar's `SelectionIndicator` (`app/frontend/src/components/sidebar/index.tsx` ~:1703-1728) SHALL, whenever a selection is active, add a stateless `⇧click extends` clause (fine pointers only — keyboard-chord hints do not render on coarse pointers) and change its act clause from `{chord} to act` to `{chord} → Selection:` so the palette prefix is named. The existing count, `x to toggle`, `Esc to clear`, unbound-chord omission, and `hasSelectionActions` gating stay intact.

- **GIVEN** one or more window rows selected on a fine-pointer device
- **WHEN** the selection indicator renders
- **THEN** it reads `{count} selected · ⇧click extends · x to toggle · {paletteChord} → Selection: · Esc to clear`
- **AND** on a coarse pointer the `⇧click extends` clause is omitted

### Chrome Hints

#### R10: Window heading rename affordance exposes a visible hover hint
The `WindowHeading` rename button (`app/frontend/src/components/top-bar.tsx` ~:1680) SHALL carry a visible hover hint naming the rename action. **Already satisfied on the current build** — the button is wrapped in `Tip label="Click to rename"` (the Tier-1 form the intake allows; `aria-label="Rename window {name}"` is unchanged). This requirement is verify-only: confirm the hint exists and composes with the boot-sweep hover treatment; no code change.

- **GIVEN** a terminal route on a fine-pointer device
- **WHEN** the user hovers the center window-name button
- **THEN** a Tier-1 Tip naming "Click to rename" appears (and the boot sweep is undisturbed)

#### R11: Open split-button primary tip carries the open-last-used chord
The `OpenButton` primary segment's `Tip` (`app/frontend/src/components/open-button.tsx:112`) SHALL carry the effective `open-last-used` chord (default `⇧O`) in its existing `kbd` slot, derived via `useKeybindings().byAction.get("open-last-used")` + `formatCombo`, and SHALL omit the chip when the binding is unbound/disabled. The chevron Tip (`Open in… (choose app)`) is untouched.

- **GIVEN** a terminal route with the Open split-button visible and `open-last-used` bound
- **WHEN** the user hovers the primary segment
- **THEN** the tip shows the primary label plus the platform-correct open-last-used keycap
- **AND** with `open-last-used` unbound no keycap chip renders

### Cross-Cutting: Hint Integrity

#### R12: Rebindable-action chords are derived, never hardcoded
Any hint naming a rebindable action's chord (`create-session`, `command-palette`, `open-last-used`) MUST read the effective binding from `useKeybindings().byAction` and format it with `formatCombo(..., host.platform)`, and MUST omit the chord clause when the binding is unbound/disabled — the shortcuts overlay's `sheetChord` rule (shortcuts-overlay.tsx:500-509). Fixed Enter-policy chords (owned by `classifyComposeEnter`) use the existing `composeSubmitKeycap()` seam.

- **GIVEN** a hint that names a registry-bound action's chord
- **WHEN** the user rebinds or unbinds that action
- **THEN** the hint reflects the override (or drops the clause) on next render, with no hardcoded chord left behind

#### R13: Keyboard-chord hints stay off coarse pointers
Where a hint string exists to teach a keyboard chord, the chord-bearing form MUST NOT render on coarse pointers; touch keeps the pre-existing short copy, branched via the existing `useCoarsePointer()` hook (`hooks/use-coarse-pointer.ts`).

- **GIVEN** a coarse-pointer device
- **WHEN** a placeholder/hint that branches on pointer type renders
- **THEN** the short, chord-free form is shown

### Non-Goals

- C10 (persistent `⌘K commands · ⌘/ shortcuts` corner anchor), D13 (`⇧A` WaitingBadge hint), D14 (lens-switch chord hints) — explicitly excluded by the user's scope selection.
- First-run onboarding tours, dismissible banners, rotating tip carousels — rejected in discussion (state to maintain / gimmicky).
- New routes, dialogs, or persistent state — stated constraint; this change is copy plus small Tip additions only.
- Changes to the confirming-state palette placeholder, the chevron Tip, or any `aria-label`.

### Design Decisions

#### Placeholder over inline legend for compose education
**Decision**: The compose strip teaches its Enter policy via the textarea placeholder, not an inline legend row.
**Why**: A placeholder costs no layout and cannot lie about mode (it is computed where the mode is known); a legend costs layout and can go stale.
**Rejected**: Inline legend row — superseded in discussion ("placeholder might be better than the legend, agreed").
*Introduced by*: 260811-ke2s-hidden-feature-education-microcopy

#### Stateless hints only
**Decision**: Every hint in this change renders from current state alone (selection active, binding bound, pointer type) — no first-time/dismissal tracking.
**Why**: The stated constraint excludes persistent state; stateless hints cannot get out of sync with a dismissal flag.
**Rejected**: First-time-only popups — require persistent state, out of scope.
*Introduced by*: 260811-ke2s-hidden-feature-education-microcopy

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] `app/frontend/src/components/compose-strip.tsx` — mode/platform/pointer-aware placeholder per R1: import `useCoarsePointer`, compute `composeSubmitKeycap()` once, branch the placeholder (terminal fine / selection fine / coarse short / no-target copy) <!-- R1 -->
- [x] T002 [P] `app/frontend/src/components/chat-view.tsx` — fine-pointer placeholder `Message the agent — Enter for newline · {composeSubmitKeycap()} sends`; coarse keeps `Message the agent…` (the file already imports `useCoarsePointer` + `composeSubmitKeycap`) <!-- R2 -->
- [x] T003 [P] `app/frontend/src/components/command-palette.tsx` — input placeholder `Type a command — try Board: Pin: View: Window:` (confirming state untouched) and no-results row `No results — try a prefix: Board:, Pin:, View:, Window:` <!-- R3 -->
- [x] T004 [P] `app/frontend/src/components/sidebar/index.tsx` — (a) no-sessions button copy `(no sessions — + new, or {chord})` with `create-session` chord derived in `ServerGroupInner` via `useKeybindings()` + `formatCombo`, clause omitted when unbound; (b) `SelectionIndicator` adds `⇧click extends` (fine pointers only, via `useCoarsePointer`) and renames the act clause to `{chord} → Selection:` <!-- R5 -->
- [x] T005 [P] `app/frontend/src/components/board/board-page.tsx` — empty-state copy per R6 with the `command-palette` chord derived via the already-imported `useKeybindings()`, clause omitted when unbound <!-- R6 -->
- [x] T006 [P] `app/frontend/src/components/host-overview-page.tsx` — empty-zone copy per R7 (BOARDS pin affordances with derived palette chord, SERVICES auto-detection line, HOST HEALTH waiting line) <!-- R7 -->
- [x] T007 [P] `app/frontend/src/components/shortcuts-overlay.tsx` — no-match line gains the filter-span clause per R8 <!-- R8 -->
- [x] T008 [P] `app/frontend/src/components/open-button.tsx` — primary `Tip` gains `kbd` with the derived `open-last-used` chord, omitted when unbound (import `useKeybindings` + `formatCombo`) <!-- R11 -->
- [x] T009 Verify R10: confirm `Tip label="Click to rename"` wraps the `WindowHeading` rename button in `app/frontend/src/components/top-bar.tsx` (expected already present at ~:1680 — no code change; record the finding) <!-- R10 -->

### Phase 3: Tests

- [x] T010 Update unit tests asserting changed strings: `app/frontend/src/components/command-palette.test.tsx`, `command-palette.boards.test.tsx`, `app.test.tsx` (placeholder lookups → `/^Type a command/`; `No results` → `/^No results/`), `app/frontend/src/components/sidebar.test.tsx` (`(no sessions — + new)` → new copy), `app/frontend/src/components/host-overview-page.test.tsx` (`No services`, `Pin a window to start a board` → new copy) <!-- R3 -->
- [x] T011 Add unit tests in `app/frontend/src/components/compose-strip.test.tsx` for the mode-aware placeholder: terminal fine-pointer (Enter inserts · keycap · ↑ history), selection fine-pointer, coarse-pointer short strings (the file's existing `stubMatchMedia` seam), and the no-target copy <!-- R1 -->
- [x] T012 [P] Add unit tests for the unbound-chord omission rule: `app/frontend/src/components/open-button.test.tsx` (primary tip kbd present by default, absent with `{"open-last-used": null}` override — the bottom-bar.test.tsx seeding precedent) and `app/frontend/src/components/sidebar.test.tsx` (no-sessions copy drops the chord clause with `{"create-session": null}`) <!-- R12 -->
- [x] T013 Update e2e specs that locate by the changed strings: `app/frontend/tests/e2e/` palette-input locators `getByPlaceholder("Type a command...")` → `getByPlaceholder("Type a command")` (open-in-app, shortcut-registry, create-server-waiting, boards-pin-flow, macro-riff-bindings, settings-dialog, agent-next-waiting, sidebar-multiselect specs) and `board-close-and-unpin.spec.ts` `No panes pinned to this board yet.` → new copy; update sibling `.spec.md` companions in the same commit per Constitution § Test Companion Docs <!-- R3 -->

### Phase 4: Verification

- [x] T014 Run `just test-frontend` and `cd app/frontend && npx tsc --noEmit`; run `just test-e2e "board-close-and-unpin"` (the spec asserting a changed string) plus one palette-locator spec (`just test-e2e "shortcut-registry"`) to validate the locator updates <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Compose strip placeholder shows the mode-aware education strings (terminal / selection / no-target) and the ↑ history hint, with platform-correct submit keycap
- [x] A-002 R2: Chat send box placeholder names Enter=newline and the submit keycap on fine pointers
- [x] A-003 R3: Palette input placeholder names the `Board: Pin: View: Window:` prefixes; confirming state keeps `Confirm action...`
- [x] A-004 R4: Palette no-results row names the prefix namespaces
- [x] A-005 R5: Sidebar no-sessions copy names `+ new` and the effective create-session chord (omitted when unbound)
- [x] A-006 R6: Board empty state names the sidebar 📌 pin icon and the `Pin:` palette prefix (chord derived, omitted when unbound)
- [x] A-007 R7: Host overview BOARDS / SERVICES / HOST HEALTH empty zones each name their fill mechanism
- [x] A-008 R8: Shortcuts overlay no-match line mentions the filter spans app, custom & tmux keys
- [x] A-009 R9: Selection indicator shows `⇧click extends` (fine pointer) and names `→ Selection:`
- [x] A-010 R10: Window heading rename button carries a visible "Click to rename" hover hint (verified — pre-existing Tier-1 Tip at top-bar.tsx:1680, boot sweep undisturbed on the outer span)
- [x] A-011 R11: Open split-button primary tip carries the derived open-last-used keycap, omitted when unbound
- [x] A-012 R12: Every registry-action chord in new copy is derived from `useKeybindings()` + `formatCombo`; no hardcoded `⌘K`/`⇧⌘N`/`⇧O` literals for rebindable actions
- [x] A-013 R13: No keyboard-chord hint renders on coarse pointers; the short pre-existing copy is kept there

### Behavioral Correctness

- [x] A-014 R1: On coarse pointers the compose strip and chat placeholders render exactly the pre-change short strings (`Compose text…` / `Compose prompt…` / `Message the agent…`)
- [x] A-015 R12: Unbinding `open-last-used` / `create-session` / `command-palette` removes the corresponding chord clause from the open-button tip, no-sessions copy, and board/boards empty states respectively

### Scenario Coverage

- [x] A-016 R1: Unit tests cover terminal-vs-selection-vs-coarse placeholder branches and the no-target copy
- [x] A-017 R12: Unit tests cover the omit-when-unbound rule for the open-button kbd and the no-sessions chord clause

### Edge Cases & Error Handling

- [x] A-018 R3: Palette confirming step still shows `Confirm action...` and is readOnly (unchanged behavior, covered by existing tests)
- [x] A-019 R5: No-sessions empty state still clicks through to `onCreateSession` (button behavior unchanged, copy-only edit)

### Code Quality

- [x] A-020 Readability over cleverness: placeholder/hint derivation stays inline and legible at each call site (at most the existing `composeSubmitKeycap()` seam reused; no new abstraction layer)
- [x] A-021 Type narrowing over type assertions in any new branching
- [x] A-022 Tests cover the added/changed behavior (placeholder modes, unbound omission) per code-quality.md
- [x] A-023 No magic strings without justification: copy strings are the deliverable itself; chords are derived, not literal
- [x] A-024 Pattern consistency: New code follows naming and structural patterns of surrounding code (Tip kbd derivation per shortcuts-overlay/sidebar-footer precedent)
- [x] A-025 No unnecessary duplication: `composeSubmitKeycap()`, `useCoarsePointer()`, `useKeybindings()`, `formatCombo` reused; no reimplemented platform/format logic

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new copy/hints without making existing code redundant; replaced strings were edited in place, no orphaned symbols or branches left behind

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | R10 (C11) is satisfied by the existing `Tip label="Click to rename"` on the `WindowHeading` rename button (top-bar.tsx:1680) — verify-only, no code change | Verified by reading the current build; the intake's condition "verify first that no hint already exists" resolves to "it does" | S:90 R:95 A:95 D:90 |
| 2 | Confident | B8 final copy: BOARDS `No boards yet — hover a sidebar window row and click its 📌, or {chord} → Pin:`, SERVICES `No services — listening TCP ports appear here automatically`, HOST HEALTH `No metrics — waiting for the host's first report` | Read each zone's fill mechanism (pin affordances; passive port enumeration with no config source; metrics stream) — the intake delegates exact wording to apply, bounded to real mechanisms | S:55 R:90 A:75 D:65 |
| 3 | Confident | D12's hint folds into the existing `SelectionIndicator` line (add `⇧click extends`, rename act clause to `{chord} → Selection:`) rather than a new element | The intake's "bulk-action surface" IS this indicator (the sidebar's only selection chrome); it already derives the palette chord and gates on `hasSelectionActions` | S:70 R:90 A:80 D:70 |
| 4 | Confident | The A3 palette placeholder does not branch on pointer type (prefix namespaces are typed, not chords — rule 2 governs chord hints only) | Rule 2 scopes coarse-pointer branching to keyboard-chord hints; `Board:`/`Pin:` prefixes are equally typed on touch | S:60 R:90 A:75 D:65 |
| 5 | Confident | RTL unit tests locate the palette input via `/^Type a command/` regex (robust to future copy tuning) instead of the full literal | Tests must conform to the new implementation; a prefix regex keeps the suite from re-breaking on wording tunes the intake explicitly permits | S:65 R:85 A:80 D:70 |
| 6 | Confident | B9 extends the existing line with the filter-span clause (rather than leaving as-is) | The intake offers both; the added fact (filter spans app + custom + tmux rows) is the educational payload and costs one clause | S:55 R:90 A:70 D:60 |
| 7 | Certain | jsdom resolves `detectPlatform()` to `other`, so unit tests assert platform-agnostic prefixes/regexes, not `⌘` literals | Established test-suite convention (tooltips.spec.md documents Playwright's Windows UA; jsdom has no mac UA) | S:80 R:90 A:90 D:85 |

7 assumptions (2 certain, 5 confident, 0 tentative).
