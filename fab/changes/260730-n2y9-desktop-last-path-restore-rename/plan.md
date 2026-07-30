# Plan: Desktop shell per-server last-visited-page restore + server rename affordance

**Change**: 260730-n2y9-desktop-last-path-restore-rename
**Intake**: `intake.md`

## Requirements

### Store: `lastPath` field + tolerant validation (`app/desktop/src/servers.ts`)

#### R1: Optional `lastPath` on `ServerEntry`, schema stays version 1
`ServerEntry` SHALL gain an optional `lastPath?: string` field — the SPA-route remainder (`pathname + search`, e.g. `/utils2/rk-dev?x=1`). The schema version MUST stay `1` (the field is additive and optional). Load validation MUST tolerate absence and MUST NOT treat a wrong-typed `lastPath` as whole-file corruption: absent → entry loads unchanged; present as a string → kept; present with any other type → the entry loads with the field dropped. A pre-existing valid version-1 file without `lastPath` MUST load exactly as before.

- **GIVEN** an existing `servers.json` written before this change (no `lastPath` on any entry)
- **WHEN** `loadServers(dir)` runs
- **THEN** the list loads identically to today (no field added, no entry dropped)

- **GIVEN** a `servers.json` where one entry has `"lastPath": 42` (wrong type)
- **WHEN** `loadServers(dir)` runs
- **THEN** that entry loads with `lastPath` dropped, all other entries and fields intact — the file is never reduced to `emptyList()`

- **GIVEN** an entry with `"lastPath": "/board/main"`
- **WHEN** loaded
- **THEN** the entry carries `lastPath === "/board/main"`

#### R2: `setServerLastPath` store mutator
`servers.ts` SHALL export `setServerLastPath(dir: string, id: string, lastPath: string): ServerList` following the existing load → transform → `saveServers` atomic-write shape. It sets (or overwrites) the matching entry's `lastPath` and persists. An unknown `id` MUST be a no-op (returns the loaded list, writes nothing — matching `setActiveServer`). The module MUST stay electron-free.

- **GIVEN** a stored server with id X
- **WHEN** `setServerLastPath(dir, X, "/s1/w1")` then `setServerLastPath(dir, X, "/board/b")`
- **THEN** a fresh `loadServers(dir)` shows `lastPath === "/board/b"` (overwrite wins) and all other fields unchanged

- **GIVEN** an id not in the list
- **WHEN** `setServerLastPath(dir, "nope", "/x")`
- **THEN** the returned list equals the stored list and the file is unmodified

#### R3: `renameServer` store mutator
`servers.ts` SHALL export `renameServer(dir: string, id: string, name: string): ServerList` (same load → transform → atomic-save shape). The new name is trimmed; an empty/whitespace-only name falls back to the entry's `url` (origin) — mirroring `addServer`'s name normalization. Only `name` changes: `id`, `url`, `lastPath`, and `activeId` linkage MUST be untouched. Unknown `id` is a no-op.

- **GIVEN** a server `{id: X, name: "old", url: "http://a:1", lastPath: "/w"}`
- **WHEN** `renameServer(dir, X, "  new  ")`
- **THEN** the persisted entry is `{id: X, name: "new", url: "http://a:1", lastPath: "/w"}`

- **GIVEN** the same server
- **WHEN** `renameServer(dir, X, "   ")`
- **THEN** the persisted name is `"http://a:1"` (origin fallback)

- **GIVEN** an unknown id
- **WHEN** `renameServer(dir, "nope", "n")`
- **THEN** nothing is written

### Main process: capture seam (`app/desktop/src/main.ts`)

#### R4: Capture the outgoing server's path with guards
The shell SHALL capture the window's current SPA route at every shell-initiated navigation away from a (potentially) registered-server page and at window close/quit. A single `captureLastPath()` helper reads `mainWindow.webContents.getURL()` and applies two guards:

1. **Welcome guard**: a URL starting with `WELCOME_URL` (the `file://` page) is never captured.
2. **Origin-match guard**: the URL's origin is looked up against the registered servers' stored `url` origins; only on an exact match is `pathname + search` persisted via `setServerLastPath` for **that** entry. A mid-navigation or foreign-origin URL therefore cannot cross-pollinate another server's entry.

Capture call sites: `onSwitchServer` (before loading the incoming server), `onAddServer` (before navigating to welcome `?mode=add`), the rename navigation (before navigating to welcome `?mode=rename`), and the main window `close` event (capture-on-quit, so cold-start restore reflects the route at quit). No navigation-event tracking (`did-navigate-in-page` etc.) is added — the SPA uses the history API, so `getURL()` is current at capture time.

- **GIVEN** the window shows `http://a:1/utils2/rk-dev?x=1` for registered server A (`url: "http://a:1"`)
- **WHEN** the user switches to server B via ⌃2 (or opens Add/Rename, or quits)
- **THEN** server A's entry persists `lastPath === "/utils2/rk-dev?x=1"`

- **GIVEN** the window shows the welcome `file://` page
- **WHEN** any capture seam fires
- **THEN** nothing is captured or persisted

- **GIVEN** the window shows an origin matching no registered server
- **WHEN** a capture seam fires
- **THEN** nothing is persisted

#### R5: Restore `url + lastPath` on switch-in and startup
`onSwitchServer` SHALL load `entry.url + (entry.lastPath ?? "")` for the incoming server (after capturing the outgoing path). Startup routing (`showActive`) SHALL load `active.url + (active.lastPath ?? "")` — cold-start "reopen where I was". The navigation allowlist (`isAllowedNavigation`) is origin-based and already permits any path on a registered origin; it MUST NOT be relaxed or otherwise modified.

- **GIVEN** server B stored with `lastPath: "/board/main"`
- **WHEN** the user switches to B, or the app starts with B active
- **THEN** the window loads `http://b:2/board/main` (not the bare origin)

- **GIVEN** server B has no `lastPath`
- **WHEN** switched to / started into
- **THEN** the bare origin loads, exactly as today

### Rename affordance (`app/desktop/src/menu.ts`, `main.ts`, `preload.ts`, `src/welcome/`)

#### R6: `Servers → Rename "<name>"…` menu items
`MenuCallbacks` SHALL gain `onRenameServer: (id: string) => void`, and `buildMenu` SHALL render one `Rename "<name>"…` item per server (same `servers.map` pattern as the Remove items), placed between `Add Server…` and the Remove items. No new accelerators are bound (the ⌘-tier seam is untouched). The menu is already rebuilt on every list change, so renamed labels refresh automatically.

- **GIVEN** two registered servers
- **WHEN** the Servers menu is built
- **THEN** it contains `Rename "a"…`, `Rename "b"…` alongside the existing Remove items, with no accelerator on any of them

#### R7: Rename UI via the welcome page `?mode=rename` variant
The rename flow SHALL reuse the welcome page: `onRenameServer(id)` captures the outgoing path (R4), then loads `welcome.html` with query `mode=rename&id=<id>&name=<current-name>&url=<origin>` (main supplies the prefill context via the query string — no new read IPC). In rename mode the page hides the Server URL input, shows the server's origin in the tagline, pre-fills the name input, relabels the submit button `Rename`, and shows the cancel link (wired to the existing `welcome:cancel`, which returns to the active server). Submit invokes a new IPC `welcome:rename-server {id, name}` — no health ping. On success, main calls `renameServer`, rebuilds the menu, and returns the window to the active server via `showActive` (which restores its `lastPath` per R5). The preload bridge `__welcome` gains a `renameServer(id, name)` invoker, and `welcome.ts` narrows it structurally like the existing methods (no `as` casts, still import/export-free).

- **GIVEN** the user picks `Servers → Rename "studio-mac"…`
- **WHEN** the welcome page loads with `?mode=rename&id=<id>&name=studio-mac&url=http://a:1`
- **THEN** the URL field is hidden, the name input shows `studio-mac`, the button reads `Rename`, and the cancel link is visible

