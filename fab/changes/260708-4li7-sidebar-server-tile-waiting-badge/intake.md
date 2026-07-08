# Intake: Sidebar Server Tile Waiting Badge

**Change**: 260708-4li7-sidebar-server-tile-waiting-badge
**Created**: 2026-07-08

## Origin

One-shot `/fab-new` invocation:

> Currently the agent blocked state makes it way to the tmux session row on the left panel. Also bring it up on the servers boxes in the SERVER section

"Blocked state" is the `waiting` agent state (`@rk_agent_state` — "blocked on a human"; `waiting-badge.tsx`'s own doc comment calls it "an agent blocked on a human"). The user confirms the existing session-row surfacing works and asks for the same rollup on the server tiles in the sidebar's SERVER section.

## Why

The `waiting` attention rollup (260706-y1ar, design authority `docs/specs/status-pyramid.md` § Attention Propagation) propagates as a count badge on the session row, the Cockpit server tile, and the board header. The sidebar's SERVER panel — the compact per-server tile grid at the top of the left panel — is the one server-level surface without it.

The gap matters because the SERVER panel is exactly where a user scans to switch servers: a server whose agents are blocked on human input gives no signal there today. The session rows below only cover the *expanded* groups of the sidebar; a waiting agent on a collapsed or non-current server is invisible until the user happens to open that group or visit the Cockpit. Without the fix, "does anything need me?" has no answer at the sidebar's server level — the glance language (constant-yellow `N⚠` chip) is inconsistent across the two server-tile surfaces.

The approach is pure reuse: the rollup helper (`countWaitingInSessions`), the chip component (`WaitingBadge`), and the data (`sessionsByServer` from SSE) all exist — the Cockpit tile at `server-list-page.tsx:311` is the exact precedent. No backend change, no new endpoint, no polling (Constitution II).

## What Changes

### `ServerTile` in the sidebar SERVER panel renders a `WaitingBadge`

`app/frontend/src/components/sidebar/server-panel.tsx`:

- `ServerPanelProps` gains a waiting-count input. The Sidebar computes one count per server and passes a map, keeping `ServerPanel`'s prop surface minimal:

  ```tsx
  /** server name → count of waiting windows (from countWaitingInSessions). */
  waitingCounts?: Map<string, number>;
  ```

- `ServerTile` gains `waitingCount: number` and renders the shared chip inside the tile body, right-aligned on the session-count line (a flex row), so the badge:
  - never collides with the hover-revealed palette/kill action cluster that already occupies the tile's top-right (`server-panel.tsx:315`, `top-1 right-1 z-10`) — this is why the Cockpit's `absolute right-2 top-2` placement is NOT copied verbatim;
  - renders on both desktop (72px min tiles) and mobile (88px horizontal-scroll tiles) with the same code path;
  - is absent (not a `0`) when nothing waits — `WaitingBadge` renders `null` at count ≤ 0, so the layout is unchanged for the common case.

  ```tsx
  <div className="flex items-center justify-between mt-0.5">
    <div className="text-[10px] leading-tight text-text-secondary">
      {sessionCount} sess
    </div>
    <WaitingBadge count={waitingCount} />
  </div>
  ```

  Accessibility rides the existing component: `WaitingBadge` carries its own `aria-label`/`title` ("N agents waiting for input") and is text + color, never color-only.

### Sidebar computes the per-server counts

`app/frontend/src/components/sidebar/index.tsx` (ServerPanel mounted at ~line 1041): compute the counts from the context data already consumed there (`sessionsByServer`, line 84) and pass them down:

```tsx
const waitingCounts = useMemo(() => {
  const m = new Map<string, number>();
  for (const [name, sessions] of sessionsByServer) m.set(name, countWaitingInSessions(sessions));
  return m;
}, [sessionsByServer]);
```

Counts are **attached-server only**, mirroring the Cockpit tile's documented semantics (`server-list-page.tsx:303-309`): only servers with an open SSE stream have windows in `sessionsByServer`, so an unattached server's count is 0 and its badge is simply absent — never a wrong count. The current server is always attached, and expanding a server's session group attaches it (the sidebar's existing lazy-attach, `index.tsx:167-173`). No eager attach-all is added: each attach is a long-lived EventSource, and eagerly opening one per server would pressure the HTTP/1.1 6-per-origin connection pool on plaintext origins (the known board-route starvation vector).

