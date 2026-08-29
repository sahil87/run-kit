---
type: memory
description: "The rk-code-bridge code-server extension + the `rk code` CLI family — a same-user Unix-socket channel into the code lens editor's extension host. Covers the socket + registry contract under $XDG_STATE_HOME/run-kit/cb/, the one-request-per-connection NDJSON protocol (error kinds, __ping/__commands, $uri sugar), exec/hosts/commands + exit codes, host resolution + liveness pruning, VSIX embed/install distribution + version skew, the doctor row, rk skill code, and the same-user security stance."
---
# Code Bridge

**Domain**: run-kit

## Overview

The code bridge is the channel *into* the editor behind the dashboard's `code` lens: the `rk-code-bridge` code-server extension serves `vscode.commands.executeCommand` over a same-user Unix socket, and the `rk code` CLI family is the shell side. It exists because code-server exposes no command channel — its CLI only opens files, the URL `payload=` parameter only supports `openFile`, and the GitHub Pull Requests extension's URI handler is auth-only — so the only place palette commands are callable is inside the extension host. The bridge is peer-to-peer between a shell and an extension host: the daemon, the `/code/` route, and the per-viewer folder latch are not involved. The authoritative design record is [docs/specs/code-bridge.md](../../specs/code-bridge.md). (83jz)

## Shape

```
agent shell / tmux pane          unix socket (0600)                      code-server extension host
rk code exec pr.refreshList ──▶ $XDG_STATE_HOME/run-kit/cb/<hostId>.sock ──▶ rk-code-bridge extension
        │                                                                     net.createServer → executeCommand
        │  looks up host by folder                                            one per open folder/window
        └──────────────▶ $XDG_STATE_HOME/run-kit/cb/hosts/<hostId>.json ◀─── registers on activate
                         {hostId, folder, pid, sock, extVersion, startedAt}
```

Two pieces, one contract:

1. **`rk-code-bridge`** — a VS Code extension at `app/code-bridge/` (TypeScript, pnpm; esbuild bundle → `dist/extension.js`; `vsce package --no-dependencies` → `rk-code-bridge-<version>.vsix`). The runtime dependency set is empty — only the `vscode` API and Node `net`/`fs`/`crypto`/`os`. `activationEvents: ["*"]` (deliberately eager — being reachable before any user action is the point), `engines.vscode: ^1.90.0`, in-tree version `0.0.0-dev` (the release workflow passes the tag version to the package step).
2. **`rk code`** — a cobra command group in `app/backend/cmd/rk/code.go` over the Go client library `internal/codebridge`. The VSIX is embedded in the binary and installed by `rk code-server install` / `update` (§ Distribution).

## Socket and registry contract

- **State dir**: `$XDG_STATE_HOME/run-kit/cb/` (default `~/.local/state/run-kit/cb/`) — runtime state, not config. The extension and the CLI resolve it independently, so `codebridge.StateDir()` mirrors `snapshot.DefaultDir()`'s rule exactly; the two resolutions may never drift apart.
- **Permissions**: `cb/` is created `0700`; the extension refuses to start (logs to its output channel, never throws) when an existing `cb/` has group/other access. The socket is `chmod 0600` after listen.
- **`hostId`**: the first 12 hex chars of `sha1(<workspace folder fsPath> + "\n" + vscode.env.machineId)` — deterministic, so a reloaded window reuses its socket path and record instead of leaking one per reload.
- **Socket**: `cb/<hostId>.sock`; a stale socket file is unlinked on activate (liveness is re-derived by the client per call, so a leftover socket is always stale).
- **Record**: `cb/hosts/<hostId>.json` = `{hostId, folder, pid, sock, extVersion, startedAt}` (RFC 3339), written atomically (temp + rename) so a concurrent reader never sees a partial record. Field names are the extension's JSON contract and must not change.
- **Deactivate**: closes the server and removes both the socket and the record.
- **Activation gates**: `rk.bridge.enabled` `false` (a `contributes.configuration` boolean, default `true`) or no workspace folder → activation returns with no side effects.

## Protocol

Newline-delimited JSON over the socket, **one request per connection** — the bridge stays stateless and the socket ends after one response.

