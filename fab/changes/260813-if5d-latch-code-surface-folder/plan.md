# Plan: Latch Code-Surface Folder at First Open

**Change**: 260813-if5d-latch-code-surface-folder
**Intake**: `intake.md`

## Requirements

### Frontend: Per-Window Code-Folder Latch

#### R1: Latch storage module
A new pure lib module (`app/frontend/src/lib/code-folder-latch.ts`) SHALL provide the per-window latched code folder: `codeFolderStorageKey(server, windowId)` returning `runkit-code-folder:${server}:${windowId}`, plus `readLatchedCodeFolder`/`writeLatchedCodeFolder` as thin try/catch-noop localStorage wrappers (the `readStoredView`/`writeStoredView` posture in `window-view.ts` — SSR/jsdom/quota-safe). The module MUST be DOM-free apart from those wrappers.

- **GIVEN** localStorage is unavailable (jsdom without storage, private mode, quota)
- **WHEN** read or write is called
- **THEN** read returns `undefined` and write is a silent no-op — no throw reaches the caller

#### R2: Seed rule — derivation runs exactly once, at first-ever open
The latch SHALL be seeded from the live derived `gitRoot` the first time the code surface actually renders for a window (the code tile is present in the resolved visible layout — covering `?view=code`, the panel/rail toggle, and `?layout=` deep links, all of which resolve through the same layout). Seeding MUST NOT occur from availability computation alone, MUST NOT overwrite an existing latch, and MUST NOT store an empty string (an empty derivation seeds nothing — the tile simply stays unavailable/degraded as today).

- **GIVEN** a window with no latch key and a non-empty derived `gitRoot`
- **WHEN** the code tile first renders (any entry path)
- **THEN** the latch is written with that `gitRoot`, and subsequent derivation changes (pane switches, cds) never modify it

- **GIVEN** a window with no latch key and an empty derived `gitRoot`
- **WHEN** availability/layout resolution runs
- **THEN** no latch is written and the code surface remains unavailable, exactly as before this change

#### R3: Follow rule — only the editor's own navigation moves the latch
After seeding, the ONLY writer of the latch SHALL be the editor's own navigation: on each iframe `load` event, the parent reads the same-origin `contentWindow.location`, parses the `folder` query param, and — when present, non-empty, and different from the current latch (compare decoded values) — writes it to the latch. The read MUST sit inside the same try/catch posture as the existing chord-reclaim attach (cross-origin or pre-load frames skip silently). A latch update MUST NOT be re-applied to a mounted iframe's `src` (re-setting `src` re-navigates a live frame — P3): the rendered `src` is fixed per iframe mount generation and changes only when the iframe genuinely (re)mounts (e.g. a reachability `false→true` flip or a window switch remount).

- **GIVEN** an open code surface latched to folder A
- **WHEN** the user runs File > Open Folder to folder B inside code-server (a full workbench navigation to `/code/?folder=B`)
- **THEN** the `load` event updates the latch to B, the mounted iframe is not re-navigated by the parent, and a later reload/remount renders folder B

- **GIVEN** a mounted, reachable code iframe
- **WHEN** the latch value changes state in React (from the load-event write)
- **THEN** the iframe element's `src` attribute does not change

