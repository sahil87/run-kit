# Plan: UI State Backend — tmux Options, Payload, Snapshot, Migration

**Change**: 260828-fykg-ui-state-backend-tmux-options
**Intake**: `intake.md`

## Requirements

### tmux: Option constants and read path

#### R1: New window-option constants; old exported names retired
`internal/tmux` MUST export `LayoutOption = "@rk_win_layout"`, `MaxWebTabs = 8`, `WebTabOption(n int) string` → `"@rk_win_web_<n>"`, `WebTabRootOption(n int) string` → `"@rk_win_web_<n>_root"`, `WebActiveOption = "@rk_win_web_active"`, `CodeRootOption = "@rk_win_code_root"`. The exported `URLOption`, `PresentRootOption`, `LensOption` MUST be removed; their string values survive only as unexported `legacyWinURLOption`, `legacyWinPresentRootOption`, `legacyWinLensOption` used by the migration table and the compat shim. `WebTabOption`/`WebTabRootOption` MUST panic when `n` is outside `1..MaxWebTabs` (programming contract; callers validate user input first).

- **GIVEN** the package compiles
- **WHEN** `go build ./...` runs over `app/backend`
- **THEN** no reference to `tmux.URLOption`, `tmux.PresentRootOption`, or `tmux.LensOption` remains outside `internal/tmux`

#### R2: `ListWindows` reads the new family; `WindowInfo` carries dense web tabs
The `ListWindows` format string MUST replace the `@rk_win_lens`, `@rk_win_url`, legacy-lens and legacy-url fields with `@rk_win_layout`, `@rk_win_web_1..8`, `@rk_win_web_active`, `@rk_win_code_root`, keeping `@rk_win_note` as a strict single field and the legacy note LAST (tail rejoined). `parseWindows` MUST populate `Layout string`, `WebTabs []string` (dense: walk slots 1..8, stop at the first empty), `WebActive int` (1-based; clamped to 1 when tabs exist and the stored value is non-numeric/out of range; 0 when no tabs), `CodeRoot string`. `RkType`/`RkUrl` MUST be removed from `WindowInfo`. The field-count doc comment MUST be rewritten to the new layout.

- **GIVEN** a list-windows line carrying `web_1=/proxy/3000/`, `web_2=` (empty), `web_3=https://x/`, `web_active=3`
- **WHEN** `parseWindows` runs
- **THEN** `WebTabs == ["/proxy/3000/"]` and `WebActive == 1` (gap truncates; active clamps)

- **GIVEN** a line with no web slots set and `web_active=2`
- **WHEN** parsed
- **THEN** `WebTabs` is empty and `WebActive == 0`

#### R3: Compat read shim — derived `rkUrl`/`rkType` on the Window JSON
The API-facing `Window` struct (`tmux.go` ~`:698`) MUST replace stored `RkType`/`RkUrl` with the four new JSON fields `layout`, `webTabs`, `webActive`, `codeRoot`, AND MUST keep emitting `rkUrl` and `rkType` as **derived** values for one release: `rkUrl = WebTabs[WebActive-1]` when tabs exist (else omitted); `rkType = "iframe"` when `layoutspec.Parse(Layout)` succeeds and its order contains `web` (else omitted). Derivation happens where the `Window` is built from `WindowInfo` (one place), marked `// compat: removed by the frontend layout change (ui-state plan Change 2)`.

- **GIVEN** a window with `layout=single:web`, `web_1=/proxy/3000/`, `web_active=1`
- **WHEN** it is serialized for SSE or `/ws/state`
- **THEN** the JSON carries `layout`, `webTabs:["/proxy/3000/"]`, `webActive:1`, AND `rkUrl:"/proxy/3000/"`, `rkType:"iframe"`

### tmux: Web-tab family operations

#### R4: `WebAdd` — idempotent append with cap and `?v=` refresh
`internal/tmux/webtabs.go` MUST provide `WebAdd(ctx, windowID, server, url, root string) (index int, existed bool, err error)`: read the current family in one tmux call; if `url` equals a stored slot → return `(n, true)` and, when `url` starts with `/present/`, rewrite that slot with `present.BumpVersion(url, now)` (fresh `?v=`); else if `len == MaxWebTabs` → `ErrWebTabsFull`; else write slot `len+1` (plus `WebTabRootOption(len+1)` when `root != ""`, or unset it when `root == ""`) and set `WebActiveOption = 1` only when the family was empty before. All writes go through one chained `SetWindowOptions` call.

