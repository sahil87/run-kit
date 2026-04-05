# Tasks: Shareable URLs

**Change**: 260325-zbqf-shareable-urls
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [ ] T001 Restructure TanStack Router route tree in `app/frontend/src/router.tsx` — define nested routes: `/` (index), `/$server` (layout with AppShell), `/$server` index (Dashboard), `/$server/$session/$window` (Terminal). Add `notFoundComponent` for unmatched URLs.

## Phase 2: Core Implementation

- [ ] T002 Create `ServerListPage` component at `app/frontend/src/components/server-list-page.tsx` — fetch servers from `GET /api/servers`, render server cards in grid layout, "+" button to create server via dialog, navigate to `/$server` on card click. Include a minimal header with branding.

- [ ] T003 Refactor `app/frontend/src/app.tsx` to work with nested routing — extract server from `$server` route param, move `SessionProvider` inside the `/$server` layout so it receives server from URL. The layout component renders AppShell with `<Outlet />` for content. Split the conditional `{sessionName ? <Terminal> : <Dashboard>}` into separate route components.

- [ ] T004 Update `app/frontend/src/contexts/session-context.tsx` — remove `readStoredServer()` and `?server=` query param logic. Accept `server` as a prop to `SessionProvider` (from URL param). Keep localStorage write for last-used server convenience. Remove `setServer` state setter (server changes via navigation, not state).

- [ ] T005 Update all navigation calls in `app/frontend/src/app.tsx` to include `server` param — `navigateToWindow()`, active window sync, session rename redirect, kill redirects. All redirects to dashboard go to `/$server` not `/`.

- [ ] T006 [P] Update `app/frontend/src/components/top-bar.tsx` — breadcrumb dropdown hrefs include server segment (`/$server/$session/0`, `/$server/$session/$window`). `handleDropdownNavigate` parses 3-segment paths. Dashboard label shows on `/$server` route.

- [ ] T007 [P] Update `app/frontend/src/components/dashboard.tsx` — `onNavigate` callback receives server context and navigates to `/$server/$session/$window`. No props change needed if server comes from parent route.

## Phase 3: Integration & Edge Cases

- [ ] T008 Implement server-not-found handling — in the `/$server` layout component, fetch server list and check if `$server` exists. If not, render a "Server not found" UI with a link to `/`. This covers both `/$server` and `/$server/$session/$window` since the layout wraps both.

- [ ] T009 Update sidebar server switcher — switching servers navigates to `/$newserver` (URL change) instead of calling `setServer()` (state change). Remove or simplify the sidebar's server management since server is now URL-driven.

- [ ] T010 Update command palette server actions — "Server: Switch to X" navigates to `/$server` instead of calling `handleSwitchServer`. Server create action redirects to the new server's dashboard after creation.

- [ ] T011 Verify WebSocket relay and API client — confirm `api/client.ts` `withServer()` still works correctly when server comes from URL context. The `setServerGetter` pattern should return the server from the current route's URL param.

## Phase 4: Polish

- [ ] T012 Add tests for new routing behavior — test that `/`, `/$server`, and `/$server/$session/$window` routes render correct components. Test server-not-found UI. Test navigation preserves server in URL.

---

## Execution Order

- T001 blocks all subsequent tasks (route tree must exist first)
- T002 is independent (new component)
- T003 and T004 are tightly coupled (AppShell restructure + SessionProvider changes)
- T005 depends on T003 (navigation calls are in the restructured AppShell)
- T006, T007 can run in parallel after T003
- T008 depends on T003 (layout component must exist)
- T009, T010 depend on T005 (navigation pattern established)
- T011 depends on T004 (server context pattern established)
- T012 depends on all above