```jsonc
→ {"id":"k3f9","command":"pr.checkoutByNumber","args":[2908],"timeoutMs":30000}
← {"id":"k3f9","ok":true,"result":null,"ms":812}

→ {"id":"q1","command":"nope.doesNotExist","args":[]}
← {"id":"q1","ok":false,"error":{"kind":"unknown-command","message":"command 'nope.doesNotExist' not found"}}
```

- **Error kinds**: `unknown-command` (not in `getCommands(true)`) · `threw` (executor rejection; message = error message) · `timeout` (exceeding `timeoutMs`, default 30000) · `bad-request` (non-JSON or shape-invalid line; the `id` is echoed when parseable, else `null`).
- **Internals**: `__ping` → `{folder, pid, version}`; `__commands` → the full `vscode.commands.getCommands(true)` array.
- **`$uri` sugar**: an object exactly of shape `{"$uri":"<string>"}` at any nesting depth in `args` is rewritten to `vscode.Uri.parse(...)` — `vscode.open` / `vscode.diff` want Uris. No other coercion; plain path-like strings are NOT auto-converted.
- **Serialisation**: results cross as `JSON.stringify`; a value that fails (cycle/BigInt) degrades to `{"$nonSerializable":true,"type":"<typeof or constructor name>"}` — serialisation never throws.
- The protocol/server core (`src/bridge.ts` + `src/protocol.ts`) is **`vscode`-free** — it takes injected deps `{executeCommand, getCommands, parseUri, info}` so it is unit-tested with `node --test` over a real Unix socket; `src/extension.ts` is only the vscode glue.

## The `rk code` family

```
rk code exec <command> [json-arg…]  [--folder <path>] [--host <id>] [--tab [@N]] [--all] [--timeout 30s] [--json]
rk code hosts [--json]
rk code commands [--folder <path>] [--host <id>] [--tab [@N]]
```

- **`exec`** runs any palette command id on the resolved host. Each positional after the command is parsed as a JSON literal (numbers stay numbers, objects pass verbatim — including the `$uri` marker the extension rewrites); anything not valid JSON is sent as a string, so bare words work. A literal `--` ends flag parsing, so negative numbers and `-`-prefixed strings pass as args. `--host`, `--tab`, and `--folder` are pairwise mutually exclusive. The request carries a fresh random `id` and `timeoutMs` = `--timeout` (default 30s); the Go dial+read deadline adds 2s so the extension's own `timeout` error wins while a hung host stays bounded.
- **Output contract** (toolkit Principle 9): the result JSON is stdout data (`null` prints `null`); `--json` prints the raw response envelope. Every verb routes through `newSink(cmd)` — results are `Dataf` (survive `--quiet`); the `using host …` fallback note, prune notices, and the version-skew warning are `Notef` (stderr); error lines are ungated `error: <kind>: <message>` on stderr (a dial/read failure prints `error: <message>` with no kind).
- **Exit codes** (Principle 4): `0` ok; `1` operational (no host, dial failure, `timeout`/`threw`/`unknown-command`/`bad-request`, `--tab` outside tmux without an explicit `@N`); `2` usage (missing command, `--tab`/`--host`/`--folder` flag conflicts, unknown flag, stray arg) — the children re-wrap their `Args` validators with `usageArgs` in `init()`. On `unknown-command` the five closest command ids (prefix, then substring, then edit distance over a best-effort `__commands` fetch) print as a `did you mean:` list on stderr.
- **`hosts`** prints live hosts as aligned `ID  FOLDER  PID  AGE  EXT` rows (age humanised from `startedAt`; a malformed timestamp renders `unknown`), pruning dead records as a side effect. `--json` prints the record array. Zero hosts prints nothing (`[]` under `--json`) and exits 0.
- **`commands`** resolves a host like `exec`, sends `__commands`, and prints one command id per line, sorted — a grep-able view of what the palette can do.
- **Version skew**: when a chosen host's `extVersion` is older than the embedded extension version (`codebridge.OlderThan` — numeric component compare, non-numeric tails like `0.0.0-dev` degrade to their numeric prefix), the CLI prints `code bridge extension v<a> is older than the bundled v<b> — run rk code-server update` on stderr, at most once per invocation. A dev build without an embedded VSIX skips silently. The protocol is additive-only, so skew degrades, never breaks.
- **Registration**: the parent and all three children register unconditionally on `rootCmd` with `Long:` blocks (help-dump platform-stability); the help-dump test pins the `code` subtree at exactly `exec`/`hosts`/`commands`.

