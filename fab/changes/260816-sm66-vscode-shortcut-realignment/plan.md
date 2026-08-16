# Plan: VS Code Shortcut Realignment

**Change**: 260816-sm66-vscode-shortcut-realignment
**Intake**: `intake.md`

## Requirements

### Keybindings Registry: Default Bindings

#### R1: `sidebar-toggle` moves to the B keycap
The `sidebar-toggle` binding (`app/frontend/src/lib/keybindings.ts:201`) SHALL change from `{ code: "Backslash", tier: "cmd" }` to `{ code: "KeyB", tier: "shifted", macTier: "cmd", mapLabel: "sidebar" }` (scope/kind/label unchanged). No `macShellOnly` — the mac demotion applies in both hosts.

- **GIVEN** a macOS host (shell or browser), **WHEN** the user presses ⌘B, **THEN** the sidebar toggles (⌘B is `preventDefault`-interceptable in a mac browser; `KeyB` carries no claimed-keys entry in any tier).
- **GIVEN** a Win/Linux host, **WHEN** the user presses ⇧Ctrl+B, **THEN** the sidebar toggles, **AND** plain Ctrl+B still reaches the pane (readline back-char / nested-tmux prefix).
- **GIVEN** any host, **WHEN** the effective map resolves, **THEN** `Backslash`/`cmd` is no longer a shipped default (freed, unclaimed — see Non-Goals) and a user override may still bind it.

#### R2: `panel-toggle` is retired entirely
The `panel-toggle` binding row (`keybindings.ts:208`, ⇧⌘./⇧Ctrl+.) and the action itself SHALL be removed — binding, `app.tsx` handler, and hint plumbing. No override migration: orphaned `panel-toggle` entries in `localStorage["runkit-keybindings"]` stay inert under `parseOverrides`' tolerant posture.

- **GIVEN** the shipped registry, **WHEN** ⇧⌘. / ⇧Ctrl+. is pressed, **THEN** no app action fires (the chord falls through untouched).
- **GIVEN** the palette, **WHEN** the user needs to toggle the web tile, **THEN** `Layout: Add Web` / `Layout: Close Web` and the top-bar surface toggles remain reachable (Constitution V via palette).

#### R3: New `code-toggle` on the J keycap
A new builtin binding SHALL be added: `{ actionId: "code-toggle", code: "KeyJ", tier: "shifted", macTier: "cmd", scope: "terminal", kind: "builtin", label: "Toggle code editor", description: "open/close the code tile", mapLabel: "code" }`. No `macShellOnly` pending the ⌘J verification gate (see Design Decisions).

- **GIVEN** a desktop window route whose window has the `code` surface available, **WHEN** ⌘J (mac) / ⇧Ctrl+J (Win/Linux) is pressed, **THEN** the code tile toggles via `togglePanel("code")` (open → `closeSurface`, closed → `addSurface`, through `applyLayout`).
- **GIVEN** a window with no code lens (no git root) or a mobile viewport, **WHEN** the chord is pressed, **THEN** the handler is absent and the chord falls through untouched (dispatcher fall-through rule).
- **GIVEN** focus inside the code iframe, **WHEN** ⌘J/⇧Ctrl+J is pressed, **THEN** the existing reclaim seam (`hasReclaimableMatch` — non-`ttyOnly` match) re-dispatches it to the parent and the tile closes (toggle symmetry, zero reclaim-code change).

#### R4: New `focus-hop` on the Backquote keycap
A new builtin binding SHALL be added: `{ actionId: "focus-hop", code: "Backquote", tier: "shifted", macTier: "ctrl", scope: "terminal", kind: "builtin", label: "Focus terminal ↔ code", description: "hop focus between the tty and code tiles" }`. This is the first shipped `ctrl`-tier default (mac ⌃`; Win/Linux ⇧Ctrl+`).

