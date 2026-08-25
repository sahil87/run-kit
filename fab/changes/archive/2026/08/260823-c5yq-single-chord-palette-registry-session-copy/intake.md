# Intake: Single-Chord Shortcut Model + Palette-Registry Constitution Amendment + Session Descriptor Copy

**Change**: 260823-c5yq-single-chord-palette-registry-session-copy
**Created**: 2026-08-23

## Origin

Promptless dispatch (`/fab-proceed`-style orchestrator) carrying a synthesized description from an interactive design discussion with the user. **All user-decided points below are FINAL** — they were settled in that discussion and are not open for re-litigation at apply. Deferred sub-decisions are recorded as `Deferred — promptless dispatch` rows in `## Assumptions`.

> Feature: single-chord shortcut model (drop browser remaps) + palette-completeness constitution amendment + session-as-group descriptor copy. Three coupled parts, one change:
> A) Remove all alternate browser-specific shortcut bindings — one canonical chord per action; browser-reserved chords have no direct browser chord and get a "desktop" tag in the shortcuts help panel (rows stay visible in browser).
> B) Amend Constitution Principle V (Keyboard-First): the command palette is the COMPLETE ACTION REGISTRY — every user-facing action reachable via a keyboard shortcut or UI control MUST also be palette-registered; bump version + Last Amended.
> C) Keep "session" as the canonical noun everywhere; carry the "sessions are grouping utilities" mental model in descriptor/secondary copy at concept-formation moments (palette descriptors, shortcuts-panel descriptions, empty states, onboarding hints).

**Intake-investigation corrections to the dispatch description** (verified against the repo): the description listed `260820-lfla-ntw-keymap-tab-rename` and `260822-ju2p-arrow-tab-session-navigation` as "queued drafts". They are not — **lfla is fully shipped** (all stages `done`; its mac-shell N/T/W keymap, the `macShellOnly` machinery, the app-window pair, and the window→tab copy sweep are already on main) and **ju2p is at review-pr** (arrows shipped). This change therefore *builds on* lfla's shipped machinery rather than colliding with a pending sweep; the "keep C scoped to SESSION descriptors" guidance still stands and is honored.

## Why

1. **The pain point**: several actions today ship *two* default chords — one per surface. The mac desktop shell gets the OS-conventional combo (⌘T new tab, ⌘W close tab, ⇧⌘T new session, ⌘, settings, ⌘N/⇧⌘W app windows) via `macShellOnly` refinements, while a mac browser falls back to a different base combo (⇧⌘N/⇧⌘T/⇧⌘W/⇧⌘,). The shortcuts help panel then renders a `desktop` pill **plus** an "in browser: ⇧⌘N"-style second mapping per row. A per-surface chord is two shortcuts nobody memorizes: it doubles memory load and clutters the panel. Worse, the browser fallbacks for the N/T/W family are themselves browser-reserved (⇧⌘N incognito, ⇧⌘T reopen-tab, ⇧⌘W close-window resolve `disabledReason: "reserved"`), so the advertised second mapping is largely a dead chord.
2. **If we don't fix it**: every future `macShellOnly` action compounds the dual-mapping tax; the help panel keeps teaching chords that don't fire; the browser story for desktop-reserved chords stays implicit instead of being the palette by guarantee.
3. **Why this approach**: one canonical chord per action, with the palette as the *guaranteed* browser path for chords the browser reserves — which is exactly what Constitution Principle V almost says already ("primary discovery mechanism"). Part B closes the gap by making palette registration mandatory for every shortcut/UI-control action, so "no browser chord" is always backed by "palette → action". Part C rides along because the same panel/palette descriptor surfaces are the concept-formation moments where the session-as-group mental model belongs — copy-only, no noun churn.

**Alternatives rejected (user-decided, FINAL)**:
- Keeping distinct browser chord remaps (current behavior) — memorization tax, help-panel clutter.
- A blanket "shortcuts don't work in browser" treatment — wrong; only browser-reserved chords are desktop-only, per-chord.
- Renaming session→group as the UI noun, or "session (group)" brackets — clutter, vocabulary drift vs tmux/CLI/URL surfaces, and tmux has a distinct "session group" concept a rename would collide with.
- Hiding desktop-only shortcut rows in the browser panel — a user who hits ⌘W out of habit must be able to learn why it did the browser thing.
- Adding a second chord for any browser-blocked action — the palette is the browser path.

