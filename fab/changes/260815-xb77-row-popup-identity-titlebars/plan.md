# Plan: Identity Title Bars on Sidebar Row Hover Popups

**Change**: 260815-xb77-row-popup-identity-titlebars
**Intake**: `intake.md`

## Requirements

> The approved visual mock `reference-mock.html` (in this change folder) is the authoritative rendering: §1 treatment-A card for the window flyout, §2 for the session tip, §3 for the server tip.

### Frontend: Window flyout identity title bar

#### R1: Identity title content (alt B)
The window flyout card (`app/frontend/src/components/sidebar/row-flyout-card.tsx`) SHALL render an identity title as its first element: `Window @{id} · pane %{activePaneId} · {N} panes` — the tmux window id from `win.windowId`, the active pane's id from `win.panes.find(p => p.isActive)?.paneId`, and the pane count from `win.panes.length`. Literal words (`Window`, `pane`, the count segment) render in secondary text; the `@N` / `%N` handles render in primary text. A count of 1 SHALL read `1 pane` (singular). The title MUST degrade gracefully: when `win.panes` is absent or empty, omit the pane segments and render `Window @{id}` alone; never render `undefined`, `NaN`, or empty segments.

- **GIVEN** a window with `windowId: "@31"` and two panes where `%425` is active
- **WHEN** the flyout card opens
- **THEN** the title reads `Window @31 · pane %425 · 2 panes` with `@31` and `%425` in primary text
- **AND** for the same window with `panes` undefined, the title reads `Window @31`

#### R2: Inset title-bar chrome (treatment A)
The title SHALL render as a full-bleed inset title bar: `bg-bg-inset` background spanning the card's full width (escaping the card's `px-2 py-1.5` padding), a `border-b border-border` bottom edge, and top corners rounded to match the card radius. The fork link (`ForkLink`) and docs `InfoIcon` link MOVE from the status-label line into the title bar's right edge (same `ml-auto` cluster idiom). The status label `dotLabel(win, state)` demotes to the first body line below the bar, and MUST keep importing the shared `dotLabel` from `status-dot-label.ts` (single-sourced with the status dot's `aria-label` — no forked copy). The `FloatingArrow` notch SHALL take the `bg-inset` fill when it lands on the title band and keep the `bg-primary` card fill when it lands below it, so notch + bar read as one shape (mock `notch on-inset` variant).

- **GIVEN** the flyout card open on a claude-chat window with a PR
- **WHEN** rendered
- **THEN** the first element is the inset bar carrying title + fork + docs icons, the second is the `dotLabel` text, followed by the unchanged `out`/`agt`/`fab`/`pr` registers and freshness line
- **AND** the notch pinned within the bar's vertical extent is filled `--color-bg-inset`, while a notch pinned below it is filled `--color-bg-primary`

#### R3: Render-performance contract preserved
The title bar MUST be static text derived from the already-passed `win` prop: no new `useNow` clocks, no subscriptions, no state lifted out of `useRowFlyout`/`WindowRow`. The card body continues to mount only while open, and `WindowRow`'s `React.memo` behavior is untouched (no new unstable props threaded into the memoized tree).

- **GIVEN** the sidebar rendering with SSE ticks flowing
- **WHEN** no flyout is open
- **THEN** no title-bar code executes and no additional per-second re-render exists anywhere in the row tree

### Frontend: Shared title-bar grammar

