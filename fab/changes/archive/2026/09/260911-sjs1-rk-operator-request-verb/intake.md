# Intake: rk operator request verb

**Change**: 260911-sjs1-rk-operator-request-verb
**Created**: 2026-09-11

## Origin

One-shot `/fab-new` invocation picking up the **W3a** row of the rk MCP execution plan
(`fab/plans/sahil/26-09-10-rk-mcp.md` § Change breakdown → W3, § Allowlist v1 →
`operator_request`). The user's raw input:

> rk operator request verb — `rk operator request <template> [--window @N] [--json]` over the
> daemon's two operator-request routes via the resolveOrigin pattern; template list from the
> closed registry via `rk operator request --list`; a busy target surfaces its 202-queued
> response in the receipt; policy row for `operator_request`.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol
> exactly (D1-D13 closed, docs/specs/mcp.md is design authority on conflicts, policy table in
> app/backend/internal/mcp/policy.go with doctor drift-guard, never expose a verb without a
> policy row). Base this change on § Change breakdown → "W3a" row and § Allowlist v1's
> `operator_request` row (templates from the 9-entry closed registry in api/operator.go). This
> change needs only W1 (already merged) — no dependency on W2. Update the plan's Status line
> and the W3a row when you create/merge this change.

Pickup-protocol facts established at intake (read from the tree, not assumed):

