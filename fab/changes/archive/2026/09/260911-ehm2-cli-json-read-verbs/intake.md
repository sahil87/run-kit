# Intake: CLI JSON read verbs — the D5 envelope, `mux snapshot list --json`, `gui shot --json`, and the `snapshot_list` / `gui_shot` tools

**Change**: 260911-ehm2-cli-json-read-verbs
**Created**: 2026-09-11

## Origin

> CLI JSON read verbs — D5 envelope helper in cmd/rk; --json on `mux snapshot list` and `gui shot`; wrap existing --json verbs in the envelope without changing their result shape; policy rows for snapshot_list and gui_shot tools.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol exactly: every decision D1-D13 is closed (do not re-open any; docs/specs/mcp.md is design authority where they disagree), the policy table lives in app/backend/internal/mcp/policy.go with a doctor drift-guard, never expose a verb without a policy row, --json stays opt-in everywhere (D5). Base this change on the § Change breakdown → "W2a" row and the § Allowlist v1 table's `snapshot_list`/`gui_shot` rows. Update the plan's Status line and the W2a row when you create/merge this change.

One-shot `/fab-new` invocation (no prior discussion in this session). The change is the **W2a** row of the rk MCP execution plan (`fab/plans/sahil/26-09-10-rk-mcp.md` § Change breakdown → W2 — "CLI shaping"). Design authority is `docs/specs/mcp.md` (§ Envelope, § Policy table, § Allowlist v1); the plan doc owns sequencing only. The intake was grounded by reading the spec, the plan, `internal/mcp/{policy,result,exec}.go`, `cmd/rk/{output,exit_code,root,snapshot,gui_shot}.go`, every existing `--json` emission site in `cmd/rk`, the skill bundle pages, and the downstream consumers of the bare `--json` documents (fab-kit `pane_map.go`, `app/desktop/src/local-daemon.ts`).

**Pickup-protocol constraints carried into this intake (all closed, none re-opened):**

- D2/D3 — every tool is exactly one `rk` verb; a verb is exposed only by a row in `internal/mcp/policy.go`.
- D5 — `--json` is opt-in on every verb; no verb's default (human) output changes; exit codes are unchanged by `--json`.
- D7 — every row's timeout ≤ `ToolTimeoutCap` (45 s).
- D8 — no own-pane/own-server default reaches a tool schema.
- D9 — the proxy execs the verb as argv; the drift guard (`mcp.Resolve`, `rk doctor` `mcp` row) must keep passing.

## Why

