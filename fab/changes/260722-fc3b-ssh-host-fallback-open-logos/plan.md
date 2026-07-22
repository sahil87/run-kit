# Plan: SSH-Host Fallback + Open-Section Editor Logos

**Change**: 260722-fc3b-ssh-host-fallback-open-logos
**Intake**: `intake.md`

## Requirements

### Backend: `sshUser` on `GET /api/health`

#### R1: Health response carries the derived SSH username
`GET /api/health` MUST include an `sshUser` field derived from `os/user.Current().Username`, resolved once at startup in `NewRouterAndServer` (empty string on lookup failure) and stored on the `Server` struct beside `sshHost`. The field MUST be omitted from the JSON body when empty (mirroring the existing `sshHost` omit-when-empty contract). A `SetSSHUser` test seam MUST exist (mirroring `SetSSHHost`). No new endpoint, no new config (constitution VII/X — derived, not configured).

- **GIVEN** the server process runs as user `sahil`
- **WHEN** a client fetches `GET /api/health`
- **THEN** the JSON body carries `"sshUser": "sahil"` beside `status`/`hostname` (and `sshHost` when configured)

- **GIVEN** `os/user.Current()` fails at startup (empty username stored)
- **WHEN** a client fetches `GET /api/health`
- **THEN** the `sshUser` key is absent from the body (not present as an empty string)

### Frontend: deeplink host resolution chain

#### R2: Effective deeplink host resolution
`lib/open-in-app.ts` MUST expose a pure resolution of the effective deeplink host with this precedence:

