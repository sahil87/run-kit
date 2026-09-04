# Intake: Mux Send Delivery Hardening (Agent-Messaging Part A)

**Change**: 260904-kppn-mux-send-delivery-hardening
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation, executing **Part A** of the execution plan in
`docs/specs/agent-messaging.md` (landed on main as commit `c36cfbd8`, fast-forwarded
into this branch). The spec was decided in a 2026-09-04 discussion session; this
change delivers **Gaps from current state items 1 and 4** (§ Delivery hardening —
target invariants).

> Agent-messaging Part A: send hardening (gaps 1+4). Add a pane-mode guard to every
> rk mux delivery path (text paste, --key sends, the sentinel probe): probe
> `#{pane_in_mode}` and cancel an active copy-mode via `send-keys -X cancel` before
> touching the pane. Add a foreground-naming warning to unknown-state plain sends —
> when `pane_current_command` is not a shell, warn-and-send naming the foreground
> command (e.g. foreground process htop running). See docs/specs/agent-messaging.md
> (commit c36cfbd8 on main) section Delivery hardening — target invariants, and
> section Gaps from current state items 1 and 4. This run-kit part intrinsically
> includes: the standards audit (shll standards), the help-dump test update for
> `rk mux -h`, and `rk skill` messaging topic-page updates per the Execution plan
> table in the same spec. No dependency on Part B, but Part B touches the same
> internal/inject area — rebase against main before shipping if B has already merged.

## Why

1. **The pain point**: a pane sitting in copy-mode (a scrolled pane — the most common
   way agents and humans leave a pane) **silently eats keys**. Today no rk delivery
   path checks for it: `#{pane_in_mode}` appears nowhere in `app/backend` (verified by
   grep). A `rk mux send` into a scrolled pane pastes into copy-mode where the bytes
   vanish or trigger copy-mode bindings; the echo probe then fails (or worse, `--key`
   sends have no probe at all and just disappear). fab's Go dispatch seam already
   carries this guard (`_cli-agents.md` § Pre-Send Validation step 3: raw sends first
   clear any pane mode), so today **fab's internal senders are safer than rk's public
   standard** — exactly the inversion the spec calls out and closes.
2. **The consequence of not fixing it**: the cross-agent messaging standard
   (`rk mux send` is the de-facto surface per the spec's four-layer model) keeps a
   known silent-loss mode. Operators and agents debugging "delivered but nothing
   happened" burn time on a mechanical, fully-detectable condition (see memory:
   the daemon-stop copy-mode incident, and `fab dispatch` deliveries landing as paste
   while copy-mode + read-only clients held the pane).
3. **Why this approach**: the guard is a mechanism property, so it belongs in the
   **Mechanism layer** (`internal/inject` — the single-engine invariant: every rk-owned
   code path that types into a pane goes through it, no exceptions). Probing
   `#{pane_in_mode}` and cancelling (`send-keys -X cancel`) is cheap (one read + at
   most one cancel per delivery), matches fab's proven seam, and cannot harm a pane
   not in a mode. The foreground-naming warning (gap 4) is information-only: the
   unknown-state warn-and-send posture stays (a non-shell foreground may be a hook-less
   agent — exactly the documented `await --ready && send --force` composition's case);
   the warning just names what is actually running so the caller can judge. No new
   gate state.

## What Changes

### 1. Pane-mode guard in the shared injection engine (`internal/inject`)

Every rk delivery path probes `#{pane_in_mode}` and cancels an active mode before
touching the pane:

- **New tmux primitive(s)** in `internal/tmux` (context-bound, argv-slice,
  Constitution §I): a pane-mode probe reading `#{pane_in_mode}` for a pane
  (`display-message -pt %N '#{pane_in_mode}'` shape — same round-trip family as
  `PaneFactsCtx`), and a mode-cancel (`send-keys -t %N -X cancel`). Note `-X` is a
  `send-keys` flag, not a key name — this is a distinct call shape from
  `SendKeysToPane(keys...)`, so it needs its own primitive rather than passing `-X`
  as a key.
- **Engine seam**: the `inject.Tmux` interface gains the guard's primitives (probe +
  cancel), and the guard runs at the top of the delivery sequences —
  `Engine.Send` (text paste: CLI `rk mux send` + the daemon compose-send route),
  `Engine.SendRaw` (raw paste: daemon consumers), and `Engine.PressEnter` — inside
  the per-pane lock, before the baseline capture / first byte. Both existing `Tmux`
  implementations (the CLI's `cliInjectTmux` in `cmd/rk/mux_send.go`, the daemon's
  adapter over its TmuxOps seam) implement the new methods by delegating to the
  `internal/tmux` primitives.
