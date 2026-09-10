# Intake: Code Tile First-Boot Rescue Reload (gated on the code-bridge host record)

**Change**: 260910-74q0-code-tile-first-boot-rescue-reload
**Created**: 2026-09-10

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a diagnosed-and-decided description. No questions were asked; every decision the intake agent would have asked about is an Unresolved row in `## Assumptions` with Rationale `Deferred — promptless dispatch`.

> **Problem (diagnosed 2026-09-10, verified by repro).** When a run-kit tab opens the `code` tile on a `.code-workspace` file that code-server has never loaded before, the embedded editor shows the workspace title (e.g. `@33-04673b (Workspace)`) but the Explorer says `NO FOLDER OPENED`, and it never recovers in place. Switching to another tab and back (an iframe remount = a second boot) shows the folder within ~1.2 s.
>
> Root cause is inside VS Code web (code-server 4.136.2 / VS Code 1.136.1, verified in the bundled source): `WorkspaceConfiguration.initialize` boots from a server-side *cached* configuration first (`~/.rk/code-server-profile/User/caches/CachedConfigurations/workspaces/<id>/workspace.json`) whenever `needsCaching(configPath)` is true (it is, for `vscode-remote` resources), and loads the real workspace file in the background. On a never-cached workspace the boot proceeds with 0 folders; the background file load lands during workspace-service init, its folder update is lost, but the cache IS written — so the *next* boot works. run-kit's side was correct end to end: the `@rk_win_code_root` seed, the `GET /api/windows/{id}/code-workspace` derivation (`internal/codeworkspace.Ensure`) and the file content were all right, and the file existed 0.1 s before the workbench connected.
>
> Evidence: headless-browser repro against the live daemon — fresh workspace file: `NO FOLDER OPENED` held for the full 40 s poll; same file second time: folder tree at 1.2 s. Extension-host logs confirm: on the broken boot, run-kit's bridge extension (`app/code-bridge/src/extension.ts` `activate()`, which does `if (!folder) return;` on `vscode.workspace.workspaceFolders[0]`) activated and silently exited — no `run-kit Code Bridge` output channel, no host record under `$XDG_STATE_HOME/run-kit/cb/hosts/`. On every good boot the record appears ~0.3–2 s after the extension host launches. Side effect of the bug: that broken boot also has no code bridge (no `rk code exec --tab` target, no run-kit editor actions) until the tile reloads.
>
> It is "sometimes" because it hits exactly once per (tab, code root) workspace file — new window, new worktree, or a changed code root each mean a new file and an empty cache. (A different viewer origin/authority also yields a different VS Code cache id, so the same file can hit it again from another origin.)
>
> **Decision (user chose this approach explicitly).** A **conditional, one-shot rescue reload** of the code iframe, gated on a real signal run-kit already owns: the bridge extension's host record. Signal: the bridge extension writes `hosts/<hostId>.json` (fields `hostId, folder, pid, sock, extVersion, startedAt, tab, server`) ONLY after it saw a workspace folder. So "a live host record exists for (server, tab) with `startedAt` at/after this mount" ⇒ the folder loaded ⇒ do nothing. No such record within the wait window ⇒ the boot failed ⇒ reload the iframe once. The reload must be AVOIDED when the workspace actually loaded correctly — a blind timing-based reload on every first open was rejected. Transport: the backend derives the signal per tick from the filesystem and surfaces it on the window payload over the existing state socket; no client polling. Frontend: `CodeSurface`'s iframe `load`-event seam + mount-generation src ref; bounded wait (~10 s from `load`); on expiry with no matching record, same-origin `contentWindow.location.reload()` exactly ONCE per mount generation, keeping the `?workspace=` URL (never degrade to `?folder=`). This becomes a second sanctioned parent re-navigation alongside the nonce-keyed `followSrc` case — the memory design-decision text must be amended. Pure decision logic in a DOM-free module with colocated vitest tests (the `lib/code-folder-latch.ts` pattern). Gate: the rescue only runs when the bridge extension is installed in code-server (`cmd/rk/doctor.go` `codeBridgeCheck(codeserver.ExtensionsDir(home), ...)` already derives this); when it is not installed, NO rescue runs (one console warning at most). Scope excludes: `onDidChangeWorkspaceFolders` in the extension, pre-warming VS Code's cache dir, peeking into the iframe DOM for the "no folder opened" panel, any upstream report. Tests: Go unit tests for registry→payload derivation; vitest for the rescue decision module; e2e limited to "no reload fires when the stub reports the signal", if feasible. Hydrate targets: `docs/memory/run-kit/ui/lenses-and-layout.md`, `docs/memory/run-kit/code-bridge.md`, `docs/memory/run-kit/api-and-sockets.md`; spec touch `docs/specs/right-panel.md` § The code lens if it enumerates payload fields.
>
> **Open values (record as assumptions if you pick defaults).** Exact wait window (proposed 10 s from iframe `load`). Exact payload field name/shape. Whether the signal compares `startedAt` against the mount time client-side or the backend reports "a record newer than X" — proposed: backend surfaces newest live record's `startedAt` (RFC3339) for the tab; the client compares against its own load timestamp.

