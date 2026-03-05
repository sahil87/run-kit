# Intake: Create Session from Folder

**Change**: 260305-zkem-session-folder-picker
**Created**: 2026-03-05
**Status**: Draft

## Origin

> During a `/fab-discuss` session designing run-kit's UI philosophy, the need arose for a way to create a new tmux session rooted in a specific folder on the host machine. The current "Create Session" dialog only accepts a name — it creates a session with no specified CWD. Since run-kit runs as a remote server (potentially accessed from a phone), a native file picker won't work. The design was discussed and agreed: server-side directory autocomplete (like terminal tab-completion) combined with quick picks from known session paths.

Interaction mode: conversational (arose from design philosophy discussion). Approach resolved during discussion.

## Why

1. **No way to pick a folder**: The current "Create Session" dialog accepts only a name. The session starts with the server's CWD, which is meaningless when you want to work on a specific project.
2. **Remote access requirement**: run-kit is accessed via browser, potentially from a phone or a different machine. A native `<input type="file">` picker opens the *browser's* filesystem, not the server's. We need a server-side directory selection mechanism.
3. **Constitution alignment**: "Derive, Don't Configure" (Constitution VII) — known paths should come from existing tmux sessions (already in memory), not a config file.

If we don't do this: users must create sessions via tmux CLI directly, defeating the purpose of the web dashboard.

## What Changes

### New API Endpoint: `GET /api/directories`

A server-side directory listing endpoint for autocomplete.

```
GET /api/directories?prefix=~/code/wvr
→ { "directories": ["~/code/wvrdz/", "~/code/wvrdz-infra/"] }
```

**Behavior**:
- Accepts a `prefix` query parameter (partial path)
- Expands `~` to the server user's home directory
- Returns only directories, not files
- Returns immediate children that match the prefix (not recursive)
- Security: restrict to paths under the user's home directory. Reject absolute paths outside `$HOME` and any `..` traversal attempts
- Uses `execFile` with `ls` or `fs.readdir` — never `exec` or shell strings (Constitution I)
- Includes timeout (Constitution: "All `execFile` calls MUST include a timeout")
- New file: `src/app/api/directories/route.ts`

### Updated Create Session Dialog

The dashboard's "Create Session" dialog gets two new sections above the existing name input:

**Quick Picks**: Paths already known from existing tmux sessions' CWDs. Derived from the `ProjectSession[]` data already available via SSE — each session's window 0 `pane_current_path` gives the project root. Deduplicated, sorted, displayed as tappable list items. No API call needed — client already has this data.

**Path Input with Autocomplete**: A text input that calls `GET /api/directories?prefix=...` as the user types (debounced, ~300ms). Results appear as a dropdown list below the input. Selecting a result fills the input and session name.

```
┌─────────────────────────────────────────┐
│ Create session                          │
│                                         │
│ Recent:                                 │
│   ~/code/wvrdz/run-kit                  │
│   ~/code/wvrdz/ao                       │
│   ~/code/sahil-weaver/fab-kit           │
│                                         │
│ Or type a path:                         │
│ ~/code/wvr ▌                            │
│ ┌─────────────────────────────────────┐ │
│ │ ~/code/wvrdz/                       │ │
│ │ ~/code/wvrdz-infra/                 │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Session name: wvrdz        (auto-derived)│
│                              [Create]   │
└─────────────────────────────────────────┘
```

**Session name auto-derivation**: Last segment of the selected path becomes the session name (e.g., `/Users/sahil/code/wvrdz/run-kit` → `run-kit`). The name field is editable — auto-derivation is a convenience, not a lock.

**Mobile UX**: Autocomplete suggestions are tappable list items with 44px minimum tap height. Quick picks are particularly important on mobile — they let you create a session in 2 taps without typing a path.

### Updated `createSession` in `lib/tmux.ts`

Currently `createSession(name)` creates a session with no CWD. Needs to accept an optional `cwd` parameter:

```typescript
export async function createSession(name: string, cwd?: string): Promise<void> {
  const args = ["new-session", "-d", "-s", name];
  if (cwd) args.push("-c", cwd);
  await tmuxExec(args);
}
```

### Updated API Route

The `createSession` action in `POST /api/sessions` needs to accept and validate an optional `cwd` field:

```typescript
case "createSession": {
  const name = String(body.name ?? "");
  const cwd = body.cwd ? String(body.cwd) : undefined;
  const nameErr = validateName(name, "Session name");
  if (nameErr) return badRequest(nameErr);
  if (cwd) {
    const cwdErr = validatePath(cwd, "Working directory");
    if (cwdErr) return badRequest(cwdErr);
  }
  await createSession(name, cwd);
  break;
}
```

### New Validation: Directory Exists

`lib/validate.ts` may need a `validateDirectory` function that checks the path exists and is a directory (via `fs.stat`). The existing `validatePath` handles character validation but may not verify existence.

## Affected Memory

- `run-kit/architecture`: (modify) Note the new `/api/directories` endpoint in the API layer table
- `run-kit/ui-patterns`: (modify) Update the Create Session dialog description with the folder picker UX

## Impact

- **New files**: `src/app/api/directories/route.ts`
- **Modified files**: `src/lib/tmux.ts` (add cwd param), `src/app/api/sessions/route.ts` (accept cwd), `src/app/dashboard-client.tsx` (dialog UI), `src/lib/validate.ts` (directory validation)
- **No breaking changes** — the cwd parameter is optional everywhere
- **Security surface**: New endpoint exposes server directory structure. Restricted to `$HOME` and validated against traversal.

## Open Questions

None — approach resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server-side autocomplete for directory selection | Discussed — native file picker doesn't work for remote server access | S:95 R:90 A:90 D:95 |
| 2 | Certain | Quick picks from existing session CWDs | Discussed — user agreed, derived not configured (Constitution VII) | S:90 R:95 A:95 D:90 |
| 3 | Certain | Session name auto-derived from last path segment | Discussed — explicit agreement during design session | S:90 R:95 A:85 D:90 |
| 4 | Certain | Restrict directory listing to $HOME | Discussed — security boundary for the directory endpoint | S:85 R:80 A:90 D:85 |
| 5 | Confident | Debounce autocomplete at ~300ms | Standard UX practice for type-ahead, easily tuned | S:55 R:95 A:85 D:80 |
| 6 | Confident | Quick picks sourced from window 0 pane_current_path | Codebase already derives project root from window 0 (lib/sessions.ts) | S:60 R:90 A:90 D:80 |
| 7 | Confident | `fs.readdir` for directory listing (not shell ls) | Node native, no subprocess needed, consistent with Constitution I (execFile safety) | S:55 R:95 A:90 D:75 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
