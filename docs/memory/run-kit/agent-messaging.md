---
type: memory
description: "The `rk mux` family — tmux-substrate verbs with no daemon dependency. `send`/`await` agent messaging: strict %N/@N/=session:window grammar, payload XOR, the @rk_agent_state gate matrix, shared internal/inject delivery, ask-and-wait composition, one-word reports, exit codes 0/1/2. Plus the operator members `reap`/`snapshot`/`init-conf`/`guard` (old root forms survive as hidden aliases; inherited `-L` rejected on non-messaging members — `guard` excepted: its flags flow into the tmux argv)."
---
# Agent-to-Agent Messaging (`rk mux`)

**Domain**: run-kit

## Overview

`rk mux` is the tmux-substrate CLI family (per `docs/specs/cli-layering.md`):
operations that talk to tmux directly from the caller's context with **no daemon
dependency** (the `rk present` pattern), so they work while `rk serve` is down.
The family has six members in two tiers. The messaging tier is the conversation
loop's halves: `rk mux send` delivers a message into another agent's pane — the
agent→agent counterpart of `rk present`'s agent→user attach — and `rk mux await`
blocks until a peer's state (or a file signal) fires. The operator tier groups
the janitor/recovery/scaffold verbs plus the guard: `rk mux reap` (test-socket
cleanup), `rk mux snapshot list|show|restore` (layout recovery,
[layout-snapshots](/run-kit/layout-snapshots.md)), `rk mux init-conf` (tmux
config scaffold), and `rk mux guard` (fronts the real tmux binary, refusing a
bare `kill-server` — the verb the installed PATH shim execs; full contract in
[tmux-guard-shim](/run-kit/tmux-guard-shim.md)). The messaging verbs are
first-party readers of the
`@rk_agent_state` convention ([agent-state](/run-kit/agent-state.md)) and share
the pane-level primitives in `internal/tmux/pane_target.go`. Delivery reuses the
hardened injection engine the chat-send HTTP route also drives — the shared
`internal/inject` package ([chat](/run-kit/chat.md) § Send Path) — so the daemon
route and the CLI verb run ONE implementation.

The family parent (`muxCmd`, `cmd/rk/mux.go`) carries the shared persistent
`-L/--server` flag (the `fab pane` pattern). Server resolution: `-L` wins, else
the caller's own server derived from the original `$TMUX` socket basename, else
`default`. Only the messaging verbs consume it — the operator members reject an
explicitly-set `-L` (see Requirements), **except `guard`**: its
`DisableFlagParsing` means nothing is parsed and `-L`/`-S` flow verbatim into
the tmux argv, where they are genuinely tmux's socket flags. The old root forms
(`rk reaper`, `rk snapshot …`, `rk init-conf`) survive as hidden deprecation
aliases that run byte-identically while printing cobra's deprecation pointer;
`rk tmux-guard` survives as a PERMANENT hidden root alias (never warns, never
removed — installed shims exec the literal name).

## Requirements

### Requirement: Strict target grammar and agent-pane resolution
Both verbs SHALL accept exactly three `<target>` forms — pane ID (`%N`), window
ID (`@N`), and exact session:window (`=session:window`) — rejecting everything
else as a usage error (exit 2) naming the accepted forms
(`tmux.ParsePaneTarget`). Bare `session:window` names are rejected: tmux's
target grammar resolves a bare name against window names before session names,
so a window named like a session would hijack the target (the `=` prefix forces
exact-match parsing). Window forms resolve server-side to the window's **agent
pane** (`tmux.ResolveAgentPane` / the pure `SelectAgentPane`): the pane carrying
a known post-reconcile `@rk_agent_state` — preferring the active pane when
several qualify — falling back to the window's active pane (the
`resolveWindowChat` precedent: a window target must route to the agent pane, not
whatever split happens to be active).

#### Scenario: Window target routes to the agent pane
- **GIVEN** `rk mux send mysession:win "hi"` (a bare name)
- **WHEN** the target parses
- **THEN** it is a usage error (exit 2) naming `%N`, `@N`, and
  `=session:window`; **AND GIVEN** `@3` whose pane `%7` carries
  `@rk_agent_state`, **THEN** delivery targets `%7`.

