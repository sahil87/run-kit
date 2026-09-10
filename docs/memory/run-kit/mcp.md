---
type: memory
description: "The rk MCP surface — the `rk mcp` stdio server and `internal/mcp`: the compiled-in policy table (an allowlisted proxy over rk verbs — a verb with no row is not a tool), Cobra-introspection schema generation with the `Resolve` drift guard, the argv `Executor` (stdin plumbing, 45 s timeout cap, `TMUX`/`TMUX_PANE` stripped), the three-tier JSON result parser plus text/image mapping, the ten seeded tools, the `rk doctor` row, and the E2E harness."
---
# rk MCP Surface

**Domain**: run-kit

## Overview

run-kit exposes an MCP (Model Context Protocol) surface: a mechanical, allowlisted proxy over existing `rk` verbs, so a chat client with no shell on the box (the Claude desktop app via the connector command `ssh <box> rk mcp`) can see and steer the estate. The CLI stays the single contract — every tool is exactly one verb invocation executed as an argv child process. The design authority is `docs/specs/mcp.md`; this file records the shipped state.

## Requirements

### Requirement: The policy table is the allowlist
`internal/mcp` SHALL define the `Row`/`Arg`/`ArgType`/`ResultKind`/`Annotations` types and the compiled-in package-level `Table []Row`; a verb with no row is not a tool. `ToolTimeoutCap` MUST be the single named constant `45 * time.Second`; a row with `Timeout == 0` uses the cap, and a row above it fails `Resolve`. A `neverTools` prefix list (`serve`, `daemon`, `remote`, `desktop`, `update`, `agent setup|hook`, `mux guard|init-conf`, `completion`, `shell-init`, `help-dump`, `skill`, `role`, `tutorial`, `cron tick`, `gui supervise|env`, `mcp`) MUST be rejected by `Resolve`.

#### Scenario: An unlisted verb is unreachable
- **GIVEN** the compiled `Table`
- **WHEN** an MCP client lists tools
- **THEN** exactly one tool per row appears, named by `Row.Tool`, and `kill`, `serve`, and `mcp` are absent

### Requirement: The drift guard resolves every row at startup
`Resolve(root, table)` MUST validate each row against the live Cobra tree, read-only: the `Path` resolves exactly (a partial `Find` is a miss); every `Flag` and flag-shaped `Literal` (`--json`; the `-` stdin marker is exempt) exists via `LocalFlags()`/`InheritedFlags()` long-name and shorthand lookups; the pflag `Value.Type()` is compatible with the input type (`bool`⇔Boolean, `int`/`int64`⇔Integer, `string`⇔String); and duplicate tool names, a `Stdin` naming no string input of the row, and an over-cap timeout are errors. Every error names the offending row (and flag). `cmd/rk/mcp_test.go` asserts `Resolve(rootCmd, Table)` succeeds, so a renamed or re-flagged verb fails `go test`, never the model; `rk mcp` re-runs the same resolution at startup and exits 1 with the same message.

#### Scenario: A renamed flag fails the build, not the model
- **GIVEN** a Cobra tree where `mux capture` lacks `-l`
- **WHEN** `Resolve` runs
- **THEN** the error names `capture` and `-l`

### Requirement: Schemas and descriptions derive from the row and the command
`InputSchema(resolved)` MUST return a JSON-schema object `{"type":"object","properties":{…},"required":[…],"additionalProperties":false}` where each property carries `type`, a `description` (the row's text, else the flag's pflag usage), and `pattern`/`enum`/`minimum`/`maximum` when set. The tool description MUST be `Row.Description` when set, else Cobra `Short` + blank line + `Long` trimmed — CLI help is never rewritten for the model. The handler validates raw arguments before anything execs (unknown property, missing required input, wrong JSON type, pattern/enum/bounds violation ⇒ `IsError:true` with a one-line message) because the SDK's `Server.AddTool` does not validate raw schemas.

