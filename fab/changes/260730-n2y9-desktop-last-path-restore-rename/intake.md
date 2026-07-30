# Intake: Desktop shell per-server last-visited-page restore + server rename affordance

**Change**: 260730-n2y9-desktop-last-path-restore-rename
**Created**: 2026-07-30

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`) from a synthesized design conversation. The user agreed to all five numbered decisions below during the conversation; three UI/behavior details were explicitly left undecided and are recorded as deferred Unresolved assumptions.

> Feature: Desktop shell per-server last-visited-page restore + server rename affordance (`app/desktop`).
>
> Problem: In the Electron desktop viewer shell, switching between registered rk servers always loads the bare stored origin (`main.ts:120` menu switch callback does `loadURL(entry.url)`; same on add-server at `main.ts:228` and startup routing at `main.ts:93-97`), so the SPA route the user was on (`/$server/$window`, `/board/$name`) is lost on every switch and on app restart.
>
> Decisions made in conversation: (1) switch-time capture via `mainWindow.webContents.getURL()` with outgoing-origin match, restore `url + lastPath` on switch-in; (2) persist `lastPath` as an optional per-server field in `<userData>/servers.json`, schema stays version 1, startup routing also uses it; (3) guards — never capture the welcome `file://` page, origin-match against the outgoing server; (4) no shell-side staleness validation — stale routes are the SPA's failure mode; (5) add a `Servers → Rename "<name>"…` affordance so per-server state (keyed on `id`) survives without the remove-and-re-add workaround that mints a new UUID.
>
> Rejected: live `WebContentsView` per server (Slack-style — memory + N live connection sets + complexity, out of scope for a viewer shell); in-memory-only `Map<id, path>` (fixes switching but not cold-start).

## Why

**The pain point.** The desktop shell (`app/desktop`) is a viewer over registered `rk serve` URLs. All three navigation seams in `src/main.ts` load the bare stored origin:

- `rebuildMenu()`'s `onSwitchServer` callback: `void mainWindow.loadURL(entry.url)` (main.ts:120)
- the `welcome:add-server` IPC handler: `void mainWindow.loadURL(result.server.url)` (main.ts:228)
- startup routing `showActive()`: `void win.loadURL(active.url)` (main.ts:97)

The rk SPA is deep-routed (`/$server/$window` terminal pages, `/board/$name` boards). Because only the origin is ever loaded, every server switch and every app restart dumps the user back at the SPA root — the route they were working in is lost. For a multi-server operator flipping between machines with ⌃1–⌃9, this makes switching expensive: every flip costs a re-navigation back to the window or board they were on.

