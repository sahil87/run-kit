# Plan: Split Pane Keyboard Shortcuts

**Change**: 260807-rbx5-split-keyboard-shortcuts
**Intake**: `intake.md`

## Requirements

### Keybinding Registry: Split Chords

#### R1: Shipped default bindings for the two split actions
`DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` MUST carry exactly two new `builtin` rows — `split-horizontal` and `split-vertical` — both on `code: "KeyD"` and `scope: "terminal"`. `split-horizontal` MUST default to the `shifted` tier with `macTier: "cmd"` (no `macShellOnly`); `split-vertical` MUST default to the `shifted` tier and MUST be restricted to mac hosts via `platform: "mac"`. Both MUST carry `label`, `description`, and `mapLabel` so the overlay rows and the keycap map render.

- **GIVEN** a mac host (browser or desktop shell)
- **WHEN** the effective map is resolved with no overrides
- **THEN** `split-horizontal` resolves `{ code: "KeyD", tier: "cmd", enabled: true, isDefault: true }` (⌘D)
- **AND** `split-vertical` resolves `{ code: "KeyD", tier: "shifted", enabled: true, isDefault: true }` (⇧⌘D)

- **GIVEN** a Windows/Linux host (browser or desktop shell)
- **WHEN** the effective map is resolved with no overrides
- **THEN** `split-horizontal` resolves `{ code: "KeyD", tier: "shifted", enabled: true }` (⇧Ctrl+D)
- **AND** `split-vertical` resolves unbound (`enabled: false`, `disabledReason: "user"`, no combo)

#### R2: `platform?` schema affordance and its default-resolution gate
`KeyBinding` MUST gain one optional field `platform?: BindingPlatform` ("bound on this keycap platform only"). `defaultComboFor` MUST resolve a platform-mismatched binding's DEFAULT as unbound, and `resolveBindings` MUST render that state exactly as it already renders a keyless (`code: ""`) macro default — `enabled: false`, `isDefault: false`, `disabledReason: "user"` — introducing NO new effective-binding state and no new overlay affordance. A stored user override MUST still apply verbatim on every platform.

- **GIVEN** a binding with `platform: "mac"` and a Windows/Linux host
- **WHEN** `defaultComboFor` is called for it
- **THEN** it returns a combo whose `code` is `""` (the established unbound shape)
- **AND** `resolveBindings` yields `enabled: false, isDefault: false, disabledReason: "user"`

- **GIVEN** the same binding on a Windows/Linux host with a stored override `{ code: "KeyY", tier: "shifted" }`
- **WHEN** the effective map is resolved
- **THEN** the binding resolves `{ code: "KeyY", tier: "shifted", enabled: true, isDefault: false }`

#### R3: No binding without `platform` changes behavior
Every existing binding MUST resolve byte-identically to its pre-change resolution in all four hosts — the `platform` gate SHALL be inert when the field is absent.

- **GIVEN** any of the four hosts (mac/other × shell/browser)
- **WHEN** the effective map is resolved for the pre-existing `DEFAULT_BINDINGS` rows
- **THEN** every code/tier/enabled/isDefault value is unchanged from before this change

#### R4: The shipped defaults stay conflict-free in every host
`findConflicts` over the resolved default map MUST remain empty for all four hosts after the two rows are added.

- **GIVEN** the mac hosts, where `split-horizontal` (cmd tier) and `split-vertical` (shifted tier) share `KeyD` in the same `terminal` scope
- **WHEN** `findConflicts` runs over the resolved map
- **THEN** it returns `[]` (the tiers are disjoint per `tiersCollide`)
- **AND** the same holds on Windows/Linux, where `split-vertical` is unbound

### App Shell: Handler Registration

#### R5: Chord handlers reuse the existing palette action bodies
`app/frontend/src/app.tsx` MUST register `split-horizontal` and `split-vertical` in the `keybindingHandlers` memo via the existing `fromPalette` lookup. No new execution path, no component-local listener, and no change to `executeSplit` or the palette action bodies.

- **GIVEN** the terminal route with a current session and window
- **WHEN** the `split-horizontal` chord dispatches
- **THEN** the same body the `Window: Split Horizontal` palette entry runs fires — `POST /api/windows/{id}/split` with `{ horizontal: true, cwd }`
- **AND** the `split-vertical` chord posts `{ horizontal: false, cwd }`

- **GIVEN** a route where the split palette entries do not exist (no current window, or the board route)
- **WHEN** the chord is pressed
- **THEN** `fromPalette` yields `undefined`, no handler fires, and the keydown falls through untouched (no `preventDefault`)

### Derived Surfaces: Verify, Do Not Build

#### R6: The terminal seam refuses both chords from data alone
`shouldRefuseTerminalChord` MUST require no code change: a Windows/Linux ⇧Ctrl+D matches the shifted tier and is refused on every platform; a mac ⌘D pressed with `metaKey` is refused by the mac cmd-tier rule. Plain `Ctrl+D` on Windows/Linux MUST still reach the pane as EOF.

- **GIVEN** the terminal owns focus on Windows/Linux
- **WHEN** ⇧Ctrl+D is pressed
- **THEN** `shouldRefuseTerminalChord` returns `true` and the chord bubbles to the window dispatcher
- **AND** a plain `Ctrl+D` keydown returns `false` (EOF reaches the pane)

- **GIVEN** the terminal owns focus on a mac host
- **WHEN** ⌘D (metaKey) is pressed
- **THEN** `shouldRefuseTerminalChord` returns `true`

#### R7: Palette hints join automatically and honor the platform gate
`withShortcutHints` MUST require no code change: `Window: Split Horizontal` and `Window: Split Vertical` gain their effective-combo hints through the existing `actionId` = palette-id join, and an unbound `split-vertical` on Windows/Linux MUST contribute NO hint.

- **GIVEN** a Windows/Linux host
- **WHEN** the palette actions are decorated
- **THEN** `Window: Split Horizontal` carries the hint `Shift+Ctrl+D`
- **AND** `Window: Split Vertical` carries no shortcut hint

### Tests

#### R8: Unit coverage for the new rows and the platform gate
`app/frontend/src/lib/keybindings.test.ts` MUST cover: the two new default rows resolving per host (R1), the `platform` gate in `defaultComboFor`/`resolveBindings` including the override-applies-verbatim case (R2), the conflict-free-in-every-host invariant with the new rows present (R4), and refusal-predicate cases for ⌘D / ⇧⌘D / ⇧Ctrl+D / plain Ctrl+D (R6).

- **GIVEN** the vitest suite
- **WHEN** `just test-frontend` runs
- **THEN** all new and existing cases pass

#### R9: Test fixtures that treated ⇧Ctrl+D as a free combo move off it
Every macro test fixture that used `KeyD` as a free capture target MUST move to a combo still free after this change (⇧Ctrl+Y), because ⇧Ctrl+D is now `split-horizontal`'s shipped Win/Linux default and capturing it would assert a steal instead of a clean capture. This covers `app/frontend/tests/e2e/macro-riff-bindings.spec.ts` plus the unit fixtures in `src/lib/keybindings.test.ts`, `src/hooks/use-keybindings.test.ts`, and `src/components/shortcuts-overlay.test.tsx`. Assertions that assumed exactly one unbound row in the overlay MUST be scoped to their subject row, since the mac-only `split-vertical` now renders an unbound row on non-mac hosts. The sibling `macro-riff-bindings.spec.md` MUST be updated in the same change (constitution § Test Companion Docs); unit tests are exempt from the companion rule.

- **GIVEN** the e2e run on Linux
- **WHEN** the add-macro flow captures its chord
- **THEN** `localStorage["runkit-keybindings"]` holds exactly the macro's own diff entry — no `split-horizontal: null` steal victim

