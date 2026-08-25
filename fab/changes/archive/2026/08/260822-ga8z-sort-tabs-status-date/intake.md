# Intake: Sort Tabs by Status/Date

**Change**: 260822-ga8z-sort-tabs-status-date
**Created**: 2026-08-22

## Origin

> Implement Phase 3 (control-room features) of `fab/plans/sahil/26-08-22-operator-session.md`, item 15: **sort tabs by status/date** — deterministic move-window batch ordered by the status pyramid or creation time, explicitly NOT routed through the operator (mechanical, run-kit-side only).

One-shot `/fab-new` invocation covering plan items 9–15, split into four changes along structural seams (user-authorized split). This is the mechanical run-kit-side item — the plan is explicit that it needs neither Phase 1 nor Phase 2 and never touches the operator ("A UI verb, not a standing auto-sort"). Siblings: `260822-q675-operator-auto-name-idle`, `260822-rfz2-operator-digest-stuck-retire`, `260822-wyn3-operator-compose-spawn-search` — all operator-side; this change shares no code seam with them.

## Why

A busy session accumulates windows in spawn order: waiting tabs needing attention sit interleaved with idle finished ones and long-running actives. The sidebar shows status dots, but the *order* carries no signal — the user scans the whole list. A one-shot "sort by status" puts attention-needing tabs first; "sort by created" restores chronology. If we don't build it: manual drag-reordering per window (the only reorder today is the sidebar drag), which nobody does for ten windows. Why mechanical: ordering by derived status is deterministic — there is no judgment in it, so routing it through the operator would violate the plan's inside/outside razor (run-kit owns everything derivable and deterministic) and add an operator dependency to a UI path (a hard non-goal: "No operator dependency in any UI request path (sort, filter, search-literal, status)"). It must work with zero operators running.

## What Changes

### Backend: session-scoped sort endpoint

`POST /api/sessions/{session}/sort-windows?server={server}` (Constitution IX: mutation ⇒ POST) with body `{"by": "status" | "created"}` — any other value 400 (key-allowlist posture). Session and server names validated via `internal/validate` before subprocess use (Constitution I). The handler:

1. Enumerates the session's windows with their derived rollups from ONE `FetchSessions` pass (the same rollup the sidebar dots consume — no new derivation).
2. Computes the target order **deterministically** (below), using a **stable sort** — equal keys preserve current relative order, so re-running the verb is idempotent (a no-op batch when already sorted).
3. Executes the reorder as a `MoveWindow` batch (`internal/tmux/tmux.go` `MoveWindow(windowID, dstIndex, server)` — exists, translates stable `@N` ids to mutable indexes and preserves the active window; all targeting via `@N`/`=name:` forms per the collision rules in `run-kit/tmux-sessions.md`). Windows are moved only when their position actually changes.
4. Returns the applied order; the UI updates via the normal SSE derive tick (no optimistic reorder needed — the tick is the source of truth).

### Ordering keys

