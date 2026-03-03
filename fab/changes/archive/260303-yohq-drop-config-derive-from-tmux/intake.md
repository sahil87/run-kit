# Intake: Drop Config File — Derive Project State from tmux

**Change**: 260303-yohq-drop-config-derive-from-tmux
**Created**: 2026-03-03
**Status**: Draft

## Origin

> Drop run-kit.yaml config file and derive project paths entirely from tmux session state. Use window 0's pane_current_path as the project root for each session. Detect fab-kit projects by checking if fab/project/config.yaml exists at that path. Delete config.ts, run-kit.yaml, run-kit.example.yaml. Modify sessions.ts to derive everything from tmux, types.ts to remove Config/ProjectConfig types, and dashboard-client.tsx to remove the run-kit.yaml hint. Aligns with Constitution Principles II (no persistent state) and VII (convention over configuration).

Conversational mode — preceded by a `/fab-discuss` brainstorming session. Three design approaches were proposed (A: window 0 pane_current_path, B: session_path, C: hybrid). User chose Approach A. Two multiple-choice questions resolved: (1) show all sessions (no "Other" bucket), (2) auto-enrich all sessions with fab state.

## Why

`run-kit.yaml` requires users to manually list project names, paths, and `fab_kit` flags. This violates two Constitution principles:

1. **Principle II (No Database)**: "State MUST be derived from tmux and the filesystem at request time." A YAML config file is a persistent state store — it requires manual maintenance and can drift from reality (renamed dirs, moved projects, new sessions).
2. **Principle VII (Convention Over Configuration)**: "run-kit SHOULD derive values from conventions rather than requiring explicit configuration." tmux already exposes `#{pane_current_path}` for every pane, making the config redundant.

If we don't fix it, every new project requires editing a YAML file before it appears in the dashboard. This is friction that contradicts the project's own stated principles.

## What Changes

### Remove `run-kit.yaml` and its loader

Delete three files:
- `run-kit.yaml` — the config file itself
- `run-kit.example.yaml` — the template/example
- `src/lib/config.ts` — the loader (`loadConfig`, `getConfig`, `getProjectNames`, in-memory cache)

### Remove config-related types from `src/lib/types.ts`

Remove `ProjectConfig` and `Config` types. These are only used by `config.ts` and `sessions.ts`.

### Rewrite `src/lib/sessions.ts` to derive from tmux

Current flow:
```
config.projects[sessionName] → match session to config → use config.path for fab enrichment
```

New flow:
```
listWindows(session) → window 0's worktreePath = project root
                     → fs.access(join(root, "fab/project/config.yaml"))
                     → if exists, enrich all windows with fab state
```

Specifically:
- Remove all imports from `./config`
- Add a `hasFabKit(projectRoot: string)` helper that checks for `fab/project/config.yaml` via `fs.access`
- Rewrite `fetchSessions()`:
  - For each session, use window 0's `worktreePath` as the project root
  - Call `hasFabKit()` to determine fab enrichment (replaces `projectConfig?.fab_kit`)
  - Pass the derived root to `enrichWindow()` (replaces `resolvedPath` from config)
  - No "Other" bucket — every session becomes a `ProjectSession`
  - No config-based ordering — sessions appear in tmux's natural order

### Update empty state text in `src/app/dashboard-client.tsx`

Line 176 currently says: `"start a tmux session matching a project key in run-kit.yaml"`. Replace with something like `"start a tmux session to get started"` — no reference to a config file.

## Affected Memory

- `run-kit/architecture`: (modify) Update Data Model section to remove `run-kit.yaml` / `lib/config.ts` references, note that project roots are derived from tmux `pane_current_path`

## Impact

- **`src/lib/config.ts`** — deleted entirely
- **`src/lib/types.ts`** — `ProjectConfig` and `Config` types removed
- **`src/lib/sessions.ts`** — `fetchSessions()` rewritten, `enrichWindow()` unchanged
- **`src/app/dashboard-client.tsx`** — minor text change in empty state
- **`run-kit.yaml`** — deleted
- **`run-kit.example.yaml`** — deleted
- No API contract changes — `ProjectSession[]` shape is unchanged
- No new dependencies

## Open Questions

None — all questions resolved during brainstorming.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use window 0's `pane_current_path` as project root | Discussed — user chose Approach A over session_path (B) and hybrid (C) | S:95 R:85 A:90 D:95 |
| 2 | Certain | Show all sessions — no "Other" bucket | Discussed — user explicitly chose "Show everything" | S:95 R:90 A:90 D:95 |
| 3 | Certain | Auto-enrich all sessions with fab state if `fab/project/config.yaml` exists at root | Discussed — user chose "Auto-enrich all" over "No fab enrichment for now" | S:95 R:85 A:90 D:95 |
| 4 | Certain | Delete `run-kit.yaml`, `run-kit.example.yaml`, `src/lib/config.ts` | Discussed — these files are the entire config surface being removed | S:95 R:80 A:95 D:95 |
| 5 | Confident | Sessions appear in tmux's natural order (no explicit ordering) | Config previously controlled order; without it, tmux list-sessions order is the natural default. User didn't specify ordering preference. | S:70 R:90 A:80 D:75 |
| 6 | Certain | Window 0 cd-away risk accepted, upgrade path in backlog | Discussed — user approved adding `#{session_path}` fallback to backlog as future work | S:95 R:85 A:85 D:90 |
| 7 | Confident | `hasFabKit` uses `fs.access` (not `fs.stat` or `readFileSync`) | access() is the idiomatic existence check — lightweight, no file content read needed. Matches constitution's "derive at request time" pattern. | S:60 R:95 A:85 D:80 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
