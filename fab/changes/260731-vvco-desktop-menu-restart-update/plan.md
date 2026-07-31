# Plan: Desktop Shell "Restart to Update" Menu Item

**Change**: 260731-vvco-desktop-menu-restart-update
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Update-Check Pure Module

#### R1: `rk desktop status` stdout parsing lives in an electron-free pure module
A new module `app/desktop/src/update-check.ts` SHALL parse `rk desktop status` stdout (data channel — stable lines per the toolkit output contract: `Installed: vX` / `Installed: not installed`, `Latest:    vY`, and the `Update available — run 'rk desktop update'.` marker vs `Up to date.`) and derive update availability. The module MUST be electron-free (the `hosts.ts` / `window-open.ts` / `local-daemon.ts` precedent), MUST add no dependencies (three-dep pin preserved), and MUST ship with a sibling `node --test` suite `update-check.test.ts`. It SHALL also own the check-cadence constant (1 hour) and a pure throttle predicate so the cadence rule is unit-testable.

- **GIVEN** stdout `"Installed: v3.12.7\nLatest:    v3.13.0\nUpdate available — run 'rk desktop update'.\n"`
- **WHEN** the availability derivation runs
- **THEN** it yields an available update with latest version `3.13.0` (and installed `3.12.7` parsed)

- **GIVEN** stdout with `Up to date.` (no marker), or `Installed: not installed`, or unrecognizable output
- **WHEN** the availability derivation runs
- **THEN** it yields no available update (null) — never throws

- **GIVEN** a last-check timestamp less than one hour old
- **WHEN** the throttle predicate is asked whether a check is due
- **THEN** it answers false; a `null` timestamp or one ≥ 1h old answers true

#### R2: Detection is darwin-only, event-driven, throttled, and cached main-side
`src/main.ts` SHALL run the update check by spawning `rk desktop status` through the existing execFile plumbing (`runRk`-style: candidate-path binary resolution, argument slice, explicit timeout, GUI-PATH-augmented env). The check runs on startup and on `browser-window-focus`, throttled to at most one attempt per hour (no perpetual timer — the #478 menu-cache pattern), with the result cached main-side and the menu rebuilt only when the cached update info actually changes. Gating MUST be silent: non-darwin platforms, an unresolvable rk binary (ENOENT), a status failure (non-zero exit / timeout), an app reported not installed, and up-to-date all yield no menu item and no error surface.

- **GIVEN** the app starts on darwin with rk installed and a newer desktop release published
- **WHEN** the startup check completes
- **THEN** the cached update info holds the latest version and the menu is rebuilt showing the item

- **GIVEN** a window-focus event 10 minutes after the last check attempt
- **WHEN** the focus handler runs
- **THEN** no `rk desktop status` process is spawned (throttled)

- **GIVEN** win32/linux, or rk missing, or `rk desktop status` fails, or output says `Up to date.`
- **WHEN** detection runs (or is platform-skipped)
- **THEN** the cached info is null, no menu item renders, and nothing is shown to the user

### Desktop Shell: Menu Item

#### R3: An accelerator-less "Restart to Update" item in the macOS App menu, rendered only when an update is cached
`src/menu.ts` `buildMenu` SHALL gain the cached update info as an additional parameter (`update: UpdateMenuInfo | null`, the `daemon` param precedent), and the macOS App menu SHALL render a single accelerator-less item labeled `Restart to Update (v{latest} available)…` below the About/hide region and directly above Quit — only when `update` is non-null. While an update spawn is in flight the item SHALL retitle to `Updating…` and be disabled. The keyboard-tier seam is untouched (no accelerator ⇒ no registry-mirror change), and non-darwin menus never render the item.

- **GIVEN** cached update info `{ latestVersion: "3.13.0", updating: false }`
- **WHEN** the menu is built on darwin
- **THEN** the App menu contains an enabled, accelerator-less `Restart to Update (v3.13.0 available)…` item above Quit

- **GIVEN** the user clicked the item (spawn succeeded)
- **WHEN** the menu is rebuilt
- **THEN** the item reads `Updating…` and is disabled

- **GIVEN** `update` is null
- **WHEN** the menu is built
- **THEN** no update item exists anywhere in the template

#### R4: Click spawns `rk desktop update` fully detached; the CLI drives quit/swap/relaunch
The item's click handler in `src/main.ts` SHALL spawn `rk desktop update` via `child_process.spawn` with `detached: true`, `stdio: "ignore"`, and `.unref()` — so the child survives the CLI quitting the app — using the same resolved rk binary and GUI-PATH-augmented env as `runRk`. After a successful spawn the shell only retitles/disables the item (no dialog, no monitoring — post-spawn outcomes are the CLI's responsibility; the app is visibly quit and relaunched by the CLI, and the window `close` handler's existing `lastPath` capture restores the route). If the spawn itself fails (`error` event / ENOENT), the shell SHALL surface it via the existing native `dialog.showErrorBox` pattern and re-enable the item. No IPC or preload surface is added — the flow is main-side only.

- **GIVEN** the item is clicked and the rk binary spawns
- **WHEN** the CLI stages, quits the app, swaps, and relaunches
- **THEN** the shell performed no self-quit and no bundle mutation; the detached child ran to completion independently

- **GIVEN** the rk binary vanished between detection and click
- **WHEN** the spawn emits an ENOENT error
- **THEN** a native error dialog shows the failure and the menu item returns to its enabled state

### Desktop Shell: Posture Note

#### R5: The recorded child_process posture is extended in the code comments
The `src/main.ts` and `src/local-daemon.ts` header comments recording the shell's child_process posture ("explicit user-initiated `rk daemon` actions + read-only detection") SHALL be extended: the user-initiated clause gains `rk desktop update` (menu click) and the read-only detection clause gains `rk desktop status`. Still no auto-start; the shell remains a viewer. (The memory § posture line is hydrate's job, out of apply scope.)

