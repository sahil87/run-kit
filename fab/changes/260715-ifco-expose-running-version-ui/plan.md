# Plan: Expose Running Version in Web UI

**Change**: 260715-ifco-expose-running-version-ui
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. Frontend-only display change surfacing the running
     daemon version (already in session context as `daemonVersion`) on four
     passive chrome surfaces. No backend, no new routes, no new SSE. -->

### Version Display: Shared display form

#### R1: Frontend `displayVersion` helper mirrors the backend convention
The frontend SHALL provide a pure `displayVersion(version: string): string` helper that prefixes a `v` to a numeric version and leaves the `dev` sentinel (and any already-`v`-prefixed string) bare, mirroring the backend `displayVersion()` (`app/backend/cmd/rk/root.go:16-21`). It SHALL live in the new `lib/palette-version.ts` module and be exported for reuse by the connection-dot title and the Cockpit stamp.

- **GIVEN** a numeric version `"0.6.2"`
- **WHEN** `displayVersion("0.6.2")` is called
- **THEN** it returns `"v0.6.2"`
- **AND** `displayVersion("dev")` returns `"dev"` (no `vdev`)
- **AND** `displayVersion("v0.6.2")` returns `"v0.6.2"` (idempotent on an already-prefixed value)

### Version Display: Command palette entry

#### R2: Pure `buildVersionAction` builder module
A new pure, dependency-free module `app/frontend/src/lib/palette-version.ts` SHALL export `buildVersionAction(version: string | null, onSelect: () => void): PaletteAction[]` following the `palette-update.ts` pattern, with a colocated `palette-version.test.ts`. It SHALL return `[]` when `version` is null and otherwise a single action whose label carries the displayed version.

- **GIVEN** `version` is `null` (no `event: version` seen yet)
- **WHEN** `buildVersionAction(null, onSelect)` is called
- **THEN** it returns `[]` (no placeholder entry)
- **AND GIVEN** `version` is `"0.6.2"`, the returned action has `id: "run-kit-version"` and `label: "run-kit: Version — v0.6.2"`
- **AND GIVEN** `version` is `"dev"`, the label is `"run-kit: Version — dev"`
- **AND** selecting the action invokes the supplied `onSelect`

#### R3: Palette entry gated on non-null version, including `dev`
The version palette entry SHALL be shown whenever `daemonVersion` is non-null — INCLUDING the `dev` sentinel (this is pure display, unlike the update/restart actions that gate `dev` out).

- **GIVEN** the daemon is a `dev` build
- **WHEN** the palette is opened
- **THEN** the `run-kit: Version — dev` entry is present

#### R4: On-select copies the displayed version and toasts
Selecting the version entry SHALL copy the DISPLAYED version string (what-you-see-is-what-you-copy — `v0.6.2` / `dev`) to the clipboard via `lib/clipboard.ts` `copyToClipboard`, then show a confirmation toast (`addToast("Version copied", "info")`) on success and an error toast (`"error"` variant) on failure.

- **GIVEN** the clipboard write succeeds
- **WHEN** the user selects `run-kit: Version — v0.6.2`
- **THEN** `v0.6.2` is written to the clipboard AND an `"info"` toast `Version copied` appears
- **AND GIVEN** the clipboard write fails (both API and fallback)
- **THEN** an `"error"` toast appears

#### R5: Dual-mounted into both palettes
The version palette entry SHALL be mounted into BOTH the AppShell palette (`app.tsx`) and the board route's own palette (`board-page.tsx` `boardRouteActions`), mirroring the update-actions dual-mount convention — so on a phone `/board/$name` (where the top-bar right cluster is hidden below `sm`) the palette is the only version surface.

- **GIVEN** the app renders the AppShell palette on a terminal route
- **WHEN** the palette actions are composed
- **THEN** the version entry is present in `paletteActions`
- **AND GIVEN** the board route renders its own palette
- **THEN** the version entry is present in `boardRouteActions`

### Version Display: `copyToClipboard` success signal

