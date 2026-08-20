# Plan: Server Flair Application

**Change**: 260820-arqw-server-flair-application
**Intake**: `intake.md`

## Requirements

### Backend: Settings Storage

#### R1: ServerFlairs map in `internal/settings`
`Settings` SHALL gain a `ServerFlairs map[string]string` (server name → flair token) persisted in `~/.rk/settings.yaml` as a nested `server_flairs:` section, implemented as a `mapSection` registry entry (current main's registry style — NOT the ref's hand-rolled scanner branches). The section's normalize func SHALL accept only non-empty tokens in `validate.FlairValues` (tolerant read: malformed/unknown entries dropped). `GetServerFlair(server) *string` / `SetServerFlair(server string, flair *string) error` SHALL mirror `GetServerColor`/`SetServerColor` (load-then-save; nil clears the entry). An empty map serializes to nothing — a settings file without flairs is byte-identical to one that never had them.

- **GIVEN** a settings file with `server_flairs:\n  default: "nyan"`, **WHEN** `Load()` runs, **THEN** `ServerFlairs["default"] == "nyan"`.
- **GIVEN** `SetServerFlair("dev", ptr("cube"))` then `SetServerFlair("dev", nil)`, **WHEN** the file is re-loaded, **THEN** the `dev` entry is gone and no `server_flairs:` heading remains when the map is empty.
- **GIVEN** a file entry `default: "bogus"`, **WHEN** `Load()` runs, **THEN** the entry is silently dropped.

### Backend: API Seam

#### R2: `GET`/`POST /api/settings/server-flair`
The API SHALL expose the flair map mirroring the server-color endpoints (`api/settings.go`, routes registered in `router.go` beside the server-color pair at :735-736):

- `GET /api/settings/server-flair` → `{"flairs": {server: token}}` (empty map, never null); `GET ?server=x` → `{"flair": "nyan"|null}`.
- `POST /api/settings/server-flair` body `{"server": "...", "flair": "nyan"|null|""}` — `flair: null` or `""` clears (the empty-equals-unset contract). Validation SHALL use the EXISTING `validate.ValidateFlairValue` (single universal vocabulary — `ValidateServerFlairValue` MUST NOT be recreated); invalid → `400` before any settings mutation; missing `server` → `400`. Mutation is POST-only (constitution IX).

- **GIVEN** `POST {"server":"default","flair":"rain"}`, **WHEN** handled, **THEN** `200 {"status":"ok"}` and `GET ?server=default` returns `{"flair":"rain"}`.
- **GIVEN** `POST {"server":"default","flair":"sparkle"}`, **WHEN** handled, **THEN** `400` and nothing persisted.
- **GIVEN** any universal token including `rain` and `cube`, **WHEN** POSTed, **THEN** accepted.

### Frontend: API Client

#### R3: `getAllServerFlairs` / `setServerFlair` in `client.ts`
`client.ts` SHALL add `getAllServerFlairs(): Promise<Record<string, string>>` (GET via `deduplicatedFetch`, returns `data.flairs`) and `setServerFlair(server: string, flair: string | null): Promise<void>` (plain `fetch` POST, `throwOnError` on non-2xx) — mirroring `getAllServerColors`/`setServerColor` exactly (ref: `pr-606-view:client.ts:903-916`).

- **GIVEN** the GET returns `{"flairs":{"default":"nyan"}}`, **WHEN** `getAllServerFlairs()` resolves, **THEN** the map is returned.
- **GIVEN** a `400` POST response, **WHEN** `setServerFlair` runs, **THEN** it rejects (caller toasts).

### Frontend: Sidebar State

#### R4: `serverFlairs` map with optimistic funnel
`sidebar/index.tsx` SHALL hold `serverFlairs: Record<string, string>` state, fetched once on mount (`getAllServerFlairs().then(...).catch(() => {})`, beside the `serverColors` fetch at :230), and a `handleServerFlairChange(targetServer, f)` callback following the CURRENT `handleServerColorChange` shape (:1570-1578): optimistic local map update first (set or delete key), then `setServerFlair` POST with toast-on-error. No SSE derivation exists for settings mutations (they emit no control-mode event). The flair value SHALL thread per-group as a scalar prop (`serverFlair={serverFlairs[srvInfo.name]}`, the `serverColor` threading pattern at :1697) and the full map to `ServerPanel` — preserving row-tree memoization.

