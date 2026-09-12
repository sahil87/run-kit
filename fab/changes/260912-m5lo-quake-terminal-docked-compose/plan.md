# Plan: Quake Terminal Docked Compose

**Change**: 260912-m5lo-quake-terminal-docked-compose
**Intake**: `intake.md`

## Requirements

All requirements are desktop-only. The drawer JSX sits below `quake-terminal.tsx`'s `if (!rendered || isMobile) return null;` guard, the launcher self-gates on `isMobile`, and the mobile arm of the `rk:quake-terminal` seam listener navigates to the operator route and writes the route strip's draft store — nothing here touches it (R17).

### Quake Terminal: Docked compose strip

#### R1: The compose strip renders inside the drawer only while `open`
While `machine === "open"` the desktop drawer SHALL render a compose strip as its last flex child above the resize grips (inside the border; the grips straddle the border and are unaffected), wrapper `data-testid="quake-terminal-compose"`, class `border-t border-border shrink-0`, containing top to bottom: (1) the status line (R3), (2) a header row with a `◉ → operator` label whose `◉` is the shared `OperatorStateGlyph` carrying the resolved operator's live-state dot (`data-testid="quake-terminal-compose-state"`, `OPERATOR_STATE_DOT` colors), then `<OperatorContextChip server={server} compact />`, then right-aligned key hints `Enter sends · ⇧Enter newline · Esc back to terminal` in `text-text-secondary text-[10px]`; (3) the textarea (R2). At `rest` no strip exists (the drawer is unmounted after the exit slide).

- **GIVEN** the desktop machine at `open` on an operator-bearing server
- **WHEN** the drawer renders
- **THEN** `quake-terminal-compose` is present with the header row, the context chip (when a chat subject is attached), the hints, and the textarea, above the bottom grip
- **AND GIVEN** the machine at `rest`, **THEN** no `quake-terminal-compose` element exists in the document

#### R2: The textarea is the shared compose seam's one view at `open`
The strip's input SHALL be `<textarea data-testid="quake-terminal-compose-input" aria-label="Ask the operator" rows={1} placeholder="Ask the operator…">` bound to the shared store: `value={compose.text}` from `useOperatorCompose()`, `onChange → setOperatorComposeText`. Key handling MUST use `classifyComposeEnter` (`lib/compose-keys.ts`): a `submit` classification calls `e.preventDefault()`, ignores an empty/whitespace draft, otherwise calls `sendOperatorMessage(server, target, value)` and keeps focus in the textarea; an `insert-line` classification (⇧Enter) inserts a newline. The textarea SHALL auto-grow to content bounded at 6 rows (the route compose strip's idiom, lifted into a shared helper rather than duplicated), then scroll internally. File paste/drop inside the drawer keeps routing through `attachOperatorFiles` (unchanged).

- **GIVEN** the strip focused with the draft `Is peui done?`
- **WHEN** Enter is pressed
- **THEN** exactly one `sendOperatorMessage` fires with that text, the draft clears on success, and `document.activeElement` is still the textarea
- **AND WHEN** ⇧Enter is pressed instead, **THEN** a newline is inserted and nothing is sent
- **AND WHEN** Enter is pressed on an empty draft, **THEN** nothing is sent and no state changes

#### R3: The status line lives in the strip, above the header row
The `sending…` / `uploading…` indicator and the inline error (`role="alert"`, `data-testid="quake-terminal-error"`, `text-signal-red`; indicator `data-testid="quake-terminal-uploading"`) SHALL render as the strip's first row only while `compose.error || compose.sending || compose.uploading`. The drawer's top-edge status row is REMOVED; the status has exactly one home. A failed send keeps the draft text in the store (existing behavior).

- **GIVEN** a send that fails with a structured 409
- **WHEN** the error resolves
- **THEN** the message renders inside `quake-terminal-compose` above the header row, nothing renders at the drawer's top edge, and the textarea still holds the text

