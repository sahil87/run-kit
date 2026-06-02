# Spec: rk context — Agent Discovery

**Change**: 260416-0gz9-rk-context-agent-discovery
**Created**: 2026-04-16
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- MCP server for agent discovery — separate future change
- `--format md` flag — deferred; plain text output is already markdown-compatible
- Listing current windows/sessions — `rk status` covers runtime state
- Integration hooks (CLAUDE.md injection, agent spawn wrappers) — out of scope

## CLI: Command Registration

### Requirement: `rk context` Cobra subcommand

The binary SHALL register a `context` subcommand on `rootCmd` in `app/backend/cmd/rk/context.go`. The command SHALL have `Use: "context"` and `Short: "Show agent-optimized environment info"`.

#### Scenario: Run `rk context` inside tmux

- **GIVEN** the user is inside a run-kit managed tmux pane
- **WHEN** `rk context` is executed
- **THEN** the command prints Environment, Capabilities, and Conventions sections to stdout
- **AND** exits with code 0

#### Scenario: Run `rk context` outside tmux

- **GIVEN** `$TMUX_PANE` is unset (not inside tmux)
- **WHEN** `rk context` is executed
- **THEN** the command prints Capabilities and Conventions sections to stdout
- **AND** the Environment section shows `(not in tmux)` instead of live session data
- **AND** exits with code 0

## CLI: Output Format

### Requirement: Plain text with markdown-style formatting

The output SHALL be plain text using markdown-style headings and formatting. The output SHALL NOT use JSON, YAML, or any structured data format. The output MUST read naturally when injected into an LLM context window.

#### Scenario: Output is markdown-compatible

- **GIVEN** `rk context` produces output
- **WHEN** the output is appended to a `.md` file
- **THEN** it renders correctly as markdown (headings, code blocks, bullet lists)

## CLI: Environment Section

### Requirement: Dynamic environment detection

The Environment section SHALL display the agent's current tmux context using live queries. The section MUST include:

- **Session name**: from `tmux display-message -p '#{session_name}'` using the pane's session
- **Window name**: from `tmux display-message -p '#{window_name}'` using the pane's window
- **Pane ID**: from `$TMUX_PANE` environment variable
- **Server URL**: from `RK_HOST` and `RK_PORT` env vars (with defaults `127.0.0.1:3000`)
- **Window type**: from tmux user option `@rk_type` on the current window (if set)

All tmux queries SHALL use `exec.CommandContext` with a timeout (5 seconds). The tmux queries SHALL target the pane's own tmux server (not hardcoded to `runkit` or `default`).

#### Scenario: Environment section with all fields populated

- **GIVEN** the agent is in a tmux pane with `$TMUX_PANE` set to `%5`
- **AND** the pane belongs to session `my-project`, window `main`
- **AND** `@rk_type` is set to `terminal` on the window
- **WHEN** `rk context` is executed
- **THEN** the Environment section displays session name, window name, pane ID, server URL, and window type

#### Scenario: Environment section outside tmux

- **GIVEN** `$TMUX_PANE` is unset
- **WHEN** `rk context` is executed
- **THEN** the Environment section shows `(not in tmux)` as a single line
- **AND** the server URL is still shown (derived from env vars / defaults)

#### Scenario: Environment section when `@rk_type` is not set

- **GIVEN** the agent is in a tmux pane with `$TMUX_PANE` set
- **AND** the window does not have `@rk_type` set
- **WHEN** `rk context` is executed
- **THEN** the Environment section omits the window type line
- **AND** all other fields (session name, window name, pane ID, server URL) are displayed
<!-- clarified: @rk_type absent case — omit line, consistent with graceful degradation pattern -->

#### Scenario: Tmux query failure

- **GIVEN** `$TMUX_PANE` is set but the tmux query times out or fails
- **WHEN** `rk context` is executed
- **THEN** the Environment section shows available fields and omits failed fields
- **AND** the command still exits with code 0

## CLI: Capabilities Section

### Requirement: Static capability descriptions

The Capabilities section SHALL describe what agents can do within the run-kit environment. Content is static (compiled into the binary) but maintained alongside the features it describes.

The section MUST include:

1. **Terminal windows** — how to create and manage terminal windows via tmux commands and the REST API
2. **Iframe windows** — how to create iframe windows using tmux user options (`@rk_type`, `@rk_url`) with exact `tmux set-option` commands
3. **URL management** — how to set/change iframe URLs via `@rk_url` tmux option
4. **Proxy** — the proxy URL pattern (`/proxy/{port}/...`) for accessing local services through the run-kit server
5. **CLI commands** — available `rk` subcommands grouped by category with one-line descriptions

#### Scenario: Capabilities section content

- **GIVEN** `rk context` is executed
- **WHEN** the Capabilities section is rendered
- **THEN** it includes subsections for terminal windows, iframe windows, proxy, and CLI commands
- **AND** iframe window instructions include exact `tmux set-option -w @rk_type iframe` and `tmux set-option -w @rk_url <url>` commands
- **AND** CLI commands are grouped by category (Server, Diagnostics, Info)

### Requirement: Categorized CLI command listing

The CLI commands subsection SHALL group commands by category with one-line descriptions:

**Server**: `serve`, `update`
**Diagnostics**: `doctor`, `status`
**Info**: `context`, `init-conf`

Each entry SHALL be formatted as `rk <cmd>` followed by a dash and a one-line description. The categories and descriptions are compiled into the binary. `version` is a Cobra built-in flag (`rk --version`), not a subcommand — it SHALL NOT appear in the CLI commands listing.
<!-- clarified: version is a Cobra built-in flag, not a registered subcommand — confirmed from root.go -->

#### Scenario: CLI commands include all registered subcommands

- **GIVEN** `rk context` is executed
- **WHEN** the CLI commands subsection is rendered
- **THEN** every subcommand registered on `rootCmd` appears in exactly one category
- **AND** each command has a one-line description

## CLI: Conventions Section

### Requirement: Tmux convention documentation

The Conventions section SHALL document the tmux patterns that agents need to follow:

1. **Tmux user options**: `@rk_type` (valid values: `terminal`, `iframe`) and `@rk_url` (any URL string) — window-level options set via `tmux set-option -w`
2. **Window lifecycle**: killing a tmux window kills the backing process; no separate cleanup needed
3. **SSE reactivity**: changes to tmux window options are detected automatically by the run-kit server via SSE polling — no manual refresh or API call needed

#### Scenario: Conventions section content

- **GIVEN** `rk context` is executed
- **WHEN** the Conventions section is rendered
- **THEN** it documents `@rk_type` and `@rk_url` with their valid values and exact `tmux set-option` syntax
- **AND** it explains window lifecycle (kill window = kill process)
- **AND** it notes SSE auto-detection of option changes

## Design Decisions

1. **Single file, no new packages**: The command lives in `context.go` alongside other CLI commands. No `internal/context/` package — the output is simple enough to be self-contained in the command's `RunE` function.
   - *Why*: Follows existing pattern (`status.go`, `doctor.go`). The command produces text output from env vars and tmux queries — no complex business logic.
   - *Rejected*: Separate package with template system — over-engineering for static text with a few dynamic values.

2. **Tmux queries via raw exec, not `internal/tmux` package**: The context command queries the pane's own tmux server (whatever `$TMUX` points to), not the `runkit` server. The `internal/tmux` package hardcodes `-L runkit`. Instead, use direct `exec.CommandContext` calls without the `-L` flag.
   - *Why*: `internal/tmux` targets the `runkit` server specifically. `rk context` needs to query the current pane's server, which could be any tmux server.
   - *Rejected*: Adding a "current server" mode to `internal/tmux` — scope creep for one command's needs.

3. **Static capabilities compiled into binary**: Capability descriptions are Go string constants in `context.go`, not loaded from config or filesystem. Updated when the code is updated.
   - *Why*: Zero runtime dependencies, zero failure modes. The output is always available even if the filesystem is broken. Keeps the command self-contained.
   - *Rejected*: Template files on disk (fragile, versioning issues), dynamic capability detection (complex, unreliable).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plain text output, not JSON/YAML | Confirmed from intake #1 — output goes into LLM context windows | S:85 R:90 A:85 D:90 |
| 2 | Certain | Standalone command, not MCP server | Confirmed from intake #2 — MCP is a separate future change | S:90 R:90 A:85 D:90 |
| 3 | Certain | Output includes tmux variable conventions with exact commands | Confirmed from intake #3 — primary discovery gap for agents | S:85 R:85 A:90 D:90 |
| 4 | Certain | Graceful degradation outside tmux | Upgraded from intake #4 (Confident) — pattern is clear from codebase (doctor.go, status.go both handle missing dependencies gracefully) | S:80 R:90 A:85 D:85 |
| 5 | Certain | Single file addition (`context.go`) — no new packages | Upgraded from intake #5 (Confident) — confirmed by design decision #1, follows existing CLI pattern | S:85 R:90 A:90 D:90 |
| 6 | Certain | `--format md` flag deferred | Confirmed from intake #6 — plain text is markdown-compatible | S:95 R:85 A:60 D:55 |
| 7 | Certain | Capabilities-only output, no current windows/sessions listing | Confirmed from intake #7 — `rk status` covers runtime state | S:95 R:85 A:70 D:50 |
| 8 | Certain | iframe/proxy features included in output | Confirmed from intake #8 — coordinated pair with iframe-proxy-windows change | S:95 R:80 A:70 D:75 |
| 9 | Certain | CLI commands grouped by category with one-line descriptions | Confirmed from intake #9 — user chose grouped format | S:95 R:90 A:85 D:80 |
| 10 | Certain | Tmux queries use raw exec, not `internal/tmux` package | `internal/tmux` hardcodes `-L runkit`; context command queries the pane's own server via `$TMUX` | S:85 R:85 A:90 D:85 |
| 11 | Certain | CLI command categories: Server, Diagnostics, Info | Clarified — 6 subcommands (version is a flag, not a subcommand); grouping confirmed from codebase | S:95 R:90 A:80 D:70 |
| 12 | Certain | Server URL derived from `RK_HOST`/`RK_PORT` env vars with defaults | Matches existing `internal/config` pattern — `127.0.0.1:3000` defaults | S:85 R:90 A:90 D:90 |

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).