- **GIVEN** an empty family
- **WHEN** `WebAdd(url="/proxy/3000/", root="")`
- **THEN** returns `(1,false)`; `web_1` set, `web_active=1`

- **GIVEN** `web_1..web_8` set
- **WHEN** `WebAdd` with a new URL
- **THEN** returns `ErrWebTabsFull` and issues no set

- **GIVEN** `web_2=/present/@5/2/a.html?server=s&v=100`
- **WHEN** `WebAdd` with the same URL and a later `now`
- **THEN** returns `(2,true)` and `web_2`'s `v=` differs; `_active` unchanged

#### R5: `WebRemove` — dense renumbering of URL and root, `_active` repoint
`WebRemove(ctx, windowID, server, n)` MUST shift slots `n+1..len` down by one (URL and root together), unset the former last slot and its root, and repoint `_active`: `active == n → min(n, newLen)`; `active > n → active-1`; `active < n → unchanged`; `newLen == 0 → unset`. `n` outside `1..len` → `ErrWebTabRange`. Pure helpers `shiftWebTabs(tabs, roots []string, n int) ([]string, []string)` and `repointActive(active, n, newLen int) int` MUST exist for table tests.

- **GIVEN** 3 tabs with roots on 1 and 3, `_active=3`
- **WHEN** `WebRemove(2)`
- **THEN** slot 2 holds former slot 3's URL and root, slot 3 and its root are unset, `_active=2`

#### R6: `WebSelect` bounds
`WebSelect(ctx, windowID, server, n)` MUST set `_active=n` when `1 ≤ n ≤ len`, else `ErrWebTabRange`.

- **GIVEN** 2 tabs
- **WHEN** `WebSelect(3)`
- **THEN** `ErrWebTabRange`, no write

### layoutspec: Layout grammar

#### R7: Pure Go port of `parseLayout`
New package `internal/layoutspec` MUST expose `Parse(raw string) (Layout, error)` and `(Layout) String() string` mirroring `app/frontend/src/lib/surface-layout.ts` `parseLayout`/`serializeLayout`: shapes `single, split-h, split-v, row, col, main-left, main-right, main-top` with arities `1,2,2,3,3,3,3,3`; surfaces `tty, web, chat, code`; order length must equal arity; no repeated surface except `tty`. `Layout{Shape string; Order []string}` plus `Has(surface string) bool`.

- **GIVEN** `"main-left:tty,code,web"` → parses; `"row:tty,tty,web"` → parses; `"split-h:web,web"` → error; `"single:tty,web"` → error; `"grid:tty"` → error; `"single:desktop"` → error

### api: `/options` allowlist, validation, compat write shim

#### R8: Allowlist and per-key validation
`api/windows.go` MUST accept keys `@rk_win_layout`, `@rk_win_web_1..8` (via a `webTabIndex(key) (int, bool)` matcher), `@rk_win_web_active`, `@rk_win_code_root` in addition to the existing color/marker/role/flair/note keys, and MUST reject `@rk_win_web_9`/unknown keys with 400. Validation: `_layout` must `layoutspec.Parse` (empty/`null` → unset); `_web_n` must pass new `validate.ValidateWebTabURL` (root-relative starting `/proxy/` or `/present/`, or absolute http(s) with host) and `n ≤ len+1` (gap → 400); `null` on `_web_n` routes through `WebRemove(n)`; `_web_active` integer in `1..len` (null only when no tabs); `_code_root` via `validate.ValidatePath` + `ExpandTilde`. `validate.ValidateRkURLValue` MUST be deleted. Validate-all-then-execute is preserved; the hub wake after success is preserved.

- **GIVEN** `{"@rk_win_layout":"split-h:web,web"}` → 400, zero tmux calls
- **GIVEN** 1 tab and `{"@rk_win_web_3":"/proxy/1/"}` → 400 "gap"
- **GIVEN** 2 tabs and `{"@rk_win_web_active":"3"}` → 400
- **GIVEN** `{"@rk_win_web_1":"javascript:alert(1)"}` → 400

#### R9: Compat write shim for `@rk_win_url` / `@rk_win_lens`
`/options` MUST keep accepting the keys `@rk_win_url` and `@rk_win_lens` for one release, translated by `translateLegacyOptionKeys` before validation: `@rk_win_url: u` → `WebTabOption(active or 1) = u` (sets `_active=1` when the family was empty); `@rk_win_url: null` → `WebRemove(active)`; `@rk_win_lens: "iframe"` → `@rk_win_layout = "single:web"` only if `_layout` is currently unset; any other `_lens` value or `null` → no-op. The function carries `// compat: removed in the cleanup change (ui-state plan Change 5)`.

