# Intake: Quake Terminal Rename

**Change**: 260912-nynf-quake-terminal-rename
**Created**: 2026-09-12

## Origin

One-shot `/fab-new` invocation, seeded from Change 0 of the sequential plan `fab/plans/sahil/26-09-12-quake-terminal-drawer.md` (the 2026-09-12 `/fab-discuss` session on the operator console drawer; design study `docs/wiki/operator-console-drawer-studies.html`). The plan's **Standing context** and **Change 0** sections were read in full and are the source of every decision below.

> Rename the operator console feature to quake terminal and the omnibox to quake launcher across code, test ids, labels, storage keys, memory, and the tutorial topic -- a mechanical rename with zero behavior change. This is Change 0 of the sequential plan at fab/plans/sahil/26-09-12-quake-terminal-drawer.md -- read that file's Standing context and Change 0 sections in full before writing the intake; slug quake-terminal-rename.

Decisions of record carried from the plan:

- The feature currently called the **operator console** (the ⌘J drawer + the top-bar omnibox) is renamed **quake terminal**. The omnibox becomes the **quake launcher**. "Quake console" was offered as the more literal name (three of four drawer tabs are lists) and declined by the user.
- **The operator remains the addressee** in user-facing copy and in identifiers that name who you talk to (`Ask the operator…`, `→ operator`, the `Operator: …` palette rows, `OperatorContextChip`, `useOperatorCompose`). The rename is of the *surface*, not of who you talk to.
- This change goes first so changes 1 (resize) and 2 (docked compose) are authored in the new vocabulary and their review diffs carry no rename noise.
- The plan file and the design study are committed on the `tireless-otter` branch (commit `b36864f0`), **not yet on main** — this change does not depend on them and must not cherry-pick them; the plan is context only.

## Why

1. **The pain point.** The surface is about to be reworked twice (edge/corner resize, then a docked compose that turns the top-bar box into a launcher). Every one of those diffs would touch `operator-console.tsx`, `lib/operator-console.ts`, 16 test ids, palette labels, and the same memory sections. If the vocabulary changes in the same PRs as the behavior, the review diffs become unreadable — a reviewer cannot tell a rename hunk from a behavior hunk.
2. **The name is wrong today.** "Operator console" describes the addressee, not the surface. After change 2 the drawer hosts the compose and the top-bar box is a launcher, so "console" for the drawer and "omnibox" for the box both mislead. "Quake terminal" names what the thing *is* (a quake-style drop-down terminal) and "quake launcher" names what the box *does*.
3. **What happens if we don't.** Changes 1 and 2 ship under the old names; a later rename touches three changes' worth of memory prose and e2e selectors at once, with `git log --follow` broken across the intervening edits.
4. **Why a pure rename, not folded into change 1.** A mechanical rename with zero behavior change is reviewable by diff shape alone (moved files + substituted tokens + green tests). Mixing it with the resize work loses that property. The two persisted-state seams (localStorage keys, keybinding overrides) get a fallback read so *no viewer observes any change* — that is what "zero behavior change" means here.

## What Changes

### Naming map (the whole change reduces to this table)

