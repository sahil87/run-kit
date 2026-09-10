# Plan: rk tab new — Trailing Command, `--json` Identity, `--ready` Gate

**Change**: 260910-wzve-tab-new-command-json-ready
**Intake**: `intake.md`

## Requirements

### CLI: `rk tab new` trailing command

#### R1: Argv after `--` is the only command form
`rk tab new` SHALL accept a command to run in the new window only as positional arguments after `--`. Any positional argument before `--` (or with no `--`) MUST be a usage error (exit 2) whose message names the `--` form. With no positionals, behavior MUST be byte-identical to today (tmux `default-shell`, stdout `@N`).

- **GIVEN** `rk tab new --name w -- claude --model opus`
- **WHEN** the command runs
- **THEN** the window's shell receives argv `[claude, --model, opus]`
- **AND** `rk tab new claude` (no `--`) exits 2 with `command must follow --`

#### R2: Tokens are quoted, never interpreted
Every token after `--` SHALL be emitted into tmux's single `shell-command` positional as one single-quoted word using the `'\''` encoding, joined by single spaces. A token containing `$(…)`, backticks, spaces, quotes, or newlines MUST reach the process as one literal argv element.

- **GIVEN** `rk tab new -- sh -c 'printf %s "$1" > OUT' _ '$(echo pwned)'`
- **WHEN** the window's command finishes
- **THEN** `OUT` contains the literal text `$(echo pwned)`

#### R3: rk-owned exit-shell fallback
When a command is given, rk SHALL append `; exec "${SHELL:-/bin/sh}"` (rk's riff convention, byte-identical to `internal/riff`'s current `shellWrap` output) so the pane drops into the user's interactive shell when the command exits. `--no-shell-fallback` SHALL omit the tail; it MUST be a usage error without a `--` command. No `sh -i -c` wrap is applied around the argv.

- **GIVEN** `rk tab new -- sh -c 'exit 0'`
- **WHEN** the command exits
- **THEN** the pane is still alive and running a shell
- **AND** with `--no-shell-fallback` the pane is dead within the test's wait window

### CLI: identity output

#### R4: Creation returns session, window id, pane id
`internal/tmux` SHALL expose `CreateWindowWithCommandID(session, name, cwd, server, shellCmd string, ops []WindowOptionOp) (WindowBirth, error)` running `new-window -P -F '#{session_name}\t#{window_id}\t#{pane_id}' -a -t =S: -n NAME [-c CWD] [SHELL-CMD] [\; set-option -w …]`. An empty `shellCmd` MUST omit the positional. `CreateWindowWithOptionsID` SHALL become a delegate returning `WindowID` so `rk present --window` and `presentCreateWindowIDFn` are unchanged. A print with a field count other than three MUST be an error.

- **GIVEN** a live test server and `--layout split-h:tty,web`
- **WHEN** `CreateWindowWithCommandID` runs with a command
- **THEN** it returns the tmux-reported session, `@N`, `%N`, and `@rk_win_layout` is set at creation

#### R5: `--json` envelope
`--json` SHALL replace the bare `@N` line with one two-space-indented JSON object `{"session","window_id","pane_id"}` written through the data sink (survives `--quiet`); with `--ready` it SHALL carry one extra key `"ready"`. Without `--json` stdout MUST be exactly `@N\n` regardless of other flags.

- **GIVEN** `rk tab new --json -- sh -c 'sleep 30'`
- **WHEN** parsed as JSON
- **THEN** `session` equals the window's `#{session_name}`, `window_id` starts with `@`, `pane_id` starts with `%`, and no `ready` key is present

### CLI: readiness gate

#### R6: `--ready` classification via the shared await seam
`--ready` SHALL wait on the new pane through `muxAwaitReadyFn(ctx, server, paneID, timeout)` and set `"ready"` to `ready|parked|narrow|running|gone`. The parked screen snippet and the narrow geometry + remedy line SHALL go to stderr ungated, exactly as `rk mux await --ready`. `ready`/`parked`/`narrow`/`running` exit 0; `gone` exits 1 after the JSON is printed. The report mapping SHALL be one helper shared with `runMuxAwaitReady`, whose stdout/stderr/exit contract MUST remain byte-identical (existing `mux_await_test.go` unchanged and green).

- **GIVEN** the await seam stubbed to return `inject.ErrParked` with a snippet
- **WHEN** `rk tab new --json --ready -- agent`
- **THEN** stdout JSON has `"ready": "parked"`, stderr carries the snippet, exit 0
- **AND** with `inject.ErrGone` the JSON has `"ready": "gone"` and exit is 1

