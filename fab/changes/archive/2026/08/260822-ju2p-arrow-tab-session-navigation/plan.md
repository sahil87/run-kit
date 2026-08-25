# Plan: Arrow-Key Tab & Session Navigation + Hosts H Rebind

**Change**: 260822-ju2p-arrow-tab-session-navigation
**Intake**: `intake.md`

## Requirements

### Keybindings: Window-pair rebind to arrows

#### R1: `window-prev`/`window-next` move to ↑/↓
The `window-prev`/`window-next` registry rows (`app/frontend/src/lib/keybindings.ts:232-233`) MUST rebind `code: "KeyH"`/`"KeyL"` → `"ArrowUp"`/`"ArrowDown"`, keeping base `tier: "shifted"` (⇧Ctrl+↑/↓ on Win/Linux) and adding `macTier: "cmd"` (⌘↑/⌘↓ in BOTH mac hosts). They MUST NOT carry `macShellOnly` and MUST NOT gain a `browser`-owner claim row (mac-browser ⌘↑/↓ is the page-interceptable scroll-to-top/bottom class). Labels stay `Previous tab`/`Next tab`; `mapLabel`s are carried for parity but unrendered (arrow codes have no keycap cells in the panel's `KEY_ROWS` grids — the `Comma`/`Backquote` no-cell precedent).

- **GIVEN** a macOS host (shell or browser) with no user overrides
- **WHEN** bindings resolve via `defaultComboFor`
- **THEN** `window-prev` is ⌘↑ and `window-next` is ⌘↓, both enabled
- **AND** on Win/Linux they resolve ⇧Ctrl+↑ / ⇧Ctrl+↓

#### R2: Tab cycling spans sessions
The `window-prev`/`window-next` behavior MUST cycle over the flattened list of ALL sessions' windows in sidebar order (the `useMergedSessions` array order at `app/frontend/src/app.tsx:620`), not the current session's windows only. Movement is one row with wraparound at the ends; crossing a session boundary lands on the adjacent session's edge window (last window of the previous session going up, first window of the next session going down). Navigation MUST go through the existing `navigateToWindow` path. Palette ids stay `window-prev`/`window-next` (labels `Tab: Previous`/`Tab: Next`), so `withShortcutHints` and `fromPalette` wiring is untouched. The flatten/step logic SHALL live in a pure, DOM-light lib module with colocated tests (the `tile-chord.ts`/`zen-mode.ts` convention).

- **GIVEN** sessions A (windows a1, a2) and B (windows b1) in sidebar order, current window a2
- **WHEN** `window-next` fires
- **THEN** navigation targets b1
- **AND** from b1, `window-next` wraps to a1; from a1, `window-prev` wraps to b1

### Keybindings: Session-jump pair

#### R3: New `session-prev`/`session-next` actions
Two new registry rows MUST be added: base `code: "ArrowLeft"`/`"ArrowRight"`, `tier: "shifted"`, `scope: "global"`, with `macCode: "ArrowUp"`/`"ArrowDown"` and NO `macTier` (stays shifted) — resolving ⇧⌘↑/⇧⌘↓ on mac (tier-disjoint from the cmd-tier window pair on the same codes — the mac split-pair precedent) and ⇧Ctrl+←/→ on Win/Linux. Behavior: jump to the adjacent session in sidebar order (wraparound), landing on that session's tmux-active window (`isActiveWindow`); when the target session has no `isActiveWindow` (stale-SSE edge), fall back to its first window in sidebar order — never skip the session. New palette entries `Session: Previous`/`Session: Next` with ids = actionIds (chord hints attach; handlers resolve through `fromPalette`), registered beside `windowCycleActions` in app.tsx and gated the same way (omitted when no window is current).

- **GIVEN** sessions A (active window a2), B (active window b1), current window a1
- **WHEN** `session-next` fires
- **THEN** navigation targets b1 (B's active window)
- **AND** from any window of B, `session-next` wraps to A's active window a2
- **GIVEN** the target session's snapshot has no `isActiveWindow` flag
- **WHEN** a session jump targets it
- **THEN** navigation lands on that session's first window in sidebar order

### Keybindings: Hosts menu on H

#### R4: `host-menu-open` moves KeyM → KeyH (SPA registry + welcome-page mirror)
The `host-menu-open` row (`keybindings.ts:243`) MUST change only `code: "KeyM"` → `"KeyH"` — shifted tier on every platform, no mac refinement, `mapLabel: "hosts"` (now matching its keycap). The component-local handler in `shell-titlebar-strip.tsx` reads the binding via `byAction` and follows automatically; comment mentions of ⇧⌘M update. The desktop shell's welcome page keeps its own local mirror of this chord (`app/desktop/src/welcome/welcome.ts:404` hardcodes `KeyM`) — it MUST move to `KeyH` in the same change so the documented mirror stays true, with its test and comment updated. The ⌥⌘1–9 / Alt+1–9 direct accelerators and all Electron menu accelerators are untouched.

- **GIVEN** the desktop shell with hosts configured
- **WHEN** ⇧⌘H (mac) / ⇧Ctrl+H (Win/Linux) is pressed in the SPA or on the welcome page
- **THEN** the hosts menu opens (SPA) / the host list's roving seat focuses (welcome), exactly as ⇧⌘M did before
- **AND** ⇧⌘M no longer triggers either surface

#### R5: Freed keys and conflict-free defaults
After the moves, shifted `KeyL` and shifted `KeyM` MUST be unbound on every platform with no new occupant; cmd-tier `web-address` (⌘L) and the cmd-tier ⌘H/⌘M Hide/minimize claims are untouched. The shipped defaults MUST remain conflict-free in every host per the `findConflicts` invariant test — which is why the H→arrows rebind and the M→H move land in this one change. The `DEFAULT_BINDINGS`-adjacent reservation comments (⇧⌘P, ⇧⌘digit) are untouched.

- **GIVEN** the shipped `DEFAULT_BINDINGS` after this change
- **WHEN** the conflict-free-defaults invariant test runs across all host shapes (mac shell, mac browser, Win/Linux)
- **THEN** `findConflicts` reports zero conflicts
- **AND** no binding resolves to shifted KeyL or shifted KeyM

#### R6: Terminal seam unchanged, covered
`attachCustomKeyEventHandler` / `shouldRefuseTerminalChord` MUST NOT change: rule 1 (refuse enabled shifted-tier matches, every platform) covers the session pair everywhere plus the window pair and hosts chord on Win/Linux; rule 2 (mac cmd-tier with `metaKey`) covers ⌘↑/⌘↓ under terminal focus on mac. Seam tests SHOULD cover the new arrow chords explicitly (refused-and-bubbled under terminal focus; plain and plain-Shift arrows still reach the pane).

- **GIVEN** a focused terminal on macOS
- **WHEN** ⌘↓ is pressed
- **THEN** the seam refuses it (not transmitted to the pane) and the window dispatcher fires `window-next`
- **AND** plain ↓ and Shift+↓ still reach the pane untouched

### Non-Goals

- No rename dialogs, board-route session nav, or sidebar roving-focus changes — the sidebar's own arrow-key tree navigation (while the sidebar owns focus) is untouched.
- No backend, API, or route changes; no Electron menu/accelerator changes.
- No keycap cells for arrow codes in the shortcuts panel's `KEY_ROWS` grids (no-cell precedent); no new claims data.

### Design Decisions

#### Cross-session cycle logic as a pure lib module
**Decision**: Extract the flatten/step/jump target resolution into `app/frontend/src/lib/window-cycle.ts` (pure functions over the sessions array + current windowId, returning a target windowId or null) with colocated `window-cycle.test.ts`; app.tsx memos become thin wrappers.
**Why**: The registry convention (`keybindings.ts`, `tile-chord.ts`, `zen-mode.ts`) keeps decision logic pure, DOM-light, and unit-tested; the boundary/wrap/fallback cases are exactly the kind of edge matrix Vitest covers cheaply.
**Rejected**: Growing the inline `windowCycleActions` closure in app.tsx — boundary cases would be testable only through component tests.
*Introduced by*: 260822-ju2p-arrow-tab-session-navigation

#### Welcome-page mirror moves in the same change
**Decision**: Update `welcome.ts`'s hardcoded `KeyM` chord match to `KeyH` alongside the registry move.
**Why**: The memory-documented contract is that welcome.ts "mirrors the SPA registry's `host-menu-open` binding"; leaving it on M silently splits the chord across the two surfaces.
**Rejected**: Deferring to a follow-up — the mirror claim would be false in the shipped state.
*Introduced by*: 260822-ju2p-arrow-tab-session-navigation

## Tasks

### Phase 2: Core Implementation

- [x] T001 Registry data: in `app/frontend/src/lib/keybindings.ts` rebind `window-prev`/`window-next` to `ArrowUp`/`ArrowDown` (+`macTier: "cmd"`), add `session-prev`/`session-next` rows (`ArrowLeft`/`ArrowRight` shifted, `macCode: "ArrowUp"`/`"ArrowDown"`, labels/descriptions/mapLabels), move `host-menu-open` to `KeyH`; update adjacent comments (H/L pair rationale, freed M) <!-- R1, R3, R4, R5 -->
- [x] T002 Registry tests: update/extend `app/frontend/src/lib/keybindings.test.ts` — conflict-free-defaults invariant across all host shapes, `defaultComboFor` resolutions (⌘↑/⌘↓ mac both hosts; ⇧⌘↑/⇧⌘↓ mac session pair via macCode-stays-shifted; ⇧Ctrl+↑/↓ and ⇧Ctrl+←/→ Win/Linux; ⇧⌘H/⇧Ctrl+H hosts), seam-refusal coverage per R6 (mac cmd-tier arrows refused with metaKey; shifted arrows refused everywhere; plain/plain-Shift arrows never refused), shifted KeyL/KeyM unbound <!-- R1, R3, R5, R6 -->
- [x] T003 [P] Pure cycle/jump logic: create `app/frontend/src/lib/window-cycle.ts` (flattened cross-session window step with wrap; session jump to adjacent session's `isActiveWindow` with first-window fallback) + colocated `window-cycle.test.ts` covering boundary crossing, wraparound, single-session, single-window, missing current window, and no-active-window fallback <!-- R2, R3 -->
- [x] T004 Wire app.tsx: rewrite `windowCycleActions` (app.tsx ~3493) over the merged `sessions` array using `lib/window-cycle.ts`; add the `Session: Previous`/`Session: Next` palette memo and `session-prev`/`session-next` entries in `keybindingHandlers` via `fromPalette`; update the stale "current session's sidebar order" comments (~3485-3492, ~3563-3565) <!-- R2, R3 -->
- [x] T005 Welcome mirror: in `app/desktop/src/welcome/welcome.ts` move the chord match `KeyM` → `KeyH` (line ~404) and update its comment (~401) and the welcome test's chord simulations <!-- R4 -->
- [x] T006 [P] Chord-reference sweep: update `shell-titlebar-strip.tsx` / `shell-titlebar-strip.test.tsx` ⇧⌘M comment+test references to ⇧⌘H; sweep `settings-shortcuts-panel.test.tsx` and any unit/e2e tests asserting the old ⇧⌘H/⇧Ctrl+H (window-prev), ⇧Ctrl+L (window-next), or ⇧⌘M chords; update affected `.spec.md` companions in the same commit (use `grep -a` — one frontend file is NUL-poisoned for plain grep) <!-- R1, R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 E2E coverage: add/extend a Playwright spec (port-3020 isolation via `just test-e2e`) proving ⇧Ctrl+↓ steps across a session boundary and ⇧Ctrl+→ jumps to the adjacent session's active window on a two-session fixture, with wraparound; ship the sibling `.spec.md` companion per constitution <!-- R2, R3 -->
- [x] T008 Verification gates: `just test-backend` untouched-scope sanity, `cd app/frontend && npx tsc --noEmit`, targeted Vitest suites (keybindings, window-cycle, welcome, titlebar strip, shortcuts panel), then the new/affected e2e specs via `just test-e2e "<spec>"` <!-- R1, R2, R3, R4, R5, R6 -->

## Execution Order

- T001 blocks T002, T004, T005, T006 (registry shape first)
- T003 is independent, can run alongside T001-T002; T004 depends on T001+T003
- T007 depends on T004; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `window-prev`/`window-next` resolve ⌘↑/⌘↓ on mac (both hosts) and ⇧Ctrl+↑/↓ on Win/Linux, enabled, no `macShellOnly`, no new claim rows
- [x] A-002 R2: Tab cycling walks the flattened all-sessions window list in sidebar order with wraparound, via `navigateToWindow`
- [x] A-003 R3: `session-prev`/`session-next` exist with the specified encoding (⇧⌘↑/⇧⌘↓ mac, ⇧Ctrl+←/→ Win/Linux), palette entries `Session: Previous`/`Session: Next`, and jump to the adjacent session's active window
- [x] A-004 R4: `host-menu-open` is shifted `KeyH` everywhere; the titlebar strip opens on it; welcome.ts's local mirror matches `KeyH`; no ⇧⌘M behavior remains on either surface

### Behavioral Correctness

- [x] A-005 R2: Crossing a session boundary lands on the adjacent session's edge window (last going up, first going down) — changed from the prior current-session-only wrap
- [x] A-006 R3: Session jumps land on `isActiveWindow`, not first-in-sidebar-order (except the documented fallback)

### Scenario Coverage

- [x] A-007 R2: Unit tests cover boundary crossing, wraparound, single-session, and single-window shapes; an e2e proves the cross-session step on a live two-session fixture with a `.spec.md` companion
- [x] A-008 R6: Seam tests prove mac ⌘↑/⌘↓ and shifted arrow chords are refused-and-bubbled under terminal focus while plain and plain-Shift arrows reach the pane

### Edge Cases & Error Handling

- [x] A-009 R3: A target session with no `isActiveWindow` falls back to its first window in sidebar order; a missing current window (stale `windowParam`) is a no-op, not a throw
- [x] A-010 R5: `findConflicts` reports zero conflicts over the shipped defaults in every host shape; shifted KeyL and KeyM resolve unbound

### Code Quality

- [x] A-011 Pattern consistency: new logic follows the pure-lib + colocated-test convention; registry changes are data-only (no resolver branches)
- [x] A-012 No unnecessary duplication: cycle/jump target resolution lives once in `lib/window-cycle.ts`; app.tsx memos are thin wrappers
- [x] A-013 No comment narration: comments state invariants/cross-file contracts only (e.g. the welcome.ts mirror), no change-ID citations in code
- [x] A-014 Tests included for added/changed behavior (Vitest + Playwright with `.spec.md` companions per constitution)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (session-jump pair, cross-session flatten) and re-keys existing bindings without making existing code redundant; no unused symbols, files, or config were left behind by the diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Cross-session cycle/jump logic extracted to pure `lib/window-cycle.ts` + colocated tests | Established registry convention (`tile-chord.ts`, `zen-mode.ts`); intake delegates structure to the plan | S:85 R:90 A:90 D:85 |
| 2 | Certain | `welcome.ts`'s local ⇧⌘M mirror moves to KeyH in this change | Grounded: welcome.ts:404 hardcodes KeyM and desktop-shell memory documents it as a mirror of the SPA binding; leaving it splits the chord | S:90 R:90 A:90 D:90 |
| 3 | Confident | Arrow rows keep `mapLabel`s carried-for-parity-but-unrendered (no `KEY_ROWS` cells added) | `KEY_ROWS` grids are letter/digit-only; the `Comma`/`Backquote`/`settings-open` precedent; intake suggested this treatment | S:75 R:90 A:85 D:80 |
| 4 | Confident | Palette labels `Session: Previous` / `Session: Next` | Intake's suggested wording; mirrors `Tab: Previous`/`Tab: Next` | S:70 R:95 A:85 D:75 |
| 5 | Confident | `session-prev`/`session-next` ride `scope: "global"` and the `windowCycleActions` gating (omitted when no window is current) | Mirrors the window pair exactly; scope is descriptive, handler presence gates applicability | S:70 R:85 A:85 D:75 |
| 6 | Confident | E2E asserts the Linux chords (⇧Ctrl+↓/→) on the two-session fixture; mac resolutions are covered by unit tests only | Playwright rig is Linux; `defaultComboFor` mac paths are pure and unit-testable | S:75 R:85 A:85 D:80 |
| 7 | Certain | T007 lands as a new test inside the existing `shortcut-registry.spec.ts` (with its `.spec.md` companion updated), not a new spec file | The plan allows add/extend; the spec already owns the window-cycling describe and its mocked two-session fixture shape | S:85 R:90 A:90 D:85 |
| 8 | Certain | T005 has no test edit: no `welcome.test.*` file exists, so only the chord match and its comments moved | Grounded: `app/desktop/src/welcome/` holds only welcome.ts + welcome.html | S:90 R:90 A:90 D:90 |
| 9 | Certain | The mac spoofed-platform e2e presses `Meta+ArrowDown` for window cycling (⌘↑/⌘↓ demote in both mac hosts) instead of the old "H/L stay shifted" assertion | Follows directly from R1's no-`macShellOnly` decision | S:85 R:90 A:85 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative).
