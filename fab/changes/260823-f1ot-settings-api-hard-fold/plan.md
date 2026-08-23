# Plan: Settings API Hard Fold

**Change**: 260823-f1ot-settings-api-hard-fold
**Intake**: `intake.md`

## Requirements

### Backend: settings registry surface

#### R1: Exported registry metadata and generic value access
`internal/settings` SHALL export the registry as read-only metadata — `type KeyInfo struct { Key, Kind, Default, Description, Category string; UI, Live bool }` and `func Registry() []KeyInfo` returning entries in registry slice order — plus generic per-key value access for the API: a way to read every key's current value in its natural JSON type (string scalars, bool, `map[string]string`, `[]string`) and a way to apply one key's JSON patch value onto a loaded `Settings` (mutating in memory, NOT saving) so the API can do one `Load → apply-all → Save`. Adding a future key MUST remain one registry entry — no new switches in the API layer for value plumbing.

- **GIVEN** the Phase-1 registry with 12 entries
- **WHEN** `Registry()` is called
- **THEN** 12 `KeyInfo` values are returned in registry order (`theme` first, `board_order` last) with the metadata verbatim from the table

- **GIVEN** a loaded `Settings` with `instance_color` unset and `server_colors: {"default": "4"}`
- **WHEN** current values are read generically
- **THEN** `instance_color` yields JSON `null` (empty scalar with empty default) and `server_colors` yields `{"default": "4"}`

#### R2: Merge semantics per key kind
The generic per-key apply SHALL implement Constitution IX partial-merge semantics: `null` unsets (resets to registry default); string scalars are trimmed with trimmed-to-empty treated as `null`; map keys (`server_colors`, `server_flairs`) merge **per-entry** — an entry value of `null` unsets that entry, other entries are untouched, a top-level `null` clears the whole map; the list key (`board_order`) replaces wholesale, with top-level `null` equivalent to `[]`. Invalid values (wrong JSON type for the kind, malformed color descriptor, unknown flair token, invalid ssh-host/instance-name characters, non-bool `auto_name`, `log_level` outside `info|debug`, empty-after-trim `theme`/`theme_dark`/`theme_light`) SHALL be rejected with an error before any mutation of the target key.

- **GIVEN** stored `server_colors: {"dev": "4", "prod": "2"}`
- **WHEN** a patch `{"server_colors": {"dev": null, "stage": "1+3"}}` is applied
- **THEN** the result is `{"prod": "2", "stage": "1+3"}`

- **GIVEN** stored `instance_name: "my-box"`
- **WHEN** a patch `{"instance_name": null}` (or `{"instance_name": "  "}`) is applied
- **THEN** `instance_name` is unset and a subsequent generic read yields `null`

### Backend: GET /api/settings

#### R3: GET returns registry + current values
`GET /api/settings` SHALL return `{"settings": [...]}` — one object per registry entry, in registry order, each carrying `key`, `kind`, `default`, `description`, `category`, `ui`, `live`, and `value` (natural JSON type; `null` for unset string scalars; maps as objects, possibly `{}`; `board_order` as an array, possibly `[]`; `auto_name` as a bool). JSON field names for keys are the snake_case registry names verbatim.

- **GIVEN** a fresh instance with no config.yaml
- **WHEN** `GET /api/settings` is served
- **THEN** 12 entries return in registry order with `theme.value == "system"`, `instance_color.value == null`, `server_colors.value == {}`, `board_order.value == []`, `auto_name.value == false`, `log_level.value == "info"`

### Backend: POST /api/settings

#### R4: POST partial merge with all-or-nothing validation
`POST /api/settings` SHALL accept a flat JSON object of registry keys and apply R2's merge semantics. An unknown key, a malformed body, or any per-key validation failure SHALL be a `400` with **nothing persisted** (validate the whole body, then one `Load → apply-all → Save`). Board-order entries SHALL be validated at the API layer with `tmux.ValidBoardName` plus duplicate rejection (`internal/settings` cannot import `internal/tmux` — import cycle via `tmux.go:19`). Success returns `200 {"status": "ok"}`. Per Constitution IX the mutation is POST-only; per Constitution I all validation runs before persist.

- **GIVEN** a body `{"theme": "dark", "bogus_key": 1}`
- **WHEN** POSTed to `/api/settings`
- **THEN** the response is `400` and the stored `theme` is unchanged