| Old | New | Scope |
|---|---|---|
| operator console (prose) | quake terminal | memory, specs, tutorial, comments, labels |
| omnibox (prose) | quake launcher | memory, specs, tutorial, comments, labels |
| `OperatorConsole` (component) | `QuakeTerminal` | `components/` |
| `OperatorConsoleTongue` | `QuakeTerminalTongue` | `components/` |
| `OperatorOmnibox` | `QuakeLauncher` | `components/` |
| `requestOperatorConsole` / `OperatorConsoleRequest` / `isOperatorConsoleRequest` | `requestQuakeTerminal` / `QuakeTerminalRequest` / `isQuakeTerminalRequest` | `lib/` |
| `OPERATOR_CONSOLE_EVENT = "rk:operator-console"` | `QUAKE_TERMINAL_EVENT = "rk:quake-terminal"` | `lib/`, all dispatchers |
| `ConsoleMachineState` / `ConsoleSegment` / `ConsoleGeometry` / `ConsoleComposeState` | `QuakeMachineState` / `QuakeSegment` / `QuakeGeometry` / `QuakeComposeState` | `lib/` |
| every other `Console`/`CONSOLE`/`console`-bearing identifier for this surface (`CONSOLE_GEOMETRY_KEY`, `clampConsoleGeometry`, `readConsoleGeometry`, `useConsoleGeometry`, `useConsoleOpacity`, `cycleConsoleMachine`, `getConsoleMachineState`, `resolveConsoleServer`, `clearPendingConsoleRequest`, `drainPendingConsoleRequest`, `OPERATOR_CONSOLE_ROOT_ATTR`, `isOperatorConsoleTarget`, `resolveOperatorConsoleTarget`, `useOperatorConsoleContext`, `ConsoleOpacityControl`, `omniboxMorphed`, `operatorConsoleTabs`, `consoleTab`, …) | the `Quake`/`QUAKE`/`quake` form (`QUAKE_GEOMETRY_KEY`, `clampQuakeGeometry`, …, `QUAKE_TERMINAL_ROOT_ATTR`, `isQuakeTerminalTarget`, `useQuakeTerminalContext`, `QuakeOpacityControl`, `launcherMorphed`, `quakeTerminalTabs`, `quakeTab`) | everywhere |
| `.rk-console-slide` / `.rk-console-closed` / `.rk-console-dragging` | `.rk-quake-slide` / `.rk-quake-closed` / `.rk-quake-dragging` | `globals.css` + the components that toggle them |
| `data-operator-console` root marker | `data-quake-terminal` | `lib/` + `components/` |
| `data-testid="operator-console…"` (12 ids) | `data-testid="quake-terminal…"` | components, Vitest, e2e |
| `data-testid="operator-omnibox…"` (4 ids: bare, `-ghost`, `-input`, `-state`) | `data-testid="quake-launcher…"` | components, Vitest, e2e |

**Untouched by rule** (the addressee, not the surface): `OperatorContextChip` / `operator-context-chip.tsx`, `OperatorChatSubject`, `OperatorChatChipState`, `setOperatorChatSubject`, `useOperatorChatChip`, `useOperatorCompose`, `setOperatorComposeText`, `sendOperatorMessage`, `attachOperatorFiles`, `findOperatorWindow`, `OperatorWindowTarget`, `ASK_OPERATOR_MIN_QUERY`, `OPERATOR_STATE_DOT`, `shouldShowAskOperatorRow`, `resolveFromOrigin`, the `operator` window role, `operator-compose-dialog.tsx` / `operator-compose.spec.ts` (the templated request dialog is a different surface — only its one label assertion changes, below), `TerminalActivityTabs`.

### File renames (9 source/test files + 1 memory file, via `git mv` so history follows)

| From | To |
|---|---|
| `app/frontend/src/components/operator-console.tsx` | `app/frontend/src/components/quake-terminal.tsx` |
| `app/frontend/src/components/operator-console.test.tsx` | `app/frontend/src/components/quake-terminal.test.tsx` |
| `app/frontend/src/components/operator-omnibox.tsx` | `app/frontend/src/components/quake-launcher.tsx` |
| `app/frontend/src/components/operator-omnibox.test.tsx` | `app/frontend/src/components/quake-launcher.test.tsx` |
| `app/frontend/src/lib/operator-console.ts` | `app/frontend/src/lib/quake-terminal.ts` |
| `app/frontend/src/lib/operator-console.test.ts` | `app/frontend/src/lib/quake-terminal.test.ts` |
| `app/frontend/src/lib/palette/operator-console.ts` | `app/frontend/src/lib/palette/quake-terminal.ts` |
| `app/frontend/src/lib/palette/operator-console.test.ts` | `app/frontend/src/lib/palette/quake-terminal.test.ts` |
| `app/frontend/tests/e2e/operator-console.spec.ts` | `app/frontend/tests/e2e/quake-terminal.spec.ts` |
| `docs/memory/run-kit/ui/operator-console.md` | `docs/memory/run-kit/ui/quake-terminal.md` |

All `@/components/operator-console`, `@/components/operator-omnibox`, `@/lib/operator-console`, `@/lib/palette/operator-console` import specifiers move with them (the lazy imports in `app.tsx:237-238` included). The scoped e2e lane becomes `just test-e2e quake-terminal`.

