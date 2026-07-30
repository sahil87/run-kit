# Plan: Keyboard Shortcut Registry, Uniform Shifted Tier & Cheatsheet Overlay

**Change**: 260730-g40a-keyboard-shortcut-registry-overlay
**Intake**: `intake.md`

## Requirements

### Frontend: Keybinding Registry (`lib/keybindings.ts`)

#### R1: Declarative registry module owns all bindings
A new pure module `app/frontend/src/lib/keybindings.ts` SHALL own every app keyboard binding as data. Each `KeyBinding` carries `actionId` (stable id, doubling as the palette action id where one exists), `code` (`KeyboardEvent.code` — layout-independent), `tier` (`"shifted" | "cmd" | "ctrl"`), `scope` (`"global" | "terminal" | "board" | "sidebar"`), `kind` (`"builtin"`; `"macro"` is a reserved schema slot for change hbyh — no executor here), and `label`. Matching MUST use `e.code`, never `e.key`. Chord matching MUST exclude Alt in every tier; `shifted` = Shift + (Meta or Ctrl); `cmd` = (Meta or Ctrl) without Shift; `ctrl` = plain Ctrl without Meta/Shift.

- **GIVEN** the default registry
- **WHEN** a `keydown` with `code: "KeyL"`, `shiftKey: true`, `ctrlKey: true` is matched
- **THEN** the `window-next` binding matches on every platform (Meta also accepted in place of Ctrl)
- **AND** the same event with `altKey: true` matches nothing

#### R2: Canonical shifted tier + starter binding set
The run-kit action tier SHALL be `Shift+CmdOrCtrl+<key>` uniformly on every platform. The default registry SHALL contain the nine shifted-tier starter actions: N → `create-session` (New session), T → `create-window` (New window), W → `kill-window` (Close window, confirm flow), H → `window-prev` (Previous window), L → `window-next` (Next window), `[` → `go-back` (Back), `]` → `go-forward` (Forward), A → `agent-next-waiting` (Next waiting agent), `/` → `shortcuts-overlay` (Toggle shortcuts overlay).

- **GIVEN** a terminal route in the desktop shell on any platform
- **WHEN** the user presses Shift+CmdOrCtrl+L
- **THEN** the next window in the current session is selected (sidebar order, wrapping)

#### R3: Claimed keys are registry data
The registry SHALL model claimed shifted-tier keys as data, treated as unavailable for binding and shown locked/claimed in the overlay: ⇧CmdOrCtrl+1–9 (shell server switcher), ⇧CmdOrCtrl+R (shell force reload / browser hard reload), ⇧Ctrl+I (DevTools, win/linux), ⇧⌘Q (macOS logout), ⇧Ctrl+C/V (win/linux terminal copy/paste convention, display-only), and — in browser hosts only (`!isShell()`) — N/T/W (browser-reserved). A default binding whose combo is browser-reserved in the current host SHALL resolve as disabled (`reason: "reserved"`); its action remains palette-reachable.

- **GIVEN** a plain browser host (no `window.runkitShell`)
- **WHEN** bindings resolve
- **THEN** `create-session`/`create-window`/`kill-window` are disabled with reason `reserved`, while H/L/A/[/]// stay enabled
- **AND** in the desktop shell all nine are enabled

#### R4: Per-device override layer in localStorage diffs
Overrides SHALL persist to `localStorage["runkit-keybindings"]` as diffs only: `{ [actionId]: { code, tier } | null }` (null = disabled). A resolver SHALL merge defaults + overrides into the effective map. Rebind conflicts resolve as steal-with-warning: the new owner takes the combo, the previous owner's override becomes `null` (unbound) and is flagged in the overlay until rebound or reset. Per-action reset and reset-all SHALL be supported. Malformed stored JSON SHALL be tolerated (treated as empty). Same-tab reactivity SHALL use an in-module pub/sub (the `use-local-storage-enum.ts` pattern); cross-tab rides the native `storage` event. No backend, no new config file.