- **GIVEN** an empty family and `{"@rk_win_url":"/proxy/3000/"}` → `web_1` set, `_active=1`, 200
- **GIVEN** `_layout` already `row:tty,code,web` and `{"@rk_win_lens":"iframe"}` → layout untouched, 200

#### R10: `POST /api/sessions/{session}/windows` retarget
When body `rkType == "iframe"`, the handler MUST create the window with `@rk_win_layout=single:web`, `@rk_win_web_1=<rkUrl>` (validated by `ValidateWebTabURL`), `@rk_win_web_active=1` in the single chained `CreateWindowWithOptions` call. Body field names stay `rkType`/`rkUrl` this release. The name-required rule stays.

- **GIVEN** `{"name":"web","rkType":"iframe","rkUrl":"/proxy/3000/"}`
- **WHEN** posted
- **THEN** the new window carries the three options; no `@rk_win_lens`/`@rk_win_url` is written

### api: Verb routes and indexed present route

#### R11: Web verb routes (POST only)
The router MUST register `POST /api/windows/{windowId}/web` (body `{"target"}` → `201 {"index","existed","url"}`; `409` on `ErrWebTabsFull`; `400` on parse/validation), `POST /api/windows/{windowId}/web/{n}/remove` (`200 {"ok":true}`; `400` range), `POST /api/windows/{windowId}/web/{n}/select` (same). `{n}` is gated `^[1-8]$` before any tmux call; `{windowId}` via `parseWindowID`; `?server=` via `serverFromRequest`; each wakes the hub on success. `target` resolves through `present.ParseTarget(target, cwd)` with `cwd` = the window's first pane path (`ListWindows` `WorktreePath`); port/local-URL kinds run `present.ProbePort` best-effort (log, not fatal); file/dir kinds pass `target.Root` as the slot root; the stored URL is `target.URL(windowID, n, server, now)` where `n` is the slot the add lands in (for an idempotent hit `WebAdd` handles the bump).

- **GIVEN** an empty family and `{"target":":3000"}` → 201 `{"index":1,"existed":false,"url":"/proxy/3000/"}`
- **GIVEN** 8 tabs → 409
- **GIVEN** `/web/9/select` → 400

#### R12: Indexed `/present/{windowId}/{n}/*` with n-less compat
`api/present.go` MUST serve `/present/{windowId}/{n}/*` (and `/present/{windowId}/{n}` → 308 to trailing slash) reading `tmux.WebTabRootOption(n)` at request time, `n` gated `^[1-8]$`. The n-less forms `/present/{windowId}/*` and `/present/{windowId}` MUST stay registered and map to `n=1` for one release. One handler MUST sniff whether the first segment after `{windowId}` matches `^[1-8]$` to avoid chi ordering ambiguity. Containment logic is unchanged.

- **GIVEN** `_2_root=/tmp/a` and request `/present/@1/2/x.html` → served from `/tmp/a/x.html`
- **GIVEN** `_1_root=/tmp/b` and request `/present/@1/x.html` → served from `/tmp/b/x.html`
- **GIVEN** `/present/@1/9/x.html` → 400 (or 404 — MUST NOT read a root outside 1..8)

### present: Indexed URL + version bump

#### R13: `PresentURL`/`Target.URL` take a slot index; `BumpVersion` added
`internal/present.PresentURL(windowID string, n int, name, server string, now func() int64)` MUST produce `/present/<windowID>/<n>/<name>?server=<s>&v=<now>`; `Target.URL(windowID string, n int, server string, now)` MUST pass `n` through for file/dir kinds and ignore it otherwise. `BumpVersion(url string, now func() int64) string` MUST rewrite the `v` query value of a `/present/` URL and return other URLs verbatim.

- **GIVEN** `PresentURL("@3", 2, "a.html", "s", 100)` → `/present/@3/2/a.html?server=s&v=100`
- **GIVEN** `BumpVersion("/present/@3/2/a.html?server=s&v=100", 200)` → `...&v=200`; `BumpVersion("/proxy/3000/", 200)` → `/proxy/3000/`

### snapshot: Round-trip

