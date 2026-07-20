# Plan: De-emphasize Infrastructure Tmux Servers

**Change**: 260705-uh8f-deemphasize-infra-servers
**Intake**: `intake.md`

## Requirements

### Frontend: Infra-server identification (`client.ts`)

#### R1: Shared infra-server predicate and comparator
The frontend SHALL expose a single home for identifying infrastructure tmux servers and for ordering them, colocated near the `ServerInfo` type in `app/frontend/src/api/client.ts`: an exported `DAEMON_SERVER` constant (`"rk-daemon"`), a module-private `TEST_SERVER_PREFIX` constant (`"rk-test-"`) mirroring the backend `IsTestServerName`, an exported `isInfraServer(name: string): boolean` returning true for the exact daemon socket or any `rk-test-` prefixed name, and an exported `compareServers(a, b): number` sorting regular servers before infra servers, alphabetical (byte-order `<`/`>`, not `localeCompare`) within each class.

- **GIVEN** a server name `"rk-daemon"` **WHEN** `isInfraServer` is called **THEN** it returns `true`
- **AND GIVEN** `"rk-test-e2e-123"` **THEN** `isInfraServer` returns `true`
- **AND GIVEN** near-misses `"rk-daemon2"`, `"rktest"`, `"my-rk-daemon"` **THEN** `isInfraServer` returns `false`
- **GIVEN** two arrays `[{name:"rk-daemon"},{name:"work"},{name:"default"}]` sorted with `compareServers` **WHEN** compared **THEN** the result is `["default","work","rk-daemon"]` (regular alphabetical first, infra last)
- **AND GIVEN** `["rk-test-b","rk-daemon","rk-test-a"]` **THEN** infra sort alphabetically within their class: `["rk-daemon","rk-test-a","rk-test-b"]`

### Frontend: Central sort choke point (`session-context.tsx`)

#### R2: Sort server data once at the single ingestion point
The `fetchServers` callback in `app/frontend/src/contexts/session-context.tsx` SHALL apply `compareServers` to the fetched server array before calling `setServers`, so every consumer of `ctx.servers` inherits infra-last ordering from one place. No backend sort change SHALL be made; `/api/servers` stays alphabetical.

- **GIVEN** `listServers()` returns a byte-alphabetical array containing `rk-daemon` interleaved with real servers **WHEN** `fetchServers` settles **THEN** `ctx.servers` is ordered regular-first-alphabetical then infra-last
- **AND** the empty/non-array guard is preserved (a non-array response still yields `[]`)

### Frontend: Grey (de-emphasized, not disabled) treatment

#### R3: Infra server names render de-emphasized on tile surfaces
Server *name* text SHALL render `text-text-secondary` (instead of `text-text-primary`) for infra servers on the Sidebar Server-panel tile (`app/frontend/src/components/sidebar/server-panel.tsx`) and the Cockpit TMUX SERVERS tile (`app/frontend/src/components/server-list-page.tsx`). Hover, click, active-selection, and the kill affordance SHALL remain unchanged — the tile stays fully attachable and MUST NOT read as dead/disconnected. Treatment applies uniformly to all infra servers (`rk-daemon` and `rk-test-*`). No class change SHALL be made to the Sessions-tree server-group header (it already renders secondary at rest, primary only when current — and active-selection treatment is unchanged).

- **GIVEN** an infra server tile (`rk-daemon` or `rk-test-*`) **WHEN** the Server panel renders it **THEN** its name span carries `text-text-secondary` and NOT `text-text-primary`
- **AND GIVEN** a regular server tile **THEN** its name span is unchanged (`text-text-primary`)
- **AND** the kill ✕ affordance is still present on infra tiles
- **GIVEN** the Cockpit TMUX SERVERS grid renders an infra tile **THEN** the same name de-emphasis applies

### Frontend: Kill guard for `rk-daemon` (`app.tsx`)

