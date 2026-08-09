# Plan: PR-Status Disk Seed Across Restarts

**Change**: 260809-r4vk-pr-status-disk-seed
**Intake**: `intake.md`

## Requirements

### prstatus: Disk Store

#### R1: One JSON cache file under the shared state root, written atomically with conservative modes
`internal/prstatus` SHALL own a file store persisting the process's PR-status seed to ONE JSON file. Its default path SHALL be `$XDG_STATE_HOME/rk/prstatus.json` when `XDG_STATE_HOME` is set, else `~/.local/state/rk/prstatus.json` — uniform across platforms, mirroring `snapshot.DefaultDir()` minus the per-server subdirectory. Every write SHALL go through `internal/fsatomic.WriteFile` (temp file + atomic rename). The file SHALL be created with mode `0600` and any directory this store creates with mode `0700` (both reduced by the process umask, exactly as `fsatomic.WriteFile`/`os.MkdirAll` already behave) — deliberately tighter than the snapshots' 0644/0755, since PR metadata is private-repo data. No new subprocess and no shell string SHALL be introduced (Constitution §I).

- **GIVEN** `XDG_STATE_HOME=/tmp/state`
- **WHEN** the default cache path is resolved
- **THEN** it is `/tmp/state/rk/prstatus.json`
- **AND** with `XDG_STATE_HOME` unset it is `~/.local/state/rk/prstatus.json`

- **GIVEN** a store rooted at a fresh temp directory that does not exist yet
- **WHEN** a state is saved
- **THEN** the directory is created `0700`, the file exists with perm `0600`, and it contains complete, parseable JSON

#### R2: Explicit persistence DTOs, an integer `schema` field, and a silent failure posture
The on-disk shape SHALL be explicit persistence DTOs with JSON tags — the in-memory `PRStatus`/`ViewerPR`/`BranchPR` structs SHALL NOT be marshalled directly, so the disk schema is decoupled from in-memory struct evolution. The document SHALL carry a top-level integer `schema` version field, a `login`, a `savedAt`, the collector `byURL` map, the viewer-PR list, and the positive branch entries as explicit `repoDir`/`branch` fields (NEVER the internal NUL-joined cache key).

Loading SHALL be total: an absent file, an unreadable file, malformed/truncated JSON, or a `schema` value other than the current one SHALL yield an EMPTY seed with **no error surfaced** — at most one `slog.Debug` line. A failed write SHALL likewise be a debug line and nothing more (never an error return to a caller that would surface it, never a crash).

- **GIVEN** a cache file containing malformed JSON, a truncated document, or `"schema": 999`
- **WHEN** the store loads
- **THEN** the seed is empty, `ok` is false, and no error is surfaced

- **GIVEN** no cache file at all
- **WHEN** the store loads
- **THEN** the seed is empty and no error is surfaced

- **GIVEN** a persisted document
- **WHEN** its JSON is inspected
- **THEN** branch entries carry discrete `repoDir` and `branch` fields and the document carries an integer `schema`

#### R3: Writes are coalesced by content dedup (ignoring `savedAt`)
`Save` SHALL skip the write entirely when the candidate document equals the last-written one **ignoring `savedAt`** — the same freshness-only-skip rule as `snapshot.ContentEqual` — and SHALL report whether a write happened. The 30s branch tick and 90s collector tick MUST therefore produce no write when nothing changed. The serialized document MUST be deterministic for equal state: the branch-entry list (assembled from a Go map) SHALL be sorted by `(repoDir, branch)` so equal state serializes equally.

- **GIVEN** a store that has just saved a state
- **WHEN** the identical state is saved again
- **THEN** no write happens (`wrote == false`) and the on-disk `savedAt` is unchanged

- **GIVEN** the same store
- **WHEN** a state differing in any persisted field is saved
- **THEN** a write happens (`wrote == true`)

- **GIVEN** two assemblies of the same branch entries from a map
- **WHEN** each is serialized
- **THEN** the bytes are identical (stable ordering)

### prstatus: Startup Seed

#### R4: The collector's last-good state is seeded, with `FetchedAt` PRESERVED
`Collector` SHALL expose a seed entry point that fills its `byURL` map AND its last-good viewer-PR list from a loaded cache. Each seeded `PRStatus` SHALL keep its **original `FetchedAt`**, not a load-time stamp, so the flyout's "checked Xs ago" line reports honest staleness. The seed SHALL apply only while the target is still empty, so it can never clobber fetched state. `Collector` SHALL also retain the last successful parse's `[]ViewerPR` (the source the cache persists) and the login it was fetched as, both readable by the cache writer.

- **GIVEN** a fresh collector and a cache holding one `PRStatus` fetched at T
- **WHEN** the collector is seeded
- **THEN** `Snapshot()` serves that PR with `FetchedAt == T`

- **GIVEN** a collector that has already refreshed successfully
- **WHEN** a seed is applied
- **THEN** the fetched state is untouched

#### R5: Positive branch entries and the viewer head-index are seeded, marked seed-originated
`BranchRefresher` SHALL expose a seed entry point taking the cache's positive `(repoDir, branch) → BranchPR` entries. Each seeded entry SHALL be stamped with a **load-time `observedAt`** (NOT the pre-restart value): `observedAt` is a liveness field driving the 5-minute age-out, so preserving a pre-restart timestamp would let the first refresh pass delete seeded entries before the SSE enrichment loop (~2.5s) has re-registered the live ones. A pair already present SHALL NOT be overwritten. Seeding SHALL NOT signal the wake channel (no pair is registered yet; `Register` fires the wake on first sight).

The viewer head-index SHALL also be seedable from the cache's viewer-PR list, through the SAME store/skip/key rules `StoreViewerIndex` applies, but flagged as **seed-originated**. Every entry a pass resolves from a seed-originated index SHALL itself be marked seed-originated; an entry resolved from a FRESH index, from the gh fallback, or from the default-branch exclusion SHALL be marked NOT seed-originated.

- **GIVEN** a cache with a positive entry for `(/repo, feat)` whose pre-restart `observedAt` is far in the past
- **WHEN** the refresher is seeded and a refresh pass runs immediately
- **THEN** the entry is still served (it was stamped at load time, not aged out)

- **GIVEN** a refresher already holding an entry for `(/repo, feat)`
- **WHEN** a seed carrying a different PR for that pair is applied
- **THEN** the existing entry wins

- **GIVEN** a seed-originated index and a registered pair it covers
- **WHEN** a pass resolves the pair from that index
- **THEN** the resulting entry is marked seed-originated
- **AND** the same resolution from a freshly-stored index marks it not seed-originated

#### R6: The seed is NEVER authoritative
A seeded value SHALL be replaced by fresh derivation exactly as stale in-memory state is today. A successful collector fetch SHALL rebuild `byURL`, the viewer list, and the head-index wholesale — **including authoritative negatives** (a PR dropping out of the batch). A successful branch pass SHALL overwrite a seeded entry with its index/gh result, and an authoritative negative (parsed-empty `gh pr list`, or the default-branch exclusion) SHALL clear it. A FAILED fetch (gh error, unavailable gh, malformed JSON) SHALL leave the seeded state in place (stale-while-revalidate). The seed SHALL never suppress, delay, or replace a fetch.

- **GIVEN** a seeded `byURL` holding PR X
- **WHEN** a successful collector fetch returns a batch without X
- **THEN** X is gone from the snapshot

- **GIVEN** a seeded positive branch entry
- **WHEN** a pass's `gh pr list` parses to an empty result
- **THEN** the entry is cleared to a negative

- **GIVEN** the same seeded state
- **WHEN** the collector's gh call errors and the branch pass's exec errors
- **THEN** both seeded values are still served

#### R7: Writes ride the background goroutines only; the SSE hot path is untouched
The disk READ SHALL happen exactly once, at startup, before either poller starts. Writes SHALL be attempted only from the collector's and branch refresher's background refresh goroutines, at the tail of a pass. `Register`, `Snapshot`, `SnapshotBranchPR`, and `attachPRStatus` SHALL be unchanged — no file IO and no subprocess on the 2.5s SSE hot path. The save hooks SHALL be nil-safe optional fields (nil ⇒ no-op), mirroring the `onViewerPRs` sink pattern, so every unwired/test instance behaves exactly as before.

- **GIVEN** an unwired collector and refresher (no cache attached)
- **WHEN** refresh passes run
- **THEN** no file is written and behavior is byte-identical to today

- **GIVEN** a wired cache
- **WHEN** `Register`/`Snapshot` are called
- **THEN** no disk IO occurs

### prstatus: Login Keying

#### R8: The batched query carries `viewer { login }`
`ghQuery` SHALL additionally select `login` on `viewer`, alongside the existing `pullRequests` selection; the response parser SHALL carry it through. States, ordering, and `$limit` SHALL be unchanged, and `PRStatus`/`ViewerPR`/every SSE-visible shape SHALL be unchanged. A response with no `login` field SHALL parse to an empty login without error.

- **GIVEN** a gh response carrying `viewer.login = "sahil87"` and PR nodes
- **WHEN** it is parsed
- **THEN** both the login and the nodes are available
- **AND** a response without the field parses to an empty login and the same nodes

#### R9: A login mismatch at the NEXT successful fetch discards seed-originated state and rewrites the cache
The cache SHALL record the login of the last successful fetch. At startup the seed SHALL be applied UNCONDITIONALLY (verification would need a network call or subprocess — rejected, since the seed exists precisely for when gh is slow/offline). The comparison SHALL happen at the **next successful fetch**: when a successful parse reports a login different from the loaded cache's login, every still-seed-originated branch entry SHALL be discarded (cleared to nil) at that point, and the cache SHALL be rewritten under the new login. `byURL`, the viewer list, and the head-index need no explicit discard — that very fetch replaces them wholesale. An empty login on either side SHALL NOT be treated as a mismatch (unknown ≠ different). Once a mismatch has been handled, it SHALL NOT be re-handled on later passes.

- **GIVEN** a cache written as login A, seeded into a fresh process
- **WHEN** the next successful fetch reports login B
- **THEN** no seed-originated branch entry serves any longer
- **AND** the rewritten cache carries login B

- **GIVEN** the same seeded process
- **WHEN** the next successful fetch reports login A
- **THEN** seeded entries keep serving

- **GIVEN** a seeded entry that a pass already resolved from fresh data
- **WHEN** a login mismatch is then detected
- **THEN** that entry survives (it is no longer seed-originated)

### api: Wiring

#### R10: `NewRouterAndServer` loads and seeds before starting the pollers; `NewTestRouter` stays unwired
`NewRouterAndServer` SHALL, after constructing the collector and wiring `SetViewerPRSink`, load the disk cache, seed the collector + `DefaultBranchRefresher`, and attach the save hooks — all BEFORE `pc.Start(ctx)` and `prstatus.DefaultBranchRefresher.Start(ctx)`. A path-resolution or load failure SHALL degrade to a debug log and an unseeded start. `NewTestRouter`/`NewTestRouterWithRiff`/`NewTestRouterWithWt` SHALL remain unwired, so unit tests never touch the real state directory. `POST /api/status/refresh` behavior and every API/SSE payload SHALL be unchanged. The store type SHALL live in `internal/prstatus`, so package `api` gains no new import edge.

- **GIVEN** a production router construction
- **WHEN** it completes
- **THEN** the seed has been applied and the hooks attached before either poller's first pass

- **GIVEN** a test router construction
- **WHEN** refresh passes run
- **THEN** nothing is read from or written to the state directory

### prstatus: #542 Should-Fixes

#### R11: `BranchRefresher.refresh` is single-flighted
`BranchRefresher` SHALL carry a `refreshMu sync.Mutex` held across a WHOLE refresh pass (including its subprocesses), distinct from `mu` (which guards the maps for hot-path readers and is never held across a subprocess) — mirroring `Collector.refresh`'s T019 fix. Concurrent passes (the interval tick / wake goroutine vs `RefreshNow` from the detached goroutine behind `POST /api/status/refresh`) SHALL serialize, so a stale parsed-empty result can no longer clear an entry a concurrent pass just resolved positively. Blocking is acceptable because both callers are background goroutines.

- **GIVEN** a refresher whose gh exec blocks
- **WHEN** a tick pass is in flight and `RefreshNow` is invoked
- **THEN** the second pass waits — at most one pass is ever inside the gh call

#### R12: `parseOriginRepo` requires EXACTLY two path segments
`parseOriginRepo` SHALL require the (`.git`/trailing-slash-trimmed) path to split into **exactly two** non-empty segments. A deeper path (GitLab subgroup, Bitbucket `/scm/` prefix, a proxy prefix such as `https://github.com/proxy/acme/tool.git`) or a shallower one SHALL report `ok=false` — fail open to the per-pair `gh pr list` fallback, which is always correct, just not free. GitHub/GHE repository paths are exactly `owner/name`, so a deeper path can never legitimately join a viewer-index entry. The function's misleading "a deeper path still ends in owner/name" comment SHALL be corrected. Every currently-accepted two-segment form (`https`, `ssh://` with port, scp-like, `git://`, with/without `.git`, with credentials, with trailing slash) SHALL be unchanged.

- **GIVEN** `https://github.com/proxy/acme/tool.git`
- **WHEN** it is normalized
- **THEN** `ok` is false (no `github.com/acme/tool` identity is produced)
- **AND** `https://gitlab.com/group/subgroup/tool.git` and `https://bitbucket.corp/scm/proj/tool.git` are likewise `ok=false`
- **AND** every two-segment form still normalizes exactly as before

### governance: Constitution Amendment

#### R13: A fresh §II carve-out covering both `$XDG_STATE_HOME/rk/` classes, version 1.7.0
`fab/project/constitution.md` §II SHALL gain a carve-out paragraph legitimizing BOTH existing disk classes under `$XDG_STATE_HOME/rk/`: **write-only recovery backups** (layout snapshots — artifacts about the past, never read at request time) and **startup seed caches**, which MAY pre-fill in-memory derived state at process start but are NEVER authoritative — a fresh derivation always overwrites a seeded value, and deleting any of these files changes nothing but cold-start latency. The Governance line SHALL read **Version 1.7.0** (minor bump) with **Last Amended** updated to this change's date. §II's core rule (state derived from tmux and the filesystem at request time; no database, ORM, migration system, or persistent state store) SHALL remain intact.

- **GIVEN** the amended constitution
- **WHEN** §II and the Governance line are read
- **THEN** the carve-out names both classes, the seed cache is explicitly non-authoritative and droppable, the version is 1.7.0, and Last Amended is this change's date

### Non-Goals

- Persisting tmux-derived session state — Constitution §II core, still derived at request time.
- Any new poller or cadence change (the 30s branch tick and 90s collector tick are untouched).
- Frontend, SSE-payload, or API-surface changes (`SnapshotBranchPR`/`MapBranchState`/`PRStatus` contracts unchanged); `internal/sessions` is not modified.
- `internal/snapshot` refactors — its pattern is referenced, `internal/fsatomic` is already the shared write helper.
- Any `rk` CLI surface for the cache (it is invisible plumbing).
- Startup-time login verification via network or subprocess, and parsing `~/.config/gh/hosts.yml`.

