# Tasks: Vite/React Frontend

**Change**: 260312-ux92-vite-react-frontend
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/frontend/` scaffold — `package.json` (React 19, TanStack Router, xterm.js 5, Tailwind 4, MSW, Vitest, Playwright, Testing Library), `tsconfig.json`, `vite.config.ts` (React plugin, `@/` alias, `/api` + `/relay` proxy to `:3000`), `vitest.config.ts` (jsdom, co-located `.test.{ts,tsx}`), `src/main.tsx` (React entry), `src/globals.css` (port from `packages/web/src/globals.css` — dark theme tokens, `coarse:` variant, fullbleed class, `--app-height`), `src/test-setup.ts`, `index.html`

## Phase 2: Core Implementation

- [x] T002 [P] Create `app/frontend/src/types.ts` — `ProjectSession` and `WindowInfo` types matching API spec (add `fabChange?: string`, keep `fabStage?: string`, remove `fabProgress`). Create `app/frontend/src/api/client.ts` — typed fetch wrappers for all 9 endpoints with POST-only mutations using path-based URLs per spec. No `SessionAction` union, no `action` field.
- [x] T003 [P] Port hooks to `app/frontend/src/hooks/` — `use-visual-viewport.ts`, `use-modifier-state.ts`, `use-file-upload.ts` (update to use new `uploadFile()` signature with session in URL), `use-keyboard-nav.ts`, `use-sessions.ts` (thin wrapper over SessionContext)
- [x] T004 Create `app/frontend/src/contexts/session-context.tsx` — port from `packages/web/src/contexts/session-context.tsx`. Layout-level `EventSource` to `/api/sessions/stream`, provides `{ sessions, isConnected }` via `useSessionContext()`. Forward `isConnected` to ChromeProvider.
- [x] T005 Create `app/frontend/src/contexts/chrome-context.tsx` — rewrite. State: `{ currentSession, currentWindow, sidebarOpen, drawerOpen, isConnected }`. Dispatch: `{ setCurrentSession, setCurrentWindow, setSidebarOpen, setDrawerOpen, setIsConnected }`. Remove `breadcrumbs`, `line2Left`, `line2Right`, `bottomBar`, `fullbleed`, `setBreadcrumbs`, `setLine2Left`, `setLine2Right`, `setBottomBar`, `setFullbleed`. Export `useChrome()`, `useChromeDispatch()`, `ChromeProvider`. No `ContentSlot` or `BottomSlot` wrappers — layout is inline in `app.tsx`.
- [x] T006 Create `app/frontend/src/router.tsx` — TanStack Router with single route `/:session/:window`. Root redirect: `/` → first session's first window (via SSE data). Validate params. Create `app/frontend/src/app.tsx` — single-view layout: `ChromeProvider` > `SessionProvider` > app-shell div (`position: fixed; height: var(--app-height)`). Four zones: top-chrome (`shrink-0`), main-area (`flex-1 flex flex-row min-h-0` with sidebar `w-[220px] md:block hidden` + terminal `flex-1 min-w-0`), bottom-bar (`shrink-0`). No `max-w-4xl` on any zone. Fullbleed CSS classes applied unconditionally.

## Phase 3: Components

- [x] T007 [P] Port `app/frontend/src/components/dialog.tsx` from `packages/web/src/components/dialog.tsx` — identical. Port `app/frontend/src/components/breadcrumb-dropdown.tsx` from `packages/web/src/components/breadcrumb-dropdown.tsx` — identical.
- [x] T008 [P] Port `app/frontend/src/components/bottom-bar.tsx`, `app/frontend/src/components/arrow-pad.tsx`, `app/frontend/src/components/compose-buffer.tsx` from `packages/web/src/components/` — identical behavior. Bottom bar receives `wsRef` and `onOpenCompose` props. Always visible in the layout (not injected via slot).
- [x] T009 Create `app/frontend/src/components/sidebar.tsx` — NEW component. Session/window tree with collapsible sessions (▼/▶ toggle, persisted in local state). Window rows: activity dot + name (left), fab stage text (right), selected highlight (`bg-card border-l-2 border-accent`). Kill session button (✕, always visible) with confirmation dialog. `[+ New Session]` button at footer. Click window → navigate to `/:session/:window`. Width `w-[220px]`, `overflow-y-auto`, `border-r border-border`. `px-4` internal padding.
- [x] T010 Create `app/frontend/src/components/top-bar.tsx` — rewrite of `top-bar-chrome.tsx`. No slot reading. Line 1: hamburger (`☰`) + logo + breadcrumb dropdowns (session ⬡, window ❯) + connection indicator + `⌘K`/`⋯`. Line 2: `[Rename]` + `[Kill]` buttons (left, derived from current selection) + activity dot + fab stage badge (right). `min-h-[36px]` on Line 2. Mobile collapse: actions hidden, `⋯` button dispatches `palette:open`. Hamburger calls `setSidebarOpen` (desktop) or `setDrawerOpen` (mobile).
- [x] T011 Create `app/frontend/src/components/terminal-client.tsx` — extract terminal logic from `packages/web/src/pages/terminal.tsx`. xterm.js init, WebSocket connection to `/relay/:session/:window`, reconnection (1s→30s), `ResizeObserver` with rAF debounce, font size (13px desktop, 11px mobile), drag-and-drop + clipboard paste file upload, compose buffer integration. Expose `wsRef` to parent for bottom bar. Active window sync: read `isActiveWindow` from SSE, update URL via `history.replaceState`.
- [x] T012 Port `app/frontend/src/components/command-palette.tsx` — adapt from `packages/web/src/components/command-palette.tsx`. Actions: create session, kill current window, rename current window, upload file, all windows as navigation targets. Listens for `palette:open` CustomEvent and `Cmd+K`.

## Phase 4: Integration & Edge Cases

- [x] T013 Wire create session dialog — accessible from sidebar `[+ New Session]` button and `c` shortcut. Dialog with quick picks (deduplicated project root paths from sessions), path autocomplete via `getDirectories()` with 300ms debounce, auto-derived session name. Calls `createSession(name, cwd?)`. Port logic from `packages/web/src/pages/dashboard.tsx`.
- [x] T014 Wire mobile drawer — on viewports <768px, hamburger opens sidebar as fixed overlay from left. Dimmed terminal behind. Click window → close drawer + navigate. Click outside / Escape → close drawer. Drawer width ~75% viewport.
- [x] T015 Wire keyboard shortcuts — `j`/`k` navigate sidebar focus, `Enter` opens focused window, `c` opens create dialog, `Cmd+K` opens palette, `Esc Esc` (300ms) closes drawer if open (else no-op), `r` opens rename dialog for current window. Guard: skip when focus is in `INPUT`/`TEXTAREA`/`SELECT`.
- [x] T016 Wire active window sync — when SSE delivers `isActiveWindow: true` on a different window, update breadcrumbs, URL (`history.replaceState`), and rename/kill targets. Port logic from `packages/web/src/pages/terminal.tsx` `activeWindow` tracking.

## Phase 5: Testing & Verification

- [x] T017 [P] Create `app/frontend/tests/msw/handlers.ts` — MSW handlers for `GET /api/sessions`, `POST /api/sessions`, `POST /api/sessions/:session/kill`, `POST /api/sessions/:session/windows`, `POST /api/sessions/:session/windows/:index/kill`, `POST /api/sessions/:session/windows/:index/rename`, `POST /api/sessions/:session/windows/:index/keys`, `GET /api/directories`, `POST /api/sessions/:session/upload`, `GET /api/sessions/stream` (SSE mock). Test setup to start MSW server.
- [x] T018 [P] Write unit tests — `app/frontend/src/api/client.test.ts` (URL construction for all 9 endpoints), `app/frontend/src/components/sidebar.test.tsx` (expand/collapse, selection, kill session flow), `app/frontend/src/components/breadcrumb-dropdown.test.tsx` (port from packages/web), `app/frontend/src/components/command-palette.test.tsx` (port + adapt), `app/frontend/src/hooks/use-keyboard-nav.test.ts` (port)
- [x] T019 Create Playwright config at `app/frontend/playwright.config.ts` and E2E tests at `app/frontend/tests/e2e/` — `api-integration.spec.ts` (create session via sidebar, verify it appears via SSE, kill session), `sse-connection.spec.ts` (verify SSE delivers data, connection status shows "live"). Self-managed tmux sessions in `beforeAll`/`afterAll`.
- [x] T020 Build verification — run `npx tsc --noEmit` (type check) and `pnpm build` (production build) in `app/frontend/`. Fix any TypeScript errors or build failures.

---

## Execution Order

- T001 blocks all subsequent tasks
- T002 and T003 are parallel (both depend only on T001)
- T004 depends on T002 (needs types)
- T005 can run alongside T004 (no dependency)
- T006 depends on T004 and T005 (router uses both contexts)
- T007 and T008 are parallel, depend only on T001
- T009, T010, T011 depend on T005 and T006 (use contexts and router)
- T012 depends on T009 (command palette actions reference sidebar state)
- T013 depends on T009 and T002 (sidebar + API client)
- T014 depends on T009 and T005 (sidebar + ChromeProvider drawer state)
- T015 depends on T009 and T012 (sidebar nav + command palette)
- T016 depends on T011 (terminal client provides SSE sync target)
- T017 and T018 are parallel, depend on T001-T016 completion
- T019 depends on T017 (needs MSW handlers and full app)
- T020 depends on all tasks (final gate)
