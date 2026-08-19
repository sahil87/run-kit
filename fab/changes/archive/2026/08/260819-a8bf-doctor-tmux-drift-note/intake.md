# Intake: Doctor tmux Drift Note

**Change**: 260819-a8bf-doctor-tmux-drift-note
**Created**: 2026-08-19

## Origin

Conversational (`/fab-discuss` session, 2026-08-19). Follow-up W5 of the "tmux Version Floor" plan — deliberately split out of `260819-vtd1-tmux-version-floor` because it is not load-bearing for the floor and drags running-server probing into an otherwise clean change. **Depends on `260819-vtd1` (reuses its `internal/tmux` version helper); execute after it.**

> [From the plan, W5] Compare the on-disk client (`tmux -V`) against the running server (`display-message -p '#{version}'`); when the binary is newer, doctor prints "restart your tmux server when convenient to pick up X.Y". Closes the one gap brew-upgrade latency leaves.

## Why

1. **Pain point**: a tmux upgrade (brew or apt) replaces the binary on disk but never touches the running server — sessions keep executing the old code until `tmux kill-server` or reboot. That latency is by design (Constitution VI: upgrades must never kill sessions) but is invisible: a user who just ran `brew upgrade tmux` reasonably believes they are on the new version.
2. **Consequence if unfixed**: users who upgraded tmux to clear the `260819-vtd1` floor warning keep seeing old-server behavior (and, below 3.4, the tunnels gate still measures the *binary*, so a stale *server* can still misbehave in ways the new binary would not) with no explanation.
3. **Why this approach**: a doctor-only informational note is the cheapest surface that closes the gap. It never restarts anything itself — it tells the user the one command-shaped fact they need ("restart your tmux server when convenient to pick up X.Y").

## What Changes

### Server-version probe (`internal/tmux`)

For a running tmux server, read its version via `display-message -p '#{version}'` (the `#{version}` format variable reports the **server's** version, unlike `tmux -V` which reports the on-disk client binary). Executed per the §I discipline: `exec.CommandContext`, argv slice, timeout. Reuses `260819-vtd1`'s parse (major.minor, suffixes ignored, non-release strings → unknown; unknown never warns).

### Doctor drift note (`cmd/rk/doctor.go`)

When the on-disk binary's version is **newer** than a running server's version, the tmux check carries an informational note: `tmux 3.5 installed but the running server is 3.2a — restart your tmux server when convenient to pick it up (kills its sessions; pick a quiet moment)`. Shape rules:

- **Warn-shaped only** (OK + note, the code-server precedent): drift never fails doctor and never blocks anything.
- **Doctor-only surface** — not daemon start. Drift is informational; the daemon-start channel is reserved for the floor warning (warn fatigue).
- Probe servers rk already enumerates (`ListServers` — the live-server derivation), never spawning one: a tmux command on a dead socket resurrects a server (known trap), so the probe must target only servers already confirmed live, and absent/unreachable servers are silently skipped. <!-- assumed: probe scope = the live servers rk already enumerates, reporting drift per server; alternative was default-socket-only — enumeration reuses existing derivation and covers the rk-daemon socket where it matters most -->
- No auto-restart, ever (Constitution VI). The note explicitly says restarting the server kills its sessions, so "when convenient" is the user's call.

## Affected Memory

- `run-kit/architecture.md`: (modify) doctor tmux check gains the drift note; internal/tmux gains the server-version probe

## Impact

- `app/backend/internal/tmux/` — server-version probe + tests
- `app/backend/cmd/rk/doctor.go` — drift note + tests
- No frontend, API, or daemon changes. Constitution: §I (probe discipline), §II (version derived at request time, never stored), §VI (informational only — never restarts tmux).

## Open Questions

*(none — scope was fixed in the originating discussion; the one open design detail is recorded as the Tentative assumption below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Depends on 260819-vtd1's version helper; this change executes after it | Explicit split decision in the plan's packaging section | S:95 R:85 A:95 D:95 |
| 2 | Certain | No auto-restart ever; note names the cost ("kills its sessions") and leaves timing to the user | Constitution VI is non-negotiable | S:90 R:80 A:95 D:95 |
| 3 | Confident | Doctor-only surface (warn-shaped OK + note); daemon start is reserved for the floor warning | Discussed warn-fatigue risk; code-server note precedent | S:75 R:85 A:80 D:75 |
| 4 | Tentative | Probe scope: the live servers rk already enumerates, drift reported per server | Alternative (default socket only) is simpler but misses the rk-daemon socket; enumeration must avoid dead-socket resurrection | S:55 R:80 A:55 D:45 |

4 assumptions (2 certain, 1 confident, 1 tentative, 0 unresolved).
