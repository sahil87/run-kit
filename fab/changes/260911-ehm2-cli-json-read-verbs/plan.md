# Plan: CLI JSON read verbs — the D5 envelope, `mux snapshot list --json`, `gui shot --json`, and the `snapshot_list` / `gui_shot` tools

**Change**: 260911-ehm2-cli-json-read-verbs
**Intake**: `intake.md`

## Requirements

Design authority: `docs/specs/mcp.md` (§ Envelope, § Receipts, § Policy table, § Allowlist v1). Every decision D1–D13 in `fab/plans/sahil/26-09-10-rk-mcp.md` is closed; nothing here re-opens one.

### CLI Output: the `--json` envelope

#### R1: One envelope writer on the output sink
`cmd/rk/output.go` SHALL define the single `--json` envelope writer as a method on `outputSink` — `Envelope(result any, err error) error` — plus the `envelopeError{Code, Message, Hint, Reason}` document type (`hint`/`reason` `omitempty`). On `err == nil` it MUST write exactly `{"ok":true,"result":<result>}`; on `err != nil` it MUST write `{"ok":false,"error":{…}}` and, when `result` is non-nil, also carry `"result":<result>` (R5). The document is two-space indented with a trailing newline, written through the sink's data channel (stdout, never gated by `--quiet`), and it is the only bytes the verb writes to stdout. No verb hand-formats an envelope.

- **GIVEN** a verb invoked with `--json` whose work succeeded with document `D`
- **WHEN** it calls `sink.Envelope(D, nil)`
- **THEN** stdout is one JSON object with `ok:true` and `result` deep-equal to `D`, and the method returns `nil`

#### R2: `ok` mirrors the exit code; `code` derives from the existing classifier
The envelope's `error.code` MUST be `"usage"` exactly when `exitCode(err) == 2` and `"operational"` for every other non-zero classification (1, and riff's 3). `error.message` MUST be `err.Error()` — the same text cobra prints to stderr as `Error: …`. `Envelope` MUST return the error (wrapped per R3) so the caller's `RunE` keeps its exit code: `--json` never changes an exit code. No verb in this change sets `hint` or `reason`.

- **GIVEN** a `--json` verb whose `RunE` returns `usageError(errors.New("x"))`
- **WHEN** the process exits
- **THEN** the exit code is 2 and stdout carries `{"ok":false,"error":{"code":"usage","message":"x"}}`

#### R3: Failure envelopes are written centrally in `execute()`
`cmd/rk/root.go` `execute()` SHALL call `rootCmd.ExecuteC()` and, on a non-nil error, write `{"ok":false,"error":{…}}` to the executed command's `OutOrStdout()` **iff** (a) the executed command has a `json` flag whose parsed value is `true` and (b) the error is not already wrapped as an `envelopedError` (the marker `Envelope` returns — a type with `Unwrap() error` and `Error() string` delegating to the inner error, so `exitCode`'s `errors.As` still finds a carried `*exitCodeError`). Verbs therefore change only their success-path encoder call; every early `return err` inside `RunE` gets the envelope for free. The logic MUST live in a pure helper (e.g. `jsonErrorEnvelope(cmd *cobra.Command, err error) bool`) so `root_test.go` can exercise it without `os.Exit`.

- **GIVEN** `rk mux panes --json` against a socket with no tmux server
- **WHEN** `RunE` returns the tmux operational error before its encoder
- **THEN** stdout is `{"ok":false,"error":{"code":"operational","message":<the error text>}}`, stderr carries cobra's `Error:` line as today, and the exit code is 1

- **GIVEN** a verb that already called `sink.Envelope(doc, err)` and returned its result
- **WHEN** `execute()` sees the `envelopedError`
- **THEN** no second document is written

#### R4: Pre-`RunE` usage errors emit no envelope
Flag-parse failures (`FlagErrorFunc`) and `Args`-validator failures occur before the invoked command's flags are resolved; they SHALL keep today's behavior — cobra's stderr error, exit 2, no stdout document. This boundary MUST be stated in the `Envelope` doc comment (the MCP proxy's exit-code fallback classifies it as `usage`).

- **GIVEN** `rk mux panes --json --bogus`
- **WHEN** cobra rejects the unknown flag
- **THEN** stdout is empty and the exit code is 2

#### R5: Verdict-bearing verbs keep their data on the failure branch
`doctor --json` (report, then exit 1 when `!report.OK`), `tab new --json` (identity object, then exit 1 on `ready: gone`), and `code exec --all --json` (per-host array, then exit 1 when any host failed) SHALL emit `{"ok":false,"result":<their document>,"error":{"code":"operational","message":…}}` via `sink.Envelope(doc, verdictErr)`. `ok` still mirrors the exit code; the report the human path treats as the datum is not discarded.