## Host resolution and liveness

The registry is a **discovery hint only** — liveness is re-derived on every call, never cached (Constitution II). `codebridge.LiveHosts` treats a record as live only if `kill -0` on its pid succeeds (or returns `EPERM` — the process exists, just not signal-able; false-pruning a live host is worse than keeping it) **and** a `__ping` over its socket answers within 2s. A record failing either check is removed (prune notice on stderr) and excluded.

Resolution order for a single-host verb:

1. `--host <id>` — exact match on `hostId`; an unmatched explicit `--host` is an error, never a fallback.
2. `--tab [@N]` — the tab's `@rk_win_code_root` as the folder source (a `--folder` source, not a new host selector): bare `--tab` resolves the caller's own tab via the shared own-tab resolver (`$TMUX_PANE` → `@N`; outside tmux with no `@N` is exit 1), `@N`/`=session:window` names another tab. The option read is `tmux.GetWindowOption`; a non-empty root feeds the same folder match below. An EMPTY root falls through to the cwd default with a `tab @N has no @rk_win_code_root — falling back to the cwd` note. `--all` ignores `--tab` (the fan-out resolves no tab).
3. The target folder — `--folder`, or by default the git toplevel of the cwd (`git rev-parse --show-toplevel` via `exec.CommandContext` with a 5s timeout, falling back to the cwd itself outside a repo) — matched against record `folder` by exact path first, then the record whose `folder` is the longest **path-component-aware** prefix of the target (`/repo` matches `/repo/x`, not `/repository`).
4. No match: exactly one live host → use it with a `using host <id> (<folder>)` note on stderr; several → exit 1 listing them (`id  folder` rows); none → exit 1 with `no code-bridge host — open the code lens on <folder> (or check ` + "`rk doctor`" + `)`.

`--all` fans out to every live host: default output prints one `<hostId>\t<result JSON>` row per successful host; `--json` prints an array of `{hostId, folder, response}` (a host that failed at the transport layer carries a synthesized not-ok envelope, so the array always has one entry per live host). Exit is `1` when any host errored, else `0`.

## Distribution

- **Build**: `scripts/build.sh` and the release workflow's build job run the extension build (`pnpm install --frozen-lockfile && pnpm run build && pnpm run package -- <version>` in `app/code-bridge/`; `<version>` is the release tag, `0.0.0-dev` locally) and copy the VSIX + a `VERSION` sidecar into `app/backend/build/codebridge/` **before** `go build`. `just setup` installs the extension's deps. CI (`.github/workflows/ci.yml`) runs a `Code bridge (tsc + node --test)` job (`tsc --noEmit` + `node --test` over the compiled tests) wired into the ci-gate's required-jobs list. `.gitignore` covers `app/code-bridge/{dist,*.vsix,node_modules}` and `app/backend/build/codebridge/*` (except `.gitkeep`).
- **Embed**: `//go:embed all:codebridge` → `build.CodeBridge` in `app/backend/build/embed.go`, beside `Frontend`. `codebridge.Embedded() (vsix, version, ok)` reads `rk-code-bridge.vsix` + `VERSION`; an absent VSIX (a dev build without the extension step — the embed dir holds only `.gitkeep`) is `ok=false`, a state not an error — callers skip with a `Notef` and never fail.
- **Install**: `rk code-server install` and `update` (the shared `codeServerInstallToLatest` path), after the binary step succeeds, call `codeserver.InstallBridgeExtension(ctx, home, vsix, version)`. The installed version is read by scanning `<extensionsDir>/run-kit.rk-code-bridge-<v>/package.json` — code-server's stable on-disk layout, pure filesystem, no subprocess (`codeserver.ExtensionsDir(home)` is the one resolution shared by the daemon's spawn flags, the install step, and the doctor row). Equal versions skip with a note; otherwise the VSIX is staged in a private temp dir (0700, removed after) and installed via `<managed code-server binary> --install-extension <vsix> --extensions-dir <dir> --force` under a 2-minute `exec.CommandContext`, printing `Installed code bridge extension v<v>.` A failure of the extension step is a warning, never the verb's exit code — the binary install already succeeded.
- **Respawn rule**: `update` restarts the `rk-code-server` session when `binaryChanged || extensionChanged` — a newly installed extension only loads on a code-server restart, so a bridge-only update still respawns. `install` keeps its migration-only respawn rule. The `rk update` code-server leg inherits both behaviors via `runCodeServerUpdateFlow`.
- **Setting seed**: the daemon's `codeServerSeedSettings` carries `"rk.bridge.enabled": true` (write-once seed; user edits win).

