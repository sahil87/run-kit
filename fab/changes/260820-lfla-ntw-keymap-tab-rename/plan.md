# Plan: N/T/W Keymap Realignment + "Tab" Copy Sweep

**Change**: 260820-lfla-ntw-keymap-tab-rename
**Intake**: `intake.md`

## Requirements

### Keyboard & Palette: N/T/W Realignment

#### R1: `create-session` moves to ⇧⌘T in the mac shell
`create-session` SHALL keep its Win/Linux default (⇧Ctrl+N) and its `macShellOnly: true` gate, SHALL drop its old `macTier: "cmd"` refinement, and SHALL gain `macCode: "KeyT"` so the mac-shell default resolves on the shifted tier as ⇧⌘T — tier-disjoint from `create-window` (⌘T) on one code, the split-pair precedent. In a mac browser the base combo (⇧⌘N) stays browser-reserved (the shifted `KeyN` "incognito" claim), so the action remains palette-only there — the same availability story ⌘N-as-new-session has today.

- **GIVEN** the resolved effective map on a mac shell host
- **WHEN** `defaultComboFor`/`resolveBindings` runs for `create-session`
- **THEN** the default combo is `{ code: "KeyT", tier: "shifted" }` (⇧⌘T), enabled, `isDefault: true`
- **AND** on Win/Linux (both shell and browser) the default stays `{ code: "KeyN", tier: "shifted" }`, and in a mac browser the binding resolves `enabled: false, disabledReason: "reserved"`

#### R2: `new-app-window` — ⌘N opens a new app window (SPA binding only)
A new builtin registry action `new-app-window` SHALL resolve ⌘N inside the mac desktop shell and invoke the `shell:new-window` bridge channel via the SPA's structural-narrowing seam. It SHALL be encoded keyless base (`code: ""`) + `macCode: "KeyN"` + `macTier: "cmd"` + `macShellOnly: true`, so Win/Linux resolves unbound and a mac browser resolves unbound (⌘N stays browser-reserved there as claim data). The shell menu's New Window item SHALL stay accelerator-less (the unshifted-⌘ tier rule is untouched). The action SHALL be rebindable, listed in the shortcuts overlay, and palette-reachable inside the shell.

- **GIVEN** the SPA running inside the mac desktop shell
- **WHEN** the user presses ⌘N (Meta+KeyN)
- **THEN** the dispatcher fires the `new-app-window` handler, which invokes the `windows.newWindow()` bridge invoker (`shell:new-window` IPC)
- **AND** on Win/Linux and in a mac browser the default resolves disabled (keyless base → `disabledReason: "user"`), and no shell menu accelerator binds ⌘N

#### R3: `close-app-window` — ⇧⌘W closes the app window (SPA binding only)
A new builtin registry action `close-app-window` SHALL resolve ⇧⌘W inside the mac desktop shell and invoke a new `shell:close-window` bridge channel that closes the sender's window. It SHALL be encoded keyless base + `macCode: "KeyW"` + `macShellOnly: true` (base tier `shifted`, no `macTier`), so Win/Linux and mac browser resolve unbound. `kill-window` (⌘W in-shell) SHALL be unchanged as a binding. The mac Window menu's Close Window item SHALL stay accelerator-less.

- **GIVEN** the SPA running inside the mac desktop shell
- **WHEN** the user presses ⇧⌘W (Shift+Meta+KeyW)
- **THEN** the dispatcher fires the `close-app-window` handler, which invokes the `windows.close()` bridge invoker (`shell:close-window` IPC), closing the window the SPA is displayed in
- **AND** `kill-window` still resolves ⌘W (`{ code: "KeyW", tier: "cmd" }`) in the mac shell, and ⇧Ctrl+W on Win/Linux is untouched

