# Plan: Desktop UI: CLOCK Sidebar Section

**Change**: 260907-wuiu-clock-sidebar-section
**Intake**: `intake.md`

## Requirements

### Sidebar: Section-Visibility Rail

#### R1: Desktop-only `clock` section entry
`SIDEBAR_SECTIONS` (`app/frontend/src/hooks/use-sidebar-sections.ts`) SHALL gain
a fifth entry, `"clock"`, and the entry-object type SHALL gain an optional
`desktopOnly?: boolean` field, set `true` only on the `clock` entry.

- **GIVEN** the `SidebarSection` union and `SIDEBAR_SECTIONS` array
- **WHEN** a `"clock"` entry is added with `key: "runkit-sidebar-section-clock"`, `defaultValue: false`, `label: "Clock"`, `desktopOnly: true`
- **THEN** `useSidebarSectionVisible("clock")` returns a working `[boolean, setter]` pair backed by that localStorage key, defaulting to `false`
- **AND** the existing four entries (`boards`/`server`/`pane`/`host`) are unmodified except for gaining the (unset) optional `desktopOnly` field on their type

#### R2: Section-rail toggle hidden on mobile
`SectionRailButton` (`app/frontend/src/components/sidebar/section-rail.tsx`)
SHALL NOT render a toggle button for an entry whose `desktopOnly` is true when
`useIsMobile()` is true.

- **GIVEN** the section rail renders its 5 entries
- **WHEN** the viewport is mobile (narrow width OR coarse pointer, per `useIsMobile()`)
- **THEN** the Clock toggle button does not render (returns `null` for that one button only — the other 4 buttons render unaffected)
- **AND** on desktop the Clock toggle renders identically to the other 4 (same geometry, `Tip`, `aria-pressed`, `controlClass` styling)

#### R3: `ClockSectionIcon`
`app/frontend/src/components/sidebar/icons.tsx` SHALL export a
`ClockSectionIcon` stroke-SVG component matching the exact sibling-icon
signature (`currentColor` stroke, `strokeWidth={2}`, round caps/joins,
24-unit `viewBox`, `size = 13` default, `aria-hidden="true"`), and
`section-rail.tsx`'s `SECTION_ICONS` record SHALL map `clock` to it.

- **GIVEN** `SECTION_ICONS: Record<SidebarSection, ComponentType<{ size?: number }>>`
- **WHEN** `clock` is added to the record
- **THEN** the Clock rail button renders a clock-face glyph (a circle + hour/minute hands, e.g. `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`) at the same 13px/30px (coarse) size as its siblings

### Sidebar: `CLOCK` `CollapsiblePanel`

#### R4: `ClockPanel` component
A new `app/frontend/src/components/sidebar/clock-panel.tsx` SHALL export a
`ClockPanel({ server }: { server: string | null })` component that fetches
`GET /api/cron?server=<server>` and renders one condensed row per returned
entry inside the panel body, following the `HostPanel` template
(`CollapsiblePanel` wrapper + empty-state text).

- **GIVEN** `server` is a live tmux server name
- **WHEN** `ClockPanel` mounts or `server` changes
- **THEN** it fetches `GET /api/cron?server=<server>` via a new `getCronEntries(server)` client function and renders one row per entry: name, target chip (`{kind}: {role|session|pane}`), backoff rung (only for `schedule.kind === "backoff"`, rendered as `rung {n}`), next-fire (human-relative from `nextFire` unix seconds, `"—"` when `nextFire` is absent), and a dimmed/struck treatment when `orphaned` or `muted` is true
- **AND** when the entries array is empty, the body renders `No cron entries` in the `text-xs text-text-secondary` idiom `HostPanel` uses for `No metrics`
- **AND** when `server` is `null` (board route), the panel renders its empty state without fetching

