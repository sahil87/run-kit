# Intake: Compose strip — collapse to a tongue instead of unmounting

**Change**: 260913-kl7u-compose-collapse-tongue
**Created**: 2026-09-13

## Origin

Created by `/fab-proceed`'s promptless create-new dispatch from a synthesized design discussion (the sole source — no other change folder was consulted). No questions were asked; every would-be question is recorded as a Deferred Unresolved row in `## Assumptions` (none arose that scored Unresolved — see the table). Change 1 of 2: the follow-up `compose-default-on` (flip the default, first-render toast, focus on fresh navigation, name unification, `Esc → terminal` placeholder hint) depends on the tongue existing.

> **Title**: Compose strip — collapse to a tongue instead of unmounting
>
> **Problem**: The docked compose strip (`app/frontend/src/components/compose-strip.tsx`) is toggled by the `composeStripEnabled` chrome preference (`contexts/chrome-context.tsx`, localStorage `runkit-compose-strip`). When off, the strip unmounts entirely and the only re-open affordances are relocated away from where the surface lived: the status-bar `a▏` chip (fine pointers, `xl+` only, chord shown only in its hover Tip), the bottom-bar `a▏` chip (coarse pointers), the `View: Text Input` palette action, and the `compose-toggle` chord (⌘I mac / ⇧Ctrl+E win-linux). Discoverability of re-opening is poor, and the follow-up change that flips the strip to default-on needs a visible, in-place collapsed state so users learn how to hide/show it. The disabled "no target" state (board page footer, `/$server` tiles route) also renders a full disabled strip that is pure noise.
>
> **What changes**: (1) replace hide-by-unmount with a collapsed tongue at the same dock — `a▏` glyph (no caret blink on the tongue), the word "Compose", the platform-resolved `compose-toggle` chord as a trailing `<kbd>` on fine pointers; click fires `toggleComposeStrip()`; `preventFocusSteal` on mousedown. (2) The disabled no-target state collapses to the tongue too, reading the existing no-target copy. (3) The `a|` closer and header × keep working and now collapse to the tongue; the tongue renders on coarse pointers too, at the strip's dock above the bottom bar, lightweight. (4) Keep the `app.tsx` mount predicate structure (`inTileDock`, `composeStripVisible`) as one seam; the collapsed/expanded fork lives inside the strip component (or a thin sibling). (5) Status-bar chip, bottom-bar chip, palette action, chord — unchanged. (6) Enter semantics, send path, drafts, uploads, focus-ownership rules — unchanged; Escape still blurs, never collapses. (7) Zen: the tongue follows the strip's zen rule. (8) The tongue's visible label is "Compose".
>
> **Vertical budget**: the tongue must be a single compact row (≈ the compact strip's chip row or less).
>
> **Paste/drop**: `attachToStrip` in `terminal-client.tsx` already toggles on when off and dispatches the attach event; a file paste while collapsed must expand AND upload.
>
> **Tests**: unit tests for the fork and the no-target tongue in `compose-strip.test.tsx`; e2e in `compose-strip.spec.ts` (tongue at both docks; click expands + focuses; `a|` collapses; chord on fine pointers; board page shows the no-target tongue; file paste while collapsed expands and uploads). Proves/Steps JSDoc on every `test()`. `just` recipes only.
>
> **Rejected**: replacing the `a▏` glyph with chord text; relying on the status-bar chip's hover Tip; an Escape-collapses rung; reusing the quake launcher component.

## Why

**The pain point.** Hiding the strip today means *unmounting* it. The place where the surface lived (the bottom of the tty tile, or the shell footer) goes blank, and every re-open affordance is somewhere else — a status-bar chip that only exists at `xl+` on fine pointers and only reveals its chord in a hover Tip, a bottom-bar chip that only exists on coarse pointers, a palette entry named `View: Text Input` (not "Compose"), and a chord nobody has been shown. A user who closes the strip once has no in-place cue that it can come back, or how.

**The consequence of not fixing it.** The next change (`compose-default-on`) turns the strip on by default. Without an in-place collapsed state, every user who dismisses the newly-default strip has the same discoverability cliff — and default-on makes that dismissal far more common. The follow-up cannot ship well without this.

**Second pain point — the no-target state is noise.** With `focused === null` (board route before a pane is selected, the `/$server` tiles route, no-tty layouts) the enabled strip renders a *full* disabled row: a disabled textarea, a disabled 📎, a disabled Send, and a `→ no target` header — a whole card of dead controls whose only information is one sentence of placeholder text. That sentence is all the state needs.

**Why a tongue over the alternatives.**
- *Replacing the `a▏` glyph with the chord text* loses the strip's identity glyph (the `a▏` is shared by both chips and carries `aria-pressed` state there), cannot show a chord on coarse pointers at all, and `⇧Ctrl+E` is long on Linux. The glyph + label + trailing `<kbd>` keeps identity and adds the chord where it applies.
- *Relying on the status-bar chip's hover Tip* is hover-only discoverability, `xl+` only, fine pointers only.
- *An Escape-collapses rung* is rejected outright: Esc in the terminal must reach the pane (vim, TUIs); the strip's Escape already means "blur to the terminal" and that contract is untouched ([compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md) § Focus routing).
- *Reusing the quake launcher component* (`quake-launcher.tsx`'s `quake-launcher-collapsed` button — `OperatorStateGlyph` + `<kbd>` chord) — it is a top-bar component with its own machine state (`setQuakeMachineState`) and operator-route branching. Reuse the *pattern* (glyph + trailing `<kbd className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-text-secondary">`), not the component.

## What Changes

### 1. Mount model: the compose surface always mounts; the strip forks expanded ⇄ tongue

Today (`app/frontend/src/app.tsx` ~L3825–3845):

```ts
const composeStripVisible = composeStripEnabled || operatorPage;
const inTileDock =
  composeStripEnabled &&
  !operatorPage &&
  !isMobile &&
  !!windowParam &&
  !selectionBroadcastKeys &&
  layout.order.includes("tty");
// footer: {composeStripVisible && !inTileDock && composeStripElement}
// tile:   ttyDockContent={inTileDock ? composeStripElement : undefined}
```

and `app/frontend/src/components/board/board-page.tsx` L1004: `{composeStripEnabled && <ComposeStrip />}`.

After:

- `composeStripVisible` keeps its name and its role as *the* mount seam but its meaning becomes **"the compose surface — expanded strip or tongue — mounts here"**. On every route that mounts `<Shell>` that is now unconditionally true (the tongue is what "off" looks like), so the value no longer depends on `composeStripEnabled`. Keep the constant/predicate and a comment stating the new semantics rather than deleting the seam — the follow-up change and any future route-level gate hang off it.
- `inTileDock` **drops its `composeStripEnabled &&` term**. The dock is a property of the route/layout, not of the preference: the tongue lives at the in-tile dock on the desktop terminal route exactly where the expanded strip would (via the existing `ttyDockContent` prop `SurfaceLayout` renders as the last child of the first tty tile — `surface-layout.tsx` L2163 `{!mobile && slot === firstTtySlot ? ttyDockContent : null}`), and at the footer dock everywhere else (`bottomBarChildren`, immediately above `<BottomBar>`). The other terms (`!operatorPage`, `!isMobile`, `!!windowParam`, `!selectionBroadcastKeys`, `layout.order.includes("tty")`) are unchanged.
- The board footer mount becomes unconditional: `<ComposeStrip />` (the tongue renders there when off or when no pane is focused).
- No new app-level predicate. The **collapsed/expanded fork lives inside the strip module** (§ 2). `app.tsx` and `board-page.tsx` never read the preference to decide whether to mount.
- The operator page force-on (`composeStripVisible = composeStripEnabled || operatorPage` today) must survive: the operator page keeps the **expanded** strip in the footer dock regardless of the preference. Because the fork moves into the component, the override reaches it as a prop — `forceExpanded={operatorPage}` on the shared element built in `app.tsx` (name is apply's; the board mount and the in-tile dock never pass it). With `forceExpanded`, the component renders the expanded body even when `composeStripEnabled` is false; the on-strip closers still call `toggleComposeStrip()` and flip the preference exactly as today (the strip stays — existing behavior).
- The Host page `/` mounts no Shell and no strip today; it gets no tongue.
- The existing effect that cancels selection-broadcast mode when the preference goes off (`app.tsx` ~L3643) is unchanged — off + broadcast never coexist, so the tongue never has to represent a broadcast target.

### 2. The fork inside `compose-strip.tsx`: a thin wrapper picks tongue vs. expanded body

Structure (the recommended shape — apply may choose the equivalent single-component form if it preserves every seam below):

- The exported `ComposeStrip` becomes a **thin wrapper** taking the existing props (`selectionTarget`, `focusMemoryWindow`, `dockedInTile`) plus the new `forceExpanded?: boolean`. It reads `useChromeState().composeStripEnabled`, `useFocusedTerminal().focused`, and computes `hasTarget = selectionTarget !== null && selectionTarget.keys.length > 0 || focused !== null` (the same predicate the body uses today at L324).
- Decision table (first match wins):

  | `forceExpanded` | `composeStripEnabled` | `hasTarget` | Renders |
  |---|---|---|---|
  | true | any | any | expanded body (today's strip, incl. its disabled no-target form on the operator page — unchanged) |
  | false | false | any | **collapsed tongue** — label "Compose", interactive |
  | false | true | false | **no-target tongue** — label `No focused terminal — click a pane to target it`, inert |
  | false | true | true | expanded body |

  "Off wins over no-target": when the preference is off the tongue always reads "Compose" (its click enables the strip), and only an *enabled* strip with no target shows the no-target line. This keeps the label a truthful description of what a click does.
- The **expanded body is today's component** (rename internally, e.g. `ComposeStripExpanded`; exported name for tests stays `ComposeStrip` on the wrapper). It **unmounts when the tongue shows**, exactly as the whole strip unmounts today. This is deliberate: every mount-keyed seam keeps working byte-for-byte —
  - the mount-time attachment drain (`useEffect` at ~L790: `drain()` on mount + the `COMPOSE_STRIP_ATTACH_EVENT` listener),
  - the focus-on-open consume (`consumeComposeStripFocusOnOpen()` in the mount effect at ~L831 — keyed on the off→on *transition* via the flag `toggleComposeStrip()` marks in `chrome-context.tsx` L270),
  - the focuser registration (`registerComposeStripFocuser` at ~L807 — unregistered while collapsed, so `focusComposeStrip()` returns `false` and every caller's fallback fires: the chord's focus arm falls back to the plain toggle, the bottom-bar ⌨ falls back to `onFocusTerminal`, the restore router's `compose` arm falls back to `tty`),
  - `setComposeStripFocused(false)` on unmount (the bottom-bar hide signal),
  - the per-mount blob-URL map and its unmount revoke.
  A single-component fork that early-returns the tongue *before* these hooks would violate the Rules of Hooks; one that keeps the body mounted behind the tongue would have to re-key all of the above on the enabled transition. Neither is worth it.
- The wrapper does **not** drain the attachment queue itself. The paste-while-collapsed path (§ 5) works through the existing order of operations in `terminal-client.tsx` (`toggleComposeStrip()` then `dispatchComposeStripAttach(files)`): the queued files sit in the module queue until the expanded body mounts and drains them.
- Both tongue forms render inside the **same dock-seam wrapper** the expanded body uses (`border-t border-border bg-bg-primary`, `data-testid="compose-strip-inner"`-style inner div) so the row-growth/refit mechanic is identical: at the footer dock the `auto` grid row grows/shrinks and the terminal's `ResizeObserver` refits; in-tile the tile's flex column does the same. No new resize plumbing.
- The tongue root carries the production `data-compose-strip` marker like the strip root does today (L1226), so the tty tile's pointerdown focus-memory write skips a press on the tongue (a click on the tongue expands and focuses the textarea, whose `onFocus` records `compose`; the marker keeps the wrapper's `tty` write from landing first for the same gesture).

### 3. The collapsed tongue (preference off)

Rendering, in one row:

```tsx
<div data-testid="compose-strip" data-compose-strip>
  <div className="border-t border-border bg-bg-primary px-1.5 py-1 flex items-center">
    <button
      type="button"
      data-testid="compose-tongue"
      aria-label="Show compose strip"
      aria-expanded={false}
      onMouseDown={preventFocusSteal}
      onClick={toggleComposeStrip}
      className="rk-glint flex w-full items-center gap-2 text-xs leading-none text-text-secondary transition-colors hover:text-text-primary coarse:min-h-[36px]"
    >
      <span aria-hidden="true">a▏</span>
      <span>Compose</span>
      {!coarsePointer && chord && (
        <kbd aria-hidden="true" className="ml-auto shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-text-secondary">
          {chord}
        </kbd>
      )}
    </button>
  </div>
</div>
```

- **Glyph**: the `a▏` identity glyph, **static** — the `rk-compose-caret` blink class is applied only while the strip is enabled on the two chips (`status-bar.tsx` L865, `bottom-bar.tsx` L522); the tongue represents the off state, so it never carries the class.
- **Label**: the literal `Compose`. This is the first step of the "Compose text" / `View: Text Input` / `a▏` name unification; renaming the palette entry is the follow-up change's job, **not** this one.
- **Chord**: fine pointers only (`useCoarsePointer()` — already imported by the strip; chords are noise on touch, the same rule the bottom bar applies). Resolved through the existing registry seam the two chips use: `const { bindings, host } = useKeybindings(); chordHintFor("compose-toggle", bindings, host.platform)` (`lib/keybindings.ts` L1030 — the `chordFor` closures in `status-bar.tsx` L737 and `bottom-bar.tsx` L98 are local wrappers over it). It returns nothing when the binding is unbound/disabled, in which case the `<kbd>` is omitted — a hint advertising a dead chord would lie. Expected text: `⌘I` on mac, `⇧Ctrl+E` on win/linux (the registry's `macCode` refinement, [keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § Per-platform default tiers).
- **Click**: fires `toggleComposeStrip()` from `useChromeDispatch()` — the same path as every other opener, so the off→on transition marks the focus-on-open flag and the expanded body focuses its textarea on mount, and the module draft store restores the target's draft. The whole row is the hit target.
- **`onMouseDown={preventFocusSteal}`** (`e.preventDefault()`), consistent with every other strip button — the click must not move focus to the button before the textarea mounts and takes it.
- **Vertical budget**: one row, `text-xs leading-none` with `py-1` inside the seam wrapper — roughly 24–26px on fine pointers, at or below the compact strip's chip row (`px-2 py-1.5 text-xs` chips). On coarse pointers the row takes the `coarse:min-h-[36px]` touch floor the strip's chips already use — the same height the compact row's chips have, never taller. Multi-tile layouts must not lose meaningful terminal rows to a hidden feature.
- **Coarse pointers**: the tongue renders (no chord), at the footer dock directly above the `<BottomBar>` row that still carries the `a▏` opener chip. The two do not stack awkwardly: the tongue is a thin secondary-ink row inside the dock seam, the bottom bar keeps its own `border-t-[3px]` frame below it, and BottomBar's own gate (`if (!coarse || composeFocused) return null`) is untouched.
- **`aria-pressed`** is *not* used on the tongue (that state belongs to the chips, which toggle); the tongue is a one-way "show" control, hence `aria-expanded={false}`.

### 4. The no-target tongue (preference on, `focused === null`, not broadcast)

Replaces today's full disabled card (disabled textarea + disabled 📎 + disabled Send + `→ no target` header + × close).

- Same dock-seam wrapper, same single-row height, **inert**: a non-button element (`role="status"`, `data-testid="compose-tongue"` with `data-state="no-target"` — or a sibling test id; apply's call, but the e2e must be able to tell the two tongues apart), reading the existing copy verbatim: `No focused terminal — click a pane to target it` (the string currently at `compose-strip.tsx` ~L369 — hoist it to a named constant shared by the placeholder-education path so the two cannot drift). Leading `a▏` glyph, static; **no `<kbd>`** (the chord toggles the preference, which changes nothing visible in this state).
- It is inert because a click cannot produce an expanded strip and a toggle with no visible effect is a confusing control. Closing the preference from this state stays reachable via the chord, the palette, and the two chips — the same set that already satisfies Constitution V.
- Where it shows: the board route with no pane selected (`BoardPane` clears `FocusedTerminalContext` on unmount — § Board-pane focus cleanup in memory — so leaving a board for `/$server` also lands here), the `/$server` tiles route, and no-tty layouts before a terminal has registered. The `focusComposeStrip()` focuser is unregistered here too (the body is unmounted), so callers fall back exactly as they do for today's disabled state (today the focuser returns `false` while disabled — same observable result).
- **Selection-broadcast mode is unaffected**: `isSelectionTarget` counts as having a target, so the frozen `→ N selected` card renders exactly as today.
- The `isCard` / `showHeader` branches for `!hasTarget` inside the expanded body become unreachable on the non-operator mounts (the wrapper never renders the body without a target unless `forceExpanded`). Keep the body's `!hasTarget` handling intact for the operator page (which can be target-less under a non-terminal tab) — do not strip it.

### 5. Openers, closers, and the paste/drop path

- **Openers unchanged** (scope control): status-bar `a▏` chip (`status-bar-compose`, `hidden xl:flex`, Tip with chord), bottom-bar `a▏` chip, `View: Text Input` palette action, `Compose: Focus` palette action, the `compose-toggle` chord's three-arm body (`runComposeToggleChord` in `lib/compose-strip-events.ts`: off → toggle on, on+unfocused → focus (decline → toggle), on+focused → toggle off), and `Selection: Send prompt to N agents`. Whether the status-bar chip becomes redundant once the tongue exists is deferred to the default-on follow-up.
- **Closers now collapse to the tongue** rather than to nothing: the on-strip `a|` closer (`compose-strip-a-close`, fine pointers, card and compact) and the header × (`compose-strip-close`) both call `toggleComposeStrip()` — no code change in the closers themselves; the observable change is what replaces the strip. The chord's on+focused arm and both chips likewise land on the tongue.
- **Escape** in the textarea keeps its blur-to-terminal semantics and never collapses.
- **Paste/drop while collapsed** — `terminal-client.tsx` L306–313:

  ```ts
  const attachToStrip = useCallback((files: FileList) => {
    if (files.length === 0) return;
    if (!composeStripEnabled) toggleComposeStrip();
    dispatchComposeStripAttach(Array.from(files));
  }, [composeStripEnabled, toggleComposeStrip]);
  ```

  Unchanged. With the tongue mounted (body unmounted) no listener is registered for `COMPOSE_STRIP_ATTACH_EVENT`, so `dispatchComposeStripAttach` leaves the files in the module hand-off queue; the toggle flips the preference, the expanded body mounts, and its mount-time `drain()` uploads them and inserts the path lines. A file paste while collapsed therefore **expands and uploads** — the required behavior — through the seams that exist. If apply chooses the single-component fork instead, the tongue MUST either keep the event listener live or the expanded body MUST still drain on its own mount; the acceptance test pins the outcome, not the mechanism.
- **Zen mode**: zen hides the top bar, the sidebar, and non-focused tiles; the compose strip and status bar stay ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § ⇧⌘⏎). The tongue is the strip's collapsed form and follows the same rule — visible in zen. No zen code changes.
- **Enter semantics, send path (`sendToWindow` modes), drafts (`compose-draft-store`), sent history, uploads (`useFileUpload`), focus-ownership recording** — all unchanged.

### 6. Tests

**Unit (`app/frontend/src/components/compose-strip.test.tsx`, Vitest + Testing Library, `just test-frontend`).** The file already mounts `ComposeStrip` under the real `ChromeProvider` and drives the preference via `useChromeDispatch().toggleComposeStrip` in local harness components (L811–833, L1222–1228 mirror the *old* caller gating `{composeStripEnabled && <ComposeStrip />}` — update those harnesses to the new unconditional mount and let the component fork). Add:
- preference off + focused target ⇒ tongue with text `Compose`, `data-testid="compose-tongue"`, no `compose-strip-input`, no `rk-compose-caret` class; fine pointer ⇒ a `<kbd>` whose text is the platform chord (drive `stubMatchMedia` for `(pointer: coarse)` as the existing coarse tests do); coarse pointer ⇒ no `<kbd>`.
- clicking the tongue calls `toggleComposeStrip` (preference flips to on) and the expanded body mounts with the textarea focused (the focus-on-open flag path — the existing "focuses the textarea on the open transition" test at L838 is the model).
- preference on + `focused === null` ⇒ the no-target tongue with the exact copy, no textarea, no Send/📎 controls, inert (no `button` role); the existing L203 test ("renders a disabled 'no target' state") is rewritten to this expectation.
- preference on + selection target ⇒ expanded broadcast card (unchanged behavior, pinned).
- `forceExpanded` + preference off ⇒ expanded body (operator-page force-on).
- the `a|` closer and header × collapse to the tongue; the draft survives collapse→expand (the existing L1242 test's assertion updates from "unmounted" to "tongue shown").
- `focusComposeStrip()` returns `false` while the tongue shows.
- a queued attachment dispatched while the tongue shows is drained when the body mounts (mock `uploadFiles` as the existing upload tests do).
- `useKeybindings` may need the existing test seam used by `bottom-bar.test.tsx` for the chord assertion.

**e2e (`app/frontend/tests/e2e/compose-strip.spec.ts`, `just test-e2e compose-strip.spec` — pass `<name>.spec` so the worktree folder name cannot widen the filter).** Every new `test()` carries the Proves/Steps JSDoc; update the file header's shared-setup paragraph (it currently says the strip is "toggled" and unmounts). Add:
- tongue renders when the preference is off at the **in-tile dock** (desktop terminal route: `compose-tongue` inside the first tty tile's frame, `compose-strip-input` absent) and at the **footer dock** (board route).
- clicking the tongue expands and focuses the textarea (`compose-strip-input` focused; the tongue gone).
- the `a|` closer collapses to the tongue (fine pointer), and the draft typed before collapsing is restored on re-expansion.
- the tongue shows the chord on fine pointers (`kbd` text equals the platform chord the status-bar Tip shows) and hides it in the `hasTouch: true` describe.
- the board page with no selected pane shows the **no-target** tongue (exact copy) and no disabled strip; selecting a pane swaps it for the expanded strip (preference on).
- file paste while collapsed expands and uploads: dispatch a synthetic `paste` with a `File` on the terminal (the existing upload e2e pattern), then assert the strip expands, `compose-strip-uploading` appears/clears, and a path line lands in the textarea.
- existing tests whose assertions read "the strip is gone" after a close (e.g. L153 toggle/persist, L214 `a|` closer) update to "the tongue is shown".
- the coarse describe (`hasTouch: true`, 375×812): the tongue renders above the bottom bar, no horizontal overflow, tongue height ≤ 36px, bottom bar still present.

Constitution → Test Integrity: tests conform to this intake/spec, never the reverse.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) § Docked Compose Strip — "Two docks — one mount predicate" (the predicate now selects the dock for the *surface*, `composeStripEnabled` leaves `inTileDock`, `composeStripVisible` means "surface mounts here", the operator page's `forceExpanded` prop), a new § **Collapsed tongue** (the decision table, glyph/label/`<kbd>` rules, inert no-target tongue, vertical budget, coarse placement above the bottom bar, the unregistered-focuser fallbacks, the paste-while-collapsed drain path), "Toggle + persistence" (closers collapse to the tongue; the board footer mount is unconditional), "Live target" (the no-target state is a tongue, not a disabled card), "Chip roster" (the `a|` closer's target state), and Design Decisions: add **"Collapse, don't hide"** (Decision / Why / Rejected: chord-as-glyph, hover-Tip discoverability, Esc-collapses, quake-launcher reuse / Introduced by 260913-kl7u) and amend "Compose-strip dock selection lives in app.tsx as one predicate" + "Dock awareness is a prop threaded from app.tsx's existing predicate" for the new semantics. Also the Bottom Bar paragraph's sentence on the `a▏` chip / `a|` closer family (the tongue joins the family).
- `run-kit/ui/status-signals`: (modify) § Status Bar — the `a` hint is no longer the only fine-pointer surfacing of the `compose-toggle` chord (the tongue shows it in place); one clause, no behavior change to the chip.
- `run-kit/ui/keyboard-and-palette`: (modify) the ⌘I stateful-chord bullet (L108) — "strip off" is now "tongue shown"; the `Selection: Send prompt` bullet's "opens the strip if the preference is off" reads the same but the collapsed form is the tongue. Clause-level.
- `run-kit/ui/focus-ownership`: (modify, only if apply touches a recording seam) the restore router's `compose` arm already states "the registered focuser returns `false` when declined (disabled/unmounted)"; add "or collapsed to the tongue" if the wording needs it. The tongue's `data-compose-strip` marker is covered by the existing carve-out sentence.
- `run-kit/ui/lenses-and-layout`: (modify, one clause) the tty tile's `ttyDockContent` slot now hosts the tongue as well as the strip.
- Spec check: `docs/specs/surface-layout.md` does not mention the compose dock or `ttyDockContent` (grep confirmed — only an unrelated "dock UIs get fiddly" sentence). No spec line is needed; record the check in hydrate.

## Impact

- **Frontend only.** No backend, API, or tmux changes; no new routes, settings, or persisted keys (the `runkit-compose-strip` preference is unchanged in name, sentinel, and default).
- Files: `app/frontend/src/components/compose-strip.tsx` (wrapper + tongue + hoisted no-target copy constant; ~+80/−10 lines), `app/frontend/src/app.tsx` (`inTileDock` drops one term, `composeStripVisible` semantics + comment, `forceExpanded={operatorPage}` on the shared element), `app/frontend/src/components/board/board-page.tsx` (unconditional footer mount), `app/frontend/src/components/compose-strip.test.tsx`, `app/frontend/tests/e2e/compose-strip.spec.ts`. Possibly `app/frontend/src/lib/compose-strip-events.ts` if a constant home for the no-target copy is preferred there.
- **Unchanged by contract**: `chrome-context.tsx`, `terminal-client.tsx`, `status-bar.tsx`, `bottom-bar.tsx`, `quake-launcher.tsx`, `surface-layout.tsx`, `compose-draft-store.ts`, the palette action roster (Constitution V already satisfied by the existing entries — the tongue adds a pointer affordance for an action that is already palette- and chord-reachable, so no new registration).
- **Layout budget**: every Shell route now carries a ≤36px row at the compose dock when the strip is off or target-less. On the desktop terminal route that row is inside the first tty tile (the terminal body shrinks by the tongue height and refits — the same growth-drives-refit mechanic as today's strip). Existing e2e tests that measure the tty tile height or assert "no footer row" when the strip is off may need their expectations adjusted — check `surface-layout`/`mobile-layout`/`bottom-bar`-adjacent specs for assertions on the footer being empty.
- **Control gallery**: the tongue introduces no new `Control` primitive variant, so the `/__controls` screenshot baselines should be untouched; if apply routes the tongue through `controlClass`, re-run `just test-e2e "control-gallery"` and regenerate baselines.
- **Follow-up dependency**: `compose-default-on` (change 2) assumes the tongue, its `compose-tongue` test id, and the wrapper/`forceExpanded` shape.

## Open Questions

- Should the tongue on the **coarse footer dock** be suppressed while the bottom bar's `a▏` chip is visible (one opener instead of two), or is the in-place cue worth the extra row on phones? The discussion said render it, lightweight — recorded as Confident below; revisit in the default-on follow-up with real device screenshots.
- Should the status-bar `a▏` chip be retired once the tongue exists? Explicitly deferred to the default-on follow-up (scope control).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hide-by-unmount is replaced by a collapsed tongue rendered at the same dock (in-tile via `ttyDockContent`, else the shell footer above `<BottomBar>`) | Discussed — the core of the change; `inTileDock` drops the `composeStripEnabled` term so the dock choice is route/layout-only | S:95 R:70 A:90 D:95 |
| 2 | Certain | The tongue = static `a▏` glyph (never `rk-compose-caret`) + literal label `Compose` + trailing `<kbd>` chord on fine pointers only; click fires `toggleComposeStrip()`; `preventFocusSteal` on mousedown | Discussed — specified verbatim in the design | S:95 R:85 A:90 D:95 |
| 3 | Certain | Status-bar `a▏` chip, bottom-bar `a▏` chip, `View: Text Input` palette action, and the `compose-toggle` chord are unchanged; the palette rename is the follow-up's job | Discussed — explicit scope control | S:95 R:90 A:95 D:95 |
| 4 | Certain | Enter semantics, send path, drafts, uploads, focus-ownership recording, and Escape-blurs-never-collapses are unchanged | Discussed — explicit non-goals; an Escape-collapses rung was rejected (Esc must reach the pane) | S:95 R:85 A:95 D:95 |
| 5 | Certain | The tongue follows the strip's zen rule (visible in zen) | Discussed; zen hides only top bar, sidebar, non-focused tiles — no zen code path touches the strip | S:90 R:90 A:95 D:95 |
| 6 | Certain | The disabled no-target state collapses to a tongue reading the existing copy `No focused terminal — click a pane to target it`; selection broadcast (a target) is unaffected | Discussed — specified; copy hoisted to a shared constant so placeholder and tongue cannot drift | S:90 R:85 A:90 D:90 |
| 7 | Confident | The fork is a thin wrapper (`ComposeStrip`) choosing between a tongue and the existing body (`ComposeStripExpanded`); the body unmounts when the tongue shows so every mount-keyed seam (attach drain, focus-on-open consume, focuser registration, blob revoke, focused-signal reset) keeps working unchanged | Design said "inside the strip component (or a thin sibling)"; unmounting the body is what makes paste-while-collapsed and focus-on-open work with zero seam changes; an early-return fork would break Rules of Hooks | S:75 R:75 A:85 D:75 |
| 8 | Certain | The operator page's force-on reaches the component as a `forceExpanded` prop passed only by the `app.tsx` shared element (`forceExpanded={operatorPage}`); it wins over both the preference and the no-target state | Today's `composeStripVisible` (enabled OR operatorPage) must survive the fork moving into the component; a prop is the strip's existing pattern (`dockedInTile`) | S:70 R:85 A:85 D:80 |
| 9 | Confident | "Off wins over no-target": preference off ⇒ the interactive `Compose` tongue regardless of target; only preference on + no target ⇒ the no-target tongue | Keeps the label truthful about what a click does; the alternative (no-target wins) hides the `Compose` label and its chord on the board page until a pane is selected | S:55 R:90 A:75 D:65 |
| 10 | Confident | The no-target tongue is inert (not a button; `role="status"`, no `<kbd>`); the preference remains toggleable via chord/palette/chips | A click could not produce an expanded strip; a toggle with no visible effect is a confusing control; Constitution V is already met by the existing entries | S:50 R:90 A:75 D:65 |
| 11 | Confident | The chord is resolved via the existing `chordHintFor("compose-toggle", bindings, host.platform)` seam over `useKeybindings()` (the `chordFor` closures in status-bar/bottom-bar are local wrappers over it); an unbound/disabled binding omits the `<kbd>` | The design named "the existing `chordFor` seam"; the shared implementation is `chordHintFor` in `lib/keybindings.ts` — reflects rebinds, never advertises a dead chord | S:80 R:90 A:90 D:85 |
| 12 | Certain | `composeStripVisible` keeps its name as the single mount seam with the new meaning "surface mounts here" (true on every Shell route), documented in place rather than deleted; `inTileDock` keeps every other term | Design asked to keep the predicate structure; a reviewer may simplify the constant but the seam name is what the follow-up hangs off | S:75 R:95 A:85 D:70 |
| 13 | Certain | Vertical budget: `text-xs leading-none py-1` inside the dock-seam wrapper (~24–26px fine); `coarse:min-h-[36px]` on coarse — never taller than the compact row's chips | Design set "≈ the compact chip row or less"; the coarse floor is the strip's existing touch-target rule | S:70 R:95 A:85 D:80 |
| 14 | Confident | The tongue renders on coarse pointers too, at the footer dock directly above the bottom bar (whose `a▏` chip stays), as a thin secondary-ink row inside the dock seam; no chord there | Discussed — "must render on coarse too… must not double-stack awkwardly"; the bottom bar's own coarse/compose-focused render gate is untouched | S:70 R:90 A:75 D:70 |
| 15 | Confident | The whole tongue row is the click target (`w-full`), `aria-label="Show compose strip"`, `aria-expanded={false}`, `data-testid="compose-tongue"`; no `aria-pressed` (that state belongs to the toggling chips) | Full-width hit target maximizes discoverability; the tongue is a one-way show control; the a11y attribute choice is apply's to confirm | S:55 R:95 A:80 D:70 |
| 16 | Certain | The tongue root carries the production `data-compose-strip` marker so the tty tile's pointerdown focus-memory write skips presses on it | Same reason the strip root carries it (focus-ownership § the `tty` record's compose-strip carve-out); harmless and consistent | S:60 R:95 A:85 D:80 |
| 17 | Certain | Board footer mount becomes unconditional `<ComposeStrip />`; the Host page `/` (no Shell) gets no tongue | Design: "board page footer" shows the no-target tongue; the Host page mounts no strip today and the design scopes the tongue to "where the strip would otherwise mount" | S:80 R:90 A:90 D:90 |
| 18 | Certain | Existing e2e assertions that read "strip gone after close" update to "tongue shown"; other specs asserting an empty footer or tty tile height when the strip is off may need adjusting | Direct consequence of the mount change; test integrity rule — tests follow the spec | S:70 R:90 A:80 D:85 |
| 19 | Confident | Tongue styling detail: `rk-glint` + `text-text-secondary hover:text-text-primary`, `<kbd>` classes copied from the quake launcher's collapsed control (`rounded border border-border px-1 text-[10px] leading-4 text-text-secondary`) | Reuse the pattern, not the component (design); exact tones are a visual call the apply pass should verify with a screenshot on both themes | S:40 R:95 A:50 D:40 |
| 20 | Confident | The no-target copy constant lives in `compose-strip.tsx` (module-level) rather than `compose-strip-events.ts` | Both consumers (placeholder, tongue) are in one file; moving it to the events module would be premature | S:40 R:98 A:70 D:55 |

20 assumptions (13 certain, 7 confident, 0 tentative, 0 unresolved). No decision scored Unresolved — nothing deferred under the promptless-dispatch carve-out.
