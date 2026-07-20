# Plan: Toolkit Manifest Update Notifications

**Change**: 260718-d15e-toolkit-manifest-update-notifications
**Intake**: `intake.md`

## Requirements

### Checker: Manifest source & fetch

#### R1: Fetch the shll.ai version manifest instead of the GitHub Releases API
The checker SHALL fetch `https://shll.ai/versions.json` (a single unauthenticated JSON GET) in place of the GitHub Releases API, decoding the `{schema, generated_at, tools}` document where each `tools` entry carries `{latest, notify, formula}`. The fetch SHALL remain context-bound (10s timeout, Constitution I) and the GitHub-releases endpoint SHALL be removed (no fallback fetch).

- **GIVEN** the daemon is running a parseable, non-dev version
- **WHEN** a periodic check fires
- **THEN** the checker issues one GET to `https://shll.ai/versions.json`
- **AND** parses the manifest's `tools` map (each entry `{latest, notify, formula}`)
- **AND** never contacts `api.github.com`

#### R2: Unchanged cadence, suppression, and stale-while-revalidate
The checker SHALL preserve today's cadence (`initialCheckDelay` 30s + `checkInterval` 6h), whole-checker suppression for the `dev` sentinel and unparseable running versions, and stale-while-revalidate on any fetch/parse failure (retain the previous verdict, `slog.Warn`, never crash).

- **GIVEN** the running version is `dev` or does not parse as `X.Y.Z`
- **WHEN** `Start` is called
- **THEN** the checker is a no-op (no fetch ever runs)
- **GIVEN** a non-suppressed checker whose manifest fetch returns an error, a non-200, or unparseable JSON (e.g. `versions.json` 404s before the sibling change ships)
- **WHEN** a check fires
- **THEN** the previous verdict is retained, a warning is logged, and the daemon does not crash

### Checker: Match computation

#### R3: Per-tool match against manifest-carried notify policy
For each manifest tool the checker SHALL compute `matched = crossesThreshold(installed, latest, notify)` where `notify` is read verbatim from the manifest: `never` never matches; `patch` matches on any version increase; `minor` matches on a minor-or-major increase (patch differences never match — exactly today's `qualifies()` semantics). An installed or latest version that does not parse never matches (defensive).

- **GIVEN** a manifest tool with `notify: "never"`
- **WHEN** the installed version is older than `latest`
- **THEN** it never matches
- **GIVEN** a tool with `notify: "patch"` and any installed < latest (incl. a patch-only bump)
- **WHEN** the check runs
- **THEN** it matches
- **GIVEN** a tool with `notify: "minor"` and only a patch difference
- **WHEN** the check runs
- **THEN** it does NOT match; a minor or major difference DOES match

#### R4: Installed-version sourcing (run-kit row vs. every other tool)
The run-kit manifest row SHALL compare against the *running* ldflags version (as today) AND additionally require `selfpath.IsBrewInstalled`. Every other tool's installed version SHALL come from one timeout-bound `brew list --versions <formula…>` exec (formula names from the manifest `formula` field; output `<formula> <version>` per line; a missing formula yields no line). A tool with no installed version (not brew-installed) SHALL never match.

- **GIVEN** the manifest lists `run-kit` with a qualifying newer `latest` but the daemon is a go-install/dev build (not under `/Cellar/run-kit/`)
- **WHEN** the check runs
- **THEN** the run-kit row does not self-match
- **GIVEN** a manifest tool whose `formula` is not present in `brew list --versions` output
- **WHEN** the check runs
- **THEN** that tool has no installed version and can never match
- **GIVEN** a manifest tool whose brew-installed version crosses its threshold
- **WHEN** the check runs
- **THEN** it matches, using the brew-listed version as `installed`

#### R5: shll-absent scoping
When `exec.LookPath("shll")` fails, matching SHALL scope to the run-kit row only (the chip must never advertise updates the degraded `rk update`-self remediation cannot deliver). The lookup SHALL be fail-silent.

- **GIVEN** `shll` is not on PATH
- **WHEN** a check runs
- **THEN** only the run-kit manifest row is considered for matching; all other tools are skipped
- **AND** no error or warning about the missing `shll` is surfaced

### Checker: Verdict, composite key, re-fire

#### R6: Generalized Result — matched list + composite key
`updatecheck.Result` SHALL generalize from `{Current, Latest, Qualifies}` to carry `Matched []ToolUpdate` (each `{Tool, Installed, Latest}`, in deterministic sorted-name order — a Go JSON map cannot preserve manifest order, and `shll update` re-normalizes argv to roster order anyway) and `Key string` (the composite dismissal key: sorted `tool@latest` pairs, comma-joined, e.g. `fab-kit@2.17.0,run-kit@3.9.0`; empty when nothing matches). Backward-compatible `Current`/`Latest` accessors MAY be retained where the run-kit row populates them.

- **GIVEN** run-kit and fab-kit both match
- **WHEN** the verdict is computed
- **THEN** `Matched` holds both `{Tool, Installed, Latest}` entries in sorted-name order
- **AND** `Key` is the sorted-`tool@latest` composite `fab-kit@2.17.0,run-kit@3.9.0`
- **GIVEN** nothing matches
- **THEN** `Matched` is empty and `Key` is `""`

#### R7: OnQualify fires on ANY key change — including a change to empty
`OnQualify` SHALL fire whenever a check changes `Key` at all — to a non-empty value (first match, re-match, newer latest, newly-matching tool) **or to empty** (all previously-matched tools became current: the "consumed match" clear). An unchanged key (empty or not) SHALL NOT fire. <!-- rework cycle 1: the original to-non-empty-only gate left the cached SSE slot advertising a consumed match forever after a siblings-only update (no daemon restart → no natural clear) -->

- **GIVEN** the previous key was empty (or differed) and the new key is non-empty
- **WHEN** a check completes
- **THEN** `OnQualify` fires with the new verdict
- **GIVEN** the previous key was non-empty and the new key is empty (matched tools were updated out-of-band or via a scoped remediation)
- **WHEN** a check completes
- **THEN** `OnQualify` fires with the cleared (empty-matched) verdict
- **GIVEN** the key is unchanged (empty or non-empty) across two checks
- **THEN** `OnQualify` does not fire again

### API: SSE payload

#### R8: `update-available` payload carries the matched tools + key — including the cleared verdict
`api/sse.go`'s `broadcastUpdateAvailable` and its cached replay slot (`cachedUpdateAvailableJSON`) SHALL carry `{ tools: [{tool, current, latest}, …], key, current, latest }`, where the legacy top-level `current`/`latest` stay populated from the run-kit row when run-kit is in the match set (else empty strings). A **cleared verdict** (empty `tools`, empty `key` — fired per R7 when a match is consumed) SHALL be broadcast and SHALL replace the cached slot, so reconnecting/new tabs never replay a stale consumed match. The broadcast SHALL remain server-global (all clients incl. `?metrics=1`) with replay-on-connect. <!-- rework cycle 1: the slot previously retained the consumed match indefinitely -->

- **GIVEN** the checker fires `OnQualify` with a matched set including run-kit
- **WHEN** the hub broadcasts
- **THEN** the payload lists each matched tool `{tool, current, latest}`, carries the composite `key`, and populates legacy top-level `current`/`latest` from the run-kit row
- **GIVEN** the matched set excludes run-kit
- **THEN** legacy top-level `current`/`latest` are empty strings while `tools`/`key` are populated
- **GIVEN** the checker fires a cleared verdict (empty key)
- **WHEN** the hub broadcasts
- **THEN** the payload carries empty `tools`/`key` and the cached slot is replaced with it (a tab connecting afterwards sees the cleared state, not the consumed match)

### API: Remediation

#### R9: shll-present remediation spawns a scoped `shll update <matched…>`
When `exec.LookPath("shll")` succeeds, `POST /api/update` (non-force) SHALL respond 202 then spawn a detached `shll update <matched tools…>` (argv from the checker's snapshot at request time), reusing the existing detached `Setsid` + `~/.rk/update.log` spawn seam generalized to spawn a binary at an arbitrary path.

- **GIVEN** shll is on PATH and a qualifying match set exists
- **WHEN** a non-force `POST /api/update` arrives
- **THEN** the handler responds 202 and spawns detached `shll update <matched tools…>` (matched tool names as argv)
- **AND** on an empty match set it 409s first (never spawns `shll update` with no args on the non-force path)

#### R10: force = full-roster `shll update` sweep
With `force: true` and shll present, the handler SHALL spawn `shll update` with no tool args (full-roster sweep) and skip the qualify 409 (as today).

- **GIVEN** shll is present and `{"force":true}` is posted
- **WHEN** the handler runs
- **THEN** it spawns detached `shll update` (no tool args) and does not 409 on an empty match set

#### R11: shll-absent fallback is today's behavior verbatim
When shll is absent from PATH, the handler SHALL behave exactly as today: brew-409 gate on run-kit's own install, unchanged qualify/force logic, and a detached `rk update` (self) spawn. The brew-409 SHALL apply ONLY on this fallback path.

- **GIVEN** shll is not on PATH and run-kit is not brew-installed
- **WHEN** any `POST /api/update` arrives
- **THEN** the handler 409s ("run-kit was not installed via Homebrew")
- **GIVEN** shll is not on PATH, run-kit is brew-installed, and an update qualifies
- **THEN** the handler 202s and spawns detached `rk update` (self)
- **GIVEN** shll IS present but run-kit is not brew-installed
- **THEN** there is no brew-409 — other tools remain updatable via `shll update`

#### R12: unchanged 202-before-spawn ordering and second-click idempotence
The handler SHALL keep no in-flight lock, respond 202 before spawning, and let a second click spawn again (idempotent via `shll update`/`rk update` "already up to date").

- **GIVEN** two rapid non-force clicks with a qualifying match
- **WHEN** each arrives
- **THEN** each responds 202 and spawns (no lock)

### Frontend: chip, dismissal, palette

#### R13: `useUpdateNotification` consumes the matched-tools payload — and cleared verdicts
The frontend SHALL consume the new payload: `qualifies` = non-empty `tools` (still `&& !dev`). The context SHALL expose the matched tools and the composite `key`. `applyUpdateAvailable` SHALL handle a **cleared payload** (empty `key`) by clearing the stored `updateAvailable` state — it MUST NOT early-return on an empty key. The `updating` UI state SHALL clear when an `update-available` event arrives whose `key` differs from the key at click time (including the cleared empty key) — a siblings-only update never restarts the daemon, so the reload that used to clear `updating` never comes; the changed-key event is the completion signal. The daemon-restart reload path (run-kit in the match set) remains the other clearing mechanism. A not-yet-reloaded frontend keying off non-empty `latest` degrades to run-kit-only display — acceptable transitional behavior. <!-- rework cycle 1: applyUpdateAvailable early-returned on empty key and `updating` relied solely on the reload-after-restart premise, leaving a permanently stuck chip after sibling-only updates -->

- **GIVEN** an `update-available` event with a non-empty `tools` list
- **WHEN** the context applies it
- **THEN** `qualifies` is true (unless dev) and the matched tools + key are available to consumers
- **GIVEN** a cleared `update-available` event (empty key)
- **WHEN** the context applies it
- **THEN** the stored `updateAvailable` clears (chip hides; no early return)
- **GIVEN** the user clicked update (state `updating`, click-time key K) and a later `update-available` event arrives with key ≠ K (including empty)
- **WHEN** the context applies it
- **THEN** `updating` clears (the chip reflects the new verdict instead of a permanent `updating…`)

#### R14: composite-key dismissal
Dismissal SHALL store the composite `key` in `localStorage` (`runkit-update-dismissed`) instead of a single version; any change to `key` re-shows the chip.

- **GIVEN** the chip is showing for key `fab-kit@2.17.0,run-kit@3.9.0`
- **WHEN** the user dismisses
- **THEN** that composite key is persisted and the chip hides
- **GIVEN** a later check produces a different key (newer latest or a newly-matching tool)
- **THEN** the chip re-shows

#### R15: UpdateChip single/multi presentation
The `UpdateChip` SHALL keep today's `⬆ v{latest}` form when the single matched tool is run-kit; otherwise (a non-run-kit single tool, or multiple tools) it SHALL show a count form (e.g. `⬆ updates (N)`) with the per-tool `tool v{a} → v{b}` transitions in the title/aria and the overflow-menu version row. The chip MUST communicate which tools will be updated (the button runs a scoped update).

- **GIVEN** exactly one matched tool, and it is run-kit
- **WHEN** the chip renders
- **THEN** the visible label is `⬆ v{latest}` (today's form)
- **GIVEN** two matched tools (or one non-run-kit tool)
- **THEN** the chip shows a count form and its title/aria names the per-tool transitions

#### R16: palette action labels follow the single/multi split; dismiss writes composite key
`lib/palette-update.ts` update-action labels SHALL follow the same single/multi split; `Dismiss Update Notice` SHALL write the composite key. The maintenance entries (`run-kit: Update Now`, `run-kit: Restart Daemon`) keep their existing gates.

- **GIVEN** a single run-kit match
- **WHEN** the palette actions build
- **THEN** the update action reads `run-kit: Update to v{latest}` (today's label)
- **GIVEN** a multi-tool match
- **THEN** the update action reads a count/multi form and dismiss writes the composite key

#### R17: post-remediation re-check closes the 6h staleness window
After spawning a scoped `shll update` (non-force scoped and force sweep alike), `handleUpdate` SHALL schedule a delayed re-check (~2 minutes, daemon-context-bound) that re-runs the checker's fetch+match pass, so a consumed match propagates as a cleared/changed verdict (R7 fire → R8 broadcast → R13 clear) within minutes instead of waiting for the 6h tick. The checker SHALL expose an exported re-check trigger for this. When run-kit was in the spawned scope the daemon restarts and the timer dies with the process — harmless. The shll-absent `rk update` fallback path needs no re-check (the restart already resets state). <!-- rework cycle 1: without this, the cleared verdict waits up to 6h, leaving the chip advertising already-installed updates and 409-ing on click -->

- **GIVEN** a scoped `shll update fab-kit` spawn completed (run-kit not in scope, daemon still running)
- **WHEN** the delayed re-check fires (~2min after the 202)
- **THEN** the checker recomputes the verdict (brew list now shows the new fab-kit), the key changes (empty or reduced), `OnQualify` fires, and clients receive the cleared/updated verdict
- **GIVEN** the daemon restarted before the timer fired (run-kit was in scope)
- **THEN** nothing fires (process-local timer) and the fresh daemon's initial 30s check covers it

### Non-Goals

- No GitHub-releases fallback fetch when the manifest is unreachable (stale-while-revalidate + full-revert escape hatch cover it).
- No change to `shll update` itself (subset semantics already shipped in shll v0.1.5).
- No Web Push for update notices (unchanged — in-app chip only).
- No new persistence beyond the existing in-memory verdict (Constitution II).

### Design Decisions

1. **`brew list --versions` seam lives in `internal/updatecheck` as a package-var** — *Why*: mirrors the existing `fetchFn` seam idiom (test-substitutable, no new package for one narrow exec), context-bound per Constitution I. *Rejected*: a standalone `internal/brew` package (over-engineered for one call, no other consumer).
2. **`ToolUpdate{Tool, Installed, Latest}` + `Key`** replace the flat verdict — *Why*: the composite key is a pure function of the matched set, computed once in the checker so the SSE layer and frontend never re-derive it. *Rejected*: keeping `Qualifies bool` (a bool cannot express which tools matched).
3. **Legacy `current`/`latest` retained in Result and SSE payload** — *Why*: transitional compat for a not-yet-reloaded frontend (intake §3/§9), removable later. Populated from the run-kit row only.
4. **Chip multi form = `⬆ updates (N)`** — *Why*: intake §4 leaves exact presentation to apply within the contract "communicate which tools"; a count glyph + per-tool detail in title/menu row is the minimal legible form matching the existing `⬆` vocabulary.
5. **Cleared verdicts are first-class events; a post-remediation re-check makes them timely** (rework cycle 1) — *Why*: a siblings-only `shll update` never restarts the daemon, so nothing naturally cleared the consumed match: the chip stuck on `updating…`, the cached SSE slot replayed a stale match to every new tab, and a later click 409-ed. Firing `OnQualify` on any key change (incl. →empty), broadcasting the cleared verdict into the slot, clearing frontend state on key change, and a ~2min post-spawn re-check close the loop end to end. *Rejected*: a frontend-only `updating` timeout (leaves the stale advertised verdict for up to 6h); tracking the detached child's exit (the spawn deliberately outlives the daemon and cannot be waited on reliably).
6. **A failed brew upgrade leaves the chip on `updating…` until the verdict changes** (accepted residual) — *Why*: the re-check recomputes from brew reality; if the upgrade failed, the key is unchanged and `updating` persists — same failure envelope as today's rk-only flow (which relied on a reload that never came). The palette force path and a page reload remain the escape hatches.

## Tasks

### Phase 1: Backend — checker core

- [x] T001 Rewrite `app/backend/internal/updatecheck/updatecheck.go`: replace `releasesLatestURL`/`defaultFetch` with a manifest fetch of `https://shll.ai/versions.json` decoding `{schema, generated_at, tools:{name:{latest,notify,formula}}}`; keep `fetchTimeout`/`initialCheckDelay`/`checkInterval`/`devVersion` constants and suppression behavior. <!-- R1 R2 -->
- [x] T002 In `updatecheck.go` add the match layer: `ToolUpdate{Tool,Installed,Latest string}`, a `crossesThreshold(installed, latest, notify)` helper (never/patch/minor semantics reusing/adjacent to the existing `parseMajorMinor`/`qualifies` logic), and a `computeKey(matched)` producing sorted `tool@latest` comma-joined. <!-- R3 R6 -->
- [x] T003 In `updatecheck.go` add the installed-version sources: a `brewListFn` package-var seam running `brew list --versions <formula…>` (context-bound, Constitution I) parsing `<formula> <version>` lines into a formula→version map; a `lookShllFn` seam wrapping `exec.LookPath("shll")`; the run-kit row uses the running ldflags version + `selfpath.IsBrewInstalled`; other tools join on the manifest `formula`. <!-- R4 R5 -->
- [x] T004 In `updatecheck.go` rewrite `Result` to `{Matched []ToolUpdate, Key string, Current, Latest string}`, rewrite `checkOnce` to fetch→match→compute-key→store, and change the `OnQualify` fire gate to "Key changed at all — including to empty" (the cleared verdict fires; an unchanged key, empty or not, never fires). Fix the `Result.Matched` doc comment to say "deterministic sorted-name order" (not "manifest/roster order"). Update `New`/`Snapshot`/`SetFetchForTest`/`CheckOnceForTest` seams as needed; keep `OnQualify func(Result)` or a compatible signature. <!-- R6 R7 --> <!-- rework: fire gate must include key→empty so consumed matches clear; comment wording drift (review cycle 1) -->

### Phase 2: Backend — tests for checker

- [x] T005 Rewrite `app/backend/internal/updatecheck/updatecheck_test.go` around a manifest fixture: cover manifest parse, `crossesThreshold` never/patch/minor table, brew-join (missing formula → no match), shll-absent scoping (run-kit row only), run-kit brew-gate (dev/go-install never self-matches), composite key ordering, and OnQualify fire/refire/no-refire on key change — including the key→empty cleared-verdict fire and the empty→empty no-fire. Keep the suppression + stale-while-revalidate tests. <!-- R1 R2 R3 R4 R5 R6 R7 --> <!-- rework: add cleared-verdict fire cases (review cycle 1) -->

### Phase 3: Backend — SSE + wiring

- [x] T006 Update `app/backend/api/sse.go` `broadcastUpdateAvailable` to accept the checker verdict (matched tools + key) and marshal `{tools:[{tool,current,latest}],key,current,latest}` (legacy `current`/`latest` from the run-kit row, empty otherwise) into `cachedUpdateAvailableJSON` + the fan-out — including cleared verdicts (empty tools/key), which replace the cached slot rather than being skipped; `replayGlobalSlots` unchanged (still replays the slot). <!-- R8 --> <!-- rework: cleared verdict must broadcast + replace the slot (review cycle 1) -->
- [x] T007 Update `app/backend/api/tmuxctl_bridge.go` `WireUpdateAvailableBroadcast` signature to match the new `OnQualify` shape and `app/backend/cmd/rk/serve.go` wiring (likely signature-only). <!-- R8 -->

### Phase 4: Backend — remediation

- [x] T008 Rewrite `app/backend/api/update.go` `handleUpdate`: add a `lookShllFn`/`exec.LookPath("shll")` seam; shll-present non-force → 202 + spawn detached `shll <path> update <matched…>` via a generalized spawn seam (spawn binary at path); force → `shll update` full-roster sweep (skip qualify 409); shll-absent → today's brew-409 + qualify/force + `rk update` self path verbatim. Read the match set from the checker snapshot. <!-- R9 R10 R11 R12 -->
- [x] T009 Update `app/backend/api/update_test.go`: add shll-present scoped-argv, force-sweep, and shll-absent-fallback cases (stubbing the shll lookup + spawn seam); keep the existing brew-409/qualify/force/second-click cases on the shll-absent path. <!-- R9 R10 R11 R12 -->

### Phase 5: Frontend — context, chip, palette

- [x] T010 Update `app/frontend/src/contexts/session-context.tsx`: generalize `updateAvailable` to `{tools:[{tool,current,latest}],key,current,latest}` (retain `current`/`latest` fields), change `updateNow`/dismissal to the composite `key` in `runkit-update-dismissed`, and update `useUpdateNotification()` (`qualifies` = non-empty tools && !dev; expose `tools` + `key`; `showChip` = qualifies && key !== dismissedKey). `applyUpdateAvailable` must apply cleared payloads (empty key clears the stored state — no early return), and `updating` must clear when an event's key differs from the click-time key (record the key at click). Hoist a module-level frozen empty-tools constant so `updateAvailable?.tools ?? []` doesn't mint a new array per render. Update `StandaloneSessionContextProvider` defaults + the SSE `update-available` handler. <!-- R13 R14 --> <!-- rework: clear-on-empty-key + updating-clears-on-key-change; empty-array identity churn (review cycle 1) -->
- [x] T011 Update `app/frontend/src/components/top-bar.tsx` `UpdateChip` (and the overflow-menu version-row in `top-bar-overflow-menu.tsx`): single run-kit match keeps `⬆ v{latest}`; multi/non-run-kit shows `⬆ updates (N)` with per-tool `tool v{a} → v{b}` transitions in title/aria and the version row. <!-- R15 -->
- [x] T012 Update `app/frontend/src/lib/palette-update.ts` `buildUpdateActions` for the single/multi label split and composite-key dismissal wiring; `buildMaintenanceActions` unchanged. <!-- R16 -->
- [x] T013 Update the frontend tests: `app/frontend/src/components/update-chip.test.tsx` (multi-tool render + composite-key dismissal + single-run-kit unchanged), `app/frontend/src/lib/palette-update.test.ts` (single/multi labels), and any `session-context` consumers touched — add cleared-payload (chip hides, no early return) and updating-clears-on-key-change cases. <!-- R13 R14 R15 R16 --> <!-- rework: cover the clearing behaviors (review cycle 1) -->

### Phase 6: Rework additions (review cycle 1)

- [x] T015 Add the post-remediation re-check: an exported checker trigger (e.g. `RecheckAfter(d time.Duration)` or an equivalent seam on `Checker`, daemon-context-bound, test-substitutable) and a call from `api/update.go` after both scoped-spawn paths (non-force scoped + force sweep; NOT the shll-absent `rk update` fallback). Unit-test the scheduling seam in `update_test.go` (spawn → trigger recorded) and the checker trigger in `updatecheck_test.go`. <!-- R17 -->
- [x] T016 Deduplicate the per-tool summary: export one `updateChipToolSummary` helper (single source — e.g. from `app/frontend/src/lib/palette-update.ts` or a small shared module) and consume it in both `app/frontend/src/components/top-bar.tsx` and `app/frontend/src/components/top-bar-overflow-menu.tsx` (kill the inline `toolSummary` copy). Comment fixes: `app/backend/api/update_test.go` ~:84 ("shllAbsent" → the actual `errNoShll` var name), `app/frontend/tests/e2e/_state-socket-mock.ts` ~:41 (describe the new `{tools,key,current,latest}` payload shape). <!-- R15 --> <!-- rework: bar↔menu drift-class duplication + stale comments (review cycle 1) -->

### Phase 7: Verify

- [x] T014 Run `just test-backend`, `cd app/frontend && npx tsc --noEmit`, and scoped `just test-frontend` for the touched specs; fix failures. <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13 R14 R15 R16 R17 -->

## Execution Order

- T001 → T002 → T003 → T004 (checker built up in dependency order)
- T005 after T004 (tests the finished checker API)
- T006 → T007 after T004 (SSE consumes the new verdict)
- T008 → T009 after T004 (remediation reads the snapshot; independent of SSE)
- T010 → T011, T012 after the backend payload shape is fixed (T006); T013 after T010–T012
- T015 after T004 (uses the checker trigger); T016 after T011 (dedups its helper)
- T014 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The checker fetches `https://shll.ai/versions.json` and parses `{schema, generated_at, tools:{name:{latest,notify,formula}}}`; no `api.github.com` reference remains.
- [x] A-002 R2: Cadence constants (30s/6h), dev/unparseable whole-checker suppression, and stale-while-revalidate are preserved (covered by retained tests).
- [x] A-003 R3: `crossesThreshold` implements never/patch/minor with patch-only never matching under `minor`.
- [x] A-004 R4: run-kit row = running ldflags version + `IsBrewInstalled`; other tools joined from `brew list --versions <formula>`; a formula with no brew line never matches.
- [x] A-005 R5: `exec.LookPath("shll")` failing scopes matching to the run-kit row only, fail-silent.
- [x] A-006 R6: `Result` carries `Matched []ToolUpdate` + composite `Key` (sorted `tool@latest`, comma-joined; empty when none).
- [x] A-007 R7: `OnQualify` fires on ANY change of `Key` — including key→empty (cleared verdict) — and never on an unchanged key (empty or not).
- [x] A-008 R8: `update-available` payload carries `{tools,key,current,latest}` with legacy fields from the run-kit row (empty when run-kit absent); a cleared verdict broadcasts and replaces the cached slot; still server-global + replayed.
- [x] A-009 R9: shll-present non-force spawns detached `shll update <matched…>` after 202; empty match set 409s first.
- [x] A-010 R10: `force:true` with shll present spawns `shll update` (no tool args) and skips the qualify 409.
- [x] A-011 R11: shll-absent path is byte-behavior-identical to today (brew-409 + qualify/force + `rk update` self), and the brew-409 applies only there.
- [x] A-012 R13: `useUpdateNotification` exposes matched tools + key; `qualifies` = non-empty tools && !dev.
- [x] A-013 R14: dismissal stores/reads the composite key; a key change re-shows the chip.
- [x] A-014 R15: the chip shows `⬆ v{latest}` for a single run-kit match and a count form (with per-tool detail) otherwise.
- [x] A-015 R16: palette update-action labels follow the single/multi split and dismiss writes the composite key.

### Behavioral Correctness

- [x] A-016 R6: For a run-kit + fab-kit match the `Key` is exactly `fab-kit@2.17.0,run-kit@3.9.0` (sorted), and `Matched` is in deterministic sorted-name order.
- [x] A-017 R12: No in-flight lock — two rapid clicks each 202 + spawn.
- [x] A-023 R17/R13: After a scoped siblings-only `shll update`, the delayed re-check produces a cleared/changed verdict that broadcasts, replaces the cached slot, hides the chip, and clears `updating` — no permanently stuck `updating…`, no stale replay to new tabs, no 409-on-click of an already-consumed match (verified at unit level across checker/SSE/context tests).

### Edge Cases & Error Handling

- [x] A-018 R2: A `versions.json` 404 (sibling change not yet shipped) retains the empty verdict → chip stays hidden (no crash, no error surfaced).
- [x] A-019 R4/R11: A `shll`-present-but-run-kit-not-brew daemon still updates other matched tools (no brew-409), while the run-kit row simply never matches.

### Code Quality

- [x] A-020 Pattern consistency: New code follows the existing seam idiom (`fetchFn`/`brewListFn`/`lookShllFn` as substitutable package vars or struct fields), error handling (`slog.Warn` + retain), and Go naming of the surrounding files.
- [x] A-021 No unnecessary duplication: the composite-key derivation lives once (checker); the SSE + frontend consume it. The spawn seam is the single generalized `spawnSelfFn(path, logName, args…)`.
- [x] A-024 No unnecessary duplication: the per-tool `tool v{a} → v{b}` summary helper has exactly one exported definition consumed by both the top bar and the overflow menu.

### Security

- [x] A-022 R4/R9: The `brew list --versions` and `shll update` execs use `exec.CommandContext` (brew) / the detached-spawn exception (shll update, documented) with explicit argument slices and no shell string; matched tool names in the `shll update` argv originate from the manifest roster (not free user input), and the detached spawn follows Constitution I's documented outlive-the-daemon exception.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `updatecheck.Result.Current`/`.Latest` (`app/backend/internal/updatecheck/updatecheck.go`), the SSE payload's top-level `current`/`latest` (`app/backend/api/sse.go` `broadcastUpdateAvailable`), and `UpdateAvailable.current`/`.latest` (`app/frontend/src/contexts/session-context.tsx`) — transitional compat for not-yet-reloaded frontends (Design Decision 3); removable once deployed daemons have restarted past this release.
- `app/frontend/tests/e2e/_state-socket-mock.ts` `updateAvailable` mock option — zero `.spec.ts` consumers (its doc comment now describes the current `{tools,key,current,latest}` shape); delete or keep alongside the first e2e spec that exercises the chip.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `brew list --versions` seam lives as a package-var in `internal/updatecheck` (not a new `internal/brew` package) | Mirrors the existing `fetchFn` seam idiom; one narrow exec, no other consumer; keeps Constitution I timeout local | S:55 R:85 A:80 D:75 |
| 2 | Confident | `Result` = `{Matched []ToolUpdate, Key, Current, Latest}`; `ToolUpdate{Tool,Installed,Latest}` | Directly from intake §3; the composite key is computed once in the checker | S:70 R:80 A:85 D:80 |
| 3 | Confident | `OnQualify` signature changes to carry the whole `Result` (matched + key) rather than `(current, latest)` | The broadcast needs the full matched set + key; passing the verdict is the least-surprising generalization | S:55 R:80 A:80 D:70 |
| 4 | Tentative | Chip multi form = `⬆ updates (N)` with per-tool `tool v{a} → v{b}` in title/aria + version row | Intake §4/§12 explicitly leaves presentation to apply within the "communicate which tools" contract; a count glyph is the minimal legible form matching the `⬆` vocabulary | S:40 R:90 A:70 D:55 |
| 5 | Confident | Legacy top-level `current`/`latest` retained in Result + SSE payload, populated from the run-kit row (empty otherwise) | Intake §3/§9 — transitional compat, low cost, removable later | S:60 R:90 A:85 D:75 |
| 6 | Confident | `shll` lookup seam (`lookShllFn` / `exec.LookPath`) is shared conceptually across checker (§2 scoping) and handler (§5 remediation) but implemented per-file as a local seam | Matches the file-local seam pattern (each file owns its substitutable var); avoids a premature shared helper | S:50 R:85 A:80 D:70 |
| 7 | Confident | Composite key format = `tool@latest` pairs, sorted lexicographically by the joined pair, comma-joined | Intake §3 states "sorted `tool@latest` pairs comma-joined" with example `fab-kit@2.17.0,run-kit@3.9.0` (sorts by tool name) | S:75 R:85 A:85 D:80 |
| 8 | Confident | Post-remediation re-check delay ≈ 2 minutes (single shot, context-bound, dies on daemon restart) | Rework cycle 1 — brew upgrades of a few tools comfortably finish inside 2min; a single cheap re-check, no polling loop; exact constant is apply's call | S:55 R:90 A:80 D:75 |
| 9 | Confident | `updating` clears on any `update-available` whose key differs from the click-time key (incl. cleared); a failed upgrade (unchanged key) leaves `updating` until manual action | Rework cycle 1 — the changed-key event is the only reliable completion signal without child tracking; failure envelope matches today's | S:55 R:85 A:80 D:70 |
| 10 | Confident | `RecheckAfter` uses two test seams: same-package `afterFuncFn` package-var (real timer, checker unit tests) + an exported `SetRecheckHookForTest` delay-recording hook (cross-package api handler test) | Apply (rework cycle 1) — the api test cannot reach the internal `afterFuncFn`; a small exported hook mirrors the existing `Set*ForTest` seam idiom and keeps the handler asserting "spawn → re-check scheduled with the ~2min delay" without a real daemon context or timer | S:60 R:85 A:80 D:70 |
| 11 | Confident | Module-level `EMPTY_TOOLS` is `Object.freeze([])` typed as mutable `UpdateTool[]` via an `unknown` cast (frozen at runtime; type stays mutable to match the exported `tools` contract) | Apply (rework cycle 1) — a `readonly` type would ripple through `updateChipToolSummary`/`buildUpdateActions` consumers; the freeze gives the real no-mutation guarantee while the cast avoids the churn; single stable reference is the actual goal | S:55 R:90 A:80 D:70 |

11 assumptions (0 certain, 10 confident, 1 tentative).