- **GIVEN** a body `{"ssh_host": "devbox", "board_order": ["deploys", "deploys"]}`
- **WHEN** POSTed
- **THEN** the response is `400` (duplicate board name) and `ssh_host` is NOT persisted

#### R5: Board-order SSE broadcast preserved
When a successful `POST /api/settings` body contains `board_order`, the handler SHALL broadcast the new order via `s.initSSEHub()` + `s.sseHub.broadcastBoardOrder(order)` (the server-global `board-order` event, `api/sse.go:867`) after the save — exactly the side effect `handleBoardOrderPost` performs today. No other key gains a broadcast or side effect in this change (live-apply plumbing is Phase 3).

- **GIVEN** two connected state-socket clients
- **WHEN** one client POSTs `{"board_order": ["reviews", "deploys"]}`
- **THEN** both clients receive a `board-order` SSE event carrying the new order

### Backend: hard fold

#### R6: Seven per-key endpoints deleted
The following handlers and route registrations SHALL be deleted in this change, with no shim, alias, or redirect left behind: `GET/POST /api/settings/theme`, `/server-color`, `/server-flair`, `/instance-color`, `/ssh-host`, `/instance-name` (handlers in `api/settings.go`, routes `api/router.go:764-775`) and `POST /api/boards/order` (`handleBoardOrderPost` in `api/boards.go`, route `api/router.go:699`). After the change, `api/settings.go` contains only the two new handlers.

- **GIVEN** the new binary
- **WHEN** `GET /api/settings/theme` or `POST /api/boards/order` is requested
- **THEN** the router returns 404/405 (no handler is registered)

#### R7: Retained surfaces unchanged
The fold is HTTP-surface-only. These SHALL keep working unchanged: server-side board sorting in `GET /api/boards` (`sortBoardsByStoredOrder` + `settings.GetBoardOrder()`, `api/boards.go:42,52`); `GET /api/health`'s `sshHost`/`instanceName` derivation; every exported Go accessor on `internal/settings` (`Load`, `Save`, typed getters/setters) and their consumers (`internal/tmux`, `api/router.go:613` `AutoName`).

- **GIVEN** a stored board order and boards on disk
- **WHEN** `GET /api/boards` is served
- **THEN** boards return sorted by the stored order, ranked-first then alphabetical — identical to pre-change behavior

### Frontend: client call sites

#### R8: Settings client functions keep signatures, ride the new endpoints
The 13 settings functions in `app/frontend/src/api/client.ts` (`getThemePreference`, `setThemePreference`, `getServerColor`, `getAllServerColors`, `setServerColor`, `getAllServerFlairs`, `setServerFlair`, `getInstanceColor`, `setInstanceColor`, `getSSHHost`, `setSSHHost`, `getInstanceName`, `setInstanceName`) SHALL keep their exported names, parameters, and return types while their internals move to a shared typed `GET /api/settings` reader (via `deduplicatedFetch`, so concurrent mount-time getters share one request) and a shared `POST /api/settings` writer (plain `fetch`, rejecting via `throwOnError` so callers keep rendering 400s inline). Map setters post a single-entry per-entry merge (`{"server_colors": {server: color}}`). Components and contexts SHALL NOT need changes.

- **GIVEN** the theme context, accent context, and name context mounting together
- **WHEN** their getters fire concurrently
- **THEN** one deduplicated `GET /api/settings` request serves all of them and each getter resolves its previous return shape

#### R9: setBoardOrder rides the new endpoint
`setBoardOrder(order)` in `app/frontend/src/api/boards.ts` SHALL POST `{"board_order": [...]}` to `/api/settings` (keeping its exported signature and `throwOnError` behavior); the `board-order` SSE consumption path is unchanged.

- **GIVEN** a user drags a board row to reorder
- **WHEN** `setBoardOrder` fires
- **THEN** the order persists via `POST /api/settings` and every client re-sorts on the SSE echo

### Tests

#### R10: Backend test coverage for the new surface
`api/settings_test.go` SHALL be rewritten against the two endpoints: GET shape (registry order, metadata fields, null-for-unset, map/list/bool values), the POST merge matrix (set / absent / top-level null / per-entry null / empty-string-equals-null / list replacement), per-key validation 400s, unknown-key 400, all-or-nothing on a partially-invalid body, and the `board_order` broadcast. Board-order tests in `api/boards_test.go` move accordingly; `GET /api/boards` sorting tests stay. `internal/settings` round-trip/byte-stability tests stay untouched; new package tests cover `Registry()` and the generic value read/apply.

