# Plan: Sidebar Server Tile Waiting Badge

**Change**: 260708-4li7-sidebar-server-tile-waiting-badge
**Intake**: `intake.md`

## Requirements

### Sidebar SERVER Panel: Waiting Attention Rollup

#### R1: `ServerTile` renders a `WaitingBadge` for its server's waiting count
The sidebar SERVER-panel `ServerTile` (`app/frontend/src/components/sidebar/server-panel.tsx`) SHALL render the shared `WaitingBadge` chip, driven by a new `waitingCount: number` prop, inline on the tile's "N sess" line (a right-aligned flex row) so it never collides with the hover-revealed palette/kill action cluster at the tile's top-right. The badge MUST use the shared component unchanged (single source of truth) and MUST be absent — not a `0` — when nothing waits.

- **GIVEN** a `ServerTile` whose `waitingCount` is `2`
- **WHEN** the tile renders
- **THEN** a `WaitingBadge` (`data-testid="waiting-badge"`) showing `2` appears on the same flex row as the `N sess` count, right-aligned
- **AND** the badge carries the component's own `aria-label`/`title` ("2 agents waiting for input")

- **GIVEN** a `ServerTile` whose `waitingCount` is `0`
- **WHEN** the tile renders
- **THEN** no `WaitingBadge` element is present in the DOM (WaitingBadge returns `null` at count ≤ 0), leaving the common-case layout unchanged

#### R2: `ServerPanel` accepts a per-server waiting-count map and forwards each tile its count
`ServerPanel` (`server-panel.tsx`) SHALL accept an optional `waitingCounts?: Map<string, number>` prop (server name → count of waiting windows) and pass each tile the count for its own server (defaulting to `0` when the map lacks an entry), keeping `ServerPanel` decoupled from raw session data. `ServerTile` receives a plain `waitingCount: number`.

- **GIVEN** `ServerPanel` mounted with `waitingCounts` mapping `"work" → 3` and no entry for `"default"`
- **WHEN** the panel renders its tiles
- **THEN** the `work` tile shows a badge with `3` and the `default` tile shows no badge

#### R3: Sidebar computes the attached-server-only counts and passes them down
The Sidebar (`app/frontend/src/components/sidebar/index.tsx`) SHALL compute `waitingCounts` from the already-consumed `sessionsByServer` context data via the existing `countWaitingInSessions` helper (memoized on `sessionsByServer`) and pass the resulting map to `ServerPanel`. Counts are attached-server-only by construction — only servers with an open SSE stream have windows in `sessionsByServer`, so an unattached server's count is `0` (badge absent), never a wrong count. No eager attach-all is introduced.

- **GIVEN** `sessionsByServer` contains sessions for the current (attached) server with one `waiting` window
- **WHEN** the Sidebar renders `ServerPanel`
- **THEN** that server's tile shows a badge with count `1`

- **GIVEN** a server that is not attached (absent from `sessionsByServer`)
- **WHEN** the Sidebar renders `ServerPanel`
- **THEN** that server's tile shows no badge (count `0`) and no new EventSource is opened for it

### Documentation: Design Authority Alignment

#### R4: `status-pyramid.md` § Attention Propagation gains a sidebar-server-tile surface row
`docs/specs/status-pyramid.md` § Attention Propagation surface table SHALL gain a row for the sidebar SERVER-panel server tile (count-badge treatment, matching the Cockpit server-tile row) so the design authority does not drift from the implementation.

- **GIVEN** the change ships the badge on the sidebar server tile
- **WHEN** a reader consults the § Attention Propagation surface table
- **THEN** a row names the sidebar SERVER-panel server tile as a count-badge surface

### Non-Goals

- No backend, API, or SSE change — pure client-side derivation over data already streamed (Constitution II).
- No eager attach-all of every server's SSE stream (would pressure the HTTP/1.1 6-per-origin connection pool on plaintext origins).
- No new Playwright e2e spec — unit tests only (see Design Decisions).

### Design Decisions

1. **Badge placement inline on the "N sess" line, not absolute top-right**: right-aligned flex row on the session-count line — *Why*: sidebar tiles (unlike Cockpit tiles) have hover-revealed palette/kill actions at `top-1 right-1`; inline flex avoids the collision and works on both 72px desktop and 88px mobile tiles — *Rejected*: copying the Cockpit's `absolute right-2 top-2` (collides with the action cluster).
2. **Prop split — map at `ServerPanel`, number at `ServerTile`**: Sidebar computes a `waitingCounts` map; `ServerTile` takes a plain `waitingCount` — *Why*: keeps `ServerPanel`/`ServerTile` decoupled from session data (they know only `ServerInfo`); the computation site already consumes `sessionsByServer` — *Rejected*: threading `sessionsByServer` into `ServerPanel` (couples a presentational panel to SSE data).
3. **Attached-server-only counts**: mirrors the Cockpit tile's documented caveat — *Why*: only attached servers stream windows; an unattached server reads `0` (badge absent), never a wrong count; eager per-server EventSources would starve the plaintext connection pool — *Rejected*: eager attach-all.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `waitingCount: number` to `ServerTileProps` and render `<WaitingBadge count={waitingCount} />` inline right-aligned on the "N sess" line (wrap the existing `N sess` div in a `flex items-center justify-between mt-0.5` row) in `app/frontend/src/components/sidebar/server-panel.tsx`; import `WaitingBadge` from `@/components/waiting-badge` <!-- R1 -->
- [x] T002 Add `waitingCounts?: Map<string, number>` to `ServerPanelProps`, destructure it in `ServerPanel`, and pass `waitingCount={waitingCounts?.get(name) ?? 0}` to each `<ServerTile>` in `app/frontend/src/components/sidebar/server-panel.tsx` <!-- R2 -->
- [x] T003 In `app/frontend/src/components/sidebar/index.tsx`, compute `const waitingCounts = useMemo(...)` over `sessionsByServer` using `countWaitingInSessions` (import from `@/lib/waiting`) and pass `waitingCounts={waitingCounts}` to the `<ServerPanel>` mount (~line 1041) <!-- R3 -->

