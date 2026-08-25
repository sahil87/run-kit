# Intake: Settings API Hard Fold

**Change**: 260823-f1ot-settings-api-hard-fold
**Created**: 2026-08-23

## Origin

One-shot `/fab-new` invocation executing Phase 2 of the consolidated config plan (`fab/plans/sahil/26-08-23-config-consolidated.md`), now that Phase 1 (config root + registry core, `260823-li54`, PR #720) is merged to main. Raw input:

> Implement Phase 2 (Settings API) of fab/plans/sahil/26-08-23-config-consolidated.md, now that Phase 1 (root + registry core, PR #720) is merged to main. Scope: GET /api/settings (registry + current values) and POST /api/settings (partial merge per Constitution IX — present keys set, null unsets), built on the settings registry landed by Phase 1. HARD FOLD, no shims: delete the seven per-key endpoints (theme, instance color, instance name, ssh host, server colors, server flairs, board order) in this SAME change and update every frontend caller to use the new GET/POST /api/settings — there are no external API consumers so no compat shims are needed. Do NOT build the settings pane UI (that is Phase 3, a separate later change that depends on this one) — only the API and the necessary frontend client-side call-site updates to keep existing features working through the new endpoint shape. Verify every file/line anchor cited in the plan against current code (post-Phase-1) before implementing.

Every file/line anchor below was verified against the current worktree (post-Phase-1 main, `cdaa10e1`) during intake. The plan doc and the 2026-08-23 brainstorm record (the "Config Sanitization Board" artifact) carry the settled design decisions; this intake transfers them.

## Why

1. **Pain point**: the settings HTTP surface grew endpoint-by-endpoint — six GET/POST pairs in `app/backend/api/settings.go` plus `POST /api/boards/order` in `app/backend/api/boards.go`, each with its own handler pair, its own body shape, and its own `src/api/client.ts` function pair. Adding a settings key means adding an endpoint pair + client functions, exactly the scalar-switch growth the Phase-1 registry was built to end. Phase 1 made key addition one registry entry on the storage side; the HTTP layer still pays the old per-key tax.
2. **Consequence of not doing it**: Phase 3 (the registry-driven settings pane) needs `registry metadata + current values` in one response and one generic mutation path — without this API it would have to enumerate per-key endpoints, hard-coding the key inventory into the frontend and defeating the registry. Constitution §IV's carve-out ("a single registry-driven settings surface … backed by the `internal/settings` registry") is only satisfiable on top of a registry-driven API.
3. **Why hard fold over shims**: frontend and backend ship in one binary and there are no external API consumers, so per-key shims would be compat machinery with no compat audience (plan §"Settings registry, API, pane", settled 2026-08-23). Deleting the seven endpoints in the same change keeps exactly one way to read/write settings.

## What Changes

### 1. `internal/settings`: exported registry read/write surface

The Phase-1 registry (`app/backend/internal/settings/settings.go:209`, `var registry = []registryEntry{…}`) is unexported; entries already carry `key, kind, def, desc, category, ui, live` (settings.go:185-203) — the API needs an exported view plus generic per-key value access:

- An exported metadata type + accessor, e.g. `type KeyInfo struct { Key, Kind, Default, Description, Category string; UI, Live bool }` and `func Registry() []KeyInfo`, returned in registry slice order (slice order is the stable serialization/display order).
- Generic value read for GET: per-key current value in its natural JSON type — `string` scalars (`theme`, `theme_dark`, `theme_light`, `instance_color`, `ssh_host`, `instance_name`, `tmux_conf`, `log_level`), `bool` (`auto_name`), `map[string]string` (`server_colors`, `server_flairs`), `[]string` (`board_order`).
- Generic value write for POST honoring the merge semantics in §3. The exact Go shape (registry `apply`/`validate` hooks vs an API-layer key switch over the existing typed setters) is a plan-level decision — but **board-name validation cannot move into `internal/settings`**: `internal/tmux` imports `internal/settings` (`tmux.go:19`), so settings importing `tmux.ValidBoardName` would be an import cycle. Board-order validation stays at the API layer (as it is today in `handleBoardOrderPost`).
- The existing exported typed accessors (`GetServerColor`, `SetServerColor`, `GetSSHHost`, `GetBoardOrder`, `Load`, `Save`, …) **stay** — Go-side consumers (`api/health.go` sshHost, `api/boards.go` sorting, `api/router.go:613` `settings.Load().AutoName`, `internal/tmux`) are untouched. The fold is HTTP-surface-only.

### 2. New endpoint: `GET /api/settings`

Returns registry metadata + current values in one payload, entries in registry order:

```json
{
  "settings": [
    {"key": "theme", "kind": "enum", "default": "system", "description": "UI color mode — system, dark, light, or a named theme.", "category": "appearance", "ui": true, "live": true, "value": "system"},
    {"key": "instance_color", "kind": "color", "default": "", "description": "…", "category": "appearance", "ui": true, "live": true, "value": null},
    {"key": "server_colors", "kind": "map", "default": "{}", "description": "…", "category": "appearance", "ui": true, "live": true, "value": {"default": "4"}},
    {"key": "board_order", "kind": "list", "default": "[]", "description": "…", "category": "layout", "ui": true, "live": true, "value": ["deploys", "reviews"]}
  ]
}
```

- JSON keys are the registry key names verbatim (snake_case, matching config.yaml).
- Unset string scalars (empty-string stored value with empty default) surface as `null` — preserving the null-means-unset contract of today's per-key GETs (`instance_color`, `ssh_host`, `instance_name`, `tmux_conf`). Keys with non-empty defaults (`theme`, `theme_dark`, `theme_light`, `log_level`) always carry a string. Maps surface as objects (possibly `{}`), `board_order` as an array (possibly `[]`), `auto_name` as a bool.
- All 12 registry keys are returned (all are `ui: true` today; the response carries the `ui` flag so Phase 3 can filter if that ever changes).

### 3. New endpoint: `POST /api/settings` (partial merge per Constitution IX)

Body is a flat JSON object of registry keys. Semantics, per Constitution §IX's documented body contract ("partial-merge: present keys set, `null` unsets"):

- **Present key** → set. **Absent key** → untouched. **`null` value** → unset (reset to the registry default; for string scalars that is the empty/unset state).
- **String scalars**: trimmed; trimmed-to-empty is treated as `null` (today's empty-equals-unset contract in `handleSetSSHHost`/`handleSetInstanceName`/`handleSetServerFlair`).
- **Maps** (`server_colors`, `server_flairs`): per-entry merge — `{"server_colors": {"dev": "4", "old": null}}` sets `dev` and unsets `old`, leaving other entries untouched. This mirrors today's `SetServerColor(server, color *string)` one-entry semantics, keeps client calls one-entry-sized, and makes `null`-unsets uniform at both levels. A top-level `null` map clears the whole map.
- **List** (`board_order`): wholesale replacement (rank = index; every reorder replaces the full stored list so stale names self-heal — today's contract). Top-level `null` or `[]` clears.
- **Validation before any write, all-or-nothing**: the entire body is validated, then one `Load()` → merge → `Save()`. Any failure is a 400 with nothing persisted. Per-key validators are today's, unchanged: `validate.ValidateColorValue` (instance_color, server_colors entries), `validate.ValidateSSHHost`, `validate.ValidateInstanceName`, `validate.ValidateFlairValue` (empty token = unset), `tmux.ValidBoardName` + duplicate rejection for board_order entries, `strconv.ParseBool`-shaped bool for auto_name, `info|debug` enum for log_level, non-empty string for theme/theme_dark/theme_light.
- **Unknown key → 400**, nothing persisted (the `DisallowUnknownFields` posture `handleBoardOrderPost` already takes).
- **Response**: `200 {"status": "ok"}` (the existing settings-POST convention).
- **Side effect preserved**: when the body contains `board_order`, after a successful save the handler broadcasts the new order via `s.initSSEHub()` + `s.sseHub.broadcastBoardOrder(order)` (`api/sse.go:867`) — the server-global `board-order` SSE event every client re-sorts on. Losing this would regress live multi-client board reordering. No other settings key has a broadcast side effect today, and none is added (live-apply plumbing is Phase 3).

### 4. Hard fold: deletions (same change, no shims)

| Deleted surface | Where (verified) |
|---|---|
| `GET`+`POST /api/settings/theme` | `api/settings.go:14,25`; routes `api/router.go:764-765` |
| `GET`+`POST /api/settings/server-color` | `api/settings.go:87,239`; routes 766-767 |
| `GET`+`POST /api/settings/server-flair` | `api/settings.go:105,270`; routes 768-769 |
| `GET`+`POST /api/settings/instance-color` | `api/settings.go:123,130`; routes 770-771 |
| `GET`+`POST /api/settings/ssh-host` | `api/settings.go:157,167`; routes 772-773 |
| `GET`+`POST /api/settings/instance-name` | `api/settings.go:198,208`; routes 774-775 |
| `POST /api/boards/order` | `handleBoardOrderPost` `api/boards.go:315`; route `api/router.go:699` |

`api/settings.go` ends up holding only the two new handlers. **Not deleted**: the read side of board order embedded in `GET /api/boards` (`sortBoardsByStoredOrder` + `settings.GetBoardOrder()`, `api/boards.go:42,52`) — server-side sorting stays; and `GET /api/health`'s `sshHost`/`instanceName` derivation.

### 5. Frontend call-site updates

Strategy: **keep the exported client-function signatures, swap their internals** to the new endpoints — components and contexts stay untouched, and Phase 3 builds its own full-registry consumption later.

- `src/api/client.ts:1017-1150`: `getThemePreference`, `setThemePreference`, `getServerColor`, `getAllServerColors`, `setServerColor`, `getAllServerFlairs`, `setServerFlair`, `getInstanceColor`, `setInstanceColor`, `getSSHHost`, `setSSHHost`, `getInstanceName`, `setInstanceName` — rewritten over a shared typed `GET /api/settings` fetch (via `deduplicatedFetch`, so the mount-time burst of per-key reads collapses into one request) and a shared `POST /api/settings` helper. Getters pluck their key from the settings array; setters post their one key (maps post one entry).
- `src/api/boards.ts:107` `setBoardOrder(order)` — now posts `{"board_order": [...]}` to `/api/settings`; SSE `board-order` event contract unchanged.
- Known consumers that must keep working unchanged: `theme-context.tsx`, `themes.ts`, `theme-selector.tsx`, `instance-accent-context.tsx`, `instance-name-context.tsx`, `settings-dialog.tsx`, `sidebar/` (server colors/flairs), `use-board-list-reorder.ts`, `host-overview-page`, `app.tsx`.
- 400-propagation contract stays: setters reject via `throwOnError` so dialogs render validation errors inline.

### 6. Tests

- `api/settings_test.go`: rewritten for the two endpoints — GET shape (registry order, metadata fields, null-for-unset, map/list values), POST merge matrix (set/absent/null at both levels, empty-string-equals-null), per-key validation 400s, unknown-key 400, all-or-nothing on partial failure, board_order broadcast.
- `api/boards_test.go`: board-order-POST tests move to the settings-endpoint tests; `GET /api/boards` sorting tests unchanged.
- Frontend: `client.test.ts` msw handlers move to `/api/settings` (incl. the deduplicated single-GET behavior); `boards.test.ts` `setBoardOrder` handler updated; consumer tests (`theme-context.test.tsx`, `settings-dialog.test.tsx`, `use-board-list-reorder.test.ts`, …) keep passing with only mock-route updates where they stub the old paths.
- `internal/settings` package tests: byte-stable round-trip tests untouched; new tests only for the exported registry/value surface.

## Affected Memory

- `run-kit/configuration`: (modify) Settings Registry section — replace "the seven per-key endpoints in `api/settings.go` ride it unchanged" with the GET/POST `/api/settings` contract (merge semantics, null-unsets, validation posture).
- `run-kit/architecture`: (modify) REST endpoint table rows for the six `/api/settings/*` pairs and `/api/boards/order` (architecture.md:231-239) collapse into the two new rows; frontend client-function table (architecture.md:335-345) updated; `api/settings.go` file comment (architecture.md:62).
- `run-kit/ui/visual-design`: (modify) theme persistence references (`GET/PUT /api/settings/theme`, visual-design.md:37,135) point at the new endpoint; instance-accent endpoint pointer (visual-design.md:224).
- `run-kit/ui/dialogs-and-state`: (modify) settings-dialog theme row's `/api/settings/theme` reference (dialogs-and-state.md:118).
- `run-kit/ui/routes-and-shell`: (modify) instance-name endpoint pointer (routes-and-shell.md:213).

## Impact

- **Backend**: `app/backend/api/settings.go` (rewrite), `app/backend/api/boards.go` (delete order handler), `app/backend/api/router.go` (route swap), `app/backend/internal/settings/settings.go` (exported registry surface), plus their `_test.go` files.
- **Frontend**: `app/frontend/src/api/client.ts`, `app/frontend/src/api/boards.ts` and their tests; component/context test files only where they stub the old routes. No component behavior changes.
- **Docs**: `docs/specs/api.md` documents the target API surface (human-curated) — flag the endpoint fold for a spec touch-up; memory updates land at hydrate.
- **No** CLI surface change, no CORS change (GET/POST already allowlisted per Constitution IX), no settings-file format change, no external consumers.

## Open Questions

- None — the plan doc plus the invocation resolved every scope question; remaining choices are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Exactly two endpoints — `GET /api/settings` and `POST /api/settings`; POST is a partial merge (present keys set, `null` unsets), no other verbs | Constitution IX + plan state this verbatim | S:95 R:90 A:100 D:95 |
| 2 | Certain | Hard fold: all seven per-key endpoints (incl. `POST /api/boards/order`) deleted in this same change, zero compat shims | Invocation + plan verbatim; one binary, no external consumers | S:100 R:85 A:95 D:95 |
| 3 | Certain | No settings pane UI — Phase 3; frontend work limited to client call-site updates keeping existing features working | Invocation states the boundary explicitly | S:100 R:90 A:95 D:100 |
| 4 | Certain | `POST /api/settings` preserves the `broadcastBoardOrder` SSE side effect when `board_order` is in the body | Existing live-reorder behavior; invocation requires features keep working; no other key gains a broadcast (live-apply is Phase 3) | S:85 R:80 A:95 D:90 |
| 5 | Certain | Go-side typed accessors and `GET /api/boards` server-side order sorting stay — the fold is HTTP-surface-only | `internal/tmux`, `health.go`, `boards.go` consume them; plan folds endpoints, not the package API | S:80 R:85 A:95 D:90 |
| 6 | Confident | GET response shape: `{"settings": [...]}` — array of full registry entries (key/kind/default/description/category/ui/live/value) in registry order, snake_case registry key names, values in natural JSON types, `null` for unset string scalars | Plan says "registry + values" without fixing the shape; array-in-registry-order is the obvious registry-driven form and preserves today's null-means-unset reads | S:70 R:85 A:80 D:65 |
| 7 | Confident | Merge depth: map keys merge per-entry (entry `null` unsets that entry), `board_order` replaces wholesale, top-level `null` resets any key to default | Mirrors existing `SetServerColor`/`SetBoardOrder` semantics; Constitution IX names only the top level, this is the consistent extension | S:60 R:80 A:80 D:60 |
| 8 | Confident | Frontend keeps exported client function signatures (`getThemePreference` … `setBoardOrder`); only internals move to the new endpoints; components/contexts untouched | Minimal-churn reading of "necessary call-site updates to keep existing features working"; Phase 3 owns any consumer restructuring | S:65 R:90 A:85 D:70 |
| 9 | Confident | POST posture: unknown key → 400, full-body validation before a single Load→merge→Save (all-or-nothing, nothing persisted on any 400) | Matches `DisallowUnknownFields` precedent and the validate-before-persist rule (Constitution I); partial-persist on error would be a new failure mode | S:60 R:85 A:85 D:70 |
| 10 | Confident | Board-name validation stays at the API layer; other validators may move into registry hooks or stay API-side (plan decides) | `internal/tmux` imports `internal/settings` (tmux.go:19) — a registry-side `tmux.ValidBoardName` call is an import cycle; internal detail, easily revised | S:55 R:85 A:85 D:60 |
| 11 | Confident | `auto_name`, `tmux_conf`, `log_level` become readable/settable through the new endpoints (they are registry keys); no restart-badging or live-apply plumbing here | Registry-driven API covers the whole registry by construction; live/badge UX is explicitly Phase 3 | S:65 R:85 A:80 D:70 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
