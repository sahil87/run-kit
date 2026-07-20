# Intake: Board-Route PANE & HOST Panels

**Change**: 260720-zx4i-board-route-pane-host-panels
**Created**: 2026-07-20

## Origin

Promptless dispatch (`/fab-proceed` → `_intake`, `{questioning-mode} = promptless-defer`) from a synthesized research discussion. No interactive questioning occurred; all decisions below were made in the originating discussion and verified against code before dispatch.

> On the board route `/board/$name`, the sidebar's two bottom panels render empty by construction: PANE shows "No window selected" and HOST shows "No metrics". Both should be populated — PANE with the details of the board's currently focused pane, HOST with host metrics.

Interaction mode: one-shot. Key decisions from the discussion: frontend-only fix (no backend/API changes); HOST falls back to the host-global metrics broadcast; PANE follows the board's focused tile via a small new React context plus a `windowId` lookup in the SSE session stream; server-side enrichment of `GET /api/boards/{name}` was considered and rejected (staleness between `board-changed` refetches + duplication of live SSE enrichment).

## Why

1. **The pain point**: On `/board/$name`, the sidebar renders its two bottom panels permanently empty. Both panels key off route-derived `currentServer` (`useCurrentServerFromRoute`, `app/frontend/src/contexts/session-context.tsx:282`), which is `null` on the board route because that route has no `server` param. So:
   - **HOST**: `HostPanel` (`app/frontend/src/components/sidebar/host-panel.tsx`) calls `useMetrics()`, which is current-server-scoped (`currentMetrics = currentServer ? metricsByServer.get(currentServer) ?? null : null`, session-context.tsx:1126) → always `null` on board → "No metrics". Its `isConnected` prop is likewise derived from `currentServer` → always false → the connection dot always reads disconnected.
   - **PANE**: `BottomPanels` (`app/frontend/src/components/sidebar/index.tsx:1264`) derives `selectedWindow` from `currentServer`/`currentSessionName`/`currentWindowId` — all null on board → "No window selected".
2. **Consequence of not fixing**: The board is the multi-pane operator surface, yet it is the one route where the sidebar's detail panels are dead weight — the operator gets no host metrics and no focused-pane registers (fab change/stage, PR, agent state, git branch) without leaving the board. Two permanently-empty panels also read as broken UI.
3. **Why this approach**: The data is already flowing client-side. The board route attaches every known server's state socket via `useBoards()` (`app/frontend/src/hooks/use-boards.ts:51`), so `sessionsByServer` is populated and live on `/board/$name`; the host-global metrics broadcast (`useHostMetrics()`, session-context.tsx:1259) is available on every route and already feeds the host overview page. Filling the panels is a pure frontend join — no new endpoints, no backend changes.

## What Changes

### 1. HOST panel — fall back to host-global metrics

`HostPanel` currently renders only the server-scoped `useMetrics()` result. Change: when `useMetrics()` returns `null` (the board route), fall back to `useHostMetrics()` — the host-global metrics broadcast (`session-context.tsx:1259`), already consumed by the host overview page and available on EVERY route.

For the header connection dot: `isConnected` is currently derived from `currentServer` and is always false on board. Use a host-level health signal instead when the server-scoped signal is unavailable — a `hostMetricsHealthy`-style signal exists in session-context (documented at `session-context.tsx:126`: "Health of the host-metrics source that feeds `useHostMetrics()`"). On the board route the dot reflects host-metrics health rather than the always-false server-scoped `isConnected`.

### 2. PANE panel — follow the board's focused tile via a new context

The board page already maintains a single source of truth for the focused tile: the `focusedPane` memo `{server, windowId, cwd}` (`app/frontend/src/components/board/board-page.tsx:470`), consumed by the palette split/kill actions and the top-bar slot.

