# Plan: New Session Inline Name Prompt

**Change**: 260823-qe3n-new-session-inline-name-prompt
**Intake**: `intake.md`

## Requirements

### Frontend: Session Name Prompt Component

#### R1: Prefilled inline name prompt
A new lightweight prompt component (`app/frontend/src/components/session-name-prompt.tsx`) SHALL render as a small modal on the shared `Dialog` shell (`size="sm"`, focus trap, Escape-close, backdrop-close) with a single text input and MUST open pre-filled with `deriveInstantSessionName(currentWindow?.worktreePath, existingNames)` — the exact name today's instant create would use — computed at open time. The prefilled text MUST be focused and select-all'd on mount so typing replaces it in one gesture.

- **GIVEN** a window route with an active window whose cwd is `~/code/sahil87/run-kit`
- **WHEN** the prompt opens
- **THEN** the input shows `run_kit` (or the deduped `run_kit-2`…) fully selected
- **AND** pressing Enter immediately creates a session with that exact name (today's behavior plus one keystroke)

#### R2: Input semantics — Enter, typing, Escape, empty, collision
The prompt SHALL implement: Enter submits the current value; typed input converts live via `toSafeSessionName` and is finalized with `finalizeSafeName` at submit (the CreateSessionDialog conversion pair from `@/lib/names`); Escape (and backdrop click) closes without creating anything; an empty (trimmed) value MUST NOT submit; a value colliding with an existing session name on the target server MUST NOT submit and SHOULD show the collision inline (the CreateSessionDialog collision-check pattern).

- **GIVEN** the prompt is open with the default name selected
- **WHEN** the user types `api work` and presses Enter
- **THEN** a session named `api_work` is created (live-converted), and no second session is created on a rapid repeat submit
- **GIVEN** the prompt is open
- **WHEN** the user presses Escape
- **THEN** the prompt closes and no session is created

### Frontend: Entry-Point Wiring

#### R3: One flow, two entry points — chord and palette
The palette action `Session: Create` (id `create-session`) in `app.tsx`'s `sessionActions` SHALL open the prompt instead of calling `handleCreateSessionInstant`. The `create-session` keybinding registry row in `lib/keybindings.ts` MUST remain byte-unchanged (no new binding, no second chord, no "Create session with name…" action): the chord already resolves through `fromPalette("create-session")`, so swapping the one palette body covers both entry points. The prompt's open state MUST fold into the `dialogOpenRef` predicate like every other dialog.

- **GIVEN** the mac shell (⇧⌘T) or Win/Linux (⇧Ctrl+N)
- **WHEN** the chord fires (or `Session: Create` is selected in the palette, including on mobile)
- **THEN** the same prompt opens with the prefilled name
- **AND** `lib/keybindings.ts` shows no diff for the `create-session` row's binding data

#### R4: Submit reuses the instant-create plumbing; other entry points unchanged
Submit SHALL call the existing `executeCreateSessionInstant(server, name, cwd)` optimistic action (ghost session, rollback, error toast) with the prompt's finalized name and the same `currentWindow?.worktreePath || undefined` cwd the instant path passes today, respecting the `isSessionCreatePending` guard. The sidebar `+` (`handleSidebarCreateSession`, both branches), the SessionTiles "+ New Session" tile, the board-page `+`, and `Session: Create at Folder`/`CreateSessionDialog` MUST remain behaviorally unchanged.

- **GIVEN** the prompt submits a name
- **WHEN** the POST is in flight
- **THEN** the ghost session appears optimistically and an error rolls it back with a toast, exactly as instant create does today
- **GIVEN** the sidebar server-header `+`
- **WHEN** clicked
- **THEN** a session is created instantly with the auto-derived name — no prompt

### Tests

#### R5: Unit and e2e coverage with companion doc
The component SHALL ship colocated unit tests (`session-name-prompt.test.tsx`: prefill+select-all, Enter accepts default, typed override with live conversion, empty no-op, collision block, Escape cancel) and a Playwright e2e exercising palette → prompt → Enter-accepts-default and typed-override paths, with the constitutionally required sibling `.spec.md` updated in the same commit.

- **GIVEN** the e2e suite
- **WHEN** the new spec runs on the isolated :3020 harness
- **THEN** both the default-accept and typed-override creations are asserted via the sidebar/session list

### Non-Goals

- No path selection in the prompt — `Session: Create at Folder` remains the path flow (kept as-is; its potential removal is a separate analysis handed to the user)
- No shortcuts-help-panel or palette descriptor copy rewrites (sibling-change overlap — see intake § Overlap With Sibling Change)
- No board-route chord handler (none exists today; unchanged)

### Design Decisions

#### Prompt rides the shared Dialog shell
**Decision**: Build the prompt on `components/dialog.tsx` (`size="sm"`) rather than a bespoke quick-input overlay.
**Why**: The shell already provides the focus trap, Escape-close, backdrop, elevation, and a11y contract; a "small inline input" is a content decision, not a shell decision. Second-surface rule: reuse, don't rebuild.
**Rejected**: A custom palette-style floating input — new focus/escape/a11y surface for zero behavioral gain.
*Introduced by*: 260823-qe3n-new-session-inline-name-prompt

#### Body swap at the palette action, not a new handler path
**Decision**: Change only the `create-session` palette action's `onSelect`; the chord keeps resolving via `fromPalette("create-session")`.
**Why**: "One flow, two entry points" falls out by construction — the chord and palette can never drift, and the keybindings registry is untouched (minimizing sibling-change overlap).
**Rejected**: A separate chord handler beside the palette body — duplicates the flow and widens the overlap surface.
*Introduced by*: 260823-qe3n-new-session-inline-name-prompt

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/frontend/src/components/session-name-prompt.tsx`: `Dialog size="sm"`-based prompt taking `{ sessions, defaultName, onSubmit, onClose }` (or equivalent); input initialized to `defaultName`, autofocused + select-all'd; live `toSafeSessionName` conversion; Enter submits `finalizeSafeName(value.trim())` when non-empty and non-colliding; inline collision hint + disabled submit on collision; Escape/backdrop close via the Dialog shell <!-- R1, R2 -->
- [x] T002 Wire into `app/frontend/src/app.tsx`: lazy import + Suspense mount (the `CreateSessionDialog` pattern), `showSessionNamePrompt` state folded into `dialogOpenRef`, compute `defaultName` at open time via `deriveInstantSessionName(currentWindowRef.current?.worktreePath, sessionsRef.current.map(s => s.name))`, swap the `create-session` palette action's `onSelect` to open the prompt, submit → `executeCreateSessionInstant(server, name, cwd)` guarded by `isSessionCreatePendingRef` <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T003 [P] Colocated unit tests `app/frontend/src/components/session-name-prompt.test.tsx`: prefill + select-all, Enter accepts default, typed override live-converts, empty-submit no-op, collision blocks submit with hint, Escape calls onClose without onSubmit <!-- R2, R5 -->
- [x] T004 [P] Playwright e2e (new or extended session-creation spec under `app/frontend/tests/`): palette `Session: Create` → prompt visible with prefilled name → Enter creates that session; reopen → type override → Enter creates the typed name; Escape creates nothing. Update/create the sibling `.spec.md` companion in the same commit <!-- R5 -->

### Phase 4: Polish

- [x] T005 Verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "<new-spec>"`; confirm `git diff lib/keybindings.ts` is empty <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Prompt opens prefilled with the exact `deriveInstantSessionName` result, focused and select-all'd
- [x] A-002 R3: Both the chord (via `fromPalette`) and the palette `Session: Create` open the same prompt; `lib/keybindings.ts` binding data unchanged
- [x] A-003 R4: Submit flows through `executeCreateSessionInstant` with the same cwd semantics as today's instant create

### Behavioral Correctness

- [x] A-004 R1: Enter on the untouched default creates the identical session today's instant path would have created
- [x] A-005 R2: Typed input live-converts via `toSafeSessionName` and submits finalized via `finalizeSafeName`; empty and colliding values do not submit
- [x] A-006 R4: Sidebar `+`, SessionTiles tile, board `+`, and `Session: Create at Folder` behave exactly as before (no prompt)

### Scenario Coverage

- [x] A-007 R2: Escape (and backdrop click) closes without creating a session — covered by unit test
- [x] A-008 R5: Unit tests cover all six input arms; e2e covers default-accept and typed-override end to end with the `.spec.md` companion updated

### Edge Cases & Error Handling

- [x] A-009 R4: A create error rolls back the ghost session and surfaces a toast (existing optimistic path exercised, not reimplemented); pending guard prevents double-create on rapid re-submit

### Code Quality

- [x] A-010 Pattern consistency: prompt follows the CreateSessionDialog/SpawnAgentDialog conventions (lazy import, Suspense, Dialog shell, text-xs field styling, dialogOpenRef fold)
- [x] A-011 No unnecessary duplication: name derivation/conversion reuses `deriveInstantSessionName` + `@/lib/names`; no new creation plumbing beside `executeCreateSessionInstant`
- [x] A-012 Type narrowing over assertions: no new `as` casts in the prompt or wiring
- [x] A-013 Tests included for added behavior (unit + e2e per code-quality mandate); no client polling introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a prompt in front of the palette/chord create flow without making existing code redundant: `handleCreateSessionInstant`/`executeCreateSessionInstant` remain the live path for the sidebar `+`, SessionTiles tile, and board `+` entry points, and `deriveInstantSessionName` gains a second caller.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Build on the shared `Dialog` shell (`size="sm"`) rather than a bespoke quick-input overlay | Second-surface rule; shell owns trap/Escape/a11y; intake assumption 2 refined | S:60 R:85 A:80 D:65 |
| 2 | Confident | Collision with an existing session name blocks submit with an inline hint (CreateSessionDialog pattern) rather than auto-suffixing | The prompt exists to honor an explicit name; silently mutating it defeats the point; matches the sibling dialog | S:50 R:85 A:75 D:60 |
| 3 | Confident | Focus-return after close follows the existing Dialog convention (no bespoke restore machinery) | No dialog in the app implements custom focus-return; consistency wins; trivially added later if wanted | S:45 R:90 A:70 D:65 |
| 4 | Certain | `defaultName` computed at open time from the freshest-value refs (`currentWindowRef`/`sessionsRef`) | The refs exist precisely for this read-at-interaction pattern; computing at render would churn | S:80 R:90 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
