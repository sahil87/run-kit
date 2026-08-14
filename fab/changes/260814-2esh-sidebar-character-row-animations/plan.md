# Plan: Sidebar Character Row Animations (Nyan Cat, Naruto, One Piece)

**Change**: 260814-2esh-sidebar-character-row-animations
**Intake**: `intake.md`

## Requirements

### Backend: Flair Persistence & Derivation

#### R1: Window flair option accepted and validated
The window options endpoint (`POST /api/windows/{windowId}/options`, `app/backend/api/windows.go`) MUST accept a new allowlisted key `@rk_flair` (`optKeyFlair`) whose value is one of `nyan`, `naruto`, `onepiece`, or empty/null (unset). Validation MUST run before any tmux call via a new shared rule `validate.ValidateFlairValue` in `app/backend/internal/validate`, and an empty string MUST map to unset (nil op value), mirroring the `@rk_marker` contract.

- **GIVEN** a window `@1` on server `s`
- **WHEN** `POST /api/windows/@1/options` with `{"options": {"@rk_flair": "nyan"}}`
- **THEN** the tmux window option `@rk_flair` is set to `nyan` and the endpoint returns 200
- **AND** a value outside the allowlist (e.g. `"pikachu"`) returns 400 with zero tmux calls

#### R2: Window flair derived into state
The window enumeration MUST derive flair server-side: add `#{@rk_flair}` to the window list format in `app/backend/internal/tmux/tmux.go` and to the layout-snapshot capture set in `layout.go`, parse it with the same closed-set normalization idiom as `Marker` (unknown values → empty), and expose it as `Flair string \`json:"flair,omitempty"\`` on the window struct so it rides the existing SSE/window-list payloads (no new streams).

- **GIVEN** a window whose `@rk_flair` is `naruto`
- **WHEN** the frontend receives the window list / state event
- **THEN** the window object carries `flair: "naruto"`
- **AND** a window with a corrupt option value (e.g. `xyz`) carries no flair field

#### R3: Session flair endpoint and derivation
A new endpoint `POST /api/sessions/{session}/flair` MUST mirror `handleSessionColor` (`app/backend/api/sessions.go`): body `{"flair": "onepiece"}` sets the tmux **session** user option `@rk_flair` via new `tmux.SetSessionFlair` / `tmux.UnsetSessionFlair` primitives (null/empty clears), with `ValidateFlairValue` applied first and the tmuxOps seam extended in `router.go`. Session enumeration MUST add `#{@rk_flair}` to the session list format (tmux.go:681 area) and expose `Flair` on the session payload, mirroring the `@session_color`-sourced `Color` field.

- **GIVEN** session `work` on server `s`
- **WHEN** `POST /api/sessions/work/flair` with `{"flair": "onepiece"}`
- **THEN** the session's `@rk_flair` option is set and subsequent session listings carry `flair: "onepiece"`
- **AND** `{"flair": null}` unsets the option

#### R4: Server flair in the settings store
Server-scoped flair MUST mirror the server-color mechanism: a `ServerFlairs map[string]string` in `app/backend/internal/settings/settings.go` (parse + serialize alongside `ServerColors`), `GetServerFlair`/`SetServerFlair` accessors, and `GET`/`POST /api/settings/server-flair` handlers in `app/backend/api/settings.go` mirroring the server-color pair (GET with no `server` param returns the full map; POST body `{"server": "s", "flair": "nyan"}`, empty/null clears). Values validated with the same allowlist.

- **GIVEN** tmux server `rk-main`
- **WHEN** `POST /api/settings/server-flair` with `{"server": "rk-main", "flair": "nyan"}`
- **THEN** `GET /api/settings/server-flair` returns a map containing `"rk-main": "nyan"`

### Frontend: Flair Channel, Rendering & Picker

#### R5: Types and API client
`app/frontend/src/types.ts` MUST add `flair?: string` to the window type (beside `marker?`) and to the session type; `app/frontend/src/api/client.ts` MUST add `setWindowFlair(server, windowId, flair)` (via the `/options` contract, mirroring `setWindowMarker`), `setSessionFlair(server, session, flair)`, `setServerFlair(server, flair)`, and `getAllServerFlairs()` (mirroring the server-color client pair).

- **GIVEN** the client functions exist
- **WHEN** `setWindowFlair("s", "@1", null)` is called
- **THEN** it POSTs `{"options": {"@rk_flair": ""}}` (empty = clear), matching the marker idiom

