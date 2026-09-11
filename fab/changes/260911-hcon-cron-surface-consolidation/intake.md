# Intake: Cron surface consolidation — console `Cron List | Cron Log` tabs, retire the sidebar CLOCK section and the Server-page CRONS / RECENT DELIVERIES zones, add a `cron` topic page to the rk skill bundle

**Change**: 260911-hcon-cron-surface-consolidation
**Created**: 2026-09-11

## Origin

Conversational — a `/fab-discuss` audit enumerated every place the cron clock is exposed today, the user proposed renaming the console's Activity tab and adding a second tab showing `rk cron list`, the agent recommended the shape below and the user agreed. This intake was then created by a promptless dispatch (`/fab-proceed` create-new); no further questions were asked.

> Cron surface consolidation — console `Cron List | Cron Log` tabs, retire the sidebar CLOCK section and the Server-page CRONS/RECENT DELIVERIES zones, add a `cron` topic page to the rk skill bundle.
>
> Net effect: web surfaces go from five to three — the `◷` chip for the glance, the console tabs for read and act, the Server page WATCHED zone for the fleet view — and the skill page makes the feature discoverable to the agents that author entries.

Key decisions from the discussion (all agreed; reproduced in full under § What Changes):

1. The console (quake terminal) segment strip is designed for FOUR tabs in this fixed order and Title Case: `Operator Terminal | Operator Tasks | Cron List | Cron Log`. This change builds only the last two and relabels the existing Terminal segment `Operator Terminal`; `Operator Tasks` is a future change (the strip's layout must accommodate four tabs; the fourth slot is not rendered until that change ships unless a disabled placeholder is trivial — implementer's call). `Cron List` comes BEFORE `Cron Log` in the strip and in the palette entries. Same segments on both form factors; names mirror the CLI (`rk cron list`). Rejected names: "Watches"/"Cron Watches" (collides with the operator's worker watchlist — the StatusDot underbar, the Server-page WATCHED zone, the `opr` register); "Logs"/"Cron Logs" for the current merged feed (half of it is computed upcoming fires, not logs).
2. `Cron Log` = deliveries only, newest first; the computed "upcoming fires" half and the "now" divider are dropped. The staleness banner stays and renders above BOTH tabs.
3. `Cron List` = the `rk cron list` registry with the API's live derived columns, sorted by next fire soonest first, with row actions mute/unmute (incl. lease), pin/unpin, edit, delete and a `+ New entry` affordance. Edit reuses the create dialog in an edit mode backed by `POST /api/cron/edit`; target and creator immutable.
4. Deep-link/seam rename with a one-release alias: `?tab=activity` keeps working as an alias for `Cron Log`; `PushURL` emits the new value; palette `Operator: Show clock activity` → `Operator: Show cron log`, plus a new `Operator: Show cron list`.
5. Status-bar `◷` chip unchanged visually; click and overflow row open the console on `Cron List`.
6. Retire the sidebar CLOCK section entirely (panel, rail button, icon, section entry, `Panel: Toggle Clock`, CLOCK flyout wiring). Watched underbar and `opr` register untouched.
7. Server page drops CRONS and RECENT DELIVERIES and the `Server: Clock dashboard` palette entry + scroll seam; WATCHED stays; rename/relocate the `server-clock-dashboard/` folder.
8. Add a `cron` topic page to the rk skill bundle, listed in `docs/site/skill.md` § Topics, embedded like the existing six topics; must pass the toolkit-standards checks.
9. Constraints: Constitution V, IX, II/X, mobile parity, Test Intent Comments.
10. Docs hydrate scope: `docs/specs/cron.md` § UI tiers rewritten; memory pages updated; wiki studies get a superseded note only where they describe CLOCK/CRONS as shipped.
11. Out of scope: MCP cron write tools; operator watchlist/underbar/`opr` register; cron evaluator/schedule semantics; fab-kit skill changes.

## Why

**Problem (a) — the primary author of cron entries cannot discover the feature.** Cron payloads are prompts typed into agents, so an agent is the natural author of an entry ("check on this PR every 30 minutes"). Yet the run-kit skill bundle (`docs/site/skill.md` + `docs/site/skill/*.md`, embedded via `app/backend/cmd/rk/skill.go`, served by `rk skill <topic>`) has no cron page, and the MCP allowlist exposes only `cron_list`. An operator asked to schedule something has no path that leads to `rk cron add`. Every session an agent starts without that knowledge is a session where the clock goes unused.

**Problem (b) — a human sees no evidence cron exists until something fires.** The status-bar `◷` chip is omitted when there are no entries; the sidebar CLOCK section is default-off; the Server-page CRONS zone sits below the fold on `/$server`, a navigation away — although the spec rejected the Host page precisely because "checking crons must not cost a navigation". A newcomer cannot find the registry, and an existing user cannot see the whole registry without leaving the terminal they are on.

**Problem (c) — five web surfaces show the same one-to-five entries with slightly different affordances.** Sidebar CLOCK rows, the console Activity feed, the Server-page CRONS and RECENT DELIVERIES zones, the palette pickers and the entry detail sheet all render the same entries. The `deliver` marker had to be added in three places. Neither the Activity feed nor the detail sheet offers create or edit, so the place you look is never the place you act. Every future cron field costs three renderers; every UI bug is a three-surface bug.

**If we don't fix it:** the clock stays a feature agents don't reach for and humans stumble on, and each cron change keeps paying the three-renderer tax.

**Why this shape over alternatives.** The console drawer (desktop) and the operator route (mobile) are already the one cron surface that exists on both form factors, already keyed off the single `useCronData` hook, already reachable in one keystroke (`⌘J`) or one tap (the `◷` chip) with no navigation — so consolidating INTO it satisfies the spec's "no navigation" rule on both form factors. Splitting it into `Cron Log` and `Cron List` separates the two questions a user actually asks ("what happened?" vs "what is scheduled, and can I change it?") instead of the current feed's merged timeline, whose upcoming-fires half duplicates the registry without offering its actions. Retiring CLOCK and the two Server-page zones removes the duplicate renderers; WATCHED stays because it is about workers, not the clock. The skill topic is the agent-facing half of the same discoverability problem and rides the existing topic-page mechanism (embed + sync + drift-guard tests), so it costs no new infrastructure.

## What Changes

### 1. Console segments: `Operator Terminal | Operator Tasks | Cron List | Cron Log` — this change builds `Cron List` and `Cron Log` (desktop drawer + mobile operator route)

**Today.** `components/terminal-activity-tabs.tsx` exports `SEGMENTS = [{tab:"terminal", label:"Terminal"}, {tab:"activity", label:"Activity"}]`, `type ConsoleSegment`, `ConsoleSegments` (the header strip, `data-testid="terminal-activity-tabs"`) and `TerminalActivityTabs` (the mobile route header reading `search.tab`). `components/operator-console.tsx` holds console-local `segment` state and renders `CronActivityFeed` inline for `activity`. `lib/operator-console.ts` types `segment?: "terminal" | "activity"` on `requestOperatorConsole`.

**Target.** The strip is designed for four tabs in a fixed order — `Operator Terminal | Operator Tasks | Cron List | Cron Log` — and this change ships three of them (the existing terminal segment relabeled, plus the two cron tabs), same strip, both form factors:

```ts
// components/terminal-activity-tabs.tsx (rename to console-segments.tsx is acceptable; keep one module)
export const SEGMENTS = [
  { tab: "terminal", label: "Operator Terminal" },
  // slot 2 — `Operator Tasks` — is reserved for a future change and NOT rendered here
  { tab: "list",     label: "Cron List" },
  { tab: "log",      label: "Cron Log" },
] as const;
export type ConsoleSegment = (typeof SEGMENTS)[number]["tab"];  // "terminal" | "list" | "log"
```

- **Four-tab layout.** The strip's geometry (segment widths, the drawer title-strip budget on desktop, the 375px mobile header) MUST fit four Title Case labels of these lengths without wrapping or truncation, so the future `Operator Tasks` tab drops in without a layout change. The fourth slot is not rendered until that change ships; a disabled, non-focusable placeholder segment labeled `Operator Tasks` MAY be rendered instead if it is trivial (implementer's call — see Assumptions row 23). Whichever is chosen, `ConsoleSegment` carries only the three shipped values and `?tab=` accepts no `tasks` value in this change.
- **Order everywhere.** `Cron List` precedes `Cron Log` in the strip, in the palette entries (`Operator: Show cron list` before `Operator: Show cron log`), in tests, and in the docs.
- `Operator Terminal` is a label-only change: the `terminal` tab token, the ⌘J behavior, and the route semantics are untouched.

