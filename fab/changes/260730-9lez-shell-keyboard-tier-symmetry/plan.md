# Plan: Shell Keyboard-Tier Symmetry

**Change**: 260730-9lez-shell-keyboard-tier-symmetry
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Accelerator Contract

#### R1: Two-tier accelerator rule documented platform-neutrally
The `menu.ts` header comment SHALL state the accelerator contract as a platform-neutral two-tier rule: the **page tier** (unshifted `CmdOrCtrl+<any>`) is NEVER bound by the shell on any platform; the **shell tier** (`Shift+CmdOrCtrl+<any>`) MAY be claimed by shell chrome, sparingly. The guaranteed fall-through promise SHALL narrow from "all unlisted ⇧⌘ combos" to "the unshifted Cmd/Ctrl tier is inviolable; the shifted tier is shell-claimable". Platform carve-outs (macOS Edit roles for clipboard; conventional View/App-menu chrome) SHALL be documented alongside the rule, and the existing un-bind-never-intercept rule SHALL be preserved. The comment SHALL also carry the shifted-digit non-US-layout hardware-verify caveat (Electron resolves accelerators by character, not scancode; AZERTY digits already require Shift).

- **GIVEN** the `menu.ts` header comment
- **WHEN** read by an agent preparing the Windows/Linux build (`260730-ler1`)
- **THEN** the same accelerator table and the same documented contract are valid on every platform, with the macOS-only carve-outs explicitly labeled as quirks outside the cross-platform rule

#### R2: Servers switcher migrates to `Shift+CmdOrCtrl+1–9`
The Servers radio items in `menu.ts` SHALL bind `Shift+CmdOrCtrl+1`…`Shift+CmdOrCtrl+9` (⇧⌘1–9 on macOS today). The old literal `Ctrl+1–9` bindings SHALL be dropped entirely — one accelerator table, no legacy alias. Menu radios remain the mouse path (the accelerator and the menu entry are the same item).

- **GIVEN** the shell with ≥1 registered server
- **WHEN** the menu is built
- **THEN** switcher radio N (N ≤ 9) carries accelerator `Shift+CmdOrCtrl+N` and no `Ctrl+N` literal remains anywhere in `menu.ts`
- **AND** clicking the radio still switches servers (accelerator-only change)

### Desktop Shell: Servers IPC Bridge

#### R3: Preload exposes a `servers` bridge group
`preload.ts` SHALL extend `window.runkitShell` with a `servers` group — `list()` and `switch(id)` — as thin `ipcRenderer.invoke` wrappers on new `servers:list` / `servers:switch` channels, following the existing `__welcome` wrapper pattern.

- **GIVEN** any page loaded in the shell
- **WHEN** it reads `window.runkitShell.servers`
- **THEN** `list` and `switch` invoker functions are present (privilege is enforced in main, not the preload)

#### R4: Main handles `servers:*` with sender-frame gating and switch-path reuse
`main.ts` SHALL register `servers:list` and `servers:switch` handlers. Both SHALL be sender-frame gated to **registered server origins plus the welcome page** (a wider allowlist than `welcome:*`); any other sender gets `{ ok: false, error: "Not allowed" }`. `servers:list` returns `{ ok: true, servers: {id,name,url,active}[] }`. `servers:switch` SHALL structurally validate the payload (string id) before use and SHALL reuse the exact same code path as the menu radio callback (set active via the store, `loadURL`, rebuild menu); an unknown id returns an error result without navigating.

- **GIVEN** a page loaded from a registered rk server origin
- **WHEN** it invokes `servers:switch` with a valid registered id
- **THEN** the store's active server updates, the window loads that server's URL, and the menu rebuilds — identical to clicking the menu radio
- **GIVEN** a sender outside the allowlist (any non-registered origin)
- **WHEN** it invokes either channel
- **THEN** it receives `{ ok: false, error: "Not allowed" }` and no state changes

#### R5: Electron-free list projection in the store
`servers.ts` SHALL gain a read helper projecting a `ServerList` to the `{id,name,url,active}[]` IPC shape, with `active` derived via `resolveActiveServer` (so a dangling `activeId` marks the same first-server fallback startup would load). The helper SHALL be covered by `node:test` cases in `servers.test.ts`; store write logic is unchanged.