### Tests

`app/frontend/src/components/sidebar/server-panel.test.tsx` (exists, extends): component tests asserting

1. a tile whose server has waiting windows renders the badge (`data-testid="waiting-badge"`) with the count;
2. a tile with count 0 / no entry in the map renders no badge.

Unit tests only — `.test.tsx` is exempt from the `.spec.md` companion rule; no Playwright spec is added (driving a real `@rk_agent_state` pane option through e2e fixtures is out of proportion for a pure-derivation UI chip, and no existing badge surface has one).

### Spec table row (docs)

`docs/specs/status-pyramid.md` § Attention Propagation surface table gains a row for the sidebar server tile (count badge, same treatment as the Cockpit row) so the design authority doesn't drift from the implementation.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Attention Surfacing — add the sidebar SERVER-panel server tile to the WaitingBadge surface list
- `run-kit/agent-state`: (modify) § UI Surfacing — extend the "Attention rollups + nav" consumer list (session row, Cockpit server tile, board header → + sidebar server tile)

## Impact

- `app/frontend/src/components/sidebar/server-panel.tsx` — props + tile body render (frontend only)
- `app/frontend/src/components/sidebar/index.tsx` — compute + pass `waitingCounts`
- `app/frontend/src/components/sidebar/server-panel.test.tsx` — new assertions
- `docs/specs/status-pyramid.md` — one table row
- No backend, API, or SSE changes; pure derivation over data the client already streams. No new dependencies.

## Open Questions

None — the input is a direct extension of an established pattern; all decision points resolved from the codebase (recorded below).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | "Blocked state" = the `waiting` agent state (`@rk_agent_state`) | The codebase's own vocabulary: `waiting` is defined as "blocked on a human" (agent-state spec, WaitingBadge doc comment); it is the state already surfaced on the session row the user references | S:80 R:90 A:95 D:90 |
| 2 | Certain | "SERVER section" = the sidebar's collapsible Server panel tiles (`ServerPanel`/`ServerTile`) | It is the only server-box surface without the badge — the Cockpit TMUX SERVERS tiles already have it; user contrasts it with the session rows "on the left panel" | S:75 R:90 A:90 D:85 |
| 3 | Certain | Reuse `WaitingBadge` + `countWaitingInSessions` unchanged | Single-source-of-truth is the stated design of `lib/waiting.ts`; the Cockpit tile is the exact precedent; code-quality forbids duplicating utilities | S:70 R:90 A:95 D:90 |
| 4 | Confident | Badge placement: right-aligned on the tile's "N sess" line, not absolute top-right | Sidebar tiles (unlike Cockpit tiles) have hover-revealed palette/kill actions at top-right; inline flex avoids the collision and works on 72–88px tiles; trivially reversible styling | S:50 R:90 A:70 D:60 |
| 5 | Confident | Attached-server-only counts; no eager attach-all when the panel opens | Mirrors the Cockpit tile's documented accepted caveat ("never a wrong count"); eager per-server EventSources would pressure the HTTP/1.1 6-per-origin pool on plaintext origins | S:60 R:85 A:90 D:75 |
| 6 | Confident | Prop shape: Sidebar computes a `waitingCounts` map; `ServerTile` takes a plain `waitingCount` number | Keeps ServerPanel decoupled from session data (it currently knows only `ServerInfo`); computation site already consumes `sessionsByServer`; internal shape, freely changeable at apply | S:45 R:95 A:80 D:65 |
| 7 | Confident | Component tests in `server-panel.test.tsx`; no new e2e spec | Code-quality mandates tests for new behavior; unit `.test.tsx` is `.spec.md`-exempt; no existing badge surface has an e2e spec and agent-state e2e fixtures are disproportionate | S:50 R:90 A:75 D:70 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