### Persisted per-viewer state — two seams that make the rename observable unless bridged

**1. localStorage geometry/opacity keys** (`lib/quake-terminal.ts`):

```ts
export const QUAKE_GEOMETRY_KEY = "runkit-quake-terminal-geometry";
export const QUAKE_OPACITY_KEY = "runkit-quake-terminal-opacity";
/** Pre-rename names; read as a fallback so viewers keep their drawer size and glass. */
export const LEGACY_QUAKE_GEOMETRY_KEY = "runkit-operator-console-geometry";
export const LEGACY_QUAKE_OPACITY_KEY = "runkit-operator-console-opacity";
```

`readQuakeGeometry()` / `readQuakeOpacity()`: read the new key; when it is absent (`null`), read the legacy key through the same parse-and-clamp path; a corrupt value under either key degrades to the default as today. `writeQuakeGeometry()` / `writeQuakeOpacity()`: write the new key and `removeItem` the legacy key (the `gui-posture.ts` precedent — a legacy key reads once and is removed on the next write). The stored geometry *shape* (`{heightVh, widthPx}`) is unchanged here; change 1 extends it.

**2. Keybinding overrides** (`lib/keybindings.ts`): the ⌘J builtin at `keybindings.ts:318` changes to

```ts
{ actionId: "quake-terminal", code: "KeyJ", tier: "shifted", macTier: "cmd", scope: "global", kind: "builtin",
  label: "Quake terminal", description: "toggle the quake terminal (open+focus ⇄ closed)", mapLabel: "quake", ignoreInputs: true }
```

Overrides are persisted as diffs **keyed by `actionId`** in `localStorage["runkit-keybindings"]`, so a viewer who rebound or disabled ⌘J would silently lose that override. `parseOverrides()` therefore maps a stored `"operator-console"` entry onto `"quake-terminal"` when no `"quake-terminal"` entry is present (a new-id entry always wins); `writeStoredOverrides()` never emits the legacy id (the next write drops it). This is a read-side id migration, not an `aliasOf` alias — an alias would register a phantom second action. The `app.tsx:451` handler map key and the `keybindings.test.ts:811` palette-id ↔ action-id agreement table follow the new id.

### Palette, labels, aria, settings row

| Surface | Old | New |
|---|---|---|
| Palette id + label (`lib/palette/quake-terminal.ts`) | `id: "operator-console"`, `label: "Operator: Open console"` | `id: "quake-terminal"`, `label: "Operator: Open quake terminal"` |
| Palette ids for the segment rows | `operator-console-list` / `-log` / `-tasks` | `quake-terminal-list` / `-log` / `-tasks` — labels `Operator: Show cron list` / `Show cron log` / `Show tasks` **unchanged** |
| Drawer root + mobile tongue `aria-label` | `"Operator console"` | `"Quake terminal"` |
| Header collapse button `aria-label` | `"Collapse operator console"` | `"Collapse quake terminal"` |
| Settings dialog row (`settings-dialog.tsx:250-251`) | `"Operator console opacity"` / `"Desktop console drawer background; 100% turns off the blur"` | `"Quake terminal opacity"` / `"Desktop quake terminal background; 100% turns off the blur"` |
| e2e `describe` title | `"Operator console"` | `"Quake terminal"` |

**Unchanged user-visible copy** (addressee, not surface): launcher placeholders `Ask the operator…` / `Ask…`, the segment strip `Operator Terminal | Operator Tasks | Cron List | Cron Log`, the toast `already viewing the operator — nothing to open`, the overflow-menu row's operator wording, the `?tab=` / `?from=` search params and their values.

### Tests that select by the old names (update selectors, never flows)

