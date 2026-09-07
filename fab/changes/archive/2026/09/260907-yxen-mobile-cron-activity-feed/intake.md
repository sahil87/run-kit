# Intake: Mobile Cron UI — Activity Feed, Entry Detail Sheet, Notify Deep-Links

**Change**: 260907-yxen-mobile-cron-activity-feed
**Created**: 2026-09-07

## Origin

> Operator dispatch (wave 3, C7 of `fab/plans/sahil/26-09-06-cron-clock-plan.md`), parallel with
> C6 (desktop UI, a sibling worktree — out of scope here), both depending on C5 (API +
> Derivations, PR #862, already merged into `origin/main` at `2959c995` and present in this
> worktree). Seed description handed down verbatim:
>
> "Mobile UI: console sheet Terminal | Activity segments; the Activity feed (upcoming computed +
> delivered log, now-divider, pinned staleness banner); entry detail sheet (plain-words schedule,
> mute toggle, pin, delete); `rk notify` deep-links."
>
> The dispatch note flagged that C5's API enumeration is exactly `create|delete|mute` — no `pin`
> route — and instructed checking `docs/specs/cron.md` to confirm pin is in-scope for mobile before
> adding `POST /api/cron/pin`. One-shot interactive intake (no prior `/fab-discuss` thread); this
> document is the sole context-transfer artifact to the apply-entry agent.

## Why

1. **What problem does this solve?** P2 of the cron clock plan ships visibility for the scheduling
   substrate that C1–C4 (Wave 1/2, already shipped) made durable. Wave 3 spec (`docs/specs/cron.md`
   § UI, tier 4 "Mobile — a feed, not a registry") is explicit that the desktop tiers (sidebar
   `CLOCK` panel, flyout cards) collapse badly on a phone — this change builds the mobile-native
   shape instead: a time-ordered triage feed (the healthchecks.io dead-man's-switch / PagerDuty /
   Calendar-agenda pattern), not a management registry. Without it, a phone user has zero visibility
   into what the operator's clock is doing or whether its backstop is alive.
2. **What happens if we don't fix it?** The mobile operator surface stays terminal-only — cron
   entries, upcoming fires, and (critically) a stale/dead operator-tick backstop are invisible on
   a phone, defeating the whole point of Wave 2's dead-loop incident-class fix (the backstop exists
   to catch a dead `/loop`, but nobody watching from a phone would know it died too).
3. **Why this approach over alternatives?** The spec explicitly rejects a "mobile registry-in-the-
   drawer" (pinned-height `CollapsiblePanel`, flyout-card actions — no glanceability, mute two taps
   deep) as superseded by the Activity feed. The feed pattern reuses the existing mobile "console"
   shape (navigation to the operator window's terminal route — there is no drawer/sheet component
   on mobile at all today, see § What Changes / Mobile Chrome) rather than inventing a new overlay
   surface, honoring Constitution IV (minimal surface — no new route, no new page).

## What Changes

### 1. Backend: `POST /api/cron/pin` (new endpoint)

