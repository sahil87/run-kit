# Intake: Daemon UTF-8 Locale — Empty Enumeration Fix

**Change**: 260911-rp54-daemon-utf8-locale-empty-enumeration
**Created**: 2026-09-11

## Origin

Conversational. The session opened with `/fab-discuss`, then the user asked:

> Check the issue mentioned in PR https://github.com/sahil87/run-kit/pull/935, understand it, and execute the fix

PR #935 (`docs(backlog): [rp54] daemon lists zero sessions without a UTF-8 locale (tmux 3.7)`, branch `backlog/rp54-daemon-utf8-locale-empty-enumeration`, still OPEN, docs-only) proposes a backlog entry `[rp54]` with a verified root cause, a reproducer, code pointers, and a four-part fix. The entry is **not yet in `fab/backlog.md` on this branch** — this change adopts `rp54` as its change ID so the backlog item can be marked done when the PR lands. The investigating agent re-verified the root cause live on this host before this intake was written:

- tmux **3.7c**, macOS. Against the live `run-kit` socket:

  ```
  $ env -i PATH=$PATH HOME=$HOME tmux -S /private/tmp/tmux-501/run-kit list-sessions -F $'#{session_name}\t#{session_windows}' | od -c
  0000000    _   r   k   -   c   t   l   _   1  \n  ...          ← TAB emitted as '_'
  $ env -i PATH=$PATH HOME=$HOME LANG=en_US.UTF-8 tmux -S ... list-sessions -F $'...' | od -c
  0000000    _   r   k   -   c   t   l  \t   1  \n  ...          ← intact
  $ env -i PATH=$PATH HOME=$HOME LC_CTYPE=C.UTF-8 tmux -S ... list-sessions -F $'...' | od -c
  0000000    _   r   k   -   c   t   l  \t   1  \n  ...          ← intact
  ```

- `locale -a` on this host lists `C.UTF-8`.
- The `rk-daemon` server on this host currently carries `LANG=en_IN.UTF-8` (born from a terminal), so the dashboard is healthy here; the PR author's host (Electron-launched daemon, no `LANG`) showed the empty-state failure.

Key decisions from the conversation (all recorded in `## Assumptions`): fix at the **process-environment** level once at rk startup rather than per tmux exec site; fail **loudly** on undelimited `-F` output; add an OK-shaped **doctor row**; use the literal `C.UTF-8`; run all four parts of the PR's proposal in one change.

## Why

**The pain point.** When the `rk` process has no UTF-8 locale in its environment — none of `LC_ALL`, `LC_CTYPE`, `LANG` is set to a value containing `UTF-8`/`UTF8` — tmux ≥ 3.7 treats the client as non-UTF-8 and sanitizes "invisible" characters in the output it sends to that client (tmux CHANGES 3.6b → 3.7: *"Sanitize pane titles and window and session names more consistently and strictly, prevents C0 characters and other invisible characters causing problems"*). The `\t` that run-kit uses as its field delimiter in **every** `-F` format string (`listDelim = "\t"`, `app/backend/internal/tmux/tmux.go:449`) is emitted as `_`. `parseSessions` (`tmux.go:1005`) splits each line on `\t`, gets one field, and drops the line (`len(parts) < 2 → continue`). `ListSessions` (`tmux.go:1149`) maps zero parsed rows to `nil, nil`. `api/servers.go:91-100` only logs when `err != nil`, so the API answers `GET /api/sessions → []` and `GET /api/servers → sessionCount: 0, windowCount: 0` with HTTP 200 and **no log line**. The dashboard shows servers with nothing in them; `rk mux sessions -L default` from an interactive shell (which has `LANG`) lists them fine — same binary, same tmux. Exit code 0, stdout non-empty, no stderr: no existing guard fires.

**Why the daemon has no locale.** The `rk-daemon` tmux server is born by `rk daemon start` → `internal/daemon.startSession` (`daemon.go:397-411`) via `tmux -L rk-daemon new-session -e RK_DAEMON_LOG=… -d … <exe> serve`, executed through `tmux.Run(ctx, args, RunOpts{Dir: ServerBirthDir()})` — `RunOpts.Env` is nil, so the child inherits the rk process environment minus `TMUX`/`TMUX_PANE` (`internal/tmux/run.go:59-70`). A new tmux server copies the *calling process's* environment into its global environment, and the `run-kit serve` pane inherits that. When the caller is the **Electron shell** (`app/desktop/src/main.ts` `runRk` passes `{...process.env, PATH: augmentPath(...)}`), the environment is a macOS GUI-app environment: `PATH` is patched but there is **no `LANG`** — Terminal.app sets `LANG` for shells, launchd/Finder do not. A plain `rk daemon restart` respawns `run-kit serve` inside that same locale-less tmux server; only `rk daemon restart --full` (kills the server) or a fresh `rk daemon start` from a terminal picks up the caller's `LANG`. Every other locale-less launcher hits the same bug: launchd/systemd units, cron, and chat clients spawning the `rk mcp` stdio server.

**tmux's rule (the contract the fix mirrors).** tmux's client decides UTF-8 capability by string-matching the **first set** variable among `LC_ALL`, `LC_CTYPE`, `LANG`: if that value contains `UTF-8` or `UTF8` (case-insensitive) the client is UTF-8 (`-u` forces it). It is a string match on the env value, not a `setlocale` probe — which is why `LC_CTYPE=C.UTF-8` alone fixes it and why `LC_ALL=C` (set, non-UTF-8) reproduces the breakage even when `LANG` is UTF-8.

**If we don't fix it.** Every GUI-launched or service-launched daemon on tmux ≥ 3.7 shows an empty dashboard with nothing in the logs, and `rk doctor` passes (it reads the CLI's environment, never the daemon's). Users have no signal to act on. As Homebrew rolls tmux 3.7 out, this becomes the default experience for the desktop app.

**Why this approach.** Forcing a UTF-8 ctype once at rk startup covers the daemon, the CLI, the `rk mcp` stdio server, the `tmux-guard` shim exec, and every child in one place — every tmux exec site, the tmuxctl control-mode clients (`pty.Start` inherits the process env), `gh`, `git` — and because `rk daemon start` births the tmux server *from this process*, the server's global environment and every pane (agents included) get a UTF-8 locale too. The independent loud-failure guard means that if tmux ever changes its sanitization again, the symptom is a logged WARN and an error state rather than a silent empty list. Rejected alternatives are in `## Assumptions`.

## What Changes

### 1. Force a UTF-8 ctype once at rk process startup

**Where.** `app/backend/cmd/rk/root.go` `execute()` — the single entry every rk invocation passes through (`main.go` calls `execute()`; `rootCmd.Execute()` runs the `tmux-guard` alias, `serve`, `daemon`, `mcp`, `doctor`, every subcommand). The call goes **before** `rootCmd.Execute()`:

```go
func execute() {
	tmux.EnsureUTF8Locale() // before any subcommand can spawn a child
	if err := rootCmd.Execute(); err != nil {
		os.Exit(exitCode(err))
	}
}
```

**Pure core in `internal/tmux`** (new file, e.g. `internal/tmux/locale.go`), mirroring tmux's rule exactly:

```go
// utf8LocaleFix returns the single env assignment that makes tmux treat this
// process as a UTF-8 client, or ok=false when the environment already does.
// lookup mirrors os.LookupEnv. tmux's client rule: the FIRST SET variable
// among LC_ALL, LC_CTYPE, LANG must contain "UTF-8"/"UTF8" (case-insensitive);
// LC_ALL therefore cannot be worked around from LC_CTYPE.
func utf8LocaleFix(lookup func(string) (string, bool)) (name, value string, ok bool)
```

Decision table (the literal replacement is always `C.UTF-8`):

| Environment (first set of LC_ALL, LC_CTYPE, LANG) | Action |
|---|---|
| none of the three set | set `LC_CTYPE=C.UTF-8` |
| first set is `LC_ALL`, value lacks UTF-8 (e.g. `LC_ALL=C`) | override `LC_ALL=C.UTF-8` (LC_ALL wins tmux's check; `C.UTF-8` keeps C semantics apart from charset) |
| first set is `LC_CTYPE`, value lacks UTF-8 (e.g. `LC_CTYPE=C`) | override `LC_CTYPE=C.UTF-8` |
| first set is `LANG`, value lacks UTF-8 (e.g. `LANG=C`, `LANG=POSIX`) | set `LC_CTYPE=C.UTF-8`, leave `LANG` untouched |
| first set value contains `UTF-8` / `UTF8` / `utf8` (any case) | no change (`ok=false`) |

"Set" means present in the environment — an empty-string value counts as set for tmux, so an `LC_ALL=` row is treated as set-and-non-UTF-8 (override it). Match is `strings.Contains(strings.ToUpper(v), "UTF-8") || strings.Contains(strings.ToUpper(v), "UTF8")`.

**Applier + record.** `EnsureUTF8Locale()` calls `utf8LocaleFix(os.LookupEnv)` and, when `ok`, `os.Setenv(name, value)` and records the assignment in a package-level value readable by doctor (e.g. `ForcedLocale() (name, value string, ok bool)`). Idempotent: a second call sees the UTF-8 value and does nothing. Precedent for process-env mutation in this package: `init()` runs `os.Unsetenv("TMUX")` (`tmux.go:266`).

**Why it propagates everywhere.** `newRunCmd` (`run.go:59-70`) inherits `os.Environ()` minus `TMUX`/`TMUX_PANE`; `sanitizeEnv`/`CleanEnvForServer` (`tmux.go:2005+`) strips only `RK_*` and `DIRENV_*` and reverses direnv's diff, so the forced variable survives into every server rk births (`CreateSession`, `tmuxctl.createAnchor`, `daemon.startSession` via `Run`). The tmuxctl control-mode client (`internal/tmuxctl/client.go:446`, `pty.Start(cmd)` with no `cmd.Env`) and the direct exec sites (`tmux.go:3296`, `cmd/rk/gui_supervise.go:123`, `internal/mcp/exec.go:48` via `withoutTmuxEnv(os.Environ())`, `cmd/rk/tmux_guard.go` `tmuxGuardExecEnv()` from `os.Environ()`) all inherit the process env. No exec site needs editing.

**Not a config key.** Constitution VII — there is nothing to configure; a UTF-8 client is a precondition of run-kit's own output format.

### 2. Fail loudly on undelimited `-F` output

New sentinel in `internal/tmux`:

```go
// ErrNoFieldDelimiter reports -F output whose lines carry no listDelim: tmux
// ≥ 3.7 sanitizes the tab to '_' for a client without a UTF-8 locale, which
// would otherwise parse as an empty (not failed) enumeration.
var ErrNoFieldDelimiter = errors.New("tmux -F output has no field delimiter — non-UTF-8 client locale?")
```

Shared helper, e.g. `checkDelimited(lines []string) error`: returns `nil` when `lines` is empty or **any** line contains `listDelim`; returns `ErrNoFieldDelimiter` when `len(lines) > 0` and no line contains it. (Every list format has ≥ 2 fields — `sessionListFormat()` has 9, the window format 26+ — so a healthy line always carries a tab.)

Call sites:

- **`ListSessions`** (`tmux.go:1149`): after `tmuxExecServer` succeeds and before `parseSessions`, `if err := checkDelimited(lines); err != nil { return nil, err }`. `api/servers.go:91-100` then hits its existing `s.logger.Warn("servers: ListSessions failed", ...)` path; the sessions collector and other callers see an error rather than an empty slice.
- **`ListWindows`** (`tmux.go:1696`): the existing exec-error swallow (`if err != nil { return nil, nil }` — "session disappears mid-tick") is **kept**; the delimiter check runs on the successful `list-windows` output and returns `nil, ErrNoFieldDelimiter` when it trips. The `list-panes` sub-call stays best-effort as today.

`parseSessions`/`parseWindows` signatures are unchanged (the existing test suites — `TestParseSessions*`, window parse tests — depend on them). Error message text is stable so callers can `errors.Is(err, tmux.ErrNoFieldDelimiter)`.

### 3. `rk doctor` `locale` row

In `cmd/rk/doctor.go` `runDoctorChecks()`, add a `locale` check (pattern: `tmuxVersionCheck` returning `doctorCheck{Name, OK, Note, Hint}`), **always OK-shaped** (never a verdict flipper — the code-server / gui / ephemeral-servers posture: state, not a dependency failure). Pure function over injected seams (the `agentHooksCheck(home, readFile, stat)` style) so tests never touch the real env or a real tmux server:

```go
// localeCheck(forced func() (string, string, bool), daemonEnv func(ctx) ([]string, error)) doctorCheck
```

Note composition:

- Process: when `ForcedLocale()` reports an assignment, note `process: no UTF-8 locale in environment; forced LC_CTYPE=C.UTF-8` (naming the variable actually forced — `LC_ALL` in the LC_ALL case). Otherwise `process: <VAR>=<value>` for the first set UTF-8 variable.
- Daemon server: probe `tmux -L rk-daemon show-environment -g` through the `internal/tmux` Run core (`RunOutput`, bounded by `tmux.TmuxTimeout`, argv slice). Parse lines `NAME=value` (tmux prints `-NAME` for unset markers — ignore those). Apply the same first-set-of `LC_ALL`/`LC_CTYPE`/`LANG` rule to the server's global environment. When it carries no UTF-8 locale, append `rk-daemon server env: no UTF-8 locale — panes born there run without one` and set `Hint` to `run 'rk daemon restart --full' from a terminal with LANG set`. When the server is not running (error text matches the existing server-gone patterns — `containsServerGoneText`), degrade silently: omit the daemon fragment, row stays OK.
- The daemon socket name comes from `internal/daemon`'s existing constant (`serverSocket` / the exported equivalent) — no new literal.

Surface check: `rk doctor --json` already emits a `checks` array; a new row is additive. `shll standards help-dump`/`principles` govern help text and flags, neither of which changes — no help-dump regeneration is expected (verify with the existing help-dump test if one snapshots doctor output).

### 4. Tests (run via `just test-backend`)

- **`internal/tmux/locale_test.go`** — table test over `utf8LocaleFix` with a map-backed lookup: none set → `LC_CTYPE=C.UTF-8`; `LANG=C` → `LC_CTYPE=C.UTF-8`; `LANG=POSIX` → `LC_CTYPE`; `LC_ALL=C` → `LC_ALL=C.UTF-8`; `LC_ALL=C` + `LANG=en_US.UTF-8` → `LC_ALL` overridden (LC_ALL wins); `LC_CTYPE=C` → `LC_CTYPE=C.UTF-8`; `LANG=en_US.UTF-8` → no change; `LC_ALL=en_IN.UTF-8` → no change; `LANG=en_US.utf8` (lower, no hyphen) → no change; `LC_CTYPE=` (empty) → override. Plus an `EnsureUTF8Locale` idempotency test using `t.Setenv`.
- **`internal/tmux/tmux_test.go`** (or a sibling file) — `checkDelimited`: `_`-sanitized lines → `ErrNoFieldDelimiter`; healthy tab lines → nil; empty → nil; mixed (one healthy line) → nil. A `ListSessions`/`ListWindows`-level test only if the package already has an exec seam for `RunOutput` (check `run_test.go`'s `TestRun_EnvAndDirOverrides` fixtures) — otherwise the helper test plus the existing parse tests suffice.
- **`internal/tmux/run_test.go`** — extend `TestNewRunCmdEnvironment` (or add a case) asserting a forced `LC_CTYPE` set in the process env is present in the child env built by `newRunCmd`.
- **`cmd/rk/doctor_test.go`** — `localeCheck` over fixture seams: forced process locale → note names the variable; daemon env with `LANG=en_IN.UTF-8` → OK, no hint; daemon env with no locale vars → OK with the pane warning + hint; daemon probe error (server gone) → OK, process fragment only. `show-environment -g` parsing ignores `-NAME` unset markers.

### Workaround (documented in memory, not code)

Until this ships: `rk daemon restart --full` from a terminal that has `LANG` set (a plain `rk daemon restart` keeps the locale-less tmux server), or `tmux -L rk-daemon set-environment -g LC_CTYPE C.UTF-8` before restarting.

## Affected Memory

- `run-kit/architecture/tmux-runner`: (modify) add the startup UTF-8 ctype enforcement (`EnsureUTF8Locale` / `utf8LocaleFix` decision table, `ForcedLocale` record) beside the existing `OriginalTMUX` / `os.Unsetenv("TMUX")` process-env notes and the child-env scrub section; add `ErrNoFieldDelimiter` + `checkDelimited` to the session/window read paths; Design Decision entry (process-env fix over per-site `tmux -u`; literal `C.UTF-8`)
- `run-kit/tmux-sessions`: (modify) session-enumeration section — the tmux ≥ 3.7 non-UTF-8-client sanitization failure mode (`\t` → `_`), why it previously read as an empty server, and that `ListSessions`/`ListWindows` now return `ErrNoFieldDelimiter`
- `run-kit/daemon-lifecycle`: (modify) daemon environment provenance — the Electron/launchd locale-less birth path, why plain `restart` inherits it and `--full` does not, the operational workaround; the new doctor `locale` row beside the existing `agent hooks` row notes
- `run-kit/architecture/cli`: (modify) `doctor` row in the subcommand table gains the `locale` check description; `root.go` note that `execute()` runs `EnsureUTF8Locale()` before `rootCmd.Execute()`

## Impact

**Code (Go backend, `app/backend/`):**

- `cmd/rk/root.go` — one call in `execute()`
- `internal/tmux/locale.go` (new) + `locale_test.go` (new) — rule core, applier, forced-locale record
- `internal/tmux/tmux.go` — `ErrNoFieldDelimiter`, `checkDelimited`, two call sites (`ListSessions`, `ListWindows`)
- `internal/tmux/tmux_test.go` / `run_test.go` — guard tests, env-propagation case
- `cmd/rk/doctor.go` + `doctor_test.go` — `locale` row, daemon `show-environment -g` probe + parser

**Behavior surfaces:**

- Every `rk` process now runs with a UTF-8 `LC_CTYPE` (or `LC_ALL`) when the environment lacked one. Children (tmux, gh, git, agents in panes of servers rk births) inherit it. Existing UTF-8 environments are untouched.
- `GET /api/sessions` / `GET /api/servers` on an affected host now log `servers: ListSessions failed ... no field delimiter` instead of returning silent empties (and after part 1 the condition should no longer arise from rk's own process).
- `rk doctor` gains one always-OK `locale` row (human + `--json`).

**Not in scope:** the frontend; `fab/backlog.md` (PR #935 owns the entry); the Electron shell's `runRk` environment (the process-level fix makes it unnecessary); already-running polluted servers (operational — same caveat as the direnv-diff sanitization memory notes).

**Dependencies:** none new. `C.UTF-8` availability: macOS (all supported), glibc ≥ 2.35, Debian/Ubuntu (long-standing patch). tmux only string-matches the value, so even a host without the locale compiled in gets correct tmux output; other children fall back to C behavior.

## Open Questions

- Should `LC_ALL=C` be overridden to `LC_ALL=C.UTF-8` (chosen — it is the only variable that satisfies tmux's first-set rule when `LC_ALL` is set), or left alone with a doctor warning only? Overriding changes `LC_ALL` for every child; `C.UTF-8` differs from `C` only in charset, so the practical impact is nil, but it is the one row where rk edits a deliberately-set variable.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is tmux ≥ 3.7's non-UTF-8-client output sanitization turning `\t` into `_`, defeating `listDelim` parsing | Reproduced live on this host (tmux 3.7c) with `od -c`; removing/adding `LANG`/`LC_CTYPE` flips it; matches PR #935's bisect | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix at the process-environment level once in `execute()` (`cmd/rk/root.go`), not per tmux exec site | Discussed — one place covers daemon, CLI, `rk mcp`, `tmux-guard`, control-mode clients, and servers rk births (agent panes inherit); precedent: `internal/tmux` already mutates process env (`os.Unsetenv("TMUX")`) | S:90 R:85 A:90 D:85 |
| 3 | Certain | Rejected: passing `tmux -u` at every exec site | Discussed — ~8 direct exec sites plus tmuxctl control-mode clients to thread, and it does nothing for agent panes born without a locale | S:90 R:90 A:90 D:85 |
| 4 | Confident | Replacement value is always the literal `C.UTF-8` (never derived from the existing value, e.g. `en_US` → `en_US.UTF-8`) | Discussed — `C.UTF-8` exists on macOS / glibc ≥ 2.35 / Debian-Ubuntu; a derived name may not exist on the host and would break Python and other children even though tmux only string-matches | S:75 R:85 A:80 D:75 |
| 5 | Certain | Rule mirrors tmux exactly: first SET of `LC_ALL`, `LC_CTYPE`, `LANG` must contain `UTF-8`/`UTF8` (case-insensitive); none set → `LC_CTYPE=C.UTF-8`; non-UTF-8 `LANG` → set `LC_CTYPE`; non-UTF-8 `LC_CTYPE` → override it | tmux's client rule is a string match on the first set variable; `LANG` is lowest priority so `LC_CTYPE` beside it is the minimal edit | S:85 R:80 A:85 D:80 |
| 6 | Confident | Non-UTF-8 `LC_ALL` (e.g. `LC_ALL=C`) is overridden to `LC_ALL=C.UTF-8` | `LC_ALL` wins tmux's check, so `LC_CTYPE` alone cannot fix it; `C.UTF-8` keeps every C-locale semantic except charset. Listed as the one Open Question because it edits a deliberately-set variable | S:70 R:75 A:70 D:60 |
| 7 | Certain | Add `ErrNoFieldDelimiter` + `checkDelimited` in `ListSessions` and `ListWindows`; keep `parseSessions`/`parseWindows` signatures | Discussed — turns a silent empty into a logged WARN via `api/servers.go`'s existing `err != nil` branch; signature freeze protects the large existing parse-test suites | S:90 R:85 A:90 D:90 |
| 8 | Confident | `ListWindows` keeps swallowing exec errors as `nil, nil` (session-gone tolerance) but returns `ErrNoFieldDelimiter` on the successful-output path | Existing comment documents the mid-tick swallow as deliberate; delimiter corruption is a different class (output present but unparseable) | S:75 R:80 A:80 D:75 |
| 9 | Certain | Doctor `locale` row is always OK-shaped (note + hint, never a verdict flipper) | Matches the code-server / gui / ephemeral-servers rows' posture in `runDoctorChecks`; after part 1 the CLI process is always UTF-8, so the row's value is the daemon-env note | S:75 R:90 A:80 D:80 |
| 10 | Confident | Doctor probes the daemon server via `tmux -L rk-daemon show-environment -g` through the `internal/tmux` Run core with `tmux.TmuxTimeout`, degrading silently when the server is gone | Discussed — PR #935 item 3; Constitution I (argv + timeout); reuse of `containsServerGoneText` pattern | S:75 R:85 A:80 D:75 |
| 11 | Confident | Change ID `rp54` adopted from PR #935's proposed backlog entry even though `fab/backlog.md` does not yet carry it on this branch | `fab resolve --id rp54 --or-none` → `(none)`; ties the change to the entry so archive can mark it done once #935 merges; no collision | S:70 R:90 A:75 D:70 |
| 12 | Certain | No configuration key or env toggle for this behavior | Constitution VII; a UTF-8 client is a precondition of run-kit's own `-F` format, not a preference | S:80 R:85 A:85 D:85 |
| 13 | Confident | Doctor's process-locale fragment is rendered from the `ForcedLocale()` record rather than re-deriving from the env | After `EnsureUTF8Locale()` the env is always UTF-8, so only the record can say the host lacked one; exact note wording is presentational and open to the apply agent | S:60 R:90 A:65 D:55 |
| 14 | Confident | `ListSessions`/`ListWindows` exec-level tests only if `run_test.go` already offers a `RunOutput` seam; otherwise `checkDelimited` unit tests plus the existing parse tests are the coverage | Test scaffolding shape is a codebase fact the apply agent will confirm; either outcome satisfies the acceptance intent | S:55 R:90 A:60 D:60 |
| 15 | Tentative | The `fab/backlog.md` `[rp54]` entry stays with PR #935 — this branch does not copy it in | Would-be question under promptless dispatch, but reversible and low-stakes: if #935 merges first the ID already matches; if this ships first, add the entry then <!-- assumed: leave the backlog entry to PR #935 rather than duplicating it here --> | S:40 R:85 A:30 D:35 |

15 assumptions (7 certain, 7 confident, 1 tentative, 0 unresolved).
