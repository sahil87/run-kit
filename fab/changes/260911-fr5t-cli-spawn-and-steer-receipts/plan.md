# Plan: CLI Spawn and Steer Receipts (rk MCP W2c)

**Change**: 260911-fr5t-cli-spawn-and-steer-receipts
**Intake**: `intake.md`

## Requirements

### CLI: the `--json` envelope on mutating verbs

#### R1: One RunE wrapper emits the failure envelope
`cmd/rk/output.go` SHALL gain `jsonRunE(run func(*cobra.Command, []string) error) func(*cobra.Command, []string) error`. When the wrapped command's `--json` bool flag is set (`cmd.Flags().GetBool("json")` true — local or persistent) and `run` returns a non-nil error, the wrapper MUST write `sink.JSONError(envelopeError{Code, Message: err.Error()})` through `newSink(cmd)` before returning the same error, with `Code = envelopeCodeUsage` when `exitCode(err) == 2` and `envelopeCodeOperational` otherwise. With `--json` unset, or on a nil error, the wrapper MUST be a pass-through. The existing `JSONResult` / `JSONError` / `envelopeError` helpers (merged with PR #945) are consumed; no second envelope helper is added.

- **GIVEN** a command with `--json` set whose `run` returns `usageError(errors.New("bad"))`
- **WHEN** the wrapped RunE runs
- **THEN** stdout carries exactly `{"ok":false,"error":{"code":"usage","message":"bad"}}` + newline and the returned error is the same `bad`

#### R2: Verbs that exit inside RunE emit the envelope before exiting
`runRiffWithExitCode` and `runOperatorWithExitCode` MUST, when their `--json` flag is set and the error is a `*riff.ExitCodeError`, write `sink.JSONError(envelopeError{Code: envelopeCodeOperational (or envelopeCodeUsage when Code == riff.ExitValidation), Message: ece.Msg})` before `os.Exit(ece.Code)`. Non-`ExitCodeError` errors flow through `jsonRunE` as in R1.

- **GIVEN** `rk riff --json` outside tmux and without `-L`
- **WHEN** the precondition fails (exit 1)
- **THEN** stdout carries one `ok:false` operational envelope and the exit code is still 1

#### R3: `mux new` and `mux kill` receipts
`rk mux new <name> [--ephemeral] --json` SHALL print `{"ok":true,"result":{"report":"created","server":"<name>","ephemeral":<bool>}}`; `rk mux kill <target> --json` SHALL print `{"ok":true,"result":{"report":"killed","target":"%N"}}`. Without `--json` both verbs print exactly today's single report line. Exit codes are unchanged; refusals and errors ride R1.

- **GIVEN** an idle pane `%5` and `rk mux kill %5 --json`
- **WHEN** the kill proceeds
- **THEN** stdout is the single envelope document with `result.report == "killed"` and `result.target == "%5"`, and the kill seam was called once

#### R4: `cron add`, `cron rm`, `cron mute` receipts
`rk cron add … --json` SHALL print `result: {"id","name","schedule","target"}` where `schedule` is `cronScheduleSummary(entry.Schedule)` and `target` is `cronTargetSummary(entry.Target)` — the strings the human line prints. `rk cron rm <id> --json` SHALL print `result: {"id":"<id>","removed":true}`. `rk cron mute <id> [--for d] [--off] --json` SHALL print `result: {"id","muted":<bool>,"until":"<RFC3339>"?}` with `until` present only on the `--for` lease (the same `time.RFC3339` string the human line prints) and `muted:false` on `--off`. `cron pin` is unchanged. Human output is byte-identical without `--json`.

- **GIVEN** `rk cron add "check PRs" --every 1h --role operator --json` with `cronDirFn` on a temp dir
- **WHEN** the entry is written
- **THEN** stdout is one envelope with `result.schedule == "every 1h"` and `result.target == "role:operator"` and `result.id` equals the stored entry's id

