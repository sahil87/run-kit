# Intake: CLI — `rk tab` Family, `rk present` as Sugar, `rk code exec --tab`

**Change**: 260829-c143-rk-tab-cli-present-sugar
**Created**: 2026-08-29

## Origin

One-shot `/fab-new` invocation, scoped to a single section of a pre-written plan:

> Change 4 from fab/plans/sahil/26-08-28-ui-state-tmux-options.md -- CLI: rk tab family, rk present as sugar, rk code exec --tab (MEDIUM). Changes 1-3 (backend options, frontend layout+code-root, web tab strip) already merged to main. Implement exactly the Change 4 section of that plan file; do not implement Change 5.

Source documents (read in full at intake; the relevant content is reproduced below so the apply agent needs neither):

- Plan: `fab/plans/sahil/26-08-28-ui-state-tmux-options.md` § Change 4 (drafted 2026-08-28 against `7971264c`).
- Spec: `docs/specs/ui-state.md` v0.2 — § Addressing Grammar, § Web Tabs (the `rk present` is absorbed paragraph), § Code Surface + Code Bridge (the `--tab` form), § `rk tab` — The CLI Surface **[planned]**.
- Prior changes (merged to `main` at `93553a3c`): #759 `260828-fykg` backend contract, #760 `260828-iip5` frontend layout + code root, #761 `260828-9kip` web tab strip.

