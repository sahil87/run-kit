# Developer Experience

## Getting Started

Setup is a single script:

```bash
git clone https://github.com/ComposioHQ/agent-orchestrator.git
cd agent-orchestrator && bash scripts/setup.sh
```

For an existing project:

```bash
cd ~/your-project && ao init --auto
ao start
ao spawn my-project 123
```

The dashboard opens at `http://localhost:3000`. CLI status is available via `ao status`.

## CLI Design

The CLI (`ao`) is designed around the most common workflow: spawn agents, check status, intervene when needed.

### Core Commands

| Command | Purpose |
|---------|---------|
| `ao init [--auto]` | Initialize config for current project |
| `ao start` | Launch orchestrator agent (supervisor mode) |
| `ao stop` | Stop the orchestrator |
| `ao status` | Overview of all sessions with PR/CI/review state |
| `ao spawn <project> [issue]` | Spawn a single agent session |
| `ao batch-spawn <project> <issues...>` | Spawn multiple sessions in parallel |
| `ao send <session> <message>` | Send instructions to a running agent |
| `ao session ls [-p project]` | List sessions |
| `ao session attach <session>` | Attach to a session's tmux window |
| `ao session kill <session>` | Kill a session |
| `ao session restore <session>` | Revive a crashed/killed session |
| `ao session cleanup [-p project]` | Kill completed/merged sessions |
| `ao dashboard` | Start the web dashboard |
| `ao open <project>` | Open all sessions in terminal tabs |
| `ao review-check` | Check PR review status |

### Design Principles

1. **No path configuration in commands.** Session IDs are short (`int-1`, `ao-3`). Project IDs are the config keys. The orchestrator resolves everything.

2. **Progressive disclosure.** `ao status` gives the overview. `ao session ls` gives details. `ao session attach` gives full access. Each level goes deeper.

3. **Batch operations.** `ao batch-spawn` handles the common case of "here are 10 issues, go." `ao session cleanup` handles the common case of "done with this batch, clean up."

4. **Agent override per session.** `ao spawn my-app 123 --agent codex` lets you use a different agent for a specific session without changing config.

## Config Ergonomics

Minimal config that just works:

```yaml
projects:
  my-app:
    repo: org/my-app
    path: ~/my-app
```

Everything else has defaults. The full config reference (`agent-orchestrator.yaml.example`) shows all options with comments.

### Config Search

Config is found by searching up the directory tree (like git finds `.git`), so `ao` commands work from any subdirectory. Override with `AO_CONFIG_PATH` env var.

### Per-Project Overrides

Each project can override the default agent, runtime, workspace, tracker, and reactions:

```yaml
projects:
  frontend:
    agent: claude-code
    reactions:
      approved-and-green:
        auto: true    # auto-merge for this project
  backend:
    agent: codex
    postCreate:
      - "pip install -r requirements.txt"
```

## Development Workflow

### Build and Run

```bash
pnpm install           # install deps
pnpm build             # build all packages (required before web dev server)
pnpm typecheck         # type checking
pnpm lint              # ESLint
pnpm test              # run tests (3,288 test cases)
```

The web dashboard depends on built packages — `pnpm build` must run before `cd packages/web && pnpm dev`.

### Testing

- **vitest** for unit and integration tests
- Tests are co-located (`*.test.ts`) or in `__tests__/` directories
- Integration tests in a separate `packages/integration-tests` package
- Test suite covers 3,288 test cases across the monorepo

### Code Quality

- **ESLint** with TypeScript rules (no `any`, type-only imports enforced)
- **Prettier** for formatting (semicolons, double quotes, 2-space indent)
- **Husky** for pre-commit hooks
- Strict TypeScript (`strict: true` in tsconfig)

### Naming Conventions

| Thing | Convention |
|-------|-----------|
| Files | `kebab-case.ts` |
| Types/Interfaces | `PascalCase` |
| Functions/variables | `camelCase` |
| Constants | `UPPER_SNAKE_CASE` |
| Test files | `*.test.ts` |

## Dashboard

The web dashboard provides:

- **Live session cards** with activity status indicators (active, ready, idle, waiting, exited)
- **PR table** with CI check results and review decisions
- **Attention zones** that group sessions by urgency (merge ready, needs response, working, done)
- **One-click actions** for common operations (send message, kill, merge PR)
- **Real-time updates** via SSE (no manual refresh needed)
- **Terminal access** via embedded web terminal (WebSocket connection to tmux)

## Error Messages

Config validation errors include fix suggestions:

```
Duplicate session prefix detected: "int"
Projects "integrator" and "interface-kit" would generate the same prefix.

To fix this, add an explicit sessionPrefix to one of these projects:

projects:
  integrator:
    path: ~/repos/integrator
    sessionPrefix: int1
  interface-kit:
    path: ~/repos/interface-kit
    sessionPrefix: int2
```

Session errors include context about what went wrong and how to recover:

```
Session int-1 cannot be restored: status is "merged"
Workspace missing at /path/to/worktree: workspace plugin does not support restore
```

## Orchestrator Mode

`ao start` launches a special orchestrator session — a Claude Code instance with a comprehensive system prompt about available `ao` commands, project context, and workflows. This orchestrator agent can:

- Spawn and monitor worker agents
- Send instructions to stuck agents
- Check status and manage the fleet
- Batch-spawn issues from the tracker

The orchestrator runs with `--dangerously-skip-permissions` since it needs to execute `ao` CLI commands autonomously.
