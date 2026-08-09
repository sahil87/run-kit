# Intake: PR-Status Disk Seed Across Restarts

**Change**: 260809-r4vk-pr-status-disk-seed
**Created**: 2026-08-09

## Origin

Promptless dispatch (deferred questioning) from a `/fab-proceed`-style pipeline invocation, using a synthesized change description. This is the agreed **second change of a two-change series**: the first, `260807-2ept-pr-status-cold-start` (merged as PR #542, commit `e0a473fc`, archived at `fab/changes/archive/2026/08/260807-2ept-pr-status-cold-start/`), fixed PR-status cold-start latency **in-memory** — a registration/seed wake seam on `BranchRefresher` plus a viewer head-index seeded from the `Collector`'s batched GraphQL call, demoting per-pair `gh pr list` to fallback-on-miss. That change's intake explicitly deferred disk persistence to "a separate future change (`pr-status-disk-seed`) with its own constitution carve-out" — this is that change.

> **Problem**: After #542, a restart is fast only when gh is responsive at startup. Every `rk serve` restart (routine — self-update restarts) still starts with EMPTY PR-status state: if gh is slow, offline, or rate-limited at that moment, sidebar/window PR glyphs and status dots stay blank/stale until the first successful batched fetch. The user explicitly wants restart behavior improved by caching PR status on disk, the way run-kit already persists tmux layout snapshots every 60s for server-death recovery.
>
> **Agreed design (three parts, one change)**: (1) disk-seed the prstatus state across restarts — stale-while-revalidate only, keyed by gh viewer login, under the same `$XDG_STATE_HOME/rk/` state root the layout snapshots use; (2) a Constitution §II carve-out amendment legitimizing the cache (deliberately excluded from #542 to keep governance edits separately reviewable); (3) fold in the two open should-fixes from #542's review — single-flight `BranchRefresher.refresh` and `parseOriginRepo` exact-two-segment tightening.

The archived change's intake.md/plan.md, the current `app/backend/internal/prstatus/` source, `docs/memory/run-kit/architecture.md` §§ PR-Status SSE Join / Branch→PR Derivation, `docs/memory/run-kit/layout-snapshots.md`, `internal/snapshot/store.go`, and `fab/project/constitution.md` were all read before writing this intake. Both should-fix defects were re-verified in the current source (see § What Changes 5–6).

## Why

1. **The pain point**: #542 made cold start fast *when gh answers promptly at startup* — the collector's immediate batched fetch seeds the head-index within seconds and the wake-driven first branch pass joins against it. But the whole mechanism is network-gated: on a restart where gh is slow, offline, or rate-limited, there is **nothing to seed from**, so every sidebar/window PR glyph and status dot is blank (or, for state the frontend caches, stale) until the first successful fetch — which can be minutes away (rate-limit windows) or indefinitely away (offline). Restarts are routine: `rk serve` restarts on every self-update.

2. **The precedent**: run-kit already persists derived tmux state to disk for exactly this class of problem — `internal/snapshot` writes per-server layout snapshots to `$XDG_STATE_HOME/rk/snapshots` (atomic temp+rename via `internal/fsatomic`, content-dedup so unchanged state never rewrites) so a server death is recoverable. The PR-status cache follows the same store pattern at a smaller scale, with one deliberate difference: snapshots are **write-only** (no request-time read path), while this cache is **read-once-at-startup** (a seed) — which is why it needs its own constitution carve-out rather than riding the snapshots precedent silently.

3. **Why stale-while-revalidate seeding over alternatives**:
   - The prstatus package is *already* stale-while-revalidate end-to-end: a failed gh call keeps the last-good map/index/entries, and only a successfully parsed result overwrites. Seeding "last-good" from disk at startup is the same semantics extended across the process boundary — the collector's immediate first refresh and the #542 wake/index machinery then replace it with fresh data exactly as they do today. No new poller, no cadence change, no authority change.
   - **Rejected: making the cache authoritative** (serving it without revalidation) — violates the derive-don't-store model (Constitution §II); the cache must be discardable at any time with no behavior change beyond cold-start latency.
   - **Rejected: startup-time login verification via network/subprocess** (`gh api user`, `gh auth status` parse) — the seed exists precisely for when gh is slow/offline at startup, so verification cannot block on it; parsing `~/.config/gh/hosts.yml` was also rejected (gh-internal file format, not a public contract). Instead the login recorded at the last successful fetch is compared at the **next** successful fetch (see § What Changes 3) — safe because the seed is never authoritative in the interim.
   - **Rejected: deferring the two #542 should-fixes to a third change** — same package, small, review-confirmed (recorded in project memory as PR #542 open should-fixes); folding them in here closes the series.

4. **If we don't fix it**: every restart under degraded gh re-pays the blank-status window #542 was built to eliminate, and the two known #542 races stay live (a stale parsed-empty pass can blank a just-resolved PR glyph until the next pass; a deep-path origin can wrongly join the viewer index).

## What Changes

Parts 1, 3, 5, 6 are in `app/backend/` (backend only — no frontend, API-surface, or SSE-payload changes). Part 4 amends `fab/project/constitution.md`.

### 1. Disk store for prstatus state (`internal/prstatus`)

A small file store colocated in the `prstatus` package (new file, e.g. `prstatus_disk.go`), following `internal/snapshot/store.go`'s established pattern:

- **Location**: one JSON file under the same state root the snapshots use — `$XDG_STATE_HOME/rk/prstatus.json` when `XDG_STATE_HOME` is set, else `~/.local/state/rk/prstatus.json` (uniform across platforms, mirroring `snapshot.DefaultDir()` minus the subdirectory — one viewer-wide cache needs no per-server fan-out, no history, no tombstones).
- **Atomicity**: all writes go through the shared `internal/fsatomic.WriteFile` (temp file in the same directory + atomic rename — the helper all file stores already use).
- **Permissions**: conservative — `0600` file, `0700` for any directory this change creates (PR metadata is private-repo data; deliberately tighter than the snapshots' 0644/0755).
- **Schema**: explicit persistence DTOs with JSON tags plus a top-level integer `schema` version field, so a future shape change discards old caches cleanly (version mismatch ⇒ treat as absent). Persisting the in-memory structs directly is rejected — the disk schema must not be coupled to in-memory struct evolution. Sketch:

```json
{
  "schema": 1,
  "login": "sahil87",
  "savedAt": "2026-08-09T10:00:00Z",
  "collector": { "https://github.com/sahil87/run-kit/pull/542": { "number": 542, "url": "…", "state": "merged", "isDraft": false, "checks": "pass", "reviewDecision": "approved", "fetchedAt": "2026-08-09T09:58:00Z" } },
  "viewerPRs": [ { "number": 542, "url": "…", "state": "MERGED", "headRepo": "sahil87/run-kit", "headRef": "260807-2ept-pr-status-cold-start", "updatedAt": "…" } ],
  "branchPRs": [ { "repoDir": "/home/sahil/code/sahil87/run-kit", "branch": "260807-2ept-…", "pr": { "number": 542, "url": "…", "state": "MERGED", "updatedAt": "…", "isDraft": false } } ]
}
```

- **What is persisted** (covers both halves of the runtime state, per the agreed design):
  - the `Collector`'s `byURL` snapshot (map of `PRStatus`, **`FetchedAt` preserved** — see part 2),
  - the `BranchRefresher`'s **positive** `(repoDir, branch) → BranchPR` entries — what restores window PR glyphs (`PrURL`/`PrNumber`) immediately. Negative entries (resolved "no PR") are NOT persisted: a seed exists to fill blanks, and a negative re-derives cheaply. Entries are persisted as explicit `repoDir`/`branch` fields, never the internal NUL-joined cache key,
  - the `[]ViewerPR` head-index list, so the index is warm pre-fetch (an index-served first pass works even before the first successful collector fetch).
- **Read/write discipline**: the disk read happens **once at startup** (before `Start`); writes happen **only on the background collector/refresher goroutines after successful refresh passes**, never on the SSE hot path (`Register`/`Snapshot`/`attachPRStatus` are untouched). Writes are coalesced by **content-dedup**: marshal the candidate state and skip the write when it equals what was last written (ignoring `savedAt` — the same freshness-only-skip rule as `snapshot.ContentEqual`), so the 30s/90s ticks produce no write storms when nothing changed.
- **Failure posture**: a corrupt, unreadable, absent, version-mismatched, or login-mismatched cache file ⇒ start empty, silently (at most one `slog.Debug` line) — never an error, never a crash. A failed write is likewise a debug-level log and nothing more.

### 2. Startup seed (stale-while-revalidate, never authoritative)

On startup, load the cache and seed the in-memory structures **before** the first network fetch:

- Seed `Collector.byURL` from `collector`, with each entry's **original `FetchedAt` preserved, not reset** — the flyout's "checked Xs ago" line then reports honest staleness, and the first successful refresh stamps fresh times as it always has.
- Seed the `BranchRefresher`'s entries from `branchPRs` (positive `pr` values only). Each seeded entry's `observedAt` is stamped at **load time** (not preserved): `observedAt` is a *liveness* field driving the 5-minute age-out, not a freshness field — preserving a pre-restart timestamp would let the first refresh pass delete seeded entries before the SSE enrichment loop (~2.5s) has re-registered the live ones. Load-time stamping keeps every seeded entry serveable for one `branchPRObservedTTL` window; entries for windows that no longer exist age out exactly like any unobserved pair.
- Seed the viewer head-index from `viewerPRs` (via `StoreViewerIndex` or a direct equivalent — plan's choice; note `StoreViewerIndex` signals the wake channel on a non-empty store, which is harmless at load time: no pairs are registered yet, so a woken pass no-ops).
- **The disk cache is NEVER authoritative**: the collector's immediate first refresh and the #542 wake/index machinery replace seeded state with fresh data exactly as they replace stale in-memory state today. A fresh gh result — **including an authoritative negative** (a wholesale `byURL` rebuild dropping a PR; a parsed-empty `gh pr list`; the default-branch exclusion) — always overwrites seeded state. The seed only fills the blank-status window between process start and the first successful fetch, and it never suppresses or delays any fetch.

**Wiring**: in `api.NewRouterAndServer`, load-and-seed runs after constructing `pc` and before `pc.SetViewerPRSink(...)` / `pc.Start(ctx)` / `DefaultBranchRefresher.Start(ctx)`; the write hooks attach to the collector/refresher (e.g. an optional store reference or save-callback field, nil ⇒ no-op, mirroring the `onViewerPRs` sink pattern). `NewTestRouter` stays unwired — unit tests never touch the real state dir; store tests use `t.TempDir()`. The store type itself lives in `internal/prstatus`, so no new import edge appears in `api` (the snapshots' "api imports no `internal/snapshot`" boundary is about the *snapshot* package and is untouched).

### 3. Keyed by gh viewer login (account-switch invalidation)

- Extend the batched GraphQL query with `viewer { login }` — the query already selects on `viewer`; add the `login` field alongside `pullRequests` and carry it through `ghResponse` parsing. States/ordering/limit are unchanged.
- Persist the login (from the last successful fetch) in the cache file. **Discard the seed when it doesn't match the current login.** Since startup-time verification would need a network call or a subprocess (rejected in § Why 3), the comparison happens at the **next successful fetch**: when a successful parse reports a `viewer.login` different from the cache's login, any still-seeded state is discarded at that point — the collector's `byURL` and the head-index are already replaced wholesale by that very fetch, so the discard concretely means clearing the `BranchRefresher`'s **seed-originated** entries (which a wholesale mechanism does not touch) and rewriting the cache under the new login. The plan has latitude on the discard mechanism (per-entry seed mark vs. a seed-epoch/generation flag cleared entry-by-entry as fresh results land); the requirement is that no seed-originated entry from account A survives a successful fetch as account B.
- This is safe *because* the seed is stale-while-revalidate: in the window before the first successful fetch, wrong-account data is at worst stale display — exactly what any pre-switch stale in-memory state would have been — and it can never suppress a fetch or write back as fresh.

### 4. Constitution §II carve-out amendment (`fab/project/constitution.md`)

Verified against the current constitution (v1.6.0, Last Amended 2026-07-18): **§II carries no snapshot carve-out line today** — the layout-snapshots store's "write-only backup, not a state store" categorization lives only in `docs/memory/run-kit/layout-snapshots.md`. So the amendment is drafted fresh (there is no existing carve-out style to match), and it should legitimize the whole `$XDG_STATE_HOME/rk/` category in one move — the existing write-only snapshots AND the new startup seed cache. Draft (final wording has latitude; substance does not):

> Two bounded disk carve-outs exist under `$XDG_STATE_HOME/rk/`: **write-only recovery backups** (layout snapshots — artifacts about the past, never read at request time) and **startup seed caches**, which MAY pre-fill in-memory derived state at process start but are NEVER authoritative — state is still derived from tmux, the filesystem, and gh; a fresh derivation always overwrites a seeded value, and deleting any of these files changes nothing but cold-start latency.

- Bump the version **minor**: 1.6.0 → 1.7.0; set **Last Amended** to this change's ship date, per the Governance line.
- This amendment is part of THIS change — it was deliberately excluded from #542 to keep governance edits separately reviewable.

### 5. Should-fix (a): single-flight `BranchRefresher.refresh`

`Collector.refresh` got a `refreshMu` in #542 (T019) but `BranchRefresher.refresh` did not. **Confirmed race in the current source** (`prstatus_branch.go` — `refresh` has no pass-level mutex; `Start`'s tick/wake goroutine and `RefreshNow` — invoked from the detached goroutine behind `POST /api/status/refresh` — can run passes concurrently): a tick pass blocked in `gh pr list` (up to the 10s `ghTimeout`) can return a stale parsed-empty result and clear an entry that a concurrent wake/forced pass just resolved positively from the index — the PR glyph blanks until the next pass.

Fix mirrors T019 exactly: a `refreshMu sync.Mutex` held across the whole pass (including subprocesses), distinct from `mu` (which guards the maps for hot-path readers and is never held across a subprocess). Blocking is safe for the same reason it was on the collector: both callers are background goroutines — the tick owns its own goroutine and `RefreshNow` is never invoked inline in a handler.

### 6. Should-fix (b): tighten `parseOriginRepo` to exactly two path segments

**Confirmed defect in the current source** (`prstatus_branch.go:310–316`): `parseOriginRepo` keeps the LAST two segments of an arbitrarily deep path, so `https://github.com/proxy/acme/tool.git` normalizes to `github.com/acme/tool` and can wrongly join the viewer index — attaching a wrong PR while suppressing the authoritative gh fallback (same defect class as #542's fixed M2 host-mismatch, narrower trigger). Deeper-than-two paths (GitLab subgroups, Bitbucket `/scm/` prefixes) can never legitimately join a GitHub/GHE index entry — GitHub/GHE repo paths are exactly `owner/name`.

Fix: require the (`.git`/trailing-slash-trimmed) path to split into **exactly two** non-empty segments; anything deeper (or shallower) reports `ok=false` — fail open to the per-pair gh fallback, which is always correct, just not free. The function's misleading "a deeper path still ends in owner/name" comment is corrected. All currently-accepted two-segment forms (`https`, `ssh://` with port, scp-like, `git://`, with/without `.git`) are unchanged.

### 7. Tests

Colocated Go tests extending the existing seam patterns (`prstatus_test.go`, `prstatus_branch_test.go`, new `prstatus_disk_test.go` or similar; store tests run against `t.TempDir()`):

- **Store round-trip**: save → load reproduces byURL entries (FetchedAt preserved), positive branch entries, viewer-PR list, and login.
- **Atomic write**: writes route through `fsatomic.WriteFile`; file/dir modes are 0600/0700.
- **Corrupt-file tolerance**: malformed JSON, truncated file, wrong `schema` version, absent file ⇒ load yields empty state, no error surfaced.
- **Login-mismatch discard**: a cache written as login A seeds; the next successful fetch reporting login B leaves no seed-originated branch entry serving, and the rewritten cache carries login B.
- **Seed-then-refresh-overwrite**: seeded byURL/entries/index are replaced by a successful fetch (including a fetch that drops a seeded PR — the authoritative-negative case); a FAILED fetch leaves the seed in place (stale-while-revalidate).
- **Write coalescing**: two successful refreshes with identical state produce one disk write (content-dedup); a changed state writes again.
- **Single-flight**: concurrent `refresh` invocations on `BranchRefresher` serialize (mirroring the collector's T019 coverage) — the stale-empty-clobbers-fresh-positive interleaving is no longer constructible.
- **`parseOriginRepo` depth table**: exactly-two accepted forms unchanged; `github.com/proxy/acme/tool`, GitLab subgroup, and Bitbucket `/scm/` shapes all `ok=false`.
- Gate: `just test-backend` green (scoped `./internal/prstatus/...` first). No frontend changes, no new e2e.

### Invariants preserved (verified against code + constitution)

- **SSE hot path stays zero-subprocess/zero-IO** — the disk read happens once at startup; all writes ride the existing background collector/refresher goroutines. `Register`/`Snapshot`/`attachPRStatus` are untouched.
- **Stale-while-revalidate end-to-end** — the seed never suppresses or delays a fetch; a fresh result (including an authoritative negative) always overwrites seeded state; a failed fetch keeps last-good (seeded or otherwise).
- **The #542 machinery is untouched except where the two should-fixes land** — wake seam, viewer index, host-qualified identity, default-branch exclusion, lazy availability probe, miss-never-negative all preserved.
- **Constitution §I** — no new subprocess is introduced; file IO uses `os`/`fsatomic`, no shell.
- **Constitution §II** — the cache is legitimized by this change's own §II amendment (part 4); it is discardable at any time with no behavior change beyond cold-start latency.
- **Steady-state cadences unchanged** — no new poller, the 30s/90s ticks are untouched; the store only adds coalesced writes after passes that changed state.

### Explicitly out of scope

- Persisting tmux-derived session state (Constitution §II core — still derive-at-request-time).
- Any new poller or cadence change.
- Frontend changes (SSE payload shapes, `SnapshotBranchPR`/`MapBranchState` contracts unchanged).
- `internal/snapshot` refactors — its pattern is referenced, and `internal/fsatomic` is already the shared write helper; a further shared helper is acceptable only if it does not change snapshot behavior.
- Any `rk` CLI surface for the cache (snapshots have `rk snapshot`; this cache is invisible plumbing).

## Affected Memory

- `run-kit/architecture`: (modify) §§ PR-Status SSE Join / Branch→PR Derivation — disk-seed store (location, schema/version, login keying, write coalescing), startup seed semantics (stale-while-revalidate, FetchedAt preserved, observedAt restamped), `BranchRefresher.refresh` single-flight, `parseOriginRepo` exact-two-segment rule (drops the "deeper path still ends in owner/name" claim and updates the known index-miss classes).

## Impact

- `app/backend/internal/prstatus/prstatus_disk.go` (new) — store: DefaultPath, load/save, DTOs, schema version, content-dedup.
- `app/backend/internal/prstatus/prstatus.go` — `viewer { login }` query field + response parsing, seed entry point for `byURL`, save hook after successful refresh, login-mismatch handling.
- `app/backend/internal/prstatus/prstatus_branch.go` — seed entry point for entries/index, `refreshMu` single-flight, `parseOriginRepo` tightening, save hook after successful refresh, seed-discard on login mismatch.
- `app/backend/api/router.go` — load-and-seed + store wiring in `NewRouterAndServer` before `Start`; `NewTestRouter` unwired.
- `app/backend/internal/prstatus/prstatus_test.go`, `prstatus_branch_test.go`, new disk-store test file — coverage per § Tests.
- `fab/project/constitution.md` — §II amendment, version 1.7.0, Last Amended date.
- No API surface, SSE payload, or frontend changes; `internal/sessions` and `internal/snapshot` untouched.

## Open Questions

- None — the synthesized description resolves all consequential design decisions; remaining latitude (file naming, DTO shapes, seed-discard mechanism, amendment wording) is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Three-part scope in one change: disk-seed cache + Constitution §II amendment + the two #542 should-fixes (single-flight refresh, parseOriginRepo tightening) | Prescribed verbatim by the dispatch description ("Agreed design (three parts, one change)") | S:95 R:80 A:90 D:95 |
| 2 | Certain | Seed is pure stale-while-revalidate: never authoritative, never suppresses/delays a fetch, a fresh result (incl. authoritative negatives) always overwrites; corrupt/absent/mismatched cache ⇒ silent empty start (debug log at most) | Stated as hard constraints in the description and consistent with the package's existing last-good semantics | S:95 R:85 A:95 D:95 |
| 3 | Confident | Persist all three pieces: `byURL` snapshot + positive `(repoDir, branch) → BranchPR` entries + the `[]ViewerPR` head-index list; negatives not persisted | Description sets the minimum (both halves) and explicitly blesses persisting the ViewerPR list; a warm index maximizes pre-fetch glyph coverage at trivial size cost | S:70 R:80 A:85 D:70 |
| 4 | Confident | Store lives in `internal/prstatus` (single file `$XDG_STATE_HOME/rk/prstatus.json`, `fsatomic.WriteFile`, 0600/0700, explicit persistence DTOs + integer `schema` field) | Description mandates the state root, perms, JSON, and a schema/version field but leaves file naming and DTO shape open; a single viewer-wide file mirrors `snapshot.DefaultDir()` minus per-server fan-out; DTOs decouple disk schema from struct evolution | S:60 R:85 A:85 D:70 |
| 5 | Confident | Login keying: `viewer { login }` added to the batched query; cache carries login; startup seeds unconditionally; mismatch detected at the NEXT successful fetch discards remaining seed-originated state and rewrites the cache | Description explicitly permits deferred comparison when startup verification would need a network call ("acceptable… since the seed is stale-while-revalidate anyway"); startup subprocess/hosts.yml-parse alternatives rejected in § Why | S:70 R:80 A:85 D:70 |
| 6 | Confident | Write cadence: save attempted only after successful refresh passes on the background goroutines, coalesced via content-dedup (marshal-compare ignoring `savedAt`, mirroring `snapshot.ContentEqual`); write failures are debug-level | Description requires "debounced/coalesced (no write storms…) — content-dedup or dirty-flag" and background-only writes; content-dedup is the established in-repo pattern and is cheap at 30s/90s cadence | S:65 R:85 A:80 D:75 |
| 7 | Confident | Seeded branch entries get `observedAt` stamped at load time (PRStatus `FetchedAt` IS preserved, per the description) | FetchedAt preservation is mandated; observedAt is unaddressed — it is a liveness field driving the 5-min age-out, and preserving a pre-restart value would let the first pass delete seeded entries before SSE re-registration (~2.5s) bumps the live ones | S:55 R:90 A:80 D:70 |
| 8 | Confident | Wiring: load-and-seed + store hooks in `NewRouterAndServer` before `pc.Start(ctx)`/`DefaultBranchRefresher.Start(ctx)`; `NewTestRouter` stays unwired; hooks are nil-safe fields mirroring the `onViewerPRs` sink pattern | The collector/refresher are constructed and started there (verified router.go:500–521); the store lives in `internal/prstatus` so no new api import edge; unwired-test posture matches #542's sink wiring | S:60 R:85 A:85 D:75 |
| 9 | Certain | §II amendment drafted fresh (verified: v1.6.0 carries NO existing snapshot carve-out line), stating `$XDG_STATE_HOME/rk/` caches MAY seed startup state but are never authoritative and discardable with no behavior change beyond cold-start latency; version bumped minor to 1.7.0 + Last Amended updated | Description prescribes the amendment's substance, the minor bump, and the date per the Governance line; the no-existing-carve-out check was performed against the current constitution | S:85 R:75 A:90 D:85 |
| 10 | Certain | Should-fix (a): `refreshMu` held across the whole `BranchRefresher.refresh` pass, mirroring Collector T019; both callers are background goroutines so blocking is safe | Race re-verified in current source (no pass-level mutex; tick/wake vs detached RefreshNow); the fix shape is prescribed ("mirrors T019") and already proven on the collector | S:85 R:85 A:90 D:90 |
| 11 | Certain | Should-fix (b): `parseOriginRepo` requires exactly two path segments; deeper/shallower paths report ok=false (fail open to the gh fallback) | Defect re-verified at prstatus_branch.go:310–316 (last-two-segments join); description prescribes the exact rule and the fail-open handling; every rejection is correct-but-unoptimized | S:85 R:85 A:90 D:90 |
| 12 | Certain | Invariants preserved: SSE hot path zero-subprocess/zero-IO (read once at startup, writes on background goroutines), stale-while-revalidate end-to-end, #542 machinery untouched except the two should-fixes, §I discipline (file IO without shell), steady-state cadences unchanged | Enumerated as hard constraints in the dispatch description and verified against the current source and constitution | S:90 R:80 A:95 D:90 |
| 13 | Certain | Tests: colocated Go tests (store round-trip, atomic write + perms, corrupt-file tolerance, login-mismatch discard, seed-then-refresh-overwrite, write coalescing, single-flight, parseOriginRepo depth table); gate `just test-backend`; no frontend changes | Description names the test list and gate verbatim; code-quality.md mandates colocated tests for changed behavior | S:90 R:90 A:90 D:90 |
| 14 | Confident | The amendment covers the whole `$XDG_STATE_HOME/rk/` category in one paragraph — naming both the existing write-only snapshots and the new seed-cache class — with final wording latitude | Description says to follow the snapshots precedent and match its style, but no §II carve-out exists to match; one paragraph covering both classes keeps §II honest about state already on disk without a second future amendment | S:60 R:80 A:80 D:70 |

14 assumptions (7 certain, 7 confident, 0 tentative, 0 unresolved).