- **GIVEN** an override `{ "window-next": { "code": "KeyU", "tier": "shifted" } }` in localStorage
- **WHEN** bindings resolve
- **THEN** `window-next` matches ⇧CmdOrCtrl+U, is flagged modified, and ⇧CmdOrCtrl+L matches nothing
- **AND** capturing ⇧CmdOrCtrl+L for another action while `window-prev` still owns ⇧CmdOrCtrl+H does not touch `window-prev`

#### R5: Conflict detection is a pure function
Conflict detection SHALL be a pure function over the effective map: two enabled bindings conflict when tier+code are equal and their scopes overlap (`global` overlaps everything; equal scopes overlap; `terminal`/`board` are disjoint). It is consumed by the capture UI (steal warning) and by unit tests asserting the shipped defaults are conflict-free.

- **GIVEN** the default registry
- **WHEN** conflicts are computed
- **THEN** the result is empty (board ⌘[/⌘] vs global ⇧⌘[/⌘] differ by tier; board-scope and terminal-scope chords never co-mount)

### Frontend: Dispatch Seams

#### R6: One window-level dispatcher per route shell
A `useKeybindingDispatch(handlers)` hook SHALL register ONE window-level `keydown` listener that consults the effective registry, a handler map keyed by `actionId`, and a single shared suppression predicate (`shouldSuppressChord`): real text inputs suppress, with `.xterm` and `.rk-chat-input` carve-outs preserved; a per-binding `ignoreInputs` flag opts a binding out of suppression (⌘K keeps firing in inputs, byte-identical to today). A matched binding without a handler falls through untouched (no `preventDefault`). AppShell (`app.tsx`) mounts the dispatcher with handlers for `create-session`, `create-window`, `kill-window` (reusing the exact palette action bodies), `window-prev`/`window-next` (current-session sidebar-order cycle via `navigateToWindow`), `go-back`/`go-forward` (`router.history`), `agent-next-waiting` (the existing palette body), and `shortcuts-overlay`. BoardPage mounts it with `go-back`/`go-forward`, `board-cycle-next`/`board-cycle-prev`, and `shortcuts-overlay`.

- **GIVEN** the terminal route with two windows in the current session
- **WHEN** ⇧CmdOrCtrl+H fires while xterm owns focus
- **THEN** the previous window is selected and the chord never reaches the pane
- **AND** ⇧CmdOrCtrl+T while the window-rename input has focus is suppressed