### Design Decisions

#### Explicit persistence DTOs, not the in-memory structs
**Decision**: `prstatus_disk.go` defines private `disk*` DTOs with JSON tags and an integer `schema` field; the in-memory `PRStatus`/`ViewerPR`/`BranchPR` structs are converted at the boundary.
**Why**: the disk schema must not be coupled to in-memory struct evolution — adding an in-memory field would otherwise silently change the persisted shape, and a shape change must discard old caches cleanly via the version.
**Rejected**: marshalling the in-memory structs directly (couples disk format to refactors, and `PRStatus` carries no JSON tags today); a schema-less document (no clean discard path for a future shape change).
*Introduced by*: 260809-r4vk-pr-status-disk-seed

#### Seed-originated marking on entries AND on the index
**Decision**: `branchEntry` carries a `seeded` flag, and the head-index carries a store-level `seeded` flag; an entry resolved from a seed-originated index inherits the mark, while gh results, fresh-index hits, and default-branch exclusions clear it. Login-mismatch discard clears the `pr` of every still-marked entry.
**Why**: the wholesale collector rebuild does not touch branch entries, so they are the only state that can carry account A's data past a successful fetch as account B. Marking the index too closes the second path (a pair resolved from the *seeded* index is still account A's data).
**Rejected**: deleting seeded entries outright (loses the registration and its `observedAt`, forcing a first-sight re-register churn); a global seed epoch with no per-entry mark (cannot tell which entries a pass has already refreshed).
*Introduced by*: 260809-r4vk-pr-status-disk-seed

#### The cache assembles from live in-memory state, and the seed is loaded INTO it
**Decision**: the seed fills the collector's `byURL` **and** its last-good viewer-PR list, so the cache writer can always assemble the document from live in-memory state alone.
**Why**: writes fire from both background goroutines, and a branch-triggered write before the first successful fetch must not persist an empty collector half and destroy the seed it was just loaded from. Seeding both halves makes "last-good" uniformly true across the process boundary.
**Rejected**: having the writer fall back to the loaded document per-half (two sources of truth, and "empty" is ambiguous — a genuinely empty fetch result is indistinguishable from "not fetched yet"); writing only from the collector hook (branch entries, the thing that restores window PR glyphs, would then never be persisted after the refresher resolved them).
*Introduced by*: 260809-r4vk-pr-status-disk-seed

#### Load-time `observedAt`, preserved `FetchedAt`
**Decision**: seeded branch entries are stamped with a load-time `observedAt`; seeded `PRStatus` values keep their original `FetchedAt`.
**Why**: the two timestamps mean different things. `observedAt` is liveness (drives the 5-minute age-out) — a pre-restart value would let the first pass evict seeded entries before the ~2.5s SSE re-registration; `FetchedAt` is freshness, surfaced as the flyout's "checked Xs ago", where honesty is the point.
**Rejected**: preserving both (evicts the seed before it can be used); restamping both (the UI would claim just-fetched data it never fetched).
*Introduced by*: 260809-r4vk-pr-status-disk-seed

## Tasks

### Phase 1: Disk store

- [x] T001 Add `app/backend/internal/prstatus/prstatus_disk.go`: `DefaultCachePath()` (`$XDG_STATE_HOME/rk/prstatus.json` else `~/.local/state/rk/prstatus.json`), the `diskSchemaVersion`/`cacheFileMode` (0600)/`cacheDirMode` (0700) constants, the private `disk*` persistence DTOs with JSON tags, and the exported `SeedState`/`SeedBranchPR` in-memory seed shapes <!-- R1 R2 -->
- [x] T002 Add `Store` (path + last-written dedup key + mutex) with `NewStore(path)`, `Load() (SeedState, bool)` (absent/unreadable/malformed/schema-mismatch ⇒ empty + `slog.Debug`, never an error) and `Save(SeedState) (bool, error)` (MkdirAll 0700 → `fsatomic.WriteFile` 0600, content-dedup ignoring `savedAt`, branch entries sorted by `(repoDir, branch)`) in `app/backend/internal/prstatus/prstatus_disk.go` <!-- R1 R2 R3 --> <!-- rework: must-fix — Save's content-dedup key must ALSO zero Collector[*].FetchedAt (freshness, not change — mirrors snapshot.ContentEqual zeroing TakenAt): Collector.refresh re-stamps FetchedAt on every successful 90s pass, so the candidate always differs and the cache rewrites forever (~960 writes/day at idle), violating R3/A-017. Fix the dedup key in prstatus_disk.go Save (~:329-341) and correct the two now-false comments (prstatus_disk.go ~:326-328, prstatus_branch.go ~:1034-1036) -->

### Phase 2: Seed + save seams on the two pollers