#### R7: `--ready` / `--timeout` flag rules
`--ready` MUST require `--json` and a `--` command (usage errors otherwise). `--timeout <secs>` SHALL bound the readiness wait (default 300, `0` = indefinite, negative = usage error) and MUST be a usage error without `--ready`. The SSE-hub wake fires after creation, before the wait.

- **GIVEN** `rk tab new --ready -- agent` (no `--json`)
- **WHEN** it runs
- **THEN** exit 2 with `--ready reports through --json`
- **AND** `rk tab new --timeout 5 -- agent` exits 2 with `--timeout requires --ready`

### Shared quoting package

#### R8: One shell-quoting implementation
A leaf package `internal/shellq` SHALL provide `Quote(token) string`, `QuoteArgv(argv []string) string`, and `WithShellFallback(cmd string) string`, byte-identical to riff's `escapeSingleQuotes`-based quoting and `shellWrap`. `internal/riff` and `internal/daemon/jobs.go`'s `shellQuote` SHALL consume it; riff's composition output MUST be unchanged (its composition tests pass unmodified).

- **GIVEN** `WithShellFallback("")`
- **WHEN** called
- **THEN** it returns `exec "${SHELL:-/bin/sh}"` with no leading `;`
- **AND** `Quote("a'b")` returns `'a'\''b'`

### Docs

#### R9: Help and skill bundle teach the surface
`tabNewCmd` `Use`/`Long` SHALL document the `--` form, the argv-not-shell rule, the `-- sh -c "…"` expansion recipe, the fallback and `--no-shell-fallback`, the `--json` keys, and the `--ready` words. `docs/site/skill.md` SHALL update its `rk tab new` capability line and the `rk tab` output-contract sentence; `docs/specs/ui-state.md` § `rk tab` synopsis SHALL show the new form. `skill_test.go` and the help-dump test MUST pass.

- **GIVEN** `rk tab new --help`
- **WHEN** read
- **THEN** it shows `[-- CMD [ARG…]]`, `--json`, `--ready`, `--timeout`, `--no-shell-fallback`, and the `sh -c` recipe

### Non-Goals

- fab-kit changes (fab-operator.md §6 step 7 retirement, `fab pane open` delegation, rk-absent fallback) — separate repo, follows this release.
- `--detach`/`-d` or manual sizing — not requested; the operator's raw call has no `-d`.
- Any change to `rk present --window` behavior or output.

### Design Decisions

#### Argv after `--`, shell expansion opt-in
**Decision**: The trailing command is argv only; rk quotes each token. Callers needing in-window expansion pass `-- sh -c "<string>"`.
**Why**: Keeps rk's exec surface argv-only (Constitution I) and makes a `$()`-bearing session name or prompt a literal word; the `sh -c` recipe covers fab's `$(basename "$(pwd)")`.
**Rejected**: A `--shell`/string flag — reopens the quoting surface the change exists to close.
*Introduced by*: 260910-wzve-tab-new-command-json-ready

#### `--ready` requires `--json`
**Decision**: `--ready` without `--json` is a usage error.
**Why**: `@N` is the bare datum and has no room for a second word; silently discarding the verdict is worse than refusing.
**Rejected**: Printing the word on stderr — agents branch on stdout; a second stdout line breaks the one-datum rule.
*Introduced by*: 260910-wzve-tab-new-command-json-ready

