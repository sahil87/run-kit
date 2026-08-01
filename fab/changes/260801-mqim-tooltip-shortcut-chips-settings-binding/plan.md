# Plan: Tooltip Shortcut Chips + Settings Keybinding

**Change**: 260801-mqim-tooltip-shortcut-chips-settings-binding
**Intake**: `intake.md`

## Requirements

### Keybinding Registry: `settings-open` builtin

#### R1: New `settings-open` default binding on Comma
`DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` SHALL gain a `settings-open` builtin binding: `code: "Comma"`, base `tier: "shifted"`, `macTier: "cmd"` with `macShellOnly: true`, `scope: "global"`, `ignoreInputs: true`, label "Settings", following the `create-session` macShellOnly precedent. The actionId MUST equal the existing palette action id (`settings-open`) so the palette hint, overlay row, and dispatch share one identity.

- **GIVEN** a Windows/Linux host or a macOS browser host
- **WHEN** the effective map is resolved with no overrides
- **THEN** `settings-open` resolves enabled on the shifted tier (⇧Ctrl+, / ⇧⌘,)
- **AND** on a macOS desktop-shell host it resolves enabled on the cmd tier (⌘,)

#### R2: Comma is collision-free; mac-browser ⌘, is claimed data
The new binding SHALL NOT conflict with any existing binding or claim in any host (verified by the existing `findConflicts` all-hosts invariant test). Because ⌘, is browser Preferences on macOS (the reason the browser default stays shifted), `MAC_BROWSER_CMD_CLAIMS` SHALL gain a browser-owned `{ code: "Comma", tier: "cmd" }` claim so a user override onto ⌘, in a mac browser resolves `reserved` instead of advertising a dead chord.

- **GIVEN** a macOS browser host with a user override moving `settings-open` to `{ code: "Comma", tier: "cmd" }`
- **WHEN** bindings are resolved
- **THEN** the binding resolves `enabled: false, disabledReason: "reserved"` and the action stays palette-reachable
- **AND** in the macOS shell the same combo is the shipped default and resolves enabled

### Dispatch: handler in both route shells

#### R3: `settings-open` handler wired in AppShell AND the board twin
Both dispatcher mounts SHALL handle `settings-open` by opening the settings dialog: `keybindingHandlers` in `app/frontend/src/app.tsx` (via the existing `fromPalette("settings-open")` palette-body convention — the `Settings: Open` entry already exists) and `boardKeyHandlers` in `app/frontend/src/components/board/board-page.tsx` (via `openSettings`, lifted above the handler memo). A re-fire while the dialog is open is a no-op (`openSettings` is idempotent — the macOS ⌘, convention).

- **GIVEN** a terminal route with AppShell mounted
- **WHEN** the user presses the effective `settings-open` chord
- **THEN** the settings dialog opens
- **GIVEN** a `/board/$name` route (no AppShell)
- **WHEN** the user presses the same chord
- **THEN** the settings dialog opens (the board twin mounts its own handler)

### Tooltips: registry-resolved `kbd` chips

#### R4: Compose button Tip surfaces its registry chord
The `<Tip label="Compose text">` in `app/frontend/src/components/bottom-bar.tsx` SHALL pass `kbd={composeChord}` where the chord is derived exactly per the sm6g `overlayChord` pattern: `useKeybindings()` → `byAction.get("compose-toggle")` → `formatCombo({code, tier}, host.platform)` when `enabled`, else `undefined` (chip omitted — a tip advertising a dead chord would lie).

- **GIVEN** default bindings on any host
- **WHEN** the user hovers the `>_` compose chip
- **THEN** the tip shows the effective chord (⇧⌘E on mac, Shift+Ctrl+E elsewhere)
- **GIVEN** the user disabled `compose-toggle` (override `null`)
- **WHEN** the tip opens
- **THEN** no keycap chip renders

#### R5: Palette button Tip chord becomes platform-aware
The adjacent `<Tip label="Command palette">` SHALL replace its static `"⌘K"` `kbd` with the same derivation for `command-palette`, so Windows/Linux render `Ctrl+K` and rebinds/disables are reflected. The stale "static string per the 73al contract" comment SHALL be updated. The button's visible face glyph (`⌘K`) is unchanged — only the tooltip chip resolves.

