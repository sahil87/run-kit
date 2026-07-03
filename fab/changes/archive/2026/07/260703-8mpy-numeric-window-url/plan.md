# Plan: Numeric Window URL — Drop the `%40` from Terminal Route URLs

**Change**: 260703-8mpy-numeric-window-url
**Intake**: `intake.md`

## Requirements

### Router: Terminal Route Param Mapping

#### R1: Numeric URL segment for the window param
The terminal route (`/$server/$window`) SHALL serialize the `window` route param — a tmux window ID of the form `@N` — as its numeric part only (`N`) in the URL, dropping the leading `@`. All navigation call sites continue to pass `window: "@N"` via route params unchanged.

- **GIVEN** a navigation call `navigate({ to: "/$server/$window", params: { server: "testServer", window: "@0" } })`
- **WHEN** the router builds the href
- **THEN** the address-bar URL is `/testServer/0` (no `%40`, no `@`)

#### R2: Idempotent parse restores the `@N` form for consumers and back-compat
The terminal route SHALL parse a URL segment back into the `@N` param form by prepending `@` **only if not already present**, so that (a) every `params.window` consumer keeps receiving `@N`, and (b) old bookmarked `/testServer/%40N` deep links (whose segment decodes to `@N`) resolve to `@N` — never `@@N`.

- **GIVEN** a fresh URL `/testServer/0`
- **WHEN** the route parses the `window` segment
- **THEN** `params.window === "@0"`
- **AND GIVEN** an old bookmarked URL `/testServer/%400` (segment decodes to `@0`)
- **WHEN** the route parses the `window` segment
- **THEN** `params.window === "@0"` (idempotent — not `@@0`)

#### R3: Mapping is centralized at the route boundary with zero call-site changes
The `@`↔numeric mapping SHALL live entirely in the terminal route definition in `app/frontend/src/router.tsx`. No navigation call site and no `params.window` consumer changes. The mapping SHALL be implemented via the modern paired `params: { parse, stringify }` API (supported by the installed `@tanstack/react-router ^1.168.22`), falling back to the legacy `parseParams`/`stringifyParams` pair only if the paired form proves non-straightforward.

- **GIVEN** the mapping is added to the terminal route
- **WHEN** the app builds and type-checks
- **THEN** no call site in `app.tsx` / `board-page.tsx` / `top-bar.tsx` is modified and `tsc --noEmit` passes

#### R4: Extract the mapping as testable pure helpers
The two direction functions SHALL be extracted as exported pure helpers (e.g. `windowIdToUrlSegment` for stringify, `urlSegmentToWindowId` for parse) so they are unit-testable, and covered by unit tests: `@0 → 0` (stringify), `0 → @0` (parse), and idempotency `@0 → @0` (parse of an already-prefixed segment must NOT yield `@@0`).

- **GIVEN** the extracted helpers
- **WHEN** the unit tests run
- **THEN** stringify(`@0`)==`0`, parse(`0`)==`@0`, and parse(`@0`)==`@0` all hold

### Documentation: In-File Comments