#### Separate seam for tab new's widened creation call
**Decision**: `tabCreateWindowIDFn` keeps its `(…) (string, error)` signature for `rk present`; `rk tab new` gets `tabNewCreateWindowFn` returning `tmux.WindowBirth`.
**Why**: `present.go` and `present_test.go` stay untouched; both seams remain stubbable.
**Rejected**: Widening the shared seam — forces edits to present tests for no behavior gain.
*Introduced by*: 260910-wzve-tab-new-command-json-ready

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/shellq/shellq.go` with `Quote`, `QuoteArgv`, `WithShellFallback` (move riff's `escapeSingleQuotes`/`shellWrap` bodies; `QuoteArgv` joins quoted tokens with single spaces) and `shellq_test.go` (quote table: empty, plain, space, single quote, `$()`, backtick, newline; argv join; fallback empty/non-empty) <!-- R8 -->
- [x] T002 Switch `internal/riff/shell.go` (`buildSkillShellString`, `buildCmdShellString`, `shellWrap`, `escapeSingleQuotes` call sites and `riff.go:27` comment) and `internal/daemon/jobs.go` `shellQuote` to `shellq`; delete the riff/daemon copies; move the `riff_test.go` `escapeSingleQuotes`/`shellWrap` table cases into `shellq_test.go`; riff composition tests unchanged and green (`cd app/backend && go test ./internal/riff/ ./internal/daemon/ ./internal/shellq/`) <!-- R8 -->

### Phase 2: Core Implementation

- [x] T003 `app/backend/internal/tmux/tmux.go`: add `WindowBirth` and `CreateWindowWithCommandID` (pure `buildCreateWindowWithCommandArgs` + `parseWindowBirth` helpers; tab-separated `-F`; shell-command positional before `\;` option ops; empty cmd omits it); make `CreateWindowWithOptionsID` delegate; unit tests for both helpers in `tmux_test.go` (arg order with/without cmd, three-field parse, bad field count error) <!-- R4 -->
- [x] T004 `app/backend/cmd/rk/mux_await.go`: extract the readiness→report mapping from `runMuxAwaitReady` into a shared helper (returns word, stdout suffix such as `(state)`/`(WxH)`, stderr diagnostic text, exit error); `runMuxAwaitReady` consumes it with byte-identical output; `go test ./cmd/rk/ -run 'MuxAwait'` green unchanged <!-- R6 -->
- [x] T005 `app/backend/cmd/rk/tab_new.go`: add `--json`, `--ready`, `--timeout` (default `awaitDefaultTimeoutSec`), `--no-shell-fallback` flags; `Args` → `usageArgs` validator accepting positionals only after `--` (`cmd.ArgsLenAtDash()`); flag-rule usage errors (R3, R7; negative timeout); compose `shellq.QuoteArgv` + optional `shellq.WithShellFallback`; new seam `tabNewCreateWindowFn` → `tmux.CreateWindowWithCommandID`; JSON via `json.NewEncoder(sink.data)` with two-space indent; `--ready` wait via `muxAwaitReadyFn` after `tabWakeFn`, mapping through T004's helper, `gone` → exit 1 after printing; bare `@N` path unchanged <!-- R1 R2 R3 R5 R6 R7 -->

### Phase 3: Integration & Edge Cases

- [x] T006 `app/backend/cmd/rk/tab_test.go`: extend `resetTabFlagState` for the new flags; integration tests on the isolated server — literal `$(…)` token lands in a file verbatim (R2); fallback keeps the pane alive vs `--no-shell-fallback` pane dead (poll `list-panes` up to ~3 s) (R3); `--json` shape + `session` matches `#{session_name}` + no `ready` key (R5); no-`--` positional, `--ready` w/o `--json`, `--ready` w/o command, `--timeout` w/o `--ready`, `--no-shell-fallback` w/o command, negative timeout all exit 2 and create nothing (R1 R3 R7); `--ready` via `stubAwaitReady` for `ReadyByState`→`ready`, `ErrParked`→`parked` + snippet on stderr, `ErrNarrow`→`narrow`, `ErrNotReady`→`running`, `ErrGone`→`gone` exit 1 with JSON printed, and the timeout reaching the seam (R6 R7) <!-- R1 R2 R3 R5 R6 R7 -->
- [x] T007 `app/backend/cmd/rk/tab_new.go` `Use`/`Long`/flag help and `tab.go` `Long` summary line updated per R9; `go test ./cmd/rk/ -run 'HelpDump|TabHelp'` green <!-- R9 -->

### Phase 4: Polish

- [x] T008 [P] `docs/site/skill.md`: line 41 capability → `rk tab new [--layout L] [--name N] [--json] [--ready] [-- CMD…]` with the pane-id/JSON/fallback note and the `-- sh -c` recipe; line 95 output-contract sentence gains the `--json` object and `ready` key; `go test ./cmd/rk/ -run Skill` green <!-- R9 -->
- [x] T009 [P] `docs/specs/ui-state.md` § `rk tab` synopsis (line ~391) shows the new `rk tab new` form <!-- R9 -->
- [x] T010 Run `just test-backend` and `cd app/backend && go vet ./...`; all green <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->

## Execution Order

