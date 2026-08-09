# Intake: Selection Bulk Close + Send Prompt

**Change**: 260808-ebgs-selection-bulk-close-send-prompt
**Created**: 2026-08-08

## Origin

Synthesized from a `/fab-discuss` conversation on 2026-08-08, dispatched promptless via `/fab-proceed` (no questions asked; would-be questions recorded as deferred Unresolved assumptions).

> Feature: two new bulk actions for the sidebar window-row multi-select — `Selection: Close N windows` and `Selection: Send prompt to N agents`. Extends the shipped change `260807-nf9f-sidebar-multiselect-move-windows`, whose authoritative description lives in `docs/memory/run-kit/ui-patterns.md` § Window-Row Multi-Select and § Selection palette commands. The user chose exactly these two additions from a longer brainstorm; all other brainstormed actions were explicitly rejected (see Non-Goals below).

## Why

The window-row multi-select (260807-nf9f) shipped with exactly one bulk action: `Selection: Move N windows to <session>`. That leaves two gaps:

1. **The founding cleanup chore is incomplete.** The multi-select feature exists because windows whose PRs merged accumulate in working sessions. Today the flow is `Selection: Select all merged` → move them to a parking session (e.g. `completed`) — the windows are tidied but never actually gone. `Selection: Close N windows` completes the chore end-to-end: select all merged → close, no parking session needed. Without it, every cleanup pass still leaves debris that needs a second manual pass.

2. **No bulk orchestration primitive exists.** run-kit is an agent orchestration dashboard, yet talking to N agents means N manual visits. `Selection: Send prompt to N agents` broadcasts one typed message to every selected window — the motivating use is "tell all 5 agents: run the tests and report". It is the first bulk action about orchestrating agents rather than tidying rows.

Both actions reuse existing per-window endpoints with the proven `executeBulkMove` sequential continue-on-error shape — small frontend-only additions with outsized workflow value.

## What Changes

### 1. Palette command `Selection: Close N windows`

Bulk close/kill of the selected windows.

- **Builder**: a new pure builder in `app/frontend/src/lib/palette-selection.ts` (the `palette-pin.ts`/`palette-move.ts` convention — pure, dependency-free, unit-testable), following the family's **omit-rather-than-disable** convention for ineligible states (empty selection at minimum; server gating per the deferred decision below). Label carries the live count with correct singular/plural (`Selection: Close 1 window` / `Selection: Close 5 windows`).
- **Executor**: a new `executeBulkClose` in `app.tsx` mirroring `executeBulkMove` (app.tsx:2052): N **sequential** POSTs via the existing client fn `killWindow(server, windowId)` (`app/frontend/src/api/client.ts:190` → `POST /api/windows/{windowId}/kill?server={server}` — endpoint verified), continue-on-error collecting `failedKeys` + first error message, terminal `settleBatch(keys, failedKeys)` reconcile (never `clear()`/`selectOnly()` — a slow batch races a new user selection), success toast `Closed N windows`, partial/total failure error toast `Closed 3 of 5 windows — 2 failed: <first error>`. Rows repaint from the SSE stream — no bulk optimistic/ghost machinery.
- **Confirmation**: this is the first DESTRUCTIVE bulk action, and the palette command family currently has no confirmation affordance. Guard: a **palette confirm sub-step** — after picking the command, the palette presents a second step (a single `Close N windows — Enter to confirm` entry; Esc cancels), the same two-step shape as move's session-picker sub-step. Keyboard-first, no new dialog component. <!-- clarified: 2026-08-08 user chose palette confirm sub-step over dialog / no-confirm -->
- **Frontend-only**: no new backend endpoint.

### 2. Palette command `Selection: Send prompt to N agents`

Broadcast one typed message to every selected window.

- **Transport**: the existing per-pane chat send — client fn `sendChatMessage(server, windowId, text, submit)` (`app/frontend/src/api/client.ts:300` → `POST /api/windows/{windowId}/chat/send?server={server}`), which carries the full sanitize + named-buffer paste + novelty echo probe + probe-gated Enter machinery (`docs/memory/run-kit/chat.md` § Send). Default `submit=true` — the broadcast use case is submitting a message to agents, not staging text. A per-window probe failure surfaces as the endpoint's structured `409` and counts as that window's failure in the batch (its text is left pasted, Enter withheld — the endpoint's normal 409 semantics).
- **Text entry**: the **compose strip in a selection-broadcast target mode** — the palette command opens the compose strip targeting the selection (e.g. `→ 5 selected`), and its send fans out to every selected window. Reuses the established type-to-agent surface (multiline editing, Enter policy, readline chords) at the cost of a new broadcast-target concept in the strip. <!-- clarified: 2026-08-08 user chose compose-strip broadcast target over a palette input mode / one-off dialog -->
- **Executor**: same shape as move/close — N sequential POSTs, continue-on-error, `settleBatch` reconcile, aggregate success/partial-failure toasts (e.g. `Sent prompt to N agents` / `Sent to 3 of 5 agents — 2 failed: <first error>`).
- **Frontend-only**: no new backend endpoint.

### Shared conventions (bind both actions)

- **The palette is the SOLE action surface** for selection actions (Constitution IV Minimal Surface + V Keyboard-First) — no buttons on the `SelectionIndicator` strip.
- Entries are composed by pure builders in `lib/palette-selection.ts` with thin bodies wired in `app.tsx`'s `selectionActions` memo; **omitted rather than disabled** when ineligible.
- **Server gating**: bulk move gates on `singleSelectedServer(selectedKeys)` because tmux cannot move a window across servers. Close and send **allow cross-server selections** — each POST carries its own server, so the executors derive each key's server via `splitSelectionKey` instead of taking a single `srv` parameter. Move keeps its gate (a real tmux constraint, not a family convention). <!-- clarified: 2026-08-08 user chose cross-server over keeping the single-server gate -->
- **Tests**: unit tests colocated (`lib/palette-selection.test.ts` for the builders; executor behavior per existing app-level patterns), plus e2e in `app/frontend/tests/e2e/sidebar-multiselect.spec.ts` with its `.spec.md` companion updated in the same commit (Constitution: Test Companion Docs). New features MUST include tests covering added behavior (code-quality.md); UI changes SHOULD include Playwright e2e.

### Non-Goals (explicitly rejected in discussion)

- Pin/unpin selection to board; create board from selection
- Bulk set/clear label/color
- Move selection to a NEW session
- Copy/open PR URLs or branch names for selection
- Expanding the `Select all …` selector family (closed PRs, idle, waiting, in-session, invert)
- Full cleanup (close window + worktree/branch deletion) — deliberately excluded as the first action needing a new backend seam and irreversible across N items

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Window-Row Multi-Select — bulk-action set grows from move-only to move/close/send; the "Frontend-only: no backend, no new endpoint" framing and the § Selection palette commands entry list (currently "Two entries") need updating, plus the confirmation affordance and prompt-entry affordance once decided
- `run-kit/chat`: (modify) § Send — note the new bulk-broadcast consumer of `POST .../chat/send` (per-window 409 probe semantics unchanged; consumed N-sequentially)

## Impact

- `app/frontend/src/lib/palette-selection.ts` + `palette-selection.test.ts` — two new pure builders + units
- `app/frontend/src/app.tsx` — `executeBulkClose` + broadcast-send executor, `selectionActions` memo wiring
- `app/frontend/src/components/command-palette.tsx` (or the palette composition seam) — the confirm sub-step for bulk close
- The compose strip (`compose-strip.tsx` + its draft/target model) — the selection-broadcast target mode for prompt entry
- `app/frontend/tests/e2e/sidebar-multiselect.spec.ts` + `sidebar-multiselect.spec.md` — new e2e coverage
- No backend changes; no new endpoints; no new routes
- Uses existing endpoints: `POST /api/windows/{windowId}/kill`, `POST /api/windows/{windowId}/chat/send`

## Open Questions

None outstanding — the three deferred questions were resolved with the user on 2026-08-08 (see Clarifications).

## Clarifications

### Session 2026-08-08

| # | Question | Answer |
|---|----------|--------|
| 10 | Confirmation mechanism for bulk close | Palette confirm sub-step (`Close N windows — Enter to confirm` second step; Esc cancels) |
| 11 | Text-entry affordance for the broadcast prompt | Compose strip in a selection-broadcast target mode (`→ N selected`) |
| 12 | Cross-server eligibility for close/send | Allow cross-server; executors derive per-key server via `splitSelectionKey`; move keeps its gate |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly two new bulk actions — `Selection: Close N windows` and `Selection: Send prompt to N agents`; all other brainstormed actions rejected | Discussed — user picked exactly these two from a longer brainstorm; rejected list captured in Non-Goals | S:95 R:90 A:90 D:95 |
| 2 | Certain | Close reuses the existing `killWindow` client fn → `POST /api/windows/{windowId}/kill`; no new backend endpoint | Discussed shape; endpoint verified in `src/api/client.ts:190` | S:90 R:85 A:95 D:90 |
| 3 | Certain | Send reuses the existing `sendChatMessage` client fn → `POST /api/windows/{windowId}/chat/send` (sanitize + paste + novelty probe + probe-gated Enter); no new backend endpoint | Discussed; endpoint verified in `src/api/client.ts:300`, contract in `docs/memory/run-kit/chat.md` | S:90 R:85 A:95 D:90 |
| 4 | Certain | Both executors follow the `executeBulkMove` shape: N sequential POSTs, continue-on-error, `settleBatch(keys, failedKeys)` reconcile, aggregate toast, SSE repaint, no bulk optimistic machinery | Discussed with specifics; pattern verified at `app.tsx:2052` | S:90 R:80 A:90 D:90 |
| 5 | Certain | Palette is the sole action surface; pure builders in `lib/palette-selection.ts` + thin bodies in `app.tsx` `selectionActions` memo; entries omitted (never disabled) when ineligible | Constitution IV + V; the shipped family's documented convention (ui-patterns § Selection palette commands) | S:90 R:85 A:95 D:95 |
| 6 | Certain | Tests: colocated Vitest units (`palette-selection.test.ts`) + e2e in `sidebar-multiselect.spec.ts` with its `.spec.md` companion updated in the same commit | code-quality.md MUST (tests for new behavior) + Constitution Test Companion Docs | S:85 R:90 A:95 D:95 |
| 7 | Confident | Bulk close ships WITH a confirmation step (only the mechanism is open) — it is the first destructive bulk action and the family has no confirm affordance | Discussed — "a confirmation step is wanted" was decided; only the mechanism was deferred | S:80 R:60 A:70 D:75 |
| 8 | Confident | `submit=true` for broadcast sends — the message is actually submitted to each agent, not just pasted | Motivating use ("tell all 5 agents: run the tests and report") implies submission; `submit` defaults true in the client fn | S:70 R:80 A:75 D:80 |
| 9 | Confident | Toast copy mirrors the move family (`Closed N windows` / `Sent prompt to N agents`; partial failure `X of N … — k failed: <first error>`); a chat-send 409 probe failure counts as that window's failure and keeps it selected as the retry affordance | Close copy given verbatim in discussion; send copy + 409 handling extrapolate the established batch semantics | S:65 R:75 A:75 D:70 |
| 10 | Certain | Bulk close is guarded by a palette confirm sub-step (`Close N windows — Enter to confirm` second step; Esc cancels) — no dialog | Clarified — user chose palette confirm sub-step (2026-08-08); mechanism is a contained palette change, swappable later | S:95 R:70 A:90 D:95 |
| 11 | Certain | Broadcast prompt entry is the compose strip in a selection-broadcast target mode (`→ N selected`), opened by the palette command | Clarified — user chose compose-strip broadcast target (2026-08-08); costs a new target concept in the strip (moderate rework if revisited) | S:95 R:60 A:85 D:90 |
| 12 | Certain | Close/send allow cross-server selections; executors derive per-key server via `splitSelectionKey`; move keeps its single-server gate | Clarified — user chose cross-server (2026-08-08); a gate could be re-added trivially if ever wanted | S:95 R:75 A:90 D:95 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
