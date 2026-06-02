# Plan: Sidebar header "current item" affordances — Server collapsed shade + Sessions header name

**Change**: 260418-zar8-server-panel-collapsed-selected-shade
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

*No setup tasks. Pure edits to existing components and tests.*

## Phase 2: Core Implementation

- [x] T001 [P] Update `app/frontend/src/components/sidebar/collapsible-panel.tsx`: in the header render block (currently lines 260–288), when `headerTint` is non-null AND `tintOnlyWhenCollapsed` is true, use `headerTint.selected` for the static background and keep it flat at `headerTint.selected` on hover (no `onMouseEnter`/`onMouseLeave` color swap in that branch). When `headerTint` is non-null AND `tintOnlyWhenCollapsed` is false/unset, preserve the existing `tint.base` + `tint.hover` behavior unchanged. Rationale lives in the per-spec Design Decisions (Options A + H1).

- [x] T002 [P] Update `app/frontend/src/components/sidebar/index.tsx` Sessions header (currently lines 510–522): (a) change the header wrapper class from `text-text-primary` to `text-text-secondary` so the baseline matches `CollapsiblePanel`'s header; (b) render `{currentSession && <span className="ml-auto flex items-center gap-1 min-w-0 truncate"><span className="truncate text-text-primary font-mono">{currentSession}</span></span>}` between the "Sessions" label and the `+` button; (c) ensure the `+` button's wrapper span only uses `ml-auto` when `currentSession` is null so layout stays right-anchored in both cases. Do NOT apply any background tint to the Sessions header.

## Phase 3: Integration & Edge Cases

- [x] T003 Update `app/frontend/src/components/sidebar/collapsible-panel.test.tsx`: add three tests for tint shade selection: (a) `tintOnlyWhenCollapsed=true`, panel collapsed, `tint` passed → header inline `background-color` equals `tint.selected`; (b) `tintOnlyWhenCollapsed=true`, panel open → header has no inline `background-color` (neither `.base` nor `.selected`); (c) `tintOnlyWhenCollapsed=false` (legacy mode), `tint` passed → header inline `background-color` equals `tint.base`. Use a fixture tint like `{ base: "rgb(10, 20, 30)", hover: "rgb(20, 40, 60)", selected: "rgb(40, 80, 120)" }` and read back `element.style.backgroundColor` (jsdom normalizes to rgb strings). *(Added 5 tests total; also updated `sidebar.test.tsx` to scope session-name lookups to the Navigate button — the Sessions header now renders the current session name, so unqualified `getByText("run-kit")` was ambiguous.)*

- [x] T004 Run the frontend test suite scoped to the sidebar (`cd app/frontend && npm test -- collapsible-panel`) to confirm T003 passes and no other `collapsible-panel.test.tsx` tests regress. If the full suite needs a sanity check, run `npm test -- sidebar` (still scoped). Do not run the full app test suite unless scoped runs reveal cross-file regressions. *(Full suite run: 28 files / 447 tests passed.)*