#### R4: Availability widens — latch exists OR gitRoot derivable
The code lens/surface availability consumed by the rail, the view switcher, `?view=code`/`?layout=` deep-link validation, and layout degradation SHALL become "latch exists OR gitRoot derivable". Implementation: at the `app.tsx` seam that owns `server`/`windowId`, substitute an **effective window** — `{ ...currentWindow, gitRoot: latch ?? currentWindow.gitRoot }` — into every availability/render consumer (`availableViews`, `resolveLayout`, `availableSurfaces`, and `SurfaceLayout`'s `window` prop). The pure modules (`window-view.ts`, `right-panel.ts`, `lib/surface-layout.ts`) stay DOM-free and unchanged (see Design Decisions).

- **GIVEN** a window with a latch present and two panes — one inside the latched repo, one outside any repo
- **WHEN** the active pane switches to the non-repo pane (live `gitRoot` derives `""` on the next SSE tick)
- **THEN** `hasCode` still holds via the latch: the rail button and switcher segment do not strobe, the layout does not degrade the code tile away, and the tile keeps rendering

#### R5: Code tile renders from the latched folder
The code tile's render guard (`components/surface-layout.tsx` code case, currently `win?.gitRoot`), `tileMeta`'s repo-basename header, and `CodeSurface`'s `src` (`codeServerSrc`) SHALL all reflect the effective latched folder rather than the live derivation. Via R4's effective-window substitution this follows from the substituted `gitRoot`; no independent read of live derivation may leak into these three sites.

- **GIVEN** a latched window whose live `gitRoot` currently derives to a different repo (or to `""`)
- **WHEN** the code tile renders
- **THEN** the tile body, its header basename, and the iframe `src` all use the latched folder

### Docs: Spec Amendment

#### R6: right-panel spec reflects the latch
`docs/specs/right-panel.md` SHALL be amended: (a) § Surface Registry, the `code` row's "Available when" cell — from "git root derivable from the active pane's cwd" to the latch-or-derivable rule with a note on latch-once semantics; (b) § The code lens — the "Keyed by git root" bullet gains the latch rule: derivation seeds once at first open; thereafter only the editor's own navigation (File > Open Folder) moves it; the terminal never does; storage is a per-browser per-window localStorage key.

- **GIVEN** the amended spec
- **WHEN** a reader checks how the code surface picks its folder
- **THEN** the latch-once + follow-the-editor rule is documented in both places, and no spec text still claims the folder tracks the active pane

### Non-Goals

- Backend changes — `deriveGitRoot`'s active-pane preference stays; it only picks the seed (intake decision 5).
- tmux window option storage (`@rk_code_folder`) — explicitly deferred cross-viewer upgrade path (intake decision 3c).
- Latch liveness probing, reset verbs, or palette entries — a stale latch renders code-server's own error; File > Open Folder is the escape (intake decision 6).
- Reachability semantics — unchanged; `reachable` still selects iframe vs the not-running empty state.

### Design Decisions

#### Effective-window substitution over signature widening
**Decision**: Compute the latch once at the `app.tsx` seam and substitute `gitRoot: latch ?? live` into an effective `ViewWindow` passed to all availability/render consumers.
**Why**: One substitution point makes `hasCode`, `availableTiles`, `degradeLayout`, the tile guard, `tileMeta`, and `codeServerSrc` all follow the latch with zero changes to the pure modules — they stay DOM-free and their existing tests stay valid. The intake left the signature shape to the implementer.
**Rejected**: Widening `ViewWindow` with a separate `latchedCodeFolder` field or threading a parallel parameter through `hasCode`/`availableViews`/`resolveLayout`/`availableSurfaces` — more touched signatures, drift risk between consumers, no behavioral gain.
*Introduced by*: 260813-if5d-latch-code-surface-folder

#### Iframe src fixed per mount generation
**Decision**: `CodeSurface` computes its iframe `src` once per iframe mount generation (e.g. memoized on the `reachable` gate that mounts the iframe), not reactively from the folder prop.
**Why**: R3's P3 constraint — React re-rendering a changed `src` attribute re-navigates a live frame, even to a URL the frame already is at. Keying the computation to mount generation means a reachability `false→true` flip or window-switch remount picks up the CURRENT latch (fresh workbench, correct folder) while a mounted frame is never parent-navigated.
**Rejected**: A `src` state set only at first render — goes stale across reachability flips (a remounting iframe would boot into the seed-time folder instead of where the editor last was).
*Introduced by*: 260813-if5d-latch-code-surface-folder

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/code-folder-latch.ts` — `codeFolderStorageKey` (`runkit-code-folder:${server}:${windowId}`), `readLatchedCodeFolder`, `writeLatchedCodeFolder` (try/catch-noop, `window-view.ts` posture; write ignores empty strings), with colocated `code-folder-latch.test.ts` covering key shape, round-trip, empty-string rejection, and storage-unavailable noop <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 In `app/frontend/src/app.tsx`, add the latch state mirror (read `readLatchedCodeFolder(server, windowParam)` into state, re-read on `server`/`windowParam` change; a `setLatch` helper writes storage + state together) and build the effective window (`gitRoot: latch ?? currentWindow?.gitRoot`); feed it to `availableViews` (~line 675), `resolveLayout` (~line 686), `availableSurfaces` (~line 800), and `SurfaceLayout`'s `window` prop (~line 3529) <!-- R4 -->
- [x] T003 In `app/frontend/src/app.tsx`, add the seed effect: when the resolved layout's visible order includes `code`, no latch exists, and the live derived `gitRoot` is non-empty → write the latch via the T002 helper (never store `""`, never overwrite an existing latch) <!-- R2 -->
- [x] T004 In `app/frontend/src/components/code-surface.tsx`, fix the iframe `src` per mount generation (memoize `codeServerSrc(gitRoot)` keyed on the `reachable` mount gate so a live frame's `src` never changes) and extend the existing `load`-event `attach` seam: read `contentWindow.location` in the same try/catch, parse the `folder` param, and call a new optional `onFolderNavigated(folder)` prop when present, non-empty, and different (decoded comparison) from the current `gitRoot` prop; update `code-surface.test.tsx` for src fixity and folder-navigation reporting <!-- R3 -->
- [x] T005 Thread `onFolderNavigated` through `app/frontend/src/components/surface-layout.tsx`'s code-tile render (~line 608) as a passthrough prop from `SurfaceLayout`, and wire it in `app.tsx` to the T002 `setLatch` helper (follow rule: the only post-seed writer); extend the surface-layout component test for the passthrough <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Playwright e2e (feasibility per intake — the empty/available states are assertable without a live code-server): a window with one pane inside a repo and one outside; open the code view, switch the active pane, assert the code tile persists (does not disappear and its header basename is unchanged); ship the `.spec.md` companion per the constitution. If a live-navigation assertion is infeasible in the harness, cover the pane-switch persistence only and record the limit in the spec.md companion <!-- R2 -->

### Phase 4: Polish

- [x] T007 Amend `docs/specs/right-panel.md`: § Surface Registry `code` row "Available when" cell → latch-or-derivable with latch-once note; § The code lens "Keyed by git root" bullet → seed-once + follow-the-editor rule, localStorage keying, terminal-never-moves-it <!-- R6 -->

## Execution Order

- T001 blocks T002 (the lib module is imported by app.tsx)
- T002 blocks T003 and T005 (both use the `setLatch` helper / effective window)
- T004 blocks T005 (the prop must exist before it is threaded)
- T006–T007 run after Phase 2 completes; independent of each other

## Acceptance

### Functional Completeness

- [x] A-001 R1: `code-folder-latch.ts` exists with the specified key shape and try/catch-noop wrappers; its colocated test covers key shape, round-trip, empty-string rejection, and storage-unavailable noop
- [x] A-002 R2: First render of the code tile with no latch and a non-empty derived `gitRoot` writes the latch exactly once; availability computation alone never writes it
- [x] A-003 R3: An iframe `load` whose `folder` param differs from the latch updates the latch; the mounted iframe's `src` attribute is never changed by a latch update
- [x] A-004 R4: With a latch present and live `gitRoot` empty, `hasCode`-derived availability holds (rail button, switcher segment, deep-link validation, layout degradation all keep the code surface)
- [x] A-005 R5: The code tile body, `tileMeta` basename, and iframe `src` all reflect the latched folder when it differs from the live derivation
- [x] A-006 R6: Both spec sites in `docs/specs/right-panel.md` document the latch rule; no remaining spec text claims the code folder tracks the active pane

### Behavioral Correctness

- [x] A-007 R4: Switching the active pane to a non-repo cwd no longer hides the code tile or strobes the rail/switcher (the intake's screenshot scenario)
- [x] A-008 R2: Closing and reopening the code tile does not re-derive — the latched folder is rendered again, regardless of the active pane at reopen time

### Scenario Coverage

- [x] A-009 R3: File > Open Folder flow covered by test — a load event reporting a new folder updates the latch, and a subsequent (re)mount renders the new folder
- [x] A-010 R2: E2e (or documented-infeasible fallback per T006) exercises pane-switch persistence of the code tile

### Edge Cases & Error Handling

- [x] A-011 R2: An empty derivation never seeds (`""` is never stored); a window never inside a repo behaves exactly as before this change
- [x] A-012 R3: Cross-origin or pre-load frames skip the location read silently (try/catch posture — no console errors, no crash)
- [x] A-013 R1: localStorage-unavailable environments degrade to per-session behavior with no thrown errors (read `undefined`, write noop)

### Code Quality

- [x] A-014 Pattern consistency: latch module and wiring follow the `window-view.ts`/`right-panel.ts` pure-module + try/catch-noop + colocated-test conventions; comments match surrounding density
- [x] A-015 No unnecessary duplication: existing seams reused (the load-event attach in code-surface.tsx, the per-window key convention); no parallel availability logic introduced beside the effective-window substitution — *review note*: the only duplication found is in e2e scaffolding (`resolveCodePort`/`startStub` copied from `code-surface.spec.ts`), outside this item's named scope; raised as a should-fix
- [x] A-016 Type narrowing over assertions: no new `as` casts in the touched frontend files (guards/discriminated unions per code-quality.md)
- [x] A-017 Tests included for all new/changed behavior (code-quality.md MUST); frontend type check (`npx tsc --noEmit`) and test gates pass — verified: `npx tsc --noEmit` clean, `just test-frontend` 2732/2732, `just test-e2e` green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/lib/window-view.ts:149` — `resolveView` now has ZERO production call sites (only `window-view.test.ts` and doc mentions). R4 named it as a code-availability consumer to rewire; the effective-window substitution reached it via nothing, confirming `resolveLayout` fully superseded it in `260812-ab5v`. Its own module header (`window-view.ts:12-14`) still claims "the render branch in `app.tsx` AND the window-switch transition classification both call `resolveView`" — stale. Deleting the function + its 12 tests + the stale header sentence removes a dead second availability path.
- `app/frontend/tests/e2e/code-folder-latch.spec.ts:15-48` — `resolveCodePort` and `startStub` are verbatim copies of `code-surface.spec.ts:22-58`. One of the two pairs is redundant: hoisting them into a shared `tests/e2e/_code-server.ts` (the `_tmux.ts` / `_ready.ts` convention) deletes ~35 duplicated lines and one copy of the port-validation error message.
- `app/frontend/src/types.ts:120-124` (comment only) — the `gitRoot` docstring's "The per-window half of the code lens/surface availability gate (`hasCode`); keyed by git ROOT so editor state follows the code" is now the superseded rule; the sentence is a deletion/rewrite candidate rather than dead code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Effective-window substitution at the app.tsx seam (gitRoot = latch ?? live) instead of widening pure-helper signatures | Intake decision 10 left the shape to the implementer; substitution touches one seam, keeps pure modules and their tests unchanged | S:70 R:80 A:85 D:70 |
| 2 | Confident | "First open" = the code tile present in the resolved visible layout order (`layout.order`) — the one choke point all entry paths (view switcher, rail, `?view=`/`?layout=` deep links) resolve through | Intake decision 13 requires seeding at actual first render on any path; layout.order is where every path converges in the shipped layout model | S:70 R:80 A:80 D:70 |
| 3 | Confident | Iframe src fixity via memoization keyed on the `reachable` mount gate (per-mount-generation), so reachability flips and window-switch remounts pick up the current latch while a live frame is never parent-navigated | Intake decision 12 names the hazard; this is the minimal mechanism satisfying both P3 and fresh-remount correctness | S:65 R:80 A:80 D:65 |
| 4 | Confident | Folder comparison uses decoded values and updates only when the `load`-event `folder` param is present, non-empty, and different | Intake decision 11's "present and differs" made precise; encodeURIComponent round-trips make raw-string comparison flaky | S:65 R:85 A:85 D:75 |
| 5 | Confident | E2e scope: pane-switch persistence is the asserted scenario; live File>Open Folder navigation is unit-tested only (no live code-server in the e2e harness), with any feasibility limit recorded in the `.spec.md` companion | Intake decision 14 scopes e2e to "where feasible without a live code-server" | S:60 R:75 A:70 D:60 |
| 6 | Confident | The latch is read from localStorage AT RENDER (a `useMemo` keyed on server + window id + a write epoch), not mirrored into state via an effect | An effect lands a frame late, so a window switch renders the PREVIOUS window's latch once — and the code iframe mounting in that frame fixes its `src` for its whole mount generation (assumption 3), so the stale folder would stick until a genuine remount. Render-time reads are the established seam here (`storedLayout` reads storage every render on the next line) | S:70 R:85 A:85 D:70 |
| 7 | Confident | `src` fixity is held in a ref keyed to the `reachable` mount generation rather than `useMemo` (plan assumption 3's mechanism, hardened) | A memo cache is a documented performance HINT React may discard; this needs a semantic guarantee, since a dropped cache would re-navigate the live frame and reload the editor — exactly the hazard the decision exists to prevent. Same observable contract, same recompute trigger | S:70 R:85 A:85 D:70 |
| 8 | Confident | The URL-mirror effect and the window-switch transition classification (`switchTransitionRef.ungatedIds`) resolve against the latched window too, not just the render consumers named in T002 | Both call `resolveLayout`: keying the mirror off the live derivation would degrade a latched code tile away and rewrite the URL the moment the active pane left the repo, and keying the classification off it would mark a code-led target tty-gated — the stuck-transition bug class its comment warns about | S:75 R:80 A:85 D:75 |
| 9 | Confident | The `SurfaceLayout` passthrough prop is named `onCodeFolderNavigated` (the `CodeSurface` prop stays `onFolderNavigated` per T004) | SurfaceLayout carries props for four surfaces and prefixes the code-specific ones (`codeReachable`); an unprefixed name there would not say which tile it belongs to | S:60 R:90 A:85 D:70 |
| 10 | Confident | `withLatchedCodeFolder` is exported from `app.tsx` so the substitution seam is unit-testable (`app.test.tsx`, the `resolveServerView` precedent) | R4's behavior lives at a seam inside AppShell, which no test renders; exporting the pure helper is how the file's existing tests reach that class of logic | S:65 R:85 A:85 D:75 |
| 11 | Confident | `docs/specs/window-views.md`'s `code` View Registry row is amended alongside the two right-panel.md sites named in R6/T007 | A-006 requires that no remaining spec text claims the code folder tracks the active pane; that row stated the superseded rule (and a port gate already retired by 260811-a2bo) | S:75 R:90 A:85 D:80 |

11 assumptions (0 certain, 11 confident, 0 tentative).
