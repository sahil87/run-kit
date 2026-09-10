---
type: memory
description: "The cron Activity feed — a timeline merging upcoming fires with recent deliveries around a now-divider (muted/orphaned dimmed, never omitted), mounted on the mobile operator route's ?tab=activity segment and as the desktop console drawer's Activity segment via the shared ConsoleSegments strip; the pinned operator-staleness banner, the entry detail sheet (mute/pin/delete, optimistic toggles, inline in-container variant), the describeSchedule helper, and useCronData on the SSE sessions cadence."
---
# run-kit UI — Cron Activity

**Domain**: run-kit/ui

## Overview

The cron Activity feed is the cron clock's timeline surface ([cron](/run-kit/cron.md)) — one time-ordered triage timeline (the healthchecks.io agenda pattern) with two mounts: the mobile operator route's `tab` search param set to `activity` (the `Terminal | Activity` segmented-header gate — [operator-console](/run-kit/ui/operator-console.md) § Mobile open is navigation to the operator terminal route) and the desktop operator console drawer's Activity segment ([operator-console](/run-kit/ui/operator-console.md) § Desktop Terminal | Activity segments, where the `TerminalClient` unmounts while the feed shows). Components: `components/cron-activity-feed.tsx` (feed + banner), `components/cron-entry-detail-sheet.tsx` (the per-entry action surface), `components/terminal-activity-tabs.tsx` (the shared segment strip), `hooks/use-cron.ts` (data), and `lib/cron-schedule.ts` (the plain-words schedule helper shared by feed rows and the sheet). The backend contract is `GET /api/cron`'s `entries` + `deliveries` ([cron](/run-kit/cron.md) § HTTP API); staleness reads `operatorStale`/`operatorLastTickAt` off the existing sessions payload — no new fetch.

## Requirements

### Requirement: Two mounts share one controlled segment strip
The `Terminal | Activity` segment strip SHALL be a single controlled presentational component — `ConsoleSegments({ value, onChange })` in `components/terminal-activity-tabs.tsx` — consumed by both mounts with identical markup, roles, and test ids (`role="tablist"` / `role="tab"` / `aria-selected`, `controlClass({ variant: "segment" })`, `data-testid="terminal-activity-tabs"`). `TerminalActivityTabs` is a thin wrapper driving the router `tab` search param (a client-side search update with `replace: true`, never a full navigation); the desktop console drives the strip with console-local component state instead. The mobile behavior and test ids stay byte-identical.

### Requirement: One merged timeline around a "now" divider
The feed SHALL render one timeline merging upcoming fires and recent deliveries, separated by a single "now" divider row. Upcoming fires list EVERY entry — muted/orphaned included but dimmed (`opacity-50` plus a `· muted` / `· orphaned` marker), never omitted — sorted farthest-future first so the SOONEST sits adjacent to the divider; entries the evaluator gave no `nextFire` (an unresolved backoff anchor, a cron expression that fails to parse) carry no fabricated time and sort to the far end. The muted dimming keys on the server's EFFECTIVE `muted` (the stored flag OR an unexpired `muted_until` lease — the lease fact needs no client-side handling) (upt2). Deliveries render in the API's most-recent-first order as-is, so the newest sits adjacent to the divider. Row anatomy: the entry name (delivery rows fall back to the entry id), a plain-words schedule fragment (`describeSchedule`) on upcoming rows or the delivery outcome on past rows, and a relative time (`in 5m` / `due` / `3m ago` via `formatDuration`). An empty server (no entries, no deliveries) renders a centered "no cron entries on this server" hint.

#### Scenario: Ordering around the divider
- **GIVEN** entries with future `nextFire` values and a non-empty `deliveries` array
- **WHEN** the feed renders
- **THEN** the soonest upcoming fire sits directly above the divider and the newest delivery directly below it
- **AND GIVEN** a muted entry with a computed `nextFire`, **THEN** its row renders dimmed, not absent

### Requirement: Data rides the existing sessions cadence — no polling
Feed data SHALL come from `useCronData(server)` (`hooks/use-cron.ts`): a mount fetch of `GET /api/cron?server=<slug>` plus a refetch on every state-socket `sessions` event for that server — the same SSE-driven cadence every surface rides (cron mutations wake the hub server-side, so a mutation's confirmation lands on the next tick). No timers, no polling loop; a transient fetch failure keeps the last good data. An empty/unresolvable server fires NO request and degrades to the operator console's absent/hint state — a centered hint line ("no server resolved — cron activity unavailable").

### Requirement: Pinned staleness banner
The feed SHALL render a pinned (non-scrolling) banner at the top of the timeline exactly when any of the resolved server's sessions reports `operatorStale === true` — reading the existing `ProjectSession.operatorStale`/`operatorLastTickAt` fields through the session context, no new fetch — carrying a plain-language relative-time statement derived from `operatorLastTickAt` ("operator tick — last seen {duration} ago"; "operator tick — no recent tick" when 0). The banner is absent when `operatorStale` is false or unknown.

#### Scenario: Banner gating
- **GIVEN** a server whose sessions report `operatorStale: true` with an `operatorLastTickAt`
- **WHEN** the feed renders
- **THEN** the pinned banner shows the relative-time staleness statement
- **AND GIVEN** `operatorStale: false`, **THEN** no banner renders

### Requirement: Row tap opens the entry detail sheet
Tapping any feed row SHALL open `CronEntryDetailSheet` scoped to that row's entry — the sole mobile action surface for an entry (the spec's alarm-app anatomy): name, the `describeSchedule` sentence, Last fired / Next fire rows, a mute switch, a pin switch, and a delete row. A DELIVERY row for a since-deleted entry stays valid history but opens nothing — the sheet needs the live entry.

