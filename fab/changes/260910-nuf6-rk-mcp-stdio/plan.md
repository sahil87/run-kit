# Plan: rk MCP stdio server — W1 of the rk MCP plan

**Change**: 260910-nuf6-rk-mcp-stdio
**Intake**: `intake.md`

> Design authority: `docs/specs/mcp.md`. The intake's § What Changes carries the concrete
> shapes (Row/Arg types, the 10-row table, the parser tiers, the E2E steps) — read it alongside
> this plan; requirements below cite intake sections rather than restating every field.

## Requirements

### MCP: Policy table

#### R1: A verb is exposed iff it has a compiled-in policy row
`internal/mcp` SHALL define `Row`/`Arg`/`ResultKind`/`Annotations` and a package-level `Table []Row` per intake § 2.1. The server MUST register exactly one MCP tool per row and nothing else. `ToolTimeoutCap` MUST be the single named constant `45 * time.Second`; a row with `Timeout == 0` uses the cap.

- **GIVEN** the compiled `Table`
- **WHEN** `New(cfg)` builds the server
- **THEN** `ListTools` returns exactly `len(Table)` tools, named by `Row.Tool`
- **AND** no verb outside the table is reachable by any tool name

#### R2: The W1 table seeds the ten structured-today rows
`Table` MUST contain exactly the ten rows of intake § 2.2 — `sessions`, `panes`, `capture`, `process`, `status`, `cron_list`, `gui_status`, `tab_show`, `tab_web_ls` (all `ResultJSON`, read-only annotations) and `send` (`ResultText`, `Stdin: "message"`, non-read-only) — with the argument lists, patterns, bounds, literals, and the two description overrides (`status`, `send`) given there. The `send` override text MUST contain the phrase "does NOT mean the agent has acted".

- **GIVEN** the `capture` row
- **WHEN** a call supplies `{server:"s", target:"%3", lines:100}`
- **THEN** argv is `["mux","capture","-L","s","-l","100","%3","--json"]` (flags in Args order, then positionals, then literals)

- **GIVEN** the `send` row
- **WHEN** a call supplies `{target:"%3", message:"hi"}`
- **THEN** argv is `["mux","send","%3","-"]` and the child's stdin carries `hi`

#### R3: Never-tools are unreachable
No row's `Path` MAY name a never-tool (`serve`, `daemon …`, `remote …`, `desktop …`, `update`, `agent setup|hook`, `mux guard|init-conf`, `completion`, `shell-init`, `help-dump`, `skill`, `role`, `tutorial`, `cron tick`, `gui supervise|env`, `mcp`). `Resolve` MUST reject such a row.

- **GIVEN** a synthetic row with `Path: "mcp"` or `Path: "mux kill"` with a `--force` literal
- **WHEN** `Resolve` runs
- **THEN** it returns an error naming the row

### MCP: Cobra introspection and drift guard

#### R4: Every row resolves against the live Cobra tree at startup
`Resolve(root *cobra.Command, table []Row) ([]Resolved, error)` MUST: find each `Path` via `root.Find(strings.Fields(path))` and confirm `cmd.CommandPath()` matches; confirm every `Arg.Flag` and flag-shaped `Literal` exists on the command (long names via `LocalFlags()`/`InheritedFlags()` `Lookup`, shorthands via `ShorthandLookup`); confirm the pflag `Value.Type()` is compatible with `Arg.Type`; reject duplicate tool names, a `Stdin` that names no string input, `Timeout > ToolTimeoutCap`, and never-tool paths. Errors MUST name the offending row (and flag).

- **GIVEN** the real `rootCmd` and the shipped `Table`
- **WHEN** `TestMCPTableResolves` runs in `cmd/rk`
- **THEN** `Resolve` returns ten resolved rows and no error

- **GIVEN** a synthetic tree where `mux capture` lacks `-l`
- **WHEN** `Resolve` runs on the `capture` row
- **THEN** the error names `capture` and `-l`