#### R14: Snapshot capture and restore of the family
`internal/tmux/layout.go`'s capture format MUST replace lens/url (+ legacy twins) with `@rk_win_layout`, `@rk_win_web_1..8`, `@rk_win_web_1_root..8_root`, `@rk_win_web_active`, `@rk_win_code_root` (note stays last, tail rejoined); `LayoutWindow` gains `RkLayout string`, `WebTabs []string`, `WebRoots []string`, `WebActive int`, `CodeRoot string` (field name `RkLayout` because `Layout` is already the tmux pane-layout string). `snapshot.Window` MUST replace `RkType`/`RkURL` with `RkLayout string \`json:"rkLayout,omitempty"\``, `WebTabs []string \`json:"webTabs,omitempty"\``, `WebRoots []string \`json:"webRoots,omitempty"\``, `WebActive int \`json:"webActive,omitempty"\``, `CodeRoot string \`json:"codeRoot,omitempty"\``. `windowOptionOps` MUST emit the family through the existing skip-when-empty `add` helper (`_active` only when > 0). An old snapshot JSON containing `rkType`/`rkUrl` keys MUST decode and restore without error (unknown keys ignored). `/present/` URLs are restored verbatim (parity with today's `rkUrl` handling — no `@N` rewrite).

- **GIVEN** a captured window with 3 tabs, roots on 1 and 3, `_active=2`, `layout=split-h:tty,web`, `code_root=/w`
- **WHEN** restored onto a fresh server
- **THEN** the new window carries the identical dense family, roots, `_active=2`, layout, and code root

### tmux: Legacy migration rows

#### R15: Migration table rows with value transform and side effect
`legacy_options.go` MUST gain window-scope rows, appended AFTER the existing `@rk_url→@rk_win_url`, `@rk_present_root→@rk_win_present_root`, `@rk_type→@rk_win_lens` rows: `@rk_win_present_root → @rk_win_web_1_root`; `@rk_win_lens → @rk_win_layout` with `Transform: "iframe" → "single:web"` (any other value → no copy) and copy only when New is unset. The `legacyOption` struct MUST gain optional `Transform func(string) (string, bool)` and `After`-shaped (or equivalently narrow) fields consumed by `moveLegacyAt`; Old is unset in every case (not CopyOnly). Idempotent: a second sweep issues zero set-option calls. **`@rk_win_url` is NOT swept** — see the design deviation below (it dual-reads instead).

- **GIVEN** a window with `@rk_win_present_root=/tmp`, `@rk_win_lens=iframe`, no `_layout`
- **WHEN** `MigrateLegacyOptions` runs
- **THEN** `web_1_root=/tmp`, `layout=single:web`; the two legacy names are gone; a second run changes nothing

- **GIVEN** `@rk_win_lens=iframe` and `_layout=row:tty,code,web`
- **WHEN** migrated
- **THEN** `_layout` unchanged, `_lens` unset

### cmd/rk: `rk present` minimal re-point

#### R16: `rk present` writes through the new family
`cmd/rk/present.go` MUST replace its `URLOption`/`PresentRootOption` batch with `tmux.WebAdd` (root `""` for non-file/dir kinds) in the default arm, and `LensOption=iframe` with `LayoutOption=single:web` in the `--window` arm (URL/root following via `WebAdd` on the new window id). Printed URL, `--notify`, exit codes, and help text are unchanged; the doc comment naming the written options is updated. The test seams (`presentSetWindowOptionsFn` etc.) MAY be reshaped to a `presentWebAddFn` seam; `present_test.go` assertions on printed URL/notify remain.

- **GIVEN** `rk present :3000` inside a tmux pane with an empty family
- **WHEN** run
- **THEN** `web_1=/proxy/3000/`, `_active=1`, stdout prints `/proxy/3000/`

### Non-Goals

- Frontend consumption of `layout`/`webTabs`/`codeRoot` (Change 2/3) — zero `app/frontend/src` edits.
- `rk tab` verbs, `rk present` as sugar, `rk code exec --tab` (Change 4).
- Removal of the compat shim, n-less `/present/` route, or migration rows (Change 5).
- `desktop`/`agents` surfaces in the layout registry.
- Rewriting `docs/specs/ui-state.md` (human-curated; hydrate proposes the `DELETE`→`POST` amendment).

### Design Decisions

#### `@rk_win_url` dual-reads instead of a migration-sweep row (deviation from intake)
**Decision**: `@rk_win_url` has NO `legacyOptions` sweep row. It is dual-READ in both hot read paths (`parseWindows` field idx 23, `ReadWebTabFamily`): with an empty `web_1` it surfaces as the dense family's first tab with the active pointer defaulted, and `WebRemove` on the last tab also clears the retired name. The `_lens`/`_present_root` rows migrate as planned.
**Why**: The intake's `@rk_win_url → @rk_win_web_1` sweep row breaks the shipped frontend two ways: (1) the migration sweep is once-per-server, so a mid-session `tmux set-option -w @rk_win_url` (the `present-auto-expand` / `web-view-lens` live-flip path the frontend polls via the derived `rkUrl`) is never migrated and goes unread; (2) the read path cannot converge `@rk_url → @rk_win_url → @rk_win_web_1`, so the sweep row unsets the intermediate `@rk_win_url` that `legacy-scope-sweep.spec.ts` asserts holds the value. Dual-read keeps every reader correct without a sweep trigger, and keeps `@rk_url → @rk_win_url` as the terminal convergence. Found during T018 e2e regression (baseline vs branch).
**Rejected**: The intake's sweep row (live-flip writes unread; legacy-scope-sweep red). A recurring SSE-tick sweep (O(windows) churn on the hot path).
*Introduced by*: 260828-fykg-ui-state-backend-tmux-options

#### Compat shim instead of a frontend re-point
**Decision**: The backend derives `rkUrl`/`rkType` at marshal time and translates `@rk_win_url`/`@rk_win_lens` writes onto the new family for one release.
**Why**: Lets the backend contract ship alone with the current frontend and e2e suite green; the shim is two small, clearly marked deletions later.
**Rejected**: Editing the frontend here (splits `surface-layout.ts` work across two PRs); shipping red and stacking with Change 2 (defeats the sequencing goal).
*Introduced by*: 260828-fykg-ui-state-backend-tmux-options

#### POST verbs only
**Decision**: `…/web/{n}/remove` and `…/web/{n}/select` are POST routes.
**Why**: Constitution IX forbids DELETE/PUT/PATCH; CORS allowlist is GET/POST/OPTIONS.
**Rejected**: The plan's `DELETE …/web/{n}`.
*Introduced by*: 260828-fykg-ui-state-backend-tmux-options

#### Layout grammar lives in `internal/layoutspec`
**Decision**: A pure package ports the frontend's `parseLayout`/`serializeLayout`.
**Why**: `api` validation today and `rk tab layout` (Change 4) share one table; a validator inside `api` would be thrown away.
**Rejected**: Regex validation in `api/windows.go`.
*Introduced by*: 260828-fykg-ui-state-backend-tmux-options

#### Density is enforced on every write path
**Decision**: Raw `/options` writes may only replace or append; `null` on a slot routes through `WebRemove`; the read path truncates at the first gap.
**Why**: Indexed addresses (`@N/web/<n>`) are only meaningful when the family is dense; a hand-written gap must degrade, never error.
**Rejected**: Allowing sparse slots and compacting on read (two views of the same state).
*Introduced by*: 260828-fykg-ui-state-backend-tmux-options

### Deprecated Requirements

#### `@rk_win_url` / `@rk_win_present_root` / `@rk_win_lens` as first-class options
**Reason**: Superseded by the indexed `@rk_win_web_<n>` family and `@rk_win_layout`.
**Migration**: `MigrateLegacyOptions` rows (R15); `/options` compat translation (R9) for one release.

## Tasks

### Phase 1: Setup

- [x] T001 Add `LayoutOption`, `MaxWebTabs`, `WebTabOption`, `WebTabRootOption`, `WebActiveOption`, `CodeRootOption` to `app/backend/internal/tmux/tmux.go`; demote `URLOption`/`PresentRootOption`/`LensOption` to unexported `legacyWin*Option` consts beside the existing legacy block; add sentinel errors `ErrWebTabsFull`, `ErrWebTabRange` <!-- R1 -->
- [x] T002 [P] Create `app/backend/internal/layoutspec/layoutspec.go` (`Layout`, `Parse`, `String`, `Has`, shape/arity/surface tables) and `layoutspec_test.go` porting every `parseLayout` case from `app/frontend/src/lib/surface-layout.test.ts` <!-- R7 -->
- [x] T003 [P] In `app/backend/internal/present/present.go` change `PresentURL`/`Target.URL` to take a slot index `n`, add `BumpVersion`; update `present_test.go` <!-- R13 -->

