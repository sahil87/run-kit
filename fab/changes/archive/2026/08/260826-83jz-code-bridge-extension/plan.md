# Plan: Code Bridge — `rk code exec` + the `rk-code-bridge` code-server extension

**Change**: 260826-83jz-code-bridge-extension
**Intake**: `intake.md`

> Authoritative design: [`docs/specs/code-bridge.md`](../../../docs/specs/code-bridge.md). This plan
> binds it to the codebase as it exists at HEAD. Two corrections against the intake's file map,
> both recorded in `## Assumptions`: (a) there is no `internal/installers` package — the code-server
> installer is `internal/codeserver`, and build-time artifacts are embedded from
> `app/backend/build/` (`build/embed.go`, gitignored payload + `.gitkeep`), so the VSIX rides that
> mechanism; (b) code-server's extension inventory is read from the extensions dir on disk, not by
> spawning `code-server --list-extensions`.

## Requirements

### Extension: `app/code-bridge/` package and lifecycle

#### R1: Extension package scaffold
The extension SHALL live at `app/code-bridge/` as a TypeScript VS Code extension managed by pnpm:
`package.json` (`name: rk-code-bridge`, `publisher: run-kit`, `displayName: run-kit Code Bridge`,
`version: 0.0.0-dev` in-tree, `engines.vscode: ^1.90.0`, `activationEvents: ["*"]`, `main: ./dist/extension.js`,
`contributes.configuration` declaring `rk.bridge.enabled` boolean default `true`), `tsconfig.json`,
an esbuild bundle script (`pnpm run build` → `dist/extension.js`, `vscode` external), a
`pnpm run package [-- <version>]` script that runs `vsce package --no-dependencies` producing
`rk-code-bridge-<version>.vsix`, `pnpm test` running Node's built-in test runner over the compiled
codec/server tests, and dev deps `@types/vscode`, `@types/node`, `esbuild`, `typescript`, `@vscode/vsce`.
The runtime dependency set MUST be empty (only the `vscode` API and Node `net`/`fs`/`crypto`/`os`).

- **GIVEN** a checkout with `pnpm` available
- **WHEN** `cd app/code-bridge && pnpm install --frozen-lockfile && pnpm run build && pnpm test && pnpm run package`
- **THEN** `dist/extension.js` exists, tests pass, and an `rk-code-bridge-0.0.0-dev.vsix` is produced

#### R2: Activation opens a same-user Unix socket and registers a host record
On activate the extension MUST: (1) return early without side effects when `rk.bridge.enabled` is
`false` or there is no workspace folder; (2) resolve the state dir `$XDG_STATE_HOME/run-kit/cb/`
(default `~/.local/state/run-kit/cb/`), create it and `cb/hosts/` with mode `0700`, and refuse to
start (log to an output channel, no throw) when an existing `cb/` has permissions looser than `0700`;
(3) compute `hostId` = first 12 hex chars of `sha1(<workspace folder fsPath> + "\n" + vscode.env.machineId)`;
(4) unlink a stale `cb/<hostId>.sock`; (5) `net.createServer` on that path and `chmod 0600` it;
(6) write `cb/hosts/<hostId>.json` = `{hostId, folder, pid, sock, extVersion, startedAt}` atomically
(write temp + rename). On deactivate it MUST close the server and remove both the socket and the record.

- **GIVEN** code-server opens folder `/home/u/code/x` with the extension installed
- **WHEN** the extension host activates
- **THEN** `cb/<hostId>.sock` is listening with mode `0600`, `cb/` is `0700`, and `cb/hosts/<hostId>.json` names that folder, the host's pid, and the extension version
- **AND WHEN** the window is reloaded, the same `hostId` (deterministic hash) reuses the paths instead of leaking a second record

#### R3: NDJSON request/response protocol, one request per connection
The bridge SHALL speak newline-delimited JSON. Each connection carries exactly one request
`{"id","command","args":[…],"timeoutMs"}` and receives exactly one response, then the server ends
the connection: `{"id","ok":true,"result","ms"}` on success or `{"id","ok":false,"error":{"kind","message"}}`
with `kind ∈ {unknown-command, threw, timeout, bad-request}`. Rules: a non-JSON or shape-invalid line
→ `bad-request` (with `id` echoed when parseable, else `null`); a command not in
`vscode.commands.getCommands(true)` → `unknown-command`; an executor rejection → `threw` (message =
error message); exceeding `timeoutMs` (default 30000) → `timeout`. Internals: `__ping` →
`{folder, pid, version}`; `__commands` → the full `getCommands(true)` array. Arg sugar: any object
exactly of shape `{"$uri": "<string>"}` at any nesting depth in `args` is replaced by `vscode.Uri.parse(<string>)`;
no other coercion. Results are serialised via `JSON.stringify`; a value that fails to serialise
(cycle/BigInt) becomes `{"$nonSerializable":true,"type":"<typeof or constructor name>"}` — serialisation
never throws. The protocol/server core MUST be a `vscode`-free module (`src/bridge.ts`) taking an
injected `{executeCommand, getCommands, parseUri, info}` so it is unit-testable in plain Node.

