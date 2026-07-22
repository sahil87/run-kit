# Plan: App-Wide Tier-1 Tooltip System (`Tip` Component)

**Change**: 260722-73al-tip-tooltip-system
**Intake**: `intake.md`

## Requirements

### Frontend: `Tip` component

#### R1: Shared tier-1 `Tip` component
A new shared component `app/frontend/src/components/tip.tsx` SHALL provide the app's tier-1
tooltip, built on `@floating-ui/react` (already a dependency via StatusDotTip). Tier-1 means it
**names a control**: plain text label + optional dim modifier note + optional keycap chip — NEVER
interactive content. Visual shell is the user-approved quiet card: `bg-bg-card`, 1px
`border-border`, 5px radius, soft shadow, 11px mono type, `text-text-primary` label,
`text-text-secondary` note. The keycap chip (`kbd` slot): `bg-bg-inset`, 1px border with 2px
bottom edge, 3px radius, 10px type; the `kbd` value is a static string prop per call site (no
shortcut-registry wiring). The API wraps a **single child element** and clones it with the
floating reference props merged (refs merged via `useMergeRefs`), so no wrapper DOM node is added
— this keeps the top-bar's width-measurement probe accurate.

- **GIVEN** `<Tip label="Send" kbd="Enter"><button aria-label="Send text">…</button></Tip>`
- **WHEN** the button is hovered (fine pointer) past the open delay
- **THEN** a quiet-card tooltip renders in a portal showing "Send" plus an `Enter` keycap chip
- **AND** the button element itself is unchanged in the DOM tree (no extra wrapper element)

- **GIVEN** a `Tip` whose `label` resolves to `undefined`/empty (conditional-tooltip call sites)
- **WHEN** it renders
- **THEN** the child renders as-is with no tooltip machinery attached

#### R2: Behavior contract
`Tip` SHALL implement the user-approved behavior spec:
- **Open delay**: 300ms on hover; 0ms while the cluster is warm — a sibling tip in the same
  `FloatingDelayGroup` closed <500ms ago (`TipGroup` export wrapping `FloatingDelayGroup` with
  `delay={{open: 300, close: 0}}`, `timeoutMs={500}`); outside any group the 300ms default applies.
- **Keyboard**: opens immediately on `:focus-visible` (`useFocus` with the `visibleOnly` default),
  never on mouse-down focus.
