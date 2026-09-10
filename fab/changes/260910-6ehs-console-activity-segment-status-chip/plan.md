# Plan: Console Activity Segment + Status-Bar Clock Chip

**Change**: 260910-6ehs-console-activity-segment-status-chip
**Intake**: `intake.md`

## Requirements

### Operator Console: desktop `Terminal | Activity` segments

#### R1: Desktop drawer renders a two-segment header
The desktop operator console drawer (`app/frontend/src/components/operator-console.tsx`, desktop branch only) SHALL render a segmented header with exactly two segments, **Terminal** and **Activity**, directly under the title strip and above the status line. The header MUST reuse the same presentational segment strip the mobile `TerminalActivityTabs` renders (`role="tablist"` / `role="tab"` / `aria-selected`, `controlClass({ variant: "segment" })`, test id `terminal-activity-tabs`), extracted into a controlled component in `terminal-activity-tabs.tsx` (`ConsoleSegments({ value, onChange })`); `TerminalActivityTabs` becomes a thin wrapper driving the router `tab` search param through it. Mobile rendering and test ids stay byte-identical.

- **GIVEN** the desktop drawer is open on an operator-bearing server
- **WHEN** it renders
- **THEN** a tablist with `Terminal` (selected) and `Activity` tabs appears between the title strip and the terminal body

#### R2: Segment state is ephemeral, default Terminal
The selected segment SHALL be console-local React state (`"terminal" | "activity"`), defaulting to `terminal`, written to no URL, tmux option, or localStorage. Closing the drawer (the `finishClose` path) SHALL reset the segment to `terminal`; a request carrying `segment` (R6) SHALL set it on open.

- **GIVEN** the Activity segment is selected
- **WHEN** the drawer closes and is re-opened by a plain `toggle`/`open` request
- **THEN** the Terminal segment is selected

#### R3: Activity body mounts the feed and unmounts the terminal
While `activity` is selected, the drawer body SHALL render `<CronActivityFeed server={server} />` in place of the `TerminalClient`, and the `TerminalClient` MUST NOT be mounted (one relay stream max per drawer). While `terminal` is selected the body is the existing `TerminalClient` (or the existing operator-less hint). The Activity body inherits the console's server resolution: an unresolved server renders the feed's own hint line; the glass background is unchanged.

- **GIVEN** the drawer is open with the Terminal segment and an embedded terminal mounted
- **WHEN** the user selects Activity
- **THEN** `cron-activity-feed` renders and `embedded-terminal` is absent
- **AND WHEN** the user selects Terminal again
- **THEN** the terminal remounts and the feed is absent

#### R4: Entry detail renders inline inside the drawer
Tapping a feed row inside the drawer SHALL open `CronEntryDetailSheet` in an **inline** variant (`inline` prop): no fixed full-viewport backdrop, no `aria-modal`; the panel renders `absolute inset-0` inside the feed's relative container, its header close control labelled `‹ Activity` returns to the feed, and the rows (schedule sentence, Last fired / Next fire, Mute switch, Pin switch, Delete with confirm) are unchanged. The default (mobile) variant is untouched. `CronActivityFeed` gains an optional `inline?: boolean` prop it forwards to the sheet and uses to make its root `relative`.

- **GIVEN** the Activity segment shows an upcoming row
- **WHEN** the row is clicked
- **THEN** the detail panel renders inside the drawer with a `‹ Activity` control
- **AND WHEN** that control is clicked
- **THEN** the feed is visible again

#### R5: Title strip carries the operator tick-age stamp
The title strip SHALL append a tick-age stamp after the agent-state span: `· tick {formatDuration(now - operatorLastTickAt)} ago` (test id `operator-console-tick`), read from the first session on the resolved server carrying `operatorLastTickAt > 0`. When that session's `operatorStale === true`, the stamp renders in `text-signal-yellow` prefixed with `⚠` and its `Tip` reads `Operator last ticked {age} ago`. When no session carries the field, nothing renders. Render-time only — no ticking timer.