- **GIVEN** a Windows/Linux host (including jsdom/Playwright-on-Linux)
- **WHEN** the ⌘K chip's tip opens
- **THEN** the keycap chip reads `Ctrl+K`, not `⌘K`

#### R6: Settings gear Tip surfaces the new chord
The `<Tip label="Settings">` in the `SidebarFooter` (`app/frontend/src/components/sidebar/index.tsx`) SHALL gain `kbd={settingsChord}` via the same derivation for `settings-open` — the component already consumes `useKeybindings()` for `overlayChord`, so this is two lines beside it.

- **GIVEN** default bindings
- **WHEN** the user hovers the sidebar-footer gear
- **THEN** the tip shows the effective `settings-open` chord

#### R7: `Tip` contract comment names the resolution pattern as the norm
The `kbd` prop doc in `app/frontend/src/components/tip.tsx` ("A STATIC string per call site — no shortcut-registry wiring (deferred follow-up)") SHALL be rewritten: registry-bound actions resolve their chip via `useKeybindings` + `formatCombo` (the sm6g pattern, completed by this change); static strings remain correct only for non-registry chords (the compose/chat `Enter`/`Alt+Enter` editing chords).

- **GIVEN** the `tip.tsx` source
- **WHEN** a future author adds a `kbd` chip for a registry-bound action
- **THEN** the contract comment directs them to the registry-resolution pattern, not a static string

### Non-Goals

- No new static `kbd=` conversions beyond the palette chip — the sweep found only `compose-strip.tsx` / `chat-view.tsx` `Enter`/`Alt+Enter` chips, which are focused-textarea editing chords with no registry binding (correctly static).
- No desktop-shell (`app/desktop`) or backend changes — the shell binds no accelerator on ⌘, and `MAC_SHELL_CMD_CLAIMS` mirrors only shell-bound accelerators.
- No change to the ⌘K chip's button face glyph or the `KEY_ROWS` overlay tier-map grid (Comma has no keycap cell, matching Period/Backslash/Backquote precedent — `mapLabel` is carried for parity but unrendered today).

## Tasks

### Phase 1: Registry

- [x] T001 Add the `settings-open` entry to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (Comma, shifted, `macTier: "cmd"` + `macShellOnly: true`, global, builtin, `ignoreInputs: true`, label "Settings", description "open the settings dialog", `mapLabel: "settings"`), placed after `shortcuts-overlay` at the end of the shifted global group; update the module doc comments that enumerate the starter actions <!-- R1 -->
- [x] T002 Add the mac-browser ⌘, claim `{ code: "Comma", tier: "cmd", label: "preferences", owner: "browser", platform: "mac" }` to `MAC_BROWSER_CMD_CLAIMS` in `app/frontend/src/lib/keybindings.ts` <!-- R2 -->
- [x] T003 Extend `app/frontend/src/lib/keybindings.test.ts`: a `settings-open` defaults test (mirrors the `compose-toggle` sm6g test shape — shape assertions plus per-host resolution: ⇧Ctrl+, on win/linux, ⇧⌘, on mac browser, ⌘, in mac shell); update the canonical shifted-keys map test to include `settings-open: "Comma"`; assert the mac-browser ⌘, claim resolves a Comma cmd-tier override reserved (browser host) but enabled in the shell; confirm the existing all-hosts `findConflicts` invariant still passes <!-- R1, R2 -->

### Phase 2: Handlers

- [x] T004 Wire `"settings-open": fromPalette("settings-open")` into `keybindingHandlers` in `app/frontend/src/app.tsx` (the palette-body convention — `Settings: Open` already registers `openSettings`; `paletteActions` is already a memo dep) <!-- R3 -->
- [x] T005 Wire `"settings-open": openSettings` into `boardKeyHandlers` in `app/frontend/src/components/board/board-page.tsx`: move the existing `const { openSettings } = useSettingsDialog();` above the handler memo, add the entry and the dep <!-- R3 -->