#### R6: `copyToClipboard` returns `Promise<boolean>`
`lib/clipboard.ts` `copyToClipboard` SHALL be extended to return `Promise<boolean>` — `true` on a successful copy (Clipboard API or `execCommand` fallback), `false` on total failure — a backwards-compatible change (existing callers ignore the return value).

- **GIVEN** the Clipboard API write resolves
- **WHEN** `await copyToClipboard(text)` is called
- **THEN** it resolves to `true`
- **AND GIVEN** both the Clipboard API and the `execCommand` fallback fail
- **THEN** it resolves to `false`
- **AND** an existing caller that ignores the return value is unaffected

### Version Display: Connection-dot tooltip

#### R7: Connection dot carries a version-bearing `title`
The top-bar connection status dot (`top-bar.tsx`) SHALL gain a hover `title` attribute reflecting connection state and, when connected and known, the version. The `aria-label` (`Connected`/`Disconnected`) SHALL be unchanged.

- **GIVEN** connected and `daemonVersion` is `"0.6.2"`
- **WHEN** the dot renders
- **THEN** its `title` is `Connected — run-kit v0.6.2` (dev: `Connected — run-kit dev`)
- **AND GIVEN** connected but `daemonVersion` is null
- **THEN** its `title` is `Connected` (no version fragment — never `vundefined`)
- **AND GIVEN** disconnected
- **THEN** its `title` is `Disconnected`

### Version Display: Cockpit stamp

#### R8: Passive BIOS/boot-style version footer on the Cockpit page
`server-list-page.tsx` SHALL render a small passive `run-kit v0.6.2` (dev: `run-kit dev`) footer line at the bottom of the scroll container, after the SERVICES zone — `text-xs text-text-secondary`, no border, no interaction, no hover treatment. It SHALL render nothing while `daemonVersion` is null.

- **GIVEN** `daemonVersion` is `"0.6.2"` on the Cockpit `/`
- **WHEN** the page renders
- **THEN** a `run-kit v0.6.2` footer line appears at the bottom of the scroll container, after SERVICES
- **AND GIVEN** `daemonVersion` is null
- **THEN** no footer line renders (no placeholder)

### Version Display: UpdateChip transition title

#### R9: UpdateChip title/aria show the `v<current> → v<latest>` transition
When a qualifying update is pending, the `UpdateChip` (`top-bar.tsx`) `title` and `aria-label` SHALL show the version transition (both current and latest) instead of only the target. `current` SHALL be sourced from `updateAvailable.current`, exposed through a new `current: string | null` field on `useUpdateNotification()` (derived from `updateAvailable?.current ?? null`). If `current` is null, the chip SHALL fall back to the existing target-only wording. The `updating…` state title/aria are unchanged.

- **GIVEN** an update is pending from `0.6.1` to `0.6.2`
- **WHEN** the chip renders (rest state)
- **THEN** its `title` and `aria-label` are `Update run-kit: v0.6.1 → v0.6.2`
- **AND GIVEN** `current` is somehow null
- **THEN** the chip falls back to `Update run-kit to v0.6.2`
- **AND** the `updating…` state title (`Updating…`) / aria (`Updating run-kit`) are unchanged

### Non-Goals

- No backend changes, no new SSE events, no new endpoints, no polling.
- No new routes, pages, top-bar buttons, or panels (Constitution IV).
- The four rejected alternatives (help-menu `?` icon, logo-click version popup, bottom-bar version stamp, `X-RunKit-Version` HTTP header) stay out of scope.
- No new Playwright spec required — these are chrome-level details best unit-tested. If any spec IS added/modified, its sibling `.spec.md` ships in the same commit (constitution Test Companion Docs).

### Design Decisions