- **GIVEN** the rename form is submitted with a new name
- **WHEN** `welcome:rename-server` succeeds
- **THEN** only the entry's `name` changes (`id`/`lastPath`/`activeId` intact), the menu shows the new label, and the window returns to the active server's `url + lastPath`

- **GIVEN** the cancel link is clicked in rename mode
- **WHEN** `welcome:cancel` runs
- **THEN** the window returns to the active server with nothing persisted

#### R8: New IPC follows the existing security pattern
The `welcome:rename-server` handler MUST be gated by `isWelcomeSender(event)` (senderFrame URL check), MUST structurally narrow its payload (`id` required string; `name` string, defaulting to `""`) with no `as` casts, and MUST return `{ ok: true } | { ok: false, error }`. The navigation allowlist, `setWindowOpenHandler` denial, permission handler, and sandboxed preload wiring are otherwise untouched.

- **GIVEN** a page loaded from a registered server (not the welcome page)
- **WHEN** it invokes `welcome:rename-server`
- **THEN** the handler answers `{ ok: false, error: "Not allowed" }` and persists nothing

- **GIVEN** a malformed payload (missing/non-string `id`)
- **WHEN** the handler runs
- **THEN** it answers `{ ok: false, error: "Invalid request" }`

### Tests & package contract

#### R9: Store behavior covered by `node --test`; package stays 3-dep and type-clean
New store behavior (R1–R3) SHALL be covered by new cases in `app/desktop/src/servers.test.ts`, run via the package's existing contract (`pnpm run compile && pnpm test`, i.e. `node --test` over compiled `dist/`). `servers.ts` MUST stay electron-free. `tsc --noEmit` MUST pass for the package. No dependency is added (`devDependencies` stay exactly electron, electron-builder, typescript).

- **GIVEN** the completed change
- **WHEN** `cd app/desktop && pnpm run compile && pnpm test && pnpm exec tsc --noEmit`
- **THEN** all suites pass, including new cases for optional-field tolerance, `setServerLastPath`, and `renameServer`

### Non-Goals

- **No shell-side staleness validation** — a remembered route pointing at a since-removed window/board or dead server loads as-is; the SPA's Not Found fallback and dead-server handling are the failure mode. No health-ping of the path, no fallback-to-origin logic (intake decision 4).
- **No live `WebContentsView` per server** — rejected in intake (memory, N live connection sets, viewer-shell scope).
- **No SPA/backend changes** — `app/frontend`, `app/backend`, and the rk API are untouched; no new SPA routes (Constitution IV).
- **No e2e harness for the shell** — main-process wiring is covered by store tests + manual verification (the package has no e2e harness; intake constraint).

### Design Decisions

#### Capture target resolved by origin lookup, not by activeId
**Decision**: `captureLastPath()` resolves which entry to persist to by matching the displayed URL's origin against the registered list, rather than trusting the store's `activeId` as "the outgoing server".
**Why**: `setWindowOpenHandler` can load a registered origin in-window without updating `activeId`, so the displayed origin can differ from the active entry; origin lookup persists the path to the server that actually owns it, which subsumes the intake's outgoing-origin match and makes cross-pollination structurally impossible.
**Rejected**: Matching against `resolveActiveServer(...)` only — saves nothing (or the wrong thing) when the displayed page belongs to a non-active registered origin.
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

#### Rename prefill rides the welcome query string
**Decision**: Main passes `id`, current `name`, and `url` as `loadFile` query params for `?mode=rename`; the page reads them from `URLSearchParams`.
**Why**: The values come from main (trusted, store-derived) and the page already parses `location.search` for `?mode=add`; a read-IPC (`welcome:get-server`) would add handler surface for no gain.
**Rejected**: A new gated read IPC — more privileged surface, same data.
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

## Tasks

### Phase 1: Store (`servers.ts` + tests)

