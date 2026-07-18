# run-kit skill

The agent skill bundle for **run-kit** — the tmux session manager with a web UI that may be hosting the pane you are running in. This is a static usage briefing: when to reach for run-kit, what it can do, how it composes with the rest of your session, and the traps to avoid. It is the offline complement to `rk context` (which reports the *current* environment); this bundle never changes between invocations.

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
- `rk context` — agent-optimized environment info: current session, window, pane, and **server URL**, plus the canonical recipes. **Dynamic** — run it at use-time; never cache or hardcode its values.
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

## Composition patterns

- **Discover the server URL at use-time**, never hardcode it — it changes between sessions:

  ```sh
  rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'
  ```

- **`rk skill` (this bundle) is the static briefing; `rk context` is the dynamic complement.** Read the bundle to learn *what* run-kit does; run `rk context` to learn *where* you are and get the current recipe verbatim. When they disagree, `rk context` wins — it ships with the binary and reflects the live environment.
- **`rk notify` is the default non-blocking escalation channel** for out-of-band messages to the human, gated on `command -v rk`:

  ```sh
  command -v rk >/dev/null 2>&1 && rk notify "build finished" --title "CI"
  ```

## Output & exit-code contracts

- **`rk notify` is fail-silent by contract.** Any error — server unreachable, no subscriptions, non-2xx — exits **0** and prints nothing, so it never stalls a calling loop. Do not branch on its output.
- **`rk skill`, `rk context`, and `rk help-dump` print data to stdout** (stdout is data; stderr is diagnostics). `rk skill` emits this bundle byte-identical with empty stderr and exit 0; `rk help-dump` emits the machine-readable command tree.
- **Exit codes follow the toolkit convention: `0` success, `1` operational failure, `2` usage error** — usage/flag/arg-count/unknown-command errors exit `2`; operational failures (dead server, failed check) exit `1`; `rk riff` subprocess failures exit `3`. The diagnostic is on stderr. (`rk notify` is the exception above — runtime failures exit `0`.)

## Gotchas

- `@rk_type` / `@rk_url` changes are picked up by the server's SSE polling automatically — no refresh, no API call.
- Killing a tmux window kills the backing process — no separate cleanup step is needed.
- `set-option -w` targets the **current** window: create the window first, then set options from within it (or pass `-t <window>`).
- The server URL changes between sessions — always rediscover it via `rk context`, never hardcode.
- run-kit may not be installed and you may not be in a tmux pane — gate every step and skip silently when the gate fails.
