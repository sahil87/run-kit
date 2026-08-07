# Plan: Persist Sidebar Session Collapse State

**Change**: 260807-kddk-persist-sidebar-session-collapse
**Intake**: `intake.md`

## Requirements

### Sidebar: Per-Session Collapse Persistence

#### R1: Collapse state hydrates from localStorage at mount
The sidebar's per-session collapse map (`collapsed` in
`app/frontend/src/components/sidebar/index.tsx`) MUST be seeded at mount from a single
localStorage key `runkit-session-collapsed` holding a JSON object of collapsed exceptions
keyed by the session row key `` `${server}:${session.name}` `` (e.g.
`{"default:utils2": true}`). Only `true`-valued entries are honored — the stored map is
exceptions-only.

- **GIVEN** `localStorage["runkit-session-collapsed"]` is `{"primary:main": true}`
- **WHEN** the Sidebar mounts with server `primary` and session `main`
- **THEN** the `main` session row renders collapsed (`aria-expanded="false"`) and its window
  rows are absent from the DOM
- **AND** no network request, SSE subscription, or backend state is involved (Constitution II —
  this is a pure client view preference)

#### R2: Toggling a session to collapsed persists the entry
Toggling a session row's collapse chevron to *collapsed* MUST write the next map to
`runkit-session-collapsed` **outside** the `setCollapsed` state updater, following the
StrictMode purity pattern documented at `toggleServerSection`
(`index.tsx` — "the updater MUST be pure"). Under React 19 StrictMode a single click MUST
produce exactly one net toggle.

- **GIVEN** a Sidebar rendered under `<StrictMode>` with `main` expanded and no stored entry
- **WHEN** the user clicks the `Collapse main` chevron once
- **THEN** the row renders collapsed
- **AND** `localStorage["runkit-session-collapsed"]` parses to an object whose `primary:main`
  key is `true`

#### R3: Expanding a session deletes its stored entry
Toggling a session back to *expanded* MUST remove that session's key from the stored map
rather than storing `false`, keeping the map exceptions-only so the default applies to every
session the user has never collapsed. When the map becomes empty the storage key SHALL be
removed outright rather than persisted as `{}`.

- **GIVEN** `runkit-session-collapsed` contains `{"primary:main": true}` and `main` renders collapsed
- **WHEN** the user clicks the `Expand main` chevron
- **THEN** the row renders expanded
- **AND** the stored map no longer carries a `primary:main` key (the key itself is absent from
  localStorage once no exceptions remain)

#### R4: Reads degrade silently on malformed or unavailable storage
All localStorage access for this map MUST be wrapped in `try`/`catch` with a silent fallback
(the existing convention throughout `index.tsx`). Malformed JSON, a non-object root (including
an array), a throwing `localStorage`, and non-`true` entry values SHALL all degrade to "no
collapsed exceptions" — never a throw and never a blank sidebar.

- **GIVEN** `localStorage["runkit-session-collapsed"]` holds `"{not json"`
- **WHEN** the Sidebar mounts
- **THEN** it renders without throwing and every session row is expanded
- **AND** **GIVEN** the stored value is `["primary:main"]` (an array) or
  `{"primary:main": "yes"}` (a non-boolean value), **THEN** the same all-expanded result holds

#### R5: The expanded default is unchanged for unknown sessions
A session with no entry in the stored map MUST render expanded, exactly as today — the read
sites keep their `collapsed[sessionRowKey] ?? false` default and no write occurs for a session
the user has never collapsed.

- **GIVEN** `runkit-session-collapsed` contains `{"primary:other": true}`
- **WHEN** the Sidebar mounts with a session `main` that has no entry
- **THEN** `main` renders expanded (`aria-expanded="true"`) with its window rows in the DOM

### Non-Goals

- **Cross-tab sync** (a `storage` event listener) — the existing per-server persistence
  (`runkit-panel-sessions-{server}`) does not do it either; a refresh picks up another tab's writes.
- **Stale-entry pruning** — entries are tiny booleans, and pruning would require knowing the full
  session set across *non-attached* servers, which the client deliberately does not have.
- **Persisting the roving-focus key, scroll position, or selection** — collapse state only.
- **Backend/API involvement** — no Go changes, no endpoints, no routes.

### Design Decisions