- [x] T001 Add optional `lastPath?: string` to `ServerEntry` in `app/desktop/src/servers.ts`; rework entry/list validation so absent `lastPath` loads unchanged, string is kept, wrong-typed is dropped per-entry (never `emptyList()` for an otherwise-valid file) <!-- R1 -->
- [x] T002 Add `setServerLastPath(dir, id, lastPath)` to `app/desktop/src/servers.ts` (load → transform → atomic save; unknown id no-op, no write) <!-- R2 -->
- [x] T003 Add `renameServer(dir, id, name)` to `app/desktop/src/servers.ts` (trim, empty → url fallback, unknown id no-op; only `name` changes) <!-- R3 -->
- [x] T004 Add `node --test` cases in `app/desktop/src/servers.test.ts` for R1 tolerance (old file unchanged, string kept, wrong type dropped without nuking the list), R2 (set/overwrite/unknown-id no-op/round-trip), R3 (trim/empty-fallback/unknown-id no-op/id+lastPath+activeId preserved); run `pnpm run compile && pnpm test` <!-- R1, R2, R3 -->

### Phase 2: Capture & restore seams (`main.ts`)

- [x] T005 Implement `captureLastPath()` in `app/desktop/src/main.ts` (welcome-URL guard + origin lookup against registered servers → `setServerLastPath` with `pathname + search`); call it from `onSwitchServer`, `onAddServer`, and the main window `close` event <!-- R4 --> <!-- rework: with two entries sharing one origin, `.find()` at main.ts:126 targets the FIRST match, not the active entry — capture writes to the wrong entry. Prefer the activeId match among same-origin entries --> <!-- fixed: origin resolution extracted to pure `findServerByOrigin(list, origin)` in servers.ts (active entry wins among same-origin matches, else first, else null); captureLastPath uses it; 3 new node --test cases cover the targeting -->
- [x] T006 Restore `entry.url + (entry.lastPath ?? "")` in `onSwitchServer` and `active.url + (active.lastPath ?? "")` in `showActive` in `app/desktop/src/main.ts`; leave `isAllowedNavigation` untouched <!-- R5 -->

### Phase 3: Rename affordance