**Problem.** W1 (`260910-nuf6`, PR #924) shipped the `rk mcp` stdio server with ten tools, but the CLI side of D5 — the `{"ok":…,"result":…}` / `{"ok":false,"error":{…}}` envelope — does not exist yet. Today:

1. The nine structured-today read verbs emit **bare** JSON documents (`[…]` / `{…}`) on stdout. The proxy's `mapJSONResult` copes through its interim tier (b) — "any valid JSON document is the result, `isError` from the exit code" — but on failure a bare-JSON verb prints nothing on stdout and the proxy has to synthesize `{"code","message"}` from stderr. There is no `hint`, no `reason`, and no single place in `cmd/rk` that owns the machine-error shape.
2. `code exec --json` already prints a document with a boolean `ok` key (the code-bridge `Response`), so the proxy's tier (a) misclassifies it as an rk envelope — a latent shape collision that only the real envelope resolves (once wrapped, the bridge response sits verbatim inside `result`).
3. Two See-intent tools in the allowlist — `snapshot_list` and `gui_shot` — cannot ship because their verbs have no `--json`: `mux snapshot list` prints a human table with a 10-row display cap and no machine form at all; `gui shot` prints a bare PNG path on stdout with geometry only on stderr, so a model gets the image but not its dimensions or display.

**Consequence if not done.** The remaining W2/W3 changes (`send`/`await` receipts, spawn/steer receipts, `operator request`, `board`) each need the envelope as their carrier; without W2a they would each invent it. Claude Desktop cannot see the recovery snapshots or take a screenshot of the GUI desktop. Every machine consumer of `rk … --json` keeps a different failure contract per verb.

**Why this shape.** The spec fixes the answer: one helper in `cmd/rk` (the report-word sink in `output.go` is its named home) emits the envelope; verbs never hand-format it; existing `--json` documents are wrapped **verbatim** inside `result` (the envelope wraps, never reshapes); the unwrapped form retires when the envelope lands on a verb — no compatibility flag (spec § Envelope). W2a is the smallest change that lands the carrier and graduates the two read verbs whose `--json` is cheap (a list already computed as `[]snapshot.Entry`; a path plus three numbers the verb already holds).

## What Changes

### 1. The envelope helper in `cmd/rk/output.go` (D5)

Add to `output.go` — beside `outputSink` — the single envelope writer every `--json` path uses. Proposed shape (names are the plan's to refine; the contract is what matters):

```go
// envelopeError is the machine-error half of the --json envelope
// (docs/specs/mcp.md § Envelope). Code is "usage" (exit 2) or
// "operational" (exit 1/3); Hint and Reason are optional and omitted when empty.
type envelopeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// Envelope writes exactly one JSON document to the data channel and returns
// err unchanged so the caller's RunE keeps its exit code:
//   err == nil  → {"ok":true,"result":<result>}
//   err != nil  → {"ok":false,"error":{code,message[,hint][,reason]}[,"result":<result>]}
// result is included on the failure branch only when non-nil (the
// verdict-bearing verbs — see below). The returned error is wrapped as an
// envelopedError so execute() knows the document has already been written.
func (s outputSink) Envelope(result any, err error) error
```

Rules the helper enforces (all from spec § Envelope):

- **Exactly one document on stdout, nothing else on stdout**; diagnostics stay on stderr. Two-space indented (the `mux sessions`/`tab new` encoder style), trailing newline, written through `sink.data` so it survives `--quiet`.
- **`ok` mirrors the exit code; exit codes are unchanged.** `code` derives from the existing classifier: `exitCode(err) == 2` ⇒ `"usage"`, anything else non-zero ⇒ `"operational"` (riff's 3 included). `message` is `err.Error()` — the same text cobra prints to stderr as `Error: …`. No verb in this change sets `hint` or `reason` (those arrive with W2b's `send` receipts); the fields exist so W2b/W2c add values, not shape.
- **Error path for early returns.** Most `--json` verbs return an error before reaching their encoder (a dead tmux socket, a missing pane). Rather than editing every early `return err`, `execute()` in `root.go` switches from `rootCmd.Execute()` to `rootCmd.ExecuteC()` (which returns the executed `*cobra.Command`) and, when the executed command's `json` flag is set **and** the error is not already an `envelopedError`, writes `{"ok":false,"error":{…}}` to `cmd.OutOrStdout()` before `os.Exit(exitCode(err))`. Verbs therefore change **only their success-path encoder call**; every failure path gets the envelope for free.
- **Boundary — pre-`RunE` usage errors emit no envelope.** Flag-parse failures (`FlagErrorFunc`) and `Args`-validator failures happen before cobra resolves the invoked command's flags, so `rk mux panes --json --bogus` prints cobra's stderr error and exits 2 with **no stdout document**. The proxy already handles this (tier (c): non-envelope non-zero exit ⇒ `{"code":"usage","message":<stderr>}` from the exit code), so nothing is lost over MCP; documenting the boundary is the deliverable.
- **Verdict-bearing verbs keep their data.** Three existing `--json` verbs print a document **and then** return a non-nil error so the exit code carries a verdict: `doctor --json` (report printed, exit 1 when any check fails), `tab new --json` (identity object printed, exit 1 on `ready: gone`), `code exec --all --json` (per-host array printed, exit 1 when any host failed). For these the envelope is `{"ok":false,"result":<the document>,"error":{"code":"operational","message":…}}` — `ok` still mirrors the exit code, and the report the human path already treats as the datum is not thrown away. `result` on the failure branch is an **additive** field: the proxy's `mapEnvelope` ignores it when `ok:false`, and a consumer that only reads `ok`/`error` is unaffected. Hydrate records this in the spec's § Envelope as one sentence (a spec fix-up the pickup protocol allows).

### 2. `rk mux snapshot list --json` (new flag)

`cmd/rk/snapshot.go` — the `list` subcommand (both instances built by `newSnapshotCmd`: the `rk mux snapshot list` family member and the hidden deprecated `rk snapshot list` root alias share the code path) gains a per-instance `--json` bool. Under `--json` the verb emits, through `sink.Envelope`:

```json
{
  "ok": true,
  "result": [
    {
      "server": "runkit",
      "taken_at": "2026-09-11T08:14:02Z",
      "died_at": null,
      "audited_kill": false,
      "sessions": 3,
      "windows": 11,
      "history_count": 10
    },
    {
      "server": "scratch",
      "taken_at": "2026-09-10T22:01:44Z",
      "died_at": "2026-09-10T22:05:10Z",
      "audited_kill": true,
      "sessions": 1,
      "windows": 2,
      "history_count": 0
    }
  ]
}
```

- One object per `snapshot.Entry`, **newest-first as `Store.List` returns them**, keys snake_case (the `cron list --json` convention), timestamps RFC 3339 UTC, `died_at` `null` ⇔ live row (no separate `state` key — it is derivable). An empty store emits `"result": []` (never `null`), mirroring `mux sessions`' alive-but-empty `[]`.
- **The display cap does not apply under `--json`**: `snapshotListCap` is a human-table concern (Toolkit Principle 9 bounds *rendered* rows, never what exists); the machine form carries every entry, and `--all` is accepted but inert with `--json`.
- The optional positional `[<server>]` filter keeps its `validate.ValidateServerName` gate (usage error, exit 2, on a bad name — bare on stderr per the boundary above). `-L`/`--server` stays **rejected** by `muxRejectInheritedServerFlag` exactly as today — this verb addresses the store, not a socket.
- The human table is byte-identical to today. `list`'s `Use` becomes `list [<server>] [--json]`; the parent's `Long` "Subcommands" line for `list` mentions `--json`.

### 3. `rk gui shot --json` (new flag)

`cmd/rk/gui_shot.go` gains a `--json` bool. Under `--json` the verb emits, through `sink.Envelope`:

```json
{
  "ok": true,
  "result": {
    "path": "/tmp/rk-gui-shot-20260911-081402.png",
    "width": 1920,
    "height": 1080,
    "scale": 1,
    "display": ":10"
  }
}
```

- `path` is the absolute PNG path the bare stdout line prints today; `width`/`height` are the **source** geometry and `scale` the applied scale — exactly the three facts the `geometry WxH scale S` stderr line already carries (spec § Receipts: a receipt reuses the fact the human path already prints, never a synonym); `display` is `gui.Status.Display` of the reachable GUI. With `--window <id>` the object also carries `"window": <id>` (omitted otherwise).
- The stderr `geometry …` chatter line **stays** under `--json` (it is `Notef` chatter, dropped by `--quiet`; stdout carries only the envelope). The bare-path stdout contract without `--json` is unchanged (the existing tests pin it byte-for-byte).
- Refusals (macOS, GUI off, GUI enabled-but-unreachable, no screenshot tool, ImageMagick rung missing) keep their exit code and message; under `--json` they surface as `{"ok":false,"error":{"code":"operational","message":…}}` via the `execute()` path; the `--scale`/`--max-width` validation errors surface as `code:"usage"`.
- `Long` gains a `--json` paragraph naming the five keys.

### 4. Wrap every existing `--json` verb in the envelope — result shape verbatim

Each verb below replaces its success-path `json.Marshal`/`Encoder` write with `return sink.Envelope(doc, nil)` (or `sink.Envelope(doc, verdictErr)` for the three verdict-bearing verbs). **The document inside `result` is byte-for-byte the verb's current document** — no key renames, no reordering, no nullability changes (spec § Envelope: "keep their current document verbatim inside `result`"; the plan's "without changing their `result` shape"). The 15 verbs and their emission sites:

| Verb | File:site | Today | Notes |
|------|-----------|-------|-------|
| `mux sessions --json` | `mux_sessions.go:116` | bare array | |
| `mux panes --json` | `mux_panes.go:191` | bare array | fab-kit `pane_map.go` consumer — § Impact |
| `mux capture --json` | `mux_capture.go:214` | bare object | `--json`/`--raw` exclusivity unchanged |
| `mux process --json` | `mux_process.go:284` | bare object | |
| `status --json` | `status.go:74` | bare array | |
| `cron list --json` | `cron_list.go:190` | bare array | skill page `jq '.[]'` example — § 6 |
| `gui status --json` | `gui.go:512` | bare object | always exit 0 |
| `gui windows --json` | `gui_window.go:131` | bare array | |
| `tab show --json` | `tab_show.go:59` | bare object | |
| `tab web ls --json` | `tab_web.go:417` | bare object | |
| `tab new --json` | `tab_new.go:289` | bare object, then `reportErr` on `gone` | **verdict-bearing** → `ok:false` + `result` + `error` |
| `code exec --json` (single) | `code.go:484` | bare bridge `Response` (has its own `ok`) | nests verbatim: `result.ok`, `result.result` |
| `code exec --all --json` | `code.go:549` | bare array, then error when any host failed | **verdict-bearing** |
| `code hosts --json` | `code.go:572` | bare array | |
| `doctor --json` | `doctor.go:726` | bare report, then error when `!report.OK` | **verdict-bearing** |
| `daemon status --json` | `daemon_status.go:127` | bare object | desktop `local-daemon.ts` consumer — § Impact |

Not in scope (not `--json` verbs): `help-dump` (a toolkit-standard contract of its own), the `agent setup` marker/settings JSON files, and the HTTP payload marshals in `notify.go`/`tab_wake.go`.

Each verb's `Long`/flag usage that describes the JSON shape (e.g. `status`: "Emit the session summary as JSON to stdout"; `code exec`: "Print the raw response envelope instead of the result") gets one clause noting the `{"ok","result"}` envelope where the wording would otherwise mislead.

### 5. Policy rows and proxy changes in `internal/mcp`

**`policy.go`** — append two rows (Table order: the existing ten, then these; `send` no longer last, so `TestTableSendRow` indexes by name):

```go
{
	Tool: "snapshot_list", Path: "mux snapshot list",
	Args: []Arg{
		{Name: "server", Positional: 1, Type: ArgString,
			Pattern:     `^[A-Za-z0-9_-]{1,64}$`,   // mirrors validate.ValidateServerName + MaxServerNameLength
			Description: "Only this server's snapshots (live latest + died tombstones); omit for every server"},
		jsonLiteral,
	},
	Result:      ResultJSON,
	Annotations: readOnlyAnn,
	Description: snapshotListDescription, // the verb rejects -L; the filter is positional; rows carry taken_at/died_at/counts
},
{
	Tool: "gui_shot", Path: "gui shot",
	Args: []Arg{
		{Name: "max_width", Flag: "--max-width", Type: ArgInteger, Minimum: intPtr(1)},
		jsonLiteral,
	},
	Result:      ResultImage,
	Annotations: readOnlyAnn,
	Description: guiShotDescription, // returns an image block + {path,width,height,scale,display}; --out/--scale/--window not exposed
},
```

- **No `serverArg` on `snapshot_list`**: the verb rejects the inherited `-L` at runtime (`muxRejectInheritedServerFlag`), and the drift guard only checks the flag *exists* — so a `-L` mapping would resolve at startup and fail every call. The positional filter is the only server input. The `Pattern` must match `validate.ValidateServerName`'s rule (`serverNamePattern` + `MaxServerNameLength` — the plan reads the exact constant).
- **`gui_shot` exposes only `max_width`**: `--scale` is a `float64` pflag and the schema/drift-guard type set is `bool`/`int`/`int64`/`string` only; `--window` is `uint64` (same problem) and a model cannot discover window ids without the tier-two `gui windows` tool; `--out` is a filesystem path outside what the target rule allows. The proxy returns the PNG bytes, so the OS-temp default path is the right one over MCP.
- Both rows carry `readOnlyAnn` (every See row does) and the default timeout (the cap); `gui shot` bounds itself at 10 s + 15 s internally, well inside 45 s.
- Description overrides for both rows: `mux snapshot list` has no `Long` and its parent's help talks about `show`/`restore` (not exposed); `gui shot`'s `Long` promises "the absolute path on stdout" and names three unexposed flags.

**`result.go`** — `mapImageResult` learns the envelope: parse stdout; if it is an object with boolean `ok`: `ok:false` ⇒ `mapEnvelope` (the error path, no file read); `ok:true` ⇒ `path := result.path` (string; missing/non-string ⇒ `IsError` naming the tool) → PNG-signature read as today → `ImageContent{png}` + `TextContent{<result re-serialized>}` (so the model gets `width`/`height`/`scale`/`display` beside the image). A non-envelope stdout keeps today's first-non-empty-line-is-the-path behavior (the interim tier, for symmetry with `mapJSONResult`). `mapJSONResult` is unchanged — its tier (a) is exactly the envelope.

**Drift guard / doctor / e2e**: `mcp.Resolve` must pass with the two rows (`--json` now exists on both verbs; `--max-width` is an `int` pflag). `rk doctor`'s `mcp` note becomes `12 tools; all policy rows resolve`. `mcp_e2e_test.go` asserts the twelve tool names, and — because `snapshot_list` needs no tmux and no display — adds one live call: `snapshot_list` against a temp `XDG_STATE_HOME` (empty store ⇒ `[]`, or seeded with one entry via `internal/snapshot`'s store API) proving the envelope unwraps end-to-end. `gui_shot` stays unit-tested in `result_test.go` against a temp PNG behind an envelope document (no X display in CI).

