# Intake: rk MCP Spec — W0 of the rk MCP plan

**Change**: 260910-t9hb-mcp-spec
**Created**: 2026-09-10

## Origin

One-shot `/fab-new` invocation executing row **W0 (`mcp-spec`)** of the plan doc
`fab/plans/sahil/26-09-10-rk-mcp.md` (written 2026-09-10 from the clever-cougar
`/fab-discuss` ACP-evaluation thread). Raw input:

> Execute row W0 ("mcp-spec") of fab/plans/sahil/26-09-10-rk-mcp.md. Read the whole plan doc
> first (Decision log -- D1-D3, D10, D13 are Confirmed; D4-D9, D11-D12 are proposed/open), the
> Allowlist v1 table, the Change breakdown, and the Pickup protocol. This is a spec-only change
> (no Go code): create docs/specs/mcp.md (roles, D3-D9 as normative text, the envelope, the
> policy-table schema, the allowlist v1, the never-tools list, the timeout contract, the /mcp
> stance per D10 -- now confirmed yes, /mcp is built in W4). Amend docs/specs/api.md (route /mcp,
> and record the streamable-HTTP transports POST+GET+DELETE as a documented exception to
> Constitution IX Uniform HTTP Verb), docs/specs/cli-layering.md (the rk mcp verb, the two new
> families operator request and board), docs/specs/agent-messaging.md (the send --json receipt
> is a fourth door onto the same engine, not a new lane). Per the pickup protocol: this spec,
> once merged, supersedes the plan doc as design authority for W1 onward -- write it as a
> standalone normative document, not a summary of the plan. Update the plan docs own Status
> line and your W0 row when you merge.

**Design authority for this intake**: the plan doc's Decision log (D1–D13), its Allowlist v1
table, its Constitution mapping, its Risks, and its Pickup protocol. The plan says: "Until W0
lands, this doc is the design authority; after W0 the spec is `docs/specs/mcp.md` and this doc
owns only the execution shape: decision log, allowlist, change breakdown, waves, gates."

**Code fact-checks performed at intake** (the spec must state what the CLI *is*, not what the
plan believed — three plan statements are stale):

| Plan claim | Reality (verified in `app/backend/cmd/rk/`) | Consequence for the spec |
|---|---|---|
| "`mux panes`, `status` … do not [have `--json`]" | `mux_panes.go:62` and `status.go:83` both register `--json` | Both verbs are already MCP-shaped read verbs; the spec's allowlist marks them "structured output: yes". The plan's W2a row shrinks to `mux snapshot list` + `gui shot` (noted in the plan-doc update, § What Changes 6) |
| "`mux send` prints nothing on success" | `mux_send.go:355` prints a report word + pane id on stdout (`delivered %5` / `staged %5` / `sent %5`), diagnostics on stderr (agent-messaging.md § Report-word contract) | The `send --json` receipt (D6) wraps this frozen report-word vocabulary; it does not invent one |
| "`POST /api/windows/{id}/send` already returns a JSON body [with delivery evidence]" | `api/send.go:132` returns `{"ok":true}` on 200; 409s carry `{"error","code"}` with `code ∈ {probe_failure, staged_send_failure, submit_unverified}` | The receipt's failure vocabulary reuses exactly these three `code` tokens; success evidence is the CLI report word — one engine, one evidence vocabulary |

Other verified anchors the spec cites: exit-code convention (`cmd/rk/exit_code.go`: 0 success /
1 operational / 2 usage; riff adds 3 subprocess in `internal/riff`); `rk help-dump` frozen node
shape `{name, path, short, usage, text, commands}` (`help_dump.go`, pure Cobra introspection);
`rk skill [topic]` bundle with topics `code|display|gui|messaging|mux` + reserved `topics`
(`skill.go`); own-tab resolution reads the ORIGINAL `$TMUX` and fails closed when unset
(`owntab.go` `callerContext` → `ok=false`); `-L` resolution rule = explicit `-L` > caller's
`$TMUX` socket basename > `default` (`mux.go` `muxServer`); the nine operator templates in
`api/operator.go` (`fix-tab-name`, `spawn-task`, `find-discussion`, `brief-me`, `whats-stuck`,
`color-tabs`, `update-annotations`, `annotate-tab`, `user-message`) with registry declarations
`requiresAgentSessionRef` / `acceptsText` / `serverScoped` / `requiresWaiting` /
`acceptsSession` / `chatDelivery`, served by `POST /api/windows/{windowId}/operator-request`
(window-scoped) and `POST /api/operator-request` (server-scoped), body
`{template, text?, session?}`, busy ⇒ `202 {"queued":true}`; the five board routes
(`GET /api/boards`, `GET /api/boards/{name}`, `POST /api/boards/{name}/pin|unpin|reorder`),
mutation bodies `{server, windowId}` and `{server, windowId, before?, after?}`, entry shape
`{server, windowId, session, windowIndex, windowName, orderKey, panes?}`; the CLI→daemon
`resolveOrigin(ctx)` pattern (`cmd/rk/origin.go`, used by `notify.go`, `present.go`,
`tab_wake.go`); the root-router CORS allowlist `[GET, POST, OPTIONS]` applied globally
(`api/router.go:842`); no `rk mcp`, `rk board`, or `rk operator request` exists today; no MCP
SDK is in `go.mod` (Cobra v1.10.2 is).

