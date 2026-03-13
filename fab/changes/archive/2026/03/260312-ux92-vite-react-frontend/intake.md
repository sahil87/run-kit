# Intake: Vite/React Frontend

**Change**: 260312-ux92-vite-react-frontend
**Created**: 2026-03-12
**Status**: Draft

## Origin

> Phase 3 of the run-kit reimplementation plan (docs/specs/project-plan.md). After Phase 2 delivers the Go backend, this phase implements the Vite/React SPA against the new API endpoints. UI components, interaction patterns, and visual design are ported from the old `packages/web/` implementation — only the API client layer changes (POST-only mutations, path-based intent).

## Why

1. **Frontend consumes the new API** — the API client must use the new POST-based routes (`POST /api/sessions/:session/kill` instead of `POST /api/sessions { action: "killSession" }`). This is not a tweak — the entire client module is rewritten to match `docs/specs/api.md`.
2. **Playwright E2E at new location** — tests move from `e2e/` to `app/frontend/tests/e2e/`, using the same self-managed tmux session pattern but against the new backend.
3. **Single-view model** — dark theme, monospace, keyboard-first, iOS-first mobile. The old three-page model (Dashboard, Project, Terminal) is replaced by a single view: sidebar + terminal. One route (`/:session/:window`), breadcrumb dropdowns for quick navigation, drawer on mobile. See `docs/specs/design.md`.

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

- `ChromeProvider` — current session:window selection, sidebar open/collapsed state, drawer state (mobile). No slot injection needed — chrome derives from selection.
- `SessionProvider` — SSE connection to `GET /api/sessions/stream`. Shared session data.

### Single-View Layout (`src/app.tsx`)

One route: `/:session/:window` (defaults to first session, first window). No page transitions.

- **Sidebar** (desktop: always visible, collapsible; mobile: drawer overlay via `☰`)
  - Session/window tree with collapsible sessions
  - Fab stage inline per window (right-aligned, `text-secondary`)
  - `[+ New Session]` button, kill session `✕`
- **Top bar** — breadcrumb dropdowns (tap session name → session list, tap window name → window list), `☰` toggle, connection status, `⌘K`/`⋯`
- **Terminal** — xterm.js + WebSocket relay (`WS /relay/:session/:window`)
- **Bottom bar** — modifier toggles, arrow pad, Fn dropdown, compose buffer

### Command Palette

Cmd+K trigger, keyboard shortcuts, mobile `⋯` trigger via CustomEvent.

### Mobile

iOS keyboard support (`useVisualViewport`), touch scroll prevention, 44px touch targets, responsive Line 2 collapse, terminal font scaling.

### Vitest Unit Tests (MSW-backed)

MSW mocks API + SSE stream. Tests cover UI behavior in isolation:
- Sidebar navigation, drawer open/close, breadcrumb dropdowns
- Keyboard shortcuts, modifier state, command palette
- Touch targets, `visualViewport` behavior, responsive collapse
- Co-located `.test.{ts,tsx}` files

### Playwright E2E Tests (`app/frontend/tests/e2e/`)

Thin suite (3-5 tests) for API integration round-trips:
- Create/kill session via UI
- SSE stream delivers real data
- Self-managed tmux sessions in `beforeAll`/`afterAll`

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update API client section to reflect new POST-only client signatures
- `run-kit/architecture`: (modify) Update frontend section paths and test locations

## Impact

- **All frontend API calls** — new URL patterns and POST-only mutations
- **E2E test location** — `e2e/` → `app/frontend/tests/e2e/`
- **Single-view model** — replaces three-page navigation with sidebar + terminal. New components: sidebar, breadcrumb dropdowns, drawer (mobile)
- **Same keyboard shortcuts and mobile behavior** — command palette, modifier bar, compose buffer unchanged

## Open Questions

- None — UI patterns memory and design spec are the source of truth for frontend behavior.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | POST-only API client | Discussed — matches api.md, all mutations use POST | S:95 R:80 A:95 D:95 |
| 2 | Certain | Single-view model (sidebar + terminal) | Discussed — replaces three-page navigation per design.md | S:95 R:80 A:95 D:95 |
| 3 | Certain | Drawer pattern on mobile (not page stack) | Discussed — hamburger-only trigger, breadcrumbs for quick nav | S:95 R:80 A:90 D:95 |
| 4 | Certain | E2E tests at `app/frontend/tests/e2e/` | Discussed — user specified this location | S:95 R:85 A:90 D:95 |
| 5 | Certain | TanStack Router — one route `/:session/:window` | Discussed — single view, no page transitions | S:90 R:85 A:90 D:95 |
| 6 | Certain | MSW-backed Vitest for UI tests, thin E2E for API round-trips | Discussed — minimizes backend dependency, 3-5 E2E tests only | S:90 R:80 A:90 D:90 |
| 7 | Confident | Same frontend dependencies (React 19, Tailwind 4, xterm.js 5, MSW) | Philosophies unchanged per spec; MSW added for testing | S:75 R:80 A:85 D:85 |
| 8 | Confident | Self-managed tmux sessions in E2E test hooks | Same pattern as current — proven, necessary for tmux-dependent tests | S:80 R:80 A:85 D:85 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
