# Intake: CLI Spawn and Steer Receipts (rk MCP W2c)

**Change**: 260911-fr5t-cli-spawn-and-steer-receipts
**Created**: 2026-09-11

## Origin

> CLI spawn/steer receipts — --json receipts on `riff`, `mux new`, `cron add`, `tab layout|web|code`, `code exec`, `gui exec`, `mux kill`, `cron rm|mute`, `operator`, `notify`, each returning the id it created/changed or the action taken; policy rows for the tools listed under Talk/Spawn/Steer UI/Clean up in § Allowlist v1 whose "Enters" column says W2c.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol exactly (D1-D13 closed, docs/specs/mcp.md is design authority on conflicts, policy table in app/backend/internal/mcp/policy.go with doctor drift-guard, never expose a verb without a policy row). Base this change on § Change breakdown → "W2c" row. Note the off-plan substrate already landed (§ Change breakdown "Off-plan substrate landed 2026-09-10"): `rk tab new --json` (#925) already exists — your `new_window` row is a policy row only, not a CLI change; `mux panes --json` (#923) and `cron list --json` (#921) already carry their fields too. `present` is tier two (not in scope). Update the plan's Status line and the W2c row when you create/merge this change.

One-shot `/fab-new` invocation (no prior discussion in this conversation). The plan doc
`fab/plans/sahil/26-09-10-rk-mcp.md` and the spec `docs/specs/mcp.md` were read in full;
every in-scope verb's source (`app/backend/cmd/rk/{riff,mux_new,mux_kill,cron_add,cron_mut,
tab_layout,tab_web,tab_code,code,gui_exec,operator,notify,tab_new}.go`) and the whole
`app/backend/internal/mcp` package were read to pin the receipts to what the verbs already
compute. Decisions carried in from the prompt and the plan's § Pickup protocol:

- D1–D13 are closed and are not reopened here. Where this intake and `docs/specs/mcp.md`
  disagree, the spec wins; where the spec is stale against shipped code (the `tab new`
  receipt row, see below) the spec gets a fix-up in this change.
- The policy table `app/backend/internal/mcp/policy.go` is the only thing that exposes a
  verb; the `rk doctor` `mcp` row and `cmd/rk/mcp_test.go` are the drift guard.
- `new_window` and `code_exec` are **policy rows only** — `rk tab new --json` (#925) and
  `rk code exec --json` already emit machine output; the D5 envelope wrap of every
  pre-existing `--json` verb is W2a's job (spec § Envelope names them) and is not repeated here.
- `present` is tier two and gets no row; `tab_web add` carries the capability.
- W2c runs in parallel with W2a (`cli-json-read-verbs`) and W2b (`cli-send-await-receipts`);
  neither has started (no branch exists for either). The shared files are the policy table
  (append-only rows) and the one envelope helper in `cmd/rk` (see § Envelope helper).

## Why

**The problem.** The W1 MCP server (`rk mcp`, PR #924) exposes ten tools, nine of them
read-only. A chat client with no shell on the box can *see* the estate but can barely
*change* it: the only mutating tool is the interim `send`. Every spawn, steer, and clean-up
verb — `riff`, `tab new`, `operator`, `cron add`, `tab layout|web|code`, `gui exec`,
`mux kill`, `cron rm|mute`, `notify` — prints a human line (or nothing) on success, so even
if they were exposed a model would learn only "exit 0" and would have to guess the id it
just created (`@N`, `%N`, a cron entry id, a pid) from prose. D6 says success receipts ride
behind `--json`; D3 says a verb reaches MCP only through a policy row. Neither exists for
these verbs today.

**If we don't.** The milestone stays "read the estate, message one agent". The Claude
desktop app cannot open a window, start an operator, schedule a prompt, lay out a tab, or
kill a finished pane — the whole "steer" half of the plan's goal. Pane agents (which read
`rk skill` and drive the same verbs) also keep scraping `@N`/`%N` out of prose, the failure
mode Toolkit Principle 2 exists to prevent.

**Why this shape.** D2 makes the CLI the single contract, so the work is *shaping verbs*,
not building tools: each verb gains an opt-in `--json` receipt whose fields reuse the report
words and ids it already prints (spec § Receipts' vocabulary rule), and then gets one
policy row. Human output is untouched (D5), exit codes are unchanged, and pane agents get
every receipt for free. The alternative — tool-side wrappers that parse prose or call
`internal/` packages directly — is forbidden by spec Principle 1 and would give MCP a second
contract to drift.

## What Changes

### 1. The `--json` envelope helper in `cmd/rk` (D5) — consume, do not create

The helper is **already on main** (PR #945, W3a): `app/backend/cmd/rk/output.go` defines
`outputSink.JSONResult(v any)` (writes `{"ok":true,"result":v}` as one newline-terminated
document on the data channel), `outputSink.JSONError(e envelopeError)` (writes
`{"ok":false,"error":e}`), the `envelopeError{Code, Message, Hint?, Reason?}` type, and the
`envelopeCodeUsage` / `envelopeCodeOperational` constants. **Re-read `output.go` at apply
entry and use exactly those names**; this change adds no second helper (W2a's open PR #949
carries a duplicate `Envelope()` in the same file — a later cleanup, not this change's).

- **Success path**: a verb with `--json` set calls `sink.JSONResult(receipt)` where it prints
  its human line today, and prints nothing else on stdout. Chatter (`Notef`) stays on stderr.
- **Failure path** — the established pattern (`operator_request.go`, `board.go`): the verb
  itself emits `sink.JSONError(envelopeError{Code, Message})` on stdout *before* returning
  the error, so exactly one document reaches stdout and cobra's `Error: …` stderr line stays
  the human message. To avoid hand-formatting that at every `return err` in twelve verbs,
  this change adds one small wrapper next to the helper:

  ```go
  // jsonRunE wraps a verb's RunE: when the verb's --json flag is set and run
  // returns an error, the D5 error envelope is written first (code from
  // exitCode(err): 2 ⇒ usage, else operational; message = err.Error()).
  func jsonRunE(run func(*cobra.Command, []string) error) func(*cobra.Command, []string) error
  ```

  Each W2c verb's `RunE` is `jsonRunE(runX)`. A verb that wants a `hint`/`reason` (none in
  W2c) calls `sink.JSONError` itself, as `operator request` does.
- **Verbs that `os.Exit` inside `RunE`** (`riff` via `runRiffWithExitCode`, `operator` via
  `runOperatorWithExitCode`, both on `*riff.ExitCodeError`) emit `sink.JSONError` in those
  wrappers before `os.Exit`, since no outer wrapper runs after an exit.
- The existing bare-JSON verbs (`tab new --json`, `code exec --json`, and the read verbs)
  are **not** wrapped here — that is W2a's row-by-row graduation. The MCP result parser's
  tier (b) (bare document + exit code) carries them until then.

### 2. Receipts — one `--json` flag per verb (D6)

Every verb below gains `--json` (a `BoolVar` on its own flag set; `mux`/`tab`/`cron` families
keep their persistent `-L`). Exit codes, stderr diagnostics, and the default stdout line are
byte-identical to today. `--json` changes only what stdout carries. Field names reuse the
report word or id the verb already prints; a receipt MAY add fields later, never rename these.

| Verb | Today's stdout | `result` under `--json` |
|------|----------------|--------------------------|
| `riff [preset] [flags]` | nothing (stderr + exit code) | `{"windows":[{"id":"@N","name":"riff-<wt>","server":"<label>","panes":["%N",…],"worktree":"/abs/path","branch":"<name>"}]}` — one element per spawned window (`--count N` ⇒ N elements, in index order) |
| `mux new <name> [--ephemeral]` | `created <name>` | `{"report":"created","server":"<name>","ephemeral":bool}` |
| `cron add <prompt> …` | `<id> <name> [<schedule> -> <target>]` | `{"id":"<id>","name":"<name>","schedule":"<cronScheduleSummary>","target":"<cronTargetSummary>"}` — the four fields the human line prints, as the same strings (`every 1h`, `backoff 1m→30m`, `cron 0 9 * * *`; `role:operator`, `pane:%12`, `session:<ref>`) |
| `tab layout [@N] [L\|--add\|--rm\|--promote\|--cycle]` | the resulting layout value (read form: the effective layout) | `{"window":"@N","layout":"<shape>:<surfaces>"}` — read and mutate forms alike |
| `tab web add [@N] <target> [--show]` | `@N/web/<n>` (url on stderr) | `{"window":"@N","index":n,"url":"<resolved url>","tabs":[{"index":i,"url":"…","root":"…"?},…]}` |
| `tab web rm [@N/]web/<n>` | nothing | `{"window":"@N","index":n,"tabs":[…]}` — `tabs` is the family *after* the removal |
| `tab web select [@N/]web/<n>` | nothing | `{"window":"@N","index":n,"tabs":[…]}` |
| `tab web mv [@N/]web/<n> <m>` | `@N/web/<m>` | `{"window":"@N","index":m,"tabs":[…]}` — `index` is the destination slot |
| `tab code set [@N] <folder>` | `/abs/path` | `{"window":"@N","code_root":"/abs/path"}` |
| `gui exec --detach <cmd> [args…]` | `started <pid> on <display>` | `{"pid":n,"display":":N"}` — `--json` without `--detach` is a usage error (exit 2): the foreground path replaces the process and can print no receipt |
| `mux kill <target>` | `killed %N` | `{"report":"killed","target":"%N"}` |
| `cron rm <id>` | `removed <id>` | `{"id":"<id>","removed":true}` |
| `cron mute <id> [--for d] [--off]` | `muted <id>` / `unmuted <id>` / `muted <id> until <RFC3339>` | `{"id":"<id>","muted":bool,"until":"<RFC3339>"?}` — `until` present only on the `--for` lease |
| `operator [--workers p] [-L s]` | `Opened operator tab (window "operator").` / `Switched to existing operator tab.` / `Operator tab already present.` | `{"window":"@N","server":"<label>","created":bool}` — `created:false` on both singleton hits |
| `notify <message> [--title t]` | nothing, always exit 0 | `{"delivered":bool}` — `true` on a 2xx from `/api/notify`; `false` when the send was swallowed (unreachable, non-2xx, timeout). Exit stays 0 either way: the fail-silent contract is unchanged, the receipt is where the truth goes |

`tabs` in the `tab web` receipts is the same entry shape `tab web ls --json` prints
(`tabWebLsJSONEntry`: `index`, `url`, `root` omitempty) — one family read after the
mutation; a failed read-back is a `Notef` on stderr and `tabs` is omitted, never an error
(the mutation already happened).

Verb-level notes:

- **`riff`** — the engine's `Run(ctx, spec) error` returns only an error today, and
  `runCount`'s `fanOutResult` keeps `WorktreePath`/`WindowName` but discards the window id.
  Change `riff.Run` to return `([]SpawnReceipt, error)` where
  `SpawnReceipt{WindowID, WindowName, Server, PaneIDs []string, WorktreePath, Branch string}`;
  `spawnRiffReturningName` already resolves `windowID` and `paneID` (pane 0) — collect every
  pane with `tmux list-panes -t <@N> -F '#{pane_id}'` after the split phase, and derive
  `Branch` with `git -C <worktree> rev-parse --abbrev-ref HEAD` (`exec.CommandContext`, 5 s;
  `wt create` prints a `Path:` line but no branch line). On the human path the CLI ignores
  the receipts (byte-identical output); the daemon `Spawn` path keeps its `Result` shape.
  `server` in the receipt is the CLI server label (`cliServerLabel(OriginalTMUX)` or the
  new `-L` value).
- **`riff` targeting flags (needed for D8 — see § 4 for why)**: `-L/--server <name>` (waives
  the `$TMUX` precondition and sets `spec.Server`, the `rk operator -L` pattern),
  `--session =S` (exact form, sets `spec.Session` → the engine's existing `new-window -t
  =<session>:` daemon path; default without `$TMUX`: the server's current session via
  `display-message -p '#{session_name}'`, the `tab new` rule), and `--repo <dir>` (an
  absolute or cwd-relative path that must be a git toplevel — validated with
  `config.FindGitRoot(dir) == dir` — replacing the process-cwd derivation of `repoRoot` for
  `wt create`, launcher resolution, and preset reads). All three are optional on the CLI;
  the MCP row marks `server` and `repo` required.
- **`mux new`** — `ephemeral` echoes the flag so the receipt says what was created.
- **`cron add`** — no schema change; the receipt is built from the returned `cron.Entry`.
- **`gui exec`** — `--json` is validated against `--detach` before the OS/reachability gates
  (usage errors first). The receipt's `display` is `st.Display` (`:N`).
- **`mux kill`** — `--force` is unaffected on the CLI; it is simply not exposed over MCP.
- **`cron mute`** — `muted:false` on `--off`; `until` is the lease's RFC 3339 local time,
  the same string the human line prints.
- **`operator`** — both singleton branches and the create branch print the receipt; the
  window id comes from `findOperatorWindowID` (singleton) or from
  `display-message -t <paneID> -p '#{window_id}'` after `createMarkedOperatorWindow`
  (create). The kickoff-delivery failure stays a stderr warning with exit 0 (`created:true`
  is still true). `seedOperatorTick`'s warning stays on stderr.
- **`notify`** — `sendNotify` gains a `bool` return (2xx ⇒ true); `--json` prints the
  receipt through `newSink(cmd).JSON`. `SilenceErrors` stays; `RunE` still returns nil.

### 3. Policy rows — 13 new tools in `internal/mcp/policy.go`

Appended after `send`, in this order. Every row's `Path` and every `Flag`/flag-shaped
`Literal` must resolve (the existing `Resolve` drift guard). `timeout` is the 45 s cap
unless stated. Annotations: **destr** = `Destructive:true`, **idem** = `Idempotent:true`,
otherwise `Annotations{}`.

| Tool | Path | Inputs → argv | Result | Ann. |
|------|------|---------------|--------|------|
| `notify` | `notify` | `message` (positional 1, required, string); `title` (`--title`) ; literal `--json` | json | — |
| `riff` | `riff` | `server` (`-L`, **required**, pattern `^[A-Za-z0-9_-]+$`); `repo` (`--repo`, **required**, string — an absolute git-toplevel path); `session` (`--session`, pattern `^=.+$`); `preset` (positional 1); `skill` (`--skill`, **string array**, repeatable); `layout` (`--layout`); `count` (`-N`, integer 1–8); literal `--json`. **No `--cmd`** (spec § Target rule) | json | — |
| `new_window` | `tab new` | `server` (`-L`); `session` (`--session`, pattern `^=.+$`); `cwd` (`--cwd`); `name` (`--name`); `layout` (`--layout`); literal `--json`. No `--ready`, no `-- CMD` | json (bare `{session, window_id, pane_id}` via parser tier (b) until W2a wraps it) | — |
| `operator` | `operator` | `server` (`-L`, **required** — the verb refuses without `$TMUX` otherwise, and the executor strips `$TMUX`); `workers` (`--workers`, pattern `^[A-Za-z0-9_-]+$`); literal `--json` | json | idem |
| `cron_add` | `cron add` | `server` (`-L`); `prompt` (positional 1, required); `every`, `idle_every` (`--every`, `--idle-every`, string, pattern for a Go duration `^[0-9]+(ns\|us\|µs\|ms\|s\|m\|h)([0-9]+(ns\|us\|µs\|ms\|s\|m\|h))*$`); `backoff` (`--backoff`, bool); `min`, `max` (`--min`, `--max`, duration strings); `cron` (`--cron`); `catch_up` (`--catch-up`, enum `once`); `name` (`--name`); `deliver` (`--deliver`, enum `immediate\|when-idle\|skip-if-busy`); `if_absent` (`--if-absent`, enum `skip\|notify`); `pinned` (`--pinned`, bool); `role`, `pane` (pattern `^%\d+$`), `session` (`--role`/`--pane`/`--session`); literal `--json`. `--respawn` (a string array that is an argv) and `if-absent respawn` are **not exposed** | json | — |
| `tab_layout` | `tab layout` | `server` (`-L`); `window` (positional 1, **required**, `^@\d+$`); `layout` (positional 2, string — the set form); `add`, `rm`, `promote` (`--add`/`--rm`/`--promote`, enum `tty\|web\|code\|gui`); `cycle` (`--cycle`, bool); literal `--json` | json | — |
| `tab_web` | `tab web` (the `board` precedent: one parent path, `action` as positional 1, the flags persistent on the parent) | `action` (positional 1, **required** enum `add\|rm\|select\|mv`); `server` (`-L`); `window` (**required** `^@\d+$`, schema-only) and `slot` (integer 1–`tmux.MaxWebTabs`, schema-only) feed one formatted positional 2 with `Format: "{window}[/web/{slot}]"` (the bracketed segment drops when `slot` is absent); `target` (positional 3, add's present target string); `to` (positional 4, integer, mv's destination); `show` (`--show`, bool, add only); literal `--json`. argv per action: `tab web add @N <target> [--show] --json` · `tab web rm @N/web/<slot> --json` · `tab web select @N/web/<slot> --json` · `tab web mv @N/web/<slot> <to> --json`. Per-action required-ness (`target` for add, `slot` for rm/select/mv, `to` for mv) is enforced by the verb's own usage errors and stated in the row description — exactly how `board` handles `name`/`window`. `--show` and `--json` become **persistent** flags on the `tab web` parent (the drift guard resolves flags on the row's path) | json | — |
| `tab_code` | `tab code set` | `server` (`-L`); `window` (positional 1, **required**); `folder` (positional 2, **required**, string — the verb validates existence); literal `--json` | json | — |
| `code_exec` | `code exec` | `command` (positional 1, required); `args` (positional 2, **string array** — JSON literals as strings, each one argv element); `host` (`--host`); `tab` (`--tab`, `^@\d+$`); `folder` (`--folder`); `timeout` (`--timeout`, duration string); `all` (`--all`, bool); literal `--json` | json (the existing raw response envelope, parser tier (b)) | — |
| `gui_exec` | `gui exec` | literal `--detach`; literal `--`; `command` (positional 1, **required**); `args` (positional 2, **string array**); literal `--json` — argv `gui exec --detach --json -- <command> <args…>` | json | — |
| `kill` | `mux kill` | `server` (`-L`); `target` (positional 1, **required**, `^(%\d+\|@\d+\|=.+:.+)$`); literal `--json`. **No `--force`** (test-pinned banned flag) | json | destr |
| `cron_rm` | `cron rm` | `server` (`-L`); `id` (positional 1, **required**); literal `--json` | json | destr |
| `cron_mute` | `cron mute` | `server` (`-L`); `id` (positional 1, **required**); `for` (`--for`, duration string); `off` (`--off`, bool); literal `--json` | json | idem |

Description overrides (`Row.Description`), because Cobra help written for a terminal misleads
a model on these rows:

- `tab_web`: which inputs each action requires (the `board` description's pattern).
- `riff`: says `server` and `repo` are required over MCP, that `skill` items are slash
  commands rendered for the resolved provider, that `--cmd` (shell panes) is not available,
  and that the receipt's `panes[0]` is the task pane.
- `new_window`: says the window is born idle (no command form), how `session`/`cwd` default,
  and that the result is `{session, window_id, pane_id}`.
- `operator`: idempotent; `created:false` means an operator already existed on that server.
- `cron_add`: the prompt is text typed into an agent, never a command; exactly one schedule
  input and exactly one of `role`/`pane`/`session` are required (the verb enforces both).
- `gui_exec`: always detached — the receipt is a pid, not the command's output; pair with
  `gui_shot`/`gui_status`.
- `kill`: gated on agent state and server protection; a refusal is the verb's error, and
  there is no force path over MCP.
- `notify`: `delivered:false` is not an error — the verb is fail-silent by contract.

After this change `Table` has **25 rows** (the 12 on main — W1's 10 plus W3b's `board` and W3a's `operator_request` — plus 13); `rk doctor`'s `mcp` note reads `25 tools; all policy rows resolve`. The spec's allowlist is 29; the plan's W2c row says
"14 tools" because it was counted before `present` was dropped — 13 is the correct number
and the plan row is corrected (§ 7).

### 4. `internal/mcp` model extensions the rows need

The `Row`/`Arg` model on main cannot express three things the W2c rows need. W3b's `board`
row already proved the action-enum shape (a positional enum on the parent path, flags
persistent on the parent, per-action requirements enforced by the verb), so **no variant
model is added** — `tab_web` follows that precedent. Each extension below is generic and
unit-tested in isolation.

**a. Formatted positionals (`tab_web`).** `Arg.Format string` — a positional whose argv
token is rendered from named schema-only inputs after validation: `{name}` substitutes the
input's value, `[…]` is an optional segment dropped when any input inside it is absent.
`tab_web` uses `Format: "{window}[/web/{slot}]"` at positional 2; `window`/`slot` are
`Arg`s with neither `Flag` nor `Positional` (schema-only, like `send`'s `message`). `Resolve`
rejects a `Format` naming an input the row lacks.

**b. String arrays.** `ArgStringArray` — JSON `{"type":"array","items":{"type":"string"}}`,
with optional `MaxItems`. Mapped to a repeated flag (`--skill a --skill b`) or to a trailing
positional slot (each element one argv element, `gui_exec`/`code_exec` `args`). Cobra's
`Args` validators still see the same argv a shell would produce. `checkFlagType` accepts
pflag types `stringArray`, `stringSlice`, and `riff`'s custom `skill` type for an
`ArgStringArray` input.

**c. Argv ordering and typed flags.** `BuildArgv` becomes a single ordered walk over `Args`
(flags, flag-shaped literals, positionals by slot, bare literals — each emitted where it sits
in `Args`), instead of flags → positionals → literals. The seeded rows are re-ordered so
their argv is byte-identical to today (pinned by the existing `BuildArgv` tests, e.g. capture
still yields `mux capture -L s -l 100 %3 --json`, and `board`'s flags still precede its
positionals); the new order lets `gui_exec` place `--detach --json --` before its
positionals. `checkFlagType` also accepts pflag `duration` for an `ArgString` input (the row
supplies the duration pattern), and `int` for `-N`.

**d. `Executor`** is unchanged. The result parser is unchanged: every W2c row uses
`ResultJSON`, whose tier (a) handles the envelope and tier (b) the two bare-JSON rows.

**Why `riff` needs targeting flags (the D8 gap).** `rk riff` today (1) refuses without
`$TMUX` and (2) roots `wt create` and preset/launcher resolution at the process cwd. The MCP
executor strips `TMUX`/`TMUX_PANE` by design, and `rk mcp`'s cwd is wherever `ssh` landed
(the home directory). Without `-L`, `--session`, and `--repo` the `riff` tool would fail
100% of the time with "not inside a tmux session", and the spec's row (`riff [preset]
[--skill…] [--layout] [--count]`) is unsatisfiable. The engine already carries `Server`,
`Session`, and `RepoRoot` on `EffectiveSpec` for the daemon's `POST /api/riff`, so the
flags are thin plumbing onto existing seams, not new mechanics. `--repo` is "a filesystem
path the verb validates" (spec § Target rule) — it must be a git toplevel.

### 5. Spec fix-ups in `docs/specs/mcp.md`

Per the plan's § Pickup protocol item 2, this change edits the spec where it graduates verbs
or where shipped code proved it stale:

- **§ Allowlist v1 "Structured today" column**: `notify`, `riff`, `new_window`, `operator`,
  `cron_add`, `tab_layout`, `tab_web`, `tab_code`, `gui_exec`, `kill`, `cron_rm`,
  `cron_mute` → **yes** (`--json`), citing this change.
- **§ Receipts**: the `tab new` row keeps its shipped document `{"session","window_id",
  "pane_id"[,"ready"]}` inside `result` (the envelope rule "wraps, never reshapes" beats the
  pre-#925 `{"window","server"}` sketch); `mux new` → `{"report":"created","server",
  "ephemeral"}`; the `tab web` row spells out `{"window","index","url"?,"tabs"}`;
  `tab code set` → `code_root`; `notify` → `{"delivered":bool}` with the fail-silent note;
  `operator` and `riff` rows as in § 2 (`riff` adds `server`/`session`/`repo` inputs).
- **§ Policy table** YAML: add `type: array`, `format:` (formatted positionals) and the
  ordered-walk argv rule; record the action-enum shape `board` and `tab_web` share (a
  positional `action` enum on the parent path, flags persistent on the parent).
- **§ Target rule**: `riff` requires `server` and `repo`; `operator` requires `server`.
- `docs/specs/ui-state.md` § rk tab usage block, `docs/specs/cron.md` and `docs/specs/gui.md`
  CLI blocks: add `[--json]` where the in-scope verbs' flags are enumerated (one-token edits).

### 6. Skill bundle and site docs

`rk skill` is the MCP server's instructions block and pane agents' briefing, so the receipts
are documented where the verbs are: `app/backend/cmd/rk/skill/skill.md` § Output & exit-code
contracts gains one bullet — *"`--json` on a mutating verb prints exactly one
`{"ok":true,"result":…}` document on stdout (or `{"ok":false,"error":{code,message}}` on
failure) and changes nothing else; the verbs that carry it: …"*; `mux.md` (`kill`, `new`),
`cron.md` (`add`/`rm`/`mute`), `gui.md` (`exec --detach`), and the `rk tab` bullets get the
receipt shape inline. `docs/site/skill.md` and `docs/site/skill/*.md` are the byte-identical
mirrors and are updated in the same commit. `rk help-dump` picks the new flags up by
construction.

### 7. Plan bookkeeping

`fab/plans/sahil/26-09-10-rk-mcp.md`: the **Status** paragraph's "Next pickup" line drops
W2c from the unstarted set and names this change; the ledger row `W2c` → `In progress —
260911-fr5t` (then `Done` with the PR on merge); the § Change breakdown W2c row gets the
corrected count (13 rows, `present` excluded; `code_exec`/`new_window` policy-only; the
`riff` targeting flags and the three `internal/mcp` model extensions noted as scope that the
original row did not name).

### 8. Tests

- `cmd/rk` unit tests per verb, through the existing seams and `runMuxCmd`-style drivers:
  `--json` prints exactly one envelope document and nothing else on stdout, the human path is
  byte-identical, exit codes unchanged; the failure envelope appears on stdout for a
  `--json` usage error and a `--json` operational error (one table test over `jsonRunE`
  with a stub command); `riff`'s and `operator`'s `os.Exit` wrappers emit the envelope
  (tested via the `RK_RIFF_SUBPROC` re-exec pattern already used by `riff_test.go`).
- `internal/riff`: `Run` returns receipts for count 1 and count ≥ 2; `Branch` derivation
  and `list-panes` collection under the tmux fakes.
- `internal/mcp`: `TestTableShape` want-list → 25 names in order; every new row resolves
  against `rootCmd` (`cmd/rk/mcp_test.go`, already table-wide); `tab_web` `Format`
  rendering (with and without `slot`) and argv per action; `ArgStringArray` flag and positional mapping;
  the ordered `BuildArgv` walk keeps the seeded rows' argv; `checkFlagType` accepts
  `duration`/`stringArray`/`skill`; `kill` row exposes no `--force` (existing banned-flag
  loop).
- `cmd/rk/mcp_e2e_test.go`: the tool list is 25 names; a mutating loop on the isolated
  server — `new_window` (session `=boot`) → `tab_layout` (set `split-h:tty,web`) →
  `tab_web add` (`https://example.com`) → `kill` (the new window's pane, idle) — asserting
  each receipt's ids chain (`window_id` → `window` → `target`); `cron_add` → `cron_mute
  --for` → `cron_rm` under a temp `XDG_STATE_HOME` asserting the id chain; `notify` returns
  `{"delivered":false}` with no daemon. `riff`, `operator`, `gui_exec`, `code_exec` are
  covered by unit tests only (they need `wt`/`fab`/an X display/a code-server host).
- `just test-backend` must pass; `just build` must pass (the embed test for the skill
  bundle mirrors).

## Affected Memory

- `run-kit/mcp`: (modify) 25 seeded tools (the 13 W2c rows, their inputs, annotations, and
  description overrides), `ArgStringArray`, `Arg.Format`, the ordered `BuildArgv` walk, the widened `checkFlagType`, the doctor note,
  the extended E2E; the "what the surface does not ship" scope line shrinks to the W2a/W2b/W3
  rows and `/mcp`.
- `run-kit/architecture/cli`: (modify) the `jsonRunE` wrapper beside the existing
  `JSONResult`/`JSONError` helper; `--json` on `operator`, `notify`, `riff` (plus
  `riff`'s `-L/--session/--repo`); the `tab` family rows for `layout`/`web`/`code set`.
- `run-kit/agent-messaging`: (modify) `mux kill --json` and `mux new --json` receipts in the
  `rk mux` family contract (the family's `--json` opt-in rule).
- `run-kit/rk-riff`: (modify) `Run` returns `[]SpawnReceipt`; the CLI server/session/repo
  flags onto the existing `Server`/`Session`/`RepoRoot` seams; branch derivation.
- `run-kit/cron`: (modify) `cron add|rm|mute --json` receipts.
- `run-kit/gui`: (modify) `gui exec --detach --json` receipt and the `--json`-without-
  `--detach` usage error.
- `run-kit/toolkit-standards`: (modify) the Principle 2 machine-format coverage rows for
  the graduated verbs.

## Impact

- **Backend, `app/backend/cmd/rk/`**: `output.go` (the `jsonRunE` wrapper only — the helper exists), `riff.go` (`-L/--session/--repo`, `--json`, receipt print, exit wrapper), `mux_new.go`,
  `mux_kill.go`, `cron_add.go`, `cron_mut.go`, `tab_layout.go`, `tab_web.go` (four verbs +
  a shared family read-back), `tab_code.go`, `gui_exec.go` (+ the `--json` flag registered
  in `gui.go`'s exec flag block), `operator.go`, `notify.go`; tests alongside each; `skill/*.md`.
- **Backend, `app/backend/internal/riff/`**: `Run`/`runCount` return receipts; pane
  collection and branch derivation (two bounded `exec.CommandContext` calls).
- **Backend, `app/backend/internal/mcp/`**: `policy.go` (13 rows, model fields), `schema.go`
  (arrays, `Format`, `checkFlagType`), `exec.go` (`BuildArgv` walk), `result.go`
  (`ValidateArgs` for arrays and `Format` inputs); tests; `cmd/rk/mcp_e2e_test.go`.
- **Docs**: `docs/specs/mcp.md` fix-ups; one-token `[--json]` additions in `ui-state.md`,
  `cron.md`, `gui.md`; `docs/site/skill.md` + `docs/site/skill/*.md` mirrors; the plan doc.
- **No frontend, no API route, no tmux option, no daemon change.** `POST /api/riff` keeps its
  `Result` shape. No default CLI output changes (plan protocol item 4).
- **Dependencies**: none new. `go.mod` unchanged.
- **Parallel-change contact points**: `internal/mcp/policy.go` (W2a/W2b append rows — rebase),
  `cmd/rk/output.go` (W2a's PR #949 adds a duplicate `Envelope()` — rebase, do not resolve the duplication here), `policy_test.go`'s
  want-list (each change adds its names).
- **Constitution**: I (every new subprocess is an argv `exec.CommandContext` with a timeout;
  no shell string; `--repo` validated as a git toplevel before use; `kill --force` unexposed),
  II (nothing persisted), III (SDK owns the protocol), IV (no new route or page),
  Toolkit Standards Principle 2 (`--json` machine formats, stable and additive) and
  Principle 9 (the receipt is data, notes stay chatter).

## Open Questions

- None blocking. The one judgment call — adding `-L/--session/--repo` to `rk riff` so the
  `riff` tool can satisfy D8 — is recorded as a Confident assumption (row 6) with its
  rejected alternative; `/fab-clarify` can flip it to "defer `riff` to a follow-up change"
  before apply if Sahil prefers the CLI surface untouched.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | D1–D13 stay closed; `docs/specs/mcp.md` is design authority; every exposed verb has a row in `policy.go`; no tool bypasses a verb | Stated verbatim in the prompt and the plan's § Pickup protocol | S:95 R:90 A:95 D:95 |
| 2 | Certain | `new_window` (`tab new`) and `code_exec` (`code exec`) are policy rows only; their existing `--json` documents ride the parser's bare-JSON tier until W2a wraps them; W2c does not touch either verb's output | Prompt says so for `tab new`; spec § Envelope lists `code exec` among the verbs W2a wraps verbatim | S:90 R:85 A:90 D:90 |
| 3 | Certain | `present` gets no policy row (tier two); `tab_web add` carries the capability | Prompt + spec § Tier two | S:95 R:95 A:95 D:95 |
| 4 | Certain | W2c adds 13 policy rows (not the plan's "14" — `present` was counted before it was dropped); `Table` has 25 rows after merge (12 on main + 13); the plan row is corrected | Counted from the spec's allowlist (the 13 rows whose plan "Enters" column says W2c) and main's table | S:90 R:95 A:95 D:95 |
| 5 | Certain | W2c creates **no** envelope helper. The D5 helper is on main via W3a (PR #945): `outputSink.JSONResult`, `outputSink.JSONError`, `envelopeError`, `envelopeCodeUsage`/`envelopeCodeOperational` in `cmd/rk/output.go` — consumed as-is (re-read the file at apply entry). W2a's open PR #949 duplicates the purpose with `Envelope()`; that cleanup is not this change's | Corrected 2026-09-11 after the rebase onto main (supersedes both the "first-to-merge" and the "W2a owns it" versions of this row) | S:95 R:90 A:95 D:95 |
| 6 | Confident | `rk riff` gains `-L/--server`, `--session =S`, `--repo <dir>` so the `riff` tool can run with `$TMUX` stripped and a non-repo cwd; the policy row marks `server` and `repo` required | The executor strips `TMUX` by design and `rk mcp`'s cwd is the ssh landing dir, so the spec's `riff` row is unsatisfiable without explicit targeting; the engine already has `Server`/`Session`/`RepoRoot` seams (daemon path). **Rejected**: deferring `riff` to a follow-up change (leaves the Spawn intent's flagship tool unshipped); a tool-side cwd/TMUX injection (a bypass, forbidden by Principle 1) | S:45 R:60 A:55 D:55 |
| 7 | Confident | The failure envelope follows main's pattern (`operator_request.go`, `board.go`: the verb writes `sink.JSONError` before returning the error) through one `jsonRunE` RunE wrapper, plus explicit `JSONError` calls in the two `os.Exit` wrappers (`riff`, `operator`) | Follow existing project patterns (code-quality); the wrapper keeps twelve verbs from hand-formatting at every return. Rejected: a central `execute()` seam (diverges from the established per-verb pattern) | S:65 R:80 A:80 D:70 |
| 8 | Confident | `mux new --json` ships a receipt but **no** policy row (spec allowlist v1 has no `mux new` tool; `new_window` is `tab new`) | Plan's W2c scope lists the `mux new` receipt; spec (authority) lists no row; D3 says verbs ship unexposed by default | S:70 R:85 A:80 D:80 |
| 9 | Confident | `tab_web` follows W3b's `board` precedent (positional `action` enum on the parent path `tab web`, `--show`/`--json` persistent on the parent, per-action requirements enforced by the verb); `internal/mcp` gains only `Arg.Format` (formatted positional for `@N/web/<n>`), `ArgStringArray`, an ordered single-walk `BuildArgv`, and a widened `checkFlagType` (`duration`, `stringArray`/`stringSlice`, riff's `skill`) — no variant model | `board` already shipped the action-enum shape; a second mechanism would be duplication. The composite slot address, repeated `--skill`, variadic `args`, and `--detach -- <cmd>` ordering are the only gaps left | S:65 R:75 A:85 D:75 |
| 10 | Confident | Every `tab web` mutation receipt carries `window`, `index`, and `tabs` (the post-mutation family in `tab web ls --json`'s entry shape); `add` also carries `url` | Spec § Receipts: "plus the resulting addressed state the verb already prints in prose (… web-tab list …)"; `rm`/`select` print nothing today so the family read-back is the only state to return | S:55 R:80 A:70 D:65 |
| 11 | Confident | `notify --json` prints `{"delivered":bool}`; a swallowed failure is `delivered:false` with exit 0 — the fail-silent contract is unchanged | Spec receipt is `{"delivered":true}`; the verb cannot both stay fail-silent (exit 0, spec-documented in the skill bundle) and report failure except through the field's value | S:60 R:85 A:75 D:70 |
| 12 | Confident | `cron add --json` returns exactly the four spec fields as the human line's strings (`schedule` via `cronScheduleSummary`, `target` via `cronTargetSummary`) | Spec: "the four fields the human line already prints"; the structured `cron list --json` record stays the way to read an entry back | S:75 R:85 A:80 D:75 |
| 13 | Confident | `gui_exec` argv is `gui exec --detach --json -- <command> <args…>` with `command` + `args` (string array) inputs; `gui exec --json` without `--detach` is a usage error | Spec: fixed `--detach`, the foreground path returns no receipt; `--` keeps dash-prefixed program args out of flag parsing | S:65 R:80 A:80 D:75 |
| 14 | Confident | `riff`'s receipt derives `branch` with `git -C <worktree> rev-parse --abbrev-ref HEAD` and `panes` with `tmux list-panes -t <@N> -F '#{pane_id}'`; `riff.Run` returns `[]SpawnReceipt` while the daemon `Spawn` path keeps its `Result` | `wt create` prints a `Path:` line but no branch; the engine resolves only pane 0 today; both derivations are one bounded argv exec each | S:60 R:85 A:80 D:75 |
| 15 | Confident | `cron_add` exposes `pinned`, `deliver`, `if_absent` limited to the values `skip` and `notify`, and does not expose `--respawn` / `if-absent respawn` | `--respawn` is an argv array (a command to run at fire time) — the same class of input the spec excludes for `riff --cmd`; tier-two material if usage asks | S:60 R:85 A:75 D:75 |
| 16 | Confident | Spec fix-ups: the `tab new` receipt row is corrected to the shipped `{session, window_id, pane_id[, ready]}` document; `mux new`, `tab web`, `tab code`, `notify`, `operator`, `riff` rows are spelled out; `actions:`/`type: array`/`format:` join the policy YAML; `riff`/`operator` join the target-rule list | Plan § Pickup protocol item 1 (a stale spec gets a fix-up) and item 2 (a graduating change updates "Structured today") | S:70 R:80 A:85 D:80 |
| 17 | Confident | `operator --json` prints `{"window","server","created"}` on all three success branches, resolving the created window's `@N` via `display-message -t <pane> -p '#{window_id}'`; the kickoff-delivery warning and the tick-seed warning stay on stderr with exit 0 | Spec receipt row; the verb already has the pane id and the singleton probe already yields the `@N` | S:65 R:85 A:80 D:80 |
| 18 | Confident | Description overrides ship for `riff`, `new_window`, `operator`, `cron_add`, `gui_exec`, `kill`, `notify`; other rows use Cobra `Short`+`Long` | Spec § Policy table: override only where terminal prose misleads a model; these seven have MCP-specific constraints (required targets, no force, fail-silent, always detached) their help does not state | S:60 R:90 A:75 D:75 |
| 19 | Confident | Test plan: per-verb `--json` unit tests through existing seams, `internal/mcp` model tests, `TestTableShape` → 25, and an E2E mutating loop (`new_window` → `tab_layout` → `tab_web add` → `kill`; `cron_add` → `cron_mute` → `cron_rm`; `notify` with no daemon) on the isolated server; `riff`/`operator`/`gui_exec`/`code_exec` unit-only | Code-quality rule (tests for changed behavior); the W1 E2E harness already builds the real binary against an isolated server; the four unit-only tools need external binaries the test box cannot assume | S:65 R:85 A:80 D:80 |

19 assumptions (5 certain, 14 confident, 0 tentative, 0 unresolved).
