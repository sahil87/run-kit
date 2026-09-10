# Intake: rk MCP stdio server — W1 of the rk MCP plan

**Change**: 260910-nuf6-rk-mcp-stdio
**Created**: 2026-09-10

## Origin

One-shot `/fab-new` invocation executing row **W1 (`rk-mcp-stdio`)** of the plan doc
`fab/plans/sahil/26-09-10-rk-mcp.md`. Raw input:

> Execute row W1 ("rk-mcp-stdio") of fab/plans/sahil/26-09-10-rk-mcp.md. Read the whole plan doc
> first, plus docs/specs/mcp.md (merged via W0/PR #913 -- this is now the design authority,
> supersedes the plan doc for spec content; the plan doc still owns execution shape/sequencing).
> Note Copilots W0 review already corrected the allowlist: present demoted to tier-2, riff --cmd
> excluded from the tool, origin validation hardened to an allowlist (not bare Host match), gui_exec
> always --detach, operator_request window/busy-queue qualifiers -- build against the CURRENT spec
> text, not the plan docs original table. Scope: go-sdk dependency
> (github.com/modelcontextprotocol/go-sdk, pinned per D11); internal/mcp package (policy table:
> path -> expose/annotations/timeout/arg mapping; Cobra-introspection schema generator; argv
> executor with stdin plumbing and exit-code -> isError mapping; envelope parser per D5 with a
> prose fallback for the interim send receipt); rk mcp verb (stdio transport); rk skill becomes the
> server instructions block; image block support for PNG paths (ready for gui_shot later). Seed the
> policy table with the W1 tool set from the current spec (not necessarily exactly 8 -- match what
> mcp.md actually specifies post-Copilot-fixes). Add a doctor row. E2E test: an MCP client lists
> tools, calls sessions, capture, send against a test tmux server.

**Design authority**: `docs/specs/mcp.md` (merged 2026-09-10 via PR #913, on `main` at
`0c8623d1`). Every normative statement below cites it. The plan doc owns only sequencing
(which rows enter in W1) and the pickup protocol (update its Status line + W1 row on merge).
Companion spec deltas from W0 that bind this change: `cli-layering.md` § Root (visible)
(`mcp` is a visible root verb — "a transport verb typed into connector configs"),
`agent-messaging.md` § Surface (the MCP `send` tool is "a fourth door … onto the same engine").

**Worktree state**: this worktree's branch `rk-mcp-stdio` was cut before W0 merged; it was
rebased onto `origin/main` (`17478379`) at intake so the spec is present. Tree clean.

**Code fact-checks performed at intake** (verified in `app/backend/`):

| Fact | Where | Consequence |
|---|---|---|
| No `rk mcp`, no `internal/mcp`, no MCP SDK in `go.mod` (Cobra v1.10.2, pflag v1.0.9, go 1.25.0) | `cmd/rk/root.go`, `go.mod` | Greenfield package + verb; one new module dependency |
| `github.com/modelcontextprotocol/go-sdk` latest stable is **v1.7.0** (v1.8.0 exists only as `-pre.1`/`-pre.2`) | `go list -m -versions` | Pin **v1.7.0** (D11). It pulls `github.com/google/jsonschema-go` for schemas |
| SDK API (v1.7.0): `mcp.NewServer(&mcp.Implementation{Name,Version}, &mcp.ServerOptions{Instructions})`; `(*Server).AddTool(*mcp.Tool, mcp.ToolHandler)` takes a raw `InputSchema any` (must be a JSON-schema object; validation is the caller's job); `mcp.CallToolRequest` = `ServerRequest[*CallToolParamsRaw]` with `Arguments json.RawMessage`; `mcp.CallToolResult{Content []Content, IsError bool}`; `mcp.TextContent{Text}`, `mcp.ImageContent{Data []byte, MIMEType}`; `mcp.ToolAnnotations{ReadOnlyHint bool, DestructiveHint *bool, IdempotentHint bool, OpenWorldHint *bool, Title}`; `(*Server).Run(ctx, &mcp.StdioTransport{})`; client side `mcp.NewClient(...).Connect(ctx, &mcp.CommandTransport{Command: *exec.Cmd}, nil)` → `*ClientSession` with `ListTools` / `CallTool` / `Close` | `go doc` on the pinned module | Everything the spec needs exists in the SDK; no protocol code of our own (Principle 9). Use `Server.AddTool` (raw schema, dynamic per policy row), not the generic `mcp.AddTool[In,Out]` (needs static Go types) |
| `rootCmd` and the embedded skill bundle (`skillBundle []byte`, `//go:embed skill/skill.md`) live in package `main` (`cmd/rk`) | `cmd/rk/root.go`, `cmd/rk/skill.go` | `internal/mcp` cannot import them; `cmd/rk/mcp.go` passes the Cobra root, the exe path, the version, and the instructions bytes into `internal/mcp` |
| Cobra introspection precedent: `help_dump.go` walks `rootCmd` read-only (`Name()`, `CommandPath()`, `Short`, `UseLine()`, `UsageString()`), excluding hidden commands | `cmd/rk/help_dump.go` | The schema generator reuses this posture (introspection is not execution — Principle 8) |
| `-L/--server` is a **persistent** flag on `mux`, `tab`, and `cron` (`StringVarP(..., "server", "L", ...)`); `gui status` and `status` have **no** `-L`; `status` hard-codes `server := "runkit"` | `mux.go:88`, `tab.go:43`, `cron.go:49`, `status.go:12`, `gui.go:269` | `server` input exists only on rows whose verb accepts `-L`; the `status` row gets a description override naming the hard-coded server. Introspection must look at both `LocalFlags()` and `InheritedFlags()` (a parent's persistent flag is not in `cmd.Flags()` until merged) |
| Structured (`--json`) today: `mux sessions [--all]`, `mux panes`, `mux capture <target> [-l N]`, `mux process <target>`, `status`, `cron list`, `gui status`, `tab show [@N]`, `tab web ls [@N]` — each emits a **bare** JSON document, not the D5 envelope (the envelope helper is W2a) | the respective `cmd/rk/*.go` | W1's `result: json` parser MUST accept a bare document as the interim `result` (see § What Changes 2.4); no verb's output changes in W1 |
| `mux send <target> [<message> \| -]` reads the body from stdin for `-` (`io.ReadAll(muxStdinFn())`); stdout is exactly one report line `delivered %N` / `staged %N` / `sent %N` (exit 0) or `unverified %N` (exit 1); gate matrix on `@rk_pane_agent_state` (unknown ⇒ warn + send) | `cmd/rk/mux_send.go` | `send` row: `stdin: message`, positional `-`, `result: text`; description override states the interim receipt semantics |
| `tab show [@N]` / `tab web ls [@N]` default to the caller's own tab via `$TMUX` (fails closed when unset) | `cmd/rk/tab_show.go`, `tab_web.go`, `owntab.go` | Target rule: the tool schema makes `window` **required** |
| `gui shot` prints the PNG path on stdout via `sink.Dataf("%s\n", out)`; flags `--scale`, `--max-width`, `--window`, `--out` | `cmd/rk/gui_shot.go` | The `result: image` reader consumes "a path on stdout" — no `gui_shot` row lands in W1, the reader is unit-tested against a temp PNG |
| Exit-code convention: 0 success / 1 operational / 2 usage; `exitCode(err)` is the single classifier | `cmd/rk/exit_code.go` | Exit → `isError` and → envelope `code` (`2` ⇒ `usage`, else `operational`) |
| `rk doctor` rows are `doctorCheck{Name, OK, Hint, Note}` appended in `runDoctorChecks()`; pure check functions over injected inputs are the test pattern (`guiCheck`, `codeServerCheck`) | `cmd/rk/doctor.go` | Add `mcpCheck(...)` + `mcpDoctorCheck()` in the same shape |
| Real-tmux test pattern: isolated server `rk-test-<role>-<pid>-<ns>` via `exec.CommandContext(ctx,"tmux","-L",server,"new-session","-d",...)`, `t.Skip` when tmux is absent, `t.Cleanup(kill-server)`; `TestMain` post-sweeps dead-PID `rk-test-*` sockets | `cmd/rk/agent_codex_e2e_test.go`, `main_test.go` | The MCP E2E uses `rk-test-mcp-<pid>-<ns>`; no test ever touches the user's servers |
| No test builds the `rk` binary today; the RK_RIFF_SUBPROC precedent re-execs the **test binary** through `execute()` | `cmd/rk/root_test.go:300` | That precedent cannot serve here: the server child would `os.Executable()` into the test binary for every tool call. The E2E `go build`s a real `rk` into `t.TempDir()` (see § 2.9) |
| Toolkit standards that bind a new visible root verb: `help-dump` (hidden self-filtering tree, `text` byte-faithful), `principles` (P9 stdout=data/stderr=chatter, exit codes), `skill` (bundle ≤150 lines, byte-identical, static) | `shll standards`, `cmd/rk/skill_test.go` (`skillLineBudget = 150`) | `rk mcp` needs no help-dump work beyond existing in the tree; the skill bundle is **not** edited (§ 2.6) |
| README has a `## Command reference` table with one row per root family (`rk mux`, `rk tab`, …) | `README.md:197-217` | One row for `rk mcp` |

## Why

**The problem.** After W0 the design is normative but nothing runs. A chat client with no shell
on the box — the Claude desktop app over `ssh <box> rk mcp` — still cannot see a pane or message
an agent. W1 is "first light": the smallest server that proves the whole proxy shape
end-to-end (policy table → Cobra-derived schema → argv exec → envelope/text/image → MCP
content) using **only verbs that are already MCP-shaped**, so no CLI verb changes (D12).

**Why this shape.** The spec fixes eight principles this change must embody, and the ones
that shape W1's code are: the CLI is the single contract (every tool is exactly one `rk` verb
invocation — Principle 1); allowlist, default-excluded (a verb is exposed iff it has a
compiled-in policy row — Principle 2); argv exec via `os.Executable()` under
`exec.CommandContext`, never in-process `RunE` re-entry, with schemas introspected from the
Cobra tree at startup (Principle 8); the official SDK owns the wire protocol (Principle 9);
`send` bodies travel on stdin (§ Allowlist row rules); the target is always explicit (§ Target
rule). Building `internal/mcp` as a transport-agnostic core with `rk mcp` as its stdio host is
what lets W4 mount the same table and executor at `/mcp` without a second implementation.

**What happens without it.** W2a/b/c (three parallel CLI-shaping changes) and W3a/b (two new
verb families) each "append policy rows" — there is no table to append to until W1 lands. The
milestone the plan names ("Claude Desktop lists the tools and can read a pane and message an
agent") is also the first real usage signal that tells W2 which receipts matter.

**Why 10 tools, not 8.** The plan's W1 row says "the 8 W1 rows", but its own W2a note
(added at W0 intake) records that `mux panes --json` and `status --json` already exist and are
"eligible to seed W1 — operator's call". D12's rule is "seeded only with verbs already
MCP-shaped"; the spec's allowlist marks both "Structured today: yes". They enter in W1; W2a
shrinks to `mux snapshot list` + `gui shot`. `code exec --json` is also structured today but
stays in W2c: it is a mutating Steer tool with a variadic JSON-arg input and a code-bridge
dependency, and the plan (which owns sequencing) places it there.

## What Changes

Backend only (Go). No frontend, no daemon route (that is W4), no CLI verb output change.

### 1. Dependency — `app/backend/go.mod`

Add `github.com/modelcontextprotocol/go-sdk v1.7.0` (pinned; `go mod tidy` brings
`github.com/google/jsonschema-go` and the SDK's transitive deps). No other new modules.

### 2. New package `app/backend/internal/mcp`

Package name `mcp`; the SDK is imported under an alias (`mcpsdk`) to avoid the name clash.
Files (suggested split; the apply agent may merge/split within the package):

| File | Owns |
|---|---|
| `policy.go` | `Row` type, the compiled-in `Table` (the allowlist), `ToolTimeoutCap` |
| `schema.go` | Cobra introspection: `Resolve(root, table)` → per-row resolved command + validated flags; `InputSchema(row)` → JSON-schema object; tool description defaulting |
| `exec.go` | `Executor` (argv builder, stdin plumbing, `exec.CommandContext` with the row timeout, exit-code capture) |
| `result.go` | Envelope parser (three tiers), text mapping, image reader → `[]mcpsdk.Content` + `IsError` |
| `server.go` | `New(cfg Config) (*Server, error)` — builds the SDK server, registers one tool per row; `(*Server).RunStdio(ctx)` |

#### 2.1 Policy row (the only thing that exposes a verb)

```go
// Row is one allowlisted tool. The table is compiled in; a verb with no row is not a tool.
type Row struct {
    Tool        string        // MCP tool name — snake_case, unique, stable
    Path        string        // Cobra command path ("mux capture"); MUST resolve at startup
    Args        []Arg         // ordered input → argv mapping
    Stdin       string        // name of a string input streamed on stdin ("" = none)
    Result      ResultKind    // ResultJSON | ResultText | ResultImage
    Annotations Annotations   // ReadOnly, Destructive, Idempotent, OpenWorld (all bool)
    Timeout     time.Duration // 0 ⇒ ToolTimeoutCap; MUST be ≤ ToolTimeoutCap (test-enforced)
    Description string        // "" ⇒ Cobra Short + "\n\n" + Long
}

type Arg struct {
    Name        string   // input property name; "" for Literal
    Flag        string   // "-L", "--all", "-l" — mapped as flag [value]
    Positional  int      // 1-based positional slot (mutually exclusive with Flag)
    Literal     string   // fixed argv token appended in order ("--json", "-")
    Type        ArgType  // String | Integer | Boolean
    Required    bool
    Pattern     string   // JSON-schema pattern (strings)
    Enum        []string // closed set (strings)
    Minimum     *int     // integers
    Maximum     *int
    Description string   // "" ⇒ the flag's pflag Usage string (positional args need one)
}

const ToolTimeoutCap = 45 * time.Second // the one named constant (spec § Timeout contract)
```

Argv assembly order: **flags first in `Args` order, then positionals by slot, then literals in
`Args` order**, so a row like `capture` yields `mux capture -L <server> -l <lines> <target> --json`.
Booleans map to a bare flag when `true`, nothing when `false`/absent. Optional inputs absent
from the call contribute nothing. Every argv element is a separate slice entry — no joining,
no quoting, no shell (Constitution I).

#### 2.2 The W1 table (10 rows)

Common inputs: `server` = `{Name:"server", Flag:"-L", Type:String}` (optional) on every `mux`/`tab`/`cron`
row; `target` = `{Name:"target", Positional:1, Type:String, Required:true, Pattern:"^(%\\d+|@\\d+|=.+:.+)$"}`;
`window` = `{Name:"window", Positional:1, Type:String, Required:true, Pattern:"^@\\d+$"}`.

| Tool | Path | Args (in order) | Stdin | Result | Annotations | Description override |
|---|---|---|---|---|---|---|
| `sessions` | `mux sessions` | server; `all` (Flag `--all`, Boolean); Literal `--json` | — | json | ro | — |
| `panes` | `mux panes` | server; Literal `--json` | — | json | ro | — |
| `capture` | `mux capture` | server; `lines` (Flag `-l`, Integer, min 1, max 2000); target; Literal `--json` | — | json | ro | — |
| `process` | `mux process` | server; target; Literal `--json` | — | json | ro | — |
| `status` | `status` | Literal `--json` | — | json | ro | yes — "Session summary of the `runkit` tmux server only (the verb takes no server flag); use `sessions`/`panes` for any other server." |
| `cron_list` | `cron list` | server; Literal `--json` | — | json | ro | — |
| `gui_status` | `gui status` | Literal `--json` | — | json | ro | — |
| `tab_show` | `tab show` | server; window; Literal `--json` | — | json | ro | — |
| `tab_web_ls` | `tab web ls` | server; window; Literal `--json` | — | json | ro | — |
| `send` | `mux send` | server; target; `message` (String, Required, Description "The text to deliver; submitted with Enter"); Literal `-` | `message` | text | none (ReadOnly false, Destructive false, Idempotent false) | yes — see below |

`send` description override (the plan's named risk — the interim receipt misleads):

> Deliver a message into an agent's pane through run-kit's injection engine, gated on the pane's
> agent state (idle sends; waiting and active refuse; unknown warns and sends). Result is the
> verb's report line: `delivered %N` means the engine verified the text was submitted — it does
> NOT mean the agent has acted on it; read the pane with `capture` to see the effect. `staged`/
> `sent` do not occur through this tool. A refusal or `unverified %N` is returned as an error
> with the verb's diagnostic. `--force`, `--answer`, `--key`, and `--await` are not exposed.

Annotation semantics: `ro` ⇒ `ReadOnlyHint:true, DestructiveHint:false, IdempotentHint:true,
OpenWorldHint:false`; `send` ⇒ `ReadOnlyHint:false, DestructiveHint:false, IdempotentHint:false,
OpenWorldHint:false`. All 10 rows use `Timeout: 0` (the cap). Descriptions default to Cobra
`Short` + blank line + `Long` (spec § Instructions and discovery).

Rows the spec lists but W1 does **not** seed (they need CLI work first, per the plan's
sequencing): `snapshot_list`, `gui_shot`, `answer`, `await`, `notify`, `operator_request`,
`riff`, `new_window`, `operator`, `cron_add`, `tab_layout`, `tab_web`, `tab_code`, `code_exec`,
`gui_exec`, `kill`, `cron_rm`, `cron_mute`, `board`. Never-tools (spec § Never tools) MUST NOT
gain a row; a test asserts no row's `Path` is in that list (including `mcp` itself).

#### 2.3 Cobra-introspection schema generator (`schema.go`)

`Resolve(root *cobra.Command, table []Row) ([]Resolved, error)` runs once at startup:

1. `root.Find(strings.Fields(row.Path))` MUST return exactly that command (compare
   `cmd.CommandPath()` against `root.Name()+" "+row.Path`); a miss is an error naming the row.
2. For every `Arg` with a `Flag`: the flag MUST exist on the command — look up long names via
   `cmd.LocalFlags().Lookup` **or** `cmd.InheritedFlags().Lookup`, shorthand (`-L`, `-l`) via
   the corresponding `ShorthandLookup`. A miss is an error naming the row and flag. The pflag
   `Value.Type()` MUST be compatible with the row's `Type` (`bool` ⇔ Boolean; `int`/`int64` ⇔
   Integer; `string` ⇔ String) — a mismatch is an error.
3. `Literal` tokens that look like flags (`--json`) are also checked to exist (they are how
   drift in `--json` would otherwise slip through); `-` is exempt.
4. Duplicate tool names, a `Stdin` naming a non-existent or non-string input, `Timeout >
   ToolTimeoutCap`, and a `Path` in the never-tools list are errors.

This is the **drift guard**: `cmd/rk/mcp_test.go` asserts `Resolve(rootCmd, Table)` succeeds,
so a renamed or re-flagged verb fails `go test`, never the model. `rk mcp` also runs it at
startup and exits 1 with the same message if it ever fails at runtime (belt and braces).

`InputSchema(row)` returns a `map[string]any` JSON-schema object:
`{"type":"object","properties":{…},"required":[…],"additionalProperties":false}`; each
property carries `type`, optional `description` (the row's `Description`, else the flag's
pflag `Usage`), `pattern`, `enum`, `minimum`/`maximum`. Passing the map as `Tool.InputSchema`
is what the SDK's `Server.AddTool` expects; the handler validates arguments itself (required
present, types, pattern/enum/min-max) and returns `IsError:true` with a `usage`-style message
on violation — never exec-ing an invalid call.

Tool description: `row.Description` if set, else `cmd.Short` + `"\n\n"` + `cmd.Long`
(trimmed). CLI help is never rewritten for the model (spec § Policy table rules).

#### 2.4 Argv executor and result mapping (`exec.go`, `result.go`)

```go
type Executor struct {
    Exe string // the rk binary; rk mcp passes os.Executable(); tests point it at a stub
}
type Outcome struct {
    Stdout, Stderr []byte
    ExitCode       int
    TimedOut       bool
}
func (e Executor) Run(ctx context.Context, argv []string, stdin string, timeout time.Duration) Outcome
```

`Run` uses `exec.CommandContext(ctx, e.Exe, argv...)` under `context.WithTimeout(ctx, timeout)`,
sets `cmd.Stdin` to `strings.NewReader(stdin)` when the row has `Stdin`, captures stdout and
stderr separately, sets `cmd.WaitDelay` (e.g. 2 s) so a child that ignores the kill cannot wedge
the call, and records `TimedOut` when the deadline fired. The child inherits the server's
environment (it needs `PATH`, `HOME`, `XDG_STATE_HOME`); it MUST NOT inherit a `TMUX` /
`TMUX_PANE` that would let a verb resolve an own-pane default — the executor **unsets** both
for the child (target rule; the stdio server normally has neither, but `ssh` sessions started
inside tmux would). Deadline ⇒ `IsError:true` with text
`{"code":"operational","reason":"timeout","message":"<tool> exceeded 45s"}`.

Result mapping by `row.Result`:

| Kind | Exit 0 | Exit ≠ 0 |
|---|---|---|
| `json` | Parse stdout: **(a)** a JSON object with a boolean `ok` key ⇒ the D5 envelope — `ok:true` returns `result` re-serialised as one `TextContent`; `ok:false` ⇒ `IsError:true` with `error.message` (+ `hint`, `reason` when present). **(b)** any other valid JSON document ⇒ the interim bare form — returned verbatim as one `TextContent`. **(c)** not JSON ⇒ falls through to the text rule with a leading note `"(non-JSON output)"`. | Try (a) first (a verb may emit `ok:false` with exit 1/2); else `IsError:true`, text = `{"code": "usage"\|"operational" (2 ⇒ usage), "message": <stderr trimmed, else stdout>}` |
| `text` | One `TextContent` with stdout verbatim (trailing newline trimmed); `IsError:false` | `IsError:true`, text = stderr trimmed (fallback stdout), prefixed `exit <n>: ` |
| `image` | stdout's first non-empty line is a path; read it (PNG only — check the 8-byte signature; refuse paths outside what the verb printed, no globbing); return `ImageContent{Data, MIMEType:"image/png"}` **plus** a `TextContent` carrying `{"path":"<p>"}` (or the verb's JSON once it has `--json`). Unreadable/non-PNG ⇒ `IsError:true` naming the path | same as `text` |

Tier (b) is what lets the nine structured-today verbs ride `result: json` before W2a wraps
them in the envelope; when W2a lands, tier (a) takes over with no proxy change. Tier (c) is the
"prose fallback" the plan names, generalised. Every `IsError` text is plain and machine-neutral;
stderr diagnostics are never dropped on failure.

#### 2.5 Server construction (`server.go`)

```go
type Config struct {
    Root         *cobra.Command // the rk Cobra tree (introspected, never executed)
    Exe          string         // os.Executable() from rk mcp
    Version      string         // displayVersion()
    Instructions string         // rk skill core bundle, verbatim
    Table        []Row          // defaults to Table
    Logger       *slog.Logger   // stderr; stdout is the wire
}
func New(cfg Config) (*Server, error)          // Resolve → AddTool per row → SDK server
func (s *Server) RunStdio(ctx context.Context) error   // s.sdk.Run(ctx, &mcpsdk.StdioTransport{})
func (s *Server) Tools() []string               // sorted names, for doctor / tests
```

`Implementation{Name:"run-kit", Version: cfg.Version}`; `ServerOptions{Instructions:
cfg.Instructions, Logger: cfg.Logger}`. One `AddTool` per resolved row with the generated
schema, annotations, description, and a closure handler that: unmarshals `Arguments`, validates
against the row, builds argv, runs the executor, maps the outcome. The tool list is static for
the process life (no `listChanged`, spec § Instructions and discovery). The server holds no
state beyond the SDK session (Constitution II). W4 will call `New` with the same `Config` and
mount the SDK's streamable-HTTP handler instead of `RunStdio` — nothing in this package may
assume stdio.

#### 2.6 `rk mcp` verb — `cmd/rk/mcp.go`

```go
var mcpCmd = &cobra.Command{
    Use:   "mcp",
    Short: "Serve run-kit's MCP tools over stdio (connector command: ssh <box> rk mcp)",
    Long:  "…allowlisted proxy over rk verbs; every tool is one verb invocation; the tool list is docs/specs/mcp.md's allowlist; stdout is the protocol channel, diagnostics go to stderr…",
    Args:  usageArgs(cobra.NoArgs),
    SilenceUsage: true,
    RunE: runMCP,
}
```

`runMCP`: `exe, err := os.Executable()` (spec Principle 8 names `os.Executable()`; no symlink
resolution needed — the path only has to exec); `mcp.New(mcp.Config{Root: rootCmd, Exe: exe,
Version: displayVersion(), Instructions: string(skillBundle), Logger: slog.New(slog.NewTextHandler(cmd.ErrOrStderr(), nil))})`;
on error return it (exit 1, message names the failing row); then `RunStdio(ctx)` with a
context cancelled on SIGINT/SIGTERM. Visible root verb (cli-layering.md § Root), no flags in
v1, registered in `root.go` next to `skillCmd`. The `--quiet` persistent flag is inherited and
irrelevant (nothing but protocol goes to stdout anyway).

The instructions are the **core bundle bytes** (`skillBundle`), byte-identical to `rk skill` —
"captured at startup" is satisfied by the embed, no subprocess. Topic pages are not included
(spec: "Topic pages are content, not tools"). The skill bundle itself is **not edited**: it is a
briefing for a pane agent with a shell, the standard's line budget is tight (107/150 used), and
`rk mcp` is a transport, not an agent capability.

#### 2.7 Doctor row — `cmd/rk/doctor.go`

`mcpDoctorCheck()` calls `mcp.Resolve(rootCmd, mcp.Table)` in-process (introspection only, no
exec, no tmux): success ⇒ `doctorCheck{Name:"mcp", OK:true, Note:"10 tools; all policy rows
resolve"}` (count from the table); failure ⇒ `OK:false, failLabel:"mcp", Hint:<the Resolve
error>` — a table that cannot resolve is a real defect, so this row is a verdict flipper (unlike
the always-OK gui/code-server rows). Pure `mcpCheck(n int, err error) doctorCheck` for tests.
Appended to `runDoctorChecks()` after the `gui` row. The row appears in `--json` like every
other check.

#### 2.8 Drift-guard and unit tests

- `cmd/rk/mcp_test.go`: `Resolve(rootCmd, mcp.Table)` succeeds; the resolved tool list equals
  the 10 names above; every row's `Timeout ≤ ToolTimeoutCap`; no row path is a never-tool;
  `rk mcp --help` is in the help-dump tree (visible) and `mcp` is not hidden.
- `internal/mcp/*_test.go` against a **synthetic** Cobra tree (a root with `mux capture`
  carrying persistent `-L` and local `-l`, `--json`; a `send` with stdin): argv assembly order
  and omission of absent optionals; each `Resolve` error class (missing path, missing flag,
  type mismatch, over-cap timeout, never-tool); `InputSchema` shape (`required`, `pattern`,
  `minimum`/`maximum`, `enum`, descriptions from flag usage, `additionalProperties:false`);
  argument validation rejects a bad `target` before exec.
- Executor + result tests with the `Exe` seam pointed at shell stubs written via
  `testutil.WriteStub` (existing helper): envelope `ok:true`/`ok:false`, bare JSON, non-JSON
  on a json row, text exit 0/1/2 mapping, stdin round-trip (stub `cat`s stdin), a sleeping stub
  under a 200 ms timeout ⇒ `TimedOut` and the `reason:"timeout"` error, and the image reader
  against a temp PNG (valid signature ⇒ `ImageContent`; a text file ⇒ `IsError`).
- Doctor: `mcpCheck` both branches; `TestDoctorCommandOutput`-style row presence.

#### 2.9 End-to-end test — `cmd/rk/mcp_e2e_test.go`

Skips unless `tmux` and `go` are on PATH. Steps:

1. `go build -o <t.TempDir()>/rk .` from `cmd/rk` (`exec.CommandContext`, 120 s budget, build
   cache makes repeats fast). This is the **one** place the repo builds its own binary in a
   test; the alternative (re-exec the test binary, RK_RIFF_SUBPROC-style) is unusable because
   the server child would `os.Executable()` into the test binary for every tool call.
2. Start an isolated tmux server `rk-test-mcp-<pid>-<ns>` with one session `boot` (the
   `agent_codex_e2e_test.go` recipe: `t.Cleanup(kill-server)`; `TestMain` sweeps residue).
   Read its pane id via `display-message -p '#{pane_id}'`.
3. `mcp.NewClient(&Implementation{Name:"rk-e2e"}, nil).Connect(ctx, &CommandTransport{Command:
   exec.Command(bin, "mcp")}, nil)` with `TMUX`/`TMUX_PANE` **unset** in the child env.
4. `ListTools`: assert exactly the 10 names; `sessions`/`capture` carry `readOnlyHint:true`;
   `send` does not; every `inputSchema` is an object; `capture` requires `target` and has
   `lines` bounds; the `send` description contains "does NOT mean the agent has acted".
   Assert the initialize result's `instructions` equals `docs/site/skill.md` bytes.
5. `CallTool("sessions", {server})` ⇒ `IsError:false`, the text parses as a JSON array with a
   row named `boot`.
6. `CallTool("send", {server, target:"%N", message:"echo MCP_E2E_OK"})` ⇒ `IsError:false`, text
   `delivered %N` (an uninstrumented shell pane is `unknown` ⇒ warn on stderr + send).
7. Poll `CallTool("capture", {server, target, lines: 50})` (≤ 10 s, `testutil.WaitUntil`) until
   the JSON `content` field contains `MCP_E2E_OK`.
8. Negative: `CallTool("capture", {server, target:"bogus"})` ⇒ `IsError:true` (schema pattern);
   `CallTool("capture", {server, target:"%999"})` ⇒ `IsError:true` whose text carries the
   verb's stderr. `ListTools` never includes `kill`, `serve`, or `mcp`.
9. `session.Close()`; the server process exits (CommandTransport terminates it).

Runs under `just test-backend` (`go test ./...`); no `just` recipe changes.

### 3. README — `README.md` § Command reference

One row: `| \`rk mcp\` | MCP server over stdio — an allowlisted proxy over rk verbs for chat
clients with no shell on the box (Claude Desktop connector command: \`ssh <box> rk mcp\`). |`.

### 4. Spec clarification — `docs/specs/mcp.md` § Policy table rules

One sentence added to the `result: json` rule: *"Until a verb's envelope lands, a bare JSON
document on stdout is accepted as `result` with `ok` taken from the exit code; the envelope
takes precedence whenever an object with a boolean `ok` key is present."* This records the
interim behaviour W1 needs so W2a's graduation is a no-op for the proxy. No other spec text
changes.

### 5. Plan doc — `fab/plans/sahil/26-09-10-rk-mcp.md`

Per the pickup protocol: update the **Status** line (W1 in flight → merged, change id
`260910-nuf6`, PR link), the W1 row (10 rows seeded; `panes`/`status` moved from W2a), the W2a
row (now only `mux snapshot list` + `gui shot` gain `--json`; its policy rows are 2), and the
Milestone line ("lists 10 tools").

## Affected Memory

- `run-kit/mcp`: (new) The shipped MCP surface — `internal/mcp` (policy `Row`/`Table`,
  `ToolTimeoutCap`, `Resolve` drift guard, schema generation from Cobra, `Executor` argv/stdin/
  timeout semantics, the three-tier result parser, image reader), the `rk mcp` stdio verb
  (instructions = core skill bundle), the 10 seeded tools with annotations, the doctor row,
  the E2E harness (go-build + isolated tmux server), and the deferred rows/W2–W4 seams.
- `run-kit/architecture`: (modify) add `mcp` to the Go backend libraries list and `rk mcp` to
  the CLI subcommands list; note the go-sdk dependency.
- `run-kit/toolkit-standards`: (modify) extend the help-dump + P9 new-surface check with
  `rk mcp` (visible, no flags, stdout = protocol, stderr = diagnostics).
- `run-kit/agent-messaging`: (modify) one line — the MCP `send` tool is an argv door onto
  `rk mux send -` (text receipt until W2b).

## Impact

- **Code**: new `app/backend/internal/mcp/` (~5 files + tests); new `cmd/rk/mcp.go`,
  `cmd/rk/mcp_test.go`, `cmd/rk/mcp_e2e_test.go`; `cmd/rk/root.go` (+1 `AddCommand`);
  `cmd/rk/doctor.go` + `doctor_test.go` (+1 row); `go.mod`/`go.sum`.
- **Docs**: `README.md` (+1 row), `docs/specs/mcp.md` (+1 sentence), plan doc status.
- **Dependencies**: `github.com/modelcontextprotocol/go-sdk v1.7.0` (+ `google/jsonschema-go`).
- **Runtime**: none for existing users — no verb changes, no daemon change, no new route.
  `rk doctor` gains one row; `rk -h` gains one visible verb; `help-dump` tree gains `mcp`.
- **Security**: every tool call is an argv exec of the same binary with a fixed allowlist;
  inputs are schema-validated before exec; `send` bodies go over stdin; `TMUX`/`TMUX_PANE` are
  unset for children; `mux kill --force`, `riff --cmd`, and every never-tool are unreachable.
- **Tests**: unit (synthetic Cobra tree + stub exe), drift guard (real `rootCmd`), doctor,
  E2E (real binary, isolated tmux, real MCP client) — all under `just test-backend`.

## Open Questions

- None blocking. `ToolTimeoutCap = 45 s` is the spec's guess at the client floor and is to be
  revisited after first Claude Desktop usage (spec § Timeout contract) — not this change's call.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Seed **10** rows: the 9 structured-today read verbs (`sessions`, `panes`, `capture`, `process`, `status`, `cron_list`, `gui_status`, `tab_show`, `tab_web_ls`) + `send` (text) | Plan's W2a note flags `panes`/`status` as "eligible to seed W1 — operator's call"; D12 seeds "verbs already MCP-shaped"; spec marks both structured today. Trivially reversible (delete two rows) | S:70 R:90 A:80 D:70 |
| 2 | Confident | `code_exec` stays in W2c despite having `--json` today | Mutating Steer tool with a variadic JSON-arg schema and a code-bridge dependency; the plan (owner of sequencing) places it in W2c | S:65 R:90 A:75 D:70 |
| 3 | Confident | `result: json` parser is three-tier: D5 envelope (object with boolean `ok`) → bare JSON document (interim, exit code decides) → text fallback | In W1 no verb emits the envelope yet (W2a adds the helper); the spec's "structured today: yes ⇒ enters as `result: json`" only works with an interim bare-document tier; recorded as a one-sentence spec clarification | S:75 R:85 A:80 D:70 |
| 4 | Certain | Pin `go-sdk v1.7.0` | Latest stable at intake (`go list -m -versions`); v1.8.0 is pre-release only; D11 says pinned | S:85 R:90 A:95 D:90 |
| 5 | Certain | `internal/mcp` receives `Root *cobra.Command`, `Exe`, `Version`, `Instructions` from `cmd/rk`; the SDK import is aliased | `rootCmd` and the embedded skill bundle are package-`main` symbols; the spec names the package `internal/mcp`, which clashes with the SDK package name | S:80 R:85 A:95 D:90 |
| 6 | Certain | Executor exe is `os.Executable()` (not `selfpath.Resolve`) and is an injectable `Exe` field | Spec Principle 8 names `os.Executable()` verbatim; the seam is what makes executor tests run against stubs and what W4 reuses | S:85 R:90 A:95 D:90 |
| 7 | Confident | Executor unsets `TMUX`/`TMUX_PANE` in the child environment | Target rule: no own-pane default may reach a tool; an `ssh` session started from inside tmux would otherwise leak one. Cheap, contained | S:65 R:90 A:75 D:80 |
| 8 | Certain | Instructions = `skillBundle` bytes verbatim (core bundle only, no topic pages, no preface); `docs/site/skill.md` unchanged | Spec § Instructions and discovery: "the output of `rk skill` (the full bundle)"; topic pages are content; the bundle is a pane-agent briefing under a 150-line budget | S:85 R:90 A:90 D:85 |
| 9 | Confident | Doctor row `mcp` is a verdict flipper (FAIL when a policy row fails to resolve), Note `"N tools; all policy rows resolve"` | Spec: the row "confirms every policy row resolves"; an unresolvable table is a defect, unlike the always-OK state rows (`gui`, `code-server`) | S:65 R:90 A:80 D:75 |
| 10 | Confident | E2E builds the real `rk` binary with `go build` into `t.TempDir()` rather than re-exec-ing the test binary | The RK_RIFF_SUBPROC precedent breaks for a server whose tool calls `os.Executable()`; `go` is on PATH wherever `go test` runs; build cache bounds the cost | S:65 R:85 A:85 D:75 |
| 11 | Certain | `send` row exposes only `server`, `target`, `message` (no `--no-enter`, `--answer`, `--key`, `--await`, `--force`) | Spec puts `answer`/`await` in their own rows (W2b), forbids `--force` semantics changes, and D7's clamp for `--await` is W2b work; the description override says so | S:75 R:90 A:85 D:80 |
| 12 | Certain | Tool descriptions default to Cobra `Short` + `"\n\n"` + `Long`; only `send` and `status` carry overrides in W1 | Spec § Instructions and discovery; `status` hard-codes the `runkit` server and its help does not say so; `send` is the plan's named misleading-receipt risk | S:75 R:95 A:85 D:80 |
| 13 | Certain | Argument validation happens in the handler before exec (required/type/pattern/enum/bounds), returning `IsError` — the SDK's `Server.AddTool` does not validate raw schemas | `go doc` for `Server.AddTool`: "Unmarshaling the arguments and validating them against the input schema are the caller's responsibility"; the generic `AddTool[In,Out]` needs static types the dynamic table cannot supply | S:80 R:85 A:90 D:85 |
| 14 | Certain | All 10 rows use the 45 s cap; no shorter per-row timeouts in W1 | Spec: "the default is the cap"; per-row tuning is premature before usage | S:70 R:95 A:85 D:85 |
| 15 | Certain | README gains one `rk mcp` row in § Command reference; no other docs/site page | readme-extraction standard indexes root verbs there; `rk mcp` is a connector-typed transport, not a workflow needing a page | S:65 R:95 A:80 D:80 |

15 assumptions (9 certain, 6 confident, 0 tentative, 0 unresolved).
