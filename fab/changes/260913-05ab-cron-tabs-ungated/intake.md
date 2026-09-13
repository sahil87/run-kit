# Intake: Cron Tabs Ungated

**Change**: 260913-05ab-cron-tabs-ungated
**Created**: 2026-09-13

## Origin

> Cron List and Cron Log render whenever a server resolves -- the operator gate stays only on the two operator segments -- so a server with no operator still has its cron registry and log in the drawer and on the operator page. This is Change 4 of the sequential plan at fab/plans/sahil/26-09-12-quake-terminal-drawer.md -- read that file's Standing context and Change 4 sections in full before writing the intake; slug cron-tabs-ungated. Changes 0, 1, 2, 3, and 5 are all merged to main -- start fresh off it. This is the LAST change in the plan.

Interaction mode: `/fab-new`, interactive. Source of record: `fab/plans/sahil/26-09-12-quake-terminal-drawer.md` — the **Decisions of record** bullet "Cron is ungated from the operator", the **Standing context** section, and the **Change 4 — cron tabs ungated** section. Changes 0 (`quake-terminal-rename`, #958-era), 1 (#960), 2 (#962), 3 (#964), and 5 (#961) are on `main` at `4a212a6b`; this branch starts from that head.

**Discovery that reshapes the plan's §1 and §3** (verified against `main` at `4a212a6b` before writing this intake):

- The desktop drawer body is **already** shaped the way Change 4 §1 asks for. In `components/quake-terminal.tsx` the body branches `segment !== "terminal" ? (segment === "tasks" ? <WatchedTasks server=… /> : <><CronStaleBanner server=… />{segment === "list" ? <CronList server inline /> : <CronLog server inline />}</>) : target && server ? <TerminalClient … /> : <operator-less body with Start operator>`. Only the `terminal` branch reads `target`; `list`/`log`/`tasks` render on `server` alone. This shape dates from the original Operator Chat Console (#839, `git log -S'target && server'`) and survived Changes 0–3 unchanged. The desktop seam listener (`handleRequest`) opens the drawer and applies `detail.segment` without consulting the operator target, so a `segment: "list"` request on an operator-less server already lands on a rendering Cron List. The e2e `no operator on the server renders the hint line and omits the fallback row` (quake-terminal.spec.ts) confirms the drawer opens operator-less; no existing test asserts the cron segments render there.
- The `◷` status-bar chip (`components/status-bar.tsx` `useClockChipState`) is gated on **entries with `nextFire` or `operatorStale`**, never on an operator window — `{ kind: "omitted" }` only when there is no dated entry and no stale session. The palette rows `Operator: Show cron list` / `Operator: Show cron log` (`hooks/use-global-palette-actions.ts`) are **always listed** ("same always-listed gating as the opener"). Plan §3's "availability derivation drops the operator term" therefore has no code to change on desktop; its remaining content is behavior on mobile (below) and documentation.
- The **operator page** (`operatorPage = windowParam != null && currentWindow?.role === "operator"` in `app.tsx`) exists only when an operator window exists, so "on the operator page" needs nothing — the page's cron tabs already render whenever the page renders.
- The one real gate is the **mobile arm**: `mobileRequestRef` in `quake-terminal.tsx` toasts `NO_OPERATOR_HINT` ("no operator on this server — run rk operator") and does not navigate for **every** request — including `segment: "list"` / `"log"` — when `findOperatorWindow` resolves nothing; the tongue is omitted; and the mobile cron tabs live on the operator route, which does not exist without an operator. An operator-less server therefore has **no cron surface at all on a phone**.
- The plan's proposed mobile home — a `Cron` disclosure in the Server page's WATCHED zone footer — needed adjusting: `components/server-watched-zone/index.tsx` returns `null` on mobile by design (memory routes-and-shell § Server Page WATCHED Zone: "desktop-only… the Server page on a phone keeps its tiles unchanged"; e2e `the zone is absent on the mobile viewport`). `SessionTiles`' `footer` slot itself renders on both form factors, so the module's mobile branch is where a mobile section can live.
- The documentation still records the gate: cron-console-tabs § Mobile parity ("gated by the operator-window rule — no operator window ⇒ no cron tabs"), spec `docs/specs/cron.md` § UI tier 4 ("gated on the operator window", "inherits the quake terminal's server resolution and degrade-to-absent gating").

**Question asked and answered in this intake** (the plan's "to be confirmed in the intake"): mobile home for cron on an operator-less server. Options offered: (a) a mobile-only Cron section on the Server page rendered by `ServerWatchedZone`'s mobile branch, always on mobile regardless of operator, with mobile cron requests on an operator-less server navigating to `/$server` instead of toasting — recommended; (b) park mobile operator-less cron and ship the desktop half; (c) a Cron section on both form factors (reverses the 2026-09-11 supersession of the Server-page CRONS zone). **User chose (a).**

## Why

**The pain point.** Cron does not need an operator. Agents schedule prompts with `rk cron add`; entries target any role, session, or pane; the operator-tick entry is one consumer's entry among others (memory cron § rk holds no operator-tick seed). Yet the web UI's cron registry and log were designed, documented, and on mobile implemented as segments of the *operator's* surface — so on a phone a server with no operator window has no way to see what is scheduled, mute a runaway entry, or read the delivery log, and the only answer any cron entry point gives is the toast "no operator on this server — run rk operator". On desktop the drawer already renders the cron tabs operator-less, but nothing tests that, and the memory and spec say the opposite, so the next refactor of the drawer body could reintroduce a gate with no red test.

**The consequence of not fixing it.** The decision of record ("Cron is ungated from the operator") stays half-true: true on desktop by accident, false on mobile, and contradicted by the documents downstream agents read. The mobile gap matters because push is the mobile entry point for cron escalations (spec § UI tier 4: notifications deep-link to `Cron Log`); a phone user who killed the operator to stop a loop can no longer reach the registry that would let them mute the entry that respawns it.

**Why this approach.** The desktop half is a *contract* change (tests + documents pin the existing shape) rather than a code change — the code is already right, and rewriting a working branch for symmetry would be churn. The mobile half reuses the existing server-scoped page: the tmux Server page is where server-scoped facts live (the fleet view already sits in its footer), `SessionTiles` already carries a footer slot on both form factors, and `CronList` already renders a full-featured registry (`+ New entry`, the modal entry-detail sheet with mute/pin/edit/delete) without `inline`. No route is added (Constitution IV — `/$server` is in the fixed set), no palette entry is added (the existing `Operator: Show cron list` / `Show cron log` rows gain a destination on mobile), no per-viewer state is added. Rejected: a mobile cron *sheet* (the mobile arm is navigation by design — memory quake-terminal § Mobile open is navigation — and a second overlay species contradicts the one-surface consolidation); a Cron section on desktop too (the 2026-09-11 supersession retired the Server-page CRONS zone in favour of one surface, and desktop already has that surface operator-less); parking mobile (leaves the decision of record unrealised where cron's push entry point lands).

## What Changes

### 1. Desktop drawer — pin the existing gate shape (no body change)

The drawer body in `app/frontend/src/components/quake-terminal.tsx` keeps its current branch: `list` and `log` (and `tasks`) render on `server` alone; the `terminal` branch alone reads `target` (embedded `TerminalClient` when the operator window resolves, the operator-less body with the `Start operator` button and the `NO_OPERATOR_HINT` sub-line otherwise). `CronStaleBanner` keeps its own `operatorStale` gate (it renders nothing without a stale operator tick). **No rewrite of this branch** — the change makes the shape a tested, documented contract:

- New Vitest cases in `components/quake-terminal.test.tsx` (the `renders the hint line (no stream) when the resolved server has no operator` case is the fixture precedent — a resolved server whose sessions carry no `role: "operator"` window):
  - an `open` request with `segment: "list"` on that server renders `cron-list` inside the drawer and **no** `quake-terminal-empty`;
  - the same with `segment: "log"` renders `cron-log`;
  - switching back to `terminal` renders `quake-terminal-empty` with `quake-terminal-start-operator`.
- Code comments in the body that describe the cron branch as reached only past an operator (none found today — verify during apply) are corrected; comments state constraints, never narrate (code-quality § Anti-Patterns).

The operator page (`app.tsx` `operatorPage` gate) needs nothing: it exists only when an operator window exists, and its `cronTabActive` slots already mount `CronStaleBanner` + `CronList`/`CronLog` on `server`.

### 2. Mobile arm — operator-less cron requests navigate to the Server page

In `quake-terminal.tsx` `mobileRequestRef.current`, split the current `if (!srv || !tgt) { toast; return; }` branch:

```ts
if (!srv) { toast NO_OPERATOR_HINT (throttled as today); return; }
if (!tgt) {
  if (detail.segment === "list" || detail.segment === "log") {
    // Cron needs no operator: the phone's operator-less cron home is the
    // tmux Server page's Cron section.
    void navigate({ to: "/$server", params: { server: srv }, hash: "cron" });
    return;
  }
  toast NO_OPERATOR_HINT (throttled as today); return;
}
```

Exact behavior:

- `segment: "list"` **or** `"log"` on a server with no operator window → navigate to `/$server` with hash `cron`; **no toast**. Both segments land on the same section (the mobile Server page carries the registry only — §3; the log has no operator-less mobile home, recorded in memory).
- `segment` absent, `"terminal"`, or `"tasks"` on that server → unchanged: the throttled `NO_OPERATOR_HINT` toast, no navigation (Operator Terminal and Operator Tasks genuinely need the operator).
- No resolvable server (`!srv`) → unchanged toast.
- With an operator window present → unchanged: navigate to the operator route with `?tab=<segment>` (plus `?from=` on a cross-route navigation from a same-server terminal route). `mobile-cron-tabs.spec.ts` stays byte-identical.
- The Server-page navigation carries **no `?from=`** (the Server page has no compose strip to feed a context chip) and no search param — the `/$server` route validates no search; the hash is the only carrier.
- `send` payloads never accompany a cron-segment request (the palette fallback row sends `segment`-less requests), so nothing is seeded.
- The mobile tongue stays omitted without an operator (`QuakeTerminalTongue` returns `null` when `!target`) — it is the operator route's affordance, and the cron entry points on mobile are the two palette rows.

The desktop seam listener is untouched. The `NO_OPERATOR_HINT` constant and copy are untouched.

### 3. Mobile Server page — the `Cron` section

`app/frontend/src/components/server-watched-zone/index.tsx` currently `return null` when `useIsMobile()`. It becomes a form-factor fork inside the same `server-clock-dashboard` root:

```tsx
export function ServerWatchedZone({ sessions, server, onNavigate }) {
  const isMobile = useIsMobile();
  return (
    <div data-testid="server-clock-dashboard">
      <div className="mt-6">
        {isMobile ? <CronZone server={server} /> : <WatchedZone sessions={sessions} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}
```

`CronZone` (new file `components/server-watched-zone/cron-zone.tsx`, same module — it is the Server page's second content block on the phone, the mirror of the desktop WATCHED zone):

- Root `<section id="cron" data-testid="clock-zone-cron">` with a `<SectionHeading label="Cron" side={side} className="mb-2" />` (the `[ SESSIONS▊ ]────` idiom the WATCHED zone uses). `side` reads `{N} entries · next in {rel}` / `{N} entries · next due` / `{N} entries` (no dated entry) / `no entries` — computed at render from `useCronData(server).entries` via `sortCronEntries` (soonest first) and `formatDuration`; no timer (the SSE cadence is the clock).
- Body: `<CronStaleBanner server={server} />` (degrade-to-absent, as on the operator route) then `<CronList server={server} />` — **without `inline`** (the mobile operator route's mount): the entry detail sheet opens as the modal bottom-anchored overlay, `+ New entry` opens `CronCreateDialog`, rows keep the `coarse:min-h-[44px]` touch floor. `CronList` already renders `no server resolved — cron list unavailable` for an empty server string and `Agents can schedule prompts too — rk cron add.` for an empty registry; the zone adds no empty state of its own.
- Always rendered on mobile — whether or not the server has an operator (deterministic render; an operator-having phone then has two cron homes: the operator route's tabs and this section, both projections of the same `useCronData(server)`). Never rendered on desktop (cron stays in the drawer; the retired Server-page CRONS zone stays retired).
- Scroll-to: a mount effect reads the router location's hash (`useLocation()` from `@tanstack/react-router`) and, when it is `#cron`, calls `scrollIntoView({ block: "start" })` on the section root — explicit, so the behavior does not depend on the router's own hash handling inside the tiles' nested scroll container. A plain `/$server` visit (no hash) does not scroll.
- The `server` prop is new on `ServerWatchedZone` (today it takes `sessions` + `onNavigate`); `app.tsx`'s single mount (`<SessionTiles … footer={<ServerWatchedZone sessions={sessions} onNavigate={navigateToWindow} />} />`) passes `server={server}`.
- Data: `useCronData(server)` is already mounted by `StatusBar` on desktop only; on the mobile Server page this section is the sole subscriber — one mount fetch of `GET /api/cron?server=` plus the SSE-driven refetch. No new fetch loop.
- Test ids: root `server-clock-dashboard` (now present on both form factors), `clock-zone-cron` (new), `clock-zone-watched` (desktop, unchanged). Constitution IV: no new route, no settings, no localStorage; V: no new control (the rows and `+ New entry` are already palette-registered — `Cron: new entry`, `Cron: mute…`, `Cron: pin…`, `Cron: delete…`; the section is reached by the existing `Operator: Show cron list` / `Show cron log` rows).

### 4. Copy and availability — verify, do not change

- `◷` chip: `useClockChipState` already derives from entries/staleness only; no operator term exists. The chip is desktop-only (the status bar is desktop-only). No change.
- Palette rows `Operator: Show cron list` / `Operator: Show cron log`: already always listed; on desktop they open the drawer (operator or not); on mobile their operator-less behavior changes per §2. Their registration comments in `use-global-palette-actions.ts` ("a server without an operator is answered by the quake terminal's own hint line") are reworded to state the actual constraint: on desktop the cron segments render regardless; on mobile the operator-less answer is the Server page's Cron section. Same for the builder doc-comments in `lib/palette/quake-terminal.ts` ("On mobile the seam maps them to the operator route's `?tab=` param" gains the operator-less clause).
- `no server resolved — cron list unavailable` / `— cron log unavailable` stay the only cron hints. The label prefix `Operator:` on the two rows is **not** renamed (the standing palette-count assertion in `operator-compose.spec.ts` counts `Operator:` entries; a rename is a separate decision).

### 5. Tests

Vitest:
- `components/quake-terminal.test.tsx`: the three desktop cases in §1; mobile cases — a `segment: "list"` request on an operator-less server calls `navigate` with `{ to: "/$server", params: { server }, hash: "cron" }` and adds no toast; a `segment: "log"` request does the same; a `segment`-less request still toasts once and never navigates; a `segment: "tasks"` request still toasts.
- `components/server-watched-zone/`: a new `cron-zone.test.tsx` (side-slot strings for dated / undated / empty registries; banner presence when a session is `operatorStale`; `CronList` mounted without `inline`; the hash-driven scroll fires only for `#cron`) and an index-level case that mobile renders `clock-zone-cron` and not `clock-zone-watched`, desktop the reverse (`watched-zone.test.tsx` untouched).

Playwright (JSDoc intent blocks updated in the same commit — Constitution § Test Intent Comments; `just test-e2e <name>.spec`, never the full suite, per the plan's verification rule and the project memory on filter matching):
- `quake-terminal.spec.ts`: new desktop test — the `◷` chip on an **operator-less** server (`mockBackend(page, false)` with the existing cron stub, whose entry carries a `nextFire` so the chip renders) opens the drawer on Cron List with `cron-list-row-a3f9` visible and no `quake-terminal-empty`; new mobile test — at 375×812 on an operator-less server, picking `Operator: Show cron list` from the palette lands on `/default` (hash `#cron`), `clock-zone-cron` is visible with the stubbed row, and no hint toast renders. The existing `mobile: an operator-less server hides the tongue and toasts the hint without navigating` test stays valid (it fires the segment-less overflow row) — its intent comment gains the clause that cron-segment requests are the exception.
- `server-watched-zone.spec.ts`: `the zone is absent on the mobile viewport` becomes `the mobile viewport renders the Cron section in place of WATCHED` — `server-clock-dashboard` and `clock-zone-cron` visible, `clock-zone-watched` and `watched-table` absent, the `Cron` heading and `+ New entry` present (the spec's `mockBackend` gains a `**/api/cron*` stub). The desktop tests are unchanged.
- `mobile-cron-tabs.spec.ts`: unchanged.
- Gate: `npx tsc --noEmit`, the two Vitest files above, `just test-e2e quake-terminal.spec`, `just test-e2e server-watched-zone.spec`, `just test-e2e mobile-cron-tabs.spec`, plus `just test-e2e operator-compose.spec` (the palette-count assertion — nothing is added, the run is the proof).

### 6. Memory and spec

- `docs/memory/run-kit/ui/cron-console-tabs.md`: § Mobile parity and e2e coverage — replace "gated by the operator-window rule — no operator window ⇒ no cron tabs" with the actual rule: the desktop drawer renders both cron tabs whenever a server resolves (operator or not); the mobile operator route mounts them when an operator exists; the mobile operator-less home is the Server page's Cron section (registry only), reached by the two palette rows; add the new e2e cases to the coverage list. New Design Decision **"Cron is ungated from the operator"** (Decision: `Cron List`/`Cron Log` need only a resolved server; only Operator Terminal / Operator Tasks depend on the operator window. Why: agents schedule with `rk cron add`, entries target any role/session/pane, the operator-tick entry is one consumer's entry; a phone user who stopped the operator must still reach the registry that mutes the respawning entry. Rejected: keeping the gate; a mobile cron sheet — the mobile arm is navigation; a Cron section on desktop — the 2026-09-11 supersession). New Design Decision **"The mobile operator-less cron home is the Server page, registry only"** (Why: server-scoped page for a server-scoped fact, existing footer slot, no route; the log's triage value on a phone is via push deep-links, which need the operator route anyway. Rejected: `List | Log` sub-strip in the section — machinery for a second-order case).
- `docs/memory/run-kit/ui/quake-terminal.md`: § Desktop segments — state that the cron segments (and Operator Tasks) render on `server` alone and only the Operator Terminal branch reads `target`; § Availability degrades to absent — the mobile sentence "the remaining openers … surface the same hint as a brief toast … and stay put" gains the carve-out (cron-segment requests navigate to `/$server#cron`); § Mobile open is navigation — the operator-less sentence gains the same carve-out; scenarios updated (Operator-less server: an `AND GIVEN a mobile viewport, WHEN Operator: Show cron list fires, THEN the app navigates to the Server page's Cron section and no toast renders`).
- `docs/memory/run-kit/ui/routes-and-shell.md`: § Server Page WATCHED Zone — the module is no longer "desktop-only… renders `null`": its mobile branch renders the Cron section (`clock-zone-cron`, `id="cron"`, `SectionHeading "Cron"` + side slot + `CronStaleBanner` + `CronList`), the desktop branch the WATCHED zone; `server` prop; the hash scroll; the `server-clock-dashboard` root on both form factors. Design Decision § The WATCHED zone rides SessionTiles' scroll container via a footer slot gains a sentence; new DD "Mobile Server page carries Cron where desktop carries WATCHED" (the two server-scoped monitoring facts split by where each form factor lacks a home).
- `docs/memory/run-kit/cron.md`: § Overview — the sentence "on both form factors (the desktop quake drawer and the mobile operator route)" gains the operator-less clause (desktop: always; mobile: the Server page's Cron section when no operator window exists).
- `docs/memory/run-kit/ui/keyboard-and-palette.md`: the `Operator: Show cron list` / `Show cron log` entry — the mobile arm's operator-less destination.
- `docs/memory/run-kit/ui/status-signals.md`: § The clock chip — one clause: the chip's gating is entries/staleness only, never the operator window (already true; the sentence makes it a stated constraint).
- `docs/specs/cron.md` § UI — Three Tiers, item 4: "gated on the operator window" → cron tabs on the operator route when the operator exists, the Server page's Cron section otherwise; "it inherits the quake terminal's server resolution and degrade-to-absent gating" → server resolution only. Item 2's dashboard paragraph gains one sentence stating the desktop drawer's cron segments need no operator.
- `docs/memory/run-kit/ui/index.md` / `docs/memory/run-kit/index.md`: regenerate with `fab docs-index` if any description line changes. Memory hygiene per the plan: resolve relative `](x.md)` links across `docs/memory/run-kit/ui/` if any file is renamed (none is planned).

## Affected Memory

- `run-kit/ui/cron-console-tabs`: (modify) § Mobile parity reworded to the ungated rule + Server-page section; e2e coverage list; two new Design Decisions
- `run-kit/ui/quake-terminal`: (modify) § Desktop segments (server-alone cron/tasks branches), § Availability degrades to absent and § Mobile open is navigation (the cron-segment carve-out on mobile), scenarios
- `run-kit/ui/routes-and-shell`: (modify) § Server Page WATCHED Zone — mobile branch renders the Cron section; `server` prop; test ids; hash scroll; new Design Decision
- `run-kit/cron`: (modify) § Overview — operator-less clause on the web-UI sentence
- `run-kit/ui/keyboard-and-palette`: (modify) the two cron palette rows' mobile operator-less destination
- `run-kit/ui/status-signals`: (modify) § The clock chip — gating is entries/staleness only, stated

Spec (human-curated, updated in the same PR): `docs/specs/cron.md` § UI — Three Tiers items 2 and 4.

## Impact

- **Frontend (`app/frontend/src/`)**: `components/quake-terminal.tsx` (the mobile arm's operator-less branch — ~10 lines; no body change), `components/server-watched-zone/index.tsx` (form-factor fork + `server` prop), new `components/server-watched-zone/cron-zone.tsx`, `app.tsx` (one prop at the single `ServerWatchedZone` mount), doc-comments in `hooks/use-global-palette-actions.ts` and `lib/palette/quake-terminal.ts`.
- **Tests**: `components/quake-terminal.test.tsx`, new `components/server-watched-zone/cron-zone.test.tsx` (+ an index-level fork case), `tests/e2e/quake-terminal.spec.ts` (two new tests, one intent comment), `tests/e2e/server-watched-zone.spec.ts` (one test rewritten, cron stub added).
- **Backend**: none. **API**: none (`GET /api/cron` unchanged). **Routes**: none (`/$server` + hash). **Persistence**: none.
- **Docs**: six memory files, one spec, regenerated indexes.
- **Risk surface**: the mobile Server page gains a section below the tiles on every phone visit — `CronList`'s `overflow-x-auto` table already survives 375px (Change 5's min-column widths); the section adds one `useCronData` subscriber on mobile. The `server-watched-zone.spec.ts` mobile test flips meaning. `hash` navigation is new to this codebase — the explicit `scrollIntoView` effect keeps the behavior independent of router hash handling.
- **Lane**: light-lane candidate per the plan (small, self-contained). Sequencing: the last change of the plan; nothing follows.

## Open Questions

- None. The plan's one deferred decision (mobile placement) was asked and answered in this intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The mobile operator-less cron home is a Cron section rendered by `ServerWatchedZone`'s mobile branch on the tmux Server page — always on mobile regardless of operator, never on desktop; mobile `list`/`log` requests on an operator-less server navigate there instead of toasting | Asked — user chose this over parking mobile and over a both-form-factor section | S:100 R:70 A:90 D:95 |
| 2 | Certain | The desktop drawer body is not rewritten: `list`/`log`/`tasks` already render on `server` alone (since #839); the change adds the unit tests and documents the shape | Verified in `quake-terminal.tsx`; rewriting a correct branch is churn | S:90 R:95 A:100 D:95 |
| 3 | Certain | The `◷` chip and the two cron palette rows need no availability change — the chip gates on entries/staleness, the rows are always listed | Verified in `status-bar.tsx` and `use-global-palette-actions.ts`; only comments and docs change | S:85 R:95 A:100 D:95 |
| 4 | Certain | The operator page needs nothing — it exists only with an operator window, and its cron slots already mount on `server` | Verified `operatorPage` gate in `app.tsx` | S:80 R:95 A:95 D:90 |
| 5 | Confident | A mobile `segment: "log"` request on an operator-less server lands on the same Cron section (registry only); the log gets no operator-less mobile home | Plan §2 names `CronList` only; push deep-links to the log need the operator route regardless | S:60 R:85 A:65 D:60 |
| 6 | Confident | The navigation carries `hash: "cron"`; the section has `id="cron"` and an explicit mount effect scrolls it into view when the router location hash is `#cron` | The tiles area is a nested scroll container; an explicit effect avoids depending on router hash handling; no search param exists on `/$server` | S:50 R:90 A:70 D:65 |
| 7 | Certain | `CronStaleBanner` mounts above `CronList` in the Cron section; it degrades to absent without a stale operator tick | The operator-route mount's shape; the plan keeps the banner's own gate | S:65 R:95 A:85 D:80 |
| 8 | Certain | The `NO_OPERATOR_HINT` toast (copy unchanged) remains the answer for `segment`-less, `terminal`, and `tasks` mobile requests on an operator-less server, and for an unresolvable server | Those segments genuinely need the operator; the plan keeps the hint | S:70 R:95 A:85 D:75 |
| 9 | Confident | The Cron section is a plain always-open section (`SectionHeading "Cron"` with a `{N} entries · next in {rel}` side slot), not a collapsible disclosure | The chosen option described a section; no open/closed state to hold (Constitution IV); mirrors the WATCHED zone's heading idiom | S:55 R:90 A:60 D:45 |
| 10 | Certain | Test ids: `server-clock-dashboard` root on both form factors, new `clock-zone-cron`, `clock-zone-watched` desktop-only; the mobile e2e `the zone is absent` test flips to assert the Cron section | Ids follow the module's existing `clock-zone-*` scheme; the memory's rename-churn rule keeps the legacy root id | S:70 R:90 A:90 D:80 |
| 11 | Confident | The mobile tongue stays omitted without an operator; the palette rows are the mobile cron entry points | The tongue is the operator route's affordance; adding a cron tongue would be a new control needing its own palette twin | S:60 R:90 A:85 D:75 |
| 12 | Certain | `CronList` mounts in the section without `inline` (modal detail sheet, `CronCreateDialog` for `+ New entry`), matching the mobile operator route's mount | The `inline` variant exists for the drawer's in-container panel only | S:60 R:95 A:85 D:80 |
| 13 | Certain | The Server-page navigation carries no `?from=` and no search param | The Server page has no compose strip to feed a chip; `/$server` validates no search | S:55 R:90 A:85 D:85 |
| 14 | Certain | Memory/spec edits: cron-console-tabs § Mobile parity + two DDs, quake-terminal three sections, routes-and-shell § WATCHED zone + DD, cron § Overview, keyboard-and-palette row, status-signals chip clause, spec cron.md § UI items 2 and 4 | Every sentence that records the gate was located by grep; hydrate rewrites them to present truth | S:85 R:95 A:90 D:90 |
| 15 | Certain | No new route, palette entry, or per-viewer state; the two rows keep their `Operator:` label prefix | Constitution IV/V; the `operator-compose.spec` palette-count assertion counts `Operator:` entries | S:80 R:95 A:95 D:90 |

15 assumptions (11 certain, 4 confident, 0 tentative, 0 unresolved).