### 6. Consumers, docs, and the plan doc

- **Skill bundle** (`docs/site/skill.md` and `docs/site/skill/{mux,cron,code,gui,display,tutorial}.md` are the sources; `scripts/sync-skill.sh` copies them to `app/backend/cmd/rk/skill/` and drift-guard tests keep both byte-identical — edit the sources, run the sync): every `--json` mention that describes a shape gains the envelope (`{"ok":true,"result":[…]}`), and the executable examples change — `cron.md:79` `jq -r '.[] | …'` → `jq -r '.result[] | …'`; `tutorial.md:31-32/86` (`rk tab show --json > original-state.json` and the restore that reads keys back) read from `.result`; `mux.md` § panes/sessions/capture/process, `gui.md:35`, `code.md:20/40/55/64`, `display.md:59`, `skill.md:42/44/45/99`. New lines document `rk mux snapshot list --json` (mux page, § server ops) and `rk gui shot --json` (gui page).
- **Desktop shell**: `app/desktop/src/local-daemon.ts` `parseDaemonStatusRunning` reads the running bit from `.result.daemon.running`, accepting the bare `.daemon.running` too (an older `rk` behind a newer shell — `rk` and the desktop package are released together but a user may skip an update). Its unit test gains both shapes.
- **fab-kit (cross-repo, follow-up — not in this change)**: `fab pane map` execs `rk mux panes --json` (`src/go/fab/cmd/fab/pane_map.go` `parseRKPanes`) and falls back **silently** to its own `tmux list-panes` enumeration on unparseable JSON — so after this ships, fab degrades (loses `has_agent`/reconciled state) rather than breaks until fab-kit's reader accepts `{ok,result}`; `fab-operator.md` § spawn-target selection reads `rk mux sessions --json` rows in prose. This change adds one `fab/backlog.md` row tagged `[fab-kit follow-up]` (the existing `csk9`/`wzve`/`7pek` pattern): *make fab's `rk … --json` readers envelope-aware — accept `{"ok":true,"result":<doc>}` and the bare doc, read `error.message` on `ok:false`.*
- **Spec** (`docs/specs/mcp.md`, pickup-protocol item 2): § Allowlist v1 "Structured today" → `yes` for `snapshot_list` and `gui_shot` (verb column becomes `mux snapshot list [server] --json` / `gui shot --json → image block`); § Envelope gains the verdict-bearing sentence from § 1 above and `tab new` joins the "verbs that already emit `--json`" list (it landed off-plan, #925).
- **Plan doc** (`fab/plans/sahil/26-09-10-rk-mcp.md`, pickup-protocol item 5): Status line and the W2a row point at `260911-ehm2` (state `In progress` at creation; `Done` + PR number at merge). The Status-line edit happens at intake time (this invocation); the merge edit is the ship stage's.

## Affected Memory

- `run-kit/mcp`: (modify) the seeded table is twelve tools (add `snapshot_list` — positional server filter, no `-L`; `gui_shot` — `max_width` only, `ResultImage`); `mapImageResult` reads the envelope's `result.path` and returns the result document beside the image; the "No `Table` row uses `ResultImage`" claim retires; § Scope drops the two rows from the not-shipped list; the e2e requirement grows the `snapshot_list` call.
- `run-kit/architecture/cli`: (modify) the shared output convention paragraph gains the `--json` envelope — `outputSink.Envelope`, the `execute()`/`ExecuteC` error path, the `envelopedError` marker, the pre-`RunE` boundary, the verdict-bearing `ok:false`+`result` form, and the list of wrapped verbs.
- `run-kit/layout-snapshots`: (modify) `rk mux snapshot list --json` — the row keys, RFC 3339 timestamps, `died_at` null ⇔ live, full list under `--json` (cap/`--all` display-only).
- `run-kit/gui`: (modify) `rk gui shot --json` — `{path,width,height,scale,display[,window]}`; stderr geometry line retained.
- `run-kit/agent-messaging`: (modify) the `rk mux` family's `--json` members (`sessions`/`panes`/`capture`/`process`) now emit the envelope; result shapes unchanged.
- `run-kit/cron`: (modify) `cron list --json` wrapped; record shape unchanged inside `result`.
- `run-kit/code-bridge`: (modify) `code exec`/`code hosts` `--json` wrapped — the bridge `Response` nests verbatim under `result`; `--all` is verdict-bearing.
- `run-kit/daemon-lifecycle`: (modify) `daemon status --json` wrapped.
- `run-kit/desktop-shell`: (modify) `parseDaemonStatusRunning` accepts the envelope and the bare form.
- `run-kit/toolkit-standards`: (modify) Principle 2 machine-format posture — the envelope is the stable machine format for every `--json` verb; shape stability now applies to `result`.

## Impact

**Code (Go, `app/backend/`)**

- `cmd/rk/output.go` (+ `output_test.go`): `envelopeError`, `outputSink.Envelope`, `envelopedError` (with `Unwrap`), code derivation via `exitCode`.
- `cmd/rk/root.go`: `execute()` → `ExecuteC` + the `--json` error-envelope fallback; `root_test.go` covers a json-flagged command returning an operational error, a usage error from `RunE`, and an already-enveloped error (no double write).
- `cmd/rk/snapshot.go` (+ `snapshot_test.go`): `--json` on `list` (both command instances), the JSON row type, empty-store `[]`, cap bypass; existing table assertions untouched.
- `cmd/rk/gui_shot.go` (+ `gui_shot_test.go`): `--json`, the result struct, `Long`; the bare-path tests stay byte-exact.
- 15 emission sites listed in § 4 and their tests (`mux_sessions_test`, `mux_panes_test`, `mux_capture_test`, `mux_process_test`, `status_test`, `cron_list_test`, `gui_test`, `gui_window_test`, `tab_test`, `code_test`, `doctor_test`, `daemon_test`) — every assertion that parses stdout as the bare document now unwraps `result` (or, where a test pins raw bytes, wraps the expected string). This is the bulk of the diff: mechanical, but wide.
- `internal/mcp/policy.go`, `policy_test.go` (`TestTableShape` twelve names; `TestTableSendRow` finds `send` by name; `TestReadOnlyAnnotations` allows `ResultImage` for `gui_shot`), `result.go`, `result_test.go` (envelope-wrapped image path; `ok:false` image error; legacy bare path).
- `cmd/rk/mcp_e2e_test.go` (twelve tools; `snapshot_list` live call), `cmd/rk/doctor.go` note unchanged in code (count is derived) but `doctor_test.go`'s note assertion, if it pins `10`, moves to `12`.

**Code (desktop)**: `app/desktop/src/local-daemon.ts` + its test.

**Docs**: `docs/site/skill.md`, `docs/site/skill/*.md` (+ synced embeds), `docs/specs/mcp.md` (Structured-today rows, Envelope sentence, `tab new` in the list), `fab/plans/sahil/26-09-10-rk-mcp.md` (Status + W2a), `fab/backlog.md` (one fab-kit follow-up row).

**Behavioral contracts changed (all opt-in `--json` paths; no default output changes)**

- Every `rk … --json` consumer must read `.result` — in-repo consumers updated here; fab-kit degrades to its fallback until its follow-up lands; `shll` has no `rk --json` consumer (grepped).
- `code exec --json` no longer looks like an rk envelope to the proxy by accident.
- Exit codes: unchanged everywhere (asserted per verb in the updated tests).

**Verification gates**: `just test-backend` (unit + the MCP e2e, which `go build`s the real binary), `cd app/frontend && npx tsc --noEmit` is untouched, `just test` for the desktop unit test and the skill drift guards (`TestSkillEmbedMatchesCanonical`), `rk doctor` shows `mcp — 12 tools; all policy rows resolve`, `just build`.

**Pipeline lane**: well above five tasks (helper + root path + 2 new flags + 15 wraps + 2 rows + proxy image path + docs + consumers) — **full lane**.

## Open Questions

- None blocking. The one cross-repo item (fab-kit's envelope-aware readers) is deliberately a follow-up row, not a gate: fab's rk-delegated enumeration fails **silently** to its own path, so shipping W2a first degrades fab's `pane map` (no `has_agent`) rather than breaking it, and the follow-up restores the delegation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Envelope helper lives in `cmd/rk/output.go` beside `outputSink`; verbs never hand-format it | Spec § Envelope names `output.go` as the natural home; the sink is already the single stdout/stderr convention | S:95 R:90 A:95 D:95 |
| 2 | Certain | `ok` mirrors the exit code; `code` derives from `exitCode(err)` (2 ⇒ `usage`, else `operational`); exit codes unchanged | Spec § Envelope rule and D5, verbatim; `exitCode` is the existing pure classifier | S:95 R:90 A:95 D:95 |
| 3 | Confident | Failure-path envelope is written centrally in `execute()` via `rootCmd.ExecuteC()` when the executed command's `json` flag is set and the error is not already an `envelopedError`; verbs edit only their success-path encoder call | Avoids touching every early `return err` in 15 verbs; `ExecuteC` returns the executed command; cobra's stderr `Error:` line is the spec's `message` text; the stateless `envelopedError` marker replaces a package-level "written" flag | S:70 R:75 A:85 D:65 |
| 4 | Confident | Pre-`RunE` usage errors (flag parse, `Args` validators) emit no envelope — bare stderr, exit 2 | Flags are unparsed at that point; the proxy's tier (c) already maps exit 2 to `code:"usage"`; documenting the boundary beats an argv pre-scan | S:60 R:80 A:80 D:60 |
| 5 | Confident | Verdict-bearing verbs (`doctor`, `tab new` gone, `code exec --all`) emit `ok:false` + `result` + `error` — `result` is additive on the failure branch; hydrate adds the sentence to spec § Envelope | Three verbs print data then exit 1 by contract; dropping the report loses the datum, exit 0 violates D5; `mapEnvelope` ignores `result` when `ok:false` | S:60 R:75 A:70 D:45 |
| 6 | Certain | Wrapped verbs keep their current document byte-for-byte inside `result`; the unwrapped form retires with no compatibility flag | Spec § Envelope ("wraps, never reshapes", "no compatibility flag"); plan W2a row; user's own wording | S:95 R:85 A:95 D:95 |
| 7 | Confident | Scope of the wrap is all 15 existing `--json` verbs, including `tab new` (off-plan #925), `doctor`, `daemon status`, `code exec/hosts`, `gui windows` — not only verbs with policy rows | Spec lists 14 by name as "verbs that already emit `--json`"; `tab new` landed after the spec; the plan row says "existing `--json` verbs" without qualification | S:80 R:60 A:80 D:70 |
| 8 | Confident | Ship the wrap now with in-repo consumers updated (desktop `local-daemon.ts`, skill pages) and a `fab/backlog.md` `[fab-kit follow-up]` row for fab-kit's readers, rather than holding the fab-consumed verbs back | fab's `pane map` falls back silently on unparseable JSON (degrade, not break); the no-compat-flag decision is closed; the follow-up pattern (`csk9`/`7pek`) already exists in the backlog | S:80 R:55 A:65 D:60 |
| 9 | Confident | `mux snapshot list --json` rows: snake_case keys `server`, `taken_at`, `died_at` (null ⇔ live), `audited_kill`, `sessions`, `windows`, `history_count`; RFC 3339 UTC timestamps; `[]` when empty | Mirrors `snapshot.Entry` one-to-one; `cron list` set the snake_case precedent; `snapshot show` already prints RFC 3339; `mux sessions` set the `[]`-when-empty precedent | S:65 R:80 A:80 D:60 |
| 10 | Confident | Under `--json` the snapshot list carries every row; the 10-row cap and `--all` are display-only (`--all` inert with `--json`) | `snapshotListCap` is documented as display-only; a machine consumer wants the data; the list is one row per server so it is small | S:55 R:85 A:75 D:55 |
| 11 | Confident | `gui shot --json` result is `{path,width,height,scale,display}` plus `window` only under `--window`; the stderr geometry line stays | Plan says "path + dimensions + display"; spec receipts reuse facts the human path already prints (the stderr line has exactly width/height/scale) | S:75 R:85 A:85 D:70 |
| 12 | Certain | `snapshot_list` row has **no** `-L` `server` input; the positional server filter is the only server input, with a pattern mirroring `ValidateServerName` | The verb rejects inherited `-L` at runtime; the drift guard would still resolve it, so mapping it would break every call; D8 needs no default here (the store is host-wide) | S:85 R:90 A:95 D:90 |
| 13 | Confident | `gui_shot` row exposes only `max_width` (integer ≥ 1); `--scale` (float64), `--window` (uint64), `--out` (path) are not v1 inputs | The drift guard's type set is bool/int/int64/string; window ids are undiscoverable without the tier-two `gui windows` tool; `--out` is a path beyond the target rule; the proxy returns the bytes so the temp default is right | S:65 R:85 A:80 D:65 |
| 14 | Certain | `mapImageResult` reads the envelope (`ok:false` ⇒ error; `ok:true` ⇒ `result.path`, PNG check, image block + result JSON) and keeps the bare-path line as the interim fallback | Spec § Policy table: `result: image` "reads the PNG at the path the verb printed and returns an image content block plus the JSON"; symmetric with `mapJSONResult`'s tiers | S:85 R:85 A:90 D:85 |
| 15 | Certain | Both new rows carry `readOnlyAnn`, default timeout, and description overrides | Spec row-level rules (every See row is read-only); both verbs' Cobra help misleads a model (parent help / unexposed flags / "path on stdout") | S:85 R:95 A:95 D:90 |
| 16 | Confident | Desktop `parseDaemonStatusRunning` accepts both `.result.daemon.running` and the bare `.daemon.running` | A user can run a newer shell against an older `rk`; the parser is a pure function with a null-degrade contract already | S:60 R:90 A:85 D:75 |
| 17 | Certain | Skill pages are edited at `docs/site/skill*.md` and synced with `scripts/sync-skill.sh`; the embedded copies are never hand-edited | The sync script header and the `TestSkillEmbedMatchesCanonical` drift guard say so | S:90 R:95 A:100 D:100 |
| 18 | Certain | Spec edits are limited to the pickup protocol's allowances: "Structured today" column, the envelope sentence for verdict-bearing verbs, and `tab new` in the already-`--json` list; no decision D1–D13 is touched | Pickup protocol items 1–2; the user's explicit instruction | S:95 R:90 A:95 D:95 |
| 19 | Certain | Plan-doc Status line and W2a row are updated at creation (this invocation) and again at merge | The user's explicit instruction; pickup protocol item 5 | S:100 R:95 A:100 D:100 |
| 20 | Confident | The MCP e2e adds a live `snapshot_list` call under a temp `XDG_STATE_HOME`; `gui_shot` stays unit-tested (no X display in CI) | The e2e already builds the real binary and isolates state; a GUI display is unavailable in `just test-backend` | S:60 R:85 A:80 D:70 |

20 assumptions (10 certain, 10 confident, 0 tentative, 0 unresolved).