**The consequence of not fixing it.** The shell stays strictly worse than browser tabs for multi-server use (a browser at least keeps each tab's route). The ⌃-digit switcher — the shell's headline seam — punishes use.

**Why this approach.** Two alternatives were considered and rejected in the design conversation:

- **Live `WebContentsView` per server** (Slack-style workspaces — keeps scroll position, terminal state, and SSE connections alive per server). Rejected: memory cost, N live connection sets (SSE + per-pane relay WebSockets per server), and lifecycle complexity — out of scope for a *viewer* shell. Last-path restore captures most of the value at a fraction of the cost.
- **In-memory-only `Map<id, path>`**. Rejected: fixes switching but not cold-start ("reopen where I was" after quit). Persisting to the existing `servers.json` store is a small step more and the store already exists with atomic-write plumbing.

**Why rename rides along.** Today the display name is settable only at add time (the Servers menu has only Add/Remove — see `buildMenu` in `src/menu.ts`). The workaround — remove and re-add — mints a new `randomUUID()` `id` (servers.ts:108). Once per-server state like `lastPath` exists and keys on `id`, that workaround silently drops state. A first-class rename (which touches only `name`, never `id`) makes renaming always safe. Per-server state MUST key on `id`, never the name.

## What Changes

### 1. Store: optional `lastPath` field on `ServerEntry` (`src/servers.ts`)

- `ServerEntry` gains an optional field: `lastPath?: string` — the SPA-route remainder (`pathname + search`, e.g. `/utils2/rk-dev?x=1` or `/board/main`) last seen for that server. Schema stays **version 1**: the field is additive and optional.
- **Validation must tolerate absence and reject only wrong types without nuking the file.** Today `isServerEntry`/`isServerList` treat any wrong shape as corrupt → `emptyList()` (servers.ts:58-91), which would wipe the user's server list. The new field is validated as *optional*: absent → fine (existing `servers.json` files keep loading unchanged); present and `typeof === "string"` → kept; present with any other type → the entry loads with the field dropped (or the entry is rejected — but never in a way that makes a pre-existing valid file stop loading). The load path for existing version-1 files without `lastPath` MUST be byte-for-byte unaffected.
- New store mutator, mirroring the existing style (load → transform → `saveServers` atomic write), e.g.:

  ```ts
  /** Record the last-visited SPA path for a server; unknown id is a no-op. */
  export function setServerLastPath(dir: string, id: string, lastPath: string): ServerList
  ```

- New store mutator for rename, same shape:

  ```ts
  /** Rename a server by id (trimmed; empty falls back to the origin). Unknown id is a no-op. */
  export function renameServer(dir: string, id: string, name: string): ServerList
  ```

- Both are electron-free (data dir parameterized) and covered by new `node --test` cases in `src/servers.test.ts` run over compiled `dist/` — the package's existing test contract.

### 2. Capture seam: save the outgoing server's path (`src/main.ts`)

At the moment the shell navigates the window *away* from a registered server (at minimum the `onSwitchServer` callback):

1. Read `mainWindow.webContents.getURL()`.
2. **Guard — welcome page**: if the URL starts with `WELCOME_URL` (a `file://` URL), capture nothing.
3. **Guard — origin match**: parse the URL's origin and compare it to the *outgoing* server's stored `url` (which is a normalized bare origin). Only on an exact match, persist `pathname + search` as that server's `lastPath` via `setServerLastPath`. A mid-navigation or foreign-origin URL therefore can't cross-pollinate another server's entry.

No navigation-event tracking (`did-navigate-in-page` listeners etc.) is needed: the SPA (TanStack Router) uses the history API, so `getURL()` reflects the current SPA route at capture time.

### 3. Restore seam: load `url + lastPath` instead of the bare origin (`src/main.ts`)

- `onSwitchServer`: after capturing the outgoing path, load `entry.url + (entry.lastPath ?? "")` for the incoming server.
- Startup routing (`showActive`): load `active.url + (active.lastPath ?? "")` — cold-start "reopen where I was".
- The navigation allowlist (`isAllowedNavigation` — origin-membership check, main.ts:81-85) already permits any path on a registered origin, so restored deep routes pass the existing guard unchanged; the security wiring is preserved, not relaxed.

### 4. Staleness: none handled shell-side

A remembered route pointing at a since-removed window/board/dead server is loaded as-is; the SPA's Not Found fallback and dead-server handling are the failure mode. The shell performs no validation, no health-ping of the path, no fallback-to-origin logic.

### 5. Rename affordance (`src/menu.ts`, `src/main.ts`, and the rename UI)

- `MenuCallbacks` gains `onRenameServer: (id: string) => void`; `buildMenu` renders `Rename "<name>"…` items alongside the existing `Remove "<name>"…` items (one per server, same `servers.map` pattern). Menu is already rebuilt via `rebuildMenu()` on every list change, so the new labels refresh automatically.
- Renaming updates only `name` via `renameServer`; `id` (and therefore `lastPath` and `activeId` linkage) is untouched.
- **UI mechanism is deferred** (see Assumptions #10): Electron has no native text-input dialog. The provisional front-runner is extending the existing welcome page with a `?mode=rename&id=<id>` variant (it already has a name input, a cancel link for `?mode=add`, and the IPC plumbing), but this was explicitly not decided in the conversation.
- **Any new IPC follows the existing `welcome:*` pattern**: handler gated by `isWelcomeSender(event)` (senderFrame URL check against `WELCOME_URL`, main.ts:198-200), structural payload narrowing (no `as` casts), `{ ok } | { ok: false, error }` results, exposed via the sandboxed preload bridge (`src/preload.ts`).

### Constraints (carried from the conversation)

- `app/desktop` stays a self-contained 3-dep package (electron, electron-builder, typescript) — no new dependencies.
- Constitution: new behavior ships with tests (store logic in `servers.test.ts`; the package has no e2e harness — main-process wiring is covered by the store tests plus manual verification).
- Security wiring — navigation allowlist, `setWindowOpenHandler` denial, senderFrame-gated IPC, sandboxed preload — must be preserved.

## Affected Memory

- `run-kit/desktop-shell`: (modify) servers.json store gains optional per-server `lastPath` (schema stays v1) + rename mutator; switch/startup routing restores `origin + lastPath` with welcome-page and origin-match capture guards; Servers menu gains per-server Rename items; per-server state keys on `id`.

## Impact

- **`app/desktop/src/servers.ts`** — `ServerEntry.lastPath?: string`, optional-tolerant validation in `isServerEntry`, `setServerLastPath`, `renameServer`.
- **`app/desktop/src/servers.test.ts`** — new `node --test` cases: optional-field tolerance (old files load; wrong-typed `lastPath` doesn't nuke the list), `setServerLastPath` (set/overwrite/unknown-id no-op/persistence round-trip), `renameServer` (trim/empty-fallback/unknown-id no-op/id-and-lastPath preserved).
- **`app/desktop/src/main.ts`** — capture-on-switch with the two guards; restore on switch-in and startup; rename callback wiring + any new senderFrame-gated IPC handler.
- **`app/desktop/src/menu.ts`** — `onRenameServer` callback + `Rename "<name>"…` items.
- **`app/desktop/src/welcome/welcome.html` / `welcome.ts` / `src/preload.ts`** — only if the deferred rename-UI decision lands on the `?mode=rename` welcome-page variant.
- No `app/backend`, `app/frontend`, or rk API changes. No new routes in the SPA (Constitution IV untouched). No new dependencies.

## Open Questions

- Rename UI mechanism: extend the welcome page with `?mode=rename` (front-runner — reuses the name input, cancel link, and gated-IPC plumbing) or some other in-window affordance?
- Should `lastPath` capture also run at quit/window-close (capture-on-quit), so cold-start restore reflects the route at quit rather than the route at the last switch-away? (Without it, decision 2's "reopen where I was" only restores the last *switch-time* snapshot.)
- Should the add-server flow (`welcome:add-server` handler and the menu's "Add Server…" navigation to welcome) also capture the outgoing server's path before navigating away?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Capture at switch time via `webContents.getURL()`; save `pathname + search` as the outgoing server's `lastPath`; no navigation-event tracking (TanStack Router uses the history API, so `getURL()` is current) | Discussed — user agreed to the exact mechanism | S:90 R:75 A:85 D:90 |
| 2 | Certain | Persist `lastPath` as an optional per-server field in `servers.json`; schema stays version 1; startup routing also uses it (cold-start restore) | Discussed — user chose persist over in-memory `Map` specifically for cold-start | S:90 R:70 A:85 D:90 |
| 3 | Certain | Guards: never capture the welcome `file://` URL; origin-match the captured URL against the outgoing server before saving | Discussed — user agreed; prevents cross-server pollination | S:90 R:85 A:90 D:90 |
| 4 | Certain | No shell-side staleness validation — a stale route is the SPA's failure mode (Not Found / dead-server handling); shell just loads it | Discussed — user agreed | S:85 R:90 A:85 D:85 |
| 5 | Certain | Rename affordance as `Servers → Rename "<name>"…` menu capability; rename touches only `name`; per-server state keys on `id`, never the name | Discussed — user agreed, with the remove-and-re-add state-loss rationale | S:85 R:80 A:85 D:85 |
| 6 | Certain | New store-field logic lives in electron-free `servers.ts` and is tested via `node --test` over compiled `dist/` in `servers.test.ts` | Constraint stated in conversation; matches the package's existing test contract and the constitution's tests-with-behavior rule | S:85 R:90 A:95 D:95 |
| 7 | Certain | Security wiring preserved: navigation allowlist untouched (registered origins already allow any path); any new rename IPC follows the `welcome:*` senderFrame-gating pattern | Constraint stated in conversation; pattern exists verbatim in main.ts/preload.ts | S:85 R:80 A:90 D:90 |
| 8 | Confident | `renameServer` mirrors `addServer` name normalization: trimmed, empty input falls back to the server's origin; unknown id is a no-op (matching `setActiveServer`) | Consistency with existing store functions (servers.ts:109, :134) — one obvious default | S:55 R:85 A:75 D:70 |
| 9 | Confident | `lastPath` is written through a new store mutator (`setServerLastPath(dir, id, path)`) using the existing load→transform→atomic-save shape; a wrong-typed `lastPath` on load is tolerated (dropped), never treated as whole-file corruption | Store style is uniform and the conversation requires old files to keep loading; only the wrong-type handling detail is agent-decided | S:60 R:80 A:85 D:80 |
| 10 | Unresolved | Rename UI mechanism — provisional front-runner: welcome page `?mode=rename` variant (reuses name input, cancel link, gated IPC) vs. another in-window affordance | Deferred — promptless dispatch | S:40 R:60 A:55 D:45 |
| 11 | Unresolved | Whether `lastPath` capture also runs at quit/window-close (capture-on-quit) or only on explicit server switches — front-runner: also capture on quit, else cold-start restore serves the last switch-time snapshot | Deferred — promptless dispatch | S:40 R:70 A:60 D:55 |
| 12 | Unresolved | Whether the add-server flow also captures the outgoing server's path before navigating away — front-runner: yes, capture on every shell-initiated navigation away from a registered server | Deferred — promptless dispatch | S:40 R:75 A:65 D:60 |

12 assumptions (7 certain, 2 confident, 0 tentative, 3 unresolved).
