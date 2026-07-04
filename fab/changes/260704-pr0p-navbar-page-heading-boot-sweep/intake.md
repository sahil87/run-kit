# Intake: Universal Top-Bar Page Heading with Boot Sweep

**Change**: 260704-pr0p-navbar-page-heading-boot-sweep
**Created**: 2026-07-04

## Origin

Promptless dispatch via `/fab-proceed` (create-intake subagent, `{questioning-mode} = promptless-defer`), synthesized from a live design conversation in which the user confirmed every major decision and reviewed a working HTML demo of the animation (via an rk iframe window) and proceeded without requesting tweaks.

> Feature: universal top-bar center page heading with a combined "boot sweep" animation, plus section-heading restyle. The top bar's 3-column grid (`1fr auto 1fr`) fills its center cell only in terminal mode today (the editable WindowHeading + ▾ window switcher); root (Server Cabin), board, and cockpit modes leave it empty. The change fills it on every page with a `PageType: name` identity heading, unifies the animation vocabulary with one continuous left-to-right "boot sweep" (typed-cursor sweep over the page-type prefix flowing into the decode scramble over the instance name), removes the two in-page PageHeading rows, and transfers the bracket idiom to section sub-headings.

Interaction mode: conversational — decisions 1–9 under What Changes were each explicitly user-confirmed. A demo of exactly the intended animation exists at `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-mild-bobcat/c637b82b-a648-4999-b80e-2b66ff46cd57/scratchpad/heading-sweep-demo.html` (reference for mechanics; may not survive to apply time — its mechanics are reproduced in full below).

## Why

1. **Pain point**: Page identity is inconsistent. Terminal routes center the window name in the top bar; Cockpit and Server Cabin carry a separate in-page `[ page · name ]` PageHeading row (spending vertical space); Board buries its name in the left breadcrumb; the top-bar center cell sits empty on three of four modes. Users scanning multiple tabs/windows have no uniform "where am I" anchor.
2. **Consequence of not fixing**: The vocabulary split deepens — two competing page-identity idioms (centered heading vs. bracketed in-page row), an empty center cell on most routes, and an animation vocabulary where "decode" means editable-window-identity only, leaving new headings with no sanctioned treatment.
3. **Why this approach**: Reuses proven mechanics rather than inventing new ones — the WindowHeading decode (change 260703-5ilm), the TypedLabel typed sweep, and the PageHeading bracket/caret CSS all already exist; this change recomposes them. "Move, don't copy" preserves the bar's no-duplication invariant (a name never appears twice in one bar). The combined boot sweep was chosen over two separate motions (typed sweep + independent scramble) because the user explicitly wanted one continuous left-to-right gesture.

## What Changes

All line numbers verified against the current post-rebase tree (HEAD f909090 "feat: Top-Bar Button Pyramid (#308)"). The button-pyramid work is orthogonal (right cluster); this change touches the left breadcrumb and center cell.

### 1. Top-bar center heading on every mode (`app/frontend/src/components/top-bar.tsx`)

The center cell (currently gated `showWindowHeading = mode === "terminal" && !!currentWindow`, line 199; cell at lines 301–329) renders a `PageType: name` identity heading in ALL four modes:

| Mode | Center heading | Interactive parts |
|------|---------------|-------------------|
| `terminal` | `Terminal: <window-name>` | name = existing editable WindowHeading rename button; existing ▾ window switcher stays beside it |
| `board` | `Board: <board-name>` | ▾ board switcher (moves from left breadcrumb); name display-only (no rename — boards have no rename API) |
| `root` | `Server Cabin: <server-name>` | name display-only (the server leaf crumb moves here from the left breadcrumb) |
| `cockpit` | `Cockpit` | type word only, solo — no instance name ("Run Kit cockpit" was rejected: duplicates the adjacent brand crumb) |

