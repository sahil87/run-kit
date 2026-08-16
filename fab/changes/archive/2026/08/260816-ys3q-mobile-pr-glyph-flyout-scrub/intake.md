# Intake: Mobile PR-Status Parity + Flyout Scrub Gesture

**Change**: 260816-ys3q-mobile-pr-glyph-flyout-scrub
**Created**: 2026-08-17

## Origin

Created via a promptless-defer dispatch (`/fab-proceed` create-new path) from a synthesized design-discussion summary. The direction is **user-approved** — the five decisions below were made in that discussion; this intake transfers them verbatim.

> Mobile PR-status parity + flyout scrub gesture (sidebar window rows, coarse pointers).
>
> On mobile (coarse pointers) the sidebar window rows carry NO at-rest PR signal: the rest-state PR glyph (`window-row.tsx`, gated by `prOwnsGlyph`, colored by `prGlyphColor`) is `coarse:hidden` because the pin/✕ action cluster is always visible on coarse pointers (`coarse:opacity-100`) and permanently occupies the glyph's slot. The StatusDot deliberately renders no PR state (the local/remote split). So desktop can scan "which windows have PRs and how are they doing" while mobile cannot — a mechanical fallout of the coarse-pointer rule, not a design decision. Additionally, tapping a row on mobile navigates, so there is no way to inspect a window's status without leaving the current window; the existing coarse-pointer affordance — tapping the status dot (the `status-dot-tap` span) opens the row flyout card with the full four-register view — exists and is e2e-proven but is undiscoverable (a ~7px dot with no visual hint).

**Decisions made (user-approved)**:

1. **Rest-state PR glyph visible at rest on coarse rows** — same `prOwnsGlyph` gate, same `prGlyphColor` six-way color chain, same state-picked icons (`GitPullRequestIcon` / `GitPullRequestClosedIcon`); the change is who owns the last slot at rest on coarse.
2. **Relocate pin/✕ on coarse into the row flyout card** — on coarse pointers the always-visible action cluster no longer renders at rest; the flyout card (already the mobile detail surface, opened by dot-tap) grows pin and kill action rows. Side benefit: an always-visible ✕ per row is a fat-finger hazard on a phone. Desktop (fine pointer) behavior unchanged: hover-revealed cluster, glyph display-swap on hover.
3. **Widen the coarse dot-tap target** into a proper leading tap zone on the row so the flyout is findable and comfortable to hit.
4. **Slide-to-scrub gesture**: on coarse pointers, `pointerdown` on the dot/tap zone opens that row's flyout card and captures the pointer (`setPointerCapture`); on `pointermove`, hit-test the finger position against sibling window rows and retarget the single-open flyout card to whichever row the finger is over (imperative `openNow()`/`close()` via the existing module-scoped single-open coordinator in `useRowFlyout`); on release the last card stays open; tapping elsewhere dismisses (existing `useDismiss` outside-press). The scrub NEVER selects/navigates rows. This is the touch translation of the desktop hover sweep (warm-window retarget).
5. **Scroll-conflict resolution**: gesture-starts-on-dot ⇒ scrub, elsewhere ⇒ scroll. The dot tap zone gets `touch-action: none` so a drag beginning there is always a scrub; drags beginning anywhere else on the row scroll the drawer normally. Predictable, no timing gesture.

**Alternatives rejected (in the discussion)**:

- Long-press-to-enter-scrub-mode (iOS context-menu style): adds a hidden timing gesture on top of an already-hidden affordance; worse discoverability.
- New drawer "status section"/glance mode: new surface area against Constitution IV when the row tree + flyout can carry it.
- Mobile status-bar/bottom-bar PR chip for the current window: **deferred** — the selected window's PR detail is already reachable via the PANE panel's L3 register and the flyout; 375px bottom-bar space is scarce.

## Why