The two earlier MCP-rejection intakes the plan cites (`260416-0gz9`, `260714-popk`) are not in
this repo's `fab/changes/archive/` — the spec cites the plan doc for that history rather than the
intakes directly.

## Why

**The problem.** A chat client with no shell on the box — the Claude desktop app first, any MCP
client on the tailnet later — cannot see or steer the run-kit estate. Every existing door (the
web dashboard, `rk` verbs, the daemon API) assumes either a browser or a shell. The plan's
answer is an MCP server that is a *mechanical proxy* over a curated allowlist of existing `rk`
verbs. That answer is now a set of confirmed and proposed decisions spread across a plan doc
whose job is execution shape, not design.

**Why a spec, and why first (W0).** Six later changes (W1 `rk-mcp-stdio`, W2a/b/c CLI shaping,
W3a/b new verbs, W4 `/mcp`) will each be built by an agent reading only the intake it is
handed plus the always-load layer. Without a normative spec, each of them would re-derive the
envelope shape, the policy-table schema, the timeout contract, and the target rule from a plan
doc that (a) is stale in three places already, and (b) mixes design with waves and gates. The
pickup protocol makes the spec the single design authority after W0 precisely so W1–W4 stop
reading the plan for design. A spec also makes the design *reviewable* on its own: Sahil
confirms D4–D9 by merging normative text, not by ticking a table.