#### R5: `tab layout`, `tab web add|rm|select|mv`, `tab code set` receipts
`rk tab layout … --json` SHALL print `result: {"window":"@N","layout":"<value>"}` on both the read and every mutating form. `rk tab code set … --json` SHALL print `result: {"window":"@N","code_root":"/abs/path"}`. The four `tab web` mutations SHALL print `result: {"window":"@N","index":<n>,"tabs":[…]}` where `index` is the affected slot (mv: the destination) and `tabs` is the post-mutation family in `tabWebLsJSONEntry` shape (`index`, `url`, `root` omitempty) read through `presentReadFamilyFn`; `add` also carries `url`. A failed read-back MUST be a `Notef` on stderr with `tabs` omitted, never an error. `--json` and `--show` MUST be **persistent** flags on the `tab web` parent (`tabWebCmd.PersistentFlags()`), so the `tab_web` policy row's drift guard resolves them on the parent path; `--show` on `rm`/`select`/`mv` MUST be a usage error (exit 2). `tab layout` and `tab code set` register `--json` on their own flag sets. Human output is byte-identical without `--json`.

- **GIVEN** a window `@3` with two web tabs and `rk tab web rm @3/web/1 --json`
- **WHEN** the removal succeeds
- **THEN** stdout is one envelope with `result.window == "@3"`, `result.index == 1`, and `result.tabs` holding the one remaining entry

#### R6: `gui exec --detach` receipt
`rk gui exec --detach <cmd> [args…] --json` SHALL print `result: {"pid":<n>,"display":":N"}` (the two facts the `started <pid> on <display>` line prints). `--json` without `--detach` MUST be a usage error (exit 2) raised before the OS and reachability gates. The `--json` flag is registered beside `--detach` in `gui.go`'s exec flag block.

- **GIVEN** the GUI reachable (stubbed `guiRequireReachable`) and `rk gui exec --detach --json -- xterm -e top`
- **WHEN** the detached start seam returns pid 4242
- **THEN** stdout is one envelope with `result.pid == 4242` and `result.display` equal to the stub's display, and the exec seam was never called

#### R7: `operator` receipt
`rk operator … --json` SHALL print `result: {"window":"@N","server":"<label>","created":<bool>}` on all three success branches: `created:false` with the singleton's `@N` on both singleton hits (server mode and interactive), `created:true` after `createMarkedOperatorWindow` with the window id resolved via `display-message -t <paneID> -p '#{window_id}'` through the existing `operatorRunOutputFn` seam (server prefix applied in server mode). `server` is the `-L` value in server mode, else `cliServerLabel(originalTMUX)`. The three human lines are unchanged without `--json`; the kickoff-delivery and tick-seed warnings stay on stderr with exit 0.

- **GIVEN** `rk operator -L runKit --json` with an existing operator window `@7` on that server
- **WHEN** the singleton probe hits
- **THEN** stdout is one envelope with `result == {"window":"@7","server":"runKit","created":false}` and no `select-window`/`switch-client` runs

#### R8: `notify` receipt
`sendNotify` SHALL return `bool` (true iff the POST returned 2xx). `rk notify <message> [--title t] --json` SHALL print `result: {"delivered":<bool>}` and exit 0 in every case — the fail-silent contract is unchanged (`SilenceErrors`, `RunE` returns nil); without `--json` the verb prints nothing.

- **GIVEN** no daemon reachable at the resolved origin
- **WHEN** `rk notify hi --json` runs
- **THEN** stdout is `{"ok":true,"result":{"delivered":false}}` + newline and the exit code is 0

