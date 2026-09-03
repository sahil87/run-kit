# Intake: Code Bridge — `rk code exec` + the `rk-code-bridge` code-server extension

**Change**: 260826-83jz-code-bridge-extension
**Created**: 2026-08-26

## Origin

Conversational. Started in a loom `/fab-discuss` session (2026-08-26) where the user asked how far an
agent can control the run-kit environment — open tabs, web/terminal tiles, the code-server tile — and
specifically whether an agent can run VS Code command-palette commands (the GitHub Pull Requests
extension's `pr.*` commands) inside the code tile to prepare a PR for review. Investigation against the
live install (rk v3.18.1, code-server 4.112 on `127.0.0.1:3002`, PR extension 0.144.0) showed everything
up to the extension host is controllable, but no external channel into the extension host exists. The
user asked for a design, agreed to it, corrected the directory layout (XDG, not the legacy `~/.rk`), and
redirected the work here:

> I agree. Lets build a bridge extension. […] Save this design in the specs. And create an intake to take
> this forward using another agent (dont execute it). […] This needs to happen in the run-kit repo.

The design is saved as [`docs/specs/code-bridge.md`](../../../docs/specs/code-bridge.md). **That spec
is the authoritative design; this intake summarises it and records the decisions.** While porting it
here, one correction was made against run-kit's own specs: the draft's `rk code open` sugar (over
`rk present :3002`) is wrong because the `code` lens folder is a per-viewer latch
([`right-panel.md`](../../../docs/specs/right-panel.md) § The `code` lens); it is deferred to the
`@rk_code_folder` upgrade path.

## Why

1. **Pain point.** Agents can put content in front of the user (`rk present`) and the `code` lens shows
   the repo, but nothing can act *inside* the editor. For "prepare PR #N for review" the agent checks the
   branch out and stops — refreshing the PR view, focusing the PR sidebar, opening the first diffs are all
   human clicks.
2. **Consequence.** The "agent prepares, human reviews" loop run-kit exists for breaks at the editor
   boundary; agents fall back to describing what to click.
3. **Why this approach.** code-server has no command channel (CLI opens files only; URL `payload=`
   supports only `openFile`; the PR extension's URI handler is auth-only). The only place
   `vscode.commands.executeCommand()` is callable is inside the extension host, so the minimal correct
   fix is a tiny extension exposing it over a same-user Unix socket, plus an `rk` subcommand that speaks
   to it. File spool, localhost HTTP, a daemon proxy, keystroke injection, and forking code-server were
   considered and rejected (spec § Alternatives considered).

## What Changes

### 1. `rk-code-bridge` extension — `app/code-bridge/`

- TypeScript; deps `vscode` API + Node `net`; esbuild bundle; `vsce package` → `rk-code-bridge-<v>.vsix`,
  version = rk release version. `activationEvents: ["*"]`.
- Activate: ensure `$XDG_STATE_HOME/run-kit/cb/` (default `~/.local/state/run-kit/cb/`) exists 0700 —
  refuse to start if looser; `hostId` = short hash(workspace folder, machine id); unlink stale
  `cb/<hostId>.sock`; `net.createServer` on it, chmod 0600; write `cb/hosts/<hostId>.json` =
  `{hostId, folder, pid, sock, extVersion, startedAt}`. Deactivate: remove socket + record.
- NDJSON, one request per connection: `{"id","command","args":[…],"timeoutMs"}` →
  `{"id","ok":true,"result","ms"}` | `{"id","ok":false,"error":{"kind","message"}}`,
  `kind ∈ unknown-command | threw | timeout | bad-request`.
- Internals: `__ping` → `{folder, pid, version}`; `__commands` → `vscode.commands.getCommands(true)`.
- Arg sugar: `{"$uri":"file:///…"}` → `vscode.Uri.parse`. No other coercion. Results via
  `JSON.stringify`; non-serialisable → `{"$nonSerializable":true,"type"}`.
- Setting `rk.bridge.enabled` (default `true`), declared in `contributes.configuration`.

### 2. `rk code` command group — `app/backend/cmd/…`, `internal/codebridge`

```
rk code exec <command> [json-arg…]  [--folder <path>] [--host <id>] [--all] [--timeout 30s] [--json]
rk code hosts [--json]
rk code commands [--folder]
```

- Args are JSON literals; bare words become strings.
- Host resolution: `--host` → `--folder` (default git toplevel of cwd; exact, then longest-prefix on record
  `folder`) → single live host with stderr note → else exit 1 listing hosts.
- Liveness: `kill -0 pid` **and** `__ping` answers; otherwise prune the record.
- Toolkit contract: stdout data / stderr diagnostics; exit `0`/`1`/`2`; `--quiet` (Principle 9);
  `unknown-command` → exit 1 + closest matches on stderr.

### 3. Distribution

- `//go:embed` the VSIX in `internal/installers`; `rk code-server install` / `update` run
  `code-server --install-extension <tmp.vsix> --extensions-dir ~/.local/share/code-server/extensions`
  when installed ≠ embedded version; restart the `rk-code-server` sibling session as today.
- CLI warns on stderr when a host's `extVersion` < embedded; protocol additive-only.
- `rk doctor`: "code bridge" line (installed / live hosts).
- `rk skill code` topic page; `rk help-dump` new-surface check (toolkit-standards).
- Release workflow: build the VSIX before the Go build.
- `fab/project/config.yaml` `source_paths`: add `app/code-bridge/`.

### 4. Phasing

| Phase | Deliverable |
|-------|-------------|
| P1 spike | Extension + hand-installed VSIX + `nc -U` script; proves socket path, eager activation, `executeCommand` from a socket callback |
| P2 | `rk code exec / hosts / commands`; resolution; embed + install; `rk doctor` line |
| P3 | `rk skill code`; `rk code open` only once `@rk_code_folder` exists |

## Affected Memory

- `run-kit/code-bridge`: (new) the bridge — socket + registry contract, protocol, `rk code` family,
  host resolution, install/version-skew story, security stance
- `run-kit/architecture`: (modify) add `internal/codebridge`, the embedded VSIX in `internal/installers`,
  and the `rk code` CLI group
- `run-kit/configuration`: (modify) new state-dir tenant `$XDG_STATE_HOME/run-kit/cb/` next to
  `snapshots/`; `rk.bridge.enabled` lives in the managed code-server profile, not `config.yaml`
- `run-kit/toolkit-standards`: (modify) new-surface check covers `rk code`

## Impact

- **New**: `app/code-bridge/` (extension), `app/backend/internal/codebridge/` (client + resolver),
  `rk code` cobra group.
- **Modified**: `internal/installers` (embed + install step), `rk doctor`, `rk skill` bundle
  (+ `code` topic), release workflow (VSIX build), `fab/project/config.yaml` source_paths.
- **Runtime footprint**: `$XDG_STATE_HOME/run-kit/cb/`. Nothing under `~/.config/run-kit`; daemon
  untouched; `/code/` route and latch untouched.
- **Dependencies**: `@types/vscode`, `esbuild`, `@vscode/vsce` (dev-only) in the extension; no new Go deps.
- **Tests**: Go unit tests for arg parsing, host resolution, liveness pruning, protocol envelope; an
  extension smoke test over a real socket (Node, no VS Code host) for the request/response codec.

## Open Questions

- Command group name: `rk code exec` (recommended) or fold into `rk code-server`?
- Should P2 make exec reachable over `rk remote` tunnels (needs a daemon proxy), or stay local-only (recommended)?
- Ship a `rk.bridge.deny` setting as belt-and-braces despite the spec's argument against it (recommended: no)?
- Does P3's `rk code open` pull the `@rk_code_folder` tmux-option upgrade forward, or wait for its own change?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Transport is a Unix socket under `$XDG_STATE_HOME/run-kit/cb/`, not TCP/HTTP or a file spool | Discussed — user agreed; state root matches `layout-snapshots`; security argument in spec | S:90 R:70 A:90 D:90 |
| 2 | Certain | NDJSON protocol, one request per connection, `__ping`/`__commands`, `$uri` marker | Presented in the design the user accepted; fully specified in the spec | S:90 R:85 A:90 D:85 |
| 3 | Certain | No `rk code open` in v1 — deferred to `@rk_code_folder` | `right-panel.md` makes the latch per-viewer localStorage; a CLI cannot set it today | S:80 R:90 A:90 D:85 |
| 4 | Confident | VSIX `go:embed`ded and installed by `rk code-server install/update` | Those commands already own the extensions dir and the `rk-code-server` restart | S:65 R:80 A:80 D:75 |
| 5 | Confident | Extension source at `app/code-bridge/`, client at `internal/codebridge` | Mirrors `app/{backend,desktop,frontend}` and the `internal/*` library split in `architecture` | S:60 R:85 A:75 D:70 |
| 6 | Confident | Command group is `rk code`, not `rk code-server` | Lean in spec; user has not chosen; trivially renamed before merge | S:50 R:90 A:45 D:40 |
| 7 | Confident | Local-only in P2; `rk remote` deferred | Spec recommends defer; additive later | S:45 R:85 A:50 D:45 |
| 8 | Confident | No `rk.bridge.deny` in v1 | Same-user privilege argument; ten-line addition if wanted | S:50 R:95 A:60 D:45 |
| 9 | Confident | Eager activation (`activationEvents: ["*"]`) | Reachability before any user action is the point; `onStartupFinished` is the fallback | S:55 R:90 A:65 D:50 |

9 assumptions (3 certain, 6 confident, 0 tentative, 0 unresolved).
