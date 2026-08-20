# Intake: Terminal Tile Addon Scaffold

**Change**: 260819-hqjo-terminal-tile-addon-scaffold
**Created**: 2026-08-19

## Origin

Conversational — follow-up to the `/fab-discuss` addon-audit session that drafted `260819-shqo-terminal-tile-export`, `260819-zqf9-terminal-tile-find`, and `260819-1vxq-terminal-tile-progress`. Those three changes all touch the same shared seams (the tty tile header in `surface-layout.tsx`, `terminal-client.tsx` addon loading, `package.json`, and the same memory files), which forced a sequential execution plan.

> What if we create one change to create placeholders for the other three changes so that all the other three can then run in parallel?

Key decisions from the discussion:

- The placeholders are **anchor comments at distinct lines** (`rk-slot:` markers), NOT visible UI — no dead buttons ship. Each downstream change replaces only its own anchor line, so the three PRs merge cleanly in any order.
- The scaffold pre-lands everything shared: all three addon deps, their static imports + registration (all passive until used), the exposure seams, the five slot anchors, and the shared memory sentences (so each change's hydrate edits mostly its own subsection).
- This change MUST land before any of the three feature changes start; it is the sole ordering constraint — after it, shqo/zqf9/1vxq are mutually independent.

## Why

1. **Pain point**: shqo, zqf9, and 1vxq each edit the same lines — the tty header verb cluster, the `loadAddon` block in `terminal-client.tsx`, the deps block in `package.json`, and the addons list in `docs/memory/run-kit/ui/terminal.md`. Run in parallel they guarantee rebase conflicts; run sequentially they cost `sum(3)` wall clock.
2. **Consequence if unfixed**: either serialized execution (slow, idle agent capacity) or agents hand-resolving conflicts in shared JSX (error-prone).
3. **Why this approach**: extension-point-first is the standard way a team parallelizes work on one surface. Anchor comments are zero-abstraction (no registry/indirection to unwind later — the anchors are consumed and deleted by the three changes), zero-behavior (nothing renders differently), and cheap (~30 lines).

## What Changes

### 1. Dependencies (`app/frontend/package.json`)

Add all three at once: `@xterm/addon-search@^0.16.0`, `@xterm/addon-serialize@^0.14.0`, `@xterm/addon-progress@^0.2.0` (all from the xterm 6.0.0 release train already in use).

### 2. Registration + exposure seams (`app/frontend/src/components/terminal-client.tsx`)

Following the existing pattern exactly (static imports at top, `loadAddon` in the open effect, `fitAddonRef`-style refs):

- Statically import and `loadAddon` all three (passive until used — search/serialize do nothing unregistered-behaviors-wise; progress is a passive stream parser).
- Hold `searchAddonRef` and `serializeAddonRef` alongside the existing `fitAddonRef`, and expose them to the tile layer via an optional imperative-ref prop following the existing `wsRef`/`focusRef` seam conventions (exact shape decided at apply).
- Register the progress addon's `onChange` against a new optional `onProgressChange?: (state: number, value: number) => void` prop, default no-op. The scaffold does NOT throttle or render — that is 1vxq's job.

### 3. Slot anchors (`app/frontend/src/components/surface-layout.tsx`)

Five comment anchors at the exact positions the design study fixed, each on its own line so downstream changes never collide:

- Tty tile header, left of the pane segment (order matches the study): `{/* rk-slot: find-button */}` then `{/* rk-slot: export-button */}`
- Beside the StatusDot: `{/* rk-slot: progress-chip */}`
- Directly below the header, above the content area: `{/* rk-slot: find-bar-row */}` then `{/* rk-slot: progress-line */}`

Contract: shqo replaces `export-button`; zqf9 replaces `find-button` and `find-bar-row`; 1vxq replaces `progress-chip` and `progress-line`. An anchor is deleted when consumed; none survive after all three land.

### 4. Memory pre-seeding (hydrate)

This change's hydrate writes the shared sentences once, so the three parallel hydrates edit mostly disjoint subsections: the three-addons-registered-passive fact in `ui/terminal`, and the slot-anchor contract note in `ui/lenses-and-layout` (removed again by whichever of the three changes hydrates last — acceptable prose churn).

### Non-goals

- No visible UI, no behavior change, no new components.
- No throttling/render logic for progress (1vxq), no search/serialize invocation (zqf9/shqo), no backend (shqo).
- No registry/slot-array abstraction — anchors are temporary coordination markers, not architecture.

## Affected Memory

- `run-kit/ui/terminal`: (modify) addons list gains search/serialize/progress (registered, passive, seams exposed)
- `run-kit/ui/lenses-and-layout`: (modify) transient note: the tty tile header carries rk-slot anchors consumed by shqo/zqf9/1vxq

## Impact

- **Frontend only**: `app/frontend/package.json`, `app/frontend/src/components/terminal-client.tsx`, `app/frontend/src/components/surface-layout.tsx`. Roughly 30 lines.
- **Downstream**: `260819-shqo`, `260819-zqf9`, `260819-1vxq` all depend on this landing first; their intakes reference the anchor names above.
- **Tests**: existing suites stay green (the proof of zero behavior change); one unit assertion that the three addons load without error alongside the existing ones. No e2e, no `.spec.md` (no Playwright spec added).

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Placeholders are distinct-line `rk-slot:` comment anchors, not visible UI; consumed-and-deleted by the three changes | Discussed — user approved the anchor refinement over dead buttons | S:90 R:90 A:95 D:90 |
| 2 | Certain | Pre-land all three deps + static imports + registration; all passive | Discussed; each downstream intake already assumed static registration (their assumption 8) | S:85 R:85 A:95 D:90 |
| 3 | Certain | Anchor set and positions per the approved design study: find-button, export-button, progress-chip, find-bar-row, progress-line | The study fixed the anatomy; downstream intakes reference these exact names | S:85 R:85 A:90 D:90 |
| 4 | Confident | Search/serialize refs exposed via an imperative-ref prop following the existing wsRef/focusRef seam conventions; exact shape decided at apply | Pattern is established in terminal-client.tsx; the one real interface guess in this change | S:55 R:75 A:80 D:70 |
| 5 | Confident | Progress seam is `onProgressChange?: (state, value) => void`, default no-op; no throttling here | Minimal surface for 1vxq to consume; throttling belongs with the render it protects | S:55 R:85 A:85 D:80 |
| 6 | Confident | Hydrate pre-seeds the shared memory sentences to shrink the three parallel hydrates' overlap | Discussed as the residual-conflict mitigation; prose churn is acceptable | S:60 R:90 A:80 D:80 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