## Doctor row and skill topic

`rk doctor` carries a `code bridge` row after the `code-server` row, always OK-shaped (the bridge is optional tooling, never a dependency failure): `not installed — run rk code-server install` when no `run-kit.rk-code-bridge-*` dir exists in the extensions dir; otherwise `installed v<v>; <N> live host(s)` (N from the same liveness-pruning enumeration `rk code hosts` performs), appending `; bundled v<b> is newer — run rk code-server update` when the embedded version is newer. The check is pure over injected `(extensionsDir, embeddedVersion, listHosts)` inputs so tests never touch the real state dir, and it appears in `--json` like every other check.

`rk skill code` is the agent-facing topic page — canonical at `docs/site/skill/code.md` (≤150 lines, static-only), synced by `scripts/sync-skill.sh` into `cmd/rk/skill/code.md`, embedded and registered in `skillTopics`, drift-guarded like `display`/`mux`. It teaches the gate (`command -v rk` + a live host via `rk code hosts`), the three verbs, the arg rules and `$uri` sugar, the prepare-a-PR-for-review recipe, exit codes, and the gotchas. `docs/site/skill.md` carries the topic-index line and one capability row; the README command table carries the `run-kit code` row.

## Security stance

The bridge is a same-user, local-only RCE into the editor — that is the feature, and the design keeps it at exactly that privilege level and no wider.

- **Unix socket, not TCP** — a localhost port is reachable by any page in the user's browser (a form POST to `127.0.0.1` is not blocked by CORS); a filesystem socket is reachable only by processes that can open a path under the user's state dir.
- `cb/` is `0700`, sockets `0600`; the extension refuses to start on a looser dir. The bridge never binds TCP and never spawns processes.
- **No privilege gained** — anything a caller can do through the bridge it could already do as the same user (edit the extensions dir, edit settings, kill the process), so no `rk.bridge.deny` allowlist ships (theatre against a threat already inside the account). `workbench.action.terminal.sendSequence` is reachable through the bridge — equivalent to typing in the user's terminal, which the calling shell already can.

## Non-goals

- **`rk code open`** — deferred: the code surface's folder is the shared `@rk_win_code_root` tmux option (seeded from the derived git root, moved by the editor's own navigation or `rk tab code set`), so a bridge-level open verb would duplicate the tab verb's write. Until then: `rk tab code set <folder>`, or File > Open Folder in the editor.
- **Remote exec over `rk remote` tunnels** — local-only; a thin daemon proxy can be added later if cross-machine exec is needed.
- **A `rk.bridge.deny` allowlist** — see § Security stance.
- **Marketplace publishing** — distribution is the embedded VSIX only.
- **Any daemon, `/api/*`, frontend, or `/code/` route change** — the lens topology in [docs/specs/right-panel.md](../../specs/right-panel.md) is untouched.

## Requirements

### Requirement: Private same-user socket root
The bridge state root SHALL be `$XDG_STATE_HOME/run-kit/cb/` (default `~/.local/state/run-kit/cb/`), created `0700`; the extension MUST refuse to start (log, no throw) when an existing `cb/` has group/other access, and sockets MUST be `0600`.

