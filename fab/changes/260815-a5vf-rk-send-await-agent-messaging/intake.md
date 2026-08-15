# Intake: rk send + rk await — agent-to-agent messaging verbs

**Change**: 260815-a5vf-rk-send-await-agent-messaging
**Created**: 2026-08-15

## Origin

> rk present is a great tool for agents - it gives the agent the ability to show artifacts to the user. I need something similar to allow agents to talk to other agents (in a non native way). the answer for this today is "fab pane send". Can you crystallize this ability into an "rk send"?

Conversational (`/fab-discuss` session). Key decisions reached in discussion:

- **Ship both verbs**: `rk send` and `rk await` (user: "yes to both send and await").
- **Symmetry framing**: `rk present` = agent→user (show an artifact); `rk send` = agent→agent (deliver a message into a pane). Both are caller-context tmux verbs.
- **Why rk, not fab**: (1) rk owns the gate's substrate — `@rk_agent_state` is written only by `rk agent-setup` hooks, and fab is already a consumer per the agent-state ownership split; (2) rk already has a strictly better delivery mechanism (the chat-send injection engine) than `fab pane send`'s naive literal `send-keys` + blind trailing Enter.
- **Retirement decision**: the operator is effectively `fab pane send`'s only CLI consumer (verified: `fab dispatch deliver` uses internal Go builders, not the CLI verb; fab-kit's binary-review findings confirmed no skill branches on `pane send` exit codes or output strings). Once the operator skill migrates to `rk send`, `fab pane send` gets deleted in fab-kit — that migration/deletion is a **separate follow-up change in the fab-kit repo**, sequenced after this one ships.
- **Parity requirement**: for the retirement to be clean, `rk send` must cover the operator's full send surface — the gate matrix, `--answer`/`--force`/`--no-enter`, `-L <server>`, and a key-name arm (bare Enter, arrows, `C-c`) that `fab pane send` cannot express today (the operator's documented raw-tmux carve-out).
- **Command grouping** (follow-up discussion, same session): the verbs land under the **`rk mux` family** — `rk mux send`, `rk mux await` — per `docs/specs/cli-layering.md` (the tmux-substrate namespace; flat root verbs rejected to keep `rk -h` noise down, mirroring the `fab pane`/`fab config` family precedent). Prose shorthand `rk send`/`rk await` below means `rk mux send`/`rk mux await`.
- **Signature analysis** (user requested, mid-session): improvements folded in — stdin payload (`-`) for multi-line messages, a composed `rk send --await` (one-call ask-and-wait with correct active-flip sequencing), `rk await --after-active` (closes the stale-state race when awaiting right after a send), `rk await --notify` (rk present symmetry), explicit `--answer`/`--force` mutual exclusion replacing fab's silent force-wins precedence, and a one-word stdout report contract.

## Why

1. **Pain point**: agents coordinating other agents (the operator pattern, ad-hoc agent-to-agent nudges) have no rk-native verb. Today's answer, `fab pane send`, lives in the wrong repo (its whole value-add — the `@rk_agent_state` idle gate — reads state only rk ever writes) and uses fragile delivery: literal `send-keys` plus a blind trailing Enter. Known failure modes: a stale printed `❯` prompt eats the Enter as a no-op; multi-line text without bracketed paste can submit line-by-line; there is no confirmation the text reached the live input buffer.
2. **Consequence of not fixing**: the send verb stays split across repos (fab holds the gate logic, rk holds the state and the hardened injection engine), the operator keeps a raw-tmux carve-out for key-name input, and rk's superior chat-send delivery (novelty echo probe, probe-gated Enter) stays locked behind the HTTP API, unusable from a CLI-driving agent.
3. **Why this approach**: rk already ships the hardened injection sequence in `api/chat.go` (`injectChatMessage`: sanitize → named-buffer `set-buffer` → bracketed `paste-buffer -d -p` → novelty echo probe → probe-gated Enter, serialized per (server, pane)). Extracting it into a shared internal package and fronting it with a gated CLI verb reuses proven machinery instead of porting fab's weaker implementation. `rk await` completes the conversation loop (send + wait-for-state), mirroring `fab pane await`'s proven contract.

## What Changes

### New command: `rk mux send`

```
rk mux send <target> [<message> | -] [--key <key>]... [--answer | --force] [--no-enter] [--await[=<states>]] [--timeout <secs>] [-L <server>]
```

Delivers a message into a tmux pane, gated on the target's agent state, with probe-verified delivery.

