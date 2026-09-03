# Plan: Remove the ⌘. view-cycle chord

**Change**: 260826-sfsv-remove-cmd-dot-view-cycle
**Intake**: `intake.md`

## Requirements

### Keyboard: the `view-cycle` binding is retired

#### R1: No default binding occupies `Period`
`DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` SHALL contain no row with `code: "Period"` on any tier, and no row with `actionId: "view-cycle"`. The freed keycap SHALL be recorded as deliberately unbound in a comment beside the existing `KeyP` / ⇧⌘digit reservations, stating the constraint (do not spend ⌘. — it is the macOS Cancel/Stop chord; `settings-open` stays on the OS-conventional ⌘,). The `Period: "."` keycap glyph in the formatting map MUST remain so a user override placed on Period still renders.

- **GIVEN** the resolved binding set on any platform/host
- **WHEN** it is searched for `code === "Period"` or `actionId === "view-cycle"`
- **THEN** nothing is found
- **AND** `formatCombo({ code: "Period", tier: "cmd" }, "mac")` still yields `⌘.`

#### R2: ⌘. / Ctrl+. no longer switches the lens
The window-level `keydown` listener in `app.tsx` that called `switchView(nextView(…))`, together with `viewCycleRef` / `viewCycleBindingRef`, SHALL be removed. A ⌘. (or Ctrl+.) keydown on a window route MUST leave the resolved view unchanged and MUST NOT be `preventDefault()`ed by run-kit (it falls through — to the embedded app inside a lens iframe, to nothing on a tty tile).

- **GIVEN** a window route with ≥2 available lenses, `tty` active
- **WHEN** the user presses ⌘. (mac) or Ctrl+. (win/linux)
- **THEN** the active lens is still `tty`
- **AND** the event's `defaultPrevented` is `false`

#### R3: `View:` palette entries carry no shortcut hint
`buildViewActions` (`lib/palette/view.ts`) SHALL drop the `hints` parameter, the `ViewShortcutHints` type, `CYCLE_SHORTCUT`, and `shortcutFor`; every `View: <lens>` entry's `shortcut` SHALL be `""` (as `View: Chat` already is). The caller in `app.tsx` SHALL pass no hints argument. Chat, tty, web, and code remain reachable through the `View:` entries exactly as before.

- **GIVEN** `buildViewActions(["chat","web","tty"], "tty", onSwitch)`
- **WHEN** the result is inspected
- **THEN** it contains `view-chat` and `view-web`, each with `shortcut === ""`
- **AND** selecting `view-chat` calls `onSwitch("chat")`

#### R4: Stale per-device overrides for `view-cycle` are inert
`resolveBindings` SHALL ignore an override whose `actionId` matches no `DEFAULT_BINDINGS` row (e.g. a pre-existing `localStorage["runkit-keybindings"]` entry `{"view-cycle": {"code":"Period","tier":"cmd"}}`): no throw, no extra resolved row, no participation in conflict detection. (This already holds because resolution iterates `DEFAULT_BINDINGS`; the requirement pins it with a test.)

- **GIVEN** overrides `{ "view-cycle": { code: "Period", tier: "cmd" } }`
- **WHEN** `resolveBindings` runs
- **THEN** the resolved list has exactly `DEFAULT_BINDINGS.length` rows and none is `view-cycle`
- **AND** `findConflicts` over that list reports nothing involving `view-cycle`

#### R5: No dead code or stale prose remains
`nextView` in `lib/window-view.ts` (single caller removed) and its `describe` block in `window-view.test.ts` SHALL be deleted. Prose mentions of the ⌘. lens cycle in `keybindings.ts` (module header, `cmd` tier docstring, `layout-cycle` and `focus-hop` comments), `app.tsx` (the `useKeybindings` and reclaim-predicate comments, the `View:` palette comment), `window-view.ts` (module/R8 docstring), and `lib/window-transition.ts:585` SHALL be updated so no comment describes a chord that no longer exists.

- **GIVEN** `grep -rn "view-cycle\|⌘\. lens\|Cmd+\. view\|Cmd/Ctrl+\." app/frontend/src`
- **WHEN** run after apply
- **THEN** the only hits are the deliberately-unbound comment (R1) and test names that assert the chord is gone

#### R6: Existing keybinding tests keep their coverage
Tests in `lib/keybindings.test.ts` that used `view-cycle` as an *actor* (override-conflict with `focus-hop`, terminal-vs-board scope capture, iframe reclaim of a `cmd`-tier terminal chord, palette-parity map) SHALL be re-expressed with `layout-cycle` (`Semicolon`, `cmd`, terminal) rather than deleted, so the conflict-scoping, reclaim, and override rules stay tested. A negative reclaim assertion SHALL be added: `hasReclaimableMatch(⌘Period)` is `false` in both `code` and `web` iframe kinds.

- **GIVEN** the updated `keybindings.test.ts`
- **WHEN** `just test-frontend` runs
- **THEN** every suite passes and the conflict/scope/reclaim describe blocks still exist