- **GIVEN** a list whose `activeId` dangles (points at no entry)
- **WHEN** the projection runs
- **THEN** the first server is flagged `active: true` and all others `false`
- **GIVEN** an empty list
- **WHEN** the projection runs
- **THEN** it returns `[]`

### Frontend: Shell Bridge Narrowing & Palette

#### R6: `shell.ts` narrows the new bridge surface structurally
`app/frontend/src/lib/shell.ts` SHALL extend its structural narrowing (typed as `unknown`, narrowed by type-guard predicates — no `as` casts) to the `servers` group: `listShellServers(): Promise<ShellServer[] | null>` and `switchShellServer(id): Promise<boolean>`. A plain browser (bridge absent), an older shell (no `servers` group), a malformed response, a rejected invoke, or an `{ ok: false }` result all resolve to `null`/`false` without throwing. `__welcome` is still never leaked. `shell.test.ts` SHALL cover present/absent/malformed shapes of the new surface.

- **GIVEN** a well-formed bridge whose `list()` resolves `{ ok: true, servers: [...] }`
- **WHEN** `listShellServers()` runs
- **THEN** it resolves the typed entries array
- **GIVEN** a plain browser, a bridge without `servers`, or a malformed/rejected result
- **WHEN** either function runs
- **THEN** it resolves `null`/`false` without throwing

#### R7: Command palette registers shell-gated `Server: Switch to "<name>"` commands
The AppShell command palette SHALL register one `Server: Switch to "<name>"` action per shell-registered server (active one indicated), present ONLY inside the desktop shell — outside the shell the commands are absent. Composition follows the pure-builder convention (`lib/palette-shell.ts` + colocated vitest test), with a thin wiring in `app.tsx` (documented per the code-review palette-registration rule). This is the first real `isShell()`-gated consumer. Palette scope v1 is switch-only — Add/Remove Server stay in the native menu + welcome flow.