- **The `--key` path** (`runMuxSend`'s `hasKeys` branch — today a direct
  `tmux.SendKeysToPane` with no engine involvement) runs the same guard before
  sending: probe, cancel-if-in-mode, then the key send. Whether this is expressed as
  an exported `inject` helper or a guard-wrapped send primitive is a plan-level
  choice; the invariant is that the SAME probe+cancel decision runs on every path,
  never a divergent copy.
- **The sentinel probe** (spec § Delivery hardening lists it as a guarded path): the
  sentinel echo probe itself ships with **Part B** (`parked` classification in
  `inject.AwaitReady`), which is parallel-safe with this change. Part A's obligation
  is that the guard seam is **shared and consumable** so the sentinel types through
  it; if Part B has already merged when this ships, rebase against main and wire its
  sentinel typing through the guard in the same rebase (the Origin's explicit
  instruction). If B is unmerged, B inherits the guard by consuming the engine seam.
- **Guard semantics**: `pane_in_mode` = `1` → issue one cancel, then proceed (no
  re-probe loop; a pane re-entering a mode mid-delivery is the same inherent race
  tmux always has). Probe or cancel failure is an **operational tmux failure**
  (wrapped error → CLI exit 1), consistent with how baseline-capture failures are
  treated — never fail-open.

### 2. Foreground-naming warning on unknown-state plain sends (`cmd/rk/mux_send.go`)

Today's unknown-state branch (`state == ""` in the non-`--force` gate) prints:

```
warning: pane %s has no readable agent state — sending ungated
```

It gains the foreground command name when `pane_current_command` is not a plain
shell. Target behavior:

- The gate's state read moves from `tmux.PaneAgentState` (state-only) to the
  superset `tmux.PaneFactsCtx` it already delegates to — **`PaneFacts` gains a
  `Command` field** (the quadruple read already fetches `#{pane_current_command}`
  for the reconciler and currently discards it; zero extra tmux round trips).
- When state is unknown AND `Command` is a plain shell (the existing
  `shellCommands` set in `internal/tmux/tmux.go`: bash/zsh/fish/sh/dash — reused,
  exported or via a helper, never duplicated), the warning stays as-is.
- When state is unknown AND `Command` is NOT a shell, the warning names it, e.g.:

  ```
  warning: pane %5 has no readable agent state — foreground process `htop` running; sending ungated
  ```

