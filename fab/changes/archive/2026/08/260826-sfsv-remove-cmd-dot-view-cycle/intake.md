# Intake: Remove the ⌘. view-cycle chord

**Change**: 260826-sfsv-remove-cmd-dot-view-cycle
**Created**: 2026-08-27

## Origin

Backlog item `[sfsv]` (2026-08-27), one-shot `/fab-new sfsv` with one interactive SRAD question (the settings-chord move):

> Remove the cmd+. shortcut that toggle between the views. It constantly leaves folks onto the Chat View. Let the only way to get to the Chat view be just the command palette. Now that Cmd+. is free, should we move the Settings panel shortcut to Cmd+. from Cmd+, (check against other tools).

**Decision reached in conversation**: the user chose **Keep ⌘,** for `settings-open`. The convention check ran against other tools — ⌘, is the macOS-wide Preferences chord (HIG, VS Code, Slack, iTerm2, Chrome, Safari, Xcode), whereas ⌘. means *Cancel* in macOS dialogs (the HIG Esc-equivalent), *Stop loading* in Safari, *Stop* in Xcode, and *Quick Fix* in VS Code. Moving settings onto a Cancel/Stop-flavored chord would trade a universal convention for the sole benefit of working in a mac browser (where ⌘, is browser-reserved and settings is palette-only). A mac-browser-only ⌘. fallback was also rejected: it would break the registry's one-canonical-chord-per-action rule. So the change scope is **removal only** — ⌘. becomes a deliberately unbound keycap.

## Why

1. **The pain point.** `view-cycle` (⌘. on mac, Ctrl+. on Win/Linux) cycles the current window's *single-tile* lens layouts — `tty → web → chat` (→ `code` where available). Because chat is in the cycle whenever a `chatProvider` is set, a stray or habitual ⌘. (it is adjacent to ⌘, and is the classic Mac "Cancel" chord, so people hit it reflexively) lands the user on the Chat view — a full-tile surface that replaces the terminal, with no lit toggle in the top bar to get back (chat is in `SURFACE_RAIL_HIDDEN`, so it renders no surface-toggle button). Users report being "constantly left on the Chat View."
2. **The consequence of not fixing.** Chat is already a deliberately *demoted* surface (no top-bar toggle, no mobile switch-group button — reachable only via `View: Chat` / `Tile: Show Chat` palette entries and legacy `?view=chat` deep links). The cycle chord is the one remaining *accidental* path into it, undermining that demotion; every other lens is reachable by an explicit chord (⌘1/⌘2/⌘3 tile toggles) or palette entry, so the cycle adds no capability that isn't already covered — only the footgun.
3. **Why removal over alternatives.** (a) *Skip chat in the cycle* would keep a redundant chord whose remaining value (tty↔web↔code) is already served by ⌘1/⌘2/⌘3 and the `View:` palette actions — and would make the cycle's order/description lie in the registry. (b) *Keep the chord but require a confirm* is not a pattern this UI has. (c) Removal is the smallest change that matches the stated intent ("let the only way to get to the Chat view be the command palette"), and every removed reach is still covered by the palette per Constitution V. ⌘. is left **unbound** (user decision above), recorded like the reserved `KeyP` so a later change does not spend it casually.

## What Changes

### 1. Registry — delete the `view-cycle` binding (`app/frontend/src/lib/keybindings.ts`)

Remove the row at `keybindings.ts:301`:

```ts
{ actionId: "view-cycle", code: "Period", tier: "cmd", scope: "terminal", kind: "builtin", label: "Cycle view lens", description: "tty → web → chat" },
```

and every prose reference to it in that module: the file header ("⌘. lens cycle" in the legacy-migrations paragraph, lines ~7 and ~168), the `cmd` tier docstring (`legacy punctuation chords: ⌘K ⌘. ⌘[⌘]` → `⌘K ⌘; ⌘[⌘]`), the `layout-cycle` comment ("joins the legacy `⌘<punctuation>` family beside ⌘. view-cycle" → beside ⌘K / ⌘[⌘]), and the `focus-hop` comment's "Period/Backslash/Comma no-cell precedent" (drop `Period`; `Comma`/`Backslash` remain). The `Period: "."` entry in the keycap-formatting map (`keybindings.ts:858`) **stays** — `formatCombo` must still render a *user override* placed on Period.

