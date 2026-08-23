---
type: memory
description: "The `rk mux` family — 11 tmux-substrate verbs, no daemon dependency. Pane-scoped members (`send`/`await` messaging + `capture`/`kill`/`process` substrate twins) share the strict %N/@N/=session:window grammar and with `panes` consume inherited `-L`; `await --any` wakes on the first of N panes. Operator members `new`/`reap`/`snapshot`/`init-conf`/`guard` reject `-L` (`guard` excepted): `new` spawns a detached server (`--ephemeral` marks `@rk_ephemeral`); `reap` sweeps those under `--ephemeral`."
---
# Agent-to-Agent Messaging (`rk mux`)

**Domain**: run-kit

## Overview

`rk mux` is the tmux-substrate CLI family (per `docs/specs/cli-layering.md`):
operations that talk to tmux directly from the caller's context with **no daemon
dependency** (the `rk present` pattern), so they work while `rk serve` is down.
The family has eleven members. The messaging pair is the conversation loop's
halves: `rk mux send` delivers a message into another agent's pane — the
agent→agent counterpart of `rk present`'s agent→user attach — and `rk mux await`
blocks until a peer's state (or a file signal) fires — under `--any`, until the
FIRST of several panes fires. The substrate twins are
the generic pane-mechanics verbs: `rk mux capture` (scrollback capture with
substrate-only enrichment), `rk mux kill` (agent-state-gated pane removal), and
`rk mux process` (the pane's process tree with agent classification). `rk mux
panes` is the whole-server enumeration query — one row per pane across all
sessions, substrate facts only (no change/stage; choreography enrichment stays
the fab layer's), the family's only server-scoped enumeration (no target
argument). The
operator tier groups the create verb, the janitor/recovery/scaffold verbs, and
the guard: `rk mux new` (detached server creation on a named socket — the
family's create verb; `--ephemeral` marks the new server `@rk_ephemeral`
before return), `rk mux reap` (test-socket and scratch-server cleanup — a prefix sweep,
unioned with every live `@rk_ephemeral`-marked server under `--ephemeral`;
full contract in [tmux-sessions](/run-kit/tmux-sessions.md) § `rk mux reap`), `rk mux snapshot list|show|restore`
(layout recovery, [layout-snapshots](/run-kit/layout-snapshots.md)),
`rk mux init-conf` (scaffolds the rk-managed tmux.conf and the
`tmux.d/user.conf` override starter under `~/.config/run-kit/`), and `rk mux guard` (fronts the real
tmux binary, refusing a bare `kill-server` — the verb the installed PATH shim
execs; full contract in [tmux-guard-shim](/run-kit/tmux-guard-shim.md)). The
pane-scoped verbs (send/await/capture/kill/process) are first-party readers of
the `@rk_agent_state` convention ([agent-state](/run-kit/agent-state.md)) and
share the pane-level primitives in `internal/tmux/pane_target.go`. Delivery
reuses the hardened injection engine the chat-send HTTP route also drives — the
shared `internal/inject` package ([chat](/run-kit/chat.md) § Send Path) — so the
daemon route and the CLI verb run ONE implementation.

The family parent (`muxCmd`, `cmd/rk/mux.go`) carries the shared persistent
`-L/--server` flag (the `fab pane` pattern). Server resolution: `-L` wins, else
the caller's own server derived from the original `$TMUX` socket basename, else
`default`. Only the pane-scoped verbs and the `panes` enumeration consume it —
the operator members reject
an explicitly-set `-L` (see Requirements), **except `guard`**: its
`DisableFlagParsing` means nothing is parsed and `-L`/`-S` flow verbatim into
the tmux argv, where they are genuinely tmux's socket flags. The old root forms
(`rk reaper`, `rk snapshot …`, `rk init-conf`) survive as hidden deprecation
aliases that run byte-identically while printing cobra's deprecation pointer;
`rk tmux-guard` survives as a PERMANENT hidden root alias (never warns, never
removed — installed shims exec the literal name).

## Requirements

### Requirement: Strict target grammar and agent-pane resolution
The pane-scoped verbs (send/await/capture/kill/process) SHALL accept exactly
three `<target>` forms — pane ID (`%N`), window
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
2/3 scheme. The same code convention binds the substrate twins: a missing pane
is operational (1), a bad target or flag combination is usage (2).

### Requirement: `rk mux await` observer
`rk mux await [--any] <target>... [--until <state>[,<state>]] [--file <path>]
[--after-active] [--timeout <secs>] [--notify[=msg]]` SHALL block until any
waitable signal fires, then print a one-line report and exit. Without `--any`
exactly one target is required; with `--any` one-or-more targets are accepted —
each uses the strict grammar and is resolved to a pane ID up front via
`resolvePaneTarget`, before the wait begins, all on the one resolved `-L`
server — and two targets resolving to the same pane ID are a usage error (exit
2). The observer wakes on the FIRST signal:

- a state in the `--until` set (default `idle`) was reached → report that state,
  exit 0 (`waiting` in the set reports `waiting` — the conversational wake);
  under `--any` the firing pane is appended (`waiting %5`)
- the `--file` path appeared (OR-composed) → `file`, exit 0 (bare — no pane)
- `--timeout` (default 300s; 0 = indefinite) expired → `running`, exit 0 — the
  timeout bounds the OBSERVER, never the pane (bare — no pane)
- the pane died mid-wait → `gone` on stdout, **exit 1** (toolkit
  operational-failure convention); under `--any` the FIRST dead target is named
  (`gone %N`) and wakes the whole wait — armed panes get immediate death
  detection

The report word stays the first stdout token in both modes, so first-token
parsers keep working. Contract details: the first check runs before any sleep
(an already-fired signal returns immediately); the file signal is checked before
the state reads so a fired signal wins over a mid-sweep pane death; the internal
poll tick is ~2s (not configurable); under `--any` each sweep reads the target
panes in listed order and the first `--until` match wins, while a death is
recorded but the sweep continues — a state signal found later in the same sweep
is reported instead of the death; an uninstrumented pane (no `@rk_agent_state`)
with no `--file` errors immediately — nothing observable to wait on — under
`--any` failing the whole arm on the first sweep, naming the offending pane;
`--after-active` requires observing `active` at least once before an `--until`
state counts (the composable fix for the stale-state race when awaiting a pane
that was just sent to outside `rk mux send --await`) and is tracked PER PANE
under `--any` — one pane's activity never unlocks another's; `--notify[=msg]`
sends a fail-silent Web Push via the existing `rk notify` path when a signal
fires (default message `agent <target> is <report>`; under `--any`,
`agent %N is <state>` when a pane fired — including `agent %N is gone` — and
`await --any is <report>` for `file`/`running`). The observer loop rides the
caller's parent context with only per-read timeouts (`awaitCmdTimeout` 5s) on
individual tmux reads, so a wait can outlive any single read by minutes.

The fleet-wake protocol monitoring agents build on (rk guarantee vs caller
obligation): (a) the CALLER arms only against not-currently-waiting panes — rk
does not filter already-waiting targets; an already-fired `--until` state
returns immediately by design, so a level-triggered re-arm against a
still-waiting pane would busy-loop; (b) the first-sweep-before-sleep property
closes the arm gap — a state that changed between the caller's last read and
the arm fires immediately (rk guarantee); (c) the CALLER re-arms after
resume/`/clear` — awaits are foreground children of the caller; (d) the CALLER
kills and re-arms when the target set changes — the `gone %N` wake plus
duplicate-target rejection make stale sets self-announcing; (e) the CALLER
debounces re-arms against waiting↔active flap — one invocation wakes once, so
inter-wake spacing is the re-armer's property.

#### Scenario: Already-fired signal returns immediately
- **GIVEN** an already-idle instrumented pane
- **WHEN** `rk mux await %5` runs
- **THEN** `idle` prints with no sleep; **AND GIVEN** `--after-active` on that
  same pane, **THEN** the observer keeps waiting until an active→idle
  round-trip is seen.

#### Scenario: Any-of wake names the firing pane
- **GIVEN** `rk mux await --any %1 %5 --until waiting,idle` with `%1` active
  and `%5` already idle
- **WHEN** the first sweep runs
- **THEN** `idle %5` prints with no sleep, exit 0; **AND GIVEN** `%1` dies
  mid-wait with no signal firing that sweep, **THEN** `gone %1`, exit 1;
  **AND GIVEN** two targets resolving to the same pane ID, **THEN** usage
  error, exit 2.

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

### Requirement: `rk mux capture` — plain scrollback with substrate-only enrichment
`rk mux capture <target> [-l/--lines <N>] [--json | --raw]` SHALL capture the
last N lines of the resolved pane's scrollback as **plain text — no `-e` ANSI
escapes** — via `tmux.CapturePanePlainCtx` (the `-e` `CapturePaneCtx` variant
stays untouched for the chat echo probe), never trimming the content. `--lines`
defaults to 50; `< 1` is a usage error. `--json` and `--raw` are mutually
exclusive via `MarkFlagsMutuallyExclusive`; `--raw` prints the captured text
only, byte-identical to tmux's output. The default human output is the header
block `--- pane %5 ---` / context line / `---` / content; the context line joins
only the parts that resolved (` | `-separated) and is omitted entirely when
empty. Enrichment is **substrate-only**: the pane's cwd (`#{pane_current_path}`)
and the **reconciled** agent state, both read in one `display-message` round
trip by `tmux.PaneFactsCtx` (the parse + pid-liveness reconcile shared with
`PaneAgentState`; a legacy or dead-pid value reads as unknown) — fab's
change/stage fields are NOT carried (choreography facts, fab's layer). The
duration shows for `idle` **and** `waiting` (epoch > 0), never `active`,
formatted floor `Ns`/`Nm`/`Nh` via `sessions.FormatAgentDuration` (the
`rollupAgentState` semantics). `--json` emits (two-space-indented):
`{"pane", "lines", "content", "cwd", "agent_state", "agent_state_duration"}`
with the agent fields `null` when the pane is uninstrumented. A missing pane or
tmux failure is operational (exit 1) carrying tmux's stderr diagnostic.

#### Scenario: Reconciled state with duration, no choreography fields
- **GIVEN** a pane whose `@rk_agent_state` is `waiting:<epoch 2m ago>:<live-pid>`
- **WHEN** `rk mux capture %5` runs
- **THEN** the context line contains `agent: waiting (2m)` and no
  `change:`/`stage:` parts; **AND GIVEN** a dead-pid value, **THEN** no
  `agent:` part appears (reconciled to unknown).

### Requirement: `rk mux kill` — agent-state-gated pane removal
`rk mux kill <target> [--force]` SHALL read the resolved pane's reconciled
`@rk_agent_state` before killing and apply the gate matrix:

| State | plain | `--force` |
|-------|-------|-----------|
| `active` | refuse | kill |
| `waiting` | refuse (a pending human question lives there) | kill |
| `idle` | kill | kill |
| unknown (absent/unparseable/reconciled-away) | kill | kill |

Refusals SHALL name the state, print to stderr, exit 1, and perform no tmux
mutation. `--force` skips the gate but still validates target existence
(`tmux.PaneExists`). The kill runs through `tmux.KillPaneCtx` (`kill-pane -t
%N`) — unlike the best-effort `KillActivePane`, a tmux failure IS returned so
the verb can surface tmux's stderr. On success stdout carries exactly one
report line: `killed %N`. A missing pane or tmux kill failure is operational
(exit 1).

#### Scenario: Refusal names the state and touches nothing
- **GIVEN** a pane with `@rk_agent_state=active:<epoch>:<live-pid>`
- **WHEN** `rk mux kill %5` runs
- **THEN** it refuses naming `active`, exits 1, and the pane survives; **AND
  WHEN** `rk mux kill %5 --force` runs, **THEN** the pane is killed and stdout
  is `killed %5`.

### Requirement: `rk mux process` — process tree with agent-state pid cross-check
`rk mux process <target> [--json]` SHALL resolve the pane's shell PID
(`#{pane_pid}` via `tmux.PanePIDCtx`) and discover its process tree — **linux**:
a `/proc` walk (`comm`, NUL-joined `cmdline`, children via
`/proc/<pid>/task/<tid>/children`, unreadable children skipped); **darwin**: a
two-pass `ps` (one `pid,ppid,comm -ax` enumeration plus one `pid=,args=` cmdline
pass joined by PID — TOCTOU-free; a PID missing from the cmdline pass degrades
to `""`), with the pure `parsePSCmdlines` parser in an un-tagged file so it
unit-tests on every platform. Classification by lowercased comm: `agent` for
`claude`, `claude-code`, `codex`, `gemini`, `copilot`; `node` for `node`;
`git` for `git`/`gh`; else `other`. Additionally, when the pane's reconciled
`@rk_agent_state` carries a live pid (3-segment value), the tree node with that
PID SHALL be classified `agent` regardless of comm — the instrumentation is
authoritative, comm heuristics are fallback; a failed state read degrades to
comm-only with a stderr warning. `has_agent` is true iff any node classifies
`agent` by either route. Human output: `Pane %5 (PID 1234)` plus indented
`PID comm [class]` lines (the tag omitted for `other`) plus a trailing
`Agent process detected.` when `has_agent`. `--json` emits (two-space-indented):
`{"pane", "pane_pid", "processes": [{pid, ppid, comm, cmdline, classification,
children}], "has_agent"}`.

#### Scenario: Instrumented agent behind a wrapper comm
- **GIVEN** an agent launched through a wrapper whose comm is `my-wrapper`, with
  `@rk_agent_state=active:<epoch>:<that-pid>`
- **WHEN** `rk mux process %5` runs
- **THEN** that node is tagged `[agent]` and `Agent process detected.` prints.

### Requirement: `rk mux panes` — whole-server enumeration, substrate facts only
`rk mux panes [--json]` SHALL enumerate every pane of every session on the
resolved server — one row per pane, with **no positional target** (an
enumeration query, not a pane-scoped verb; a stray argument is usage, exit 2).
It consumes the family's inherited `-L/--server` with the standard resolution
order (`-L` wins → the caller's `$TMUX` socket basename → `default`) and, being
a query against a server, does NOT call `muxRejectInheritedServerFlag`.
Enumeration reuses `tmux.ListSessions` + `tmux.ListWindows` (whose panes already
carry the reconciled `@rk_agent_state`) through the `parseSessions` chokepoint,
so `_rk-pin-*` pin-sessions and the `_rk-ctl` anchor contribute no rows and a
pinned window lists exactly once, via its home session. Rows carry **substrate
facts only** — no change/stage/display-state keys (choreography enrichment is
the fab layer's job, per cli-layering Part 8). The default output is an aligned
one-pane-per-row table (session, window `index:name`, pane ID, active markers,
agent state + duration, command, cwd) on stdout; diagnostics go to stderr.
`--json` emits a two-space-indented array, one object per pane, with exactly
`session`, `session_id`, `window_index`, `window_id`, `window_name`,
`window_active`, `pane`, `pane_index`, `pane_active`, `command`, `cwd`,
`agent_state`, `agent_state_duration`; the agent fields are `null` when the pane
is uninstrumented or the reconciler rejects the value (the `mux capture --json`
semantics), and the duration appears only for `idle`/`waiting` (epoch > 0),
never `active`, formatted via `sessions.FormatAgentDuration`. Exit codes follow
the toolkit convention: **0** success — including an alive server with nothing
to list (`[]` under `--json`; an empty enumeration is liveness-probed via
`tmux.ServerAlive` to separate "alive, empty" from "no server"); **1**
operational (no server on the resolved socket, tmux failure) carrying tmux's
diagnostic on stderr; **2** usage.

#### Scenario: Empty enumeration succeeds; a dead socket is operational
- **GIVEN** an alive server with no sessions
- **WHEN** `rk mux panes --json` runs
- **THEN** it prints `[]` and exits 0; **AND GIVEN** no server on socket
  `nope`, **WHEN** `rk mux panes -L nope` runs, **THEN** exit is 1 with tmux's
  diagnostic on stderr; **AND GIVEN** a stray positional argument, **THEN**
  exit 2.

### Requirement: `rk mux new` — validated detached server creation
`rk mux new <name> [--ephemeral]` SHALL create a detached tmux server on
socket `<name>` with a single session named `<name>`, reusing
`tmux.CreateSession(name, "", name)` — the same server-birth path the
create-server API flow uses (env sanitization via `CleanEnvForServer`, CWD
anchored to `ServerBirthDir`; [tmux-sessions](/run-kit/tmux-sessions.md)).
`<name>` SHALL be validated via `validate.ValidateServerName` before any
subprocess; an invalid name is a usage error (exit 2) naming the allowed
character set. The socket SHALL be probed first (`tmux.ServerAlive`): a live
server refuses with exit 1 (operational) stating the server is already
running, performing no tmux mutation; a dead/stale socket proceeds —
`new-session` starts a fresh server over it. On success stdout carries
exactly one report line: `created <name>`; diagnostics ride stderr. `new` is
an operator-tier member — the socket name is its positional argument — so it
rejects an explicitly-set inherited `-L/--server` via
`muxRejectInheritedServerFlag` (usage error, exit 2), takes exactly one
positional (stray/missing args are usage errors), and follows the toolkit
exit-code convention (0 success / 1 operational / 2 usage).

`--ephemeral` SHALL set `@rk_ephemeral 1` (const `tmux.EphemeralOption`)
server-scoped on the new server via `tmux.MarkServerEphemeral` (mirroring
`SetServerOrigin`: `set-option -s` under the `TmuxTimeout` bound) immediately
after creation, before the command returns. If the mark fails after a
successful create, the command SHALL best-effort `tmux.KillServer` the
just-created server and exit 1 — a `--ephemeral` invocation never leaves an
unmarked server behind.

#### Scenario: Collision refusal touches nothing; `--ephemeral` reads back
- **GIVEN** a live server on socket `busy`
- **WHEN** `rk mux new busy` runs
- **THEN** it exits 1 naming `busy` as already running, and the existing
  server is untouched; **AND GIVEN** `rk mux new scratch --ephemeral`,
  **THEN** `tmux.IsEphemeralServer(ctx, "scratch")` reads `true` after
  return, and a failed mark kills the fresh server with exit 1.

### Requirement: `rk mux init-conf` — managed tmux.conf scaffold
`rk mux init-conf [--force]` SHALL write the rk-managed tmux.conf to
`~/.config/run-kit/tmux.conf` through the shared managed write path
(`tmux.ForceWriteConfig` — the hash-stamped header + embed body; see
[configuration](/run-kit/configuration.md) § Managed tmux.conf), ensure the
`tmux.d/` drop-in dir, and scaffold `tmux.d/user.conf` as a commented starter
when absent — an existing `user.conf` is never overwritten, including under
`--force`. Without `--force`, an existing managed file is an error carrying
the recipe (put overrides in `tmux.d/user.conf`, or use `--force` to refresh
the managed file); `--force` is scoped to the managed file — tmux.d contents
are untouched. Success output names the managed path (rk-managed, do not
edit) and `user.conf` as the override home. Both cobra instances (the family
member and the hidden root alias) ride the same RunE core and the shared
write path; `POST /api/tmux/init-conf` rides the same `ForceWriteConfig`.

#### Scenario: --force refreshes the managed file only
- **GIVEN** an existing managed tmux.conf and a customized `tmux.d/user.conf`
- **WHEN** `rk mux init-conf --force` runs
- **THEN** the managed file is rewritten with the current embed and
  `user.conf` is byte-identical to before; **AND GIVEN** no `--force` with an
  existing managed file, **THEN** the error names `tmux.d/user.conf` for
  overrides and `--force` for refreshing the managed file.

### Requirement: No daemon dependency; bounded subprocesses
The pane-scoped verbs SHALL address tmux directly from the caller's context
(`-L <server>`
or the `$TMUX`-derived socket basename — the `rk present` pattern), so
agent-to-agent messaging works while `rk serve` is down. Every subprocess is an
`exec.CommandContext` argv slice under a bounded context (5s per tmux operation,
Constitution §I); the verbs hold no state beyond the invocation (Constitution
§II).

### Requirement: Operator members reject an explicit inherited `-L`; old root forms are deprecation aliases
The operator members (`new`, `reap`, `snapshot list|show|restore`, `init-conf`) do not
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

#### Scenario: An explicit `-L` on an operator member is refused
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
**Decision**: The pane-scoped verbs use the toolkit convention (0 success, 1
operational,
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

### Reject explicitly-set `-L` on operator members
**Decision**: new/reap/snapshot/init-conf under `mux` error (usage, exit 2) when the
inherited `--server` flag was explicitly set; the five pane-scoped verbs
(send/await/capture/kill/process) and the `panes` enumeration consume it. The
`guard` member is exempt —
`DisableFlagParsing` means `-L` is never parsed and flows verbatim into the tmux
argv, so there is nothing to reject (see
[tmux-guard-shim](/run-kit/tmux-guard-shim.md) § Design Decisions).
**Why**: toolkit Principle 1/9 posture — `rk mux -L foo reap` silently ignoring
`-L` is a success-looking misinterpretation (user believes the reap is
server-scoped).
**Rejected**: silently ignoring the flag (footgun); plumbing `-L` semantics into
the moved commands (new behavior, out of scope of the consolidation).
*Introduced by*: `260815-lsgf-mux-consolidation-low-risk`

### Kill gate refuses active AND waiting
**Decision**: `rk mux kill` refuses `active` and `waiting` panes without
`--force`; `idle`/unknown kill.
**Why**: the send gate's never-interrupt posture applied to destruction — a
waiting pane holds a pending human question; killing it silently loses that.
`--force` keeps the operator path one flag away.
**Rejected**: fab's ungated twin (rk owns the state convention — its verbs
should be first-party readers); gating only `active` (waiting loss is the
subtler footgun).
*Introduced by*: `260815-82w7-mux-substrate-twins`

### Capture enrichment is substrate-only
**Decision**: capture carries cwd + reconciled agent state/duration; fab's
change/stage fields are dropped. The decision governs the **CLI substrate
verbs** — the cross-tool substrate surface — and stands. It does not bar the
SERVER's own fab-tier read: the dashboard's L2 register derivation
(`.fab-status.yaml` → `.status.yaml`; see
[tmux-sessions](/run-kit/tmux-sessions.md) § Fab-Tier Derivation) is the
sanctioned Constitution II request-time derivation — a different consumer with
a different contract.
**Why**: cli-layering delegation rule 1 — change/stage come from
`.fab-status.yaml`, fab's layer; rk's CLI must not reimplement the read for its
substrate output. The two consumers differ: CLI verbs are the cross-tool
substrate surface, while the server's dashboard registers are constitutionally
derived from the filesystem.
**Rejected**: shelling out to `fab pane capture` for the join (inverts the
dependency); porting the `.fab-status.yaml` parse into the CLI verbs
(reimplements fab's layer); reading this decision as banning any rk read of fab
artifacts (contradicts Constitution II and status-pyramid.md).
*Introduced by*: `260815-82w7-mux-substrate-twins`; scope pinned by
`260820-hol4-mux-panes-native-pane-map`

### `panes` enumerates the `parseSessions`-filtered view
**Decision**: `rk mux panes` lists the same filtered view the dashboard shows —
`_rk-pin-*` pin-sessions and the `_rk-ctl` anchor are skipped, and a
dual-membership (pinned) window appears once, via its home session.
**Why**: matches the dashboard's user-facing truth and avoids duplicate rows
for pinned windows; an enrichment consumer wants one row per real pane.
**Rejected**: raw unfiltered enumeration (duplicates pinned windows, leaks
internal sessions).
*Introduced by*: `260820-hol4-mux-panes-native-pane-map`

### Duration semantics follow rk's sessions rollup, not fab's idle-only
**Decision**: the capture duration shows for `idle` and `waiting` (JSON field
`agent_state_duration`), not fab's idle-only `agent_idle_duration`.
**Why**: rk's own reader semantics (`rollupAgentState`: "how long the human has
been the blocker / how long at rest"); one convention inside rk beats
byte-parity with a copy being demoted to dispatch-internal.
**Rejected**: fab's idle-only field (would make rk's CLI disagree with rk's
dashboard on what waiting duration means).
*Introduced by*: `260815-82w7-mux-substrate-twins`

### Plain capture is a new primitive, not a flag change
**Decision**: the no-`-e` capture lives in `CapturePanePlainCtx` alongside
`CapturePaneCtx` instead of parameterizing or changing it.
**Why**: the `-e` variant is load-bearing for the chat echo probe (SGR-aware
novelty detection); a boolean parameter would put the distinction at every call
site (the SendLiteralArgs/SendKeyArgs lesson).
**Rejected**: stripping escapes downstream (fragile, and `--raw` must stay
byte-identical to tmux output).
*Introduced by*: `260815-82w7-mux-substrate-twins`

### Server-create collision probe is `ServerAlive`, refusal is operational
**Decision**: `rk mux new` probes `tmux.ServerAlive` before creating; a live
server refuses with exit 1 (operational), a dead/stale socket proceeds.
**Why**: creating over an existing live socket must fail clearly, not attach;
`ServerAlive` is the diagnostic-carrying liveness probe built for exactly this
CLI distinction, and a stale socket must not block creation (tmux restarts
over it).
**Rejected**: treating collision as usage (exit 2) — the name is well-formed;
the failure is environmental. Attaching/adopting the live server.
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

### Mark failure kills the fresh server
**Decision**: when `--ephemeral`'s option write fails after a successful
create, `rk mux new` best-effort `KillServer`s the new socket and exits 1.
**Why**: the verb exists to prevent unmarked scratch servers; returning
success-shaped debris on a failed mark would recreate the exact leak it fixes.
The server is milliseconds old and owned by this invocation — killing it is
safe.
**Rejected**: leaving the server and warning (unmarked survivor — the failure
mode the verb eliminates); retry loops (a failing `set-option` on a server
that just booted signals something structurally wrong).
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

### Fleet-wake MUSTs split between rk guarantee and caller protocol
**Decision**: rk implements no exclusion filtering, no re-arm logic, and no
debounce for `--any` fleet waits; it guarantees the first sweep runs before any
sleep and documents the five-point fleet-wake protocol in the skill page.
**Why**: re-arming after resume and re-arming on target-set change are
inherently caller-side (awaits are foreground children of the caller); rk-side
at-arm baselining would reopen the exact edge-trigger gap the
first-sweep-before-sleep guarantee exists to close; a single invocation wakes
once, so inter-wake spacing is inherently the re-armer's property.
**Rejected**: at-arm state baselining (loses wakes that fired between the
caller's last read and the arm); a `--settle`/`--debounce` flag (suppresses
legitimate wakes).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target

### Report word stays the first stdout token; firing pane appended
**Decision**: `--any` reports `<state> %N` / `gone %N`, with `file`/`running`
bare; single-target output is unchanged.
**Why**: callers need pane identity; keeping the report word first preserves
the family's one-word-parse habit (the first token discriminates the outcome in
both modes).
**Rejected**: `%N <state>` ordering (breaks first-token parsing); JSON output
(heavier than the family's one-line report contract).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target

### First dead target wakes the await; no drop-and-continue
**Decision**: a gone member reports `gone %N` (exit 1) rather than being
dropped from the watched set.
**Why**: consistent with single-target `gone`; pane death is wake-worthy for
the fleet caller (armed panes get immediate death detection), and the caller
re-arms minus the dead pane per the fleet-wake protocol.
**Rejected**: drop-and-continue with gone-only-when-empty (silently narrows the
watched set; the caller's set model drifts from reality).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target