### Requirement: `rk mux send` payload forms (XOR)
`rk mux send` SHALL take exactly one payload kind — a positional `<message>`,
the literal `-` (read the message from stdin, the `fab dispatch start`
precedent; bracketed paste delivers multi-line text as one block), or
one-or-more repeatable `--key <name>` flags (tmux key names: `Enter`, `Up`,
`C-c`, …). Zero payloads or mixed kinds is a usage error (exit 2). Text payloads
are sanitized at the CLI boundary via `inject.Sanitize` — the same helper the
chat-send handler runs — and an all-whitespace post-sanitize message is a usage
error. `--key` sends are post-gate raw `send-keys` key names — no paste, no
probe (key names have no echo to probe) — closing the raw-tmux carve-out that
key input otherwise forces on callers.

#### Scenario: Multi-line stdin arrives as one paste
- **GIVEN** `rk mux send %5 -` with a multi-line heredoc on stdin
- **WHEN** the send runs
- **THEN** the full text lands as one bracketed paste; **AND GIVEN** both a
  positional message and `--key`, **THEN** usage error.

### Requirement: The agent-state gate
Before any delivery `rk mux send` SHALL read the target pane's reconciled
`@rk_agent_state` (`tmux.PaneAgentState` — the same parse + pid-liveness
reconcile the sessions path applies; a legacy two-segment or dead-pid value
reads as unknown, never partial trust) and apply fab-kit's `idleGate` matrix
verbatim:

| State | plain | `--answer` |
|-------|-------|------------|
| unknown (absent/unparseable/reconciled-away) | warn to stderr + send | warn + send |
| `idle` | send | send |
| `waiting` | refuse | send (this send IS the answer it waits for) |
| `active` | refuse | refuse (never interrupt a working agent unattended) |

Refusals SHALL name the state, print to stderr, and exit 1. `--force` skips the
gate but still validates target existence. `--answer` and `--force` are mutually
exclusive via cobra `MarkFlagsMutuallyExclusive` — a usage error (exit 2), not
silent force-wins precedence.

#### Scenario: Refusal names the state
- **GIVEN** a pane with `@rk_agent_state=active:…`
- **WHEN** `rk mux send %5 "x" --answer` runs
- **THEN** it refuses naming `active`, exits 1, and performs no tmux mutation.

### Requirement: Delivery through the shared injection engine
Text payloads SHALL be delivered through `internal/inject` — the engine the
chat-send HTTP handler also consumes ([chat](/run-kit/chat.md) § Send Path):
baseline capture → named-buffer `set-buffer -b <name> -- <text>` → bracketed
`paste-buffer -d -p` → NOVELTY echo probe → probe-gated Enter. The CLI drives it
through the four-method `inject.Tmux` interface over `internal/tmux`'s
name-parameterized buffer primitives (`SetBufferCtx`/`PasteBufferCtx`/
`CapturePaneCtx`/`SendEnterToPaneCtx`), with a **per-invocation buffer name**
`rk-send-<pid>` so a CLI send can never clobber a concurrent daemon send's
`rk-chat-send` buffer. `--no-enter` skips only the Enter — the probed text stays
staged in the composer. A probe failure (`inject.ProbeFailure`) sends no Enter,
prints the recoverable-state message (the text remains staged; a resend would
duplicate it) to stderr, and exits 1 — the chat-send 409's CLI analog.

#### Scenario: Permission-dialog pane fails closed
- **GIVEN** a pane showing a permission dialog (the paste never echoes)
- **WHEN** the probe exhausts
- **THEN** no Enter is sent, stderr carries the staged-text warning, and the
  exit is 1.

### Requirement: One-line stdout report contract; toolkit exit codes
`rk mux send` SHALL print exactly one report line to stdout: `delivered %N`
(probe-confirmed submit), `staged %N` (`--no-enter`), `sent %N` (`--key`
sends), or the await report word as the final line when `--await` is used.
Diagnostics and warnings go to stderr (chatter honors `--quiet` via the
`outputSink` convention; the report line is data). Exit codes follow the toolkit
convention: **0** success, **1** operational failure (gate refusal, probe
failure, missing target, tmux failure), **2** usage — never fab's pane-family
2/3 scheme.

### Requirement: `rk mux await` observer
`rk mux await <target> [--until <state>[,<state>]] [--file <path>]
[--after-active] [--timeout <secs>] [--notify[=msg]]` SHALL block until any
waitable signal fires, then print a one-word report and exit:

- a state in the `--until` set (default `idle`) was reached → report that state,
  exit 0 (`waiting` in the set reports `waiting` — the conversational wake)
- the `--file` path appeared (OR-composed) → `file`, exit 0
- `--timeout` (default 300s; 0 = indefinite) expired → `running`, exit 0 — the
  timeout bounds the OBSERVER, never the pane
- the pane died mid-wait → `gone` on stdout, **exit 1** (toolkit
  operational-failure convention)