### Phase 3: Tests & Docs

- [x] T004 Extend `app/frontend/src/components/sidebar/server-panel.test.tsx`: (a) a tile whose server has a waiting count renders `waiting-badge` with the count; (b) a tile with count 0 / no map entry renders no badge. Update `renderPanel` to accept an optional `waitingCounts` override <!-- R1 R2 -->
- [x] T005 [P] Add a sidebar-server-tile row to the § Attention Propagation surface table in `docs/specs/status-pyramid.md` (count-badge treatment, matching the Cockpit server-tile row) <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ServerTile` renders `WaitingBadge` inline on the "N sess" line with its `waitingCount`, absent at count 0
- [x] A-002 R2: `ServerPanel` accepts `waitingCounts?: Map<string, number>` and forwards each tile its own count (default 0)
- [x] A-003 R3: Sidebar computes `waitingCounts` from `sessionsByServer` via `countWaitingInSessions` (memoized) and passes it to `ServerPanel`
- [x] A-004 R4: `status-pyramid.md` § Attention Propagation surface table has a sidebar-server-tile count-badge row

### Behavioral Correctness

- [x] A-005 R1: The badge is right-aligned on the session-count flex row and does not collide with the top-right hover action cluster (no absolute positioning copied from Cockpit)
- [x] A-006 R3: Only attached servers (present in `sessionsByServer`) show a non-zero count; unattached servers show no badge and no new EventSource is opened

### Edge Cases & Error Handling

- [x] A-007 R2: A server absent from the `waitingCounts` map resolves to count 0 (no badge), never `undefined`/`NaN`

### Scenario Coverage

- [x] A-008 R1: Unit tests in `server-panel.test.tsx` cover both the badge-present (count > 0) and badge-absent (count 0 / no entry) cases

### Code Quality

- [x] A-009 Pattern consistency: New code follows the surrounding `ServerTile`/`ServerPanel` prop and JSX conventions and the existing count-chip vocabulary
- [x] A-010 No unnecessary duplication: Reuses `WaitingBadge` and `countWaitingInSessions` unchanged (no re-implementation) per code-quality "duplicating existing utilities" anti-pattern
- [x] A-011 No client polling: Counts derive from the existing SSE `sessionsByServer` stream — no `setInterval`/fetch added (code-quality anti-pattern; Constitution II)
- [x] A-012 Type narrowing over assertions: New prop typing uses explicit types, no `as` casts (code-quality frontend rule)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The Cockpit tile's inline `countWaitingInSessions(sessionsByServer.get(name) ?? [])` at `server-list-page.tsx:311` and the sidebar's new `waitingCounts` map are different composition sites over the same shared helper — neither supersedes the other.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `WaitingBadge` + `countWaitingInSessions` unchanged | Single-source-of-truth is the stated design of `lib/waiting.ts`; the Cockpit tile is the exact precedent; code-quality forbids duplicating utilities | S:80 R:90 A:95 D:90 |
| 2 | Confident | Badge placement: right-aligned on the tile's "N sess" line via a `flex items-center justify-between` row, not absolute top-right | Sidebar tiles have hover-revealed palette/kill actions at top-right; inline flex avoids the collision and works on 72–88px tiles; trivially reversible styling (intake Assumption 4) | S:60 R:90 A:75 D:65 |
| 3 | Confident | Prop shape: `ServerPanel` takes `waitingCounts?: Map<string,number>`; `ServerTile` takes a plain `waitingCount: number` defaulting to 0 via `?? 0` | Keeps the presentational panel decoupled from session data; computation site already consumes `sessionsByServer`; internal shape freely changeable (intake Assumption 6) | S:50 R:95 A:80 D:70 |
| 4 | Confident | Attached-server-only counts; no eager attach-all | Mirrors the Cockpit tile's documented accepted caveat; eager per-server EventSources would pressure the HTTP/1.1 6-per-origin pool on plaintext origins (intake Assumption 5) | S:60 R:85 A:90 D:75 |
| 5 | Confident | Component tests in `server-panel.test.tsx`; no new e2e spec | Code-quality mandates tests for new behavior; unit `.test.tsx` is `.spec.md`-exempt; no existing badge surface has an e2e spec (intake Assumption 7) | S:55 R:90 A:80 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