- **GIVEN** a running bridge and `printf '{"id":"a","command":"__ping"}\n' | nc -U cb/<id>.sock`
- **WHEN** the line arrives
- **THEN** exactly one line `{"id":"a","ok":true,"result":{"folder":…,"pid":…,"version":…},"ms":N}` is returned and the socket closes
- **AND GIVEN** `{"id":"b","command":"nope.x"}` **THEN** `{"id":"b","ok":false,"error":{"kind":"unknown-command","message":"command 'nope.x' not found"}}`
- **AND GIVEN** a line `not json` **THEN** an `ok:false` `bad-request` response with `"id":null`

### CLI: `rk code` command group

#### R4: `rk code exec <command> [json-arg…]`
`rk code exec` SHALL parse each positional after `<command>` as a JSON literal, falling back to a
string when the token is not valid JSON (bare words → strings; `--` ends flag parsing so negative
numbers and `-`-prefixed strings pass), connect to the resolved host's socket, send one request with
a fresh random `id` and `timeoutMs` = `--timeout` (default `30s`; the Go dial+read deadline is
`--timeout` + 2s), and print the result. Default output: the `result` JSON on stdout (`null` prints
`null`); `--json` prints the raw response envelope instead. Flags: `--folder <path>`, `--host <id>`,
`--all`, `--timeout <duration>`, `--json`. Exit codes follow the toolkit convention: `0` ok; `1`
operational (no host, dial failure, `timeout`, `threw`, `unknown-command`, `bad-request`); `2` usage
(missing `<command>`, `--host` together with `--folder`, unknown flag). An `unknown-command` error
MUST print the closest matching command ids (top 5 by prefix/substring/edit distance from a
`__commands` fetch) on stderr after the error line. Errors print as `error: <kind>: <message>` on stderr.

- **GIVEN** a live host for the cwd's repo
- **WHEN** `rk code exec pr.checkoutByNumber 2908`
- **THEN** the request carries `"args":[2908]` (a number, not a string), stdout is the result JSON, exit 0
- **AND GIVEN** `rk code exec vscode.open '{"$uri":"file:///tmp/a.ts"}'` **THEN** the arg is sent verbatim (the extension performs the Uri rewrite)
- **AND GIVEN** `rk code exec nope.doesNotExist` **THEN** exit 1, stderr has `error: unknown-command: …` followed by a `did you mean:` list

#### R5: Host resolution and liveness
The Go client (`internal/codebridge`) SHALL enumerate `cb/hosts/*.json`, and treat a record as live
only if `syscall.Kill(pid, 0)` succeeds (or returns `EPERM`) **and** a `__ping` over its socket
answers within 2s; a record failing either check is removed (pruned) and excluded. Resolution order
for a single-host verb: (1) `--host <id>` exact match on `hostId`; (2) the target folder — `--folder`
or, by default, the git toplevel of the cwd (`git rev-parse --show-toplevel` via `exec.CommandContext`
with a 5s timeout; fall back to the cwd when not in a repo) — matched against record `folder` by
exact path first, then the record whose `folder` is the longest prefix of the target (path-component
aware); (3) no match and exactly one live host → use it and print `using host <id> (<folder>)` on
stderr; several → exit 1 listing them (`id  folder` rows on stderr); none → exit 1 with the hint
"no code-bridge host — open the code lens on <folder> (or check `rk doctor`)". `--all` fans out to
every live host: default output prints `<hostId>\t<result JSON>` per host; `--json` prints a JSON
array of `{hostId, folder, response}`; exit is `1` if any host errored, else `0`. The state dir
resolver `codebridge.StateDir()` MUST mirror `snapshot.DefaultDir()` (`$XDG_STATE_HOME/run-kit/cb`,
else `~/.local/state/run-kit/cb`). The registry is a discovery hint only: liveness is re-derived on
every call, never cached (Constitution II).

- **GIVEN** records A (`/repo`), B (`/repo/.worktrees/x`), C (`/other`), all live, cwd `/repo/.worktrees/x/sub`
- **WHEN** `rk code exec __ping`
- **THEN** B is chosen (git toplevel `/repo/.worktrees/x`, exact match)
- **AND GIVEN** cwd `/repo/pkg` (toplevel `/repo`) **THEN** A is chosen by exact match; **AND GIVEN** a target `/repo/deep/x` with no exact record **THEN** A wins as the longest prefix (`/repo` beats nothing; `/rep` would not match — component-aware)
- **AND GIVEN** a record whose pid is dead **THEN** the JSON file is removed and it never appears in `rk code hosts`