No prior conversation on this topic exists in this session; the plan section and the spec are the entire signal. Zero questions were asked — every decision point graded Confident or higher (see Assumptions). Two plan lines are adjusted against verified code state rather than by the user: `internal/layoutspec` **already exists** (Change 1 shipped `Parse`/`String`/`Has`), so the verb port extends it instead of creating it (Assumption #1); and the plan's "present-auto-expand.spec re-pointed to `rk present` in 4" cannot land as an e2e change because the e2e rig exposes no `rk` binary — the equivalence is asserted in Go instead (Assumption #10).

## Why

**Problem.** After Changes 1–3, tab state lives in tmux (`@rk_win_layout`, the dense `@rk_win_web_<n>` family + `_root`s + `_active`, `@rk_win_code_root`) and the frontend renders and writes it through `POST /api/windows/{id}/options` and the three web verb routes. But the only shell-side writer is `rk present`, which can add a web tab and nothing else: an agent in a pane still cannot say "show the web tile", "put code on the right", "switch to tab 2", "remove that tab", or "run this VS Code command in *my* tab's editor". The spec's whole premise (§ Goal: an agent can fully address and drive the UI from a shell, with `rk serve` down) is unmet until a verb family exists.

**Consequence of not doing it.** `rk present` stays a one-off that only *makes content available* — the `rk skill display` bundle literally says "You cannot open the tile for the user" — and every other tab mutation is UI-only. The `?layout=` ladder is gone (Change 2), so there is now *no* way for an agent to express a layout at all. `rk code exec` keeps resolving hosts by cwd, which breaks the moment an agent's pane cwd is not the folder its tab's code surface shows.

**Why this shape.** Thin verbs over the already-shipped `internal/tmux` family ops (`WebAdd`/`WebRemove`/`WebSelect`/`ReadWebTabFamily`), the already-shipped `internal/layoutspec` grammar, and `internal/present`'s target resolution — no new backend routes, no daemon dependency (tmux is the store, the daemon a renderer). `rk present` becomes sugar so there is exactly one code path that adds a web tab from a shell. The layout verbs are a Go port of the frontend's four pure mutations so agent and human go through one growth/collapse table (spec § `rk tab`). Placement per `docs/specs/cli-layering.md`: `rk tab` is substrate — it knows nothing about pipelines.

## What Changes

### `internal/tabaddr` (new, pure) — address parsing

`Parse(s string) (Addr, error)` for the tab-relative part of the spec grammar `@N[/<surface>[/<n>]]`; the surrounding `-L <server>` / `=session:` qualifiers are handled by the existing `rk mux` flag/target plumbing (see § Server + own-tab resolution below), not by this package.

```go
// Addr is a parsed tab address. WindowID is "" when the caller omitted @N
// (own-tab default — resolved by cmd/rk, never here). Surface is "" when no
// surface segment was given; Index is 0 when no <n> segment was given.
type Addr struct {
	WindowID string // "@N" or ""
	Surface  string // "web" | "tty" | "code" | "chat" | "" (validated against layoutspec's registry)
	Index    int    // 1-based; 0 = absent
}

// Parse accepts:  "@12"  "@12/web"  "@12/web/3"  "web/3"  "3"  ""
// - "@N" uses validate.ValidateWindowID (strict ^@[0-9]+$).
// - a surface segment must be a layoutspec surface kind.
// - <n> is only legal after "web" (the only surface with sub-addresses, v1) and
//   must satisfy 1 ≤ n ≤ tmux.MaxWebTabs — the bound is checked HERE (parse-time),
//   so callers get a usage error (exit 2) for "@1/web/9", not a tmux error.
// - a bare integer ("3") is shorthand for "web/3" on the caller's own tab; a bare
//   "web/3" is web slot 3 on the own tab (spec § Addressing Grammar: "rk tab web rm 2").
// Anything else — a fourth segment, an empty segment, "@1/tty/2" — is an error.
func Parse(s string) (Addr, error)

// String round-trips: "@12/web/3", "@12/web", "@12", "" (empty Addr).
func (a Addr) String() string
```

Table tests cover every accepted form and each rejection class. No tmux, no I/O.

### `cmd/rk/owntab.go` — own-tab + server resolution (extracted from `present.go`)

The `$TMUX_PANE → display-message -pt <pane> '#{window_id}'` code path and `callerContext()` (socket prefix from `tmux.OriginalTMUX`, server name = socket basename) currently live in `cmd/rk/present.go`. Extract them to `cmd/rk/owntab.go` as shared helpers so `present.go`, the `tab*.go` verbs and `code.go`'s `--tab` arm all use one implementation:

```go
// ownWindowID resolves the caller's own tmux window (@N) via $TMUX_PANE on the
// caller's own server. Returns an operational error (exit 1) when $TMUX_PANE is
// unset or $TMUX is malformed — the message names the fix ("pass @N explicitly").
func ownWindowID(ctx context.Context) (windowID, server string, err error)

// resolveTabWindow applies the address default: addr.WindowID when set (on the
// -L server or the caller's own server), else ownWindowID. The returned server
// name is what every internal/tmux -L primitive takes.
func resolveTabWindow(ctx context.Context, addr tabaddr.Addr, serverFlag string) (windowID, server string, err error)
```

Keep the existing `present*Fn` test seams working (the extracted functions are what the seams wrap; `present_test.go` continues to pass unchanged where it asserts behavior).

**Server + own-tab resolution rules** (same as `rk mux`, `mux.go` `muxServer()`): `-L/--server` on the `tab` parent wins; else the caller's own server derived from the original `$TMUX` socket basename; else `default`. When `-L` names a server the caller is not inside, `@N` is **mandatory** (there is no "own tab" on a foreign server) — omit it and the verb exits 2 with `"@N is required when --server names another server"`. `=session:window` targets are accepted wherever `@N` is (the `tmux.ParsePaneTarget` `=` form, resolved to a window id via one `display-message -pt =session:window '#{window_id}'`); bare `session:window` is rejected exactly as `rk mux` rejects it (the documented hijack footgun).

### `internal/layoutspec` — verb port (extend the existing package)

The package already holds `Layout{Shape, Order}`, `shapeArity`, `surfaceKinds`, `Parse`, `String`, `Has`. Add the pure mutations as a case-for-case port of `app/frontend/src/lib/surface-layout.ts:424-497`, plus the two tables they need:

```go
// growthShape / collapseShape mirror GROWTH_SHAPE / COLLAPSE_SHAPE:
//   grow  1→2 = "split-h", 2→3 = "main-left"
//   close 3→2 = "split-h", 2→1 = "single"
// shapeRing mirrors SHAPE_RING (same-arity cycle rings):
//   1: [single]  2: [split-h, split-v]  3: [row, col, main-left, main-right, main-top]

// Default is the layout an unset @rk_win_layout renders: single:tty
// (the frontend's effectiveLayout fallback). Every verb below treats "" as Default.
func Default() Layout

// Promote moves surface to slot A; no-op (same layout returned) when absent or already A.
func Promote(l Layout, surface string) Layout
// SwapWithNext exchanges surface with its next neighbor, wrapping; no-op on single/absent.
func SwapWithNext(l Layout, surface string) Layout
// Close removes surface and collapses the shape (3→2 split-h, 2→1 single).
// ErrLayoutLastTile when the layout has one tile; ErrSurfaceAbsent when absent.
func Close(l Layout, surface string) (Layout, error)
// Add appends surface and grows the shape (1→2 split-h, 2→3 main-left).
// ErrLayoutFull at 3 tiles; ErrSurfaceRepeat when a non-tty surface is already open;
// ErrUnknownSurface for a kind outside the registry.
func Add(l Layout, surface string) (Layout, error)
// Cycle returns the next same-arity preset, order kept (arity 1 cycles to itself).
func Cycle(l Layout) Layout
// SetShape jumps to shape within the current arity; ErrArityMismatch otherwise.
func SetShape(l Layout, shape string) (Layout, error)
```

Where the TS returns `null`, the Go returns a named sentinel error (the CLI maps them to exit 1 with the message; the `/options` validator does not call these). `layoutspec_test.go` gains a table per verb **mirroring `surface-layout.test.ts` case-for-case** (same inputs, same expected outputs — the test names cite the TS case so a future drift is greppable).

### `cmd/rk/tab.go` — the family parent

```go
// rk tab — the tab-state command family (docs/specs/ui-state.md § rk tab): every
// verb resolves an address, performs one or two tmux option writes (or a
// new-window), and prints the resulting address on stdout. Substrate only — works
// with rk serve down. Persistent -L/--server inherited by every member (the rk mux
// pattern); default = the caller's own server from $TMUX, else "default".
var tabCmd = &cobra.Command{Use: "tab", Short: "Drive a tab's UI state — layout, web tabs, code root — from the shell", …}
```

Registered on `rootCmd` beside `presentCmd`/`muxCmd` (`root.go:78-79`). Members: `new`, `layout`, `web` (sub-family: `add`, `rm`, `select`, `ls`), `code` (sub-family: `set`), `show`. Arg-count violations on every nested member are wrapped with `usageArgs` (the `code.go` init idiom) so they exit 2. All verbs honour the toolkit conventions (Constitution § Toolkit Standards; `shll standards principles`): stdout is data (printed even under `--quiet`, via `sink.Dataf`), diagnostics are `sink.Notef`/stderr, exit `0` ok / `1` operational / `2` usage; non-interactive; `--json` where a list/dump is printed.

### `cmd/rk/tab_new.go` — `rk tab new`

```
rk tab new [--session =S] [--cwd DIR] [--name N] [--layout L]      → prints @N
```

- `--session`: `=S` exact form (leading `=` required, `validate.ValidateName` on the rest), or omitted → the caller's current session via `$TMUX_PANE` → `#{session_name}` (inside tmux); outside tmux, the target server's current session (`display-message -p '#{session_name}'`) — the `presentViaNewWindow` rule today.
- `--name`: `validate.ValidateNewName`; default = tmux's own default (no `-n`).
- `--cwd`: passed as the window's start directory; default = the caller's cwd.
- `--layout`: validated with `layoutspec.Parse` **before** creation (exit 2 on a bad value); written as `@rk_win_layout` via the `ops` argument of `tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)` so the window is born with its layout (no second round trip, no un-laid-out tick).
- Prints exactly `@N\n` on stdout.

### `cmd/rk/tab_layout.go` — `rk tab layout`

```
rk tab layout [@N] <shape>:<surface,…>                            # set (validated by layoutspec.Parse; exit 2 when malformed)
rk tab layout [@N] --add <surface> | --rm <surface> | --promote <surface> | --cycle
rk tab layout [@N]                                                 # no mutation: print the effective layout
```

- Exactly one of {positional value, `--add`, `--rm`, `--promote`, `--cycle`} may be given (cobra `MarkFlagsMutuallyExclusive` + a positional-vs-flag check → exit 2).
- Read the current `@rk_win_layout` via `tmux.GetWindowOption`; `""` or unparseable → `layoutspec.Default()` (Constitution II: degrade, never error on a stored value — an unparseable stored value is *replaced* by the verb's result, and a `Notef` says so).
- Apply the mutation; `ErrLayoutFull`/`ErrLayoutLastTile`/`ErrSurfaceAbsent`/`ErrSurfaceRepeat` → exit 1 with the sentinel's message; `ErrUnknownSurface` → exit 2 (a usage error — the surface name is user input).
- Write via `tmux.SetWindowOptions(ctx, windowID, server, []WindowOptionOp{{Key: tmux.LayoutOption, Value: &v}})`. Prints the resulting layout value (`main-left:tty,code,web\n`) on stdout. The read-only form prints the effective layout and exits 0.

### `cmd/rk/tab_web.go` — `rk tab web add|rm|select|ls`

```
rk tab web add    [@N] <target> [--show]                           → prints @N/web/<n>
rk tab web rm     [@N/web/<n> | web/<n> | <n>]
rk tab web select [@N/web/<n> | web/<n> | <n>]
rk tab web ls     [@N] [--json]
```

- **`add`**: `present.ParseTarget(arg, cwd)` → `present.ProbePort` when `target.NeedsProbe()` (exit 1 on unreachable — today's `rk present` behaviour) → `tmux.ReadWebTabFamily` to compute the candidate slot → `tmux.WebAdd(ctx, windowID, server, target.URL(windowID, len(fam.Tabs)+1, server, now), root)` (root = `target.Root` when `target.NeedsRoot()`, else `""`). `tmux.ErrWebTabsFull` → exit 1 `"web tabs full (8) on @N — rm one first"`. Prints `@N/web/<n>\n` where `<n>` is the returned index (an idempotent hit prints the existing slot). The URL itself is NOT printed by this verb (it is the data `rk present` prints — see § `rk present`); a `Notef` on stderr echoes `url: <resolved>` for humans.
- **`--show`** (the spec's "ensure `web` is in the layout, then select"): after the add, read the layout; when `web` is absent, `layoutspec.Add(layout, "web")`; when the layout is already at 3 tiles without `web`, replace the LAST slot (`Order[2]`) with `web` instead of failing (the agent asked to *show* — the least-destructive full-layout resolution; the incumbent slot A is untouched); write `@rk_win_layout` and `tmux.WebSelect(n)` in that order. When `web` is already present only the select happens. `--show` never touches a layout that already contains `web`.
- **`rm`**: `tmux.WebRemove(ctx, windowID, server, n)`; `tmux.ErrWebTabRange` → exit 1 `"no web tab <n> on @N (family has <len>)"`. Prints nothing on success (stdout empty, exit 0). The address forms `@N/web/<n>`, `web/<n>`, `<n>` are all accepted (tabaddr); an address without `<n>` is a usage error (exit 2).
- **`select`**: `tmux.WebSelect`; same range/exit rules as `rm`; prints nothing on success.
- **`ls`**: `tmux.ReadWebTabFamily`; human form is one row per slot, tab-separated `index<TAB>marker<TAB>url` where marker is `*` for the active slot and blank otherwise (`tabwriter`-aligned, the `rk code hosts` idiom); zero tabs prints nothing and exits 0. `--json` prints `{"windowId":"@N","active":2,"tabs":[{"index":1,"url":"…","root":"…"}, …]}` (`root` omitted when empty; `tabs` is `[]` never `null`).

### `cmd/rk/tab_code.go` — `rk tab code set`

```
rk tab code set [@N] <folder>
```

`<folder>` is resolved to an absolute path (`filepath.Abs` against the cwd) and must exist and be a directory (`os.Stat`; exit 1 otherwise — the `present.ParseTarget` file/dir rule). Written as `@rk_win_code_root` via `SetWindowOptions`. Prints the absolute folder on stdout. (No `get` verb — `rk tab show` covers reads.)

### `cmd/rk/tab_show.go` — `rk tab show`

```
rk tab show [@N] [--json]
```

Reads every `@rk_win_*` option of the tab in one `show-options -w -t @N` call (a new `tmux.ShowWindowOptions(ctx, windowID, server) (map[string]string, error)` helper in `internal/tmux`, filtered to the `@rk_win_` prefix — the `GetWindowOption` read counterpart generalised). Human form: `key<TAB>value` rows sorted by key (`tabwriter`), so `rk tab show | grep web_` works; `--json` prints the flat `{"@rk_win_layout":"…", "@rk_win_web_1":"…", …}` object. Unset options are simply absent. Exit 0 even when nothing is set (an empty tab is a state, not an error).

### `rk present` — becomes sugar (`cmd/rk/present.go`)

The verb keeps its `Use`, flags, stdout contract and exit codes, but its body is rewritten in terms of the shared helpers so there is one code path:

- Default arm: `rk present <target>` ≡ `rk tab web add <target> --show` on the caller's own tab — i.e. `ParseTarget` → probe → `WebAdd` → the `--show` layout write → `WebSelect`. **This is a behaviour change** relative to today: `rk present` now WRITES `@rk_win_layout` (adds `web` when absent) and selects the tab. It is the spec's decided contract (§ What Dies: "L3 present auto-open carve-out → `--show` writes the layout"; § Web Tabs: "`rk present <target> ≡ rk tab web add <target> --show`"). The old "never writes the viewer's layout" doc comment on `presentCmd` is deleted.
- `--window[=name]` arm: ≡ `rk tab new --layout single:web [--name]` then the add on the new window (no `--show` needed — `single:web` already shows it). Behaviour unchanged from today except that it goes through the shared `tab new` helper.
- `--notify` unchanged (fail-silent).
- **Stdout stays the resolved URL** (relative for `/present`/`/proxy`, absolute for external) — the existing contract that `rk skill display`, `present_test.go` and callers rely on; `rk tab web add` prints the address instead. The two verbs differ only in what they print.
- Help text (`Short`/`Long`) says: "Alias of `rk tab web add <target> --show` (plus `--window` = `rk tab new --layout single:web` then add, and `--notify`)". `internal/present` is untouched.

### `rk code exec --tab [@N]` (`cmd/rk/code.go`)

New flag on `codeExecCmd` **and** `codeCommandsCmd` (they share the resolver):

```go
codeExecCmd.Flags().StringVar(&codeExecTabFlag, "tab", "",
	"Target the host whose folder is the tab's @rk_win_code_root (default: the caller's own tab; pass @N for another)")
codeExecCmd.Flags().Lookup("tab").NoOptDefVal = presentFlagAuto   // bare --tab = own tab
codeExecCmd.MarkFlagsMutuallyExclusive("tab", "host")
codeExecCmd.MarkFlagsMutuallyExclusive("tab", "folder")
```

Resolution order in `resolveCodeHost` becomes: `--host` → `--tab` → `--folder` → cwd git-toplevel → single-host fallback. The `--tab` arm: resolve the window (own tab via `ownWindowID`, or the given `@N`/`=session:window` on the caller's server), read `@rk_win_code_root` via `tmux.GetWindowOption`; when non-empty set `sel.Folder = codeRoot` and continue into `codebridge.Resolve` (the existing exact-then-longest-prefix folder match at `code.go` — reused, not duplicated); when **empty, fall through** to the `--folder`/cwd default with a `Notef` `"tab @N has no @rk_win_code_root — falling back to the cwd"` (plan: "falls through when empty"). Not inside tmux and no `@N` → exit 1 with the own-tab error. `--tab` is a `--folder` *source*, so `--all` still fans out and ignores it (documented in the flag help).

### Tests

- `internal/tabaddr/tabaddr_test.go`: every accepted form + rejection classes (bad `@N`, unknown surface, `<n>` on non-web, `<n>` out of 1..8, extra segment).
- `internal/layoutspec/layoutspec_test.go`: per-verb tables mirroring `surface-layout.test.ts` case-for-case, plus `Default()`.
- `cmd/rk/tab_*_test.go` on the test-socket harness (`internal/testutil` / the `present_test.go` seam pattern — whichever the existing `mux_*_test.go` use for real-tmux cases): `new` writes `@rk_win_layout` at creation and prints `@N`; `layout` set/add/rm/promote/cycle each round-trip through `show-options`, empty layout treated as `single:tty`, full/last-tile → exit 1, bad surface → exit 2; `web add` idempotent + full → exit 1, `--show` adds `web` (and the 3-tile replace-last case), `rm` renumbers URL+root, `select` bounds, `ls` human + `--json`; `code set` rejects a missing dir; `show` human + `--json`; `-L` foreign server without `@N` → exit 2; outside tmux without `@N` → exit 1.
- `cmd/rk/present_test.go`: keep every existing case; add `TestPresentEquivalentToWebAddShow` asserting that `rk present <t>` and `rk tab web add <t> --show` leave byte-identical `@rk_win_*` state on a fresh window (family, `_active`, `_layout`), and that `rk present` on a `single:tty` window now yields `split-h:tty,web`.
- `cmd/rk/code_test.go`: `--tab` arm — code root set → folder match wins; code root empty → cwd fallback with the note; `--tab` + `--host` → exit 2.
- `help_dump_test.go`'s real-tree test picks up the new family automatically; verify `rk help-dump` includes `tab` with all nested members and that no member lacks `Short`/`Long` (toolkit help-dump standard).
- `app/frontend/tests/e2e/present-auto-expand.spec.ts`: NOT re-pointed to the binary (the e2e rig exposes no `rk` build — Assumption #10); only the stale comment at `:63` ("until `rk present --show`, Change 4") is updated to point at the Go equivalence test.

### Docs + standards (land with this change)

- `docs/site/skill.md` (embedded as `cmd/rk/skill/skill.md` via `scripts/sync-skill.sh`; drift-guarded by `TestSkillEmbedMatchesCanonical`, line-budgeted by `TestSkillBundleWithinLineBudget`): the capabilities map gains `rk tab` (one line per verb group) and demotes `rk present` to "alias of `rk tab web add --show`"; the output/exit-code paragraph covers the family.
- `docs/site/skill/display.md`: rewrite the "You cannot open the tile for the user" paragraph — `rk present`/`--show` now writes the layout; teach `rk tab web ls|select|rm` and `rk tab layout` for the follow-up moves; keep within `TestSkillDisplayWithinLineBudget`.
- `docs/site/skill/code.md`: teach `rk code exec --tab`.
- Toolkit standards pass (`shll standards principles` №1–№9, `help-dump`, `skill`) over the new family: every command has `Short` + `Long`, no prompts, bounded output, stdout/stderr split, `--json` on the two listings.
- `docs/specs/ui-state.md`: flip § `rk tab` and the § Web Tabs `rk present` paragraph from **[planned]** to **[current]**; adjust the header note (line 4–5) accordingly. No other spec edits.
- Memory hydration is the hydrate stage's job (see Affected Memory); the apply stage does not edit `docs/memory/`.

### Out of scope (Change 5, explicitly NOT here)

Dropping `?view|?panel|?layout` translation, the client-side localStorage migration, the n-less `/present/{windowId}/*` route, the legacy migration rows → unset-only, the `rk doctor` legacy-name row. Nothing in `api/`, `internal/snapshot`, `internal/tmux/legacy_options.go` or the frontend `src/` changes in this change.

## Affected Memory

- `run-kit/architecture`: (modify) the CLI subcommand inventory gains the `tab` family (new/layout/web add|rm|select|ls/code set/show) and `present` is described as sugar over `rk tab web add --show`; `cmd/rk/owntab.go` + `internal/tabaddr` in the repository structure.
- `run-kit/code-bridge`: (modify) host resolution order gains the `--tab` arm (`--host` → `--tab` → `--folder` → cwd → single-host), the empty-code-root fall-through, and the `--tab`/`--host`/`--folder` exclusivity.
- `run-kit/ui/lenses-and-layout`: (modify) `rk present` now writes `@rk_win_layout` (adds `web`, selects the tab); the `rk tab layout` verbs share `internal/layoutspec`'s Go port of the TS mutation table; `rk tab web *` are the shell twins of the three web verb routes.
- `run-kit/tmux-sessions`: (modify) the `@rk_win_*` registry rows' writer columns gain `rk tab …` (layout, web_n, web_n_root, web_active, code_root); `ShowWindowOptions` beside `GetWindowOption`/`SetWindowOptions`.
- `run-kit/toolkit-standards`: (modify) skill bundle topics (`skill.md`, `display.md`, `code.md`) updated for the family; help-dump tree gains `tab`.

## Impact

- **Go backend (`app/backend/`)** — new: `internal/tabaddr/` (2 files), `cmd/rk/owntab.go`, `cmd/rk/tab.go`, `tab_new.go`, `tab_layout.go`, `tab_web.go`, `tab_code.go`, `tab_show.go` + tests; modified: `internal/layoutspec/layoutspec.go` (+tests), `internal/tmux/tmux.go` (`ShowWindowOptions`), `cmd/rk/present.go` (body → shared helpers; behaviour change: writes layout), `cmd/rk/present_test.go`, `cmd/rk/code.go` (+`code_test.go`), `cmd/rk/root.go` (register `tabCmd`), `cmd/rk/skill/*.md` (synced embeds).
- **Docs** — `docs/site/skill.md`, `docs/site/skill/display.md`, `docs/site/skill/code.md`, `docs/specs/ui-state.md` status flips.
- **Frontend** — one comment in `tests/e2e/present-auto-expand.spec.ts`. No `src/` changes.
- **API / SSE / snapshot / migration** — untouched. The daemon observes the new writes through the existing 12s safety poll (user-option writes emit no control-mode event — a `Notef` on `--show`/`layout` mentions "visible within ~12s on a quiet server" is NOT added; the existing frontend behaviour is the contract).
- **Behaviour change to flag in the PR**: `rk present <target>` now opens the web tile (writes `@rk_win_layout`) — agents that relied on "present never changes my layout" get the spec'd new contract.
- **Verification gates** (`fab/project/code-quality.md`): `just test-backend`; `just test-frontend` (unchanged, sanity); `scripts/sync-skill.sh` then `go test ./cmd/rk/` for the embed drift guards; `rk help-dump | jq '.root.commands[] | select(.name=="tab")'`; `just build`. e2e: `present-auto-expand` + `web-tabs` specs run once to confirm the comment-only edit is inert.

## Open Questions

None blocking. The one judgment call with more than one defensible answer (`--show` on a 3-tile layout lacking `web`) is recorded as Assumption #7 with a default; `/fab-clarify` can flip it before apply if the user prefers exit 1.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend the existing `internal/layoutspec` (shipped by Change 1 with `Parse`/`String`/`Has`) with the verb port rather than creating a new package | Verified at intake: `app/backend/internal/layoutspec/layoutspec.go` exists and is exactly the table the plan wants shared; a second package would duplicate the grammar | S:85 R:90 A:95 D:95 |
| 2 | Certain | `rk tab` carries a persistent `-L/--server` flag with `rk mux`'s resolution (flag → `$TMUX` socket basename → `default`) and accepts `=session:window` exactly as `tmux.ParsePaneTarget` does; bare `session:window` rejected | Spec § Addressing Grammar: "Session/server qualifiers are exactly `rk mux`'s grammar"; `mux.go` `muxServer()` is the implementation to reuse | S:90 R:85 A:95 D:95 |
| 3 | Certain | `rk present` default arm ≡ `rk tab web add --show` — it now WRITES `@rk_win_layout` (adds `web`) and selects the tab; the old "never writes the layout" comment/doc is removed | Spec § What Dies and § Web Tabs state the equivalence verbatim; plan Change 4 § `rk present` | S:95 R:70 A:90 D:95 |
| 4 | Confident | `rk present` keeps printing the resolved URL on stdout; `rk tab web add` prints the address `@N/web/<n>` (URL echoed to stderr as a note) | Spec gives `web add → prints @N/web/<n>`; the URL is `present`'s documented data contract (`rk skill display`, `present_test.go` `TestPresentURLStillPrintsUnderQuiet`) and callers parse it — changing it would be an unrequested break | S:70 R:80 A:80 D:75 |
| 5 | Confident | `rk tab web rm|select` accept `@N/web/<n>`, `web/<n>` and a bare `<n>` (own tab); `<n>` is bounds-checked 1..8 at parse time (exit 2), range vs the live family at run time (exit 1) | Spec line "`rk tab web rm 2`, not `--name docs`" shows the bare form; parse-time bound mirrors `webSlotSegment`'s `^[1-8]$` gate | S:70 R:90 A:80 D:75 |
| 6 | Confident | An empty/unparseable stored `@rk_win_layout` is treated as `single:tty` by every layout verb (and replaced on write, with a stderr note) | Frontend `effectiveLayout` fallback is `single:tty`; Constitution II degrade rule; the verbs must be usable on a never-laid-out tab | S:75 R:90 A:90 D:85 |
| 7 | Confident | `--show` on a 3-tile layout without `web` replaces the LAST slot (`Order[2]`) with `web` instead of exiting 1; slot A is never touched | Spec says `--show` "ensure[s] web is in the layout (grow through the ordinary table)" but is silent on the full case; `rk present` must keep succeeding on every layout, and the last slot is the least-valuable tile (main-* shapes keep A dominant) | S:45 R:85 A:60 D:45 |
| 8 | Confident | `rk code exec --tab` is a `--folder` SOURCE: resolves `@rk_win_code_root` then reuses `codebridge.Resolve`'s exact/longest-prefix match; empty root falls through to the cwd default with a note; mutually exclusive with `--host` and `--folder`; bare `--tab` = own tab via `NoOptDefVal` | Plan: "one more resolver ahead of `--folder`/cwd … `code.go:98` host-matching reused; falls through when empty"; `NoOptDefVal` is the `present.go` idiom already in the package | S:85 R:85 A:90 D:85 |
| 9 | Confident | `rk tab layout [@N]` with no mutation prints the effective layout (read form); `rk tab show` dumps every `@rk_win_*` via a new `tmux.ShowWindowOptions` (one `show-options -w` call), human `key<TAB>value` rows + `--json` flat object; `rk tab web ls` prints `index<TAB>*<TAB>url` rows + `--json` `{windowId,active,tabs[]}` | Spec grammar lists `show` and `ls` without formats; toolkit principles №2/№9 (stdout data, bounded, `--json` on listings) and the `rk code hosts` tabwriter idiom decide the shape; the read form of `layout` is a zero-cost agent affordance | S:55 R:90 A:80 D:65 |
| 10 | Confident | `present-auto-expand.spec.ts` is NOT re-pointed to invoke `rk present`; the `present ≡ web add --show` equivalence is a Go test on the test socket; only the spec's stale `:63` comment changes | Verified: `scripts/test-e2e.sh`/`e2e-env.sh`/`_tmux.ts` expose no `rk` binary path to Playwright; adding a Go build to the e2e rig is out of this change's scope and the Go test proves the same contract | S:70 R:90 A:85 D:80 |
| 11 | Confident | `rk tab new` session default = caller's current session inside tmux, else the target server's current session (the existing `presentViaNewWindow` rule); `--layout` validated before creation and written at creation via `CreateWindowWithOptionsID`'s `ops` | Reuses the shipped `--window` arm's resolution and the existing signature; born-with-layout avoids an un-laid-out SSE tick | S:80 R:90 A:90 D:85 |
| 12 | Confident | Exit-code mapping: family full / range / last-tile / layout-full / missing dir / not-in-tmux → 1; malformed address, unknown surface, bad `--layout`, flag conflicts, arg counts → 2 | Toolkit Principle 4 + the `present.go`/`code.go` precedent (usage vs operational); spec: "`web add` on a full strip exits 1" | S:80 R:90 A:90 D:85 |
| 13 | Certain | Memory files are hydrated by the hydrate stage, not edited at apply; `docs/specs/ui-state.md` status flips ([planned] → [current]) DO land in this change | fab pipeline ownership (memory = hydrate); spec status banners are the same "docs land with the change" pattern Change 2 used for `window-views.md`/`surface-layout.md` | S:85 R:95 A:95 D:90 |

13 assumptions (4 certain, 9 confident, 0 tentative, 0 unresolved).
