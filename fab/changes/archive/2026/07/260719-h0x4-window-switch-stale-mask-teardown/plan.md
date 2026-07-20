# Plan: Window-Switch Stale-Mask Proactive Teardown

**Change**: 260719-h0x4-window-switch-stale-mask-teardown
**Intake**: `intake.md`

## Requirements

### Window Switch: Stale-Mask Teardown

#### R1: Fresh switch clears a leftover mask on the gateless paths
Every `beginPendingSwitch` entry SHALL proactively tear down a mask/grace timer left showing by a prior TIMED-OUT switch, so the two gateless call paths (cold deep-link alignment, waiting-target navigation) do not carry a stale input-blocking LogoSpinner mask into the new route.

- **GIVEN** a prior switch timed out and armed the mask (`maskState === "masked"`)
- **WHEN** a gateless `beginPendingSwitch({server, windowId}, { posted })` runs (no `graceMask`)
- **THEN** the mask is torn down immediately at the top of the callback (`maskState === "idle"`), before waiting for SSE confirmation
- **AND** the teardown uses the BARE `tearDownMask()`, never `abandonSwitchFeedback()`

#### R2: The animated path's own gate is untouched — the slide is preserved
The teardown added to `beginPendingSwitch` MUST NOT settle a currently-open gate, because the animated path reaches `beginPendingSwitch` (via `beginWindowSwitchGate` → `startViewTransition` → `runSwitch`) while its OWN just-opened gate is `currentGate`. Settling it would skip the earned slide (breaks 260715-38kg R8 semantics).

- **GIVEN** the animated switch path has just opened its gate and is inside the VT callback
- **WHEN** `runSwitch` invokes `beginPendingSwitch`
- **THEN** the bare `tearDownMask()` runs (cancels only a pending grace timer + clears the mask), leaving `currentGate` pending and the slide intact
- **AND** the ungated instant path's existing explicit `abandonSwitchFeedback()` call (`app.tsx:1127`) is unchanged — it additionally settles a still-pending prior gate, which the bare teardown deliberately does not.

#### R3: Teardown from the masked state is idempotent
`tearDownMask()` SHALL be a safe no-op when invoked repeatedly and when nothing is showing, so the new call is harmless on the gated paths (which already tear down) and on any path where no mask is armed.

- **GIVEN** the mask is armed (`"masked"`)
- **WHEN** `tearDownMask()` is called, then called a second time
- **THEN** the first call sets `maskState === "idle"` and the second is a harmless no-op (still `"idle"`, no extra listener notification)

### Non-Goals

- A prior switch's still-PENDING gate re-masking after a gateless switch begins (animated switch to A, then a gateless nav to B within ~300ms → A's gate timer fires and re-arms the mask over B) — requires gate supersession that `beginPendingSwitch` cannot safely perform (own-gate ambiguity), self-heals on SSE confirm, and is explicitly scoped out by the backlog note.
- No new e2e — the window-switch e2e area is documented-flaky on main; unit + reviewer trace suffice.

### Design Decisions

#### Bare teardown at the one shared seam, not per-caller and not abandonSwitchFeedback
**Decision**: Add a single bare `tearDownMask()` at the top of `beginPendingSwitch` (the one seam every pending switch passes through).
**Why**: Enforces the "a fresh switch owns ALL feedback" invariant at one place; a future gateless caller inherits the fix. Bare teardown clears a leftover mask without touching a currently-open gate.
**Rejected**: (a) `abandonSwitchFeedback()` here — would settle the animated path's own current gate as `"superseded"` and skip the earned slide. (b) `tearDownMask()` at the two gateless call sites — spreads the invariant across callers; a future gateless caller re-introduces the bug.
*Introduced by*: 260719-h0x4-window-switch-stale-mask-teardown

## Tasks

### Phase 2: Core Implementation

- [x] T001 Import `tearDownMask` from `@/lib/window-transition` in `app/frontend/src/app.tsx` (add to the existing named import block, lines 30–46) <!-- R1 -->
- [x] T002 Add the bare idempotent `tearDownMask()` call at the top of `beginPendingSwitch` (`app/frontend/src/app.tsx`, after `clearPendingSwitchTracking()`, before `armGraceMask`) with the intake's comment rationale (fresh switch owns all feedback; bare teardown NOT abandonSwitchFeedback because the animated path runs this with its own gate current; idempotent no-op) <!-- R1 R2 -->
- [x] T003 Update the `window-transition.ts` N1 NOTE comment (`app/frontend/src/lib/window-transition.ts`, ~line 431) to name `beginPendingSwitch`'s fresh-switch teardown as a sanctioned production caller of the bare `tearDownMask()` <!-- R1 -->

### Phase 3: Tests

- [x] T004 Extend `app/frontend/src/lib/window-transition.test.ts` to pin bare `tearDownMask()` idempotence from the masked state (masked → idle on the first call; a second bare call is a harmless no-op) — check existing coverage first and extend only what the from-masked double-teardown seam is missing <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `beginPendingSwitch` calls the imported bare `tearDownMask()` at the top of its callback; a gateless entry from the masked state clears the mask to `idle` without waiting for SSE.
- [x] A-002 R3: `tearDownMask()` idempotence from the masked state is pinned by a unit test (masked → idle, second call harmless).

### Behavioral Correctness

- [x] A-003 R2: The added call is the BARE `tearDownMask()` (not `abandonSwitchFeedback()`), and the ungated instant path's existing `abandonSwitchFeedback()` at `app.tsx:1127` is unchanged — the animated path's own current gate is not settled, so the slide is preserved.

### Code Quality

- [x] A-004 Pattern consistency: The added call + comment match the file's dense invariant-comment register; the N1 NOTE is updated to reflect the new sanctioned production caller.
- [x] A-005 No unnecessary duplication: The fix reuses the existing `tearDownMask` primitive at the one shared seam rather than adding per-call-site teardowns.
- [x] A-006 Tests pass: `npx tsc --noEmit` clean and `just test-frontend` green.

## Notes

- No backend change. No e2e (documented-flaky window-switch area on main).

## Deletion Candidates

- `app/frontend/src/lib/window-transition.test.ts:398` (`"tearDownMask clears an armed mask (failure/bounce path)"`) — fully subsumed by the new idempotence test directly below it (identical arming boilerplate + the same masked→idle assertion as its first half); its "(failure/bounce path)" name is also stale — that path has used `abandonSwitchFeedback` since the G2 rework.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add the bare `tearDownMask()` at the top of `beginPendingSwitch`, after `clearPendingSwitchTracking()` | The intake's code sketch and the primitive's own doc comment name "every fresh switch start" as its call site; idempotence is documented | S:90 R:95 A:90 D:90 |
| 2 | Certain | Extend the existing test file with a from-masked double-teardown idempotence test rather than adding a whole new spec | The masked→idle single call is already covered (line 398) but the bare-teardown-then-second-bare-teardown idempotence the intake asks for is not a focused case; a small extension is proportionate | S:85 R:90 A:90 D:85 |

2 assumptions (2 certain, 0 confident, 0 tentative).
