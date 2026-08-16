---
description: "Per-window focus memory (tty/compose/code) and the code-server steal guard: real-focus-only recording asymmetry, the desktop restore router with its tty first-visit default, the guard arm/disarm lifecycle, the in-frame focusin grab detector, and the focus-hop chord (⌃`) as a focus-seam consumer that records only on the tty hop."
type: memory
---
# run-kit UI — Focus Ownership

## Focus-Memory Module (`lib/focus-memory.ts`)

A pure, DOM-free module holds two sibling pieces of per-window state, both keyed `` `${server}:${windowId}` `` — spelled out exactly once by the exported `focusMemoryKey(server, windowId)` (the same shape as the `rk-layout:` / `runkit-code-folder:` storage keys; every seam calls it):

- **Memory** — a module-level `Map` recording which of the three focus candidates (`"tty" | "compose" | "code"`, the `FocusKind` union) the USER last focused in a window. `recordFocus(key, kind)` writes it; `recallFocus(key)` reads it, returning `undefined` for a never-focused window (callers apply the `tty` default — keyboard-first, Constitution V: a first visit lands on the terminal, not on whatever grabs focus first).
- **Guard** — a per-key armed flag (`armGuard` / `disarmGuard` / `isGuardArmed`), the steal guard's state (§ Steal Guard below).

State is **in-memory only**, dying on page reload — ephemeral UI state, deliberately NOT persisted (the sibling `code-folder-latch.ts` is the storage-shaped one; this module is its pure in-memory counterpart, Constitution II posture). The module-slot shape mirrors `compose-strip-events.ts`; `resetFocusMemory()` is the test-only reset seam (the `hydrateComposeDrafts()` pattern — production never calls it). Colocated Vitest coverage in `focus-memory.test.ts`. (`260815-ltz7`)

## Recording Seams — Real Focus Only

Memory is written only from genuine user focus of the three candidates; navigation clicks and programmatic grabs never write it:

- **`tty`** — recorded in `surface-layout.tsx` on the tile wrapper's **`onPointerDownCapture`** seam (`focusSlotFromPointer`) and on the palette focus seam (`recordTtySlot`, the `focusTileRef` path), when the slot's kind is tty. It is deliberately NOT in `focusSlot` or the wrapper's `onFocus`: the in-tile compose strip docks INSIDE the tty tile and a focusin bubbles target-first, so the textarea's `onFocus` (recording `compose`) runs before the wrapper's — a tty write there would clobber every compose record. Pointerdown capture precedes any focus event, so the compose write lands last. The pointerdown write also skips presses landing inside the docked strip (the production `data-compose-strip` marker on the strip root): a re-click on an already-focused textarea fires no focus event, so without the carve-out the tty write would clobber `compose` with no correction. The focused-SLOT highlight still follows such a press (the strip is part of the tty tile's frame).
- **`compose`** — recorded from the compose textarea's `onFocus` in `compose-strip.tsx` (beside the `setComposeStripFocused(true)` publish), in terminal-target mode only (a selection broadcast has no window identity), and gated on a `focusMemoryWindow` prop from `app.tsx`: the write fires only when the strip's live target IS the route window — the focused-terminal context lags a window switch by a commit, so a restore-driven focus in that gap would otherwise cross-write the previous window's key. The gate lives in a prop (not `useMatches`) because the strip's unit tests mount it without a router.
- **`code`** — recorded ONLY when `CodeSurface`'s `onInteract` seam fires (in-frame contentDocument keydown/pointerdown), wired at the `onInteract` call site in `surface-layout.tsx` — which also disarms the guard. Mere iframe focusin MUST NOT record `code`. This asymmetry is the load-bearing anti-steal property: a programmatic grab produces no in-frame interaction, so it can never write itself into memory, and the guard only ever reverts TOWARD a recorded user choice (§ Design Decisions → Recording asymmetry defeats the steal structurally).

**The `focus-hop` chord is a focus-seam consumer, not a recorder** ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § The default binding set). `` ⌃` `` on mac / ⇧Ctrl+` on Win/Linux hops focus between the tty and code tiles through the same `layoutFocusTileRef` focus-by-kind seam the palette's `Layout: Focus <Surface>` entries use, desktop-only and gated on the code surface being available (no handler ⇒ the chord falls through). Hop-to-tty records `tty` via that seam's existing `recordTtySlot`; hop-to-code writes NOTHING into memory — the recording asymmetry holds (only in-frame `onInteract` records `code`), so a programmatic hop can never teach the guard a `code` preference it would later revert toward. When the code tile is closed but the surface is available, the chord opens it first (`togglePanel("code")`) and focuses it once the layout lands (a `focusCodeOnLandingRef` flag consumed by a layout-keyed `app.tsx` effect) — open-then-focus, VS Code's ⌃`-opens-the-hidden-panel analog.