- **GIVEN** the shortcuts overlay rendered on a non-mac unit-test host
- **WHEN** a steal-with-warning test asserts the victim is unbound
- **THEN** the assertion is scoped to the victim's own `data-actionid` row rather than matching every unbound row on the sheet

#### R10: e2e coverage for the split chords
`app/frontend/tests/e2e/shortcut-registry.spec.ts` MUST add: a Linux-host test that ⇧Ctrl+D splits horizontally on the terminal route (mocked backend, asserted POST body) and that the `Window: Split Vertical` palette entry carries no hint there while `Window: Split Horizontal` shows `Shift+Ctrl+D`; and a spoofed-mac test that ⌘D and ⇧⌘D dispatch the horizontal and vertical splits respectively. The sibling `shortcut-registry.spec.md` MUST be updated in the same change.

- **GIVEN** the mocked terminal route at `/default/1`
- **WHEN** ⇧Ctrl+D is pressed
- **THEN** exactly one `POST /api/windows/@1/split` fires with `{ horizontal: true, cwd: "/tmp/win-one" }`

- **GIVEN** the same route with a spoofed mac platform
- **WHEN** ⌘D then ⇧⌘D are pressed
- **THEN** the two POSTs carry `horizontal: true` then `horizontal: false`

### Non-Goals

- No new API surface, route, or backend change — `executeSplit` and `splitWindow` are reused as-is (Constitution IV, IX untouched).
- No `browser`-owner claim entry for ⌘D — the mac-browser bookmark accelerator is page-interceptable via `preventDefault`, unlike the reserved N/T/W set.
- No default Windows/Linux chord for `split-vertical` — it stays palette-reachable and user-rebindable.

### Design Decisions

#### Platform-gated defaults reuse the keyless-unbound shape
**Decision**: `platform?: BindingPlatform` gates only the SHIPPED DEFAULT, implemented as a single early return in `defaultComboFor` that yields `{ code: "", tier }` — the same keyless shape macro bindings already ship — so `resolveBindings` produces the existing unbound state with no new branch, no new `disabledReason`, and no new overlay affordance.
**Why**: One seam, zero new UI states. `defaultComboFor` is already the single place platform/shell are consulted for defaults, and both `resolveBindings` (fallback + `isDefault`) and `applyCapture` (own-default detection) read defaults through it, so the gate lands everywhere at once. A user override bypasses the gate for free because overrides are applied ahead of the default in `resolveBindings`.
**Rejected**: Widening `defaultComboFor`'s return type to `BindingCombo | null` — it would force a null branch on every caller (including `applyCapture`) for a state `resolveBindings` already models; and filtering platform-mismatched rows out of the registry entirely, which would delete the overlay row and make the action unrebindable on Windows/Linux.
*Introduced by*: 260807-rbx5-split-keyboard-shortcuts

#### Asymmetric per-platform chords for the split pair
**Decision**: macOS gets both chords (⌘D horizontal via `macTier` demotion, ⇧⌘D vertical); Windows/Linux gets ⇧Ctrl+D for horizontal only, with vertical shipped unbound.
**Why**: Plain `Ctrl+D` is EOF and belongs to the pane on Windows/Linux, so the unshifted Ctrl tier is unavailable there; the two actions cannot share ⇧Ctrl+D because equal-scope same-combo defaults would break the test-enforced conflict-free invariant. Horizontal is the primary/default split (default-first, mirroring the SplitControl menus), so it takes the plain ⌘D and the sole Windows/Linux chord.
**Rejected**: Binding vertical to another letter on Windows/Linux — it would split the pair across unrelated keycaps and break the ⌘D/⇧⌘D muscle memory the request is built on; and leaving vertical bound to a colliding ⇧Ctrl+D, which the conflict invariant forbids.
*Introduced by*: 260807-rbx5-split-keyboard-shortcuts

