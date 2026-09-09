# Intake: Tab-keyed code-server workspaces + run-kit context-menu actions in the code bridge extension

**Change**: 260909-kji8-tab-keyed-code-workspace-actions
**Created**: 2026-09-09

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a description synthesized out of a `/fab-discuss` session on 2026-09-09. No questions were asked; every decision the session left open is recorded in `## Assumptions`. The description, verbatim:

> Title direction: Tab-keyed code-server workspaces + run-kit context-menu actions in the code bridge extension.
>
> **Problem.** The `rk-code-bridge` code-server extension needs a new user-facing feature: right-click a file in the editor and send it to the run-kit tab's web tile (`rk present` semantics). The blocker is targeting: the extension host is a Node process on the server, one per connected workbench window, and it knows only its workspace folder. It cannot see the browser URL; `?folder=` and `?payload=` never reach extensions; env vars are per code-server PROCESS (one shared `rk-code-server` sibling session for every tab) so they cannot carry per-tab data. Today the code lens is keyed by FOLDER (`/code/?folder=<@rk_win_code_root>`) and the bridge's `hostId` = sha1(folder + machineId), so (a) the extension cannot know which run-kit tab (tmux window @N on which tmux server) embeds it, and (b) two tabs opening the same folder collide on hostId and clobber each other's socket/record.
>
> **Decision 1 — key the code lens by TAB via a derived workspace file.** The one channel that carries arbitrary variables into a code-server window is a `.code-workspace` file (`?workspace=<path>`), whose `settings` block is readable by the extension through the normal configuration API. Workspace trust is already disabled in the launch flags so no trust prompt.
>
> - rk derives one workspace file per tab, e.g. `$XDG_STATE_HOME/run-kit/code/<server>/@7-<6-hex roothash>.code-workspace`:
>   ```jsonc
>   { "folders": [{ "path": "<@rk_win_code_root>" }],
>     "settings": { "rk.tab": "@7", "rk.server": "<tmux server name>" } }
>   ```
>   The file is a DERIVED artifact regenerated on demand from `@rk_win_code_root` (written by the backend when the code surface renders / the URL is requested); deleting it changes nothing but a regeneration. It is NOT a state store (Constitution II). The filename carries a short hash of the code root because tmux recycles `@N` after a server restart and editor state (open editors, hot exit) lives in browser IndexedDB keyed by workspace identity — the hash stops a reborn `@7` on a different repo from inheriting a dead window's editor state.
> - Frontend `code-surface.tsx` derives `/code/?workspace=<file>` instead of `/code/?folder=<gitRoot>`.
> - Extension: reads `rk.tab` / `rk.server` from configuration (declare them in `contributes.configuration`); `hostId` becomes a hash of the workspace path (identity = tab); the host record `cb/hosts/<hostId>.json` gains `tab` and `server` fields (existing field names unchanged).
> - `rk code exec --tab @N` / `rk code commands --tab` go from indirect (tab → `@rk_win_code_root` → folder match) to a direct host lookup by tab; `--folder` matching stays as a fallback for hosts without a tab.
> - This reverses the right-panel spec's "keyed by resolved folder, not window id" decision. Rationale for reversing: that decision addressed the folder-latch problem, which `@rk_win_code_root` solved separately (260813-if5d). What remains of folder keying is that two tabs on the same worktree share open editors; tab keying gives each its own editor state, which matches "the tile belongs to the tab" and is rare under fab's one-worktree-per-tab norm. Bonus: fixes the same-folder hostId collision.
> - Edge: File > Open Folder inside the editor navigates the workbench to a bare `?folder=` and drops the workspace identity. The existing `onFolderNavigated` load seam in code-surface.tsx already reads the frame URL on each load; it should write the new folder to the latch and re-derive a `?workspace=` URL (the parent re-navigates the frame). Multi-root `folders` is a possible later use, not in scope.
> - Edge: an extension host WITHOUT `rk.tab` (user-opened code-server window, or the bare-folder fallback) must degrade to current behavior — run-kit menu items hidden via a `when` context key (e.g. `rk.hasTab`), never an error.
> - Verify early: whether `rk` resolves on PATH inside the extension host (code-server is spawned through tmux with a non-rk PATH). Provide an `rk.bridge.rkPath` setting fallback; default resolution `rk` on PATH.
>
> **Decision 2 — context-menu / palette actions in the extension** (all shell out to existing rk verbs; no new Go resolution logic). Copy convention: VS Code style verbs, no prefix in context menus; set `"category": "run-kit"` so the command palette renders `run-kit: <Title>`. User-facing noun is "Web Tile" (matches shipped palette family `Tile: Show Code` and toggle tooltips; "surface" is the internal noun). Targeting for every action: `<rk> ... @<rk.tab> -L <rk.server>` — i.e. `rk tab web add @N <target> --show -L <server>` (the existing verb; `rk present` is sugar over it for the caller's own tab and cannot be used here because the extension is not in a tmux pane).
>
> Actions:
> 1. **Open in Web Tile** — explorer + editor-title context menus on files. `rk tab web add @N <file> --show -L <server>`. Markdown/excalidraw render via the existing present viewer shell for free.
> 2. **Open Folder in Web Tile** — explorer context menu on directories. Same verb with a directory target (index.html default).
> 3. **Open in Web Tile and Notify** — same as 1 plus a Web Push. `rk tab web add ... --show` then `rk notify` (or the `--notify` flag if `rk tab web add` supports it; verify — `rk present --notify` exists, check whether `tab web add` has it).
> 4. **Send to Agent** — editor context menu on a selection: pastes `<relative path>:<startLine>-<endLine>` plus the selected text into the tab's tty pane via `rk mux send <target>` (the injection engine gates on `@rk_pane_agent_state`). Target the tab's active pane; resolve the pane address from @N (e.g. `=session:window` / `@N` form that `rk mux send` accepts — verify the accepted grammar in `rk mux send --help` / docs/memory/run-kit/agent-messaging.md).
> 5. **Copy Reference for Agent** — same `path:line-line` string to the clipboard (`vscode.env.clipboard`), for composing in the strip instead.
> 6. **Open Port in Web Tile** — palette only (not file-scoped): QuickPick over listening loopback ports (source: the backend ports library `internal/ports` — exposed via an existing HTTP endpoint or `rk` verb if one exists; verify — else `rk tab web add @N :PORT` after the user types a port in an InputBox), attaches `/proxy/N/`.
>
> Explicitly out of scope: window-level knobs (note/color/marker) — they belong to the sidebar row, not the editor (Constitution X spirit).
>
> **Constraints.** Constitution I (exec with arg slices — in the extension use `child_process.execFile`/`spawn` with argv arrays and a timeout, never shell strings), II (workspace file is derived, not a store), IV (no new routes unless justified — prefer deriving the workspace URL in the frontend from data already in the window payload, or one small GET if the file must be written server-side; state the choice), X. Extension runtime dependency set stays empty (vscode API + node builtins). Bridge core (`src/bridge.ts`/`src/protocol.ts`) stays vscode-free and unit-tested with `node --test`. Tests: Go tests for the workspace-file derivation and `--tab` direct lookup; node tests for the new extension modules (command builders / target resolution as pure functions); frontend unit test for the `?workspace=` URL derivation; Playwright e2e where the code-surface stub harness (`code-surface.spec.ts`) allows. Docs to hydrate: docs/specs/code-bridge.md (tab identity, menu actions), docs/specs/right-panel.md § code lens (keying decision reversed), docs/specs/ui-state.md (`@rk_win_code_root` → workspace derivation), memory code-bridge.md + ui/lenses-and-layout.md § Code Surface, `rk skill code` topic page if it documents host resolution.
>
> **Alternatives rejected.** Per-tab symlink directory as the `?folder=` carrier (extension parses tab from the symlink path): hacky; fsPath shows the symlink everywhere, breaks `rk code --folder` matching and confuses git tooling. `?payload=` as a carrier: code-server's workbench only acts on `openFile`; not forwarded to extensions. Reverse-direction bridge protocol (editor → daemon route) for targeting: unnecessary once the tab identity is in the workspace settings; `rk tab` works with the daemon down. Multi-window ambiguity ladder (match by `@rk_win_code_root`, prefer layouts including `code`, QuickPick): superseded by tab keying, which makes targeting exact.

**Verifications performed at intake** (the description's "verify" items, checked against this worktree and the live host on 2026-09-09):

| Item | Result |
|------|--------|
| `rk tab web add --notify` | Does NOT exist — `rk tab web add` has only `--show` (plus the inherited `-L/--server`, `--quiet`). Only `rk present` carries `--notify`. Action 3 is therefore two invocations. |
| `rk mux send` target grammar | `%N` (pane), `@N` (window — resolves to its agent pane), `=session:window` (exact). Bare `session:window` is rejected (exit 2). `-L <server>` is accepted. Payload: positional, `-` for stdin, or `--key`. `--no-enter` stages without submitting; gate: idle sends, waiting refuses unless `--answer`, active refuses; `--force` skips the gate. |
| Listening-ports source for Open Port | No HTTP GET and no `rk` verb exposes `internal/ports`. The `ports.Collector` snapshot rides the state socket's `services` event only (`api/sse.go`). Per the description's own fallback, Open Port uses an InputBox → `rk tab web add @N :PORT --show -L <server>`. |
| `rk` on PATH inside the extension host | On this host, yes: the live `rk-code-server` process (pid 2685440, spawned via the `rk-daemon` tmux server) inherits the PATH of the shell that ran `rk serve -d`, which contains `/home/linuxbrew/.linuxbrew/bin/rk`. This is inherited, not guaranteed (a daemon started from launchd/systemd or a lean shell may not have it), so the resolution ladder below stands. `XDG_STATE_HOME` is unset in that process, so the extension's `~/.local/state` fallback is the live path — the same rule `codebridge.StateDir()` uses. |
| Workspace trust | `--disable-workspace-trust` is in the daemon's code-server launch argv (`internal/daemon/codeserver.go`), so a `.code-workspace` under the state dir opens without a trust prompt on rk-managed instances. |
| `code-surface.tsx` follow seam | `onFolderNavigated` fires from the `load` handler when the same-origin frame's `?folder=` is present, non-empty and differs from the prop; `app.tsx` POSTs `@rk_win_code_root`. A frame at `?workspace=…` carries no `folder` param, so today's seam is silent there — which is exactly the property the workspace form needs. |
| Host record shape | `internal/codebridge/record.go` `HostRecord{hostId, folder, pid, sock, extVersion, startedAt}`; `Selector{HostID, Folder}`; `Resolve` = host-id exact → folder exact → longest component-aware prefix → single-live fallback. `--tab` today feeds `Selector.Folder` from `@rk_win_code_root` (`cmd/rk/code.go` `codeTabFolder`). |
| help-dump pin | `help_dump_test.go` pins the `code` subtree at exactly `exec`/`hosts`/`commands`. This change adds no verbs (only a `TAB`/`SERVER` column to `hosts`), so the pin holds. |

## Why

**The pain.** The code tile is the one surface whose interior is not tmux state, and the bridge is its only command channel — but that channel is one-directional and folder-addressed. An extension host inside the tile has no idea which run-kit tab it is embedded in, so it cannot act on that tab: it cannot attach a file to *its* tab's web tile, message *its* tab's agent, or notify. Everything the user wants to do from a right-click in the editor needs a target of the form `@N` on server `S`, and no channel today carries that pair into the extension host. Folder keying also has a latent correctness bug: two tabs on the same folder compute the same `hostId`, so the second host unlinks the first's socket and overwrites its record; `rk code exec --tab @N` for the first tab then silently drives the second tab's editor.

**If we do nothing.** The bridge stays an agent-only tool (`rk code exec` from a shell) with no user-facing surface inside the editor, the review flow keeps its manual last mile (copy a path, switch to the tty, paste, type), and the same-folder collision persists. Every future editor-side feature would need its own targeting hack.

**Why this approach.** A `.code-workspace` file is the one artifact code-server hands to the extension host with arbitrary, per-window key/value data (its `settings` block, readable through `vscode.workspace.getConfiguration`), and it is the URL-addressable form (`?workspace=<path>`) that the frontend already controls when it composes the iframe `src`. rk derives one file per tab from the window's `@rk_win_code_root` — the same derivation-not-storage posture as the present viewer's content-keyed URLs — so the tab identity rides into the extension with no new protocol, no daemon dependency for the actions (every action is `rk tab …`/`rk mux …`/`rk notify`, all of which work with `rk serve` down), and no change to the bridge protocol. Keying the editor by tab also gives each tab its own editor state, which matches the tile-belongs-to-the-tab model that `@rk_win_layout`/`@rk_win_web_<n>` already established, and fixes the collision as a side effect. The alternatives (symlink carrier, `?payload=`, reverse-direction protocol, ambiguity ladders) were each considered and rejected in the discussion — see Origin.

## What Changes

### 1. `internal/codeworkspace` — the derived per-tab workspace file (Go, new package)

A small pure-ish library beside `internal/codebridge`:

- **State root**: `$XDG_STATE_HOME/run-kit/code/` (default `~/.local/state/run-kit/code/`) — `codeworkspace.StateDir()` mirrors `codebridge.StateDir()` / `snapshot.DefaultDir()`'s rule exactly (the same one-rule-two-runtimes discipline the code-bridge memory records). Directory mode `0700` like `cb/`.
- **Path**: `Path(stateDir, server, windowID, root string) string` = `<stateDir>/<server>/<windowID>-<hash6>.code-workspace`, where `hash6` is the first 6 lowercase hex chars of `sha256(<absolute root>)` — the same sha256-of-the-absolute-root rule `present.RootHash` uses, truncated to 6. Example: `~/.local/state/run-kit/code/default/@7-3fa1c9.code-workspace`. `server` and `windowID` are validated (`validate.ValidateWindowID`; server name via the existing tmux server-name validator) before they touch a path.
- **Content**: `Content(root, windowID, server string) []byte` renders exactly

  ```json
  {
    "folders": [{ "path": "/abs/code/root" }],
    "settings": { "rk.tab": "@7", "rk.server": "default" }
  }
  ```

  (`json.MarshalIndent`, trailing newline). No other keys. `folders` is single-element by design — multi-root is a possible later use, not in scope.
- **Ensure**: `Ensure(stateDir, server, windowID, root string) (path string, err error)` — `MkdirAll(0700)` the server dir, compare existing content byte-for-byte, write only when absent or different (temp + rename, mode `0600`), return the path. Idempotent; a deleted file is simply regenerated on the next call. This is Constitution II's carve-out shape: a derived artifact whose absence degrades to a regeneration, never a source of truth.
- **No GC in this change**: dead windows leave ~150-byte files behind under `<stateDir>/<server>/`; a reborn `@N` on the same root regenerates the identical path, and a different root gets a different name. Cleanup is a recorded follow-up (§ Open Questions), not part of the decided scope.
- **Tests** (`codeworkspace_test.go`, temp dirs): path derivation (hash stability, distinct roots ⇒ distinct names, same root ⇒ same name), content shape, ensure idempotency (second call does not rewrite — mtime unchanged), regeneration after deletion, content refresh when the root changes, invalid window id / server name rejected.

### 2. Backend GET — the one small route that writes the file

**Choice stated (Constitution IV):** the file must be written server-side (a browser cannot write to the state dir), and the trigger is "the code surface is about to open" — so this change adds **one GET** rather than performing filesystem writes inside the SSE derivation tick (a read path with a write side effect) and rather than shipping the path in every window payload for windows whose editor is never opened.

- `GET /api/windows/{windowId}/code-workspace?server=<s>` (`api/windows.go`, registered beside `GET /api/windows/{windowId}/history`). Reads the live `@rk_win_code_root` (`tmux.GetWindowOption` — derived at request time, never cached), calls `codeworkspace.Ensure`, responds `200 {"path":"/abs/….code-workspace","root":"/abs/code/root"}`. An empty code root responds `409 {"error":"window has no code root"}` (the frontend retries on the next payload tick — see § 3). Invalid window id / server ⇒ `400`; unknown window ⇒ `404`; ensure failure ⇒ `500` with the error. Read operation ⇒ GET (Constitution IX).
- The handler is the only writer of workspace files in the daemon. `rk tab code set` does **not** write the file (it only writes the option; the next editor open derives the file), keeping the CLI daemon-free and the derivation single-sourced.
- Tests: handler test with a fake option reader + temp state dir — 200 path shape, 409 on empty root, 400 on a bad id, idempotent second call.

### 3. Frontend — `?workspace=` derivation, mount gating, follow rule

`app/frontend/src/components/code-surface.tsx`, `app/frontend/src/api/client.ts`, `app/frontend/src/components/surface-layout.tsx`, `app/frontend/src/app.tsx`:

- **URL derivation**: add `codeServerWorkspaceSrc(workspacePath: string): string` = `` `/code/?workspace=${encodeURIComponent(workspacePath)}` `` beside the existing `codeServerSrc(folder)`. Same relative-path discipline (never an origin, never a port; `/code/` pathname stays the IndexedDB identity constant). Unit test (`code-surface.test.tsx`): encodes the path, carries no origin/port, differs per path.
- **Client**: `fetchCodeWorkspace(server, windowId): Promise<{path: string; root: string}>` in `client.ts` over the GET above (`deduplicatedFetch`; 409 surfaces as a typed "no code root yet" result, not a throw).
- **Mount gating**: the code tile mounts its iframe only once the workspace path is known. Sequence on a code-tile render: `codeRootSeed` (unchanged — first render seeds `@rk_win_code_root` from `gitRoot`) → when the payload's `win.codeRoot` (the substrate value, not the `gitRoot` fallback) is non-empty, `fetchCodeWorkspace` → iframe `src = codeServerWorkspaceSrc(path)`. Until then the tile renders the existing empty-state slot (a terse monospace `opening…` line — same styling as `code-surface-empty`, distinct testid `code-surface-pending`). On the first-ever open this costs one SSE tick (the seed POST → the option lands → the payload updates) before the editor appears; on every later open the root is already present and the fetch is one round-trip. The mount-generation ref discipline is unchanged: the `src` is fixed once per mount generation and a later path change never re-navigates a live frame.
- **Degrade**: a failed GET (5xx, network) falls back to today's `codeServerSrc(codeRootFor(win))` (`?folder=`) so the editor still opens — folder-keyed, with the run-kit menu items hidden (§ 5) — and logs once to the console. A 409 (no root yet) keeps the pending state and re-fetches on the next payload change.
- **Follow rule (File > Open Folder)**: the frame navigates itself to a bare `/code/?folder=<new>`, dropping the workspace identity. The existing `load`-seam report (`onFolderNavigated`) is unchanged; `app.tsx`'s handler now (1) POSTs `@rk_win_code_root = <new folder>` as today, then (2) re-fetches the workspace path for the new root and (3) **re-navigates the frame** to `codeServerWorkspaceSrc(newPath)` via a new `CodeSurface` prop (`workspaceSrc` change on the *same* mount generation is honored exactly when it follows an editor-initiated folder navigation — the editor has already navigated itself, so there is no editor state left to protect). This is the one sanctioned parent re-navigation; the memory's "a mounted iframe is never re-navigated by the parent" rule gains this single, stated exception. A frame whose `?folder=` equals the current root (a reload of the fallback form) is not re-navigated.
- **e2e** (`code-surface.spec.ts`, `code-folder-latch.spec.ts` — the code-server stub harness): the iframe `src` assertions move from `/code/?folder=<git root>` to `/code/?workspace=<path>` where `<path>` is read from `GET /api/windows/<id>/code-workspace` in the test (the per-run temp `XDG_STATE_HOME` makes the absolute path run-specific); assert the file exists on disk with the expected `folders[0].path` and `rk.tab`/`rk.server` values; assert the pending state precedes the iframe on first open; assert a deleted file is regenerated on remount. The stub serves any query string, so no stub change. The `/code` → `/code/` 308 test is untouched. Live File > Open Folder stays unit-tested only (no live code-server in the harness), as today.

### 4. Extension — tab identity, hostId, record, `rk` resolution

`app/code-bridge/package.json`, `src/extension.ts`, new `src/tab.ts` (pure):

- **Settings** (`contributes.configuration`, alongside `rk.bridge.enabled`): `rk.tab` (string, default `""`, "The run-kit tab (@N) this window belongs to — written into the derived workspace file by rk; not user-set"), `rk.server` (string, default `""`, same), `rk.bridge.rkPath` (string, default `""`, "Absolute path of the rk binary; empty resolves `$RK_BIN`, then `rk` on PATH").
- **Tab identity** (`src/tab.ts`, pure, `node --test`): `readTabIdentity(get: (key) => unknown): TabIdentity | null` validates `rk.tab` against `^@\d+$` and `rk.server` against the tmux server-name charset (`^[A-Za-z0-9_.-]+$`, non-empty); either failing ⇒ `null`. Values are validated before they can become argv (Constitution I's validate-user-input rule, even though argv arrays already preclude injection).
- **Context key**: on activate, `vscode.commands.executeCommand('setContext', 'rk.hasTab', identity !== null)`. Re-evaluated on `onDidChangeConfiguration` for the `rk` section.
- **hostId**: `computeHostId(identityPath)` where `identityPath` is the workspace file's `fsPath` (`vscode.workspace.workspaceFile`) when the window was opened from a `.code-workspace` **and** the identity is present; otherwise the first folder's `fsPath` as today. Same `sha1(<path>\n<machineId>)[:12]` formula. Identity = tab: two tabs on one folder now get distinct sockets and records; a reloaded window still reuses its hostId.
- **Record**: `cb/hosts/<hostId>.json` gains `tab` (`"@7"`) and `server` (`"default"`) — present only when the identity is present; the existing six field names are unchanged. `__ping`'s `info` gains the same two optional fields (additive protocol).
- **`rk` resolution ladder** (`src/rk.ts`): `rk.bridge.rkPath` setting (non-empty, absolute) → `process.env.RK_BIN` → the bare name `rk` (PATH search by `execFile`). The daemon's code-server spawn passes `RK_BIN=<selfpath.Resolve()>` in the `env` prefix it already uses (`env -u VSCODE_IPC_HOOK_CLI RK_BIN=/abs/rk <binary> …`, `internal/daemon/codeserver.go`) — the rk binary path is per-process, so env is the right carrier for it (unlike per-tab data). Externally-managed code-server instances have no `RK_BIN` and fall through to the setting or PATH. `codeserver_test.go` argv assertion gains the `RK_BIN=` element.
- **Runner** (`src/rk.ts`): `runRk(argv: string[], opts: {timeoutMs: number; stdin?: string}): Promise<{code, stdout, stderr}>` over `child_process.execFile(rkPath, argv, {timeout, maxBuffer})` — argv arrays only, never a shell string (Constitution I; the review policy flags `exec`/`execSync`/template-string shells as must-fix). Unit test: the builder side is pure; the runner is exercised against a stub script in `node --test`.
- **No new runtime dependencies** — `vscode` API + `node:child_process`/`node:path`/`node:crypto` only. `src/bridge.ts` / `src/protocol.ts` stay vscode-free and untouched except the additive `info` fields.

### 5. Extension — the six actions (`src/actions.ts` pure builders + `src/extension.ts` glue)

`package.json` `contributes.commands` (all `"category": "run-kit"`, VS Code-style verbs, no prefix) and `contributes.menus`; every menu entry and palette entry carries `"when": "rk.hasTab && …"` so a host without a tab shows nothing and never errors:

| Command id | Title | Menus (`when`) | Effect |
|---|---|---|---|
| `rk.openInWebTile` | Open in Web Tile | `explorer/context` (`rk.hasTab && !explorerResourceIsFolder`), `editor/title/context` (`rk.hasTab`) | `rk tab web add @N <file fsPath> --show -L <server>` |
| `rk.openFolderInWebTile` | Open Folder in Web Tile | `explorer/context` (`rk.hasTab && explorerResourceIsFolder`) | `rk tab web add @N <dir fsPath> --show -L <server>` (directory target — index.html default) |
| `rk.openInWebTileAndNotify` | Open in Web Tile and Notify | same as `rk.openInWebTile` | the add above, then on exit 0: `rk notify "presenting <basename>" --title run-kit` (two invocations — `tab web add` has no `--notify`; `rk notify` is fail-silent by contract) |
| `rk.sendToAgent` | Send to Agent | `editor/context` (`rk.hasTab && editorHasSelection`) | `rk mux send @N - --no-enter -L <server>` with the reference block on stdin (§ payload) |
| `rk.copyReferenceForAgent` | Copy Reference for Agent | `editor/context` (`rk.hasTab && editorHasSelection`) | `vscode.env.clipboard.writeText(<reference line>)`; status-bar `Copied <ref>` for 3s |
| `rk.openPortInWebTile` | Open Port in Web Tile | `commandPalette` only (`rk.hasTab`) | `showInputBox` (prompt "Local port", validate `1–65535`) → `rk tab web add @N :<port> --show -L <server>` (the add's own probe rejects a dead port) |

Details:

- **Resource resolution**: context-menu invocations receive a `vscode.Uri` (explorer, editor title); palette invocations fall back to `activeTextEditor.document.uri`. Non-`file:` schemes ⇒ `showWarningMessage("Only local files can be shown in the Web Tile")`. Paths are passed absolute (`uri.fsPath`), never relative — the extension host's cwd is not the workspace.
- **Reference payload** (`formatReference(relPath, start, end)` + `buildSendPayload(ref, text)` — pure, tested): `relPath` = `vscode.workspace.asRelativePath(uri, false)` (workspace-relative, forward slashes); lines 1-based from the selection (`start.line+1`, `end.line+1`, where an end at column 0 of a later line is trimmed to the previous line); a single line renders `path:N`, a range `path:N-M`. The send payload is the reference line, a newline, then the selected text verbatim (no fences, no trailing newline added beyond the text's own). Palette invocation with an empty selection uses the cursor line and no text.
- **Send to Agent gate handling**: `rk mux send` is run plainly (gated on `@rk_pane_agent_state`; `--no-enter` stages the text in the agent's input box so the user adds the instruction and presses Enter in the tty). Exit 0 ⇒ status bar `Staged in tab @N` (report word from stdout). Exit 1 with a gate refusal (stderr names the state) ⇒ `showWarningMessage(<stderr first line>, "Force")`; choosing **Force** re-runs the same argv plus `--force`. Any other failure ⇒ `showErrorMessage`.
- **Error surfacing (all actions)**: non-zero exit ⇒ `showErrorMessage("run-kit: <stderr first line or exit code>")`; `ENOENT` on the rk binary ⇒ one `showErrorMessage("run-kit: rk not found — set rk.bridge.rkPath")`. Success is silent for the web-tile actions (the tile appearing is the feedback), status-bar for copy/send.
- **Timeouts**: 15 s for `rk tab web add` / `rk notify` (the verbs bound their own tmux calls at 5 s plus a port probe), 20 s for `rk mux send` (paste + probe + post-Enter observation). Constants in `src/actions.ts`.
- **Builders** (pure, `node --test` in `test/actions.test.ts`): `buildWebAddArgv(identity, target)`, `buildNotifyArgv(basename)`, `buildSendArgv(identity, {force})`, `formatReference`, `buildSendPayload`, `parsePort` — every argv is asserted element-by-element (target string never split, `-L <server>` present, `--show` present, `--no-enter` present, `--force` appended only when asked).
- **Out of scope**: window-level knobs (note / color / marker) — they belong to the sidebar row, not the editor. No `Open in Web Tile` for remote/virtual schemes. No multi-select fan-out (a multi-select invocation acts on the first resource).

### 6. `rk code exec` / `rk code commands` — direct tab lookup

`internal/codebridge/record.go`, `resolve.go`, `cmd/rk/code.go`:

- `HostRecord` gains `Tab string \`json:"tab,omitempty"\`` and `Server string \`json:"server,omitempty"\``.
- `Selector` gains `Tab, Server string`. `Resolve` order becomes: (1) `HostID` exact; (2) **`Tab`+`Server` exact match** when both are set — the direct lookup; (3) `Folder` exact, then longest component-aware prefix; (4) single-live fallback with the `using host …` note; else `ErrAmbiguous` / `ErrNoHost` as today.
- `resolveCodeHost` (`code.go`): `--tab [@N]` resolves the address through `resolveTabAddr` as today, then sets `Selector.Tab/Server` **and** still reads `@rk_win_code_root` into `Selector.Folder` — so a host registered without a tab (a user-opened window on that folder, or the `?folder=` fallback frame) is still found by the folder fallback. An empty code root keeps today's `falling back to the cwd` note.
- **Own tab is the default target inside tmux**: with no `--host`/`--tab`/`--folder`, a caller inside a tmux pane resolves its own tab (`ownWindowID`, best-effort — outside tmux or with a malformed `$TMUX` the step is skipped silently) and tries the tab-direct match first, then falls through to today's cwd-toplevel folder ladder. This is the ui-state spec's stated intent ("an agent in a pane says `rk code exec …` and hits *its* editor") and it removes the ambiguity tab keying would otherwise create: two tabs on one worktree now register two hosts with an identical `folder`, and a folder-only default would pick one arbitrarily. An explicit `--folder` skips the own-tab step. Several exact-folder matches without a tab hit still end in `ErrAmbiguous`, whose listing gains the `tab` column.
- `rk code hosts` gains `TAB` and `SERVER` columns (`-` when absent); `--json` carries the new fields. The help-dump pin (`exec`/`hosts`/`commands`) is unchanged — no new verb.
- `--all` is unchanged.
- Tests (`resolve_test.go`, `code_test.go`): tab+server direct hit beats a folder match on another host; tab-less host falls back to folder; two same-folder hosts + own-tab default picks the caller's; outside tmux ⇒ folder ladder as today; explicit `--folder` skips the own-tab step; record JSON round-trips the optional fields; `hosts` table renders the `-` placeholders.

### 7. Docs

- **Specs**: `docs/specs/code-bridge.md` — tab identity (workspace file, `rk.tab`/`rk.server`, hostId rule, record fields), the menu-action family, the `rk` resolution ladder, resolution order; `docs/specs/right-panel.md` § The `code` lens — mark "keyed by the resolved folder, not window id" as **reversed** with the rationale above (folder latch solved separately by `@rk_win_code_root`; tab keying = tile belongs to the tab; fixes the hostId collision); `docs/specs/ui-state.md` § Code Surface + Code Bridge — `@rk_win_code_root` → derived workspace file → `?workspace=`, and the direct `--tab` lookup replacing the folder-match sentence.
- **Memory** (hydrate): `run-kit/code-bridge` (identity, record, ladder, actions, resolution), `run-kit/ui/lenses-and-layout` § Code Surface (URL derivation, mount gating, the sanctioned re-navigation), `run-kit/api-and-sockets` (the GET), `run-kit/configuration` § Boundaries (the `code/` state tenant beside `cb/`), `run-kit/architecture` (`internal/codeworkspace` library row), `run-kit/daemon-lifecycle` (`RK_BIN` in the code-server spawn env).
- **`rk skill code` topic page** (`docs/site/skill/code.md`, synced to `cmd/rk/skill/code.md` by `scripts/sync-skill.sh`, ≤150 lines — currently 91): § Host resolution gains the tab-direct rule; § Gotchas notes the editor-side menu actions exist for humans (agents keep `rk code exec`).
- `app/code-bridge/README.md`: settings table and the actions list.

## Affected Memory

- `run-kit/code-bridge`: (modify) tab identity via the derived workspace file, `rk.tab`/`rk.server`/`rk.bridge.rkPath` settings, hostId rule, record `tab`/`server` fields, the `rk` resolution ladder, the six actions and their argv, `Resolve` order with the tab-direct step and the own-tab default inside tmux
- `run-kit/ui/lenses-and-layout`: (modify) § Code Surface — `?workspace=` derivation, the GET fetch + mount gating (pending state), the `?folder=` degrade, the one sanctioned parent re-navigation after an editor-initiated folder move
- `run-kit/api-and-sockets`: (modify) `GET /api/windows/{windowId}/code-workspace` row
- `run-kit/configuration`: (modify) § Boundaries — the `$XDG_STATE_HOME/run-kit/code/` derived-workspace tenant beside `cb/`
- `run-kit/architecture`: (modify) `internal/codeworkspace` in the backend-libraries list
- `run-kit/daemon-lifecycle`: (modify) the code-server spawn carries `RK_BIN=<self path>` in its `env` prefix

## Impact

**Backend (Go)** — `app/backend/internal/codeworkspace/` (new: `codeworkspace.go`, `codeworkspace_test.go`), `app/backend/internal/codebridge/record.go` + `resolve.go` + `resolve_test.go` (record/selector fields, tab-direct step), `app/backend/cmd/rk/code.go` + `code_test.go` (`--tab` wiring, own-tab default, hosts columns), `app/backend/api/windows.go` + `router.go` + a handler test (the GET), `app/backend/internal/daemon/codeserver.go` + `codeserver_test.go` (`RK_BIN` env element). No new CLI verbs; no schema changes to existing options; `@rk_win_code_root` semantics unchanged.

**Frontend (TS)** — `app/frontend/src/components/code-surface.tsx` + `code-surface.test.tsx` (workspace src, pending state, follow re-navigation prop), `src/api/client.ts` (`fetchCodeWorkspace`), `src/components/surface-layout.tsx` + `src/app.tsx` (fetch orchestration, follow handler), `tests/e2e/code-surface.spec.ts` + `code-folder-latch.spec.ts` (src assertions → `?workspace=`, file-on-disk assertions, pending state).

**Extension (TS)** — `app/code-bridge/package.json` (settings, commands, menus), `src/extension.ts` (identity, context key, hostId, record, command registration), new `src/tab.ts`, `src/rk.ts`, `src/actions.ts`, new `test/tab.test.ts`, `test/actions.test.ts`, `test/rk.test.ts`; `src/bridge.ts` `info` gains two optional fields. Runtime deps stay empty; the VSIX ships through the existing embed/install path, so users get the actions on the next `rk code-server update` (the respawn rule already covers an extension-only change).

**Docs** — the three specs, six memory files, the skill topic page, the extension README (§ 7).

**Behavioral contract changes to call out in review**: (a) code-tile URL form `?folder=` → `?workspace=` (IndexedDB editor state is re-keyed once — open editors/layout from the folder-keyed identity are not carried over; hot-exit dirty buffers live server-side and survive); (b) two tabs on one worktree no longer share an editor; (c) `rk code exec --tab` exact-by-tab; (d) one new GET route; (e) first-ever code-tile open waits one SSE tick for the seed before the editor mounts.

## Open Questions

- Multi-viewer same tab: two browsers viewing the same tab open two workbench windows on the same workspace file, hence the same `hostId` — the second host unlinks the first's socket (last-writer-wins). This is exactly today's per-folder behavior, so not a regression, but tab keying makes the multi-viewer case the *common* collision instead of the rare one. Should the record become per-extension-host (hostId + a short pid-derived suffix) with `rk code exec` fanning out to every host of a tab? Not in scope; recorded for follow-up.
- Externally managed code-server instances (user-run, without `--disable-workspace-trust`) will show a trust prompt for the derived workspace file on first open. Acceptable degrade, or should rk write `"security.workspace.trust.enabled": false`-adjacent hints into the workspace `settings`? (Workspace-level trust settings are not honored by VS Code by design, so likely nothing to do.)
- Should `rk tab code set` also call `codeworkspace.Ensure` so a CLI-set root pre-warms the file? Deliberately no in this change (single writer); revisit if the one-tick pending state is felt.
- Workspace-file cleanup: dead windows leave tiny `.code-workspace` files under `code/<server>/`. An opportunistic sweep (remove files whose `@N` is not among the server's live windows, run from the GET handler which already has the live set) is the obvious shape, but the discussion did not decide it, so it is not in scope. Follow-up if the directory ever matters.

## Clarifications

### Session 2026-09-09

| # | Action | Detail |
|---|--------|--------|
| 30 | Confirmed | Send to Agent stages with `--no-enter`; the user adds the instruction and submits in the tty. Submit-immediately and a two-item split were offered and declined. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tab identity travels into the extension host via a derived `.code-workspace` file opened with `?workspace=<path>`, whose `settings` carry `rk.tab` and `rk.server` | Discussed — chosen over symlink carrier, `?payload=`, reverse protocol, and ambiguity ladders (see Origin) | S:95 R:60 A:90 D:95 |
| 2 | Certain | Workspace file path `$XDG_STATE_HOME/run-kit/code/<server>/<@N>-<6 hex>.code-workspace`, hash = first 6 hex of sha256(absolute root) | Discussed — exact form given; sha256-of-root mirrors `present.RootHash`; the hash defeats `@N` recycling across server restarts | S:90 R:85 A:90 D:85 |
| 3 | Certain | The file is a derived artifact (regenerated on demand, byte-compared, temp+rename, deletable), not a state store | Discussed; Constitution II carve-out shape | S:95 R:90 A:100 D:100 |
| 4 | Certain | `rk.tab` / `rk.server` / `rk.bridge.rkPath` declared in `contributes.configuration`; `rk.hasTab` context key gates every menu/palette entry so a tab-less host shows nothing | Discussed — degrade-not-error requirement; `setContext` is the standard VS Code mechanism | S:90 R:85 A:90 D:90 |
| 5 | Certain | Every action shells out to an existing rk verb with `execFile` argv arrays and a timeout; no shell strings, no new Go resolution logic | Constitution I; code-review policy names `exec`/template shells as must-fix | S:95 R:90 A:100 D:100 |
| 6 | Certain | Open in Web Tile and Notify = `rk tab web add … --show` then `rk notify` (two invocations) | Verified: `rk tab web add` has no `--notify` (only `rk present` does) | S:90 R:90 A:100 D:95 |
| 7 | Certain | Send to Agent targets `rk mux send @N - -L <server>` with the payload on stdin; `@N` resolves to the window's agent pane | Verified against `rk mux send --help` (grammar `%N`/`@N`/`=session:window`; `-` = stdin) | S:85 R:85 A:95 D:90 |
| 8 | Certain | Open Port in Web Tile uses an InputBox → `rk tab web add @N :PORT --show -L <server>` | Verified: no GET or rk verb exposes `internal/ports` (SSE `services` event only); the description prescribes this fallback | S:85 R:85 A:90 D:85 |
| 9 | Certain | Copy: `"category": "run-kit"`, VS Code-style unprefixed verbs in context menus, user-facing noun "Web Tile" | Discussed — matches the shipped `Tile: Show Code` palette family | S:95 R:95 A:90 D:95 |
| 10 | Certain | Extension runtime deps stay empty; `bridge.ts`/`protocol.ts` stay vscode-free; new modules are pure builders under `node --test` | Discussed; matches the shipped extension's design decisions | S:95 R:90 A:95 D:95 |
| 11 | Certain | `hostId` = sha1(workspace-file fsPath + machineId) when the identity is present; folder-based otherwise | Discussed ("identity = tab"); keeps reload-reuse; falls back for tab-less hosts | S:85 R:80 A:85 D:85 |
| 12 | Certain | Host record gains optional `tab`, `server`; the six existing field names are unchanged; `__ping` info gains the same fields | Discussed; additive protocol | S:90 R:85 A:95 D:90 |
| 13 | Certain | `rk code exec/commands --tab` becomes a direct (tab, server) match, with folder matching retained as the fallback for tab-less hosts; `Selector` gains `Tab`/`Server` | Discussed — the description's Decision 1 bullet | S:90 R:80 A:85 D:85 |
| 14 | Certain | Menu placement: `explorer/context` (file vs `explorerResourceIsFolder`), `editor/title/context`, `editor/context` with `editorHasSelection`, `commandPalette` for Open Port; all under `rk.hasTab` | Description names the menus; `when` keys are standard VS Code | S:75 R:90 A:85 D:80 |
| 15 | Certain | Extension validates `rk.tab` (`^@\d+$`) and `rk.server` (tmux server-name charset) before use; a failing value ⇒ `rk.hasTab=false` | Constitution I validate-input rule; cheap and defensive | S:70 R:90 A:90 D:85 |
| 16 | Certain | Tests: Go (`codeworkspace`, `Resolve` tab step, GET handler, spawn argv), node (`tab`/`actions`/`rk` builders), Vitest (`codeServerWorkspaceSrc`), Playwright (stub harness `src`/file/pending assertions) | Config `test_paths` + description's test list | S:90 R:95 A:100 D:95 |
| 17 | Certain | Workspace trust is not a concern on rk-managed instances | Verified `--disable-workspace-trust` in the spawn argv | S:90 R:90 A:100 D:95 |
| 18 | Confident | Reversal of right-panel's "keyed by resolved folder, not window id" is recorded in the spec with the discussed rationale | Discussed; the reversal is a documented decision, not silent drift | S:90 R:60 A:85 D:90 |
| 19 | Confident | The file is written by ONE small `GET /api/windows/{windowId}/code-workspace` that ensures + returns `{path, root}`, fetched by the frontend at code-tile mount — rather than writing inside the SSE derivation tick or shipping paths in every payload | Description asks to state the choice; a write belongs to the "editor is about to open" moment, not a read tick; Constitution IV/IX satisfied by one read-shaped GET | S:60 R:60 A:70 D:60 |
| 20 | Confident | `rk` binary resolution ladder: `rk.bridge.rkPath` setting → `$RK_BIN` (set by the daemon's code-server spawn from `selfpath.Resolve`) → `rk` on PATH | Verified rk resolves on PATH here but only by inheritance; the per-process binary path is legitimately env-carried (unlike per-tab data) | S:75 R:85 A:80 D:75 |
| 21 | Confident | Default (no-flag) `rk code exec` inside tmux resolves the caller's own tab first (tab-direct), then falls through to the cwd-toplevel folder ladder; explicit `--folder` skips the own-tab step | ui-state spec already states "an agent in a pane … hits *its* editor"; tab keying makes same-folder hosts possible, so a folder-only default would be arbitrary | S:70 R:75 A:80 D:70 |
| 22 | Confident | File > Open Folder follow: write the latch as today, re-fetch the workspace path, and re-navigate the frame to the `?workspace=` form — the one sanctioned parent re-navigation (the editor already navigated itself) | Description's edge bullet; no editor state is at risk after an editor-initiated navigation | S:80 R:75 A:80 D:80 |
| 23 | Confident | The iframe mounts only after `win.codeRoot` (substrate) is set and the GET returns; first-ever open shows a `code-surface-pending` state for one SSE tick; a 409 keeps pending and re-fetches on the next payload change | The seed POST is the only path that makes the root exist; deriving the file from the frontend's `gitRoot` guess would violate the tmux-is-truth rule | S:50 R:80 A:70 D:60 |
| 24 | Certain | GET failure (non-409) degrades to today's `?folder=` src so the editor still opens (menu items hidden) | Degrade-not-error; mirrors the reachability empty-state posture | S:70 R:85 A:85 D:80 |
| 25 | Confident | Reference format: workspace-relative forward-slash path, 1-based lines, `path:N` or `path:N-M` (end at column 0 trimmed to the previous line); payload = reference line + newline + selected text verbatim, no fences | Description gives `<relative path>:<startLine>-<endLine>`; the rest follows common agent conventions | S:70 R:85 A:75 D:65 |
| 26 | Confident | Error surfacing: non-zero exit ⇒ `showErrorMessage` with stderr's first line; rk `ENOENT` names `rk.bridge.rkPath`; web-tile successes are silent, copy/send show a 3 s status-bar message | Standard VS Code UX; the tile appearing is the success feedback | S:50 R:90 A:75 D:70 |
| 27 | Confident | Timeouts: 15 s for `rk tab web add`/`rk notify`, 20 s for `rk mux send` | The verbs bound their own tmux calls at 5 s plus a probe/observation window; code-review policy requires a timeout on every `execFile` | S:55 R:95 A:80 D:80 |
| 28 | Confident | `rk tab code set` does not write the workspace file; the GET is the single writer | Description names the backend-at-render as the writer; keeps the CLI daemon-free and the derivation single-sourced; the cost is the one-tick pending state on first open | S:65 R:85 A:85 D:75 |
| 29 | Certain | `rk code hosts` gains `TAB`/`SERVER` columns (`-` when absent); no new verbs, so the help-dump pin is untouched | Toolkit help-dump stability; verified the pin covers exactly `exec`/`hosts`/`commands` | S:60 R:90 A:90 D:85 |
| 30 | Confident | Send to Agent stages the text with `--no-enter` (the user adds the instruction and presses Enter in the tty) rather than submitting it <!-- clarified: user confirmed --no-enter staging, 2026-09-09; a bare path+snippet submitted alone would cost the agent a wasted turn; "Copy Reference" is the compose-in-strip alternative --> | Clarified — user confirmed | S:95 R:80 A:35 D:35 |
| 31 | Confident | A gate refusal from `rk mux send` (agent active/waiting) is surfaced as a warning with a **Force** button that re-runs with `--force`; the extension never passes `--answer` | The gate's semantics are documented (`rk mux send --help`); warn-then-force is the standard editor affordance; `--answer` belongs to agent-to-agent replies | S:25 R:85 A:55 D:45 |
| 32 | Confident | Palette invocation of Send/Copy with an empty selection uses the cursor line and no text | Not discussed; obvious low-stakes default (context menus are gated on `editorHasSelection`) | S:30 R:90 A:85 D:70 |

32 assumptions (19 certain, 13 confident, 0 tentative, 0 unresolved).
