# Plan: Compose strip — collapse to a tongue instead of unmounting

**Change**: 260913-kl7u-compose-collapse-tongue
**Intake**: `intake.md`

## Requirements

### Compose Strip: Mount model

#### R1: The compose surface always mounts at its dock; the preference picks the form
The compose surface (expanded strip OR collapsed tongue) SHALL mount on every route that mounts `<Shell>`, at the dock the route/layout selects. `composeStripVisible` in `app.tsx` SHALL keep its name as the single mount seam with the meaning "the compose surface mounts here" and SHALL no longer depend on `composeStripEnabled`. `inTileDock` SHALL drop its `composeStripEnabled &&` term and keep every other term. The board footer mount SHALL be unconditional. `app.tsx` and `board-page.tsx` SHALL NOT read the preference to decide whether to mount; the expanded/collapsed fork lives inside the strip module.

- **GIVEN** the desktop terminal route with a tty tile and the preference off
- **WHEN** the route renders
- **THEN** the tongue renders inside the first tty tile's frame (via `ttyDockContent`) and no textarea exists

- **GIVEN** the board route with the preference off
- **WHEN** the route renders
- **THEN** the tongue renders in the shell footer directly above `<BottomBar>`

#### R2: The collapsed tongue (preference off)
When `composeStripEnabled` is false and the mount is not force-expanded, the module SHALL render a single-row tongue: a full-width `<button type="button">` (`data-testid="compose-tongue"`, `aria-label="Show compose strip"`, `aria-expanded={false}`) carrying the static `a▏` glyph (never `rk-compose-caret`), the literal label `Compose`, and — on fine pointers only — a trailing `<kbd>` with the platform-resolved `compose-toggle` chord from `chordHintFor("compose-toggle", bindings, host.platform)`; the `<kbd>` SHALL be omitted when the chord resolves undefined. Click SHALL call `toggleComposeStrip()`; mousedown SHALL `preventDefault()` (the `preventFocusSteal` convention). The tongue root SHALL carry `data-testid="compose-strip"` and the production `data-compose-strip` marker and SHALL render inside the same dock-seam wrapper the expanded body uses.

- **GIVEN** the preference off and a focused terminal, fine pointer
- **WHEN** the tongue renders
- **THEN** its text contains `Compose` and a `<kbd>` whose text equals the chord the status-bar Tip shows (`⌘I` on mac, `⇧Ctrl+E` elsewhere)

- **GIVEN** the tongue on a coarse pointer
- **WHEN** it renders
- **THEN** no `<kbd>` is present and the row height is ≤ 36px

- **GIVEN** the tongue
- **WHEN** the user clicks it
- **THEN** the preference flips on, the expanded body mounts, its textarea has focus, and the target's saved draft is restored

#### R3: The no-target tongue (preference on, no target, not force-expanded)
When the preference is on, no force-expand applies, and `hasTarget` is false (`focused === null` and no selection target), the module SHALL render an inert single-row tongue (`role="status"`, `data-testid="compose-tongue"`, `data-state="no-target"`, not a button) reading the exact copy `No focused terminal — click a pane to target it`, with the static `a▏` glyph and no `<kbd>`. The copy SHALL be a module-level constant shared with the expanded body's placeholder so the two cannot drift. Selection-broadcast mode counts as having a target and SHALL be unaffected.

- **GIVEN** the board route with no pane selected and the preference on
- **WHEN** the footer renders
- **THEN** the no-target tongue shows and no textarea, 📎, Send, or `→ no target` header exists

- **GIVEN** the no-target tongue
- **WHEN** a pane is selected (a focused terminal registers)
- **THEN** the expanded strip replaces it