1. **Pain**: Mobile users cannot scan PR status across windows. The at-rest PR glyph — the row's ONLY PR channel (the dot renders no PR state by design; local/remote split, `docs/memory/run-kit/ui/status-signals.md` § Status Dot) — is `coarse:hidden`, so a phone shows zero PR signal at rest. And the one mobile path to a window's status detail (dot-tap → flyout card) is a ~7px target with no visual hint, while a row tap navigates away from the current terminal.
2. **Consequence of not fixing**: the primary mobile use case ("glance at my agents/PRs from my phone") stays broken — the mobile dashboard answers "what windows exist" but not "which have PRs and how are they doing", which the desktop answers at a glance. The status-detail affordance remains effectively undiscovered.
3. **Why this approach**: it restores parity by *reallocating* the existing last slot (the coarse cluster's permanent occupation of it is a mechanical fallout, not a design decision) and by *promoting* the existing, e2e-proven flyout card to the full mobile action+detail surface — no new routes, panels, or drawer sections (Constitution IV). The scrub gesture is the direct touch translation of the desktop hover sweep the card already implements (warm-window retarget, single-open coordinator), and the gesture-starts-on-dot rule resolves the scroll conflict without timing heuristics. Relocating ✕ behind one tap also removes a fat-finger kill hazard.

## What Changes

All frontend, `app/frontend/src/`. No backend changes; no new data plumbing — every surface reads the already-streamed `WindowInfo`.

### 1. Rest-state PR glyph at rest on coarse (`components/sidebar/window-row.tsx`)

- Remove `coarse:hidden` from the rest-state PR glyph span (currently `className={...pointer-events-none group-hover:hidden coarse:hidden group-has-[:focus-visible]/icons:hidden ${prGlyphColor(win)}}`, window-row.tsx ~line 599). The fine-pointer display swap (`group-hover:hidden`, `group-has-[:focus-visible]/icons:hidden`) stays — desktop behavior unchanged.
- Gate (`prOwnsGlyph`), color chain (`prGlyphColor` six-way), state-picked icon (`prState === "closed" ? GitPullRequestClosedIcon : GitPullRequestIcon`), `aria-hidden`, `pointer-events-none`, and `data-testid="row-pr-glyph"` are all unchanged (`components/pr-status-model.ts` untouched).
- Ghost rows render no glyph (unchanged: `!ghost && prOwnsGlyph(win)`).
- The `SessionTiles` window-tile glyph and the PANE panel are unchanged.

### 2. Coarse action-cluster relocation into the flyout card

**Window row** (`window-row.tsx`): on coarse pointers the trailing pin/✕ cluster no longer renders at rest — and since coarse has no hover, that means the in-row cluster is effectively fine-pointer-only. Remove the coarse reveal/enable classes from the cluster (`coarse:pointer-events-auto` on the `group/icons` container; `coarse:opacity-100` + `coarse:min-w-[32px] coarse:min-h-[36px]` on the pin and kill buttons) or gate the cluster's render on the already-present `useCoarsePointer()` value — implementer's choice; the behavioral contract is: **coarse at rest = no pin/✕ visible or hittable; the last slot shows the PR glyph when owned**. Fine-pointer rest/hover/focus behavior is byte-identical to today (rest `[pin][PR]` → hover `[pin][✕]`, zero layout shift, `pr-[68px]`/`pr-11` reserved padding unchanged).

- On coarse, pinned rows consequently show **no at-rest pin cue** (the persistent accent/monochrome pin glyph is part of the relocated cluster); pin state is readable in the flyout card's pin action row. This follows the approved decision literally and matches Row Minimalism (the PR glyph is "the one status signal Row Minimalism admits beside the dot" — `docs/memory/run-kit/ui/sidebar.md` § Rest-state PR glyph).

**Flyout card** (`components/sidebar/row-flyout-card.tsx`): `RowFlyoutContent` grows two **action rows** — Pin and Kill — below the registers/links:

- **Pin row**: label reflects pin state (e.g. `Pin to board…` / pinned indication); activating it closes the card and opens the existing `PinPopover` anchored to the row — the same popover the coarse pin button opens today, and the `suppressed` gate already includes `showPinPopover`, so popover-over-flyout precedence is pre-wired. No inline board list in the card.
- **Kill row**: routes through the existing `onKillClick(srv, session, windowId, …)` → `KillDialog` confirmation path — no new kill path, no confirm bypass (kill on touch always confirms; there is no modifier-force on touch).
- Both rows follow the card's existing `stopPropagation` discipline (the PR-link/fork/docs idiom) so activating an action never selects the underlying row. Callbacks thread through `UseRowFlyoutOptions` the way `onFork` already does (optional callbacks; a consumer wiring none — e.g. surfaces without kill — renders no row, the established optional-prop idiom).
- The action rows render for **all pointer types** (the card is one surface): on desktop they are additive (hover cluster remains the primary path) and give the keyboard-focused row a Tab-reachable pin/kill inside the card via the existing `FloatingFocusManager` order — Constitution V's reachability is strengthened, nothing is removed.

### 3. Widened coarse tap zone (`window-row.tsx`)

- The `data-testid="status-dot-tap"` span (currently a shrink-wrapped `flex items-center shrink-0` wrapper around `<StatusDot>`) grows on coarse into a proper leading tap zone using the sidebar's coarse touch-target tokens (≥32px wide, ~36px tall — the `coarse:min-w-[32px] coarse:min-h-[36px]` convention from the row icon system), coarse-only classes so fine-pointer layout is untouched. The zone must not change row height on fine pointers or introduce layout shift there.
- The zone carries `touch-action: none` (coarse behavior), implementing decision 5: a drag starting on the zone is always a scrub; drags starting elsewhere on the row scroll the drawer normally.

### 4. Slide-to-scrub gesture (`window-row.tsx` + `row-flyout-card.tsx`)

- **Down**: on coarse, non-ghost rows, `pointerdown` on the tap zone calls `flyout.openNow()` (replacing/subsuming the current `onClick` handler; still stops propagation so it never selects the row) and captures the pointer (`setPointerCapture(e.pointerId)`).
- **Move**: while captured, hit-test the finger position (`document.elementFromPoint(clientX, clientY)` or row bounding-rect lookup) against rendered window rows; when the finger is over a **different non-ghost window row** (any session/server group — desktop hover-sweep parity), retarget the single-open card: invoke that row's `openNow()` (the module-scoped `activeFlyout` coordinator already closes the previous card on open). Non-row elements under the finger (session headers, gaps, panels) leave the current card open — no flicker-close.
- **Up/cancel**: release capture; the last card **stays open**. Tapping elsewhere dismisses via the existing `useDismiss` outside-press. The drawer does not close on scrub release (nothing navigated).
- **Never navigates**: the scrub never calls `onSelectWindow`; row selection stays exactly the row-body tap.
- **Retarget mechanism**: a module-scoped registry beside the existing `activeFlyout`/`lastClosedAt` coordinator in `row-flyout-card.tsx` maps row DOM elements → imperative handles (`openNow`); each row registers on mount / unregisters on unmount (inside `useRowFlyout`, which already holds the row-local handles). This honors every § Render Performance invariant: open state stays row-local (never lifted into `Sidebar`), the card body mounts only while open, no per-second tick enters rows, `WindowRow` stays `memo`'d with referentially stable props.
- Suppressed rows (ghost, pin popover / label picker open) are skipped naturally by `openNow()`'s existing `suppressed` early-return.

### 5. Tests

- **Unit** (`window-row.test.tsx`, `row-flyout-card.test.tsx`): glyph no longer coarse-hidden; cluster not rendered/hittable at rest under a mocked coarse pointer; tap-zone geometry + `touch-action` classes; pointerdown-opens wiring; card action rows (render, `stopPropagation`, kill → `onKillClick`, pin → popover handoff); registry register/unregister + retarget helper logic.
- **E2E**: extend `tests/e2e/row-flyout.spec.ts` **and its sibling `row-flyout.spec.md`** in the same commit (Constitution — Test Companion Docs). Coarse-pointer emulation via a `hasTouch` context + direct `goto` (the mobile-spec pattern). New coverage: at-rest PR glyph visible on coarse; no pin/✕ at rest on coarse; widened tap zone opens the card; card kill row opens the kill dialog; card pin row opens the pin popover; scrub — pointerdown + move retargets the card across rows, release keeps the last card open, no navigation occurred, tap-elsewhere dismisses. **Update existing assertions** that encode the old behavior (the "rest glyph → hover swap" and coarse dot-tap cases). Run only via `just test-e2e` / `just pw` (port-3020 isolation), never Playwright directly.

## Affected Memory

- `run-kit/ui/status-signals.md`: (modify) — § Row-hover register flyout card (pin/kill action rows, scrub retarget + registry, widened coarse tap zone, `touch-action` rule); § Status Dot call-sites (the `status-dot-tap` wrapper's new pointerdown/scrub semantics).
- `run-kit/ui/sidebar.md`: (modify) — § Rest-state PR glyph (coarse rest visibility; the coarse branch of the swap rule); § Sidebar Row Icon System / window-row cluster scope (coarse cluster relocation, fine-pointer-only reveal); § Render Performance (the scrub coordinator's row-local/module-scope constraint, if stated).

## Impact

- **Frontend only**: `components/sidebar/window-row.tsx`, `components/sidebar/row-flyout-card.tsx` (+ their unit tests), `tests/e2e/row-flyout.spec.ts` + `row-flyout.spec.md`. `pr-status-model.ts`, `sidebar/registers.ts`, `status-dot.tsx`, backend: untouched.
- **Constitution IV**: no new routes/panels/surfaces — the flyout card absorbs the mobile actions; rejected alternatives (drawer status section, bottom-bar PR chip) stay out.
- **Constitution V**: no capability removed — pin/kill stay reachable on coarse (flyout rows), on desktop (unchanged hover cluster + now also Tab-reachable card rows), and via existing palette/dialog paths.
- **Render performance**: the § Render Performance invariants (memo tree, leaf-scoped clocks, row-local flyout state) are load-bearing constraints on the scrub coordinator design.
- **Risk**: real-device Safari pointer-capture fidelity (see Open Questions); e2e covers chromium/webkit emulation.

## Open Questions

- Real-Safari `setPointerCapture` fidelity for the scrub: project memory records a prior gesture bug reproducible only on real Safari (synthetic chromium/webkit e2e passed). Device verification of the scrub on iOS Safari is prudent before calling the gesture done; not a design blocker.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Rest-state PR glyph visible at rest on coarse by removing `coarse:hidden`; gate (`prOwnsGlyph`), color (`prGlyphColor`), state-picked icons unchanged | Discussed — user-approved decision 1; verbatim mechanism named in the discussion | S:90 R:85 A:90 D:95 |
| 2 | Certain | On coarse, the pin/✕ cluster no longer renders at rest (effectively fine-pointer-only); pin+kill relocate into flyout-card action rows; fine-pointer behavior byte-identical | Discussed — user-approved decision 2, incl. the fat-finger rationale | S:90 R:75 A:85 D:90 |
| 3 | Certain | Widened coarse leading tap zone with `touch-action: none`; drag from zone = scrub, elsewhere = drawer scroll | Discussed — user-approved decisions 3 + 5 (chosen over long-press) | S:88 R:82 A:85 D:90 |
| 4 | Certain | Scrub: pointerdown opens + `setPointerCapture`; pointermove hit-tests and retargets the single-open card via imperative `openNow()`; release keeps last card; never selects/navigates | Discussed — user-approved decision 4, mechanism named (coordinator, `elementFromPoint`) | S:90 R:70 A:80 D:85 |
| 5 | Certain | Ghost rows: no glyph, no scrub-open | Explicit in the description + existing `!ghost` gate and `suppressed` early-return | S:80 R:90 A:90 D:90 |
| 6 | Certain | Tests: unit for gating/geometry + Playwright e2e extending `row-flyout.spec.ts` with sibling `.spec.md`, hasTouch coarse emulation, `just test-e2e`/`just pw` only | Constitution (Test Companion Docs) + config test conventions + explicit constraint in description | S:85 R:90 A:90 D:90 |
| 7 | Certain | No new surfaces: reuse flyout card, `pr-status-model.ts`, `sidebar/registers.ts`; rejected alternatives stay rejected (bottom-bar chip deferred) | Constitution IV + explicit rejected-alternatives list in the discussion | S:85 R:80 A:90 D:90 |
| 8 | Confident | Tap-zone geometry uses the sidebar coarse touch-target tokens (≥32px wide, ~36px tall), coarse-only classes, no fine-pointer layout shift | Exact px unspecified; `coarse:min-w-[32px] coarse:min-h-[36px]` is the established row-cluster convention (sidebar.md § Sidebar Row Icon System) | S:60 R:85 A:80 D:70 |
| 9 | Confident | Flyout action rows render for all pointer types (desktop card too) — additive on desktop, Tab-reachable via the existing `FloatingFocusManager` | Constraint text names the card as the keyboard-reachable home for pin/kill; universal content is simpler than a pointer-forked card | S:60 R:85 A:70 D:65 |
| 10 | Confident | Kill row routes through existing `onKillClick` → `KillDialog` confirm; no new kill path, no confirm bypass on touch | Reuse over reinvention (code-quality anti-pattern list); fat-finger rationale argues for confirm | S:65 R:80 A:85 D:85 |
| 11 | Confident | Pin row closes the card and opens the existing `PinPopover` anchored to the row (no inline board list in the card) | `PinPopover` is today's production coarse pin path, and the flyout's `suppressed` gate already includes `showPinPopover` — precedence pre-wired; Constitution IV | S:45 R:70 A:70 D:60 |
| 12 | Confident | On coarse, pinned rows show no at-rest pin cue; pin state is readable in the flyout card | Literal reading of decision 2; Row Minimalism admits only the PR glyph beside the dot (sidebar.md), so an informational pin overlay would breach it | S:50 R:75 A:65 D:60 |
| 13 | Confident | Scrub retarget scope: any rendered non-ghost window row across sessions/server groups; non-row elements under the finger keep the current card open | Desktop hover-sweep parity (the stated model) — hover retargets across all rows; anti-flicker default has one obvious shape | S:55 R:80 A:75 D:70 |
| 14 | Confident | Retarget mechanism: module-scoped row-element→`openNow` registry beside the existing `activeFlyout` coordinator; registered in `useRowFlyout`; open state stays row-local | Follows the established module-scope coordinator pattern and the § Render Performance constraints named in the description | S:55 R:70 A:75 D:65 |
| 15 | Confident | Scope excludes `SessionRow`'s coarse always-visible cluster and `SessionTiles` — window rows only | Title + description scope explicitly to sidebar window rows; session-row cluster serves different (non-fat-finger-kill… palette/spawn/create) actions | S:65 R:85 A:75 D:75 |

15 assumptions (7 certain, 8 confident, 0 tentative, 0 unresolved).