The sheet is a bottom-anchored overlay panel riding the Dialog idioms (backdrop tap + Escape close via the focus trap, settings-dialog row/toggle markup, `role="dialog"` — no Sheet/BottomSheet primitive exists to extend). `lastFired` 0 renders "never"; an absent `nextFire` renders "unknown". Mute (`POST /api/cron/mute {id, muted}`) and pin (`POST /api/cron/pin {id, pinned}`) are whole-row switches reflecting OPTIMISTICALLY — a local override until the next SSE-driven refetch's entry confirms the value, then the override clears; a failure reverts to the prop value and surfaces the error inline (`role="alert"`). Delete (`POST /api/cron/delete {id}`) is a two-step kill-confirm inline in the sheet and closes it on success.

The sheet has an **`inline` variant** for the desktop drawer mount: `CronActivityFeed` takes an optional `inline` prop it forwards to the sheet and uses to make its own root `relative`; the inline sheet drops the fixed full-viewport backdrop and `aria-modal` for an in-container `absolute inset-0` panel whose header close control reads `‹ Activity` and returns to the feed — the rows (schedule sentence, Last fired / Next fire, mute/pin switches, delete with confirm) are unchanged, and the default (mobile) variant is untouched. Esc inside the inline panel returns to the feed only, never collapses the drawer: the panel's focus trap claims the key with `preventDefault`, and the drawer's document Esc listener additionally stands down via a DOM check for a nested `[role="dialog"]` inside the drawer root ([operator-console](/run-kit/ui/operator-console.md) § Desktop Terminal | Activity segments).

### Requirement: Plain-words schedule descriptions
`describeSchedule(entry)` (`lib/cron-schedule.ts` — a dependency-free leaf module with a locally-declared structural input type, the router-url.ts convention, so `api/client.ts`'s `CronEntry` is assignable without an import edge) SHALL translate the schedule (plus `wakeOn`, when present — appended as "; wakes on {event}") into a sentence: `{kind: "every", interval}` → "every {humanized duration}" (the numeral drops only for a single-unit duration — "every hour", not "every 1 hour"); `{kind: "backoff", min, max}` → "backs off from {min} up to {max} since last activity"; `{kind: "cron", expr}` → the raw expression ("cron expression" when empty). Unknown kinds render their raw kind, never a fabricated phrasing; unparseable Go-style durations pass through verbatim (`humanizeDuration`).

## Design Decisions

### Detail panel is an inline variant of the existing sheet, not a new component
**Decision**: `CronEntryDetailSheet` gains an `inline` prop that swaps its fixed backdrop + bottom anchoring for an in-container `absolute inset-0` panel with a `‹ Activity` back control.
**Why**: one component keeps mute/pin/delete semantics (optimistic overrides, confirm step, error line) identical on both form factors; the drawer's `translate` transform would already trap a `fixed` sheet inside the drawer box, so the variant makes that explicit rather than accidental.
**Rejected**: a modal over the quake drawer (heavy, a dialog over a dialog); a flyout card (the cron-clock design study bans flyouts for this content); a second detail component (drift).
*Introduced by*: 260910-6ehs-console-activity-segment-status-chip

### Muted/orphaned entries dim, never omit
**Decision**: muted and orphaned entries stay in the upcoming block with a dimmed treatment rather than being filtered out.
**Why**: the feed is triage — a muted backstop is exactly what a phone user must be able to see at a glance; the spec's treatment-not-omission rule matches the desktop CLOCK panel's row treatment.
**Rejected**: hiding them (the registry pattern's instinct — contradicts the feed's glanceability purpose).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### Undated entries sort to the far end of the upcoming block
**Decision**: entries with no evaluator `nextFire` render at the far (top) end of the upcoming block, unhidden, with an empty time column.
**Why**: one sorting rule (absent `nextFire` ⇒ maximum sort key) covers every undated case — no fabricated next-fire and no second special case.
**Rejected**: a separate "unevaluated" section (a second special case for the same no-fabricated-time contract); omitting undated entries (violates the never-omit rule).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### Sheet mutations are optimistic, reconciled by the SSE refetch
**Decision**: mute/pin reflect instantly via a local override that clears once the next SSE-driven refetch's entry confirms the value; failures revert and surface inline.
**Why**: every cron mutation wakes the SSE hub server-side, so confirmation is one tick away — the existing optimistic-mutation pattern ([dialogs-and-state](/run-kit/ui/dialogs-and-state.md)).
**Rejected**: waiting for the POST response to repaint (a beat of dead UI on the phone's primary action surface); a client-side confirmation timer (a polling loop — banned).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### The feed's relative times are render-time only
**Decision**: "in 5m" / "3m ago" labels compute from `Date.now()` at render time; the SSE-cadence refetch is the clock.
**Why**: a ticking timer would be a new client-side poll for a label-only concern; the refetch cadence already repaints the feed often enough for minute-granularity labels.
**Rejected**: a per-second `setInterval` re-render (client polling); server-computed relative strings (stale the moment they're served).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed
