# Intake: Wire Board Nav Actions, Narrow NavMode

**Change**: 260719-i996-nav-actions-board-wiring
**Created**: 2026-07-20

## Origin

Backlog item `[i996]` (fab/backlog.md), processed by an autonomous backlog-sweep agent:

> buildNavActions (lib/palette-nav.ts) NavMode 'board'/'host' have no production call site — AppShell passes only 'terminal'/'server'; wire buildNavActions('board',...) into boardRouteActions or narrow the type.

Validity verified against current code: `buildNavActions` has exactly one production call site — `app/frontend/src/app.tsx:1941`, `buildNavActions(windowParam ? "terminal" : "server", server, {...})`. The `board` and `host` NavMode branches are exercised only by `lib/palette-nav.test.ts`.

The backlog offers two paths ("wire OR narrow"); investigation shows the right answer is **both, split by mode**:

- **`board` → wire in.** The top-bar history arrows render on ALL four page modes (`top-bar.tsx:204`), and their comment cites the palette-parity contract ("`Go: Back` / `Go: Forward`, Constitution V; see lib/palette-nav.ts"). The board route mounts its own `<CommandPalette actions={boardRouteActions} />` (`board-page.tsx:1029`) which currently contains NO nav entries — so on `/board/$name` the arrows exist in the top bar but `Go: Back`/`Go: Forward`/`Go: Host` are missing from the palette. That is a real Constitution V parity gap that `buildNavActions("board", ...)` was written to fill.
- **`host` → narrow away.** `HostOverviewPage` mounts no CommandPalette at all (grep-verified; the `app.tsx:2928` palette is AppShell's, mounted only on `/$server` routes). With no palette on the root route, the `host` mode is dead by construction — `buildNavActions("host", ...)` would return only the two history actions, but there is nowhere to render them. Adding a palette to the Host page would be a feature change outside this refactor's scope.

## Why

1. **Pain point**: exported API surface (`NavMode`'s `"board"`/`"host"` values) advertises capabilities production never uses, while the board route genuinely lacks the palette nav entries the module was built to provide — the worst of both: dead type surface AND a live parity gap.
2. **Consequence of not fixing**: board users cannot reach Back/Forward/Host from `Cmd+K` (keyboard-first violation); future readers keep re-deriving whether the unused modes are intentional.
3. **Approach**: wire the `board` mode into `boardRouteActions`; narrow `NavMode` to `"terminal" | "board" | "server"`. Rejected: narrowing away `board` too (leaves the parity gap standing); rejected: adding a Host-page palette to justify `host` (feature creep — Minimal Surface Area; can be revisited if the Host page ever gets a palette).

## What Changes

### 1. `board-page.tsx`: nav actions join `boardRouteActions`

In the `boardRouteActions` `useMemo` (around `board-page.tsx:494`), prepend/insert the nav entries (position: before the board-specific entries, mirroring AppShell's ordering where nav actions lead the route group — apply worker verifies AppShell's exact placement at `app.tsx:1941` and mirrors it):

```tsx
...buildNavActions("board", "", {
  onBack: () => router.history.back(),
  onForward: () => router.history.forward(),
  onTmuxServer: () => {}, // unreachable in board mode (entry only emitted for terminal)
  onHost: () => navigate({ to: "/" }),
}),
```

- `server` arg is `""` — board mode never emits `Go: tmux Server` (the gate is `mode === "terminal" && server`), so the empty string is honest.
- `router` comes from TanStack Router's `useRouter()` (BoardPage already imports from `@tanstack/react-router`; add the hook if not present). `navigate` already exists.
- Handler shape mirrors AppShell's wiring at `app.tsx:1941` (apply worker: read it and keep the two implementations symmetrical).
- Result on `/board/$name`: palette gains `Go: Back`, `Go: Forward`, `Go: Host` — matching the top-bar arrows + the board breadcrumb's Host ancestor.

### 2. `lib/palette-nav.ts`: narrow `NavMode`

- `export type NavMode = "terminal" | "board" | "server";` (drop `"host"`).
- Update the doc comments: the mode list (`host: none` row goes away; note the type is the palette-bearing subset of `TopBarMode` — the root Host route mounts no palette, hence no `host` mode), and the module header's "a solo Host route (no ancestors) yields only the two history actions" sentence (now moot — describe that every supported mode emits at least `Go: Host`).
- The function body's ancestor gate `if (mode === "terminal" || mode === "board" || mode === "server")` becomes unconditional (every remaining mode passes) — simplify to a plain push with a comment, or keep the explicit condition if the reviewer prefers; prefer the simplification (`Go: Host` is emitted for every mode; only the `terminal` extra differs).

### 3. Tests

- `lib/palette-nav.test.ts`: retarget/remove the `"host"`-mode cases (lines ~13, ~20); keep/extend `board` cases (Back/Forward/Go: Host, no Go: tmux Server).
- `command-palette.boards.test.tsx` documents `boardRouteActions`' full contents — extend it (and its companion `.spec.md` if one exists for e2e; this is a unit test so no `.spec.md` needed) to assert the three new nav entries appear on the board palette.
- Existing app.tsx palette tests are unaffected (terminal/server modes unchanged).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the palette-actions/boards-view sections: `boardRouteActions` now includes the nav trio (`Go: Back`/`Go: Forward`/`Go: Host`) via `buildNavActions("board", ...)`; `NavMode` is the palette-bearing subset (`terminal | board | server` — no `host`: the root route mounts no palette).

## Impact

- `app/frontend/src/components/board/board-page.tsx` (+~10 lines), `app/frontend/src/lib/palette-nav.ts` (type + comments + small simplification), `lib/palette-nav.test.ts`, `components/command-palette.boards.test.tsx`.
- User-visible: three new palette entries on the board route (parity fix). No backend/route changes.

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Wire `board` (real parity gap) AND narrow away `host` (no palette exists on the root route) | Both halves verified by direct code inspection; backlog explicitly offers this fork | S:70 R:80 A:90 D:75 |
| 2 | Confident | No Host-page palette is added | Feature change beyond a dead-code refactor; Constitution IV (minimal surface); revisit if Host gains a palette | S:60 R:85 A:80 D:70 |
| 3 | Confident | Nav entries positioned to mirror AppShell's ordering; handlers mirror app.tsx:1941 wiring | Symmetry keeps the two palettes predictable; apply worker verifies exact placement before choosing | S:60 R:85 A:80 D:75 |
| 4 | Certain | `server=""` for the board call | Board mode's gate never reads `server`; passing a fabricated value would be misleading | S:75 R:90 A:95 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved).
