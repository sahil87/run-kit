# Plan: Host Recovery Section

**Change**: 260820-4psk-host-recovery-section
**Intake**: `intake.md`

## Requirements

### Backend: Offer-Set Derivation

#### R1: Restorable-offer derivation
`internal/snapshot` SHALL expose a derivation that computes the restorable-offer set: every store entry from `Store.List("")` with `DiedAt == nil` (a lingering live-latest) whose server is absent from the live tmux server enumeration (`tmux.ListServers(ctx)` — no live socket), excluding infra servers. Tombstones (audited or unaudited) MUST never be offered. Infra/test-socket servers MUST be excluded: the daemon-sibling names (`rk-daemon`, `rk-jobs`, `rk-code-server`, `rk-remotes` — reuse/mirror the existing infra-server predicate in the codebase rather than inventing a new list; check `internal/` and the frontend `isInfraServer` idiom for the canonical set) never produce offers. `rk-test-*` sockets never snapshot at all (snapshotter scope), so no additional filter is needed for them beyond the infra rule.

- **GIVEN** a snapshot store holding a live-latest for `kit`, a live-latest for `rk-daemon`, and a tombstone for `old`
- **WHEN** the offer set is derived while only `dev` has a live socket
- **THEN** exactly one offer is returned (`kit`), with `rk-daemon` excluded as infra and `old` excluded as a tombstone

- **GIVEN** a live-latest for `kit` and a live socket for `kit`
- **WHEN** the offer set is derived
- **THEN** `kit` is not offered (its server is alive)

#### R2: Offer payload carries the full layout tree inline
Each offer SHALL carry: server name, `takenAt`, session count, window count, and the full stored layout tree — sessions (name, `color`) with windows (name, pane count, per-pane former commands, plus a per-window `resumable` boolean) — so the frontend row expansion needs no second request. A window is `resumable` when any of its recorded pane commands is `claude` (basename or prefix match, e.g. `claude`, `claude -c`, `/path/to/claude --flags`).

- **GIVEN** a snapshot whose window `w1` recorded pane command `claude --dangerously-skip-permissions` and window `w2` recorded `zsh`
- **WHEN** the offer is serialized
- **THEN** `w1` has `resumable: true` and `w2` has `resumable: false`

### Backend: API Endpoints

#### R3: `GET /api/recovery` lists offers
The api package SHALL serve `GET /api/recovery` returning the derived offers (R1 shape with R2 payload) as JSON. When the snapshot store handle is unwired (nil) or the store is empty, the endpoint returns an empty offers list — never an error. This is the package's first `internal/snapshot` read path, sanctioned by the amended Constitution §II (R8); live-state queries still never derive from snapshots.

- **GIVEN** an api server constructed without a snapshot store (nil seam)
- **WHEN** `GET /api/recovery` is requested
- **THEN** the response is 200 with an empty offers list

#### R4: `POST /api/recovery/restore` restores synchronously
The api package SHALL serve `POST /api/recovery/restore` with body `{"server": "..."}` (mirroring `POST /api/servers/kill` body-style addressing). The handler MUST validate the name via `validate.ValidateServerName` before any filesystem or tmux use, load the latest snapshot, and drive the existing `snapshot.Restore(ctx, server, snap)` engine synchronously under a dedicated ~60-second context timeout — a documented, commented exception to the 5s handler-blocking guidance (rare, user-initiated; each inner tmux call remains individually `TmuxTimeout`-bounded). The response carries the engine's restore report (recreated sessions/windows, skipped items, notes, former commands). The engine's existing refusal semantics surface as an error response (e.g. server alive with ≥1 user-facing session). All mutations are POST (Constitution IX).

- **GIVEN** a tombstoned or absent server name in the body
- **WHEN** the snapshot load or restore fails
- **THEN** the handler returns an error status with the engine's message, and no partial success is reported as success

- **GIVEN** a malformed server name (e.g. `../x` or `a.b`)
- **WHEN** `POST /api/recovery/restore` is requested
- **THEN** validation rejects it before any filesystem or tmux access

#### R5: `POST /api/recovery/dismiss` tombstones the offer
The api package SHALL serve `POST /api/recovery/dismiss` with body `{"server": "..."}` (same validation). Dismiss converts the server's lingering live-latest into a tombstone reusing existing store semantics (`Store.Tombstone` or a minimal dismiss-flavored variant in `store.go` — apply decides; the tombstone MUST be stamped such that it can never re-qualify as an offer, e.g. the audited marker or an equivalent dedicated field). No new state class is introduced. A server with no live-latest is a no-op success (idempotent dismiss).

- **GIVEN** an offer for `kit`
- **WHEN** `POST /api/recovery/dismiss` succeeds and `GET /api/recovery` is re-queried
- **THEN** `kit` is absent from the offers and its history directory is left intact

#### R6: Wiring seam is nil-safe
`cmd/rk/serve.go` SHALL wire the snapshot store into the api server via a nil-safe setter seam (mirroring `SetServerKillNotifier` in `api/tmuxctl_bridge.go`). Routes are registered in `buildRouter` (`app/backend/api/router.go`). An unwired store degrades to empty offers (R3), so the Recovery section simply never renders.

- **GIVEN** the serve wiring
- **WHEN** the daemon starts with snapshots enabled
- **THEN** `/api/recovery` serves offers derived from the same store the snapshotter writes

### Constitution: §II Amendment

#### R7: Write-only carve-out amended + version bump
`fab/project/constitution.md` §II's carve-out line ("write-only recovery backups … never read at request time") SHALL be amended so a user-facing recovery reader MAY serve snapshots read-only — listing restorable snapshots and their stored layouts, and driving user-initiated restore — while live state never derives from a backup (no live-state query is ever answered from one). Constitution version bumps 1.7.0 → 1.8.0 with **Last Amended** set to today.

- **GIVEN** the amended §II
- **WHEN** the api package imports `internal/snapshot` for the recovery reader
- **THEN** the import is constitutional, and any live-state handler reading a snapshot to answer a live query remains a violation

### Frontend: Recovery Section

#### R8: Recovery zone on Host Overview
`app/frontend/src/components/host-overview-page.tsx` SHALL render a new Recovery zone (extracted as `recovery-section.tsx`), slotted between the TMUX SERVERS and SERVICES zones, using the existing `SectionHeading` with label "Recovery". The section renders ONLY when restorable offers exist — zero footprint otherwise (no empty-state copy). Offers load via a GET on mount + refetch after the client's own restore/dismiss mutations; no new SSE event kind; no polling (`setInterval`+fetch is an anti-pattern).

- **GIVEN** `GET /api/recovery` returns an empty list
- **WHEN** the Host Overview renders
- **THEN** no Recovery heading, row, or reserved space appears

#### R9: Offer row anatomy and actions
Each offer renders one row: a hollow (non-live) dot, the server name, a meta line `N sessions · M windows · last seen X ago · system restart` ("last seen" from snapshot `takenAt` — on quiet servers this reads as the age of the last layout change, accepted), a **Restore** button, and an **×** dismiss button. A **Restore all (N)** control rides the `SectionHeading` `side` slot when more than one offer exists, implemented as client-driven sequential per-server restore POSTs (no bulk endpoint). Rows expand via a chevron to a read-only session tree from the offer payload: sessions with their stored color swatches, windows with pane counts and former commands, agent windows tagged **resumable** (display-only in this change — the per-window "Resume agent" affordance is Phase 2 and out of scope). Dead servers never appear in the live server list.

- **GIVEN** two offers
- **WHEN** the section renders
- **THEN** `Restore all (2)` appears in the heading side slot, and each row carries Restore + dismiss

#### R10: Restore/dismiss flows
Clicking **Restore** POSTs `/api/recovery/restore` and shows an indeterminate per-row "restoring…" state until the response; on success the row is removed and the offers refetched (the real server card appears in TMUX SERVERS via the existing create/refresh reactivity — `refreshServers()` is invoked on success so the live list updates without waiting for SSE). On failure the row returns to rest and the error surfaces via the existing toast idiom. Clicking **×** POSTs `/api/recovery/dismiss` and removes the row on success. API client functions live in `app/frontend/src/api/client.ts`.

