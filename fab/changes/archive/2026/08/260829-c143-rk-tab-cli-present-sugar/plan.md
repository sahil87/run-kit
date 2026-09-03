# Plan: CLI — `rk tab` Family, `rk present` as Sugar, `rk code exec --tab`

**Change**: 260829-c143-rk-tab-cli-present-sugar
**Intake**: `intake.md`

## Requirements

### CLI: Tab Address Grammar (`internal/tabaddr`)

#### R1: Address parsing is pure and strict
`internal/tabaddr.Parse(s) (Addr, error)` SHALL parse the tab-relative grammar `@N[/<surface>[/<n>]]` into `Addr{WindowID, Surface, Index}` with no tmux or I/O. It MUST accept exactly: `""` (empty Addr), `@N`, `@N/<surface>`, `@N/web/<n>`, `<surface>`, `web/<n>`, and a bare integer `<n>` (shorthand for `web/<n>`). `@N` MUST satisfy `validate.ValidateWindowID`; `<surface>` MUST be a `layoutspec` surface kind; `<n>` MUST only follow `web` and satisfy `1 ≤ n ≤ tmux.MaxWebTabs`. Anything else (fourth segment, empty segment, `<n>` on a non-web surface, `<n>` out of range) MUST return an error. `Addr.String()` MUST round-trip every accepted form.

- **GIVEN** `"@12/web/3"` **WHEN** parsed **THEN** `Addr{WindowID:"@12", Surface:"web", Index:3}` and `String()` returns `"@12/web/3"`
- **GIVEN** `"2"` **WHEN** parsed **THEN** `Addr{Surface:"web", Index:2}` (own tab)
- **GIVEN** `"@1/web/9"` or `"@1/tty/2"` or `"@1/web/3/x"` **WHEN** parsed **THEN** an error is returned

### CLI: Own-Tab and Server Resolution (`cmd/rk/owntab.go`)

