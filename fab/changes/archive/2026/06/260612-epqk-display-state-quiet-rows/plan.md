# Plan: Consume fab pane map display_state; quiet parked sidebar rows; harden hover-icon cluster

**Change**: 260612-epqk-display-state-quiet-rows
**Intake**: `intake.md`

## Requirements

### Backend: `display_state` plumbing

#### R1: Parse `display_state` from `fab pane map --json`
`paneMapEntry` in `app/backend/internal/sessions/sessions.go` MUST gain a `DisplayState *string` field with JSON tag `display_state`, placed next to the existing `Stage *string` field. Parsing MUST handle all three wire shapes: a string value, explicit JSON `null`, and an absent key (the latter two yield a `nil` pointer).

- **GIVEN** `fab pane map --json` output containing `"display_state": "done"` on an entry
- **WHEN** the backend unmarshals the pane map
- **THEN** `entry.DisplayState` is a non-nil pointer to `"done"`

- **GIVEN** an entry with `"display_state": null` or with the key absent (fab < 2.1.7)
- **WHEN** the backend unmarshals the pane map
- **THEN** `entry.DisplayState` is `nil`

#### R2: Thread the value onto `WindowInfo.FabDisplayState`
`WindowInfo` in `app/backend/internal/tmux/tmux.go` MUST gain `FabDisplayState string` with JSON tag `fabDisplayState,omitempty`, placed next to `FabStage`. The enrichment join in `FetchSessions` (`sessions.go`, where `entry.Stage` maps to `FabStage`) MUST map `entry.DisplayState` via the existing `derefStr` helper, yielding an empty string when the pointer is `nil`. The field flows through the existing `GET /api/sessions` response and SSE session payload unchanged — no new endpoints, no caching, no persistence (request-time pane-map join, constitution §II). The `fab` invocation itself is untouched (constitution §I, §III).

- **GIVEN** a window whose pane-map entry carries `DisplayState` pointing to `"done"`
- **WHEN** the enrichment join runs
- **THEN** that window's `FabDisplayState` is `"done"` and serializes as `"fabDisplayState": "done"`

- **GIVEN** a window whose entry has `DisplayState == nil`, or a window with no pane-map entry at all
- **WHEN** the enrichment join runs (or is skipped for the unmatched window)
- **THEN** `FabDisplayState` is the empty string and the key is omitted from JSON (`omitempty`)

### Frontend: type and window-row policy

#### R3: Frontend `WindowInfo` type
`app/frontend/src/types.ts` `WindowInfo` MUST gain `fabDisplayState?: string` immediately after `fabStage?: string`. The field is absent when fab reports `null` or omits the field.

- **GIVEN** a session payload with `"fabDisplayState": "done"` on a window
- **WHEN** the frontend consumes it
- **THEN** `win.fabDisplayState === "done"` typechecks on both `ProjectWindow` and ghost (`MergedWindow`) row variants

#### R4: Quiet parked rows — suppress stage text when `fabDisplayState === "done"`
The window-row right cluster (`app/frontend/src/components/sidebar/window-row.tsx`) MUST render the stage text only when `win.fabStage` is truthy AND `win.fabDisplayState !== "done"` — the exact agreed predicate:

```tsx
{win.fabStage && win.fabDisplayState !== "done" && (
  <span className="text-xs text-text-secondary">
    {win.fabStage}
  </span>
)}
```

A `done` row renders duration only (quiet row); if duration is also absent the right cluster renders empty — accepted, that is the quiet row working as intended. All other states (`active`/`ready`/`failed`/`pending`/`skipped`), unknown future values, or an absent field MUST keep today's behavior exactly (stage text shown) — backward/forward compatible.

- **GIVEN** a fab window with `fabStage: "review-pr"` and `fabDisplayState: "done"`
- **WHEN** the row renders
- **THEN** no stage text is rendered, the duration (when present) still renders

- **GIVEN** a fab window with `fabStage: "apply"` and `fabDisplayState` of `"active"`, `"ready"`, an unknown future value, or absent (older fab binary)
- **WHEN** the row renders
- **THEN** the stage text renders byte-identical to current behavior