### Deprecated Requirements

#### `view-cycle` lens cycle chord (⌘. / Ctrl+.)
**Reason**: chat is in the cycle whenever a `chatProvider` is set, so a stray ⌘. (the macOS Cancel chord, adjacent to ⌘,) repeatedly lands users on the Chat view, undermining chat's deliberate demotion (no top-bar toggle, palette-only). The cycle added no capability not already covered by ⌘1/⌘2/⌘3 and the `View:` palette entries.
**Migration**: `View: Terminal/Web/Code/Chat` palette entries (desktop), `Tile: Show <Surface>` / the top-bar switch group (mobile), ⌘1/⌘2/⌘3 tile toggles. ⌘. is left unbound.

### Non-Goals
- Moving `settings-open` to ⌘. — rejected by the user; ⌘, is the macOS-wide Preferences convention.
- Any mac-browser fallback chord for settings — would break the registry's one-canonical-chord-per-action rule.
- Removing `?view=chat` / `?layout=single:chat` deep links — URLs are not shortcuts and are load-bearing for e2e.
- Touching ⌘K, ⌘; (`layout-cycle`), ⌘[/⌘], ⌘1/2/3, or the mobile switch group.

### Design Decisions

#### `Period` is deliberately unbound; `settings-open` stays on ⌘,
**Decision**: retire `view-cycle` outright and leave ⌘./Ctrl+. unbound on every tier, recorded like the reserved `KeyP`; `settings-open` keeps `Comma` (`shifted`, `macTier: "cmd"`).
**Why**: ⌘, is the macOS Preferences chord in the HIG, VS Code, Slack, iTerm2, Chrome, Safari, and Xcode; ⌘. means Cancel in macOS dialogs, Stop in Safari/Xcode, Quick Fix in VS Code — a Cancel/Stop-flavored chord is the wrong home for Settings, and its reflex-hit nature is exactly why the lens cycle on it was a footgun.
**Rejected**: moving settings to ⌘. (works in mac browsers, but abandons the universal convention); a mac-browser-only ⌘. fallback (a second canonical chord for one action — a new refinement mechanism); skipping only `chat` in the cycle (keeps a redundant chord whose registry description would then lie).
*Introduced by*: 260826-sfsv-remove-cmd-dot-view-cycle

#### `View:` palette entries render no shortcut hint
**Decision**: drop the hint plumbing entirely rather than hint ⌘1/⌘2/⌘3 on `View: Terminal/Code/Web`.
**Why**: the digit chords are three-state tile *toggles* (show+focus / focus / hide) on the layout model, not single-tile lens switches — advertising them on a `View:` entry would misdescribe what the chord does. `View: Chat` already renders no hint, so the entries become uniform.
**Rejected**: keeping `ViewShortcutHints` with an always-empty value (dead parameter).
*Introduced by*: 260826-sfsv-remove-cmd-dot-view-cycle

## Tasks

### Phase 1: Core Implementation

- [x] T001 Remove the `view-cycle` row from `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts`; add the deliberately-unbound `Period` comment beside the `KeyP`/⇧⌘digit reservations; update the module header, `cmd`-tier docstring, `layout-cycle` comment, and `focus-hop` comment so none names the ⌘. lens cycle; keep `Period: "."` in the keycap map <!-- R1, R5 -->
- [x] T002 In `app/frontend/src/app.tsx` delete the ⌘. `useEffect` listener, `viewCycleRef`, `viewCycleBindingRef`, and the `nextView` import; update the `useKeybindings`, reclaim-predicate, and `View:` palette comments; call `buildViewActions(currentViews, resolvedView, switchView)` with no hints. Delete `nextView` from `app/frontend/src/lib/window-view.ts` (and fix its module docstring); fix the `Cmd+. view cycle` example in `app/frontend/src/lib/window-transition.ts` AND drop the `Ctrl+.` mask-exemption branch in `isMaskExemptKey` (`key === "."`), its docstring bullet, and its assertion in `window-transition.test.ts` (Ctrl+. is now pty-bound input and stays swallowed) <!-- R2, R3, R5 -->
- [x] T003 In `app/frontend/src/lib/palette/view.ts` remove `CYCLE_SHORTCUT`, `ViewShortcutHints`, `shortcutFor`, and the `hints` parameter so every entry's `shortcut` is `""`; rewrite the module docstring; update `app/frontend/src/lib/palette/view.test.ts` expectations (all hints `""`, drop the effective-binding-hints describe) <!-- R3 -->

### Phase 2: Tests