#### R2: One shared resolver for the caller's tab and server
`cmd/rk/owntab.go` SHALL hold `ownWindowID(ctx) (windowID, server, err)` (the `$TMUX_PANE` → `display-message -pt <pane> '#{window_id}'` path plus `callerContext()`'s socket-basename server derivation, both extracted from `present.go`) and `resolveTabWindow(ctx, addr, serverFlag) (windowID, server, err)`. Server resolution MUST follow `rk mux`'s rule: `-L` flag → `$TMUX` socket basename → `default`. When `-L` names a server and `addr.WindowID` is empty, the verb MUST fail with a usage error (exit 2). `=session:window` MUST be accepted wherever `@N` is (resolved via one `display-message -pt =session:window '#{window_id}'`); a bare `session:window` MUST be rejected as `tmux.ParsePaneTarget` rejects it. Outside tmux with no `@N`, the resolver MUST return an operational error (exit 1) whose message says to pass `@N`. `present.go` MUST use the extracted helpers (no duplicate implementation) and its existing `present*Fn` seams MUST keep working.

- **GIVEN** `$TMUX_PANE=%3` on socket `/tmp/tmux-1000/rk-x` **WHEN** `resolveTabWindow(ctx, Addr{}, "")` **THEN** the window id of `%3` on server `rk-x`
- **GIVEN** `-L other` and an empty address **WHEN** resolved **THEN** exit 2 `"@N is required when --server names another server"`
- **GIVEN** no `$TMUX_PANE` and an empty address **WHEN** resolved **THEN** exit 1 naming the fix

### Layout: Verb Port (`internal/layoutspec`)

#### R3: Go verbs mirror the frontend mutations case-for-case
`internal/layoutspec` SHALL gain `Default()` (= `single:tty`), `Promote`, `SwapWithNext`, `Close`, `Add`, `Cycle`, `SetShape`, plus the `growthShape` (1→2 `split-h`, 2→3 `main-left`), `collapseShape` (3→2 `split-h`, 2→1 `single`) and `shapeRing` (1:[single]; 2:[split-h,split-v]; 3:[row,col,main-left,main-right,main-top]) tables, ported from `app/frontend/src/lib/surface-layout.ts:150-160,424-497`. Where the TS returns `null` the Go MUST return a named sentinel: `ErrLayoutFull`, `ErrLayoutLastTile`, `ErrSurfaceAbsent`, `ErrSurfaceRepeat`, `ErrUnknownSurface`, `ErrArityMismatch`. Tests MUST mirror `surface-layout.test.ts`'s verb cases one-for-one (same inputs and outputs), naming the TS case in the Go test name. The package MUST stay pure.

- **GIVEN** `single:tty` **WHEN** `Add(l, "web")` **THEN** `split-h:tty,web`
- **GIVEN** `split-h:tty,web` **WHEN** `Add(l, "code")` **THEN** `main-left:tty,web,code`
- **GIVEN** `main-left:tty,web,code` **WHEN** `Close(l, "web")` **THEN** `split-h:tty,code`; **WHEN** `Promote(l, "code")` **THEN** `main-left:code,tty,web`; **WHEN** `Cycle(l)` **THEN** `main-right:tty,web,code`
- **GIVEN** `single:tty` **WHEN** `Close(l, "tty")` **THEN** `ErrLayoutLastTile`; **WHEN** `Cycle(l)` **THEN** `single:tty`
- **GIVEN** `main-left:tty,web,code` **WHEN** `Add(l, "chat")` **THEN** `ErrLayoutFull`

### CLI: `rk tab` Family

#### R4: Family parent and conventions
`cmd/rk/tab.go` SHALL register `tabCmd` on `rootCmd` (beside `presentCmd`/`muxCmd`) with a persistent `-L/--server` flag and members `new`, `layout`, `web` (`add`, `rm`, `select`, `ls`), `code` (`set`), `show`. Every member MUST carry `Short` and `Long`; nested members' `Args` MUST be wrapped with `usageArgs` (exit 2 on arg-count errors). Every verb MUST work with `rk serve` down (tmux-only), write data to stdout via `sink.Dataf` (survives `--quiet`) and diagnostics via `sink.Notef`/stderr, and MUST NOT prompt.

- **GIVEN** `rk help-dump` **WHEN** inspected **THEN** `tab` appears with every nested member, each with non-empty `short`/`long`
- **GIVEN** `rk tab web add` with no target **WHEN** run **THEN** exit 2

#### R5: `rk tab new`
`rk tab new [--session =S] [--cwd DIR] [--name N] [--layout L]` SHALL create a window via `tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)` and print exactly `@N\n`. `--session` MUST use the `=S` exact form (`validate.ValidateName` on `S`); absent → the caller's session (`#{session_name}` of `$TMUX_PANE`) inside tmux, else the target server's current session. `--name` MUST pass `validate.ValidateNewName`. `--layout` MUST be validated with `layoutspec.Parse` before creation (exit 2 when malformed) and written as `@rk_win_layout` in the creation `ops` (born with its layout).

- **GIVEN** `rk tab new --layout split-h:tty,web` inside tmux **WHEN** run **THEN** stdout is `@N`, and `show-options -wv -t @N @rk_win_layout` is `split-h:tty,web`
- **GIVEN** `--layout bogus` **WHEN** run **THEN** exit 2 and no window is created

#### R6: `rk tab layout`
`rk tab layout [@N] <L>` SHALL validate `L` with `layoutspec.Parse` (exit 2) and write `@rk_win_layout`. `--add S` / `--rm S` / `--promote S` / `--cycle` SHALL read the current option (`""`/unparseable → `layoutspec.Default()`, with a stderr note when an unparseable value is being replaced), apply the matching `layoutspec` verb, and write the result. Exactly one of {positional, `--add`, `--rm`, `--promote`, `--cycle`} MAY be given (exit 2 otherwise). With no positional and no flag the verb SHALL print the effective layout and exit 0. `ErrLayoutFull`/`ErrLayoutLastTile`/`ErrSurfaceAbsent`/`ErrSurfaceRepeat` → exit 1; `ErrUnknownSurface` → exit 2. On every write the resulting layout value is printed on stdout.

- **GIVEN** a window with no `@rk_win_layout` **WHEN** `rk tab layout @N --add web` **THEN** the option is `split-h:tty,web` and stdout is `split-h:tty,web`
- **GIVEN** `main-left:tty,web,code` **WHEN** `--add chat` **THEN** exit 1; **WHEN** `--rm code` **THEN** `split-h:tty,web`
- **GIVEN** `rk tab layout @N` **WHEN** run on an unset window **THEN** stdout `single:tty`, exit 0, option untouched

#### R7: `rk tab web add [--show]`
`rk tab web add [@N] <target> [--show]` SHALL resolve `<target>` via `present.ParseTarget(arg, cwd)`, probe with `present.ProbePort` when `target.NeedsProbe()` (exit 1 on failure), read the family with `tmux.ReadWebTabFamily`, and call `tmux.WebAdd(ctx, windowID, server, target.URL(windowID, len(fam.Tabs)+1, server, now), root)` (root = `target.Root` iff `target.NeedsRoot()`). It MUST print `@N/web/<n>\n` (the returned index; an idempotent hit prints the existing slot) and echo `url: <resolved>` to stderr. `tmux.ErrWebTabsFull` → exit 1. With `--show`, after the add it MUST ensure `web` is in `@rk_win_layout`: absent and < 3 tiles → `layoutspec.Add`; absent at 3 tiles → replace `Order[2]` with `web` (slot A untouched); present → no layout write; then `tmux.WebSelect(n)`.

- **GIVEN** a window with 0 tabs and layout unset **WHEN** `rk tab web add @N :8080 --show` (port listening) **THEN** stdout `@N/web/1`; `@rk_win_web_1=/proxy/8080/`, `_active=1`, `_layout=split-h:tty,web`
- **GIVEN** the same URL added again **WHEN** run **THEN** stdout `@N/web/1`, family unchanged
- **GIVEN** 8 tabs **WHEN** a new URL is added **THEN** exit 1 and the family is unchanged
- **GIVEN** layout `main-left:tty,code,chat` **WHEN** `--show` **THEN** layout becomes `main-left:tty,code,web`

#### R8: `rk tab web rm|select`
`rk tab web rm <addr>` and `rk tab web select <addr>` SHALL accept `@N/web/<n>`, `web/<n>`, and bare `<n>`; an address without `<n>` is a usage error (exit 2). `rm` calls `tmux.WebRemove`, `select` calls `tmux.WebSelect`; `tmux.ErrWebTabRange` → exit 1 with a message naming `<n>` and the family length. Both print nothing on success.

- **GIVEN** tabs `[A,B,C]`, active 3 **WHEN** `rk tab web rm @N/web/2` **THEN** tabs `[A,C]`, roots shifted, active 2, stdout empty, exit 0
- **GIVEN** tabs `[A]` **WHEN** `rk tab web select 3` (own tab) **THEN** exit 1

#### R9: `rk tab web ls`
`rk tab web ls [@N] [--json]` SHALL print one `tabwriter`-aligned row per slot: `index<TAB>marker<TAB>url` with `*` marking the active slot; zero tabs prints nothing, exit 0. `--json` prints `{"windowId":"@N","active":<n>,"tabs":[{"index":1,"url":"…","root":"…"}]}` with `root` omitted when empty and `tabs` always an array (never `null`).

- **GIVEN** tabs `[A,B]` active 2 **WHEN** `ls` **THEN** two rows, `*` on row 2; **WHEN** `ls --json` **THEN** `active:2`, two tab objects
- **GIVEN** zero tabs **WHEN** `ls --json` **THEN** `"tabs":[]`

#### R10: `rk tab code set`
`rk tab code set [@N] <folder>` SHALL resolve `<folder>` to an absolute path, require it to exist and be a directory (exit 1 otherwise), write `@rk_win_code_root`, and print the absolute path.

- **GIVEN** an existing dir `./x` **WHEN** set **THEN** `@rk_win_code_root` is its absolute path and stdout matches
- **GIVEN** a missing path **WHEN** set **THEN** exit 1, option untouched

#### R11: `rk tab show`
`rk tab show [@N] [--json]` SHALL read every `@rk_win_*` option of the window in one call through a new `tmux.ShowWindowOptions(ctx, windowID, server) (map[string]string, error)` (`show-options -w -t @N`, filtered to the `@rk_win_` prefix; `-q` semantics — an unset window yields an empty map, not an error). Human form: `key<TAB>value` rows sorted by key; `--json`: a flat object. Empty is exit 0.

- **GIVEN** `_layout` and `_web_1` set **WHEN** `show` **THEN** two sorted rows; **WHEN** `--json` **THEN** `{"@rk_win_layout":…,"@rk_win_web_1":…}`
- **GIVEN** nothing set **WHEN** `show` **THEN** empty stdout, exit 0

### CLI: `rk present` as Sugar

#### R12: `rk present` is implemented by the shared tab helpers
`rk present <target>` SHALL be exactly `rk tab web add <target> --show` on the caller's own tab (ParseTarget → probe → WebAdd → the R7 `--show` layout write → WebSelect), and `rk present --window[=name] <target>` SHALL be `rk tab new --layout single:web [--name]` followed by the add on the new window — both through the same Go helpers the `tab` verbs call (one code path, no duplicated attach logic). Flags, `--notify`, exit codes and the **stdout contract (the resolved URL)** are unchanged. The `presentCmd` doc comment and `Long` MUST be rewritten to describe the alias (deleting the "never writes the viewer's layout" text) and MUST state the alias relationship. `internal/present` is untouched.

- **GIVEN** a fresh `single:tty` window and `rk present :8080` from a pane in it **WHEN** run **THEN** stdout `/proxy/8080/`, `@rk_win_layout=split-h:tty,web`, `_web_1=/proxy/8080/`, `_active=1`
- **GIVEN** two identical fresh windows **WHEN** `rk present <t>` runs on one and `rk tab web add <t> --show` on the other **THEN** their `@rk_win_*` option sets are byte-identical (modulo the window id embedded in `/present/` URLs)

### Code Bridge: `--tab`

#### R13: `rk code exec --tab [@N]`
`codeExecCmd` and `codeCommandsCmd` SHALL gain `--tab` (string, `NoOptDefVal` = the `presentFlagAuto` sentinel so bare `--tab` means the own tab), mutually exclusive with `--host` and `--folder`. `resolveCodeHost`'s order becomes `--host` → `--tab` → `--folder` → cwd git-toplevel → single-host fallback. The `--tab` arm resolves the window (R2), reads `@rk_win_code_root` via `tmux.GetWindowOption`; non-empty → `sel.Folder = codeRoot` and the existing `codebridge.Resolve` match applies; empty → fall through to the cwd default with a `Notef` `"tab @N has no @rk_win_code_root — falling back to the cwd"`. Not in tmux with no `@N` → exit 1. `--all` ignores `--tab` (documented in the flag help).

- **GIVEN** `@rk_win_code_root=/w/proj` and a live host for `/w/proj` **WHEN** `rk code exec --tab @N x.y` from `/elsewhere` **THEN** the `/w/proj` host is chosen
- **GIVEN** an empty code root **WHEN** `--tab @N` **THEN** the note prints and the cwd default resolves
- **GIVEN** `--tab --host h1` **WHEN** run **THEN** exit 2

### Docs and Standards

#### R14: Skill bundles, help-dump, spec status
`docs/site/skill.md`, `docs/site/skill/display.md`, and `docs/site/skill/code.md` SHALL be updated (`rk tab` capabilities + `rk present` demoted to "alias of `rk tab web add --show`"; the "You cannot open the tile for the user" paragraph replaced; `rk code exec --tab` taught), then synced into `cmd/rk/skill/` with `scripts/sync-skill.sh` so `TestSkill*EmbedMatchesCanonical` and `TestSkill*WithinLineBudget` pass. `docs/specs/ui-state.md` SHALL flip § `rk tab` and the § Web Tabs `rk present` paragraph from **[planned]** to **[current]** and adjust the header note. `app/frontend/tests/e2e/present-auto-expand.spec.ts:63`'s stale "until `rk present --show`, Change 4" comment SHALL point at the Go equivalence test instead. No `docs/memory/` edits at apply (hydrate owns them).

- **GIVEN** the synced embeds **WHEN** `go test ./cmd/rk/ -run TestSkill` **THEN** pass
- **GIVEN** `docs/specs/ui-state.md` **WHEN** grepped for `[planned]` **THEN** neither the `rk tab` section heading nor the `rk present` paragraph carries it

### Non-Goals

- Change 5 cleanup: dropping `?view|?panel|?layout` translation, the localStorage one-shot migration, the n-less `/present/{windowId}/*` route, the legacy migration rows, the `rk doctor` legacy-name row — none of it here.
- New API routes, `api/` changes, `internal/snapshot`, `internal/tmux/legacy_options.go`, or frontend `src/` changes — the backend contract and UI shipped in Changes 1–3 are consumed, not modified.
- Re-pointing `present-auto-expand.spec.ts` to invoke the `rk` binary (the e2e rig exposes none); the equivalence is a Go test.
- A `rk tab code get` verb (`rk tab show` covers reads); `rk tab web` title/name addressing (indices only, v1).

### Design Decisions

#### `rk present` keeps the URL as stdout data while `rk tab web add` prints the address
**Decision**: `rk present` prints the resolved URL; `rk tab web add` prints `@N/web/<n>` and echoes the URL on stderr.
**Why**: the URL is `present`'s documented, parsed contract (`rk skill display`, `TestPresentURLStillPrintsUnderQuiet`); the spec assigns the address to `web add`. Two verbs, one code path, two data outputs.
**Rejected**: printing both lines from both verbs (stdout stops being one datum); making `present` print the address (unrequested break).
*Introduced by*: 260829-c143-rk-tab-cli-present-sugar

#### `--show` on a full 3-tile layout replaces the last slot
**Decision**: when `web` is absent and the layout already holds 3 tiles, `--show` writes `web` into `Order[2]` instead of exiting 1.
**Why**: `rk present` must keep succeeding on every layout (it did before — it never touched the layout); the last slot is the least valuable tile in every 3-tile shape and slot A stays dominant.
**Rejected**: exit 1 (regresses `present`); replacing slot A (steals the user's main tile).
*Introduced by*: 260829-c143-rk-tab-cli-present-sugar

#### Verb port lives in the existing `internal/layoutspec`
**Decision**: extend `internal/layoutspec` (shipped by Change 1) with the mutations rather than a new package.
**Why**: one Go table for shapes/surfaces/arity already exists and the `/options` validator uses it; a sibling package would duplicate the grammar and could drift.
**Rejected**: new `internal/layoutverbs` package.
*Introduced by*: 260829-c143-rk-tab-cli-present-sugar

#### `--tab` is a `--folder` source, not a new host selector
**Decision**: `--tab` resolves `@rk_win_code_root` into `Selector.Folder` and reuses `codebridge.Resolve`'s exact/longest-prefix match.
**Why**: the plan says to reuse `code.go`'s host matching; the folder IS the host identity the bridge already uses.
**Rejected**: a new `Selector.WindowID` field with its own matcher (duplicates the folder logic).
*Introduced by*: 260829-c143-rk-tab-cli-present-sugar

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/tabaddr/tabaddr.go` (`Addr`, `Parse`, `String`) per R1, validating `@N` with `validate.ValidateWindowID`, surfaces against `layoutspec` (export an `IsSurface(kind string) bool` on layoutspec if no exported check exists), and `<n>` against `tmux.MaxWebTabs` — mind import cycles: tabaddr may import `layoutspec` and `validate`; if importing `tmux` for `MaxWebTabs` cycles, hoist the constant or take it as a package-level var <!-- R1 -->
- [x] T002 [P] Create `app/backend/internal/tabaddr/tabaddr_test.go`: table tests for every accepted form (incl. round-trip `String()`) and each rejection class <!-- R1 -->
- [x] T003 [P] Extend `app/backend/internal/layoutspec/layoutspec.go` with `Default`, `Promote`, `SwapWithNext`, `Close`, `Add`, `Cycle`, `SetShape`, the `growthShape`/`collapseShape`/`shapeRing` tables, the six sentinel errors, and an exported surface-kind check <!-- R3 -->
- [x] T004 [P] Extend `app/backend/internal/layoutspec/layoutspec_test.go` with per-verb tables mirroring `app/frontend/src/lib/surface-layout.test.ts` case-for-case (test names cite the TS case) <!-- R3 -->
- [x] T005 [P] Add `ShowWindowOptions(ctx, windowID, server) (map[string]string, error)` to `app/backend/internal/tmux/tmux.go` beside `GetWindowOption` (`show-options -w -t @N`, `@rk_win_` filter, empty map when unset) + a test in `tmux_test.go`/`webtabs_test.go` on the test socket <!-- R11 -->

### Phase 2: Core Implementation

- [x] T006 Create `app/backend/cmd/rk/owntab.go`: move `callerContext()` and the `$TMUX_PANE` → window-id read out of `present.go` into `ownWindowID` + `resolveTabWindow` (with the `-L`-without-`@N` usage error, `=session:window` support via `tmux.ParsePaneTarget`, and the outside-tmux operational error); re-point `present.go` at them, keeping `present*Fn` seams and `present_test.go` green <!-- R2 -->
- [x] T007 Create `app/backend/cmd/rk/tab.go`: `tabCmd` parent with persistent `-L/--server`, `web`/`code` sub-parents, `usageArgs` wrapping of every nested member, registration in `root.go` beside `presentCmd` <!-- R4 -->
- [x] T008 Create `app/backend/cmd/rk/tab_new.go` (`rk tab new`) per R5, reusing the session-resolution rule from `presentViaNewWindow` (extract a shared helper so both use it) and `tmux.CreateWindowWithOptionsID` with the layout in `ops` <!-- R5 -->
- [x] T009 Create `app/backend/cmd/rk/tab_layout.go` (`rk tab layout`) per R6: read → `layoutspec.Default()` fallback → verb → `SetWindowOptions`; read-only form; sentinel → exit-code mapping <!-- R6 -->
- [x] T010 Create `app/backend/cmd/rk/tab_web.go` with a shared `webAddShow(ctx, windowID, server, target, show bool) (index int, url string, err error)` helper implementing R7 (ParseTarget/probe/WebAdd/`--show` layout ensure incl. the 3-tile replace-last rule/WebSelect) and the `add` verb printing `@N/web/<n>` + stderr `url:` note <!-- R7 -->
- [x] T011 Add `rm`, `select`, `ls` (+`--json`) verbs to `app/backend/cmd/rk/tab_web.go` per R8/R9 (tabaddr address forms, `tabwriter` rows, JSON shape with `tabs: []`) <!-- R8, R9 -->
- [x] T012 [P] Create `app/backend/cmd/rk/tab_code.go` (`rk tab code set`) per R10 <!-- R10 -->
- [x] T013 [P] Create `app/backend/cmd/rk/tab_show.go` (`rk tab show [--json]`) per R11 over `tmux.ShowWindowOptions` <!-- R11 -->
- [x] T014 Rewrite `app/backend/cmd/rk/present.go` bodies (`presentAttach` → `webAddShow(..., true)` on the own tab; `presentViaNewWindow` → the `tab new` helper with `single:web` then the add) so present is sugar per R12; keep URL stdout, `--notify`, exit codes; rewrite the file doc comment + `Long`/`Short` to state the alias <!-- R12 -->
- [x] T015 Add `--tab` to `codeExecCmd` and `codeCommandsCmd` in `app/backend/cmd/rk/code.go` per R13: `NoOptDefVal` sentinel, mutual exclusivity with `--host`/`--folder`, the resolver arm in `resolveCodeHost` (own tab / `@N` → `GetWindowOption(@rk_win_code_root)` → `sel.Folder`, empty → note + fall through), help text noting `--all` ignores it <!-- R13 -->

### Phase 3: Integration & Edge Cases

- [x] T016 Create `app/backend/cmd/rk/tab_test.go` (+ per-verb files as needed) on the test-socket harness used by `webtabs_test.go`/`mux_*_test.go`: `new` (layout at creation, bad `--layout` exit 2), `layout` (set/add/rm/promote/cycle round-trips, unset → `single:tty`, full/last-tile → 1, bad surface → 2, read-only form), `web add` (idempotent, full → 1, `--show` grows layout and the 3-tile replace-last case, stdout `@N/web/<n>`), `rm` (renumbers URL+root, repoints active), `select` bounds, `ls` human + `--json` (incl. empty `[]`), `code set` missing dir → 1, `show` human + `--json` + empty, `-L` foreign without `@N` → 2, outside tmux → 1 <!-- R4, R5, R6, R7, R8, R9, R10, R11 -->
- [x] T017 Extend `app/backend/cmd/rk/present_test.go`: keep all existing cases green; add `TestPresentEquivalentToWebAddShow` (byte-identical `@rk_win_*` state on two fresh windows) and `TestPresentShowsWebTile` (`single:tty` → `split-h:tty,web`) <!-- R12 -->
- [x] T018 [P] Extend `app/backend/cmd/rk/code_test.go`: `--tab` arm — code-root match wins over cwd; empty root falls through with the note; `--tab` + `--host` → exit 2; outside tmux without `@N` → exit 1 (use the `codeTargetFolderFn`/tmux seams) <!-- R13 -->
- [x] T019 [P] Verify `rk help-dump` covers the `tab` tree (every member has `Short`+`Long`); run `go test ./cmd/rk/ -run 'TestBuildDump|TestCaptureNode|TestNodeFields'` and `go vet ./...` <!-- R4 -->

### Phase 4: Polish

- [x] T020 Update `docs/site/skill.md`, `docs/site/skill/display.md`, `docs/site/skill/code.md` per R14 (rk tab capabilities, present demoted to alias, the "cannot open the tile" paragraph replaced with `--show`/`rk tab layout` guidance, `rk code exec --tab`), run `scripts/sync-skill.sh`, and confirm `go test ./cmd/rk/ -run TestSkill` (embed drift + line budgets) passes <!-- R14 -->
- [x] T021 [P] Flip `docs/specs/ui-state.md` § `rk tab` and the § Web Tabs `rk present` paragraph to **[current]**, adjust the header note (lines 4–5); update the stale comment at `app/frontend/tests/e2e/present-auto-expand.spec.ts:63` to cite the Go equivalence test <!-- R14 -->
- [x] T022 Run the verification gates: `just test-backend`; `just test-frontend`; `just build`; `just test-e2e "present-auto-expand"` and `just test-e2e "web-tabs"` (comment-only e2e edit must stay green — baseline against the memory'd pre-existing failures list before blaming the diff) <!-- R4, R12, R14 -->

## Execution Order

- T001/T003 block T006–T015 (address + verbs are their inputs); T005 blocks T013
- T006 blocks T007–T015 (shared resolver); T010 blocks T011 and T014
- T016–T018 after Phase 2; T019 after T007; T020–T021 independent of each other; T022 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tabaddr.Parse` accepts exactly the enumerated forms and `String()` round-trips them
- [x] A-002 R2: `owntab.go` holds the single own-tab/server resolver; `present.go` has no duplicate copy of the `$TMUX_PANE`/`callerContext` logic
- [x] A-003 R3: `layoutspec` exposes `Default`, `Promote`, `SwapWithNext`, `Close`, `Add`, `Cycle`, `SetShape` with the six sentinels, and stays pure (no tmux/I-O imports)
- [x] A-004 R4: `rk tab` is registered with `new`, `layout`, `web add|rm|select|ls`, `code set`, `show`, all with `Short`+`Long`, present in `rk help-dump`
- [x] A-005 R5: `rk tab new` prints `@N` and writes `--layout` at creation
- [x] A-006 R6: `rk tab layout` set/`--add`/`--rm`/`--promote`/`--cycle`/read-only forms all work and print the resulting value
- [x] A-007 R7: `rk tab web add` prints `@N/web/<n>`, is idempotent, exits 1 when full, and `--show` ensures `web` in the layout then selects the tab
- [x] A-008 R8: `rk tab web rm|select` accept `@N/web/<n>`, `web/<n>`, `<n>` and delegate to `WebRemove`/`WebSelect`
- [x] A-009 R9: `rk tab web ls` human rows + `--json` object with `tabs: []` never `null`
- [x] A-010 R10: `rk tab code set` validates the directory and writes `@rk_win_code_root`
- [x] A-011 R11: `rk tab show` dumps every `@rk_win_*` via `tmux.ShowWindowOptions`, human + `--json`
- [x] A-012 R12: `rk present` default and `--window` arms are implemented through the `tab` helpers; stdout is still the URL; `--notify` unchanged
- [x] A-013 R13: `rk code exec|commands --tab` resolves via `@rk_win_code_root`, falls through when empty, is exclusive with `--host`/`--folder`
- [x] A-014 R14: skill bundles updated + synced, `ui-state.md` status flipped, e2e comment updated

### Behavioral Correctness

- [x] A-015 R12: `rk present <target>` on a `single:tty` window now yields `split-h:tty,web` and `_active` pointing at the added slot (the documented behaviour change), and the old "never writes the layout" doc text is gone
- [x] A-016 R7: `--show` on `main-left:tty,code,chat` yields `main-left:tty,code,web` (slot A untouched)
- [x] A-017 R6: an unset `@rk_win_layout` is treated as `single:tty`; an unparseable stored value is replaced with a stderr note, never an error

### Scenario Coverage

- [x] A-018 R3: `layoutspec_test.go` mirrors every `surface-layout.test.ts` verb case one-for-one (grep the TS names in the Go test)
- [x] A-019 R12: `TestPresentEquivalentToWebAddShow` asserts byte-identical `@rk_win_*` state between the two verbs
- [x] A-020 R5–R11: `tab_*_test.go` exercises every verb on a real test socket, including the `-L`-foreign-without-`@N` and outside-tmux paths
- [x] A-021 R13: `code_test.go` covers match-wins, empty-root fall-through with note, and the exclusivity error

### Edge Cases & Error Handling

- [x] A-022 R1: `@1/web/9`, `@1/tty/2`, `@1/web/3/x`, `@x` all fail to parse
- [x] A-023 R7: 9th distinct URL → exit 1 with a "full" message and an unchanged family
- [x] A-024 R8: out-of-range `<n>` → exit 1 naming `<n>` and the family length; missing `<n>` → exit 2
- [x] A-025 R2: outside tmux with no `@N` → exit 1 whose message says to pass `@N`; `-L other` without `@N` → exit 2
- [x] A-026 R4: arg-count violations on nested members exit 2 (usageArgs wrapping)

### Code Quality

- [x] A-027 Pattern consistency: new `cmd/rk` files follow the `present.go`/`code.go` conventions (package-level `*Fn` seams, `newSink` Dataf/Notef split, `usageError`/exit codes, cobra `Long` with the `See 'rk … --help'` idiom)
- [x] A-028 No unnecessary duplication: web-tab logic goes through `tmux.WebAdd/WebRemove/WebSelect/ReadWebTabFamily`; target resolution through `internal/present`; grammar through `internal/layoutspec`; no second copy of the own-tab resolver
- [x] A-029 Subprocess hygiene: every new tmux call goes through `internal/tmux` helpers with `exec.CommandContext` + timeout (Constitution I, § Process Execution); no shell strings
- [x] A-030 No comment narration: new comments state constraints/contracts, not the next line; no change-id/PR citations in code comments
- [x] A-031 Tests included for every new verb and the `--tab` arm; `just test-backend` green; `just build` green
- [x] A-032 Toolkit standards: stdout data / stderr diagnostics, non-interactive, `--json` on listings, bounded output, `Short`+`Long` on every command (Principles 1–4, 9; help-dump standard)

### Security

- [x] A-033 R1: every user-supplied `@N`, session, window name, surface and folder is validated (`validate.*`, `layoutspec`, `os.Stat`) before reaching a tmux argv

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The `web-view-lens` e2e failures at :194/:412/:444/:521 are pre-existing on main (memory) — not caused by this change.

## Deletion Candidates

- `presentRunOutputFn` (`cmd/rk/present.go:88`) — orphaned seam: every production read moved to `ownTabRunOutputFn` (owntab.go); only `present_test.go:114` still touches it
- `presentCreateWindowIDFn` (`cmd/rk/tab_new.go:60`) — creation seam duplicated as `tabCreateWindowIDFn` (tab_new.go:64); present.go no longer references the original, only the tab alias
- `TestTabWebRmRenumbersAndRepoints` debug `t.Logf` (`cmd/rk/tab_test.go:405`) — leftover option dump from development

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `tabaddr` takes the surface registry from `layoutspec` (exporting a small `IsSurface` check) and the tab cap from `tmux.MaxWebTabs`; if the `tmux` import cycles, the cap is hoisted to a `tabaddr` constant asserted equal in a test | Keeps one source per table; the cycle risk is real (`tmux` imports `present`), so the fallback is spelled out | S:70 R:90 A:85 D:80 |
| 2 | Confident | `rk tab layout` read-only form (no args) prints the effective layout | Zero-cost affordance; spec grammar lists no read verb for layout but `show` covers everything, so this is additive not conflicting | S:55 R:95 A:85 D:70 |
| 3 | Confident | `rk tab web add` echoes `url: <resolved>` on stderr as a note | Humans running the verb want the URL; stdout stays a single datum per Principle 2 | S:60 R:95 A:85 D:75 |
| 4 | Confident | `--tab` is also added to `rk code commands` (same resolver) | `codeCommandsCmd` shares `resolveCodeHost`; omitting it would make the two verbs resolve differently | S:65 R:90 A:90 D:80 |
| 5 | Certain | e2e `present-auto-expand.spec.ts` changes are comment-only; verification via Go tests | Intake Assumption #10 — no `rk` binary in the e2e rig | S:85 R:95 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
