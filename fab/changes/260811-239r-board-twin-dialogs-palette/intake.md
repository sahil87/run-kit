# Intake: Dissolve Board-Twin Server Dialogs & Command Palette

**Change**: 260811-239r-board-twin-dialogs-palette
**Created**: 2026-08-11

## Origin

One-shot `/fab-new 239r` invocation (backlog ID, no prior conversation). Backlog entry `[239r]` (2026-07-23, re-verified 2026-08-11):

> Dissolve the remaining board-twin problem — the sidebar half is ALREADY DONE (unified via AppLayout/Shell, PR #401, 2026-07-20, predates this item) and top-bar-slot-context already exists (PR #326, 2026-07-08); re-verified 2026-08-11, still accurate for the rest. REMAINING SCOPE: server create/kill dialogs and the command palette are still twinned between app.tsx (AppShell) and board-page.tsx — each independently defines its own killServerTarget state + kill-server/kill-window Dialog JSX (board-page.tsx ~:1285/:1315, app.tsx :633/:3595) and its own CommandPalette instance with its own actions list (board-page.tsx:1245 boardRouteActions vs app.tsx:3694 paletteActions) instead of contributing actions through a shared slot. FIX: lift the dialogs to AppLayout/Shell (mirror the sidebar's PR #401 approach) and route palette actions through a slot/signal context like top-bar-slot-context so each route contributes actions rather than owning a separate CommandPalette. AppShell stays server-scoped; boards stop re-implementing these globals in board-page.tsx.

Intake-time verification (2026-08-11): all claims confirmed against the working tree, with one path correction — the board page lives at `app/frontend/src/components/board/board-page.tsx` (not `app/frontend/src/board-page.tsx`). Current line anchors: board `killServerTarget` state :122 / kill-server dialog :1285 / kill-window (`killTarget`) dialog :1316 / `boardRouteActions` :616 / `CommandPalette` mount :1245; app.tsx `killServerTarget` :633 / `showCreateServerDialog` :631 / create-server dialog :3569 / kill-server dialog :3595 / `paletteActions` :2868 / `CommandPalette` mount :3694.

## Why

1. **The pain point**: the board route (`/board/$name`) does not render `AppShell`, so every global affordance AppShell owns had to be re-implemented inside `BoardPage` to satisfy Constitution V (Keyboard-First). Today that means two independent copies of (a) the server create/kill confirm dialogs plus their trigger state, and (b) a full `CommandPalette` mount with its own actions list. `board-page.tsx` carries **seven** comment blocks reading "duplicated from AppShell … (DD-8)" — refresh, help, shortcuts, settings, update, check, maintenance/version entries — each a hand-maintained mirror of an AppShell group.

2. **The consequence of not fixing it**: the twins have already drifted, in ways users can observe:
   - The board's kill-server dialog **lacks the `DAEMON_SERVER` warning** ("hosts the run-kit daemon serving this dashboard — killing it takes the dashboard down", app.tsx:3600–3604). Killing the daemon server from a board gives no warning that the dashboard will go down.
   - The board's create-server input **lacks input sanitization**: AppShell applies `toSafeServerName` on change and `finalizeSafeName` on submit (app.tsx:3575, :1672); the board stores the raw value and relies only on the regex-disabled button (board-page.tsx:1265, :1277).
   Every future global palette entry or dialog tweak must be written twice, and the DD-8 duplication comments show authors already pay this tax on every change.

3. **Why this approach**: the codebase has two proven precedents for exactly this shape of problem, both named by the backlog entry. The sidebar was dissolved by lifting it to a shared `Shell` component (PR #401); the settings dialog (260723-o7q8, `settings-dialog-context.tsx`) renders once in `AppLayout` with a context trigger any descendant can call; and `top-bar-slot-context.tsx` (PR #326) is the established register-into-a-root-mount channel (pages publish props via `useRegisterTopBarSlot`, last-writer-wins, clear-on-unmount). This change applies those two existing patterns to the last two twinned surfaces. Alternatives rejected: making the board render AppShell (AppShell is deliberately server-scoped — the backlog pins this: "AppShell stays server-scoped"); extracting shared JSX components but keeping per-route mounts/state (removes JSX drift but keeps the state twins and the seven DD-8 blocks — doesn't dissolve the problem).

## What Changes

### Part A — Server create/kill dialogs lift to AppLayout

New context `app/frontend/src/contexts/server-dialogs-context.tsx`, mirroring `settings-dialog-context.tsx` (o7q8): small state + stable triggers.

```ts
export type ServerDialogsState = {
  // triggers (referentially stable)
  openCreateServer: () => void;
  requestKillServer: (name: string) => void;
  // open-state, readable by routes (AppShell's modal-gating predicate, see below)
  createServerOpen: boolean;
  killServerTarget: string | null;
};
```

The dialog JSX moves to a single mount in `AppLayout` (app.tsx:235) — alongside the one `SettingsDialog` mount (app.tsx:280) — extracted into a component (e.g. `app/frontend/src/components/server-dialogs.tsx`) that owns the create-input local state and the submit/kill handlers (`useOptimisticAction` wrappers around `createServer`/`killServer`, `markServerPending`, `markKilled`).

**Unified behavior adopts AppShell's superset** (resolving the drift in the board copies):
- Create: `toSafeServerName` on change + `finalizeSafeName` on submit; post-create `markServerPending(name)` + navigate to `/$server` (app.tsx:1671–1682). Navigation is route-agnostic and applies from boards too (that is the board's current behavior as well — both copies navigate to the new server).
- Kill: the `DAEMON_SERVER` warning paragraph renders on ALL routes; post-kill navigate to `/` **only when the killed server is the current server** (app.tsx:1704–1712). "Current server" at the layout level comes from `SessionContext`'s `currentServer` (the deepest-first route-param walk) — `null` on board routes, so a board kill never navigates away, which matches the board's current behavior exactly (board-page.tsx:199–202 never navigates).

**Callers rewire to the context triggers**:
- Both `Sidebar` mounts: `onCreateServer={openCreateServer}` / `onKillServer={requestKillServer}` (app.tsx:3188–3189, board-page.tsx:1137–1138). The handlers stay referentially stable (the memoized `ServerGroup` header cluster depends on this — 260721-x4sf comments at both sites).
- AppShell palette entries: `Server: Create` (app.tsx:2610) and `buildServerKillActions(...)` (app.tsx:2618–2622) call the context triggers instead of local setters.
- The per-route duplicate state (`showCreateServerDialog`/`createServerName`/`killServerTarget`) and dialog JSX are **deleted** from both files.
- AppShell's dialog-open predicate (app.tsx:1416, gates keyboard handling while any modal is up) reads `createServerOpen`/`killServerTarget` from the context instead of local state. BoardPage has an equivalent gating seam to check during apply.

### Part B — Single CommandPalette mount + palette-actions slot

New context `app/frontend/src/contexts/palette-actions-context.tsx`, mirroring `top-bar-slot-context.tsx`: routes publish their **route-scoped, already-shortcut-decorated** action lists via `useRegisterPaletteActions(actions)` (referentially-stable dispatcher, last-writer-wins, clear-on-unmount — same shape as `useRegisterTopBarSlot`).

The one `CommandPalette` (lazy) mounts in `AppLayout` and renders `[...routeActions, ...globalActions]`. The two per-route mounts (app.tsx:3694, board-page.tsx:1245) are deleted.

**Global entries move to a layout-level builder** (a hook or component next to `AppLayout`, using the shared `lib/palette-*` builders that already exist): nav (`buildNavActions` — the mode comes from the same route-derived walk `RootTopBar` already does at app.tsx:301–339), terminal font trio, `View: Refresh Page`, `Help: Documentation` (shared `HELP_URL`), `Help: Keyboard Shortcuts`, `Settings: Open` (`useSettingsDialog`), update/check/maintenance/version (`buildUpdateActions`/`buildCheckActions`/`buildMaintenanceActions`/`buildVersionAction` over `useUpdateCheck` + daemon version state). This dissolves all seven "duplicated from AppShell (DD-8)" blocks in `boardRouteActions` (board-page.tsx:675–795) and removes the same groups from AppShell's list. Global entries are decorated with `withShortcutHints` at the layout level (via `useKeybindings`). Nav-action handlers (`router.history.back/forward`, navigate-to-host, go-to-server) are constructible at the layout level; AppShell's terminal-mode `Go: tmux Server` entry needs the current server param, available from the same route-param walk.

**The merged list flows back to routes.** The context must expose the merged decorated list (`allActions`), because two AppShell seams resolve actions by id across the FULL list today:
- Keybinding dispatch (app.tsx:2903–2969): `fromPalette(id)` resolves chord bodies for ids that are becoming global (`go-back`, `go-forward`, `settings-open`) as well as route-scoped ones (`kill-window`, `split-horizontal`, …). It must consume the merged list (or the layout takes over dispatch for global-only chords) so no chord silently loses its handler.
- Macro palette targets (app.tsx:2887–2893) and the macro execution ref (`paletteActionsRef`, app.tsx:2813–2821, :2883): macros may target ANY palette entry, including global ones. The target-candidate enumeration and invocation-time resolution must run over the merged list.
BoardPage's own `useKeybindingDispatch(boardKeyHandlers)` (board-page.tsx:380) similarly keeps working over its route list + merged globals.

**Ordering and identity are preserved**: every existing entry keeps its `id` and label; per-route ordering keeps route-group entries first, then the global groups in the current relative order (board today: board-specific → nav → font → refresh/help/shortcuts/settings/update/check/maintenance/version). Macros (`macroPaletteActions`) remain part of AppShell's registered route list.

### Part C — ShortcutsOverlay rides along

Both routes currently own a `showShortcutsOverlay` state + `<ShortcutsOverlay>` mount (app.tsx:640/:2469, board-page.tsx:1252) — duplicated for the same DD-8 reason. Moving the `Help: Keyboard Shortcuts` global entry to the layout forces its toggle state and the overlay mount to lift to `AppLayout` too (the global entry cannot toggle route-local state). The `shortcuts-overlay` keybinding handler (app.tsx:2938) resolves against the lifted state. AppShell's session-scoped overlay behavior (the `showShortcutsOverlay && sessionName` effect at app.tsx:2791) must be checked during apply and preserved.

### Out of scope

- **Kill-WINDOW dialogs stay route-owned.** The board's `killTarget` dialog (board-page.tsx:1316) and AppShell's kill-window confirm are not twins: the board Kill destroys the window everywhere and carries an `Unpin instead` escape + home-session copy (co9z); the terminal-route confirm is a different flow for the current window. Their trigger states are inherently route-specific (focused tile vs current window). At most, apply MAY extract a shared presentational confirm component if it falls out naturally — not required. (The backlog's "kill-server/kill-window Dialog JSX" enumeration reads as describing what each page defines, not mandating a kill-window merge — see Assumption #6.)
- AppShell's other dialogs (rename session, kill session, tmux commands, create session/window at folder, iframe, spawn agent) are server/terminal-scoped, exist on one route only, and do not move.
- No backend, API, or route changes. No visual/behavioral change except the two board-side drift fixes noted in Part A (daemon warning appears, input sanitization applies).

## Affected Memory

- `run-kit/ui-patterns`: (modify) dialogs section (server create/kill now single-mounted in AppLayout via server-dialogs-context, o7q8 pattern) and palette section (single CommandPalette mount at AppLayout, palette-actions slot context, global-vs-route action ownership, merged-list seam for keybindings/macros).

## Impact

- `app/frontend/src/app.tsx` — remove twin state/dialog JSX/palette mount from AppShell; add the layout-level global actions + single palette + server-dialogs + shortcuts-overlay mounts in/next to `AppLayout`; rewire keybinding/macro seams to the merged list. Largest and riskiest file (3708 lines).
- `app/frontend/src/components/board/board-page.tsx` — delete twin dialogs/state, the seven DD-8 global groups, and the palette + overlay mounts; register `boardRouteActions` (board-scoped only) via the slot.
- New: `app/frontend/src/contexts/server-dialogs-context.tsx`, `app/frontend/src/contexts/palette-actions-context.tsx`, `app/frontend/src/components/server-dialogs.tsx` (or equivalent placement).
- Tests: colocated unit tests for the two new contexts (mirror `settings-dialog-context` / `top-bar-slot-context` coverage); existing `command-palette.test.tsx` / `command-palette.boards.test.tsx` and any dialog-touching unit tests updated for the new ownership; existing Playwright e2e specs that drive the palette and server dialogs on both routes must stay green (they are the primary regression guard — entry ids/labels unchanged).
- No Go backend changes; no API changes.

## Open Questions

- None — all decision points scored ≥ 50 (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Lift via two new contexts + single mounts in `AppLayout`, mirroring `settings-dialog-context` (o7q8) and `top-bar-slot-context` (PR #326) | Backlog FIX line names exactly these precedents; both patterns are proven in-repo | S:90 R:70 A:90 D:85 |
| 2 | Confident | Unified dialogs adopt AppShell's superset: `DAEMON_SERVER` warning, `toSafeServerName`/`finalizeSafeName`, navigate-away only when killing the current server (via SessionContext `currentServer`, null on boards) | The board copies' gaps are drift, not design — the warning and sanitization exist for safety; the currentServer rule reproduces both routes' current navigation behavior exactly | S:70 R:80 A:85 D:75 |
| 3 | Confident | Global palette groups (nav, font, refresh, help, shortcuts, settings, update, check, maintenance, version) move to a layout-level builder; routes register only route-scoped actions | Backlog: "boards stop re-implementing these globals"; the shared `lib/palette-*` builders already exist for every group | S:80 R:65 A:80 D:70 |
| 4 | Confident | Palette-actions context exposes the merged decorated list back to routes; AppShell's `fromPalette` keybinding resolution and macro target/invocation seams consume it | Verified in code: chords `go-back`/`settings-open` and macro targets resolve ids that become global; without the merged list they silently break | S:60 R:70 A:80 D:70 |
| 5 | Confident | ShortcutsOverlay state + mount lift to AppLayout (Part C) | Forced by moving the `Help: Keyboard Shortcuts` global entry — a layout-level entry cannot toggle route-local state; same DD-8 duplication cluster | S:55 R:75 A:80 D:70 |
| 6 | Confident | Kill-window dialogs stay route-owned (out of scope); only the true server create/kill twins are lifted | The two kill-window dialogs differ semantically (board: kill-everywhere + Unpin escape; terminal: current-window confirm) and their trigger states are route-specific; backlog's FIX sentence targets what is twinned | S:40 R:75 A:65 D:55 |
| 7 | Certain | Pure ownership refactor: every palette entry keeps its id/label/behavior; no visible UI change beyond the two board-side drift fixes in #2 | Refactor with existing unit + e2e suites as the regression guard; ids double as keybinding actionIds so identity is load-bearing | S:85 R:90 A:95 D:90 |

7 assumptions (2 certain, 5 confident, 0 tentative, 0 unresolved).
