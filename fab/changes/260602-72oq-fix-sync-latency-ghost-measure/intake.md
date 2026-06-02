# Intake: Fix sync-latency test 3 false-signal fixed-sleep measurement

**Change**: 260602-72oq-fix-sync-latency-ghost-measure
**Created**: 2026-06-02
**Status**: Draft

## Origin

This change originates from backlog item `[72oq]` (2026-06-02), surfaced during a live
conversation reviewing the sync-latency e2e audit.

> fix: sync-latency.spec.ts test 3 ("3. Create window via sidebar + button", at line 162) is a
> no-op latency test that produces a false signal. It clicks the new-window button, optionally
> confirms the dialog, then does a hardcoded `await page.waitForTimeout(3_000)` (line 186) and
> records the elapsed ~3012ms via `record("Create window (UI, + button)", ...)`. Because the
> recorded duration is the fixed sleep itself, the test ALWAYS reports the action as SLOW /
> SSE-dependent (>500ms OPTIMISTIC_THRESHOLD_MS) regardless of actual behavior. It can neither
> detect a latency regression nor prove the optimistic win.
>
> The sidebar "+ new window" create path IS already optimistic today: `app/frontend/src/app.tsx`
> (around lines 477-484) fires `onOptimistic -> addGhostWindow` with rollback, and
> `window-store.ts` has full ghost-window-on-create logic backed by unit tests. Yet the audit
> summary still prints "[SLOW] Create window (UI, + button): 3012ms ← SSE-dependent", a false
> negative against reality.
>
> THE FIX (test-quality only — no production code changes): Replace the fixed
> `waitForTimeout(3_000)` sleep in test 3 with a measurement of time-to-first-ghost-appearance.
> Audit the other actions for the same fixed-sleep anti-pattern. Update the sibling
> `sync-latency.spec.md` in the same commit per the constitution's Test Companion Docs rule.

**Interaction mode**: One-shot intake from a verified backlog item. The backlog text was
cross-checked against the actual source files before generating this intake — every claim below
(line numbers, the offending sleep, the optimistic production path, the companion doc) was
confirmed present, so the design is fully grounded, not assumed.

## Why

**The problem.** `app/frontend/tests/e2e/sync-latency.spec.ts` is a latency audit: each test
records `Date.now() - t0` for a user action and flags it FAST (`< 500ms` =
`OPTIMISTIC_THRESHOLD_MS`) or `SLOW ← SSE-dependent` otherwise. Test 3
("3. Create window via sidebar + button") violates the audit's own contract. It starts the timer,
clicks Create, then sleeps a hardcoded `await page.waitForTimeout(3_000)` (line 186) and records
the elapsed time. The recorded value is therefore the sleep duration itself (~3012ms), so the test
**always** reports SLOW regardless of how fast the UI actually reflects the new window.

**The consequence of leaving it.** This is a false negative against reality. The sidebar
"+ new window" path is already optimistic in production — verified in
`app/frontend/src/app.tsx:477-498`, where `useOptimisticAction` fires
`onOptimistic: (srv, session) => { ghostWindowIdRef.current = addGhostWindowStore(srv, session, "zsh"); }`
with a matching `onRollback`, backed by ghost-window logic in `window-store.ts` and its unit tests.
The audit nonetheless prints `[SLOW] Create window (UI, + button): 3012ms ← SSE-dependent` on every
run. The test can neither (a) prove the optimistic win that already exists, nor (b) detect a
regression if the create path ever loses its optimistic update and falls back to the ~2.5s SSE
poll. It is dead weight that actively misleads anyone reading the summary table.

**Why this approach.** The other meaningful tests in the file (1, 2, 4, 5, 8, 9) record real
elapsed time by polling/expecting on a genuine UI condition (a row appearing/disappearing, a name
changing). The fix is to make test 3 conform to that same pattern: measure the time until the
optimistic ghost window row actually appears in the sidebar, using a bounded `expect.poll` /
`toBeVisible`. This turns a no-op into a real assertion — it passes when the ghost lands under the
500ms threshold and fails if create regresses to SSE-dependent. No production code changes are
needed because the optimistic path already exists; this is purely test-quality.

## What Changes

### 1. Replace test 3's fixed-sleep measurement with ghost-appearance measurement

In `app/frontend/tests/e2e/sync-latency.spec.ts`, test `"3. Create window via sidebar + button"`
(line 162), the measured body today is:

```ts
const t0 = Date.now();

// Dialog might show — click Create if it does
const dialog = page.locator("[role='dialog']");
if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
  await dialog.locator("button:has-text('Create')").click();
}

// Count windows under session B — wait for count to increase
// We can't predict the name, so just wait for any new window
await page.waitForTimeout(3_000);          // <-- line 186, the offending sleep
record("Create window (UI, + button)", Date.now() - t0);
```

Replace the fixed `waitForTimeout(3_000)` with a measurement of **time-to-first-ghost-appearance**:
after clicking the create button (and confirming the dialog if one appears), wait — via a bounded
poll/expect with a short timeout — for the newly-created window row to appear in the sidebar under
`SESSION_B`, and record THAT elapsed time.

Design notes for the implementer (the exact selector is an apply-stage decision, resolved against
the real DOM, but the shape is fixed):

- The window name is auto-derived and not predictable (the comment already notes "We can't predict
  the name"), so the assertion should detect **a new window row appearing** rather than match a
  specific name. The cleanest equivalent of test 1's pattern is to count the window rows under
  `SESSION_B` before the click and `expect.poll(...).toBeGreaterThan(beforeCount)`. (Test 1 uses
  `sidebar.locator("button[aria-label^='Navigate to ']").count()` for the session-level analog; the
  window-row equivalent under a session is the correct scope here — the implementer confirms the
  exact window-row selector against the rendered sidebar during apply.)
- Use a short timeout consistent with the file's other measured waits (the file uses `8_000` for
  appearance polls; `t0` is started immediately before the action so the *recorded* number is the
  true latency, and the generous timeout only bounds the failure case — it does not inflate the
  measurement the way the old fixed sleep did).
- Keep the existing tolerant `if (await newWinBtn.isVisible()...)` guard and the SKIP branch — only
  the measured region (the sleep) changes.
- The recorded latency now reflects reality: it lands FAST (`< 500ms`) when the optimistic ghost
  appears and SLOW only if the create path regresses to SSE-dependent.

### 2. Audit the other actions for the same fixed-sleep anti-pattern

While in the file, confirm no other test records a hardcoded `waitForTimeout` duration as its
measured latency. Findings from the pre-intake audit (verified against the current file):

- **Tests 1, 2, 4, 5, 8, 9** — already poll/`expect(...).toBeVisible(...)` on a real UI condition
  and record real elapsed time. No change.
- **Tests 6 and 7** (drag-drop reorder, cross-session drag) — contain `await page.waitForTimeout(100)`
  at lines 264 and 314, but these are the **sleep inside a 100ms poll loop** that waits for the real
  outcome (reorder / cross-session move); the recorded value is `Date.now() - t0` measuring the
  actual outcome, NOT the sleep. These are NOT instances of the anti-pattern — confirm and leave
  them unchanged.
- **Test 3** is the **only** offender (the sole `waitForTimeout` whose duration becomes the recorded
  latency, at line 186). If apply re-confirms this, note it explicitly; fix any additional instance
  only if one is found.

### 3. Update the companion `sync-latency.spec.md` (constitution-mandated)

`app/frontend/tests/e2e/sync-latency.spec.md` exists and documents each test. Its `### 3. Create
window via sidebar + button` section currently reads (steps 3a–3c):

```md
3. If `New window in ${SESSION_B}` button is visible:
   a. Click it, start timer.
   b. If a dialog appears, click its `Create` button.
   c. `waitForTimeout(3000)` and `record`.
```

and its **What it proves** is hedged ("at minimum the create operation completes within a reasonable
budget"). Per the constitution's **Test Companion Docs** rule, this sibling `.spec.md` MUST be
updated in the **same commit** to reflect the changed steps: rewrite step 3c to describe counting
window rows under SESSION_B before the click and polling until the count increases (recording that
latency), and tighten **What it proves** to state the optimistic ghost window appears in ≤500ms (so
the test fails if create regresses to SSE-dependent). If any other test is modified during the
audit (step 2), update its `.spec.md` section too — but the expectation is that only section 3
changes.

## Affected Memory

No memory updates. This is an implementation/test-quality change with no spec-level behavior change
— the production optimistic-create behavior is unchanged and already documented. (Per the intake
template guidance, implementation-only changes don't need memory updates.)

## Impact

- **Modified**: `app/frontend/tests/e2e/sync-latency.spec.ts` — test 3's measured region only.
- **Modified (same commit, mandatory)**: `app/frontend/tests/e2e/sync-latency.spec.md` — section
  `### 3. Create window via sidebar + button` (What it proves + steps).
- **No production source changes**: the optimistic create path in `app/frontend/src/app.tsx`
  (`useOptimisticAction` / `addGhostWindowStore`) and `window-store.ts` are unchanged.
- **Test execution**: run via `just test-e2e "sync-latency"` (port 3020, isolated `rk-test-e2e`
  tmux server) per project testing conventions — never `npx playwright test` directly.
- **No API, dependency, or backend impact.**
- **Distinct from backlog `sl03`**: the optimistic-create *production* work is already DONE; this
  change is purely test-quality — making an existing test measure what it claims to measure. Do not
  re-scope into production optimism work.

## Open Questions

- None blocking. The exact sidebar selector for "a new window row under SESSION_B" is resolved at
  apply time against the rendered DOM (mirroring test 1's row-count pattern); it is a low-risk,
  easily-reversed implementation detail, not an open design question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `fix` (test-quality fix to a false-signal e2e test) | Description and backlog lead with "fix:"; keyword rule #1 ("fix") matches first. The work fixes a misleading/broken test signal. | S:95 R:90 A:95 D:90 |
| 2 | Certain | Update `sync-latency.spec.md` in the same commit | Constitution "Test Companion Docs" rule is mandatory for any `*.spec.ts` change under `app/frontend/tests/`; companion file verified present and documents test 3. | S:95 R:85 A:98 D:95 |
| 3 | Certain | No production source changes | Backlog and description state production optimism is DONE; verified `app.tsx:477-498` fires `onOptimistic -> addGhostWindowStore` with rollback. Scope is test-only. | S:95 R:80 A:95 D:90 |
| 4 | Certain | Test 3 is the only fixed-sleep-as-measurement offender; tests 6 & 7's `waitForTimeout(100)` are poll-loop sleeps, not measurements | Verified against the file: line 186 sleep is recorded; lines 264/314 sit inside 100ms poll loops that record the real outcome elapsed. | S:90 R:85 A:95 D:85 |
| 5 | Confident | Detect "a new window row appeared" by counting window rows under SESSION_B and polling for the count to increase (mirror test 1), rather than matching the auto-derived name | The window name is unpredictable (noted in the test); test 1 already uses a row-count-increase poll for the session-level analog — the obvious, consistent pattern. | S:80 R:85 A:80 D:70 |
| 6 | Confident | Use a short bounded appearance timeout (~8s) consistent with the file's other measured waits; `t0` started immediately before the action keeps the recorded number a true latency | The file uses `8_000` for appearance polls; the timeout bounds only the failure case, not the measured value (unlike the old fixed sleep). | S:80 R:88 A:82 D:75 |
| 7 | Confident | Keep the existing `if (newWinBtn.isVisible())` guard and SKIP branch; change only the measured region | Minimizes blast radius; the guard handles the not-expanded case and is orthogonal to the measurement fix. | S:82 R:90 A:85 D:80 |
| 8 | Tentative | Exact sidebar selector for a window row under SESSION_B resolved at apply time against the rendered DOM | The window-row selector (vs. test 1's session-level `Navigate to ` prefix) is not verbatim in hand; low-risk, reversible, decided during apply by inspecting the real sidebar. | S:55 R:80 A:60 D:55 |

8 assumptions (4 certain, 3 confident, 1 tentative, 0 unresolved).
