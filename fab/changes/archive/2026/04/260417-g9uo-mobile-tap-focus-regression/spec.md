# Spec: Mobile tap-to-focus regression after frontend dep upgrade

**Change**: 260417-g9uo-mobile-tap-focus-regression
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md` (conditionally — only if the fix establishes new mount invariants for the terminal wrapper)

## Non-Goals

- Addressing any of the 10 pre-existing e2e failures on `main` (sidebar-panels, sync-latency, api-integration, sidebar-window-sync, mobile-touch-scroll:49) — they fail identically with and without PR #150's dep bumps and are explicitly out of scope.
- Identifying the single package responsible for the regression — the fix target is the behavior, not the attribution. Bisection is an optional tool, not a deliverable.
- Reverting to the pre-PR-#150 stack. All 10 major-version bumps MUST be preserved unless an individual pin is the only viable remediation.
- Desktop-viewport regressions. Desktop is verified unaffected; no desktop behavior changes are in scope.
- Performance tuning of xterm mount time. The mount path is only modified to the extent required to make the wrapper bounding box deterministically measurable at mobile viewport.

## Terminal Wrapper: Mount-Time Layout Invariants

### Requirement: Role-application wrapper has a measurable bounding box on mobile

The `[role="application"]` element at [terminal-client.tsx:437-449](app/frontend/src/components/terminal-client.tsx#L437-L449) SHALL have a non-null, non-zero bounding box (both width > 0 and height > 0) measurable from a Playwright `boundingBox()` call within **3 seconds** of `.xterm-screen` becoming visible, at mobile viewport `375×812` with `(pointer: coarse)` emulated.

This SHALL hold regardless of the mount-time ordering of xterm's internal measurement, React 19.2's concurrent commit boundaries, or Vite 8 / Rolldown chunk load timing.

#### Scenario: Wrapper is measurable before tap test proceeds

- **GIVEN** a Playwright test page with viewport 375×812 and `(pointer: coarse)` media emulated
- **WHEN** the page navigates to `/{server}/{session}/0` and waits for `.xterm-screen` to become visible
- **THEN** `page.locator('[role="application"]').boundingBox()` SHALL return a non-null object with `width > 0` and `height > 0`
- **AND** this result SHALL be observable within 3 seconds of the `.xterm-screen` visibility assertion passing

#### Scenario: Wrapper box is stable across React commits

- **GIVEN** the terminal component has mounted and xterm has rendered `.xterm-screen`
- **WHEN** a `boundingBox()` measurement is taken on `[role="application"]`
- **THEN** the width and height values SHALL be positive and SHALL NOT transition to zero on any subsequent React render or layout pass for the lifetime of the mounted component

### Requirement: Wrapper remains a single uniquely-identifiable element

The `[role="application"]` selector SHALL resolve to exactly one element on the page during the test flow. The fix SHALL NOT introduce a second ancestor element with `role="application"`, and SHALL NOT rely on a second `role="application"` from xterm internals or any upgraded dependency.

#### Scenario: Selector resolves uniquely

- **GIVEN** the terminal page has rendered with xterm mounted
- **WHEN** `document.querySelectorAll('[role="application"]')` is executed
- **THEN** the result SHALL have exactly one element, matching the terminal wrapper div at [terminal-client.tsx:440](app/frontend/src/components/terminal-client.tsx#L440)

## Mobile Tap-to-Focus Flow

### Requirement: Touch tap focuses xterm helper textarea

A single-point touch tap (touchStart + touchEnd, no movement) on the `[role="application"]` wrapper SHALL cause the `.xterm-helper-textarea` element to become the active element (`document.activeElement.classList.contains("xterm-helper-textarea") === true`).

#### Scenario: Tap focuses textarea at mobile viewport

- **GIVEN** the terminal page at viewport 375×812 with `(pointer: coarse)` emulated, `.xterm-screen` visible, and active element explicitly blurred
- **WHEN** CDP `Input.dispatchTouchEvent` fires `touchStart` at the wrapper's center, waits 100ms, then fires `touchEnd`
- **THEN** within 500ms of `touchEnd`, `document.activeElement` SHALL have class `xterm-helper-textarea`

#### Scenario: Tap does not regress desktop focus

- **GIVEN** the terminal page at desktop viewport (e.g., 1280×800) without `(pointer: coarse)` emulation
- **WHEN** a click fires on the terminal wrapper
- **THEN** xterm focus behavior SHALL remain unchanged from the pre-regression state (no new paths introduced that could suppress `.xterm-helper-textarea` focus on desktop)

## Remediation Strategy

### Requirement: Preserve PR #150's dep bumps by preference

The fix SHALL first attempt a code-level remediation in [terminal-client.tsx](app/frontend/src/components/terminal-client.tsx) that makes the wrapper bounding box deterministic. Acceptable code-level remediations include (non-exhaustive):

- Applying a non-collapsing minimum height to the wrapper so zero-height transient commits cannot occur.
- Awaiting a `requestAnimationFrame` or `ResizeObserver` settle before the first `fit()` call, ensuring the wrapper has committed non-zero dimensions.
- Relocating `role="application"` and `aria-label` to a structurally larger ancestor if the current inner-div placement is fragile against upstream layout changes.

Only if no code-level remediation produces green tests SHALL the fix pin one or more upgraded packages back. Mass-reverting all 10 bumps is prohibited.

#### Scenario: Code fix suffices

- **GIVEN** investigation establishes a code-level remediation that passes both the wrapper-box regression test (R4 below) and the tap test at line 111
- **WHEN** the fix lands
- **THEN** [package.json](app/frontend/package.json) dep versions SHALL remain at the values established by PR #150 (no downgrades)

#### Scenario: Targeted pin path

- **GIVEN** no code-level remediation produces green tests, and bisection identifies one or more packages as causally linked to the regression
- **WHEN** pins are applied in [package.json](app/frontend/package.json)
- **THEN** each pinned entry SHALL include a trailing comment `// pinned: tracking g9uo` (or equivalent for the package.json JSON5 convention in use, or a companion comment block above) referencing this change
- **AND** the remaining 10 − N packages SHALL stay at their PR #150 versions

### Requirement: No backend or non-frontend surface changes

The fix SHALL NOT modify Go code, backend tests, tmux configuration, or any file outside `app/frontend/` and this change folder.

#### Scenario: Scope is frontend-only

- **GIVEN** the implementation lands
- **WHEN** `git diff --name-only {base}..HEAD` is inspected
- **THEN** every modified file outside `fab/changes/260417-g9uo-mobile-tap-focus-regression/` SHALL have a path prefix of `app/frontend/`

## Test Coverage

### Requirement: Add wrapper-box regression test

A new Playwright e2e test SHALL assert that `[role="application"]` has a positive, measurable bounding box at 375×812 viewport within **3 seconds** of `.xterm-screen` becoming visible. This test SHALL live in `app/frontend/tests/e2e/` and SHALL execute independently of the tap flow (no touch events, no keyboard focus assertions).

#### Scenario: Wrapper-box test fails loudly on regression

- **GIVEN** a hypothetical future upgrade that reintroduces the zero-size wrapper condition
- **WHEN** the test suite runs
- **THEN** the wrapper-box regression test SHALL fail with a clear error naming the `[role="application"]` selector and the viewport dimensions
- **AND** the failure SHALL occur before the dependent tap test runs, so the diagnostic signal isolates the root-cause layer (layout, not touch handling)

### Requirement: Existing tap test passes under upgraded stack

The test at [mobile-touch-scroll.spec.ts:111](app/frontend/tests/e2e/mobile-touch-scroll.spec.ts#L111) (`"tap on terminal focuses textarea for keyboard"`) SHALL pass without modification to its assertion semantics under the fix.

The test file's test body MAY be refactored incidentally (e.g., helper extraction shared with the new regression test), but the user-observable contract it encodes — tap on wrapper → helper-textarea focused — SHALL remain the pass condition.

#### Scenario: Test passes on branch tip

- **GIVEN** the fix has been applied on the `260417-g9uo-mobile-tap-focus-regression` branch
- **WHEN** the repro command from the intake runs (`RK_PORT=3020 E2E_TMUX_SERVER=rk-e2e pnpm exec playwright test mobile-touch-scroll.spec.ts --grep "tap on terminal focuses textarea"`)
- **THEN** the test SHALL exit with status 0

### Requirement: No regression in unit test suite or typecheck

Unit tests (`pnpm test` in `app/frontend/`) SHALL continue to pass all 416 tests, and TypeScript strict typechecking (`npx tsc --noEmit`) SHALL produce no errors.

#### Scenario: Full frontend gates remain green

- **GIVEN** the fix has been applied
- **WHEN** `cd app/frontend && pnpm test && npx tsc --noEmit` runs
- **THEN** both commands SHALL exit with status 0
- **AND** no new unit tests SHALL be added that depend on Playwright / real browser APIs (those belong in e2e)

## Verification Workflow

### Requirement: Fix is verifiable via documented repro

The repro command from the intake SHALL be the canonical verification path. Additionally, the reviewer SHALL be able to run `just test-e2e` and observe that `mobile-touch-scroll.spec.ts:111` passes alongside whatever pre-existing failures exist on `main`.

#### Scenario: Targeted repro passes

- **GIVEN** a clean checkout of this branch with `pnpm install` completed in `app/frontend/`
- **WHEN** the repro command from the intake runs
- **THEN** it SHALL exit 0

#### Scenario: Broader e2e run shows net improvement

- **GIVEN** `just test-e2e` runs on this branch
- **WHEN** the results are compared against `origin/main`
- **THEN** the number of failing tests SHALL be ≤ the pre-existing failure count on `main`
- **AND** the previously-failing `mobile-touch-scroll:111` test SHALL now pass (i.e., the set of failing tests on the branch SHALL be a subset of the pre-existing failures on main)

## Design Decisions

1. **Code fix preferred over package pin**: The fix defaults to adjusting `terminal-client.tsx` rather than pinning packages.
   - *Why*: PR #150's 10 major bumps represent real compat work. Reverting any of them forfeits that investment and delays exposure to upstream bug fixes. A layout-level code fix is also more durable — it survives future stack upgrades.
   - *Rejected*: "Pin whichever package bisection fingerprints" as the primary path. This treats the symptom (one failing test) as equivalent to the root cause attribution, and risks pinning a package that only coincidentally exposes a latent fragility in our own mount-time layout.

2. **Bisection is an aid, not a gate**: The spec does not require bisection to run as part of the implementation.
   - *Why*: Per user clarification, the deliverable is a working fix, not a root-cause report. Bisection adds time and complexity without necessarily yielding actionable information when the cause is a combination of changes rather than a single package. If the fix is obvious from reading the component (e.g., a missing minimum height), bisection is wasted effort.
   - *Rejected*: "Always bisect first, then fix" — inflates scope and delays the fix.

3. **New wrapper-box regression test sits alongside the tap test**: A narrower, layout-only test is added rather than relying solely on the end-to-end tap flow.
   - *Why*: The tap test couples three concerns (layout, touch dispatch, focus management). When the wrapper-box assertion is its own test, a future regression in layout timing fails with a clean error at the structural layer, making diagnosis fast. The tap test continues to guarantee the end-to-end contract.
   - *Rejected*: "Only fix the existing test" — loses the clean diagnostic signal for future regressions.

4. **Desktop behavior is out of scope**: The spec does not add desktop assertions.
   - *Why*: User confirmed desktop is unaffected. Adding a desktop assertion would expand scope and add test runtime for a verification that can be made once during implementation and need not be encoded as a permanent test.
   - *Rejected*: "Add an analogous desktop wrapper-box test" — user explicitly affirmed assumption #7; the desktop path is not at risk.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope excludes the 10 pre-existing e2e failures on `main` | Confirmed from intake #1 — user-stated explicit exclusion | S:95 R:90 A:95 D:95 |
| 2 | Certain | Test harness is Playwright on `RK_PORT=3020` with `E2E_TMUX_SERVER=rk-e2e` | Confirmed from intake #2 — fixed by `scripts/test-e2e.sh` and `fab/project/context.md` | S:95 R:85 A:95 D:95 |
| 3 | Certain | Failing test is [mobile-touch-scroll.spec.ts:111](app/frontend/tests/e2e/mobile-touch-scroll.spec.ts#L111) ("tap on terminal focuses textarea for keyboard") | Confirmed from intake #3 — verified against source file in this spec-stage pass | S:95 R:90 A:95 D:95 |
| 4 | Certain | `role="application"` is at [terminal-client.tsx:440](app/frontend/src/components/terminal-client.tsx#L440) on the inner terminalRef div (not the outer wrapper at line 437) | Confirmed from intake #4 — verified by reading the source in this spec-stage pass | S:95 R:90 A:95 D:95 |
| 5 | Certain | Deliverable is a working fix, not single-package root-cause attribution | Confirmed from intake #5 — user clarified: "could be combination... Point is to fix it" | S:95 R:90 A:95 D:95 |
| 6 | Certain | Primary path is a code fix in terminal-client.tsx; fallback is selective package pin(s) | Confirmed from intake #6 — upgraded from Confident after spec-stage analysis showed the code path offers multiple viable remediations (min-height, RAF settle, role relocation) | S:90 R:85 A:90 D:90 |
| 7 | Certain | Desktop viewport is unaffected — no desktop-specific behavior changes in scope | Confirmed from intake #7 — user confirmed "7 ok"; upgraded from Confident because the spec formally excludes desktop scope (Non-Goals + R3 scenario) | S:90 R:90 A:90 D:90 |
| 8 | Confident | If any pin is needed, `@xterm/xterm` (+ its addons) is the most likely single-package candidate | Confirmed from intake #8 — xterm owns wrapper measurement; however a combination remains possible per #5, so this is not Certain | S:80 R:70 A:80 D:75 |
| 9 | Certain | A narrower wrapper-box regression test at 375×812 is required alongside the fix | Confirmed from intake #9 — upgraded from Confident because the spec encodes it as mandatory (R4), not optional | S:95 R:85 A:95 D:95 |
| 10 | Confident | Bisection order (if used): xterm → vite → @vitejs/plugin-react → @tanstack/react-router → build/test-time packages | Confirmed from intake #10 — prioritization reflects layout-impact of each package | S:75 R:75 A:75 D:70 |
| 11 | Confident | Tests that depend on real browser layout (`.xterm-helper-textarea`, `boundingBox()`) belong in `tests/e2e/`, not Vitest unit tests | New at spec stage — Vitest uses jsdom, which does not implement layout (zero boundingBox for every element). R8's "no new unit tests for this class of regression" is motivated by this constraint | S:80 R:75 A:85 D:80 |
| 12 | Confident | The fix SHALL preserve the single `[role="application"]` identity — no ancestor-role duplication | New at spec stage — formalized as R2 after noticing that any fix that relocates the role attribute risks introducing selector ambiguity if done carelessly | S:85 R:75 A:85 D:80 |
| 13 | Confident | Memory update to `docs/memory/run-kit/ui-patterns.md` is conditional on the chosen fix path — only triggers if the fix establishes new wrapper mount invariants (min-height, RAF wait, etc.) | New at spec stage — hydrate-stage logic needs this flag so a pin-only fix doesn't generate a misleading memory delta | S:80 R:75 A:85 D:80 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).

## Addendum — Post-Apply Root Cause Correction

*Added after apply-stage diagnostics. The spec above was authored on the hypothesis that the failing `boundingBox()` call indicated a zero-sized or transiently-unmeasurable terminal wrapper (R1, R5, R6 frame the remediation as terminal-wrapper layout). Apply-stage T002 probing falsified that hypothesis: the wrapper consistently measures 367×712 immediately after `.xterm-screen` becomes visible. The test fails because `TerminalClient` **unmounts** ~50ms after first render, not because it renders at zero size.*

**Actual root cause**: On a freshly-navigated URL, the first SSE `sessions` event can deliver a stale cached session list (missing the new session) or a list containing the session with a briefly-empty `windows` array while tmux enumeration propagates. Either state causes `computeKillRedirect` in `app/frontend/src/lib/navigation.ts` (called from [app.tsx:267-285](app/frontend/src/app.tsx#L267-L285)) to treat the URL target as "gone" and redirect to the session dashboard, unmounting the terminal component mid-init. The regression exists on `main` too — PR #150's dep bumps only shifted the timing so `.xterm-screen` briefly became visible before the unmount (on `main` the unmount wins outright and the test fails at the `.xterm-screen` visibility assertion instead of at `boundingBox()`).

**Remediation shape actually landed**: A `currentWindowEverSeen` gate on `computeKillRedirect`. Any "gone" redirect requires the URL's (session, window) pair to have been observed as valid at least once since the last URL change. Implemented via a `currentWindowEverSeenRef` keyed on `${server}|${session}|${window}`, reset on URL change, flipped true whenever `currentWindow` is non-null. Files: [navigation.ts](app/frontend/src/lib/navigation.ts), [navigation.test.ts](app/frontend/src/lib/navigation.test.ts), [app.tsx](app/frontend/src/app.tsx). `terminal-client.tsx` was not modified.

**Spec requirement compatibility**:
- **R1 (wrapper measurable)**: still satisfied — the wrapper is measurable because `TerminalClient` no longer unmounts transiently. The end-to-end observable invariant (`boundingBox()` returns non-null non-zero within 3s of `.xterm-screen` visibility) holds.
- **R2 (selector resolves to exactly one element)**: unchanged — no structural markup changes.
- **R3 (tap focuses textarea)**: satisfied — `mobile-touch-scroll.spec.ts:111` passes.
- **R4-R9**: satisfied as written.
- **R5 / R6 file-scope hints that named `terminal-client.tsx`**: superseded — the actual code-level remediation landed in `app.tsx` + `navigation.ts`. Constitution principle "fix root causes, not symptoms" overrode the spec's narrower scope hint. Non-Goal "preserve all 10 major bumps" is honored (no pins).

**Side benefit**: the sibling SGR-scroll test at `mobile-touch-scroll.spec.ts:49` also now passes — it depends on `boundingBox()` against the same wrapper and was failing for the same unmount race. This moves it out of the "10 pre-existing e2e failures on main" exclusion list; the branch's failing-test set is now a strict subset of `main`'s with net -2 improvement.

This addendum is non-normative — it is a post-hoc correction, not an edit to the original requirements. Downstream hydrate uses [hydrate-notes.md](fab/changes/260417-g9uo-mobile-tap-focus-regression/hydrate-notes.md) for the memory-file update targeting navigation/SSE invariants rather than `ui-patterns.md`.