#### R5: `ClockPanel` mount + visibility gating
`ClockPanel` SHALL be wrapped in a `CollapsiblePanel` (`title="Clock"`,
`storageKey="runkit-panel-clock"`, `defaultOpen={false}`) and mounted in
`app/frontend/src/components/sidebar/index.tsx`'s `BottomPanels` block,
gated on both `clockSectionVisible` (from `useSidebarSectionVisible("clock")`)
and `!isMobile`.

- **GIVEN** the sidebar's `BottomPanels` sub-component (which already takes `showPane`/`showHost`)
- **WHEN** a `showClock` prop is added and threaded from `Sidebar`'s `clockSectionVisible && !isMobile`
- **THEN** the CLOCK panel mounts/unmounts exactly when `showClock` is true/false, matching the existing PANE/HOST panel mount pattern (full unmount on hide — header gone, height reclaimed, no dangling effects)
- **AND** the CLOCK panel's own `CollapsiblePanel` open/collapsed state persists independently via `runkit-panel-clock` (orthogonal to `clockSectionVisible`, exactly as PANE/HOST already behave)

#### R6: Re-fetch on cron mutation
`ClockPanel` SHALL re-fetch its entries when the sidebar's existing SSE-derived
refresh signal fires for the current server (the same mechanism `ServerPanel`/
`WindowPanel` already use to re-render on SSE ticks), never via `setInterval`
polling (Constitution's anti-pattern: "Polling from the client").

- **GIVEN** a cron mutation (create/delete/mute) wakes the SSE hub server-side (`s.sseHub.wake(server)`, already shipped in `app/backend/api/cron.go`)
- **WHEN** the sidebar's existing SSE-tick mechanism fires for that server
- **THEN** `ClockPanel` re-fetches `GET /api/cron` and its rows reflect the mutation without a page reload or manual refresh

#### R7: CLOCK row flyout — mute/delete actions
Each `ClockPanel` row SHALL open a flyout card (via `useRowFlyout`, the
existing `row-flyout-card.tsx` hook) on hover/focus/coarse-tap, containing a
`PopupTitleBar` with the entry name and `CardActionRow` entries for
**Mute**/**Unmute** (posts `POST /api/cron/mute {id, muted}` via a new
`muteCronEntry(id, muted)` client function) and **Delete** (danger-styled,
posts `POST /api/cron/delete {id}` via a new `deleteCronEntry(id)` client
function), mirroring the exact `session-row.tsx:177-239` `useRowFlyout` +
`CardActionList`/`CardActionRow` wiring shape.

- **GIVEN** a CLOCK row for entry `{id, name, muted}`
- **WHEN** the row's flyout is opened and the user clicks **Mute** (or **Unmute** when already muted)
- **THEN** `POST /api/cron/mute {id, muted: !muted}` fires, the flyout closes, and the row updates (via the SSE re-fetch, R6) to reflect the new muted state
- **AND** clicking **Delete** posts `POST /api/cron/delete {id}` and the row disappears from the list on the next re-fetch
- **AND** every action row carries a `data-testid` following the `row-flyout-{action}-action` convention (e.g. `row-flyout-mute-action`, `row-flyout-delete-action`)

### Sidebar: Watched-Row Indicator + Flyout Detail

#### R8: `WindowInfo`/`ProjectSession` TS mirror fields
`app/frontend/src/types.ts` SHALL add to `WindowInfo` the six optional fields
already emitted by the backend (`app/backend/internal/tmux/tmux.go`
`WindowInfo`, `omitempty` JSON tags — no name translation needed):
`monitored?: boolean`, `monitoredChange?: string`, `monitoredStage?: string`,
`monitoredRepo?: string`, `monitoredBranch?: string`, `monitoredAgent?: string`;
and to `ProjectSession`: `operatorLastTickAt?: number`, `operatorStale?: boolean`
(mirroring `app/backend/internal/sessions/sessions.go` `ProjectSession`).

- **GIVEN** the backend sessions/window payload already carries these fields when present
- **WHEN** the TS types are extended to match
- **THEN** `win.monitored`/`session.operatorStale`/etc. type-check without `any`/casts anywhere they're read

#### R9: Watched-row `◉` indicator
`window-row.tsx` SHALL render a small `◉` glyph (a new `WatchedIndicator`
presentational component) beside the existing `StatusDot` when
`win.monitored` is true, with a `Tip` (fine-pointer hover label, e.g.
`Watched by operator — {monitoredStage}`) following the `Tip` idiom already
used in `session-row.tsx`.

- **GIVEN** a window row whose `win.monitored` is true
- **WHEN** the row renders
- **THEN** a `◉` glyph appears beside the `StatusDot`, `aria-hidden` with the accessible label carried by a wrapping `Tip`/`aria-label`, `data-testid="row-watched-indicator"`
- **AND** a window row whose `win.monitored` is false or absent renders no such glyph (zero DOM footprint, not merely hidden — Constitution IV minimal-surface posture)

#### R10: Flyout `WatchedLine` detail
`row-flyout-card.tsx`'s `WindowFlyoutContent` SHALL render a `WatchedLine({ win })`
detail line directly below the existing `NoteLine`, shown only when
`win.monitored` is true: `watched · {monitoredRepo} · {monitoredStage} · {monitoredBranch}`
(omitting any segment whose field is empty).

- **GIVEN** a window's flyout card content and `win.monitored === true`
- **WHEN** the card opens
- **THEN** the `WatchedLine` renders below `NoteLine` in the same `text-text-secondary` idiom, `data-testid="row-flyout-watched-line"`
- **AND** when `win.monitored` is false, `WatchedLine` renders nothing (returns `null`, mirroring `NoteLine`'s own `!win.note → null` gate)

### Sidebar: Staleness Dimming + Header Warning

#### R11: Row dimming on operator staleness
Every `WatchedIndicator` (R9) under a session whose `operatorStale` is true
SHALL render with a dimmed/muted tint, reusing the existing dim treatment
`NoteLine` applies past `NOTE_STALE_SECONDS` (`row-flyout-card.tsx:369`) as
the visual reference — same opacity/color token, new trigger condition
(`session.operatorStale`, not a note-age comparison).

- **GIVEN** a session whose `operatorStale` is true
- **WHEN** any of its windows' `WatchedIndicator` renders
- **THEN** the glyph renders in the dimmed tint instead of its normal color
- **AND** a session with `operatorStale` false or absent renders indicators at full/normal treatment

#### R12: CLOCK header staleness warning
The `ClockPanel`'s `CollapsiblePanel` `headerRight` slot SHALL show a short
warning strip (e.g. `⚠ operator stale`, with a `Tip` giving the tick age)
whenever the active server's `operatorStale` is true, reading the SAME field
`ProjectSession.operatorStale`/`operatorLastTickAt` the row dimming (R11)
reads — never a separately-computed client-side threshold.

- **GIVEN** the active server has at least one session with `operatorStale: true`
- **WHEN** the CLOCK panel header renders
- **THEN** the warning strip appears in `headerRight`, `data-testid="clock-header-stale-warning"`
- **AND** when no session on the active server is stale, the header shows no warning strip (only the panel title, matching `HostPanel`'s plain-title default when no accent/hostname override applies)

### Palette Actions

#### R13: `Panel: Toggle Clock`
`app/frontend/src/hooks/use-global-palette-actions.ts` SHALL register a
`panel-toggle-clock` action labeled `Panel: Toggle Clock`, identical in shape
to the existing `panel-toggle-{boards,server,pane,host}` entries (lines
190-202), spread into `panelActions` with `clockVisible`/`setClockVisible`
added to its `useMemo` deps.

- **GIVEN** the command palette is open
- **WHEN** the user selects `Panel: Toggle Clock`
- **THEN** `useSidebarSectionVisible("clock")`'s setter flips, and the CLOCK section's visibility toggles exactly as the other 4 `Panel: Toggle *` actions do

#### R14: `Cron: mute…` / `Cron: delete…` via `optionPicker`
Two new palette actions, `cron-mute-entry` (`Cron: mute…`) and
`cron-delete-entry` (`Cron: delete…`), SHALL use the existing
`PaletteOptionPicker` mechanism in single-selection mode: `options` is the
current server's cron entries (`key: id, label: name`), and `onApply` fires
the mute/delete POST for the first selected key. Both SHALL be
`disabled: true` when the current server has zero cron entries.

- **GIVEN** the current server has at least one cron entry
- **WHEN** the user selects `Cron: mute…` and picks one entry
- **THEN** `POST /api/cron/mute {id, muted: true}` fires for that entry (toggling semantics deferred to the row flyout's mute/unmute, R7 — the palette action always mutes, matching the unqualified `Cron: mute…` label; unmuting an already-muted entry from the palette is out of scope, use the row flyout)
- **AND** when the current server has zero cron entries, both actions render disabled (not hidden) in the palette, mirroring the `PaletteAction.disabled` idiom

#### R15 (Non-Goal, recorded as a requirement for traceability): `Cron: new entry` deferred
The palette SHALL NOT register a `Cron: new entry` action in this change.

- **GIVEN** the spec's Tier-1 UI description
- **WHEN** scoping this change's palette work
- **THEN** entry creation remains CLI-only (`rk cron add`) — no sidebar/palette creation dialog ships here (see intake Assumption #4)

### Non-Goals

- Mobile console sheet, Activity feed, staleness banner, entry detail sheet — entirely C7's scope (a sibling change), never touched here.
- The `agents` dashboard-tier surface (tier 2) and the `Surface: Agents` palette action — a later change, once the reserved `agents` surface kind lands.
- A cron-entry creation UI/dialog (`Cron: new entry`) — see R15.
- Any backend change — C5's API and derivation are already merged; this change is a pure frontend consumer.

### Design Decisions

#### `desktopOnly` as a typed field, not a parallel mechanism
**Decision**: Add `desktopOnly?: boolean` to the `SIDEBAR_SECTIONS` entry
type and gate both the rail button (`section-rail.tsx`) and the panel mount
(`index.tsx`) on it, rather than introducing a separate viewport-gating list
or config.
**Why**: `SIDEBAR_SECTIONS` is already the single source of truth for section
identity (key, default, label); a parallel list would risk drifting out of
sync with it, and the existing `useIsMobile()` hook is already imported in
both files that need to consult it.
**Rejected**: A hardcoded `if (section === "clock" && isMobile) return null` —
works today but doesn't scale if a second desktop-only section is ever added,
and hides the concept from anyone reading `SIDEBAR_SECTIONS` alone.
*Introduced by*: 260907-wuiu-clock-sidebar-section

#### `Cron: mute…`/`Cron: delete…` reuse the multi-toggle `optionPicker` in single-select mode
**Decision**: Model entry selection on the existing `PaletteOptionPicker`
(a multi-toggle sub-step with order badges), used here as a de-facto
single-select (act on the first selected key).
**Why**: It is the only entity-selection primitive the palette already has
(shipped, used in `lib/palette/sort.ts`); building a dedicated single-select
picker component for two actions is not justified by the scope.
**Rejected**: A brand-new single-select list-picker component — more surface
area for equivalent behavior; deferred until a second consumer justifies it.
*Introduced by*: 260907-wuiu-clock-sidebar-section

## Tasks

### Phase 1: Setup — Types & API Client

- [x] T001 Add `CronEntry`/`CronSchedule`/`CronWakeOn`/`CronTarget` TS types to `app/frontend/src/types.ts`, mirroring `app/backend/api/cron.go`'s `cronEntryJSON`/`cronScheduleJSON`/`cronWakeOnJSON`/`cronTargetJSON` wire shapes exactly (field names/optionality per the intake's § Data Layer). <!-- R4 -->
- [x] T002 [P] Add `monitored`/`monitoredChange`/`monitoredStage`/`monitoredRepo`/`monitoredBranch`/`monitoredAgent` optional fields to `WindowInfo` in `app/frontend/src/types.ts`. <!-- R8 -->
- [x] T003 [P] Add `operatorLastTickAt`/`operatorStale` optional fields to `ProjectSession` in `app/frontend/src/types.ts`. <!-- R8 -->
- [x] T004 Add `getCronEntries(server: string): Promise<CronEntry[]>`, `muteCronEntry(id: string, muted: boolean): Promise<void>`, `deleteCronEntry(id: string): Promise<void>` to `app/frontend/src/api/client.ts`, following the existing fetch-wrapper conventions (e.g. `getAllServerColors`/`setServerColor`). <!-- R4, R7, R14 -->

### Phase 2: Core Implementation — Section Rail + ClockPanel

- [x] T005 Extend `SidebarSection` union and `SIDEBAR_SECTIONS` array in `app/frontend/src/hooks/use-sidebar-sections.ts`: add the optional `desktopOnly?: boolean` field to the entry type, and append the `clock` entry (`key: "runkit-sidebar-section-clock"`, `defaultValue: false`, `label: "Clock"`, `desktopOnly: true`). <!-- R1 -->
- [x] T006 [P] Add `ClockSectionIcon` to `app/frontend/src/components/sidebar/icons.tsx`, matching the sibling stroke-SVG icon signature. <!-- R3 -->
- [x] T007 In `app/frontend/src/components/sidebar/section-rail.tsx`: import `ClockSectionIcon`, add `clock: ClockSectionIcon` to `SECTION_ICONS`, and skip rendering `SectionRailButton` for an entry when `entry.desktopOnly && useIsMobile()`. <!-- R2, R3 -->
- [x] T008 Create `app/frontend/src/components/sidebar/clock-panel.tsx` exporting `ClockPanel({ server }: { server: string | null })`: fetches `getCronEntries`, renders condensed rows (name, target chip, rung, next-fire, orphaned/muted dim treatment) or the `No cron entries` empty state; degrades to empty state without fetching when `server` is `null`. <!-- R4 -->
- [x] T009 Wire `ClockPanel`'s row-level `useRowFlyout` with `CardActionList`/`CardActionRow` Mute/Unmute and Delete action rows, calling `muteCronEntry`/`deleteCronEntry` from T004, following the `session-row.tsx:177-239` wiring shape. <!-- R7 -->
- [x] T010 In `app/frontend/src/components/sidebar/index.tsx`: read `const [clockSectionVisible] = useSidebarSectionVisible("clock");` alongside the other three; add a `showClock` prop to `BottomPanels` (threaded `clockSectionVisible && !isMobile`); mount `<CollapsiblePanel title="Clock" storageKey="runkit-panel-clock" defaultOpen={false}><ClockPanel server={currentServer} /></CollapsiblePanel>` inside `BottomPanels` gated on `showClock`. <!-- R5 -->
- [x] T011 Wire `ClockPanel`'s re-fetch to the sidebar's existing SSE-derived refresh signal for the current server (the same mechanism `ServerPanel`/`WindowPanel` use) — no `setInterval` polling. <!-- R6 -->

### Phase 3: Integration & Edge Cases — Watched Indicator, Staleness, Palette

- [x] T012 Add a `WatchedIndicator` presentational component (co-located in `window-row.tsx` or a new `watched-indicator.tsx`) rendering `◉` beside `StatusDot` when `win.monitored` is true, wrapped in a `Tip` with label `Watched by operator — {monitoredStage}`, `data-testid="row-watched-indicator"`; renders nothing when `win.monitored` is falsy. <!-- R9 -->
- [x] T013 [P] Add `WatchedLine({ win })` to `app/frontend/src/components/sidebar/row-flyout-card.tsx`, rendered directly below `NoteLine` inside `WindowFlyoutContent`, showing `watched · {monitoredRepo} · {monitoredStage} · {monitoredBranch}` (omitting empty segments) when `win.monitored` is true, `null` otherwise; `data-testid="row-flyout-watched-line"`. <!-- R10 -->
- [x] T014 Apply the dimmed/muted tint (reusing `NoteLine`'s stale-tint token) to `WatchedIndicator` when the owning session's `operatorStale` is true — thread `operatorStale` from the session down to `WindowRow` the same way other session-derived row props already flow. <!-- R11 -->
- [x] T015 [P] Add the `⚠ operator stale` warning strip to `ClockPanel`'s `CollapsiblePanel` `headerRight` slot, gated on the active server's `operatorStale`, with a `Tip` showing tick age derived from `operatorLastTickAt`; `data-testid="clock-header-stale-warning"`. <!-- R12 -->
- [x] T016 In `app/frontend/src/hooks/use-global-palette-actions.ts`: add `panel-toggle-clock` (`Panel: Toggle Clock`) following the exact existing 4-entry template, deps updated. <!-- R13 -->
- [x] T017 In the same file, add `cron-mute-entry` (`Cron: mute…`) and `cron-delete-entry` (`Cron: delete…`) using `PaletteOptionPicker` in single-selection mode over the active server's cron entries (fetched the same way `ClockPanel` does, or read from a shared source if one already exists at that call site), `disabled: true` when zero entries. <!-- R14 -->

### Phase 4: Polish — Tests

- [x] T018 [P] `app/frontend/src/components/sidebar/clock-panel.test.tsx`: empty state, entry row rendering (name/target/rung/next-fire), orphaned/muted dim treatment, mute/delete flyout actions calling the client functions. <!-- R4, R7 -->
- [x] T019 [P] Extend `app/frontend/src/components/sidebar/section-rail.test.tsx`: 5th toggle renders on desktop, is absent on mobile (`useIsMobile` mocked true). <!-- R1, R2, R3 -->
- [x] T020 [P] Extend `app/frontend/src/components/sidebar/index.test.tsx` (or add a targeted test) covering `showClock` gating: visible+desktop mounts `ClockPanel`, hidden or mobile does not. <!-- R5 -->
- [x] T021 [P] Extend `window-row.test.tsx` (if it exists) or add coverage for `WatchedIndicator` rendering/non-rendering and its dimmed-tint variant. <!-- R9, R11 -->
- [x] T022 [P] Extend `row-flyout-card.test.tsx` (if it exists) for `WatchedLine` rendering/non-rendering. <!-- R10 -->
- [x] T023 [P] Extend `use-global-palette-actions.test.ts` (if it exists) for the 3 new palette actions (`panel-toggle-clock`, `cron-mute-entry`, `cron-delete-entry`, including the disabled-when-empty case). <!-- R13, R14 -->

## Execution Order

- T001–T004 (types + client) block T008–T009, T012–T017.
- T005–T007 (section rail) are independent of T008–T011 (ClockPanel) but both must land before T010, which wires the two together.
- T012–T015 (watched indicator + staleness) depend on T002/T003 (TS types).
- T018–T023 (tests) depend on their respective implementation tasks landing first.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SIDEBAR_SECTIONS` has a 5th `clock` entry with `desktopOnly: true`, and `useSidebarSectionVisible("clock")` works.
- [x] A-002 R2: The Clock rail toggle does not render when `useIsMobile()` is true; renders normally on desktop.
- [x] A-003 R3: `ClockSectionIcon` exists, matches the sibling-icon signature, and is wired into `SECTION_ICONS`.
- [x] A-004 R4: `ClockPanel` fetches and renders cron entries (or the empty state) via `getCronEntries`.
- [x] A-005 R5: The CLOCK `CollapsiblePanel` mounts/unmounts on `clockSectionVisible && !isMobile`, independent of its own open/collapsed persistence.
- [x] A-006 R6: `ClockPanel` re-fetches on the sidebar's existing SSE refresh signal, with no `setInterval` anywhere in the new code.
- [x] A-007 R7: CLOCK row flyout Mute/Unmute and Delete actions call the correct API endpoints and update the list.
- [x] A-008 R8: `WindowInfo`/`ProjectSession` TS types carry the 8 new optional fields with correct names/types.
- [x] A-009 R9: `WatchedIndicator` renders `◉` exactly when `win.monitored` is true, with an accessible label.
- [x] A-010 R10: `WatchedLine` renders the watched detail line below `NoteLine` exactly when `win.monitored` is true.
- [x] A-011 R13: `Panel: Toggle Clock` toggles the CLOCK section from the palette.
- [x] A-012 R14: `Cron: mute…`/`Cron: delete…` work via the option picker and are disabled with zero entries.

### Behavioral Correctness

- [x] A-013 R11: A stale session's `WatchedIndicator` glyphs render dimmed; a non-stale session's render at full treatment.
- [x] A-014 R12: The CLOCK header warning strip appears exactly when the active server has a stale session, reading the same `operatorStale` field as A-013 (no separate client threshold).

### Scenario Coverage

- [x] A-015 R4: An orphaned or muted entry renders with the documented dim/struck row treatment.
- [x] A-016 R7: Deleting an entry via the flyout removes it from the visible list after the next re-fetch.

### Edge Cases & Error Handling

- [x] A-017 R4: `ClockPanel` on the board route (`server === null`) renders its empty state without attempting a fetch.
- [x] A-018 R14: With zero cron entries on the active server, `Cron: mute…`/`Cron: delete…` render disabled rather than being omitted or throwing.

### Code Quality

- [x] A-019 Pattern consistency: New code follows the `HostPanel`/`session-row.tsx` templates identified in the intake (CollapsiblePanel structure, `useRowFlyout`/`CardActionList`/`CardActionRow` wiring, `Tip` usage, stroke-SVG icon idiom).
- [x] A-020 No unnecessary duplication: cron API client functions live alongside (or reuse the pattern of) existing functions in `client.ts`; no re-implementation of `useRowFlyout`, `CollapsiblePanel`, or the section-rail mechanism.
- [x] A-021 Frontend type narrowing: no `as` casts introduced for the new `CronEntry`/`WindowInfo`/`ProjectSession` fields — `if` guards / optional chaining used instead.
- [x] A-022 Derive state from tmux + filesystem (via the API), no in-memory caches: `ClockPanel` holds no client-side cache beyond React state re-derived on each fetch/SSE tick.
- [x] A-023 UI changes include Playwright/unit test coverage where reasonable (per code-quality.md "UI changes SHOULD include Playwright e2e tests where possible") — Vitest/RTL coverage per T018–T023 is required; an e2e spec is a nice-to-have given this is primarily desktop-viewport visibility work already covered by component tests.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The palette's `Cron: mute…` action always mutes (never toggles unmute) — unmuting an already-muted entry is only reachable via the row flyout | The label is unqualified ("mute", not "toggle mute"); a palette-level toggle would need to show current state in the option list, adding complexity for a rarely-used path when the row flyout already covers unmute | S:45 R:80 A:60 D:55 |
| 2 | Confident | `ClockPanel`'s SSE re-fetch mechanism follows whatever hook `ServerPanel`/`WindowPanel` already use (not fully named in the intake) | The intake explicitly deferred the exact hook name to apply-time codebase inspection; the constraint (no polling, reuse existing SSE-tick mechanism) is unambiguous and Confident-gradeable even without the exact hook name | S:50 R:75 A:70 D:60 |
| 3 | Confident | `operatorStale` is threaded from session to `WindowRow` via whatever prop-passing convention other session-derived row data already uses (not a new context) | Consistent with the codebase's existing pattern of passing session-scoped facts down through `ServerGroup`/`SessionRow`/`WindowRow` props rather than a new context provider; R6a's render-performance invariant (stable prop identity) constrains the exact shape at apply time | S:45 R:70 A:65 D:55 |

3 assumptions (0 certain, 3 confident, 0 tentative).
