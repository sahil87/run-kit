# Plan: Raw Accent Report Channel

**Change**: 260814-d4wu-raw-accent-report-channel
**Intake**: `intake.md`

## Requirements

### Desktop Shell: the `accent:set` channel

#### R1: hex-validation helper (electron-free)
`app/desktop/src/hosts.ts` SHALL export `isHostAccentHex(value: string): boolean` accepting exactly the strict `#RGB`/`#RRGGBB`/`#RRGGBBAA` pattern — byte-for-byte the SPA consumer's `HOST_ACCENT_HEX` regex (`app/frontend/src/lib/shell-strip.ts:105`) — so nothing the shell persists can fail the SPA's row-paint gate. It lives in the electron-free store module so `node --test` covers it.

- **GIVEN** inputs `"#8b7ff0"`, `"#fff"`, `"#8b7ff0cc"`
- **WHEN** `isHostAccentHex` runs
- **THEN** all three accept
- **AND** `"javascript:alert(1)"`, `"8b7ff0"`, `"#8b7f"`, `""` all reject

#### R2: `accent:set` IPC handler + preload invoker
`app/desktop/src/preload.ts` SHALL add an `accent` group with `set: (hex) => ipcRenderer.invoke("accent:set", hex)` (the `badge` group shape). `app/desktop/src/main.ts` SHALL register the handler mirroring `badge:set` structurally: `isHostsSender` gate first (`Not allowed`), then payload validation (`typeof hex === "string" && isHostAccentHex(hex)`, else `Invalid request`), then sender resolution via `findViewByWebContentsId` — a resolved view persists via the EXISTING `setHostAccentColor(userDataDir(), entry.hostId, hex)`; a non-view sender (welcome page, late report from a destroyed view) persists nothing and returns `{ ok: true }` (no direct-paint branch — there is nothing to paint). The view registry's `themeColor` cache and the overlay-repaint wiring are NOT touched by this channel.

- **GIVEN** a registered host's SPA invokes `accent.set("#8b7ff0")`
- **WHEN** the handler runs
- **THEN** that host's `hosts.json` entry gets `accentColor: "#8b7ff0"` (short-circuited when unchanged) and no overlay repaint occurs
- **AND** a welcome-page sender changes nothing and still gets `{ ok: true }`
- **AND** a disallowed sender gets `Not allowed`; a non-hex payload gets `Invalid request`