- [x] T003 Add `viewer { login }` to `ghQuery`, carry `Login` through the response shape, and replace `parsePRs` with a parser returning both the login and the nodes, in `app/backend/internal/prstatus/prstatus.go` <!-- R8 -->
- [x] T004 On `Collector`: retain the last successful parse's `login` + `[]ViewerPR` (with `Login()`/`ViewerPRs()` accessors), add `Seed(byURL, viewerPRs)` (apply only while empty, `FetchedAt` preserved) and the nil-safe `onRefreshed` save hook + setter invoked at the tail of a successful `refresh`, in `app/backend/internal/prstatus/prstatus.go` <!-- R4 R7 -->
- [x] T005 On `BranchRefresher`: add the `seeded` field to `branchEntry`, `SeedEntries([]SeedBranchPR)` (positive only, load-time `observedAt`, never overwrite a present pair, no wake), `SeedViewerIndex` sharing `StoreViewerIndex`'s internals with a `viewerIndexSeeded` flag, `PositiveEntries()` for the writer, `DiscardSeeded()`, and the nil-safe `onRefreshed` save hook invoked at the tail of a pass, in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R5 R6 R7 R9 -->
- [x] T006 Propagate the seed mark through `refresh`'s three write points in `app/backend/internal/prstatus/prstatus_branch.go`: index hit inherits `viewerIndexSeeded`, gh result and default-branch exclusion clear it <!-- R5 R6 --> <!-- rework: should-fix — seed-provenance TOCTOU (prstatus_branch.go ~:984-995): viewerIndexPR reads the candidate, but e.seeded = r.viewerIndexSeeded is read in a LATER critical section; a collector pass + DiscardSeeded landing between them leaves an account-A entry unmarked and persisted under login B. Capture the seeded flag in the SAME mu section as the index lookup and carry it to the write. ALSO correct the now-false cold-start comments (prstatus_branch.go ~:793-800, ~:633-647): with SeedEntries the immediate first refresh is no longer a no-op, and seeded pairs never fire the first-sight wake (immediate pass covers them) -->

### Phase 3: Integration & Edge Cases

