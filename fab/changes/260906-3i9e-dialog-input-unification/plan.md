# Plan: Dialog & Input Unification

**Change**: 260906-3i9e-dialog-input-unification
**Intake**: `intake.md`

## Requirements

### Dialogs: Coarse contract adoption

#### R1: Dialogs adopt the coarse floors
Every dialog button MUST carry the wide-button floors — `min-h-[28px]` fine / `coarse:min-h-[40px]` coarse — and every dialog text input MUST carry `coarse:min-h-[40px]`. Sites: `sidebar/kill-dialog.tsx`, the board kill trio (`board/board-page.tsx` ~:1122-1141), `spawn-agent-dialog.tsx`, `create-session-dialog.tsx`, `server-dialogs.tsx`, `host-form-dialog.tsx`, `session-name-prompt.tsx`, `window-note-prompt.tsx`, `operator-compose-dialog.tsx`. Size literals live in shared constants with lockstep comments naming the `--ctl-h-bar`/`--ctl-h-bar-coarse` tokens (the `COARSE_POINTER_QUERY` convention). Fine sizes are unchanged.

- **GIVEN** a coarse-pointer viewport (`pointer: coarse`)
- **WHEN** any dialog renders (kill confirm, create-session, host-form, prompts, operator-compose)
- **THEN** every button and text input in it has a rendered min-height of 40px
- **AND** on fine pointers the rendered sizes are unchanged from today

### Dialogs: Shared confirm pair

#### R2: One confirm-button pair on `signal-red`
A shared confirm-button pair SHALL be exported from `components/controls.ts` — a neutral arm (the `border-border … hover:border-text-secondary` recipe) and a danger arm on the `signal-red` token (replacing raw `red-900/*`) — both carrying R1's floors. `sidebar/kill-dialog.tsx` (:32/:38), the board kill trio (`board/board-page.tsx:1125-1137` — "Unpin instead"/"Cancel" take the neutral arm, "Kill" the danger arm), and `server-dialogs.tsx`'s kill button (:332) MUST consume it; the drifted `text-sm` divergence disappears with the dedup. No `red-900` literal remains on a dialog confirm button.

- **GIVEN** the sidebar kill dialog and the board kill dialog
- **WHEN** their class strings are compared
- **THEN** both compose the same exported constants (no re-typed pair), and the danger arm's hue is `signal-red`

### Inputs: One live-input focus treatment

#### R3: `focus:border-accent-green` is the single input focus idiom
All text inputs SHALL use ONE live-input focus treatment: `focus:border-accent-green` (green per the color algebra — scheme C; interaction typing focus is the keyboard analogue of the green state family). This MUST replace: `focus:border-accent` (`compose-strip.tsx:1011` and the `focus-within:border-accent` chip wrapper at :1274, `host-form-dialog.tsx:113/:126`, `settings-shortcuts-panel.tsx:706/:973/:1003`), `focus:border-text-secondary` (`text-setting-core.tsx:63`, `iframe-window.tsx:1469`, `find-bar.tsx:78`, `settings-all-panel.tsx:136/:404`, `theme-picker-list.tsx:257`, `sidebar/pin-popover.tsx:227`), and the omnibox active border `border-accent-green/60` (`operator-omnibox.tsx:149` — normalizes onto the same treatment). The naked `outline-none` inputs with no focus treatment MUST gain it: the palette input (`command-palette.tsx`), inline renames (`top-bar.tsx:2044` — its static `border-b border-accent` edit border goes green — and the sidebar session/window row renames), dialog fields (`spawn-agent-dialog.tsx`, `create-session-dialog.tsx`, `server-dialogs.tsx`, `session-name-prompt.tsx`, `window-note-prompt.tsx`, `operator-compose-dialog.tsx`), the operator console input. Buttons/rows in those files are covered by the global ring and are out of scope. Inputs REMAIN excluded from the global `:focus-visible` ring — border is the input idiom (slice-1 decision; the `globals.css` ring selector is not touched).

