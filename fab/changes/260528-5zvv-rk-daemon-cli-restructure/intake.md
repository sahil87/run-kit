# Intake: rk daemon CLI Restructure

**Change**: 260528-5zvv-rk-daemon-cli-restructure
**Created**: 2026-05-28
**Status**: Draft

## Origin

> Restructure daemon lifecycle into a top-level `rk daemon` command tree (`start`/`stop`/`restart`/`status` with `--force` semantics), hard-removing the `rk serve -d`/`--restart`/`--stop` flags. Follow-up to PR #197 which fixed the underlying detection split-brain but kept the flag-on-serve shape.

### Context for the next agent

This change was scoped out of [PR #197](https://github.com/sahil87/run-kit/pull/197) (merged 2026-05-28 as `270c6fc`, change folder `fab/changes/260527-901h-deterministic-daemon-lifecycle/`). That PR fixed three real bugs in the daemon lifecycle (port-based liveness detection, stale-socket reaping, daemon startup logging via `RK_DAEMON_LOG`) but kept the existing flag-on-serve CLI shape (`rk serve -d`, `--restart`, `--stop`).

Post-merge discussion flagged two related but explicitly out-of-scope items in the previous spec:

1. **`--force` semantics on stop/restart** (`rk serve --stop --force` to SIGTERM a foreground port owner) — recorded as Non-Goal in #197's spec, with the recommended deferral being a separate change.
2. **Non-destructive port-owner reporting in `--stop`** — a "stop the daemon AND additionally report PID X holds the port" enhancement floated during discussion but not specced.

In addressing those, the deeper question surfaced: should daemon lifecycle commands be **flags on `serve`** at all, or **a sub-command tree**? Discussion converged on a sub-command tree, specifically `rk daemon {start, stop, restart, status}` as a **top-level sibling of `rk serve`** (not nested under serve). User chose **hard break** — no `-d`/`--restart`/`--stop` forwarders or deprecation period.

### Decisions made in pre-intake conversation (treat as Certain)

1. **Command structure**: `rk daemon` as a top-level sibling of `rk serve`. Sub-commands: `start`, `stop`, `restart`, `status`. NOT nested under `rk serve` (i.e., not `rk serve daemon`).
2. **Hard break on the old flags**: `rk serve -d`, `rk serve --restart`, `rk serve --stop` are REMOVED. No deprecation period, no forwarder. `rk serve` becomes foreground-only (and is the project's first command to lose flags it once had).
3. **`--force` lives on `stop`, `restart`, `start`** with these semantics:
   - **`rk daemon stop --force`**: if no daemon is running but the port is held by another process, locate and SIGTERM the port owner. Without `--force`: stop the daemon only.
   - **`rk daemon restart --force`**: if the port is held by a non-daemon process during the restart sequence, SIGTERM it before starting the new daemon. Without `--force`: existing semantics (stop daemon → start daemon).
   - **`rk daemon start --force`**: if the port is held by a non-daemon process, SIGTERM it before starting the daemon. Without `--force`: today's port-probe refusal (from PR #197) stands.
   - **Rationale**: `--force` is consistently "override the safety check that prevents claiming the port from a non-rk-daemon owner." On `stop`, the safety is "I only stop things I started." On `start`/`restart`, the safety is the port-probe refusal added in #197.
4. **`rk daemon status` is read-only**: no side effects. Reports daemon state (running / not running, session name, tmux target) AND port owner (PID, command, foreground-vs-daemon disambiguation). This is the *new* home for the "non-destructive port-owner report" floated during the #197 discussion — `stop` no longer mixes report-and-act.
5. **Port-owner lookup mechanism**: **`lsof -ti:<port>` with an `ss -tlnp` fallback.** Both run through `exec.CommandContext` per Constitution §I. `lsof` is universal on macOS, common on Linux; `ss` is the Linux-native safety net. Pure-Go `/proc/net/tcp` parsing rejected as Linux-only and verbose. (Locked in pre-intake; revisit if either binary is missing on the deployment target.)

### Naming collision to be aware of

`rk status` already exists as a subcommand (see `app/backend/cmd/rk/status.go` and `root.go:38`) — it summarises tmux sessions/windows on the `runkit` server. The new `rk daemon status` is a sibling-namespaced command (`rk daemon status` vs `rk status`), so cobra disambiguation is clean, but a future user typing `rk status` expecting daemon info will land on the session summary. Worth a one-line note in `rk daemon status --help` AND in the change's hydrate-stage memory update.

## Why

1. **Problem**:
   - The current flag-on-`serve` shape forces a runtime mutual-exclusivity check between `-d`, `--restart`, `--stop` (see `serve.go:50-52` in PR #197's post-merge state). That check is a code smell — three flags that cannot co-exist almost always want to be sub-commands.
   - `--force` semantics differ per flag: meaningful on `--stop`/`--restart`, *forbidden* on `-d` (you can't override a port collision — the daemon physically cannot bind a held port). Documenting "this flag is valid on these two flags but not that third one" in flat help text is awkward; cobra sub-command help solves it for free.
   - `--stop` currently *only* stops the daemon. The "is rk actually serving, and who's holding the port" question — which is *the* question that started the original PR #197 investigation — has no good home. `rk daemon status` is that home.
   - The existing public daemon helpers (`daemon.Start`, `daemon.StartWithBinary`, `daemon.Restart`, `daemon.RestartWithBinary`, `daemon.Stop`, `daemon.IsRunning`) cleanly map to the new sub-commands. The Go API is already organised the right way — the CLI surface has been the laggard.
2. **Consequence if unfixed**:
   - Each future daemon-lifecycle flag (`--timeout`, `--no-graceful`, `--json` output, future `--force`) compounds the combinatorial flag check on `serve`. Sub-commands attach flags to one verb cleanly.
   - The "stop the port owner" / "kill the foreground holder" question keeps re-surfacing because there's no clean place to put it; specifying it as `--stop --force` glues two opposing semantics onto one flag.
   - Operators today have no way to ask "is the daemon up and who has my port" without compounding `rk serve --stop` (destructive) with `ss -tlnp` (manual). That gap defeats the determinism win of PR #197.
3. **Why this approach over alternatives**:
   - **`rk daemon` sibling vs `rk serve daemon` nested**: The mental model is that `serve` is "run this HTTP process here" and `daemon` is "manage the background lifecycle of an `rk serve` instance" — two concepts that share a target binary but not a job description. `systemctl` / `launchctl` / `kubectl pod` precedent.
   - **Hard break vs deprecation forwarders**: User chose hard break. Rationale: the daemon flag surface has only ever been documented to project insiders; there is no public script-level contract to preserve; pre-1.0 (or however the project versions) is the cheap-break window; deprecation forwarders carry permanent help-text noise.
   - **`--force` over a separate `--include-port-owner` flag**: `--force` is a noun-verb pattern operators already know ("override the safety check"). A bespoke flag would be more self-documenting but uglier in help output and harder to extend if a second safety check is ever added.

## What Changes

### 1. New top-level command tree: `rk daemon`

Add a new top-level cobra command in `app/backend/cmd/rk/`, registered alongside `serve`, `update`, `doctor`, `status`, `init-conf`, `context`, `riff`, `shell-init` in `root.go:32-42`.

Proposed file layout (mirroring the one-file-per-subcommand convention):

```
app/backend/cmd/rk/
  daemon.go              # var daemonCmd — parent + AddCommand for the 4 children
  daemon_start.go        # daemonStartCmd
  daemon_stop.go         # daemonStopCmd
  daemon_restart.go      # daemonRestartCmd
  daemon_status.go       # daemonStatusCmd
  daemon_portowner.go    # shared helper: lookup port owner via lsof/ss
  daemon_test.go         # CLI-surface integration tests
```

> [NEEDS CLARIFICATION: single-file `daemon.go` containing all four subcommands, or four files? The serve.go precedent is one-file-per-subcommand; this is the project's first multi-child subcommand, so it's a fresh precedent either way. Recommend four files for testability and to keep each focused — but a single file is defensible given the small surface area.]

`daemonCmd` registration (in `daemon.go`):

```go
var daemonCmd = &cobra.Command{
    Use:   "daemon",
    Short: "Manage the background rk daemon (tmux-managed rk serve)",
    Long: `Manage the background rk daemon — an rk serve instance running in a
dedicated rk-daemon tmux session. The daemon survives shell exits and SSH
disconnects; the foreground rk serve does not.

Subcommands:
  start    Start the daemon
  stop     Stop the daemon (and optionally reclaim the port)
  restart  Stop and start the daemon
  status   Show daemon state and current port owner

See 'rk daemon <subcommand> --help' for flags on each.`,
}

func init() {
    daemonCmd.AddCommand(daemonStartCmd)
    daemonCmd.AddCommand(daemonStopCmd)
    daemonCmd.AddCommand(daemonRestartCmd)
    daemonCmd.AddCommand(daemonStatusCmd)
}
```

And in `root.go:init`:

```go
rootCmd.AddCommand(daemonCmd)
```

### 2. `rk daemon start [--force]`

Behaviour:

- **Without `--force`**: equivalent to today's `rk serve -d`. Calls `daemon.Start()`. The PR #197 port-probe refusal applies — if the port is held, returns the "already serving on …" error with the substrings `already serving on`, `not under the rk-daemon`, `RK_PORT` and exits non-zero.
- **With `--force`**: if `daemon.Start()` returns the port-in-use error, locate the port owner via the `lsof`→`ss` fallback, SIGTERM it, poll up to 5 s for it to exit, then retry `daemon.Start()`. If the holder turns out to be a live `rk-daemon` (we shouldn't reach this — `IsRunning()` would have already short-circuited — but defensively check), do NOT kill it; surface "daemon already running, refusing to --force-kill self" and exit non-zero.

Pseudo-code for `daemonStartCmd.RunE`:

```go
force, _ := cmd.Flags().GetBool("force")
err := daemon.Start()
if err == nil {
    fmt.Printf("rk daemon started (%s/%s/%s)\n", daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
    return nil
}
if !force || !errorIsPortInUse(err) {
    return err
}
// --force path
owner, lookupErr := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
if lookupErr != nil {
    return fmt.Errorf("port held but owner lookup failed: %w (original: %v)", lookupErr, err)
}
if owner.isOurDaemon() {
    return fmt.Errorf("daemon already running on port; refusing to --force-kill self")
}
if killErr := terminateOwner(cmd.Context(), owner); killErr != nil {
    return fmt.Errorf("--force kill of PID %d (%s) failed: %w", owner.PID, owner.Command, killErr)
}
fmt.Printf("Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)
return daemon.Start()
```

### 3. `rk daemon stop [--force]`

Behaviour:

- **Without `--force`**: equivalent to today's `rk serve --stop`. Calls `daemon.Stop()` (which is itself a no-op when the daemon isn't running, just prints "rk daemon not running" — see `serve.go:117-122` in the current main).
- **With `--force`**:
  - If the daemon IS running, `daemon.Stop()` it first (graceful C-c → 5 s poll → SIGKILL fallback, all already implemented).
  - THEN, regardless of whether a daemon was running, probe the port. If it's still held by a process, locate via `lsof`/`ss`, SIGTERM, poll for exit. The "regardless of whether a daemon was running" matters: the user said `--force`, so they want the port free at exit.

Pseudo-code:

```go
force, _ := cmd.Flags().GetBool("force")
wasRunning := daemon.IsRunning()
if wasRunning {
    if err := daemon.Stop(); err != nil {
        return fmt.Errorf("stopping daemon: %w", err)
    }
    fmt.Println("rk daemon stopped")
}
if !force {
    if !wasRunning {
        fmt.Println("rk daemon not running")
    }
    return nil
}
// --force: ensure port is actually free
owner, _ := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
if owner == nil {
    return nil // port already free, --force was a no-op for the "extra" kill
}
if owner.isOurDaemon() {
    // shouldn't happen — daemon.Stop() should have torn it down — but be defensive
    return fmt.Errorf("port still held by what appears to be our daemon (PID %d); manual investigation needed", owner.PID)
}
if err := terminateOwner(cmd.Context(), owner); err != nil {
    return err
}
fmt.Printf("Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)
return nil
```

### 4. `rk daemon restart [--force]`

Behaviour:

- **Without `--force`**: equivalent to today's `rk serve --restart`. `daemon.Restart()` semantics (stop existing daemon → start new daemon). If the port is held by a *non-daemon* process, the start half will hit PR #197's port-probe refusal and surface the error.
- **With `--force`**: stop the daemon if running, then proactively check the port. If it's held by a non-daemon process, SIGTERM it. Then start the new daemon.

Pseudo-code:

```go
force, _ := cmd.Flags().GetBool("force")
if daemon.IsRunning() {
    fmt.Println("Restarting rk daemon...")
    if err := daemon.Stop(); err != nil {
        return fmt.Errorf("stopping daemon: %w", err)
    }
}
if force {
    // Same port-clear logic as stop --force, before starting
    owner, _ := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
    if owner != nil && !owner.isOurDaemon() {
        if err := terminateOwner(cmd.Context(), owner); err != nil {
            return fmt.Errorf("--force kill of port owner failed: %w", err)
        }
        fmt.Printf("Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)
    }
}
if err := daemon.Start(); err != nil {
    return fmt.Errorf("starting daemon: %w", err)
}
fmt.Printf("rk daemon started (%s/%s/%s)\n", daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
return nil
```

### 5. `rk daemon status` (read-only)

Behaviour: report daemon state AND port owner, with no side effects. This is the **new** home for the "non-destructive port-owner report" floated in the PR #197 discussion.

Output shape (example, when daemon is running):

```
Daemon:    running
  Socket:  rk-daemon
  Session: rk-daemon (window: serve)
  Target:  =rk-daemon:=serve

Port:      127.0.0.1:3000 — held by the rk daemon (PID 12345)
```

When daemon is NOT running but port is held by another process:

```
Daemon:    not running
  Socket:  rk-daemon (no live session)

Port:      127.0.0.1:3000 — held by PID 121792 (rk serve, foreground)
           To reclaim: `rk daemon stop --force` or `kill 121792`
```

When daemon is not running and port is free:

```
Daemon:    not running

Port:      127.0.0.1:3000 — free
```

Implementation: combine `daemon.IsRunning()` (already exists) with `findPortOwner(host, port)`. The "is this PID our daemon" check requires walking up from the PID to see if its session/tty matches the rk-daemon tmux server — see Open Questions #1. A simpler heuristic: compare the holder's PID against the PID of `tmux -L rk-daemon display-message -p '#{pid}'`-equivalent (the inner serve's PID, queryable via tmux's `pane_pid` format spec).

> [NEEDS CLARIFICATION: exact "is this PID our daemon" check. Options: (a) `tmux -L rk-daemon list-panes -t =rk-daemon:=serve -F '#{pane_pid}'` and compare; (b) walk `/proc/<pid>/status` to find Pgrp/Sid and match against tmux; (c) skip the check and just label the holder by command name. Recommend (a) — single tmux query, deterministic, already inside our abstraction.]

JSON output: `rk daemon status --json` emits a structured form for scripting. This is a small addition and earns its keep immediately (CI scripts, monitoring).

> [NEEDS CLARIFICATION: include `--json` in the initial scope, or defer? Recommend include — adds <30 lines and removes a future round-trip.]

### 6. Removal of `rk serve -d`/`--restart`/`--stop`

Delete the three boolean flags from `serveCmd.Flags()` (post-#197 they live at `serve.go:192-194`). Delete the dispatch switch (`serve.go:74-128`) — the `RunE` body collapses to "load config, ensure tmux config, sweep relay ephemerals, set up slog, listen and serve."

Hard-break is intentional. After this change, `rk serve -d` errors with cobra's standard "unknown flag" message. The change's release notes (and the architecture memory) must call this out.

### 7. Port-owner lookup helper (`daemon_portowner.go`)

A small, focused helper shared across the four subcommands. Sketch:

```go
package main

import (
    "context"
    "fmt"
    "os/exec"
    "strconv"
    "strings"
    "time"
)

type PortOwner struct {
    PID     int
    Command string  // basename of the executable (e.g., "rk", "node")
    Source  string  // "lsof" or "ss" — diagnostic, not load-bearing
}

// findPortOwner queries who is listening on host:port, preferring lsof and
// falling back to ss. Returns nil on no holder; error only on hard lookup
// failure (both lsof and ss unavailable, or both errored).
func findPortOwner(ctx context.Context, host string, port int) (*PortOwner, error) {
    if owner, err := findPortOwnerLsof(ctx, port); err == nil {
        return owner, nil
    }
    return findPortOwnerSS(ctx, port)
}

// findPortOwnerLsof: `lsof -ti:<port>` → newline-separated PIDs.
// Cross-references PID → basename via /proc/<pid>/comm (Linux) or
// `ps -p <pid> -o comm=` (macOS).

// findPortOwnerSS: `ss -tlnp '( sport = :<port> )'` → parse "users:(...,pid=N,...)"

// terminateOwner: SIGTERM, poll 5s for exit, SIGKILL fallback.
// Mirrors the daemon.Stop() approach for symmetry.
```

All exec calls go through `exec.CommandContext` with a 5s timeout (Constitution §I). No shell-string construction. Input is fully internal (the port number we already validated and the holder's PID returned by the tool itself) — no user-controlled args flow through.

> [NEEDS CLARIFICATION: should the host argument influence the lookup? `lsof -ti:3000` returns *any* TCP listener on port 3000 regardless of bind interface. For `RK_HOST=127.0.0.1` this is correct (the loopback listener is the one we'd collide with); for `RK_HOST=0.0.0.0` this is also correct (same listener). The host arg is only used for the diagnostic display string — recommend pass-through to display, ignore for lookup.]

### 8. Refactor: `daemon.IsRunning()` and friends are sufficient — no daemon-package changes expected

The Go API in `internal/daemon` already exposes everything needed: `IsRunning()`, `Start()`, `Stop()`, `Restart()`, `StartWithBinary()`, `RestartWithBinary()`, plus the constants `ServerSocket`, `SessionName`, `WindowName`, `LogEnvVar`. The new `cmd/rk/daemon*.go` files are pure CLI-surface code that orchestrates these.

`internal/daemon` exports may need ONE addition: a `Target()` or `PaneInfo()` helper that returns the inner serve's PID for `rk daemon status`'s "is the port holder our daemon" check (see open question above). Single function, small.

### 9. `cmd/rk/upgrade.go` integration (unchanged)

`upgrade.go:99-104` currently calls `daemon.RestartWithBinary(brewBinPath)` directly. This is the brew-upgrade flow; it does NOT go through the CLI layer. **No changes needed** — the new `rk daemon` CLI is purely additive in the cobra surface; the Go API the upgrade flow uses is untouched.

### Out of scope (explicitly)

- **JSON output for `start`/`stop`/`restart`** — `--json` is added to `status` only (where it earns its keep). The mutating commands stay human-text.
- **A `rk daemon logs` subcommand that tails `~/.cache/rk/daemon.log`** — defer. The log is already greppable; a CLI tail is a nice-to-have, not a determinism fix.
- **Replacing or extending the `rk status` subcommand** — `rk status` continues to summarise tmux sessions. The naming-collision risk is documented; not relit.
- **Cross-platform port-owner lookup for Windows** — the project is Linux/macOS only today (`runtime.GOOS` checks would be needed otherwise). If the project ever targets Windows, the `lsof`/`ss` chain needs a third fallback; not now.

## Affected Memory

- `run-kit/architecture`: (modify) `## Daemon Lifecycle` section. Update the CLI surface inventory (the bullets listing `rk serve -d` / `--restart` / `--stop` become `rk daemon start` / `stop` / `restart` / `status`). Document `--force` semantics across the three mutating subcommands. Add a brief subsection on the port-owner lookup mechanism (`lsof` → `ss` fallback) and where the helper lives.
- `run-kit/architecture`: (modify) `internal/daemon` row in the Backend Libraries table — if a `Target()`/`PaneInfo()` helper is added to expose the inner serve's PID, document it. Otherwise no change to this row.
- `run-kit/ui-patterns`: (no change) — this is CLI ergonomics, not UI patterns. Check during hydrate; revise this Affected Memory entry if the agent finds otherwise.

## Impact

- **`app/backend/cmd/rk/`**:
  - **New files**: `daemon.go`, `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, `daemon_portowner.go`, and corresponding `_test.go` files. (Or fewer files if consolidated — see clarification.)
  - **Modified**: `root.go` (add one `rootCmd.AddCommand(daemonCmd)` line). `serve.go` (delete the three daemon flags from `init()`, delete the dispatch switch from `RunE`).
- **`app/backend/internal/daemon/`**: probably zero changes. Possibly add one `Target() *PaneInfo` or similar helper for `rk daemon status`'s holder-identity check; bounded to ~20 lines.
- **`docs/memory/run-kit/architecture.md`**: `## Daemon Lifecycle` section updates per Affected Memory. Hydrate-stage work.
- **Tests**:
  - **New**: CLI-surface tests for each of the four subcommands. Cobra's `RootCmd.SetArgs()` + capture stdout/stderr pattern. Mock the port-owner lookup (inject a function variable) so tests don't actually spawn `lsof`.
  - **New**: Integration tests for the port-owner helper, gated on `lsof` availability (skip with t.Skip if not on PATH).
  - **Modified**: Any existing tests that exercise `rk serve -d`/`--restart`/`--stop` go away with the flags.
- **Constitution touchpoints**:
  - **§I** (Security First): the `lsof`/`ss` invocations all go through `exec.CommandContext` with 5 s timeouts; the only input flowing in is the port number (project-validated, integer-typed) and the holder's own PID (from the tool's output, not user input). SIGTERM uses `syscall.Kill(pid, syscall.SIGTERM)` — no shell.
  - **§II** (No Database): no persistent state added; all derivations at request time.
  - **§III** (Wrap, Don't Reinvent): re-uses `daemon.Start`/`Stop`/`Restart`/`IsRunning` unchanged.
  - **§IV** (Minimal Surface Area): adds one top-level command. Reasoned about: this is consolidation (three flags removed, one command added with four children), not surface-area sprawl.
  - **§V** (Keyboard-First): N/A — CLI.
  - **§VI** (Tmux Sessions Survive Server Restarts): nothing in this change touches the agent-session `runkit` server. The `--force` SIGTERM is scoped to the port owner (which by definition is bound to the daemon's port, not an agent session).
  - **§VII** (Convention Over Configuration): the `rk daemon status` output is conventional terminal text; `--json` is opt-in.
  - **§VIII** (Thin Justfile): no justfile changes expected.

## Open Questions

- **File structure**: single `daemon.go` containing all four subcommand vars, or one file per subcommand (`daemon.go` + `daemon_start.go` + …)? Recommend the multi-file form for parity with how a future agent reading `cmd/rk/` would expect things.
- **`rk daemon status` JSON output**: include `--json` in initial scope or defer? Recommend include — small, valuable, easier to do now than to retrofit when a CI script wants it.
- **Holder-identity check for `rk daemon status`**: tmux pane-pid query vs `/proc` walking vs no-check? Recommend the tmux pane-pid approach via a new small `daemon.InnerServePID() (int, error)` helper.
- **Port-owner lookup host argument**: pass through to display only, ignore for lookup? (i.e., `lsof -ti:3000` covers any bind interface.) Recommend yes — the held port is the held port, the bind interface is just diagnostic.
- **`rk daemon start --force`**: should it ALWAYS first probe the port and kill any holder, or only when `daemon.Start()` returns the port-in-use error? Recommend on-error — keeps the happy path identical to non-forced.
- **Help-text mention of `rk status`**: should `rk daemon status --help` actively warn "not to be confused with `rk status` (session summary)"? Recommend yes — one-line note in the Long description.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `refactor` | Restructures the CLI surface — moves existing functionality from flags to subcommands, adds `--force` semantics. Not strictly bug fix (no defect being patched); not pure feature (no net-new daemon capabilities — port-owner reporting was the deferred slice of #197). `refactor` is the closest fit. | S:80 R:80 A:85 D:75 |
| 2 | Certain | `rk daemon` is a top-level sibling of `rk serve`, not nested under it | User explicitly chose this in pre-intake discussion | S:95 R:75 A:95 D:90 |
| 3 | Certain | Hard break: `rk serve -d/--restart/--stop` are REMOVED, no deprecation forwarders | User explicitly chose this in pre-intake discussion | S:95 R:50 A:90 D:90 |
| 4 | Certain | `--force` lives on `start`, `stop`, `restart` (NOT on `status` which is read-only) | Discussed and agreed — `--force` semantics are "override the port-claim safety check"; status has no safety check to override | S:90 R:75 A:90 D:85 |
| 5 | Certain | `--force` semantics: override the port-probe / non-self-stop safety check by SIGTERMing the port owner (with poll-for-exit + SIGKILL fallback mirroring `daemon.Stop`) | Discussed; mirrors existing `daemon.Stop` graceful-then-forceful pattern | S:90 R:70 A:85 D:80 |
| 6 | Certain | Port-owner lookup: `lsof -ti:<port>` primary, `ss -tlnp` fallback, both via `exec.CommandContext` | User-approved in pre-intake discussion | S:90 R:75 A:85 D:80 |
| 7 | Certain | `rk daemon status` is read-only and includes the port-owner report (which was floated for `--stop` in #197 but ultimately landed here) | Discussed in pre-intake; cleaner verb semantics | S:90 R:85 A:90 D:85 |
| 8 | Certain | Existing `rk status` subcommand stays — naming collision is documented but not resolved | The collision is mild (sibling-namespaced); resolving it (e.g., renaming `rk status` → `rk sessions status`) is a separate change | S:85 R:75 A:80 D:80 |
| 9 | Certain | No changes to `internal/daemon`'s public API except possibly one small helper (`InnerServePID()` for holder-identity check) | Existing `Start`/`Stop`/`Restart`/`IsRunning` cleanly map to subcommands; the helper is the only new thing | S:80 R:80 A:80 D:75 |
| 10 | Certain | `upgrade.go` flow (brew-upgrade auto-restart via `RestartWithBinary`) is unaffected — operates at the Go API layer, not the CLI | Verified by reading `upgrade.go:99-104`; no CLI dispatch involved | S:90 R:90 A:95 D:90 |
| 11 | Confident | Sub-command tests use cobra's `RootCmd.SetArgs()` + stdout/stderr capture pattern, with the port-owner lookup function injected via a package-level var override (test pattern already used in `daemon_test.go` for `serverSocket`) | Mirrors existing test patterns in `internal/daemon/daemon_test.go` (the `serverSocket` override) and is standard cobra-testing practice | S:75 R:80 A:80 D:75 |
| 12 | Confident | Four separate files (`daemon.go`, `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, plus `daemon_portowner.go` helper) — parity with one-file-per-subcommand convention in the rest of `cmd/rk/` | Existing pattern in `cmd/rk/`: `serve.go`, `doctor.go`, `status.go`, `initconf.go`, etc. are each one subcommand per file | S:70 R:85 A:80 D:70 |
| 13 | Confident | `--json` output for `rk daemon status` is included in initial scope (not deferred) | Small additional cost (~30 lines), removes future round-trip | S:70 R:85 A:75 D:65 |
| 14 | Confident | Holder-identity check uses tmux's `pane_pid` format spec via a small `daemon.InnerServePID()` helper (option (a) from open questions) | Stays inside the `internal/tmux/`-rooted abstraction (code-quality rule); single deterministic tmux query | S:70 R:75 A:80 D:70 |
| 15 | Confident | Port-owner lookup ignores the host argument (uses port only) — host is diagnostic in display, not part of the query | A held port is held regardless of bind interface; `lsof -ti:3000` and `ss -tlnp '( sport = :3000 )'` both correctly cover loopback + wildcard binds | S:75 R:80 A:80 D:75 |
| 16 | Confident | `rk daemon start --force` only kicks in when the non-forced path returns the port-in-use error (lazy / on-error) — not a proactive port-clear on every `--force` invocation | Keeps happy path identical; avoids the "I forced when I didn't need to" surprise | S:70 R:80 A:75 D:70 |
| 17 | Confident | `rk daemon status --help` includes a one-line note distinguishing it from `rk status` (session summary) | Mitigates the naming collision flagged in this intake | S:75 R:90 A:85 D:80 |
| 18 | Confident | Constitution §I-VIII review: this change touches only §I (subprocess hygiene for lsof/ss/kill — all `exec.CommandContext`-bounded), §III (re-uses existing daemon helpers), and §IV (consolidates flags into subcommands — net surface reduction at the flag level) | Reasoned through each principle inline above; none violated | S:80 R:75 A:90 D:80 |
| 19 | Confident | Out-of-scope items: `rk daemon logs` (tail of daemon log), Windows-platform port-owner lookup, replacing `rk status` itself, JSON output for mutating commands | All deferred deliberately; each warrants its own intake | S:75 R:75 A:80 D:70 |

19 assumptions (10 certain, 9 confident, 0 tentative, 0 unresolved).