- W0 (`260910-t9hb`, #913) and W1 (`260910-nuf6`, #924) are merged. `internal/mcp` exists with
  `Table` (10 rows), `Resolve` (the drift guard), the argv `Executor`, the three-tier result
  parser, and the `rk doctor` `mcp` row (`10 tools; all policy rows resolve`).
- Design authority is `docs/specs/mcp.md` — § New verb families fixes the verb's shape,
  § Receipts fixes its `result`, § Target rule fixes the conditional `window`, § Policy table
  fixes the row schema. `docs/specs/cli-layering.md` (the two-family table) and
  `docs/specs/agent-messaging.md` (the "CLI door onto the request lane, not a fourth lane"
  paragraph) already describe the verb; neither needs a design change.
- The closed template registry is `operatorTemplates` in `app/backend/api/operator.go` —
  **9 entries**, unexported, keyed by id, each declaring up to six booleans
  (`requiresAgentSessionRef`, `acceptsText`, `serverScoped`, `requiresWaiting`,
  `acceptsSession`, `chatDelivery`). Window-scoped (3): `fix-tab-name`, `annotate-tab`,
  `user-message` (the `chatDelivery` chat template). Server-scoped (6): `spawn-task`,
  `find-discussion`, `brief-me`, `whats-stuck`, `color-tabs`, `update-annotations`.
- The two routes are `POST /api/windows/{windowId}/operator-request` (`handleOperatorRequest`)
  and `POST /api/operator-request` (`handleServerOperatorRequest`), both reading `?server=`
  via `serverFromRequest` and a body `{"template","text","session"}`. Success is
  `200 {"ok":true}`; a busy operator on a non-`chatDelivery` template is `202 {"queued":true}`;
  a full queue is `409`; validation failures are `400 {"error":…}`; missing subject/operator
  is `404`; injection outcomes are `409` (`writeErrorCode` adds `"code":"staged_send_failure"`
  on the staged path).
- `resolveOrigin(ctx)` lives in `cmd/rk/origin.go`; `notify.go` and `tab_wake.go` are the two
  existing daemon-calling verbs (both fail-silent by design — this verb is **not**, see Why).
- `cmd/rk` already imports `rk/api` (`serve.go`), so an exported read-only descriptor from
  `api` is reachable from the verb without a new package. `internal/mcp` must **not** import
  `rk/api` (W4 mounts `/mcp` inside the daemon, which would make `api → mcp → api` a cycle).
- The W2a envelope helper has **not** landed: no `cmd/rk` verb emits the `{"ok":…}` envelope
  yet. `tab new --json` (#925) prints a bare document.
- No existing change folder covers W3a (gap analysis over `fab/changes/`, 2026-09-11).

## Why

**The operator-request lane is API-only.** Every other thing the dashboard can ask the
operator to do — rename a tab, brief me, triage what's stuck, spawn a task, color tabs, leave
a note — is reachable today only through a button in the web UI that POSTs to one of the two
`/operator-request` routes. A pane agent has no verb for it, and the MCP server (D2: the CLI
is the single contract; D3: never a tool without a verb) therefore cannot expose it. The
`operator_request` tool in Allowlist v1 is blocked on exactly this verb.

**If we don't add it:** the Claude desktop app (and every pane agent) can talk to the operator
only through raw `mux send` text, bypassing the closed registry's server-rendered facts, the
`acceptsText` delimiting, the busy gate, and the 202 queue — i.e. reinventing the lane badly
or not at all. The plan's W3a row stays Pending and the MCP surface stays at 10 tools with no
way to hand the operator a work item.

**Why this shape:** the verb is a thin CLI door onto the existing lane (spec: "adds no lane").
It reuses `resolveOrigin` (the `notify`/`present`/`tab wake` door), the closed registry as the
single source of truth for `--list` and for CLI-side scope validation, and the daemon's own
status codes for the receipt. The policy row is the only thing that exposes it (D3), so the
MCP tool falls out mechanically once the verb exists. Alternatives rejected: a tool that calls
the routes directly (violates Principle 1 / D2), a new `GET /api/operator-templates` route
just for `--list` (Constitution IV — the registry is compiled into the same binary the CLI
runs), and making the verb fail-silent like `notify` (a request is work handed over; the
caller — human or model — needs to know whether it was delivered, queued, or refused).

## What Changes

### 1. Read-only registry descriptor exported from `api` (`app/backend/api/operator.go`)

The registry stays where it is and stays unexported; the verb needs only a data view of it.

```go
// OperatorTemplateInfo is the read-only descriptor of one closed-registry entry — the id
// and the six declared flags, nothing renderable. The CLI's `rk operator request --list`
// and its pre-flight scope checks read this; the daemon remains the enforcer.
type OperatorTemplateInfo struct {
	ID                      string `json:"id"`
	RequiresAgentSessionRef bool   `json:"requiresAgentSessionRef"`
	AcceptsText             bool   `json:"acceptsText"`
	ServerScoped            bool   `json:"serverScoped"`
	RequiresWaiting         bool   `json:"requiresWaiting"`
	AcceptsSession          bool   `json:"acceptsSession"`
	ChatDelivery            bool   `json:"chatDelivery"`
}

// OperatorTemplateList returns every registry entry's descriptor sorted by ID (a stable
// order for --list output and for the MCP enum drift test).
func OperatorTemplateList() []OperatorTemplateInfo
```

JSON field names are the registry's own flag names verbatim (receipt vocabulary rule: reuse
the existing name, never a synonym). A test in `api/operator_test.go` asserts the list has one
row per map entry, is sorted, and mirrors each entry's flags.

### 2. The verb — `app/backend/cmd/rk/operator_request.go`

A subcommand of the existing `operatorCmd` (which keeps `Args: cobra.NoArgs` and its own
behavior; `operatorCmd.Use`/`Long` gain a one-line pointer to `request`). Registered in
`operator.go`'s `init()` via `operatorCmd.AddCommand(operatorRequestCmd)`.

```
rk operator request <template> [--window @N] [--text <t>] [--session <s>] [-L <server>] [--json]
rk operator request --list [--json]
```

| Flag | Meaning |
|------|---------|
| `<template>` (positional) | A registry id. Unknown id ⇒ usage error (exit 2) naming `--list` |
| `--window @N` | Required for window-scoped templates, rejected for server-scoped ones (usage error either way). Validated with `validate.ValidateWindowID` before any HTTP |
| `--text <t>` | Client text; only on `acceptsText` templates (non-empty text on a closed template ⇒ usage error). Travels as the body's `text` field — argv, never stdin, never a shell |
| `--session <s>` | Only on `acceptsSession` templates (`update-annotations`); non-empty on any other ⇒ usage error. Body field `session` |
| `-L, --server <name>` | Fills the routes' `?server=` query. Validated with `validate.ValidateServerName` (usage error). Default: the caller's own tmux server label from `$TMUX` (the existing `cliServerLabel(operatorOriginalTMUXFn())`), else `default` |
| `--list` | Print the registry (§ 4). A positional together with `--list` ⇒ usage error |
| `--json` | Opt-in envelope (§ 5). Default output unchanged in shape from "nothing existed before" — a terse report line |

Flow of `runOperatorRequest` (pure validation first — no HTTP before every check passes,
Constitution I):

1. `--list` ⇒ print and return.
2. Exactly one positional required; look it up in `api.OperatorTemplateList()`.
3. Scope check: `ServerScoped && window != ""` ⇒ usage `operator template %q is server-scoped;
   drop --window`; `!ServerScoped && window == ""` ⇒ usage `operator template %q is
   window-scoped; pass --window @N`.
4. `--text` / `--session` closed-posture checks against `AcceptsText` / `AcceptsSession`.
5. Resolve the server label; build the URL:
   `resolveOrigin(ctx) + "/api/windows/" + url.PathEscape(window) + "/operator-request?server=" + label`
   or `resolveOrigin(ctx) + "/api/operator-request?server=" + label` (`url.Values` for the query).
6. `POST` a JSON body `{"template": id}` plus `text` / `session` only when non-empty, with a
   bounded context — `operatorRequestTimeout = 20 * time.Second` (a `var`, the `tabWakeTimeout`
   idiom, so tests can shrink it). The daemon's delivery budget is
   `agentSendTotalBudget = 4 s` plus one `FetchSessions`; 20 s sits well under the MCP
   `ToolTimeoutCap` (45 s) so the verb always answers before the proxy deadline.
7. Map the response (§ 3).

Test seams follow `notify_test.go`: `httptest.NewServer` + `pointConfigAt(t, srv.URL)`
(RK_HOST/RK_PORT make `resolveOrigin` rung 1 win — no tmux), plus `operatorOriginalTMUXFn` for
the server-label default.

### 3. Response → exit code / envelope mapping

| Daemon answer | Exit | `--json` | Human stdout |
|---------------|------|----------|--------------|
| `200 {"ok":true}` | 0 | `{"ok":true,"result":{"template":"brief-me","queued":false}}` (window-scoped adds `"window":"@7"`) | `delivered brief-me` |
| `202 {"queued":true}` | 0 | same shape, `"queued":true` | `queued brief-me` + one stderr note: `operator is busy; the request is queued and drains when it is idle` |
| `400 {"error":m}` | 2 | `{"ok":false,"error":{"code":"usage","message":m}}` | (stderr) `m` |
| `404` / `409` / `5xx` `{"error":m[,"code":c]}` | 1 | `{"ok":false,"error":{"code":"operational","message":m[,"reason":c]}}` | (stderr) `m` |
| transport error / timeout | 1 | `{"ok":false,"error":{"code":"operational","message":"run-kit daemon unreachable at <origin>: <err>","hint":"start it with rk daemon start"}}` | (stderr) same |

`ok` mirrors the exit code exactly (spec § Envelope): 202 is a **success** (`ok:true`,
`queued:true`) — the lane's design says a busy operator queues work, it does not refuse it.
The daemon's optional `code` field (today only `staged_send_failure`) rides through as
`error.reason` verbatim. `error.message` is the daemon's `error` text unchanged — the same
text the human path prints to stderr. With `--json`, stdout carries exactly one JSON document;
the error still returns through `RunE` (wrapped in `usageError` for the exit-2 class) so the
exit code comes from the existing `exitCode` classification.

The receipt fields are exactly the spec's `{"template","window"?,"queued"}`; `window` is
present iff the request was window-scoped and echoes the `--window` value.

### 4. `--list`

Human form — one line per template, sorted by id, scope word then the declared flags:

```
annotate-tab        window  requiresAgentSessionRef
brief-me            server
color-tabs          server
find-discussion     server  acceptsText
fix-tab-name        window  requiresAgentSessionRef
spawn-task          server  acceptsText
update-annotations  server  acceptsSession
user-message        window  acceptsText chatDelivery
whats-stuck         server  requiresWaiting
```

`--list --json` ⇒ `{"ok":true,"result":{"templates":[<OperatorTemplateInfo…>]}}` — the
descriptor rows verbatim (§ 1 field names). `--list` needs no daemon and never makes an HTTP
call.

### 5. The `--json` envelope helper (`app/backend/cmd/rk/output.go`)

W2a designates `output.go`'s report-word sink as the envelope's home; W2a has not landed, so
this change introduces the minimal helper and W2a adopts it (W2a ∥ W3a — whichever merges
second rebases onto the other's `output.go` hunk; there is no design conflict because both
follow spec § Envelope):

```go
// envelopeError is the --json error object (docs/specs/mcp.md § Envelope). Hint and
// Reason are omitted when empty.
type envelopeError struct {
	Code    string `json:"code"`              // "usage" | "operational"
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// JSONResult writes {"ok":true,"result":v} to the data channel — exactly one document,
// newline-terminated.
func (s outputSink) JSONResult(v any)
// JSONError writes {"ok":false,"error":e} to the data channel.
func (s outputSink) JSONError(e envelopeError)
```

Only `operator request` consumes it in this change. No other verb's output changes (D5 /
Pickup protocol item 4).

