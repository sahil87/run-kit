# Plan: Sessions-Pane Scope Toggle — Delink from SERVER Pane Expansion

**Change**: 260720-rzg7-sessions-scope-toggle-delink
**Intake**: `intake.md`

## Requirements

### Sidebar: Explicit Sessions-Scope State

#### R1: Persisted scope state, decoupled from the SERVER panel
The sidebar's sessions-pane scope MUST be an explicit persisted state — localStorage key `runkit-panel-sessions-scope`, values `all | current`, default `all` — with NO migration from the old `runkit-panel-server` coupling. Any unrecognized stored value MUST be treated as `all`. The state MUST live behind a string/enum-typed localStorage hook (a sibling of `useLocalStorageBoolean` with the same in-module pub/sub + cross-tab `storage`-event reactivity) so the header chip, the session list, and the command-palette entry observe the same value reactively.

- **GIVEN** a fresh profile (no `runkit-panel-sessions-scope` key)
- **WHEN** the sidebar renders
- **THEN** the scope is `all` and every server's session group renders
- **GIVEN** `localStorage["runkit-panel-sessions-scope"] = "bogus"`
- **WHEN** the sidebar renders
- **THEN** the scope behaves as `all`

#### R2: SERVER panel defaults open; expansion fully decoupled
`ServerPanel`'s `CollapsiblePanel` MUST flip `defaultOpen={false}` → `defaultOpen={true}` (`server-panel.tsx:126`). The SERVER panel's expansion state MUST NOT affect the session list in any way: all three `serverPaneOpen` uses in `sidebar/index.tsx` (`:1126` filter, `:1133` hint, `:1159` force-open) plus the `useLocalStorageBoolean("runkit-panel-server", false)` read at `:124` and its stale comment block (`:118-124`) MUST be removed.

- **GIVEN** scope `all` and the SERVER panel expanded
- **WHEN** the user collapses or expands the SERVER panel
- **THEN** the sessions tree renders the same server groups either way

#### R3: `current` scope filtering with fallback-to-all
When scope is `current` AND `currentServer` resolves to a server present in the `servers` list, the sessions tree MUST render only that server's group and MUST force it open (`isOpen=true`, render-time only — persisted per-server keys untouched). When `currentServer === null` (board route) OR the current server is missing from the list (stale/deleted route param), the tree MUST fall back to rendering all servers. The "Select a server above to see its sessions." hint MUST be removed entirely. In `all` scope, per-server collapse state (`runkit-panel-sessions-{server}` via `readServerOpen`) carries forward unchanged.

