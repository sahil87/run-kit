# Intake: tmux Version Floor

**Change**: 260819-vtd1-tmux-version-floor
**Created**: 2026-08-19

## Origin

Conversational (`/fab-discuss` session, 2026-08-19). The user asked how much run-kit can/should link to the user's tmux version — on macOS especially, very old tmux degrades the experience — and whether to enforce via brew or the install script. The discussion produced a full plan (published as the "tmux Version Floor" artifact) with workstreams W1–W5; this change implements **W1 (runtime version check) + W2 (remote-tunnels gate) + W4 (docs)**. W3 (formula `depends_on "tmux"`) is a manual homebrew-tap commit outside this repo; W5 (drift note) is the separate follow-up change `260819-a8bf-doctor-tmux-drift-note`.

> Check how much we can link this script with the tmux version the user's systems. On MacOS esp, some users use very old versions of tmux with run-kit which degrades the experience. Can and should we link a (min) version of tmux with run-kit either via brew or via the install script? […] Runtime check — can doctor be run as a part of the rk daemon command itself — I don't think anyone will remember to run it explicitly.

Key decisions from the discussion: enforce at **daemon start** (not doctor, which nobody runs); **warn, don't block** — except remote tunnels which hard-refuse below 3.4; install script stays untouched (thin bootstrap by design); Ubuntu upgrade path is Homebrew-on-Linux.

## Why

1. **Pain point**: run-kit silently degrades — or is silently insecure — on old tmux. The dashboard's behaviors are verified against tmux 3.6a, but nothing checks the host's version: `rk doctor` and the daemon-start precheck test only *presence* (`exec.LookPath("tmux")`).
2. **Consequence if unfixed**: the worst case is not cosmetic. Below tmux 3.4, multi-argument commands passed to `new-session`/`new-window` are **shell-joined instead of exec'd as argv** — the remote-tunnels path (`rk-remotes`) would string-interpolate remote host input through a shell, a Constitution §I violation. Softer degradations: `copy-mode -q` (daemon `Stop()` wedge-prevention) needs ≥3.2, `#{b:...}` window naming needs ≥3.1, pane user options (`@rk_agent_state` badges) need ≥3.0. Users on Ubuntu 22.04 (tmux 3.2a), 20.04 (3.0a), or Debian 12 (3.3a) hit these today with no signal.
3. **Why this approach**: a runtime check at daemon start is the only mechanism that covers every install path (brew, apt, MacPorts, source), every point in time, and PATH shadowing — and it rides a seam that already exists (`checkTmuxPresent()`, `internal/daemon/daemon.go:281`). Homebrew cannot express version constraints on dependencies (a stale keg satisfies `depends_on`), and the install script is a deliberately thin bootstrap that must not carry run-kit-specific knowledge.

## What Changes

The floor is **tmux ≥ 3.4** (the `>=` comparison is load-bearing: Ubuntu 24.04 ships exactly 3.4 and must pass without nagging).

### Version helper (`internal/tmux/version.go`, new)

Run `tmux -V` (through PATH — i.e. through the tmux-guard shim to the real binary, which is exactly what we want to measure) via `exec.CommandContext` with timeout, argv slice. Parse the `tmux 3.2a` / `tmux 3.4` shapes: extract `major.minor`, ignore letter suffixes. Non-release strings (`tmux next-3.7`, vendor formats) parse to **unknown** — unknown is never a failure and never warns (never block on a parse). Expose a comparison against the floor constant (single source of truth for `3.4`).

### Daemon-start precheck (`internal/daemon/daemon.go`)

Extend the existing `checkTmuxPresent()` seam (runs before `IsRunning`, the port guard, and the stale-socket reap):

- **Absence stays a hard fail** with the existing `tmux.InstallHint` remediation (unchanged behavior).
- **Below-floor version prints a one-line stderr warning + upgrade hint and continues.** Blocking start would brick currently-working setups the moment they upgrade rk, when only tunnels actually require the floor.
- Warning fires **once at start** — never per-request logging (warn fatigue).

### `rk serve` startup warning

The same check logs `slog.Warn` from `rk serve` startup (the process the daemon session actually runs), so the warning lands in the daemon log on paths where stderr is invisible: the desktop app's "Start & connect" and `rk update`'s restart.

### `rk doctor` (`cmd/rk/doctor.go`)

The existing tmux check gains version info — below floor is **OK with a warning note + upgrade hint** (warn-shaped, mirroring the code-server check precedent: doctor stays green for users who never touch tunnels). The `--json` output carries the version in the check's `note` field. Doctor is the detail view, not the enforcement point.