- **`status`**: rank by the status pyramid's tier precedence (`docs/specs/status-pyramid.md` — PR > fab > agent > tmux), attention-first within the same shape the sidebar's decision table uses. Concrete rank table (exact values are plan-stage, derived from the spec's decision table): windows whose displayed signal demands attention first (agent `waiting`, PR action-needed, fab review-failed), then active work (agent `active`, fab in-flight, PR pending), then settled (PR merged/fab done), then idle agents, then plain tmux windows. Tie-break: current index (stability).
- **`created`**: numeric sort on the window id — tmux assigns `@N` monotonically at creation, so `@N` IS the creation order, derivable with zero extra state (Constitution II; tmux exposes no window-creation timestamp). Ascending = oldest first.
- **`name`**: case-insensitive ascending window name *(amendment, below)*.

### Amendment (2026-08-22, user-directed): multi-key sort via a palette sub-list

Scope amendment while the change is in flight (PR #713 draft, unmerged — contract change is free). The user wants composite sorts — "first sort by date and then by name" — picked from a **sub-list** after selecting the action, instead of one flat entry per key. Persistence was explicitly REJECTED as scope creep: the verb stays one-shot.

- **API**: the body becomes an **ordered array** — `{"by": ["created", "name"]}` — 1–3 unique keys from the closed set `status | created | name`; the bare-string form is dropped (no consumers — the PR never merged). Anything else 400s (same key-allowlist posture). Semantics: first key is the primary sort, later keys break ties (spreadsheet semantics). A `created`-primary composite is degenerate (`@N` never ties) — accepted, harmless.
- **New `name` key**: case-insensitive ascending window name. Meaningful both as primary (duplicate names are routine under folder auto-naming) and as tie-break.
- **Palette**: the two flat entries are REPLACED by one entry `Session: Sort windows…` that opens an **option sub-step** inside the palette (generalizing the existing `confirmLabel` single-row confirm sub-step into a minimal option-picker mechanism on `CommandPalette`): the list swaps to the three key rows; ↑↓ navigates, Space (or click) toggles a key with an order badge (1, 2, …) reflecting selection order = priority, Enter applies the composite, Esc/backdrop/⌘K cancels (the `confirmLabel` cancel seams). Keyboard-first (Constitution V); still no chords, palette-only.
- Everything else is unchanged: session-scoped, stable sort (idempotent re-runs), MoveWindow batch only-when-changed, SSE-derived UI update, hidden/infra sessions not offered.

### Scope and non-goals

- **Session-scoped**: windows sort within their session; nothing crosses sessions (a cross-session move would rip a window out of its group — out of scope, matches the plan's "tabs" framing).
- **One-shot verb, never a standing auto-sort**: no watcher, no re-sort on state change — the plan is explicit, and this respects the sidebar's derived-order + drag-override model (`run-kit/ui/sidebar` — display order derives from SSE order with a transient drag override; a physical reorder flows through the derive tick exactly like a manual tmux `move-window` would).
- Hidden/infra sessions (`_rk-operator`, `_rk-pin-*`) are not offered the verb (they're filtered from the normal list anyway); the operator's pinned row is unaffected (it keys on role, not order).

### Frontend

- **Palette** (Constitution V): `Session: Sort windows by status` and `Session: Sort windows by created` — scoped to the current session (the session of the current window on the terminal route; on `/$server` offer per-session via the palette's session context if that pattern exists — else terminal-route only for v1). Registered + documented in the palette registration per `fab/project/code-review.md`.
- **Client**: `api/client.ts` `sortSessionWindows(server, session, by)` — `withServer` + `throwOnError`; failure toast on error; no success toast needed (the reorder is immediately visible via SSE) — or a subtle one for feedback; plan-stage.

### Tests

- Go: pure order-computation unit tests (rank table, stability/idempotence, `@N` numeric order incl. `@9` vs `@10`), handler tests (validation 400s, unknown session 404, move-batch only-when-changed), against fixture windows.
- Frontend: palette gating unit test; Playwright e2e with companion `.spec.md` — real-tmux path (the e2e harness runs an isolated tmux server): create windows, invoke the palette verb, assert sidebar order changes; any route mocks carry the trailing `*` (withServer appends `?server=`); run via `just test-e2e` / `just pw` only.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) the sort-windows verb — endpoint, rank table, `@N`-as-creation-order, MoveWindow batch semantics
- `run-kit/ui/keyboard-and-palette`: (modify) the two palette actions and their scoping

## Impact

- `app/backend/api/` new handler (e.g. `sort_windows.go` + test) + router registration; `internal/tmux` MoveWindow reused as-is (possibly a small batch helper)
- `app/frontend/src/api/client.ts`, command-palette registration
- No operator code touched; fully independent of the three sibling changes (different files end-to-end)
- Sidebar interaction: none beyond order arriving via SSE (the drag-override reconcile clears on SSE-order equality per the derive-over-store model — a real reorder is a new SSE order, handled by the existing render-time reconcile)

## Open Questions

- Should the status-rank table live beside the frontend's pyramid decision table as a shared contract note, given the backend now encodes a second ranking of the same signals? (Plan-stage: at minimum cross-reference `docs/specs/status-pyramid.md` from both.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mechanical, run-kit-side only — no operator involvement anywhere in the path; works with zero operators | User args + plan non-goal are both explicit | S:95 R:90 A:95 D:95 |
| 2 | Certain | One-shot POST verb; never a standing auto-sort; stable sort makes re-runs idempotent | Plan verbatim ("A UI verb, not a standing auto-sort"); respects the derived-order sidebar model | S:90 R:85 A:90 D:90 |
| 3 | Confident | Session-scoped sorting; no cross-session moves | "Tabs" = windows within a session; cross-session moves change group membership, a different feature | S:70 R:80 A:85 D:75 |
| 4 | Confident | `created` order = numeric `@N` (tmux assigns window ids monotonically); no timestamp state introduced | tmux exposes no window-creation time; `@N` monotonicity is derivable and Constitution-II-clean; verify the monotonicity claim against tmux docs at apply | S:60 R:85 A:75 D:70 |
| 5 | Confident | Status rank = attention-first ordering derived from the pyramid's decision table (waiting/action-needed → active/in-flight → settled → idle → plain), exact table fixed at plan stage | The plan names the pyramid but a tier-precedence model doesn't directly define a total order; the chosen reading (attention-first) matches the feature's purpose | S:50 R:75 A:65 D:45 |
| 6 | Confident | Palette-only surfacing for v1, current-session scope on the terminal route | Constitution V makes the palette the discovery mechanism; more entry points (session header menu) are additive follow-ups | S:60 R:90 A:80 D:70 |
| 7 | Certain | One-shot verb preserved; NO persisted sort preference | User explicitly rejected persistence as scope creep in the amendment conversation | S:95 R:90 A:95 D:95 |
| 8 | Confident | Ordered-array body `{"by": [...]}` replaces the bare string; first key primary, later keys tie-breaks | User's "first by date, then by name" is spreadsheet semantics; PR unmerged so the contract change is free; degenerate created-primary composites accepted | S:75 R:85 A:85 D:75 |
| 9 | Confident | One `Session: Sort windows…` parent entry replaces the flat pair; sub-step with Space-toggle order badges + Enter apply, generalizing the confirmLabel mechanism | User asked for a sub-list; keeping flat singles beside it would duplicate function and pollute the palette | S:70 R:80 A:80 D:65 |

9 assumptions (3 certain, 6 confident, 0 tentative, 0 unresolved).