- **GIVEN** scope `current` on route `/$server` with that server in the list
- **WHEN** the sidebar renders
- **THEN** exactly one `ServerGroup` (the current server's) renders, forced open
- **GIVEN** scope `current` on a board route (`currentServer === null`)
- **WHEN** the sidebar renders
- **THEN** all servers' groups render (no hint, no dead-end)

#### R4: Scope toggle chip in the SESSIONS header
A keyboard-focusable toggle button MUST render at the right edge of the hand-rolled SESSIONS header div (`index.tsx:1107-1114`), after the current-session name — no refactor to `CollapsiblePanel`. It MUST read clearly at rest showing the active scope (small monospace text chip, `ALL`/`CUR` style), follow the existing header-button idiom (`text-text-secondary hover:text-text-primary`), and clicking it MUST flip the scope (`all` ⇄ `current`) via the shared hook (persisting the value).

- **GIVEN** scope `all`
- **WHEN** the user clicks the chip
- **THEN** the stored scope becomes `current`, the chip reads the new scope, and the tree narrows in the same tab (sibling-subscriber reactivity)

#### R5: Command palette entry
A palette action MUST flip the scope (`all` ⇄ `current`), registered in `app.tsx`'s `paletteActions` composition following the existing action-block pattern and the `Noun: Verb` label idiom (Constitution V — keyboard reachability, palette as primary discovery).

- **GIVEN** the command palette is open
- **WHEN** the user selects the sessions-scope action
- **THEN** the scope flips and persists, and the sidebar tree updates reactively

#### R6: Tests updated to the new behavior (with `.spec.md` companions)
Unit tests MUST be rewritten around the new scope key/behavior: `sidebar/index.test.tsx` (scope filtering, board-route fallback-to-all, chip toggle, default `all`, delink-from-SERVER-panel regression) and `server-panel.test.tsx` (`defaultOpen={true}`). E2E: `sidebar-server-coupling.spec.ts` (three old-coupling tests) is superseded — replaced by scope-toggle coverage (toggle narrows/restores, persistence across reload) with its sibling `.spec.md` companion updated in the same change; `server-panel-grid.spec.ts` expand-clicks MUST be adjusted for default-open (clicks at lines 48/69/85/105/120 would now collapse) with its `.spec.md` updated (Constitution: Test Companion Docs).

- **GIVEN** the changed specs
- **WHEN** `just test-frontend` and the affected `just test-e2e` specs run
- **THEN** they pass, and every modified `.spec.ts` has its `.spec.md` companion updated in the same change

### Non-Goals

- No migration from `runkit-panel-server` to the new scope key (explicitly declined by the user — the old bit encodes panel visibility, not scope intent).
- No fix for the pre-existing attachServer→SSE async race on expanding a non-current server's group (multi-server-sidebar e2e — known, unfixed, not caused by this change).
- No backend, API, or route changes; no new pages (Constitution IV).
- No `CollapsiblePanel` refactor of the SESSIONS header.

### Design Decisions

#### Scope state as a generic enum-typed localStorage hook
**Decision**: Add `useLocalStorageEnum<T extends string>(storageKey, defaultValue, allowedValues)` as a generic sibling of `useLocalStorageBoolean` (same pub/sub + `storage`-event mechanics, unrecognized values → default), plus a thin `useSessionsScope()` wrapper (`hooks/use-sessions-scope.ts`) exporting the `SessionsScope` type and key constant.
**Why**: The sidebar chip, session list, and app.tsx palette entry are cross-component siblings needing one reactive source; a generic hook mirrors the established pattern and keeps the scope vocabulary in one importable home.
**Rejected**: Encoding scope as a boolean in the existing hook (values are semantically `all|current`, not true/false); duplicating pub/sub logic in a scope-specific hook (needless divergence from the boolean sibling).
*Introduced by*: 260720-rzg7-sessions-scope-toggle-delink

#### E2E spec renamed to match its new contract
**Decision**: Replace `sidebar-server-coupling.spec.ts`/`.spec.md` with `sessions-scope-toggle.spec.ts`/`.spec.md` (delete old pair, create new pair) rather than rewriting under the old name.
**Why**: The old name asserts the coupling this change deletes; a spec named "server-coupling" whose body proves decoupling is a maintenance trap.
**Rejected**: Rewriting in place under the stale name — misleading; keeping both — the old contract no longer exists.
*Introduced by*: 260720-rzg7-sessions-scope-toggle-delink

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/hooks/use-local-storage-enum.ts` — generic enum-typed sibling of `useLocalStorageBoolean` (same in-module pub/sub, `storage` event, try/catch localStorage access); unrecognized stored values return the default. Create `app/frontend/src/hooks/use-sessions-scope.ts` — `SESSIONS_SCOPE_KEY = "runkit-panel-sessions-scope"`, `type SessionsScope = "all" | "current"`, `useSessionsScope()` defaulting to `all` <!-- R1 -->
- [x] T002 [P] Unit-test the new hook in `app/frontend/src/hooks/use-local-storage-enum.test.ts` — default when unset, persisted value read, unrecognized value → default, setter persists + notifies sibling subscribers in the same tab <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 In `app/frontend/src/components/sidebar/index.tsx`: delete the `serverPaneOpen` read + stale comment (`:118-124`) and the `useLocalStorageBoolean` import if now unused; add `useSessionsScope()`; replace the `visibleServers` filter (`:1126`) with scope-based filtering including fallback-to-all when `currentServer` is null or missing from `servers`; delete the hint branch (`:1133-1135`); replace the force-open ternary (`:1159`) with the scope-based condition <!-- R3 -->
- [x] T004 In `app/frontend/src/components/sidebar/index.tsx` SESSIONS header (`:1107-1114`): add the scope toggle chip at the right edge after the current-session name — small monospace text chip showing `ALL`/`CUR`, `text-text-secondary hover:text-text-primary`, keyboard-focusable, stable accessible name, click flips scope via `useSessionsScope` setter <!-- R4 -->
- [x] T005 [P] In `app/frontend/src/components/sidebar/server-panel.tsx`: flip `defaultOpen={false}` → `defaultOpen={true}` (line 126) <!-- R2 -->
- [x] T006 [P] In `app/frontend/src/app.tsx`: add a `sessionsScopeActions` block using `useSessionsScope()` — single toggle entry labeled by target (`Sessions: Show current server only` when scope is `all`, `Sessions: Show all servers` when `current`) — and compose it into `paletteActions` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Rewrite the coupling describe-block in `app/frontend/src/components/sidebar/index.test.tsx` around scope behavior: default `all` renders all groups; `current` scope narrows + force-opens; board-route (`currentServer: null`) and missing-server fallback-to-all (hint absent); unrecognized stored value → `all`; chip click toggles + persists + narrows in the same tab; SERVER panel open state (`runkit-panel-server=true`) no longer filters the tree (delink regression); persisted per-server collapse keys not overwritten by force-open; "No servers" empty state retained <!-- R6 -->
- [x] T008 [P] Update `app/frontend/src/components/sidebar/server-panel.test.tsx` for `defaultOpen={true}`: panel starts open (grid visible without clicking); seed `runkit-panel-server=false` where a collapsed start is needed; rework "opening the panel triggers onRefreshServers" to open from a seeded-collapsed state; add an explicit default-open assertion <!-- R2, R6 -->
- [x] T009 Replace `app/frontend/tests/e2e/sidebar-server-coupling.spec.ts` + `.spec.md` with `app/frontend/tests/e2e/sessions-scope-toggle.spec.ts` + `.spec.md`: (a) chip toggle to `current` narrows the tree to the current server, toggle back restores all groups; (b) scope persists across reload; (c) SERVER panel collapse/expand no longer changes the rendered groups (delink). Companion `.spec.md` documents what-it-proves + steps per test <!-- R6 -->
- [x] T010 [P] Update `app/frontend/tests/e2e/server-panel-grid.spec.ts` for default-open: remove the now-inverting expand clicks (lines 48/69/85/105/120), keeping each test's assertions valid from the default-open state; update `server-panel-grid.spec.md` steps accordingly <!-- R6 -->

### Phase 4: Polish

- [x] T011 Run `just test-frontend` (unit) and the affected e2e specs via `just test-e2e "sessions-scope-toggle"` and `just test-e2e "server-panel-grid"`; run `npx tsc --noEmit` type check (via the frontend build check); fix any failures <!-- R6 -->

## Execution Order

- T001 blocks T002, T003, T004, T006
- T003 blocks T004 (same file, sequential) and T007
- T005 blocks T008 and T010
- T009/T010 after T003–T006 (behavior must exist before e2e)

## Acceptance

### Functional Completeness

- [x] A-001 R1: Scope persists under `runkit-panel-sessions-scope` (`all|current`, default `all`) via an enum-typed localStorage hook with sibling-subscriber reactivity; no migration code reads the old coupling
- [x] A-002 R2: `ServerPanel` has `defaultOpen={true}` and no sidebar code path reads `runkit-panel-server` outside `CollapsiblePanel`'s own persistence
- [x] A-003 R3: `current` scope renders exactly the current server's group force-opened; `all` scope renders every group with per-server collapse state unchanged
- [x] A-004 R4: The SESSIONS header carries a keyboard-focusable scope chip, readable at rest, that flips and persists the scope on click
- [x] A-005 R5: A `Sessions:`-prefixed palette action flips the scope and is composed into `paletteActions` in `app.tsx`

### Behavioral Correctness

- [x] A-006 R2: Toggling the SERVER panel open/closed leaves the sessions tree's rendered groups unchanged (delink verified by unit test)
- [x] A-007 R3: On a board route (or stale server param) with scope `current`, all servers' groups render — never an empty pane or hint

### Removal Verification

- [x] A-008 R2: All three `serverPaneOpen` uses, the `:124` read, and the `:118-124` comment block are gone from `index.tsx`
- [x] A-009 R3: No production code path renders "Select a server above to see its sessions." — the only remaining occurrences are the unit test's negative assertion and the `.spec.md` supersession note

### Scenario Coverage

- [x] A-010 R6: Unit tests cover default-`all`, `current` narrowing + force-open, fallback-to-all, unrecognized-value, chip toggle, and the delink regression
- [x] A-011 R6: E2E covers chip narrow/restore, reload persistence, and SERVER-panel delink; every modified/added `.spec.ts` has an updated sibling `.spec.md` in this change

### Edge Cases & Error Handling

- [x] A-012 R1: localStorage access is try/catch-guarded (SSR/privacy mode) in the new hook, mirroring `useLocalStorageBoolean`
- [x] A-013 R3: Empty server list still renders the "No servers" empty state regardless of scope

### Code Quality

- [x] A-014 Pattern consistency: New hook mirrors `useLocalStorageBoolean` structure; chip follows header-button idioms; palette block follows existing composition patterns
- [x] A-015 No unnecessary duplication: Pub/sub mechanics shared via the generic hook, not copy-pasted; no re-derived magic strings (key/type exported from one home)
- [x] A-016 New/changed behavior has test coverage (unit + e2e per code-quality.md); no client polling introduced (reactivity via the hook pub/sub, not intervals)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change already deleted everything it made redundant: the `serverPaneOpen` read + stale comment block (`sidebar/index.tsx`), the "Select a server above…" hint branch, and the superseded `tests/e2e/sidebar-server-coupling.spec.ts` + `.spec.md` pair. No further files, functions, branches, or config were left orphaned by this change (`useLocalStorageBoolean` remains in use by `ServerPanel`'s own `CollapsiblePanel` persistence).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Generic `useLocalStorageEnum` + thin `useSessionsScope` wrapper (two small hook files) rather than a one-off string hook | Intake explicitly allows "sibling (or generic)"; generic mirrors the boolean sibling and gives the scope vocabulary one importable home for chip/list/palette | S:70 R:90 A:85 D:70 |
| 2 | Confident | Chip renders `ALL`/`CUR` monospace text with a stable accessible name (`aria-label="Toggle sessions scope"`) + title tooltip | Intake delegates exact rendering to implementer judgment within the visible-at-rest constraint; stable name keeps tests/AT robust across state flips | S:65 R:90 A:80 D:65 |
| 3 | Confident | Single palette toggle entry labeled by target state (`Sessions: Show current server only` / `Sessions: Show all servers`) | Intake offers single-toggle vs two entries at implementer's judgment; a target-labeled toggle matches `Noun: Verb` and is findable under both phrasings | S:65 R:90 A:80 D:65 |
| 4 | Confident | Old e2e pair deleted and replaced by `sessions-scope-toggle.spec.ts` + `.spec.md` (rename, not in-place rewrite) | Intake says the old spec "is superseded — replace with scope-toggle coverage"; the old filename names the deleted contract, and the change slug matches the new name | S:60 R:85 A:80 D:70 |
| 5 | Certain | `top-bar-persistence.spec.ts` needs no change — its "Tmux servers" query targets the Host page's `region` (`host-overview-page.tsx:320`), not the sidebar listbox | Verified by grep during apply; intake listed it only as "possibly" affected | S:85 R:95 A:95 D:90 |
| 6 | Confident | The delink e2e assertion (SERVER panel toggle leaves tree unchanged) is added to the new scope spec rather than a separate file | Cheap, directly proves the change's headline claim end-to-end; belongs with the scope coverage | S:60 R:90 A:85 D:75 |

6 assumptions (1 certain, 5 confident, 0 tentative).
