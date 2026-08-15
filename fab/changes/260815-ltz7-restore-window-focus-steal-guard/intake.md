# Intake: Restore Window Focus with Code-Server Steal Guard

**Change**: 260815-ltz7-restore-window-focus-steal-guard
**Created**: 2026-08-15

## Origin

Synthesized from a `/fab-discuss` session and dispatched promptless via `/fab-proceed` (create-intake, `promptless-defer`). The discussion fully explored the problem, verified the upstream VS Code behavior, and agreed on a 6-task design — this intake captures those decisions verbatim rather than re-litigating them.

> On a window switch in the terminal route, DOM focus is never restored. Whatever was focused when the user left a window — terminal, compose strip, or code editor — should be focused again when they return; first visit defaults to the terminal. Additionally, the code-server workbench steals focus once per iframe load, flipping `focusedTileKind` to `code` and killing all `ttyOnly` keybindings — that steal must be guarded.

## Why

1. **The pain point.** `SurfaceLayout` is keyed `${server}:${windowParam}` (app.tsx ~3650), so every window switch remounts the tile grid — and nothing on the run-kit side focuses anything afterwards:
   - The compose strip deliberately declines to focus on remount (compose-strip.tsx ~656).
   - xterm never autofocuses.
   - `focusTerminalRef` (app.tsx:655) is only invoked by the bottom bar ⌨ button (`onFocusTerminal`, app.tsx:3500).

   Meanwhile the code tile's iframe reloads per switch, and the code-server workbench grabs focus once at editor-restore time. Verified upstream: vscode `editorGroupView.ts` `restoreEditors()` calls `this.focus()` behind an anti-steal guard scoped to the IFRAME'S OWN document, so it always passes when embedded. There is NO setting in VS Code or code-server to suppress it; iframe `sandbox` only blocks the `autofocus` attribute; Permissions-Policy `focus-without-user-activation` is unshipped. So today the *accidental* winner of every window switch is the code editor.

2. **The consequence.** Keyboard-first users (Constitution Principle V) lose their typing target on every window switch. Worse, the code-server grab flips `focusedTileKind` to `code` via the tile wrapper's `onFocus={focusSlot}` (surface-layout.tsx:908), which silently disables all `ttyOnly` keybindings — the user's next keystrokes go to an editor they never chose.

3. **Why this approach.** Per-window focus *memory* (record what the user actually focused; recall it on return) plus a *steal guard* (a programmatic grab can never overwrite the user's recorded choice, and is reverted when it contradicts it). The asymmetric recording rule — `code` is recorded only on genuine interaction, never on mere focusin — is what defeats the steal structurally rather than by timing heuristics. Alternatives rejected in discussion: suppressing the grab at the source (no VS Code/code-server setting exists), `sandbox`/Permissions-Policy (don't apply to script `focus()` calls), and an upstream VS Code patch (plausible one-liner — the guard could check `window.top !== window` — but out of scope; not blocked on).

## What Changes

Six tasks, agreed in discussion. Blast radius is confined to the terminal route.

### 1. Focus-memory module — `app/frontend/src/lib/focus-memory.ts` (new)

Module-level `Map` keyed `${server}:${windowId}` → `"tty" | "compose" | "code"`, plus a per-key steal-guard armed flag.

