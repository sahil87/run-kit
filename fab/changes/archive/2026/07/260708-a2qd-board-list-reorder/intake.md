# Intake: Board List Reorder

**Change**: 260708-a2qd-board-list-reorder
**Created**: 2026-07-08

## Origin

One-shot `/fab-new` invocation, no prior discussion in the conversation.

> Ability to reorder the boards themselves on the board pane (top left) and the cockpit (like you can re-order the servers)

Interpretation: "the board pane (top left)" is the sidebar **BoardsSection** — the cross-server boards list rendered at the top of the sidebar (top-left of the screen on board routes); "the cockpit" is the **BOARDS zone** on `/` (`server-list-page.tsx`). "Like you can re-order the servers" points at the existing server-tile drag-reorder stack (`useServerReorder` + `POST /api/servers/order` + `@rk_server_rank` + server-global `event: server-order`), which this change mirrors for the board list itself. Note this is about reordering **boards in the board list**, distinct from the existing within-board pin reorder (`POST /api/boards/{name}/reorder`, `@rk_board_order` fractional keys), which already works.

## Why

1. **Pain point**: The board list is hard-sorted alphabetically everywhere (`tmux.ListBoards` sorts by name; every consumer — sidebar BoardsSection, Cockpit BOARDS zone, top-bar BoardSwitcher dropdown — renders that order). Users curate boards around active work; the board they use most can be buried under alphabetically-earlier stale boards, and renaming boards to force an order is the only workaround.
2. **Consequence of not fixing**: As board count grows, the primary board-navigation surfaces degrade — the Cockpit zone and sidebar list stop reflecting priority, and the interaction vocabulary stays inconsistent (servers, sidebar sessions, and pins within a board are all drag-reorderable; boards are the one list that is not).
3. **Why this approach**: Mirror the proven server-reorder pattern end-to-end (shared drag hook with derive-over-store optimistic override, full-order POST, rank-aware sort, server-global SSE echo, palette keyboard path). It is already implemented, tested, and debugged in this codebase (including the HTML5 DnD self-target snap-back fix), so reuse minimizes both risk and new vocabulary. The one place the analogy breaks is storage: a tmux server carries its own `@rk_server_rank` option, but a board is an emergent cross-server aggregate of `_rk-pin-*` pin-sessions with no single tmux object to carry a rank — so board order persists in `~/.rk/settings.yaml` (host-level preference, same home as `ServerColors`), which Constitution II explicitly permits (state derived from tmux **and the filesystem**).

## What Changes

### Backend: persist board order in `~/.rk/settings.yaml` (`internal/settings`)

Extend the `Settings` struct with an ordered board-name list; rank = slice index:

```go
type Settings struct {
    Theme        string
    ThemeDark    string
    ThemeLight   string
    ServerColors map[string]string
    // BoardOrder is the user-defined display order of board names.
    // Boards absent from the list sort after ranked boards, alphabetically.
    BoardOrder   []string
}
```

Add `GetBoardOrder() []string` / `SetBoardOrder(names []string) error` accessors mirroring `GetServerColor`/`SetServerColor`, with parse/serialize support in the hand-rolled YAML round-trip (`parse`/`serialize`). Rationale for filesystem over tmux options: fanning a rank out to every pin-session of a board (across servers) would create disagreement and rank-loss semantics on pin/unpin; a single host-level file matches the host-global nature of the board list.

### Backend: `POST /api/boards/order` + rank-aware board sort (`api/boards.go`)

New endpoint mirroring `POST /api/servers/order` semantics — the client sends the **full ordered list** of board names:

```json
POST /api/boards/order
{"order": ["deploys", "reviews", "scratch"]}
```