- **GIVEN** the implemented change
- **WHEN** the header comments are read
- **THEN** they enumerate `rk desktop update` under user-initiated actions and `rk desktop status` under read-only detection

### Non-Goals

- Change A itself (umbrella `rk update` + installer auto-restart) — already merged (260731-3byh); consumed as-is.
- Any Windows/Linux update surface (`rk desktop` is macOS-only).
- SPA/bridge changes — no preload or IPC additions; the menu is main-side only.
- In-app updater (electron-updater/Squirrel) — recorded non-goal; the CLI is the updater.
- The app quitting itself after spawning — the CLI performs the graceful quit (AppleScript).

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependency work; the three-dep pin is untouched)*

### Phase 2: Core Implementation

- [x] T001 Create `app/desktop/src/update-check.ts`: parse `rk desktop status` stdout (`Installed:`/`Latest:` v-prefixed version lines, `Update available` marker), derive an available-update result (latest version or null), export the 1h `UPDATE_CHECK_INTERVAL_MS` constant and the pure `isUpdateCheckDue(lastCheckedAt, now)` throttle predicate. Electron-free, no new deps. <!-- R1 -->
- [x] T002 Create `app/desktop/src/update-check.test.ts`: node:test suite covering the real CLI output shapes (update available, up to date, not installed), unrecognizable/partial output, marker-without-parseable-version, and the throttle predicate (null / fresh / expired timestamps). <!-- R1 -->
- [x] T003 [P] Extend `app/desktop/src/menu.ts`: add `UpdateMenuInfo` (`{ latestVersion, updating }`), add `onRestartToUpdate` to `MenuCallbacks`, add `update: UpdateMenuInfo | null` param to `buildMenu`, and render the accelerator-less `Restart to Update (v{latest} available)…` / `Updating…` (disabled) item in `macAppMenu` above Quit when `update` is non-null. <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Wire detection in `app/desktop/src/main.ts`: cached `updateMenuInfo` + last-check timestamp, `refreshUpdateMenu()` (darwin gate → throttle gate → `runRk(["desktop","status"], …)` with a dedicated status timeout → parse via update-check → change-gated menu rebuild, all failure/absence states silent), called at startup and on `browser-window-focus`; pass the cached info into `buildMenu` from `rebuildMenu()`. <!-- R2 -->
- [x] T005 Implement the click flow in `app/desktop/src/main.ts`: `onRestartToUpdate` callback spawns `rk desktop update` detached (`spawn`, `detached: true`, `stdio: "ignore"`, `.unref()`, augmented-PATH env), sets `updating: true` + rebuilds the menu on successful spawn, and on a spawn `error` event shows `dialog.showErrorBox` and re-enables the item (`updating: false`). <!-- R4 -->
- [x] T006 Update the posture header comments in `app/desktop/src/main.ts` and `app/desktop/src/local-daemon.ts` to include `rk desktop update` (user-initiated) and `rk desktop status` (read-only detection). <!-- R5 -->

### Phase 4: Polish

- [x] T007 Run the package gates in `app/desktop`: `pnpm run compile`, `npx tsc --noEmit`, `node --test "dist/**/*.test.js"` — fix any failures. <!-- R1 -->

## Execution Order

- T001 blocks T002 (suite imports the module) and T004 (main imports the parser/throttle).
- T003 is parallelizable with T001/T002; T004 and T005 depend on both T001 and T003.
- T006 can run any time after T005; T007 is last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `src/update-check.ts` exists, is electron-free (no `electron` import), parses the three status output shapes, and derives availability; `update-check.test.ts` covers it under `node --test`
- [x] A-002 R2: detection runs on startup and window focus only, throttled to ≤1 attempt/hour, cached main-side, menu rebuilt only on cache change; darwin-only with all absence/failure states silent
- [x] A-003 R3: the App-menu item renders only when an update is cached, is accelerator-less, labeled `Restart to Update (v{latest} available)…`, placed above Quit, and never renders on non-darwin
- [x] A-004 R4: the click handler spawns `rk desktop update` with `detached: true`, `stdio: "ignore"`, `.unref()`; no IPC/preload additions anywhere in the diff
- [x] A-005 R5: the main.ts/local-daemon.ts posture comments enumerate the two new `rk desktop` invocations

### Behavioral Correctness

- [x] A-006 R3: after a successful spawn the item reads `Updating…` and is disabled; the shell shows no dialog and does not quit itself
- [x] A-007 R4: a spawn failure surfaces via `dialog.showErrorBox` and returns the item to its enabled state — verified the `error` event is async (fires after the synchronous `updating: true` set), so the handler's re-enable lands last

### Scenario Coverage

- [x] A-008 R1: tests cover update-available, up-to-date, not-installed, garbage output, and marker-present-but-version-unparseable (silent null) — plus a pre-release-suffix case; fixtures match `cmd/rk/desktop.go` `runDesktopStatus` output byte-for-byte
- [x] A-009 R1: tests cover the throttle predicate for null, <1h, and ≥1h timestamps (boundary cases at exactly the interval included)

### Edge Cases & Error Handling

- [x] A-010 R2: a `rk desktop status` non-zero exit, timeout, or ENOENT yields a null cache and no user-visible error (`runRk` swallows all rejections into `{ok:false}`; `refreshUpdateMenu` maps that to `null` with no dialog)
- [x] A-011 R2: a failed check attempt still consumes the throttle window — `lastUpdateCheckAt` is written *before* the `await`, which also makes a startup+focus double-fire single-flight

### Code Quality

