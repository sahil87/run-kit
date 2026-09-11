# Plan: CLI send/await receipts (rk MCP W2b)

**Change**: 260911-i2vm-cli-send-await-receipts
**Intake**: `intake.md`

> **Envelope helper correction (binding for every task below).** The D5 envelope helper already exists on `main`: `outputSink.JSONResult(v any)` and `outputSink.JSONError(e envelopeError)` in `app/backend/cmd/rk/output.go`, with `envelopeError{Code, Message, Hint, Reason}` and the constants `envelopeCodeUsage` / `envelopeCodeOperational` (merged by W3a, PR #945). `cmd/rk/operator_request.go` is the reference consumer. This change adds **no** helper and **no** new envelope type — intake § What Changes 1 and Assumption #3 are superseded; consume the merged helper verbatim.

## Requirements

### CLI — `rk mux send --json` receipt

#### R1: Success receipt
`rk mux send` SHALL accept a local `--json` flag. With it, a successful send (exit 0) MUST write exactly one JSON document to stdout via `sink.JSONResult` — `{"ok":true,"result":{"report":<word>,"target":"%N","server":"<name>","enter":<bool>}}` — and MUST NOT print the human report line. `report` is the frozen report word the human path prints (`delivered` | `staged` | `sent`); `target` is the **resolved** pane id (a `@N` / `=session:window` target resolves first); `server` is the resolved tmux server name (`-L` wins, else the `$TMUX` socket basename, else `default`); `enter` is `true` for `delivered` and `false` for `staged` (`--no-enter`) and `sent` (`--key`, even when the key is `Enter`). Field names are the spec's (`docs/specs/mcp.md` § Receipts); more fields MAY be added, none renamed.

- **GIVEN** an idle instrumented pane `%5` on server `default`
- **WHEN** `rk mux send %5 "hi" --json` runs and the engine reports `delivered`
- **THEN** stdout is exactly `{"ok":true,"result":{"report":"delivered","target":"%5","server":"default","enter":true}}` + newline, exit 0, and no `delivered %5` line appears

- **GIVEN** the same pane
- **WHEN** `rk mux send %5 --key Enter --json` runs
- **THEN** `result.report` is `sent` and `result.enter` is `false`

- **GIVEN** the same pane
- **WHEN** `rk mux send %5 "hi" --no-enter --json` runs
- **THEN** `result.report` is `staged` and `result.enter` is `false`

#### R2: Failure envelope
With `--json`, every failure raised inside `RunE` MUST write exactly one `{"ok":false,"error":{…}}` document via `sink.JSONError` **and still return the error** (exit code and stderr unchanged). `error.code` is `usage` for `usageError`-wrapped errors (exit 2) and `operational` otherwise (exit 1). `error.message` is the error's text. The three engine sentinels carry the `/send` route's 409 codes as `error.reason` with a hint: `inject.ProbeFailure` → `probe_failure` / hint `check the pane before resending; a resend would duplicate the staged text`; `inject.StagedSendFailure` → `staged_send_failure` / hint `press Enter in the pane to submit`; `inject.SubmitUnverified` → `submit_unverified` / hint `capture the pane before resending`. A `waiting` gate refusal carries hint `use --answer if this send is the reply the agent waits for`; other refusals and resolution errors carry no reason or hint. Under `--json` the `unverified %N` stdout line MUST NOT be printed (the fact travels as `reason:"submit_unverified"`). Pre-`RunE` cobra errors (unknown flag, `--answer --force`) are out of scope and stay un-enveloped.

- **GIVEN** a pane whose composer swallows the paste
- **WHEN** `rk mux send %5 "hi" --json` runs and the engine returns `inject.ProbeFailure`
- **THEN** stdout is one document with `ok:false`, `error.code:"operational"`, `error.reason:"probe_failure"`, `error.hint` set; exit 1; stderr carries the message

- **GIVEN** a `waiting` pane
- **WHEN** `rk mux send %5 "hi" --json` runs without `--answer`
- **THEN** `ok:false`, `code:"operational"`, message names the refusal, hint names `--answer`, exit 1

- **GIVEN** no payload
- **WHEN** `rk mux send %5 --json` runs
- **THEN** `ok:false`, `code:"usage"`, exit 2

#### R3: `--await` nesting under `--json`
With `--json --await[=states]`, the delivery receipt keeps `report` (the delivery word) and gains `await` — the `mux await` receipt object of R4 for the await phase (`elapsed_ms` measures grace watch + observer). If the await phase ends `gone`, the document is `ok:false`, `code:"operational"`, `reason:"gone"`, message = the gone diagnostic, hint `the message was delivered before the pane died`, exit 1. If the await cannot start (no report, e.g. an uninstrumented pane), the document is `ok:false`, `code:"operational"`, message = the await error, hint `delivered; the wait could not start`, exit 1. Text mode is unchanged (the await word replaces the delivery report as the single stdout line).

- **GIVEN** an idle pane that flips `active` then `idle` after a send
- **WHEN** `rk mux send %5 "q" --await --json` runs
- **THEN** `ok:true`, `result.report:"delivered"`, `result.enter:true`, `result.await.report:"idle"`, `result.await.target:"%5"`, `result.await.elapsed_ms` ≥ 0

- **GIVEN** the pane dies during the await
- **WHEN** the same command runs
- **THEN** `ok:false`, `error.reason:"gone"`, exit 1

### CLI — `rk mux await --json` receipt

#### R4: Success receipt
`rk mux await` SHALL accept a local `--json` flag. With it, every exit-0 report MUST write exactly one document via `sink.JSONResult` with `result` = `{"report":<word>,"target":"%N"?,"elapsed_ms":<int>,"detail":"…"?,"hint":"…"?}` and MUST NOT print the human report line. `report` is the word the text path prints (a reached `--until` state, `file`, `running`, `ready`, `parked`, `narrow`). `target` is the single target, or under `--any` the **firing** pane; it is **omitted** for `file` and `running`. `elapsed_ms` is integer wall-clock milliseconds from the start of the observe phase (after target resolution) to the report. `detail` is present only for `ready` (`"state"` | `"echo"`) and `narrow` (`"WxH"`) — the parenthesised suffix the text path prints. `hint` is present only for `running` with the literal `call again`. `running` is a **success** (`ok:true`, exit 0). `--notify` composes unchanged.

- **GIVEN** an instrumented pane that reaches `idle` after 1.8 s
- **WHEN** `rk mux await %5 --json` runs
- **THEN** stdout is one document `{"ok":true,"result":{"report":"idle","target":"%5","elapsed_ms":<≈1800>}}`, exit 0

- **GIVEN** the pane stays `active`
- **WHEN** `rk mux await %5 --timeout 1 --json` runs
- **THEN** `result.report:"running"`, `result.hint:"call again"`, no `target`, exit 0

- **GIVEN** `--any %1 %5 --until idle` with `%5` firing
- **WHEN** it runs with `--json`
- **THEN** `result.target` is `%5`

- **GIVEN** a freshly spawned pane whose agent state appears
- **WHEN** `rk mux await %5 --ready --json` runs
- **THEN** `result.report:"ready"`, `result.detail:"state"`; for the sentinel-echo path `detail:"echo"`; for a 54×14 pane `report:"narrow"`, `detail:"54x14"`; for a wall `report:"parked"` with no `detail`

#### R5: Failure envelope
With `--json`, `gone` MUST be `ok:false`, `code:"operational"`, `reason:"gone"`, message = the pane-death diagnostic, exit 1 (the pane is named in the message, as today). An uninstrumented pane with no `--file` MUST be `ok:false`, `code:"operational"`, no reason, exit 1. Usage errors raised inside `RunE` (`--ready` combined with `--until`/`--file`/`--after-active`/`--any`, negative `--timeout`, duplicate `--any` targets, an unknown `--until` state) MUST be `code:"usage"`, exit 2. The error is still returned to cobra in every case.

- **GIVEN** the awaited pane is killed mid-wait
- **WHEN** `rk mux await %5 --json` runs
- **THEN** `ok:false`, `error.reason:"gone"`, exit 1, and no `gone` text line on stdout

- **GIVEN** `rk mux await %5 --ready --until idle --json`
- **WHEN** it runs
- **THEN** `ok:false`, `error.code:"usage"`, exit 2

### `internal/mcp` — model additions

#### R6: `Arg.When`, `Arg.Default`, `Row.OneOf`
`internal/mcp.Arg` SHALL gain `When string` (emit this `Literal` only when the named input is present in the call) and `Default string` (the argv value emitted for a `Flag` arg when its input is absent). `Row` SHALL gain `OneOf []string` (input names of which **exactly one** must be present). `BuildArgv` MUST honour both `Arg` fields (a `Default` is emitted as `flag value` at the arg's position in `Args` order; a `When` literal is skipped when its input is absent). `ValidateArgs` MUST reject a call that supplies zero or more than one `OneOf` member with a one-line message naming the inputs. `Resolve` MUST reject a `When` or `OneOf` naming an input that is not an arg of the row, a `Default` on a non-`Flag` or Boolean arg, and a `Default` that does not parse for an Integer arg. `InputSchema` MUST emit the `Default` as the JSON-schema `default` (typed: a JSON number for Integer args, a string otherwise). Rows without the new fields are unaffected byte-for-byte (`BuildArgv` output for every existing row is unchanged).

- **GIVEN** the `await` row and a call `{server:"s", target:"%3"}`
- **WHEN** argv is built
- **THEN** it is `["mux","await","-L","s","--timeout","40","%3","--json"]`

- **GIVEN** the `answer` row and `{target:"%3", message:"yes"}`
- **WHEN** argv is built
- **THEN** it is `["mux","send","%3","--answer","-","--json"]` and `message` streams on stdin

- **GIVEN** the `answer` row and `{target:"%3", key:"Enter"}`
- **WHEN** argv is built
- **THEN** it is `["mux","send","--key","Enter","%3","--json"]` (no `--answer`, no `-`)

- **GIVEN** the `answer` row and `{target:"%3"}` or `{target:"%3", message:"a", key:"Enter"}`
- **WHEN** `ValidateArgs` runs
- **THEN** it errors naming `message` and `key`

### `internal/mcp` — policy rows

#### R7: `send` graduates; `answer` and `await` enter
`Table` SHALL contain fourteen rows: the existing twelve, with the `send` row edited in place, plus `answer` and `await` **appended** after `operator_request`. `send`: `Args` gain the `jsonLiteral` after the `-` literal; `Result` becomes `ResultJSON`; its description override is rewritten to name the `result` fields (`report`, `target`, `server`, `enter`), keep the phrase **"does NOT mean the agent has acted"** verbatim, point at `await` (wait for the agent's state) and `capture` (read the pane), name the three failure `reason` tokens with what each asks the caller to do, and say `--force` is not exposed and `--answer`/`--key` live on `answer`. `answer`: `Path "mux send"`, args `serverArg`, `targetArg`, optional `message` (string, stdin), optional `key` (`Flag "--key"`, string, `Enum` exactly `Enter Escape Tab Up Down Left Right Space BSpace y n 1 2 3 4 5 6 7 8 9`), `{Literal:"--answer", When:"message"}`, `{Literal:"-", When:"message"}`, `jsonLiteral`; `Stdin "message"`; `OneOf {"message","key"}`; `ResultJSON`; empty annotations; a description override explaining message-vs-key, that a key press rides the plain gate (a `waiting` agent refuses a bare key; an `active` agent refuses everything), and the receipt (`report:"delivered"` for a message, `report:"sent"` for a key). `await`: `Path "mux await"`, args `serverArg`, `targetArg`, `until` (`Flag "--until"`, string, `Pattern ^(idle|waiting|active)(,(idle|waiting|active)){0,2}$`), `timeout` (`Flag "--timeout"`, integer, `Minimum 1`, `Maximum 40`, `Default "40"`), `ready` (`Flag "--ready"`, boolean), `jsonLiteral`; `ResultJSON`; `readOnlyAnn`; `Timeout` 0 (the cap); a description override naming the report words, that `running` means call again, that `ready`/`parked`/`narrow` are the boot-readiness verdicts (answer a `parked` wall with `answer`), and that `until` and `ready` are mutually exclusive. `Resolve(rootCmd, Table)` MUST succeed; `--any`, `--file`, `--after-active`, `--notify`, `--force`, `--await` are not exposed.

- **GIVEN** the compiled table
- **WHEN** an MCP client lists tools
- **THEN** exactly fourteen appear, including `answer` and `await`; `await` carries `readOnlyHint:true`; `answer` and `send` carry no hints; `send` and `answer` schemas mark `message` as stdin-bound and `answer`'s `key` enum is the closed set

- **GIVEN** the `send` row
- **WHEN** its description is read
- **THEN** it contains "does NOT mean the agent has acted"

### Tests and the doctor row

#### R8: Tests pin the new contract
Unit tests MUST cover: every R1–R5 document shape (send success ×3, send failure per sentinel + gate refusal + usage, `--await` nesting incl. `gone` and cannot-start, await success per word incl. `running`/`hint`, `file` without target, `--any` firing target, `--ready` details, `gone`, usage); that no human report line prints under `--json`; that text-mode output is byte-identical (existing tests untouched and passing); `BuildArgv` for the three R6 scenarios plus a `Default`-absent-when-supplied case; `ValidateArgs` `OneOf`; `Resolve` rejections for bad `When`/`OneOf`/`Default`; `InputSchema` `default`. `internal/mcp/policy_test.go` and `cmd/rk/mcp_test.go` pin the fourteen names; `cmd/rk/doctor_test.go` pins `14 tools; all policy rows resolve`. `cmd/rk/mcp_e2e_test.go` asserts fourteen tools, parses `send`'s text block as JSON and checks `report=="delivered"` and `target==pane`, keeps the description-phrase assertion, adds an `answer` call with `key:"Enter"` on the shell pane (⇒ `report:"sent"`), an `await` call on the uninstrumented shell pane with `timeout:1` (⇒ `isError`, the verb's diagnostic passes through), and schema rejections for `key:"C-c"` and for `answer` with both and with neither payload. `go vet` clean; `gofmt -l` adds no new files (8 files are already unformatted on main — not this change's concern).

- **GIVEN** the change's tests
- **WHEN** `just test-backend` runs
- **THEN** every `cmd/rk` and `internal/mcp` test passes, including the MCP E2E

### Documentation

#### R9: Spec, skill bundle, help text, plan doc
`docs/specs/mcp.md` Allowlist v1 "Structured today" column MUST read `yes (envelope)` for `send`, `answer`, `await`, and the policy-table YAML example MUST show `when:`, `default:`, and `one_of:` so the schema rendering stays truthful. `docs/site/skill/mux.md` (`rk mux send` and `rk mux await` sections) and `docs/site/skill/messaging.md` (the Write and Wait rows or the round-trip bullet) MUST each gain a sentence documenting `--json` and the receipt fields. Both verbs' Cobra `Long` help MUST gain a `--json` sentence (one document on stdout; report word inside `result`). `fab/plans/sahil/26-09-10-rk-mcp.md`'s W2b rows (Status table and § Change breakdown) MUST say implemented 2026-09-11, PR pending. No memory file is edited at apply (hydrate owns `docs/memory/`).

- **GIVEN** the docs edits
- **WHEN** `rk skill mux` is read
- **THEN** it documents `rk mux send … --json` and `rk mux await … --json`

### Non-Goals

- Changing any default (non-`--json`) stdout/stderr byte, exit code, report word, or the `internal/inject` engine — D5 and the frozen report-word contract.
- Exposing `send --await`, `--force`, `await --any/--file/--after-active/--notify` over MCP.
- A new envelope helper or envelope type — the merged `JSONResult`/`JSONError` are consumed as-is (W2a's parallel `Envelope()` duplicate is a separate cleanup).
- Enveloping cobra's pre-`RunE` usage errors.
- Graduating other verbs' existing bare `--json` documents into the envelope (W2a).
- Reformatting the 8 pre-existing `gofmt -l` files.

### Design Decisions

#### Receipt derives from the report word, not the engine
**Decision**: `runMuxSend` builds the `--json` receipt from the `report` variable it already computes plus the sentinel error type it already branches on; `inject.Engine.Send` still returns only `error`.
**Why**: the spec fixes `result` to `report`/`target`/`server`/`enter`, all derivable in the verb; D2 and agent-messaging forbid a second evidence vocabulary.
**Rejected**: returning an evidence struct from the engine (touches the daemon's `/send` adapter for no consumer).
*Introduced by*: 260911-i2vm-cli-send-await-receipts

#### Structural 40 s clamp via a schema default
**Decision**: the `await` tool's `timeout` input is `1..40` with a policy-row `Default "40"` emitted as `--timeout 40` when absent; `Arg.Default` is a generic field.
**Why**: an absent `--timeout` means 300 s, which would hit the proxy backstop and report a timeout error instead of the spec's `running` + `call again`.
**Rejected**: a runtime clamp in the server handler (a second place that knows the cap); making `timeout` required (a worse model UX).
*Introduced by*: 260911-i2vm-cli-send-await-receipts

#### Conditional literals and one-of live in the policy model
**Decision**: `Arg.When` gates a literal on an input's presence; `Row.OneOf` is validated by the handler before exec.
**Why**: `answer` is one tool covering `--answer <message>` and `--key <k>`; the verb's payload-XOR would also reject bad calls, but the model should see the schema-level message first, and W2c's `cron_add` (pane/session/role) needs the same one-of.
**Rejected**: two tools (`answer` + `key`) — the spec names one and forbids more action enums; a hand-written handler for `answer` (breaks the mechanical-proxy rule).
*Introduced by*: 260911-i2vm-cli-send-await-receipts

#### `gone` is `ok:false`
**Decision**: under `--json`, `gone` (exit 1) is an error document with `reason:"gone"`; for `send --await` the delivered fact rides the hint.
**Why**: § Envelope's "ok mirrors the exit code" is normative and the exit code is 1 today.
**Rejected**: `ok:true` with `report:"gone"` (would break the exit-code mirror).
*Introduced by*: 260911-i2vm-cli-send-await-receipts

## Tasks

### Phase 1: Model additions (`internal/mcp`)

- [x] T001 Add `When string` and `Default string` to `Arg` and `OneOf []string` to `Row` in `app/backend/internal/mcp/policy.go` with field comments stating the emit/validate rules <!-- R6 -->
- [x] T002 In `app/backend/internal/mcp/exec.go` `BuildArgv`: emit `flag Default` for an absent Flag input that carries a `Default`; skip a `Literal` whose `When` input is absent; add `exec_test.go` cases for the three R6 argv scenarios plus default-overridden-when-supplied and existing-rows-unchanged <!-- R6 -->
- [x] T003 [P] In `app/backend/internal/mcp/result.go` `ValidateArgs`: enforce `Row.OneOf` (exactly one present, message names the inputs) before per-arg validation; add `result_test.go` cases for zero / one / two members <!-- R6 -->
- [x] T004 [P] In `app/backend/internal/mcp/schema.go`: `Resolve` validates `When`/`OneOf` names against the row's inputs, rejects `Default` on non-Flag or Boolean args and a non-integer `Default` on Integer args; `InputSchema` emits typed `default`; add `schema_test.go` cases <!-- R6 -->

### Phase 2: CLI receipts (`cmd/rk`)

- [x] T005 `app/backend/cmd/rk/mux_await.go`: add local `--json` flag; introduce an `awaitReceipt` struct (`report`, `target,omitempty`, `elapsed_ms`, `detail,omitempty`, `hint,omitempty`); extend `mapReadyReport`/`readyReport` to expose word + detail alongside the existing `line` (text output for `mux await --ready` and `tab new --ready` unchanged); time the observe phase; on `--json` emit via `sink.JSONResult` / `sink.JSONError` (usage vs operational from `usageError`, `reason:"gone"`), suppress the text line, keep `--notify`; add a `--json` sentence to `Long` <!-- R4 --> <!-- rework: under --json the gone error branch returns before the --notify block; emit the JSON error document then fall through to notify, mirroring runMuxAwaitReady; hoist the duplicated newSink in runMuxAwaitReady -->
- [x] T006 `app/backend/cmd/rk/mux_await_test.go`: `--json` cases — idle, waiting, running+hint (no target), file (no target), `--any` firing target, `--ready` state/echo/narrow/parked details, gone (`ok:false reason:gone`, no text line), uninstrumented (operational, no reason), usage (`--ready --until`, negative timeout) exit 2 with `code:"usage"`; assert text mode unchanged <!-- R4 R5 --> <!-- rework: add a --json + --notify gone test proving the notification fires -->
- [x] T007 `app/backend/cmd/rk/mux_send.go`: add local `--json` flag; introduce a `sendReceipt` struct (`report`, `target`, `server`, `enter`, `await,omitempty` of the T005 type); refactor the report/exit paths so `--json` emits exactly one document via `sink.JSONResult` / `sink.JSONError` with the R2 reason/hint mapping (`errors.As` on the three sentinels, `usageError` ⇒ `usage`), suppresses `unverified %N` and the report line, nests the await receipt per R3 (including `gone` and cannot-start), and still returns the error; add a `--json` sentence to `Long` <!-- R1 R2 R3 -->
- [x] T008 `app/backend/cmd/rk/mux_send_test.go`: `--json` cases — delivered/staged/sent with `enter`, `@N` target resolving to `%N`, `-L` server in receipt, probe_failure / staged_send_failure / submit_unverified reasons+hints, waiting refusal hint, active refusal (no hint), missing pane, usage (no payload, `--await --no-enter`) exit 2, `--await` nesting success, `--await` gone, `--await` cannot-start; assert no report line under `--json` and text mode unchanged <!-- R1 R2 R3 -->

### Phase 3: Policy rows and tests

- [x] T009 `app/backend/internal/mcp/policy.go`: edit the `send` row (`jsonLiteral`, `ResultJSON`, rewritten `sendDescription` keeping "does NOT mean the agent has acted"); append the `answer` row (`answerDescription`, key enum, `When` literals, `OneOf`) and the `await` row (`awaitDescription`, until pattern, timeout 1–40 default 40, ready) after `operator_request` <!-- R7 -->
- [x] T010 Update `app/backend/internal/mcp/policy_test.go` (fourteen names in table order; `send`/`answer`/`await` shape assertions — result kinds, annotations, enum, bounds, default, When, OneOf, Stdin), `app/backend/cmd/rk/mcp_test.go` (fourteen sorted names), `app/backend/cmd/rk/doctor_test.go` (`14 tools`; all policy rows resolve`) <!-- R7 R8 -->
- [x] T011 Update `app/backend/cmd/rk/mcp_e2e_test.go`: fourteen tool names; `send` result parsed as JSON (`report=="delivered"`, `target==pane`); description phrase kept; `answer` `key:"Enter"` on the shell pane ⇒ `report:"sent"`; `await` `timeout:1` on the shell pane ⇒ `IsError` with the verb's diagnostic; schema rejections for `key:"C-c"`, `answer` with both payloads, `answer` with neither <!-- R7 R8 -->
- [x] T012 Run `just test-backend` (unit + MCP E2E) and `go vet ./...` in `app/backend`; fix failures; confirm `gofmt -l ./internal/mcp ./api ./cmd/rk` lists no file this change touched <!-- R8 -->

### Phase 4: Documentation

- [x] T013 [P] `docs/specs/mcp.md`: set "Structured today" to `yes (envelope)` for `send`, `answer`, `await`; add `when:` / `default:` / `one_of:` to the policy-table YAML example with one-line comments <!-- R9 -->
- [x] T014 [P] `docs/site/skill/mux.md` (send + await sections) and `docs/site/skill/messaging.md`: one sentence each on `--json` and the receipt fields; `fab/plans/sahil/26-09-10-rk-mcp.md` W2b rows → implemented 2026-09-11, PR pending <!-- R9 -->

## Execution Order

- T001 blocks T002, T003, T004, T009
- T005 blocks T007 (the nested await receipt type)
- T009 blocks T010, T011
- T012 runs after T002–T011; T013–T014 are independent of code and may run any time after T001

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux send … --json` prints exactly one `{"ok":true,"result":{report,target,server,enter}}` document on success and no report line
- [x] A-002 R2: every in-`RunE` send failure under `--json` prints one `ok:false` document with `code` usage/operational, the three sentinel `reason` tokens and hints, and the error is still returned
- [x] A-003 R3: `--json --await` nests the await receipt under `result.await`; `gone` and cannot-start map to `ok:false` with the specified reason/hint
- [x] A-004 R4: `rk mux await … --json` prints one `{report,target?,elapsed_ms,detail?,hint?}` document; `running` is `ok:true` with `hint:"call again"` and no `target`
- [x] A-005 R5: `gone` is `ok:false reason:gone` exit 1; uninstrumented is operational without reason; in-`RunE` usage errors are `code:"usage"` exit 2
- [x] A-006 R6: `Arg.When`, `Arg.Default`, `Row.OneOf` exist and are honoured by `BuildArgv`, `ValidateArgs`, `Resolve`, `InputSchema`
- [x] A-007 R7: `Table` has fourteen rows; `send` is `ResultJSON` with `--json`; `answer` and `await` rows match the R7 field lists; `Resolve(rootCmd, Table)` succeeds
- [x] A-008 R8: `just test-backend` passes including the MCP E2E
- [x] A-009 R9: spec column, YAML example, skill pages, `Long` help, and plan-doc W2b rows are updated

### Behavioral Correctness

- [x] A-010 R1: `enter` is `true` only for `delivered`; `sent` with `--key Enter` reports `enter:false`
- [x] A-011 R1: `target` is the resolved `%N` for a `@N` or `=session:window` input; `server` reflects `-L`
- [x] A-012 R2: `unverified %N` is not printed on stdout under `--json`
- [x] A-013 R4: `target` is omitted for `file` and `running`; under `--any` it is the firing pane
- [x] A-014 R4: `detail` is `state`/`echo` for `ready`, `WxH` for `narrow`, absent otherwise; `tab new --ready` text/JSON output is unchanged
- [x] A-015 R6: `BuildArgv` output for every pre-existing row is unchanged
- [x] A-016 R7: `send`'s description still contains "does NOT mean the agent has acted"

### Scenario Coverage

- [x] A-017 R6: argv scenarios — `await` default timeout, `answer` message form, `answer` key form — are asserted in `exec_test.go`
- [x] A-018 R6: `ValidateArgs` rejects `answer` with zero and with two payloads
- [x] A-019 R8: the E2E calls `answer` (`key:"Enter"` ⇒ `sent`) and `await` (`timeout:1` on an uninstrumented pane ⇒ `IsError`) and rejects `key:"C-c"`
- [x] A-020 R3: a `send --await --json` test covers success nesting and the `gone` path

### Edge Cases & Error Handling

- [x] A-021 R2: usage errors under `--json` exit 2 with `code:"usage"`; operational exit 1 with `code:"operational"`; stderr still carries the message
- [x] A-022 R4: `elapsed_ms` is a non-negative integer in every success document
- [x] A-023 R6: `Resolve` rejects an unknown `When`/`OneOf` name, a `Default` on a Boolean or positional arg, and a non-numeric Integer default
- [x] A-024 R7: `await`'s `timeout` schema is `minimum 1`, `maximum 40`, `default 40`; `0` is unreachable over MCP

### Code Quality

- [x] A-025 Pattern consistency: the two verbs follow `operator_request.go`'s `--json` pattern (local flag, `sink.JSONResult`/`JSONError`, `envelopeCode*` constants, error still returned)
- [x] A-026 No unnecessary duplication: no new envelope type or writer; `mapReadyReport` remains the single readiness→report mapping shared with `tab new --ready`
- [x] A-027 Readability: no new function exceeds the surrounding code's typical size; the send/await emit paths are factored rather than duplicated per branch
- [x] A-028 Constitution I: no new subprocess or shell string; argv assembly stays slice-based in `BuildArgv`
- [x] A-029 Tests accompany every changed behavior (`code-quality.md` Principles); comments state constraints, not narration, and cite no change IDs
- [x] A-030 Magic strings: the key enum, until pattern, and hint strings are named constants or table entries, not repeated literals

### Security

- [x] A-031 R7: `answer`'s `key` enum excludes control chords; `send`/`answer` bodies travel on stdin only; no tool exposes `--force`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (the `--json` receipts, the `answer`/`await` policy rows, the `When`/`Default`/`OneOf` model fields) without making existing code redundant. The interim `send` text-receipt path is not dead code: it remains the human (non-`--json`) output by contract (D5 opt-in). The superseded W2a-side `Envelope()` duplicate named in the intake correction lives on PR #949's branch, not in this diff, and is a separate cleanup.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Consume the merged `JSONResult`/`JSONError` (W3a, #945) and add no helper; intake § 1 and Assumption #3 are superseded | Operator correction 2026-09-11; the helper is on `main` and `operator_request.go` shows the consumption pattern | S:95 R:90 A:95 D:95 |
| 2 | Confident | `Arg.Default` is a string emitted verbatim as the flag value and typed only in the JSON schema | Keeps `BuildArgv` uniform (`flag value` strings) and avoids a second typed field; `Resolve` validates integer defaults parse | S:65 R:90 A:85 D:75 |
| 3 | Confident | `readyReport` gains word + detail fields rather than parsing the text line | Shared with `tab new --ready`, whose output must not change; adding fields is additive | S:70 R:90 A:85 D:80 |
| 4 | Confident | `elapsed_ms` for `send --await` covers grace watch + observer (the whole await phase after submit) | The caller re-arming on `running` needs the time actually spent waiting | S:60 R:95 A:80 D:70 |
| 5 | Confident | The `answer` E2E leg uses `key:"Enter"` on the shell pane (plain gate: unknown ⇒ warn + send) | A shell pane is uninstrumented, so the gate warns and sends; no agent needed in the harness | S:70 R:90 A:85 D:80 |
| 6 | Confident | New rows are appended after `operator_request` | Plan doc: parallel waves append rows so rebases stay mechanical | S:80 R:95 A:90 D:90 |

6 assumptions (1 certain, 5 confident, 0 tentative).