- **GIVEN** a desktop window route with the code surface available and `focusedTileKind === "code"`, **WHEN** the chord fires, **THEN** focus moves to the tty tile through the same focus-by-kind path `Layout: Focus <Surface>` uses (`layoutFocusTileRef`), recording `tty` via that seam's existing `recordTtySlot`.
- **GIVEN** `focusedTileKind !== "code"` and the code tile open, **WHEN** the chord fires, **THEN** focus moves to the code tile via `layoutFocusTileRef` **without** writing `code` into focus memory (the recording asymmetry: only in-frame `onInteract` records `code` — steal-guard design preserved).
- **GIVEN** the code tile closed but the code surface available, **WHEN** the chord fires, **THEN** the tile is opened (`togglePanel("code")`) and then focused — VS Code's ⌃`-opens-the-hidden-panel analog (see Design Decisions).
- **GIVEN** focus inside the code iframe, **WHEN** ⌃`/⇧Ctrl+` is pressed, **THEN** it is reclaimed (non-`ttyOnly`) and hops back to tty — deliberately preempting code-server's own ⌃` integrated-terminal toggle.
- **GIVEN** no code lens on the window or a mobile viewport, **WHEN** the chord is pressed, **THEN** the handler is absent and the chord falls through.

#### R5: Standing keycap constraints
⇧⌘P SHALL remain unbound, recorded as a registry comment reserving it for a future create/open-PR action (Conductor convention). `compose-toggle` (⇧⌘E) SHALL NOT move. The tier policy stands: letter constant, modifier per platform, mac demotes to ⌘ where the browser permits — no forced shifted-tier-for-toggles.

- **GIVEN** the shipped registry after this change, **WHEN** defaults are enumerated, **THEN** no binding occupies `KeyP` on any tier, `compose-toggle` is byte-identical to HEAD, and a comment near `DEFAULT_BINDINGS` records the ⇧⌘P reservation.

### Terminal Seam: Third Refusal Rule

#### R6: `shouldRefuseTerminalChord` gains a mac-only ctrl-tier rule
`shouldRefuseTerminalChord` (`keybindings.ts:435`) SHALL add exactly one rule: on macOS, an enabled `ctrl`-tier match pressed with `ctrlKey` (and without `metaKey`) is refused, so ⌃` bubbles to the window dispatcher under terminal focus. This steals NUL (the byte Ctrl+` encodes to) from the pane — near-zero cost, VS Code's own trade. Rules 1–2 are untouched.

- **GIVEN** a mac host with terminal focus, **WHEN** ⌃` is pressed, **THEN** the handler refuses it and the `focus-hop` action fires.
- **GIVEN** a mac host with terminal focus, **WHEN** Ctrl+[ (or any plain-Ctrl chord matching no enabled ctrl-tier binding) is pressed, **THEN** it reaches the pane unchanged (ESC preserved).
- **GIVEN** a Win/Linux host, **WHEN** any plain-Ctrl chord is pressed, **THEN** the seam is byte-identical to HEAD (no ctrl-tier default resolves there — `focus-hop`'s base tier is shifted; the new rule is platform-gated to mac).

### App Wiring: Handlers and Hint Plumbing

#### R7: Handler map rewiring in `app.tsx`
The `panel-toggle` handler (`app.tsx` ~3411) SHALL be replaced by a `code-toggle` handler gated on the desktop window route with `panelSurfaces.includes("code")`, calling `togglePanel("code")`. A `focus-hop` handler SHALL implement R4's hop semantics (desktop-only, same gate plus the open-then-focus branch). Handler absence under failed gates is the no-op (fall-through), matching the `panel-toggle`/split precedent.

- **GIVEN** the dispatcher mounts on AppShell, **WHEN** the handler memo builds, **THEN** `panel-toggle` no longer appears and `code-toggle`/`focus-hop` appear with their gates.

#### R8: `palette-layout.ts` hint seam retargets to the code surface
The `toggleTarget`/`toggleShortcut` options in `buildLayoutActions` (`lib/palette-layout.ts:83-106`) SHALL be kept and retargeted: `app.tsx` (~2885) passes the `code` surface as `toggleTarget` with the `code-toggle` effective combo as `toggleShortcut`, so the code surface's `Layout: Add Code` / `Layout: Close Code` entries carry the ⌘J/⇧Ctrl+J hint. The hint derivation keeps the enabled-else-`undefined` rule.

- **GIVEN** a window with the code surface available and `code-toggle` enabled, **WHEN** the palette lists `Layout: Add Code` (or `Close Code`), **THEN** the entry shows the `code-toggle` chord hint; **AND** web-surface entries carry no toggle hint.

#### R9: `shell.tsx` comments follow the registry
`useSidebarKeyboardToggle` in `components/shell/shell.tsx` reads its combo via `byAction.get("sidebar-toggle")`, so it needs no logic change; its ⌘\-citing comments SHALL be updated to the B-keycap reality.

- **GIVEN** the shipped code, **WHEN** the sidebar chord resolves, **THEN** the component-local listener fires on the new default with zero logic delta.

### Tests

#### R10: Unit coverage in `keybindings.test.ts`
Unit tests SHALL cover: the three new/changed default rows resolving per host (mac shell, mac browser, Win/Linux); the conflict-free invariant (`findConflicts`) across all hosts; refusal-rule-3 units (mac ⌃` refused; mac Ctrl+[ passes; Win/Linux plain-Ctrl never refused — byte-identical); claimed-keys non-collision for `KeyB`/`KeyJ`/`Backquote`; removal of the 5 `panel-toggle` references; and rework of the synthetic-ctrl-row scaffolding (~lines 500–597) now that a real ctrl-tier default ships.

