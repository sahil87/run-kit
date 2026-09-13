# Plan: Compose strip on by default — first-render notice, focus on fresh navigation, one name

**Change**: 260913-png4-compose-default-on
**Intake**: `intake.md`

## Requirements

### Compose Strip: Default and notice

#### R1: The preference defaults to on; an explicit opt-out is preserved
`readComposeStrip()` in `contexts/chrome-context.tsx` SHALL return `true` when the `runkit-compose-strip` key is absent, unreadable, or holds anything other than `"false"`, and `false` only for an explicit `"false"`. `toggleComposeStrip` SHALL be unchanged (it already writes `"true"`/`"false"`). `ChromeState` SHALL expose a read-once `composeStripDefaulted: boolean` (true when the key was absent/unreadable at provider mount), computed once and never updated.

- **GIVEN** a browser with no stored preference
- **WHEN** the app mounts
- **THEN** `composeStripEnabled` is `true`, `composeStripDefaulted` is `true`, and the key stays unset until the first toggle

- **GIVEN** a stored `"false"`
- **WHEN** the app mounts
- **THEN** `composeStripEnabled` is `false` and `composeStripDefaulted` is `false`

#### R2: One first-render notice
`ComposeStripExpanded` SHALL, from its mount effect, show exactly one info toast `Compose is on by default — {chord} hides it` (chord from `chordHintFor("compose-toggle", …)`; the clause `— {chord} hides it` omitted when the chord is undefined) when ALL hold: not `forceExpanded`, `composeStripDefaulted` is true, and the sentinel key `runkit-compose-default-notice` is absent. It SHALL write the sentinel (`"1"`, in try/catch) BEFORE calling `addToast(message, "info")`, so a StrictMode double-invoke cannot show it twice. Neither tongue form shows it.

- **GIVEN** a fresh browser (no preference, no sentinel) on a desktop terminal route with a target
- **WHEN** the expanded body first mounts
- **THEN** one info toast appears and the sentinel is written; a reload shows no toast

- **GIVEN** a stored preference (`"true"` or `"false"`) or the operator page
- **WHEN** the body mounts
- **THEN** no toast

### Focus: First-visit resolver

#### R3: Fresh navigation lands focus in the textarea, remounts never steal
The restore router in `app.tsx` SHALL replace both `recallFocus(key) ?? "tty"` reads (`restoreFocus`, `revertProgrammaticFocus`) with a first-visit resolver returning `"compose"` when the compose preference is on (read through a ref so `restoreFocus` stays stable) and `"tty"` otherwise. The compose first-visit arm SHALL retry `focusComposeStrip()` on the router's existing rAF loop until `FOCUS_RESTORE_RETRY_MS`, falling back to the tty arm on deadline; a recorded kind (`tty`/`compose`/`code`) SHALL win over the resolver. Immediately before each focus attempt the compose arm SHALL abandon (fall to tty) when `document.activeElement` is inside `.xterm`, inside `[role="dialog"]`/`[aria-modal="true"]`, inside an open `[role="menu"]`/`[role="listbox"]`, an editable (`shouldSuppressChord` truth: INPUT/TEXTAREA/contentEditable outside `.xterm`), or an `<iframe>` (`focusIsEngaged` in `lib/keybindings.ts`); it SHALL proceed when the active element is `body`/`null` or a plain control at rest (the sidebar row that navigated). The effect's capture-phase pointerdown/keydown cancel and the desktop-only gate SHALL be unchanged; the strip's own mount effect SHALL still focus only on the focus-on-open flag.

- **GIVEN** no stored preference and a never-visited terminal window
- **WHEN** the desktop route loads (`page.goto`, or a sidebar-row switch)
- **THEN** the textarea becomes `document.activeElement` without a click and a typed character lands in it

- **GIVEN** a window whose focus memory says `tty` (the user clicked the pane)
- **WHEN** the user returns to it
- **THEN** `.xterm` gets focus

- **GIVEN** focus in the pane
- **WHEN** the tile grid re-keys (open+close a tile, zen toggle)
- **THEN** `.xterm` keeps focus

- **GIVEN** the preference off (tongue showing)
- **WHEN** a fresh navigation happens
- **THEN** the tty default applies exactly as today

### Naming and copy