### Phase 2: Core Implementation

- [x] T004 Rewrite the `ListWindows` format string + `parseWindows` in `app/backend/internal/tmux/tmux.go` for the new fields (layout, web_1..8, web_active, code_root; note single-field, legacy note last); replace `RkType`/`RkUrl` on `WindowInfo` and `Window` with `Layout`/`WebTabs`/`WebActive`/`CodeRoot`; implement dense walk + `web_active` clamp; update the field-count comment; fix `tmux_test.go` fixtures and add gap/clamp cases <!-- R2 -->
- [x] T005 Add derived compat `RkUrl`/`RkType` (json `rkUrl`/`rkType`) at the `WindowInfo`→`Window` build site (find it via `grep -n 'RkType' app/backend/internal/sessions app/backend/api`), computed from `WebTabs`/`WebActive` and `layoutspec.Parse(Layout).Has("web")`, with the compat comment; unit test the derivation <!-- R3 -->
- [x] T006 Create `app/backend/internal/tmux/webtabs.go`: family read (one tmux call), `WebAdd`, `WebRemove`, `WebSelect`, pure `shiftWebTabs`/`repointActive`; `webtabs_test.go` on a real test socket (add/idempotent+bump/full, remove-middle renumbers URL+root and repoints active for `<`/`==`/`>`, remove-last unsets active, select bounds) plus table tests for the pure helpers <!-- R4 R5 R6 -->
- [x] T007 In `app/backend/internal/tmux/layout.go` swap the capture format + `LayoutWindow` fields to `RkLayout`/`WebTabs`/`WebRoots`/`WebActive`/`CodeRoot` (roots enumerated), update `parseLayoutWindows` and `layout_test.go` <!-- R14 -->
- [x] T008 In `app/backend/internal/snapshot/snapshot.go` + `restore.go` replace `RkType`/`RkURL` with the new fields; restore emits the family via `add`; extend `snapshot_test.go`/`restore_test.go`/`integration_test.go` with the 3-tab round-trip and an old-format JSON decode case <!-- R14 -->
- [x] T009 Append the `_present_root`/`_lens` migration rows to `legacyOptions` in `app/backend/internal/tmux/legacy_options.go` AFTER the existing `@rk_url`/`@rk_present_root`/`@rk_type` rows; add `Transform`/`After` fields to `legacyOption` and honor them in `moveLegacyAt`; `@rk_win_url` dual-reads (no sweep row) per the Design Decisions deviation; extend `legacy_options_test.go` (family converges, `_lens` with existing `_layout`, doubly-legacy one sweep, second run zero calls). Rework 1: dropped the dead `AfterOption`/`AfterValue` fields + the `moveLegacyAt` after-set branch (no row used them) <!-- R15 -->
- [x] T010 Add `validate.ValidateWebTabURL` to `app/backend/internal/validate/validate.go` (+ tests), delete `ValidateRkURLValue` and its tests <!-- R8 -->
- [x] T011 Rewrite the allowlist, `validateWindowOption`, and `handleWindowOptions` in `app/backend/api/windows.go`: new keys via `webTabIndex`, layout/web/active/code_root validation reading the current family once, `null` slot → `WebRemove`, `translateLegacyOptionKeys` compat shim, hub-wake comment updated <!-- R8 R9 -->
- [x] T012 Retarget the `rkType == "iframe"` arm of `handleWindowCreate` in `app/backend/api/windows.go` to `layout=single:web` + `web_1` + `web_active=1` <!-- R10 -->
- [x] T013 Add `handleWindowWebAdd`, `handleWindowWebRemove`, `handleWindowWebSelect` (new file `app/backend/api/windows_web.go`) and register the three POST routes in `app/backend/api/router.go`; `target` via `present.ParseTarget` with the window's first-pane cwd, best-effort `ProbePort`, hub wake <!-- R11 -->
- [x] T014 Rework `app/backend/api/present.go` to the indexed route with n-less compat (single handler sniffing `^[1-8]$`), reading `tmux.WebTabRootOption(n)`; update `router.go` registrations and `present_test.go` <!-- R12 -->
- [x] T015 Re-point `app/backend/cmd/rk/present.go` (default arm → `tmux.WebAdd`; `--window` arm → `LayoutOption=single:web` + `WebAdd`); reshape test seams and update `cmd/rk/present_test.go`. Rework 1: both arms now write through `tmux.WebAdd` (default arm reads the family and appends at len+1; `--window` creates with the layout then WebAdds on the empty family); seams reshaped to `presentWebAddFn`/`presentReadFamilyFn`; tests assert the WebAdd contract (empty family → slot 1, non-empty → dense append, printed URL/notify unchanged) <!-- R16 -->