#### R3: raw-accent precedence over the theme-color fallback
`main.ts` SHALL keep an in-memory per-host flag (`rawAccentReported`, the `viewLoadFailed` Map pattern): set by a successful view-resolved `accent:set` persist, cleared where that host's view dies (`destroyHostView` / `destroyAllViews`, alongside the existing `viewLoadFailed` cleanup). The `did-change-theme-color` seam's `setHostAccentColor` call (shipped in #588) becomes conditional on the flag being UNSET for that host — hosts whose view never sent `accent:set` keep the blend persistence (the older-SPA fallback). The flag is not persisted: after a shell restart an early theme-color report may transiently re-persist the blend; the SPA's initial-resolve report overwrites it (self-healing). The overlay-repaint half of the theme-color wiring stays untouched.

- **GIVEN** a host whose view has sent `accent:set "#8b7ff0"`
- **WHEN** a later `did-change-theme-color` fires for that view
- **THEN** the registry cache and overlay behavior run as today but `accentColor` is NOT re-persisted
- **AND** for a host that never reported, the theme-color seam persists exactly as shipped

### Frontend: bridge + reporter

#### R4: accent bridge narrowing + `setShellAccent`
`app/frontend/src/lib/shell.ts` SHALL add a structural `accentBridge()` narrowing of the additive `accent` group and an exported `setShellAccent(hex: string): Promise<boolean>` — the `badgeBridge`/`setShellBadge` pattern exactly: `false` (never throws) in a plain browser, on an older shell without the group, or on rejection/denial.

- **GIVEN** an older shell whose bridge lacks the `accent` group
- **WHEN** `setShellAccent("#8b7ff0")` runs
- **THEN** it resolves `false` without throwing

#### R5: `ShellAccentReporter`
A render-nothing `ShellAccentReporter` component (`app/frontend/src/components/shell-accent-reporter.tsx`) SHALL mirror `ShellBadgeReporter`: read `stripeHex` from `useInstanceAccent()` (already exposed — no context change), report via `setShellAccent` on initial resolve and on change, guard duplicates with a `lastReportedRef`. A `null` `stripeHex` reports nothing (stored value never cleared — the theme-color seam's null-never-clears semantics). Mounted beside `ShellBadgeReporter` in `app/frontend/src/app.tsx` behind the same `isShell()` gate.

- **GIVEN** the SPA resolves its instance accent to `stripeHex "#8b7ff0"`
- **WHEN** the reporter's effect runs
- **THEN** `setShellAccent("#8b7ff0")` fires once, re-renders with the same value fire nothing, and an accent change fires once with the new value
- **AND** a null `stripeHex` fires nothing

#### R6: degradation and self-healing (no migration)
Older SPA + new shell: no reporter → the theme-color fallback persists blends, exactly as shipped. New SPA + older shell: `setShellAccent` resolves `false` harmlessly. Already-persisted 35% blends are overwritten on the first visit by a new pair — no migration code, no render-time boosting, and `shellHostMenuRows`/edge-bar rendering are untouched.

- **GIVEN** a hosts.json carrying a #588-era blended `accentColor`
- **WHEN** that host is next visited under new SPA + new shell
- **THEN** the initial-resolve report overwrites the blend with `stripeHex`, with no other intervention

### Non-Goals

- Render-time OKLCH chroma/lightness boost (option 2) — explicitly rejected as a symptom patch
- Clearing `accentColor` on a null accent — no unset path exists or is added
- Overlay/titlebar tint changes — the window chrome keeps the 35% blend by design
- Menu-row rendering changes — #588's validation and paint stay as shipped

### Design Decisions

#### Precedence flag is in-memory, not persisted
**Decision**: `rawAccentReported` is a main-side session Map (the `viewLoadFailed` pattern), cleared with the view, never written to disk.
**Why**: The only failure window is post-restart (a theme-color report landing before the SPA's initial-resolve accent report), and the very next report self-heals it; persisting the flag would add store schema for a transient race.
**Rejected**: A persisted `accentSource: "raw" | "blend"` field — schema cost and a migration story for a window measured in seconds.
*Introduced by*: 260814-d4wu-raw-accent-report-channel

#### Main-side validation mirrors the SPA consumer's exact regex
**Decision**: `isHostAccentHex` duplicates `HOST_ACCENT_HEX` (`#RGB`/`#RRGGBB`/`#RRGGBBAA`) byte-for-byte in the desktop package.
**Why**: The two packages share no code; mirroring the consumer's gate guarantees nothing persisted ever fails row paint.
**Rejected**: A looser server-side pattern (e.g. any `#` + hex) — would persist values the SPA then silently drops.
*Introduced by*: 260814-d4wu-raw-accent-report-channel

## Tasks

### Phase 1: Desktop shell

- [x] T001 Add `isHostAccentHex` to `app/desktop/src/hosts.ts` and cover the accept/reject matrix in `app/desktop/src/hosts.test.ts` <!-- R1 -->
- [x] T002 Add the preload `accent` group (`app/desktop/src/preload.ts`), the `accent:set` handler, the `rawAccentReported` flag map with view-destroy cleanup, and the theme-color-seam gating in `app/desktop/src/main.ts` <!-- R2, R3 -->

### Phase 2: Frontend

- [x] T003 Add `accentBridge` narrowing + `setShellAccent` in `app/frontend/src/lib/shell.ts`; cover (absent group, denial, ok) in `app/frontend/src/lib/shell.test.ts` <!-- R4 -->
- [x] T004 Add `ShellAccentReporter` (+ test mirroring the badge reporter's) and mount it beside `ShellBadgeReporter` in `app/frontend/src/app.tsx` <!-- R5 -->

### Phase 3: Verification

- [x] T005 Full gates: `cd app/desktop && pnpm compile && node --test "dist/**/*.test.js"`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend` <!-- R1–R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `isHostAccentHex` matches the SPA's `HOST_ACCENT_HEX` exactly and is `node --test` covered
- [x] A-002 R2: `accent:set` is gated, validated, view-resolved, persists via the existing mutator, no-ops for non-view senders, and never touches the theme-color cache or overlay
- [x] A-003 R3: after a raw report, theme-color events stop persisting `accentColor` for that host; never-reported hosts keep the fallback; flag dies with the view
- [x] A-004 R4: `setShellAccent` follows the optional-group pattern (false/no-throw on all absent/denied paths)
- [x] A-005 R5: the reporter fires on initial resolve and on change only (ref-guarded), skips null, and mounts behind `isShell()`

### Behavioral Correctness

- [x] A-006 R2: a persisted raw accent renders a full-strength edge bar in the switcher (the muted-bar defect is gone for new-pair hosts)
- [x] A-007 R6: older-SPA and older-shell pairings degrade exactly as shipped (blend fallback / harmless false)

### Scenario Coverage

- [x] A-008 R6: the self-healing scenario is reasoned through or exercised: a blended stored value is overwritten by the first raw report

### Edge Cases & Error Handling

- [x] A-009 R2: non-string and non-hex payloads reject with `Invalid request` and persist nothing
- [x] A-010 R3: post-restart transient blend re-persist is bounded by the initial-resolve report (no permanent regression)

### Code Quality

- [x] A-011 Pattern consistency: handler mirrors `badge:set`, bridge mirrors `badgeBridge`, reporter mirrors `ShellBadgeReporter`, flag mirrors `viewLoadFailed`
- [x] A-012 No unnecessary duplication beyond the deliberate cross-package regex mirror (documented in Design Decisions)
- [x] A-013 Tests ride the established runners; no new test infrastructure

### Security

- [x] A-014 R2: the channel is sender-gated like every `servers:*`/`badge:*` handler and its payload is strictly validated before persistence

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The `did-change-theme-color` → `setHostAccentColor` seam is demoted to the older-SPA fallback (gated on `rawAccentReported`), not removed: it remains load-bearing for SPAs without the reporter.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The validation helper lands in `hosts.ts` (not a new module or strip.ts) | It guards what the store persists, and hosts.ts already carries the mutator + node-test suite; intake #13 left "hosts.ts or sibling" open | S:60 R:90 A:85 D:70 |
| 2 | Confident | Handler returns `{ ok: true }` for a view whose host id the mutator no-ops (racing removal) — the store's unknown-id-no-op convention | Mirrors `servers:reorder`'s unknown-id-ok decision from #588; not worth a distinct error surface for a teardown race | S:55 R:90 A:80 D:70 |
| 3 | Confident | `rawAccentReported` is set only on a persist that actually resolved a view (not on validation-passing welcome reports) | The flag's meaning is "this host's SPA speaks the new protocol"; a non-view sender identifies no host | S:60 R:85 A:85 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