### Phase 3: Tooltip chips

- [x] T006 In `app/frontend/src/components/bottom-bar.tsx`: consume `useKeybindings()` + `formatCombo` in `BottomBar`, derive `composeChord` (`compose-toggle`) and `paletteChord` (`command-palette`) per the sm6g omit-when-disabled pattern; pass `kbd={composeChord}` on the Compose Tip and replace the static `"⌘K"` `kbd` with `paletteChord`; replace the stale "static string per the 73al contract" comment <!-- R4, R5 -->
- [x] T007 In `app/frontend/src/components/sidebar/index.tsx` `SidebarFooter`: derive `settingsChord` from `byAction.get("settings-open")` beside `overlayChord` and pass `kbd={settingsChord}` on the Settings gear Tip <!-- R6 -->
- [x] T008 Update the `kbd` prop contract comment in `app/frontend/src/components/tip.tsx` to name registry resolution (`useKeybindings` + `formatCombo`, omit when disabled) as the norm for registry-bound actions, static strings only for non-registry chords <!-- R7 -->

### Phase 4: Tests over changed chrome

- [x] T009 Update `app/frontend/src/components/bottom-bar.test.tsx`: the ⌘K-chip tip test now expects the platform-derived `Ctrl+K` (jsdom resolves platform `other`); add a Compose-chip tip test asserting the `Shift+Ctrl+E` keycap chip, and a disabled-omit test (seed `localStorage["runkit-keybindings"]` with `{"compose-toggle": null}` → no `<kbd>` in the tip) <!-- R4, R5 -->
- [x] T010 Extend `app/frontend/src/components/sidebar/index.test.tsx`: the Settings gear tip renders the `Shift+Ctrl+,` keycap chip (and the existing footer tests stay green) <!-- R6 -->
- [x] T011 Update `app/frontend/tests/e2e/tooltips.spec.ts` (the `hovering the ⌘K chip…` test asserts `Ctrl+K` on the Linux e2e runner, comment updated to the registry-resolved contract) AND its sibling `tooltips.spec.md` in the same commit (constitution Test Companion Docs); grep confirmed no other e2e spec asserts tooltip keycap content <!-- R5 -->
- [x] T012 Run scoped gates: `just test-frontend` (Vitest: keybindings, bottom-bar, sidebar, tip) and frontend type check; run `just pw test tooltips` and `just pw test shortcut-registry` for the touched e2e surfaces <!-- R1, R3, R4, R5, R6 -->

## Execution Order

