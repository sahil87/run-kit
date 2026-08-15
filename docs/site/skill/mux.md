# run-kit skill: mux

Depth for one job: **talking to other agents** — delivering a message into another agent's tmux pane and waiting for its response — from inside a tmux pane run-kit manages. This is a static topic page (`rk skill mux`); the [core bundle](../skill.md) covers when to reach for run-kit at all. Everything here is byte-identical on every invocation.

Gate first, as always — run-kit is optional and may be absent:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ] || exit 0
```

## `rk mux send` — deliver a message to an agent

```sh
rk mux send %5 "summarize the diff and report back"   # pane target, literal message
rk mux send %5 - < prompt.md                          # multi-line payload via stdin
rk mux send @3 "hi"                                   # window target → its agent pane
rk mux send =work:editor "hi"                         # exact session:window
rk mux send %5 "yes, go ahead" --answer               # answer a WAITING agent's question
rk mux send %5 --key Enter                            # raw tmux key names (no paste/probe)
```

**Targets**: `%N` (pane), `@N` (window — resolves to the pane carrying `@rk_agent_state`, falling back to the active pane), `=session:window` (exact). Bare `session:window` names are rejected (tmux resolves bare names against windows first — a window named like a session would hijack the target). `-L <server>` targets another tmux server (default: your own, from `$TMUX`).

**The gate** (reads the target's `@rk_agent_state`):

| state | plain | `--answer` |
|-------|-------|------------|
| unknown (no/unparseable state) | warn + send | warn + send |
| `idle` | send | send |
| `waiting` | refuse | send — this send IS the answer |
| `active` | refuse | refuse — never interrupt a working agent |

`--force` skips the gate (existence still checked). Refusals name the state on stderr, exit 1.

**Delivery** is probe-verified: the text is pasted via a named buffer (bracketed paste — multi-line lands as one block), then Enter is sent ONLY after the paste provably echoed into the live input buffer. If the probe fails (e.g. a permission dialog swallowed the paste), no Enter is sent, the text stays staged in the composer, and the command exits 1 — **check the terminal before retrying; a resend would duplicate the staged text**. `--no-enter` stages without submitting (report: `staged %N`).

**stdout is one report line**: `delivered %N` (probe-confirmed submit), `staged %N` (--no-enter), `sent %N` (--key), or the await report word under `--await`. Diagnostics go to stderr. Exit codes: 0 success, 1 operational failure (refusal, probe failure, missing target), 2 usage.

## `rk mux await` — wait for an agent's state

```sh
rk mux await %5                          # block until the pane's agent is idle
rk mux await %5 --until idle,waiting     # wake on finish OR a question back
rk mux await %5 --file /tmp/result.json  # OR-compose a file-appearance signal
rk mux await %5 --timeout 120            # give up waiting after 120s
rk mux await %5 --notify                 # Web Push yourself/the human on wake
```

**stdout is one report word**: the reached `--until` state (default `idle`), `file`, `running` (timeout expired — exit 0; the timeout bounds YOU, never the pane), or `gone` (the pane died — exit 1). The first check runs before any sleep, so an already-fired signal returns immediately. An uninstrumented pane (no `@rk_agent_state`) with no `--file` errors immediately — there is nothing to wait on.

`--after-active` requires observing `active` before an `--until` state counts — use it when awaiting a pane you just sent to OUTSIDE `rk mux send --await`, so the peer's pre-send `idle` doesn't end your wait instantly.

## Ask-and-wait in one call

```sh
rk mux send %5 "review this plan" --await                  # deliver, then block for idle|waiting
rk mux send %5 "review this plan" --await=idle --timeout 600
```

After the probe-gated Enter, the verb first watches for the peer to flip to `active` (bounded ~10s grace — closing the stale-state race), then awaits the state set (default `idle,waiting`). The final stdout line is the await report word. Each CLI call is a tool-use round trip — prefer this composed form over a separate `send` + `await`.

## Gotchas

- `--answer` and `--force` are mutually exclusive (usage error, exit 2) — say what you mean.
- `--await` cannot combine with `--no-enter` (nothing was submitted to wait on).
- `--key` sends key names raw (no paste, no probe — keys have no echo to verify).
- `send --await` on an UNINSTRUMENTED pane (no `@rk_agent_state`): the message still delivers and `delivered %N` prints; the wait then applies its own rule — if the pane still has no state, the command errors "nothing observable to wait on" (exit 1). The delivery is never rolled back or hidden by a failed wait.
- `await --notify` fires on EVERY report — including `running` (timeout) and `gone` (pane died), not just a reached state. That is deliberate: you asked to be woken when the wait ends, however it ends.
- A bare `tmux kill-server` (no `-L`/`-S`) is refused machine-wide by the rk tmux guard shim — use `tmux -L <name> kill-server` for scratch servers (`rk mux guard` is the verb the shim execs).
- The verbs talk to tmux directly from your context — no daemon dependency, so they work while `rk serve` is down.
- Waits are bounded by `--timeout` (default 300s, 0 = indefinite), never by an internal command budget — individual tmux reads carry their own short timeouts, the loop itself does not.
