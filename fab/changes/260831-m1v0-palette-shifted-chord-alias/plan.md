# Plan: Second Palette Chord for Win/Linux Terminal Focus

**Change**: 260831-m1v0-palette-shifted-chord-alias
**Intake**: `intake.md`

## Requirements

### Keybindings: Alias Bindings

#### R1: A binding MAY alias another action's handler
`KeyBinding` SHALL support an optional `aliasOf?: string` naming the `actionId` whose handler the binding fires. The dispatcher SHALL resolve a matched binding's handler through `aliasOf` when present, and through `actionId` otherwise.

- **GIVEN** a binding `{ actionId: "command-palette-alt", aliasOf: "command-palette" }`
- **WHEN** its combo is pressed and a handler exists for `command-palette`
- **THEN** that handler fires
- **AND** no handler needs to be registered under `command-palette-alt`

- **GIVEN** a binding with no `aliasOf`
- **WHEN** its combo is pressed
- **THEN** handler resolution is byte-identical to today (`handlers[binding.actionId]`)

#### R2: The palette answers to ⇧Ctrl+K on Win/Linux, and mac is untouched
A second registry row SHALL bind `command-palette` on the `shifted` tier for Windows and Linux, and SHALL be keyless on macOS via `macCode: ""`.

- **GIVEN** a Linux or Windows host
- **WHEN** the user presses ⇧Ctrl+K
- **THEN** the command palette opens
- **AND** plain Ctrl+K continues to open it exactly as before

- **GIVEN** a macOS host (shell or browser)
- **WHEN** the effective map is resolved
- **THEN** ⌘K is the palette's only enabled chord, and the alias row resolves UNBOUND
- **AND** every mac-visible behavior — chord, hint, keycap grid — is identical to before this change

#### R3: The alias reaches the palette under terminal focus
The alias SHALL fire while the xterm terminal owns focus, without any change to `terminal-client.tsx` or `shouldRefuseTerminalChord`.

- **GIVEN** a Linux host with the terminal focused
- **WHEN** the user presses ⇧Ctrl+K
- **THEN** the terminal seam's rule 1 refuses the shifted-tier match, the event bubbles, and the palette opens
- **AND** pressing plain Ctrl+K in the same state still sends `0x0B` to the pane, unchanged

#### R4: An aliased action's chords are discoverable without advertising a dead one
Surfaces that list shortcuts SHALL show both chords for an aliased action; the single-chord hint SHALL continue to name the primary binding.

- **GIVEN** a Linux host and the Settings → Shortcuts panel
- **WHEN** the palette's row renders
- **THEN** both Ctrl+K and ⇧Ctrl+K are shown, grouped as one action rather than two unrelated rows

- **GIVEN** any host
- **WHEN** the compact palette hint renders (`withShortcutHints`)
- **THEN** it names the primary binding's combo, exactly as before this change

#### R5: An alias is independently rebindable and never self-conflicts
The alias SHALL carry its own override slot, and conflict detection SHALL NOT report an alias colliding with its own primary.

- **GIVEN** a user rebinds or unbinds the alias
- **WHEN** the effective map resolves
- **THEN** the primary binding is unaffected

- **GIVEN** the shipped defaults
- **WHEN** `findConflicts` runs on any host
- **THEN** no conflict is reported between `command-palette` and its alias

#### R6: The e2e opener presses the chord that survives terminal focus
`openPalette` in `app/frontend/tests/e2e/_ready.ts` SHALL press the alias chord, so its blur-on-retry becomes a fallback rather than the mechanism.

- **GIVEN** any e2e spec, including one where the terminal owns focus
- **WHEN** it calls `openPalette(page)`
- **THEN** the palette opens on the first attempt with no blur

### Non-Goals