#### R4: One name — "Compose"
The palette entry with id `text-input` SHALL be labelled `Compose: Toggle` (id unchanged). The status-bar chip Tip label and `aria-label`, its overflow-menu row (`a▏ Compose`), the bottom-bar chip Tip label and `aria-label`, and the `compose-toggle` registry row `label` SHALL read `Compose`. The action id, chord, `ignoreInputs`, `mapLabel`, `description`, `Compose: Focus`, `Compose: Recall sent…`, the tongue label/aria, the textarea aria sentences, and the closers' labels SHALL be unchanged.

- **GIVEN** the palette open
- **WHEN** the user types `Compose`
- **THEN** `Compose: Toggle` and `Compose: Focus` are listed and `View: Text Input` is not

#### R5: The placeholder teaches the hand-off, and Escape performs it
The fine-pointer terminal-target placeholder SHALL read `Compose text — Enter inserts · {submitKeycap} sends · ↑ history · Esc → terminal`. Coarse, selection-broadcast, and no-target copy SHALL be unchanged. Escape in the textarea SHALL blur it AND hand focus to the terminal through a per-mount `onEscapeToTerminal` seam (the route's `focusTerminalRef`, the board's focused pane) — never collapsing the strip — so the hint is true.

- **GIVEN** a fine pointer and a terminal target
- **WHEN** the textarea is empty
- **THEN** its placeholder ends with `· Esc → terminal`

### Tests

#### R6: Tests follow the spec — default-off assumptions are made explicit
Unit tests assuming default-off SHALL seed `runkit-compose-strip="false"` explicitly (the compose-strip collapsed-tongue describe; the chrome-context boolean-preference table splits so compose asserts the on default, the explicit-false read, the corrupt-value-reads-on rule, and a toggle from the default writing `"false"`). e2e specs whose subject is xterm input or non-punch-through app chords SHALL seed the preference off via a shared `seedComposeStrip(page, on)` helper in `tests/e2e/_ready.ts` (an `addInitScript`), or click the terminal first when the test is about the user choosing the terminal; `focus-restore.spec.ts`'s first-visit-tty test SHALL seed off; the `compose-strip.spec.ts` persist test SHALL invert (on by default → chip off → reload stays off → palette `Compose: Toggle` on). Every new Playwright `test()` carries the Proves/Steps JSDoc; runs go through `just` only.

- **GIVEN** `just test-frontend` and each audited `just test-e2e <name>.spec`
- **WHEN** run after the change
- **THEN** they pass, with no spec relying on the old default

### Non-Goals
- Enter semantics (plain Enter = insert-line, ⌘/Ctrl+⏎ submits) — re-examine after a week of default-on; recorded as a deferral in memory.
- Retiring the status-bar `a▏` chip; suppressing the coarse footer tongue while the bottom-bar chip shows — deferred.
- Per-pane-kind defaults (agent vs shell) — one global preference.
- Mobile auto-focus — the router stays desktop-only.
- Any change to the tongue, drafts, uploads, the send path, `runComposeToggleChord`, `forceExpanded`, or the board footer mount.

### Design Decisions

#### Compose is the default input surface
**Decision**: The compose strip is on unless the user stored `"false"`; the terminal is the control surface (y/n, arrows, Ctrl-C, TUIs) reached by Escape or a click, and a desktop fresh navigation lands focus in the strip.
**Why**: Prompting an agent is the dominant input; xterm's canvas has no OS text input (no IME/dictation, laggy large pastes), and a visible strip that ignores the first keystroke is worse than either default. The strip is already non-modal and lossless, and the collapsed tongue teaches the toggle in place, so flipping the default costs one preference read.
**Rejected**: Per-pane-kind defaults (a second policy path for one preference); Enter = submit on agent panes (contradicts the recorded terminal-faithful classifier decision — deferred, not decided); a modal onboarding step (one info toast plus the tongue suffice); focusing on every mount (steals focus on terminal↔board remounts).
*Introduced by*: 260913-png4-compose-default-on

