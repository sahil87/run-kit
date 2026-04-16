# Intake: rk context — Agent Discovery

**Change**: 260416-0gz9-rk-context-agent-discovery
**Created**: 2026-04-16
**Status**: Draft

## Origin

> Conversational follow-up to the iframe-proxy-windows discussion. User asked how AI agents (Claude, etc.) would discover run-kit's capabilities — especially new ones like iframe windows and the tmux variable conventions. `rk -h` was considered insufficient: agents don't proactively run help commands, CLI help is human-shaped, and tmux variable conventions aren't CLI commands. Three approaches were discussed (CLAUDE.md injection, `rk context` command, MCP server). User agreed on `rk context` as the immediate solution, with MCP as a future direction.

## Why

AI agents running inside run-kit-managed tmux panes have no way to discover what run-kit can do for them. They don't know they can create iframe windows, set URLs via tmux variables, or use the proxy. Without a discovery mechanism, every agent launch requires manual instructions ("you can do X by running Y") — which doesn't scale and gets stale as capabilities evolve.

A dedicated `rk context` command provides a single, always-current, agent-optimized summary of the environment. It can be injected into agent context via hooks, CLAUDE.md, wrapper scripts, or simply run on demand. The output is maintained alongside the code, so it evolves with the capabilities it describes.

## What Changes

### 1. `rk context` Cobra Subcommand

New file `app/backend/cmd/rk/context.go` — a cobra command registered on `rootCmd`.

```bash
$ rk context
```

Output is a compact, agent-optimized text block. Not JSON, not YAML — plain text with markdown-style formatting that reads naturally in an LLM context window. The output includes:

**Environment section** — where the agent is:
- Session name, window name, pane ID (from `$TMUX_PANE` and tmux queries)
- run-kit server URL (from config / environment)
- Current window type (`@rk_type` if set)

**Capabilities section** — what the agent can do:
- Create/manage terminal windows
- Create iframe windows (tmux variable conventions with exact commands)
- Set/change iframe URLs
- Use the proxy (`/proxy/{port}/...`)
- Available `rk` CLI commands grouped by category (server, diagnostics, etc.) with one-line descriptions

**Conventions section** — how things work:
- Tmux user-defined options (`@rk_type`, `@rk_url`) and their valid values
- Lifecycle: killing a window kills the backing process
- SSE reactivity: changes to tmux options are picked up automatically

### 2. Dynamic Output

The output should be partially dynamic — reflecting the actual current state:

- Session/window/pane info comes from live tmux queries
- Server URL comes from config
- Capabilities listed are static but maintained in code alongside the features they describe
- If run outside a tmux session, the environment section gracefully degrades (notes "not in tmux") but still shows capabilities

### 3. Integration Points

The command itself is standalone, but it's designed to be composed:

- **CLAUDE.md injection**: `rk context >> .claude/CLAUDE.md` (or a hook that does this on session start; plain text output is already markdown-compatible)
- **Agent spawn wrapper**: fab-kit's spawn command could prepend `rk context` output to the agent's initial prompt
- **Manual discovery**: agent or user runs `rk context` at any time

These integration points are out of scope for this change — just the command itself.

## Affected Memory

- `run-kit/architecture`: (modify) Add `rk context` command to CLI surface area

## Impact

- **Backend CLI**: New cobra subcommand in `cmd/rk/`, new file `context.go`
- **Internal/tmux**: May use existing `ListSessions`/`ListWindows` for environment detection — no changes to tmux package needed
- **No frontend changes**
- **No API changes**

## Open Questions

*None — all resolved via /fab-clarify.*

## Clarifications

### Session 2026-04-16

| # | Action | Detail |
|---|--------|--------|
| 7 | Confirmed | Capabilities-only output — no current windows/sessions listing |
| — | Clarified | iframe/proxy features included in output even though they ship via separate change (coordinated pair) |
| 6 | Changed | `--format md` flag deferred — plain text is already markdown-compatible |
| — | Clarified | CLI commands listing grouped by category with one-line descriptions |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plain text output, not JSON/YAML | Discussed — the output goes into LLM context windows; structured formats add parsing overhead for no benefit | S:85 R:90 A:85 D:90 |
| 2 | Certain | Standalone command, not an MCP server | Discussed — MCP is the long-term direction but a separate change; `rk context` is the immediate solution | S:90 R:90 A:85 D:90 |
| 3 | Certain | Output includes tmux variable conventions (`@rk_type`, `@rk_url`) with exact commands | Discussed — this is the primary thing agents can't discover from `rk -h` | S:85 R:85 A:90 D:90 |
| 4 | Confident | Graceful degradation outside tmux — show capabilities without environment section | Not explicitly discussed but follows run-kit's pattern; the command should still be useful for documentation/injection even when not in tmux | S:65 R:90 A:80 D:80 |
| 5 | Confident | Single file addition (`context.go`) — no new packages | Follows existing CLI pattern (`status.go`, `doctor.go`); the command is self-contained | S:70 R:90 A:85 D:85 |
| 6 | Certain | `--format md` flag deferred — plain text is already markdown-compatible | Clarified — user chose to defer <!-- clarified: --format md deferred, plain text sufficient for v1 --> | S:95 R:85 A:60 D:55 |
| 7 | Certain | Output does not list current windows/sessions (capabilities-focused, not state-focused) | Clarified — user confirmed; `rk status` covers current state <!-- clarified: capabilities-only output confirmed --> | S:95 R:85 A:70 D:50 |
| 8 | Certain | iframe/proxy features included in output (coordinated with iframe-proxy-windows change) | Clarified — user chose coordinated pair approach | S:95 R:80 A:70 D:75 |
| 9 | Certain | CLI commands listed grouped by category with one-line descriptions | Clarified — user chose grouped format over flat list | S:95 R:90 A:85 D:80 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