#### R4: ⌘` registered as a system claim
The claimed-keys map SHALL carry `{ code: "Backquote", tier: "cmd", label: "cycle app windows", owner: "system", platform: "mac" }`, applying in both shell and browser hosts (the MAC_SCREENSHOT_CLAIMS precedent), so rebind capture warns. No binding default may occupy ⌘` on mac.

- **GIVEN** `claimedKeys("mac", shell)` for `shell` in `{true, false}`
- **WHEN** the cmd-tier claims are enumerated
- **THEN** a `Backquote` row with `owner: "system"` is present in both host maps
- **AND** `focus-hop` (ctrl-tier `Backquote`) is unaffected — the claim occupies a disjoint tier

#### R5: Registry invariants hold on every host
The shipped defaults SHALL remain conflict-free (`findConflicts` empty) on all four host maps (mac/other × shell/browser), claim mirrors SHALL be updated in the same change wherever affected, and `MAC_SHELL_CMD_CLAIMS` SHALL be unchanged (no new shell menu accelerators exist to mirror). The zen-toggle (⇧⌘⏎) row and the compose-Enter classifier SHALL be untouched.

- **GIVEN** the updated `DEFAULT_BINDINGS` and claimed-keys maps
- **WHEN** `findConflicts(resolveBindings(DEFAULT_BINDINGS, {}, host))` runs for each of the four hosts
- **THEN** the result is empty on every host
- **AND** `zen-toggle` keeps `{ code: "Enter", tier: "shifted" }` with no mac refinement

### Desktop Shell: Close-Window Bridge Channel

#### R6: `shell:close-window` IPC channel
The desktop shell SHALL expose a `close()` invoker on the preload `windows` group invoking `shell:close-window`, and main SHALL handle it gated exactly like `shell:new-window` (`isHostsSender`), closing `senderWindow(event)` (the window displaying the calling view). Shell-side changes SHALL be minimal and pattern-conforming.

- **GIVEN** a host-loaded SPA view inside the shell
- **WHEN** the SPA invokes `windows.close()`
- **THEN** the main process closes the sender's `BrowserWindow` and the invoke resolves `{ ok: true }`
- **AND** a sender failing the `isHostsSender` gate resolves `{ ok: false, error: "Not allowed" }`

### UI Copy: tmux "window" → "tab"

#### R7: User-facing copy says "tab" for tmux windows
Every user-facing string where "window" denotes a tmux window SHALL say "tab" — shortcut overlay labels (`New tab`, `Close tab`, `Previous tab`, `Next tab`) and `mapLabel`s (`new tab`, `close tab`, `prev tab`, `next tab`), palette entries (the `Window:`-prefixed labels tied to tmux windows → `Tab:` prefix), the window switcher's `+ New Window` → `+ New tab`, the sidebar's `New window in <session>` aria-label, kill-window confirm copy, and any other string the grep-and-adjudicate sweep ties to tmux windows (each adjudication recorded). Strings denoting the app window, the OS window, browser-owned claims, or tmux internals (actionIds, API, tmux layer) SHALL keep "window". The rename is copy-level on ALL platforms (not mac-gated).

- **GIVEN** the SPA rendered on any platform
- **WHEN** the user opens the command palette, the shortcuts overlay, the window switcher, or the kill-tab confirm
- **THEN** tmux-window actions are labeled "tab" (`Tab: Create`, `New tab`, `Close tab`, `Previous tab`/`Next tab`, `+ New tab`)
- **AND** actionIds (`create-window`, `kill-window`, `window-prev`, `window-next`), the API, and app-window strings (`App: New Window`, the shell's menu) keep "window"

### Non-Goals

- Win/Linux keymap changes — ⇧Ctrl+N/T/W stay as-is; New Window stays menu-only there (plain Ctrl belongs to the pane).
- Tmux-layer/backend/API renaming — copy-level only.
- Shell menu accelerator changes — New Window and Close Window menu items stay accelerator-less; the unshifted-⌘ fall-through rule is inviolable.
- zen-toggle (⇧⌘⏎) and the compose-Enter classifier (260820-ecl4) — untouched.
- Multi-window shell mechanics themselves — owned by the merged `desktop-multi-window` prerequisite.

### Design Decisions

#### Keyless base + mac refinement for the two app-window actions
**Decision**: `new-app-window` and `close-app-window` ship `code: ""` (the macro keyless-default precedent — resolves unbound) with `macCode` + `macShellOnly` refining the mac-shell default; `close-app-window` adds no `macTier` (stays shifted → ⇧⌘W), `new-app-window` adds `macTier: "cmd"` (→ ⌘N).
**Why**: The keyless base makes Win/Linux unbound with no claim data to maintain, and a mac browser shows the overlay's unbound affordance rather than advertising a dead chord; the refinements ride the existing `defaultComboFor` machinery with zero new resolver seams.
**Rejected**: A mac-claim-covered base (`code: "KeyN", tier: "cmd"`) — on Win/Linux that would display a live "Ctrl+N" binding whose handler can never exist (the bridge is shell-only), a lying overlay row.
*Introduced by*: 260820-lfla-ntw-keymap-tab-rename

#### `create-session` via `macCode: "KeyT"` on the shifted tier
**Decision**: `create-session` keeps base `code: "KeyN", tier: "shifted"`, drops its old `macTier: "cmd"` refinement, and gains `macCode: "KeyT"` (`macShellOnly` unchanged) — the shifted tier over the mac code resolves ⇧⌘T in-shell, tier-disjoint from `create-window`'s ⌘T on the same code.
**Why**: The exact shape the split pair (⌘D/⇧⌘D on `KeyD`) already ships, so `findConflicts` stays clean and no new mechanics are needed; Win/Linux keeps ⇧Ctrl+N for free.
**Rejected**: Repointing the base code to KeyT — would move Win/Linux off ⇧Ctrl+N (rejected by the user-decided scheme).
*Introduced by*: 260820-lfla-ntw-keymap-tab-rename

#### `shell:close-window` as a new channel (not the menu seam)
**Decision**: A dedicated `shell:close-window` IPC handler that closes `senderWindow(event)`, mirroring `shell:new-window` (same `isHostsSender` gate, same `IpcResult` shape), exposed as `windows.close()` on the preload `windows` group.
**Why**: The menu's Close Window item closes the FOCUSED window — a chord handled in a non-focused view would close the wrong window through that seam; the bridge must close the SENDER's window, exactly the `shell:new-window` sender-routing precedent.
**Rejected**: Reusing the menu callback (`BrowserWindow.getFocusedWindow()?.close()`) — focus-vs-sender mismatch; routing an SPA chord through a menu item also inverts the dependency direction.
*Introduced by*: 260820-lfla-ntw-keymap-tab-rename

## Tasks

### Phase 1: Registry & Claims

- [x] T001 Reshape `app/frontend/src/lib/keybindings.ts` DEFAULT_BINDINGS: `create-session` gains `macCode: "KeyT"`; add `new-app-window` (keyless base, `macCode: "KeyN"`, `macTier: "cmd"`, `macShellOnly: true`, label "New app window", mapLabel "new app") and `close-app-window` (keyless base, `macCode: "KeyW"`, `macShellOnly: true`, label "Close app window", mapLabel "close app"); rename tmux-window labels/mapLabels (`New tab`, `Close tab`, `Previous tab`, `Next tab`; `new tab`, `close tab`, `prev tab`, `next tab`; `create-window` description → "in the current session"); add the ⌘` `owner: "system"` cmd-tier mac claim row (both hosts); update the header/row comments that describe the old N/T/W map <!-- R1, R2, R3, R4, R7 -->
- [x] T002 Update `app/frontend/src/lib/keybindings.test.ts`: canonical-keys map gains the two new rows; per-host resolution coverage for `create-session` (⇧⌘T mac shell / reserved mac browser / ⇧Ctrl+N win-linux), `new-app-window`, `close-app-window`; ⌘` claim-row assertions (update the "claims nothing on Backquote" test to scope its freed tiers); palette-parity map rows for the two new actionIds; label renames in fixtures; conflict-free-defaults invariant kept passing <!-- R1, R2, R3, R4, R5, R7 -->

### Phase 2: Bridge Channels

- [x] T003 [P] Add the `windows` bridge group narrowing to `app/frontend/src/lib/shell.ts` (`windowsBridge()`, `isWindowsCloseBridge`, `canNewShellWindow()`, `canCloseShellWindow()`, `newShellWindow()`, `closeShellWindow()` — boolean-resolving, never throwing, the `servers`/`badge` precedent) plus colocated tests in `app/frontend/src/lib/shell.test.ts` <!-- R2, R3 -->
- [x] T004 [P] Add the close seam to the desktop shell: `windows.close()` invoker in `app/desktop/src/preload.ts` and the `shell:close-window` handler in `app/desktop/src/main.ts` (gated `isHostsSender`, closes `senderWindow(event)`); update the preload/main header comments that call the group "exposed but unconsumed" <!-- R6 -->

### Phase 3: Integration & Copy Sweep

- [x] T005 Wire palette + chords: `App: New Window` / `App: Close Window` entries in `app/frontend/src/hooks/use-global-palette-actions.ts` (gated on `canNewShellWindow()`/`canCloseShellWindow()`); `"new-app-window"` / `"close-app-window"` handlers via `fromPalette` in `app/frontend/src/app.tsx`'s `keybindingHandlers` and the board twin in `app/frontend/src/components/board/board-page.tsx` (the settings-open twin precedent) <!-- R2, R3 -->
- [x] T006 <!-- rework: copy sweep materially incomplete — sidebar toasts/aria, use-window-rename, session-row, host-overview/board hints, recovery counts, board kill-confirm title still say window — review must-fix --> Copy sweep — grep-and-adjudicate every user-facing "window" string tied to tmux windows across `app/frontend/src/**` (use `grep -a` for the NUL-poisoned `session-tiles.tsx`): palette `Window:` labels → `Tab:` (`app.tsx` windowActions + windowCycleActions), top-bar `+ New Window` → `+ New tab` and chevron-menu rows (`top-bar.tsx`), sidebar `New window in <session>` aria-label, kill-window confirm copy, fork tooltip/hint, toasts; record each adjudication in the task trail. App-window/OS-window/tmux-internal strings keep "window" <!-- R7 -->

### Phase 4: Tests & Verification

- [x] T007 Update affected unit tests for the copy sweep (`app.test.tsx`, `settings-shortcuts-panel.test.tsx`, `settings-dialog.test.tsx`, `session-row.test.tsx`, `row-flyout-card.test.tsx`, `macros.test.ts` fixtures as applicable); run `just test-frontend` and `cd app/frontend && npx tsc --noEmit` green <!-- R7 -->
- [x] T008 <!-- rework: nine e2e specs still assert the old window wording; new-window-unnamed.spec.ts fails on the rig via a PRE-EXISTING cross-server SSE ghost bug (fails on HEAD identically) — review must-fix x2 --> Update e2e: `app/frontend/tests/e2e/shortcut-registry.spec.ts` (`Change binding for Next window` → `Next tab` aria-label) and `app/frontend/tests/e2e/new-window-unnamed.spec.ts` (`New window in` aria-label) WITH their sibling `.spec.md` files (constitution); run `just pw test shortcut-registry` and `just pw test new-window-unnamed` green <!-- R7 -->
- [x] T009 Desktop shell green: `cd app/desktop && pnpm run compile && pnpm test` <!-- R6 -->

## Execution Order

- T001 blocks T002 (tests assert the new rows)
- T003 + T004 are independent of T001/T002 and of each other
- T005 depends on T003 (consumes the bridge invokers)
- T006 is independent of T001–T005 but its strings feed T007/T008
- T007–T009 are the verification tail

## Acceptance

### Functional Completeness

- [x] A-001 R1: `create-session` resolves ⇧⌘T in the mac shell, reserved in a mac browser, ⇧Ctrl+N on Win/Linux (unit-tested)
- [x] A-002 R2: ⌘N in the mac shell invokes `shell:new-window` through the registry action + palette entry; Win/Linux and mac browser resolve it unbound; no shell menu accelerator binds ⌘N
- [x] A-003 R3: ⇧⌘W in the mac shell invokes `shell:close-window` and closes the sender's window; `kill-window` (⌘W in-shell) is unchanged; Win/Linux ⇧Ctrl+W is unchanged
- [x] A-004 R4: `claimedKeys("mac", true)` and `claimedKeys("mac", false)` both contain the cmd-tier `Backquote` `owner: "system"` row
- [x] A-005 R6: `windows.close()` exists on the preload bridge and `shell:close-window` is handled in main with the `isHostsSender` gate and sender-window routing

### Behavioral Correctness

- [x] A-006 R5: `findConflicts` is empty on all four host maps; `MAC_SHELL_CMD_CLAIMS` is unchanged; zen-toggle and compose-Enter classifier rows are byte-identical
- [x] A-007 R7: Overlay labels, mapLabels, palette labels, the window switcher, menus, and confirm/toast copy say "tab" for tmux windows on every platform; actionIds and app-window strings keep "window" — MET: the rework swept all previously missed strings (sidebar toasts/aria, use-window-rename, session-row, recovery counts, host-overview/board hints, kill-dialog title) and the copy sweep is comprehensive across overlay labels (`New tab`/`Close tab`/`Previous tab`/`Next tab`), mapLabels (`new tab`/`close tab`/`prev tab`/`next tab`), palette entries (`Tab:` prefix), switcher (`+ New Tab`), kill-confirm copy, aria-labels (`Rename tab`/`Set tab label`), and hints (`sidebar tab row`). ActionIds, API fields, and app-window strings (`App: New Window`, `App: Close Window`) correctly keep "window". The formerly stale `boards-pin-flow.spec.md` / `web-view-lens.spec.md` companion lines were corrected pre-ship (`Pin: Current Tab`, `Tab:` prefix)

### Scenario Coverage

- [x] A-008 R1+R2: A unit test presses (chord-matches) ⇧⌘T → `create-session` and ⌘N → `new-app-window` on the mac-shell host map, and both chords resolve `create-session` palette-only / `new-app-window` unbound in a mac browser
- [x] A-009 R7: e2e specs asserting old labels/bindings (`shortcut-registry`, `new-window-unnamed`) are updated together with their sibling `.spec.md` files and pass on the port-3020 rig — MET: both named specs + their `.spec.md`s updated and pass on the rig (verified: 23/23 and 1/1). The rework additionally updated the nine other specs asserting renamed strings (`sidebar-window-sync`, `sync-latency`, `row-flyout`, `sidebar-multiselect`, `sidebar-panels`, `chat-view`, `spawn-agent`, `window-heading`, `top-bar-overlap`) plus `boards-pin-flow`, `web-view-lens`, `top-bar-overflow` — all pass per the apply worker's rig report. The three residual sidebar-window-sync failures reproduce identically on clean HEAD (pre-existing). Companion `.spec.md` docs for `boards-pin-flow` and `web-view-lens` still reference the old strings — recorded as a should-fix finding

### Edge Cases & Error Handling

- [x] A-010 R2+R3: On a shell build lacking the bridge members (older shell), `newShellWindow()`/`closeShellWindow()` resolve `false` and the palette entries/chord handlers are absent (feature-detect, never throws)
- [x] A-011 R6: A `shell:close-window` invoke from a non-allowlisted sender resolves `{ ok: false, error: "Not allowed" }`

### Code Quality

- [x] A-012 Pattern consistency: bridge consumption follows the structural-narrowing precedent in `shell.ts`; the shell channel follows the `shell:new-window` shape
- [x] A-013 No unnecessary duplication: no new resolver mechanics — everything rides `macTier`/`macCode`/`macShellOnly`/`defaultComboFor`
- [x] A-014 Type narrowing over type assertions: the `windows` bridge group is narrowed, never cast
- [x] A-015 Comment narration: updated comments state constraints/contracts (the inviolable unshifted-⌘ rule, claim-mirror rule), not change narration

## Deletion Candidates

- None — this change adds new functionality (bridge channel, registry actions) without making existing code redundant; the removed `macTier` on `create-session` is consumed by the same `defaultComboFor` seam, not orphaned code

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Pre-existing bug (recorded, out of scope — candidate for its own change)

Cross-server optimistic window-create never settles: the sidebar subscribes
SSE to the CURRENT server only, so a `+ New tab` create targeting a session
on another server leaves the optimistic ghost row unsettled and the page
degrades into a "Maximum update depth exceeded" render loop. Trigger: any
window-create whose `server` differs from the route's current server
(e.g. a spec or UI path creating on a non-subscribed server). Symptom:
infinite React re-render loop on the 3020 e2e rig; reproduced identically
on clean HEAD (twice) by the review agent, so it predates this change.
`new-window-unnamed.spec.ts` deliberately stays same-server.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `shell:close-window` is a NEW channel closing `senderWindow(event)`, mirroring `shell:new-window` — not the menu's focused-window Close Window seam | Sender-vs-focused routing correctness; the menu seam closes the focused window, wrong for a chord handled in a non-focused view | S:85 R:85 A:85 D:85 |
| 2 | Confident | Both new actions encode keyless base + `macCode` (+`macShellOnly`); `close-app-window` keeps the base `shifted` tier (⇧⌘W), `new-app-window` adds `macTier: "cmd"` (⌘N) | Keyless base yields unbound on Win/Linux and mac browser with zero claim data; rides existing `defaultComboFor` machinery | S:75 R:85 A:80 D:75 |
| 3 | Confident | Palette labels are `App: New Window` / `App: Close Window` (the "window" these actions mean is the app window), placed in the layout-global group gated on bridge presence | "Window" now unambiguously denotes the app window in user-facing copy; layout-global mounting makes the chord live on every route | S:70 R:85 A:80 D:70 |
| 4 | Confident | Copy sweep renames the palette `Window:` prefix to `Tab:` for tmux-window-tied entries, and includes aria-labels, tooltips, toasts, and confirm copy as user-facing strings; browser-owned claim labels (`new window`, `close window`) keep "window" (they describe the browser's own windows) | The intake mandates grep-and-adjudicate-each with app/OS-window and internals keeping "window"; claim labels describe browser chrome, not tmux | S:70 R:90 A:75 D:70 |
| 5 | Confident | No new desktop-side node test for the one-line close handler — the `shell:new-window` precedent shipped its main-side handler without one (pure logic lives in tested modules; `main.ts` IPC wiring is not under node:test) | Pattern-conforming minimal shell change; SPA-side narrowing is unit-tested in `shell.test.ts` | S:60 R:85 A:75 D:60 |
| 6 | Certain | The ⌘` claim label is "cycle app windows" (macOS "Move focus to next window"), cmd tier, mac platform, both hosts | MAC_SCREENSHOT_CLAIMS precedent; no collision with ctrl-tier `focus-hop` | S:85 R:90 A:85 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative).
