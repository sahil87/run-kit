# UI State in tmux Options — `@rk_win_layout`, Web Tabs, `rk tab`

**Drafted**: 2026-08-28 · against `67f4a553` · spec: [`docs/specs/ui-state.md`](../../../docs/specs/ui-state.md) (v0.2)
**Shape**: 5 changes, run-kit only (fab-kit untouched — it reads one pane option and nothing here)
**Prerequisite**: `26-08-28-tmux-option-scope-naming.md` shipped (Changes 1–3) — every name below is the `@rk_<scope>_<name>` form and `MigrateLegacyOptions` exists.

## Diagnosis

Tab state lives in the browser. `rk-layout:{server}:{@N}`, `runkit-window-view:*`, `runkit-window-panel:*` (surface-layout.ts:308-362), and the code-folder latch `runkit-code-folder:*` (code-folder-latch.ts) are per-browser keys deciding what a *tab* shows; `?layout=` is a second copy of the same state in the URL (the L1–L4 ladder, surface-layout.ts:286). Consequences: an agent cannot open a surface on a tab (`rk present` had to grow the `present-auto-expand.ts` render-time carve-out to fake it), two viewers of one tab disagree, and a snapshot restore orphans every key. The web surface holds exactly one URL (`@rk_win_url`, window-scoped, last-write-wins).

Target: tab state is `@rk_win_*`; the frontend renders options and writes them back through the one `POST /api/windows/{id}/options` seam it already uses for color/marker/note; a `rk tab` verb family gives agents the same seam from a shell.

### Facts that shape the plan (verified at `67f4a553`)

- **Options reach the frontend via a fixed format string.** `ListWindows` reads `#{@rk_win_url}` as one positional field (tmux-sessions.md "field 10"); indexed families cannot be enumerated in a format → **cap web tabs at 8** and spell the slots out. Roots stay out of the tick: `api/present.go` already does `tmux.GetWindowOption` per request.
- **One write seam already exists.** `api/windows.go:366-372` (`optKey*` allowlist) + `handleWindowOptions` (`:444`) partial-merge with `null`-clears; `api/client.ts:443 setWindowOptions`. New keys are allowlist rows, not new endpoints.
- **Snapshots store struct fields**, not option names (`snapshot.go:62-63 RkType/RkURL`; `restore.go:335-341` maps at restore) → new fields on the struct, no on-disk migration.
- **Layout logic is already pure.** `lib/surface-layout.ts` (506 lines, colocated tests) holds parse/serialize/degrade/promote/swap/close; only the *resolution + storage* half (`resolveLayout`, `read/writeStoredLayout`, `seedLayoutFromLegacy`, `translateLegacyParams`) dies. Ratios (`:380-426`) stay.
- **`rk present` resolution is already tmux-free** (`internal/present.ParseTarget`, `Target.URL`, `ProbePort`) and will be reused verbatim by `rk tab web add`.
- **`rk code exec` host resolution** (`cmd/rk/code.go:98,186`) is cwd/`--folder` based; adding a `--tab` arm is one more resolver ahead of it.
- The `web-view-lens.spec.ts` :138/:295/:335 timeouts are pre-existing on main (memory) — baseline before touching that spec.

---

## Change 1 — Backend: options, payload, snapshot, migration (MEDIUM)

Everything the frontend and CLI will read or write; ships alone so 2–4 build on a stable contract.