- **Dismiss**: pointer-leave, Escape (`useDismiss`), and on activating the control
  (`referencePress: true` — the tooltip never sits over the click's result).
- **Touch**: suppressed under `pointer: coarse` (via the existing `useCoarsePointer` hook) — the
  child renders unchanged; the control's `aria-label` carries the name.
- **Placement**: per-site `placement` prop with flip + shift middleware at viewport edges
  (`offset(6)`, `flip()`, `shift({padding: 8})`, `autoUpdate` — the StatusDotTip middleware set).
  Default placement is `bottom` (the top-bar convention); bottom-of-screen strips pass `top`,
  sidebar rows pass `right`.
- **Content cap**: one line, ≤40ch, sentence-cased label (CSS `max-w-[40ch]` +
  `whitespace-nowrap` + truncate as backstop; over-cap legacy strings rewritten at migration).
- **Reduced motion**: instant show/hide — the tooltip carries no animation at all.
- **Non-interactivity**: the floating element is `pointer-events-none` so it can never intercept
  clicks (tier-1 tooltips hold no interactive content by definition).

- **GIVEN** two adjacent top-bar controls inside one `TipGroup`
- **WHEN** the pointer hovers control A for 300ms (tip opens), then moves to control B within 500ms
- **THEN** control B's tip opens with no perceptible delay (macOS-menu sweep)

- **GIVEN** a control wrapped in `Tip` on a coarse-pointer device
- **WHEN** the control is tapped or focused
- **THEN** no tooltip renders and no `aria-describedby` is wired

#### R3: ARIA and the two-tier boundary
The floating element SHALL carry `role="tooltip"` and the anchored control SHALL get
`aria-describedby` pointing at it while open (via `useRole(context, {role: "tooltip"})`).
`StatusDotTip` (tier-2 hover-card) SHALL remain functionally unchanged, including its deliberate
absence of `role="tooltip"` (it holds real links). No middle species is introduced.

- **GIVEN** an open `Tip`
- **WHEN** the DOM is inspected
- **THEN** the floating element has `role="tooltip"` and the child carries a matching
  `aria-describedby`
- **AND** `status-dot-tip.tsx` has no behavioral diff in this change

### Frontend: migration

#### R4: Top-bar cluster migration
All native tooltip `title=` attributes on the top-bar chrome SHALL be replaced by `Tip`
(the native `title` removed wherever `Tip` lands — never both; `aria-label`s untouched):
- `top-bar.tsx` (28 sites): HistoryNav Back/Forward; brand crumb ("Host"); server crumb
  ("tmux Server"); connection dot (`dotTitle`, hover-only — the span stays non-focusable);
  WindowHeading rename button ("Click to rename"); ThemeToggle; HelpLink; SplitButton (×2 usages
  via one component); ClosePaneButton; RefreshButton → label "Refresh page" + dim note
  "⇧click: force" (same for RefreshMenuRow); TerminalFontControl trigger + −/+/reset popover
  buttons; UpdateChip body + dismiss ✕; NotificationControl trigger + its dropdown's test row and
  help link (help-link copy rewritten to fit the 40ch cap); FixedWidthToggle; BoardAutofitToggle;
  NotificationMenuRows test row. The four `title` props passed to `BreadcrumbDropdown`
  ("Navigate up", "Session", "Window", "Board") migrate via R4b.
- `top-bar-overflow-menu.tsx` (3 sites): "More controls" trigger, "Copy version" (conditional —
  only when `daemonVersion` present), "Check for updates".
- **R4b** `breadcrumb-dropdown.tsx`: the `title` prop (kept under that name — it is a component
  prop, like `Dialog title=`) SHALL render as an internal `Tip` around the trigger button instead
  of a native `title` attribute.
- **Warm clusters**: `TipGroup` providers wrap the top-bar's three regions — left breadcrumb
  cluster, center heading cluster, and right control cluster (which contains the overflow menu
  and every registry control's popover, so their rows share the group).

- **GIVEN** the terminal route top bar
- **WHEN** `grep title=` runs over `top-bar.tsx` / `top-bar-overflow-menu.tsx` / `breadcrumb-dropdown.tsx`
- **THEN** no native tooltip `title=` attribute remains on an interactive chrome control
- **AND** hovering the Refresh button shows "Refresh page" with the dim "⇧click: force" note in
  the styled tip, with no OS-native bubble doubling it

#### R5: App-wide control-name migration
The remaining tier-1 (control-name) native titles across `app/frontend/src/components/` SHALL
migrate to `Tip`, with over-cap strings rewritten to short sentence-cased labels:
- `view-switcher.tsx:113` segment buttons (`{Label} view`).
- `open-button.tsx:112,123` primary + chevron segments.
- `waiting-badge.tsx:45,62` (button and display-only span variants; placement `right` — the
  sidebar-row convention).
- `sidebar/index.tsx:1145` ALL/CUR scope chip — three-way sentence rewritten to the ≤40ch action
  labels: scope `all` → "Show current server only", otherwise → "Show all servers".
- `board/board-header.tsx:84` "Unpin from board" (the board-twin chrome's one real native tooltip;
  re-inventory of `board-page.tsx` confirmed its three `title=` matches are `Dialog` props).
- `sidebar/status-panel.tsx:262` "Refresh PR status" (PaneRefreshButton).
- `iframe-window.tsx:79,99` Refresh / Switch-to-terminal buttons — NOT the
  `title="Proxied content"` iframe accessible name.
- `chat-view.tsx:281,292` + `compose-strip.tsx:471,483` — the natural `kbd`-slot users:
  Insert → label "Insert without submitting" + kbd "Alt+Enter"; Send → label "Send" + kbd
  "Enter" (the coarse-pointer title branch collapses — tips are suppressed on coarse pointers).
- `host-overview-page.tsx:440` "Create a server first" (disabled-only, conditional label).
- `swatch-popover.tsx:267` marker cells (`state || "none"`).

- **GIVEN** the sessions sidebar with scope `all`
- **WHEN** the ALL chip is hovered or focus-visible
- **THEN** a styled tip reads "Show current server only" (≤40ch) and the chip has no native `title`

#### R6: Untouched seams
This change SHALL NOT touch: `Dialog title=` component props anywhere (incl. the board route's
three dialogs and `host-overview-page.tsx:471`); `title="Proxied content"` on the proxied iframe
(asserted by `top-bar-overflow.spec.ts:424` and `web-view-lens.spec.ts:90`); state/content-reveal
native titles (server-tile window-count summary `server-panel.tsx:258` — asserted by
`server-panel-grid.spec.ts:61` —, PR-URL reveal `status-panel.tsx:375` — asserted by
`pr-status-sidebar.spec.ts` —, cwd reveal `status-panel.tsx:523`); `CollapsiblePanel`-style
heading `title` props (`host-panel.tsx:108`, `boards-section.tsx:41`, `server-panel.tsx:122`,
`status-panel.tsx:316/346`); and `status-dot-tip.tsx` (tier-2, including its internal docs-link
native title).

- **GIVEN** the full diff of this change
- **WHEN** the files above are checked
- **THEN** every listed seam is byte-identical (or the file untouched), and the four known e2e
  title selectors still pass

### Tests

#### R7: Test coverage
- Colocated Vitest `app/frontend/src/components/tip.test.tsx` SHALL cover: label/note/kbd
  rendering, `role="tooltip"` + `aria-describedby` wiring on open, open on focus, no tooltip and
  no `aria-describedby` under a mocked coarse pointer, and label-less pass-through.
- A new Playwright spec `app/frontend/tests/e2e/tooltips.spec.ts` with sibling
  `tooltips.spec.md` companion (Constitution: Test Companion Docs) SHALL prove: tooltip appears
  on keyboard focus, tooltip appears after hover, tooltip absent under coarse-pointer emulation.
- Existing unit tests asserting migrated native titles SHALL be updated to the new contract
  (`top-bar.test.tsx:413-416,611`, `top-bar-overflow-menu.test.tsx:62`, `update-chip.test.tsx:96`,
  `board-header.test.tsx:35`, `host-overview-page.test.tsx:155,257`): assert the native `title`
  is gone and the accessible name (aria-label) is preserved; deep tooltip behavior stays in
  `tip.test.tsx`. Tests asserting out-of-scope titles (`server-panel.test.tsx`,
  `status-panel.test.tsx` cwd/PR, `status-dot.test.tsx:271`) stay untouched.

- **GIVEN** the full verification gates
- **WHEN** `go test ./...`, `npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, `just build` run
- **THEN** all pass

### Non-Goals

- No tier-2 promotion of state/content titles (server-tile counts, PR URL, cwd) — they stay native.
- No shortcut-registry wiring for the `kbd` slot (deferred follow-up).
- No inverse-video tooltip register, no typed-reveal animation (rejected in the design session).
- No backend, API, or route changes.

### Design Decisions

#### Clone-child reference API
**Decision**: `Tip` clones its single child and merges the floating reference props/ref onto it,
instead of rendering a wrapper element or a render-prop API.
**Why**: ~40 call sites demand minimal churn; the top-bar's overflow fit measures `barRender()`
widths in a hidden probe, so any wrapper element would distort measured widths; the codebase
already uses the floating-ui reference-props idiom (StatusDotTip's `renderDot`).
**Rejected**: a wrapper `<span>` (distorts probe widths and flex layouts); StatusDotTip's
render-prop shape (far noisier at 40 call sites).
*Introduced by*: 260722-73al-tip-tooltip-system

#### Suppress-by-early-return on coarse pointers
**Decision**: under `pointer: coarse` (live via `useCoarsePointer`), `Tip` returns its child
unchanged — no reference props, no portal, no ARIA wiring.
**Why**: the approved spec says touch gets no tooltip layer at all; not attaching the machinery is
the cheapest correct implementation and makes the Vitest "no render under coarse pointer"
assertion direct.
**Rejected**: `enabled: false` on the hover/focus hooks only (still wires `aria-describedby`
machinery and keeps dead listeners).
*Introduced by*: 260722-73al-tip-tooltip-system

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/tip.tsx`: `Tip` (label/note/kbd/placement/children
  props, clone-child API, quiet-card shell, keycap chip, 300ms/warm delays via `useDelayGroup`,
  focus-visible open, dismiss on leave/Escape/reference-press, coarse suppression, `role="tooltip"`,
  `pointer-events-none` floating element, named constants for delays) and `TipGroup`
  (`FloatingDelayGroup` preset `delay={{open:300, close:0}}` `timeoutMs={500}`) <!-- R1, R2, R3 -->
- [x] T002 Create colocated `app/frontend/src/components/tip.test.tsx` covering label/note/kbd
  render, tooltip role + `aria-describedby` wiring, focus-open, coarse-pointer suppression
  (mocked `matchMedia`), and label-less pass-through <!-- R7 -->

### Phase 2: Core Migration

- [x] T003 `app/frontend/src/components/breadcrumb-dropdown.tsx`: render the `title` prop as an
  internal `Tip` around the trigger (native `title=` attribute removed) <!-- R4 -->
- [x] T004 `app/frontend/src/components/top-bar.tsx`: migrate all 24 direct native-title sites to
  `Tip` (RefreshButton/RefreshMenuRow get label + "⇧click: force" note; NotificationControl help
  link copy shortened to fit 40ch) and add the three region `TipGroup` wrappers (left breadcrumb
  cluster, center heading cluster, right control cluster) <!-- R4 -->
- [x] T005 `app/frontend/src/components/top-bar-overflow-menu.tsx`: migrate "More controls",
  conditional "Copy version", and "Check for updates" to `Tip` <!-- R4 -->
- [x] T006 [P] `view-switcher.tsx` segment buttons and `open-button.tsx` split-button segments to
  `Tip` <!-- R5 -->
- [x] T007 [P] `waiting-badge.tsx` button + span variants to `Tip` (placement `right`) <!-- R5 -->
- [x] T008 [P] `sidebar/index.tsx` scope chip (copy rewritten to "Show current server only" /
  "Show all servers") + `sidebar/status-panel.tsx` PaneRefreshButton to `Tip`; wrap the sidebar
  root in one `TipGroup` <!-- R5 -->
- [x] T009 [P] `board/board-header.tsx` unpin button to `Tip`; re-inventory the board route for
  any new native chrome tooltips <!-- R5 -->
- [x] T010 [P] `iframe-window.tsx` Refresh + Switch-to-terminal buttons to `Tip` (iframe
  `title="Proxied content"` untouched); wrap the URL bar in `TipGroup` <!-- R5, R6 -->
- [x] T011 [P] `chat-view.tsx` + `compose-strip.tsx` Insert/Send buttons to `Tip` with `kbd`
  slots ("Alt+Enter" / "Enter", placement `top`); wrap each button row in `TipGroup` <!-- R5 -->
- [x] T012 [P] `host-overview-page.tsx:440` disabled-only "Create a server first" and
  `swatch-popover.tsx:267` marker cells to `Tip` <!-- R5 -->

### Phase 3: Integration & Tests

- [x] T013 Update unit tests asserting migrated native titles: `top-bar.test.tsx`,
  `top-bar-overflow-menu.test.tsx`, `update-chip.test.tsx`, `board/board-header.test.tsx`,
  `host-overview-page.test.tsx` — assert native `title` absent + aria-label preserved <!-- R7 -->
- [x] T014 Create `app/frontend/tests/e2e/tooltips.spec.ts` + sibling `tooltips.spec.md`
  companion: keyboard-focus shows tip, hover shows tip, absent under coarse-pointer emulation
  <!-- R7 -->
- [x] T015 Verification gates: `cd app/backend && go test ./...` (untouched/green),
  `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, `just build`;
  final re-grep of `title=` across `src/components/` confirming only the R6 seams remain
  <!-- R6, R7 -->

## Execution Order

- T001 blocks everything (T002–T012 consume `Tip`/`TipGroup`)
- T003 blocks T004 (top-bar relies on BreadcrumbDropdown's internal Tip for 4 of its sites)
- T004–T012 block T013–T014; T015 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tip.tsx` exists with the quiet-card shell, optional note + kbd keycap slots, and
  the single-child clone API (no wrapper element around the child)
- [x] A-002 R2: 300ms hover open / warm-cluster instant open (`TipGroup`, 500ms window),
  focus-visible immediate open, dismiss on leave/Escape/activation, coarse suppression, flip+shift
  at edges, no animation
- [x] A-003 R3: open tip has `role="tooltip"` + `aria-describedby` on the anchor; `StatusDotTip`
  functionally unchanged (byte-identical — `git diff HEAD status-dot-tip.tsx` empty)
- [x] A-004 R4: zero native tooltip `title=` attributes remain on interactive controls in
  `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `breadcrumb-dropdown.tsx`; three region `TipGroup`s
  present (the four remaining `title=` in top-bar are BreadcrumbDropdown `title` props, R4b)
- [x] A-005 R5: all §R5 sites migrated with `aria-label`s preserved and over-cap copy rewritten

### Behavioral Correctness

- [x] A-006 R4: no double bubble — wherever `Tip` landed the native `title` is removed (styled tip
  is the only tooltip)
- [x] A-007 R5: Send/Insert tips render keycap chips ("Enter", "Alt+Enter") instead of
  parenthesized shortcut text; Refresh tips render the dim "⇧click: force" note

### Scenario Coverage

- [x] A-008 R7: `tooltips.spec.ts` proves keyboard-focus open, hover open, and coarse-pointer
  absence (3/3 pass); sibling `tooltips.spec.md` documents each test (what it proves + steps)
- [x] A-009 R7: `tip.test.tsx` covers label/note/kbd, ARIA wiring, focus-open, coarse suppression,
  label-less pass-through (7/7 pass)

### Edge Cases & Error Handling

- [x] A-010 R1: label-less `Tip` (conditional call sites: "Copy version", "Create a server first")
  renders the child untouched
- [x] A-011 R6: the four known e2e title seams still pass (`pr-status-sidebar.spec.ts`,
  `server-panel-grid.spec.ts:61`, `top-bar-overflow.spec.ts:424`, `web-view-lens.spec.ts:90` — all
  verified green); Dialog `title=` props and state/content-reveal titles untouched
- [x] A-012 R4: top-bar overflow fit unaffected — the hidden measurement probe's widths are
  unchanged by `Tip` (no wrapper element), and inert probe copies never open tooltips (probe is
  `inert` + `aria-hidden` + off-screen + `pointer-events-none`)

### Code Quality

- [x] A-013 Pattern consistency: `Tip` follows the StatusDotTip floating-ui idiom (middleware set,
  portal, hook composition) and the codebase's naming/structure conventions
- [x] A-014 No unnecessary duplication: reuses `useCoarsePointer`, floating-ui primitives, and
  existing utilities; no new dependency added
- [x] A-015 Type narrowing over assertions: the only `as` cast in `tip.tsx` is the React-19
  `child.props.ref` narrowing that `cloneElement` generically requires
- [x] A-016 No magic numbers: delays/warm-window/offsets carried as named constants
  (`TIP_OPEN_DELAY_MS`, `TIP_WARM_WINDOW_MS`, `TIP_OFFSET_PX`, `TIP_SHIFT_PADDING_PX`)
- [x] A-017 Tests included for added behavior (unit + e2e per R7); every modified `.spec.ts` has
  its sibling `.spec.md` updated in the same change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a new shared component and migrates call sites off native
  `title=` attributes. It makes no existing file, function, or config redundant: `StatusDotTip`
  is a distinct tier-2 species retained by design (R3), `useCoarsePointer` is reused not
  duplicated, and every removed `title=` attribute is replaced in place by a `<Tip>` (not
  leaving dead code behind).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Default `placement` is `bottom` (top-bar convention — the majority of migrated sites), overridden per region (`top` for bottom-of-screen strips, `right` for sidebar rows) | Intake fixes per-region placement but not the prop default; bottom minimizes prop churn | S:60 R:90 A:85 D:75 |
| 2 | Confident | `Tip` treats an empty/undefined `label` as pass-through (child rendered unchanged) | Two inventoried sites have conditional titles ("Copy version", "Create a server first"); mirrors the `title={cond ? x : undefined}` idiom they already use | S:65 R:90 A:85 D:80 |
| 3 | Confident | Warm-group topology: three top-bar `TipGroup`s (left breadcrumb, center heading, right control cluster incl. overflow menu + control popovers), one sidebar-root group, local groups for iframe URL bar / chat / compose / swatch grid; single-tip regions ungrouped | Intake assumption 11 names regions but not the center heading; a group only matters where siblings share a sweep | S:55 R:90 A:80 D:70 |
| 4 | Confident | Tooltips on disabled controls (font-stepper bounds, "Send test notification", "Create a server first") rely on modern browsers dispatching hover events to disabled form controls (Chrome 98+); degraded (no tip) on older engines is acceptable | Native titles on disabled controls were already inconsistent across engines; keyboard focus can't reach disabled controls either way | S:50 R:85 A:70 D:65 |
| 5 | Confident | Over-cap rewrites: notification help link → "Setup & troubleshooting guide"; Insert buttons → "Insert without submitting" + kbd "Alt+Enter"; Send → "Send" + kbd "Enter" (coarse title branch dropped — tips never render on coarse) | Intake's ≤40ch cap + assumption 10/12 mandate mechanical rewrites; wording trivially reversible | S:65 R:90 A:80 D:75 |
| 6 | Confident | `BreadcrumbDropdown` keeps its `title` prop name, now rendered as an internal `Tip` instead of a native attribute | Component props named `title` are explicitly out of migration scope (Dialog precedent); renaming would churn 5 call sites for no behavior gain | S:60 R:90 A:85 D:75 |
| 7 | Certain | The floating tooltip element is `pointer-events-none` | Tier-1 tooltips are never interactive by the approved taxonomy, so nothing is lost and click-interception bugs are impossible | S:85 R:95 A:95 D:90 |
| 8 | Confident | Connection dot keeps its non-focusable `<span>`; its tip is hover-only | Making a status dot focusable would add a tab stop for a non-actionable element; native title was hover-only there too | S:60 R:85 A:80 D:75 |
| 9 | Confident | Updated unit tests assert the native `title` is absent and the aria-label preserved, rather than re-testing tooltip behavior per site | Tooltip behavior is covered once in `tip.test.tsx`; per-site tests only guard the migration contract | S:60 R:90 A:85 D:80 |

9 assumptions (1 certain, 8 confident, 0 tentative).
