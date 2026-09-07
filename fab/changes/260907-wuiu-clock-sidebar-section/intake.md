# Intake: Desktop UI: CLOCK Sidebar Section

**Change**: 260907-wuiu-clock-sidebar-section
**Created**: 2026-09-07

## Origin

> Operator dispatch (C6 of the cron-clock execution plan, Wave 3 — P2 visibility):
> "Desktop UI: CLOCK sidebar section (CollapsiblePanel, 5th section-rail toggle,
> desktop-only), watched-row ◉ indicator + flyout-card detail line, staleness
> dimming + header warning, palette actions."

One-shot dispatch, not a live conversation — the design authority is entirely
written down already: `docs/specs/cron.md` § UI — Three Tiers (Tier 1: Glance)
and `fab/plans/sahil/26-09-06-cron-clock-plan.md` (Wave 3, row C6). This intake
transfers that written design into concrete, codebase-grounded implementation
detail (exact files, exact prop shapes) so apply has zero ambiguity about
*how* to wire it, even though it has zero conversational back-and-forth to
draw on.

**Sequencing context**: C5 (`GET/POST /api/cron`, watchlist+staleness
derivation onto the sessions payload) is already merged to `origin/main`
(commit `2959c995`, PR #862) and its bookkeeping change (`1jm6`) is archived
in this worktree. C6 (this change) and C7 (mobile UI, a sibling agent's
change in a different worktree) both depend on C5 and run in parallel; C6 is
strictly desktop/sidebar scope — the mobile console sheet's Terminal/Activity
segments belong entirely to C7 and are out of scope here.

**Standing rule that gates review** (from the plan's Risks section, repeated
because it is a constitution-adjacent constraint on this change specifically):
> **UI is a pure projection** of (entry YAML + delivery log + derived state)
> — no runtime fact may live only in daemon memory.

Concretely: the frontend MUST consume `GET /api/cron` and the
`monitored*`/`operatorStale`/`operatorLastTickAt` fields already riding the
sessions/window payload (see § What Changes → Data Layer below) — it MUST
NOT read cron entry YAML, the delivery log, or the fab operator state file
directly, and MUST NOT invent client-only derived state that isn't already
computed server-side (`DeriveEntry`, `operatorStaleness`).

## Why

1. **The problem**: cron entries and the operator's watchlist are currently
   invisible in the UI. C5 built the API and derivation layer, but nothing
   consumes it — `grep -rn "Monitored\b" app/frontend/src` and a search for
   any cron-consuming code both return zero hits today. An agent or operator
   cannot see "what is scheduled" or "what is the operator watching" without
   shelling out to `rk cron list` or reading YAML by hand.
2. **Consequence of not fixing it**: the P1.5 backstop (C4, already shipped)
   makes the cron substrate durable and correct, but a stale/dead cron entry
   or a stale operator loop is silently invisible until something breaks —
   exactly the incident class (dev-ws-sahil01, 2026-09-03) the whole cron
   plan exists to prevent from recurring undetected.
3. **Why a sidebar section over alternatives**: the spec explicitly tiers the
   UI (Glance / Dashboard / Immersion) and rejects a dedicated `clock`
   surface kind, a Host-page-only view, and a status-bar-only readout (see
   `docs/specs/cron.md` § UI, "Rejected" paragraph) — a glanceable,
   always-available `CollapsiblePanel` behind the existing section-visibility
   rail is the cheapest mechanism that reuses 100% shipped infrastructure
   (`CollapsiblePanel`, `useSidebarSectionVisible`, `useRowFlyout`, the
   palette action list). The dashboard tier (the reserved `agents` surface
   kind) and the mobile Activity feed are separate changes (deliberately not
   this one's scope).

## What Changes

### 1. New sidebar section: `CLOCK` (5th `CollapsiblePanel`)

A new `ClockPanel` component (`app/frontend/src/components/sidebar/clock-panel.tsx`,
new file) modeled directly on the smallest existing consumer,
`app/frontend/src/components/sidebar/host-panel.tsx`:

- Fetches `GET /api/cron?server=<currentServer>` (new client function in
  `app/frontend/src/api/client.ts`, following the existing fetch-wrapper
  pattern used by `getAllServerColors`/`getAllServerFlairs` etc.) and renders
  one condensed row per entry: **name, target chip (role/session/pane +
  discriminant, e.g. `role: operator`), live backoff rung (`rung` field,
  backoff-kind entries only), next fire (`nextFire`, human-relative,
  omitted/rendered as "—" when absent), and orphaned/muted treatment**
  (dimmed/struck-through row style + a small badge, mirroring the general
  "dim + note" idiom `NoteLine` already uses for staleness in
  `row-flyout-card.tsx:369`).
- Empty state: `No cron entries` (same `text-xs text-text-secondary` idiom
  `HostPanel` uses for "No metrics").
- Mounted via:
  ```tsx
  <CollapsiblePanel title="Clock" storageKey="runkit-panel-clock" defaultOpen={false}>
    <ClockPanel server={currentServer} />
  </CollapsiblePanel>
  ```
  wired into `app/frontend/src/components/sidebar/index.tsx`'s `BottomPanels`
  block (lines ~2138–2178, alongside the existing `showPane`/`showHost`
  conditionals) — add a `showClock` prop threaded the same way
  `showPane`/`showHost` are, and gate the ENTIRE row (both the section-rail
  toggle and the panel mount) on `!isMobile` (see § Desktop-only gating
  below). `server={currentServer}`: on the board route (`currentServer ===
  null`) the panel renders its own empty/absent state rather than fetching —
  mirror the existing degrade-to-absent posture other server-scoped panels
  use (`ServerPanel`, `WindowPanel`).
- Re-fetch trigger: the SSE hub already wakes on every cron mutation
  (`s.sseHub.wake(server)` — `app/backend/api/cron.go`); the panel should
  subscribe to the existing SSE-derived refresh signal the sidebar already
  uses for other server-scoped data (follow whatever hook `ServerPanel`/
  `WindowPanel` use to re-render on SSE ticks — do not poll on an interval).

### 2. Section-visibility rail: 5th toggle, desktop-only

- `app/frontend/src/hooks/use-sidebar-sections.ts`:
  - Extend `SidebarSection` (line 5): `"boards" | "server" | "pane" | "host" | "clock"`.
  - Extend the `SIDEBAR_SECTIONS` array's element type with a new optional
    `desktopOnly?: boolean` field, and append:
    `{ section: "clock", key: "runkit-sidebar-section-clock", defaultValue: false, label: "Clock", desktopOnly: true }`.
    (`defaultValue: false` matches the plan's "default off" requirement,
    same posture as `pane`/`host`.)
- `app/frontend/src/components/sidebar/icons.tsx`: add `ClockSectionIcon`
  following the exact sibling-icon signature (`currentColor` stroke,
  `strokeWidth={2}`, round caps/joins, `aria-hidden="true"`, 24-unit
  viewBox, `size = 13` default) — a simple clock-face glyph, e.g.
  `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`.
- `app/frontend/src/components/sidebar/section-rail.tsx`:
  - Import and add `clock: ClockSectionIcon` to `SECTION_ICONS` (lines 16–21).
  - In `SectionRailButton` (lines 45–70), skip rendering when
    `entry.desktopOnly && useIsMobile()` — this is new mechanism (no
    existing section is viewport-gated at the rail level today; `useIsMobile`
    already exists at `app/frontend/src/hooks/use-is-mobile.ts`).
- `app/frontend/src/components/sidebar/index.tsx`: add
  `const [clockSectionVisible] = useSidebarSectionVisible("clock");`
  alongside the other three reads (lines ~994–997), and gate the
  `BottomPanels` mount's `showClock` prop on `clockSectionVisible &&
  !isMobile` (the `isMobile` value is already computed in this file at
  line 990).

### 3. Watched-row indicator (◉) + flyout-card detail line

This is greenfield — no existing dot/glyph precedent for "monitored by the
operator" exists in the codebase (`grep -rn "Monitored\b" app/frontend/src`
and a search for "watched"/"◉" both return zero hits). The data already
rides the window payload from C5 (`app/backend/internal/tmux/tmux.go`
`WindowInfo.Monitored`/`MonitoredChange`/`MonitoredStage`/`MonitoredRepo`/
`MonitoredBranch`/`MonitoredAgent`, all `omitempty`), but has no TS mirror
yet — `app/frontend/src/types.ts` `WindowInfo` (line 89) needs the same six
fields added (camelCase already matches the Go JSON tags, since backend uses
`json:"monitored,omitempty"` etc. — no field-name translation needed).

- **Row indicator**: in `app/frontend/src/components/sidebar/window-row.tsx`,
  render a small `◉` glyph beside (not replacing) the existing `StatusDot`
  when `win.monitored` is true — a new tiny presentational component,
  `WatchedIndicator` (co-locate in `window-row.tsx` or a new
  `watched-indicator.tsx` if it needs sharing with the flyout), styled with
  a `Tip` (fine-pointer hover label, e.g. `Watched by operator — {stage}`)
  mirroring the `Tip` pattern already used throughout `session-row.tsx`.
- **Flyout detail line**: `WindowFlyoutContent` in `row-flyout-card.tsx`
  (line 662) already composes a `NoteLine` for `@rk_win_note`. Add a
  sibling detail line, e.g. `WatchedLine({ win })`, rendered directly below
  `NoteLine` when `win.monitored` is true:
  `watched · {monitoredRepo} · {monitoredStage} · {monitoredBranch}` (exact
  field order/format is a presentation-only Tentative call — see
  Assumptions). No new action rows are needed here (this is a read-only
  detail, unlike the CLOCK panel's own row-flyout which DOES carry
  mute/delete actions per § 1).
- The CLOCK panel's own condensed rows (§ 1) get their own flyout via
  `useRowFlyout` (same hook, new call site) with `CardActionList` +
  `CardActionRow` for **Mute** / **Unmute** (posts
  `POST /api/cron/mute {id, muted}`) and **Delete** (danger-styled
  `CardActionRow`, posts `POST /api/cron/delete {id}`) — mirroring the
  exact `session-row.tsx:177-239` wiring shape (`close()` before any
  follow-up popover, `testid` per action).

### 4. Staleness dimming + CLOCK header warning

- Staleness source: `ProjectSession.OperatorStale` /
  `OperatorLastTickAt` (`app/backend/internal/sessions/sessions.go`
  lines 70–71, `operatorStaleness()` at line 138 — stale when
  `lastTickAt > 0 && now - lastTickAt > 15m`, the `cron.DefaultWatchlistStaleThreshold`).
  These need the same TS mirror treatment as `WindowInfo` above:
  `ProjectSession` in `types.ts` (line 56) gains `operatorLastTickAt?: number`
  and `operatorStale?: boolean`.
- **Row dimming**: when a session's `operatorStale` is true, every
  `WatchedIndicator` (§ 3) under that session renders in a dimmed/muted
  tint (reuse the existing dim treatment `NoteLine` applies past
  `NOTE_STALE_SECONDS`, `row-flyout-card.tsx:369` — same visual language,
  new trigger condition).
  - **Header warning**: the `ClockPanel`'s `CollapsiblePanel` header (the
  `headerRight` slot, same slot `HostPanel` uses for its hostname text) shows
  a short warning strip, e.g. `⚠ operator stale` with a `Tip` giving the
  tick age, whenever the active server's `operatorStale` is true — this
  reads the SAME field as the row dimming (single staleness timestamp per
  the spec's "single source serving every consumer" rule), never a
  separately-computed client threshold.

### 5. Palette actions

`app/frontend/src/hooks/use-global-palette-actions.ts` already has the exact
template at lines 190–202 (`panel-toggle-{boards,server,pane,host}`). Add:

- `panel-toggle-clock` → `Panel: Toggle Clock`, identical shape to the
  existing four (`useSidebarSectionVisible("clock")`, spread into
  `panelActions`, deps array updated). Definite, zero ambiguity — direct
  precedent.
- `cron-mute-entry` → `Cron: mute…` and `cron-delete-entry` → `Cron:
  delete…`: implemented via the existing `optionPicker` mechanism
  (`PaletteOptionPicker`, `components/command-palette.tsx:15-20` — a
  multi-toggle sub-step with `options: {key,label}[]` and an `onApply`
  callback) used in **single-selection mode**: the option list is the
  current server's cron entries (`key: id, label: name`), and `onApply`
  fires the mute/delete POST for the first (only) selected key. This reuses
  a shipped primitive rather than inventing a new single-entity picker.
  Disabled (`disabled: true`, per the existing `PaletteAction.disabled`
  affordance) when the current server has zero cron entries.

**Out of scope for this change** (see Assumptions #4): `Cron: new entry` —
creating an entry needs a multi-field form (schedule kind, interval/backoff
bounds, target, payload) with no existing dialog precedent to model it on,
and the spec's own Tier-1 description only mentions mute/delete on the row
flyout, never a create affordance in the sidebar. `rk cron add` remains the
creation path; the palette action is deferred to a later change (likely
paired with the dashboard tier, C-numbered later in the plan, where a
richer surface exists for a creation form).

### 6. Data layer / API client

- New `app/frontend/src/api/client.ts` functions: `getCronEntries(server:
  string): Promise<CronEntry[]>` (`GET /api/cron?server=`), `muteCronEntry(id:
  string, muted: boolean)`, `deleteCronEntry(id: string)` — following the
  existing fetch-wrapper conventions in that file (see `getAllServerColors`/
  `setServerColor` for the GET/POST pairing idiom).
- New TS types mirroring `app/backend/api/cron.go`'s wire shapes exactly
  (`cronEntryJSON`, `cronScheduleJSON`, `cronWakeOnJSON`, `cronTargetJSON`):
  ```ts
  export type CronEntry = {
    id: string;
    name?: string;
    schedule: { kind: string; interval?: string; anchor?: string; min?: string; max?: string; expr?: string };
    wakeOn?: { event: string; scope?: string; debounce?: string };
    target: { kind: string; role?: string; session?: string; pane?: string };
    payload: string;
    deliver?: string;
    ifAbsent?: string;
    pinned?: boolean;
    muted?: boolean;
    lastFired: number;
    nextFire?: number;
    rung?: number;
    orphaned?: boolean;
  };
  ```
  Place these alongside the other API-mirroring types in `types.ts`, or
  co-locate in a new `app/frontend/src/api/cron.ts` if that better matches
  how `client.ts` is currently organized (apply may choose based on file-size
  precedent — a Tentative call, see Assumptions).

## Affected Memory

- `run-kit/ui/sidebar`: (modify) new CLOCK `CollapsiblePanel` section, the
  5th section-rail toggle (first desktop-only-gated one — new
  `desktopOnly` concept on `SIDEBAR_SECTIONS`), the watched-row `◉`
  indicator + its flyout detail line, staleness dimming, and the new
  `panel-toggle-clock`/`cron-mute-entry`/`cron-delete-entry` palette
  actions.
- `run-kit/cron`: (modify) the memory file's own text currently says "the
  frontend is a later wave of the cron clock plan" (Overview paragraph) —
  update to note the Tier-1 sidebar landing now exists and point at the
  `ui/sidebar` domain for the frontend-side detail, keeping this file
  backend-authoritative per its existing scope.

## Impact

**New files**:
- `app/frontend/src/components/sidebar/clock-panel.tsx`
- Possibly `app/frontend/src/api/cron.ts` (types + client functions, if not
  folded into existing `client.ts`/`types.ts`)

**Modified files**:
- `app/frontend/src/hooks/use-sidebar-sections.ts` (new section + `desktopOnly` field)
- `app/frontend/src/components/sidebar/icons.tsx` (`ClockSectionIcon`)
- `app/frontend/src/components/sidebar/section-rail.tsx` (icon map + desktop-only skip)
- `app/frontend/src/components/sidebar/index.tsx` (visibility read, `BottomPanels` wiring)
- `app/frontend/src/components/sidebar/row-flyout-card.tsx` (`WatchedLine`, or equivalent)
- `app/frontend/src/components/sidebar/window-row.tsx` (`WatchedIndicator` render)
- `app/frontend/src/hooks/use-global-palette-actions.ts` (3 new palette actions)
- `app/frontend/src/api/client.ts` (cron fetch/mutate functions)
- `app/frontend/src/types.ts` (`CronEntry` type; `WindowInfo`/`ProjectSession` field additions)

**No backend changes** — C5's API and derivation are already merged; this
change is a pure frontend consumer. **No changes to C7's scope** (mobile
console sheet, `app/frontend/src/components/**mobile**` or equivalent) —
the `desktopOnly` gate on the section rail is the explicit boundary that
keeps this change's UI invisible on mobile, where C7 owns the Activity feed
instead.

**Testing**: existing sidebar test files establish the pattern
(`collapsible-panel.test.tsx`, `section-rail.test.tsx`, `boards-section.test.tsx`,
`status-panel.test.tsx`) — a new `clock-panel.test.tsx` plus additions to
`section-rail.test.tsx`/`index.test.tsx` for the desktop-only gating and the
5th toggle should follow the same component-test conventions (no new test
infra needed).

## Open Questions

(none — the two genuine ambiguities found during grounding, palette-action
scope and file placement for the new TS types, were resolved as graded
assumptions below rather than left open, per SRAD: both are Confident/
Tentative, not Unresolved.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Consume `GET /api/cron` + the existing `Monitored*`/`operatorStale`/`operatorLastTickAt` fields exclusively; never read cron YAML/log/operator-state files from the frontend | Direct constitution-adjacent standing rule from the plan's Risks section ("UI is a pure projection") — no reasonable alternative | S:95 R:90 A:95 D:95 |
| 2 | Certain | `ClockPanel` follows the `HostPanel` template (`CollapsiblePanel` + empty-state text + content component) | Explicit codebase precedent, smallest existing consumer of `CollapsiblePanel`, directly named in the dispatch | S:90 R:85 A:95 D:90 |
| 3 | Confident | The CLOCK section-rail toggle is the first `desktopOnly`-gated entry — add a new `desktopOnly?: boolean` field to `SIDEBAR_SECTIONS` rather than a parallel mechanism | No existing precedent (PANE/HOST are explicitly documented as viewport-independent per an earlier design decision, 260814-ldbs), but the plan's requirement ("desktop-only... rail toggle hidden on mobile") is unambiguous and the minimal extension of the existing typed array is the obvious shape | S:70 R:75 A:70 D:75 |
| 4 | Confident | `Cron: new entry` palette action is deferred out of this change's scope; only `Panel: Toggle Clock`, `Cron: mute…`, `Cron: delete…` ship here | Spec's Tier-1 row description only mentions mute/delete via the row flyout, never a sidebar create affordance; a create form needs schedule-kind/target/payload fields with no dialog precedent to model against, while `rk cron add` already covers creation with zero required flags — deferring is low-risk and easily added later via `/fab-clarify` or a follow-up change | S:45 R:70 A:65 D:55 |
| 5 | Confident | `Cron: mute…`/`Cron: delete…` use the existing `PaletteOptionPicker` (multi-toggle) in single-selection mode rather than a new picker primitive | `optionPicker` is the only entity-selection mechanism the palette already has (used today in `lib/palette/sort.ts`); reusing it avoids inventing new UI, and the ellipsis-suffixed label convention matches sub-step actions elsewhere in the palette | S:50 R:70 A:70 D:60 |
| 6 | Tentative | Row-flyout `WatchedLine` format: `watched · {repo} · {stage} · {branch}` | Presentation-only guess — no existing multi-field flyout detail line to copy verbatim (`NoteLine` is single-field); easily adjusted in review since it is pure JSX with no data-shape consequence | S:35 R:80 A:40 D:35 <!-- assumed: exact watched-row flyout detail text/field order --> |
| 7 | Tentative | New `CronEntry` TS type + cron client functions live in a new `app/frontend/src/api/cron.ts` rather than folded into the existing monolithic `client.ts`/`types.ts` | No `api/` sub-file precedent was found during grounding (unclear if `client.ts` is deliberately kept as one file); apply should check `client.ts`'s current size/organization before deciding and may choose either placement — purely organizational, zero behavioral consequence | S:30 R:85 A:45 D:40 <!-- assumed: file placement for new cron TS types/client functions, defer to apply's judgment on client.ts organization --> |

7 assumptions (2 certain, 3 confident, 2 tentative, 0 unresolved). Run /fab-clarify to review.
