# Intake: Stable rk path for daemon-spawned processes

**Change**: 260910-4t9b-stable-rk-path-daemon-spawns
**Created**: 2026-09-11

## Origin

Promptless dispatch from `/fab-proceed` after a diagnosis-and-decision discussion on 2026-09-11 (the live box, verified by hand). The synthesized description handed to the intake step:

> Stable rk path for daemon-spawned processes — code-server RK_BIN no longer pins a Cellar version.
>
> After every automated `shll update` / `rk update`, the code-bridge extension's context-menu actions (Open in Web Tile, Send to Agent) fail with the toast `run-kit: rk not found — set rk.bridge.rkPath`. The `rk-code-server` tmux session's start command carries `RK_BIN=/home/linuxbrew/.linuxbrew/Cellar/run-kit/3.19.42/bin/run-kit`, a directory brew removed when it upgraded to 3.19.44. The extension's ladder (`rk.bridge.rkPath` → `$RK_BIN` → `rk` on PATH) never falls through a set-but-dangling RK_BIN, so `execFile` ENOENTs.
>
> Agreed fix: a stable-path variant in `internal/selfpath` that maps a Cellar path to the brew-prefix `bin/run-kit` symlink; use it for the code-server spawn's `RK_BIN` element, the install-job shell chain, and the gui supervisor spawn; make `upgrade.go` reuse the shared helper. Explicitly out of scope: making the extension fall through to `rk` on PATH when `RK_BIN` is set but ENOENT.

Interaction mode: one-shot dispatch; the design decisions were made in the preceding conversation and are recorded verbatim in **What Changes** and **Assumptions**. Change type is `fix`.

## Why

**The pain.** Every Homebrew upgrade of run-kit silently breaks the code-bridge extension on the live box. The `rk-code-server` tmux session is spawned with `RK_BIN=<Cellar>/run-kit/<old-version>/bin/run-kit`. `brew upgrade` deletes that Cellar directory, and from then on every bridge action (Open in Web Tile, Open Folder in Web Tile, Send to Agent, Open Port in Web Tile) dies with `run-kit: rk not found — set rk.bridge.rkPath`. The user discovers it at the moment they try to use the `code` lens, after an update they did not run by hand (`shll update` runs unattended).

**The root-cause chain** (all verified against the source in this worktree):

1. `rk update` (`app/backend/cmd/rk/upgrade.go`, `runUpdateCLILeg`) runs as the *old* brew binary. `brew upgrade` installs the new keg and removes the old one, so the running process's `/proc/self/exe` target is gone.
2. The daemon restart leg is already correct: `runUpdateCLILeg` derives the stable brew symlink from the Cellar path (`resolved[:cellarIdx] + "/bin/run-kit"`, upgrade.go:293-300) and calls `restartDaemonFn(brewBinPath)`; `daemon.StartWithBinary` then `EvalSymlinks` that symlink to the *new* Cellar binary on purpose (daemon.go:351-371).
3. The code-server leg is not: `runUpdateCodeServerLeg` → `runCodeServerUpdateFlow` → `respawnCodeServerSession` → `daemon.StartCodeServer` → `ensureCodeServerCore(cli=true)` (`app/backend/internal/daemon/codeserver.go:194-274`) respawns `rk-code-server` from that same old CLI process. `codeServerSelfPath` defaults to `selfpath.Resolve` (`app/backend/internal/selfpath/selfpath.go`): `os.Executable()` (Go strips the ` (deleted)` suffix from `/proc/self/exe`) then `filepath.EvalSymlinks`, which fails because the file is gone and falls back to the raw path. The result is a clean-looking, version-pinned, already-deleted Cellar path baked into `RK_BIN`.
4. Latent variant, independent of `rk update`: the daemon's own boot spawn (`ensureCodeServer()` from `daemon.Start`, daemon.go:426) resolves through the same function and pins the *current* Cellar version, so a plain `brew upgrade run-kit` with no code-server respawn breaks the bridge at the next upgrade as well. The gui supervisor spawn (`guiSelfPath = selfpath.Resolve`, gui.go:69, used at gui.go:174 for the `<rk-exe> gui supervise host --display :N` argv) and the code-server install job's shell chain (`spawnCodeServerInstallJob`, codeserver.go:285) carry the same latent pin.