- e2e: `quake-terminal.spec.ts` (renamed; test ids, `Open console` palette filter + `/^Operator: Open console/` option regex → `Open quake terminal` / `/^Operator: Open quake terminal/`), `operator-compose.spec.ts:234` (the `"Operator: Open console"` count-1 assertion), `status-bar.spec.ts:444`, `operator-pinned-row.spec.ts:140,172`, `operator-session-promotion.spec.ts:115`, `web-view-lens.spec.ts:639`, `window-heading.spec.ts:116,693` (+ their intent comments, per the Test Intent Comments constraint — same commit, no change-ID citations).
- Vitest: every colocated `*.test.ts(x)` that names a test id, label, storage key, action id, or import path above (`compose-strip`, `settings-dialog`, `sidebar/index`, `status-bar`, `terminal-activity-tabs`, `terminal-client`, `keybindings`, `router-url` and the four renamed suites). Behavior assertions stay identical; only names move.
- Palette substring-collision rule: `Open quake terminal` collides with no other row label.

### Memory (the rename *is* the spec-level change, so memory moves with it)

- `ui/operator-console.md` → `ui/quake-terminal.md`: title `run-kit UI — Quake Terminal`; frontmatter description rewritten in the new vocabulary (`rk:quake-terminal` event seam, "the quake launcher + shared compose lanes"); every requirement/scenario/DD body substitutes the vocabulary. Design Decision headings that carry the old names are renamed in place (`The omnibox is the console's compose relocated…` → `The quake launcher is the quake terminal's compose relocated…`, `Desktop standing affordance is the omnibox` → `… is the quake launcher`, `One input per form factor — the desktop drawer is output-only` keeps its meaning). *Introduced by* lines and `(02jx)`-style change-ID citations are history and stay verbatim.
- Inbound links: 20 × `](/run-kit/ui/operator-console.md)` and 1 × same-directory `](operator-console.md)` across 12 files (`operator-actuation`, `agent-send`, `cron`, `ui/index`, `ui/cron-console-tabs`, `ui/compose-and-bottom-bar`, `ui/routes-and-shell`, `ui/dialogs-and-state`, `ui/top-bar`, `ui/status-signals`, `ui/keyboard-and-palette`, `ui/focus-ownership`) retarget to `quake-terminal.md`. Resolve relative links over the **whole** `docs/memory/run-kit/ui/` folder, not only the `](/run-kit/…)` form (project memory: a file move breaks same-dir links).
- Prose in the other memory files that mention the surface (`ui/focus-ownership` — its `## The Operator Console's Own Focus Return` and `### The operator console keeps a guarded origin ref…` headings, `ui/top-bar`, `ui/keyboard-and-palette` — `### The operator console chord reclaims KeyJ…`, `ui/routes-and-shell` — `## Operator Console Overlay`, `ui/cron-console-tabs`, `ui/dialogs-and-state`, `ui/compose-and-bottom-bar`, `ui/visual-design`, `ui/terminal`, `ui/status-signals`, `ui/sidebar`, `ui/lenses-and-layout`, `operator-actuation`, `cron`, `agent-send`) substitutes the vocabulary; `cron-console-tabs.md` **keeps its filename** (its subject is the cron tabs, not the drawer) and only its prose changes.
- `fab docs-index` regenerates `docs/memory/run-kit/ui/index.md` and `docs/memory/run-kit/index.md`.

### Specs and the tutorial topic

- `docs/specs/cron.md:27-28,359,404` and `docs/specs/agent-messaging.md:60`: vocabulary substitution only (e.g. `the operator console (quake drawer + top-bar omnibox)` → `the quake terminal (the drawer + the top-bar quake launcher)`); no design content changes.
- Tutorial topic: the canonical file is `docs/site/skill/tutorial.md:61` (`drops the operator console under the top bar; type into the top-bar box ("Ask…")` → `drops the quake terminal under the top bar; type into the quake launcher ("Ask…")`). Re-run `scripts/sync-skill.sh` so the embedded copy `app/backend/cmd/rk/skill/tutorial.md` stays byte-identical — the Go drift-guard `TestSkillEmbedMatchesCanonical` fails otherwise (shll `skill` standard: byte-identical, ≤150 lines; no lines are added). The rendered tour page `app/frontend/public/tutorial/tutorial.html:257` (`the operator console drops down`) follows.
- `README.md`, `docs/site/skill.md`, other `docs/site/*.md`, `app/desktop/`, `app/code-bridge/`, `scripts/`, and Go sources carry no occurrences (verified 2026-09-12).

### Explicit non-goals

