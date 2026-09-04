# Intake: Writable tmuxctl Control Bridge (Go-Enforced Read-Only)

**Change**: 260904-gx32-tmuxctl-bridge-writable
**Created**: 2026-09-04

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized change description — the authoritative record of a prior discussion session that root-caused the `client is read-only` send-keys failures against tmux 3.7c source and live behavior. All design decisions below were made in that discussion; this intake transfers them verbatim.

> **Change**: Make the tmuxctl control bridge writable at the tmux layer — replace the `-r` flag with `-f ignore-size` in `productionDial` (`app/backend/internal/tmuxctl/client.go:420`, currently `tmux [-L <socket>] -CC attach-session -t =<bootstrap> -r`) — and move the "this channel never mutates" guarantee into Go by wrapping the bridge's PTY `io.ReadWriteCloser` so any `Write` returns an error.

Change type: fix.

## Why

**Root cause (verified against tmux 3.7c source and live behavior on this box)**:

1. tmux 3.7's `cmd_send_keys_exec` gained an unconditional guard: if the resolved target client has `CLIENT_READONLY` (and no `-X`), the command fails with `client is read-only` — **regardless of pane mode**. On tmux 3.6 only mode-key-table dispatch was affected (the old #360 copy-mode symptom).
2. Target-client resolution (`cmd_find_best_client` + `cmd_find_client_better`) is **recency-only and never skips read-only clients**: when the target pane's session has NO attached clients, resolution falls through to the most-recently-active client attached to ANY session on the server.
3. rk attaches its read-only `-CC` bridge to the `_rk-ctl` anchor on EVERY managed server (one per server, permanent). So any `send-keys` into an unwatched session on a managed server can resolve the read-only bridge as target client and fail.

**Exposed rk surfaces** (all funnel through send-keys wrappers):
- The inject engine's probe-gated Enter and `C-u` composer clear (`internal/inject/inject.go` → `SendEnterToPaneCtx` `internal/tmux/tmux.go:2767`, `SendKeysToPane` `internal/tmux/pane_target.go:188`) — used by chat send (`api/send.go`) and operator actuation.
- POST window send-keys (`api/windows.go:830` → `tmux.SendKeys` `internal/tmux/tmux.go:2692`).
- `rk mux send` (`cmd/rk/mux_send.go`).
- Chat adapter key sends (`api/chat.go:160`).
- Tutorial kickoff typed delivery.

The paste itself (`paste-buffer`) is immune — no client resolution — so the chat failure mode is "text staged, Enter refused" (StagedSendFailure 409).

**Failure determinism**:
- **Deterministic**: a session with no tty lens open anywhere. The chat lens attaches no PTY client; only the terminal view creates the writable relay client (`api/terminals_ws.go:523`, attached without `-r`). With no other client on the session, resolution falls through to the bridge → refused.
- **Nondeterministic**: board-pinned windows. The relay deliberately attaches to the `_rk-pin-*` session (`api/terminals_ws.go:457-468`), leaving the home session unattached → server-wide recency race between the writable relay and the read-only bridge.