- T001 blocks T002 and T005
- T003 and T004 block T005
- T005 blocks T006 and T007
- T008/T009 are independent of code tasks; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A command after `--` runs in the new window; a positional without `--` exits 2 naming the `--` form; no positionals is byte-identical to today
- [x] A-002 R2: Every token is one literal argv element (a `$(…)` token is not expanded)
- [x] A-003 R3: Fallback `; exec "${SHELL:-/bin/sh}"` is appended by default and omitted under `--no-shell-fallback`
- [x] A-004 R4: `CreateWindowWithCommandID` returns tmux-reported session, `@N`, `%N`; `CreateWindowWithOptionsID` delegates and `rk present --window` is unchanged
- [x] A-005 R5: `--json` prints `{session, window_id, pane_id}` (+ `ready` only with `--ready`), two-space indented, through the data sink
- [x] A-006 R6: `--ready` reports `ready|parked|narrow|running|gone` via the shared seam and helper
- [x] A-007 R7: `--ready` requires `--json` and a command; `--timeout` requires `--ready`; negative timeout exits 2
- [x] A-008 R8: `internal/shellq` exists with the three functions; riff and daemon consume it; no remaining `escapeSingleQuotes`/`shellWrap`/`shellQuote` copies
- [x] A-009 R9: Help text, `docs/site/skill.md`, and `docs/specs/ui-state.md` describe the new surface

### Behavioral Correctness

- [x] A-010 R6: `rk mux await --ready` stdout/stderr/exit contract is byte-identical (existing `mux_await_test.go` passes unmodified)
- [x] A-011 R8: riff's composed shell strings are byte-identical (riff composition tests pass unmodified)
- [x] A-012 R5: Without `--json`, stdout is exactly `@N\n` even with a command, `--no-shell-fallback`, or after a `--ready`-less run

### Scenario Coverage

- [x] A-013 R2: Integration test writes a `$(…)` token to a file and asserts it verbatim
- [x] A-014 R3: Integration test shows the pane alive after command exit with fallback and dead without it
- [x] A-015 R6: Seam-stubbed tests cover all five report words, the parked snippet on stderr, and `gone` exit 1 with JSON still printed

### Edge Cases & Error Handling

- [x] A-016 R4: A `-P` print with a field count other than three is an error naming the expected fields
- [x] A-017 R7: `--timeout 0` passes an indefinite (zero) duration to the seam; the default passes 300 s
- [x] A-018 R1: Failed usage validation creates no window (window list unchanged)

### Code Quality

- [x] A-019 Pattern consistency: New code follows the `*Fn` seam, `usageError`, `sink.Dataf`/`sink.data`, and per-call `context.WithTimeout` patterns of the tab/mux families
- [x] A-020 No unnecessary duplication: shell quoting exists once (`internal/shellq`); readiness report mapping exists once
- [x] A-021 exec.CommandContext with timeouts for all subprocess calls; no shell-string construction on rk's own exec path
- [x] A-022 Tests cover the added behavior (new/changed flags, builder, package)
- [x] A-023 Comments state constraints, not narration; no change IDs in code comments
- [x] A-024 No magic strings: fallback literal, format string, and default timeout are named constants or reuse existing ones

### Security

- [x] A-025 R2: The tmux shell-command positional is composed only from rk-quoted tokens plus rk's fixed fallback literal; session/window names still pass `ValidateName`/`ValidateNewName`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the riff `shellWrap`/`escapeSingleQuotes` and daemon `shellQuote` copies it obsoleted were removed in the same diff; no further copies exist)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `rk tab new` gets its own seam `tabNewCreateWindowFn`; `tabCreateWindowIDFn` keeps present's signature | Leaves `present.go`/`present_test.go` untouched; both stubbable | S:60 R:90 A:85 D:75 |
| 2 | Confident | `internal/daemon/jobs.go` `shellQuote` folds into `shellq.Quote` | Encoding is identical (`'\''`), verified by reading the source | S:70 R:90 A:90 D:80 |
| 3 | Confident | riff's `escapeSingleQuotes`/`shellWrap` unit-test tables move into `shellq_test.go`; riff's composition tests stay as the byte-identity oracle | The intake's "riff tests unchanged" applies to composition output; the moved unit tables test the same bytes | S:55 R:90 A:85 D:70 |
| 4 | Confident | Pane-death check in the `--no-shell-fallback` test polls `list-panes` for up to ~3 s | tmux closes the pane asynchronously; a bounded poll avoids flakiness | S:50 R:90 A:80 D:70 |
| 5 | Certain | `-F` fields are tab-separated (`listDelim`) | Session names may contain spaces; package convention | S:70 R:90 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