#### R9: `riff` receipt and engine results
`internal/riff.Run` SHALL return `([]SpawnReceipt, error)` with `SpawnReceipt{WindowID, WindowName, Server, PaneIDs []string, WorktreePath, Branch string}` — one per spawned window in index order for `--count N`, one for count 1. `PaneIDs` is collected after the split phase with `tmux list-panes -t <windowID> -F '#{pane_id}'` (pane 0 first); `Branch` with `git -C <worktree> rev-parse --abbrev-ref HEAD` (`exec.CommandContext`, 5 s timeout); both best-effort — a failure leaves the field empty/`[paneID]` and never fails the spawn. The daemon `Spawn` path keeps its `Result` shape. `rk riff … --json` SHALL print `result: {"windows":[{"id":"@N","name":"…","server":"<label>","panes":["%N",…],"worktree":"/abs","branch":"…"}]}`; without `--json` the CLI prints nothing on stdout, as today.

- **GIVEN** the riff tmux/wt fakes for a count-1 spawn returning window `@9`, panes `%20`,`%21`, worktree `/tmp/wt/x`
- **WHEN** `rk riff --json` completes
- **THEN** stdout is one envelope whose `result.windows[0]` carries `id "@9"`, `panes ["%20","%21"]`, `worktree "/tmp/wt/x"`

#### R10: `riff` targeting flags
`rk riff` SHALL gain `-L/--server <name>` (waives the `$TMUX` precondition, sets `spec.Server`, validated with `validate.ValidateServerName`), `--session =S` (exact form required, sets `spec.Session` → the engine's existing `new-window -t =<session>:` path; default when `-L` is given and `$TMUX` is unset: the server's current session via `display-message -p '#{session_name}'` on `-L <name>`), and `--repo <dir>` (an absolute or cwd-relative path; MUST satisfy `config.FindGitRoot(abs) == abs`, else usage error; replaces the process-cwd derivation of `repoRoot` for `wt create`, launcher resolution, and preset reads). All three are optional; without them behavior is byte-identical to today. The `-L` server label is what R9's `server` field carries.

- **GIVEN** `$TMUX` unset, `rk riff -L scratch --repo /path/to/repo --json`
- **WHEN** preconditions run
- **THEN** the `$TMUX` check is skipped, `wt` still must be on PATH, `spec.Server == "scratch"`, `spec.RepoRoot == "/path/to/repo"`, and the engine's argv carries `-L scratch`

### MCP: policy-table model extensions

#### R11: String-array inputs
`internal/mcp` SHALL add `ArgStringArray` (`InputSchema` → `{"type":"array","items":{"type":"string"}}`, optional `MaxItems` via a new `Arg.MaxItems *int`). `ValidateArgs` MUST reject a non-array or a non-string element and enforce `MaxItems`. `BuildArgv` MUST emit a repeated flag (`--skill a --skill b`) for a `Flag` array and one argv element per item for a `Positional` array. `checkFlagType` MUST accept pflag types `stringArray`, `stringSlice`, and `skill` for an `ArgStringArray` input.

- **GIVEN** a row `{Name:"skill", Flag:"--skill", Type:ArgStringArray}` and `{"skill":["/a","/b"]}`
- **WHEN** argv is built
- **THEN** it contains `--skill /a --skill /b` in order

#### R12: Formatted positionals
`Arg.Format string` SHALL render a positional's argv token from named schema-only inputs after validation: `{name}` substitutes the input's string value (integers rendered with `strconv.Itoa`), `[…]` is an optional segment dropped when any input inside it is absent. A schema-only input is an `Arg` with neither `Flag`, `Positional`, nor `Literal` and not named by `Stdin`. `Resolve` MUST reject a `Format` naming an input the row lacks. A formatted positional whose required inputs are absent contributes nothing.

- **GIVEN** `{Positional:2, Format:"{window}[/web/{slot}]"}` with inputs `window:"@3"`, `slot:2`
- **WHEN** argv is built
- **THEN** the token is `@3/web/2`; with `slot` absent it is `@3`

#### R13: Ordered argv walk and typed flags
`BuildArgv` SHALL emit a single ordered walk over `Args`: each flag, flag-shaped literal, positional (by slot order, which the seeded rows already match), and bare literal is emitted where it sits in `Args`. The seeded rows' argv MUST stay byte-identical (existing `BuildArgv` tests are the oracle; `board`'s flags still precede its positionals — re-order a row's `Args` if needed, never change the emitted argv). `checkFlagType` MUST additionally accept pflag `duration` for an `ArgString` input (the row supplies a Go-duration pattern) and `int`/`int64` for `ArgInteger` (already true).