API:
- `recordFocus(key, kind)` — write the user's focus choice
- `recallFocus(key)` — read it; `undefined` ⇒ `tty` default (keyboard-first, Constitution Principle V — replaces today's accidental code-wins behavior)
- `armGuard(key)` / `disarmGuard(key)` / `isGuardArmed(key)`

In-memory only — dies on page reload (precedent: `app/frontend/src/lib/code-folder-latch.ts`; Constitution II posture — ephemeral UI state, no persistence). Pure module, jsdom-unit-testable.

### 2. Recording seams (write on REAL focus only)

Navigation clicks must never pollute memory:

- `focusSlot` in `app/frontend/src/components/surface-layout.tsx` (~547) records `tty` when the focused tile kind is tty.
- The compose textarea's `onFocus` in `app/frontend/src/components/compose-strip.tsx` (which already publishes `setComposeStripFocused`) records `compose`.
- `code` is recorded ONLY via CodeSurface's existing `onInteract` seam (contentDocument keydown/pointerdown — `app/frontend/src/components/code-surface.tsx` ~68–127), NEVER on mere focusin. **This asymmetry is the core of the design**: a programmatic grab can never record itself as the user's choice.

### 3. Restore router (app.tsx)

Effect in `app/frontend/src/app.tsx` keyed `[server, windowParam]`, desktop only — skip when `isMobile`/coarse pointer, because auto-focus pops the mobile keyboard (precedent: chat-view.tsx:202). Routes by `recallFocus`:

- `tty` → `focusTerminalRef.current?.()` with retry-until-ready: the ref registers late in TerminalClient init, so retry in a rAF loop with a ~2s deadline, disarmed on first user interaction.
- `compose` → `focusComposeStrip()` (`@/lib/compose-strip-events`; the registered focuser already declines when disabled/unmounted — on decline, fall back to tty).
- `code` → no-op: the workbench's own load-time grab restores it. The degenerate no-restored-editors case (grab never fires) is acceptable; an explicit `contentWindow.focus()` after load is the recorded alternative if apply finds the no-op insufficient.

The effect also arms the steal guard (`armGuard`) for the new window key.

### 4. Steal-guard (CodeSurface + surface-layout)

In `CodeSurface` via one new prop (e.g. `onProgrammaticFocus?: () => boolean`): attach a `focus` listener to the iframe ELEMENT (parent-document side — the codebase already relies on iframe-element focusin for click-to-focus). When it fires while the guard is armed and the remembered kind ≠ `code`: revert via the restore router. The workbench grab is one-shot per load, so this fires at most once per switch.

Disarm on first genuine user interaction:
- `onInteract` (in-frame keydown/pointerdown), plus
- capture-phase `pointerdown`/`keydown` on the parent document (out-of-frame interaction).

Open implementation detail (apply decides-and-records): a reverted grab should not flip `focusedSlot`/`focusedTileKind` to `code`. Preferred: the tile wrapper's `onFocus` (surface-layout.tsx:908) consults the guard before calling `focusSlot`. Fallback: accept a one-tick flip that the revert immediately corrects (border flicker only).

This task is the risk center: event ordering between the iframe `focus` event, the wrapper `focusin`, and `focusSlot` needs care.

### 5. Playwright e2e (jsdom cannot prove iframe focus)

- Stub `/code/` route that calls `focus()` after ~300ms to simulate the workbench grab; mock the code-server reachability probe true. Route globs need a trailing `*` — `withServer` appends `?server=` (known latent pitfall).
- Three specs:
  - (a) terminal focused → switch away/back → focus reverts to the xterm textarea; typing lands there.
  - (b) same for the compose strip.
  - (c) user clicked into the editor before leaving → returning lets the grab through (no revert).
- Ship `.spec.md` companions in the same commit (constitutional requirement — Test Companion Docs).
- Unit tests (Vitest/jsdom) cover the focus-memory module itself.

### 6. Hydrate

- New memory file under `docs/memory/run-kit/ui/` documenting the focus-ownership model (memory keys, recording asymmetry, guard lifecycle, tty default).
- Note in `docs/specs/right-panel.md` § code lens that the load-time workbench grab is guarded.

## Affected Memory

- `run-kit/ui/focus-ownership`: (new) Per-window focus memory (tty/compose/code), the real-focus-only recording asymmetry, the steal-guard arm/disarm lifecycle, and the tty first-visit default
- `run-kit/ui/lenses-and-layout`: (modify) Code lens section — the load-time workbench focus grab and its guard; surface-layout `focusSlot` guard consultation
- `run-kit/ui/compose-and-bottom-bar`: (modify) Compose textarea `onFocus` now also records focus memory

## Impact

- **Frontend only**; no backend, no API, no board route.
  - New: `app/frontend/src/lib/focus-memory.ts` (+ unit test)
  - Modified: `app/frontend/src/app.tsx` (restore-router effect), `app/frontend/src/components/surface-layout.tsx` (record seam + guard consultation in `focusSlot`/wrapper `onFocus`), `app/frontend/src/components/compose-strip.tsx` (record seam), `app/frontend/src/components/code-surface.tsx` (iframe-element focus listener + new prop)
  - New e2e spec + stub harness + `.spec.md` companion under `app/frontend/tests/`
- **Sizing/risk**: medium-small. Tasks 1–3 mechanical; task 4 is the risk center (event ordering); task 5's stub harness is roughly half the effort.
- **Out of scope**: board route (own focused-pane model), mobile behavior changes, upstream VS Code PR.
- Change type: feat.

## Open Questions

- (none — the discussion resolved the design; the two intentionally-open implementation details are recorded as graded assumptions below, for apply to decide-and-record)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Focus memory is in-memory only (module-level Map, dies on reload) — no persistence | Discussed — precedent `lib/code-folder-latch.ts`; Constitution II posture for ephemeral UI state | S:90 R:85 A:95 D:90 |
| 2 | Certain | First visit to a window defaults to tty focus, replacing accidental code-wins | Discussed — Constitution Principle V (keyboard-first) directly answers it | S:90 R:90 A:95 D:90 |
| 3 | Certain | `code` is recorded ONLY via the `onInteract` seam (genuine keydown/pointerdown), never on focusin | Discussed — the load-bearing anti-steal asymmetry; the design collapses without it | S:95 R:70 A:90 D:95 |
| 4 | Certain | Restore is desktop-only (skip on `isMobile`/coarse pointer) | Discussed — auto-focus pops the mobile keyboard; precedent chat-view.tsx:202 | S:90 R:90 A:90 D:90 |
| 5 | Certain | Scope excludes board route, mobile behavior changes, and an upstream VS Code PR | Discussed — explicit out-of-scope list from the session | S:95 R:85 A:90 D:95 |
| 6 | Confident | tty restore uses `focusTerminalRef` with a rAF retry loop, ~2s deadline, disarmed on first user interaction | Discussed with specific values — the ref registers late in TerminalClient init; deadline value is tunable at apply | S:80 R:85 A:75 D:75 |
| 7 | Confident | compose restore calls `focusComposeStrip()` and falls back to tty when the focuser declines | Discussed — the registered focuser already declines when disabled/unmounted | S:80 R:85 A:80 D:80 |
| 8 | Confident | `code` restore is a no-op (workbench's own grab restores it); explicit `contentWindow.focus()` after load is the fallback if the degenerate case bites | Discussed with a stated front-runner; easily revisited at apply | S:70 R:85 A:70 D:60 |
| 9 | Confident | Steal-guard lives in CodeSurface behind one new prop (name flexible, e.g. `onProgrammaticFocus`), listening on the iframe ELEMENT parent-side; disarms on `onInteract` + capture-phase parent-document pointerdown/keydown | Discussed — codebase already uses iframe-element focusin for click-to-focus; exact prop name is illustrative | S:75 R:75 A:75 D:70 |
| 10 | Confident | A reverted grab should not flip `focusedSlot`/`focusedTileKind`: preferred = wrapper `onFocus` consults the guard before `focusSlot`; fallback = accept a one-tick flip the revert corrects | Explicitly left open in discussion with a stated preference — apply decides-and-records; fully reversible | S:60 R:80 A:60 D:50 |
| 11 | Confident | E2e uses a stubbed `/code/` route firing `focus()` after ~300ms + a mocked-true reachability probe; three specs (tty revert, compose revert, code passthrough) with `.spec.md` companions; route globs carry a trailing `*` | Discussed with specific values; `.spec.md` is constitutional; trailing-`*` is a known withServer pitfall | S:85 R:80 A:80 D:80 |
| 12 | Certain | Change type is `feat` (pinned explicitly so refresh's keyword inference cannot flip it to `fix`) | Discussion recorded feat; the intake text necessarily contains the word "fix", which the inference regex would match | S:90 R:95 A:95 D:95 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