### `internal/tmux`
- Constants: `LayoutOption="@rk_win_layout"`, `WebTabOption(n)`, `WebTabRootOption(n)`, `WebActiveOption`, `CodeRootOption`, `MaxWebTabs=8`. Retire `URLOption`/`PresentRootOption`/`LensOption` constants (kept as `legacy*` for the migration table only).
- `ListWindows` format: replace the `@rk_win_url`/`@rk_win_lens` fields with `layout`, `web_1..web_8`, `web_active`, `code_root` (field-count comment block updated; parser tolerant of empty slots). `Window` struct gains `Layout string`, `WebTabs []string` (dense, trailing empties trimmed), `WebActive int`, `CodeRoot string`; `RkURL`/`RkType` removed.
- **Web-tab family ops** (pure over a `[]string` + tmux ops): `WebAdd(url) (index, existed)` — idempotent on identical URL, appends at `len+1`, refuses at 8; `WebRemove(n)` — shifts `n+1..len` down (URL *and* root), unsets the last slot, clamps/repoints `_active`; `WebSelect(n)`. Live in `internal/tmux/webtabs.go`, drive `SetWindowOptions` chained ops so each verb is one tmux round trip.
- `MigrateLegacyOptions` rows: `@rk_win_url→@rk_win_web_1` (+ `_active=1`), `@rk_win_present_root→@rk_win_web_1_root`, `@rk_win_lens=iframe→@rk_win_layout=single:web` (only when `_layout` unset), then unset legacy. Table-driven like the existing rows.

### `api`
- `windows.go` allowlist: add `@rk_win_layout`, `@rk_win_web_1..8`, `@rk_win_web_active`, `@rk_win_code_root`; drop `@rk_win_url`/`@rk_win_lens`. Validation: `_layout` must parse (shape ∈ presets, surfaces ∈ registry, no repeats) — reject 400 rather than store garbage; `_web_n` must be a relative `/proxy|/present` path or absolute `http(s)`; `_active` ∈ 1..len. Handler wakes the hub after a successful write (row-color safety-poll lesson).
- Window JSON: `layout`, `webTabs`, `webActive`, `codeRoot` replace `rkUrl`/`rkType` (SSE + `/ws/state` snapshots share the marshaller).
- **New verb routes** (so the frontend strip and future callers get renumbering for free instead of re-implementing it): `POST /api/windows/{id}/web` `{target}` → `{index, existed}`; `DELETE /api/windows/{id}/web/{n}`; `POST /api/windows/{id}/web/{n}/select`. Thin wrappers over the `internal/tmux` family ops; `target` goes through `internal/present.ParseTarget` so the UI address bar and `rk tab web add` resolve identically.
- `present.go` route: `/present/{windowId}/{n}/*` (n gated `^[1-8]$`), reads `_<n>_root`; the old `/present/{windowId}/*` form maps to `n=1` for one release.

### `internal/snapshot`
- `Window` fields `Layout`, `WebTabs`, `WebRoots`, `WebActive`, `CodeRoot` (drop `RkType`/`RkURL`); capture from the new `tmux.Window`; restore emits the family. Round-trip test asserts a 3-tab window restores dense with the same active index.

### Tests
- `webtabs_test.go` on a real test socket: add/idempotent/full, remove-middle renumbers URL+root and repoints active, select bounds.
- `windows_test.go`: allowlist + validation matrix (bad shape, repeated surface, `_active` out of range, 9th tab).
- Migration: legacy url+root+lens window → web_1 + root + `single:web`; second run no-op.
- Snapshot round-trip.

---

## Change 2 — Frontend: layout + code root from tmux, ladder retired (LARGE)

### `lib/surface-layout.ts`
- Delete `resolveLayout`, `layoutStorageKey`, `read/writeStoredLayout`, `seedLayoutFromLegacy`, `hintLayout`. Keep `parseLayout`/`serializeLayout`/`degradeLayout`/verbs/ratios. New `effectiveLayout(win)`: `parseLayout(win.layout) ?? single:tty`, degraded tile-by-tile by `availableTiles(win)` (the option is never rewritten by degradation).
- `translateLegacyParams` becomes **one-shot**: at route entry, if the URL carries `?view|?panel|?layout` and `win.layout` is empty, POST the translated layout once, then `replaceState` to the bare route. If `win.layout` is set, just drop the params. Both arms delete the matching `rk-layout:*`/`runkit-window-view:*`/`runkit-window-panel:*` keys (client-side one-shot migration, § Migration in the spec).
- New per-viewer zoom key `rk-layout-zoom:{server}:{windowId}` (`read/writeStoredZoom`, same try/catch-noop pattern as ratios). Zoom verb writes it; mobile switch-to-tile writes it; cleared when the zoomed surface leaves the layout.