- **Publish** this focused-pane identity into a small new React context. Pattern mirrors the existing `top-bar-slot-context` (`app/frontend/src/contexts/top-bar-slot-context.tsx` — provider + hook + colocated test).
- **Consume** in `BottomPanels` (`sidebar/index.tsx:1264`): when the route provides no window (`selectedWindow` is null), fall back to the context value and resolve the window by `windowId` across all sessions in `ctx.sessionsByServer.get(server)`. `WindowPanel` (`app/frontend/src/components/sidebar/status-panel.tsx:306`) is already a pure `WindowInfo | null` component — pass it the resolved window unchanged.

**Why the lookup works (verified in code)**: board pins are LINK-based with dual home+pin membership (`LinkWindowToSession`, `app/backend/internal/tmux/board.go:375`; the pin-session join comment in `app/backend/api/boards.go:92` confirms the pinned window "is ALSO a member of its home session"). The home-session copy of every pinned window flows through the normal sessions SSE stream FULLY ENRICHED — fab change/stage, PR registers, agent state, git branch, activity (enrichment in `app/backend/internal/sessions/sessions.go:661-760`). `windowId` is the stable join key.

### 3. Correct the stale comment at board-page.tsx:460

The comment block above the `focusedPane` memo (board-page.tsx:~460-464) says pinned windows "can NOT" be looked up in `ctx.sessionsByServer`. That claim applies only to the pin-session itself (`_rk-pin-*` sessions are filtered from session lists); the home-session copy IS present in the stream. Correct this comment as part of the change — it directly contradicts the mechanism the PANE fallback relies on.

### Rejected alternative (do not resurrect)

Enriching `GET /api/boards/{name}` entries server-side with the WindowInfo register fields. Rejected because:
(a) board entries refetch only on `board-changed` SSE events (pin/unpin/reorder — `use-boards.ts` `useBoardEntries`), so fetch-side registers would go stale between pins while agent/fab/PR state changes live;
(b) it duplicates enrichment the SSE stream already delivers live for the home-session copy.

### Edge cases (all decided)

