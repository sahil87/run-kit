# Intake: Host Recovery Section

**Change**: 260820-4psk-host-recovery-section
**Created**: 2026-08-20

## Origin

Backlog item `[4psk]` (fab/backlog.md):

> Allow users to restore previous servers and session after a system restart. Inspiration from Chrome. Create a window to be shown on such restarts.

Refined in a design discussion that supersedes the Chrome framing and the "window" phrasing. The discussion produced nine user-confirmed decisions (recorded below and in `## Assumptions`), including a deliberate rename from "Restore" (a verb — belongs on buttons) to "Recovery" (a place — the section label). Created via promptless dispatch: no questions were asked; would-be questions are recorded as Unresolved rows with Rationale `Deferred — promptless dispatch`.

## Why

**Problem**: On a system reboot, every tmux server dies together with the rk daemon, so nothing tombstones their snapshots. The user opens RunKit to an empty Host Overview with no visible path back to their servers.

**Consequence if unfixed**: The recovery substrate already exists — `internal/snapshot` keeps per-server layout snapshots (sessions → windows → panes with cwds, former commands, colors, markers, flairs, ranks) and `rk mux snapshot list|show|restore` recreates dead servers — but it is CLI-only. A user who doesn't know the CLI incantation experiences a reboot as total loss and rebuilds their layout by hand, which is exactly the loss the snapshot subsystem was built to prevent. See `docs/memory/run-kit/layout-snapshots.md` for the full substrate contract.

**Why this approach**: A "Recovery" section on the Host Overview `/` page — not a new page/route (Constitution IV), not ghost rows in the live server list (user rejected — wants a clearly demarcated backup surface with explicit action buttons), not a Chrome-style banner/toast (over-ceremonious — coding tools restore in place), and not auto-restore (Constitution VI — restore stays user-initiated). The web surface drives the existing `snapshot.Restore` engine; the only new substrate is the offer-set derivation and the first `internal/snapshot` read path in `api/` (a user-approved Constitution II amendment).

**Detection signature (key insight)**: a lingering "live-latest" snapshot file (`{server}.json` under the snapshot store) for a server with **no live socket** means the daemon died with the server = reboot. Deliberate kills through run-kit tombstone as `auditedKill: true`; deaths observed by a live daemon tombstone unaudited. Only the lingering-latest (reboot) case is in scope.

## What Changes

### 1. Offer-set derivation (backend)

The restorable-offer set = every store entry from `snapshot.Store.List("")` with `DiedAt == nil` (a lingering live-latest) whose server is **absent** from `tmux.ListServers(ctx)` (no live socket). Tombstones — audited or unaudited — are never offered:

- **Audited tombstones** (deliberate kills through run-kit): never offered, by design.
- **Unaudited tombstones** (crash / agent-killed-server while the daemon was alive): explicitly OUT of scope for this change; noted as a possible follow-up change.

Infra/test-socket servers are **excluded** from the offer set: daemon siblings (rk-jobs, rk-code-server, rk-remotes) are never offered — their layouts are owner-recreated (rk-remotes on connect, code-server on demand) — and `rk-test-*` sockets never snapshot at all (the snapshotter's covered-server scope already skips them).

The derivation lives as a helper (in `internal/snapshot` or the api handler joining `Store.List` + `tmux.ListServers` — apply decides placement per existing patterns). `Store.List` and `ListServers` both exist today (`app/backend/internal/snapshot/store.go:355`, `app/backend/internal/tmux/tmux.go:2286`).

### 2. API endpoints (backend — first `internal/snapshot` read path in `api/`)

Today `api/` has **zero** `internal/snapshot` imports (an asserted invariant in `layout-snapshots.md` — the only coupling is the nil-safe `serverKillNotify` write-path annotation in `api/tmuxctl_bridge.go`). That invariant changes, per the approved Constitution II amendment (§4 below):

- **`GET /api/recovery`** — lists restorable offers. Each offer carries: server name, `takenAt`, session/window counts, and the full stored layout tree (sessions with `@session_color`, windows with names/pane counts/former pane commands, and a per-window resumable flag for agent windows) so row expansion needs no second request. Snapshot JSON is small; one round trip.
- **`POST /api/recovery/restore`** — body `{"server": "..."}`, mirroring `POST /api/servers/kill`'s body-style server addressing. Validates via `validate.ValidateServerName`, loads the latest snapshot, and drives the existing `snapshot.Restore(ctx, server, snap)` engine (server-level; session-by-session, oldest-first — the engine's existing order). **Synchronous**, with a documented longer handler timeout (~60s — an explicit, commented exception to the 5s handler-blocking guidance: rare, user-initiated, inner tmux calls individually `TmuxTimeout`-bounded); the response carries the engine's restore report. Restore's existing refusal semantics hold (a server alive with ≥1 user-facing session is refused → surfaced as an error on the row). All mutations are POST (Constitution IX).
- **`POST /api/recovery/dismiss`** — body `{"server": "..."}`. Converts the lingering latest into a tombstone reusing existing store semantics (`Store.Tombstone` — possibly a Tombstone-without-death variant, apply decides), creating no new state class. A dismissed server is never re-offered (the tombstone is stamped so it can't re-qualify — see Assumption 10).

New files `app/backend/api/recovery.go` + `recovery_test.go`; routes registered in `buildRouter` (`app/backend/api/router.go`); the store handle wired from `cmd/rk/serve.go` nil-safe (unwired ⇒ empty offers, section never renders). Live state still never derives from snapshots — these endpoints answer questions **about backups**, not live-state queries from backups.

### 3. Recovery section on Host Overview (frontend)

A new zone in `app/frontend/src/components/host-overview-page.tsx` (likely extracted as a `recovery-section.tsx` component), slotted **between the Tmux Servers and Services sections**, using the existing `SectionHeading` component with label "Recovery". Rendered **only when restorable offers exist** — zero footprint otherwise (no empty-state copy, unlike the always-visible Boards zone).

- **One row per restorable server**: hollow (non-live) dot, server name, meta line `N sessions · M windows · last seen X ago · system restart`, a **[Restore]** button, an **[×]** dismiss button. Dead servers never appear in the live server list/hierarchy.
- **[Restore all (N)]** in the `SectionHeading` `side` slot when more than one offer exists (the `side` slot exists today; host zones currently leave it empty).
- **Rows expand (chevron)** to a read-only session tree from the snapshot: sessions with their stored `@session_color` swatches, windows with pane counts and former commands.
- **Honesty about what comes back**: panes are fresh shells at recorded cwds — processes are never relaunched (existing engine invariant). Former commands are displayed per window. Agent windows (`claude` commands) get a "resumable" tag in the tree; a per-window "Resume agent" (`claude -c`) affordance is **PHASE 2 / out of scope**, but the row/tree design accommodates it later. (Inspiration: Zellij session-resurrection attach semantics; tmux-resurrect's process allowlist with agents as its only member.)
- **Mid-restore row state**: indeterminate per-row "restoring…" state while the synchronous restore POST is in flight (no per-session streamed progress — Assumption 19). On success the row disappears and the real server card appears in Tmux Servers — existing SSE reactivity handles the appearance; the offers list refetches after the client's own mutations (no new SSE kind — Assumption 12).
- Dismiss removes the row immediately on POST success.

API client additions in `app/frontend/src/api/client.ts`; unit tests colocated per code-quality.md.

### 4. Constitution II amendment (user approved) + version bump

The §II carve-out line — "**write-only recovery backups** (layout snapshots — artifacts about the past, never read at request time)" — gains a carve-out for a user-facing recovery reader. Draft amendment (final wording at apply; user approved the substance):

> **recovery backups** (layout snapshots — artifacts about the past). A user-facing recovery reader MAY serve them read-only — listing restorable snapshots and their stored layouts, and driving user-initiated restore — but live state never derives from a backup: no live-state query is ever answered from one.

The boundary's intent (no live-state query answered from a backup) is preserved. Constitution version bump rides this change (1.7.0 → 1.8.0 — Assumption 16), with **Last Amended** updated.

### 5. Command palette (Constitution V — keyboard-first)

Palette verbs mirror every button (registration in `app/frontend/src/hooks/use-global-palette-actions.ts` / the palette-actions context):

- `Server: Restore <name>` — one per offer
- `Restore all previous servers` — when >1 offer
- A per-offer dismiss verb (e.g. `Server: Dismiss recovery <name>`)

Per code-review.md, new keyboard-reachable actions must be documented in the command palette registration.

### 6. Docs & memory

- `docs/memory/run-kit/layout-snapshots.md`: the "Write-only boundary (Constitution II / VI)" requirement and its "api/ has zero internal/snapshot imports" scenario are superseded — hydrate rewrites that section to the amended boundary (read path exists, live state still never derives from snapshots).
- `fab/backlog.md` `[4psk]` is marked done at archive time (standard `/fab-archive` flow — no manual edit in this change).

### Non-goals (rejected alternatives & follow-ups)

- **Dedicated `/recovery` route** — rejected (Constitution IV); only hypothetically justified if snapshot-history browsing with `--at` ever becomes a UI need.
- **Ghost/dimmed server rows inline in the live list** — user rejected; wants a clearly demarcated backup surface with explicit action buttons.
- **Chrome-style restore banner/toast** — over-ceremonious; coding tools restore in place.
- **Auto-restore on daemon start** ("continue where you left off") — explicitly ruled out (Constitution VI).
- **Unaudited-tombstone offers** (crash / agent-killed-server) — follow-up change, not this one.
- **Session-level granularity** — server-level restore only; partial restore of a dead server and restoring a session into a live server are noted follow-ups.
- **Per-window "Resume agent" (`claude -c`) affordance** — Phase 2; the tree's resumable tag is the only Phase-1 surface.

A visual mock was produced during the design session (dark-theme HTML using the real globals.css tokens and the SectionHeading bracket idiom, showing collapsed/expanded/mid-restore row states); it is not a repo artifact — the decisions above are the design of record.

## Affected Memory

- `run-kit/layout-snapshots`: (modify) Write-only boundary section rewritten to the amended Constitution II carve-out; new offer-derivation, GET/POST recovery endpoints, dismiss-as-tombstone semantics; the "zero api/ imports" scenario replaced.
- `run-kit/ui/routes-and-shell`: (modify) Host Overview gains the conditional Recovery zone (placement, zero-footprint rule, row anatomy, restore/dismiss flows).
- `run-kit/ui/keyboard-and-palette`: (modify) New palette verbs (Server: Restore, Restore all previous servers, dismiss).
- `run-kit/architecture`: (modify) REST API surface gains the /api/recovery endpoints; api↔snapshot coupling note updated.

## Impact

- `app/backend/api/`: new `recovery.go` + `recovery_test.go`; route registration in `router.go`; wiring seam for the snapshot store (nil-safe, mirroring `SetServerKillNotifier`). First `internal/snapshot` import in the package.
- `app/backend/internal/snapshot/`: offer-set derivation helper (+ tests); possibly a dismiss-flavored `Tombstone` variant in `store.go`.
- `app/backend/cmd/rk/serve.go`: wire the store into the api server.
- `app/frontend/src/components/host-overview-page.tsx` (+ likely a new `recovery-section.tsx` + tests): the new zone.
- `app/frontend/src/api/client.ts`: recovery endpoints.
- `app/frontend/src/hooks/use-global-palette-actions.ts` (or the palette-actions context): new verbs.
- `fab/project/constitution.md`: §II amendment + version bump.
- Tests per code-quality.md: Go handler/derivation tests (temp-dir stores, fake tmux seams), frontend unit tests, Playwright e2e where feasible — real snapshot-store state is not reachable from the e2e harness, so e2e likely route-mocks `/api/recovery*` (mutating-route mocks need the trailing-`*` glob per the established gotcha) or uses fixture snapshots via an isolated `XDG_STATE_HOME`.

## Open Questions

<!-- clarified: 2026-08-20 — infra servers excluded from offers (Assumption 18); restore is a synchronous POST with ~60s timeout + indeterminate row state (Assumption 19) -->
None — both deferred questions resolved in the 2026-08-20 clarification session (see `## Clarifications`).

## Clarifications

### Session 2026-08-20

**Q1 (Assumption 18)**: Should infra/test-socket servers (daemon siblings like rk-jobs, rk-code-server, rk-remotes) appear in the Recovery offer set when their lingering snapshots qualify after a reboot?
**A**: Exclude — never offered; their layouts are owner-recreated, and rk-test-* sockets never snapshot. (User confirmed the recommendation.)

**Q2 (Assumption 19)**: How should a restore in flight be handled and shown, given total restore time can exceed the 5s handler-blocking guidance?
**A**: Synchronous POST with a documented ~60s server-side timeout as an explicit exception (rare, user-initiated; inner tmux calls TmuxTimeout-bounded), indeterminate per-row "restoring…" state, response carries the restore report. No async job/progress machinery. (User confirmed the recommendation.)

### Session 2026-08-20 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 10 | Confirmed | — |
| 11 | Confirmed | — |
| 12 | Confirmed | — |
| 13 | Confirmed | — |
| 14 | Confirmed | — |
| 15 | Confirmed | — |
| 16 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | "Recovery" SECTION on Host Overview `/` between Tmux Servers and Services, via existing `SectionHeading` (label "Recovery"); rendered only when offers exist, zero footprint otherwise | Discussed — user chose section over route/banner (Constitution IV); "Recovery" (place) over "Restore" (verb) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Explicit rows (hollow dot, name, meta line, [Restore], [×]) + [Restore all (N)] in the SectionHeading `side` slot; dead servers never appear in the live list; rows expand to a read-only session tree | Discussed — user rejected ghost/dimmed rows in the live list | S:95 R:80 A:90 D:95 |
| 3 | Certain | Offer set = lingering live-latest snapshots whose server has no live socket (reboot signature); audited tombstones never offered; unaudited tombstones out of scope (follow-up) | Discussed — reboot-only scope confirmed | S:95 R:75 A:90 D:95 |
| 4 | Certain | Constitution II amended: user-facing recovery reader carve-out; api/ gets its first `internal/snapshot` read path (GET offers + tree); live state still never derives from snapshots; version bump rides this change | Discussed — user approved the amendment | S:90 R:80 A:90 D:90 |
| 5 | Certain | Restore stays user-initiated (no auto-restore); Restore button drives existing `snapshot.Restore`, server-level, via POST; on success SSE surfaces the real server card | Discussed — Constitution VI/IX; Chrome-style auto-restore explicitly ruled out | S:95 R:90 A:100 D:100 |
| 6 | Certain | Dismiss = convert the lingering latest into a tombstone (reuse `Store.Tombstone` semantics), POST endpoint; server never re-offered; no new state class | Discussed — reuses existing store semantics | S:90 R:80 A:90 D:90 |
| 7 | Certain | Panes come back as fresh shells at recorded cwds (never relaunched); former commands displayed per window; agent (`claude`) windows get a "resumable" tag; per-window "Resume agent" (`claude -c`) is Phase 2, design accommodates it | Discussed — existing engine invariant + phased plan | S:90 R:85 A:95 D:95 |
| 8 | Certain | Command palette verbs mirror every button (`Server: Restore <name>`, `Restore all previous servers`, per-offer dismiss) | Constitution V; user-listed examples | S:90 R:90 A:95 D:95 |
| 9 | Certain | Session-level granularity out of scope: server-level restore only; partial restore and restore-into-live-server are noted follow-ups | Discussed — explicit scope decision | S:95 R:80 A:90 D:95 |
| 10 | Confident | Dismiss stamps the tombstone as audited (or an equivalent dedicated marker) so it can never re-qualify as an offer; a `Tombstone`-without-death variant is acceptable if cleaner | Clarified — user confirmed | S:95 R:80 A:75 D:70 |
| 11 | Certain | Single `GET /api/recovery` returns offers WITH the full layout tree inline — no separate per-server tree endpoint | Clarified — user confirmed | S:95 R:85 A:75 D:70 |
| 12 | Confident | Offers load via GET on mount + refetch after the client's own restore/dismiss; post-restore server-card appearance rides existing SSE; no new SSE event kind; cross-client offer staleness accepted | Clarified — user confirmed | S:95 R:75 A:70 D:60 |
| 13 | Certain | POST bodies address the server by name (`{"server": ...}`), mirroring `POST /api/servers/kill`; `validate.ValidateServerName` before any filesystem/tmux use | Clarified — user confirmed | S:95 R:85 A:85 D:75 |
| 14 | Confident | Restore all = client-driven sequential per-server restore POSTs with per-row status; no bulk endpoint | Clarified — user confirmed | S:95 R:80 A:70 D:60 |
| 15 | Confident | "resumable" tag = window whose recorded pane command is `claude` (basename/prefix match) | Clarified — user confirmed | S:95 R:85 A:70 D:65 |
| 16 | Certain | "last seen X ago" sources snapshot `takenAt`; on quiet servers this reads as age of the last layout change (content-dedup keeps `takenAt` stale by design) — accepted, it is the only timestamp the store has | Clarified — user confirmed | S:95 R:90 A:70 D:65 |
| 17 | Confident | Constitution version bump is minor: 1.7.0 → 1.8.0 | Amendment adds a carve-out without removing a principle | S:60 R:95 A:85 D:80 |
| 18 | Confident | Infra/test-socket servers are EXCLUDED from the offer set — daemon siblings (rk-jobs, rk-code-server, rk-remotes) are never offered (their layouts are owner-recreated); rk-test-* sockets never snapshot at all | Clarified — user confirmed | S:95 R:80 A:35 D:30 |
| 19 | Confident | Mid-restore = synchronous POST with a documented longer server-side timeout (~60s, an explicit exception to the 5s handler guidance for this rare user-initiated op; inner tmux calls stay TmuxTimeout-bounded) + indeterminate per-row "restoring…" state; the response carries the engine's restore report; no job/progress machinery | Clarified — user confirmed | S:95 R:45 A:45 D:35 |

19 assumptions (9 certain, 10 confident, 0 tentative, 0 unresolved).
