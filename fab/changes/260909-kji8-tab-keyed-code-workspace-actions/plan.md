# Plan: Tab-keyed code-server workspaces + run-kit context-menu actions in the code bridge extension

**Change**: 260909-kji8-tab-keyed-code-workspace-actions
**Intake**: `intake.md`

## Requirements

### Backend: derived per-tab workspace file (`internal/codeworkspace`)

#### R1: One derived `.code-workspace` file per (server, tab, code root)
A new Go package `app/backend/internal/codeworkspace` SHALL derive, on demand, a VS Code workspace file that carries the tab identity into the code-server extension host. `StateDir()` MUST resolve `$XDG_STATE_HOME/run-kit/code/` (default `~/.local/state/run-kit/code/`) by exactly the rule `codebridge.StateDir()` uses. `Path(stateDir, server, windowID, root)` MUST return `<stateDir>/<server>/<windowID>-<hash6>.code-workspace` where `hash6` is the first 6 lowercase hex chars of `sha256(<absolute root>)`. `Content(root, windowID, server)` MUST render exactly `{"folders":[{"path":<root>}],"settings":{"rk.tab":<windowID>,"rk.server":<server>}}` (`json.MarshalIndent`, trailing newline, no other keys). `Ensure(stateDir, server, windowID, root)` MUST create the server dir `0700`, compare existing content byte-for-byte, write only when absent or different (temp + rename, mode `0600`), and return the path. `server` and `windowID` MUST be validated (`validate.ValidateServerName`, `validate.ValidateWindowID`) before they touch a path. The file is a derived artifact: deleting it MUST change nothing but a regeneration. No GC in this change.

- **GIVEN** an empty state dir, server `default`, window `@7`, root `/home/u/code/x`
- **WHEN** `Ensure` is called twice
- **THEN** the first call writes `<stateDir>/default/@7-<hash6>.code-workspace` with the exact content above and mode `0600`
- **AND** the second call rewrites nothing (mtime unchanged) and returns the same path

- **GIVEN** the file was deleted, **WHEN** `Ensure` runs again, **THEN** the identical file is regenerated
- **GIVEN** the same `@7` but a different root, **WHEN** `Path` is computed, **THEN** the filename differs (different `hash6`)
- **GIVEN** an invalid window id (`7`, `@x`) or server name (`../etc`), **WHEN** `Ensure` is called, **THEN** it returns an error and writes nothing

### Backend: the one GET route that writes the file

#### R2: `GET /api/windows/{windowId}/code-workspace`
The API SHALL expose `GET /api/windows/{windowId}/code-workspace?server=<s>` (registered beside `GET /api/windows/{windowId}/history` in `api/router.go`). The handler MUST read the live `@rk_win_code_root` via `tmux.GetWindowOption` at request time (never cached), call `codeworkspace.Ensure`, and respond `200 {"path":"<abs .code-workspace>","root":"<abs root>"}`. An empty code root MUST respond `409 {"error":"window has no code root"}`. An invalid window id or server MUST respond `400`; an unknown window `404`; an `Ensure` failure `500` with the error text. This handler is the ONLY daemon-side writer of workspace files; `rk tab code set` MUST NOT write one.

- **GIVEN** window `@7` with `@rk_win_code_root=/home/u/code/x`
- **WHEN** `GET /api/windows/@7/code-workspace?server=default`
- **THEN** `200` with `path` ending in `/code/default/@7-<hash6>.code-workspace` and `root` = `/home/u/code/x`, and the file exists on disk

- **GIVEN** `@rk_win_code_root` is empty, **WHEN** the GET runs, **THEN** `409 {"error":"window has no code root"}` and no file is written
- **GIVEN** window id `7` (no `@`), **WHEN** the GET runs, **THEN** `400`

### Backend: `rk` binary path for the extension host

#### R3: The daemon's code-server spawn carries `RK_BIN`
`internal/daemon/codeserver.go`'s spawn argv MUST pass `RK_BIN=<selfpath.Resolve()>` in the existing `env -u VSCODE_IPC_HOOK_CLI …` prefix (i.e. `env -u VSCODE_IPC_HOOK_CLI RK_BIN=/abs/rk <binary> …`). When self-path resolution fails, the element MUST be omitted (spawn proceeds without it). Externally managed instances are untouched.

- **GIVEN** the daemon resolves its own binary at `/x/bin/rk`, **WHEN** it spawns `rk-code-server`, **THEN** the argv contains `RK_BIN=/x/bin/rk` immediately after `-u VSCODE_IPC_HOOK_CLI` and before the code-server binary
- **GIVEN** self-path resolution errors, **WHEN** it spawns, **THEN** no `RK_BIN=` element is present and the spawn still runs

### Backend: tab-aware host records and resolution (`internal/codebridge`, `cmd/rk/code.go`)

