# Intake: Sidebar Keyboard Navigation (Wave 3)

**Change**: 260613-wt1v-sidebar-keyboard-nav
**Created**: 2026-06-13

## Origin

> Sidebar improvements WAVE 3 — sidebar-keyboard-nav (from backlog wt1v). Depends on Wave 2 (sidebar-render-perf, #262) which is MERGED to main — builds on the now-memoized rows with stabilized props. CORRECTED FRAMING (important): the backlog's claim that "there is no keyboard way to switch windows" is INACCURATE — the command palette already switches windows via terminalActions (relabeled to "Window: Switch to ..." by change 260613-o20f-palette-window-switch, #260, merged). Do NOT scope this change to palette window-switching. Scope is exactly two paired concerns on the sidebar tree DOM: (1) Roving-tabindex arrow-key navigation scoped to the focused tree `<nav aria-label=Sessions>`: Up/Down across visible rows, Left/Right collapse/expand the session group, Enter selects, Home/End jump — mirror the existing roving pattern used by CommandPalette/ThemeSelector. Handlers live on the sidebar nav, NOT the terminal, so no xterm key conflict. (2) Tree ARIA: add role=tree/treeitem/group, aria-level/aria-setsize/aria-posinset, and associate the session chevron's aria-expanded with the window list via aria-controls. Files: index.tsx (nav keydown + roving index state), window-row.tsx + session-row.tsx (tabindex/roles). This closes a constitution V (keyboard-first) gap.

**Interaction mode**: one-shot `/fab-new` from a corrected backlog entry. No prior `/fab-discuss` session. The invocation carries one explicit scoping decision (the "CORRECTED FRAMING" above), which is encoded as a Certain assumption below.

**Backlog source** (`fab/backlog.md` `[wt1v]`): "Make the session/window tree keyboard-navigable and screen-reader-correct — a constitution V (keyboard-first) gap: there is ZERO arrow-key traversal anywhere in sidebar/ today (no keydown handlers beyond rename-input + pin Escape), so the only keyboard path into the tree is the command palette. … COORDINATION: land after Wave 2 (builds on memoized rows with stabilized props; doing it before forces re-touching keyboard wiring when D stabilizes closures). NOTE: materially easier if the index.tsx god-orchestrator (1271 lines) is extracted into hooks first — out of scope for these 3 waves but flagged."

**Gap-analysis result** (confirmed at intake-time): `grep` over `app/frontend/src/components/sidebar/` finds **no** `ArrowUp/Down/Left/Right`, `Home`, or `End` handling, and **no** `role="tree"|"treeitem"|"group"`, `aria-level`, `aria-setsize`, `aria-posinset`, or `aria-controls`. The only `onKeyDown` in the directory is on the two rename `<input>`s (Enter/Escape commit/cancel) and the `PinPopover` Escape handler. The backlog's "ZERO arrow-key traversal" claim is accurate for the tree DOM. The change is **not** covered by any existing mechanism.

**Wave-2 dependency is satisfied**: `#262` (`260613-ect6-sidebar-render-perf`) is merged to `main` (commit `f0fb683`). `WindowRow`, `SessionRow`, and `ServerGroup` are each `memo(...Inner)` with identity-arg `useCallback` handlers and stable context props. **Line numbers in the original backlog/args are pre-Wave-2 and have drifted** — verified current anchors below.

**Verified current source anchors** (post-Wave-2, the numbers this change works against — NOT the stale backlog numbers):

| Backlog said | Actual (current) | What lives there |
|---|---|---|
| `index.tsx:700` (`<nav aria-label=Sessions>`) | `index.tsx:783` | The `<nav ref={navRef} aria-label="Sessions">` root |
| `session-row.tsx:95` (chevron `aria-expanded`) | `session-row.tsx:109-122` | The chevron toggle `<button>` carrying `aria-expanded={!isCollapsed}` |
| `index.tsx:907` (`nowSeconds`) | n/a | `nowSeconds` prop was **removed** by Wave 2 — do not reintroduce |

## Why

1. **Problem (the pain point)**: The sidebar session/window tree (`app/frontend/src/components/sidebar/`) is reachable by mouse only. There is no arrow-key traversal of rows, no keyboard collapse/expand of a session group, and the rows are announced to screen readers as an undifferentiated pile of `<button>`s with no tree structure (no `role="tree"`, no level/position metadata, no expanded↔controlled-region association). A keyboard or screen-reader user can `Tab` through every focusable control in DOM order (chevron, name, +, ✕, pin, swatch, kill — many controls per row) but cannot move *between rows* with the Up/Down/Left/Right mental model every tree UI affords.

2. **Consequence of not fixing**: This is a **Constitution V (Keyboard-First)** violation: *"Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary."* The session tree is the sidebar's core navigation surface; today its only keyboard path is the command palette (`Cmd+K` → "Window: Switch to …"), which is a fuzzy-search jump, not spatial traversal. Screen-reader users get no tree semantics at all. The gap persists indefinitely and compounds as the tree grows (multi-server, many sessions/windows).

3. **Why this approach over alternatives**:
   - **Roving tabindex on the nav, not per-row component focus management** — keeps the keyboard state (which row is "focused" in the roving sense) in the orchestrator (`index.tsx`), which already owns all tree state. The rows stay `memo`'d presentational components that merely receive a `tabIndex` (and ARIA) prop. This respects the Wave-2 memo tree: a roving-index change re-renders only the two affected rows (old + new focused), not the whole tree.
   - **Handlers on `<nav>`, not the terminal / not `document`** — the backlog is explicit that handlers live on the sidebar nav. xterm.js owns terminal keystrokes (`attachCustomKeyEventHandler`); a `document`-level arrow listener would conflict and the project deliberately avoids single-key/global shortcuts (see ui-patterns "No single-key shortcuts … these conflicted with xterm.js terminal input"). Scoping `onKeyDown` to the focused `<nav>` subtree means arrows only act when focus is inside the tree — zero terminal conflict.
   - **W3C APG Tree pattern** — `role="tree"` with `treeitem`/`group` and roving `tabIndex` is the standard, screen-reader-tested semantics for exactly this widget (a disclosure tree of sessions → windows). Reusing the standard avoids inventing bespoke ARIA.

## What Changes

This is a frontend-only, two-part change on the sidebar tree DOM. No backend, no API, no new routes (Constitution IV preserved). Three files change: `index.tsx` (keyboard state + nav keydown + ARIA wiring on the rendered tree), `session-row.tsx` (treeitem role/tabindex/aria-controls on the session header), `window-row.tsx` (treeitem role/tabindex on the window row). Companion unit-test files (`session-row.test.tsx`, `window-row.test.tsx`, `index.test.tsx`) are updated; a Playwright spec + `.spec.md` companion is added (Constitution Test Companion Docs).

### Part 1 — Roving-tabindex arrow-key navigation

**Where**: The `<nav ref={navRef} aria-label="Sessions">` (`index.tsx:783`). An `onKeyDown` handler is added to the **session-tree container** — specifically the scrollable Sessions region (`index.tsx:825`, the `<div className="flex-1 min-h-0 overflow-y-auto">` that wraps the `ServerGroup`s), or the `<nav>` with an early-out that ignores events originating from outside the tree (Boards section, Server panel, rename `<input>`s, popovers). The handler does **not** attach to `document` and does **not** touch the terminal.

**The "visible rows" model**: Keyboard traversal walks the flattened list of currently-visible tree rows, in DOM order:
- A **server group header** is a row only when there are multiple servers / it is a meaningful stop. (See Open Question — whether the server header participates as a treeitem or is a structural wrapper.)
- A **session header row** (`SessionRow`) is always a visible row when its server group is open.
- A **window row** (`WindowRow`) is a visible row only when its parent session is **not** collapsed (`!isCollapsed`) AND its parent server group is open. Collapsed sessions hide their windows from traversal entirely.
- **Boards rows and Server-panel tiles are excluded** — traversal is scoped to the session tree, mirroring the existing `[data-window-id]`-scoped exclusion the mobile-drawer focus effect already uses (`index.tsx:736`: the BoardsSection active row carries `aria-current="page"` but has no `[data-window-id]` ancestor, so it is excluded). The keyboard model uses the same "session tree only" boundary.

**Key bindings** (active only while focus is within the tree; each `preventDefault()`s to stop page scroll):

| Key | Action |
|-----|--------|
| `ArrowDown` | Move roving focus to the next visible row. **Stops at the last row — no wrap.** Flows **continuously across open server groups** (last row of server A → first row of server B) as one flat visible-rows list. |
| `ArrowUp` | Move roving focus to the previous visible row. **Stops at the first row — no wrap.** Same continuous cross-group flow upward. |
| `ArrowRight` | On a **collapsed session row**: expand it (`toggleSession`). On an already-expanded session row: move to its first window child. On a window row: no-op (leaf). |
| `ArrowLeft` | On an **expanded session row**: collapse it (`toggleSession`). On a window row: move roving focus to its parent session row. On a **collapsed session row: no-op** (the server header is a structural wrapper, not a treeitem — there is no parent treeitem to move to). |
| `Enter` **and** `Space` | Activate the focused row: a window row fires `onSelectWindow(server, session, windowId)`; a session row fires its select-first-window action (`onSelectFirstWindow`). Both keys activate (W3C APG tree convention). |
| `Home` | Jump roving focus to the first visible row (across all open groups). |
| `End` | Jump roving focus to the last visible row (across all open groups). |

This **mirrors the W3C APG Tree View** semantics — stop (no wrap), continuous traversal, Enter/Space activation, Left/Right collapse/expand — which is also what the backlog's "Left/Right collapse/expand the session group" describes. (Decided at intake: see Assumption #11.)

**Roving state mechanism** (mirrors CommandPalette/ThemeSelector "Keyboard-Navigable List Scroll Pattern", `ui-patterns.md:715`): a `selectedIndex`-style state in `index.tsx` tracks the focused row's position in the flattened visible-rows list. Exactly **one** row in the tree carries `tabIndex={0}` (the roving-focused row); every other row carries `tabIndex={-1}`. On an arrow keypress the handler computes the next index, updates state, and imperatively `focus()`es the DOM node for the new row (queried by its stable handle — window rows already expose `[data-window-id]`; session rows get an analogous stable handle). A `useEffect` on `[selectedIndex]` `scrollIntoView({ block: "nearest" })`s the focused row so it stays visible past the scroll boundary — the exact pattern `CommandPalette`/`ThemeSelector` use (`listRef` + `[aria-selected]`/`[tabindex="0"]` query + `scrollIntoView`).

**Interaction with the Wave-2 memo tree** (load-bearing): the `tabIndex` value becomes a per-row prop. Because only two rows change `tabIndex` per arrow press (old focused → `-1`, new focused → `0`), only those two `memo`'d rows re-render — the rest of the tree skips. The roving state is **separate** from the existing `isSelected`/`aria-current="page"` selection (which keys on the URL window id): roving focus is "where the keyboard cursor is"; selection is "which window the URL points at". They are independent and may differ (you can rove past rows without selecting them, then `Enter` to select). Do **not** reuse `isSelected` for the roving index.

**Interaction with inline rename**: when a row is in rename mode (its `<input>` is focused), the tree `onKeyDown` must **not** hijack arrows — the existing rename `onKeyDown` (Enter commits / Escape cancels) keeps working, and arrows move the text caret. The handler early-returns when `e.target` is an `<input>` (or `document.activeElement` is an editable element).

### Part 2 — Tree ARIA

**Tree depth** (decided at intake — Assumption #10): a **two-level tree**. The per-server `ServerGroup` `<section>` header stays a **structural wrapper**, NOT a treeitem; its existing collapse/expand button (`index.tsx:1128`) remains mouse/Tab-button only. Sessions are level 1, windows level 2.

**Roles** (W3C APG disclosure tree):
- The tree container — the scrollable Sessions region wrapping the `ServerGroup`s (`index.tsx:825`, `<div className="flex-1 min-h-0 overflow-y-auto">`) — gets `role="tree"`. The `<nav aria-label="Sessions">` stays as the landmark; `role="tree"` goes on the inner list container so the `<nav>` landmark and the tree widget don't collide on one element.
- Each **session header row** (`SessionRow`) becomes a `role="treeitem"` at `aria-level="1"` with `aria-expanded={!isCollapsed}`. **Today the chevron `<button>` already carries `aria-expanded`** (`session-row.tsx:112`); Part 2 lifts/duplicates that expanded-state onto the `treeitem` and adds `aria-controls` pointing at the id of the window-list container.
- Each **window row** (`WindowRow`) becomes a `role="treeitem"` at `aria-level="2"` (a leaf — no `aria-expanded`).
- The **window-list container** (the `<div className="ml-3">` that holds a session's `WindowRow`s, `index.tsx:1204`) becomes `role="group"` with a stable `id` so the session treeitem's `aria-controls` can reference it.

**Position metadata** (so screen readers announce "item 2 of 5, level 2"):
- `aria-level` — `1` for session rows, `2` for window rows.
- `aria-setsize` — the count of siblings at that level (sessions in the group; windows in the session).
- `aria-posinset` — this row's 1-based position among its siblings.

**`aria-controls` association**: the session chevron's `aria-expanded` (`session-row.tsx:112`) is associated with the window list via `aria-controls={windowGroupId}`, where `windowGroupId` is the `id` placed on the `role="group"` window-list container. This is the screen-reader contract the backlog calls for: "associate the session chevron's aria-expanded … with the window list via aria-controls."

**Example DOM shape** (single server, one session "api" with two windows; two-level tree per the decided depth):

```html
<nav aria-label="Sessions">
  <!-- ... Boards, Server panel (NOT part of the tree) ... -->
  <div role="tree" aria-label="Session tree">
    <!-- ServerGroup <section> stays a structural wrapper -->
    <div role="treeitem" aria-level="1" aria-setsize="1" aria-posinset="1"
         aria-expanded="true" aria-controls="windows-default-api"
         tabindex="-1">…session "api" header…</div>
    <div role="group" id="windows-default-api">
      <div role="treeitem" aria-level="2" aria-setsize="2" aria-posinset="1"
           tabindex="0" data-window-id="@1" aria-current="page">…window "edit"…</div>
      <div role="treeitem" aria-level="2" aria-setsize="2" aria-posinset="2"
           tabindex="-1" data-window-id="@2">…window "test"…</div>
    </div>
  </div>
</nav>
```

### Out of scope (explicit Non-Goals)

- **Palette window-switching** — already shipped by `#260` ("Window: Switch to …"). This change does **not** touch `app.tsx` / `windowActions`.
- **The `index.tsx` god-orchestrator hook-extraction** the backlog flags as "materially easier if …" — explicitly out of scope for all three sidebar waves; this change wires keyboard nav into the orchestrator as-is.
- **Drag-and-drop reordering via keyboard** — the existing mouse DnD reorder (and the derive-over-store session-order pattern from `260609-ebks`) is untouched. No keyboard "move window up/down" is added here (that lives in the palette: "Window: Move Left/Right").
- **Re-introducing any `nowSeconds` prop** removed by Wave 2.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The "## Sidebar" section — specifically "Session rows", "Window rows", and the "Current-row focus on mobile drawer open" / "Keyboard Shortcuts" subsections — gains a keyboard-navigation + tree-ARIA contract: roving `tabIndex` model, the Up/Down/Left/Right/Enter/Home/End bindings, the `role="tree"/"treeitem"/"group"` + `aria-level`/`setsize`/`posinset` structure, and the `aria-controls`↔window-group association. The "Keyboard-Navigable List Scroll Pattern" subsection (`:715`) gains the sidebar tree as a third consumer of the `scrollIntoView` pattern. (Memory written at hydrate, not now.)

## Impact

- **Code**:
  - `app/frontend/src/components/sidebar/index.tsx` — roving-index state, the flattened visible-rows derivation, the nav/tree-container `onKeyDown`, the `scrollIntoView` effect, `role="tree"`/`role="group"` + `id` wiring, and threading `tabIndex` + `aria-level`/`setsize`/`posinset` props into `SessionRow`/`WindowRow`. Must preserve the Wave-2 memo invariants (identity-arg `useCallback`s, no churning props into memo'd children) and the derive-over-store session-order pattern.
  - `app/frontend/src/components/sidebar/session-row.tsx` — accept + render `role="treeitem"`, `tabIndex`, `aria-level`/`aria-setsize`/`aria-posinset`, `aria-controls`, and lift `aria-expanded` onto the treeitem. Stays `memo`'d.
  - `app/frontend/src/components/sidebar/window-row.tsx` — accept + render `role="treeitem"`, `tabIndex`, `aria-level`/`aria-setsize`/`aria-posinset`. Stays `memo`'d. The row's `data-window-id` handle (already present) is reused as the focus target.
- **Tests**:
  - `session-row.test.tsx`, `window-row.test.tsx`, `index.test.tsx` (unit) — assert roles, tabindex roving, aria-* attributes, and that the nav keydown moves focus / toggles expansion.
  - New Playwright spec (`app/frontend/tests/sidebar-keyboard-nav.spec.ts`) + sibling `.spec.md` companion (Constitution: Test Companion Docs) covering arrow traversal, Left/Right expand-collapse, Enter-select, Home/End, and that arrows inside the terminal/rename-input are not hijacked.
- **No impact**: backend, Go code, HTTP API, SSE, tmux layer, routes, the command palette, `app.tsx`, drag-and-drop, optimistic actions.
- **Accessibility**: net-positive — adds tree semantics where there were none.
- **Performance**: net-neutral to positive — roving updates touch two memo'd rows per keypress; no new render churn on SSE ticks.

## Open Questions

_All intake-time design questions were resolved via `/fab-new` clarification (see Assumptions #10, #11):_

- **Tree depth** — RESOLVED: the per-server `ServerGroup` header stays a **structural wrapper** (two-level tree: session = level 1, window = level 2). Server collapse/expand stays mouse/Tab-button only for v1. `<!-- clarified: server header is a wrapper, not a treeitem — two-level tree, user chose simpler v1 over 3-level server-as-treeitem -->`
- **End-of-list + activation** — RESOLVED to the **W3C APG standard**: ArrowUp/Down **stop** at the ends (no wrap); traversal flows **continuously across all open server groups** as one flat visible-rows list; **both Enter and Space** activate. `<!-- clarified: APG-standard nav — stop (no wrap), continuous cross-group flow, Enter+Space activate; user chose over wrap+Enter-only -->`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the two tree-DOM concerns (roving arrow nav + tree ARIA); palette window-switching (#260) is explicitly out of scope — do NOT touch app.tsx/windowActions. | Stated verbatim as "CORRECTED FRAMING" in the invocation; #260 is merged. Config/constitution confirm the keyboard-first gap is the tree, not the palette. | S:98 R:75 A:90 D:95 |
| 2 | Certain | Frontend-only; no backend/API/route/tmux changes (Constitution II/IV/IX untouched). | The feature is pure client-side DOM/ARIA + keydown; no state to derive from tmux, no new endpoints. Constitution IV (minimal surface) preserved — no new route. | S:95 R:80 A:95 D:95 |
| 3 | Certain | Keyboard handlers attach to the sidebar nav/tree container, never to `document` or the terminal — no xterm.js conflict. | Backlog + args both state this explicitly; ui-patterns records that single-key/global shortcuts were removed because they conflicted with xterm.js. | S:95 R:75 A:95 D:90 |
| 4 | Certain | Use the W3C APG disclosure-Tree pattern: `role="tree"/"treeitem"/"group"`, roving `tabIndex` (one `0`, rest `-1`), `aria-level`/`aria-setsize`/`aria-posinset`, `aria-controls` from the session row to its `role="group"` window list. | The backlog enumerates every one of these attributes verbatim — this is spec-determined, not an interpretation. APG Tree is the standard, screen-reader-tested semantics for a session→window disclosure tree. | S:95 R:72 A:92 D:90 |
| 5 | Confident | Roving-focus state lives in `index.tsx` as a `selectedIndex`-style state over a flattened visible-rows list, threaded to `memo`'d rows as a `tabIndex` prop; reuse the CommandPalette/ThemeSelector `listRef` + `scrollIntoView({block:"nearest"})` pattern. | ui-patterns "Keyboard-Navigable List Scroll Pattern" (`:715`) is the named project convention; index.tsx already owns all tree state; keeps Wave-2 memo intact (only 2 rows re-render per keypress). | S:85 R:65 A:85 D:78 |
| 6 | Confident | Line numbers in the backlog/args are pre-Wave-2 and have drifted; work against verified current anchors (`<nav>` at index.tsx:783, chevron aria-expanded at session-row.tsx:112) — Wave 2 (#262) is merged on main. | Direct file reads confirm the drift and the merged memo tree (commit f0fb683). The stale numbers would misdirect apply. | S:90 R:80 A:95 D:85 |
| 7 | Confident | Roving focus is independent of URL-based selection (`isSelected`/`aria-current="page"`); do NOT reuse the selection state as the roving index. | ui-patterns documents single-source `isSelected` keyed on the URL window id; roving focus is a distinct "keyboard cursor" concept (you rove without selecting, then Enter to select). Conflating them would light up wrong rows. | S:80 R:70 A:88 D:80 |
| 8 | Confident | Traversal scopes to the session tree only — Boards rows and Server-panel tiles are excluded — mirroring the existing `[data-window-id]`-scoped boundary. | The mobile-drawer focus effect (index.tsx:736) already uses exactly this exclusion (BoardsSection active row has aria-current but no [data-window-id] ancestor). Reusing the established boundary. | S:82 R:72 A:85 D:78 |
| 9 | Confident | Collapsed-session windows are excluded from the visible-rows traversal list (Down skips a collapsed session's hidden windows); the rename `<input>` early-returns so arrows move the caret, not the tree. | Standard tree semantics (collapsed children are not navigable) + the existing rename onKeyDown contract (Enter/Escape) must keep working. One obvious interpretation. | S:80 R:68 A:82 D:80 |
| 10 | Certain | Server-group header stays a structural wrapper (two-level tree: session=level 1, window=level 2); server collapse/expand remains mouse/Tab-button only for v1. | RESOLVED at intake — user explicitly chose "Wrapper (2-level tree)" over server-as-treeitem (3-level). No remaining ambiguity. | S:97 R:62 A:95 D:97 |
| 11 | Certain | ArrowDown/Up stop at the ends (no wrap); traversal flows continuously across all open server groups as one flat list; Enter AND Space both activate. | RESOLVED at intake — user explicitly chose "APG standard" over wrap+Enter-only. No remaining ambiguity; matches W3C APG Tree View. | S:97 R:66 A:95 D:97 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