### Requirement: Tool calls exec the rk binary as argv under the row timeout
`Executor{Exe}.Run(ctx, argv, stdin, timeout)` MUST use `exec.CommandContext` under `context.WithTimeout` with a 2 s `cmd.WaitDelay` (a child that ignores the deadline kill cannot wedge the call), capture stdout and stderr separately, plumb `stdin` only when the row names a stdin input, and strip `TMUX`/`TMUX_PANE` from the child environment — no own-pane default may reach a tool. `BuildArgv` assembles flags in `Args` order, then positionals by slot, then literals in `Args` order; booleans map to a bare flag when true and nothing otherwise; absent optional inputs contribute nothing; every argv element is a separate slice entry — no joining, no quoting, no shell. `rk mcp` fills `Exe` with `os.Executable()`; tests point it at stubs.

#### Scenario: capture argv assembly
- **GIVEN** the `capture` row and a call `{server:"s", target:"%3", lines:100}`
- **WHEN** argv is built
- **THEN** it is `["mux","capture","-L","s","-l","100","%3","--json"]`

### Requirement: Results map by result kind
`MapResult` maps a subprocess outcome onto MCP content per the row's `ResultKind`:

- `ResultJSON` parses stdout in three tiers: **(a)** an object with a boolean `ok` key is the `--json` envelope — `ok:true` returns `result` re-serialised as one `TextContent`; `ok:false` maps `error.message` (+ `hint`/`reason` when present) to `IsError:true` — and the envelope wins even on a non-zero exit; **(b)** any other valid JSON document is the interim bare form, returned verbatim as one `TextContent` with `IsError` from the exit code; **(c)** non-JSON falls through to the text rule with a leading `(non-JSON output)` note. A non-zero exit without an envelope yields `IsError:true` with `{"code":"usage"|"operational","message":<stderr trimmed, else stdout>}` (exit 2 ⇒ `usage`).
- `ResultText` returns stdout verbatim (trailing newline trimmed) on exit 0 with `IsError:false`; otherwise `IsError:true` with `exit <n>: <stderr trimmed, else stdout>`.
- `ResultImage` reads the file at stdout's first non-empty line, requires the 8-byte PNG signature (no globbing, no other type), and returns `ImageContent{Data, MIMEType:"image/png"}` plus a `TextContent` carrying `{"path":"<p>"}`; an unreadable or non-PNG file is `IsError:true` naming the path. No `Table` row uses it; it is unit-tested against a temp PNG.
- A `TimedOut` outcome on any kind yields `IsError:true` with `{"code":"operational","reason":"timeout","message":"<tool> exceeded <timeout>"}`.

### Requirement: The seeded table ships ten tools
`Table` MUST seed exactly these ten rows. Nine read-only (`ResultJSON`, annotations `readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false`), each with a `--json` literal and — where the verb accepts it — an optional `server` input mapped to `-L`: `sessions` (`mux sessions`, optional `all` boolean), `panes` (`mux panes`), `capture` (`mux capture`; `lines` integer bounded 1–2000; required `target` matching `^(%\d+|@\d+|=.+:.+)$`), `process` (`mux process`), `status` (`status`), `cron_list` (`cron list`), `gui_status` (`gui status`), `tab_show` (`tab show`; required `window` matching `^@\d+$`), `tab_web_ls` (`tab web ls`). One mutating row: `send` (`mux send`, `ResultText`, all annotations false, required `message` streamed on stdin behind the `-` literal). Two rows carry description overrides: `status` (the verb hard-codes the `runkit` server and its help does not say so) and `send` (`delivered %N` is the injection engine's submission verification — it does NOT mean the agent has acted on it; `--force`, `--answer`, `--key`, and `--await` are not exposed). The `send` row is an argv door onto the messaging engine documented in [agent-messaging](/run-kit/agent-messaging.md).

### Requirement: `rk mcp` serves the SDK server over stdio
`rk mcp` MUST be a visible root verb (`cmd/rk/mcp.go`, registered after `skillCmd`) taking no arguments (`usageArgs(cobra.NoArgs)`, `SilenceUsage`), with stdout reserved for the protocol and all diagnostics on stderr via an `slog` text handler. `runMCP` passes the Cobra root (introspected, never executed), `os.Executable()`, `displayVersion()`, and the instructions — the core skill bundle bytes verbatim, byte-identical to `rk skill`'s output (topic pages are content, not tools; the bundle itself is unchanged) — into `mcp.New`, then serves `RunStdio` under a SIGINT/SIGTERM-cancelled context. The wire protocol is owned by the pinned `github.com/modelcontextprotocol/go-sdk v1.7.0` (imported under the `mcpsdk` alias; it pulls `github.com/google/jsonschema-go` indirectly) — run-kit writes no protocol code. The server holds no state beyond the SDK session, and the tool list is static for the process life (no `listChanged`). Nothing in `internal/mcp` assumes stdio — the daemon's `/mcp` route reuses the same `New`.

### Requirement: `rk doctor` carries the `mcp` row
`rk doctor` MUST include an `mcp` row (`mcpDoctorCheck` → in-process `mcp.Resolve(rootCmd, mcp.Table)` — introspection only, no exec, no tmux): success ⇒ OK with note `<n> tools; all policy rows resolve`; failure ⇒ FAIL with the `Resolve` error as the hint. A table that cannot resolve is a defect, so unlike the always-OK state rows this row flips the verdict. The row appears in `--json` like every other check.

### Requirement: The E2E test drives the real binary with a real MCP client
`cmd/rk/mcp_e2e_test.go` MUST skip unless `tmux` and `go` are on PATH, `go build` a real `rk` into `t.TempDir()`, start an isolated `rk-test-mcp-<pid>-<ns>` tmux server with one session `boot` (the [test-sockets](/run-kit/test-sockets.md) isolation recipe — `t.Cleanup` kill-server, `TestMain` residue sweep), and connect a go-sdk client over `CommandTransport` with `TMUX`/`TMUX_PANE` unset in the child environment. It asserts the ten tool names, the read-only annotations, `capture`'s required/bounded inputs, the `send` description phrase, and `instructions == docs/site/skill.md` bytes; then calls `sessions` (a row named `boot`), `send` (`echo MCP_E2E_OK` ⇒ text `delivered %N`), and a polled `capture` until the JSON `content` carries `MCP_E2E_OK`; negative cases cover a schema rejection (`target:"bogus"`) and a verb stderr pass-through (`%999`); `Close()` ends the server process. It runs under `just test-backend`.

### Scope: what the surface does not ship
The spec's remaining allowlist rows (`snapshot_list`, `gui_shot`, `answer`, `await`, `notify`, `operator_request`, `riff`, `new_window`, `operator`, `cron_add`, `tab_layout`, `tab_web`, `tab_code`, `code_exec`, `gui_exec`, `kill`, `cron_rm`, `cron_mute`, `board`) have no policy row, and the `/mcp` streamable-HTTP transport does not exist — `internal/mcp`'s transport-agnostic `New` is its seam. Sequencing lives in `fab/plans/sahil/26-09-10-rk-mcp.md` (waves W2–W4). (260910-nuf6-rk-mcp-stdio)

## Design Decisions

### Three-tier `ResultJSON` parser
**Decision**: envelope (object with boolean `ok`) → bare JSON (interim) → text fallback.
**Why**: the nine structured-today verbs emit bare documents until the `--json` envelope wraps them; the proxy must not change when they graduate.
**Rejected**: `ResultText` for all seeded rows (loses `isError` from `ok:false` once envelopes land; forces a proxy edit per verb at graduation).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

### Injectable `Executor.Exe`
**Decision**: the rk binary path is a field; `rk mcp` fills `os.Executable()`.
**Why**: executor and result tests run against shell stubs; the daemon's `/mcp` route constructs the same executor.
**Rejected**: hard-coding `os.Executable()` inside the executor (untestable without a built binary).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

### E2E builds the real binary
**Decision**: `go build` into `t.TempDir()` inside the E2E test.
**Why**: the server child calls `os.Executable()` per tool; re-exec-ing the test binary (the RK_RIFF_SUBPROC pattern) would route tool calls into the test runner.
**Rejected**: test-binary re-exec with an env guard; a `just` recipe that pre-builds (couples the test to the runner).
*Introduced by*: 260910-nuf6-rk-mcp-stdio

### Children run without `TMUX`/`TMUX_PANE`
**Decision**: the executor strips both from the child environment.
**Why**: the target rule — no own-pane default may reach a tool; an `ssh` session started inside tmux would otherwise leak one.
**Rejected**: relying on the schema alone (a verb with an optional target could still resolve the leaked pane).
*Introduced by*: 260910-nuf6-rk-mcp-stdio