- The concrete `?tab=` values are `log` and `list` (the implementer may choose different tokens, but the two values MUST be short, lowercase, and stable — they are a deep-link contract shared with the Go `PushURL`).
- Desktop: `operator-console.tsx` maps `segment` → body: `terminal` (existing), `log` → `<CronLog server inline />`, `list` → `<CronList server inline />`. When a cron segment is active the terminal is unmounted exactly as the Activity segment does today.
- Mobile: the operator route's header (`TerminalActivityTabs`, `app.tsx` gate ~937–951) reads `search.tab`; `log` and `list` swap the corresponding body in; absent/`terminal` renders the terminal.
- The **pinned staleness banner** (today rendered inside `CronActivityFeed` when `sessions.find(s => s.operatorStale)` is truthy, from `operatorLastTickAt`) moves up one level so it renders above BOTH cron tabs (not above Terminal): extract it to `components/cron-stale-banner.tsx` and mount it once in the console body wrapper for `log`/`list`, on both form factors.
- Empty states: `Cron Log` with no deliveries → one line, "No deliveries yet on {server}." `Cron List` with no entries → the `+ New entry` affordance plus one hint line: "Agents can schedule prompts too — `rk cron add`." (teaches the CLI, matching problem (a)).

### 2. `Cron Log` tab (`components/cron-log.tsx`)