### 6. Policy row — `app/backend/internal/mcp/policy.go`

Appended after `send` (the table stays grouped: See rows, then Talk rows):

```go
// operatorTemplateIDs is the closed template registry's id set, mirrored here because
// internal/mcp must not import rk/api (the daemon's /mcp route would close an import
// cycle). cmd/rk's TestOperatorRequestEnumMatchesRegistry pins it to
// api.OperatorTemplateList(); a registry edit that forgets this list fails the build.
var operatorTemplateIDs = []string{
	"annotate-tab", "brief-me", "color-tabs", "find-discussion", "fix-tab-name",
	"spawn-task", "update-annotations", "user-message", "whats-stuck",
}

const operatorRequestDescription = "Hand the server's operator agent a templated work item through run-kit's operator-request lane (the same closed registry the dashboard's operator actions use). Window-scoped templates (fix-tab-name, annotate-tab, user-message) REQUIRE `window`; every other template is server-scoped and REJECTS it. `text` is accepted only by spawn-task, find-discussion, and user-message; `session` only by update-annotations. A busy operator queues the request and the result reports `queued:true` — the work is not lost, it drains when the operator goes idle (user-message skips the gate and is never queued). whats-stuck refuses when nothing on the server is waiting. The verb's `--list` is the source of truth for the template set and its flags."

{
	Tool: "operator_request", Path: "operator request",
	Args: []Arg{
		serverArg,
		{Name: "template", Positional: 1, Type: ArgString, Required: true, Enum: operatorTemplateIDs,
			Description: "The operator template id (closed registry)"},
		{Name: "window", Flag: "--window", Type: ArgString, Pattern: `^@\d+$`},
		{Name: "text", Flag: "--text", Type: ArgString},
		{Name: "session", Flag: "--session", Type: ArgString},
		jsonLiteral,
	},
	Result:      ResultJSON,
	Annotations: Annotations{}, // Talk row: no annotations (spec allowlist "—")
	Description: operatorRequestDescription,
},
```