**Two-tone styling** (the "name is the subject" idiom from PageHeading): the page-type prefix renders `text-text-secondary`; the instance name keeps `font-semibold text-text-primary`. Separator is a colon inside the prefix (`Terminal:`), title case as demoed. The prefix is a **static sibling span OUTSIDE the rename button/input** on terminal routes — clicking the prefix must not start an edit; the edit input binds only to the name. When the type word stands alone (Cockpit), it renders primary-medium (PageHeading's solo rule, page-heading.tsx:47–52).

**Mobile**: prefix hidden below `sm` — mobile keeps just the name (the heading is the mobile leaf, keeping `max-w-[16ch]` and `coarse:min-h-[30px]`, per context.md § Mobile). The solo Cockpit word is the name-equivalent, not a prefix, so it stays visible at all breakpoints.

### 2. Left breadcrumb: move, don't copy

Generalized rule (extends the existing invariant comments at top-bar.tsx ~199 and ~280): **the left breadcrumb always ends at the parent; the current-page leaf is the centered heading.** A name never appears twice in the bar.

- **`root` mode**: the `serverIsLeaf` rendering (top-bar.tsx:193, leaf branch 255–266 — the `aria-current="page"` server span) MOVES to the center heading. The left breadcrumb ends at the brand + hamburger (parent = home).
- **`board` mode**: the board name and ▾ board switcher MOVE out of `BoardModeBreadcrumb` (definition 747–803, mounted 239–248) to the center. The counts/hint string (`{n} panes · {n} servers · ⌘[⌘] cycle`, lines 798–800) STAYS on the left (centering it would crowd the slot). The left `Board ▸` home-navigate button (783–789) is removed — the brand crumb is already the home affordance, and keeping it would duplicate the type word now centered.
- **`terminal` mode**: unchanged shape — breadcrumb already ends at the session crumb (280–296); the centered heading gains only the `Terminal:` prefix span.

### 3. Combined "boot sweep" animation for the center heading

ONE continuous left-to-right gesture (user-rejected alternative: name scrambling from t=0 while the cursor is still in the prefix — reads as two separate motions):

- A single inverse-video accent-green block cursor sweeps the whole string (prefix + space + name) at ~28ms/cell — reuse `DECODE_FRAME_MS` (top-bar.tsx:462).
- **Over prefix cells** it behaves like TypedLabel: chars right of the cursor are dim (0.26 opacity — `rk-typed-off`), the cursor cell shows the real char in inverse video (accent-green background, `bg-primary` text — `rk-typed-cursor`), resolved chars settle to `text-secondary`.
- **Name chars to the right of the cursor** churn random decode glyphs (`DECODE_GLYPHS`, top-bar.tsx:465) in accent-green from the START of the sweep (frame 0) — not only once the cursor reaches the name — each unresolved name char churning every frame until the cursor's arrival LOCKS it to its true character; resolved (already-passed) name chars settle to semibold `text-primary`. Prefix chars never churn — they only dim ahead of the cursor and type/settle behind it. *(Amended by re-review finding 260704-pr0p: the earlier prose "the churn starts only when the cursor reaches the name" contradicted the user-approved HTML demo AND the shipped code — both churn name cells right of the cursor from frame 0; the cursor's arrival is what locks each cell. Code matches demo. The "one continuous gesture" reading holds because the churn glyphs are subtle accent-green while the cursor is the focal motion — see the Reference mechanics note below, "right-of-cursor ... name: green churn glyph".)*
- **Hover** replays the sweep behind the existing 140ms hover-intent delay (`DECODE_HOVER_INTENT_MS`, top-bar.tsx:464); mouseleave cancels and resolves to rest.
- **Mount/navigation**: the sweep also plays once on mount — TopBar remounts across route types, so navigating between page types animates (demo auto-played on load; see Assumptions #10).
- **Name-change replay**: the existing WindowHeading displayed-name-change replay (rename confirmation / SSE external rename / window navigation, top-bar.tsx:606–613) keeps working, now sweeping the full prefixed string.
- **Reduced motion**: skipped entirely under `prefers-reduced-motion` — the rest state IS the reduced-motion state (matches both existing treatments; JS gate via `prefersReducedMotion()`).
- **Cockpit** (no instance name): the typed sweep alone plays over the solo type word.
- Spaces are preserved during churn (existing decode behavior: `ch === " " ? " " : randomGlyph()`, top-bar.tsx:574).

Reference mechanics (from the reviewed demo): per-cell spans tagged prefix/space/name; single interval at 28ms; cell states = resolved (rest class) / cursor (inverse video) / right-of-cursor (prefix: dim; name: green churn glyph). Rest render is plain text (no spans) so the accessible name stays stable; decorative churn must not garble the rename button's `aria-label` (existing pattern: the button's `aria-label="Rename window ${name}"` is display-independent).