- Validate each name with `ValidBoardName`; reject invalid payloads with 400. Uniform POST per Constitution IX.
- Write via `settings.SetBoardOrder`.
- The ordering is applied at the **API layer** (handler wrapping `tmux.ListBoards`), not inside `internal/tmux` — `internal/tmux` stays settings-unaware. Sort: boards present in the stored order first, by index; boards absent from the order after them, alphabetically (matching the rank-aware server sort's unranked-last behavior). Stale names in the stored list (boards that no longer exist) are ignored on read; every reorder write replaces the full list, so staleness self-heals.
- The `GET /api/boards` response order **is** the display order for all consumers — no `rank` field is added to `BoardSummary`, and no client-side comparator is introduced (unlike servers, boards have exactly one list source, so the backend is the single sort choke point).

### Backend: server-global `event: board-order` SSE broadcast (`api/sse.go`)

After a successful order write, broadcast a server-global `board-order` event carrying the new ordered name list, mirroring the `server-order` broadcast exactly: a single cached slot (`cachedBoardOrderJSON` alongside `cachedServerOrderJSON`), replayed to new clients on connect, delivered on every stream. This is deliberately **not** the per-server `board-changed` event — the order write is not scoped to any tmux server.

### Frontend: order propagation in `useBoards` (`hooks/use-boards.ts`, `api/boards.ts`, `contexts/session-context.tsx`)

- `api/boards.ts` gains `setBoardOrder(order: string[])` posting to `/api/boards/order`.
- `session-context.tsx` exposes a `board-order` subscription on the shared SSE pool (same seam as `subscribeBoardChange`).
- `useBoards` subscribes and reuses its existing debounced-refetch machinery (`REFETCH_DEBOUNCE_MS`) so a reorder on one client re-sorts every other client live.

### Frontend: shared drag-reorder hook on the two named surfaces

New `hooks/use-board-list-reorder.ts` mirroring `use-server-reorder.ts` structurally:

- Custom MIME `application/x-board-list-reorder` — distinct from `application/x-server-reorder`, `application/x-session-reorder`, and the board-pane window-move payload, so drags never cross-fire.
- Insert-before splice on `dragOver`; derive-over-store optimistic override (a ref, not state) cleared by a render-time name-equality reconcile against the authoritative `boards` list — no snap-back on drag-end, override outlives the POST until the SSE echo lands.
- 250ms debounced `setBoardOrder` POST + immediate flush on `drop`.
- `dragOver` accepts (`preventDefault()`) on the self-target tile **before** the self-target bail — the cancelled-drag snap-back-ghost fix proven on the server hook.
- No infra-exclusion analog: every board is draggable and a valid drop target.

Wire it into both user-named surfaces, each rendering `orderedBoards` instead of raw `boards`:

1. **Sidebar `BoardsSection`** rows (`components/sidebar/boards-section.tsx`) — the "board pane (top left)".
2. **Cockpit BOARDS zone** tiles (`components/server-list-page.tsx`).

The top-bar BoardSwitcher dropdown and every other `useBoards` consumer inherit the new order passively from the backend-sorted response — no drag affordance there.

### Frontend: command-palette keyboard path (`lib/palette-move.ts` + palette wiring)

`Board: Move up` / `Board: Move down` palette actions for the current board on `/board/$name` routes, built on the existing `lib/palette-move.ts` pure helpers — boundary-hidden (no action at list edge, no wraparound), exactly like the existing server/session/window move actions. Constitution V mandates a keyboard path for every action; it also covers touch devices, where HTML5 DnD does not fire.

### Tests

- **Go**: settings `BoardOrder` round-trip + legacy-file tolerance; `/api/boards/order` validation + rank-aware list sort (ranked-first, unranked-alphabetical-after, stale-name tolerance); `board-order` SSE broadcast + cached replay-on-connect.
- **Vitest**: `use-board-list-reorder` hook tests mirroring `use-server-reorder.test.ts` (override lifecycle, reconcile, debounce/flush, self-target accept); BoardsSection + Cockpit wiring; palette move actions.
- **Playwright**: e2e drag-reorder coverage where warranted, with companion `.spec.md` updates in the same commit (constitution Test Companion Docs rule).

## Affected Memory

- `run-kit/ui-patterns`: (modify) add board-list drag reorder (shared hook on BoardsSection + Cockpit BOARDS tiles, derive-over-store, MIME) and palette `Board: Move up/down` alongside the existing server-reorder entry
- `run-kit/architecture`: (modify) add `POST /api/boards/order`, settings.yaml `BoardOrder` persistence, and the server-global `event: board-order` broadcast alongside the `server-order` entry

## Impact

- `app/backend/internal/settings/settings.go` (+ test) — `BoardOrder` field, accessors, parse/serialize
- `app/backend/api/boards.go`, `router.go` (+ tests) — order endpoint, rank-aware list sort
- `app/backend/api/sse.go` (+ test) — `board-order` cached-slot broadcast
- `app/frontend/src/api/boards.ts` (+ test) — `setBoardOrder`
- `app/frontend/src/hooks/use-boards.ts` (+ test) — `board-order` subscription
- `app/frontend/src/hooks/use-board-list-reorder.ts` (new, + test) — shared drag hook
- `app/frontend/src/contexts/session-context.tsx` — `board-order` SSE pool subscription seam
- `app/frontend/src/components/sidebar/boards-section.tsx`, `components/server-list-page.tsx` — surface wiring
- `app/frontend/src/lib/palette-move.ts` + palette registration — keyboard path
- No tmux-layer changes; no new routes/pages (Constitution IV untouched)

## Open Questions

- None — all decision points graded Confident or above (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Interaction mirrors `useServerReorder` verbatim: custom MIME, insert-before, derive-over-store ref override + render-time reconcile, 250ms debounce + drop-flush, self-target dragover accept | User said "like you can re-order the servers"; the pattern is implemented, tested, and debugged in-repo | S:90 R:85 A:95 D:95 |
| 2 | Confident | Board order persists as an ordered name list in `~/.rk/settings.yaml` (`internal/settings`), not tmux options | Boards are emergent cross-server aggregates with no single tmux object to carry a rank; settings.yaml already holds host-level prefs (ServerColors); Constitution II permits filesystem state | S:45 R:60 A:70 D:65 |
| 3 | Confident | API is `POST /api/boards/order` with the full ordered name list; ordering applied at the API layer; backend-sorted response is the display order (no client comparator, no rank field) | Mirrors `/api/servers/order` semantics + Constitution IX uniform POST; `/api/boards` is the sole list source so the backend is the natural single sort choke point | S:55 R:75 A:85 D:80 |
| 4 | Confident | Propagation via a dedicated server-global `event: board-order` (single cached slot, replay on connect), not the per-server `board-changed` event | Order writes are not server-scoped; `server-order` is the exact precedent with the cached-slot machinery already in place | S:40 R:70 A:70 D:60 |
| 5 | Certain | A keyboard path ships in the same change: palette `Board: Move up/down` on board routes via `lib/palette-move.ts`, boundary-hidden, no wraparound | Constitution V mandates keyboard reachability for every action; servers/sessions/windows already have palette move; also the touch fallback | S:70 R:80 A:95 D:90 |
| 6 | Confident | "Board pane (top left)" = sidebar BoardsSection; drag lands on it + Cockpit BOARDS tiles only; BoardSwitcher dropdown and other consumers inherit order passively | BoardsSection is the boards list at the top of the (left) sidebar — the only top-left boards surface; dropdowns aren't drag targets in the existing vocabulary | S:75 R:85 A:80 D:70 |
| 7 | Confident | Unranked boards (created after the last reorder) sort after ranked boards, alphabetically; stale names in the stored order are ignored on read and self-heal on the next full-list write | Matches the rank-aware server sort's unranked-last behavior; full-list writes make pruning unnecessary | S:30 R:80 A:60 D:55 |

7 assumptions (2 certain, 5 confident, 0 tentative, 0 unresolved).
