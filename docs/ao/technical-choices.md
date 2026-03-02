# Technical Choices

## Language and Runtime

**TypeScript (strict mode, ESM).** The entire codebase uses `"type": "module"` with `.js` extensions in imports, `node:` prefix for builtins, and strict null checks. This is enforced by ESLint rules and the tsconfig `"strict": true`.

**Node.js 20+.** Required minimum. Uses modern APIs like `node:fs/promises`, `node:crypto.randomUUID()`, structured `Error` with `cause`, `Set`/`Map` methods. No polyfills.

**pnpm workspaces.** Monorepo with `packages/*` and `packages/plugins/*` workspace globs. Dependencies are hoisted by pnpm. Build order is handled by `pnpm -r build`.

## Config

**YAML + Zod.** Config is loaded from `agent-orchestrator.yaml`, parsed by the `yaml` package, and validated at load time with Zod schemas. This gives both human-readable config files and runtime type safety. Zod schemas define defaults, so a minimal config just works:

```yaml
projects:
  my-app:
    repo: org/my-app
    path: ~/my-app
```

**Config discovery** searches up the directory tree (like git), checks `AO_CONFIG_PATH` env var, and falls back to home directory locations. This means `ao` commands work from any subdirectory of the project.

## CLI

**Commander.js.** The `ao` command is a standard Commander.js CLI with subcommands (`spawn`, `status`, `session ls`, `send`, etc.). Each command is registered via a `register*` function that receives the program instance.

Commands are organized as separate files under `packages/cli/src/commands/`, each exporting a registration function. This keeps the entry point thin.

## Web Dashboard

**Next.js 15 (App Router) + Tailwind.** Server-side rendering for initial load, client-side updates via SSE. The dashboard is a read-heavy interface — it mostly displays session state, PR tables, and CI check results.

**Server components** handle data fetching (reading metadata files, calling SCM plugins). **Client components** handle real-time updates and interactive elements (send message, kill session, merge PR).

**Custom terminal server** runs alongside Next.js for WebSocket-based terminal access to tmux sessions. Two ports: one for the terminal WebSocket relay, one for direct terminal connections.

## Data Storage

**Flat key=value files for metadata.** No database. Each session has one file with lines like `status=working`, `pr=https://...`, `branch=feat/INT-123`. Advantages:
- Human-readable and debuggable (`cat`, `grep`, manual edits)
- Atomic writes via `write-to-tmp + rename`
- Concurrent access is safe (rename is atomic on POSIX)
- No migrations, no schema versions
- Backward compatible with the bash scripts that preceded the TypeScript rewrite

**JSONL event logs for agent introspection.** Claude Code writes `.jsonl` session files that the orchestrator reads to determine activity state, extract summaries, and calculate cost estimates. The orchestrator reads these files backwards from the end (only the last entry matters for activity detection) or parses only the tail (~128KB) for summary/cost extraction.

## Process Execution

**`execFile` everywhere, never `exec`.** This is a security-critical choice. `exec` spawns a shell and interprets its argument as a shell command, creating injection risk. `execFile` bypasses the shell entirely and passes arguments as an array. This is enforced by code review and CLAUDE.md.

**Timeouts on all external commands.** Every `execFile` call includes a timeout (typically 5-30 seconds) to prevent zombie processes from blocking the orchestrator.

**Process detection via `ps` with TTL cache.** To check if an agent is running in a tmux session, the claude-code plugin runs `ps -eo pid,tty,args` and searches for the process by TTY. This is cached for 5 seconds to avoid spawning N `ps` processes when listing N sessions.

## Tmux Integration

**Tmux as the default runtime.** Tmux is ubiquitous on Unix systems, allows human attachment for debugging, persists across SSH disconnects, and handles long-running processes well.

**Load-buffer + paste-buffer for long messages.** Text longer than 200 characters or containing newlines is written to a temp file, loaded into a named tmux buffer, then pasted — rather than using `send-keys` which truncates long strings. Named buffers prevent race conditions between concurrent sends.

**Escape before sending.** Every message send starts with an Escape keystroke to clear any partial input the agent might have, mimicking what the original bash scripts did.

## Git Worktrees

**One worktree per session.** Each agent gets its own git worktree based off the project's default branch. This gives true filesystem isolation — agents can't step on each other's files. Worktrees are created under `~/.worktrees/{projectId}/{sessionId}/` (or `~/.agent-orchestrator/{hash}-{projectId}/worktrees/`).

**Symlinks for shared resources.** Config files like `.env` or `.claude` that shouldn't be duplicated into each worktree can be symlinked from the main repo via the `symlinks` config option.

## Activity Detection

**JSONL-based (preferred) over terminal parsing.** The legacy approach parsed tmux terminal output to guess what the agent was doing. The current approach reads the agent's own session JSONL file, checks the last entry type, and determines state:

| Last JSONL entry type | Activity state |
|----------------------|---------------|
| `user`, `tool_use`, `progress` | active (or idle if stale) |
| `assistant`, `summary`, `result` | ready (or idle if stale) |
| `permission_request` | waiting_input |
| `error` | blocked |

"Stale" is determined by a configurable threshold (default 5 minutes). This is more reliable than terminal parsing and works regardless of runtime (tmux, docker, process).

## Hashing Strategy

**SHA-256 of config directory path, truncated to 12 hex chars.** This creates a namespace for each orchestrator installation. The hash ensures:
- Same config location always produces the same hash
- Different checkouts (e.g., `~/orchestrator` vs `~/orchestrator-v2`) get different hashes
- Symlinks are resolved before hashing for consistency
- Collisions are detected at runtime via `.origin` files