- **GIVEN** a flair pick in the picker, **WHEN** the callback fires, **THEN** the header/tile repaint immediately (optimistic) and the POST fires; on POST failure a toast appears.
- **GIVEN** `""`/null selection (header ∅), **WHEN** handled, **THEN** the map entry is deleted locally and the POST clears it.

### Frontend: Rendering

#### R5: SESSIONS group-header mount
The per-server group header row (`sidebar/index.tsx`, ServerGroup header) SHALL mount `<FlairOverlay flair={serverFlair} color={headerAccent} />` — the shared component only, no bare span (ref mount point: `pr-606-view:index.tsx:2381-2385`). The header's existing guarded accent (`headerAccent` from `rowBorders`) rides the `color` prop so `rain`/`scan` tint like the row mounts. The header container must be `relative` for the overlay's `inset-0`.

- **GIVEN** a server with flair `matrix`, **WHEN** its group header renders, **THEN** an `aria-hidden` `.rk-flair-matrix` overlay span is present on the header row.
- **GIVEN** no flair entry, **WHEN** the header renders, **THEN** no overlay renders (`FlairOverlay` returns null).

#### R6: SERVER panel tile mount
`server-panel.tsx` SHALL thread `serverFlairs` down and mount `<FlairOverlay flair={serverFlairs[name]} hidden={isDragSource} color={...} />` inside the ServerTile box (inside the `overflow-hidden` button, above the body), hidden while the tile is the drag source via `FlairOverlay`'s `hidden` prop (the tile's existing `isDragSource`). The tile's guarded stripe color source (`rowBorders`-derived) SHALL ride `color` so tinted flairs match the tile family.

- **GIVEN** a flaired server tile, **WHEN** it becomes the HTML5 drag source, **THEN** the overlay renders nothing; on drag end it returns.

### Frontend: Picker

#### R7: Server picker gains the flair band
The server-group color picker — the `SwatchPopover` at the group header (`index.tsx:2704`, the ONLY server picker call site on current main; the SERVER tile has no picker) — SHALL pass `selectedFlair={serverFlair ?? ""}` and `onSelectFlair={(f) => handleServerFlairChange(server, f === "" ? null : f)}` so the existing post-#668 flair band renders. NO `SwatchPopover` component changes — the band is callback-gated. Selection funnels to the POST + optimistic update; `""` (header ∅) clears. The picker stays open on selection (its dismissal contract).

- **GIVEN** the server picker open, **WHEN** rendered, **THEN** the `[ flair ]` band with 12 live cells is present (`data-flair-value` cells).
- **GIVEN** a `cube` cell click, **WHEN** handled, **THEN** `handleServerFlairChange(server, "cube")` runs and the popover remains open.

### Non-Goals

- Any flair vocabulary/sprite/CSS change (shipped in #659 and follow-ups).
- `ValidateServerFlairValue` / tile-only vocabulary (explicitly rejected).
- Board tiles, host page, or any surface beyond the two sidebar mounts.
- Snapshot capture of server flair (`internal/snapshot` untouched — settings are not tmux state).
- New Playwright specs (decoration-only; no route change — no `.spec.md` obligations).
- Closing PR #606 (manual follow-up after merge).

### Design Decisions

#### Flair normalize is a registry closure over the universal set
**Decision**: The `server_flairs` `mapSection` normalize func accepts a value iff it is non-empty AND `validate.FlairValues[value]` — a small closure (or tiny exported helper) rather than a new validator.
**Why**: Current main's settings parser is a `nestedSection` registry requiring a `func(string) (string, bool)` normalize; the ref's inline scanner branch predates it. The universal set is consumed generically — no flair names enumerated in new code.
**Rejected**: A new `validate.NormalizeServerFlairValue` mirroring `NormalizeColorValue` — colors need canonicalization (legacy ints), flairs are exact tokens; a pass/fail membership check needs no canonical form.
*Introduced by*: 260820-arqw-server-flair-application

#### Picker wiring lands at the group header only
**Decision**: `selectedFlair`/`onSelectFlair` are wired at the group-header `SwatchPopover` (index.tsx:2704) only; `server-panel.tsx` receives `serverFlairs` purely for the tile mount.
**Why**: On current main the SERVER tile has no color-picker affordance (verified — no `SwatchPopover` in server-panel.tsx); the intake's "server call sites" resolves to the one existing site. Adding a tile picker would be new surface beyond the intake.
**Rejected**: Adding a picker affordance to the tile — out of intake scope; the tile's flair is settable via the group-header picker for the same server.
*Introduced by*: 260820-arqw-server-flair-application

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependencies needed)*

