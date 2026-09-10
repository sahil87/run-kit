# Intake: Code Tile Rescue — Positive Empty-Boot Signal + Bridge Record Ownership

**Change**: 260910-oa3c-code-rescue-positive-signal-record-ownership
**Created**: 2026-09-10

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a diagnosed-and-decided description. No questions were asked; every decision the intake agent would have asked about would be an Unresolved row in `## Assumptions` with Rationale `Deferred — promptless dispatch` (none arose — the description fixes a default for every open value, and each default is adopted as a graded assumption). Change type: `fix` — a regression in the change shipped as PR #904 (`260910-74q0-code-tile-first-boot-rescue-reload`) plus two defects found while diagnosing it.

> **Regression (user report + verified 2026-09-10 evening).** PR #904 added a first-boot rescue to the code tile: a baseline `GET /api/windows/{id}/code-bridge` at `?workspace=` src adoption, a verdict GET 10 s after the iframe `load`, and `contentWindow.location.reload()` when the verdict's newest pid-alive tab-keyed host-record `startedAt` is not strictly newer than the baseline. The user reports: "every time you open Code Server and start reading the code, after around 10 seconds it reloads."
>
> Verified mechanism from the daemon request log and code-server's `remoteagent.log`: the rescue infers "broken boot" from the ABSENCE of a new host record within a fixed window, but a good boot's record lands only when the remote extension host has activated `rk-code-bridge`, which under load takes longer than the window. Measured on this box (16 cores, load avg ~15 while fab pipelines and e2e ran): record 2.4 s after navigation when quiet, 7 s when three workbenches booted concurrently; the user's 22:04:58 boot got its verdict at 22:05:08 and reloaded, with the record landing at 22:05:06 — a margin of about a second that any extra latency erases. Result: false reloads on good boots, exactly the "blind reload" the design was meant to exclude.
>
> Two additional defects found while diagnosing:
> 1. **Bridge record ownership**: `computeHostId` hashes `workspaceFile.fsPath + vscode.env.machineId`; in a persistent browser the machineId is stable, so successive boots of one tab share ONE `cb/hosts/<hostId>.json` and ONE `<hostId>.sock`. VS Code keeps the previous boot's extension host alive ~5 min after its client disconnects; when it exits, its `deactivate()` unconditionally `fs.unlinkSync`s the record and socket — which by then belong to the NEWER boot. This deletes the live host's record (the rescue then sees no record; `rk code exec --tab` also loses its target) 5 minutes after every remount. (Headless-browser repros mask this because each fresh browser context gets a new machineId.)
> 2. **Zero-folder activation is silent**: on the genuinely broken boot (never-cached workspace, `NO FOLDER OPENED`), `activate()` hits `if (!folder) return;` and leaves no trace, so the only available signal was the negative one.
>
> **Decision (fix design).** Make the rescue fire ONLY on a positive signal that the extension itself reports, and fix the ownership bug. Never reload on the absence of a record. (A) Extension: an empty-boot marker `$XDG_STATE_HOME/run-kit/cb/boots/<hostId>.json` written when `activate()` sees zero folders AND a `file:` workspace file whose on-disk `settings` yield a tab identity; `onDidChangeWorkspaceFolders` removes the marker and runs the normal bridge startup if a folder appears later; `deactivate()` unlinks the record/socket/marker only when the on-disk file's `pid === process.pid`. (B) Backend: `BootsDir()`, `BootMarker`, `ReadBootMarkers`, `TabEmptyBootAt`; the GET response gains `emptyBootAt`. (C) Frontend: `decideRescue` reloads iff `emptyBootAt` is strictly newer than its baseline; `startedAt` is no longer a reload trigger, only a positive good-boot confirmation; a bounded re-check (at most one more read 10 s after the first verdict) replaces the fixed single read. (D) Rollout: the marker is produced only by the updated extension; until `rk code-server update` installs it the backend reports `emptyBootAt: ""` and the rescue never fires — fail-closed, which by itself ends the false reloads.
>
> **Open values (record as assumptions if you pick defaults).** Re-check count/interval (proposed: one re-check, 10 s). Whether `TabStartedAt` is generalized or a sibling function is added. Marker directory name (`boots/`) and whether the marker is removed on `deactivate` (proposed yes, pid-guarded; stale markers are also neutralized by the pid-alive filter).

