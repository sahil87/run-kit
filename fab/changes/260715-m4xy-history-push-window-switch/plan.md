# Plan: History Push on Window Switch

**Change**: 260715-m4xy-history-push-window-switch
**Intake**: `intake.md`

## Requirements

### Window Navigation: Browser History

#### R1: User-initiated window switches push a browser history entry
The `navigateToWindow` callback in `app/frontend/src/app.tsx` SHALL navigate with **push** semantics (no `replace: true`) so every user-initiated window switch routed through it — sidebar same-server click, window-switcher ▾, command palette, keyboard shortcut, spawn-agent same-server branch, and any board/tile entry point that delegates to it — creates a distinct browser history entry.

- **GIVEN** a user is viewing window `w1` on `server1`
- **WHEN** the user switches to `w5` (same server) via a sidebar row click, the window-switcher ▾, the command palette, or a keyboard shortcut
- **THEN** a new browser history entry is pushed (the outgoing `w1` entry is preserved, not replaced)
- **AND** clicking the top-bar ◀ arrow (browser Back) returns to `w1`'s URL and renders it (its terminal / heading appears)
- **AND** clicking ▶ (browser Forward) returns to `w5`

#### R2: No dedup of consecutive or revisited history entries
The fix SHALL NOT collapse, dedup, or short-circuit consecutive/revisited window entries. Each user-initiated switch pushes an entry regardless of whether the target equals a previously-visited window.

- **GIVEN** a user navigates `w1 → w5 → w1` via in-app window switches
- **WHEN** the user presses Back repeatedly
- **THEN** the history retraces every hop — Back lands on `w5`, then on the first `w1` — because three distinct entries were pushed (no dedup)
- **AND** no early-return guard is added for `windowId === current` (a same-window re-click may push a duplicate entry — accepted under the explicit no-dedup decision)

#### R3: SSE URL-writeback and lens-switch navigations remain `replace`
The SSE URL-writeback effect (`app.tsx` ~L755–762) and `switchView` (`app.tsx` ~L424–429) SHALL keep `replace: true` — they are OUT OF SCOPE and MUST NOT be modified. tmux-driven URL corrections are not user intent, and same-window lens toggles (tty/web/chat) are per-viewer preferences already persisted to localStorage; Back must not step through either.

- **GIVEN** the diff for this change
- **WHEN** reviewed
- **THEN** the only navigate call with `replace: true` removed is the one inside `navigateToWindow`'s `runSwitch`
- **AND** the SSE-writeback navigate and the `switchView` navigate both still carry `replace: true`

#### R4: Within-server Back/Forward aligns tmux to the landed URL
After a history Back/Forward hop, tmux SHALL be aligned to the landed window's URL by the existing deep-link intent effect (`app.tsx` ~L703–727), whose `hasAlignedToUrlRef` guard re-arms on every `windowParam` change (which a Back/Forward hop always produces). No new alignment code SHALL be added; the implementation MUST verify this holds via the e2e (which asserts the landed window's heading renders — requiring the alignment to have fired).

- **GIVEN** a user pressed Back to a within-server window they reached via an in-app switch
- **WHEN** the URL's window differs from the SSE-active window
- **THEN** the existing intent effect fires `selectWindow` and the landed window's terminal/heading renders (no new code required)

### Testing: History Push Coverage

#### R5: A Playwright e2e proves in-app-switch push semantics
A Playwright e2e SHALL exercise the **in-app switch path** (not `page.goto` full navigations, which always push and therefore never covered this fix). It switches windows via the sidebar (or window-switcher ▾) — `w-a → w-b` (and back to `w-a` for the no-dedup shape) — then asserts `page.goBack()` (or the ◀ arrow) returns to the prior window URL and renders it, and Forward returns. The test SHALL extend the existing history-arrows `test.describe` block in `app/frontend/tests/e2e/window-heading.spec.ts`, and the sibling `window-heading.spec.md` companion SHALL be updated in the same change (constitution: Test Companion Docs).

- **GIVEN** the new e2e
- **WHEN** run via `just test-e2e "window-heading.spec.ts:<line>"`
- **THEN** it builds its history stack with in-app sidebar-click switches (settling each on `aria-current="page"`), Back returns to the prior window's URL and renders its heading, Forward returns to the later window
- **AND** the sibling `.spec.md` documents the new test's proof + numbered steps

### Non-Goals

- No dedup / collapse of consecutive or revisited history entries (explicit user requirement — every hop retraceable).
- No change to the SSE URL-writeback effect or `switchView` (they stay `replace`).
- No change to the already-pushing cross-server sites (`handleSidebarSelectWindow` cross-server branch ~L1967, spawn-agent `onSpawned` cross-server branch ~L2319, `navigateToWaitingTarget` ~L1841).
- No new tmux-alignment code; no slide transition on arrow Back/Forward (HistoryNav bypasses `navigateToWindow` — existing behavior, unchanged).

### Design Decisions

1. **One-line removal in `navigateToWindow`'s `runSwitch`**: delete the `replace: true` property from the single `navigate({...})` call in `runSwitch` (`app.tsx` ~L795) — *Why*: `runSwitch` is the sole closure invoked by BOTH the instant-switch fallback (~L828) and the View-Transitions callback (~L869), so removing the one property gives push semantics on every code path through `navigateToWindow` without touching either call site — *Rejected*: adding a `replace`-boolean parameter to `navigateToWindow` (over-engineering — every user-initiated caller wants push now), and any dedup/early-return guard (contradicts the explicit no-dedup requirement).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Remove the `replace: true` line from the `navigate({...})` call inside `navigateToWindow`'s `runSwitch` in `app/frontend/src/app.tsx` (~L795). Keep `search: {}` and the surrounding closure intact; update the adjacent comment to note the switch now pushes a history entry (push-for-history). Do NOT touch the SSE-writeback navigate (~L755–762) or `switchView` (~L424–429), and add NO dedup/early-return guard. <!-- R1 R2 R3 -->

### Phase 2: Testing

- [x] T002 Add a Playwright e2e to the existing `test.describe("Top-bar heading — anchor, hierarchy dropdown, history arrows (260714-uco1)")` block in `app/frontend/tests/e2e/window-heading.spec.ts` that builds its history stack via **in-app sidebar-click switches** (`nav[aria-label='Sessions'] [data-window-id="@N"] button` → click, settling each on `aria-current="page"`), does `w-a → w-b → w-a` (no-dedup shape), then asserts `page.goBack()` returns to `w-b`'s URL and renders its `Rename window <name>` heading, a further Back returns to the first `w-a`, and `page.goForward()` returns to `w-b`. Reuse the file's `resolveWindow` / `gotoWindow` helpers; URL assertions use the router's numeric id segment (`windowId.slice(1)`, the form `navigateToWindow` writes) — NOT `encodeURIComponent` (that `%40N` form is a `page.goto` artifact and does not match the in-app-switch URL). <!-- R5 R4 -->
- [x] T003 Update the sibling companion `app/frontend/tests/e2e/window-heading.spec.md` in the same change: add a `### {test name}` entry under the 260714-uco1 section documenting (a) what it proves — in-app window switches push distinct history entries with no dedup, Back/Forward retrace within-server hops — and (b) numbered steps mirroring the test body. <!-- R5 -->

### Phase 3: Verification

- [x] T004 Frontend typecheck (`just check` → `pnpm exec tsc --noEmit`; `npx tsc` is unavailable in this env, `just setup`/`pnpm install` was run first) passes clean, then ran the new e2e via `just test-e2e "window-heading.spec.ts:480"` (targeted) — passes. Also confirmed the pre-existing history-arrows test (line 453) still passes (flaky-but-green — a first-attempt timeout consistent with the known "Maximum update depth exceeded" main-branch bug on this spec, green on retry and on a clean re-run; unaffected by this change, which only added a sibling test). <!-- R1 R2 R4 R5 -->

## Execution Order

- T001 blocks T002/T003 (the test asserts the pushed-history behavior the removal produces).
- T002 and T003 are the same commit (constitution: `.spec.ts` + `.spec.md` together).
- T004 runs last (verifies T001–T003).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `navigateToWindow`'s `runSwitch` navigate call no longer carries `replace: true`; every user-initiated window switch through it pushes a browser history entry.
- [x] A-002 R5: A Playwright e2e exercising the in-app-switch path exists in `window-heading.spec.ts` and passes via `just test-e2e`.

### Behavioral Correctness

- [x] A-003 R1: With the fix, an in-app switch `w1 → w5` followed by browser Back returns to `w1`'s URL and renders `w1` (heading/terminal visible) — the within-server hop is retraceable (previously replaced/lost).
- [x] A-004 R2: An in-app sequence `w1 → w5 → w1` yields three history entries — Back retraces every hop (lands on `w5`, then the first `w1`); no dedup/early-return guard was added.
- [x] A-005 R4: The landed window after a Back/Forward hop renders its heading/terminal, confirming the existing deep-link intent effect aligned tmux with no new alignment code.