`window` is **optional** in the schema and the verb enforces the conditional (spec § Target
rule); the daemon's 400 (and the verb's own exit-2 pre-check) arrive at the model as a `usage`
error. `serverArg` resolves against the subcommand's own `-L/--server` flag (defined locally —
`operatorCmd`'s `-L` is a local flag, not persistent). The final `description` wording is the
apply worker's call; the constraints it MUST name are the window-scoped set, the `text` /
`session` acceptors, the `queued:true` meaning, and `--list` as the source of truth.

### 7. Drift guards and test updates

- `internal/mcp/policy_test.go` — `TestTableShape` want list becomes 11 names ending in
  `operator_request`; `TestTableSendRow` finds `send` by name instead of `Table[len-1]`;
  `TestReadOnlyAnnotations` iterates only rows with `ReadOnly` true (or the nine named See
  rows). New `TestTableOperatorRequestRow`: path `operator request`, `template` positional 1
  required with the 9-value enum, `window` optional flag with the `^@\d+$` pattern, `text` and
  `session` optional flags, a `--json` literal, `ResultJSON`, all annotations false,
  description names the three window-scoped templates.
- `internal/mcp/schema_test.go` — the generated `operator_request` schema carries `enum` on
  `template`, `required: ["template"]` only, and `pattern` on `window`.