## What Changes

### A. Keybinding registry — one canonical chord per action

**File**: `app/frontend/src/lib/keybindings.ts` (+ `keybindings.test.ts`).

Today the per-surface remap layer is the `macShellOnly?: boolean` flag: `defaultComboFor(def, host)` applies a binding's mac refinement (`macTier`/`macCode`) only when `!def.macShellOnly || host.shell`, so the same action's DEFAULT combo differs between the mac desktop shell and a mac browser. Six bindings carry it:

| actionId | mac shell (canonical) | mac browser today (the remap being removed) |
|----------|----------------------|---------------------------------------------|
| `create-session` | ⇧⌘T (`macCode: "KeyT"`) | ⇧⌘N base — browser-reserved (incognito) anyway |
| `create-window` | ⌘T (`macTier: "cmd"`) | ⇧⌘T base — browser-reserved (reopen tab) anyway |
| `kill-window` | ⌘W (`macTier: "cmd"`) | ⇧⌘W base — browser-reserved (close window) anyway |
| `settings-open` | ⌘, (`macTier: "cmd"`) | ⇧⌘, base — **currently live in browsers** |
| `new-app-window` | ⌘N (`macCode`, keyless base) | unbound (keyless) |
| `close-app-window` | ⇧⌘W (`macCode`, keyless base) | unbound (keyless) |

**The change**: remove the per-surface layer — the mac refinement becomes the canonical mac default on ALL mac hosts. Concretely: delete the `macShellOnly` field from the `KeyBinding` schema, its gate in `defaultComboFor`, its six occurrences in `DEFAULT_BINDINGS`, and its uses in `settings-shortcuts-panel.tsx` (the host-divergence machinery, § B). <!-- assumed: full schema removal rather than leaving the field dead — no remaining consumer after this change; plan may keep the field only if a concrete consumer surfaces -->

**Browser behavior needs no new machinery**: the canonical combos are already browser-owner claims (`MAC_BROWSER_CMD_CLAIMS` ⌘N/⌘T/⌘W/⌘, ; the `!shell` shifted claims ⇧⌘T reopen-tab / ⇧⌘W close-window), so `resolveBindings` resolves them `enabled: false, disabledReason: "reserved"` in a mac browser — the chord never fires, the action stays palette-reachable, and `withShortcutHints` already omits hints for disabled bindings (no dead chord is ever advertised in the palette or education copy). This resolves-disabled-in-browser path IS the design: no replacement browser chord is added for any of these actions.

