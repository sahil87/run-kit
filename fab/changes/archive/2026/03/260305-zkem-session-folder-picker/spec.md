# Spec: Create Session from Folder

**Change**: 260305-zkem-session-folder-picker
**Created**: 2026-03-05
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Recursive directory search or file browsing — only immediate directory children matching a prefix
- Symlink resolution — paths returned as-is from `fs.readdir`
- Persisting recent paths — quick picks derive from live tmux session data, not stored history

## API: Directory Listing Endpoint

### Requirement: Server-side directory autocomplete

The system SHALL expose `GET /api/directories` that returns directories matching a prefix, for use by the client-side path autocomplete.

The endpoint SHALL accept a `prefix` query parameter containing a partial path. It SHALL expand `~` to the server user's `$HOME` directory. It SHALL return only directories, not files. It SHALL return immediate children of the parent directory whose names start with the prefix's last segment.

The endpoint MUST use `fs.readdir` with `{ withFileTypes: true }` to list directories — never `exec` or shell commands (Constitution I). The endpoint MUST include a timeout on any filesystem operation.

#### Scenario: Valid prefix with matches

- **GIVEN** the server filesystem has directories `~/code/wvrdz/` and `~/code/wvrdz-infra/`
- **WHEN** `GET /api/directories?prefix=~/code/wvr` is called
- **THEN** the response is `200` with `{ "directories": ["~/code/wvrdz/", "~/code/wvrdz-infra/"] }`

#### Scenario: Prefix is exact directory

- **GIVEN** the server filesystem has `~/code/wvrdz/` containing subdirectories `run-kit/`, `ao/`
- **WHEN** `GET /api/directories?prefix=~/code/wvrdz/` is called (trailing slash)
- **THEN** the response lists children: `{ "directories": ["~/code/wvrdz/run-kit/", "~/code/wvrdz/ao/", ...] }`

#### Scenario: No matches

- **GIVEN** no directories under `~/code/` start with `zzz`
- **WHEN** `GET /api/directories?prefix=~/code/zzz` is called
- **THEN** the response is `200` with `{ "directories": [] }`

#### Scenario: Empty prefix

- **GIVEN** any server state
- **WHEN** `GET /api/directories?prefix=` or no `prefix` param is provided
- **THEN** the response is `200` with `{ "directories": [] }`

### Requirement: Security boundary

The endpoint MUST restrict results to paths under the server user's `$HOME` directory. The endpoint MUST reject absolute paths that resolve outside `$HOME` and any path containing `..` segments. Violations SHALL return `400` with an error message.

#### Scenario: Path traversal attempt

- **GIVEN** any server state
- **WHEN** `GET /api/directories?prefix=~/../../etc` is called
- **THEN** the response is `400` with `{ "error": "Path must be under home directory" }`

#### Scenario: Absolute path outside home

- **GIVEN** the server user's home is `/home/user`
- **WHEN** `GET /api/directories?prefix=/etc/` is called
- **THEN** the response is `400` with `{ "error": "Path must be under home directory" }`

### Requirement: Tilde expansion

The endpoint SHALL expand a leading `~` or `~/` in the prefix to the server user's home directory (`$HOME` or `os.homedir()`). Paths without a leading `~` that are relative SHALL be treated as relative to `$HOME`.

#### Scenario: Tilde prefix

- **GIVEN** server home is `/home/user`
- **WHEN** `GET /api/directories?prefix=~/code/` is called
- **THEN** the prefix resolves to `/home/user/code/` internally

#### Scenario: Bare relative path

- **GIVEN** server home is `/home/user`
- **WHEN** `GET /api/directories?prefix=code/` is called
- **THEN** the prefix resolves to `/home/user/code/` internally

### Requirement: Response format

Returned paths SHALL use `~/` prefix (replacing the absolute home path) for display friendliness. Each directory path SHALL end with a trailing `/`.

#### Scenario: Paths use tilde shorthand