- **GIVEN** the backend test suite
- **WHEN** `go test ./...` runs in `app/backend`
- **THEN** all tests pass with the old endpoint tests fully removed (no skipped or commented remains)

#### R11: Frontend test mocks updated
Every frontend test stubbing an old endpoint SHALL be updated to the new shape: `client.test.ts` and `boards.test.ts` msw handlers, plus a repo-wide sweep of `/api/settings/` and `/api/boards/order` literals across `src/**/*.test.ts(x)` and `tests/**/*.spec.ts` (known stub sites include `top-bar.test.tsx`, `theme-context.test.tsx`, `settings-dialog.test.tsx`, `instance-name-context.test.tsx`, `instance-accent-context.test.tsx`, `themes.test.ts`, `theme-selector.test.tsx`, `host-overview-page.test.tsx`, `sidebar` tests, `use-board-list-reorder.test.ts`, `palette-move.test.ts`, `shell-titlebar-strip.test.tsx`, `status-bar.test.tsx`, `terminal-client.test.tsx`, `board-page` / `boards-section` / `host-panel` tests). Playwright route mocks MUST keep the trailing-`*` glob discipline for mutating routes. If a `.spec.ts` changes, its sibling `.spec.md` is checked and updated in the same commit (Constitution: Test Companion Docs).

- **GIVEN** the frontend suites
- **WHEN** `npx tsc --noEmit` and the Vitest + Playwright suites run
- **THEN** all pass with no test still pointing at a deleted endpoint

### Non-Goals

- No settings pane UI, no palette actions, no live-apply/restart badging (Phase 3).
- No new SSE events beyond the preserved `board-order` broadcast.
- No change to config.yaml format, byte-stable serialization, or migrations (Phase 1 owns them).
- No CLI surface change; no `docs/site`/README work (no user-facing CLI behavior changes).
- No external-consumer compat: no shims, no deprecation window.

### Design Decisions

#### GET shape: array of full registry entries
**Decision**: `{"settings": [{key, kind, default, description, category, ui, live, value}]}` in registry order, snake_case registry key names verbatim.
**Why**: the pane (Phase 3) renders typed controls straight from this — one payload, ordered, self-describing; null-for-unset preserves today's read contract.
**Rejected**: split `{registry: [...], values: {...}}` (two structures to zip client-side); values-only map (drops the metadata the pane needs, defeating the registry).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

#### Value plumbing in registry hooks, board-name validation at the API layer
**Decision**: registry entries gain generic JSON value read/apply hooks (normalization + value-shape validation lives with the entry, reusing `internal/validate`); board-order **name** validity (`tmux.ValidBoardName`) and duplicate rejection stay in the API handler.
**Why**: keeps "adding a key is one registry entry" true for the API path; `internal/tmux` imports `internal/settings` (tmux.go:19), so settings calling into tmux is an import cycle — the API package already imports both.
**Rejected**: a 12-arm key switch in `api/settings.go` (reintroduces per-key growth at the HTTP layer); moving `ValidBoardName` into `internal/validate` (churns `api/boards.go` callers for no behavioral gain).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

#### Per-entry map merge
**Decision**: map-kind keys merge per-entry with `null` unsetting one entry; top-level `null` clears the map; `board_order` replaces wholesale.
**Why**: mirrors today's `SetServerColor(server, color *string)` one-entry semantics so client setters stay one-entry-sized; a full-map replace would force every color-picker click to read-modify-write the whole map client-side (racy across tabs).
**Rejected**: wholesale map replacement (race-prone, bigger client diffs); JSON-merge-patch RFC 7386 wholesale-object semantics (breaks the one-entry setter shape).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

### Deprecated Requirements

#### Per-key settings endpoints
**Reason**: superseded by the single registry-driven `GET/POST /api/settings` (plan Phase 2, Constitution IV single-settings-surface carve-out).
**Migration**: frontend callers move to the new endpoints in this same change; no external consumers exist.

## Tasks

### Phase 1: Registry surface (backend)

