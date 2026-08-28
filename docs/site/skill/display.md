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

Default attaches to your own window — a window's web content is an indexed family (`@rk_win_web_1` first), so `rk present` appends a new tab when the window already has one. Use `--window` for the residual cases:

- an **external URL with no owning pane** (you are presenting something unrelated to your work),
- content that deserves its own **board-pinnable identity**.

```sh
rk present --window https://staging.example.com   # name from the host
rk present --window=report ./dist/                # explicit name
```

`--window` spawns a new tmux window in your session carrying `@rk_win_layout=single:web` (the web tile leads) with the target as `@rk_win_web_1`.

## Proxy

Reach a local service through the run-kit server using the proxy path:

```
/proxy/{port}/...
```

A service on port 8080 is available at `/proxy/8080/`. The **relative** form works from the frontend against whatever origin the user is on — `localhost` directly or behind a reverse proxy — so never compose an absolute `{server_url}/proxy/...`; hand the frontend the relative path and let it resolve. `rk present :8080` and `rk present http://localhost:8080/...` derive this form for you.

## Conventions

### Tmux user options

- `@rk_win_web_<n>` — the window's web-tab family (n = 1..8, dense): the attached web content the web tile shows; `@rk_win_web_active` is the 1-based tab the tile renders.
- `@rk_win_web_<n>_root` — the absolute serve root for a file/dir target held in slot n, read by the `/present/<windowId>/<n>/...` route; set by `rk present` for file/dir targets, dies with the window.
- `@rk_win_layout` — the surface layout `<shape>:<surface,...>` (e.g. `single:web`, `split-h:tty,web`); empty renders the default terminal. `rk present --window` sets `single:web` on the new window; attaching to your own window never touches it.

The retired `@rk_win_url` / `@rk_win_lens` / `@rk_win_present_root` are accepted only via compat for one release (translated onto the family). Legacy option names (`@rk_type`, `@rk_url`, `@rk_note`) are still read for now.

### SSE reactivity

Changes to tmux window options are picked up automatically by the run-kit server via SSE polling — no manual refresh, no API call.

### Window lifecycle

Killing a tmux window kills the backing process. No separate cleanup step is needed.

## Appendix: the manual recipe (older rk versions)

On an rk too old to have `present`, spawn an iframe window by hand. Serve the content yourself (e.g. `python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &`), then:

```sh
tmux new-window -n <name>
tmux set-option -w @rk_win_layout single:web
tmux set-option -w @rk_win_web_1 /proxy/<port>/<filename>
tmux set-option -w @rk_win_web_active 1
```

Change the page later by re-setting `@rk_win_web_1`. Every step SHALL fail silently if its prerequisite is unavailable (run-kit missing, port in use, server fails to start) — skip the remaining steps without surfacing an error.
