# Plan: Help Topics Submenu

**Change**: 260910-58al-help-topics-submenu
**Intake**: `intake.md`

## Requirements

### UI: Help topics registry

#### R1: Registry as pure data
`app/frontend/src/lib/help-topics.ts` (new) SHALL export `HELP_TOPICS: readonly HelpTopic[]` with exactly these six entries in this order, and the pure derivations `helpTopicActionId(topic) = "help-topic-" + topic.id` and `helpTopicPaletteLabel(topic) = "Help: " + topic.label`. The module MUST be dependency-free (no React, no DOM at import time) like `lib/palette/*.ts`.

| id | label | url | tool |
|----|-------|-----|------|
| `status-dot` | Status dot legend | `https://shll.ai/run-kit/status-dot/` | run-kit |
| `cron-schedule-kinds` | Cron schedule kinds | `https://shll.ai/run-kit/cron-schedule-kinds/` | run-kit |
| `boards` | Boards | `https://shll.ai/run-kit/boards/` | run-kit |
| `notifications` | Notifications | `https://shll.ai/run-kit/notifications/` | run-kit |
| `merge-topologies` | Merge topologies | `https://shll.ai/fab-kit/merge-topologies/` | fab-kit |
| `fkf` | FKF | `https://shll.ai/fab-kit/fkf/` | fab-kit |

- **GIVEN** the module is imported
- **WHEN** `HELP_TOPICS` is read
- **THEN** it has six entries, ids are unique, every `url` starts with `https://shll.ai/`, and `helpTopicActionId(HELP_TOPICS[0])` is `help-topic-status-dot`

### UI: Opening a topic

#### R2: Event seam with browser-tab fallback
`lib/help-topics.ts` SHALL export `HELP_TOPIC_EVENT = "rk:help-topic"` and `openHelpTopic(topic)`, which dispatches `new CustomEvent(HELP_TOPIC_EVENT, { detail: topic, cancelable: true })` on `window`. If a listener called `preventDefault()` (dispatch returned `false`) the topic was opened in-tile and nothing else happens. Otherwise `openHelpTopic` MUST fall back to `window.open(topic.url, "_blank", "noopener,noreferrer")`. This mirrors the `rk:operator-console` seam (`lib/operator-console.ts`): the root-mounted menu and the global palette have no window/layout state; the shell that does owns the in-tile behavior.

- **GIVEN** no listener is registered (board, server, or host mode)
- **WHEN** `openHelpTopic(topic)` runs
- **THEN** `window.open` is called once with `(topic.url, "_blank", "noopener,noreferrer")`

- **GIVEN** a listener that calls `preventDefault()`
- **WHEN** `openHelpTopic(topic)` runs
- **THEN** `window.open` is NOT called

#### R3: In-tile open in terminal mode
`AppShell` (`app.tsx`) SHALL register a `window` listener for `HELP_TOPIC_EVENT` while `windowParam` is set (terminal mode with a current window) and remove it on unmount or when `windowParam` clears. The handler MUST:

1. Call `event.preventDefault()` synchronously (so the fallback never fires).
2. `const { index } = await addWebTab(server, windowParam, topic.url)` (`src/api/client.ts`; the server dedupes an identical stored address and returns `existed: true` with the existing index).
3. Ensure a web surface is visible. If `!layout.order.includes("web")` and `addSurface(layout, "web")` is `null` (three tiles already, on any device), open `topic.url` via `window.open(topic.url, "_blank", "noopener,noreferrer")` and return. Otherwise on mobile (`isMobile`) call `switchToTile("web")`; on desktop, if the web surface is not in the layout, `applyLayout(addSurface(layout, "web"))`.
4. `await selectWebTab(server, windowParam, index)` so the topic is the active tab even when it already existed.
5. Route any rejection to `addToast(err.message || "Failed to open help topic")` via the existing `useToast()`.

- **GIVEN** terminal mode, layout `single:tty`, no web tabs
- **WHEN** the `Cron schedule kinds` topic is opened
- **THEN** `POST /api/windows/{id}/web` is called with the topic URL, the layout becomes `split-h:tty,web` (via `addSurface` → `applyLayout`), and `POST /api/windows/{id}/web/{n}/select` is called with the returned index

- **GIVEN** terminal mode and the layout already holds three tiles with no web surface
- **WHEN** a topic is opened
- **THEN** the tab is still added but the page opens in a new browser tab and no layout write happens

