# Plan: Keyboard Shortcuts Consolidation

**Change**: 260801-sm6g-keyboard-shortcuts-consolidation
**Intake**: `intake.md`

## Requirements

### Keybindings: Compose-strip toggle chord

#### R1: `compose-toggle` builtin binding (⇧⌘E / Shift+Ctrl+E)
`DEFAULT_BINDINGS` (`app/frontend/src/lib/keybindings.ts`) SHALL gain a builtin binding `actionId: "compose-toggle"`, `code: "KeyE"`, `tier: "shifted"`, `scope: "global"`, `ignoreInputs: true`, `mapLabel: "compose"`, no `macTier` (E is free on both platforms; no demotion applies). The handler SHALL be the existing `toggleComposeStrip()` from chrome-context, wired into BOTH dispatcher mounts (`app.tsx` `keybindingHandlers` and `board-page.tsx` `boardKeyHandlers`). The palette `View: Text Input` entry keeps its id, so no automatic hint join exists for it — the binding's actionId is `compose-toggle` and it needs no palette-entry rename (the chord is discoverable via the overlay; the palette entry remains the Constitution V path).

- **GIVEN** any AppShell or board route
- **WHEN** the user presses ⇧⌘E (mac) / Shift+Ctrl+E (win/linux)
- **THEN** the compose strip toggles (same effect as the `>_` chip and `View: Text Input`)
- **AND** because the binding sets `ignoreInputs: true`, the chord also fires while the strip's textarea owns focus (closing the strip)

#### R2: Compose strip focuses its textarea on open (open transition only)
The compose strip SHALL focus its textarea on the enable (off→on) transition, from EVERY open path (chip, palette, ⇧⌘E chord, drag-drop auto-enable, board twin). This deliberately reverses the 260718-dhdj "never steals focus" contract for the open transition ONLY: after-send behavior stays no-focus, Escape still blurs to the terminal, and route remounts with the strip already enabled MUST NOT steal focus. Seam: a module-level `focusOnOpen` flag in `app/frontend/src/lib/compose-strip-events.ts` (beside the existing focus registry), set by `toggleComposeStrip` in `chrome-context.tsx` when transitioning off→on, consumed-and-cleared by ComposeStrip's mount effect, which focuses via the same disabled-state-respecting logic as the registered focuser (no focus in the "no target" state — flag still cleared). ComposeStrip's docstring focus contract SHALL be updated.

- **GIVEN** the strip is off on a terminal route with a focused terminal
- **WHEN** the user opens it via any affordance
- **THEN** the strip mounts and its textarea receives focus
- **GIVEN** the strip is already enabled
- **WHEN** the user navigates terminal↔board (remount without a toggle)
- **THEN** the textarea does NOT grab focus
- **GIVEN** the strip is off and the current route has no focused terminal (disabled "no target" state)
- **WHEN** the user opens the strip
- **THEN** no focus is taken and the stale flag is cleared (a later remount cannot consume it)

### Sidebar: shortcuts affordance

#### R3: Keyboard icon in the sidebar footer opens the ShortcutsOverlay
`sidebar/icons.tsx` SHALL gain a `KeyboardIcon` (rounded rect + key dots, same stroke idiom as `GearIcon`: currentColor stroke, strokeWidth 2, 24-unit viewBox, 13px default). `SidebarFooter` SHALL render it between Help and Theme (order: Help · Keyboard · Theme · Gear) in the borderless `FOOTER_ICON_CLASS` idiom, `Tip label="Keyboard shortcuts"` with the HOST-effective overlay chord in the Tip `kbd` slot (from `useKeybindings().byAction.get("shortcuts-overlay")`, hidden when unbound/disabled), `aria-label="Keyboard shortcuts"`. Clicking dispatches a document CustomEvent `shortcuts-overlay:open` (the `palette:open` precedent); BOTH overlay mounts (`app.tsx`, `board-page.tsx`) listen and toggle their `showShortcutsOverlay` state. The affordance hiding with the sidebar/drawer is an accepted trade (palette entry remains the always-available route).

- **GIVEN** any route with a sidebar
- **WHEN** the user clicks the keyboard icon in the footer
- **THEN** the ShortcutsOverlay toggles on that route's mount
- **AND** the Tip shows "Keyboard shortcuts" with the effective chord keycap (e.g. ⌘/ or Shift+Ctrl+/)