**Untouched, by design**:
- The plain **per-platform** refinements (`macTier`/`macCode` without `macShellOnly`: ⌘B sidebar, ⌘D split pair, ⌘I compose, ⌘↑/⌘↓ window pair, ⇧⌘↑/⇧⌘↓ session pair, ⌘[/⌘]/⌘/, ⌘F pair, ⌃` focus-hop) — those are mac-vs-Win/Linux facts, identical across shell and browser on the same platform. Non-reserved chords keep working identically on both surfaces (user-decided: the desktop tag is per-chord, not per-action).
- The **override layer** (`runkit-keybindings` diffs): per-device rebinds keep applying verbatim on both hosts. A browser user who wants a live chord for a reserved action rebinds it — unchanged.
- **Win/Linux** combos (⇧Ctrl+N/T/W etc.): functionally unchanged — their browser hosts already resolve those combos reserved; only the panel presentation (§ B) changes there.

**Known accepted consequence**: `settings-open` currently has a *live* browser chord (⇧⌘,). Under one-canonical-chord with ⌘, canonical, settings becomes palette-only in a mac browser (⌘, is the browser's Preferences claim). This follows from the universal "remove all alternates" decision, but the specific canonical-chord choice for settings is the one instance the user did not name — see Assumptions #14 (deferred).

### B. Shortcuts help panel — desktop tag instead of a second mapping

**File**: `app/frontend/src/components/settings-shortcuts-panel.tsx` (+ its `.test.tsx`; the panel is the settings dialog's Shortcuts tab, which `shortcuts-overlay` ⌘/ opens).

Today's `bindingRow` computes `hostDivergent` from `macShellOnly` defs and renders: a `desktop` pill + the OTHER host's chord as secondary text (`in browser: ⇧⌘N` inside the shell, `in desktop app: ⌘T` in a mac browser), alongside the amber `browser` reserved pill when the effective combo is reserved.

**The change**:
1. **Delete the host-divergence machinery** (the `baseDef`/`otherHostCombo`/`hostDivergent` block and the "in browser:/in desktop app:" secondary text) — with `macShellOnly` gone there is no divergence to surface.
2. **Per-chord "desktop" tag**: a row whose *effective* combo resolves `disabledReason: "reserved"` in a browser host renders its canonical keycaps plus a `desktop` tag (pill idiom, title copy along the lines of "reserved by the browser — works in the desktop app; use the command palette here"). This replaces the current amber `browser` pill in browser hosts — one pill, not two. <!-- assumed: the desktop tag REPLACES the amber `browser` reserved pill (rename + title rewording of the same affordance) rather than rendering beside it — one-pill-per-row keeps the panel clean; both pills today mark the same underlying reserved state -->
3. **Rows stay VISIBLE in the browser panel** (user-decided, FINAL) — no filtering/hiding of desktop-only rows.
4. In the desktop shell, these rows render plain (chord live, no tag): "desktop" is a browser-host presentation of a per-chord fact, not a blanket per-action label.
5. The keyless app-window pair, having gained canonical mac combos in browser resolution (§ A), renders ⌘N/⇧⌘W keycaps + the desktop tag in a mac browser instead of today's "unbound" button — the learnability the user asked for ("hits ⌘W out of habit → learns why"). Their handlers stay bridge-gated absent outside the shell; they are shell-only *actions*, so the palette-completeness guarantee (§ C below) applies per-surface (their palette entries stay `can*ShellWindow()`-gated).

Education-copy consumers already do the right thing and are verified, not changed: the sidebar no-sessions empty state and `withShortcutHints` omit chords for disabled bindings.

### C. Constitution Principle V amendment (the justification for A)

**File**: `fab/project/constitution.md` § V. Keyboard-First. Current text:

> Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary. The command palette (`Cmd+K`) SHALL be the primary discovery mechanism for actions.

**Amended text** (drafted here for state transfer; apply may polish wording without weakening the normative content):

> Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary. The command palette (`Cmd+K`) SHALL be the primary discovery mechanism for actions and the complete action registry: every user-facing action reachable via a keyboard shortcut or a UI control MUST also be registered in the command palette. This guarantees the fallback for chords a surface reserves (e.g. browser-reserved desktop chords) is always palette → action.

**Governance line**: bump `1.8.0` → `1.9.0` and `Last Amended` `2026-08-20` → `2026-08-23` (the file's amendment convention is the single Governance line; minor bump for a material principle extension with no principle removal).

**Registration audit** (B makes registration mandatory): intake investigation verified every action touched by A is palette-registered with `id == actionId` so chord hints attach — `create-session` → `Session: Create`, `create-window` → `Tab: Create`, `kill-window` → `Tab: Kill` (all in `app.tsx`), `settings-open` → `Settings: Open`, `shortcuts-overlay` → `Help: Keyboard Shortcuts`, `new-app-window`/`close-app-window` → `App: New Window`/`App: Close Window` (all in `hooks/use-global-palette-actions.ts`, the app-window pair capability-gated). The plan SHOULD include a light audit task sweeping `DEFAULT_BINDINGS` actionIds against palette registration and flagging any gap as a violation of the amended principle (none found for the affected set during intake).

### D. Session-as-group descriptor copy

Keep "session" as the canonical noun everywhere — **NO renames, NO "session (group)" parentheticals** (tmux/CLI/URL congruence; tmux's own "session group" concept collision). Carry the "sessions are grouping utilities" mental model in descriptor/secondary copy at concept-formation moments, scoped to SESSION descriptors:

1. **Keybinding registry descriptions** (`keybindings.ts` `description` fields, rendered in the shortcuts panel as `label — description`): `create-session` "create a tmux session" → grouping-model copy per the user's example shape, e.g. `New session — a new group of tabs`. `create-window`'s `New tab — in the current session` **stays** (user-cited as already right).
2. **Command-palette action descriptors**: `PaletteAction` (`components/command-palette.tsx`) today has NO description field (`id`/`label`/`shortcut`/`confirmLabel` only). Add an optional `description?: string` rendered as secondary text on palette rows (the panel's `label — description` idiom), and set it on the session concept-formation entries (`Session: Create`, `Session: Create at Folder` in `app.tsx`). Label filtering behavior: the palette filter currently matches labels only; descriptors SHOULD join the filter haystack so "group" finds the session actions. <!-- assumed: descriptor text joins the palette filter haystack — cheap, and the mental-model vocabulary ("group") becomes discoverable; revisit if it produces noisy matches -->
3. **Empty states**: the sidebar no-sessions empty state (`components/sidebar/index.tsx` ~line 2864, currently `` `(no sessions — + new, or ${createSessionChord})` ``) carries the grouping model, e.g. "no sessions — a session groups tabs; + new, or ⇧⌘T". Exact phrasing decided at apply following the examples' shape.
4. **Onboarding hints where sessions are introduced**: intake investigation found the sidebar empty state as the only current no-sessions concept-formation surface; apply sweeps for others (board/server-route empty states) but adds no new onboarding surface.

Window/tab descriptor strings are OUT of this sweep (lfla's shipped window→tab copy owns them) except where a session descriptor and a tab mention share one string (e.g. "in the current session" — kept verbatim).

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) default-binding table (macShellOnly column facts collapse to one canonical mac combo per action), § Per-platform default tiers (macShellOnly removal), § Claimed keys (reserved-resolution now the sole browser story for the N/T/W/, family), the host-divergence row section (rewritten to the per-chord desktop tag), palette registry (PaletteAction description field + session descriptors), education micro-copy.
- `run-kit/ui/dialogs-and-state`: (modify) settings dialog Shortcuts-tab presentation facts if documented there (host-divergence hint removal, desktop tag).
- `run-kit/ui/sidebar`: (modify) no-sessions empty-state copy.

## Impact

- `app/frontend/src/lib/keybindings.ts` + `keybindings.test.ts` — schema field removal, `defaultComboFor` gate, six `DEFAULT_BINDINGS` rows, tests asserting shell/browser default divergence rewritten to assert one canonical default + reserved resolution.
- `app/frontend/src/components/settings-shortcuts-panel.tsx` + `.test.tsx` — divergence machinery removal, desktop tag, pill consolidation.
- `app/frontend/src/components/command-palette.tsx` + palette tests — optional `description` field + row rendering (+ filter haystack).
- `app/frontend/src/app.tsx` — session palette entries gain descriptors; no handler/flow changes (the New-session creation FLOW is explicitly untouched — see Out of scope).
- `app/frontend/src/hooks/use-global-palette-actions.ts` — no structural change expected; audit touchpoint.
- `app/frontend/src/components/sidebar/index.tsx` + sidebar tests — empty-state copy.
- `fab/project/constitution.md` — Principle V amendment + Governance line.
- Playwright e2e: any spec asserting the shortcuts panel's "in browser:" text or the `browser` pill (sweep `app/frontend/tests/`); changed `.spec.ts` files carry their `.spec.md` companions in the same commit (constitution Test Companion Docs).
- No backend, no API, no routes, no database — Constitution I/II/IV/IX untouched.

## Out of Scope (do not fold in)

- The New-session inline name prompt (prefilled default, Enter accepts) — independent change in worktree `matte-marlin`. This change MUST NOT alter the New session action's creation FLOW, only its binding/copy treatment.
- `260820-lfla-ntw-keymap-tab-rename` (shipped) and `260822-ju2p-arrow-tab-session-navigation` (review-pr) — their scopes stand; this change layers on top of lfla's shipped machinery and touches only SESSION descriptor strings.
- Any new second chord for browser-blocked actions; any hiding of desktop-only rows; any session→group rename.

## Open Questions

- `settings-open` canonical chord: ⌘, (mac OS convention; browser palette-only since ⌘, is the browser Preferences claim) vs ⇧⌘, (unreserved on every host — the only affected action for which a works-everywhere single chord exists; costs the shell its OS-conventional ⌘,). The user's examples covered the N/T/W family only. Deferred — promptless dispatch (Assumptions #14).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop the per-surface browser remap layer: one canonical chord per action, the desktop-conventional combo becoming the mac default on ALL mac hosts | User-decided FINAL ("Remove all alternate browser-specific shortcut bindings"); examples name the ⌘T/⌘W/⌘N family with canonical keycaps | S:95 R:80 A:90 D:90 |
| 2 | Certain | Browser-reserved canonical chords get NO replacement browser chord — the palette is the browser path | User-decided FINAL (rejected alternative: "adding a second chord for any browser-blocked action") | S:95 R:85 A:90 D:95 |
| 3 | Certain | Shortcuts help panel: desktop-only rows stay VISIBLE in browser with a "desktop" tag; the "in browser:/in desktop app:" second-mapping hint is removed; the tag is per-chord, not per-action | User-decided FINAL, including the learn-why-⌘W-did-the-browser-thing rationale | S:90 R:90 A:85 D:90 |
| 4 | Certain | Constitution V amended: palette = complete action registry (every shortcut/UI-control action MUST be palette-registered); version → 1.9.0, Last Amended → 2026-08-23 | User-decided FINAL (substance + bump instruction); file's amendment convention is the Governance line | S:95 R:75 A:90 D:90 |
| 5 | Certain | "Session" stays the canonical noun; grouping model carried only in descriptor/secondary copy at concept-formation moments; no renames or parentheticals | User-decided FINAL with rejected alternatives enumerated | S:95 R:85 A:90 D:90 |
| 6 | Certain | Out of scope honored: New-session inline prompt (matte-marlin), lfla/ju2p scopes, no creation-FLOW change; C scoped to SESSION descriptors | User-decided FINAL scope fence; investigation confirmed lfla shipped so collision risk is moot | S:90 R:90 A:85 D:90 |
| 7 | Confident | Mechanism: remove `macShellOnly` (schema field + `defaultComboFor` gate + `DEFAULT_BINDINGS` occurrences + panel divergence machinery); browser disabling rides the EXISTING claims → `disabledReason: "reserved"` resolution | Registry's single-seam design (`defaultComboFor`) makes this the minimal faithful implementation; all six canonical combos are already claim-covered in mac browsers | S:70 R:75 A:85 D:75 |
| 8 | Confident | The desktop tag derives from effective-combo `disabledReason === "reserved"` in browser hosts and REPLACES the amber `browser` pill there (one pill per row); shell rows render plain | User specified the tag "instead of a second mapping"; pill consolidation is the obvious clean rendering — presentational and easily reversed | S:60 R:85 A:70 D:60 |
| 9 | Confident | Palette descriptors: extend `PaletteAction` with optional `description?: string` rendered as secondary row text; descriptor joins the filter haystack | User asked for "command-palette action descriptors"; the type has no such field today, and `label — description` is the established panel idiom | S:60 R:80 A:70 D:60 |
| 10 | Confident | Constitution bump is MINOR (1.9.0): material extension of an existing principle, nothing removed | Semver-style convention consistent with the file's history (1.x minor steps) | S:65 R:90 A:75 D:70 |
| 11 | Confident | App-window pair rows render canonical ⌘N/⇧⌘W + desktop tag in a mac browser (no longer "unbound"); their palette entries stay capability-gated — palette-completeness applies per-surface (shell-only actions need no browser palette entry) | Follows the visible-rows-with-tag decision; the actions are bridge-gated absent outside the shell so a browser palette entry would be a dead verb | S:55 R:80 A:70 D:60 |
| 12 | Confident | Win/Linux is functionally unchanged (base combos keep working in the desktop shell; browsers already resolve ⇧Ctrl+N/T/W reserved) — only panel presentation changes there | Verified in claims data: the shifted N/T/W browser claims are platform-unrestricted | S:70 R:85 A:80 D:75 |
| 13 | Confident | Exact descriptor strings beyond the user's two examples (empty-state phrasing, Create-at-Folder descriptor) are decided at apply following the examples' shape ("a new group of tabs") | Copy-level, trivially reversible, examples set the register | S:45 R:90 A:65 D:45 |
| 14 | Unresolved | `settings-open` canonical chord: ⌘, (OS convention; regresses the currently-live browser ⇧⌘, to palette-only) vs ⇧⌘, (unreserved everywhere — the one affected action where a works-on-both-surfaces single chord exists) | Deferred — promptless dispatch; the user's universal decision covers removing the alternate, but which single chord survives for settings was not named and the two options trade convention against availability | S:35 R:70 A:35 D:25 |

14 assumptions (6 certain, 7 confident, 0 tentative, 1 unresolved).
