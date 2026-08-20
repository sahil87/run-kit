# Plan: Host Menu Shortcut + Digit Select

**Change**: 260820-nv0o-host-menu-shortcut-digit-select
**Intake**: `intake.md`

## Requirements

### Keybindings: `host-menu-open` registry entry

#### R1: New SPA binding on the shifted tier
`app/frontend/src/lib/keybindings.ts` `DEFAULT_BINDINGS` SHALL gain a `host-menu-open` entry: `code: "KeyM"`, `tier: "shifted"`, `scope: "global"`, `kind: "builtin"`, label `"Host switcher"`, description `"open the hosts menu"`, `mapLabel: "hosts"`. It MUST carry **no** `macTier`, `macCode`, or `macShellOnly` refinement — ⌘M is the mac shell's minimize claim (`MAC_SHELL_CMD_CLAIMS`) and the mac-browser system minimize claim, so the chord is ⇧⌘M on mac and ⇧Ctrl+M on Windows/Linux everywhere. `KeyM` is free on the shifted tier in every claim set, so the shipped-defaults conflict-free invariant (`findConflicts` test) MUST keep passing with the row added.

- **GIVEN** a mac host (shell or browser)
- **WHEN** the default binding resolves through `defaultComboFor`
- **THEN** the effective combo is ⇧⌘M (`KeyM`, `shifted`), enabled, `isDefault: true`

- **GIVEN** a Windows/Linux host
- **WHEN** the default binding resolves
- **THEN** the effective combo is ⇧Ctrl+M — and the terminal seam's rule 1 (refuse any enabled shifted-tier match) already bubbles it out from under xterm focus with no `attachCustomKeyEventHandler` change

### Titlebar strip: chord handler + digit select

