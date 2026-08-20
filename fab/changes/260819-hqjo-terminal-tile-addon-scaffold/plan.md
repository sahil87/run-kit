# Plan: Terminal Tile Addon Scaffold

**Change**: 260819-hqjo-terminal-tile-addon-scaffold
**Intake**: `intake.md`

## Requirements

### Frontend: Dependencies

#### R1: All three addon packages land at once
`app/frontend/package.json` MUST gain `@xterm/addon-search@^0.16.0`, `@xterm/addon-serialize@^0.14.0`, and `@xterm/addon-progress@^0.2.0` (the xterm 6.0.0 release train), with the pnpm lockfile updated in the same commit.

- **GIVEN** a fresh checkout of this branch
- **WHEN** `pnpm install` runs in `app/frontend/`
- **THEN** all three packages resolve cleanly against `@xterm/xterm@^6.0.0` with no peer warnings

### Frontend: Registration + exposure seams (`terminal-client.tsx`)

#### R2: Static import + passive registration of all three addons
`terminal-client.tsx` MUST statically import all three addons at top-of-file (never `await import()` — the per-origin connection-budget constraint that made all existing xterm imports static) and `loadAddon` them in `init()`, after `UnicodeGraphemesAddon` and before the `WebglAddon` try/catch (only the Unicode→WebGL ordering is load-bearing; WebGL stays last so its runtime guard scope is unchanged). All three are passive: search and serialize do nothing until invoked; progress is a passive OSC 9;4 stream parser.

- **GIVEN** a mounted `TerminalClient`
- **WHEN** `init()` completes
- **THEN** all nine xterm-family addons are loaded, the Unicode addon still precedes WebGL, and no behavior differs from before (no new writes, no new network, no new rendering)

#### R3: Search/serialize refs exposed via the `focusRef` seam convention
`TerminalClient` MUST accept two new optional props, `searchAddonRef?: React.MutableRefObject<SearchAddon | null>` and `serializeAddonRef?: React.MutableRefObject<SerializeAddon | null>`, following the existing `focusRef` lifecycle exactly: filled during `init()` when the prop is provided, nulled in the init effect's cleanup. No caller passes them yet (zqf9 and shqo consume them).

- **GIVEN** a parent that passes `searchAddonRef` / `serializeAddonRef`
- **WHEN** the terminal initializes and later unmounts
- **THEN** each ref holds the live addon instance while mounted and `null` after cleanup
- **AND** omitting the props (every current call site) changes nothing

#### R4: Progress seam is an `onProgressChange` callback prop, default no-op
`TerminalClient` MUST accept `onProgressChange?: (state: number, value: number) => void` and register the progress addon's change event to call it. Because the init effect attaches once (deps `[wsRef, focusRef]`), the prop MUST be read through a render-mirrored ref (the `appKeybindingsRef` pattern) so a changing callback never re-runs init. The scaffold does NOT throttle or render anything — that is 1vxq's job.

- **GIVEN** a parent that passes `onProgressChange`
- **WHEN** the pane emits an OSC 9;4 progress sequence
- **THEN** the callback receives the addon's `(state, value)` pair
- **AND** with the prop omitted (every current call site) the registration is a no-op

### Frontend: Slot anchors (`surface-layout.tsx`)

#### R5: Five rk-slot comment anchors at the design-study positions
`surface-layout.tsx` MUST gain five JSX comment anchors, each on its own line, at exactly these positions in the tile-header render:

- `{/* rk-slot: progress-chip */}` — immediately after the tty `StatusDot` line
- `{/* rk-slot: find-button */}` then `{/* rk-slot: export-button */}` — after the `<span className="flex-1" />` spacer, immediately left of (before) the pane-segment block
- `{/* rk-slot: find-bar-row */}` then `{/* rk-slot: progress-line */}` — between the header block's close and the content-area `<div>`

Contract: shqo replaces `export-button`; zqf9 replaces `find-button` + `find-bar-row`; 1vxq replaces `progress-chip` + `progress-line`. Anchors are consumed-and-deleted; none render anything.

- **GIVEN** the anchors are in place
- **WHEN** the frontend builds and renders any tile layout
- **THEN** the DOM output is byte-identical to before (JSX comments emit nothing)

### Frontend: Zero behavior change proven by tests

#### R6: Existing suites stay green; one new unit assertion covers the addon loads
The existing test suites MUST pass unchanged (the proof of zero behavior change). `terminal-client.test.tsx` MUST gain `vi.mock` entries for the three new addon packages (matching the existing addon-mock pattern — real addon imports can throw in jsdom, the known `Data error` class) and one unit test asserting the three addons load without error alongside the existing ones and that the exposure seams fill/clear their refs. No e2e, no `.spec.md` (no Playwright spec added).

- **GIVEN** the scaffold is applied
- **WHEN** `just test-frontend` and `npx tsc --noEmit` run
- **THEN** both pass, including the new addon-load assertion

### Non-Goals

- No visible UI, no behavior change, no new components (no dead buttons ship)
- No throttling/render logic for progress (1vxq), no search/serialize invocation (zqf9/shqo), no backend (shqo)
- No registry/slot-array abstraction — anchors are temporary coordination markers

### Design Decisions

