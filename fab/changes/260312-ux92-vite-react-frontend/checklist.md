# Quality Checklist: Vite/React Frontend

**Change**: 260312-ux92-vite-react-frontend
**Generated**: 2026-03-12
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 API Client: All 9 typed fetch wrappers exported with correct POST-only URLs per api.md
- [ ] CHK-002 API Client: No `action` field in any request body — no `SessionAction` union type
- [ ] CHK-003 Types: `ProjectSession` and `WindowInfo` match API response shapes (including `fabChange`, `fabStage`)
- [ ] CHK-004 Routing: Single route `/:session/:window` with TanStack Router, `/` redirects to first session/window
- [ ] CHK-005 Layout: Single-view skeleton — top-chrome + main-area (sidebar + terminal) + bottom-bar, no page transitions
- [ ] CHK-006 Sidebar: Session/window tree with collapsible sessions, activity dot, fab stage, selected highlight, kill button, `[+ New Session]`
- [ ] CHK-007 Top Bar: Hamburger + breadcrumb dropdowns (session ⬡, window ❯) + connection indicator + `⌘K`/`⋯`
- [ ] CHK-008 Top Bar Line 2: `[Rename]` + `[Kill]` derived from selection (not slot injection), activity status right
- [ ] CHK-009 Terminal: xterm.js + WebSocket relay, reconnection (1s→30s), ResizeObserver with rAF debounce
- [ ] CHK-010 Bottom Bar: Always visible, modifier toggles with armed state, arrow pad, Fn dropdown, compose buffer
- [ ] CHK-011 ChromeProvider: Manages selection + sidebar/drawer state + isConnected, no slot injection setters
- [ ] CHK-012 SessionProvider: Layout-level EventSource to `/api/sessions/stream`, `useSessions()` hook
- [ ] CHK-013 Command Palette: Cmd+K + `palette:open` CustomEvent, includes create/kill/rename/upload/nav actions
- [ ] CHK-014 Create Session Dialog: Quick picks, path autocomplete with debounce, auto-derived name
- [ ] CHK-015 Mobile Drawer: Hamburger opens sidebar overlay <768px, dimmed terminal, close on selection
- [ ] CHK-016 Keyboard Shortcuts: j/k nav, Enter select, c create, Cmd+K palette, Esc Esc close drawer, r rename
- [ ] CHK-017 Active Window Sync: SSE `isActiveWindow` updates breadcrumbs + URL via `history.replaceState`

## Behavioral Correctness

- [ ] CHK-018 API URLs use path-based intent (e.g., `POST /api/sessions/:session/kill`, not action field)
- [ ] CHK-019 Upload uses `POST /api/sessions/:session/upload` (session in URL, not form field)
- [ ] CHK-020 No `max-w-4xl` on any zone — terminal, top bar, bottom bar all span full width
- [ ] CHK-021 Fullbleed CSS applied unconditionally (not toggled per page)
- [ ] CHK-022 Sidebar collapsed state persists during session (toggled via hamburger)

## Removal Verification

- [ ] CHK-023 No Dashboard page (`dashboard.tsx`) in `app/frontend/`
- [ ] CHK-024 No Project page (`project.tsx`) in `app/frontend/`
- [ ] CHK-025 No `SessionAction` union type or `postSessionAction()` function
- [ ] CHK-026 No `setLine2Left`, `setLine2Right`, `setBottomBar`, `setBreadcrumbs` in ChromeProvider
- [ ] CHK-027 No `ContentSlot` or `BottomSlot` wrapper components
- [ ] CHK-028 No `fabProgress` field on `WindowInfo` type (replaced by `fabStage`)

## Scenario Coverage

- [ ] CHK-029 Default navigation: `/` redirects to first session's first window
- [ ] CHK-030 No sessions: sidebar shows empty state with create prompt
- [ ] CHK-031 Session expansion: click to expand/collapse window list
- [ ] CHK-032 Window selection: click sidebar window → terminal connects to that session:window
- [ ] CHK-033 Kill session: ✕ button → confirmation dialog → `killSession()` called
- [ ] CHK-034 Breadcrumb session switch: ⬡ dropdown → select → navigate
- [ ] CHK-035 Breadcrumb window switch: ❯ dropdown → select → navigate
- [ ] CHK-036 Compose and send: open buffer, type, Send → single WebSocket message
- [ ] CHK-037 Modifier armed state: tap Ctrl → armed visual → next key intercepted
- [ ] CHK-038 Mobile drawer: hamburger → drawer opens → select window → drawer closes

## Edge Cases & Error Handling

- [ ] CHK-039 WebSocket reconnection on unexpected close (exponential backoff)
- [ ] CHK-040 SSE reconnection (EventSource built-in auto-reconnect)
- [ ] CHK-041 API error responses thrown as Error with `error` field message
- [ ] CHK-042 Keyboard shortcuts skip when focus is in INPUT/TEXTAREA/SELECT
- [ ] CHK-043 Drawer closes on Escape key
- [ ] CHK-044 Terminal font scaling: 13px >= 640px, 11px < 640px

## Code Quality

- [ ] CHK-045 Pattern consistency: New code follows existing monospace dark theme, Tailwind utility patterns
- [ ] CHK-046 No unnecessary duplication: Reuses Dialog, BreadcrumbDropdown, ArrowPad components
- [ ] CHK-047 Readability: No god functions >50 lines without clear reason
- [ ] CHK-048 `execFile` pattern: No `exec()` or shell string construction (frontend — N/A but verify no subprocess calls)
- [ ] CHK-049 Type narrowing over assertions: Prefer `if` guards over `as` casts
- [ ] CHK-050 No `useEffect` for data fetching: Use SSE context, not fetch+useEffect
- [ ] CHK-051 No polling from client: Use SSE stream, not setInterval+fetch

## Security

- [ ] CHK-052 No shell metacharacters in URL construction: Session/window names properly encoded via `encodeURIComponent`
- [ ] CHK-053 File upload: 50MB limit enforced server-side (client sends to correct endpoint)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
