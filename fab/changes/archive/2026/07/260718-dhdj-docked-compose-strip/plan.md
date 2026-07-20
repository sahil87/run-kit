# Plan: Docked Compose Strip

**Change**: 260718-dhdj-docked-compose-strip
**Intake**: `intake.md`

## Requirements

### Compose: Docked Strip Component

#### R1: The docked compose strip replaces the modal ComposeBuffer as the single compose surface
The application SHALL render exactly one global compose surface — a docked strip at the bottom of the terminal area, immediately above the bottom-bar keys. The modal ComposeBuffer dialog (backdrop, `role="dialog"`, `aria-modal`, focus trap, Escape-closes, close-on-send, terminal `opacity-50` dimming) SHALL be removed.

- **GIVEN** the compose preference is on and a terminal is in view
- **WHEN** the terminal route or board route renders
- **THEN** a single docked strip renders above the bottom bar with a multi-line textarea, a live target label, a 📎 upload affordance, and a Send button
- **AND** no `role="dialog"`/`aria-modal` element, backdrop, focus trap, or terminal dimming is present for compose

#### R2: The strip is sticky and persists after send
The strip SHALL NOT auto-dismiss. It SHALL stay open after a send and across focus changes, route navigation, and toggle-off/on (its state lives in one global home above both shells).

- **GIVEN** the strip is open with drafted text
- **WHEN** the user sends the text (Enter)
- **THEN** the textarea and attachments clear but the strip stays rendered
- **AND** navigating between the terminal route and the board route preserves any unsent draft text and pending attachments

#### R3: A visible live target label follows the focused pane
The strip SHALL display a visible `→ {window name}` target label reflecting the currently-focused terminal from `FocusedTerminalContext`. On the terminal route the target is the route's window; on the board route it is the focused pane. When no terminal is focused (`focused === null`), the strip SHALL render in a disabled "no target" state and never send.

- **GIVEN** the board route with two focused-cyclable panes
- **WHEN** the user cycles pane focus
- **THEN** the target label updates to the newly-focused pane's window name
- **AND** with `focused === null` the label reads a "no target" state and Send is disabled

### Compose: Send Semantics

#### R4: Live send target (reverses DD-6)
The strip SHALL send to the currently-focused pane's `wsRef` read from `FocusedTerminalContext` at send time — NOT a target frozen at open. The wrong-pane-send risk is mitigated by the always-visible target label (R3), not by freezing.

- **GIVEN** the strip is open and pane A is focused
- **WHEN** the user focuses pane B, then sends
- **THEN** the bytes are delivered to pane B's `wsRef`, not pane A's

#### R5: Enter submits with trailing carriage return; Shift+Enter inserts a newline
Enter SHALL send the textarea content plus a trailing `\r` over the focused terminal's relay stream as raw bytes (same path as BottomBar keystrokes: `wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(...)`). Shift+Enter SHALL insert a newline. Enter SHALL be guarded against IME composition (`e.nativeEvent.isComposing`). Empty/whitespace-only Enter SHALL be a no-op.

- **GIVEN** the strip has focus with the text `hello`
- **WHEN** the user presses Enter
- **THEN** `hello\r` is sent over the focused pane's `wsRef`
- **AND** Shift+Enter inserts a newline instead of sending
- **AND** an empty/whitespace-only textarea with Enter sends nothing

### Compose: Toggle Affordances + Persistence

#### R6: The `>_` chip is an aria-pressed accent toggle
The bottom bar's `>_` compose button SHALL become a toggle carrying `aria-pressed={composeStripEnabled}` and the pressed-state chip vocabulary used by the ctrl/alt modifier chips (`bg-accent/20 border-accent text-accent` when on, `text-text-secondary` when off). Its `preventFocusSteal` (`onMouseDown` preventDefault) SHALL be preserved.

- **GIVEN** the strip preference is off
- **WHEN** the user clicks the `>_` chip
- **THEN** the chip gains `aria-pressed="true"` and accent styling, and the strip renders
- **AND** clicking again toggles it off

#### R7: Command-palette parity for the toggle
The existing `View: Text Input` palette action SHALL toggle the strip preference (Constitution V — Keyboard-First; palette parity).

- **GIVEN** a terminal is in view
- **WHEN** the user runs the `View: Text Input` palette action
- **THEN** the strip preference toggles (on↔off), matching the `>_` chip

#### R8: The toggle state is a persisted global chrome preference
The toggle state SHALL be a global chrome preference persisted to `localStorage` under `runkit-compose-strip`, owned by `ChromeContext` following the `terminalFontSize` pattern. It SHALL survive a page reload.

- **GIVEN** the user enables the strip
- **WHEN** the page reloads
- **THEN** the strip is still enabled (the preference was persisted and rehydrated)

### Compose: Focus Routing

#### R9: The strip never steals focus; Escape blurs to the terminal
The strip SHALL NOT steal focus on mount, on toggle-on, or after send. Escape while the strip textarea is focused SHALL blur it (returning control to the terminal); Escape SHALL no longer close any compose surface. On touch devices the ⌨ keyboard-toggle button SHALL focus the strip textarea (not the xterm) when the strip preference is on.

- **GIVEN** the strip is toggled on while the terminal has focus
- **WHEN** the strip mounts
- **THEN** the terminal retains focus (the strip did not grab it)
- **AND** pressing Escape in the strip textarea blurs it
- **AND** on a touch device with the strip on, tapping ⌨ focuses the strip textarea

### Compose: Uploads

#### R10: Uploads target the live focused worktree and re-home on focus change
The strip SHALL upload eagerly via `useFileUpload(session, windowId, server)` using the *focused* target's identity from `FocusedTerminalContext`. If the focused pane changes while attachments are pending, the strip SHALL re-upload the retained `File` objects to the new target's worktree and rewrite the path lines in the textarea. Re-home failure SHALL keep the original path lines and surface a non-blocking inline `role="alert"` error without blocking sending. The backend upload handler (`app/backend/api/upload.go`) SHALL be unchanged. Blob-URL lifecycle management SHALL carry over (create on preview, revoke on remove/unmount).

- **GIVEN** the strip has a pending image attachment uploaded to pane A's worktree
- **WHEN** the user focuses pane B (a different worktree)
- **THEN** the file is re-uploaded to pane B's worktree and the textarea path line is rewritten to the new path
- **AND** if the re-home upload fails, the original path line is kept and an inline error appears without blocking send

