# Plan: Operator Visual Distinction

**Change**: 260902-znfg-operator-visual-distinction
**Intake**: `intake.md`

## Requirements

### Frontend: Operator Identity Glyph

#### R1: Shared HeadsetIcon
A `HeadsetIcon` stroke-SVG component MUST be added to `app/frontend/src/components/sidebar/icons.tsx` in the file's established idiom (`stroke="currentColor"`, `strokeWidth={2}`, round caps/joins, 24-unit viewBox, `aria-hidden="true"`, `size` prop defaulting to 13 — the `PaletteIcon`/`BotIcon`/`ComposeIcon` precedent), with the exact approved geometry: headband arc `M4 14v-2a8 8 0 0 1 16 0v2`, earcups `<rect x="3" y="13" width="4.5" height="6" rx="1.8" />` and `<rect x="16.5" y="13" width="4.5" height="6" rx="1.8" />`, mic boom `M21 19v.5a3 3 0 0 1-3 3h-4`. It is the SINGLE icon source for all four surfaces below.

- **GIVEN** any surface needing the operator glyph
- **WHEN** it renders the icon
- **THEN** it imports `HeadsetIcon` from `sidebar/icons.tsx` — no per-surface SVG copies

#### R2: WindowRow glyph (mock variant A1)
`app/frontend/src/components/sidebar/window-row.tsx` MUST render a 13px `HeadsetIcon` between the `<StatusDot win={win} />` and the window-name span if and only if `win.role === "operator"`. The gate is the ROW's own data (`win.role`), never the mount site, so the glyph rides every `WindowRow` mount (terminal-route pinned row, board-route multi-server pinned rows, defensive in-session mounts). The glyph SHALL be `text-text-secondary` at rest brightening with the row's existing hover/current classes, decorative (`aria-hidden`), and non-interactive — it MUST NOT affect the rename hit-area, drag, or click behavior, and ordinary rows (`role !== "operator"`) MUST render exactly as today (conditional mount, no reserved slot, no layout shift).

- **GIVEN** a window with `role === "operator"` rendered by any `WindowRow` mount
- **WHEN** the row paints
- **THEN** the headset glyph appears between the status dot and the name
- **AND** a `role`-less or non-operator window's row DOM is unchanged from today

#### R3: Top-bar heading glyph (mock variant B1, quiet)
`app/frontend/src/components/top-bar.tsx` MUST render a ~14px `HeadsetIcon` between the page-type prefix span and the window heading when the current window carries `role === "operator"`. The shipped `Tab:` prefix (`WINDOW_PREFIX`, top-bar.tsx:1535) is KEPT — no `Operator:` page type, no `[ OPERATOR ]` bracket tag. The glyph is a static sibling OUTSIDE the `WindowHeading` inline-rename hit-area and OUTSIDE the boot-sweep cell string — the sweep continues to render over `prefix + " " + name` exactly as today. Tone: `text-text-secondary`, matching the prefix.

- **GIVEN** the terminal route with the current window marked `role === "operator"`
- **WHEN** the center heading renders
- **THEN** the glyph sits between the `Tab:` prefix and the name, and clicking the name still enters inline rename
- **AND** the boot-sweep hover animation runs over the same cell string as before (the glyph is not a sweep cell)

#### R4: Window switcher ▾ operator row
`BreadcrumbDropdownItem` (`app/frontend/src/contexts/chrome-context.tsx:6` — today `{ label, href, current? }`) MUST gain a minimal optional glyph seam (e.g. `operator?: boolean` or `icon?: ReactNode`), rendered by `breadcrumb-dropdown.tsx` before the item label. The `windowItems` build site (`top-bar.tsx:535`, from `currentSession?.windows`) sets it for the operator window. Board/session dropdown consumers are unaffected by the optional field.

- **GIVEN** the window switcher ▾ open while the current session carries the operator window
- **WHEN** the list renders
- **THEN** the operator window's item shows the headset glyph before its label; other items are unchanged

#### R5: Palette window-switch rows
`PaletteAction` (`app/frontend/src/components/command-palette.tsx:14`) MUST gain an optional `icon?: ReactNode` slot rendered before the label in the palette row (generic seam, no operator special-casing in the renderer). `windowSwitchActions` (`app/frontend/src/app.tsx:3692`) sets, for `role === "operator"` windows only, the `HeadsetIcon` plus a plain-text `operator` hint via the existing `description` field (which joins the filter haystack — typing "operator" finds the row; this is also the accessible text channel since the glyph is `aria-hidden`). Scope is window-NAVIGATION entries only; existing operator-actuation entries (compose etc.) are not decorated.

