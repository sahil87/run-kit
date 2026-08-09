# Intake: PR Status Cold-Start Latency + Batched Branch Derivation

**Change**: 260807-2ept-pr-status-cold-start
**Created**: 2026-08-07

## Origin

Promptless dispatch (deferred questioning) from a `/fab-proceed`-style pipeline invocation, using a synthesized change description produced from a prior root-cause investigation of `app/backend/internal/prstatus/`. The description prescribes a two-part backend fix:

> After `rk serve` starts, the user waits ~2–4 minutes before sidebar/window PR statuses appear correctly. The viewer-wide `Collector` (90s tick, immediate first refresh, ONE batched `gh api graphql` call) is warm within seconds — not the bottleneck. The `BranchRefresher`'s first refresh at `Start` is a no-op because no (repoDir, branch) pairs are registered yet — registration happens only as the SSE sessions-enrichment loop observes panes (2.5s cadence). So the first useful pass begins at the first 30s tick, and then runs ONE SEQUENTIAL `gh pr list` per pair (~1–3s each, 10s timeout each). With dozens of windows across repos, a full pass takes minutes. Agreed fix (two parts, one change): (1) event-driven first pass — wake the `BranchRefresher` when pairs are registered, debounced/coalesced so a burst of registrations triggers one refresh; (2) batched branch derivation — extend the viewer-wide collector's GraphQL query with `headRefName` and `headRepository`, pre-populate the branch→PR mapping from that single batched call, and demote the per-pair `gh pr list --head` path to a FALLBACK for misses only.

Root-cause claims were re-verified against the current source before this intake was written (`prstatus.go`, `prstatus_branch.go`, `internal/sessions/sessions.go:enrichWindowPR`, `api/router.go` wiring) — all hold on this branch.

## Why

1. **The pain point**: every `rk serve` start (or restart — which happens routinely, e.g. self-update restarts) leaves the sidebar/window PR glyphs and status dots blank or stale for ~2–4 minutes. The branch→PR join (`BranchRefresher`) is what gives windows their `PrURL`/`PrNumber` at all, so until it resolves, **no** PR status shows — the fast viewer-wide `Collector` warmup is invisible without the join.

2. **The mechanism** (verified in code):
   - `BranchRefresher.Start` runs `refresh` immediately, but `entries` is empty at that moment — registration only happens inside `enrichWindowPR` on the SSE enrichment loop (2.5s cadence), so the immediate first refresh is a **no-op**. The first useful pass waits for the first 30s tick (`branchPRRefreshInterval`).
   - That pass then runs one **sequential** `gh pr list --head <branch> --state all` per registered pair (~1–3s each, `ghTimeout` 10s each). Dozens of windows across repos ⇒ minutes for a full pass.
   - Steady state has the same shape: N sequential `gh` subprocesses every 30s, which is also unnecessary gh call volume / rate-limit pressure, since most observed pairs are the user's own PRs — already fetched by the collector's single batched GraphQL call.

3. **If we don't fix it**: every restart re-pays the multi-minute blank-status window, and steady-state gh volume grows linearly with window count — the exact O(N)-subprocess shape the viewer-wide collector was designed to avoid (its package doc: "O(1) in PR count").

4. **Why this approach over alternatives**:
   - **Event-driven wake** mirrors the proven "hub wake seam" pattern from the row-color safety-poll fix (user-option mutations waking covered-server repaint): mutation-side wake, debounced, steady-state tick unchanged.
   - **Batched derivation** extends the collector's *existing* single GraphQL call — no new network call, no new poller. It collapses N sequential `gh pr list` calls into data the process already fetches at startup, fixing both cold-start latency and steady-state volume with one mechanism.
   - **Rejected: disk persistence** of snapshots across restarts — Constitution §II (no persistent state store); explicitly deferred to a separate future change (`pr-status-disk-seed`) with its own constitution carve-out.
   - **Rejected: parallelizing the per-pair `gh pr list` calls** — still N subprocesses and N API calls per pass (rate-limit pressure), and fixes neither the no-op first pass nor steady-state volume.
   - **Rejected: shortening the 30s tick** — multiplies gh volume without fixing the no-op first pass or the sequential-pass duration.

## What Changes

All changes are in `app/backend/` (backend only — the join surface consumed by `internal/sessions` and the frontend is unchanged).