#### Single JSON-map key rather than per-session scalar keys
**Decision**: One localStorage key `runkit-session-collapsed` holds a JSON object of collapsed
exceptions keyed by `` `${server}:${session}` ``, sitting alongside (not replacing) the per-server
scalar keys `runkit-panel-sessions-{server}`.
**Why**: A keyed boolean set is the natural shape for a map; one key can be read, parsed, and
rewritten atomically, and the whole surface is enumerable for a future cleanup.
**Rejected**: One localStorage key per session (`runkit-session-collapsed-{server}:{session}`) —
it sprawls unboundedly across killed sessions and cannot be enumerated for pruning. The per-server
pattern uses scalar keys only because its value is a single boolean per server.
*Introduced by*: 260807-kddk-persist-sidebar-session-collapse

#### Side effects outside the state updater, with a synchronous ref mirror
**Decision**: `toggleSession` derives the next map from a `collapsedRef` mirror, writes
localStorage, and commits the already-computed value via `setCollapsed(next)` — no side effect
and no derivation inside a functional updater.
**Why**: React 19 StrictMode (active via `main.tsx` in dev/e2e) double-invokes state updaters; a
`localStorage.setItem` inside one runs twice and the second pass observes the first pass's write,
making a single click a net no-op — the exact mss7 bug `toggleServerSection` documents. The ref
mirror additionally keeps back-to-back toggles batched into one render correct: the closure-captured
`collapsed` state would be stale for the second call and would write a map that disagrees with the
committed state.
**Rejected**: A `useEffect` keyed on `collapsed` — inherently StrictMode-safe, but it re-serializes
the hydrated map on every mount and would silently rewrite a malformed stored value, moving the
write off the user action that caused it.
*Introduced by*: 260807-kddk-persist-sidebar-session-collapse

## Tasks

### Phase 1: Setup

- [x] T001 Add the module-scope storage seam to `app/frontend/src/components/sidebar/index.tsx`: an exported `SESSION_COLLAPSED_STORAGE_KEY = "runkit-session-collapsed"` constant, a tolerant `readCollapsedSessions()` reader (try/catch around `getItem` + `JSON.parse`, reject non-object/array roots, keep only `value === true` entries), and a best-effort `writeCollapsedSessions(map)` writer (`removeItem` when the map is empty, `setItem` otherwise, try/catch silent) <!-- R1 R3 R4 -->

### Phase 2: Core Implementation

- [x] T002 Seed the `collapsed` state from storage in `app/frontend/src/components/sidebar/index.tsx`: replace `useState<Record<string, boolean>>({})` with the lazy initializer `useState(readCollapsedSessions)` and add a `collapsedRef` mirror initialized from the same seed, with a comment explaining why the handler cannot read React state directly <!-- R1 R5 -->
- [x] T003 Rewrite `toggleSession` in `app/frontend/src/components/sidebar/index.tsx` to derive `next` from `collapsedRef.current` (set `true` when collapsing, `delete` the key when expanding), update the ref, call `writeCollapsedSessions(next)` OUTSIDE any updater, then commit with `setCollapsed(next)` — carrying a comment pointing at the `toggleServerSection` StrictMode rationale <!-- R2 R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add a `Sidebar — per-session collapse persistence (kddk)` describe block to `app/frontend/src/components/sidebar/index.test.tsx` covering: collapse writes the entry and a remount restores the row collapsed (R1/R2); expanding removes the entry (R3); a malformed JSON value renders all sessions expanded without throwing (R4); a non-object root and a non-`true` entry value are ignored (R4); a session with no entry renders expanded (R5); and a single StrictMode click produces exactly one net toggle (R2) <!-- R1 R2 R3 R4 R5 -->
- [x] T005 Run the scoped Vitest suite for the sidebar (`app/frontend/src/components/sidebar/`) plus the frontend type check (`npx tsc --noEmit` in `app/frontend`) and fix any failures <!-- R1 R2 R3 R4 R5 -->

## Execution Order

