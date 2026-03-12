# Intake: Vite/React Frontend

**Change**: 260312-ux92-vite-react-frontend
**Created**: 2026-03-12
**Status**: Draft

## Origin

> Phase 3 of the run-kit reimplementation plan (docs/specs/project-plan.md). After Phase 2 delivers the Go backend, this phase implements the Vite/React SPA against the new API endpoints. UI components, interaction patterns, and visual design are ported from the old `packages/web/` implementation — only the API client layer changes (POST-only mutations, path-based intent).

## Why

1. **Frontend consumes the new API** — the API client must use the new POST-based routes (`POST /api/sessions/:session/kill` instead of `POST /api/sessions { action: "killSession" }`). This is not a tweak — the entire client module is rewritten to match `docs/specs/api.md`.
2. **Playwright E2E at new location** — tests move from `e2e/` to `app/frontend/tests/e2e/`, using the same self-managed tmux session pattern but against the new backend.
3. **Visual design unchanged** — dark theme, monospace, keyboard-first, iOS-first mobile, three pages. The design philosophy spec (`docs/specs/design.md`) and UI patterns memory (`docs/memory/run-kit/ui-patterns.md`) remain authoritative.

## What Changes

### API Client (`src/api/client.ts`)

Typed fetch wrappers for every endpoint in `docs/specs/api.md`:

```typescript
// All mutations use POST
getSessions()                                        // GET /api/sessions
createSession(name, cwd?)                            // POST /api/sessions
killSession(session)                                 // POST /api/sessions/:session/kill
createWindow(session, name, cwd?)                    // POST /api/sessions/:session/windows
killWindow(session, index)                           // POST /api/sessions/:session/windows/:index/kill
renameWindow(session, index, name)                   // POST /api/sessions/:session/windows/:index/rename
sendKeys(session, index, keys)                       // POST /api/sessions/:session/windows/:index/keys
getDirectories(prefix)                               // GET /api/directories?prefix=...
uploadFile(session, file, window?)                   // POST /api/sessions/:session/upload
```

### Types (`src/types.ts`)

`ProjectSession` and `WindowInfo` matching the API response shapes. Unchanged from current.

### Contexts

- `ChromeProvider` — split state/dispatch contexts for slot injection. Port from current.
- `SessionProvider` — layout-level SSE connection to `GET /api/sessions/stream`. Port from current.

### Router + Layout

TanStack Router with type-safe routes: `/`, `/p/$project`, `/p/$project/$window`. Root layout owns the chrome skeleton (top bar, content, bottom slot).

### Pages

- **Dashboard** — session cards, search, create session dialog with folder picker autocomplete
- **Project** — window cards, actions (create, kill, rename, send keys)
- **Terminal** — xterm.js + WebSocket relay (`WS /relay/:session/:window`), bottom bar (modifier toggles, arrow pad, Fn dropdown, compose buffer), file upload

### Command Palette

Cmd+K trigger, keyboard shortcuts, mobile `⋯` trigger via CustomEvent.

### Mobile

iOS keyboard support (`useVisualViewport`), touch scroll prevention, 44px touch targets, responsive Line 2 collapse, terminal font scaling.

### Playwright E2E Tests (`app/frontend/tests/e2e/`)

Port existing suites from `e2e/`:
- Chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile
- Add: API round-trip tests (create/kill session via UI)
- Self-managed tmux sessions in `beforeAll`/`afterAll`

### Vitest Unit Tests

Port from current: command palette, keyboard nav, modifier state. Co-located `.test.{ts,tsx}` files.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update API client section to reflect new POST-only client signatures
- `run-kit/architecture`: (modify) Update frontend section paths and test locations

## Impact

- **All frontend API calls** — new URL patterns and POST-only mutations
- **E2E test location** — `e2e/` → `app/frontend/tests/e2e/`
- **No visual or interaction changes** — same UI, same keyboard shortcuts, same mobile behavior

## Open Questions

- None — UI patterns memory and design spec are the source of truth for frontend behavior.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | POST-only API client | Discussed — matches api.md, all mutations use POST | S:95 R:80 A:95 D:95 |
| 2 | Certain | Port UI components from old implementation | Discussed — visual design and interactions unchanged | S:90 R:85 A:90 D:95 |
| 3 | Certain | E2E tests at `app/frontend/tests/e2e/` | Discussed — user specified this location | S:95 R:85 A:90 D:95 |
| 4 | Certain | TanStack Router for type-safe routing | Same as current, no reason to change | S:90 R:85 A:90 D:95 |
| 5 | Confident | Same frontend dependencies (React 19, Tailwind 4, xterm.js 5, shadcn/ui) | Philosophies unchanged per spec | S:75 R:80 A:85 D:85 |
| 6 | Confident | Self-managed tmux sessions in E2E test hooks | Same pattern as current — proven, necessary for tmux-dependent tests | S:80 R:80 A:85 D:85 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
