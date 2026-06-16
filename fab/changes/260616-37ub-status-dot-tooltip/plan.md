# Plan: Custom Status-Dot Tooltip / Hover-Card

**Change**: 260616-37ub-status-dot-tooltip
**Intake**: `intake.md`

## Requirements

### Tooltip: Custom hover-card surface

#### R1: Replace native `title` with a custom floating hover-card
The `StatusDot` component SHALL render its dot wrapped by a custom floating hover-card built on `@floating-ui/react`, and SHALL NOT set the native HTML `title` attribute on the dot. The dot MUST retain `role="img"` and `aria-label` (composed by the existing `dotLabel()`).

- **GIVEN** a `StatusDot` rendered on any of the three surfaces (sidebar window row, dashboard card, pane-panel header)
- **WHEN** the dot is inspected in the DOM
- **THEN** it carries `role="img"` and `aria-label`, and carries NO `title` attribute
- **AND** the card is positioned via `useFloating` with `offset()` + `flip()` + `shift({ padding })` and portaled to `document.body` via `FloatingPortal` (escaping the sidebar `overflow:hidden` clip)

#### R2: Open on hover and on focus, dismiss on Escape and pointer-leave
The hover-card SHALL open on pointer hover (with a short open delay) and on keyboard focus of the dot, and SHALL dismiss on Escape, on blur, and on pointer-leave (after a short close grace, with a `safePolygon` bridge so the pointer can travel dot → card to click a link).

- **GIVEN** a `StatusDot` dot
- **WHEN** the pointer hovers the dot for the open delay
- **THEN** the card appears showing the dot's label text
- **AND WHEN** the dot receives keyboard focus (Tab)
- **THEN** the card opens (keyboard-first, Constitution V)
- **AND WHEN** Escape is pressed while the card is open
- **THEN** the card dismisses

#### R3: Docs-link icon on every dot
The hover-card SHALL always render a docs-link icon that opens the status-dot documentation in a new browser tab, on every dot regardless of phase (PR / fab / tmux).

- **GIVEN** any `StatusDot` hover-card is open
- **WHEN** the user activates the docs-link icon (click or keyboard)
- **THEN** the status-dot docs page opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`)
- **AND** the icon is present for PR-phase, fab-phase, and tmux-fallback dots alike

#### R4: PR-phase "Open PR #N" link only on PR dots with a `prUrl`
The hover-card SHALL render a single "Open PR #N" link ONLY when the derived `StatusDotState.phase === "pr"` AND `win.prUrl` is present. Fab-phase and tmux-fallback dots SHALL render no link other than the docs icon. The link target is the existing `win.prUrl` (no derived `/checks` URL).

- **GIVEN** a change-bound window with a PR (`statusDotState().phase === "pr"`) and `prUrl` set
- **WHEN** the card opens
- **THEN** it shows an "Open PR #{prNumber}" link to `win.prUrl`
- **AND GIVEN** a fab-phase dot (change-bound, no PR) OR a tmux-fallback dot (no fab change)
- **WHEN** the card opens
- **THEN** it shows NO PR link (only label text + docs icon)

#### R5: Content resolution via a pure function reusing `dotLabel()`
A pure function `dotTipContent(win, state)` SHALL map a window + its derived `StatusDotState` to `{ label, links }`, reusing the existing `dotLabel()` for the label text unchanged, and emitting the PR link in `links[]` only under the R4 condition. The docs-link icon is NOT part of `links[]` (it is a fixed element the card always renders).

- **GIVEN** a PR-phase window with `prUrl` and `prNumber`
- **WHEN** `dotTipContent(win, state)` is called
- **THEN** it returns `{ label: dotLabel(win, state), links: [{ label: "Open PR #N", href: prUrl, testid: "dot-tip-pr-link" }] }`
- **AND GIVEN** a fab-phase or tmux window
- **WHEN** `dotTipContent` is called
- **THEN** `links` is empty and `label` equals `dotLabel(win, state)`

#### R6: Click-through guard on card links
Every interactive link inside the card (PR link and docs icon) MUST `stopPropagation` on click so activating it does not also select/navigate the underlying clickable window row, mirroring the `PrStatusLine` link pattern.

- **GIVEN** a `StatusDot` inside a clickable sidebar window row
- **WHEN** a card link is clicked
- **THEN** the click does not propagate to the row (no window select/navigate), and the link opens in a new tab

### Styling & Theme

#### R7: Card styling uses existing theme tokens (no new colors)
The card surface SHALL use existing Tailwind theme tokens matching `SwatchPopover` (`bg-bg-primary border border-border rounded-md shadow-lg`, `text-text-secondary`/`text-text-primary`, monospace). It MUST NOT introduce new color tokens or raw hex values.

- **GIVEN** the rendered card
- **WHEN** its classes are inspected
- **THEN** it uses only existing theme tokens (`bg-bg-primary`, `border-border`, `text-text-secondary`, etc.) and no raw hex

### Dependency & Call Sites

#### R8: Add `@floating-ui/react` dependency; call sites untouched
`@floating-ui/react` SHALL be added to `app/frontend/package.json` via pnpm. The three `<StatusDot win={win} />` call sites (sidebar/window-row.tsx, dashboard.tsx, sidebar/status-panel.tsx) MUST remain unchanged one-liners.

- **GIVEN** the change is applied
- **WHEN** `app/frontend/package.json` is inspected
- **THEN** `@floating-ui/react` is a dependency and the lockfile is updated
- **AND** the three call sites still read `<StatusDot win={win} />`

### Tests

#### R9: Unit tests updated and added
The existing `status-dot.test.tsx` assertions on `getAttribute("title")` SHALL be updated to assert on `aria-label` (since `title` is removed). New unit tests SHALL cover `dotTipContent`: PR-phase → one link with correct `href`/label; fab/tmux → zero links; label equals `dotLabel`.

- **GIVEN** the unit test suite
- **WHEN** `just test-frontend` runs the status-dot tests
- **THEN** no test asserts on a `title` attribute, the accessibility tests assert `aria-label`, and `dotTipContent` is covered for all three phases

#### R10: Playwright e2e + companion `.spec.md`
A new Playwright `*.spec.ts` (with sibling `*.spec.md`) SHALL verify: hover dot → card appears; move into card → PR link present/clickable and docs icon present; focus dot → card opens (keyboard); Escape dismisses.

- **GIVEN** the e2e suite scoped to the new spec
- **WHEN** it runs against a mocked change-bound PR window
- **THEN** hovering the dot shows the card, the card carries the PR link and docs icon, focusing the dot opens the card, and Escape dismisses it

### Non-Goals

- Per-state deep-linking of the docs icon (e.g. `#pr-failing`) — explicitly deferred; top-of-doc only.
- Any backend change, new `WindowInfo` field, or new route.
- A separate "view checks" link — dropped (no checks URL on `WindowInfo`).