- **GIVEN** `rk doctor --json` on a host where one check fails
- **WHEN** the verb completes
- **THEN** exit is 1, `ok` is `false`, `result` is the full report document, and `error.message` is `one or more dependency checks failed`

### CLI: two read verbs gain `--json`

#### R6: `rk mux snapshot list --json`
The `list` subcommand built by `newSnapshotCmd` (both instances: the `rk mux snapshot list` family member and the hidden deprecated `rk snapshot list` alias) SHALL accept a per-instance `--json` bool. Under `--json` the verb MUST emit, via `sink.Envelope`, an array with one object per `snapshot.Entry` in `Store.List`'s newest-first order, keys exactly `server` (string), `taken_at` (RFC 3339 UTC), `died_at` (RFC 3339 UTC or `null`; `null` ⇔ live row), `audited_kill` (bool), `sessions`, `windows`, `history_count` (ints). An empty store MUST emit `"result": []` (never `null`). The 10-row display cap MUST NOT apply under `--json` (every row is carried; `--all` is accepted and inert). The positional `[<server>]` filter keeps its `ValidateServerName` usage gate and `-L`/`--server` stays rejected by `muxRejectInheritedServerFlag`. The human table is byte-identical to today. `Use` becomes `list [<server>] [--json]` and the parent `Long`'s `list` line mentions `--json`.

- **GIVEN** a store with 14 entries (one died with `AuditedKill`)
- **WHEN** `rk mux snapshot list --json` runs
- **THEN** `result` has 14 objects; the died row has a non-null `died_at` and `audited_kill: true`; live rows have `died_at: null`

#### R7: `rk gui shot --json`
`gui shot` SHALL accept a `--json` bool. Under `--json` the verb MUST emit, via `sink.Envelope`, the object `{"path":<abs PNG path>,"width":W,"height":H,"scale":S,"display":<gui.Status.Display>}` where `width`/`height` are the **source** geometry and `scale` the applied scale — the same three facts the stderr `geometry WxH scale S` line prints — plus `"window":<id>` only when `--window` was given (`omitempty`). The stderr geometry line MUST still print under `--json` (chatter; `--quiet` drops it). Without `--json` stdout stays the bare absolute path, byte-identical to today. Refusals keep their exit codes and messages (the envelope arrives via R3). `Long` gains a `--json` paragraph naming the keys.

- **GIVEN** a reachable GUI on `:10` at 1920×1080 and `--max-width 960 --json`
- **WHEN** the capture succeeds
- **THEN** `result` is `{"path":"/abs/….png","width":1920,"height":1080,"scale":0.5,"display":":10"}` with no `window` key, and stderr carries `geometry 1920x1080 scale 0.5`

### CLI: existing `--json` verbs graduate into the envelope

#### R8: Fifteen verbs wrap their document verbatim
Each of `mux sessions`, `mux panes`, `mux capture`, `mux process`, `status`, `cron list`, `gui status`, `gui windows`, `tab show`, `tab web ls`, `tab new`, `code exec` (single), `code exec --all`, `code hosts`, `doctor`, `daemon status` SHALL replace its success-path `json.Marshal` / `json.NewEncoder` write with `sink.Envelope(doc, nil)` (or `sink.Envelope(doc, verdictErr)` per R5). The document inside `result` MUST be byte-for-byte the verb's current document: no key renames, reordering, or nullability changes. The unwrapped form retires with no compatibility flag. Every existing test that parsed the bare document is updated to read `result` (or to expect the wrapped bytes), and every such test MUST also assert the exit code is unchanged.

- **GIVEN** the `mux panes --json` fixture used by `mux_panes_test.go`
- **WHEN** the verb runs
- **THEN** `result` deep-equals the array the test asserted before this change, `has_agent` still last

#### R9: `code exec --json` nests the bridge response verbatim
`code exec --json` (single host) SHALL wrap the code-bridge `Response` unchanged, so the document reads `{"ok":true,"result":{"ok":true,"result":…}}`; the outer `ok` is rk's, the inner is the bridge's. This removes the accidental collision where the proxy's tier (a) treated the bridge response as an rk envelope. A bridge failure (`!resp.OK`) keeps returning `codeBridgeError` before any stdout write, so under `--json` it surfaces as an R3 error envelope.

- **GIVEN** a stub host answering `{"ok":true,"result":null}`
- **WHEN** `rk code exec x --json` runs
- **THEN** stdout is `{"ok":true,"result":{"ok":true,"result":null}}` (modulo indentation) and exit is 0