#### R4: Server-kill dialog warns when the target is the daemon socket
The server-kill confirm Dialog in `app/frontend/src/app.tsx` (`killServerTarget`) SHALL, when the target equals `DAEMON_SERVER`, render an explicit warning that killing `rk-daemon` takes down the daemon serving the dashboard. The ✕ affordance and both kill entry paths (tile ✕ and command-palette `Server: Kill`) SHALL remain — the dialog is the single choke point, so no capability is removed. A regular server target SHALL NOT show the warning.

- **GIVEN** `killServerTarget === "rk-daemon"` **WHEN** the dialog renders **THEN** an explicit daemon-warning line appears alongside the standard confirm copy
- **AND GIVEN** `killServerTarget` is any regular server **THEN** no daemon warning is shown
- **AND** the Kill / Cancel actions behave identically for both

### Non-Goals

- Backend changes — `/api/servers` alphabetical ordering is an asserted contract and stays as-is.
- Hiding any server — de-emphasize-don't-hide preserves the operator-visibility contract.
- Default-collapsing the `rk-daemon` sessions group — floated but unconfirmed; deferred as a possible follow-up.
- Disabling / removing the kill ✕ on infra tiles — the guard is a dialog warning, not a capability removal.
- Sessions-tree server-group header restyle — no change needed (see R3 rationale).
- Board surfaces — `board-header.tsx` renders `entry.server` as a text tag, not from `ctx.servers`; nothing to do.

### Design Decisions

1. **Frontend-only identification via a shared constant + predicate**: `DAEMON_SERVER`/`isInfraServer` live near `ServerInfo` in `client.ts` — *Why*: the socket name is effectively frozen and this is a pure display concern — *Rejected*: a backend `isDaemon` flag on the payload (adds API surface for display).
2. **Single sort choke point at `fetchServers`**: apply `compareServers` once where server data lands — *Why*: every consumer inherits the order from one place, keeping `/api/servers` alphabetical — *Rejected*: per-surface sorting (duplication) and backend sorting (breaks the asserted API contract).
3. **Byte-order lexicographic comparison within classes**: `<`/`>` not `localeCompare` — *Why*: mirrors the backend `sort.Strings` byte order so the regular-server segment renders byte-identical to today — *Rejected*: `localeCompare` (would diverge from backend ordering).
4. **Kill guard = dialog warning, not tile-✕ removal**: warn in the `app.tsx` dialog when target is the daemon — *Why*: the dialog is the single choke point for both kill paths; hiding the tile ✕ would leave the palette path unguarded and remove a legitimate capability — *Rejected*: hiding/disabling the ✕.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `DAEMON_SERVER` (exported), `TEST_SERVER_PREFIX` (module-private), `isInfraServer` (exported), and `compareServers` (exported) near the `ServerInfo` type in `app/frontend/src/api/client.ts`, with the backend-mirror comment referencing `IsTestServerName` (tmux.go:1342) <!-- R1 -->
- [x] T002 Apply `compareServers` at the single `setServers` call site in `fetchServers` in `app/frontend/src/contexts/session-context.tsx` (import from `@/api/client`; preserve the array/empty guard) <!-- R2 -->
- [x] T003 [P] De-emphasize the infra server name in the Sidebar Server tile: compute `isInfraServer(name)` in `ServerTile` and render the name span `text-text-secondary` when infra (else `text-text-primary`) in `app/frontend/src/components/sidebar/server-panel.tsx`; leave hover/click/active/kill unchanged <!-- R3 -->
- [x] T004 [P] De-emphasize the infra server name in the Cockpit TMUX SERVERS tile in `app/frontend/src/components/server-list-page.tsx` (same `isInfraServer` predicate, `text-text-secondary` on the name div when infra) <!-- R3 -->
- [x] T005 Add the `rk-daemon` warning to the `killServerTarget` Dialog in `app/frontend/src/app.tsx` (import `DAEMON_SERVER`; render an explicit warning line only when `killServerTarget === DAEMON_SERVER`) <!-- R4 -->