#### R5: Route comments reflect the numeric-in-URL form
The terminal-route comment and the canonical-page-names comment in `router.tsx` SHALL be updated to describe the numeric URL segment (the window ID's numeric part; `@N` restored by parse and remaining the identity everywhere in code), replacing the current "the window id (@N) is the only identity in the URL" phrasing.

- **GIVEN** the updated `router.tsx`
- **WHEN** a reader inspects the terminal-route comment and the `/$server/$window → Terminal` canonical line
- **THEN** both describe the numeric URL segment + `@N`-restored-by-parse contract

### Tests: E2E Assertions + Companions

#### R6: E2E URL assertions switch to the numeric segment form
Hard-coded `%40`/encoded-form URL assertions and `page.goto` targets in the affected e2e specs SHALL switch to the numeric segment form (`windowId.slice(1)` or a `\d+` pattern), preserving each test's original intent (including the pre-click regression guard). The matching `.spec.md` companions that mention the encoded form SHALL be updated in the same commit per the constitution's Test Companion Docs rule.

- **GIVEN** the updated specs
- **WHEN** a terminal window is navigated to by click
- **THEN** the asserted URL matches the numeric form `/{server}/{N}` (no `%40`)
- **AND** the `.spec.md` companions no longer describe the encoded `%40` form where the behavior changed

#### R7: Old-form deep-link goto sites remain as back-compat coverage
The old-form `page.goto(...%40N...)` deep links in `echo-latency.spec.ts` and `mobile-touch-scroll.spec.ts` SHALL be left unchanged — they resolve via the idempotent parse and assert no URL form, doubling as incidental back-compat coverage of the old-bookmark path.

- **GIVEN** an old-form `page.goto("/{server}/%40N")` in echo-latency / mobile-touch-scroll
- **WHEN** the test runs against the new router
- **THEN** the terminal route still resolves window `@N` (no change to these sites)

### Non-Goals

- Backend changes — the Go server never parses the SPA page path; API `{windowId}` decoding (`app/backend/api/windows.go`) and API-client `%40` paths (`client.test.ts`) are a separate, unchanged surface.
- `top-bar.tsx` breadcrumb `href` tokens — internal tokens consumed by menu `<button>`s via `handleDropdownNavigate`, never rendered in the URL bar; the encode/decode round-trip is self-consistent and unchanged.
- `boardRoute` — keeps its legacy `parseParams` unchanged; board names need no mapping and an API-style migration is unrelated churn.

### Design Decisions

1. **Drop the `@` from the URL entirely** (`/testServer/0`): map at the route boundary via paired parse/stringify — *Why*: tmux window IDs are always `@`+digits, so stripping `@` is a lossless bijective display mapping, and centralizing it means zero call-site churn — *Rejected*: `pathParamsAllowedCharacters: ['@']` (would only trade `%400` for `@0`, still noisy, and is a router-global setting).
2. **Idempotent parse** (prepend `@` only if absent): *Why*: preserves old `/%40N` bookmarks as `@N` rather than corrupting them to `@@N` — *Rejected*: unconditional prepend (breaks back-compat).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add exported pure helpers `windowIdToUrlSegment` (strip leading `@`) and `urlSegmentToWindowId` (idempotently prepend `@`) to `app/frontend/src/router.tsx`, and wire the terminal route to the modern paired `params: { parse, stringify }` API using them (replacing the current `parseParams` pass-through). `boardRoute` untouched. <!-- R1 R2 R3 R4 -->
- [x] T002 Update the terminal-route comment (`router.tsx` ~lines 49–51) and the canonical-page-names comment (`/$server/$window → Terminal` line, ~line 68) to describe the numeric URL segment (`@N` sans `@` in the address bar; `@N` restored by parse and remaining the identity in code). <!-- R5 -->

### Phase 2: Tests

- [x] T003 [P] Add colocated unit tests `app/frontend/src/router.test.ts` covering the extracted helpers: `windowIdToUrlSegment("@0") === "0"`, `urlSegmentToWindowId("0") === "@0"`, and idempotency `urlSegmentToWindowId("@0") === "@0"` (the old-bookmark case — must not yield `@@0`). Also cover multi-digit (`@12`). <!-- R4 -->
- [x] T004 [P] Rewrite the encoded-form e2e assertions / goto targets to the numeric segment form, preserving intent: `pr-status-sidebar.spec.ts:54-55` (`%401`/`%402` → `/1`/`/2`); `multi-server-sidebar.spec.ts:92-94` (comment + `%40\\d+` regex → `\\d+`); `sidebar-window-sync.spec.ts:173` (the `not.toContain` pre-click guard → numeric segment), `:182-188` and `:245-251` (comments + `encodeURIComponent(windowId)` → `windowId.slice(1)`); `session-tiles.spec.ts:104` (`encodeURIComponent(windowId)` → `windowId.slice(1)`); `status-dot-tip.spec.ts:143` (comment only, `/default/%401` → `/default/1`). Leave `echo-latency.spec.ts` and `mobile-touch-scroll.spec.ts` old-form gotos unchanged. <!-- R6 R7 -->
- [x] T005 [P] Bring every `.spec.md` companion of the five modified `.spec.ts` files (`pr-status-sidebar`, `multi-server-sidebar`, `sidebar-window-sync`, `session-tiles`, `status-dot-tip`) into agreement with its spec's URL form. Do NOT work from a line list — read each companion END TO END, including "What it proves" summaries and Shared setup sections (NOT only the numbered steps), and reword every passage that describes a window URL as `@N`-form, `%40`-encoded, or `encodeURIComponent(...)` wherever the paired `.spec.ts` now asserts the numeric segment (`/{server}/{N}`, `@N` sans `@`, parse restores `@N`). Known-outstanding from review cycle 3: `multi-server-sidebar.spec.md:40` — the "What it proves" passage says the URL is `/{otherServer}/{windowId}` (the `@N`-form ID as segment) while the spec's line 94 asserts `\d+` and the companion's own step 4 (lines 52-54) correctly says `<N>`; reword to `/{otherServer}/{N}` (the window id's numeric part). Verify by rereading each companion side-by-side with its spec, not by grepping for `%40`. <!-- R6 --> <!-- rework: review cycle 3 — fix code: cycle-2's audit fixed the sidebar-window-sync step-6 entries but wrongly reported multi-server-sidebar.spec.md "verified clean"; its line-40 "What it proves" summary (a non-step passage) is the third surviving instance of the prose @-form class; audit instruction extended to name summaries/setup sections explicitly -->