## Restore Router (`app.tsx`)

A `useEffect` keyed `[server, windowParam]` on the terminal route, **desktop-only** (skipped when `isMobile` — auto-focus pops the mobile keyboard; the chat-view autofocus precedent), resolves `recallFocus(key) ?? "tty"` through the stable `restoreFocus` callback (reads only refs + module state; returns a cancel that abandons any pending retry):

- **`tty`** → `focusTerminalRef.current?.()` with retry-until-ready: the ref registers late in TerminalClient init, so a rAF loop retries until the ref lands, bounded by the `FOCUS_RESTORE_RETRY_MS` (5000) deadline — under load TerminalClient init outlasts a shorter budget and the restore never lands.
- **`compose`** → `focusComposeStrip()` (`lib/compose-strip-events.ts`); the registered focuser returns `false` when declined (disabled/unmounted), and a decline falls back to the `tty` route.
- **`code`** → a no-op: the workbench's own load-time grab restores editor focus (the degenerate no-restored-editors case is accepted; an explicit `contentWindow.focus()` after load is the recorded fallback).

The effect also `armGuard(key)`s for the new window and installs capture-phase `pointerdown`/`keydown` listeners on the parent document that `disarmGuard(key)` — and abandon any pending retry — on the first genuine user interaction (torn down on cleanup).

## Steal Guard