- **GIVEN** the topic URL is already a tab (`existed: true`)
- **WHEN** it is opened again
- **THEN** no second tab is added and the existing index is selected

### UI: Chevron menu

#### R4: `Help topics` disclosure row
`top-bar-overflow-menu.tsx` SHALL export `HelpTopicsMenuRow({ external })` rendering one disclosure row labelled `Help topics` with a trailing `▸` when collapsed and `▾` when expanded, `role="menuitem"`, `aria-expanded`, and `aria-controls` naming the group. Click, Enter, Space, and `ArrowRight` expand; `ArrowLeft` and a second activation collapse. Expanded, it renders one `role="menuitem"` row per `HELP_TOPICS` entry in registry order inside a `role="group"` container, indented one step, styled with `controlClass({ variant: "menu-row" })`. Each fab-kit row carries a trailing muted `fab-kit` tag. When `external` is true every topic row shows the `↗` glyph the `HelpMenuRow` uses; when false it shows none. Activating a topic row calls `openHelpTopic(topic)`; the menu container's existing menuitem-click dismissal then closes the menu (the disclosure row itself is marked `data-menu-disclosure` so expanding it does NOT dismiss the menu). The expanded state is component-local and therefore resets whenever the menu unmounts (the menu closes).

- **GIVEN** the chevron menu is open in terminal mode
- **WHEN** the user clicks `Help topics`
- **THEN** six rows appear under it, `aria-expanded` is `true`, none shows `↗`, and the two fab-kit rows show the `fab-kit` tag

- **GIVEN** the disclosure is expanded
- **WHEN** the user presses `ArrowLeft`
- **THEN** the six rows are removed and `aria-expanded` is `false`

- **GIVEN** the disclosure is expanded and the user clicks `Boards`
- **WHEN** the click handler runs
- **THEN** `openHelpTopic` is called with the boards topic and the menu closes via the container's menuitem-click dismissal