#### The first-visit default is a resolver, consulted only when memory is empty
**Decision**: The restore router's `?? "tty"` becomes `firstVisitKind()` — `compose` when the preference is on, `tty` otherwise — used by both `restoreFocus` and `revertProgrammaticFocus`; the compose arm retries the registered focuser until the body mounts and abandons when a typing surface already holds focus.
**Why**: The router already runs on page load and every window switch and already owns the rAF retry and the pointerdown/keydown cancel, so it is the one seam where "fresh navigation" is defined; a recorded kind still wins, which is what keeps remounts and returns byte-for-byte. The body mounts only after the terminal registers, so a one-shot attempt would always decline. Nav controls (a sidebar row) are not typing surfaces — today's tty default already takes focus from them.
**Rejected**: A separate first-visit effect in `app.tsx` (a second definition of "fresh"); a literal `activeElement === body` guard (the most common fresh navigation, a sidebar click, would fall to tty); suppressing the `compose` recording on the router-driven focus (the recorded value equals the resolver's answer and a pane click overwrites it).
*Introduced by*: 260913-png4-compose-default-on

#### The notice fires only when the default caused the strip to show
**Decision**: `ChromeProvider` records once whether the key was absent at mount (`composeStripDefaulted`); the expanded body shows the toast only when that flag is true, the mount is not `forceExpanded`, and the `runkit-compose-default-notice` sentinel is absent — writing the sentinel before `addToast`.
**Why**: A user with a stored preference already knows the toggle; the operator page's forced strip would make "⌘I hides it" a lie; StrictMode double-invokes effects, so the sentinel must be written first.
**Rejected**: Toasting on every default-on render (nagging); keying the notice on `composeStripEnabled` alone (fires for users who chose on).
*Introduced by*: 260913-png4-compose-default-on

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/frontend/src/contexts/chrome-context.tsx`: flip `readComposeStrip()` to `getItem(KEY) !== "false"` (catch ⇒ `true`), add read-once `composeStripDefaulted` (absent/throw at mount) to `ChromeState` and the memoized value; update the file's preference doc comments. `app/frontend/src/contexts/chrome-context.test.tsx`: split the compose row out of the `it.each` default case — defaults to true when unset (key stays null), explicit `"false"` reads off, `"true"` reads on, corrupt value reads on, toggle from default writes `"false"`, storage-failure starts on; assert `composeStripDefaulted` true/false. <!-- R1 -->
- [x] T002 `app/frontend/src/components/compose-strip.tsx`: (a) first-render notice — a `[]`-deps mount effect in `ComposeStripExpanded` beside the focus-on-open consume, gated `!forceExpanded && composeStripDefaulted && sentinelAbsent`, writing `runkit-compose-default-notice="1"` in try/catch then `addToast("Compose is on by default — {chord} hides it" | "Compose is on by default", "info")` with the chord from `useKeybindings()` + `chordHintFor` (thread `forceExpanded` into the body as a prop); (b) the fine-pointer placeholder gains `· Esc → terminal`. `compose-strip.test.tsx`: seed `"false"` in the collapsed-tongue describe; toast-once tests for all four gates (`addToastMock` exists); placeholder assertion update. <!-- R2, R5 -->
- [x] T003 `app/frontend/src/app.tsx`: `firstVisitKind()` resolver over a `composeStripEnabledRef` (synced from `useChromeState`), used in `restoreFocus` and `revertProgrammaticFocus`; the compose first-visit arm rides the rAF loop (`focusComposeStrip()` each frame until it returns true or the deadline, then tty), with the active-element guard (`.xterm`, `[role="dialog"]`, `[aria-modal="true"]`, `shouldSuppressChord`-editable, `IFRAME` ⇒ abandon to tty) — extract the guard as a small pure helper (e.g. `lib/focus-memory.ts` `typingSurfaceHasFocus(activeElement)`) with a colocated Vitest; update the router comments. Renames: `app.tsx` palette label `Compose: Toggle`; `status-bar.tsx` Tip/aria `Compose` + row `a▏ Compose`; `bottom-bar.tsx` Tip/aria `Compose`; `lib/keybindings.ts` `compose-toggle` label `Compose`; update `keybindings.test.ts`, `status-bar.test.tsx`, `bottom-bar.test.tsx` (and the `compose-toggle ⇄ text-input` comment). `pnpm exec tsc --noEmit` + `just test-frontend`. <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 e2e core: add `seedComposeStrip(page, on: boolean)` to `app/frontend/tests/e2e/_ready.ts` (`addInitScript` writing `"true"`/`"false"`); `compose-strip.spec.ts` — header paragraph for the new default; invert the persist test (on by default → chip off → reload off with `"false"` → palette `Compose: Toggle` on); rename `Compose text` → `Compose` and `View: Text Input` → `Compose: Toggle` everywhere in the file; drop/keep the now-no-op `"true"` seeds; new tests with Proves/Steps: fresh `goto` lands focus in the textarea and a typed character lands there; sidebar-row switch to a never-visited window lands in the textarea, return to a `tty`-recorded window lands on `.xterm`; a tile re-key with focus in the pane keeps `.xterm`; Escape hands off and a typed key reaches the `cat` pane (`tmuxCapture`); the first-render toast reads `Compose is on by default — Shift+Ctrl+E hides it` once and not after reload, and not with a seeded preference; the fine placeholder ends with `· Esc → terminal` (coarse unchanged). `focus-restore.spec.ts`: seed off in the first-visit-tty test, rename chip references. `status-bar.spec.ts`: rename the menuitem regex. Run `just test-e2e compose-strip.spec`, `focus-restore.spec`, `status-bar.spec`. <!-- R2, R3, R4, R5, R6 -->
- [x] T005 e2e audit: for every spec that types/presses after navigating to a terminal route without clicking the terminal (intake § 7 list, led by `shortcut-registry.spec.ts`, `surface-focus-chords.spec.ts`, `quake-terminal.spec.ts`, `gui-surface.spec.ts`, `macro-riff-bindings.spec.ts`, `window-heading.spec.ts`, `settings-dialog.spec.ts`, `web-view-lens.spec.ts`, `sidebar-multiselect.spec.ts`, `row-flyout.spec.ts`, and the tail), decide per spec: seed off via `seedComposeStrip(page, false)` when the subject is xterm input or non-punch-through chords, or click the terminal when the subject is the user choosing it; check coarse specs (`mobile-layout`, `mobile-touch-scroll`, `touch-focus-gate`) for footer-height/bottom-bar assertions now that the expanded strip renders at the footer by default; `operator-page.spec.ts` Proves block re-read. Run each edited spec via `just test-e2e <name>.spec`, then the full `just test-e2e` once. <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `readComposeStrip()` returns true for absent/unreadable/non-`"false"` values and false only for `"false"`; `composeStripDefaulted` is exposed read-once on `ChromeState`
- [x] A-002 R2: the info toast fires once from the expanded body's mount effect under the four gates, sentinel written first, chord clause omitted when the chord is undefined
- [x] A-003 R3: both `?? "tty"` reads in `app.tsx` go through the first-visit resolver; the compose arm retries on the existing rAF loop with the existing deadline and abandons to tty on a typing-surface active element
- [x] A-004 R4: palette label `Compose: Toggle` (id `text-input` unchanged), status-bar/bottom-bar chip Tip+aria `Compose`, overflow row `a▏ Compose`, registry label `Compose`; nothing else renamed
- [x] A-005 R5: the fine terminal-target placeholder ends with `· Esc → terminal`; coarse/selection/no-target copy unchanged

### Behavioral Correctness

- [x] A-006 R1: an existing stored `"false"` still reads off after the flip; `toggleComposeStrip` unchanged
- [x] A-007 R3: a recorded kind (`tty`/`compose`/`code`) wins over the resolver; a tile re-key or dock flip never steals focus from the pane; the strip's mount effect still focuses only on the focus-on-open flag
- [x] A-008 R3: with the preference off the first-visit default is `tty` exactly as before
- [x] A-009 R3: the fresh-navigation focus is desktop-only (the router's `isMobile` skip is unchanged)
- [x] A-010 R2: no toast on the operator page (`forceExpanded`), with a stored preference, or on either tongue

### Scenario Coverage

- [x] A-011 R3: e2e proves fresh `goto` focuses the textarea with no click and typing lands there
- [x] A-012 R3: e2e proves the sidebar-row switch to a never-visited window lands in the textarea and a return to a `tty`-recorded window lands on `.xterm`
- [x] A-013 R3: e2e proves Escape hands focus to xterm and a typed key reaches the tmux pane
- [x] A-014 R2: e2e proves the toast once (win/linux face) and not after reload or with a seeded preference
- [x] A-015 R1: e2e proves on-by-default → chip off → reload stays off (`"false"`) → palette `Compose: Toggle` on
- [x] A-016 R6: `focus-restore.spec.ts` first-visit-tty test seeds off and still passes; `status-bar.spec.ts` rename passes

### Edge Cases & Error Handling

- [x] A-017 R1: a corrupt stored value reads on; a throwing storage reads on and toggles off
- [x] A-018 R2: StrictMode's double-invoked effect shows exactly one toast (sentinel written before `addToast`)
- [x] A-019 R3: the compose arm never focuses while the palette input, a dialog, an open menu/listbox, an iframe, or xterm holds focus (the effect can arm after the user has already opened a menu under load)

### Code Quality

- [x] A-020 Pattern consistency: `runkit-*` key + try/catch for the sentinel; `chordHintFor` for the chord; the resolver reuses `shouldSuppressChord`'s editable truth rather than a second list
- [x] A-021 No unnecessary duplication: one `seedComposeStrip` helper in `_ready.ts` used by every audited spec; no per-spec init-script copies
- [x] A-022 Comment discipline: router/provider comments state constraints (why a ref, why retry, why the guard), no narration, no change IDs
- [x] A-023 Tests: every new Playwright `test()` carries Proves/Steps; every audited spec's seed or click is explained in its header/Proves; `just test-frontend` and the full `just test-e2e` pass

## Notes

- Deviation (recorded at review): the planned e2e for "a tile re-key keeps focus in the pane" (T004) is not in `compose-strip.spec.ts` — no top-bar control or Linux chord reliably re-keys the tile grid in the rig. A-007's remount half is verified by code inspection: the restore effect's deps `[server, windowParam, isMobile, restoreFocus]` do not change on a re-key or dock flip, and the strip's mount effect focuses only on the focus-on-open flag (unit-tested).
- Post-review cleanup (verdict pass, 4 should-fix taken): stale `View: Text Input` / `?? "tty"` comments updated; the compose first-visit arm now abandons WITHOUT falling to tty when focus is engaged elsewhere (the tty fall-through was the residual steal behind the status-bar overflow flake); `expectActiveElement` hoisted into `tests/e2e/_ready.ts` and shared by the two specs; focus-restore Steps lists name the seed step.

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (the default flip, the notice, the first-visit resolver, the Escape hand-off) and renames labels in place without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `forceExpanded` is threaded into `ComposeStripExpanded` as a prop so the notice gate can read it (the wrapper already owns the value) | Cheapest truthful signal for "the default caused this render"; no second context read | S:75 R:90 A:85 D:80 |
| 2 | Confident | The active-element guard is extracted as a pure helper beside `lib/focus-memory.ts` with a colocated Vitest, called by the router before each attempt | Testable without a router; the retry loop re-checks each frame so a dialog opening mid-retry abandons correctly | S:65 R:90 A:80 D:75 |
| 3 | Confident | The recorded-`compose` return arm keeps its one-shot decline→tty behavior (only the FIRST-VISIT compose arm retries) | A return to a `compose`-recorded window happens with the body already mounted; retrying there is unnecessary and the intake left the loop shape to apply | S:60 R:90 A:80 D:70 |
| 4 | Tentative | The e2e audit resolves to "seed off" for chord/xterm-input specs and "click first" only where a test's Proves is about the user choosing the pane; the exact per-spec split is judged at T005 against each Proves block | 30+ specs; the review verifies no Proves intent was silently changed | S:55 R:85 A:70 D:60 |
| 5 | Confident | The plan groups the work into 5 tasks (light lane, inline) | Three source tasks plus two e2e tasks; the audit is large but one coherent activity | S:70 R:90 A:85 D:80 |
| 6 | Confident | Escape hands focus to the terminal via a new optional `onEscapeToTerminal` prop each mount passes (route: `focusTerminalRef`; board: the focused pane's `focus()`), in addition to today's blur | Found at apply: the strip's Escape only ever BLURRED (the memory's "blurs back to the terminal" was loose) — with compose as the default input the `Esc → terminal` hint would lie and the hand-off would cost a click; the bottom bar's `onFocusTerminal` prop is the established per-mount seam for exactly this | S:70 R:85 A:85 D:80 |

6 assumptions (0 certain, 5 confident, 1 tentative).