## Why

**The pain.** The first open of any new (tab, code root) pair — every new window, every new worktree, every code-root change — lands the user on a code tile that says `NO FOLDER OPENED` and stays there. Nothing in the tile hints that a tab switch would fix it; the user's natural read is "run-kit opened the wrong thing" or "the editor is broken". The same broken boot silently disables the code bridge for that tab (the extension exits before registering a host), so `rk code exec --tab` and the six run-kit editor actions are dead until the tile happens to remount. Because it is exactly-once per workspace file it is also the *most* visible on the paths run-kit is optimised for — `rk riff` spawning a fresh worktree and window is precisely a new file with an empty cache.

**If we do nothing.** The bug is upstream (VS Code's cached-configuration-first boot for `vscode-remote` workspace resources) and no run-kit-side correctness fix exists: our file, our seed, and our derivation are all right and present before the workbench connects. Waiting for an upstream fix leaves every first open broken indefinitely; teaching users "switch tabs and back" is a workaround for a state the product created.

**Why this approach.**
- A **reload gated on a signal we already own** is the only option that (a) recovers in place, (b) never reloads a boot that succeeded, and (c) couples to nothing inside VS Code. The bridge extension's host record is a precise oracle: `activate()` returns before any side effect when `workspaceFolders[0]` is absent, and writes `cb/hosts/<hostId>.json` (with `tab`/`server` when the workspace file carries `rk.tab`/`rk.server`) only once the bridge server is listening — i.e. only after it saw a folder. Its `startedAt` lets us distinguish *this* boot from an earlier one.
- A **blind timing reload on every first open** was rejected by the user: it would double-boot every good first open and is indistinguishable from flakiness.
- **Pre-warming VS Code's cache directory** server-side was rejected: it couples to VS Code-internal cache paths and its workspace-id hashing (which also varies with the viewer origin/authority).
- **Peeking into the iframe DOM** for the "no folder opened" panel was rejected: it couples to VS Code UI text and DOM structure.
- **Subscribing to `onDidChangeWorkspaceFolders`** in the extension is a separate hygiene follow-up; on the broken boot the folder update never reaches the extension host anyway, so it would not produce the signal.
- **Transport is one read-shaped GET at each decision point** (baseline at mount, verdict at wait expiry), derived server-side from the filesystem at request time — Constitution II and IX, Constitution X (a derivable fact is derived server-side, never pushed). Two point-in-time requests per mount generation are not polling (no interval, no loop), so the project anti-pattern "Polling from the client — use the SSE stream" is not engaged; a per-tick payload field was dropped because the state socket's idle cadence (12 s tick + 5 s TTL) cannot observe a record write inside the 10 s window, and a filesystem watcher is disproportionate machinery for a once-per-workspace event.

## What Changes

### 1. Backend — one read-shaped endpoint over the host registry

**New route `GET /api/windows/{windowId}/code-bridge?server=<name>`** (`app/backend/api/codebridge.go`, registered in `router.go` beside the `code-workspace` GET). Read-only (Constitution IX: a read is a GET), derived at request time from the filesystem (Constitution II), never cached. Response:

```json
{"installed": true, "startedAt": "2026-09-10T02:45:39.941Z"}
```

- `installed` — `codeserver.InstalledBridgeVersion(codeserver.ExtensionsDir(home)) != ""`, the exact derivation `codeBridgeCheck` uses in `rk doctor`.
- `startedAt` — the newest `startedAt` among host records under `$XDG_STATE_HOME/run-kit/cb/hosts/` that carry BOTH `tab == windowId` AND `server == <name>` (folder-only hosts never match — `Resolve`'s tab-step rule) and whose `pid` is alive (`kill -0`). Empty string when no such record exists. Missing dir / unresolvable `HostsDir` ⇒ `startedAt: ""` (degrade-to-absent, same posture as `ReadRecords`).
- Validation: `windowId` via `parseWindowID`, `server` via `validate.ValidateServerName` (400 on invalid; an empty server defaults like the `code-workspace` GET). 500 only on an unexpected read error.

**New pure derivation in `app/backend/internal/codebridge/`** (`tabsignal.go` + `tabsignal_test.go`):

```go
// TabStartedAt returns the newest startedAt among records with tab+server
// equal to the key and an alive pid. startedAt is compared as parsed
// time.RFC3339 (unparseable values are skipped, never fatal). Two records for
// one tab (the code root changed — a new workspace file hashes to a new
// hostId while the old host still lives) resolve to the newer.
func TabStartedAt(records []HostRecord, server, tab string, alive func(pid int) bool) string
```

**Liveness for this consumer** is `kill -0` on the record's pid (the existing `pidAlive`, passed in as `alive`) — **NOT** `LiveHosts`: `LiveHosts` runs a `__ping` with a 2 s timeout per record serially and prunes the registry as a side effect; a UI request path must not dial sockets or delete files. A pid-alive record with a `startedAt` newer than the mount baseline is sufficient evidence (only an activation that saw a folder writes a record; the baseline compare below neutralises stale records). The registry stays a discovery hint verified per call; the daemon never prunes. `LiveHosts`/`ReadRecords`/`Resolve` are otherwise untouched.

**Not on the state socket.** The per-tick payload field, hub TTL join and hosts-dir watcher first drafted here were dropped (Clarifications, Session 2026-09-10): the hub's idle cadence (12 s `safetyPollInterval` + 5 s TTL) cannot deliver a record write inside a 10 s window, and a watcher is machinery for a once-per-workspace event. Two point-in-time GETs per mount generation (baseline at mount, decision at wait expiry) are exact, lag-free, and are not polling — there is no interval and no loop.

**Go tests** (`tabsignal_test.go` + `api/codebridge_test.go`): tab/server matching (folder-only records ignored; wrong server ignored), newest-wins across two records for one tab, unparseable `startedAt` skipped, dead-pid records excluded, missing dir → empty; handler: 400 on bad window id / server, `installed` follows the extensions-dir fixture (`writeBridgeFixture` in `internal/codeserver/extension_test.go`), `startedAt` from a fixture registry under a temp `XDG_STATE_HOME`.

### 2. Frontend — the rescue decision module

**New pure module `app/frontend/src/lib/code-boot-rescue.ts`** (+ `code-boot-rescue.test.ts`), DOM-free (the `code-folder-latch.ts` contract). It owns the whole decision; `CodeSurface` only feeds it events and executes its one verb.

```ts
export const CODE_BOOT_RESCUE_WAIT_MS = 10_000; // from the iframe `load` event

export interface RescueState {
  /** startedAt returned by the code-bridge GET issued when this mount
   *  generation adopted its src — the baseline. null ⇒ no record existed
   *  (or the GET failed: treated as no baseline). */
  baseline: string | null;
  /** true once the rescue fired (or was decided against) for this generation. */
  settled: boolean;
}

export function newRescueState(currentStartedAt: string | null): RescueState;

/** The signal test: a record newer than the baseline for this tab. Compares
 *  two server-written RFC 3339 strings — never the browser clock. */
export function bridgeConfirmed(state: RescueState, currentStartedAt: string | null): boolean;

/** The decision at wait expiry. */
export type RescueDecision = "reload" | "none" | "skip-not-installed";
export function decideRescue(args: {
  state: RescueState;
  currentStartedAt: string | null;
  bridgeInstalled: boolean | null; // null = the decision GET failed / not yet answered
  isWorkspaceMount: boolean;       // src is the `?workspace=` form
}): RescueDecision;
```

Rules encoded and unit-tested:
- **Baseline at mount, timer at `load`.** The baseline is the `startedAt` returned by `GET /api/windows/{id}/code-bridge` issued the moment the mount generation adopts its `src` (before the frame could have booted). The wait timer starts at the iframe `load` event. Rationale: the previous boot's record for the same `(server, tab)` may still be pid-alive at remount (same hostId, same file — the new activation overwrites it with a newer `startedAt`), so "a record exists" is not the signal; "a record newer than the one at mount" is.
- **Server clock vs server clock.** `bridgeConfirmed` compares the extension-written `startedAt` against the extension-written baseline — never against `Date.now()` in the browser: a remote viewer (SSH tunnel, phone, desktop shell against a remote host) has no clock relationship to the host.
- **Signal present ⇒ `none`** — at wait expiry the decision GET returns a `startedAt` strictly newer than the baseline.
- **Expiry with no signal, extension installed, `?workspace=` mount ⇒ `reload`** — exactly once per mount generation; `settled` flips so a later tick can never fire a second reload.
- **Extension not installed (`bridgeInstalled === false`) ⇒ `skip-not-installed`**, no reload, one `console.warn` per mount generation ("code bridge extension not installed — first-boot rescue disabled; run `rk code-server install`"). `bridgeInstalled === null` (the decision GET failed or an old backend has no route ⇒ 404) is treated as not-installed for this generation (fail-closed: no blind reload).
- **`?folder=` degrade mounts ⇒ `none`** — a folder-opened host writes no `tab`/`server`, so the signal can never match; the description forbids degrading a rescued frame to `?folder=` and a `?folder=` frame is left alone.
- **Remount resets.** A new mount generation (the `reachable` gate flip, a window switch, the `followSrc` re-navigation) creates a fresh `RescueState` with a fresh baseline and a fresh one-shot budget.

**`CodeSurface` wiring** (`app/frontend/src/components/code-surface.tsx`) + a small fetch hook (`hooks/use-code-boot-rescue.ts`, the `use-code-workspace.ts` pattern): when a mount generation adopts a `?workspace=` `src`, issue `fetchCodeBridge(server, windowId)` (`api/client.ts`, over `deduplicatedFetch`; a non-2xx maps to a typed `{status:"unavailable"}`, never a throw) and store its `startedAt` as the generation's baseline. On the iframe `load` event, if the generation is unsettled, arm `setTimeout(CODE_BOOT_RESCUE_WAIT_MS)`; on expiry issue the second `fetchCodeBridge`, feed both results to `decideRescue`, and on `"reload"` run

```ts
try { iframe.contentWindow?.location.reload(); } catch { /* cross-origin or pre-load — skip */ }
```

— the same try/catch posture as `attach()`/`reportFolder()`; the `src` ref is untouched (the frame keeps its `?workspace=` URL; a `reload()` is not a `src` write, so the mount-generation ref rule is preserved). Exactly two requests per mount generation, never a loop. Cleanup on unmount/generation change clears the timer and drops in-flight results (`alive` flag). The `followSrc` nonce override counts as a new generation for the rescue (a fresh baseline GET is issued when the follow src is adopted).

**Frontend types**: `fetchCodeBridge` + a `CodeBridgeStatus {installed: boolean; startedAt: string}` type in `api/client.ts`. No change to `WindowInfo`, `ViewWindow`, or `CodeServerSignal`.

**vitest** (`code-boot-rescue.test.ts`): signal present ⇒ `none`; timeout ⇒ `reload` exactly once per generation (second call after `settled` ⇒ `none`); older-or-equal `startedAt` is not a signal (stale record at remount); `bridgeInstalled` false/null ⇒ `skip-not-installed`; `?folder=` mount ⇒ `none`; remount (new state) resets the budget. Plus a `code-surface.test.tsx` case with fake timers and a mocked `fetchCodeBridge` proving `contentWindow.location.reload` is called once on expiry when the second GET returns no newer `startedAt`, never when it does, and never when `installed` is false.

### 3. e2e (bounded)

The code-server stub harness (`app/frontend/tests/e2e/_ports.ts` `startCodeStub`) cannot run the real extension. Keep e2e to the negative assertion in `code-surface.spec.ts` (or a sibling): with a fake host record written into the per-run `XDG_STATE_HOME/run-kit/cb/hosts/` for the window under test — `{hostId, folder, pid: process.pid, sock, extVersion, startedAt: <now>, tab: <window id>, server: <E2E tmux server>}`, `startedAt` newer than the mount — the iframe's `load` fires exactly once within the wait window (no reload). If the harness cannot make the GET report `installed: true` (no extension dir in the e2e env), the spec asserts the not-installed posture instead: exactly one `load`, one console warning, no reload. Feasibility is confirmed at plan time; if neither is feasible the vitest coverage stands alone (the description permits this).

### 4. Documentation (hydrate)

- `docs/memory/run-kit/ui/lenses-and-layout.md` § Code Surface: the rescue rule (baseline-at-mount, 10 s from `load`, one reload per generation, installed gate, `?workspace=`-only). § Design Decisions: retitle/amend **"One sanctioned parent re-navigation: the folder-follow"** to enumerate TWO sanctioned re-navigations — the nonce-keyed `followSrc` and the host-record-gated first-boot rescue `reload()` — and update **"Iframe src fixed per mount generation, one nonce-keyed exception"** accordingly; add a DD for the rescue (Decision / Why / Rejected: blind reload, cache pre-warm, DOM peek / Introduced by 260910-74q0).
- `docs/memory/run-kit/code-bridge.md`: the host record's new consumer (the `code-bridge` GET's pid-alive, request-time read; no ping, no prune), `startedAt` as a boot oracle, the two-viewer limitation.
- `docs/memory/run-kit/api-and-sockets.md`: the new `GET /api/windows/{windowId}/code-bridge` route (response shape, validation, degrade-to-absent).
- `docs/specs/right-panel.md` § The code lens does not enumerate payload fields today, so no field row is added; its sentence "a mounted iframe is never re-navigated by the parent — the latch fixes the `src` at MOUNT time only (P3)" is already stale w.r.t. `followSrc` and now has a second exception — hydrate proposes a one-clause amendment (human-curated spec; propose, do not silently rewrite).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Code Surface gains the first-boot rescue rule; § Design Decisions "One sanctioned parent re-navigation" amended to two sanctioned re-navigations (followSrc + rescue reload) and a new rescue DD
- `run-kit/code-bridge`: (modify) host record gains a second consumer — the `code-bridge` GET's pid-alive, request-time read of `cb/hosts/` (no ping, no prune) surfacing `startedAt` per tab as the first-boot oracle
- `run-kit/api-and-sockets`: (modify) the new read-shaped `GET /api/windows/{windowId}/code-bridge` route in § API Layer

## Impact

- **Backend**: `app/backend/internal/codebridge/` (new `tabsignal.go`/`_test.go`), `app/backend/api/codebridge.go` (+ `_test.go`, new handler) and `api/router.go` (one `r.Get` line), `app/backend/internal/codeserver/extension.go` (`InstalledBridgeVersion` reused, no change expected). The SSE hub, `WindowInfo`, and `event: code-server` are untouched.
- **Frontend**: `app/frontend/src/lib/code-boot-rescue.ts` (+ test, new), `hooks/use-code-boot-rescue.ts` (+ test, new), `components/code-surface.tsx` (+ test), `api/client.ts` (`fetchCodeBridge` + type). `SurfaceLayout`/`app.tsx` change only if `server`/`windowId` are not already in reach of `CodeSurface`.
- **e2e**: `app/frontend/tests/e2e/code-surface.spec.ts` (one bounded negative test, intent comment per the constitution's Test Intent Comments rule).
- **One new read-shaped route; no new events, no new verbs, no CLI change.** The `rk code` family, `LiveHosts`, `Resolve`, the extension, and the workspace derivation are untouched.
- **Wire compatibility**: an old backend answers the new GET with 404 → the hook maps it to `{status:"unavailable"}` → `bridgeInstalled === null` → no rescue ever fires (fail-closed). An old frontend never calls the route.
- **Runtime cost**: two requests per code-tile mount generation, each one `ReadDir` + N `kill -0` (N = live bridge hosts, typically single digits) + one `filepath.Glob` on the extensions dir. Nothing on the hub tick; no sockets dialed.
- **Known limitations (documented)**: (1) extension not installed ⇒ no rescue (by design). (2) Bridge disabled via the VS Code setting `rk.bridge.enabled=false` is undetectable without reading VS Code settings files (rejected coupling) ⇒ one rescue reload per mount in that configuration. (3) Two viewers opening the same fresh tab within the wait window: if the second boot succeeds (the first warmed the cache), its record confirms the first viewer's still-broken frame too — that viewer must remount by hand. (4) A user who hits the bug still sees `NO FOLDER OPENED` for up to the wait window before the rescue lands.

## Open Questions

- None outstanding. (The delivery-latency question — watcher vs wider wait — was resolved 2026-09-10 by moving the signal off the state socket onto a decision-point GET; see Clarifications.)

## Clarifications

### Session 2026-09-10

| # | Action | Detail |
|---|--------|--------|
| 1 | Changed | "One GET at the decision point" — the frontend issues `GET /api/windows/{windowId}/code-bridge` once at mount (baseline) and once at the 10 s mark (verdict); the per-tick payload field, hub TTL join and `fsnotify` watcher are dropped; the wait stays 10 s. Chosen over the watcher (hub machinery for a once-per-workspace event) and the ≥ 20 s wait (20 s empty-editor dwell). |
| 3, 4, 7, 8 | Changed | Consequential re-statement of the transport, response shape, read cadence and installed-gate rows under the decision above. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Signal delivery: a single read-shaped `GET /api/windows/{windowId}/code-bridge?server=…` issued at each decision point (baseline at mount, verdict at 10 s after `load`), reading the registry live; no per-tick payload field, no hub TTL join, no `fsnotify` watcher, wait stays 10 s | Clarified — user changed to "one GET at the decision point" (chosen over the watcher and the ≥ 20 s wait: lag-free, no hub machinery, two requests per mount is not polling) | S:95 R:85 A:90 D:90 |
| 2 | Certain | Approach: a conditional one-shot rescue `reload()` of the code iframe gated on the bridge host record; a blind timing-based reload is rejected | User chose it explicitly in the description | S:95 R:60 A:90 D:95 |
| 3 | Certain | Transport: the backend derives the signal from the filesystem at request time behind one new read-shaped GET; the client issues exactly two requests per mount generation (no interval, no loop), so no polling and nothing new on the state socket | Clarified — user changed (supersedes the description's payload-field transport); Constitution II and IX | S:95 R:80 A:95 D:90 |
| 4 | Confident | Response shape: `{"installed": bool, "startedAt": string}` — `startedAt` = newest pid-alive tab-keyed record's RFC 3339 `startedAt` for `(server, windowId)`, `""` when none | Clarified — user changed (route replaces the payload field); the `startedAt` name mirrors the record field; `installed` rides the same response per the user's note | S:95 R:90 A:80 D:70 |
| 5 | Confident | Signal compare is baseline-based: the client captures the GET's `startedAt` when the mount generation adopts its `src` and treats only a strictly newer value as confirmation — server clock vs server clock, never against `Date.now()` | Deviates from the description's "client compares against its own load timestamp": a remote viewer's clock has no relationship to the host's, and the previous boot's record for the same hostId is often still pid-alive at remount, so existence is not the signal | S:55 R:85 A:80 D:60 |
| 6 | Confident | Liveness for this consumer is `kill -0` only (pid-alive), no `__ping`, no registry prune; `LiveHosts` stays the CLI's verb | `LiveHosts` pings each record with a 2 s timeout serially and deletes files — unacceptable on the hub tick; the newer-than-baseline rule already neutralises stale records, so ping adds nothing for this signal | S:50 R:85 A:80 D:60 |
| 7 | Certain | Registry read happens per request inside the GET handler — no TTL cache, no hub join, no per-tick work | Clarified — user changed (the hub-side derivation was dropped with the payload field); Constitution II derive-at-request-time | S:95 R:85 A:90 D:85 |
| 8 | Certain | Extension-installed gate rides the same GET as `installed: bool`, derived with `codeserver.InstalledBridgeVersion(ExtensionsDir(home))` per request | Clarified — user changed ("may ride the same GET response as `installed: bool` instead of the code-server event"); the doctor derivation is reused verbatim | S:95 R:85 A:90 D:85 |
| 9 | Confident | Wait window `CODE_BOOT_RESCUE_WAIT_MS = 10_000`, measured from the iframe `load` event; a named constant | Description proposed 10 s from `load`; good boots confirm in ~1–3 s so 10 s leaves margin without a long broken dwell (contingent on #1) | S:70 R:95 A:70 D:80 |
| 10 | Certain | Rescue applies only to `?workspace=` mounts; `?folder=` degrade frames are never rescued and a rescued frame never degrades to `?folder=` | Description states both; a folder-opened host writes no `tab`/`server`, so the signal cannot exist for it | S:90 R:90 A:90 D:95 |
| 11 | Certain | Exactly one `contentWindow.location.reload()` per mount generation, try/catch posture, `src` ref untouched; a new generation (reachability flip, window switch, `followSrc` adoption) resets the budget and baseline | Description; matches the existing `attach()`/`reportFolder()` posture and the mount-generation rule | S:90 R:85 A:90 D:90 |
| 12 | Confident | A failed or 404 decision GET (`bridgeInstalled === null`) is treated as not installed for that generation — no reload | Fail-closed: the user's core constraint is "never a blind reload"; an old backend without the route must not regress to blind reloads | S:60 R:90 A:85 D:75 |
| 13 | Certain | Decision logic lives in `app/frontend/src/lib/code-boot-rescue.ts` with colocated vitest; `CodeSurface` only feeds events and executes the verb | Description names the `lib/code-folder-latch.ts` pattern; project module contract | S:80 R:95 A:95 D:85 |
| 14 | Confident | Go derivation is a pure function in `internal/codebridge` (`TabStartedAt` over `[]HostRecord`) with unit tests for tab/server matching, newest-wins, unparseable timestamps, dead pids, missing dir | Description's Go test list; keeps the hub join thin | S:60 R:85 A:90 D:80 |
| 15 | Confident | Not-installed posture logs exactly one `console.warn` per mount generation naming `rk code-server install` | Description: "one console warning at most"; mirrors the workspace hook's one-warning-per-key idiom | S:65 R:85 A:80 D:80 |
| 16 | Confident | `rk.bridge.enabled=false` (VS Code setting) is an accepted, documented limitation (one rescue reload per mount) rather than detected by reading VS Code settings files | Reading `User/settings.json` couples to VS Code-internal paths — the same coupling the cache pre-warm was rejected for | S:25 R:75 A:55 D:50 |
| 17 | Confident | e2e is one bounded negative test (fake pid-alive host record in the per-run `XDG_STATE_HOME` ⇒ exactly one `load`, no reload), falling back to the not-installed assertion or vitest-only if the harness cannot surface `bridgeInstalled` | Description: "keep e2e to asserting no reload fires when the stub reports the signal, if feasible"; feasibility confirmed at plan time | S:40 R:90 A:50 D:50 |
| 18 | Certain | Scope excludes `onDidChangeWorkspaceFolders` in the extension, VS Code cache pre-warming, iframe DOM peeking, and any upstream report | Description's explicit exclusions | S:95 R:90 A:95 D:95 |
| 19 | Confident | `docs/specs/right-panel.md` § The code lens gets a proposed one-clause amendment to its "never re-navigated by the parent" sentence (already stale w.r.t. `followSrc`), not a payload-field row | The section enumerates no payload fields; specs are human-curated — hydrate proposes | S:50 R:95 A:80 D:70 |

19 assumptions (11 certain, 8 confident, 0 tentative, 0 unresolved).
