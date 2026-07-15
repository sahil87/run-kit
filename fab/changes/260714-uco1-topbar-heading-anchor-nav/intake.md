# Intake: Top-Bar Window Heading — Stable Anchor, Hierarchy Dropdown, Window Rename, History Nav Arrows

**Change**: 260714-uco1-topbar-heading-anchor-nav
**Created**: 2026-07-14

## Origin

> Top-bar window heading: stable anchor, hierarchy dropdown, Terminal→Window rename, history nav arrows. Four agreed sub-features, all in the top bar's center page heading (`app/frontend/src/components/top-bar.tsx`): (1) a min-width left-anchored inner container so the heading's left edge stops drifting with name length; (2) replace the lens-dependent `Terminal:`/`Web:`/`Chat:` prefix with a static `Window:` prefix; (3) a NEW hierarchy dropdown (▾ on the prefix word) listing the current page's ancestor chain; (4) NEW browser-history Back/Forward arrows (◀ ▶) left of the prefix.

Dispatched promptless by `/fab-proceed` from a live discussion session — the change description was synthesized from that session, in which an ASCII mockup covering all four sub-features was shown to and approved by the user. All major decisions below were made interactively in that session; no questions were asked at intake (promptless dispatch).

## Why

1. **The pain**: the top bar's center heading (`PageType: name`) is a content-sized element centered in the middle cell of a `grid-cols-[1fr_auto_1fr]` grid (top-bar.tsx:245, center cell at :343 `flex items-center justify-center min-w-0`). Because the element is content-sized and centered, its **left edge drifts horizontally whenever the name length changes** (e.g. `Terminal: abc` → `Terminal: abcdefghijk`), and — same class of bug — the prefix itself changes width when switching view lenses (`Terminal:` ↔ `Web:` ↔ `Chat:` via `terminalHeadingPrefix()`, top-bar.tsx:770), so the name's anchor position jumps on lens switches too. Entering inline-rename also jumps: the rename input (top-bar.tsx:1049) is `text-center`.
2. **The consequence**: the single most important identity on the page visually teleports on window switches, renames, and lens switches — a constant low-grade irritation in a monospace UI whose whole aesthetic is stable, terminal-like alignment.
3. **Missing navigation affordances**: the center heading identifies the page but offers no way up the hierarchy (the left breadcrumb does, but it's a small text target and hidden below `sm`) and no in-app back/forward. Users on touch devices and keyboard-first users both lack good affordances for "go up one level" and "go back to where I was".
4. **Why this approach**: the user explicitly chose **min-width + left-aligned content** over fixed-width + truncate (accepted tradeoff: names longer than the box grow rightward; the box stays centered so rare drift for very long names is acceptable). The user explicitly chose **static `Window:`** over the lens-following prefix — the heading identifies the window (substrate); lens indication belongs to the view switcher (per `docs/specs/window-views.md` "rows are substrates, views are lenses"); the command palette already uses `Window:` vocabulary (e.g. `Window: Rename`). The user explicitly chose **browser-history semantics** for the arrows (NOT sibling-window cycling) and **ancestors-only** dropdown contents (no lateral jumps) to stay predictable.

## What Changes

All four sub-features live in `app/frontend/src/components/top-bar.tsx`. The top bar is a 3-column grid `grid-cols-[1fr_auto_1fr]` (top-bar.tsx:245): left breadcrumb (ends at parent), center `PageType: name` heading, right button cluster.

### 1. Stable left anchor for the center heading

- Keep the center box centered in the grid, but give the **inner heading container** a min-width with left-aligned content — e.g. `sm:min-w-[28ch]` + `justify-start`. The outer center cell (top-bar.tsx:343 `flex items-center justify-center min-w-0`) stays centered; the inner container's fixed min-width is what pins the left anchor.
- **Exact ch value is tuned visually** during implementation: screenshot check across all four page modes — window/terminal, board, server cabin/root, cockpit. `ch` units are exact because the UI is monospace everywhere. Factor in that `Window: ` is 2ch shorter than `Terminal: ` (see §2).
- **Responsive gate**: min-width applies at `sm+` only. Below `sm`, current behavior is kept unchanged (the page-type prefix span is already `hidden sm:inline` — top-bar.tsx:816; space is scarce at 375px).
- The **inline-rename input** (top-bar.tsx:1049) is `text-center` — it becomes left-aligned so text doesn't jump when entering edit mode.
- **Accepted tradeoff** (user chose min-width over fixed-width+truncate): names longer than the box grow rightward; the box stays centered so rare drift for very long names is acceptable.

### 2. Rename heading prefix Terminal → Window

- Today the prefix is view-dependent via `terminalHeadingPrefix()` (top-bar.tsx:770): returns `Terminal:` / `Web:` / `Chat:` per the active view lens (spec R4 of the window-views work; constants `TERMINAL_PREFIX`/`WEB_PREFIX`/`CHAT_PREFIX` at top-bar.tsx:759-764).
- Replace with a **static `Window:` prefix** on the terminal route, in all lenses. Rationale: the heading identifies the window (substrate); lens indication belongs to the view switcher (per `docs/specs/window-views.md` "rows are substrates, views are lenses" and its shared switcher contract). The command palette already uses `Window:` vocabulary (e.g. `Window: Rename`). Bonus: the name's anchor position no longer jumps when switching lenses (same class of bug as §1).
- **This is a deliberate reversal of window-views spec R4** — the sentence "The center page heading follows the lens: `Terminal: <window>`, `Web: <window>`, `Chat: <window>`, `Desktop: <window>`" (docs/specs/window-views.md, R4 section ~line 102) must be updated **in this change** to record the reversal (hydrate touch). The rest of R4 (shared switcher chip, palette parity, shortcut) is untouched.
- Existing tests asserting the lens prefixes must be updated to the new spec (constitution Test Integrity: tests conform to spec). Known assertion sites: `app/frontend/tests/e2e/window-heading.spec.ts`, `tests/e2e/chat-view.spec.ts`, `tests/e2e/web-view-lens.spec.ts`, `src/components/top-bar.test.tsx`, `src/app.test.tsx` (grep for `Terminal:`/`Web:`/`Chat:`), plus their `.spec.md` companions.

### 3. NEW page-type hierarchy dropdown (▾ on the prefix)

- A small ▾ attached to the prefix word, rendered **`Window ▾: name ▾`** — the hierarchy ▾ binds to the prefix, **before the colon**; the existing sibling-window switcher ▾ stays after the name.
- Opens a dropdown listing **exactly the ancestor chain of the current page**: on a window route, `Server Cabin: {server}` (→ `/{server}`) and `Cockpit` (→ `/`). Contents deliberately limited to ancestors — **no lateral jumps** (e.g. no Boards) — to stay predictable.
- **Known/accepted redundancy** with the left breadcrumb (which also navigates up); the dropdown is a better touch target. The breadcrumb's long-term fate is deferred — **out of scope**.
- **Mobile**: the prefix span hides below `sm`, and the hierarchy ▾ rides with it (no hierarchy dropdown below `sm`; the hamburger/sidebar covers navigation there). Acceptable.
- The prefix is currently a static decorative sibling span (`HeadingPrefix`, top-bar.tsx:799) outside the rename button, whose content rides the boot sweep. The hierarchy ▾ becomes the click/keyboard target on/next to that prefix without making prefix text itself start a rename (clicking the prefix must still never enter edit mode).

### 4. NEW browser-history Back/Forward arrows (◀ ▶)

- Placed to the **LEFT of the heading prefix, inside the anchored center box** (they are fixed-width so they don't move the text anchor established in §1).
- **Semantics: browser history** — `router.history.back()` / `.forward()` (TanStack Router). Explicitly **NOT** previous/next sibling-window cycling (user clarified this directly).
- Rendered on **ALL four page modes** (history is global; also keeps the center-box structure uniform, e.g. `◀ ▶  Cockpit`).
- Forward disabled/dim state is **best-effort only** — `canGoForward` is not reliably exposed by browsers; always-active like browser chrome is acceptable.
- **Rejected alternative** (mentioned, not chosen): placing the arrows far-left next to the brand crumb, browser-chrome style. The user's ask and the approved mockup put them left of the heading.

### Cross-cutting constraints

- **Keyboard-first (Constitution Principle V)**: every new action needs command-palette registration — e.g. `Go: Back`, `Go: Forward`, and hierarchy-navigation entries — ideally with shortcuts. Follow the existing pure `lib/palette-*.ts` builder pattern (e.g. `palette-move.ts`, `palette-view.ts`: pure action-builder + unit test, thin wiring in `app.tsx`).
- **Constitution Principle IV (minimal surface)**: no new routes; these are affordances on the existing top bar.
- **Preserve existing top-bar machinery**: the 3-column grid, the boot-sweep heading animation (`WindowHeading` sweep cells; the prefix is a static sibling span — `HeadingPrefix`/`splitSweepCells`), move-don't-copy (leaf lives in the center heading, never duplicated in the breadcrumb), and the right-cluster button pyramid are all unchanged except as described.
- **Testing**: UI changes SHOULD include Playwright e2e coverage per `fab/project/code-quality.md`; e2e MUST run via `just test-e2e` / `just pw` (port 3020 isolation), never direct playwright. Playwright spec files require sibling `.spec.md` companion docs per the constitution.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar universal heading — static `Window:` prefix replaces the lens-following `Terminal:`/`Web:`/`Chat:` prefix, stable min-width left anchor for the center heading, prefix hierarchy dropdown, history nav arrows, new `Go:` palette actions.
- `run-kit/chat`: (modify) minor — the chat-view section references the `Chat: <window>` heading prefix as a chat-specific bit; that prefix is retired by §2.

## Impact

- `app/frontend/src/components/top-bar.tsx` — center heading cell, `HeadingPrefix`, `WindowHeading`, prefix constants (`TERMINAL_PREFIX`/`WEB_PREFIX`/`CHAT_PREFIX` → `WINDOW_PREFIX`), `terminalHeadingPrefix()` removal, rename input alignment, new hierarchy dropdown + history arrows in all four mode branches.
- `app/frontend/src/app.tsx` (and/or board-page route action mounting) — palette action wiring for `Go: Back` / `Go: Forward` / hierarchy entries; new or extended pure builder in `app/frontend/src/lib/` with colocated unit tests.
- Existing tests asserting current prefixes/centering: `tests/e2e/window-heading.spec.ts`, `tests/e2e/chat-view.spec.ts`, `tests/e2e/web-view-lens.spec.ts`, `src/components/top-bar.test.tsx`, `src/app.test.tsx` — plus `.spec.md` companions in the same commit.
- New e2e coverage for the four sub-features (anchor stability, `Window:` prefix, hierarchy dropdown navigation, back/forward arrows).
- `docs/specs/window-views.md` — record the R4 heading-prefix reversal.
- No backend changes. No new routes. No API surface changes.

## Open Questions

- None — all decision points were resolved in the discussion session or graded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Stable anchor = centered outer box + inner container with `sm:min-w-[Nch]` + left-aligned content (min-width chosen over fixed-width+truncate) | Discussed — user explicitly chose min-width; tradeoff (very long names grow rightward) accepted | S:95 R:85 A:90 D:95 |
| 2 | Confident | Starting min-width value `28ch`, tuned visually via screenshot check across all four page modes; account for `Window: ` being 2ch shorter than `Terminal: ` | User delegated the exact value to visual tuning during implementation; narrow band, easily adjusted | S:70 R:95 A:75 D:60 |
| 3 | Certain | Min-width gated at `sm+` only; below `sm` current behavior kept | Discussed — prefix span already hidden below `sm`, space scarce at 375px | S:90 R:90 A:90 D:90 |
| 4 | Certain | Inline-rename input becomes left-aligned (drop `text-center`) | Discussed — required so text doesn't jump entering edit mode | S:95 R:95 A:95 D:95 |
| 5 | Certain | Static `Window:` prefix in ALL lenses (tty/web/chat); `terminalHeadingPrefix()` + `WEB_PREFIX`/`CHAT_PREFIX` retired; deliberate R4 reversal recorded in docs/specs/window-views.md within this change | Discussed — substrate-vs-lens rationale; palette already uses `Window:` vocabulary | S:95 R:80 A:90 D:90 |
| 6 | Certain | Hierarchy ▾ binds to the prefix before the colon (`Window ▾: name ▾`); contents = ancestors only; window route lists `Server Cabin: {server}` + `Cockpit` | Discussed — approved ASCII mockup; lateral jumps explicitly excluded | S:90 R:85 A:85 D:85 |
| 7 | Confident | Hierarchy ▾ renders on every mode that has ancestors (server cabin and board routes list `Cockpit`); solo `Cockpit` heading gets no hierarchy ▾ | Inferred from "ancestor chain of the current page" + mockup rendering `◀ ▶  Cockpit` with no ▾; clear front-runner | S:55 R:85 A:70 D:55 |
| 8 | Certain | No hierarchy dropdown below `sm` — the ▾ rides with the hidden prefix span; hamburger/sidebar covers mobile navigation | Discussed — explicitly accepted | S:90 R:90 A:90 D:90 |
| 9 | Certain | Arrows = browser history (`router.history.back()` / `.forward()`, TanStack Router), NOT sibling-window cycling | User clarified this directly in discussion | S:100 R:85 A:95 D:95 |
| 10 | Certain | Arrows placed left of the prefix inside the anchored center box, fixed-width, rendered on all four page modes | Discussed — approved mockup; far-left brand-adjacent placement explicitly rejected | S:95 R:85 A:90 D:90 |
| 11 | Certain | Forward disabled/dim state best-effort only; always-active like browser chrome acceptable | Discussed — `canGoForward` not reliably exposed by browsers | S:90 R:95 A:85 D:90 |
| 12 | Confident | Palette entries `Go: Back` / `Go: Forward` + hierarchy entries (e.g. `Go: Server Cabin` / `Go: Cockpit`) via the pure `lib/palette-*.ts` builder pattern; no new dedicated app-level keybindings beyond the palette (browser natives Alt+←/→ already cover history; avoid clobbering) | Constitution V requires palette reachability; "ideally with shortcuts" left soft — reversible, clear default | S:60 R:90 A:70 D:55 |
| 13 | Confident | Reuse the existing `BreadcrumbDropdown` component for the hierarchy dropdown | Existing component already provides items/label/title/onNavigate; implementation detail, easily swapped | S:50 R:95 A:85 D:70 |
| 14 | Certain | Playwright e2e coverage for the new behaviors + sibling `.spec.md` companions, run via `just test-e2e`/`just pw` (port 3020) | code-quality.md SHOULD + constitution Test Companion Docs MUST | S:85 R:90 A:95 D:95 |
| 15 | Certain | Existing tests asserting `Terminal:`/`Web:`/`Chat:` prefixes or centered alignment are updated to the new spec (not preserved) | Constitution Test Integrity — tests conform to spec; assertion sites enumerated in Impact | S:70 R:90 A:90 D:80 |

15 assumptions (11 certain, 4 confident, 0 tentative, 0 unresolved).
