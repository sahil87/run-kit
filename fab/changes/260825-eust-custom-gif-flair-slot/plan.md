# Plan: Custom GIF Flair Slot

**Change**: 260825-eust-custom-gif-flair-slot
**Intake**: `intake.md`

## Requirements

### Flair Vocabulary: `custom` closed sets

#### R1: Frontend closed set gains `custom`
`FLAIR_STATES` in `app/frontend/src/themes.ts` MUST gain `"custom"` appended after the branch's last token (`"spidey"` — this branch is off `origin/main` and does not contain the ironman PR; the adjacent-line merge with PR #739 is expected and accepted).

- **GIVEN** the picker's flair band derives from `FLAIR_STATES.slice(1)`
- **WHEN** `FLAIR_STATES` contains `"custom"`
- **THEN** the band renders a 14th live-preview cell on this branch (computed 7/7 split), no component change to the split logic

#### R2: Backend closed set gains `custom` in lockstep
`flairTokens` in `app/backend/internal/validate/validate.go` MUST gain `"custom"` (same position note), so all three `@rk_flair`-family write paths accept it.

- **GIVEN** a `POST` writing `@rk_flair`, `@rk_session_flair`, or a `server_flairs` entry with value `"custom"`
- **WHEN** the handler validates via `ValidateFlairValue`
- **THEN** the write succeeds, and unknown tokens still fail

### Backend: runtime asset serving

#### R3: Fixed config-dir asset convention, no upload surface
The asset MUST be resolved from fixed filenames in the config root, in preference order: `~/.config/run-kit/custom-flair.webp`, then `~/.config/run-kit/custom-flair.gif`. There MUST be no upload UI, no upload endpoint, no settings-registry key, and no user-controlled path input (fixed names only — no traversal surface, Constitution I/IV/VII). Resolve the config root through the same helper the settings/config code already uses (never hand-build `$HOME` paths).

- **GIVEN** both files exist
- **WHEN** the route resolves the asset
- **THEN** the `.webp` wins

#### R4: `GET /api/flair/custom` serves the asset request-time
A read-only route MUST read the resolved file at request time (no cache — Constitution II), respond with `Content-Type` from the matched extension (`image/webp`/`image/gif`), a content-derived `ETag` honoring `If-None-Match` (304), and `Cache-Control: no-cache`; it MUST 404 when no file exists. Read must use a bounded/context-safe pattern consistent with neighboring handlers. Register the route among the existing GET routes; CORS/method posture unchanged (read = GET, Constitution IX untouched).

- **GIVEN** no asset file exists
- **WHEN** the route is hit
- **THEN** 404 (and a row with `custom` simply paints nothing — the token is inert)
- **GIVEN** `custom-flair.gif` exists
- **WHEN** the route is hit twice with the returned ETag
- **THEN** the second response is 304

#### R5: Vite dev proxy entry
`app/frontend/vite.config.ts` MUST proxy `/api/flair` to the backend in dev (mirroring the existing `/generated-icons`-style proxy entry) so `just dev` serves the asset.

- **GIVEN** the dev rig from `just dev`
- **WHEN** the SPA requests `/api/flair/custom`
- **THEN** the backend answers (not the Vite 404)

### Frontend: treatment + reduced motion

#### R6: `.rk-flair-custom` rule in `globals.css`
The rule MUST paint the asset on `::after` with `background-image: url("/api/flair/custom")`, `background-size: cover; background-position: center; background-repeat: no-repeat`, and a readability scrim `opacity: 0.4` (a commented tunable constant). NO `animation:` property and NO keyframes — the loop belongs to the image file itself. The overlay contract holds (absolute inset-0, z-[5], pointer-events-none, overlay-owns-clip); no `--rk-flair-color` participation. Add `.rk-flair-custom::after` to the `prefers-reduced-motion` enumeration block (uniformity; the real guarantee is R7). Base rules precede the gate (source-order rule). The block's header comment MUST state the runtime-asset nature and that the repo ships no image.

- **GIVEN** a row with `@rk_flair = custom` and an asset present
- **WHEN** the row renders
- **THEN** the image paints full-bleed behind the row text at 0.4 opacity, looping on its own, with no CSS animation involved