### Phase 2: Tests

- [x] T006 [P] Unit tests in `app/frontend/src/api/client.test.ts` for `isInfraServer` (exact `rk-daemon`, `rk-test-` prefix, near-misses `rk-daemon2`/`rktest`/`my-rk-daemon`) and `compareServers` (regular-before-infra, alphabetical within each class, stability against already-alphabetical input) <!-- R1 -->
- [x] T007 [P] Component tests in `app/frontend/src/components/sidebar/server-panel.test.tsx`: infra tile name renders `text-text-secondary`; regular tile name unchanged; kill ✕ still present on an infra tile <!-- R3 -->
- [x] T008 Context test for the sort choke point: extended `app/frontend/src/contexts/session-context.test.tsx` with a test asserting servers from `listServers` land infra-last (the real-context path, better than the T006 fallback). Required updating the module mock to `importActual` so the real `compareServers` runs, and correcting the pre-existing `server-gone` fixture to re-query an empty list. See `## Assumptions` #9. <!-- R2 -->

### Execution Order

- T001 blocks T002, T003, T004, T005, T006, T007 (they import from `client.ts`).
- T003 and T004 are independent (`[P]`); T006 and T007 are independent (`[P]`) once T001 lands.
- T008 depends on T001/T002.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `client.ts` exports `DAEMON_SERVER`, `isInfraServer`, and `compareServers`; `TEST_SERVER_PREFIX` is module-private; the backend-mirror comment is present
- [x] A-002 R2: `fetchServers` applies `compareServers` at the single `setServers` site; the array/empty guard is preserved; no backend change
- [x] A-003 R3: infra server names render `text-text-secondary` on both the Sidebar Server tile and the Cockpit TMUX SERVERS tile; regular names unchanged; kill ✕ retained; Sessions-tree header unchanged
- [x] A-004 R4: the `app.tsx` server-kill dialog shows the daemon warning when `killServerTarget === DAEMON_SERVER` and not otherwise; both kill paths and the ✕ remain

### Behavioral Correctness

- [x] A-005 R1: `compareServers` orders regular-alphabetical then infra-alphabetical using byte-order comparison (mirrors backend `sort.Strings`); `rk-test-*` sort within the infra class
- [x] A-006 R2: with infra servers present, all four inheriting surfaces (Server panel grid, Sessions tree, Cockpit TMUX SERVERS, palette switch entries) show infra last; regular-only environments see no change

### Edge Cases & Error Handling

- [x] A-007 R1: near-miss names (`rk-daemon2`, `rktest`, `my-rk-daemon`) are NOT treated as infra
- [x] A-008 R3: infra treatment does not alter attachability, hover, active-selection, or the kill affordance — infra tiles must not read as dead/disconnected

### Scenario Coverage

- [x] A-009 R1: `client.test.ts` covers `isInfraServer` and `compareServers` per T006
- [x] A-010 R3: `server-panel.test.tsx` covers infra de-emphasis + kill-✕-present per T007
- [x] A-011 R4: the daemon-warning conditional is covered by test (component-level where a seam exists, else the `DAEMON_SERVER`/`isInfraServer` predicate tests that drive it) — see `## Assumptions` *(review-verified: `app.test.tsx` renders exported helpers/palette patterns, never `AppShell` — no clean seam exists, so the predicate-test fallback path applies as written)*

### Code Quality

- [x] A-012 Pattern consistency: new constants/helpers and JSX follow surrounding naming and structural patterns; type-narrowing over assertions (`cd app/frontend && npx tsc --noEmit` clean)
- [x] A-013 No unnecessary duplication: infra identification/comparison live in one home (`client.ts`); consumers import rather than re-derive; magic strings (`rk-daemon`, `rk-test-`) are named constants
- [x] A-014 Test companion docs: no `*.spec.ts` (Playwright) files are added or modified (unit/component tests only), so no `*.spec.md` update is required by the constitution's Test Companion Docs rule

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Verification gates (code-quality.md): backend untouched (`go test` should stay green), `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just build`.