**Scope confirmation** (per the dispatch note): `docs/specs/cron.md` § API & CLI lists CLI `rk cron
pin <id> [--off]` as shipped (`internal/cron.SetPinned` already exists, wired by the CLI — see
`docs/memory/run-kit/cron.md` § CLI table), but the HTTP surface intentionally has no pin route.
`docs/memory/run-kit/cron.md` § Design Decisions has an explicit prior decision: **"`pin` has no
HTTP endpoint" — Decision: only `create`/`delete`/`mute` get POST routes; `cron.SetPinned` stays
CLI-only. Why: the cron clock plan's API enumeration is exact (`create|delete|mute`); no consumer
calls for pin over HTTP. Rejected: adding `POST /api/cron/pin` preemptively — speculative surface
with no consumer.** This change is that consumer: the mobile entry detail sheet's "alarm-app
anatomy" (name, schedule, last/next, mute toggle, delete, **pin** rows per the spec's mobile tier)
needs a pin mutation reachable from the browser. Adding the route now is not speculative — it is
required by this change's own scope, and reverses the prior decision's stated rationale ("no
consumer") because a consumer now exists.

Add `handleCronPin` in `app/backend/api/cron.go`, mirroring `handleCronMute` exactly
(cron.go:312-344):

```go
// POST /api/cron/pin  { "id": "<4char>", "pinned": <bool> }
func (s *Server) handleCronPin(w http.ResponseWriter, r *http.Request) {
    // decode {id, pinned bool}; server := serverFromRequest(r); dir := cron.DefaultDir()
    // cron.SetPinned(dir, server, id, pinned) — not-found → 404
    // s.initSSEHub(); s.sseHub.wake(server)
    // writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```

Register beside the other three in `app/backend/api/router.go` (~line 838, alongside
`r.Post("/api/cron/mute", ...)`):

```go
r.Post("/api/cron/pin", s.handleCronPin)
```

Constitution IX (POST-only) already satisfied by the shape (mirrors mute's `{id, muted}` body with
`{id, pinned}`). No new response shape — same `{"ok": true}` / 404-on-unknown-id / SSE-wake pattern
as create/delete/mute.

### 2. Backend: `GET /api/cron` gains a `deliveries` field (recent delivery log)

**Gap identified during intake research** (not called out by the dispatch note, but required by
the spec's own text): `docs/specs/cron.md` § UI, mobile tier says the Activity feed merges "*recent
deliveries* (from the log) and *computed upcoming fires* (the evaluator's next-fire function)."
`GET /api/cron` today (per `docs/memory/run-kit/cron.md` § HTTP API) returns only per-entry
`lastFired` (a single unix timestamp, the most recent delivery) — not a history. There is no
existing endpoint exposing delivery-log lines to the frontend; `internal/cron.ParseLog` (used
server-side by `DeriveEntry`) already parses `<slug>.log` into structured records but nothing
projects them over HTTP.

**Decision** (Confident — see Assumptions): extend the existing `GET /api/cron` response with a
sibling `deliveries` array (most-recent-first, capped — reuse a small constant like 50, matching
the log's own 512 KiB/half-trim posture in spirit) instead of adding a new endpoint. This keeps the
API surface minimal (Constitution IV — one read endpoint for "everything cron on this server",
matching the "UI is a pure projection" plan rule) and mirrors the existing pattern where
`internal/cron` owns all schedule/log math and `api/cron.go` is a thin JSON translation layer
(`docs/memory/run-kit/cron.md` § Design Decisions, "Derivation logic lives in `internal/cron`, not
the `api` package").

Wire shape addition to the existing `{"entries": [...]}` response:

```json
{
  "entries": [ /* unchanged */ ],
  "deliveries": [
    { "ts": 1788254321, "entry": "a3f9", "name": "operator tick", "target": "%12", "reason": "schedule", "outcome": "delivered" }
  ]
}
```

`ts`/`entry`/`target`/`reason`/`outcome` map directly to the delivery-log line schema already
documented in `docs/memory/run-kit/cron.md` § Delivery Log (`{ts, entry, target, reason,
outcome}`); `name` is joined in from the matching entry (or omitted/empty if the entry was since
deleted — a delivery log entry for a removed cron is still valid history). Held outcomes never
appear in the log (existing invariant) so none need filtering here. Implementation reads
`cron.ParseLog` off the already-resolved `dir`/`server` inside `handleCronList`, no new tmux or
disk-path work.

### 3. Backend: cron notify deep-links (`rk notify` → Activity segment)

**Precedent**: `app/backend/api/waiting_push.go`'s `waitingPushURL(server, windowID)` builds a
same-origin path (`/{server}/{N}`, `strings.TrimPrefix(windowID, "@")`, both segments
`url.PathEscape`d) and calls `push.Notify(ctx, title, body, url)` directly — bypassing the generic
`/api/notify` handler, which carries no URL field. Cron's existing notify call sites
(`if_absent: notify` in the tick orchestrator's disposition switch, `respawn-failed` escalation)
currently call the fail-silent `Notifier` seam with no deep link.

**Change**: add a `cronPushURL(server string) string` helper (new, `app/backend/internal/cron` or
`app/backend/api`, wherever `waitingPushURL` lives is the pattern to follow) that resolves the
server's `role: operator` window (the same `tmux.ResolveAgentPane`/role-lookup the package already
performs for role-target resolution and respawn — `docs/memory/run-kit/cron.md` § Fact Gathering &
Target Resolution) and builds `/{server}/{operatorWindowNum}?tab=activity` — mirroring
`waitingPushURL`'s path shape with the mobile route's new `tab=activity` search param (see § 4).
If the operator role has no live window, the helper returns `""` (no deep link) — degrading to the
same behavior as today's URL-less notify, consistent with the fail-silent contract; the daemon
never blocks or retries because a URL couldn't be built.

Wire this into the cron package's notify call sites that fire from a server-scoped context
(if_absent notify, respawn-failed, rate-capped-if-ever-notified) — the exact call sites are the
tick orchestrator's disposition switch in `internal/cron` (`docs/memory/run-kit/cron.md` § Tick
Orchestration, § Circuit Breakers). Each passes the resolved URL instead of `""` to the `Notifier`
seam.

### 4. Frontend: `?tab=activity` search param on the terminal route

Add to `TerminalSearch` in `app/frontend/src/lib/router-url.ts` (currently `{view?, panel?,
layout?, from?}`, lines 45-68 of that file):

```ts
export type TerminalSearch = {
  view?: "web" | "code";
  panel?: "web" | "code";
  layout?: string;
  from?: string;
  tab?: "terminal" | "activity";  // new
};
```

...with a guarded validation block mirroring the existing `view`/`panel` pattern (`if (search.tab
=== "terminal" || search.tab === "activity") out.tab = search.tab;`) — drop unknown values, never
throw, per the file's documented convention. No route re-registration needed:
`terminalRoute`'s `validateSearch: validateTerminalSearch` (`router.tsx:105`) picks the field up
automatically.

### 5. Frontend: the Terminal | Activity segmented header (mobile, operator route only)

**What "console sheet" means in this codebase**: there is no mobile drawer/sheet component for the
operator console today (`docs/memory/run-kit/ui/operator-console.md` § "Mobile open is navigation
to the operator terminal route" — every console-open request on mobile navigates to the operator
window's ordinary terminal route `/$server/$window`, and that route's own chrome — top-bar heading,
compose strip, bottom-bar key chips — **is** the mobile console). The spec's "console sheet" phrase
is describing this navigate-to-terminal-route surface, not a literal sheet/overlay component. This
change adds the segmented header **to that existing route**, gated to render only when: (a) the
shared `useIsMobile()` rule is true, AND (b) the resolved window's role is `operator` (i.e., the
user is on the operator's own terminal route — never on an arbitrary agent window's route).

Insertion point: `app/frontend/src/components/app.tsx`, inside `<main style={{gridArea:
"content"}}>` (line 4617), as a new sibling rendered just above the existing `flex-1 flex flex-col`
wrapper (line 4679) that currently renders `<SurfaceLayout />` unconditionally when `windowParam`
is set. The segmented header:

- Two segments, `Terminal` and `Activity`, reflecting/driving the new `tab` search param (§ 4) —
  tapping a segment does a client-side search-param update (`router.navigate({ search: (prev) =>
  ({...prev, tab: "activity"}) })` or equivalent TanStack Router search-param setter), no full
  navigation.
- `tab` absent or `"terminal"` (default): render exactly what renders today (`<SurfaceLayout
  ... />` and the rest of the existing tree) — **zero behavior change for every non-operator route
  and every existing bookmark/link**, since the header only mounts under the role gate above.
- `tab=activity`: render the new Activity feed component (§ 6) **instead of** `<SurfaceLayout
  ... />` in that same slot — the terminal stream itself is not torn down by this switch (matching
  the desktop tongue's "toggle, not teardown" precedent in `operator-console.md`), it is simply not
  the visible pane; reuse whatever suspension mechanism the codebase already applies to
  hidden-but-mounted terminal panes (`docs/memory/run-kit/ui/terminal.md` § hidden-page stream
  suspension) rather than unmounting `TerminalClient`.
- Deep-linking (`?tab=activity` arriving via `rk notify`, § 3) lands directly on the Activity
  segment with no extra tap.

### 6. Frontend: the Activity feed component (new)

New component, e.g. `app/frontend/src/components/cron-activity-feed.tsx`. Data source: `GET
/api/cron?server=<slug>` (§ 2's extended shape) via the existing `api/client.ts` fetch conventions
(`withServer`, matching the `sendOperatorRequest` precedent already used by the console).

- **One time-ordered timeline** merging:
  - **Upcoming fires** — computed client-side (or server-derived — see Assumptions) from each
    non-orphaned, non-muted entry's `nextFire` (already present on every entry per the existing
    `GET /api/cron` shape).
  - **Recent deliveries** — the new `deliveries` array (§ 2), most-recent-first.
- **A "now" divider** row splitting past (deliveries, newest-first above the divider... actually
  chronologically: deliveries are in the past, upcoming fires are in the future — the divider sits
  between them) — deliveries render below/before "now" in reverse-chronological order converging on
  the divider, upcoming fires render above/after it in chronological order receding from "now".
  (Exact visual direction — divider at top vs. middle of a scrollable list — is a presentational
  choice left to apply; the ordering contract (past newest-first-adjacent-to-now, future
  soonest-first-adjacent-to-now) is the requirement.)
- **Pure derivation**: no client-side polling loop beyond whatever the existing sessions
  SSE/refresh cadence already provides — this inherits "the deterministic-render contract" the
  spec calls out (console's server resolution + degrade-to-absent gating), i.e. an unresolvable
  server renders the same empty/hint state the console already uses elsewhere.
- **Row anatomy**: entry name, a plain-words schedule fragment (see § 7's `describeSchedule`
  helper, shared with the detail sheet), and — for delivered rows — outcome (delivered / failed /
  skipped-absent / etc., from the `outcome` field). Muted entries render dimmed (not hidden — spec
  says orphaned/muted get "treatment," not omission, matching the desktop CLOCK panel's row
  treatment).
- Tapping any row opens the entry detail sheet (§ 7) for that entry.

### 7. Frontend: the pinned staleness banner (new, part of the Activity feed)

Per spec: "Staleness is the feed's pinned banner (the healthchecks.io dead-man's-switch model): a
stale operator loop is the most important item on the timeline, not a side warning." Data source:
the existing `ProjectSession.OperatorLastTickAt` / `ProjectSession.OperatorStale` fields already on
every session in the sessions payload for the server (`app/backend/internal/sessions/sessions.go`
lines 70-71, populated identically on every `ProjectSession` per
`docs/memory/run-kit/cron.md`'s "Watchlist staleness attaches to every `ProjectSession`" design
decision) — read via the existing `useSessions()`/`useSessionContext()` hooks, no new fetch.

- Renders as a pinned (non-scrolling, or scroll-anchored-to-top) banner at the top of the Activity
  feed **only when** `OperatorStale === true` for the resolved server's sessions.
- Content: plain-language staleness statement using `OperatorLastTickAt` (e.g. "operator tick —
  last seen {relative time} ago"), matching the desktop CLOCK header's warning-strip intent
  (`docs/specs/cron.md` § UI tier 1) but in the mobile feed's own visual language (banner, not a
  header strip — no sidebar/CLOCK panel exists on mobile per the spec's tier-4 rule).
- No new backend field — this is a pure frontend consumption of an already-shipped field.

### 8. Frontend: the entry detail sheet (new)

New component (no existing Sheet/BottomSheet primitive exists in this codebase to reuse structurally — confirmed by exploration; the closest visual precedent is `settings-dialog.tsx`'s row/toggle markup, referenced for styling only, not structure). Opens when an Activity feed row is tapped; the spec's "alarm-app anatomy":

- **Name** — the entry's `name` field, editable or not is out of scope (rename is not in the C2 CLI
  surface either — read-only display).
- **Schedule in plain words** — a new `describeSchedule(entry)` pure helper (shared between the
  feed's row summary and this sheet) translating the entry's `schedule`/`wakeOn` JSON into a
  sentence, e.g. `{kind: "backoff", min: "60s", max: "30m"}` → "backs off from 1 minute up to 30
  minutes since last activity"; `{kind: "every", interval: "1h"}` → "every hour". `cron`-kind
  entries (unsupported by the evaluator per existing behavior) render their raw expression with a
  "not yet evaluated" note, matching the CLI's existing stderr posture for unsupported cron
  expressions.
- **Last / next** — `lastFired` (0 = "never") and `nextFire` (when `hasNextFire`, else "unknown"),
  both already present in the existing `GET /api/cron` entry shape.
- **Mute toggle switch** (first-class, per spec) — `POST /api/cron/mute {id, muted: !entry.muted}`
  (existing endpoint, no backend change).
- **Pin row** — `POST /api/cron/pin {id, pinned: !entry.pinned}` (new endpoint, § 1).
- **Delete row** — `POST /api/cron/delete {id}` (existing endpoint, no backend change) — per spec,
  no confirmation dialog is mandated, but this codebase's existing delete-confirmation idiom
  (sidebar kill controls, board pane kill confirm — `docs/memory/run-kit/ui/boards.md` "kill
  confirm") is the pattern to follow for a destructive action; apply MAY reuse that confirm idiom.
- Every mutation wakes the SSE hub server-side already (§ 1/existing) — the sheet's own UI SHOULD
  optimistically reflect the toggle and reconcile on the next SSE-pushed `GET /api/cron` refresh,
  matching the existing optimistic-mutation pattern (`docs/memory/run-kit/ui/dialogs-and-state.md`
  "optimistic mutation feedback").
- No flyout cards (explicit spec exclusion for mobile) — this sheet is the sole mobile action
  surface for an entry.

### 9. Palette actions

`docs/specs/cron.md` § UI names `Cron: mute…` / `Cron: delete…` as palette-registered (Constitution
V — every action reachable via the palette). Confirm C5/C6 already registered `Cron: new entry` /
`Cron: mute…` / `Cron: delete…`, or register them here if this is their first landing on this
platform-shared registry (the palette is not mobile-specific — a single registry serves both). A
`Cron: pin…` entry is added alongside, for the new endpoint. This is a small addition riding the
existing action-registry pattern (`docs/memory/run-kit/ui/keyboard-and-palette.md`), not a new
mechanism.

## Non-Goals (explicit exclusions carried from the plan/spec)

- **Desktop UI** (the `CLOCK` sidebar section, watched-row indicator, flyout-card detail line) is
  C6, a sibling change in a parallel worktree. This change touches nothing under
  `app/frontend/src/components/sidebar/`.
- **The `agents` operator-dashboard tile** is explicitly deferred (plan: "gets its own plan when
  scheduled" — requires the reserved `agents` surface kind to land first).
- **Session/pane targets, orphan GC, `cron` 5-field expression evaluation** are Wave 4 (C8/C9) —
  out of scope; this change only *displays* whatever orphaned/cron-kind state the existing API
  already reports (dimmed treatment, "not yet evaluated" note) without changing evaluator behavior.
- **The reverse loop-side staleness check** (spec Open Question 3) was explicitly decided against
  in Wave 2 — not reopened here.
- No change to `internal/cron`'s evaluation, delivery, or respawn logic beyond the two additive
  reads (`ParseLog` projection, role-window resolution for the notify URL) — the stateless
  evaluator, anchor-join, and circuit breakers are untouched.

## Affected Memory

- `run-kit/cron`: (modify) document the new `POST /api/cron/pin` route (supersedes the "pin has no
  HTTP endpoint" design decision — record the reversal with its own `Introduced by` note per FKF
  §3.3, not a silent overwrite), the `deliveries` field on `GET /api/cron`, and the cron notify
  deep-link URL helper.
- `run-kit/ui/operator-console`: (modify) document the mobile terminal route's new conditional
  `Terminal | Activity` segmented header (operator-role-gated) and the `tab` search param — this
  extends the existing "Mobile open is navigation to the operator terminal route" requirement
  rather than replacing it.
- `run-kit/ui/cron-activity`: (new) the Activity feed component, the pinned staleness banner, the
  entry detail sheet, and the `describeSchedule` plain-words helper — new file under the `ui/`
  sub-domain (mirrors `boards.md`'s per-feature scope) rather than folding into the already-large
  `operator-console.md`.
- `run-kit/ui/keyboard-and-palette`: (modify) the new `Cron: pin…` palette action (and `Cron: new
  entry` / `mute…` / `delete…` if not already documented from C5/C6).

## Impact

- **Backend** (`app/backend/`): `api/cron.go` (+`handleCronPin`, `deliveries` projection in
  `handleCronList`), `api/router.go` (+1 route registration), a new `cronPushURL`-style helper
  (likely `api/cron.go` or `internal/cron`, following wherever `waitingPushURL` lives relative to
  `internal/cron`'s package boundary — `internal/cron` cannot import `api`, so if the helper needs
  `internal/cron` internals it lives there; if it only needs the public `TargetFacts`/role-lookup
  surface it can live in `api`), the tick orchestrator's notify call sites in `internal/cron`
  (passing the resolved URL instead of `""`).
- **Frontend** (`app/frontend/src/`): `lib/router-url.ts` (`TerminalSearch.tab`), `components/
  app.tsx` (segmented header insertion point), two-to-three new components (activity feed, entry
  detail sheet, possibly a small segmented-header component), palette action registration.
- **No schema/on-disk format change** — `internal/cron`'s entry YAML and delivery-log line schema
  are unchanged; this change only adds read-side HTTP projection and one write-side route over an
  already-existing mutation helper (`cron.SetPinned`).
- **Tests**: new Go handler tests for `handleCronPin` (mirroring existing `handleCronMute` tests)
  and the `deliveries` field in `handleCronList` tests; new frontend component tests for the
  Activity feed (feed ordering, staleness banner gating) and entry detail sheet (mute/pin/delete
  wiring); e2e coverage for the mobile segmented header and deep-link landing, per Constitution's
  Test Intent Comments rule for any new Playwright `test()`.

## Open Questions

- None requiring a decision before apply — see § Assumptions for the judgment calls made and their
  grades. All Unresolved-grade items were resolved by reading `docs/specs/cron.md` directly rather
  than left open (the spec's mobile tier is unusually prescriptive).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add `POST /api/cron/pin` mirroring `handleCronMute` byte-for-byte in shape (`{id, pinned}` body, 404-on-unknown, `{"ok":true}`, SSE wake) | Strong signal (spec's own CLI table + memory's documented mute/pin symmetry via `SetMuted`/`SetPinned`), trivially reversible (one route, no schema change), codebase gives the exact template to mirror, one obvious interpretation | S:80 R:90 A:90 D:90 |
| 2 | Confident | Reverse the "pin has no HTTP endpoint" design decision now that this change is the consumer it was waiting for | The prior decision's own stated rationale was "no consumer" — this change removes that condition; codebase convention (FKF §3.3) is to record reversal explicitly, not silently overwrite | S:75 R:85 A:80 D:75 | 
| 3 | Confident | Expose recent delivery history by adding a `deliveries` sibling array to the existing `GET /api/cron` response rather than a new endpoint | Spec explicitly requires "recent deliveries (from the log)" for the feed; Constitution IV (minimal surface) and the existing "one thin read endpoint" pattern both favor extending rather than adding a route; `ParseLog` already exists server-side, only needs a projection | S:60 R:75 A:80 D:70 |
| 4 | Certain | The "mobile console sheet" is the existing operator-terminal-route navigation target, not a new overlay component — the segmented header mounts there, gated on mobile + `role === "operator"` | `docs/memory/run-kit/ui/operator-console.md` documents, in detail, that no mobile drawer/sheet exists today and console-open already means "navigate to the operator's terminal route"; this is a direct, verified codebase fact, not an inference | S:90 R:70 A:95 D:85 |
| 5 | Certain | `tab=activity` search param on the terminal route (added to `TerminalSearch`), following the existing `view`/`panel`/`from` guarded-validation pattern in `router-url.ts` | Direct precedent in the same file for the same kind of param; trivially reversible; one obvious way to extend an existing validator | S:85 R:90 A:90 D:85 |
| 6 | Confident | Switching to the Activity tab swaps the rendered content in place (keeping the terminal mounted-but-hidden) rather than unmounting `TerminalClient` | Matches the existing hidden-page stream-suspension precedent (`docs/memory/run-kit/ui/terminal.md`) and the desktop tongue's toggle-not-teardown behavior; avoids a reconnect flicker on tab-back | S:55 R:70 A:70 D:60 |
| 7 | Confident | New memory file `run-kit/ui/cron-activity.md` for the feed/banner/detail-sheet, rather than folding into `operator-console.md` | `operator-console.md` is already very large (236 lines); a new feature-scoped file follows the `boards.md`/`compose-and-bottom-bar.md` per-feature precedent — hydrate makes the final call on domain placement, this is a plan-time suggestion | S:50 R:60 A:55 D:45 |
| 8 | Confident | Deep-link URL targets `/{server}/{operatorWindowNum}?tab=activity` (no specific entry id in the URL) rather than also carrying `&entry=<id>` to auto-open the detail sheet | Spec says the notification "deep-links to the Activity segment" (not to a specific entry's detail sheet); simpler contract, avoids inventing an entry-id URL scheme with no stated requirement — apply MAY add `&entry=` if trivial, but it is not required | S:40 R:65 A:55 D:40 |
| 9 | Confident | The `cronPushURL` helper resolves the operator role window fresh at notify time (mirroring existing role-resolution code) rather than caching/passing it through from wherever the notify call originates | Keeps the helper self-contained and consistent with the "derive at request time" Constitution II posture; a fire's `Fire` struct may already carry enough to avoid a second resolution — apply should check for an already-resolved pane/window it can reuse before adding a fresh lookup | S:45 R:70 A:60 D:50 |
| 10 | Confident | No confirmation-dialog requirement is added for delete beyond following the existing kill-confirm idiom already used elsewhere in the UI | Spec does not mandate a confirmation; codebase consistency (existing destructive-action pattern) is the only driver, easily adjusted, one clear default | S:60 R:80 A:70 D:65 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
