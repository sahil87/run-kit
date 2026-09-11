# Plan: Daemon UTF-8 Locale — Empty Enumeration Fix

**Change**: 260911-rp54-daemon-utf8-locale-empty-enumeration
**Intake**: `intake.md`

## Requirements

### tmux Runner: Startup UTF-8 Locale Enforcement

#### R1: rk forces a UTF-8 ctype when the environment lacks one
Every `rk` process MUST, before executing any subcommand, ensure that tmux's client-side UTF-8 rule is satisfied by its own environment. The rule mirrors tmux exactly: the **first non-empty** variable among `LC_ALL`, `LC_CTYPE`, `LANG` MUST contain `UTF-8` or `UTF8`, case-insensitive. An empty-string value is skipped exactly like an unset variable (measured on tmux 3.7c: `LC_ALL=` beside `LANG=en_US.UTF-8` keeps the tab intact; `LC_ALL=` beside `LC_CTYPE=C` is sanitized because `LC_CTYPE=C` decides). When the rule fails, `rk` SHALL set exactly one variable to the literal `C.UTF-8`, per this table, and SHALL NOT touch the environment otherwise:

| First non-empty of `LC_ALL`, `LC_CTYPE`, `LANG` | Action |
|---|---|
| none (all unset or empty) | set `LC_CTYPE=C.UTF-8` |
| `LC_ALL`, non-UTF-8 | override `LC_ALL=C.UTF-8` |
| `LC_CTYPE`, non-UTF-8 | override `LC_CTYPE=C.UTF-8` |
| `LANG`, non-UTF-8 | set `LC_CTYPE=C.UTF-8`, leave `LANG` |
| any, value contains `UTF-8`/`UTF8` (any case) | no change |

- **GIVEN** an rk process started with no `LANG`, `LC_ALL`, or `LC_CTYPE` (an Electron- or launchd-born daemon)
- **WHEN** `execute()` runs
- **THEN** `LC_CTYPE=C.UTF-8` is in the process environment before `rootCmd.Execute()` is called
- **AND** every child built from `os.Environ()` (the `internal/tmux` runner core, control-mode clients, `gh`, `git`, servers rk births) inherits it

- **GIVEN** `LC_ALL=C` and `LANG=en_US.UTF-8`
- **WHEN** the rule runs
- **THEN** `LC_ALL` becomes `C.UTF-8` (LC_ALL wins tmux's first-set check, so `LC_CTYPE` alone cannot fix it)

- **GIVEN** `LANG=en_IN.UTF-8`
- **WHEN** the rule runs
- **THEN** nothing changes

#### R2: The enforcement is a pure, idempotent, recorded decision
The decision MUST be a pure function over an injected lookup (`func(string) (string, bool)`, the `os.LookupEnv` shape) so tests never mutate the real environment. The applier (`EnsureUTF8Locale`) MUST be idempotent — a second call observes the UTF-8 value and does nothing — and MUST record the assignment it made (variable name and value) in a package-level record readable via `ForcedLocale()` so `rk doctor` can report that the host lacked a UTF-8 locale after the environment has already been repaired.

- **GIVEN** `EnsureUTF8Locale()` already forced `LC_CTYPE=C.UTF-8`
- **WHEN** it is called again
- **THEN** the environment is unchanged and `ForcedLocale()` still reports `LC_CTYPE`, `C.UTF-8`, `true`

- **GIVEN** a UTF-8 environment
- **WHEN** `EnsureUTF8Locale()` runs
- **THEN** `ForcedLocale()` reports `ok=false`

### tmux Runner: Undelimited `-F` Output Is an Error

#### R3: `ListSessions`/`ListWindows` fail loudly when tmux output carries no field delimiter
`internal/tmux` MUST export a sentinel `ErrNoFieldDelimiter`. When a tab-delimited `-F` list read (`list-sessions`, `list-windows`, `list-panes`) succeeds with non-empty output and **no** line contains `listDelim` (`\t`), the reader SHALL return `ErrNoFieldDelimiter` instead of an empty result. This applies to the user-facing enumerations and the recovery-snapshot readers — `ListSessions`, `ListWindows`, `ListSessionFacts` (behind `rk mux sessions`), and the layout enumerators (`ListLayoutSessions`, `ListLayoutWindows`, `ListLayoutWindow`, `ListLayoutPanes`, `ListLayoutPanesForWindow`) — through one shared wrapper (`tmuxExecList`). The remaining tab-delimited readers in `internal/tmux` (`ListSessionGroups`, `ListActiveWindowsByGroup`, `resolveHomeSession`, `ReorderWindow`'s index read, `ListDeclaredWebRoots`, `ResolveAgentPane`, `ListClients`) stay on `tmuxExecServer` in this change: R1 makes rk's own client always UTF-8, so their sanitized-output path is unreachable from rk and routing them is a follow-up, not a fix. Empty output, and output where at least one line is delimited, are unaffected. `ListWindows` MUST keep swallowing exec-level errors as `nil, nil` (the documented session-gone-mid-tick tolerance) — only the delimiter error is returned. `parseSessions`/`parseWindows` signatures MUST NOT change.

- **GIVEN** tmux ≥ 3.7 answering a non-UTF-8 client, so every `-F` line reads `_rk-ctl_0_1` (tabs sanitized to `_`)
- **WHEN** `ListSessions` runs
- **THEN** it returns `ErrNoFieldDelimiter` and `api/servers.go`'s existing `err != nil` branch logs `servers: ListSessions failed`

- **GIVEN** healthy tab-delimited output
- **WHEN** `ListSessions`/`ListWindows` run
- **THEN** parsing proceeds exactly as before

- **GIVEN** a server with no sessions (empty output)
- **WHEN** `ListSessions` runs
- **THEN** it returns `nil, nil` as before

### CLI: `rk doctor` `locale` Row

#### R4: doctor reports the process and rk-daemon server locale state, always OK-shaped
`rk doctor` MUST append a `locale` check that is never a verdict flipper. Its `Note` SHALL carry two fragments joined by `"; "`:

1. **Process**: when `ForcedLocale()` reports an assignment — `process: no UTF-8 locale in environment; forced <VAR>=C.UTF-8`; otherwise `process: <VAR>=<value>` naming the first set UTF-8 variable.
2. **rk-daemon server** (only when that server is live): probe its global environment via `tmux -L rk-daemon show-environment -g` through the `internal/tmux` runner core under `tmux.TmuxTimeout`, parse `NAME=value` lines (ignoring `-NAME` unset markers), and apply the same first-set rule. UTF-8 → `rk-daemon server: <VAR>=<value>`. Missing → `rk-daemon server env: no UTF-8 locale — panes born there run without one; run 'rk daemon restart --full' from a terminal with LANG set` (remediation lives in the Note because the human renderer prints `Hint` only on FAIL rows). Server not running → the fragment is omitted. Any other probe error → `rk-daemon server env: probe skipped — <err>`, row stays OK.

The row's logic MUST be a pure function over injected seams (forced-locale record, process lookup, daemon-env probe) so tests never touch the real environment or a real tmux server. The daemon socket name MUST come from `daemon.ServerSocket`, never a new literal.

- **GIVEN** the CLI had to force `LC_CTYPE` and the rk-daemon server's global env has `LANG=en_IN.UTF-8`
- **WHEN** `rk doctor` runs
- **THEN** the row is `[ OK ] locale — process: no UTF-8 locale in environment; forced LC_CTYPE=C.UTF-8; rk-daemon server: LANG=en_IN.UTF-8`

- **GIVEN** the rk-daemon server's global env carries no locale variable
- **WHEN** `rk doctor` runs
- **THEN** the row stays OK and its note names the pane consequence and the `rk daemon restart --full` remediation

- **GIVEN** no rk-daemon server is running
- **WHEN** `rk doctor` runs
- **THEN** the row shows only the process fragment

### Non-Goals

- The frontend — no UI change; the fix removes the empty state at its source.
- `fab/backlog.md` — PR #935 owns the `[rp54]` entry.
- The Electron shell's `runRk` environment — the process-level fix makes an env patch there unnecessary.
- Repairing already-running locale-less servers — operational (`rk daemon restart --full`), documented in memory.
- A configuration key or env toggle — Constitution VII; a UTF-8 client is a precondition of run-kit's own `-F` format.

### Design Decisions

#### Process-environment fix at startup, not `tmux -u` per exec site
**Decision**: `execute()` in `cmd/rk/root.go` calls `tmux.EnsureUTF8Locale()` before `rootCmd.Execute()`; no exec site changes.
**Why**: one place covers the daemon, the CLI, `rk mcp` stdio, the `tmux-guard` shim exec, the tmuxctl control-mode clients (`pty.Start` inherits the process env), `gh`/`git`, and — because `rk daemon start` births the tmux server from this process — the server's global environment and every pane/agent born in it. Precedent: `internal/tmux` already mutates process env at init (`os.Unsetenv("TMUX")`).
**Rejected**: passing `-u` on every tmux invocation — ~8 direct exec sites plus the control-mode clients to thread, and it does nothing for agent panes born without a locale.
*Introduced by*: 260911-rp54-daemon-utf8-locale-empty-enumeration

#### The replacement value is always the literal `C.UTF-8`
**Decision**: never derive the replacement from the existing value (`en_US` → `en_US.UTF-8`).
**Why**: `C.UTF-8` exists on macOS, glibc ≥ 2.35, and Debian/Ubuntu; a derived locale name may not exist on the host and would break Python and other children even though tmux only string-matches the value. `C.UTF-8` differs from `C` only in charset, so overriding a deliberately-set `LC_ALL=C` changes no other semantics.
**Rejected**: deriving from the existing value; leaving a non-UTF-8 `LC_ALL` alone with only a doctor warning — `LC_ALL` wins tmux's first-set check, so nothing else can satisfy it.
*Introduced by*: 260911-rp54-daemon-utf8-locale-empty-enumeration

#### Delimiter guard in one list-read wrapper, parse signatures frozen
**Decision**: `tmuxExecList` (`tmuxExecServer` + `checkDelimited`) is the exec path for every tab-delimited `-F` list reader in `internal/tmux`; parse functions keep their `[]T` return shape.
**Why**: turns the silent empty into a logged WARN through `api/servers.go`'s existing error branch, and stays independent of the locale fix (if tmux changes sanitization again, the symptom is a log line, not an empty dashboard). One wrapper means a new list reader gets the guard by construction instead of by remembering a second call. The parse functions have large existing test suites keyed on their signatures.
**Rejected**: putting the check in `tmuxExecServer` — that helper runs commands with no `-F` format too; a per-site `checkDelimited` call after each exec — the first review found three readers (`ListSessionFacts`, the layout enumerators) that had been missed.
*Introduced by*: 260911-rp54-daemon-utf8-locale-empty-enumeration

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/backend/internal/tmux/locale.go`: `LocaleStatus(lookup)` (first NON-EMPTY variable + UTF-8 verdict — empty values skipped like unset), unexported `utf8LocaleFix(lookup) (name, value string, ok bool)` implementing the R1 table with the literal `C.UTF-8`, `EnsureUTF8Locale()` (applies via `os.Setenv`, records once, idempotent), `ForcedLocale()`; plus `locale_test.go` covering every R1 row, case-insensitive `utf8`, empty-value-is-skipped (`LC_ALL=` + UTF-8 `LANG` untouched; `LC_ALL=` + `LC_CTYPE=C` → `LC_CTYPE` override), and `EnsureUTF8Locale` idempotency/record via `t.Setenv` <!-- R1, R2 --> <!-- rework: review measured that tmux skips empty locale values; the rule treated them as set and would override a healthy LC_ALL= -->
- [x] T002 Wire `tmux.EnsureUTF8Locale()` as the first statement of `execute()` in `app/backend/cmd/rk/root.go`; add a `TestNewRunCmdEnvironment` case in `app/backend/internal/tmux/run_test.go` asserting a forced `LC_CTYPE` in the process env reaches the child env built by `newRunCmd` <!-- R1 -->
- [x] T003 In `app/backend/internal/tmux/tmux.go`: add `ErrNoFieldDelimiter`, `checkDelimited(lines []string) error`, and the `tmuxExecList(ctx, server, args...)` wrapper (`tmuxExecServer` + the guard); route the tab-delimited `-F` list readers through it — `ListSessions`, `ListWindows` (delimiter error returned, every other exec error still swallowed as `nil, nil`), `ListSessionFacts` (`session_facts.go`), and the five layout enumerators in `layout.go` (`ListLayoutSessions`, `ListLayoutWindows`, `ListLayoutWindow`, `ListLayoutPanes`, `ListLayoutPanesForWindow`); add tests in `app/backend/internal/tmux/tmux_test.go` for `checkDelimited` (sanitized → error, healthy → nil, empty → nil, mixed → nil) and `errors.Is` on the sentinel <!-- R3 --> <!-- rework: review found `rk mux sessions` (ListSessionFacts) and the snapshot layout readers still mapped sanitized output to empty -->
- [x] T004 In `app/backend/internal/tmux/locale.go` add `ServerGlobalEnv(ctx, server) (map[string]string, error)` (`show-environment -g` via `tmuxExecServer`, self-bounded with `TmuxTimeout` like the package's other read paths, `-NAME` markers skipped, `nil, nil` when the server is gone per `containsServerGoneText`) with a parse test; <!-- rework: review — self-bound the probe's context; cover the unrepaired-process note branch with a test --> in `app/backend/cmd/rk/doctor.go` add the pure `localeCheck(forced, lookup, probe)` per R4 plus package-var seams (`localeForced = tmux.ForcedLocale`, `daemonGlobalEnv` over `tmux.ServerGlobalEnv(ctx, daemon.ServerSocket)`), append the row in `runDoctorChecks` beside the other always-OK rows; tests in `app/backend/cmd/rk/doctor_test.go` for the four note shapes and a never-flips-verdict check <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Verification: `gofmt -l`, `go vet ./...` in `app/backend`, `just test-backend`; run the built `rk doctor` and confirm the `locale` row renders (human + `--json`); re-run the intake's `env -i` reproducer through `rk mux sessions --all` against a live socket to confirm rows now list with no `LANG` <!-- R1, R3, R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `execute()` calls `tmux.EnsureUTF8Locale()` before `rootCmd.Execute()`, and a locale-less environment gains `LC_CTYPE=C.UTF-8`
- [x] A-002 R2: `utf8LocaleFix` is pure over an injected lookup; `EnsureUTF8Locale` is idempotent and `ForcedLocale()` returns the recorded assignment
- [x] A-003 R3: `ErrNoFieldDelimiter` is exported and returned by `ListSessions`, `ListWindows`, `ListSessionFacts`, and the layout enumerators when non-empty output has no `\t` in any line (the eight readers R3 enumerates go through `tmuxExecList`)
- [x] A-004 R4: `rk doctor` (human and `--json`) includes a `locale` row that is always `ok: true`

### Behavioral Correctness

- [x] A-005 R1: every row of the R1 table is implemented exactly — `LC_ALL` override, `LANG`-non-UTF-8 → `LC_CTYPE`, empty values skipped like unset (`LC_ALL=` + UTF-8 `LANG` untouched; `LC_ALL=` + `LC_CTYPE=C` → `LC_CTYPE` override, not `LC_ALL`), and case-insensitive `UTF8`/`utf-8` matching leaves the env untouched
- [x] A-006 R3: `ListWindows` still returns `nil, nil` on exec error; `parseSessions`/`parseWindows` signatures are unchanged and their existing tests pass
- [x] A-007 R4: the daemon-server fragment is omitted when the server is not running, and a non-gone probe error degrades to a skip note with the row still OK

### Scenario Coverage

- [x] A-008 R1: a `newRunCmd` test proves a forced `LC_CTYPE` reaches the child environment (inherit path)
- [x] A-009 R3: tests cover sanitized (`_`) lines → error, healthy lines → nil, empty → nil, mixed → nil
- [x] A-010 R4: tests cover all four note shapes (forced+UTF-8 daemon, UTF-8 process+no-locale daemon, server gone, probe error) and that `-NAME` markers are ignored when parsing `show-environment -g`

### Edge Cases & Error Handling

- [x] A-011 R1: an already-UTF-8 environment (`LANG=en_IN.UTF-8`, `LC_ALL=en_US.utf8`, `LC_ALL=` beside a UTF-8 `LANG`) is never modified
- [x] A-012 R4: the daemon socket name is `daemon.ServerSocket`; no new `"rk-daemon"` literal is introduced

### Code Quality

- [x] A-013 Pattern consistency: new doctor row follows the seam-injected pure-function shape (`ephemeralServersCheck`/`agentHooksCheck` style); tmux probe goes through `tmuxExecServer`/the runner core, never a raw `exec.Command`
- [x] A-014 No unnecessary duplication: `LocaleStatus` is the single first-set/UTF-8 rule shared by the fix and both doctor fragments; server-gone detection reuses `containsServerGoneText`
- [x] A-015 Constitution I: every tmux subprocess is an argv slice under `exec.CommandContext` with a timeout (`tmux.TmuxTimeout`)
- [x] A-016 Comments state constraints (tmux's first-set string-match rule, why LC_ALL must be overridden, why the check lives after exec) — no narration, no change-ID citations in code comments
- [x] A-017 Tests included for every added behavior; `just test-backend` passes

### Security

- [x] A-018 R1: the only environment mutation is a fixed variable name set to the fixed literal `C.UTF-8`; no user-controlled value reaches `os.Setenv`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the startup locale repair and the delimiter guard are both additive. The two
  "silent empty" behaviors they replace are not separable code: `ListSessions`'s
  `if len(sessions) == 0 { return nil, nil }` (`app/backend/internal/tmux/tmux.go:1199`) and
  `parseSessions`' `len(parts) < 2 → continue` (`tmux.go:1059`) both remain load-bearing for a
  genuinely empty server and for malformed single lines.
- `fab/backlog.md` `[rp54]` — nothing to delete on this branch (PR #935 owns the entry); mark it
  done at archive time once #935 merges.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remediation text for the daemon-env fragment lives in `Note`, not `Hint` | The human renderer prints `Hint` only on `[FAIL]` rows and `Note` only on `[ OK ]` rows; an always-OK row with a `Hint` would never show it (the ephemeral-servers row embeds its remediation in the note the same way) | S:90 R:95 A:90 D:90 |
| 2 | Confident | The daemon-server probe reuses `containsServerGoneText` to map "server not running" to an omitted fragment; other probe errors degrade to a skip note | Matches `ListSessions`'s gone-handling and the drift/ephemeral rows' never-block posture | S:80 R:90 A:85 D:80 |
| 3 | Confident | `LocaleStatus` is exported from `internal/tmux` so doctor can apply the identical first-set rule to a parsed server environment | One rule, two consumers; keeps the doctor row free of a second copy of tmux's precedence | S:75 R:90 A:85 D:75 |
| 4 | Confident | Exec-level `ListSessions`/`ListWindows` tests are not added; `checkDelimited` unit tests plus the existing parse tests are the coverage | `run_test.go` offers no `RunOutput` seam — the list functions call the runner directly; introducing a seam for one test would widen the change | S:65 R:90 A:75 D:70 |
| 5 | Certain | tmux consults the first NON-EMPTY of `LC_ALL`, `LC_CTYPE`, `LANG`; an empty value is skipped like an unset one | Measured on this host's tmux 3.7c with matched controls (`LC_ALL=` + UTF-8 `LANG` → tab intact; `LC_ALL=` + `LC_CTYPE=C` → sanitized; `LANG=` alone → sanitized); supersedes the intake's "empty counts as set" wording | S:95 R:90 A:95 D:95 |

5 assumptions (2 certain, 3 confident, 0 tentative).