### MCP: policy rows and the image mapper

#### R10: The `snapshot_list` policy row
`internal/mcp/policy.go` `Table` SHALL gain a row `Tool:"snapshot_list", Path:"mux snapshot list"` with args: an optional positional-1 string `server` (pattern `^[a-zA-Z0-9_-]{1,64}$` mirroring `validate.serverNamePattern` + `MaxServerNameLength`, description naming the store-wide default), then `jsonLiteral`. It MUST NOT include `serverArg` (`-L`): the verb rejects the inherited flag at runtime while the drift guard would still resolve it. `Result: ResultJSON`, `Annotations: readOnlyAnn`, default timeout, and a `Description` override (the verb has no `Long`; the parent's help describes unexposed `show`/`restore`).

- **GIVEN** the row and a call `{server:"runkit"}`
- **WHEN** argv is built
- **THEN** it is `["mux","snapshot","list","runkit","--json"]`; a call `{server:"bad name"}` is rejected by `ValidateArgs` before exec

#### R11: The `gui_shot` policy row
`Table` SHALL gain a row `Tool:"gui_shot", Path:"gui shot"` with args `{Name:"max_width", Flag:"--max-width", Type:ArgInteger, Minimum:1}` and `jsonLiteral`; `Result: ResultImage`, `Annotations: readOnlyAnn`, default timeout, and a `Description` override stating that the tool returns an image block plus `{path,width,height,scale,display}` and that `--out`/`--scale`/`--window` are not exposed. `--scale` (float64) and `--window` (uint64) MUST NOT be mapped (outside the drift guard's type set); `--out` MUST NOT be mapped (a filesystem path beyond the target rule).

- **GIVEN** the row and a call `{max_width: 800}`
- **WHEN** argv is built
- **THEN** it is `["gui","shot","--max-width","800","--json"]`

#### R12: `mapImageResult` reads the envelope
`internal/mcp/result.go` `mapImageResult` SHALL parse stdout first: if it is an object with a boolean `ok` — `ok:false` ⇒ `mapEnvelope`'s error rendering with no file read; `ok:true` ⇒ take `result.path` (a non-string or missing path is `IsError` naming the field), read the file, require the PNG signature, and return `ImageContent{png}` plus a `TextContent` carrying `result` re-serialized (so `width`/`height`/`scale`/`display` reach the model). Non-envelope stdout keeps today's first-non-empty-line-is-the-path behavior. `mapJSONResult` is unchanged.

- **GIVEN** stdout `{"ok":true,"result":{"path":"<tmp png>","width":8,"height":8,"scale":1,"display":":1"}}`
- **WHEN** `MapResult` runs for a `ResultImage` row
- **THEN** content is one image block and one text block whose JSON has `width: 8`, and `IsError` is false

#### R13: Drift guard, doctor, and e2e reflect twelve tools
`mcp.Resolve(rootCmd, Table)` MUST pass with the two rows. `policy_test.go` `TestTableShape` SHALL pin twelve names (the ten W1 rows, then `snapshot_list`, `gui_shot`); `TestTableSendRow` finds `send` by name; `TestReadOnlyAnnotations` accepts `ResultImage` for `gui_shot` while requiring `ResultJSON` for every other See row. `rk doctor`'s `mcp` note reads `12 tools; all policy rows resolve` (the count is derived; any test pinning `10` moves to `12`). `cmd/rk/mcp_e2e_test.go` SHALL assert the twelve tool names and add one live `snapshot_list` call under a temp `XDG_STATE_HOME` (empty store ⇒ the text content is `[]`, or a seeded entry via `internal/snapshot`'s store API round-trips), proving the envelope unwraps end-to-end. `gui_shot` stays unit-tested (no X display in CI).

- **GIVEN** the twelve-row table
- **WHEN** `go test ./internal/mcp/... ./cmd/rk/...` runs
- **THEN** every drift-guard, shape, and e2e assertion passes

### Consumers and documentation

#### R14: The desktop shell reads the envelope
`app/desktop/src/local-daemon.ts` `parseDaemonStatusRunning` SHALL read the running bit from `.result.daemon.running` when the parsed value is an object with a boolean `ok`, and from `.daemon.running` otherwise (an older `rk` behind a newer shell), preserving the `null` degrade on any other shape. Its unit test covers both shapes plus the `ok:false` envelope (⇒ `null`).

- **GIVEN** stdout `{"ok":true,"result":{"daemon":{"running":true},"port":{…}}}`
- **WHEN** the parser runs
- **THEN** it returns `true`; the bare `{"daemon":{"running":false}}` returns `false`

#### R15: Skill bundle documents the envelope
`docs/site/skill.md` and `docs/site/skill/{mux,cron,code,gui,display,tutorial}.md` (the sources; `scripts/sync-skill.sh` copies them to `app/backend/cmd/rk/skill/` and the drift-guard tests keep both byte-identical) SHALL be updated so every `--json` shape description reads `{"ok":true,"result":…}` around the existing document, executable examples read from `.result` (`cron.md` `jq -r '.result[] | …'`; `tutorial.md`'s capture/restore steps), and new lines document `rk mux snapshot list --json` (mux page, server-ops section) and `rk gui shot --json` (gui page). The sync script MUST be run so the embedded copies match.

- **GIVEN** the edited sources
- **WHEN** `go test ./cmd/rk/...` runs
- **THEN** `TestSkillEmbedMatchesCanonical` and its display sibling pass

#### R16: Spec column, envelope sentence, and the fab-kit follow-up row
`docs/specs/mcp.md` SHALL be edited within the pickup protocol's allowances only: § Allowlist v1 "Structured today" → `yes` for `snapshot_list` (verb `mux snapshot list [server] --json`) and `gui_shot` (`gui shot --json → image block`); § Envelope gains one sentence recording R5's `ok:false` + `result` + `error` form for verdict-bearing verbs and adds `tab new` to the list of verbs that already emit `--json`. `fab/backlog.md` gains one row tagged `[fab-kit follow-up]`: make fab's `rk … --json` readers (`pane_map.go` `parseRKPanes`, `fab-operator.md`'s `rk mux sessions --json` step, any `cron list` reader) envelope-aware — accept `{"ok":true,"result":<doc>}` and the bare doc, read `error.message` on `ok:false`. No decision D1–D13 is touched.

- **GIVEN** the edited spec
- **WHEN** a reader checks the allowlist table
- **THEN** only the two "Structured today" cells and the § Envelope prose changed

### Non-Goals

- Changing any verb's default (non-`--json`) output, exit codes, or the human tables/paths — D5.
- A compatibility flag or dual emission for the bare document — spec § Envelope retires the unwrapped form outright.
- Enveloping pre-`RunE` usage errors (flag parse, arg count) — R4 boundary.
- Exposing `gui shot`'s `--scale`, `--window`, or `--out` over MCP, or extending the drift guard's type set — a later row edit.
- `hint`/`reason` values on any verb — W2b's `send`/`await` receipts own them.
- fab-kit's reader changes — cross-repo follow-up (R16's backlog row).
- Wrapping `help-dump`, the `agent setup` marker files, or HTTP payload marshals — not `--json` verbs.

