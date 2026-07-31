# Plan: Host-Switcher Dropdown in the Desktop Shell Titlebar Strip

**Change**: 260731-4bqi-shell-strip-host-switcher-dropdown
**Intake**: `intake.md`

## Requirements

### Frontend Shell Chrome: Strip Host-Switcher Dropdown

#### R1: Centered label becomes the dropdown trigger
When the switcher is enabled (R3), the strip's centered host-name label SHALL render as a clickable trigger — `<active-host-name> ▾` with a subtle hover pill — reusing the SPA top bar's `▾` switcher vocabulary. When the switcher is disabled, the label SHALL render exactly as today: a static, non-interactive centered span.

- **GIVEN** the SPA runs inside the desktop shell and `listShellServers()` resolved a non-empty list
- **WHEN** the strip renders
- **THEN** the centered label is a button reading `<name> ▾` with `aria-haspopup`/`aria-expanded`, and hovering it shows a subtle pill
- **AND** clicking it opens the host menu

#### R2: The trigger is the only no-drag island
A sibling CSS utility class `.rk-shell-no-drag` (`-webkit-app-region: no-drag`) SHALL be added next to `.rk-shell-drag` in `app/frontend/src/globals.css`, and the trigger island (trigger + its menu) SHALL be the only element carrying it. The band itself keeps `.rk-shell-drag` unchanged — no broader no-drag bookkeeping. The class MUST be a CSS utility, never an inline style (`WebkitAppRegion` is absent from React's `CSSProperties`; an inline style would need a forbidden `as` cast).

- **GIVEN** the strip is mounted in the shell
- **WHEN** the user drags any part of the band outside the trigger island
- **THEN** the window moves (drag region intact)
- **AND** clicking the trigger island interacts instead of dragging (`.rk-shell-no-drag` carve-out)

#### R3: Degradation gate — affordance only when the bridge can switch
The dropdown affordance (chevron + click behavior + hover pill) SHALL be gated on `listShellServers()` resolving a **non-empty** list (the command palette's shell-switch precedent — gate on the `servers` group answering, not on `isShell()`). An older shell without the `servers` group keeps today's static label with the `location.hostname` fallback. The `isShell()` mount gate in `AppLayout` is untouched.

- **GIVEN** an older shell whose bridge exposes only `version`/`platform`
- **WHEN** the strip renders
- **THEN** `listShellServers()` resolves `null`, no trigger/chevron/pill renders, and the static `location.hostname` label shows
- **GIVEN** a current shell with registered hosts
- **WHEN** the strip renders
- **THEN** the interactive trigger renders

#### R4: Refetch on open
The host list SHALL be refetched (a fresh `listShellServers()` call) every time the dropdown opens; the mount-time fetch stays as-is for the label + gate. A refetch resolving `null` (denial/rejection) SHALL keep the last known list rather than blanking the menu.

- **GIVEN** the user removed a non-active host via the native `Hosts → Remove "<name>"…` menu (no page reload)
- **WHEN** the dropdown is opened
- **THEN** a fresh `servers.list()` call runs and the menu reflects the mutated list

#### R5: Menu row anatomy
Each menu row SHALL show: (a) the active host marked with ✓ and accent color; (b) the host display name plus the dimmed origin derived from the entry's `url` (names are not unique — the origin disambiguates); (c) a trailing accelerator hint mirroring the native Hosts menu bindings — `⌥⌘1–9` on darwin, `⇧Ctrl+1–9` elsewhere, in list order, capped at 9 (hosts beyond the ninth get no hint). Platform SHALL be read from the bridge's `platform` field (`shellInfo()`). Rows require **no bridge change** (`servers:list` already returns `{id, name, url, active}`).

- **GIVEN** an open menu over hosts `[A (active), B]` on darwin
- **WHEN** rows render
- **THEN** A shows ✓ + accent + its name + dimmed origin + `⌥⌘1`, and B shows its name + dimmed origin + `⌥⌘2`
- **GIVEN** ten registered hosts
- **WHEN** rows render
- **THEN** the tenth row carries no accelerator hint

#### R6: Selection behavior
Selecting a host SHALL close the menu and call `switchShellServer(id)`; the page swaps via the shell's `switchToHost` seam (lastPath capture/restore comes free — no SPA-side path handling). No optimistic UI. A `false` resolution (denial/failure) SHALL surface an error toast (the palette's precedent).

- **GIVEN** an open menu
- **WHEN** the user selects host B
- **THEN** the menu closes, `switchShellServer(B.id)` is invoked, and no SPA-side navigation or optimistic state change occurs
- **AND** if the call resolves `false`, an error toast appears

#### R7: Keyboard-operable menu
Once open, the menu SHALL be keyboard-operable with standard menu semantics following the existing `BreadcrumbDropdown` implementation pattern: `role="menu"`/`role="menuitem"`, ArrowDown/ArrowUp move focus (wrapping), Enter selects the focused row, Escape closes and returns focus to the trigger, outside-click closes, and focus lands on the active row on open. Keyboard switch paths (⌥⌘1–9 / ⇧Ctrl+1–9, palette) remain primary (Constitution V).

- **GIVEN** an open menu
- **WHEN** the user presses ArrowDown, then Enter
- **THEN** focus moves to the next row and Enter activates it
- **WHEN** the user presses Escape
- **THEN** the menu closes and focus returns to the trigger

#### R8: Pure logic lands in `lib/shell-strip.ts`
Menu-row derivation (rows from `ShellServer[]`: id, name, origin, active, hint), the gate predicate (non-empty list ⇒ interactive), and the accelerator-hint mapping (platform → per-index hint string, 9-cap) SHALL be pure functions in `app/frontend/src/lib/shell-strip.ts` beside `activeShellHostName`/`stripInsets`/`stripLabelColor`, covered by the colocated vitest suite.

- **GIVEN** the colocated `shell-strip.test.ts`
- **WHEN** `just test-frontend` runs
- **THEN** the new helpers' behavior (row shape, origin derivation, gate, hint mapping + cap, platform branch) is asserted without mounting the component

#### R9: Unchanged invariants
The strip SHALL stay 28px (`SHELL_STRIP_HEIGHT_PX`), keep the `rk-shell-strip` marker class on `<html>`, keep the darwin symmetric 80px insets / `titlebar-area-*` env insets, and keep `.rk-shell-drag` on the band. The frozen bridge contract (`servers` group naming, channel names, envelope shape) SHALL be untouched; zero new IPC channels and zero `app/desktop` changes.

- **GIVEN** the change is applied
- **WHEN** the diff is reviewed
- **THEN** no file under `app/desktop/` changed, no bridge wrapper in `lib/shell.ts` changed, and the strip's height/marker/inset/drag code paths are byte-preserved

### Non-Goals

- The `+ Add Host…` footer item from the mock — requires ONE new sender-gated IPC channel to the main-side `onAddHost` path; explicitly excluded (intake Assumptions row 12 resolved to strictly SPA-side scope for this change).
- Playwright/e2e coverage — `isShell()` is false in Playwright; verification is vitest + manual shell check (documented intake constraint).
- Any rename/remove/host-management affordance in the dropdown — switch-only, matching the palette's switch-only v1.

### Design Decisions

#### Bespoke menu in the strip component, following the BreadcrumbDropdown pattern
**Decision**: Implement the dropdown as a small bespoke menu inside `shell-titlebar-strip.tsx` that copies `BreadcrumbDropdown`'s interaction contract (menu roles, capture-phase Arrow/Escape handling, outside-mousedown close, focus-on-open), rather than reusing `BreadcrumbDropdown` itself.
**Why**: `BreadcrumbDropdown`'s item shape is `{label, href, current}` — navigation-oriented, single-text rows. The strip rows need the ✓/name/origin/hint anatomy and an id-keyed switch action, and the trigger needs the no-drag island + strip-specific hover pill.
**Rejected**: Extending `BreadcrumbDropdown` with a custom row renderer — a wider generic API for one consumer; the copy is ~80 lines and keeps the shared component's contract small.
*Introduced by*: 260731-4bqi-shell-strip-host-switcher-dropdown

## Tasks

### Phase 1: Setup

- [x] T001 Add the `.rk-shell-no-drag` utility class (`-webkit-app-region: no-drag`) beside `.rk-shell-drag` in `app/frontend/src/globals.css`, with a comment naming the scoped carve-out <!-- R2 -->

### Phase 2: Core Implementation

- [x] T002 [P] Add pure helpers to `app/frontend/src/lib/shell-strip.ts`: `MAX_SHELL_SWITCHER_HINTS` (9), `hostAcceleratorHint(platform, index)` (darwin → `⌥⌘{n}`, else `⇧Ctrl+{n}`, `null` past the cap), `ShellHostMenuRow` type + `shellHostMenuRows(servers, platform)` (id/name/origin/active/hint; origin via `new URL(url).origin` with raw-string fallback), and `stripSwitcherEnabled(servers)` (non-empty-list gate) <!-- R5, R3, R8 -->
- [x] T003 [P] Extend `app/frontend/src/lib/shell-strip.test.ts` covering the new helpers: hint mapping per platform, 9-cap, row derivation incl. origin fallback, and the gate predicate over `null`/`[]`/non-empty <!-- R8 -->
- [x] T004 <!-- rework: review cycle 1 — (a) focus-on-open effect deps [open] only: focusedIndex not clamped/re-seeded when open-time refetch returns a shorter list, roving tabindex breaks (no row at tabIndex=0); (b) with an emptied list mid-open, `open` stays true and the capture-phase keydown effect swallows arrow keys app-wide (preventDefault before count>0 guard) — gate open-effects on interactive / close on empty, guard arrow branch on count>0; (c) should-fix: open-time refetch lacks the cancelled/staleness guard the mount fetch has — out-of-order resolutions leave a stale list rendered; (d) nice: origin-span ternary collapses to plain opacity-60 --> Rework `app/frontend/src/components/shell-titlebar-strip.tsx`: hold the `ShellServer[] | null` list as state (mount fetch kept), render the interactive trigger (`<name> ▾`, hover pill, `rk-shell-no-drag` island, aria attrs) when `stripSwitcherEnabled`, else today's static span; open = refetch (`null` keeps last list) + bespoke menu (`role="menu"`, rows per R5, absolute below the trigger, also `rk-shell-no-drag`); selection closes + `switchShellServer(id)` + failure toast; keyboard per R7; update the component header comment (the "NO interactive elements" claim is now the scoped-island rule) <!-- R1, R2, R3, R4, R5, R6, R7 -->

### Phase 3: Integration & Edge Cases

- [x] T005 <!-- rework: review cycle 1 — add regression tests: shrunk-list reopen keeps a focusable row (tabIndex=0 present), emptied-list-while-open closes/releases arrow keys (no app-wide swallow), out-of-order refetch resolutions keep the freshest list --> Extend `app/frontend/src/components/shell-titlebar-strip.test.tsx` (wrap renders in `ToastProvider`): older-shell/null list → static label + no trigger; non-empty list → trigger renders; open → menu rows show ✓/accent-active, name, dimmed origin, platform hints; open triggers a fresh `list()` call (call-count assertion); row click → menu closes + `switch(id)` called; Escape closes and refocuses the trigger; ArrowDown moves focus <!-- R1, R3, R4, R5, R6, R7 -->
- [x] T006 <!-- rework: review cycle 1 — re-verify after fixes --> Verification: `just test-frontend` green and `cd app/frontend && npx tsc --noEmit` clean; confirm no `app/desktop` or `lib/shell.ts` diffs (R9) <!-- R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Inside the shell with a non-empty host list, the centered label renders as a `<name> ▾` trigger button (aria-haspopup/aria-expanded) with a hover pill, and clicking it opens the host menu
- [x] A-002 R2: `.rk-shell-no-drag` exists in `globals.css` beside `.rk-shell-drag`; exactly the trigger island (trigger + menu) carries it; the band keeps `.rk-shell-drag`; no inline `WebkitAppRegion` style or `as` cast anywhere
- [x] A-003 R3: With `listShellServers()` resolving `null` or `[]`, the strip renders today's static non-interactive label (hostname fallback); the `isShell()` mount gate in `app.tsx` is unchanged
- [x] A-004 R4: Every dropdown open issues a fresh `listShellServers()` call; the mount-time fetch remains for label + gate
- [x] A-005 R5: Menu rows show ✓ + accent on the active host, display name + dimmed origin, and trailing `⌥⌘n` (darwin) / `⇧Ctrl+n` (other) hints in list order capped at 9; platform read from `shellInfo()`
- [x] A-006 R6: Selecting a row closes the menu and calls `switchShellServer(id)`; no optimistic UI; a `false` resolution surfaces an error toast
- [x] A-007 R7: Open menu is keyboard-operable — ArrowDown/ArrowUp move focus (wrapping), Enter selects, Escape closes and returns focus to the trigger, outside-click closes, focus lands on the active row on open. Cycle-1 blockers re-verified FIXED: (a) the clamp effect (`shell-titlebar-strip.tsx:174-182`, deps `[open, rows.length]`) re-seats the roving tabindex when a refetch shrinks the row set — 3 hosts (active last) → refetch returns 1 now leaves exactly one `tabIndex=0` row holding focus; an in-bounds seat is left alone so a same-length or growing refetch never yanks focus mid-arrowing (probed both directions); (b) the close-on-empty effect (`:105-107`) releases `open` when the list empties, and the arrow branch guards on `count === 0` before `preventDefault` (`:139`) — arrow keys are provably not swallowed app-wide during the one-render window (committed test asserts `fireEvent.keyDown` returns `true`).
- [x] A-008 R8: Row derivation, gate predicate, and hint mapping are pure exports of `lib/shell-strip.ts` with colocated vitest coverage

### Behavioral Correctness

- [x] A-009 R1: With the switcher disabled the rendered DOM matches today's static-label strip (no button, no chevron); with it enabled the label text is still the active host's display name with `location.hostname` fallback
- [x] A-010 R4: A refetch resolving `null` keeps the previously fetched list (menu does not blank); a refetch resolving a mutated list re-renders the rows

### Scenario Coverage

- [x] A-011 R5: A test covers the 9-cap (10th host row has no hint) and the origin-disambiguation rendering for duplicate names
- [x] A-012 R7: Tests exercise Escape-close-refocus and ArrowDown focus movement
- [x] A-013 **N/A (deferred-manual)**: R6 manual verification in the real shell (not automatable — `isShell()` false in Playwright): dropdown opens, band still drags outside the trigger, selecting a host swaps the page with lastPath restore. Review verified the automatable substrate: `.rk-shell-no-drag` compiles into the built CSS (`color-mix` pill included), the band retains `.rk-shell-drag`, exactly the trigger wrapper + menu carry the carve-out, and `switchShellServer(id)` is invoked with the row's id.

### Edge Cases & Error Handling

- [x] A-014 R3: An older shell exposing only `version`/`platform` (no `servers` group) renders the static label — no throw, no console error (never-throw wrappers)
- [x] A-015 R5: A malformed entry `url` falls back to rendering the raw string as the origin (no crash)

### Code Quality

- [x] A-016 Pattern consistency: menu markup/interaction follows the `BreadcrumbDropdown` vocabulary (role=menu/menuitem, capture-phase key handling, outside-mousedown close, `text-accent` current row) and the strip's existing style conventions. Verified against `breadcrumb-dropdown.tsx` line-by-line — the interaction contract is copied faithfully. Three residual divergences from the wider repo menu vocabulary are logged as should-fix/nice review findings rather than acceptance failures (they do not violate this item's stated `BreadcrumbDropdown` baseline): the single-select rows use plain `menuitem` instead of the `view-switcher.tsx:176-178` `menuitemradio`+`aria-checked` precedent; the trigger lacks the `<Tip label={open ? undefined : …}>` wrapper every other dropdown trigger carries; and `toggle` uses `setOpen(!open)` where every other toggle in the repo uses the functional updater.
- [x] A-017 No unnecessary duplication: existing utilities reused (`activeShellHostName`, `stripLabelColor`, `stripInsets`, `listShellServers`/`switchShellServer`, `useToast`); no new bridge wrappers
- [x] A-018 Type narrowing over `as` casts in all new/changed frontend code
- [x] A-019 No client polling introduced (the refetch is event-driven — open-time only)

