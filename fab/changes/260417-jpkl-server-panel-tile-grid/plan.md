# Plan: Server Panel Tile Grid

**Change**: 260417-jpkl-server-panel-tile-grid
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup — Types and Backend Scaffold

- [ ] T001 Extend backend `handleServersList` in `app/backend/api/servers.go` to return `[]ServerInfo` — add a private `serverInfo` struct with `Name string \`json:"name"\`` and `SessionCount int \`json:"sessionCount"\`` fields; call `tmux.ListSessions(ctx, server)` per server concurrently (sync.WaitGroup + mutex-protected results map keyed by server name); on per-server `ListSessions` error, log warn and set `SessionCount: 0`. Preserve existing empty-array fallback and validation patterns.
- [ ] T002 Update `app/backend/api/servers_test.go` (create if absent) with table-driven Go tests: (a) empty server list returns `[]`, (b) single-server response shape, (c) multi-server with one failing `ListSessions` returns all three entries with `sessionCount: 0` for the failing one and no 5xx to client.
- [ ] T003 Update frontend `listServers()` in `app/frontend/src/api/client.ts` — change return type to `Promise<ServerInfo[]>`; export `export type ServerInfo = { name: string; sessionCount: number };` from the same file adjacent to `listServers`. Adjust JSDoc if present.

## Phase 2: Core Implementation — Resizable CollapsiblePanel

- [ ] T004 Add opt-in `resizable`, `defaultHeight`, `minHeight`, `maxHeight` props to `app/frontend/src/components/sidebar/collapsible-panel.tsx`. Preserve existing behavior bit-for-bit when `resizable` is absent/false. Implement height persistence: `localStorage[${storageKey}-height]` read on mount (parse int, clamp to `[minHeight, maxHeight]`, fallback to `defaultHeight` on invalid/out-of-range); write on drag end. Wrap all localStorage access in try/catch.
- [ ] T005 Implement drag handle rendering and drag behavior in `collapsible-panel.tsx`: when `resizable={true}` and the panel is open, render a 6px-tall `<div>` below the content area with `cursor: ns-resize`, `border-top: 1px solid var(--color-border)`, and mousedown/mousemove/mouseup (+ touch equivalents) handlers. During drag, update the content-area height via direct style mutation on a ref (avoid setState thrash); `setState` + persist once on drop. Support `maxHeight` as number or `calc(100vh - Npx)` string form (parse N, fall back to `window.innerHeight - 120`).
- [ ] T006 Ensure collapse/expand transitions still work when `resizable={true}` — when collapsed, height animates to 0; on re-expand, height restores to the persisted/user-set value. Hide the drag handle while collapsed. Cross-check that `transitioning` overflow handling doesn't break for resizable panels (may need a separate state path for "fixed height" vs "transitioning max-height").

## Phase 3: Core Implementation — ServerPanel Tile Grid

- [ ] T007 Rewrite the body of `app/frontend/src/components/sidebar/server-panel.tsx` to render a CSS grid of tile `<button>` elements. Keep existing prop signature except update `servers` to `ServerInfo[]`. Desktop grid: `grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))`, `gap: 6px`. Each tile: 4px top stripe (`rowTints.get(color).base` or neutral gray), body with 11px truncated name + 10px "N sess" meta. Title attr holds full server name for tooltip. Pass `resizable={true}`, `defaultHeight={140}` to the wrapping `CollapsiblePanel`.
- [ ] T008 Implement active-tile styling in `server-panel.tsx`: `aria-current="true"`, inset accent ring via `box-shadow`, tile body background = `rowTints.get(color).selected` (or accent-subtle fallback for untinted active server). Active tile is also the only tile that renders the kill `✕` button inside `.actions`.
- [ ] T009 Implement hover-revealed `.actions` in `server-panel.tsx`: absolute-positioned cluster top-right (`top: 4px; right: 4px`), contains color-picker `■` (if `onServerColorChange` prop) and kill `✕` (active tile only). Gate the entire rendering of `.actions` behind `@media (pointer: fine)` (use a matchMedia check or a `pointer-fine:` Tailwind variant if established). Color-picker click must `stopPropagation` so the outer tile button doesn't fire `onSwitchServer`. Reuse the existing `SwatchPopover` anchored to the tile with the same `colorPickerFor` state pattern as today.
- [ ] T010 Implement mobile-layout overrides in `server-panel.tsx`: at `@media (pointer: coarse), (max-width: 639px)`, switch the grid to a single horizontal row (`grid-auto-flow: column`, `grid-auto-columns: 88px`, `overflow-x: auto`, `overflow-y: hidden`, `scroll-snap-type: x mandatory`, tiles with `scroll-snap-align: start`). Hide `.actions` and the CollapsiblePanel drag handle on mobile (the latter via `CollapsiblePanel` itself — see T011). Panel body effective height 56px on mobile.
- [ ] T011 Teach `CollapsiblePanel` to hide its drag handle on mobile viewports: when `resizable={true}` AND the media query `@media (pointer: coarse), (max-width: 639px)` applies, the handle is not rendered and the content area uses a fixed height (prop-configurable or derived). Keep this logic in the panel (not in `ServerPanel`) so other panels that adopt `resizable` later get the same mobile handling.
- [ ] T012 Implement "scroll active tile into view on mount" for mobile layout in `server-panel.tsx` — `useEffect` keyed on mount / active-server change calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on the active tile ref when the single-row layout is active.

