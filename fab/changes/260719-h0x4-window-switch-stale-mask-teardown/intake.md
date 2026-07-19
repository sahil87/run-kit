# Intake: Window-Switch Stale-Mask Proactive Teardown

**Change**: 260719-h0x4-window-switch-stale-mask-teardown
**Created**: 2026-07-20

## Origin

<!-- Backlog item [h0x4], picked up by the backlog-bugs sweep (BUG scope). One-shot dispatch; validity re-verified against current code before intake creation. -->

> [h0x4] Window-switch transient stale-mask hand-off (should-fix): on the two GATELESS switch paths a mask left by a prior switch is not proactively torn down (self-heals within one SSE confirm); cheap fix = idempotent tearDownMask() at the top of beginPendingSwitch. (relocated from docs/memory/run-kit/ui-patterns.md by /docs-distill-memory)

**Verification (2026-07-20)**: still valid. `beginPendingSwitch` (`app/frontend/src/app.tsx:831`) has four call sites; two of them arm neither a gate nor a grace mask — they are the GATELESS paths:

1. **Mount-time alignment** (`app.tsx:961`) — cold deep-link to a non-active window: `beginPendingSwitch({server, windowId}, { posted })`, no `graceMask` (deliberately — "a cold deep-link mounts a fresh terminal").
2. **`navigateToWaitingTarget`** (`app.tsx:2220`) — same-server waiting-target navigation preserving `?view=chat`: `beginPendingSwitch({server, windowId}, { posted })`, no `graceMask` (deliberately — "a chat/deep-link target is often non-tty or remounts").

On these paths `beginPendingSwitch` runs only `clearPendingSwitchTracking()` (cancels the prior TRACKED entry's confirmation timer and its grace handle's `cancel`), which does NOT lift a mask already showing in module state (`window-transition.ts`). A prior switch whose gate/grace TIMED OUT leaves the LogoSpinner mask armed (`maskState: "masked"`); the other two call paths clear it as a side effect of their own machinery — `armGraceMask()` (instant gated path) and `beginWindowSwitchGate()` (animated path, which precedes its `runSwitch` → `beginPendingSwitch` call) both call `tearDownMask()` at entry — and the ungated instant path calls `abandonSwitchFeedback()` explicitly (`app.tsx:1127`). The two gateless paths clear nothing, so the stale mask lingers over the new route, blocking pointer input, until `confirmSwitchArrived()` fires on the next SSE confirmation (the "self-heals within one SSE confirm" in the note).

## Why

1. **The pain point**: the mask is an input-blocking overlay whose contract is "one switch's feedback at a time — a fresh switch owns ALL feedback" (stated verbatim in `window-transition.ts` comments and honored by every other switch-start path). The two gateless paths violate it: a mask armed by a prior timed-out switch survives into a new switch's route. The user sees a spinner mask over a window they just navigated to — content they are entitled to interact with — for up to one SSE round-trip.

2. **The consequence if unfixed**: a transient (typically sub-second) but user-visible wart: stale mask + blocked pointer input on cold deep-link alignment and waiting-target navigation, exactly the flows used to jump to an agent that needs attention (the waiting-badge click). Self-healing keeps it should-fix rather than must-fix, but the invariant break also makes future mask regressions harder to reason about.

3. **Why this approach**: the backlog's prescribed cheap fix — an idempotent `tearDownMask()` at the top of `beginPendingSwitch` — is exactly right, and the primitive is already documented as "called … at every fresh switch start (a new switch owns all feedback). Idempotent no-op when already idle." Alternatives rejected:
   - `abandonSwitchFeedback()` at the top of `beginPendingSwitch` — WRONG: the animated path calls `beginPendingSwitch` (via `runSwitch`) while its OWN just-opened gate is `currentGate`; `abandonSwitchFeedback` would settle that gate `"superseded"`, skipping the earned slide on every animated switch (breaks 260715-38kg R8 semantics).
   - Adding `tearDownMask()` calls at the two call sites — spreads the invariant across callers instead of enforcing it at the one seam every pending switch passes through; a future gateless caller would re-introduce the bug.

## What Changes

### `app/frontend/src/app.tsx` — `beginPendingSwitch`

Add the teardown at the top of the callback body (before or immediately after `pendingClickRef.current = …`; alongside `clearPendingSwitchTracking()`):

```ts
const beginPendingSwitch = useCallback(
  (target, opts = {}) => {
    pendingClickRef.current = { server: target.server, windowId: target.windowId };
    // Supersede any prior pending switch's tracking (its timer/mask).
    clearPendingSwitchTracking();
    // A fresh switch owns ALL feedback: proactively clear a mask/grace timer a
    // prior TIMED-OUT switch left showing (module state — tracking above only
    // cancels the tracked entry's own timer/handle). The gated paths get this
    // via armGraceMask/beginWindowSwitchGate; the two gateless paths (cold
    // deep-link alignment, waiting-target navigation) otherwise leave the
    // stale mask up until SSE confirmation. Deliberately the BARE teardown,
    // NOT abandonSwitchFeedback: on the animated path this runs while the
    // switch's OWN just-opened gate is current, and settling it would skip
    // the earned slide. Idempotent no-op when nothing is showing.
    tearDownMask();
    const grace = opts.graceMask ? armGraceMask() : null;
    …
  },
  …
);
```

Mechanics:
- Import `tearDownMask` from `@/lib/window-transition` in app.tsx (currently the export is used only by unit tests — production callers were steered to the wrappers; this new call is a legitimate direct use of the primitive and the `window-transition.ts` NOTE comment (cycle-3 N1, ~line 430) must be updated to name `beginPendingSwitch`'s fresh-switch teardown as the sanctioned production caller).
- No behavior change on the gated paths: instant-gated (armGraceMask tears down again — idempotent), animated (beginWindowSwitchGate already tore down; the own-gate mask cannot be armed yet since its 300ms timeout hasn't elapsed inside the synchronous VT callback entry).
- The ungated instant path's explicit `abandonSwitchFeedback()` (`app.tsx:1127`) STAYS — it additionally settles a still-pending prior gate (which the bare teardown deliberately does not), covering the animated→ungated-instant rapid sequence.

### Non-goal (documented, out of scope)

A prior switch's still-PENDING gate re-masking after a gateless switch begins (animated switch to A, then within ~300ms a gateless navigation to B → A's gate timer fires and re-arms the mask over B) is a distinct, rarer corner requiring gate supersession that `beginPendingSwitch` cannot safely perform (own-gate ambiguity above). It also self-heals on SSE confirm. Out of scope for this change; the backlog note scopes h0x4 to the already-armed leftover mask.

### Tests

- `app/frontend/src/lib/window-transition.test.ts`: if not already covered, assert `tearDownMask()` idempotence from the `"masked"` state (armed via a timed-out gate or grace timer → tearDownMask → `maskState === "idle"`; second call harmless). The app.tsx seam itself is component-level; existing window-switch e2e specs are a known-flaky area (`window-heading` arrows, max-update-depth console noise are pre-existing on main) — do NOT add a new e2e for this one-line change; unit + the reviewer's trace suffice. If any behavior IS testable at the lib level without mounting AppShell, prefer that.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the window-switch feedback model: every `beginPendingSwitch` entry proactively tears down a leftover mask/grace timer (fresh switch owns all feedback), closing the gateless-path residual noted when the item was relocated to the backlog. The pending-gate re-mask corner remains documented as an accepted rare self-healing case.

## Impact

- `app/frontend/src/app.tsx` — one import, one call + comment in `beginPendingSwitch`, comment touch-up in `window-transition.ts` (the N1 NOTE).
- `app/frontend/src/lib/window-transition.test.ts` — small unit addition if the idempotent-teardown-from-masked case is not already pinned.
- No backend change. Type check + `just test-frontend`.

## Open Questions

_None._

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The bug is valid: both gateless paths (alignment `app.tsx:961`, waiting-target `app.tsx:2220`) leave a prior timed-out switch's mask showing | Code-verified 2026-07-20: `clearPendingSwitchTracking` cancels only the tracked entry's timer/handle, never the module mask state | S:90 R:90 A:95 D:90 |
| 2 | Certain | Fix = bare idempotent `tearDownMask()` at the top of `beginPendingSwitch` — the backlog's prescribed seam | The primitive's own doc comment names "every fresh switch start" as its call site; idempotence is documented and cheap | S:90 R:95 A:90 D:85 |
| 3 | Certain | NOT `abandonSwitchFeedback` — the animated path reaches `beginPendingSwitch` while its own gate is current; settling it would skip the earned slide | Traced: `beginWindowSwitchGate` → `startViewTransition` → `runSwitch` → `beginPendingSwitch`, `currentGate` is this switch's gate | S:85 R:90 A:90 D:85 |
| 4 | Confident | The still-pending prior-gate re-mask corner is an accepted non-goal | Distinct rarer bug needing own-gate discrimination; self-heals; the backlog scopes h0x4 to the leftover armed mask | S:70 R:85 A:80 D:70 |
| 5 | Confident | No new e2e; unit-level pinning only where the lib seam allows | The affected e2e specs are documented-flaky on main; the change is one guarded call at a component seam; risk/benefit favors unit + trace review | S:70 R:85 A:80 D:70 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