#### R6: Flair vocabulary constant
`app/frontend/src/themes.ts` MUST export `FLAIR_STATES = ["", "nyan", "naruto", "onepiece"] as const` (the single vocabulary source shared by the picker and any validation), with a doc comment stating flair is decorative only — no wiring to `@rk_agent_state` or the status pyramid.

- **GIVEN** the constant exists
- **WHEN** the picker renders flair cells
- **THEN** the cell set is derived from `FLAIR_STATES`, not a local literal

#### R7: Label picker flair section
`app/frontend/src/components/swatch-popover.tsx` MUST render a **flair section** when a new optional `onSelectFlair` callback prop is supplied (with `selectedFlair`): four cells — ∅ / nyan / naruto / onepiece — following the marker column's live-preview pattern (each non-∅ cell is a miniature row preview carrying its always-on animated flair overlay, like the dashed cell's live rain; the current cell carries `aria-selected` + selection ring). Selection calls `onSelectFlair` directly with the exact state (`""` clears — no cycling). Keyboard navigation MUST reach the flair cells. The section MUST be wired at all three row entry points: the window Label picker and the session and server color pickers (which gain flair but still NO marker column). Persistence handlers (`handleWindowFlairChange`, `handleSessionFlairChange`, `handleServerFlairChange`) live in `app/frontend/src/components/sidebar/index.tsx` beside `handleWindowMarkerChange`, calling the R5 client functions with toast-on-error.

- **GIVEN** a window row's Label picker is open
- **WHEN** the user clicks the nyan cell
- **THEN** `setWindowFlair` is called with `"nyan"` and the popover repaints the cell as selected
- **AND** clicking ∅ clears the flair via `""`

#### R8: Row overlay rendering on all three row types
Rows MUST mount a flair overlay when their flair is set: a dedicated `<span aria-hidden="true" class="absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-flair-{value}">` — clipping on the overlay, never the row root (the `.rk-scanlines` discipline). Window rows (`window-row.tsx`, sibling of the existing scanlines/hazard overlay slot, gated on `win.flair`), session rows (`session-row.tsx`, on the already-`relative` row root), and server group header rows (`ServerGroup` in `sidebar/index.tsx`). Flair composes with color tint and (window-only) marker textures. No JS timers, no new per-render props that defeat the `ServerGroup`/`SessionRow`/`WindowRow` memoization — flair is a stable string on existing row data.

- **GIVEN** a session row whose session carries `flair: "onepiece"`
- **WHEN** the sidebar renders
- **THEN** the row contains the `.rk-flair-onepiece` overlay span
- **AND** a row with no flair renders no flair overlay element

### CSS: Animation Treatments

#### R9: Three always-on CSS-only flair treatments
`app/frontend/src/globals.css` MUST define `.rk-flair-nyan`, `.rk-flair-naruto`, `.rk-flair-onepiece` following the `.rk-dash-rain` discipline: always-on ambient (every row state), CSS-only (no JS), animating `background-position`/`transform` on a `::before`/`::after` pseudo of the overlay, fixed-period tiles with keyframe displacement at integer multiples of the period (seamless loops), low alpha so text stays readable. Sprites are original stylized art embedded as inline SVG data URIs (no external requests, no copyrighted assets): nyan = pixel cat + 6-band rainbow trail (~10s traversal); naruto = ninja-run silhouette + speed-line trail (~7s); onepiece = pirate ship (hull/sail/pennant) + 1px wave baseline with gentle bob (~12s).

- **GIVEN** a row carrying `.rk-flair-nyan`
- **WHEN** it renders at rest (no hover, not selected)
- **THEN** the sprite traverses left→right continuously with the rainbow trail, and the loop shows no visible snap at the cycle boundary

#### R10: Reduced-motion gate
Under `prefers-reduced-motion`, all three flair overlays MUST be hidden entirely (motion-only decoration — no static fallback needed since flair carries no semantic meaning), added to the existing reduced-motion gate block in `globals.css` with the documented source-order rule (base rules precede the gate).

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a flaired row renders
- **THEN** no flair overlay is visible and no animation runs

### Non-Goals

- No extension of the marker vocabulary (markers stay window-only, 5 states + unset).
- No wiring of flair to agent state, the status pyramid, or any semantic signal — flair is pure decoration.
- No board-page or top-bar flair rendering — sidebar rows only.
- No command-palette actions for flair in this change (the picker is the sole entry point).

