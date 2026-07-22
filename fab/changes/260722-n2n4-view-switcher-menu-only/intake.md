# Intake: View Switcher Menu-Only Placement

**Change**: 260722-n2n4-view-switcher-menu-only
**Created**: 2026-07-22

## Origin

Promptless dispatch via `/fab-proceed` from a live discussion session (no interactive questioning — decisions below were made in that discussion and are encoded as graded assumptions).

> Move the window-view switcher pill out of the top-bar inline position — it should ALWAYS render inside the top-bar "More controls" chevron overflow menu, never inline in the navbar. The chat lens is not fully functional yet and the user does not want the `[tty|chat]` segmented pill visible in the navbar. Chat must stay fully reachable — only the pill's inline bar placement goes away.

Key decisions reached in discussion:

1. Demote the ViewSwitcher pill from an in-bar overflow-registry candidate to a **menu-only** control: its `ViewSwitcherMenuRows` form (the `View: Terminal` / `View: Web` / `View: Chat` `menuitemradio` rows, already built and wired) becomes its ONLY rendering, in the same chevron menu that hosts the Run Kit update row.
2. Implement as a **generic `menuOnly` flag** on the right-cluster overflow-registry entry type in `app/frontend/src/components/top-bar.tsx` — a registry capability, not a one-off hack — trivially reversible when chat ships by removing the flag.
3. The whole shared pill moves, **including the `[tty|web]` case** on iframe-URL windows — the user accepted that side effect over splitting the unified-switcher contract (spec R4's "one switcher UX").
4. Everything else stays unchanged: `Cmd/Ctrl+.` lens cycle, the command palette `View:` actions, `?view=` deep links, localStorage persistence, and the backend (`chatProvider` keeps being emitted; no server change).

Alternatives explicitly rejected in discussion:

- **Removing the ViewSwitcher component entirely** — would break the web lens (the pill is shared by `[tty|web]` and `[tty|chat]`).
- **Gating `hasChat()` in `app/frontend/src/lib/window-view.ts` behind a feature flag** (hiding chat capability everywhere) — proposed first, rejected by the user: chat must remain available; only the navbar pill placement changes.
- **Splitting the switcher** so web stays inline while chat is menu-only — rejected as uglier; violates the one-switcher contract (spec R4).

## Why

1. **Pain point**: The chat lens is not fully functional yet. Any window with a chat-capable pane surfaces a `[tty|chat]` segmented pill inline in the top bar, advertising a half-finished lens in the most prominent chrome position. The user does not want that pill visible in the navbar.
2. **Consequence of not fixing**: Every chat-capable window keeps showing an inline switcher to a lens that isn't ready, inviting users into a degraded experience — while the alternative quick fixes (removing chat, feature-flagging `hasChat()`) would break or hide functionality the user explicitly wants to keep reachable.
3. **Why this approach**: Moving the pill into the always-present "More controls" chevron menu keeps every lens fully reachable (menu rows + `Cmd/Ctrl+.` cycle + palette actions + `?view=` deep links — Constitution Principle V keyboard-first stays satisfied) while removing the inline advertisement. A generic `menuOnly` registry flag rides the existing overflow machinery — the menu-row rendering (`ViewSwitcherMenuRows`) already exists and is wired — so the diff is small, and reverting when chat ships is deleting one flag.

## What Changes

### 1. Registry capability: `menuOnly` flag (`app/frontend/src/components/top-bar.tsx`)

Add an optional `menuOnly` field to the right-cluster registry entry type (`RegistryEntry`, ~line 46):

```ts
type RegistryEntry = {
  id: string;
  modes: TopBarMode[];
  hidden?: boolean;
  /** When true the entry NEVER renders in-bar (not in the visible row, not in
   *  the measurement probe, not in the fit computation) — its menuRender()
   *  rows ALWAYS render in the overflow menu (subject to `hidden`). */
  menuOnly?: boolean;
  barRender: () => ReactNode;
  menuRender: () => ReactNode;
};
```

Semantics (generic — any entry can opt in):

- A `menuOnly: true` entry is excluded from bar rendering, the hidden measurement probe, and the width-fit computation — it contributes zero pixels to the fit budget.
- Its `menuRender()` output ALWAYS renders in the overflow menu rows (when the entry passes its `modes`/`hidden` gates), in registry (pyramid) order alongside overflowed candidates — the `view-switcher` entry is the first registry entry, so its rows stay the first menu rows.
- `hidden` keeps its existing "renders nowhere" priority over `menuOnly`.

### 2. Flag the `view-switcher` entry

Set `menuOnly: true` on the `view-switcher` registry entry (the first candidate in `rightItems`, ~line 460). Its existing `hidden` gate (terminal mode + `currentWindow` + `onSelectView` + `availableViews.length > 1`) is unchanged. Its `barRender` (the `ViewSwitcher` pill) and the pill component in `app/frontend/src/components/view-switcher.tsx` stay in the codebase intact — unreachable under the flag — so reverting is a one-line flag removal. Comments in both files describing "first candidate / first to yield" in-bar behavior are updated to describe the menu-only state.

### 3. Fit computation / probe exclusion (measurement wiring in `top-bar.tsx`; `app/frontend/src/lib/top-bar-overflow.ts`)

- The candidate pipeline (~lines 629–714) splits: fit candidates = `candidates.filter((e) => !e.menuOnly)`. Only fit candidates render in the hidden probe row (~line 1023) and contribute widths to `computeVisibleCount` — the probe's children must stay index-aligned with the widths array the fit reads.
- `visibleItems` is the fitting suffix of the fit candidates; `overflowItems` = menuOnly entries plus the non-fitting fit candidates, listed in registry order so menu-row ordering is preserved.
- `computeVisibleCount` in `lib/top-bar-overflow.ts` is a pure width-fitting function and needs no signature/behavior change — exclusion happens in the caller; its doc header (which names the ViewSwitcher as the first candidate) is updated.
- Observable result: the `view-toggle` testid no longer appears anywhere in the DOM (bar or probe); the `View: …` `menuitemradio` rows are present in the chevron menu at every width whenever the window offers more than one lens.

### 4. Explicitly unchanged

- `Cmd/Ctrl+.` lens cycle, command palette `View: Terminal/Web/Chat` actions, `?view=` deep links, localStorage lens persistence.
- `app/frontend/src/lib/window-view.ts` (`hasChat()` and capability derivation) — no gating, no feature flag.
- Backend: `chatProvider` keeps being emitted; no server change.
- The chevron menu itself (always-present trailing exempt block) and the update row it hosts.

### 5. Tests (the bulk of the diff)

Per the constitution's Test Companion Docs constraint, **every modified `.spec.ts` gets its sibling `.spec.md` updated in the same commit**. E2E specs must reach non-tty views through the chevron menu rows (or `?view=` deep links where the lens itself, not the switcher, is under test).

- `app/frontend/tests/e2e/top-bar-overflow.spec.ts` (+ `.spec.md`) — the "ViewSwitcher is the first-to-drop candidate (260717-6anu)" describe (~line 281) asserts in-bar presence at wide widths and first-to-yield collapse; rewrite to assert menu-only placement at all widths. Drop-order coverage that used the ViewSwitcher as its subject retargets the new first fit candidate (`split-vertical`).
- `app/frontend/tests/e2e/chat-view.spec.ts` (13 tests, + `.spec.md`) — references the pill/`view-toggle` testid and switches lenses via the chip; route lens switching through the menu rows or deep links.
- `app/frontend/tests/e2e/web-view-lens.spec.ts` (+ `.spec.md`) — asserts the in-bar chip for the `[tty|web]` case; same rework (the whole pill moves, decision 3).
- `app/frontend/tests/e2e/window-heading.spec.ts` — one comment-only ViewSwitcher reference (~line 404); expected comment-only or no change (verify).
- `app/frontend/tests/e2e/connection-budget.spec.ts` — drives chat via `?view=chat` deep links, no `view-toggle` reference found; expected no functional change (verify).
- Unit: `app/frontend/src/components/top-bar.test.tsx` (registry/overflow behavior — add `menuOnly` coverage), `app/frontend/src/components/view-switcher.test.tsx` (pill + menu-rows component tests — component survives, so most tests stand; adjust any that assert in-bar mounting via the top bar).

Run through `just` recipes only (`just test-frontend`, `just test-e2e` / `just pw`), never raw Playwright.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome / window-view lens model sections — the switcher pill is no longer an in-bar overflow-registry candidate; it is menu-only via the generic `menuOnly` registry flag; the chevron menu rows (+ palette/shortcut/deep-links) are the lens-switching surface.

## Impact

- **Frontend-only**; no backend or API change.
- Code: `app/frontend/src/components/top-bar.tsx` (registry type + flag + candidate/probe/fit wiring + comments), `app/frontend/src/components/view-switcher.tsx` (doc comments), `app/frontend/src/lib/top-bar-overflow.ts` (doc header only).
- Tests: the files listed in What Changes §5 — the bulk of the diff by line count.
- UX trade-off (accepted): the pill was the at-a-glance active-lens indicator in the bar; moving it into the menu loses that. tty is the default lens; revisit when chat ships. Spec R4 already accepts "while collapsed into the menu, the marked menu row plus the view content itself carry lens identity" — this change makes that the permanent state.
- Spec drift: `docs/specs/window-views.md` R4 describes space-driven in-bar placement ("the pill stays inline whenever there is room"). Memory/spec alignment is handled at hydrate; specs are human-curated — no spec edit in the apply diff.
- Constitution Principle V (keyboard-first) stays satisfied: menu rows, `Cmd/Ctrl+.` cycle, and palette actions all remain.

## Open Questions

None — all decision points were resolved in the discussion session or are agent-competent implementation details recorded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chat stays fully reachable (menu rows, `Cmd/Ctrl+.`, palette actions, `?view=` deep links, localStorage); no `hasChat()` feature flag | Discussed — user explicitly rejected removing or hiding chat; only the pill's inline placement changes | S:95 R:85 A:95 D:95 |
| 2 | Certain | The whole shared pill moves, including the `tty`/`web` pill on iframe-URL windows | Discussed — user accepted the side effect over splitting spec R4's one-switcher contract | S:90 R:70 A:95 D:95 |
| 3 | Certain | Generic `menuOnly` registry-entry capability, not a one-off view-switcher hack; revert = remove the flag | Discussed — approach agreed in the session; matches the 260715-h1ck registry-as-single-source pattern | S:85 R:90 A:90 D:85 |
| 4 | Certain | Loss of the at-a-glance active-lens indicator in the bar is accepted for now | Discussed — user accepted; tty is the default lens, revisit when chat ships; R4's collapsed-state lens-identity wording already covers it | S:90 R:85 A:90 D:90 |
| 5 | Certain | Backend unchanged — `chatProvider` keeps being emitted; frontend-only diff | Discussed — explicit "no server change"; capability derivation is untouched | S:90 R:90 A:95 D:90 |
| 6 | Confident | Flag named `menuOnly` (over the also-floated `alwaysOverflow`) | Discussion offered both names; `menuOnly` names the resulting placement rather than the mechanism — clearer at the registry read-site; trivially renameable | S:65 R:95 A:85 D:55 |
| 7 | Confident | Keep the `ViewSwitcher` pill component and the entry's `barRender` wiring intact (unreachable under the flag) rather than deleting pill JSX | Follows from the agreed reversibility story ("removing the flag" restores in-bar behavior); pill is also shared plumbing per rejected-alternative 1 | S:65 R:90 A:85 D:65 |
| 8 | Confident | `computeVisibleCount` (lib) keeps its signature/behavior; exclusion is implemented in the top-bar.tsx wiring (probe + widths skip flagged entries, index-aligned) | Codebase answer — the lib is a pure direction-agnostic width fitter; the caller already owns candidate selection | S:60 R:85 A:85 D:70 |
| 9 | Confident | menuOnly entries render their menu rows in registry (pyramid) order — the `View: …` rows stay the first rows in the chevron menu | Matches the existing "menu rows list overflowed controls in registry order" invariant; view-switcher is the first registry entry today | S:60 R:90 A:85 D:70 |
| 10 | Confident | E2E rework strategy: reach non-tty views via the chevron `View: …` `menuitemradio` rows (or `?view=` deep links where the lens, not the switcher, is under test); top-bar-overflow's first-to-yield coverage retargets `split-vertical` as the new first fit candidate | Test Integrity constraint — tests conform to the implementation spec; the menu-row path is the user-visible behavior under test | S:70 R:80 A:80 D:65 |
| 11 | Confident | `connection-budget.spec.ts` (deep-link driven) and `window-heading.spec.ts` (comment-only reference) need no functional changes — verify during apply | Grep shows no `view-toggle` usage in either; both exercise behavior this change keeps (deep links, tty-only heading) | S:60 R:90 A:85 D:75 |
| 12 | Confident | No spec edit in the apply diff — `docs/specs/window-views.md` R4 drift is noted; memory updates at hydrate; specs are human-curated | Discussed — "memory/spec alignment is handled at hydrate"; specs index declares specs human-owned | S:70 R:90 A:75 D:70 |

12 assumptions (5 certain, 7 confident, 0 tentative, 0 unresolved).
