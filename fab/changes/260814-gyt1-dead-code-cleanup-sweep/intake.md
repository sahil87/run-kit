# Intake: Dead-Code Cleanup Sweep

**Change**: 260814-gyt1-dead-code-cleanup-sweep
**Created**: 2026-08-14

## Origin

One-shot `/fab-new` invocation combining 5 items from the 08-14 memory-distillation backlog batch (`fab/backlog.md`, all relocated there by PR #602). User directive, verbatim:

> Combined dead-code cleanup sweep, 5 items from the 08-14 memory-distillation backlog batch (fab/backlog.md, all relocated by PR #602): (1) [pw7g] Delete BreadcrumbDropdown's labeled-trigger (icon prop) branch — dead in production, no call site passes icon (both switchers are bare-▾). (2) [hn3j] Delete the dead config.ReadSessionColor/WriteSessionColor/parseSessionColor helpers from internal/config/runkit_yaml.go — zero non-test call sites; remove their tests too. (3) [zc6m] Delete updateWindowType() from app/frontend/src/api/client.ts — zero non-test references (only its own client.test.ts case); the backend POST /options endpoint stays (@rk_type remains legitimate substrate state). (4) [tk8p] Route api/pwa.go's readSPAAsset through spa.go's embeddedSPASub seam — it re-implements the fs.Sub(build.Frontend, frontend) lookup inline. (5) [dq2v] Collapse prGlyphColor's fail branch to isFailish and retire prDotState — the non-fail PrDotState states have no UI consumer and are exercised only by direct-call unit tests (260810-aqo6); update/remove those tests accordingly. All 5 independently verified still valid and dead/duplicative as of 2026-08-14. Land as ONE change, one PR. When shipped, tick the 5 boxes [x] in fab/backlog.md (lines currently ids pw7g/hn3j/zc6m/tk8p/dq2v).

All five claims were **re-verified against the working tree at intake time (2026-08-14)** by grep sweeps (including `grep -a` for the NUL-containing `session-tiles.tsx`) and file reads; per-item evidence is recorded under What Changes.

## Why

1. **Pain point**: five independently-confirmed dead or duplicative code paths survive in the tree — an unused component branch, three orphaned Go helpers (typed `*int` against a descriptor that is now a string), an unreferenced API client function, a copy-pasted embedded-FS lookup, and a five-state enum whose only live consumer needs one boolean. Each one is a false lead for readers and a maintenance liability (the duplicated `fs.Sub` lookup in `pwa.go` already made a memory claim — "the same seam mountSPA branches on" — literally untrue).
2. **Consequence of not fixing**: dead paths keep accruing test surface (the session-color helpers carry ~13 test functions for code nothing calls), keep misleading greps and memory docs, and the `pwa.go` copy can drift from the `spa.go` seam (tests that override `embeddedSPASub` don't cover `pwa.go`'s reads today).
3. **Approach**: one combined removal/refactor change, one PR — the items are small, non-overlapping, and share a theme; batching them avoids five trivial PRs. Explicitly directed by the user.

## What Changes

### 1. [pw7g] BreadcrumbDropdown — delete the labeled-trigger (`icon` prop) branch

`app/frontend/src/components/breadcrumb-dropdown.tsx`:
- Remove `icon?: string` from `Props` (line 14) and from the destructure (line 31).
- Trigger content: `<span className="min-w-0 truncate">{icon ?? "▾"}</span>` (line 173) becomes the bare `▾` caret; delete the entire `{icon != null && (...)}` persistent-caret block (lines 178–185) and its "Persistent caret" comment — that block only ever rendered alongside a passed `icon`.

**Verified**: the only production call sites are the window switcher (`top-bar.tsx:989`) and board switcher (`top-bar.tsx:1829`); `grep -n 'icon=' top-bar.tsx` returns nothing — neither passes `icon`. Both are bare-▾ triggers (the `top-bar.tsx:1795` comment says so explicitly). Any `breadcrumb-dropdown` unit test exercising the icon branch is deleted/updated with it.

### 2. [hn3j] internal/config — delete the dead session-color helpers

`app/backend/internal/config/runkit_yaml.go`:
- Delete `ReadSessionColor` (line 31), `parseSessionColor` (line 44), `WriteSessionColor` (line 68), **and their now-orphaned private support functions**: `setSessionColorInContent` (line 82), `removeSessionColorKey` (line 114), `splitYAMLLine` (line 156), and the `runkitYAMLFile` const (line 10) — verified used only by the deleted trio.
- **`FindGitRoot` stays** — live callers in `internal/sessions`, `internal/tmux` (comment), `api/riff.go`, `api/fork.go`, `cmd/rk/riff.go`.
- `app/backend/internal/config/runkit_yaml_test.go`: delete all `TestReadSessionColor_*` / `TestWriteSessionColor_*` functions; keep any `FindGitRoot` tests present in the file.
- Prune imports (`strconv`, likely `strings`) as the compiler requires.

**Verified**: `grep -rn 'ReadSessionColor|WriteSessionColor|parseSessionColor' app/backend/` hits only `runkit_yaml.go` + `runkit_yaml_test.go`. Session color lives in the tmux `@session_color` option (string descriptor); the `*int` typing never matched it.

### 3. [zc6m] api/client.ts — delete `updateWindowType()`

`app/frontend/src/api/client.ts`: delete `updateWindowType` (line 376). It delegates to `setWindowOptions` → `POST /api/windows/{windowId}/options` with `{"@rk_type": ...}`.
- `app/frontend/src/api/client.test.ts`: remove the import (line 32) and its single test case (line 644, "updateWindowType POSTs /options with @rk_type...").
- The comment in `iframe-window.test.tsx:8` mentioning `updateWindowType` is prose only — update or leave per apply judgment (updating it is preferred so the name greps clean).
- **Untouched**: the backend `POST /options` endpoint and `setWindowOptions`/`updateWindowUrl` (the endpoint's live consumers); `@rk_type` remains legitimate substrate state an external process may set.

**Verified**: zero non-test references — only the definition, its own test, and the one test-file comment.

### 4. [tk8p] api/pwa.go — route `readSPAAsset` through the `embeddedSPASub` seam

`app/backend/api/pwa.go` `readSPAAsset` (line 40): the embedded branch inlines `fs.Sub(build.Frontend, "frontend")` (line 42) — a second copy of the lookup `spa.go:28`'s package-var seam `embeddedSPASub` owns. Replace the inline call with `sub, err := embeddedSPASub()`. Same package (`api`), so no export needed. The filesystem branch (`spaDir` + `spaPublicFallbackDirs`) is untouched.

Behavior is identical in production; the win is that tests overriding `embeddedSPASub` (the `spa_test.go:105` pattern) now govern `pwa.go`'s reads too, and the memory claim "the same seam mountSPA branches on" becomes literally true. Drop the now-unneeded `rk/build` and/or `io/fs` imports only if the compiler says they're unused (`fs.ReadFile` still needs `io/fs`; `build` becomes unused).

### 5. [dq2v] pr-status-model.ts — collapse `prGlyphColor`'s fail branch to `isFailish`, retire `prDotState`

`app/frontend/src/components/pr-status-model.ts`:
- `prGlyphColor` line 248: `if (prDotState(win) === "fail")` → `if (isFailish(win))`. Semantics are identical for that branch: `prDotState` returns `"fail"` iff `!merged && isFailish(win)`, and `prGlyphColor`'s chain has already returned for `closed` before this line while `merged` maps to purple later — the one input where the two differ (`prState === "merged" && isFailish`) renders purple either way because the fail branch was never reached for merged in the old chain either (merged short-circuits inside `prDotState`); apply MUST re-confirm this equivalence against the full six-way chain and keep the merged-above-fail outcome byte-identical, adjusting branch order if needed.
- Delete `prDotState` (line 75) and the `PrDotState` type (line 57) — after the collapse they have **zero non-test consumers** (verified: outside tests, `prDotState` appears only inside `pr-status-model.ts` itself plus prose comments in `palette-selection.ts:186` and `pr-status-model.ts` doc comments).
- `isFailish` **stays exported** — it remains the single source of the fail predicate.
- Update the prose: the `PrDotState`/`prDotState` doc comments (lines 50–74), and the comment references at `pr-status-model.ts:216–221`, `pr-status-model.ts:294–306` region, and `palette-selection.ts:186` (which cites "the same field `prDotState` reads").
- `pr-status-model.test.ts`: the `describe("prDotState precedence")` block (line 15) direct-calls the deleted function. Fold any fail-dominance/precedence coverage not already asserted through `prGlyphColor` into the existing `prGlyphColor` tests; delete the rest of the block. `signal-color-tokens.test.ts` and `session-tiles.test.tsx` reference only `prGlyphColor`/`isFailish` surfaces and should pass unchanged.

### 6. Backlog ticking (ship tail)

When the change ships, mark the 5 items done in `fab/backlog.md` — flip `- [ ]` to `- [x]` on the lines carrying `[pw7g]` (line 67), `[hn3j]` (line 69), `[zc6m]` (line 70), `[tk8p]` (line 74), `[dq2v]` (line 63). Line numbers are current as of intake; match by ID, not line.

## Affected Memory

- `run-kit/ui/top-bar.md`: (modify) BreadcrumbDropdown trigger contract — the `icon` labeled-trigger variant no longer exists; triggers are bare-▾ only.
- `run-kit/ui/status-signals.md`: (modify) §Shared PR vocabulary + §Status Dot — `prDotState`/`PrDotState` retired; `prGlyphColor`'s fail branch reads `isFailish` directly; the "remain live — exercised only by direct-call unit tests" caveat (line ~71/141) goes away.
- `run-kit/architecture.md`: (modify) three spots — the `internal/config` row + Data-Model note declaring the session-color helpers DEAD (lines ~89, ~117; now deleted, and `splitYAMLLine` no longer exists), the `updateWindowType` API-client table row (line ~311; deleted), and the `readSPAAsset` note (line ~904; the "second copy of the embedded-sub-FS lookup" parenthetical is resolved — it now goes through `embeddedSPASub`).

## Impact

- **Frontend** (`app/frontend/src/`): `components/breadcrumb-dropdown.tsx`, `components/pr-status-model.ts`, `api/client.ts`, plus unit tests `pr-status-model.test.ts`, `client.test.ts`, any breadcrumb-dropdown test touching `icon`, comment touch-ups in `lib/palette-selection.ts` and `iframe-window.test.tsx`. Pure removals/comment edits — no runtime behavior change (glyph colors byte-identical).
- **Backend** (`app/backend/`): `internal/config/runkit_yaml.go` + `runkit_yaml_test.go` (deletions), `api/pwa.go` (seam reroute — behavior identical in prod; test seam coverage improves).
- **No API surface, route, or endpoint changes.** No e2e impact expected (no user-visible behavior changes); verification gates are `go test ./...`, `npx tsc --noEmit`, and the frontend unit suites for the touched files.
- `fab/backlog.md` — 5 checkboxes ticked at ship.

## Open Questions

None — the directive is fully specified and all five claims re-verified at intake time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Land all 5 items as ONE change and ONE PR; tick the 5 backlog boxes at ship | Explicit user directive, restated twice in the input | S:95 R:90 A:95 D:95 |
| 2 | Confident | hn3j also deletes the orphaned private support code (`setSessionColorInContent`, `removeSessionColorKey`, `splitYAMLLine`, `runkitYAMLFile`) beyond the three named helpers | Verified used only by the deleted trio; leaving unreferenced private funcs would defeat the cleanup. `FindGitRoot` and its tests stay | S:80 R:85 A:90 D:80 |
| 3 | Certain | zc6m removes only the client function + its test; backend `POST /options`, `setWindowOptions`, `updateWindowUrl`, and `@rk_type` semantics untouched | Explicit in the directive and verified against the endpoint's live consumers | S:90 R:90 A:95 D:90 |
| 4 | Confident | dq2v test handling: fold uncovered fail-dominance precedence assertions into `prGlyphColor` tests, delete the direct-call `prDotState precedence` block | Directive says "update/remove accordingly"; preserving semantic coverage through the surviving public surface follows Test Integrity (tests conform to spec) | S:70 R:85 A:80 D:70 |
| 5 | Confident | dq2v equivalence: `prDotState(win)==="fail"` ⇔ `isFailish(win)` at `prGlyphColor`'s branch position given merged/closed handling elsewhere in the chain; apply re-confirms and keeps output byte-identical | Traced through both functions at intake; the one divergent input (merged+failish) resolves identically. Cheap to verify with existing unit tests | S:75 R:80 A:85 D:75 |
| 6 | Certain | tk8p is a pure seam reroute — embedded branch calls `embeddedSPASub()`; filesystem branch and route registration untouched | Same package, seam already exists as a package var with an established test-override pattern (`spa_test.go`) | S:85 R:90 A:95 D:90 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