#### R7: JS reduced-motion mount gate in `FlairOverlay` (deliberate component change)
For `flair === "custom"` ONLY, `FlairOverlay` MUST return `null` when `prefers-reduced-motion: reduce` matches (a module-scope or render-time `matchMedia` read; no listener machinery — OS-setting changes take effect on next mount). Every other flair's path MUST be byte-identical to today. This is the sanctioned exception to the flairs-need-no-component-change norm: CSS cannot pause a raster's own loop, so not mounting is the only guarantee.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a row carries `custom`
- **THEN** no overlay element exists (no element, no decode)
- **GIVEN** normal motion settings
- **WHEN** a row carries `custom`
- **THEN** the bare overlay span renders exactly like other sheet flairs

### Tests & verification

#### R8: Test coverage
Closed-set enumerations gain `custom` (`themes.test.ts`, `validate_test.go`, `flair-overlay.test.tsx`, `swatch-popover.test.tsx`, `sidebar/index.test.tsx`, and the `operator.go` help-text / `types.ts` JSDoc enumerations if they enumerate values). New Go handler tests: 404-when-absent; serves gif fixture with correct content-type + ETag/304 (fixture bytes GENERATED in the test — no committed binary). New `flair-overlay.test.tsx` cases: the `custom` reduced-motion short-circuit (mocked `matchMedia`) and the normal-motion bare-span shape.

- **GIVEN** the suites run
- **WHEN** `cd app/backend && go test ./...` and the frontend unit tests execute
- **THEN** all pass

#### R9: Repo hygiene + gates
NO image/binary file may be added to the repository by any task (`git status` must show no `.gif`/`.webp`/binary additions; `.uploads/` stays gitignored and untouched). Gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just build` all pass.

- **GIVEN** the finished change
- **WHEN** `git status --porcelain` is inspected
- **THEN** only source/text files appear

### Non-Goals

- No upload UI or endpoint; no settings-registry key (fixed-path convention is v1)
- No per-row asset selection — one shared slot instance-wide (the token stays a closed set)
- No transcoding/resizing pipeline — the file is served as-is; weight is the user's dial
- No committed asset of any kind; the user's `.uploads/` file is out of scope for git
- No e2e spec (unit-asserted); if one IS touched, its sibling `.spec.md` updates in the same commit

### Design Decisions

#### Runtime asset slot, never a committed catalogue GIF
**Decision**: The repo gains only content-neutral infrastructure (token, route, CSS rule, JS gate); the image lives at fixed config-dir filenames and is served at request time.
**Why**: A committed clip would embed third-party footage in the distributed binary and break the catalogue's original-art invariant; the research pass endorsed exactly this shape.
**Rejected**: Committing the GIF (copyright + 5 systemic costs); a data-URI in CSS (33% inflation into the always-loaded bundle).
*Introduced by*: 260825-eust-custom-gif-flair-slot

#### Fixed filenames over an upload surface
**Decision**: `custom-flair.webp|gif` in the config root, webp preferred; no upload UI, no settings key, no path config.
**Why**: Constitution IV (one settings surface; resist creep) and VII (convention over configuration); fixed names eliminate the traversal surface entirely (Constitution I).
**Rejected**: An upload POST + registry entry (the research's initial sketch) — strictly more surface for the same capability.
*Introduced by*: 260825-eust-custom-gif-flair-slot

#### Cover + opacity scrim over the 22px film-strip
**Decision**: `background-size: cover`, centered, `opacity: 0.4` on the pseudo.
**Why**: Expected content is full-bleed rectangular footage; tiling a movie frame as a 22px repeat-x strip read as the worse default in research; the scrim keeps row text legible over full-motion content.
**Rejected**: Height-locked `auto 22px; repeat-x` (the house strip — right for drawn sprites, wrong for footage); full opacity (drowns the row text).
*Introduced by*: 260825-eust-custom-gif-flair-slot

#### JS mount gate for reduced motion
**Decision**: `FlairOverlay` returns `null` for `custom` under `prefers-reduced-motion`; other flairs keep the pure-CSS gate.
**Why**: CSS `animation: none` cannot pause a GIF/WebP's own decode loop; not mounting is the only reliable stop.
**Rejected**: CSS-only `display: none` (paint hidden but decode behavior engine-specific; and a forgotten enumeration entry would leave an unstoppable loop).
*Introduced by*: 260825-eust-custom-gif-flair-slot

## Tasks

### Phase 1: Setup

- [x] T001 [P] Append `"custom"` to `FLAIR_STATES` in `app/frontend/src/themes.ts`; update `app/frontend/src/themes.test.ts` <!-- R1 -->
- [x] T002 [P] Append `"custom"` to `flairTokens` in `app/backend/internal/validate/validate.go`; update `app/backend/internal/validate/validate_test.go` <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Implement the asset resolver (fixed `custom-flair.webp|gif` in the config root, webp first) and the `GET /api/flair/custom` handler (request-time read, content-type by extension, ETag/304, no-cache, 404-when-absent) in the backend, registered with the existing GET routes; add handler tests with generated fixture bytes <!-- R3, R4, R8 -->
- [x] T004 [P] Add the `/api/flair` dev-proxy entry in `app/frontend/vite.config.ts` <!-- R5 -->
- [x] T005 Add the `.rk-flair-custom` rule (cover, center, no-repeat, opacity 0.4 tunable, no animation property, runtime-asset header comment) and its reduced-motion enumeration entry in `app/frontend/src/globals.css` <!-- R6 -->
- [x] T006 Add the `custom`-only `matchMedia` reduced-motion mount gate in `app/frontend/src/components/flair-overlay.tsx`, keeping every other flair's render path byte-identical; add the short-circuit + bare-span tests in `flair-overlay.test.tsx` <!-- R7, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Sweep the remaining enumeration tests/docs for the new token: `swatch-popover.test.tsx`, `sidebar/index.test.tsx`, `operator.go` help text, `types.ts` JSDoc, `operator_test.go` — mirror the pattern prior flair additions used <!-- R8 -->

### Phase 4: Polish

- [x] T008 Run gates (`cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just build`) and verify repo hygiene: `git status --porcelain` shows no binary/image additions <!-- R9 -->

## Execution Order

- T001/T002 parallel; T003 before T004's proxy is testable; T005/T006 after T001; T007 after T001; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` contains `"custom"`; the picker band renders the new cell with no split-logic change
- [x] A-002 R2: `ValidateFlairValue("custom")` passes on all three write paths; unknown tokens still 400
- [x] A-003 R3: Resolver prefers `.webp` over `.gif`; fixed filenames only; config root via the existing helper
- [x] A-004 R4: Route serves request-time with correct content-type, ETag/304, no-cache; 404 when absent
- [x] A-005 R5: Dev proxy passes `/api/flair/*` to the backend
- [x] A-006 R6: `.rk-flair-custom::after` paints cover/center at 0.4 opacity with NO animation property; gate-block entry present; base rules precede the gate
- [x] A-007 R7: `custom` under reduced motion mounts nothing; other flairs' render path unchanged (byte-identical for non-custom)