#### R4: One `engaged` flag drives both accent borders
A single flag SHALL say the compose owns input: true while the textarea has real focus, and a blur whose `relatedTarget` lies inside the strip wrapper does NOT clear it (so the context chip's ✕ click lands). The flag MUST be readable from both trees (the drawer in the root layout and the launcher in the top bar) — published as a module slot in `lib/quake-terminal.ts` (`setQuakeComposeEngaged` / `useQuakeComposeEngaged`, the machine-slot idiom). While engaged the textarea carries `border-accent-green` (else `border-border`) and the collapsed launcher (R6) carries the same accent. The flag is focus-derived, never pin-derived: pinned-and-unfocused, both borders are plain.

- **GIVEN** the drawer open and the textarea focused
- **THEN** the textarea and the collapsed launcher both carry `border-accent-green`
- **AND WHEN** focus moves to the embedded terminal, **THEN** both borders return to `border-border` and the drawer stays open
- **AND WHEN** focus moves from the textarea to the chip's ✕ inside the strip, **THEN** engaged stays true and the dismiss click lands

#### R5: Focus-on-open targets the docked textarea under the two invariants
Entering `open` SHALL focus the docked textarea (caret at the end of any existing draft) once it is mounted. **Invariant (a)**: the restore origin captured at `rest → open` is kept only when `document.activeElement` is outside every quake-terminal-owned element — `isQuakeTerminalTarget(origin)` false — else `null`. **Invariant (b)**: on reaching `rest` no focus action is taken unless a quake-terminal-owned element (the textarea) is still `document.activeElement`; when it is, blur it and focus the origin if still connected. The ownership check MUST run while the drawer is still mounted (the drawer is mounted through the exit slide, `QUAKE_SLIDE_MS`, so an effect on the `rest` transition observes the textarea; an effect after `finishClose` would see `document.body` and wrongly skip). The origin ref lives as a module slot in `lib/quake-terminal.ts` beside the machine state so entry capture and exit check share it. The launcher's `onFocus → open` stays: focusing the standing box opens the drawer and focus then moves to the textarea. Focus movement alone never steps the machine.

- **GIVEN** focus in an xterm pane and the chord fires
- **THEN** the drawer opens, the textarea has focus, and the origin is the pane's element
- **AND WHEN** Esc fires with the textarea still focused (on a list segment), **THEN** the machine returns to `rest` and the pane regains focus
- **AND GIVEN** the user clicked into the embedded terminal before collapsing, **THEN** no focus call is made on `rest` (the terminal keeps focus)
- **AND GIVEN** a mouse click into the standing launcher box, **THEN** the captured origin is `null` (the box is quake-owned) and focus lands in the textarea

### Quake Launcher: collapsed control at `open`

#### R6: The launcher collapses to glyph + chord while open
At `rest` the launcher SHALL be unchanged (≥lg standing box `w-[12ch] 2xl:w-[20ch] max-w-[40vw] h-[28px]`, `Ask…`/`Ask the operator…` placeholders, chord `<kbd>`; md–lg ghost `quake-launcher-ghost`; below md nothing; mobile null; a store-held draft shows in the standing box). At `open`, wherever the launcher renders something at rest (≥lg and md–lg), it SHALL instead render one collapsed control `data-testid="quake-launcher-collapsed"`: `<button type="button" aria-label="Focus quake terminal compose">` holding `OperatorStateGlyph` (dot kept, `data-testid="quake-launcher-state"` semantics unchanged) and the chord `<kbd>`; `h-[28px] rounded border px-1.5`; `border-accent-green` while engaged (R4) else `border-border`. Click focuses the docked textarea. No input element, no `w-[34ch]` engaged width, and no launcher-mounted context chip render at `open`. Below md nothing renders at `open`.

- **GIVEN** a ≥lg viewport at `rest`
- **THEN** `quake-launcher-input` is visible and `quake-launcher-collapsed` is absent
- **AND WHEN** the machine enters `open`, **THEN** `quake-launcher-collapsed` renders with the dot and chord and `quake-launcher-input` is absent
- **AND WHEN** the collapsed control is clicked, **THEN** `quake-terminal-compose-input` has focus and the machine stays `open`
- **AND GIVEN** an md–lg viewport at `open`, **THEN** the ghost is absent and the collapsed control renders

#### R7: The top-bar heading is never hidden by the machine
`top-bar.tsx` SHALL drop `launcherMorphed` and its `hidden lg:flex` heading class: the center `PageType: name` heading renders on every mode at every width regardless of the machine state, including while the drawer is open at md–lg. The ≥lg prefix compaction (`hidden sm:inline lg:hidden` on the prefix span) is unchanged.

- **GIVEN** a terminal route at md–lg with the machine at `open`
- **THEN** the `Tab: <name>` heading is visible beside the collapsed launcher
- **AND GIVEN** ≥lg at `open`, **THEN** the name heading is visible and the `Tab:` prefix is hidden as at rest

### Quake Terminal: Esc ladder

#### R8: Esc in the textarea yields to the terminal first, on the terminal segment only
On `Escape` in the docked textarea with the Operator Terminal segment showing, the strip SHALL call `e.preventDefault()` and focus the embedded terminal (the drawer's `TerminalClient` xterm textarea), so the drawer's document keydown listener (which skips `defaultPrevented`) does not collapse; the next Esc collapses. On the Tasks / Cron List / Cron Log segments the textarea MUST NOT prevent the event, so the existing collapse rung fires on the first press. The document listener and the nested-`role="dialog"` stand-down are unchanged.

- **GIVEN** the drawer open on Operator Terminal with the textarea focused
- **WHEN** Esc is pressed once
- **THEN** the drawer stays open and the embedded terminal has focus
- **AND WHEN** Esc is pressed again, **THEN** the machine returns to `rest`
- **AND GIVEN** the Cron List segment with the textarea focused, **WHEN** Esc is pressed once, **THEN** the machine returns to `rest`

### Quake Terminal: One header row

#### R9: Segments and meta share one header row
The title strip and the segment strip SHALL fold into one row `data-testid="quake-terminal-header"` (`flex items-center gap-2 border-b border-border px-2 py-1 text-xs shrink-0`): left, `<QuakeSegments>` (`role="tablist"`, `data-testid="terminal-activity-tabs"`, `shrink-0`); right (`ml-auto`), a `min-w-0 truncate whitespace-nowrap` meta cluster — the `<select aria-label="Operator server">` picker when the route has no server param and more than one server exists, else the server name; `·` agent state + idle duration (`data-testid="quake-terminal-state"`); `·` the tick-age stamp in its `Tip` (`data-testid="quake-terminal-tick"`, stale `⚠` yellow variant unchanged) — then the `shrink-0` pin button (R11) and the `shrink-0` ▼ collapse button (`aria-label="Collapse quake terminal"`, unchanged). The `◉ OPERATOR` title word is retired. Segments, pin, and ▼ never shrink at the 420px width floor; the meta cluster absorbs all squeeze by truncation.

- **GIVEN** the drawer open on a server with an operator and a ticking loop
- **THEN** exactly one header row precedes the body, containing the four segments, the state, the tick stamp, the pin, and ▼, and no `◉ OPERATOR` text
- **AND GIVEN** the drawer at 420px width, **THEN** the segments, pin, and ▼ are fully visible and the meta cluster truncates

### Quake Terminal: Pin

#### R10: Pin state is an ephemeral module slot that resets at `rest`
`lib/quake-terminal.ts` SHALL export `getQuakePinned()`, `setQuakePinned(boolean)`, `useQuakePinned()` (the machine pub/sub idiom). Pin is never persisted (no localStorage, tmux option, or URL — Constitution IV) and MUST reset to `false` whenever the machine enters `rest`.

- **GIVEN** the drawer open and pinned
- **WHEN** ▼ collapses it and ⌘J reopens it
- **THEN** the drawer opens unpinned

#### R11: The pin control
The header row SHALL carry `<button type="button" aria-pressed={pinned} aria-label={pinned ? "Unpin quake terminal" : "Pin quake terminal"} data-testid="quake-terminal-pin">⌖</button>` in the Control-primitive icon-button vocabulary (`rk-glint`, `coarse:min-h-[36px] coarse:min-w-[36px]`, `text-accent-green` while pressed).

- **GIVEN** the drawer open unpinned
- **WHEN** the pin is clicked
- **THEN** `aria-pressed="true"` and the glyph is accent-green; a second click returns to `false`

#### R12: Pinned suspends only the outside-click collapse
The outside-click capture-listener effect SHALL early-return when `pinned` is true (`if (machine !== "open" || pinned) return;`), so a click outside the drawer leaves it open and the clicked element owns the interaction. ⌘J (`toggle`), Esc (R8 ladder), and ▼ still collapse while pinned. The unpinned path (settle timeout, activity counter, unrelated-dialog bail-out) is unchanged.

- **GIVEN** the drawer open and pinned
- **WHEN** a click lands in the page below the drawer
- **THEN** the drawer stays open and focus is where the click landed
- **AND WHEN** ⌘J fires, **THEN** the machine returns to `rest`
- **AND GIVEN** unpinned, **WHEN** a click lands outside, **THEN** the drawer collapses as before

#### R13: Palette entry for the pin, open-gated
`lib/palette/quake-terminal.ts` SHALL export `buildQuakeTerminalPinAction(pinned: boolean)` → `{ id: "quake-terminal-pin", label: pinned ? "Operator: Unpin quake terminal" : "Operator: Pin quake terminal", onSelect: () => setQuakePinned(!pinned) }`, no chord. `use-global-palette-actions.ts` registers it beside the existing five quake entries but lists it only while the desktop machine is `open` (degrade-to-absent; the opener stays always-listed).

- **GIVEN** the drawer open and unpinned
- **WHEN** the palette opens
- **THEN** `Operator: Pin quake terminal` is listed and selecting it pins the drawer
- **AND GIVEN** the drawer closed, **THEN** no pin entry is listed

### Quake Terminal: Glass default

#### R14: Glass default 0.95
`QUAKE_OPACITY_DEFAULT` SHALL be `0.95`. The stale doc comments at `lib/quake-terminal.ts` (`useQuakeOpacity` — range `0.5–1.0`, default `0.95`) and `quake-terminal.tsx` (`default 0.90`) are corrected; the lib test title `returns the default 0.90 when nothing is stored` becomes `0.95`. The settings row (`QuakeOpacityControl`) is unchanged.

- **GIVEN** no stored opacity
- **WHEN** `readQuakeOpacity()` runs
- **THEN** it returns `0.95` and the drawer renders at α 0.95 with the 6px blur

### Tests

#### R15: Vitest coverage
Colocated Vitest suites SHALL cover: strip renders only at `open`; status line placement (in the strip, never at the top edge); Enter sends once with focus retained; ⇧Enter inserts a newline; empty Enter no-op; Esc first rung on the terminal segment vs. collapse on list segments; one header row without `◉ OPERATOR` (retargeting the title-strip tests); pin `aria-pressed` toggle, listener gating (pinned twin of the outside-click test), chord/Esc/▼ collapse while pinned, reset on re-open; the jsdom-provable parts of the focus invariants; launcher collapsed at `open` at both rungs, click re-focuses the textarea, chord from rest lands focus in the textarea, chip assertions retargeted to the strip mount; lib pin slot + engaged slot + origin slot + opacity default; palette pin builder; top-bar heading visible at `open`.

- **GIVEN** the affected Vitest suites run
- **THEN** every test passes and the cases above exist

#### R16: Playwright coverage with intent comments
`quake-terminal.spec.ts` SHALL type into `quake-terminal-compose-input` wherever it typed into the launcher at `open` (selectors, not flows); its `launcherInput` helper is replaced by a `composeInput` helper; the md–lg test asserts the heading stays and the collapsed glyph renders; new tests prove Enter from the strip sends once, an outside click collapses unpinned and holds pinned, the heading is visible while open at ≥lg, and the collapsed launcher re-focuses the textarea. `window-heading.spec.ts` gains a test proving the heading is not hidden at `open`. Every touched `test()` updates its JSDoc **Proves/Steps** block and the quake spec's file header is rewritten for the docked contract (Constitution § Test Intent Comments; no change-ID citations). Run via `just test-e2e quake-terminal.spec` and `just test-e2e window-heading.spec` (the `.spec` suffix matters: the worktree path contains `quake-terminal`).

- **GIVEN** the two scoped e2e specs run in this worktree
- **THEN** every test passes

#### R17: Mobile is untouched
No file change SHALL alter the mobile arm: `QuakeTerminalTongue`, the seam listener's navigation arm, the operator route's `TerminalActivityTabs` gate, and the route compose strip's behavior are unchanged; the mobile Vitest and e2e groups pass without edits.

- **GIVEN** the `QuakeTerminal (mobile navigation)` and `QuakeTerminalTongue` Vitest groups and the e2e `mobile navigation` group
- **THEN** they pass unmodified

### Non-Goals

- Mobile: the navigation arm and the operator route's own compose strip stay the mobile input.
- The operator session's tmux status bar (parked — per-session `status off` would strip it from full tty views).
- Any change to the templated-vs-direct send fork, the chat-subject store, or the file paste/drop path.
- A `variant: "page"` prop on the drawer (Change 3) — the strip is authored as a sub-component the page variant can later mount, nothing more.
- Persisting the pin.

### Design Decisions

#### Compose docks in the drawer; the launcher is a launcher
**Decision**: at `open` the shared compose seam's one view is a strip at the drawer's bottom edge; the top-bar launcher collapses to glyph + chord and re-focuses the strip on click. The seam (`useOperatorCompose` and friends) is untouched.
**Why**: the eye line becomes prompt → compose → reply at the bottom, the idiom every terminal route already uses; the heading never loses its cell; Change 3's operator page mounts the same strip under the tty tile. Draft, flags, error, and the send fork are already module state, so only the view moves.
**Rejected**: keeping the compose in the top bar (input at top, reply at bottom); a second in-drawer compose with its own state (two drafts, two error surfaces — the original one-input rule's rejected fork).
*Introduced by*: 260912-m5lo-quake-terminal-docked-compose

#### Pin suspends click-away, not the other collapse paths
**Decision**: while pinned the outside-click listener is not attached; ⌘J, Esc, and ▼ still collapse.
**Why**: the click-away collapse is right for a peek and wrong for reading the operator while typing in the pane below; the deliberate collapse gestures keep working so a pinned drawer is never stuck.
**Rejected**: a pin that also disables Esc/chord (traps the user); a "hold" modifier on the click (undiscoverable, no keyboard path).
*Introduced by*: 260912-m5lo-quake-terminal-docked-compose

#### Pin is an ephemeral module slot reset at `rest`
**Decision**: pin state lives in `lib/quake-terminal.ts` beside the machine, is never persisted, and resets to `false` when the machine enters `rest`.
**Why**: the palette builder in the top-level layout must read it for its toggle label and the drawer unmounts at rest; a pin on a closed drawer is meaningless, so every open starts unpinned; Constitution IV forbids a storage write for ephemeral UI state.
**Rejected**: component `useState` in the drawer (unreadable from the palette); a localStorage key (Constitution IV; would surprise on the next open).
*Introduced by*: 260912-m5lo-quake-terminal-docked-compose

#### Esc in the docked textarea yields to the terminal only where a terminal exists
**Decision**: on the Operator Terminal segment Esc focuses the embedded terminal (preventing default so the drawer's listener skips it); on the list segments the event is left alone and the collapse rung fires.
**Why**: the first rung exists so a typed message can hand keystrokes to the TUI without collapsing; on Tasks / Cron List / Cron Log there is nothing to yield to and a dead keystroke is worse than collapsing.
**Rejected**: blur-to-body on list segments (dead key); collapsing on the first Esc everywhere (loses the yield).
*Introduced by*: 260912-m5lo-quake-terminal-docked-compose

#### Glass default 0.95
**Decision**: `QUAKE_OPACITY_DEFAULT` is 0.95; the setting and its 0.5–1.0 clamp stay.
**Why**: at 0.90 busy pane output bleeds under the reply text past its contrast floor; at 0.95 the glass still reads as an overlay.
**Rejected**: 1.0 (opaque — loses the overlay cue); a per-segment opacity (a second knob for the same surface).
*Introduced by*: 260912-m5lo-quake-terminal-docked-compose

### Deprecated Requirements

#### One input per form factor — the desktop drawer is output-only
**Reason**: the drawer now carries the compose while open; the one-input rule survives as one *seam*, not one *location*.
**Migration**: R1–R3 (the docked strip) and R6 (the collapsed launcher).

#### The launcher morph hides the center heading
**Reason**: the box never morphs into the center cell at `open`; the heading always stands.
**Migration**: R7.

#### The status line sits at the drawer's top edge
**Reason**: the status moves to the eye line above the docked textarea.
**Migration**: R3.

#### The title strip (`◉ OPERATOR · server · state · tick · ▼`) as a separate row
**Reason**: folded into the single header row; the strip's `◉ → operator` label names the addressee.
**Migration**: R9.

## Tasks

### Phase 1: Setup

- [x] T001 In `app/frontend/src/lib/quake-terminal.ts` add the pin slot (`getQuakePinned` / `setQuakePinned` / `useQuakePinned`), the engaged slot (`getQuakeComposeEngaged` / `setQuakeComposeEngaged` / `useQuakeComposeEngaged`), and the restore-origin slot (`setQuakeRestoreOrigin` / `takeQuakeRestoreOrigin`, holding `HTMLElement | null`) using the machine-state pub/sub idiom; make `setQuakeMachineState("rest")` reset pin and engaged to `false`; set `QUAKE_OPACITY_DEFAULT = 0.95` and fix the `useQuakeOpacity` doc comment (`0.5–1.0, default 0.95`); add tests in `lib/quake-terminal.test.ts` (pin default/notify/reset-on-rest, engaged notify/reset, origin round-trip, opacity default title `0.95`) <!-- R10, R4, R5, R14 -->
- [x] T002 [P] Export `OperatorStateGlyph` from `app/frontend/src/components/quake-launcher.tsx` (or move it to `components/operator-state-glyph.tsx` and import it in both consumers) so the strip's `◉ → operator` label carries the same dot; lift the bounded textarea auto-grow (`MAX_TEXTAREA_ROWS = 6` + the `scrollHeight` measure) out of `components/compose-strip.tsx` into `lib/textarea-autogrow.ts` (a small `useTextareaAutogrow(ref, text)` hook or `fitTextarea(el, maxRows)` helper) and make `compose-strip.tsx` consume it; run `just test-frontend` to confirm the compose-strip suite still passes <!-- R1, R2 -->

### Phase 2: Core Implementation

- [x] T003 In `app/frontend/src/components/quake-terminal.tsx` add a `QuakeCompose` sub-component (same file, below `QuakeTerminal`) rendering the strip per R1–R3: wrapper `data-testid="quake-terminal-compose"` `border-t border-border shrink-0`; the status line (moved verbatim from the top-edge row, same predicate and test ids); the header row (`◉ → operator` via `OperatorStateGlyph` with `data-testid="quake-terminal-compose-state"`, `<OperatorContextChip server compact />`, the hints `Enter sends · ⇧Enter newline · Esc back to terminal`); the textarea (`data-testid="quake-terminal-compose-input"`, `aria-label="Ask the operator"`, `rows={1}`, `placeholder="Ask the operator…"`, `value`/`onChange` on the shared store, `classifyComposeEnter` for Enter/⇧Enter, `sendOperatorMessage` on submit with focus retained, the auto-grow hook from T002); `onFocus`/`onBlur` publish `setQuakeComposeEngaged` with the within-wrapper `relatedTarget` carve-out; the textarea carries `border-accent-green` while engaged else `border-border`. Props: `server`, `target`, `segment`, and a `focusTerminal()` callback <!-- R1, R2, R3, R4 -->
- [x] T004 In `quake-terminal.tsx` mount `<QuakeCompose>` as the drawer's last flex child before the grips; delete the top-edge status row; fold the title strip and `<QuakeSegments>` into one `data-testid="quake-terminal-header"` row per R9 (segments left `shrink-0`; `ml-auto` meta cluster `min-w-0 truncate whitespace-nowrap` with picker/server · state · tick; pin button per R11 with `useQuakePinned`/`setQuakePinned`; ▼ button unchanged); drop the `◉ OPERATOR` text; fix the `default 0.90` doc comment near the glass constant <!-- R9, R11, R14 -->
- [x] T005 In `quake-terminal.tsx` gate the outside-click capture-listener effect on `pinned` (`if (machine !== "open" || pinned) return;`, `pinned` in the deps) and update its rationale comment; confirm the chord/Esc/▼ paths are untouched <!-- R12 -->
- [x] T006 In `quake-terminal.tsx` add the Esc first rung inside `QuakeCompose`'s `onKeyDown`: on `Escape` when `segment === "terminal"`, `e.preventDefault()` and call `focusTerminal()` (implemented in `QuakeTerminal` by focusing the `TerminalClient`'s xterm textarea inside `rootRef` — `rootRef.current?.querySelector(".xterm-helper-textarea")` or the client's exposed focus handle, whichever the existing `TerminalClient` API supports); on other segments do nothing so the document listener collapses <!-- R8 -->
- [x] T007 Relocate focus-on-open and the two invariants: in `quake-terminal.tsx` add a machine-follower effect that on `rest → open` (drawer mounted) focuses the docked textarea with the caret at the end, and on `open → rest` (before `finishClose` unmounts — the effect keyed on `machine`, not on `rendered`) runs the ownership-gated return: if `isQuakeTerminalTarget(document.activeElement)` then blur it and focus the origin from `takeQuakeRestoreOrigin()` if `isConnected`; in `quake-launcher.tsx` keep only the entry capture (on `rest → open`, `setQuakeRestoreOrigin(origin)` where `origin` is `document.activeElement` when `!isQuakeTerminalTarget(origin)` else `null`) and delete its focus/select/blur/restore lines; keep `onFocus → open` on the standing input <!-- R5 -->
- [x] T008 In `app/frontend/src/components/quake-launcher.tsx` render the collapsed control at `open` per R6 (`data-testid="quake-launcher-collapsed"`, `aria-label="Focus quake terminal compose"`, `OperatorStateGlyph` + chord `<kbd>`, `h-[28px] rounded border px-1.5`, `border-accent-green` while `useQuakeComposeEngaged()` else `border-border`, click → focus `[data-testid="quake-terminal-compose-input"]` via `document.querySelector` or a lib-registered ref); render it in place of the standing box at ≥lg and of the ghost at md–lg; remove the `boxFocused` state, the `engaged`/`w-[34ch]` width and the launcher-mounted `OperatorContextChip`; keep the rest rungs, placeholders, `onFocus → open`, Enter send from the standing box, paste handling, and the `data-quake-terminal` wrapper; rewrite the component doc block <!-- R6, R4 --> <!-- rework: collapsed control lacks the data-quake-terminal marker; its click is treated as an outside click and the settle collapses the drawer (review must-fix) -->
- [x] T009 In `app/frontend/src/components/top-bar.tsx` remove `launcherMorphed` (the `useQuakeMachineState` read and the `hidden lg:flex` class on the center anchor div) and rewrite the comment above it; keep the ≥lg prefix compaction <!-- R7 -->
- [x] T010 In `app/frontend/src/lib/palette/quake-terminal.ts` add `buildQuakeTerminalPinAction(pinned)` per R13; in `app/frontend/src/hooks/use-global-palette-actions.ts` read `useQuakeMachineState()` + `useQuakePinned()` and include the pin entry only while the desktop machine is `open` (place it after the reset-size entry); add builder tests in `lib/palette/quake-terminal.test.ts` (label toggle, `onSelect` flips the slot) <!-- R13 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Update `app/frontend/src/components/quake-terminal.test.tsx`: replace the output-only test with strip-renders-only-at-open; retarget the top-edge error/status tests to the strip; add Enter-sends-once-focus-retained, ⇧Enter newline, empty-Enter no-op, Esc first rung (terminal segment) vs. collapse (Cron List), one header row without `◉ OPERATOR` (retarget the title-strip state/tick tests), pin `aria-pressed` toggle, pinned outside click holds / unpinned collapses, chord + ▼ collapse while pinned, pin resets on re-open, engaged border toggles, and the jsdom-provable focus-invariant cases <!-- R1, R2, R3, R4, R8, R9, R10, R11, R12, R15 -->
- [x] T012 [P] Update `app/frontend/src/components/quake-launcher.test.tsx`: collapsed control at `open` at both rungs (box/ghost absent), click re-focuses the textarea (render a stub `[data-testid="quake-terminal-compose-input"]` in the test DOM), chord-from-rest captures the origin into the slot, Enter from the standing box still sends and opens, rest rungs unchanged; move the templated-chat-lane chip assertions to `quake-terminal.test.tsx`'s strip mount <!-- R6, R5, R15 --> <!-- rework: extend the collapsed-control click test to assert the machine is still open past the settle window -->
- [x] T013 [P] Add to `app/frontend/src/components/top-bar.test.tsx` a test that the center heading is visible on desktop with the machine at `open` (set `setQuakeMachineState("open")`, assert the heading anchor has no `hidden` class) <!-- R7, R15 -->
- [x] T014 Update `app/frontend/tests/e2e/quake-terminal.spec.ts`: rewrite the file header for the docked contract; replace the `launcherInput` helper with `composeInput = (page) => page.getByTestId("quake-terminal-compose-input")` and retarget every `open`-time fill; rewrite the md–lg test (ghost click opens, heading stays, collapsed glyph renders, Esc restores the ghost); add tests: Enter from the strip sends once; outside click collapses unpinned and holds pinned; heading visible while open at ≥lg; collapsed launcher click re-focuses the textarea; update every touched test's Proves/Steps JSDoc <!-- R16 --> <!-- rework: extend the e2e collapsed-launcher test to assert the drawer stays open past the settle window -->
- [x] T015 [P] Add to `app/frontend/tests/e2e/window-heading.spec.ts` a test proving the `Tab: <name>` heading stays visible after ⌘J opens the drawer (≥lg and md–lg), with its Proves/Steps JSDoc <!-- R7, R16 -->
- [x] T016 Verification gate: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e quake-terminal.spec`; `just test-e2e window-heading.spec` — fix failures at the root cause; confirm the mobile Vitest/e2e groups pass unmodified <!-- R15, R16, R17 -->

## Execution Order

- T001 and T002 first (both Phase 2 and Phase 3 depend on the slots and the shared glyph/autogrow)
- T003 → T004 → T005/T006/T007 (all edit `quake-terminal.tsx`; sequential in one file)
- T007 and T008 both touch the launcher's focus effect — do T007 before T008
- T011 after T003–T007; T012 after T008; T013 after T009; T014/T015 after everything in Phase 2
- T016 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `quake-terminal-compose` renders inside the drawer at `open` with header row, chip mount, hints, and textarea, and is absent at `rest`
- [x] A-002 R2: the textarea is bound to the shared store; Enter submits once with focus retained; ⇧Enter inserts a newline; empty Enter is a no-op; auto-grow is bounded at 6 rows via the shared helper
- [x] A-003 R3: the status line renders inside the strip above the header row and the top-edge status row is gone
- [x] A-004 R4: one module-slot `engaged` flag drives the textarea and collapsed-launcher accent borders, with the within-strip blur carve-out
- [x] A-005 R5: entering `open` focuses the docked textarea; invariant (a) uses `isQuakeTerminalTarget`; invariant (b) runs while the drawer is still mounted and never steals focus the user moved
- [x] A-006 R6: the launcher renders the collapsed control at `open` at ≥lg and md–lg, nothing below md, and its click focuses the textarea — rework verified: the collapsed button now carries `data-quake-terminal` (quake-launcher.tsx:171) so the outside-click capture listener stands down on it (`isQuakeTerminalTarget`), and its click re-asserts `setQuakeMachineState("open")`, bumping the activity counter the settle check honors; the unit test (`quake-launcher.test.tsx` — "never reads as an outside click") and the e2e ("the collapsed launcher re-focuses the docked compose and holds the drawer open") both assert the machine is still `open` past the settle window, and the unpinned outside-click collapse itself is re-verified green (unit twin + e2e pin test)
- [x] A-007 R7: `launcherMorphed` is removed and the heading is visible at `open` at every width
- [x] A-008 R8: Esc in the textarea focuses the terminal on the terminal segment and collapses on the other segments
- [x] A-009 R9: one header row with segments left and picker/server · state · tick · pin · ▼ right; `◉ OPERATOR` gone; `quake-terminal-state` / `-tick` semantics preserved
- [x] A-010 R10: pin slot exported, unpersisted, reset on `rest`
- [x] A-011 R11: pin button with `aria-pressed`, toggling labels, test id, green latch
- [x] A-012 R12: the outside-click listener is not attached while pinned; chord/Esc/▼ still collapse
- [x] A-013 R13: `buildQuakeTerminalPinAction` exists with the toggle label and is listed only while `open`
- [x] A-014 R14: `QUAKE_OPACITY_DEFAULT === 0.95`; both doc comments and the test title corrected

### Behavioral Correctness

- [x] A-015 R2: sending from the strip rides the same templated/direct fork as before (the chip toggles the lane) — no send-path change
- [x] A-016 R5: a mouse click into the standing box opens the drawer with focus landing in the textarea and no origin recorded
- [x] A-017 R12: pinned, a click into the page below leaves the drawer open and focus at the click target

### Removal Verification

- [x] A-018 R3: no `sending…`/error rendering remains at the drawer's top edge
- [x] A-019 R7: no `launcherMorphed` identifier or `hidden lg:flex` heading class remains in `top-bar.tsx`
- [x] A-020 R6: no `<input>`, `w-[34ch]`, `boxFocused`, or launcher-mounted `OperatorContextChip` renders at `open`
- [x] A-021 R9: no `◉ OPERATOR` text and no separate title-strip row remain

### Scenario Coverage

- [x] A-022 R15: the Vitest cases enumerated in R15 exist and pass (`just test-frontend`)
- [x] A-023 R16: `just test-e2e quake-terminal.spec` (38/38) and `just test-e2e window-heading.spec` (16/16) pass, with every touched `test()` carrying an updated Proves/Steps JSDoc and the quake spec header rewritten; the collapsed-launcher e2e now waits 250ms past the settle window with the drawer still open and the compose still focused (the A-006 rework's regression proof)
- [x] A-024 R17: the mobile Vitest groups and the e2e `mobile navigation` group pass without edits

### Edge Cases & Error Handling

- [x] A-025 R9: at the 420px width floor the segments, pin, and ▼ stay fully visible and the meta cluster truncates
- [x] A-026 R5: collapsing after the user clicked into the embedded terminal makes no focus call
- [x] A-027 R8: Esc inside the nested cron entry sheet still returns to the list without collapsing (stand-down unchanged)
- [x] A-028 R3: a failed send keeps the draft text and the error clears on the next edit

### Code Quality

- [x] A-029 Pattern consistency: new code follows the file's naming (`Quake*`, `quake-terminal-*` test ids), the machine-slot pub/sub idiom, and the Control-primitive vocabulary
- [x] A-030 No unnecessary duplication: `OperatorStateGlyph`, the auto-grow helper, and `classifyComposeEnter` are shared, not re-implemented
- [x] A-031 Type narrowing over assertions: no new `as` casts where a guard works
- [x] A-032 Comment discipline: no narration, no change-ID citations in code or test intent comments
- [x] A-033 No god functions: `QuakeCompose` is a focused sub-component; `QuakeTerminal` does not grow past its current shape by more than the strip mount, the header fold, and the focus effect
- [x] A-034 `npx tsc --noEmit` is clean

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without leaving redundant code behind; everything the plan retired (the launcher-local `boxFocused` state and `engaged` derivation, the `w-[34ch]` engaged width, the launcher-mounted `OperatorContextChip`, the drawer's top-edge status row, `top-bar.tsx`'s `launcherMorphed`, the `◉ OPERATOR` title strip, compose-strip's local `MAX_TEXTAREA_ROWS`, and the launcher's `boxRef`/`inputRef`/`restoreFocusRef` focus machinery superseded by the lib's restore-origin slot) is already removed in the diff. Re-evaluated on rework cycle 1: the rework only added the `data-quake-terminal` marker and the open re-assertion to the collapsed control — nothing further became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The `engaged` flag and the restore-origin ref are module slots in `lib/quake-terminal.ts`, not component state or a focusin derivation | The intake left the mechanism to apply; the machine slot is the file's idiom for cross-tree state and the palette already reads slots | S:60 R:85 A:75 D:65 |
| 2 | Confident | The strip is a `QuakeCompose` sub-component in `quake-terminal.tsx` (same file), taking `server`/`target`/`segment`/`focusTerminal` props | Keeps the drawer's one-file shape; Change 3 can lift it to its own file when the page variant needs it | S:55 R:90 A:80 D:70 |
| 3 | Confident | The auto-grow helper lives in `lib/textarea-autogrow.ts` and `compose-strip.tsx` consumes it | The intake asks to lift rather than duplicate; `lib/` holds the compose helpers | S:60 R:90 A:80 D:70 |
| 4 | Confident | The collapsed launcher focuses the textarea by querying `[data-testid="quake-terminal-compose-input"]` (or a lib-registered ref if the query proves brittle) | Two trees, one element; the test id is stable contract | S:50 R:90 A:70 D:65 |
| 5 | Confident | Focusing the embedded terminal uses the `TerminalClient`'s xterm helper textarea inside `rootRef` | The drawer already holds `rootRef` and the relay client; xterm's helper textarea is its focus target | S:50 R:85 A:65 D:60 |
| 6 | Certain | `setQuakeMachineState("rest")` is the single point that resets pin and engaged | Every collapse path funnels through it | S:80 R:90 A:90 D:90 |

6 assumptions (1 certain, 5 confident, 0 tentative).
