# Intake: Top-Bar Left Cluster — Hamburger-First Reorder, Coarse Touch Target, RunKit Wordmark

**Change**: 260720-ap63-hamburger-first-runkit-wordmark
**Created**: 2026-07-20

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent) from a live conversation. Synthesized description:

> Three coordinated changes to the LEFT side of the top bar (`app/frontend/src/components/top-bar.tsx`):
> 1. **Reorder**: the sidebar/window-panel toggle (hamburger, `aria-label="Toggle navigation"`) becomes the FIRST element on the left; the brand (logo + wordmark) becomes second; the breadcrumb `>` separator then starts after the brand.
> 2. **Touch target**: add `coarse:min-h-[30px] coarse:min-w-[30px]` to the hamburger to match the top-bar button-control vocabulary (24px fine / 30px coarse).
> 3. **Wordmark rename**: "Run Kit" → "RunKit" to match the browser/chrome window name, sweeping all remaining user-visible "Run Kit" strings.

Key decisions were made in the conversation (accept Host-page logo shift, move hamburger outside the breadcrumb nav, 30px over 36px coarse target, reassess the nav's min-width floor) — captured below verbatim.

## Why

1. **Ordering/semantics**: the hamburger currently sits BETWEEN the brand crumb and the breadcrumb crumbs (top-bar.tsx:762-770, inside `<nav aria-label="Breadcrumb">`). That placement breaks the reading order twice: the panel toggle interrupts the breadcrumb trail visually, and semantically a navigation-drawer toggle is not a breadcrumb item at all. Hamburger-first (the standard drawer-toggle position — VS Code, Slack) makes the trail read naturally: `[hamburger] [brand] > crumbs…`.
2. **Touch ergonomics**: the hamburger has only `min-w-[24px] min-h-[24px]` and lacks the top-bar's established coarse-pointer sizing. Every other top-bar button control is uniformly 24px fine / `coarse:30px` (see context.md § Mobile Responsive Design — the whole right-side cluster). The hamburger — arguably the most-tapped mobile control — is the outlier at a sub-minimum 24px touch target.
3. **Brand consistency**: `document.title` (`src/hooks/use-browser-title.ts:19`), `index.html` `<title>` (line 6), and `public/manifest.json` `name`/`short_name` are ALL already "RunKit" (verified). The in-app wordmark and the overflow-menu version row still say "Run Kit" — the app disagrees with its own window title. If left unfixed, the split spelling persists across every surface a user sees side by side (tab title vs. top-bar wordmark).

## What Changes

All in `app/frontend/` unless noted. Component: `src/components/top-bar.tsx` (left cluster currently at lines ~722-770) and `src/components/top-bar-overflow-menu.tsx`.

### 1. Hamburger-first reorder + move outside the breadcrumb nav

Current structure (top-bar.tsx:732-770):

```tsx
<nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm overflow-hidden min-w-[76px] sm:min-w-[180px]">
  <a href="/" aria-label="Run Kit home" title="Host" className={`flex items-center gap-2 shrink-0 rk-brand-glitch ${LINK_CRUMB_CLASS}`}>
    <LogoSpinner size={20} loading={false} />
    <span className="hidden sm:inline text-xs [text-decoration:inherit]">Run Kit</span>
  </a>
  {hasSidebar && (
    <button onClick={onToggleSidebar} aria-label="Toggle navigation"
      className="rk-glint text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center shrink-0">
      <HamburgerIcon isOpen={hamburgerOpen} />
    </button>
  )}
  {/* …crumbs… */}
</nav>
```

Target structure:

- The hamburger button (still gated on `hasSidebar`) moves to be the FIRST element in the left grid cell, rendered as a **sibling BEFORE** `<nav aria-label="Breadcrumb">` — it is a drawer toggle, not a breadcrumb item, so it leaves the nav landmark entirely (a11y decision from the conversation). The left grid cell will need a small flex wrapper (or equivalent) so hamburger + nav sit side by side inside the `grid-cols-[1fr_auto_1fr]` left cell without disturbing the center heading's true centering.
- The brand anchor (logo + wordmark) becomes the first element INSIDE the nav — it remains the breadcrumb's root crumb, and the `BreadcrumbSeparator` (`>`) now naturally starts after the brand.
- **Host page** (`hasSidebar` false — no sidebar exists there): the hamburger simply isn't rendered and the brand shifts left ~30px relative to other routes. Decision: **accept the shift** (standard pattern); do NOT reserve a ghost slot.
- Behavior preserved: `onToggleSidebar` wiring, `HamburgerIcon isOpen={hamburgerOpen}` state, `rk-glint` hover treatment on the hamburger, `rk-brand-glitch` on the brand (hover-animation vocabulary is one-treatment-per-element-category — see context.md § Conventions).

### 2. Coarse touch target on the hamburger

Add `coarse:min-h-[30px] coarse:min-w-[30px]` to the hamburger button's className, keeping `min-w-[24px] min-h-[24px]` for fine pointers. Decision: **30px** (top-bar button-control cluster consistency — the entire right-side cluster is 24px fine / 30px coarse) was chosen **over the bottom-bar's 36px**. The `coarse:` variant is the project's custom Tailwind variant for `@media (pointer: coarse)`.

### 3. Breadcrumb nav min-width floor reassessment

The nav's `min-w-[76px] sm:min-w-[180px]` floor (top-bar.tsx:726-734) was sized to guarantee "brand icon + hamburger below `sm`" (per the inline comment). With the hamburger moved OUTSIDE the nav:

- The floor no longer needs to cover the hamburger — reassess the value (the below-`sm` floor now only needs to guarantee the bare logo icon; the hamburger sibling carries its own `shrink-0` + min sizes).
- The coarse 30px hamburger adds 6px vs. today's 24px — verify nothing clips or wraps at 375px (single-line top-bar budget), on terminal/board routes where `hasSidebar` is true.
- Preserve the degradation ladder documented in the comment block (crumbs truncate → server crumb hides below `md` → nav clips at its floor) and update the comment to match the new structure.

### 4. Wordmark rename "Run Kit" → "RunKit" (user-visible sweep)

Verified-complete list of remaining user-visible "Run Kit" strings:

- `src/components/top-bar.tsx:754` — wordmark span text `Run Kit` → `RunKit`
- `src/components/top-bar.tsx:742` — `aria-label="Run Kit home"` → `aria-label="RunKit home"`
- `src/components/top-bar-overflow-menu.tsx:236` — version row `` daemonVersion ? `Run Kit ${displayVersion(daemonVersion)}` : "Run Kit" `` → `RunKit` in both branches
- `src/components/top-bar-overflow-menu.tsx:386` — `` aria-label={daemonVersion ? `${versionText} (copy)` : "Run Kit"} `` → `RunKit` (the template-literal branch picks up the fix via `versionText`)
- Adjacent code comments referencing the old spelling (top-bar-overflow-menu.tsx:234, 240, 260, 269) should be updated for consistency (non-user-visible, low priority)

NOT in scope: `singleRunKit` identifiers (internal variable names), backend strings, README/docs (no user-visible "Run Kit" found in `src/` beyond the above).

### 5. Test updates (same-commit, per constitution)

Unit — `src/components/top-bar.test.tsx`:

- `"Run Kit home"` label assertions (~4 sites: lines 402, 418, 541, plus any `getByLabelText` duplicates) → `"RunKit home"`
- Wordmark text assertion (lines 699-701: `renders 'Run Kit' branding text`) → `RunKit`
- Overflow version-row text assertions (lines 1169, 1256-1260) → `RunKit`
- **Ordering test at line 416** ("renders the brand as the left-most root crumb…"): it asserts `nav.firstElementChild` is the brand — that assertion actually stays TRUE (the brand becomes the nav's first child once the hamburger leaves the nav), but the test should be extended/updated to also assert the new invariant: the hamburger is the first element of the left cluster, rendered before (and outside) the breadcrumb nav, when `hasSidebar` is true.

E2E — Playwright specs + their `.spec.md` companions (constitution § Test Companion Docs: same-commit updates required):

- `tests/e2e/top-bar-persistence.spec.ts:103` — `getByLabel("Run Kit home")` → `"RunKit home"`; update `tests/e2e/top-bar-persistence.spec.md` (references at lines 70, 76)
- `tests/e2e/top-bar-overflow.spec.ts:222-244` — version-row matchers `/Run Kit/` and `/^Run Kit v/` are space-sensitive and will NOT match "RunKit v…" → update regexes; update `tests/e2e/top-bar-overflow.spec.md` (lines 75, 84-85). *(Discovered during intake verification — additional to the conversation's list.)*
- Hamburger e2e selectors (`"Toggle navigation"` in mobile-layout, pr-status-sidebar, server-panel-grid specs) are unaffected — the aria-label is unchanged. If any spec asserts left-cluster DOM order, it must be updated (none known to).

New behavior SHOULD get coverage per code-quality.md (UI changes SHOULD include Playwright e2e where possible) — at minimum a unit assertion of the hamburger-first order (folded into the line-416 test above); a 375px coarse-target visual check happens via the Playwright-driven-development workflow during apply.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome section — left-cluster structure (hamburger-first, outside the breadcrumb nav), hamburger coarse touch target joining the 24/30px button vocabulary, and the RunKit wordmark spelling

## Impact

- **Source**: `app/frontend/src/components/top-bar.tsx` (left cluster restructure + strings), `app/frontend/src/components/top-bar-overflow-menu.tsx` (version-row strings). No backend, no API, no route changes.
- **Tests**: `src/components/top-bar.test.tsx`; `tests/e2e/top-bar-persistence.spec.ts` + `.spec.md`; `tests/e2e/top-bar-overflow.spec.ts` + `.spec.md`.
- **Constraints honored**: constitution § IV (no new pages/routes), § Test Companion Docs (same-commit `.spec.md`); context.md hover-animation vocabulary (rk-glint / rk-brand-glitch preserved); mobile 375px single-line top-bar budget.
- **Verification**: `just test-frontend` (unit), `just test-e2e` for the two touched specs, Playwright visual check at 375px (coarse) and 1024px+ per context.md § Playwright-Driven Development.

## Open Questions

- None — all decision points were resolved in the originating conversation; the one open value (the nav min-width floor) is an apply-time visual verification, recorded as an assumption below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hamburger becomes the FIRST left element; brand second; `>` separator starts after the brand | Discussed — explicit user direction; verbatim in Origin | S:95 R:85 A:90 D:95 |
| 2 | Certain | Hamburger moves OUTSIDE `<nav aria-label="Breadcrumb">` as a preceding sibling | Discussed — a11y decision: a drawer toggle is not a breadcrumb item | S:90 R:85 A:90 D:90 |
| 3 | Certain | Coarse touch target is 30px (`coarse:min-h-[30px] coarse:min-w-[30px]`), not the bottom-bar's 36px | Discussed — user chose top-bar cluster consistency; matches context.md § Mobile Responsive Design | S:95 R:90 A:95 D:90 |
| 4 | Certain | Wordmark + all user-visible strings "Run Kit" → "RunKit" (sweep list in What Changes §4) | Discussed — matches document.title/index.html/manifest.json, all verified already "RunKit" | S:95 R:90 A:95 D:95 |
| 5 | Certain | Host page: accept the ~30px logo left-shift (no hamburger there); do NOT reserve a ghost slot | Discussed — user chose the standard pattern (VS Code/Slack) over a placeholder | S:90 R:90 A:85 D:85 |
| 6 | Confident | Nav `min-w-[76px]` floor is reassessed at apply (it no longer covers the hamburger); exact value decided by 375px visual verification, preserving the degradation ladder | Conversation flagged the reassessment but fixed no value; agent-competent via Playwright at 375px, trivially reversible | S:70 R:90 A:80 D:60 |
| 7 | Certain | Change type is `feat` (user-visible UI change; not a pure rename/refactor) | Taxonomy default for UI-visible behavior/appearance changes; verified against `.status.yaml` per Step 6 | S:70 R:95 A:85 D:65 |
| 8 | Certain | Unit + e2e assertions updated to new spelling/order, with `.spec.md` companions in the same commit | Constitution § Test Companion Docs mandates it; impact list verified by grep | S:90 R:90 A:95 D:95 |
| 9 | Certain | Hover-animation vocabulary preserved: `rk-glint` stays on the hamburger, `rk-brand-glitch` on the brand | context.md § Conventions — one treatment per element category | S:85 R:90 A:95 D:95 |

9 assumptions (8 certain, 1 confident, 0 tentative, 0 unresolved).
