# Plan: macOS Cmd-Tier Demotion & Help-Palette Renames

**Change**: 260730-n789-macos-cmd-tier-shortcuts
**Intake**: `intake.md`

## Requirements

### Keybinding Registry: Per-platform/per-host default tiers

#### R1: macOS default-tier refinement in the schema and resolver
`KeyBinding` SHALL gain two optional default-refinement fields — `macTier?: BindingTier` (the tier this binding's DEFAULT combo uses on mac hosts) and `macShellOnly?: boolean` (restrict `macTier` to `isShell()` hosts; mac browsers keep the base tier). A pure helper `defaultComboFor(def, host)` SHALL be the single place the host-effective default combo is computed, consumed by `resolveBindings` (default fallback + `isDefault` comparison) and `applyCapture` (own-default detection, which therefore gains a required `host` parameter). The stored-override shape `{ [actionId]: { code, tier } | null }` MUST remain byte-identical (per-device storage makes per-platform inherent). The per-key defaults MUST match the intake table: `go-back`/`go-forward`/`shortcuts-overlay` get `macTier: "cmd"` (both hosts); `create-session`/`create-window`/`kill-window` get `macTier: "cmd", macShellOnly: true`; `window-prev`/`window-next`/`agent-next-waiting` and every legacy binding are unchanged. Win/Linux resolution MUST be byte-identical to today.

- **GIVEN** a mac desktop-shell host — **WHEN** defaults resolve — **THEN** N/T/W/[/]// resolve enabled on the `cmd` tier and H/L/A stay `shifted`.
- **GIVEN** a mac browser host — **WHEN** defaults resolve — **THEN** [/]// resolve enabled on `cmd`, N/T/W stay `shifted` and resolve `enabled: false, disabledReason: "reserved"` (palette-only), H/L/A stay `shifted` enabled.
- **GIVEN** a Win/Linux host (shell or browser) — **WHEN** defaults resolve — **THEN** the effective map is identical to the pre-change map.
- **GIVEN** a mac host where the user re-captures `go-back`'s own ⌘[ — **WHEN** `applyCapture` runs — **THEN** no diff entry is stored for `go-back` (own-default detection is host-aware).

#### R2: Tier-aware claimed keys (mac cmd tier)
`ClaimedKey` SHALL gain a `tier: BindingTier` field; all existing claims carry `tier: "shifted"`. `claimedKeys(platform, shell)` SHALL additionally return the mac cmd tier: inside the shell (owner `shell`, from `app/desktop/src/menu.ts` accelerators) ⌘Q/H/M/R/Z/X/C/V/A and zoom ⌘0/+/− (`Digit0`/`Equal`/`Minus`); outside the shell (mac browser) owner `browser` N/T/W/L + tab digits 1–9, and owner `system` Q/H/M. Browser-owned claims SHALL disable resolution tier-aware (a combo resolves `disabledReason: "reserved"` when a browser claim matches its tier AND code); shell/system claims remain display + capture-warning data. Win/Linux claim sets MUST be unchanged.

- **GIVEN** a mac browser host — **WHEN** a user override lands on `{ code: "KeyL", tier: "cmd" }` — **THEN** it resolves disabled `reserved`; the same override on a mac shell host resolves enabled.
- **GIVEN** any pre-change claim (shell digits/R/I, system Q/C/V, browser N/T/W) — **WHEN** `claimedKeys` runs — **THEN** it is present with `tier: "shifted"` exactly as before.

#### R3: Scope precedence — scoped beats global at dispatch and in conflict detection
A new `findMatches(e, bindings)` SHALL return every enabled matching binding ordered non-global-scope first (registry order within each class); `findMatch` returns its head. `useKeybindingDispatch` SHALL walk that ordered list and fire the first match that has a handler at the mount (falling through untouched only when no match has a handler). `findConflicts` SHALL treat a same-combo global↔scoped pair as a shadow (precedence), flagging a conflict only when the two scopes are EQUAL. `applyCapture`'s steal behavior (scopesOverlap) is deliberately unchanged.

- **GIVEN** a mac host on a board route with panes — **WHEN** ⌘[ is pressed — **THEN** `board-cycle-prev` (board scope) fires, not `go-back` (global); on non-board routes ⌘[ fires `go-back`.
- **GIVEN** the shipped defaults on any of the four hosts (mac/other × shell/browser) — **WHEN** `findConflicts` runs — **THEN** it returns `[]` (the mac ⌘[/⌘] global/board shadow is precedence, not a conflict).

#### R4: Terminal seam — mac-only cmd-tier refusal
A pure predicate `shouldRefuseTerminalChord(e, bindings, platform)` SHALL own the refusal rule: refuse when any enabled match is `shifted` (all platforms — today's rule), and additionally on `platform === "mac"` refuse when `e.metaKey` is set and any enabled match is `cmd`-tier. Plain-Ctrl events are NEVER refused (on mac Ctrl+[ is ESC and must reach the pane; on Win/Linux the whole cmd-refusal branch never applies, keeping the seam byte-identical to today). `terminal-client.tsx` SHALL consume the predicate with the host platform from `useKeybindings().host`.

- **GIVEN** a mac host with the terminal focused — **WHEN** ⌘[ (metaKey) is pressed — **THEN** xterm refuses it, the event bubbles, and `go-back` fires; **WHEN** Ctrl+[ is pressed — **THEN** the seam does not refuse and the pane receives ESC.
- **GIVEN** a Win/Linux host — **WHEN** any keydown reaches the seam — **THEN** refusal decisions are identical to the pre-change handler (shifted-tier only).

#### R5: Overlay renders host-aware combos and the mac page tier
The overlay's rows and capture flow SHALL reflect the host-effective per-platform defaults automatically (they read the effective map). The capture claimed-key warning SHALL match tier-aware (`c.tier === combo.tier`). The shifted tier map SHALL filter claims to `tier === "shifted"`; when the display toggle shows macOS, a second "page tier — ⌘ + key" map SHALL render cmd-tier bound/custom/claimed states (claims per the display platform + physical host's shell flag). The "one tier, every platform" header copy SHALL be dropped. The platform display toggle remains a rendering toggle; effective bindings are always the current host's.

- **GIVEN** the overlay with macOS display selected — **WHEN** it renders — **THEN** a page-tier ⌘ map appears with cmd-tier claims (shell set inside the shell, browser set outside); Win·Linux display shows no cmd map.
- **GIVEN** a mac host — **WHEN** the go-back row renders — **THEN** its keycaps read ⌘[ (cmd tier), and capturing ⌘R inside the shell warns it is claimed by the shell.

#### R6: Palette hints follow the host-aware effective map
`withShortcutHints` needs no change; hints MUST reflect the host-resolved combos (⌘[ on mac, Shift+Ctrl+[ on Win/Linux; no hint for mac-browser N/T/W since they resolve disabled).

- **GIVEN** a mac host — **WHEN** the palette renders `Agent: Next waiting` and `Board: …`/back-forward entries — **THEN** hints read ⇧⌘A and ⌘[/⌘] respectively.

### Palette: Help-entry renames (already applied in working tree)

#### R7: `Help: tmux Keybindings` / `Help: Keyboard Shortcuts` renames
The tmux keybindings modal's palette entry SHALL read `Help: tmux Keybindings` (dialog title `tmux Keybindings`); the registry overlay's entry SHALL read `Help: Keyboard Shortcuts` on both mounts. Action ids (`keyboard-shortcuts`, `shortcuts-overlay`) MUST be unchanged. These edits are ALREADY in the working tree (app.tsx, board-page.tsx, keyboard-shortcuts.tsx, shortcuts-overlay.tsx, shortcut-registry.spec.ts/.md) — verify and keep, do not redo.

- **GIVEN** the command palette — **WHEN** filtered for "Keyboard Shortcuts" — **THEN** the registry overlay entry matches; "tmux Keybindings" matches only the tmux modal.

### Tests

#### R8: Unit + e2e coverage; `.spec.md` companions in sync
Mac-specific resolution paths SHALL be unit-tested (vitest, host passed as data / platform spoofed) since e2e runs on Linux: host-matrix resolution, tier-aware claims/reservation, findMatches precedence, shadow-vs-conflict, host-aware applyCapture, and `shouldRefuseTerminalChord`. The dispatch hook SHALL get a scoped-beats-global test. The e2e spec SHALL add a mac-spoofed (init-script `navigator.platform` override) test for ⌘[/⌘]/⌘/ resolution plus mac-browser N inertness, and every touched `.spec.ts` SHALL update its sibling `.spec.md` in the same change. All testing via `just` recipes only.

- **GIVEN** `just test-frontend` and `just test-e2e "shortcut-registry"` — **WHEN** run after the change — **THEN** both pass with the new coverage included.

### Non-Goals

- No `app/desktop/` (shell) changes — the shell already leaves ⌘N/T/W/[/]// unbound.
- No backend changes.
- `applyCapture` steal semantics across global↔scoped scopes unchanged (see Design Decisions).
- Win/Linux browser cmd-tier (plain Ctrl) claims are out of scope — "Win/Linux everything unchanged".
- PR description linking PR #475 as predecessor is a ship-stage (`/git-pr`) obligation recorded here, not an apply task.

### Design Decisions

#### Default-tier refinement lives on the binding as data, resolved once in `defaultComboFor`
**Decision**: `macTier`/`macShellOnly` optional fields on `KeyBinding`, folded into one pure `defaultComboFor(def, host)` helper consumed by `resolveBindings` and `applyCapture`.
**Why**: The intake requires platform+host to be consulted "exactly once, in the resolver"; a data field keeps the per-key table declarative and the stored-override shape untouched.
**Rejected**: A resolver-level actionId→tier mapping table (splits the per-key truth across two structures); per-platform DEFAULT_BINDINGS arrays (duplicates every binding for one field).
*Introduced by*: 260730-n789-macos-cmd-tier-shortcuts

#### Terminal-seam mac refusal is metaKey-gated
**Decision**: On mac the seam refuses a cmd-tier registry match only when `event.metaKey` is set; plain-Ctrl chords always pass to the pane.
**Why**: `matchesCombo`'s cmd tier accepts Meta OR Ctrl; an ungated refusal would steal Ctrl+[ (ESC) from mac panes — the exact hazard that forbids cmd refusal on Win/Linux. Meta chords never reach the pane as bytes, so metaKey-gated refusal is loss-free.
**Rejected**: Refusing all cmd-tier matches on mac (breaks Ctrl+[ = ESC); changing `matchesCombo` to Meta-only cmd on mac (would break the byte-identical legacy ⌘K/Ctrl+K predicates project-wide).
*Introduced by*: 260730-n789-macos-cmd-tier-shortcuts

#### Shadow pairs are precedence for `findConflicts` but still steal targets for `applyCapture`
**Decision**: `findConflicts` flags only equal-scope pairs; `applyCapture` keeps `scopesOverlap` stealing.
**Why**: With dispatcher precedence, a global↔scoped shadow leaves both bindings functional, so it is not a defaults-integrity conflict. Capture stealing stays overlap-wide because four bindings dispatch through component-local listeners that do not participate in precedence — a cross-scope rebind onto their combos would genuinely double-fire, and steal-with-warning is the visible, reversible guard.
**Rejected**: Aligning applyCapture to equal-scope (silently allows double-fire on locally-listened combos); a schema flag marking locally-listened bindings (scope creep for one edge).
*Introduced by*: 260730-n789-macos-cmd-tier-shortcuts

## Tasks

### Phase 1: Setup

- [x] T001 Verify the pre-applied Help-palette renames in the working tree (app.tsx, board-page.tsx, keyboard-shortcuts.tsx, shortcuts-overlay.tsx, shortcut-registry.spec.ts/.md): labels `Help: tmux Keybindings` / `Help: Keyboard Shortcuts`, dialog title `tmux Keybindings`, ids unchanged. Do not redo or revert. <!-- R7 -->

### Phase 2: Core Implementation

- [x] T002 `app/frontend/src/lib/keybindings.ts`: add `macTier`/`macShellOnly` to `KeyBinding`, export `defaultComboFor(def, host)`, wire it into `resolveBindings` (default fallback, `isDefault`), and set the per-key data (go-back/go-forward/shortcuts-overlay `macTier:"cmd"`; create-session/create-window/kill-window `macTier:"cmd", macShellOnly:true`). Update module docs. <!-- R1 -->
- [x] T003 `lib/keybindings.ts`: add `tier` to `ClaimedKey`, stamp existing claims `shifted`, add mac-shell cmd claims (Q/H/M/R/Z/X/C/V/A/Digit0/Equal/Minus, owner shell) and mac-browser cmd claims (N/T/W/L + Digit1–9 owner browser; Q/H/M owner system), and make the browser-reservation set in `resolveBindings` tier-aware. <!-- R2 -->
- [x] T004 `lib/keybindings.ts`: add `findMatches` (non-global first), re-express `findMatch` over it, and narrow `findConflicts` to equal-scope pairs (shadow = precedence). <!-- R3 -->
- [x] T005 `lib/keybindings.ts` + `src/components/terminal-client.tsx`: add `shouldRefuseTerminalChord(e, bindings, platform)` and consume it in `attachCustomKeyEventHandler` with the host platform from `useKeybindings().host` (ref-mirrored like the bindings). <!-- R4 -->
- [x] T006 `src/hooks/use-keybinding-dispatch.ts`: dispatch over `findMatches`, firing the first match with a handler; fall through untouched only when none has one. <!-- R3 -->
- [x] T007 `lib/keybindings.ts` + `src/hooks/use-keybindings.ts`: `applyCapture` gains a required `host` param (own-default detection via `defaultComboFor`); `setBinding` passes its host. <!-- R1 --> <!-- rework: review cycle-2 must-fix — applyCapture runs the victim (steal) search BEFORE the own-default short-circuit, so on a mac host re-capturing a SHADOWED binding's own default unbinds its shadow partner: applyCapture(resolveBindings(DEFAULT_BINDINGS,{},{platform:"mac",shell:true}), {}, "go-back", {code:"BracketLeft",tier:"cmd"}, host) → {overrides:{"board-cycle-prev":null}, stolenFrom:"board-cycle-prev"} (symmetric for ⌘]/board-cycle-next and both reverse directions). Fix: short-circuit the own-default case before the victim search (a no-op re-capture steals nothing), then add unit coverage for the go-back/⌘[ shadow pair per A-012's note. -->

### Phase 3: Integration & Edge Cases

- [x] T008 `src/components/shortcuts-overlay.tsx`: tier-aware capture claimed-warning, shifted map filters `tier === "shifted"` claims, macOS-display page-tier ⌘ map (bound/custom/claimed via the shared keycell), header copy drops "one tier, every platform". <!-- R5 --> <!-- rework: review must-fix — sheetChord at shortcuts-overlay.tsx:291 hardcodes {code:"Slash",tier:"shifted"}, so mac hosts advertise ⇧⌘/ while the effective chord is ⌘/ and overrides are ignored; derive from the effective map (byAction.get("shortcuts-overlay"), hide hint when unbound/disabled). Also fold in review should-fixes: (a) update stale ⇧CmdOrCtrl+/ comments at app.tsx:563, app.tsx:2132, board-page.tsx:688, board-page.tsx:1218, shortcuts-overlay.tsx:26; (b) shortcut-registry.spec.ts:8 header still says "uniform Shift+CmdOrCtrl tier" — align with the .spec.md; (c) shortcuts-overlay.tsx:29 module doc says "a shifted-tier keyboard visualization" but two tier maps render now; (d) findMatch in keybindings.ts has zero production call sites — drop it (tests use findMatches(...)[0]) or doc-line why it stays. -->
- [x] T009 `src/lib/keybindings.test.ts`: host-matrix resolution tests (4 hosts), conflict-free defaults incl. mac hosts, tier-aware claims + reservation, `findMatches` precedence, shadow-vs-conflict (rework the cross-scope cmd/ctrl masking test to same-scope), host-aware `applyCapture` signature updates + mac own-default test, `shouldRefuseTerminalChord` matrix. <!-- R8 -->
- [x] T010 `src/hooks/use-keybinding-dispatch.test.ts`: scoped-beats-global precedence (board-cycle-prev vs overridden cmd go-back), handler-fallback to global; `src/components/shortcuts-overlay.test.tsx`: macOS display renders the page-tier map. <!-- R8 -->
- [x] T011 `app/frontend/tests/e2e/shortcut-registry.spec.ts` + `.spec.md`: mac-spoofed (init-script platform override) tests — ⌘[/⌘] back/forward + shifted-[ no longer bound on mac, ⌘/ overlay toggle, Shift+Meta+N inert in a mac browser host; keep the renamed-label test (already updated). Update the `.spec.md` companion in the same change. <!-- R8 -->

### Phase 4: Polish

- [x] T012 Verification gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "shortcut-registry"` (plus `macro-riff-bindings` for the shared-map seam); production build if time-reasonable. <!-- R8 -->

## Execution Order

- T002 blocks T003–T008 (schema first). T004 blocks T005/T006. T007 after T002. Tests (T009–T011) after their targets; T012 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `defaultComboFor` + `macTier`/`macShellOnly` produce the intake's per-key table on all four hosts; stored-override shape unchanged.
- [x] A-002 R2: `claimedKeys` returns tier-stamped claims incl. the mac shell cmd set (Q/H/M/R/Z/X/C/V/A/zoom) and mac browser cmd set; browser claims disable tier-aware.
- [x] A-003 R3: `findMatches`/dispatcher give board pane-cycle precedence over global back/forward on shared mac ⌘[/⌘] combos; `findConflicts` reports the shipped defaults clean on every host.
- [x] A-004 R4: `shouldRefuseTerminalChord` refuses shifted matches everywhere and metaKey cmd matches on mac only; terminal-client consumes it.
- [x] A-005 R5: overlay shows host-aware combos, tier-aware capture warnings, and the macOS page-tier map. — rework fixed: the header hint derives from the effective map (`byAction.get("shortcuts-overlay")`), formatted for the physical host platform, and is hidden when the binding is unbound/disabled — mac hosts show ⌘/ and overrides are reflected. Unit-covered (mac-host ⌘/ assertion + hidden-when-unbound test in `shortcuts-overlay.test.tsx`).
- [x] A-006 R6: palette hints render ⌘-tier combos on mac hosts (via the effective map, no hint for disabled bindings).
- [x] A-007 R7: Help-palette renames present (labels + dialog title), ids unchanged, e2e label test updated.

### Behavioral Correctness

- [x] A-008 R1: Win/Linux resolution and terminal seam byte-identical to pre-change (existing linux e2e passes unmodified except the rename test). — verified: full Linux e2e suite 205 passed / 0 failed; `shouldRefuseTerminalChord`'s cmd branch is `platform === "mac"`-gated and its shifted branch is equivalent to the old registry-order `findMatch` (shifted and cmd/ctrl are shiftKey-disjoint in `matchesCombo`).
- [x] A-009 R4: plain-Ctrl chords are never refused by the seam (mac Ctrl+[ still reaches the pane).

### Scenario Coverage

- [x] A-010 R8: unit tests cover the mac host matrix, precedence, claims, refusal predicate; dispatch-hook precedence test present.
- [x] A-011 R8: e2e mac-spoofed tests pass on Linux CI; `shortcut-registry.spec.md` documents every test in the file. — 10 `test()` / 10 `###` sections, names in exact sync.

### Edge Cases & Error Handling

- [x] A-012 R1: re-capturing a mac host's own cmd-tier default drops the diff entry (no spurious "modified" state); keyless macro defaults still resolve unbound. — rework cycle-2 fixed: `applyCapture` now short-circuits the own-default case (via `defaultComboFor`) BEFORE the victim search — a no-op re-capture drops the diff entry and steals nothing (`stolenFrom: null`), so the mac ⌘[/⌘] shadow pairs survive re-capturing either partner's default (all four directions unit-covered in `keybindings.test.ts`, plus a guard that a genuine capture onto a shadow partner's combo still steals). Diff-drop, overridden-binding reset, and keyless-macro halves remain covered by the pre-existing tests.
- [x] A-013 R2: a user override onto ⌘L in a mac browser resolves disabled `reserved`; the same override in the mac shell is live.

### Code Quality

- [x] A-014 Pattern consistency: new helpers are pure, DOM-light, colocated-tested (the `window-view.ts`/`palette-*.ts` convention); type narrowing over assertions.
- [x] A-015 No unnecessary duplication: one `defaultComboFor` seam; overlay reuses the shared keycell for both maps; no second override store.

## Notes

- Ship stage: PR description must link PR #475 as the predecessor (intake decision 7).

## Deletion Candidates

- `app/frontend/src/lib/keybindings.ts` — `findMatch` — RESOLVED in rework cycle 1: the export was dropped (zero production and zero test references remain; tests use `findMatches(...)[0]`).
- `app/frontend/src/components/shortcuts-overlay.tsx:291` — `sheetChord`'s hardcoded `{ code: "Slash", tier: "shifted" }` literal — RESOLVED in rework cycle 1: now derived from `byAction.get("shortcuts-overlay")`, formatted for the physical host, hidden when unbound.
- `app/frontend/src/lib/keybindings.ts:577-586` — `applyCapture`'s post-victim `if (def && def.code === combo.code …)` own-default branch — RESOLVED in rework cycle 2: the branch moved ABOVE the victim search as an early-return short-circuit, so the tail is now an unconditional `next[actionId] = combo` with no duplicated default comparison.
- `app/frontend/src/components/shortcuts-overlay.tsx:197-208` — the two hand-dep'd `useMemo`s over the per-render `tierKeyStates` factory — collapsing them into one `useMemo` returning `{ shifted, cmd }` removes both `eslint-disable react-hooks/exhaustive-deps` suppressions and the duplicated dep array. (Still open; nice-to-have — the suppressions match 10 existing sites in the repo.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Schema shape = `macTier?`/`macShellOnly?` fields + `defaultComboFor` helper (the intake's suggested shape) | Intake suggests exactly this, delegates final call to apply; storage shape constraint satisfied | S:80 R:80 A:90 D:80 |
| 2 | Confident | Terminal-seam mac cmd refusal is metaKey-gated (plain-Ctrl never refused) | Intake's own rationale ("metaKey chords never reach the pane") implies the gate; ungated refusal would steal Ctrl+[ = ESC on mac | S:70 R:85 A:90 D:80 |
| 3 | Confident | Scope precedence implemented as `findMatches` ordering + handler-aware dispatch walk; `findConflicts` narrowed to equal scopes; `applyCapture` steal unchanged | Intake names "scoped beats global" and "not a user-facing conflict" without pinning mechanics; local-listener bindings make capture-steal narrowing unsafe | S:65 R:80 A:85 D:70 |
| 4 | Confident | Mac-browser cmd claims (N/T/W/L, digits, system Q/H/M) are resolution-disabling for browser-owned entries, mirroring the existing shifted browser-claim semantic | Intake says "display data" but the existing browser owner is defined as the one that changes resolution; an enabled dead chord would lie | S:60 R:85 A:85 D:70 |
| 5 | Confident | Overlay gains a macOS-display-only page-tier ⌘ map reusing the existing keycap grid; Win·Linux display keeps one map | Intake §2 names the claimed set "for the overlay tier map"; win/linux cmd tier is the pane's, so no map there | S:60 R:90 A:80 D:70 |
| 6 | Certain | E2e mac coverage via `navigator.platform` init-script spoof; deep mac paths stay unit-tested | Intake explicitly assigns mac paths to unit tests ("where mockable"); spoofing platform detection is the only linux-CI-viable seam | S:80 R:95 A:90 D:85 |
| 7 | Confident | Zoom claims use codes `Digit0`/`Equal`/`Minus` (⌘0/⌘+/⌘−) | Direct mapping from `menu.ts` roles to KeyboardEvent codes; display/warning-only data | S:70 R:95 A:90 D:85 |

7 assumptions (1 certain, 6 confident, 0 tentative).