1. `RK_SSH_HOST` set → use it **verbatim**, with NO `user@` prefix (alias semantics — the alias carries user/port/key from the client's `~/.ssh/config`).
2. `RK_SSH_HOST` unset AND the client is remote (`!isLocalHostname(location.hostname)`) → derive `${sshUser}@${location.hostname}`, omitting the `user@` prefix when `sshUser` is empty (the bare hostname is used as-given — no reachability guessing; a tunnel hostname produces an editor connect error by design).
3. Local client → no deeplink host (deeplinks are pointless on the host itself).

- **GIVEN** `sshHost = "devbox"`, `sshUser = "sahil"`, `location.hostname = "mymac.tail1234.ts.net"`
- **WHEN** deeplink targets are built
- **THEN** every deeplink URL embeds host `devbox` exactly (no `sahil@` prefix)

- **GIVEN** `sshHost = ""`, `sshUser = "sahil"`, `location.hostname = "mymac.tail1234.ts.net"`
- **WHEN** deeplink targets are built
- **THEN** every deeplink URL embeds host `sahil@mymac.tail1234.ts.net`

- **GIVEN** `sshHost = ""`, `sshUser = ""`, `location.hostname = "mymac.tail1234.ts.net"`
- **WHEN** deeplink targets are built
- **THEN** every deeplink URL embeds host `mymac.tail1234.ts.net` (no `@`)

#### R3: Visibility gate — remote implies deeplinks shown
The deeplink section MUST show whenever the client is remote (not-localhost) — no longer gated on `RK_SSH_HOST` being configured. Local mode is unchanged (host section only, never deeplinks). The zero-targets ⇒ control-hidden rule is unchanged (a local client with an empty registry still renders nothing).

- **GIVEN** a remote client with `sshHost = ""` and an empty host registry
- **WHEN** `buildOpenTargets` runs with a non-empty path
- **THEN** the three deeplink targets are returned (the section is visible)

- **GIVEN** a local client (`localhost`) with `sshHost = "devbox"` and `sshUser = "sahil"`
- **WHEN** `buildOpenTargets` runs
- **THEN** no deeplink targets are returned (local behavior unchanged)

#### R4: `sshUser` carried through OpenContext
`HealthResponse` in `src/api/client.ts` MUST gain an optional `sshUser?: string`, and `hooks/use-open-targets.ts` MUST carry `sshUser` through `OpenContext` from the same single module-cached `getHealth()` fetch — no new requests, same fail-silent degradation (a failed health read yields `sshUser: ""`).

- **GIVEN** `GET /api/health` responds `{status, hostname, sshHost: "devbox", sshUser: "sahil"}`
- **WHEN** `useOpenTargets(true)` resolves
- **THEN** the returned context is `{sshHost: "devbox", sshUser: "sahil", hostApps: [...]}` with exactly one health fetch across all consumers

### Frontend: editor logos in the Open section

#### R5: Id-keyed icon map with kind-based generic fallback
A new small module `src/components/open-app-icons.tsx` MUST export the Open-row icon lookup: monochrome `currentColor` inline SVG glyphs (~14–16px, `aria-hidden`, no new dependency, no image fetches). The id map MUST key BOTH `vscode` (deeplink id) and `code` (wt host id) to the VS Code glyph, and carry brand glyphs for `cursor` and `windsurf`. Unknown ids MUST fall back by `kind`: `editor` → code-brackets glyph, `terminal` → prompt glyph (`>_`), `file-manager` → folder glyph (covering `ghostty_macos`, `terminal_app`, `finder`, and anything unknown). Deeplink targets resolve with implicit kind `editor`. Icons MUST NOT hardcode brand colors — `currentColor` only, so existing hover treatments (accent-green flips) apply for free.

- **GIVEN** a host target with id `code` (wt's VS Code id)
- **WHEN** its Open row renders
- **THEN** the VS Code glyph renders (same glyph as the `vscode` deeplink row)

- **GIVEN** a host target with unknown id `ghostty_macos` and kind `terminal`
- **WHEN** its Open row renders
- **THEN** the generic prompt glyph renders

#### R6: Icons on Open rows in both renderings; palette stays text-only
The leading icon MUST render on the Open rows in BOTH renderings — the split-button's own dropdown rows (`OpenTargetRow`) and the overflow-chevron `Open:` rows (`OpenMenuRows`) in `open-button.tsx`. Command-palette rows MUST stay text-only (the palette has no icon affordance; out of scope).

- **GIVEN** available open targets on a terminal route
- **WHEN** the split-button menu opens (or the control overflows into the chevron menu)
- **THEN** every target row leads with its resolved glyph, inheriting the row's text color

### Tests

#### R7: Test coverage for the changed behavior
Tests MUST cover: the health handler `sshUser` present/absent (Go); the resolution chain (alias verbatim / derived `user@host` / empty user / localhost unchanged) and the remote-gate change (Vitest — e2e cannot fake a non-local `location.hostname`); `sshUser` carried through `useOpenTargets`; icon rendered per row + generic fallback for an unknown id (Vitest). The e2e `open-in-app.spec.ts` MUST be updated only as needed (icon presence in host rows; localhost visibility behavior is unchanged) with its sibling `.spec.md` updated in the same change (constitution — Test Companion Docs).

- **GIVEN** the change is complete
- **WHEN** `just test-backend`, `just test-frontend`, and `just test-e2e open-in-app` run
- **THEN** all pass (modulo the documented pre-existing base failures outside this spec)

### Non-Goals

- Explicit-disable sentinel for the fallback (`RK_SSH_HOST=none`) — deliberately deferred (intake Assumption #4).
- Icons in command-palette rows — the palette has no icon affordance today.
- Reachability probing of the derived host — "shown ⇒ works on tailnets, errors on tunnels" is the accepted trade.

### Design Decisions

#### buildOpenTargets takes hostname + sshUser and derives the branch internally
**Decision**: Change `buildOpenTargets`' options to `{hostname, sshHost, sshUser, hostApps, path}` — it derives `local` via `isLocalHostname(hostname)` and the effective deeplink host via an exported pure `resolveDeeplinkHost({sshHost, sshUser, hostname})` internally.
**Why**: Both call sites (top-bar.tsx, app.tsx) currently duplicate `local: isLocalHostname(window.location.hostname)`; folding the derivation into the lib keeps the whole chain pure and unit-testable in one module and the call sites one-liner-simple.
**Rejected**: Keeping `local` in the signature and adding `deeplinkHost` as a caller-computed input — spreads the resolution chain across three files and invites call-site drift.
*Introduced by*: 260722-fc3b-ssh-host-fallback-open-logos

#### Icon test hook via a data-icon attribute
**Decision**: The resolved glyph SVG carries a `data-icon` attribute naming the resolution (`vscode`, `cursor`, `windsurf`, `editor`, `terminal`, `file-manager`, `app`), used by Vitest/e2e to assert which glyph rendered.
**Why**: Monochrome SVGs are visually indistinguishable to queries; a stable data attribute is the smallest testable seam and is inert at runtime.
**Rejected**: Asserting raw SVG path data (brittle); per-glyph `aria-label` (icons are decorative — `aria-hidden` keeps row accessible names clean).
*Introduced by*: 260722-fc3b-ssh-host-fallback-open-logos

## Tasks

### Phase 1: Backend

- [x] T001 Add `sshUser` to `app/backend/api/router.go` (`Server` field + comment, seed from `os/user.Current()` in `NewRouterAndServer` with empty-on-error, `SetSSHUser` test seam mirroring `SetSSHHost`) and surface it in `app/backend/api/health.go` (omit when empty, mirroring `sshHost`) <!-- R1 -->
- [x] T002 Extend `app/backend/api/health_test.go` with `sshUser` present/absent subtests (via the `SetSSHUser` seam / bare `Server`) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 [P] Add optional `sshUser?: string` to `HealthResponse` in `app/frontend/src/api/client.ts` <!-- R4 -->
- [x] T004 Carry `sshUser` through `OpenContext` in `app/frontend/src/hooks/use-open-targets.ts` (EMPTY const, fail-silent health fallback object, cache composition) <!-- R4 -->
- [x] T005 Implement the resolution chain in `app/frontend/src/lib/open-in-app.ts`: export pure `resolveDeeplinkHost({sshHost, sshUser, hostname})`; change `buildOpenTargets` opts to `{hostname, sshHost, sshUser, hostApps, path}` with the remote-implies-deeplinks gate; carry `appKind` on host targets (from `OpenApp.kind`) for icon resolution <!-- R2, R3 -->
- [x] T006 Update the two `buildOpenTargets` call sites — `app/frontend/src/components/top-bar.tsx` and `app/frontend/src/app.tsx` — to pass `hostname: window.location.hostname` + `sshUser` from the hook context <!-- R2, R3 -->
- [x] T007 [P] Create `app/frontend/src/components/open-app-icons.tsx`: brand glyphs (VS Code, Cursor, Windsurf), kind generics (code-brackets / prompt / folder), neutral fallback; id map (`vscode`+`code` → VS Code, `cursor`, `windsurf`); `OpenTargetIcon({target})` resolving deeplink ids with implicit kind `editor` and host ids via `appId`/`appKind`; `currentColor`, ~14px, `aria-hidden`, `data-icon` <!-- R5 -->
- [x] T008 Render `OpenTargetIcon` as the leading element of both row renderings in `app/frontend/src/components/open-button.tsx` (`OpenTargetRow` + `OpenMenuRows`); palette untouched <!-- R6 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T009 Update `app/frontend/src/lib/open-in-app.test.ts`: `resolveDeeplinkHost` cases (alias verbatim, derived `user@host`, empty user bare host, localhost empty), `buildOpenTargets` new-signature cases including remote-without-sshHost now SHOWING deeplinks and local unchanged, `appKind` carried on host targets <!-- R2, R3, R7 -->
- [x] T010 [P] Update `app/frontend/src/hooks/use-open-targets.test.tsx`: `sshUser` carried through, empty on health failure <!-- R4, R7 -->
- [x] T011 [P] Update `app/frontend/src/components/open-button.test.tsx`: icon per row in both renderings (`data-icon` assertions), `code` host id maps to the VS Code glyph, generic fallback for an unknown id by kind <!-- R5, R6, R7 -->
- [x] T012 Update `app/frontend/tests/e2e/open-in-app.spec.ts` + sibling `open-in-app.spec.md` in the same change: assert icon presence (`data-icon`) in host menu rows; use the real wt host id `code` for the VS Code registry entry; refresh the stale "wt has not shipped --list" comments (wt v0.1.5 shipped it); localhost visibility assertions unchanged <!-- R6, R7 -->

### Phase 4: Verification

- [x] T013 Run `just test-backend`, `just test-frontend`, and `just test-e2e open-in-app`; fix any failures introduced by this change <!-- R7 -->

## Execution Order

- T001 blocks T002; T003 blocks T004; T005 blocks T006 and T009; T007 blocks T008 and T011; T012 depends on T008; T013 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /api/health` carries `sshUser` from `os/user.Current()` (seeded in `NewRouterAndServer`, `SetSSHUser` seam), omitted when empty
- [x] A-002 R2: `resolveDeeplinkHost` implements the precedence chain — alias verbatim (no user prefix), else remote-derived `${sshUser}@${hostname}` with prefix omitted on empty user, else empty for local
- [x] A-003 R3: `buildOpenTargets` shows the deeplink section for any remote client (no `sshHost` gate); local mode and zero-targets hiding unchanged
- [x] A-004 R4: `OpenContext` carries `sshUser` from the same single cached health fetch; `HealthResponse` types it optional
- [x] A-005 R5: `open-app-icons.tsx` exists with the id map (`vscode`+`code`, `cursor`, `windsurf`) and kind-based generic fallback, monochrome `currentColor` SVGs, no new dependency
- [x] A-006 R6: both the split-button menu rows and the overflow `Open:` rows lead with the resolved icon; palette rows remain text-only

### Behavioral Correctness

- [x] A-007 R3: a remote client with `RK_SSH_HOST` unset now sees deeplink targets (previously hidden) — verified by the inverted Vitest case
- [x] A-008 R2: with `RK_SSH_HOST` set, deeplink URLs embed the alias exactly — never `user@alias`

### Scenario Coverage

- [x] A-009 R7: Go tests cover `sshUser` present/absent; Vitest covers the full resolution chain, the gate change, `sshUser` plumbing, and per-row icons + generic fallback
- [x] A-010 R7: e2e `open-in-app.spec.ts` asserts icon presence in host rows and its sibling `.spec.md` is updated in the same change

### Edge Cases & Error Handling

- [x] A-011 R1: `os/user.Current()` failure degrades to an absent `sshUser` key (no error, no empty-string field)
- [x] A-012 R2: empty `sshUser` on a remote client yields the bare hostname (no dangling `@`); tunnel hostnames pass through as-given (no reachability guessing)

### Code Quality

- [x] A-013 Pattern consistency: new code follows surrounding patterns — `SetSSHUser` mirrors `SetSSHHost`, icon module mirrors the inline-SVG chip-glyph convention, `runkit` type-narrowing over casts
- [x] A-014 No unnecessary duplication: the resolution chain lives once in `lib/open-in-app.ts`; both call sites and both row renderings consume shared code; no new dependency added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (derived SSH-host fallback, row icons) without making existing code redundant. The `buildOpenTargets` signature swap (`local` → `hostname`) folded the `isLocalHostname(window.location.hostname)` derivation out of both call sites into the lib, but `isLocalHostname` remains an exported, in-use helper (`resolveDeeplinkHost` + `buildOpenTargets` both call it); nothing was orphaned.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `sshUser` is omit-when-empty on the health JSON (not an always-present empty string) | Mirrors the adjacent `sshHost` contract exactly; frontend already `?? ""`-guards | S:70 R:90 A:90 D:85 |
| 2 | Confident | `buildOpenTargets` signature changes to `{hostname, sshHost, sshUser, hostApps, path}`, deriving `local` + deeplink host internally via exported `resolveDeeplinkHost` | Keeps the whole chain pure/testable in one module; both call sites simplify; internal API with only two consumers | S:60 R:90 A:85 D:75 |
| 3 | Confident | Unknown id AND unknown/missing kind → neutral generic app glyph (distinct `data-icon="app"`) | The kind fallback covers every live registry entry; a neutral glyph keeps any future kindless entry rendering | S:50 R:90 A:70 D:60 |
| 4 | Confident | Glyph identity asserted via a `data-icon` attribute on the SVG | Smallest stable test seam; icons stay `aria-hidden` decorative | S:55 R:95 A:85 D:80 |
| 5 | Confident | e2e registry's VS Code entry switches host id to the real wt id `code` (label unchanged) | Intake verified the live registry uses `code`; exercises the `code`→VS Code glyph map end-to-end within the allowed "icon presence in host rows" scope | S:60 R:90 A:80 D:70 |
| 6 | Certain | Remote-gate + resolution-chain coverage lives in Vitest, not e2e | e2e client is always `localhost` — `location.hostname` cannot be faked against the test server (documented 6d0f limitation, restated in intake) | S:85 R:90 A:90 D:90 |

6 assumptions (1 certain, 5 confident, 0 tentative).