- **GIVEN** a restore in flight
- **WHEN** the POST resolves successfully
- **THEN** the offer row disappears, `refreshServers()` runs, and the offers list is refetched

#### R11: Command palette verbs
Palette actions mirror every button (Constitution V): `Server: Restore <name>` (one per offer), `Restore all previous servers` (when >1 offer), and `Server: Dismiss recovery <name>` (one per offer). Register them following the established registry conventions (layout-global or Host-context group as the codebase's palette architecture dictates — the actions must be reachable where the palette mounts on `/`), gated on offers being present, and documented in the palette registration per code-review.md.

- **GIVEN** one offer for `kit`
- **WHEN** the palette opens
- **THEN** `Server: Restore kit` and `Server: Dismiss recovery kit` are listed and invoke the same flows as the buttons

### Non-Goals

- Unaudited-tombstone offers (crash / agent-killed-server) — follow-up change
- Session-level granularity (partial restore; restore-into-live-server) — follow-up
- Per-window "Resume agent" (`claude -c`) execution — Phase 2; only the resumable tag ships
- A `/recovery` route, restore banner/toast, or auto-restore — rejected in intake
- New SSE event kinds or cross-client offer push — one-time GET + refetch accepted

### Design Decisions

#### Offer derivation lives in `internal/snapshot`
**Decision**: The restorable-offer derivation is a helper in `internal/snapshot` taking the live-server list as an argument (or a small interface), not api-side logic.
**Why**: The store schema and tombstone semantics live there; the api handler stays a thin validate→derive→serialize shell, and the derivation is unit-testable with a temp-dir store and a fake server list.
**Rejected**: Deriving in the handler (couples offer semantics to HTTP; harder to test).
*Introduced by*: 260820-4psk-host-recovery-section

#### Dismiss reuses tombstone semantics
**Decision**: Dismiss converts the live-latest to a tombstone stamped so it never re-qualifies (audited marker or equivalent dedicated field).
**Why**: Audited tombstones are already never offered; smallest semantic reuse guaranteeing no re-offer, no new state class (Constitution II).
**Rejected**: A separate dismissed-list file (new state class); deleting the snapshot (destroys the backup the user might still want via CLI).
*Introduced by*: 260820-4psk-host-recovery-section

## Tasks

### Phase 1: Setup

- [x] T001 Add restorable-offer derivation to `app/backend/internal/snapshot/` (new `restorable.go` + `restorable_test.go`): filter `Store.List("")` to `DiedAt == nil`, exclude live servers and infra names, build the offer payload (counts, layout tree, per-window `resumable` via a `claude` command matcher). Reuse/mirror the canonical infra-server name set. <!-- R1, R2 -->

### Phase 2: Core Implementation

- [x] T002 Add the dismiss store operation in `app/backend/internal/snapshot/store.go` (+ tests in `store_test.go`): convert a live-latest to a never-re-offered tombstone (audited stamp or equivalent), idempotent when no latest exists. <!-- R5 -->
- [x] T003 Create `app/backend/api/recovery.go` + `recovery_test.go`: `GET /api/recovery` (nil-safe store → empty list), `POST /api/recovery/restore` (validate name → load latest → `snapshot.Restore` under a ~60s context with a comment documenting the 5s-guidance exception → return report), `POST /api/recovery/dismiss` (validate → dismiss op). Table-driven handler tests with temp-dir stores and injected fakes for tmux/restore seams. <!-- R3, R4, R5 -->
- [x] T004 Register the three routes in `app/backend/api/router.go` and add the nil-safe store setter seam (mirroring `SetServerKillNotifier`); wire the store in `app/backend/cmd/rk/serve.go`. <!-- R6 -->
- [x] T005 [P] Amend `fab/project/constitution.md` §II carve-out per R7 wording; bump version 1.7.0 → 1.8.0 and Last Amended date. <!-- R7 -->
- [x] T006 [P] Add recovery API client functions + types to `app/frontend/src/api/client.ts` (getRecoveryOffers, restoreRecoveryServer, dismissRecoveryServer) + `client.test.ts` coverage. <!-- R3, R4, R5 -->
- [x] T007 Create `app/frontend/src/components/recovery-section.tsx` (+ `recovery-section.test.tsx`): conditional zone, offer rows (hollow dot, meta line, Restore, ×, chevron-expand session tree with color swatches, former commands, resumable tags), Restore-all in the `SectionHeading` side slot, restoring state, toast on failure. Integrate into `host-overview-page.tsx` between TMUX SERVERS and SERVICES, with mount-fetch + post-mutation refetch + `refreshServers()` on restore success. <!-- R8, R9, R10 -->
- [x] T008 Register the palette verbs (`Server: Restore <name>`, `Restore all previous servers`, `Server: Dismiss recovery <name>`) per the palette registry conventions, gated on offers, wired to the same flows. <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Playwright e2e `app/frontend/tests/e2e/recovery-section.spec.ts` + sibling `recovery-section.spec.md` (constitution Test Companion Docs): route-mock `/api/recovery*` (trailing-`*` globs on the mutating routes — withServer appends `?server=`), assert zero-footprint when empty, row anatomy, expand tree, restore flow (row removal + refetch), dismiss flow. <!-- R8, R9, R10 -->
- [x] T010 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted vitest suites, and the new e2e spec via `just test-e2e "recovery-section"`. Fix fallout. <!-- R1 -->

## Execution Order

- T001 → T002 → T003 → T004 (backend chain); T005, T006 parallel to the backend chain
- T006 → T007 → T008 (frontend chain); T009 after T007; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Offer derivation returns exactly the reboot-orphaned, non-infra live-latests; tombstones and live servers never appear (unit-proven with temp-dir store)
- [x] A-002 R2: Offers carry inline layout trees with per-window resumable flags; `claude`-command windows flag true
- [x] A-003 R3: `GET /api/recovery` serves offers; nil store and empty store both yield 200 + empty list
- [x] A-004 R4: `POST /api/recovery/restore` validates the name first, runs synchronously under the ~60s context (commented exception), and returns the engine report; engine refusals surface as errors
- [x] A-005 R5: `POST /api/recovery/dismiss` tombstones the latest so it never re-offers; idempotent on absent latest; history preserved
- [x] A-006 R6: Routes registered in `buildRouter`; store wired nil-safe from `serve.go`
- [x] A-007 R7: Constitution §II amended with the recovery-reader carve-out; version 1.8.0, Last Amended updated
- [x] A-008 R8: Recovery zone renders between TMUX SERVERS and SERVICES only when offers exist; zero footprint otherwise
- [x] A-009 R9: Row anatomy complete (hollow dot, meta line, Restore, ×, expandable tree with swatches/commands/resumable tags); Restore-all appears at >1 offer and runs sequential per-server POSTs
- [x] A-010 R10: Restore shows the in-flight row state, then removes the row, refetches offers, and calls `refreshServers()`; failures toast and restore the row; dismiss removes on success
- [x] A-011 R11: The three palette verb families are registered, gated on offers, and invoke the same flows

### Scenario Coverage

- [x] A-012 R1: The GIVEN/WHEN/THEN scenarios in R1 (infra + tombstone + live exclusions) are covered by unit tests
- [x] A-013 R4: Malformed-name rejection is tested before any filesystem/tmux access
- [x] A-014 R8: The e2e spec covers empty (no section), populated (rows), restore, and dismiss via route mocks, with the `.spec.md` companion in the same commit

### Edge Cases & Error Handling

- [x] A-015 R4: A restore exceeding the handler context surfaces a timeout error to the row (no hung UI); inner tmux calls remain TmuxTimeout-bounded
- [x] A-016 R5: Dismissing a server whose latest vanished concurrently (raced tombstone) succeeds as a no-op

### Code Quality

- [x] A-017 Pattern consistency: New code follows naming and structural patterns of surrounding code (chi handler shape, `SectionHeading` idiom, client.ts conventions)
- [x] A-018 No unnecessary duplication: Existing utilities reused (`validate.ValidateServerName`, `Store.Tombstone` semantics, `SectionHeading`, toast idiom, `fsatomic`)
- [x] A-019 No shell-string subprocess calls; any new tmux interaction goes through `internal/tmux` with `exec.CommandContext` + timeouts
- [x] A-020 No client polling: offers ride mount-fetch + post-mutation refetch, never `setInterval`+fetch
- [x] A-021 All mutating endpoints are POST; CORS allowlist untouched (Constitution IX)
- [x] A-022 Comments state constraints only (the 60s-exception comment; no narration, no change-ID citations)

### Security

- [x] A-023 R4: `validate.ValidateServerName` runs before any filesystem or tmux use in both POST handlers; no JSON-sourced value reaches a tmux target (the engine's target-agreement rule holds)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The `rk mux snapshot` CLI remains the operator reader; the restore engine, `Store.Tombstone`, and all reused utilities keep their existing call sites.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Offer derivation lives in `internal/snapshot` (new `restorable.go`) taking the live-server list as input | Store semantics live there; api stays thin; intake left placement to apply | S:70 R:85 A:80 D:75 |
| 2 | Confident | Infra exclusion reuses the codebase's canonical infra-server name set (daemon siblings incl. `rk-daemon`) rather than a new hardcoded list | Intake names the idiom; exact symbol located at apply | S:65 R:85 A:75 D:70 |
| 3 | Confident | `resumable` matcher = command basename/prefix `claude` on any pane in the window | Intake assumption 15 verbatim; window-level flag from pane-level commands is the natural rollup | S:70 R:85 A:75 D:75 |
| 4 | Confident | Restore success additionally calls `refreshServers()` so the live card appears without waiting for SSE | Server-list is fetch-on-demand (not SSE-carried) per routes-and-shell memory; mirrors the create-server flow | S:65 R:85 A:80 D:75 |
| 5 | Confident | Palette verbs register wherever the palette architecture makes them reachable on `/` (layout-global group per the Panel-toggle precedent), gated on offers | Registry conventions documented in memory; exact hook chosen at apply | S:60 R:85 A:75 D:70 |
| 6 | Confident | `Store.Dismiss` = thin wrapper over `Tombstone(server, now, audited=true)`; no new op semantics or state class | Audited tombstones already never re-qualify as offers; smallest reuse (matches the Design Decision) | S:85 R:90 A:85 D:85 |
| 7 | Confident | Restore response = the engine's `Report` serialized directly (JSON tags added to the report types), not a wrapper struct | R4 says the response carries the engine's report; tags on the engine types keep one shape for CLI and API | S:70 R:85 A:75 D:75 |
| 8 | Confident | Both recovery POSTs address the server with body key `server` (not kill's literal `name`) | The pinned contract says `{"server": "..."}` explicitly; body-style addressing is what "mirrors kill" meant | S:60 R:90 A:80 D:70 |
| 9 | Confident | Recovery hook state lifted to `HostOverviewPage` (`useRecoveryOffers` called once, handed to the section and the palette builder) | One fetch and one mutation flow shared by UI and palette; avoids dual-fetch divergence | S:65 R:85 A:80 D:75 |
| 10 | Confident | Palette verbs register route-scoped from `HostOverviewPage` via `useRegisterPaletteActions`, not the layout-global group | Recovery offers are a `/`-route concern; matches the BoardPage precedent for non-AppShell routes | S:65 R:85 A:75 D:70 |
| 11 | Confident | "Last seen X ago" reuses the existing `formatDuration` helper computed at render, no ticking clock | Offers change only on fetch, so a per-second timer leaf would be waste | S:70 R:85 A:75 D:75 |
| 12 | Confident | Restore-all continues past per-server failures (each failure toasts; the sequence proceeds) | Servers are independent; one engine refusal shouldn't block the rest | S:60 R:85 A:70 D:70 |

13 assumptions (0 certain, 13 confident, 0 tentative).