### `app.tsx` / `components/surface-layout.tsx`
- Layout state = `effectiveLayout(routeWindow)` — no `useState` copy. Every verb (promote / swap / cycle / close / rail toggle / `Tile:` palette rows / mobile persisting arm) → `setWindowOptions(server, id, {"@rk_win_layout": serializeLayout(next)})`. Optimistic render until the option tick confirms (the existing color-swatch pattern).
- URL mirroring (`replaceState` of `?layout=`) removed; router-url.ts loses the param; history entries are bare routes.
- `lib/present-auto-expand.ts` + its `SurfaceLayout` hook deleted (the layout write *is* the expand). `present-auto-expand.spec.ts` is rewritten as "present grows the shared layout" (Change 4 ships the write; until then the spec asserts the option-driven repaint using `tmux set-option -w @rk_win_layout` directly — the `_tmux.ts` pattern).
- Focus-memory (`lib/focus-memory.ts`) keys unchanged — it is a viewer posture.

### Code root
- `lib/code-folder-latch.ts`: storage functions deleted; module keeps the pure seed/follow decision and exports `codeRootFor(win)` = `win.codeRoot || derived gitRoot`. Seed write (first render of the `code` tile with empty `win.codeRoot`) and follow write (`onCodeFolderNavigated`) both → `setWindowOptions({"@rk_win_code_root": folder})`. One-shot client migration of `runkit-code-folder:*` alongside the layout keys.

### Tests
- `surface-layout.test.ts`: drop ladder/storage cases; add `effectiveLayout` degradation + one-shot translation arms (mock `setWindowOptions`).
- e2e: `surface-layout.spec`, `right-panel.spec`, `mobile-layout.spec`, `surface-focus-chords.spec`, `code-folder-latch.spec` re-pointed: assertions read `tmux show-option -wv @rk_win_layout` after a verb and reload-persistence goes through tmux, not localStorage. Add: two contexts on one tab see the same layout after one clicks Promote; zoom in one context does not appear in the other. `test-e2e` notes: run touched specs against clean main first (web-view-lens preexisting failures).

### Docs (land with this change)
- In-place amendments replacing the banners: `window-views.md` R2/R7 rewritten, R5 deleted; `surface-layout.md` § State replaced by a pointer + the ratios/zoom paragraph; `right-panel.md` P1 rewritten. `ui-state.md` status → `[current]` for §§ Layout, Code.

---

## Change 3 — Frontend: web tab strip (MEDIUM)