### Design Decisions

#### Scope-split option names (@rk_flair window / @rk_session_flair session)
**Decision**: The window flair option is `@rk_flair`; the session flair option is `@rk_session_flair` — never the same name at both scopes.
**Why**: tmux user-option lookup is hierarchical and format expansion leaks a shared name in BOTH directions — a flairless window inherits its session's value, and `list-sessions` resolves the session's current window's window option ahead of the session's own. Verified live: with one name, every window in a flaired session animated, and the session row's flair jumped with the current window. Same reason window color is `@color` while session color is `@session_color`.
**Rejected**: One shared `@rk_flair` name (the original plan) — behaved as an unintended cascade.
*Introduced by*: 260814-2esh-sidebar-character-row-animations

#### Sprite-sheet CSS animation over WebGL
**Decision**: Frame animation via vertical SVG sprite sheets stepped with `background-position-y` `step-end` keyframes, composed with the `background-position-x` traversal (independent longhands).
**Why**: Frame-true, classic-cadence animation at compositor-only cost, zero JS, honors the background-position-only row-animation discipline, and works at every row height via fixed 22px strip pseudos.
**Rejected**: A WebGL renderer — browsers cap live WebGL contexts per page (~8–16); every flaired row would need one, and dozens of rows would silently evict each other's contexts.
*Introduced by*: 260814-2esh-sidebar-character-row-animations

#### Flair as an independent channel
**Decision**: A new per-row flair channel (`@rk_flair` window/session options; settings-store map for servers), orthogonal to color and marker.
**Why**: Markers are a semantic border-style vocabulary with a picker-grid invariant and exist on window rows only; flair must reach session/server rows and compose with existing decoration. User confirmed in clarification.
**Rejected**: New marker states — would break the 6-cell `GRID_ROWS === MARKER_CELLS.length` invariant and force markers onto row types that don't have them.
*Introduced by*: 260814-2esh-sidebar-character-row-animations

#### Server flair in the settings store, not tmux
**Decision**: Server-scoped flair persists as `ServerFlairs` in `internal/settings`, mirroring `ServerColors`.
**Why**: A tmux server has no server-level user option surface the codebase uses for decoration; server color already established the settings-store pattern for server-scoped decoration.
**Rejected**: A global tmux option per server — inconsistent with the existing server-color mechanism.
*Introduced by*: 260814-2esh-sidebar-character-row-animations

#### Always-on ambient animation
**Decision**: Flair animates continuously in every row state.
**Why**: Matches the dashed data-rain precedent ("proved quiet enough to run ambiently"); flair is per-row opt-in, so ambient motion is a deliberate user choice. User confirmed in clarification.
**Rejected**: Hover-gating (invisible on touch, defeats the ambient-identity purpose) and selection-gating (only one row animates at a time).
*Introduced by*: 260814-2esh-sidebar-character-row-animations

## Tasks

### Phase 1: Setup

- [x] T001 Add `ValidateFlairValue` (allowlist `nyan|naruto|onepiece`, empty valid-as-unset) to `app/backend/internal/validate` with unit tests beside the existing marker/color validators <!-- R1 -->
- [x] T002 [P] Add `FLAIR_STATES` const + `FlairState` type to `app/frontend/src/themes.ts` with doc comment (decorative only) <!-- R6 -->

### Phase 2: Core Implementation

- [x] T003 `app/backend/api/windows.go`: add `optKeyFlair = "@rk_flair"` to the options allowlist, `validateWindowOption` case (via `ValidateFlairValue`), and the empty-string→unset mapping beside `@rk_marker` <!-- R1 -->
- [x] T004 `app/backend/internal/tmux/tmux.go` + `layout.go`: add `#{@rk_flair}` to the window list format and the layout capture set; parse with the Marker closed-set idiom; add `Flair string \`json:"flair,omitempty"\`` to the window struct <!-- R2 -->
- [x] T005 Session flair: `tmux.SetSessionFlair`/`UnsetSessionFlair` in `internal/tmux/tmux.go` (mirroring the session-color pair); `handleSessionFlair` + `POST /api/sessions/{session}/flair` route and `tmuxOps` seam in `app/backend/api/sessions.go`/`router.go`; add `#{@rk_flair}` to the session list format and `Flair` to the session payload (`internal/tmux` + `internal/sessions`) <!-- R3 -->
- [x] T006 Server flair: `ServerFlairs` map parse/serialize + `GetServerFlair`/`SetServerFlair` in `app/backend/internal/settings/settings.go`; `GET`/`POST /api/settings/server-flair` handlers in `app/backend/api/settings.go` + routes in `router.go`, mirroring the server-color pair with flair validation <!-- R4 -->
- [x] T007 Frontend types + client: `flair?: string` on window and session types in `app/frontend/src/types.ts`; `setWindowFlair`/`setSessionFlair`/`setServerFlair`/`getAllServerFlairs` in `app/frontend/src/api/client.ts`; thread session/server flair through the session-context state shapes where colors already flow <!-- R5 -->
- [x] T008 `app/frontend/src/globals.css`: `.rk-flair-nyan`/`.rk-flair-naruto`/`.rk-flair-onepiece` treatments (inline-SVG data-URI sprites, fixed-period seamless keyframes, low alpha, commented per the file's documentation style) + reduced-motion gate additions <!-- R9 -->
- [x] T009 `app/frontend/src/components/sidebar/window-row.tsx`: mount the flair overlay span (sibling of the scanlines/hazard overlay slot), gated on `win.flair` <!-- R8 -->
- [x] T010 [P] `app/frontend/src/components/sidebar/session-row.tsx`: mount the flair overlay on the row root, gated on the session's flair <!-- R8 -->
- [x] T011 [P] `app/frontend/src/components/sidebar/index.tsx` (`ServerGroup`): mount the flair overlay on the server group header row, gated on the server's flair <!-- R8 -->
- [x] T012 `app/frontend/src/components/swatch-popover.tsx`: flair section (∅/nyan/naruto/onepiece live-preview cells, `selectedFlair`/`onSelectFlair` props, keyboard nav extension); wire the three call sites + `handleWindowFlairChange`/`handleSessionFlairChange`/`handleServerFlairChange` in `sidebar/index.tsx` <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T013 Go tests: flair option accept/reject in `windows_test.go`, session flair endpoint in `sessions_test.go`, server flair store + handlers in `settings_test.go` <!-- R1 -->
- [x] T014 Vitest: flair section render/selection/keyboard in `swatch-popover.test.tsx` (incl. the untouched `GRID_ROWS === MARKER_CELLS.length` invariant), overlay gating in `window-row.test.tsx` + `session-row.test.tsx`, client function shapes in `client.test.ts` <!-- R8 -->
- [x] T015 Verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, then the frontend unit suite via `just test-frontend` <!-- R1 -->

### Phase 4: Post-review amendments (user-directed, 2026-08-14)

- [x] T016 Scope-split the session flair option to `@rk_session_flair` (setter/unsetter + session list format in `internal/tmux/tmux.go`, comments in `internal/sessions`/`api/sessions.go`) — fixes the live-tmux cross-scope leak: shared-name user options resolve hierarchically in format expansion, so a flairless window inherited its session's flair and list-sessions showed the current window's flair. Mirrors the `@color`/`@session_color` precedent. Amends R3. <!-- R3 -->
- [x] T017 Rewrite the three CSS treatments as frame-animated vertical sprite sheets (`globals.css`): background-position-y `step-end` frame cycling composed with the background-position-x traversal (independent longhands); nyan = 4-frame pop-tart cat run cycle + masked-fade rainbow comet trail + parallax twinkling starfield; naruto = 4-frame run cycle + fluttering headband ribbon + leaf/dust/speed-line 2-frame trail + counter-drifting speed streaks; onepiece = 4-frame ship (sail billow, fluttering straw-hat Jolly Roger flag, ±1.4° roll, bob, wake) + two-speed parallax scallop waves. WebGL evaluated and rejected (per-page context caps make per-row canvases infeasible). Amends R9; reduced-motion gate extended to all six pseudos. <!-- R9 -->
- [x] T018 Thread `Flair` through the layout-snapshot pipeline (`internal/snapshot/snapshot.go` window struct + capture copy, `restore.go` option re-apply, fixture coverage in both tests) — resolves the review's should-fix: a restore no longer drops flairs while preserving marker/role. <!-- R2 -->

## Execution Order

- T001 blocks T003/T005/T006 (shared validator); T002 blocks T012
- T004 blocks T009; T005 blocks T010; T006 blocks T011 (data must flow before rendering gates)
- T008 can run alongside backend tasks; T012 depends on T007 + T008
- T013–T015 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{id}/options` accepts `@rk_flair` with `nyan`/`naruto`/`onepiece`, rejects unknown values with 400 and zero tmux calls, and treats `""`/null as unset
- [x] A-002 R2: Window payloads carry `flair` derived from `#{@rk_flair}` with closed-set normalization; the layout capture set includes `@rk_flair`
- [x] A-003 R3: `POST /api/sessions/{session}/flair` sets/unsets the session `@rk_flair` option and session payloads carry `flair`
- [x] A-004 R4: `GET`/`POST /api/settings/server-flair` round-trip a validated per-server flair map persisted beside `ServerColors`
- [x] A-005 R5: `setWindowFlair`/`setSessionFlair`/`setServerFlair`/`getAllServerFlairs` exist and follow the marker/color client idioms (empty = clear)
- [x] A-006 R7: The picker shows the flair section at all three entry points (window/session/server), with live animated previews, direct selection, `""` clear, and keyboard reachability; session/server pickers still show no marker column
- [x] A-007 R8: All three row types mount the `.rk-flair-{value}` overlay exactly when their flair is set, composing with color tint and (window) marker textures

### Behavioral Correctness

- [x] A-008 R9: Each flair animates always-on, CSS-only, with seamless fixed-period loops and no external asset requests (inline SVG data URIs only)
- [x] A-009 R10: Under `prefers-reduced-motion` no flair overlay is visible and no flair animation runs

### Scenario Coverage

- [x] A-010 R1: Go test covers accept + reject + unset paths for the window flair option
- [x] A-011 R7: Vitest covers flair cell selection calling `onSelectFlair` with exact states and the marker-grid invariant untouched
- [x] A-012 R8: Vitest covers overlay mount/absence gating on window and session rows

### Edge Cases & Error Handling

- [x] A-013 R2: A corrupt `@rk_flair` value from tmux normalizes to unset (no broken class emitted)
- [x] A-014 R4: Server-flair POST with an invalid flair value returns 400 and does not mutate the settings file

### Code Quality

- [x] A-015 Pattern consistency: new code follows the marker/color idioms it sits beside (allowlist validation, empty-as-unset, closed-set parse, settings map serialization)
- [x] A-016 No unnecessary duplication: shared validator used by all three scopes; `FLAIR_STATES` is the single vocabulary source; overlay markup shared where practical
- [x] A-017 Security: all new subprocess interaction goes through existing `internal/tmux` primitives (`exec.CommandContext`, argument slices, timeouts); flair values are allowlist-validated before any tmux call
- [x] A-018 No client polling: flair state rides existing SSE/window-list derivation; no `setInterval` + fetch
- [x] A-019 Tests included: new behavior covered per code-quality.md (Go + Vitest)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- e2e: a Playwright spec was considered and descoped — the flair picker flow is fully covered by Vitest, and marker-picker precedent (label picker) is likewise Vitest-covered; see Assumptions row 3.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Review note, not a deletion: the captured `LayoutWindow.Flair` is not yet threaded through `internal/snapshot` (snapshot.go window copy / restore.go option re-apply) the way `Marker`/`Role` are — see review findings.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Sprites embedded as inline SVG data URIs on overlay pseudos (not box-shadow pixel art) | Cleaner art control and single-property animation; CSP/self-contained-friendly; matches "no external assets" | S:70 R:85 A:80 D:65 |
| 2 | Confident | Session flair gets a dedicated `POST /api/sessions/{session}/flair` endpoint (mirroring color) rather than a generic session-options endpoint | Sessions have no generic options endpoint today; mirroring the color pair is the smallest consistent surface | S:65 R:75 A:80 D:70 |
| 3 | Tentative | Playwright e2e descoped; coverage is Go + Vitest | The label-picker precedent is Vitest-covered (live-drag/animation e2e was previously descoped in this repo); an e2e for a picker click adds little over the unit seam. Revisit if review flags it | S:45 R:80 A:60 D:50 |
| 4 | Confident | Server flair map serialized in the same settings file section style as `ServerColors` (hand-rolled parse mirroring existing code) | The settings store uses a bespoke parser; following it is pattern-consistent | S:60 R:80 A:85 D:75 |

4 assumptions (0 certain, 3 confident, 1 tentative).