#### R7: Legacy chords migrate into the registry, combos unchanged
The five existing scattered chords SHALL migrate their definitions into the registry with byte-identical default combos, their listeners consulting the effective map instead of hard-coded key checks: ⌘K (`command-palette`, cmd tier, `ignoreInputs`) in `command-palette.tsx`; ⌘\ (`sidebar-toggle`, cmd tier) in `shell.tsx`; ⌘. (`view-cycle`, cmd tier, terminal scope) in `app.tsx`; Ctrl+` (`chat-toggle`, ctrl tier, terminal scope) in `use-chat-view-shortcut.ts` (its chat-enablement gate and carve-outs preserved); board ⌘[/⌘] (`board-cycle-prev`/`board-cycle-next`, cmd tier, board scope) in `board-page.tsx` via the dispatcher. Rebinding any of these through the override layer SHALL take effect.

- **GIVEN** an unmodified install
- **WHEN** each legacy chord is pressed in its context
- **THEN** behavior is identical to before the change
- **AND** with an override `{ "command-palette": { "code": "KeyP", "tier": "cmd" } }`, ⌘P toggles the palette and ⌘K does not

#### R8: Terminal custom key handler consults the registry
`terminal-client.tsx`'s `attachCustomKeyEventHandler` SHALL consult the effective registry (via a render-updated ref) and return `false` for keydown events matching any enabled app-owned binding, so those chords bubble to the window dispatcher instead of reaching the pane; the existing ⌘C copy-selection special case is preserved ahead of it, and everything else — including all plain-Ctrl chords — continues to flow to the pane untouched.

- **GIVEN** a focused terminal
- **WHEN** ⇧Ctrl+N is pressed in the desktop shell on Linux
- **THEN** xterm does not transmit bytes for it and the create-session handler runs
- **AND** plain Ctrl+W / Ctrl+L / Ctrl+T still reach the pane

### Frontend: Shortcuts Overlay & Palette Hints

#### R9: Shortcuts overlay dialog
A new `components/shortcuts-overlay.tsx` SHALL render the cheatsheet as a focus-trapped dialog (NOT a route), opened by ⇧CmdOrCtrl+/ (toggle) and a palette action (`shortcuts-overlay`, label "Help: Shortcuts"), mounted on both AppShell and BoardPage. Contents per the reviewed mock: tier-map keyboard visualization (bound / custom / claimed / free per key, per platform), platform display toggle (macOS ↔ Win·Linux, initialized from the detected platform), filter input, grouped rows (Global / Terminal / Board / Shell) with scope badges, click-to-rebind capture with Esc-cancel and steal warning, modified-dot + per-row reset, unbound-flag rows, shell-owned rows shown locked (🔒, edit lives in the shell menu), footer with the localStorage note + reset-all. Styling SHALL use the existing vocabulary: `SectionHeading` bracket headings, `rk-glint` buttons, accent-green states, theme tokens. Export/import is deferred; no macro rows render in this change.

- **GIVEN** any AppShell or board route
- **WHEN** the user presses ⇧CmdOrCtrl+/
- **THEN** the overlay opens (again toggles closed; Esc closes), shows the effective map, and clicking a combo then pressing a valid chord rebinds and persists the diff

#### R10: Palette hints reflect the effective map
Every registered action that has a palette entry SHALL render its effective combo as the palette `shortcut` hint, formatted per platform (⇧⌘N on macOS, Shift+Ctrl+N elsewhere), reflecting overrides. Disabled bindings (user-disabled or browser-reserved) render no hint. A pure `withShortcutHints(actions, byAction, platform)` helper SHALL decorate palette action arrays in `app.tsx` and `board-page.tsx`; `buildViewActions` (`lib/palette-view.ts`) SHALL accept the effective cycle/chat hint strings instead of hardcoding them.

- **GIVEN** the default map on Linux in the shell
- **WHEN** the palette lists "Window: Create"
- **THEN** the hint reads `Shift+Ctrl+T`; after rebinding view-cycle to ⌘, the `View: Web` hint follows

### Non-Goals

- No macro executor, no macro rows, no add-macro affordance — change `260730-hbyh` (only the `kind` schema slot lands here).
- No export/import of overrides (trivial later; buttons omitted).
- No Electron menu accelerators or `app/desktop/` changes — SPA-renderer dispatch only; tier-ownership doc split lands at hydrate.
- No backend changes; no changes to the tmux keybindings modal (`keyboard-shortcuts.tsx`) or its palette entry.
- No `sidebar`-scope bindings in v1 (the scope value exists in the schema only).

### Design Decisions

#### Handlers derive from palette action bodies
**Decision**: The AppShell dispatcher reuses the palette actions' `onSelect` bodies (looked up by id) for `create-session`, `create-window`, `kill-window`, `agent-next-waiting`, `go-back`, `go-forward`.
**Why**: `actionId` doubles as the palette id by design; reusing the bodies guarantees chord/palette parity (gating included — e.g. `kill-window` exists only when a session is active) with zero duplicated logic.
**Rejected**: A parallel handler implementation per chord — drifts from the palette behavior it must mirror.
*Introduced by*: 260730-g40a-keyboard-shortcut-registry-overlay

#### Legacy listeners stay at their seams, consulting the registry
**Decision**: ⌘K/⌘\/Ctrl+`/⌘. keep their existing listener seams (component/hook-local enablement state) but match via the shared registry matcher + suppression predicate; only the board pane-cycle folds into the dispatcher.
**Why**: Their enablement logic is local state (palette open state, chat capability, lens availability); centralizing definition + suppression is the registry's charter, centralizing enablement is not — and this keeps the migration byte-identical.
**Rejected**: Routing everything through one dispatcher — would need context plumbing for palette open-state and chat gating, high regression risk for zero user-visible gain.
*Introduced by*: 260730-g40a-keyboard-shortcut-registry-overlay