### `components/iframe-window.tsx`
- Renders `win.webTabs` as a strip above the address bar when `length ≥ 2` (hidden at 1 — today's chrome byte-identical). Each tab keeps its iframe mounted, `hidden` when inactive (P3), so switching never reloads.
- Tab click → `POST …/web/{n}/select`; close glyph → `DELETE …/web/{n}`; `+` → `POST …/web` with the address-bar draft. Address-bar submit on the active tab → `setWindowOptions({"@rk_win_web_<active>": url})` (same-URL no-op; the `?v=` bump for `/present/` kinds happens server-side in `WebAdd`, so the bar routes through `POST …/web` when the draft is a file/dir-looking target — decided in review, default: always `POST …/web`).
- Detected-port affordance: `win.ports` (already on the payload for the sidebar) not present in `webTabs` → a muted `+ :3000` chip at the strip's end; click = `POST …/web {target: ":3000"}`. Declared write, nothing derived.
- Onboarding state unchanged (`webTabs.length === 0`).
- `lib/web-url.ts` gains `webTabTitle(url)` (display: `localhost:3000/…`, basename for `/present/`, host for external) — pure, tested.

### Tests
- `iframe-window` unit: strip visibility threshold, active hiding, title derivation.
- e2e `web-tabs.spec.ts` (+ `.spec.md`): seed three tabs with `tmux set-option -w`, assert strip, select, remove-middle renumbering visible in the DOM, second context sees the same active tab.

---

## Change 4 — CLI: `rk tab` family, `rk present` as sugar, `rk code exec --tab` (MEDIUM)

### `internal/tabaddr` (new, pure)
- `Parse(s) (Addr, error)` for `[@N][/surface[/n]]` + the surrounding `-L`/`=session:` handled by the existing `rk mux` flag/target plumbing; `Addr{WindowID, Surface, Index}`. Own-tab default resolved by the caller via `$TMUX_PANE` → `display-message -p '#{window_id}'` (the `present.go` code path, extracted to `cmd/rk/owntab.go`).

### `cmd/rk/tab*.go`
- `rk tab new [--session =S] [--cwd D] [--name N] [--layout L]` → `CreateWindowWithOptionsID` (+ `@rk_win_layout`), prints `@N`.
- `rk tab layout [@N] <L>` | `--add S` | `--rm S` | `--promote S` | `--cycle` — Go port of the four pure mutations (`lib/surface-layout.ts` promote/swap/close + growth shapes) in `internal/layoutspec` so CLI and UI share one table; unit tests mirror the TS ones case-for-case.
- `rk tab web add [@N] <target> [--show]` → `present.ParseTarget` + `ProbePort` + `tmux.WebAdd`; `--show` = layout `--add web` + `WebSelect`. Prints `@N/web/<n>`. Exit 1 when full.
- `rk tab web rm|select [@N/web/<n>]`, `rk tab web ls [@N]` (index, url, active marker; `--json`).
- `rk tab code set [@N] <folder>`; `rk tab show [@N]` (every `@rk_win_*`, `--json`).
- All verbs tmux-only (work with `rk serve` down); stdout = data, stderr = diagnostics; toolkit exit codes.

### `rk present`
- Body becomes: `rk tab web add <target> --show` (+ `--notify` unchanged); `--window[=name]` = `rk tab new --layout single:web` then add. `internal/present` untouched. Help text says "alias of `rk tab web add --show`".

### `rk code exec --tab [@N]`
- New resolver ahead of `--folder`/cwd: `@rk_win_code_root` of the target tab (own tab by default when inside tmux); falls through when empty. `code.go:98` host-matching reused.

### Tests + standards
- `tab_*_test.go` on test sockets per verb; `present_test.go` asserts equivalence with `web add --show`; `code_test.go` `--tab` arm.
- `help-dump` + toolkit-standards Principle 9 pass for the new family; `rk skill run-kit` bundle teaches `rk tab` and demotes `rk present` to alias.

---

## Change 5 — Cleanup after one release (SMALL)

- Drop `?view|?panel|?layout` translation, the client-side localStorage migration, `/present/{windowId}/*` (n-less) route, and the `@rk_win_url`/`_present_root`/`_lens` migration rows → unset-only.
- `rk doctor` row: windows still carrying legacy names (0 expected).
- Hydrate: `tmux-sessions.md` registry (new rows + cap), `ui/lenses-and-layout.md`, `architecture.md` (`rk tab`, `present` alias), `code-bridge.md` (`--tab`), `layout-snapshots.md`.

---

## Sequencing

```
1 (backend contract)
├── 2 (layout + code root)      ── docs amendments land here
│    └── 3 (web strip)          ── needs 2's option-driven render
└── 4 (rk tab)                  ── parallel with 2/3 after 1; present-auto-expand.spec rewrite lands in 2 using raw set-option, re-pointed to `rk present` in 4
5 after 2–4 have been in a release
```

- One PR per change, each `/fab-new` → confidence gate → `/fab-fff`. Change types: 1 `feature`, 2 `refactor`, 3 `feature`, 4 `feature`, 5 `chore`.
- Change 2 is the risky one (1844-line `surface-layout.tsx`, 5 e2e specs): baseline every touched spec on clean `origin/main` first; run `surface-layout`, `right-panel`, `mobile-layout`, `code-folder-latch`, `present-auto-expand`, `web-view-lens` together before ship (pane-worker green claims are scoped).
- Constitution check per change: II (derived from tmux, cold-start equivalent), IV (no new routes beyond the three web verbs and the indexed present path; `?layout=` removed), V (palette/CLI are the mechanism; buttons mirror).