**If we do nothing.** The bridge breaks on every release. The only remedies are per-machine: set `rk.bridge.rkPath` to `/home/linuxbrew/.linuxbrew/bin/rk`, or `tmux -L rk-daemon kill-session -t '=rk-code-server' && rk code-server start` after each update. Neither scales to the unattended `shll update` path, and the gui supervisor argv would exhibit the same class of failure the first time that session is respawned from a stale process.

**Why this approach.** The codebase already states the rule: `app/backend/cmd/rk/agent_setup.go` `resolveRkPath` embeds "the STABLE symlink … NOT the version-pinned Cellar path" into installed hooks, with the comment "Intentionally NOT filepath.EvalSymlinks(p): that would pin the Cellar path." `upgrade.go` already derives that exact stable path inline for the daemon restart. The fix generalizes the existing derivation into `internal/selfpath` and points every daemon-spawned long-lived process at it. Rejected alternative: teaching the extension to fall through to `rk` on PATH when `RK_BIN` is set but ENOENT. That treats the symptom (the extension would work by accident of the tmux window's PATH — exactly the fragility the `RK_BIN` design decision in memory rejected) and leaves the gui spawn and install-job chain broken; the user explicitly ruled it out.

## What Changes

### 1. `internal/selfpath`: a stable-path variant beside `Resolve`

`app/backend/internal/selfpath/selfpath.go` gains two functions; `Resolve`, `IsBrewInstalled`, and `CellarMarker` are unchanged.

```go
// StableFor maps a resolved executable path to the path that survives a
// Homebrew upgrade. A Cellar path (…/Cellar/run-kit/<version>/bin/run-kit)
// becomes the brew-prefix symlink <prefix>/bin/run-kit, which brew repoints on
// every upgrade; any other path is returned unchanged. Pure string derivation —
// it never stats the result, because during `brew upgrade` the stable symlink
// dangles for a moment and a stat-then-fallback would re-pin the Cellar path.
func StableFor(resolved string) string

// Stable is Resolve followed by StableFor: the path to hand to processes that
// outlive this binary's version (spawn argv, env such as RK_BIN, shell chains).
// Callers that need the real on-disk binary (brew detection, the daemon's own
// respawn) keep using Resolve.
func Stable() (string, error)
```

Exact behavior:

| Input to `StableFor` | Output |
|---|---|
| `/home/linuxbrew/.linuxbrew/Cellar/run-kit/3.19.42/bin/run-kit` | `/home/linuxbrew/.linuxbrew/bin/run-kit` |
| `/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit` | `/opt/homebrew/bin/run-kit` |
| `/usr/local/bin/rk` (no Cellar marker) | `/usr/local/bin/rk` (unchanged) |
| `/home/u/go/bin/rk` | unchanged |
| `""` | `""` |

The derivation is `resolved[:strings.Index(resolved, CellarMarker)] + "/bin/run-kit"` — byte-identical to what `upgrade.go:296-300` does today, so the stable identity is `run-kit` (the formula/bin name), not `rk`. `Stable()` has the same `func() (string, error)` signature as `Resolve` so it drops straight into the existing `codeServerSelfPath` / `guiSelfPath` seams.

Unit tests (new `app/backend/internal/selfpath/selfpath_test.go`, the package has none today): table test for `StableFor` covering the rows above; a `Stable()` smoke test asserting it returns a non-empty path with no error and equals `StableFor(Resolve())` for the test binary (a non-Cellar path, so unchanged).

### 2. `cmd/rk/upgrade.go`: reuse the shared derivation

Replace the inline block in `runUpdateCLILeg` (upgrade.go:293-300):

```go
cellarIdx := strings.Index(resolved, selfpath.CellarMarker)
if cellarIdx == -1 {
    return fmt.Errorf("could not derive brew prefix from %s", resolved)
}
brewBinPath := resolved[:cellarIdx] + "/bin/run-kit"
```

with `brewBinPath := selfpath.StableFor(resolved)`. The `cellarIdx == -1` error branch is unreachable today (the leg already returned at upgrade.go:239 when `!selfpath.IsBrewInstalled(resolved)`), so dropping it changes no behavior; if the reviewer prefers to keep a guard, `brewBinPath == resolved` after `StableFor` is the equivalent check. Existing `upgrade_test.go` cases (`withResolveExe(t, "/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit", nil)` + `withRestartRecorder`) already assert the restart receives `/opt/homebrew/bin/run-kit`; they must keep passing unchanged. Drop the `strings` import from upgrade.go only if nothing else in the file uses it.

### 3. `internal/daemon/codeserver.go`: `RK_BIN` and the install chain carry the stable path

Change one line: `var codeServerSelfPath = selfpath.Resolve` → `var codeServerSelfPath = selfpath.Stable` (codeserver.go:74). Both consumers pick it up:

- the spawn's env prefix, `envPrefix = append(envPrefix, "RK_BIN="+self)` (codeserver.go:238-242) — on a brew box the `rk-code-server` start command becomes `env -u VSCODE_IPC_HOOK_CLI RK_BIN=/home/linuxbrew/.linuxbrew/bin/run-kit <code-server> …`;
- the install job's shell chain, `'<exe>' code-server install && '<exe>' code-server start` (codeserver.go:285-293), which otherwise would run a deleted binary if brew upgraded during the ~100 MB download.

Update the seam's doc comment (codeserver.go:70-73) and the spawn commentary block (codeserver.go:320-330, "sets RK_BIN to the daemon's own resolved binary path") to say the value is the version-stable path: the brew-prefix symlink on a Homebrew install, the resolved binary elsewhere, and *why* (the session outlives the version that spawned it). Warn-and-continue on resolution failure is unchanged.

Tests: existing `codeserver_test.go` cases stub `codeServerSelfPath` with fixed strings (`/usr/local/bin/rk`, `/x/bin/rk`, `/Users/Jane Doe/bin/rk`, and an error) and keep passing. Add one case that stubs the seam with a Cellar path composed through `selfpath.StableFor` — i.e. `codeServerSelfPath = func() (string, error) { return selfpath.StableFor("/opt/homebrew/Cellar/run-kit/1.2.3/bin/run-kit"), nil }` — and asserts the captured `new-session` argv contains `RK_BIN=/opt/homebrew/bin/run-kit` and no `/Cellar/` substring. The same shape for the install-job chain (argv contains `'/opt/homebrew/bin/run-kit' code-server install && …`).

### 4. `internal/daemon/gui.go`: the supervisor argv carries the stable path

Change one line: `var guiSelfPath = selfpath.Resolve` → `var guiSelfPath = selfpath.Stable` (gui.go:69), and update its doc comment (gui.go:67-68). The spawned argv `tmux new-session -d -e XDG_STATE_HOME=… -s rk-gui -n host <rk-exe> gui supervise host --display :N` then names `<prefix>/bin/run-kit` on brew boxes. Add one `gui_test.go` case in the shape of §3's (stub with `selfpath.StableFor(<Cellar path>)`, assert the captured argv's `<rk-exe>` element is the prefix symlink and carries no `/Cellar/`).