- **GIVEN** any text input in `src/components`
- **WHEN** it receives keyboard focus
- **THEN** its border turns `accent-green` (and no other focus border color exists in the control layer)
- **AND** `grep -rn "focus:border-accent[^-]\|focus:border-text-secondary" src/components` returns zero input sites

#### R4: Palette input does not flash on open
The command palette's autofocused input MUST NOT visibly flash its border treatment on palette open (the green border may appear immediately with focus — a steady state, not a transient flash from a transition racing autofocus).

- **GIVEN** the command palette is opened via ⌘K
- **WHEN** the input autofocuses
- **THEN** the border settles directly to its focus state without a visible transition flash

### Dialogs: Disabled sweep

#### R5: One disabled recipe on dialog/panel buttons
The remaining `disabled:opacity-50`/`opacity-60` stragglers on dialog/panel buttons SHALL adopt the unified disabled recipe — `disabled:opacity-40 disabled:cursor-not-allowed` + hover-neutralized (the shipped `MENU_ROW_DISABLED` spelling, adapted to each site's hover utilities). Verified sites: `host-form-dialog.tsx:145`, `session-name-prompt.tsx:75`, `server-dialogs.tsx:196/:332`, `operator-compose-dialog.tsx:113`, plus dialog-family buttons surfaced while editing under R1/R2. `window-note-prompt.tsx:47` MUST gain its missing disabled state, adopting its session-name twin's recipe (disable condition follows note-prompt semantics — empty input is a valid clear-submit, so the disabled state guards in-flight submit, not emptiness). Non-dialog stragglers (top-bar segments, iframe toolbar) are touched only where already in scope of R1–R3 edits.

- **GIVEN** a disabled dialog button
- **WHEN** it renders and is hovered
- **THEN** it shows `opacity-40` + `cursor-not-allowed` and its hover styling is neutralized

### Control layer: Blue retirement

#### R6: No control-layer `accent` blue remains
After this change, `grep -rn "accent[^-]" src/components` over **control styling** MUST hit nothing: no interactive control (button, input, edit/focus/focus-within border, selection fill) carries `accent` blue. This includes `host-form-dialog.tsx:145` (`border-accent text-accent` Connect button → neutral arm). Exempt by design: links and toast action links, status-bar clickability hover-reveals on text values, status/data-viz hues; `docs/wiki/control-state-audit.html` classifies any ambiguous hit.

- **GIVEN** the completed change
- **WHEN** `grep -rn "accent[^-]" app/frontend/src/components` is run and each hit is classified against the audit
- **THEN** zero hits are control styling; every remaining hit is a link, hover-reveal, or status/data-viz use

### Tests: Sweep both layers

#### R7: Test and intent-comment conformance
Unit tests asserting dialog/input classes (`*.test.tsx`) and e2e specs asserting the touched surfaces MUST be updated to the new vocabulary in the same edit; tests conform to the spec (constitution Test Integrity). Playwright intent comments are updated where a test's Steps/Proves change; no change-ID citations in code comments.

- **GIVEN** the changed surfaces
- **WHEN** `npx tsc --noEmit`, the affected unit suites, and scoped e2e specs run
- **THEN** all pass, and no test still asserts a retired class (`red-900`, `focus:border-accent`, old opacity values) on a touched surface

### Non-Goals

- The `Control` primitive + gallery route (slice 7).
- Menus/popovers and sidebar rows (slices 4–5, shipped).
- A whole-app opacity/disabled sweep beyond dialog/panel buttons.
- Any behavior change — handlers, focus management, and dialog logic are untouched.
- The global `:focus-visible` ring selector in `globals.css` (inputs stay excluded; no edit).

### Design Decisions

#### Green live-input focus border
**Decision**: One input focus treatment: `focus:border-accent-green`, replacing `accent` blue, `text-secondary`, and `accent-green/60`.
**Why**: Color algebra (scheme C): green = state; a focused live input is the keyboard's "armed" state. Retires the last input-layer blue.
**Rejected**: `focus:border-text-secondary` (neutral) — indistinguishable from plain hover-brightness vocabulary; keeping blue — leaves two interaction hues permanently.
*Introduced by*: 260906-3i9e-dialog-input-unification

#### Confirm danger arm on `signal-red`
**Decision**: The shared confirm pair's danger arm uses the `signal-red` token (`--color-signal-red`), not raw `red-900/*`.
**Why**: Signal hues = status per the algebra; the flyout danger rows already use `signal-red`, so this converges on one destructive hue token that themes correctly.
**Rejected**: keeping `red-900` literals — untokenized, drifted (`text-sm` divergence proved re-typing drifts), invisible to theme derivation.
*Introduced by*: 260906-3i9e-dialog-input-unification

#### Bounded disabled sweep
**Decision**: The disabled sweep covers dialog/panel buttons only; non-dialog stragglers move only when already touched by R1–R3 edits.
**Why**: Slice sequencing — slice 7's primitive migration is the whole-app pass; widening here would conflict with the ladder.
**Rejected**: app-wide sweep — churns surfaces slice 7 re-touches anyway.
*Introduced by*: 260906-3i9e-dialog-input-unification

## Tasks

### Phase 1: Setup

- [x] T001 Add shared constants to `app/frontend/src/components/controls.ts`: `WIDE_BTN_BASE` (dialog wide-button geometry: `min-h-[28px] coarse:min-h-[40px]`, lockstep comment naming `--ctl-h-bar`/`--ctl-h-bar-coarse`), `INPUT_COARSE` (input coarse floor `coarse:min-h-[40px]`), `INPUT_FOCUS` (the one live-input treatment `outline-none focus:border-accent-green`), `CONFIRM_NEUTRAL` (neutral confirm arm: border-border rounded hover:border-text-secondary + WIDE floors + unified disabled tokens), `CONFIRM_DANGER` (danger arm on `signal-red`: e.g. `bg-signal-red/20 border border-signal-red rounded hover:bg-signal-red/35` + floors + disabled tokens — exact alpha steps chosen to visually match the current red-900 weight in both themes), with doc comments matching the file's voice <!-- R1 R2 R3 -->

### Phase 2: Core Implementation

- [x] T002 Consume the confirm pair: `src/components/sidebar/kill-dialog.tsx` (:32/:38), `src/components/board/board-page.tsx` kill trio (:1125-1137), `src/components/server-dialogs.tsx` kill button (:332) — no `red-900` literal remains on dialog buttons; drifted `text-sm` divergence resolved by the shared constant <!-- R2 -->
- [x] T003 Dialog coarse adoption — buttons onto `WIDE_BTN_BASE`-composed recipes and inputs onto `INPUT_COARSE` in: `spawn-agent-dialog.tsx`, `create-session-dialog.tsx`, `server-dialogs.tsx`, `host-form-dialog.tsx`, `session-name-prompt.tsx`, `window-note-prompt.tsx`, `operator-compose-dialog.tsx` (kill dialogs covered by T002) <!-- R1 -->
- [x] T004 [P] Migrate the three existing focus colors to `INPUT_FOCUS`: `compose-strip.tsx:1011` + focus-within chip wrapper :1274, `host-form-dialog.tsx:113/:126`, `settings-shortcuts-panel.tsx:706/:973/:1003`, `text-setting-core.tsx:63`, `iframe-window.tsx:1469`, `find-bar.tsx:78`, `settings-all-panel.tsx:136/:404`, `theme-picker-list.tsx:257`, `sidebar/pin-popover.tsx:227` (also its stray `focus:` idiom), `operator-omnibox.tsx:149` (active border normalizes onto focus-driven green) <!-- R3 -->
- [x] T005 [P] Give the naked `outline-none` inputs the same treatment: `command-palette.tsx` palette input, `top-bar.tsx:2044` inline window-rename (edit border `border-accent` → green), sidebar `session-row.tsx`/`window-row.tsx` inline renames, `operator-console.tsx` input, dialog fields in `spawn-agent-dialog.tsx`/`create-session-dialog.tsx`/`server-dialogs.tsx`/`session-name-prompt.tsx`/`window-note-prompt.tsx`/`operator-compose-dialog.tsx` — text inputs only; buttons/rows stay on the global ring <!-- R3 -->
- [x] T006 Disabled sweep: unify dialog/panel button disabled states onto the `opacity-40 + cursor-not-allowed + hover-neutralized` spelling (`host-form-dialog.tsx:145`, `session-name-prompt.tsx:75`, `server-dialogs.tsx:196/:332`, `operator-compose-dialog.tsx:113`, plus dialog buttons touched in T002/T003); add the missing disabled state to `window-note-prompt.tsx:47` per its session-name twin (guarding in-flight submit — empty stays a valid clear) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Blue-retirement sweep: run `grep -rn "accent[^-]" src/components`, classify each hit (control vs link/hover-reveal/status per `docs/wiki/control-state-audit.html`), migrate remaining control-layer hits — includes `host-form-dialog.tsx:145` (`border-accent text-accent` Connect button → neutral confirm arm); record the final classification of surviving hits in the task notes <!-- R6 -->
  - Migrated beyond the named sites: system-card Restart/View blue hovers → neutral; per-site `focus-visible:outline-accent` (dead under the unlayered global green ring) → `outline-accent-green` (status-bar ×6, kbd-chip KBD_BASE, bottom-bar FN_ITEM_BASE); zen-exit chip → green-lit (zen-active is the state it marks); settings tab selected fill → `bg-accent-green/15`; host-menu active row → `text-accent-green`; pin-popover pinned ✓ → `text-accent-green` (the shipped check idiom); board-pane focused border/ring → green, resize-handle hover → brightness; native `accent-accent` (spawn radios, opacity slider) → `accent-accent-green`.
  - Surviving hits, classified exempt: links/nav (board-page Home link, settings-dialog entries link, toast action link, pin-popover "Go to" nav row); status-bar/status-panel clickability hover-reveals on text values; status/data-viz (host-metrics sparkline, session-tiles fabStage badge, shortcuts-panel scope/custom/legend/modified-dot, all-panel modified dot, status-panel refresh-done ✓, board pagination dots); the instance-accent system (per-instance custom color — titlebar-strip, accent-reporter, settings-registry-seam, host-panel, swatch-popover, guarded server tints in sidebar/index); transient drop-target affordances (terminal-client dragOver ring, sidebar/boards drop lines — not in R6's control enumeration); sidebar-row selection rings (slice-5 surface, Non-Goal).
- [x] T008 Test sweep: update unit tests asserting touched dialog/input classes (`*.test.tsx` colocated with edited components) and e2e specs asserting those surfaces; update Playwright intent comments where behavior-under-test descriptions change; verify no test asserts `red-900`/`focus:border-accent`/retired opacity values on touched surfaces <!-- R7 -->
  - No unit test asserted a retired class on a touched surface (swept); added a window-note-prompt in-flight-disable test (new behavior); updated `shell-rotation.spec.ts` assertions + intent comments to the `border-accent-green` focused-pane vocabulary (the one e2e spec asserting a touched class).
- [x] T009 Verify palette-open flash: confirm the autofocused palette input settles directly into the green border (no transition racing autofocus — drop/scope `transition-colors` on the border if it flashes) <!-- R4 -->
  - Verified statically: the palette input carries no `transition-colors` (and globals.css has no border transition rule), so the focus border applies instantly on focus-trap mount focus — a steady state, no race.

### Phase 4: Polish

- [x] T010 Verification gate: `npx tsc --noEmit` (app/frontend), affected unit suites (scoped `just test-frontend` filters for edited components), scoped e2e specs for changed surfaces via `just test-e2e "<spec>"` — full suite is NOT run (standing directive 2026-09-03) <!-- R7 -->
  - tsc clean; full Vitest run green (185 files / 3781 tests — superset of the affected suites); scoped e2e green: 57/57 across shell-rotation, protected-kill-confirm, session-name-prompt, spawn-agent, operator-compose, settings-dialog, status-bar, zen-mode, host-system-card, board-close-and-unpin, create-server-waiting, compose-strip.

## Execution Order

- T001 blocks T002–T005 (constants first)
- T004/T005 are parallel (disjoint file sets except dialogs — T003 lands before or with T005's dialog-field edits)
- T007 runs after T002–T006 (it verifies their residue)
- T008–T010 close out

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every listed dialog's buttons render ≥40px min-height under `pointer: coarse` and inputs carry `coarse:min-h-[40px]`; fine sizes unchanged
- [x] A-002 R2: `CONFIRM_NEUTRAL`/`CONFIRM_DANGER` exported from `controls.ts` and consumed at kill-dialog, board kill trio, and server-dialogs kill; zero `red-900` literals on dialog buttons
- [x] A-003 R3: One input focus idiom — `grep -rn "focus:border-accent[^-]\|focus:border-text-secondary" src/components` hits zero input sites; the previously naked `outline-none` inputs carry the green treatment
- [x] A-004 R5: Disabled dialog/panel buttons show `opacity-40 + cursor-not-allowed + hover-neutralized`; `window-note-prompt.tsx` submit has a disabled state

### Behavioral Correctness

- [x] A-005 R3: Inputs remain excluded from the global `:focus-visible` ring (the `globals.css` selector is unchanged); focused inputs show the green border, not the ring
- [x] A-006 R6: `grep -rn "accent[^-]" src/components` yields zero control-styling hits; every surviving hit classifies as link/hover-reveal/status per the audit

### Scenario Coverage

- [x] A-007 R4: Palette opened via ⌘K — the autofocused input settles directly into its focus border with no visible flash
- [x] A-008 R7: Affected unit suites and scoped e2e specs pass; `npx tsc --noEmit` clean

### Edge Cases & Error Handling

- [x] A-009 R2: The danger arm reads correctly in BOTH themes (signal-red is theme-varied: `#f87171` dark / `#dc2626` light) — contrast of button text/border against dialog ground verified in each

### Code Quality

- [x] A-010 Pattern consistency: new constants follow `controls.ts` decomposed-arm conventions (BASE/REST separation, lockstep comments, doc-comment voice); REST-swap rule respected where state arms compose
- [x] A-011 No unnecessary duplication: no re-typed confirm pair, focus treatment, or coarse floor remains at a call site that a shared constant covers
- [x] A-012 Comment discipline: no change-ID/PR citations in code comments; intent comments state constraints, not narration

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change deletes its own redundancies in place (the drifted re-typed kill-confirm recipes, the three retired focus colors); no pre-existing symbol, file, or block is left unused by it

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The focus treatment ships as a shared `INPUT_FOCUS` constant in `controls.ts` rather than 20 re-typed literals | Matches the file's existing decomposed-constant pattern; sites keep their own geometry/bg and compose the focus arm | S:75 R:85 A:85 D:75 |
| 2 | Confident | `CONFIRM_DANGER` alphas (`/20` rest, `/35` hover) are chosen at apply to visually match the current red-900/30→/50 weight, verified in both themes | Exact alphas are a judgment call inside a settled hue decision; easily tuned | S:65 R:90 A:80 D:70 |
| 3 | Confident | The omnibox `active ? border-accent-green/60` normalizes to focus-driven full `accent-green` (its `active` prop tracks focus) | One-treatment rule; if `active` carries non-focus semantics at apply, keep the prop wiring and swap only the color | S:70 R:85 A:75 D:70 |
| 4 | Certain | `MENU_ROW_DISABLED`'s spelling is the "unified disabled recipe" the intake names | Verified in controls.ts — the only shipped `opacity-40` disabled recipe | S:85 R:90 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