#### R6: `rk code hosts` and `rk code commands`
`rk code hosts` SHALL print live hosts as aligned rows `ID  FOLDER  PID  AGE  EXT` (age from
`startedAt`, humanised) on stdout, pruning dead records as a side effect; `--json` prints the array of
records; zero hosts prints nothing (`[]` under `--json`) and exits 0. `rk code commands [--folder]`
SHALL resolve a host like `exec`, send `__commands`, and print one command id per line sorted.
Every verb routes through `newSink(cmd)`: results are `Dataf` (stdout, survive `--quiet`);
the `using host …` note, prune notices, and the version-skew warning are `Notef` (stderr). When a
chosen host's `extVersion` is older than the embedded extension version, the CLI MUST print
`code bridge extension v<a> is older than the bundled v<b> — run rk code-server update` on stderr
once per invocation. The `code` group and its three children register unconditionally on `rootCmd`
with `Long:` blocks, and re-wrap their `Args` validators with `usageArgs` in `init()` (root's wrap
loop covers only direct children).

- **GIVEN** two live hosts
- **WHEN** `rk code hosts`
- **THEN** two rows print on stdout; `rk code hosts --quiet` prints the same rows
- **AND WHEN** `rk code hosts x` **THEN** exit 2 (arg-count usage error)

### Distribution: embed, install, doctor