- **Same warn-and-send behavior, no new gate state** (spec: a non-shell foreground
  may be a hook-less agent — exactly the `--force` composition's case). `--force`
  sends are untouched (they skip the state read entirely; the pane-mode guard still
  applies to them — it is a delivery property, not a gate property). Warnings ride
  stderr via the existing `sink.Notef` convention; the one-line stdout report
  contract and the report words are unchanged (spec: report-word contract is frozen).

### 3. Intrinsic inclusions (spec Execution plan clause for CLI-surface parts)

- **Standards audit**: check the changed surface against `shll standards` — at
  minimum `principles` (P9 quiet/stderr posture for the new warning) and
  `help-dump` (machine-readable help contract). Record the audit outcome; update
  `docs/memory/run-kit/toolkit-standards.md` posture at hydrate if the audit adds
  a new checked surface.
- **Help-dump test** (`cmd/rk/help_dump_test.go`): the mux family assertions pin
  exactly 12 members and their names — this change adds no member, so the expected
  delta is help-TEXT only (the `rk mux send` Long documents the guard + warning).
  Verify whether the dump captures long/short text that changes and update
  accordingly; if nothing structural changes, the audit records that no update was
  needed.
- **`rk skill` messaging topic page** (`docs/site/skill/mux.md`): document the
  pane-mode guard (deliveries clear copy-mode first — callers no longer need a
  manual `copy-mode -q` before sending) and the enriched unknown-state warning
  (the gate-matrix row's "warn + send" now names a non-shell foreground). Served
  by `rk skill` per the toolkit `skill` standard.

## Affected Memory

- `run-kit/agent-messaging`: (modify) `rk mux send` requirements — the agent-state
  gate's unknown-state warning gains foreground naming; delivery requirements gain
  the pane-mode guard (probe `#{pane_in_mode}` + cancel before any paste/key/Enter);
  skill-page contract additions.
- `run-kit/agent-send`: (modify) the shared injection engine's sequence gains the
  pane-mode guard step ahead of baseline capture; `inject.Tmux` interface widens;
  daemon routes inherit the guard.
- `run-kit/toolkit-standards`: (modify) audit posture row for the changed
  `rk mux send` surface (help-dump / P9 check outcome).

## Impact

- `app/backend/internal/inject/inject.go` (+ `inject_test.go`) — guard step in
  `Send`/`SendRaw`/`PressEnter`, `Tmux` interface widening, mock updates.
- `app/backend/internal/tmux/` — pane-mode probe + cancel primitives; `PaneFacts.Command`
  field (`pane_target.go`); `shellCommands` reuse surface (`tmux.go`).
- `app/backend/cmd/rk/mux_send.go` (+ `mux_send_test.go`) — `--key` path guard,
  gate read switch to `PaneFactsCtx`, foreground-naming warning, help text.
- Daemon `inject.Tmux` adapter (agent-send cluster, `api/`) — implement the new
  interface methods.
- `app/backend/cmd/rk/help_dump_test.go` — only if the dump pins changed text.
- `docs/site/skill/mux.md` — messaging topic-page updates.
- Tests: `go test ./internal/inject/... ./internal/tmux/... ./cmd/rk/...` scoped
  first; no frontend impact.
- Part B (`260904+ parked classification`, separate change) shares `internal/inject` —
  rebase against main before ship if B merged first.

## Open Questions

- None — the spec fixes the invariants, the payload paths, the warning example, the
  no-new-gate-state rule, and the intrinsic inclusions; remaining choices are
  plan-level mechanics recorded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly spec gaps 1+4 plus the intrinsic inclusions (standards audit, help-dump check, skill page); gap 2 (`parked`) and gap 3 (help grouping) belong to Parts B/C | Spec Execution plan table row A names the deliverables; Origin restates it | S:95 R:90 A:95 D:95 |
| 2 | Confident | The guard lives in `internal/inject` at the engine seam (Send/SendRaw/PressEnter) with the `--key` path and Part B's sentinel consuming the same shared step — never per-call-site copies | Spec Mechanism layer: single-engine invariant, "no exceptions"; matches the existing engine-owns-safety design decisions in agent-send/agent-messaging memory | S:80 R:70 A:85 D:75 |
| 3 | Confident | Mode-cancel needs a dedicated `send-keys -X cancel` primitive in `internal/tmux` (a flag, not a key name — `SendKeysToPane(keys...)` cannot express it); probe reads `#{pane_in_mode}` display-message style | tmux CLI semantics; mirrors existing primitive granularity (`CapturePanePlainCtx` precedent: new call shape = new primitive) | S:75 R:80 A:85 D:80 |
| 4 | Confident | Guard probe/cancel failure is operational (error, exit 1), never fail-open; a `pane_in_mode=1` pane gets ONE cancel then delivery proceeds (no re-probe loop) | Consistent with existing read-failure handling (`read agent state: %w`); re-entry mid-delivery is tmux's inherent race, same acceptance as the cross-process paste race | S:60 R:80 A:75 D:70 |
| 5 | Confident | Foreground naming reuses `PaneFactsCtx` (add `Command` to `PaneFacts` — the read already fetches it) and the existing `shellCommands` set; warning scope is the existing unknown-state warn branch of plain sends only; `--force` stays warning-free but IS pane-mode-guarded | Spec: "a plain send to an uninstrumented pane"; gate vs delivery split — the guard is a delivery property; zero new tmux round trips | S:80 R:85 A:85 D:80 |
| 6 | Confident | Exact warning wording extends the current message (`— foreground process \`htop\` running; sending ungated`), stderr via `sink.Notef`, report words and stdout contract untouched | Spec freezes the report-word contract and gives the phrase fragment; final sentence shape is reversible copy | S:70 R:90 A:80 D:75 |
| 7 | Tentative | Part A does not itself implement sentinel typing (that is B's `AwaitReady` upgrade); A's obligation to "the sentinel probe" path is a consumable shared guard seam + the rebase-time wiring if B lands first | Spec lists the sentinel among guarded paths but ships it in row B; A ∥ B with a declared rebase protocol — ordering is unknowable at intake time <!-- assumed: sentinel-path guard = shared seam now, wire-on-rebase if B merged; B unmerged ⇒ B consumes the seam --> | S:55 R:60 A:45 D:40 |
| 8 | Confident | Help-dump test changes only if the dump pins the changed help text (mux member set stays 12); the intrinsic inclusion is the CHECK, recording "no update needed" is a valid outcome | `help_dump_test.go` pins names/count, not prose (verified); spec's clause mandates the audit, not a mandatory diff | S:75 R:90 A:80 D:80 |

8 assumptions (1 certain, 6 confident, 1 tentative, 0 unresolved).