- **GIVEN** a server whose sessions carry `operatorLastTickAt` and `operatorStale: false`
- **WHEN** the drawer renders
- **THEN** the strip shows `· tick {age} ago` in the secondary color
- **AND GIVEN** `operatorStale: true`, **THEN** the stamp is yellow with the `⚠` glyph

### Console Seam: segment-aware open

#### R6: `requestOperatorConsole` accepts an optional segment
`OperatorConsoleRequest` (`app/frontend/src/lib/operator-console.ts`) SHALL gain `segment?: "terminal" | "activity"`. The desktop listener applies it to the segment state when present (after the machine transition). The mobile arm maps `segment: "activity"` to its navigation `search` (`{ ...from, tab: "activity" }`); when already on the operator route it updates the `tab` search param in place (`navigate({ to: ".", search: prev => ({ ...prev, tab: "activity" }), replace: true })`). Requests without `segment` behave exactly as today. `isOperatorConsoleRequest` stays tolerant (segment optional).

- **GIVEN** desktop and a closed console
- **WHEN** `requestOperatorConsole({ action: "open", segment: "activity" })` fires
- **THEN** the drawer opens with the Activity segment selected
- **AND GIVEN** mobile on a non-operator route, **THEN** the navigate call carries `search.tab === "activity"`

#### R7: Desktop honors the `?tab=activity` deep-link
On a **desktop** terminal route where the resolved window's `role === "operator"` and `search.tab === "activity"`, `app.tsx` SHALL, once (effect keyed on those inputs), dispatch `requestOperatorConsole({ action: "open", segment: "activity" })` and strip the param (`navigate({ to: ".", search: prev => ({ ...prev, tab: undefined }), replace: true })`). The existing mobile `operatorConsoleTabs` / `activityTabActive` behavior is unchanged. Note the console's desktop listener currently no-ops on the operator route with a toast (`ALREADY_ON_OPERATOR_HINT`); requests carrying `segment: "activity"` MUST bypass that guard so the drawer opens on Activity (the Activity view is not visible on the route itself on desktop).

- **GIVEN** a desktop viewport and the URL `/{server}/{operatorWindow}?tab=activity`
- **WHEN** the route mounts and the sessions payload resolves the operator window
- **THEN** the console opens on the Activity segment and the URL no longer carries `tab`

### Status Bar: clock chip

#### R8: A `◷` clock chip in the right cluster
`StatusBar` (`app/frontend/src/components/status-bar.tsx`) SHALL render a `ClockChip` button (test id `status-bar-clock`) in the RIGHT cluster immediately before the `<server>` fragment, only when `server` is non-null. Data: `useCronData(server)` and `useSessionContext().sessionsByServer.get(server)` at the leaf. States: (a) **stale** — any session `operatorStale === true` → `◷ stale {age}` in `text-signal-yellow`, Tip `Operator loop stale — last tick {age} ago`; (b) **next** — otherwise, with ≥1 entry carrying `nextFire` → `◷ in {rel}` / `◷ due` for the soonest `nextFire`, Tip `Clock — next fire {name} {in rel|due}`; (c) **omitted** — no stale and no entry with `nextFire`. One chip, never two. Click → `requestOperatorConsole({ action: "open", segment: "activity" })`. No copy affordance.

- **GIVEN** a server with entries and no staleness
- **WHEN** the bar renders
- **THEN** the chip shows `◷ in {rel}` for the soonest fire and clicking it dispatches the console request with `segment: "activity"`
- **AND GIVEN** zero entries and no staleness, **THEN** no chip renders
- **AND GIVEN** `operatorStale: true`, **THEN** the chip shows `◷ stale {age}` in yellow regardless of entries

#### R9: Ladder — the chip drops with the hints, the stale state never drops
In the **next** state the chip carries `hidden xl:flex` (drops with the ⌘K/compose hints); in the **stale** state it carries `flex` (never drops — the connection-dot precedent). The `OverflowMenu` gains a `clk` action row (`xl:hidden`, label `◷ Clock activity`) rendered only when the chip is in the **next** state, invoking the same console request. The existing overflow rows and strip order are unchanged.

