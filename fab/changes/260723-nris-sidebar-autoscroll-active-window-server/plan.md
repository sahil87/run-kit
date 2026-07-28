# Plan: Sidebar Autoscroll to Active Window and Active Server

**Change**: 260723-nris-sidebar-autoscroll-active-window-server
**Intake**: `intake.md`

## Requirements

### Sidebar: Server panel active-tile autoscroll

#### R1: Server panel scrolls the active tile into view on all layouts
The mount/server-change scroll effect in `app/frontend/src/components/sidebar/server-panel.tsx` (lines 91–97) SHALL apply on desktop as well as mobile: the `if (!isMobile) return;` gate MUST be removed, and nothing else about the effect's behavior may change. The single `scrollIntoView({ block: "nearest", inline: "nearest" })` call serves both layouts (vertical for the desktop tile grid inside the resizable CollapsiblePanel, horizontal for the mobile single-row layout). The `typeof el.scrollIntoView !== "function"` jsdom guard MUST stay. The effect MUST continue to re-run when `server` changes.

- **GIVEN** a desktop viewport with enough server tiles that the active tile sits below the ServerPanel's internal scrollport
- **WHEN** the panel mounts or the active `server` changes
- **THEN** `scrollIntoView({ block: "nearest", inline: "nearest" })` is called on the active tile so it becomes visible

- **GIVEN** a mobile viewport (single-row horizontal tile strip)
- **WHEN** the panel mounts
- **THEN** the active tile is scrolled into view exactly as before this change (behavior preserved)

### Sidebar: Sessions pane selected-row autoscroll (desktop)

#### R2: Selection-keyed, scroll-only effect on the sessions tree
`app/frontend/src/components/sidebar/index.tsx` SHALL gain a NEW effect — alongside, not replacing, the existing mobile drawer-open effect (index.tsx:770–793, which stays byte-unchanged in behavior) — keyed on the selected window identity `${currentServer}:${currentWindowId}`. When the selection identity changes, the effect queries `navRef.current?.querySelector('[data-window-id] [aria-current="page"]')` (the same scoped selector the mobile effect uses — excludes the active BoardsSection row, which has no `[data-window-id]` ancestor) and calls `scrollIntoView({ block: "nearest" })` on the row. The effect is scroll-only: it MUST NOT call `focus()` (focus-steal on desktop would break terminal typing) and MUST NOT touch `rovingKey` or any roving/focus state. The `typeof row.scrollIntoView === "function"` jsdom guard MUST be kept.

- **GIVEN** a desktop viewport with the selected window's row below the fold of the `role="tree"` scroll container
- **WHEN** the selected window identity changes (click, palette, deep link)
- **THEN** the selected row's `[aria-current="page"]` button is scrolled into view with `block: "nearest"`
- **AND** `document.activeElement` is unchanged and `rovingKey` is unchanged