## Phase 4: Wire-up

- [ ] T013 Update `app/frontend/src/components/sidebar/index.tsx` — change `servers: string[]` prop to `servers: ServerInfo[]`; adjust internal usages (no list rendering here — just pass-through to `ServerPanel`).
- [ ] T014 Update `app/frontend/src/contexts/session-context.tsx` — change `servers: string[]` to `servers: ServerInfo[]`; adjust the fetch-and-cache path inside `SessionProvider`.
- [ ] T015 Update `app/frontend/src/app.tsx` and any other consumers of `servers` to read `.name` when they previously treated the value as a bare string (e.g., server switching, URL construction). Grep for `servers.map(` / `servers[` to cover the surface.
- [ ] T016 Update `app/frontend/src/components/server-list-page.tsx` — consume `ServerInfo[]` from `listServers()`; the existing list rendering extracts `.name` for links. Session count is not required to be displayed here this change (nice-to-have only); focus on type-safety.

## Phase 5: Tests

- [ ] T017 [P] Expand `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` with the following cases: (a) `resizable={false}` preserves legacy max-height transition, no drag handle, no height persistence; (b) `resizable={true}` renders drag handle; (c) drag mousedown/mousemove/mouseup updates height and writes to localStorage; (d) clamping to `[minHeight, maxHeight]`; (e) valid persisted height read on mount; (f) invalid/out-of-range persisted value falls back to `defaultHeight`; (g) collapse+expand restores persisted height.
- [ ] T018 [P] Create/expand `app/frontend/src/components/sidebar/server-panel.test.tsx` covering: (a) grid renders one tile per `ServerInfo`, with the expected `.name` and "N sess" text; (b) active tile has `aria-current="true"` + accent ring class/style; (c) clicking a non-active tile fires `onSwitchServer` with that name; (d) color-picker click fires `onServerColorChange` and does NOT fire `onSwitchServer` (stopPropagation); (e) kill `✕` rendered only on active tile; (f) mobile matchMedia mock → single-row layout, no `.actions` rendered, no drag handle.
- [ ] T019 [P] Create `app/frontend/e2e/server-panel-grid.spec.ts` + companion `server-panel-grid.spec.md`. E2E scenarios: desktop (1024×768) expand Tmux panel → tiles render → click second tile → URL updates; mobile (375×812) swipe horizontal → tap previously-off-screen tile → URL updates to that server. The `.spec.md` documents intent + scenarios per the project's e2e-spec-md requirement.

## Phase 6: Polish

- [ ] T020 Run full gate: `cd app/backend && go test ./...`, `cd app/frontend && pnpm tsc --noEmit`, `just test` (covers e2e with port 3020 / isolated tmux server `rk-e2e`). Fix any breakages that surface from the `ServerInfo` rename. Build check: `just build`.

---

## Execution Order

- T001 → T002 (backend response shape first, test after)
- T003 must land with T001 (coordinated type change — backend and frontend share the shape)
- T004 → T005 → T006 (CollapsiblePanel prop scaffolding → drag handle → collapse interaction) — sequential, same file
- T007 → T008 → T009 → T010 → T011 → T012 (ServerPanel component build-up) — sequential, same file; T011 also touches `collapsible-panel.tsx`
- T013–T016 can run after T003 and T007 (they depend on the new `ServerInfo` type and the rewritten panel)
- T017–T019 parallel [P] after T011 and T016
- T020 last — runs the gates

## Acceptance

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