## Why

**The pain.** The shipped rescue turned the code tile into a 10-second trap: on a loaded box every good first boot's host record lands after the verdict read, so the tile reloads while the user is already reading code — losing scroll position, the open editor, and trust in the tile. The failure is worst exactly when run-kit is busiest (fab pipelines, e2e, several workbenches booting concurrently), which is its normal operating state. Underneath it, the ownership bug silently deletes the LIVE host's record and socket ~5 min after every remount in a persistent browser: the rescue then sees no record (another false reload on the next generation), and `rk code exec --tab` / the six run-kit editor actions lose their target for the rest of that boot.

**If we do nothing.** The regression is user-visible on every code-tile open and strictly worse than the bug it fixed (a `NO FOLDER OPENED` first boot once per workspace file vs. a reload on every open). The ownership bug is independent of the rescue and breaks the CLI bridge on its own; it went unnoticed only because headless repros mint a fresh `machineId` per browser context. Reverting PR #904 would restore the once-per-file `NO FOLDER OPENED` boot and leave the ownership bug in place.

**Why this approach.**
- **Positive signal, never absence.** The absence inference is unfixable by tuning: any fixed window loses to a slower extension host, and a wider window is a longer empty-editor dwell on every broken boot. The extension is the one process that KNOWS it activated with zero folders — so it says so, on disk, in the same state dir and with the same atomic-write, 0700/0600, pid-stamped shape the host record already uses. The frontend then reloads only when THIS boot's activation reported zero folders; a slow good boot is simply "no signal yet", never a reload.
- **Identity from the workspace file on disk.** On the broken boot VS Code booted from its empty cached configuration, so `getConfiguration().get('rk.tab')` is unset — but the `.code-workspace` file the daemon wrote (`internal/codeworkspace` — `{"folders":[{"path":<root>}],"settings":{"rk.tab":<@N>,"rk.server":<server>}}`) is on disk at `vscode.workspace.workspaceFile.fsPath`. Reading it through the existing `readTabIdentity` validator gives the marker its tab key without inventing a second identity channel.
- **Ownership by pid, not by path.** The record path is deterministic by design (a reloaded window reuses its socket and record — code-bridge memory § Socket and registry contract); the bug is that `deactivate()` assumes the file it finds is its own. Reading the file and comparing `pid` before unlinking fixes the root cause and keeps the deterministic identity. Re-keying `hostId` per boot was rejected: it would leak a record and socket per reload and break the tab-direct resolution rule that two same-tab records resolve to the newer.
- **Bounded re-check, not a wider window or a loop.** One additional read 10 s after a signal-less first verdict covers the measured 7 s under-load record latency with margin, keeps the broken-boot dwell at 10 s when the marker is already there, and stays at three reads per generation maximum — no interval, no `setInterval`, so the "polling from the client" anti-pattern is still not engaged (Constitution II/IX unchanged: derived at request time, read-shaped GET).
- **Fail-closed rollout.** Because the marker exists only once the updated VSIX is installed and code-server respawned, an updated daemon/frontend against an old extension reports `emptyBootAt: ""` and never reloads. Shipping the daemon alone ends the regression; `rk code-server update` (or `rk update`) then enables the rescue. `rk doctor`'s code-bridge row already surfaces the installed-vs-embedded version mismatch.

## What Changes

### A. Extension — `app/code-bridge/src/extension.ts` (+ a pure module, + tests)

**A1. Empty-boot marker on zero-folder activation.** In `activate()`, after the `rk.bridge.enabled` gate, replace `if (!folder) return;` with the empty-boot branch:

- Condition: `vscode.workspace.workspaceFolders` is empty/undefined AND `vscode.workspace.workspaceFile !== undefined` AND `workspaceFile.scheme === 'file'`.
- Read the `.code-workspace` JSON from disk at `workspaceFile.fsPath` (`fs.readFileSync`, JSON.parse) and derive the identity via the existing validator: `readTabIdentity((key) => settings?.[key])` where `settings` is the file's top-level `settings` object. The parsing lives in a `vscode`-free pure function (proposed `src/workspace-file.ts`: `identityFromWorkspaceFile(contents: string): TabIdentity | null` — missing/non-object `settings`, invalid `rk.tab`/`rk.server` values, or unparseable JSON ⇒ `null`; the extension wraps the disk read so an unreadable file also yields `null`).
- No identity (a user-opened zero-folder window, a `?folder=` degrade frame that lost its folder, an untitled workspace) ⇒ write NOTHING and return — same silent no-side-effect posture as today.
- Identity present ⇒ ensure the private state dir (`ensurePrivateDir(cbDir)`), `fs.mkdirSync(path.join(cbDir, 'boots'), { recursive: true, mode: 0o700 })`, compute `hostId = computeHostId(workspaceFile.fsPath)` (the SAME hash the good-boot record uses for a tab-keyed window, so marker and record for one tab share a key), and `writeAtomic(boots/<hostId>.json, JSON.stringify(marker) + '\n')` (file mode 0600 via the existing `writeAtomic`). Marker shape:

```json
{"hostId":"3fa1c9d2e4b0","workspaceFile":"/home/u/.local/state/run-kit/code-workspaces/default/@7-3fa1c9.code-workspace","tab":"@7","server":"default","pid":41230,"extVersion":"2.25.0","startedAt":"2026-09-10T22:04:59.512Z"}
```

  `startedAt` = `new Date().toISOString()` at marker write; `pid` = `process.pid` (the extension host — the same pid the record carries); `extVersion` = `extensionVersion(context)`. A pure `buildBootMarker({hostId, workspaceFile, identity, pid, extVersion, now})` helper returns this object so its shape is unit-testable.

- Then `context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(...))`: when `workspaceFolders[0]` becomes present, remove the marker (pid-guarded, below) and run the normal bridge startup for that folder exactly as a good boot would (the hygiene follow-up the previous change excluded, folded in). The startup body is factored out of `activate()` into a function taking the folder so both paths call it; the subscription disposes itself after the first successful startup (one bridge per window).

**A2. Ownership guard in `deactivate()`.** Before unlinking `recordPath` (and `socketPath`) — and the marker path — read the record file on disk, parse it, and unlink the record AND socket only when `parsed.pid === process.pid`. A record rewritten by a newer host (different pid) — and its socket, which that host recreated — are left alone. A missing record, unreadable file, or parse error leaves both files alone (never guess ownership). The predicate is a pure `ownsFile(contents: string, pid: number): boolean` (proposed in `src/ownership.ts` or alongside the marker helpers) — `true` iff the JSON parses to an object with a numeric `pid` equal to `pid`. The marker is removed by the same predicate applied to the marker file. `server.close()` runs unconditionally as today.

**A3. Tests (`app/code-bridge/test/*.test.ts`, `node --test`).** Pure pieces only, behind the existing `vscode`-free seams (code-bridge memory § Design Decisions → `vscode`-free bridge core):
- `identityFromWorkspaceFile`: valid file ⇒ `{tab, server}`; no `settings` key ⇒ `null`; `settings` with an invalid tab (`"7"`) or server (`"a b"`) ⇒ `null`; non-JSON contents ⇒ `null`; `settings` not an object ⇒ `null`.
- `ownsFile`: matching pid ⇒ `true`; different pid ⇒ `false`; non-JSON, missing `pid`, non-numeric `pid` ⇒ `false`.
- `buildBootMarker`: exact key set and values (`hostId, workspaceFile, tab, server, pid, extVersion, startedAt`), `startedAt` RFC 3339.

### B. Backend — `app/backend/internal/codebridge`, `app/backend/api/codebridge.go`

**B1. `BootsDir()`** in `state.go` = `<StateDir()>/boots` — the one state-dir resolution rule, mirrored in the extension (code-bridge memory § Design Decisions → One state-dir resolution rule). Test in `state_test.go` beside `TestHostsDir`.

**B2. `BootMarker` + `ReadBootMarkers(dir)`** (new file, proposed `boots.go`):

```go
// BootMarker is one cb/boots/<hostId>.json written by the extension when a
// tab-keyed window activated with zero workspace folders. Field names are the
// extension's JSON contract. StartedAt stays a raw string so a malformed stamp
// never breaks enumeration.
type BootMarker struct {
	HostID        string `json:"hostId"`
	WorkspaceFile string `json:"workspaceFile"`
	Tab           string `json:"tab"`
	Server        string `json:"server"`
	PID           int    `json:"pid"`
	ExtVersion    string `json:"extVersion"`
	StartedAt     string `json:"startedAt"`
}

// ReadBootMarkers enumerates dir's *.json markers sorted by host id. A
// missing dir is an empty list, not an error; unreadable/undecodable files
// are skipped (the ReadRecords posture).
func ReadBootMarkers(dir string) ([]BootMarker, error)
```

  The enumeration loop is shared with `ReadRecords` (a small generic `readJSONDir[T any](dir string) ([]T, error)` or an unexported helper taking a decode callback) — no second copy of the ReadDir/skip/sort loop.

**B3. `TabEmptyBootAt(markers, server, tab, alive)`** — newest pid-alive marker's `startedAt` for the tab, same rules as `TabStartedAt`: tab+server match, kill-0 via the injected `alive` (`PIDAlive` on the request path), RFC 3339 parse, unparseable skipped, newest wins, `""` when none. The parse/compare/newest-wins logic exists ONCE: either `TabStartedAt` is generalized over a small interface (`type tabStamped interface { tabKey() (tab, server string); pid() int; stamp() string }` implemented by both `HostRecord` and `BootMarker`) or both public functions call one unexported `newestTabStamp(...)` — reviewer's call; no duplication.

**B4. Route response.** `GET /api/windows/{windowId}/code-bridge?server=` becomes

```json
{"installed": true, "startedAt": "2026-09-10T22:05:06.113Z", "emptyBootAt": ""}
```

  `startedAt` kept (the newest live host record — the positive good-boot hint); `emptyBootAt` added = `TabEmptyBootAt(ReadBootMarkers(BootsDir()), server, windowID, PIDAlive)`. Same `parseWindowID` / `ValidateServerName` validation (400), same degrade-to-`""` on a missing `boots/` dir or unresolvable state dir, `500` only on an unexpected read error, still derived at request time (Constitution II), still a GET (IX), no `LiveHosts`, no socket dial, no prune.

**B5. Tests.** `TabEmptyBootAt` table tests mirroring `tabsignal_test.go` (newest wins in both orders, dead pid excluded, wrong tab/server never match, unparseable skipped, empty input, real-pid probe). Handler tests in `api/codebridge_test.go`: a fixture marker under `t.Setenv("XDG_STATE_HOME")` (a `writeBootMarker` helper beside `writeHostRecord`) ⇒ `emptyBootAt` equals its stamp; a same-tab marker on another server does not leak; missing `boots/` dir ⇒ `emptyBootAt: ""` while `startedAt` still derives from `hosts/`; dead-pid marker invisible. `state_test.go`: `BootsDir` under the XDG override.

### C. Frontend — `lib/code-boot-rescue.ts`, `components/code-surface.tsx`, `api/client.ts`