### 5. Callers that keep `selfpath.Resolve` (no change)

These need the real binary and must NOT switch — `IsBrewInstalled` on a `Stable()` result would be false because the marker is gone:

- `cmd/rk/upgrade.go` `resolveExeFn` (brew detection + the input to `StableFor`);
- `api/update.go` `resolveSelfPathFn` (brew detection for `POST /api/update`);
- `cmd/rk/serve.go` `resolveBrewInstalled` (the palette's brew-gated entry);
- `internal/daemon/daemon.go` `Start` (daemon.go:338-346) and `StartWithBinary` (daemon.go:371), which `EvalSymlinks` deliberately so the daemon session's command names the binary that is actually running;
- `cmd/rk/agent_setup.go` `resolveRkPath`, which already has its own PATH-first stable resolution and the `~/.local/share/rk/bin/run-kit` per-machine pointer (agent_setup.go:1613) — a hook-installer concern, not a daemon spawn concern; leave it alone.

### 6. Out of scope

- `app/code-bridge/src/rk.ts`: the ladder `rk.bridge.rkPath` → `$RK_BIN` → `rk` on PATH stays exactly as is; no ENOENT fall-through. Rejected by the user as symptom treatment.
- No self-heal of an already-running `rk-code-server` session whose `RK_BIN` is dangling: the next `rk update` (or `rk code-server start` / daemon restart) respawns it with the stable path, and the live-box workaround above covers the interim. No doctor row for a dangling `RK_BIN`.
- No change to non-brew installs: a path without the Cellar marker is passed through unchanged, so `go install`/curl-installer users see identical argv.
- `docs/specs/code-bridge.md` (~line 168) describes the ladder, which is unchanged; the parenthetical "the daemon's code-server spawn sets it from its own binary path" stays accurate. No spec edit.

## Affected Memory

- `run-kit/code-bridge`: (modify) § the `rk` resolution ladder — the `$RK_BIN` rung is "set by the daemon's code-server spawn to the version-stable rk path (the brew-prefix `bin/run-kit` symlink on Homebrew, never the Cellar path)"; the Design Decision "`RK_BIN` is env-carried; tab identity is not" gains the why: the session outlives the version that spawned it, and a Cellar path dies at the next `brew upgrade` (the 3.19.42 → 3.19.44 failure).
- `run-kit/daemon-lifecycle`: (modify) the code-server launch argv description (`RK_BIN=<self>` … `codeServerSelfPath` → `selfpath.Resolve()`) becomes `selfpath.Stable()` with the stable-vs-real distinction; the `rk update` leg bullet (line 18) notes the brew-bin derivation now lives in `selfpath.StableFor` and is shared with the code-server/gui spawns; the install-job chain note gains the same.
- `run-kit/gui`: (modify) § supervisor spawn — `<rk-exe>` from `selfpath.Stable` (not `Resolve`), keeping the "code-server `RK_BIN` precedent" cross-reference.
- `run-kit/architecture`: (modify) § Backend Libraries `internal/selfpath` — list `Stable`/`StableFor` beside `Resolve`/`IsBrewInstalled` and the rule for choosing between them (real binary for detection and the daemon's own respawn; stable path for anything spawned to outlive the version).

## Impact

- **Go backend** — `app/backend/internal/selfpath/selfpath.go` (+2 funcs), new `selfpath_test.go`; `app/backend/cmd/rk/upgrade.go` (replace 5 lines with 1); `app/backend/internal/daemon/codeserver.go` and `gui.go` (one seam default each + comments); `codeserver_test.go`, `gui_test.go` (+1 case each). No API, route, frontend, extension, or spec changes. No new dependencies.
- **Runtime effect** — on Homebrew installs the `rk-code-server` session's `RK_BIN`, the install-job chain, and the `rk-gui` supervisor argv name `<prefix>/bin/run-kit`; takes effect at the next spawn (daemon restart, `rk update`, `rk code-server start`, `rk gui on`). Non-brew installs: no observable change.
- **Verification** — `just test-backend` (targeted first: `go test ./internal/selfpath/ ./internal/daemon/ ./cmd/rk/` via the just recipe conventions); after merge and `rk update` on the live box, `tmux -L rk-daemon display -p -t '=rk-code-server' '#{pane_start_command}'` should show `RK_BIN=/home/linuxbrew/.linuxbrew/bin/run-kit`, and a bridge action should succeed without `rk.bridge.rkPath` set.

## Open Questions

- None blocking. Whether to keep an explicit "not a brew path" guard in `runUpdateCLILeg` after switching to `StableFor` (it is unreachable today) is left to apply/review judgment; see Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives in `internal/selfpath` as a stable-path variant; the extension ladder in `rk.ts` is untouched | Discussed — user approved this recommendation and explicitly rejected the extension fall-through as symptom treatment | S:95 R:85 A:95 D:95 |
| 2 | Certain | Stable identity is `<prefix>/bin/run-kit` (formula/bin name `run-kit`, not `rk`) | Byte-identical to the existing `upgrade.go` derivation and `agent_setup.go`'s stated rule; bin/Cellar identity is `run-kit` per daemon-lifecycle memory | S:90 R:90 A:95 D:95 |
| 3 | Certain | Switch `codeServerSelfPath` and `guiSelfPath` seam defaults; keep `selfpath.Resolve` for `resolveExeFn`, `resolveSelfPathFn`, `resolveBrewInstalled`, `daemon.Start`/`StartWithBinary`, and `agent_setup.resolveRkPath` | Discussed — brew detection needs the Cellar marker and the daemon respawn EvalSymlinks on purpose; switching them would break `IsBrewInstalled` | S:90 R:85 A:95 D:95 |
| 4 | Certain | Two-function shape: pure `StableFor(resolved string) string` plus `Stable() (string, error)` wrapping `Resolve` | Keeps the seam signature so the one-line default swap works, and gives `upgrade.go` (which already holds a resolved path) and unit tests a pure function; naming is routine and reversible in review | S:70 R:90 A:85 D:75 |
| 5 | Certain | `StableFor` is pure string derivation — no `os.Stat` of the symlink, no fallback to the Cellar path when the symlink is missing | During `brew upgrade` the stable symlink dangles briefly (tmux_guard.go:108); a stat-and-fallback at respawn time would re-pin the exact path that caused the bug. Matches `upgrade.go`'s existing unconditional derivation | S:65 R:85 A:85 D:80 |
| 6 | Certain | `upgrade.go` drops its inline derivation and the unreachable `cellarIdx == -1` branch in favor of `selfpath.StableFor` | Requested in the discussion ("make upgrade.go reuse the shared helper"); the branch is dead after the `IsBrewInstalled` early return at upgrade.go:239. Apply/review may keep an equivalent `== resolved` guard if preferred | S:80 R:90 A:85 D:70 |
| 7 | Certain | Tests: new `selfpath_test.go` table test; one argv-assertion case each in `codeserver_test.go` (spawn env + install chain) and `gui_test.go`, composed through `selfpath.StableFor` on a synthetic Cellar path; existing stubbed cases unchanged | code-quality.md requires tests for fixes; the package seams are the established test mechanism and the default-wiring swap is a one-liner verified by review | S:75 R:90 A:85 D:75 |
| 8 | Certain | Non-goals: no self-heal of a live session with a dangling `RK_BIN`, no doctor row, no spec edit to `docs/specs/code-bridge.md` | The next respawn (`rk update` respawns code-server every release) carries the fix; the workaround covers the interim; the ladder the spec describes is unchanged | S:70 R:90 A:80 D:75 |
| 9 | Certain | Memory hydrate touches `code-bridge`, `daemon-lifecycle`, `gui`, `architecture` (all modify) | Each currently names `selfpath.Resolve` or "own resolved binary path" for these spawns; verified by grep in this worktree | S:80 R:95 A:90 D:85 |

9 assumptions (9 certain, 0 confident, 0 tentative, 0 unresolved).
