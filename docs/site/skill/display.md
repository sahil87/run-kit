# run-kit skill: display

Depth for one job: **putting visual content in front of the user** — a terminal window, an iframe rendering a web page, a generated HTML report — from inside a tmux pane run-kit manages. This is a static topic page (`rk skill display`); the [core bundle](../skill.md) covers when to reach for run-kit at all. Everything here is byte-identical on every invocation; live values are symbolic — resolve the server URL at use-time with `rk url`.

Gate first, as always — run-kit is optional and may be absent:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ] || exit 0
```

## Terminal Windows

Create a new terminal window in the current tmux session:

```sh
tmux new-window -n <name>
```

## Iframe Windows

Create a window that renders a web page in an iframe instead of a terminal:

```sh
tmux new-window -n <name>
tmux set-option -w @rk_type iframe
tmux set-option -w @rk_url <url>
```

Change the page of an existing iframe window later by re-setting `@rk_url`:

```sh
tmux set-option -w @rk_url <new-url>
```

## Proxy

Reach a local service through the run-kit server using the proxy path:

```
/proxy/{port}/...
```

A service on port 8080 is available at `/proxy/8080/`. The **relative** form works from the frontend against whatever origin the user is on — `localhost` directly or behind a reverse proxy — so never compose an absolute `{server_url}/proxy/...`; hand the frontend the relative path and let it resolve.

## Visual Display Recipe

The canonical 4-step flow to show HTML content to the user in an iframe window. Every step SHALL fail silently if its prerequisite is unavailable (run-kit missing, port in use, server fails to start) — skip the remaining steps without surfacing an error.

1. **Generate HTML** to a known location (e.g. `~/.agent/diagrams/`, a temp directory, or the project tree).
2. **Serve it** on loopback (not exposed on the LAN):

   ```sh
   python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &
   ```

3. **Open an iframe window** pointing to the **relative** proxy path. The run-kit frontend resolves it against whatever origin the user is on, so it works identically on `localhost:3000` directly or behind a reverse proxy:

   ```sh
   tmux new-window -n <name>
   tmux set-option -w @rk_type iframe
   tmux set-option -w @rk_url /proxy/<port>/<filename>
   ```

4. **Fail silently** — if any step's prerequisite is unavailable (run-kit missing, port in use, server start fails), skip the rest without error.

## Conventions

### Tmux user options

- `@rk_type` — window type: `terminal` (default) or `iframe`. Set via `tmux set-option -w @rk_type <value>`.
- `@rk_url` — URL for iframe windows. Set via `tmux set-option -w @rk_url <url>`.

`set-option -w` targets the **current** window: create the window first, then set options from within it (or pass `-t <window>`).

### Window lifecycle

Killing a tmux window kills the backing process. No separate cleanup step is needed.

### SSE reactivity

Changes to tmux window options are picked up automatically by the run-kit server via SSE polling — no manual refresh, no API call.
