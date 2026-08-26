# run-kit skill: code

Depth for one job: **acting inside the `code` lens editor** — running any VS Code palette command (and the 171 `pr.*` commands of the GitHub Pull Requests extension, plus everything else in the open window) from the shell. This is a static topic page (`rk skill code`); the [core bundle](../skill.md) covers when to reach for run-kit at all. Everything here is byte-identical on every invocation.

The bridge is an agent-reachable `executeCommand`: the `rk-code-bridge` extension (installed by `rk code-server install`/`update`) opens one same-user Unix socket per open folder and serves one-request-per-connection NDJSON; `rk code exec` is the shell side. It exists because code-server exposes no command channel — its CLI only opens files, and a URL's `payload=` only supports `openFile`. Reach for it when the job is a palette command: refresh a PR list, focus a sidebar, open a diff.

Gate first, as always — run-kit is optional and the bridge may have no live host:

```sh
command -v rk >/dev/null 2>&1 || exit 0
[ -n "$(rk code hosts 2>/dev/null)" ] || exit 0
```

If either check fails, skip every bridge step silently — describe the output in text instead.

## `rk code hosts` — what is listening

```sh
rk code hosts                 # aligned rows: ID FOLDER PID AGE EXT
rk code hosts --json          # the host records as an array
```

A host is one open code-server folder with the bridge extension active. Host records live under the run-kit state dir, but liveness is re-derived on every call: a record counts only if its pid is alive AND its socket answers a ping; records failing either check are pruned as a side effect. Zero hosts prints nothing (`[]` under `--json`) and still exits 0 — gate on empty output, not on the exit code.

## `rk code commands` — the palette, grep-able

```sh
rk code commands                            # one command id per line, sorted
rk code commands --folder /path/to/repo
```

Resolves a host exactly like `exec` does, sends the bridge-internal `__commands`, and prints the full `vscode.commands.getCommands(true)` list — every palette command plus every extension command that the open window can execute. Pipe to `grep '^pr\.'` before you guess at ids.

## `rk code exec` — run a command

```sh
rk code exec pr.refreshList                                   # no args
rk code exec pr.checkoutByNumber 2908                         # a number arg (JSON literal)
rk code exec vscode.open '{"$uri":"file:///tmp/a.ts"}'        # object args pass verbatim
rk code exec workbench.action.focusFirstEditorGroup --json    # raw envelope instead of result
```

**Arg rules** — each positional after the command id is parsed as a JSON literal:

- `2908` → the number `2908`, not a string; `{"a":1}` / `[1,2]` pass through verbatim.
- Anything that is NOT valid JSON (a bare word like `main`) is sent as a string instead.
- A literal `--` ends flag parsing, so negative numbers and `-`-prefixed strings pass as args.

**`$uri` sugar** — an object exactly of shape `{"$uri":"<string>"}` at any nesting depth in the args is rewritten to `vscode.Uri.parse(...)` by the extension. No other coercion happens; plain path-like strings are NOT auto-converted. `vscode.open` and `vscode.diff` want Uris:

```sh
rk code exec vscode.diff '{"$uri":"file:///…/a.ts"}' '{"$uri":"file:///…/b.ts"}' "review: a.ts"
```

**Output**: on success stdout carries the result JSON (`null` prints `null`); `--json` prints the raw response envelope instead. Failures print `error: <kind>: <message>` on stderr; `kind` ∈ `unknown-command` · `threw` · `timeout` (default 30s, tune with `--timeout`) · `bad-request`. A dial/read failure prints `error: <message>` with no kind.

### Host resolution

- `--host <id>` wins (ids come from `rk code hosts`).
- Else the target folder — `--folder <path>`, or by default the git toplevel of the cwd — is matched against each host's folder: exact match first, then longest-prefix (path-component aware, so a worktree under a registered repo resolves to the repo's host instead of matching nothing).
- No match and exactly one live host → it is used, with a `using host <id> (<folder>)` note on stderr. Several → exit 1 listing them. None → exit 1 with the open-the-lens hint.
- `--all` fans out to every live host: one `<hostId>\t<result JSON>` row per host on stdout (`--json` → an array of `{hostId, folder, response}`); exit is 1 when any host errored, else 0.

`--host` and `--folder` are mutually exclusive (usage error).

### Exit codes

- `0` ok · `1` operational (no host, dial failure, `timeout`/`threw`/`unknown-command`/`bad-request`) · `2` usage (missing command id, `--host` with `--folder`, unknown flag, stray arg).
- `unknown-command` exits 1 and appends a `did you mean:` list of the five closest command ids (fetched from the host's `__commands`) on stderr.

## Recipe: prepare a PR for review

The motivating case. The PR extension already detects the PR of the checked-out branch — the bridge's job is the last mile (refresh, focus, open the right diffs), not the checkout:

```sh
gh pr checkout 2908                                        # in the folder the code lens latched
rk code exec pr.refreshList                                # pick up the branch's PR
rk code exec workbench.view.extension.github-pull-requests # focus the PR sidebar
rk code exec vscode.diff '{"$uri":"file:///…/a.ts"}' '{"$uri":"file:///…/b.ts"}' "review: a.ts"
rk notify "PR ready in the code tile" --title review
```

## Gotchas

- The code lens's folder is a **per-viewer latch** in browser localStorage — seeded once from the active pane's git root when the surface first opens, moved only by the editor's own navigation. A CLI cannot set it. Recipe: be in the repo when the user first opens the code surface, or ask them to File > Open Folder.
- There is deliberately **no `rk code open`** — the honest hook is the deferred `@rk_code_folder` tmux-option upgrade path; until it lands, the latch above rules.
- Resolution never caches: a stale record that fails the pid+ping check is pruned on every call, and the next call re-enumerates from the sockets (the registry is a discovery hint only).
- Security posture is **same-user-only**: file sockets (0600, dir 0700) under the user's state dir, never TCP — anything the caller does through the bridge it could already do as the same user. A page in the user's browser cannot reach the socket; a same-user process can.
- The off switch is the managed profile's VS Code setting `rk.bridge.enabled` (seeded true at install). A host running an extension older than the bundled one draws a version-skew warning on stderr suggesting `rk code-server update`.
- `rk code exec` inherits `workbench.action.terminal.sendSequence` reachability — equivalent to typing in the terminal, which the calling shell can already do; keep it same-user.
- `rk doctor` carries a `code bridge` row (installed extension + live host count) — check it when resolution reports no host.