#### Scenario: Loose dir refuses to start
- **GIVEN** an existing `cb/` with mode `0755`
- **WHEN** the extension activates
- **THEN** it logs the refusal to its output channel and opens no socket, writes no record, and throws nothing

### Requirement: Deterministic host identity and clean lifecycle
`hostId` SHALL be the first 12 hex chars of `sha1(<folder> + "\n" + machineId)`; activation SHALL unlink a stale socket, listen on `cb/<hostId>.sock`, and write `cb/hosts/<hostId>.json` atomically; deactivation MUST remove both the socket and the record. A disabled `rk.bridge.enabled` or a window with no workspace folder MUST produce no side effects.

#### Scenario: Window reload reuses the host identity
- **GIVEN** code-server reloaded a window on folder `/home/u/code/x`
- **WHEN** the extension host activates again
- **THEN** the same `hostId` reuses the same socket path and record — no second record leaks

### Requirement: One request per connection, four error kinds
The bridge SHALL speak NDJSON with exactly one request and one response per connection; failures MUST classify as `unknown-command` | `threw` | `timeout` | `bad-request`; result serialisation MUST never throw (a non-serialisable value degrades to the `$nonSerializable` marker).

#### Scenario: Malformed line echoes a null id
- **GIVEN** a running bridge and `printf 'not json\n' | nc -U cb/<id>.sock`
- **WHEN** the line arrives
- **THEN** exactly one `{"id":null,"ok":false,"error":{"kind":"bad-request",…}}` line returns and the socket closes

### Requirement: Live-verified host resolution
The CLI MUST treat a registry record as live only when `kill -0` (or `EPERM`) and a 2s `__ping` both succeed, pruning failing records; resolution SHALL be `--host` exact → `--tab`'s `@rk_win_code_root` → folder exact → longest path-component-aware prefix → single-live-host fallback with a stderr note → exit 1 (listing candidates when several, the open-the-lens hint when none). `--tab` SHALL fall through to the cwd default with a note when the tab's code root is empty, and MUST be mutually exclusive with `--host` and `--folder`.

#### Scenario: Worktree resolves to its own host
- **GIVEN** live records A (`/repo`), B (`/repo/.worktrees/x`), C (`/other`), cwd `/repo/.worktrees/x/sub`
- **WHEN** `rk code exec __ping` runs
- **THEN** B is chosen (git toplevel `/repo/.worktrees/x`, exact match); **AND GIVEN** cwd `/repo/deep/x` with no exact record, **THEN** A wins as the longest component-aware prefix

### Requirement: Best-effort extension install
`rk code-server install`/`update` SHALL install the embedded VSIX when the installed version differs (scan of `<extensionsDir>/run-kit.rk-code-bridge-*/package.json`), skip when equal, skip with a note when the build carries no VSIX, and MUST NOT fail the verb on an extension-step error; `update` MUST respawn the `rk-code-server` session when only the extension changed.

#### Scenario: Dev build skips honestly
- **GIVEN** a dev build whose embed dir holds only `.gitkeep`
- **WHEN** `rk code-server install` runs
- **THEN** the extension step is skipped with a note and the exit code is 0

## Design Decisions

### VSIX rides the `build/` embed dir, not a committed binary
**Decision**: The packaged VSIX and its `VERSION` sidecar land in the gitignored `app/backend/build/codebridge/` (committed `.gitkeep`), embedded as an `embed.FS`; an empty dir means "not bundled" and every consumer skips.
**Why**: Identical to how the frontend `dist/` reaches the binary; keeps binaries out of git; a clean `go build ./...` still compiles; dev builds stay honest ("not bundled") instead of shipping a stale VSIX.
**Rejected**: Committing `rk-code-bridge.vsix` under `internal/…` — binary churn in every release diff and a guaranteed drift between source and artifact.
*Introduced by*: 260826-83jz-code-bridge-extension

