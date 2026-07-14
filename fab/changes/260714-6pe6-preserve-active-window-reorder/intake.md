# Intake: Preserve Active Window Across Sidebar Reorder

**Change**: 260714-6pe6-preserve-active-window-reorder
**Created**: 2026-07-14

## Origin

Promptless dispatch from a completed root-cause investigation conversation (no interactive questioning; decisions below were made and empirically verified in that investigation). Synthesized problem statement:

> Dragging a window row in the sidebar (left panel) to reorder it within a session causes the app to navigate away from the currently-viewed terminal to an incorrect window. The same defect path affects the command palette's `Window: Move Up/Down` (same `moveWindow` API). Root cause (verified empirically on tmux 3.6a using an isolated scratch socket): the backend `MoveWindow` reorders windows via a `\;`-chained sequence of `swap-window` commands with no active-window preservation — tmux keeps the session's current window pinned to its *index slot* during the swaps, so after the shuffle a DIFFERENT window occupies the active slot. The SSE snapshot then reports the wrong window active and the frontend URL writeback navigates the terminal there. Agreed fix: capture the active window ID before the shuffle and append `select-window -t <activeWindowId>` to the same chained tmux invocation.

Interaction mode: one-shot (investigation conversation → synthesized description → this intake). Key decisions carried over verbatim in **What Changes** and the **Assumptions** table.

## Why

1. **Pain point**: Every within-session window reorder — sidebar drag-and-drop or the palette's `Window: Move Up/Down` (both call `moveWindow` in `app/frontend/src/api/client.ts:162` → `POST /api/windows/{id}/move` → `tmux.MoveWindow`) — yanks the user's viewed terminal to a wrong window. Empirical example: with windows `[w0, w1*, w2, w3]` (`*` = active) and moving `w3` to index 0, the post-chain active window is `w0` (index-pinned drift), not `w1`.

2. **Consequence if unfixed**: The defect is not merely cosmetic UI mis-navigation — tmux's own session state is genuinely switched to the wrong window. All connected web clients AND directly-attached tmux users see the drift. Because the frontend has (by design) no client-side window selection state — tmux is truth — the wrong state propagates on every SSE poll: `isActiveWindow` drives sidebar selection and the URL-writeback effect (`app/frontend/src/app.tsx:628`) navigates the terminal to whatever tmux says is active. Reordering windows, a routine organizational action, becomes destructive to the user's focus.

3. **Why this approach**: Fix at the root — the backend `MoveWindow` — so tmux state never drifts and the frontend needs no change (the writeback stays quiet). The alternative of frontend-only suppression (extending `pendingClickRef`, which covers click intents only, to reorder operations) was rejected: it would mask the navigation but leave tmux genuinely switched to the wrong window for other clients and attached users, violating the project's fix-root-causes principle and the tmux-is-truth design.