**What happens without it.** The W1 agent invents an envelope; the W2b agent invents a second
receipt shape for `send` (the plan's explicit risk: "two `send` receipts"); the W4 agent
mounts `/mcp` without the recorded Constitution IX exception, or with an auth surface nobody
decided on; the allowlist drifts because no document says a tool without a policy row is
forbidden. Each is a design decision leaking into an implementation change.

**Why amend three existing specs rather than only add one.** `api.md` owns the route table
and the verb-shape principle `/mcp` breaks; `cli-layering.md` owns which verbs rk has and why
(two new families need a home there, and `rk mcp` is a new root verb); `agent-messaging.md`
owns the single-engine invariant the `send` receipt must not violate. Leaving those specs
silent would make `mcp.md` contradict them by omission.

## What Changes

Spec-only. No Go, no tests, no frontend. Six edits: one new spec, three spec amendments, one
index row, one plan-doc update.

### 1. New `docs/specs/mcp.md` — the normative MCP spec

Written as a **standalone normative document** (RFC 2119 MUST/SHALL/SHOULD/MAY), in the house
style of `agent-messaging.md` and `cli-layering.md` (a `>` provenance blockquote under the H1,
tables for matrices, prose for invariants, a Non-goals section). It cites the plan doc once, in
the provenance note, and never says "per the plan" in normative text — the spec *is* the
authority. Target length: comparable to `agent-messaging.md` (~250 lines); tables carry the
bulk.

#### 1.1 Provenance + authority note

`> Decided 2026-09-10 (clever-cougar discussion → fab/plans/sahil/26-09-10-rk-mcp.md). This spec is the design authority for the rk MCP surface; the plan doc owns execution shape only (waves, gates, change rows). Companions: cli-layering.md (rk owns the substrate verbs), agent-messaging.md (the single injection engine), api.md (the route table).`

#### 1.2 Roles

A short table of the five actors and what each may do:

| Role | Is | Owns |
|---|---|---|
| **MCP client** | Claude Desktop (stdio over `ssh <box> rk mcp`), Claude Code or any MCP client on the tailnet (streamable HTTP at `/mcp`) | Tool selection, confirmation UX driven by annotations, its own call timeout |
| **MCP server** | `internal/mcp` in the `rk` binary, reached as `rk mcp` (stdio) or the daemon's `/mcp` handler | The policy table, schema generation, argv execution, envelope parsing, `isError` mapping, the 45 s cap. Holds **no** state beyond the live transport |
| **`rk` verbs** | The CLI — the single contract | Behavior, validation, exit codes, `--json` envelope, receipts. Every tool is exactly one verb invocation |
| **Daemon** | `rk serve` | Reached only *through* verbs that already call it (`notify`, `present`, `operator request`, `board`, `tab wake`); hosts `/mcp` |
| **Substrate** | tmux + agent panes | Untouched: MCP reads agent state via the same verbs any pane agent uses |

#### 1.3 Principles (normative core)

Each of D2–D9 becomes one or more numbered MUST statements. Exact content:

1. **The CLI is the single contract (D2).** Every MCP tool SHALL execute exactly one `rk` verb.
   A tool MUST NOT call `internal/` packages, the daemon API, or tmux directly. Where a
   capability exists only as a daemon route, the CLI verb is added first and the tool proxies
   it (this is why `rk operator request` and `rk board` exist — § 1.9). Pane agents therefore
   inherit every improvement made for MCP.
2. **Allowlist, default-excluded (D3).** A verb is exposed if and only if it has a row in the
   compiled-in policy table. New verbs ship unexposed. The v1 table is § 1.8; the budget is
   ≤ 40 tools (clients degrade above that), v1 ships 29.
3. **Flat tools (D4).** One tool per verb, named in `snake_case` from the verb path with the
   family prefix dropped where unambiguous (`mux sessions` → `sessions`, `cron list` →
   `cron_list`, `tab web ls` → `tab_web_ls`). The one action-enum tool is `tab_web`
   (`add|rm|select|mv` share one `@N/web/<n>` addressing grammar — splitting them would be four
   tools with identical schemas). No other tool takes an action enum.
4. **Opt-in `--json` envelope (D5).** § 1.5. Human output is never changed by this spec; a
   change that alters default CLI output is out of scope.
5. **Receipts only behind `--json` (D6).** § 1.6. The human CLI stays as silent or as terse on
   success as it is today.
6. **Timeout cap and never-returning verbs (D7).** § 1.7.
7. **Explicit target (D8).** § 1.4.
8. **argv exec, no Cobra re-entry (D9).** The server executes each tool as a child process
   `os.Executable()` + argv slice via `exec.CommandContext` with the tool's timeout
   (Constitution I + Process Execution). Cobra flag globals are not re-entrant, so in-process
   re-entry is forbidden. Schemas are generated by introspecting the Cobra tree **in-process at
   startup** (read-only, the `help-dump` pattern) — introspection is not execution.
9. **Protocol via the official SDK (D11).** The MCP wire protocol, both transports, and tool
   annotations come from `github.com/modelcontextprotocol/go-sdk`, pinned in `go.mod`. run-kit
   writes no protocol code (Constitution III).

#### 1.4 Target rule (D8)

- The MCP server has no pane, no `$TMUX`, no `$TMUX_PANE`. Therefore **no own-pane or own-tab
  default reaches any tool schema**: every pane- or window-scoped tool declares its target as a
  **required** input (`target` for pane verbs: `%N`, `@N`, or `=session:window`; `window` for
  `tab *`, `present`, `operator request --window`, `board pin|unpin|reorder`: `@N`). `cron_add`
  requires exactly one of `pane` / `session` / `role`.
- The CLI already fails closed when own-tab resolution finds no `$TMUX` (`callerContext`
  `ok=false`); the tool layer makes the argument required at the schema level so the model never
  sees that error.
- **Server selection**: every tool whose verb accepts `-L` exposes an optional `server` string
  input mapped to `-L <server>`. Absent ⇒ the verb's own rule applies, which with no `$TMUX`
  means `default`. The `sessions` tool's result carries server names so a model can discover
  what to pass.
- No tool ever takes a shell string, a raw tmux target expression beyond the three forms above,
  or a filesystem path outside what the verb already validates.

#### 1.5 The `--json` envelope (D5) — exact schema

On stdout, one JSON document, nothing else on stdout; diagnostics remain on stderr:

```json
{ "ok": true,  "result": <verb-defined> }
{ "ok": false, "error": { "code": "usage" | "operational", "message": "<one line>", "hint": "<optional next step>", "reason": "<optional verb-defined token>" } }
```

Rules:
- `ok` mirrors the exit code: exit 0 ⇔ `ok:true`; exit 2 ⇔ `code:"usage"`; exit 1 (and riff's
  3) ⇔ `code:"operational"`. **Exit codes are unchanged by `--json`.**
- `result` is the verb's own shape. Verbs that already emit `--json` today (`mux sessions`,
  `mux panes`, `mux capture`, `mux process`, `status`, `cron list`, `gui status`, `gui windows`,
  `tab show`, `tab web ls`, `code exec`, `code hosts`, `doctor`, `daemon status`) keep their
  current document **verbatim inside `result`** — the envelope wraps, it does not reshape.
  (Their unwrapped form is retired at the same time; there is no compatibility flag.)
- `error.message` is the same text the human path prints to stderr. `error.hint` is optional
  and machine-neutral ("call again", "press Enter in the pane"). `error.reason` is an optional
  verb-defined machine token (the `send` receipt uses `probe_failure` / `staged_send_failure` /
  `submit_unverified`).
- `--json` is **opt-in on every verb**; a verb without the flag is not envelope-capable and the
  policy table MUST mark it `result: text` (§ 1.8 "structured" column) until it gains the flag.
- One helper in `cmd/rk` (`output.go` is the natural home — it already owns the report-word
  sink) emits the envelope; verbs never hand-format it.

#### 1.6 Receipts (D6) — what `result` carries per family