Deliveries only, newest first, from the `deliveries` array `GET /api/cron` already projects (`CronDelivery {ts, entry, name, target, reason, outcome}`, capped at 50 server-side, newest first). Every log line renders (fires, `missed`, `skipped-absent`, `rate-capped`, `rescheduled`, respawn outcomes — the log is schedule history, not only successful deliveries), labeled by `reason`/`outcome` exactly as the current feed's delivery half does. Tapping a row opens the existing `CronEntryDetailSheet` (mobile modal / desktop `inline` variant) for the entry when it still exists; a line whose entry was deleted (`name` empty and no matching entry) is not tappable. Drop from `cron-activity-feed.tsx`: the `nextFire` sort, the upcoming-fires half and the "now" divider. `cron-activity-feed.tsx` is deleted once `cron-log.tsx` and `cron-list.tsx` exist; `describeSchedule`/`describeDeliver` helpers move to a shared `lib/cron-format.ts` (or stay where they are if already shared) — no behavior change to the helpers.

### 3. `Cron List` tab (`components/cron-list.tsx`)

The `rk cron list` registry: every entry on the server from `useCronData(server).entries` (`CronEntry` as `GET /api/cron` serves it — intent fields plus derived `nextFire`, `rung`, `orphaned`, `orphanedSince`, `expiresAt`, effective `muted`, `mutedUntil`).

**Row content** (one row per entry, dense, monospace):
- name (fallback: the same label the current feed uses for unnamed entries — id / payload head; mirror it exactly)
- target chip (`role:operator`, `session:<name>`, `pane:%N` — the existing `cronTargetSummary` shape)
- schedule summary (`describeSchedule`: `every 30m`, `backoff 1m→30m`, `backoff 3m→3m` for idle-every, `cron */5 * * * * (catch-up once)`)
- next fire, relative (`in 12m`, `due`; `—` when `nextFire` is absent)
- backoff rung (backoff kinds only, `rung 3`)
- `deliver` marker when `deliver` is not `immediate` (`when-idle` / `skip-if-busy`) — the same marker the CLOCK/CRONS rows carry today
- flags: `muted` (with lease remaining when `mutedUntil` is present: `muted 27m`), `pinned`
- orphan state (`orphaned {age}`, expires `{relative}`)

**Sort**: `nextFire` ascending (soonest first); entries with no `nextFire` sort last, stable by name then id. Muted and orphaned rows are dimmed (the feed's existing dim treatment), never omitted.

**Row actions** — all reachable from the entry's detail surface (tap a row → `CronEntryDetailSheet` modal on mobile / the `inline` variant on desktop, anchored the way the feed anchors it today) and mirrored as palette verbs:
- mute / unmute — the sheet's existing mute toggle, extended with a lease: a `Mute for…` choice (presets `30m`, `2h`, `8h`, `until unmuted`) posting to the EXISTING route `POST /api/cron/mute` with an additive optional body field `{id, muted: true, for: "2h"}` (a Go duration string; absent ⇒ today's behavior). The handler sets `MutedUntil = now + for` through the same store helper the CLI's `mute --for` uses; `muted:false` clears both flag and lease as today. No new route (Constitution IX). <!-- assumed: lease via an additive `for` field on the existing mute body — the discussion agreed "mute/unmute (incl. lease)" as a row action, and the current handler comment "Lease writes stay CLI-only" predates that decision; the alternative (display-only lease) would leave the list unable to do what `rk cron mute --for` does -->
- pin / unpin — existing `POST /api/cron/pin`.
- **edit** — a new `Edit` row on the detail sheet opening the create dialog in edit mode (§ 4).
- delete — existing confirm + `POST /api/cron/delete`.
- `+ New entry` — a header/footer affordance on the list (both form factors) opening `CronCreateDialog` in create mode.

**Live data**: no polling; `useCronData` refetches on the state-socket sessions cadence (mount fetch + SSE), and every mutation already wakes the SSE hub. Optimistic toggles keep the sheet's existing behavior.