### Design Decisions

#### Central failure envelope via `ExecuteC`
**Decision**: `execute()` uses `rootCmd.ExecuteC()` to learn the executed command and writes the `ok:false` envelope when that command's `json` flag is true and the error is not already enveloped.
**Why**: fifteen verbs have many early `return err` sites; one hook covers every `RunE` failure path and keeps verbs' edits to the success encoder. `ExecuteC` is the only cobra API that returns the executed command.
**Rejected**: per-verb `RunE` wrappers (a wrapper per registration site, and each still needs a "written already" signal); a package-level `envelopeWritten` flag (hidden global state, test-order hazards); a `PersistentPreRun` recorder (`desktop` already defines its own `PersistentPreRunE`, which would shadow it).
*Introduced by*: 260911-ehm2-cli-json-read-verbs

#### `envelopedError` as the stateless "already written" marker
**Decision**: `Envelope` returns the verb's error wrapped in `envelopedError{err}` (with `Unwrap`); `execute()` skips the central write when `errors.As` finds it.
**Why**: the signal rides the error value that already flows to `execute()`; `exitCode`'s `errors.As` for `*exitCodeError` keeps working through `Unwrap`, so exit codes are untouched.
**Rejected**: a bool on the sink or package (state), or having verbs return `nil` after writing an `ok:false` document (changes the exit code — forbidden).
*Introduced by*: 260911-ehm2-cli-json-read-verbs

#### Verdict-bearing verbs carry `result` beside `error`
**Decision**: `doctor`, `tab new` (gone), and `code exec --all` emit `ok:false` with both `result` and `error`.
**Why**: their exit-1 is a verdict over data the human path already prints as the datum; `ok` must still mirror the exit code (D5), and dropping the report would make `--json` strictly worse than the bare form.
**Rejected**: exit 0 with an `ok:true` envelope (changes exit codes); dropping the report (loses the datum); a separate `verdict` top-level key (a synonym for `ok`).
*Introduced by*: 260911-ehm2-cli-json-read-verbs