- **GIVEN** `just test-frontend`, **WHEN** the suite runs, **THEN** all keybindings tests pass with the new defaults.

#### R11: e2e coverage and companion docs
`tests/e2e/shortcut-registry.spec.ts` (+ `.spec.md`, same commit — constitution Test Companion Docs) SHALL add: ⇧Ctrl+B sidebar toggle, ⇧Ctrl+J code toggle (window with code surface), ⇧Ctrl+` focus hop on Linux; mac-block cases for ⌘B and ⌘J and ⌃` where expressible (deep mac paths stay unit territory). `tests/e2e/right-panel.spec.ts:388-392` (+ `.spec.md`) SHALL retire or retarget its `Shift+Control+Period` presses to the new reality.

- **GIVEN** `just test-e2e "shortcut-registry"` and `just test-e2e "right-panel"`, **WHEN** the specs run on the port-3020 rig, **THEN** they pass.

### Non-Goals

- Freeing ⌘\ to become a mac split alias — out of scope (intake assumption 7; keeps this change purely realignment).
- Any chat-surface toggle or chat readiness work.
- Override migration or localStorage schema changes (diffs-only shape untouched).
- Backend, API, or route changes (Constitution IV untouched).

### Design Decisions

#### Focus-hop opens the closed code tile (open-then-focus)
**Decision**: when the code surface is available but its tile is closed, `focus-hop` opens it via `togglePanel("code")` and then focuses it, rather than no-opping.
**Why**: VS Code's ⌃` opens the hidden integrated terminal — the borrowed muscle memory includes the open half; a no-op makes the chord dead in the shipped `single:tty` default layout, which is most windows most of the time. Resolves intake assumption 15 (deferred; apply decides-and-records).
**Rejected**: no-op when closed — makes the chord useless in the default layout and diverges from the VS Code gesture being borrowed.
*Introduced by*: 260816-sm66-vscode-shortcut-realignment

#### `code-toggle` replaces `panel-toggle` rather than coexisting
**Decision**: the generic first-non-tty-surface toggle is deleted; the dedicated code toggle is the only surface-toggle chord.
**Why**: user's explicit judgment — the chat panel isn't usable, so the generic chord wastes a keycap; the web tile keeps palette/top-bar paths (Constitution V).
**Rejected**: keeping both (two chords for overlapping behavior, one spent on an unusable surface).
*Introduced by*: 260816-sm66-vscode-shortcut-realignment

