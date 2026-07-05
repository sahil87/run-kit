# run-kit Constitution

## Core Principles

### I. Security First
All process execution MUST use `exec.CommandContext` with explicit argument slices — never shell strings or `exec.Command` without a context/timeout. Shell injection is a show-stopper. User-provided input (session names, window names, paths) SHALL be validated before passing to any subprocess. This mirrors AO's security posture and is non-negotiable.

### II. No Database
State MUST be derived from tmux and the filesystem at request time. run-kit SHALL NOT introduce a database, ORM, migration system, or persistent state store. Session metadata comes from `tmux list-sessions`/`tmux list-windows`. Fab state comes from `.status.yaml` and `fab/current`. If you can't derive it from these sources, you don't need it.

### III. Wrap, Don't Reinvent
Existing fab-kit utilities (`wt-create`, `wt-list`, `wt-delete`, `idea`, `changeman.sh`, `statusman.sh`) MUST be used via wrapper functions in `internal/` (Go). run-kit SHALL NOT reimplement worktree management, change management, or backlog management. When a fab-kit script does what you need, call it.

### IV. Minimal Surface Area
The UI MUST stay minimal — a small fixed route set (Cockpit `/`, Server Cabin `/$server`, Terminal `/$server/$window`, Board `/board/$name`, plus the Not Found fallback), no settings pages, no admin panels. Configuration lives in environment variables (`.env` committed, `.env.local` for overrides). New pages SHOULD only be added when an existing page genuinely cannot accommodate the functionality. Resist feature creep.

### V. Keyboard-First
Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary. The command palette (`Cmd+K`) SHALL be the primary discovery mechanism for actions.

### VI. Tmux Sessions Survive Server Restarts
The tmux layer MUST be fully independent of the Go server. Agent sessions running in tmux windows SHALL NOT be affected by server restarts, crashes, or deployments. The supervisor manages only the web server process — never tmux.

### VII. Convention Over Configuration
run-kit SHOULD derive values from conventions rather than requiring explicit configuration. Project IDs from directory names, session prefixes from project names, worktree paths from fab-kit defaults. The `run-kit.yaml` config SHOULD require only project paths.

### VIII. Thin Justfile
Justfile recipes MUST be one-liners that delegate to `scripts/`. Logic, loops, and conditionals belong in shell scripts — the justfile is an index, not an implementation.

### IX. Uniform HTTP Verb
All mutating API endpoints MUST use `POST`. `PUT`, `PATCH`, and `DELETE` SHALL NOT be used — read operations are `GET`, everything else is `POST`. Fewer verb shapes means fewer ways for a client call to be wrong, and the operation's intent belongs in the URL path and request body, not the HTTP method. The CORS `AllowedMethods` allowlist MUST be `[GET, POST, OPTIONS]`. Endpoint semantics that would conventionally map to other verbs (e.g. partial updates) are expressed via the path and a documented body contract (e.g. partial-merge: present keys set, `null` unsets).

### X. Hooks Carry Only the Underivable
Agent-harness hooks (lifecycle telemetry pushed by hook commands into tmux or the filesystem) SHALL carry only state that cannot be derived from tmux, the filesystem, or git at request time — ephemeral in-flight facts such as busy/waiting lifecycle and the pending question text, which exist nowhere on disk. Anything derivable from a pane's cwd, git, `gh`, or fab artifacts (PR links, branches, worktrees, change identity, diff stats) MUST be derived server-side per Principle II — never pushed by an agent. When a fact is available both ways, derivation wins.

## Additional Constraints

### Test Integrity
Tests MUST conform to the implementation spec — never the other way around. When tests fail, the fix SHALL either (a) update the tests to match the spec, or (b) update the implementation to match the spec. Modifying implementation code solely to accommodate test fixtures or test infrastructure is prohibited. Specs are the source of truth; tests verify conformance to specs.

### Test Companion Docs (`.spec.md`)
Every Playwright spec file (`*.spec.ts` under `app/frontend/tests/`) MUST ship with a sibling `*.spec.md` documenting, for each `test()` in the file: (a) **what it proves** — the user-visible behavior under test, in one or two sentences, and (b) **steps** — a numbered list mirroring the test body so a reviewer can reason about intent without reading Playwright APIs. Any shared setup (`beforeAll`, fixtures, viewport) goes in a Shared setup section. The companion file is part of the test definition: PRs that add or modify a `.spec.ts` SHALL update the matching `.spec.md` in the same commit. Unit tests (`*.test.ts`/`*.test.tsx`, `*_test.go`) are exempt — their scope is narrow enough that the test name plus code is self-documenting.

### Process Execution
All `exec.CommandContext` calls MUST use a context with timeout (default 5-10 seconds for tmux operations, 30 seconds for build operations). Zombie processes from hung tmux commands MUST NOT block the server.

### Self-Improvement Safety
The restart mechanism uses tmux-based kill-and-restart: `run-kit serve --restart` sends `C-c` to the daemon tmux pane, waits for graceful shutdown, then sends a fresh `run-kit serve` command. There is no supervisor loop, no `.restart-requested` signal file, and no automatic file-change watching. Rollback MUST be atomic (`git revert HEAD`).

## Governance

**Version**: 1.4.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-07-05
