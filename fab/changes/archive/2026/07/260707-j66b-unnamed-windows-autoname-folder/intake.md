# Intake: Unnamed Windows Auto-Name to Folder

**Change**: 260707-j66b-unnamed-windows-autoname-folder
**Created**: 2026-07-07

## Origin

Promptless dispatch from a user design conversation (synthesized description; conversational mode — all key decisions explicitly agreed by the user during the discussion).

> Feature: unnamed tmux windows auto-name to their folder (basename of cwd) instead of the running command. When a window is not explicitly named, its display name should be the folder name (basename of the active pane's current path), not the running command.

Key decisions from the conversation (all explicitly agreed by the user):

1. **tmux-native approach**: set `set -g automatic-rename-format '#{b:pane_current_path}'` in the four embedded tmux configs (`configs/tmux/default.conf`, `simple.conf`, `poweruser.conf`, `byobu.conf`).
2. **Stop pinning `+ New Window` names**: drop the hardcoded `"zsh"` window name in the frontend, make the window name optional through `POST /api/sessions/{session}/windows`, and have `CreateWindow` run `new-window` WITHOUT `-n` when no name is given.
3. **Keep explicit names where deliberate**: `rk riff` panes and iframe/service windows keep passing `-n`; explicit renames continue to pin the name (desired tmux behavior).

## Why

**Problem**: When a run-kit window is not explicitly named, users expect to see *where* the window is (its folder), not *what* is running in it. Today, unnamed-window naming is broken in two compounding ways:

1. tmux's own `automatic-rename` default format is `#{pane_current_command}` — the running command ("zsh", "node", "vim"), which carries almost no identity in a worktree-per-change workflow where the folder name (e.g. `quick-bison`) is the meaningful label.
2. run-kit never even gets tmux's automatic naming: **every** run-kit window-creation path passes `-n` (`new-window -n <name>`), which permanently disables `automatic-rename` on that window. The sidebar `+ New Window` button hardcodes the name `"zsh"` (`app/frontend/src/app.tsx:681`), so those windows stay named "zsh" forever regardless of where they live or what runs in them.

run-kit renders `#{window_name}` verbatim everywhere (sidebar `window-row.tsx` around line 280, top-bar heading, session tiles) with no frontend fallback — so the fix must land at the tmux layer, not the display layer.

**Consequence of not fixing**: A sidebar full of windows named "zsh" — indistinguishable rows that force users to click through windows to find the one for a given worktree. The primary navigation surface (sidebar, session tiles, top-bar heading) fails at its job of identifying windows.

**Why this approach** (tmux-native `automatic-rename-format` + dropping `-n` for unnamed creates):
- The name stays **derived and single-sourced in tmux** — run-kit, native tmux clients, and the tmux status line all agree (fits constitution Principle II derive-don't-store: state derived from tmux at request time).
- Names **live-update** as the pane `cd`s — no polling, no sync code, zero new state.
- Omitting `-n` is simpler and more honest about intent than creating named-then-unpinned windows.

**Alternatives rejected** (from the conversation):
- *Frontend display-side fallback* (render `basename(worktreePath)` when the window's `automatic-rename` flag is on): rejected — run-kit's displayed name would diverge from tmux/native clients; more code; worse invariant.
- *Keep `-n` on creation and chain `set -w automatic-rename on`* (via the existing `CreateWindowWithOptions` atomic chaining): viable, but omitting `-n` is simpler and more honest about intent.

## What Changes

### 1. Embedded tmux configs — global `automatic-rename-format`

Add to each of the four embedded config files in `configs/tmux/`:

```tmux
set -g automatic-rename-format '#{b:pane_current_path}'
```

Files: `configs/tmux/default.conf`, `configs/tmux/simple.conf`, `configs/tmux/poweruser.conf`, `configs/tmux/byobu.conf`.

- `#{b:...}` is the basename format modifier; available on the host's tmux 3.6a.
- `automatic-rename` itself defaults to `on` (and `byobu.conf:17` already sets it explicitly) — only the *format* changes.
- Effect: any window created without `-n` (or later un-pinned) names itself to the basename of its active pane's current path, live-updating on `cd`. Native tmux status lines show folder names too — considered a consistency feature, not a regression.

### 2. Frontend — stop pinning the `+ New Window` name

`app/frontend/src/app.tsx:681` currently:

```ts
return createWindow(srv, session, "zsh", activeWin?.worktreePath);
```

Drop the hardcoded `"zsh"`: call `createWindow` without a name (the API client `createWindow` in `app/frontend/src/api/client.ts:124` makes `name` optional and omits it from the JSON body when absent). The adjacent optimistic-ghost path (`onOptimistic` → `addGhostWindowStore(srv, session, "zsh")`) needs a new placeholder label since "zsh" is no longer the eventual name — use the basename of the creation cwd (`activeWin?.worktreePath`) so the ghost matches what tmux will name the window.

The iframe/service window creation path (`app.tsx:761`, `createWindow(server, sessionName, name, undefined, "iframe", url)`) is **unchanged** — it keeps passing its explicit name.

### 3. Backend API — window name optional on CREATE only

`POST /api/sessions/{session}/windows` (`app/backend/api/windows.go`, `handleWindowCreate`): currently `validate.ValidateName(body.Name, "Window name")` (~line 35) rejects an empty name. Relax to: validate the name **only when non-empty**; an omitted/empty `name` is now valid and means "let tmux auto-name".

- The **rename** path is untouched: it keeps requiring a non-empty name (explicit rename → `tmux rename-window` at `app/backend/internal/tmux/tmux.go:1344` — pins the name, which is desired tmux behavior).
- The `rkType`-present branch (iframe windows via `CreateWindowWithOptions`, `tmux.go:1312`) keeps its explicit `-n` — the frontend always supplies a name there.

### 4. tmux layer — `CreateWindow` omits `-n` when name is empty

`app/backend/internal/tmux/tmux.go:997`:

```go
func CreateWindow(session, name, cwd string, server string) error {
	...
	_, err := tmuxExecServer(ctx, server, "new-window", "-a", "-t", session, "-n", name, "-c", cwd)
	return err
}
```

When `name == ""`, build the args without `-n <name>`: `new-window -a -t <session> -c <cwd>`. Since `-c cwd` is already passed, the window names itself to the folder basename immediately via `automatic-rename-format` — no rename round-trip.

### 5. Explicitly unchanged (keep `-n` where names are deliberate)

- `rk riff` panes: `buildNewWindowArgs` in `app/backend/cmd/rk/riff.go` (~line 625) keeps `new-window -n <resolvedName>`.
- Iframe/service windows: `app.tsx:761` + `CreateWindowWithOptions` (`tmux.go:1312`) keep `-n`.
- Explicit renames (top-bar heading inline edit / palette "Window: Rename" → `RenameWindow`, `tmux.go:1344`): unchanged — renaming pins the name (tmux disables automatic-rename on manual rename), which is desired.

### 6. Tests (constitution: changed behavior MUST be tested)

- **Go**: table-driven coverage for `CreateWindow` arg construction with empty vs non-empty name (no `-n` when empty); API handler test for omitted-name `POST /api/sessions/{session}/windows` accepted (and empty-name rename still rejected).
- **Playwright e2e** where possible: `+ New Window` flow creates a window whose sidebar row shows the folder basename (not "zsh"); companion `.spec.md` updated per constitution if a `.spec.ts` is added/modified. The e2e harness runs an isolated tmux server (`rk-test-e2e`) with the staged embedded config, so `automatic-rename-format` applies there.

### Out of scope

- **Migration of existing windows**: windows already created with `-n zsh` have `automatic-rename` off and stay pinned. A one-time `set -w automatic-rename on` (or manual rename) would unpin them — user acknowledged this caveat; migration is optional/out of scope unless trivially cheap during apply.
- **Rename API relaxation**: only window CREATE becomes name-optional.
- **Frontend name fallbacks**: no display-side derivation — the name comes from tmux, period.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) window creation path — name-optional `CreateWindow` (omits `-n` when unnamed) and the tmux-native `automatic-rename-format '#{b:pane_current_path}'` convention in embedded configs
- `run-kit/ui-patterns`: (modify) `+ New Window` no longer pins "zsh" — unnamed windows display their folder basename, live-updating via tmux automatic-rename

## Impact

- `configs/tmux/default.conf`, `simple.conf`, `poweruser.conf`, `byobu.conf` — one config line each (embedded via Go embed; staged by `just setup`)
- `app/backend/internal/tmux/tmux.go` — `CreateWindow` conditional `-n` (+ `tmux_test.go` coverage)
- `app/backend/api/windows.go` — `handleWindowCreate` name-optional validation (+ `windows_test.go`/API test coverage)
- `app/frontend/src/api/client.ts` — `createWindow` optional `name` param, omit from body when absent
- `app/frontend/src/app.tsx` — drop `"zsh"` at the `+ New Window` call site; ghost-window placeholder label
- Playwright e2e (`app/frontend/tests/`) — `+ New Window` folder-name assertion where feasible (+ sibling `.spec.md`)
- No new endpoints, routes, state, or dependencies. No database (constitution II). Existing windows unaffected (stay pinned).

## Open Questions

- None — all design decisions were resolved in the originating conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | tmux-native approach: `set -g automatic-rename-format '#{b:pane_current_path}'` in all four `configs/tmux/` files | Discussed — user explicitly chose tmux-native over frontend fallback; `#{b:}` verified available on tmux 3.6a; single-sourced name fits constitution Principle II | S:95 R:90 A:95 D:95 |
| 2 | Certain | Drop hardcoded `"zsh"` at `app.tsx:681`; window name optional through create API; `CreateWindow` omits `-n` when name empty | Discussed — user explicitly agreed the full path (frontend → API → tmux layer); `-c cwd` already passed so auto-name is immediate | S:95 R:80 A:90 D:90 |
| 3 | Certain | Keep `-n` for `rk riff` panes and iframe/service windows; explicit renames keep pinning the name | Discussed — user explicitly agreed these names are deliberate and unchanged | S:90 R:90 A:95 D:90 |
| 4 | Certain | Rename API keeps requiring a non-empty name — only window CREATE relaxes to name-optional | Discussed — explicit constraint from the conversation | S:90 R:95 A:90 D:90 |
| 5 | Certain | Duplicate row names when several unnamed windows share a folder are acceptable | Discussed — UI addresses windows by `window_id`; user's adjective-noun worktree workflow avoids collisions | S:90 R:95 A:95 D:95 |
| 6 | Certain | Tests: Go coverage for empty-name `CreateWindow`/API handling; Playwright e2e for the `+ New Window` flow where possible | Constitution/code-quality mandate tests for changed behavior; explicitly noted in the conversation | S:85 R:90 A:95 D:90 |
| 7 | Confident | No migration for existing `-n zsh`-pinned windows — out of scope unless trivially cheap during apply | User acknowledged the caveat; "trivially cheap" leaves minor apply-time judgment | S:80 R:90 A:70 D:70 |
| 8 | Confident | Optimistic ghost-window label becomes basename of the creation cwd (was "zsh") | Not discussed — small frontend-only detail; mimicking tmux's eventual auto-name is the obvious choice and easily changed | S:45 R:85 A:75 D:65 |
| 9 | Confident | Empty-string name as the "unnamed" sentinel through client → API JSON → Go `CreateWindow` (omit `-n` on empty) | Implementation detail of the agreed design; matches existing optional-field body handling in `client.ts`/`windows.go` | S:65 R:85 A:85 D:75 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
