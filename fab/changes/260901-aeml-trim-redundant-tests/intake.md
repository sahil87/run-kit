# Intake: Test Suite Consolidation — Trim Redundant Tests

**Change**: 260901-aeml-trim-redundant-tests
**Created**: 2026-09-01

## Origin

> Do a check of all of the tests in runKit and see which of them are redundant and maybe check features that are no longer relevant. Maybe we can trim the number of tests being used here to a more manageable number.

Conversational (`/fab-discuss` session, 2026-09-01). Four parallel read-only audit subagents swept the full test surface (2,048 Go test funcs · 3,430 Vitest cases · 378 Playwright e2e tests — an earlier 777 e2e figure was a miscount that included `describe`/`beforeEach` lines). Headline finding: **no dead-feature tests exist anywhere** — every suspected retirement (`@rk_win_lens` view-switcher, `rk present`, un-prefixed tmux options) is still-live shim or grace-period code — but ~200–230 tests are redundant or mechanically mergeable, concentrated where tests are most expensive. The user approved a **single change with a five-commit structure** (quoted in § What Changes) and asked for the branch to be rebased onto latest origin/main first (done — HEAD is now `c5c1ac8d`, which includes PR #783's web-tab strip rework, landed AFTER the audits ran; see the re-verification constraint below). The user then directed the change to run through `/fab-fff`.

## Why

1. **Pain**: the suite has accreted to ~5,850 tests. The e2e layer (real Go server + per-worktree tmux socket family) is the most expensive and carries two self-described "run on demand" latency AUDIT specs that nothing actually excludes from the default run (~3–5 min of a CI shard), plus ~30 tests that duplicate coverage owned elsewhere — several of them known flake donors (full reloads, 30–45s explicit budgets, dispatched-pointer-event animation tests). In Go, ~21 structurally identical option-flag tests each boot their own live tmux server.
2. **Consequence of not fixing**: CI wall-time and flake surface keep growing; duplicate absence-guards (one contract asserted in up to four places) multiply the cost of every future UI change; the ~60 tests tied to one-release compat shims will silently outlive their shims (a prior src-only removal sweep broke CI because it missed e2e — project memory).
3. **Approach**: trim (deletions of strict subsets/duplicates) + gate (perf audits out of the default run) + table-merge (mechanical near-duplicates, zero coverage loss) + tag (compat-shim tests with a grep-able retirement marker so they die with their shims). Deletions and rewrites never mix in one commit, keeping review tractable.

## What Changes

Five areas, mapping 1:1 to the approved commit structure:

1. Gate the latency-audit e2e specs out of the default run
2. Pure deletions (e2e + unit/Go strict subsets and literal duplicates)
3. Table merges, Go
4. Table merges, Vitest
5. Tag compat-shim tests with a retirement marker

**Global constraint — re-verify before every edit**: all file:line references below were collected on a pre-`c5c1ac8d` HEAD (before PR #783, a web-tab strip rework). Line numbers may have drifted and individual tests may have been renamed/removed. For EVERY candidate: locate the test by title/content (not line number); for every deletion, first verify the claimed owning coverage still exists at its cited home; skip (and note in the result) any candidate that no longer matches. Web-tab-adjacent candidates (`web-tile-chrome`, `web-view-lens`, `web-tile-zoom`) need particular care.

### 1. Gate latency-audit specs out of the default e2e run

`app/frontend/tests/e2e/echo-latency.spec.ts` (4 tests) and `app/frontend/tests/e2e/sync-latency.spec.ts` (9 tests) self-describe in their file headers as audits — "does NOT assert a latency budget… Run on demand: `just pw test echo-latency`" — yet neither `playwright.config.ts` nor CI excludes them. echo-latency runs 110 echo round-trips + a burst flood serial (`workers: 1`) under a 90s (120s CI) budget; sync-latency's test 8 asserts a *minimum* latency.

Mechanism: tag both specs' `test.describe` titles with `@perf` and exclude via `grepInvert: /@perf/` in the default Playwright config path, so `just test-e2e` and CI skip them while `just pw test echo-latency` (explicit name match) still runs them. <!-- assumed: tag+grepInvert over a separate Playwright project — lighter touch on playwright.config.ts/scripts/test-e2e.sh; verify at apply that `just pw test <name>` bypasses grepInvert (it matches by filename arg, but the config-level grepInvert may still apply — if it does, use an env-gated grepInvert, e.g. skip the exclusion when RK_E2E_PERF=1, and document the on-demand invocation in the spec headers) -->

The create/rename/kill flows sync-latency drives remain covered by `sidebar-window-sync.spec.ts`, `session-name-prompt.spec.ts`, and `api-integration.spec.ts`.

### 2. Pure deletions — strict subsets and literal duplicates

Every deletion below cites its surviving owner. Update each touched spec file's header comment and any surviving tests' `Proves:/Steps:` JSDoc in the same commit (constitution § Test Intent Comments).

**E2E (high confidence):**
- `operator-digest.spec.ts:208` — byte-for-byte duplicate of `operator-compose.spec.ts:220` (whose `getByRole("option", {name: /^Operator:/}).toHaveCount(0)` covers all four Operator entries). Also its 409-toast test repeats compose's `throwOnError` seam. operator-digest 4→2.
- `sse-connection.spec.ts` — delete the whole file (1 test): "Connected dot + session appears" is the shared `gotoServerReady` precondition of nearly every spec and strictly subsumed by `api-integration.spec.ts:194` and `sidebar-window-sync.spec.ts` test 1.
- `smoke.spec.ts` — delete: one intentionally-skipped no-op ("Proves: nothing").
- `top-bar-overflow.spec.ts:720` "no view-toggle anywhere at any width" — fourth copy of one absence contract; owners: unit `src/components/top-bar.test.tsx:1426` + `web-view-lens.spec.ts:198` + `chat-view.spec.ts:263`.
- `chat-view.spec.ts:371` "Ctrl+` no longer flips to the chat lens" — strict subset of `surface-layout.spec.ts:726` (Ctrl+` inert + ⛶ zoom, proves live behavior too).
- `right-panel.spec.ts:652` code-toggle chord arms — third copy; owners: `surface-focus-chords.spec.ts:247` and `shortcut-registry.spec.ts:937`. Carries a 30s budget.
- `code-surface.spec.ts:484` "keyboard spike: chord reclaim inside iframe" — exploratory spike superseded by productionized `surface-focus-chords.spec.ts:338` + `web-tile-find.spec.ts` (a).
- `zen-mode.spec.ts:171` — core (arity-2 enter/zoom + chord-exit/unzoom) owned by `surface-focus-chords.spec.ts:413` (c), which additionally covers arity 1 + focused-tile choice. Keep zen-mode `:122` (preference-non-write, exit button) and `:212` (palette). 45s budget.
- `right-panel.spec.ts:430` hide-never-unmount — subset of `code-surface.spec.ts:437` (also proves tile coexistence).
- `right-panel.spec.ts:548` + `:578` open-persists/closed-persists (a full reload each) — merge into ONE round-trip test; `surface-layout.spec.ts:467` proves the same option-persistence mechanism. <!-- assumed: merge-to-one over drop-both — keeps one panel-specific persistence proof -->
- `bottom-bar-chip-size.spec.ts:112` "bar does not render at mobile width (fine pointer)" — same gate as `bottom-bar-safe-floor.spec.ts:157` (which adds kb-open-cannot-resurrect).
- `row-identity-tips.spec.ts:144` server-tile hover card — same card + no-native-title assertions inside `server-panel-grid.spec.ts:58`.
- `web-view-lens.spec.ts:501` "legacy @rk_win_lens=iframe dual-reads as single:web" — Go unit tests own the dual-read (`internal/tmux/tmux_test.go` `TestParseWindowsLegacyLensFallback` ~:994, `legacy_options_test.go`), and the compat is one-release (`cmd/rk/skill/display.md:85`).
- Reorder specs, 8→3: `server-reorder.spec.ts` (3), `board-list-reorder.spec.ts` (3), `board-reorder.spec.ts` (2) are browserless (`request` fixture). Keep ONE happy-path round-trip per endpoint (real tmux rank write); delete the 2 × 400-validation tests (Go owns validate-before-tmux: `api/sessions_test.go:1273`, `api/windows_test.go:140`) and the 3 broadcast tests (Go owns fan-out: `api/sse_test.go` `TestBroadcastServerOrderFansOutToAllClients` / `TestBroadcastBoardOrderFansOutToAllClients`, `internal/settings/settings_test.go:313`).
- Shim-matrix arms (~4): the `translateLegacyParams` pure mapping is unit-owned (`src/lib/surface-layout.test.ts:191`). Delete `code-surface.spec.ts:373` (`?view=code` arm), `right-panel.spec.ts:527` (`?panel=bogus`), ONE of `right-panel.spec.ts:614` / `code-surface.spec.ts:402` (both prove shim→invalid-grammar→`single:tty`), `web-view-lens.spec.ts:307` (plain `?view=web`; keep `:339`, which adds the onboarding angle). Keep `surface-layout.spec.ts:178` (one legacy-combo end-to-end) + one invalid fall-through.

**E2E (medium confidence — delete, but drop from scope on any doubt at apply):**
- `shortcut-registry.spec.ts:368` legacy "Help: tmux Keybindings palette entry is gone" — the replacement surface is proven at `:328`.
- `web-tile-chrome.spec.ts:297` "(d) no switch-to-terminal button" — pure absence guard for retired R13; the chrome-row presence is exercised by its (a)–(c) siblings. (Web-tab area — re-verify against #783.)
- `mobile-layout.spec.ts:105` desktop theme-control absence — overlaps `top-bar-refresh.spec.ts` test 1 ("theme toggle renders NOWHERE in bar") and `mobile-layout:55`.
- Sidebar-chord triplication: `shortcut-registry.spec.ts:899` (Win/Linux stateful arms), `:700` (mac, same arms), `surface-focus-chords.spec.ts:495` (mac, arms + Escape + no-recording). Thin `:700` to per-platform binding-resolution only (its unique bit), leaving the arm walks to the other two.
- `status-bar.spec.ts:272` + `:307` — two arms of the one `useIsMobile()` width-OR-coarse predicate; merge to one parameterized test.
- `window-heading.spec.ts:863` + `:939` decorative hover-animation choreography via dispatched pointer events (self-documented flake workarounds; file is a known flake source) — keep one, delete the other.

**Vitest strict subsets / literal duplicates:**
- `src/api/client.test.ts:672` "does not deduplicate POST requests" vs `:752` "does not deduplicate non-GET (POST) requests" — literal duplicate, keep one; `:740` "both callers can independently read the JSON body" is a strict subset of `:657` (asserts both results already).
- `src/components/top-bar.test.tsx:463` "renders no connection dot" and `:457` "does not show live/disconnected text" — strict subsets of `:542` (asserts across all four modes). Keep the spec-cited `:1426` view-lens tombstone.
- `src/hooks/use-optimistic-action.test.ts` — the granular callback cases `:61`, `:114`, `:129`, `:76` are strict subsets of the two "full lifecycle" cases `:229`/`:260`; keep the lifecycles, delete the subsets (~4).
- `src/lib/palette/move.test.ts` — the "Board: Move up/down" describe (`:104`, 5 cases) re-runs identical up/down/boundary/absent shapes of `computeMoveOrder` already covered at `:49`; also "moves the first element down"/"moves the last element up" are subsets of the plain up/down cases (~5–6).
- `src/contexts/optimistic-context.test.tsx:187` ghost-reconcile vs `:293` ghost-lifecycle — near-duplicate, keep the lifecycle (~1).
- `src/hooks/use-keybinding-dispatch.test.ts:53` — re-tests `shouldSuppressChord`, owned by 5 dedicated cases in `src/lib/keybindings.test.ts:1425-1462` (~2).

**Go strict subsets:**
- `api/sessions_test.go:1160` `TestSessionColorInvalidValue` — strict subset of the table-driven `TestSessionColorRejectsMalformed` (`:1122`, same route, same 400 assertion).
- `api/windows_test.go:141-166` `TestWindowOptionsColorOutOfRange` + `TestWindowOptionsColorNonNumeric` — same handler assertion twice; merge into one (or fold into commit 3's guard loop).

### 3. Table merges — Go (zero coverage loss; every current assertion becomes a table row)

- `internal/tmux/tmux_test.go` (~lines 2822–3208): the server-flag families `TestIsEphemeralServer_*` (4) + `TestMarkServerEphemeral_*` (1) + `TestIsProtectedServer_*` (4) + `Test*_legacyOnlyReturnsTrue` (2) + `TestUnmarkServerProtected_*` (1) + `TestIsGuardedServer_*` (4) + `TestIsManagedServer_*` (5) are structurally identical set/unset-after-set/never-set/no-server bodies, EACH booting its own live tmux server via `withSessionOrderTmux(t)`. Merge to a table over {option family} × {state} sharing one server (~21→4) — this is the one merge that buys real runtime. Same file: `Get/SetSessionOrder_*` (6), `Get/SetServerRank_*` (4), `Get/SetServerOrigin_*` (3) are one round-trip template (~13→3). Total ~34→7.
- `internal/settings/settings_test.go`: per-key template quintuplets (`ParseX` / `SerializeX` / `SerializeEmptyXIsByteIdentical` / `XRoundTrip` / `XCoexistsWith…`) for ServerColors, ServerFlairs, BoardOrder, InstanceColor, SSHHost/InstanceName, TmuxConf/LogLevel — the five `SerializeEmptyXIsByteIdentical` tests assert the IDENTICAL expected string. Replace with one table-driven parse test, one serialize test, one empty-is-byte-identical test, and one round-trip loop over the registry (auto-covers future keys). ~28→9.
- api/ per-route guard tests: 13 `Test*InvalidWindowID` + 6 `Test*InvalidJSON` each prove "bad windowId/body → 400, zero tmux calls" for one route (`TestDecodeWindowID` already tables the validator). Merge **per-file only** (different mock harnesses across files) into a loop over that file's routes. ~19→6.
- `cmd/rk/skill_test.go`: `{Cmd,Display,Code,Mux} × {PrintsByteIdentical, EmbedMatchesCanonical, WithinLineBudget}` grid → 3 table tests over topics (free coverage for the next topic). 12→3.

Out of scope (deliberate): the `*CommandRegistered`/`*Flag_Registered` tests (tiny cost, opportunistic only); the quiet/channel wording tests in cmd/rk (they encode the shll-toolkit CLI channel contract — constitution § Toolkit Standards); `internal/prstatus` and all packages the audit called healthy.

### 4. Table merges — Vitest

- `src/lib/shell.test.ts` (~lines 576–700): the bridge groups `reorder/remove/removeConfirmed/rename/setHostUrl/add/addDirect/badge/accent/windows/switch` each repeat verbatim four shapes (ok-ack→true, plain-browser+older-shell→unavailable, non-function member→unavailable, denied+rejected→false) — copy-paste bodies differing only in the invoker. One `it.each` over `[canFn, invoker, bridgeKey, args]` collapses ~40→~5. KEEP the genuinely distinct cases: `removeConfirmed` independence (`:704`), `addDirect` error-string carriage, optional-fields parse. Biggest single unit-test win.
- `src/api/client.test.ts`: `createWindow` 5 cases (`:207-268`: base, ±cwd, ±name) → 2; the per-wrapper "throws the server's error message on failure" repeated ~8× (openInApp, sendChatMessage, sendToWindow, recovery ×3, fetchWindowHistory, setSessionOrder — all one shared request-helper error path) → keep the distinct shapes (`ApiError` status+code, code-less tolerance) + 1–2 representatives; `getSSHHost/setSSHHost/getInstanceName/setInstanceName` (`:1336-1412`, same registry-key pattern) → table. ~15–20 total with the deletions in area 2.
- `src/components/sidebar/window-row.test.tsx`: "dot status signals" (8 cases, `:322-474`) — WindowRow passes `win` to `StatusDot` verbatim; every case is owned by `status-dot.test.tsx` at both model and render level. Keep 1–2 threading cases (dot present with derived label; one PR-eviction). "rest-state PR glyph" (`:481-651`): the component interpolates `prGlyphColor(win)` verbatim (`window-row.tsx:952`) and `pr-status-model.test.ts` enumerates the color map in 24 cases — collapse the ~5 color-only cases to one "applies prGlyphColor's class"; KEEP shape-selection and slot-discipline cases (draft rail, closed ✕, no-glyph gates). ~10–11.
- `src/components/sidebar/status-panel.test.tsx` shortenPath block (`:170-236`): home-substitution rows duplicate `abbreviateHomePath`'s table in `src/lib/format.test.ts` (the canonical home) — keep the …/last-two-segments truncation rules + title-preservation, table-merge the rest. ~6.
- `src/components/sidebar/index.core.test.tsx` (`:469-738`): the window + session inline-rename suites are structurally identical 9-case mirrors (+2 cross-cancellation) — `it.each` over {window, session}. ~20→~12.
- `src/components/pr-status-model.test.ts:155-178` closed-state family (closed / +pass / +fail / +changes-requested / +draft all exercise the single "closed sits above isFailish" branch, same red token) → one `it.each`; `status-dot.test.tsx:106-129` `fabShape`/`fabPhase` one-liners (8) → 2 table cases.
- `src/components/command-palette.test.tsx` "opens on Cmd+K"/"opens on Ctrl+K"/"toggles closed" 3→1 table; `collapsible-panel.test.tsx` defaultOpen trio 3→2.
- `src/components/top-bar.test.tsx:243-320` boot-sweep hover describe (3 cases of visual-polish choreography) → 1.
- Small scatter (each a mechanical table-ize): `lib/router-url.test.ts` (`accepts view=web/chat/code` + `accepts panel=web/code` → 2 tables; multi-digit/round-trip subsets), `lib/gauge.test.ts` (gaugeBar 0/1/0.5/clamps + formatBytes per-unit → 2 tables), `contexts/chrome-context.test.tsx` (compose-strip + scroll-lock boolean-pref suites are copy-paste: default/rehydrate/toggle-on/toggle-off/write-throw → parametrize; font-size clamp pairs), `contexts/theme-context.test.tsx` (legacy `'dark'`/`'light'`/invalid → table; theme-color meta dark/light/dracula), `lib/top-bar-overflow.test.ts:10-27,63` (five `returns 0` cases → one table), reorder-hook trio `use-server-reorder`/`use-board-pane-reorder`/`use-board-list-reorder` (within each, insert-before splice permutations → up/down + one boundary; KEEP the per-hook MIME-discrimination trios).

Out of scope (deliberate): `lib/keybindings.test.ts` per-binding default pins (the prose encodes the host-matrix contract — merging risks losing the rationale), all tombstone absence tests except the two top-bar strict subsets above, `compose-strip.test.tsx` / `surface-layout.test.tsx` / `window-transition.test.ts` / `session-context.test.tsx` (audited healthy), the five 1-test boards e2e files (fuse-don't-trim is a separate concern), per-feature palette-parity e2e tests (Constitution V contract), `pwa-assets.spec.ts`.

### 5. Tag compat-shim tests with a retirement marker

These tests are CORRECT TODAY (their shims are live) and are NOT deleted. Add a grep-able one-line comment naming the shim each test dies with, so the shim-removal sweep finds them (a prior src-only sweep missed e2e and broke CI — the marker must make `grep -r "retire-with"` sufficient):

Format: `// retire-with: {shim-name}` (Go/TS) placed directly above the test function/case. <!-- assumed: "retire-with" as the marker token — short, grep-unique in this repo; states the cross-file constraint (which shim owns the test's lifetime) rather than narrating history, so it passes the comment policy -->

- Go, `removeLegacySkill` grace (agent_setup.go:46-86): ~4 tests in `cmd/rk/agent_setup_test.go` — `retire-with: removeLegacySkill`.
- Go, `/present` n-less compat form (`api/present.go:10`): `TestPresentLegacyRootFallback`, `TestPresentBareWindowRedirects` in `api/present_test.go` — `retire-with: present-nless-compat`.
- Go, legacy `@rk_win_url`/`@rk_type` key translation (`api/windows.go:403`): ~7 tests in `api/windows_test.go` — `retire-with: legacy-option-key-translation`.
- E2E: `legacy-color-sweep.spec.ts` (whole file), `legacy-scope-sweep.spec.ts` (whole file) — one-release migration sweeps, Go-owned (`legacy_options_test.go`); marker in the file header comment.
- Do NOT tag `internal/tmux/legacy_options_test.go` itself — the migration sweep is live until `doctor` reports no dirty servers, and those tests guard the sweep, not a shim.

## Affected Memory

- `run-kit/architecture`: (modify) the testing-layers section gains the `@perf` on-demand e2e tier (tagged audits excluded from `just test-e2e`/CI, run via `just pw test <name>`) and the `retire-with:` marker convention for shim-bound tests.

## Impact

- **Test files only** — no production code changes anywhere. Roughly: ~15 e2e spec files (2 deleted whole, others edited), ~5 Go test files, ~18 Vitest files, plus 3–4 tagged files.
- **Config/scripts** (area 1 only): `app/frontend/playwright.config.ts`, possibly `scripts/test-e2e.sh` / `.github/workflows/ci.yml` for the `@perf` exclusion.
- Expected outcome: ~55–65 tests deleted, ~180–200 merged into ~45 table tests, 13 gated out of the default run; ~10–15% e2e wall-time reduction plus the `internal/tmux` server-boot savings; flake surface reduced (several deleted tests are known flake donors).
- **Verification**: `just test-backend`, `just test-frontend`, `just test-e2e` (never raw runners; e2e must not run concurrently with a sibling worktree's run). Known pre-existing e2e failures on clean main exist (web-view-lens had 4 as of 2026-08-29) — before attributing any e2e failure to this change, check whether it fails on clean origin/main. Constitution § Test Intent Comments: every edited spec's `Proves:/Steps:` JSDoc and file headers updated in the same commit.

## Open Questions

*(none — all decision points graded Confident or better; see Assumptions)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Single change, five category-ordered commits (gate → deletions → Go merges → Vitest merges → tagging); deletions and rewrites never share a commit | Discussed — user approved this exact structure ("yes, go ahead") | S:95 R:75 A:90 D:90 |
| 2 | Confident | Latency-audit gating via `@perf` title tag + `grepInvert` in the default config path, not a separate Playwright project | Two viable mechanisms, tag is lighter touch; trivially reversible; apply must verify `just pw test <name>` still reaches tagged specs (fallback: env-gated grepInvert) | S:60 R:85 A:75 D:55 |
| 3 | Confident | Scope = high-confidence + listed medium-confidence candidates; excludes keybindings pins, registered-flag tests, boards-file fusion, palette-parity tests, healthy suites | Audit-graded confidence per candidate, discussed and reflected in the approved plan; medium items carry an explicit drop-on-doubt rule | S:75 R:80 A:80 D:70 |
| 4 | Certain | Compat-shim tests are tagged, never deleted in this change (~60 tests ride with their shims) | Discussed — approved step 5; the shims are live code, deleting their tests would violate Test Integrity | S:85 R:90 A:85 D:80 |
| 5 | Confident | Marker token is `retire-with: {shim-name}` as a code comment above the test (file header for whole-file specs) | Grep-unique, states the cross-file lifetime constraint (comment policy compliant); exact token not user-specified | S:40 R:90 A:60 D:45 |
| 6 | Certain | Every audit-cited file:line is re-located by test title and its owning coverage re-verified before deletion (HEAD moved to c5c1ac8d / PR #783 after the audits) | Forced by the rebase; skip-and-note any candidate that no longer matches | S:80 R:90 A:90 D:85 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