**Preserve WindowHeading guards** (top-bar.tsx:501–733): edit start cancels the scramble and binds the input to real name state; decode replays on displayed-name change; external identity change (server:windowId) mid-edit cancels the stale edit; deliberately no remount `key` (comment at 307–312). The boot sweep must slot into these, not replace them.

### 4. Remove the in-page PageHeading rows; bracket idiom transfers to section sub-headings

- **Delete** the Cockpit row (`server-list-page.tsx:198` — `<PageHeading page="cockpit" className="mb-6" />`) and the Server Cabin row (`session-tiles/session-tiles.tsx:82–87` — `<PageHeading page="server cabin" name={server} side="{N} sessions, {M} windows" />`). Page identity now lives in the top bar.
- **New bracket section-heading** (shared component; PageHeading refactors/deletes into it — see Assumptions #11): the PageHeading style — `[` brackets `]`, always-reserved blinking caret cell `▊`, trailing horizontal rule, hover treatment where brackets step outward ±3px and turn accent-green (CSS `rk-bracket-*`, globals.css:205–227) — moves to the section labels:
  - Server Cabin: `Sessions` (session-tiles.tsx:94–96, currently a bare `<h2>` + TypedLabel)
  - Cockpit zone headings: `Host Health` (server-list-page.tsx:208), `Boards` (:233), `Tmux Servers` (:271), `Services` (:331)
  - Result shape: `[ SESSIONS▊ ]──────── side-text` — labels KEEP their existing typed-sweep hover (TypedLabel) inside the brackets, and keep `<h2>` semantics + uppercase styling.
- **Cabin stats relocate**: the `{N} sessions, {M} windows` side text (currently PageHeading `side`) moves to the new `[ Sessions ]` section-heading line, right-aligned after the rule. Cockpit zone headings get no relocated side text; their existing inline metadata (hostname, board count, etc.) is preserved (see Assumptions #17).
- Sidebar TypedLabel labels (sidebar/index.tsx:1063, sidebar/collapsible-panel.tsx:288) are NOT bracket targets — they keep typed-sweep only.

### 5. Hover-vocabulary documentation updates (keep the two copies consistent)

- `globals.css` vocabulary comment (lines 105–112): "decode = editable window identity" widens to the boot sweep as the top-bar page-heading treatment; "brackets+caret = page titles" becomes the section-heading treatment.
- `fab/project/context.md` § Conventions (the hover-animation vocabulary bullet) mirrors the same rewording. The § Mobile Responsive Design bullet describing the top bar ("centered editable window heading … on terminal routes") also needs updating to the universal heading.

### 6. Tests

Per constitution (Test Companion Docs; code-quality: UI changes SHOULD include e2e):

- **Unit**: update `top-bar.test.tsx` (root-mode leaf-crumb assertions at :121/:176 now expect the centered heading; new per-mode heading/prefix assertions; board breadcrumb changes), `server-list-page.test.tsx` (PageHeading removal, bracket zone headings); delete/replace `page-heading.test.tsx` alongside the component; new tests for the shared section-heading component. `typed-label.test.tsx` unchanged.
- **E2E**: update `window-heading.spec.ts` (+ `.spec.md`) for the prefix sibling and sweep; check `mobile-layout.spec.ts` and `host-health-home.spec.ts` for heading assertions; add coverage for the centered heading on board/root/cockpit and the section-heading shape. Every touched/added `.spec.ts` updates its sibling `.spec.md` in the same commit.
- Keyboard path preserved: palette `Window: Rename` CustomEvent (`window-heading:rename`, top-bar.tsx:627–633) must keep entering inline edit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — top-bar center cell becomes the universal `PageType: name` heading on all four modes (breadcrumb-ends-at-parent generalization, board switcher relocation); hover-animation vocabulary update (boot sweep = top-bar page heading; brackets+caret = section headings); PageHeading retirement and the bracket section-heading on Cabin/Cockpit zones.

## Impact

- **Frontend only**; no backend, no API, no routes added (constitution IV holds — same fixed route set).
- `app/frontend/src/components/top-bar.tsx` — center-cell composition, boot-sweep engine (extends WindowHeading/decode), BoardModeBreadcrumb reduction, root leaf-crumb removal from the left nav.
- `app/frontend/src/components/page-heading.tsx` (+ test) — retired/refactored into the shared bracket section-heading component (new file or repurposed).
- `app/frontend/src/components/session-tiles/session-tiles.tsx` — PageHeading row removed; `Sessions` becomes a bracket section heading with side stats.
- `app/frontend/src/components/server-list-page.tsx` — PageHeading row removed; four zone headings become bracket section headings.
- `app/frontend/src/components/typed-label.tsx` — reused as-is inside brackets (constants: ~350ms total, 20–60ms per-cell clamp, typed-label.tsx:23–25); no change expected.
- `app/frontend/src/globals.css` — vocabulary comment update; `rk-bracket-*`/`rk-typed-*` reused (possible small additions for the boot-sweep cell classes if not inlined via Tailwind).
- `fab/project/context.md` — Conventions vocabulary + Mobile top-bar description.
- Tests as listed in What Changes § 6.
- Risk concentration: WindowHeading's edit/scramble guard interplay (top-bar.tsx:501–733) — the sweep must compose with editing without regressing rename (keyboard path included).

## Open Questions

None — all open points from the conversation were graded per SRAD and recorded below (no composite fell below the Unresolved threshold; nothing required deferral).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Center heading per mode: `Terminal: <window>` (editable name + ▾), `Board: <board>` + ▾ switcher, `Server Cabin: <server>`, `Cockpit` solo | Discussed — user confirmed each; "Run Kit cockpit" explicitly rejected as brand-crumb duplication | S:95 R:80 A:90 D:95 |
| 2 | Certain | Move, don't copy: left breadcrumb ends at the parent; current-page leaf is the centered heading; no-duplication invariant holds | Discussed — user confirmed the generalized rule; matches existing invariant comments in top-bar.tsx | S:90 R:75 A:90 D:90 |
| 3 | Certain | Two-tone styling: prefix `text-text-secondary` static span outside the rename control, colon separator, name `font-semibold text-text-primary`; prefix hidden below `sm`; heading keeps mobile-leaf sizing (`max-w-[16ch]`, `coarse:min-h-[30px]`) | Discussed — user confirmed; demoed; "name is the subject" idiom from PageHeading | S:90 R:85 A:90 D:90 |
| 4 | Certain | Remove both in-page PageHeading rows (server-list-page.tsx:198, session-tiles.tsx:82) — page identity lives in the top bar | Discussed — user confirmed | S:95 R:80 A:90 D:95 |
| 5 | Certain | Bracket idiom (brackets, caret cell, trailing rule, ±3px hover step) transfers to section labels: cabin `Sessions` + cockpit `Host Health`/`Boards`/`Tmux Servers`/`Services`; typed-sweep hover kept inside brackets | Discussed — user confirmed; demoed (`[ SESSIONS▊ ]──── side`) | S:90 R:80 A:85 D:90 |
| 6 | Certain | Cabin `{N} sessions, {M} windows` stats relocate to the `[ Sessions ]` line, right-aligned after the rule | Discussed — user confirmed | S:90 R:85 A:90 D:90 |
| 7 | Certain | Boot sweep mechanics: one inverse-video accent-green cursor at 28ms/cell over the whole string; TypedLabel behavior over prefix (0.26 dim, inverse-video cursor cell); decode glyph churn on name cells right of the cursor from frame 0, each locked as the cursor reaches it (amended — see §3); hover replay behind 140ms intent; mouseleave cancels/resolves; reduced-motion skips entirely; cockpit solo word gets typed sweep alone (primary-medium solo rule) | Discussed — user explicitly wanted one continuous gesture; churn-from-t=0 alternative rejected; demo reviewed without tweaks | S:95 R:80 A:90 D:90 |
| 8 | Certain | Preserve/reuse existing mechanics: DECODE_* constants, WindowHeading guards (edit cancels scramble, name-change replay, identity-change cancels stale edit, no remount `key`), typed-label clamp, `rk-typed-*`/`rk-bracket-*` classes | Discussed — user listed these; verified present in post-rebase top-bar.tsx/typed-label.tsx/globals.css | S:90 R:75 A:95 D:90 |
| 9 | Certain | Update the hover-vocabulary docs in both `globals.css` (comment 105–112) and `fab/project/context.md` § Conventions, kept consistent | Discussed — user confirmed both locations | S:90 R:90 A:95 D:90 |
| 10 | Confident | Boot sweep also plays once on mount, so route navigation between page types animates (in addition to hover replay and the name-change replay) | Open point — demo auto-played on load with stagger and user proceeded; trivially reversible single effect | S:55 R:90 A:70 D:65 |
| 11 | Confident | PageHeading component + its unit test are retired; a new shared bracket SectionHeading component (label + optional side slot) serves cabin + cockpit call sites | Open point — both PageHeading usages disappear; a shared component is the natural shape; pure implementation detail | S:50 R:90 A:85 D:70 |
| 12 | Certain | Title-case prefixes: `Terminal:`, `Board:`, `Server Cabin:`, `Cockpit` (supersedes PageHeading's lowercase idiom) | Open point — demo used title case throughout; user reviewed and proceeded; one-string reversal | S:65 R:95 A:80 D:80 |
| 13 | Certain | Board center name is display-only + ▾ switcher — no rename affordance | Open point — boards have no rename API today; adding one would be scope creep (constitution IV) | S:60 R:85 A:90 D:80 |
| 14 | Certain | Sidebar TypedLabel labels (sidebar/index.tsx:1063, collapsible-panel.tsx:288) unchanged — not bracket targets | Description enumerates the bracket targets explicitly (cabin Sessions + 4 cockpit zones); sidebar labels stay typed-sweep-only | S:70 R:90 A:85 D:80 |
| 15 | Confident | The board-mode left `Board ▸` home button is removed; counts/hint string stays left | Not explicitly discussed — brand crumb is already the home affordance, and a left "Board" word would duplicate the centered type word; follows the ends-at-parent rule | S:55 R:85 A:75 D:65 |
| 16 | Confident | The solo `Cockpit` heading stays visible at all breakpoints (the hidden-below-`sm` rule applies to prefixes; the solo word is the leaf/name-equivalent) | Not explicitly discussed — hiding it would empty the center cell on mobile cockpit; demo rendered solo as its own kind | S:60 R:90 A:80 D:75 |
| 17 | Confident | Cockpit zone headings keep their existing inline metadata (hostname, board count, loading states); "no side text" means no relocated stats, not removal of existing metadata | "Cockpit zone headings have no side text" read in context of the stats-relocation decision; deleting hostname/counts would be an unrequested regression | S:45 R:90 A:75 D:60 |
| 18 | Confident | Heading semantics: section labels keep `<h2>`; the centered top-bar heading carries a stable accessible name (churn cells decorative, rename button `aria-label` unchanged); no `<h1>` is added to the top bar | Not discussed — terminal route already has no h1; PageHeading precedent keeps decorative glyphs `aria-hidden`; screen-reader text must not churn | S:40 R:90 A:70 D:60 |

18 assumptions (12 certain, 6 confident, 0 tentative, 0 unresolved).
