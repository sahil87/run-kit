# Intake: CLI send/await receipts (rk MCP W2b)

**Change**: 260911-i2vm-cli-send-await-receipts
**Created**: 2026-09-11

## Origin

> CLI send/await receipts — `mux send --json` returns delivery evidence (D6: echo probe, Enter sent, post-Enter state); `--answer`/`--key` receipt; `mux await --json` returns final state + elapsed, honoring the 45s timeout cap with a `running` result (D7); policy rows for `answer`, `await`; `send` graduates from its interim receipt.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol exactly (D1-D13 closed, docs/specs/mcp.md is design authority on conflicts, policy table in app/backend/internal/mcp/policy.go with doctor drift-guard, never expose a verb without a policy row). Base this change on § Change breakdown → "W2b" row and § Allowlist v1's `answer`/`await`/`send` rows. Note from § Risks: this is the highest-priority W2 slice since the interim `send` receipt misleads (exit 0 means "delivered", not "the agent acted"); reuse the existing `POST /api/windows/{id}/send` JSON body shape inside the envelope rather than inventing a second one. Update the plan's Status line and the W2b row when you create/merge this change.

One-shot `/fab-new` invocation (no preceding discussion in this session). The design was settled in the plan doc (`fab/plans/sahil/26-09-10-rk-mcp.md`, decisions D1–D13 all closed) and the spec it produced (`docs/specs/mcp.md`, the design authority). This intake takes the spec's § Envelope, § Receipts, § Timeout contract, § Policy table and Allowlist v1 rows for `send` / `answer` / `await` as given and records only the implementation decisions the spec leaves to the change. Where the plan doc and the spec differ, the spec wins (pickup protocol item 1).