- [x] T005 Run TypeScript check on the frontend (`cd app/frontend && npm run typecheck` or equivalent from `package.json`'s scripts) to confirm no type regressions from the JSX edits in T001/T002. *(`npx tsc --noEmit` in app/frontend — clean, no errors.)*

## Phase 4: Polish

*No polish tasks — this is a narrow visual fix.*

---

## Execution Order

- T001 and T002 are fully independent (different files) and may run in parallel.
- T003 depends on T001 (the new test asserts the new behavior; must run after T001 lands).
- T004 depends on T001 and T003.
- T005 depends on T001 and T002.
- T004 and T005 may run in parallel (different commands, no shared state).

## Files Touched (expected)

| File | Task | Change |
|------|------|--------|
| `app/frontend/src/components/sidebar/collapsible-panel.tsx` | T001 | Header tint branch uses `.selected` + flat hover when `tintOnlyWhenCollapsed` is true |
| `app/frontend/src/components/sidebar/index.tsx` | T002 | Sessions header shows `currentSession` + normalizes text-color |
| `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` | T003 | Three new tests for tint shade selection |

## Acceptance

## Functional Completeness
- [x] CHK-001 Collapsed-header tint SHALL use selected shade when `tintOnlyWhenCollapsed` is set: `CollapsiblePanel` header with `tintOnlyWhenCollapsed=true` AND panel collapsed AND non-null tint → header background is `tint.selected`
- [x] CHK-002 Hover on selected-shade-tinted collapsed header stays at `tint.selected`: no `onMouseEnter`/`onMouseLeave` color swap in that branch; `tint.hover` is not applied
- [x] CHK-003 Sessions header displays `currentSession` on the right: rendered between "Sessions" label and `+` button, styled `truncate text-text-primary font-mono`
- [x] CHK-004 Sessions header normalizes to ServerPanel text-color conventions: outer header uses `text-text-secondary`; session-name span uses `text-text-primary`
- [x] CHK-005 Sessions header MUST NOT tint its background from current session color: header background stays default sidebar chrome
- [x] CHK-006 Legacy tint mode preserved: `tintOnlyWhenCollapsed` false/unset AND tint passed → header uses `tint.base` + `tint.hover` behavior unchanged

## Behavioral Correctness
- [x] CHK-007 ServerPanel collapsed with colored active server: collapsed-header color matches body tint of the active tile when panel expanded (both use `tint.selected`)
- [x] CHK-008 ServerPanel collapsed with uncolored active server: no background tint on header (null tint path)
- [x] CHK-009 ServerPanel expanded (tintOnlyWhenCollapsed=true): header has no tint; active tile body still uses `tint.selected` (unchanged at `server-panel.tsx:222-224`)

## Removal Verification
- [x] CHK-010 **N/A**: no deprecated requirements

## Scenario Coverage
- [x] CHK-011 "ServerPanel collapsed, active server has assigned color" scenario covered by unit test asserting collapsed-header `background-color` equals `tint.selected`
- [x] CHK-012 "ServerPanel expanded" scenario covered by unit test asserting no inline `background-color` when open
- [x] CHK-013 "Mouse enters collapsed, tinted ServerPanel header" scenario: manual verification (hovering does not change header color) OR derived from the absence of `onMouseEnter`/`onMouseLeave` handlers in the selected-shade branch
- [x] CHK-014 "A session is selected" and "No session is selected" scenarios: manual verification in browser (dev server) — text present when `currentSession` set, absent otherwise

## Edge Cases & Error Handling
- [x] CHK-015 Long `currentSession` name truncates with ellipsis via `truncate` utility; `+` button remains visible

## Code Quality
- [x] CHK-016 Pattern consistency: Sessions header markup mirrors the ServerPanel `headerRight` pattern (`server-panel.tsx:81-86`) exactly in class list and structure
- [x] CHK-017 No unnecessary duplication: reuses existing `RowTint.selected` + existing `truncate text-text-primary font-mono` convention — no new theme tokens, no new prop on `CollapsiblePanel`
- [x] CHK-018 Readability over cleverness: tint-shade selection expressed as a clear conditional (`tintOnlyWhenCollapsed ? tint.selected : tint.base`) rather than a helper indirection for one call site
- [x] CHK-019 Follow existing project patterns: edits stay within the existing sidebar component file layout; no new files introduced
- [x] CHK-020 Frontend type narrowing: any conditional on `currentSession` uses `if` / `&&` guards rather than `as` casts
- [x] CHK-021 New code includes tests covering changed behavior (T003 adds unit tests for tint shade selection)
- [x] CHK-022 **N/A**: no Playwright e2e test added — existing specs don't assert on sidebar header color/composition and per spec Assumption #11 no new Playwright is required for this change

## Security
- [x] CHK-023 **N/A**: no security surface — purely visual frontend change with no user input, no subprocess calls, no persistence changes

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-xxx **N/A**: {reason}`