#### Anchors over dead buttons or a slot registry
**Decision**: The parallelization placeholders are distinct-line `rk-slot:` JSX comment anchors, consumed and deleted by the three downstream changes.
**Why**: Zero-abstraction (nothing to unwind later), zero-behavior (nothing renders), and each downstream change replaces only its own line so the three PRs merge cleanly in any order.
**Rejected**: Hidden/disabled buttons (dead UI ships, violates minimal-surface); a slot-array/registry abstraction (permanent indirection for a temporary coordination problem).
*Introduced by*: 260819-hqjo-terminal-tile-addon-scaffold

#### Two separate addon-ref props, not one combined handle
**Decision**: `searchAddonRef` and `serializeAddonRef` are two independent optional `MutableRefObject` props mirroring `focusRef`'s lifecycle.
**Why**: Matches the established per-concern ref seam (`wsRef`, `focusRef`); zqf9 and shqo each consume exactly one prop, keeping their diffs disjoint.
**Rejected**: A combined `addonsRef` object (couples the two downstream changes to one prop's shape); exposing via `useImperativeHandle` (no existing precedent in this component — every seam is a plain MutableRefObject prop).
*Introduced by*: 260819-hqjo-terminal-tile-addon-scaffold

## Tasks

### Phase 1: Setup

- [x] T001 Add `@xterm/addon-search@^0.16.0`, `@xterm/addon-serialize@^0.14.0`, `@xterm/addon-progress@^0.2.0` to `app/frontend/package.json` dependencies and run `pnpm install` (lockfile updated) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 In `app/frontend/src/components/terminal-client.tsx`: statically import the three addons; add optional props `searchAddonRef`, `serializeAddonRef` (focusRef lifecycle: fill at init, null at cleanup) and `onProgressChange` (render-mirrored ref, default no-op); `loadAddon` all three in `init()` between UnicodeGraphemesAddon and the WebGL try/catch; register the progress addon's change event against the mirrored callback <!-- R2 -->
- [x] T003 [P] In `app/frontend/src/components/surface-layout.tsx`: add the five `rk-slot:` comment anchors at the R5 positions, each on its own line <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T004 In `app/frontend/src/components/terminal-client.test.tsx`: add `vi.mock` entries for the three new addon packages (existing mock pattern) and one test asserting the three addons load without error alongside the existing ones and the seam refs fill at init / clear at cleanup; run `npx tsc --noEmit` and `just test-frontend` <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The three addon packages are in `app/frontend/package.json` at the pinned ranges and the pnpm lockfile resolves them against xterm 6 with no peer conflicts
- [x] A-002 R2: All three addons are statically imported and loaded in `init()` after UnicodeGraphemesAddon and before the WebGL try/catch; nothing invokes search/serialize and nothing renders progress
- [x] A-003 R3: `searchAddonRef`/`serializeAddonRef` fill with live instances at init and null at cleanup; omitted props are no-ops
- [x] A-004 R4: `onProgressChange` is called with the addon's `(state, value)` on progress events, read through a render-mirrored ref; omitted prop is a no-op
- [x] A-005 R5: Exactly five `rk-slot:` anchors exist at the specified positions, each on its own line, emitting nothing to the DOM

### Behavioral Correctness

- [x] A-006 R2: The Unicode-before-WebGL load ordering is preserved and the WebGL runtime guard still wraps only WebGL construction

### Scenario Coverage

- [x] A-007 R6: A unit test proves the three new addons load without error alongside the existing six; `just test-frontend` and `npx tsc --noEmit` pass

### Code Quality

- [x] A-008 Pattern consistency: New props follow the `focusRef` seam convention and the callback-ref mirroring matches `appKeybindingsRef`; anchor comments match surrounding comment idiom
- [x] A-009 No unnecessary duplication: No new abstraction introduced; existing addon-load and mock patterns reused

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New addons load between UnicodeGraphemesAddon and the WebGL try/catch | Only Unicode→WebGL ordering is documented load-bearing; keeping WebGL last preserves its guard scope | S:70 R:90 A:85 D:80 |
| 2 | Confident | Exposure = two separate optional MutableRefObject props mirroring focusRef exactly | Established per-concern seam convention in this component; keeps zqf9/shqo diffs disjoint | S:65 R:85 A:85 D:75 |
| 3 | Confident | `onProgressChange` read via render-mirrored ref (appKeybindingsRef pattern) | Init effect attaches once with deps `[wsRef, focusRef]`; a raw prop read would go stale or force re-init | S:70 R:85 A:90 D:85 |
| 4 | Certain | Versions ^0.16.0 / ^0.14.0 / ^0.2.0 are the latest published for the xterm 6 train | Verified against the npm registry at plan time; matches the intake pins | S:90 R:95 A:95 D:95 |
| 5 | Confident | Progress addon's change event payload adapted to the two-arg `(state, value)` prop shape | Verified at install: typings declare `onChange: IEvent<IProgressState>` with `{state, value}`; adapter keeps the prop contract stable | S:60 R:90 A:85 D:80 |
| 6 | Confident | The shared `WebglAddon` test mock gains `onContextLoss: vi.fn()` | init() registers onContextLoss BEFORE loadAddon; without it every test silently took the canvas fallback and WebGL never "loaded" — the new load assertion exposed the gap. Extending the mock over dropping the assertion keeps tests matching production | S:65 R:90 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
