# Plan: Web Tile Always-Tileable with Onboarding Empty State

**Change**: 260821-zqlq-web-tile-always-tileable-onboarding
**Intake**: `intake.md`

> The intake's § What Changes carries the user-approved onboarding copy verbatim and the full
> ripple table — requirements below bind to it rather than restating every string.

## Requirements

### Window Views: availability

#### R1: Web is always available; `hasWebUrl` becomes the content selector
`availableViews` (`app/frontend/src/lib/window-view.ts`) MUST include `"web"` unconditionally (HINT_ORDER position unchanged). `hasWebUrl` SHALL remain exported and unchanged in behavior — it becomes the content selector (onboarding vs iframe) and the web toggle-dot signal. `defaultView` MUST NOT change: a URL-less window still defaults `tty`; `rkType === "iframe"` + URL still hints web.

- **GIVEN** a window with empty `@rk_url`
- **WHEN** `availableViews(win)` runs
- **THEN** the result includes `"web"` (and `defaultView(win)` is still `"tty"`)

#### R2: Tile availability and deep links follow
`availableTiles` (`app/frontend/src/lib/surface-layout.ts`) MUST include `web` unconditionally, purely via the predicate — no degradation-ladder special-case. Consequence to prove: a `?layout=…web…` deep link on a URL-less window keeps its web tile; `lib/right-panel.ts` follows by delegation with no edit.

- **GIVEN** `?layout=split-h:tty,web` on a URL-less window
- **WHEN** `resolveLayout` runs
- **THEN** the resolved order retains `web` (previously degraded away)

### Top Bar: toggle dot

#### R3: Per-surface dot predicate — web dot = has-content
`SurfaceToggleGroup` (`app/frontend/src/components/top-bar.tsx` ~370-428, both toggle and switch modes, plus the overflow Tiles rows if they carry the dot) MUST render the web button always, with its corner availability dot driven by `hasWebUrl(win)`; every other surface's dot stays always-on (their shown-equals-available semantics untouched). Mechanism: a per-surface dot predicate plumbed from `app.tsx` (assumption 4 — shape is apply's call).

- **GIVEN** a URL-less window on the terminal route
- **WHEN** the top bar renders
- **THEN** the web toggle button renders WITHOUT its corner dot; setting `@rk_url` lights the dot

### Iframe Window: onboarding state

#### R4: Onboarding content when `rkUrl` is empty
`IframeWindow` MUST render the onboarding state when `rkUrl` is empty/whitespace, per intake § What Changes 3 (user-approved copy — reproduce it): the reduced URL bar (refresh button + fully-live address input with placeholder `localhost:3000 · /present/… · https://…`; back/forward, find ⌕, and ↗ hidden), and the body panel replacing the iframe (dimmed `://` glyph, "Nothing to show yet" heading, the @rk_url subhead, the three instruction rows with accent-green lead glyphs and `bg-bg-inset` code chips, the goes-live footer). The address input MUST run the existing submit pipeline (`normalizeAddressInput` → `isAllowedUrl` → `updateWindowUrl`) so Enter boots the tile for real. No frame-check/dead-port probing runs in onboarding.

- **GIVEN** a web tile opened via ⌘3 on a URL-less window
- **WHEN** it renders
- **THEN** the onboarding panel and reduced bar render (no iframe, no probes)
- **AND** typing `localhost:3000` + Enter POSTs `@rk_url` via `updateWindowUrl`

