# Spec: Drop Config File — Derive Project State from tmux

**Change**: 260303-yohq-drop-config-derive-from-tmux
**Created**: 2026-03-03
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Adding a `#{session_path}` fallback for window-0 cd-away risk — deferred to backlog per intake assumption #6
- Changing the `ProjectSession` or `WindowInfo` type shapes — the API contract is unchanged
- Modifying `lib/tmux.ts`, `lib/fab.ts`, or `lib/worktree.ts` — these are unaffected

## Session Derivation: Project Root from tmux

### Requirement: Derive project root from window 0

The system SHALL derive each session's project root from window 0's `pane_current_path` (the `worktreePath` field returned by `listWindows()`). The system MUST NOT read from any configuration file to determine project roots.

#### Scenario: Normal session with windows

- **GIVEN** a tmux session "my-project" with window 0 at path `/home/user/code/my-project`
- **WHEN** `fetchSessions()` is called
- **THEN** the session's project root is `/home/user/code/my-project` (window 0's `worktreePath`)

#### Scenario: Session with only one window

- **GIVEN** a tmux session "solo" with a single window (index 0) at `/home/user/code/solo`
- **WHEN** `fetchSessions()` is called
- **THEN** the project root is `/home/user/code/solo`

### Requirement: Show all sessions without filtering

The system SHALL return a `ProjectSession` entry for every tmux session. There MUST NOT be an "Other" bucket or any config-based filtering. Every session is treated equally.

#### Scenario: Multiple sessions, no config

- **GIVEN** tmux has sessions "alpha", "beta", "gamma"
- **WHEN** `fetchSessions()` is called
- **THEN** the result contains exactly three `ProjectSession` entries: "alpha", "beta", "gamma"
- **AND** no "Other" entry exists

#### Scenario: No tmux sessions running

- **GIVEN** no tmux sessions are running
- **WHEN** `fetchSessions()` is called
- **THEN** the result is an empty array `[]`

### Requirement: Sessions appear in tmux natural order

