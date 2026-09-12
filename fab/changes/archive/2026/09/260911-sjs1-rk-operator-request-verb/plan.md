# Plan: rk operator request verb

**Change**: 260911-sjs1-rk-operator-request-verb
**Intake**: `intake.md`

## Requirements

Design authority: `docs/specs/mcp.md` (§ New verb families, § Receipts, § Target rule,
§ Envelope, § Policy table). Plan doc: `fab/plans/sahil/26-09-10-rk-mcp.md` (W3a). Where this
plan and the spec disagree, the spec wins.

### CLI: the `rk operator request` verb

#### R1: A `request` subcommand of `operator`
`cmd/rk` SHALL register `operatorRequestCmd` as a child of the existing `operatorCmd`
(`operatorCmd.AddCommand(operatorRequestCmd)` in `operator.go`'s `init()`), implemented in a
new file `cmd/rk/operator_request.go`, with `Use: "request <template> [--window @N] [--text <t>]
[--session <s>] [-L <server>] [--json] | --list [--json]"`. `operatorCmd`'s own no-argument
behavior MUST be unchanged; its `Long` text SHALL gain a one-line pointer to `request`. The
subcommand SHALL define its own local flags `--window`, `--text`, `--session`, `--list`,
`--json`, and `-L/--server` (the parent's `-L` is a local flag and is not inherited). It SHALL
set `SilenceUsage: true` so an operational failure prints no usage block (the `notify`/`tab`
posture); usage-class errors keep cobra's native error line.

- **GIVEN** the built binary
- **WHEN** `rk operator request --help` runs
- **THEN** it exits 0 and the help names the positional `<template>`, every flag above, and
  `--list`
- **AND** `rk operator` (no args) behaves exactly as before

#### R2: Pre-flight validation before any HTTP
`runOperatorRequest` MUST validate every input against the registry descriptor
(`api.OperatorTemplateList()`, R8) and the validators in `internal/validate` **before** making
any network call, returning `usageError(...)` (exit 2) on each of:

| Input | Rule | Message shape |
|-------|------|---------------|
| positional | exactly one unless `--list`; a positional with `--list` is an error | `--list takes no template argument` |
| template id | must be a registry id | `unknown operator template %q — run \`rk operator request --list\`` |
| `--window` on a server-scoped template | rejected | `operator template %q is server-scoped; drop --window` |
| missing `--window` on a window-scoped template | required | `operator template %q is window-scoped; pass --window @N` |
| `--window` value | `validate.ValidateWindowID(v, "--window")` must return "" | the validator's message |
| `--text` non-empty on a template without `acceptsText` | rejected | `operator template %q does not accept --text` |
| `--session` non-empty on a template without `acceptsSession` | rejected | `operator template %q does not accept --session` |
| `-L/--server` value | `validate.ValidateServerName(v)` must return "" | the validator's message |

- **GIVEN** `rk operator request brief-me --window @3`
- **WHEN** it runs against an `httptest` daemon that records requests
- **THEN** exit code is 2, the daemon receives zero requests, and stderr names the
  server-scoped rule
- **GIVEN** `rk operator request fix-tab-name`
- **WHEN** it runs
- **THEN** exit code is 2 with the window-scoped rule, zero requests

#### R3: Server label resolution
The `?server=` query value SHALL be the `-L/--server` flag when given, else
`cliServerLabel(operatorOriginalTMUXFn())` (the caller's tmux socket basename, `default` when
`$TMUX` is unset). The value MUST be URL-encoded via `url.Values`.

- **GIVEN** no `-L` and the `$TMUX` seam returning `/tmp/tmux-1000/runkit,123,0`
- **WHEN** a request is sent
- **THEN** the daemon receives `server=runkit`
- **GIVEN** `-L default`
- **THEN** the daemon receives `server=default`

#### R4: The POST to the daemon
The verb SHALL POST JSON to `resolveOrigin(ctx) + "/api/windows/" + url.PathEscape(window) +
"/operator-request"` for window-scoped templates and to `resolveOrigin(ctx) +
"/api/operator-request"` for server-scoped ones, with `Content-Type: application/json` and a
body of `{"template": id}` plus `"text"` and `"session"` keys **only when non-empty**. The
request context MUST be bounded by `operatorRequestTimeout` — a package `var` defaulting to
`20 * time.Second` (test-shrinkable, the `tabWakeTimeout` idiom) — and use
`http.NewRequestWithContext` + `http.DefaultClient` (the `notify.go` pattern). The verb MUST
NOT spawn any subprocess other than the `$TMUX` seam's option read inside `resolveOrigin`.

- **GIVEN** `rk operator request annotate-tab --window @7 -L runkit --json`
- **WHEN** the `httptest` daemon answers `200 {"ok":true}`
- **THEN** the daemon saw `POST /api/windows/@7/operator-request?server=runkit` with body
  exactly `{"template":"annotate-tab"}` (no `text`/`session` keys)
- **GIVEN** `rk operator request spawn-task --text "fix the flaky spec"`
- **THEN** the daemon saw `POST /api/operator-request?server=…` with body
  `{"template":"spawn-task","text":"fix the flaky spec"}`

#### R5: Response → exit code mapping
The daemon's answer MUST map as follows (exit code and envelope `code` always agree —
`ok:true` ⇔ exit 0):

| Daemon | Exit | Envelope |
|--------|------|----------|
| `200` | 0 | `ok:true`, `result.queued:false` |
| `202` | 0 | `ok:true`, `result.queued:true` |
| `400 {"error":m}` | 2 (`usageError`) | `ok:false`, `code:"usage"`, `message:m` |
| any other non-2xx `{"error":m[,"code":c]}` | 1 | `ok:false`, `code:"operational"`, `message:m`, `reason:c` when `c` non-empty |
| transport error / timeout | 1 | `ok:false`, `code:"operational"`, `message:"run-kit daemon unreachable at <origin>: <err>"`, `hint:"start it with rk daemon start"` |

A non-2xx body that is not JSON (or lacks `error`) SHALL fall back to `message:"run-kit daemon
answered <status>"`. The verb is NOT fail-silent: every failure is a non-zero exit with a
message on stderr.

- **GIVEN** the daemon answers `409 {"error":"staged send failed: …","code":"staged_send_failure"}`
- **WHEN** `--json` is set
- **THEN** exit 1 and stdout is exactly one document with `error.code:"operational"` and
  `error.reason:"staged_send_failure"`
- **GIVEN** the daemon answers `400 {"error":"unknown operator template \"x\""}`
- **THEN** exit 2 and `error.code:"usage"`
- **GIVEN** `RK_PORT` points at a closed port
- **THEN** exit 1, `error.hint` is `start it with rk daemon start`

#### R6: Receipt and human output
Under `--json` the success document MUST be
`{"ok":true,"result":{"template":"<id>","queued":<bool>}}` with `"window":"@N"` present iff the
request was window-scoped (echoing the `--window` value) — field order `template`, `window`,
`queued`; no other fields. Without `--json` the verb SHALL print exactly one report line on
**stdout** (`sink.Dataf`): `delivered <template>` on 200, `queued <template>` on 202 — and on
202 additionally one **stderr** chatter line (`sink.Notef`): `operator is busy; the request is
queued and drains when it is idle`. With `--json`, stdout carries exactly one JSON document and
nothing else; the queued note still goes to stderr.

- **GIVEN** a `202` answer to `rk operator request brief-me`
- **THEN** stdout is `queued brief-me\n`, stderr contains `operator is busy`, exit 0
- **GIVEN** a `200` answer to `rk operator request user-message --window @2 --text hi --json`
- **THEN** stdout is exactly
  `{"ok":true,"result":{"template":"user-message","window":"@2","queued":false}}` + newline

#### R7: `--list`
`rk operator request --list` SHALL print the registry sorted by id with no HTTP call: human
form one line per template — `%-20s %-7s %s` of id, scope word (`window` | `server`), and the
space-joined declared flag names in the fixed order `requiresAgentSessionRef acceptsText
acceptsSession requiresWaiting chatDelivery` (only those set) — on stdout. `--list --json`
SHALL print `{"ok":true,"result":{"templates":[…]}}` where each element is an
`api.OperatorTemplateInfo` serialized with its declared JSON keys.

- **GIVEN** `rk operator request --list`
- **THEN** stdout has exactly 9 lines, the first starts with `annotate-tab` and contains
  `window` and `requiresAgentSessionRef`, and the `user-message` line contains `acceptsText
  chatDelivery`
- **GIVEN** `--list --json`
- **THEN** `result.templates` has 9 elements with ids in ascending order

### API: registry descriptor

#### R8: `OperatorTemplateInfo` / `OperatorTemplateList`
`api/operator.go` SHALL export a read-only descriptor type

```go
type OperatorTemplateInfo struct {
	ID                      string `json:"id"`
	RequiresAgentSessionRef bool   `json:"requiresAgentSessionRef"`
	AcceptsText             bool   `json:"acceptsText"`
	ServerScoped            bool   `json:"serverScoped"`
	RequiresWaiting         bool   `json:"requiresWaiting"`
	AcceptsSession          bool   `json:"acceptsSession"`
	ChatDelivery            bool   `json:"chatDelivery"`
}
```

and `func OperatorTemplateList() []OperatorTemplateInfo` returning one element per
`operatorTemplates` entry, sorted by `ID`, each flag copied from the registry entry. The
registry map itself MUST remain unexported and unchanged. A test in `api/operator_test.go` MUST
assert length == `len(operatorTemplates)`, ascending order, and per-entry flag equality.

- **GIVEN** the registry
- **WHEN** `OperatorTemplateList()` is called
- **THEN** it returns 9 rows; `user-message` has `AcceptsText && ChatDelivery && !ServerScoped`;
  `update-annotations` has `ServerScoped && AcceptsSession`

### CLI output: the `--json` envelope helper

#### R9: `outputSink` envelope methods
`cmd/rk/output.go` SHALL gain the spec § Envelope helper as methods on `outputSink`:

```go
type envelopeError struct {
	Code    string `json:"code"`           // "usage" | "operational"
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
	Reason  string `json:"reason,omitempty"`
}
func (s outputSink) JSONResult(v any)          // {"ok":true,"result":v}\n on the data channel
func (s outputSink) JSONError(e envelopeError) // {"ok":false,"error":e}\n on the data channel
```

Both write exactly one newline-terminated document to `s.data` (never gated by `--quiet`).
Named constants `envelopeCodeUsage = "usage"` and `envelopeCodeOperational = "operational"`
SHALL exist. No other verb's output changes in this change.

- **GIVEN** `newSinkWriters(&buf, io.Discard)`
- **WHEN** `JSONResult(map[string]any{"template":"brief-me","queued":true})` runs
- **THEN** `buf` is `{"ok":true,"result":{"queued":true,"template":"brief-me"}}\n`
  (encoding/json key order for maps is sorted; the verb uses a struct to fix R6's order)

### MCP: the `operator_request` policy row

#### R10: The row
`internal/mcp/policy.go` SHALL append one row after `send`:

- `Tool: "operator_request"`, `Path: "operator request"`
- `Args`: `serverArg`; `{Name:"template", Positional:1, Type:ArgString, Required:true,
  Enum: operatorTemplateIDs, Description:"The operator template id (closed registry; see the
  tool description for which take window/text/session)"}`; `{Name:"window", Flag:"--window",
  Type:ArgString, Pattern:`^@\d+$`}`; `{Name:"text", Flag:"--text", Type:ArgString}`;
  `{Name:"session", Flag:"--session", Type:ArgString}`; `jsonLiteral`
- `Result: ResultJSON`; `Annotations: Annotations{}` (all false — a Talk row)
- `Description: operatorRequestDescription` — a const that MUST name the three window-scoped
  templates (`fix-tab-name`, `annotate-tab`, `user-message`) as requiring `window` and every
  other template as rejecting it, name the `text` acceptors (`spawn-task`, `find-discussion`,
  `user-message`) and the `session` acceptor (`update-annotations`), state that `queued:true`
  means a busy operator queued the work (drained when idle; `user-message` is never queued),
  that `whats-stuck` refuses when nothing is waiting, and that the verb's `--list` is the source
  of truth
- `var operatorTemplateIDs = []string{"annotate-tab","brief-me","color-tabs","find-discussion",
  "fix-tab-name","spawn-task","update-annotations","user-message","whats-stuck"}` with a comment
  stating why it is mirrored (internal/mcp must not import rk/api — the daemon's /mcp route
  would close a cycle) and which test pins it

- **GIVEN** `Resolve(rootCmd, Table)`
- **WHEN** it runs (the `mcp` doctor row / `TestMCPTableResolves`)
- **THEN** it resolves 11 tools with no error — `operator request` exists and every flag
  (`--server`, `--window`, `--text`, `--session`, `--json`) is registered on it

#### R11: Drift guards and pins
Tests MUST be updated/added so the row is pinned:

- `internal/mcp/policy_test.go`: `TestTableShape`'s want list becomes the 11 names ending
  `operator_request`; `TestTableSendRow` locates `send` by name (a `rowByTool(t, name)` helper);
  `TestReadOnlyAnnotations` iterates the nine See rows by name (or filters `ReadOnly`); new
  `TestTableOperatorRequestRow` asserts path, the positional enum (9 values, sorted), `window`
  optional with pattern, `text`/`session` optional string flags, trailing `--json` literal,
  `ResultJSON`, all-false annotations, and that the description mentions `fix-tab-name`,
  `annotate-tab`, `user-message`, and `queued`.
- `internal/mcp/schema_test.go`: the generated `operator_request` schema has `enum` on
  `template`, `required == ["template"]`, `pattern` on `window`, and no `server`-less surprise.
- `cmd/rk/mcp_test.go`: `TestOperatorRequestEnumMatchesRegistry` — the row's enum equals the
  ids of `api.OperatorTemplateList()` in order.
- `cmd/rk/doctor_test.go`: the `mcp` OK note becomes `11 tools; all policy rows resolve`.

- **GIVEN** a registry entry is added without touching `operatorTemplateIDs`
- **WHEN** `go test ./cmd/rk/...` runs
- **THEN** `TestOperatorRequestEnumMatchesRegistry` fails

### Docs: spec, skill bundle, README, plan doc

#### R12: Spec graduation cell
`docs/specs/mcp.md` § Allowlist v1's `operator_request` row SHALL read `yes` in the
**Structured today** column (was `new verb`). No other spec text changes.

- **GIVEN** the spec table
- **THEN** `grep -n 'operator_request' docs/specs/mcp.md` shows the row ending `| yes |`

#### R13: Skill topic, README, plan doc
- `app/backend/cmd/rk/skill/messaging.md` SHALL gain a `## Handing the operator a request`
  section (placed before `## Where the depth lives`) that shows `rk operator request --list`,
  the window/server split with one example of each, `--text`, `--json` and the
  `queued:true` meaning, and when to prefer it over `rk mux send` to the operator pane.
- `README.md` SHALL extend the `rk operator` paragraph with one sentence naming
  `rk operator request <template>` and the command-reference row with `request <template>`.
- `fab/plans/sahil/26-09-10-rk-mcp.md` W3a row SHALL read `Implemented — PR pending` with the
  change id after apply; the orchestrator adds the PR URL after ship.
- The apply worker SHALL run `shll standards help-dump`, `shll standards principles`,
  `shll standards skill`, and `shll standards readme-extraction` (if `shll` is on PATH) and
  conform the new surface; a missing `shll` is noted, not an error.

- **GIVEN** `rk skill messaging` output
- **THEN** it contains `rk operator request --list`

### Non-Goals

- No `--text -` stdin form — spec fixes `--text <t>`; argv exec has no shell; the daemon caps
  text at 4096 bytes.
- No new daemon route, no change to route bodies, status codes, the registry's entries or
  render functions, or the in-memory queue.
- No `board` verb (W3b), no envelope adoption on other verbs (W2a), no `send`/`await`
  receipts (W2b).
- No frontend change.

### Design Decisions

#### Registry exposed to the CLI as an exported read-only descriptor
**Decision**: `api.OperatorTemplateList()` returns id + the six flags; the map stays unexported.
**Why**: `cmd/rk` already links `rk/api` (`serve.go`); `--list` and the pre-flight scope checks
need only data; the daemon remains the enforcer.
**Rejected**: a `GET /api/operator-templates` route (new surface for compiled-in data,
Constitution IV); moving the registry to `internal/operator` (churns 1000 lines for no behavior).
*Introduced by*: 260911-sjs1-rk-operator-request-verb

#### Template enum mirrored in `internal/mcp`, pinned by a `cmd/rk` test
**Decision**: `operatorTemplateIDs` is hard-coded in `policy.go`; `cmd/rk/mcp_test.go` asserts it
equals `api.OperatorTemplateList()` ids.
**Why**: `internal/mcp` must not import `rk/api` — W4 mounts `/mcp` in the daemon (`api → mcp`),
so `mcp → api` would be a cycle. A closed enum gives the model the set in-schema.
**Rejected**: a free-form pattern with verb-side rejection (the model would guess ids); a
registration hook from `api` into `mcp` at init (hidden coupling).
*Introduced by*: 260911-sjs1-rk-operator-request-verb

#### Not fail-silent
**Decision**: unlike `notify` and `tab wake`, an unreachable daemon or a non-2xx is a non-zero
exit with a message (and `hint` under `--json`).
**Why**: a request is work handed over; the receipt is the verb's purpose. Spec § Envelope
requires `ok:false` on failure.
**Rejected**: the fail-silent posture (it would report success for undelivered work).
*Introduced by*: 260911-sjs1-rk-operator-request-verb

#### Envelope helper introduced here, on `outputSink`
**Decision**: `JSONResult`/`JSONError` land in `output.go` with this verb as first consumer.
**Why**: spec names `output.go`'s sink as the helper's home; W2a (the wider adopter) has not
landed and W3a ∥ W2a — whichever merges second rebases onto one small hunk.
**Rejected**: a verb-local marshal (a second envelope implementation W2a would then dedupe).
*Introduced by*: 260911-sjs1-rk-operator-request-verb

## Tasks

### Phase 1: Setup

- [x] T001 Add `OperatorTemplateInfo` and `OperatorTemplateList()` (sorted by ID) to `app/backend/api/operator.go`; add `TestOperatorTemplateListMirrorsRegistry` to `app/backend/api/operator_test.go` (length, ascending ids, per-entry flags incl. `user-message` and `update-annotations` spot checks) <!-- R8 -->
- [x] T002 [P] Add `envelopeError`, `envelopeCodeUsage`/`envelopeCodeOperational`, and `outputSink.JSONResult`/`JSONError` to `app/backend/cmd/rk/output.go`; unit-test both methods with `newSinkWriters` (exactly one newline-terminated document on the data channel, omitted empty `hint`/`reason`) in `app/backend/cmd/rk/output_test.go` (create if absent) <!-- R9 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/backend/cmd/rk/operator_request.go`: `operatorRequestCmd` (Use/Short/Long with the flag table, examples, exit codes 0/1/2; `SilenceUsage: true`), local flags `--window`, `--text`, `--session`, `--list`, `--json`, `-L/--server`, `operatorRequestTimeout` var (20 s), `operatorRequestReceipt` struct (`template`, `window,omitempty`, `queued` — in that order); register via `operatorCmd.AddCommand(operatorRequestCmd)` in `operator.go`'s `init()` and add the one-line `request` pointer to `operatorCmd.Long` <!-- R1 -->
- [x] T004 Implement `runOperatorRequest` pre-flight in `operator_request.go`: positional/`--list` arity, registry lookup via `api.OperatorTemplateList()`, scope rules, `--text`/`--session` acceptor rules, `validate.ValidateWindowID` and `validate.ValidateServerName`, server-label default via `cliServerLabel(operatorOriginalTMUXFn())` — every failure a `usageError` before any HTTP <!-- R2 -->
- [x] T005 Implement the POST (`resolveOrigin` + route selection + `url.PathEscape`/`url.Values`, JSON body with `text`/`session` only when non-empty, bounded context, `http.DefaultClient`) and the response mapping (200/202/400/other/transport → receipt or `envelopeError` + exit class), emitting `sink.JSONResult`/`JSONError` under `--json` or the `delivered|queued <template>` stdout line plus the 202 stderr note otherwise; return the classified error through `RunE` <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R6 -->
- [x] T006 Implement `--list` (human `%-20s %-7s %s` lines sorted by id with the fixed flag-name order; `--json` → `{"templates":[…]}` via `JSONResult`), no HTTP <!-- R7 -->
- [x] T007 Write `app/backend/cmd/rk/operator_request_test.go` (`httptest` + `pointConfigAt`, `operatorOriginalTMUXFn` seam, shrunk `operatorRequestTimeout`): registration under `operator`; every R2 usage error exits 2 with zero daemon requests; window-scoped and server-scoped happy paths assert method/path/query/body; 200 → `delivered`, 202 → `queued` + stderr note + `queued:true`; 400 → exit 2 + `code:"usage"`; 409 with `code` → exit 1 + `reason`; non-JSON 500 body → fallback message; unreachable → exit 1 + hint; `--json` stdout is exactly one document with the R6 field order; `--list` human (9 lines, first `annotate-tab`) and JSON (9 sorted ids); default server label from `$TMUX` <!-- R1 --> <!-- R2 --> <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R6 --> <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Append the `operator_request` row, `operatorTemplateIDs`, and `operatorRequestDescription` to `app/backend/internal/mcp/policy.go` per R10 (after `send`) <!-- R10 -->
- [x] T009 Update `app/backend/internal/mcp/policy_test.go` (11-name want list, `rowByTool` helper, by-name `send` lookup, See-row iteration by name, new `TestTableOperatorRequestRow`) and `app/backend/internal/mcp/schema_test.go` (enum on `template`, `required == ["template"]`, `pattern` on `window`) <!-- R11 -->
- [x] T010 Add `TestOperatorRequestEnumMatchesRegistry` to `app/backend/cmd/rk/mcp_test.go` (imports `rk/api` + `rk/internal/mcp`); update `app/backend/cmd/rk/doctor_test.go` to `11 tools; all policy rows resolve`; confirm `TestMCPTableResolves` passes with the new row <!-- R11 -->
- [x] T011 Run `just test-backend` green; run `shll standards help-dump`, `shll standards principles`, `shll standards skill`, `shll standards readme-extraction` (skip with a note if `shll` is absent) and conform the new surface (stdout data / stderr chatter, help-dump shape); check `app/backend/cmd/rk/help_dump_test.go` needs no pin update <!-- R1 --> <!-- R13 -->

### Phase 4: Polish

- [x] T012 [P] Change the `operator_request` row's Structured-today cell to `yes` in `docs/specs/mcp.md` § Allowlist v1 <!-- R12 -->
- [x] T013 [P] Add `## Handing the operator a request` to `app/backend/cmd/rk/skill/messaging.md` before `## Where the depth lives` (`--list`, one window-scoped and one server-scoped example, `--text`, `--json`/`queued:true`, when to prefer it over `mux send`) <!-- R13 -->
- [x] T014 [P] Extend the `rk operator` README paragraph (one sentence) and the command-reference row with `request <template>` in `README.md` <!-- R13 -->
- [x] T015 [P] Update `fab/plans/sahil/26-09-10-rk-mcp.md`: W3a wave row State → `Implemented — PR pending`, Evidence keeps the change id and adds `11 tools live` <!-- R13 -->

## Execution Order

- T001 and T002 are independent and both block T003–T007
- T003 blocks T004, T005, T006; T007 follows T006
- T008 depends on nothing in Phase 2 but T010 needs T001 (the `api` list) and T008
- T011 runs after every Phase 2/3 task
- T012–T015 are independent of each other and of Phase 3

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk operator request` is registered as a child of `operator`, `--help` exits 0 naming `<template>`, `--window`, `--text`, `--session`, `--list`, `--json`, `-L/--server`; `rk operator` alone is unchanged
- [x] A-002 R2: every pre-flight rule in the R2 table exits 2 with the stated message shape and makes zero HTTP requests
- [x] A-003 R3: `?server=` is the `-L` value when given, else the `$TMUX`-derived label, else `default`
- [x] A-004 R4: window-scoped templates POST to `/api/windows/{@N}/operator-request`, server-scoped to `/api/operator-request`, JSON body omits empty `text`/`session`, request bounded by `operatorRequestTimeout`
- [x] A-005 R5: 200/202 exit 0; 400 exits 2 with `code:"usage"`; other non-2xx exit 1 with `code:"operational"` and `reason` from the daemon's `code`; transport errors exit 1 with the `hint`
- [x] A-006 R6: `--json` success document is `{"ok":true,"result":{"template",…"window"?,"queued"}}` with `window` present iff window-scoped; human output is `delivered|queued <template>` on stdout and the queued note on stderr
- [x] A-007 R7: `--list` prints 9 sorted lines (scope word + declared flags) with no HTTP; `--list --json` returns `result.templates` of 9 descriptors
- [x] A-008 R8: `api.OperatorTemplateList()` returns one sorted descriptor per registry entry with flags copied verbatim; the map stays unexported
- [x] A-009 R9: `outputSink.JSONResult`/`JSONError` emit exactly one newline-terminated envelope document on the data channel; no other verb's output changed
- [x] A-010 R10: the `operator_request` row exists after `send` with the R10 args, enum, result kind, all-false annotations, and a description naming the window-scoped templates, text/session acceptors, `queued`, and `--list`
- [x] A-011 R11: policy/schema/mcp/doctor tests are updated and the enum drift test compares against `api.OperatorTemplateList()`
- [x] A-012 R12: `docs/specs/mcp.md` `operator_request` row reads `yes` under Structured today
- [x] A-013 R13: skill `messaging.md` has the new section, README has the sentence + row, plan doc W3a row reads `Implemented — PR pending`

### Behavioral Correctness

- [x] A-014 R5: a `202` is reported as success (`ok:true`, exit 0) — never as an error
- [x] A-015 R2: `--session` on `update-annotations` is accepted; on any other template it is a usage error; `--text` on `spawn-task`/`find-discussion`/`user-message` is accepted and rejected elsewhere

### Scenario Coverage

- [x] A-016 R4: tests assert the exact request path, query, method, and body for one window-scoped and one server-scoped call
- [x] A-017 R6: a test asserts the `--json` stdout is a single parseable document with the fixed field order
- [x] A-018 R11: `TestMCPTableResolves` and the `mcp` doctor row pass with 11 tools

### Edge Cases & Error Handling

- [x] A-019 R5: a non-JSON error body falls back to `run-kit daemon answered <status>`; a JSON body with `code` populates `reason`
- [x] A-020 R2: `--list` combined with a positional is a usage error; malformed `--window` (e.g. `7`, `%3`) and invalid `-L` names are usage errors before HTTP

### Code Quality

- [x] A-021 Pattern consistency: the new verb follows `notify.go`/`tab_wake.go` (`resolveOrigin`, `http.NewRequestWithContext`, bounded context, `sink` output) and `operator.go` (seams, `usageError`, exit-code discipline)
- [x] A-022 No unnecessary duplication: reuses `resolveOrigin`, `cliServerLabel`, `operatorOriginalTMUXFn`, `internal/validate`, `outputSink`; no second envelope marshal, no copy of the registry
- [x] A-023 Tests included for every new behavior (`code-quality.md` principle); no `go test`/`pnpm` invoked directly — `just test-backend`
- [x] A-024 No magic strings: timeout, envelope codes, route path fragments, report words, and the queued note are named constants/vars
- [x] A-025 Comments state constraints the code cannot show (why the enum is mirrored, why not fail-silent), never narrate the next line or cite change IDs/PR numbers

### Security

- [x] A-026 R2: every user input (`template`, `--window`, `-L`, `--text`, `--session`) is validated or bounded before any network call; no shell string anywhere; `--window` and `-L` go through `internal/validate`
- [x] A-027 R4: the daemon URL is built only from `resolveOrigin` (validated origin) plus `url.PathEscape`/`url.Values`-encoded parts

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Under `--json` the error envelope goes to stdout AND the error still returns through `RunE`, so cobra prints its `Error:` line to stderr and `exitCode` classifies the exit | Spec § Envelope: diagnostics stay on stderr, stdout carries one document; reusing the shared exit classification avoids a second `os.Exit` path | S:70 R:85 A:85 D:75 |
| 2 | Confident | `SilenceUsage: true` on the subcommand; usage-class errors still print cobra's error line | The daemon-calling verbs (`notify`, `tab`) suppress usage on operational failure; a usage block after a 409 is noise | S:60 R:90 A:80 D:75 |
| 3 | Confident | The JSON body omits empty `text`/`session` keys | The daemon treats a present empty `text` on an `acceptsText` template as a 400 ("empty text"); omitting is the neutral form and matches the UI's button POSTs | S:65 R:85 A:80 D:80 |
| 4 | Confident | The receipt struct fixes field order `template`, `window`, `queued`; `--list --json` wraps the descriptors under a `templates` key | Spec lists the receipt in that order; a keyed object leaves room for future list metadata without reshaping | S:70 R:85 A:85 D:75 |
| 5 | Confident | The 202 stderr note text is `operator is busy; the request is queued and drains when it is idle` | Mirrors the route's own busy message vocabulary and the operator-actuation memory's "drained on idle" | S:55 R:90 A:80 D:70 |
| 6 | Confident | `--list` human format `%-20s %-7s %s` (id, `window`/`server`, flags in the fixed registry-struct order) | `rk riff --list-presets`-style aligned columns; the scope word is the first thing a caller needs | S:50 R:90 A:75 D:65 |
| 7 | Confident | `operatorCmd.Long` gets a one-line pointer; `operatorCmd.Use` is unchanged | The Use string is the help-dump usage line; adding a subcommand already lists it under Available Commands | S:60 R:90 A:85 D:80 |
| 8 | Certain | Tests use `httptest` + `pointConfigAt` (RK_HOST/RK_PORT) so `resolveOrigin` takes rung 1 and spawns no tmux | The `notify_test.go` pattern in the same package | S:90 R:95 A:100 D:95 |

8 assumptions (1 certain, 7 confident, 0 tentative).