#### R5: Hover-icon cluster hardening (independent of the data path)
The absolutely-positioned icon container in `window-row.tsx` MUST become inert at rest and restore interactivity on hover, coarse pointers, and keyboard focus, by adding `pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto` to its existing classes. Each of the three hover-revealed `opacity-0` buttons (pin's not-pinned branch, color swatch, kill) MUST additionally get `focus-visible:opacity-100` so keyboard focus never sits on an invisible control (a container-level `opacity-100` cannot reveal children carrying their own `opacity-0` — element opacity is independent/multiplicative). NO geometry change: the `pr-[68px]` reservation, `coarse:opacity-100` always-visible icons, and the pin's permanent visibility when `isPinnedToAny` stay exactly as-is.

- **GIVEN** a fine-pointer user whose cursor is not over the row
- **WHEN** a stray click lands in the icon zone
- **THEN** it falls through to the underlying row-select button instead of hitting an invisible kill/pin/swatch target (deliberate icon clicks are unaffected — any mouse interaction hovers the row first, restoring interactivity)

- **GIVEN** a keyboard user tabbing through the row
- **WHEN** focus lands on a hover-revealed icon button
- **THEN** the focused control reveals itself (`focus-visible:opacity-100`) and the container restores `pointer-events` via `has-[:focus-visible]:pointer-events-auto`

### Spec: API documentation

#### R6: `docs/specs/api.md` documents `fabDisplayState`
The `GET /api/sessions` spec MUST gain `fabDisplayState` in both the example JSON (after `"fabStage": "review-pr"`: `"fabDisplayState": "done"`) and the Window fields table:

```markdown
| `fabDisplayState` | `string?` | Pipeline state of the displayed stage from `fab pane map` `display_state` — one of `active`, `ready`, `done`, `failed`, `pending`, `skipped`; omitted when fab reports `null` or the field is absent (fab < 2.1.7) |
```

- **GIVEN** the session payload shape changes in this change
- **WHEN** `docs/specs/api.md` is read
- **THEN** the example and field table both describe `fabDisplayState` (project convention: payload shape changes ship the spec edit in the same change)

### Non-Goals

- Stage-name abbreviation (2-char codes) — rejected in discussion
- Stage→color mapping — rejected
- Attention/alert treatment for `failed`/`ready` states — possible follow-up, not this change
- Any change to the 68px reservation geometry or hover-swap layouts
- Changes to the `dashboard.tsx` fabStage badge or the PANE-panel fab line (`status-panel.tsx`) — both keep showing the full stage word
- New Playwright e2e specs — unit-level coverage only; no `.spec.ts` edits → no `.spec.md` companions

### Design Decisions

1. **Ground truth over heuristic**: suppress parked-row stage text using fab-kit's `display_state` — *Why*: authoritative pipeline state — *Rejected*: the `agentState` heuristic (not authoritative).
2. **Per-button `focus-visible:opacity-100`** instead of container-level `has-[:focus-visible]:opacity-100` — *Why*: container opacity cannot reveal children with their own `opacity-0`; the container-level `has-[:focus-visible]:pointer-events-auto` is kept verbatim — *Rejected*: the intake's "e.g." container-only form (no-op for reveal).
3. **First codebase use of Tailwind v4 `has-[]`/`focus-visible` variants** — accepted in discussion.

## Tasks

### Phase 1: Backend plumbing

- [x] T001 Add `DisplayState *string` (`json:"display_state"`) to `paneMapEntry` next to `Stage` in `app/backend/internal/sessions/sessions.go` <!-- R1 -->
- [x] T002 [P] Add `FabDisplayState string` (`json:"fabDisplayState,omitempty"`) to `WindowInfo` next to `FabStage` in `app/backend/internal/tmux/tmux.go` <!-- R2 -->
- [x] T003 Map `entry.DisplayState` → `sd.windows[j].FabDisplayState` via `derefStr` in the `FetchSessions` enrichment join in `app/backend/internal/sessions/sessions.go` <!-- R2 -->
- [x] T004 Go tests in `app/backend/internal/sessions/sessions_test.go`: `display_state` parsing for value (`"done"`)/explicit-null/absent-key shapes, and the join mapping `entry.DisplayState` → `WindowInfo.FabDisplayState` (extend the existing `paneMapEntry` unmarshal/join test patterns) <!-- R1 R2 -->

### Phase 2: Frontend type + window-row policy

- [x] T005 [P] Add `fabDisplayState?: string` after `fabStage` in `WindowInfo` in `app/frontend/src/types.ts` <!-- R3 -->
- [x] T006 Apply the quiet-row predicate `win.fabStage && win.fabDisplayState !== "done"` to the right-cluster stage span in `app/frontend/src/components/sidebar/window-row.tsx` <!-- R4 -->
- [x] T007 Harden the hover-icon container in `app/frontend/src/components/sidebar/window-row.tsx`: add `pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto` to the container div; add `focus-visible:opacity-100` to the pin (not-pinned branch), color-swatch, and kill buttons <!-- R5 -->

### Phase 3: Frontend tests

- [x] T008 Unit tests in `app/frontend/src/components/sidebar/window-row.test.tsx`: (a) suppression predicate — `done` → no stage text + duration still rendered; `active`/`ready`/absent/unknown → stage shown; (b) icon hardening — class-string assertions (`pointer-events-none`, `group-hover:pointer-events-auto`, `coarse:pointer-events-auto`, `has-[:focus-visible]:pointer-events-auto` on the container; `focus-visible:opacity-100` on the three hover-revealed buttons) <!-- R4 R5 -->
- [x] T009 [P] Extend `app/frontend/src/components/sidebar.test.tsx`: keep the existing `getAllByText("apply")` visible-branch assertion; add a `fabDisplayState: "done"` fixture/test asserting the stage text is absent from that row <!-- R4 -->

### Phase 4: Spec

- [x] T010 [P] Update `docs/specs/api.md`: add `"fabDisplayState": "done"` to the example JSON after `"fabStage": "review-pr"` and add the `fabDisplayState` row to the Window fields table <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `paneMapEntry` parses `display_state` correctly for all three wire shapes (string value, explicit `null`, absent key)
- [x] A-002 R2: `WindowInfo.FabDisplayState` exists with `omitempty`, is populated via `derefStr(entry.DisplayState)` in the enrichment join, and flows through the existing payloads with no new endpoints/caching
- [x] A-003 R3: frontend `WindowInfo` has `fabDisplayState?: string` next to `fabStage`
- [x] A-004 R4: stage text is suppressed exactly when `fabDisplayState === "done"`; duration (when present) still renders on quiet rows
- [x] A-005 R5: icon container carries the four pointer-events classes; the three hover-revealed buttons carry `focus-visible:opacity-100`
- [x] A-006 R6: `docs/specs/api.md` documents `fabDisplayState` in both the example JSON and the Window fields table

### Behavioral Correctness

- [x] A-007 R4: rows with `fabDisplayState` of `active`/`ready`/`failed`/`pending`/`skipped`, an unknown value, or absent render stage text exactly as before (backward/forward compatible)
- [x] A-008 R5: no geometry change — `pr-[68px]` reservation, `coarse:opacity-100` icon visibility, and pinned-pin permanent visibility are untouched

### Scenario Coverage

- [x] A-009 R1: Go tests cover value/null/absent parsing shapes and the join mapping to `FabDisplayState`
- [x] A-010 R4: `window-row.test.tsx` covers `done` suppression (with duration intact) and the show-stage fallthrough for other/absent/unknown values; `sidebar.test.tsx` covers both visible and hidden branches
- [x] A-011 R5: `window-row.test.tsx` asserts the hardening class strings on container and buttons (class-presence assertions — jsdom does not evaluate hover/media-query/`:has()` variants)

### Edge Cases & Error Handling

- [x] A-012 R4: a `done` row whose duration is also absent renders an empty right cluster without error (accepted quiet-row behavior, no placeholder)
- [x] A-013 R2: a window with no pane-map entry, or a failed pane-map fetch, leaves `FabDisplayState` empty — existing graceful degradation intact

### Code Quality

- [x] A-014 Pattern consistency: new code mirrors the existing `Stage`→`FabStage` plumbing and surrounding naming/structure
- [x] A-015 No unnecessary duplication: `derefStr` reused; no new helpers or utilities introduced
- [x] A-016 Tests cover the new behavior (code-quality.md: new features MUST include tests)
- [x] A-017 No client polling and no new caches — request-time pane-map join preserved (constitution §II; anti-patterns list)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Hydrate-stage touchpoints (NOT apply): `docs/specs/design.md` decision #17 + §Window row; `docs/memory/run-kit/ui-patterns.md` WindowRow contract (~:341, :379-383)
- Verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; frontend vitest (scoped, then full unit suite)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plan encodes the intake verbatim — predicate, field names/tags/placement, class lists, spec wording, and Non-Goals are reproduced 1:1 with no re-design | Intake is fully pre-agreed (11 graded assumptions, exact snippets); apply's job is faithful execution | S:95 R:90 A:95 D:95 |
| 2 | Confident | Go coverage lands as new test functions following the existing `TestPaneMapEntryParsing`/`TestPaneMapJoinPopulatesPerWindowFabFields` patterns (simulated join loop) rather than editing those tests in place | Existing tests are green and assert orthogonal fields; additive tests keep diffs reviewable and match the file's established per-feature test-function convention (e.g., the PR-fields tests) | S:80 R:90 A:90 D:85 |
| 3 | Confident | `sidebar.test.tsx`'s `done` coverage uses a dedicated test with a local sessions-override fixture (one `done` window + the existing visible-branch fixtures untouched) instead of mutating the shared `sessions` array | Mutating the shared fixture would ripple into unrelated assertions (`getAllByText("apply")` counts); the file already supports per-test `sessions` overrides via `buildTree` | S:80 R:90 A:90 D:85 |
| 4 | Confident | Icon-hardening button assertions render with `server` + `onColorChange` wired so all three buttons (pin/swatch/kill) exist in the DOM | The default test helper omits both props, which hides pin and swatch entirely; a dedicated helper variant is the minimal way to exercise R5's three-button contract | S:75 R:90 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
