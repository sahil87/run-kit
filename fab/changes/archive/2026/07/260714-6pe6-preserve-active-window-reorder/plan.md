# Plan: Preserve Active Window Across Sidebar Reorder

**Change**: 260714-6pe6-preserve-active-window-reorder
**Intake**: `intake.md`

## Requirements

### tmux MoveWindow: Active-Window Preservation

#### R1: MoveWindow SHALL keep the session's active window invariant across a within-session reorder
`tmux.MoveWindow` (`app/backend/internal/tmux/tmux.go`) MUST capture the session's active window ID before the swap shuffle and restore it after, so the window that was active before the reorder is still active after it. tmux pins the active window to its *index slot* during `swap-window`, so without an explicit restore a different window ends up occupying the active slot.

- **GIVEN** a session with windows `[w0, w1*, w2, w3]` (`*` = active)
- **WHEN** `MoveWindow` moves `w3` to index 0
- **THEN** after the reorder `w1` is still the session's active window (not `w0`, the index-pinned drift)
- **AND** the window IDs are preserved across the swaps (tmux `swap-window` contract), so the restore addresses `w1` by its stable `@N` id.

#### R2: The active window ID SHALL be captured by extending the existing `list-windows` call — no extra subprocess
The active window ID MUST be obtained by extending the format of the `list-windows` call already present at `tmux.go:1182` from `#{window_index}` to `#{window_index}\t#{window_active}\t#{window_id}`. The parse MUST recover the numeric `window_index` (for the existing bubble-swap position logic) and the `window_id` of the line whose `window_active` is `1`. No new `tmux` subprocess is added.

- **GIVEN** the session's `list-windows` output
- **WHEN** `MoveWindow` parses it
- **THEN** each line yields its index (feeding the sorted-indices swap logic exactly as before)
- **AND** the line with `window_active == 1` yields the active window ID held for the post-swap restore.

#### R3: The restore SHALL be appended to the SAME `\;`-chained tmux invocation as the swaps (atomic)
`MoveWindow` MUST append `; select-window -t <activeWindowID>` to the same `\;`-chained `tmuxExecServer` invocation that carries the `swap-window` sequence, so no SSE poll or concurrent mutation observes an intermediate active-window state. This mirrors the existing `CreateWindowWithOptions` / `SetWindowOptions` chaining pattern.

- **GIVEN** a reorder that performs one or more swaps
- **WHEN** `MoveWindow` builds the chained argv
- **THEN** the argv ends with `; select-window -t <activeWindowID>` after the final `swap-window`
- **AND** the whole sequence executes as one `tmux` invocation.

#### R4: The early-return (no-swap) paths SHALL NOT emit a restore
The existing early returns — `srcIndex == dstIndex` (`tmux.go:1177`) and `srcPos == endPos` (`tmux.go:1222`) — perform no swaps, so no active-window drift occurs on those paths and no `select-window` restore is emitted. The active-window capture MAY happen before these returns (it is a pure parse of already-fetched output), but the `select-window` append MUST occur only on the swap-executing path.

- **GIVEN** a `MoveWindow` call where source and destination resolve to the same position
- **WHEN** the function takes an early return
- **THEN** no `swap-window` and no `select-window` is issued (no tmux mutation at all).

### Non-Goals

- **Frontend changes** — with tmux state never drifting, the SSE snapshot keeps reporting the correct active window and the URL-writeback effect (`app/frontend/src/app.tsx:628`) stays quiet. No `pendingClickRef` extension, no client-side selection state.
- **`MoveWindowToSession`** (`tmux.go:1252`, cross-session move) — out of scope; the frontend deliberately navigates to the server page for that path.
- **API-surface changes** — `POST /api/windows/{id}/move` and the `TmuxOps.MoveWindow` interface keep their signatures.
- **`swap-window -d`** — rejected as a fix (empirically leaves the bubbled window active, still wrong); do not introduce it.

### Design Decisions

1. **Backend root fix (restore the active window ID)**: capture-before / restore-after inside `MoveWindow` — *Why*: tmux state never drifts, so all clients and attached tmux users stay correct and the frontend needs no change — *Rejected*: frontend-only suppression (extending `pendingClickRef`), which masks the navigation but leaves tmux genuinely switched to the wrong window for other clients/attached users, violating fix-root-causes and tmux-is-truth.
2. **Restore by window ID, not index**: `select-window -t <activeWindowID>` — *Why*: window IDs are stable across the swaps (tmux contract), so selecting the captured ID restores the correct window wherever it landed, and it also covers the edge where the dragged window IS the active one — *Rejected*: any index-based restore, which would re-select the drifted slot.
3. **Unconditional restore on the swap-executing path**: always append `select-window` once a swap chain is being emitted, rather than computing whether the active window's index falls inside the swap range — *Why*: the conditional variant needs range-membership reasoning that is more error-prone for no correctness gain; the early-return paths already emit nothing, so the only cost of unconditional is a near-no-op re-select of the already-active window when it lies outside the swap range, which merely touches tmux's "last window" stack (see Assumption 4).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `MoveWindow` (`app/backend/internal/tmux/tmux.go`), extend the `list-windows` call at ~line 1182 from `-F "#{window_index}"` to `-F "#{window_index}\t#{window_active}\t#{window_id}"`, and update the parse loop to (a) recover the numeric `window_index` for the existing sorted-indices bubble logic unchanged, and (b) capture the `window_id` of the line whose `window_active` field is `"1"` into an `activeWindowID` local. <!-- R2 -->
- [x] T002 <!-- rework: review must-fix — bare `select-window -t @N` is ambiguous in tmux session groups (independent per-member active pointers; see tmux.go SelectWindowInSession doc + docs/memory/run-kit/tmux-sessions.md); session-qualify the restore target as `session+":"+activeWindowID` --> In `MoveWindow`, after the `swap-window` chain is built and before the single `tmuxExecServer` call, append `";", "select-window", "-t", session+":"+activeWindowID` to `args` (guarding on a non-empty `activeWindowID`). The append occurs only on the swap-executing path — the `srcIndex == dstIndex` and `srcPos == endPos` early returns still emit nothing. Function + inline doc comments note the session-qualified active-window restore. <!-- R1 R3 R4 -->