- Any layout, focus, geometry, opacity, or Esc-ladder change; any change to the mobile arm's behavior (renamed only); the templated-vs-direct send fork; the tmux status bar.
- Renaming the `operator` window role, `_rk-operator`, `rk operator …` CLI, or anything in `app/backend/api/operator.go`.
- Rewriting history: `fab/changes/**` intakes/plans, `fab/backlog.md`, `fab/plans/**`, `docs/wiki/*.html` (incl. the not-yet-on-main `operator-console-drawer-studies.html`), and *Introduced by* / change-ID citations stay as written.

## Affected Memory

- `run-kit/ui/operator-console`: (remove) moved to `run-kit/ui/quake-terminal` via `git mv`
- `run-kit/ui/quake-terminal`: (new) the renamed file — same requirements and design decisions in the new vocabulary
- `run-kit/ui/focus-ownership`: (modify) section headings + prose: operator console → quake terminal, omnibox → quake launcher
- `run-kit/ui/top-bar`: (modify) center-cell / omnibox prose → quake launcher; `launcherMorphed`
- `run-kit/ui/keyboard-and-palette`: (modify) ⌘J chord row, action id `quake-terminal`, palette label `Operator: Open quake terminal`, the KeyJ DD heading
- `run-kit/ui/routes-and-shell`: (modify) `## Operator Console Overlay` → `## Quake Terminal Overlay`, mount prose
- `run-kit/ui/cron-console-tabs`: (modify) prose only — filename kept
- `run-kit/ui/dialogs-and-state`: (modify) settings-row label, prose
- `run-kit/ui/compose-and-bottom-bar`: (modify) prose + link retarget
- `run-kit/ui/visual-design`: (modify) prose
- `run-kit/ui/terminal`: (modify) prose
- `run-kit/ui/status-signals`: (modify) ◷ chip → quake terminal prose + link retarget
- `run-kit/ui/sidebar`: (modify) prose
- `run-kit/ui/lenses-and-layout`: (modify) prose
- `run-kit/ui/index`: (modify) regenerated by `fab docs-index`
- `run-kit/operator-actuation`: (modify) prose + link retarget
- `run-kit/cron`: (modify) prose + link retarget
- `run-kit/agent-send`: (modify) prose + link retarget
- `run-kit/index`: (modify) regenerated by `fab docs-index`

## Impact

