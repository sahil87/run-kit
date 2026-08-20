# Plan: Surface Hide/Focus Shortcut Family

**Change**: 260819-qwr7-surface-focus-chords
**Intake**: `intake.md`

## Requirements

### Keybinding Registry: chord defaults

#### R1: Stateful surface-chord binding rows
`DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` SHALL carry the new keymap:

- `code-toggle` moves its code from `KeyJ` to `Digit2` (same tiers: base `shifted`, `macTier: "cmd"`; `scope: "terminal"` kept). The ⌘J / ⇧Ctrl+J default is retired outright — no alias row remains on `KeyJ`.
- Two NEW rows: `tty-toggle` on `Digit1` and `web-toggle` on `Digit3` — base tier `shifted`, `macTier: "cmd"`, `scope: "terminal"`, kind `builtin`, `mapLabel`s `tty` / `web` (Digit2 carries `code`).
- `compose-toggle` keeps its base row (`KeyE`, `shifted`, global, `ignoreInputs: true`) and adds `macCode: "KeyI"` + `macTier: "cmd"` — mac default becomes ⌘I in both hosts, Win/Linux stays ⇧Ctrl+E.
- One NEW row `zen-toggle` on `Enter` — tier `shifted` on BOTH platforms (no `macTier`), `scope: "terminal"`, `ignoreInputs: true` (the chord must fire from the compose textarea; exact-modifier matching keeps it disjoint from the classifier-owned ⌘Enter/Ctrl+Enter submit chords, which never carry Shift).
- `sidebar-toggle` row is byte-unchanged (`KeyB`, shifted, `macTier: "cmd"`, global) — only its handler semantics change (R5).
- A `DEFAULT_BINDINGS`-adjacent comment reserves the ⇧⌘digit layer for future positional tile jumps (the ⇧⌘P precedent), noting mac ⇧⌘3/4/5 remain system screenshot claims so the layer is partial on mac.

- **GIVEN** a mac host (shell or browser), **WHEN** defaults resolve via `defaultComboFor`, **THEN** ⌘1 = `tty-toggle`, ⌘2 = `code-toggle`, ⌘3 = `web-toggle`, ⌘I = `compose-toggle`, ⇧⌘⏎ = `zen-toggle`, ⌘B = `sidebar-toggle`, and NO binding resolves to ⌘J or ⇧⌘E.
- **GIVEN** a Win/Linux host, **WHEN** defaults resolve, **THEN** ⇧Ctrl+1/2/3 map to tty/code/web, ⇧Ctrl+E stays compose, ⇧Ctrl+Enter is zen — and the terminal seam refuses shifted-tier matches to the pane exactly as before.

#### R2: Claims data follows the switcher move
`SHELL_SWITCHER_DIGITS` (win/linux shifted-digit `shell` claims) SHALL be removed from `claimedKeys` — the switcher's new Alt+digit accelerators are inexpressible in the tier system, exactly like the mac ⌥⌘ switcher (no claim rows replace them). The win/linux ⇧Ctrl+I DevTools claim and every mac claim set are untouched. mac-browser `MAC_BROWSER_CMD_CLAIMS` already reserves cmd-tier Digit1–9, so ⌘1/2/3 resolve `reserved` (palette-only) in a mac browser with no data change.

- **GIVEN** a win/linux shell host, **WHEN** `claimedKeys` is computed, **THEN** no shifted-tier digit claim exists and the new Digit1/2/3 bindings resolve enabled.
- **GIVEN** a mac browser, **WHEN** bindings resolve, **THEN** the three digit chords are `enabled: false, disabledReason: "reserved"` and their actions stay palette-reachable.

