# Intake: Ephemeral Server Option — Snapshot Opt-Out + Reap

**Change**: 260821-zelc-ephemeral-option-snapshot-reap
**Created**: 2026-08-21

## Origin

Backlog item `[f2b7]` (2026-08-20), design direction 3 (root cause), refined in a `/fab-discuss` session (2026-08-20/21):

> … (3) root cause: snapshotter covers every supervised socket, so agent scratch servers accumulate lingering latests — consider an ephemeral opt-out convention (extend the never-snapshot patterns beyond rk-test-*, or an @rk_ephemeral option agents set).

Conversational mode. The user chose the **`@rk_ephemeral` option** sub-flavor (3b) over extending name patterns (3a) — patterns cannot catch arbitrary agent-invented names like `echotest`/`agyprobe`, which were half the observed debris. The user then broadened the scope beyond agents: test runners and other tooling should also set it ("We do face a lot of cleanup problems of the test cases. This is a great solution to that."). A four-phase rollout was agreed; **this change is phases 1–2** (core option + snapshotter opt-out, `rk mux reap --ephemeral`). Phase 3 (creation verb + adoption) is sibling `260821-hbmh-ephemeral-creation-adoption`; phase 4 (surfacing) is sibling `260821-l1qe-ephemeral-server-surfacing` — **both stack on this change's branch**. The UI backstop (Dismiss all) is independent sibling `260821-f2b7-recovery-dismiss-all`.

## Why

