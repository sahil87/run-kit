# Intake: Mobile tap-to-focus regression after frontend dep upgrade

**Change**: 260417-g9uo-mobile-tap-focus-regression
**Created**: 2026-04-17
**Status**: Draft

## Origin

User-initiated bug report, one-shot mode. After cherry-picking PR #150's
major-version frontend dep bumps onto this branch, one previously-green
e2e test regresses. All other verification gates (backend tests, unit
tests, typecheck, production build) remain clean. The 10 other e2e
failures are pre-existing on `main` — explicitly out of scope.

> # Mobile tap-to-focus regression after frontend dep upgrade
>
> ## Context
> The run-kit frontend (`app/frontend/`) was upgraded to latest majors:
> - vite 7.3 → 8.0 (ships Rolldown instead of Rollup)
> - vitest 4.0 → 4.1
> - typescript 5.7 → 6.0
> - @vitejs/plugin-react 5.1 → 6.0
> - @xterm/xterm 5.5 → 6.0
> - @xterm/addon-fit 0.10 → 0.11, @xterm/addon-web-links 0.11 → 0.12
> - @tanstack/react-router 1.114 → 1.168
> - @types/node 22 → 25, jsdom 28 → 29
>
> All 416 unit tests pass. Production build passes. All backend tests pass.
>
> ## The failing test
> `app/frontend/tests/e2e/mobile-touch-scroll.spec.ts:111` — "tap on
> terminal focuses textarea for keyboard"
>
> Flow:
> 1. Sets viewport to 375×812 and mocks a touch device
> 2. Navigates to `/${server}/${session}/0`
> 3. Asserts `.xterm-screen` is visible — PASSES (xterm renders)
> 4. waitForTimeout(2000)
> 5. Blurs active element
> 6. Calls `page.locator('[role="application"]').boundingBox()` — **times out at 30s**
>
> `[role="application"]` is set on the outer terminal wrapper div at
> `app/frontend/src/components/terminal-client.tsx:437-449`.
>
> xterm mounts *inside* this div. So `.xterm-screen` being visible while
> the parent `[role="application"]` is undetectable is the paradox —
> Playwright's `boundingBox()` returns null when the element is not
> rendered, hidden, display:none, or zero-size.
>
> ## What's known
> - Only fails at mobile viewport (375×812). No confirmed failure at desktop.
> - Only the tap test (line 111) regresses. The sibling SGR-scroll test
>   (line 49) was already failing on main pre-upgrade.
> - Confirmed regression vs. baseline: stashed the upgrade, ran
>   `bash scripts/test-e2e.sh` on plain `origin/main` — this test passed
>   there. Other 10 e2e failures are pre-existing on main.
> - `.xterm-screen` class still exists in @xterm/xterm 6.0's CSS — not a
>   CSS rename.
> - Reproduced consistently in isolation with
>   `pnpm exec playwright test mobile-touch-scroll.spec.ts --grep "tap on terminal focuses textarea"`
>   against a dev server started with `RK_PORT=3020 just dev`.
>
> ## Hypotheses to investigate
> 1. React 19.2 concurrent rendering — outer wrapper div may briefly
>    commit zero height on mobile before xterm measures and inflates it,
>    and Playwright's `boundingBox()` may now hit the wrong microtask
>    boundary.
> 2. xterm 6 mount-order change — xterm 6 may measure/lay out on a
>    different microtask than v5, leaving the `role="application"`
>    parent at 0 height when `.xterm-screen` becomes visible.
> 3. Vite 8 + Rolldown chunking — `manualChunks` was converted from
>    object to function form. In dev mode this shouldn't matter, but
>    worth checking if xterm chunk load timing changed.
> 4. Tailwind 4.2 `touch-none` class — sets `touch-action: none` and
>    shouldn't affect bounding box, but worth double-checking compiled
>    CSS.
>
> ## Exclusions
> - 10 pre-existing e2e failures on main (sidebar-panels, sync-latency,
>   api-integration, sidebar-window-sync, mobile-touch-scroll:49) are
>   **not** in scope — they fail identically before and after the upgrade.
>
> ## Goal
> Either fix the tap test to pass under the upgraded stack, or identify
> the specific upgrade that caused the regression and pin that one
> package back. If pinning, justify why the rest of the major bumps stay.