#### R7: VSIX embedded via the `build/` embed dir and installed by `rk code-server install`/`update`
The build SHALL place the packaged extension at `app/backend/build/codebridge/rk-code-bridge.vsix`
plus a sibling `VERSION` file (the extension's version string), both gitignored with a committed
`.gitkeep`, embedded as `//go:embed all:codebridge` (`build.CodeBridge embed.FS`) beside `Frontend`.
`codebridge.Embedded() (vsix []byte, version string, ok bool)` returns `ok=false` when the dir holds
no VSIX (a dev build without the extension step) — callers then skip with a `Notef` and never fail.
`rk code-server install` and `update` (the shared `codeServerInstallToLatest` path) SHALL, after
the binary step succeeds, call `codeserver.InstallBridgeExtension(ctx, home, vsix, version)`, which:
reads the installed version by scanning `<extensionsDir>/run-kit.rk-code-bridge-<v>/package.json`
(same `codeServerExtensionsDir` resolution the daemon uses — move that helper to `internal/codeserver`
and have the daemon import it); when installed == embedded → skip (`Notef` "code bridge extension
v<v> already installed"); otherwise write the VSIX to a temp file and run
`<managed code-server binary> --install-extension <tmp.vsix> --extensions-dir <dir> --force` via
`exec.CommandContext` with a 2-minute timeout, then `Dataf` "Installed code bridge extension v<v>."
and return `changed=true`. `update`'s respawn decision becomes `binaryChanged || extensionChanged`,
so a bridge-only update still restarts the `rk-code-server` session (install keeps its existing
migration-only respawn rule). A failure of the extension step is a warning (`Notef`), never the
verb's exit code — the binary install already succeeded. The `rk update` code-server leg inherits
this by sharing `runCodeServerUpdateFlow`. `codeServerSeedSettings` gains `"rk.bridge.enabled": true`.

- **GIVEN** a release build (VSIX embedded, version `3.19.0`) and no extension installed
- **WHEN** `rk code-server install`
- **THEN** `code-server --install-extension … --extensions-dir ~/.local/share/code-server/extensions --force` runs once and stdout has `Installed code bridge extension v3.19.0.`
- **AND WHEN** run again **THEN** no subprocess runs and stderr notes it is already installed
- **AND GIVEN** a dev build with an empty embed dir **THEN** the step is skipped with a note and exit is 0

#### R8: `rk doctor` "code bridge" row
`rk doctor` SHALL add a `code bridge` check after the `code-server` row, always OK-shaped: note
`not installed — run rk code-server install` when no `run-kit.rk-code-bridge-*` dir exists in the
extensions dir; otherwise `installed v<v>; <N> live host(s)` (N from the same liveness-pruning
enumeration as `rk code hosts`, `0` when none), appending `; bundled v<b> is newer — run rk code-server update`
when the embedded version is newer. It is pure over injected `(extensionsDir, hosts lister)` inputs so
tests never touch the real state dir, and it appears in `--json` like every other check.

- **GIVEN** the extension installed and one live host
- **WHEN** `rk doctor`
- **THEN** stderr has `  [ OK ] code bridge — installed v3.19.0; 1 live host(s)` and the overall verdict is unaffected

### Build, CI, and docs

#### R9: Build pipeline and CI build the extension before the Go build
`scripts/build.sh` and the release workflow's build job SHALL run the extension build
(`pnpm install --frozen-lockfile && pnpm run build && pnpm run package -- <version>` in `app/code-bridge/`,
`<version>` = the release version, `0.0.0-dev` locally) and copy the VSIX + `VERSION` into
`app/backend/build/codebridge/` before `go build`; `just setup` installs the extension's deps.
CI (`.github/workflows/ci.yml`) SHALL gain a `Code bridge (tsc + node --test)` job running
`pnpm install --frozen-lockfile`, `npx tsc --noEmit`, and `pnpm test` in `app/code-bridge/`, wired
into the CI gate's required-jobs list. `.gitignore` covers `app/code-bridge/dist/`, `app/code-bridge/*.vsix`,
`app/code-bridge/node_modules/`, and `app/backend/build/codebridge/*` (except `.gitkeep`).

- **GIVEN** a tag `v3.19.0`
- **WHEN** the release workflow runs
- **THEN** the packaged VSIX is `rk-code-bridge-3.19.0.vsix`, embedded into every cross-compiled `rk`, and `VERSION` reads `3.19.0`

#### R10: `rk skill code` topic page and toolkit-standard surfaces
A new topic page `docs/site/skill/code.md` (≤150 lines, static-only) SHALL teach agents the bridge:
when to reach for it, the gate (`command -v rk` + a live host via `rk code hosts`), `exec`/`hosts`/
`commands` usage with the arg rules and `$uri` sugar, the "prepare PR for review" recipe, exit codes,
and the gotchas (folder latch is per-viewer; no `rk code open` yet; same-user-only). It is synced by
`scripts/sync-skill.sh` into `cmd/rk/skill/code.md`, embedded and registered in `skillTopics` as
`code`, drift-guarded (`TestSkillCodeEmbedMatchesCanonical`, line budget) like `display`/`mux`.
`docs/site/skill.md` gains the topic-index line and one capability row (staying ≤150 lines). The
README command table gains a `run-kit code` row. `TestCaptureNodeRealTreeSelfExcludesAndDepth`
asserts the `code` subtree has exactly `exec`, `hosts`, `commands`. `fab/project/config.yaml`
`source_paths` gains `app/code-bridge/`.

- **GIVEN** the built binary
- **WHEN** `rk skill code`
- **THEN** stdout is byte-identical to `docs/site/skill/code.md`, stderr empty, exit 0; `rk skill bogus` still exits 2 naming `code, display, mux`

### Non-Goals

- `rk code open` — deferred to the `@rk_code_folder` upgrade path (spec § No `rk code open`).
- Reaching hosts over `rk remote` tunnels — local-only in this change.
- A `rk.bridge.deny` allowlist/denylist — same-user privilege argument (spec § Security).
- Marketplace publishing of the extension — distribution is the embedded VSIX only.
- Any daemon, `/api/*`, frontend, or `/code/` route change.

### Design Decisions

#### VSIX rides the `build/` embed dir, not a committed binary
**Decision**: The packaged VSIX and its `VERSION` land in the gitignored `app/backend/build/codebridge/`
(committed `.gitkeep`), embedded as an `embed.FS`; an empty dir means "not bundled" and every consumer skips.
**Why**: Identical to how the frontend `dist/` reaches the binary; keeps binaries out of git; a clean
`go build ./...` still compiles; dev builds stay honest ("not bundled") instead of shipping a stale VSIX.
**Rejected**: Committing `rk-code-bridge.vsix` under `internal/…` — binary churn in every release diff
and a guaranteed drift between source and artifact.
*Introduced by*: 260826-83jz-code-bridge-extension

#### Installed-extension inventory is read from the extensions dir, not `code-server --list-extensions`
**Decision**: Both the install skip check and the doctor row scan `<extensionsDir>/run-kit.rk-code-bridge-<v>/package.json`.
**Why**: Pure filesystem, no subprocess, testable with a temp dir, and works when code-server is not running;
the directory naming `<publisher>.<name>-<version>` is code-server's stable on-disk layout.
**Rejected**: Spawning `code-server --list-extensions --show-versions` — a ~1s Node boot per doctor run and
a subprocess dependency in a read-only check.
*Introduced by*: 260826-83jz-code-bridge-extension

#### Host registry is a discovery hint verified live on every call
**Decision**: `cb/hosts/*.json` is written by the extension and consulted by the CLI, but a record counts
only after `kill -0` **and** `__ping` succeed in the same call; failures prune it.
**Why**: Constitution II — no request-time read treats a file as the source of truth; the live socket is.
**Rejected**: Scanning `cb/*.sock` alone (no folder metadata without a round-trip to every socket).
*Introduced by*: 260826-83jz-code-bridge-extension

#### `vscode`-free bridge core
**Decision**: `src/bridge.ts` implements socket serving, framing, timeouts, `$uri` rewriting and result
serialisation over an injected executor; `src/extension.ts` is only the vscode glue.
**Why**: The `vscode` module exists only inside an extension host, so the codec/server can be tested with
plain `node --test` over a real Unix socket (the intake's smoke-test requirement).
**Rejected**: `@vscode/test-electron` integration tests — downloads VS Code in CI for a 60-line extension.
*Introduced by*: 260826-83jz-code-bridge-extension

## Tasks

### Phase 1: Setup

- [x] T001 Scaffold `app/code-bridge/` — `package.json` (name/publisher/version `0.0.0-dev`/engines/`activationEvents: ["*"]`/`main`/`contributes.configuration` for `rk.bridge.enabled`/scripts `build`, `package`, `test`, `typecheck`), `tsconfig.json` (ES2022, NodeNext, strict, `outDir dist`), `esbuild.mjs` (bundle `src/extension.ts` → `dist/extension.js`, platform node, `vscode` external), `.vscodeignore`, `README.md`; install dev deps with pnpm and commit `pnpm-lock.yaml` <!-- R1 -->
- [x] T002 [P] Add `.gitignore` entries (`app/code-bridge/dist/`, `app/code-bridge/*.vsix`, `app/code-bridge/node_modules/`, `app/backend/build/codebridge/*` + `!.gitkeep`), create `app/backend/build/codebridge/.gitkeep`, add `app/code-bridge/` to `fab/project/config.yaml` `source_paths` <!-- R9 -->
- [x] T003 [P] Add `//go:embed all:codebridge` → `CodeBridge embed.FS` in `app/backend/build/embed.go` with a doc comment mirroring `Frontend`'s <!-- R7 -->

### Phase 2: Core Implementation

- [x] T004 Implement `app/code-bridge/src/protocol.ts` (request/response types, `parseRequest` → request | bad-request, `rewriteUriMarkers(args, parseUri)`, `safeSerialize(result)`) and `app/code-bridge/src/bridge.ts` (`startBridge({socketPath, deps, defaultTimeoutMs})` → `net.Server`; one request per connection; `__ping`/`__commands`; unknown-command via `getCommands`; timeout race; `threw` mapping; always ends the socket after one response) <!-- R3 -->
- [x] T005 Add `app/code-bridge/test/bridge.test.ts` (compiled to `dist-test/` by `pnpm test` via `tsc -p tsconfig.test.json` then `node --test`): drive a real Unix socket in a temp dir through a fake executor — ping, unknown-command, threw, timeout, bad-request (non-JSON, missing command), `$uri` rewrite at nested depth, non-serialisable result marker, connection closes after one response <!-- R3 -->
- [x] T006 Implement `app/code-bridge/src/extension.ts`: `activate` (enabled + workspace-folder gates, `stateDir()` from `XDG_STATE_HOME`/`~/.local/state`, `ensureDir0700` refusing looser perms, `hostId` sha1 hash, stale-socket unlink, `startBridge` with vscode deps, chmod 0600, atomic `hosts/<id>.json` write, output channel logging) and `deactivate` (close server, remove socket + record); `pnpm run build` and `pnpm run package` must succeed <!-- R2 -->
- [x] T007 Create `app/backend/internal/codebridge/` — `state.go` (`StateDir()` mirroring `snapshot.DefaultDir`, `HostsDir`), `record.go` (`HostRecord` struct, `ReadRecords(dir)`), `client.go` (`Request`/`Response`/`ErrorKind` types, `Call(ctx, sock, req) (Response, error)` over `net.DialTimeout` + NDJSON, `Ping`), `resolve.go` (`LiveHosts(ctx, dir)` with kill-0 + ping + prune, `Resolve(ctx, hosts, Selector{HostID, Folder})` implementing exact → component-aware longest-prefix → single-host fallback, `ErrNoHost`/`ErrAmbiguous` carrying the host list), `args.go` (`ParseArgs([]string) []json.RawMessage` JSON-literal-or-string), `suggest.go` (`Closest(cmd, all []string, n)`), `version.go` (`OlderThan(a, b string) bool` for semver-ish `extVersion`), `embedded.go` (`Embedded()` reading `build.CodeBridge` for `rk-code-bridge.vsix` + `VERSION`) <!-- R5 -->
- [x] T008 Unit tests `app/backend/internal/codebridge/*_test.go`: `ParseArgs` (numbers, objects, bare words, quoted strings, negative numbers), `Resolve` (the R5 scenario set incl. component-aware prefix and ambiguity), `LiveHosts` pruning (dead pid record removed; live pid but no socket removed) using an in-test Unix socket server, `Call` envelope round-trip against a fake NDJSON server (success, error kinds, timeout via deadline), `Closest`, `OlderThan`, `StateDir` env handling <!-- R5 -->
- [x] T009 Implement `app/backend/cmd/rk/code.go` — `codeCmd` group + `exec`/`hosts`/`commands` with `Long:` blocks, flags (`--folder`, `--host`, `--all`, `--timeout`, `--json`), git-toplevel default folder via `exec.CommandContext` (reuse an existing repo-root helper if one exists — check `internal/riff`/`internal/wt` for `rev-parse --show-toplevel`), sink routing per R6, version-skew warning, `unknown-command` suggestions, `--all` fan-out output shapes, exit-code classes via `usageError`, `usageArgs` re-wrap in `init()`, registration on `rootCmd` in `root.go` <!-- R4 -->
- [x] T010 Tests `app/backend/cmd/rk/code_test.go`: exec success prints result JSON only, `--json` prints the envelope, bare-word vs JSON args, exit 2 on missing command and `--host`+`--folder`, exit 1 with `did you mean:` on unknown-command, `hosts` table + `--json` + empty + `--quiet` parity, `commands` sorted output, `--all` fan-out formats, skew warning on stderr — all against fake hosts served from a temp `XDG_STATE_HOME` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Move `codeServerExtensionsDir` from `internal/daemon/codeserver.go` to `internal/codeserver` (exported `ExtensionsDir(home)`; daemon imports it) and add `internal/codeserver/extension.go`: `InstalledBridgeVersion(extensionsDir) (string, error)` scanning `run-kit.rk-code-bridge-*/package.json`, `InstallBridgeExtension(ctx, home, vsix []byte, version string, progress io.Writer) (changed bool, err error)` writing a temp VSIX and running the managed binary with `--install-extension … --extensions-dir … --force` under a 2-minute `exec.CommandContext`; unit tests with a fake `code-server` shell script recording argv and a fixture extensions dir <!-- R7 -->
- [x] T012 Wire the install step into `cmd/rk/code_server.go`: after `codeServerInstallToLatest` succeeds in both `runCodeServerInstall` and `runCodeServerUpdateFlow`, call a new `installBridgeExtension(cmd, sink, home)` (skips with `Notef` when `codebridge.Embedded()` is not ok; warns — never errors — on failure); `update` respawns when `binaryChanged || extensionChanged`; add `"rk.bridge.enabled": true` to `codeServerSeedSettings`; extend `code_server_test.go` + the daemon seed test <!-- R7 -->
- [x] T013 Add the `code bridge` doctor row: `codeBridgeCheck(extensionsDir string, embeddedVersion string, listHosts func() (int, error)) doctorCheck` in `cmd/rk/doctor.go`, appended after the code-server row; tests in `doctor_test.go` for not-installed / installed+N hosts / bundled-newer / enumeration-error notes and `--json` presence <!-- R8 -->
- [x] T014 Build + CI wiring: extend `scripts/build.sh` with the extension build/package/copy step (version arg defaulting to `0.0.0-dev`), `just setup` installs `app/code-bridge` deps, `.github/workflows/release.yml` build job builds/packages with the release version and copies into `app/backend/build/codebridge/` before Cross-compile, `.github/workflows/ci.yml` gains the `Code bridge (tsc + node --test)` job and the CI gate lists it <!-- R9 -->

### Phase 4: Polish

- [x] T015 Write `docs/site/skill/code.md` (≤150 lines), add the `code` row to `scripts/sync-skill.sh` and run it, embed + register `code` in `cmd/rk/skill.go`, add `TestSkillCodeEmbedMatchesCanonical` + line-budget test in `skill_test.go`, add the topic-index line and a capability row to `docs/site/skill.md` (re-sync; stay ≤150 lines), add the `run-kit code` row to the README command table <!-- R10 -->
- [x] T016 Update `cmd/rk/help_dump_test.go` `TestCaptureNodeRealTreeSelfExcludesAndDepth` to assert the `code` subtree (`exec`, `hosts`, `commands`, exactly 3), then run `just test-backend`, `cd app/code-bridge && pnpm run typecheck && pnpm test`, and `scripts/build.sh` end-to-end (the built `bin/rk doctor` shows the `code bridge` row) <!-- R10 -->

## Execution Order

- T001 blocks T004–T006; T003 blocks T007's `embedded.go`; T007 blocks T009/T010/T011–T013
- T011 blocks T012 and T013 (both consume `codeserver.ExtensionsDir` / `InstalledBridgeVersion`)
- T014 depends on T006 (the package script must work) and T003
- T015/T016 last — they assert the final command tree and bundle bytes

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/code-bridge/` builds, tests, and packages a VSIX with pnpm; runtime dependency set is empty
- [x] A-002 R2: Activation creates `cb/` (0700), the `0600` socket, and the atomic host record; deactivate removes socket and record; disabled setting / no folder → no side effects
- [x] A-003 R3: The bridge core implements every error kind, `__ping`/`__commands`, `$uri` rewrite, and never-throwing serialisation, and is `vscode`-free
- [x] A-004 R4: `rk code exec` parses JSON-literal args, prints result / envelope, and maps outcomes to exit 0/1/2 with suggestions on unknown-command
- [x] A-005 R5: `internal/codebridge` resolves hosts exact → longest-prefix → single-host fallback and prunes dead records via kill-0 + ping
- [x] A-006 R6: `rk code hosts`/`commands` print data on stdout, notes/skew warning on stderr, and re-wrap `Args` with `usageArgs`
- [x] A-007 R7: The VSIX + `VERSION` embed from `build/codebridge/`, `install`/`update` install the extension when versions differ, skip when equal, and never fail the verb on extension errors
- [x] A-008 R8: `rk doctor` shows the `code bridge` row (OK-shaped) in human and `--json` output
- [x] A-009 R9: `scripts/build.sh`, `just setup`, release, and CI build/test the extension before the Go build
- [x] A-010 R10: `rk skill code` is byte-identical to `docs/site/skill/code.md`, drift-guarded, and the help-dump test pins the `code` subtree

### Behavioral Correctness

- [x] A-011 R7: `rk code-server update` respawns the `rk-code-server` session when only the extension changed
- [x] A-012 R7: `codeServerExtensionsDir` moved to `internal/codeserver` without changing the daemon's spawn args

### Scenario Coverage

- [x] A-013 R3: A `node --test` smoke test drives a real Unix socket through ping / unknown-command / threw / timeout / bad-request / `$uri` / non-serialisable cases
- [x] A-014 R5: Go tests cover the worktree-under-repo resolution scenario, ambiguity, and none
- [x] A-015 R4: Go tests cover `--all` output shapes and `--quiet` parity of data lines

### Edge Cases & Error Handling

- [x] A-016 R2: An existing `cb/` with permissions looser than 0700 makes the extension refuse to start (logged, no throw)
- [x] A-017 R5: A live pid whose socket is gone is pruned; `EPERM` from kill-0 counts as alive
- [x] A-018 R7: A dev build with an empty embed dir skips the extension install with a note and exit 0
- [x] A-019 R4: `--timeout` is honoured on the Go side (dial + read deadline) so a hung host cannot block the CLI indefinitely

### Code Quality

- [x] A-020 Pattern consistency: new cobra verbs mirror `code_server.go`/`present.go` (package seams for tests, `newSink`, `Long:` blocks, `usageArgs`)
- [x] A-021 No unnecessary duplication: state-dir resolution mirrors `snapshot.DefaultDir`; a single `ExtensionsDir` helper is shared by daemon, installer, and doctor
- [x] A-022 Security First: every subprocess (`git rev-parse`, `code-server --install-extension`) uses `exec.CommandContext` with an explicit timeout and argument slice
- [x] A-023 No Database: the host registry is never treated as authoritative — liveness is re-derived per call
- [x] A-024 Tests included: Go unit tests for args/resolution/liveness/protocol/install/doctor and a Node smoke test for the codec/server
- [x] A-025 Comment discipline: comments state constraints (socket perms, one-request-per-connection, why the registry is a hint), never narration or change IDs
- [x] A-026 Frontend type discipline (extension TS): type narrowing over `as` casts in `protocol.ts`/`bridge.ts`

### Security

- [x] A-027 R2: Socket is `0600`, `cb/` is `0700`, and the bridge never binds TCP or spawns processes
- [x] A-028 R7: The VSIX temp file is written to a private temp dir and removed after install

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Follow-on Work

Not part of this change (see § Non-Goals). What turns the shipped capability into something agents
actually use, in order — mirrored in `docs/specs/code-bridge.md` § Follow-on work:

1. **Agent discovery.** `rk skill code` covers the rk side; each consuming repo's toolkit skill (e.g.
   loom's `.claude/skills/shll-toolkit`) needs a pointer so an agent asked to "prep PR #N" reaches for
   `rk code exec` instead of describing clicks. *Consumer repos.*
2. **`/review-prep <pr>` recipe.** Worktree + `gh pr checkout`, wait for `rk code hosts` to show the
   folder, then `pr.refreshList`, focus the PR sidebar, open the first diffs, `rk notify`. The motivating
   use case — the item that makes the bridge visible day to day. *Consumer repos.*
3. **Latch gap — `@rk_code_folder` + `rk code open <folder>`.** The recipe keeps one human step (open
   the code surface once so the folder latches). Landing the deferred `@rk_code_folder` tmux-option store
   from `right-panel.md` and wrapping it as `rk code open` removes it. *Own run-kit change.*
4. **Fold into existing review skills.** `git-pr-review`-style skills that review via `gh` in the
   terminal can additionally stage the review in the code tile — an amendment, not a new skill.
   *Consumer repos.*

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The only relocated symbol, `codeServerExtensionsDir` (`internal/daemon/codeserver.go` → exported `codeserver.ExtensionsDir` in `internal/codeserver/extension.go`), was moved with its sole daemon call site updated in the same diff; no orphan remains.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | VSIX embedded from `app/backend/build/codebridge/` (gitignored + `.gitkeep`) via `build/embed.go`, not from a non-existent `internal/installers` | The intake's package does not exist; `build/embed.go` is the repo's one build-artifact embed mechanism | S:70 R:85 A:90 D:85 |
| 2 | Certain | Install step lives in `internal/codeserver` (the code-server installer package); client/resolver in `internal/codebridge` | Direct mapping of the spec's "next to the code-server installer" onto the real package | S:75 R:85 A:90 D:85 |
| 3 | Confident | Installed version read by scanning `<extensionsDir>/run-kit.rk-code-bridge-<v>/` rather than `code-server --list-extensions` | code-server's on-disk layout is stable; avoids a subprocess in doctor | S:55 R:85 A:75 D:70 |
| 4 | Confident | In-tree extension version `0.0.0-dev`; release workflow passes the tag version to `pnpm run package -- <v>`; `VERSION` sidecar carries it into the embed | Spec: "version pinned to the rk release version"; keeps the repo free of version-bump commits | S:60 R:85 A:75 D:65 |
| 5 | Confident | `hostId` = first 12 hex of `sha1(folder + "\n" + vscode.env.machineId)` | Spec says "short hash of (workspace folder, machine id)"; exact width unspecified | S:60 R:90 A:80 D:70 |
| 6 | Confident | `--all` output: `<hostId>\t<result>` per line; `--json` → array of `{hostId, folder, response}`; exit 1 if any host errored | Spec names the flag only; tab-separated rows are the grep-able default | S:45 R:90 A:70 D:55 |
| 7 | Confident | Go-side deadline = `--timeout` + 2s; extension `timeoutMs` = `--timeout` | Lets the extension's own `timeout` error win while still bounding a hung host | S:50 R:90 A:80 D:70 |
| 8 | Confident | `bad-request`/`threw`/`timeout`/`unknown-command` all exit 1; only client-side arg/flag problems exit 2 | Toolkit P4: server-reported failures are operational | S:60 R:90 A:80 D:70 |
| 9 | Confident | Extension install failure is a warning on `install`/`update`, never the exit code; `update` respawns on extension-only change | Mirrors the best-effort posture of the `rk update` code-server leg; a new extension only loads on restart | S:55 R:85 A:75 D:65 |
| 10 | Confident | `rk.bridge.enabled: true` added to `codeServerSeedSettings` (write-once seed) | Spec says the setting is written into the managed profile alongside `chat.disableAIFeatures` | S:65 R:95 A:85 D:75 |
| 11 | Confident | `kill -0` returning `EPERM` counts as alive | Standard liveness idiom; a same-user host never hits it but the check must not false-prune | S:50 R:90 A:85 D:75 |
| 12 | Confident | Longest-prefix folder match is path-component aware (`/repo` matches `/repo/x`, not `/repository`) | Prevents a false hit on sibling directories sharing a string prefix | S:55 R:90 A:85 D:80 |
| 13 | Confident | Extension tests use `node --test` over compiled JS; no `@vscode/test-electron` | Intake: "extension smoke test over a real socket (Node, no VS Code host)" | S:70 R:90 A:85 D:80 |
| 14 | Tentative | `engines.vscode: ^1.90.0` | code-server 4.112 ships Code 1.112; a lower floor keeps older installs compatible, exact floor unverified <!-- assumed: engines floor ^1.90.0 — well below code-server 4.112's Code 1.112, unverified against older managed installs --> | S:35 R:95 A:60 D:50 |

14 assumptions (2 certain, 11 confident, 1 tentative).
