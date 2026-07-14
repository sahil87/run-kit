# Plan: Web View Lens — Iframe Viewing Retrofit

**Change**: 260714-t97o-web-view-lens
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md + docs/specs/window-views.md (R1–R7). Frontend-only;
     no Go changes. RFC-2119 statements with stable R# IDs. -->

### View Model: Availability & Resolution

#### R1: View availability is derived from capabilities, not from `@rk_type` identity
The set of views a window offers SHALL be computed from derivable window facts, decoupled from `@rk_type` as an identity. `tty` is always available; `web` is available exactly when `rkUrl` is non-empty (spec R1/R3). A pure helper `availableViews(win)` in `app/frontend/src/lib/window-view.ts` SHALL return the ordered available-view list.

- **GIVEN** a window with `rkUrl` set (any `rkType`)
- **WHEN** `availableViews(win)` is called
- **THEN** it returns `["tty", "web"]`
- **AND GIVEN** a window with empty/absent `rkUrl` (even `rkType === "iframe"`)
- **THEN** it returns `["tty"]` only (matches the current render gate's AND-condition — no existing window changes behavior)

#### R2: Default view is a derived hint, not a lock
`defaultView(win)` in `window-view.ts` SHALL return the window's default lens when the URL and localStorage carry no choice: `"web"` when `rkType === "iframe"` AND `rkUrl` is non-empty, else `"tty"` (spec R5 — `@rk_type=iframe` demoted from identity to a creation-time default-view hint; no data migration). The helper SHALL be structured as spec R5's ordered hint precedence (`desktop > chat > web > tty`) with only `web` implemented, so later lenses add a hint entry rather than a new code path.

- **GIVEN** a legacy `rkType === "iframe"` window with `rkUrl` set
- **WHEN** `defaultView(win)` is called
- **THEN** it returns `"web"`
- **AND GIVEN** a plain terminal window (no `rkType`, no `rkUrl`)
- **THEN** it returns `"tty"`

#### R3: `resolveView` precedence — URL → localStorage → default, unavailable falls to tty
`resolveView(searchView, stored, win)` in `window-view.ts` SHALL resolve the effective view with precedence: the URL search param (when that view is in `availableViews`) → the localStorage value (when available) → `defaultView(win)`. Any value that is not currently available SHALL fall through to `"tty"` (spec R2).

- **GIVEN** `searchView === "web"` and the window offers `web`
- **THEN** `resolveView` returns `"web"`
- **AND GIVEN** `searchView === "web"` but the window has no `rkUrl` (web unavailable)
- **THEN** it falls through (localStorage/default), ultimately `"tty"`
- **AND GIVEN** no URL param, `stored === "web"`, web available
- **THEN** it returns `"web"`
- **AND GIVEN** no URL param and no stored value
- **THEN** it returns `defaultView(win)`

### View State: URL param & localStorage

#### R4: `view` is a validated search param on the terminal route
The `terminalRoute` in `app/frontend/src/router.tsx` SHALL declare a `validateSearch` that accepts `view: "web"` and drops any other/unknown value (treated as absent, never errored) — spec R2 (Constitution IV: no new routes). Switching views SHALL update this search param via `navigate({ search })` so the state is copy-paste shareable and deep-linkable.

- **GIVEN** a URL `/$server/$window?view=web`
- **WHEN** the route parses search
- **THEN** `view === "web"`
- **AND GIVEN** `?view=bogus`
- **THEN** `view` is `undefined` (dropped, no error)

#### R5: Last-view persists per window in value-bearing localStorage
A value-bearing localStorage key `runkit-window-view:{server}:{windowId}` SHALL store the chosen view name (absent = use default) — spec R2, superseding the chat plan's key-present convention. It SHALL be written on every explicit view switch and read during resolution, using the try/catch-noop pattern established in `chrome-context.tsx`. Reads/writes SHALL be pure-helper-wrapped so they are unit-testable and SSR/jsdom-safe.

- **GIVEN** a user explicitly switches window `@3` on server `s` to `web`
- **THEN** `localStorage["runkit-window-view:s:@3"] === "web"`
- **AND** navigating away to another window then back resolves `@3` to `web` from storage

#### R6: Navigating to a different window drops the `view` param
A window switch (sidebar/palette/breadcrumb) SHALL navigate WITHOUT carrying the outgoing window's `view` param; each destination window resolves its own last-view/default (intake assumption #8 — simplest semantics; per-window persistence covers the intent).

- **GIVEN** window A is in `web` view (`?view=web`)
- **WHEN** the user switches to window B
- **THEN** the URL for B carries no `view` param, and B resolves independently

### View Switcher UI (generalized machinery)

#### R7: Generic `ViewSwitcher` chip in the top-bar L1 tier
A generic segmented `ViewSwitcher` component (taking the available-view list + active view + an onSelect callback) SHALL render in the top-bar right cluster's L1 (terminal-only) tier, only when `availableViews(win).length > 1` (spec R4). The active segment renders inverse-video; it uses the house hover vocabulary (`rk-glint`/`rk-*` classes) and is reduced-motion safe. Later lenses (chat/desktop) add segments, not a new component.

- **GIVEN** a web-capable window (rkUrl set)
- **THEN** a two-segment `[tty|web]` chip renders in L1, active segment inverse-video
- **AND GIVEN** a tty-only window (no rkUrl)
- **THEN** no chip renders (single available view)

#### R8: Palette parity + keyboard shortcut for view switching (Constitution V)
`View: Terminal` / `View: Web` palette actions SHALL be registered (AppShell terminal-route actions), each visible only when its view is available AND not the current view. The existing `toggle-iframe-terminal` action (which mutates `@rk_type`) SHALL be removed. A keyboard shortcut SHALL cycle the current window's views: `Cmd/Ctrl+.` (period) — documented in the palette entry's `shortcut` field per code-review.md. The App section of the Keyboard Shortcuts dialog SHALL document it.

- **GIVEN** a web-capable window currently in tty view
- **THEN** the palette shows `View: Web` (not `View: Terminal`); selecting it switches to web
- **AND** pressing `Cmd/Ctrl+.` cycles tty→web→tty on that window
- **AND** `toggle-iframe-terminal` no longer appears and no `@rk_type` mutation occurs on a view switch

#### R9: Center heading follows the lens
The top-bar center page heading SHALL read `Terminal: <window>` in tty view and `Web: <window>` in web view (spec R4), using the same static-prefix-span boot-sweep treatment (prefix hidden below `sm`). The window rename affordance (click-to-edit the heading name) SHALL work identically in both views.

- **GIVEN** a window in web view
- **THEN** the heading prefix reads `Web:` and the name remains click-to-rename
- **AND GIVEN** the same window switched to tty view
- **THEN** the prefix reads `Terminal:`

### IframeWindow decoupling & render branch

#### R10: `IframeWindow`'s `>_` button is a view switch, not a type mutation
In `app/frontend/src/components/iframe-window.tsx`, the `>_` button SHALL switch to the tty view (set `?view=tty` + write localStorage) and SHALL NOT call `updateWindowType`. The URL bar's Enter-commit SHALL continue calling `updateWindowUrl` (global substrate state — spec R7). The refresh button and URL-sync behavior are unchanged. `IframeWindow` SHALL receive an `onSwitchToTty` callback (or equivalent) from `app.tsx` rather than importing `updateWindowType`.

- **GIVEN** a window rendered in web view
- **WHEN** the user clicks `>_`
- **THEN** the view switches to tty (URL `?view=tty`, localStorage written) and NO options POST occurs

#### R11: The render branch selects by resolved view, and the tty-view iframe-hint mutation is removed
In `app/frontend/src/app.tsx`, the terminal content render branch SHALL select the renderer by `resolveView(searchView, stored, win)`: `web` → `IframeWindow`, else `TerminalClient`. The existing tty-branch "Switch to iframe view" hint bar (the `</>` button that calls `updateWindowType(..., "iframe")`) SHALL be removed — switching to web is now the `ViewSwitcher`/palette/`>_` responsibility, none of which mutate `@rk_type`.

- **GIVEN** a window whose resolved view is `web` (rkUrl set)
- **THEN** `IframeWindow` renders
- **AND GIVEN** resolved view `tty`
- **THEN** `TerminalClient` renders with no `@rk_type`-mutating hint bar

### Window-switch transition classification

#### R12: Transition classification uses the effective resolved view, not raw `rkType && rkUrl`
In `app/frontend/src/app.tsx`, the `switchTransitionRef.iframeIds` set (which marks navigation targets that use the ungated capture path vs. the terminal first-write receipt gate) SHALL be computed from each window's EFFECTIVE resolved view (localStorage + default; the URL param is not known for a not-yet-navigated target), classifying a window as "iframe-rendering" iff its effective view is `web`. A window that is iframe-typed but resolves to `tty` (e.g., last-viewed tty, or no rkUrl) SHALL keep the terminal receipt seam.

- **GIVEN** an iframe-typed window with rkUrl whose last-view is `tty` in localStorage
- **WHEN** it is a switch target
- **THEN** it is classified as a terminal target (gated capture), NOT an iframe target
- **AND GIVEN** a window whose effective view is `web`
- **THEN** it is classified as an iframe target (ungated capture)

### Non-Goals

- No Go/backend changes; `@rk_type`/`@rk_url` option plumbing and POST endpoints unchanged.
- `create-iframe-window` palette flow and `createWindow(..., "iframe", url)` unchanged (synthetic iframe windows still created as today; they now mean "default view = web").
- Cockpit SERVICES "Open in window" deep-link-to-owning-row upgrade — follow-up per spec Migration Map.
- Port→pane ownership derivation, board lens pins, URL tiles — out of scope (spec sequences as follow-ups).

### Design Decisions

1. **Pure `window-view.ts` helper module, DOM-free**: `availableViews`/`defaultView`/`resolveView` are pure; localStorage read/write are thin try/catch wrappers. — *Why*: matches the established `window-transition.ts`/`navigation.ts` pure-helper + colocated-unit-test pattern; keeps view logic testable without a DOM. — *Rejected*: inlining resolution in `app.tsx` (untestable, and R12's transition classification needs the same logic — sharing the helper prevents drift).
2. **`Cmd/Ctrl+.` cycles views**: resolved against the live chord registry (`Cmd/Ctrl+K` palette, `Cmd/Ctrl+\` sidebar, `Cmd/Ctrl+]`/`[` board pane-cycle). — *Why*: free, in the existing `Cmd/Ctrl+<punctuation>` family, and `Ctrl+.` is inert in readline (unlike `Ctrl+/`→undo). Registered as a window-level keydown that `preventDefault()`s (same working pattern as the `Cmd/Ctrl+\` sidebar toggle in `shell.tsx`), so xterm does not also receive it. — *Rejected*: `Ctrl+<letter>` (collides with terminal control chars), `Cmd/Ctrl+/` (maps to readline undo).
3. **View switch updates the URL param via `navigate({ search })` AND writes localStorage**: — *Why*: URL makes state shareable/deep-linkable (spec R2, push-notification-ready); localStorage makes last-view sticky per window across the param-dropping window switch (R6). — *Rejected*: URL-only (loses stickiness across window switches, since R6 drops the param).

## Tasks

### Phase 1: Pure view-model helper + tests

- [x] T001 Create `app/frontend/src/lib/window-view.ts` exporting `ViewName` type (`"tty" | "web"`), `availableViews(win)`, `defaultView(win)`, `resolveView(searchView, stored, win)`, and the localStorage read/write helpers `readStoredView(server, windowId)` / `writeStoredView(server, windowId, view)` (value-bearing key `runkit-window-view:{server}:{windowId}`, try/catch-noop per `chrome-context.tsx`). Structure `defaultView`/`availableViews` around an ordered hint list `["desktop","chat","web","tty"]` with only `web`/`tty` implemented. Input type: a minimal structural `{ rkType?: string; rkUrl?: string }` (assignable from `WindowInfo`). <!-- R1 R2 R3 R5 --> <!-- rework: window-view.ts:75 — the fallback `available.includes("tty") ? "tty" : available[0] ?? "tty"` is dead-defensive (availableViews always includes tty); simplify to `return "tty"` -->
- [x] T002 [P] Create `app/frontend/src/lib/window-view.test.ts` (Vitest) covering: `availableViews` (rkUrl set → `["tty","web"]`; rkUrl empty even when iframe-typed → `["tty"]`); `defaultView` (iframe+url → web; plain → tty; iframe without url → tty); `resolveView` full precedence + fallback matrix (URL available/unavailable, stored available/unavailable, default fallthrough, unknown value → tty); localStorage read/write round-trip + try/catch-noop when `localStorage` throws. <!-- R1 R2 R3 R5 --> <!-- rework: add a direct Vitest case for the terminal route's validateSearch unknown-value drop (`?view=bogus` → view undefined, no throw) — closes plan R4's second scenario, currently untested -->

### Phase 2: Route search param

- [x] T003 Add `validateSearch` to `terminalRoute` in `app/frontend/src/router.tsx`: accept `{ view?: "web" }`, drop unknown values (return `{}`/`{ view: undefined }`), never throw. Keep the existing `parse`/`stringify` params. <!-- R4 -->

### Phase 3: ViewSwitcher component + heading + tests

- [x] T004 Create `app/frontend/src/components/view-switcher.tsx` — a generic segmented chip: props `{ views: ViewName[]; active: ViewName; onSelect: (v: ViewName) => void }`. Renders one segment per view (label `tty`→"Terminal"/`web`→"Web" via a small label map, or short glyph), active segment inverse-video, `rk-glint`/`rk-*` house classes, reduced-motion safe, `hidden sm:flex` gating consistent with other L1 controls. Renders `null` when `views.length <= 1`. Include `role`/`aria-pressed` on segments and an accessible group label. <!-- R7 --> <!-- rework: segments must display tty-first ([tty|web]) per spec R4 / plan R7 scenario — decouple DISPLAY order from HINT_ORDER (hint precedence desktop>chat>web>tty stays for defaultView only); update its unit test accordingly -->
- [x] T005 [P] Create `app/frontend/src/components/view-switcher.test.tsx` (Vitest + Testing Library): renders both segments for `["tty","web"]` with the active one marked (`aria-pressed`/inverse class); calls `onSelect` with the clicked view; renders nothing for a single-view list. <!-- R7 -->
- [x] T006 Wire the center heading to follow the lens in `app/frontend/src/components/top-bar.tsx`: parameterize the `terminal`-mode heading prefix so it reads `Web:` when the active view is `web`, else `Terminal:`. Add a `viewPrefix?: string` (or `activeView?: ViewName`) prop threaded from the slot; default preserves `Terminal:`. Preserve the WindowHeading rename affordance and boot-sweep in both. Add a `WEB_PREFIX = "Web:"` constant beside `TERMINAL_PREFIX`. <!-- R9 -->

### Phase 4: app.tsx integration (render branch, switcher mount, palette, shortcut, transition classification)

- [x] T007 In `app/frontend/src/app.tsx`, read the `view` search param for the terminal route (`terminalRoute.useSearch()` or `useSearch({ from })`), compute `storedView = readStoredView(server, windowParam)` and `resolvedView = resolveView(searchView, storedView, currentWindow)`; add a stable `switchView(view)` callback that writes localStorage (`writeStoredView`) and navigates with `{ search: (prev) => ({ ...prev, view: view === "web" ? "web" : undefined }) }` (drop the param for tty so the URL stays clean). <!-- R3 R4 R5 --> <!-- rework: MUST-FIX A-019 — remove the unnecessary `as { view?: string }` cast on useSearch (app.tsx:391); the router module registration already types `.view` as `"web" | undefined` and resolveView accepts it as-is (verified: tsc clean without the cast) -->
- [x] T008 Replace the render gate in `app.tsx` (`currentWindow?.rkType === "iframe" && currentWindow?.rkUrl ? <IframeWindow/> : <TerminalClient/>`) with a branch on `resolvedView === "web"` → `<IframeWindow onSwitchToTty={() => switchView("tty")} .../>`, else `<TerminalClient/>`. Remove the tty-branch "Switch to iframe view" `</>` hint bar that calls `updateWindowType(..., "iframe")`. <!-- R10 R11 -->
- [x] T009 Update `app/frontend/src/components/iframe-window.tsx`: add `onSwitchToTty: () => void` prop; the `>_` button calls `onSwitchToTty()` instead of `updateWindowType(server, windowId, "")`; remove the `updateWindowType` import/usage. Keep URL bar + refresh + `updateWindowUrl` unchanged. <!-- R10 -->
- [x] T010 Mount `<ViewSwitcher>` in the top-bar L1 tier (`top-bar.tsx`, terminal-only cluster beside SplitButton/FixedWidthToggle), fed the available views + active view + an `onSelectView` handler threaded from AppShell's slot (`useRegisterTopBarSlot`). Extend `TopBarProps`/the slot shape with `availableViews?: ViewName[]`, `activeView?: ViewName`, `onSelectView?: (v: ViewName) => void`, and `viewPrefix`/`activeView` for the heading (T006). Publish them from `app.tsx`'s `topBarSlot` memo. Chip renders only when `availableViews.length > 1`. <!-- R7 R9 -->
- [x] T011 In `app.tsx`, replace the `toggle-iframe-terminal` palette action with `View: Terminal` / `View: Web` actions in `viewActions`: each present only when its view is in `availableViews(currentWindow)` AND is not `resolvedView`; `onSelect` calls `switchView(...)`. Add `shortcut: "⌘."` to the shown action(s). Remove the now-unused `updateWindowType` import if no longer referenced anywhere in `app.tsx`. <!-- R8 --> <!-- rework: the visibility filter (available AND not current) has zero automated coverage — extract a pure action-builder (lib/palette-view.ts, following the lib/palette-move.ts / palette-update.ts pattern) and unit-test it (both views available, single-view, current-view exclusion) -->
- [x] T012 In `app.tsx`, register a window-level `keydown` handler (effect, gated like `shell.tsx`'s sidebar toggle: skip when a non-xterm INPUT/TEXTAREA/contenteditable is focused) for `Cmd/Ctrl+.` that cycles the current window's `availableViews` (tty→web→tty), calling `switchView(next)`; `preventDefault()`. No-op when only one view is available or no window is in view. <!-- R8 --> <!-- rework: the cycle handler's decision logic has zero automated coverage — extract it into a pure helper (e.g. nextView(available, current) + the input-gating predicate) and unit-test: tty→web→tty order, single-view no-op, non-xterm input gating -->
- [x] T013 In `app.tsx`, change `switchTransitionRef.current.iframeIds` to classify each `flatWindows` target by its EFFECTIVE resolved view: `resolveView(undefined, readStoredView(server, fw.window.windowId), fw.window) === "web"` (URL param unknown for a not-yet-navigated target). Update the explanatory comment to reference the resolved-view classification (spec R12). <!-- R12 -->
- [x] T014 Document `Cmd/Ctrl+.` in the App section of `app/frontend/src/components/keyboard-shortcuts.tsx` (add a `ShortcutRow label="Cycle view" keys={["⌘."]}` alongside the palette + sidebar rows). <!-- R8 -->

### Phase 5: e2e spec + companion

- [x] T015 Create `app/frontend/tests/e2e/web-view-lens.spec.ts` + sibling `web-view-lens.spec.md` (constitution Test Companion Docs). Drive real tmux (own session per the `window-heading.spec.ts` pattern), setting `@rk_url`/`@rk_type` via `tmux -L <server> set-option -w -t <id> @rk_url <url>` (and `@rk_type iframe` for the legacy-default case). Cover: (a) chip appears only on web-capable windows (tty-only window → no chip); (b) flip to web then back to tty preserves the window and never POSTs an options mutation (assert via `page.on("request")` that no `/options` POST fires on a view switch); (c) deep link `?view=web` cold-loads the iframe; (d) `?view=web` on a window with no `rkUrl` falls back to the terminal; (e) legacy `@rk_type=iframe` (with url) defaults to web with the chip present; (f) last-view persistence across a window switch away and back. Verify 375px + desktop viewports. <!-- R4 R5 R6 R7 R10 R11 --> <!-- rework: in the last-view persistence test (f), switch windows via a real client-side navigation (sidebar click), not page.goto, so the R6 search-param drop is exercised through the router seam (guards against a future retainSearchParams/router-upgrade regression); update the .spec.md companion steps to match -->

## Execution Order

- T001 blocks T002, T007, T013 (helper must exist first).
- T003 blocks T007 (search param must be declared before it's read).
- T004 blocks T005, T010; T006 blocks T010 (heading prop threading).
- T007 blocks T008, T011, T012, T013 (they use `switchView`/`resolvedView`).
- T008 blocks T009 (the `onSwitchToTty` prop contract is defined at the call site).
- Phase 5 (T015) runs after Phases 1–4 are wired.
- `[P]` tasks (T002, T005) may run alongside their sibling implementation.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `availableViews(win)` returns `["tty","web"]` for a window with `rkUrl` and `["tty"]` when `rkUrl` is empty (even if `rkType==="iframe"`), verified by `window-view.test.ts`.
- [x] A-002 R2: `defaultView(win)` returns `web` for iframe+url, `tty` for plain and for iframe-without-url, verified by `window-view.test.ts`.
- [x] A-003 R3: `resolveView` honors URL → localStorage → default precedence and falls unavailable values through to `tty`, verified by the `window-view.test.ts` matrix.
- [x] A-004 R4: `terminalRoute` validates `view`, accepting `"web"` and dropping unknown values without error. *(Directly unit-tested in `router.test.ts` — `validateTerminalSearch` accepts `web`, drops `?view=bogus` and absent values without throwing; rework cycle 1 closed the previously untested second scenario.)*
- [x] A-005 R5: An explicit view switch writes `runkit-window-view:{server}:{windowId}`; resolution reads it; localStorage failures are swallowed (try/catch-noop).
- [x] A-006 R7: A `ViewSwitcher` two-segment chip renders in the top-bar L1 tier only when `availableViews.length > 1`, active segment inverse-video; unit-tested in `view-switcher.test.tsx`. *(Segment order is now the literal `[tty|web]` via `DISPLAY_ORDER` (decoupled from `HINT_ORDER`), with a dedicated order unit test — the prior cycle's should-fix is resolved.)*
- [x] A-007 R8: `View: Terminal`/`View: Web` palette actions appear only for available, non-current views; `toggle-iframe-terminal` is gone; `Cmd/Ctrl+.` cycles views; the shortcut is documented in the palette entry + Keyboard Shortcuts dialog. *(Now unit-tested: `palette-view.test.ts` covers the available-and-not-current gating; `window-view.test.ts` covers `nextView` cycle order + `shouldSuppressViewChord` input gating — the prior cycle's should-fix is resolved.)*
- [x] A-008 R9: The center heading reads `Web: <window>` in web view and `Terminal: <window>` in tty view, rename affordance intact in both. *(e2e `deep link ?view=web` asserts the `Web:` prefix; window-heading e2e still green.)*
- [x] A-010 R11: The `app.tsx` render branch selects renderer by resolved view; the tty-branch `@rk_type`-mutating hint bar is removed.

### Behavioral Correctness

- [x] A-011 R10: Clicking `>_` in `IframeWindow` switches to tty view (URL `?view=tty`/param dropped + localStorage) and issues NO options POST; `updateWindowType` is no longer imported by `iframe-window.tsx`. *(Unit test proves the `onSwitchToTty` callback; e2e proves zero `/options` POSTs across flips.)*
- [x] A-012 R6: Switching to a different window drops the `view` param; each window resolves independently (e2e persistence-across-switch case). *(Client-side navigations omit `search`, and TanStack Router's `final` search middleware returns `{}` when `dest.search` is absent — verified against the installed router-core source; the e2e case exercises the goto path.)*
- [x] A-013 R12: `switchTransitionRef.iframeIds` classifies targets by effective resolved view — an iframe-typed window whose last-view is `tty` is a terminal (gated) target; a `web`-resolving window is an iframe (ungated) target. *(Code-verified: `resolveView(undefined, readStoredView(...), fw.window) === "web"`; `window-switch-transition.spec.ts` green.)*

### Scenario Coverage

- [x] A-014 R7 R10 R11: e2e `web-view-lens.spec.ts` proves chip gating, no-mutation flip, deep-link cold-load, no-`rkUrl` fallback, legacy-iframe default-to-web, and last-view persistence, at 375px + desktop, with a sibling `.spec.md`. *(Re-review cycle 1: the FULL e2e suite is green — 106 passed / 2 skipped / 0 failed, all 7 web-view-lens tests passing inside it; the persistence test now switches windows via a real sidebar-click navigation, exercising the R6 param-drop through the router seam.)*

### Edge Cases & Error Handling

- [x] A-015 R3 R4: A `?view=web` deep link to a window with no `rkUrl` renders the terminal (unavailable view falls through to tty), not a blank/broken iframe.
- [x] A-016 R12: Getting the transition classification wrong reintroduces blank-pane/hang bugs; the effective-resolved-view classification keeps tty-resolving iframe-typed windows on the receipt-gated path (guarded by the transition-classification change + e2e switch coverage).

### Code Quality

- [x] A-017 Pattern consistency: New code follows the pure-helper + colocated-test pattern (`window-transition.ts`), the `rk-*` hover vocabulary, and the try/catch-noop localStorage idiom (`chrome-context.tsx`). *(The `⌘.` keydown handler also mirrors `shell/shell.tsx`'s sidebar-toggle gating byte-for-byte.)*
- [x] A-018 No unnecessary duplication: View resolution lives once in `window-view.ts` and is reused by both the render branch and the transition classification (no re-implementation); `updateWindowType` view-mutation call sites are all removed.
- [x] A-019 Type narrowing over assertions: no `as` casts introduced; the search param is validated, `ViewName` is a union narrowed by the helpers (code-quality principle). *(Re-review cycle 1: the prior must-fix is RESOLVED — `app.tsx:397` now reads `useSearch({ strict: false })` bare; the `declare module` registration types `.view` as `"web" | undefined` and `tsc --noEmit` passes clean. A full added-line scan finds no `as` type casts in product source; the `as Array<...>` on `res.json()` in the e2e spec matches the established e2e convention — window-heading/server-reorder/session-tiles do the same — and is not counted.)*
- [x] A-020 Keyboard-first parity: every new view action is reachable via palette AND the `Cmd/Ctrl+.` shortcut, documented in the palette + shortcuts dialog (Constitution V; code-review.md rule).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- No new routes, no new dependencies, no Go changes (Constitution IV / intake).

## Deletion Candidates

- `updateWindowType` (`app/frontend/src/api/client.ts:293`) — this change removed both of its view-switch call sites (the `IframeWindow` `>_` button and the `toggle-iframe-terminal` palette action / tty-branch hint bar); zero non-test references remain (re-verified in re-review cycle 1: only its own unit test, `app/frontend/src/api/client.test.ts:513-523`, which rides with it). The backend `/api/windows/{id}/options` endpoint stays regardless (shared with `updateWindowUrl`, and `@rk_type` remains legitimate substrate state settable by external processes).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `Cmd/Ctrl+.` cycles views (the intake's one Open Question), resolved against the live chord registry (`⌘K` palette, `⌘\` sidebar, `⌘]`/`⌘[` board pane-cycle) | Free binding in the existing `Cmd/Ctrl+<punctuation>` family; `Ctrl+.` is inert in readline (unlike `Ctrl+/`→undo, or `Ctrl+<letter>` control chars); registered window-level with `preventDefault()` per the proven `shell.tsx` sidebar-toggle pattern so xterm doesn't also receive it | S:60 R:85 A:75 D:70 |
| 2 | Confident | View switch updates BOTH the URL `view` param and localStorage; tty drops the param (clean URL), web sets `?view=web` | Spec R2 (URL = shareable/deep-linkable) + R5/intake #8 (per-window stickiness must survive R6's param-drop on window switch), so both seams are required | S:75 R:80 A:80 D:75 |
| 3 | Confident | `ViewSwitcher` takes a `views: ViewName[]` list (generic) and lives in `top-bar.tsx`'s L1 tier, threaded via the existing `useRegisterTopBarSlot` slot context | Spec R4 "whichever ships first builds the generalized switcher"; the slot-context seam is how every other AppShell→TopBar prop already flows (no new plumbing pattern) | S:75 R:75 A:85 D:75 |
| 4 | Confident | `IframeWindow` receives an `onSwitchToTty` callback rather than importing view/navigation logic | Keeps the component presentational and its unit test simple (mirrors the existing prop-driven test); the view/URL/localStorage logic stays owned by `app.tsx` where `navigate` + `switchView` live | S:70 R:85 A:80 D:70 |
| 5 | Confident | `window-view.ts` helpers take a minimal structural `{ rkType?, rkUrl? }` shape (assignable from `WindowInfo`) and are pure/DOM-free, with localStorage as thin try/catch wrappers | Matches the `window-transition.ts`/`navigation.ts` pure-helper pattern the codebase uses for exactly this (unit-testable without a DOM); the same helper is reused by the transition classification (R12), so it must not depend on React/DOM | S:80 R:85 A:85 D:80 |
| 6 | Confident | e2e sets `@rk_url`/`@rk_type` directly via `tmux set-option -w` (no live HTTP server behind the iframe) and asserts no `/options` POST on a flip via `page.on("request")` | The backend tmux test already uses `set-option -w @rk_type iframe`; the iframe `src` points at the proxy path regardless of a live upstream, so chip/heading/render assertions hold without a real server; request-interception is the deterministic seam for "no mutation" | S:70 R:85 A:80 D:75 |
| 7 | Confident | The tty-branch "Switch to iframe view" `</>` hint bar in `app.tsx` (a second `@rk_type` mutation site) is removed, not just the `IframeWindow` `>_` button | It mutates `@rk_type` exactly like the `>_` button the intake calls out; leaving it would violate the no-`@rk_type`-mutation-on-view-switch contract (spec R7) and the ViewSwitcher/palette already provide the tty→web affordance | S:75 R:80 A:85 D:80 |

7 assumptions (0 certain, 7 confident, 0 tentative).
