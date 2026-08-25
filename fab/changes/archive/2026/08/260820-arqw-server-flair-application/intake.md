# Intake: Server Flair Application

**Change**: 260820-arqw-server-flair-application
**Created**: 2026-08-20

## Origin

Drafted via `/fab-draft` from the flair design session that produced PR #659 (`260819-lrm8-universal-flair-catalogue-refresh`, merged). That change shipped the single universal flair vocabulary and box-agnostic treatments — but only on the surfaces main already had (window rows, session rows). The user then observed: **you cannot apply a flair to a server at all** — no storage, no endpoint, no picker slot, no rendering on the SESSIONS group-header row or the SERVER panel tile. Every server-facing flair piece lives only in draft PR #606 (`260814-p8sw-more-flairs-server-tiles`), which is now stale (two-class vocabulary, obsolete sprites, stacked on #605). This change reconstructs the server flair surface from #606 onto the post-#659 vocabulary; #606 is then obsolete end-to-end and should be closed with a pointer to #659 + this change.

Reference source: the local git ref `pr-606-view` (fetched from `pull/606/head`; re-fetch with `git fetch origin pull/606/head:pr-606-view` if absent). All decisions below were made in the design session — do not reopen them.

## Why

1. **Pain point**: the flair catalogue (12 named states + ∅ after #659 and the rain/scan addition) applies to windows and sessions but not servers — the largest visual unit in the sidebar carries no flair, and the tile designs refined in the design session (invaders/cube/warp are box-agnostic precisely so tiles could mount them) have nothing to mount on.
2. **Consequence of not fixing**: server flair stays stranded in draft PR #606, which cannot merge (its vocabulary split and tile-only sprites were explicitly rejected and now conflict with main).
3. **Why this approach**: #606 already solved the storage/endpoint/render plumbing — reconstruct exactly those four pieces onto today's main, where the universal vocabulary makes them small: no `ValidateServerFlairValue`, no tile-only CSS, no picker cell-set split (all obsolete). Same pattern that worked for #659 (port from `pr-606-view` as reference).

## What Changes

### 1. Storage — settings-backed per-server flair (from #606, unchanged design)

Server flair persists in `~/.rk/settings.yaml` via `internal/settings` — NOT a tmux user option (a server-scoped tmux option dies with the tmux server; settings survive, matching #606's design). Port from `pr-606-view:app/backend/internal/settings/settings.go`:

- `Settings.ServerFlairs map[string]string` (server name → flair token) + the hand-rolled YAML parse/serialize for the map section (the file uses a dependency-free parser — follow its existing style on current main, which may have drifted from the ref).
- `GetServerFlair(server)` / `SetServerFlair(server, *flair)` (nil/empty clears the entry) — mirror `pr-606-view`'s functions and their load-then-merge semantics.

### 2. Write/read seam — `/api/settings/server-flair` (from #606, minus the split validator)

Port from `pr-606-view:app/backend/api/settings.go:221-280` and `router.go:713-714`:

- `GET /api/settings/server-flair` — no query param: the full `{flairs: {server: token}}` map; `?server=` : that server's `{flair}`.
- `POST /api/settings/server-flair` — body `{server, flair}` (uniform POST verb per constitution IX; `flair: null`/`""` clears). Validate with the EXISTING `validate.ValidateFlairValue` — #606's `ValidateServerFlairValue` split is obsolete and MUST NOT be recreated (single universal set).
- Server-name validation as on the ref (it is a path/label input — reuse whatever `validate` helper the current settings handlers use for server names).

### 3. Rendering — group header + SERVER tile mount `FlairOverlay`

Both mounts use the shared `FlairOverlay` component from #659 (`app/frontend/src/components/flair-overlay.tsx`) — it already owns the cube/warp child markup, the tint custom property, and the uniform drag-source hide:

- **SESSIONS group-header row** (the per-server group header in `app/frontend/src/components/sidebar/index.tsx`, ~:2038 "Per-server group") — mount `FlairOverlay` on the header row, same overlay discipline as window/session rows (`pr-606-view:index.tsx:2381-2385` shows the mount point on the ref, but use `FlairOverlay`, not the ref's bare span).
- **SERVER panel tile** (`app/frontend/src/components/sidebar/server-panel.tsx`) — mount inside the tile box, hidden while the tile is the drag source (`FlairOverlay`'s guard; the ref's `isDragSource` prop shows the wiring).
- Tint: pass the server's guarded border color where the row mounts pass theirs, so `rain`/`scan` tint correctly on both surfaces.

### 4. Frontend state — the serverFlairs map (from #606's optimistic pattern)

Settings mutations emit NO tmux control-mode event (the row-color safety-poll lesson), so the sidebar cannot derive flair from SSE. Port #606's pattern (`pr-606-view:index.tsx:219, :1481, :1523, :1606`):

- `client.ts`: `getAllServerFlairs()` (GET, deduplicated fetch) + `setServerFlair(server, flair)` (POST) — see `pr-606-view:client.ts:903-916` and its tests.
- Sidebar `index.tsx`: a `serverFlairs: Record<string, string>` state, fetched on mount, **optimistically updated** on every set/clear (the same funnel shape as the x4sf server-color optimistic seam at ~:1565 and ~:2134 — follow that current-main pattern rather than the ref's older one), threaded to the group header and `ServerPanel`.

### 5. Picker — the server color picker gains the flair band

The server-group color picker (opened from the group header / SERVER tile; the `x4sf` shared handler) currently passes no `onSelectFlair`. Wire `selectedFlair` + `onSelectFlair` through at the server call sites so `SwatchPopover` renders its existing flair band (post-#668 banded layout — 2-row column-flow strip; NO picker-component changes expected, the band renders whenever the callback is supplied). Selection calls the POST seam and the optimistic map update; `""` clears.

### 6. Tests

- **Go**: settings round-trip (set/get/clear, YAML persistence — mirror `pr-606-view:settings_test.go` and `api/settings_test.go:228+` TestSetServerFlair_persists etc.), handler accept/reject via `ValidateFlairValue` (any universal token accepted incl. `rain`/`cube`; unknown rejected), GET map + `?server=` forms.
- **Frontend**: client.ts GET/POST tests (mirror `pr-606-view:client.test.ts:646-676`); sidebar tests — group header + tile mount `FlairOverlay` for a flaired server, drag-source hide on the tile, picker flair band present at server call sites and selection funnels to the POST + optimistic update.
- **No new Playwright specs** expected (decoration-only; no route change) — no `.spec.md` obligations.

### Constraints (binding)

- Uniform HTTP verb: mutation is POST (constitution IX).
- Settings file remains the only persistence; no tmux options, no new derive paths (constitution II carve-out already covers `~/.rk/settings.yaml` as the existing settings store — this extends a map in it, not a new store).
- Single universal vocabulary: consume `FLAIR_STATES`/`validate.FlairValues` generically — do NOT enumerate flair names in new code or introduce any server-specific subset.
- `FlairOverlay` is the only mount — no bare flair spans.
- Layout snapshots (`internal/snapshot`) deliberately do NOT capture server flair (settings are not tmux state; nothing to restore) — if the ref's snapshot diffs touch flair, ignore them (they belonged to its session-flair work, which #659's base already has).

### Explicitly out of scope

- Any change to the flair vocabulary, sprites, or CSS treatments (all shipped in #659 and follow-ups).
- Tile-only/two-class vocabulary or `ValidateServerFlairValue` (rejected; do not recreate).
- Board tiles, host page, or any surface beyond the two sidebar mounts.
- Closing/rescoping PR #606 itself (do it manually after this merges — leave a note in the PR body pointing at #659 + this change).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) § Character Flair Overlays — server flair joins the mount list (group header + SERVER tile via FlairOverlay); the "server group headers carry NO flair" line inverts.
- `run-kit/ui/sidebar`: (modify) § Row Flair — the mount table gains the two server surfaces; picker entry points gain the server picker.
- `run-kit/architecture`: (modify) settings surface — the `ServerFlairs` map + `/api/settings/server-flair` endpoints join the settings API inventory.
- `run-kit/tmux-sessions`: (modify) — the `@rk_session_flair` row's "Flair stops at the session tier — server rows carry none" note updates to point at the settings-backed server tier.

## Impact

- `app/backend/internal/settings/settings.go` (+ test) — ServerFlairs map, Get/Set, YAML round-trip.
- `app/backend/api/settings.go`, `router.go` (+ tests) — GET/POST endpoints.
- `app/frontend/src/api/client.ts` (+ test) — two API functions.
- `app/frontend/src/components/sidebar/index.tsx` — serverFlairs state + optimistic funnel + group-header mount + picker wiring.
- `app/frontend/src/components/sidebar/server-panel.tsx` — tile mount + picker wiring.
- Sidebar tests (`index.test.tsx`, `server-panel.test.tsx`).
- No CSS changes, no vocabulary changes, no new components.

## Open Questions

- (none — every decision is grounded in the design session or the #606 reference implementation)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Storage is settings-backed (`~/.rk/settings.yaml` `ServerFlairs` map), not a tmux option | #606's shipped design, verified on `pr-606-view`; tmux server-scoped state dies with the server | S:90 R:85 A:90 D:90 |
| 2 | Certain | Endpoints are `GET`/`POST /api/settings/server-flair` with `{server, flair}` body; validation via the existing `ValidateFlairValue` only | Ported shape verified on the ref; the split validator was explicitly rejected with the two-class vocabulary | S:90 R:85 A:90 D:95 |
| 3 | Certain | Both server mounts (group header + tile) render via the shared `FlairOverlay`, tile hidden while drag-sourced | FlairOverlay is #659's single-mount rule; the ref's isDragSource wiring shows the tile guard | S:85 R:90 A:90 D:90 |
| 4 | Confident | Frontend state is a mount-fetched `serverFlairs` map with optimistic updates through the current x4sf-style funnel (no SSE derivation) | Settings mutations emit no control-mode event (row-color lesson); #606 used exactly this pattern — but the funnel code has moved since the ref, so apply follows current main's shape | S:65 R:85 A:80 D:75 |
| 5 | Confident | Picker needs NO SwatchPopover changes — supplying `onSelectFlair` at the server call sites renders the post-#668 flair band as-is | The band is callback-gated per the component's props docs; verified in the post-#668 source, but the server call sites' exact plumbing is apply-time work | S:65 R:90 A:85 D:75 |
| 6 | Certain | Snapshots do not capture server flair | Settings are not tmux state; nothing to restore on a server rebirth by name is still keyed by server name in settings — no snapshot involvement | S:80 R:90 A:90 D:85 |
| 7 | Certain | Out of scope: vocabulary/CSS changes, two-class machinery, non-sidebar surfaces, #606 closure mechanics | Design session exclusions; #606 closure is a manual follow-up | S:90 R:90 A:95 D:95 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