- [x] T007 Add `onRenameServer` to `MenuCallbacks` and render accelerator-less `Rename "<name>"…` items (one per server, between Add Server… and the Remove items) in `app/desktop/src/menu.ts` <!-- R6 -->
- [x] T008 In `app/desktop/src/main.ts`: wire `onRenameServer` (capture via T005's helper, then load welcome with `mode=rename&id&name&url` query) and add the `welcome:rename-server` IPC handler — `isWelcomeSender` gate, structural payload narrowing, `renameServer` + `rebuildMenu` + `showActive` on success <!-- R7, R8 -->
- [x] T009 Expose `renameServer(id, name)` on the `__welcome` bridge in `app/desktop/src/preload.ts` <!-- R7 -->
- [x] T010 Implement rename mode in `app/desktop/src/welcome/welcome.html` + `welcome.ts`: parse `mode/id/name/url` params, hide the URL field, show origin in the tagline, pre-fill name, `Rename` button label, cancel link visible, submit → `renameServer` bridge call (narrowed structurally, no ping) <!-- R7 --> <!-- rework: MUST-FIX — the "Server URL" label stays visible in rename mode: author rule `label { display: block }` (welcome.html:45-46) overrides the UA `[hidden] { display: none }`. Add `[hidden] { display: none !important; }` to welcome.html's style block (also repairs the pre-existing cancel-link visibility bug from `a#cancel { display: block }` at welcome.html:93-98) --> <!-- fixed: `[hidden] { display: none !important; }` added to the style block — the hidden attribute now beats both `label { display: block }` and `a#cancel { display: block }`; JS-visible states unaffected (hidden=false removes the attribute, author rules re-apply) -->

### Phase 4: Verification

- [x] T011 Full package gate: `cd app/desktop && pnpm run compile && pnpm test && pnpm exec tsc --noEmit` — all green, `devDependencies` unchanged (3 deps) <!-- R9 --> <!-- rework: re-run after T005/T010 fixes --> <!-- re-ran after fixes: compile + 26/26 tests + tsc --noEmit green; devDependencies = electron, electron-builder, typescript -->

## Execution Order

- T001 blocks T002–T004 (validation shape first)
- T005 blocks T006 and T008 (both reuse the capture helper / its guards)
- T007–T010 can proceed after Phase 1; T008 depends on T005
- T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ServerEntry.lastPath?` exists; old `servers.json` files (no `lastPath`) load byte-for-byte unchanged; string kept; wrong-typed dropped per-entry without emptying the list
- [x] A-002 R2: `setServerLastPath` sets/overwrites and persists atomically; unknown id writes nothing
- [x] A-003 R3: `renameServer` trims, falls back to the origin on empty, no-ops on unknown id, and changes only `name`
- [x] A-004 R4: `captureLastPath()` persists `pathname + search` for the origin-matched entry and is called from switch, add-server navigation, rename navigation, and window close — all four call sites present (`main.ts:148,156,163,323`). Same-origin duplicates resolved: capture targets via `findServerByOrigin` (`servers.ts`), which prefers the active entry among same-origin matches and falls back to the first — covered by 3 `node --test` cases
- [x] A-005 R5: switch-in and startup load `url + (lastPath ?? "")`; no-`lastPath` entries load the bare origin as before
- [x] A-006 R6: Servers menu shows accelerator-less `Rename "<name>"…` items per server via `onRenameServer`
- [x] A-007 R7: welcome `?mode=rename` variant — hidden URL field, prefilled name, `Rename` button, cancel link — submits `welcome:rename-server` through the preload bridge and returns to the active server on success. Fixed: `[hidden] { display: none !important; }` added to `welcome.html`'s style block, so the `hidden` attribute now beats the author rules `label { display: block }` and `a#cancel { display: block }` — the "Server URL" label hides in rename mode, and the pre-existing first-run cancel-link visibility bug is repaired too. JS toggling is unaffected (`hidden = false` removes the attribute, restoring the author `display`). Prefill, `Rename` label, tagline origin, and cancel link verified previously and unchanged

### Behavioral Correctness

- [x] A-008 R4: the welcome `file://` page and foreign/unregistered origins are never captured (`main.ts:119` welcome guard, `main.ts:126-127` origin-match guard)
- [x] A-009 R7: renaming preserves `id`, `lastPath`, and `activeId` linkage (menu label refreshes via the existing rebuild) — covered by the `renameServer trims the name and changes nothing else` test

### Scenario Coverage

- [x] A-010 R1: `node --test` cases cover absent / string / wrong-typed `lastPath` load behavior
- [x] A-011 R2: `node --test` cases cover set, overwrite, unknown-id no-op, and persistence round-trip
- [x] A-012 R3: `node --test` cases cover trim, empty-fallback, unknown-id no-op, and id/lastPath preservation

### Edge Cases & Error Handling

- [x] A-013 R1: a wrong-typed `lastPath` on one entry never causes `loadServers` to return `emptyList()` for an otherwise-valid file
- [x] A-014 R8: `welcome:rename-server` from a non-welcome sender returns `{ ok: false, error: "Not allowed" }`; malformed payloads return `{ ok: false, error: "Invalid request" }` (`main.ts:284-286`) — code-inspected; the package has no main-process test harness (R9 non-goal)

### Code Quality

- [x] A-015 Pattern consistency: new store mutators follow the load → transform → `saveServers` shape; IPC/preload/welcome additions mirror the existing `welcome:*` patterns
- [x] A-016 No unnecessary duplication: capture logic lives in one helper reused by all seams; rename reuses the welcome page, cancel IPC, and name-fallback convention — `setServerLastPath`/`renameServer` are the third copy of the load→guard→map→save shape (nice-to-have: extract `patchServer`)
- [x] A-017 Type narrowing over assertions: all new payload/bridge handling uses structural `if` guards, no `as` casts
- [x] A-018 Tests ship with behavior: R1–R3 covered in `servers.test.ts` (package test contract) — 26/26 pass (includes the 3 `findServerByOrigin` targeting cases)

### Security

- [x] A-019 R8: new IPC is senderFrame-gated; navigation allowlist, window-open denial, permission handler, and sandbox settings are unmodified — verified in the diff: no change to `isAllowedNavigation`, `setWindowOpenHandler`, `setPermissionRequestHandler`, or `webPreferences`. Query prefill is `URLSearchParams`-encoded (no param smuggling) and both page sinks are `textContent` / `input.value` (no XSS)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/desktop/src/welcome/welcome.ts:167` (`renameId ?? ""`) — dead fallback: `rename()` is dispatched only when `renameId !== null` (`:203`), so the `?? ""` branch is unreachable. Passing the id as a parameter removes it.
- `app/desktop/src/servers.ts:163-172` + `:179-188` — `setServerLastPath` and `renameServer` are structural twins (load → membership-guard → `map` patch → `saveServers`); a private `patchServer(dir, id, patch)` would collapse both to one-liners (`setActiveServer:154-160` shares the guard/save shape but patches a top-level field, so it only partly folds in).

*Retracted from the prior cycle*: `welcome.ts:159` (`els.connectButton.textContent = idleLabel`) was listed as a redundant duplicate of `setBusy`'s label restore. It is **not** redundant — `setBusy` is never called during init (`:166,170,179,183,191,195` are all in-flight paths), so `:159` is the only write that renders the `Rename` label on load. Deleting it would regress R7.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Rename UI = welcome page `?mode=rename&id=<id>` variant (intake #10 front-runner adopted): reuse the existing card, name input, cancel link, and gated-IPC plumbing; hide the URL field; no health ping | Electron has no native text-input dialog; the welcome page already carries every needed piece and the `?mode=add` precedent; a custom dialog window would add surface for no gain | S:60 R:75 A:80 D:70 |
| 2 | Confident | Capture also runs at window close/quit via the main window `close` event (intake #11 front-runner adopted), so cold-start restore reflects the route at quit | "Reopen where I was" is the stated point of persisting; a switch-time-only snapshot silently serves stale routes after quit; `webContents.getURL()` is still readable at `close` | S:60 R:80 A:75 D:70 |
| 3 | Confident | Capture also runs on add-server navigation away (menu `Add Server…`) and on rename navigation away (intake #12 front-runner adopted — every shell-initiated navigation off a registered server captures) | Same seam, same helper — one guard-protected call site each; skipping them would lose the route on a common flow (add a server, come back) | S:60 R:85 A:80 D:75 |
| 4 | Confident | `captureLastPath()` resolves the target entry by origin lookup across the registered list rather than matching only the store's `activeId` entry | Window-open in-window loads can show a registered origin without updating `activeId`; origin lookup subsumes the intake's outgoing-origin match and structurally prevents cross-pollination (see Design Decisions) | S:55 R:85 A:80 D:70 |
| 5 | Confident | Rename prefill context (`id`, current `name`, `url`) rides the welcome `loadFile` query string from main; no new read IPC | Values are main-supplied (trusted, store-derived); the page already parses `location.search`; smaller privileged surface than a read IPC | S:55 R:85 A:80 D:70 |
| 6 | Confident | On successful rename (and on unknown id, which no-ops in the store), main returns the window to the active server via `showActive`; the cancel link reuses the existing `welcome:cancel` | Mirrors the add/cancel flow exactly — the welcome page is always exited back to the active server; unknown-id no-op matches `setActiveServer` | S:55 R:85 A:80 D:75 |
| 7 | Confident | Menu placement: `Rename "<name>"…` items sit between `Add Server…` and the `Remove "<name>"…` items, accelerator-less | Intake says "alongside the Remove items"; grouping management verbs after Add matches the existing submenu order; trivially reversible | S:50 R:90 A:75 D:65 |
| 8 | Confident | Wrong-typed `lastPath` on load → field dropped, entry kept (intake #9's front-runner); a captured `lastPath` of `/` is persisted as-is (loading `origin + "/"` is equivalent to the bare origin) | Dropping the field is the least destructive reading consistent with "never make a valid file stop loading"; special-casing `/` adds a branch for zero behavioral difference | S:55 R:85 A:80 D:75 |

8 assumptions (0 certain, 8 confident, 0 tentative).