1. **Pain**: The layout snapshotter covers every supervised socket (its `ServerSource` is the tmuxctl Supervisor's client set — only `.lock` and `rk-test-*` are excluded, supervisor.go:24-35). Every ad-hoc scratch server an agent or tool spins up (`rk-spike-*`, `echotest`, `agyprobe`) therefore earns a persistent "latest" snapshot. Offers only accumulate when a server dies while the daemon isn't watching (daemon downtime or reboot — a live-daemon kill fires `OnServerRemoved` → tombstone → never offered), so after any reboot the recovery section drowns in scratch offers: 15 observed on first live use, all debris.
2. **Consequence if unfixed**: Debris accumulates indefinitely; the recovery feature (4psk/#679) is unusable at exactly its moment of value. Cleanup of leaked scratch servers also stays name-guessing-based (`rk mux reap` is prefix-only), which is why agents historically reached for raw `tmux kill-server` — the source of four documented host-server-death incidents.
3. **Why this approach**: "This server is scratch" is creator intent — genuinely underivable from tmux/filesystem/git, which per the project's option-convention family (`@rk_agent_state`, `@rk_owner`; Constitution Principle X's logic) makes a tmux user option the correct channel. Reading it at request time is a Principle II derivation — no new state store. Name patterns (rejected direction 2 / 3a) under-catch and false-positive.

## What Changes

### 1. The `@rk_ephemeral` convention

A **server-scoped tmux user option**; presence with a truthy value (`1`) marks the whole server ephemeral:

```sh
tmux -L <socket> set-option -s @rk_ephemeral 1     # mark
tmux -L <socket> set-option -s -u @rk_ephemeral    # unmark — promotes back to durable
```

- Server scope (`-s`), not session scope: the snapshot unit, kill unit, and offer unit are all servers. (tmux 3.x supports user options at server scope; the host runs tmux 3.6a.)
- **Un-set is a feature**: removing the option promotes a scratch experiment to a real server — snapshot coverage resumes on the next tick with no other action.
- **The option dies with the server** (options live inside the tmux process). No consumer can ask post-mortem. Therefore the `rk-test-*` name umbrella (`IsTestServerName`, internal/tmux/tmux.go:2160) is NOT replaced — it remains the post-mortem/dead-socket fallback. Code semantics: `IsTestServerName(name) ⇒ treated as ephemeral`; the option extends the semantic to arbitrarily-named live servers.
- Register the option in the `@rk_*` user-option registry documented in memory `run-kit/tmux-sessions`.

### 2. Option constant + reader — `app/backend/internal/tmux/`

- A named constant for the option (magic-string rule, code-quality.md) alongside the existing `@rk_*` option constants.
- A reader helper, e.g. `IsEphemeralServer(ctx context.Context, server string) (bool, error)`, wrapping `show-options -s -q -v @rk_ephemeral` via the existing `tmuxExec*Server` plumbing (all tmux interaction stays in `internal/tmux/`; `exec.CommandContext` + timeout per Constitution I). Truthy = value `1` / non-empty per the existing option-parsing idiom in this package. A gone/unreachable server reads as not-ephemeral (callers hold liveness separately).

### 3. Snapshotter opt-out — `app/backend/internal/snapshot/`

Two obligations, both load-bearing:

1. **Skip**: a marked server gets no snapshot writes. Wire the check into the snapshotter's per-server pass — NOT into the Supervisor's covered set (coverage powers SSE/state for everything; an ephemeral server must still appear live in the UI). Suggested seam: extend the `ServerSource` interface (snapshotter.go:43-46) with an ephemeral query implemented by `*tmuxctl.Supervisor` (it holds control-mode clients — a cheap in-process query path), or read the option inside `snapshot()` just before capture. **Cost constraint**: do not add a per-server subprocess on every 2s tick; read at the points a write would happen (first observation, due passes) or cache with a refresh on the safety cadence — the exact caching design is apply's decision.
2. **Retire on first observation (mandatory)**: first observation of a new server snapshots immediately (`snapshotter.go:160-163`), so a mark set even seconds after creation has already left a `latest` on disk. When the snapshotter first observes the mark on a covered server, it must remove that server's existing latest — add a `Store` method (e.g. `RetireLatest(server string) error`, an idempotent `os.Remove` of the latest path; missing file = no-op success). This is deliberately NOT a tombstone: tombstones mean "server died"; retire means "never should have been covered". Rolling history files are left to the existing prune (cheap, capped).

**Accepted residual race**: a server marked and killed within one check interval (~2s) before the snapshotter observes the mark leaves a lingering latest → one offer appears. Accepted; the independent Dismiss-all backstop (`260821-f2b7`) covers it. Do NOT over-engineer (e.g. stamping ephemeral into the snapshot payload) for this window.

Also skip in `RestorableOffers`' defensive filter only if a cheap live check exists — offers derive from dead servers whose option is unreadable, so the skip+retire pair above is the real mechanism; do not force a defense that cannot work post-mortem.

### 4. `rk mux reap --ephemeral` — `internal/tmux/reaper.go` + `cmd/rk/reaper.go` / `mux.go`

Extend the operator janitor with an option-based match dimension:

- **Semantics**: when `--ephemeral` is passed, the matched set is the **union** of the prefix match (unchanged; bare invocation still defaults to prefix `rk-test`) and all **live** servers carrying `@rk_ephemeral`. Dead sockets/`.lock` files cannot be queried and stay prefix-only territory.
- Enumerate live servers via the existing live-server listing (see memory: any tmux command on a dead socket resurrects a server — filter to live sockets before querying options, the established `tmux-client-cmd-resurrects-stale-sockets` rule).
- **Inherited gates unchanged**: dry-run by default (`act` via `--yes`/`--force`), per-entry failure isolation, and the unconditional hard-skips of `rk-daemon` and `_rk-ctl` (reaper.go:109-110). The dangerous-prefix guard applies to the prefix dimension only — `--ephemeral` matches are explicit creator opt-in and need no length guard.
- **Safety framing** (carry into help text): the option is explicit opt-in set by the creator, making this sweep safer than prefix guessing — and it gives agents a sanctioned bulk-cleanup verb so they stop reaching for raw `tmux kill-server`.

### 5. Toolkit standards

New CLI flag surface ⇒ Constitution "Toolkit Standards": check `shll standards` (help-dump, README extraction, Principle 9) before finalizing the flag/help text; regenerate whatever the help-dump standard requires.

### 6. Tests

- `internal/tmux`: reader helper unit tests (option set/unset/absent; gone server).
- `internal/snapshot`: snapshotter skip + retire-on-first-observation (the test suite already injects `captureFunc` and a fake `ServerSource` — extend the fake with the ephemeral seam); `Store.RetireLatest` idempotency.
- Reaper: extend `reapCandidates`-style seam tests (temp dir + fake prober) with the ephemeral dimension; dry-run plan includes option-matched servers.
- All via `just test-backend`.

## Affected Memory

- `run-kit/layout-snapshots`: (modify) snapshotter coverage rules — ephemeral opt-out, retire-on-mark, residual race note
- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry gains `@rk_ephemeral`; reap section gains the option dimension
- `run-kit/agent-messaging`: (modify) `rk mux reap` flag surface
- `run-kit/toolkit-standards`: (modify) new-surface check covers the grown reap flag

## Impact

Backend-only: `internal/tmux` (constant, reader, reaper), `internal/tmuxctl` (if the ServerSource seam lands there), `internal/snapshot` (snapshotter, store), `cmd/rk` (reap flag + help). No API/frontend changes (those are sibling `l1qe`).

**Stacking**: this change is the base of the ephemeral stack. Siblings `260821-hbmh` (creation/adoption) and `260821-l1qe` (surfacing) branch off THIS change's branch and PR against it (stacked PRs); they depend on the option constant + reader landing here. Independent of `260821-f2b7` (frontend Dismiss all).

## Open Questions

*(none — all decisions resolved in the discussion session)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server-scoped tmux user option `@rk_ephemeral`, truthy value `1`, unset promotes back to durable | Discussed and user-approved; fits the existing `@rk_*` convention family; snapshot/kill/offer units are all servers | S:90 R:80 A:90 D:85 |
| 2 | Certain | Skip lives in the snapshotter, NOT the Supervisor covered set — ephemeral servers stay live in SSE/UI | Discussed — coverage powers state for everything; hiding live servers violates the operator-visibility principle (tmux.go:2156 comment) | S:85 R:75 A:90 D:85 |
| 3 | Certain | Retire existing latest on first mark observation (idempotent latest-file remove, not a tombstone) | Discussed as mandatory — first observation snapshots immediately, so late marks already left a latest | S:85 R:80 A:90 D:85 |
| 4 | Confident | Residual ~2s mark-then-die race accepted; backstopped by sibling Dismiss all, no snapshot-payload flag | Discussed — window is one check interval; over-engineering rejected | S:75 R:70 A:80 D:75 |
| 5 | Confident | Reap `--ephemeral` = union with the (default `rk-test`) prefix match, live servers only, no length guard on the option dimension | Union preserves bare-reap behavior; option is explicit opt-in; dead sockets are unqueryable so prefix keeps owning them | S:65 R:75 A:80 D:70 |
| 6 | Confident | Exact reader caching/read-point design (ServerSource seam vs read-at-write) left to apply within the no-per-tick-subprocess constraint | Implementation detail with a clear constraint; both candidate seams are cheap and reversible | S:60 R:80 A:75 D:60 |
| 7 | Certain | `rk-test-*` name umbrella retained as the post-mortem fallback; `IsTestServerName ⇒ ephemeral` semantically | Options die with the server — names are the only signal on dead sockets; discussed explicitly | S:85 R:85 A:90 D:90 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