**C1. Client shape.** `CodeBridgeResult` `ok` arm gains `emptyBootAt: string`; `fetchCodeBridge` reads `typeof data.emptyBootAt === "string" ? data.emptyBootAt : ""` (an older backend's missing field ⇒ `""`). The `unavailable` arm is unchanged.

**C2. Decision rule** (replaces the absence inference):

```ts
export const CODE_BOOT_RESCUE_WAIT_MS = 10_000;    // load → first verdict
export const CODE_BOOT_RESCUE_RECHECK_MS = 10_000; // first verdict → the one re-check

/** `current` is a positive signal iff it is a parseable, non-empty stamp strictly
 *  newer than `baseline`; an empty baseline ("" — no marker/record existed at
 *  adoption) accepts any parseable current. A `null` baseline (the baseline
 *  read was unavailable) is NOT confirmable — fail closed. Stamp-vs-stamp via
 *  Date.parse, never the browser clock. */
export function newerThanBaseline(baseline: string | null, current: string | null): boolean;

export type RescueDecision = "reload" | "none" | "skip-not-installed";

export function decideRescue(args: {
  baselineEmptyBootAt: string | null;
  emptyBootAt: string | null;
  installed: boolean | null;
  isWorkspaceMount: boolean;
}): RescueDecision;
// order: !isWorkspaceMount ⇒ "none"; installed !== true (or read unavailable) ⇒
// "skip-not-installed"; newerThanBaseline(baselineEmptyBootAt, emptyBootAt) ⇒
// "reload"; otherwise "none".
```

  The host-record `startedAt` never produces `"reload"`. A `startedAt` strictly newer than ITS baseline (`newerThanBaseline(baselineStartedAt, startedAt)`) is the positive good-boot confirmation that settles the generation early (no re-check). `bridgeConfirmed` is renamed/retired into `newerThanBaseline` (one compare helper for both stamps).

**C3. Bounded verdict in `CodeSurface`.** Per `?workspace=` mount generation (the effect's `[reachable, src]` keying; `?folder=` mounts and a missing `fetchBridgeStatus` prop stay inert):
1. **Baseline** at src adoption: one read; capture BOTH `startedAt` and `emptyBootAt` (an `unavailable` result leaves both `null`).
2. **First verdict** at `CODE_BOOT_RESCUE_WAIT_MS` after the first iframe `load`: one read. `installed !== true` / unavailable ⇒ settle with `skip-not-installed` (one `console.warn` per generation naming `rk code-server install`, as today). Newer marker ⇒ ONE `iframe.contentWindow?.location.reload()` (try/catch posture, never a `src` write), settle. Newer record ⇒ settle, no reload. NEITHER newer (the extension host has not reported yet) ⇒ arm exactly ONE re-check timer.
3. **Re-check** at `CODE_BOOT_RESCUE_RECHECK_MS` after the first verdict: one read, same decision, then settle whatever the outcome (no third verdict, no reload on "still nothing").

  Invariants: maximum three status reads per generation (baseline + two verdicts), no interval loop, at most one `reload()`, `src` never rewritten, a settled generation ignores later `load` events, generation reset on a `reachable` flip / window-switch remount / `followSrc` nonce adoption, cleanup on unmount clears pending timers and discards in-flight reads. The "settle before the fetch" ordering that prevents a double verdict from a second `load` during a slow GET is preserved for both verdict reads.

**C4. Tests.**
- `code-boot-rescue.test.ts` rewritten: `newerThanBaseline` (newer ⇒ true; equal/older ⇒ false; `""` baseline + parseable current ⇒ true; `null` baseline ⇒ false; unparseable either side ⇒ false); `decideRescue` (newer marker ⇒ `reload`; equal/older/absent marker ⇒ `none` even with NO host record; not installed / unavailable ⇒ `skip-not-installed`, outranking a newer marker; `?folder=` ⇒ `none`); both constants are 10 000.
- `code-surface.test.tsx` fake-timer cases: nothing newer at 10 s ⇒ a second read at 20 s (three fetcher calls total); newer marker at the second read ⇒ exactly one reload and no further reads; newer record at the first read ⇒ no second read, no reload; nothing at either ⇒ no reload, three reads, settled (a later `load` re-arms nothing); newer marker at the first read ⇒ one reload, no re-check; unavailable ⇒ no reload + one warn; remount ⇒ fresh baselines; `?folder=` / prop absent ⇒ inert. The mocked fetcher's `ok` results carry `emptyBootAt`.
- `client.test.ts`: `fetchCodeBridge` resolves `emptyBootAt` from the response; a response without the field (older backend) resolves `emptyBootAt: ""`.
- e2e `tests/e2e/code-surface.spec.ts`: the existing negative test (fake pid-alive host record ⇒ exactly one `load`) stays valid and its intent comment is updated to the positive-signal rule. Add one positive case: write a fake empty-boot marker `{hostId, workspaceFile, tab: <window id>, server: <E2E server>, pid: process.pid, extVersion, startedAt: <now>}` into `${XDG_STATE_HOME}/run-kit/cb/boots/` AFTER the baseline read (the same `waitForResponse` ordering the negative test uses) and assert the frame loads exactly twice. Feasibility is a plan-time check because `installed` in the e2e env depends on the box's real extensions dir: if the harness cannot make `installed: true` deterministic, the positive arm stays vitest-only. Plan-time option: `scripts/test-e2e.sh` plants a fixture `run-kit.rk-code-bridge-<v>/package.json` under a per-run `XDG_DATA_HOME` forwarded ONLY to the backend's `just dev` line (`codeserver.ExtensionsDir` honors `XDG_DATA_HOME`, as the handler tests rely on), making `installed` deterministic — rejected if it perturbs the dev rig.

### D. Rollout note (documented, not code)

The marker is produced only by the updated extension. After upgrading rk, `rk code-server update` (or `rk update`) installs the embedded VSIX and respawns code-server (the existing `binaryChanged || extensionChanged` respawn rule); until then the backend reports `emptyBootAt: ""` and the rescue never fires — fail-closed, which by itself ends the false reloads the moment the daemon/frontend are updated. `rk doctor`'s existing code-bridge row already shows an installed-vs-embedded version mismatch. Recorded in the code-bridge memory (§ Distribution or the rescue paragraph) — no new CLI surface.

### E. Documentation (hydrate)

- `docs/memory/run-kit/ui/lenses-and-layout.md` § Code Surface → First-boot rescue: the positive-signal rule (marker, not record absence), the bounded re-check (three reads max), the `startedAt` early-settle; § Design Decisions: amend "Two sanctioned parent re-navigations" (rescue leg now marker-gated) and "Two decision-point GETs per mount generation" (now "at most three point-in-time GETs, one bounded re-check"; rejected: absence inference — the measured under-load latency), plus the `rk.bridge.enabled=false` consequence flips from "one reload per mount" to "never fires".
- `docs/memory/run-kit/code-bridge.md`: § Socket and registry contract gains the `boots/<hostId>.json` marker + shape; § Host resolution and liveness — the empty-boot marker as the rescue's positive oracle, `TabEmptyBootAt`; the machineId-in-hostId consequence (successive boots of one tab share one record/socket; VS Code keeps the old extension host alive ~5 min) and the pid-guarded `deactivate()`; the `onDidChangeWorkspaceFolders` late-folder path; the identity-from-workspace-file-on-disk read; § Requirements "Deterministic host identity and clean lifecycle" — "deactivation MUST remove both" becomes "MUST remove only files whose `pid` is its own"; "a window with no workspace folder MUST produce no side effects" becomes "… writes only the empty-boot marker, and only when the workspace file yields a tab identity". The two "documented limitations" sentence is revised (the `rk.bridge.enabled=false` limitation is now fail-closed).
- `docs/memory/run-kit/api-and-sockets.md` § API Layer route row and § Frontend API Client `fetchCodeBridge` row: `emptyBootAt`, the older-backend default, "at most three reads per generation".
- `docs/specs/right-panel.md` § The code lens: propose only (the rescue clause, if hydrate finds one to amend) — specs are human-curated.

### Non-goals

- Changing the code-server reachability probe (500 ms TCP dial, 5 s TTL) — a separate suspicion that reachability flaps under load remount the tile; not verified, not in scope.
- Pre-warming VS Code's cache, DOM peeking, upstream report — unchanged exclusions.
- Removing `startedAt` from the response (kept as the positive good-boot hint).
- Re-keying `hostId` per boot (breaks the deterministic identity and the two-records-resolve-to-newer rule).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Code Surface → First-boot rescue rule → positive-signal (marker) rule with the bounded re-check and `startedAt` early-settle; § Design Decisions — the two rescue entries amended
- `run-kit/code-bridge`: (modify) `boots/` marker dir + `BootMarker` shape, `TabEmptyBootAt` as the rescue oracle, the machineId-in-hostId shared-record consequence, the pid-guarded `deactivate()`, the `onDidChangeWorkspaceFolders` late-folder startup, the identity-from-workspace-file read, the lifecycle Requirement text, the rollout note
- `run-kit/api-and-sockets`: (modify) route row + `fetchCodeBridge` client row gain `emptyBootAt`

## Impact

**Code areas**
- `app/code-bridge/src/extension.ts` (empty-boot branch, factored startup, `onDidChangeWorkspaceFolders`, guarded `deactivate()`), new pure module(s) for workspace-file identity / ownership / marker shape, `app/code-bridge/test/*.test.ts`. The VSIX is rebuilt by `scripts/build.sh` / the release workflow as today; no `package.json` contribution changes.
- `app/backend/internal/codebridge/{state.go, boots.go (new), tabsignal.go, record.go}` + tests; `app/backend/api/codebridge.go` + `codebridge_test.go`.
- `app/frontend/src/lib/code-boot-rescue.ts` + test; `src/components/code-surface.tsx` + test; `src/api/client.ts` + test; `tests/e2e/code-surface.spec.ts` (+ possibly `scripts/test-e2e.sh` for the deterministic-`installed` option).

**APIs**: `GET /api/windows/{windowId}/code-bridge` response gains `emptyBootAt` (additive; older frontends ignore it, older backends are handled by the client default). No new routes, no new verbs, no state socket changes.

**State on disk**: one new bounded directory `$XDG_STATE_HOME/run-kit/cb/boots/` (0700, files 0600, one marker per tab-keyed hostId, pid-stamped so the pid-alive filter neutralizes stale ones; removed pid-guarded on deactivate or when a folder appears late). Not a state store (Constitution II): it records an ephemeral fact the extension host alone observes and is re-derived on every boot.

**Rollout/compat**: daemon + frontend first ⇒ rescue fail-closed (regression ends); `rk code-server update` ⇒ marker-producing extension ⇒ rescue live. Mixed old-extension/new-daemon and new-extension/old-daemon combinations are both safe (the old daemon ignores `boots/`; the old frontend never reloads on a missing `emptyBootAt`… but an OLD frontend against a NEW extension still runs the absence rule — only the frontend update ends the regression).

**Tests**: Go (`go test ./...`), vitest, `node --test` for the extension, Playwright e2e (negative arm retained, positive arm feasibility-gated).

## Open Questions

- e2e positive arm: can the harness make `installed: true` deterministic (per-run `XDG_DATA_HOME` fixture manifest forwarded to the backend only) without perturbing the dev rig? Decided at plan time per the description; falls back to vitest-only.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The rescue reloads ONLY on a positive signal — an empty-boot marker for this tab strictly newer than its baseline; never on the absence of a host record | Description's core decision, verified against the request log / `remoteagent.log` timings | S:95 R:70 A:95 D:95 |
| 2 | Certain | Marker location and shape: `$XDG_STATE_HOME/run-kit/cb/boots/<hostId>.json` = `{hostId, workspaceFile, tab, server, pid, extVersion, startedAt}`, `writeAtomic`, dir 0700 / file 0600, `hostId` from the same `computeHostId(workspaceFile.fsPath)` the record uses | Description proposes `boots/`; mirrors `hosts/` conventions verbatim; shared hostId keys marker and record per tab | S:90 R:85 A:90 D:85 |
| 3 | Certain | Marker written only when zero folders AND a `file:` workspace file AND the on-disk `settings` yield a valid identity via `readTabIdentity`; a zero-folder window without identity writes nothing | Description; the daemon-written `.code-workspace` shape (`folders`/`settings{rk.tab,rk.server}`) is known from `internal/codeworkspace` | S:90 R:90 A:90 D:90 |
| 4 | Confident | The marker is NOT written when `rk.bridge.enabled=false` (the `enabled` gate stays first); that configuration sees no rescue at all (fail-closed) | `package.json` documents `enabled: false` as "activates with no side effects"; the old "one reload per mount" limitation becomes "never fires", consistent with the fail-closed posture | S:45 R:90 A:80 D:70 |
| 5 | Certain | `deactivate()` unlinks record, socket, and marker only when the on-disk file's `pid === process.pid`; missing/unreadable/unparseable ⇒ leave alone; `server.close()` unconditional | Description; fixes the root cause while keeping deterministic hostId | S:95 R:90 A:95 D:95 |
| 6 | Certain | Marker removed on `deactivate` (pid-guarded) and when `onDidChangeWorkspaceFolders` delivers a folder, at which point the normal bridge startup runs for that folder (startup factored out of `activate()`; one bridge per window) | Description folds the hygiene follow-up in; stale markers are also neutralized by the pid-alive filter | S:85 R:85 A:85 D:85 |
| 7 | Certain | Pure pieces (`identityFromWorkspaceFile`, `ownsFile`, `buildBootMarker`) live in `vscode`-free module(s) with `node --test` coverage; the extension wraps the disk reads | Code-bridge memory's `vscode`-free core decision; module names are the implementer's | S:70 R:95 A:90 D:80 |
| 8 | Certain | Backend: `BootsDir()` = `<StateDir()>/boots`, `BootMarker`, `ReadBootMarkers` (absent dir ⇒ empty), `TabEmptyBootAt` with `TabStartedAt`'s rules over `PIDAlive`; the ReadDir loop and the parse/compare/newest-wins logic each exist once | Description; "no duplication" is explicit — interface vs unexported helper is the reviewer's call | S:90 R:90 A:90 D:80 |
| 9 | Certain | Response `{"installed", "startedAt", "emptyBootAt"}` — additive; same validation, degrade-to-`""`, request-time derivation, GET, no `LiveHosts`/dial/prune | Description; Constitution II/IX | S:95 R:90 A:95 D:95 |
| 10 | Certain | `CodeBridgeResult.ok` gains `emptyBootAt: string`; a missing field (older backend) reads `""` | Description | S:95 R:95 A:95 D:95 |
| 11 | Certain | `decideRescue` order: `?folder=` ⇒ `none`; `installed !== true` / unavailable ⇒ `skip-not-installed` (outranks a newer marker); newer marker ⇒ `reload`; else `none`. `startedAt` never triggers a reload | Description | S:95 R:90 A:95 D:90 |
| 12 | Confident | An `""` baseline (read OK, no marker at adoption) accepts any parseable marker as newer; a `null` baseline (baseline read unavailable) is NOT confirmable — no reload | Description says "or the baseline was empty/absent"; treating an unavailable read as reload-permissive would let a still-pid-alive marker from the previous empty boot (≤ 5 min) false-reload — the posture is fail-closed, so `null` is read as unknown, not absent | S:45 R:90 A:80 D:65 |
| 13 | Confident | If one read shows BOTH a newer marker and a newer record (folder arrived late; marker removal and record write raced the read), the good-boot confirmation wins — no reload | A live tab-keyed record proves the folder loaded; reloading a working frame is the regression being fixed | S:45 R:90 A:80 D:70 |
| 14 | Certain | Bounded verdict: first read at `CODE_BOOT_RESCUE_WAIT_MS` (10 s) after `load`; if neither stamp is newer, exactly one re-check at `CODE_BOOT_RESCUE_RECHECK_MS` (10 s) later, then settle; max three reads per generation; no interval; at most one `reload()`; `src` never rewritten; generation reset/cleanup as today | Description proposes one re-check at 10 s; covers the measured 7 s under-load record latency with margin without a longer broken-boot dwell | S:75 R:95 A:80 D:80 |
| 15 | Certain | A newer host record at the FIRST verdict settles the generation early (no re-check); a newer marker at the first verdict reloads immediately (no re-check) | Description: `startedAt` newer is the positive good-boot confirmation "that settles the generation early" | S:75 R:95 A:85 D:85 |
| 16 | Certain | Frontend tests: `code-boot-rescue.test.ts` rewritten for the new table; `code-surface.test.tsx` fake-timer re-check cases; `client.test.ts` new field + older-backend default | Description enumerates them | S:95 R:95 A:95 D:95 |
| 17 | Confident | e2e: the existing negative test stays (intent comment updated); a positive marker-arm test is added only if `installed: true` can be made deterministic in the harness (candidate: per-run `XDG_DATA_HOME` fixture manifest forwarded to the backend only); otherwise vitest-only | Description: "feasibility at plan time, since `installed` in the e2e env depends on the box" | S:60 R:90 A:60 D:60 |
| 18 | Certain | Rollout is documentation only: daemon/frontend update ends the regression (fail-closed, `emptyBootAt: ""`); `rk code-server update` / `rk update` enables the rescue; `rk doctor`'s existing row shows the mismatch — no new CLI surface | Description § D | S:95 R:95 A:95 D:95 |
| 19 | Certain | Non-goals: reachability probe changes, cache pre-warm, DOM peeking, upstream report, removing `startedAt` | Description's explicit exclusions | S:95 R:95 A:95 D:95 |
| 20 | Certain | Memory hydrate targets: `ui/lenses-and-layout` (rescue rule + two DD entries), `code-bridge` (marker, ownership, lifecycle Requirement text, late-folder path, rollout), `api-and-sockets` (route + client rows); `docs/specs/right-panel.md` § The code lens propose-only | Description's hydrate targets; specs are human-curated | S:85 R:95 A:90 D:85 |

20 assumptions (16 certain, 4 confident, 0 tentative, 0 unresolved).
