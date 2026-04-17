# Intake: Server Panel Tile Grid

**Change**: 260417-jpkl-server-panel-tile-grid
**Created**: 2026-04-17
**Status**: Draft

## Origin

Initiated in a `/fab-discuss` exploratory session. User raised the current vertical tmux server list in the sidebar as a candidate for redesign, asked for mock options, then selected Mock A (color-tile grid) after inspecting three candidate HTML mocks in an rk iframe window.

> The top left section - that shows the tmux servers, I am exploring alternate UIs for that. Something along the lines for a swatch panel - boxes next to each other, arranged like a table with multiple rows and columns. Also I want to height of the panel to be resizable. (It should be scrollable for items at the bottom). the boxes should expand to take the full width (multiple columns but). Can you show me a few mock options.

Three mocks were shown as a static HTML preview (`/tmp/server-panel-mocks.html`):

- **A. Color-tile grid** — compact rectangles with a top color stripe (ANSI row tint), auto-fill columns `repeat(auto-fill, minmax(72px, 1fr))`, name + session count per tile
- **B. Chip grid** — single-line pills with a color dot + count, flex-wrap
- **C. Info-card grid** — larger cards with a left-edge color bar, session + window counts

User picked A: *"Go ahead with Option A"*. Subsequent clarifying answers locked the four key design decisions recorded in the Assumptions table.

## Why

### Problem
The existing `ServerPanel` (`app/frontend/src/components/sidebar/server-panel.tsx`) renders tmux servers as a vertical list inside a `CollapsiblePanel` with a fixed `max-height: 200px`. This has three pain points:

1. **Low density** — one server per row wastes horizontal space in the 240px sidebar; users with many servers must scroll extensively
2. **Fixed height** — the 200px cap is hard-coded in `CollapsiblePanel`; users cannot expand the panel to see more servers without scrolling
3. **Color de-emphasized** — the per-server ANSI color (configured via `serverColors` in `settings.yaml` and rendered through `computeRowTints`) is only a subtle row background; a color-stripe tile surfaces it more prominently, which helps users who use color as the primary server-identification cue

### Consequences of not fixing
- Sidebar continues to feel cramped as the server count grows
- The color-coding feature (already implemented end-to-end via `getAllServerColors`/`setServerColor`) is under-utilized visually
- Resize affordance is missing across every sidebar panel, not just servers — but servers are the most acute case

### Why this approach over alternatives
- **Mock B (chips)** rejected: smaller color dots de-emphasize color further — opposite direction from the design goal
- **Mock C (info cards)** rejected: taller rows = fewer servers visible before scroll; surfaces window counts that we don't need at the server-selection level
- **Keep list + add resize only** rejected: doesn't address low density or color prominence
- **New page for servers** rejected: violates Constitution IV (Minimal Surface Area) — sidebar already has the space

## What Changes

### 1. ServerPanel grid layout

Replace the vertical list inside `app/frontend/src/components/sidebar/server-panel.tsx` with a CSS grid of color-tile cards. Full rewrite of the component body; props unchanged.

**Grid container** (desktop / fine pointer):
```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
gap: 6px;
```

**Tile structure** (per server):
```tsx
<button className="tile" aria-current={isActive ? "true" : undefined}>
  <div className="stripe" style={{ backgroundColor: tint.base }} /> {/* 4px colored top strip */}
  <div className="body">
    <div className="name">{serverName}</div>     {/* 11px, truncate */}
    <div className="meta">{sessionCount} sess</div> {/* 10px, text-secondary */}
  </div>
  {/* hover-revealed actions — color-picker square + × kill button */}
  <div className="actions">
    {onServerColorChange && <button className="act-btn">■</button>}
    {isActive && <button className="act-btn">✕</button>}
  </div>
</button>
```

**Active state**: accent ring (`box-shadow: inset 0 0 0 1px var(--color-accent)`) + brighter tint background (`rowTints.get(color).base` applied to tile; selected-tint may be used for additional emphasis — confirmed at spec stage).