**Field history**: this mechanism already bit — daemon Stop (fixed by #808 / change 260901-phip via signal-first delivery; that fix stays), plus fab-kit-side incidents (`fab dispatch ready` failing with `client is read-only` when the bridge was the sole client; a cross-server incident where send-keys was refused while the paste landed).

**If we don't fix it**: every typed-delivery surface in rk — and every external same-user tool issuing `send-keys` on a managed server (fab dispatch deliver/ready, agent hooks, user scripts) — stays exposed to a recency lottery that hard-fails on tmux ≥3.7, deterministically for chat-only sessions.

**Why this approach**: making the bridge writable at the tmux layer makes the recency lottery harmless for the WHOLE ecosystem, not just rk's own call sites. The security delta is small: `-r` protected exactly one fd against rk's own bugs, while any same-user process already has full write power over the socket (rk itself runs `kill-session` legitimately via `tmuxExecServer` subprocesses). The never-mutates guarantee moves into Go, where it becomes "cannot write" instead of "happens to never write".

## What Changes

### 1. `productionDial` flag: `-r` → `-f ignore-size`

In `app/backend/internal/tmuxctl/client.go` (`productionDial`, currently ~line 420):

```go
// before
args = append(args, "-CC", "attach-session", "-t", "="+bootstrap, "-r")
// after
args = append(args, "-CC", "attach-session", "-t", "="+bootstrap, "-f", "ignore-size")
```

**Not a bare removal of `-r`**: per the tmux man page, `-r` is an alias for `-f read-only,ignore-size`. Dropping `-r` outright would newly enroll the bridge in client-size arbitration (the bridge PTY's size would start constraining managed servers' window sizes). Keep `ignore-size`, drop only `read-only`.

### 2. Go-enforced write guard on the bridge PTY

Wrap the PTY `io.ReadWriteCloser` returned by `productionDial` so any `Write` returns an error (a package sentinel, e.g. `errBridgeWriteForbidden`); `Read` and `Close` pass through untouched (the reconnect FSM must still close the handle).

Verified today: the channel is a pure listener — no `.Write(` anywhere in `internal/tmuxctl/` production code or `api/tmuxctl_bridge.go` (only test fakes write to their own pipe). The bridge's re-seed queries (`list-sessions`/`list-windows`) run as separate one-shot tmux subprocesses, never via the control client's stdin. The wrapper turns "happens to never write" into "cannot write", preserving the Constitution VI narrative ("never mutates user sessions") as a code-enforced property instead of a tmux flag.

Given this project's history of accidental server-kill incidents (the reason the tmux guard shim exists), the write guard is **load-bearing, not decoration**. The wrapper MUST carry a comment stating the invariant — the bridge is a pure listener; commands to tmux go through one-shot subprocesses, never this handle — so a future contributor doesn't start issuing commands through it (comment states a cross-file constraint, per code-quality's comment policy).

### 3. Daemon `Stop()` unchanged (explicit non-goal)

`Stop()` stays signal-first exactly as shipped in 260901-phip. A writable target client with the pane in copy-mode would route `C-c` into the mode key table (the old #360 trap); the signal path bypasses key dispatch entirely and is strictly better. No code in `internal/daemon/` changes behavior; only memory narrative referencing the bridge's read-only-ness updates.

### 4. Regression coverage

- **Server-level regression test**: prove `send-keys` into a session succeeds on a server whose ONLY attached client is the bridge. Rig shape mirrors `TestStop_ReadOnlyControlClientStopsGracefully` in `internal/daemon/daemon_test.go` — a real PTY `-CC` attach on an isolated socket — but attaches the client exactly as `productionDial` now does (`-f ignore-size`) and asserts `send-keys` delivery. On tmux <3.7 the test passes trivially (the guard doesn't exist there), which is accepted: the local box runs tmux 3.7c where the test is meaningful; CI tmux version is unverified.
- **Unit test**: the write-guard wrapper refuses writes (Write returns the sentinel error; Read/Close still function).

### 5. Memory narrative update (anti-regression requirement)

The `-r` was a **documented deliberate safety property**: #808's plan Design Decisions explicitly rejected dropping it ("trade a stop-latency bug for a safety regression"), and the memory files below lean on it. This change MUST rewrite that narrative to the new posture — **read-only enforced at the Go layer, writable at the tmux layer so target-client resolution can never reject sends server-wide** — or the next agent to touch this surface will "fix" it back to `-r`. The hydrate stage owns the rewrite; the specific stale claims are enumerated in Affected Memory.

## Affected Memory

- `run-kit/daemon-lifecycle`: (modify) The `Client` (client.go) row states "`-t =<bootstrap> -r` … the `-r` flag puts the connection in read-only mode — see Design Decision below" (that Design Decision pointer is currently dangling — no matching § Design Decisions entry exists; this change should add one recording the writable-bridge + Go-write-guard posture). The `Stop()` sequence paragraph explains "the session's only attached client is run-kit's own read-only `-CC` control bridge (attached with `-r`) … signaling the PID is the only delivery that works with the bridge attached" — rewrite to the new posture (signal-first stays, but the read-only rationale changes: the bridge no longer refuses sends; the copy-mode key-table trap remains the reason signal-first is primary). The § Constitution Alignment §VI bullet ends with "the control-mode connection attaches read-only (`-r`)" — replace with the Go-enforced write-guard framing.
- `run-kit/tmux-sessions`: (modify) § `_rk-ctl` Anchor "Anchored target form" (line ~176) documents the `-r` flag and its "Defensive default — future refactors that accidentally wire commands through the control-mode connection cannot mutate tmux state" rationale — that defense moves to the Go wrapper; and the Key Files row (line ~565) shows the `-r` in the Client's attach command.
- `run-kit/architecture`: (modify) The daemon TMUX_PANE-scrub "Why" (line ~517) states "when the colliding pane's session has only the dashboard's read-only `-CC` relay client attached, tmux refuses the mutating commands (`send-keys`) while permitting … the paste lands, Enter fails" — after this change the bridge no longer triggers that refusal; the scrub fix stays valid (pane-id collision is wrong regardless), but the refusal narrative needs a past-tense/posture update. Check the § tmux Control-Mode Subscription section for any further `-r` mention.

## Impact

- **Code**: `app/backend/internal/tmuxctl/client.go` (`productionDial` args; write-guard wrapper type + sentinel error), `app/backend/internal/tmuxctl/client_test.go` (wrapper unit test), plus one server-level regression test (in `internal/tmuxctl` or mirroring the `internal/daemon/daemon_test.go` PTY rig — apply decides placement).
- **Behavioral blast radius**: every managed tmux server gains a writable (but Go-write-guarded) most-recent-client candidate. This *unblocks* send-keys for: chat send Enter (`api/send.go` StagedSendFailure 409 path), POST window send-keys (`api/windows.go`), `rk mux send`, chat adapter sends (`api/chat.go`), tutorial kickoff delivery, operator actuation — and for external same-user callers (fab dispatch deliver/ready, agent hooks, user scripts).
- **No API surface change**, no frontend change, no settings change.
- **tmux-version sensitivity**: the bug is tmux ≥3.7 (unconditional send-keys guard); the fix is safe on all supported versions (≥3.4 floor) — `-f ignore-size` is valid attach syntax on the whole range, and on pre-3.7 the change simply removes a latent trap.
- **Not touched**: `internal/daemon/` Stop() behavior (signal-first stays); the terminal relay client (`api/terminals_ws.go`, already writable); `paste-buffer` paths (already immune).

## Open Questions

*(none — all decision points were resolved in the originating discussion or decided-and-recorded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace `-r` with `-f ignore-size`, not bare removal | Discussed — tmux man page documents `-r` ≡ `-f read-only,ignore-size`; dropping `-r` outright would newly enroll the bridge in client-size arbitration | S:95 R:85 A:95 D:95 |
| 2 | Certain | Enforce the never-writes invariant in Go: wrap the bridge PTY so `Write` errors; comment states the invariant | Discussed — verified today the channel is a pure listener (no production `.Write(` in `internal/tmuxctl/` or `api/tmuxctl_bridge.go`; re-seed queries are one-shot subprocesses); guard is load-bearing given server-kill incident history | S:95 R:90 A:90 D:90 |
| 3 | Certain | Daemon `Stop()` stays signal-first, unchanged | Discussed — a writable target client with the pane in copy-mode routes `C-c` into the mode key table (the old #360 trap); the signal path bypasses key dispatch and is strictly better | S:95 R:90 A:95 D:95 |
| 4 | Certain | Writable-bridge over the alternatives (parked writable `no-output,ignore-size` client + `send-keys -c`; generalizing #808's signal-first; upstream tmux change) | Discussed with explicit rejection rationale — parking fixes only rk's own call sites and is nondeterministic (resolution never prefers writable); no signal equivalent exists for typing text; upstream is worth raising but not a shipping dependency | S:90 R:75 A:85 D:85 |
| 5 | Certain | Affected-memory sweep covers `daemon-lifecycle.md`, `tmux-sessions.md` § `_rk-ctl` Anchor, and `architecture.md` TMUX_PANE-scrub Why | Verified by grep during intake — all three repeat the read-only-bridge claim; enumerated with line anchors in Affected Memory | S:80 R:85 A:95 D:85 |
| 6 | Confident | Write-guard shape: sentinel error from `Write` (e.g. `errBridgeWriteForbidden`); `Read`/`Close` pass through | Discussion pinned "any `Write` returns an error" but not the exact sentinel/type; low-stakes detail, one obvious idiomatic shape; Close must pass through for the reconnect FSM | S:60 R:90 A:85 D:75 |
| 7 | Confident | Regression-test placement and rig: real PTY `-CC` attach on an isolated socket mirroring `TestStop_ReadOnlyControlClientStopsGracefully`, asserting send-keys success with the bridge as sole client; exact package (`internal/tmuxctl` vs `internal/daemon`) left to apply | Discussion fixed the rig shape and the assertion, not the file; either package can host the rig — decide-and-record at plan time | S:75 R:85 A:80 D:70 |
| 8 | Confident | CI tmux version unverified — the regression test passing trivially on pre-3.7 is accepted | Discussed and explicitly accepted ("meaningful on both; on pre-3.7 it passes trivially, which is acceptable"); local box (3.7c) exercises the real guard | S:70 R:80 A:60 D:75 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