| Family | Verb(s) | `result` on success |
|---|---|---|
| Talk | `mux send` | `{"report":"delivered"\|"staged"\|"sent","target":"%N","server":"<name>","enter":bool,"await":{"report":"idle"\|"waiting"\|"running"\|…, "elapsed_ms":n}?}` — `report` is the frozen report word the human path prints; `await` present only with `--await`. Failure: `ok:false`, `code:"operational"`, `reason ∈ {probe_failure, staged_send_failure, submit_unverified}` — the same three tokens `POST /api/windows/{id}/send` returns as its 409 `code` |
| Talk | `mux send --answer` / `--key` | Same shape; `report:"sent"` for key-only sends |
| Talk | `mux await` | `{"report":"idle"\|"waiting"\|"ready"\|"parked"\|"narrow"\|"file"\|"gone"\|"running","target":"%N","elapsed_ms":n,"detail":"<state|echo|WxH>"?}`; `running` is a **success** result (`ok:true`) — the wait expired, nothing failed |
| Spawn | `riff` | `{"windows":[{"id":"@N","name":"…","server":"…","panes":["%N",…],"worktree":"/abs/path","branch":"…"}]}` |
| Spawn | `tab new`, `mux new` | `{"window":"@N","server":"…"}` / `{"server":"<name>"}` |
| Spawn | `cron add` | `{"id":"<entry id>"}` |
| Spawn | `operator` | `{"window":"@N","server":"…","created":bool}` (idempotent — `created:false` when the operator already existed) |
| Steer UI | `tab layout`, `tab web *`, `tab code set`, `present` | `{"window":"@N", …the resulting addressed state the verb already prints in prose (layout string, web tab list, code root, presented target)}` |
| Steer UI | `code exec`, `gui exec` | `code exec` keeps its existing `--json` document; `gui exec` returns `{"pid":n,"command":"…"}` |
| Clean up | `mux kill` | `{"report":"killed","target":"%N"}` |
| Clean up | `cron rm`, `cron mute` | `{"id":"…","removed":true}` / `{"id":"…","muted":bool,"until":"<RFC3339>"?}` |
| Talk | `notify` | `{"delivered":true}` |
| Talk | `operator request` | `{"template":"…","window":"@N"?,"queued":bool}` — `queued:true` ⇔ the daemon answered `202` |
| See/Steer | `board show` | `GET /api/boards[/{name}]` body verbatim; `board pin|unpin|reorder` → `{"board":"…","window":"@N","orderKey":"…"?}` |

The exact field lists for the W2b/W2c verbs are fixed by those changes' plans within these
shapes; the spec fixes the **vocabulary rule**: a receipt reuses the report word or HTTP field
name that already exists for the same fact, and never introduces a synonym.

#### 1.7 Timeout contract (D7)

- One named constant, `internal/mcp.ToolTimeoutCap = 45 * time.Second`. Every policy row's
  `timeout` MUST be ≤ the cap; the default is the cap.
- **Bounded-wait verbs** (`await`, `send --await`): the tool's `timeout` input is clamped to
  `cap − 5 s` (40 s) and passed as `--timeout`, so the verb itself reports `running` before the
  proxy deadline; the result carries `hint:"call again"`. The proxy deadline is a backstop
  only: if it fires, the tool returns `ok:false, code:"operational", reason:"timeout"`.
- **Never-returning verbs are never tools**: `serve`, `daemon run`, `gui supervise`,
  `cron tick`, and anything else that blocks by design (§ 1.8 never-tools).
- On deadline the child is killed (`exec.CommandContext` semantics); no tool leaves a process
  behind.
- The cap is revisited after W1 usage; changing it is a one-constant change.

#### 1.8 Policy table — schema, allowlist v1, tiers, never-tools

**Schema** (compiled-in Go, one entry per tool; shown as YAML for readability):

```yaml
tool: capture                 # MCP tool name — snake_case, unique, stable
path: mux capture             # Cobra command path; MUST resolve at startup (test-enforced)
args:                         # ordered input → argv mapping
  - { name: server, flag: "-L", type: string }                 # optional unless required: true
  - { name: target, positional: 1, type: string, required: true, pattern: "^(%\\d+|@\\d+|=.+:.+)$" }
  - { name: lines,  flag: "-l", type: integer, minimum: 1, maximum: 2000 }
  - { literal: "--json" }                                        # fixed argv appended
stdin: null                   # or the name of a string input streamed on stdin (send: message)
result: json                  # json | text | image  — how stdout becomes MCP content
annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false }
timeout: 45s                  # ≤ ToolTimeoutCap
description: null             # optional override of Cobra Short/Long when the terminal prose misleads a model
```

Rules: `result: json` parses the envelope and returns `result` as a JSON text block (or the
error as `isError:true` with `message` + `hint`); `result: text` returns stdout verbatim and
maps exit code → `isError` (the interim `send` in W1); `result: image` reads the PNG at the
path named in `result.path` and returns an image content block plus the JSON (for `gui_shot`).
A startup test asserts every row's `path` resolves to a live Cobra command and every `flag`
exists on it (the allowlist-drift guard). `description` overrides are per-row; CLI help is
never rewritten for the model.

**Allowlist v1** — 29 rows. Annotation columns: ro = `readOnlyHint`, destr = `destructiveHint`,
idem = `idempotentHint`. "Structured" = the verb emits machine output today (verified at
intake); rows marked *no* enter the table with `result: text` and graduate to `json` when
their verb gains `--json`. The spec carries **no wave column** — waves are the plan's.