- **GIVEN** a viewport below `xl` and a non-stale server with entries
- **WHEN** the overflow menu opens
- **THEN** a `◷ Clock activity` row is present and activating it dispatches the console request

### Palette (Constitution V)

#### R10: `Operator: Show clock activity`
`app/frontend/src/lib/palette/operator-console.ts` SHALL export `buildOperatorConsoleActivityAction()` returning `{ id: "operator-console-activity", label: "Operator: Show clock activity", onSelect: () => requestOperatorConsole({ action: "open", segment: "activity" }) }`. `use-global-palette-actions.ts` registers it immediately after the existing `Operator: Open console` entry under the same gating. No new chord.

- **GIVEN** the palette is open
- **WHEN** the user types `clock activity`
- **THEN** `Operator: Show clock activity` matches and selecting it opens the console on Activity (desktop) or navigates with `tab=activity` (mobile)

### Docs: spec and study amendment

#### R11: `docs/specs/cron.md` § UI item 2 re-pointed; agents tile superseded
Item 2 (Dashboard) SHALL be rewritten: the larger view is server-scoped and split into (a) the console's Activity segment on desktop (this change; the glimpse; status-bar `◷` chip and palette entry as entry points) and (b) the tmux Server page WATCHED / CRONS / RECENT DELIVERIES zones (change `260910-1rx0`, the registry). The agents-tile dashboard is recorded as **Superseded (2026-09-10)** with the reason (tab-scoped tile for a server-scoped fact; `agents` is no longer a reserved surface kind — `SURFACE_KINDS` is `tty · web · code · gui`). The tier list's mobile bullet notes desktop parity; the palette line adds `Operator: Show clock activity`; § Phasing P2 replaces "the agents-tile dashboard" with the two new surfaces. `docs/specs/index.md`'s Cron row drops any agents-tile phrasing. `docs/wiki/cron-clock-design-studies.html` § 1b gets a leading superseded note (`Superseded 2026-09-10 — see docs/specs/cron.md § UI item 2`) with the mock retained, and § 4's inventory table gains rows for the status-bar chip and the palette entry.

- **GIVEN** the amended spec
- **WHEN** a reader looks up tier 2
- **THEN** it names the console Activity segment + Server page zones and marks the agents tile superseded

### Non-Goals
- The tmux Server page dashboard zones — change `260910-1rx0`.
- Per-viewer persistence of the selected segment (intake open question; ephemeral chosen).
- Escalations / pending-questions data — no payload exists.
- Any backend change.

### Design Decisions

#### Detail panel is an inline variant of the existing sheet, not a new component
**Decision**: `CronEntryDetailSheet` gains an `inline` prop that swaps its fixed backdrop + bottom anchoring for an in-container `absolute inset-0` panel with a `‹ Activity` back control.
**Why**: one component keeps mute/pin/delete semantics (optimistic overrides, confirm step, error line) identical on both form factors; the drawer's `translate` transform would already trap a `fixed` sheet inside the drawer box, so the variant makes that explicit rather than accidental.
**Rejected**: a modal over the quake drawer (heavy, a dialog over a dialog); a flyout card (the study bans flyouts for this content); a second detail component (drift).
*Introduced by*: 260910-6ehs-console-activity-segment-status-chip

#### `segment` rides the existing event seam
**Decision**: the segment request is an optional field on `OperatorConsoleRequest`, applied by both form-factor arms.
**Why**: every entry point already funnels through one document event; a second event or a module slot would split the seam.
**Rejected**: a dedicated `rk:operator-console-segment` event; a URL param on desktop (the drawer is an overlay, not a route — Constitution IV).
*Introduced by*: 260910-6ehs-console-activity-segment-status-chip