- **Pin-only window** (home session died while pinned — a real state; the backend's last-link recovery handles it, `board.go:460ff`): absent from the SSE session stream, so the `windowId` lookup misses. Fall back to a thin render from the board's own `BoardEntry` data — `BoardEntry.panes` carries `paneId`/`paneIndex`/`cwd`/`command`/`isActive`/`gitBranch` (`app/frontend/src/api/boards.ts:37`) — rather than showing nothing. The fab/PR/agent registers are simply absent in that state, which is honest (they may genuinely be unknown).
- **Multi-pane tiles**: tile focus = selection; `WindowPanel` renders the window's active pane already — no per-pane selection is introduced.
- **Empty board** (no tiles): `focusedPane` is null → panels behave as today (PANE: "No window selected"; HOST still shows host metrics via the new fallback).
- The PANE panel's existing refresh button is server-global and renders regardless — unaffected.

### Scope

One change covers both panels — a single coherent story: board-route bottom panels populated. The HOST half is independently shippable but is bundled here deliberately.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar bottom panels (PANE/HOST) — board-route behavior: HOST falls back to host-global metrics + host-health dot; PANE follows the board's focused tile via the new focused-pane context with `windowId` lookup in `sessionsByServer`, pin-only thin-render fallback from `BoardEntry.panes`.

(`run-kit/architecture` untouched — frontend-only, no API surface or data-flow change.)

## Impact

**Frontend only. No backend changes, no new API endpoints, no new routes** (Constitution IV: this fills existing panels on an existing route).

Affected code:
- `app/frontend/src/components/sidebar/index.tsx` — `BottomPanels` fallback consumption
- `app/frontend/src/components/sidebar/host-panel.tsx` — host-metrics fallback + connection-dot source
- `app/frontend/src/components/sidebar/status-panel.tsx` — possibly untouched (`WindowPanel` stays a pure `WindowInfo | null` component)
- `app/frontend/src/components/board/board-page.tsx` — publish `focusedPane` into the new context; fix the stale :460 comment
- New file: a focused-pane context (mirroring `contexts/top-bar-slot-context.tsx`)
- `app/frontend/src/contexts/session-context.tsx` — possibly a host-health accessor (expose the `hostMetricsHealthy`-style signal if not already exported)

Tests (per `fab/project/code-quality.md`: new/changed behavior MUST include tests):
- Vitest unit tests for the context fallback + `windowId` lookup (colocated `.test.tsx`)
- Playwright e2e where feasible; any new `.spec.ts` under `app/frontend/tests/` MUST ship a sibling `.spec.md` companion (Constitution: Test Companion Docs)

## Open Questions

None — the originating discussion resolved all decision points; see Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend-only: fill both panels client-side; no backend/API changes | Discussed — server-side board-entry enrichment explicitly rejected (staleness between `board-changed` refetches + duplicates live SSE enrichment); all needed data verified already client-side | S:95 R:85 A:90 D:90 |
| 2 | Certain | HOST panel falls back to `useHostMetrics()` when server-scoped `useMetrics()` is null | Discussed — host-global broadcast verified available on every route (session-context.tsx:1259) and already feeds the host overview page | S:95 R:90 A:90 D:90 |
| 3 | Certain | PANE follows the board's focused tile: publish `focusedPane` `{server, windowId, cwd}` via a new React context (pattern: `top-bar-slot-context`), `BottomPanels` resolves by `windowId` across `ctx.sessionsByServer.get(server)` | Discussed — `focusedPane` memo verified as the board's single source of truth (board-page.tsx:470); dual home+pin membership verified (board.go:375, boards.go:92) so the enriched home-session copy is in the SSE stream; `useBoards()` attaches all servers on board routes (use-boards.ts:51) | S:95 R:80 A:90 D:85 |
| 4 | Certain | Board-route connection dot for HOST uses the host-level health signal instead of the always-false server-scoped `isConnected` | Discussed — a `hostMetricsHealthy`-style signal verified in session-context (documented at :126); server-scoped signal is false by construction on board | S:90 R:90 A:85 D:85 |
| 5 | Confident | Pin-only window (lookup miss): thin render from `BoardEntry.panes` (paneId/paneIndex/cwd/command/isActive/gitBranch, boards.ts:37); registers honestly absent | Discussed as the decided fallback; exact presentation (synthesized partial `WindowInfo` vs dedicated markup) is an apply-time detail — easily reversed, component patterns give a clear answer | S:80 R:85 A:75 D:65 |
| 6 | Certain | Multi-pane tiles: tile focus = selection; `WindowPanel` stays a pure nullable-`WindowInfo` component rendering the active pane — no per-pane selection introduced | Discussed — WindowPanel verified as already active-pane-rendering (status-panel.tsx:306); minimal-surface principle | S:90 R:90 A:90 D:90 |
| 7 | Certain | Empty board: `focusedPane` null → panels behave as today (PANE "No window selected"; HOST shows host metrics) | Discussed — explicit edge-case decision | S:90 R:95 A:95 D:90 |
| 8 | Certain | Fix the stale comment at board-page.tsx:~460 claiming the window "can NOT" be looked up in `ctx.sessionsByServer` | Discussed — comment verified stale (applies only to filtered `_rk-pin-*` pin-sessions, not the home-session copy); it contradicts the mechanism this change relies on | S:90 R:95 A:95 D:95 |
| 9 | Certain | Single change covers both panels (HOST half independently shippable but bundled) | Discussed — one coherent story: board-route bottom panels populated | S:90 R:85 A:90 D:90 |
| 10 | Certain | Tests: Vitest unit for context fallback + lookup; Playwright e2e where feasible with a sibling `.spec.md` for any new `.spec.ts` | Determined by code-quality.md (tests MUST cover new behavior) and Constitution (Test Companion Docs) | S:90 R:90 A:95 D:95 |
| 11 | Certain | The HOST fallback triggers on null server-scoped metrics generally (not board-route-gated); board is in practice the only sidebar route where `currentServer` is null (`/` renders ServerListPage with no sidebar) | Route structure gives one obvious interpretation; trivially adjustable at apply if a route gate proves cleaner | S:75 R:90 A:85 D:70 |

11 assumptions (10 certain, 1 confident, 0 tentative, 0 unresolved).
