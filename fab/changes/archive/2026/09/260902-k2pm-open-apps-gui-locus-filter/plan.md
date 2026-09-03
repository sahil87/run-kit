# Plan: Open-Apps GUI Locus Filter

**Change**: 260902-k2pm-open-apps-gui-locus-filter
**Intake**: `intake.md`

## Requirements

### Backend: wt registry gui-locus filter

#### R1: parseApps filters to gui locus with empty-locus back-compat
`parseApps` (`app/backend/internal/wt/wt.go`) MUST keep a registry row iff its `locus` field is `"gui"` or absent/empty, in addition to the existing non-empty `id`/`label` requirement. Rows with any other `locus` value (`session`, `caller`, `host`, or future values) SHALL be skipped tolerantly (not fatal), matching the existing missing-id/label skip posture. The `App` struct MUST gain `Locus string` (`json:"locus,omitempty"`).

- **GIVEN** the new wt output containing gui and non-gui rows
- **WHEN** `parseApps` decodes it
- **THEN** only `locus:"gui"` rows are returned
- **AND** rows without a `locus` field (old-wt output) are kept

- **GIVEN** this host's probed payload (`open_here`/caller, `tmux_window`/session, `tmux_session`/session — zero gui rows)
- **WHEN** `parseApps` decodes it
- **THEN** the result is empty (the "on host" section hides)

#### R2: default marker passthrough
The `App` struct MUST gain `Default bool` (`json:"default,omitempty"`) so wt's `default:true` marker survives decode and re-encode; the frontend `OpenApp` type (`app/frontend/src/api/client.ts`) MUST gain `default?: boolean`. The marker is only meaningful on rows that survive the R1 filter — a `default:true` on a non-gui row is dropped with its row.

- **GIVEN** a gui row carrying `default:true`
- **WHEN** the registry flows through `GET /api/open-apps`
- **THEN** the JSON row carries `"default":true` (and non-marked rows omit the field via `omitempty`)

#### R3: default-marked app ordered first in the host section
`buildOpenTargets` (`app/frontend/src/lib/open-in-app.ts`) MUST order the host section with default-marked apps first, as a stable partition (default-marked rows before the rest, registry order preserved within each group). No primary-segment or last-used behavior changes — last-used continues to own the primary action.

- **GIVEN** `hostApps` where a non-first row carries `default: true`
- **WHEN** `buildOpenTargets` builds the host targets
- **THEN** the default-marked app's target is first among `kind: "host"` targets and the remaining order is unchanged
- **AND** with no marked row, host-target order equals registry order

#### R4: POST /api/open validation sees the filtered view
Because R1 filters inside the wrapper, `appInRegistry` in `handleOpen` (`app/backend/api/open.go`) consequently rejects non-gui ids (400) with **no API-layer code change**. This is a derived behavior to verify by reading, not new code.

- **GIVEN** the new wt output live on a host
- **WHEN** a client POSTs `/api/open` with `"app":"tmux_window"`
- **THEN** the id is not in the filtered live registry and the request 400s before exec

### Non-Goals