| Intent | Tool | `rk` verb | Ann. | Structured today |
|---|---|---|---|---|
| See | `sessions` | `mux sessions --json` | ro | yes |
| See | `panes` | `mux panes --json` | ro | yes |
| See | `capture` | `mux capture <target> --json` | ro | yes |
| See | `process` | `mux process <target> --json` | ro | yes |
| See | `status` | `status --json` | ro | yes |
| See | `snapshot_list` | `mux snapshot list [server]` | ro | no |
| See | `cron_list` | `cron list --json` | ro | yes |
| See | `gui_status` | `gui status --json` | ro | yes |
| See | `gui_shot` | `gui shot` → image block | ro | no |
| See | `tab_show` | `tab show @N --json` | ro | yes |
| See | `tab_web_ls` | `tab web ls @N --json` | ro | yes |
| Talk | `send` | `mux send <target> -` (body on stdin) | — | report word (text) |
| Talk | `answer` | `mux send <target> --answer` / `--key <k>` (bounded enum) | — | report word (text) |
| Talk | `await` | `mux await <target> --until … --timeout ≤40` | ro | report word (text) |
| Talk | `notify` | `notify <message> [--title]` | — | no |
| Talk | `operator_request` | `operator request <template> [--window @N] [--text] [--session]` | — | new verb |
| Spawn | `riff` | `riff [preset] [--skill…] [--layout] [--count]` — `--cmd` excluded: a pane shell command is a shell string | — | no |
| Spawn | `new_window` | `tab new [--session =S] [--cwd] [--name] [--layout]` | — | no |
| Spawn | `operator` | `operator [--workers] [-L]` | idem | no |
| Spawn | `cron_add` | `cron add <prompt> (--every\|--backoff\|--cron) (--pane\|--session\|--role)` | — | no |
| Steer UI | `tab_layout` | `tab layout @N [L \| --add S \| --rm S \| --promote S \| --cycle]` | — | no |
| Steer UI | `tab_web` | `tab web add\|rm\|select\|mv` (action enum) | — | no |
| Steer UI | `tab_code` | `tab code set @N <folder>` | — | no |
| Steer UI | ~~`present`~~ | moved to tier two at PR review: `present` resolves only the caller's own tab (no `@N` form) — `tab_web add` covers it | — | — |
| Steer UI | `code_exec` | `code exec <command> [json-arg…] --json` | — | yes |
| Steer UI | `gui_exec` | `gui exec --detach <cmd> [args…]` (fixed `--detach`; the foreground path execs and returns nothing) | — | no |
| Clean up | `kill` | `mux kill <target>` | destr | report word (text) |
| Clean up | `cron_rm` | `cron rm <id>` | destr | no |
| Clean up | `cron_mute` | `cron mute <id> [--for] [--off]` | idem | no |
| See/Steer | `board` | `board show [name]` / `pin` / `unpin` / `reorder` (action enum, the second and last) | — | new verb |