**Payload forms** — exactly one payload kind is required (usage error otherwise):
- positional `<message>` — literal text
- `-` — read the message from stdin (removes shell-quoting pain for multi-line agent prompts; `fab dispatch start` stdin precedent). Bracketed paste handles multi-line delivery.
- `--key <key>` (repeatable, e.g. `--key Enter`, `--key Up`, `--key C-c`) — tmux key names, no positional message

**Target addressing** (applies to both verbs): pane ID (`%5`) is the primary form — `@rk_agent_state` lives per-pane. Window forms (`@3`, `=session:window`) resolve to the window's *agent pane*: the pane carrying `@rk_agent_state` (falling back to the active pane), following the `resolveWindowChat` precedent in `api/chat.go` that a window target must route to the agent pane, not whatever split is active. Accepted grammar is deliberately strict — `%id`, `@id`, `=session:window` only; bare `session:window` names are rejected because tmux's target grammar makes bare names collide (a window named like a session hijacks the target — a documented footgun).

**The agent-state gate** — `fab pane send`'s `idleGate` matrix verbatim (it is well-designed and unit-tested), reading `@rk_agent_state` via rk's own reader (`internal/tmux`):

| State | plain | `--answer` |
|-------|-------|------------|
| (unknown — no option / unparseable) | warn + send | warn + send |
| `idle` | send | send |
| `waiting` | refuse | send (this send IS the answer it waits for) |
| `active` | refuse | refuse (never interrupt a working agent unattended) |

`--force` skips the gate entirely (still validates the target exists). Refusals name the state in the error message. `--answer` and `--force` are **mutually exclusive** (cobra `MarkFlagsMutuallyExclusive`) — an explicit usage error replaces fab's silent force-wins precedence.

**Output contract**: stdout carries a one-word-plus-target report — `delivered %5` on probe-confirmed submit, `staged %5` under `--no-enter` (text pasted, no Enter), the await report word when `--await` is used. Refusals and diagnostics go to stderr, exit 1.

**Delivery** — the chat-send injection engine, extracted from `api/chat.go` into a shared internal package (e.g. `internal/agentsend` — final name at plan time) consumed by BOTH the HTTP `handleChatSend` route and the new CLI verb (single implementation, no fork):

1. sanitize text
2. `set-buffer` into a named buffer
3. bracketed `paste-buffer -d -p` into the target pane
4. **novelty echo probe** — capture-compare confirming the text actually landed in the live input buffer (long-single-line collapse handling preserved)
5. probe-gated Enter (skipped under `--no-enter` — text stages without submitting)

**CLI buffer naming**: the daemon path keeps its single `rk-chat-send` buffer + in-process per-pane lock. The CLI path uses a per-invocation buffer name (`rk-send-<pid>`) so a CLI send can never clobber a concurrent daemon send's buffer. The cross-process same-pane paste race remains theoretically possible but is inherent to tmux and rare — accepted.

**Key-name arm**: `--key` sends tmux key names instead of literal text — post-gate raw `send-keys` (no paste, no probe; key names have no echo to probe). This closes the gap that today forces the operator to raw `tmux send-keys`, making `rk send` the single canonical send verb.

**Composed ask-and-wait**: `--await[=<states>]` (default `idle,waiting`) blocks after delivery until the peer reaches an awaited state, printing the await report word. Sequencing lives inside the verb: after the probe-gated Enter, first watch for the state to flip to `active` (bounded grace, ~10s), and only then await the target states. This closes the **stale-state race** — a bare `rk await --until idle` fired immediately after a send would return instantly on the peer's *pre-send* `idle`. One call instead of two also matters for agent consumers (each CLI call is a tool-use round trip). `--timeout` bounds the await phase (observer only, never the pane), matching `rk await`.

**No daemon dependency**: direct tmux from the caller's context (the `rk present` pattern — `-L <server>` or `$TMUX`-derived socket), so agent-to-agent messaging works when `rk serve` is down. All subprocesses via `exec.CommandContext` with the 5s tmux bound (Constitution §I).

### New command: `rk mux await`

```
rk mux await <target> [--until <state>[,<state>]] [--file <path>] [--after-active] [--timeout <secs>] [--notify[=msg]] [-L <server>]
```

Blocks until any waitable signal fires, prints a one-word report, exits 0 — mirroring `fab pane await`'s proven contract:

- `idle` — the pane's `@rk_agent_state` reached an awaited state (default set: `idle`)
- `file` — the `--file` path appeared (OR-composed with the state signal)
- `running` — `--timeout` (default 300s, 0 = indefinite) expired with neither signal; exit 0 — the timeout bounds the OBSERVER, never the pane
- `gone` — the pane died mid-wait

Contract details carried over: first check runs before any sleep (an already-fired signal returns immediately); a fired signal wins over a mid-tick pane death; an uninstrumented pane (no `@rk_agent_state`) with no `--file` is an immediate error — nothing observable to wait on.

**Extensions over fab's verb**:
- `--until` accepts a state set (default `idle`; `--until idle,waiting` wakes when the peer either finishes or asks a question back) — the conversational wake an agent-to-agent exchange needs. The report word is the reached state.
- `--after-active` requires observing `active` before an `--until` state counts — the composable fix for the stale-state race when awaiting a pane that was just sent to outside `rk send --await`.
- `--notify[=msg]` sends a Web Push when the signal fires (default message derived from the report, e.g. "agent %5 is idle") — fail-silent per the `rk notify` contract, mirroring `rk present --notify`. Long waits ping the human.
- `gone` reports on stdout with **exit 1** (the wait cannot complete — an operational failure under the toolkit convention), unlike fab's pane-family exit 2.

### CLI surface + conformance

- Register a `muxCmd` **family** in `app/backend/cmd/rk/root.go` with `send` and `await` subcommands — new files `cmd/rk/mux.go`, `cmd/rk/mux_send.go`, `cmd/rk/mux_await.go` (+ tests, following the `present.go` seam pattern for tmux-free unit tests). The family parent carries the shared `-L/--server` persistent flag (the `fab pane` pattern). This change creates the family with these two members only; moving existing root commands under it (`reaper`, `snapshot`, `tmux-guard`, `init-conf`) is future work per `docs/specs/cli-layering.md`.
- Exit codes follow the rk toolkit convention (Principle 4: 0 success, 1 operational failure, 2 usage error) — NOT fab's pane-family 2/3 scheme. `rk await`'s report word is the discriminator, matching `fab dispatch wait` conventions; verified that no fab-kit skill branches on `pane send`/`await` exit codes.
- Toolkit-standards pass required for the new surface: help-dump test, Principle 9 new-surface check, `rk skill` topic-page coverage for the two verbs, README/docs per the standards that govern them.

### Explicitly out of scope

- The fab-kit half: migrating `fab-operator` + `_cli-agents`/`_cli-external` guidance to `rk send`/`rk await` (with a raw-tmux fallback when rk is absent) and deleting `fab pane send`/`await` — a separate change in the fab-kit repo, after this ships. fab's internal builders (`pane.SendLiteralArgs`/`SendKeyArgs`) stay regardless (dispatch delivery depends on them).
- Any web-UI surfacing of sends/awaits.
- Protocol-based (non-tmux) sends to native agents — this is deliberately the "non native" tmux path.

## Affected Memory

- `run-kit/agent-messaging`: (new) the `rk send` + `rk await` verbs — gate matrix, injection contract, addressing, await signals, buffer naming, exit codes
- `run-kit/chat`: (modify) injection engine extracted to a shared internal package; HTTP handler becomes a consumer
- `run-kit/agent-state`: (modify) two new first-party readers of `@rk_agent_state` (the send gate, the await observer)
- `run-kit/architecture`: (modify) two new CLI subcommands
- `run-kit/toolkit-standards`: (modify) new-surface conformance entries for `rk send`/`rk await`

## Impact

- `app/backend/cmd/rk/` — new `send.go`, `await.go` (+ tests), `root.go` registration, help-dump test update
- `app/backend/api/chat.go` — injection sequence extracted out; handler refactored to consume the shared package (behavior-preserving)
- `app/backend/internal/` — new shared injection package; possible small additions to `internal/tmux` (key-name send-keys primitive, agent-state read helpers if not already exported)
- Docs: `rk skill` topic pages, README per toolkit standards
- Cross-repo (follow-up, not this change): fab-kit operator skill + helper guidance migration, `fab pane send`/`await` deletion

## Open Questions