### 4. Edit mode for the create dialog (`components/cron-create-dialog.tsx`)

Add an optional `entry?: CronEntry` prop. When present the dialog is in **edit mode**:
- Title `Edit entry`, submit label `Save`.
- Editable fields (exactly the `rk cron edit` surface): name, schedule (the four-way exclusive kind picker the dialog already has — a kind change replaces the whole schedule), deliver, if-absent, respawn argv (a non-`respawn` if-absent clears respawn, matching the CLI/route rule).
- **Read-only**: target (rendered as the chip, not a control), creator, payload (the route and the CLI expose no payload edit; render the prompt text read-only), muted/pinned (own verbs).
- Submit POSTs the partial body — only fields the user changed — to `POST /api/cron/edit` via a new client wrapper:

```ts
// api/client.ts
export interface CronEditBody {
  id: string;
  name?: string;
  schedule?: CronSchedule;
  deliver?: string;
  ifAbsent?: string;
  respawn?: string[];   // [] clears
}
export async function editCron(server: string, body: CronEditBody): Promise<CronEntry>
```

Server 400s (unknown deliver/ifAbsent, schedule validation, `target is immutable`) render inline as the create path does; 409 `cron tick in progress — retry` renders as a retryable inline error. A schedule/deliver change triggers the route's `rescheduled` log line — the `Cron Log` tab shows it on the next SSE cadence, no client handling needed.

### 5. Deep-link and seam rename (one-release alias)

- `lib/router-url.ts`: `tab?: "terminal" | "log" | "list"`; `validateTerminalSearch` accepts `activity` and **normalizes it to `log`** (so `?tab=activity` deep-links from already-sent push notifications land on `Cron Log`); unknown values still drop. Unit tests cover `terminal`, `log`, `list`, `activity→log`, and an unknown value.
- `lib/operator-console.ts`: `segment?: "terminal" | "log" | "list"`.
- `app.tsx` mobile gate (~937–951): `cronTabActive = operatorConsoleTabs && (search.tab === "log" || search.tab === "list")`; the desktop handoff effect opens the drawer with `segment: search.tab` for either value (strip-the-param-once behavior unchanged).
- `internal/cron/push_url.go`: `cronPushTab = "log"`; `PushURL` emits `/{server}/{N}?tab=log`; `push_url_test.go` updated (`/live1/7?tab=log`, `/dev/9?tab=log`).
- Alias sunset: the `activity` alias is removed one release after this ships — add a `fab/backlog.md` item at hydrate time naming the release.
- Palette (`lib/palette/operator-console.ts`), registered in this order: add `Operator: Show cron list` (`segment:"list"`); rename `Operator: Show clock activity` → `Operator: Show cron log` (`segment:"log"`). Registered where the existing entry is wired (`app.tsx` ~4600, `use-global-palette-actions.ts` ~260–281).

### 6. Status-bar `◷` chip (`components/status-bar.tsx`)

No visual change: `◷ in 12m` / `◷ due` / `◷ stale {age}`, omitted when no entries and not stale. The click handler and the overflow row `◷ Clock activity` now call `requestOperatorConsole({action:"open", segment:"list"})`; the overflow row label becomes `◷ Cron List`. The stale banner is visible on either tab, so the stale click still lands on the banner.

### 7. Retire the sidebar CLOCK section

Remove: `components/sidebar/clock-panel.tsx` (+ tests), the rail button in `components/sidebar/section-rail.tsx`, `ClockSectionIcon` in `sidebar/icons.tsx`, the `"clock"` member of `SidebarSection` and the `{ section: "clock", key: "runkit-sidebar-section-clock", defaultValue: false, label: "Clock", desktopOnly: true }` entry in `hooks/use-sidebar-sections.ts`, the `panel-toggle-clock` / `Panel: Toggle Clock` palette entry (`use-global-palette-actions.ts` ~217) and its `setClockVisible` plumbing, and any CLOCK-specific flyout wiring (mute/pin/delete on the CLOCK row card). A stored `runkit-sidebar-section-clock` localStorage value is simply ignored — no migration, no UI. **Not touched**: the watched-row underbar, the `opr` register line on window rows, `monitored*`/`operatorStale` derivations (they feed the banner and WATCHED).

### 8. Server page `/$server`: keep WATCHED only

Remove `components/server-clock-dashboard/crons-zone.tsx`, `deliveries-zone.tsx` (+ tests), the CRONS/DELIVERIES parts of `model.ts` and `index.tsx`, `lib/server-clock-dashboard-scroll.ts`, and the `Server: Clock dashboard` palette entry (`app.tsx` ~4288–4298). Keep `watched-zone.tsx` mounted via the `SessionTiles` `footer` slot. Rename the folder to `components/server-watched-zone/` (or flatten to `components/server-watched-zone.tsx` if only one component + model remain) and update imports/tests. `server-clock-dashboard.spec.ts` becomes `server-watched-zone.spec.ts` covering WATCHED only and asserting the CRONS/RECENT DELIVERIES headings are absent.