### Removal Verification

- [x] A-006 R3: The SSE URL-writeback navigate (~L755–762) and `switchView` navigate (~L424–429) both still carry `replace: true`; the diff removes `replace: true` from exactly one navigate call (inside `runSwitch`).

### Scenario Coverage

- [x] A-007 R5: The e2e builds its stack with in-app sidebar clicks (NOT `page.goto`), settling each on `aria-current="page"`, then asserts Back/Forward URL + heading; the pre-existing `page.goto`-based history-arrows test still passes unchanged.

### Edge Cases & Error Handling

- [x] A-008 R2: A same-window re-click (windowId === current) is permitted to push a duplicate entry — no guard suppresses it (accepted no-dedup papercut, verified against TanStack Router's identical-href push behavior during implementation).

### Code Quality

- [x] A-009 Pattern consistency: The change is a minimal one-line removal + comment touch-up, consistent with surrounding navigate-call style; the e2e reuses the file's existing `resolveWindow`/`gotoWindow` helpers and sidebar `[data-window-id]` locator idiom.
- [x] A-010 No unnecessary duplication: No new navigation helper or dedup utility introduced; the existing intent effect handles tmux alignment (no reimplementation).
- [x] A-011 Test companion doc: The `window-heading.spec.md` companion is updated in the same change per the constitution's Test Companion Docs constraint.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change removes a single property (plus adds test coverage) without making any existing code redundant. Reviewed candidates and rejected: the pre-existing `page.goto`-based history-arrows e2e (`window-heading.spec.ts:453`) is NOT redundant against the new in-app-switch test — it uniquely covers the ◀ ▶ arrow buttons themselves (`getByLabel("Go back")`), while the new test covers push semantics via `page.goBack()`; the `pendingClickRef` writeback-suppression machinery remains load-bearing on the Back/Forward path (the intent effect re-arms it per hop).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = remove the single `replace: true` line from `navigateToWindow`'s `runSwitch` navigate call (~app.tsx:795); `runSwitch` is the sole closure both switch paths invoke, so one removal covers all user-initiated switches. Plain push, NO dedup. | Explicit user decision carried from intake ("a lot of things are missing from back history"); code location re-verified — `runSwitch` at L785–801, invoked at L828 (fallback) and L869 (VT callback), `replace: true` only at L795 | S:95 R:85 A:90 D:95 |
| 2 | Certain | SSE URL-writeback (app.tsx ~L755–762) and `switchView` (~L424–429) keep `replace: true` — out of scope, MUST NOT be modified | Explicit intake constraints with rationale; both sites verified in source to carry `replace: true` and are functionally distinct from `runSwitch` | S:95 R:90 A:95 D:95 |
| 3 | Confident | No new tmux-alignment code — within-server Back/Forward rides the existing deep-link intent effect (app.tsx ~L703–727), whose `hasAlignedToUrlRef` guard re-arms on every `windowParam` change | Intake flagged "verify in implementation"; guard keyed on `${server}|${windowParam}` re-arms per hop and cross-server Back exercises this path today — the e2e's heading-render assertion proves alignment fired | S:80 R:75 A:80 D:75 |
| 4 | Confident | E2e builds its history stack via in-app SIDEBAR CLICKS (`[data-window-id] button` → settle on `aria-current="page"`), the established in-app-switch idiom, rather than the window-switcher ▾ | The intake allows either; sidebar-click is the proven pattern in the repo (web-view-lens.spec.ts:216, sidebar-window-sync.spec.ts) and directly exercises `navigateToWindow` — the exact path the fix touches | S:70 R:90 A:85 D:70 |
| 5 | Confident | Test placement: extend the existing history-arrows `test.describe("Top-bar heading — … history arrows (260714-uco1)")` block in `window-heading.spec.ts` + update the sibling `.spec.md`, rather than a new spec file | Intake preference #7; the arrows' behavior already lives there (line 453) and the constitution requires the `.spec.md` companion in the same change; a new file was the fallback if the block grew unwieldy — it does not | S:65 R:90 A:85 D:70 |
| 6 | Confident | Back/Forward assertions use `page.goBack()`/`page.goForward()` (equivalent to the ◀ ▶ arrows, which call `router.history.back()/forward()`), matching the existing history-arrows test's URL + heading assertion style | The intake permits "the ◀ arrow or `page.goBack()`"; `page.goBack()` is the more robust seam (no dependence on arrow enabled-state) and the sibling test already proves the arrows map to browser history | S:70 R:90 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