### Phase 3: Integration & Edge Cases

- [x] T003 <!-- rework: review should-fix — new `activeWindowID` test helper duplicates existing `windowID` helper (tmux_test.go:1119), which already resolves a session's active window when passed the bare session name; reuse it. Also add a grouped-session variant (new-session -t mirror member) asserting the BASE session's active window survives the reorder — pins the session-qualified restore from T002 --> Add a behavioral Go test `TestMoveWindow_preservesActiveWindow` in `app/backend/internal/tmux/tmux_test.go` following the existing `withSessionOrderTmux` / real-tmux integration pattern: create windows `[0,1,2,3]`, `select-window` the window at index 1 to make it active, capture its `@N`, call `MoveWindow(idOfIndex3, 0, server)`, then assert the session's active window (`display-message -p "#{window_id}"`) still equals the captured index-1 id — proving the pre-shuffle active window survives the reorder. Rework: removed the duplicate `activeWindowID` helper — the two tests now call `windowID(t, server, "boot")` (a bare session target resolves the session's active window); helper doc broadened. Added grouped-session variant `TestMoveWindow_preservesActiveWindowInSessionGroup` (mirror member via `new-session -t boot`) asserting the reordered session's active window survives (see Assumption 6). <!-- R1 -->
- [x] T004 <!-- rework: same helper dedup as T003 --> Add a behavioral Go test `TestMoveWindow_preservesActiveWindowWhenDragged` covering the edge where the moved window IS the active one: create `[0,1,2,3]`, make the window at index 3 active, capture its `@N`, call `MoveWindow(idOfIndex3, 0, server)`, then assert that same id is active afterward AND now resolves to index 0 — proving `select-window -t <id>` restores the dragged-and-active window wherever it landed. Rework: same helper dedup as T003 (now calls `windowID(t, server, "boot")`). <!-- R1 -->

## Execution Order

- T001 blocks T002 (T002 uses the `activeWindowID` captured in T001).
- T003 and T004 depend on T001+T002 and are independent of each other.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `MoveWindow` restores the pre-shuffle active window; after a representative within-session reorder the session's active window is unchanged.
- [x] A-002 R2: The active window ID is captured from the extended `list-windows -F "#{window_index}\t#{window_active}\t#{window_id}"` call — no additional `tmux` subprocess is introduced by the change.
- [x] A-003 R3: The `select-window -t <activeWindowID>` restore is appended to the same `\;`-chained `tmuxExecServer` invocation as the `swap-window` sequence (one atomic tmux call).

### Behavioral Correctness

- [x] A-004 R1: With `[w0, w1*, w2, w3]`, moving `w3` to index 0 leaves `w1` active (not `w0`) — verified by `TestMoveWindow_preservesActiveWindow`.
- [x] A-005 R4: The `srcIndex == dstIndex` and `srcPos == endPos` early-return paths issue no `swap-window` and no `select-window` (no tmux mutation).

### Scenario Coverage

- [x] A-006 R1: `TestMoveWindow_preservesActiveWindow` (active window is a non-dragged window) passes under `just test-backend`.
- [x] A-007 R1: `TestMoveWindow_preservesActiveWindowWhenDragged` (dragged window is the active window) passes — the captured id is still active and now resolves to the destination index.

### Edge Cases & Error Handling

- [x] A-008 R1: When the dragged window is itself the active window, `select-window -t <id>` re-selects it at its new index (the id-based restore handles this without special-casing).

### Code Quality

- [x] A-009 Pattern consistency: the change stays inside the existing `tmuxExecServer` chained-argv pattern (mirrors `CreateWindowWithOptions` / `SetWindowOptions`); no inline tmux command construction, `exec.CommandContext` with argument slices only (constitution §I).
- [x] A-010 No unnecessary duplication: reuses the already-present `list-windows` call (format extension) rather than adding a new subprocess; no new helper duplicating existing tmux wrappers.
- [x] A-011 Test coverage: the bug fix ships with Go tests covering the changed behavior (representative move + dragged-window-is-active edge), per `fab/project/code-quality.md`.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Rework cycle 1 (review must-fix / should-fix)