## Tasks

### Phase 1: Setup

- [x] T001 Add the optional `platform?: BindingPlatform` field to the `KeyBinding` type in `app/frontend/src/lib/keybindings.ts`, documented next to `macTier`/`macShellOnly` (shipped default only; overrides apply verbatim) <!-- R2 -->

### Phase 2: Core Implementation

- [x] T002 Gate the shipped default on the host keycap platform in `defaultComboFor` (`app/frontend/src/lib/keybindings.ts`) — a platform mismatch returns the keyless `{ code: "", tier }` shape that `resolveBindings` already resolves unbound <!-- R2 -->
- [x] T003 Add the `split-horizontal` and `split-vertical` rows to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` per R1 (KeyD, terminal scope, builtin; horizontal `macTier: "cmd"`, vertical `platform: "mac"`) with a comment recording the per-platform rationale <!-- R1 -->
- [x] T004 Register `"split-horizontal"` and `"split-vertical"` as `fromPalette` lookups in the `keybindingHandlers` memo in `app/frontend/src/app.tsx` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Extend `app/frontend/src/lib/keybindings.test.ts`: per-host resolution of both new rows, the `platform` gate in `defaultComboFor`/`resolveBindings` plus override-applies-verbatim, unchanged resolution for platform-less bindings, the conflict-free-in-every-host invariant, and refusal cases for ⌘D / ⇧⌘D / ⇧Ctrl+D / plain Ctrl+D <!-- R1 R2 R3 R4 R6 R8 -->
- [x] T006 Move the macro capture/seed fixtures off ⇧Ctrl+D to ⇧Ctrl+Y in `app/frontend/tests/e2e/macro-riff-bindings.spec.ts` (+ sibling `macro-riff-bindings.spec.md`), `app/frontend/src/lib/keybindings.test.ts`, `app/frontend/src/hooks/use-keybindings.test.ts`, and `app/frontend/src/components/shortcuts-overlay.test.tsx`; scope the overlay steal-with-warning assertion to the victim's `data-actionid` row <!-- R9 -->
- [x] T007 Add split-chord coverage to `app/frontend/tests/e2e/shortcut-registry.spec.ts` (Linux ⇧Ctrl+D horizontal split + palette-hint asymmetry; spoofed-mac ⌘D/⇧⌘D) and update the sibling `shortcut-registry.spec.md` in the same change <!-- R7 R10 -->

### Phase 4: Polish

- [x] T008 Run the verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e` <!-- R8 R9 R10 -->

## Execution Order