- T001 blocks T002 and T003 (both consume the storage seam)
- T002 blocks T003 (the ref mirror is the handler's input)
- T004 depends on T001–T003; T005 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The Sidebar seeds `collapsed` from `runkit-session-collapsed` at mount, and a session listed `true` in the stored map renders collapsed on first paint
- [x] A-002 R2: Toggling a session to collapsed writes the exception into `runkit-session-collapsed`, with the write performed outside the `setCollapsed` updater
- [x] A-003 R3: Toggling a session back to expanded removes its key from the stored map, and an emptied map removes the localStorage key entirely
- [x] A-004 R4: Every localStorage read/write for this map is wrapped in try/catch with a silent fallback
- [x] A-005 R5: A session with no stored entry renders expanded — the `collapsed[sessionRowKey] ?? false` read sites are unchanged

### Behavioral Correctness

- [x] A-006 R2: Under `<StrictMode>` a single collapse click produces exactly one net toggle and one stored entry (no mss7-style self-cancelling double write)
- [x] A-007 R1: Remounting the Sidebar after a collapse restores the collapsed row without any further user action

### Scenario Coverage

- [x] A-008 R1: A unit test proves the hydrate-then-render path (stored entry → collapsed row, window rows absent)
- [x] A-009 R3: A unit test proves the expand path deletes the entry rather than storing `false`

### Edge Cases & Error Handling

- [x] A-010 R4: Malformed JSON, a non-object (array) root, and non-`true` entry values each degrade to all-expanded with no throw — each covered by a unit test
- [x] A-011 R4: A throwing `localStorage` (privacy mode / sandboxed iframe) does not break rendering or toggling

### Code Quality

- [x] A-012 Pattern consistency: The new storage seam follows the file's existing localStorage conventions (named key constant, try/catch silent fallback, JSDoc comment explaining the shape) and the tolerant-parse posture of `lib/compose-draft-store.ts`
- [x] A-013 No unnecessary duplication: No new generic storage abstraction is introduced where the local seam suffices, and no existing helper (`use-local-storage-boolean`, `use-local-storage-enum`) is reimplemented — those are scalar-valued and do not fit a keyed map
- [x] A-014 Named constants: The storage key is a named constant, not a magic string repeated at read/write sites (`fab/project/code-quality.md` § Anti-Patterns)
- [x] A-015 Type narrowing over assertions: The tolerant parse narrows `unknown` with `typeof`/`Array.isArray`/`=== true` guards rather than `as` casts (`fab/project/code-quality.md` § Principles)
- [x] A-016 Test coverage: The changed behavior ships with unit tests in the colocated `index.test.tsx` (`fab/project/code-quality.md` § Principles — "New features and bug fixes MUST include tests")
- [x] A-017 No polling / no server state: The change adds no `setInterval`, no fetch, and no backend state — the preference is client-only (Constitution II)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The rewritten
  `toggleSession` body (`sidebar/index.tsx`) replaced its own inline updater in place; no helper,
  branch, or storage key elsewhere in the repo lost its last call site. `use-local-storage-boolean.ts`,
  `use-local-storage-enum.ts`, and the per-server `runkit-panel-sessions-{server}` seam all keep
  their existing consumers and are NOT superseded by this map-valued seam.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Storage key `runkit-session-collapsed`, single JSON map of `true`-only exceptions | Specified verbatim in the intake (What Changes §1) with the example shape | S:95 R:90 A:95 D:95 |
| 2 | Certain | Side effects outside the state updater (StrictMode purity) | Intake decision 4; the exact failure mode and fix are documented in-code at `toggleServerSection` in the same file | S:90 R:85 A:100 D:95 |
| 3 | Confident | A `collapsedRef` synchronous mirror backs the toggle handler instead of the closure-captured `collapsed` state | Not specified by the intake, which only said "snapshot current → derive next → write → commit". React state is not readable until the next render, so two toggles batched into one render would write a map disagreeing with committed state. The ref is local, invisible outside the handler, and trivially reversible | S:60 R:95 A:90 D:80 |
| 4 | Confident | An emptied map removes the localStorage key rather than storing `{}` | Not specified by the intake. Mirrors `compose-draft-store.ts`'s `persist()` (empty → `removeItem`) and keeps "no exceptions" indistinguishable from "never used"; behaviorally identical on read either way | S:55 R:95 A:90 D:75 |
| 5 | Confident | Non-`true` entry values (strings, `false`, `null`) are dropped on read, not coerced | Intake says "values are normalized to `true`-only entries on read", which this implements literally; coercion would resurrect a `false` entry as an exception | S:70 R:95 A:90 D:85 |
| 6 | Confident | The storage-key constant is exported from `index.tsx` for the tests to reference | Not specified. Existing sidebar tests use string literals for the per-server keys, but `compose-draft-store.ts` exports its keys; exporting guards the tests against a silent rename. Zero runtime impact | S:50 R:100 A:90 D:80 |
| 7 | Certain | No e2e spec is added (unit coverage of the localStorage contract is sufficient) | Intake Impact section states the e2e is optional and unit coverage suffices; a new `.spec.ts` would also oblige a `.spec.md` companion per the constitution | S:85 R:90 A:95 D:90 |

7 assumptions (3 certain, 4 confident, 0 tentative).