The code-server workbench grabs DOM focus once per iframe load — a script `focus()` at editor-restore time that no VS Code / code-server setting suppresses (the upstream anti-steal guard is scoped to the iframe's own document, so it always passes when embedded; `sandbox` blocks only the `autofocus` attribute; Permissions-Policy `focus-without-user-activation` is unshipped). Unguarded, the grab would win every window switch and flip `focusedTileKind` to `code`, silently killing all `ttyOnly` keybindings. The guard answers it:

- **Detector** — a capture-phase `focusin` listener on the frame's **contentDocument**, attached by `CodeSurface`'s existing load/attach effect (the chord-reclaim/`onInteract` seam) and feeding the new `onProgrammaticFocus?: () => boolean` prop. The in-frame listener is the ONLY observable: an in-frame script `focus()` re-points the focus chain (the parent's `document.activeElement` becomes the iframe) but fires NO parent-side event on the iframe element — no `focus`, no `focusin`, no window `blur` (verified empirically in Chromium). `CodeSurface` only reports; it knows nothing about the focus-memory module.
- **Revert** — `app.tsx`'s `revertProgrammaticFocus` (threaded `SurfaceLayout` → `CodeSurface.onProgrammaticFocus`): while the guard is armed and the remembered kind is not `code`, the grab contradicts the user's recorded choice, so it re-runs `restoreFocus(key)` and reports the revert (`true`). A remembered `code` lets the grab through — the grab IS the restore, so there is no revert loop. The revert does NOT disarm the guard; the consult also re-reads `recallFocus`, so a lingering armed flag is inert once the user has interacted.
- **No-flip half** — the tile wrapper's `onFocus` in `surface-layout.tsx` consults the guard before calling `focusSlot` for a code tile: armed + remembered ≠ `code` skips the flip, so `focusedSlot`/`focusedTileKind` never settle on `code` from a grab (engines that DO fire a parent-side iframe focusin would otherwise flip it). A genuine click-in reaches `onPointerDownCapture` first and its in-frame `onInteract` disarms the guard before the focusin, so real editor focus is never blocked or reverted.
- **Disarm** — first genuine user interaction only: the in-frame `onInteract` seam, or the restore effect's capture-phase parent-document `pointerdown`/`keydown` listeners. After disarm, editor focus behaves exactly as without the guard (click-in focuses, `focusSlot` fires, `code` records via `onInteract`).

One e2e-visible consequence: opening the code tile via the `Code tile` rail toggle is itself a pointerdown, which disarms that visit's guard — the tile-opening grab stands; the revert is exercised on the away-and-back return. (`260815-ltz7`)

## e2e — `focus-restore.spec.ts` (+ `.spec.md`)

jsdom cannot prove iframe focus, so the integrated behavior is proven in Playwright on the port-3020 rig (`workers: 1`). `beforeAll` binds a real stub HTTP server on `RK_CODE_SERVER_PORT` (the `code-surface.spec.ts` harness pattern) serving a page whose script focuses a button ONCE ~300ms after each load — a `didFocus` flag keeps the revert's own focus churn from retriggering the grab, matching the real one-shot editor-restore grab — and retitles its document `grabbed`; the stub makes the backend reachability probe genuinely true (no probe mock). Focusing an element inside the same-origin frame chains focus up, making the iframe ELEMENT the parent's `activeElement`, exactly like the real steal. The code tile is opened via the `Code tile` rail toggle (a persisted `rk-layout:` mutation that survives in-app switches — a `?layout=` URL param is dropped by sidebar navigation), and window switches go through sidebar-row clicks, never `page.goto` (focus memory is in-memory; a reload would wipe the state under test). `expectGrabFired` polls the frame's `contentDocument.title` for `grabbed` so a pass can never be the vacuous "the grab never happened"; every test budgets 30s and the `beforeAll` hook 90s. Three specs: (a) a window remembered as `tty` reverts the grab to the xterm textarea and typed keys reach the tmux pane (first visit ⇒ the `tty` default); (b) a window remembered as `compose` reverts to the strip textarea; (c) after a genuine in-editor click, the grab passes through — it IS the restore. (`260815-ltz7`)

## Design Decisions

### Recording asymmetry defeats the steal structurally
**Decision**: `code` is recorded only from the in-frame interaction seam (`onInteract`), never from iframe focusin; `tty`/`compose` record from their genuine-focus seams (pointerdown capture for tty, textarea `onFocus` for compose).
**Why**: the workbench's programmatic grab produces focusin without interaction, so it can never write memory — the guard then only ever reverts *toward* a user choice, making the design correct independent of grab timing.
**Rejected**: timing heuristics (suppress focus for N ms after mount) — fragile against slow loads and fights legitimate user clicks.
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

### Guard state lives in the focus-memory module, wired through app.tsx
**Decision**: `armGuard`/`disarmGuard`/`isGuardArmed` are module-level per-key flags beside the memory Map; `app.tsx` arms on window switch and disarms via parent-document capture listeners; `surface-layout.tsx` and `code-surface.tsx` consume via imports/props.
**Why**: one source of truth for "are we in the post-switch protected window", readable synchronously from any seam without prop-drilling render state; matches the module-slot pattern of `compose-strip-events.ts`.
**Rejected**: React state in SurfaceLayout (resets are per-window for free, but the compose strip and app.tsx would need context plumbing for a transient flag).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

### The grab detector is an in-frame contentDocument `focusin`, not a parent-side iframe listener
**Decision**: `CodeSurface` attaches a capture-phase `focusin` to the frame's own document (the existing `attach()` seam) and reports it via `onProgrammaticFocus`; no listener is attached to the iframe ELEMENT on the parent side.
**Why**: an in-frame script `focus()` re-points the focus chain but fires no parent-side event on the iframe element (verified empirically in Chromium) — the in-frame `focusin` is the only observable. A genuine click-in produces `pointerdown` (→ `onInteract`, disarming the guard) BEFORE the focusin, so real editor focus is never reverted; the wrapper-`onFocus` guard consultation stays as the cross-engine no-flip half.
**Rejected**: a parent-side `focus` listener on the iframe element (the planned mechanism — empirically silent in Chromium, so the guard would never fire).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

### The `tty` record lives on the pointerdown seam, with a compose-strip carve-out
**Decision**: `tty` is recorded on the tile wrapper's `onPointerDownCapture` (and the palette focus seam), never in `focusSlot`/the wrapper `onFocus`; presses landing inside the docked compose strip (the production `data-compose-strip` marker) skip the write.
**Why**: the in-tile strip docks inside the tty tile and focusin bubbles target-first — the textarea's `onFocus` (recording `compose`) runs before the wrapper's, so a tty write there clobbers every compose record; pointerdown capture precedes the focus event, letting the compose write land last. The carve-out covers the re-click case: the strip's focus-on-open means a follow-up click on the already-focused textarea fires no focus event, so an uncarved tty write would clobber `compose` with no correction.
**Rejected**: recording `tty` in `focusSlot` or the wrapper's `onFocus` (the planned seam — clobbers `compose` on every strip click, verified empirically via module-state probes).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

### Compose recording is gated on a `focusMemoryWindow` prop
**Decision**: the textarea's `onFocus` records `compose` only when the strip's live focused target matches the route-window identity `app.tsx` passes as `focusMemoryWindow` (and never in selection-broadcast mode).
**Why**: the focused-terminal context lags a window switch by a commit, so a restore-driven focus in that gap would cross-write the PREVIOUS window's key (verified empirically via module-state probes). A prop, not `useMatches`, because the strip's unit tests mount it without a router.
**Rejected**: keying the write on the live focused target alone (cross-writes the previous window during the switch commit); selection-broadcast recording (a broadcast has no window identity — its draft key is `selection:…`, not a window).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

### Focus memory is in-memory only
**Decision**: the Map and guard flags live at module scope and die on page reload — no localStorage, no persistence.
**Why**: ephemeral UI state; a stale persisted kind would restore focus to a surface that no longer exists in the window's layout, and the failure mode of forgetting (falling back to the `tty` default) is exactly the keyboard-first desired first-visit behavior.
**Rejected**: localStorage persistence (the `code-folder-latch.ts` shape — wrong for a value whose correct cold-start answer is always the `tty` default).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard
