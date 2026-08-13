# Intake: Latch Code-Surface Folder at First Open

**Change**: 260813-if5d-latch-code-surface-folder
**Created**: 2026-08-13

## Origin

Promptless dispatch (Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a synthesized `/fab-discuss` design session held 2026-08-13. All design decisions below were explicitly user-approved during that session; no questions were asked at intake time (promptless mode). The user's own framing of the core rule:

> "The first time the code editor is opened is the only time it derives it. And that's it. This is so that moving around in the terminal doesn't lose any open work."

Observed trigger (user screenshot of a Terminal|Code split): a window with two panes — one in `~/code/bootstrap/dotfiles` (a git repo), one in `~/code/wvrdz` (not a repo). Switching the active pane in the tty re-derives `gitRoot` to `""` on the next SSE tick, `hasCode` flips false, and the code tile renders null — the editor disappears; switching back brings it back.

## Why

**The pain point.** The `code` lens/surface (`CodeSurface`, an iframe of `/code/?folder=<gitRoot>`) takes its folder from the window's `gitRoot`, which the backend derives per SSE tick in `deriveGitRoot` (`app/backend/internal/sessions/sessions.go:553`) with active-pane preference: active pane's cwd → first pane's cwd → worktree path, walked up via `config.FindGitRoot`. The derivation is therefore **live and follows the terminal**, while the editor embedded behind it holds in-flight state (open tabs, dirty buffers via hot-exit, undo stacks) that is expensive or impossible to recover:

1. **Active pane leaves the repo** → `gitRoot` derives `""` → `hasCode` goes false → the code tile body renders null (`app/frontend/src/components/surface-layout.tsx` ~line 608) and the rail button / view-switcher segment strobe. The editor vanishes mid-thought because someone switched panes in the terminal.
2. **Two panes in two different repos** → switching the active pane changes `gitRoot` to the other repo → the iframe `src` changes → code-server performs a full workbench navigation to another workspace, losing in-flight editor state (the in-memory undo stack dies; the open editor set swaps).

**The consequence of not fixing it.** Both failure modes defeat the right-panel spec's own stated intent: P3 (`docs/specs/right-panel.md` § P3 — Hide, never unmount) exists so "the web/code iframes keep their in-memory state", and § The code lens says "editor state follows the code; agents `cd` constantly". Agents cd constantly is precisely why a live derivation is the wrong ongoing driver: the terminal's movement should never move the editor.

**Why this approach.** A latch: derivation picks the folder exactly once (the first time the code surface is ever opened for a window), and from then on only the editor's own navigation (File > Open Folder inside code-server) moves it. Alternatives rejected in the design session:

- **Stabilizing the backend derivation** (first-pane-with-a-root wins instead of active-pane preference) — rejected as the guarantee: it still moves the editor when panes cd. The latch is the guarantee; the backend stays untouched.
- **Re-deriving on tile close/reopen** (latch only while the tile is open) — explicitly rejected by the user; first-open-ever is the only derivation.
- **tmux window option storage** (`@rk_code_folder`, a cross-viewer upgrade path) — considered and explicitly deferred; OUT of scope for this change.

## What Changes

Frontend-only. **No Go changes** — `deriveGitRoot`'s active-pane preference stays as-is; it now only picks the seed.

### 1. Per-window code-folder latch (new lib module)

A per-window latched code folder, persisted in **localStorage** (per-browser), keyed like the other per-window keys — server + window id, following the `windowViewStorageKey` convention in `app/frontend/src/lib/window-view.ts` (~line 187):

```ts
// e.g. app/frontend/src/lib/code-folder-latch.ts (name/location per project pattern)
export function codeFolderStorageKey(server: string, windowId: string): string {
  return `runkit-code-folder:${server}:${windowId}`;
}
// readLatchedCodeFolder / writeLatchedCodeFolder: thin try/catch-noop wrappers,
// same posture as readStoredView/writeStoredView (SSR/jsdom/quota-safe).
```

Pure and DOM-free except the try/catch localStorage wrappers, matching the `window-view.ts` / `right-panel.ts` module contract, with colocated Vitest tests.

**Consciously accepted caveats (user-approved):**
- (a) Another browser/profile derives its own latch — consistent with code-server tabs/layout already being per-browser (right-panel spec Open Question 2).
- (b) tmux window ids remap on snapshot restore, so a key can orphan — accepted; a missing latch just re-seeds from derivation on the next open.
- (c) A tmux window option (`@rk_code_folder`) as a cross-viewer upgrade path was explicitly deferred — OUT of scope.

### 2. Seed rule: derivation runs exactly once, at first-ever open

The FIRST time the code surface/lens is ever opened for a window (no latch key present), the derived `gitRoot` at that moment seeds the latch. From then on, derivation NEVER moves the editor — not on pane switch, not on tile close/reopen, not on page reload. Seeding happens when the code surface actually renders (main-slot `?view=code`, the panel's CODE surface, or a code tile in a layout — all paths go through `CodeSurface`'s render seam); an available-but-never-opened code lens seeds nothing. A stale/absent latch with an empty derivation seeds nothing (never store `""`).

### 3. Follow rule: only the editor's own navigation moves the latch

Retargeting to a different folder is done inside code-server via File > Open Folder, which performs a full workbench navigation to `/code/?folder=<new>`. Because the embed is same-origin by design, the parent reads the iframe's location on `load` events and updates the latch to match, so a later remount/reload renders the folder where the editor actually is rather than snapping back to the first-ever folder.

Implementation seam: `app/frontend/src/components/code-surface.tsx` already attaches a `load` listener for chord reclaim (`iframe.addEventListener("load", attach)`, ~line 123). Extend that seam: on load, read the iframe's `contentWindow.location` inside the same try/catch posture (cross-origin or pre-load frames skip silently), parse the `folder` query param, and when present and different from the latch, write the latch. Rule stated in the session: **derivation seeds the latch exactly once; thereafter only the editor's own navigation moves it.**

**P3 constraint (load-bearing):** the latch must not introduce iframe remounts or parent-driven navigations of its own. Concretely: a latch update flowing back into React state must NOT be re-applied to a mounted iframe's `src` attribute (re-setting `src` navigates the frame even to a URL its `contentWindow` is already at). The latched folder determines the `src` at MOUNT time only; a live iframe is never retargeted by the parent.

### 4. Availability widens: `hasCode` = latch exists OR gitRoot derivable

`hasCode` (`app/frontend/src/lib/window-view.ts` ~line 88, currently `(win?.gitRoot ?? "").length > 0`) becomes "latch exists OR gitRoot derivable", so the rail button, view-switcher segment, and `?view=code` deep links stop strobing when the active pane leaves the repo. Consumers to rewire:

- `app/frontend/src/lib/window-view.ts` — `hasCode`, `availableViews`, `resolveView` (the `?view=code` deep-link validation path)
- `app/frontend/src/lib/right-panel.ts` — `availableSurfaces` (keys off `hasCode`)
- `app/frontend/src/app.tsx` — the render gate / surface resolution (~line 672, ~line 800) that owns `server`/`windowId` and can read the latch to feed the pure helpers

The pure modules stay DOM-free: the latch value is read at the seam that owns the storage identity (app.tsx / component layer) and passed into the pure predicates (exact signature shape is the implementer's choice — e.g. widening `ViewWindow` with an optional latched-folder field or a parallel parameter).

### 5. Code tile render guard + `tileMeta` follow the latch

`app/frontend/src/components/surface-layout.tsx`:

- The code tile render guard (~line 608, `win?.gitRoot ? <CodeSurface gitRoot={win.gitRoot} …/> : null`) renders from the **effective latched folder** (latch, seeded from derivation on first open) instead of the live `gitRoot`, so pane switches can no longer null the tile or retarget the iframe.
- `tileMeta` (~line 353, shows the repo basename for code tiles) reflects the **LATCHED** folder's basename, not the live-derived `gitRoot`.

### 6. Stale latch accepted — no liveness machinery

A latch pointing at a deleted worktree renders code-server's own "folder does not exist" state; the escape is File > Open Folder (which re-latches per §3). **No liveness probe, no reset verb, no new palette entry.** Reachability handling is unchanged: the existing `reachable` prop still selects iframe vs the "code-server not running — check rk doctor" empty state.

### 7. Spec amendment (in scope)

`docs/specs/right-panel.md` documents the current derivation-based keying/availability and must be amended in this change:

- § Surface Registry — the `code` row's "Available when" cell: from "git root derivable from the active pane's cwd" to the latch-or-derivable rule, noting the latch-once semantics.
- § The code lens — the "Keyed by git root" bullet gains the latch rule: derivation seeds once at first open; thereafter only the editor's own navigation moves it; the terminal never does.

### 8. Tests

Per `fab/project/code-quality.md`, new/changed behavior MUST include tests (Vitest, colocated):

- Latch lib module: key shape, read/write wrappers, storage-unavailable noop.
- `window-view.test.ts`: `hasCode` widening (latch-only, derivation-only, both, neither), `availableViews`/`resolveView` with latch.
- `code-surface.test.tsx` (exists): seeding on first mount, load-event latch update from the iframe's `?folder=`, no parent-driven retarget of a mounted iframe.
- `surface-layout` tests: code tile renders from latch when `gitRoot` is empty; `tileMeta` shows the latched basename.
- Playwright e2e where feasible (the empty/available states are assertable without a live code-server); any new `.spec.ts` ships its `.spec.md` companion per the constitution.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Window-view lenses / right rail / surface-layout sections — code-lens availability becomes latch-OR-derivable; the code surface's folder is a per-window per-browser latch (localStorage, seeded once at first open, follows editor navigation); tileMeta keys off the latch.

## Impact

Frontend only (`app/frontend/src/`):

- `components/code-surface.tsx` — `codeServerSrc` call site semantics, load-listener seam extended to read the iframe's folder and update the latch; mount-time-only src.
- `components/surface-layout.tsx` — code tile render guard (~608), `tileMeta` (~353).
- `lib/window-view.ts` — `hasCode` (~88), `availableViews`, `resolveView`.
- `lib/right-panel.ts` — `availableSurfaces`.
- `app.tsx` — availability consumers (~672, ~800), latch read/seed wiring.
- New lib module for the latch (per-window localStorage key conventions).
- `docs/specs/right-panel.md` — spec amendment (§ Surface Registry `code` row, § The code lens).
- Colocated Vitest tests for every touched behavior; Playwright e2e where feasible.

No backend changes (`deriveGitRoot` untouched). No API/SSE payload changes. No new routes (Constitution IV).

## Open Questions

None. All design decisions were explicitly user-approved in the originating discussion session; no decision graded Unresolved (promptless mode recorded zero deferred questions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Latch once, forever (per window): first-ever open of the code surface seeds the latch from derived `gitRoot`; derivation never moves the editor afterward — not on pane switch, tile close/reopen, or reload | Discussed — user approved explicitly ("The first time the code editor is opened is the only time it derives it") | S:95 R:70 A:90 D:95 |
| 2 | Certain | The latch follows the editor, never the terminal: same-origin `load` events update the latch to the iframe's actual `?folder=`; only editor navigation (File > Open Folder) moves it after seeding | Discussed — user approved; the load-listener seam already exists in code-surface.tsx | S:95 R:75 A:85 D:90 |
| 3 | Certain | Storage is localStorage, per-browser, keyed server+window id; per-browser divergence, snapshot-restore key orphaning (re-seed on next open) accepted; tmux window-option (`@rk_code_folder`) upgrade path explicitly deferred out of scope | Discussed — user decided consciously, caveats enumerated and accepted | S:90 R:80 A:90 D:85 |
| 4 | Certain | `hasCode` widens to "latch exists OR gitRoot derivable" (rail button, view-switcher segment, `?view=code` deep links) | Discussed — user approved; stops the strobe when the active pane leaves the repo | S:95 R:80 A:90 D:90 |
| 5 | Certain | Backend unchanged: `deriveGitRoot`'s active-pane preference stays; it now only picks the seed; no Go changes | Discussed — user approved; the rejected alternative (stabilizing derivation) is recorded in Why | S:95 R:85 A:95 D:90 |
| 6 | Certain | Stale latch accepted: deleted-worktree latch renders code-server's own "folder does not exist" state; escape is File > Open Folder; no liveness probe, no reset verb, no palette entry | Discussed — user approved | S:90 R:85 A:85 D:85 |
| 7 | Certain | `tileMeta` shows the LATCHED folder's basename, not the live-derived `gitRoot` | Discussed — user approved | S:90 R:90 A:90 D:90 |
| 8 | Certain | `docs/specs/right-panel.md` amendment (§ Surface Registry `code` "Available when" cell + § The code lens keying bullet) is in this change's scope | Stated as a constraint in the design session; spec currently documents the superseded derivation-based rule | S:90 R:85 A:90 D:90 |
| 9 | Certain | Latch key follows the existing per-window key convention (`runkit-code-folder:${server}:${windowId}`-shaped, mirroring `windowViewStorageKey`), with try/catch-noop read/write wrappers in a pure lib module | User specified "keyed like the other per-window keys (server + window id)"; window-view.ts is the in-repo pattern | S:80 R:85 A:90 D:75 |
| 10 | Confident | Latch read/seed wiring lives at the seam that owns `server`/`windowId` (app.tsx / component layer) and feeds the pure helpers; `window-view.ts`/`right-panel.ts` stay DOM-free (exact signature shape is the implementer's choice) | Module contracts in the codebase are explicit ("pure and DOM-free"); several equivalent shapes, clear front-runner | S:60 R:75 A:80 D:65 |
| 11 | Confident | Follow-rule mechanics: extend the existing load-event attach in code-surface.tsx; read `contentWindow.location` inside try/catch (cross-origin/pre-load frames skip silently, same posture as chord reclaim); update the latch only when a `folder` param is present and differs | Seam exists and its failure posture is established; behavior fully specified by decision 2 | S:65 R:80 A:80 D:70 |
| 12 | Confident | P3 mechanics: the latched folder fixes the iframe `src` at MOUNT time only; a latch update from editor navigation is never re-applied to a mounted iframe's `src` (re-setting `src` re-navigates a live frame) | Direct consequence of the P3 hide-never-unmount constraint the user named; implementation hazard recorded so apply cannot regress it | S:55 R:75 A:75 D:60 |
| 13 | Confident | Seeding fires at the code surface's actual first render (any path — main slot, panel, layout tile), not at availability computation; empty derivation seeds nothing (never store `""`) | Implied by decision 1's "first time the code editor is opened"; single obvious interpretation | S:70 R:80 A:80 D:70 |
| 14 | Confident | Test strategy: Vitest colocated unit tests for latch lib, `hasCode` widening, code-surface seeding/follow, tile guard + tileMeta; Playwright e2e only where feasible without a live code-server (with `.spec.md` companions per the constitution) | code-quality.md mandates tests for changed behavior and SHOULD-level e2e; feasibility limit is the embedded code-server | S:55 R:70 A:60 D:50 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