#### R4: Operator-page force-expand
The shared element built in `app.tsx` SHALL pass `forceExpanded={operatorPage}`; the board mount and the in-tile dock never pass it. With `forceExpanded` true the module SHALL render the expanded body regardless of the preference and of `hasTarget` (the body's existing disabled no-target form remains reachable there). The on-strip closers keep calling `toggleComposeStrip()` and flip the preference exactly as today.

- **GIVEN** the operator page and the preference off
- **WHEN** the footer renders
- **THEN** the expanded strip renders (no tongue)

#### R5: Closers collapse to the tongue; openers unchanged
The `a|` closer (`compose-strip-a-close`), the header × (`compose-strip-close`), the chord's on+focused arm, and both `a▏` chips SHALL land on the collapsed tongue rather than an empty dock, with no code change to the closers themselves. The status-bar `a▏` chip, bottom-bar `a▏` chip, `View: Text Input` palette action, `Compose: Focus`, and the `compose-toggle` chord body SHALL be unchanged. Escape in the textarea SHALL keep its blur-to-terminal semantics and never collapse. A draft typed before collapsing SHALL be restored on re-expansion (module draft store).

- **GIVEN** the expanded strip with text typed, fine pointer
- **WHEN** the user clicks the `a|` closer
- **THEN** the tongue shows; clicking it re-expands the strip with the same text

#### R6: Paste/drop while collapsed expands and uploads
With the tongue mounted (body unmounted), a file paste/drop forwarded by `terminal-client.tsx`'s unchanged `attachToStrip` SHALL expand the strip and upload the files: the queued attachments SHALL be drained when the expanded body mounts, and one path line per file SHALL land in the textarea.

- **GIVEN** the preference off and a focused terminal
- **WHEN** a `paste` event with a `File` reaches the document (outside the quake terminal)
- **THEN** the strip expands, `compose-strip-uploading` appears then clears, and a path line lands in the textarea

#### R7: Vertical budget and coarse placement
Both tongue forms SHALL be one compact row: `text-xs leading-none` inside the seam wrapper's `py-1` (≈24–26px on fine pointers) and `coarse:min-h-[36px]` on coarse — never taller than the compact row's chips. On coarse pointers the tongue renders at the footer dock directly above the bottom bar (whose `a▏` chip stays); BottomBar's own gate is untouched; no horizontal overflow at 375px.

- **GIVEN** the coarse describe (375×812, `hasTouch`)
- **WHEN** the preference is off
- **THEN** the tongue renders above the bottom bar, its height ≤ 36px, the page does not scroll horizontally, and the bottom bar is still present

#### R8: The mount-keyed seams keep working unchanged
The expanded body SHALL unmount while a tongue shows, so the mount-time attach drain, the focus-on-open consume, the focuser registration (`focusComposeStrip()` returns `false` while collapsed), the `setComposeStripFocused(false)` unmount reset, and the blob-URL revoke keep working byte-for-byte. `chrome-context.tsx`, `terminal-client.tsx`, `status-bar.tsx`, `bottom-bar.tsx`, `surface-layout.tsx`, `compose-draft-store.ts`, and `compose-strip-events.ts` SHALL be unchanged (a constant home for the copy MAY live in the strip module).

- **GIVEN** the tongue is showing
- **WHEN** `focusComposeStrip()` is called
- **THEN** it returns `false` and the caller's fallback fires

### Non-Goals
- Flipping the preference default, the first-render toast, focus on fresh navigation, the `View: Text Input` → `Compose` palette rename, the `Esc → terminal` placeholder hint — the `compose-default-on` follow-up.
- Retiring the status-bar `a▏` chip or suppressing the coarse footer tongue while the bottom-bar chip is visible — deferred to the follow-up with device screenshots.
- Any change to Enter semantics, send modes, drafts, uploads, focus-ownership recording, or zen behavior.
- The Host page `/` (no Shell) — no tongue.

### Design Decisions

#### Collapse, don't hide
**Decision**: The compose preference's off state renders a one-row tongue at the strip's own dock instead of unmounting the surface; the no-target state is a tongue too.
**Why**: Discoverability lives where the surface lived. Every re-open affordance today is relocated (status-bar chip at `xl+`, hover-only chord, bottom-bar chip on coarse only, a palette entry with a different name). The default-on follow-up makes dismissal common, so an in-place cue with the chord is the prerequisite. The disabled no-target card was a row of dead controls carrying one sentence of information.
**Rejected**: Replacing the `a▏` glyph with chord text (loses identity, no chord on coarse, `⇧Ctrl+E` is long, the glyph carries `aria-pressed` on the chips); relying on the status-bar Tip (hover-only, `xl+`, fine only); an Escape-collapses rung (Esc must reach the pane); reusing `quake-launcher.tsx` (a top-bar component with its own machine — reuse the glyph+`<kbd>` pattern).
*Introduced by*: 260913-kl7u-compose-collapse-tongue

#### The body unmounts behind the tongue
**Decision**: `ComposeStrip` becomes a thin wrapper choosing between a tongue and the existing body (`ComposeStripExpanded`); the body unmounts while a tongue shows.
**Why**: Every mount-keyed seam (attach drain, focus-on-open consume, focuser registration, focused-signal reset, blob revoke) then works unchanged — paste-while-collapsed and focus-on-open need zero seam changes. An early-return fork inside the body would break the Rules of Hooks; keeping the body mounted behind the tongue would re-key all of those seams on the enabled transition.
**Rejected**: Single-component early return; hidden-but-mounted body.
*Introduced by*: 260913-kl7u-compose-collapse-tongue

#### Off wins over no-target; the no-target tongue is inert
**Decision**: Preference off ⇒ the interactive `Compose` tongue regardless of target. Only preference on + no target ⇒ the inert `role="status"` no-target tongue with no `<kbd>`.
**Why**: The label stays a truthful description of what a click does. A click on the no-target tongue could not produce an expanded strip, and a toggle with no visible effect is a confusing control; the preference stays reachable via chord, palette, and chips (Constitution V already met).
**Rejected**: No-target wins (hides the `Compose` label and chord on the board page until a pane is selected); a clickable no-target tongue.
*Introduced by*: 260913-kl7u-compose-collapse-tongue

## Tasks

### Phase 2: Core Implementation

- [x] T001 <!-- rework: review cycle 2 — file-header comment still described the caller-gated mount; also hoist preventFocusSteal to module scope --> In `app/frontend/src/components/compose-strip.tsx`: hoist the no-target copy to a module-level `NO_TARGET_COPY` constant used by the placeholder; rename the existing component body to `ComposeStripExpanded` (same props + `forceExpanded` is NOT needed inside the body); add a new exported `ComposeStrip` wrapper taking the existing props plus `forceExpanded?: boolean` that reads `useChromeState().composeStripEnabled` and `useFocusedTerminal().focused`, computes `hasTarget`, and renders per the decision table (forceExpanded → body; off → `CollapsedTongue`; on+no target → `NoTargetTongue`; else body); implement both tongues in the same dock-seam wrapper (`data-testid="compose-strip"`, `data-compose-strip`, inner `border-t border-border bg-bg-primary px-1.5 py-1 flex items-center`), the collapsed tongue as a full-width `rk-glint` button with `a▏` + `Compose` + fine-pointer `<kbd>` via `useKeybindings()` + `chordHintFor`, `onMouseDown` preventDefault, `onClick={toggleComposeStrip}`, `aria-label="Show compose strip"`, `aria-expanded={false}`, `coarse:min-h-[36px]`; the no-target tongue as `role="status"` `data-state="no-target"` with `a▏` + `NO_TARGET_COPY`; update the file header comment. <!-- R1, R2, R3, R7, R8 -->
- [x] T002 In `app/frontend/src/app.tsx`: make `composeStripVisible` independent of `composeStripEnabled` (keep the name, comment the new "surface mounts here" semantics), drop the `composeStripEnabled &&` term from `inTileDock`, pass `forceExpanded={operatorPage}` on the shared `composeStripElement`; in `app/frontend/src/components/board/board-page.tsx` make the footer mount unconditional `<ComposeStrip />`; run `cd app/frontend && pnpm exec tsc --noEmit` (via `just` where a recipe exists) and fix any unused-variable fallout. <!-- R1, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Update `app/frontend/src/components/compose-strip.test.tsx`: convert the harnesses that mirror `{composeStripEnabled && <ComposeStrip />}` to unconditional mounts; rewrite the L203 "disabled no target" test to the inert no-target tongue (exact copy, no textarea/Send/📎, no button role); update the L1016 toggle-off/on draft test to assert the tongue instead of unmount; add tests: off + target ⇒ `Compose` tongue with `<kbd>` on fine pointer and none on coarse (drive the existing `stubMatchMedia`), no `compose-strip-input`, no `rk-compose-caret`; click ⇒ preference on, body mounts, textarea focused; on + selection target ⇒ broadcast card; `forceExpanded` + off ⇒ body; `a|` closer and header × ⇒ tongue with draft preserved; `focusComposeStrip()` returns false while collapsed; an attachment queued while collapsed drains when the body mounts. Run `just test-frontend`. <!-- R2, R3, R4, R5, R6, R8 -->
- [x] T004 <!-- rework: review cycle 1 — A-013 requires the BOARD route no-target tongue e2e (empty board ⇒ no-target tongue; pinning a pane ⇒ expanded strip); the /<server> route test stays as second-route coverage --> Update `app/frontend/tests/e2e/compose-strip.spec.ts`: header shared-setup paragraph; existing "strip gone after close" assertions (L166, L189, L243, L739, L796 and the footer L671/L682 cases) become "tongue shown" / textarea absent where the intent was "collapsed"; add tests with Proves/Steps JSDoc: tongue at the in-tile dock and the footer dock (board route) when off; click expands + focuses; `a|` collapses and the draft survives re-expansion; fine-pointer `<kbd>` text equals the status-bar Tip's chord; board page with no selected pane shows the no-target tongue and no disabled strip; file paste while collapsed expands + `compose-strip-uploading` + path line; coarse describe: tongue above the bottom bar, height ≤ 36px, no horizontal overflow, bottom bar present. Run `just test-e2e compose-strip.spec` (with `--list` first to confirm the filter). <!-- R1, R2, R3, R5, R6, R7 -->
- [x] T005 Sweep adjacent specs for assertions on an empty footer / tty-tile height / `compose-strip` count when the preference is off (`grep -ln 'compose-strip' app/frontend/tests/e2e/*.spec.ts`, plus `surface-layout`, `mobile-layout`, `bottom-bar`, `quake-terminal`, `operator-page`, `focus-restore`, `board*` specs) and update expectations to the tongue; confirm `control-gallery.spec.ts` baselines are untouched (no `controlClass` use on the tongue); run the affected specs via `just test-e2e <name>.spec` and `just test-frontend`. <!-- R1, R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `composeStripVisible` no longer reads `composeStripEnabled`; `inTileDock` has no `composeStripEnabled` term; the board footer mounts `<ComposeStrip />` unconditionally; no other app-level predicate reads the preference to decide mounting
- [x] A-002 R2: With the preference off the module renders a `compose-tongue` button with `a▏` (no `rk-compose-caret`), `Compose`, `aria-label="Show compose strip"`, `aria-expanded="false"`, inside a `compose-strip` root carrying `data-compose-strip`
- [x] A-003 R3: With the preference on and no target the module renders an inert `role="status"` tongue with the exact copy, `data-state="no-target"`, and no textarea/Send/📎/header; the copy is a single shared constant
- [x] A-004 R4: `forceExpanded={operatorPage}` is passed only by the `app.tsx` shared element and forces the expanded body regardless of preference and target
- [x] A-005 R6: A file paste while collapsed expands the strip and uploads (path line in the textarea) through the unchanged `attachToStrip` and the body's mount-time drain
- [x] A-006 R8: `chrome-context.tsx`, `terminal-client.tsx`, `status-bar.tsx`, `bottom-bar.tsx`, `surface-layout.tsx`, `compose-draft-store.ts`, `compose-strip-events.ts` have no diff

### Behavioral Correctness

- [x] A-007 R2: Clicking the tongue flips the preference on, mounts the body, focuses the textarea (focus-on-open path), and restores the target's draft
- [x] A-008 R5: The `a|` closer, header ×, and the chord's on+focused arm land on the tongue; the openers (both chips, palette entries, chord body) are byte-unchanged; Escape still blurs and never collapses
- [x] A-009 R2: The `<kbd>` text equals `chordHintFor("compose-toggle", …)` for the platform and is omitted on coarse pointers or when the chord is undefined
- [x] A-010 R3: Selection-broadcast mode still renders the frozen `→ N selected` card (a target)

### Scenario Coverage

- [x] A-011 R1: e2e proves the tongue at the in-tile dock (inside the first tty tile) and at the footer dock (board route)
- [x] A-012 R5: e2e proves collapse via `a|` then re-expansion restores the typed draft
- [x] A-013 R3: e2e proves the board page with no selected pane shows the no-target tongue and not a disabled strip, and that selecting/pinning a pane swaps in the expanded strip
- [x] A-014 R6: e2e proves paste-while-collapsed expands and uploads
- [x] A-015 R7: the coarse describe proves the tongue renders above the bottom bar with height ≤ 36px and no horizontal overflow

### Edge Cases & Error Handling

- [x] A-016 R8: `focusComposeStrip()` returns `false` while a tongue shows and every caller's fallback still fires (chord → plain toggle; ⌨ → terminal; restore router → `tty`)
- [x] A-017 R7: Both tongue forms are a single row not taller than the compact strip's chip row (fine ≈24–26px, coarse 36px floor)
- [x] A-018 R1: The Host page `/` renders no tongue; the operator page renders no tongue

### Code Quality

- [x] A-019 Pattern consistency: the tongue reuses the strip's `preventFocusSteal`, `rk-glint`, `text-text-secondary` vocabulary and the quake launcher's `<kbd>` classes; test ids follow the `compose-strip-*` family
- [x] A-020 No unnecessary duplication: the chord resolves through `chordHintFor` (no new formatter); the no-target copy is one constant; no second dock predicate
- [x] A-021 Type narrowing over assertions: no `as` casts introduced in the wrapper or tongues
- [x] A-022 Comment discipline: comments state constraints (why the body unmounts, why the tongue carries `data-compose-strip`), no narration, no change IDs
- [x] A-023 Tests: every new Playwright `test()` carries a Proves/Steps JSDoc; the spec header's shared-setup paragraph is current; all runs go through `just` recipes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The expanded body's `!hasTarget` disabled form (`compose-strip.tsx` `ComposeStripExpanded`) becomes unreachable on non-operator mounts but is deliberately retained for the `forceExpanded` operator-page path (plan `## Assumptions` #2) — retained, not a candidate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The wrapper reads `useChromeState()` for the preference rather than receiving it as a prop | Both mounts (app.tsx shared element, board footer) already sit under `ChromeProvider`; a prop would re-introduce the caller-side gating the change removes | S:80 R:90 A:85 D:80 |
| 2 | Confident | The `ComposeStripExpanded` body keeps its `!hasTarget` disabled form intact (reachable only under `forceExpanded`) | The operator page can be target-less under a non-terminal tab; stripping the branch would regress it | S:75 R:90 A:85 D:80 |
| 3 | Confident | The tongue's `<kbd>` uses `useKeybindings()` + `chordHintFor` directly in the strip module (no shared `chordFor` helper extracted) | Two existing call sites already inline the same two lines; extracting a third-site helper is a refactor outside this change's scope | S:70 R:95 A:80 D:75 |
| 4 | Tentative | Existing e2e assertions that read `compose-strip` count 0 after a close are reinterpreted as "textarea absent + tongue present"; assertions that meant "no strip anywhere on this route" (footer vs tile placement checks) are reinterpreted per their Proves comment | Each site is judged at T004/T005 against its intent comment; the review verifies no intent was silently changed | S:55 R:85 A:70 D:60 |
| 5 | Confident | The plan groups the work into 5 tasks (light lane, inline) | The change is one component fork plus two mount edits and two test files; each task is a coherent unit completable in one session | S:70 R:90 A:85 D:80 |

5 assumptions (0 certain, 4 confident, 1 tentative).