**Hover state**: on `pointer: fine` devices, `.actions` becomes visible (color-picker square + kill button for active server). On `pointer: coarse`, actions are always visible at reduced opacity or gated via a long-press menu — spec to clarify.

**Tint application**: each tile's stripe color comes from `rowTints.get(serverColor).base`. Tiles without an assigned color use a neutral gray stripe (no explicit tint — matches current untinted row treatment).

### 2. Session counts — extend `/api/servers`

Currently the servers endpoint (in `app/backend/api/`) returns a list of server names. Extend the response shape to include per-server session counts:

```go
// Response shape (JSON)
[
  {"name": "default", "sessionCount": 4},
  {"name": "work",    "sessionCount": 2},
  ...
]
```

- Count is resolved via `tmux -L <server> list-sessions -F '#{session_name}' | wc -l` (or equivalent in `internal/tmux/`)
- If `tmux list-sessions` fails for a server (e.g., server not running or socket missing), `sessionCount` is `0`
- Frontend `getServers()` in `app/frontend/src/api/client.ts` returns the new shape; consumers in `Sidebar` / `ServerPanel` read the count

Frontend type (`app/frontend/src/types.ts` or equivalent):
```ts
export type ServerInfo = {
  name: string;
  sessionCount: number;
};
```

The existing `servers: string[]` prop in `Sidebar` and `ServerPanel` becomes `servers: ServerInfo[]`. All callers updated.

### 3. Resizable CollapsiblePanel variant

Add opt-in resize support to `app/frontend/src/components/sidebar/collapsible-panel.tsx`. New prop:

```ts
type CollapsiblePanelProps = {
  // ... existing props ...
  /** When true, adds a drag handle at the bottom and persists user-set height.
      Height key derives from storageKey (e.g., `${storageKey}-height`). */
  resizable?: boolean;
  /** Minimum height in pixels (px). Default 80. */
  minHeight?: number;
  /** Maximum height in pixels or viewport units. Default 'calc(100vh - 120px)' / 600px. */
  maxHeight?: number | string;
};
```