#### Stale chip survives the ladder; the next-fire chip does not
**Decision**: the chip's breakpoint class depends on its state — `flex` when stale, `hidden xl:flex` otherwise, with an overflow row only for the droppable state.
**Why**: staleness is the dead-man alarm and must be visible at every desktop width (the connection dot's rule); the next-fire readout is a convenience the ladder may drop.
**Rejected**: always visible (crowds the ~700–1100px band); always droppable (hides the alarm).
*Introduced by*: 260910-6ehs-console-activity-segment-status-chip

## Tasks

### Phase 1: Setup

- [x] T001 Extract the presentational segment strip from `app/frontend/src/components/terminal-activity-tabs.tsx` into an exported controlled `ConsoleSegments({ value, onChange })` (same markup, roles, classes, `data-testid="terminal-activity-tabs"`); make `TerminalActivityTabs` a wrapper that reads/writes the router `tab` search param through it. Keep `terminal-activity-tabs` tests green. <!-- R1 -->
- [x] T002 [P] Extend `OperatorConsoleRequest` in `app/frontend/src/lib/operator-console.ts` with `segment?: "terminal" | "activity"` (doc comment + type only; guard unchanged). <!-- R6 -->

### Phase 2: Core Implementation

- [x] T003 In `app/frontend/src/components/operator-console.tsx` (desktop branch): add `segment` state (default `terminal`), reset it in `finishClose`, apply `detail.segment` in the seam listener (bypassing the `onOperatorRoute` toast guard when `detail.segment === "activity"`), render `<ConsoleSegments>` under the title strip, and swap the body between `TerminalClient` and `<CronActivityFeed server={server} inline />` (terminal unmounted while Activity shows). <!-- R1 R2 R3 R6 R7 -->
- [x] T004 <!-- rework: Esc inside the inline panel must return to the feed only (preventDefault / claim the key), never collapse the drawer — review should-fix #1 --> Add the `inline` variant to `app/frontend/src/components/cron-entry-detail-sheet.tsx` (no fixed backdrop, no `aria-modal`, `absolute inset-0` panel, header control labelled `‹ Activity`, `data-testid="cron-entry-sheet"` retained) and thread `inline?: boolean` through `app/frontend/src/components/cron-activity-feed.tsx` (root gets `relative` when inline; sheet receives the prop). Default variant unchanged. <!-- R4 -->
- [x] T005 Title-strip tick-age stamp in `operator-console.tsx`: derive `operatorLastTickAt`/`operatorStale` from `sessionsByServer.get(server)`, render `· tick {age} ago` (`data-testid="operator-console-tick"`), yellow + `⚠` + Tip when stale, nothing when absent; render-time only. <!-- R5 -->
- [x] T006 Mobile arm in `operator-console.tsx`: map `detail.segment === "activity"` to `search.tab = "activity"` on the navigate (merged with `from`), and to an in-place `tab` search update when already on the operator route. <!-- R6 -->
- [x] T007 `app/frontend/src/components/status-bar.tsx`: add `ClockChip({ server })` (uses `useCronData` + `useSessionContext`; three states per R8; `hidden xl:flex` vs `flex` per R9; click dispatches `requestOperatorConsole({ action: "open", segment: "activity" })`; `data-testid="status-bar-clock"`), mount it before the `<server>` fragment when `server` is set, and add the `clk` overflow action row (`◷ Clock activity`, `xl:hidden`, only in the next-fire state — pass the state into `OverflowMenu`). <!-- R8 R9 -->
- [x] T008 [P] `app/frontend/src/lib/palette/operator-console.ts`: add `buildOperatorConsoleActivityAction()` (`operator-console-activity`, `Operator: Show clock activity`); register it in `app/frontend/src/hooks/use-global-palette-actions.ts` right after `operatorConsoleEntry` under the same gating. <!-- R10 -->

### Phase 3: Integration & Edge Cases

- [x] T009 `app/frontend/src/app.tsx`: desktop `?tab=activity` handoff — an effect that, when `!isMobile && windowParam && currentWindow?.role === "operator" && search.tab === "activity"`, dispatches `requestOperatorConsole({ action: "open", segment: "activity" })` once and strips `tab` via `navigate({ to: ".", search: prev => ({ ...prev, tab: undefined }), replace: true })`. Mobile path untouched. <!-- R7 -->
- [x] T010 <!-- rework: add coverage for the desktop ?tab=activity handoff (app.tsx effect: opens console on Activity + strips the param once) and for inline-panel Esc — review should-fix #2 --> Unit tests: `operator-console.test.tsx` (segments render; Activity mounts `cron-activity-feed` and unmounts `embedded-terminal`; `segment: "activity"` request opens on Activity and bypasses the operator-route toast; close resets to Terminal; tick stamp normal/stale/absent; mobile navigate carries `tab`), `status-bar.test.tsx` (chip omitted / next-fire / stale precedence; classes `hidden xl:flex` vs `flex`; click dispatches the request; overflow `clk` row only in next state — mock `@/hooks/use-cron` and the session context), `terminal-activity-tabs.test.tsx` (controlled strip + wrapper), `cron-entry-detail-sheet.test.tsx` (inline variant: no backdrop, `‹ Activity` calls `onClose`), `lib/palette/operator-console.test.ts` (new builder shape). Run via `just test-frontend`. <!-- R1 R2 R3 R4 R5 R6 R8 R9 R10 -->
- [x] T011 e2e (`app/frontend/tests/e2e/operator-console.spec.ts` and `status-bar.spec.ts`, stubbing `**/api/cron*` via `page.route` as `mobile-cron-activity.spec.ts` does): (a) desktop — open the console via the palette `Operator: Open console`, click the Activity tab, expect `cron-activity-feed` visible and `embedded-terminal` absent; (b) desktop — `status-bar-clock` visible with stubbed entries, click it, expect the console open with the feed visible. Each `test()` carries a **Proves:/Steps:** JSDoc block; file headers updated for the new stub. Run with `just pw test operator-console` / `just pw test status-bar` (never Playwright directly). <!-- R3 R8 -->

### Phase 4: Polish

- [x] T012 Docs: rewrite `docs/specs/cron.md` § UI item 2 (+ mobile bullet parity note, palette line, § Phasing P2) per R11; refresh the Cron row in `docs/specs/index.md`; in `docs/wiki/cron-clock-design-studies.html` add the § 1b superseded note above the mock and two § 4 inventory rows (status-bar chip; palette `Operator: Show clock activity`). <!-- R11 -->

## Execution Order

- T001 and T002 block T003
- T004 blocks T003's Activity body (feed `inline` prop)
- T003 blocks T005, T006, T009
- T007 and T008 are independent of T003 (T007 depends only on T002)
- T010 after T003–T009; T011 after T010; T012 independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: The desktop drawer renders a `Terminal | Activity` tablist under the title strip using the shared `ConsoleSegments` strip; mobile `TerminalActivityTabs` output is unchanged
- [x] A-002 R2: Segment state is component state defaulting to `terminal`, reset on drawer close, written nowhere persistent
- [x] A-003 R3: Selecting Activity mounts `CronActivityFeed` and unmounts `TerminalClient`; selecting Terminal restores the terminal
- [x] A-004 R4: Feed rows inside the drawer open the inline detail panel with a `‹ Activity` back control; the default sheet variant is unchanged
- [x] A-005 R5: The title strip shows `· tick {age} ago`, yellow with `⚠` when stale, absent when no session carries the field
- [x] A-006 R6: `OperatorConsoleRequest.segment` exists; desktop applies it, mobile maps it to `tab=activity`
- [x] A-007 R7: On desktop, `?tab=activity` on the operator route opens the console on Activity and strips the param once (rework added the e2e case in `operator-console.spec.ts` — "desktop ?tab=activity deep link opens the drawer on Activity and strips the param", green)
- [x] A-008 R8: `ClockChip` renders in the right cluster before `<server>` with the three states and the console-open click
- [x] A-009 R9: The chip is `hidden xl:flex` in the next state and `flex` when stale; the overflow `clk` row appears only in the next state
- [x] A-010 R10: `Operator: Show clock activity` is registered beside `Operator: Open console`
- [x] A-011 R11: `docs/specs/cron.md` § UI item 2 names the two new surfaces and marks the agents tile superseded; index row and study updated

### Behavioral Correctness

- [x] A-012 R7: A request carrying `segment: "activity"` on the desktop operator route opens the drawer instead of toasting `already viewing the operator`
- [x] A-013 R8: With zero entries and no staleness the chip is omitted, not disabled or empty

### Scenario Coverage

- [x] A-014 R3: Unit test proves feed-mounted/terminal-unmounted and the reverse
- [x] A-015 R8: e2e proves the status-bar chip opens the console on the Activity feed
- [x] A-016 R6: Unit test proves the mobile navigate call carries `search.tab === "activity"`

### Edge Cases & Error Handling

- [x] A-017 R3: An unresolved server on the Activity segment renders the feed's hint line and fires no request
- [x] A-018 R5: 0/absent `operatorLastTickAt` renders no stamp (verified); the stale-with-0-tick clause is **N/A** — unreachable by construction: backend `operatorStaleness` requires `lastTickAt > 0`, so `operatorStale: true` always carries a positive tick
- [x] A-019 R8: `useCronData` fetch failure keeps the last good data; the chip never throws on `nextFire` undefined

### Code Quality

- [x] A-020 Pattern consistency: New code follows the surrounding conventions (Tip usage, `controlClass` variants, `data-testid` naming, JSDoc header comments explaining the why)
- [x] A-021 No unnecessary duplication: The segment strip has one render (extracted), the detail sheet has one component (variant prop), `useCronData` is the only cron fetch path
- [x] A-022 Constitution II/X: no new fetch loops or timers — the chip and stamp ride the SSE sessions cadence
- [x] A-023 Constitution V: every new pointer affordance (segments, chip, overflow row) has keyboard reach and a palette entry
- [x] A-024 Test intent comments: every new e2e `test()` carries **Proves:/Steps:**; spec file headers cover the new `page.route` stub
- [x] A-025 Frontend build: `tsc --noEmit` and the touched Vitest files pass via `just test-frontend`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- A fresh worktree may lack `app/frontend/node_modules` — run `just setup` (or `pnpm install --frozen-lockfile` in `app/frontend`) before Vitest/tsc.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (re-verified on rework cycle 2: the `ConsoleSegments` extraction keeps `TerminalActivityTabs` as the strip's router-driven consumer, both sheet variants and both chip states stay live, and the rework's `use-focus-trap` key-claim is additive).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Segment strip extracted as a controlled component shared by mobile tabs and the desktop drawer | Intake decision; one render for both form factors | S:90 R:85 A:90 D:90 |
| 2 | Confident | Inline detail variant via an `inline` prop on the existing sheet | Intake tentative row resolved: avoids a second component and a modal-over-drawer | S:70 R:80 A:85 D:75 |
| 3 | Confident | Segment-carrying requests bypass the operator-route toast guard on desktop | Without it the `?tab=activity` deep-link and the chip would toast instead of opening on the operator's own route | S:70 R:85 A:85 D:75 |
| 4 | Confident | Overflow `clk` row rendered only in the next-fire state | The stale chip never drops, so a mirror row would duplicate it | S:75 R:90 A:85 D:80 |
| 5 | Confident | Desktop `?tab=activity` handling lives in `app.tsx` beside the existing mobile gate | Same inputs (`windowParam`, `currentWindow.role`, `search.tab`) already computed there | S:75 R:85 A:85 D:80 |
| 6 | Tentative | Tick stamp wording mirrors the CLOCK header (`Operator last ticked {age} ago`) and the feed's "no recent tick" for a zero tick | Reasonable mirror of shipped copy; not user-specified | S:55 R:90 A:75 D:60 |

6 assumptions (1 certain, 4 confident, 1 tentative).