- T001 blocks T002 (the field must exist before the gate reads it)
- T002 blocks T003 (`split-vertical`'s default depends on the gate)
- T003 blocks T005, T007 (tests assert the shipped rows)
- T004 blocks T007 (the e2e split chords need the handlers)
- T008 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` carries `split-horizontal` and `split-vertical` on `KeyD`/`terminal`/`builtin`, with horizontal's `macTier: "cmd"` (no `macShellOnly`) and vertical's `platform: "mac"`
- [x] A-002 R2: `KeyBinding.platform?` exists and `defaultComboFor` resolves a platform-mismatched default as unbound, with a stored override still applying verbatim
- [x] A-003 R5: `keybindingHandlers` in `app.tsx` registers both split actions through `fromPalette`, with no new execution path
- [x] A-004 R8: `keybindings.test.ts` covers the new rows, the platform gate, and the refusal predicate

### Behavioral Correctness

- [x] A-005 R1: mac hosts resolve ⌘D → `split-horizontal` and ⇧⌘D → `split-vertical`; Windows/Linux hosts resolve ⇧Ctrl+D → `split-horizontal` and `split-vertical` unbound
- [x] A-006 R3: every pre-existing binding resolves identically in all four hosts — the `platform` gate is inert when the field is absent
- [x] A-007 R4: `findConflicts` over the resolved defaults is empty in all four hosts
- [x] A-008 R7: `Window: Split Horizontal` carries its effective-combo hint; the Windows/Linux-unbound `Window: Split Vertical` carries none

### Scenario Coverage

- [x] A-009 R10: an e2e test proves ⇧Ctrl+D posts `{horizontal: true}` on the terminal route, and a spoofed-mac test proves ⌘D/⇧⌘D post `{horizontal: true}` / `{horizontal: false}`
- [x] A-010 R9: the macro fixtures (e2e + unit) capture a free combo and assert a clean single-entry diff (no steal victim), and the overlay steal assertion is scoped to its victim row
- [x] A-011 R6: unit cases prove ⇧Ctrl+D and mac ⌘D are refused by the terminal seam while plain Ctrl+D is not

### Edge Cases & Error Handling

- [x] A-012 R5: on a route without the split palette entries (no current window / board route) the chord falls through untouched — no handler, no `preventDefault`
- [x] A-013 R2: a Windows/Linux user override onto `split-vertical` binds it normally (the gate touches only the shipped default)

### Code Quality

- [x] A-014 Pattern consistency: the new registry rows, the `defaultComboFor` gate, and the test blocks follow the surrounding naming, comment, and structure conventions of `keybindings.ts` / `keybindings.test.ts`
- [x] A-015 No unnecessary duplication: the chords reuse the existing palette action bodies via `fromPalette` and the existing keyless-unbound resolution path — no new dispatcher, no new unbound state
- [x] A-016 Type narrowing over type assertions: no new `as` casts in the changed frontend code
- [x] A-017 Tests cover added behavior: the new registry rows, the platform gate, and both chords carry unit and e2e coverage
- [x] A-018 UI change carries e2e coverage: the split chords are exercised through Playwright on both the Linux and spoofed-mac paths
- [x] A-019 No magic strings: keycap/tier values follow the registry's existing literal-union vocabulary rather than ad-hoc strings
- [x] A-020 Test companion docs: every modified `*.spec.ts` under `app/frontend/tests/` has its sibling `*.spec.md` updated in the same change (constitution § Test Companion Docs)
- [x] A-021 Verification gates: `npx tsc --noEmit`, `just test-frontend`, and `just test-e2e` all pass

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The two registry rows and the `platform?` gate are purely additive; `executeSplit`, the `Window: Split Horizontal|Vertical` palette bodies, `withShortcutHints`, `shouldRefuseTerminalChord`, and the keyless-unbound resolution path are all reused as-is with no superseded predecessor.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The `platform` gate is implemented as an early return in `defaultComboFor` yielding the keyless `{ code: "", tier }` shape rather than a nullable return | The intake specifies "the same rendering the macro keyless-default path already produces"; `resolveBindings` already resolves `code === ""` unbound, so this is the zero-new-state implementation the design names | S:85 R:85 A:95 D:90 |
| 2 | Certain | The macro e2e chord moves to ⇧Ctrl+Y | Named as the example in the intake; Y is free in every claim set and every default binding, so it captures cleanly on the Linux e2e host | S:80 R:90 A:95 D:85 |
| 3 | Confident | The Linux e2e split test asserts the POST body against a `**/api/windows/*/split*` route mock, mirroring the file's existing `select*` route convention | The spec file is fully mocked with no tmux; the split seam is `POST /api/windows/{id}/split` with `{horizontal, cwd}` per `api/client.ts`, and the trailing `*` is required for the appended `?server=` query | S:60 R:85 A:90 D:80 |
| 4 | Confident | The platform-gate unit cases assert against the real `split-vertical` row rather than a synthetic fixture binding | The shipped row is the only `platform`-carrying binding and the behavior under test is its resolution; asserting the real row also pins the R1 defaults in one place | S:55 R:85 A:85 D:70 |

4 assumptions (2 certain, 2 confident, 0 tentative).