### 9. `cron` skill topic (`docs/site/skill/cron.md`)

Mirror the existing topic mechanism exactly:
- canonical page `docs/site/skill/cron.md`, ≤150 lines, static-only (no session/server state), in-genre briefing;
- `scripts/sync-skill.sh` gains `sync "docs/site/skill/cron.md" "$DEST_DIR/cron.md"`; the synced copy `app/backend/cmd/rk/skill/cron.md` is committed;
- `skill.go`: `//go:embed skill/cron.md` → `var skillCronTopic []byte`, a `"cron": skillCronTopic` row in `skillTopics` (which auto-updates the `Topics:` help line, the unknown-topic error, and `rk skill topics`);
- `skill_test.go`: add the `cron` case to `TestSkillTopicsPrintByteIdentical`, `TestSkillTopicsMatchCanonical`, `TestSkillTopicsWithinLineBudget`, and the valid-topics string in `TestSkillUnknownTopicFailsFast` (`code, cron, display, gui, messaging, mux, tutorial`);
- `docs/site/skill.md` § Topics gains: `- **schedule a prompt for later or on a cadence** (user says "check on this every 30 min", "nudge me when…", "remind me at 9") → \`rk skill cron\``;
- a one-line pointer at the end of the `rk cron` parent `Long` help: "Agent briefing: `run-kit skill cron`." (Not required by the skill standard — its discovery mandates are the `Topics:` help line and `rk skill topics` — but the parent help is where a human running `rk cron --help` looks, and help-dump tolerates it.)

