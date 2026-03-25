# Quality Checklist: Shareable URLs

**Change**: 260325-zbqf-shareable-urls
**Generated**: 2026-03-26
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Three route levels: `/`, `/$server`, `/$server/$session/$window` all render correct components
- [ ] CHK-002 Server list page fetches and displays servers with "+" creation button
- [ ] CHK-003 Server in URL path: all terminal URLs include server segment
- [ ] CHK-004 SSE connection uses server from URL param, not localStorage
- [ ] CHK-005 Server not found shows error UI with link to `/`

## Behavioral Correctness

- [ ] CHK-006 `navigateToWindow()` produces URLs like `/$server/$session/$window`
- [ ] CHK-007 Breadcrumb dropdown hrefs include server segment
- [ ] CHK-008 Kill/not-found redirects go to `/$server` (not `/`)
- [ ] CHK-009 Active window SSE sync preserves server in URL
- [ ] CHK-010 Session rename redirect preserves server in URL
- [ ] CHK-011 Server switcher navigates to `/$newserver` instead of state change

## Removal Verification

- [ ] CHK-012 `readStoredServer()` query param logic removed from session-context.tsx
- [ ] CHK-013 Old `/$session/$window` route no longer defined

## Scenario Coverage

- [ ] CHK-014 Navigate to root `/` renders server list
- [ ] CHK-015 Navigate to `/$server` renders session dashboard with SSE
- [ ] CHK-016 Navigate to `/$server/$session/$window` renders terminal
- [ ] CHK-017 Invalid server name shows "server not found" UI
- [ ] CHK-018 Unmatched URL (e.g., `/$server/$session`) shows not-found page

## Edge Cases & Error Handling

- [ ] CHK-019 No servers exist: server list page shows "+" button only
- [ ] CHK-020 Server exists but no sessions: dashboard shows empty state with "+" session button
- [ ] CHK-021 Session/window killed while viewing: redirect to `/$server`
- [ ] CHK-022 Special characters in server/session names are URL-encoded correctly

## Code Quality

- [ ] CHK-023 Pattern consistency: new components follow existing card/grid patterns
- [ ] CHK-024 No unnecessary duplication: shared UI stays in AppShell layout, not duplicated
- [ ] CHK-025 All subprocess calls (if any) use `exec.CommandContext` with timeouts
- [ ] CHK-026 No inline tmux command construction
- [ ] CHK-027 No polling from client — uses SSE stream for session data

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
