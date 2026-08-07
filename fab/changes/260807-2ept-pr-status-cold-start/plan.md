# Plan: PR Status Cold-Start Latency + Batched Branch Derivation

**Change**: 260807-2ept-pr-status-cold-start
**Intake**: `intake.md`

## Requirements

### prstatus: Registration Wake Seam

#### R1: First-sight registration wakes the branch refresher
`BranchRefresher` SHALL carry a coalescing wake channel (buffered, capacity 1). `Register(repoDir, branch)` SHALL signal that channel with a non-blocking send **only when the (repoDir, branch) key was not already present in `entries`**. A re-observation of a known pair SHALL NOT signal. `Register` MUST remain hot-path safe — no subprocess, no network, no blocking send.

- **GIVEN** a refresher with an empty `entries` map
- **WHEN** `Register("/repo", "feat")` is called
- **THEN** exactly one wake signal is pending on the wake channel
- **AND** a second `Register("/repo", "feat")` leaves no further signal pending

- **GIVEN** a refresher whose wake channel already holds a pending signal
- **WHEN** many further first-sight pairs are registered in a burst
- **THEN** the channel still holds exactly one pending signal (capacity-1 coalescing) and no `Register` call blocks

#### R2: Start's loop debounces a wake into one refresh pass
`Start`'s goroutine SHALL `select` on `ctx.Done()`, the interval ticker, **and** the wake channel. On a wake it SHALL wait a fixed settle window (`branchPRWakeDebounce`, a named constant) draining any further wake signals, then run exactly ONE `refresh(ctx)`. The settle window SHALL NOT be extended by drained wakes (a steady trickle can never postpone the pass), and a `ctx` cancellation during settle SHALL exit the goroutine without refreshing. The 30s steady-state ticker cadence SHALL be unchanged — the wake is additive.

- **GIVEN** a started refresher whose interval is far in the future
- **WHEN** a burst of N first-sight pairs is registered
- **THEN** exactly one additional refresh pass runs (each pair resolved once per pass), not N passes

- **GIVEN** a refresher settling after a wake
- **WHEN** its context is cancelled
- **THEN** the goroutine returns without running a further refresh

### prstatus: Batched Viewer Head-Index

#### R3: The batched GraphQL query carries head identity and updatedAt
`ghQuery`'s node selection SHALL additionally request `headRefName`, `headRepository { nameWithOwner }`, and `updatedAt`; `ghPR` SHALL carry the matching fields (`headRepository` nullable). The query's states, ordering, and `$limit` SHALL be unchanged (`[OPEN, MERGED, CLOSED]`, `UPDATED_AT desc`, limit 100). `PRStatus` and every SSE/frontend-visible shape SHALL be unchanged.

- **GIVEN** a gh GraphQL response whose nodes carry `headRefName`, `headRepository.nameWithOwner`, and `updatedAt`
- **WHEN** `parsePRs` decodes it
- **THEN** the parsed nodes expose those three values
- **AND** a node with `headRepository: null` decodes without error

#### R4: A successful collector parse seeds the refresher's viewer head-index
`Collector` SHALL carry an optional, nil-safe viewer-PR sink (settable via an exported setter taking `func([]ViewerPR)`, where `ViewerPR` is an exported projection of the parsed nodes). `Collector.refresh` SHALL invoke the sink **only after a successful parse**, in addition to the existing wholesale `byURL` rebuild. A failed gh call or a parse error SHALL NOT invoke the sink (stale-while-revalidate applies to the seed).

`BranchRefresher.StoreViewerIndex(prs []ViewerPR)` SHALL replace a stored `(host, headRepo, headRef) → []BranchPR` index **wholesale** under `mu`. The key's host component SHALL be parsed from the node's PR `url` (the batched query carries no `--hostname`, so the URL is the only host authority). Nodes with an empty URL, an unparseable URL host, an empty head ref, or an absent head repository SHALL be skipped. Index keys SHALL be case-insensitive on the host and repository identity (GitHub hosts and `owner/name` are case-insensitive, and a local origin URL may differ in case from GitHub's canonical `nameWithOwner`); branch names stay case-sensitive.

After storing a **non-empty** index, `StoreViewerIndex` SHALL signal the refresher's wake channel (the same non-blocking coalescing signal `Register` uses), so a seed that lands **after** the first registrations still triggers one debounced index-served pass. Startup ordering MUST NOT rely on wiring order alone — the collector's first refresh completes at an unpredictable time relative to the first SSE registrations, and both orderings must converge to an index-served pass.

`Collector.refresh` SHALL be single-flighted: concurrent invocations (interval tick vs `RefreshNow`) serialize, so one pass's `byURL` swap and sink invocation can never interleave with another's (the index the refresher joins against always agrees with the snapshot SSE serves).

- **GIVEN** a wired collector whose gh call returns two viewer PRs on the same head
- **WHEN** `refresh` runs successfully
- **THEN** the refresher's index holds both candidates under that `(repo, ref)` key

- **GIVEN** an index seeded from a successful refresh
- **WHEN** a later collector refresh fails (gh error or malformed JSON)
- **THEN** the last-good index is still in place

- **GIVEN** nodes with `headRepository: null`, an empty `headRefName`, or an empty `url`
- **WHEN** the index is seeded
- **THEN** none of those nodes appear in the index

- **GIVEN** a **started** refresher with registered pairs and no index yet (the restart path: SSE registrations beat the collector's first refresh)
- **WHEN** `StoreViewerIndex` stores a non-empty batch
- **THEN** exactly one debounced refresh pass follows, and index-hit pairs resolve with zero per-pair gh calls

#### R5: Per-repo origin identity is resolved locally, host-qualified, and cached
`BranchRefresher` SHALL resolve a `repoDir` to its **host-qualified** `host/owner/name` origin identity via `git remote get-url origin` run in `repoDir` through a package-var exec seam (`exec.CommandContext`, `ghTimeout`, explicit argv, `cmd.Dir = repoDir` — never interpolated; Constitution §I). The host MUST be part of the identity: an `owner/name`-only identity would let a pane whose origin is `gitlab.com/sahil87/tool` (or a GHE mirror) join a `github.com/sahil87/tool` viewer PR and attach a wrong-host PR while suppressing the authoritative gh fallback. Resolution SHALL run on the refresher goroutine only, never on the hot path, and SHALL happen **outside** the `mu` critical section. The verdict SHALL be cached per `repoDir` with a TTL (`branchOriginTTL`), caching BOTH a success and a failure, and SHALL be pruned for repos no live pair observes — mirroring the existing `defaultBranches` cache exactly. A failed or unparseable resolution SHALL fail open to the per-pair gh path.

Normalization SHALL accept only origin forms that carry an explicit host authority — `https://host/owner/name(.git)`, `ssh://git@host(:port)/owner/name(.git)`, `git@host:owner/name(.git)`, `git://host/owner/name(.git)`, with or without a trailing `.git` or `/` — and SHALL fail open for anything else. In particular, bare filesystem-path origins (absolute, relative, or `file://`) SHALL never yield an identity, even when a path segment contains a dot (`cache.local/acme/tool` as a relative path is NOT a hosted remote).

- **GIVEN** a pane repo whose origin is `https://gitlab.com/sahil87/tool.git` and a viewer index containing `github.com/sahil87/tool` with the same branch
- **WHEN** a refresh pass resolves that pair
- **THEN** the index lookup misses (host mismatch) and the pair falls back to the gh path

- **GIVEN** the same repo with three pairs registered
- **WHEN** a refresh pass runs
- **THEN** `git remote get-url origin` runs at most once for that repo, and a second pass within the TTL adds no further call

- **GIVEN** an origin lookup that errors or emits unparseable output
- **WHEN** a pass resolves that repo's pairs
- **THEN** the failure verdict is cached and the pairs resolve via the per-pair gh path (fail open)

- **GIVEN** a repo with no live pair whose verdict has aged past the TTL
- **WHEN** the age-out pass runs
- **THEN** its origin verdict is pruned

#### R6: The refresh loop is index-first with gh as fallback-on-miss
`BranchRefresher.refresh` SHALL resolve each pending pair in this order:

1. **Default-branch exclusion** — unchanged and FIRST; still an authoritative negative with no gh call, still runs when gh is unavailable, and SHALL outrank an index hit.
2. **Viewer-index join** — resolve `repoDir` → `host/owner/name` (R5) and look up `(host, owner/name, branch)`. A host mismatch IS a miss. On a hit, pick the winner with the **same precedence as `pickBranchPR`** (open > merged > closed via `branchStateRank`, most-recently-updated within a class — implemented by a single shared helper, not a second ranking) and write the positive entry. No `gh pr list` subprocess SHALL run for that pair on that pass.
3. **Per-pair gh fallback** — on a miss, fall through to the existing `gh pr list --head` path unchanged (gated on gh availability, stale-while-revalidate, `pickBranchPR`).

An index **miss** SHALL NEVER be an authoritative negative: only the gh fallback's successfully-parsed empty result, or the default-branch exclusion, may clear an entry. When no index has been seeded yet, the join SHALL be skipped without resolving origin identity (no wasted subprocess).

The gh-availability probe (`gh auth status`, up to 10s) SHALL be resolved **lazily**: it runs only when the first pair in a pass actually reaches the gh fallback, memoized for the remainder of the pass (the existing `branchPRAvailabilityTTL` cache still applies across passes). A pass in which every pair resolves via the exclusion or an index hit SHALL issue **no gh subprocess at all**, including the availability probe — the wake-driven cold-start pass must not be delayed by a hung probe it doesn't need.

- **GIVEN** a pair whose `(origin, branch)` is present in the index
- **WHEN** a refresh pass runs
- **THEN** the entry resolves to the precedence-winning indexed candidate and zero `gh pr list` calls are issued for that pair

- **GIVEN** a pair absent from the index (non-viewer PR, aged out, fork head, host mismatch, or origin-resolution failure)
- **WHEN** a refresh pass runs
- **THEN** the gh fallback runs for that pair

- **GIVEN** a pass in which every pair resolves via the default-branch exclusion or an index hit
- **WHEN** the pass completes
- **THEN** zero gh subprocesses ran, including the `gh auth status` availability probe

- **GIVEN** a pair holding a last-good positive entry and an empty index
- **WHEN** a pass runs with gh unavailable
- **THEN** the entry is unchanged (a miss never writes a negative)

- **GIVEN** a pair on the repo's default branch that also has an index hit
- **WHEN** a pass runs
- **THEN** the entry resolves to the authoritative negative and no index value is written

### api: Wiring

#### R7: NewRouter wires the collector's seed into the default refresher
`NewRouterAndServer` SHALL wire the collector's viewer-PR sink to `prstatus.DefaultBranchRefresher.StoreViewerIndex` **before** `pc.Start(ctx)` and `DefaultBranchRefresher.Start(ctx)`, so the collector's immediate batched refresh stores the index before the first SSE registrations arrive. `NewTestRouter` SHALL stay unwired. `RefreshNow` on both types and `POST /api/status/refresh` behavior SHALL be unchanged.

- **GIVEN** a production router construction
- **WHEN** the collector's first (immediate) refresh parses successfully — whether it lands before or after the first SSE registrations
- **THEN** the stored index reaches the refresher and (per R4's wake-on-store) an index-served pass follows; the wiring order alone is NOT relied on for this guarantee

### Non-Goals

- Disk-seeding snapshots across restarts (deferred to a future `pr-status-disk-seed` change with its own constitution carve-out).
- Any frontend, SSE payload, or API-surface change — `SnapshotBranchPR` / `MapBranchState` / `PRStatus` shapes are untouched, and `internal/sessions` is not modified.
- Any change to the 30s branch tick or 90s collector tick.

### Design Decisions

#### First-sight-only wake
**Decision**: `Register` signals the wake channel only when the pair's key is newly inserted into `entries`.
**Why**: the SSE enrichment pass re-registers every observed pair every 2.5s, so an any-registration wake would degenerate the refresher into a 2.5s poll of N `gh` subprocesses.
**Rejected**: waking on every `Register` (unbounded gh volume); waking from the sessions layer instead (would push refresher knowledge onto the hot path).
*Introduced by*: 260807-2ept-pr-status-cold-start

#### Stored index, not one-shot seeding
**Decision**: the collector pushes a wholesale-replaced index that the refresher *stores* and consults on every pass, rather than seeding entries once.
**Why**: makes startup ordering safe (the collector's immediate refresh stores the index before the first registrations) and cuts steady-state gh volume, not just cold-start latency.
**Rejected**: one-shot seeding of `entries` (racy at startup, no steady-state benefit); a pull from the refresher into the collector (would invert the existing wiring direction and add a dependency edge).
*Introduced by*: 260807-2ept-pr-status-cold-start

#### An index miss is never an authoritative negative
**Decision**: only the gh fallback's parsed-empty result or the default-branch exclusion may clear an entry; an index miss always falls through.
**Why**: the batched result covers only viewer-authored PRs inside the top-100 recently-updated window, so it cannot distinguish "no PR" from "not covered".
**Rejected**: treating an empty index bucket as a negative (would blank PR status for every non-viewer-authored or aged-out PR).
*Introduced by*: 260807-2ept-pr-status-cold-start

## Tasks

### Phase 1: Wake seam

- [x] T001 Add `branchPRWakeDebounce` (1s) constant and the `wake chan struct{}` (cap 1) + `wakeDebounce` duration field to `BranchRefresher` in `app/backend/internal/prstatus/prstatus_branch.go`, initialized in `NewBranchRefresher` <!-- R1 -->
- [x] T002 Make `Register` detect first-sight keys and signal the wake via a non-blocking helper (`signalWake`) in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R1 -->
- [x] T003 Extend `Start`'s select loop with the wake case plus a `settle` debounce helper (drain-then-one-refresh, ctx-cancel aware) in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R2 -->

### Phase 2: Batched viewer index

- [x] T004 Extend `ghQuery` with `headRefName`, `headRepository { nameWithOwner }`, `updatedAt` and add the matching `ghPR` fields in `app/backend/internal/prstatus/prstatus.go` <!-- R3 -->
- [x] T005 Add the exported `ViewerPR` projection, the nil-safe `onViewerPRs` sink + `SetViewerPRSink` setter, and the successful-parse-only sink call in `Collector.refresh` in `app/backend/internal/prstatus/prstatus.go` <!-- R4 -->
- [x] T006 Add the stored `viewerIndex` map, `viewerIndexKey` (case-insensitive repo), and `StoreViewerIndex` (wholesale replace, skip empty URL / ref / repo) in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R4 -->
- [x] T007 Extract the shared precedence ranker `pickBranchCandidate([]BranchPR) *BranchPR` out of `pickBranchPR` in `app/backend/internal/prstatus/prstatus_branch.go` so index candidates and gh results rank identically <!-- R6 -->
- [x] T008 Add `branchOriginTTL`, the `branchOriginExec` package-var seam (`git remote get-url origin`, `exec.CommandContext` + `ghTimeout` + `cmd.Dir`), `parseOriginRepo` normalization, `originEntry`, and the TTL-cached `originRepo` resolver in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Rework `refresh`'s per-pair loop to index-first / fallback-on-miss (exclusion → index join → gh), skipping the join when no index is seeded, and prune the origin cache alongside `defaultBranches` in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R6 -->
- [x] T010 Wire `pc.SetViewerPRSink(prstatus.DefaultBranchRefresher.StoreViewerIndex)` before `pc.Start(ctx)` in `NewRouterAndServer` (`app/backend/api/router.go`), leaving `NewTestRouter` unwired <!-- R7 -->

### Phase 4: Tests

- [x] T011 [P] Add collector-side tests in `app/backend/internal/prstatus/prstatus_test.go`: query-field parsing (`headRefName`/`headRepository`/`updatedAt`), null-head-repository and empty-URL handling, sink fires only on a successful parse, sink nil-safe <!-- R3 R4 -->
- [x] T012 [P] Add wake-seam tests in `app/backend/internal/prstatus/prstatus_branch_test.go`: first-sight signals, re-registration does not, burst coalesces to one pending signal, `settle` drains + honors ctx cancel, a started refresher's wake drives exactly one extra pass <!-- R1 R2 -->
- [x] T013 [P] Add index-join tests in `app/backend/internal/prstatus/prstatus_branch_test.go`: hit resolves with correct precedence and zero gh exec, miss falls back, miss never writes a negative, default-branch exclusion outranks a hit, fork/identity mismatch falls back, empty index skips origin resolution, stale-while-revalidate of the index <!-- R4 R6 -->
- [x] T014 [P] Add origin-identity tests in `app/backend/internal/prstatus/prstatus_branch_test.go`: `parseOriginRepo` URL-form normalization table, one lookup per repo per TTL window (success and failure), fail-open to gh, re-probe after TTL, pruning when unobserved <!-- R5 -->
- [x] T015 Run `just test-backend` (scoped `./internal/prstatus/... ./api/...` first) and fix any failures <!-- R1 R2 R3 R4 R5 R6 R7 -->

### Phase 5: Rework cycle 1 (review findings M1, M2, S1, S2, S3)

- [x] T016 Signal the wake channel at the tail of `StoreViewerIndex` (non-empty store only), and add the production-ordering test: start a refresher with an empty index, register a burst, then seed — assert exactly one debounced index-served pass with zero per-pair gh exec (`app/backend/internal/prstatus/prstatus_branch.go`, `prstatus_branch_test.go`) <!-- R4 R2 --> <!-- rework: M1/S3 — the seed never woke the refresher; startup ordering was wiring-order-dependent and lost the race on the restart path -->
- [x] T017 Host-qualify origin identity: `parseOriginRepo` returns `host/owner/name` and accepts only scheme-ful/scp-like forms (bare filesystem paths fail open, dotted-relative-path pseudo-hosts rejected); `viewerIndexKey` includes the host parsed from `ViewerPR.URL` (unparseable-host nodes skipped); host mismatch = index miss; update the normalization table test with gitlab/GHE mismatch + path-rejection cases (`app/backend/internal/prstatus/prstatus_branch.go`, `prstatus.go`, `prstatus_branch_test.go`, `prstatus_test.go`) <!-- R5 R6 R4 --> <!-- rework: M2 — owner/name-only identity can attach a different host's PR and suppress the authoritative gh path -->
- [x] T018 Make the gh-availability probe lazy + memoized per pass in `BranchRefresher.refresh` (probe only when the first pair reaches the gh fallback; all-index-hit pass issues no gh subprocess), with a test counting `available` invocations (`app/backend/internal/prstatus/prstatus_branch.go`, `prstatus_branch_test.go`) <!-- R6 --> <!-- rework: S2 — an all-index-hit cold-start pass could stall up to 10s on a hung gh auth status it never needed -->
- [x] T019 Single-flight `Collector.refresh` (serialize interval tick vs `RefreshNow`, e.g. a refresh mutex) so one pass's `byURL` swap + sink call can never interleave with another's (`app/backend/internal/prstatus/prstatus.go`) <!-- R4 --> <!-- rework: S1 — the sink publication was not ordered with the byURL swap under concurrent passes -->
- [x] T020 Re-run `go test -count=1 ./internal/prstatus/... ./api/...`, `go test -race ./internal/prstatus/...`, then `just test-backend`; fix any failures <!-- R1 R2 R3 R4 R5 R6 R7 --> <!-- rework: verification for cycle 1 -->

## Execution Order

- T001 → T002 → T003 (same struct/loop)
- T004 → T005 (sink projects the new node fields)
- T006 depends on T005's `ViewerPR`; T007 and T008 are independent of T004–T006
- T009 depends on T006, T007, T008; T010 depends on T005
- T011–T014 depend on their respective implementation tasks; T015 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `BranchRefresher` carries a cap-1 wake channel and `Register` signals it only for first-sight keys, with no subprocess/network/blocking added to `Register`
- [x] A-002 R2: `Start`'s loop selects on ctx/ticker/wake and coalesces a burst of wakes into exactly one `refresh` after a named settle constant
- [x] A-003 R3: `ghQuery` requests `headRefName`, `headRepository { nameWithOwner }`, and `updatedAt`, with unchanged states/ordering/limit and unchanged `PRStatus`
- [x] A-004 R4: a successful collector parse pushes `[]ViewerPR` into `BranchRefresher.StoreViewerIndex`, which wholesale-replaces a `(repo, ref) → candidates` index with the documented skip rules
- [x] A-005 R5: `git remote get-url origin` runs via `exec.CommandContext` with a timeout, explicit argv, and `cmd.Dir`, behind a per-repo TTL cache that caches both outcomes and is pruned like `defaultBranches`
- [x] A-006 R6: `refresh` resolves exclusion → index join → gh fallback, with an index hit issuing no `gh pr list` for that pair
- [x] A-007 R7: `NewRouterAndServer` wires the sink before starting either poller; `NewTestRouter` remains unwired and `POST /api/status/refresh` behavior is unchanged

### Behavioral Correctness

- [x] A-008 R2: the 30s branch tick and 90s collector tick are unchanged — the wake is purely additive
- [x] A-009 R6: index candidates and gh results are ranked by one shared precedence helper (open > merged > closed, most-recently-updated within a class), not two implementations
- [x] A-010 R6: an index miss never writes a negative entry — only the gh fallback's parsed-empty result or the default-branch exclusion clears one
- [x] A-011 R6: the default-branch exclusion still runs first, still needs no gh call, still works when gh is unavailable, and outranks an index hit
- [x] A-012 R4: a failed collector refresh (gh error or malformed JSON) leaves the last-good index in place

### Scenario Coverage

- [x] A-013 R1: a test proves first-sight registration signals exactly once and re-registration of a known pair signals never
- [x] A-014 R2: a test proves a burst of first-sight registrations yields exactly one additional refresh pass on a started refresher
- [x] A-015 R4: tests cover parsing the three new query fields, the null-`headRepository`/empty-URL/empty-ref skips, and the sink firing only on a successful parse
- [x] A-016 R5: a table test covers origin URL normalization across https/ssh/scp/git forms with and without `.git`
- [x] A-017 R6: tests prove an index hit issues zero per-pair exec and a miss falls through to the gh path

### Edge Cases & Error Handling

- [x] A-018 R5: an origin-resolution failure fails open to the gh path and is cached (no per-pass retry storm)
- [x] A-019 R6: with no index seeded, the join is skipped without resolving origin identity, so an unwired collector costs no `git` subprocess
- [x] A-020 R2: a ctx cancellation during the settle window exits the goroutine without a further refresh
- [x] A-021 R6: a fork PR whose head repository differs from the pane repo's origin misses the index and falls back to gh
- [x] A-029 R4: `StoreViewerIndex` signals the coalescing wake after a non-empty store — a seed arriving after registrations yields exactly one debounced index-served pass, proven by a test exercising the real ordering (start empty → register → seed)
- [x] A-030 R5: origin identity is host-qualified — a same-`owner/name` repo on a different host (gitlab/GHE) misses the index and falls back to gh; bare filesystem-path origins fail open and never yield an identity
- [x] A-031 R6: a pass in which every pair resolves via exclusion or index hit issues zero gh subprocesses, including the `gh auth status` availability probe (lazily resolved, memoized per pass)
- [x] A-032 R4: `Collector.refresh` is single-flighted — concurrent tick/`RefreshNow` passes serialize, so the sink publication always agrees with the `byURL` snapshot

### Code Quality

- [x] A-022 Pattern consistency: new seams/caches follow the established `branchPRExec` / `branchDefaultExec` package-var + per-instance-field pattern and the `defaultBranchEntry` TTL-cache shape
- [x] A-023 No unnecessary duplication: precedence ranking is shared with `pickBranchPR`; the origin cache reuses the `defaultBranches` cache/prune pattern rather than inventing a new one
- [x] A-024 Exec discipline: every new subprocess uses `exec.CommandContext` with a timeout and an explicit argument slice, with `repoDir` passed only as `cmd.Dir` (no shell string, no interpolation)
- [x] A-025 Named constants: the settle window and the origin-cache TTL are named constants, not inline literals
- [x] A-026 In-memory only: the index and origin cache are wholesale-replaced / TTL-pruned in-memory maps — no disk, no database (Constitution §II)
- [x] A-027 Hot-path purity: `Register`/`Snapshot` remain zero-subprocess lock-guarded map ops; all `gh`/`git` execution stays on the refresher and collector goroutines
- [x] A-028 Tests for changed behavior: colocated Go tests cover every new/changed behavior and `just test-backend` is green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/prstatus/prstatus_branch.go:1045 pickBranchPR` — reduced by T007 to a two-line wrapper (unmarshal → `pickBranchCandidate`). Not redundant today: it owns the JSON-error contract `refresh` keys its stale-while-revalidate branch on. Becomes deletable only if the gh fallback is changed to hand decoded `[]BranchPR` to `refresh` directly.
- `app/backend/internal/prstatus/prstatus_branch_test.go:56 seedIndex` — a one-line pass-through over `StoreViewerIndex(prs)`; every call site could use the real method and drop the helper.
- Nothing else. The per-pair gh path (`branchPRExec`, `checkAvailable`, the `gh pr list` branch of `refresh`) is *demoted* to fallback-on-miss but stays load-bearing: it is the only authoritative-negative source and the only coverage for non-viewer-authored, aged-out, fork-head, and cross-host pairs. The `defaultBranches` cache and the default-branch exclusion are likewise untouched and still outrank the index.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-part fix in one change: registration-wake seam + stored viewer head-index, with `gh pr list --head` demoted to fallback-on-miss | Prescribed verbatim by the intake ("Agreed fix (two parts, one change)") and by its § What Changes | S:90 R:75 A:85 D:90 |
| 2 | Confident | Debounce implemented as a FIXED settle window (`branchPRWakeDebounce = 1s`) that drained wakes do NOT extend, exposed as a per-instance `wakeDebounce` field so tests can shrink it | Intake mandates "debounced/coalesced… one refresh, not N" with a ~1s value but no extension semantics; a fixed window cannot be postponed indefinitely by a trickle of registrations, and the field mirrors the existing `now`/`exec` per-instance test seams | S:60 R:90 A:80 D:70 |
| 3 | Confident | Seed seam = exported `ViewerPR` projection + `Collector.SetViewerPRSink(func([]ViewerPR))`; `ghPR` stays unexported | `router.go` lives in package `api`, so the hook and its payload type MUST be exported to be wired there; a projection keeps the gh JSON shape private and the seam narrow | S:65 R:85 A:90 D:75 |
| 4 | Confident | Index keys lowercase the `owner/name` repo identity (branch names stay case-sensitive) | GitHub repository identities are case-insensitive and `nameWithOwner` returns canonical case, while a local `origin` URL may be typed differently — lowercasing prevents a spurious identity miss; git branch names ARE case-sensitive, so they are left untouched | S:50 R:90 A:85 D:75 |
| 5 | Confident | `parseOriginRepo` requires a host-like first segment (contains `.`) plus owner and name, so a filesystem-path origin fails open instead of yielding a bogus `parent/dir` identity | Intake requires normalization "across https/ssh/git@/trailing-.git" but is silent on local-path remotes; a path origin has no GitHub identity, and fail-open (→ gh path) is the intake's prescribed handling for identity-resolution failure | S:55 R:85 A:80 D:70 |
| 6 | Confident | With no index seeded, the join short-circuits BEFORE resolving origin identity | Intake requires "no index yet" to be a miss but does not say whether origin resolution still runs; short-circuiting keeps an unwired collector (e.g. `NewTestRouter`, unit tests) at zero `git` subprocesses, which the hot-path/volume goal of the change implies | S:55 R:95 A:85 D:80 |
| 7 | Confident | The sink is invoked AFTER the `byURL` swap and outside the collector's lock | Intake fixes only "after a successful parse"; calling a foreign callback while holding `mu` would risk lock coupling across the two types, and post-swap ordering means any consumer sees a consistent collector state | S:50 R:90 A:90 D:80 |
| 8 | Certain | Invariants preserved: hot-path zero-exec, stale-while-revalidate (incl. the index), default-branch exclusion outranks the index, single shared `pickBranchPR` precedence, `--state all` merged-square durability, Constitution §I exec discipline, §II in-memory only | Enumerated as hard constraints in the intake's § Invariants preserved and verified against the current source | S:95 R:80 A:95 D:95 |
| 9 | Certain | Tests are colocated Go tests extending the existing exec-seam / clock-seam stubbing patterns in `prstatus_test.go` and `prstatus_branch_test.go`; verification gate is `just test-backend` | Intake § Tests names the files and patterns; `code-quality.md` mandates colocated tests and tests for changed behavior | S:80 R:90 A:90 D:85 |
| 10 | Confident | The started-refresher pass-count test registers its pairs BEFORE `Start`, so the initial refresh plus one wake-driven pass is a deterministic two passes (no sleep-based race) | Intake requires proving "exactly one refresh pass for a burst"; registering before `Start` removes the initial-refresh/registration interleaving that would make the count timing-dependent | S:45 R:95 A:85 D:65 |
| 11 | Confident | Origin-form acceptance is decided by FORM, not by a dotted-segment heuristic: an explicit scheme from an allowlist (`https`/`http`/`ssh`/`git`) or the scp-like `user@host:owner/name` (userinfo REQUIRED). `file://`, bare/relative paths, `~/…`, and schemeless `host:owner/name` all fail open | R5 mandates "only origin forms that carry an explicit host authority" and names four accepted forms but does not enumerate the rejected scheme set or say whether schemeless `host:path` qualifies; requiring the `@` is what makes "not a filesystem path" decidable without a heuristic, and every rejection is fail-open (correct-but-unoptimized), so the strict reading costs nothing | S:65 R:90 A:85 D:70 |
| 12 | Confident | The node host is parsed from `ViewerPR.URL` with `net/url` + `u.Hostname()` (port dropped), and the index key stays a 2-arg `viewerIndexKey(hostRepo, headRef)` over the already-joined `host/owner/name` string that `parseOriginRepo` returns | R4/R5 fix the identity's CONTENT (host-qualified, case-folded on host+repo) but not the parsing mechanism or the key's arity; `net/url` is stdlib and avoids a hand-rolled parser, dropping the port matches `parseOriginRepo`'s authority handling so the two sides agree, and one joined string keeps exactly one place that composes the identity | S:60 R:90 A:90 D:75 |
| 13 | Confident | `Collector.refresh` single-flights via a dedicated `refreshMu` HELD ACROSS the gh subprocess (blocking), kept distinct from `mu` (which guards `byURL` for `Snapshot` readers and is never held across a subprocess) | R4 prescribes "concurrent invocations serialize", which rules out a drop-if-in-flight try-lock; blocking is safe because both callers are background — the tick owns its goroutine and `RefreshNow` is invoked only from the detached goroutine behind `POST /api/status/refresh`, which coalesces in-flight forced refreshes itself, so no HTTP handler can ever wait on it | S:70 R:85 A:90 D:80 |
| 14 | Confident | The production-ordering test counts refresh passes by counting `r.now` reads (`refresh` takes exactly one clock read at its top), with all `Register` calls made before the baseline is captured | R4's acceptance demands "exactly one debounced index-served pass", which needs a pass counter; the gh-exec counter cannot serve (an index-served pass runs zero execs by definition) and the origin/default-branch/availability seams are all TTL-cached to one call per window, leaving the clock read as the only per-pass observable that does not require adding a test-only field to production code | S:55 R:90 A:80 D:65 |

14 assumptions (3 certain, 11 confident, 0 tentative).