## Tasks

### Phase 1: Core registry module

- [x] T001 Create `app/frontend/src/lib/keybindings.ts`: types (`KeyBinding`, `BindingTier`, `BindingScope`, `EffectiveBinding`, `BindingOverrides`), `DEFAULT_BINDINGS` (9 shifted starters + 5 legacy migrations with `board-cycle-prev`/`board-cycle-next`), claimed-key data + `claimedKeys(platform, shell)`, `detectPlatform()`, chord matcher (`matchesBinding`, `findMatch` on `e.code` + tier modifiers, Alt excluded), override storage (`readStoredOverrides`/`writeStoredOverrides`/tolerant `parseOverrides`, key `runkit-keybindings`), `resolveBindings(defaults, overrides, host)` incl. browser-reserved disable, pure `findConflicts`, capture helpers (`captureFromEvent` chord→`{code,tier}`, `applyCapture` steal-with-warning), `formatCombo`/`comboParts` per platform, shared `shouldSuppressChord` predicate (real-input suppress; `.xterm` + `.rk-chat-input` carve-outs), `withShortcutHints` <!-- R1 R2 R3 R4 R5 -->
- [x] T002 Create `app/frontend/src/lib/keybindings.test.ts` (Vitest): default-set integrity (unique actionIds, conflict-free defaults), tier matching incl. Alt/Shift exclusions, resolver (override, disable, browser-reserved N/T/W vs shell host), steal semantics, capture tier derivation + invalid chords, format mac/other, tolerant parsing, `withShortcutHints`, suppression predicate carve-outs <!-- R1 R2 R3 R4 R5 -->

### Phase 2: Hooks + dispatch seams

- [x] T003 Create `app/frontend/src/hooks/use-keybindings.ts`: reactive effective bindings (in-module pub/sub per `use-local-storage-enum.ts` + `storage` event), `byAction` map, `setBinding` (returns `stolenFrom`), `resetBinding`, `resetAll`, memoized host detection; colocated `use-keybindings.test.ts` <!-- R4 -->
- [x] T004 Create `app/frontend/src/hooks/use-keybinding-dispatch.ts`: single window `keydown` (bubble) listener over `useKeybindings()` + a handlers-ref; skips `defaultPrevented`, applies `shouldSuppressChord` unless `ignoreInputs`, `preventDefault()` + run handler on match, falls through when no handler; colocated test <!-- R6 -->
- [x] T005 Migrate `app/frontend/src/components/command-palette.tsx` ⌘K listener to consult the `command-palette` effective binding (ref-held, `ignoreInputs`); update `command-palette.test.tsx` events to carry `code` <!-- R7 -->
- [x] T006 Migrate `app/frontend/src/components/shell/shell.tsx` `useSidebarKeyboardToggle` to the `sidebar-toggle` binding + `shouldSuppressChord` <!-- R7 -->
- [x] T007 Migrate `app/frontend/src/hooks/use-chat-view-shortcut.ts` to the `chat-toggle` binding + `shouldSuppressChord` (enablement gate preserved); update its test <!-- R7 -->
- [x] T008 Migrate `app.tsx` ⌘. view-cycle listener to the `view-cycle` binding + `shouldSuppressChord`; retire `shouldSuppressViewChord` from `lib/window-view.ts` (move its unit coverage onto `shouldSuppressChord`) <!-- R7 -->
- [x] T009 Update `app/frontend/src/components/terminal-client.tsx` `attachCustomKeyEventHandler`: keep ⌘C copy case, then return `false` for keydowns matching any enabled binding via a render-updated bindings ref <!-- R8 -->
- [x] T010 Wire AppShell (`app.tsx`): mount `useKeybindingDispatch` with palette-derived handlers (`create-session`, `create-window`, `kill-window`, `agent-next-waiting`, `go-back`, `go-forward`), new `window-prev`/`window-next` cycle callbacks (current session, sidebar order, wrap, `navigateToWindow`), `shortcuts-overlay` toggle state; add the "Help: Shortcuts" palette entry <!-- R2 R6 R10 -->
- [x] T011 Wire BoardPage (`board-page.tsx`): replace the raw ⌘[/⌘] listener with `useKeybindingDispatch` (`board-cycle-next`/`board-cycle-prev` + `go-back`/`go-forward` + `shortcuts-overlay`); mount the overlay + palette entry <!-- R6 R7 R9 -->

### Phase 3: Overlay + palette hints

- [x] T012 Create `app/frontend/src/components/shortcuts-overlay.tsx` per the mock: focus-trapped dialog sheet, tier-map keyboard visualization, platform toggle, filter, grouped rows with scope badges + locked shell rows, capture rebind (Esc cancel, capture-phase listener), steal warning, modified dot + per-row reset + unbound flag, footer (storage note, reset all); colocated `shortcuts-overlay.test.tsx` <!-- R9 -->
- [x] T013 Palette hints: apply `withShortcutHints` to `paletteActions` (`app.tsx`) and the board palette (`board-page.tsx`); extend `buildViewActions` (`lib/palette-view.ts`) to take effective cycle/chat hint strings; update `palette-view.test.ts` <!-- R10 -->

### Phase 4: E2E + verification

- [x] T014 Create `app/frontend/tests/e2e/shortcut-registry.spec.ts` + sibling `shortcut-registry.spec.md` (constitution): mocked-backend spec covering ⇧Ctrl+H/L window cycling, ⇧Ctrl+[ back nav, ⇧CmdOrCtrl+/ overlay open/filter/Esc, click-to-capture rebind persisting the localStorage diff, palette hint rendering, and browser-reserved N inertness <!-- R2 R6 R9 R10 R3 -->
- [x] T015 Verification gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; run the new + adjacent e2e via `just test-e2e` (`shortcut-registry`, `agent-next-waiting`, board cycle spec) <!-- R1 R6 R7 -->

## Execution Order

- T001 → T002 → (T003, T004) → T005–T011 (parallelizable per file after T003/T004) → T012/T013 → T014 → T015
- T010 depends on T012's component existing for the overlay mount — implement T012 before finalizing T010/T011 wiring if convenient; checkbox order above is the commit order.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/keybindings.ts` exists, pure, owning all binding data; matching is `e.code`-based with the three tiers' modifier rules (Alt always excluded)
- [x] A-002 R2: All nine shifted-tier starter actions dispatch their behaviors on Shift+CmdOrCtrl chords, uniform per platform
- [x] A-003 R3: Claimed keys resolve as data; browser hosts disable shifted N/T/W defaults (reason `reserved`) while the actions stay palette-reachable
- [x] A-004 R4: Overrides persist as diffs to `localStorage["runkit-keybindings"]`, null disables, steal-with-warning unbinds the previous owner, per-row + reset-all work, malformed JSON tolerated
- [x] A-005 R5: `findConflicts` is pure and the shipped defaults are conflict-free (unit-asserted in `keybindings.test.ts` "ships conflict-free defaults in every host"). Note: the capture UI takes its steal warning from `applyCapture`'s `stolenFrom`, not `findConflicts` — R5's "consumed by the capture UI" clause is inaccurate; `findConflicts` is a test-only invariant guard
- [x] A-006 R6: One window-level dispatcher per route shell consults registry + handlers + `shouldSuppressChord`; unhandled matches fall through
- [x] A-007 R9: The overlay renders tier map, platform toggle, filter, grouped rows with scope badges, capture rebind, resets, locked shell rows, and footer per the mock; opened by ⇧CmdOrCtrl+/ and the palette entry; dialog not route
- [x] A-008 R10: Palette hints render effective combos per platform for every registered action with a palette entry, reflecting overrides; disabled bindings show no hint

### Behavioral Correctness

- [x] A-009 R7: The five legacy chords behave byte-identically at defaults, and rebinding each through the override layer takes effect. One deliberate, plan-sanctioned widening (Assumption 4): `sidebar-toggle` and `view-cycle` now adopt the shared predicate's `.rk-chat-input` carve-out, so ⌘\ / ⌘. additionally fire from the chat-send textarea (previously suppressed there)
- [x] A-010 R8: With a terminal focused, enabled app chords never transmit bytes to the pane; plain-Ctrl chords and the ⌘C copy case are untouched. Scope note: the terminal seam refuses **shifted-tier only** — verified sound, since the pre-change handler returned `true` for everything but ⌘C, so legacy cmd/ctrl-tier chords are byte-identical, and refusing cmd-tier would steal plain-Ctrl aliases (Ctrl+K, Ctrl+[) from the pane on win/linux. Residual: an action *rebound* into the cmd/ctrl tier is not refused and reaches the pane while the terminal has focus
- [x] A-011 R2: `window-prev`/`window-next` cycle within the current session in sidebar order with wraparound; no-op off the terminal route (`canCycle` gate — a missing handler falls through untouched)

### Scenario Coverage

- [x] A-012 R2 R6 R9 R10: `shortcut-registry.spec.ts` covers window cycling, back nav, overlay open/filter/close, capture rebind persistence, palette hints, and browser-reserved inertness — with an up-to-date `shortcut-registry.spec.md` companion (7 tests, constitution-conforming companion documenting shared setup + per-test what-it-proves/steps)
- [x] A-013 R1 R3 R4 R5: Unit suites cover matcher tiers, resolver/overrides/reserved, steal, capture, conflicts, formatting, suppression carve-outs (`keybindings.test.ts`, `use-keybindings.test.ts`, `use-keybinding-dispatch.test.ts`, `shortcuts-overlay.test.tsx`)

### Edge Cases & Error Handling

- [x] A-014 R4: localStorage unavailable degrades to defaults without throwing (`readStoredOverrides`/`writeStoredOverrides` try/catch at keybindings.ts:253-272 — implemented, but no test simulates a throwing localStorage; malformed-JSON tolerance IS covered); capture rejects modifier-only and tier-less chords (`captureFromEvent` tests); Esc cancels capture without persisting (`shortcuts-overlay.test.tsx` "Escape cancels capture without persisting")
- [x] A-015 R6: Chords are suppressed in real text inputs but fire inside `.xterm` and `.rk-chat-input`; ⌘K keeps firing everywhere (`ignoreInputs`) — covered by `shouldSuppressChord` carve-out tests + `use-keybinding-dispatch.test.ts` ignoreInputs case

### Code Quality

- [x] A-016 Pattern consistency: pure lib + colocated tests mirrors `palette-*.ts` convention; hooks mirror `use-local-storage-enum` pub/sub; overlay uses `useFocusTrap`, `rk-glint`, and theme tokens. Two deviations: the overlay hand-rolls its bracket headings inline instead of reusing the `SectionHeading` component, and `shortcuts-overlay.tsx:110`/`:118` use `capturingId as string` assertions where the enclosing `if (!capturingId) return` already narrows (code-quality.md prefers narrowing over assertions)
- [x] A-017 No unnecessary duplication: dispatcher handlers reuse palette action bodies via `fromPalette(id)`; no re-implemented tmux/session logic; no polling; no new routes or backend surface. The board route's duplicated `shortcuts-overlay` palette entry + overlay mount follow the pre-existing DD-8 dual-mount convention

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/keyboard-shortcuts.tsx:89-97` (the hardcoded "App" `<ShortcutRow>` block: ⌘K, ⌘\, Ctrl+`, ⌘.) — now fully superseded by the registry-driven shortcuts overlay, and actively wrong after a rebind: these four combos are hardcoded strings while the same four bindings are per-device overridable. Candidate to replace with the effective map (or drop the section and let the modal be tmux-only, pointing at `Help: Shortcuts`). Declared out of scope by this plan's Non-Goals, so left untouched.
- `docs/memory/run-kit/ui-patterns.md:336, 362, 1912` — the three `shouldSuppressViewChord` references describe a function this change deleted; the § Keyboard Shortcuts table and § Window Views prose need rewriting onto `shouldSuppressChord` + the registry. Hydrate's job (the intake already lists `run-kit/ui-patterns` as `(modify)`).
- `docs/memory/run-kit/ui-patterns.md:~1920` ("No SPA code binds the page tier yet — future bindings gate on `isShell()`") — still literally true (this change binds the *shifted* tier, not the page tier), but the surrounding paragraph now needs the SPA-side shifted-tier claim documented beside the shell's. Hydrate's job.
- `app/frontend/src/lib/keybindings.ts:322-348` (`findConflicts` + the `BindingConflict` type) — zero production call sites; the capture UI derives its steal warning from `applyCapture`'s `stolenFrom` instead. NOT recommended for deletion: plan R5 and acceptance A-005 mandate it as the pure invariant guard that unit-asserts the shipped defaults are conflict-free, which it does. The defect is R5's inaccurate "consumed by the capture UI" clause, not the function.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Overlay palette entry label "Help: Shortcuts" (id `shortcuts-overlay`); the existing tmux "Help: Keyboard Shortcuts" modal stays untouched | Intake names no label; Help: family exists; distinct from the tmux modal's label so palette filtering stays unambiguous | S:50 R:95 A:80 D:70 |
| 2 | Confident | `window-prev`/`window-next` wrap around within the current session | Matches board pane-cycle's modulo semantics; intake says "within current session, sidebar order" without endpoint behavior | S:55 R:90 A:80 D:75 |
| 3 | Confident | Session-context chords (N/T/W/H/L/A) no-op where their handler context is absent (board route, server dashboard w/o window for H/L/W); palette is the fallback | Intake's own open-question default ("current session when on a terminal route; palette fallback elsewhere"); handler-presence gating implements it directly | S:70 R:90 A:85 D:80 |
| 4 | Confident | ⌘K keeps firing inside text inputs via a per-binding `ignoreInputs` flag; all other chords adopt the shared suppression predicate (adds the `.rk-chat-input` carve-out to sidebar/view-cycle) | Today ⌘K has no suppression (primary discovery per Constitution V — must not regress); intake mandates one shared predicate with both carve-outs for the rest | S:60 R:85 A:85 D:75 |
| 5 | Confident | Claimed-key display set additionally includes ⇧Ctrl+C/V on win/linux (terminal copy/paste convention) | Present in the user-reviewed mock's `claimedWin`; display/warning-only, costs nothing | S:55 R:95 A:75 D:80 |
| 6 | Confident | Disabled bindings (user-disabled or browser-reserved) render no palette hint | A hint advertising a dead chord is a lie; intake says reserved actions "remain palette-reachable", not hint-bearing | S:50 R:95 A:85 D:80 |
| 7 | Confident | Steal applies in one capture press with a warning flag on the unbound victim (not the mock's press-again-to-confirm) | Intake text is authoritative: "conflicts resolve as steal-with-warning (the previous owner becomes unbound and is flagged…)" — single-step semantics | S:60 R:90 A:80 D:70 |
| 8 | Certain | Export/import buttons omitted; macro/CUSTOM section not rendered | Intake defers both explicitly (export/import "deferred"; macro slot is schema-only for hbyh) | S:90 R:95 A:95 D:95 |
| 9 | Confident | Overrides reactivity via in-module pub/sub + native `storage` event | Mirrors the established `use-local-storage-enum.ts`/font-size persistence pattern named in the intake | S:65 R:90 A:90 D:85 |
| 10 | Confident | Board cycle registry actionIds are `board-cycle-next`/`board-cycle-prev`, doubling as the existing board palette ids | "actionId doubles as palette action id where one exists" — those palette ids already exist in board-page.tsx | S:75 R:90 A:90 D:85 |

10 assumptions (1 certain, 9 confident, 0 tentative).