### Phase 3: Integration & Edge Cases

- [x] T016 Extend `app/backend/api/windows_test.go`: allowlist matrix (`web_9` rejected, `@rk_win_url` compat translated, `_lens=iframe` only-when-unset), validation matrix (bad shape, repeated web, active out of range, gap write, non-proxy relative, `javascript:`), create-window retarget, verb routes 201/409/400 + hub wake <!-- R8 R9 R10 R11 -->
- [x] T017 Run `cd app/backend && go build ./... && go vet ./... && go test ./...`; confirm zero references to the retired exported constants; fix any fallout <!-- R1 -->
- [x] T018 Frontend regression without source edits: `just test-frontend`, then `just test-e2e "web-view-lens"`, `just test-e2e "present-auto-expand"`, `just test-e2e "right-panel"`, `just test-e2e "surface-layout"`, `just test-e2e "web-tile-chrome"`, `just test-e2e "legacy-scope-sweep"` — baseline `web-view-lens.spec.ts` :138/:295/:335 against clean `origin/main` first (pre-existing timeouts); any NEW failure is a shim bug <!-- R3 R9 -->

### Phase 4: Polish

- [x] T019 Sweep Go doc comments that still name `@rk_win_url`/`@rk_win_lens`/`@rk_win_present_root` as live options (tmux.go, windows.go hub-wake comment, present.go header, snapshot) so comments state current constraints only; run `gofmt -l app/backend`. Rework 1: also updated the agent-facing skill docs (`docs/site/skill.md`, `docs/site/skill/display.md` + synced embeds) to teach `@rk_win_layout`/`@rk_win_web_<n>`(+`_root`,`_active`), retired names noted as compat-only <!-- R1 -->

## Execution Order

- T001 blocks everything in Phase 2; T002 and T003 are independent of each other and of T001
- T004 blocks T005, T007 (shared struct shape)
- T006 blocks T011, T013, T015 (they call the family ops); T003 blocks T006 (BumpVersion) and T013/T015 (indexed URL)
- T010 blocks T011, T012
- T007 blocks T008
- T016 after T011–T014; T017 after all code tasks; T018 after T017

## Acceptance

### Functional Completeness

- [x] A-001 R1: New constants exported; `go build ./...` finds no `tmux.URLOption`/`PresentRootOption`/`LensOption` outside `internal/tmux`
- [x] A-002 R2: `parseWindows` yields dense `WebTabs`, clamped `WebActive`, `Layout`, `CodeRoot`; `RkType`/`RkUrl` gone from `WindowInfo`
- [x] A-003 R3: Window JSON carries `layout`/`webTabs`/`webActive`/`codeRoot` AND derived `rkUrl`/`rkType`
- [x] A-004 R4: `WebAdd` idempotent, capped at 8, bumps `?v=` for `/present/`, sets `_active=1` only on first tab
- [x] A-005 R5: `WebRemove` renumbers URL+root and repoints `_active` per the three relations
- [x] A-006 R6: `WebSelect` rejects out-of-range
- [x] A-007 R7: `layoutspec.Parse` matches `parseLayout` case-for-case
- [x] A-008 R8: Allowlist + validation matrix behaves as specified; `ValidateRkURLValue` deleted
- [x] A-009 R9: `@rk_win_url`/`@rk_win_lens` writes translate onto the family
- [x] A-010 R10: iframe window creation writes layout+web_1+active
- [x] A-011 R11: Three POST verb routes registered and behaving (201/409/400, hub wake)
- [x] A-012 R12: Indexed `/present/` route serves from `_<n>_root`; n-less maps to slot 1
- [x] A-013 R13: `PresentURL`/`Target.URL` indexed; `BumpVersion` correct
- [x] A-014 R14: Snapshot 3-tab round-trip identical; old-format JSON restores
- [x] A-015 R15: Migration converges in one sweep; second sweep zero calls
- [x] A-016 R16: `rk present` writes through `WebAdd`/`LayoutOption`; printed URL/notify unchanged — rework 1 verified by re-review: `presentAttach` reads the family via `presentReadFamilyFn` and attaches via `presentWebAddFn` (WebAdd owns dense append, `_active=1` on empty family, `?v=` refresh); `presentViaNewWindow` creates with `LayoutOption=single:web` then WebAdds on the new window's empty family; seams reshaped to `presentWebAddFn`/`presentReadFamilyFn`; `cmd/rk/present_test.go` asserts the WebAdd contract

