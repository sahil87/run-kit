# Plan: Top-Bar Crumb Collapse + Touch Focus Ownership

**Change**: 260902-ngec-crumb-collapse-touch-focus
**Intake**: `intake.md`

## Requirements

### Top Bar: Breadcrumb Min-Useful-Width Collapse

#### R1: Collapse rung in the crumb degradation ladder
The left breadcrumb nav in `app/frontend/src/components/top-bar.tsx` SHALL gain a collapse rung between "crumbs truncate" and "breakpoint-hidden": WHEN the server+session crumb section's available width drops below the sum of the crumbs' minimum useful widths (~6ch of content per crumb), THEN both crumbs SHALL collapse into a single `… ▾` crumb trigger rendered in their place, implemented as one `BreadcrumbDropdown` whose items are the two levels (server → its `/$server` route; session → the current window's route, marked `current`). The trigger SHALL carry a `title` tip naming it ("Navigation"). The collapse SHALL be measurement-driven (ResizeObserver + a hidden min-useful-width probe), not breakpoint-driven, and SHALL apply hysteresis so the boundary does not flap.

- **GIVEN** a terminal route with both a server crumb and a session crumb rendered
- **WHEN** the left cell narrows so at least one crumb would render below ~6ch of useful content width
- **THEN** both crumbs are replaced by one `… ▾` crumb trigger whose menu lists the server level (navigating to `/$server`) and the session level (navigating to the current window's route, marked `current`)
- **AND** widening back past the threshold plus hysteresis restores the two separate crumbs without oscillation at the boundary

#### R2: Ellipsis guarantee and useful-width floor
A truncated crumb SHALL never render below its minimum useful width and SHALL always paint its `…` ellipsis: each crumb wrapper SHALL carry a min-width floor (`calc(6ch + chrome)`) so the inner `truncate` span always retains its ellipsis reserve, eliminating the hard-clip failure mode (`runKi` with no ellipsis). The collapse MUST spend only the LEFT cell's space: the center heading cell contract (no `min-w-0` on the outer cell, `max-w-[16ch] sm:max-w-[28ch]` name spans, the `overflow-hidden` nav backstop, the grid's 8px inter-cell gap) MUST remain untouched.

- **GIVEN** a mid-width viewport where crumbs are under truncation pressure but above the collapse threshold
- **WHEN** a crumb truncates
- **THEN** it renders at ≥6ch of content width with a visible `…` ellipsis and never clips mid-word without ellipsis
- **AND** the center heading cell's box and content floor are identical to the pre-change layout (no width is taken from it)

#### R3: Collapse derivation is a pure, unit-tested helper
The threshold/hysteresis decision SHALL live in a pure exported function in `app/frontend/src/lib/crumb-collapse.ts` (the codebase's pure-helper pattern, cf. `top-bar-overflow.ts`) with colocated Vitest coverage; the component supplies measured pixels.

- **GIVEN** the collapse feature
- **WHEN** `deriveCrumbsCollapsed(availablePx, requiredPx, prevCollapsed, hysteresisPx)` is called
- **THEN** it collapses strictly below `requiredPx` when expanded, expands only at/above `requiredPx + hysteresisPx` when collapsed, and returns the previous state for unmeasured (zero/negative) inputs

### Terminal: Coarse-Pointer Focus Gate

#### R4: Always-on capture-phase `contextmenu` suppression on coarse pointers
In `app/frontend/src/components/terminal-client.tsx`, the capture-phase `contextmenu` suppressor SHALL be split out of the `scrollLocked`-gated effect into an unconditional (not lock-gated) effect with the same per-event coarse-pointer check, so the WebKit long-press → `contextmenu` → `rightClickHandler` → `moveTextAreaUnderMouseCursor` path can never focus the xterm helper textarea on touch in ANY lock state. The per-event check SHALL evaluate the shared exported coarse-query constant (`COARSE_POINTER_QUERY` from `use-coarse-pointer.ts`) via `evaluateMediaQuery`, so qt7k's `pointer:` → `any-pointer:` switch applies here automatically.

- **GIVEN** a coarse-pointer device and an UNLOCKED terminal
- **WHEN** a `contextmenu` event fires inside the terminal container (long-press during a slow scroll-drag)
- **THEN** the event is suppressed in the capture phase (preventDefault + stopPropagation) before xterm's element-level listener runs, and the xterm helper textarea does not gain focus
- **AND** on fine-pointer devices the same event passes through untouched in every lock state

#### R5: Deliberate tap focus path stays intact
The synthetic click chain of a clean deliberate tap (touchstart → touchend → mousedown → click) MUST continue to focus the terminal and open the on-screen keyboard on coarse pointers when unlocked: `mousedown` suppression SHALL remain gated on `scrollLocked` (it is the tap's focus path), and `touchend` suppression SHALL also remain lock-gated.

- **GIVEN** a coarse-pointer device and an unlocked terminal
- **WHEN** the user performs a plain tap on the terminal
- **THEN** `mousedown` reaches xterm's handlers unsuppressed and the terminal gains focus (keyboard opens)
- **AND** while scroll-locked, `touchend`/`mousedown`/`focusin` suppression behaves exactly as before

#### R6: Visible-owner audit
The two existing owner affordances — xterm's native hollow-vs-solid cursor and the compose strip's `focus:border-accent` — SHALL be verified to cover every state in which the keyboard can be up once side-effect focus is gated; no new chrome is expected.

- **GIVEN** the gated focus model of R4/R5
- **WHEN** the keyboard is up on a touch device
- **THEN** exactly one visible input owner is active (solid xterm cursor or accent-bordered compose strip), reachable only via a deliberate tap

### Non-Goals

- Re-introducing a `+ New Session` action anywhere in the top bar — 260813-kvk7 deliberately removed the session dropdown; creation lives in the palette (`Session: Create`) and the sidebar server-header `+` (see Assumptions).
- The `pointer:` vs `any-pointer:` media-query decision — owned by the queued sibling change qt7k; this change only routes its check through the shared constant.
- Focus-memory recording seams, the code-server steal guard, and the desktop restore router — untouched per the intake.
- Backend, API, tmux-layer, settings, and route changes — none.

### Design Decisions

#### Measurement-driven joint collapse with a min-useful probe
**Decision**: The collapsible server+session crumbs move into a `flex-1 min-w-0` section wrapper inside a `flex-1 min-w-0` nav, so the section's `clientWidth` IS the available space in both collapsed and expanded states; a hidden, aria-hidden probe row renders the crumbs' min-useful form (real text truncated at `max-w-[6ch]`) so the collapse threshold is `probe.scrollWidth` measured in pixels — no hardcoded font metrics. The pure `deriveCrumbsCollapsed` applies hysteresis on the expand edge only.
**Why**: Fragment width depends on crumb NAME lengths, not the viewport, so no breakpoint can express "would truncate below 6ch"; the flex-1 wrapper keeps the available-width signal alive while collapsed (content-sized elements shrink to the tiny trigger and go blind), which is what makes expand-back possible without sibling-width arithmetic.
**Rejected**: A fixed viewport breakpoint (cannot express content-vs-space); observing the crumb spans' rendered widths (goes blind once collapsed); sibling-width subtraction from the grid cell (fiddly gap arithmetic that drifts from the CSS).
*Introduced by*: 260902-ngec-crumb-collapse-touch-focus

#### Min-width floors on crumb wrappers as the ellipsis guarantee
**Decision**: Each crumb wrapper carries `min-w-[calc(6ch+0.875rem)]` (6ch of content + the crumb box's horizontal padding/border chrome) so a crumb can never render below the useful floor — the truncation reserve is structurally guaranteed, and the floor doubles as the tripwire: when the section clips its floored content, the collapse rung engages.
**Why**: the observed no-ellipsis hard-clip came from the wrapper compressing below the inner span's ellipsis reserve; a CSS floor removes the failure mode outright rather than auditing paint heuristics, and makes the frame-before-collapse render a clean 6ch truncation instead of shrapnel.
**Rejected**: Reactive width auditing of each span per frame (the same measurement, but noisier and still without a paint guarantee).
*Introduced by*: 260902-ngec-crumb-collapse-touch-focus

## Tasks

### Phase 1: Setup

- [x] T001 <!-- rework: must-fix — exported CRUMB_MIN_USEFUL_CH has zero call sites; give it a real consumer (pin in crumb-collapse.test.ts) or drop the export --> Create `app/frontend/src/lib/crumb-collapse.ts` with `CRUMB_MIN_USEFUL_CH`, `CRUMB_COLLAPSE_HYSTERESIS_PX`, and the pure `deriveCrumbsCollapsed(availablePx, requiredPx, prevCollapsed, hysteresisPx)` per R3 <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 <!-- rework: must-fix — collapse probe duplicates crumb text and breaks top-bar-overlap.spec.ts :146 (vacuous probe measurement) and :318 (strict-mode 2-element violation); scope those e2e queries to exclude the probe subtree (the crumb-collapse.spec.ts:128 pattern, getVisibleCrumbText analog) --> <!-- rework: should-fix — hidden probe measures 0 below sm, deriveCrumbsCollapsed keeps stale state; suppress the collapsed trigger below sm or when every probe crumb is breakpoint-hidden --> Rework the left-nav crumb section in `app/frontend/src/components/top-bar.tsx`: make the `<nav>` `flex-1 min-w-0`, wrap the server+session crumbs in a `flex-1 min-w-0` section container, add `min-w-[calc(6ch+0.875rem)]` floors to both crumb wrappers, add the hidden min-useful probe row, and wire a `useLayoutEffect` + ResizeObserver (mirroring the right-cell fit pattern at top-bar.tsx:870-943) driving `crumbsCollapsed` via `deriveCrumbsCollapsed` <!-- R1 -->
- [x] T003 <!-- rework: should-fix — same below-sm suppression applies to the collapsed trigger rendering --> Render the collapsed `… ▾` crumb in `app/frontend/src/components/top-bar.tsx` when `crumbsCollapsed`: one `BreadcrumbDropdown` (extend it with an optional `triggerContent` prop in `app/frontend/src/components/breadcrumb-dropdown.tsx`, default unchanged) with items = server level (→ `serverHref`) + session level (→ current window route, `current: true`), `title="Navigation"`, and an onNavigate handling both 1-segment (server) and 2-segment (window) hrefs <!-- R1 -->
- [x] T004 Split the capture-phase `contextmenu` suppressor in `app/frontend/src/components/terminal-client.tsx` out of the `scrollLocked`-gated effect (~lines 591-635) into an unconditional coarse-pointer effect; export and consume the shared `COARSE_POINTER_QUERY` from `app/frontend/src/hooks/use-coarse-pointer.ts` via `evaluateMediaQuery`; keep `touchend`/`mousedown`/`focusin` lock-gated; update the explanatory comments <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Add `app/frontend/src/lib/crumb-collapse.test.ts`: threshold, hysteresis band, and zero/unmeasured-input cases for `deriveCrumbsCollapsed` <!-- R3 -->
- [x] T006 Update `app/frontend/src/components/terminal-client.test.tsx`: the unlocked-`contextmenu` case now expects suppression on coarse pointers (implementation spec changed per R4); add cases proving unlocked-`contextmenu` suppression, fine-pointer pass-through, and unlocked-`mousedown` pass-through (the tap path, R5) <!-- R4 -->
- [x] T007 Perform the R6 visible-owner audit in code (xterm cursor + compose `focus:border-accent` coverage of keyboard-up states) and record the outcome in `docs/memory/run-kit/ui/focus-ownership.md` ONLY if the audit surfaces a gap; otherwise note the audit result in the result file <!-- R6 -->

### Phase 4: e2e

- [x] T008 <!-- rework: must-fix — crumb-collapse.spec.ts sets no test.setTimeout and both tests exceed the 10s default (need ~18.5s/~11.5s); add test.setTimeout per the sibling-spec pattern (touch-focus-gate.spec.ts:60) --> Add `app/frontend/tests/e2e/crumb-collapse.spec.ts` (constitution Proves/Steps JSDoc + file header): width-sweep on a terminal route with a long session name asserting no crumb renders under the useful-width floor (ellipsis always present), the collapsed `… ▾` trigger appears below the threshold, its menu navigates to both levels, and the center heading box is never overlapped <!-- R1 -->
- [x] T009 Add `app/frontend/tests/e2e/touch-focus-gate.spec.ts` (constitution Proves/Steps JSDoc + file header; `pointer: coarse` shim + CDP touch per `mobile-touch-scroll.spec.ts`): on an UNLOCKED terminal, a dispatched `contextmenu` (long-press path) does not focus the xterm helper textarea, while a plain tap does focus it <!-- R4 -->

## Execution Order

- T001 blocks T002 (the component consumes the pure helper)
- T002 blocks T003 (collapsed rendering reuses the collapse state)
- T004 is independent of T001-T003 (different file); T005/T006 follow their implementations
- T008/T009 are independent of each other, run last (need the full implementation)

## Acceptance

### Functional Completeness

- [x] A-001 R1: Below the min-useful-width threshold the server+session crumbs collapse into a single `… ▾` BreadcrumbDropdown whose menu navigates to both the server route and the session (current window) level, with a "Navigation" tip on the trigger
- [x] A-002 R2: No crumb ever renders below ~6ch of content width, and every truncated crumb paints its `…` ellipsis; the center heading cell contract (no `min-w-0`, 16ch/28ch caps, grid gap) is unchanged
- [x] A-003 R3: `deriveCrumbsCollapsed` lives in `app/frontend/src/lib/crumb-collapse.ts` as a pure exported function with colocated Vitest coverage
- [x] A-004 R4: On coarse pointers the capture-phase `contextmenu` suppression is installed unconditionally (not gated on `scrollLocked`); unlocked long-press can no longer focus the xterm helper textarea
- [x] A-005 R5: A plain deliberate tap on an unlocked coarse-pointer terminal still focuses the terminal (mousedown path unsuppressed); locked-state suppression is unchanged
- [x] A-006 R6: The visible-owner audit is performed and its outcome recorded (memory cross-reference only if a gap surfaced)

### Behavioral Correctness

- [x] A-007 R1: Collapse is measurement-driven (name-length-sensitive), engages hysteresis on the expand edge, and the pre-existing breakpoint hides (`hidden md:flex` / `hidden sm:flex`) remain the outer rungs
- [x] A-008 R4: Fine-pointer devices see zero behavior change in any lock state (per-event `evaluateMediaQuery` check)

### Scenario Coverage

- [x] A-009 R1: e2e width sweep proves fragment-free crumbs and both-level navigation from the collapsed menu (`crumb-collapse.spec.ts` green via `just test-e2e`)
- [x] A-010 R4: e2e touch emulation proves unlocked long-press/contextmenu does not focus the textarea while a tap does (`touch-focus-gate.spec.ts` green via `just test-e2e`)

### Edge Cases & Error Handling

- [x] A-011 R1: Boundary resize does not flap (hysteresis), and jsdom/zero-measurement environments keep the expanded default (no crash without ResizeObserver/layout)
- [x] A-012 R4: Mid-session pointer-type changes are honored (per-event query evaluation, no setup-time snapshot)

### Code Quality

- [x] A-013: New behavior is covered by tests (Vitest for the derivation and focus gate; Playwright for both user-visible behaviors)
- [x] A-014 Pattern consistency: The collapse measurement mirrors the right-cell ResizeObserver+probe fit pattern; the contextmenu gate reuses the existing capture-phase suppressor pattern and the shared coarse-query constant
- [x] A-015 No unnecessary duplication: `BreadcrumbDropdown` is reused (one optional prop added) rather than a new overflow control; no second media-query literal introduced
- [x] A-016: Comments state constraints/invariants only — no narration, no reviewer addresses, no change-ID citations in new comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one replaced mechanism (the scroll-lock-gated `contextmenu` registration in `terminal-client.tsx`) was folded into the always-on coarse gate in the same diff, not left behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The collapsed menu carries NO `+ New Session` action | The intake's "session crumb's `+ New Session` entry must survive" is stale: 260813-kvk7 deliberately removed the session dropdown (the session crumb is now a static chip; creation lives in the palette + sidebar) and TopBar receives no session-creation handler — re-introducing one would silently revert kvk7 | S:85 R:90 A:90 D:85 |
| 2 | Confident | The session level in the collapsed menu navigates to the current window's route and is marked `current` | A session has no route of its own (kvk7); the current window route is the session's live destination on the terminal route, keeping "both destinations one tap away" without inventing a route | S:65 R:80 A:75 D:65 |
| 3 | Confident | 6ch floor + 24px expand hysteresis | Intake's tentative 6ch floor confirmed from the screenshot reasoning; 24px (~1 control gap) of one-sided hysteresis kills boundary flapping without visibly delaying expansion | S:55 R:80 A:65 D:55 |
| 4 | Confident | `BreadcrumbDropdown` gains one optional `triggerContent` prop for the `… ▾` trigger | The component hardcodes a bare `▾` trigger; an optional prop (default unchanged) is the minimal extension — no fork, no new control (constitution IV) | S:70 R:85 A:75 D:70 |
| 5 | Confident | The nav + crumb section become `flex-1 min-w-0` (transparent layout change) | Content-sized nav shrinks with its content, blinding the expand-back signal; flex-1 keeps the section's width equal to the available space in both states. Visually identical: content is left-aligned on a transparent background | S:60 R:75 A:70 D:60 |

5 assumptions (1 certain, 4 confident, 0 tentative).
