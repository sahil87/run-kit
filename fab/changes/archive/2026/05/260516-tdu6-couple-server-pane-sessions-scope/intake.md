# Intake: Couple Server Pane expand state with Sessions Pane server scope

**Change**: 260516-tdu6-couple-server-pane-sessions-scope
**Created**: 2026-05-17
**Status**: Draft

## Origin

This change was initiated via `/fab-proceed` from a multi-turn discussion about sidebar information architecture. The user observed that the Server Pane and the Sessions Pane both enumerate the same list of servers — the Server Pane shows server tiles (name + session count + color stripe) and the Sessions Pane shows one `ServerGroup` (L1) per server with its session tree underneath. That duplication is undesirable: there are two surfaces to "see all servers" and two surfaces to "switch servers", and they can drift in subtle ways (e.g., sort order, color treatment, current-server marker).

During the discussion the user considered (and rejected) removing the Server Pane entirely. The rejection rationale: the Server Pane and the Sessions tree carry **different design intent** — the Server Pane is a cross-server overview optimized for at-a-glance recognition (name + count + color); the Sessions tree is a drill-into-current-server navigator. Both are valuable; the duplication is the problem, not the existence of either.

The conclusion reached: couple the two so the Server Pane's expand/collapse state controls whether the Sessions Pane shows all servers or only the current server. Each state has exactly one "see all servers" surface and one "switch servers" surface. No duplication.

The user verified the current behavior against the code before opening this intake (file paths and line numbers in **What Changes** below were pulled from the actual source, not paraphrased).

## Why

**Problem**: Two surfaces enumerate the same data (servers from `SessionContext.servers`), with overlapping but non-identical affordances:

| Surface | Source | What it shows | Switch action |
|---------|--------|---------------|---------------|
| Server Pane (`server-panel.tsx`) | `servers` array | Name + session count + color stripe per server, as a tile grid | Click tile |
| Sessions Pane `ServerGroup` L1 (`sidebar/index.tsx`) | Same `servers` array | Server name as collapsible group header; children are sessions/windows | Expand non-current group, click a window inside |

Two routes to the same outcome create cognitive load (which one do I use?) and maintenance drag (every time we change one, we have to ask whether the other should match). The current state is the worst of both worlds: the duplication is visible, but the two surfaces aren't fully equivalent — the Server Pane shows session counts and color stripes the tree doesn't, and the tree exposes session/window leaves the Server Pane doesn't.

**Consequence if not fixed**: The duplication will continue to leak into future sidebar work — every server-related feature has to be decided twice (does it go on tiles, in the tree, or both?), and inconsistencies accumulate. Concretely: the current-server marker convention had to be implemented twice (once on the active tile, once on the `ServerGroup` header), and a future hover-info-popover for servers would face the same fork.

**Why this approach over alternatives**:

1. **Remove Server Pane entirely (rejected)**: Loses the cross-server overview value — the tile grid's at-a-glance recognition (color + count) is a different cognitive task than navigating a tree. Eliminates duplication at the cost of an affordance the user wants.
2. **Remove `ServerGroup` L1 entirely (rejected without explicit discussion, but symmetric to #1)**: Would make the Sessions Pane multi-server-blind. Cross-server window navigation would have to go elsewhere or disappear. Worse than #1.
3. **Couple expand state to filter scope (chosen)**: Preserves both affordances, eliminates duplication by making them **mutually exclusive in time** — when the Server Pane is collapsed, the tree is your cross-server view; when the Server Pane is expanded, the tree narrows to current-server-only. The user always has exactly one "see all servers" and one "switch servers" surface available, never two.

The chosen approach is also the lowest-blast-radius change: no routing changes, no `SessionProvider` shape changes, no backend changes. The "Server Pane open?" signal already exists in localStorage (`runkit-panel-server`); the Sessions Pane just needs to read it and apply a conditional filter on the rendered server groups.

## What Changes

### Behavioral coupling between two existing components

The Sessions Pane (`app/frontend/src/components/sidebar/index.tsx`) conditionally filters its rendered `ServerGroup` list based on whether the Server Pane (`app/frontend/src/components/sidebar/server-panel.tsx`) is currently expanded.

**Two cases** (the only two states for the Server Pane):

1. **Server Pane collapsed** (current default, `defaultOpen={false}`):
   - Sessions Pane shows **all servers** at L1 (current behavior, unchanged).
   - User switches servers by expanding a non-current server's group in the tree, then clicking a window leaf inside.
   - This case preserves today's default first-run behavior exactly.

2. **Server Pane expanded**:
   - Sessions Pane shows **only the current server's** subtree at L1.
   - All other servers are hidden from the tree.
   - The only way to switch servers in this state is by clicking a tile in the Server Pane.

The Server Pane's open state is the **single source of truth** for which case we're in. That state already exists — it's the localStorage key `runkit-panel-server` that `CollapsiblePanel` reads via its `storageKey` prop. No new state is introduced.

### Empty state when expanded with no current server

When the Server Pane is expanded but `currentServer === null` — e.g., the route is `/` before resolution, or the previously-current server got deleted — the Sessions Pane has no subtree to filter to. In this case:

- Hide all `ServerGroup`s.
- Render an empty-state hint in the same area, prompting the user to select a server from the Server Pane above. Suggested copy (final wording can be refined in spec):

  > Select a server above to see its sessions.

  Styling should follow the existing "No sessions" empty state convention (`text-text-secondary`, centered, sized to match).

### No transition animation

When the Server Pane's expand state changes, the Sessions Pane's filter result snaps to the new state — no fade, slide, or height animation on the appearing/disappearing `ServerGroup`s. Animations on user-triggered layout changes tend to feel laggy more than smooth, and the existing `ServerGroup` collapse animations already provide enough motion vocabulary in this region.

### Per-server collapse state is preserved (dormant, not cleared)

The existing localStorage keys `runkit-panel-sessions-${server}` (one per server, tracking each group's expand/collapse state inside the tree) are **not touched** by this change.

- When the Server Pane is expanded and only the current server's group is rendered, the other servers' collapse states sit dormant in localStorage.
- When the Server Pane collapses again and all groups are rendered, each group restores from its persisted state.
- This preserves user habits: if a user had server B's group expanded before opening the Server Pane, it's still expanded when they close the Server Pane later.

### Force-open the current server's group while filtered

When the Server Pane is expanded and the Sessions Pane filters to the current server, the current server's `ServerGroup` is rendered **force-open** — i.e., its body is shown regardless of the value persisted in `runkit-panel-sessions-${currentServer}`. The persisted value is **not overwritten** by this override; it remains whatever the user last set. When the Server Pane collapses and the multi-server tree returns, the current server's group restores to its persisted state along with all the others.

Rationale: the filtered view exists specifically to show the current server's sessions/windows. Rendering only a collapsed header in that state would be a degenerate UI — the user opened the Server Pane to drill into the current server, so showing the drill-in content (rather than requiring a second click on the group header) is the expected behavior. This is a transient render-time override, not a state mutation.

### Source-of-truth reading: shared localStorage hook or context

The Sessions Pane needs to *read* the Server Pane's open state, which is currently encapsulated inside the `CollapsiblePanel` component instance. Two implementation paths:

- **Path A (preferred)**: Extract a tiny `useLocalStorageBoolean(storageKey, defaultValue)` hook (or similar) that both `CollapsiblePanel` and the Sessions Pane can call. Both stay synchronized via a `storage` event listener (already a localStorage convention) or via a small context if same-tab synchronization is needed.
- **Path B (fallback)**: Lift the Server Pane's open state into a shared context (e.g., a new `SidebarLayoutContext`) and have `CollapsiblePanel` accept controlled open state as an optional prop.

The spec stage SHOULD choose between Path A and Path B based on the smallest, most local change that achieves cross-component reactivity. Path A is preferred because it avoids new context plumbing and keeps `CollapsiblePanel` API stable for other consumers (WindowPanel, HostPanel). Same-tab reactivity is the key constraint: a `storage` event only fires across tabs, so Path A needs a custom event or a tiny pub-sub keyed on the storage key.

### Affected files (expected — final list confirmed at spec stage)

- `app/frontend/src/components/sidebar/index.tsx` — read Server Pane open state; conditionally filter the rendered `ServerGroup` array; render the empty-state hint when expanded + no current server.
- `app/frontend/src/components/sidebar/collapsible-panel.tsx` — possibly: extract or expose the open-state read path (depending on Path A vs Path B above).
- A new tiny hook file (e.g., `app/frontend/src/lib/use-local-storage-boolean.ts`) — only if Path A is chosen.
- Tests for the new conditional filter behavior (Vitest + Testing Library, colocated with `index.tsx` as `index.test.tsx` or extending `server-panel.test.tsx`). Empty-state hint and snap-not-animate behavior covered.

### Out of scope

- **Removing the Server Pane entirely**: considered and rejected (see Why §3 above).
- **Server Pane content changes** (color stripe, session count, tile grid styling, mobile single-row carousel): tracked in separate drafts, unrelated to this coupling change.
- **Routing, `SessionProvider` shape, or backend changes**: this is purely a sidebar UI layout coupling.
- **Cross-tab synchronization of the Server Pane open state**: nice-to-have, not required by this change. If Path A's implementation happens to give it for free (via the `storage` event), keep it; otherwise don't go out of the way.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add a paragraph documenting the coupling rule between Server Pane expand state and Sessions Pane server-scope filtering. The new text lives in the existing **Sidebar** section, after the **Per-server `ServerGroup`s** paragraph (`ui-patterns.md:275`) and the **Default collapse + persistence** paragraph (`ui-patterns.md:277`). It documents: (1) the two cases (collapsed → all servers, expanded → current-server-only), (2) the snap-not-animate transition, (3) the empty-state hint when expanded + no current server, (4) per-server collapse states stay dormant when filtered out, (5) the source-of-truth read path (`runkit-panel-server` localStorage key, shared with `CollapsiblePanel`).

## Impact

**Code areas touched** (frontend only):

- `app/frontend/src/components/sidebar/index.tsx` — `Sidebar` component, specifically the `ServerGroup`-rendering region around line 749 and the surrounding render logic.
- `app/frontend/src/components/sidebar/collapsible-panel.tsx` — possibly modified to expose open-state reads to siblings.
- New file: hook for cross-component localStorage-boolean reads (only if Path A chosen).
- Test files: `app/frontend/src/components/sidebar/index.test.tsx` (new or extended) and possibly `collapsible-panel.test.tsx`.

**APIs and contracts**: None affected. No backend changes, no SSE event changes, no `SessionContext` shape changes, no route shape changes.

**Dependencies**: None added or removed.

**Memory updates**: One section in `docs/memory/run-kit/ui-patterns.md` (see Affected Memory above).

**User-visible impact**:

- Users with the Server Pane collapsed (today's default): zero behavior change.
- Users who expand the Server Pane: the tree below now narrows to the current server. Switching servers is exclusively a Server Pane action. Re-collapsing the Server Pane restores the full multi-server tree.
- First-time Server-Pane-expand experience: the tree snaps from multi-server to current-server. We should verify this doesn't feel like a bug (it shouldn't — both the cause and the effect are visible in the sidebar at once).

**Test impact**: New unit tests for conditional filtering and empty-state. E2E test impact is likely small but should be audited at the spec stage — any existing Playwright test that opens the Server Pane and then asserts on the tree needs to be checked.

**Performance**: Negligible — one extra boolean read per `Sidebar` render, no extra network or computation.

## Open Questions

These are non-blocking — the chosen path is clear enough to advance. Spec stage will resolve them.

- Empty-state hint exact copy (suggested above, but spec stage can refine).
- Path A vs Path B for cross-component state reads (preference noted; spec stage decides based on API surface impact).
- Whether to add a Playwright e2e test covering "expand server pane → tree narrows → click tile → tree shows new server's tree", or rely on unit tests alone. The user's project context (`fab/project/context.md` §"Playwright-Driven Development") strongly suggests e2e is preferred for UI changes — likely yes.

## Clarifications

### Session 2026-05-17

| # | Q | Answer |
|---|---|--------|
| 12 | Force-open the current server's group when Server Pane expands, or honor its persisted collapse state? | Force-open. The override is render-time only; persisted state is not overwritten and is restored when the Server Pane collapses. |
| 13 | Hook name `useLocalStorageBoolean` at `app/frontend/src/lib/use-local-storage-boolean.ts` — fine? | Yes. Spec stage still greps for an existing equivalent first; if one exists, prefer it. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server Pane open state is the single source of truth; no new state introduced | Discussed — user explicitly chose to reuse the existing `runkit-panel-server` localStorage key | S:95 R:85 A:90 D:90 |
| 2 | Certain | Coupling rule: Server Pane collapsed → tree shows all servers; Server Pane expanded → tree shows current server only | Discussed — this is the core design choice of the change | S:98 R:60 A:90 D:95 |
| 3 | Certain | Transition is snap (no animation) when the Server Pane's expand state changes | Discussed — user explicitly chose snap to avoid laggy-feeling animation | S:95 R:90 A:90 D:90 |
| 4 | Certain | Empty-state hint shown when Server Pane is expanded but `currentServer === null` | Discussed — user explicitly called this out as the boundary case to handle | S:90 R:85 A:85 D:85 |
| 5 | Certain | Per-server collapse state (`runkit-panel-sessions-${server}`) is preserved (dormant), not cleared | Discussed — user explicitly chose preservation to keep user habits intact | S:95 R:90 A:90 D:90 |
| 6 | Certain | Server Pane is not removed; tile grid contents (color stripe, count, styling) unchanged | Discussed — alternative was considered and explicitly rejected | S:98 R:85 A:95 D:95 |
| 7 | Certain | No routing, `SessionProvider`, or backend changes | Discussed — scope explicitly bounded to sidebar UI coupling | S:95 R:80 A:95 D:95 |
| 8 | Confident | Path A (shared `useLocalStorageBoolean` hook) is preferred over Path B (context plumbing) for cross-component reactivity | Codebase signal: existing `CollapsiblePanel` already does direct localStorage reads; a hook is the smallest local refactor. Easily reversible at spec stage if Path B is cleaner. | S:75 R:75 A:80 D:70 |
| 9 | Confident | Empty-state hint copy: "Select a server above to see its sessions." (suggested) | Constitution V (Keyboard-First) and existing "No sessions" empty-state convention point toward concise, action-oriented copy. Final wording deferred to spec stage. | S:65 R:90 A:75 D:65 |
| 10 | Confident | Tests live colocated as `index.test.tsx` (Vitest) per project convention; Playwright e2e likely added per context.md "Playwright-Driven Development" guidance | Strong codebase signal — `code-quality.md` §"Test Strategy" and existing `server-panel.test.tsx`, `collapsible-panel.test.tsx` next to source files. | S:85 R:85 A:90 D:80 |
| 11 | Confident | Affected memory: `run-kit/ui-patterns` (modify) — single paragraph in existing Sidebar section | Memory landscape inspected: `ui-patterns.md` already documents Sidebar conventions extensively in lines 245-348; coupling rule slots in naturally near the per-server `ServerGroup` paragraphs. | S:80 R:85 A:90 D:85 |
| 12 | Certain | When the Server Pane is expanded and the Sessions Pane filters to the current server, force-open the current server's group (override its persisted collapse state for that moment). When the Server Pane collapses and the multi-server tree returns, each group restores from its persisted state. <!-- clarified: user chose option (b) — force-open the current server's group so the filtered view always shows content, not a collapsed header. Per-server state is restored when the Server Pane collapses again. --> | Clarified — user confirmed force-open | S:95 R:55 A:50 D:40 |
| 13 | Certain | Hook name and location if Path A is chosen: `useLocalStorageBoolean` at `app/frontend/src/lib/use-local-storage-boolean.ts`. Spec stage MUST grep for an existing equivalent first; if one exists, prefer it over creating a new file. <!-- clarified: user confirmed the proposed name and path; grep-first caveat retained --> | Clarified — user confirmed | S:95 R:80 A:75 D:55 |

13 assumptions (9 certain, 4 confident, 0 tentative, 0 unresolved).