Contract details: the first check runs before any sleep (an already-fired
signal returns immediately); the file signal is checked before the state read so
a fired signal wins over a mid-tick pane death; the internal poll tick is ~2s
(not configurable); an uninstrumented pane (no `@rk_agent_state`) with no
`--file` errors immediately — nothing observable to wait on; `--after-active`
requires observing `active` at least once before an `--until` state counts (the
composable fix for the stale-state race when awaiting a pane that was just sent
to outside `rk mux send --await`); `--notify[=msg]` sends a fail-silent Web Push
via the existing `rk notify` path when a signal fires (default message
`agent <target> is <report>`). The observer loop rides the caller's parent
context with only per-read timeouts (`awaitCmdTimeout` 5s) on individual tmux
reads, so a wait can outlive any single read by minutes.

#### Scenario: Already-fired signal returns immediately
- **GIVEN** an already-idle instrumented pane
- **WHEN** `rk mux await %5` runs
- **THEN** `idle` prints with no sleep; **AND GIVEN** `--after-active` on that
  same pane, **THEN** the observer keeps waiting until an active→idle
  round-trip is seen.

### Requirement: Composed ask-and-wait (`rk mux send --await`)
`--await[=<states>]` (default `idle,waiting`) SHALL, after a successful submit,
first watch for the pane's state to flip to `active` under a bounded grace
(`sendAwaitActiveGrace`, ~10s) and only then run the await observer with the
requested state set, printing the await report word as stdout's single final
line. The grace watch closes the stale-state race — a bare await fired
immediately after a send would otherwise return instantly on the peer's
*pre-send* `idle`. Two grace outcomes fall through to the await rather than
ending the composition: grace expiry (`running` — hooks may lag, or the peer
finished within the grace) and the uninstrumented verdict (the pane carries no
`@rk_agent_state`; the delivery already happened, and the await phase re-applies
the uninstrumented rule itself in case state appeared in the meantime). A `gone`
verdict propagates as the final report (stdout) with exit 1. `--await` with
`--no-enter` is a usage error (nothing was submitted to wait on). `--timeout`
bounds the await phase (observer only); the one-shot delivery phase runs under
its own 5s `muxCmdTimeout` while the await rides the parent context, so the
full `--timeout` is reachable.

#### Scenario: Ask-and-wait in one call
- **GIVEN** `rk mux send %5 "question" --await --timeout 120`
- **WHEN** the peer answers within budget
- **THEN** stdout ends with `waiting %5` or `idle %5`; **WHEN** not, **THEN**
  `running %5`, exit 0.

### Requirement: No daemon dependency; bounded subprocesses
Both verbs SHALL address tmux directly from the caller's context (`-L <server>`
or the `$TMUX`-derived socket basename — the `rk present` pattern), so
agent-to-agent messaging works while `rk serve` is down. Every subprocess is an
`exec.CommandContext` argv slice under a bounded context (5s per tmux operation,
Constitution §I); the verbs hold no state beyond the invocation (Constitution
§II).