- **GIVEN** the `gui_exec` row `[{Literal:"--detach"},{Literal:"--json"},{Literal:"--"},{Name:"command",Positional:1},{Name:"args",Positional:2,Type:ArgStringArray}]`
- **WHEN** argv is built for `{"command":"chromium","args":["--kiosk","https://x"]}`
- **THEN** it is `gui exec --detach --json -- chromium --kiosk https://x`

#### R14: Thirteen W2c policy rows
`Table` SHALL append, after `operator_request`, in this order: `notify`, `riff`, `new_window`, `operator`, `cron_add`, `tab_layout`, `tab_web`, `tab_code`, `code_exec`, `gui_exec`, `kill`, `cron_rm`, `cron_mute` — inputs, patterns, enums, literals, `Result: ResultJSON`, and annotations exactly per intake § 3 (`kill`/`cron_rm` `Destructive:true`; `operator`/`cron_mute` `Idempotent:true`; all others `Annotations{}`), with description overrides for `tab_web`, `riff`, `new_window`, `operator`, `cron_add`, `gui_exec`, `kill`, `notify`. `Resolve(rootCmd, Table)` MUST succeed (`cmd/rk/mcp_test.go`), `TestTableShape`'s want-list MUST be the 25 names in table order, no row exposes `--force`/`--cmd`/`--respawn`/`--ready`, and `rk doctor`'s `mcp` note reads `25 tools; all policy rows resolve`. The `riff` row marks `server` and `repo` required; the `operator` row marks `server` required; `new_window` exposes `server`, `session` (`^=.+$`), `cwd`, `name`, `layout`; `code_exec` exposes `command`, `args` (array), `host`, `tab` (`^@\d+$`), `folder`, `timeout` (duration pattern), `all`.

- **GIVEN** the built `rk` binary
- **WHEN** `rk doctor --json` runs
- **THEN** the `mcp` check is OK with note `25 tools; all policy rows resolve`

#### R15: E2E covers the mutating loop
`cmd/rk/mcp_e2e_test.go` SHALL assert the 25 sorted tool names and, on the isolated server, drive `new_window` (`session:"=boot"`) → `tab_layout` (`layout:"split-h:tty,web"`) → `tab_web` (`action:"add"`, `target:"https://example.com"`) → `kill` (the new window's pane), asserting each receipt's ids chain (`window_id` → `window` → `target`) and that `kill`'s result carries `report:"killed"`; and `cron_add` (`prompt`, `every:"1h"`, `role:"operator"`, the test server) → `cron_mute` (`for:"30m"`) → `cron_rm` under a temp `XDG_STATE_HOME`, asserting the `id` chain; and `notify` returning `{"delivered":false}` with no daemon. `riff`, `operator`, `gui_exec`, `code_exec` are unit-tested only.

- **GIVEN** the e2e harness with tmux and go on PATH
- **WHEN** the mutating loop runs
- **THEN** every call returns `IsError:false` with the chained ids and the created window is gone after `kill`

### Docs: spec, skill bundle, plan

#### R16: Spec fix-ups and skill bundle
`docs/specs/mcp.md` SHALL: flip the "Structured today" column to **yes** for the 12 graduated verbs; correct the `tab new` receipt row to `{"session","window_id","pane_id"[,"ready"]}`; spell out the `mux new`, `tab web`, `tab code set`, `notify`, `operator`, `riff` receipt rows per intake § 2; add `type: array`, `format:`, and the ordered-walk rule to § Policy table and record the shared action-enum shape; add `riff` (`server`+`repo`) and `operator` (`server`) to § Target rule. `docs/specs/ui-state.md` § rk tab usage, `docs/specs/cron.md`, and `docs/specs/gui.md` CLI blocks gain `[--json]` where the in-scope verbs' flags are enumerated. The skill bundle (`app/backend/cmd/rk/skill/skill.md` § Output & exit-code contracts, `mux.md`, `cron.md`, `gui.md`) documents the receipts and `docs/site/skill.md` + `docs/site/skill/*.md` stay byte-identical mirrors. The plan doc `fab/plans/sahil/26-09-10-rk-mcp.md` W2c rows note the `board`-precedent `tab_web` shape (no variant model).

- **GIVEN** the updated bundle
- **WHEN** `diff docs/site/skill.md app/backend/cmd/rk/skill/skill.md` runs (and per topic page)
- **THEN** there is no difference, and `just build` passes

### Non-Goals

- Wrapping pre-existing `--json` verbs (`tab new`, `code exec`, the read verbs) in the envelope — W2a's graduation.
- A `mux new` policy row, `present`, `--respawn`/`if-absent respawn`, `mux kill --force`, `riff --cmd`, `tab new --ready`/`-- CMD` over MCP.
- Resolving the duplicate `Envelope()` W2a's PR #949 adds to `output.go`.
- Any change to default (non-`--json`) CLI output, exit codes, API routes, or the frontend.

### Design Decisions

#### `jsonRunE` wrapper instead of per-return hand-formatting or a root seam
**Decision**: one RunE wrapper in `output.go` emits the failure envelope for any verb whose `--json` flag is set.
**Why**: matches main's per-verb pattern (`operator_request.go`, `board.go` call `JSONError` themselves) while sparing twelve verbs an edit at every `return err`; the two `os.Exit` wrappers call `JSONError` explicitly because no outer wrapper runs after an exit.
**Rejected**: a central `execute()`/`ExecuteC` seam (diverges from the established pattern, and misses the `os.Exit` verbs anyway); hand-formatting per return (twelve verbs × many returns).
*Introduced by*: 260911-fr5t-cli-spawn-and-steer-receipts

#### `tab_web` follows the `board` action-enum shape
**Decision**: `tab_web` is one row on path `tab web` with `action` as positional 1, `--show`/`--json` persistent on the parent, a `Format`-rendered composite positional for `@N/web/<n>`, and per-action requirements enforced by the verb.
**Why**: W3b's `board` row already established the shape; a variant model would be a second mechanism for the same thing.
**Rejected**: `Row.Actions`/`ActionVariant` (duplication); four tools (spec Principle 3 forbids).
*Introduced by*: 260911-fr5t-cli-spawn-and-steer-receipts

#### `riff` gains `-L`/`--session`/`--repo`
**Decision**: three optional CLI flags onto the engine's existing `Server`/`Session`/`RepoRoot` seams; the MCP row requires `server` and `repo`.
**Why**: the MCP executor strips `$TMUX` and runs from the ssh landing directory, so the spec's `riff` tool is unsatisfiable without explicit targeting (D8).
**Rejected**: deferring `riff` (leaves the Spawn intent's flagship tool unshipped); tool-side `$TMUX`/cwd injection (a bypass, spec Principle 1).
*Introduced by*: 260911-fr5t-cli-spawn-and-steer-receipts

## Tasks

### Phase 1: Setup

- [x] T001 Add `jsonRunE` to `app/backend/cmd/rk/output.go` (consume the existing `JSONResult`/`JSONError`/`envelopeError`; code from `exitCode(err)`), with table tests in `output_test.go` covering usage/operational/nil-error/flag-unset paths <!-- R1 -->
- [x] T002 [P] Extend the `internal/mcp` model in `app/backend/internal/mcp/{policy,schema,exec,result}.go`: `ArgStringArray` + `Arg.MaxItems`, `Arg.Format` with `[…]` optional segments and schema-only inputs, the single ordered `BuildArgv` walk (seeded rows' argv byte-identical — re-order `Args` where needed), `checkFlagType` accepting `duration`/`stringArray`/`stringSlice`/`skill`, `Resolve` rejecting a `Format` naming a missing input; unit tests in `exec_test.go`/`schema_test.go`/`result_test.go` <!-- R11, R12, R13 -->

### Phase 2: Core Implementation

- [x] T003 [P] `app/backend/cmd/rk/mux_new.go`, `mux_kill.go`: `--json` flags, `jsonRunE`, receipts `{report,server,ephemeral}` / `{report,target}`; tests in `mux_new_test.go`, `mux_kill_test.go` (human path byte-identical) <!-- R3 -->
- [x] T004 [P] `app/backend/cmd/rk/cron_add.go`, `cron_mut.go`: `--json` on add/rm/mute, `jsonRunE`, receipts per R4 (`until` only on the lease); tests in `cron_add_test.go`, `cron_mut_test.go` <!-- R4 -->
- [x] T005 [P] `app/backend/cmd/rk/tab_layout.go`, `tab_code.go`: `--json` flags, `jsonRunE`, receipts `{window,layout}` / `{window,code_root}`; tests in `tab_test.go` (or new `tab_layout_test.go`/`tab_code_test.go`) <!-- R5 -->
- [x] T006 `app/backend/cmd/rk/tab_web.go`: move `--show` and add `--json` as persistent flags on `tabWebCmd` (usage error for `--show` on rm/select/mv), `jsonRunE` on the four mutations, shared post-mutation family read-back into `tabs` (`Notef` + omit on failure), receipts per R5; tests <!-- R5 -->
- [x] T007 [P] `app/backend/cmd/rk/gui.go` (register `--json` beside `--detach`), `gui_exec.go`: `--json` requires `--detach` (usage, before gates), `jsonRunE`, receipt `{pid,display}`; tests in `gui_exec_test.go` <!-- R6 -->
- [x] T008 [P] `app/backend/cmd/rk/notify.go`: `sendNotify` returns bool, `--json` prints `{delivered}` always exit 0; tests in `notify_test.go` with an httptest server and an unreachable origin <!-- R8 -->
- [x] T009 `app/backend/cmd/rk/operator.go`: `--json` flag, receipt `{window,server,created}` on the three success branches (window id via `display-message -t <pane> -p '#{window_id}'` through `operatorRunOutputFn`), `JSONError` before `os.Exit` in `runOperatorWithExitCode`, `jsonRunE` for plain errors; tests in `operator_test.go` <!-- R7, R2 -->
- [x] T010 `app/backend/internal/riff/riff.go`: `SpawnReceipt`, `Run` returns `([]SpawnReceipt, error)` (count-1 and `runCount` fan-out, index order), pane collection via `list-panes -F '#{pane_id}'`, branch via `git -C <wt> rev-parse --abbrev-ref HEAD` (5 s `exec.CommandContext`, best-effort); keep `Spawn`'s `Result`; update callers; tests in `riff_test.go` <!-- R9 -->
- [x] T011 `app/backend/cmd/rk/riff.go`: `-L/--server`, `--session =S`, `--repo <dir>` (validated per R10, default session on `-L` without `$TMUX`), `--json` receipt `{"windows":[…]}` from the engine receipts, `JSONError` before `os.Exit` in `runRiffWithExitCode`, `jsonRunE` for plain errors; tests in `riff_test.go` (`RK_RIFF_SUBPROC` pattern for the exit paths) <!-- R9, R10, R2 -->

### Phase 3: Integration & Edge Cases

- [x] T012 `app/backend/internal/mcp/policy.go`: append the 13 rows in R14's order with inputs/patterns/enums/literals/annotations and the eight description overrides; update `policy_test.go` (25-name want-list, banned flags `--force`/`--cmd`/`--respawn`/`--ready`, annotation checks for destr/idem rows); confirm `cmd/rk/mcp_test.go` (`Resolve(rootCmd, Table)`) and `doctor_test.go` pass with the new count <!-- R14 -->
- [x] T013 `app/backend/cmd/rk/mcp_e2e_test.go`: 25 sorted names; the `new_window → tab_layout → tab_web add → kill` loop on the isolated server with id chaining; the `cron_add → cron_mute → cron_rm` loop under a temp `XDG_STATE_HOME`; `notify` → `{"delivered":false}` <!-- R15 -->
- [x] T014 Run `just test-backend`; `gofmt -l` clean on every file touched by this change (the 8 files unformatted at HEAD are not yours); fix anything the new tests surface <!-- R1, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15 -->

### Phase 4: Polish

- [x] T015 [P] `docs/specs/mcp.md` fix-ups per R16 (Structured-today column, receipt rows, § Policy table additions, § Target rule); one-token `[--json]` additions in `docs/specs/ui-state.md` § rk tab, `docs/specs/cron.md`, `docs/specs/gui.md` <!-- R16 -->
- [x] T016 [P] Skill bundle: `app/backend/cmd/rk/skill/skill.md` (Output & exit-code contracts bullet + `rk tab` bullets), `mux.md` (`kill`, `new`), `cron.md` (`add`/`rm`/`mute`), `gui.md` (`exec --detach`); mirror byte-identically into `docs/site/skill.md` and `docs/site/skill/*.md`; `just build` passes <!-- R16 -->
- [x] T017 [P] `fab/plans/sahil/26-09-10-rk-mcp.md`: W2c ledger row and § Change breakdown row note the `board`-precedent `tab_web` shape (no variant model) and the merged #945 helper <!-- R16 -->

## Execution Order

- T001 and T002 block Phase 2 (every verb uses `jsonRunE`; T012 needs the model)
- T010 blocks T011
- T003–T011 block T012; T012 blocks T013; T013 blocks T014
- T015–T017 are independent of each other and run after T014

## Acceptance

### Functional Completeness

- [x] A-001 R1: `jsonRunE` exists in `output.go`, emits the usage/operational envelope only when `--json` is set and the error is non-nil, and every W2c verb's RunE goes through it
- [x] A-002 R2: `rk riff --json` and `rk operator --json` write one `ok:false` envelope on their `ExitCodeError` paths before exiting with the original code
- [x] A-003 R3: `mux new --json` and `mux kill --json` print the specified receipts; human lines unchanged
- [x] A-004 R4: `cron add|rm|mute --json` print the specified receipts (`until` only on the lease; `muted:false` on `--off`)
- [x] A-005 R5: `tab layout`, `tab code set`, and the four `tab web` mutations print the specified receipts; `--show`/`--json` are persistent on `tab web`; `--show` on rm/select/mv is exit 2
- [x] A-006 R6: `gui exec --detach --json` prints `{pid,display}`; `--json` without `--detach` is exit 2 before any gate
- [x] A-007 R7: `operator --json` prints `{window,server,created}` on all three success branches with the correct `created`
- [x] A-008 R8: `notify --json` prints `{delivered:bool}` and always exits 0; `sendNotify` returns the 2xx verdict
- [x] A-009 R9: `riff.Run` returns receipts (count 1 and fan-out) with panes and branch; `rk riff --json` prints `{"windows":[…]}`; the daemon `Spawn` path is unchanged
- [x] A-010 R10: `rk riff -L/--session/--repo` behave as specified; without them the verb is byte-identical to today
- [x] A-011 R11: `ArgStringArray` schema, validation, repeated-flag and positional argv mapping, and `checkFlagType` widening exist and are tested
- [x] A-012 R12: `Arg.Format` renders with and without the optional segment; `Resolve` rejects a `Format` naming a missing input
- [x] A-013 R13: `BuildArgv` is a single ordered walk; every seeded row's argv is byte-identical (existing tests pass unchanged)
- [x] A-014 R14: `Table` has the 25 rows in order with the specified inputs, annotations, and overrides; `Resolve(rootCmd, Table)` passes; doctor reports `25 tools`
- [x] A-015 R15: the e2e test asserts 25 tools and drives both mutating loops plus `notify`
- [x] A-016 R16: spec fix-ups, skill bundle, site mirrors, and plan rows are updated as specified

### Behavioral Correctness

- [x] A-017 R5: `tab web` receipts' `tabs` reflect the family after the mutation; a failed read-back is a stderr note, not an error
- [x] A-018 R9: a failed `list-panes` or `rev-parse` leaves `panes`/`branch` degraded without failing the spawn
- [x] A-019 R1: no verb's default (non-`--json`) stdout or exit code changed — existing tests pass unmodified

### Scenario Coverage

- [x] A-020 R14: the `gui_exec` row builds `gui exec --detach --json -- <cmd> <args…>`; the `tab_web` row builds the four documented argv shapes; the `riff` row builds `riff -L <s> --repo <r> [--session =S] [preset] --skill … --json` with no `--cmd`
- [x] A-021 R15: the e2e id chain `window_id → window → target` holds and the killed window is gone

### Edge Cases & Error Handling

- [x] A-022 R6: `gui exec --json` without `--detach` exits 2 with a usage message and an `ok:false` usage envelope
- [x] A-023 R10: `--repo` pointing at a non-toplevel directory is a usage error; `--session` without the `=` form is a usage error
- [x] A-024 R11: a `MaxItems` overflow and a non-string element are rejected by `ValidateArgs` with messages naming the input

### Code Quality

- [x] A-025 Pattern consistency: new code follows the `*Fn` seam, `newSink`, `usageError`, and `exec.CommandContext`-with-timeout patterns of surrounding code
- [x] A-026 No unnecessary duplication: no second envelope helper; `tabWebLsJSONEntry` reused for `tabs`; `cronScheduleSummary`/`cronTargetSummary` reused
- [x] A-027 Tests: every changed behavior has a Go test alongside its file; `just test-backend` passes
- [x] A-028 No shell strings: every new subprocess is an argv `exec.CommandContext` with a timeout (Constitution I)
- [x] A-029 Comments state constraints, not narration; no change-ids in code comments

### Security

- [x] A-030 R14: no policy row exposes `--force`, `--cmd`, `--respawn`, `--ready`, or a shell string; `riff`'s `repo` is validated as a git toplevel by the verb before use

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

The two redundancies this change created were removed in the same diff — no leftover candidates:

- `positionalArgs` (`app/backend/internal/mcp/exec.go`) — subsumed by the single ordered `BuildArgv` walk; deleted in-diff.
- The inline tab-entry loop in `runTabWebLs` (`app/backend/cmd/rk/tab_web.go`) — consolidated into the shared `tabWebFamilyEntries` helper the receipts and `ls` now share; deleted in-diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `jsonRunE` reads the flag with `cmd.Flags().GetBool("json")` so persistent parent flags (`tab web`) and local flags both work | cobra merges persistent flags into `Flags()` at execute time | S:70 R:90 A:85 D:80 |
| 2 | Confident | `riff --session` default on `-L` without `$TMUX` is the server's current session via `display-message -p '#{session_name}'` | Mirrors `resolveTabNewSession`'s rule for `tab new` | S:65 R:85 A:80 D:75 |
| 3 | Confident | `ArgStringArray` positional items are appended in order at the array's slot; a `Format` positional treats an integer input via `strconv.Itoa` | Only two rows use each; simplest faithful mapping | S:60 R:85 A:85 D:80 |
| 4 | Tentative | The riff `count` input is bounded 1–8 in the policy row | The CLI has no upper bound; 8 keeps a chat client from fanning out unboundedly — adjust if usage asks | S:45 R:90 A:60 D:55 |
| 5 | Confident | `notify` reports `delivered:false` (not an error envelope) on any swallowed failure | Intake row 11; the fail-silent exit-0 contract is spec-documented | S:60 R:85 A:75 D:70 |

5 assumptions (0 certain, 4 confident, 1 tentative).