**Behavior when `resizable={true}`**:
- Content area uses `height: {userHeight || defaultHeight}px` instead of the current fixed `max-height: 200px` transition
- Inner content uses `overflow-y-auto`; scrolls independently when tile grid overflows the set height
- Bottom of the panel renders a 6px-tall drag handle (cursor `ns-resize`, hover shows subtle color)
- `onMouseDown` → track `clientY` delta → clamp to `[minHeight, maxHeight]` → write to `localStorage[`${storageKey}-height`]`
- Default height when no persisted value: a new `defaultHeight` prop (falls back to `200`, matching today's hard-coded value)
- Collapse/expand still works: when collapsed, height animates to 0 (same as today); user-set height restored on re-expand

**Behavior when `resizable` is absent / false**: existing behavior preserved bit-for-bit — `max-height: 200px` transition, no drag handle, no height persistence. This keeps WindowPanel and HostPanel untouched.

**Opt-in adoption** (this change): only `ServerPanel` passes `resizable={true}`. `ServerPanel`'s `defaultHeight` stays low (suggested 140px so the tile grid is visibly short by default and invites scrolling); user can drag taller.

### 4. Mobile layout — horizontal swipe row

On coarse pointers (`@media (pointer: coarse)`) and/or narrow viewports (the sidebar drawer at < 640px), the tile grid collapses to a single horizontal row:

```css
@media (pointer: coarse), (max-width: 639px) {
  .tile-grid {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: 90px;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
  }
  .tile { scroll-snap-align: start; }
}
```

Behavior:
- One row of tiles, swipe left/right to browse
- Tap a tile to select that server
- No vertical scroll inside the panel (saves drawer vertical space for sessions)
- Resize handle hidden on mobile (panel becomes a fixed single-row strip)
- `+` new server button remains in the panel header

### 5. Scroll + resize interaction

- Default desktop state: panel height ~140px, shows 2 rows of tiles at 240px sidebar width, server grid scrolls vertically for overflow
- User drags bottom handle to expand panel up to `calc(100vh - 120px)` (leaves room for header + sessions + bottom panels)
- Scroll position inside the grid is not persisted — resets on panel collapse/expand (acceptable for now)

### 6. Keyboard navigation

Grid tiles are focusable `<button>` elements. Tab cycles through tiles in DOM order (left-to-right, top-to-bottom). Arrow keys for 2D navigation (Up/Down/Left/Right across grid cells) are **out of scope for this change** — tracked as a follow-up; Tab navigation satisfies Constitution V for now.

### 7. Active-tile tint and hover-action defaults (locked)

The following secondary design choices are locked at intake (not deferred to spec):

- **Active tile body tint**: use `rowTints.get(color).selected` for the active tile's background (the brighter "selected" variant), in addition to the accent ring. Inactive tinted tiles use `rowTints.get(color).base`. Matches the existing `SessionRow` active treatment.
- **Hover actions on mobile**: the color-picker square and kill (×) button are revealed on hover only at `pointer: fine`. On `pointer: coarse`, these actions are hidden entirely. A follow-up change may add a long-press menu for mobile — **out of scope here**.
- **Drag handle on mobile**: hidden when the horizontal-swipe layout is active (panel becomes a fixed-height single-row strip).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add a note on the tile-grid pattern for server selection, the resizable CollapsiblePanel prop, and the mobile horizontal-swipe collapse behavior
- `run-kit/architecture`: (modify) Note that `/api/servers` returns `{name, sessionCount}[]` instead of `string[]`

## Impact

**Frontend**:
- `app/frontend/src/components/sidebar/server-panel.tsx` — full rewrite of render body (props stable except `servers` shape)
- `app/frontend/src/components/sidebar/collapsible-panel.tsx` — new opt-in `resizable`/`minHeight`/`maxHeight`/`defaultHeight` props, drag-handle rendering, localStorage height persistence
- `app/frontend/src/components/sidebar/index.tsx` — wire through new `ServerInfo[]` shape to `ServerPanel`
- `app/frontend/src/api/client.ts` — update `getServers()` return type
- `app/frontend/src/types.ts` (or wherever server types live) — add `ServerInfo`
- `app/frontend/src/app.tsx` / consumer of `getServers()` — consume new shape
- Tests: `server-panel.test.tsx` (new tile grid, active state, hover actions, mobile layout), `collapsible-panel.test.tsx` (resize drag behavior, height persistence, graceful degrade when `resizable={false}`)
- Playwright e2e: new `.spec.md` companion for server-panel interactions (select server, resize panel, mobile swipe)

**Backend**:
- `app/backend/api/` — extend servers handler to include session counts per server (use `internal/tmux/` helper)
- `app/backend/internal/tmux/` — add or reuse a `SessionCount(server string)` helper using `exec.CommandContext` with timeout (per Constitution I)
- Tests: Go tests for the new handler shape and the tmux helper

**Out of scope**:
- Window/Host panel redesigns
- Server create/kill flow changes (reuse existing `onCreateServer`, `onKillServer`)
- Theme/palette changes — reuse `computeRowTints` and `serverColors`
- Arrow-key 2D grid navigation (Tab-only for this change)

## Open Questions

None at intake — key secondary choices were locked in the `## What Changes` section. Any ambiguities discovered during spec drafting will be surfaced there.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace `ServerPanel` list body with a CSS grid of tile buttons (Mock A). Header/footer structure unchanged. | Discussed — user explicitly chose "Option A" after viewing three mocks. | S:98 R:70 A:85 D:95 |
| 2 | Certain | Extend `/api/servers` response with `sessionCount` per server instead of fetching counts lazily per-tile. | Discussed — user explicitly answered "Add counts to the endpoint" when asked. | S:95 R:65 A:85 D:95 |
| 3 | Certain | Fully replace the existing vertical-list UI — no density toggle, no alternate mode. | Discussed — user explicitly answered "replace" when asked. | S:95 R:60 A:85 D:95 |
| 4 | Certain | Add a `resizable` opt-in prop to `CollapsiblePanel` rather than inlining resize logic in `ServerPanel` only. | Discussed — user explicitly answered "Standardize" when asked. | S:90 R:60 A:85 D:90 |
| 5 | Certain | Mobile layout collapses to a single horizontal row with `overflow-x: auto` swipe + scroll-snap; tap to select. | Discussed — user explicitly described this approach as a simplification. | S:90 R:75 A:80 D:90 |
| 6 | Certain | Reuse `computeRowTints`, `serverColors`, `getAllServerColors`, `setServerColor` — no palette work. | Constitution VII (Convention Over Configuration); user marked theme/palette changes out of scope. | S:95 R:85 A:95 D:98 |
| 7 | Certain | Tile structure: 4px colored top stripe, 11px bold truncated name, 10px secondary meta line ("N sess"). | Directly follows from Mock A that user approved; HTML/CSS were shown verbatim in the preview. | S:90 R:75 A:85 D:90 |
| 8 | Certain | Grid uses `repeat(auto-fill, minmax(72px, 1fr))` — auto-fill columns, tiles expand to fill width. | Directly from Mock A as approved; user asked for "boxes should expand to take the full width". | S:90 R:80 A:85 D:90 |
| 9 | Certain | Persist resize height to `localStorage` under `${storageKey}-height` key pattern. | Determined by the existing `readPersistedState` pattern already in `CollapsiblePanel` — matches codebase convention. | S:90 R:80 A:95 D:95 |
| 10 | Certain | Default `ServerPanel` height low (~140px); grid scrolls internally; user drags to expand. | User stated verbatim: "the panel's default height can be low. The user should be able to scroll the server list independently." | S:95 R:85 A:85 D:90 |
| 11 | Certain | Active state = accent ring (inset box-shadow) + `rowTints.get(color).selected` tint on tile body. | Active treatment shown in Mock A + consistent with existing `SessionRow` active styling. | S:90 R:80 A:85 D:90 |
| 12 | Certain | Backend `sessionCount` via `exec.CommandContext` with timeout calling `tmux -L <server> list-sessions`; errors → 0. | Determined by Constitution I (all subprocess calls use `exec.CommandContext` with timeouts) + existing `internal/tmux/` patterns. | S:90 R:75 A:95 D:90 |
| 13 | Confident | Drag handle is a 6px bottom strip with `cursor: ns-resize`; min 80px, max `calc(100vh - 120px)`. | Mock-sketch values; standard resize-handle pattern. May refine exact pixel values during apply. | S:75 R:80 A:70 D:75 |
| 14 | Confident | Mobile gated via `@media (pointer: coarse), (max-width: 639px)`. | Matches the sidebar's existing mobile treatment (640px breakpoint, coarse-pointer handling) per `fab/project/context.md`. | S:75 R:75 A:80 D:75 |
| 15 | Confident | Hover-revealed `.actions` (color picker + kill) shown only at `pointer: fine`; hidden on coarse — no long-press menu this change. | Deferring mobile action affordance keeps scope small; follow-up if user feedback demands it. | S:70 R:70 A:70 D:75 |
| 16 | Confident | Arrow-key 2D grid navigation deferred; Tab-only nav this change satisfies Constitution V. | Constitution V ("reachable via keyboard") is satisfied by Tab; 2D arrow nav is an enhancement, not a blocker. | S:70 R:75 A:70 D:70 |
| 17 | Confident | Drag handle hidden on mobile (fixed-height single-row strip, no resize needed). | Follows from the single-row mobile layout — a drag handle would have nothing meaningful to resize vertically. | S:75 R:80 A:75 D:80 |

17 assumptions (12 certain, 5 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