#### R11: The strip absorbs the dialog's upload, previews, and auto-grow
The strip SHALL carry the 📎 upload button, compact image thumbnails / file chips (a compact inline strip or popover is acceptable), and a bounded auto-growing textarea (ChatSendForm's `MAX_TEXTAREA_ROWS = 6` internal-scroll pattern). The textarea SHALL keep `autoComplete/autoCorrect/autoCapitalize="off"` and `spellCheck={false}` (verbatim terminal input). Drag-drop and clipboard-paste upload flows in `terminal-client.tsx` SHALL populate the strip (enabling the preference if off) instead of the modal.

- **GIVEN** the strip is rendered
- **WHEN** the user drops or pastes an image file onto the terminal
- **THEN** the strip preference turns on (if off), the file uploads to the focused worktree, its path is inserted in the textarea, and a compact preview appears

### Compose: Terminal Reflow

#### R12: Toggling the strip refits the terminal
Toggling the strip on/off SHALL shrink/grow the terminal by roughly the strip's height and trigger a FitAddon refit + tmux resize (the same reflow class as a font-size change).

- **GIVEN** a terminal is in view
- **WHEN** the user toggles the strip on or off
- **THEN** the terminal refits (FitAddon `fit()` + resize sent to tmux) so no stale columns/dead space persist

### Non-Goals

- No backend changes on the send path or upload path (`upload.go` and the relay send path are consumed as-is).
- Not adopting the chat-send POST `/api/windows/{id}/chat/send` probe/lock machinery — compose rides the relay WebSocket as raw bytes.
- No per-pane strips on the board route — one global strip.
- No Host-page (`/`) compose surface (the Host page mounts no BottomBar target; `focused === null` there).

### Design Decisions

1. **Live send target instead of a frozen target (reverses DD-6)**: The strip reads `focused.wsRef` from `FocusedTerminalContext` at send time rather than snapshotting a `frozenWsRef` at open (the modal's `compose-buffer.tsx:34` behavior). — *Why*: a persistent, sticky surface that outlives many focus changes would, with a frozen target, silently send to a stale/closed pane — strictly worse than the freeze it replaces. The always-visible `→ {window}` target label (R3) makes the destination unambiguous, so the wrong-pane risk the freeze guarded against is mitigated by visibility instead. — *Rejected*: keeping the frozen target (status-quo DD-6) — a stale frozen target on a sticky surface is the worse failure mode. (Recorded per the intake's explicit request.)
2. **One global strip in the footer grid area, above the BottomBar**: the strip renders in the shell footer (`gridArea: "bottombar"`) above `<BottomBar>` in both `app.tsx` and `board-page.tsx`, reading `focused` from `FocusedTerminalContext`. — *Why*: one input surface (Constitution IV); the focused-terminal context already routes BottomBar input, so the strip reuses the exact same target seam. — *Rejected*: per-pane strips on the board route (fragmented state, N surfaces).
3. **Persisted preference via ChromeContext, mirroring `terminalFontSize`**: a `composeStripEnabled: boolean` state + `runkit-compose-strip` localStorage key + `toggleComposeStrip` dispatcher. — *Why*: matches the established chrome-preference pattern (font size); mobile users leave it on, desktop off. — *Rejected*: keeping the ephemeral `composeOpen` in `FocusedTerminalContext` (does not persist; wrong home for a global chrome pref).
4. **Draft/attachment state lives in a module store (`compose-draft-store.ts`), exposed via a `useSyncExternalStore` seam**: the strip is mounted *conditionally* (`{composeStripEnabled && <ComposeStrip />}`) in *two separate footers* (AppShell + BoardPage), so component-local `useState` would be destroyed on every toggle-off (unmount) AND every terminal↔board route change (the footers are distinct React subtrees). R2 requires the draft to survive focus changes, route navigation, AND toggle-off/on — so the draft (text + retained `File` attachments) lives at module scope, read through `useSyncExternalStore(subscribeComposeDraft, getComposeDraft)`. Any mounted strip instance reads the same live draft; unmounting touches only per-mount blob-URL previews (recreated lazily on remount from the retained `File` objects), never the draft. — *Why*: this is the only design that satisfies R2's full survival contract; it reuses the established module-store pattern (the window-switch pending mask in `window-transition.ts` — a module slot + listener set + stable `getSnapshot`), so it adds no novel machinery. — *Rejected*: component-local `useState` (destroyed on toggle-off and on the route change — the exact must-fix the review caught); a React context provider mounted above both shells (would require restructuring the render tree that the two-footer split imposes; a module store with a `useSyncExternalStore` seam is lighter and matches in-repo precedent).

## Tasks

### Phase 1: Preference plumbing (ChromeContext)

- [x] T001 Add `composeStripEnabled: boolean` to `ChromeState`, a `toggleComposeStrip: () => void` to `ChromeDispatch`, the `COMPOSE_STRIP_STORAGE_KEY = "runkit-compose-strip"` constant, a `readComposeStrip()` reader, and persistence-on-toggle — all in `app/frontend/src/contexts/chrome-context.tsx`, mirroring the `fixedWidth`/`toggleFixedWidth` localStorage pattern. <!-- R8 -->

### Phase 2: The docked compose strip component

- [x] T002 <!-- rework: review must-fix 1 (A-002/R2) — draft + attachment state must move to a module-level store (useSyncExternalStore pattern, repo precedent: window-switch mask module state) so unsent drafts survive toggle-off/on AND terminal↔board route changes; component-local useState in a conditionally-mounted component destroys them --> Create `app/frontend/src/components/compose-strip.tsx` — a global docked strip consuming `useFocusedTerminal()` (`focused`) and `useChrome()` (`composeStripEnabled`). Contents: bounded auto-grow `<textarea>` (ChatSendForm `MAX_TEXTAREA_ROWS = 6` pattern, `autoComplete/autoCorrect/autoCapitalize="off"`, `spellCheck={false}`), a visible `→ {window}` target label, a 📎 upload button + compact previews, and a Send button. Sticky (never auto-dismisses); renders disabled "no target" state when `focused === null`. Never steals focus on mount. <!-- R1 --> <!-- R2 --> <!-- R3 --> <!-- R11 -->
- [x] T003 <!-- rework: review should-fix 1 — when the readyState guard blocks the send, early-return WITHOUT clearing the draft/attachments (clear only after a delivered send) --> Implement send semantics in `compose-strip.tsx`: Enter sends `text + "\r"` over `focused.wsRef` (guarded on `readyState === WebSocket.OPEN`), Shift+Enter inserts a newline, Enter guarded against `isComposing`, empty/whitespace-only Enter is a no-op; after send clear the textarea + attachments and keep the strip open without stealing/returning focus. Read `focused.wsRef` live at send time (reverses DD-6). <!-- R4 --> <!-- R5 --> <!-- R2 -->
- [x] T004 Implement upload + re-home in `compose-strip.tsx`: call `useFileUpload(focused.session, focused.windowId, focused.server)` scoped to the live target; retain `File` objects for previews; on focused-target change while attachments are pending, re-upload the held files to the new worktree and splice the textarea path lines (reuse the `lines.indexOf(path)` splice from the old ComposeBuffer `handleRemoveFile`); on re-home failure keep the original path lines and show a non-blocking inline `role="alert"` error; manage blob-URL create/revoke lifecycle. <!-- R10 --> <!-- R11 -->
- [x] T005 Implement focus routing in `compose-strip.tsx`: Escape in the textarea blurs it (no close); the strip never grabs focus on mount/toggle/after-send. Preserve `preventFocusSteal` discipline on any strip-adjacent chrome buttons (Send/📎). <!-- R9 -->

### Phase 3: Wiring + seam removal

- [x] T006 Retire the modal: remove `app/frontend/src/components/compose-buffer.tsx` and its import + render seam in `app/frontend/src/components/terminal-client.tsx` (the `composeOpen` render block at ~1019-1035, the `opacity-50` dimming at ~1006-1007, and the `composeOpen`/`setComposeOpen` props at ~97-98,117-118). Retarget the drag-drop/paste/palette upload flows (`openComposeWithUploads`, `handleUploadFiles`, the paste/drop handlers) so uploads enable the strip preference and populate the strip rather than the modal. Drop the `composeInitialText`/`composeFiles` local state now owned by the strip. <!-- R1 --> <!-- R11 -->
- [x] T007 <!-- rework: review must-fix 2 (A-018/R3) — BoardPane focus registration needs an unmount cleanup that clears FocusedTerminalContext when it is still the focused pane (mirror terminal-client.tsx:139); today board → /$server leaves a stale enabled strip with a live upload path into the stale worktree --> Remove the per-pane compose gate in `app/frontend/src/components/board/board-pane.tsx` (`composeOpenForPane = isFocused && composeOpen` at ~90-98 and the `composeOpen`/`setComposeOpen` props passed to `TerminalClient` at ~176-177). <!-- R1 --> <!-- R8 -->
- [x] T008 Supersede the ephemeral compose-open state in `app/frontend/src/contexts/focused-terminal-context.tsx`: remove `composeOpen`/`setComposeOpen` from the context value (and its doc comment) since the persisted `composeStripEnabled` preference replaces it. <!-- R8 -->
- [x] T009 Mount the strip and rewire the toggle in `app/frontend/src/app.tsx`: render `<ComposeStrip />` inside the footer grid area above `<BottomBar>` (~2669-2678); change `onOpenCompose` to `toggleComposeStrip`; change the `text-input` palette action (~1919-1923) to `toggleComposeStrip`; remove the `composeOpen`/`setComposeOpen` props on the AppShell `<TerminalClient>` (~2647-2648) and the `useFocusedTerminal` compose destructuring (~496). <!-- R1 --> <!-- R6 --> <!-- R7 --> <!-- R12 -->
- [x] T010 Mount the strip and rewire the toggle in `app/frontend/src/components/board/board-page.tsx`: render `<ComposeStrip />` in the footer above `<BottomBar>` (~951-960); change `onOpenCompose` to `toggleComposeStrip`; remove the `useFocusedTerminal` compose destructuring (~823). <!-- R1 --> <!-- R6 --> <!-- R12 -->
- [x] T011 <!-- rework: review should-fix 2 — replace the document.querySelector('[data-testid="compose-strip-input"]') functional seam with a real one (module-level focus registry, compose-strip-events pattern); test ids stay test-only --> Make the `>_` chip an `aria-pressed` accent toggle in `app/frontend/src/components/bottom-bar.tsx` (~347-357): add `aria-pressed`, apply the ctrl/alt pressed-state class vocabulary (`bg-accent/20 border-accent text-accent` when on, else `text-text-secondary`), reading the strip-enabled state; preserve `preventFocusSteal`. Route the touch ⌨ button (`handleKbdClick`, ~213-229) to focus the strip textarea when the strip preference is on. <!-- R6 --> <!-- R9 -->
- [x] T012 Trigger a terminal refit on strip toggle: ensure the `composeStripEnabled` change reflows live terminals via FitAddon `fit()` + tmux resize (the font-size-change reflow class). Wire an effect keyed on `composeStripEnabled` in `terminal-client.tsx` alongside the existing `terminalFontSize` refit effect (reusing `fitAndSync`), OR confirm the strip's layout change triggers the existing container `ResizeObserver`; implement whichever cleanly guarantees the refit. <!-- R12 -->

### Phase 4: Tests

- [x] T013 Update `app/frontend/src/components/terminal-client.test.tsx`: drop the ComposeBuffer mock (line ~161-162) and the `composeOpen`/`setComposeOpen` props (lines ~178-179, 520-521, 936-937) now that those props are gone. <!-- R1 -->
- [x] T014 <!-- rework: extend coverage for the rework — draft survives toggle-off/on and route change (module store), board-unmount focus cleanup, guard-blocked send preserves the draft --> [P] Add `app/frontend/src/components/compose-strip.test.tsx` — unit coverage for the strip: renders with target label, disabled "no target" state when `focused === null`, Enter sends `text+\r` to `focused.wsRef`, Shift+Enter newline, empty Enter no-op, IME-composition guard, no focus steal on mount, Escape blurs, and the re-home path-line rewrite logic. <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R9 --> <!-- R10 -->
- [x] T015 [P] Add `app/frontend/src/contexts/chrome-context.test.tsx` coverage (or extend an existing chrome test) for `composeStripEnabled` default, `toggleComposeStrip`, and `runkit-compose-strip` persistence/rehydration. <!-- R8 -->
- [x] T016 Add `app/frontend/tests/e2e/compose-strip.spec.ts` + sibling `compose-strip.spec.md`: toggle via `>_` chip (aria-pressed) and via the `View: Text Input` palette action, persistence across reload, Enter-sends-with-`\r` to the focused pane, target label follows board-pane focus (closing the `shell-rotation.spec.ts:14` per-pane STDIN gap), and Escape blurs to the terminal. Run through `just test-e2e "compose-strip"` only. <!-- R2 --> <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R6 --> <!-- R7 --> <!-- R8 --> <!-- R9 -->

## Execution Order

- T001 blocks T002-T005 (the strip consumes the new preference).
- T002 is the component skeleton; T003/T004/T005 extend it (same file, sequential).
- Phase 3 (T006-T012) depends on Phase 2 (the strip must exist to mount and to retarget uploads into).
- T013 depends on T006 (props removed). T014/T015 [P] depend on T002-T005 / T001. T016 depends on the full wiring (Phase 3).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A single docked compose strip renders above the bottom bar (terminal + board routes); the modal ComposeBuffer, its backdrop, `role=dialog`/`aria-modal`, focus trap, and terminal `opacity-50` dimming are gone.
- [x] A-002 R2: The strip is sticky — it stays open after send; unsent draft text and pending attachments survive focus changes, toggle-off/on, and terminal↔board route navigation. The draft lives in a module store (`compose-draft-store.ts`) read via `useSyncExternalStore`, so the conditional unmount (toggle-off) and the two-footer route split are both transparent to draft survival. (Re-review verified: stable-snapshot store + pure updaters; unit tests cover toggle-off/on remount and the two-mount route model; send-clear keeps the strip mounted.)
- [x] A-003 R3: A `→ {window}` target label is visible and updates with focused-pane changes; with `focused === null` the strip shows a "no target" disabled state.
- [x] A-004 R4: Sends go to the live focused pane's `wsRef` read at send time, not a target frozen at open.
- [x] A-005 R5: Enter sends `text + "\r"` over the relay stream; Shift+Enter inserts a newline; empty/whitespace-only Enter is a no-op; Enter is IME-composition-guarded.
- [x] A-006 R6: The `>_` chip carries `aria-pressed` and the accent pressed-state vocabulary, toggling the strip; `preventFocusSteal` is preserved.
- [x] A-007 R7: The `View: Text Input` palette action toggles the strip (palette parity).
- [x] A-008 R8: The toggle state persists to `localStorage["runkit-compose-strip"]` via ChromeContext and survives reload.
- [x] A-009 R9: The strip never steals focus (mount/toggle/after-send); Escape blurs the textarea to the terminal; the touch ⌨ button focuses the strip when the preference is on.
- [x] A-010 R10: Uploads target the live focused worktree; pending attachments re-home (re-upload + textarea path rewrite) on focus change; re-home failure keeps original paths + shows a non-blocking inline error; `upload.go` is unchanged.
- [x] A-011 R11: The strip carries 📎 upload + compact previews + bounded auto-grow textarea with terminal-input attributes; drag-drop/paste/palette upload flows populate the strip (enabling it if off).
- [x] A-012 R12: Toggling the strip refits the terminal (FitAddon `fit()` + tmux resize) — via the Shell footer row growing (`grid-template-rows: 1fr auto`) and the terminal container's existing ResizeObserver → `fitAndSync` (T012's sanctioned observer option).

