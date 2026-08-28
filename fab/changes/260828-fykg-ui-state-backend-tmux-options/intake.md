# Intake: UI State Backend — tmux Options, Payload, Snapshot, Migration

**Change**: 260828-fykg-ui-state-backend-tmux-options
**Created**: 2026-08-28

## Origin

One-shot `/fab-new` invocation, scoped to a single section of a pre-written plan:

> Change 1 from fab/plans/sahil/26-08-28-ui-state-tmux-options.md -- Backend: options, payload, snapshot, migration for UI state in tmux options (@rk_win_layout, web tabs, code root). Implement exactly the Change 1 section of that plan file; do not implement Changes 2-5.

Source documents (read in full at intake; the plan section is reproduced below so the apply agent needs neither):

- Plan: `fab/plans/sahil/26-08-28-ui-state-tmux-options.md` § Change 1 (drafted 2026-08-28 against `7971264c`; prerequisites #752/#753/#755 shipped — every name is the `@rk_<scope>_<name>` form, `internal/tmux/legacy_options.go` holds the table-driven `MigrateLegacyOptions`).
- Spec: `docs/specs/ui-state.md` v0.2 (§ The Option Inventory, § Layout in tmux, § Web Tabs, § Migration).

One interactive decision was taken at intake (see Assumptions #1): the plan says Change 1 "ships alone so 2–4 build on a stable contract", but dropping `rkUrl`/`rkType` from the Window JSON and `@rk_win_url`/`@rk_win_lens` from the `/options` allowlist would blank the web lens and fail 11 e2e specs until Change 2 lands (the frontend reads/writes those names in ~20 `src/` files). The user chose the **read+write compat shim**: the backend keeps emitting derived `rkUrl`/`rkType` and keeps accepting `@rk_win_url`/`@rk_win_lens` writes, translating them onto the new family; the frontend is untouched by this change.

Two plan lines are overridden by the constitution rather than by the user (Assumptions #2, #3): the plan's `DELETE /api/windows/{id}/web/{n}` becomes a `POST …/web/{n}/remove` (Constitution IX — no DELETE; CORS allowlist is `[GET, POST, OPTIONS]`), and `cmd/rk/present.go` — which writes `tmux.URLOption`/`PresentRootOption`/`LensOption` and would not compile once those constants are retired — is minimally re-pointed at the new family here (its full "sugar over `rk tab web add`" rewrite stays in Change 4).

## Why

**Problem.** Tab state lives in the browser. `rk-layout:{server}:{@N}`, `runkit-window-view:*`, `runkit-window-panel:*` and the code-folder latch `runkit-code-folder:*` are per-browser localStorage keys deciding what a *tab* shows; `?layout=` is a second copy of the same state in the URL. The web surface holds exactly one URL (`@rk_win_url`, window-scoped, last-write-wins) plus one serve root (`@rk_win_present_root`). Consequences: an agent cannot open a surface on a tab (`rk present` had to grow the `present-auto-expand.ts` render-time carve-out to fake it), two viewers of one tab disagree, a snapshot restore orphans every key, and a tab can show at most one web page.

**Target (spec § Goal).** Tab state is `@rk_win_*`; the frontend renders options and writes them back through the one `POST /api/windows/{id}/options` seam it already uses for color/marker/note; a future `rk tab` verb family gives agents the same seam from a shell. This change is the **backend contract** everything else stands on: the option constants, the `ListWindows` read path, the write allowlist + validation, the web-tab family operations, the verb routes, the snapshot round-trip, and the legacy-name migration rows.

**Why ship the backend alone.** Change 2 (frontend layout/code-root, 1844-line `surface-layout.tsx`, 5 e2e specs) and Change 3 (web tab strip) are large and risky; Change 4 (CLI) is independent of both. Landing the contract first lets 2/3/4 proceed in parallel against a stable, tested API, and lets each be reviewed on its own. The compat shim (Assumption #1) is what makes "alone" safe: the shipped frontend keeps working byte-for-byte against the new backend.

**Why not alternatives.** *Break as written* (ship red, stack 1+2) defeats the sequencing goal. *Minimal frontend re-point* grows this change into the frontend arm that Change 2 owns, splitting `surface-layout.ts` edits across two PRs. The shim is ~40 lines of derive-and-translate that Change 2 deletes (JSON side) and Change 5 deletes (allowlist side).

## What Changes

### `internal/tmux` — option constants (`tmux.go`)

Add, at window scope, with doc comments in the existing house style (each names its writer/reader and the registry row):

```go
// LayoutOption carries the tab's surface layout: "<shape>:<surface>[,<surface>…]",
// e.g. "main-left:tty,code,web". Unset renders single:tty.
const LayoutOption = "@rk_win_layout"

// MaxWebTabs bounds the indexed @rk_win_web_<n> family: ListWindows reads options
// through one fixed tmux format string, which cannot enumerate a family, so the
// URL slots are spelled out 1..8.
const MaxWebTabs = 8

// WebTabOption returns "@rk_win_web_<n>" (1 ≤ n ≤ MaxWebTabs); panics outside the range
// (callers validate first — the bound is a programming contract, not user input).
func WebTabOption(n int) string
// WebTabRootOption returns "@rk_win_web_<n>_root" — the absolute serve root for a
// file/dir present target held in slot n; read at request time by /present/, never
// enumerated into ListWindows.
func WebTabRootOption(n int) string

// WebActiveOption is the 1-based index of the web tab the web surface shows.
const WebActiveOption = "@rk_win_web_active"

// CodeRootOption is the absolute folder the code surface opens (replaces the
// per-browser runkit-code-folder:* latch; seeded/followed by the frontend in a
// later change, settable by rk tab code set in a later change).
const CodeRootOption = "@rk_win_code_root"
```

Retire `URLOption`, `PresentRootOption`, `LensOption` as **exported** names. They survive only as unexported `legacyWinURLOption = "@rk_win_url"`, `legacyWinPresentRootOption = "@rk_win_present_root"`, `legacyWinLensOption = "@rk_win_lens"` beside the existing `legacyTypeOption`/`legacyURLOption`/`legacyNoteOption` block, for the migration table and the compat shim only. Every other Go reference (`api/windows.go`, `api/present.go`, `cmd/rk/present.go`, `internal/snapshot/restore.go`, `internal/tmux/layout.go`) moves to the new constants — `go build ./...` is the completeness check.

### `internal/tmux` — `ListWindows` format + `WindowInfo` (`tmux.go` ~`:1060-1230`)

Replace the `@rk_win_lens` (field 9), `@rk_win_url` (field 10), legacy lens (field 14) and legacy url (field 15) positional fields with: `@rk_win_layout`, `@rk_win_web_1` … `@rk_win_web_8`, `@rk_win_web_active`, `@rk_win_code_root`. The `@rk_win_note` field stays a STRICT SINGLE FIELD and the legacy note stays LAST (its free-text tail is rejoined) — renumber the `parts[...]` indices and rewrite the field-count comment block accordingly. Parser is tolerant: missing/empty slots read as unset; `web_active` non-numeric or out of `1..len(WebTabs)` is clamped to `1` when tabs exist, `0` when none (never dropped — Constitution II, degrade don't error).

`WindowInfo` (and the `Window` struct that feeds the API, `tmux.go:~698`) gains:

```go
Layout   string   `json:"layout,omitempty"`
WebTabs  []string `json:"webTabs,omitempty"`  // dense, 1-based in tmux → index 0 here; trailing empties trimmed
WebActive int     `json:"webActive,omitempty"` // 1-based; 0 when no tabs
CodeRoot string   `json:"codeRoot,omitempty"`
```

`RkType`/`RkUrl` fields are **removed from the struct**. Density: `WebTabs` is built by walking `web_1..web_8` and stopping at the first empty slot (a gap means everything after it is ignored — the write paths never produce gaps; a hand-written gap degrades to the prefix).

**Compat shim, read side (Assumption #1).** The API-facing marshaller (wherever the `Window` JSON for SSE + `/ws/state` snapshots is built — one shared marshaller) emits two *derived* fields for one release:

- `rkUrl` = `WebTabs[WebActive-1]` when `len(WebTabs) > 0`, else omitted.
- `rkType` = `"iframe"` when `parseLayout(Layout)` succeeds and its order contains `web`, else omitted.

They are computed at marshal time from the new fields, never stored, and carry a `// compat: removed in Change 2 (260828 ui-state plan)` comment. Existing frontend `hasWebUrl(win)` and `HINT_ORDER` (`lib/window-view.ts:65,132`) keep working unchanged.

### `internal/tmux/webtabs.go` (new) — web-tab family ops

Pure functions over the dense `[]string` plus one tmux round trip each, driving the existing `SetWindowOptions`/`WindowOptionOp` chaining so every verb is one `tmux` invocation (the `present.go` precedent — atomic against the SSE tick):

```go
// WebAdd appends url to the window's web-tab family and returns its 1-based index.
// Idempotent on an identical stored URL: returns (existing, true) with no append. For
// /present/ URLs the idempotent hit ALSO rewrites the slot with a fresh ?v= cache-buster
// (rk present's re-present-is-refresh contract, now falling out of the add verb).
// root, when non-empty, is written to WebTabRootOption(n); when empty the slot's root
// is unset (a port/URL target replacing a stale file/dir root). Sets WebActiveOption=n
// only when the family was empty before (first tab becomes active); otherwise _active
// is untouched — "add" is not "show" (spec § Web Tabs: --show is the layout verb's job).
// Returns ErrWebTabsFull when len == MaxWebTabs and url is new.
func WebAdd(ctx, windowID, server, url, root string) (index int, existed bool, err error)

// WebRemove unsets slot n and shifts n+1..len down by one — URL AND root move together —
// then unsets the last slot (+ its root). _active repoints: == n → min(n, newLen);
// > n → active-1; < n → unchanged; newLen == 0 → _active unset. Out-of-range n → ErrWebTabRange.
func WebRemove(ctx, windowID, server string, n int) error

// WebSelect sets WebActiveOption=n; n outside 1..len → ErrWebTabRange.
func WebSelect(ctx, windowID, server string, n int) error

var ErrWebTabsFull, ErrWebTabRange error // sentinel; api maps them to 409 and 400
```

Each op first reads the current family (`GetWindowOption`s in one `show-options -w` call, or a `display-message` format with the 8+1 slots — implementer's choice, one round trip) then issues one chained set/unset batch. The pure shift/repoint logic lives in unexported helpers (`shiftWebTabs(tabs, roots []string, n) ([]string, []string)`, `repointActive(active, n, newLen int) int`) with table tests independent of tmux.

**`?v=` bump helper.** `internal/present.PresentURL(windowID, name, server, now)` becomes `PresentURL(windowID string, n int, name, server string, now func() int64)` producing `/present/@N/<n>/<name>?server=…&v=…`; `Target.URL` gains the `n` parameter. A `present.BumpVersion(url string, now) string` helper rewrites an existing `/present/` URL's `v=` query value in place (used by the idempotent `WebAdd` hit). Non-`/present/` URLs are returned verbatim.

### `internal/tmux/layout.go` — snapshot capture format

The separate list-windows format string used for snapshot capture (`layout.go:~80-100`) replaces its `LensOption`/`URLOption`/`legacyTypeOption`/`legacyURLOption` fields with `@rk_win_layout`, `@rk_win_web_1..8`, `@rk_win_web_1_root..8_root`, `@rk_win_web_active`, `@rk_win_code_root` (roots ARE captured here — this format runs once per snapshot, not per tick, so the tick-cost argument does not apply). Same note-last rule. The capture struct (`layout.go:~35-50`) swaps `RkType`/`RkURL` for `Layout`, `WebTabs []string`, `WebRoots []string` (parallel to `WebTabs`, `""` where absent), `WebActive int`, `CodeRoot string`.

### `internal/snapshot` — `Window` fields + restore

`snapshot.go:62-63`: replace `RkType`/`RkURL` with

```go
Layout    string   `json:"layout,omitempty"`
WebTabs   []string `json:"webTabs,omitempty"`
WebRoots  []string `json:"webRoots,omitempty"` // parallel to WebTabs; "" = no root
WebActive int      `json:"webActive,omitempty"`
CodeRoot  string   `json:"codeRoot,omitempty"`
```

Capture (`snapshot.go:~157`) copies from the new capture struct. Restore (`restore.go:~336`) emits `add(tmux.LayoutOption, win.Layout)`, one `add(tmux.WebTabOption(i+1), url)` + `add(tmux.WebTabRootOption(i+1), root)` per dense slot, `add(tmux.WebActiveOption, strconv.Itoa(win.WebActive))` when > 0, `add(tmux.CodeRootOption, win.CodeRoot)` — all through the existing `add` (skip-when-empty) helper so a snapshot written by an older binary (which has `rkType`/`rkUrl` keys the new struct no longer declares) simply restores without web state. **No on-disk migration**: old snapshot JSON decodes fine (unknown keys ignored); the recovery reader (`restorable.go`) is unchanged. Window-id remap on restore applies to `/present/@N/…` URLs as it does today for `@rk_win_url` — verify there IS such a remap today; if `rkUrl` was restored verbatim (stale `@N`), keep parity (verbatim) and note it in the plan rather than inventing a rewrite.

### `internal/tmux/legacy_options.go` — migration rows

Append window-scope rows to `legacyOptions`, table-driven like the existing ones:

| Old | New | Notes |
|---|---|---|
| `@rk_win_url` | `@rk_win_web_1` | after copy, if `@rk_win_web_active` unset → set `1` |
| `@rk_win_present_root` | `@rk_win_web_1_root` | plain copy |
| `@rk_win_lens` | `@rk_win_layout` | **value-mapped**: `iframe` → `single:web`, copied only when `_layout` unset; any other value → no copy. Old is unset either way |

The existing `legacyOption` row struct has no hook for "value mapping" or "side-effect set"; add an optional `Transform func(old string) (new string, ok bool)` and `After []WindowOptionOp`-style field (or two narrowly named fields — implementer's choice, kept table-driven) rather than special-casing in `moveLegacyAt`. Idempotent: second sweep issues zero set-option calls (existing guarantee, extend the test). Wrong-scope strays of the three names are purged as today.

The two shipped rows `{Old: legacyURLOption ("@rk_url"), New: URLOption}` and `{Old: "@rk_present_root", New: PresentRootOption}` and `{Old: legacyTypeOption, New: LensOption}` now chain: `@rk_url → @rk_win_url → @rk_win_web_1`. Because the sweep iterates rows in table order over every carrier, ordering the new rows AFTER the old ones makes a doubly-legacy window converge in ONE sweep; assert this in the migration test.

### `api/windows.go` — allowlist, validation, compat write shim

Allowlist consts (`:366-372`): drop `optKeyRkURL`/`optKeyRkType`; add `optKeyLayout = tmux.LayoutOption`, `optKeyWebActive = tmux.WebActiveOption`, `optKeyCodeRoot = tmux.CodeRootOption`, and accept `tmux.WebTabOption(n)` for `n ∈ 1..8` (a small `webTabIndex(key string) (int, bool)` matcher rather than 8 consts). **Compat (Assumption #1):** keep accepting the *keys* `@rk_win_url` and `@rk_win_lens` for one release, translated before validation:

- `@rk_win_url: "<u>"` → `WebTabOption(active or 1) = u` (replaces the active tab's URL; if no tabs, becomes slot 1 and `_active=1`); `@rk_win_url: null` → `WebRemove(active)`.
- `@rk_win_lens: "iframe"` → `@rk_win_layout = "single:web"` **only if** `_layout` currently unset (else no-op); any other value or `null` → no-op (`_lens` no longer exists to clear).

The translation lives in one function `translateLegacyOptionKeys(ops) ops` with a `// compat: removed in Change 5` comment, so the deletion is one hunk.

Per-key validation in `validateWindowOption`:

- `@rk_win_layout`: must parse under the **Go port of `parseLayout`** (new `internal/layoutspec` package, pure, unit-tested case-for-case against `lib/surface-layout.ts` `parseLayout`): shape ∈ {`single`,`split-h`,`split-v`,`row`,`col`,`main-left`,`main-right`,`main-top`}; arity fixed per shape (1/2/2/3/3/3/3/3); surfaces ∈ {`tty`,`web`,`chat`,`code`} (the current frontend `ViewName` registry — `desktop`/`agents` are spec'd but not shipped, so they are rejected today and the registry is one slice to extend); no repeated surface **except `tty`** (duplicate tty tiles are legal). Invalid → 400 `"layout must be <shape>:<surface,…> …"`. Empty string / `null` → unset. (Change 4's `rk tab layout` will reuse `internal/layoutspec` for its mutations; only parse/serialize ship here.)
- `@rk_win_web_<n>`: non-empty; value must be a root-relative path beginning `/proxy/` or `/present/`, or an absolute `http://`/`https://` URL with a host (stricter than today's `ValidateRkURLValue` which accepted any `/…`; a new `validate.ValidateWebTabURL` beside it — `ValidateRkURLValue` is deleted with its last caller). Direct writes may only **replace an existing slot or append at `len+1`**; `n > len+1` → 400 `"web tab n would leave a gap"`. `null` on slot `n` → routed through `WebRemove(n)` so density holds (a bare unset would leave a hole).
- `@rk_win_web_active`: integer `1..len(WebTabs)` at write time; else 400. `null` allowed only when no tabs.
- `@rk_win_code_root`: `validate.ValidatePath` + `ExpandTilde` (absolute after expansion; existing helpers). `null` → unset.

The handler's post-write `s.sseHub.wake(server)` stays (row-color safety-poll lesson); its comment is updated to name the new keys.

### `api/windows.go` — `POST /api/windows` (`:20-120`)

Body `rkType: "iframe"` + `rkUrl` (the sidebar's "Open in window" for a detected port, `client.ts createWindow(..., "iframe", url)`) is **retargeted, not removed**: it creates the window with `@rk_win_layout=single:web`, `@rk_win_web_1=<rkUrl>`, `@rk_win_web_active=1` in the one chained `CreateWindowWithOptions` call. `rkUrl` is validated with `ValidateWebTabURL`. The name-required rule stays. The body fields keep their `rkType`/`rkUrl` names for this release (compat; Change 2 renames the client arm).

### `api` — new verb routes (`router.go` beside `:755`)

All `POST`, all `?server=`-scoped like their siblings, all `{windowId}` validated by `parseWindowID`, all wake the hub on success:

| Route | Body | Response |
|---|---|---|
| `POST /api/windows/{windowId}/web` | `{"target": "<string>"}` | `201 {"index": n, "existed": bool, "url": "<stored>"}`; `409 {"error": "web tabs full (8)"}` on `ErrWebTabsFull`; `400` on parse/validation failure |
| `POST /api/windows/{windowId}/web/{n}/remove` | — | `200 {"ok": true}`; `400` on range |
| `POST /api/windows/{windowId}/web/{n}/select` | — | `200 {"ok": true}`; `400` on range |

`target` goes through `internal/present.ParseTarget(target, cwd)` — the same five kinds `rk present` accepts (file, dir, `:port`/`port`, local URL, external URL) — so the UI address bar (Change 3) and `rk tab web add` (Change 4) resolve identically. `cwd` for relative file/dir targets is the window's first pane `pane_current_path` (from `ListWindows` `WorktreePath`). Port/local-URL kinds run `present.ProbePort` best-effort (failure is logged, not fatal — matches `rk present`). File/dir kinds pass `target.Root` into `WebAdd` as the slot root. `{n}` is gated `^[1-8]$` before any tmux call.

### `api/present.go` — indexed content route

Routes become `/present/{windowId}/{n}/*` and `/present/{windowId}/{n}` (308 to trailing slash as today), `n` gated `^[1-8]$`, serve root read from `tmux.WebTabRootOption(n)` at request time. The old `/present/{windowId}/*` and `/present/{windowId}` forms **stay registered for one release** and map to `n=1` (a stored `@rk_win_url` migrated into `web_1` still carries the n-less URL until re-presented). Route ordering: register the `{n}` forms first; the n-less handler must not swallow a numeric first segment — simplest is one handler that inspects whether the first path segment after `{windowId}` is `^[1-8]$`. `presentRootOption` const and its comment go.

### `cmd/rk/present.go` — minimal re-point (Assumption #3)

Only what compilation and contract-parity require; the "sugar over `rk tab web add`" rewrite is Change 4:

- Default arm (`:195-215`): replace the `URLOption`/`PresentRootOption` batch with `tmux.WebAdd(ctx, windowID, server, url, root)` (root `""` for non-file/dir kinds — `WebAdd` clears a stale root on the slot). The `?v=` refresh contract now comes from `WebAdd`'s idempotent hit. Printed URL is the stored one.
- `--window` arm (`:240-285`): `LensOption=iframe` → `LayoutOption=single:web`; the id-dependent URL/root follow through `WebAdd` on the new window.
- `present_test.go` fakes re-pointed accordingly; behavior assertions (printed URL, notify) unchanged.

### `internal/present` — indexed URL

As above: `PresentURL`/`Target.URL` take the slot index; `BumpVersion` added. `present_test.go` updated.

### Tests

- `internal/tmux/webtabs_test.go` (real test socket, `TestMain` sweep pattern): add → 1; add same URL → (1, existed) and, for a `/present/` URL, `?v=` changed; add ×8 then 9th → `ErrWebTabsFull`; remove middle of 3 → URL and root of slot 3 now in slot 2, slot 3 unset, `_active` repointed for each of the three relations (`<`, `==`, `>`); remove last remaining → `_active` unset; select out of range → `ErrWebTabRange`. Pure `shiftWebTabs`/`repointActive` table tests.
- `internal/layoutspec` tests: every `parseLayout` case in `lib/surface-layout.test.ts` ported (valid shapes × arity, unknown shape, wrong arity, unknown surface, repeated non-tty, repeated tty OK, serialize round-trip).
- `internal/tmux/tmux_test.go` `parseWindows`: renumbered fixture lines; empty slots; gap-tolerance prefix rule; `web_active` clamp.
- `api/windows_test.go`: allowlist rejects `@rk_win_web_9`, `@rk_win_url` still accepted and translated (compat), `@rk_win_lens=iframe` sets layout only when unset; validation matrix — bad shape, repeated `web`, `_active` out of range, gap write, non-`/proxy|/present` relative URL, `javascript:`; `POST /api/windows` `rkType=iframe` produces layout+web_1+active=1; verb routes 201/409/400 + hub wake observed.
- `api/present_test.go`: `/present/@1/2/x` reads `_2_root`; n-less form reads `_1_root`; `n=9` → 400.
- `internal/tmux/legacy_options_test.go`: window carrying `@rk_win_url`+`@rk_win_present_root`+`@rk_win_lens=iframe` → `web_1`+`web_1_root`+`_active=1`+`layout=single:web`, legacy names gone; `_lens=iframe` with `_layout` already set → layout untouched; doubly-legacy (`@rk_url`) converges in one sweep; second sweep issues zero calls.
- `internal/snapshot` round-trip: 3-tab window with roots on tabs 1 and 3, `_active=2`, layout `split-h:tty,web`, code root → restore yields dense identical family with the same active index; an old-format snapshot JSON (`rkType`/`rkUrl` keys) decodes and restores without error.
- `cmd/rk/present_test.go`: fakes re-pointed; printed URL/notify assertions unchanged.
- Frontend: **no source changes.** Run `just test-frontend` and the e2e specs touching the web lens (`web-view-lens`, `present-auto-expand`, `right-panel`, `surface-layout`, `web-tile-chrome`, `legacy-scope-sweep`) to prove the compat shim; baseline `web-view-lens.spec.ts` :138/:295/:335 on clean `origin/main` first (pre-existing timeouts, memory).

### Out of scope (Changes 2–5 — do NOT implement)

Frontend consumption of `layout`/`webTabs`/`codeRoot`; deletion of `resolveLayout`/localStorage keys/`?layout=`; the web tab strip; `rk tab` verbs; `rk present` as sugar; `rk code exec --tab`; removal of the compat shim, the n-less `/present/` route and the three migration rows; `tmux-sessions.md` registry rewrite beyond what hydrate needs to keep memory truthful for this PR.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) § Server-Scoped User Options registry — add `@rk_win_layout`, `@rk_win_web_<n>` (1..8) + `_root`, `@rk_win_web_active`, `@rk_win_code_root` rows; mark `@rk_win_url`/`@rk_win_present_root`/`@rk_win_lens` as retired → migration rows; rewrite the `@rk_win_url` last-write-wins paragraph (`:343`) for the indexed family; `ListWindows` field-position notes; the new `legacyOptions` rows + the Transform/After hook
- `run-kit/api-and-sockets`: (modify) `/options` allowlist + validation (layout grammar, web-tab URL rule, density/active rules, compat translation), the three `…/web` verb routes, `POST /api/windows` retarget, indexed `/present/{windowId}/{n}/*` + n-less compat, Window JSON fields (`layout`/`webTabs`/`webActive`/`codeRoot` + derived compat `rkUrl`/`rkType`)
- `run-kit/layout-snapshots`: (modify) capture set gains the web-tab family + roots + layout + code root; struct-field (not option-name) storage; old-snapshot decode compatibility
- `run-kit/architecture`: (modify) new packages `internal/layoutspec`, `internal/tmux/webtabs.go`; `internal/present` indexed `PresentURL`/`BumpVersion`; `rk present` now writes through `WebAdd`
- `run-kit/ui/lenses-and-layout`: (modify) one paragraph — the web lens's `rkUrl`/`rkType` inputs are now derived compat fields over `webTabs`/`layout` until Change 2

## Impact

- **Backend Go** (`app/backend/`): `internal/tmux/{tmux.go,layout.go,legacy_options.go,webtabs.go(new)}`, `internal/layoutspec/` (new), `internal/present/present.go`, `internal/snapshot/{snapshot.go,restore.go}`, `internal/validate/validate.go`, `api/{windows.go,present.go,router.go}` (+ any shared Window marshaller), `cmd/rk/present.go`, and their `_test.go` twins. Expect ~15 files touched, ~6 new.
- **API contract**: Window JSON adds 4 fields (2 derived compat fields kept); `/options` key set changes (3 removed, 11 added, 2 kept as compat aliases); 3 new POST routes; `/present/` gains an indexed form. All mutating routes remain POST (Constitution IX).
- **tmux state**: 11 new window-option names in the `@rk_win_` namespace; 3 retired with migration rows. Snapshot files written by this build carry the new keys; older files still restore.
- **Frontend**: zero source changes; e2e/unit suites must stay green via the compat shim.
- **Docs**: `docs/specs/ui-state.md` §§ Option Inventory / Web Tabs are implemented as written except `DELETE` → `POST …/remove`; the spec's route table should be amended by hydrate (spec is human-curated — propose, do not silently edit).
- **Risk**: the `ListWindows` format-string renumbering touches the hottest read path; a miscount silently shifts every downstream field (marker/role/flair/note). The renumbered fixture tests in `tmux_test.go` are the guard.

## Open Questions

- None blocking. The window-id remap of stored `/present/@N/…` URLs on snapshot restore is to be checked against current behavior at apply and kept at parity (see § `internal/snapshot`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend keeps a read+write compat shim for one release: derived `rkUrl`/`rkType` in the Window JSON; `@rk_win_url`/`@rk_win_lens` accepted on `/options` and translated onto the new family; frontend untouched | Asked — user chose "Read+write compat shim" over frontend re-point / break-as-written | S:90 R:85 A:90 D:95 |
| 2 | Certain | Plan's `DELETE /api/windows/{id}/web/{n}` becomes `POST …/web/{n}/remove` | Constitution IX forbids DELETE; CORS allowlist is GET/POST/OPTIONS (`router.go:726`) | S:85 R:90 A:100 D:95 |
| 3 | Confident | `cmd/rk/present.go` is minimally re-pointed at `WebAdd`/`LayoutOption` in this change; the full sugar rewrite stays in Change 4 | Retiring the exported constants makes it a compile error otherwise; parity-only edit keeps the plan's Change 4 scope intact | S:70 R:80 A:85 D:80 |
| 4 | Confident | `WebAdd` does NOT change `_active` when the family already has tabs (only the first tab becomes active); `--show`/select is a separate write | Spec § Web Tabs separates add from `--show`; Change 3's strip and Change 4's `--show` both select explicitly | S:65 R:85 A:75 D:70 |
| 5 | Certain | `?v=` cache-buster bump on an idempotent `/present/` re-add is implemented inside `WebAdd` (`present.BumpVersion`) | Plan Change 3 states "the `?v=` bump for `/present/` kinds happens server-side in `WebAdd`"; spec § Web Tabs decided identity-is-URL | S:75 R:85 A:85 D:85 |
| 6 | Confident | Direct `/options` writes to `@rk_win_web_<n>` may only replace an existing slot or append at `len+1`; gaps → 400; `null` on a slot routes through `WebRemove` | Density invariant (spec) must hold on every write path; plan silent on the raw-write arm | S:55 R:85 A:80 D:70 |
| 7 | Certain | Web-tab URL rule: root-relative must start `/proxy/` or `/present/`; absolute must be http(s) with host (new `ValidateWebTabURL`; `ValidateRkURLValue` deleted with its last caller) | Plan § api: "`_web_n` must be a relative `/proxy|/present` path or absolute `http(s)`" | S:80 R:85 A:85 D:85 |
| 8 | Confident | Layout validation is a Go port of `parseLayout` in a new pure `internal/layoutspec` package (shapes, fixed arity, surfaces {tty,web,chat,code}, duplicate-tty exception) | Plan Change 4 names `internal/layoutspec` as the shared CLI/UI table; landing parse/serialize here avoids a throwaway validator in `api` | S:70 R:80 A:85 D:75 |
| 9 | Confident | Surface registry for validation is the shipped `ViewName` set {tty,web,chat,code}; `desktop`/`agents` rejected until they ship | Spec lists them as "open registry" but the frontend has no such lenses; one slice to extend later | S:60 R:90 A:80 D:75 |
| 10 | Certain | Snapshot capture format (`layout.go`) enumerates roots `_1_root.._8_root` (once per snapshot, not per tick); `WebRoots` parallel slice in `snapshot.Window` | Plan § snapshot lists `WebRoots`; tick-cost argument only applies to `ListWindows` | S:75 R:85 A:85 D:85 |
| 11 | Confident | Migration table gains a per-row `Transform`/`After` hook (table-driven) for the `_lens=iframe → layout=single:web` value map and the `_active=1` side-effect, rather than special-casing `moveLegacyAt` | context.md convention: "table-driven like the existing rows"; two rows need behavior the struct lacks | S:65 R:85 A:80 D:75 |
| 12 | Certain | New migration rows are ordered AFTER the existing `@rk_url→@rk_win_url` / `@rk_present_root→…` / `@rk_type→@rk_win_lens` rows so a doubly-legacy window converges in one sweep | Sweep iterates rows in table order per carrier (`sweepLegacyTargets`) | S:60 R:90 A:85 D:85 |
| 13 | Certain | `web_active` read-side clamp: non-numeric/out-of-range → 1 when tabs exist, 0 when none; never dropped | Spec § Option-value conventions: invalid values degrade, never error; option left as written | S:70 R:90 A:85 D:85 |
| 14 | Certain | `POST /api/windows` keeps the `rkType`/`rkUrl` body field NAMES this release while retargeting them to layout+web_1+active | Compat decision (#1) covers the client's `createWindow(..., "iframe", url)` arm; plan defers the client rename to Change 2 | S:75 R:90 A:85 D:85 |
| 15 | Confident | Verb-route `target` resolves relative file/dir paths against the window's first pane cwd (`WorktreePath`); port kinds probe best-effort like `rk present` | `ParseTarget(arg, cwd)` needs a cwd; the window's cwd is the only sensible server-side anchor | S:55 R:85 A:75 D:70 |
| 16 | Certain | `/present/{windowId}/{n}/*` and the n-less form share one handler that sniffs `^[1-8]$` on the first segment | Avoids chi route-ordering ambiguity between `{n}` and `*` | S:60 R:95 A:85 D:80 |
| 17 | Certain | Change type `feat` | Plan § Sequencing: "1 `feature`"; new API surface + options | S:95 R:100 A:100 D:100 |
| 18 | Confident | Frontend tests are run but no frontend source is touched even where a comment names `@rk_win_url` (`window-view.ts`, `present-auto-expand.ts`) | Comments are Change 2's to rewrite; touching them here blurs the PR boundary — but a reviewer may prefer the pointer updated now | S:50 R:95 A:60 D:55 |

18 assumptions (10 certain, 8 confident, 0 tentative, 0 unresolved).