### 1. Registration wake seam (event-driven first pass)

`internal/prstatus/prstatus_branch.go`:

- `BranchRefresher` gains a wake channel (buffered `chan struct{}`, capacity 1, non-blocking send — the standard coalescing-wake shape).
- `Register(repoDir, branch)` signals the wake **only when the pair is first-seen** (key not already in `entries`) — re-observations of known pairs (every 2.5s SSE pass re-registers everything) must NOT wake the refresher. The signal itself stays a cheap non-blocking channel send: `Register` remains hot-path safe (NO subprocess, NO network, no blocking).
- `Start`'s goroutine `select`s on `ctx.Done()`, `ticker.C`, and the wake channel. On a wake it **debounces/coalesces**: waits a short settle window (~1s — see Assumptions) draining further wakes, then runs one `refresh(ctx)`. A burst of registrations from one SSE enrichment pass (dozens of windows observed in the same `FetchSessions` call) therefore triggers **one** refresh pass, not N.
- Steady-state cadence is unchanged: the 30s ticker keeps running; the wake is additive. After startup, new-pair wakes are rare (a new window/branch appearing), so wake-driven passes stay bounded.
- Net effect on cold start: server starts → collector's immediate batched refresh warms (seconds) → first SSE enrichment pass (~2.5s) registers all pairs → one coalesced wake fires ⇒ the first useful branch pass runs at ~3–4s after start instead of 30s — and with part 2 below, that pass is mostly join-from-index rather than N sequential `gh` calls.

### 2. Batched branch derivation (viewer index seeding)

`internal/prstatus/prstatus.go` (collector side):

- Extend `ghQuery`'s node selection with `headRefName`, `headRepository { nameWithOwner }`, and `updatedAt` (needed for the precedence tiebreak among batched candidates — the current query does not fetch it). `ghPR` gains the matching fields. States/ordering/limit are unchanged (`[OPEN, MERGED, CLOSED]`, `UPDATED_AT desc`, `$limit` 100).
- After a **successful** parse in `Collector.refresh` (and only then — stale-while-revalidate applies to the seed too), hand the parsed PR nodes to a seed hook (e.g. an optional `onViewerPRs func([]...)` field, nil-safe), in addition to the existing wholesale `byURL` rebuild.

`internal/prstatus/prstatus_branch.go` (refresher side):

- `BranchRefresher` gains a stored **viewer head-index**: `(headRepo nameWithOwner, headRefName) → candidate PRs` (number, url, state, updatedAt), replaced wholesale on each seed (guarded by `mu`). Nodes with empty URL, empty `headRefName`, or null `headRepository` are skipped.
- `BranchRefresher` gains a per-repo **origin identity cache**: repoDir → `owner/name`, resolved locally via `git remote get-url origin` run in repoDir (`exec.CommandContext`, `ghTimeout`, explicit argv, `cmd.Dir = repoDir` — Constitution §I), normalized across https/ssh/`git@`/trailing-`.git` URL forms. Cached with TTL and pruning exactly like the existing `defaultBranches` cache (both success and failure cached; failure ⇒ fail-open to the per-pair gh path; ~5 min TTL; pruned for repos no live pair observes). Runs on the refresher goroutine only — never on the hot path. A new exec seam package var (mirroring `branchDefaultExec`) keeps it stubbable in tests.
- `refresh`'s per-pair loop becomes **index-first, fallback-on-miss**. Per pair, in order:
  1. **Default-branch exclusion** — unchanged, still first, still authoritative-negative with no gh call, still runs even when gh is unavailable.
  2. **Viewer-index join** — resolve the pair's repoDir to `owner/name` (cached); look up `(owner/name, branch)` in the stored index. On a **hit**: pick the winning candidate with the same precedence as `pickBranchPR` (open > merged > closed via `branchStateRank`, most-recently-updated tiebreak within a class) and set the positive entry. **No `gh pr list` subprocess for this pair this pass.**
  3. **Per-pair fallback** — on an index **miss** (PR not authored by the viewer, PR aged out of the top-100 window, fork/identity mismatch, origin-resolution failure, or no index yet), fall through to the existing `gh pr list --head` path, unchanged (gated on `ghOK`, stale-while-revalidate, `pickBranchPR`).
- An index **miss is never an authoritative negative**: the batched result cannot distinguish "no PR" from "not covered" (authorship + top-100 truncation), so only the fallback path (or the default-branch exclusion) may write a negative entry. Only the fallback's successfully-parsed empty result clears an entry, exactly as today.
- Because the index is *stored* (not consumed once), ordering is startup-safe: the collector's immediate refresh stores the index before the first SSE registrations arrive, so the wake-triggered first pass joins against a warm index — most pairs resolve with **zero** additional subprocesses.

### 3. Wiring

`api/router.go` (`NewRouter`): wire the collector's seed hook to `prstatus.DefaultBranchRefresher` (e.g. `pc.onViewerPRs = DefaultBranchRefresher.StoreViewerIndex` via a setter/constructor option) **before** `pc.Start(ctx)` and `DefaultBranchRefresher.Start(ctx)`. `NewTestRouter` stays unwired unless a test opts in. `RefreshNow` on both types is untouched (POST /api/status/refresh behavior unchanged).

### 4. Tests

Colocated Go tests following the existing exec-seam + injectable-clock patterns (`prstatus_test.go`, `prstatus_branch_test.go`):

- Wake seam: first-sight registration triggers exactly one refresh pass for a burst of registrations (coalescing); re-registration of known pairs does not wake; steady-state tick unaffected.
- Query extension: parse fixtures with `headRefName`/`headRepository`/`updatedAt`; null `headRepository` and empty-URL nodes skipped.
- Index join: hit ⇒ positive entry with correct precedence winner and no per-pair exec (assert via counting stub); miss ⇒ fallback exec runs; miss never writes a negative; default-branch exclusion still wins over an index hit; fork identity mismatch falls back.
- Origin identity cache: normalization across URL forms; success + failure both cached (one `git remote get-url` per TTL window); failure fails open to the gh path; pruning mirrors `defaultBranches`.
- Seed is stale-while-revalidate: a failed collector refresh leaves the last-good index in place.

### Invariants preserved (verified against current code + constitution)

- **NO network/subprocess on the SSE hot path** — `Register`/`Snapshot` stay cheap lock-guarded map ops; all gh/git subprocesses stay on the refresher/collector goroutines (documented invariant in `prstatus_branch.go` and `api/sse.go`).
- **Stale-while-revalidate** — transient gh/git errors keep last-good entries and last-good index; only a successfully parsed result updates anything.
- **Default-branch exclusion** — a pane on the repo's default branch never resolves a PR (authoritative negative, no gh call), and the exclusion outranks the viewer index.
- **`pickBranchPR` precedence** (open > merged > closed, most-recently-updated tiebreak) applies identically to index candidates and fallback results; the durable stateless merged-square behavior (`--state all`, no grace clock) survives.
- **Constitution §I** — every new subprocess (`git remote get-url origin`) uses `exec.CommandContext` with timeout + explicit argv, repoDir only as `cmd.Dir`.
- **Constitution §II** — in-memory only; the index and identity cache are wholesale-replaced/TTL-pruned maps, no disk.

### Explicitly out of scope

- Disk-seeding snapshots across restarts (future change `pr-status-disk-seed`, with its own constitution carve-out).
- Any constitution amendment.
- Frontend changes — `SnapshotBranchPR`/`MapBranchState`/SSE payload shapes are unchanged; this is backend latency/volume only.

## Affected Memory

- `run-kit/architecture`: (modify) prstatus section — BranchRefresher registration-wake seam, viewer head-index seeding from the collector's batched GraphQL call, per-pair `gh pr list` demoted to fallback-on-miss, per-repo origin-identity cache.

## Impact

- `app/backend/internal/prstatus/prstatus.go` — GraphQL query fields (`headRefName`, `headRepository { nameWithOwner }`, `updatedAt`), `ghPR` struct, seed hook on `Collector.refresh`.
- `app/backend/internal/prstatus/prstatus_branch.go` — wake channel + coalesced select loop, stored viewer index, origin-identity resolver/cache + exec seam, index-first refresh loop.
- `app/backend/internal/prstatus/prstatus_test.go`, `prstatus_branch_test.go` — new coverage per § Tests.
- `app/backend/api/router.go` — seed-hook wiring.
- No API surface, SSE payload, or frontend changes. `internal/sessions/sessions.go` untouched (Register/Snapshot contracts unchanged).