## Deletion Candidates

None — this change adds new functionality (infra-server identification, central sort, tile de-emphasis, kill-dialog warning) without making existing code redundant. The one candidate examined: the pre-existing whole-module `vi.mock("@/api/client")` in `session-context.test.tsx` was already replaced in this diff by the `importActual` form (T008), leaving nothing behind to delete.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend infra identification via `DAEMON_SERVER` + `isInfraServer` + `compareServers` in `client.ts` near `ServerInfo`; no backend flag | Intake decision #4 (Certain); socket name frozen, pure display concern; backend flag rejected | S:85 R:80 A:90 D:90 |
| 2 | Certain | Sort once at `fetchServers` `setServers` call site; no backend sort | Intake decision #2 (Certain); single choke point verified at session-context.tsx:242-243; `/api/servers` alphabetical is an asserted contract | S:90 R:80 A:95 D:90 |
| 3 | Certain | Comparator: regular-alphabetical first, then infra (`rk-daemon` exact + `rk-test-*` prefix) alphabetical, byte-order `<`/`>` | Intake decisions #3 + #10; mirrors backend `sort.Strings` | S:90 R:85 A:90 D:95 |
| 4 | Certain | Grey = `text-text-secondary` on the tile *name only*, applied to Server panel tile + Cockpit tile; hover/click/active/kill unchanged; Sessions-tree header unchanged | Intake decisions #5 + #9; both tile name spans verified to render `text-text-primary` in working tree (server-panel.tsx:275, server-list-page.tsx:287) | S:85 R:90 A:90 D:90 |
| 5 | Confident | Grey applies uniformly to all infra servers (`rk-test-*` too), not `rk-daemon` only | Intake assumption #7; uniform class-level treatment is the natural reading and a one-predicate reversible choice | S:45 R:90 A:60 D:55 |
| 6 | Confident | Kill guard = daemon warning in the `app.tsx` dialog (covers both kill paths); keep the ✕ | Intake assumption #6; dialog is the single choke point; hiding the tile ✕ would leave the palette path unguarded; pure-UI, reversible | S:55 R:85 A:70 D:60 |
| 7 | Confident | The daemon-warning is added inline in `app.tsx`'s `App` JSX and its detection logic is unit-covered via the `DAEMON_SERVER`/`isInfraServer` predicate tests in `client.test.ts`, rather than adding a full-`App`-render test (no clean seam exists — `app.test.tsx` tests exported helpers/route-guards, not the rendered `App`) | The conditional is a pure `=== DAEMON_SERVER` check whose two arms are trivial JSX; the load-bearing logic is the predicate, already unit-tested; a full-App render harness would be disproportionate. Reversible — a component-level dialog test can be added later if the dialog is extracted | S:50 R:85 A:70 D:55 |
| 8 | Confident | Context-sort test (T008) is implemented via the *real context path* (not the T006 fallback): a new test asserts `ctx.servers` lands infra-last after `fetchServers` | The seam exists cleanly (`result.current.servers`), so the stronger end-to-end wiring assertion is preferable to the fallback | S:60 R:85 A:80 D:70 |
| 9 | Certain | `session-context.test.tsx`'s `vi.mock("@/api/client")` was changed to `importActual` (real module + stubbed `listServers`), and the pre-existing `server-gone` test's re-query was changed to return `[]` | The whole-module mock only exported `listServers`, so importing the new `compareServers` in prod code made it `undefined` in the mock — the sort at ingestion is now real code the test module must not blank out. The `server-gone` fixture relied on the mock returning a *stable array reference* so `setServers` bailed out and no re-attach occurred; the real `[...data].sort()` produces a new reference each fetch (matching production, where `listServers` already returns a fresh array), correctly re-running the attach effect — so the fixture must model the server as genuinely gone (empty re-query). Both are test-infra corrections to match the spec, not impl changes to accommodate tests | S:85 R:80 A:90 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative).
