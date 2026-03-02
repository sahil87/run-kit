# run-kit Constitution

## Core Principles

### I. Security First
All process execution MUST use `execFile` with argument arrays — never `exec` or template-string shell commands. Shell injection is a show-stopper. User-provided input (session names, window names, paths) SHALL be validated before passing to any subprocess. This mirrors AO's security posture and is non-negotiable.

### II. No Database
State MUST be derived from tmux and the filesystem at request time. run-kit SHALL NOT introduce a database, ORM, migration system, or persistent state store. Session metadata comes from `tmux list-sessions`/`tmux list-windows`. Fab state comes from `.status.yaml` and `fab/current`. If you can't derive it from these sources, you don't need it.

### III. Wrap, Don't Reinvent
Existing fab-kit utilities (`wt-create`, `wt-list`, `wt-delete`, `idea`, `changeman.sh`, `statusman.sh`) MUST be used via wrapper functions in `lib/`. run-kit SHALL NOT reimplement worktree management, change management, or backlog management. When a fab-kit script does what you need, call it.

### IV. Minimal Surface Area
The UI MUST stay minimal — three routes (`/`, `/p/:project`, `/p/:project/:window`), no settings pages, no admin panels. Configuration lives in `run-kit.yaml` on disk. New pages SHOULD only be added when an existing page genuinely cannot accommodate the functionality. Resist feature creep.

### V. Keyboard-First
Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary. The command palette (`Cmd+K`) SHALL be the primary discovery mechanism for actions.

### VI. Tmux Sessions Survive Server Restarts
The tmux layer MUST be fully independent of the Next.js server. Agent sessions running in tmux windows SHALL NOT be affected by server restarts, crashes, or deployments. The supervisor manages only the web server process — never tmux.

### VII. Convention Over Configuration
run-kit SHOULD derive values from conventions rather than requiring explicit configuration. Project IDs from directory names, session prefixes from project names, worktree paths from fab-kit defaults. The `run-kit.yaml` config SHOULD require only project paths.

## Additional Constraints

### Test Integrity
Tests MUST conform to the implementation spec — never the other way around. When tests fail, the fix SHALL either (a) update the tests to match the spec, or (b) update the implementation to match the spec. Modifying implementation code solely to accommodate test fixtures or test infrastructure is prohibited. Specs are the source of truth; tests verify conformance to specs.

### Process Execution
All `execFile` calls MUST include a timeout (default 5-10 seconds for tmux operations, 30 seconds for build operations). Zombie processes from hung tmux commands MUST NOT block the server.

### Self-Improvement Safety
The restart mechanism MUST be signal-based (`.restart-requested` file), never automatic on file change. Rollback MUST be atomic (`git revert HEAD`). The supervisor MUST verify health (`GET /api/health` returning 200) before considering a restart successful.

## Governance

**Version**: 1.0.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-03-02
