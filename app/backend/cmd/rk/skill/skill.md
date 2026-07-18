# run-kit skill

The agent skill bundle for **run-kit** — the tmux session manager with a web UI that may be hosting the pane you are running in. This is a static usage briefing: when to reach for run-kit, what it can do, how it composes with the rest of your session, and the traps to avoid. It never changes between invocations; live values (your location, the server URL) you derive directly — see [Where am I](#where-am-i).

## Topics

Depth for a specific job lives in topic pages — pull one at use-time:

- **panes, iframes & visual display** → `rk skill display`

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
- `rk skill display` — the visual-display topic page: panes, iframe windows, the proxy, and the canonical Visual Display Recipe, in depth.
- **Iframe windows** — a tmux window that renders a web page instead of a terminal:

  ```sh
  tmux new-window -n <name>
  tmux set-option -w @rk_type iframe
  tmux set-option -w @rk_url <url>
  ```

  Change the page later by re-setting `@rk_url`.
- **Proxy** — reach a local service through the run-kit server:

  ```
  {server_url}/proxy/{port}/...
  ```

  The relative form `/proxy/{port}/...` works from the frontend behind any origin or reverse proxy.
- **Visual Display Recipe** — the canonical 4-step flow to show HTML to the user:
  1. **Generate HTML** to a known location (a temp dir or the project tree).
  2. **Serve it** on loopback: `python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &`
  3. **Open an iframe window** with a relative proxy path:

     ```sh
     tmux new-window -n <name>
     tmux set-option -w @rk_type iframe
     tmux set-option -w @rk_url /proxy/<port>/<filename>
     ```
  4. **Fail silently** — if any step's prerequisite is unavailable (run-kit missing, port in use, server start fails), skip the rest without surfacing an error.

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
- **`rk skill`, `rk url`, and `rk help-dump` print data to stdout** (stdout is data; stderr is diagnostics). `rk skill` emits this bundle byte-identical with empty stderr and exit 0; `rk skill <topic>` (e.g. `display`) prints one topic page under the same contract, and an unknown topic exits non-zero with the valid topics on stderr; `rk url` prints the server URL newline-terminated; `rk help-dump` emits the machine-readable command tree.
- **Exit codes follow the toolkit convention: `0` success, `1` operational failure, `2` usage error** — usage/flag/arg-count/unknown-command errors exit `2`; operational failures (dead server, failed check) exit `1`; `rk riff` subprocess failures exit `3`. The diagnostic is on stderr. (`rk notify` is the exception above — runtime failures exit `0`.)

## Gotchas

- `@rk_type` / `@rk_url` changes are picked up by the server's SSE polling automatically — no refresh, no API call.
- Killing a tmux window kills the backing process — no separate cleanup step is needed.
- `set-option -w` targets the **current** window: create the window first, then set options from within it (or pass `-t <window>`).
- The server URL is config-derived from this environment — always get it from `rk url`, never hardcode.
- run-kit may not be installed and you may not be in a tmux pane — gate every step and skip silently when the gate fails.