- [x] T004 Update `app/frontend/src/lib/keybindings.test.ts`: replace the `view-cycle` resolution assertion (~L204) with "no default binding on `Period`"; drop `view-cycle` from the palette-parity map (~L743); re-express the ⌘` override-conflict (~L1074–1084), the terminal-vs-board scope capture (~L1226–1231), and the reclaim cases (~L2175–2176) with `layout-cycle`/`Semicolon`; add the negative reclaim assertion for ⌘Period; add a `resolveBindings` test for a stale `view-cycle` override (R4). Delete the `nextView` describe in `app/frontend/src/lib/window-view.test.ts`. Grep `src/**/*.test.tsx` for `code: "Period"` and convert any lens-switch assertion to a negative one (R2) <!-- R1, R2, R4, R6 -->
- [x] T005 Verify: `pnpm -C app/frontend exec tsc --noEmit`; `just test-frontend`; `just test-e2e "web-view-lens"` and `just test-e2e "chat-view"` as the sibling-surface smoke (palette is now the sole lens path); final `grep` per R5 <!-- R5, R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` has no `Period` row and no `view-cycle` actionId; a deliberately-unbound comment for `Period` sits beside the `KeyP` reservation
- [x] A-002 R2: The ⌘. listener, `viewCycleRef`, and `viewCycleBindingRef` are gone from `app.tsx`
- [x] A-003 R3: `buildViewActions` has the 3-arg signature and every returned entry has `shortcut === ""`
- [x] A-004 R4: A unit test proves a stale `view-cycle` override is ignored by `resolveBindings`
- [x] A-005 R5: `nextView` no longer exists in `window-view.ts`; the R5 grep returns only the unbound comment and test names

### Behavioral Correctness

- [x] A-006 R2: A test dispatches a ⌘Period keydown on a multi-lens window and asserts the lens is unchanged and `defaultPrevented` is false — satisfied via the reclaim predicate's negative case (keybindings.test.ts:2200-2202 asserts `hasReclaimableMatch(⌘Period)` is `false` in both iframe kinds); no app-level ⌘. keydown test existed before (no `code: "Period"` in any `*.test.tsx`), per `## Assumptions` #3
- [x] A-007 R3: `View: Chat`, `View: Web`, `View: Terminal`, `View: Code` still appear (gated available-and-not-current) and still switch the lens on select

### Removal Verification

- [x] A-008 R1: `formatCombo({code:"Period",tier:"cmd"}, "mac")` still returns `⌘.` (glyph map retained for user overrides)
- [x] A-009 R5: No comment in `keybindings.ts`, `app.tsx`, `window-view.ts`, `window-transition.ts`, or `palette/view.ts` describes a live ⌘. lens cycle — cycle 2 removed the `isMaskExemptKey` `key === "."` branch (Ctrl+. now stays swallowed during a transition), its docstring bullet, and the stale test assertion (`window-transition.test.ts` now asserts the exemption is gone); zero `view-cycle`/`viewCycle` references remain in the five files

### Scenario Coverage

- [x] A-010 R6: The override-conflict, terminal-vs-board scope, iframe-reclaim, and palette-parity tests still exist, now driven by `layout-cycle`
- [x] A-011 R6: `hasReclaimableMatch(⌘Period)` is asserted `false` for both `code` and `web` iframe kinds

### Edge Cases & Error Handling

- [x] A-012 R4: `parseOverrides` + `resolveBindings` with a `view-cycle` key neither throws nor yields a phantom row

### Code Quality

- [x] A-013 Pattern consistency: edits follow the registry's data-row + rationale-comment style and the pure-helper + colocated-test pattern
- [x] A-014 No unnecessary duplication: no replacement helper or hint plumbing introduced
- [x] A-015 Comment narration: new comments state constraints (do not spend `Period`), not change IDs or next-line narration
- [x] A-016 Tests cover the changed behavior (`just test-frontend` green: 175 files / 3549 tests; `tsc --noEmit` clean; sibling e2e per `## Notes (apply)` — chat-view green, web-view-lens failures pre-existing on origin/main)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `layout-cycle` (⌘;) is the replacement actor for tests that need a `cmd`-tier terminal-scope binding | Same tier and scope as `view-cycle`; already exists in the registry | S:80 R:95 A:95 D:90 |
| 2 | Confident | R4 needs only a test, no code change | `resolveBindings` iterates `DEFAULT_BINDINGS` and indexes overrides by `def.actionId` (keybindings.ts:678), so unknown ids are never visited | S:70 R:95 A:90 D:85 |
| 3 | Confident | The app-level negative keydown test (A-006) is satisfied by the reclaim predicate's negative case if no prior app-level ⌘. test exists | The listener is deleted wholesale; a DOM-level test of a removed listener adds little over the registry-level proof | S:60 R:90 A:80 D:70 |

3 assumptions (1 certain, 2 confident).

## Notes (apply)

- `just test-e2e web-view-lens chat-view`: chat-view green; `web-view-lens.spec.ts` fails 3 tests (`:138`, `:295`, `:335`) with 10s `toBeVisible` timeouts on the Connected dot / iframe / onboarding tile. The identical 3 fail on a clean `origin/main` checkout (5bace0f3) in this worktree — pre-existing environment failure, not caused by this change. The 7 palette-driven lens-switch tests in that spec pass.