- T001 blocks T003, T004, T005, T007 (the binding must exist before handlers/chips resolve it)
- T006/T007/T008 are independent of each other after T001
- T009–T011 follow their implementation tasks; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` contains `settings-open` (Comma, shifted base, `macTier: "cmd"` + `macShellOnly: true`, global, `ignoreInputs: true`) and it resolves ⇧Ctrl+, on win/linux, ⇧⌘, in a mac browser, ⌘, in the mac shell
- [x] A-002 R3: pressing the effective chord opens the settings dialog on BOTH route shells — `app.tsx` `keybindingHandlers` and `board-page.tsx` `boardKeyHandlers` each carry the `settings-open` entry
- [x] A-003 R4: the Compose `>_` chip's Tip renders the registry-resolved `compose-toggle` chord and omits the chip when the binding is disabled
- [x] A-004 R5: the palette chip's Tip renders the registry-resolved `command-palette` chord (`Ctrl+K` on non-mac platforms) with no static `"⌘K"` kbd prop remaining
- [x] A-005 R6: the sidebar-footer Settings gear Tip renders the registry-resolved `settings-open` chord beside the existing `overlayChord` derivation

### Behavioral Correctness

- [x] A-006 R2: the shipped defaults remain conflict-free in every host (`findConflicts` invariant test passes with the new binding), and a mac-browser override onto ⌘, resolves `reserved` via the new `MAC_BROWSER_CMD_CLAIMS` entry while the mac-shell default stays enabled
- [x] A-007 R1: the shortcuts overlay and palette hints pick the new binding up with zero consumer changes (the palette `Settings: Open` entries share the `settings-open` id in both palettes)

### Scenario Coverage

- [x] A-008 R4, R5: `bottom-bar.test.tsx` covers the Compose chord chip, the platform-derived palette chip, and the disabled-omit case
- [x] A-009 R6: `sidebar/index.test.tsx` covers the Settings gear chord chip
- [x] A-010 R5: `tests/e2e/tooltips.spec.ts` asserts the platform-derived keycap and its sibling `tooltips.spec.md` is updated in the same commit — 5/5 tooltips e2e tests pass. NOTE: the stated *reason* ("the Linux e2e runner") is inaccurate — `devices["Desktop Chrome"]` pins a **Windows** UA, so `detectPlatform()` is `other` on every host OS (see should-fix finding)

### Edge Cases & Error Handling

- [x] A-011 R3: a `settings-open` re-fire while the dialog is already open is a graceful no-op (`openSettings` sets open state, no toggle-flicker, no error) — `openSettings` is `useCallback(() => setIsOpen(true), [])`, so a re-fire is a React state-bailout; no toggle path exists
- [x] A-012 R4: an unbound/disabled binding renders NO keycap chip (never an empty chip or a lying chord) on all three converted Tips — one behavioral omit test (compose) plus the identical `enabled ? … : undefined` guard at all three sites

### Code Quality

- [x] A-013 Pattern consistency: chord derivations mirror the sm6g `overlayChord` pattern verbatim; handler wiring follows the existing palette-body (`fromPalette`) and board-twin conventions
- [x] A-014 No unnecessary duplication: reuses `useKeybindings`/`formatCombo`/`defaultComboFor`; no new hooks, contexts, or chord-formatting helpers introduced — met as written, but see the should-fix finding: the 4-line derivation is now hand-rolled at 4 UI sites, and `withShortcutHints` (`lib/keybindings.ts:728`) already encapsulates the same logic
- [x] A-015 No polling/new endpoints: change is frontend-only, registry-data-driven; no backend or desktop-shell changes — verified: no `Comma` accelerator anywhere in `app/desktop/src/menu.ts`, and the mac App menu carries no `role: "preferences"`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `app.tsx` handler uses `fromPalette("settings-open")` rather than a direct `openSettings` reference | The documented "chord handlers are the palette action bodies" convention; identical body (`Settings: Open` registers `openSettings`), avoids a new memo dep | S:70 R:95 A:85 D:75 |
| 2 | Confident | Re-fire while the dialog is open stays a no-op (open-only semantics), not a toggle | ⌘, in macOS apps never closes preferences; the action id/label is `settings-open`/`Settings: Open` (open semantics), unlike the overlay's toggle vocabulary | S:60 R:90 A:80 D:65 |
| 3 | Confident | Add the mac-browser ⌘, browser claim to `MAC_BROWSER_CMD_CLAIMS` | The intake's own rationale states ⌘, is browser-reserved; encoding it as claims data is what keeps a user override from resolving to a dead chord — the exact purpose of the claims map | S:55 R:85 A:80 D:70 |
| 4 | Certain | The compose-strip/chat-view `Enter`/`Alt+Enter` kbd chips stay static | They are focused-textarea editing chords with no registry binding — the intake's "known candidates only" rule excludes them | S:85 R:95 A:95 D:90 |
| 5 | Confident | `KEY_ROWS` in the shortcuts overlay is untouched; `mapLabel: "settings"` is carried but unrendered (Comma has no keycap cell) | Matches the Period/Backslash/Backquote precedent for off-grid codes; adding a cell would churn the fixed grid outside intake scope | S:60 R:90 A:80 D:70 |
| 6 | Certain | e2e + unit assertions on the ⌘K tip chip are updated to `Ctrl+K` (Linux runner / jsdom resolve platform `other`) | Direct consequence of R5; the intake's known-trap instruction to sweep `tests/e2e` found exactly one assertion (`tooltips.spec.ts:183`) | S:80 R:90 A:95 D:95 |

6 assumptions (2 certain, 4 confident, 0 tentative).
