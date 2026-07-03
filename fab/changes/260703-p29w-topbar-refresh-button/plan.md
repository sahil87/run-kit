# Plan: Top-Bar Refresh Button

**Change**: 260703-p29w-topbar-refresh-button
**Intake**: `intake.md`

## Requirements

### Top Bar: Refresh Button

#### R1: RefreshButton renders in the terminal-only cluster group
A `RefreshButton` component SHALL render inside the `top-bar.tsx` right-side icon
cluster's `currentWindow &&` terminal-only group, immediately after
`ClosePaneButton`, wrapped in a `<span className="hidden sm:flex">` like its
siblings. It SHALL NOT render when no current window exists, and SHALL be hidden
below the `sm` breakpoint.

- **GIVEN** the TopBar is rendered with a non-null `currentWindow` (a terminal route)
- **WHEN** the top bar's right-side cluster renders at ≥ `sm` width
- **THEN** a refresh button (`aria-label="Refresh page"`) appears immediately after the Close pane button
- **AND** it is absent when `currentWindow` is `null` (root / cockpit / no-window states)

#### R2: Clicking the RefreshButton reloads the page
The `RefreshButton` SHALL invoke `window.location.reload()` on click, with no
confirmation dialog and no pending/spinner state.

- **GIVEN** the RefreshButton is visible on a terminal route
- **WHEN** the user clicks it
- **THEN** `window.location.reload()` is invoked exactly once
- **AND** no confirmation prompt, disabled state, or spinner is shown