### Installed-extension inventory is read from the extensions dir, not `code-server --list-extensions`
**Decision**: Both the install skip check and the doctor row scan `<extensionsDir>/run-kit.rk-code-bridge-<v>/package.json` (numerically greatest version wins when a partial upgrade left several dirs).
**Why**: Pure filesystem, no subprocess, testable with a temp dir, and works when code-server is not running; the directory naming `<publisher>.<name>-<version>` is code-server's stable on-disk layout.
**Rejected**: Spawning `code-server --list-extensions --show-versions` — a ~1s Node boot per doctor run and a subprocess dependency in a read-only check.
*Introduced by*: 260826-83jz-code-bridge-extension

### Host registry is a discovery hint verified live on every call
**Decision**: `cb/hosts/*.json` is written by the extension and consulted by the CLI, but a record counts only after `kill -0` **and** `__ping` succeed in the same call; failures prune it.
**Why**: Constitution II — no request-time read treats a file as the source of truth; the live socket is.
**Rejected**: Scanning `cb/*.sock` alone (no folder metadata without a round-trip to every socket).
*Introduced by*: 260826-83jz-code-bridge-extension

### `vscode`-free bridge core
**Decision**: `src/bridge.ts` + `src/protocol.ts` implement socket serving, framing, timeouts, `$uri` rewriting, and result serialisation over an injected executor; `src/extension.ts` is only the vscode glue.
**Why**: The `vscode` module exists only inside an extension host, so the codec/server is tested with plain `node --test` over a real Unix socket.
**Rejected**: `@vscode/test-electron` integration tests — downloads VS Code in CI for a small extension.
*Introduced by*: 260826-83jz-code-bridge-extension

### Nested subcommands re-wrap their own `Args` validators
**Decision**: The `code` children wrap their `Args` validators with `usageArgs` in their own `init()` loop rather than relying on root's central wrap.
**Why**: Root's wrap loop covers only `rootCmd`'s direct children, so nested subcommands would otherwise leak arg-count violations out of the usage class (exit 2); the one-place idiom mirrors `code_server.go`.
**Rejected**: Extending root's loop to walk the whole tree (churns a shared mechanism for one group); per-command ad-hoc arg checks (scatters the convention).
*Introduced by*: 260826-83jz-code-bridge-extension

### The Go deadline adds slack to the extension-enforced timeout
**Decision**: The request's `timeoutMs` is `--timeout` (extension-enforced); the Go dial+read deadline is `--timeout` + 2s.
**Why**: The extension's own `timeout` error — a classified, actionable kind — wins the race, while a hung host (dead socket, no response) stays bounded on the client side.
**Rejected**: A single deadline on both sides (a client-side win surfaces as an unclassified transport error); relying on the extension alone (a wedged extension host blocks the CLI indefinitely).
*Introduced by*: 260826-83jz-code-bridge-extension

### `--tab` is a `--folder` source, not a new host selector
**Decision**: `--tab` resolves the tab's `@rk_win_code_root` into `Selector.Folder` and reuses the existing exact/longest-prefix folder match in `codebridge.Resolve`; the tab is resolved through the shared `cmd/rk/owntab.go` resolver (bare `--tab` = own tab via `NoOptDefVal`).
**Why**: the folder IS the host identity the bridge already matches on, so the tab needs no new selector dimension; an empty root degrades to the ordinary cwd default rather than failing.
**Rejected**: a new `Selector.WindowID` field with its own matcher (duplicates the folder logic); failing on an empty code root (the tab simply never had `rk tab code set` run).
*Introduced by*: 260829-c143-rk-tab-cli-present-sugar

### One state-dir resolution rule, mirrored in two runtimes
**Decision**: `codebridge.StateDir()` mirrors `snapshot.DefaultDir()`'s rule exactly, and the extension implements the same rule in TypeScript.
**Why**: The extension (Node) and the CLI (Go) resolve `cb/` independently with no shared process — if the rules drift, hosts register where the CLI never looks.
**Rejected**: A config key or env override for the bridge dir (new config surface for a path that should follow the state root convention).
*Introduced by*: 260826-83jz-code-bridge-extension

See [architecture](/run-kit/architecture.md) § CLI Subcommands (`code` row) and § Backend Libraries (`internal/codebridge`), [configuration](/run-kit/configuration.md) § Boundaries for the state-dir tenant, and [toolkit-standards](/run-kit/toolkit-standards.md) for the new-surface conformance check.