- `cmd/rk/mcp_test.go` — `TestOperatorRequestEnumMatchesRegistry`: the row's enum equals the
  ids of `api.OperatorTemplateList()` (both sorted). `Resolve(rootCmd, Table)` still passes
  (the subcommand and every flag exist).
- `cmd/rk/doctor_test.go` — the `mcp` row note becomes `11 tools; all policy rows resolve`.
- `cmd/rk/help_dump_test.go` — update only if it pins `operator`'s child count (it pins `mux`
  today; verify).
- `cmd/rk/operator_request_test.go` — table tests over the § 3 matrix using
  `httptest`: window-scoped happy path (asserts method, path
  `/api/windows/@7/operator-request`, `server` query, body fields), server-scoped happy path,
  202 ⇒ `queued:true` + exit 0 + stderr note, 400 ⇒ exit 2 + `code:"usage"`, 409 with
  `code` ⇒ exit 1 + `reason`, unreachable ⇒ exit 1 + hint, every pre-flight usage error
  (unknown template, both scope mismatches, `--text` on a closed template, `--session` on a
  non-acceptor, malformed `--window`, invalid `-L`, `--list` with a positional) makes **no**
  HTTP call, `--list` human and JSON forms, `--json` stdout is exactly one document, default
  server label from the `$TMUX` seam.
- `api/operator_test.go` — `OperatorTemplateList` mirrors the map (§ 1).

### 8. Docs, skill, README, spec, plan

- `docs/specs/mcp.md` § Allowlist v1: the `operator_request` row's **Structured today** column
  `new verb` → `yes` (Pickup protocol item 2). No other spec text changes; § New verb families
  already matches the shipped shape. If apply finds a conflict between plan and spec, the spec
  wins and the plan gets a fix-up row.
- `app/backend/cmd/rk/skill/messaging.md` — a short `rk operator request` subsection under the
  operator-messaging material (the skill bundle is the MCP server's `instructions` block, so
  this is where a model learns when to use `operator_request` vs `send`): the template table,
  the window/server split, `--list`, `queued:true`. Checked against `shll standards skill`.
- `README.md` — one sentence in the `rk operator` paragraph (line ~149) and the command-table
  row extended with `request <template>`; checked against `shll standards readme-extraction`.
- `shll standards help-dump` and `shll standards principles` (P9 `--quiet`/stdout-vs-stderr:
  the report line and the JSON document are **data** on stdout; the queued note is chatter on
  stderr) — the new-surface check for `operator request`.
- `fab/plans/sahil/26-09-10-rk-mcp.md` — at **create** (done by this intake step): Status line
  names W3a as in progress with this change id; the W3a row State → `In progress`, Evidence →
  `260911-sjs1`. At **merge** (a ship/hydrate task in the plan): W3a row State → `**Done**`,
  Evidence → change id + PR number + date; Status line's "next pickup" list drops W3a; the
  Allowlist v1 `operator_request` row's Enters stays `W3a`.

### Non-goals

- No `--text -` stdin form (spec fixes `--text <t>`; argv exec has no shell, and the daemon
  caps text at 4096 bytes).
- No new daemon route, no change to the routes' bodies or status codes, no change to the
  registry's entries or render functions.
- No `board` verb (W3b), no envelope on any other verb (W2a), no `send`/`await` receipts (W2b).
- No change to `rk operator`'s own (no-argument) behavior beyond the help pointer.

## Affected Memory

- `run-kit/mcp`: (modify) the table grows to eleven tools — the `operator_request` Talk row
  (enum, optional conditional `window`, `text`/`session`, no annotations, description
  override), the in-package `operatorTemplateIDs` mirror and its `cmd/rk` drift test, the
  doctor note `11 tools`.