#### `gui_shot` exposes only `max_width`
**Decision**: the tool's sole optional input is `max_width` → `--max-width`.
**Why**: `--scale` is a `float64` pflag and `--window` a `uint64`, both outside the drift guard's `bool`/`int`/`int64`/`string` compatibility set; window ids are undiscoverable without the tier-two `gui windows` tool; `--out` is a filesystem path outside the target rule, and the proxy returns the bytes anyway.
**Rejected**: widening the drift guard's type set now (scope creep for one input); exposing `--out` (path input).
*Introduced by*: 260911-ehm2-cli-json-read-verbs

## Tasks

### Phase 1: Setup

- [x] T001 Add `envelopeError`, `envelopedError` (with `Unwrap`/`Error`), and `outputSink.Envelope(result any, err error) error` to `app/backend/cmd/rk/output.go` (two-space indented, trailing newline, `code` from `exitCode`, `result` carried on failure only when non-nil; doc comment states the pre-`RunE` boundary). Unit tests in `output_test.go`: success shape, usage vs operational code, failure with and without `result`, returned error still classifies via `exitCode`. <!-- R1, R2, R4, R5 -->
- [x] T002 Switch `execute()` in `app/backend/cmd/rk/root.go` to `rootCmd.ExecuteC()` and add the pure helper that writes the `ok:false` envelope to the executed command's stdout when its `json` flag is true and the error is not an `envelopedError`. Tests in `root_test.go`: json-flagged operational error → envelope on stdout; json-flagged usage error → `code:"usage"`; already-enveloped error → no second write; no `json` flag → no write. <!-- R3 -->

### Phase 2: Core Implementation

- [x] T003 `--json` on `mux snapshot list` in `app/backend/cmd/rk/snapshot.go` (per-instance flag in `newSnapshotCmd`, a `snapshotListJSONRow` type with the seven snake_case keys, RFC 3339 UTC, `[]` when empty, cap bypass, `Use`/parent `Long` text). Tests in `snapshot_test.go`: 14-entry store (one audited tombstone) → 14 rows with the right nulls; empty store → `[]`; `--all` inert under `--json`; human table unchanged; `-L` still rejected. <!-- R6 -->
- [x] T004 `--json` on `gui shot` in `app/backend/cmd/rk/gui_shot.go` (result struct `{path,width,height,scale,display,window?}`, `Envelope` on success, stderr geometry line retained, `Long` paragraph). Tests in `gui_shot_test.go`: root capture with `--max-width` → keys and values; `--window` → `window` key present; bare-path tests untouched and still exact. <!-- R7 -->
- [x] T005 [P] Wrap the `rk mux` family: `mux_sessions.go:116`, `mux_panes.go:191`, `mux_capture.go:214`, `mux_process.go:284` → `sink.Envelope(doc, nil)`; update `mux_sessions_test.go`, `mux_panes_test.go`, `mux_capture_test.go`, `mux_process_test.go` to unwrap `result` and assert exit codes. <!-- R8 -->
- [x] T006 [P] Wrap `status.go:74` and `cron_list.go:190`; update `status_test.go`, `cron_list_test.go`. <!-- R8 -->
- [x] T007 [P] Wrap `gui.go:512` (`gui status`) and `gui_window.go:131` (`gui windows`); update `gui_test.go`, `gui_window_test.go`. <!-- R8 -->
- [x] T008 [P] Wrap the `rk tab` family: `tab_show.go:59`, `tab_web.go:417`, and `tab_new.go:289` (verdict-bearing: `sink.Envelope(out, reportErr)` so `gone` carries `result` + `error`); update `tab_test.go`. <!-- R5, R8 -->
- [x] T009 [P] Wrap `code.go`: single `code exec --json` (`:484`, bridge `Response` nested verbatim), `code exec --all --json` (`:549`, verdict-bearing with the "at least one host failed" error), `code hosts --json` (`:572`); update `code_test.go` and adjust the `--json` flag usage text. <!-- R5, R8, R9 -->
- [x] T010 [P] Wrap `doctor.go:726` (verdict-bearing: `sink.Envelope(report, err)` where `err` is non-nil iff `!report.OK`) and `daemon_status.go:127`; update `doctor_test.go`, `daemon_test.go`. <!-- R5, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Append the `snapshot_list` and `gui_shot` rows to `app/backend/internal/mcp/policy.go` (no `serverArg` on `snapshot_list`; `max_width` only on `gui_shot`; both `readOnlyAnn`; description overrides as constants). Update `policy_test.go`: twelve names in order, `send` found by name, `ResultImage` allowed for `gui_shot` only; add `BuildArgv` cases for both rows and a `ValidateArgs` rejection of a bad server name. <!-- R10, R11, R13 -->
- [x] T012 Teach `mapImageResult` in `app/backend/internal/mcp/result.go` the envelope (`ok:false` → error; `ok:true` → `result.path` → PNG check → image block + result JSON text; bare path kept as fallback). Tests in `result_test.go`: enveloped success against a temp PNG (text block carries `width`), enveloped failure (no file read), missing/non-string `path`, legacy bare path. <!-- R12 -->
- [x] T013 Update `app/backend/cmd/rk/mcp_e2e_test.go` to assert twelve tool names and add the live `snapshot_list` call under a temp `XDG_STATE_HOME` (empty store `[]`, or a seeded entry via `internal/snapshot`), and move any `10 tools` pin in `doctor_test.go` / `mcp_test.go` to `12`; run `just test-backend` and confirm `rk doctor` reports `12 tools; all policy rows resolve`. <!-- R13 -->
- [x] T014 [P] Update `parseDaemonStatusRunning` in `app/desktop/src/local-daemon.ts` to read `.result.daemon.running` for an envelope (object with boolean `ok`; `ok:false` → `null`) and `.daemon.running` for the bare form; extend its unit test with all three shapes. <!-- R14 -->