#### R5: Shift+click force-reloads (Chrome Shift+reload semantics)
<!-- added post-review-pr on direct user request ("Shift + Click of the refresh button should force reload (just like what happens in chrome)") -->
A Shift+click on the `RefreshButton` SHALL perform a best-effort hard reload:
a `fetch(window.location.href, { cache: "reload" })` (forcing a network
round-trip that overwrites the document's HTTP cache entry) followed by
`window.location.reload()` once the fetch settles — reloading even if the
fetch rejects. The `title` names the affordance
(`"Refresh page (Shift+click: force reload)"`). A plain click stays a plain
`window.location.reload()` with no fetch. (`location.reload(true)` is not
used — the legacy forceGet flag is dead in modern browsers.)

- **GIVEN** the RefreshButton is visible
- **WHEN** the user Shift+clicks it
- **THEN** a `cache: "reload"` fetch of the current URL is issued and `window.location.reload()` follows once it settles (fulfilled or rejected)
- **AND** a plain click issues no fetch

#### R3: RefreshButton visual style matches the cluster convention
The `RefreshButton` SHALL follow the established cluster-button pattern: a
`<button type="button">` with the shared cluster className
(`min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center`),
`aria-label`/`title` of `"Refresh page"`, and a 14×14 stroke SVG refresh
(rotate-cw) glyph (`stroke="currentColor"`, `strokeWidth="2"`,
`strokeLinecap`/`strokeLinejoin` `"round"`, `aria-hidden`) consistent with the
sibling split/close icons.

- **GIVEN** the RefreshButton renders
- **WHEN** its markup is inspected
- **THEN** it carries the shared cluster className and a 14px `aria-hidden` stroke-SVG rotate glyph
- **AND** it has NO `disabled` attribute and no `LogoSpinner`/`useOptimisticAction` wiring

### Command Palette: Refresh Page action

#### R4: "View: Refresh Page" action in every mounted command palette
<!-- revised in review cycle 1: the prior "reachable on every route" wording assumed viewActions serves every route — false premise. The app mounts TWO palettes (AppShell's and the board route's own), and the Cockpit mounts none. -->
A command-palette action `{ id: "refresh-page", label: "View: Refresh Page",
onSelect: () => window.location.reload() }` SHALL be present in **every
CommandPalette the app mounts**:

1. **AppShell palette** (`/$server`, `/$server/$window`): registered ungated in
   the `viewActions` static entries in `app.tsx` (alongside `toggle-fixed-width`).
2. **Board palette** (`/board/$name`): duplicated into `boardRouteActions` in
   `board-page.tsx`, following the established pattern for globally-meaningful
   actions (the terminal-font trio, board-page.tsx:314–319).

The Cockpit (`/`) mounts no CommandPalette (pre-existing) and is explicitly out
of scope (see Non-Goals). Code comments SHALL NOT claim broader reach than this
— the "route-agnostic"/"every route" claims at `app.tsx:1025–1027` and
`top-bar.tsx:643–645` MUST be corrected to name the actual reach.

- **GIVEN** the command palette is opened on an AppShell route (Server Cabin or Terminal)
- **WHEN** the user searches for "refresh"
- **THEN** a "View: Refresh Page" action is present and selecting it invokes `window.location.reload()`

- **GIVEN** the command palette is opened on a board route (`/board/$name`)
- **WHEN** the user searches for "refresh"
- **THEN** a "View: Refresh Page" action is present and selecting it invokes `window.location.reload()`

### Non-Goals

- No `TerminalClient` remount/reconnect path (rejected alternative; may return as a follow-up).
- No tmux `respawn-pane` call; no backend/API/routing/state-model change.
- No mobile-only affordance — below `sm` the button is hidden like its cluster siblings.
- No confirmation dialog, no pending/spinner/disabled states on the button.
- No new CommandPalette mount on the Cockpit (`/`) — its palette absence is pre-existing, and adding one would grow UI surface beyond this change (constitution §IV).

### Design Decisions

1. **Full `window.location.reload()` over terminal reconnect**: chosen explicitly by the user "for now" — *Why*: simplest correct recovery; re-establishes every connection and re-derives all state, safe by design (constitution II/VI). *Rejected*: `TerminalClient` `key`-bump remount (deferred), tmux `respawn-pane` (destructive).
2. **Standalone component, no shared action hook**: `RefreshButton` is a plain button — *Why*: there is no async action to await (the page unloads synchronously), so `useOptimisticAction`/`isPending`/`LogoSpinner` (used by Split/Close) would never meaningfully render. *Rejected*: reusing `useOptimisticAction` (no promise to track).
3. **Button terminal-gated, palette action route-agnostic**: the button lives in the `currentWindow` cluster group; the palette entry sits in `viewActions`' ungated static block — *Why*: a reload is meaningful on every route, but the button follows its sibling cluster's gating; gating the palette entry would diverge from sibling static view actions (`toggle-fixed-width`) for no benefit.
4. **R4 scope: every *mounted* palette, not literally every route** (review cycle 1): the action is duplicated into `boardRouteActions` and the Cockpit is scoped out — *Why*: the board mounts its own curated palette (and is the intake's core degraded-relay recovery scenario — N live relay WebSockets, no top-bar button since `currentWindow` is null there), while `/` mounts no palette today; mounting one to satisfy a literal "every route" reading would violate constitution §IV. *Rejected*: a CommandPalette mount on Cockpit; leaving the board palette without the entry.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add a `RefreshButton` function component in `app/frontend/src/components/top-bar.tsx` (placed alongside `ClosePaneButton`), a plain `<button type="button">` with `onClick={() => window.location.reload()}`, `aria-label`/`title` `"Refresh page"`, the shared cluster className, and a 14×14 stroke rotate-cw SVG (`aria-hidden`); no `disabled`, no spinner, no `useOptimisticAction`. <!-- R2 R3 -->
- [x] T002 Render `<RefreshButton />` in the `currentWindow &&` terminal-only group in `top-bar.tsx`, immediately after `ClosePaneButton`, wrapped in `<span className="hidden sm:flex">`. <!-- R1 -->
- [x] T003 Append the `{ id: "refresh-page", label: "View: Refresh Page", onSelect: () => window.location.reload() }` action to the static entries of the `viewActions` `useMemo` in `app/frontend/src/app.tsx` (after `toggle-fixed-width`), ungated; ALSO duplicate the same action into `boardRouteActions` in `app/frontend/src/components/board/board-page.tsx` (after the terminal-font trio, ~:314–319); correct the reach comments at `app.tsx:1025–1027` and `top-bar.tsx:643–645` to name the actual reach (AppShell palette + board palette; Cockpit mounts none). <!-- R4 --> <!-- rework: review cycle 1 — entry missing from the board palette; "every route" comments false -->
- [x] T006 Add automated palette coverage for R4: assert the "View: Refresh Page" entry is present (and invokes reload) in BOTH the AppShell `viewActions` palette and the board route's palette — mirror the `command-palette.boards.test.tsx` pattern for the board side. The mirror-file docblock must state its reach truthfully: name the dual sources it actually mirrors and scope any "kept in sync" claim to the entries actually mirrored (several tests in that file exercise app.tsx `boardActions` rules, not `boardRouteActions`; the mirror omits `fontEntries` and positions `refreshEntry` differently than production). <!-- R4 --> <!-- rework: review cycle 2 — docblock overclaimed the mirror's attribution and sync guarantee -->
- [x] T007 Test-integrity fixes: strengthen the e2e ordering assertion in `app/frontend/tests/e2e/top-bar-refresh.spec.ts:92–104` to true adjacency (the refresh button's wrapper `span` is the `nextElementSibling` of the close button's wrapper `span`) or soften the in-test comment + `top-bar-refresh.spec.md:28–39` wording to match document-order; drop the redundant visibility re-assert at `spec.ts:88`; reword the stale `vi.restoreAllMocks` restore-attribution comment at `app/frontend/src/components/top-bar.test.tsx:449–451`. <!-- R1 --> <!-- rework: review cycle 1 — should-fix/nice-to-have test-doc mismatches -->

### Phase 3: Tests

- [x] T004 Add unit tests in `app/frontend/src/components/top-bar.test.tsx`: RefreshButton renders (aria-label "Refresh page") when a current window exists and is absent with no window; clicking it invokes a stubbed `window.location.reload` (replace `window.location` with a spyable object, since jsdom's `reload` is not directly spyable); assert no `disabled` attribute. <!-- R1 R2 R3 -->
- [x] T005 Add a Playwright e2e spec `app/frontend/tests/e2e/top-bar-refresh.spec.ts` (fully mocked SSE + servers, navigating to a percent-encoded terminal window route like `pr-status-sidebar.spec.ts`): the refresh button is visible next to the Close pane button on a terminal route; clicking it reloads the page (set a `window` marker via `page.evaluate` before the click, assert it is gone after the reload settles). Ship the sibling `app/frontend/tests/e2e/top-bar-refresh.spec.md` documenting what each test proves + steps (constitution Test Companion Docs). The spec MUST be fully mocked in fact: every mutating route mock's glob must match real request URLs INCLUDING query strings (the select mock needs `**/api/windows/*/select*` — client.ts `withServer` appends `?server=`; without the trailing `*` the POST falls through to the real :3020 backend and mutates live default-socket tmux servers), and the `.spec.md`'s "fully mocked" claims must be true. <!-- R1 R2 --> <!-- rework: review cycle 2 — select mock glob missed the query string; POST fell through to the real backend (e2e-touches-live-tmux class) -->

### Phase 4: Post-review-pr addition

- [x] T008 Shift+click force reload: exported `forceReload()` helper in `top-bar.tsx` (`cache: "reload"` fetch of the current URL → `reload()` in `.finally`), button `onClick` branches on `e.shiftKey`, `title` extended to name the affordance; unit tests cover Shift+click (fetch with `{ cache: "reload" }` then reload), rejected-fetch-still-reloads, and plain-click-never-fetches. <!-- R5 --> <!-- post-review-pr direct user request -->

## Execution Order

- T001 blocks T002 (T002 renders the component T001 defines).
- T001, T002, T003 all block T004/T005.
- T003 blocks T006 (T006 tests the entries T003 registers).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A RefreshButton (`aria-label="Refresh page"`) renders in the terminal-only cluster group immediately after ClosePaneButton, wrapped in `hidden sm:flex`, and is absent when `currentWindow` is null.
- [x] A-002 R2: Clicking the RefreshButton invokes `window.location.reload()` with no confirmation, disabled state, or spinner.
- [x] A-003 R3: The RefreshButton uses the shared cluster className and a 14px `aria-hidden` stroke-SVG rotate glyph, with no `useOptimisticAction`/`LogoSpinner`/`disabled` wiring.
- [x] A-004 R4: The `refresh-page` / "View: Refresh Page" action is present in every mounted CommandPalette — AppShell's `viewActions` (ungated) AND the board route's `boardRouteActions` — invoking `window.location.reload()`; the reach comments in `app.tsx` and `top-bar.tsx` name the actual scope (Cockpit mounts no palette; out of scope). <!-- reworded in review cycle 1 alongside the R4 revision -->


### Scenario Coverage

- [x] A-005 R1: A unit test asserts the RefreshButton renders with a window and is absent without one.
- [x] A-006 R2: A unit test asserts a click invokes the stubbed `window.location.reload`.
- [x] A-007 R1 R2: A Playwright e2e spec asserts the button is visible next to Close on a terminal route and that clicking it reloads the page, with a matching `.spec.md` companion.
- [x] A-014 R4: Automated tests assert the "View: Refresh Page" entry is present in BOTH the AppShell palette and the board palette (and that selecting it reloads).

### Code Quality

- [x] A-008 Pattern consistency: `RefreshButton` follows the surrounding cluster-button structure/naming (SplitButton/ClosePaneButton) and the palette action follows the `viewActions` entry shape.
- [x] A-009 No unnecessary duplication: The button reuses the shared cluster className idiom rather than reinventing styling; no new utility duplicates an existing one.
- [x] A-010 Frontend type narrowing: No new `as` type assertions introduced (test `window.location` stubbing uses defineProperty/spy patterns, not casts in production code).
- [x] A-011 No client polling: The change introduces no `setInterval`/fetch loop (a one-shot `window.location.reload()` is not polling).
- [x] A-012 Test companion docs: The new `*.spec.ts` ships a sibling `*.spec.md` in the same change (constitution Test Companion Docs).
- [x] A-013 `just`-only tests: E2E tests are runnable via `just test-e2e`/`just pw` (port 3020 isolated), never `npx playwright test` directly.
- [x] A-015 Test-doc integrity: the e2e ordering assertion's strength matches its comment and `.spec.md` wording (true adjacency asserted, or wording softened); no redundant re-asserts; the `window.location` restore-attribution comment in `top-bar.test.tsx` is accurate.
- [x] A-016 R5: Shift+click issues a `cache: "reload"` fetch then reloads (even on fetch rejection); plain click reloads with no fetch — covered by unit tests. <!-- post-review-pr user request; verified by tests, not by the pipeline reviewers -->

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Refresh = full `window.location.reload()`, not a terminal reconnect | Intake decision 1 — user explicitly chose "A full location.reload() for now" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Button placed in the `currentWindow` terminal-only group, immediately after `ClosePaneButton`, wrapped in `hidden sm:flex` | Intake decisions 2–4; verified `ClosePaneButton` render site at top-bar.tsx:323–328 and the uniform sibling `hidden sm:flex` wrapper | S:90 R:90 A:90 D:90 |
| 3 | Certain | Plain `<button>` with cluster className + 14px stroke rotate-cw SVG; no `useOptimisticAction`/spinner/`disabled` | Intake decisions 5–6; SplitButton/ClosePaneButton pattern read verbatim; page unloads synchronously so a spinner never renders | S:70 R:95 A:90 D:85 |
| 4 | Certain | Route-agnostic `refresh-page` palette action appended to `viewActions` static entries | Intake decisions 7–8; `viewActions` `useMemo` verified at app.tsx:1009–1027, `toggle-fixed-width` is the ungated sibling; constitution §V mandates palette registration | S:80 R:90 A:95 D:90 |
| 5 | Confident | New dedicated e2e spec `top-bar-refresh.spec.ts` (+ `.spec.md`), fully mocked via `page.route` navigating to a percent-encoded window route — modeled on `pr-status-sidebar.spec.ts` | No existing top-bar spec to extend; the mocked-SSE + `/$server/%40N` pattern is the established deterministic way to reach a `currentWindow` route in CI (no real tmux/gh dependency) | S:60 R:85 A:80 D:70 |
| 6 | Confident | R4 revised in review cycle 1 to "every mounted palette" (AppShell `viewActions` + board `boardRouteActions`), Cockpit scoped out — no new palette mount on `/` | Cockpit palette absence is pre-existing; adding a mount would grow UI surface against constitution §IV; board duplication follows the terminal-font-trio pattern (board-page.tsx:314–319) per both reviewers' recommendation | S:70 R:85 A:85 D:75 |

6 assumptions (4 certain, 2 confident, 0 tentative).