- [x] T007 Add `SeedCache` to `app/backend/internal/prstatus/prstatus_disk.go`: `NewSeedCache(store, collector, refresher)`, `Seed()` (load once → seed collector + refresher entries + seeded index), `Attach()` (install both save hooks), the collector-hook login-mismatch check (discard seed-originated entries once, then rewrite under the new login), and `AttachSeedCache(collector, refresher)` — the production one-liner that resolves the default path and degrades to `slog.Debug` on failure <!-- R6 R7 R9 R10 -->
- [x] T008 Wire `prstatus.AttachSeedCache(pc, prstatus.DefaultBranchRefresher)` in `NewRouterAndServer` (`app/backend/api/router.go`) after `SetViewerPRSink` and before `pc.Start(ctx)` / `DefaultBranchRefresher.Start(ctx)`, leaving every `NewTestRouter*` unwired <!-- R10 -->
- [x] T009 Add `refreshMu sync.Mutex` to `BranchRefresher` and hold it across the whole `refresh` pass in `app/backend/internal/prstatus/prstatus_branch.go`, documenting the `mu`/`refreshMu` split and the background-callers-only safety argument (mirrors `Collector`'s T019) <!-- R11 -->
- [x] T010 Tighten `parseOriginRepo` to exactly two non-empty path segments and correct its misleading deeper-path comment in `app/backend/internal/prstatus/prstatus_branch.go` <!-- R12 -->

### Phase 4: Governance

- [x] T011 Amend `fab/project/constitution.md` §II with the fresh `$XDG_STATE_HOME/rk/` carve-out paragraph (write-only recovery backups + never-authoritative startup seed caches) and set the Governance line to Version 1.7.0 / Last Amended 2026-08-09 <!-- R13 -->

### Phase 5: Tests

- [x] T012 [P] Add `app/backend/internal/prstatus/prstatus_disk_test.go`: path resolution (`XDG_STATE_HOME` set/unset), save→load round-trip (byURL with `FetchedAt` preserved, positive branch entries, viewer list, login), 0600/0700 modes (unix-guarded), corrupt/truncated/absent/schema-mismatch tolerance, write coalescing (identical ⇒ no write, changed ⇒ write), stable branch-entry ordering, and explicit `repoDir`/`branch` JSON fields <!-- R1 R2 R3 --> <!-- rework: must-fix companion — TestStoreWriteCoalescing must re-stamp FetchedAt between the two identical-state saves (as the real collector does every pass) so it actually proves the 90s tick produces no write; the current fixture holds FetchedAt fixed and gives false confidence -->
- [x] T013 [P] Add collector-side tests in `app/backend/internal/prstatus/prstatus_test.go`: `viewer { login }` parsing (present + absent), `Seed` preserves `FetchedAt` and never clobbers fetched state, `ViewerPRs()`/`Login()` reflect the last successful parse only, the save hook fires on success but not on gh error/unavailable/bad JSON, and a nil hook is a no-op <!-- R4 R7 R8 -->
- [x] T014 [P] Add refresher-side tests in `app/backend/internal/prstatus/prstatus_branch_test.go`: `SeedEntries` (positive only, load-time `observedAt` survives an immediate pass, never overwrites a present pair, no wake), seeded-index hits mark entries seed-originated while fresh-index/gh/exclusion results clear the mark, `DiscardSeeded` clears only still-marked entries, and the branch save hook fires at the tail of a pass <!-- R5 R6 R7 R9 -->
- [x] T015 [P] Add `SeedCache` tests in `app/backend/internal/prstatus/prstatus_disk_test.go`: seed-then-successful-fetch overwrites (including the authoritative-negative drop), a failed fetch keeps the seed, a login-mismatch fetch leaves no seed-originated entry serving and rewrites the cache under the new login, a matching login keeps them, and a branch-triggered save before any successful fetch does not lose the seeded collector half <!-- R6 R9 R10 -->
- [x] T016 [P] Add the single-flight test for `BranchRefresher.refresh` (concurrent tick/`RefreshNow` serialize inside the blocked gh exec) and extend `TestParseOriginRepo` with the depth table (proxy-prefixed GitHub path, GitLab subgroup, Bitbucket `/scm/`, and the unchanged two-segment forms) in `app/backend/internal/prstatus/prstatus_branch_test.go` <!-- R11 R12 -->
- [x] T017 Run `cd app/backend && go test -count=1 ./internal/prstatus/... ./api/...`, then `go test -race -count=1 ./internal/prstatus/...`, then `just test-backend` from the repo root; fix any failures <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 --> <!-- rework: verification for rework cycle 1 -->

## Execution Order

- T001 → T002 (same new file); T003 → T004 (the collector's retained login comes from the new parser)
- T005 → T006 (the mark must exist before `refresh` propagates it)
- T007 depends on T002, T004, T005; T008 depends on T007
- T009 and T010 are independent of everything above (same file as T005/T006 — sequence them after to avoid edit conflicts)
- T011 is independent of all code tasks
- T012–T016 depend on their respective implementation tasks; T017 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: the store persists one JSON file at `$XDG_STATE_HOME/rk/prstatus.json` (else `~/.local/state/rk/prstatus.json`) through `fsatomic.WriteFile`, with a 0600 file and a 0700 directory
- [x] A-002 R2: the document carries an integer `schema`, a `login`, a `savedAt`, the collector map, the viewer-PR list, and branch entries as explicit `repoDir`/`branch` fields — built from private DTOs, not the in-memory structs
- [x] A-003 R3: `Save` skips the write when content matches the last write ignoring `savedAt`, reports whether it wrote, and serializes equal state to equal bytes
- [x] A-004 R4: the collector's `byURL` and last-good viewer list seed from disk with `FetchedAt` preserved, and a seed never clobbers fetched state
- [x] A-005 R5: positive branch entries seed with a load-time `observedAt`, never overwrite a present pair, and the head-index seeds through the same rules as `StoreViewerIndex` with a seed-originated flag
- [x] A-006 R7: the disk read happens once at startup and writes fire only from the collector/branch background passes via nil-safe hooks
- [x] A-007 R8: `ghQuery` selects `viewer { login }` with unchanged states/ordering/limit, and the login is carried through parsing
- [x] A-008 R9: the cache records the last successful fetch's login, seeds unconditionally, and discards seed-originated branch entries at the first successful fetch reporting a different login
- [x] A-009 R10: `NewRouterAndServer` seeds and attaches before starting either poller; every `NewTestRouter*` stays unwired
- [x] A-010 R11: `BranchRefresher.refresh` holds a pass-level `refreshMu` distinct from `mu`
- [x] A-011 R12: `parseOriginRepo` accepts exactly two non-empty path segments and fails open otherwise
- [x] A-012 R13: Constitution §II carries the `$XDG_STATE_HOME/rk/` carve-out for both classes, and the Governance line reads Version 1.7.0 with an updated Last Amended date

### Behavioral Correctness

- [x] A-013 R6: a successful collector fetch replaces seeded state wholesale, including dropping a seeded PR absent from the new batch
- [x] A-014 R6: a failed fetch (gh error, unavailable gh, malformed JSON) leaves seeded state serving — stale-while-revalidate across the process boundary
- [x] A-015 R6: a successfully parsed empty `gh pr list` and the default-branch exclusion still clear a seeded entry (authoritative negatives win)
- [x] A-016 R5: an entry resolved from a seed-originated index is marked seed-originated; one resolved from a fresh index, the gh path, or the exclusion is not
- [x] A-017 R3: the 30s/90s ticks produce no write when nothing changed
- [x] A-018 R12: every previously-accepted two-segment origin form normalizes exactly as before

### Scenario Coverage

- [x] A-019 R1 R2: tests cover path resolution with and without `XDG_STATE_HOME`, the save→load round trip, and the 0600/0700 modes
- [x] A-020 R2: tests cover malformed JSON, a truncated document, a wrong `schema`, and an absent file all yielding an empty seed with no error
- [x] A-021 R9: a test proves a cache written as login A seeds, a successful fetch as login B leaves no seed-originated entry serving, and the rewritten cache carries login B
- [x] A-022 R6: tests prove seed-then-successful-fetch overwrite (including the authoritative-negative drop) and seed survival across a failed fetch
- [x] A-023 R3: a test proves two identical saves produce one write and a changed state writes again
- [x] A-024 R11: a test proves concurrent `refresh`/`RefreshNow` passes serialize, so the stale-empty-clobbers-fresh-positive interleaving is no longer constructible
- [x] A-025 R12: a table test covers the proxy-prefixed GitHub path, a GitLab subgroup, a Bitbucket `/scm/` path, and the unchanged accepted forms

### Edge Cases & Error Handling

- [x] A-026 R2: a write failure is a debug log and nothing more — never an error surfaced to a caller, never a crash
- [x] A-027 R5: a seeded entry survives the first refresh pass (load-time `observedAt`), so the ~2.5s SSE re-registration window cannot evict it
- [x] A-028 R9: an empty login on either side is not treated as a mismatch, and a handled mismatch is not re-handled on later passes
- [x] A-029 R7: a branch-triggered save before any successful collector fetch does not persist an empty collector half over the loaded seed
- [x] A-030 R10: a path-resolution or load failure degrades to a debug log and an unseeded start

### Code Quality

- [x] A-031 Pattern consistency: the store follows `internal/snapshot/store.go`'s shape (`DefaultDir`-style path resolver, `fsatomic.WriteFile`, content dedup ignoring the timestamp) and the seams follow the established nil-safe-field + package-var/per-instance stub pattern
- [x] A-032 No unnecessary duplication: `internal/fsatomic.WriteFile` is reused rather than re-implemented, and `SeedViewerIndex` shares `StoreViewerIndex`'s store/skip/key logic instead of copying it
- [x] A-033 Named constants: the schema version, file/dir modes, and file name are named constants, not inline literals
- [x] A-034 Exec discipline (§I): no new subprocess is introduced; file IO uses `os`/`fsatomic` with no shell string
- [x] A-035 Hot-path purity: `Register`/`Snapshot`/`SnapshotBranchPR`/`attachPRStatus` remain zero-subprocess, zero-IO
- [x] A-036 Derived-state discipline (§II): the cache is discardable at any time with no behavior change beyond cold-start latency, and is legitimized by this change's own §II amendment
- [x] A-037 Tests for changed behavior: colocated Go tests cover every new/changed behavior, `go test -race ./internal/prstatus/...` is clean, and `just test-backend` is green
- [x] A-038 No frontend or API-surface change: SSE payloads, `SnapshotBranchPR`/`MapBranchState`/`PRStatus` contracts, and `internal/sessions` are untouched

### Security

- [x] A-039 R1: the cache file is created 0600 and its directory 0700 (umask-respecting, never widened by an explicit chmod) — PR metadata is private-repo data

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Three-part scope in one change: disk-seed cache + Constitution §II amendment + the two #542 should-fixes | Prescribed verbatim by the intake's § What Changes and assumption 1 | S:95 R:80 A:90 D:95 |
| 2 | Certain | Store shape: single `prstatus.json` under the snapshots' state root, `fsatomic.WriteFile`, 0600/0700, private DTOs + integer `schema`, content-dedup ignoring `savedAt`, silent empty start on any load problem | Intake mandates every one of these values; only naming was open | S:90 R:85 A:90 D:90 |
| 3 | Confident | Exported seam names: `SeedState`/`SeedBranchPR` (in-memory shapes), `Store`/`NewStore`/`Load`/`Save`, `SeedCache` (load-and-seed + save orchestration), and the `AttachSeedCache(collector, refresher)` production one-liner | Intake leaves file naming and DTO/seam shape to the plan; a `SeedCache` owns the only state that spans both pollers (the seed login), and a one-liner keeps `router.go` thin while the pieces underneath stay unit-testable | S:60 R:85 A:85 D:70 |
| 4 | Confident | Seed-discard mechanism: a per-entry `seeded` flag on `branchEntry` PLUS a store-level `viewerIndexSeeded` flag, so an entry resolved from the SEEDED index inherits the mark; discard clears the `pr` of every still-marked entry rather than deleting it | Intake grants explicit latitude here ("per-entry seed mark vs. a seed-epoch") and fixes only the requirement that no account-A seed survives a successful fetch as account B; marking the index too closes the second seed-origination path, and clearing `pr` (not the entry) avoids losing the registration/`observedAt` and the first-sight wake churn a delete would cause | S:65 R:85 A:85 D:70 |
| 5 | Confident | The collector's last-good `[]ViewerPR` is seeded from disk too (not only `byURL`), so the cache writer always assembles from live in-memory state | Intake mandates persisting the viewer list and seeding the index from it, but does not say where the writer reads it from; without seeding the collector's own last-good list, a branch-triggered write before the first successful fetch would persist an empty collector half over the seed it was just loaded from | S:55 R:85 A:90 D:75 |
| 6 | Confident | Save hooks fire at the TAIL of a successful collector pass and at the tail of a branch pass that had pairs to resolve (`len(todo) == 0` early-returns without saving); the collector hook additionally performs the login-mismatch check | Intake requires "only on the background goroutines after successful refresh passes" and coalesced writes; content-dedup makes an extra no-change call harmless, and only the collector can observe a login | S:60 R:85 A:85 D:75 |
| 7 | Confident | Seeded branch entries are stamped with a load-time `observedAt`; seeded `PRStatus` keeps its original `FetchedAt`; seeding the index does NOT signal the wake channel | The first two are prescribed by the intake (assumption 7); the wake is explicitly noted as harmless-either-way there, and skipping it avoids one spurious no-op pass at startup since no pair is registered yet | S:70 R:90 A:85 D:80 |
| 8 | Confident | `parsePRs` is replaced by a parser returning the viewer login alongside the nodes (rather than a second unmarshal for the login), updating the three existing test call sites | Intake requires carrying `viewer.login` "through `ghResponse` parsing" but not the function shape; one decode is the honest reading and Test Integrity has tests conform to the implementation spec | S:65 R:90 A:90 D:80 |
| 9 | Certain | `refreshMu` held across the whole `BranchRefresher.refresh` pass, distinct from `mu`, mirroring Collector T019; both callers are background goroutines so blocking is safe | Prescribed by the intake ("mirrors T019 exactly") and already proven on the collector | S:85 R:85 A:90 D:90 |
| 10 | Certain | `parseOriginRepo` requires exactly two non-empty segments; deeper/shallower ⇒ `ok=false` (fail open), and the misleading comment is corrected | Prescribed by the intake with the exact rule and handling; every rejection is correct-but-unoptimized | S:85 R:85 A:90 D:90 |
| 11 | Confident | The §II amendment is one fresh paragraph covering both classes (write-only recovery backups + startup seed caches), appended to §II with its core rule left intact; version 1.7.0, Last Amended 2026-08-09 | Intake prescribes the substance, the minor bump, and the date-per-Governance-line, with explicit wording latitude; no existing carve-out style exists to match | S:70 R:80 A:85 D:75 |
| 12 | Certain | Invariants preserved: SSE hot path zero-subprocess/zero-IO, stale-while-revalidate end-to-end (authoritative negatives always win), #542 machinery untouched beyond the two should-fixes, §I file-IO-without-shell, cadences unchanged, no frontend/API change | Enumerated as hard constraints in the intake's § Invariants preserved and verified against the current source | S:90 R:80 A:95 D:90 |
| 13 | Certain | Tests are colocated Go tests (new `prstatus_disk_test.go` plus additions to the two existing files) using `t.TempDir()` for the store; gates are the scoped `go test`, `-race`, then `just test-backend` | Intake § Tests names the files, the list, and the gate verbatim; `code-quality.md` mandates colocated tests for changed behavior | S:90 R:90 A:90 D:90 |
| 14 | Certain | The dedup key zeroes both freshness stamps (document `savedAt` + every collector entry's `fetchedAt`) in a `dedupKey` helper over a COPY, while the written document keeps its real `fetchedAt`; genuine content timestamps (a PR's `updatedAt`) stay in the key | Rework annotation prescribes zeroing `Collector[*].FetchedAt`, but not whether the on-disk value follows: R4 requires `FetchedAt` preserved for the flyout's "checked Xs ago", and the cited `snapshot.ContentEqual` precedent likewise compares a zeroed copy while writing the real `TakenAt`. Consequence: a coalesced file reports the last pass that changed content (conservatively older), self-correcting at the next real change | S:75 R:90 A:90 D:85 |
| 15 | Certain | The seed provenance is carried as a third return value from `viewerIndexPR` (`pr, seeded, hit`), read in the same `mu` section as the candidate, rather than re-read at the write point or hoisted into a wider lock | Rework annotation prescribes the capture-and-carry mechanism but not the shape; returning it beside the value it describes keeps `mu` off the origin-resolving subprocess (the reason the lookup is split into two critical sections in the first place) and needs no new struct | S:70 R:90 A:85 D:80 |

15 assumptions (8 certain, 7 confident, 0 tentative).

## Deletion Candidates

- `AttachSeedCache`'s `*SeedCache` return value (`app/backend/internal/prstatus/prstatus_disk.go:532`) — the sole call site (`app/backend/api/router.go:524`) discards it and no test binds it; the doc comment's "for callers that want it" has no caller. Drop the return unless a follow-up needs the handle.
- `diskState.SavedAt` (`app/backend/internal/prstatus/prstatus_disk.go:131`) — written on every save, zeroed in the dedup key, and never read back by `seedState()`/`Load`. It is pure human-inspection payload; keep only if that is the intent (it is documented as such), else it is dead field.
- `SeedCache`'s nil-receiver guards (`prstatus_disk.go:421`, `:448`, `:496`) — `AttachSeedCache` returns `nil` *without* having called `Seed`/`Attach`, so no production path ever invokes a method on a nil `*SeedCache`; the guards are exercised only by `TestSeedCacheNilAndMissingFileAreNoOps`. Harmless, but they are defensiveness with no caller.
- `parsePRs` was not made redundant — it was *replaced* by `parseBatch` in this change (no residual call sites; the two test call sites were migrated).
- Nothing else became redundant: the store is net-new, `internal/snapshot` and `internal/fsatomic` are untouched, and both #542 should-fixes tightened existing functions rather than superseding them.