#### R5: Input schemas and descriptions derive from the row and the Cobra command
`InputSchema(resolved)` MUST return a JSON-schema object `{"type":"object","properties":{…},"required":[…],"additionalProperties":false}` where each property carries `type`, `description` (row text, else the flag's pflag `Usage`), and `pattern`/`enum`/`minimum`/`maximum` when set. The tool description MUST be `Row.Description` when set, else `cmd.Short + "\n\n" + cmd.Long` trimmed. Annotations MUST map `Annotations{ReadOnly,Destructive,Idempotent,OpenWorld}` onto `mcpsdk.ToolAnnotations` (pointer fields for `DestructiveHint`/`OpenWorldHint`).

- **GIVEN** the `capture` row
- **WHEN** its schema is generated
- **THEN** `required == ["target"]`, `properties.target.pattern == "^(%\\d+|@\\d+|=.+:.+)$"`, `properties.lines.minimum == 1`, `properties.lines.maximum == 2000`, and `properties.server.description` equals the `-L` flag's usage string

### MCP: Argv execution

#### R6: Tool calls exec the rk binary as argv under the row timeout
`Executor{Exe}.Run(ctx, argv, stdin, timeout)` MUST use `exec.CommandContext` with a `context.WithTimeout`, set `cmd.Stdin` from `stdin` when non-empty (else no stdin), capture stdout and stderr separately, set `cmd.WaitDelay` (≈2 s), unset `TMUX` and `TMUX_PANE` in the child environment (otherwise inheriting the parent's), and report `ExitCode` and `TimedOut`. No shell, no string joining.

- **GIVEN** `Exe` pointing at a stub that `cat`s stdin and exits 0
- **WHEN** `Run` is called with `stdin:"hello"`
- **THEN** `Stdout == "hello"`, `ExitCode == 0`, `TimedOut == false`

- **GIVEN** a stub that sleeps 5 s
- **WHEN** `Run` is called with a 200 ms timeout
- **THEN** it returns within ~1 s with `TimedOut == true` and the child is gone

- **GIVEN** the parent has `TMUX=/tmp/x` set
- **WHEN** a stub that prints `$TMUX` runs
- **THEN** stdout is empty

#### R7: Arguments are validated before exec
The tool handler MUST unmarshal `Arguments`, reject unknown properties, missing required inputs, wrong JSON types, pattern/enum violations, and out-of-range integers, returning `IsError:true` with a one-line message (never exec-ing). Booleans map to a bare flag when true and nothing when false.

- **GIVEN** the `capture` tool
- **WHEN** called with `{target:"bogus"}`
- **THEN** the result is `IsError:true` mentioning `target`, and the executor was not invoked

### MCP: Result mapping

#### R8: `ResultJSON` parses three tiers
For a `ResultJSON` row, stdout MUST be interpreted as: (a) a JSON object with a boolean `ok` key ⇒ the D5 envelope — `ok:true` returns `result` re-serialised as one `TextContent`; `ok:false` ⇒ `IsError:true` with `error.message` (+ `hint`/`reason` when present); (b) any other valid JSON document ⇒ returned verbatim as one `TextContent` with `IsError` = exit ≠ 0; (c) non-JSON ⇒ the text rule with a leading `(non-JSON output)` note. On exit ≠ 0 without an envelope, `IsError:true` and the text is `{"code":"usage"|"operational","message":<stderr trimmed, else stdout>}` where exit 2 ⇒ `usage`.

- **GIVEN** stdout `{"ok":true,"result":{"a":1}}`, exit 0 → **THEN** text `{"a":1}`, `IsError:false`
- **GIVEN** stdout `{"ok":false,"error":{"code":"usage","message":"bad","hint":"try x"}}`, exit 2 → **THEN** `IsError:true`, text contains `bad` and `try x`
- **GIVEN** stdout `[{"name":"boot"}]`, exit 0 → **THEN** text is that array verbatim, `IsError:false`
- **GIVEN** stdout empty, stderr `no such pane %999`, exit 1 → **THEN** `IsError:true`, text `{"code":"operational","message":"no such pane %999"}`

#### R9: `ResultText` maps exit code to `isError`
Exit 0 ⇒ one `TextContent` with stdout (trailing newline trimmed), `IsError:false`. Exit ≠ 0 ⇒ `IsError:true`, text `exit <n>: <stderr trimmed, else stdout>`. A `TimedOut` outcome (any kind) ⇒ `IsError:true`, text `{"code":"operational","reason":"timeout","message":"<tool> exceeded <timeout>"}`.

- **GIVEN** the `send` row and stdout `delivered %3\n`, exit 0 → **THEN** text `delivered %3`
- **GIVEN** exit 1, stderr `refused: %3 is active` → **THEN** `IsError:true`, text `exit 1: refused: %3 is active`

#### R10: `ResultImage` returns a PNG content block from the printed path
For a `ResultImage` row with exit 0, the first non-empty stdout line is a file path; the file MUST begin with the 8-byte PNG signature; the result is `ImageContent{Data, MIMEType:"image/png"}` **plus** a `TextContent` `{"path":"<p>"}`. Unreadable or non-PNG ⇒ `IsError:true` naming the path. No `Table` row uses it in W1; it is unit-tested.

- **GIVEN** a temp file with a valid PNG header → **THEN** two content blocks, `IsError:false`
- **GIVEN** a temp text file → **THEN** `IsError:true` naming the path

### MCP: Server and the `rk mcp` verb

#### R11: `New(Config)` builds an SDK server from the table
`New(cfg Config)` MUST run `Resolve`, create `mcpsdk.NewServer(&Implementation{Name:"run-kit", Version:cfg.Version}, &ServerOptions{Instructions:cfg.Instructions, Logger:cfg.Logger})`, and `AddTool` one `*mcpsdk.Tool` (name, description, schema, annotations) with a closure handler per row. `RunStdio(ctx)` MUST call `Run(ctx, &StdioTransport{})`. `Tools()` MUST return the sorted tool names. Nothing in the package may assume stdio (W4 reuses `New`).

- **GIVEN** a `Config` with a synthetic root and a stub `Exe`
- **WHEN** an in-process SDK client connects over an in-memory transport
- **THEN** `initialize` carries `cfg.Instructions` and `ListTools` returns the table's tools

#### R12: `rk mcp` is a visible root verb serving stdio
`cmd/rk/mcp.go` MUST register `mcp` (visible, `Args: usageArgs(cobra.NoArgs)`, `SilenceUsage: true`) next to `skillCmd` in `root.go`. `runMCP` MUST pass `Root: rootCmd`, `Exe: os.Executable()`, `Version: displayVersion()`, `Instructions: string(skillBundle)`, and a stderr `slog` logger; a `New` error returns (exit 1, message names the row); otherwise `RunStdio` under a context cancelled on SIGINT/SIGTERM. Nothing but protocol MAY be written to stdout.

- **GIVEN** `rk mcp --help` → **THEN** exit 0 and the help names the connector command `ssh <box> rk mcp`
- **GIVEN** `rk help-dump` → **THEN** the tree contains a visible `run-kit mcp` node

#### R13: Instructions are the core skill bundle verbatim
The MCP `instructions` field MUST equal `docs/site/skill.md` byte-for-byte (via `skillBundle`); `docs/site/skill.md` is NOT modified by this change.

- **GIVEN** a connected client → **THEN** `InitializeResult.Instructions == string(skillBundle)`

### Doctor

#### R14: `rk doctor` gains an `mcp` row
`mcpCheck(n int, err error) doctorCheck` MUST return `{Name:"mcp", OK:true, Note:"<n> tools; all policy rows resolve"}` on `err == nil` and `{Name:"mcp", OK:false, failLabel:"mcp", Hint:err.Error()}` otherwise. `mcpDoctorCheck()` calls `mcp.Resolve(rootCmd, mcp.Table)` and is appended in `runDoctorChecks()` after the `gui` row. The row appears in `--json`.

- **GIVEN** the shipped table → **THEN** `rk doctor --json` contains `{"name":"mcp","ok":true,"note":"10 tools; all policy rows resolve"}`

### Tests

#### R15: An end-to-end test drives the real binary with a real MCP client
`cmd/rk/mcp_e2e_test.go` MUST implement intake § 2.9: skip without `tmux`/`go`; `go build` the binary into `t.TempDir()`; start `rk-test-mcp-<pid>-<ns>` with session `boot`; connect via `mcpsdk.CommandTransport` with `TMUX`/`TMUX_PANE` unset; assert the ten tool names, annotations, `capture`'s required/bounds, the `send` description phrase, and `instructions == skill.md`; call `sessions` (row `boot`), `send "echo MCP_E2E_OK"` (text `delivered %N`), poll `capture` until `content` contains `MCP_E2E_OK`; negative `capture` with `target:"bogus"` (schema) and `%999` (verb stderr); `kill`/`serve`/`mcp` absent from the list; `Close()` ends the child.

- **GIVEN** `just test-backend` on a box with tmux → **THEN** the E2E passes; without tmux it skips

### Docs

#### R16: README and spec carry the two one-line additions
`README.md` § Command reference MUST gain the `rk mcp` row from intake § 3. `docs/specs/mcp.md` § Policy table rules MUST gain the interim bare-document sentence from intake § 4, and nothing else in the spec changes.

- **GIVEN** the diff → **THEN** `README.md` has one added table row and `docs/specs/mcp.md` one added sentence

#### R17: The plan doc records W1
`fab/plans/sahil/26-09-10-rk-mcp.md` MUST be updated per intake § 5: Status line (W1 = `260910-nuf6`, PR link once known — at ship, `/git-pr` may leave the PR number for the reviewer; the change id goes in now), the W1 row (10 rows seeded), the W2a row (only `mux snapshot list` + `gui shot`; 2 policy rows), and the Milestone line ("lists 10 tools").

- **GIVEN** the plan doc after apply → **THEN** its Status names `260910-nuf6` and W1's row says ten rows

### Non-Goals

- Any verb output change, `--json` envelope helper, or new `--json` flag (W2a/b/c).
- The `/mcp` HTTP route, `rk url --mcp`, Origin validation (W4).
- `answer`, `await`, `riff`, `kill`, `board`, `operator_request`, or any non-listed row.
- Editing `docs/site/skill.md`; MCP resources or prompts; `listChanged`.

### Design Decisions

#### Three-tier `ResultJSON` parser
**Decision**: envelope (object with boolean `ok`) → bare JSON (interim) → text fallback.
**Why**: the nine structured-today verbs emit bare documents until W2a wraps them; the proxy must not change when they graduate.
**Rejected**: `ResultText` for all W1 rows (loses `isError` from `ok:false` once envelopes land; forces a proxy edit per verb in W2a).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

#### Injectable `Executor.Exe`
**Decision**: the rk binary path is a field; `rk mcp` fills `os.Executable()`.
**Why**: executor and result tests run against shell stubs; W4 constructs the same executor in the daemon.
**Rejected**: hard-coding `os.Executable()` inside the executor (untestable without a built binary).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

#### E2E builds the real binary
**Decision**: `go build` into `t.TempDir()` inside the E2E test.
**Why**: the server child calls `os.Executable()` per tool; re-exec-ing the test binary (the RK_RIFF_SUBPROC pattern) would route tool calls into the test runner.
**Rejected**: test-binary re-exec with an env guard; a `just` recipe that pre-builds (couples the test to the runner).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

#### Children run without `TMUX`/`TMUX_PANE`
**Decision**: the executor strips both from the child environment.
**Why**: the target rule — no own-pane default may reach a tool; an `ssh` session started inside tmux would otherwise leak one.
**Rejected**: relying on the schema alone (a verb with an optional target could still resolve the leaked pane).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

## Tasks

### Phase 1: Setup

- [x] T001 Add `github.com/modelcontextprotocol/go-sdk v1.7.0` to `app/backend/go.mod` (`go get …@v1.7.0 && go mod tidy`); confirm `go build ./...` still passes <!-- R11 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/backend/internal/mcp/policy.go`: `Row`, `Arg`, `ArgType`, `ResultKind`, `Annotations`, `ToolTimeoutCap`, the never-tools list, and the 10-row `Table` with the two description overrides per intake § 2.1–2.2 <!-- R1, R2, R3 -->
- [x] T003 Create `app/backend/internal/mcp/schema.go`: `Resolve` (path/flag/type/duplicate/stdin/timeout/never-tool checks with row-naming errors), `Resolved`, `InputSchema`, description defaulting, annotation mapping <!-- R4, R5 -->
- [x] T004 [P] Create `app/backend/internal/mcp/exec.go`: `Executor{Exe}`, `Outcome`, `Run` (CommandContext + timeout + WaitDelay, separate stdout/stderr, stdin plumbing, `TMUX`/`TMUX_PANE` unset) and `BuildArgv(resolved, args)` (flags → positionals → literals; bool flags; omitted optionals) <!-- R6, R2 -->
- [x] T005 [P] Create `app/backend/internal/mcp/result.go`: `ValidateArgs`, `MapResult` for the three kinds (three-tier JSON, text exit mapping, timeout error, PNG image reader) <!-- R7, R8, R9, R10 -->
- [x] T006 Create `app/backend/internal/mcp/server.go`: `Config`, `New` (Resolve → SDK server → `AddTool` per row with closure handler), `RunStdio`, `Tools` <!-- R11 -->
- [x] T007 Write `internal/mcp` unit tests (`policy_test.go`, `schema_test.go`, `exec_test.go`, `result_test.go`, `server_test.go`) against a synthetic Cobra tree and `testutil.WriteStub` stubs: argv order, every `Resolve` error class, schema shape, validation rejections, stdin round-trip, timeout, env stripping, the three JSON tiers, text mapping, image reader, in-memory client `ListTools`/`initialize` instructions <!-- R2, R3, R4, R5, R6, R7, R8, R9, R10, R11 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Create `app/backend/cmd/rk/mcp.go` (`mcpCmd`, `runMCP` with signal-cancelled context, stderr slog) and register it in `cmd/rk/root.go` after `skillCmd` <!-- R12, R13 -->
- [x] T009 [P] Add `mcpCheck` + `mcpDoctorCheck` to `cmd/rk/doctor.go`, append after the `gui` row; tests in `doctor_test.go` for both branches and `--json` presence <!-- R14 -->
- [x] T010 [P] Create `cmd/rk/mcp_test.go`: `Resolve(rootCmd, Table)` succeeds with the ten names; every timeout ≤ cap; no never-tool path; `mcp` visible in `buildDump(rootCmd, …)`; `rk mcp --help` mentions `ssh <box> rk mcp`; `send` description contains "does NOT mean the agent has acted" <!-- R4, R12, R2 -->
- [x] T011 Create `cmd/rk/mcp_e2e_test.go` per intake § 2.9 (go build → isolated tmux → CommandTransport → ListTools/instructions → sessions → send → capture poll → negatives → Close); run it and fix until green <!-- R15, R13 -->
- [x] T012 Run `cd app/backend && go test ./internal/mcp/... ./cmd/rk/...` then `go vet ./...`; fix anything red <!-- R15 -->

### Phase 4: Polish

- [x] T013 [P] Add the `rk mcp` row to `README.md` § Command reference <!-- R16 -->
- [x] T014 [P] Add the interim bare-document sentence to `docs/specs/mcp.md` § Policy table rules (`result: json` bullet) <!-- R16 -->
- [x] T015 [P] Update `fab/plans/sahil/26-09-10-rk-mcp.md` Status line, W1 row, W2a row, Milestone line per intake § 5 <!-- R17 -->

## Execution Order

- T001 blocks everything in Phase 2 (the SDK import).
- T002 → T003 → T006; T004 and T005 depend only on T002 and may run alongside T003.
- T007 needs T002–T006. T008 needs T006. T009/T010 need T003 (+ T008 for the help-dump assertion). T011 needs T008.
- Phase 4 tasks are independent of each other and of the Go work.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/mcp.Table` exists, `ToolTimeoutCap == 45s`, and `New` registers exactly one tool per row
- [x] A-002 R2: the table holds exactly the ten intake § 2.2 rows with the specified args, literals, result kinds, annotations, and the `status`/`send` description overrides
- [x] A-003 R4: `Resolve(rootCmd, Table)` succeeds in `cmd/rk/mcp_test.go` and fails with a row-naming error on each synthetic drift case
- [x] A-004 R5: generated schemas carry `required`, `pattern`, `minimum`/`maximum`, `additionalProperties:false`, and flag-usage descriptions; tool descriptions default to Short + Long
- [x] A-005 R6: `Executor.Run` uses `exec.CommandContext` with the row timeout, separate stdout/stderr, stdin plumbing, `WaitDelay`, and strips `TMUX`/`TMUX_PANE`
- [x] A-006 R11: `New` builds the SDK server with `Implementation{run-kit, version}` and `Instructions`; `RunStdio` uses `StdioTransport`; `Tools()` sorted
- [x] A-007 R12: `rk mcp` is registered visible in `root.go`, takes no args/flags, and writes nothing but protocol to stdout
- [x] A-008 R14: `rk doctor` and `rk doctor --json` include the `mcp` row with the tool count note
- [x] A-009 R16: README gains the `rk mcp` row; `docs/specs/mcp.md` gains only the interim-bare-document sentence
- [x] A-010 R17: the plan doc Status/W1/W2a/Milestone lines are updated

### Behavioral Correctness

- [x] A-011 R2: argv for `capture {server,target,lines}` is exactly `mux capture -L <s> -l <n> <target> --json`; `send` argv ends in `-` with the message on stdin
- [x] A-012 R8: envelope `ok:true` → `result` text; envelope `ok:false` → `IsError` with message+hint; bare JSON verbatim; non-JSON falls to text with the note; non-zero exit without envelope → `{"code":…,"message":…}` with exit 2 ⇒ `usage`
- [x] A-013 R9: text rows map exit 0 → stdout trimmed, exit ≠ 0 → `exit <n>: <stderr>`; timeouts → `reason:"timeout"` error
- [x] A-014 R13: `initialize` instructions equal `docs/site/skill.md` bytes and that file is unchanged in the diff

### Removal Verification

- [x] A-015 R3: no `Table` row names a never-tool; `mux kill --force`, `riff --cmd`, `--await`, `--answer`, `--key`, `--force` are absent from every row

### Scenario Coverage

- [x] A-016 R15: the E2E test lists ten tools, reads `boot` via `sessions`, delivers `echo MCP_E2E_OK` via `send`, observes it via `capture`, and passes under `go test ./cmd/rk/`
- [x] A-017 R15: the E2E skips cleanly when `tmux` or `go` is absent and leaves no `rk-test-mcp-*` server behind
- [x] A-018 R10: the image reader returns `ImageContent` + path text for a PNG and `IsError` for a non-PNG (unit test)
- [x] A-019 R11: an in-memory SDK client sees the synthetic table's tools and instructions (unit test)

### Edge Cases & Error Handling

- [x] A-020 R7: invalid arguments (unknown property, missing `target`, bad pattern, out-of-range `lines`, wrong type) return `IsError` without exec
- [x] A-021 R6: a child that ignores the deadline is killed within `WaitDelay`; no process survives a timed-out call
- [x] A-022 R12: a `Resolve` failure makes `rk mcp` exit 1 naming the row, and flips the doctor row to FAIL with the same message
- [x] A-023 R8: a verb that exits non-zero yet prints an `ok:false` envelope is mapped from the envelope (message/hint), not the generic exit text

### Code Quality

- [x] A-024 Pattern consistency: new files follow `cmd/rk`/`internal/` conventions (doc-comment headers stating constraints, `usageArgs`, `SilenceUsage`, `newSink`-style stdout/stderr discipline, table tests)
- [x] A-025 No unnecessary duplication: reuses `testutil.WriteStub`/`WaitUntil`, `displayVersion()`, `skillBundle`, `exitUsage` semantics; no second Cobra walker beyond what `help_dump.go` already shows
- [x] A-026 Constitution I / Process Execution: every subprocess is `exec.CommandContext` with an argv slice and a timeout; no shell strings anywhere in the diff
- [x] A-027 Constitution II: the server holds no state beyond the SDK session; nothing written to disk
- [x] A-028 Constitution III: protocol handled entirely by the pinned SDK; no hand-rolled JSON-RPC
- [x] A-029 Comments state constraints, not narration; no change IDs or PR numbers in code comments
- [x] A-030 Tests cover added behavior (unit + drift guard + doctor + E2E); `go vet ./...` clean; `go test ./internal/mcp/... ./cmd/rk/...` green

### Security

- [x] A-031 R7: no tool accepts a shell string; `send` bodies travel on stdin only; targets are pattern-checked before exec
- [x] A-032 R6: `TMUX`/`TMUX_PANE` never reach a child; the exe is the binary itself, never a PATH lookup

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (the `internal/mcp` package, the `rk mcp` verb, the doctor row) without making any existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `WaitDelay` ≈ 2 s after the deadline kill | Bounded cleanup for a child that ignores SIGKILL propagation; value is not spec-fixed | S:60 R:95 A:85 D:80 |
| 2 | Confident | Non-envelope non-zero exit on a JSON row renders `{"code","message"}` JSON text (not raw stderr) | Keeps `ResultJSON` error text machine-shaped and matches the envelope's field names | S:65 R:90 A:80 D:75 |
| 3 | Confident | The plan doc's PR link is filled at ship (git-pr) or left as "PR pending" by apply | Apply cannot know the PR number; the Status line still names the change id | S:70 R:95 A:85 D:85 |
| 4 | Certain | Unit tests use a synthetic Cobra tree; only `cmd/rk/mcp_test.go` touches `rootCmd` | `rootCmd` is package-main; `internal/mcp` must stay independent of `cmd/rk` | S:80 R:90 A:95 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
