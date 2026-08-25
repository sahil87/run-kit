# Intake: Ephemeral Server Surfacing

**Change**: 260821-l1qe-ephemeral-server-surfacing
**Created**: 2026-08-21

## Origin

Backlog item `[f2b7]` root-cause direction (3b), phase 4 of the four-phase rollout agreed in a `/fab-discuss` session (2026-08-20/21).

**Depends on sibling `260821-zelc-ephemeral-option-snapshot-reap`** (the `@rk_ephemeral` option constant + `IsEphemeralServer` reader land there). This change branches off `zelc`'s branch and PRs against it (stacked). It can run in parallel with sibling `260821-hbmh-ephemeral-creation-adoption` (disjoint files, same base).

## Why

1. **Pain**: Once `@rk_ephemeral` exists, its state is invisible — an operator cannot see which servers are marked (so `rk mux reap --ephemeral` is a blind sweep from the UI's perspective), and a user doing real work in a marked server has no cue to unmark it before their layout silently goes un-snapshotted.
2. **Consequence if unfixed**: The convention operates as hidden state; the unmark-to-promote path (a deliberate feature of the `zelc` design) is undiscoverable; scratch servers visually crowd real ones in the host overview exactly the way they crowded the recovery section.
3. **Why this approach**: Surface, don't hide. The established principle (internal/tmux/tmux.go:2156 comment on `IsTestServerName`): the operator should see exactly what reap will reap — so ephemeral servers get a badge and de-emphasis, never filtering. Deliberately no new pages/routes (Constitution IV).

## What Changes

### 1. `ephemeral` flag on the servers payload — `app/backend/api/`

The server-list endpoint (`GET /api/servers`) gains `ephemeral: bool` per server, derived at request time via the `zelc` reader (`IsEphemeralServer`) — a Principle II derivation, no caching store.

- **Cost constraint**: one option read per live server per request. Keep it inside the existing per-server enumeration walk with the standard `exec.CommandContext` timeouts; the servers handler must stay within the 5s budget (code-review.md rule). If enumeration already batches per-server tmux reads, ride that batch; a gone-mid-walk server reads as not-ephemeral.
- The server list is fetch-on-demand (not SSE-carried — established in the recovery work), so no SSE schema change. Do not add one.
- Frontend client: extend the server type in `app/frontend/src/api/client.ts`.

### 2. Host Overview badge + de-emphasis — `app/frontend/src/components/host-overview-page.tsx` (+ its server-list child components)

- A small `scratch` chip/badge on marked servers' rows/tiles, styled like existing inline chips (e.g. the recovery tree's `resumable` chip: bordered, rounded, `text-text-secondary`).
- **Sort marked servers to the bottom** of the server list (stable within groups); no visual removal, no collapsed group — direction 2's grouping UI was explicitly rejected in the discussion.
- Do NOT hide ephemeral servers anywhere; do not exclude them from any existing action.

### 3. `rk doctor` hint — `app/backend/cmd/rk/doctor.go`

A doctor line reporting the count of live servers carrying `@rk_ephemeral` with the remediation hint `rk mux reap --ephemeral` when the count is nonzero. Follow the existing doctor check/hint formatting (see the tmux remediation-hint work, change `ho1o`, for current style). Zero marked servers ⇒ quiet or OK-line per doctor's existing convention for absent findings.

### 4. Tests

- Backend: handler test for the `ephemeral` field (marked/unmarked/gone server); doctor check test.
- Frontend: unit tests for badge render + sort order (colocated `.test.tsx`); extend the relevant host-overview e2e spec if one covers the server list, updating its `.spec.md` companion in the same commit (Constitution: Test Companion Docs).
- All via `just test-backend` / `just test-frontend` / `just test-e2e`.

## Affected Memory

- `run-kit/architecture`: (modify) REST API surface — servers payload gains `ephemeral`
- `run-kit/ui/routes-and-shell`: (modify) host overview server list — scratch badge + sort rule
- `run-kit/tmux-sessions`: (modify) `@rk_ephemeral` consumer list grows (servers API, doctor)

## Impact

`app/backend/api` (servers handler), `cmd/rk/doctor.go`, `app/frontend/src/api/client.ts`, host-overview server-list components, plus tests. No new routes or pages (Constitution IV); no SSE changes.

**Stacking**: branches off `260821-zelc`'s branch, PR base = `zelc`'s branch (retarget to `main` after `zelc` merges). Parallel with `260821-hbmh` (disjoint files). Independent of `260821-f2b7`.

## Open Questions

*(none — all decisions resolved in the discussion session)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Badge + sort-to-bottom; never hide, never filter, no collapsed group | Discussed — operator-visibility principle (tmux.go:2156); grouping UI (direction 2) explicitly rejected | S:85 R:85 A:90 D:85 |
| 2 | Confident | `ephemeral` rides the fetch-on-demand `GET /api/servers` payload; no SSE carriage | Server list is established as fetch-on-demand; SSE schema change would be scope creep with no consumer | S:75 R:80 A:85 D:80 |
| 3 | Confident | Doctor reports count + `rk mux reap --ephemeral` hint, quiet at zero | Mirrors the doctor remediation-hint pattern (ho1o); zero-noise default fits doctor conventions | S:70 R:90 A:80 D:75 |
| 4 | Confident | Scope limited to host-overview server list + doctor; sidebar/status-rail de-emphasis deferred | Phase 4 was scoped as "surface" minimally; sidebar rows carry a dense signal system (status pyramid) — touching it is a separate design conversation | S:65 R:85 A:75 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved).