Note `tab_web` and `board` are the two action-enum tools; the spec states `board` joins
`tab_web` as an allowed enum because its four verbs share one `(board, @N)` addressing pair.
`mux kill --force` is **not** exposed (the gate matrix stays in force over MCP). The `answer`
tool's `key` input is a closed enum: `Enter Escape Tab Up Down Left Right Space BSpace y n
1 2 3 4 5 6 7 8 9`; control chords (`C-c`, `C-d`, `C-z`) are excluded — interrupting an agent
is `kill`'s job, a destructive tool the client confirms. (The enum is this intake's
enumeration of the plan's "bounded set" — dialog navigation plus yes/no/numbered menus;
W2b MAY widen it.)

**Tier two** (rows added only when usage asks; each needs a policy row like any other):
`mux snapshot show|restore`, `mux adopt`, `mux reap`,
`gui on|off|launch|open|windows|wait|click|type|key`, `doctor --json`, `code-server start`,
`daemon status --json`, `code hosts`, `code commands`.

**Never tools** (MUST NOT gain a policy row): `serve`, `daemon *` (except `status`, tier two),
`remote *`, `desktop *`, `update`, `agent setup|hook`, `mux guard|init-conf`, `completion`,
`shell-init`, `help-dump`, `skill` (served as the server's instructions, § 1.10), `role`,
`tutorial`, `cron tick`, `gui supervise|env`, `mcp` itself.

#### 1.9 The two new verb families (why they exist, their shape)

Both exist because their capability is a daemon route with no CLI door, and principle 1
forbids a tool that bypasses a verb. Both are thin wrappers over the daemon via the existing
`resolveOrigin(ctx)` pattern.

- **`rk operator request <template> [--window @N] [--text <t>] [--session <s>] [--list] [--json]`**
  — a subcommand of the existing `operator` verb. `--list` prints the closed template registry
  (id + which of `requiresAgentSessionRef`/`acceptsText`/`serverScoped`/`requiresWaiting`/
  `acceptsSession`/`chatDelivery` it declares). Window-scoped templates require `--window` and
  ride `POST /api/windows/{id}/operator-request`; server-scoped templates reject `--window` and
  ride `POST /api/operator-request`. The daemon's 400/404/409 messages pass through as
  `operational` errors; `202 {"queued":true}` surfaces as `result.queued:true`, exit 0. The
  verb adds **no** third lane: it is a CLI door onto the existing request lane
  (agent-messaging.md § three lanes).
- **`rk board show [name] [--json]` · `rk board pin <name> <@N>` · `rk board unpin <name> <@N>` ·
  `rk board reorder <name> <@N> [--before <@N>] [--after <@N>]`** — a new root family (flat,
  like `tab`). Over `GET /api/boards`, `GET /api/boards/{name}`, and the three `POST` routes;
  `-L`/`--server` fills the `server` body field. `show` without a name lists boards.

#### 1.10 Server instructions and discovery

- The server's MCP `instructions` field is the output of `rk skill` (the full bundle), captured
  at startup. The topic pages are not tools.
- Tool `description` defaults to the Cobra `Short` + `Long` of the verb; a row MAY override.
- Tool list is static for the life of a server process (no `listChanged` notifications).

#### 1.11 Transports

- **`rk mcp`** — stdio; a new visible root verb (cli-layering.md's "stays flat" set grows by
  one). No flags in v1. The Claude Desktop connector command is `ssh <box> rk mcp`. Doctor
  gains a row that lists tools and confirms every policy row resolves.
- **`/mcp`** — the SDK's streamable-HTTP handler mounted on the daemon router (D10,
  confirmed). Same `internal/mcp` policy table and executor as stdio. Stance:
  - **Tailnet-only, no auth of its own** — the same posture as every other daemon route; `/mcp`
    is never exposed publicly (the Claude Desktop remote connector requires a public hostname
    and is therefore *not* this route's client — its client is Claude Code and other MCP
    clients already on the tailnet).
  - **Origin validation**: when a request carries an `Origin` header, the handler MUST reject
    origins that are not the daemon's own origin or a loopback origin (the MCP transport
    spec's DNS-rebinding guard, Constitution I). The root router's CORS allowlist
    `[GET, POST, OPTIONS]` is **unchanged** — MCP clients are not browsers.
  - **Verb-shape exception**: the transport requires `POST` (client→server messages), `GET`
    (server→client SSE stream), and `DELETE` (session termination) on one path. This is a
    documented exception to Constitution IX recorded in `api.md` (§ 2 below); it is
    transport-mandated, scoped to `/mcp` alone, and grants nothing to `/api/*`.
  - `rk url --mcp` prints the `/mcp` URL for the resolved daemon origin (new flag on the
    existing `url` verb); doctor gains a row for the route.
  - Constitution II: the handler holds per-connection SDK session state in memory for the
    connection's life only; nothing persists.

#### 1.12 Security mapping, Non-goals, Deferred

- **Security** (one paragraph per Constitution principle touched): I — allowlist, argv exec,
  destructive hints, no shell strings, no public `/mcp`, Origin check; II — compiled-in policy,
  no state; III — SDK; IV — one verb + one route + ≤ 40 tools; IX — the recorded exception;
  X — MCP reads agent state via verbs, pushes nothing.
- **Non-goals**: ACP (D13 — a separate plan if ever); any tool that bypasses a verb; changing
  default CLI output; an auth layer on `/mcp`; per-family action-enum tools beyond `tab_web`
  and `board`; exposing `mux kill --force`, `mux reap`, `cron tick`, or any never-tool; MCP
  resources or prompts in v1 (tools only).
- **Deferred, named not designed**: MCP resources for pane captures (a read model without a
  call); `listChanged` when the policy table becomes configurable; remote (public) exposure.

### 2. Amend `docs/specs/api.md`

- **Design Principles** → after principle 1 ("POST for all mutations") add a sentence:
  "One documented exception: `/mcp` (below) is bound by the MCP streamable-HTTP transport to
  `POST` + `GET` + `DELETE` on a single path. The exception is scoped to that route alone and
  does not extend to `/api/*`."
- **New section `### MCP`** (before "SPA Fallback") with `#### /mcp`: methods table
  (`POST` client→server JSON-RPC, `GET` server→client SSE stream, `DELETE` session end),
  handler = the official Go SDK's streamable-HTTP handler sharing `internal/mcp`; tailnet-only,
  no auth; Origin validation rule; CORS allowlist unchanged; a pointer to `mcp.md` for tools,
  policy, envelope. State plainly: "**Constitution IX exception** — this is the only route on
  the daemon that uses a verb other than `GET`/`POST`; the transport mandates it; recorded here
  so the constraint is visible where the route table lives."
- **Route Summary** → add rows `POST|GET|DELETE` · `/mcp` · `mcp.go` · "MCP streamable-HTTP
  transport (Constitution IX exception, see § MCP)". Also add the existing-but-unlisted routes
  the spec relies on so the table is honest: `GET /api/boards`, `GET /api/boards/{name}`,
  `POST /api/boards/{name}/pin|unpin|reorder`, `POST /api/windows/{windowId}/operator-request`,
  `POST /api/operator-request`, `POST /api/windows/{windowId}/send`, `POST /api/notify`,
  `POST /api/riff` — one row each, handler file from `api/router.go`. (These rows are
  additive and verifiable against the router; the MCP spec cites them, so a table missing them
  would misstate what the tools proxy.)

### 3. Amend `docs/specs/cli-layering.md`

- **The model** table, Substrate row: append "MCP proxy (`rk mcp`, the `/mcp` route) — a
  mechanical door onto the same verbs, never a second contract (mcp.md)".
- **Stays flat (deliberately)**: add `mcp` (stdio MCP server — a transport, typed by connector
  configs, not by humans; hidden would break `ssh <box> rk mcp` discoverability in docs) and
  `board` (new family; flat like `tab`, with which it shares the `@N` grammar).
- **New subsection `### New families for API-only capabilities`** under the rk grouping plan:
  a two-row table — `rk operator request` (subcommand of `operator`; wraps the two
  operator-request routes) and `rk board show|pin|unpin|reorder` (wraps the five board routes)
  — with the rule that motivates them: "a capability that exists only as a daemon route gets
  a CLI verb before it gets any other door (mcp.md principle 1); the verb is the contract, the
  route is its implementation".
- **Delegation rules** item 4 (what fab may assume of rk): no change — MCP is not a fab
  consumer. Add one sentence to the Non-goals: "No MCP tool that is not an `rk` verb; the MCP
  server is a consumer of this layer, not a third layer."

### 4. Amend `docs/specs/agent-messaging.md`

- **The model** table, Surface row: after "The daemon routes … are HTTP doors onto the same
  engine, not a second standard." add: "The MCP `send`/`answer`/`await` tools (mcp.md) are a
  **fourth door** — `rk mux send --json` executed as argv — onto the same engine; the `--json`
  receipt is the frozen report word plus the engine's evidence, never a new lane."
- **Messaging the operator — three lanes**: add a sentence after the table: "`rk operator
  request` (mcp.md § new families) is a CLI door onto the **request** lane — same registry,
  same busy ⇒ 202 posture surfaced as `queued:true` — not a fourth lane. The lane count stays
  three."
- **Report-word contract is frozen** bullet: append "`--json` wraps the report word in the
  toolkit envelope (`{"ok":true,"result":{"report":"delivered",…}}`); the word itself and the
  exit code are unchanged. Failure reasons reuse the `/send` route's 409 codes
  (`probe_failure`, `staged_send_failure`, `submit_unverified`) — one engine, one evidence
  vocabulary."
- **Channel matrix**, Conversation row: replace "MCP bridge (e.g. `codex mcp-server`)" wording
  to distinguish direction: "Outbound MCP bridge (e.g. `codex mcp-server`) — tool-mediated
  dialogue is not pane-driving. The *inbound* direction (a chat client driving run-kit) is
  `rk mcp` (mcp.md)."

### 5. `docs/specs/index.md`

Add one Project Specs row (alphabetical position after Code Bridge / before CLI Layering as the
table is roughly grouped, or wherever the maintainer's ordering puts "MCP"):
`| [MCP](mcp.md) | The rk MCP server — a mechanical, allowlisted proxy over rk verbs for chat clients with no shell on the box: roles, the CLI-as-contract and argv-exec principles, the opt-in --json envelope and receipts, the 45 s timeout contract, the explicit-target rule, the compiled-in policy-table schema, the 29-tool allowlist v1 + tier two + never-tools, and the two transports (rk mcp stdio, /mcp streamable HTTP with the Constitution IX exception) |`

### 6. Update `fab/plans/sahil/26-09-10-rk-mcp.md`

Per the pickup protocol ("Update the Status line and your row when you create/merge a change"):

- **Status line** → at intake: "W0 in flight (260910-t9hb-mcp-spec)"; at merge (ship): "W0
  merged (PR #N) — `docs/specs/mcp.md` is now the design authority; this doc owns execution
  shape only. Next pickup: W1 (`rk-mcp-stdio`)."
- **W0 row** → append "— **260910-t9hb**, PR #N" and the merge state.
- **Decision log** → D4–D9, D11 status column: "Confirmed (W0 spec, PR #N)" at merge — merging
  normative text *is* the confirmation the pickup protocol describes. D12 stays "Proposed"
  (execution shape; the spec does not fix wave seeding).
- **Stale-fact corrections** (evidence section + W2a row): `mux panes --json` and
  `status --json` already exist → W2a scope is `mux snapshot list --json`, `gui shot --json`,
  and the envelope wrap of existing `--json` verbs; `panes`/`status` are eligible to seed W1
  (recommendation, the operator decides). `mux send` prints a report word on stdout today →
  the W1 interim `send` is `result: text` over that word, not exit-code-only.

## Affected Memory

None. This change is spec-only (`docs/specs/`), and memory records post-implementation
behavior — no runtime behavior changes here. Hydrate should find nothing to write; the spec
index row (§ 5) is the change's own doc-landscape update.

## Impact

- **Files created**: `docs/specs/mcp.md`.
- **Files modified**: `docs/specs/api.md`, `docs/specs/cli-layering.md`,
  `docs/specs/agent-messaging.md`, `docs/specs/index.md`, `fab/plans/sahil/26-09-10-rk-mcp.md`.
- **Code**: none. **Tests**: none (no `go test`/vitest impact; `true_impact_exclude` covers
  `docs/` and `fab/`). `docs/specs` is not a `fab docs-index` root, so the index row is
  hand-added.
- **Downstream**: W1–W4 intakes cite `docs/specs/mcp.md` as design authority; the plan doc's
  W1 row scope ("interim `send` — exit-code receipt") and W2a row should be re-read against
  the corrected facts before W1/W2a are picked up.
- **Constitution**: the text of Principle IX is *not* amended by this change (out of the stated
  scope); the exception is recorded at spec level in `api.md`. If Sahil prefers the constitution
  itself to carry the carve-out, that is a one-line governance amendment for W4 to bring.

## Open Questions

- None blocking. Two items are surfaced for Sahil's PR review rather than asked now: (1) whether
  merging normative D4–D9/D11 text is the intended confirmation act (the spec is written on that
  reading); (2) whether Constitution IX should itself gain the `/mcp` carve-out sentence, or the
  spec-level exception in `api.md` suffices (the plan's risk row allows either; W4 is dropped
  only if neither is acceptable).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The spec is written as a standalone normative document (RFC 2119), not a plan summary; it cites the plan once in provenance | Explicitly instructed; pickup protocol item 2 | S:95 R:90 A:95 D:95 |
| 2 | Certain | D1–D3, D10, D13 are stated as settled; `/mcp` is in scope (D10 = yes) | Confirmed in the plan and restated in the invocation | S:100 R:90 A:95 D:100 |
| 3 | Confident | D4–D9 and D11 are written as normative MUST text; merging the spec confirms them and the plan's Decision log is flipped to "Confirmed (W0 spec)" at merge; D12 stays Proposed (execution shape) | Instructed to write D3–D9 as normative text while noting they are proposed — the PR review is the confirmation gate; a spec edit is cheap to reverse | S:80 R:75 A:80 D:70 |
| 4 | Certain | The spec carries no wave column in its allowlist; waves stay in the plan | Pickup protocol: after W0 the plan "owns only the execution shape" | S:80 R:90 A:85 D:85 |
| 5 | Confident | Envelope error object gains `message` (and optional `reason`) beyond the plan's `code` + `hint` | A hint without the error text is not a usable error; `reason` lets `send` reuse the `/send` route's 409 codes without a second vocabulary | S:65 R:90 A:80 D:75 |
| 6 | Confident | Existing `--json` verbs are wrapped in the envelope with their document verbatim inside `result`, unwrapped form retired (no compat flag) | D5 says so; the only consumers are agents reading `rk skill`, which W2a updates | S:75 R:70 A:80 D:75 |
| 7 | Certain | Every `-L`-capable tool exposes an optional `server` input; absent ⇒ `default` | Follows from D8 (no `$TMUX` on the server) and the verified `muxServer` rule | S:70 R:90 A:90 D:85 |
| 8 | Confident | `/mcp` validates `Origin` when present (reject non-own/non-loopback); root CORS allowlist unchanged | MCP transport spec's DNS-rebinding guard + Constitution I; CORS is irrelevant to non-browser clients | S:60 R:85 A:85 D:75 |
| 9 | Confident | `board` is the second (and last) action-enum tool alongside `tab_web` | The plan's allowlist writes `board show/pin/unpin/reorder` as one row; its four verbs share one `(board, @N)` addressing pair — D4's own rationale for `tab_web` | S:70 R:85 A:80 D:70 |
| 10 | Certain | `rk operator request` is a subcommand of the existing `operator` verb; `rk board` is a new flat root family | Plan names them `operator request` and `board`; `tab` is the flat-family precedent | S:80 R:80 A:85 D:80 |
| 11 | Certain | Stale plan facts (`panes`/`status` already `--json`; `send` prints a report word) are corrected in the plan doc as notes + a recommendation, without re-waving rows | Facts verified in code; moving rows between waves is the operator's call | S:75 R:90 A:90 D:80 |
| 12 | Confident | `api.md`'s Route Summary gains the existing boards/operator-request/send/notify/riff rows while adding `/mcp` | The MCP spec cites these routes; a route table missing them misstates what the tools proxy; additive, verifiable against `api/router.go` | S:55 R:90 A:85 D:70 |
| 13 | Confident | The `answer` tool's `key` enum is `Enter Escape Tab Up Down Left Right Space BSpace y n 1-9`, excluding `C-c`/`C-d`/`C-z` | Plan says "bounded set" without listing it; excluding interrupt chords keeps agent-killing behind the destructive `kill` tool — a judgment call W2b can widen; trivially reversible | S:40 R:85 A:60 D:45 |
| 14 | Confident | Constitution IX text is not amended; the exception is recorded at spec level in `api.md`; the governance question is flagged, not decided | Scope named `api.md` explicitly; the plan's risk row accepts a spec-level exception | S:75 R:85 A:70 D:65 |
| 15 | Certain | Affected Memory is empty; hydrate writes nothing | Spec-only change; memory is post-implementation by definition (`docs/memory/index.md`) | S:90 R:95 A:95 D:95 |

15 assumptions (7 certain, 8 confident, 0 tentative, 0 unresolved).