### ShortcutsOverlay: merged shortcuts surface

#### R4: Fold tmux keybindings into ShortcutsOverlay; delete the legacy dialog
The legacy `KeyboardShortcuts` dialog (`components/keyboard-shortcuts.tsx`, "tmux Keybindings") SHALL be deleted: component file, `app.tsx` import + `showKeyboardShortcuts` state + mount, and the `Help: tmux Keybindings` palette entry (id `keyboard-shortcuts`) — removed, not repointed (the overlay already has `Help: Keyboard Shortcuts`). The stale comment reference in `bottom-bar.tsx` is updated. Per the approved `design-mock.html`, `shortcuts-overlay.tsx` SHALL gain:

1. **TMUX section** (last section): read-only locked rows (🔒 + non-interactive combos, the shell-owned-row idiom). Data from the existing `getKeybindings(server)` client API, fetched while the overlay is open for the current server (`useSessionContext().currentServer` — null on board/host routes). Root-table rows under a "Direct" subhead; prefix-table rows under a "Prefix — Ctrl+S, then key" subhead rendered as a sequence (`Ctrl` `S` *then* `\`). Section header note names the source server; no current server (or an empty/failed fetch) → one-line empty state "No tmux server running".
2. **Sticky jump-nav chip row** under the header (key map · global · terminal · board · custom · tmux): plain scroll anchors normally; while the filter is active each chip shows a live per-section match count and dims when its section has zero hits. NO TABS — one scroll, one filter spanning app + custom + tmux rows.
3. **Foldable tier map**: a "▾ collapse map" / "▸ expand map" toggle; the map body hides when folded and auto-hides entirely while a filter is active.
4. **SHELL demotion**: the shell-owned locked rows move from the top-level "SHELL — DESKTOP APP" section into a subgroup at the end of GLOBAL under a "Shell-owned — accelerators live in the desktop shell menu" subhead.

Existing overlay conventions (Tailwind vocabulary, bracket headings, `data-testid`, focus trap, capture, CUSTOM section) are preserved; the mock's raw CSS is a layout/interaction reference only.

- **GIVEN** the overlay is open on a terminal route with a live tmux server
- **WHEN** the tmux fetch resolves
- **THEN** the TMUX section lists the curated bindings as locked rows grouped Direct / Prefix, prefix rows rendered as `Ctrl` `S` then `<key>`
- **GIVEN** a filter query is active
- **WHEN** it matches rows across app and tmux sections
- **THEN** every jump chip shows its live match count, zero-hit chips dim, matching rows in all sections remain visible, and the tier map is hidden
- **GIVEN** the board route (no current server)
- **WHEN** the overlay opens
- **THEN** the TMUX section shows "No tmux server running"
- **GIVEN** the palette
- **WHEN** filtering for "tmux Keybindings"
- **THEN** no such entry exists; `Help: Keyboard Shortcuts` is the single shortcuts entry

### Open-in-App: last-used chord

#### R5: `open-last-used` action + chord (⇧⌘O / Shift+Ctrl+O)
`DEFAULT_BINDINGS` SHALL gain `actionId: "open-last-used"`, `code: "KeyO"`, `tier: "shifted"`, `scope: "terminal"`, `label: "Open in last-used app"`, `mapLabel: "open"`. Handler in `app.tsx` (terminal route only — handler registered only when `windowParam` is set): resolve `resolveLastUsedTarget(targets, readLastUsedOpenTarget())` over the same `buildOpenTargets` set the palette uses; a resolved target runs through the shared `useRunOpenTarget().runTarget`; nothing stored / stale → toast "No last-used app yet — pick one from Open ▾ or the palette". A palette action `Open: Last used (<label>)` (id `open-last-used`, so the chord hint decorates automatically) SHALL be added via a pure builder in `lib/palette-open.ts`, shown only when a last-used target resolves (the dynamic suffix names what it would launch). The `palette-open.ts` "no keyboard chord" module comment SHALL be updated to document the new chord + dynamic action per the code-review registration rule.

- **GIVEN** a terminal route where the user previously opened a target
- **WHEN** the user presses ⇧⌘O
- **THEN** the last-used target launches (deeplink navigation or POST /api/open), same as the Open split-button's primary segment
- **GIVEN** no stored (or stale) last-used target
- **WHEN** the chord fires
- **THEN** an info toast reads "No last-used app yet — pick one from Open ▾ or the palette" and nothing launches

### Desktop shell: editor deeplinks

#### R6: Editor deeplink schemes reach `shell.openExternal` (bug fix, `app/desktop`)
`app/desktop/src/window-open.ts` SHALL own a FIXED editor-deeplink scheme allowlist — `vscode:`, `cursor:`, `windsurf:` — exactly mirroring `DEEPLINK_APPS` in `app/frontend/src/lib/open-in-app.ts`, plus a decision fn (e.g. `isEditorDeeplink(url)`), and `windowOpenAction` SHALL return `"open-external"` for allowlisted deeplinks. `main.ts` `guardNavigation` SHALL forward blocked navigations to `shell.openExternal` when `isHttpUrl(url) || isEditorDeeplink(url)` (previously http(s) only — `vscode://` was silently dropped). The list MUST remain an allowlist, never a scheme pass-through (arbitrary-scheme `openExternal` is a documented injection vector). The cross-file coupling MUST be documented at BOTH sites (a comment beside `DEEPLINK_APPS` and beside the allowlist). `window-open.test.ts` (`node --test`) SHALL cover the new branch.

- **GIVEN** the Electron shell showing a remote rk host
- **WHEN** the SPA assigns `window.location.href = "vscode://vscode-remote/ssh-remote+host/path"`
- **THEN** `guardNavigation` prevents in-window navigation AND hands the URL to `shell.openExternal` (the editor opens)
- **GIVEN** a non-allowlisted scheme (`file:`, `smb:`, `vscode-insiders:`)
- **WHEN** it hits `windowOpenAction` or `guardNavigation`
- **THEN** it is dropped, never reaching `openExternal`

### Non-Goals

- No new routes or tabs (Constitution IV) — the overlay stays a dialog.
- No export/import of overrides; no backend changes (`api/keybindings.go` is a read-only dependency).
- No JetBrains/other deeplink grammars (allowlist mirrors today's `DEEPLINK_APPS` exactly).
- No focus change to after-send / Escape / remount compose-strip behavior (R2 is open-transition-only).

### Design Decisions

#### Overlay reads the current server itself
**Decision**: The TMUX section resolves its server via `useSessionContext().currentServer` inside `shortcuts-overlay.tsx`, not a new prop threaded from both mounts.
**Why**: `SessionProvider` is mounted at `RootWrapper`, above both overlay mounts; the legacy dialog already used this exact seam, and a prop would just duplicate it twice.
**Rejected**: A `server` prop from each mount — two wiring sites for a value the context already carries everywhere.
*Introduced by*: 260801-sm6g-keyboard-shortcuts-consolidation

#### `shortcuts-overlay:open` event toggles
**Decision**: The sidebar footer icon dispatches `shortcuts-overlay:open`; each mount's listener TOGGLES `showShortcutsOverlay` (matching the chord and palette-entry semantics).
**Why**: A second click on the icon should close the overlay like every other affordance for it; one behavior for all three paths.
**Rejected**: Open-only semantics (leaves the icon a one-way switch, diverging from chord/palette).
*Introduced by*: 260801-sm6g-keyboard-shortcuts-consolidation

## Tasks

### Phase 1: Registry + lib groundwork

- [x] T001 Add the `compose-toggle` builtin binding to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (KeyE, shifted, global, `ignoreInputs: true`, mapLabel "compose", label "Compose text", description "toggle the compose strip"); extend `app/frontend/src/lib/keybindings.test.ts` (binding present with exact shape; defaults stay conflict-free in every host) <!-- R1 -->
- [x] T002 Add the `open-last-used` builtin binding to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (KeyO, shifted, terminal scope, label "Open in last-used app", mapLabel "open"); extend `keybindings.test.ts` accordingly <!-- R5 -->
- [x] T003 Focus-on-open seam (R2): add the module-level `focusOnOpen` flag (mark/consume fns) to `app/frontend/src/lib/compose-strip-events.ts`; set it in `chrome-context.tsx` `toggleComposeStrip` on the off→on transition; consume-and-clear in `ComposeStrip`'s mount effect in `app/frontend/src/components/compose-strip.tsx`, focusing the textarea only when enabled; update the ComposeStrip docstring focus contract; unit tests in `compose-strip.test.tsx` (focus on open; no focus on plain remount; no focus + flag cleared in the no-target state) <!-- R2 -->

### Phase 2: Route-shell wiring (app.tsx + board twin)

- [x] T004 Add `buildOpenLastUsedAction(lastUsed, onRun)` pure builder to `app/frontend/src/lib/palette-open.ts` (entry only when a target resolves; label `Open: Last used (<label>)`, id `open-last-used`) + tests in `palette-open.test.ts`; update the module's "no keyboard chord" doc comment to document the new chord + dynamic action <!-- R5 -->
- [x] T005 Wire `app.tsx`: `keybindingHandlers` gains `"compose-toggle": toggleComposeStrip` and `"open-last-used"` (registered only when `windowParam` is set; resolves last-used over the shared `buildOpenTargets` set, runs via `runOpenTarget`, else info toast "No last-used app yet — pick one from Open ▾ or the palette"); fold the `buildOpenLastUsedAction` entry into `openActions` <!-- R1, R5 -->
- [x] T006 Wire `board-page.tsx`: `boardKeyHandlers` gains `"compose-toggle": toggleComposeStrip` (board twin rule; `open-last-used` is terminal-scoped — no board handler, chord falls through) <!-- R1 -->

### Phase 3: Sidebar footer affordance

- [x] T007 Add `KeyboardIcon` (rounded rect + key dots, GearIcon stroke idiom) to `app/frontend/src/components/sidebar/icons.tsx` <!-- R3 -->
- [x] T008 Add the Keyboard button to `SidebarFooter` in `app/frontend/src/components/sidebar/index.tsx` between Help and Theme (FOOTER_ICON_CLASS, Tip "Keyboard shortcuts" + effective-chord `kbd` slot via `useKeybindings`, aria-label, dispatches `shortcuts-overlay:open`); update + extend `sidebar/index.test.tsx` (footer order Help · Keyboard · Theme · Gear; event dispatch; chord kbd present) <!-- R3 -->
- [x] T009 Listen for `shortcuts-overlay:open` in BOTH mounts — `app.tsx` and `board-page.tsx` — toggling `showShortcutsOverlay` (document listener effect) <!-- R3 -->

### Phase 4: Merged ShortcutsOverlay + legacy dialog deletion

- [x] T010 Rework `app/frontend/src/components/shortcuts-overlay.tsx` structure per the mock: sticky jump-nav chip row under the header (key map · global · terminal · board · custom · tmux; scroll anchors; live per-section match counts + dimming while filtering), foldable tier map (collapse/expand toggle; auto-hidden while a filter is active), SHELL locked rows demoted into a subgroup at the end of GLOBAL (top-level SHELL section removed) <!-- R4 -->
- [x] T011 Add the TMUX section to `shortcuts-overlay.tsx`: fetch `getKeybindings(currentServer)` (`useSessionContext`) while open, Direct/Prefix subheads (prefix rows as `Ctrl` `S` then `<key>` sequences), locked-row idiom, header note naming the server, "No tmux server running" empty state; filter + jump counts span the tmux rows <!-- R4 -->
- [x] T012 Delete `app/frontend/src/components/keyboard-shortcuts.tsx`; remove its import, `showKeyboardShortcuts` state, mount, and the `Help: tmux Keybindings` palette entry from `app.tsx`; update the stale comment reference in `bottom-bar.tsx` <!-- R4 -->
- [x] T013 Update `shortcuts-overlay.test.tsx`: adapt existing assertions to the new structure (SHELL subgroup inside GLOBAL) and add coverage for the fold toggle, filter-hides-map, jump-chip counts, tmux section rows (mocked `getKeybindings`), and the empty state; delete any tests of the removed dialog (`keyboard-shortcuts` has no test file — verify) <!-- R4 -->
- [x] T014 E2E: update `tests/e2e/shortcut-registry.spec.ts` + `shortcut-registry.spec.md` — mock `GET /api/keybindings*`, assert the overlay's jump nav + TMUX locked rows and that the `Help: tmux Keybindings` palette entry is gone; sweep `tests/e2e` for any other assertions on the legacy dialog chrome <!-- R4 -->

### Phase 5: Desktop shell deeplink fix

- [x] T015 [P] Add the fixed editor-deeplink allowlist + `isEditorDeeplink` to `app/desktop/src/window-open.ts`; route allowlisted schemes to `"open-external"` in `windowOpenAction`; forward them in `main.ts` `guardNavigation` (`isHttpUrl(url) || isEditorDeeplink(url)`); coupling comments beside the allowlist AND beside `DEEPLINK_APPS` in `app/frontend/src/lib/open-in-app.ts` <!-- R6 -->
- [x] T016 [P] Extend `app/desktop/src/window-open.test.ts`: vscode/cursor/windsurf deeplinks open externally (both seams' decision fn), non-allowlisted schemes (`vscode-insiders:`, `file:`, `smb:`) stay denied; run `pnpm run compile && pnpm run test` in `app/desktop` <!-- R6 -->

### Phase 6: Verification

- [x] T017 Run the gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; frontend Vitest; desktop compile + `node --test`; targeted e2e (`just pw test shortcut-registry`, `just pw test sidebar-footer`, `just pw test compose-strip`) <!-- R1 R2 R3 R4 R5 R6 -->

## Execution Order

- T001–T002 before T005 (handlers need the bindings); T004 before T005.
- T007 before T008; T008/T009 independent of Phase 4 but T009 shares files with T005/T012 (`app.tsx`) — run sequentially.
- T010–T012 before T013–T014. T015–T016 ([P]) are independent of all frontend tasks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `compose-toggle` (KeyE/shifted/global/ignoreInputs) exists in `DEFAULT_BINDINGS` and its chord toggles the compose strip on both AppShell and board mounts
- [x] A-002 R2: Every open path (chip, palette, chord, drag-drop enable, board twin) focuses the strip textarea on the off→on transition
- [x] A-003 R3: The sidebar footer renders Help · Keyboard · Theme · Gear; the Keyboard button toggles the ShortcutsOverlay on both mounts via the `shortcuts-overlay:open` event
- [x] A-004 R4: The overlay carries the jump-nav chip row, foldable tier map, GLOBAL-embedded shell-owned subgroup, and TMUX locked section fed by `getKeybindings`
- [x] A-005 R5: `open-last-used` (KeyO/shifted/terminal) launches the resolved last-used open target via the shared `runTarget`; the dynamic `Open: Last used (<label>)` palette entry exists when a target resolves
- [x] A-006 R6: `vscode:`/`cursor:`/`windsurf:` deeplinks reach `shell.openExternal` through BOTH `guardNavigation` and `windowOpenAction`

### Behavioral Correctness

- [x] A-007 R2: After-send never focuses; Escape still blurs to terminal; a terminal↔board remount with the strip already enabled does not steal focus
- [x] A-008 R4: One filter spans app + custom + tmux rows; active filter shows live chip counts, dims empty chips, and hides the tier map
- [x] A-009 R5: With no (or a stale) stored preference the chord shows the exact toast "No last-used app yet — pick one from Open ▾ or the palette" and launches nothing

### Removal Verification

- [x] A-010 R4: `components/keyboard-shortcuts.tsx` is deleted; no import, state, mount, or `Help: tmux Keybindings` palette entry remains; no e2e spec references the legacy dialog chrome

### Scenario Coverage

- [ ] A-011 R1: Unit test proves the chord fires while the strip textarea owns focus (`ignoreInputs`) — **partial**: covered compositionally only. `keybindings.test.ts:75` asserts `compose-toggle` carries `ignoreInputs: true`, and `use-keybinding-dispatch.test.ts:69` proves an `ignoreInputs` binding fires inside a text input — but using `shortcuts-overlay`, not `compose-toggle`. No test drives ⇧⌘E with the strip's own textarea focused. See review should-fix #1.
- [x] A-012 R4: Unit tests cover tmux rows (Direct + Prefix sequence rendering), the empty state, fold toggle, and jump counts; e2e covers the overlay end-to-end with a mocked `/api/keybindings`
- [x] A-013 R6: `node --test` covers allowlisted deeplinks → open-external and non-allowlisted schemes → deny

### Edge Cases & Error Handling

- [x] A-014 R2: Opening the strip in the no-target state takes no focus and clears the flag (no stale-focus on a later remount)
- [x] A-015 R4: No current server (board route) or a failed fetch renders "No tmux server running" — no crash, no spinner deadlock

### Code Quality

- [x] A-016 Pattern consistency: new code follows the registry/palette/pure-builder + colocated-test conventions and the overlay's existing Tailwind vocabulary
- [x] A-017 No unnecessary duplication: existing utilities reused (`toggleComposeStrip`, `getKeybindings`, `resolveLastUsedTarget`, `useRunOpenTarget`, `withShortcutHints`, locked-row idiom). `LockedRow`/`SubHead` were extracted and are now shared by the shell subgroup and both tmux subgroups — a net deduplication
- [x] A-018 New shortcuts documented in palette registrations (code-review rule): `palette-open.ts` comment updated; `compose-toggle`/`open-last-used` reachable via palette-equivalent actions

### Security

- [x] A-019 R6: The deeplink allowlist is fixed (never a scheme pass-through); nothing outside http(s) + the three editor schemes reaches `shell.openExternal`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `docs/memory/run-kit/ui-patterns.md:2143` — the whole "Keyboard Shortcuts Modal" subsection documents `components/keyboard-shortcuts.tsx`, which this change deleted. Stale memory describing a removed component (hydrate's job, flagged here so it is not missed).
- `docs/memory/run-kit/ui-patterns.md:2114` — the palette-actions inventory still lists `Help: tmux Keybindings` (id `keyboard-shortcuts`) as a live entry; that entry was removed with the dialog.
- `docs/memory/run-kit/architecture.md:664` — "The chord is registered in the `KeyboardShortcuts` modal under 'Toggle sidebar'" now names a deleted component; the sidebar chord is documented by the registry overlay instead.
- Backend `keybindingWhitelist` (`app/backend/api/keybindings.go:19`) — **not** a deletion candidate, but worth noting the curated set is now the *sole* tmux surface in the UI; nothing became redundant server-side.

No production code was made redundant beyond the deleted `keyboard-shortcuts.tsx` itself (its `formatKey`/`groupBindings`/`ShortcutRow` helpers were absorbed into `shortcuts-overlay.tsx` as `formatTmuxKey`/`groupTmuxRows`/`LockedRow`, with no stragglers left behind — verified by grep).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `compose-toggle` gets NO `macTier` demotion — ⇧⌘E on mac (shell and browser) | The demotion set is a deliberate closed list (⌘E is browser "use selection for find" territory on mac Safari/Chrome); staying shifted matches the intake's ⇧⌘E chord verbatim | S:80 R:90 A:80 D:75 |
| 2 | Confident | The `Open: Last used (<label>)` palette entry renders only when a last-used target resolves | The dynamic suffix requires a target to name; boundary-hidden matches the palette convention (Move up/down), and the chord's toast covers the no-preference case | S:70 R:90 A:80 D:70 |
| 3 | Confident | `shortcuts-overlay:open` listeners TOGGLE the overlay (not open-only) | Matches the chord + palette-entry semantics; one behavior across all three affordances | S:70 R:95 A:85 D:75 |
| 4 | Confident | TMUX section server comes from `useSessionContext().currentServer` read inside the overlay (no new prop) | SessionProvider mounts at RootWrapper above both overlay mounts; the legacy dialog used the same seam | S:75 R:90 A:85 D:80 |
| 5 | Certain | R6 allowlist matches on lowercase scheme prefixes (`vscode://` etc.) exactly as the SPA composes them | `DEEPLINK_APPS` templates are lowercase constants in our own frontend; the allowlist mirrors them 1:1 | S:85 R:90 A:90 D:85 |
| 6 | Confident | The legacy dialog's `Help: tmux Keybindings` palette entry is removed, not repointed | Intake assumption #9 (Confident) carried through — the overlay's own entry already exists | S:75 R:90 A:80 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