- [x] T001 `app/backend/internal/settings/settings.go`: add exported `KeyInfo` + `Registry()` (registry order, metadata verbatim) <!-- R1 -->
- [x] T002 `app/backend/internal/settings/settings.go`: add per-entry generic JSON value read + apply hooks and exported helpers (read all current values; apply one key's patch onto a `*Settings` with null-unset / trim / per-entry map merge / list replace / value validation via `internal/validate`) <!-- R1, R2 -->
- [x] T003 `app/backend/internal/settings/settings_test.go`: tests for `Registry()` order+metadata and the apply merge matrix (null unsets, empty-string-equals-null, per-entry map merge, list replace, invalid-value errors); round-trip tests untouched <!-- R1, R2 -->

### Phase 2: Endpoints (backend)

- [x] T004 `app/backend/api/settings.go`: replace all twelve handlers with `handleGetSettings` (R3 shape) and `handlePostSettings` (decode `map[string]json.RawMessage`, unknown-key 400, per-key validate incl. `tmux.ValidBoardName` + dup check for `board_order`, all-or-nothing `Load → apply-all → Save`, `board_order` broadcast via `initSSEHub` + `broadcastBoardOrder`, `200 {"status":"ok"}`) <!-- R3, R4, R5, R6 -->
- [x] T005 `app/backend/api/router.go`: register `GET/POST /api/settings`; delete the 12 per-key registrations (764-775) and `POST /api/boards/order` (699) <!-- R6 -->
- [x] T006 `app/backend/api/boards.go`: delete `handleBoardOrderPost`; keep `sortBoardsByStoredOrder` + `settings.GetBoardOrder()` in `handleBoardsList` <!-- R6, R7 -->
- [x] T007 `app/backend/api/settings_test.go`: rewrite for the two endpoints per R10 (GET shape, POST matrix, 400s, all-or-nothing, broadcast assertion) <!-- R10 -->
- [x] T008 `app/backend/api/boards_test.go`: remove order-POST tests (coverage moved to T007); keep/verify `GET /api/boards` sorting tests <!-- R7, R10 -->

### Phase 3: Frontend call sites

- [x] T009 `app/frontend/src/api/client.ts`: shared typed `GET /api/settings` reader (deduplicatedFetch) + `POST /api/settings` writer; rewrite the 13 settings functions preserving exported signatures and throwOnError behavior <!-- R8 -->
- [x] T010 `app/frontend/src/api/boards.ts`: `setBoardOrder` posts `{"board_order": [...]}` to `/api/settings` <!-- R9 -->
- [x] T011 `app/frontend/src/api/client.test.ts` + `app/frontend/src/api/boards.test.ts`: msw handlers moved to the new endpoints; add a dedup assertion (concurrent getters → one GET) <!-- R11 -->
- [x] T012 Repo-wide sweep of `/api/settings/` and `/api/boards/order` literals in `app/frontend/src/**/*.test.ts(x)` and `app/frontend/tests/**/*.spec.ts`; update every stub to the new shape (trailing-`*` globs on mutating Playwright routes; sibling `.spec.md` updated when a `.spec.ts` changes) <!-- R11 -->

### Phase 4: Verification

- [x] T013 Gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; targeted `just test-e2e` for specs touched by T012; `just build` <!-- R10, R11 -->

## Execution Order

- T001-T002 block T004 (API consumes the exported surface); T003 parallel with T004+.
- T004 blocks T005/T007; T005+T006 together make the fold compile.
- T009 blocks T010-T012 (shared reader/writer first).
- T013 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `settings.Registry()` returns 12 `KeyInfo` entries in registry order with metadata matching the registry table
- [x] A-002 R3: `GET /api/settings` returns the R3 shape — registry order, all metadata fields, values in natural JSON types, `null` for unset scalars
- [x] A-003 R4: `POST /api/settings` sets present keys, leaves absent keys untouched, unsets on `null`, and returns `{"status":"ok"}`
- [x] A-004 R8: all 13 client.ts settings functions keep signatures and work over the new endpoints; no component/context file changed
- [x] A-005 R9: `setBoardOrder` persists via `POST /api/settings` and the SSE `board-order` echo still re-sorts clients

### Behavioral Correctness

- [x] A-006 R2: per-entry map merge verified — setting one server's color leaves other entries untouched; entry `null` unsets exactly that entry
- [x] A-007 R2: string-scalar trim + empty-equals-null verified for `ssh_host`/`instance_name`/`instance_color`
- [x] A-008 R5: a successful POST containing `board_order` broadcasts `board-order` with the new list; a POST without it broadcasts nothing

### Removal Verification

- [x] A-009 R6: no handler, route, client function, or test references `/api/settings/theme|server-color|server-flair|instance-color|ssh-host|instance-name` or `/api/boards/order` (repo-wide grep clean, excluding docs/memory pending hydrate)

### Scenario Coverage

- [x] A-010 R3: fresh-instance GET scenario covered by a test (defaults: theme "system", empty maps/list, auto_name false)
- [x] A-011 R4: unknown-key 400 and partially-invalid-body-persists-nothing both covered by tests
- [x] A-012 R7: `GET /api/boards` sorting and `GET /api/health` sshHost/instanceName verified unchanged by existing tests still passing

### Edge Cases & Error Handling

- [x] A-013 R4: duplicate board name and invalid board name in `board_order` → 400, nothing persisted
- [x] A-014 R2: wrong JSON type for a key's kind (e.g. string for `server_colors`, number for `theme`) → 400
- [x] A-015 R4: malformed JSON body → 400 "Invalid JSON body" convention preserved

### Code Quality

- [x] A-016 Pattern consistency: new handlers follow `writeJSON`/`writeError` conventions; settings hooks follow the registry-entry style landed in Phase 1
- [x] A-017 No unnecessary duplication: one shared reader/writer pair in client.ts; no per-key fetch bodies remain
- [x] A-018 No comment narration: comments state contracts (merge semantics, broadcast rationale, import-cycle constraint), not change history
- [x] A-019 Tests included for added/changed behavior per code-quality.md (backend + frontend)

### Security

- [x] A-020 R4: every validator that guarded the old endpoints (`ValidateColorValue`, `ValidateSSHHost`, `ValidateInstanceName`, `ValidateFlairValue`, `ValidBoardName`) still runs before persist on the new path; no raw value reaches config.yaml or deeplink construction unvalidated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Registry hooks own value read/apply; board-name validity stays API-side | Import cycle (tmux → settings) verified; API package imports both | S:60 R:85 A:85 D:65 |
| 2 | Confident | Client dedup: one `GET /api/settings` behind `deduplicatedFetch` serves all getters | Existing deduplicatedFetch pattern; mount-time burst collapses naturally | S:60 R:90 A:85 D:70 |
| 3 | Confident | POST response `{"status":"ok"}` (not `{"ok":true}`) | Majority convention of the folded settings endpoints; boards/order's `{"ok":true}` is the outlier | S:55 R:90 A:80 D:60 |
| 4 | Certain | e2e/unit test sweep is in-scope; `.spec.md` companions updated when `.spec.ts` changes | Constitution Test Companion Docs is unconditional | S:80 R:85 A:95 D:90 |
| 5 | Confident | `theme`/`theme_dark`/`theme_light` reject a trimmed-to-empty non-null value (400) instead of treating it as unset; `null` still resets to the registry default | The registry has no meaningful "unset" for these keys (defaults are non-empty and the file format omits them only at default), so empty-equals-unset would be a silent no-op write; rejecting matches R2's "empty-after-trim theme rejected" wording | S:55 R:80 A:80 D:60 |
| 6 | Confident | `setBoardOrder` keeps its exported `{ok: true}` return shape (synthesized client-side) even though POST /api/settings answers `{"status":"ok"}` | R8/R9 require exported signatures and return types preserved so consumers stay untouched | S:60 R:85 A:85 D:65 |

6 assumptions (2 certain, 4 confident, 0 tentative).

## Deletion Candidates

- `app/backend/internal/settings/settings.go` — typed setters `SetInstanceColor`/`SetSSHHost`/`SetInstanceName`/`SetServerColor`/`SetServerFlair`/`SetBoardOrder` (and possibly matching getters) may now have zero non-test call sites after the HTTP fold; verify during hydrate/cleanup and delete the dead ones (Phase 3 will own any re-introduction need).
- `docs/specs/themes.md:292` — spec prose still cites the folded `GET/PUT /api/settings/theme` endpoint (also wrongly says PUT); needs a spec touch-up to `GET/POST /api/settings` (out of review scope per intake; flagged for hydrate/spec follow-up).