### Design Decisions

1. **`@floating-ui/react` over hand-rolled positioning**: headless, solves portal-out-of-`overflow:hidden` + edge-flip + `safePolygon` hover-bridge — *Why*: hand-rolling reimplements all three and still needs a portal — *Rejected*: hand-rolled popover (SwatchPopover/PinPopover are click-anchored to a known corner; dots face scroll/edge/clip).
2. **Docs link as a GitHub blob URL**: docs/site is NOT served by the backend; the established convention (`top-bar.tsx` `NOTIFICATIONS_HELP_URL`) links docs to `https://github.com/sahil87/run-kit/blob/main/docs/site/...` — *Why*: consistent with the only existing in-app docs link; "open the doc top" is satisfied by the blob URL (no anchor) — *Rejected*: a local `/docs/...` path (nothing serves it).
3. **Single component owned by `StatusDot`**: one hover-card wrapper; the three call sites stay `<StatusDot win={win} />` — *Why*: StatusDot already has `win`+`state`; scattering wrappers would duplicate logic.

## Tasks

### Phase 1: Setup

- [x] T001 Add `@floating-ui/react` to `app/frontend/package.json` via `pnpm add @floating-ui/react` (run in `app/frontend/`); verify lockfile updates <!-- R8 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/frontend/src/components/status-dot-tip.tsx`: export the pure `dotTipContent(win, state)` function (`DotLink`/`DotTipContent` types) reusing `dotLabel` — but since `dotLabel` is currently private to `status-dot.tsx`, export `dotLabel` from `status-dot.tsx` and import it (single source of truth). Implement the `StatusDotTip` wrapper component using `useFloating` (`offset`/`flip`/`shift`), `FloatingPortal`, `useHover` (delay 150/100 open/close, `handleClose: safePolygon()`), `useFocus`, `useDismiss`, `useRole`, `useInteractions`. Card renders label text + docs-link icon (always) + PR link (from `links[]`); links use `target="_blank" rel="noopener noreferrer"` and `onClick={(e) => e.stopPropagation()}`; style with `bg-bg-primary border border-border rounded-md shadow-lg` theme tokens. Define the docs URL constant (GitHub blob URL to `docs/site/status-dot.md`). <!-- R1 -->
- [x] T003 In `app/frontend/src/components/status-dot.tsx`: export `dotLabel`; drop `title` from the `common` object (keep `role`/`aria-label`); wrap the rendered dot shapes with `StatusDotTip` (pass `win` + `state`), keeping the dot element as the floating reference. The three shape branches share one wrapper. <!-- R1 R5 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Wire the PR-link condition in `dotTipContent`: emit the link only when `state.phase === "pr" && win.prUrl`; fab/tmux emit no links. Ensure docs icon is fixed (not in `links[]`). Confirm click-through `stopPropagation` on both link and docs icon. <!-- R3 R4 R6 -->

### Phase 4: Tests

- [x] T005 Update `app/frontend/src/components/status-dot.test.tsx`: replace the two `getAttribute("title")` assertions (~lines 249, 256) with `aria-label` assertions; assert dots carry NO `title`. Add a `dotTipContent` describe block: PR-phase → one link `{ label: "Open PR #N", href, testid }`; fab-phase → zero links; tmux → zero links; label equals `dotLabel`. <!-- R9 -->
- [x] T006 Add `app/frontend/tests/e2e/status-dot-tip.spec.ts` + sibling `status-dot-tip.spec.md`: mock a change-bound PR window (per `pr-status-sidebar.spec.ts` pattern), assert hover-opens-card with PR link + docs icon, focus-opens-card (keyboard), Escape dismisses, link click-through opens new tab. <!-- R10 -->

## Execution Order

- T001 first (dependency must exist before T002 imports it).
- T002 before T003 (status-dot.tsx imports StatusDotTip).
- T003 before T004 conceptually (T004 refines the content-fn wiring inside T002's file; may be folded into T002 if implemented together).
- T005, T006 after T002–T004 (test the implemented behavior).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `StatusDot` renders a `@floating-ui/react`-based hover-card, portaled to body; the dot has `role="img"` + `aria-label` and NO `title`. (status-dot-tip.tsx:131 FloatingPortal; status-dot.tsx:107-114 role/aria-label/no-title; e2e + unit assert `title` is null.)
- [x] A-002 R2: Card opens on hover (after delay) and on focus; dismisses on Escape, blur, and pointer-leave (safePolygon bridge present). (status-dot-tip.tsx:110-116 useHover delay 150/100 + safePolygon, useFocus, useDismiss; e2e proves hover-open, focus-open, Escape-dismiss.)
- [x] A-003 R3: Every dot (PR/fab/tmux) renders a docs-link icon opening the status-dot docs in a new tab. (status-dot-tip.tsx:155-164 fixed docs link, outside `links[]`; e2e asserts presence on both PR and non-PR dots.)
- [x] A-004 R4: PR-phase dots with `prUrl` render exactly one "Open PR #N" link to `prUrl`; fab/tmux dots render none. (status-dot-tip.tsx:49-55 gate `state.phase === "pr" && win.prUrl`; unit + e2e cover PR/fab/tmux/no-prUrl.)
- [x] A-005 R5: `dotTipContent(win, state)` returns `{ label: dotLabel(win, state), links }` with links populated only under the PR condition. (status-dot-tip.tsx:46-57; unit asserts label === dotLabel and link gating for all phases.)
- [x] A-006 R8: `@floating-ui/react` is in package.json + lockfile; the three call sites remain `<StatusDot win={win} />`. (package.json:15 `^0.27.19` + lockfile; window-row.tsx:260, dashboard.tsx:135, status-panel.tsx:119 all bare `<StatusDot win={win} />`.)

### Behavioral Correctness

- [x] A-007 R6: Clicking a card link does not select/navigate the underlying window row (stopPropagation), and opens in a new tab. (status-dot-tip.tsx:137 card-level stopPropagation + :148/:159 per-link stopPropagation, target=_blank rel=noopener noreferrer; e2e "does not select/navigate" passes.)
- [x] A-008 R1: The native `title` tooltip no longer appears on any of the three surfaces. (status-dot.tsx `common` object has no `title`; the dot is the only StatusDot markup and is shared by all three surfaces; unit asserts `getAttribute("title")` is null.)

### Scenario Coverage

- [x] A-009 R9: Unit tests cover `dotTipContent` for PR/fab/tmux phases and the label-unchanged invariant; `title` assertions are gone, `aria-label` asserted instead. (status-dot.test.tsx:264-313 dotTipContent describe; :250/:253/:259/:260 assert aria-label + `title` null; no `getAttribute("title")` truthy assertion remains. 794 unit tests pass.)
- [x] A-010 R10: Playwright spec proves hover-open, focus-open (keyboard), Escape-dismiss, PR link + docs icon presence, with a sibling `.spec.md`. (status-dot-tip.spec.ts 5 tests, all pass; sibling status-dot-tip.spec.md present with what-it-proves + numbered steps.)

### Edge Cases & Error Handling

- [x] A-011 R4: A PR-phase window with no `prUrl` renders the card with NO PR link (only label + docs icon). (status-dot-tip.tsx:49 `&& win.prUrl` guard; status-dot.test.tsx:286-293 "PR-phase dot WITHOUT a prUrl yields no links".)

### Code Quality

- [x] A-012 Pattern consistency: New code follows surrounding naming/structure (kebab-case file, theme tokens, link pattern from `pr-status-line.tsx`). (kebab-case `status-dot-tip.tsx`; card classes match SwatchPopover token set `bg-bg-primary border border-border rounded-md shadow-lg z-50 w-max`; docs URL matches top-bar.tsx NOTIFICATIONS_HELP_URL convention.)
- [x] A-013 No unnecessary duplication: `dotLabel` is the single label source (exported and reused, not re-implemented); link pattern reused from `PrStatusLine`. (status-dot.tsx:84 exports `dotLabel`; status-dot-tip.tsx:16,47 imports + reuses it; stopPropagation link pattern mirrors pr-status-line.tsx:272.)
- [x] A-014 Type narrowing over `as` casts: prefer type guards / discriminated unions over `as` casts. (No `as` casts in status-dot-tip.tsx; `floatingCardStyle: CSSProperties = floatingStyles` is a typed annotation, not an assertion. `role: "img" as const` in status-dot.tsx is a const-narrowing literal, not a widening cast — acceptable.)
- [x] A-015 Keyboard-first (Constitution V): card is focus-reachable and Escape-dismissable; links keyboard-activatable. (status-dot.tsx:114 `tabIndex={0}` makes the dot a tab stop; useFocus opens on focus; useDismiss closes on Escape; links are real `<a href>` (keyboard-activatable). e2e proves focus-open + Escape-dismiss.)
- [x] A-016 Test Companion Docs: the new `*.spec.ts` ships a sibling `*.spec.md` (what-it-proves + numbered steps). (status-dot-tip.spec.md present, documents all 5 tests with what-it-proves + numbered steps + Shared setup.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The native `title` attribute it replaces was an inline string literal, not a separate symbol/utility; dropping it left no dead code. `dotLabel` was made non-private but is still used, and `PrStatusLine`'s own inline PR link remains in use on the dashboard/pane surfaces.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `@floating-ui/react` for positioning/portal/flip/safe-polygon | User-selected in /fab-discuss; headless; solves clip+flip+bridge (intake assumption 1) | S:95 R:80 A:90 D:95 |
| 2 | Certain | Drop `title`, keep `role="img"`+`aria-label` | Intake assumption 6; avoids double tooltip; a11y name preserved | S:90 R:85 A:95 D:90 |
| 3 | Certain | PR link only on PR-phase dots with `prUrl`; no checks link | Intake assumptions 4+5; `prUrl` is the only PR URL on WindowInfo | S:90 R:82 A:92 D:90 |
| 4 | Confident | Docs icon links to the GitHub blob URL `https://github.com/sahil87/run-kit/blob/main/docs/site/status-dot.md` (top, new tab) | docs/site is not served by the backend; the sole existing in-app docs link (top-bar.tsx NOTIFICATIONS_HELP_URL) uses exactly this GitHub-blob convention; "open the doc top" = blob URL with no anchor | S:80 R:85 A:80 D:80 |
| 5 | Confident | Export `dotLabel` from status-dot.tsx and reuse it in dotTipContent | dotLabel is currently file-private; exporting keeps it the single label source (intake reuse mandate) rather than duplicating | S:85 R:90 A:85 D:85 |
| 6 | Confident | `status-dot-tip.tsx` + `dotTipContent` naming | Intake assumption 12; kebab-case matches existing components; cosmetic/reversible | S:75 R:95 A:80 D:80 |
| 7 | Tentative | Open/close hover delays 150ms / 100ms | Intake assumption 11; reasonable snappy default, tunable post-impl | S:55 R:95 A:55 D:65 |

7 assumptions (3 certain, 3 confident, 1 tentative).
