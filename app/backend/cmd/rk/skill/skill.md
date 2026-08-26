# run-kit skill

The agent skill bundle for **run-kit** — the tmux session manager with a web UI that may be hosting the pane you are running in. This is a static usage briefing: when to reach for run-kit, what it can do, how it composes with the rest of your session, and the traps to avoid. It never changes between invocations; live values (your location, the server URL) you derive directly — see [Where am I](#where-am-i).

## Topics

Depth for a specific job lives in topic pages — pull one at use-time:

- **panes, iframes & visual display** → `rk skill display`
- **agent-to-agent messaging** (send a message into another agent's pane, wait for its state) → `rk skill mux`
- **act inside the `code` lens editor** (run VS Code palette commands in the open code-server window from the shell) → `rk skill code`

## When to use

You are an agent working inside a tmux pane, and run-kit may be managing it. Reach for run-kit to:

- **Notify the human out-of-band** — surface a result or a question to their browser/phone without blocking your loop.
- **Show web content visually** — render generated HTML, a diagram, a report, or a local dev server as a window the user can see, instead of describing it in text.

Gate first — run-kit is optional and may be absent:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ] || exit 0
```

If either check fails, skip every run-kit step silently. Never error, never warn — fall back to describing output in text.

> `rk` is the short alias; `run-kit` is the full binary name. Both work everywhere.

## Capabilities

One line each, keyed to the subcommand or tmux option that does it:

- `rk notify <message> [--title <t>]` — Web Push a message to every subscribed browser/device. Fail-silent by contract (see Output contracts).
- `rk url` — print the run-kit **server URL** (config-derived: RK_HOST/RK_PORT, default `http://127.0.0.1:3000`). It is a heuristic, not a liveness probe. Run it at use-time; never hardcode the value.
- `rk present <path|url>` — attach web content beside your own terminal: a file, a directory, a `:port`, a localhost URL, or an external URL. Prints the resolved URL to stdout. Depth: `rk skill display`.
- `rk mux send <target> [<msg>|-]` — deliver a message into another agent's pane, gated on its `@rk_agent_state`, with probe-verified delivery. Depth: `rk skill mux`.
- `rk mux await <target>` — block until a pane's agent state (or a `--file` signal) fires; prints a one-word report. Depth: `rk skill mux`.
- `rk mux new <name> [--ephemeral]` — create a detached tmux server on socket `<name>`; scratch servers are created with `--ephemeral` and bulk-cleaned with `rk mux reap --ephemeral` (never bare `tmux kill-server`). Depth: `rk skill mux`.
- `rk code exec <command> [json-arg…]` — act inside the `code` lens editor: run a VS Code palette command in an open code-server window, resolving its host via `--host`/`--folder`/the cwd's git toplevel. `rk code hosts` lists live hosts; `rk code commands` grep-lists command ids. Depth: `rk skill code`.
- `rk skill display` — the visual-display topic page: target forms, attach vs. standalone windows, the proxy, and the canonical Visual Display Recipe, in depth.
- **Proxy** — reach a local service through the run-kit server:

  ```
  {server_url}/proxy/{port}/...
  ```

  The relative form `/proxy/{port}/...` works from the frontend behind any origin or reverse proxy.
- **Visual Display Recipe** — the canonical flow to show HTML to the user:
  1. **Generate HTML** to a known location (a temp dir or the project tree).
  2. **`rk present ./file.html`** — serves it live and attaches it to your window's web tile; re-run the same command to refresh.
  3. **Optionally `--notify`** — push the user when they may be away.
  4. **Fail silently** — if any prerequisite is unavailable (run-kit missing, not in tmux), skip the rest without surfacing an error.

## Where am I

This bundle is static, so it can't report your live location — derive it directly:

```sh
echo "$TMUX_PANE"                                # pane ID, e.g. %82 (empty ⇒ not in tmux)
tmux display-message -t "$TMUX_PANE" -p '#S'     # session
tmux display-message -t "$TMUX_PANE" -p '#W'     # window
tmux show-option -w -t "$TMUX_PANE" -qv @rk_type # window type (empty ⇒ terminal)
rk url                                           # server URL (config-derived)
```

## Composition patterns

- **Discover the server URL at use-time** via `rk url`, never hardcode it — it is config-derived from this environment (see [Where am I](#where-am-i)).
- **`rk skill` is the static briefing; you derive the live details.** Read the bundle to learn *what* run-kit does; run the [Where am I](#where-am-i) derivations to learn *where* you are, and `rk skill display` for the visual-display recipe in depth.
- **`rk notify` is the default non-blocking escalation channel** for out-of-band messages to the human, gated on `command -v rk`:

  ```sh
  command -v rk >/dev/null 2>&1 && rk notify "build finished" --title "CI"
  ```

## Output & exit-code contracts

- **`rk notify` is fail-silent by contract.** Any error — server unreachable, no subscriptions, non-2xx — exits **0** and prints nothing, so it never stalls a calling loop. Do not branch on its output.
- **`rk present` prints only the resolved URL to stdout** (data — printed even under `--quiet`); diagnostics go to stderr. Its exit codes follow the convention below; its `--notify` send stays fail-silent like `rk notify`.
- **`rk mux send`/`rk mux await` print exactly one report line to stdout** — `delivered|staged|sent <pane>` for send (the await report word under `--await`), and the reached state / `file` / `running` / `gone` for await. Diagnostics go to stderr; `gone` and gate refusals exit 1.
- **`rk skill`, `rk url`, and `rk help-dump` print data to stdout** (stdout is data; stderr is diagnostics). `rk skill` emits this bundle byte-identical with empty stderr and exit 0; `rk skill <topic>` (e.g. `display`) prints one topic page under the same contract, and an unknown topic exits non-zero with the valid topics on stderr; `rk url` prints the server URL newline-terminated; `rk help-dump` emits the machine-readable command tree.
- **Exit codes follow the toolkit convention: `0` success, `1` operational failure, `2` usage error** — usage/flag/arg-count/unknown-command errors exit `2`; operational failures (dead server, failed check) exit `1`; `rk riff` subprocess failures exit `3`. The diagnostic is on stderr. (`rk notify` is the exception above — runtime failures exit `0`.)

## Gotchas

- `@rk_type` / `@rk_url` changes are picked up by the server's SSE polling automatically — no refresh, no API call.
- Killing a tmux window kills the backing process — no separate cleanup step is needed.
- `set-option -w` targets the **current** window: create the window first, then set options from within it (or pass `-t <window>`).
- The server URL is config-derived from this environment — always get it from `rk url`, never hardcode.
- run-kit may not be installed and you may not be in a tmux pane — gate every step and skip silently when the gate fails.