**History (why this surfaced now)**: The swap chain has lacked active-preservation since it was introduced (PR #136, insert-before semantics). It was masked pre-#204 because the URL/writeback comparison was *index*-keyed and the active *index* does not drift under the swaps — the window-id migration in #204 (stable `@N` wiring) surfaced the defect as a visible wrong navigation.

## What Changes

### Backend: active-window preservation in `MoveWindow` (`app/backend/internal/tmux/tmux.go:1167`)

Current behavior: `MoveWindow` resolves the source window's session + index, lists the session's window indices (`tmux.go:1182`), computes the bubble path, and emits all adjacent swaps as one `\;`-chained tmux invocation:

```go
// tmux.go:1182 — existing call, currently index-only
out, err := tmuxExecServer(ctx, server, "list-windows", "-t", session, "-F", "#{window_index}")
...
// tmux.go:1233-1241 — existing chain construction
args = append(args, "swap-window", "-s", src, "-t", dst)  // joined by ";"
```

Two additions, both inside the existing `tmuxExecServer` chained-args pattern:

1. **Capture the session's active window ID before the shuffle** — extend the existing `list-windows` call's `-F` format with `#{window_active}` and `#{window_id}` (e.g., `"#{window_index}\t#{window_active}\t#{window_id}"`). The function already runs this `list-windows`; **no extra subprocess call is added**. Parse out the window ID of the line whose `window_active` is `1`.

2. **Append a final `select-window -t <activeWindowId>` to the SAME `\;`-chained invocation** (i.e., `args = append(args, ";", "select-window", "-t", activeWindowID)` after the swap loop). Atomicity matters: one chained invocation means no SSE poll or concurrent mutation observes the intermediate active-window state — this mirrors the existing `CreateWindowWithOptions` chaining pattern noted at `tmux.go:1229`.

Correctness properties (from the empirical investigation on tmux 3.6a, isolated scratch socket):

- Without preservation, tmux pins the active window to its **index slot** during the swaps → a different window ends up active (moving `w3` to index 0 in `[w0, w1*, w2, w3]` leaves `w0` active).
- `swap-window -d` is **NOT** a fix — empirically the chain then ends with the bubbled (dragged) window active, still not the window the user was viewing.
- Window IDs are stable across swaps (tmux contract, already relied on in the function's doc comment), so selecting the captured ID also handles the edge where the dragged window IS the active one: `select-window -t <id>` restores it wherever it landed.
- The early-return paths (`srcIndex == dstIndex` at `tmux.go:1177`, `srcPos == endPos` at `tmux.go:1222`) perform no swaps, so no restore is needed there — no drift occurs without a chain.

Open design nuance (implementer decides at apply — see Assumption 7): always append the `select-window` restore vs. only when the shuffle would displace the active window. An unconditional select of the already-active window is a near-no-op but perturbs tmux's "last window" stack.

### Backend tests (`app/backend/internal/tmux/tmux_test.go`)

New behavior MUST include Go tests covering the appended `select-window` restore, per `fab/project/code-quality.md` ("bug fixes MUST include tests covering the changed behavior"). The suggested shape from the investigation: arg-construction assertions following the existing `tmux_test.go` patterns — assert the chained args end with `; select-window -t <activeWindowId>` for a representative move, and cover the active-window-is-the-dragged-window edge.

### Frontend: no change

With tmux state never drifting, the SSE snapshot keeps reporting the correct active window and the URL-writeback effect (`app/frontend/src/app.tsx:628`) stays quiet. No `pendingClickRef` extension, no client-side selection state. Both defective entry points — sidebar drag reorder and the palette `Window: Move Up/Down` actions (`app/frontend/src/app.tsx:1211/1236/1263/1284`) — are healed by the backend fix since they share the same `moveWindow` API path.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document `MoveWindow`'s active-window preservation semantics — the swap chain now ends with a `select-window` restore of the pre-shuffle active window ID, keeping the session's active window invariant across within-session reorders (window addressing / managed window operations live in this file).

## Impact

- **Code**: `app/backend/internal/tmux/tmux.go` (`MoveWindow`, ~lines 1182-1245) + `app/backend/internal/tmux/tmux_test.go`. Backend-only; single function.
- **API surface**: unchanged — `POST /api/windows/{id}/move` (`app/backend/api/windows.go:300`) and the `TmuxOps.MoveWindow` interface (`app/backend/api/router.go:37`) keep their signatures.
- **Callers healed, not touched**: frontend `moveWindow` (`app/frontend/src/api/client.ts:162`), sidebar drag reorder, palette `Window: Move Up/Down` / `Move Left/Right`.
- **Out of scope**: `MoveWindowToSession` (`tmux.go:1252`, cross-session move) — the frontend deliberately navigates to the server page for that path.
- **Constraints**: all tmux calls stay inside `internal/tmux/` helpers using `exec.CommandContext` with argument slices (constitution Principle I); the change stays inside the existing `tmuxExecServer` chained-args pattern. No new subprocess call (the `-F` format extension rides the existing `list-windows`).
- **Tests**: `just test-backend` (Go); no e2e change required — existing e2e must not regress.

## Open Questions

None — the root cause and fix were agreed and empirically verified in the originating investigation. The one deliberately-open design nuance (unconditional vs. conditional `select-window` append) was explicitly delegated to the implementer and is recorded as Assumption 7.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix at the backend root (`MoveWindow` restore) rather than frontend suppression | Discussed and agreed in the investigation; frontend-only suppression explicitly rejected (leaves tmux genuinely drifted for other clients/attached users; violates fix-root-causes and tmux-is-truth) | S:95 R:75 A:90 D:90 |
| 2 | Certain | Capture the active window ID by extending the existing `list-windows -F` format with `#{window_active}` + `#{window_id}` — no extra subprocess | Specified verbatim in the discussion; the call already exists at `tmux.go:1182` and the extension is purely additive | S:95 R:85 A:95 D:90 |
| 3 | Certain | Restore via a final `select-window -t <activeWindowId>` appended to the SAME `\;`-chained invocation (atomic — no intermediate state observable by SSE polls or concurrent mutations) | Discussed with rationale; mirrors the existing `CreateWindowWithOptions` chaining pattern noted at `tmux.go:1229`; window-ID stability across swaps covers the dragged-window-is-active edge | S:95 R:80 A:90 D:90 |
| 4 | Certain | `swap-window -d` is rejected as a fix | Empirically tested on tmux 3.6a (isolated scratch socket): the chain then ends with the bubbled window active — still wrong | S:90 R:90 A:95 D:95 |
| 5 | Certain | Scope is backend-only (`tmux.go` + `tmux_test.go`); frontend unchanged; `MoveWindowToSession` out of scope | Stated explicitly in the discussion; with tmux never drifting the URL writeback stays quiet by design, and cross-session moves deliberately navigate to the server page | S:90 R:85 A:90 D:85 |
| 6 | Confident | Tests take the form of Go arg-construction assertions in `tmux_test.go` covering the appended restore (representative move + active-window-is-dragged edge) | code-quality.md mandates tests for the changed behavior; the investigation suggested arg-construction assertions ("e.g."), leaving exact test shape to the implementer within existing `tmux_test.go` patterns | S:70 R:85 A:80 D:65 |
| 7 | Confident | Unconditional vs. conditional `select-window` append (only when the shuffle would displace the active window) is decided by the implementer at apply | Explicitly left open in the discussion as an implementer decision; one-line, highly reversible; tradeoff is code simplicity vs. perturbing tmux's "last window" stack with a near-no-op select | S:60 R:90 A:70 D:55 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