Add a **deliberately-unbound record** beside the existing `KeyP` / ⇧⌘digit reservation comments near `DEFAULT_BINDINGS`, stating: `Period` (⌘. / Ctrl+.) is intentionally unbound on every tier — it was the `view-cycle` lens chord until 260826-sfsv; ⌘. is the macOS Cancel/Stop chord (dialogs, Safari stop, Xcode stop) and was mis-hit into the Chat lens; `settings-open` deliberately stays on the OS-conventional ⌘,. (Per code-quality's comment rule, the comment states the *constraint* — do not spend this keycap — not the change ID; the provenance line above is for the intake, git history owns it.)

**Per-device overrides**: the override layer (`localStorage["runkit-keybindings"]`, diffs only) is keyed by `actionId`. Verify how `resolveBindings` treats an override whose `actionId` matches no `DEFAULT_BINDINGS` row (a stored `"view-cycle": {…}` from before this change); it must be **ignored silently** (no throw, no phantom row in the Shortcuts panel, no conflict participation). Add a unit test asserting this if none exists. No migration/cleanup write is needed — the stale key is inert.

### 2. `app.tsx` — remove the ⌘. listener and its refs

Delete the block at `app/frontend/src/app.tsx:1177–1207`: the `viewCycleRef`, `viewCycleBindingRef`, and the `useEffect` that registers the window-level `keydown` handler calling `switchView(nextView(views, active))`. Remove the `nextView` import (`app.tsx:6`). Update the comment above `useKeybindings()` (`app.tsx:1152–1155`, "drives the migrated `⌘.` lens cycle below, …") and the reclaim-predicate comment (`app.tsx:~1163`, "run-kit's chords (palette, view-cycle, code-toggle, …)") to drop the view-cycle mention. `switchView` itself stays — the `View:` palette actions and `Tile:` verbs use it.

### 3. `lib/window-view.ts` — delete `nextView`

`nextView(available, current)` (`window-view.ts:148–156`) has exactly one caller (the removed listener). Delete it and its `describe("nextView (Cmd/Ctrl+. cycle)")` block in `window-view.test.ts` (~line 149). Update the module docstring if it enumerates the cycle (spec R8 reference).

### 4. `lib/palette/view.ts` — drop the cycle hint from `View:` entries

Today `buildViewActions(available, resolved, onSwitch, hints)` decorates every `View: <lens>` entry except `View: Chat` with the *effective* `view-cycle` combo as its `shortcut` hint (`CYCLE_SHORTCUT = "⌘."` default; `shortcutFor` returns `hints.cycle`; `ViewShortcutHints`). With no cycle chord there is no chord that reaches a `View:` destination, so:

- Remove `CYCLE_SHORTCUT`, `shortcutFor`, and the `hints` parameter / `ViewShortcutHints` type; every `View:` entry renders **no** `shortcut` hint (matching `View: Chat` today).
- Update the caller in `app.tsx` (`buildViewActions(currentViews, resolvedView, switchView, { cycle: … })` at ~`app.tsx:3234`) and `palette/view.test.ts` expectations.
- Consequence to note in memory: `View:` entries are palette-only actions; the positional tile chords ⌘1/⌘2/⌘3 remain the keyboard path to tty/code/web *tiles* (toggle semantics, not lens switch).

### 5. Tests — `lib/keybindings.test.ts`

Update, don't merely delete, so coverage of the surrounding mechanisms survives:

| Line | Today | Change |
|------|-------|--------|
| 204 | asserts `view-cycle` resolves `{ code: "Period", tier: "cmd", scope: "terminal" }` | replace with an assertion that no default binding occupies `Period` on any tier (the unbound record) |
| 710–743 | palette-parity map `"view-cycle": ["view-tty","view-web","view-code"]` | remove the entry; `View:` entries no longer have a chord to pair with |
| 1074–1084 | override of `view-cycle` onto ⌘` conflicting with `focus-hop` | re-express using another `cmd`-tier terminal binding (`layout-cycle`) so the ctrl/cmd-tier conflict rule stays tested |
| 1226–1231 | terminal-scope vs board-scope capture (`view-cycle` capturing cmd+BracketRight must not unbind `board-cycle-next`) | re-express with `layout-cycle` as the terminal-scope actor |
| 1386–1387 | `formatCombo({code:"Period",tier:"cmd"})` → `⌘.` / `Ctrl+.` | **keep** — formatting an override on Period is still valid |
| 2175–2176 | `hasReclaimableMatch(Period+meta)` true in `code`/`web` iframes | re-express with `Semicolon` (`layout-cycle`), and add the inverse: Period+meta is **not** reclaimable (falls through to the embedded app) |

Also `app.test.tsx` / any test dispatching a `Period` keydown to assert a lens switch — grep `code: "Period"` across `src/**/*.test.tsx` and convert to a negative assertion (⌘. leaves the lens unchanged). No e2e spec presses ⌘. (verified: `app/frontend/tests/` has no `Period`/`Meta+.` use); `web-view-lens.spec.ts` and `chat-view.spec.ts` already switch lenses via the palette helper `switchLensViaPalette`, so they need no change.

### 6. Stale comments elsewhere

- `lib/window-transition.ts:585` — "covers Cmd+K palette, Cmd+. view cycle, Cmd+B sidebar toggle" → drop the Cmd+. example.
- `lib/window-view.ts` header / R8 references to the cycle chord.
- Any `window-view.ts` / `surface-layout.ts` doc that lists "the `view-cycle` chord" among lens-switch surfaces.

### 7. Docs and specs (hydrate stage)

- `docs/specs/right-panel.md:244–246` (P7): "`⇧⌘.` toggles the last-used surface (the shifted tier of `⌘.`, which is the shipped `view-cycle` lens chord …)" — the collision note is now historical; rewrite to say ⌘./⇧⌘. are both unbound and ⇧⌘. remains available for the panel toggle when that spec is implemented.
- Memory (see Affected Memory) — remove the chord from the default-binding table and the "five further bindings … punctuation chords" paragraph, record the unbound-keycap decision as a Design Decision, and update the lens-switch-surface enumeration in `lenses-and-layout.md` and the `View:` hint column in `boards.md`.

### Explicit non-changes

- **`settings-open` stays exactly as shipped** — `code: "Comma"`, base `shifted`, `macTier: "cmd"`; ⌘, on every mac host, palette-only in a mac browser, ⇧Ctrl+, on Win/Linux. No new claim rows, no fallback.
- **Chat remains reachable** via `View: Chat` (desktop palette), `Tile: Show Chat` (layout palette), and legacy `?view=chat` / `?layout=single:chat` deep links. The user's "only the command palette" reads as *no keyboard chord*; URL deep links are not a shortcut and are load-bearing for e2e (`chat-view.spec.ts`) and sharing.
- No change to ⌘K, ⌘; (`layout-cycle`), ⌘[/⌘] (board pair), ⌘1/⌘2/⌘3, or the mobile top-bar switch group.
- No backend change.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) remove `view-cycle` from the default-binding table and the punctuation-chords paragraph ("Five further bindings" → four); drop ⌘. from the `cmd`-tier definition row; add a Design Decision "Period is deliberately unbound; `settings-open` stays on ⌘," with the convention check as **Why** and the move/fallback options as **Rejected**; update the reclaim-predicate example if it names view-cycle
- `run-kit/ui/lenses-and-layout`: (modify) § lens-switch surfaces and § Palette parity + keyboard shortcuts — remove "The lens cycle chord" bullet; state that on desktop the palette `View:` actions are the only lens-switch surface (already true for chat, now for all) and that `View:` entries carry no shortcut hint; drop `nextView` from the pure-helper enumeration
- `run-kit/ui/boards`: (modify) the `View: …` palette row (line ~247) — remove "`shortcut` hint = the effective `view-cycle` combo"
- `run-kit/ui/dialogs-and-state`: (modify) only if it cross-references the cycle chord beside `settings-open` (the settings-open text itself is unchanged; verify at hydrate)

## Impact

- **Frontend only**: `app/frontend/src/lib/keybindings.ts`, `lib/keybindings.test.ts`, `app.tsx`, `lib/window-view.ts` + test, `lib/palette/view.ts` + test, `lib/window-transition.ts` (comment), possibly `app.test.tsx`.
- **User-visible**: ⌘./Ctrl+. no longer does anything on window routes (falls through — to the embedded app inside a lens iframe, to nothing on a tty tile since xterm does not forward meta chords and Ctrl+. is inert in readline). The Settings → Shortcuts panel lists one fewer terminal-scope binding. `View:` palette entries lose their `⌘.` hint.
- **Persistence**: stale `view-cycle` entries in `runkit-keybindings` localStorage become inert (verified/tested in §1).
- **Specs**: `docs/specs/right-panel.md` P7 wording; `window-views.md` R8 if it names the chord (verify at hydrate).
- **Tests to run**: `just test-frontend` (keybindings, window-view, palette/view, app suites); `just test-e2e "web-view-lens"` and `"chat-view"` as a sibling-surface smoke (they don't press ⌘. but exercise the palette lens path that is now the sole path).

## Open Questions

- None blocking. (Resolved in conversation: settings stays on ⌘,.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `settings-open` stays on ⌘, / ⇧Ctrl+,; ⌘. is left deliberately unbound rather than reassigned | Asked — user chose "Keep ⌘," after the convention check (⌘, = macOS Preferences everywhere; ⌘. = Cancel/Stop) | S:90 R:85 A:80 D:90 |
| 2 | Certain | Remove the whole `view-cycle` binding (all lenses), not just skip `chat` in the cycle | Backlog says "remove the cmd+. shortcut"; tty/web/code remain reachable by ⌘1/⌘2/⌘3 and `View:` palette entries, so no capability is lost | S:85 R:85 A:85 D:80 |
| 3 | Confident | Legacy `?view=chat` / `?layout=single:chat` deep links keep working; "only the command palette" means no keyboard chord | Deep links are URLs, not shortcuts; they are load-bearing for `chat-view.spec.ts` and sharing; trivially revisitable | S:60 R:85 A:80 D:70 |
| 4 | Confident | `View:` palette entries render no `shortcut` hint after removal (drop `CYCLE_SHORTCUT`/`hints` plumbing rather than hint ⌘1/2/3) | ⌘1/2/3 are tile *toggles* with three-state semantics, not lens switches — advertising them on `View:` entries would misdescribe the action; `View: Chat` already renders no hint | S:65 R:90 A:80 D:70 |
| 5 | Certain | Delete `nextView` from `window-view.ts` (single caller) | Code-quality: no dead utilities; the helper has exactly one call site | S:70 R:95 A:95 D:90 |
| 6 | Confident | Stale `view-cycle` localStorage overrides are ignored silently; add a unit test, no migration | Override layer is diff-only keyed by actionId; unknown ids should already be dropped at resolve — verify, test, don't migrate | S:60 R:90 A:75 D:80 |
| 7 | Certain | Record the freed keycap as a deliberately-unbound comment beside the `KeyP` / ⇧⌘digit reservations, and as a memory Design Decision | Existing project pattern for reserved keycaps; prevents a later change re-spending ⌘. casually | S:65 R:95 A:85 D:85 |
| 8 | Certain | Re-express (not delete) the keybindings tests that used `view-cycle` as an actor, using `layout-cycle` (⌘;) as the replacement `cmd`-tier terminal binding | Keeps coverage of conflict scoping, reclaim, and override rules; ⌘; is the closest sibling in the same tier/scope | S:70 R:90 A:85 D:80 |
| 9 | Confident | `change_type` stays `feat` (inferred) | Removal of a user-visible behavior contract is a feature-surface change, not a fix/refactor/chore; no explicit override needed | S:60 R:95 A:75 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
