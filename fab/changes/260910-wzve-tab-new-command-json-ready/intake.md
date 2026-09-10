# Intake: rk tab new — Trailing Command, `--json` Identity, `--ready` Gate

**Change**: 260910-wzve-tab-new-command-json-ready
**Created**: 2026-09-10

## Origin

Backlog item `[wzve]` (2026-09-10, tagged *fab-kit operator follow-up*), invoked one-shot via `/fab-new wzve` with no prior discussion in the conversation:

> rk tab new: accept a command to run in the new window + print pane_id. Today tab_new.go takes --session =S / --cwd / --name / --layout and prints @N only, so fab operator spawns workers with a raw tmux new-window (-t session: -P -F session_name+pane_id -n »<wt> -c <worktree> "<cmd>; exec $SHELL") per fab-kit src/kit/skills/fab-operator.md §6 step 7, hand-escaping the session name. Add: a trailing command (argv after --, never a shell string) with the "; exec $SHELL" interactive fallback owned by rk (the agent-exit shell fallback convention), --json emitting {session, window_id, pane_id}, and optional --ready that runs the rk mux await --ready classification before returning (report word in the JSON). Keep @N as the bare stdout datum. Retires fab-operator §6 step 7 + its escaping paragraph and lets fab pane open delegate. Tests: tab_test.go seam pattern (tabCreateWindowIDFn).

Key facts established while grounding the intake against the code (all verified in this worktree):

- `app/backend/cmd/rk/tab_new.go` — `Args: cobra.NoArgs`; creates through the `tabCreateWindowIDFn` seam (aliased to `presentCreateWindowIDFn`, shared with `rk present --window` in `present.go:190`) → `tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)`, which runs `new-window -P -F '#{window_id}' -a -t =S: -n NAME [-c CWD] [\; set-option -w …]` and returns only `@N`. No shell-command argument is ever passed, so the window boots tmux's `default-shell`.
- `internal/riff/shell.go` already owns rk's agent-exit shell fallback: `shellWrap(cmd)` → `<cmd>; exec "${SHELL:-/bin/sh}"` (bare `exec "${SHELL:-/bin/sh}"` for an empty cmd) and `escapeSingleQuotes` (POSIX `'\''` encoding). Both are unexported and riff-local. fab-kit's own `spawn.WithShellFallback` appends `; exec "$SHELL"` and is explicitly NOT applied to dispatch pane workers (`fab pane open`/`fab dispatch open` treat pane death as the worker's terminal event).
- `cmd/rk/mux_await.go` — `--ready` classification lives in `runMuxAwaitReady` (report words `ready %N (state|echo)` / `parked %N` / `narrow %N (WxH)` / `running` / `gone`, exit 0 except `gone` → 1, parked snippet / narrow remedy on stderr ungated). The wait itself is behind the `muxAwaitReadyFn(ctx, server, paneID, timeout)` seam, which `mux_await_test.go`'s `stubAwaitReady` already fakes.
- fab-kit's `fab pane open` (`src/go/fab/internal/pane/create.go` `OpenWindow`) runs `new-window -P -F '#{pane_id}' -n NAME -c DIR CMD` — no `-d`, no shell fallback, needs the pane id. Its geometry-floor sibling `OpenManualWindow` adds `-d` + `window-size manual` + `resize-window`.
- `validate.ValidateNewName` forbids `;&|`$(){}[]<>!#*?` whitespace `:` `.` — the operator's `»<wt>` / `›<wt>` marker names pass (non-ASCII is not in the forbidden set).
- Docs that name the verb: `docs/site/skill.md` lines 41 and 95 (embedded `rk skill` bundle), `docs/specs/ui-state.md` § `rk tab` synopsis (line 391), memory `run-kit/architecture.md` `tab` row, `run-kit/toolkit-standards.md` tab-family P9 paragraph, `run-kit/rk-riff.md` (`shellWrap` owner today).

## Why