- `run-kit/operator-actuation`: (modify) the CLI door onto the request lane —
  `rk operator request` (scope pre-checks, `--list`, receipt, 202 ⇒ `queued:true`, exit
  mapping) and the exported `OperatorTemplateInfo`/`OperatorTemplateList` descriptor.
- `run-kit/architecture/cli`: (modify) the `operator` row gains the `request` subcommand and
  its file; the output-convention section records the `--json` envelope helper on
  `outputSink` (first consumer).
- `run-kit/toolkit-standards`: (modify) the help-dump + P9 new-surface check now covers
  `operator request` (stdout = report line / JSON document, stderr = queued note).

## Impact

**Backend (Go)**

- `app/backend/api/operator.go` (+ `operator_test.go`) — exported descriptor type and list
  function; registry untouched.
- `app/backend/cmd/rk/operator_request.go` (new, + `operator_request_test.go` new) — the verb.
- `app/backend/cmd/rk/operator.go` — `AddCommand`, help pointer.
- `app/backend/cmd/rk/output.go` — envelope helper (+ a unit test in `output_test.go` if one
  exists, else inside the new test file).
- `app/backend/internal/mcp/policy.go` (+ `policy_test.go`, `schema_test.go`) — the row.
- `app/backend/cmd/rk/mcp_test.go`, `doctor_test.go`, possibly `help_dump_test.go` — pins.
- `app/backend/cmd/rk/skill/messaging.md` — skill topic text.

**Docs**: `docs/specs/mcp.md` (one cell), `README.md` (one sentence + one row),
`fab/plans/sahil/26-09-10-rk-mcp.md` (Status line + W3a row, twice).

**No frontend, no routes, no tmux, no config, no new dependency.** Constitution touchpoints:
I (argv only, every input validated before any subprocess/HTTP; `--window`/`-L` through
`internal/validate`), III (wraps the existing routes and `resolveOrigin`), IV (no new route,
one subcommand), IX (both calls are `POST`), Process Execution (bounded HTTP context).

**Verification gates**: `just test-backend` (Go), `just test` before ship; e2e suite untouched
by this change (no frontend), so a red e2e leg in a long-named worktree is environmental — see
memory `e2e-long-worktree-name-server-cap`.

**Parallel-change hazards**: W2a (`cli-json-read-verbs`) also touches `cmd/rk/output.go` and
appends to `internal/mcp/policy.go`; W2b/W2c/W3b append to `policy.go` and its want-list test.
All are additive — rebase, no design conflict.

## Open Questions

- None. Every decision is closed by D1–D13 and `docs/specs/mcp.md` § New verb families /
  § Receipts / § Target rule / § Policy table; the remaining choices are recorded below as
  graded assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The verb is a subcommand of the existing `operator` verb with the exact spec shape `rk operator request <template> [--window @N] [--text <t>] [--session <s>] [--list] [--json]` plus `-L/--server` | `docs/specs/mcp.md` § New verb families and `cli-layering.md`'s family table fix the shape verbatim; D1–D13 closed | S:95 R:70 A:100 D:100 |