- **T002 (must-fix)**: the restore target is now session-qualified — `select-window -t <session>:<activeWindowID>` — matching the `SelectWindowInSession` pattern (`tmux.go`) and the session-group ambiguity documented in `docs/memory/run-kit/tmux-sessions.md`. Function + inline doc comments updated. Error label widened to `swap-window/select-window chain: %w` (the chain now includes the restore).
- **T003/T004 (should-fix)**: removed the duplicate `activeWindowID` test helper; the two active-window tests now reuse `windowID(t, server, "boot")` (a bare session target resolves the session's active window). `windowID`'s doc comment broadened to cover both target forms.
- **Grouped-session finding (residual, out of scope)**: the added grouped-session test exercises the `session:@N` restore on a real tmux session group, but it does NOT discriminate the bare vs session-qualified restore. Root cause: `MoveWindow` resolves the dragged window's owning session via a bare-`@N` `display-message` (`resolveWindowSessionIndex`), so both the swaps and the restore commit to whichever group member tmux picks; the session-qualified restore keeps the select scoped to *that* member, but a bare restore resolves to the same member, making the two equivalent within the resolved session. Full group-safety (preserving a *specific* member's active window regardless of which member the id resolves to) would require disambiguating `resolveWindowSessionIndex` — a shared helper, out of this change's backend-only `MoveWindow` scope. The qualified restore is retained as the correct, minimal, defensive fix (it provably scopes the restore to the same session as the swaps) per the review must-fix; see Assumption 6.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Verified on re-review cycle 2: the restore is purely additive inside `MoveWindow`; the frontend `pendingClickRef` suppression covers click intents only (`app/frontend/src/app.tsx:523-678`) — no reorder-drift workaround exists in the frontend to remove — and no existing tmux wrapper, branch, or config became unused. `SelectWindowInSession` retains its two production callers; the inline chain append cannot reuse it because the restore must ride the same `\;`-chained invocation.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix at the backend root (`MoveWindow` capture-before/restore-after) rather than frontend suppression | Carried verbatim from intake Assumption 1 (agreed + empirically verified); frontend-only suppression explicitly rejected | S:95 R:75 A:90 D:90 |
| 2 | Certain | Capture the active window ID by extending the existing `list-windows -F` format with `#{window_active}` + `#{window_id}` — no extra subprocess | Carried from intake Assumption 2; the call already exists at `tmux.go:1182`, extension is purely additive | S:95 R:85 A:95 D:90 |
| 3 | Certain | Restore via a final `select-window -t <activeWindowID>` appended to the SAME `\;`-chained invocation (atomic) | Carried from intake Assumption 3; mirrors `CreateWindowWithOptions`; window-ID stability covers the dragged-window-is-active edge | S:95 R:80 A:90 D:90 |
| 4 | Confident | Append the `select-window` restore **unconditionally** on the swap-executing path (not only when the shuffle would displace the active window) | Intake Assumption 7 delegated this to the implementer; unconditional is the minimal-diff, most-readable choice — early returns already emit nothing, so the only cost is a near-no-op re-select touching tmux's "last window" stack when the active window is outside the swap range. One-line, highly reversible | S:70 R:90 A:75 D:65 |
| 5 | Confident | Tests are **behavioral** real-tmux integration tests (via `withSessionOrderTmux`), asserting the active window ID after `MoveWindow`, rather than the arg-construction assertions the intake suggested as an "e.g." | The dominant `MoveWindow` test pattern in `tmux_test.go` is real-tmux behavioral (`withSessionOrderTmux` + `resolveWindowSessionIndex`); a behavioral test directly proves the fix's effect (active window preserved) and matches surrounding conventions, which the constitution's Test Integrity favors over arg-shape assertions | S:75 R:85 A:85 D:70 |
| 6 | Confident | The grouped-session test (`TestMoveWindow_preservesActiveWindowInSessionGroup`, rework cycle 1) asserts that the session `MoveWindow` **resolves and operates on** keeps its active window across the reorder — NOT that a specific named base session ("boot") does. It resolves the owning session in-test via `resolveWindowSessionIndex` and asserts on that member. | `MoveWindow` resolves the dragged window to a single owning session via a bare-`@N` `display-message` (`resolveWindowSessionIndex`) and runs BOTH its swaps and the restore scoped to that member; it has no caller-supplied session, so it cannot guarantee an arbitrarily-chosen *other* member (e.g. "boot" when the id resolved to "mirror") is preserved. Empirically (tmux 3.6a, isolated socket) the bare-`@N` and session-qualified restore are equivalent within the resolved member — the review's "pins the qualified restore" premise does not hold, because the true group ambiguity lives in `resolveWindowSessionIndex`, which is a shared helper out of this change's backend-only scope. The test therefore asserts the invariant `MoveWindow` actually provides and exercises the `session:@N` code path on a real group; it is not bare-vs-qualified discriminating. See § Notes (rework). | S:70 R:80 A:75 D:55 |

6 assumptions (3 certain, 3 confident, 0 tentative).
