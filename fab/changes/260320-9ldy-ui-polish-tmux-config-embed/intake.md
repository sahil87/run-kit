# Intake: UI Polish, tmux Config Auto-Create, and Embed Restructure

**Change**: 260320-9ldy-ui-polish-tmux-config-embed
**Created**: 2026-03-20
**Status**: Draft

## Origin

> Conversational session covering multiple small improvements. User identified issues while using the app and directed fixes interactively: breadcrumb text alignment, `just dev` failing in fresh worktrees due to missing embed directory, tmux config file not found on first run, server dropdown missing create action, hostname not visible in bottom bar, and misaligned bottom borders between sidebar and terminal.

## Why

Several quality-of-life issues compound into a poor first-run and daily-use experience:

1. **Breadcrumb center-cropping**: Session names with `max-w-[7ch]` and `truncate` are center-aligned due to `justify-center` on the flex trigger button, cutting text on both sides instead of showing left-aligned text with right-side ellipsis. Visually confusing.

2. **Fresh worktree compilation failure**: `just dev` fails in new worktrees because `//go:embed all:dist` requires the `dist/` directory to exist, but it's fully gitignored. Developers must run `just build` first — a hidden prerequisite that breaks the expected workflow.

3. **Embed package naming**: `app/backend/frontend/` as a Go package that contains `dist/` is confusing — `frontend` is a Go source package, `dist/` is build output. After exploring alternatives (`app/backend/dist/`, `app/backend/internal/frontend/`), settled on `app/backend/build/` which houses `embed.go` (Go source) and `frontend/` (build output), cleanly separating concerns.

4. **tmux config missing on first run**: `~/.run-kit/tmux.conf` doesn't exist until `run-kit init-conf` is manually run. Every tmux command on the runkit server passes `-f configPath`, which fails if the file is absent. Users hit this on first `run-kit serve`.

5. **`-f` flag on every tmux command**: tmux only reads `-f` when starting a new server. Passing it on every command (list-sessions, kill-window, etc.) is unnecessary overhead and can cause errors if the config file doesn't exist.

6. **Server dropdown missing create action**: The session and window breadcrumb dropdowns have `+ New Session` and `+ New Window` actions, but the sidebar server dropdown lacks a `+ tmux server` equivalent. Users must use the command palette to create a new server.

7. **Hostname not visible**: The hostname (from `/api/health`) is shown in the browser title but not in the UI itself. On shared machines or remote access, seeing the hostname in the bottom bar provides quick orientation.

8. **Bottom bar border misalignment**: The sidebar footer and terminal bottom bar have `border-t` borders that don't align horizontally because the containers have different heights (different padding + content sizes).

9. **Kill tmux server 500 error**: `POST /api/servers/kill` returns HTTP 500. Needs investigation — may be an error from tmux when the server socket goes away during kill.

## What Changes

### Breadcrumb Left-Alignment

Remove `justify-center` from the `BreadcrumbDropdown` trigger button in `app/frontend/src/components/breadcrumb-dropdown.tsx`. The default flex `justify-start` left-aligns text, and the existing `truncate` class properly shows ellipsis on the right when text overflows.

### Embed Restructure: `app/backend/frontend/` → `app/backend/build/`

- Delete `app/backend/frontend/embed.go` (package `frontend`, `//go:embed all:dist`, var `Dist`)
- Create `app/backend/build/embed.go` (package `build`, `//go:embed all:frontend`, var `Frontend`)
- Create `app/backend/build/frontend/.gitkeep` — tracked via gitignore negation
- Update `app/backend/api/spa.go`: import `run-kit/build`, use `build.Frontend`, sub into `"frontend"` instead of `"dist"`
- Update `scripts/build.sh`: copy destination becomes `app/backend/build/frontend/`
- Update `.gitignore`: add rules to track `.gitkeep` while ignoring build output:
  ```
  app/backend/build/frontend/*
  !app/backend/build/frontend/.gitkeep
  ```

### tmux Config Auto-Create

- Add `tmux.EnsureConfig()` function in `app/backend/internal/tmux/tmux.go`: writes embedded default `tmux.conf` to `~/.run-kit/tmux.conf` if the file doesn't exist. No-op if file exists or no home dir.
- Call `tmux.EnsureConfig()` at the start of the `serve` command in `app/backend/cmd/run-kit/serve.go`

### `-f` Config Flag Scoping

