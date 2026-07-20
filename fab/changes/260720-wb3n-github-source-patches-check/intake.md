# Intake: GitHub-Source Backend for the incl.-Patches Update Check

**Change**: 260720-wb3n-github-source-patches-check
**Created**: 2026-07-20

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`), synthesized from a settled design conversation. All major decisions below are decided outcomes of that discussion — not open questions. Raw synthesized input:

> Make the palette command `run-kit: Check for Updates (incl. patches)` use the GitHub backend of shll's update check (`shll check-updates --source github --json`), while `run-kit: Check for Updates` keeps the default released-manifest backend. Plumb a `source` parameter through 4 seams (client → POST body → handler → checker → exec); a github-sourced check must NOT write the shared cached verdict or fire OnQualify (side-channel query); handler validates the source enum; response echoes the report's `source` field and the frontend suppresses the `(patch — below notify threshold)` annotation for github-sourced results.

Builds directly on the completed change `260720-n2ai-shll-check-updates-delegation-palette-checks` (which delegated the check to `shll check-updates` and created the two palette commands). That change explicitly decided "no `--source github` plumbing needed" (recorded under its Design notes as a rejected alternative); this change **deliberately reverses that one decision** because the manifest-lag pain materialized in practice. Everything else from n2ai stands.

## Why

1. **The pain point**: today both palette check commands POST the same `/api/updates/check`; the daemon runs one `shll check-updates --json` (default `released` source = the shll.ai/versions.json manifest), and "incl. patches" is purely client-side filtering (`updateAvailable` vs `notable`) in `composeCheckToast` (`app/frontend/src/lib/palette-update.ts`). The shll.ai manifest refreshes ~daily and can lag actual releases — so a user who just cut a release and deliberately asks "is anything updatable right now, including patches?" gets a stale "All tools up to date" until the manifest catches up.

2. **If we don't do it**: the incl.-patches command — the deliberate, fine-grained check — stays bound to the manifest's ~1-day cadence, and the only workaround is a blind `run-kit: Update Now` (full-roster force update) or shelling out to `shll check-updates --source github` manually.

3. **Why this approach**: shll already carries the GitHub backend (`--source github` — release tags, fresh); plumbing one validated enum value through the existing check seam reuses the whole delegation pipeline n2ai built (Constitution III — wrap, don't reinvent). The default check keeps the released backend, so the ambient loop and chip semantics are untouched. The critical safety property — github results never enter the shared cached verdict — keeps the chip, the dismissal key, and the scoped `shll update` argv on the notify-policy-bearing released source (see § Cache isolation, below, for why this is load-bearing).

## What Changes

### 1. `source` parameter plumbed through 4 seams

- **`app/frontend/src/api/client.ts` — `checkForUpdates()`** (currently zero-arg, POSTs `{}` at :454): gains an optional source parameter (`checkForUpdates(source?: "github")`). When `"github"`, the POST body is `{"source":"github"}`; otherwise the body stays `{}`.
- **`app/backend/api/update.go` — `handleUpdatesCheck`** (:210): parses a tolerant request body (mirroring `updateRequest`'s posture at :93): absent body / empty body / `{}` / absent `source` key → the released default (backward compatible; existing clients POSTing `{}` are unchanged). A validated `"source":"github"` requests the GitHub backend.
- **`app/backend/internal/updatecheck/updatecheck.go` — `Checker.CheckNow`** (:259): gains the source parameter and passes it to the check seam. The ambient loop (`Start` → `checkOnce`) and `RecheckAfter` keep calling the flag-free released path — deliberately version-agnostic, exactly as today (the package comment already documents the no-backend-flag posture for the ambient exec; that posture now applies to the *released* path only).
- **`defaultCheck`** (:448): for the validated `"github"` value only, appends the literal argv pair `"--source", "github"` to the `exec.CommandContext` argument slice. The released path keeps today's exact argv (`check-updates --json`, no source flag).

### 2. Cache isolation — github checks are side-channel queries (load-bearing)

A github-sourced check runs **exec + verdict computation and returns the Result, but skips the cache write and the OnQualify/SSE broadcast**. The released-source path (ambient loop + default manual check) stays exactly as-is, including cache write + OnQualify.

Why this is load-bearing (verified facts):

- The github JSON contract carries **NO `notify`/`notable` fields at all** (shll help: "no notify policy in this backend"). Every sibling row decodes `notable=false` (Go zero value), and run-kit's own row also lands `notable=false` because its local `crossesThreshold` fail-closes on the empty notify string (`updatecheck.go:554` — unknown/empty notify → `false`).
- If github results entered the cache: (a) a legit chip from the ambient released check would be wiped — `Matched` empties → `Key` changes to `""` → a "cleared" OnQualify fires → SSE broadcasts the clear and replaces the cached slot; (b) the scoped non-force `shll update` path (`handleShllUpdate`, `update.go:148`) reads `Snapshot().Matched` for its argv → a github-polluted snapshot would 409 "no update available".

### 3. Handler validates the source enum

Only `"github"` is accepted as an override. Nothing user-controlled ever reaches argv (Constitution I): the handler maps the request onto a closed enum, and `defaultCheck` appends the literal flag pair only for the validated enum value — the request string itself is never spliced into the command. An unrecognized non-empty `source` value → 400 `{"error":...}` (see Assumptions #11 for the choice of 400 over treat-as-default). Absent/empty → released.

### 4. Response echoes the report's `source`

The `source` field from shll's JSON report (`CheckReport.Source` — already decoded, `updatecheck.go:95`) propagates through the `/api/updates/check` response to the frontend. Echoing the actual report source was chosen over an invented client-side boolean; it doubles as a defensive check (the backend can verify `report.Source` matches the requested source, and the client reacts to what actually ran).

- The frontend **suppresses the `(patch — below notify threshold)` annotation when `source === "github"`** — no notify policy exists in that backend, and a minor bump (e.g. run-kit 3.8.7 → 3.9.1) would otherwise be mislabeled as a sub-threshold patch (every github row is `notable=false`).
- `composeCheckToast`'s incl.-patches filter (`updateAvailable`) works unchanged; only the annotation is suppressed for github-sourced results.
- Mechanism (Assumptions #12): `updatecheck.Result` gains a `Source` field and the shared `updateAvailablePayload` builder (`sse.go:859`) gains a `source` JSON key — the SSE slot then also carries `source:"released"` for ambient verdicts, which is harmless and keeps the one-builder-no-drift property.

### 5. Frontend wiring

- `app/frontend/src/hooks/use-update-check.ts` — `runUpdateCheck(includePatches)`: maps `includePatches === true` → `checkForUpdates("github")`; default check stays `checkForUpdates()`. Passes the echoed `source` into the toast composition so the annotation suppression keys off the actual report source.
- `app/frontend/src/lib/palette-update.ts` — `composeCheckToast` gains the source input (see Assumptions #14 for the exact signature shape). Filtering logic (`updateAvailable` vs `updateAvailable && notable`) is unchanged.
- The toast's "Update Now" action needs **no change** — it is `forceUpdateNow` (POST `/api/update` `{force:true}` → full-roster `shll update`), which does not consult the cached `Matched` set.
- Palette labels, dev-gating (`buildCheckActions`), and the single-flight `checking` state are all unchanged.

### 6. Version-skew posture

The manual check path is already fail-loud (non-zero exit → 502 → error toast, `update.go:217`), so an older shll without `--source` support yields an honest error toast on the incl.-patches command. The ambient loop's flag-free invocation stays untouched. No new skew handling is added.

### 7. No shll-side change

The github contract is already sufficient: `schema: 1`, omits `notify`/`notable`, self-identifies `"source": "github"`. The Go decoder tolerates the missing fields (zero values). No change in the shll repo.

### Accepted semantic shift (by design)

The two palette commands stop being "same data, two filters" and become "two backends": the default check can say "All tools up to date" while incl.-patches lists updates, purely from manifest lag. This is deliberate — github = fresh source, the workaround for the ~1-day manifest cadence.

### Tests

- **`updatecheck_test.go` + `testdata/`**: a github report fixture as a vendored-contract twin of `testdata/check-updates.json` — `"source": "github"`, no `notify`/`notable` fields on any row. Assert: github check returns the computed verdicts (all `notable=false`), performs **no cache write** (Snapshot unchanged) and fires **no OnQualify**; a released check afterward still caches/fires normally; the exec seam receives the `--source github` argv pair only on the github path.
- **`api/update_test.go`**: body parse (absent/`{}`/`{"source":"github"}`), source enum validation (unknown value → 400), source echo in the response payload.
- **Frontend** (`palette-update.test.ts`, plus client/hook coverage): annotation suppression for github-sourced results (a non-notable row is NOT annotated when source is github; still annotated for released), `checkForUpdates` body wiring, hook mapping incl.-patches → github.

## Affected Memory

- `run-kit/architecture`: (modify) Update-checker section — `CheckNow`/check-exec seam gains the validated `source` parameter (`--source github`); github checks are side-channel (no cache write, no OnQualify); `source` echoed through the shared check/SSE payload.
- `run-kit/ui-patterns`: (modify) Update palette section — the two check commands become two backends (default = released manifest, incl.-patches = github release tags); annotation suppression for github-sourced results.

## Impact

- **Backend**:
  - `app/backend/internal/updatecheck/updatecheck.go` + `updatecheck_test.go` + `testdata/` — source-parameterized `CheckNow`/check seam, side-channel (no-cache/no-OnQualify) github path, `Result.Source`, `defaultCheck` argv pair, github fixture.
  - `app/backend/api/update.go` + `update_test.go` — `handleUpdatesCheck` body parse + enum validation + 400 mapping; source passed to `CheckNow`.
  - `app/backend/api/sse.go` — `updateAvailablePayload`/`buildUpdateAvailablePayload` gain the `source` field (shared builder; SSE slot carries it too).
- **Frontend**:
  - `app/frontend/src/api/client.ts` — `checkForUpdates(source?)`, POST body, `source` parsed from the response, `UpdateCheckResult.source`.
  - `app/frontend/src/hooks/use-update-check.ts` — incl.-patches → github mapping; pass echoed source to toast composition.
  - `app/frontend/src/lib/palette-update.ts` + `palette-update.test.ts` — `composeCheckToast` annotation suppression.
- **Docs/specs**: `docs/specs/api.md` — `POST /api/updates/check` request body (`source` enum) + response/SSE payload `source` field.
- **Change type**: feat. (Explicitly pinned — refresh seams must not flip this to fix; the intake text mentions "fix"-adjacent wording.)

## Open Questions

- None — all major decisions were settled in the design conversation; residual implementation details are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `source` plumbed through exactly 4 seams: `checkForUpdates()` → POST body `{"source":"github"}` → `handleUpdatesCheck` → `Checker.CheckNow` → `defaultCheck` argv; absent/empty/`{}` body → released default (existing clients unchanged) | Discussed — settled seam list, verified against current code (update.go:210, updatecheck.go:259/:448, client.ts:454) | S:95 R:70 A:95 D:95 |
| 2 | Certain | A github-sourced check is a side-channel query: exec + verdict computation + return Result; NO cache write, NO OnQualify/SSE broadcast. Released path (ambient + default manual) unchanged incl. cache write + OnQualify | Discussed — settled and load-bearing; verified: github contract carries no notify/notable (all rows decode notable=false; crossesThreshold fail-closes), so caching would wipe a legit chip (Key→"" clear broadcast) and 409 the scoped `shll update` (Snapshot().Matched) | S:95 R:60 A:90 D:95 |
| 3 | Certain | Handler validates the source enum — only `"github"` accepted as an override; nothing user-controlled reaches argv; `defaultCheck` appends the literal `"--source", "github"` pair only for the validated enum value (Constitution I) | Discussed — settled; closed-enum-to-literal-argv is the constitution-mandated shape | S:95 R:75 A:95 D:95 |
| 4 | Certain | Response payload echoes the report's `source` (propagated from shll's JSON `"source"` key); frontend suppresses the `(patch — below notify threshold)` annotation when `source === "github"` | Discussed — settled; echo chosen over an invented client boolean (doubles as defensive check); a github minor bump would otherwise be mislabeled as sub-threshold | S:90 R:80 A:90 D:90 |
| 5 | Certain | `composeCheckToast`'s incl.-patches filter (`updateAvailable`) works unchanged; only the annotation is suppressed for github-sourced results | Discussed — settled; verified the filter reads `updateAvailable`, which github rows carry | S:90 R:85 A:90 D:90 |
| 6 | Certain | The toast's "Update Now" action needs no change — `forceUpdateNow` POSTs `/api/update` `{force:true}` (full-roster `shll update`) and never consults the cached Matched set | Discussed — settled; verified handleShllUpdate's force path skips the Matched read | S:90 R:90 A:95 D:95 |
| 7 | Certain | Version-skew posture: older shll without `--source` → non-zero exit → 502 → honest error toast (existing fail-loud manual path); ambient loop's flag-free invocation untouched (deliberately version-agnostic) | Discussed — settled; the manual fail-loud path already exists (update.go:217) | S:90 R:85 A:90 D:90 |
| 8 | Certain | No shll-side change — the github contract is sufficient: `schema: 1`, omits `notify`/`notable`, self-identifies `"source": "github"`; Go decoder zero-values the missing fields | Discussed — verified fact from shll help + decoder shape | S:90 R:80 A:90 D:90 |
| 9 | Certain | Accepted semantic shift: the two commands become "two backends" — the default check can report all-up-to-date while incl.-patches lists updates, purely from manifest lag | Discussed — settled by design (github = fresh source, workaround for ~1-day manifest cadence) | S:90 R:80 A:90 D:90 |
| 10 | Certain | Tests: github fixture as vendored-contract twin of `testdata/check-updates.json` (no notify/notable); assert no cache write + no OnQualify on a github check; `api/update_test.go` body parse / enum validation / source echo; frontend annotation-suppression + client/hook wiring tests | Discussed — settled test list; matches code-quality.md (features must include tests) | S:90 R:90 A:90 D:90 |
| 11 | Confident | An unrecognized non-empty `source` value → 400 `{"error":...}` (not silently treated as released); absent/empty stays released | Delegated to intake ("400 or treated per intake decision"); the manual path is deliberately fail-loud, and a silent released fallback would mask a client bug; easily changed | S:60 R:90 A:85 D:75 |
| 12 | Confident | Echo mechanism: `updatecheck.Result` gains a `Source` field (from `CheckReport.Source`) and the shared `updateAvailablePayload` builder gains a `source` JSON key — the SSE slot then carries `source:"released"` for ambient verdicts (harmless; preserves the one-builder-no-drift property of sse.go:859) | Mechanism not pinned in the discussion beyond "echo the report's source"; the shared-builder route is the obvious no-drift shape; reversible | S:55 R:85 A:85 D:75 |
| 13 | Confident | Checker seam shape: `CheckNow(ctx, source)` with `""`/released as the zero default; internally the check pass is parameterized so only the released path takes the cache-write + OnQualify branch (ambient `checkOnce` callers unchanged); the test seam (`checkFn`/`SetCheckForTest`) carries the source through | Implementation detail below the settled contract; one obvious shape given the existing seams; reversible within the package | S:55 R:85 A:85 D:70 |
| 14 | Confident | Frontend signature shapes: `checkForUpdates(source?: "github")`; `UpdateCheckResult` gains `source: string` (defensively defaulted to `""` on old daemons); `composeCheckToast` receives the echoed source string (annotation suppressed when `"github"`), keeping the module context-free | Signature detail not pinned; passing the echoed string mirrors the settled echo decision; trivially reversible | S:60 R:90 A:85 D:75 |
| 15 | Confident | The github Result's `key`/`current`/`latest` are computed but carry no special handling (notable set is always empty under the github contract → key `""`); the client's toast flow reads only `tools` + `source`, so no client change is needed for them | Follows from the no-notify contract + verified hook code (only `result.tools` consumed); nothing to build, recorded to preempt reviewer confusion | S:55 R:90 A:85 D:75 |

15 assumptions (10 certain, 5 confident, 0 tentative, 0 unresolved).