- No frontend re-fetch/invalidations changes (`use-open-targets.ts` untouched)
- No handling of the extended `kind` enum (`multiplexer`/`shell`/`clipboard`) — advisory passthrough already; the new kinds ride rows R1 drops
- No e2e additions for the backend filter — `open-in-app.spec.ts` stubs `**/api/open-apps*` via `page.route`, bypassing the backend entirely
- No primary-segment "preselect" (default app does not become the button's primary action)

### Design Decisions

#### Filter at the wrapper parse seam
**Decision**: The gui-locus filter lives in `parseApps` (`internal/wt`), not in `handleOpenApps`.
**Why**: The wrapper is the existing tolerant-parse seam (id/label skip already there); both `ListApps` consumers — the GET registry and POST launch validation — get the same gui-only view for free.
**Rejected**: Filtering in `handleOpenApps` — would leave `handleOpen`'s `appInRegistry` validating against unfiltered rows, letting `wt open <path> -a tmux_window` exec.
*Introduced by*: 260902-k2pm-open-apps-gui-locus-filter

#### Ordering in the frontend, API stays a faithful passthrough
**Decision**: The default-first ordering is applied in `buildOpenTargets` (frontend); the backend returns wt's registry order with `default` passed through.
**Why**: Presentation choices live in the frontend (mirrors the existing split: deeplink templates are frontend-only); the API remains a faithful projection of wt's registry.
**Rejected**: Server-side sort in `handleOpenApps` — bakes a UI ordering into an API response and hides wt's order from other consumers.
*Introduced by*: 260902-k2pm-open-apps-gui-locus-filter

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `Locus`/`Default` fields to `App` and the gui-locus filter (empty = gui back-compat) in `parseApps`; update the package header + `parseApps` doc comments (`app/backend/internal/wt/wt.go`) <!-- R1, R2 -->
- [x] T002 [P] Add `default?: boolean` to `OpenApp` (`app/frontend/src/api/client.ts`) and the stable default-first host-section partition in `buildOpenTargets` (`app/frontend/src/lib/open-in-app.ts`) <!-- R2, R3 -->

### Phase 2: Tests

- [x] T003 Extend `parseApps` cases in `app/backend/internal/wt/wt_test.go`: new-shape mixed rows → gui-only; missing-locus rows kept (old-shape back-compat); this host's real probed payload → empty; `default` decoded on a surviving gui row; `default:true` on a non-gui row dropped with its row <!-- R1, R2 -->
- [x] T004 [P] Extend `app/frontend/src/lib/open-in-app.test.ts`: default-marked host app first (stable partition), unmarked registry order preserved <!-- R3 -->

### Phase 3: Verification

- [x] T005 Run gates: `cd app/backend && go test ./internal/wt/... ./api/...`, `cd app/frontend && npx tsc --noEmit`, targeted vitest for `open-in-app.test.ts` + `client.test.ts` <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `parseApps` keeps `locus:"gui"` and empty-locus rows and drops all others; `App` carries `Locus`/`Default` with `omitempty` JSON tags
- [x] A-002 R2: `default:true` survives decode → API JSON on gui rows; `OpenApp` type carries `default?: boolean`
- [x] A-003 R3: `buildOpenTargets` orders default-marked host apps first as a stable partition; no other target-building behavior changed

### Behavioral Correctness

- [x] A-004 R1: this host's probed new-shape payload (3 non-gui rows) parses to an empty registry — the "on host" section hides instead of showing junk rows
- [x] A-005 R4: `handleOpen`'s `appInRegistry` validates against the filtered `ListApps` view with no API-layer code change (verified by reading — the wrapper is the only registry source)

### Scenario Coverage

- [x] A-006 R1: wt_test.go covers both compat directions (old shape kept, new shape filtered) and the real probed payload
- [x] A-007 R3: open-in-app.test.ts covers marked and unmarked orderings

### Edge Cases & Error Handling

- [x] A-008 R2: `default:true` on a non-gui row does not leak (row dropped, marker with it — unit-tested)
- [x] A-009 R1: non-JSON / malformed output still errors (existing tests untouched and green)

### Code Quality

- [x] A-010 Pattern consistency: filter follows the existing tolerant-skip idiom in `parseApps`; frontend partition matches existing `buildOpenTargets` style
- [x] A-011 No unnecessary duplication: no new exec paths, no parallel registry parsing; fail-silent degradation untouched
- [x] A-012 Tests included for the added/changed behavior (code-quality.md requirement)
- [x] A-013 Comment discipline: doc-comment updates state contracts (filter rule, back-compat), no narration or change-ID citations in code

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a filter, a passthrough field, and an ordering rule without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | No API-layer (open_test.go) test for the filter — wrapper unit tests are the sole meaningful seam | `mockWtOps` stubs `ListApps` itself, so an API test would only exercise the stub, not `parseApps`; the intake's suggested open_test.go case is dropped as untestable-at-that-seam | S:70 R:85 A:80 D:70 |
| 2 | Certain | Stable partition (not full sort) for default-first ordering | Registry order is wt's deliberate output; only the marked row(s) move | S:80 R:90 A:90 D:85 |

2 assumptions (1 certain, 1 confident, 0 tentative).