- **GIVEN** the SPA running inside the shell with registered servers A (active) and B
- **WHEN** the palette opens
- **THEN** it lists `Server: Switch to "A" (current)` and `Server: Switch to "B"`, and selecting B invokes the bridge switch (the shell then loads B's URL)
- **GIVEN** the SPA in a plain browser
- **WHEN** the palette opens
- **THEN** no shell server-switch entries exist

### Non-Goals

- Windows/Linux build targets, packaging, CI — `260730-ler1-desktop-windows-linux-packaging` (depends on this change)
- Palette Add/Remove Server — v1 is switch-only (intake assumption 6)
- Scancode workaround for shifted-digit accelerators on non-US layouts — hardware-verify only (intake assumption 7)
- Legacy `Ctrl+1–9` alias — dropped entirely (intake assumption 3)
- Live refresh of the palette's shell-server list — mount-time snapshot (see Assumptions)

### Design Decisions

#### `servers:*` privilege gate reuses the navigation allowlist
**Decision**: `isServersSender` delegates to the existing `isAllowedNavigation` (welcome `file://` URL + registered server origins + dev-override origin).
**Why**: The intake's allowlist ("registered server origins … and the welcome page") is exactly the set the navigation guard already computes; one authoritative set, no drift.
**Rejected**: A second hand-rolled origin set — duplicates `registeredOrigins()` composition and diverges on the dev-override case.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

#### One discriminated envelope for `servers:list`
**Decision**: `servers:list` returns `{ ok: true, servers: [...] } | { ok: false, error }`; the SPA lib unwraps to the plain array.
**Why**: The gating contract requires an `{ ok: false }` error shape anyway; a single discriminated union matches the existing `PingResult`/`IpcResult` handler pattern, and the SPA-facing API still returns the intake's `{id,name,url,active}[]`.
**Rejected**: Bare-array success + object failure — two unrelated top-level shapes to narrow.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

#### Shared `switchToServer` seam in main
**Decision**: Extract the menu radio callback's body (set active → `loadURL` → rebuild menu) into one function used by both the menu callback and the `servers:switch` handler.
**Why**: The intake mandates the IPC switch "reusing the same code path as the menu radio callback"; a shared function makes divergence structurally impossible.
**Rejected**: Duplicating the three calls in the handler — invites drift when the switch path grows.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

## Tasks

### Phase 1: Desktop shell

- [x] T001 Rewrite the `app/desktop/src/menu.ts` header comment: platform-neutral two-tier `CmdOrCtrl` rule, macOS carve-outs, narrowed fall-through promise, preserved un-bind-never-intercept rule, non-US-layout hardware-verify caveat <!-- R1 -->
- [x] T002 Migrate the Servers radio accelerators in `app/desktop/src/menu.ts` from `Ctrl+${n}` to `Shift+CmdOrCtrl+${n}`; update the inline comment <!-- R2 -->
- [x] T003 [P] Add the `{id,name,url,active}[]` projection helper to `app/desktop/src/servers.ts` + `node:test` cases in `app/desktop/src/servers.test.ts` (active flag, dangling-activeId fallback, empty list) <!-- R5 -->
- [x] T004 Add `servers:list`/`servers:switch` handlers to `app/desktop/src/main.ts`: `isServersSender` gate via `isAllowedNavigation`, string-payload validation, shared `switchToServer` extracted from the menu radio callback <!-- R4 -->
- [x] T005 [P] Expose the `servers` group (`list`, `switch`) in `app/desktop/src/preload.ts`; update its header comment <!-- R3 -->

### Phase 2: Frontend

- [x] T006 Extend `app/frontend/src/lib/shell.ts` with `ShellServer`, guarded `servers`-group narrowing, `listShellServers()`, `switchShellServer()`; add present/absent/malformed cases to `app/frontend/src/lib/shell.test.ts` <!-- R6 -->
- [x] T007 [P] Create the pure builder `app/frontend/src/lib/palette-shell.ts` (`buildShellServerActions`) + `app/frontend/src/lib/palette-shell.test.ts` (label/quoting, active `(current)` marker, empty input → no entries) <!-- R7 -->
- [x] T008 Wire the shell server actions into `app/frontend/src/app.tsx`: `hooks/use-shell-servers.ts` mount-time fetch, `shellServerActions` memo (documented registration, error toast on failed switch), fold into `paletteActions` <!-- R7 -->

### Phase 3: Verification

- [x] T009 Run scoped tests: `app/desktop` compile + `node --test`; frontend `tsc --noEmit` + `just test-frontend`; fix failures <!-- R5 R6 R7 -->

## Execution Order

- T001–T002 (menu.ts) are independent of T003–T005 (bridge) but share no files with them; run first as the contract they all reference
- T003 blocks T004 (main imports the projection helper); T005 is independent
- T006 blocks T007–T008 (both import from `shell.ts`)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `menu.ts` header states the two-tier `CmdOrCtrl` rule platform-neutrally, documents the macOS Edit-role and View/App carve-outs, the narrowed fall-through promise, the un-bind-never-intercept rule, and the non-US-layout verify caveat
- [x] A-002 R2: Servers radios bind `Shift+CmdOrCtrl+1–9`; the menu items are otherwise unchanged
- [x] A-003 R3: `window.runkitShell.servers.list/switch` invokers exist, following the `__welcome` wrapper pattern
- [x] A-004 R4: `servers:list` and `servers:switch` handlers exist, gated to registered origins + welcome, with `switch` sharing one code path with the menu radio callback
- [x] A-005 R5: The store projection helper exists, is electron-free, and has node:test coverage
- [x] A-006 R6: `listShellServers`/`switchShellServer` narrow structurally with no `as` casts, never leak `__welcome`, and `shell.test.ts` covers the new surface's present/absent/malformed shapes
- [x] A-007 R7: Palette shows one quoted `Server: Switch to "<name>"` entry per shell server (active marked), built by `lib/palette-shell.ts`, registration documented in `app.tsx`

### Behavioral Correctness

- [x] A-008 R2: The radio `click` handler is untouched — mouse switching behaves exactly as before the accelerator change
- [x] A-009 R4: A non-allowlisted sender receives `{ ok: false, error: "Not allowed" }` from both channels and no store/window state changes

### Removal Verification

- [x] A-010 R2: No literal `Ctrl+<digit>` accelerator remains in `app/desktop/src/menu.ts` (old bindings dropped, no alias)

### Scenario Coverage

- [x] A-011 R6: shell.test.ts exercises: well-formed list result, absent bridge, missing `servers` group, malformed entry, `{ok:false}` result, rejected invoke
- [x] A-012 R7: Outside the shell the palette carries zero shell server-switch entries (builder yields `[]` for empty input; hook resolves `[]` without the bridge)

### Edge Cases & Error Handling

- [x] A-013 R4: `servers:switch` with an unknown id returns an error result and does not navigate; a non-string payload returns an invalid-request error
- [x] A-014 R5: Projection marks the first server active when `activeId` dangles; empty list projects to `[]`

### Code Quality

- [x] A-015 Pattern consistency: New code follows naming and structural patterns of surrounding code (guard predicates, pure builders, thin invoke wrappers, doc-comment style)
- [x] A-016 No unnecessary duplication: `isAllowedNavigation`, `resolveActiveServer`, and the single `switchToServer` seam are reused; no parallel origin set or switch path
- [x] A-017 Type narrowing over assertions: no `as` casts introduced in `shell.ts`, `servers.ts`, or `main.ts` payload handling
- [x] A-018 Tests included: node:test for the store helper, vitest for `shell.ts` and the palette builder

### Security

- [x] A-019 R4: IPC payloads are structurally validated in main before use, and sender-frame gating is enforced in main (never the preload) on both `servers:*` channels

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Accelerator behavior (⇧⌘1–9, incl. non-US layouts) is a hardware-verify item, not CI-testable — recorded in the `menu.ts` header caveat; the memory verify list is extended at hydrate

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The one thing it removed (the literal `Ctrl+1–9` accelerator expression in `menu.ts`) was replaced in place, and the shared `switchToServer` seam absorbed the menu radio callback's inline body rather than leaving a dead duplicate. Two stale *documentation* claims are made redundant but belong to hydrate, not deletion: `docs/memory/run-kit/desktop-shell.md:72` (Servers row still says literal `Ctrl+1`…`Ctrl+9`) and `docs/memory/run-kit/ui-patterns.md:1918` ("no SPA code binds it yet" — `isShell()` now has its first real consumer); both are already declared in the intake's Affected Memory.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `servers:list` returns a discriminated envelope `{ok:true,servers}\|{ok:false,error}`; the SPA lib unwraps to the intake's plain array | Intake shows `list()` → array but mandates an `{ok:false}` error shape; one union matches the existing `PingResult`/`IpcResult` pattern | S:60 R:85 A:85 D:75 |
| 2 | Certain | `servers:*` gate reuses `isAllowedNavigation` (registered origins + welcome + dev-override origin) | Exactly the allowlist the intake names; the navigation guard already computes it — dev-override inclusion mirrors that guard | S:70 R:85 A:90 D:80 |
| 3 | Confident | Palette entries registered in the AppShell mount only (not the board route's palette) | Mirrors the tmux `Server: Switch to <name>` placement (`serverActions` is AppShell-only); minimal surface (Constitution IV) | S:50 R:90 A:80 D:70 |
| 4 | Confident | Shell server list fetched once per palette-host mount, no refresh seam | Add/switch flows reload the page via the shell; only removing a non-active server leaves a stale entry until reload — tolerable v1 | S:55 R:90 A:80 D:70 |
| 5 | Certain | Labels quote the name — `Server: Switch to "<name>"`, active suffixed `(current)`; ids `shell-switch-server-<uuid>` | Intake specifies the quoted label verbatim; `(current)` matches the existing switch-entry vocabulary and quoting distinguishes shell servers from tmux servers | S:75 R:95 A:85 D:80 |
| 6 | Certain | No ⇧⌘N shortcut-hint text on the palette entries in v1 | Intake Open Questions defers it explicitly as a v1 scope decision | S:85 R:95 A:90 D:85 |
| 7 | Confident | No new electron-bound unit tests for `menu.ts`/`main.ts`; testable seams are the electron-free store helper (node:test) + SPA lib/builder (vitest) | The package's test infra is deliberately electron-free; accelerator behavior is a hardware-verify item per the intake | S:65 R:80 A:85 D:75 |
| 8 | Confident | The non-US-layout verify caveat lands in the `menu.ts` header at apply; the memory verify-list extension lands at hydrate | The verification list lives in `docs/memory/run-kit/desktop-shell.md`, which only hydrate writes; the code comment is the apply-stage carrier | S:55 R:90 A:80 D:75 |

8 assumptions (3 certain, 5 confident, 0 tentative).