#### ⌘J ships un-demoted in mac browsers pending a manual verification gate
**Decision**: `code-toggle` ships `macTier: "cmd"` with no `macShellOnly`; a pre-ship manual check that `preventDefault` suppresses mac Chrome's Downloads panel is a documented gate (see Notes). Recorded fallback if it fails: add `macShellOnly: true` plus a `browser`-owner claimed-keys row on `cmd`-tier `KeyJ` (shell keeps ⌘J; mac browser reverts to ⇧⌘J).
**Why**: ⌘J is the same accelerator class as the shipped ⌘D/⌘[ interceptions (interceptable, not reserved); the fallback is a one-field data change, so shipping the better default and verifying is cheaper than pre-emptively degrading.
**Rejected**: shipping `macShellOnly` up front — permanently taxes mac-browser users for a risk that is likely nil and never gets re-verified.
*Introduced by*: 260816-sm66-vscode-shortcut-realignment

## Tasks

### Phase 1: Registry (`app/frontend/src/lib/keybindings.ts` + unit tests)

- [x] T001 Change the `sidebar-toggle` row (keybindings.ts:201) to `code: "KeyB", tier: "shifted", macTier: "cmd", mapLabel: "sidebar"`; sweep keybindings.ts comments that cite ⌘\ for the sidebar. <!-- R1 -->
- [x] T002 Remove the `panel-toggle` row (keybindings.ts:208). <!-- R2 -->
- [x] T003 Add the `code-toggle` row per R3's exact shape. <!-- R3 -->
- [x] T004 Add the `focus-hop` row per R4's exact shape, and a `DEFAULT_BINDINGS`-adjacent comment reserving ⇧⌘P (`KeyP`, shifted) for a future PR action. <!-- R4 -->
- [x] T005 Add refusal rule 3 to `shouldRefuseTerminalChord` (keybindings.ts:435): `platform === "mac" && e.ctrlKey && !e.metaKey && matches.some((b) => b.tier === "ctrl")`; extend the doc comment with the NUL-trade rationale. <!-- R6 -->
- [x] T006 Update `keybindings.test.ts`: new-default resolution per host, conflict-free invariant across hosts, refusal-rule-3 matrix (mac ⌃` refused / mac Ctrl+[ passes / Win-Linux byte-identical), claimed-keys non-collision for KeyB/KeyJ/Backquote, remove the 5 `panel-toggle` references, rework the synthetic-ctrl-row scaffolding (~500–597) against the real shipped ctrl-tier default, assert `compose-toggle` unchanged and `KeyP` unbound. <!-- R10 -->

### Phase 2: Wiring (`app.tsx`, `palette-layout.ts`, `shell.tsx`)

- [x] T007 In `app/frontend/src/app.tsx`: remove the `panel-toggle` handler (~3411); add the `code-toggle` handler (same gate shape, `togglePanel("code")`, present only when `windowParam && !isMobile && panelSurfaces.includes("code")`). <!-- R7 -->
- [x] T008 In `app.tsx`: add the `focus-hop` handler — same gate as T007; `focusedTileKind === "code"` → `layoutFocusTileRef.current?.("tty")`; else if code tile open → `layoutFocusTileRef.current?.("code")`; else `togglePanel("code")` then focus the code tile once mounted (open-then-focus per Design Decisions; no focus-memory write on the code branch). <!-- R4 -->
- [x] T009 In `app.tsx` (~2885): retarget the `buildLayoutActions` hint plumbing — `toggleTarget: "code"`, `toggleShortcut` derived from `bindingByAction.get("code-toggle")` (enabled-else-`undefined`); update `lib/palette-layout.ts` doc comments and `palette-layout.test.ts` for the retarget. <!-- R8 -->
- [x] T010 [P] Update `components/shell/shell.tsx` `useSidebarKeyboardToggle` comments (⌘\ → B keycap); verify zero logic change needed. <!-- R9 -->
- [x] T011 [P] Verify `code-surface.tsx` / `surface-layout.tsx` need no logic change (reclaim + focus seams are data-driven); update stale chord-citing comments if any (e.g. the `panel-toggle` mention at app.tsx:1096 and keybindings comments referenced from those files). <!-- R7 -->

### Phase 3: e2e & verification

- [x] T012 Update `tests/e2e/shortcut-registry.spec.ts` + `.spec.md`: ⇧Ctrl+B sidebar toggle; ⇧Ctrl+J code toggle on a code-surface window; ⇧Ctrl+` hop; mac-block ⌘B/⌘J/⌃` cases where expressible. Run via `just test-e2e "shortcut-registry"`. <!-- R11 -->
- [x] T013 Update `tests/e2e/right-panel.spec.ts` (388–392) + `.spec.md`: replace the `Shift+Control+Period` presses with the surviving toggle path (palette or `code-toggle` chord where the fixture window has a code surface, else palette-only). Run via `just test-e2e "right-panel"`. <!-- R11 -->
- [x] T014 Run the gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, and the two targeted e2e specs above. <!-- R10 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `sidebar-toggle` resolves ⌘B (mac both hosts) / ⇧Ctrl+B (Win/Linux); `Backslash`/`cmd` is no longer any shipped default.
- [x] A-002 R2: no `panel-toggle` binding, handler, or hint plumbing remains in `app/frontend/src` (grep clean; historical memory/docs references exempt).
- [x] A-003 R3: `code-toggle` toggles the code tile through `togglePanel("code")` on eligible windows.
- [x] A-004 R4: `focus-hop` hops tty↔code per R4's four scenarios, including open-then-focus on a closed tile.
- [x] A-005 R5: ⇧⌘P reservation comment present; `compose-toggle` row byte-identical; no `KeyP` default on any tier.
- [x] A-006 R6: refusal rule 3 exists, mac-only, ctrl-tier, `ctrlKey`-gated.

### Behavioral Correctness

- [x] A-007 R6: Win/Linux seam behavior is byte-identical to HEAD for every plain-Ctrl chord (unit-proven).
- [x] A-008 R4: hop-to-code writes nothing into focus memory (recording asymmetry preserved; steal guard unaffected).
- [x] A-009 R7: with no code lens or on mobile, `code-toggle`/`focus-hop` chords fall through untouched (handlers absent).

### Removal Verification

- [x] A-010 R2: `keybindings.test.ts` carries zero `panel-toggle` references; `right-panel.spec.ts` no longer presses `Shift+Control+Period`.

### Scenario Coverage

- [x] A-011 R11: shortcut-registry e2e covers B/J/backtick on Linux plus the mac block additions, with `.spec.md` updated in the same commit.
- [x] A-012 R10: unit tests cover the refusal-rule-3 matrix and the cross-host conflict-free invariant.

### Edge Cases & Error Handling

- [x] A-013 R3: ⌘J/⇧Ctrl+J inside the code iframe is reclaimed and closes the tile (toggle symmetry, no reclaim-code change).
- [x] A-014 R4: ⌃` inside the code iframe is reclaimed and hops to tty, preempting code-server's own binding.

### Code Quality

- [x] A-015 Pattern consistency: new rows and handlers follow the registry/data conventions of surrounding code (declarative rows, gate-by-handler-absence, enabled-else-`undefined` hints).
- [x] A-016 No unnecessary duplication: hop reuses `layoutFocusTileRef`/`togglePanel`; no parallel focus or toggle machinery introduced.
- [x] A-017 Comment discipline: no narration, reviewer-addressed comments, or change-ID citations in code comments (code-quality anti-pattern).
- [x] A-018 Tests run only via `just` recipes (`just test-frontend`, `just test-e2e`/`just pw`) — never raw playwright/vitest.

## Notes

- **Pre-ship manual gate (not automatable on the Linux rig)**: verify in mac Chrome that the intercepted ⌘J suppresses the Downloads panel. If it fails: `macShellOnly: true` on `code-toggle` + a `browser` claimed-keys row on `cmd`-tier `KeyJ` (Design Decisions). Surface this in the PR description.
- Win/Linux ⇧Ctrl+J shadows Chrome's DevTools-console accelerator — accepted (interceptable, not reserved; DevTools stays on F12/⇧Ctrl+I). Intake assumption 10.
- e2e must use the port-3020 isolation (`just test-e2e` / `just pw`) — `just pw` is poisoned by `RK_PORT=3000` in this environment, prefer `just test-e2e "<spec>:<line>"` for isolated runs.

## Deletion Candidates

- `app/frontend/src/lib/window-transition.ts:610` — the `"\\"` entry in `isMaskExemptKey`'s Ctrl-exempt set (plus the Ctrl+\/Cmd+\-citing comments at :586 and :589-590): dead post-realignment — no shipped binding uses Ctrl+\ any longer, while the sidebar chord the exemption existed for moved to ⇧Ctrl+B/⌘B; review flagged as a should-fix finding (swap to a shift-aware `b` exemption or drop).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Focus-hop on a closed code tile opens-then-focuses (resolves intake row 15) | VS Code's ⌃` opens the hidden panel — the borrowed gesture includes the open half; no-op would dead the chord in the default `single:tty` layout | S:55 R:75 A:70 D:60 |
| 2 | Confident | The `toggleTarget`/`toggleShortcut` seam is kept and retargeted to the code surface (not deleted) | Preserves chord discoverability via the Add/Close palette hint at zero new machinery; the intake offered either path | S:60 R:85 A:80 D:70 |
| 3 | Confident | `focus-hop` ships no `mapLabel` — `Backquote` has no keycap cell in the overlay grids (the `Period`/`Backslash`/`Comma` no-cell precedent); `formatCombo` already renders `` Ctrl+` `` (cap map line 726) | Verified against the grid model and the existing cap map | S:65 R:90 A:85 D:75 |
| 4 | Confident | Refusal rule 3 requires `!e.metaKey` alongside `ctrlKey` so a mac ⌘-and-Ctrl combined press cannot double-match | Mirrors rule 2's load-bearing `metaKey` gate in the inverse direction; cheap and strictly narrowing | S:55 R:85 A:75 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