#### R3: Pending-scroll retry rides `rowsVersion`; never fires on passive SSE ticks
The effect SHALL implement the row-not-rendered-yet retry (deep-link load: route resolves before SSE data lands) via a pending-scroll ref: armed when the selected window identity changes, cleared once the row is found and scrolled. The retry trigger is the existing `rowsVersion` counter (index.tsx:821 — bumped ONLY when a group's visible-row set signature changes: add/remove, collapse/expand, rename). The scroll MUST happen at most once per selection change and MUST NOT fire on passive SSE activity ticks (Wave-2 #262 invariant: passive ticks change no roving/focus/scroll state).

- **GIVEN** a direct URL load of `/$server/$window` before the SSE snapshot has rendered any rows
- **WHEN** the rows render and `rowsVersion` bumps
- **THEN** the selected row is scrolled into view once, and the pending ref is cleared

- **GIVEN** the selected row was already scrolled (pending ref cleared)
- **WHEN** passive SSE ticks re-render the tree, or `rowsVersion` bumps for an unrelated visible-set change
- **THEN** no further `scrollIntoView` call is made for that selection

#### R4: Null/hidden selection is a no-op
When the selected row is not queryable, the effect SHALL no-op without side effects: (a) collapsed session/server group — the row is not in the DOM; the effect MUST NOT auto-expand the group (rejected: fights the user's explicit collapse); (b) no selection identity (`currentServer` or `currentWindowId` is `null` — board route, or a server route before the URL carries a window segment) — the effect stays disarmed.

- **GIVEN** the selected window's group is collapsed
- **WHEN** the selection-keyed effect runs
- **THEN** no scroll occurs and no group is expanded

- **GIVEN** the board route (`currentServer === null`) or a `/$server` dashboard route (`currentWindowId === null`)
- **WHEN** the sidebar renders
- **THEN** the new effect performs no query-and-scroll work

### Sidebar: Regression guardrails

#### R5: Existing behaviors preserved
The existing mobile drawer-open scroll+focus effect (index.tsx:770–793, including its `setRovingKey` sync and rAF deferral) SHALL be unchanged. The following e2e specs MUST NOT regress: `sidebar-window-sync.spec.ts`, `server-panel-grid.spec.ts`, `mobile-layout.spec.ts`, `top-bar-overlap.spec.ts` (its line 267 comment references the mobile focus-on-open scrollIntoView dragging nav content — the desktop scroll must not recreate that overlap).

- **GIVEN** the full frontend unit suite and the four named e2e specs
- **WHEN** run after the change
- **THEN** all pass

### Non-Goals

- Auto-expanding a collapsed group to reveal the selected row — explicitly rejected in the intake.
- Syncing `rovingKey` from the desktop autoscroll — scroll-only; the mobile drawer effect keeps its existing sync (it moves focus, so it must sync).
- Re-scrolling when the desktop sidebar is collapsed/reopened — the effect keys on selection identity, not sidebar visibility (intake assumption 7).
- New scroll infrastructure — both fixes reuse existing refs, markers, and counters.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Remove the `if (!isMobile) return;` gate from the mount/server-change scroll effect in `app/frontend/src/components/sidebar/server-panel.tsx` (lines 91–97); keep the `typeof el.scrollIntoView !== "function"` guard; narrow the deps to `[server]` (the effect no longer reads `isMobile`); update the comment to say the scroll applies to both layouts <!-- R1 -->
- [x] T002 Add the selection-keyed, scroll-only autoscroll effect with a pending-scroll ref to `app/frontend/src/components/sidebar/index.tsx`: keyed on `${currentServer}:${currentWindowId}` (null-disarmed), queries `[data-window-id] [aria-current="page"]` under `navRef`, `scrollIntoView({ block: "nearest" })`, retried on `rowsVersion`, no `focus()`, no `rovingKey` writes, jsdom guard kept <!-- R2, R3, R4 -->

### Phase 2: Tests

- [x] T003 [P] Unit tests in `app/frontend/src/components/sidebar/server-panel.test.tsx`: desktop (default matchMedia stub) scrolls the active tile on mount and again when `server` changes; spy on `scrollIntoView` via the element/prototype <!-- R1 -->
- [x] T004 [P] Unit tests in `app/frontend/src/components/sidebar/index.test.tsx` (desktop, non-mobile stub): (a) selection change scrolls the `[data-window-id] [aria-current="page"]` row without moving `document.activeElement`; (b) passive SSE tick (changed sessions Map, same row set) after a completed scroll triggers no further scroll; (c) deep-link retry — render with a selection whose row is absent, then deliver sessions (rowsVersion bump) and assert exactly one scroll; (d) collapsed group → no scroll, group stays collapsed; (e) roving tab stop (`tabindex="0"` row) unchanged by the autoscroll <!-- R2, R3, R4 -->
- [x] T005 New e2e spec `app/frontend/tests/e2e/sidebar-autoscroll.spec.ts` + sibling companion `sidebar-autoscroll.spec.md` (constitution § Test Companion Docs): create a session with enough windows to overflow the tree scrollport, deep-link to the last window, assert the selected row is inside the `role="tree"` container's visible bounds (and the tree actually scrolled) <!-- R2, R3 -->

### Phase 3: Verification

- [x] T006 Run the verification gates: `just test-frontend` (full Vitest), `npx tsc --noEmit` in `app/frontend`, then `just pw test sidebar-autoscroll sidebar-window-sync server-panel-grid mobile-layout top-bar-overlap` for the new spec plus the four no-regress specs <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The ServerPanel active tile is scrolled into view on mount and on `server` change on desktop layouts (gate removed), with the jsdom guard intact
- [x] A-002 R2: A selection-identity change scrolls the selected window row (`[data-window-id] [aria-current="page"]`) into view with `block: "nearest"`, with no `focus()` call and no `rovingKey` write
- [x] A-003 R3: The deep-link case scrolls once after rows render (pending ref + `rowsVersion` retry), and no scroll fires on passive SSE ticks or after the pending ref is cleared

### Behavioral Correctness

- [x] A-004 R1: Mobile ServerPanel single-row scroll behavior is unchanged (same call, same trigger)
- [x] A-005 R4: Collapsed group containing the selected window → no scroll and no auto-expand; null selection (board route / no URL window segment) → effect disarmed

### Scenario Coverage

- [x] A-006 R2: Unit tests cover the desktop scroll-no-focus scenario in `index.test.tsx`, and desktop tile scroll in `server-panel.test.tsx` (scrollIntoView spies)
- [x] A-007 R3: A unit test proves at-most-one-scroll-per-selection under a passive SSE tick re-render, and the deep-link retry path
- [x] A-008 R2: E2e `sidebar-autoscroll.spec.ts` proves the deep-link row lands inside the tree scrollport, with its `.spec.md` companion updated in the same change

### Edge Cases & Error Handling

- [x] A-009 R4: With the selected row absent from the DOM (collapsed group), repeated `rowsVersion` bumps cause no errors and no scroll until the row exists

### Code Quality

- [x] A-010 Pattern consistency: The new effect follows the existing sidebar effect idioms (scoped `navRef` querySelector, jsdom `typeof scrollIntoView` guard, `rowsVersion` gating comment style referencing the #262 invariant)
- [x] A-011 No unnecessary duplication: No new scroll infrastructure — reuses `navRef`, the `aria-current="page"` marker, `rowsVersion`, and the existing `scrollIntoView` guard pattern
- [x] A-012 No client polling: The retry mechanism is the existing `rowsVersion` counter — no `setInterval`/timers introduced
- [x] A-013 Tests included: New behavior is covered by colocated Vitest tests and an e2e spec per code-quality.md; the four named adjacent e2e specs still pass (the sole e2e failure, `sidebar-window-sync.spec.ts:254`, is PRE-EXISTING — verified failing on clean base 42d2f18 with the source changes stashed — and unrelated to this scroll-only change)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (a desktop selection-keyed scroll effect in `index.tsx` plus a widened server-panel mount effect) without making existing code redundant. The `if (!isMobile) return;` removal in `server-panel.tsx:92` widens an existing path rather than deleting one; the mobile drawer effect (`index.tsx:770-793`) is intentionally retained (it scroll+focus+roving-syncs — a distinct contract from the new scroll-only effect).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Effect shape: one effect with deps `[selectionKey, rowsVersion]` plus a last-seen-selection ref to distinguish "selection changed → arm pending" from "rowsVersion bumped → retry if pending" | Intake specifies the pending ref + `rowsVersion` retry but not the exact hook wiring; a single effect keyed on both is the minimal shape that satisfies "once per selection, never on passive ticks" | S:60 R:90 A:85 D:75 |
| 2 | Confident | A pending scroll stays armed while the selected row is hidden (collapsed group / rows not yet loaded); a later `rowsVersion` bump that reveals the row completes the one deferred scroll | The intake's collapsed-group "no-op" forbids auto-expand and immediate scroll; the deep-link retry mechanism (same pending ref) inherently fires when the row later appears — treating expand-reveal like data-arrival keeps one mechanism | S:55 R:85 A:80 D:70 |
| 3 | Confident | Server-panel effect deps narrow from `[isMobile, server]` to `[server]` after the gate removal | `isMobile` is no longer read inside the effect; keeping it would re-run the scroll on viewport crossings, which nothing in the intake asks for | S:45 R:90 A:85 D:75 |
| 4 | Confident | Desktop scroll is called synchronously in the effect (no `requestAnimationFrame` deferral) | The mobile effect defers only to beat the focus trap's mount-focus race; the desktop effect never focuses, so there is no race to win | S:50 R:90 A:85 D:80 |
| 5 | Confident | E2e scope: one new spec for the sessions-pane deep-link case; the ServerPanel desktop tile scroll is unit-tested only | The e2e harness runs a single tmux test server (`rk-test-e2e`), so overflowing the server-tile grid isn't reachable; the sessions tree overflows trivially with many windows | S:55 R:85 A:80 D:70 |
| 6 | Confident | No selection identity (`currentServer` or `currentWindowId` null) disarms the effect entirely — including the `/$server` dashboard case where a row may still show `aria-current` via the `isActiveWindow` fallback | Intake keys the effect on `${server}:${windowId}` (the URL window identity); the fallback-highlight case converges to a URL window id within a render via the app's writeback effect, which then arms the effect normally | S:50 R:85 A:75 D:65 |

6 assumptions (0 certain, 6 confident, 0 tentative).