- Remove `-f configPath` from `serverArgs()` — this function is called on every tmux command
- Add `configArgs()` helper returning `["-f", configPath]` when set, `nil` otherwise
- Use `configArgs()` only in `CreateSession` (may start the server) and `ReloadConfig` (explicit reload)

### Server Dropdown: `+ tmux server` Action

- Add `onCreateServer` prop to `Sidebar` component
- Add `+ tmux server` button at top of server dropdown with divider (matching breadcrumb dropdown pattern)
- Pass `() => setShowCreateServerDialog(true)` from `app.tsx` (reuses existing create server dialog from command palette)

### Hostname in Bottom Bar

- Add optional `hostname` prop to `BottomBar` component
- Render hostname right-aligned (`ml-auto`) in `text-xs text-text-secondary`
- Hidden on mobile (`hidden sm:inline`)
- Pass `hostname` state from `app.tsx`

### Bottom Bar Border Alignment

- Set explicit `h-[48px]` on both the sidebar server footer and terminal bottom bar wrapper
- Remove bottom padding from sidebar `<nav>` (`py-2` → `pt-2`) to eliminate gap above server footer

### Server Label Rename

- Change sidebar label from `"Server:"` to `"tmux server:"` — lowercase `tmux` matches official project styling

### Kill tmux Server Fix

- Investigate `POST /api/servers/kill` returning 500
- The endpoint calls `tmux.KillServer()` which runs `tmux -L <name> kill-server`
- Likely cause: tmux returns non-zero exit when the server socket disappears during kill, or the server doesn't exist

## Affected Memory

- `run-kit/architecture`: (modify) Update embed paths from `app/backend/frontend/` to `app/backend/build/`, update `frontend.Dist` → `build.Frontend`, update build pipeline copy destination, update SPA handler references

## Impact

- **Frontend**: `breadcrumb-dropdown.tsx`, `sidebar.tsx`, `sidebar.test.tsx`, `bottom-bar.tsx`, `app.tsx`
- **Backend**: `api/spa.go`, `internal/tmux/tmux.go`, `cmd/run-kit/serve.go`
- **Build**: `scripts/build.sh`, `.gitignore`
- **Embed**: `app/backend/build/embed.go` (new), `app/backend/frontend/embed.go` (deleted)
- **Memory**: `docs/memory/run-kit/architecture.md`

## Open Questions

- What is the exact error message from `tmux kill-server` that causes the 500? Need to reproduce and check stderr output.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove `justify-center` from breadcrumb trigger | Discussed — user showed screenshot of center-cropped text, fix is straightforward CSS | S:95 R:90 A:95 D:95 |
| 2 | Certain | Move embed to `app/backend/build/` package | Discussed — user evaluated `app/backend/dist/`, `app/backend/internal/frontend/`, and chose `build/` housing both `embed.go` and `frontend/` | S:95 R:80 A:90 D:95 |
| 3 | Certain | Track `.gitkeep` via gitignore negation | Discussed — user chose option 1 (gitignore fix) over option 2 (build tags) | S:90 R:85 A:90 D:90 |
| 4 | Certain | Auto-create tmux config on serve startup | Discussed — user chose auto-create (option B) over conditional skip (option A) | S:90 R:80 A:85 D:90 |
| 5 | Certain | Pass `-f` only on CreateSession and ReloadConfig | Discussed — user confirmed tmux only reads `-f` on server start and reload | S:90 R:75 A:90 D:90 |
| 6 | Certain | Add `+ tmux server` to sidebar dropdown | Discussed — user requested it, equivalent to command palette "Create tmux server" | S:90 R:90 A:90 D:95 |
| 7 | Certain | Show hostname in bottom bar, hidden on mobile | Discussed — user requested it with explicit mobile-hide requirement | S:90 R:90 A:85 D:90 |
| 8 | Certain | Explicit `h-[48px]` on both bottom bars | Discussed — user measured pixel heights and confirmed alignment approach | S:95 R:90 A:90 D:95 |
| 9 | Certain | Use lowercase `tmux` in label | Discussed — confirmed official styling is all lowercase | S:90 R:95 A:95 D:95 |
| 10 | Certain | Dropdown density: `text-sm py-2` for all dropdowns | Discussed — user tried both densities, chose the top-bar density for all | S:85 R:90 A:85 D:85 |
| 11 | Tentative | Kill server 500 is caused by tmux exit code on socket teardown | Observed error in logs but not yet reproduced locally — `tmux -L test kill-server` returned 0 in local test | S:50 R:70 A:50 D:60 |

11 assumptions (10 certain, 0 confident, 1 tentative, 0 unresolved).
