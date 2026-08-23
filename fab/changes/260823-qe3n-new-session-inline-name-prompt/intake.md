# Intake: New Session Inline Name Prompt

**Change**: 260823-qe3n-new-session-inline-name-prompt
**Created**: 2026-08-23

## Origin

One-shot `/fab-new` invocation with a detailed behavioral description plus an explicit coordination note from a sibling session working in parallel in this repo.

> New session flow: inline name prompt with prefilled default. The existing 'New session' keyboard shortcut no longer creates a session instantly — it opens a small inline name input pre-filled with the auto-generated session name. Enter accepts the default (today's behavior plus one keystroke), typing overrides it, Escape cancels. No second chord, no separate 'Create session with name...' binding. The command palette's 'New session' action goes through the same prompt — one flow, two entry points. Rationale: a named-session variant doesn't deserve its own chord; the single chord covers both behaviors, mirroring the Cmd-S/save-as mental model.

**Coordination note (verbatim constraint, from the operator hand-off)**: another change in this same repo is separately doing (a) removal of the browser-specific alternate shortcut bindings + 'desktop' tags in the shortcuts help panel, (b) a Constitution Principle V amendment (palette = complete action registry), and (c) session-as-group descriptor copy. Expected light overlap on the shortcuts help panel and palette registration copy for the New session row specifically. This change stays strictly scoped to the prompt behavior/flow — the inline input component, its keybinding wiring, and the palette action calling it — and does NOT rewrite the shortcuts help panel or palette descriptor copy beyond what's minimally needed to reflect the new behavior. Unavoidable overlap is flagged in § Overlap With Sibling Change below and must be re-flagged in the plan.

## Why

1. **Pain point**: session creation today is a fork with no middle ground. The chord/palette `Session: Create` path is instant with an auto-derived name (`deriveInstantSessionName` — cwd basename, deduped `-2`/`-3`…), and the only way to name a session at creation is the heavier `Session: Create at Folder` dialog (name + path picker). Users who want a *named* session via keyboard must either accept the auto-name and rename afterward, or context-switch into the folder dialog.
2. **Consequence of not fixing**: either a proliferation of rename-after-create round-trips, or pressure to add a second "Create session with name…" chord — spending a scarce keycap on a variant of an existing action (the keybindings registry already documents deliberate keycap conservation, e.g. the reserved-⇧⌘P comment).
3. **Why this approach**: the Cmd-S/save-as mental model — one chord, a prefilled prompt where Enter reproduces today's default and typing overrides it. The default path costs exactly one extra keystroke (Enter); the named path becomes first-class with zero new bindings. One flow, two entry points (chord + palette), so the palette action and the chord can never drift.

## What Changes

### 1. Inline name-prompt component (new)

A new small prompt component (suggested: `app/frontend/src/components/session-name-prompt.tsx`, lazy-loaded like `CreateSessionDialog`) — a minimal centered overlay in the app's dialog idiom, deliberately lighter than `CreateSessionDialog`: a single text input, no path picker, no extra fields.
<!-- assumed: prompt renders as a small centered modal overlay (quick-input style), not an in-sidebar inline edit — the chord fires on routes where the sidebar may be hidden/closed, so an overlay is the only placement that always has a stable anchor -->

Behavior contract:

- **Prefill**: the input opens pre-filled with exactly the name instant-create would have used — `deriveInstantSessionName(currentWindow?.worktreePath, existingNames)` computed at open time. The derivation function and its dedup rules are unchanged.
- **Prefill selected**: the prefilled text is select-all'd on open, so typing replaces the default in one gesture and Enter accepts it untouched.
<!-- assumed: select-all-on-open — "typing overrides it" with a prefilled value implies replace-on-type, the save-as convention -->
- **Enter** submits the current value → creates the session via the existing optimistic path (see § 4).
- **Escape** cancels — closes the prompt, creates nothing, returns focus to the previously focused element (the terminal regains focus on window routes).
- **Empty input + Enter**: no-op (submit requires a non-empty name after trimming); the user can retype or Escape.
<!-- assumed: empty-submit is a no-op rather than falling back to the derived default — simplest rule, trivially reversible -->
- **Typed names** pass through the same live safe-name conversion the existing creation surfaces use (`@/lib/names` — § Live Safe-Name Conversion in routes-and-shell memory), so the prompt cannot produce a tmux-illegal name.
<!-- assumed: reuse the shared safe-name conversion rather than free-text + server-side rejection — matches CreateSessionDialog and the rename flows -->

### 2. Keybinding wiring (changed behavior, no binding changes)

The `create-session` registry row in `app/frontend/src/lib/keybindings.ts` keeps its binding exactly as shipped — `KeyN` shifted base (⇧Ctrl+N win/linux), `macCode: "KeyT"` + `macShellOnly` (⇧⌘T mac shell), palette-only in a mac browser. **No new binding, no second chord, no 'Create session with name…' action** — this is explicit in the request.

What changes is the handler body: `app.tsx`'s `keybindingHandlers` entry `"create-session": fromPalette("create-session")` continues to resolve through the palette action body (the "chord handlers are the palette action bodies" convention), and that body now opens the prompt instead of calling `handleCreateSessionInstant` directly. The chord's dispatch route is untouched — only what the shared body does changes.

### 3. Palette action (same flow, second entry point)

The `sessionActions` entry in `app.tsx` (`id: "create-session"`, label `Session: Create`) swaps `onSelect: handleCreateSessionInstant` for opening the prompt. Because the chord resolves via `fromPalette("create-session")`, changing the one body covers both entry points by construction. The palette label itself stays `Session: Create` (see § Overlap With Sibling Change — descriptor copy is minimally touched).

`Session: Create at Folder` (id `create-session-at-folder`) and its `CreateSessionDialog` are **unchanged** — that remains the path-picking flow.

### 4. Creation path (unchanged plumbing)

Submit calls the existing `executeCreateSessionInstant(server, name, cwd)` optimistic action with the prompt's name and the same cwd the instant path passes today (`currentWindow?.worktreePath || undefined`): ghost session, rollback on error, error toast, and the `isSessionCreatePending` concurrent-create guard all apply unchanged. The prompt should also respect the pending guard on open/submit (no double-create from a rapid re-invoke).

### 5. Entry points that do NOT change

Strictly out of scope — these keep instant creation with the auto-derived name:

- Sidebar server-header `+` / empty-state `+ New Session` (`handleSidebarCreateSession`, including the cross-server branch with no cwd)
- `SessionTiles` "+ New Session" dashed tile on `/$server`
- Board page `ServerGroup` `+` (`board-page.tsx`'s own `handleCreateSession`)

The board route registers no `create-session` chord handler today (the `sessionActions` palette group is AppShell-scoped), so the chord continues to fall through untouched there — no board work needed.

### 6. Tests

- Unit tests for the prompt component (prefill, select-all, Enter/typed-name/empty/Escape arms), colocated `.test.tsx`.
- A Playwright e2e covering chord-or-palette → prompt → Enter-accepts-default and typed-override, plus its sibling `.spec.md` companion (constitutional requirement for new/modified `.spec.ts`).

## Overlap With Sibling Change (flagged, per the coordination note)

Two shared surfaces where this change makes only the **minimal** edit and the plan must call them out:

1. **`lib/keybindings.ts` `create-session` row copy** — the row's `description: "create a tmux session"` remains factually true and is left untouched; only if review finds it misleading may it be minimally amended (e.g. "create a tmux session (prompts for name)"). The sibling change is removing browser-alternate bindings + 'desktop' tags in the shortcuts panel — this change does not touch the shortcuts panel at all.
2. **Palette `Session: Create` registration in `app.tsx`** — this change edits the row's `onSelect` body (required) and nothing else about the row (label/descriptor copy untouched). The sibling change owns descriptor-copy rewrites (session-as-group copy, Principle V amendment).

If merge-order conflicts arise on these two hunks, they are line-local and mechanically resolvable; neither change should reflow the surrounding registration blocks.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) `create-session` chord/palette semantics — the shared action body becomes a prompt opener instead of instant creation; binding data unchanged
- `run-kit/ui/routes-and-shell`: (modify) § Session Creation Pattern — the chord/palette entry points move from "instant, no dialog" to the prefilled prompt; the sidebar/tiles/board entry points stay instant
- `run-kit/ui/dialogs-and-state`: (modify) new session-name-prompt component joins the dialog/overlay inventory

## Impact

- `app/frontend/src/app.tsx` — palette `sessionActions` `create-session` body, prompt open-state + mount, submit wiring into `executeCreateSessionInstant`
- `app/frontend/src/components/session-name-prompt.tsx` (new) + colocated `.test.tsx`
- `app/frontend/src/lib/keybindings.ts` — expected zero or one-line copy touch (see Overlap § 1)
- `app/frontend/tests/` — one new/extended e2e spec + `.spec.md` companion
- No backend, API, or keybinding-registry schema changes; no new routes (Constitution IV untouched); keyboard-first preserved (Constitution V — the action stays chord- and palette-reachable)

## Open Questions

- None — the request is fully specified; remaining choices are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Only the chord and the palette `Session: Create` route through the prompt; sidebar `+`, SessionTiles tile, board `+`, and `Create at Folder` are untouched | Explicit "one flow, two entry points" + coordination note demands strict scoping | S:90 R:80 A:85 D:85 |
| 2 | Confident | Prompt is a small centered modal overlay (quick-input style), not an in-sidebar inline edit | "Small inline name input" + save-as model; sidebar can be hidden/zen-hidden where the chord still fires, so an overlay is the only always-anchored placement | S:55 R:85 A:70 D:55 |
| 3 | Certain | Prefill = `deriveInstantSessionName(currentWindow?.worktreePath, existingNames)` at open time — Enter on the untouched default reproduces today's outcome exactly | "Pre-filled with the auto-generated session name" names today's derivation; function unchanged | S:90 R:85 A:90 D:90 |
| 4 | Confident | Prefilled text is select-all'd on open so typing replaces it in one gesture | "Typing overrides it" implies replace-on-type; the save-as convention | S:65 R:90 A:75 D:70 |
| 5 | Confident | Typed names pass through the shared live safe-name conversion (`@/lib/names`) | Matches CreateSessionDialog and rename flows; prompt must not produce tmux-illegal names | S:60 R:85 A:85 D:80 |
| 6 | Confident | Empty input + Enter is a no-op (trimmed non-empty required); Escape is the cancel path | Simplest rule, trivially reversible; alternative (fall back to default) is a one-line change | S:35 R:90 A:55 D:50 |
| 7 | Confident | Escape closes without creating and returns focus to the previously focused element | "Escape cancels" is explicit; focus-return is the app's dialog convention | S:75 R:85 A:75 D:80 |
| 8 | Certain | Submit reuses `executeCreateSessionInstant` unchanged (optimistic ghost, rollback, toast, pending guard) | The plumbing exists and the request changes only what precedes it | S:85 R:85 A:90 D:90 |
| 9 | Confident | Shortcuts-panel and palette descriptor copy are minimal-touch: binding row copy left as-is (still factually true), palette label `Session: Create` unchanged | Coordination note constraint; overlap flagged in § Overlap With Sibling Change | S:80 R:75 A:70 D:75 |
| 10 | Confident | The palette entry point opens the same prompt on mobile (no mobile no-op) | The prompt is a modal like existing dialogs that work on mobile; the desktop-only no-op convention applies to stateful focus chords, not openers | S:50 R:85 A:70 D:70 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).