- **Frontend** (`app/frontend/src/`): 9 renamed files plus ~33 other files referencing the surface (`app.tsx`, `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `status-bar.tsx`, `command-palette.tsx`, `compose-strip.tsx`, `settings-dialog.tsx`, `terminal-activity-tabs.tsx`, `terminal-client.tsx`, `cron-list.tsx`, `cron-log.tsx`, `watched-table.tsx`, `server-watched-zone/watched-zone.tsx`, `operator-context-chip.tsx`, `contexts/session-context.tsx`, `hooks/use-global-palette-actions.ts`, `lib/keybindings.ts`, `lib/router-url.ts`, `lib/focused-pane-window.ts`, `globals.css`, and their tests). ~1,800 token occurrences measured 2026-09-12 (`operator-console` 671, `omnibox` 530, `OperatorConsole` 319, prose forms ~160, `OPERATOR_CONSOLE` 37, `operatorConsole` 29, `Omnibox` 30).
- **Event seam dispatchers** (all must move to `requestQuakeTerminal` / `QUAKE_TERMINAL_EVENT`): `app.tsx:451` (⌘J handler), `app.tsx:591` (palette Ask-operator fallback), `app.tsx:964` (the `?tab=` deep-link handoff), `lib/palette/quake-terminal.ts` (4 rows), `status-bar.tsx:287` (◷ chip), `top-bar-overflow-menu.tsx:239`, the mobile tongue. No dispatcher exists outside `app/frontend/src` (desktop shell, code-bridge, Go: none).
- **Persisted state**: two localStorage keys and one keybinding action id, each with a read-side fallback (above). No tmux option, URL, or server-side state carries the old name.
- **Backend**: `app/backend/cmd/rk/skill/tutorial.md` only, via `scripts/sync-skill.sh`; no Go code.
- **Docs**: 1 memory file moved, 18 memory files edited, 2 indexes regenerated, 2 specs touched, the tutorial topic + its HTML tour page.
- **Verification** (never the full suite as a gate): `just test-frontend` (Vitest, includes the TypeScript build of the renamed modules), `just test-e2e quake-terminal`, `just test-e2e window-heading`, `just test-e2e web-view-lens`, `just test-e2e status-bar`, `just test-e2e operator-pinned-row`, `just test-e2e operator-session-promotion`, `just test-e2e operator-compose`; `just test-backend` for the skill drift guard after the sync. A fresh worktree needs `pnpm install --frozen-lockfile` in `app/frontend/` first. A final `grep -rniE 'operator[ -]?console|omnibox'` over `app/ docs/memory docs/specs docs/site` must return only history (`fab/`, `docs/wiki/`, *Introduced by* lines).
- **Sequencing**: strictly before changes 1 (`quake-terminal-resize`) and 2 (`quake-terminal-docked-compose`); each starts from merged main. Light-lane candidate (mechanical). No open PR currently touches these files (the omnibox-focus change `f4s6` merged as PR #849).

## Open Questions

- None blocking. The plan file this change implements is not yet on main (it sits on `tireless-otter`); this change proceeds without it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Names: **quake terminal** (drawer feature) and **quake launcher** (top-bar box); "quake console" rejected | Plan § Decisions of record — user accepted the names in the 2026-09-12 discussion | S:95 R:70 A:95 D:95 |
| 2 | Certain | The operator stays the addressee: `Operator: …` palette rows, `Ask the operator…`, `OperatorContextChip`, `useOperatorCompose`, `findOperatorWindow` and every operator-as-recipient identifier are untouched | Plan § Change 0 naming-map note: "the rename is of the surface, not of who you talk to" | S:95 R:85 A:95 D:90 |
| 3 | Certain | Identifier map: `OperatorConsole*` → `QuakeTerminal*`, `OperatorOmnibox` → `QuakeLauncher`, `Console*` types → `Quake*`, `rk:operator-console` → `rk:quake-terminal`, `.rk-console-*` → `.rk-quake-*`, `data-operator-console` → `data-quake-terminal` | Verbatim from the plan's naming map | S:95 R:80 A:95 D:95 |
| 4 | Confident | Every remaining `Console`-bearing identifier for this surface (`CONSOLE_GEOMETRY_KEY`, `useConsoleGeometry`, `cycleConsoleMachine`, `omniboxMorphed`, `operatorConsoleTabs`, …) also takes the `Quake`/`launcher` form rather than surviving as a mixed vocabulary | The plan lists the headline symbols; leaving the helpers half-renamed would make changes 1–2 inherit the noise the rename exists to remove. Reversible per-symbol | S:75 R:85 A:90 D:80 |
| 5 | Certain | 16 test ids move: `operator-console-*` → `quake-terminal-*` (12), `operator-omnibox-*` → `quake-launcher-*` (4); e2e + Vitest selectors move with them, flows unchanged | Plan footprint table; measured in the tree 2026-09-12 | S:95 R:90 A:95 D:95 |
| 6 | Certain | localStorage keys → `runkit-quake-terminal-geometry` / `-opacity`, with a read-side fallback to the old keys | Plan footprint table: "read the old key once as a fallback so viewers keep their geometry" | S:95 R:85 A:95 D:90 |
| 7 | Confident | The fallback follows the `gui-posture.ts` precedent: read new → else read legacy; the next write writes the new key and removes the legacy one | Codebase precedent for a renamed per-viewer key; removing on write keeps the fallback one-shot as the plan says. Alternative (leave the orphan key) is harmless but unprecedented | S:70 R:90 A:85 D:75 |
| 8 | Confident | ⌘J action id `operator-console` → `quake-terminal`, label `Quake terminal`, description `toggle the quake terminal (open+focus ⇄ closed)`; `parseOverrides()` maps a stored `operator-console` override onto `quake-terminal` when no new-id entry exists | Plan names the id/label change; overrides are persisted by `actionId` in `runkit-keybindings` (`keybindings.ts:146-149`), so without the read-side map a rebound/disabled ⌘J would silently revert — a behavior change the intake forbids. Not an `aliasOf` (would be a phantom action per `keybindings.ts:127-131`) | S:80 R:85 A:90 D:80 |
| 9 | Confident | The shortcuts-map `mapLabel` `"operator"` → `"quake"` | Sibling `mapLabel`s name the surface/action (`compose`, `new tab`, `open`), so the old label named the addressee by the same mistake the rename fixes. Trivially reversible | S:55 R:95 A:80 D:70 |
| 10 | Certain | Palette: id `quake-terminal`, label `Operator: Open quake terminal`; segment-row ids `quake-terminal-list/-log/-tasks` with their `Operator: Show …` labels unchanged; e2e filter/regex updated; no substring collision | Plan footprint table + the standing substring-collision rule; palette ids are not persisted anywhere (verified) | S:90 R:90 A:95 D:90 |
| 11 | Certain | `aria-label`s `Quake terminal` / `Collapse quake terminal`; settings row `Quake terminal opacity` / `Desktop quake terminal background; 100% turns off the blur` | Plan lists the aria-labels; the settings row is the same surface's only other user-facing name | S:85 R:95 A:95 D:90 |
| 12 | Certain | Unchanged copy: `Ask the operator…` / `Ask…`, the segment labels `Operator Terminal` · `Operator Tasks` · `Cron List` · `Cron Log`, the already-viewing toast, `?tab=` / `?from=` params | Addressee rule (#2) + zero-behavior-change; URL params are a resumable-bookmark contract | S:90 R:80 A:95 D:95 |
| 13 | Certain | Source/test files and the memory file are renamed with `git mv` (9 + 1), `operator-context-chip.tsx` keeps its name | Plan footprint (9 files); history following via `--follow` is the reason to rename rather than recreate | S:90 R:85 A:95 D:95 |
| 14 | Certain | Memory: `ui/operator-console.md` → `ui/quake-terminal.md`; 21 inbound links across 12 files retargeted; same-directory relative links resolved over the whole `ui/` folder; indexes regenerated by `fab docs-index`; *Introduced by* lines and change-ID citations stay verbatim | Plan § Standing context "Memory hygiene" + the project memory on split-link breakage; FKF present-truth style keeps provenance untouched | S:90 R:80 A:90 D:90 |
| 15 | Confident | `ui/cron-console-tabs.md` keeps its filename; only prose changes. The other 17 memory files get vocabulary substitution (headings included) | The plan's memory list does not rename it and its subject is the cron tabs, not the drawer; renaming would add a second link sweep for no gain | S:65 R:90 A:85 D:75 |
| 16 | Confident | Specs `cron.md` and `agent-messaging.md` get vocabulary substitution only | Plan lists `docs/specs/cron.md`; specs are human-curated but stale vocabulary in a spec is drift, and no design content moves. `agent-messaging.md:60` was found by grep | S:75 R:90 A:85 D:85 |
| 17 | Certain | Tutorial: edit the canonical `docs/site/skill/tutorial.md`, re-run `scripts/sync-skill.sh`, edit `public/tutorial/tutorial.html`; line budget unchanged | shll `skill` standard (byte-identical embed, ≤150 lines, drift-guard test) + `sync-skill.sh` names the canonical source | S:90 R:90 A:95 D:95 |
| 18 | Certain | History is not rewritten: `fab/changes/**`, `fab/backlog.md`, `fab/plans/**`, `docs/wiki/*.html` untouched | Plan non-goals + `true_impact_exclude: [fab/, docs/]` posture for historical artifacts | S:90 R:95 A:95 D:95 |
| 19 | Certain | Change type `refactor`; verification via `just` recipes scoped to the affected Vitest suites and the 7 e2e specs that select the old names, plus `just test-backend` for the drift guard | Constitution/context: tests only via `just`; plan § Standing context: "never the full suite as a gate" | S:85 R:95 A:95 D:95 |
| 20 | Certain | This change does not cherry-pick or depend on the plan/design-study commit on `tireless-otter`; it branches from current main | Plan says the study "landed on main" but `git log main` and the specs index show it has not; the rename needs nothing from it | S:80 R:95 A:95 D:90 |

20 assumptions (14 certain, 6 confident, 0 tentative, 0 unresolved).