## Execution Order

- T001 blocks T002 (same file) and is a prerequisite for T003 (imports the helpers).
- T003, T004, T005 are independent of each other once T001 lands (`[P]`), but T003 depends on T001.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `navigate` to the terminal route with `params.window === "@N"` produces the address-bar URL `/{server}/{N}` (no `%40`).
- [x] A-002 R2: The terminal route's parse yields `params.window === "@N"` for both a fresh `/{server}/{N}` URL and an old `/{server}/%40N` bookmark (idempotent — never `@@N`).
- [x] A-003 R3: The mapping lives only in `router.tsx`; no navigation call site or `params.window` consumer is modified, and `tsc --noEmit` passes.
- [x] A-004 R4: The mapping is exported as pure helpers with unit tests covering strip, prepend, and idempotency.
- [x] A-005 R5: The `router.tsx` route comment and canonical-page-names comment describe the numeric URL segment + `@N`-restored-by-parse contract.

### Behavioral Correctness

- [x] A-006 R1: Click-navigation to a window writes `/{server}/{N}` end-to-end (verified by the updated `sidebar-window-sync` / `session-tiles` / `multi-server-sidebar` e2e assertions).
- [x] A-007 R6: All updated e2e assertions and `.spec.md` companions use the numeric form and each test's original intent (incl. the `sidebar-window-sync` pre-click regression guard) is preserved. *(Verified in review cycle 4: the cycle-3 remaining item is FIXED — `multi-server-sidebar.spec.md:39-45` ("What it proves") now describes the cross-server URL as `/{otherServer}/{N}` (the window id's numeric part), agreeing with the spec's `\d+` assertion at `multi-server-sidebar.spec.ts:94` and the companion's own step 4. All five companions re-read end-to-end side-by-side with their specs — summaries, Shared setup, and numbered steps: pr-status-sidebar, multi-server-sidebar, sidebar-window-sync, session-tiles clean; status-dot-tip.spec.md needs no change (its only URL-form passage names the server route, not a window-route form). The cycle-3 comment rework in `sidebar-window-sync.spec.ts` (resolveWindow doc comment :14-22, assertion comments :160-164) now says "numeric part", not "index", with no assertion changes. All four URL-asserting specs pass under `just test-e2e`.)*