- **No terminal-seam change.** Rule 1 already refuses every enabled shifted-tier match on every platform. Adding a rule would be redundant and would risk the plain-Ctrl guarantee the seam deliberately protects.
- **No retier of the existing binding.** Moving `command-palette` to the shifted tier would regress Firefox users, who cannot intercept ⇧Ctrl+K. Explicitly rejected by the user.
- **No interception of plain Ctrl+K.** It is `0x0B` — readline/ZLE `kill-line`. Swallowing it is a loss with no recourse short of a per-device unbind.
- **No Firefox entry in the claimed-keys table** — see Design Decisions; deferred deliberately, not overlooked.
- **No general multi-chord-per-action feature.** `aliasOf` is a single, narrowly-scoped field; this change does not build a general "N chords per action" model.

### Design Decisions

#### `aliasOf` on the binding, not a bare second actionId

**Decision**: Add an optional `aliasOf?: string` to `KeyBinding`, and resolve the dispatcher's handler lookup through it.
**Why**: `actionId` doubles as the **palette action id** (`withShortcutHints`'s contract states this). A free-standing `command-palette-alt` actionId is therefore a phantom action — it risks surfacing wherever bindings are enumerated to build UI, and it forces a duplicate handler-map entry that can silently drift from the primary's. `aliasOf` makes the relationship explicit in data, costs the dispatcher one line (`handlers[binding.aliasOf ?? binding.actionId]`), needs no handler wiring at all, and matches the declarative `ttyOnly` / `webOnly` / `macTier` precedent this registry already uses for per-binding refinements.
**Rejected**: A distinct actionId with its own handler entry (cheaper, but creates a phantom palette action and duplicated wiring); making `byAction` multi-valued (`Map<string, EffectiveBinding[]>` would touch every consumer for one binding's benefit).
*Introduced by*: 260831-m1v0-palette-shifted-chord-alias

#### The alias is keyless on macOS via `macCode: ""`

**Decision**: The alias row carries `code: "KeyK", macCode: "", tier: "shifted"`.
**Why**: A shifted-tier `KeyK` row with no refinement would resolve on **every** platform, giving mac a new ⇧⌘K chord — violating the requirement that mac be byte-identical. `defaultComboFor` returns `{ code: macCode ?? code }` on mac, and a `""` code resolves UNBOUND, so the empty string is the existing, precedented way to say "deliberately absent on mac" — `create-session` already ships exactly this.
**Rejected**: Omitting the mac refinement (adds an unrequested mac chord); a `platform` field on bindings (new axis for one row, when `macCode: ""` already expresses it).
*Introduced by*: 260831-m1v0-palette-shifted-chord-alias

#### Show both chords where there is room; keep the compact hint on the primary

**Decision**: The Settings → Shortcuts row and the status-bar / bottom-bar Tips render both chords for an aliased action. The compact palette hint (`withShortcutHints`) keeps naming the primary — Ctrl+K on Win/Linux, ⌘K on mac — unchanged.
**Why**: Advertising ⇧Ctrl+K as the *single* hint would be actively worse for Firefox users, whose browser eats that chord — we would be replacing a chord that works off-terminal with one that never works, in the one place users look. Keeping the hint on the primary means **no display regression on any host**, while the richer surfaces still make the working chord discoverable. It also decouples this change from the unverified Firefox question.
**Rejected**: Hinting ⇧Ctrl+K everywhere as "the chord that always works" (better for Chrome, worse for Firefox, and rests on an untested claim); hinting both in the compact slot (the palette hint is a single tight string — two chords crowd it).
*Introduced by*: 260831-m1v0-palette-shifted-chord-alias

#### The Firefox claimed-key entry is deferred

**Decision**: Do not add a Firefox-vs-Chrome axis to the claimed-keys table in this change.
**Why**: Nothing regresses without it — Ctrl+K keeps working off-terminal in Firefox exactly as today, and because the compact hint stays on the primary (above), no Firefox user is shown a chord that cannot fire. The claims table models `platform` and shell-vs-browser but has **no browser-brand axis**; adding one is its own design step. Decisive constraint: the Firefox reservation is sourced from documentation, not testing — the e2e rig is Chromium-only — so encoding it as data would bake an unverified claim into the registry.
**Rejected**: Adding a `browser: "firefox"` claim now (encodes an untested assertion, and expands the claims model for a case that currently costs nothing).
*Introduced by*: 260831-m1v0-palette-shifted-chord-alias

## Tasks

### Phase 1: Alias Mechanism

- [x] T001 Add `aliasOf?: string` to `KeyBinding` (and carry it through `EffectiveBinding`) in `app/frontend/src/lib/keybindings.ts`; add the alias registry row beside `command-palette` at ~:317 as `{ actionId: "command-palette-alt", aliasOf: "command-palette", code: "KeyK", macCode: "", tier: "shifted", scope: "global", kind: "builtin", label: "Command palette", ignoreInputs: true }`; and resolve the handler through it in `app/frontend/src/hooks/use-keybinding-dispatch.ts` (`handlersRef.current[binding.aliasOf ?? binding.actionId]`). Add a `findConflicts` guard so a binding never conflicts with its own alias — `tiersCollide("cmd","shifted")` is already `false` so the shipped pair does not trip it, but the guard states the invariant rather than relying on the tier accident. <!-- R1, R2, R3, R5 -->

### Phase 2: Display

- [x] T002 Render both chords for an aliased action in the Settings → Shortcuts panel (`app/frontend/src/components/settings-shortcuts-panel.tsx`), grouped under the primary's row rather than as a second unrelated row; leave `withShortcutHints` in `keybindings.ts` naming the primary combo unchanged. Verify the mac path renders exactly as before (the alias resolves unbound there, the `create-session` precedent). <!-- R4 -->
- [x] T003 Audit the `chordFor`-fed Tip `kbd` labels on the status-bar and bottom-bar palette affordances (`status-bar.tsx:580`, `bottom-bar.tsx:465`): show both chords on Win/Linux where the Tip has room, and keep mac's single ⌘K. If a surface cannot fit two, keep the primary — never show only the alias. <!-- R4 -->

### Phase 3: Tests & Verification

- [x] T004 Update `openPalette` in `app/frontend/tests/e2e/_ready.ts` to press the alias chord (`Shift+Control+k` on the Linux rig) instead of `Meta+k`, and update its comment so the blur-on-retry is described as a fallback rather than the mechanism. Confirm the previously-exempt raw-chord tests (`web-tile-find` (a), `code-surface`'s reclaim spike) still press their own bare chord and are unaffected. <!-- R6 -->
- [x] T005 Tests: extend `app/frontend/src/lib/keybindings.test.ts` with alias resolution (handler routes through `aliasOf`), per-platform presence (⇧Ctrl+K resolves on Linux/Windows, UNBOUND on mac), independent override round-trip (rebinding/unbinding the alias leaves the primary untouched), and no self-conflict; extend `settings-shortcuts-panel.test.tsx` for the grouped two-chord row. Run `just check`, `just test-frontend`, and `just test-e2e` over the palette-touching specs — naming which specs actually ran. Sweep the diff for `R#`/`T#`/change-id/PR-number comment provenance in src and tests. <!-- R1, R2, R4, R5, R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `KeyBinding` carries `aliasOf`, and the dispatcher resolves handlers through it
- [x] A-002 R2: ⇧Ctrl+K opens the palette on Linux/Windows, and plain Ctrl+K still does
- [x] A-003 R6: `openPalette` presses the alias chord and opens the palette first-attempt under terminal focus

### Behavioral Correctness

- [x] A-004 R2: On macOS the palette's only enabled chord is ⌘K; the alias resolves UNBOUND and no mac-visible surface changed — chords/hints/listener/conflicts verified byte-identical; one exception recorded as a review should-fix (the Shortcuts panel renders the unbound alias as an indented `↳ also` row on mac, matching the `create-session` unbound-row convention)
- [x] A-005 R3: `terminal-client.tsx` and `shouldRefuseTerminalChord` are unmodified, and the alias still fires under terminal focus
- [x] A-006 R1: A binding without `aliasOf` resolves its handler exactly as before

### Scenario Coverage

- [x] A-007 R2: A unit test asserts the alias's per-platform presence (bound on Linux/Windows, unbound on mac)
- [x] A-008 R5: A unit test asserts an alias override does not disturb the primary
- [x] A-009 R6: The e2e palette-touching specs pass, and the report names which ran

### Edge Cases & Error Handling

- [x] A-010 R5: `findConflicts` reports no conflict between a binding and its own alias
- [x] A-011 R4: No surface shows the alias as the ONLY chord — the primary is always visible where one chord is shown

### Code Quality

- [x] A-012 Pattern consistency: `aliasOf` follows the declarative per-binding refinement style of `ttyOnly` / `webOnly` / `macTier`
- [x] A-013 No unnecessary duplication: no handler is registered twice; the alias reuses the primary's handler
- [x] A-014 Comment narration: no comment narrates the next line, addresses the reviewer, or cites a change ID or PR number
- [x] A-015 Scope: `terminal-client.tsx`, `shouldRefuseTerminalChord`, and `playwright.config.ts` are unmodified
- [x] A-016 No unverified claim about Firefox behavior is written into source comments, memory, or specs as established fact

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- If an item is not applicable, mark checked and prefix with **N/A**
- This branch is stacked on PR #779; rebase onto `main` once that merges

## Deletion Candidates

- None — this change adds the alias mechanism without making existing code redundant; the two duplicate local `chordFor` helpers it consolidated (`status-bar.tsx`, `bottom-bar.tsx`) were removed in-diff, not left behind
- `host-overview-page.tsx:116-120`, `board-page.tsx:440-444` — still hand-derive the primary-only palette chord; consolidation candidates for a `chordHintFor` variant, surfaced for the human reviewer (not auto-deleted)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `macCode: ""` makes the alias keyless on mac | Read directly: `defaultComboFor` returns `{ code: macCode ?? code }` on mac, and `resolveBindings` resolves a `""` code UNBOUND. `create-session` already ships this exact idiom for deliberate mac keylessness | S:90 R:85 A:95 D:90 |
| 2 | Confident | `aliasOf` over a distinct actionId with its own handler | actionId doubles as the palette action id, so a free-standing alias id is a phantom action; `aliasOf` costs one dispatcher line and no handler wiring. The cheaper option was genuinely viable — this is a judgment call on model quality, not a forced move | S:75 R:70 A:80 D:65 |
| 3 | Confident | Keep the compact hint on the primary chord | Avoids replacing a working hint with one Firefox cannot honor, which would regress the single place users look. Costs some discoverability, recovered in the Shortcuts panel and Tips | S:70 R:80 A:75 D:65 |
| 4 | Confident | Defer the Firefox claimed-key entry | Nothing regresses without it once the hint stays on the primary, and the claims table has no browser-brand axis. Encoding an untested claim as registry data would be worse than omitting it | S:70 R:75 A:70 D:70 |
| 5 | Tentative | Both chords fit in the status-bar and bottom-bar Tips | Not measured — the bottom bar is width-constrained at 375px and the Tip `kbd` slot may not take two combos. T003 carries an explicit fallback (keep the primary, never show only the alias), so a bad fit degrades rather than blocks <!-- assumed: two combos fit the Tip kbd slot; T003 falls back to the primary alone if not --> | S:45 R:80 A:55 D:50 |
| 6 | Tentative | `Shift+Control+k` is the right Playwright press for the alias | Follows the rig's established form — `shortcut-registry.spec.ts` presses `Shift+Control+<code>` for shifted-tier chords and asserts the `Shift+Ctrl+A` hint on this Linux host — but not yet exercised for the palette specifically; T004 verifies it against the real rig <!-- assumed: Shift+Control+k is the correct e2e press for the shifted-tier alias --> | S:60 R:85 A:65 D:60 |

| 7 | Certain | The palette's opener is its OWN document listener, not the window dispatcher | Found during apply, and it invalidated T001 as written: `command-palette.tsx` runs a local `document` keydown listener matching only `byAction.get("command-palette")`, so the alias row plus the dispatcher's `aliasOf` resolution would have shipped a **non-functional** chord. The listener is now alias-aware. The `PALETTE_EXEMPT` comment in `keybindings.test.ts` had recorded this all along ("the palette mount reads the binding itself for its local ⌘K listener") — the plan simply had not read it | S:95 R:75 A:95 D:90 |
| 8 | Certain | `resolveBindings` signals mac keylessness via `enabled`/`disabledReason`, not `code: ""` | The keyless branch returns `{ ...def, enabled: false, disabledReason: "user" }` without overwriting `code`, so the resolved alias keeps `code: "KeyK"` on mac. Assumption 1 was right about the mechanism and wrong about the observable — the first test written against it failed and was corrected | S:90 R:85 A:90 D:85 |

8 assumptions (3 certain, 3 confident, 2 tentative).

### Review Outcome (verdict: pass) and the should-fix items addressed

Review returned `verdict: pass`, 0 must-fix. Both should-fix items were valid and were fixed rather than shipped past:

1. **The mac Shortcuts panel gained a visible row.** `aliasesOf` had no `enabled` filter, so on mac the unbound alias rendered as an `↳ also` row with an amber "unbound — click to rebind" button — contradicting A-004's "no mac-visible surface changed". The reviewer offered a filter or a wording change; the filter is right, because "mac untouched" was the premise the whole option was chosen on. `aliasesOf` now returns only enabled aliases. The cost — the alias is unbindable on mac — is nil: mac's ⌘K already reaches the palette under terminal focus via the seam's mac cmd-tier rule.
2. **T005's panel test was never delivered.** Added four cases to `settings-shortcuts-panel.test.tsx` covering adjacency (the alias is the primary's next sibling), the `↳ also` marker with no repeated label, independent capture targeting the alias, and the unbound-alias-contributes-no-row rule that is what keeps mac unchanged.

Two of the three nice-to-haves were also taken, since both removed further duplication of the helper this change introduced:

- `host-overview-page.tsx` and `board-page.tsx` each carried a fourth and fifth hand-rolled copy of the palette-chord derivation, still advertising Ctrl+K alone. Both now use `chordHintFor`.
- The alias's `label` was identical to the primary's, making steal/reset notices and aria-labels ambiguous. It is now `"Command palette (alternate)"` — the panel still renders `↳ also`, so the label surfaces only where disambiguation matters.

Not taken: `chordHintFor` showing the alias alone when a user unbinds the primary but keeps the alias. The reviewer noted it is arguably correct, and it is — advertising the chord that still works is the right behavior, and shipped defaults never reach that state.

Re-verified after the fixes: `just check` clean, **3646 frontend tests pass** (177 files), **53 e2e pass**.

## Notes — Apply Outcome

Verified: `just check` clean; **3643 frontend unit tests pass** (177 files) including 12 new alias/hint cases; **57 e2e tests pass** across `shortcut-registry`, `compose-strip`, `terminal-export`, `settings-dialog`, `zen-mode`, `board-autofit` — all of which now open the palette through the alias chord, so they collectively prove it works.

The headline claim was verified directly with a throwaway probe (written, run, deleted):

```
alias-under-terminal-focus=OPENED     ← ⇧Ctrl+K reaches the palette
plain-under-terminal-focus=SWALLOWED  ← Ctrl+K still reaches the pane
```

Both axes are what the change intends: the new chord works under terminal focus, and readline's kill-line is untouched.

Three of the repo's own invariants caught real problems during apply — the `PALETTE_RESOLUTIONS`/`PALETTE_EXEMPT` guard flagged the alias as a phantom palette action (the exact hazard the alias-model decision was written to avoid), a `DEFAULT_BINDINGS` integrity fixture caught the new shifted row, and a resolved-binding assertion corrected Assumption 1's observable. Scope grew by one file beyond the plan: `command-palette.tsx` (Assumption 7).