#### R5: Registry wiring in the App section
`top-bar.tsx` SHALL register a `menuOnly: true`, `menuGroup: "app"` control with id `help-topics` immediately after the existing `help` entry (before `keyboard`), on the same `modes` list (`terminal`, `board`, `server`, `host`), with `barRender: () => null` and `menuRender: () => <HelpTopicsMenuRow external={mode !== "terminal"} />` (`menuRender` takes no arguments; rows rely on the container's menuitem-click dismissal like `HelpMenuRow`/`KeyboardMenuRow`). The existing `help` and `keyboard` entries MUST be unchanged.

- **GIVEN** any mode
- **WHEN** the chevron menu opens
- **THEN** the App section shows `Help — run-kit docs`, then `Help topics ▸`, then `Keyboard shortcuts`, in that order

### UI: Command palette

#### R6: One palette action per topic
`use-global-palette-actions.ts` SHALL add `helpTopicActions = HELP_TOPICS.map(t => ({ id: helpTopicActionId(t), label: helpTopicPaletteLabel(t), onSelect: () => openHelpTopic(t) }))` and fold it into the returned list immediately after `shortcutsEntry`. No keybinding is registered for any of them.

- **GIVEN** the palette is open
- **WHEN** the user types `Help:`
- **THEN** `Help: Documentation`, `Help: Keyboard Shortcuts`, and the six `Help: <label>` entries are listed, and selecting `Help: FKF` calls `openHelpTopic` with the fkf topic

### Non-Goals

- No backend, API, route, or tmux-option change — `POST /api/windows/{id}/web` and `/web/{n}/select` are used as they are.
- No change to `Help — run-kit docs` (still opens `HELP_URL` in a browser tab) or `Keyboard shortcuts`.
- No nested flyout popover; no persistence of the disclosure state; no keyboard chords for topics.
- The e2e spec does not assert the remote page's content (no network dependency), only the tab and layout.

### Design Decisions

#### Custom-event seam between root chrome and the shell
**Decision**: `openHelpTopic` dispatches a cancelable `rk:help-topic` window event; `AppShell` handles it in-tile when a window is current, and the dispatcher falls back to a browser tab when nobody cancels it.
**Why**: the chevron menu and the global palette hook mount at the root with no access to `layout`, `applyLayout`, `switchToTile`, or the current window; those live in `AppShell`. The seam lets one helper serve both entry points without lifting layout state to the root or duplicating actions with the same id in two palette providers.
**Rejected**: duplicating the topic actions in `AppShell`'s own palette list (two providers would emit the same ids in terminal mode); lifting layout state into a context solely for this (a larger refactor than the feature).
*Introduced by*: 260910-58al-help-topics-submenu

#### Inline disclosure instead of a flyout submenu
**Decision**: a `Help topics ▸` row expands in place inside the single `role="menu"` list.
**Why**: the overflow menu has no submenu primitive; a second popover needs positioning, outside-click, and focus-trap code and behaves poorly on coarse pointers. Six rows expanded in place keep the menu compact when collapsed.
**Rejected**: a flat always-visible section (nine App rows on every open); a nested popover (new primitive for one use).
*Introduced by*: 260910-58al-help-topics-submenu

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/help-topics.ts` exporting `HelpTopic`, `HELP_TOPICS` (six entries per R1), `helpTopicActionId`, `helpTopicPaletteLabel`, `HELP_TOPIC_EVENT`, and `openHelpTopic` with the cancelable-event dispatch and `window.open` fallback <!-- R1, R2 -->
- [x] T002 [P] Create `app/frontend/src/lib/help-topics.test.ts`: six entries, unique ids, `https://shll.ai/` prefix, label/id derivations, `openHelpTopic` calls `window.open` when uncancelled and does not when a listener calls `preventDefault()` <!-- R1, R2 -->

### Phase 2: Core Implementation

- [x] T003 In `app/frontend/src/components/top-bar-overflow-menu.tsx` add `HelpTopicsMenuRow({ external, onClose })` per R4 (disclosure row, keyboard handling, `role="group"` of topic rows, `fab-kit` tag, `↗` only when `external`, `openHelpTopic` + `onClose` on activation) reusing `controlClass({ variant: "menu-row" })` and the `HelpMenuRow` glyph conventions <!-- R4 -->
- [x] T004 In `app/frontend/src/components/top-bar.tsx` register the `help-topics` registry entry right after `help` per R5, passing `external={mode !== "terminal"}` and the menu's shared close handler; leave `help` and `keyboard` untouched <!-- R5 -->
- [x] T005 In `app/frontend/src/app.tsx` (`AppShell`, beside `switchToTile`) add the `HELP_TOPIC_EVENT` listener per R3: `preventDefault`, `addWebTab`, mobile `switchToTile("web")` / desktop `addSurface` → `applyLayout` with the full-layout `window.open` fallback, `selectWebTab`, toast on error; register only while `windowParam` is set <!-- R3 -->
- [x] T006 In `app/frontend/src/hooks/use-global-palette-actions.ts` add `helpTopicActions` per R6 and fold them in after `shortcutsEntry` (update the `useMemo` dependency lists) <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Extend `app/frontend/src/components/top-bar-overflow-menu.test.tsx` with a `HelpTopicsMenuRow` describe: collapsed by default; click expands to six `menuitem` rows with `aria-expanded="true"`; `ArrowLeft` collapses; `external={false}` renders no `↗` while `external={true}` renders it on every topic row; the two fab-kit rows carry the `fab-kit` tag; clicking `Boards` calls a mocked `openHelpTopic` with the boards topic and the menu unmounts <!-- R4 -->
- [x] T008 [P] Extend `app/frontend/src/hooks/use-global-palette-actions.test.tsx`: the returned list contains six actions with ids `help-topic-<id>` and labels `Help: <label>`, and selecting `help-topic-fkf` calls `openHelpTopic` with the fkf topic <!-- R6 -->
- [x] T009 Add `app/frontend/tests/e2e/help-topics.spec.ts` with the constitution's file header and per-test **Proves / Steps** JSDoc: in terminal mode open the chevron (`getByRole("button", { name: "More controls" })`), click `Help topics`, click `Cron schedule kinds`, then assert the web tab strip (`data-testid="web-tab-strip"`) shows a tab for `https://shll.ai/run-kit/cron-schedule-kinds/` and the layout now includes a web surface; do not assert iframe content. Run via `just test-e2e "help-topics"` only <!-- R3, R4 -->

### Phase 4: Polish

- [x] T010 Run `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and `just test-e2e "help-topics"`; fix anything that fails <!-- R1 -->

## Execution Order

- T001 blocks T003, T005, T006 (they import from `lib/help-topics.ts`)
- T003 blocks T004 and T007
- T005 and T006 are independent of each other
- T009 depends on T003–T006

## Acceptance

### Functional Completeness

- [x] A-001 R1: `HELP_TOPICS` has the six specified entries in order with unique ids and `https://shll.ai/` URLs; `helpTopicActionId`/`helpTopicPaletteLabel` derive `help-topic-<id>` / `Help: <label>`
- [x] A-002 R2: `openHelpTopic` dispatches a cancelable `rk:help-topic` event and falls back to `window.open(url, "_blank", "noopener,noreferrer")` only when uncancelled
- [x] A-003 R3: `AppShell` handles the event while a window is current: adds the web tab, ensures a web surface (mobile via `switchToTile`, desktop via `addSurface`/`applyLayout`), selects the tab, and toasts on error
- [x] A-004 R4: `HelpTopicsMenuRow` renders the disclosure and, expanded, six topic rows with the specified ARIA, keyboard, tag, and `↗` behavior
- [x] A-005 R5: the App section order is `Help — run-kit docs`, `Help topics`, `Keyboard shortcuts` in every mode; `help` and `keyboard` entries are unchanged
- [x] A-006 R6: six `Help: <label>` palette actions exist with ids `help-topic-<id>`, no keybindings

### Behavioral Correctness

- [x] A-007 R3: with a full three-tile layout and no web surface, opening a topic still adds the tab, performs no layout write, and opens a browser tab instead
- [x] A-008 R3: re-opening a topic already present as a tab adds no second tab and selects the existing index
- [x] A-009 R4: topic rows show `↗` outside terminal mode and none inside it

### Scenario Coverage

- [x] A-010 R4: unit tests cover expand/collapse via click and arrow keys, tag rendering, external glyph gating, and activation calling `openHelpTopic` with the menu then closing
- [x] A-011 R2: unit tests cover both branches of `openHelpTopic` (cancelled vs. fallback)
- [x] A-012 R3: an e2e spec, run through `just test-e2e`, verifies the tab address and the layout gaining a web surface without asserting remote content, with the required Proves/Steps JSDoc

### Edge Cases & Error Handling

- [x] A-013 R3: a rejected `addWebTab` (e.g. the family-cap 409) surfaces its `error` text through the toast and leaves the layout unchanged
- [x] A-014 R3: the listener is removed when `AppShell` unmounts or `windowParam` clears, so board/server/host modes take the fallback

### Code Quality

- [x] A-015 Pattern consistency: registry is a pure `lib/` module with colocated tests; rows reuse `controlClass({ variant: "menu-row" })`; the event seam mirrors `lib/operator-console.ts`
- [x] A-016 No unnecessary duplication: `addWebTab`, `selectWebTab`, `addSurface`, `applyLayout`, `switchToTile`, `useToast` are reused, none reimplemented
- [x] A-017 Type narrowing over assertions: no `as` casts introduced beyond `event as CustomEvent<HelpTopic>` narrowing guarded by an `instanceof CustomEvent` check
- [x] A-018 No magic strings: event name, action-id prefix, and palette-label prefix are named constants/derivations in `lib/help-topics.ts`
- [x] A-019 Constitution V: every new menu action has a palette twin
- [x] A-020 Tests exist for the added behavior (unit + e2e) and the e2e test carries the Proves/Steps intent comment and file header

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. `HelpMenuRow` / `HELP_URL` (`components/global-chrome.tsx`) stay as the docs-root entry by design; `webAddShow` (Go, `rk present`) remains the CLI/agent path and is not superseded by the frontend event seam.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Root-to-shell handoff via a cancelable `rk:help-topic` window event with browser-tab fallback | The intake left the open action's home open ("`app.tsx`, or a hook"); the root-mounted menu/palette hold no layout state; `rk:operator-console` is the in-repo precedent | S:60 R:85 A:80 D:65 |
| 2 | Confident | `external` glyph gating computed in `top-bar.tsx` from `mode !== "terminal"` | The registry closure already knows `mode`; rows stay presentational | S:65 R:90 A:85 D:75 |
| 3 | Confident | Full-layout case still adds the tab, then opens a browser tab | Intake says "fall through to the fallback instead of silently no-oping"; adding the tab first keeps the URL reachable in-tile later | S:60 R:85 A:75 D:60 |
| 4 | Certain | `just test-e2e "help-topics"` is the only way the e2e spec runs | context.md forbids direct Playwright runs | S:90 R:95 A:100 D:100 |

4 assumptions (1 certain, 3 confident, 0 tentative).