1. **`displayVersion` lives in `lib/palette-version.ts` and is exported**: three surfaces (palette entry, connection-dot title, Cockpit stamp) need the display form. — *Why*: single source of truth for the `v`-prefix/`dev`-bare convention; the palette module is the natural home since it is the new module and dependency-free. — *Rejected*: a standalone `lib/version.ts` module (unnecessary extra file for a 4-line helper the palette builder already needs); duplicating the conditional at each call site (drift risk, magic-string anti-pattern).
2. **Copied string is the displayed form**: what-you-see-is-what-you-copy (`v0.6.2` / `dev`). — *Why*: matches the palette label; least-surprise for bug reports. — *Rejected*: copying the raw `daemonVersion` (`0.6.2` without the `v`) — diverges from the visible label.
3. **`copyToClipboard` returns `Promise<boolean>`**: the current helper swallows total failure (`void`); the palette action needs a success signal to toast confirmation vs. error. — *Why*: backwards-compatible (callers ignoring the value are unaffected); honors "fail soft with an error toast". — *Rejected*: throwing on failure (would force try/catch on the existing void callers).

## Tasks

### Phase 1: Setup

- [x] T001 Extend `app/frontend/src/lib/clipboard.ts` `copyToClipboard` to return `Promise<boolean>` (true on Clipboard-API or execCommand success, false on total failure); update the colocated `clipboard.test.ts` (create if absent) to assert both return paths and that fallback success returns true <!-- R6 -->

### Phase 2: Core Implementation