### Behavioral Correctness

- [x] A-008 R4: Deleting the asset file makes the next request 404 (no caching layer holds it)
- [x] A-009 R7: Normal motion renders the bare overlay span for `custom` (same shape as sheet flairs)

### Scenario Coverage

- [x] A-010 R8: Handler tests cover 404/serve/304; flair-overlay tests cover both motion states; all enumeration suites updated and green

### Edge Cases & Error Handling

- [x] A-011 R4: A zero-byte or unreadable asset file yields a non-5xx, well-formed response (404 or valid empty serve — handler must not panic)
- [x] A-012 R9: No binary/image file appears in `git status`; `.uploads/` untouched

### Code Quality

- [x] A-013 Pattern consistency: handler shape, route registration, and test style match neighboring API code; CSS block matches catalogue comment idiom
- [x] A-014 No unnecessary duplication: config-root resolution reuses the existing helper; no new utilities duplicating `internal/` code

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | ETag from content hash with If-None-Match/304 handling implemented in the handler (not delegated to http.ServeContent's modtime path) | Mirrors the SPA embedded-asset ETag posture the research found; exact mechanism is the worker's call if a stdlib path gives equivalent semantics | S:60 R:85 A:80 D:70 |
| 2 | Confident | matchMedia read at module scope or render time without a change listener | The value changes only with OS settings; next mount reflects it; listener machinery adds re-render cost to a per-row component for no practical gain | S:60 R:80 A:75 D:70 |
| 3 | Confident | Opacity 0.4 as the initial scrim constant | A starting point the user will tune by eye against their own footage; commented as tunable | S:50 R:95 A:70 D:65 |

3 assumptions (0 certain, 3 confident, 0 tentative).
