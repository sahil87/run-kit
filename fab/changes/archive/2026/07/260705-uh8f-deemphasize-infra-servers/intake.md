# Intake: De-emphasize Infrastructure Tmux Servers

**Change**: 260705-uh8f-deemphasize-infra-servers
**Created**: 2026-07-05

## Origin

Promptless dispatch (`/fab-proceed` → `_intake` Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a synthesized design-conversation description:

> De-emphasize infrastructure tmux servers in the run-kit UI — grey out `rk-daemon` and sort infrastructure servers (`rk-daemon` and `rk-test-*`) to the end of every server list — plus guard the kill (✕) affordance on `rk-daemon`.

The design conversation settled five decisions (de-emphasize-don't-hide; central frontend sort; comparator semantics including `rk-test-*`; shared frontend constant for identification; grey-not-disabled treatment) and confirmed the kill-guard as in scope while leaving its exact mechanism open. All conversation decisions are encoded in `## Assumptions` below. File/line references were re-verified against the working tree during intake; two corrections vs. the conversation's claims are noted inline in `## What Changes` (the server-kill dialog lives in `app.tsx`, not `kill-dialog.tsx`; `board-header.tsx` does not consume the servers array).

## Why

1. **Pain point**: `rk-daemon` is the tmux server hosting the run-kit daemon itself (`ServerSocket = "rk-daemon"`, `app/backend/internal/daemon/daemon.go:20`). It is infrastructure, not a workspace, yet it sorts alphabetically among real work servers in the sidebar Server panel and the SESSIONS tree, reading as a peer workspace. `rk-test-*` servers (test-socket umbrella, `IsTestServerName`, `app/backend/internal/tmux/tmux.go:1342`) have the same problem when present.
2. **Consequence if unfixed**: the operator's real workspaces are visually interleaved with infrastructure noise, and — worse — the `rk-daemon` server tile carries the same kill ✕ as any server. Killing it kills the daemon serving the dashboard the user is looking at, with only the generic "Kill server X and all its sessions?" confirm standing in the way.
3. **Why this approach**: hiding was explicitly rejected — the backend deliberately surfaces every server so the operator sees exactly what `rk reaper` would reap (explicit contract in the comment block at `app/backend/internal/tmux/tmux.go:1332-1341`). Greying + sorting last preserves that contract while making the infra/workspace distinction legible. Sorting centrally in the frontend (not per-surface, not in the backend) keeps `/api/servers` alphabetical ordering intact — an asserted API contract (`app/backend/api/servers_test.go:143`: "servers must be returned, sorted alphabetically") — and gives every UI consumer the same order from one comparator.

## What Changes

### 1. Shared infra-server identification in `app/frontend/src/api/client.ts`

New exported constants/helpers near the `ServerInfo` type (currently `app/frontend/src/api/client.ts:402`):

```ts
export const DAEMON_SERVER = "rk-daemon";
// Mirrors backend IsTestServerName (app/backend/internal/tmux/tmux.go:1342) —
// the one frontend home of the "rk-test-" literal.
const TEST_SERVER_PREFIX = "rk-test-";

export function isInfraServer(name: string): boolean {
  return name === DAEMON_SERVER || name.startsWith(TEST_SERVER_PREFIX);
}

export function compareServers(a: ServerInfo, b: ServerInfo): number {
  const ai = isInfraServer(a.name);
  const bi = isInfraServer(b.name);
  if (ai !== bi) return ai ? 1 : -1;
  // Plain lexicographic (not localeCompare) to mirror the backend's
  // sort.Strings byte order within each class.
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
```

The alternative — a backend `isDaemon` flag on the `serverInfo` payload — was considered and rejected in conversation: it adds API surface for a pure display concern, and the socket name is effectively frozen (changing it orphans deployed daemons).

**Comparator semantics (user-confirmed)**: regular servers first, alphabetical; then infrastructure servers (`rk-daemon` exact match + `rk-test-*` prefix), alphabetical within the class. The user explicitly asked for `rk-test-*` in the comparator now, not as a future generalization.

### 2. Central sort where server data lands — `app/frontend/src/contexts/session-context.tsx`

`ctx.servers` is owned by `session-context.tsx` (`const [servers, setServers] = useState<ServerInfo[]>([])`, line 137). Verified: `listServers()` is called from exactly one place — `fetchServers` (line 242-243) — and `setServers` has exactly one data call site (line 243). Apply the comparator there:

```ts
const data = await listServers();
setServers((Array.isArray(data) ? data : []).sort(compareServers));
```

All consumers inherit the order (verified consumer list):

- **Sidebar Server panel tile grid** — `app/frontend/src/components/sidebar/server-panel.tsx` (`servers.map` at line 138), receives `servers` as a prop from `sidebar/index.tsx` (~line 1045).
- **Sessions tree per-server groups** — `app/frontend/src/components/sidebar/index.tsx` (`visibleServers.map` at line 1091).
- **Cockpit TMUX SERVERS zone** — `app/frontend/src/components/server-list-page.tsx` (`servers.map` at line 279).
- **Command palette `Server: Switch to {name}` entries** — `app/frontend/src/app.tsx` (line 1260) — inherits the order in palette listing.

**Correction to the conversation's consumer list**: `app/frontend/src/components/board/board-header.tsx` does NOT consume `ctx.servers` — it is a per-pane header rendering `entry.server` as a text tag on a `BoardEntry`. No board surface consumes the array's order; nothing to do there.

**Beneficial side effect (verified, intended)**: `server-list-page.tsx:119` uses `servers[0]` as the "first-listed server" target for the "Open in window" service action. With infra-last ordering, a real workspace is preferred over `rk-daemon` — consistent with the change's intent. Other order-dependent reads (`servers.some(...)` route guard at `app.tsx:158`, `realNames` set at `server-list-page.tsx:47`) are order-agnostic.

**No backend changes.** `/api/servers` stays alphabetical (asserted contract); internal consumers (board enumeration) are order-agnostic; display order is a frontend concern.

### 3. Grey (de-emphasized, not disabled) treatment

- **`ServerTile`** (`app/frontend/src/components/sidebar/server-panel.tsx`, name line at 275): the server name currently renders `text-text-primary`; for infra servers drop it to `text-text-secondary` (the "N sess" line at 278 already is secondary). Hover, click, and active-selection treatments stay unchanged — the server remains fully attachable (useful for reading daemon logs) and must not read as a dead/disconnected server.
- **Sessions-tree server-group header** (`app/frontend/src/components/sidebar/index.tsx`, ~lines 1412-1417): verified against the working tree — the header already renders `text-text-secondary` at rest and `text-text-primary font-medium` only when it is the current server. Since active-selection treatment stays unchanged by decision, **no class change is needed in the tree** (see Assumptions #9).
- **Cockpit TMUX SERVERS tiles** (`server-list-page.tsx:279`): apply the same name-de-emphasis as `ServerTile` if that tile renders the name primary (same `isInfraServer` predicate).
- Grey applies **uniformly to all infra servers** (`rk-daemon` and `rk-test-*`) — see Assumptions #7 for the grading of this not-explicitly-confirmed point.

### 4. Kill guard for `rk-daemon`

**Correction to the conversation's claim**: the confirm dialog for killing a *server* is NOT `app/frontend/src/components/sidebar/kill-dialog.tsx` (that dialog handles sessions/windows only). The server-kill confirm is the `killServerTarget` Dialog in `app/frontend/src/app.tsx` (~line 1671: "Kill tmux server?" / "Kill server **{name}** and all its sessions? This cannot be undone."). Both kill entry paths funnel through it:

- Server tile ✕ → `onKillServer` → `setKillServerTarget(name)` (`app.tsx:1370`)
- Command palette `Server: Kill` → `setKillServerTarget(server)` (`app.tsx:1257`)

**Chosen mechanism** (Confident — see Assumptions #6): keep the ✕ on the `rk-daemon` tile, and when `killServerTarget === DAEMON_SERVER` add an explicit warning to the dialog copy, e.g.:

> **rk-daemon hosts the run-kit daemon serving this dashboard — killing it takes the dashboard down.**

Rationale: the dialog is the single choke point for both kill paths; hiding the tile ✕ would leave the palette path unguarded and would remove a legitimate capability (an operator may intentionally kill/restart the daemon server). This also parallels the change's own "de-emphasize, don't hide" principle.

### 5. Tests

- **Comparator/predicate unit tests** in `app/frontend/src/api/client.test.ts` (file exists, colocated): `isInfraServer` (exact `rk-daemon`, `rk-test-` prefix, near-misses like `rk-daemon2`/`rktest`), `compareServers` (regular-before-infra, alphabetical within each class, stability against the backend's already-alphabetical input).
- **Component test** in `app/frontend/src/components/sidebar/server-panel.test.tsx`: infra tile name renders `text-text-secondary`; regular tile unchanged; kill ✕ still present on infra tiles.
- **Kill-dialog warning test** (in the app-level or dialog test that covers `killServerTarget`): `rk-daemon` target shows the daemon warning; a regular server does not.
- **Context test** (if session-context has one): servers from `listServers` land sorted infra-last.
- **E2E**: no existing spec asserts server-list ordering or tile color (verified: `server-panel-grid.spec.ts`, `multi-server-sidebar.spec.ts`, `sidebar-server-coupling.spec.ts` locate by name/`data-server`, not index). Note the e2e environment's servers are all `rk-test-*` (isolated test socket), so uniform grey + intra-class alphabetical order applies there — relative order among them is unchanged and no color assertions exist. If any `*.spec.ts` is modified, its sibling `*.spec.md` MUST be updated in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) add the infra-server de-emphasis convention — `isInfraServer`/`compareServers` in `client.ts`, single sort choke point at `session-context.tsx` `fetchServers`, grey tile treatment, `rk-daemon` kill-dialog warning.

## Impact

- **Frontend-only**; no Go/backend changes. Files touched: `app/frontend/src/api/client.ts` (+ `client.test.ts`), `app/frontend/src/contexts/session-context.tsx`, `app/frontend/src/components/sidebar/server-panel.tsx` (+ test), `app/frontend/src/components/server-list-page.tsx` (only if its tile name renders primary), `app/frontend/src/app.tsx` (kill-dialog copy).
- Display order changes on four surfaces (Server panel grid, Sessions tree, Cockpit TMUX SERVERS, palette switch entries) whenever infra servers are present; environments with only regular servers see no change.
- `servers[0]`-dependent "Open in window" target on the Cockpit now prefers a real workspace over `rk-daemon` (intended improvement).
- Verification gates per `fab/project/code-quality.md`: `cd app/backend && go test ./...` (should be untouched), `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`.

## Open Questions

None — all decision points were resolved as graded assumptions (no composite fell below 20; nothing required deferral under the promptless-dispatch carve-out).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | De-emphasize, don't hide — every server stays listed on all surfaces | Discussed — user rejected hiding; preserves the operator-visibility contract documented at `tmux.go:1332-1341` (see what `rk reaper` would reap) | S:90 R:85 A:95 D:95 |
| 2 | Certain | Sort centrally in the frontend at the single `setServers` data call site (`session-context.tsx:243`); no backend sort change | Discussed — user chose central frontend sort; `/api/servers` alphabetical order is an asserted API contract (`servers_test.go:143`); single choke point verified in working tree | S:90 R:80 A:95 D:90 |
| 3 | Certain | Comparator: regular servers alphabetical first, then infra (`rk-daemon` exact + `rk-test-*` prefix) alphabetical | Explicit user request, including `rk-test-*` now rather than as future generalization | S:95 R:85 A:90 D:95 |
| 4 | Certain | Identify infra via shared frontend constant + `isInfraServer` helper near `ServerInfo` in `client.ts`; no backend `isDaemon` flag | Discussed — backend flag rejected (API surface for a display concern; socket name effectively frozen) | S:85 R:80 A:90 D:90 |
| 5 | Certain | Grey = `text-text-secondary` on the tile name only; hover/click/active-selection unchanged; server remains fully attachable | Discussed — user confirmed de-emphasized-not-disabled with these exact classes | S:90 R:90 A:90 D:90 |
| 6 | Confident | Kill-guard mechanism: keep the ✕, add an explicit rk-daemon warning to the `app.tsx` server-kill dialog (covers both tile-✕ and palette paths); do not hide the ✕ | Mechanism not settled in conversation; the dialog is the single choke point for both kill paths — hiding the tile ✕ would leave the palette path unguarded; pure-UI, easily reversed | S:55 R:85 A:70 D:60 |
| 7 | Confident | Grey treatment applies uniformly to all infra servers (`rk-test-*` too), not `rk-daemon` only | User's explicit ask coupled `rk-test-*` to the comparator; uniform class-level treatment is the natural reading and is a one-predicate reversible choice; greying was only explicitly discussed for rk-daemon | S:45 R:90 A:60 D:55 |
| 8 | Confident | Default-collapsed `rk-daemon` group in the Sessions tree is OUT of scope (note as possible follow-up) | Floated as an optional nice-touch, never confirmed; excluding unconfirmed scope from a promptless intake is the conservative, easily-added-later default (per-server open state already exists via `readServerOpen`, `sidebar/index.tsx:148`) | S:40 R:85 A:60 D:60 |
| 9 | Confident | Sessions-tree server-group header needs no class change | Verified in working tree (`sidebar/index.tsx` ~1412-1417): header already renders `text-text-secondary` at rest, `text-text-primary` only when current — and active-selection treatment stays unchanged per decision #5 | S:60 R:90 A:85 D:70 |
| 10 | Confident | Byte-order lexicographic comparison (`<`/`>`) within classes, not `localeCompare` | Mirrors the backend's `sort.Strings` byte order so the regular-server segment is byte-identical to today's rendering | S:50 R:95 A:85 D:75 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