## Why

**Problem**: After a clean-on-paper dependency upgrade (typecheck + unit
tests + build + backend tests all green), one mobile Playwright e2e test
regresses. The failing selector (`[role="application"]`) is the outer
terminal wrapper — so even though xterm visually renders (child
`.xterm-screen` is visible), Playwright cannot acquire a bounding box
on the parent. This is either a real runtime mobile regression (the
terminal wrapper has zero size or is detached from layout briefly) or a
Playwright timing artifact (harness races with React/xterm mount order
on mobile specifically).

**Consequence of not fixing**: The upgrade ships with a known mobile
regression covered by a test that previously passed. Mobile keyboard
focus is a core UX flow — if the bug is real (not just a test-timing
artifact) the terminal input may actually be unusable on touch devices
at 375px. Either way, a previously-green test cannot be allowed to
regress without a deliberate decision about which package to blame.

**Approach rationale**: The deliverable is a working fix — not a
forensic root-cause report. The regression may be caused by a single
package, a combination of interacting changes, or a mount-timing race
that any of several upgrades could expose. Bisection is an optional
investigation aid, used only when a direct code fix isn't obvious.
Preference order: (a) code fix in [terminal-client.tsx](app/frontend/src/components/terminal-client.tsx)
that makes the test robust against whatever mount-order change the new
stack introduces; (b) if no clean code fix, selectively pin one or more
packages back. Mass-reverting all 10 bumps is the last resort — that
would surrender the compat work already done in PR #150.

## What Changes

### Primary path — code fix in terminal-client

Goal: make the terminal wrapper robust against whatever mount-order
change the new stack introduces, without caring which specific package
triggered it.

Adjust [terminal-client.tsx:437-449](app/frontend/src/components/terminal-client.tsx#L437-L449)
so the `role="application"` wrapper is guaranteed non-zero size and
visible to Playwright before xterm's first internal render. Candidate
adjustments (pick what the investigation supports):

- Set a non-collapsing minimum height on the wrapper so zero-size
  flashes can't happen.
- Await a layout tick (`requestAnimationFrame` or `ResizeObserver`
  settle) before the first `fit()` call.
- Move `role="application"` + `aria-label` onto an already-sized
  ancestor if the current placement is structurally fragile.

Add a narrower regression test asserting the wrapper has a positive
bounding box on 375×812 viewport within a short timeout — independent
of the full tap flow. This catches the root-cause class of bug faster
than the end-to-end tap test and is valuable regardless of which path
resolves the current regression.

Keep all 10 major bumps.

### Fallback path — selective package pin(s)

Only if no clean code fix emerges, or if the fix conflicts with the
new stack's runtime behavior:

- Pin one or more packages in [app/frontend/package.json](app/frontend/package.json)
  to their last-known-green versions. A combination may be required —
  don't assume a single-package revert will work.
- Document the pin(s) with a `// pinned: tracking #{change-id}` comment
  in `package.json` so future bumps know to retest the mobile flow.
- Preserve as many of the 10 majors as possible.

### Optional investigation aid — bisection

If the primary code fix isn't obvious from inspecting the terminal
component, bisect the 10 package bumps to narrow the search space.
Start with the most layout-sensitive: `@xterm/xterm` (+ addons), then
`vite`, then `@vitejs/plugin-react`, then `@tanstack/react-router`.
TypeScript, `@types/node`, jsdom, and vitest are build/test-time only
and deprioritized.

Bisection protocol for each candidate:

```bash
# From app/frontend/
pnpm add {package}@{previous-version}  # pin one back
cd ../..
tmux -L rk-e2e kill-server 2>/dev/null
RK_PORT=3020 just dev &
sleep 8
cd app/frontend
RK_PORT=3020 E2E_TMUX_SERVER=rk-e2e \
  pnpm exec playwright test mobile-touch-scroll.spec.ts \
  --grep "tap on terminal focuses textarea"
```

This is a **tool**, not a required step — if the fix is obvious from
reading the component, skip it.

### Repro steps (both branches)

```bash
# From repo root
pnpm install   # at app/frontend/
tmux -L rk-e2e kill-server 2>/dev/null
RK_PORT=3020 just dev &
sleep 8
cd app/frontend
RK_PORT=3020 E2E_TMUX_SERVER=rk-e2e \
  pnpm exec playwright test mobile-touch-scroll.spec.ts \
  --grep "tap on terminal focuses textarea"
```

Acceptance: this command exits 0 on the branch where the fix lives.

### Out of scope

The 10 pre-existing e2e failures (sidebar-panels, sync-latency,
api-integration, sidebar-window-sync, mobile-touch-scroll:49) are
**not** touched by this change. They fail identically on `main` pre-
and post-upgrade.

## Affected Memory

- `run-kit/ui-patterns.md`: (modify) only if the primary code fix
  changes the terminal wrapper's mount invariants (e.g., adds a
  required minimum height or a layout-tick await). Skip if the fallback
  pin path is taken.

## Impact

- **Code**: [terminal-client.tsx](app/frontend/src/components/terminal-client.tsx)
  (primary path)
- **Deps**: [package.json](app/frontend/package.json) +
  [pnpm-lock.yaml](app/frontend/pnpm-lock.yaml) (fallback path —
  possibly one or more pins)
- **Tests**: [mobile-touch-scroll.spec.ts](app/frontend/tests/e2e/mobile-touch-scroll.spec.ts)
  — the failing test; plus a narrower wrapper-size regression test
- **No backend impact** — Go code untouched
- **No other UI impact expected** — scoped to the terminal wrapper's
  mount-time layout on mobile

## Open Questions

None blocking. Investigation details (which mount adjustment works,
whether any pin is needed, combination vs. single) resolve during the
apply stage.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope excludes the 10 pre-existing e2e failures on `main` | User explicitly stated these fail identically before and after the upgrade and are out of scope | S:95 R:90 A:95 D:95 |
| 2 | Certain | Test framework is Playwright against a dev server on port 3020 with tmux server `rk-e2e` | Fixed by existing `scripts/test-e2e.sh` and project conventions in `fab/project/context.md` | S:95 R:85 A:95 D:95 |
| 3 | Certain | Failing test file and line: `app/frontend/tests/e2e/mobile-touch-scroll.spec.ts:111` ("tap on terminal focuses textarea for keyboard") | Quoted verbatim from user input with line and title | S:95 R:90 A:95 D:95 |
| 4 | Certain | The `role="application"` attribute lives on the terminal wrapper div at `app/frontend/src/components/terminal-client.tsx:437-449` | Verified by user in intake; also visible in the current source file | S:95 R:90 A:95 D:95 |
| 5 | Certain | Deliverable is a working fix, not a single-package root-cause attribution | Clarified — user confirmed: "doesn't matter so much... could be combination... Point is to fix it". Bisection demoted from required step to optional investigation aid | S:95 R:90 A:95 D:95 |
| 6 | Confident | Primary path is a code fix in terminal-client.tsx; fallback is selective package pin(s), possibly a combination | Follows from #5 — code fix is the preferred lever because it preserves all 10 compat bumps from PR #150 | S:85 R:75 A:85 D:80 |
| 7 | Confident | Desktop viewport is unaffected; only mobile (375×812) regresses | Clarified — user confirmed "7 ok". Investigation should still include an explicit desktop assertion to verify no silent desktop-side regression | S:80 R:75 A:85 D:85 |
| 8 | Confident | If any pin is needed, `@xterm/xterm` (+ its addons) is the most likely single candidate — xterm is responsible for measuring/inflating the parent wrapper, which directly matches the zero-size symptom | Clarified — user confirmed "8 ok". A combination may still be required (per #5), but xterm is the highest-prior-probability starting point | S:80 R:70 A:80 D:75 |
| 9 | Confident | A narrower wrapper-bounding-box regression test at 375×812 should be added alongside the fix, independent of which path (code fix vs. pin) resolves the current failure | Clarified — user confirmed "9 ok" | S:85 R:85 A:85 D:85 |
| 10 | Confident | Bisection order (if used): `@xterm/xterm` → `vite` → `@vitejs/plugin-react` → `@tanstack/react-router` → build/test-time packages last | Derived from the layout-sensitivity of each package; user's hypotheses in Origin prioritize xterm and React-mount-timing causes | S:75 R:75 A:75 D:70 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved). Run /fab-clarify if you want to revisit.