- **GIVEN** server home is `/home/user` and directories exist at `/home/user/code/foo/`
- **WHEN** `GET /api/directories?prefix=~/code/` is called
- **THEN** paths are returned as `~/code/foo/` (not `/home/user/code/foo/`)

## API: Create Session with CWD

### Requirement: Optional CWD on session creation

The `createSession` action in `POST /api/sessions` SHALL accept an optional `cwd` field. When provided, the new tmux session SHALL be created with that directory as its working directory. When omitted, behavior is unchanged (no `-c` flag to tmux).

The `cwd` field SHALL be validated with `validatePath` before use. The tilde SHALL be expanded server-side before passing to tmux.

#### Scenario: Create session with CWD

- **GIVEN** `~/code/wvrdz/run-kit/` exists on the server
- **WHEN** `POST /api/sessions` with `{ "action": "createSession", "name": "run-kit", "cwd": "~/code/wvrdz/run-kit" }`
- **THEN** a tmux session named `run-kit` is created with CWD `/home/user/code/wvrdz/run-kit`

#### Scenario: Create session without CWD

- **GIVEN** any server state
- **WHEN** `POST /api/sessions` with `{ "action": "createSession", "name": "test" }` (no `cwd`)
- **THEN** behavior is identical to current: session created without `-c` flag

#### Scenario: Invalid CWD

- **GIVEN** any server state
- **WHEN** `POST /api/sessions` with `{ "action": "createSession", "name": "test", "cwd": "" }`
- **THEN** `400` error from `validatePath`

### Requirement: tmux.ts CWD support

`createSession` in `src/lib/tmux.ts` SHALL accept an optional `cwd` parameter. When provided, it SHALL pass `-c <cwd>` to `tmux new-session`. The function signature becomes `createSession(name: string, cwd?: string)`.

#### Scenario: createSession with cwd

- **GIVEN** tmux is running
- **WHEN** `createSession("myproject", "/home/user/code/myproject")` is called
- **THEN** `tmux new-session -d -s myproject -c /home/user/code/myproject` is executed

## UI: Create Session Dialog

### Requirement: Quick picks from existing sessions

The Create Session dialog SHALL display a "Recent" section listing deduplicated project root paths derived from existing tmux sessions. Paths SHALL be extracted from window 0's `pane_current_path` of each `ProjectSession` already available via the SSE stream — no additional API call needed.

Quick pick paths SHALL be deduplicated and sorted alphabetically. Selecting a quick pick SHALL fill both the path input and auto-derive the session name. Quick pick items SHALL have a minimum tap height of 44px for mobile accessibility.

#### Scenario: Quick picks shown from existing sessions

- **GIVEN** sessions exist with project roots `~/code/wvrdz/run-kit`, `~/code/wvrdz/ao`, `~/code/wvrdz/run-kit` (duplicate)
- **WHEN** the Create Session dialog opens
- **THEN** "Recent" shows two items: `~/code/wvrdz/ao` and `~/code/wvrdz/run-kit` (sorted, deduplicated)

#### Scenario: Selecting a quick pick

- **GIVEN** the Create Session dialog shows quick pick `~/code/wvrdz/run-kit`
- **WHEN** the user taps/clicks it
- **THEN** the path input fills with `~/code/wvrdz/run-kit` and session name auto-fills with `run-kit`

### Requirement: Path input with autocomplete

The dialog SHALL include a text input for typing a server-side path. As the user types, the client SHALL call `GET /api/directories?prefix=<value>` with ~300ms debounce. Results SHALL appear as a dropdown list below the input. Selecting a result SHALL fill the input and auto-derive the session name.

#### Scenario: Autocomplete results appear

- **GIVEN** the dialog is open and the user has typed `~/code/wvr`
- **WHEN** the debounce period elapses
- **THEN** `GET /api/directories?prefix=~/code/wvr` is called and results render as a dropdown

#### Scenario: Selecting an autocomplete result