### Phase 2: Core Implementation

- [x] T001 Add `ServerFlairs map[string]string` to `Settings`, register the `server_flairs` `mapSection` with a flair normalize closure over `validate.FlairValues`, and add `GetServerFlair`/`SetServerFlair` mirroring the color pair in `app/backend/internal/settings/settings.go` <!-- R1 -->
- [x] T002 Settings tests: set/get/clear round-trip, YAML persistence + empty-section omission, malformed/unknown-token drop in `app/backend/internal/settings/settings_test.go` (mirror `pr-606-view:settings_test.go` flair cases, adapted to the registry parser) <!-- R1 -->
- [x] T003 Add `handleGetServerFlair` (map + `?server=` forms) and `handleSetServerFlair` (validate via existing `validate.ValidateFlairValue`, `""`→clear, `400` paths) to `app/backend/api/settings.go`; register both routes in `app/backend/api/router.go` beside the server-color pair <!-- R2 -->
- [x] T004 Handler tests: persist, clear via null and `""`, accept every universal token (incl. `rain`/`cube`), reject unknown token (400, nothing persisted), missing server (400), GET map + `?server=` forms in `app/backend/api/settings_test.go` (mirror `pr-606-view:api/settings_test.go:228+`, minus the tile-only-token cases) <!-- R2 -->
- [x] T005 [P] Add `getAllServerFlairs()` + `setServerFlair(server, flair)` to `app/frontend/src/api/client.ts` (mirror the server-color pair) <!-- R3 -->
- [x] T006 [P] Client tests for both functions (GET map unwrap, POST body shape, non-2xx rejection) in `app/frontend/src/api/client.test.ts` (mirror `pr-606-view:client.test.ts:646-676`) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Sidebar state: `serverFlairs` state + mount fetch + optimistic `handleServerFlairChange` (x4sf funnel shape, toast-on-error), thread `serverFlair` scalar to each ServerGroup and `serverFlairs` map to `ServerPanel` in `app/frontend/src/components/sidebar/index.tsx` <!-- R4 -->
- [x] T008 Group-header mount: `FlairOverlay` on the per-server group header row with `headerAccent` as `color`; wire `selectedFlair`/`onSelectFlair` at the group-header `SwatchPopover` call site (`""` → clear) in `app/frontend/src/components/sidebar/index.tsx` <!-- R5, R7 -->
- [x] T009 Tile mount: thread `serverFlairs` through `ServerPanel` → `ServerTile`, mount `FlairOverlay` inside the tile box with `hidden={isDragSource}` and the tile's guarded color in `app/frontend/src/components/sidebar/server-panel.tsx` <!-- R6 -->
- [x] T010 Sidebar tests: group header + tile mount `FlairOverlay` for a flaired server (and absent when unset), tile drag-source hide, picker flair band present at the server call site, selection funnels to POST + optimistic update in `app/frontend/src/components/sidebar/index.test.tsx` and `app/frontend/src/components/sidebar/server-panel.test.tsx` <!-- R4, R5, R6, R7 -->

### Phase 4: Polish

- [x] T011 Run verification gates: `go test ./...` (app/backend), `npx tsc --noEmit` + affected Vitest suites (app/frontend) — fix fallout <!-- R1, R2, R3, R4 -->

## Execution Order

