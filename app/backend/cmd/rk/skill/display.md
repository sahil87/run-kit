# run-kit skill: display

Depth for one job: **putting visual content in front of the user** — a generated HTML report, a diagram, a dev server — from inside a tmux pane run-kit manages. This is a static topic page (`rk skill display`); the [core bundle](../skill.md) covers when to reach for run-kit at all. Everything here is byte-identical on every invocation; live values are symbolic — resolve the server URL at use-time with `rk url`.

Gate first, as always — run-kit is optional and may be absent:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ] || exit 0
```

## `rk present` — the primary recipe

One verb resolves the target, serves it if needed, and attaches it to the web tile of YOUR OWN window:

```sh
rk present ./mock.html              # a file — served live, attached
rk present ./dist/                  # a directory (index.html default)
rk present :5173                    # a port already serving → /proxy/5173/
rk present http://localhost:8080/x  # same, rewritten to /proxy/8080/x
rk present https://example.com/app  # external URL — attached verbatim
```

The resolved URL prints to stdout (relative for `/present` and `/proxy` targets, absolute for external URLs); diagnostics go to stderr. Exit codes: `0` success, `1` operational failure (not in tmux, file missing, port not listening), `2` usage.

**You cannot open the tile for the user.** Layout is per-viewer client state — `rk present` only makes content AVAILABLE (the rail's web button lights up). When the user may be away, nudge them:

```sh
rk present ./mock.html --notify            # message: "presenting mock.html"
rk present ./mock.html --notify "report ready"
```

The notify send is fail-silent (like `rk notify`) — never branch on it.

## Iteration

- **Re-present is the refresh verb** — re-running `rk present` on the same file/dir target bumps a cache-buster in the attached URL, so an open web tile re-navigates.
- File/dir targets serve from the LIVE filesystem — a plain browser reload already sees your edits; re-present only when the tile must re-navigate.

## Attach vs. standalone window

Default attaches to your own window — one `@rk_url` per window, so last write wins on multi-pane windows. Use `--window` for the residual cases:

- an **external URL with no owning pane** (you are presenting something unrelated to your work),
- a **second simultaneous mock** (your window's tile is already taken),
- content that deserves its own **board-pinnable identity**.

```sh
rk present --window https://staging.example.com   # name from the host
rk present --window=report ./dist/                # explicit name
```

`--window` spawns a new tmux window in your session carrying `@rk_type=iframe` — the one remaining legitimate producer of that hint.

## Proxy

Reach a local service through the run-kit server using the proxy path:

```
/proxy/{port}/...
```

A service on port 8080 is available at `/proxy/8080/`. The **relative** form works from the frontend against whatever origin the user is on — `localhost` directly or behind a reverse proxy — so never compose an absolute `{server_url}/proxy/...`; hand the frontend the relative path and let it resolve. `rk present :8080` and `rk present http://localhost:8080/...` derive this form for you.

## Conventions

### Tmux user options

- `@rk_url` — the window's attached web content (availability signal for the rail's web tile).
- `@rk_present_root` — the absolute serve root for `/present/<windowId>/...` file serving; set by `rk present` for file/dir targets, dies with the window.
- `@rk_type` — window type: `terminal` (default) or `iframe`. A creation-time default-view hint only — attaching `@rk_url` to a tty-led window does NOT steal its default view.

### SSE reactivity

Changes to tmux window options are picked up automatically by the run-kit server via SSE polling — no manual refresh, no API call.

### Window lifecycle

Killing a tmux window kills the backing process. No separate cleanup step is needed.

## Appendix: the manual recipe (older rk versions)

On an rk too old to have `present`, spawn an iframe window by hand. Serve the content yourself (e.g. `python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &`), then:

```sh
tmux new-window -n <name>
tmux set-option -w @rk_type iframe
tmux set-option -w @rk_url /proxy/<port>/<filename>
```

Change the page later by re-setting `@rk_url`. Every step SHALL fail silently if its prerequisite is unavailable (run-kit missing, port in use, server fails to start) — skip the remaining steps without surfacing an error.
