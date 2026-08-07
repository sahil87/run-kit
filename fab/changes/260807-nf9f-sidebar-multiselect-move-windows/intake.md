# Intake: Sidebar Multi-Select of Window Rows + Bulk Move-to-Session

**Change**: 260807-nf9f-sidebar-multiselect-move-windows
**Created**: 2026-08-07

## Origin

Synthesized from a design discussion with the user (dispatched promptless via `/fab-proceed`). The user's request:

> Sidebar multi-select of window rows + bulk move-to-session, with a "select all merged" palette command.
>
> Use case: windows whose PRs have merged accumulate in working sessions; the user wants to select several window rows in the left sidebar and move them to another existing tmux session (e.g. one named "Completed") to reduce clutter — but the target can be ANY existing session, not a special one.

Seven decisions were agreed in the discussion (selection unit = window rows; APG multiselect tree semantics; palette-primary bulk action; "Select all merged" palette command; bulk = N sequential calls to the existing move endpoint; backend unchanged; single-server constraint). They are encoded verbatim in What Changes and as Certain assumptions below. Four open design points were left to intake (toggle key, action strip, select-all-merged scope, partial-failure behavior) — each is decided and graded in Assumptions.

## Why

1. **Pain point**: each sidebar window row is a worktree/change with per-window PR status (see `docs/specs/status-pyramid.md`, `app/frontend/src/components/pr-status-model.ts`). Once a window's PR merges, the window is done but lingers in the working session. Merged windows accumulate, and the only cleanup today is one-at-a-time drag-and-drop of each row to another session — slow, mouse-only, and O(N) drags for the routine "sweep the merged ones out" chore.
2. **Consequence of not doing it**: working sessions grow unboundedly noisy; the sidebar's signal (which changes need attention) degrades as done windows crowd out active ones; users avoid the cleanup because it is tedious, compounding the clutter.
3. **Why this approach**: the sidebar is already a W3C-APG tree with roving tabindex, so extending it with standard `aria-multiselectable` semantics is the accessibility-correct, lowest-novelty path. The command palette is the constitution-mandated primary action surface (Principle V: keyboard-first, `Cmd+K` as primary discovery), so the bulk action and "Select all merged" live there — giving the one-keystroke cleanup flow: **Select all merged → Move to session**. The backend move endpoint already exists and is used by single-window drag-and-drop; N sequential calls reuse it with zero new backend surface (Principle IV: minimal surface area). Alternatives rejected in discussion: session-row selection (PR status is per-window, not per-session), a create-if-missing target session (user wants existing sessions only — no new backend surface for creation), and bulk optimistic ghost-window machinery (SSE repaint is fast enough; complexity not warranted).

## What Changes

All changes are frontend-only. **The backend is expected unchanged** — the move endpoint exists (`POST /api/windows/{windowId}/move-to-session`, handler `app/backend/api/windows.go:337` → `s.tmux.MoveWindowToSession` → `tmux.MoveWindowToSession` at `app/backend/internal/tmux/tmux.go:1535`). No createIfMissing, no session-creation surface.

### 1. Selection model — multi-select state for window rows

- **Selection unit is window rows only** (`window-row.tsx` rows carrying `data-window-id`), never session or server rows. Each window is a worktree/change; PR status is per-window.
- Selection state lives in a small dedicated zustand store (follow the `app/frontend/src/store/window-store.ts` pattern), keyed by the composite `${server}:${windowId}` key already used as the sidebar's globally-unique roving row key (`data-row-key`) and the window-store entry key (`entryKey(server, windowId)`). A shared store (rather than sidebar-local `useState`) is required because the command palette is composed in `app.tsx` while the tree lives in `app/frontend/src/components/sidebar/index.tsx` — both must read/write the selection.
- Store shape (indicative): `selected: ReadonlySet<string>` plus actions `toggle(key)`, `selectRange(keys)`, `selectAll(keys)`, `clear()`, and an anchor key for shift-range extension. Pure logic (range computation over the visible-row order, single-server derivation) goes in a dependency-free `src/lib/` module so it is unit-testable without mounting the tree.
- Selected rows get `aria-selected="true"` and a visible selected treatment consistent with the sidebar's existing row styling vocabulary; the tree container gets `aria-multiselectable="true"`.
- Rows that disappear from SSE (window killed/moved elsewhere) are pruned from the selection; ghost/optimistic rows (no real windowId) are not selectable — mirrors the existing SF-3 activation guard in the tree keydown handler.

### 2. Interaction — pointer and keyboard (W3C APG multiselect tree)

The sidebar tree (`app/frontend/src/components/sidebar/index.tsx`, roving-tabindex APG tree, keydown switch at ~line 1009) is extended with `aria-multiselectable` semantics:

- **Cmd/Ctrl-click** on a window row toggles it into/out of the selection (and does NOT activate/navigate to the window).
- **Shift-click** extends a contiguous range from the selection anchor to the clicked row, in visible-row order (the same `[role="treeitem"]` DOM-order walk the roving navigation uses).
- **Keyboard toggle on the focused row: `x`** (chosen over Space — see Assumptions #8: `Enter`/Space are already bound to row activation at sidebar/index.tsx:1066, so repurposing Space would break existing activation behavior). `x` on a focused window row toggles its selection; on session/server rows it is a no-op. Shift+ArrowUp/Down range extension MAY be added if low-cost, but `x` + shift-click is the required baseline.
- **Escape clears the selection** (when the selection is non-empty and no higher-priority Escape consumer is active — the inline rename input's own Escape handling at index.tsx:573/617 keeps precedence).
- The new `x` shortcut MUST be documented/discoverable via the command palette registration per the code-review policy ("new keyboard shortcuts must be documented in the command palette registration") — e.g. the palette selection commands carry the shortcut hints.

### 3. Command palette commands (primary action surface)

Follow the established palette-module pattern: a pure, dependency-free builder in `app/frontend/src/lib/palette-selection.ts` (naming after `palette-pin.ts` / `palette-move.ts`) with a colocated `palette-selection.test.ts`; thin action bodies wired in `app.tsx` where `PaletteAction[]` is composed (`app/frontend/src/components/command-palette.tsx` renders them).

- **`Select all merged`** — selects all window rows whose PR state is merged. Merged state comes from the existing frontend PR knowledge: `pr-status-model.ts` (`win.prState === "merged"`, `prDotState` tier 1) fed by the PR registers. Scope: **the current server only** (Assumptions #10) — a cross-server selection would dead-end the single-server bulk move. The command is hidden/omitted when there is no current-server context or when no merged windows exist.
- **`Move N selected windows to <session>`** — one palette entry **per eligible existing target session**, mirroring `buildPinActions`' per-board entries ("Pin: Current Window to <board>") rather than a bespoke picker dialog; the palette's fuzzy filter IS the session picker. Entries appear only when the selection is non-empty AND all selected windows are on a single server (decision 7: tmux windows cannot move across tmux servers — the existing DnD path already rejects cross-server moves). Target list = that server's existing sessions, excluding sessions that already contain ALL the selected windows' current sessions only when identical (i.e. exclude a target that would be a complete no-op); **existing sessions only — NO create-if-missing, NO new backend surface**.
- Both command labels carry the live count (e.g. `Selection: Move 4 windows to completed`), and the builder is pure so label composition and eligibility gating are unit-tested.

### 4. Bulk move execution — sequential calls, SSE repaint, aggregate toast

- Executing the move fires **N sequential** `POST /api/windows/{id}/move-to-session` calls via the existing client fn `moveWindowToSession(server, windowId, targetSession)` (`app/frontend/src/api/client.ts:219`). Sequential (await each before the next), not parallel — tmux window moves mutate session state serially and the endpoint is already serial-safe for single moves.
- **NO optimistic ghost-window machinery for bulk**: rows repaint via the SSE stream as tmux state changes. The existing single-window optimistic cross-session move (`executeMoveToSession` via `useOptimisticAction` at sidebar/index.tsx:~503, used by drag-and-drop at ~716) **stays as-is for drag-and-drop** and is not reused/extended for bulk.
- **Partial failure: continue-on-error** (Assumptions #11) — a failed call does not abort the remaining moves; failures are collected. After the batch: on full success, a success toast (`Moved 4 windows to completed`) and the selection clears; on partial failure, an error toast reporting how many succeeded and how many failed (e.g. `Moved 3 of 5 windows to completed — 2 failed: <first error message>`), and the failed windows remain selected as the natural retry affordance (Assumptions #12). Use the sidebar's existing toast mechanism (`addToast`).

### 5. Selection count indicator (minimal, no action strip)

While the selection is non-empty, a minimal non-interactive count indicator appears in the sidebar (e.g. a small fixed strip/badge: `4 selected · ⌘K to act · Esc to clear`). No buttons, no action strip — the palette is the sole action surface (Assumptions #9; trivially removable if it proves noisy). Placement/styling follows the sidebar's existing footer/indicator vocabulary.

### 6. Tests

- **Vitest unit tests (colocated)**: the pure selection-logic lib (toggle/range/anchor/single-server derivation, pruning), the `palette-selection.ts` builder (label composition, merged-only selection derivation from window+PR data, single-server eligibility gating, hidden-when-empty), per the project convention of pure palette builders with colocated tests.
- **Playwright e2e** under `app/frontend/tests/` with a **sibling `.spec.md` companion doc** (constitution: Test Companion Docs — same commit): cmd/ctrl-click + shift-click + `x` selection, Escape clear, palette "Select all merged" → "Move N selected…" flow moving real tmux windows on the isolated e2e server, and SSE repaint of the moved rows. Run via `just test-e2e` (port 3020, isolated tmux server) — never direct Playwright.
- Note the known Playwright gotchas for this area: window-row icon clusters are `pointer-events-none` at rest (hover the row first); mutating-route mocks need trailing `*` globs (`withServer` appends `?server=`).

### Explicit non-goals

- No backend changes of any kind (no new endpoints, no createIfMissing on move).
- No session-row or server-row selection.
- No bulk optimistic/ghost-window machinery (single-window DnD optimistic path untouched).
- No cross-server bulk move (tmux cannot move windows across servers).
- No new dialog/picker component — the palette's per-session entries are the picker.

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar keyboard-nav section gains the multiselect tree semantics (`aria-multiselectable`, `x` toggle, cmd/shift-click, Escape clear, selection store) and the palette section gains the selection command family (`Select all merged`, `Move N selected windows to <session>`) + the count indicator.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — tree multiselect semantics (click modifiers, `x`/Escape keydown cases, `aria-multiselectable`, selected-row rendering, SSE pruning hook-in).
- `app/frontend/src/components/sidebar/window-row.tsx` — selected-state visual treatment + `aria-selected`.
- `app/frontend/src/store/` — new small zustand selection store.
- `app/frontend/src/lib/palette-selection.ts` (+ colocated test) — pure builders; selection-logic lib module (+ test).
- `app/frontend/src/app.tsx` — wire the new palette actions into the composed `PaletteAction[]`.
- `app/frontend/tests/` — new e2e spec + sibling `.spec.md`.
- No Go/backend files. No routes. No new dependencies.

## Open Questions

- None — the four discussion-deferred design points are decided in Assumptions (#8–#11); none scored Unresolved.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Selection unit is window rows only (not sessions/servers) | Discussed — user chose window rows; each window is a worktree/change and PR status is per-window (pr-status-model.ts) | S:90 R:70 A:90 D:95 |
| 2 | Certain | APG multiselect-tree interaction: `aria-multiselectable`, cmd/ctrl-click toggle, shift-click range, keyboard toggle on focused row, Escape clears | Discussed — user chose extending the existing W3C-APG roving-tabindex tree; constitution Principle V (keyboard-first) | S:90 R:75 A:85 D:90 |
| 3 | Certain | Bulk action lives in the command palette; session picker = existing sessions only, no create-if-missing, no new backend surface | Discussed — user chose palette-primary (constitution: Cmd+K primary discovery) and dropped creation explicitly | S:95 R:80 A:90 D:90 |
| 4 | Certain | "Select all merged" is a palette command using existing frontend merged-PR state (pr-status-model / PR registers) | Discussed — user chose this for the one-keystroke cleanup flow; merged state already known client-side | S:90 R:85 A:90 D:90 |
| 5 | Certain | Bulk move = N sequential POSTs to existing `/api/windows/{id}/move-to-session` (client.ts:219 → windows.go:337 → tmux.go:1535); no bulk optimistic machinery; SSE repaint; toast on failure incl. success count | Discussed — user chose sequential reuse of the existing endpoint; single-window DnD optimistic path stays as-is | S:90 R:75 A:85 D:85 |
| 6 | Certain | Backend unchanged — zero new endpoints or fields | Discussed — endpoint exists and suffices; verified handler + client fn in code | S:95 R:90 A:95 D:95 |
| 7 | Certain | Bulk action gated to single-server selections; picker lists that server's sessions | Discussed — tmux windows cannot cross servers; existing DnD path already rejects cross-server moves | S:85 R:75 A:85 D:85 |
| 8 | Confident | Keyboard selection-toggle key is `x` (not Space) | Space is already bound to row activation alongside Enter (sidebar/index.tsx:1066); rebinding it breaks existing behavior; `x` is unbound in the tree handler and precedented (Gmail-style) | S:60 R:85 A:80 D:70 |
| 9 | Confident | Minimal non-interactive selection-count indicator in the sidebar (count + ⌘K/Esc hints); no action-strip buttons — palette-only actions | User said "optionally a small action strip/count indicator"; constitution IV (minimal surface) + V (palette primary) favor the count-only midpoint; trivially removable | S:45 R:90 A:60 D:40 |
| 10 | Confident | "Select all merged" scopes to the current server only; command hidden without a current-server context or when nothing is merged | Cross-server selection would dead-end the single-server bulk move (row 7), breaking the one-keystroke flow the command exists for | S:50 R:85 A:70 D:60 |
| 11 | Confident | Partial batch failure: continue-on-error; aggregate toast reports succeeded/failed counts + first error | Each window move is independent; aborting strands remaining windows for a likely-unrelated error; user asked for "toast on failure including how many succeeded" | S:55 R:85 A:65 D:55 |
| 12 | Confident | Selection clears on full success; on partial failure only the failed windows stay selected (retry affordance) | Natural consequence of row 11; keeps state comprehensible after SSE repaint; cheap to adjust | S:40 R:90 A:70 D:55 |
| 13 | Certain | Tests: colocated Vitest units for pure selection/palette logic; Playwright e2e with sibling `.spec.md`, run via `just test-e2e` | Constitution (Test Companion Docs) + code-quality.md mandate; existing palette-builder test convention | S:80 R:90 A:95 D:90 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).