- T001 blocks T002, T003; T003 blocks T004
- T005/T006 are independent of the Go chain
- T007 blocks T008, T009; T010 needs T008 + T009
- T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ServerFlairs` persists in `~/.rk/settings.yaml` via the `mapSection` registry; `GetServerFlair`/`SetServerFlair` round-trip set/get/clear, unknown tokens dropped on read
- [x] A-002 R2: `GET`/`POST /api/settings/server-flair` registered and behaving per the server-color mirror (map form, `?server=` form, POST set/clear)
- [x] A-003 R3: `getAllServerFlairs`/`setServerFlair` exist in client.ts with the color pair's exact fetch/dedup/error shape
- [x] A-004 R4: sidebar fetches the flair map on mount and updates it optimistically through a single funnel with toast-on-error
- [x] A-005 R5: group header renders `FlairOverlay` (shared component, no bare span) with the guarded accent color
- [x] A-006 R6: SERVER tile renders `FlairOverlay` inside the tile box, hidden while drag-sourced
- [x] A-007 R7: the group-header picker renders the flair band with zero `SwatchPopover` component changes; selection persists + repaints optimistically; `""` clears

### Behavioral Correctness

- [x] A-008 R2: validation uses the existing `validate.ValidateFlairValue` — `ValidateServerFlairValue` does not exist anywhere in the diff; no new code enumerates flair names
- [x] A-009 R4: no SSE/derive path added for server flair (settings mutations emit no control-mode event — the optimistic map is the only live update)

### Scenario Coverage

- [x] A-010 R1: settings tests cover round-trip, empty-section byte-identical serialization, malformed-entry drop
- [x] A-011 R2: handler tests cover accept-all-universal-tokens, reject-unknown (400, nothing persisted), both GET forms, clear via null AND `""`
- [x] A-012 R5, R6, R7: sidebar tests cover both mounts, the drag-source hide, and the picker band + selection funnel

### Edge Cases & Error Handling

- [x] A-013 R2: `POST` with missing/empty `server` → 400; invalid JSON body → 400
- [x] A-014 R4: `setServerFlair` rejection surfaces a toast and does not crash; the optimistic update is not rolled back (matching the server-color funnel's existing behavior)

### Code Quality

- [x] A-015 Pattern consistency: new code follows the settings-registry, handler-mirror, and client-mirror patterns of its surroundings
- [x] A-016 No unnecessary duplication: existing `validate.FlairValues`/`ValidateFlairValue`, `FlairOverlay`, `SwatchPopover` band, and `mapSection` are reused — no parallel implementations
- [x] A-017 No client polling: flair state is mount-fetched + optimistic, no `setInterval`/refetch loop
- [x] A-018 Comments state constraints only — no narration, no change-ID citations in code comments

### Security

- [x] A-019 R2: flair value validated against the closed set before persistence (constitution I); server name handled as on the server-color handler (same input class, same treatment)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a new flair channel for the server tier (storage, endpoint, client, state, two mounts, picker wiring) without making any existing file, function, branch, or config redundant. All new code rides existing utilities (`mapSection`, `validate.FlairValues`/`ValidateFlairValue`, `FlairOverlay`, the `SwatchPopover` flair band, the x4sf optimistic funnel); nothing was superseded.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `server_flairs` parse/serialize rides the current `mapSection` registry with a membership-check normalize closure, not the ref's scanner branches | Current main refactored the parser into the `nestedSection` registry after the ref was cut; the intake says "follow its existing style on current main" | S:80 R:85 A:90 D:85 |
| 2 | Confident | Picker wiring lands only at the group-header `SwatchPopover` (index.tsx:2704) — the SERVER tile has no picker on current main | Verified: server-panel.tsx contains no `SwatchPopover`; the intake's "server call sites" resolves to the one existing site | S:70 R:85 A:85 D:75 |
| 3 | Certain | `GET ?server=` returns `{"flair": token\|null}` and bare GET returns `{"flairs": {}}` (empty map, never null) | Exact ref handler shape, mirroring the server-color contract on current main | S:90 R:90 A:90 D:90 |
| 4 | Confident | The group-header overlay's tint color is `headerAccent` (the guarded `rowBorders` value the header already computes); the tile's is its guarded stripe source | Intake: "pass the server's guarded border color where the row mounts pass theirs"; `headerAccent` is that value at the header | S:75 R:90 A:85 D:80 |

4 assumptions (1 certain, 3 confident, 0 tentative).