### Requirement: Operator members reject an explicit inherited `-L`; old root forms are deprecation aliases
The operator members (`reap`, `snapshot list|show|restore`, `init-conf`) do not
consume the mux parent's persistent `-L/--server` flag; each SHALL return a usage
error (exit 2) naming `--server` when the inherited flag was explicitly set
(e.g. `rk mux -L foo reap`), rather than silently ignoring it. **`guard` is
exempt**: `DisableFlagParsing` means no flag is ever parsed on it, so `-L` flows
verbatim into the tmux argv (it is genuinely tmux's socket flag there) and
`muxRejectInheritedServerFlag` is never called — the pinned invariant is no
silent retarget. The old root forms
`rk reaper`, `rk snapshot …`, and `rk init-conf` SHALL remain functional as
hidden deprecation aliases — each carries `Hidden: true` plus a cobra
`Deprecated` pointer (on the alias's executed command, including the snapshot
alias's children), prints the pointer to stderr, and runs with identical flags,
output, and exit codes. Unlike `agent-hook`/`tmux-guard`, these aliases are NOT
permanent: they are human-typed verbs, so they are removable in a future release
(cli-layering.md delegation rule 3 does not apply).

#### Scenario: An explicit `-L` on a non-messaging member is refused
- **GIVEN** `rk mux -L foo reap`
- **WHEN** the command runs
- **THEN** it exits 2 with a usage error naming `--server`, and nothing is
  reaped; **AND GIVEN** `rk reaper --yes`, **THEN** it reaps exactly as before
  with a deprecation pointer on stderr

## Design Decisions

### Engine package named `internal/inject`
**Decision**: The shared pane-injection engine lives in `internal/inject` behind a
four-method `Tmux` interface (capture / set-buffer / paste-buffer / send-Enter,
context-bound), with the buffer name as an engine parameter — the daemon passes
`rk-chat-send`, the CLI its per-invocation `rk-send-<pid>`.
**Why**: mechanics-named like `internal/present`; "chat" does not describe an
engine the CLI consumes alongside the daemon route, and the interface keeps both
consumers testable without a live tmux.
**Rejected**: `internal/agentsend` (couples the name to one consumer).
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### CLI probe failure = staged text + stderr + exit 1
**Decision**: A failed echo probe on the CLI path sends no Enter, leaves the
text staged in the composer, prints the retry-hinted message (a resend would
duplicate) to stderr, and exits 1 — the chat-send 409's CLI analog.
**Why**: strictly better than a blind Enter; the failure must be visible to
scripts, and the message steers away from a duplicating resend.
**Rejected**: exit 0 with a `staged` report (hides the failure from scripts).
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### `--await` grace expiry falls through to the await
**Decision**: When the post-submit active-flip watch expires without observing
`active` (or the pane proves uninstrumented), the composition falls through to
the await observer rather than erroring.
**Why**: hooks may lag or the peer may finish within the grace window; erroring
would flake. The grace closes the stale-state race as well as it can, then the
await's own contract takes over.
**Rejected**: hard error on no active flip.
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### Strict target grammar — no bare `session:window`
**Decision**: Only `%N`, `@N`, and `=session:window` are accepted; bare
`session:window` names are a usage error.
**Why**: tmux's target grammar resolves bare names against window names before
session names, so a window named like a session hijacks the target — a
documented footgun the `=` prefix (exact-match parsing) eliminates.
**Rejected**: accepting bare names with tmux's default resolution (silent
mis-targeting in exactly the multi-session setups the verbs serve).
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### Toolkit exit codes and one-word report words, not fab's pane-family scheme
**Decision**: Both verbs use the toolkit convention (0 success, 1 operational,
2 usage); `await`'s `gone` reports on stdout with exit 1, and the report word —
not the exit code — discriminates await outcomes.
**Why**: toolkit standards bind rk's CLI surface; one-word stdout reports keep
agent parsing simple, and no fab-kit consumer branches on the old verbs' 2/3
codes.
**Rejected**: fab's pane-family 2/3 exit scheme (diverges from every other rk
verb).
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### Per-invocation CLI buffer name (`rk-send-<pid>`)
**Decision**: The CLI sends through a per-invocation named buffer while the
daemon keeps its single shared `rk-chat-send` buffer plus its in-process
per-pane locks.
**Why**: a CLI send must never clobber a concurrent daemon send's buffer —
distinct buffer owners need no cross-process guard; the same-pane cross-process
paste race that remains is inherent to tmux and rare.
**Rejected**: sharing `rk-chat-send` from the CLI (the single-writer assumption
breaks across processes).
*Introduced by*: `260815-a5vf-rk-send-await-agent-messaging`

### Two-instance constructor per moved command
**Decision**: Each command moved under `mux` is built by a
`newXxxCmd(use string, deprecated bool)`-style constructor producing both the
family member and the hidden root alias, with flag vars closure-bound per
instance.
**Why**: cobra commands have exactly one parent; the pattern is proven in this
package by `newAgentSetupCmd`; package-level flag vars would silently share
state across instances.
**Rejected**: cobra `Aliases` field (same-parent only); a delegating stub RunE
(duplicates flag definitions anyway, loses help parity).
*Introduced by*: `260815-lsgf-mux-consolidation-low-risk`

### Reject explicitly-set `-L` on non-messaging members
**Decision**: reap/snapshot/init-conf under `mux` error (usage, exit 2) when the
inherited `--server` flag was explicitly set. The `guard` member is exempt —
`DisableFlagParsing` means `-L` is never parsed and flows verbatim into the tmux
argv, so there is nothing to reject (see
[tmux-guard-shim](/run-kit/tmux-guard-shim.md) § Design Decisions).
**Why**: toolkit Principle 1/9 posture — `rk mux -L foo reap` silently ignoring
`-L` is a success-looking misinterpretation (user believes the reap is
server-scoped).
**Rejected**: silently ignoring the flag (footgun); plumbing `-L` semantics into
the moved commands (new behavior, out of scope of the consolidation).
*Introduced by*: `260815-lsgf-mux-consolidation-low-risk`