- [x] A-012 Pattern consistency: the new module follows the pure-module pattern (injected inputs, electron-free — no imports at all) and main.ts wiring mirrors the `daemonMenuInfo` cache precedent (same/set/refresh trio, change-gated rebuild)
- [x] A-013 No unnecessary duplication: `restartToUpdate` reuses `rkBinary()` (→ `resolveRkBinary`/`rkCandidatePaths`) and `augmentPath`; it cannot reuse `runRk` (that is awaited `execFile` with a timeout, whereas this needs a detached fire-and-forget spawn)
- [x] A-014: New behavior ships with tests (`update-check.test.ts`, 12 cases); `package.json`/`pnpm-lock.yaml` are untouched, so the three-dep pin is preserved
- [x] A-015: No magic values — `UPDATE_CHECK_INTERVAL_MS`, `RK_STATUS_TIMEOUT_MS`, `UPDATING_LABEL`, `restartToUpdateLabel()`, and the three parse regexes are all named

### Security

- [x] A-016 R4: both new invocations use argument slices — `runRk(["desktop","status"], …)` and `spawn(rkBinary(), ["desktop","update"], …)`; no `shell: true`, no string interpolation into a command, and `preload.ts`/`app/frontend/` are untouched (no new IPC surface)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/desktop/src/update-check.ts:26` (`DesktopStatusReport.installedVersion`) — parsed and asserted in tests but never read in production (`availableUpdateVersion` uses only `updateAvailable` + `latestVersion`); it survives as the fixture that proves `Installed: not installed` does not parse as a version, so removing it would weaken the `v`-prefix regression guard. Keep unless a future consumer never materializes.
- None otherwise — this change is purely additive: it introduces a new detection path and a new menu group without superseding any existing code. The intake's rejected "SPA-side staleness nudge" alternative was never implemented, so there is no bridge/banner surface for this item to make redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Parser requires the `v`-prefixed `Installed:`/`Latest:` lines and derives availability from the `Update available` marker AND a parseable latest version; either missing → null (silent) | The label needs the version string, and `Installed: not installed` must not parse as a version — requiring the `v` prefix (the CLI always prints `v%s`) distinguishes it; marker-only with no version would render a broken label | S:70 R:85 A:85 D:75 |
| 2 | Confident | Dedicated `RK_STATUS_TIMEOUT_MS = 10s` for `rk desktop status` (between the 5s query tier and 30s daemon tier) | The command round-trips the GitHub releases API — slower than local `rk url`/`--version` but far from daemon-start work; a too-short timeout would silently suppress the feature on slow networks | S:60 R:90 A:80 D:70 |
| 3 | Confident | The throttle timestamp is recorded at attempt time, so failed checks also consume the 1h window | The throttle exists for GitHub API rate limits, which count attempts, not successes; retry lands at the next natural event ≥1h later | S:65 R:90 A:85 D:75 |
| 4 | Confident | `buildMenu` gains a positional 5th param `update: UpdateMenuInfo | null` (no options-object refactor) | The intake pins "the same way it gained the daemon param in #478"; an options-object refactor would churn all call sites for no behavior | S:80 R:85 A:90 D:85 |
| 5 | Confident | While `updating` is true, `refreshUpdateMenu` early-returns (no cache rewrite), so a focus-triggered check cannot re-enable the item mid-update; a post-spawn CLI failure leaves the item at `Updating…` until app restart | Intake: post-spawn outcomes are the CLI's responsibility and the CLI visibly relaunches the app; rewriting the cache mid-flight is the only way the disabled state could flicker back | S:60 R:85 A:80 D:70 |
| 6 | Confident | The detached child gets the same GUI-PATH-augmented env as `runRk` | The spawned rk may need brew-installed tooling and the Finder-launched GUI PATH trap applies to every spawn from this process; `augmentPath` exists precisely for this | S:70 R:90 A:90 D:85 |
| 7 | Confident | Item placement: inside `macAppMenu`, after the hide/unhide group's separator and directly above `{ role: "quit" }` | Intake pins "below the About/services region and above Quit"; the existing App menu has exactly one slot matching that description | S:75 R:95 A:90 D:85 |

7 assumptions (0 certain, 7 confident, 0 tentative).