### Behavioral Correctness

- [x] A-013 R4: Focusing pane B then sending delivers bytes to pane B (not the pane focused when the strip opened) — the DD-6 reversal is observable. (Every unit send test acquires the target AFTER mount via the FocusSetter harness; the re-home test drives an A→B focus change.)
- [x] A-014 R5: Enter's trailing `\r` and Shift+Enter newline replace the old Cmd/Ctrl+Enter raw-insert send behavior.

### Removal Verification

- [x] A-015 R1: `compose-buffer.tsx` is deleted and has no remaining imports/references; `composeOpen`/`setComposeOpen` are removed from `FocusedTerminalContext`, `TerminalClient` props, and `BoardPane`.

### Scenario Coverage

- [x] A-016 R3: An e2e (`compose-strip.spec.ts`) verifies the target label follows board-pane focus (closing the `shell-rotation.spec.ts:14` gap).
- [x] A-017 R8: An e2e verifies toggle persistence across reload.

### Edge Cases & Error Handling

- [x] A-018 R3: With the strip enabled but no terminal focused (e.g. `/$server` tiles route), the strip renders disabled and never sends — including on the from-board path. `BoardPane` now clears `FocusedTerminalContext` on unmount iff it is still the registered focused pane (mirrors `terminal-client.tsx:139`, guarded via a live-`focused` ref so a sibling pane's newer registration during a focus cycle is not clobbered), so leaving a board for `/$server` leaves no stale target — the strip reverts to the disabled "no target" state, no upload lands in a stale worktree, and Enter cannot fire against a closed stream. (Re-review verified: `board-pane.tsx:135-141` unmount-only cleanup with ref-guarded still-mine check; commit-order analysis holds for same-commit unmount+re-register; unit test covers the pane-unmount → "no target" fallback.)
- [x] A-019 R10: Re-home upload failure surfaces a non-blocking inline `role="alert"` error and does not block sending. (Verified by inspection — compose-strip.tsx:155-160 catch → `setError`, send path independent; no unit test for the failure branch.)
- [x] A-020 R5: The relay send guard (`readyState === WebSocket.OPEN`) prevents a send when the focused stream is not open (no throw, no toast), and the guard-blocked path early-returns WITHOUT clearing — the draft is preserved (clearing happens only after a delivered send).

### Code Quality

- [x] A-021 Pattern consistency: The strip follows ChatSendForm (auto-grow, Enter/Shift+Enter, `role="alert"` inline error) and the ChromeContext preference pattern (`terminalFontSize`); the chip toggle mirrors the ctrl/alt modifier-chip vocabulary.
- [x] A-022 No unnecessary duplication: The strip reuses `useFileUpload`, `FocusedTerminalContext`, the blob-URL lifecycle, and the path-line splice logic rather than reimplementing them. (The ChatSendForm auto-grow block is duplicated verbatim — outside this item's enumerated list; flagged as a review should-fix.)
- [x] A-023 Type narrowing over assertions: New code prefers `if` guards / discriminated unions over `as` casts (code-quality.md frontend rule).
- [x] A-024 Test companion docs: The new/modified `compose-strip.spec.ts` ships its sibling `compose-strip.spec.md` in the same commit (Constitution — Test Companion Docs).
- [x] A-025 Polling anti-pattern avoided: No client `setInterval`+fetch introduced; the strip is event/context-driven.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `ChatSendForm` auto-grow block (`app/frontend/src/components/chat-view.tsx:138,161-169` — `MAX_TEXTAREA_ROWS` + the `resize` callback) — duplicated verbatim into `compose-strip.tsx:66,112-120`; extracting a shared auto-grow hook would let one copy be deleted.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Live send target reading `focused.wsRef` at send time, reversing DD-6, mitigated by the visible target label | Intake §4 Certain (S:95 R:60 A:85 D:90); user explicitly confirmed the reversal and asked it be recorded as a Design Decision | S:95 R:60 A:85 D:90 |
| 2 | Certain | Persisted toggle via ChromeContext `composeStripEnabled` + `runkit-compose-strip` localStorage key, mirroring `terminalFontSize`/`fixedWidth` | Intake §2/§3 Certain; the chrome-preference pattern is the established one | S:95 R:85 A:90 D:95 |
| 3 | Certain | Enter sends `text+\r`, Shift+Enter newline, IME-guarded, empty is a no-op | Intake §4/§13; matches ChatSendForm convention verbatim | S:95 R:80 A:90 D:90 |
| 4 | Certain | One global strip in the footer grid area above BottomBar, targeting via FocusedTerminalContext | Intake §8 Certain; the focused-terminal seam already routes BottomBar input | S:95 R:70 A:90 D:95 |
| 5 | Certain | Strip mounted in each route's footer (AppShell + BoardPage); draft/attachment state lives in a module store (`compose-draft-store.ts`, `useSyncExternalStore` seam), NOT component-local, so it survives the conditional unmount and the two-footer route split | R2 requires draft survival across focus/route/toggle; the two footers are separate conditional mounts, so component-local state cannot satisfy it — the module store (window-switch-mask precedent) is the mandated design | S:90 R:70 A:85 D:90 |
| 6 | Confident | Terminal refit on toggle wired via a `composeStripEnabled`-keyed effect reusing `fitAndSync` (the font-size-change reflow class), or via the existing container ResizeObserver if the layout change triggers it | Intake §7/§9 accepts the reflow as the font-size class; the exact trigger (effect vs observer) is an implementation detail with an obvious in-repo precedent | S:70 R:80 A:80 D:70 |
| 7 | Confident | Compact inline preview strip (thumbnails/file chips) rather than a popover; simplifies the dialog's 60px strip + expanded-preview | Intake §2/§7 explicitly permits "compact is fine"; inline is the simpler, lower-risk choice | S:70 R:85 A:80 D:70 |
| 8 | Confident | With `focused === null` the enabled strip renders disabled with a "no target" state and never sends | Intake §11 Confident; follows from the live-target design; trivially adjustable | S:60 R:85 A:75 D:70 |
| 9 | Certain | Cross-route draft persistence (terminal↔board) is FULLY guaranteed by the module draft store — the two-footer mount split is transparent because both footers read the same module-level draft via `useSyncExternalStore`; survival across focus, route navigation, and toggle-off/on all hold | Intake §12/R2 require full cross-route survival (not an aspiration); the module store (the shared draft store the earlier bounding wrongly deferred) delivers it with in-repo-precedent machinery | S:90 R:70 A:80 D:85 |
| 10 | Confident | Re-home failure keeps original path lines + non-blocking inline `role="alert"` error; send not blocked | Intake §14 Confident; the ChatSendForm inline-error convention exists; low blast radius | S:45 R:80 A:65 D:50 |

10 assumptions (6 certain, 4 confident, 0 tentative).