#### R4: `HostRecord`/`Selector` gain `tab` + `server`; `Resolve` matches tab first
`HostRecord` SHALL gain `Tab string \`json:"tab,omitempty"\`` and `Server string \`json:"server,omitempty"\`` (the six existing field names unchanged). `Selector` SHALL gain `Tab, Server string`. `Resolve` order MUST become: (1) `HostID` exact; (2) `Tab`+`Server` exact match when both selector fields are set; (3) `Folder` exact, then longest component-aware prefix; (4) single-live fallback (`fallback=true`); else `ErrAmbiguous`/`ErrNoHost` as today.

- **GIVEN** live hosts A `{tab:@7, server:default, folder:/repo}` and B `{folder:/repo}` (no tab)
- **WHEN** `Resolve` runs with `Selector{Tab:"@7", Server:"default", Folder:"/repo"}`
- **THEN** A is chosen (tab-direct beats the folder match)

- **GIVEN** only B, **WHEN** the same selector runs, **THEN** B is chosen via the folder fallback
- **GIVEN** a record JSON with `tab`/`server`, **WHEN** it round-trips through `ReadRecords`, **THEN** both fields are preserved; a record without them decodes with empty strings

#### R5: `rk code exec`/`commands` resolve by tab directly; own tab is the in-tmux default; `hosts` shows TAB/SERVER
`resolveCodeHost` MUST, for `--tab [@N]`, resolve the address through `resolveTabAddr` as today, set `Selector.Tab`/`Selector.Server`, AND still read `@rk_win_code_root` into `Selector.Folder` (empty root keeps today's `falling back to the cwd` note). With no `--host`/`--tab`/`--folder`, a caller inside a tmux pane MUST first resolve its own tab (best-effort via the shared own-tab resolver; outside tmux or with a malformed `$TMUX` the step is skipped silently) and set `Selector.Tab/Server`, then fall through to the cwd-toplevel folder ladder. An explicit `--folder` MUST skip the own-tab step. `rk code hosts` MUST render `TAB` and `SERVER` columns (`-` when absent) and carry the fields under `--json`. The ambiguous-hosts listing MUST include the tab. No new verbs (the help-dump pin over `exec`/`hosts`/`commands` holds).

- **GIVEN** two live hosts on the same folder `/wt` with tabs `@3` and `@5`, and the caller's pane is in window `@5`
- **WHEN** `rk code exec __ping` runs with no flags
- **THEN** the `@5` host is chosen (own-tab direct), with no `using host` note

- **GIVEN** the same hosts and the caller is outside tmux, **WHEN** `rk code exec __ping --folder /wt` runs, **THEN** resolution ends in `ErrAmbiguous` listing both hosts with their tabs
- **GIVEN** `rk code hosts`, **WHEN** one host has a tab and one has none, **THEN** the table shows `@3 default` on the first row and `- -` on the second

### Frontend: `?workspace=` derivation, mount gating, follow rule

#### R6: Workspace URL derivation + client fetch
`code-surface.tsx` SHALL export `codeServerWorkspaceSrc(workspacePath)` = `` `/code/?workspace=${encodeURIComponent(workspacePath)}` `` beside the existing `codeServerSrc(folder)` (relative path, never an origin or port; `/code/` pathname constant). `client.ts` SHALL export `fetchCodeWorkspace(server, windowId): Promise<CodeWorkspaceResult>` over `GET /api/windows/{windowId}/code-workspace` via `deduplicatedFetch`, where a `409` resolves to a typed `{ status: "no-root" }` result (not a throw) and `200` to `{ status: "ok", path, root }`.

- **GIVEN** path `/home/u/.local/state/run-kit/code/default/@7-3fa1c9.code-workspace`, **WHEN** `codeServerWorkspaceSrc` is called, **THEN** the result is `/code/?workspace=` + the encoded path, contains no `http`/origin/port, and differs for a different path
- **GIVEN** the GET returns 409, **WHEN** `fetchCodeWorkspace` resolves, **THEN** the result is `{status:"no-root"}` and nothing throws

#### R7: The code tile mounts on the workspace URL, gated on the substrate root
The code tile MUST mount its iframe only once the workspace path is known: the existing `codeRootSeed` behavior is unchanged; when the payload's `win.codeRoot` (the substrate value, not the `gitRoot` fallback) is non-empty, the frontend fetches the workspace and mounts the iframe at `codeServerWorkspaceSrc(path)`. Until then the tile MUST render a pending state (`data-testid="code-surface-pending"`, terse monospace `opening…`, the `code-surface-empty` styling). A `409` MUST keep the pending state and re-fetch on the next payload change. A non-409 failure (5xx, network) MUST degrade to today's `codeServerSrc(codeRootFor(win))` (`?folder=`) so the editor still opens, logging once to the console. The mount-generation `src` ref discipline is unchanged: the `src` is fixed once per mount generation.

- **GIVEN** a window whose `codeRoot` is empty and `gitRoot` is `/repo`, **WHEN** the code tile first renders, **THEN** the seed POST fires, the tile shows `code-surface-pending`, and after the payload carries `codeRoot=/repo` the GET runs and the iframe mounts at `/code/?workspace=<path>`
- **GIVEN** the GET fails with 500, **WHEN** the tile renders, **THEN** the iframe mounts at `/code/?folder=<encoded root>` (degrade) and one console warning is emitted
- **GIVEN** the tile is mounted, **WHEN** `codeRoot` changes without an editor-initiated navigation, **THEN** the live frame's `src` is not rewritten

#### R8: File > Open Folder re-derives the workspace and re-navigates the frame (the one sanctioned parent navigation)
When the editor navigates itself to a bare `/code/?folder=<new>`, the existing `onFolderNavigated` load-seam report MUST fire as today, and `app.tsx`'s handler MUST (1) POST `@rk_win_code_root=<new>` as today, (2) fetch the workspace path for the new root, and (3) re-navigate the frame to `codeServerWorkspaceSrc(newPath)` through a `CodeSurface` prop change honored exactly when it follows an editor-initiated folder navigation. A frame whose `?folder=` equals the current root MUST NOT be re-navigated. The `onFolderNavigated` seam MUST stay silent for a frame at `?workspace=…` (no `folder` param).

- **GIVEN** the editor is at `/code/?workspace=<path-for-/repo>`, **WHEN** the user does File > Open Folder `/other`, **THEN** the frame loads at `/code/?folder=/other`, `onFolderNavigated("/other")` fires, `@rk_win_code_root` is set to `/other`, the GET returns the new path, and the frame is navigated to `/code/?workspace=<path-for-/other>`
- **GIVEN** the frame loads at `/code/?workspace=…`, **WHEN** the load handler runs, **THEN** `onFolderNavigated` is not called

### Extension: tab identity, hostId, record, `rk` resolution (`app/code-bridge`)

#### R9: Settings, identity, context key, hostId, record fields
`package.json` `contributes.configuration` SHALL declare `rk.tab` (string, `""`), `rk.server` (string, `""`), and `rk.bridge.rkPath` (string, `""`) beside `rk.bridge.enabled`. A pure `src/tab.ts` SHALL export `readTabIdentity(get)` returning `{tab, server}` only when `rk.tab` matches `^@\d+$` and `rk.server` matches `^[A-Za-z0-9_.-]+$`, else `null`. On activate the extension MUST `setContext('rk.hasTab', identity !== null)` and re-evaluate on `onDidChangeConfiguration` for the `rk` section. `hostId` MUST be `sha1(<identityPath>\n<machineId>)[:12]` where `identityPath` is `vscode.workspace.workspaceFile.fsPath` when the window was opened from a `.code-workspace` AND the identity is present, else the first folder's `fsPath` as today. The host record MUST gain `tab` and `server` (present only with an identity; the six existing names unchanged), and `__ping`'s `info` MUST gain the same two optional fields (`BridgeInfo` in `bridge.ts`, additive).

- **GIVEN** a workspace file whose settings carry `rk.tab=@7`, `rk.server=default`, **WHEN** the extension activates, **THEN** `rk.hasTab` is true, `hostId` hashes the workspace file path, and `cb/hosts/<hostId>.json` carries `"tab":"@7","server":"default"`
- **GIVEN** a plain folder window (no workspace file), **WHEN** it activates, **THEN** `rk.hasTab` is false, hostId hashes the folder path as today, and the record has no `tab`/`server` keys
- **GIVEN** `rk.tab=7` (no `@`) or `rk.server=""`, **WHEN** `readTabIdentity` runs, **THEN** it returns `null`

#### R10: `rk` resolution ladder and argv-only runner
`src/rk.ts` SHALL resolve the rk binary as: `rk.bridge.rkPath` setting (non-empty, absolute) → `process.env.RK_BIN` → the bare name `rk` (PATH via `execFile`). `runRk(argv, {timeoutMs, stdin?})` MUST use `child_process.execFile(rkPath, argv, {timeout, maxBuffer})` with an argv array, pipe `stdin` when given, and resolve `{code, stdout, stderr}` (a spawn `ENOENT` MUST surface as a distinguishable result, not a throw). No shell strings anywhere. Runtime dependencies stay empty.

- **GIVEN** `rk.bridge.rkPath=/opt/rk`, `RK_BIN=/x/rk`, **WHEN** the path is resolved, **THEN** `/opt/rk` wins; with an empty setting `/x/rk` wins; with neither, `rk`
- **GIVEN** a stub script that echoes its argv and stdin, **WHEN** `runRk(["a","b c"], {stdin:"hi"})` runs, **THEN** the stub received exactly two argv elements (`b c` unsplit) and `hi` on stdin

### Extension: the six actions

#### R11: Commands, menus, `when` gating, argv builders
`package.json` SHALL contribute the commands (all `"category": "run-kit"`): `rk.openInWebTile` "Open in Web Tile", `rk.openFolderInWebTile` "Open Folder in Web Tile", `rk.openInWebTileAndNotify` "Open in Web Tile and Notify", `rk.sendToAgent` "Send to Agent", `rk.copyReferenceForAgent` "Copy Reference for Agent", `rk.openPortInWebTile` "Open Port in Web Tile"; and menus: `explorer/context` for the file actions (`rk.hasTab && !explorerResourceIsFolder`) and the folder action (`rk.hasTab && explorerResourceIsFolder`), `editor/title/context` for the file actions (`rk.hasTab`), `editor/context` for Send/Copy (`rk.hasTab && editorHasSelection`), `commandPalette` entries gated on `rk.hasTab` (Open Port palette-only). A pure `src/actions.ts` SHALL export `buildWebAddArgv(identity, target)` → `["tab","web","add",tab,target,"--show","-L",server]`, `buildNotifyArgv(basename)` → `["notify","presenting <basename>","--title","run-kit"]`, `buildSendArgv(identity, {force})` → `["mux","send",tab,"-","--no-enter","-L",server]` plus `"--force"` only when asked, `formatReference(relPath, start, end)`, `buildSendPayload(ref, text)`, and `parsePort(input)` (valid `1–65535` or null). Resource resolution: the `vscode.Uri` argument when present, else `activeTextEditor.document.uri`; non-`file:` schemes ⇒ `showWarningMessage("Only local files can be shown in the Web Tile")`; paths passed as absolute `fsPath`. Timeouts: 15 s for web add / notify, 20 s for send. Multi-select acts on the first resource.

- **GIVEN** identity `{tab:"@7", server:"default"}` and target `/repo/README.md`, **WHEN** `buildWebAddArgv` runs, **THEN** the argv is exactly `["tab","web","add","@7","/repo/README.md","--show","-L","default"]`
- **GIVEN** `buildSendArgv(identity, {force:true})`, **THEN** the argv ends with `--force`; with `{force:false}` it does not contain `--force` and does contain `--no-enter`
- **GIVEN** a host without a tab, **WHEN** the explorer context menu opens, **THEN** no run-kit entries are shown and no command errors

#### R12: Reference payload, send staging + gate handling, error surfacing
`formatReference` MUST render `<relPath>:<N>` for a single line and `<relPath>:<N>-<M>` for a range (1-based; an end at column 0 of a later line is trimmed to the previous line; `relPath` = `vscode.workspace.asRelativePath(uri, false)` with forward slashes). `buildSendPayload` MUST be the reference line, a newline, then the selected text verbatim (no fences, no added trailing newline). Send to Agent MUST run `rk mux send @N - --no-enter -L <server>` with the payload on stdin (staging, never submitting); exit 0 ⇒ status bar `Staged in tab @N` (3 s); exit 1 with a gate refusal ⇒ `showWarningMessage(<stderr first line>, "Force")` where **Force** re-runs the same argv plus `--force`; other non-zero ⇒ `showErrorMessage("run-kit: <stderr first line or exit code>")`. Copy Reference MUST write the reference line to `vscode.env.clipboard` and show `Copied <ref>` for 3 s. Palette invocation of Send/Copy with an empty selection uses the cursor line and no text. Open in Web Tile and Notify MUST run the web add, then on exit 0 the notify. Open Port MUST use `showInputBox` (prompt "Local port", validating `1–65535`) then `buildWebAddArgv(identity, ":<port>")`. An `ENOENT` on the rk binary MUST surface exactly `run-kit: rk not found — set rk.bridge.rkPath`. Web-tile successes are silent.

- **GIVEN** selection lines 10–12 (end at col 0 of line 13) in `src/a.ts`, **WHEN** `formatReference` runs, **THEN** it renders `src/a.ts:10-12`; a single-line selection renders `src/a.ts:10`
- **GIVEN** `rk mux send` exits 1 with stderr `refused: agent active (%3)`, **WHEN** Send to Agent runs, **THEN** a warning with that line and a **Force** button appears; choosing Force re-runs with `--force`
- **GIVEN** `rk` is not resolvable, **WHEN** any action runs, **THEN** exactly the `rk not found — set rk.bridge.rkPath` error appears

### Docs

#### R13: Specs, skill topic page, extension README reflect tab keying and the actions
`docs/specs/code-bridge.md` SHALL document the tab identity (workspace file, `rk.tab`/`rk.server`, hostId rule, record fields), the six actions, the `rk` ladder, and the new resolution order. `docs/specs/right-panel.md` § The `code` lens SHALL mark "keyed by the resolved folder, not window id" as reversed with the rationale (latch solved by `@rk_win_code_root`; tile belongs to the tab; fixes the hostId collision). `docs/specs/ui-state.md` SHALL describe `@rk_win_code_root` → derived workspace file → `?workspace=` and the direct `--tab` lookup. `docs/site/skill/code.md` (≤150 lines; synced to `cmd/rk/skill/code.md` via `scripts/sync-skill.sh`) SHALL gain the tab-direct rule under § Host resolution and a Gotchas note that the editor-side menu actions exist for humans. `app/code-bridge/README.md` SHALL list the settings and the actions.

- **GIVEN** the docs are updated, **WHEN** `scripts/sync-skill.sh` runs, **THEN** `cmd/rk/skill/code.md` is byte-identical to `docs/site/skill/code.md` and the drift-guard test passes

### Non-Goals

- Workspace-file GC — dead windows leave ~150-byte files; a sweep is a recorded follow-up (intake § Open Questions).
- Multi-root `folders` — single element by design.
- Window-level knobs (note / color / marker) from the editor — they belong to the sidebar row.
- Per-extension-host records for the multi-viewer same-tab case — today's last-writer-wins behavior is retained (intake § Open Questions).
- `rk tab code set` pre-warming the workspace file — the GET is the single writer.
- Open in Web Tile for remote/virtual URI schemes; multi-select fan-out.

### Design Decisions

#### The workspace file is the tab-identity carrier
**Decision**: rk derives one `.code-workspace` file per (server, tab, code root) whose `settings` block carries `rk.tab`/`rk.server`; the code tile opens `/code/?workspace=<file>`.
**Why**: It is the only channel code-server hands an extension host arbitrary per-window key/value data; the frontend already controls the iframe `src`; no protocol change, no daemon dependency for the actions.
**Rejected**: A per-tab symlink dir as the `?folder=` carrier (fsPath leaks the symlink everywhere, breaks folder matching and git tooling); `?payload=` (workbench-only, `openFile`); a reverse editor→daemon protocol (unneeded once identity is in settings); a multi-window ambiguity ladder (superseded by exact tab keying).
*Introduced by*: 260909-kji8-tab-keyed-code-workspace-actions

#### The code lens is keyed by tab, not by folder
**Decision**: Host identity and editor state (IndexedDB, keyed by workspace identity) follow the tab; two tabs on one worktree get separate editors and distinct bridge hosts.
**Why**: The right-panel spec's folder keying addressed the latch problem, which `@rk_win_code_root` solved separately; what remained of folder keying was shared editor state across same-folder tabs, which contradicts "the tile belongs to the tab" and caused the same-folder hostId collision.
**Rejected**: Keeping folder keying and adding a tab hint on the side (still collides on hostId; still cannot target from the editor).
*Introduced by*: 260909-kji8-tab-keyed-code-workspace-actions

#### One GET writes the file at "editor about to open"
**Decision**: `GET /api/windows/{windowId}/code-workspace` ensures the file and returns its path; the frontend fetches it at code-tile mount.
**Why**: A browser cannot write to the state dir; the SSE derivation tick is a read path and must not gain a write side effect; shipping paths in every payload would write files for editors never opened. One read-shaped GET satisfies Constitution IV/IX.
**Rejected**: Writing inside the SSE tick; embedding the path in the window payload; letting `rk tab code set` write it (would make the CLI a second writer).
*Introduced by*: 260909-kji8-tab-keyed-code-workspace-actions

#### `RK_BIN` is env-carried; tab identity is not
**Decision**: The daemon's code-server spawn passes `RK_BIN=<self path>`; the extension resolves `rk.bridge.rkPath` → `$RK_BIN` → `rk`.
**Why**: The binary path is per-process (one code-server), so env is the right carrier; tab identity is per-window, so it is not.
**Rejected**: Relying on PATH inheritance alone (works on this host only by accident of how `rk serve -d` was launched).
*Introduced by*: 260909-kji8-tab-keyed-code-workspace-actions

### Deprecated Requirements

#### Folder-keyed code lens (`/code/?folder=<latched folder>` as the primary src)
**Reason**: Replaced by the tab-keyed `?workspace=` form; the `?folder=` form survives only as the degrade path (GET failure) and as the editor's own File > Open Folder navigation, which the follow rule re-derives.
**Migration**: `codeServerWorkspaceSrc(path)` is the primary src; `codeServerSrc(folder)` remains for degrade. IndexedDB editor state is re-keyed once (open editors/layout from the folder identity are not carried over; server-side hot-exit buffers survive).

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/codeworkspace/codeworkspace.go` with `StateDir()`, `Path()`, `Content()`, `Ensure()` per R1 (mirror `codebridge.StateDir()`'s XDG rule; reuse `validate.ValidateServerName`/`validate.ValidateWindowID`; sha256 via `crypto/sha256`), and `codeworkspace_test.go` covering path/hash stability, distinct roots ⇒ distinct names, content shape, ensure idempotency (mtime unchanged), regeneration after deletion, refresh on root change, invalid id/server rejected <!-- R1 -->
- [x] T002 [P] Add `RK_BIN=<selfpath.Resolve()>` to the code-server spawn argv in `app/backend/internal/daemon/codeserver.go` (omit the element when resolution fails) and extend the argv assertions in `codeserver_test.go` (one test with the element present, one with it omitted) <!-- R3 -->
- [x] T003 [P] Declare `rk.tab`, `rk.server`, `rk.bridge.rkPath` in `app/code-bridge/package.json` `contributes.configuration`; add `contributes.commands` (six commands, `"category": "run-kit"`) and `contributes.menus` (`explorer/context`, `editor/title/context`, `editor/context`, `commandPalette`) with the `when` clauses in R11 <!-- R9, R11 -->

### Phase 2: Core Implementation

- [x] T004 Add `GET /api/windows/{windowId}/code-workspace` handler (new `app/backend/api/codeworkspace.go`, registered in `api/router.go` beside the history route): live `tmux.GetWindowOption` read of `@rk_win_code_root`, `codeworkspace.Ensure`, `200 {path, root}` / `409` / `400` / `404` / `500` per R2; handler test with a fake option-reader seam + temp state dir (200 shape, 409 on empty root, 400 on bad id, idempotent second call) <!-- R2 -->
- [x] T005 Extend `app/backend/internal/codebridge/record.go` (`Tab`, `Server` on `HostRecord`) and `resolve.go` (`Tab`, `Server` on `Selector`; the tab-direct step between HostID and Folder); add `resolve_test.go` cases: tab+server beats folder on another host, tab-less host falls back to folder, JSON round-trip of the optional fields <!-- R4 -->
- [x] T006 Wire `app/backend/cmd/rk/code.go`: `--tab` sets `Selector.Tab/Server` and still reads the root into `Selector.Folder`; no-flag path resolves the caller's own tab best-effort (shared own-tab resolver in `owntab.go`) before the cwd-toplevel ladder; `--folder` skips the own-tab step; `hosts` gains `TAB`/`SERVER` columns (`-` placeholders) and `--json` fields; the ambiguous listing prints the tab. Tests in `code_test.go`: same-folder two hosts + own-tab picks the caller's; outside tmux ⇒ folder ladder; explicit `--folder` skips own-tab; `hosts` renders placeholders; help-dump pin unchanged <!-- R5 -->
- [x] T007 [P] Frontend derivation + client: add `codeServerWorkspaceSrc()` to `app/frontend/src/components/code-surface.tsx` and `fetchCodeWorkspace()` (+ `CodeWorkspaceResult` type, 409 ⇒ `{status:"no-root"}`) to `app/frontend/src/api/client.ts`; Vitest cases in `code-surface.test.tsx` (encodes the path, no origin/port, differs per path) and `client.test.ts` (409 mapping) <!-- R6 -->
- [x] T008 [P] Extension identity + rk runner: new `app/code-bridge/src/tab.ts` (`readTabIdentity`), new `src/rk.ts` (`resolveRkPath` ladder, `runRk` over `execFile` with argv arrays, stdin piping, `ENOENT` as a result); `src/bridge.ts` `BridgeInfo` gains optional `tab`/`server`; `src/extension.ts` reads the identity, sets `rk.hasTab` (re-evaluated on config change), computes `hostId` from the workspace-file path when identity is present, and writes `tab`/`server` into the record. Tests: `test/tab.test.ts` (valid/invalid values), `test/rk.test.ts` (ladder precedence; runner against a stub script proving argv is unsplit and stdin arrives) <!-- R9, R10 -->
- [x] T009 Extension actions: new `app/code-bridge/src/actions.ts` (pure builders `buildWebAddArgv`, `buildNotifyArgv`, `buildSendArgv`, `formatReference`, `buildSendPayload`, `parsePort`, timeout constants) and the command registrations in `src/extension.ts` (resource resolution, Force re-run on gate refusal, status-bar messages, `ENOENT` message, InputBox for Open Port); `test/actions.test.ts` asserts every argv element-by-element (target unsplit, `-L <server>`, `--show`, `--no-enter`, `--force` only when asked), reference/payload formatting incl. the column-0 trim, `parsePort` bounds <!-- R11, R12 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Mount gating + degrade in `app/frontend/src/components/code-surface.tsx`, `surface-layout.tsx`, and `app.tsx`: fetch the workspace when the substrate `win.codeRoot` is non-empty, render `code-surface-pending` until the path is known, mount at `codeServerWorkspaceSrc(path)`, keep pending + re-fetch on 409, degrade to `codeServerSrc(codeRootFor(win))` with one console warning on other failures; preserve the mount-generation `src` ref rule. Unit tests for pending → mounted, 409 stays pending, 500 degrades <!-- R7 -->
- [x] T011 Follow rule in `app.tsx` + `CodeSurface`: on `onFolderNavigated(newFolder)` POST the latch as today, `fetchCodeWorkspace` for the new root, and re-navigate the frame via a `workspaceSrc` prop honored only after an editor-initiated folder navigation; a `?folder=` equal to the current root is not re-navigated; the seam stays silent for `?workspace=` frames. Unit test the re-navigation gate <!-- R8 -->
- [x] T012 Update e2e `app/frontend/tests/e2e/code-surface.spec.ts` and `code-folder-latch.spec.ts` (code-server stub harness): iframe `src` assertions move to `/code/?workspace=<path>` with `<path>` read from `GET /api/windows/<id>/code-workspace` in the test; assert the file exists with the expected `folders[0].path`, `rk.tab`, `rk.server`; assert `code-surface-pending` precedes the iframe on first open; assert a deleted file is regenerated on remount; update the JSDoc **Proves:**/**Steps:** blocks per the constitution's Test Intent rule <!-- R7, R2 -->

### Phase 4: Polish

- [x] T013 [P] Docs: update `docs/specs/code-bridge.md` (tab identity, actions, ladder, resolution order), `docs/specs/right-panel.md` § The `code` lens (folder-keying reversed + rationale), `docs/specs/ui-state.md` (derived workspace + direct `--tab`), and `app/code-bridge/README.md` (settings + actions) <!-- R13 -->
- [x] T014 [P] Update `docs/site/skill/code.md` (§ Host resolution tab-direct rule; § Gotchas editor-side actions note; stay ≤150 lines), run `scripts/sync-skill.sh`, and confirm the skill drift-guard test passes <!-- R13 -->
- [x] T015 Verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `cd app/code-bridge && pnpm run typecheck && pnpm test`; `just test-frontend`; `just test-e2e "code-surface|code-folder-latch"`; `just build` <!-- R1 -->

## Execution Order

- T001 blocks T004 (handler imports the package)
- T005 blocks T006 (selector fields)
- T007 blocks T010, T011 (derivation + client)
- T003 and T008 block T009 (manifest + identity/runner)
- T010 blocks T012 (pending testid + workspace src)
- T015 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/codeworkspace` exists with `StateDir`/`Path`/`Content`/`Ensure`; `Ensure` is idempotent, regenerates after deletion, and rejects invalid ids/servers
- [x] A-002 R2: `GET /api/windows/{windowId}/code-workspace` is registered and returns `200 {path, root}` for a rooted window, `409` for an empty root
- [x] A-003 R3: the code-server spawn argv carries `RK_BIN=<self path>` after `-u VSCODE_IPC_HOOK_CLI`
- [x] A-004 R4: `HostRecord`/`Selector` carry `Tab`/`Server`; `Resolve` tries tab+server before folder
- [x] A-005 R5: `rk code exec --tab @N` resolves by tab directly; the in-tmux no-flag default resolves the own tab first; `rk code hosts` shows `TAB`/`SERVER`
- [x] A-006 R6: `codeServerWorkspaceSrc` and `fetchCodeWorkspace` exist with the stated shapes
- [x] A-007 R7: the code tile mounts at `/code/?workspace=<path>` after the GET, showing `code-surface-pending` before
- [x] A-008 R8: an editor-initiated folder navigation re-latches the root and re-navigates the frame to the new `?workspace=` URL
- [x] A-009 R9: the extension declares the three settings, sets `rk.hasTab`, hashes `hostId` from the workspace file when the identity is present, and writes `tab`/`server` into the record and `__ping` info
- [x] A-010 R10: `resolveRkPath` follows setting → `$RK_BIN` → `rk`; `runRk` uses `execFile` with argv arrays and a timeout
- [x] A-011 R11: the six commands and their menus exist with `"category": "run-kit"` and the `rk.hasTab` gating; builders produce the exact argv
- [x] A-012 R12: Send to Agent stages with `--no-enter`, offers Force on a gate refusal; Copy writes the reference; Notify chains web add then notify; Open Port validates the port
- [x] A-013 R13: the three specs, the skill topic page (synced), and the extension README describe tab keying and the actions

### Behavioral Correctness

- [x] A-014 R7: the primary code-tile URL form is `?workspace=`; `?folder=` appears only as the degrade path or the editor's own navigation
- [x] A-015 R4: two hosts on the same folder with different tabs resolve distinctly by tab (no hostId collision)
- [x] A-016 R5: `--all` behavior and the help-dump pin (`exec`/`hosts`/`commands`) are unchanged

### Removal Verification

- [x] A-017 R7: no remaining code path composes `codeServerSrc(...)` as the primary mount src outside the degrade branch

### Scenario Coverage

- [x] A-018 R1: Go tests prove same-root ⇒ same filename, different-root ⇒ different filename, second `Ensure` does not rewrite
- [x] A-019 R2: handler test proves 200 shape, 409 on empty root, 400 on a bad id, idempotent second call
- [x] A-020 R5: `code_test.go` proves own-tab default with two same-folder hosts, the outside-tmux folder ladder, and `--folder` skipping own-tab
- [x] A-021 R9: `test/tab.test.ts` proves `@7`/`default` accepted and `7`/empty server rejected
- [x] A-022 R10: `test/rk.test.ts` proves ladder precedence and that a target with spaces is passed as one argv element
- [x] A-023 R11: `test/actions.test.ts` asserts every argv element and the `--force`-only-when-asked rule
- [x] A-024 R12: `formatReference` trims a column-0 end to the previous line and renders `path:N` for a single line
- [x] A-025 R7: e2e proves the workspace file exists on disk with the expected `folders[0].path`, `rk.tab`, `rk.server`, that pending precedes the iframe on first open, and that a deleted file is regenerated on remount

### Edge Cases & Error Handling

- [x] A-026 R7: a 500 from the GET degrades to `?folder=` with exactly one console warning; a 409 keeps pending and re-fetches on the next payload change
- [x] A-027 R8: a `?folder=` load equal to the current root does not re-navigate; a `?workspace=` load does not fire `onFolderNavigated`
- [x] A-028 R9: a host without an identity hides every run-kit menu/palette entry and never errors
- [x] A-029 R12: an `ENOENT` on rk surfaces exactly `run-kit: rk not found — set rk.bridge.rkPath`; other non-zero exits surface the first stderr line
- [x] A-030 R3: a failed self-path resolution omits `RK_BIN=` and the spawn still runs

### Code Quality

- [x] A-031 Pattern consistency: new Go code follows the seam-var test idiom of `codeserver.go`/`code.go`; new TS follows the pure-module + colocated-test contract
- [x] A-032 No unnecessary duplication: `codeworkspace.StateDir` mirrors, not copies, the `codebridge.StateDir` rule (shared helper or documented one-rule-two-places); `validate` helpers reused; `deduplicatedFetch` reused
- [x] A-033 Security: every subprocess in Go uses `exec.CommandContext` with a timeout; every extension spawn uses `execFile` with an argv array and a timeout; no shell strings, no `exec`/`execSync`
- [x] A-034 No magic strings: settings keys, command ids, testids, and timeout values are named constants
- [x] A-035 Comments state constraints, not narration; no change-ids or PR numbers in code comments
- [x] A-036 Tests accompany every new behavior (Go, node, Vitest, Playwright as planned); e2e `test()` blocks carry **Proves:**/**Steps:** intent comments
- [x] A-037 Constitution II: the workspace file is regenerated on demand and never read as a source of truth; Constitution IX: the new route is a GET (read-shaped) and no PUT/PATCH/DELETE is introduced

### Security

- [x] A-038 R1: `server`/`windowID` are validated before path composition; the state dir is `0700` and files `0600`
- [x] A-039 R9: `rk.tab`/`rk.server` are validated against the stated patterns before becoming argv

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Verification gates (from `fab/project/code-quality.md`): Go tests → `tsc --noEmit` → `just test` → `just build`; run `just setup` once first. Never invoke Playwright directly — use `just test-e2e "<pattern>"`.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The one retirement (the `?folder=` primary mount src) is a *planned* deprecation tracked in `### Deprecated Requirements` and verified under `### Removal Verification` (A-017), not a discovered candidate; `codeServerSrc` stays live as the degrade path and the editor's own File > Open Folder navigation form.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The GET handler lives in a new `api/codeworkspace.go` beside `api/history.go`, registered in `router.go` next to the history route | Matches the one-file-per-resource layout of `api/`; intake names the registration point | S:80 R:95 A:95 D:90 |
| 2 | Confident | `codeworkspace.StateDir()` re-implements the XDG rule rather than importing `codebridge` (avoids an import edge between two sibling libraries); the two are cross-referenced in comments | Mirrors the existing "one rule, two runtimes" discipline the code-bridge memory records; reviewable duplication | S:70 R:90 A:85 D:75 |
| 3 | Confident | The frontend fetches the workspace from `app.tsx`'s layout-state block (where the seed effect already lives) and passes `workspaceSrc` down through `SurfaceLayout` to `CodeSurface`, keeping `CodeSurface` a lean iframe + states component | Existing ownership split: `app.tsx` owns layout/option state, `SurfaceLayout` owns mount-once, `CodeSurface` renders | S:65 R:85 A:85 D:75 |
| 4 | Confident | `runRk`'s `maxBuffer` is 1 MiB; `execFile` `timeout` kills with SIGTERM | Node defaults are 1 MiB / SIGTERM; nothing in the intake asks otherwise | S:50 R:95 A:90 D:85 |
| 5 | Confident | Own-tab resolution inside `rk code` reuses `owntab.go`'s resolver and treats any error (no `$TMUX_PANE`, malformed `$TMUX`) as "skip silently" | Intake says best-effort; the resolver already exists for `--tab`'s bare form | S:75 R:90 A:90 D:85 |
| 6 | Confident | The status-bar messages (`Staged in tab @N`, `Copied <ref>`) use `vscode.window.setStatusBarMessage(text, 3000)` | The intake specifies 3 s status-bar feedback; this is the standard one-call API | S:70 R:95 A:95 D:90 |
| 7 | Confident | A refused `codeRootSeed` POST (e.g. a root outside `$HOME` — `validate.ExpandTilde` rejects it with 400) degrades the code tile to the `?folder=` form instead of pending forever; the rejection is recorded per (server, window, seed value) so a deterministic 400 never becomes per-tick POST spam, and a later successful seed re-arms the `?workspace=` path | R7 gates mounting on the substrate `win.codeRoot`, which never lands when the seed is refused; pre-change behavior mounted the `gitRoot` fallback immediately — the degrade preserves it; decided inline at apply when e2e surfaced the pending-forever regression | S:70 R:85 A:80 D:70 |
| 8 | Confident | The `Resolve` exact-folder step returns its match only when unique; several exact-folder matches with no tab hit yield `ErrAmbiguous` carrying the colliding hosts | Intake § What Changes 6 states this explicitly ("several exact-folder matches without a tab hit still end in `ErrAmbiguous`"); the old first-exact-wins behavior would silently pick an arbitrary host for two same-folder tabbed hosts | S:75 R:80 A:85 D:80 |
| 9 | Confident | `rk code hosts` column order is `ID FOLDER TAB SERVER PID AGE EXT` (new columns after FOLDER, `-` placeholders) | Keeps the two leading identity columns stable; the skill topic page and spec document this order | S:60 R:95 A:90 D:85 |

9 assumptions (1 certain, 8 confident, 0 tentative).