### Behavioral Correctness

- [x] A-017 R2: A hand-written gap (`web_1`, empty `web_2`, `web_3`) reads as one tab, never errors
- [x] A-018 R9: `@rk_win_lens=iframe` never overwrites an existing `_layout`

### Removal Verification

- [x] A-019 R1: No production code writes `@rk_win_url`, `@rk_win_present_root`, or `@rk_win_lens` (only the migration table and the `/options` compat translator reference the names)

### Scenario Coverage

- [x] A-020 R5: Test exists for remove-middle with roots on both neighbours and `_active` on the last tab
- [x] A-021 R15: Test exists for the doubly-legacy (`@rk_url` + `@rk_type=iframe`) one-sweep convergence
- [x] A-022 R3: `just test-frontend` and the six named e2e specs pass with zero frontend source edits (modulo the pre-existing `web-view-lens` timeouts verified on `origin/main`) — `just test-frontend` re-run by review: 3540/3540 pass; e2e NOT re-run by review (per dispatch prompt; apply ran T018)

### Edge Cases & Error Handling

- [x] A-023 R11: 9th `POST …/web` returns 409 with no tmux write
- [x] A-024 R8: Any invalid key/value in a `/options` batch yields 400 with zero tmux calls
- [x] A-025 R12: `/present/@1/9/x` never reads a root option

### Code Quality

- [x] A-026 Pattern consistency: New code follows `internal/tmux` naming, `exec.CommandContext`-via-`tmuxExecServer`, and `WindowOptionOp` chaining
- [x] A-027 No unnecessary duplication: family read/shift/repoint live once in `webtabs.go`; layout grammar once in `layoutspec`
- [x] A-028 Tests cover added/changed behavior (Go tests alongside; no frontend edits needed)
- [x] A-029 No god functions: `handleWindowOptions` stays readable — translation, validation, and execution are separated
- [x] A-030 Comments state constraints, not narration; no change-ids in code comments except the two marked compat deletions

### Security

- [x] A-031 R8: `ValidateWebTabURL` rejects `javascript:`/`data:`/`//host` forms; `_code_root` passes `ValidatePath`
- [x] A-032 R11 R12: `{n}` and `{windowId}` are pattern-gated before any subprocess

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None new in the rework-1 delta — the two candidates the first review surfaced were both resolved: the dead `AfterOption`/`AfterValue` plumbing in `app/backend/internal/tmux/legacy_options.go` is deleted (grep confirms zero references), and the agent-facing skill docs (`docs/site/skill.md`, `docs/site/skill/display.md` + the synced embeds under `app/backend/cmd/rk/skill/`) now teach `@rk_win_layout`/`@rk_win_web_<n>`(+`_root`,`_active`) with the retired names noted as compat-only.
- Frontend compat surface (deferred by design, not this change's cleanup): derived `rkUrl`/`rkType` on the Window JSON (`internal/sessions/sessions.go:563-575`), the `/options` legacy-key translator (`api/windows.go:424-460`), the n-less `/present/{windowId}/*` compat arm (`api/present.go`), and the `@rk_win_url` dual-read fields in both read paths — all marked `// compat:` for removal by ui-state plan Changes 2/5.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Snapshot/LayoutWindow field for the rk layout option is `RkLayout` (`json:"rkLayout"`) because `Layout` already holds the tmux pane layout string | Name collision in both structs; intake assumed `Layout` | S:70 R:90 A:90 D:85 |
| 2 | Confident | `/present/@1/9/…` may return 400 or 404 — either is acceptable so long as no root is read | Existing handler maps everything to 404; a 400 is equally safe | S:60 R:95 A:85 D:75 |
| 3 | Confident | Verb-route add response includes the stored `url` alongside `index`/`existed` | Cheap and lets Change 3's strip render without a re-tick | S:55 R:95 A:85 D:80 |
| 4 | Confident | New verb handlers live in a new file `api/windows_web.go` rather than growing `windows.go` | `windows.go` is already ~600 lines; sibling-file convention exists (`sortwindows.go`) | S:60 R:95 A:85 D:85 |

4 assumptions (0 certain, 4 confident, 0 tentative).