#### R2: Chord handler mounts only where the strip renders, and toggles
`ShellTitlebarStrip` (`app/frontend/src/components/shell-titlebar-strip.tsx`) SHALL own a component-local window `keydown` listener for `host-menu-open` — the `useSidebarKeyboardToggle` pattern (`byAction.get("host-menu-open")` + `matchesCombo` + `shouldSuppressChord`, binding and live state in refs so the listener registers once per mount). The handler SHALL toggle: closed → `setOpen(true)` (the existing open-transition effect places focus on the active row); open → `setOpen(false)` and refocus the trigger (the Escape path's treatment). When the strip is **not interactive** (`stripSwitcherEnabled` false — older shell or empty list) the handler MUST NOT `preventDefault` — the chord falls through untouched. In a browser host the strip never mounts (`isShell()` gate in `AppLayout`), so the binding resolves to no handler anywhere else — the existing handler-presence gating pattern.

- **GIVEN** the desktop shell with a non-empty host list and the menu closed
- **WHEN** ⇧⌘M is pressed (including while a terminal owns focus)
- **THEN** the hosts menu opens and focus lands on the active row

- **GIVEN** the menu is open
- **WHEN** ⇧⌘M is pressed again
- **THEN** the menu closes and focus returns to the trigger

- **GIVEN** an older shell where the switcher is not interactive
- **WHEN** ⇧⌘M is pressed
- **THEN** nothing is prevented and the key falls through

#### R3: Plain digits 1–9 select a host while the menu is open
The open-menu capture-phase `handleKey` in `shell-titlebar-strip.tsx` SHALL handle plain digits: on `e.code` `Digit1`–`Digit9` with **no modifiers** (`!metaKey && !ctrlKey && !altKey && !shiftKey`), select the corresponding host row — `rows[n-1]` in rendered-list order, which IS the ⌥⌘1–9/Alt+1–9 accelerator order — through the same `selectHost` path click/Enter uses (preventDefault + stopPropagation when acting). Digit N beyond the live host count (read from `hostCountRef.current`, the arrow-guard precedent) MUST be a no-op that releases the key. The existing `dialogOpen` early-return already suppresses digits while the Edit dialog or remove confirm is up and MUST keep doing so.

- **GIVEN** the menu is open with 3 hosts
- **WHEN** `2` is pressed
- **THEN** `selectHost` fires for the second row (the shell `switchToHost` seam) and the menu closes

- **GIVEN** the menu is open with 3 hosts
- **WHEN** `7` is pressed
- **THEN** nothing happens and the key is not swallowed

- **GIVEN** the Edit Host dialog is open above the menu
- **WHEN** a digit is typed
- **THEN** it reaches the dialog's input untouched

### Titlebar strip: action-cluster reveal semantics

#### R4: Cluster reveals on hover + `:focus-visible` only
The row action cluster (edit · remove · grip, ~line 695) currently uses `invisible … group-hover:visible group-focus-within:visible`; programmatic focus on menu open makes the active row show the cluster at rest. The `group-focus-within:visible` class SHALL be replaced with a `:focus-visible`-based reveal — `group-has-[:focus-visible]:visible` (Tailwind 4 `has` variant) — so a mouse-opened menu shows no cluster on the programmatically-focused row (programmatic focus after pointer interaction does not match `:focus-visible` in Chromium), keyboard navigation still reveals it, and tabbing into the cluster's own buttons keeps it visible (`has` covers descendants). The mirrored yield classes on the ⌥⌘n hint zone and the waiting-count span (`group-hover:invisible group-focus-within:invisible`, ~lines 668/682) MUST be updated in lockstep to `group-hover:invisible group-has-[:focus-visible]:invisible` so the hint yields the zone under exactly the conditions the cluster shows.

- **GIVEN** the menu was opened by mouse click
- **WHEN** the open-transition effect focuses the active row programmatically
- **THEN** the row shows its ⌥⌘n hint, not the pencil/minus/grip cluster

- **GIVEN** the menu is open and the user arrows between rows
- **WHEN** a row receives keyboard focus
- **THEN** the cluster reveals on that row and the hint/waiting zone yields

### Palette: `Host: Switcher` registration

#### R5: Layout-global palette action opening the same menu
A `Host: Switcher` palette action with id `host-menu-open` (so `withShortcutHints` renders the effective ⇧⌘M/⇧Ctrl+M hint automatically) SHALL be registered in `useGlobalPaletteActions` (`app/frontend/src/hooks/use-global-palette-actions.ts` — the strip mounts in `AppLayout` on every route, so the action is layout-global, not route-scoped), gated on `isShell()` AND a non-empty `useShellServers()` list (mirroring `stripSwitcherEnabled` — no dead action on older shells or in browsers). Its body SHALL dispatch a document `CustomEvent` (constant `HOST_MENU_OPEN_EVENT` in `app/frontend/src/lib/shell-strip.ts` — the `terminal-find:open`/`web-address:focus` seam precedent) that the mounted `ShellTitlebarStrip` listens for and answers with `setOpen(true)` (palette bodies keep explicit single-verb semantics; statefulness lives in the chord handler).

- **GIVEN** the desktop shell with hosts registered
- **WHEN** `Host: Switcher` is selected in the palette
- **THEN** the strip's hosts menu opens with focus on the active row, and the palette row showed the ⇧⌘M hint

- **GIVEN** a plain browser
- **WHEN** the palette opens
- **THEN** no `Host: Switcher` entry is listed

### Non-Goals

- No shell/Electron changes — no menu accelerator, no IPC; ⌥⌘1–9/Alt+1–9 and the native Hosts menu untouched.
- No welcome-page handling (no strip there; covered by 260820-sywl-welcome-host-hub).
- No e2e coverage — `isShell()` is false in Playwright, so the surface stays vitest-covered (the strip's established test posture).

### Design Decisions

#### Chord handler is component-local, not a dispatcher entry
**Decision**: The `host-menu-open` chord listener lives inside `ShellTitlebarStrip` (the `useSidebarKeyboardToggle` pattern), not in `app.tsx`'s dispatcher handler map.
**Why**: Its enablement is local state (`interactive`, `open`) and the strip is the only surface that can act — the same reason ⌘B/⌘K/⌘. keep component-local listeners. Handler presence IS the gate: in browsers the strip never mounts, so the chord falls through everywhere else with zero added wiring.
**Rejected**: An `app.tsx` handler reaching into the strip via an event for the chord too — it would put shell-only wiring on every route's dispatcher map and split toggle state across a seam for no consumer benefit (the palette body still uses the event seam, where a cross-tree reach is actually needed).
*Introduced by*: 260820-nv0o-host-menu-shortcut-digit-select

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the `host-menu-open` binding to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (shifted `KeyM`, global, no mac refinements, mapLabel `"hosts"`) and extend `app/frontend/src/lib/keybindings.test.ts`: default combo resolves ⇧⌘M on mac hosts / ⇧Ctrl+M on other, enabled in both shell and browser hosts (no browser claim on shifted KeyM); confirm the conflict-free defaults invariant still passes <!-- R1 -->
- [x] T002 In `app/frontend/src/components/shell-titlebar-strip.tsx`: add the component-local `host-menu-open` chord listener (toggle open/close, fall-through when not interactive), the `HOST_MENU_OPEN_EVENT` document listener (open on demand), and plain-digit `Digit1`–`Digit9` selection in the open-menu `handleKey` (no-modifier guard, `hostCountRef` bound, `selectHost` path, no-op beyond count); export `HOST_MENU_OPEN_EVENT` from `app/frontend/src/lib/shell-strip.ts`; extend `shell-titlebar-strip.test.tsx` with chord open/toggle-close, non-interactive fall-through, event-open, digit-select/beyond-count/dialog-suppression cases <!-- R2, R3, R5 -->
- [x] T003 In `shell-titlebar-strip.tsx`, replace the cluster's `group-focus-within:visible` with `group-has-[:focus-visible]:visible` (~line 695) and the hint-zone + waiting-span mirrors `group-focus-within:invisible` with `group-has-[:focus-visible]:invisible` (~lines 668/682); adjust any strip tests asserting the old classes <!-- R4 -->
- [x] T004 Register `Host: Switcher` (id `host-menu-open`) in `app/frontend/src/hooks/use-global-palette-actions.ts`, gated on `isShell()` + non-empty `useShellServers()`, body dispatching `HOST_MENU_OPEN_EVENT`; extend `use-global-palette-actions.test.tsx` (present in shell with hosts, absent in browser/empty list) <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` contains `host-menu-open` (shifted KeyM, global, no mac refinements) and unit tests cover its per-host resolution
- [x] A-002 R2: The strip owns a component-local chord listener that opens a closed menu, closes an open one (trigger refocused), and falls through untouched when the switcher is not interactive
- [x] A-003 R3: Plain digits 1–9 while the menu is open select the Nth rendered host via `selectHost`; beyond-count digits release the key; digits inside the Edit/remove dialogs are untouched
- [x] A-004 R4: The action cluster reveals on `group-hover` + `group-has-[:focus-visible]`; no `group-focus-within` visibility class remains on cluster, hint zone, or waiting span
- [x] A-005 R5: `Host: Switcher` (id `host-menu-open`) is registered layout-global, shell-and-nonempty-gated, opens the menu through `HOST_MENU_OPEN_EVENT`, and renders the chord hint

### Behavioral Correctness

- [x] A-006 R2: ⇧⌘M fires under terminal focus with no terminal-seam change (shifted-tier refusal rule 1 covers it) — verified by the existing seam tests still passing with the new binding in the map
- [x] A-007 R4: A mouse-opened menu's programmatically-focused active row shows the ⌥⌘n hint, not the cluster (unit-asserted via the class contract; Chromium `:focus-visible` semantics carry the runtime behavior)

### Scenario Coverage

- [x] A-008 R3: Tests cover digit-select order = rendered-list order (the accelerator order) and the `hostCountRef` live-count guard
- [x] A-009 R2: Tests cover the toggle family convention (second ⇧⌘M closes) and `shouldSuppressChord` gating (chord suppressed while a real text input outside the strip owns focus)

### Edge Cases & Error Handling

- [x] A-010 R3: Modified digits (⌘/Ctrl/Alt/Shift-carrying) are NOT treated as select — the ⌥⌘n accelerators and future tiers stay untouched
- [x] A-011 R5: In a plain browser no palette entry appears and the chord resolves to no handler (strip unmounted) — no dead affordance

### Code Quality

- [x] A-012 Pattern consistency: chord listener mirrors `useSidebarKeyboardToggle` (refs, once-per-mount registration); event seam mirrors `terminal-find:open` (constant exported from a lib module); palette gate mirrors the `stripSwitcherEnabled` shape
- [x] A-013 No unnecessary duplication: reuses `selectHost`, `hostCountRef`, `matchesCombo`, `shouldSuppressChord`, `withShortcutHints` — no new key-matching or switch logic
- [x] A-014 Tests included: every touched behavior lands with vitest coverage in the same commit (Playwright exempt — `isShell()` false in e2e)
- [x] A-015 No comment narration: new comments state constraints (claim rationale, fall-through contract), not change provenance

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (a binding, a chord handler, a digit-select branch, a palette action) and swaps the cluster-reveal class strategy in place; no existing symbol, file, or branch becomes redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chord handler is component-local in the strip (not an `app.tsx` dispatcher entry) | The intake's "existing handler-presence gating pattern" + the ⌘B/⌘K/⌘. component-local precedent for local-state enablement; strip mount IS the gate | S:85 R:90 A:90 D:85 |
| 2 | Confident | Palette body reaches the strip via a `HOST_MENU_OPEN_EVENT` document CustomEvent in `lib/shell-strip.ts` | The `terminal-find:open`/`web-address:focus` seam precedent for palette→mounted-component opens; easily swapped for a module-slot registry if review prefers | S:70 R:85 A:85 D:70 |
| 3 | Confident | Palette action registered layout-global in `useGlobalPaletteActions`, gated on `isShell()` + non-empty `useShellServers()` | The strip mounts in `AppLayout` on every route; the existing `Server: Switch to` block is route-scoped only by historical placement, and the gate mirrors `stripSwitcherEnabled` | S:65 R:85 A:80 D:75 |
| 4 | Confident | Digit match on `e.code` `Digit1`–`Digit9` with a strict no-modifier guard | The registry's `e.code` rule; excludes numpad digits (no established convention for them in this codebase) and keeps ⌥⌘n untouched | S:70 R:90 A:85 D:75 |
| 5 | Confident | Open→close chord arm refocuses the trigger (the Escape path's treatment) | Toggle-family convention; Escape already models "close by keyboard returns focus to trigger" in this menu | S:65 R:95 A:90 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
