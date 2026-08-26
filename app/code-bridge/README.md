# rk-code-bridge

VS Code extension that lets the run-kit CLI (`rk code exec`) run palette commands inside the
editor's extension host from a same-user shell.

On activation it opens a Unix socket at
`$XDG_STATE_HOME/run-kit/cb/<hostId>.sock` (default `~/.local/state/run-kit/cb/`), writes a host
record to `cb/hosts/<hostId>.json`, and serves newline-delimited JSON requests: one request per
connection, one response, then the connection closes.

Security boundary: Unix socket only (never TCP), `cb/` is `0700`, sockets are `0600`, and the
extension refuses to start when an existing `cb/` has looser permissions. Disable with the
`rk.bridge.enabled` setting.

## Development

```sh
pnpm install
pnpm run build       # esbuild bundle → dist/extension.js
pnpm test            # tsc + node --test over a real Unix socket (no VS Code host)
pnpm run typecheck
pnpm run package     # vsce package --no-dependencies [-- <version>]
```