- **GIVEN** autocomplete shows `~/code/wvrdz/`
- **WHEN** the user selects it
- **THEN** the path input updates to `~/code/wvrdz/` and a new autocomplete request fires for children of `~/code/wvrdz/`

### Requirement: Session name auto-derivation

When a path is selected (via quick pick or autocomplete), the session name field SHALL auto-populate with the last segment of the path (e.g., `~/code/wvrdz/run-kit` yields `run-kit`). The name field SHALL remain editable — auto-derivation is a convenience default.

#### Scenario: Auto-derived name

- **GIVEN** the user selects path `~/code/wvrdz/run-kit`
- **WHEN** the path is applied
- **THEN** the session name input shows `run-kit`
- **AND** the user can edit it to a different name

### Requirement: Create action sends CWD

When the user submits the Create Session dialog with a path selected, the client SHALL include the path as `cwd` in the `POST /api/sessions` request alongside the session name.

#### Scenario: Create with path

- **GIVEN** the user has filled path `~/code/wvrdz/run-kit` and name `run-kit`
- **WHEN** they click Create
- **THEN** `POST /api/sessions` is called with `{ "action": "createSession", "name": "run-kit", "cwd": "~/code/wvrdz/run-kit" }`

#### Scenario: Create without path

- **GIVEN** the user has typed only a name `test-session` with no path selected
- **WHEN** they click Create
- **THEN** `POST /api/sessions` is called with `{ "action": "createSession", "name": "test-session" }` (no `cwd`)

## Design Decisions

1. **`fs.readdir` over subprocess**: Use Node's native `fs.readdir` with `{ withFileTypes: true }` rather than spawning `ls` via `execFile`. Avoids subprocess overhead for a simple filesystem query. Constitution I requires `execFile` for subprocess calls, but `fs.readdir` is not a subprocess — it's a native Node API.
   - *Rejected*: `execFile("ls", ...)` — unnecessary subprocess for directory listing.

2. **Tilde in API responses**: Return paths with `~/` prefix rather than absolute paths. Shorter, portable across user sessions, matches what users type in terminals.
   - *Rejected*: Absolute paths — longer, leaks home directory structure to UI.

3. **Quick picks from SSE data (no new API)**: Client already has `ProjectSession[]` with window paths via SSE. Extract project roots client-side rather than adding a "recent paths" API endpoint.
   - *Rejected*: Server-side "recent paths" endpoint — violates Constitution II (no persistent state) and is redundant with existing data.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server-side autocomplete for directory selection | Confirmed from intake #1 — native file picker doesn't work for remote access | S:95 R:90 A:90 D:95 |
| 2 | Certain | Quick picks from existing session CWDs | Confirmed from intake #2 — derive, don't configure (Constitution VII) | S:90 R:95 A:95 D:90 |
| 3 | Certain | Session name auto-derived from last path segment | Confirmed from intake #3 — explicit agreement | S:90 R:95 A:85 D:90 |
| 4 | Certain | Restrict directory listing to $HOME | Confirmed from intake #4 — security boundary | S:85 R:80 A:90 D:85 |
| 5 | Certain | fs.readdir for directory listing | Upgraded from intake Confident #7 — Node native API, no subprocess, clearly best approach | S:80 R:95 A:95 D:90 |
| 6 | Confident | Debounce autocomplete at ~300ms | Confirmed from intake #5 — standard UX practice, easily tuned | S:55 R:95 A:85 D:80 |
| 7 | Confident | Quick picks from window 0 pane_current_path | Confirmed from intake #6 — codebase already derives project root this way in sessions.ts | S:60 R:90 A:90 D:80 |
| 8 | Confident | Return tilde-prefixed paths in API response | Better UX than absolute paths, matches terminal conventions | S:55 R:95 A:80 D:75 |
| 9 | Confident | Bare relative paths resolve relative to $HOME | Sensible default — most user paths are under home | S:50 R:90 A:75 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