### Phase 4: Polish

- [x] T015 Update the skill sources `docs/site/skill.md`, `docs/site/skill/{mux,cron,code,gui,display,tutorial}.md` (envelope around every `--json` shape, `.result` in the `jq`/tutorial examples, new `rk mux snapshot list --json` and `rk gui shot --json` lines) and run `scripts/sync-skill.sh`; confirm `TestSkillEmbedMatchesCanonical` passes. <!-- R15 -->
- [x] T016 [P] Edit `docs/specs/mcp.md` (two "Structured today" cells, the § Envelope verdict-bearing sentence, `tab new` in the already-`--json` list) and append the `[fab-kit follow-up]` row to `fab/backlog.md` for envelope-aware `rk … --json` readers. <!-- R16 -->
- [x] T017 Run the verification gates in order: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`; record known environmental e2e failures (if any) by name in the result summary without investigating them. <!-- R8, R13 -->

## Execution Order

- T001 blocks everything in Phase 2 (all wraps call `sink.Envelope`); T002 is independent of T001's tests but should land before T005–T010 so their error-path assertions hold.
- T003 and T004 block T011 (the drift guard needs `--json` to exist on both verbs).
- T011 and T012 block T013.
- T005–T010 are parallel (disjoint files); T014 and T016 are parallel with everything after T002.
- T015 after T003/T004 (it documents their flags); T017 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `outputSink.Envelope` exists in `cmd/rk/output.go`, writes exactly one indented document to the data channel, and no verb formats an envelope by hand
- [x] A-002 R3: `execute()` uses `ExecuteC` and writes the `ok:false` envelope for a `--json` command's `RunE` error exactly once
- [x] A-003 R6: `rk mux snapshot list --json` (both command instances) emits the seven-key rows, `[]` when empty, every row regardless of the cap
- [x] A-004 R7: `rk gui shot --json` emits `{path,width,height,scale,display[,window]}` inside the envelope and keeps the stderr geometry line
- [x] A-005 R8: all fifteen listed verbs emit the envelope with their prior document verbatim inside `result`
- [x] A-006 R10: the `snapshot_list` row exists with a positional `server` (pattern `^[a-zA-Z0-9_-]{1,64}$`), `--json` literal, no `-L` input, read-only annotations, and a description override
- [x] A-007 R11: the `gui_shot` row exists with `max_width` → `--max-width` (min 1), `--json` literal, `ResultImage`, read-only annotations, and a description override; no `scale`/`window`/`out` input
- [x] A-008 R12: `mapImageResult` returns image + result-JSON text for an enveloped success, an error for an enveloped failure, and still accepts a bare path line
- [x] A-009 R14: `parseDaemonStatusRunning` handles the envelope, the bare form, and `ok:false`
- [x] A-010 R15: every `--json` mention in the skill sources reflects the envelope; the mux and gui pages document the two new flags; embedded copies are byte-identical to the sources
- [x] A-011 R16: `docs/specs/mcp.md` shows `yes` in both "Structured today" cells, the § Envelope sentence and `tab new` addition are present, and `fab/backlog.md` carries the fab-kit follow-up row

### Behavioral Correctness

- [x] A-012 R2: `error.code` is `usage` for exit-2 errors and `operational` otherwise; `error.message` equals the error text; every `--json` path's exit code is unchanged from before the change (asserted in the updated tests)
- [x] A-013 R5: `doctor --json` with a failing check, `tab new --json` with `ready: gone`, and `code exec --all --json` with a failed host each emit `ok:false` with both `result` and `error`, exit 1
- [x] A-014 R9: `code exec --json` (single) nests the bridge `Response` under `result` unchanged, so the outer `ok` is rk's
- [x] A-015 R13: `rk doctor` reports `12 tools; all policy rows resolve`; `mcp.Resolve(rootCmd, Table)` passes

### Scenario Coverage

- [x] A-016 R6: test covers a 14-entry store with one audited tombstone and an empty store
- [x] A-017 R7: tests cover root capture with `--max-width` and a `--window` capture under `--json`; the bare-path tests are unchanged and pass
- [x] A-018 R13: the MCP e2e lists twelve tools and completes a live `snapshot_list` call whose text content is the unwrapped `result`
- [x] A-019 R10: `BuildArgv` yields `["mux","snapshot","list","runkit","--json"]` for `{server:"runkit"}` and `["gui","shot","--max-width","800","--json"]` for `{max_width:800}`

### Edge Cases & Error Handling

- [x] A-020 R3: a `--json` verb failing before its encoder (dead tmux socket, missing pane) produces an `ok:false` envelope on stdout, cobra's `Error:` line on stderr, and the original exit code
- [x] A-021 R4: `rk mux panes --json --bogus` writes nothing to stdout and exits 2
- [x] A-022 R12: an enveloped success whose `result.path` is missing, non-string, unreadable, or not a PNG is `IsError` naming the problem, never a panic
- [x] A-023 R6: a bad positional server name under `--json` is a usage error (exit 2) with no stdout document (pre-`RunE` boundary via `usageArgs`/validator, or an R3 envelope if validation runs inside `RunE` — either way exit 2)

### Code Quality

- [x] A-024 Pattern consistency: new code follows the `cmd/rk` seam/`newSink` idioms and the `internal/mcp` row/test style; no bare `os.Stdout`
- [x] A-025 No unnecessary duplication: one envelope writer; wrapped verbs reuse it; `mapImageResult` reuses `mapEnvelope` for the failure branch
- [x] A-026 Tests alongside: every touched behavior has a colocated `_test.go` / `.test.ts` covering it, and all tests run through `just` recipes
- [x] A-027 Comment discipline: comments state constraints (the pre-`RunE` boundary, why no `-L` on `snapshot_list`, why `max_width` only), not narration or change ids
- [x] A-028 No default-output change: every human-path assertion in the touched tests still passes unchanged

### Security

- [x] A-029 R10: the `server` input's schema pattern rejects anything `ValidateServerName` would, before exec; no new shell strings or path inputs reach a subprocess

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (the envelope writer, two `--json` flags, two policy rows) without making existing code redundant; the per-verb hand-rolled `json.Encoder`/`json.MarshalIndent` blocks it replaced were removed in the same diff, leaving no orphaned helpers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `Envelope` indents with two spaces (the `mux sessions`/`tab new` encoder style) rather than compact `json.Marshal`; at the rebase onto W3a its compact `JSONResult`/`JSONError` became wrappers over the same indented encoder | Both styles exist in `cmd/rk`; the proxy parses either; indentation is the more common existing `--json` form | S:55 R:95 A:80 D:60 |
| 2 | Confident | The central error writer is a pure helper taking `(*cobra.Command, error)` and returning whether it wrote, called from `execute()` | Keeps `os.Exit` out of the testable path, mirroring `exitCode`'s pure-function design | S:60 R:90 A:85 D:75 |
| 3 | Confident | `snapshot list --json`'s server-name usage error stays bare (exit 2, no document) because validation runs inside `RunE` and returns `usageError` — which R3 *would* envelope; either outcome satisfies A-023 as written | The validator is inside `RunE` today, so the R3 hook fires and emits `code:"usage"`; the acceptance item accepts both | S:55 R:90 A:80 D:60 |
| 4 | Confident | The e2e `snapshot_list` call seeds the store through `internal/snapshot`'s exported store API when a simple write path exists, else asserts the empty `[]` | Either proves the envelope unwraps; seeding is nicer but not required | S:55 R:90 A:75 D:65 |
| 5 | Certain | Tests run only through `just` recipes and `go test` inside `just test-backend`; the e2e suite's known environmental failures are listed, not investigated | Project context and constitution Test Integrity | S:90 R:95 A:95 D:95 |
| 6 | Confident | Pre-RunE failures (flag-parse via the root `FlagErrorFunc`, Args validators via `usageArgs`) are tagged with a `preRunError` marker in `root.go`, and `jsonErrorEnvelope` skips errors carrying it — a third condition beyond R3's (a)/(b) | pflag applies flags sequentially, so `--json` reads true even when a later flag fails parsing, and Args validators run after successful flag parsing: the R3 conditions alone would wrongly envelope `rk mux panes --json --bogus`, violating R4/A-021. The tag rides the error value (like `envelopedError`), keeps `exitCode` and stderr text unchanged, and is verified by `TestJSONErrorEnvelope_FlagParseFailureStaysBare` | S:70 R:90 A:85 D:75 |
| 7 | Confident | `guiShotJSONResult.Window` is a plain `uint64` with `omitempty` (not a pointer), set only under `--window` | A real X window id is never 0, and `--window 0` fails in `guiShotCapture` ("not a window") before the receipt is written, so zero-omit is exact and the struct stays comparable for test assertions | S:60 R:85 A:80 D:60 |
| 8 | Confident | The `-L` rejection test drives `runRootArgs` (which calls `rootCmd.Execute()`, not `execute()`), so the `--json` + `-L` case asserts the bare usage error/exit 2 with no envelope; the enveloped form of that in-RunE `usageError` in production is covered by assumption 3 and the `root_test.go` R3 tests | `runRootArgs` is the existing seam for full-tree argv runs; duplicating `execute()`'s central-writer coverage in `snapshot_test.go` would re-test T002's contract | S:55 R:85 A:75 D:55 |
| 9 | Confident | Wrapped-verb tests that parse the document share one helper — `unwrapEnvelopeResult(t, stdout, &v)` in `output_test.go` (parses the envelope, fails unless ok:true with no error key, unmarshals `result` into v); tests that pinned raw bytes instead expect the wrapped, two-space-indented bytes (the document gains one indent level inside `result`) | T003/T004 introduced no shared unwrap helper (snapshot_test uses a per-verb typed struct); one helper keeps the R8 updates mechanical and lets later wrap tasks (T008–T010) reuse it; byte-pin tests keep their exact-byte strength by pinning the envelope too | S:60 R:85 A:80 D:60 |
| 10 | Confident | Verbs whose old write path wrapped the encode error (`status`, `gui status`, `gui windows` — the "encoding …: %w" returns) keep that message around `Envelope`'s returned error; the mux verbs keep the bare encode error as before | Only the final write call changes; the encode-failure message is existing behavior and `Envelope` returns encode errors unwrapped by design | S:55 R:85 A:75 D:55 |
| 11 | Confident | In updated success-path tests the unchanged exit code is asserted as `err == nil` with the failure message phrased "want exit 0"; failure-path tests already asserted their codes and were not touched | `runMuxCmd`/`runCronCmd` return the `RunE` error and `exitCode(nil) == 0`, so an `err != nil` fatal pins exit 0 without a redundant `exitCode` call | S:55 R:85 A:75 D:55 |
| 12 | Confident | "Nested verbatim" for the `code exec --json` bridge `Response` (R9) means key-for-key, not byte-for-byte: `Envelope`'s two-space indent re-indents a nested `json.RawMessage`, so the R9 test asserts the inner result semantically (unmarshal and compare) rather than pinning compact bytes | `encoding/json` re-indents RawMessage values inside an indented document; the plan's "modulo indentation" already blesses whitespace drift, and re-marshaling preserves every key and value | S:55 R:90 A:80 D:60 |
| 13 | Confident | The new `BuildArgv`/`ValidateArgs` cases for the `snapshot_list` and `gui_shot` rows live in `exec_test.go` (driving the shipped `Table` rows by name), not `policy_test.go` | `BuildArgv` tests already live in `exec_test.go`; the plan named `policy_test.go` only for the shape/send/annotation pins, which did move there | S:55 R:85 A:75 D:55 |
| 14 | Confident | `mapImageResult` parses stdout for the envelope before the exit-code check, so an `ok:false` envelope wins over a non-zero exit (no `exit <n>: <stderr>` rendering) — symmetric with `mapJSONResult`'s "on a non-zero exit the envelope still wins"; the e2e seeds the store via `snapshot.NewStore` + `Store.Write` with one session/one window and strips any inherited `XDG_STATE_HOME` before appending the temp one | R12 says "reuse `mapEnvelope`'s error rendering", which the exit-first order would have bypassed; a duplicate `XDG_STATE_HOME` env entry would be ambiguous to the child process | S:60 R:85 A:80 D:65 |

14 assumptions (1 certain, 13 confident, 0 tentative).
