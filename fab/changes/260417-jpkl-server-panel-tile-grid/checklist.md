# Quality Checklist: Server Panel Tile Grid

**Change**: 260417-jpkl-server-panel-tile-grid
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Tile Grid Replaces Vertical List: `ServerPanel` body renders a CSS grid of `<button>` tiles with `grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))` and `gap: 6px` on desktop; preserves `CollapsiblePanel` wrapper, header, toggle chevron, `+` action, refresh spinner, and active-server tinted header.
- [ ] CHK-002 Tile Visual Structure: Each tile renders a 4px top stripe (ANSI tint or neutral gray), 11px truncated bold name, 10px "N sess" meta line; `var(--color-bg-secondary)` background, 1px `var(--color-border)` border, 4px radius; `title` attr for full name tooltip.
- [ ] CHK-003 Hover-Revealed Actions: On `@media (pointer: fine)`, hovering a tile reveals absolute-positioned color-picker `■` (when `onServerColorChange` provided) and kill `✕` (active tile only) in top-right; color-picker `stopPropagation` prevents outer `onSwitchServer`.
- [ ] CHK-004 Low Default Height with Internal Scroll: `ServerPanel` passes `resizable={true}` and `defaultHeight={140}` to `CollapsiblePanel`; panel body has `overflow-y: auto; overflow-x: hidden`; 12+ servers produce internal scroll without affecting sidebar outer scroll.
- [ ] CHK-005 Opt-In Resizable Variant: `CollapsiblePanel` accepts `resizable`, `defaultHeight`, `minHeight`, `maxHeight` props; `resizable={false}` (default) preserves legacy `max-height: 200px` transition, no drag handle, no height persistence.
- [ ] CHK-006 Drag Handle Adjusts Height: 6px `ns-resize` handle at bottom on resizable panels; mousedown/mousemove/mouseup (and touch equivalents) update height live, clamped to `[minHeight, maxHeight]`; `setState` + persist only on drop to avoid layout thrash.
- [ ] CHK-007 Height Persistence: Final clamped height written to `localStorage[${storageKey}-height]` as a string integer; read on mount with range validation; invalid values fall back to `defaultHeight`; all localStorage access wrapped in try/catch.
- [ ] CHK-008 Mobile Single-Row Horizontal Grid: `@media (pointer: coarse), (max-width: 639px)` switches to single-row grid (`grid-auto-flow: column`, `grid-auto-columns: 88px`, `overflow-x: auto; overflow-y: hidden`, `scroll-snap-type: x mandatory`, tiles with `scroll-snap-align: start`); drag handle hidden; panel body 56px; `.actions` not rendered.
- [ ] CHK-009 `/api/servers` Returns `[]ServerInfo`: Handler returns `[{"name": string, "sessionCount": number}]`; `sessionCount` computed via concurrent `tmux.ListSessions(ctx, server)` fan-out (WaitGroup + mutex-protected map); per-server `ListSessions` errors yield `sessionCount: 0`, not 5xx; empty discovery returns `[]`.
- [ ] CHK-010 Frontend Type Migration: `listServers()` returns `Promise<ServerInfo[]>`; `ServerInfo` type exported from `app/frontend/src/api/client.ts`; sidebar, `session-context`, `server-list-page`, `app.tsx` consumers all updated to read `.name` instead of treating value as a bare string.

## Scenario Coverage