- [x] T002 [P] Create `app/frontend/src/lib/palette-version.ts` exporting a pure `displayVersion(version: string): string` (v-prefix numeric, bare `dev`, idempotent on `v`-prefix) and `buildVersionAction(version: string | null, onSelect: () => void): PaletteAction[]` (returns `[]` when null; else `[{ id: "run-kit-version", label: `run-kit: Version — ${displayVersion(version)}`, onSelect }]`). Use the same `UpdatePaletteAction`-style local type as `palette-update.ts` (or import `PaletteAction`) — match the neighboring module's export shape <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T003 [P] Create `app/frontend/src/lib/palette-version.test.ts` covering `displayVersion` (numeric → v-prefix, dev → bare, already-prefixed idempotent) and `buildVersionAction` (null → [], numeric label `run-kit: Version — v0.6.2`, dev label `run-kit: Version — dev`, id `run-kit-version`, onSelect wired) <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T004 Add `current: string | null` to the `useUpdateNotification()` return in `app/frontend/src/contexts/session-context.tsx` (derived from `updateAvailable?.current ?? null`); extend the hook's return type annotation <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T005 In `app/frontend/src/components/top-bar.tsx`: read `daemonVersion` from `useUpdateNotification()` in `TopBar`, compute the connection-dot `title` (`Connected — run-kit ${displayVersion(daemonVersion)}` when connected+known, `Connected`/`Disconnected` otherwise) and add it to the dot's inner span (aria-label unchanged); import `displayVersion` from `lib/palette-version` <!-- R7 -->
- [x] T006 In `app/frontend/src/components/top-bar.tsx` `UpdateChip`: read `current` from `useUpdateNotification()`; set the rest-state `title`/`aria-label` to `Update run-kit: v${current} → v${latest}` when `current` is non-null, else fall back to `Update run-kit to v${latest}`; leave the `updating…` title/aria unchanged <!-- R9 -->
- [x] T007 In `app/frontend/src/components/server-list-page.tsx`: add `daemonVersion` to the `useSessionContext()` destructure and render a passive footer `run-kit ${displayVersion(daemonVersion)}` (`text-xs text-text-secondary`, no interaction) inside the scroll container after the SERVICES `</section>`, only when `daemonVersion` is non-null; import `displayVersion` from `lib/palette-version` <!-- R8 -->
- [x] T008 In `app/frontend/src/app.tsx`: add a `versionActions` `useMemo` over `buildVersionAction(daemonVersion, onSelect)` where `onSelect` copies `displayVersion(daemonVersion)` via `copyToClipboard` and toasts `Version copied`/`"info"` on success (boolean true) or an `"error"` toast on false; fold `...versionActions` into `paletteActions` (near the other `run-kit:` update/maintenance blocks); import `buildVersionAction`+`displayVersion` and `copyToClipboard` <!-- R4 --> <!-- R5 -->
- [x] T009 In `app/frontend/src/components/board/board-page.tsx`: build `versionEntries` via `buildVersionAction(daemonVersion, onSelect)` with the same copy+toast `onSelect` (board toast convention: no severity arg on the confirmation? — match neighboring board toast calls; error path uses no-severity toast like the board's `updateEntries`), append `...versionEntries` to the `boardRouteActions` return array and its dependency list; import `buildVersionAction`+`displayVersion` and `copyToClipboard` <!-- R4 --> <!-- R5 -->

### Phase 4: Polish

- [x] T010 Run `just test-frontend` (Vitest) and `cd app/frontend && npx tsc --noEmit`; fix any failures introduced by the change <!-- R1 --> <!-- R2 --> <!-- R6 --> <!-- R9 -->

## Execution Order

- T001 and T002/T003 are independent (`[P]`).
- T002 blocks T005, T007, T008, T009 (they import `displayVersion`/`buildVersionAction`).
- T004 blocks T006 (UpdateChip reads the new `current` field).
- T001 blocks T008, T009 (they consume the `copyToClipboard` boolean).
- T010 runs last (validation gate).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `displayVersion` v-prefixes numeric versions, leaves `dev` bare, and is idempotent on an already-`v`-prefixed string (unit test asserts all three).
- [x] A-002 R2: `buildVersionAction` returns `[]` for null and a single `run-kit-version` action carrying the displayed version in its label otherwise (unit test).
- [x] A-003 R3: The version palette entry appears for a `dev` daemon (non-null gate includes `dev`).
- [x] A-004 R4: Selecting the version entry copies the displayed form and shows an `"info"` confirmation toast on success / `"error"` on failure.
- [x] A-005 R5: The version entry is mounted in BOTH `app.tsx` `paletteActions` and `board-page.tsx` `boardRouteActions`.
- [x] A-006 R6: `copyToClipboard` returns `Promise<boolean>` (true on success, false on total failure); existing callers compile unchanged.
- [x] A-007 R7: The connection dot's `title` reads `Connected — run-kit v<ver>` when connected+known, `Connected`/`Disconnected` otherwise; `aria-label` unchanged.
- [x] A-008 R8: The Cockpit page renders a passive `run-kit v<ver>` footer after SERVICES when `daemonVersion` is non-null, and nothing when null.
- [x] A-009 R9: The UpdateChip rest-state `title`/`aria-label` show `Update run-kit: v<current> → v<latest>` when `current` is known, falling back to target-only when null.

### Behavioral Correctness

- [x] A-010 R7: A null `daemonVersion` yields a dot `title` of exactly `Connected` (no `vundefined` / no trailing `run-kit`).
- [x] A-011 R8: A null `daemonVersion` renders no Cockpit footer element (verified by absence, not a hidden placeholder).
- [x] A-012 R9: The `updating…` chip state's `title` (`Updating…`) and `aria-label` (`Updating run-kit`) are unchanged by this change.

### Scenario Coverage

- [x] A-013 R2: `palette-version.test.ts` exercises the null, numeric, and `dev` label cases and the `onSelect` wiring.
- [x] A-014 R6: `clipboard.test.ts` exercises the Clipboard-API-success, fallback-success, and total-failure return values. *(Review note: met in substance in `terminal-client.test.ts` — the pre-existing home of the `copyToClipboard` describe block — which asserts all three return values plus an execCommand-returns-false case; no separate `clipboard.test.ts` was created.)*

### Edge Cases & Error Handling

- [x] A-015 R4: Clipboard total failure surfaces an `"error"` toast rather than a silent no-op.
- [x] A-016 R3: The `dev` sentinel is shown as-is across every surface (`run-kit dev`, `Connected — run-kit dev`, `run-kit: Version — dev`) — not gated out like the update/restart actions.

### Code Quality

- [x] A-017 Pattern consistency: `palette-version.ts` mirrors `palette-update.ts` (pure, dependency-free, colocated test); the dot-title and Cockpit-stamp reuse the shared `displayVersion` rather than re-implementing the conditional.
- [x] A-018 No unnecessary duplication: the `v`-prefix/`dev`-bare convention lives in exactly one frontend helper (`displayVersion`), reused by all three display surfaces; no magic-string version conditionals inline.
- [x] A-019 Type narrowing over assertions: the change uses `if`/null-coalescing guards (no new `as` casts) for `daemonVersion`/`current` narrowing (code-quality frontend principle).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Checked: the `copyToClipboard` void→boolean widening leaves all three pre-existing callers — `terminal-client.tsx:328`, `status-panel.tsx:270`, and the new palette mounts — valid with no dead branches; the UpdateChip's target-only wording is retained intentionally as the null-`current` fallback per R9, not as dead code.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend `displayVersion` helper (v-prefix numeric / bare dev) lives in `lib/palette-version.ts`, exported, reused by dot-title + Cockpit stamp | Intake gives the backend convention verbatim (root.go:16-21) and says the palette label "mirrors displayVersion"; three surfaces need it → one shared helper avoids the magic-string anti-pattern | S:85 R:90 A:90 D:85 |
| 2 | Certain | Copied string is the displayed form (`v0.6.2` / `dev`), matching the label | Intake assumption #11 (Confident): what-you-see-is-what-you-copy for bug reports | S:70 R:95 A:85 D:80 |
| 3 | Certain | `copyToClipboard` → `Promise<boolean>`; existing `terminal-client.tsx` caller ignores the value | Intake assumption #12 + verified the helper currently returns void and swallows failure | S:80 R:90 A:90 D:80 |
| 4 | Certain | Connection-dot `title` = `Connected — run-kit <disp>` / `Connected` / `Disconnected`; aria-label unchanged | Intake §2 gives the exact strings; dot currently has aria-label only (top-bar.tsx:718-725) | S:90 R:90 A:90 D:90 |
| 5 | Certain | Cockpit stamp = passive `run-kit <disp>` footer inside the scroll container after SERVICES, `text-xs text-text-secondary`, hidden when null | Intake §3 + assumption #14; verified the scroll container closes right after the SERVICES section (server-list-page.tsx:409-410) | S:75 R:95 A:85 D:75 |
| 6 | Certain | UpdateChip transition title `Update run-kit: v<current> → v<latest>`, `current` via new `useUpdateNotification()` field, target-only fallback when null | Intake §4 + assumption #7; verified `updateAvailable: {current, latest}` shape (session-context.tsx:122) and the chip's current title (top-bar.tsx:1958-1959) | S:85 R:90 A:90 D:85 |
| 7 | Certain | Version palette entry dual-mounted (AppShell `paletteActions` + board `boardRouteActions`) like the update actions | Intake assumption #9 + verified both mounts carry the update actions (app.tsx:1724/1941, board-page.tsx:471/583) | S:85 R:90 A:90 D:90 |
| 8 | Certain | Copy feedback via `useToast` — `"info"` confirmation, `"error"` failure; board error path uses no-severity toast per the board's `updateEntries` convention | Intake assumption #8 + verified board toast calls omit the severity arg (board-page.tsx:476,493) while AppShell passes `"error"` | S:80 R:90 A:90 D:85 |
| 9 | Confident | Palette entry gated on non-null `daemonVersion` INCLUDING `dev` (display-only, unlike dev-gated update/restart) | Intake assumption #4/#10 state this explicitly; `buildVersionAction`'s only gate is the null check | S:85 R:90 A:90 D:85 |
| 10 | Confident | No new Playwright spec — Vitest unit/component tests cover the change | Intake assumption #15 + code-quality says e2e SHOULD accompany UI "where possible"; chrome-level title/label details are best unit-tested | S:65 R:90 A:80 D:70 |

10 assumptions (8 certain, 2 confident, 0 tentative).