Sessions SHALL appear in the order returned by `listSessions()` (tmux's native ordering). There MUST NOT be config-based ordering or alphabetical sorting imposed by run-kit.

#### Scenario: Session ordering matches tmux

- **GIVEN** tmux returns sessions in order: "zeta", "alpha", "mu"
- **WHEN** `fetchSessions()` is called
- **THEN** the result preserves that order: `[{name: "zeta"}, {name: "alpha"}, {name: "mu"}]`

## Fab Enrichment: Auto-detect fab-kit Projects

### Requirement: Detect fab-kit projects via filesystem check

The system SHALL determine whether a session is a fab-kit project by checking if `fab/project/config.yaml` exists at the derived project root. This check MUST use `fs.access()` (not `fs.stat()` or `readFileSync()`). The system MUST NOT use any configuration flag (no `fab_kit: true` field).

#### Scenario: Session with fab-kit project

- **GIVEN** a session with project root `/home/user/code/my-project`
- **AND** the file `/home/user/code/my-project/fab/project/config.yaml` exists
- **WHEN** `fetchSessions()` is called
- **THEN** all windows in the session are enriched with fab state (`fabStage`, `fabProgress`)

#### Scenario: Session without fab-kit

- **GIVEN** a session with project root `/home/user/code/plain-project`
- **AND** `/home/user/code/plain-project/fab/project/config.yaml` does not exist
- **WHEN** `fetchSessions()` is called
- **THEN** no fab enrichment is attempted for that session's windows

#### Scenario: fs.access failure (permission error, etc.)

- **GIVEN** a session with project root `/home/user/code/locked-project`
- **AND** `fs.access()` on `fab/project/config.yaml` throws (any error)
- **WHEN** `fetchSessions()` is called
- **THEN** the session is treated as non-fab-kit (no enrichment, no error surfaced)

### Requirement: Enrich all windows with fab state

When a session is identified as a fab-kit project, the system SHALL enrich every window in that session with fab state by passing each window's own `worktreePath` (or the project root as fallback) to `enrichWindow()`.

#### Scenario: Multi-window fab-kit session

- **GIVEN** a fab-kit session with windows at paths: `/code/proj` (window 0), `/code/proj/.claude/worktrees/fix-bug` (window 1)
- **WHEN** `fetchSessions()` is called
- **THEN** `enrichWindow()` is called for each window
- **AND** each window uses its own `worktreePath` for fab state lookup (worktree-aware)

## File Removal: Config Surface

### Requirement: Delete config module and types

The file `src/lib/config.ts` SHALL be deleted entirely. The types `ProjectConfig` and `Config` SHALL be removed from `src/lib/types.ts`. No other types or constants in `types.ts` SHALL be affected.

#### Scenario: No config imports remain

- **GIVEN** `src/lib/config.ts` is deleted and types removed from `types.ts`
- **WHEN** the project is compiled with `tsc --noEmit`
- **THEN** compilation succeeds with no errors referencing `config`, `ProjectConfig`, or `Config`

### Requirement: Delete config file and example

The file `run-kit.example.yaml` SHALL be deleted from the repository. The `.gitignore` entry for `run-kit.yaml` SHOULD be removed (no longer needed since the file concept is gone).

#### Scenario: Clean removal

- **GIVEN** `run-kit.example.yaml` is deleted and `.gitignore` entry removed
- **WHEN** `git status` is checked
- **THEN** `run-kit.example.yaml` shows as deleted, `.gitignore` shows as modified

## UI: Empty State Update

### Requirement: Remove config file reference from empty state

The empty state message in `src/app/dashboard-client.tsx` (line ~175) MUST NOT reference `run-kit.yaml`. It SHALL be updated to a generic message like "start a tmux session to get started".

#### Scenario: Empty state display

- **GIVEN** no tmux sessions are running
- **WHEN** the dashboard renders the empty state
- **THEN** the text does not mention "run-kit.yaml" or any config file
- **AND** the text guides the user to create or start a tmux session

## Deprecated Requirements

### Config-based project mapping

**Reason**: `run-kit.yaml` and `lib/config.ts` are removed. Project roots are derived from tmux `pane_current_path` instead of config lookup.
**Migration**: `fetchSessions()` in `sessions.ts` uses window 0's `worktreePath` as project root. No config needed.

### "Other" session bucket

**Reason**: All sessions are now first-class — no config determines which sessions are "known" vs "other".
**Migration**: N/A — the concept is simply removed.

### Config-based session ordering

**Reason**: Without a config file, there is no declared project order. Sessions use tmux's native order.
**Migration**: N/A — tmux ordering is the default.

## Design Decisions

1. **`fs.access()` for fab-kit detection**: Use `fs.access()` rather than `fs.stat()` or `readFileSync()`
   - *Why*: Idiomatic existence check — lightweight, no file content needed, consistent with constitution's "derive at request time" principle
   - *Rejected*: `fs.stat()` — heavier, returns metadata we don't need. `readFileSync()` — reads file content unnecessarily, blocks event loop

2. **Window 0 as project root source**: Derive project root from `pane_current_path` of window index 0
   - *Why*: User-selected approach (Approach A) from brainstorming session. Window 0 is the most stable — typically the session's initial working directory
   - *Rejected*: `session_path` (Approach B) — not reliably set by all tmux configurations. Hybrid (Approach C) — unnecessary complexity

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use window 0's `pane_current_path` as project root | Confirmed from intake #1 — user chose Approach A explicitly | S:95 R:85 A:90 D:95 |
| 2 | Certain | Show all sessions — no "Other" bucket | Confirmed from intake #2 — user chose "Show everything" | S:95 R:90 A:90 D:95 |
| 3 | Certain | Auto-enrich all sessions with fab state via `fab/project/config.yaml` check | Confirmed from intake #3 — user chose "Auto-enrich all" | S:95 R:85 A:90 D:95 |
| 4 | Certain | Delete `run-kit.example.yaml`, `src/lib/config.ts`, remove `Config`/`ProjectConfig` types | Confirmed from intake #4 — complete config surface removal | S:95 R:80 A:95 D:95 |
| 5 | Confident | Sessions appear in tmux's natural order (no explicit ordering) | Confirmed from intake #5 — no ordering preference specified, tmux default is sensible | S:70 R:90 A:80 D:75 |
| 6 | Certain | Window 0 cd-away risk accepted, `#{session_path}` fallback in backlog | Confirmed from intake #6 — explicit user approval | S:95 R:85 A:85 D:90 |
| 7 | Confident | `hasFabKit` uses `fs.access()` for existence check | Confirmed from intake #7 — idiomatic, lightweight | S:60 R:95 A:85 D:80 |
| 8 | Confident | Remove `.gitignore` entry for `run-kit.yaml` during cleanup | Config concept is gone; gitignore entry is dead. Low risk — easily re-added if needed. | S:65 R:95 A:85 D:80 |
| 9 | Confident | `enrichWindow()` function signature/behavior unchanged | Existing function already accepts `worktreePath` fallback — no changes needed to its internals | S:80 R:90 A:85 D:85 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).