| 2 | Certain | Receipt is `{"template":"<id>","window":"@N"?,"queued":bool}`; `queued:true` ⇔ daemon `202`; `window` present iff window-scoped | Spec § Receipts row for `operator request`, verbatim | S:95 R:80 A:100 D:100 |
| 3 | Confident | `--list` and the CLI pre-checks read a new exported read-only descriptor `api.OperatorTemplateList()` (id + six flags, sorted) rather than moving the registry or adding a `GET` route | `cmd/rk` already imports `rk/api` (`serve.go`); a route would add surface (IV) for data compiled into the same binary; moving the registry churns `api/operator.go` for no behavior gain | S:70 R:60 A:75 D:65 |
| 4 | Confident | Scope/text/session are pre-validated CLI-side as usage errors (exit 2) before any HTTP; daemon `400` also maps to `usage`; `404`/`409`/`5xx` and transport errors map to `operational` (exit 1); the daemon's `code` field rides as `error.reason` | Spec § Target rule ("the verb enforces the conditional; the daemon's 400 passes through as a usage error") and § Envelope's exit-code ⇔ `ok` rule | S:80 R:75 A:80 D:75 |
| 5 | Confident | This change introduces the shared `--json` envelope helper on `outputSink` in `cmd/rk/output.go`; W2a adopts it | Spec names `output.go` as the helper's home; W2a has not landed and W3a needs the envelope; both follow the same spec text so the overlap is a rebase, not a conflict | S:70 R:80 A:80 D:70 |
| 6 | Confident | Human (non-`--json`) success output is a report line on stdout — `delivered <template>` / `queued <template>` — with a one-line stderr note on the queued case | Receipt vocabulary rule: reuse the existing report words (`delivered` is the engine's submission-verified word; `queued` is the route's own field); P9 stdout=data, stderr=chatter | S:35 R:80 A:50 D:40 |
| 7 | Confident | HTTP request timeout is 20 s (`operatorRequestTimeout`, a test-shrinkable var) | The daemon's delivery budget is `agentSendTotalBudget = 4 s` plus one `FetchSessions`; 20 s clears it with margin and stays under the 45 s `ToolTimeoutCap` so the MCP proxy never fires its backstop first | S:50 R:90 A:75 D:70 |
| 8 | Confident | The policy row's `template` input is a closed `Enum` of the 9 ids hard-coded in `policy.go` (with a `cmd/rk` drift test against `api.OperatorTemplateList()`); `window`/`text`/`session` are optional flag inputs; the row overrides `description` to name the window-scoped templates | `internal/mcp` cannot import `rk/api` (W4 would close a cycle); a closed enum is the registry's own `/options`-allowlist posture and gives the model the set in-schema; spec § Allowlist row-level rules require the description to name the window-scoped templates | S:65 R:75 A:80 D:70 |
| 9 | Certain | The row is appended after `send`; the pin tests move to by-name lookups and an 11-name want list; the doctor note becomes `11 tools` | Read from `policy_test.go` / `doctor_test.go` — they pin the count and use `Table[len-1]` for `send` | S:90 R:90 A:100 D:95 |
| 10 | Certain | Plan doc: Status line + W3a row updated at create (this step) and again at merge; `docs/specs/mcp.md` Allowlist `operator_request` Structured-today cell → `yes` | User instruction and Pickup protocol items 2 and 5 | S:100 R:95 A:100 D:100 |
| 11 | Confident | `-L/--server` fills the routes' `?server=` query; default is the caller's tmux server label (`cliServerLabel` over the `$TMUX` seam) else `default`; validated with `ValidateServerName` | Both handlers read `serverFromRequest`; the existing `operator` verb already derives its label this way; the daemon silently coerces invalid names to `default`, so the CLI must reject them first | S:70 R:80 A:85 D:80 |
| 12 | Confident | `--text` is an argv flag (no stdin form) | Spec lists `[--text <t>]`; argv exec has no shell so no escaping hazard; the daemon caps at 4096 bytes | S:80 R:85 A:80 D:70 |
| 13 | Confident | Docs footprint: a `rk operator request` subsection in the skill bundle's `messaging.md`, one README sentence + row extension, no `docs/site` page; checked against `shll standards skill`/`readme-extraction`/`help-dump`/`principles` | The skill bundle is the MCP `instructions` block, so it is where a model learns the tool; Constitution § Toolkit Standards binds the CLI-surface check | S:55 R:90 A:75 D:70 |
| 14 | Certain | The verb is NOT fail-silent: an unreachable daemon is exit 1 with a message and a `hint` | Unlike `notify`/`tab wake` (best-effort side effects), a request is work handed over and the receipt is the point; spec § Envelope requires `ok:false` on failure | S:85 R:85 A:95 D:95 |
| 15 | Confident | `--list --json` result is `{"templates":[<descriptor…>]}` with the registry flag names as JSON keys | Receipt vocabulary rule (reuse existing names); `--list` makes no HTTP call | S:75 R:85 A:85 D:65 |

15 assumptions (5 certain, 10 confident, 0 tentative, 0 unresolved).