- [ ] CHK-011 Grid Renders on Desktop Sidebar: Playwright desktop test confirms 3 columns at default 240px sidebar width with 6 servers producing 2 rows of equal-width tiles.
- [ ] CHK-012 Active Tile Styling: Unit test asserts `aria-current="true"` and the accent-ring class/style on the active tile; visual inspection via Playwright screenshot confirms ring + selected tint.
- [ ] CHK-013 Click Switches Server: Unit test + Playwright assert clicking a non-active tile fires `onSwitchServer` with the tile's name and updates URL.
- [ ] CHK-014 Color Picker Opens From Tile: Unit test asserts color-picker click opens `SwatchPopover`, stops propagation (no `onSwitchServer`), and calls `onServerColorChange` on selection.
- [ ] CHK-015 Mobile Tap to Select: Playwright mobile viewport (375×812) test confirms tap on a tile fires `onSwitchServer` and swipe-scroll does not misfire as tap.
- [ ] CHK-016 Active Tile Scrolled Into View on Mobile: Unit test asserts `scrollIntoView({ block: 'nearest', inline: 'nearest' })` is called on the active tile ref on mount when the single-row layout is active.
- [ ] CHK-017 Drag Expands Panel: Unit test simulates mousedown+mousemove+mouseup and asserts final height matches expected delta and is written to localStorage.
- [ ] CHK-018 Persisted Height Applied on Mount: Unit test seeds localStorage with a valid height value and asserts the panel initializes with that height.

## Edge Cases & Error Handling

- [ ] CHK-019 Corrupted Persisted Height: Unit test with `localStorage["runkit-panel-server-height"] = "not-a-number"` → panel renders at `defaultHeight`; no thrown error.
- [ ] CHK-020 Persisted Height Out of Range: Unit test with values below `minHeight` or above `maxHeight` → fallback to `defaultHeight`.
- [ ] CHK-021 localStorage Unavailable: Panel functions with in-memory-only state when localStorage access throws (e.g., strict-mode incognito).
- [ ] CHK-022 Backend Per-Server `ListSessions` Failure: Go test with mocked tmux helper returning error for one server of three → response 200 with that server's `sessionCount: 0` and others succeeding.
- [ ] CHK-023 Backend Empty Server Discovery: Go test with empty `ListServers` result → response body `[]` (not `null`).
- [ ] CHK-024 Server With Very Long Name: Unit test or Playwright confirms long name truncates mid-string with ellipsis and full name exposed via `title` attr.
- [ ] CHK-025 Server Without Assigned Color: Unit test confirms stripe uses neutral-gray color, tile body remains `bg-secondary`, no tint on hover/selected beyond the default ring.

## Code Quality

- [ ] CHK-026 Pattern consistency: New code follows naming and structural patterns of surrounding code — React component structure matches other sidebar components; Go handler style matches existing `api/servers.go`.
- [ ] CHK-027 No unnecessary duplication: Reuses `computeRowTints`, `SwatchPopover`, `CollapsiblePanel`, existing tmux helpers; no parallel implementations introduced.
- [ ] CHK-028 Readability & maintainability over cleverness (code-quality.md): Ref-based drag state avoids obvious setState-per-mousemove trap but remains readable; no micro-optimizations beyond that.
- [ ] CHK-029 Follow existing project patterns (code-quality.md): CollapsiblePanel's opt-in prop pattern mirrors existing optional-prop conventions; no new abstraction layers.
- [ ] CHK-030 Go backend — `exec.CommandContext` with timeout (code-quality.md): Concurrent `ListSessions` fan-out uses existing `ListSessions(ctx, server)` which is already `exec.CommandContext`-based — no new subprocess calls introduced.
- [ ] CHK-031 Frontend — type narrowing over type assertions (code-quality.md): `ServerInfo` type is exported and consumed via type inference / destructuring; no `as` casts on `servers` data.
- [ ] CHK-032 State derived from tmux + filesystem (code-quality.md): Session count derives from live `tmux list-sessions` call per request; no in-memory cache introduced.
- [ ] CHK-033 Tests included (code-quality.md): Frontend unit tests (server-panel.test.tsx + collapsible-panel.test.tsx extensions) and Playwright e2e spec (+ `.spec.md` companion) accompany the UI change; Go test covers new handler response shape.
- [ ] CHK-034 No shell-string subprocess calls (code-quality.md anti-pattern): All tmux interaction flows through existing `internal/tmux/` helpers — no new `exec.Command` without context or shell-string construction.
- [ ] CHK-035 No polling from client (code-quality.md anti-pattern): Server list refresh continues to use existing `onRefreshServers` handler (triggered on panel expand and external events); no `setInterval` / fetch loops introduced.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