### Upgrade hint ladder (`internal/tmux/install_hint.go`)

The existing Linux **absence** ladder (`apt-get → dnf → yum → pacman → zypper → apk`) is unchanged. A new **upgrade** hint (tmux present but below floor) must NOT recommend apt — apt cannot deliver ≥ 3.4 on the releases where the warning fires (distro versions are frozen; tmux is not in backports; no maintained PPA exists). Upgrade ladder:

| Probe | Hint |
|-------|------|
| darwin | `tmux 3.2a is below the supported 3.4 — upgrade with: brew upgrade tmux` |
| linux, brew on PATH | `tmux 3.2a is below the supported 3.4 — upgrade with: brew install tmux` |
| linux, no brew | `tmux 3.2a is below the supported 3.4 — your distro's tmux is too old; install Homebrew (https://brew.sh) then: brew install tmux` |

(Brew-on-Linux is the supported answer because the shll.ai install path hard-requires Homebrew on Linux too — every supported-path user already has it.)

### Remote-tunnels gate (`internal/remote`)

The tunnels path relies on ≥ 3.4's no-shell argv exec for remote host input. Below the floor, the Connect entry **refuses** with an actionable error naming the version found plus the upgrade hint. This is the one hard gate — a §I security regression, not a degraded experience. Reuses the version helper.

### Docs (`docs/site/install.md`, `README.md`)

State the minimum (3.4) and the recommended upgrade path (brew, both platforms) in `docs/site/install.md`, including two caveats: (a) `brew shellenv` must precede `/usr/bin` on PATH or the apt tmux keeps winning (the runtime check catches this since it probes what PATH resolves); (b) an upgraded binary takes effect only at the next `tmux kill-server` — the upgrade itself never kills running sessions. README gets at most a one-line minimum-version mention — per the shll install-composition standard Policy B it must not grow per-formula install instructions.

## Affected Memory

- `run-kit/architecture.md`: (modify) daemon-start precheck gains the version warn; doctor tmux check gains version note; internal/tmux module row gains the version helper
- `run-kit/remote-hosts.md`: (modify) tunnels Connect entry documents the <3.4 refusal and its rationale (no-shell argv exec floor)

## Impact

- `app/backend/internal/tmux/` — new `version.go` + tests; `install_hint.go` upgrade ladder + tests
- `app/backend/internal/daemon/daemon.go` — `checkTmuxPresent()` extension + tests (the `daemonTmuxLookPath` stub idiom extends to a version-output stub)
- `app/backend/cmd/rk/` — serve startup warn; `doctor.go` version note + tests
- `app/backend/internal/remote/` — Connect gate + tests
- `docs/site/install.md`, `README.md` — docs only
- No frontend changes. No API changes. Constitution: §I (closes the shell-interpolation exposure; probe uses CommandContext/argv), §VI (nothing restarts or kills tmux — upgrades stay user-initiated and latent).

## Open Questions

*(none — all decision points were resolved in the originating discussion)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Floor is tmux ≥ 3.4, compared as `>=` (24.04's exact-3.4 passes) | Derived from documented feature dependencies (remote-hosts ≥3.4 no-shell argv; copy-mode -q ≥3.2; #{b:} ≥3.1; pane options ≥3.0); discussed and confirmed | S:90 R:70 A:95 D:90 |
| 2 | Certain | Enforcement point is daemon start via the existing `checkTmuxPresent()` seam; doctor is the detail view | User explicitly directed ("no one remembers to run doctor"); seam verified at daemon.go:281 | S:95 R:80 A:90 D:95 |
| 3 | Certain | Warn-don't-block everywhere except remote tunnels, which hard-refuse below 3.4 | Discussed — blocking daemon start would brick working setups; tunnels are the §I security seam | S:90 R:70 A:90 D:85 |
| 4 | Confident | Upgrade hint ladder is brew-first on Linux; absence ladder unchanged | Discussed — apt cannot deliver ≥3.4 on old LTS; supported install path already requires brew on Linux | S:85 R:85 A:85 D:80 |
| 5 | Confident | Unparseable version strings (`next-3.7`, vendor formats) are unknown: no warning, never a block | Discussed risk row — never block on a parse; conservative default | S:80 R:85 A:85 D:80 |
| 6 | Confident | `rk serve` startup logs the same warning via slog.Warn for invisible-start paths (desktop app, `rk update` restart) | Discussed — stderr from daemon start is invisible on those paths | S:80 R:85 A:80 D:80 |
| 7 | Confident | Docs land in docs/site/install.md; README carries one line max | install-composition standard Policy B binds README install content | S:80 R:90 A:90 D:85 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