- **GIVEN** the palette open
- **WHEN** the user types "operator"
- **THEN** the operator window's `Tab: Switch to …` entry matches via its description hint and renders the glyph

#### R6: Tests
Unit (Vitest): `window-row.test.tsx` proves the glyph renders iff `role === "operator"` and ordinary rows carry no glyph node; `top-bar.test.tsx` proves the heading glyph conditional, unchanged prefix text, and glyph placement outside the rename button; switcher-item and palette-row rendering covered in their component tests. E2E (Playwright): extend `app/frontend/tests/e2e/operator-pinned-row.spec.ts` (its rig already provisions a real `@rk_win_role=operator` window) to assert the pinned-row glyph and, after navigating to the operator window, the heading glyph — updating the affected tests' intent comments in the same commit (constitution Test Intent Comments).

- **GIVEN** the operator e2e rig
- **WHEN** the spec runs
- **THEN** the pinned row and the heading both expose the glyph (stable `data-testid`), and intent comments describe the new assertions

### Non-Goals

- `[ OPERATOR ]` sidebar micro-header (mock A2) — HOLD, judge after this ships
- `[ OPERATOR ]` top-bar bracket tag (mock B2) — considered, not chosen
- Any status-channel encoding of role: reserved hue, accent-green name, row-wide wash, status-dot or marker-well variants, persistent flair/motion
- An `Operator:` page-type prefix — the page-type axis means surface kind, not window role
- Backend/API/route/tmux changes — `win.role` already reaches every surface
- Decorating operator-actuation palette entries (compose etc.)
- Committing the design mock to `docs/wiki/` — remains an intake Open Question (user's call), not a task here

### Design Decisions

#### Role rides the glyph-before-name identity channel
**Decision**: Operator identity is expressed exclusively as a `HeadsetIcon` before the window name (sidebar row, top-bar heading, switcher, palette), `text-text-secondary` at rest, same token both themes.
**Why**: The signal channels are budgeted — hue belongs to the status dot's two-family model, the marker well to mode×stage, the trailing glyph to PR state, motion to flairs. Role is identity, not status: static for the window's life, so it takes the free identity channel a filetype icon uses in an editor tab.
**Rejected**: Reserved hue / accent-green name (green = health semantics), row-wide wash (T4 marker-well texture), dot/marker encodings, persistent flair — each a channel-discipline violation; `Operator:` page type — overloads surface-kind with window-role.
*Introduced by*: 260902-znfg-operator-visual-distinction

#### Glyph stays outside the boot-sweep cell string
**Decision**: The heading glyph is a static sibling span; the boot-sweep keeps rendering over `prefix + " " + name` only.
**Why**: The sweep machinery is cell-per-character over text; a non-text glyph cell would need new sweep machinery for zero design gain, and the glyph staying static keeps rest-state calm.
**Rejected**: Including the glyph as a sweep cell.
*Introduced by*: 260902-znfg-operator-visual-distinction

#### Generic optional icon seams, not operator special-cases
**Decision**: `BreadcrumbDropdownItem` and `PaletteAction` each gain a minimal optional glyph field consumed generically by their renderers; operator-ness is decided at the data build sites.
**Why**: Renderer special-casing ("if operator") would leak role logic into presentation components and block reuse; an optional field is inert for every existing consumer.
**Rejected**: Matching on label text or special-casing in the renderers.
*Introduced by*: 260902-znfg-operator-visual-distinction

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `HeadsetIcon` to `app/frontend/src/components/sidebar/icons.tsx` (idiom + exact approved geometry per R1) <!-- R1 -->
- [x] T002 Render conditional glyph in `app/frontend/src/components/sidebar/window-row.tsx` between StatusDot and name (`win.role === "operator"` gate, secondary→primary tone, aria-hidden, non-interactive); add gating cases to `window-row.test.tsx` <!-- R2 -->
- [x] T003 Render heading glyph in `app/frontend/src/components/top-bar.tsx` between the `Tab:` prefix span and `WindowHeading` when the current window is the operator (outside rename hit-area and boot-sweep cells); add cases to `top-bar.test.tsx` <!-- R3 -->
- [x] T004 [P] Extend `BreadcrumbDropdownItem` (`app/frontend/src/contexts/chrome-context.tsx`) with the optional glyph field and render it in `app/frontend/src/components/breadcrumb-dropdown.tsx` before the label; unit-test the item rendering <!-- R4 --> <!-- rework: icon slot inherits text-accent on the current item — give it its own secondary/hover/current-primary treatment per R2's color contract -->
- [x] T005 [P] Add optional `icon?: ReactNode` to `PaletteAction` and render it before the label in `app/frontend/src/components/command-palette.tsx` rows; unit-test the slot <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Wire the data build sites: set the glyph field for the operator window in `windowItems` (`top-bar.tsx:535`) and set `icon` + `operator` description hint in `windowSwitchActions` (`app/frontend/src/app.tsx:3692`, operator windows only); verify the hint joins the palette filter haystack <!-- R4 --> <!-- rework: A-008 untested at the build-site boundary — unit-test the role-keyed windowSwitchActions output for operator AND non-operator windows, not a preconstructed action -->
- [x] T007 Extend `app/frontend/tests/e2e/operator-pinned-row.spec.ts`: pinned-row glyph assertion + navigate-to-operator heading glyph assertion; update intent comments in the same commit <!-- R6 -->
- [x] T008 Run gates scoped to the change: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, then `just pw test operator-pinned-row`; fix fallout <!-- R6 -->

## Execution Order

- T001 blocks T002–T006 (all import `HeadsetIcon`)
- T004 and T005 are parallel; both block T006
- T007–T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `HeadsetIcon` exists in `sidebar/icons.tsx` matching the sibling-icon idiom and the approved geometry verbatim
- [x] A-002 R2: every `WindowRow` mount renders the glyph for `role === "operator"` rows and only those (data-keyed, not mount-site-keyed)
- [x] A-003 R3: the terminal-route heading shows the glyph for the operator window with the `Tab:` prefix text unchanged
- [x] A-004 R4: the window switcher ▾ operator item carries the glyph; non-operator items and other dropdown consumers are unchanged
- [x] A-005 R5: the operator's palette switch entry renders the glyph and is findable by typing "operator" (description joins the haystack)

### Behavioral Correctness

- [x] A-006 R2: non-operator rows' DOM/layout is byte-identical to before (conditional mount, no reserved slot); the glyph has no pointer handlers and rename/drag/click behavior is unaffected
- [x] A-007 R3: the boot-sweep animation still runs over `prefix + " " + name` only; inline rename still opens from the name

### Scenario Coverage

- [x] A-008 R6: Vitest covers the gating on all four surfaces (window-row, top-bar heading, breadcrumb item, palette row)
- [x] A-009 R6: `operator-pinned-row.spec.ts` proves pinned-row + heading glyphs end-to-end against a real `@rk_win_role=operator` window, with intent comments updated in the same commit

### Edge Cases & Error Handling

- [x] A-010 R2: ghost/optimistic rows and windows with empty/absent `role` never render the glyph (backend already drops non-closed-set role values — frontend trusts `win.role`)

### Code Quality

- [x] A-011 Pattern consistency: new code follows the icons/row/palette idioms of the surrounding files (stroke SVG shape, optional-prop seams, memo contracts preserved — no new unstable identities threaded into memo'd rows)
- [x] A-012 No unnecessary duplication: one `HeadsetIcon` shared by all four surfaces; no per-surface SVG copies
- [x] A-013 Comment discipline: no comment narration; no R#/T#/change-ID provenance comments in src or tests (grep `znfg|R[1-6]\b|T00[1-8]` over touched files before finishing)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The design-mock committal (intake Open Question) is excluded from this plan's tasks — it stays an intake-level question, resolvable via /fab-clarify without touching this change's code scope | User explicitly left it undecided; it is additive documentation with zero coupling to the four surfaces, so deferring costs nothing | S:60 R:90 A:70 D:70 |
| 2 | Confident | Switcher role threading happens at the `windowItems` build site in top-bar.tsx (data-keyed), not inside BreadcrumbDropdown | The build site already maps `currentSession?.windows` and is the only place window data meets the dropdown item type | S:70 R:85 A:85 D:75 |
| 3 | Certain | No new palette ACTION is registered — this change decorates existing rows only, so Constitution V's registry rule is satisfied by the status quo | Purely visual identity; the intake records "no new user-facing action" explicitly | S:90 R:90 A:90 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).