#### R4: Shared popup title-bar primitive
A shared presentational header component (e.g. `sidebar/popup-title-bar.tsx`) SHALL render the inset title-bar chrome (full-bleed strip, bottom border, rounded top, secondary-literal/primary-handle text slots, optional right-edge children for the window card's icons) and be consumed by all three popups, so the chrome cannot drift between them. It is presentational only — no floating-ui logic, no state.

- **GIVEN** the three popup surfaces
- **WHEN** each renders its header
- **THEN** all three render through the shared component with identical chrome classes

#### R5: Session row identity tip (new surface)
The session row (`app/frontend/src/components/sidebar/session-row.tsx`) SHALL gain a row-level hover/focus card: title bar `Session {full name}` (literal secondary, name primary, never truncated) and one plain-text body line composed of the segments it can derive: `${sessionId} · {N} windows · {abbreviated path}` — tmux session id (`$N` form), window count from `session.windows.length`, and the session root path with the home directory abbreviated to `~`. Underivable segments (missing id/path on old payloads) are omitted, never rendered empty. The card holds NO interactive content, NO icons, NO registers (tier weight lives in the body). It opens on fine-pointer row hover and keyboard row focus, dismisses on Escape/leave/blur, and MUST NOT hover-open on touch. It MUST NOT mix warmth with the icon-scoped tier-1 `Tip`s on the same row (they stay in the sidebar `TipGroup`; this card does not join that group) nor with the window flyout's module-scoped warm window. It MUST coexist with the row's existing layers (color picker popover, drag) — suppressed while a row popover is open, closed on drag start, following the window flyout's `suppressed` idiom.

- **GIVEN** a session named `code-surface-latch-distill` with id `$4`, 3 windows, path `/home/sahil/code/sahil87/run-kit`
- **WHEN** the row is hovered on a fine pointer
- **THEN** a card appears at the sidebar's right edge reading `Session code-surface-latch-distill` in the title bar and `$4 · 3 windows · ~/code/sahil87/run-kit` in the body
- **AND** on a payload without `sessionId`/`sessionPath`, the body reads `3 windows`

#### R6: Server tile identity tip (new surface)
The SERVER-panel tile (`app/frontend/src/components/sidebar/server-panel.tsx`) SHALL gain the same card: title bar `Server {name}`, body `tmux -L {name} · {N} sessions` — the socket flag composed frontend-side from the server name (server names ARE socket names) and shown uniformly for every server including `default`; session count from the tile's existing `sessionCount`. The tile's existing native `title` attribute (`{name} — {windowCountTooltip(...)}`) is REPLACED by this card (never both — the double-tooltip rule). Same interaction contract as R5.

- **GIVEN** the server tile `default` with 6 sessions
- **WHEN** hovered
- **THEN** the card reads `Server default` / `tmux -L default · 6 sessions`, and the tile carries no native `title` attribute

### Backend: session id + root path plumbing

#### R7: Extend session enumeration with `#{session_id}` and `#{session_path}`
`ListSessions` (`app/backend/internal/tmux/tmux.go`, the 7-field format string at ~line 714) SHALL append `#{session_id}` and `#{session_path}` (9 fields), `parseSessions` SHALL parse them, and `SessionInfo` SHALL gain `ID string \`json:"id,omitempty"\`` and `Path string \`json:"path,omitempty"\`` fields. `internal/sessions` SHALL thread both onto the `/api/sessions` JSON and SSE `sessions` event as `sessionId`/`sessionPath` on the session object (mirroring the `sessionColor` optional-field idiom). Constitution II holds: derived from tmux at request time, no storage.

- **GIVEN** a tmux server with session `foo` (id `$4`, path `/home/sahil/code/x`)
- **WHEN** `/api/sessions` is fetched
- **THEN** the session object carries `"sessionId": "$4"` and `"sessionPath": "/home/sahil/code/x"`
- **AND** `parseSessions` round-trips a 9-field line in tests, and tolerates malformed/short lines without panicking

#### R8: Frontend type + path abbreviation
`ProjectSession` (`app/frontend/src/types.ts`) SHALL gain optional `sessionId?: string` and `sessionPath?: string`. A small pure helper (in `lib/format.ts` or colocated) SHALL abbreviate a leading `/home/{user}/` or `/Users/{user}/` prefix to `~` for display; unrecognized shapes pass through unchanged.

- **GIVEN** `/home/sahil/code/sahil87/run-kit`
- **WHEN** abbreviated
- **THEN** the result is `~/code/sahil87/run-kit`; `/srv/data` passes through as `/srv/data`

### Tests

#### R9: Unit coverage
Unit tests SHALL cover: title composition + degradation (R1 both scenarios), the icon relocation + dotLabel demotion + single-sourcing (R2), the shared title-bar component (R4), session tip content + omission fallback (R5), server tip content + native-title removal (R6), backend format/parse round-trip (R7), and the path abbreviation helper (R8). Existing tests asserting the old header layout (`row-flyout-card.test.tsx`, and any `status-panel`/`pr-status-sidebar` unit assertions touching the card header) are UPDATED to the new structure — tests conform to the spec.

- **GIVEN** the test suites run via `just test-backend` / `just test-frontend`
- **WHEN** executed
- **THEN** all pass with the new assertions in place

#### R10: E2E coverage with `.spec.md` companions
Playwright e2e SHALL assert, per surface: the window flyout's title-bar text on hover, the session tip on session-row hover, and the server tip on tile hover. Any new or modified `*.spec.ts` ships its sibling `*.spec.md` in the same commit (Constitution: Test Companion Docs). The existing `row-flyout.spec.ts` assertions on the card header are updated.

- **GIVEN** `just test-e2e` (or scoped `just test-e2e "<spec>"`) runs
- **WHEN** the new/updated specs execute
- **THEN** they pass, and every touched `.spec.ts` has a current `.spec.md`

### Non-Goals

- Coarse-pointer behavior changes (window card keeps its dot-tap; new tips are hover/focus-only in v1 — touch users have the PANE panel and row labels)
- The PANE panel registers, `StatusDot` itself, board-route sidebar variants beyond what shared components serve
- Warm-window/delay-group unification across the three popups (deliberate isolation, see Design Decisions)

### Design Decisions

#### Session/server tips are slim tier-2 hover-cards, not fattened Tips
**Decision**: Build the session/server identity tips as small role-less hover-cards on `@floating-ui/react` sharing the `PopupTitleBar` header, not as extensions of tier-1 `Tip`.
**Why**: The two-tier taxonomy's promotion rule is explicit — "a tooltip that needs a second line of state is tier-2, not a fatter tier-1." The identity tips carry a second line of state (counts, paths, socket). Extending `Tip` would break its one-line `role="tooltip"` contract and its `pointer-events-none`/40ch invariants.
**Rejected**: Extending `Tip` with a title-bar mode — dilutes the tier boundary every future tooltip decision leans on; reusing the full `useRowFlyout` machinery for sessions/servers — it carries fork/focus-manager/warm-window weight these non-interactive cards don't need.
*Introduced by*: 260815-xb77-row-popup-identity-titlebars

#### No warmth coupling between the three popups
**Decision**: The new session/server cards use a plain open delay and do not join the sidebar `TipGroup` or the window flyout's module-scoped warm window.
**Why**: The flyout deliberately keeps its warmth OUT of `TipGroup` (documented in row-flyout-card.tsx) because mixing tier-1/tier-2 warmth strobes; adding a third pool to either group re-creates the problem. Isolation is the shipped pattern.
**Rejected**: A unified cross-popup delay group — a real option later, but it changes tuned behavior for existing surfaces and is out of scope.
*Introduced by*: 260815-xb77-row-popup-identity-titlebars

#### Path abbreviation is a frontend display heuristic
**Decision**: The backend sends the raw `#{session_path}`; the frontend abbreviates `/home/{user}/` / `/Users/{user}/` to `~` at display time.
**Why**: Raw derived state over the wire (Constitution II posture); `~` is presentation. The frontend cannot know the server's `$HOME`, but the two standard prefixes cover the real cases; unrecognized paths pass through honestly.
**Rejected**: Backend abbreviation (bakes presentation into the API); shipping `$HOME` in the payload (a second field for a cosmetic win).
*Introduced by*: 260815-xb77-row-popup-identity-titlebars

## Tasks

### Phase 1: Backend plumbing

- [x] T001 Extend `ListSessions` format with `#{session_id}` + `#{session_path}` (9 fields), add `ID`/`Path` to `SessionInfo`, update `parseSessions` + its malformed-line tolerance, in `app/backend/internal/tmux/tmux.go`; round-trip + short-line tests in `tmux_test.go` <!-- R7 -->
- [x] T002 Thread `sessionId`/`sessionPath` through `app/backend/internal/sessions/sessions.go` onto the `/api/sessions` + SSE session JSON (optional-field idiom); update `sessions_test.go` <!-- R7 -->

### Phase 2: Frontend core

- [x] T003 [P] Add `sessionId?`/`sessionPath?` to `ProjectSession` in `app/frontend/src/types.ts`; add the `~`-abbreviation helper (in `app/frontend/src/lib/format.ts`) + unit test <!-- R8 -->
- [x] T004 [P] Create the shared `PopupTitleBar` presentational component (`app/frontend/src/components/sidebar/popup-title-bar.tsx`): inset strip, bottom border, rounded top, secondary/primary text slots, optional right-edge children; unit test <!-- R4 -->
- [x] T005 Rework `row-flyout-card.tsx`: compose the identity title (alt B + degradation), render it via `PopupTitleBar` as the card's first element, move the fork/docs cluster into the bar, demote `dotLabel` to the first body line (keep the shared import), wire the notch's conditional `bg-inset` fill <!-- R1, R2 -->
- [x] T006 Update `row-flyout-card.test.tsx` to the new structure: title composition (both R1 scenarios), icons-in-bar, dotLabel-as-body-line single-sourcing, notch fill seam; verify no new clocks/lifted state (R3 review point) <!-- R9 -->
- [x] T007 Build the session-row identity tip in `session-row.tsx` (new slim hover-card using `PopupTitleBar`; hover/focus open, Escape/leave dismiss, `mouseOnly`, suppressed-while-popover-open + close-on-drag idiom, no TipGroup/warm-window coupling); body segments with omission fallback; unit test <!-- R5 -->
- [x] T008 Build the server tile identity tip in `server-panel.tsx` (same card; `tmux -L {name} · {N} sessions` body), REMOVE the tile's native `title` attribute; update `server-panel` unit tests (native-title-gone + card content) <!-- R6 -->

### Phase 3: Integration & E2E

- [x] T009 Update `tests/e2e/row-flyout.spec.ts` (+ `.spec.md`) for the title-bar header; add hover assertions for the session tip and server tip (new spec or extend an existing sidebar spec) with sibling `.spec.md` updates <!-- R10 -->
- [x] T010 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, scoped `just test-e2e` on the touched specs <!-- R9 -->

## Execution Order

- T001 → T002 (backend field flow); T003/T004 are parallel and independent of Phase 1
- T005 depends on T004; T006 depends on T005; T007/T008 depend on T003 + T004
- T009 depends on T005/T007/T008; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Flyout title renders `Window @N · pane %N · N panes` with correct primary/secondary split and `1 pane` singular — `WindowFlyoutTitle` (row-flyout-card.tsx:279); unit-tested (row-flyout-card.test.tsx, 25 tests pass)
- [x] A-002 R2: Inset title bar is full-bleed with bottom border + rounded top; fork/docs icons ride the bar; `dotLabel` is the first body line via the shared import — `PopupTitleBar` (`-mx-2 -mt-1.5` escapes the card's `px-2 py-1.5`, `border-b`, `rounded-t-[5px]`); icons in the bar's `right` slot; `dotLabel` still imported from `status-dot-label.ts`
- [x] A-003 R4: All three popups render their header through the shared `PopupTitleBar` — window card directly, session/server tips via `IdentityTipCard`
- [x] A-004 R5: Session row hover shows `Session {full name}` + `$N · N windows · ~/{path}` card — unit-tested + e2e (`row-identity-tips.spec.ts`, 3 passed)
- [x] A-005 R6: Server tile hover shows `Server {name}` + `tmux -L {name} · N sessions`; native `title` attribute removed — unit + e2e assert `not.toHaveAttribute("title")`
- [x] A-006 R7: `/api/sessions` + SSE carry `sessionId`/`sessionPath`; 9-field parse round-trips — `TestParseSessionsIDPath` + `TestProjectSessionIDPathJSON` pass

### Behavioral Correctness

- [x] A-007 R2: Notch takes `bg-inset` fill on the title band, `bg-primary` below it — `notchFill(middlewareData.arrow?.y)` seam, pinned by unit test
- [x] A-008 R3: No new clocks, subscriptions, or lifted state; `WindowRow` memo tree untouched; card body still mounts only while open — title bar is static text from `win`; `IdentityTipCard` renders null while closed; `window-row.tsx` untouched
- [x] A-009 R5: New tips never hover-open on touch, never join TipGroup or the flyout warm window, suppress under row popovers, and close on drag start — `mouseOnly` + coarse-pointer suppression, plain 300ms delay, `suppressed: showColorPicker`, `tip.close()` on drag start; all unit-tested

### Scenario Coverage

- [x] A-010 R1: Degradation — `panes` absent renders `Window @N` alone (unit-tested) — also e2e (`Window @2` in row-flyout.spec.ts)
- [x] A-011 R5: Degradation — missing `sessionId`/`sessionPath` omits those body segments (unit-tested) — session-row.test.tsx "omits underivable body segments"
- [x] A-012 R8: Path abbreviation handles `/home/*`, `/Users/*`, and pass-through cases (unit-tested) — format.test.ts, 8 cases

### Edge Cases & Error Handling

- [x] A-013 R7: `parseSessions` tolerates short/malformed lines (old-binary tolerance) without panic; frontend treats absent new fields as undefined — 7/8/9-field cases tested; frontend fields optional (`sessionId?`/`sessionPath?`)

### Code Quality

- [x] A-014 Pattern consistency: New components follow the flyout's floating-ui idioms, token classes, and file conventions; no inline tmux command construction; no client polling
- [x] A-015 No unnecessary duplication: title-bar chrome exists once (`PopupTitleBar`); no forked `dotLabel`; existing `formatDuration`/format helpers reused where applicable — one should-fix noted: `abbreviateHomePath`'s home-prefix regex overlaps `status-panel.tsx`'s `HOME_PATTERNS` (see review findings)
- [x] A-016 Comments state constraints only (no narration, no change-ID citations in code)

### Security

- [x] A-017 R7: No new subprocess surface — format-string extension only; existing `exec.CommandContext` path unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/sidebar/server-panel.tsx` `windowCountTooltip` — superseded by the identity tip card (the native `title` it fed is removed); the apply stage already deleted it. No further candidates.
- `app/frontend/src/components/sidebar/status-panel.tsx:40-53` `HOME_PATTERNS` + the substitution step of `shortenPath` — consolidation candidate (not deletion): its home-prefix regex set (incl. `/root`) now overlaps the new `abbreviateHomePath` (`lib/format.ts`); extracting one shared substitution helper would prevent drift. Surfaced as a should-fix review finding; not actionable as a deletion here because `shortenPath` couples substitution with truncation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Session root path sources from `#{session_path}` | Intake front-runner; tmux-native session directory, no derivation; if it proves wrong at apply (empty on some servers), the omission fallback keeps the tip honest | S:60 R:80 A:65 D:55 |
| 2 | Confident | JSON field names `sessionId`/`sessionPath` on the session object; Go fields `ID`/`Path` with `id`/`path` tags on `SessionInfo` | Mirrors `sessionColor` optional-field idiom; purely additive keys | S:55 R:85 A:80 D:70 |
| 3 | Confident | Session/server tips are new slim hover-cards sharing `PopupTitleBar`, not `Tip` extensions and not `useRowFlyout` reuse | The taxonomy's promotion rule decides tier; weight comparison decides against full flyout machinery (Design Decisions) | S:70 R:75 A:80 D:70 |
| 4 | Confident | `~` abbreviation is a frontend display heuristic over `/home/{user}` and `/Users/{user}` prefixes | Frontend cannot know server `$HOME`; covers the real cases; pass-through is honest (Design Decisions) | S:55 R:85 A:75 D:65 |
| 5 | Confident | Notch fill switches by comparing the arrow's resolved y-offset against the title-bar band height at render time | The arrow middleware exposes its position; a simple threshold matches the mock; worst case the notch keeps card fill below the band — cosmetic, reversible | S:50 R:85 A:70 D:60 |
| 6 | Certain | New tips are hover/focus-only in v1 (no coarse-pointer trigger) | Intake Not-in-scope excludes coarse-pointer changes; touch already has the PANE panel | S:85 R:90 A:90 D:85 |

6 assumptions (1 certain, 5 confident, 0 tentative).