### Scenario Coverage

- [x] A-008 R2: The idempotent-parse unit case (`@0 → @0`) plus the unchanged old-form `page.goto(...%40N...)` sites in `echo-latency.spec.ts` / `mobile-touch-scroll.spec.ts` exercise the old-bookmark back-compat path.
- [x] A-009 R7: `echo-latency.spec.ts` and `mobile-touch-scroll.spec.ts` old-form gotos are unchanged and still resolve. *(Re-verified in cycle 3: both files untouched per `git status`; `just test-e2e "mobile-touch-scroll"` passes 3/3 against the new router.)*

### Edge Cases & Error Handling

- [x] A-010 R4: Multi-digit window IDs (`@12`) round-trip correctly (`@12 → 12 → @12`).

### Code Quality

- [x] A-011 Pattern consistency: New code follows the naming and structural patterns of surrounding `router.tsx` code (type narrowing over assertions per code-quality.md).
- [x] A-012 No unnecessary duplication: The two helpers are the single source of the mapping; no inline `@`-stripping/prepending is duplicated at call sites. *(The `windowId.slice(1)` in e2e specs is the plan-specified assertion shape — Playwright specs don't import app source.)*
- [x] A-013 Test coverage: The changed behavior is covered by unit tests (helpers) and e2e assertions (end-to-end URL form), per code-quality.md ("New features and bug fixes MUST include tests covering the added/changed behavior").

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `escapeRegExp` (`app/frontend/tests/e2e/session-tiles.spec.ts:8`) — its only call site (`:105`) now wraps `windowId.slice(1)`, a digits-only string; the escape is a functional no-op since the `%40` prefix it existed for is gone from the assertion. *(Re-verified in cycle 4.)*
- `escapeRegExp` (`app/frontend/tests/e2e/sidebar-window-sync.spec.ts:10`) — both remaining call sites (`:185`, `:249`) now wrap digits-only `*.windowId.slice(1)` strings; same no-op rationale as above. *(Re-verified in cycle 4; call-site line numbers shifted from `:183`/`:247` after the cycle-3 comment rework.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop the `@` from the URL entirely (`/testServer/0`) via a route-boundary paired parse/stringify, not `pathParamsAllowedCharacters` | Intake assumption 1/2 — user explicitly chose dropping `@`; mechanism specified and all nav sites verified to go through route params | S:95 R:80 A:90 D:90 |
| 2 | Certain | Parse is idempotent (prepend `@` only if absent) so old `/%40N` bookmarks resolve to `@N`, never `@@N` | Intake assumption 3 — user mandated back-compat via idempotent parse | S:95 R:85 A:95 D:95 |
| 3 | Confident | Use the modern paired `params: { parse, stringify }` API for the terminal route (installed v1.168.22 supports it); `boardRoute` keeps legacy `parseParams` | Intake assumptions 4/5 — modern form preferred if straightforward; board scope excluded; paired form coexists with the file's remaining `parseParams` usage | S:80 R:90 A:75 D:75 |
| 4 | Confident | Extract exported pure helpers (`windowIdToUrlSegment` / `urlSegmentToWindowId`) with a colocated `router.test.ts` (strip, prepend, idempotency, multi-digit) | Intake assumption 8 + code-quality.md mandate; vitest discovers `src/**/*.test.ts`; helper names are the agent-chosen testable shape | S:75 R:90 A:80 D:75 |
| 5 | Confident | E2E updates rewrite encoded-form assertions to the numeric form (incl. the `not.toContain` guard and `session-tiles`) and update the 3 `.spec.md` companions in the same commit; leave `echo-latency`/`mobile-touch-scroll` old-form gotos as back-compat coverage | Intake assumptions 6/7 + constitution Test Companion Docs rule; exact pattern shape (`slice(1)` vs `\d+`) is an apply-time detail | S:70 R:90 A:80 D:75 |

5 assumptions (2 certain, 3 confident, 0 tentative).