- (none — remaining choices are graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Ship both `rk send` and `rk await` in this change | Discussed — user explicitly confirmed "yes to both send and await" | S:95 R:70 A:90 D:95 |
| 2 | Certain | Delivery = the chat-send injection engine (named-buffer bracketed paste + novelty echo probe + probe-gated Enter) extracted to a shared internal package; naive send-keys rejected | Discussed — the core of the accepted proposal; engine already proven in `api/chat.go` | S:90 R:60 A:90 D:90 |
| 3 | Certain | Gate matrix is fab's `idleGate` verbatim, with `--answer`/`--force`/`--no-enter`/`-L` flag parity | Discussed — operator-parity requirement for the agreed `fab pane send` retirement; matrix is unit-tested upstream | S:90 R:75 A:95 D:90 |
| 4 | Certain | `rk await` mirrors `fab pane await`'s contract (idle/file/running/gone reports, OR-composed signals, observer-bounding timeout, uninstrumented+no-file errors immediately) | Proven design read from source; parity keeps the operator/pipeline conventions intact | S:70 R:75 A:90 D:85 |
| 5 | Certain | fab-kit migration + `fab pane send`/`await` deletion is a separate follow-up change in the fab-kit repo | Discussed — user decided retirement; different repo, sequenced after this ships | S:85 R:80 A:90 D:90 |
| 6 | Confident | Key-name arm (`--key`, repeatable, mutually exclusive with message text; post-gate raw send-keys, no probe) | Proposed in discussion as the parity piece closing the operator's raw-tmux carve-out; unconfirmed verbatim but the retirement rationale depends on it | S:70 R:80 A:80 D:75 |
| 7 | Confident | No daemon dependency — direct tmux from caller context; CLI uses per-invocation buffer `rk-send-<pid>`, daemon keeps `rk-chat-send` + its lock | rk present precedent; single-writer buffer assumption otherwise breaks; cross-process paste race accepted as inherent | S:65 R:70 A:85 D:75 |
| 8 | Confident | Addressing: pane ID primary; window forms resolve to the agent pane (`@rk_agent_state` carrier, fallback active pane) | resolveWindowChat precedent; additive sugar, easily adjusted | S:60 R:80 A:70 D:60 |
| 9 | Confident | `--until` state-set extension on await (default `idle`; `idle,waiting` for conversational wake) | Additive flag with fab-parity default; new idea not explicitly user-confirmed | S:45 R:85 A:65 D:55 |
| 10 | Confident | Exit codes follow rk toolkit convention (0/1/2-usage), not fab's pane-family 2/3 scheme; await report word is the discriminator | Toolkit standards bind rk's CLI surface; verified no fab-kit skill branches on send/await exit codes | S:55 R:70 A:90 D:75 |
| 11 | Confident | `handleChatSend` refactored to consume the extracted package (behavior-preserving, no fork) | Direct consequence of extraction; covered by existing chat-send tests | S:60 R:75 A:90 D:85 |
| 12 | Confident | Payload forms: positional message, `-` = stdin, repeatable `--key`; exactly one payload kind required | stdin removes shell-quoting pain for multi-line agent prompts; `fab dispatch start` stdin precedent | S:55 R:85 A:85 D:80 |
| 13 | Confident | `rk send --await[=<states>]` composed send+wait (default `idle,waiting`): observe the active flip under a bounded grace, then await | One-call ask-and-wait; sequencing inside the verb closes the stale-state race; requested signature analysis | S:50 R:80 A:70 D:60 |
| 14 | Confident | `rk await --after-active` requires observing `active` before an `--until` state counts | Composable form of the same race fix for standalone awaits | S:50 R:85 A:75 D:70 |
| 15 | Confident | `--answer`/`--force` mutually exclusive (usage error); send prints `delivered <pane>` / `staged <pane>`; await `gone` = report word + exit 1 | Explicit beats fab's silent force-wins; one-word stdout reports keep agent parsing simple; toolkit exit-code convention | S:50 R:90 A:85 D:75 |
| 16 | Confident | `rk await --notify[=msg]` Web Push when the signal fires (fail-silent) | `rk present --notify` symmetry; long waits ping the human | S:45 R:90 A:80 D:70 |
| 17 | Confident | Strict target grammar: `%id`, `@id`, `=session:window` only — bare names rejected | tmux bare-name targets collide (window named like a session hijacks the target); strictness prevents a documented footgun | S:55 R:85 A:90 D:80 |
| 18 | Certain | Verbs land under the `rk mux` family (`rk mux send`, `rk mux await`); this change creates the family with these two members only | Discussed — user proposed the grouping ("rk mux send… just like fab pane"); spec'd in docs/specs/cli-layering.md | S:90 R:80 A:90 D:90 |

18 assumptions (6 certain, 12 confident, 0 tentative, 0 unresolved).