## Open Questions

- None — the synthesized description resolves all consequential design decisions; remaining latitude (exact debounce value, hook naming/mechanics) is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-part fix in one change: registration-wake seam + batched viewer-index derivation, per-pair `gh pr list` demoted to fallback-on-miss | Prescribed verbatim by the dispatch description ("Agreed fix (two parts, one change)") | S:90 R:75 A:85 D:90 |
| 2 | Certain | Steady-state cadences unchanged (30s branch tick, 90s collector tick); wake is additive, first-pass acceleration only | Description explicit: "steady-state ticking stays at 30s" | S:90 R:85 A:90 D:90 |
| 3 | Confident | Wake fires only on first-sight registrations (new key in `entries`), via cap-1 non-blocking channel; re-observations never wake | Description says "the first batch of registrations after startup triggers an immediate refresh"; every 2.5s SSE pass re-registers all pairs, so any-registration wake would degenerate into a 2.5s poll — first-sight is the only reading that preserves the 30s steady state | S:70 R:85 A:80 D:70 |
| 4 | Confident | Debounce/coalescing window ~1s settle after first wake (drain further wakes, then one pass) | Description requires "debounced/coalesced… one refresh, not N" but names no value; any small value satisfies it; trivially tunable constant | S:50 R:90 A:75 D:60 |
| 5 | Confident | Repo identity join = `headRepository { nameWithOwner }` (GraphQL) vs local `git remote get-url origin` normalized to owner/name, cached per-repo with TTL/pruning mirroring `defaultBranches` (failure ⇒ fail-open to gh fallback) | Description: "enough repo identity to join against a local repoDir's origin remote"; nameWithOwner is the canonical minimal identity; the defaultBranches cache is the established in-package pattern for per-repo local-git verdicts | S:65 R:80 A:85 D:70 |
| 6 | Confident | Seeding seam = collector push: nil-safe hook on `Collector.refresh` (successful parse only) → `BranchRefresher` stores a wholesale-replaced viewer head-index; refresher consults the stored index during each pass (index-first, fallback-on-miss) | Description: "pre-populate the branch→PR mapping from that single batched call"; storing the index (vs one-shot seeding) makes ordering startup-safe and keeps steady-state passes cheap; push-hook wiring in router.go mirrors existing refreshCollectorFn/refreshBranchFn wiring style | S:60 R:75 A:80 D:65 |
| 7 | Confident | An index hit suppresses the per-pair fallback for that pair that pass; an index miss is NEVER an authoritative negative (only fallback or default-branch exclusion may write negatives) | Description: "demoted to a FALLBACK for misses only"; the batched result cannot distinguish no-PR from not-covered (authorship + top-100 cap). Accepted rare edge: a non-viewer-authored open PR sharing a head with the viewer's merged PR would show merged until the index misses — same-repo-same-head cross-author PRs are vanishingly rare and self-heal when the viewer PR ages out of top-100 | S:55 R:70 A:65 D:55 |
| 8 | Certain | All listed invariants preserved: hot-path zero-exec, stale-while-revalidate (incl. the new index), default-branch exclusion outranks the index, pickBranchPR precedence + `--state all` merged-square durability, Constitution §I exec discipline, §II in-memory only | Enumerated as hard constraints in the dispatch description and verified against current code + constitution | S:95 R:80 A:95 D:95 |
| 9 | Certain | Out of scope: disk seeding (separate future `pr-status-disk-seed`), constitution amendments, frontend changes | Description lists these verbatim under "Explicitly out of scope" | S:95 R:90 A:90 D:95 |
| 10 | Certain | Tests are colocated Go tests extending the existing exec-seam/clock-seam stubbing patterns in `prstatus_test.go` / `prstatus_branch_test.go`; verification via `just test-backend` gates | Description names the test files + patterns; code-quality.md mandates colocated tests and tests-for-changed-behavior | S:80 R:90 A:90 D:85 |
| 11 | Confident | `updatedAt` added to the batched GraphQL query (not in the description's field list) | Required for the precedence tiebreak the description mandates ("most-recently-updated tiebreak… must survive") to apply to index candidates; without it, batched candidates cannot be ranked within a state class | S:60 R:85 A:85 D:80 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