**Page content** (sections, in order): what cron is (a prompt typed into an agent's chat at fire time via the injection engine and submitted with Enter — never a system cron, nothing is executed; to run a command, ask the agent to run it); when to reach for it (periodic checks, idle nudges, wall-clock reminders, wake-on-state for the operator); the four schedule kinds with the exact flags — `--every <dur>`, `--idle-every <dur>` (flat backoff, count restarts on genuine activity, the clock's own pings never restart it), `--backoff [--min <dur> --max <dur>]` (60s→30m defaults), `--cron "<5-field expr>" [--catch-up once]` (daemon local time; missed occurrences are logged, not fired, unless catch-up); targets and auto-capture (inside tmux the caller's pane is captured as creator and default target via the role → session → pane ladder; explicit `--role <r>` / `--session <s>` / `--pane <%N>`; outside tmux an explicit target is required); `--deliver immediate|when-idle|skip-if-busy`; `--if-absent skip|notify|respawn` with `--respawn <argv>` (repeatable) and the `{server}` placeholder; `mute [--for <dur>] [--off]`, `pin`; `edit <id>` in place (target and creator immutable); `list [--json]` (structured `schedule`, `wake_on`, `if_absent`, `respawn`, effective `muted`, `muted_until`); `rm <id>`; worked examples (at least: "check on PR #123 every 30 minutes and tell me if CI fails", an idle nudge to a session, a 9 am wall-clock reminder with catch-up, mute the operator tick for 2h, edit an entry to a new cadence). The `## Topics` line and the page must pass the toolkit-standards `skill` clause (byte-identical, ≤150 lines, static-only) and the help-dump + P9 new-surface check (no new command surface is added, so the check reduces to the help text change staying platform-stable).

### 10. Tests

- **Playwright** (every `test()` with the Proves/Steps JSDoc; each spec file with the header comment): `mobile-cron-activity.spec.ts` → `mobile-cron-tabs.spec.ts` (`Operator Terminal | Cron List | Cron Log` in that order on the operator route at 375px, the strip fitting the four-label set without wrapping, `?tab=activity` alias lands on Cron Log, banner above both tabs, `+ New entry` opens the dialog, detail sheet `Edit` row); `operator-console.spec.ts` updated (desktop drawer segments `Operator Terminal | Cron List | Cron Log` in that order, `◷` chip → Cron List, palette `Operator: Show cron list` / `Operator: Show cron log`, no `Panel: Toggle Clock` / `Server: Clock dashboard` entries); `server-clock-dashboard.spec.ts` → `server-watched-zone.spec.ts` (WATCHED present, CRONS/RECENT DELIVERIES absent).
- **Vitest**: `router-url.test.ts` (tab parsing + alias normalization); `cron-list.test.tsx` (sort: soonest first, no-`nextFire` last, dimming, lease-remaining rendering); `cron-create-dialog.test.tsx` (edit mode: read-only target/payload, partial body, 400/409 rendering); `use-sidebar-sections` / palette tests updated for the removed entries.
- **Go**: `push_url_test.go` new value; `skill_test.go` cron topic cases; `api/cron_test.go` mute-with-lease body (`for` sets `mutedUntil`, absent keeps today's behavior, invalid duration → 400).
- Run the scoped lanes first (`just test-backend`, `just test-frontend`, `just test-e2e <name>`), then the full `just test`.

### 11. Docs (hydrate scope)

- `docs/specs/cron.md` § "UI — Three Tiers: Glance, Dashboard, Immersion": tier 1 CLOCK retired; tier 2 = the console `Cron List | Cron Log` tabs on both form factors (drawer on desktop, operator route on mobile), recording the strip's four-tab design `Operator Terminal | Operator Tasks | Cron List | Cron Log` with `Operator Tasks` marked as a future change; Server page keeps WATCHED only; § 4 mobile bullets rewritten for the two tabs; palette list updated (`Operator: Show cron log`, `Operator: Show cron list`, `Cron: new entry`, `Cron: mute…`, `Cron: pin…`, `Cron: delete…`); the rejected-names note added ("Watches"/"Cron Watches", "Logs"/"Cron Logs"). `docs/specs/index.md` Cron row and wiki row descriptions updated.
- Memory: `run-kit/cron.md` (Overview UI paragraph, § Notify Deep-Links `tab=log`, § HTTP API mute lease body), `run-kit/ui/cron-activity.md` (rename to `cron-console-tabs.md` or rewrite in place), `run-kit/ui/operator-console.md`, `run-kit/ui/sidebar.md` (CLOCK removed), `run-kit/ui/status-signals.md` (chip target), `run-kit/ui/routes-and-shell.md` (Server page WATCHED only), `run-kit/ui/keyboard-and-palette.md` (palette registry), `run-kit/toolkit-standards.md` (seven topic pages incl. `cron`), `run-kit/architecture/cli.md` (skill row).
- Wiki: `docs/wiki/cron-clock-design-studies.html` and `watched-row-indicator-studies.html` get a short "Superseded (2026-09-11) — the CLOCK section / CRONS zones were retired in favor of the console `Cron List | Cron Log` tabs" caption only where they describe CLOCK/CRONS as shipped (mirroring the study's existing "superseded 2026-09-10" caption style); mocks stay as the record.

### 12. Out of scope

MCP cron write tools (`cron_add` etc.); the operator watchlist, the watched-row underbar, the `opr` register; any evaluator/schedule-semantics change; fab-kit skill changes; a migration UI for the stored CLOCK section preference.

## Affected Memory

- `run-kit/cron`: (modify) Overview UI paragraph (tiers → console tabs; CLOCK/CRONS retired), § Notify Deep-Links (`?tab=log`, `activity` alias one release), § HTTP API (mute body's additive `for` lease field)
- `run-kit/ui/cron-activity`: (remove) superseded by the console-tabs page below
- `run-kit/ui/cron-console-tabs`: (new) the `Cron Log` / `Cron List` tabs — data source, sort, row anatomy, actions, edit mode, stale banner placement, empty states, alias handling, e2e coverage
- `run-kit/ui/operator-console`: (modify) three segments, segment-carrying opens with `log`/`list`, `◷` chip → list
- `run-kit/ui/sidebar`: (modify) CLOCK section removed from collapsible panels + section rail; watched underbar/`opr` unchanged
- `run-kit/ui/status-signals`: (modify) `◷` chip click target
- `run-kit/ui/routes-and-shell`: (modify) Server page footer = WATCHED zone only; clock-dashboard zones + scroll seam removed
- `run-kit/ui/keyboard-and-palette`: (modify) palette registry — removed `Panel: Toggle Clock`, `Server: Clock dashboard`; renamed `Operator: Show cron log`; added `Operator: Show cron list`
- `run-kit/toolkit-standards`: (modify) skill topic pages: seven incl. `cron`; help-dump check for the `rk cron` Long pointer
- `run-kit/architecture/cli`: (modify) `skill` row topic list

## Impact

**Frontend** (`app/frontend/src/`): `components/terminal-activity-tabs.tsx`, `components/operator-console.tsx`, `components/cron-activity-feed.tsx` (removed) → `components/cron-log.tsx`, `components/cron-list.tsx`, `components/cron-stale-banner.tsx` (new), `components/cron-entry-detail-sheet.tsx` (Edit row, mute-for), `components/cron-create-dialog.tsx` (edit mode), `components/status-bar.tsx`, `components/sidebar/{clock-panel,section-rail,icons}.tsx`, `hooks/use-sidebar-sections.ts`, `hooks/use-global-palette-actions.ts`, `components/server-clock-dashboard/*` → `server-watched-zone`, `lib/server-clock-dashboard-scroll.ts` (removed), `lib/router-url.ts`, `lib/operator-console.ts`, `lib/palette/operator-console.ts`, `api/client.ts` (`editCron`, `muteCron` lease), `app.tsx` (gate, handoff, palette wiring). Tests: `tests/e2e/{mobile-cron-activity,operator-console,server-clock-dashboard}.spec.ts` and colocated unit tests.

**Backend** (`app/backend/`): `internal/cron/push_url.go` + test; `api/cron.go` `handleCronMute` (additive `for`) + test; `cmd/rk/skill.go`, `skill_test.go`, `cmd/rk/skill/cron.md` (synced), `cmd/rk/cron.go` (Long pointer). `scripts/sync-skill.sh`.

**Docs**: `docs/site/skill.md`, `docs/site/skill/cron.md` (new), `docs/specs/cron.md`, `docs/specs/index.md`, memory pages above, two wiki HTML captions, `fab/backlog.md` (alias sunset item).

**Contracts touched**: the `?tab=` deep-link (aliased for one release — already-sent push notifications keep landing); `POST /api/cron/mute` body (additive optional field, backward compatible); `rk skill` topic namespace (+`cron`; the `Topics:` help line and `rk skill topics` output change — help-dump consumers see one added topic). `rk cron list --json` (the fab-kit read contract) is untouched.

**Scale**: ~25 frontend files (roughly half removals), 6 backend files, 1 script, ~12 doc files, 3 e2e specs rewritten/renamed.

## Open Questions

- None blocking. See § Assumptions for the graded picks (tab tokens, mute-lease body field, help pointer, folder rename).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The strip is designed for four fixed-order Title Case tabs — `Operator Terminal` · `Operator Tasks` · `Cron List` · `Cron Log`; this change relabels Terminal → `Operator Terminal` and builds `Cron List` then `Cron Log` (in that order, strip and palette); `Operator Tasks` is a future change; same segments on both desktop drawer and mobile operator route; "Watches"/"Cron Watches" and "Logs"/"Cron Logs" rejected | Discussed — user agreed the names and the rejections with rationale | S:95 R:70 A:95 D:95 |
| 2 | Certain | `Cron Log` = deliveries only, newest first, no upcoming-fires half, no "now" divider; stale banner above both cron tabs | Discussed — decision 2 verbatim | S:95 R:75 A:95 D:95 |
| 3 | Certain | `Cron List` = full registry with the API's derived columns, sorted by `nextFire` ascending, no-`nextFire` last, muted/orphaned dimmed never omitted; `+ New entry` and the empty-state `rk cron add` hint | Discussed — decision 3 verbatim; `GET /api/cron` already carries every column | S:95 R:75 A:95 D:95 |
| 4 | Certain | Edit reuses the create dialog in an edit mode backed by `POST /api/cron/edit`; target and creator immutable | Discussed — decision 3; the route and the CLI both enforce immutability | S:90 R:75 A:95 D:90 |
| 5 | Certain | Payload is read-only in edit mode | Neither `rk cron edit` nor the edit route exposes a payload field (verified in `cron_edit.go` flags and `handleCronEdit`); the dialog mirrors the CLI surface | S:70 R:85 A:95 D:95 |
| 6 | Certain | `?tab=activity` stays a one-release alias for `Cron Log`; `PushURL` emits the new value; seam types, gate, palette follow | Discussed — decision 4 verbatim | S:95 R:70 A:95 D:95 |
| 7 | Confident | Concrete `?tab=` tokens are `log` and `list`; the alias is normalized to `log` inside `validateTerminalSearch` (no redirect) | Left to the implementer by the discussion; shortest tokens mirroring `rk cron list`; normalizing in the validator keeps the alias in one place and makes it unit-testable | S:65 R:80 A:80 D:60 |
| 8 | Certain | `◷` chip unchanged visually; click and overflow row open the console on `Cron List` | Discussed — decision 5 verbatim | S:95 R:90 A:95 D:95 |
| 9 | Certain | Sidebar CLOCK section removed entirely (panel, rail button, icon, section entry, `Panel: Toggle Clock`, CLOCK flyout wiring); stored localStorage key ignored; watched underbar and `opr` register untouched | Discussed — decision 6 verbatim | S:95 R:65 A:95 D:95 |
| 10 | Certain | Server page drops CRONS + RECENT DELIVERIES + `Server: Clock dashboard` + scroll seam; WATCHED stays | Discussed — decision 7 verbatim | S:95 R:65 A:95 D:95 |
| 11 | Confident | `server-clock-dashboard/` renamed to `server-watched-zone` (folder, or flattened to one file if only the zone + model remain); e2e spec renamed accordingly | Discussion said "rename/relocate as appropriate"; the name states what remains | S:60 R:85 A:80 D:70 |
| 12 | Certain | `cron` skill topic added via the existing embed + `sync-skill.sh` + `skillTopics` row + the four test-table cases; listed in `docs/site/skill.md` § Topics with the agreed trigger phrase; ≤150 lines, static-only | Discussed — decision 8; mechanism verified in `skill.go`, `skill_test.go`, `scripts/sync-skill.sh` | S:95 R:85 A:95 D:95 |
| 13 | Confident | Add a one-line "Agent briefing: `run-kit skill cron`" pointer to the `rk cron` parent `Long` help | The discussion made it conditional on the skill standard; the standard's discovery mandates are the `Topics:` help line and `rk skill topics`, so it is not required — included because it is where a human running `rk cron --help` looks and help-dump tolerates it; drop it if the standards check objects | S:45 R:95 A:55 D:40 |
| 14 | Tentative | Mute-with-lease from the web rides an additive optional `for` (Go duration) field on the existing `POST /api/cron/mute` body; presets `30m`/`2h`/`8h`/`until unmuted`; `muted:false` clears flag + lease as today | The discussion agreed "mute/unmute (incl. lease)" as a Cron List action; the current handler comment "Lease writes stay CLI-only" predates that decision; an additive body field keeps IX (no new route) and stays backward compatible. The alternative — display-only lease — leaves the list unable to do what `rk cron mute --for` does | S:55 R:65 A:35 D:40 |
| 15 | Confident | Row actions live on the entry detail surface (mobile sheet / desktop inline panel), which gains an `Edit` row; rows themselves are tap-to-open; `+ New entry` is a list-level affordance | Decision 3 lists the actions and says tapping a row opens the detail sheet/inline panel; one action surface across both form factors is the shipped pattern | S:65 R:75 A:70 D:60 |
| 16 | Confident | Every delivery-log line (fires, `missed`, `skipped-absent`, `rate-capped`, `rescheduled`, respawn outcomes) renders in `Cron Log`, labeled by reason/outcome; lines for deleted entries are not tappable | The current feed's delivery half already renders the whole `deliveries` array; the log is schedule history by spec | S:60 R:85 A:80 D:70 |
| 17 | Certain | Stale banner extracted to its own component and mounted once above the cron tabs' body (not above Terminal) | Decision 2 says "above BOTH tabs whenever operatorStale"; one mount avoids duplicating the derivation | S:75 R:85 A:85 D:80 |
| 18 | Certain | No polling; the SSE sessions cadence via the single `useCronData` hook remains the clock; all mutations POST | Constitution II/X/IX and decision 9 | S:90 R:90 A:100 D:100 |
| 19 | Certain | Alias sunset recorded as a `fab/backlog.md` item at hydrate time naming the release after this ships | "One release" needs a tracked removal; backlog is the repo's deferred-gap convention (toolkit-standards § Design Decisions) | S:60 R:95 A:85 D:80 |
| 20 | Certain | Wiki studies get a short superseded caption only in sections describing CLOCK/CRONS as shipped, mirroring the study's existing "superseded 2026-09-10" style; mocks stay | Decision 10 verbatim on scope; style follows the file's own precedent | S:70 R:95 A:80 D:80 |
| 21 | Certain | Mobile parity: the same two cron tabs on the operator route; the operator-window gate for the mobile tabs is unchanged (no operator window ⇒ no cron tabs, as today) | Decision 9 requires parity; the gate is pre-existing behavior and no mobile cron surface is lost (CLOCK and the Server zones were desktop-only) | S:80 R:80 A:90 D:90 |
| 22 | Certain | Every Playwright `test()` carries the Proves/Steps JSDoc; unit tests for alias parsing and list sort; Go tests for `PushURL`, the skill topic, and the mute lease body | Constitution § Test Intent Comments; decision 9 | S:90 R:95 A:100 D:100 |
| 23 | Confident | The reserved `Operator Tasks` slot is left unrendered (no placeholder); the strip's geometry is sized and tested against the four-label set so the future tab drops in without a layout change | The amendment left placeholder-vs-nothing to the implementer; an unrendered slot avoids shipping a dead control and a disabled-state style with no behavior behind it, while the four-label sizing is what actually protects the future change — flip to a disabled placeholder if it proves trivial during apply | S:55 R:95 A:60 D:45 |

23 assumptions (16 certain, 6 confident, 1 tentative, 0 unresolved).