#### R3: Palette-parity invariant test
`keybindings.test.ts` SHALL gain an invariant test (the `findConflicts` invariant precedent): every `DEFAULT_BINDINGS` actionId must resolve to a palette entry or a documented equivalence, via a static known-entries/equivalence map maintained in the test (palette lists are runtime-built, so the test mirrors them statically; the map's comment names each equivalence, e.g. `compose-toggle` ⇄ `View: Text Input`).

- **GIVEN** a future change adds a binding with no palette entry and no equivalence-map row, **WHEN** the suite runs, **THEN** the invariant test fails naming the actionId.

### Chord Semantics: stateful handlers

#### R4: Stateful tile chords (tty / code / web)
Each tile chord SHALL implement the three-state rule against the CURRENT render layout (`renderLayout.order`) and focused tile kind (`focusedTileKind`), desktop-only (no-op under `isMobileViewport()`), for windows where the surface is available (`availableTiles`; a chord for an unavailable surface mounts no handler and falls through):

- **hidden** (kind not in `renderLayout.order`) → open via `togglePanel(kind)` and focus once the layout lands — generalize the `focusCodeOnLandingRef` flag (`app.tsx:947`) to a per-kind landing flag consumed by the existing layout-keyed effect.
- **visible, not focused** → focus via the `layoutFocusTileRef` focus-by-kind seam (`app.tsx:941`) — the same path the palette `Tile: Focus <Surface>` entries use, so ⌘1 records `tty` through that seam's existing `recordTtySlot` and ⌘2/⌘3 record NOTHING (the steal-guard recording asymmetry: only in-frame `onInteract` records `code`).
- **focused** → hide via `togglePanel(kind)` then return focus through the restore router's `restoreFocus` so focus never strands; the hide branch is a NO-OP at arity 1 (mirroring the palette's `Tile: Hide` omission on `single` layouts).

The palette `Tile: Show/Hide/Focus <Surface>` entries keep their explicit single-verb semantics — statefulness lives in the chord handlers only.

- **GIVEN** a desktop window route on `single:tty` with the code surface available, **WHEN** ⌘2 is pressed, **THEN** the code tile opens and receives focus once landed, and focus memory records nothing for `code`.
- **GIVEN** the code tile visible and tty focused, **WHEN** ⌘2 is pressed, **THEN** focus moves into the code tile (no layout mutation).
- **GIVEN** the code tile focused at arity 2, **WHEN** ⌘2 is pressed, **THEN** the code tile closes and focus restores to the window's remembered kind.
- **GIVEN** arity 1 with the tty tile focused, **WHEN** ⌘1 is pressed, **THEN** nothing happens (hide no-op) and the chord does not `preventDefault` into a dead action.

#### R5: Stateful sidebar chord + Escape return
`sidebar-toggle`'s handler (`useSidebarKeyboardToggle`, `app/frontend/src/components/shell/shell.tsx:23`) SHALL become stateful, desktop-only:

- **hidden** → open the sidebar and focus the current window's row.
- **visible, focus outside the sidebar** → focus the current window's row: query `navRef`-scoped `[data-window-id] [aria-current="page"]`, `scrollIntoView({block:"nearest"})` + `.focus()`, and sync the roving cursor (`setRovingKey`) — the existing mobile drawer-open effect's exact contract, reused so the tab-stop and DOM focus never desync (the Wave-2 #262 invariant). When no row is `aria-current` (board/host routes), focus the tree's current roving tab-stop or first focusable row. Wiring crosses the shell→sidebar boundary via a module focus registry (the `registerComposeStripFocuser`/`focusComposeStrip` pattern in `lib/compose-strip-events.ts`) — no DOM reach-around from shell.tsx.
- **visible, focus inside the sidebar** (`nav.contains(document.activeElement)`) → hide the sidebar, then return focus via the terminal route's `restoreFocus` path where mounted (elsewhere: blur suffices).
- **Escape while focus is inside the sidebar** SHALL return focus the same way WITHOUT hiding. No origin storage: the restore router's `recallFocus(key) ?? "tty"` IS the return target — the same resolution the hide branch uses. Escape handling must not fight the mobile drawer (mobile keeps today's behavior; the chord itself is desktop-only, and the sidebar chord keeps working on board routes where Shell mounts).

The sidebar records nothing in focus memory (chrome, not a per-window `FocusKind`).

- **GIVEN** terminal focus and a visible sidebar, **WHEN** ⌘B is pressed, **THEN** the current window's row is focused (roving cursor synced) and the sidebar stays visible.
- **GIVEN** focus on a sidebar row, **WHEN** Escape is pressed, **THEN** focus returns to the window's remembered surface and the sidebar stays visible; **WHEN** ⌘B is pressed instead, **THEN** the sidebar hides and focus returns the same way.

#### R6: Stateful compose chord
`compose-toggle`'s handler SHALL become stateful on both mounts (AppShell and the board twin), reading the strip's live focus from the `compose-strip-events` module store (`isComposeStripFocused`):

- **strip disabled** → `toggleComposeStrip()` (the existing off→on transition marks focus-on-open, which focuses the textarea).
- **strip enabled, textarea not focused** → `focusComposeStrip()`; when the registered focuser declines (disabled "no target" state), fall back to `toggleComposeStrip()` off (today's toggle behavior, so the chord is never a dead press).
- **strip enabled, textarea focused** → `toggleComposeStrip()` off (the draft store makes closing lossless); `ignoreInputs: true` is what lets this branch fire from inside the textarea.

This one-press show+focus replaces the user's ⇧⌘E-twice workaround; the strip's focus-on-open, Escape-blurs, and dock semantics are untouched.

- **GIVEN** the strip enabled and unfocused after typing `rk riff` in the terminal, **WHEN** ⌘I is pressed (mac), **THEN** the compose textarea receives focus in one press and `compose` is recorded by the textarea's existing `onFocus` recorder.
- **GIVEN** focus inside the compose textarea, **WHEN** ⌘I is pressed, **THEN** the strip closes (draft preserved in the store).

#### R7: Zen chord
`zen-toggle` SHALL toggle the existing Zoom verb on the focused tile via the app-level zoom ref seam (the `Layout: Zoom`/`Unzoom` palette bodies, `palette-layout.ts:144-150` / `zoomToggleRef` in `surface-layout.tsx`), desktop-only, `scope: "terminal"`. At arity 1 the chord is a no-op (zoom's existing gate). Zoom stays transient component state — no URL/localStorage writes.

- **GIVEN** a 2-tile layout with the code tile focused, **WHEN** ⇧⌘⏎ is pressed, **THEN** the code tile zooms full-center; a second press unzooms.
- **GIVEN** a `single:tty` layout, **WHEN** ⇧⌘⏎ is pressed, **THEN** nothing happens.

### Palette: parity gap-fills

#### R8: New palette entries
The palette SHALL gain: `Sidebar: Toggle` and `Sidebar: Focus` (layout-global entries — the sidebar exists wherever Shell mounts — bodies delegating to the same stateful seams as R5, with Focus = the show+focus arm and Toggle = plain visibility toggle); `Window: Next` and `Window: Previous` on the terminal route (reusing the existing `window-next`/`window-prev` chord handler bodies — the modulo cycle over sidebar order — so `actionId` doubles as the palette id and `withShortcutHints` decorates ⇧⌘H/L automatically); and `Compose: Focus` (the R6 show+focus arm; the existing `View: Text Input` toggle entry stays). New entries follow existing registration seams (`use-global-palette-actions.ts` for globals, `app.tsx` `paletteActions` for route entries).

- **GIVEN** the palette open on any route, **WHEN** filtering "sidebar", **THEN** `Sidebar: Toggle` (hinted ⌘B) and `Sidebar: Focus` appear.
- **GIVEN** the palette open on a window route, **WHEN** filtering "window", **THEN** `Window: Next` / `Window: Previous` appear with ⇧⌘L/⇧⌘H hints.

### Desktop Shell: switcher relocation

#### R9: Win/Linux Hosts switcher moves to Alt+digits
`app/desktop/src/menu.ts` SHALL bind the win/linux Hosts switcher radios to `Alt+1`…`Alt+9` (mac keeps `Alt+Cmd+N`; `MAX_SWITCHER_ACCELERATORS` unchanged), update the exhaustive bound-accelerator doc comment (the hand-maintained mirror rule), and the two renderer-side display mirrors MUST move in the same change: `switcherCaps` in `settings-shortcuts-panel.tsx` (the shell-owned locked row renders `Alt 1…9` on the win/linux display) and `hostAcceleratorHint` in `lib/shell-strip.ts` (strip dropdown row hints). The win/linux exhaustive bound set becomes: Alt+1–9 switcher, ⇧Ctrl+R force-reload, ⇧Ctrl+I devtools, F11 fullscreen.

- **GIVEN** the win/linux shell, **WHEN** the menu builds, **THEN** switcher accelerators are `Alt+N` and ⇧Ctrl+digits reach the page (where the SPA now binds 1/2/3).
- **GIVEN** the shortcuts panel on the Win·Linux display, **WHEN** the shell-owned rows render, **THEN** the switcher row reads Alt 1…9.

### Testing

#### R10: Unit + e2e coverage
Vitest SHALL cover the registry changes (default resolution per host, claims, the R3 parity invariant, capture/conflict sanity on the new rows) and the handler state machines where jsdom suffices (compose statefulness via the module store; sidebar branch selection). A Playwright spec on the port-3020 rig SHALL prove the integrated iframe-focus behaviors jsdom cannot (the `focus-restore.spec.ts` stub-server harness): ⌘2's three states against a real code-surface stub including the recording asymmetry (away-and-back guard behavior unchanged), ⌘1 focus/hide, zen zoom toggle, sidebar ⌘B focus + Escape return. Every new/modified `.spec.ts` ships its sibling `.spec.md` (constitution).

- **GIVEN** `just test-frontend` and the e2e spec run, **WHEN** the suite completes, **THEN** all new behaviors are covered and green.

### Non-Goals

- Sidebar roving/arrow-key navigation changes — the existing tree ARIA + roving system is reused as-is.
- A chat-tile chord (stays palette-only), a hide-without-focus layer, positional ⇧⌘digit bindings, PWA display-mode detection.
- No behavior change to `focus-hop` (⌃`), the terminal-seam refusal rules, or the steal guard itself.

### Design Decisions

#### Statefulness lives in chord handlers, not palette bodies
**Decision**: The three-state show+focus/focus/hide rule is implemented in the chord handler layer; palette `Tile:`/`Sidebar:`/`Compose:` entries keep explicit single-verb bodies.
**Why**: Palette entries are self-describing verbs a user picks by name — a stateful palette row would do different things on identical clicks; chords are positional muscle memory where statefulness is the point (JetBrains model).
**Rejected**: Making `togglePanel` itself stateful — it backs the top-bar toggles and menu checkboxes, whose checkbox semantics must stay pure toggle.
*Introduced by*: 260819-qwr7-surface-focus-chords

#### Escape/hide return rides `restoreFocus` — no origin storage
**Decision**: Both the sidebar Escape-return and every hide branch resolve the return target through the restore router (`recallFocus(key) ?? "tty"`), not a stored "origin" element.
**Why**: The remembered focus IS the user's last genuine choice; a separate origin ref would duplicate state the focus-memory module already owns and could dangle across window switches.
**Rejected**: Capturing `document.activeElement` at chord time — dangles when the layout re-renders or the window switches mid-gesture.
*Introduced by*: 260819-qwr7-surface-focus-chords

#### Switcher claims are removed, not replaced
**Decision**: `SHELL_SWITCHER_DIGITS` rows are deleted with no Alt-tier replacement rows.
**Why**: Alt is excluded from every SPA chord tier, so Alt+digit claims are unrepresentable — exactly the mac ⌥⌘ precedent, where unrepresentability is the design point; the shortcuts panel's locked row (free-form caps) is the display surface instead.
**Rejected**: Adding an `alt` claims tier — dead schema for a tier the page can never bind.
*Introduced by*: 260819-qwr7-surface-focus-chords

## Tasks

### Phase 1: Registry data

- [x] T001 Update `app/frontend/src/lib/keybindings.ts` `DEFAULT_BINDINGS`: recode `code-toggle` KeyJ→Digit2; add `tty-toggle` (Digit1) and `web-toggle` (Digit3) rows (shifted base, `macTier:"cmd"`, scope terminal, mapLabels); add `macCode:"KeyI"` + `macTier:"cmd"` to `compose-toggle`; add `zen-toggle` (Enter, shifted both platforms, scope terminal, `ignoreInputs:true`); add the reserved ⇧⌘digit comment <!-- R1 -->
- [x] T002 Remove `SHELL_SWITCHER_DIGITS` claims from `claimedKeys` in `keybindings.ts`; verify mac-browser digit reservation still covers cmd-tier Digit1–3 <!-- R2 -->
- [x] T003 Update `app/frontend/src/lib/keybindings.test.ts`: new default-resolution expectations per host, claims changes, conflict-free invariant across hosts, own-default recapture on the moved codes; add the palette-parity invariant test with its static equivalence map <!-- R1, R2, R3 -->

### Phase 2: Stateful handlers

- [x] T004 In `app/frontend/src/app.tsx`: generalize `focusCodeOnLandingRef` to a per-kind landing flag; add the stateful tile-chord helper (three-state branch on `renderLayout.order` + `focusedTileKind`, arity-1 hide gate, `restoreFocus` on hide, mobile no-op) and register handlers for `tty-toggle`/`code-toggle`/`web-toggle` (replacing `code-toggle`'s plain `togglePanel` handler) <!-- R4 -->
- [x] T005 In `app.tsx` (and the board twin's dispatcher in `board-page.tsx`): make `compose-toggle`'s handler stateful via `isComposeStripFocused` + `focusComposeStrip` + `toggleComposeStrip` (decline fallback included) <!-- R6 -->
- [x] T006 In `app.tsx`: register `zen-toggle` handler through the zoom ref seam (the `Layout: Zoom`/`Unzoom` bodies), arity>1 gated, desktop-only <!-- R7 -->
- [x] T007 Sidebar focus seam: add a module focus registry for "focus current sidebar row" (register in `sidebar/index.tsx` using the `[data-window-id] [aria-current="page"]` query + `scrollIntoView` + `.focus()` + `setRovingKey` sync, with the no-current-row fallback); rework `useSidebarKeyboardToggle` in `components/shell/shell.tsx` into the stateful ⌘B handler (show+focus / focus / hide+return) <!-- R5 -->
- [x] T008 Escape-return: keydown handling scoped to the sidebar nav — Escape while focus is inside returns focus via the terminal route's restore path without hiding (board/host routes: blur), without disturbing mobile drawer behavior <!-- R5 -->

### Phase 3: Palette + desktop shell

- [x] T009 [P] Palette entries: `Sidebar: Toggle`/`Sidebar: Focus` (layout globals), `Window: Next`/`Window: Previous` (terminal route, ids = actionIds so hints attach), `Compose: Focus`; wire bodies to the same seams as the chords <!-- R8 -->
- [x] T010 [P] `app/desktop/src/menu.ts`: win/linux switcher accelerators `Shift+Ctrl+N` → `Alt+N`, update the bound-accelerator doc comment; adjust any menu tests <!-- R9 -->
- [x] T011 [P] Renderer mirrors: `switcherCaps` in `settings-shortcuts-panel.tsx` (win/linux display reads Alt 1…9) and `hostAcceleratorHint` in `lib/shell-strip.ts`; update their tests <!-- R9 -->

### Phase 4: Tests & docs

- [x] T012 Unit tests for handler state machines where jsdom suffices: compose statefulness (`compose-strip` store interplay), sidebar branch selection + focus-registry contract, tile-chord branch table (mocked seams); update `app.test.tsx`/shell tests touched by handler rewiring <!-- R4, R5, R6, R10 -->
- [x] T013 <!-- rework cycle 1 applied: right-panel.spec.ts recoded to Shift+Control+Digit2 with stateful assertions + spec.md updated; 3 should-fix + 2 nice-to-have applied; gates re-run green --> Playwright e2e on the port-3020 rig: stateful chord spec (new `.spec.ts` + sibling `.spec.md`) covering ⌘2 three-state vs the code-surface stub (recording asymmetry preserved), ⌘1 focus/hide, ⇧⌘⏎ zoom toggle, ⌘B sidebar focus + Escape return; reuse the `focus-restore.spec.ts` harness patterns (real stub server, sidebar-row navigation, no `page.goto` mid-test) <!-- R4, R5, R7, R10 -->
- [x] T014 Run verification gates: `cd app/backend && go test ./...` (untouched, sanity), `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "<new spec>"`, then `just build` <!-- R10 -->

## Execution Order

- T001 → T002 → T003 (registry before its tests); T004–T008 depend on T001; T009–T011 are parallel after T004/T007; T012/T013 after Phase 2–3; T014 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` resolves the full new keymap per host (mac shell/browser, win/linux) with ⌘J and mac ⇧⌘E gone
- [x] A-002 R4: All three tile chords implement show+focus / focus / hide-with-restore, arity-1 hide no-op, mobile no-op
- [x] A-003 R5: ⌘B implements show+focus / focus-current-row (roving synced) / hide+return; Escape returns without hiding
- [x] A-004 R6: Compose chord is one-press show+focus, closes from inside the textarea, decline-fallback works
- [x] A-005 R7: Zen chord toggles zoom on the focused tile via the existing seam; no-op at arity 1; no persistence writes
- [x] A-006 R8: The five new palette entries exist with correct hints; `Window: Next/Previous` reuse the chord bodies
- [x] A-007 R9: Win/linux switcher is Alt+1–9 in menu.ts with doc comment and BOTH renderer mirrors updated

### Behavioral Correctness

- [x] A-008 R4: ⌘2-to-code records nothing in focus memory; ⌘1 records `tty` via the existing seam; steal-guard e2e (`focus-restore.spec.ts`) still green
- [x] A-009 R6: Compose focus records `compose` only via the textarea's existing `onFocus` recorder (no new recording call)
- [x] A-010 R1: Terminal-seam behavior unchanged for plain-Ctrl chords on win/linux; ⇧Ctrl+1/2/3 refuse to the pane per shifted-tier rule 1

### Removal Verification

- [x] A-011 R1: No binding, claim, hint, or panel keycap still references KeyJ for code-toggle or mac ⇧⌘E for compose-toggle — rework cycle 1 recoded `right-panel.spec.ts` to `Shift+Control+Digit2` and updated its `.spec.md`; verified in review cycle 2: grep finds no stale KeyJ/⌘J/⇧⌘E references outside intentional retirement-assertion tests, and the recoded spec is green on the 3020 rig (exit 0)
- [x] A-012 R2: `SHELL_SWITCHER_DIGITS` is gone; no shifted-digit shell claim remains on win/linux

### Scenario Coverage

- [x] A-013 R4: e2e proves the ⌘2 three-state cycle against a real iframe stub including focus landing after open
- [x] A-014 R5: e2e proves ⌘B → arrow-free row focus (roving synced), Escape-return, and hide+return, per the spec's `.spec.md` (an "Enter navigates" leg would be vacuous — the focused row IS the current window's row, and roving/arrow nav is an explicit Non-Goal; wording trimmed at review cycle 1)
- [x] A-015 R3: The parity invariant test fails when a binding loses its palette entry (verified by the test's own negative case or construction)

### Edge Cases & Error Handling

- [x] A-016 R4: A chord for an unavailable surface (no code lens) mounts no handler and the chord falls through untouched (no `preventDefault`)
- [x] A-017 R5: ⌘B on a board/host route (no `aria-current` window row) focuses the tree's roving tab-stop/first row without throwing
- [x] A-018 R6: Compose chord on a route with `focused === null` (disabled strip) never dead-presses (decline fallback toggles off/on)

### Code Quality

- [x] A-019 Pattern consistency: new seams follow the module-registry pattern (`compose-strip-events` precedent); no `document.querySelector` reach-arounds from shell.tsx
- [x] A-020 No unnecessary duplication: focus/landing/restore all ride existing seams (`layoutFocusTileRef`, landing flag, `restoreFocus`, `togglePanel`, zoom ref) — no parallel focus system
- [x] A-021 No comment narration; comments state constraints only (recording asymmetry, roving-sync invariant)
- [x] A-022 Tests ride `just` recipes only; e2e on port 3020; `.spec.md` siblings shipped

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. Everything it obsoleted was removed in the same diff (`SHELL_SWITCHER_DIGITS` in `keybindings.ts`, the inline `cycleWindow`/`canCycle` in `app.tsx`'s dispatcher, the boolean `focusCodeOnLandingRef`, `useSidebarKeyboardToggle`'s `toggle` param, and the stale `⇧Ctrl+J` e2e leg in `right-panel.spec.ts` — recoded to Digit2 in rework cycle 1).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New actionIds are `tty-toggle` / `web-toggle` / `zen-toggle`, matching the `code-toggle` naming family | Intake left names apply-level; family pattern gives one obvious answer | S:55 R:90 A:85 D:75 |
| 2 | Confident | Sidebar current-row focus reuses the mobile drawer-open effect's contract (`[data-window-id] [aria-current="page"]` + `scrollIntoView` + `focus()` + `setRovingKey` sync) via a module focus registry | Existing seam verified in sidebar memory; the roving-sync invariant (#262) requires the pairing | S:70 R:85 A:85 D:80 |
| 3 | Confident | Escape/hide return target is `restoreFocus`'s `recallFocus(key) ?? "tty"` — no origin element storage | Intake assumption 16 left mechanism apply-level; focus-memory already owns the user's last choice | S:60 R:85 A:80 D:70 |
| 4 | Confident | Compose chord's visible-unfocused branch falls back to toggle-off when the registered focuser declines (disabled no-target state) | Keeps the chord from dead-pressing; mirrors the focuser's documented `false` return contract | S:55 R:85 A:80 D:70 |
| 5 | Confident | Tile chords carry no `ignoreInputs` (they need not fire from text inputs; xterm focus is already carved out of suppression) | Matches today's `code-toggle`; conservative default, trivially reversible | S:50 R:90 A:80 D:70 |
| 6 | Confident | mac-browser ⌘I/⌘Y-class interception is attempted with no dedicated fallback wiring — a blocked chord simply stays palette-reachable | Shell-first posture from intake; no verification gate required | S:65 R:85 A:80 D:75 |
| 7 | Confident | New-row copy: labels "Toggle terminal" / "Toggle web view" / "Toggle zen mode", descriptions parallel to `code-toggle`'s "open/close the <kind> tile"; `zen-toggle` carries no mapLabel (Enter has no keycap cell in the overlay grids — the Backquote precedent) | Plan fixed codes/tiers/scope/mapLabels for the digits but not row copy; parallel construction is the file's convention | S:70 R:85 A:80 D:70 |
| 8 | Confident | The parity map names the T009 palette ids `sidebar-focus` and `compose-focus` for "Sidebar: Focus" / "Compose: Focus"; "Sidebar: Toggle" and "Window: Next/Previous" ride the id = actionId join | Plan names the entry labels, not their ids; `withShortcutHints` needs id = actionId for hints, which pins Toggle/Next/Previous and leaves the two Focus entries free | S:65 R:80 A:75 D:65 |
| 9 | Confident | `restoreFocus` gained an optional `exclude` kind: a tile-chord hide passes the just-hidden kind, so memory pointing at the hidden tile resolves to the tty default instead of `code`'s no-op arm (which rides the workbench's load-time grab — a chord hide never triggers it, so focus would strand, most commonly when ⌘2 is reclaimed from inside the editor and `onInteract` has just recorded `code`) | Plan says hide rides `restoreFocus` "so focus never strands"; the exclude is the minimal change that makes that true for the hidden-kind case | S:60 R:85 A:80 D:75 |
| 10 | Confident | Shell↔sidebar/route wiring rides a NEW module `lib/sidebar-events.ts` (row-focuser + window-focus-restorer registries, the `compose-strip-events` shape); shell.tsx tests containment against its own desktop `<aside>` (which wraps the nav) rather than the nav itself | Plan names the registry pattern but not the module location; the aside is Shell-owned DOM, so `aside.contains` is not a reach-around and equals `nav.contains` | S:65 R:85 A:80 D:75 |
| 11 | Confident | "Desktop-only" for the sidebar chord gates the new stateful arms; mobile keeps today's plain visibility toggle (the drawer's focus trap keeps owning Escape there) | R5's "mobile keeps today's behavior" + today's behavior is the plain toggle | S:55 R:85 A:80 D:70 |
| 12 | Confident | The sidebar Escape-return listener is nav-scoped bubble-phase, layered AFTER the tree's selection-clear capture handler and the row flyout's dismiss (both consume first), and skips editable targets (rename inputs) | Existing Escape consumers must keep first refusal; the ordering falls out of capture/stopPropagation without new coordination | S:55 R:85 A:80 D:70 |
| 13 | Confident | `Window: Next`/`Previous` OWN the modulo-cycle body in a new `windowCycleActions` memo and the chord handlers rewired to `fromPalette("window-prev"/"window-next")` — the reuse direction inverts (palette owns, chord resolves) rather than duplicating the cycle | R8 says "reuse the chord handler bodies"; the dispatcher's `fromPalette` convention is the file's one-body-two-triggers mechanism, so this is the drift-free reading | S:60 R:85 A:80 D:70 |
| 14 | Confident | `Compose: Focus` gates on `sessionName` beside `View: Text Input` and a focuser decline is a no-op there (the never-dead-press toggle fallback stays chord-only); `Sidebar: Focus` opens-then-focuses via the chord's rAF deferral, and the hide+return arm stays chord-only | Palette entries keep explicit single-verb semantics (the statefulness design decision); the strip/sidebar seams already no-op safely on decline | S:55 R:85 A:80 D:70 |
| 15 | Certain | No desktop menu tests exist (`app/desktop/src` has no `menu.test.ts`), so T010 adjusted none; desktop verification was `pnpm run compile` + `pnpm test` (144 pass) | Directory listing + full desktop suite run | S:90 R:90 A:90 D:85 |
| 16 | Confident | The zoom ref seam (`zoomToggleRef`) now toggles the FOCUSED slot, not slot A — R7's GIVEN ("code tile focused → ⇧⌘⏎ zooms the code tile") is unsatisfiable otherwise; the palette `Layout: Zoom`/`Unzoom` entries ride the same seam (zooming the focused tile is the better palette semantic too), and no existing test pinned slot-A (the old unit test passed with the default focused slot = A and was rewritten to pin focused-slot behavior) | R7's scenario text vs the slot-A seam was a genuine conflict; the focused slot IS the tile the user acts on | S:70 R:85 A:80 D:75 |
| 17 | Confident | T012 extracted the two chord bodies for jsdom testability instead of rendering AppShell: `runComposeToggleChord(enabled, toggle)` into `compose-strip-events.ts` (both mounts call it — also removes the app/board duplication) and `tileChordHandler(seams)` into new `lib/tile-chord.ts` (app.tsx wires refs at the call site) | app.test.tsx's convention is testing pure/seam-level units, never rendering AppShell; extraction is the minimal seam that keeps the branch tables under test | S:65 R:85 A:80 D:70 |
| 18 | Confident | E2e tile-focus assertions ride the focused-slot accent border (the shortcut-registry focus-hop precedent) — the focus seam's contract is slot focus, not DOM focus; DOM focus enters the iframe only via the stub grab or genuine in-frame interaction. Consequence: a chord reclaimed from inside the iframe fires `onInteract` FIRST (re-flipping the focused slot to code), so the tty hide arm is only reachable with parent-side focus — the ⌘1 hide test clicks the terminal before pressing | Verified empirically on the rig: in-frame ⌘1 never hid the tty tile (border stayed on tty); with xterm DOM focus the hide arm fired | S:60 R:85 A:80 D:70 |
| 19 | Confident | E2e readiness gates: the first tile-chord press waits for the rail toggle's visibility (code-lens availability arrives via SSE after route mount — a chord for a not-yet-available surface correctly mounts no handler), and the ⌘B test waits for the row's `aria-current="page"` (the focus arm queries it at press time) | Both races bit on the rig (no-op presses) until gated; the gates mirror `switchToWindow`'s own aria-current wait | S:55 R:85 A:80 D:70 |

19 assumptions (1 certain, 18 confident, 0 tentative).