**The pain.** fab's operator spawns every worker window with a raw `tmux new-window -t '<session>:' -P -F '#{session_name} #{pane_id}' -n "»<wt>" -c <worktree> "$spawn_cmd $prompt; exec \"\$SHELL\""` (fab-operator.md §6 step 7). That line carries three things rk should own and fab should not have to re-derive on every spawn: (1) the exact-match session targeting and its shell-escaping paragraph — a session name from the natural-language §8 setting is interpolated into a shell string, so fab-operator.md spends a paragraph explaining how to keep an embedded `$()`/backtick literal; (2) the `; exec $SHELL` agent-exit fallback, which rk already implements in `internal/riff` for its own spawns; (3) the identity print (`-P -F`) fab needs for enrollment (`fab operator enroll --pane <id> --session <name>`). `rk tab new` is the sanctioned substrate verb for "create a window here" (docs/specs/cli-layering.md: fab consumes substrate facts from rk), yet it cannot run a command, so the operator cannot use it.

**Consequence of not fixing.** Two implementations of the spawn line drift — fab's raw shell string vs rk's `shellWrap` (`exec "$SHELL"` vs `exec "${SHELL:-/bin/sh}"`) already disagree — and every consumer hand-rolls quoting against a session name that flows from free text (a Constitution I concern in the calling agent's shell, even though rk's own process exec is argv-based). `fab pane open` likewise keeps its own `new-window -P -F '#{pane_id}'` path instead of delegating, so the pane-arm readiness gate (open → `fab dispatch ready` → deliver) cannot fold its first classification into the spawn call.

**Why this shape.** Argv after `--` (never a shell string) keeps rk's exec surface argv-only and makes the injection question moot: each token is shell-quoted by rk before tmux's `default-shell -c` sees it, so a token is one word no matter what it contains. The fallback is rk-owned because rk already owns the convention (riff) and the window's shell is rk's concern, not the caller's. `--json` gives the operator the `{session, window_id, pane_id}` triple in one stable envelope (toolkit Principle 2) instead of a two-field `-F` string it must split. `--ready` reuses the existing `rk mux await --ready` classification so a spawner gets `ready|parked|narrow|running|gone` in the same call, removing one round trip from the pane-readiness gate. `@N` stays the bare stdout datum so every existing `rk tab new` consumer is byte-compatible.

## What Changes

### 1. `rk tab new` accepts a trailing command as argv after `--`

New synopsis:

```
rk tab new [--session =S] [--cwd DIR] [--name N] [--layout L] [--json] [--ready [--timeout SECS]] [--no-shell-fallback] [-- CMD [ARG…]]
```

- `Args` changes from `cobra.NoArgs` to an `usageArgs`-wrapped validator that accepts positionals **only after `--`**: `len(args) > 0 && cmd.ArgsLenAtDash() != 0` is a usage error (exit 2): `command must follow --, e.g. rk tab new -- claude --model opus`. With no `--`, behavior is byte-identical to today (tmux `default-shell`, prints `@N`).
- Every token after `--` is one argv element. rk composes tmux's single `shell-command` argument by single-quoting each token with the existing `'\''` encoding and joining with spaces, then appending the fallback (§3). Example — `rk tab new --name »fox --cwd /wt/fox -- claude --dangerously-skip-permissions -n 'run kit' '$(echo pwned)'` composes exactly:

  ```
  'claude' '--dangerously-skip-permissions' '-n' 'run kit' '$(echo pwned)'; exec "${SHELL:-/bin/sh}"
  ```

  and the window's shell receives argv `[claude, --dangerously-skip-permissions, -n, run kit, $(echo pwned)]` — the last token stays a literal string, never expanded.
- **Shell expansion is opt-in by naming the shell.** A caller whose command is a shell string that must expand *inside* the window (fab's `interactive_command` carries `$(basename "$(pwd)")`, which must resolve against the worktree cwd) passes the shell explicitly: `rk tab new --cwd <worktree> -- sh -c "$spawn_cmd $prompt_quoted"`. rk quotes `sh`, `-c`, and the string as three literal tokens; `sh` expands the string in the new window's cwd. This is the documented recipe for the operator migration (help `Long` + skill bundle carry it). No `--shell`/string-form flag is added.
- Flags after `--` are never parsed by cobra (standard dash semantics), so `-- claude --model opus` needs no escaping.

### 2. Window identity returned from the creation call

`internal/tmux` gains one creation builder that prints all three identities in the same `-P -F` and accepts the optional shell-command tail:

```go
// WindowBirth is what new-window -P reports for a freshly created window.
type WindowBirth struct {
    Session  string // #{session_name} as tmux reports it (confirms where the window landed)
    WindowID string // @N
    PaneID   string // %N — the window's initial pane
}

// CreateWindowWithCommandID: new-window -P -F '#{session_name}\t#{window_id}\t#{pane_id}' -a -t =S: -n NAME [-c CWD] [SHELL-CMD] [\; set-option -w …]
func CreateWindowWithCommandID(session, name, cwd, server, shellCmd string, ops []WindowOptionOp) (WindowBirth, error)
```

- `shellCmd == ""` omits the positional entirely (tmux `default-shell`), so the existing `CreateWindowWithOptionsID` becomes a thin delegate returning `birth.WindowID` — `rk present --window` and its `presentCreateWindowIDFn` seam keep their signatures and behavior.
- The shell-command positional is placed **before** the chained `\;` option ops (tmux grammar: `new-window [flags] [shell-command]`, then `\;` starts the next command). The creation-time `--layout` op stays atomic with creation exactly as today.
- Tab-separated format (the package's `listDelim` convention) so a session name containing spaces splits correctly; the parser requires exactly three fields, else `new-window -P returned %q, want session, window id, pane id`.
- The `tabCreateWindowIDFn` seam is re-pointed at the new builder with the widened signature `(session, name, cwd, server, shellCmd string, ops) (tmux.WindowBirth, error)`; `presentCreateWindowIDFn` stays on the old signature via the delegate so `present_test.go`'s stubs are untouched. Both remain stubbable (the backlog's named test pattern).

### 3. rk-owned agent-exit shell fallback, shared with riff

- The composed command gets `; exec "${SHELL:-/bin/sh}"` appended by default — the pane drops into the user's interactive shell when the agent exits instead of closing. This is rk's existing convention (`internal/riff/shell.go` `shellWrap`), and rk's form (`${SHELL:-/bin/sh}`, not fab's bare `$SHELL`) is canonical.
- `shellWrap` and `escapeSingleQuotes` move out of `internal/riff` into a small shared leaf package (working name `internal/shellq`: `Quote(token) string`, `QuoteArgv(argv []string) string`, `WithShellFallback(cmd string) string`) with **byte-identical output**; riff's `buildSkillShellString`/`buildCmdShellString`/`shellWrap` call sites switch to it and riff's existing tests keep passing unchanged. `rk tab new` is the second consumer. (`internal/daemon/jobs.go` has its own `shellQuote`; fold it in only if its encoding is identical — otherwise leave it and note the divergence in the plan.)
- **`--no-shell-fallback`** (bool) omits the tail so the pane dies with the command. This is what lets `fab pane open` / `fab dispatch open` delegate: their state machines treat pane death as the worker's terminal event and must not get a shell afterwards. Usage error (exit 2) when given without a `--` command (`--no-shell-fallback needs a command after --`).
- No `sh -i -c` interactive wrap is applied around the argv (riff's cmd-type panes do not wrap either; wrapping would alter argv semantics). Alias-dependent launchers use the `-- sh -ic '…'` recipe themselves.

### 4. `--json` envelope

- `--json` (bool) switches stdout from the bare `@N` line to one two-space-indented JSON object (the `rk mux sessions --json` encoder pattern, written through `sink.data` so it survives `--quiet`):

  ```json
  {
    "session": "kit",
    "window_id": "@42",
    "pane_id": "%97"
  }
  ```

- With `--ready` the object carries one extra key, `"ready"`, whose value is the classification word (§5):

  ```json
  {
    "session": "kit",
    "window_id": "@42",
    "pane_id": "%97",
    "ready": "parked"
  }
  ```

- `session` is tmux's `#{session_name}` from the creation print, not the resolved flag value — the same "confirms where the window actually landed" guarantee the operator's `-F` gives today. Keys are stable; future fields land as optional (toolkit P2 schema rule).
- Without `--json`, stdout is exactly `@N\n` — unchanged for every existing consumer, including when a command and/or `--no-shell-fallback` are given.

### 5. `--ready` runs the boot-readiness classification before returning

- `--ready` (bool) waits, after creation, for the new pane (`birth.PaneID`) to be boot-ready via the **same** seam `rk mux await --ready` uses (`muxAwaitReadyFn(ctx, server, paneID, timeout)` → `inject.AwaitReady`), then reports the word in the JSON `ready` key: `ready` | `parked` | `narrow` | `running` | `gone`. The sentinel probe is legal here by construction — the pane was created by this very call and nothing has been delivered to it.
- The report-mapping switch in `runMuxAwaitReady` (readiness/error → word, stderr diagnostics, exit class) is extracted into a shared helper both verbs call, so `rk mux await --ready`'s stdout/stderr/exit contract stays byte-identical and `rk tab new --ready` inherits it: the parked screen snippet and the narrow geometry + remedy line go to **stderr ungated** (actionable diagnostics, never dropped by `--quiet`); `ready`/`parked`/`narrow`/`running` exit 0; `gone` exits 1 after the JSON is printed.
- `--timeout <secs>` bounds the readiness wait (default `awaitDefaultTimeoutSec` = 300, `0` = indefinite, negative = usage error), expiring as `running` (exit 0) — the await family contract. `--timeout` without `--ready` is a usage error.
- **`--ready` requires `--json`** (usage error otherwise: `--ready reports through --json; add --json or drop --ready`) — the bare datum stays `@N` and has no room for a second word, and a silently discarded verdict is a worse contract than a refusal. **`--ready` requires a `--` command** (usage error: `--ready needs a command after --`) — a bare shell has nothing to boot and the probe would type into a user shell.
- The SSE-hub wake (`tabWakeFn`) fires after creation as today; with `--ready` it fires before the wait begins so dashboards repaint while the agent boots.

### 6. Exit codes and stream contract (unchanged family rules, extended)

| Outcome | stdout | stderr | exit |
|---------|--------|--------|------|
| created, no `--json` | `@N` | — | 0 |
| created, `--json` | object | — | 0 |
| `--ready` → ready/parked/narrow/running | object with `ready` | parked snippet / narrow remedy when applicable | 0 |
| `--ready` → gone | object with `"ready":"gone"` | `pane %N is gone` | 1 |
| tmux failure / cannot resolve session | — | error | 1 |
| positional before `--`; `--ready` w/o `--json` or w/o command; `--timeout` w/o `--ready`; `--no-shell-fallback` w/o command; bad `--layout`/`--session`/`--name`; negative `--timeout` | — | error | 2 |

### 7. Help, skill bundle, spec

- `tabNewCmd.Use`/`Long` gain the `--` command form, the argv-not-shell rule, the `-- sh -c "…"` expansion recipe, the fallback + `--no-shell-fallback`, `--json` keys, and the `--ready` words. `tabCmd.Long`'s `new` summary line stays one line. The help-dump real-tree test covers the family with no code change (toolkit-standards.md).
- `docs/site/skill.md` line 41 becomes `rk tab new [--layout L] [--name N] [--json] [--ready] [-- CMD…]` with the pane-id/JSON note; line 95's output-contract sentence gains "`--json` prints `{session, window_id, pane_id[, ready]}`". `skill_test.go` keeps asserting the embedded bundle equals the file.
- `docs/specs/ui-state.md` § `rk tab` line 391 synopsis is extended (spec is human-curated; the change proposes the edit).

### 8. Out of scope (explicit non-goals)

- **fab-kit side**: rewriting fab-operator.md §6 step 7 + its escaping paragraph to `rk tab new --session "=$session" --name "»$wt" --cwd "$wt_path" --json -- sh -c "$spawn_cmd $prompt_quoted"` (with the rk-absent raw-tmux fallback per cli-layering), and `fab pane open` delegating its `OpenWindow` shape via `--json --no-shell-fallback`. Those land in fab-kit after this ships; this intake records the exact contract they consume.
- `--detach`/`-d` and manual sizing (`fab pane open`'s geometry-floor `OpenManualWindow` shape) — not requested; the operator's current raw call has no `-d` either. A follow-up flag if fab needs it.
- Changing `rk present --window`'s behavior or output.

## Affected Memory

- `run-kit/architecture`: (modify) `tab` row — `new` gains the `--` argv command, `--json`, `--ready`/`--timeout`, `--no-shell-fallback`; the creation builder returns `WindowBirth`; the shared shell-quoting package appears in the Go-library list
- `run-kit/toolkit-standards`: (modify) tab-family paragraph — P2 `--json` envelope for `tab new`, P9 one-datum rule preserved (`@N` bare, object under `--json`), new usage-error rows
- `run-kit/agent-messaging`: (modify) `await --ready` classification is now a shared helper with a second consumer (`rk tab new --ready`); word vocabulary unchanged
- `run-kit/rk-riff`: (modify) `shellWrap`/`escapeSingleQuotes` relocated to the shared package; riff composition byte-identical
- `run-kit/tmux-sessions`: (modify) the `rk tab new` mention in the `@rk_win_layout` writer column (creation-time ops now ride `CreateWindowWithCommandID`)

## Impact

- **Code**: `app/backend/cmd/rk/tab_new.go` (flags, args validator, composition, JSON, ready), `tab.go` (Long summary), `mux_await.go` (extract report mapping), `present.go` (seam re-point only if the shared seam alias changes), `internal/tmux/tmux.go` (`WindowBirth`, `CreateWindowWithCommandID`, delegate), new `internal/shellq/` (from `internal/riff/shell.go`), `internal/riff/shell.go` (call-site switch).
- **Tests**: `tab_test.go` — real isolated-server cases: `-- sh -c 'printf x > FILE'` creates FILE and the pane survives (fallback) vs `--no-shell-fallback` pane exits; a `$(…)` token stays literal (capture the pane or write it to a file); `--json` shape and `session` field; usage errors (positional before `--`, `--ready` w/o `--json`/command, `--timeout` w/o `--ready`, `--no-shell-fallback` w/o command); `--ready` through the `stubAwaitReady` seam for each word incl. `gone` exit 1 and JSON still printed; `resetTabFlagState` gains the new flags. `internal/shellq` unit tests (quote table incl. empty token, single quote, `$()`, newline). Riff tests unchanged and green. `mux_await_test.go` unchanged and green (byte-identical report contract). `skill_test.go`, help-dump test green.
- **Cross-repo**: fab-kit `fab-operator.md` §6 step 7, `_cli-agents.md` § Spawn Composition, `fab pane open` — consumers of the new contract; their migration is a fab-kit change (backlog there), gated on rk ≥ the release carrying this.
- **Security**: no new shell-string surface — rk's own exec stays argv (`exec.CommandContext` via `tmuxExecServer`); the tmux `shell-command` positional is composed only from rk-quoted tokens plus rk's fixed fallback literal. Session/window names keep `ValidateName`/`ValidateNewName`.
- **Standards**: help-dump (flags appear in `text`/`usage` automatically), P2 (`--json`), P4 (exit table above), P9 (one datum, `--quiet`-safe), skill bundle updated.

## Open Questions

- None blocking. Naming of `--no-shell-fallback` and the "`--ready` requires `--json`" rule are the two judgment calls most worth a glance (Assumptions 3 and 6).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Trailing command is argv after `--` only; no shell-string flag; in-window shell expansion is opt-in via `-- sh -c "…"` | Backlog says "argv after --, never a shell string"; the `sh -c` recipe covers fab's `$(basename "$(pwd)")` case without reopening a string surface | S:85 R:70 A:80 D:75 |
| 2 | Certain | Fallback appended by default when a command is given, in rk's form `; exec "${SHELL:-/bin/sh}"` (riff's `shellWrap`), not fab's bare `$SHELL` | Backlog assigns ownership to rk; rk already has exactly one implementation to reuse | S:80 R:85 A:95 D:90 |
| 3 | Confident | `--no-shell-fallback` bool opts out; usage error without a command | Required for `fab pane open` delegation — fab's `spawn.WithShellFallback` doc says dispatch workers must die on exit; flag name is a guess | S:55 R:80 A:70 D:55 |
| 4 | Confident | `shellWrap`/`escapeSingleQuotes` move to a shared leaf package (`internal/shellq`) with byte-identical output; riff switches call sites | Code-quality "no duplicate utilities"; two consumers now; riff's tests pin the bytes | S:50 R:85 A:80 D:65 |
| 5 | Certain | `--json` object is `{session, window_id, pane_id}` (+ `ready` only with `--ready`); `session` is tmux-reported `#{session_name}`; bare stdout stays `@N` | Backlog names the keys; P2 stable-envelope rule; landed-session confirmation mirrors today's `-F` | S:90 R:75 A:85 D:85 |
| 6 | Confident | `--ready` requires `--json` (usage error otherwise) | The bare datum has no second word and a silently dropped verdict is worse than a refusal; trivially relaxable later | S:60 R:85 A:65 D:45 |
| 7 | Confident | `--ready` requires a `--` command (usage error otherwise) | Nothing to boot in a bare shell; avoids typing a sentinel into a user shell | S:55 R:85 A:70 D:60 |
| 8 | Confident | `--timeout <secs>` only with `--ready`; default 300 s (await family), 0 = indefinite; `running` on expiry exit 0; `gone` exit 1 after JSON | Mirrors `rk mux await --ready` so callers learn one contract | S:50 R:85 A:80 D:70 |
| 9 | Certain | Report mapping extracted from `runMuxAwaitReady` into a helper shared by both verbs; `rk mux await` output byte-identical; stderr diagnostics ungated | Existing `mux_await_test.go` pins the contract; backlog says "runs the rk mux await --ready classification" | S:75 R:85 A:90 D:90 |
| 10 | Confident | No `-d`/detach or manual-sizing flags in this change | Not requested; operator's current raw call has no `-d`; `OpenManualWindow` shape stays in fab until asked | S:45 R:90 A:65 D:55 |
| 11 | Certain | One creation path: new `CreateWindowWithCommandID` returning `WindowBirth`; `CreateWindowWithOptionsID` becomes a delegate so `rk present` and its seam are untouched | Code-quality single tmux path; present_test stubs must keep compiling | S:70 R:85 A:90 D:85 |
| 12 | Certain | fab-kit changes (operator §6 step 7 retirement, `fab pane open` delegation, rk-absent fallback) are out of this repo's scope and follow in fab-kit | Different repo; cli-layering assigns choreography to fab | S:85 R:90 A:90 D:90 |
| 13 | Confident | Argv is not wrapped in `sh -i -c`; alias-dependent launchers use `-- sh -ic '…'` themselves | riff's cmd-type panes set the precedent; wrapping would alter argv semantics | S:50 R:85 A:80 D:70 |
| 14 | Certain | Docs touched: help `Long`, `docs/site/skill.md` lines 41/95, `docs/specs/ui-state.md` synopsis proposal; README has no `rk tab new` mention | Skill standard binds the bundle to the binary; spec is human-curated so the edit is a proposal | S:60 R:90 A:85 D:80 |

14 assumptions (6 certain, 8 confident, 0 tentative, 0 unresolved).