### Security

- [x] A-020 R9: No new IPC channels, no `app/desktop` changes, frozen bridge contract untouched (privilege gating stays main-side)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- A-013 is a manual-verification item (real shell); review verifies the automated remainder and may mark it deferred-manual.

## Deletion Candidates

- `docs/memory/run-kit/ui-patterns.md:1583` — the "deliberately holds **no interactive elements**, so there is no `no-drag` bookkeeping anywhere" claim in § Desktop-Shell Titlebar Strip is now false; the scoped reversal must replace it at hydrate (already tracked in the intake's Affected Memory).
- `docs/memory/run-kit/desktop-shell.md` § Hidden Titlebar & Accent Strip — the matching "whole band is a drag surface with no interactive elements" design decision needs the same scoped-reversal rewrite (tracked in Affected Memory).
- No source symbol, file, branch, or config was made redundant: every pre-existing helper the strip used (`activeShellHostName`, `stripInsets`, `stripLabelColor`, `SHELL_STRIP_HEIGHT_PX`, `SHELL_STRIP_MARKER_CLASS`) still has live call sites, and `BreadcrumbDropdown` keeps all of its existing consumers (the menu is a deliberate copy, not a replacement).
- Not a deletion candidate, but a drift note for hydrate: the mac-vs-other host-switcher accelerator knowledge now exists in THREE places — `app/desktop/src/menu.ts:118,285-288` (`MAX_SWITCHER_ACCELERATORS` + `Alt+Cmd+n`/`Shift+Ctrl+n` binding syntax), `app/frontend/src/components/shortcuts-overlay.tsx:230` (`switcherCaps` segmented keycap array, keyed on `"mac"`), and now `lib/shell-strip.ts` `hostAcceleratorHint` (`⌥⌘n`/`⇧Ctrl+n` display string, keyed on `"darwin"`). The three shapes and platform vocabularies differ intentionally and span the main/renderer process split, so none is extractable today — but a future change to the binding tier must update all three.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Bespoke menu inside `shell-titlebar-strip.tsx` copying `BreadcrumbDropdown`'s interaction contract, not a reuse/extension of that component | Its `{label, href, current}` item shape cannot carry the ✓/origin/hint anatomy or an id-keyed action; intake row 11 defers visuals to existing patterns | S:75 R:85 A:85 D:80 |
| 2 | Confident | Menu positioned `absolute top-full` centered under the trigger (no fixed-position machinery) | The strip band has no `overflow:hidden` ancestor clipping below it (`.app-root` is viewport-sized); `BreadcrumbDropdown` needed `fixed` only for the breadcrumb nav's clip context | S:70 R:90 A:85 D:80 |
| 3 | Confident | Hint strings render `⌥⌘{n}` (darwin) / `⇧Ctrl+{n}` (all other platforms), index-ordered by list position, mirroring `menu.ts`'s `Alt+Cmd+${index+1}` / `Shift+Ctrl+${index+1}` binding order | Intake §4 names exactly these two forms and the 9-cap; list order is the native menu's binding order | S:85 R:90 A:90 D:85 |
| 4 | Confident | Row origin derived as `new URL(url).origin`, falling back to the raw `url` string on parse failure | The store persists origins already (normally identity); the fallback keeps a malformed entry renderable instead of throwing | S:70 R:90 A:90 D:85 |
| 5 | Confident | A refetch-on-open resolving `null` keeps the last known list; the gate keys on current state being non-empty | Never-throw wrappers make `null` a denial signal, not data; blanking an open menu on a transient denial is worse than one-open-stale rows | S:65 R:85 A:85 D:75 |
| 6 | Tentative | Hover pill = `rounded px-1.5 py-0.5 hover:bg-current/15` (currentColor-tinted translucent pill) | The strip background is accent-tinted with a contrast-derived label color, so a currentColor tint reads on any background; exact classes are intake row 11's deferred implementation detail | S:55 R:90 A:75 D:65 |
| 7 | Confident | `+ Add Host…` footer EXCLUDED — intake's deferred row 12 resolved to strictly SPA-side scope (zero new IPC) for this change | Resolution supplied by the orchestrator dispatch; recorded here per the block contract | S:85 R:80 A:90 D:90 |
| 8 | Confident | Selecting the already-active row still calls `switchShellServer(id)` (harmless reload with lastPath restore), and a `false` resolution surfaces the palette's error-toast precedent (`useToast`) | Matches both existing switch consumers — the palette action and the native menu radios — so the three paths behave identically | S:70 R:90 A:85 D:80 |

8 assumptions (0 certain, 7 confident, 1 tentative).
