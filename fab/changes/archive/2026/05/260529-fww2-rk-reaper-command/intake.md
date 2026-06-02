# Intake: rk reaper command

**Change**: 260529-fww2-rk-reaper-command
**Created**: 2026-05-29
**Status**: Draft

## Origin

Backlog item `[fww2]` (2026-05-29, from `fab/backlog.md`), refined through a `/fab-discuss` design conversation. The design is fully resolved — the conversation deliberately overrode several aspects of the original backlog text (notably the startup-sweep placement and the PID-liveness gate).

> Add a new top-level CLI command `rk reaper` — an operator-invoked janitor that reaps leaked test tmux servers and stale sockets left behind in the tmux socket directory (`/tmp/tmux-{uid}/`). Change type: chore (new operator/maintenance command, low blast radius).

The backlog item surfaced because test tmux servers currently leak: runtime filters in `/api/servers` (commit `612f84f`, `app/backend/api/servers.go:33`) and the tmuxctl supervisor (commit `7ba1a5d`, `app/backend/internal/tmuxctl/supervisor.go:37`) merely **hide** these orphan test servers from the UI, but their socket files and tmux daemon processes keep accumulating on disk. The existing startup sweep `sweepOrphanedRelaySessions` (`app/backend/cmd/rk/serve_sweep.go`) only reaps `rk-relay-*` **sessions** within live servers — it never reaps whole servers and never touches dead sockets. PR #199 also left `.lock` recursion orphan sockets needing a one-time manual cleanup.

Key decisions reached in the design conversation (vs. the original backlog text):

1. **Standalone top-level command, not a startup sweep.** The original backlog text proposed *extending* `sweepOrphanedRelaySessions` to also reap servers at `rk serve` startup. The design conversation rejected this: the reaper is operator-invoked, a "janitor of last resort." The startup sweep stays untouched.
2. **No PID-liveness gate.** The backlog text suggested parsing `rk-test-<pid>-<ns>` and checking `kill(pid, 0)`. The conversation rejected this: that gate was for a startup-time design. Because the reaper is operator-invoked, the human running it is asserting "nothing live needs these," so all matched test servers reap unconditionally.

## Why

1. **Problem**: Leaked test tmux servers accumulate socket files and dead tmux daemon processes on disk in `/tmp/tmux-{uid}/`. Two distinct leak shapes exist today: (a) **live** orphan test servers (daemon still running, socket probes OK) and (b) **dead** test sockets (daemon already exited, socket file orphaned). PR #199's `.lock` recursion fix also left orphan `*.lock` sockets needing manual cleanup. There is no command to clean any of this up.
2. **Consequence if not fixed**: Sockets and dead daemon processes keep accumulating. The existing runtime filters and supervisor hide the noise from the UI but never reclaim the resources, so disk and process-table clutter grows unbounded across test/crash cycles.
3. **Why this approach**: This is explicitly a **janitor of last resort** — a blunt, manual cleanup. Ideally the leak source is fixed upstream and this command withers away, but the leaks exist *today*, so an operator-invoked cleanup is needed now. Making it standalone (not startup behavior) keeps the race-safe startup sweep untouched and puts the destructive action behind an explicit human invocation. Root-cause work (WHY test sockets leak — cleanup races, daemonized servers reparenting to init) is **out of scope** and tracked as a separate backlog item.

## What Changes

### 1. New top-level cobra command `rk reaper`

A standalone sibling of `rk serve` — **not** nested under `rk daemon` or `rk serve`. This is a deliberate decision: the command is operator-invoked, not startup behavior. Registered in `app/backend/cmd/rk/root.go` (`rootCmd.AddCommand(reaperCmd)`), implemented in a new file `app/backend/cmd/rk/reaper.go`. The command is thin — scanning/probing/reaping logic lives in `internal/tmux`.

### 2. NOT wired into `rk serve` startup

The existing race-safe `sweepOrphanedRelaySessions`-at-startup behavior stays exactly as-is and untouched. `rk reaper` is a separate, blunt, manual cleanup. The startup path in `app/backend/cmd/rk/serve.go` MUST NOT be modified.

### 3. Reaps both leak shapes plus `.lock` sockets in `/tmp/tmux-{uid}/`

The reaper iterates the **raw** socket-directory entries (the candidate-collection loop pattern at `tmux.go:1045-1058`), **not** `ListServers`. This is critical: `ListServers` (`tmux.go:1035`) only returns sockets it can successfully probe, so it silently **drops dead sockets** — exactly the shape (b) we need to reap. The reaper probes each candidate to distinguish the three cases:

- **(a) Live orphan test servers** — socket probe OK (daemon alive), name matches `tmux.IsGoTestServerName` → kill via `tmux.KillServer(name)`.
- **(b) Dead test sockets** — socket file present on disk, name matches `IsGoTestServerName`, but the daemon already exited so the probe fails → remove the socket file via `os.Remove`.
- **(c) `.lock` sockets** — sweep stale `*.lock` socket files in the same dir (subsumes the PR #199 one-time manual cleanup). `.lock` files do not carry a test prefix, so they get their own explicit `strings.HasSuffix(name, ".lock")` branch.

The dir-scan / socket-mode candidate collection at `tmux.go:1045-1058` SHALL be factored out of `ListServers` into a shared exported helper that both `ListServers` and the reaper call, so the `/tmp/tmux-{uid}` convention and socket-mode/dir checks live in exactly one place.
<!-- clarified: extract shared dir-scan helper (not duplicate) — code-quality doc flags duplicated utilities; single source for the socket-dir convention -->

The scan/classify/reap logic SHALL live in `internal/tmux` behind a **single** exported reaper helper (e.g. `ReapTestServers(ctx, dryRun) -> (result, error)` returning the killed/removed names plus collected per-entry errors), with `reaper.go` staying a thin cobra command that only parses flags and renders the summary. This matches Constitution §III (logic in `internal/`, thin command) and the partial-failure result shape of `sweepOrphanedRelaySessions`. The exact function name/signature is finalized at the plan stage.
<!-- clarified: one Reap* helper in internal/tmux, thin reaper.go — §III thin-command; mirrors serve_sweep result shape -->


### 4. Always safe to reap — no liveness gate

No PID-liveness gate, no per-prefix exceptions, no parsing of `rk-test-<pid>-<ns>` for a `kill(pid, 0)` check. Because `rk reaper` is operator-invoked, the human running it asserts "nothing live needs these." All five test-server prefixes — including the fixed-name `rk-tmuxctl-test` and `rk-daemon-test` — reap unconditionally, and `.lock` files reap unconditionally.

### 5. Hard exclusions

- **`rk-e2e-*` sockets MUST NEVER be reaped** — they may be live during a Playwright e2e run. `tmux.IsGoTestServerName` (`tmux.go:1016`) already excludes `rk-e2e-*` (the 5 matched prefixes are `rk-test-`, `rk-relay-test-`, `rk-verify-`, `rk-tmuxctl-test`, `rk-daemon-test`; see the comment at `tmux.go:1009` confirming e2e is deliberately not filtered). So matching on `IsGoTestServerName` yields the correct set for free.
- The `_rk-ctl` control anchor (`tmux.ControlAnchorSessionName`) and any live non-test servers MUST be excluded (defense-in-depth, mirroring the existing sweep's anchor guard at `serve_sweep.go:45`).

### 6. `IsGoTestServerName` as single source of truth

Reuse `tmux.IsGoTestServerName` as the **single** source of truth for "is this a test server" — do **not** re-list the prefixes inside the reaper.

### 7. UX: default reap + summary, `--dry-run` flag

- **Default**: reaps and prints a summary — count + names of what was killed (live servers) and what was removed (dead sockets + lock files).
- **`--dry-run`**: lists candidates without touching anything, so the operator can preview before destruction.

### 8. Partial-failure contract

Per-entry failures are logged (via `slog`) and skipped — a single kill/remove failure MUST NEVER abort the sweep. This mirrors the partial-failure contract of `sweepOrphanedRelaySessions` (`serve_sweep.go:28-62`): collect per-entry errors, continue, optionally surface an aggregate error at the end.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document the `rk reaper` operator command — the two leak shapes (live test servers vs. dead sockets), `.lock` socket cleanup, the `rk-e2e-*` / control-anchor exclusions, and how it relates to (but does not replace) the startup `sweepOrphanedRelaySessions`.

## Impact

- **New file**: `app/backend/cmd/rk/reaper.go` — thin cobra command (`reaperCmd`) with `--dry-run` flag; delegates to `internal/tmux`.
- **Modified**: `app/backend/cmd/rk/root.go` — register `reaperCmd` via `rootCmd.AddCommand`.
- **Modified**: `app/backend/internal/tmux/tmux.go` — likely a new exported reaper/scan helper (e.g. raw socket-dir candidate scan + the reap routine), and possibly factoring the existing dir-scan loop (`tmux.go:1045-1058`) out of `ListServers` for reuse. Reuses `IsGoTestServerName` (`:1016`), `KillServer` (`:1108`), `ControlAnchorSessionName`.
- **Reference only (not modified)**: `app/backend/cmd/rk/serve_sweep.go` (partial-failure pattern), `app/backend/cmd/rk/serve.go` (startup path — do NOT touch), `app/backend/api/servers.go` and `app/backend/internal/tmuxctl/supervisor.go` (existing `IsGoTestServerName` consumers — runtime filters, for context).
- **Tests**: new Go test coverage for the reaper scan/classify/reap logic (`*_test.go` alongside the code, per project test strategy).
- **Constitution**: §I Security First (subprocess via `exec.CommandContext` — already the case in `internal/tmux`), §II No Database (derives candidates from the socket dir at invocation time — no new persistent state), §III Wrap, Don't Reinvent (reuses existing `internal/tmux` helpers, thin command).

## Open Questions

- None blocking. The design conversation resolved scope, placement, the no-PID-gate decision, exclusions, and UX. A `/fab-clarify` session (2026-05-29) further resolved the two former implementation-detail Tentatives: (1) the `ListServers` dir-scan is **extracted** into a shared helper (not duplicated), and (2) the reap logic lives behind a **single** `internal/tmux` reaper helper with a thin `reaper.go`. Only the exact helper name/signature remains a plan-stage detail.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `chore` (new operator/maintenance command, low blast radius) | Stated explicitly in the resolved design; matches `chore` keyword taxonomy | S:98 R:80 A:95 D:95 |
| 2 | Certain | `rk reaper` is a standalone top-level cobra command, NOT nested under `serve`/`daemon` and NOT wired into startup | Explicit deliberate decision in the design conversation; registration pattern in `root.go` is unambiguous | S:98 R:70 A:95 D:95 |
| 3 | Certain | Must iterate raw socket-dir entries (pattern at `tmux.go:1045-1058`), not `ListServers`, because `ListServers` drops dead sockets | Verified in source: `ListServers` only appends probe-success sockets (`tmux.go:1066-1082`) | S:95 R:60 A:98 D:95 |
| 4 | Certain | `IsGoTestServerName` is the single source of truth for test-server matching and already excludes `rk-e2e-*` | Verified in source (`tmux.go:1016-1030`); the 5 prefixes exclude e2e by construction | S:98 R:75 A:98 D:98 |
| 5 | Certain | No PID-liveness gate / no `kill(pid,0)` parsing — all matched test servers and `.lock` files reap unconditionally | Design conversation explicitly overrode the backlog's PID-gate suggestion (it was for a startup design) | S:95 R:55 A:90 D:90 |
| 6 | Certain | Partial-failure contract: log-and-skip per entry, never abort the sweep | Explicit in description; mirrors `sweepOrphanedRelaySessions` (`serve_sweep.go:28-62`) | S:95 R:80 A:95 D:90 |
| 7 | Certain | Three reap branches: live test server → `KillServer`; dead test socket → `os.Remove`; `*.lock` → `os.Remove` via explicit `HasSuffix` branch | Clarified — user confirmed | S:95 R:55 A:85 D:80 |
| 8 | Certain | UX: default reaps + prints count/names summary; `--dry-run` previews candidates without touching anything | Clarified — user confirmed | S:95 R:80 A:85 D:85 |
| 9 | Certain | Exclude `_rk-ctl` control anchor and live non-test servers (defense-in-depth) | Clarified — user confirmed | S:95 R:75 A:90 D:85 |
| 10 | Certain | Affected memory is `run-kit/tmux-sessions` (modify) | Clarified — user confirmed | S:95 R:80 A:85 D:80 |
| 11 | Certain | Factor the socket-dir candidate scan out of `ListServers` into a shared exported helper (not duplicated) | Clarified — user confirmed: single source for the `/tmp/tmux-{uid}` convention, avoids the duplicated-utility smell the code-quality doc warns against | S:95 R:60 A:65 D:55 |
| 12 | Certain | Reap logic lives behind a single exported `internal/tmux` reaper helper (e.g. `ReapTestServers(ctx, dryRun)`); `reaper.go` stays thin; exact name/signature finalized at plan stage | Clarified — user confirmed: §III thin-command, mirrors `sweepOrphanedRelaySessions` partial-failure result shape | S:95 R:55 A:75 D:60 |

## Clarifications

### Session 2026-05-29

| # | Action | Detail |
|---|--------|--------|
| 11 | Resolved | Extract shared dir-scan helper from `ListServers` (not duplicate) |
| 12 | Resolved | Single `Reap*` helper in `internal/tmux`; thin `reaper.go` |

### Session 2026-05-29 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 9 | Confirmed | — |
| 10 | Confirmed | — |

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).