#### R5: Onboarding tile header is the plain form
The tile header for an onboarding web tile MUST render the plain `://  Web` label — no kind badge, no page title, no meta chip. `classifyAddress`/header derivation MUST NOT throw on empty input (guard in `surface-layout.tsx`'s header render or `lib/web-url.ts` as needed).

- **GIVEN** the onboarding web tile
- **WHEN** its header renders
- **THEN** it shows glyph + `Web` label only, and no exception is thrown

#### R6: Live flip via the existing SSE seam
When `rkUrl` transitions empty → non-empty (agent `rk present`, or the address-bar submit), the tile MUST flip onboarding → live iframe with no user action, via the existing `rkUrl` sync effect. `present-auto-expand` semantics untouched. The reverse (non-empty → empty) returns to onboarding.

- **GIVEN** an open onboarding web tile
- **WHEN** SSE delivers a non-empty `rkUrl`
- **THEN** the live iframe (full URL bar) replaces the onboarding panel

#### R7: Find gating in onboarding
The ⌕ find entry point renders only when content exists (already hidden per R4); the `Web: Find in page` palette entry and the `webOnly` ⌘F chord MUST no-op sanely on an onboarding tile (no crash, the find bar cannot open). Simplest conforming implementation: gate the find-open seam on `hasWebUrl` (assumption 5).

- **GIVEN** focus on an onboarding web tile
- **WHEN** ⌘F is pressed
- **THEN** nothing opens and nothing throws

### Specs

#### R8: Spec carve-outs
`docs/specs/window-views.md` (R1/R3 + the lens table's web row) and `docs/specs/surface-layout.md` (its web-availability restatements ~79, ~213-226) MUST be edited to state: web is always available; `@rk_url` selects CONTENT — worded on the code row's existing availability-vs-reachability model.

- **GIVEN** the two specs
- **WHEN** read after this change
- **THEN** no statement claims web availability derives from `@rk_url`

### Tests

#### R9: Unit + e2e coverage, old-gating assertions flipped
Unit: per intake § What Changes 7 — `window-view.test.ts`, `surface-layout.test.ts`, `palette-view.test.ts`/`palette-layout.test.ts`, `iframe-window.test.tsx` (onboarding suite incl. the Enter-submit and the flip), `top-bar.test.tsx` (dot). Every existing assertion of the OLD gating flips to assert the new behavior. E2E: extend `web-view-lens.spec.ts` (or one sibling) — ⌘3 on a URL-less real-tmux window opens onboarding; typing `localhost:{port}` boots the iframe; `tmux set-option -w @rk_url` flips it live; the existing "View: Web only on web-capable windows" and "?view=web falls back to terminal" cases flip. Any touched `.spec.ts` updates its `.spec.md` sibling in the same commit. Perf budget: ≤2 tiles per test.

- **GIVEN** the updated suites
- **WHEN** `just test-frontend` and the touched e2e specs run
- **THEN** all pass with the new behavior asserted

### Non-Goals
- `chat`/`code` availability, `SURFACE_RAIL_HIDDEN`, `@rk_type` semantics, backend/API, board pages, desktop lens, `present-auto-expand` — all untouched.

### Design Decisions

#### Web adopts the code-surface availability-vs-content split
**Decision**: Web availability becomes unconditional (the lens exists); `hasWebUrl` selects the content (onboarding vs live iframe), exactly as code splits availability from reachability.
**Why**: The single `hasWebUrl` predicate gated six consumer surfaces, making the tile undiscoverable before initialization; the split is already the codebase's named model for "the lens exists but has nothing to show", and the onboarding state doubles as the discoverability surface the tile lacked.
**Rejected**: A ⌘3-only carve-out (chord opens a tile the availability model says doesn't exist) — the layout resolver would drop the tile anyway, so the resolver, toggles, and palette would each need contradictory special-cases; a modal/tooltip explainer — doesn't give the live address bar or the automatic flip.
*Introduced by*: 260821-zqlq-web-tile-always-tileable-onboarding

#### Web toggle dot means "has content"
**Decision**: The web toggle button always renders; its corner dot is driven by `hasWebUrl`. Other surfaces' dots are untouched.
**Why**: The button's presence is the discoverability fix; the dot preserves the at-a-glance "something to see" signal the old appearance/disappearance carried.
**Rejected**: Dotless always-on web button — loses the content signal; hiding the button until content exists — recreates the discoverability hole.
*Introduced by*: 260821-zqlq-web-tile-always-tileable-onboarding

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/frontend/src/lib/window-view.ts`: `availableViews` includes web unconditionally (doc comments updated: hasWebUrl = content selector); update `window-view.test.ts` <!-- R1 -->
- [x] T002 `app/frontend/src/lib/surface-layout.ts`: `availableTiles` web-unconditional; update `surface-layout(.test).ts` availability/degradation cases <!-- R2 -->
- [x] T003 `app/frontend/src/components/iframe-window.tsx`: onboarding branch — reduced URL bar (refresh + live address input, placeholder; back/forward/find/↗ hidden), onboarding body + footer per intake copy, no probes; live flip when `rkUrl` becomes non-empty (existing sync effect) <!-- R4 -->
- [x] T004 `app/frontend/src/components/surface-layout.tsx`: onboarding header guard — plain `://  Web` label, no badge/meta on empty `rkUrl`; verify `classifyAddress`/`displayForm` empty-input safety (`lib/web-url.ts` guard if needed) <!-- R5 -->
- [x] T005 `app/frontend/src/components/top-bar.tsx` + `app.tsx`: per-surface dot predicate (web = `hasWebUrl`, others constant-true) across toggle mode, switch mode, and overflow Tiles rows if dotted <!-- R3 -->
- [x] T006 Find gating: ⌘F/`Web: Find in page` no-op on onboarding tiles (gate the find-open seam on `hasWebUrl`); verify the `ungatedIds` window-switch classification needs no change (add a unit case if cheap) <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Unit suites: `iframe-window.test.tsx` onboarding suite (render, hidden affordances, Enter-submit → `updateWindowUrl`, flip both directions), `top-bar.test.tsx` dot cases, `palette-view.test.ts`/`palette-layout.test.ts` web-entry cases; flip every old-gating assertion <!-- R9 -->
- [x] T008 E2E: extend `app/frontend/tests/e2e/web-view-lens.spec.ts` (+ `.spec.md` in the same commit) — ⌘3 onboarding open, address-bar boot, `tmux set-option` live flip; flip the two old-gating cases; ≤2 tiles per test <!-- R9 -->
- [x] T009 [P] Spec edits: `docs/specs/window-views.md` (R1/R3 + web lens row) and `docs/specs/surface-layout.md` (availability restatements) per R8 <!-- R8 -->

### Phase 4: Polish

- [x] T010 Verification gates: scoped Vitest suites, full `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just test-e2e "web-view-lens.spec.ts web-tile-find.spec.ts surface-layout.spec.ts"` (find gating + layout ripple coverage) <!-- R9 -->

## Execution Order

- T001 → T002 (predicate before consumers); T003/T004/T005 after T002; T006 after T003; T007 after its subjects; T008 after T003-T006; T009 independent [P]; T010 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `availableViews` always includes web; `hasWebUrl` exported/unchanged; `defaultView` still tty for URL-less windows
- [x] A-002 R2: `availableTiles` always includes web; a `?layout=…web…` deep link on a URL-less window keeps the web tile; `right-panel.ts` unedited
- [x] A-003 R3: web toggle always renders with a `hasWebUrl`-driven dot in toggle AND switch modes; other surfaces' dots unchanged
- [x] A-004 R4: onboarding state renders per the approved copy (heading, subhead, three rows, footer) with the reduced live URL bar; Enter submits through the existing pipeline; no probes fire

### Behavioral Correctness

- [x] A-005 R6: empty→set `rkUrl` flips onboarding→iframe in place (and set→empty returns to onboarding); `present-auto-expand` behavior unchanged
- [x] A-006 R5: onboarding tile header is the plain label — no badge/meta, no throw on empty address
- [x] A-007 R7: ⌘F and the find palette entry are inert on an onboarding tile (no crash, no bar)

### Scenario Coverage

- [x] A-008 R9: e2e proves ⌘3 opens onboarding on a URL-less window, the address-bar boot, and the set-option live flip; the two flipped legacy cases assert the new behavior; touched `.spec.ts` files carry `.spec.md` updates
- [x] A-009 R8: both specs state the carve-out; no spec line still ties web AVAILABILITY to `@rk_url`

### Edge Cases & Error Handling

- [x] A-010 R4: whitespace-only `@rk_url` renders onboarding (trim rule); invalid address submit shows the existing inline `role="alert"` error with no POST

### Code Quality

- [x] A-011 Pattern consistency: onboarding markup follows the codebase's empty-state/monospace conventions; no new module where an existing one serves
- [x] A-012 No unnecessary duplication: the address-input submit path is the existing pipeline, not a parallel one; dot predicate threaded, not duplicated per mode

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/lib/surface-layout.ts` import of `hasWebUrl` — dead after `availableTiles` went unconditional; removed in the change itself.
- `app/frontend/src/lib/right-panel.test.ts` case "offers only tty without a usable rkUrl" — asserted the retired availability gate; deleted in the change (folded into the unconditional tty+web case).
- `app/frontend/tests/e2e/web-view-lens.spec.ts` case "?view=web on a window with no @rk_url falls back to the terminal" — asserted the retired degradation; replaced in the change by the onboarding-resolution case.
- `app/frontend/tests/e2e/right-panel.spec.ts` count-0 `Web tile` assertions — pinned the retired availability gate; flipped in the change to assert always-rendered + dot semantics.
- `docs/specs/window-views.md` lens-table web row's "`@rk_url` set" availability clause — superseded by the always-available carve-out; edited in the change.

No further candidates found — the change makes the `hasWebUrl`-gated availability branches redundant and removes/updates each one; no leftover dead code beyond that.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Dot predicate threaded as a prop/map from `app.tsx` into `SurfaceToggleGroup` (exact shape = apply's judgment) | Intake assumption 4 delegates the prop shape; direction fixed | S:80 R:85 A:85 D:75 |
| 2 | Confident | Onboarding body lives inside `IframeWindow` as a content branch (not a new sibling component) unless its size argues otherwise at apply | Keeps the rkUrl-sync flip trivially correct; IframeWindow already branches for error states | S:75 R:85 A:85 D:75 |
| 3 | Confident | E2E lands as an extension of `web-view-lens.spec.ts` (not a new file) unless the flows crowd it | Intake assumption 11 delegates extend-vs-new; extension keeps the `_tmux.ts` rig shared | S:70 R:90 A:80 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