> **Correction (operator, 2026-09-11, after intake):** the D5 envelope helper already exists on `main` — `JSONResult`/`JSONError` in `app/backend/cmd/rk/output.go`, merged by W3a (PR #945, `260911-sjs1`), not by W2a. Assumption #3 and § What Changes 1 below are retained for the record but **superseded**: this change adds no helper; it consumes the merged `JSONResult`/`JSONError` verbatim (their actual signatures govern, not the sketch in § 1). The § Impact "Parallel-change coordination" paragraph is likewise superseded. W2a's open PR #949 independently adds an `Envelope()` function in the same file — a duplicate to clean up separately, not this change's concern.

**Key facts established while reading the code (2026-09-11):**

- `cmd/rk` has **no `--json` envelope helper yet**. The plan assigns "D5 envelope helper in `cmd/rk`" to W2a, but W2a has not started; W2a ∥ W2b are independent worktrees, so whichever lands first creates it and the other rebases onto it.
- The `internal/inject` engine's `Send` returns only an `error`. The "delivery evidence" D6 names (echo probe passed, Enter sent, post-Enter state) is already fully encoded in the report word plus the three sentinel error types (`inject.ProbeFailure`, `inject.StagedSendFailure`, `inject.SubmitUnverified`) — no engine change is needed to produce the spec's receipt.
- `POST /api/windows/{id}/send` answers `{"ok":true}` on success and `{"error":…,"code":"probe_failure"|"staged_send_failure"|"submit_unverified"}` (409) on engine failure. The spec's envelope already reuses `ok` as its top-level key and those three codes as `error.reason` — this is the "reuse the route's shape" the plan's risk row asks for; nothing new is invented.
- `mux await` exits 1 on `gone` (pane died) and 0 on `running` (timeout expired). `mux send --await` prints the await word as stdout's single final line, replacing the delivery report.
- `mux send --await` is a `NoOptDefVal` string flag (`--await` bare or `--await=idle,waiting`); `internal/mcp.BuildArgv` emits `flag value` as two argv tokens, which pflag would misparse for a `NoOptDefVal` flag. `--key` is a repeatable `StringArray` flag.
- Tests that pin today's state: `internal/mcp/policy_test.go` (exactly ten rows; `Table[len-1]` is `send` with `ResultText`), `cmd/rk/mcp_test.go` (the ten names), `cmd/rk/mcp_e2e_test.go` (ten names; `send` returns text `delivered %N`; description contains "does NOT mean the agent has acted"). `rk doctor`'s `mcp` row prints the tool count.

## Why

**The interim `send` receipt misleads a model.** The `send` MCP tool (W1) returns the verb's bare text line — `delivered %5` — and maps exit 0 to success. A chat client reads that as "done", but the injection engine's `delivered` means only "the text was pasted, its echo was verified, Enter was sent, and the pane changed afterwards". It says nothing about whether the agent acted. The row's description override says so in prose today, which is a mitigation, not a receipt: the model has no structured fields to branch on, no server name, no way to tell `delivered` from `staged`/`sent` without parsing a word, and failure detail arrives only as `exit 1: <stderr>` text. The plan doc ranks this the highest-priority W2 slice for exactly this reason (§ Risks: "Exit 0 means 'delivered by the engine's evidence', not 'the agent acted'").

**Without `await`, a model cannot wait for the effect.** The only way to learn what the agent did is to poll `capture`. `rk mux await` is the purpose-built observer (reached `--until` state / `running` / `gone`), but it has no policy row and no structured output, and its default `--timeout` is 300 s — far past the 45 s MCP tool cap (D7), so it cannot be exposed as-is.

**Without `answer`, a waiting agent is a dead end.** Plain `send` refuses a `waiting` agent by design (the gate matrix). `--answer` is the reply channel and `--key` clears trust walls and pickers, but W1 deliberately left both unexposed ("`--force`, `--answer`, `--key`, and `--await` are not exposed"). The spec's `answer` tool closes the loop: message-answer or a bounded key.

**Why this approach.** D2 (the CLI is the single contract) forbids a tool that reads engine state directly: the receipt must come out of the verb under an opt-in `--json` flag (D5), so every pane agent scripting `rk mux send` gets the same structured evidence for free. The receipt vocabulary is frozen by the spec (§ Receipts: reuse the report word and the `/send` route's 409 codes — "one engine, one evidence vocabulary"), and the envelope shape is frozen by § Envelope. This change therefore adds no new lane, no new engine output, and no new field names: it wires the existing report word + sentinel errors into the toolkit envelope, adds the two missing policy rows, and flips `send` from `result: text` to `result: json`.

**If not done:** every later W2/W3 change ships receipts without the shared envelope helper existing, the model keeps treating "delivered" as "done", and the milestone's first real Claude Desktop session (still unrecorded — plan Status table) is a worse experience than it needs to be.

## What Changes

### 1. The `--json` envelope helper in `cmd/rk` (D5)

A single helper family in `cmd/rk/output.go` (the spec names "the report-word sink in `output.go`" as the natural home) that every envelope-capable verb calls; verbs never hand-format JSON.

```go
// envelope is the toolkit --json document (docs/specs/mcp.md § Envelope).
type envelope struct {
    OK     bool           `json:"ok"`
    Result any            `json:"result,omitempty"`
    Error  *envelopeError `json:"error,omitempty"`
}

type envelopeError struct {
    Code    string `json:"code"`             // "usage" | "operational"
    Message string `json:"message"`          // the same text the human path prints to stderr
    Hint    string `json:"hint,omitempty"`   // machine-neutral next step
    Reason  string `json:"reason,omitempty"` // verb-defined token (send: the three /send 409 codes)
}

// JSONResult writes exactly one {"ok":true,"result":…} document to the data channel.
func (s outputSink) JSONResult(result any) error

// JSONError writes {"ok":false,"error":{…}} to the data channel. The code is
// derived from the error: usage-class (exitCodeError with code 2, the
// usageError wrap) ⇒ "usage", everything else ⇒ "operational". reason/hint are
// supplied by the verb (it knows which sentinel it hit).
func (s outputSink) JSONError(err error, reason, hint string) error
```

Rules (all from the spec, restated as the implementation contract):

- Under `--json`, stdout carries **exactly one** JSON document (trailing newline) and nothing else; every existing `sink.Dataf` report line is suppressed. Diagnostics (`sink.Notef`, the ungated warnings) stay on stderr unchanged.
- **Exit codes are unchanged.** On failure the verb writes the `ok:false` envelope to stdout **and still returns the error** to cobra, so `main` exits 1/2 and stderr carries the message exactly as today. `ok` therefore mirrors the exit code by construction.
- Usage errors that cobra raises **before** `RunE` (unknown flag, `--answer --force` group violation) cannot be enveloped; that is acceptable and unchanged — the MCP proxy's non-envelope fallback already maps exit 2 to `code:"usage"` (`internal/mcp/result.go` tier (c)).
- JSON is compact (`json.Marshal`, one line). The existing `--json` verbs (`mux capture`, `mux panes`, …) use two-space indentation for their bare documents; those graduate to the envelope in W2a, not here, and the envelope helper's compact form is what W2a wraps them in.

The `--json` flag is registered locally on `mux send` and `mux await` (not persistently on `mux` — `capture`/`panes`/`process`/`sessions` already own their own `--json` flags and W2a graduates those).

### 2. `rk mux send --json` — the delivery receipt (D6)

New local flag `--json` on `mux send`. Behavior with the flag:

**Success** (exit 0) — `result` is exactly the spec's § Receipts row:

```json
{"ok":true,"result":{"report":"delivered","target":"%5","server":"default","enter":true}}
{"ok":true,"result":{"report":"staged","target":"%5","server":"default","enter":false}}
{"ok":true,"result":{"report":"sent","target":"%5","server":"default","enter":false}}
```

| Field | Value | Source |
|-------|-------|--------|
| `report` | `delivered` / `staged` / `sent` — the frozen report word the human path prints | `runMuxSend`'s existing `report` variable |
| `target` | the resolved pane id `%N` (a `@N` or `=session:window` target resolves before the receipt) | `paneID` |
| `server` | the resolved tmux server name (`-L` wins, else `$TMUX` socket basename, else `default`) | the `mux` parent's resolution |
| `enter` | `true` iff Enter was sent as part of this delivery: `delivered` ⇒ `true`; `staged` (`--no-enter`) ⇒ `false`; `sent` (`--key`) ⇒ `false` even when the key is `Enter` (a key send is not the engine's probe-gated Enter — the report word already distinguishes them) | derived from the path taken |
| `await` | present **only** with `--await`; carries the `mux await` receipt object (§ 3) for the await phase | `muxSendAwaitPeer` |

How D6's "echo probe, Enter sent, post-Enter state" maps onto this: `report:"delivered"` ⇔ probe passed ∧ Enter sent ∧ post-Enter frame changed (or bounded recovery re-delivered); `report:"staged"` ⇔ probe passed ∧ Enter withheld by request; `report:"sent"` ⇔ raw key send (no probe). The three failure reasons below carry the negative branches. **The engine is not changed** — the receipt is a pure re-encoding of what `runMuxSend` already knows.

**Failure** (exit 1, `ok:false`, `code:"operational"`) — `reason` reuses the `/send` route's 409 codes verbatim:

| Engine outcome today | `reason` | `message` | `hint` |
|----------------------|----------|-----------|--------|
| `inject.ProbeFailure` (paste not echoed; no Enter; text staged) | `probe_failure` | the error's text | `check the pane before resending; a resend would duplicate the staged text` |
| `inject.StagedSendFailure` (text landed, Enter not sent) | `staged_send_failure` | the error's text | `press Enter in the pane to submit` |
| `inject.SubmitUnverified` (Enter sent, pane unchanged after bounded recovery) | `submit_unverified` | the error's text | `capture the pane before resending` |
| Gate refusal (`waiting` without `--answer`, `active`) | *(none)* | `refusing to send to pane %5: agent is waiting (use --answer …)` | `use answer` for the waiting case; none for active |
| Pane does not exist / resolve failure / clear-pane-mode failure | *(none)* | the error's text | *(none)* |

Under `--json` the `unverified %N` stdout line is **not** printed (it would be a second stdout document); the fact travels as `reason:"submit_unverified"`. Exit stays 1. Usage errors raised inside `RunE` (payload XOR, empty message, `--await` + `--no-enter`, bad `--timeout`, bad `--await` states) are enveloped as `code:"usage"` and still exit 2.

**`--await` under `--json`**: the delivery receipt keeps `report:"delivered"` and gains `await:{…}` with the await-phase receipt (§ 3's object; `elapsed_ms` measures the await phase — grace watch + observer). Today's text mode is unchanged (the await word replaces the delivery report as the single stdout line). If the await phase ends `gone` (peer died after delivery), the envelope is `ok:false`, `reason:"gone"`, `message` the gone diagnostic, `hint:"the message was delivered before the pane died"`, exit 1 — the same exit the text path uses. If the await fails **without** a report (e.g. an uninstrumented pane), today the delivery report still prints and the error propagates (exit 1); under `--json` that is `ok:false`, `code:"operational"`, `message` the await error, `hint:"delivered; the wait could not start"`.

**`--answer` / `--key` receipts**: same shape. `--answer <message>` ⇒ `report:"delivered"`, `enter:true`. `--key <k>` ⇒ `report:"sent"`, `enter:false`. Multiple `--key` values remain one `sent` receipt (one line today, one document now).

**Human output is untouched.** Without `--json` every byte of stdout/stderr and every exit code stays as it is (D5, pickup protocol item 4).

### 3. `rk mux await --json` — final state + elapsed (D7)

New local flag `--json` on `mux await`. **Success** (exit 0):

```json
{"ok":true,"result":{"report":"idle","target":"%5","elapsed_ms":1834}}
{"ok":true,"result":{"report":"waiting","target":"%5","elapsed_ms":40012}}
{"ok":true,"result":{"report":"running","target":"%5","elapsed_ms":40003,"hint":"call again"}}
{"ok":true,"result":{"report":"file","elapsed_ms":210}}
{"ok":true,"result":{"report":"ready","target":"%5","elapsed_ms":6120,"detail":"state"}}
{"ok":true,"result":{"report":"ready","target":"%5","elapsed_ms":6120,"detail":"echo"}}
{"ok":true,"result":{"report":"parked","target":"%5","elapsed_ms":9800}}
{"ok":true,"result":{"report":"narrow","target":"%5","elapsed_ms":40,"detail":"54x14"}}
```

| Field | Value |
|-------|-------|
| `report` | the report word exactly as the text path prints it: a reached `--until` state (`idle`/`waiting`/`active`), `file`, `running`, `ready`, `parked`, `narrow` |
| `target` | the pane the report is about: the single target, or under `--any` the **firing** pane. Omitted for `file` and `running` (no pane fired), matching the text path where those words stay bare |
| `elapsed_ms` | wall-clock milliseconds from the start of the observe phase (after target resolution) to the report, as an integer |
| `detail` | present only for `ready` (`"state"` or `"echo"` — which readiness signal fired) and `narrow` (`"WxH"`); these are the parenthesised suffixes the text path already prints |
| `hint` | present only for `running`: the literal `"call again"` (§ Timeout contract — the result "carries `hint:"call again"`") |

`running` is a **success** (`ok:true`, exit 0): the wait expired, nothing failed — the spec is explicit.

**Failure** (exit 1, `ok:false`, `code:"operational"`): `gone` ⇒ `reason:"gone"`, `message` the pane-death diagnostic (`target` is not in the error object — the pane is named in the message as today). An uninstrumented pane with no `--file` (nothing to wait on) ⇒ `ok:false`, `message` the existing diagnostic, no reason. Usage errors (`--ready` combined with `--until`/`--file`/`--after-active`/`--any`, negative `--timeout`, duplicate targets under `--any`, bad `--until` state) ⇒ `code:"usage"`, exit 2.

`--notify` composes unchanged (it reads the report word, fires fail-silent, prints nothing on stdout). The `elapsed_ms` measurement is one `time.Now()` before `awaitObserve` (or `runMuxAwaitReady`) and one after; no new dependency.

### 4. Policy rows — `answer` and `await`; `send` graduates

`app/backend/internal/mcp/policy.go` gains two rows and edits one. The table order becomes the nine See rows, then `send`, `answer`, `await` (appending keeps the W2a/W2c rebase trivial — "the only shared file is the policy table; each change appends rows").

**`send` (graduates):**

```go
{
    Tool: "send", Path: "mux send",
    Args: []Arg{
        serverArg,
        targetArg,
        {Name: "message", Type: ArgString, Required: true, Description: "The text to deliver; submitted with Enter"},
        {Literal: "-"},
        jsonLiteral,
    },
    Stdin:       "message",
    Result:      ResultJSON,
    Annotations: Annotations{},
    Description: sendDescription, // rewritten — see below
},
```

The description override is rewritten for the receipt: it names the `result` fields (`report`, `target`, `server`, `enter`), keeps the load-bearing caveat verbatim — **"`delivered` means the engine verified the text was submitted — it does NOT mean the agent has acted on it; call `await` to wait for the agent's state, or `capture` to read the pane"** — and names the three failure `reason` tokens and what each asks the caller to do. It says `--force` is not exposed and that `--answer`/`--key` live on the `answer` tool. `send --await` is **not** exposed as a tool input in this change (see Assumptions #5): a model composes `send` then `await`.

**`answer` (new):**

```go
{
    Tool: "answer", Path: "mux send",
    Args: []Arg{
        serverArg,
        targetArg,
        {Name: "message", Type: ArgString, Description: "The reply text for a waiting agent; submitted with Enter (mutually exclusive with key)"},
        {Name: "key", Flag: "--key", Type: ArgString,
            Enum: []string{"Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "Space", "BSpace", "y", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"},
            Description: "One tmux key name to press instead of a message — for trust prompts, pickers, and menus (mutually exclusive with message)"},
        {Literal: "--answer", When: "message"},
        {Literal: "-", When: "message"},
        jsonLiteral,
    },
    Stdin:       "message",
    Result:      ResultJSON,
    Annotations: Annotations{},
    Description: answerDescription,
},
```

- Exactly one of `message` / `key` is required. The `Arg` model cannot express one-of, so the **handler enforces it at validation time**: `ValidateArgs` gains a per-row check that when `Row.Stdin` names an input and the row also carries a `key`-style alternative — expressed generically as a new `Row.OneOf []string` field listing input names of which exactly one must be present — a call with zero or two of them is rejected before exec with a one-line message. (Defense in depth: the verb's own payload-XOR usage error would catch it too, but the schema-level rejection is what the model sees first.)
- **`--answer` applies only to the message form.** `--answer` with `--key` is legal for the verb (the gate's `--answer` column governs key sends too), but a key send is a raw keystroke that the `waiting` gate already admits for `--answer`… — to keep one rule: the tool passes `--answer` **only when `message` is present**, so a `key` press against an `active` agent is still refused by the gate (never interrupt a working agent) and against a `waiting` or `idle` agent goes through as today's `rk mux send %5 --key Enter` does (plain key sends ride the plain column: unknown warn+send, idle send, waiting **refuse**).
- To make the two conditional literals possible, `Arg` gains one field: **`When string`** — "emit this Literal only when the named input is present in the call". `BuildArgv` honours it; `Resolve` validates that `When` names an input of the row; existing rows (no `When`) are unaffected. `checkStdin` is relaxed so a stdin input may be optional when the row declares `OneOf` (today `send`'s `message` is `Required: true` and stays so).
- The `key` enum is the spec's closed set verbatim. Control chords are excluded (interrupting an agent is `kill`'s job — W2c).
- The `answer` receipt is the `send` receipt: `report:"delivered"`+`enter:true` for a message, `report:"sent"`+`enter:false` for a key.

**`await` (new):**

```go
{
    Tool: "await", Path: "mux await",
    Args: []Arg{
        serverArg,
        targetArg,
        {Name: "until", Flag: "--until", Type: ArgString,
            Pattern:     `^(idle|waiting|active)(,(idle|waiting|active)){0,2}$`,
            Description: "Comma-separated agent states that end the wait (default idle); waiting wakes when the agent asks a question back"},
        {Name: "timeout", Flag: "--timeout", Type: ArgInteger, Minimum: intPtr(1), Maximum: intPtr(40), Default: "40",
            Description: "Seconds to wait before reporting running (1–40; default 40). On running, call again"},
        {Name: "ready", Flag: "--ready", Type: ArgBoolean,
            Description: "Wait for a freshly spawned agent's BOOT readiness instead of a state: ready | parked (a trust dialog or wall — read the pane and answer it with answer) | narrow (pane below 80x20). Mutually exclusive with until"},
        jsonLiteral,
    },
    Result:      ResultJSON,
    Annotations: readOnlyAnn,
    Description: awaitDescription,
},
```

- **The clamp is structural, not runtime**: `timeout` is bounded `1..40` by the schema and **defaults to 40** when absent, so the verb always reports `running` before the 45 s proxy deadline (§ Timeout contract: "clamped to cap − 5 s (40 s) and passed as `--timeout`"). `0` (indefinite) is unreachable over MCP. To carry the default, `Arg` gains **`Default string`** — "argv value emitted for a `Flag` arg when the input is absent"; `Resolve` rejects a `Default` on a `Literal`/positional/Boolean arg; `InputSchema` surfaces it as the JSON-schema `default`.
- `--any`, `--file`, `--after-active`, `--notify` are **not** exposed: `--file` is a filesystem path (target rule), `--any` takes N targets the flat schema cannot express, `--after-active` and `--notify` have no chat-client use. A model awaiting several panes calls `await` per pane.
- `ready` is exposed because it is the readiness gate a spawn flow needs (W2c's `riff`/`new_window` will hand back a pane; `await ready` + `answer key` is the documented judgment-round loop) and its `parked`/`narrow` verdicts are already in the spec's await result vocabulary. The `until`/`ready` exclusivity is enforced by the verb (usage exit 2 ⇒ `code:"usage"` envelope) and stated in both descriptions.
- Annotations: `readOnlyAnn` (`await` "is read-only even though it blocks"). Row `Timeout` stays the 45 s cap (0 ⇒ cap).

**Descriptions** (`answerDescription`, `awaitDescription`): row-level overrides, because the Cobra help for both verbs is terminal prose about flags the tool does not expose. Each names the receipt fields and the report words the model must branch on.

### 5. `internal/mcp` model additions (minimal)

| Addition | Where | Why |
|----------|-------|-----|
| `Arg.When string` | `policy.go`, `exec.go` (`BuildArgv`), `schema.go` (`Resolve` validates the name) | conditional literals (`--answer`, `-`) on `answer` |
| `Arg.Default string` | `policy.go`, `exec.go` (emit when absent), `schema.go` (`Resolve` shape check; `InputSchema` `default`) | the 40 s structural clamp on `await` |
| `Row.OneOf []string` | `policy.go`, `result.go` (`ValidateArgs` exactly-one check), `schema.go` (`Resolve` validates names; relaxes `checkStdin` to allow an optional stdin input when it is a `OneOf` member) | `answer`'s message-xor-key |

Nothing else in the proxy changes: `MapResult`'s tier (a) already parses the envelope (`ok:true` → `result` re-serialised; `ok:false` → `isError` with `message` + `hint` + `reason`), and it already wins over the exit code — so `send`'s exit-1 `ok:false` envelope maps correctly with no parser edit.

### 6. Tests

- **`cmd/rk/mux_send_test.go`**: `--json` success documents for `delivered`/`staged`/`sent` (exact field set; `enter` per path); `--json` failure envelopes for each sentinel with the right `reason`; `--json --await` carrying `await:{…}` and the `gone` case; usage errors under `--json` still exit 2 with `code:"usage"`; **no** report line on stdout under `--json`; human output byte-identical without the flag (existing tests keep passing untouched).
- **`cmd/rk/mux_await_test.go`**: `--json` for each report word incl. `running` with `hint`, `file` without `target`, `--any` firing pane as `target`, `--ready` with `detail`, `gone` as `ok:false reason:gone`; `elapsed_ms` present and non-negative.
- **`cmd/rk/output_test.go`** (or the existing sink tests): envelope helper — usage vs operational classification, omitted empty `hint`/`reason`, one line + newline.
- **`internal/mcp/policy_test.go`**: twelve rows; `send`/`answer`/`await` shapes (result kinds, annotations, enum, bounds, `Default`, `When`, `OneOf`); every row still resolves.
- **`internal/mcp/exec_test.go`**: `BuildArgv` with `When` present/absent, `Default` present/absent (`["mux","await","-L","s","--timeout","40","%3","--json"]` when `timeout` is omitted); `answer` argv for message form (`["mux","send","%3","--answer","-","--json"]` with stdin) and key form (`["mux","send","--key","Enter","%3","--json"]`, no `-`).
- **`internal/mcp/result_test.go`**: `ValidateArgs` `OneOf` — zero and two members rejected; one accepted.
- **`internal/mcp/schema_test.go`**: `Resolve` rejects a `When`/`OneOf` naming an unknown input and a `Default` on a non-flag arg; `InputSchema` carries `default`.
- **`cmd/rk/mcp_test.go` + `cmd/rk/mcp_e2e_test.go`**: twelve tool names; `send` now returns the JSON `{"report":"delivered",…}` text block (parse it, assert `report=="delivered"` and `target==pane`); `send` description still contains "does NOT mean the agent has acted"; new E2E legs — `await` on the freshly created shell pane with `timeout:1` (uninstrumented pane ⇒ the verb's `isError` diagnostic passes through) and `answer` with `key:"Enter"` on the shell pane (⇒ `report:"sent"`); schema rejections for `key:"C-c"` and for `answer` with both/neither payload.
- **`cmd/rk/doctor_test.go`**: the `mcp` row note reads `12 tools; all policy rows resolve` (if the count is asserted).

### 7. Documentation updated in this change

- **`docs/specs/mcp.md`** — Allowlist v1 "Structured today" column: `send` → `yes (envelope)`, `answer` → `yes (envelope)`, `await` → `yes (envelope)` (pickup protocol item 2). Also record the two schema additions the policy-table example needs (`when:`, `default:`, `one_of:`) so the YAML rendering stays truthful.
- **`docs/site/skill/mux.md`** and **`docs/site/skill/messaging.md`** (the `rk skill` bundle = the MCP server's instructions): one line each under `rk mux send` and `rk mux await` documenting `--json` and the receipt fields, so a pane agent learns the structured form. Help text (`Long`) of both verbs gains a `--json` sentence. (Constitution § Toolkit Standards: a CLI-surface/help change is checked against `shll standards` help-dump and P9 — new flags on existing verbs, nothing unbounded.)
- **`fab/plans/sahil/26-09-10-rk-mcp.md`** — Status line and the W2b rows (Status table + § Change breakdown) updated to `260911-i2vm`, in progress, at intake; and again at merge (pickup protocol item 5).
- Memory (hydrate stage) — see § Affected Memory.

## Affected Memory

- `run-kit/mcp`: (modify) the seeded table is now twelve tools (`send` graduated to `ResultJSON` behind the envelope; `answer` and `await` rows with their enum/bounds/default/conditional-literal shapes); the `Arg.When` / `Arg.Default` / `Row.OneOf` model additions and their `Resolve`/`BuildArgv`/`ValidateArgs` semantics; the E2E legs; the "Scope: what the surface does not ship" list shrinks by `answer`/`await`.
- `run-kit/agent-messaging`: (modify) `rk mux send --json` and `rk mux await --json` receipts (field lists, `running` as success with `hint`, `gone` as `ok:false reason:gone`, the three failure reasons, `--await` nesting), the "receipt is the verb's text report word until the `--json` envelope lands" sentence retired; the report-word contract is unchanged.
- `run-kit/architecture/cli`: (modify) the `mux` row's `send`/`await` usage strings gain `[--json]`; the `outputSink` convention note gains the envelope helper (`JSONResult`/`JSONError` in `output.go`) as the one place the toolkit envelope is emitted.
- `run-kit/toolkit-standards`: (modify) the help-dump/P9 new-surface check row for the `mux` family notes the two new `--json` flags (bounded — one document on stdout).

## Impact

**Code (Go, `app/backend/`)**

- `cmd/rk/output.go` — envelope types + `JSONResult`/`JSONError` on `outputSink` (new, ~60 lines).
- `cmd/rk/mux_send.go` — `--json` flag; receipt struct; envelope emission on every success/failure path inside `RunE`; `--await` nesting; help text sentence.
- `cmd/rk/mux_await.go` — `--json` flag; receipt struct; `elapsed_ms` timing around `awaitObserve`/`runMuxAwaitReady`; `detail` from the existing `readyReport` mapping; help text sentence.
- `internal/mcp/policy.go` — `Arg.When`, `Arg.Default`, `Row.OneOf`; `send` row edit; `answer`, `await` rows; three description constants.
- `internal/mcp/exec.go` — `BuildArgv` honours `When` and `Default`.
- `internal/mcp/schema.go` — `Resolve` validates the three additions; `InputSchema` emits `default`.
- `internal/mcp/result.go` — `ValidateArgs` enforces `OneOf`.
- Tests as listed in § 6. `rk doctor`'s `mcp` note changes count automatically.

**No changes** to `internal/inject` (engine), `api/send.go` (route), the report-word contract, any default (non-`--json`) output, exit codes, or the MCP SDK dependency. No new route, no new tmux option, no daemon involvement (both verbs address tmux directly).

**Docs**: `docs/specs/mcp.md` (Structured today column + policy YAML example), `docs/site/skill/mux.md`, `docs/site/skill/messaging.md`, `fab/plans/sahil/26-09-10-rk-mcp.md`; memory per § Affected Memory.

**Parallel-change coordination**: W2a (`cli-json-read-verbs`) is assigned the envelope helper by the plan and will append `snapshot_list`/`gui_shot` rows; W2c appends fourteen rows. Neither has started. This change creates the helper; if W2a lands first, this change rebases onto its helper (same file, same intent — the spec fixes the shape, so the merge is mechanical). Row appends never conflict beyond a trivial rebase.

**Verification gates** (code-quality.md): `just test-backend` (unit + the MCP E2E, which builds the real binary and drives a real tmux server), `just test` for the smoke check, `just build`. Frontend untouched.

## Open Questions

None. Two judgment calls the spec leaves open are recorded as assumptions #4 (`gone` after a delivered `--await` is `ok:false`) and #7 (key presses ride the plain gate column) for `/fab-clarify` should the user want to steer them; neither changes the plan's shape.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Receipt shapes, field names, `running`-as-success, the three failure `reason` tokens, the 40 s clamp, the closed `key` enum, and the twelve-tool table are taken verbatim from `docs/specs/mcp.md` § Envelope / § Receipts / § Timeout contract / Allowlist v1 | The spec is the design authority (pickup protocol item 1); D1–D13 are closed and not re-opened | S:95 R:90 A:95 D:95 |
| 2 | Certain | No engine change: the D6 evidence (probe, Enter, post-Enter) is encoded by the existing report word + the three `inject` sentinel errors, and the receipt re-encodes those | `inject.Engine.Send` returns only `error`; the spec's `result` fields are all derivable in `runMuxSend`; D2/agent-messaging forbid a second evidence vocabulary | S:85 R:85 A:95 D:90 |
| 3 | Certain | This change creates the `cmd/rk` envelope helper (`output.go`: `JSONResult`/`JSONError`) even though the plan assigns it to W2a | Neither W2 slice has started; the spec fixes the helper's home and shape, so whichever lands first creates it and the other rebases mechanically — waiting on W2a would serialize the "highest-priority W2 slice" behind a lower one | S:70 R:85 A:85 D:75 |
| 4 | Confident | Under `--json`, a `gone` after a successful `send --await` delivery (and an await that cannot start) is `ok:false` with `reason:"gone"` and the delivered fact in `hint`, exit 1 | § Envelope's "ok mirrors the exit code" is normative and today's exit is 1; but the spec's await result vocabulary lists `gone` as a report word, so an `ok:true` reading exists. Chose the exit-code rule; a one-branch change if reversed | S:55 R:85 A:60 D:45 |
| 5 | Confident | `send --await` is **not** exposed as a tool input in W2b; the `send` tool stays the Allowlist row `mux send <target> -`; a model composes `send` then `await` | The Allowlist v1 `send` row carries no `--await`; `--await` is a `NoOptDefVal` flag the proxy's `flag value` argv form would misparse; D7's `send --await` mention is honoured on the CLI (`--json --await` works and nests the await receipt). Exposing it later is a row edit plus a `--flag=value` argv form | S:60 R:85 A:75 D:55 |
| 6 | Confident | `answer` is one tool with a handler-enforced one-of (`message` xor `key`) via a new generic `Row.OneOf`, plus two `When`-conditional literals (`--answer`, `-`) | The spec names one `answer` tool covering both forms and forbids more action enums; the flat `Arg` model needs a conditional and a one-of — both minimal, validated by `Resolve`, and reusable by W2c (`cron_add`'s pane/session/role one-of) | S:75 R:80 A:80 D:70 |
| 7 | Confident | `answer` passes `--answer` only for the message form; a `key` press rides the plain gate column (unknown warn+send, idle send, waiting refuse, active refuse) | A wall is a pre-delivery pane (no agent state ⇒ unknown ⇒ sent), which is the documented judgment-round use; refusing a bare key to a `waiting` agent errs toward safety. If practice shows a waiting agent needs a bare `Enter`, flipping the literal to unconditional is a one-token change | S:50 R:90 A:55 D:45 |
| 8 | Certain | `await` exposes `until`, `timeout` (1–40, schema `default` 40 via a new `Arg.Default`), and `ready`; not `--any`, `--file`, `--after-active`, `--notify` | The clamp must be structural (an absent `--timeout` means 300 s and would hit the proxy backstop); `--file` is a path (target rule), `--any` is N targets, the other two have no chat-client use; `ready`'s verdicts are already in the spec's await vocabulary and are needed by the spawn flows W2c adds | S:75 R:85 A:85 D:75 |
| 9 | Confident | `elapsed_ms` measures the observe phase (after target resolution) and, under `send --await`, the await phase only (grace watch + observer) | The spec names the field but not its origin; observe-phase timing is what a caller re-arming on `running` needs, and resolution time is noise | S:60 R:95 A:80 D:70 |
| 10 | Certain | Human (non-`--json`) output, exit codes, the report-word contract, and the engine are byte-for-byte unchanged | D5 opt-in rule, pickup protocol item 4 ("a change that alters default CLI output is out of plan"), agent-messaging § Report-word contract is frozen | S:95 R:90 A:95 D:95 |
| 11 | Certain | Usage errors raised by cobra before `RunE` (unknown flag, `--answer --force` group) are not enveloped; the proxy's exit-2 → `code:"usage"` fallback covers them | Enveloping pre-`RunE` errors would need a cobra-level hook across every verb; the fallback exists precisely for this and the spec accepts it ("until a verb's envelope lands, …") | S:65 R:85 A:85 D:80 |
| 12 | Confident | The envelope is compact one-line JSON; existing two-space-indented bare `--json` verbs graduate in W2a, not here | "Exactly one JSON document" is the contract; the proxy re-serialises anyway; a line-oriented shell consumer prefers one line | S:55 R:95 A:80 D:75 |
| 13 | Certain | Docs in-change: spec "Structured today" column + policy YAML example, the two skill pages (`mux.md`, `messaging.md`) and both verbs' `Long` help gain a `--json` sentence; plan Status/W2b rows updated at create and at merge | Pickup protocol items 2 and 5; the skill bundle is the MCP instructions block, so a receipt the model cannot read about is half-shipped; Constitution § Toolkit Standards binds the help/skill surfaces | S:80 R:90 A:85 D:85 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
